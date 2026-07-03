# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Standalone YouTube scraper that extracts transcripts via yt-dlp and categorizes them with Claude CLI. Each video is classified into a content category during scraping.

## Commands

```bash
make install                          # Ensure yt-dlp is installed
node cli.js scrape --url URL          # Scrape single video/channel/playlist
node cli.js scrape                    # Scrape all sources from config.yaml
node cli.js scrape --rescrape         # Re-process already-seen videos
```

## Architecture

- `cli.js` — Entry point, arg parsing
- `lib/extract.js` — yt-dlp wrapper: fetch metadata + transcripts, parse SRT
- `lib/scrape.js` — Orchestrator: iterates URLs, categorizes, writes markdown, updates ledger
- `lib/categorize.js` — Classifies videos into categories via Claude CLI
- `lib/ledger.js` — seen.json dedup (video ID → metadata + category, incremental persistence)
- `lib/claude.js` — Claude CLI wrapper (`claude -p`)
- `lib/config.js` — Simple YAML parser for config.yaml
- `config.yaml` — User config: channels, playlists, videos, output_dir, model

## Categories

Videos are classified into one of: `informational`, `financial`, `product-review`, `travel`, `entertainment`, `news`, `gaming`, `tech`, `health-fitness`, `cooking`, `diy-crafts`, `sports`, `science`, `business`, `music`, `other`.

## Output Structure

```
output/
  seen.json                     # Dedup ledger (persists across days)
  2026-07-03/
    <videoId>-<slug>.md          # One file per video (title + metadata + category + transcript)
```

## Dependencies

- **yt-dlp** (system): `pip install yt-dlp` or `brew install yt-dlp`
- **claude** (system): Claude CLI for categorization
- **Node.js >=18**: No npm dependencies — uses only built-in modules
