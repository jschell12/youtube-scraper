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

# Re-generate summaries for today's videos
node cli.js summarize
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

## Channel Discovery

`scrape` finds new videos on channels you already follow. `discover` finds the
channels themselves: it searches YouTube per topic, judges each candidate with
the LLM, and queues the keepers for you to review.

Describe what you want in `config.yaml` — the description is the standard the
judge holds candidates to, so write it the way you would brief a person:

```yaml
discover_topics:
  - tech: hands-on consumer tech reviews with specs, benchmarks, and buying advice
  - cooking: recipe tutorials and technique explainers with real measurements

discover_queries_per_topic: 3
discover_results_per_query: 10
discover_min_subscribers: 0      # skip smaller channels before spending a judge call
```

```bash
export YOUTUBE_API_KEY=...              # Data API v3 — required
node cli.js discover                    # all topics
node cli.js discover --topic tech       # one topic
node cli.js discover --dry-run          # judge and print, store nothing

node cli.js suggestions                 # review the queue
node cli.js suggestions --approve UC... # → profile "discovered"; next scrape includes it
node cli.js suggestions --dismiss UC... # never suggested again
```

Approving writes the channel URL into a profile (`discovered` by default, or
`--profile NAME`), which is how it enters the next scrape — see
`output/profiles.json`. Suggestions live in `output/suggestions.json`, and every
channel is proposed at most once: ids already stored, already approved, already
dismissed, or already in your sources are skipped on later runs.

**The judge fails closed.** Elsewhere an LLM hiccup costs a summary you can
regenerate; here it would put junk in a queue you have to clear by hand, and a
good channel missed today turns up on the next run. An unusable verdict is a
rejection.

**Quota**: `search.list` costs 100 units of the free 10,000/day, so each topic
runs about 300 units at the default 3 queries. Everything else in the pipeline
(`channels.list`, `playlistItems.list`) costs 1 unit per call.

### Driving discovery from another app

An app with its own review queue can borrow the scout and keep the results:
pass `known` (the ids/handles/titles it already has) and a `sink`, and
`suggestions.json` is never touched. A topic may also carry `labels`, which makes
the judge file each accepted channel into one of them.

```js
import { discover } from './lib/discover.js';

await discover({
  topics: [{
    name: 'cruise',
    about: 'cruise vacations: itinerary planning, cabin picks, dining, excursions, pricing',
    labels: [{ name: 'dcl', description: 'Disney Cruise Line' }, { name: 'other', description: 'other lines' }],
    defaultLabel: 'other',
  }],
  known: { ids: myChannelIds, handles: myHandles, titles: myTitles },
  sink: async ({ channel, topic, verdict }) => postToMyApi(channel, topic, verdict),  // → true if stored
});
```

A sink that throws costs that one channel, not the run; one that returns `false`
(the app already had it) is not counted as a suggestion.
[trip-wizard](https://github.com/jschell12/trip-wizard) uses this to file
candidates in its own database and review them in its admin UI.

## Output

Each video produces two files in `output/<date>/`:
- `<videoId>-<slug>.md` — transcript with metadata and category
- `_summary-<videoId>-<slug>.md` — structured summary with tables tailored to the category (e.g., product comparisons for reviews, ticker tables for financial, recipe steps for cooking)
