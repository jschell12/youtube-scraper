/**
 * Scrape orchestrator — fetches videos, classifies, writes markdown, updates ledger.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDeps, fetchVideos, listSearch, RateLimitedError } from './extract.js';
import { isSearchSource } from './search-sources.js';
import { apiKey, discoverVideos, parseSourceUrl } from './youtube-api.js';
import { Ledger } from './ledger.js';
import { categorize } from './categorize.js';
import { summarizeVideo } from './summarize.js';

/**
 * Scrape videos from one or more URLs.
 * @param {string[]} urls - YouTube video/channel/playlist URLs
 * @param {object} opts
 * @param {string} opts.outputDir - base output directory
 * @param {number} opts.sinceHours - time window
 * @param {number} opts.limit - max videos per URL
 * @param {boolean} opts.rescrape - ignore ledger, re-process everything
 * @param {string} opts.model - Claude model for classification
 * @param {string} [opts.forceCategory] - skip classification and use this
 *   category's summary template for every video (e.g. 'travel' — a food-review
 *   video would otherwise classify as 'cooking' and get the recipe-extraction
 *   prompt, which refuses on review content)
 * @param {boolean} [opts.summarize=true] - false skips the per-video LLM
 *   summary. With forceCategory set as well, a scrape makes no LLM calls.
 * @param {boolean} [opts.keepSrt=false] - also write the raw caption file
 *   (<id>-<slug>.srt) and a _video-<id>.json metadata sidecar per video, which
 *   is what `cli.js push` sends downstream.
 *
 * Stops at the first HTTP 429 from YouTube (see RateLimitedError): videos
 * already saved stay saved, and the result carries rateLimited: true.
 */
export async function scrape(urls, { outputDir = './output', sinceHours = 24, limit = 50, rescrape = false, model = 'ollama', forceCategory, summarize = true, keepSrt = false } = {}) {
  await checkDeps();

  const today = new Date().toISOString().slice(0, 10);
  const dayDir = path.join(outputDir, today);
  await mkdir(dayDir, { recursive: true });

  const ledgerPath = path.join(outputDir, 'seen.json');
  const ledger = await new Ledger(ledgerPath).load();

  let totalNew = 0;
  let totalSkipped = 0;
  let rateLimited = false;

  for (const url of urls) {
    console.log(`\nFetching: ${url}`);

    let videos;
    try {
      videos = await fetchSource(url, { sinceHours, limit, rescrape, ledger });
    } catch (err) {
      if (err instanceof RateLimitedError) {
        console.error(`  ${err.message}`);
        rateLimited = true;
        break;
      }
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

      // Classify via Claude (returns both legacy category and rich classification),
      // unless the caller pinned a category (no Kind line is written, so the
      // summarizer's template selection follows the forced category too).
      let category = 'other';
      let classification = null;
      if (forceCategory) {
        category = forceCategory;
        console.log(`  Category (forced): ${category}`);
      } else {
        try {
          ({ category, classification } = await categorize(video, { model }));
          console.log(`  Kind: ${classification.primary_kind} → Category: ${category}`);
        } catch (err) {
          console.warn(`  Warning: classification failed, defaulting to 'other': ${err.message}`);
        }
      }

      // Write markdown file
      const safeName = video.title
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 80)
        .toLowerCase();
      const filename = `${video.id}-${safeName}.md`;
      const filePath = path.join(dayDir, filename);

      const mdLines = [
        `# ${video.title}`,
        '',
        `- **Channel**: ${video.channel}`,
        `- **Date**: ${video.upload_date}`,
        `- **Duration**: ${video.duration_string}`,
        `- **Category**: ${category}`,
      ];

      if (classification) {
        mdLines.push(`- **Kind**: ${classification.primary_kind}`);
        mdLines.push(`- **Domain**: ${classification.domain}`);
      }

      mdLines.push(
        `- **URL**: ${video.url}`,
        '',
        '## Transcript',
        '',
        video.transcript,
        '',
      );

      await writeFile(filePath, mdLines.join('\n'));

      // Write classification JSON alongside transcript
      if (classification) {
        const classifyPath = path.join(dayDir, `_classify-${video.id}-${safeName}.json`);
        await writeFile(classifyPath, JSON.stringify(classification, null, 2) + '\n');
      }

      if (keepSrt && video.srt) {
        const srtName = `${video.id}-${safeName}.srt`;
        await writeFile(path.join(dayDir, srtName), video.srt);
        await writeFile(path.join(dayDir, `_video-${video.id}.json`), JSON.stringify({
          video_id: video.id,
          channel_id: video.channel_id || null,
          channel_title: video.channel,
          title: video.title,
          url: video.url,
          published_at: video.published_at || null,
          srt_file: srtName,
        }, null, 2) + '\n');
      }

      // Generate category-specific summary
      if (summarize) {
        try {
          await summarizeVideo(filePath, { model });
        } catch (err) {
          console.warn(`  Warning: summarization failed: ${err.message}`);
        }
      }

      // Update ledger immediately (incremental persistence)
      ledger.markSeen(video.id, {
        title: video.title,
        channel: video.channel,
        category,
        primaryKind: classification?.primary_kind,
        domain: classification?.domain,
        topics: classification?.topics,
        entities: classification?.entities,
        url: video.url,
        uploadDate: video.upload_date || null,
      });
      await ledger.save();

      totalNew++;
      console.log(`  Saved: ${filename}`);
    }
  }

  console.log(`\nDone. ${totalNew} new, ${totalSkipped} skipped (already seen). Ledger: ${ledger.size} total.` +
    (rateLimited ? ' Stopped early: YouTube returned HTTP 429.' : ''));
  return { dayDir, totalNew, totalSkipped, rateLimited };
}

