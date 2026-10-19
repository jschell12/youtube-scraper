# Status

## 2026-10-19

### Completed
- PR #25: `transcript_source: brightdata | ytdlp`. The Madden config buys transcripts from BrightData's managed YouTube scraper (dataset `gd_lk56epmy2i5g7lzu0k`). Discovery is Data API only, search sources go through `search.list`, there is one capped trigger per run (`brightdata_max_records`, default 50), snapshot ids go in `brightdata-pending.json`, misses are bounded in `brightdata-attempts.json` (3, or one `dead_page`), and any BrightData error exits 4 with no retry. Kurt Benkert is the first Madden channel. Tests: 40 pass over responses recorded 2026-10-19.
- Measured 2026-10-19, read-only: progress of snapshot `sd_mvfl47b4i0700m0pb` was `ready`, 3 records, 0 errors. The bulk run's first 100-video snapshot `sd_mvfm460c1mgwbewzgj` had 99 rows with cues and 1 `dead_page` row. Data API `playlistItems` on `UUBJb4FwDLbfJzArYeM42Qiw` returned 3 uploads that day. `search` for "Madden 27 how to beat the Bills" returned 3 video ids.

### In progress
- PR #25 is open and waiting on review. This repo has no reviewer session and no auto-merge. It merges cleanly with #24 in either order (the merged tree passes 45/45).

### Blockers
- The job that runs `config.madden.yaml` needs `BRIGHTDATA_API_KEY` in its environment before the next run, and `YOUTUBE_API_KEY` is now required. Without them the run exits 1 before any request and spends nothing.

### Next steps
- Once both #24 and #25 have landed, retitle the old "12 channels" config test.
- After the first scheduled brightdata run, check exit code, records bought, `brightdata-attempts.json`, and whether the pushes reached PFE.

## 2026-10-08

### Completed
- Madden captions feed for play-formation-engine: `config.madden.yaml` (12 channels + rotating team-counter searches, <= 10/day), `search_*` config sources, `cli.js push` with append-only `pushed.jsonl`, LLM/news/R2 switches, 429 stops the scrape. First test suite (`npm test`, node:test).

### In progress
- schellout `youtube-madden` Nomad job (separate PR) runs it daily.

### Blockers
- PFE ingest token must be placed on the mini before pushes succeed.

### Next steps
- After first run, check `~/data/youtube-madden/pushed.jsonl` and the job log for 429s.

## 2026-08-06

### Completed
- **YouTube Data API v3 discovery** (PR #13, merged + deployed): new `lib/youtube-api.js` resolves channel URLs (`@handle`, `/channel/`, `/user/`, playlists) to uploads playlists and lists recent videos via `playlistItems` (1-2 quota units/page). When `YOUTUBE_API_KEY` is set, ledger-seen videos are filtered **before** yt-dlp runs — yt-dlp only fetches transcripts for new videos. Falls back to yt-dlp listing on missing key, non-discoverable URLs, or API errors.
- **API key provisioned**: created in Google Cloud Console (restricted to YouTube Data API v3), stored in scredmanager as `YOUTUBE_API_KEY`, live-verified (HTTP 200).
- **Deployed to mac-mini**: `~/youtube-scraper` clone pulled to `f8dbedb`; key written to `~/.agentsecrets.d/youtube-scraper` (new file, mode 600, sourced by the Nomad job via `source-secrets`). Prod-path verified on the mini: key present, live discovery returned videos.

### In progress
- Nothing — next scheduled Nomad run will use API discovery automatically (look for `API discovery: N in window, M new` in job logs).

### Blockers
- None

### Next steps
- Watch the next Nomad run's logs to confirm API discovery + quota behavior in prod
- Consider extending API discovery to OAuth profile subscription sources (currently only config.yaml channels/playlists benefit)

## 2026-07-28

### Completed
- Per-profile YouTube subscriptions via Google OAuth (PR #9): connect a Google account per profile, pull subscribed channels as scrape sources
- Profile-based source config with API endpoints (PR #8): profiles replace flat source lists, CRUD via REST API
- Video publish date support in API (PR #6)
- Switched LLM calls from Claude CLI to Ollama (mistral-small:24b) for classification and summarization; Ollama is now the default (PR #7)

### Blockers
- None

### Next steps
- Populate profiles with subscriptions from connected accounts
- Monitor Ollama classification/summarization quality vs prior Claude output

## 2026-07-15

### Completed
- Multi-dimensional classification: lib/taxonomy.js (143 kinds, 14 domains), lib/classify.js (Claude CLI JSON), backward-compatible categorize.js wrapper
- Classification JSON persisted as _classify-<id>.json alongside transcripts, synced to R2
- API serves classification on video detail, primaryKind/domain on list, supports ?kind= and ?domain= filters
- Summary templates rewritten per user preferences: exact prices/specs/timestamps/where-to-buy (product), grocery list by section/nutrition/equipment (cooking), Robinhood links/bull-bear/options table (financial), tools table with versions (tech), source attribution/timeline (news), routine table/supplements/citations (health), budget breakdown/skip list (travel), score+pros-cons/build table (gaming)
- Claude CLI auth fix: env prepends /opt/homebrew/bin, strips ANTHROPIC_API_KEY
- Ledger stores primaryKind, domain, topics, entities
- Full rescrape: 49 videos classified with sonnet across 17 kinds, all summaries regenerated

### Blockers
- None

### Next steps
- Add more channels to config.yaml
- Template refinements as new video types are encountered

## 2026-07-03

### Completed
- Project scaffolding, yt-dlp extraction, 16-category classification, structured summaries
- REST API, CLI, config-based scraping, Dockerfile, k8s manifests
