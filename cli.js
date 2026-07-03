#!/usr/bin/env node

/**
 * YouTube Scraper CLI
 *
 * Usage:
 *   node cli.js scrape [--url URL...] [--config config.yaml] [--since-hours 24] [--limit 50] [--rescrape]
 */

import { scrape } from './lib/scrape.js';
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
        model,
        sinceHours: parseInt(flag('--since-hours') || config.since_hours || '24', 10),
        limit: parseInt(flag('--limit') || '50', 10),
        rescrape: hasFlag('--rescrape'),
      });
      break;
    }

    default:
      console.log(`YouTube Scraper

Commands:
  scrape      Fetch and categorize YouTube video transcripts
              --url URL        One or more YouTube URLs (or uses config.yaml)
              --since-hours N  Only videos from last N hours (default: 24)
              --limit N        Max videos per source (default: 50)
              --rescrape       Ignore seen ledger, re-process all
              --config PATH    Config file (default: config.yaml)
              --output DIR     Output directory (default: ./output)
              --model M        Claude model for categorization: haiku|sonnet|opus (default: haiku)`);
      break;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
