#!/usr/bin/env node
/**
 * One-time backfill: populate uploadDate in seen.json from transcript markdown headers.
 * Run from the youtube-scraper root: node scripts/backfill-upload-dates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const outputDir = process.env.YOUTUBE_OUTPUT_DIR || './output';
const seenPath = path.join(outputDir, 'seen.json');

const seen = JSON.parse(fs.readFileSync(seenPath, 'utf-8'));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_LINE_RE = /^- \*\*Date\*\*:\s*(.+)$/m;

let updated = 0;
let skipped = 0;

const dirs = fs.readdirSync(outputDir).filter(d => DAY_RE.test(d));

for (const day of dirs) {
  const dayDir = path.join(outputDir, day);
  const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.md') && !f.startsWith('_summary-'));

  for (const file of files) {
    const match = file.match(/^([A-Za-z0-9_-]{11})-/);
    if (!match) continue;
    const id = match[1];
    if (!seen[id]) continue;
    if (seen[id].uploadDate) { skipped++; continue; }

    const content = fs.readFileSync(path.join(dayDir, file), 'utf-8');
    const dateMatch = content.match(DATE_LINE_RE);
    if (dateMatch) {
      seen[id].uploadDate = dateMatch[1].trim();
      updated++;
    }
  }
}

fs.writeFileSync(seenPath, JSON.stringify(seen, null, 2) + '\n');
console.log(`Done. Updated: ${updated}, Already set: ${skipped}, Total entries: ${Object.keys(seen).length}`);
