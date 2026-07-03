## 2026-07-03

**Completed:**
- Project scaffolding (zero npm deps initially, now express for API)
- yt-dlp transcript extraction (single video, channel, playlist) with SRT parsing and dedup
- 16-category classification via Claude CLI (informational, financial, product-review, tech, etc.)
- Category-aware structured summaries with tailored templates per category (comparison tables for reviews, ticker tables for financial, recipe steps for cooking, etc.)
- Dedup ledger with incremental persistence (seen.json)
- CLI with scrape + summarize commands
- Config-based channel scraping (MKBHD, CNBC, Fireship, Josh Strife Hayes)
- REST API server (Express), Docker, and Kubernetes manifests
- Private GitHub repo created and pushed
- Full scrape tested: 6 videos across 3 channels, all categorized and summarized correctly

**In progress:** None

**Blockers:** None

**Next steps:**
- Add more YouTube channels/playlists to config.yaml
- Consider LaunchAgent for scheduled scraping on Mac Mini (like news-scraper)
- Consider notification support (email/Matrix)
- Fix Babish Culinary Universe channel URL (404)
- Update CLAUDE.md and README.md to document API server and k8s
