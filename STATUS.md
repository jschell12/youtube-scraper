# Status

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
