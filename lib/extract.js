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
  const cutoff = sinceHours
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
  if (limit) args.push('--playlist-end', String(limit));

  args.push(url);

  // yt-dlp writes .srt files to cwd; we use a temp approach via --paths
  const tmpDir = path.join(process.cwd(), '.yt-tmp');
  args.push('--paths', tmpDir);

  let stdout;
  try {
    const result = await execFileP('yt-dlp', args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300_000,
    });
    stdout = result.stdout;
  } catch (err) {
    // yt-dlp exits non-zero if some videos have no subs — still produces output
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      throw err;
    }
  }

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

    const id = meta.id;
    const srtPath = path.join(tmpDir, `${id}.en.srt`);
    let transcript = '';

    if (existsSync(srtPath)) {
      const srt = await readFile(srtPath, 'utf8');
      transcript = parseSrt(srt);
      await unlink(srtPath).catch(() => {});
    }

    videos.push({
      id,
      title: meta.title || meta.fulltitle || id,
      channel: meta.channel || meta.uploader || 'Unknown',
      upload_date: formatDate(meta.upload_date),
      duration: meta.duration || 0,
      duration_string: meta.duration_string || formatDuration(meta.duration || 0),
      url: meta.webpage_url || meta.original_url || url,
      description: (meta.description || '').slice(0, 500),
      transcript,
    });
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
