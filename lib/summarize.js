/**
 * Summarization pipeline — mirrors news-scraper's summarize-day.js pattern.
 * Batches transcripts → Claude → daily briefing + updates.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { callClaude } from './claude.js';

const BATCH_SIZE = 15; // Fewer than news-scraper's 30 because transcripts are longer

/**
 * Summarize all video markdown files in a day directory.
 * @param {string} dayDir - e.g. output/2026-07-03
 * @param {object} opts
 * @param {string} opts.model
 */
export async function summarizeDay(dayDir, { model = 'haiku' } = {}) {
  const files = (await readdir(dayDir)).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  if (files.length === 0) {
    console.log('No video files to summarize.');
    return;
  }

  const articles = [];
  for (const f of files) {
    const content = await readFile(path.join(dayDir, f), 'utf8');
    const title = content.split('\n')[0]?.replace(/^#\s*/, '') || f;
    // Take first 600 words of transcript body
    const body = content.split('\n').slice(1).join('\n').trim();
    const snippet = body.split(/\s+/).slice(0, 600).join(' ');
    articles.push({ file: f, title, snippet });
  }

  console.log(`Summarizing ${articles.length} videos...`);

  // Batch if needed
  const batches = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE));
  }

  const batchSummaries = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} videos)...`);

    const listing = batch.map((a, j) =>
      `### Video ${j + 1}: ${a.title}\n${a.snippet}`
    ).join('\n\n---\n\n');

    const prompt = `You are a news editor producing a daily video briefing. Below are ${batch.length} YouTube video transcripts from today.

Produce a batch summary with:
- **Key Videos** (2-3 most important, 2-3 sentences each)
- **Other Notable** (bullet points, 1 sentence each)
- **All Titles** (numbered list)

${listing}`;

    const result = await callClaude(prompt, { model });
    batchSummaries.push(result);
  }

  let summary;
  if (batchSummaries.length === 1) {
    summary = batchSummaries[0];
  } else {
    console.log('  Merging batch summaries...');
    const mergePrompt = `Merge these ${batchSummaries.length} batch summaries into ONE daily video briefing:

1. **Top Videos** (3-5 most important, 2-3 sentences each)
2. **Market & Business** (bullets, if applicable)
3. **Technology** (bullets, if applicable)
4. **Other Notable** (bullets)

Deduplicate across batches. Be concise.

${batchSummaries.map((s, i) => `## Batch ${i + 1}\n${s}`).join('\n\n---\n\n')}`;

    summary = await callClaude(mergePrompt, { model });
  }

  // Write summary
  const date = path.basename(dayDir);
  const header = `# Daily Video Briefing — ${date}\n\n_${articles.length} videos summarized_\n\n`;
  const outPath = path.join(dayDir, '_daily-summary.md');

  // Save previous version for diffing
  if (existsSync(outPath)) {
    const prev = await readFile(outPath, 'utf8');
    await writeFile(path.join(dayDir, '_daily-summary.prev.md'), prev);
  }

  await writeFile(outPath, header + summary + '\n');
  console.log(`  Written: ${outPath}`);
  return outPath;
}
