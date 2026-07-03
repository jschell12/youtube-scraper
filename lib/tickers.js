/**
 * Ticker extraction — mirrors news-scraper's extract-tickers.js pattern.
 * Reads video markdown files, asks Claude to identify stocks/ETFs.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { callClaude } from './claude.js';

const BATCH_SIZE = 15;

/**
 * Extract tickers from all video files in a day directory.
 * @param {string} dayDir
 * @param {object} opts
 * @param {string} opts.model
 */
export async function extractTickers(dayDir, { model = 'haiku' } = {}) {
  const files = (await readdir(dayDir)).filter(f => f.endsWith('.md') && !f.startsWith('_'));
  if (files.length === 0) {
    console.log('No video files for ticker extraction.');
    return;
  }

  const articles = [];
  for (const f of files) {
    const content = await readFile(path.join(dayDir, f), 'utf8');
    const title = content.split('\n')[0]?.replace(/^#\s*/, '') || f;
    const body = content.split('\n').slice(1).join('\n').trim();
    const snippet = body.split(/\s+/).slice(0, 400).join(' ');
    articles.push({ title, snippet });
  }

  console.log(`Extracting tickers from ${articles.length} videos...`);

  const allStocks = [];
  const allEtfs = [];

  const batches = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`  Batch ${i + 1}/${batches.length}...`);

    const listing = batch.map((a, j) =>
      `Video ${j + 1}: ${a.title}\n${a.snippet}`
    ).join('\n\n');

    const prompt = `You are a financial analyst. From the following YouTube video transcripts, identify:

1. Stocks MENTIONED (directly named or discussed)
2. Stocks AFFECTED (not mentioned but impacted by themes discussed)
3. ETFs relevant to the themes

Return ONLY valid JSON, no markdown fences:
{
  "stocks": [{"ticker": "AAPL", "company": "Apple", "sentiment": "bullish", "reason": "...", "mentioned": true}],
  "etfs": [{"ticker": "XLE", "name": "Energy Select SPDR", "sentiment": "bullish", "reason": "...", "theme": "energy"}]
}

If no financial content is found, return {"stocks": [], "etfs": []}.

${listing}`;

    const result = await callClaude(prompt, { model });

    try {
      // Strip markdown fences if Claude adds them despite instructions
      const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.stocks) allStocks.push(...parsed.stocks);
      if (parsed.etfs) allEtfs.push(...parsed.etfs);
    } catch {
      console.warn(`  Warning: Could not parse ticker JSON from batch ${i + 1}`);
    }
  }

  // Deduplicate by ticker (keep first occurrence)
  const seenTickers = new Set();
  const stocks = [];
  for (const s of allStocks) {
    if (!seenTickers.has(s.ticker)) {
      seenTickers.add(s.ticker);
      stocks.push(s);
    }
  }
  const seenEtfs = new Set();
  const etfs = [];
  for (const e of allEtfs) {
    if (!seenEtfs.has(e.ticker)) {
      seenEtfs.add(e.ticker);
      etfs.push(e);
    }
  }

  // Build markdown tables
  const lines = [`# Market Extraction — ${path.basename(dayDir)}\n`];

  if (stocks.length > 0) {
    const bullish = stocks.filter(s => s.sentiment === 'bullish');
    const bearish = stocks.filter(s => s.sentiment === 'bearish');
    const neutral = stocks.filter(s => s.sentiment === 'neutral');

    for (const [label, group] of [['Bullish', bullish], ['Bearish', bearish], ['Neutral', neutral]]) {
      if (group.length === 0) continue;
      lines.push(`## ${label} Stocks\n`);
      lines.push('| Ticker | Company | Mentioned | Reason |');
      lines.push('|--------|---------|-----------|--------|');
      for (const s of group) {
        lines.push(`| ${s.ticker} | ${s.company} | ${s.mentioned ? 'Yes' : 'Inferred'} | ${s.reason} |`);
      }
      lines.push('');
    }
  }

  if (etfs.length > 0) {
    lines.push('## ETFs\n');
    lines.push('| Ticker | Name | Sentiment | Theme | Reason |');
    lines.push('|--------|------|-----------|-------|--------|');
    for (const e of etfs) {
      lines.push(`| ${e.ticker} | ${e.name} | ${e.sentiment} | ${e.theme} | ${e.reason} |`);
    }
    lines.push('');
  }

  if (stocks.length === 0 && etfs.length === 0) {
    lines.push('_No financial content detected._\n');
  }

  const outPath = path.join(dayDir, '_market.md');

  if (existsSync(outPath)) {
    const prev = await readFile(outPath, 'utf8');
    await writeFile(path.join(dayDir, '_market.prev.md'), prev);
  }

  await writeFile(outPath, lines.join('\n') + '\n');
  console.log(`  Written: ${outPath}`);
  return outPath;
}
