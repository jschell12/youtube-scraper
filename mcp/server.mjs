/**
 * YouTube Scraper MCP Server
 *
 * Exposes scraped video data as Model Context Protocol tools
 * for use in Claude Code, Claude Desktop, and other MCP clients.
 *
 * Tools:
 *   scrape_youtube        — Scrape videos from URLs or config.yaml
 *   search_videos         — Search previously scraped videos by topic
 *   list_videos           — List scraped videos (optionally by date/category)
 *   get_video_summary     — Get the structured summary for a specific video
 *   list_categories       — List all available content categories
 *   list_days             — List all dates with scraped content
 *   discover_channels     — Find new channels to follow (LLM-judged)
 *   list_channel_suggestions — Review what discovery found
 *   review_channel_suggestion — Approve (adds to a scrape profile) or dismiss
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSuggestions, reviewSuggestion, DEFAULT_PROFILE } from '../lib/suggestions.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUTPUT_DIR = process.env.YOUTUBE_OUTPUT_DIR || path.join(REPO, 'output');

// ── Helpers ─────────────────────────────────────────────────────────────

async function runCli(args, { timeout = 600_000 } = {}) {
  const { stdout, stderr } = await execFileP('node', [path.join(REPO, 'cli.js'), ...args], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    env: { ...process.env, YOUTUBE_OUTPUT_DIR: OUTPUT_DIR },
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

function toolError(message) {
  return { content: [{ type: 'text', text: 'ERROR: ' + message }], isError: true };
}

function toolResult(text) {
  return { content: [{ type: 'text', text }] };
}

async function loadLedger() {
  const ledgerPath = path.join(OUTPUT_DIR, 'seen.json');
  if (!existsSync(ledgerPath)) return {};
  return JSON.parse(await readFile(ledgerPath, 'utf8'));
}

async function listDayDirs() {
  if (!existsSync(OUTPUT_DIR)) return [];
  const entries = await readdir(OUTPUT_DIR);
  return entries.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort().reverse();
}

async function readVideoFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const title = content.split('\n')[0]?.replace(/^#\s*/, '') || '';
  const categoryMatch = content.match(/^\- \*\*Category\*\*:\s*(.+)$/m);
  const channelMatch = content.match(/^\- \*\*Channel\*\*:\s*(.+)$/m);
  const dateMatch = content.match(/^\- \*\*Date\*\*:\s*(.+)$/m);
  const urlMatch = content.match(/^\- \*\*URL\*\*:\s*(.+)$/m);
  const durationMatch = content.match(/^\- \*\*Duration\*\*:\s*(.+)$/m);

  const transcriptIdx = content.indexOf('## Transcript');
  const transcript = transcriptIdx >= 0
    ? content.slice(transcriptIdx + '## Transcript'.length).trim()
    : '';

  return {
    title,
    channel: channelMatch?.[1]?.trim() || '',
    category: categoryMatch?.[1]?.trim() || 'other',
    date: dateMatch?.[1]?.trim() || '',
    duration: durationMatch?.[1]?.trim() || '',
    url: urlMatch?.[1]?.trim() || '',
    transcript,
  };
}

// ── Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'scrape_youtube',
    description: 'Scrape YouTube videos. Fetches transcripts, categorizes, and generates structured summaries. Can scrape a specific URL or all channels/playlists in config.yaml. Each video takes ~30-60s (transcript download + Claude categorization + summary).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'YouTube video, channel, or playlist URL. If omitted, scrapes all sources from config.yaml.',
        },
        since_hours: {
          type: 'number',
          description: 'Only fetch videos from the last N hours (default: 48). Ignored for single video URLs.',
        },
        limit: {
          type: 'number',
          description: 'Max videos per source (default: 5).',
        },
        rescrape: {
          type: 'boolean',
          description: 'Re-process already-seen videos (default: false).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_videos',
    description: 'Search previously scraped YouTube videos by keyword. Searches titles, channels, categories, and transcript text. Returns matching videos with snippets. No network access needed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords to find in titles, channels, transcripts).',
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "product-review", "financial", "tech").',
        },
        days: {
          type: 'number',
          description: 'Only search videos from the last N days (default: 7).',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_videos',
    description: 'List all scraped videos, optionally filtered by date or category. Returns video ID, title, channel, category, and date.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Filter by date (YYYY-MM-DD). If omitted, lists all dates.',
        },
        category: {
          type: 'string',
          description: 'Filter by category.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_video_summary',
    description: 'Get the structured summary for a specific video by its YouTube video ID. Returns the category-specific summary (comparison tables for reviews, ticker tables for financial, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: {
          type: 'string',
          description: 'YouTube video ID (e.g., "DHuVm_ol2mo").',
        },
      },
      required: ['video_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_categories',
    description: 'List all available content categories and how many videos are in each.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_days',
    description: 'List all dates that have scraped content, with video counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'discover_channels',
    description: 'Find NEW YouTube channels worth following (not new videos on known ones). Searches per topic from config.yaml, judges each candidate with the LLM, and stores keepers for review. Needs YOUTUBE_API_KEY; each topic costs ~300 YouTube quota units and takes a minute or two.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Only search this configured topic. If omitted, all topics in config.yaml run.',
        },
        queries: {
          type: 'number',
          description: 'Search queries per topic (default: 3). Each costs 100 YouTube quota units.',
        },
        results: {
          type: 'number',
          description: 'Channels per query (default: 10).',
        },
        min_subscribers: {
          type: 'number',
          description: 'Skip channels below this subscriber count before judging (default: 0 = off).',
        },
        dry_run: {
          type: 'boolean',
          description: 'Judge and report without storing anything (default: false).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_channel_suggestions',
    description: 'List channels that discovery proposed, with the reason each was accepted. No network access needed.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['suggested', 'approved', 'dismissed', 'all'],
          description: 'Which channels to list (default: suggested).',
        },
        topic: {
          type: 'string',
          description: 'Filter by the topic that found the channel.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'review_channel_suggestion',
    description: 'Approve or dismiss a suggested channel. Approving adds it to a scrape profile so the next scrape includes it; dismissing keeps it out of future discovery runs. Both are permanent — a reviewed channel is never proposed again.',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'The UC… channel id from list_channel_suggestions.',
        },
        decision: {
          type: 'string',
          enum: ['approve', 'dismiss'],
          description: 'What to do with it.',
        },
        profile: {
          type: 'string',
          description: 'Profile approvals are added to (default: "discovered").',
        },
      },
      required: ['channel_id', 'decision'],
      additionalProperties: false,
    },
  },
];

// ── Tool Handlers ───────────────────────────────────────────────────────

async function handleScrapeYoutube(args) {
  const flags = ['scrape'];
  if (args.url) {
    flags.push('--url', args.url);
  }
  flags.push('--since-hours', String(args.since_hours || 48));
  flags.push('--limit', String(args.limit || 5));
  if (args.rescrape) flags.push('--rescrape');

  try {
    const { stdout, stderr } = await runCli(flags, { timeout: 600_000 });
    return toolResult(stdout + (stderr ? '\n' + stderr : ''));
  } catch (err) {
    return toolError(`Scrape failed: ${err.message}`);
  }
}

