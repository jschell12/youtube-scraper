/**
 * Category-aware video summarization.
 * Each category gets a tailored prompt that extracts structured, useful details.
 * Outputs a _summary-<videoId>.md file alongside the transcript.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { callClaude } from './claude.js';
import { kindToLegacy } from './taxonomy.js';

/**
 * Category-specific prompt templates.
 * Each returns structured markdown with tables, lists, key takeaways.
 */
const TEMPLATES = {
  'product-review': `You are a product analyst. From this video transcript, extract a structured product comparison.

Output this EXACT format in markdown:

## Products Mentioned (low to high price)

| Product | Price | Best For | Tradeoffs |
|---------|-------|----------|-----------|
(Fill in every product mentioned with real details from the transcript. Use ~price if exact price not stated.)

## Key Advice
- (Bullet points of the reviewer's main recommendations and opinions)

## Verdict
(1-2 sentences: what the reviewer recommends and why)`,

  'financial': `You are a financial analyst. From this video transcript, extract structured market intelligence.

Output this EXACT format in markdown:

## Stocks & Assets Discussed

| Ticker/Asset | Sentiment | Price Target | Thesis |
|--------------|-----------|--------------|--------|
(Fill in every stock, crypto, ETF, or asset discussed)

## Market Outlook
- (Bullet points of the speaker's macro view, risks, opportunities)

## Key Trades / Recommendations
- (Specific actionable calls made in the video, if any)

## Risks & Warnings
- (Any caveats, disclaimers, or bearish signals mentioned)`,

  'informational': `You are an expert summarizer. From this educational video transcript, extract the key knowledge.

Output this EXACT format in markdown:

## Topic
(One-line description of what this video teaches)

## Key Concepts

| Concept | Explanation |
|---------|-------------|
(The main ideas/techniques/facts taught, each in a row)

## Step-by-Step (if applicable)
1. (Numbered steps if the video is a how-to or tutorial)

## Key Takeaways
- (3-5 bullet points of the most important things to remember)`,

  'tech': `You are a tech analyst. From this video transcript, extract structured technical details.

Output this EXACT format in markdown:

## Technologies Covered

| Technology | Category | Key Detail |
|------------|----------|------------|
(Every tool, framework, language, platform, or product discussed)

## Technical Insights
- (Bullet points of notable claims, benchmarks, comparisons, or opinions)

## Recommendations
- (What the presenter recommends and why)

## Links & Resources
- (Any tools, repos, or resources mentioned — name only if URL not stated)`,

  'travel': `You are a travel writer. From this video transcript, extract a structured travel guide.

Output this EXACT format in markdown:

## Destination
(Where the video covers)

## Places & Experiences

| Place / Activity | Type | Cost | Rating / Notes |
|------------------|------|------|----------------|
(Hotels, restaurants, attractions, activities mentioned)

## Travel Tips
- (Practical advice: best time to visit, what to pack, what to avoid, transport)

## Verdict
(1-2 sentences: would the creator recommend this destination and for whom)`,

  'cooking': `You are a food writer. From this video transcript, extract the recipe and technique details.

Output this EXACT format in markdown:

## Dish
(Name of the dish or dishes made)

## Ingredients

| Ingredient | Amount | Notes |
|------------|--------|-------|
(All ingredients mentioned)

## Method
1. (Numbered steps of the cooking process)

## Tips & Variations
- (Any tips, substitutions, or variations the creator mentions)`,

  'gaming': `You are a gaming journalist. From this video transcript, extract structured game details.

Output this EXACT format in markdown:

## Game(s) Covered

| Game | Platform | Genre | Verdict |
|------|----------|-------|---------|
(Each game discussed)

## Key Points
- (Gameplay impressions, performance, story, mechanics discussed)

## Pros & Cons
| Pros | Cons |
|------|------|
(What the creator liked vs didn't)

## Recommendation
(Who should play this, buy/skip/wait verdict)`,

  'health-fitness': `You are a health & fitness writer. From this video transcript, extract actionable details.

Output this EXACT format in markdown:

## Topic
(What health/fitness topic is covered)

## Key Recommendations

| Recommendation | Details | Evidence/Source |
|----------------|---------|-----------------|
(Exercises, supplements, habits, or advice given)

## Routine / Protocol (if applicable)
1. (Numbered steps if a workout or protocol is described)

## Warnings & Disclaimers
- (Any safety notes, contraindications, or "consult your doctor" caveats)`,

  'news': `You are a news editor. From this video transcript, extract the key stories and context.

Output this EXACT format in markdown:

## Headlines

| Story | Who | What | Why It Matters |
|-------|-----|------|----------------|
(Each news story or topic covered)

## Context & Analysis
- (Background information and analysis the presenter provides)

## What to Watch
- (Upcoming events, developments, or follow-up items mentioned)`,

  'business': `You are a business analyst. From this video transcript, extract actionable business insights.

Output this EXACT format in markdown:

## Topic
(What business topic is covered)

## Key Insights

| Insight | Details | Actionable? |
|---------|---------|-------------|
(Main business strategies, tactics, or lessons shared)

## Tools & Resources Mentioned
- (Any platforms, books, frameworks, or services recommended)

## Action Items
- (Concrete next steps the viewer could take)`,

  'diy-crafts': `You are a DIY project writer. From this video transcript, extract the project details.

Output this EXACT format in markdown:

## Project
(What is being built/made)

## Materials & Tools

| Item | Purpose | Approximate Cost |
|------|---------|-----------------|
(Everything needed for the project)

## Steps
1. (Numbered build/craft steps)

## Tips & Mistakes to Avoid
- (Lessons learned, shortcuts, or warnings from the creator)`,

  'sports': `You are a sports analyst. From this video transcript, extract the key details.

Output this EXACT format in markdown:

## Coverage

| Team / Player | Event | Key Stat / Moment |
|---------------|-------|-------------------|
(Teams, players, or events discussed)

## Analysis
- (Tactical breakdowns, predictions, or opinions shared)

## Key Takeaways
- (The main points viewers should know)`,

  'science': `You are a science communicator. From this video transcript, extract the key findings.

Output this EXACT format in markdown:

## Topic
(What scientific subject is covered)

## Key Findings

| Finding / Concept | Explanation | Significance |
|-------------------|-------------|--------------|
(Main scientific claims, discoveries, or concepts explained)

## Evidence & Sources
- (Studies, papers, or data cited in the video)

## Implications
- (Why this matters, real-world applications)`,

  'music': `You are a music journalist. From this video transcript, extract the key details.

Output this EXACT format in markdown:

## Coverage

| Artist / Song / Gear | Type | Key Detail |
|----------------------|------|------------|
(Songs performed, instruments discussed, gear reviewed, techniques taught)

## Key Points
- (Main opinions, techniques, or insights shared)

## Recommendations
- (What the creator recommends: songs to learn, gear to buy, techniques to practice)`,

  'entertainment': `You are an entertainment writer. From this video transcript, extract the key details.

Output this EXACT format in markdown:

## Summary
(2-3 sentence overview of what happens in the video)

## Highlights
- (The most notable/funny/interesting moments)

## Key People / References
- (People featured, shows/movies referenced, cultural references)`,

  'other': `You are a content summarizer. From this video transcript, extract the key information.

Output this EXACT format in markdown:

## Summary
(2-3 sentence overview)

## Key Points
- (The most important information from the video)

## Details

| Topic | Details |
|-------|---------|
(Structured breakdown of specific items discussed)`,
};

