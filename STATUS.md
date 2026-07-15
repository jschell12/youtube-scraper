# Status

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