async function handleSearchVideos(args) {
  const { query, category, days = 7, limit = 10 } = args;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const dayDirs = (await listDayDirs()).filter(d => d >= cutoff);

  const results = [];

  for (const day of dayDirs) {
    const dayPath = path.join(OUTPUT_DIR, day);
    const files = (await readdir(dayPath)).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const f of files) {
      const video = await readVideoFile(path.join(dayPath, f));

      if (category && video.category !== category) continue;

      const queryLower = query.toLowerCase();
      const searchable = `${video.title} ${video.channel} ${video.category} ${video.transcript}`.toLowerCase();

      if (!searchable.includes(queryLower)) continue;

      // Extract snippet around match
      const idx = video.transcript.toLowerCase().indexOf(queryLower);
      let snippet = '';
      if (idx >= 0) {
        const start = Math.max(0, idx - 100);
        const end = Math.min(video.transcript.length, idx + query.length + 100);
        snippet = (start > 0 ? '...' : '') + video.transcript.slice(start, end) + (end < video.transcript.length ? '...' : '');
      }

      const videoId = f.split('-')[0];
      results.push({
        video_id: videoId,
        title: video.title,
        channel: video.channel,
        category: video.category,
        date: video.date || day,
        url: video.url,
        snippet,
      });

      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  if (results.length === 0) {
    return toolResult(`No videos found matching "${query}"${category ? ` in category "${category}"` : ''} within the last ${days} days.`);
  }

  const lines = [`Found ${results.length} video(s) matching "${query}":\n`];
  for (const r of results) {
    lines.push(`**${r.title}** (${r.channel})`);
    lines.push(`  ID: ${r.video_id} | Category: ${r.category} | Date: ${r.date}`);
    lines.push(`  URL: ${r.url}`);
    if (r.snippet) lines.push(`  Snippet: ${r.snippet}`);
    lines.push('');
  }

  return toolResult(lines.join('\n'));
}

async function handleListVideos(args) {
  const { date, category } = args;
  const dayDirs = date ? [date] : await listDayDirs();

  const videos = [];

  for (const day of dayDirs) {
    const dayPath = path.join(OUTPUT_DIR, day);
    if (!existsSync(dayPath)) continue;

    const files = (await readdir(dayPath)).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const f of files) {
      const video = await readVideoFile(path.join(dayPath, f));
      if (category && video.category !== category) continue;

      const videoId = f.split('-')[0];
      videos.push({
        video_id: videoId,
        title: video.title,
        channel: video.channel,
        category: video.category,
        date: video.date || day,
      });
    }
  }

  if (videos.length === 0) {
    return toolResult('No videos found.');
  }

  const lines = [`${videos.length} video(s):\n`];
  lines.push('| ID | Title | Channel | Category | Date |');
  lines.push('|----|-------|---------|----------|------|');
  for (const v of videos) {
    lines.push(`| ${v.video_id} | ${v.title} | ${v.channel} | ${v.category} | ${v.date} |`);
  }

  return toolResult(lines.join('\n'));
}

async function handleGetVideoSummary(args) {
  const { video_id } = args;
  const dayDirs = await listDayDirs();

  for (const day of dayDirs) {
    const dayPath = path.join(OUTPUT_DIR, day);
    const files = await readdir(dayPath);

    // Find summary file for this video ID
    const summaryFile = files.find(f => f.startsWith(`_summary-${video_id}`));
    if (summaryFile) {
      const content = await readFile(path.join(dayPath, summaryFile), 'utf8');
      return toolResult(content);
    }

    // Check if transcript exists but no summary
    const transcriptFile = files.find(f => f.startsWith(video_id) && !f.startsWith('_'));
    if (transcriptFile) {
      return toolResult(`Video ${video_id} found but has no summary yet. Run \`node cli.js summarize\` to generate it.`);
    }
  }

  return toolError(`No video found with ID "${video_id}".`);
}

