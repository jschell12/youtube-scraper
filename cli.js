#!/usr/bin/env node

/**
 * YouTube Scraper CLI
 *
 * Usage:
 *   node cli.js scrape [--url URL...] [--config config.yaml] [--since-hours 24] [--limit 50] [--rescrape]
 *   node cli.js summarize [dayDir]
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scrape } from './lib/scrape.js';
import { summarizeDay } from './lib/summarize.js';
import { loadConfig } from './lib/config.js';
import { readProfiles, mergeSources } from './lib/profiles.js';

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
        ...(urls.length === 0 ? [...sources.channels, ...sources.playlists, ...sources.videos] : []),
      ];

      if (allUrls.length === 0) {
        console.error('No URLs provided. Use --url or add channels/playlists/videos to config.yaml');
        process.exit(1);
      }

      await scrape(allUrls, {
        outputDir,
        model,
        sinceHours: parseInt(flag('--since-hours') || config.since_hours || '24', 10),
        limit: parseInt(flag('--limit') || '50', 10),
        rescrape: hasFlag('--rescrape'),
      });

      // Sync to Cloudflare R2
      if (!hasFlag('--no-sync')) {
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

    case 'summarize': {
      const dir = args[1]?.startsWith('-') ? undefined : args[1];
      await summarizeDay(dir || todayDir(outputDir), { model });
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
              [dayDir]         Directory to summarize (default: today)`);
      break;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
