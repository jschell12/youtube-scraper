#!/usr/bin/env node

/**
 * YouTube Scraper CLI
 *
 * Usage:
 *   node cli.js scrape [--url URL...] [--config config.yaml] [--since-hours 24] [--limit 50] [--rescrape] [--category travel]
 *   node cli.js summarize [dayDir]
 *   node cli.js discover [--topic NAME] [--queries N] [--results N] [--dry-run]
 *   node cli.js suggestions [--status S] [--approve ID...] [--dismiss ID...]
 *   node cli.js push [--to URL] [--output DIR] [--limit N] [--dry-run]
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scrape } from './lib/scrape.js';
import { exportNewsMd } from './lib/export-news.js';
import { summarizeDay } from './lib/summarize.js';
import { loadConfig } from './lib/config.js';
import { readProfiles, mergeSources } from './lib/profiles.js';
import { discover, parseTopics } from './lib/discover.js';
import { listSuggestions, reviewSuggestion, DEFAULT_PROFILE } from './lib/suggestions.js';
import { pushTranscripts, accessHeadersFromEnv } from './lib/push.js';
import { searchSources } from './lib/search-sources.js';

const args = process.argv.slice(2);
const command = args[0];

function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function flagAll(name) {
  const vals = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === name && args[i + 1]) {
      vals.push(args[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  return vals;
}

function hasFlag(name) {
  return args.includes(name);
}

function todayDir(outputDir) {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(outputDir, today);
}

async function main() {
  const configPath = flag('--config') || 'config.yaml';
  const config = await loadConfig(configPath);
  const outputDir = flag('--output') || config.output_dir || './output';
  const model = flag('--model') || config.model || 'ollama';

  switch (command) {
    case 'scrape': {
      const urls = flagAll('--url');
      // Union of base config sources and all profile sources (see lib/profiles.js)
      const sources = mergeSources(config, readProfiles(outputDir));
      const allUrls = [
        ...urls,
        ...(urls.length === 0
          ? [...sources.channels, ...sources.playlists, ...sources.videos, ...searchSources(config)]
          : []),
      ];

      if (allUrls.length === 0) {
        console.error('No URLs provided. Use --url or add channels/playlists/videos to config.yaml');
        process.exit(1);
      }

      const result = await scrape(allUrls, {
        outputDir,
        model,
        sinceHours: parseInt(flag('--since-hours') || config.since_hours || '24', 10),
        limit: parseInt(flag('--limit') || config.limit || '50', 10),
        rescrape: hasFlag('--rescrape'),
        forceCategory: flag('--category') || config.force_category,
        // Config switches for side runs (e.g. config.madden.yaml) that must not
        // spend LLM calls or feed the news pipeline / shared R2 prefix.
        summarize: config.summarize !== false,
        keepSrt: config.keep_srt === true,
      });
      if (result.rateLimited) process.exitCode = 3;

      // Export table-format day files for the news pipeline (trading-platform)
      if (process.env.NEWS_MD_DIR && config.news_export !== false) {
        try {
          const res = await exportNewsMd(outputDir, process.env.NEWS_MD_DIR, { days: 3 });
          console.error(`news-md export: ${res.videos} video(s) across ${res.days} day(s) -> ${process.env.NEWS_MD_DIR}`);
        } catch (err) {
          console.error(`news-md export failed: ${err.message}`);
        }
      }

      // Sync to Cloudflare R2. `rclone sync` mirrors outputDir onto a fixed
      // prefix (and deletes what is not in outputDir), so any run with its own
      // output dir must set r2_sync: false or it would wipe the main data.
      if (!hasFlag('--no-sync') && config.r2_sync !== false) {
        try {
          const remotes = execFileSync('rclone', ['listremotes'], { encoding: 'utf8' });
          if (remotes.includes('r2:')) {
            console.error('syncing to R2...');
            execFileSync('rclone', [
              'sync', outputDir, 'r2:scraper-data/youtube',
              '--exclude', 'seen.json',
              '--exclude', 'profiles.json',
              '--exclude', 'tokens/**',
            ], { stdio: 'inherit' });
          }
        } catch {
          // rclone not installed or r2 not configured — skip silently
        }
      }
      break;
    }

    case 'export-news': {
      const newsDir = flag('--news-dir') || process.env.NEWS_MD_DIR;
      if (!newsDir) {
        console.error('No news dir. Use --news-dir or set NEWS_MD_DIR.');
        process.exit(1);
      }
      const days = hasFlag('--all') ? Infinity : parseInt(flag('--days') || '3', 10);
      const res = await exportNewsMd(outputDir, newsDir, { days });
      console.log(`Exported ${res.videos} video(s) across ${res.days} day(s) -> ${newsDir}`);
      break;
    }

    case 'summarize': {
      const dir = args[1]?.startsWith('-') ? undefined : args[1];
      await summarizeDay(dir || todayDir(outputDir), { model });
      break;
    }

    case 'discover': {
      const topics = parseTopics(config.discover_topics);
      const only = flag('--topic');
      const selected = only ? topics.filter(t => t.name === only) : topics;

      if (topics.length === 0) {
        console.error('No discover_topics in config.yaml. Add entries like:\n\n' +
          'discover_topics:\n  - tech: hands-on gadget reviews with specs and buying advice\n');
        process.exit(1);
      }
      if (selected.length === 0) {
        console.error(`No topic "${only}". Configured: ${topics.map(t => t.name).join(', ')}`);
        process.exit(1);
      }

      // Channels already scraped are never re-proposed — base config + every profile.
      const sources = mergeSources(config, readProfiles(outputDir));
      const res = await discover({
        dataDir: outputDir,
        topics: selected,
        sources: sources.channels,
        model,
        queriesPerTopic: parseInt(flag('--queries') || config.discover_queries_per_topic || '3', 10),
        resultsPerQuery: parseInt(flag('--results') || config.discover_results_per_query || '10', 10),
        minSubscribers: parseInt(flag('--min-subscribers') || config.discover_min_subscribers || '0', 10),
        dryRun: hasFlag('--dry-run'),
      });
      console.log(`\nDone — ${res.suggested} suggestion(s), ${res.rejected} rejected` +
        `${hasFlag('--dry-run') ? ' (dry run — nothing stored)' : ''}.` +
        `\nReview with: node cli.js suggestions`);
      break;
    }

    case 'suggestions': {
      const profile = flag('--profile') || DEFAULT_PROFILE;
      const approve = flagAll('--approve').flatMap(v => v.split(','));
      const dismiss = flagAll('--dismiss').flatMap(v => v.split(','));

      for (const [ids, status] of [[approve, 'approved'], [dismiss, 'dismissed']]) {
        for (const id of ids.map(s => s.trim()).filter(Boolean)) {
          try {
            const entry = reviewSuggestion(outputDir, id, status, { profile });
            console.log(status === 'approved'
              ? `✓ approved ${entry.title} → profile "${profile}" (next scrape includes it)`
              : `– dismissed ${entry.title}`);
          } catch (err) {
            console.error(`✗ ${id}: ${err.message}`);
          }
        }
      }
      if (approve.length || dismiss.length) break;

      const status = flag('--status') === 'all' ? undefined : (flag('--status') || 'suggested');
      const rows = listSuggestions(outputDir, { status, topic: flag('--topic') });
      if (rows.length === 0) {
        console.log(status ? `No ${status} channels.` : 'No channel suggestions yet. Run: node cli.js discover');
        break;
      }
      for (const r of rows) {
        const subs = r.subscribers != null ? `${r.subscribers.toLocaleString()} subs` : 'subs unknown';
        console.log(`\n${r.title}  [${r.topic || 'untopiced'}${status ? '' : ` · ${r.status}`}]`);
        console.log(`  ${r.url}  (${subs}${r.videoCount != null ? `, ${r.videoCount} videos` : ''}${r.lastUpload ? `, last upload ${r.lastUpload.slice(0, 10)}` : ''})`);
        if (r.rationale) console.log(`  ${r.rationale}`);
        console.log(`  approve: node cli.js suggestions --approve ${r.id}`);
      }
      console.log(`\n${rows.length} channel(s).`);
      break;
    }

    case 'push': {
      // Endpoint: --to wins; else $PFE_URL (base) + the PFE ingest path.
      const to = flag('--to') ||
        (process.env.PFE_URL ? new URL('/api/ingest/transcript', process.env.PFE_URL).toString() : '');
      if (!to) {
        console.error('No target. Use --to URL or set PFE_URL.');
        process.exit(1);
      }
      const headers = accessHeadersFromEnv(process.env, 'PFE_INGEST_CLIENT_ID', 'PFE_INGEST_CLIENT_SECRET');
      if (!headers['CF-Access-Client-Id'] && !hasFlag('--no-auth')) {
        console.error('PFE_INGEST_CLIENT_ID / PFE_INGEST_CLIENT_SECRET are not set. ' +
          'Load them from the secret store, or pass --no-auth for an unauthenticated target.');
        process.exit(1);
      }
      console.log(`Pushing ${outputDir} -> ${to}` +
        (headers['CF-Access-Client-Id'] ? ' (with CF Access service token)' : ' (no auth)'));
      try {
        const res = await pushTranscripts({
          outputDir,
          url: to,
          headers,
          limit: parseInt(flag('--limit') || '0', 10),
          dryRun: hasFlag('--dry-run'),
        });
        console.log(`Done. ${res.pushed} ${hasFlag('--dry-run') ? 'would be pushed' : 'pushed'}, ` +
          `${res.skipped} already pushed, ${res.oversize} over the size limit, ${res.pending} left for next run.`);
      } catch (err) {
        console.error(`Push stopped: ${err.message}`);
        console.error('Nothing after this video was sent; the next run resumes from it.');
        process.exit(2);
      }
      break;
    }

    default:
      console.log(`YouTube Scraper

Commands:
  scrape      Fetch, categorize, and summarize YouTube video transcripts
              --url URL        One or more YouTube URLs (or uses config.yaml)
              --since-hours N  Only videos from last N hours (default: 24)
              --limit N        Max videos per source (default: 50)
              --rescrape       Ignore seen ledger, re-process all
              --config PATH    Config file (default: config.yaml)
              --output DIR     Output directory (default: ./output)
              --model M        LLM: ollama|haiku|sonnet|opus (default: ollama)

  summarize   Re-generate summaries for already-scraped videos
              [dayDir]         Directory to summarize (default: today)

  discover    Find NEW channels worth following, judged by the LLM against the
              topics in config.yaml (discover_topics). Needs YOUTUBE_API_KEY.
              --topic NAME     Only this topic (default: all configured)
              --queries N      Search queries per topic (default: 3)
              --results N      Channels per query (default: 10)
              --min-subscribers N  Skip smaller channels (default: 0 = off)
              --dry-run        Judge and print, store nothing

  suggestions Review what discover found
              --status S       suggested (default) | approved | dismissed | all
              --topic NAME     Filter by topic
              --approve ID     Approve channel id(s), comma-separated
              --dismiss ID     Dismiss channel id(s), comma-separated
              --profile NAME   Profile approvals are added to (default: discovered)

  export-news Write _youtube-videos.md day files for the news pipeline
              --news-dir DIR   Destination (default: $NEWS_MD_DIR)
              --days N         Last N day dirs (default: 3)
              --all            All day dirs

  push        POST each scraped video's raw SRT + metadata to a webhook. Needs a
              scrape with keep_srt: true. Resumable: accepted pushes are
              appended to <output>/pushed.jsonl and never re-sent. Stops at the
              first non-2xx.
              --to URL         Endpoint (default: $PFE_URL + /api/ingest/transcript)
              --output DIR     Scrape output dir to read from
              --limit N        Max videos this run (default: all)
              --dry-run        List what would be sent, send nothing
              --no-auth        Allow sending without PFE_INGEST_CLIENT_ID/SECRET
              Auth: CF-Access-Client-Id/-Secret from $PFE_INGEST_CLIENT_ID and
              $PFE_INGEST_CLIENT_SECRET (values are never printed).`);
      break;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
