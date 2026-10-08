/**
 * Transcript extraction via yt-dlp.
 * Handles single videos, channels, and playlists.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const execFileP = promisify(execFile);

/**
 * Thrown when YouTube answers HTTP 429. Callers must stop the run rather than
 * move on to the next source: every further request extends the block, and a
 * 429 on the caption endpoint otherwise just looks like "no transcript".
 */
export class RateLimitedError extends Error {
  constructor(detail) {
    super(`YouTube rate-limited this host (HTTP 429)${detail ? `: ${detail}` : ''}. Stopping; try again later.`);
    this.name = 'RateLimitedError';
    this.code = 'YT_RATE_LIMITED';
  }
}

/** True when yt-dlp's stderr reports an HTTP 429 from YouTube. */
export function isRateLimited(stderr) {
  return /HTTP Error 429|Too Many Requests/i.test(stderr || '');
}

function firstRateLimitLine(stderr) {
  return (stderr || '').split('\n').find(l => isRateLimited(l))?.trim().slice(0, 200) || '';
}

/**
 * Check that yt-dlp is installed.
 */
export async function checkDeps() {
  try {
    await execFileP('yt-dlp', ['--version']);
  } catch {
    throw new Error('yt-dlp is not installed. Run: pip install yt-dlp (or brew install yt-dlp)');
  }
}

/**
 * Fetch video metadata + transcript for a single URL.
 * Returns array of {id, title, channel, upload_date, duration, url, transcript}
 *
 * For channels/playlists, yt-dlp returns one JSON object per line.
 */
export async function fetchVideos(url, { sinceHours = 24, limit = 50 } = {}) {
  // Don't apply date filter to single video URLs — only to channels/playlists
  const isSingleVideo = /[?&]v=|youtu\.be\//.test(url) && !/[?&]list=/.test(url);
  const cutoff = (sinceHours && !isSingleVideo)
    ? new Date(Date.now() - sinceHours * 3600_000).toISOString().slice(0, 10).replace(/-/g, '')
    : null;

  const args = [
    '--write-auto-sub',
    '--sub-lang', 'en',
    '--skip-download',
    '--print-json',
    '--no-warnings',
    '--quiet',
    '--convert-subs', 'srt',
    '-o', '%(id)s.%(ext)s',
  ];

  if (cutoff) args.push('--dateafter', cutoff);
  if (limit && !isSingleVideo) args.push('--playlist-end', String(limit));

  args.push(url);

  // yt-dlp writes .srt files to cwd; we use a temp approach via --paths
  const tmpDir = path.join(process.cwd(), '.yt-tmp');
  args.push('--paths', tmpDir);

  let stdout;
  let stderr = '';
  try {
    const result = await execFileP('yt-dlp', args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300_000,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    stderr = err.stderr || '';
    if (isRateLimited(stderr)) throw new RateLimitedError(firstRateLimitLine(stderr));
    // yt-dlp exits non-zero if some videos have no subs — still produces output
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      throw err;
    }
  }
  if (isRateLimited(stderr)) throw new RateLimitedError(firstRateLimitLine(stderr));

  if (!stdout || !stdout.trim()) return [];

  const videos = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) continue;
    let meta;
    try {
      meta = JSON.parse(line);
    } catch {
      continue;
    }

    const srtPath = path.join(tmpDir, `${meta.id}.en.srt`);
    let srt = '';

    if (existsSync(srtPath)) {
      srt = await readFile(srtPath, 'utf8');
      await unlink(srtPath).catch(() => {});
    }

    videos.push(toVideo(meta, srt, url));
  }

  // Cleanup tmp dir if empty
  try {
    const remaining = await readdir(tmpDir);
    if (remaining.length === 0) {
      const { rmdir } = await import('node:fs/promises');
      await rmdir(tmpDir);
    }
  } catch {}

  return videos;
}

/**
 * Build the scraper's video record from one yt-dlp --print-json object and
 * the raw SRT text ('' when YouTube had no English captions).
 * `srt` is kept raw so downstream consumers that need timestamps can use it;
 * `transcript` is the flattened text the markdown/summary flow uses.
 */
export function toVideo(meta, srt = '', fallbackUrl = '') {
  const id = meta.id;
  return {
    id,
    title: meta.title || meta.fulltitle || id,
    channel: meta.channel || meta.uploader || 'Unknown',
    channel_id: meta.channel_id || null,
    upload_date: formatDate(meta.upload_date),
    published_at: publishedAt(meta),
    duration: meta.duration || 0,
    duration_string: meta.duration_string || formatDuration(meta.duration || 0),
    url: meta.webpage_url || meta.original_url || fallbackUrl,
    description: (meta.description || '').slice(0, 500),
    srt,
    transcript: srt ? parseSrt(srt) : '',
  };
}

/**
 * ISO publish time: the epoch timestamp when yt-dlp has one, else the
 * YYYY-MM-DD upload date (an ISO 8601 date), else null. Never invents a time.
 */
export function publishedAt(meta) {
  const ts = meta.release_timestamp || meta.timestamp;
  if (Number.isFinite(ts)) return new Date(ts * 1000).toISOString();
  const d = formatDate(meta.upload_date);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * List video ids for a yt-dlp search source ("ytsearchN:query") without
 * touching any video page: --flat-playlist returns the result list only, so
 * the caller can drop ledger-seen ids before fetching captions.
 * Returns [{ id, url, title }].
 */
export async function listSearch(source) {
  let stdout;
  let stderr = '';
  try {
    const result = await execFileP('yt-dlp', [
      '--flat-playlist', '--print-json', '--no-warnings', '--quiet', source,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    stderr = err.stderr || '';
    if (isRateLimited(stderr)) throw new RateLimitedError(firstRateLimitLine(stderr));
    if (!err.stdout) throw err;
    stdout = err.stdout;
  }
  if (isRateLimited(stderr)) throw new RateLimitedError(firstRateLimitLine(stderr));
  return parseFlatList(stdout);
}

/** Parse --flat-playlist --print-json output into [{ id, url, title }]. */
export function parseFlatList(stdout) {
  const out = [];
  for (const line of (stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e.id || !/^[\w-]{11}$/.test(e.id)) continue; // skip channel/playlist hits
    out.push({ id: e.id, url: `https://www.youtube.com/watch?v=${e.id}`, title: e.title || e.id });
  }
  return out;
}

/**
 * Parse SRT subtitle format into plain text.
 * Strips timestamps, sequence numbers, and HTML tags.
 * Deduplicates consecutive identical lines (yt-dlp auto-subs repeat).
 */
export function parseSrt(srt) {
  const lines = srt.split('\n');
  const textLines = [];
  let prev = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip sequence numbers (pure digits)
    if (/^\d+$/.test(trimmed)) continue;
    // Skip timestamp lines
    if (/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(trimmed)) continue;
    // Skip empty
    if (!trimmed) continue;

    // Strip HTML tags (yt-dlp auto-subs use <font> etc.)
    const clean = trimmed.replace(/<[^>]+>/g, '').trim();
    if (!clean) continue;

    // Deduplicate consecutive repeated lines
    if (clean === prev) continue;
    prev = clean;
    textLines.push(clean);
  }

  return textLines.join(' ');
}

function formatDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
