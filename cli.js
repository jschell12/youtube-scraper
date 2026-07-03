#!/usr/bin/env node

/**
 * YouTube Scraper CLI
 *
 * Usage:
 *   node cli.js scrape [--url URL...] [--config config.yaml] [--since-hours 24] [--limit 50] [--rescrape]
 *   node cli.js summarize [dayDir]
 *   node cli.js tickers [dayDir]
 *   node cli.js run [--config config.yaml]   # scrape + summarize + tickers
 */

import path from 'node:path';
import { scrape } from './lib/scrape.js';
import { summarizeDay } from './lib/summarize.js';
import { extractTickers } from './lib/tickers.js';
import { loadConfig } from './lib/config.js';

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
  const model = flag('--model') || config.model || 'haiku';

  switch (command) {
    case 'scrape': {
      const urls = flagAll('--url');
      const allUrls = [
        ...urls,
        ...(urls.length === 0 ? [...(config.channels || []), ...(config.playlists || []), ...(config.videos || [])] : []),
      ];

      if (allUrls.length === 0) {
        console.error('No URLs provided. Use --url or add channels/playlists/videos to config.yaml');
        process.exit(1);
      }

      await scrape(allUrls, {
        outputDir,
        sinceHours: parseInt(flag('--since-hours') || config.since_hours || '24', 10),
        limit: parseInt(flag('--limit') || '50', 10),
        rescrape: hasFlag('--rescrape'),
      });
      break;
    }

    case 'summarize': {
      const dir = args[1]?.startsWith('-') ? undefined : args[1];
      await summarizeDay(dir || todayDir(outputDir), { model });
      break;
    }

    case 'tickers': {
      const dir = args[1]?.startsWith('-') ? undefined : args[1];
      await extractTickers(dir || todayDir(outputDir), { model });
      break;
    }

    case 'run': {
      // Full pipeline: scrape → summarize → tickers
      const allUrls = [...(config.channels || []), ...(config.playlists || []), ...(config.videos || [])];

      if (allUrls.length === 0) {
        console.error('No URLs in config.yaml. Add channels, playlists, or videos.');
        process.exit(1);
      }

      const { dayDir, totalNew } = await scrape(allUrls, {
        outputDir,
        sinceHours: parseInt(flag('--since-hours') || config.since_hours || '24', 10),
        limit: parseInt(flag('--limit') || '50', 10),
      });

      if (totalNew > 0) {
        await summarizeDay(dayDir, { model });
        await extractTickers(dayDir, { model });
      } else {
        console.log('No new videos — skipping summarization.');
      }
      break;
    }

    default:
      console.log(`YouTube Scraper

Commands:
  scrape      Fetch transcripts from YouTube
              --url URL        One or more YouTube URLs (or uses config.yaml)
              --since-hours N  Only videos from last N hours (default: 24)
              --limit N        Max videos per source (default: 50)
              --rescrape       Ignore seen ledger, re-process all
              --config PATH    Config file (default: config.yaml)
              --output DIR     Output directory (default: ./output)

  summarize   Generate daily briefing from scraped videos
              [dayDir]         Directory to summarize (default: today)

  tickers     Extract stock/ETF mentions from scraped videos
              [dayDir]         Directory to process (default: today)

  run         Full pipeline: scrape + summarize + tickers
              Uses config.yaml for sources

  --model M   Claude model: haiku|sonnet|opus (default: haiku)`);
      break;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
