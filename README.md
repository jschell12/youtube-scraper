# youtube-scraper

Scrape YouTube video transcripts and automatically categorize them with Claude.

## Prerequisites

- Node.js >= 18
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): `pip install yt-dlp` or `brew install yt-dlp`
- [Claude CLI](https://claude.ai/code) (for categorization)

## Quick Start

```bash
make install

# Scrape a single video
node cli.js scrape --url "https://www.youtube.com/watch?v=VIDEO_ID"

# Scrape a channel (last 24 hours)
node cli.js scrape --url "https://www.youtube.com/@ChannelName"

# Re-process already-seen videos
node cli.js scrape --url "URL" --rescrape
```

## Config-Based Scraping

Edit `config.yaml` to add your sources:

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
node cli.js scrape
```

## Categories

Each video is automatically classified into one of:

| Category | Examples |
|----------|----------|
| `informational` | how-to, explainer, educational, tutorial |
| `financial` | market analysis, investing, stock picks, crypto |
| `product-review` | reviews, comparisons, unboxings, buying guides |
| `travel` | travel vlogs, destination guides, hotel/flight reviews |
| `entertainment` | comedy, vlogs, pranks, challenges |
| `news` | current events, politics, journalism |
| `gaming` | gameplay, game reviews, esports, walkthroughs |
| `tech` | software, hardware, programming, AI |
| `health-fitness` | workouts, nutrition, mental health |
| `cooking` | recipes, restaurant reviews, food science |
| `diy-crafts` | home improvement, woodworking, art, maker |
| `sports` | highlights, analysis, training |
| `science` | research, experiments, space, nature, docs |
| `business` | entrepreneurship, marketing, career advice |
| `music` | performances, production, instrument tutorials |
| `other` | anything else |

## Output

Videos are saved as markdown in `output/<date>/` with transcript text and category metadata.
