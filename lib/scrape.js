/**
 * Scrape orchestrator — fetches videos, writes markdown, updates ledger.
 * Mirrors news-scraper's scrape.js incremental persistence pattern.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDeps, fetchVideos } from './extract.js';
import { Ledger } from './ledger.js';

/**
 * Scrape videos from one or more URLs.
 * @param {string[]} urls - YouTube video/channel/playlist URLs
 * @param {object} opts
 * @param {string} opts.outputDir - base output directory
 * @param {number} opts.sinceHours - time window
 * @param {number} opts.limit - max videos per URL
 * @param {boolean} opts.rescrape - ignore ledger, re-process everything
 */
export async function scrape(urls, { outputDir = './output', sinceHours = 24, limit = 50, rescrape = false } = {}) {
  await checkDeps();

  const today = new Date().toISOString().slice(0, 10);
  const dayDir = path.join(outputDir, today);
  await mkdir(dayDir, { recursive: true });

  const ledgerPath = path.join(outputDir, 'seen.json');
  const ledger = await new Ledger(ledgerPath).load();

  let totalNew = 0;
  let totalSkipped = 0;

  for (const url of urls) {
    console.log(`\nFetching: ${url}`);

    let videos;
    try {
      videos = await fetchVideos(url, { sinceHours, limit });
    } catch (err) {
      console.error(`  Error fetching ${url}: ${err.message}`);
      continue;
    }

    console.log(`  Found ${videos.length} videos`);

    for (const video of videos) {
      if (!rescrape && ledger.hasSeen(video.id)) {
        totalSkipped++;
        continue;
      }

      if (!video.transcript) {
        console.log(`  Skipping (no transcript): ${video.title}`);
        continue;
      }

      // Write markdown file
      const safeName = video.title
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 80)
        .toLowerCase();
      const filename = `${video.id}-${safeName}.md`;
      const filePath = path.join(dayDir, filename);

      const md = [
        `# ${video.title}`,
        '',
        `- **Channel**: ${video.channel}`,
        `- **Date**: ${video.upload_date}`,
        `- **Duration**: ${video.duration_string}`,
        `- **URL**: ${video.url}`,
        '',
        '## Transcript',
        '',
        video.transcript,
        '',
      ].join('\n');

      await writeFile(filePath, md);

      // Update ledger immediately (incremental persistence)
      ledger.markSeen(video.id, {
        title: video.title,
        channel: video.channel,
        url: video.url,
      });
      await ledger.save();

      totalNew++;
      console.log(`  Saved: ${filename}`);
    }
  }

  console.log(`\nDone. ${totalNew} new, ${totalSkipped} skipped (already seen). Ledger: ${ledger.size} total.`);
  return { dayDir, totalNew, totalSkipped };
}
