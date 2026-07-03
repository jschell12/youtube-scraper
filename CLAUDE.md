# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Standalone YouTube scraper that extracts transcripts via yt-dlp and categorizes them with Claude CLI. Each video is classified into a content category during scraping.

## Commands

```bash
make install                          # Ensure yt-dlp is installed
node cli.js scrape --url URL          # Scrape, categorize, and summarize
node cli.js scrape                    # Scrape all sources from config.yaml
node cli.js scrape --rescrape         # Re-process already-seen videos
node cli.js summarize [dayDir]        # Re-generate summaries for existing transcripts
```

## Architecture

- `cli.js` — Entry point, arg parsing
- `lib/extract.js` — yt-dlp wrapper: fetch metadata + transcripts, parse SRT
- `lib/scrape.js` — Orchestrator: iterates URLs, categorizes, summarizes, writes markdown, updates ledger
- `lib/categorize.js` — Classifies videos into categories via Claude CLI
- `lib/summarize.js` — Category-specific structured summaries via Claude CLI (16 templates)
- `lib/ledger.js` — seen.json dedup (video ID → metadata + category, incremental persistence)
- `lib/claude.js` — Claude CLI wrapper (`claude -p`)
- `lib/config.js` — Simple YAML parser for config.yaml
- `config.yaml` — User config: channels, playlists, videos, output_dir, model
- `mcp/server.mjs` — MCP server (stdio) exposing 6 tools for Claude Code / Claude Desktop
- `api/server.mjs` — REST API server (Express, port 3330)

## Categories

Videos are classified into one of: `informational`, `financial`, `product-review`, `travel`, `entertainment`, `news`, `gaming`, `tech`, `health-fitness`, `cooking`, `diy-crafts`, `sports`, `science`, `business`, `music`, `other`.

## Output Structure

```
output/
  seen.json                          # Dedup ledger (persists across days)
  2026-07-03/
    <videoId>-<slug>.md              # Transcript (title + metadata + category + full text)
    _summary-<videoId>-<slug>.md     # Structured summary (tables, key advice, verdict)
```

## MCP Server

Stdio-based MCP server at `mcp/server.mjs` with 6 tools:

| Tool | Purpose |
|------|---------|
| `scrape_youtube` | Scrape videos from a URL or config.yaml |
| `search_videos` | Keyword search across scraped transcripts |
| `list_videos` | List videos by date/category |
| `get_video_summary` | Get structured summary for a video ID |
| `list_categories` | Category counts |
| `list_days` | Date listing with video counts |

Run with: `node mcp/server.mjs` or `npm run mcp`

## Dependencies

- **yt-dlp** (system): `pip install yt-dlp` or `brew install yt-dlp`
- **claude** (system): Claude CLI for categorization and summarization
- **@modelcontextprotocol/sdk**: MCP server framework
- **express**: REST API server
- **Node.js >=18**
