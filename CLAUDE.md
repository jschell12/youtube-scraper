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
node cli.js discover                  # Find NEW channels to follow (LLM-judged)
node cli.js suggestions               # Review what discover found
node cli.js suggestions --approve ID  # Approve -> profile "discovered" -> next scrape
```

## Architecture

- `cli.js` — Entry point, arg parsing
- `lib/extract.js` — yt-dlp wrapper: fetch metadata + transcripts, parse SRT
- `lib/youtube-api.js` — Data API v3 discovery: when `YOUTUBE_API_KEY` is set, channel/playlist listing goes through the API and ledger-seen videos are skipped before yt-dlp runs (yt-dlp then only fetches transcripts for new videos); falls back to yt-dlp listing on any API failure or missing key
- `lib/scrape.js` — Orchestrator: iterates URLs, categorizes, summarizes, writes markdown, updates ledger
- `lib/categorize.js` — Classifies videos into categories via Claude CLI
- `lib/summarize.js` — Category-specific structured summaries via Claude CLI (16 templates)
- `lib/ledger.js` — seen.json dedup (video ID → metadata + category, incremental persistence)
- `lib/discover.js` — channel discovery: per-topic search → enrich → LLM judge (fails **closed**, unlike the summarizer) → suggestion queue
- `lib/suggestions.js` — suggestions.json store (suggested/approved/dismissed); approving appends the channel to a profile, which is what puts it in the next scrape
- `lib/claude.js` — Claude CLI wrapper (`claude -p`)
- `lib/config.js` — Simple YAML parser for config.yaml
- `config.yaml` — User config: channels, playlists, videos, output_dir, model
- `mcp/server.mjs` — MCP server (stdio) exposing 6 tools for Claude Code / Claude Desktop
- `api/server.mjs` — REST API server (Express, port 3330)

## Categories

Videos are classified into one of: `informational`, `financial`, `product-review`, `travel`, `entertainment`, `news`, `gaming`, `tech`, `health-fitness`, `cooking`, `diy-crafts`, `sports`, `science`, `business`, `music`, `other`.

## Channel Discovery

`scrape` finds new videos on known channels; `discover` finds new channels. Topics
come from `config.yaml` (`discover_topics:` entries are `"name: what you want"`, and
that description is the standard the judge applies). Keepers land in
`output/suggestions.json`; approving one appends its URL to a profile so the next
scrape includes it. A channel is proposed at most once — reviewed ids are never
revived. `search.list` costs 100 quota units, so ~300 per topic per run.

## Output Structure

```
output/
  seen.json                          # Dedup ledger (persists across days)
  suggestions.json                   # Channel discovery queue (suggested/approved/dismissed)
  2026-07-03/
    <videoId>-<slug>.md              # Transcript (title + metadata + category + full text)
    _summary-<videoId>-<slug>.md     # Structured summary (tables, key advice, verdict)
```

## MCP Server

Stdio-based MCP server at `mcp/server.mjs` with 9 tools:

| Tool | Purpose |
|------|---------|
| `scrape_youtube` | Scrape videos from a URL or config.yaml |
| `search_videos` | Keyword search across scraped transcripts |
| `list_videos` | List videos by date/category |
| `get_video_summary` | Get structured summary for a video ID |
| `list_categories` | Category counts |
| `list_days` | Date listing with video counts |
| `discover_channels` | Find new channels to follow (needs `YOUTUBE_API_KEY`) |
| `list_channel_suggestions` | Review what discovery proposed |
| `review_channel_suggestion` | Approve (→ scrape profile) or dismiss one |

Run with: `node mcp/server.mjs` or `npm run mcp`

## Dependencies

- **yt-dlp** (system): `pip install yt-dlp` or `brew install yt-dlp`
- **claude** (system): Claude CLI for categorization and summarization
- **@modelcontextprotocol/sdk**: MCP server framework
- **express**: REST API server
- **Node.js >=18**
