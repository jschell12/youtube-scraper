# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Standalone YouTube scraper that extracts transcripts via yt-dlp and summarizes them with Claude CLI. Modeled after the news-scraper project's pipeline pattern (scrape → persist → summarize → extract tickers).

## Commands

```bash
make install                    # Ensure yt-dlp is installed
node cli.js scrape --url URL    # Scrape single video/channel/playlist
node cli.js run                 # Full pipeline from config.yaml
node cli.js summarize           # Summarize today's scraped videos
node cli.js tickers             # Extract stock/ETF mentions
```

## Architecture

- `cli.js` — Entry point, arg parsing, routes to subcommands
- `lib/extract.js` — yt-dlp wrapper: fetch metadata + transcripts, parse SRT
- `lib/scrape.js` — Orchestrator: iterates URLs, writes markdown, updates ledger
- `lib/summarize.js` — Batches transcripts → Claude CLI → daily briefing markdown
- `lib/tickers.js` — Batches transcripts → Claude CLI → stock/ETF extraction markdown
- `lib/ledger.js` — seen.json dedup (video ID → metadata, incremental persistence)
- `lib/claude.js` — Claude CLI wrapper (`claude -p`)
- `lib/config.js` — Simple YAML parser for config.yaml
- `config.yaml` — User config: channels, playlists, videos, output_dir, model

## Output Structure

```
output/
  seen.json                     # Dedup ledger (persists across days)
  2026-07-03/
    <videoId>-<slug>.md          # One file per video (title + metadata + transcript)
    _daily-summary.md            # Claude-generated briefing
    _daily-summary.prev.md       # Previous run (for diffing)
    _market.md                   # Ticker extraction tables
    _market.prev.md
```

## Dependencies

- **yt-dlp** (system): `pip install yt-dlp` or `brew install yt-dlp`
- **claude** (system): Claude CLI for summarization
- **Node.js >=18**: No npm dependencies — uses only built-in modules