/**
 * Parse category from a video markdown file's metadata.
 */
function parseCategory(content) {
  const match = content.match(/^\- \*\*Category\*\*:\s*(.+)$/m);
  return match ? match[1].trim() : 'other';
}

/**
 * Parse primary_kind from a video markdown file's metadata.
 */
function parseKind(content) {
  const match = content.match(/^\- \*\*Kind\*\*:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Parse title from a video markdown file.
 */
function parseTitle(content) {
  return content.split('\n')[0]?.replace(/^#\s*/, '') || 'Untitled';
}

/**
 * Select the appropriate summary template for a video.
 * Uses primary_kind if available, falls back to legacy category.
 */
function selectTemplate(category, primaryKind) {
  if (primaryKind) {
    const templateKey = kindToLegacy(primaryKind);
    if (TEMPLATES[templateKey]) return { template: TEMPLATES[templateKey], key: templateKey };
  }
  return { template: TEMPLATES[category] || TEMPLATES['other'], key: category };
}

/**
 * Summarize a single video file using its category-specific template.
 * @param {string} filePath - Path to the video markdown file
 * @param {object} opts
 * @param {string} opts.model
 * @returns {string} Path to the summary file
 */
export async function summarizeVideo(filePath, { model = 'haiku' } = {}) {
  const content = await readFile(filePath, 'utf8');
  const category = parseCategory(content);
  const primaryKind = parseKind(content);
  const title = parseTitle(content);

  const { template, key: templateKey } = selectTemplate(category, primaryKind);

  // Extract transcript section
  const transcriptIdx = content.indexOf('## Transcript');
  const transcript = transcriptIdx >= 0
    ? content.slice(transcriptIdx + '## Transcript'.length).trim()
    : content;

  // Use up to 3000 words of transcript for context
  const snippet = transcript.split(/\s+/).slice(0, 3000).join(' ');

  const prompt = `${template}

---

Video Title: ${title}
Category: ${category}

Transcript:
${snippet}`;

  const label = primaryKind ? `${primaryKind} → ${templateKey}` : category;
  console.log(`  Summarizing (${label}): ${title}`);
  const summary = await callClaude(prompt, { model, timeout: 120_000 });

  // Write summary file alongside the transcript
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.md');
  const summaryPath = path.join(dir, `_summary-${base}.md`);

  const header = `# ${title}\n\n_Category: ${category}_\n\n`;
  await writeFile(summaryPath, header + summary + '\n');

  console.log(`  Written: ${path.basename(summaryPath)}`);
  return summaryPath;
}

/**
 * Summarize all unsummarized video files in a day directory.
 * @param {string} dayDir
 * @param {object} opts
 * @param {string} opts.model
 */
export async function summarizeDay(dayDir, { model = 'haiku' } = {}) {
  const files = (await readdir(dayDir)).filter(f =>
    f.endsWith('.md') && !f.startsWith('_')
  );

  if (files.length === 0) {
    console.log('No video files to summarize.');
    return [];
  }

  // Find which videos already have summaries
  const allFiles = await readdir(dayDir);
  const existing = new Set(allFiles.filter(f => f.startsWith('_summary-')));

  const summaryPaths = [];
  for (const f of files) {
    const summaryName = `_summary-${f}`;
    if (existing.has(summaryName)) {
      console.log(`  Already summarized: ${f}`);
      continue;
    }

    const result = await summarizeVideo(path.join(dayDir, f), { model });
    summaryPaths.push(result);
  }

  if (summaryPaths.length === 0) {
    console.log('All videos already summarized.');
  } else {
    console.log(`\nSummarized ${summaryPaths.length} video(s).`);
  }

  return summaryPaths;
}