async function handleListCategories() {
  const ledger = await loadLedger();
  const counts = {};
  for (const entry of Object.values(ledger)) {
    const cat = entry.category || 'other';
    counts[cat] = (counts[cat] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return toolResult('No videos scraped yet.');
  }

  const lines = ['| Category | Count |', '|----------|-------|'];
  for (const [cat, count] of sorted) {
    lines.push(`| ${cat} | ${count} |`);
  }
  lines.push(`\nTotal: ${Object.values(counts).reduce((a, b) => a + b, 0)} videos across ${sorted.length} categories.`);

  return toolResult(lines.join('\n'));
}

async function handleListDays() {
  const dayDirs = await listDayDirs();

  if (dayDirs.length === 0) {
    return toolResult('No scraped content yet.');
  }

  const lines = ['| Date | Videos |', '|------|--------|'];

  for (const day of dayDirs) {
    const dayPath = path.join(OUTPUT_DIR, day);
    const files = (await readdir(dayPath)).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    lines.push(`| ${day} | ${files.length} |`);
  }

  return toolResult(lines.join('\n'));
}

async function handleDiscoverChannels(args) {
  // Discovery needs the YouTube API and the LLM, same as scraping — shell out
  // to the CLI so there is one implementation of the run.
  const flags = ['discover'];
  if (args.topic) flags.push('--topic', String(args.topic));
  if (args.queries) flags.push('--queries', String(args.queries));
  if (args.results) flags.push('--results', String(args.results));
  if (args.min_subscribers) flags.push('--min-subscribers', String(args.min_subscribers));
  if (args.dry_run) flags.push('--dry-run');

  try {
    const { stdout, stderr } = await runCli(flags);
    return toolResult(stdout || stderr || 'Discovery finished with no output.');
  } catch (err) {
    return toolError(`Discovery failed: ${err.stderr || err.message}`);
  }
}

function handleListChannelSuggestions(args) {
  const status = args.status === 'all' ? undefined : (args.status || 'suggested');
  const rows = listSuggestions(OUTPUT_DIR, { status, topic: args.topic });

  if (rows.length === 0) {
    return toolResult(status === 'suggested' || !status
      ? 'No channel suggestions waiting. Run discover_channels to look for some.'
      : `No ${status} channels.`);
  }

  const lines = [`${rows.length} channel(s):\n`];
  for (const r of rows) {
    lines.push(`**${r.title}** — ${r.topic || 'no topic'}${status ? '' : ` (${r.status})`}`);
    lines.push(`  ID: ${r.id} | ${r.subscribers != null ? `${r.subscribers.toLocaleString()} subscribers` : 'subscribers unknown'}` +
      `${r.videoCount != null ? ` | ${r.videoCount} videos` : ''}${r.lastUpload ? ` | last upload ${r.lastUpload.slice(0, 10)}` : ''}`);
    lines.push(`  ${r.url}`);
    if (r.rationale) lines.push(`  Why: ${r.rationale}`);
    if (r.recentTitles?.length) lines.push(`  Recent: ${r.recentTitles.slice(0, 5).join(' · ')}`);
    lines.push('');
  }
  return toolResult(lines.join('\n'));
}

function handleReviewChannelSuggestion(args) {
  const { channel_id, decision, profile = DEFAULT_PROFILE } = args;
  try {
    const entry = reviewSuggestion(OUTPUT_DIR, channel_id, decision === 'approve' ? 'approved' : 'dismissed', { profile });
    return toolResult(decision === 'approve'
      ? `Approved **${entry.title}** — added to profile "${profile}", so the next scrape includes it.`
      : `Dismissed **${entry.title}** — it will not be suggested again.`);
  } catch (err) {
    return toolError(err.message);
  }
}

// ── Server Setup ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'youtube-scraper', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'scrape_youtube':
      return handleScrapeYoutube(args);
    case 'search_videos':
      return handleSearchVideos(args);
    case 'list_videos':
      return handleListVideos(args);
    case 'get_video_summary':
      return handleGetVideoSummary(args);
    case 'list_categories':
      return handleListCategories();
    case 'list_days':
      return handleListDays();
    case 'discover_channels':
      return handleDiscoverChannels(args);
    case 'list_channel_suggestions':
      return handleListChannelSuggestions(args);
    case 'review_channel_suggestion':
      return handleReviewChannelSuggestion(args);
    default:
      return toolError(`Unknown tool: ${name}`);
  }
});

// ── Start ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
