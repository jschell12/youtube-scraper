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
  'product-review': `You are a product analyst. From this video transcript, extract every product discussed. Stay neutral — do not pick a winner. Let the data speak.

Output this EXACT format in markdown:

## Products Compared

| Product | Price | Specs | Best For | Tradeoffs |
|---------|-------|-------|----------|-----------|
(Every product mentioned. Use exact prices from the transcript. Include key specs like weight, battery life, resolution, storage, etc. if discussed.)

## Timestamps
- (List approximate timestamps for when each product is discussed, e.g. "3:20 — DJI Mini 4K — entry-level overview")

## Where to Buy
- (Retailers, websites, or availability notes mentioned in the video)`,

  'financial': `You are a financial analyst. From this video transcript, extract structured market intelligence. Format ticker links as [TICKER](https://robinhood.com/stocks/TICKER).

Output this EXACT format in markdown:

## Tickers Discussed

| Ticker | Price Target | Time Horizon | Sentiment |
|--------|-------------|--------------|-----------|
(Every stock, crypto, ETF, or asset discussed. Link each ticker like [AAPL](https://robinhood.com/stocks/AAPL). Use the exact price targets and time horizons stated.)

## Bull Case
- (For each ticker with a bullish thesis, list the reasons the investment may rise)

## Bear Case
- (For each ticker with a bearish thesis, list the risks or reasons it may decline)

## Options Plays

| Strategy | Ticker | Strike | Expiry | Premium | Notes |
|----------|--------|--------|--------|---------|-------|
(If any options strategies are mentioned — calls, puts, spreads, etc. Omit this section if none discussed.)

## Macro Context
- (Fed policy, interest rates, inflation, employment, economic outlook — any macro factors discussed)`,

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

## What Was Built / Covered
(1-2 sentence description of the project, tool, or topic)

## Technologies & Tools

| Tool / Framework | Category | Version | Link |
|-----------------|----------|---------|------|
(Every tool, framework, language, platform discussed. Include version numbers if mentioned. Add GitHub/docs links if stated in the video, otherwise leave blank.)

## Benchmarks (if applicable)

| Metric | Value | Comparison |
|--------|-------|------------|
(Performance numbers, speed tests, or comparisons. Omit this section if none discussed.)

## Key Insights
- (Notable claims, opinions, or recommendations from the presenter)`,

  'travel': `You are a travel writer. From this video transcript, extract a structured travel guide.

Output this EXACT format in markdown:

## Destination
(City, Region, Country)

## Budget Breakdown

| Category | Cost | Notes |
|----------|------|-------|
(Flights, hotels, food per day, transport, activities — whatever costs are mentioned)

## Places & Experiences

| Place / Activity | Type | Cost | Rating / Notes |
|------------------|------|------|----------------|
(Hotels, restaurants, attractions, activities mentioned)

## Skip These
- (Anything the creator explicitly recommends avoiding)

## Best Time to Visit
(Seasonal notes, weather, crowds, pricing — if mentioned)

## Travel Tips
- (Practical advice: packing, transport, safety, local customs)`,

  'cooking': `You are a food writer. From this video transcript, extract the complete recipe. If the video covers multiple recipes, create separate sections for each.

Output this EXACT format in markdown:

## Dish
(Name of the dish)

## Grocery List

### Produce
- (Fruits, vegetables, herbs)

### Dairy & Eggs
- (Milk, cheese, butter, eggs)

### Meat & Protein
- (Meat, fish, tofu)

### Pantry
- (Oils, spices, flour, sugar, canned goods)

### Other
- (Anything that doesn't fit above)

## Ingredients

| Ingredient | Amount | Notes |
|------------|--------|-------|
(All ingredients with exact measurements)

## Method
1. (Numbered steps with exact temperatures, times, and measurements. e.g. "Sear for 3 minutes per side over medium-high heat")

## Nutrition (if mentioned)

| Per Serving | Amount |
|-------------|--------|
(Calories, protein, carbs, fat — only if stated in the video)

## Equipment Needed
- (Any specific cookware, appliances, or tools required)

## Substitutions & Dietary Variations
- (Alternative ingredients, vegan/GF options, or variations the creator mentions)`,

  'gaming': `You are a gaming journalist. From this video transcript, extract structured game details.

Output this EXACT format in markdown:

## Game(s) Covered

| Game | Platform | Genre | Score | Verdict |
|------|----------|-------|-------|---------|
(Each game discussed. Include the creator's score/rating if given, otherwise "N/A".)

## Pros & Cons

| Pros | Cons |
|------|------|
(What the creator liked vs didn't)

## Build / Strategy (if applicable)

| Item / Skill / Stat | Purpose | Priority |
|---------------------|---------|----------|
(Character builds, loadouts, skill trees, or equipment recommendations. Omit if not a guide.)

## Similar Games
- (Comparisons to other games in the genre that the creator mentions)

## Key Points
- (Gameplay impressions, performance notes, story highlights)`,

  'health-fitness': `You are a health & fitness writer. From this video transcript, extract actionable details.

Output this EXACT format in markdown:

## Topic
(What health/fitness topic is covered)

## Routine

| Exercise | Sets | Reps | Rest | Notes |
|----------|------|------|------|-------|
(The full workout or protocol. Omit if the video is not workout-focused.)

## Supplements & Products

| Supplement / Product | Dosage | Recommendation | Evidence |
|---------------------|--------|----------------|----------|
(Every supplement, product, or food recommended with dosages. Omit if none discussed.)

## Scientific Evidence
- (Any claims backed by studies — note the claim and the study/source cited. e.g. "Creatine improves power output — cited meta-analysis from Journal of Sports Science")

## Warnings & Contraindications
- (Safety notes, who should avoid this, medical disclaimers, injury risks)`,

  'news': `You are a news editor. From this video transcript, extract the key stories and context. Always attribute claims to their source.

Output this EXACT format in markdown:

## Headlines

| Story | Source | Who | What |
|-------|--------|-----|------|
(Each news story covered. Source = who reported it or where the claim comes from.)

## Timeline (if applicable)
- (Chronological sequence of events if the story spans multiple days/developments. Omit if single-event.)

## Related Tickers & Companies

| Company | Ticker | Impact |
|---------|--------|--------|
(Companies or stocks affected by the news. Link tickers like [AAPL](https://robinhood.com/stocks/AAPL). Omit if none relevant.)

## Context & Analysis
- (Background and analysis — attribute claims: "according to Reuters", "the presenter argues", etc.)`,

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
