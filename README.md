# youtube-scraper

Scrape YouTube video transcripts and summarize them with Claude. Extracts daily briefings and stock/ETF mentions.

## Prerequisites

- Node.js >= 18
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): `pip install yt-dlp` or `brew install yt-dlp`
- [Claude CLI](https://claude.ai/code) (for summarization)

## Quick Start

```bash
make install

# Scrape a single video
node cli.js scrape --url "https://www.youtube.com/watch?v=VIDEO_ID"

# Scrape a channel (last 24 hours)
node cli.js scrape --url "https://www.youtube.com/@ChannelName"

# Summarize today's videos
node cli.js summarize

# Extract tickers
node cli.js tickers
```

## Config-Based Pipeline

Edit `config.yaml` to add your sources, then run the full pipeline:

```yaml
channels:
  - https://www.youtube.com/@BloombergTelevision
  - https://www.youtube.com/@CNBCtelevision

playlists:
  - https://www.youtube.com/playlist?list=PLxxxxxxx

since_hours: 24
model: haiku
```

```bash
node cli.js run   # scrape + summarize + tickers
```

## Output

Videos are saved as markdown in `output/<date>/` with transcript text. Summaries and market extractions are prefixed with `_`.