/**
 * Fetch videos for one source URL.
 *
 * When YOUTUBE_API_KEY is set and the URL is a channel/playlist, discovery
 * runs through the Data API (cheap, fast) and ledger-seen videos are dropped
 * BEFORE yt-dlp is invoked, so yt-dlp only fetches transcripts for new
 * videos. Falls back to the classic yt-dlp listing on any API failure, for
 * single-video URLs, or when no key is present.
 */
async function fetchSource(url, { sinceHours, limit, rescrape, ledger }) {
  // "ytsearchN:query": list ids flat, drop seen ones, then fetch each unseen
  // video singly. No date window: search results are not time-ordered, and the
  // ledger is what keeps a repeated search from re-fetching.
  if (isSearchSource(url)) {
    const hits = await listSearch(url);
    const fresh = rescrape ? hits : hits.filter((v) => !ledger.hasSeen(v.id));
    console.log(`  Search: ${hits.length} result(s), ${fresh.length} new`);
    const videos = [];
    for (const v of fresh) {
      videos.push(...await fetchVideos(v.url, { sinceHours: 0, limit: 1 }));
    }
    return videos;
  }
  if (apiKey() && parseSourceUrl(url)) {
    try {
      const discovered = await discoverVideos(url, { sinceHours, limit });
      const fresh = rescrape ? discovered : discovered.filter((v) => !ledger.hasSeen(v.id));
      console.log(`  API discovery: ${discovered.length} in window, ${fresh.length} new`);
      const videos = [];
      for (const v of fresh) {
        // Single-video mode: yt-dlp only pulls metadata + transcript.
        const fetched = await fetchVideos(v.url, { sinceHours: 0, limit: 1 });
        videos.push(...fetched);
      }
      return videos;
    } catch (err) {
      // A 429 must end the run, not trigger a second (heavier) yt-dlp listing.
      if (err instanceof RateLimitedError) throw err;
      console.warn(`  API discovery failed (${err.message}); falling back to yt-dlp listing`);
    }
  }
  return fetchVideos(url, { sinceHours, limit });
}
