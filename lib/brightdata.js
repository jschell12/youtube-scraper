/**
 * Transcripts through BrightData's managed YouTube scraper
 * ("Youtube - Videos posts - collect by URL", dataset gd_lk56epmy2i5g7lzu0k),
 * for hosts YouTube will no longer serve captions to.
 *
 * Selected with `transcript_source: brightdata` in a config. One run:
 *
 *   1. Discovery through the YouTube Data API only (YOUTUBE_API_KEY): channel
 *      and playlist uploads honoring since_hours and limit, search sources via
 *      search.list, single video URLs as given. Ledger-seen ids are dropped.
 *      Nothing in this path talks to youtube.com directly.
 *   2. The first `maxRecords` new videos (source order, so the first channel in
 *      the config has priority) go to BrightData in ONE trigger. That cap is the
 *      cost bound: BrightData bills per record, $1.50 per 1,000.
 *   3. The snapshot id is written to <outputDir>/brightdata-pending.json before
 *      polling, so a crash or a slow snapshot is collected by the next run
 *      instead of being bought twice. Downloading a snapshot costs nothing.
 *   4. Rows are written by lib/scrape.js's saveVideo, the same as yt-dlp
 *      results: <id>-<slug>.md, and with keep_srt the <id>-<slug>.srt plus
 *      _video-<id>.json that `cli.js push` reads.
 *   5. A row from a channel on `exclude_channels` (its youtuber_id) is dropped
 *      before anything is written, and never bought again. Discovery already
 *      drops excluded channel sources and search/playlist hits; this is the
 *      check that also covers explicit video URLs and an earlier run's snapshot.
 *   6. A miss (no transcript, or an error row) is counted per video id in
 *      <outputDir>/brightdata-attempts.json; after MAX_ATTEMPTS misses, or one
 *      terminal error such as dead_page, discovery skips that id for good.
 *      seen.json is left to mean "saved".
 *
 * Any BrightData HTTP error (or network failure, or a failed snapshot) stops
 * the run. There is no retry loop: the next scheduled run is the retry.
 * The API key is sent only in the Authorization header and is scrubbed from
 * every error message this module builds.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toVideo } from './extract.js';
import { Ledger } from './ledger.js';
import { isExcludedChannel, isExcludedSource } from './exclude.js';
import { saveVideo } from './scrape.js';
import { SEARCH_PREFIX_RE } from './search-sources.js';
import * as youtubeApi from './youtube-api.js';

export const DATASET_ID = 'gd_lk56epmy2i5g7lzu0k';
export const API_BASE = 'https://api.brightdata.com/datasets/v3';
export const DEFAULT_MAX_RECORDS = 50;
export const USD_PER_RECORD = 1.5 / 1000;
export const PENDING_FILE = 'brightdata-pending.json';
export const ATTEMPTS_FILE = 'brightdata-attempts.json';
// A video BrightData returned without a transcript, or as an error row, is bought again on later runs
// until it has missed this many times; then it is given up on. Search and single-video sources have
// no date window, so without a bound a captionless hit would be bought on every run, forever.
export const MAX_ATTEMPTS = 3;
// Error codes that will not change on a retry: given up on at the first miss.
export const TERMINAL_ERROR_CODES = new Set(['dead_page']);
export const POLL_MS = 30_000;
export const MAX_WAIT_MS = 30 * 60_000;

export class BrightDataError extends Error {
  /** `gone`: the snapshot failed or no longer exists, so it can never be collected. */
  constructor(message, { status = null, gone = false } = {}) {
    super(message);
    this.name = 'BrightDataError';
    this.status = status;
    this.gone = gone || status === 404;
  }
}

/** `text` with every occurrence of `secret` replaced by "***". */
export function scrub(text, secret) {
  const s = String(text ?? '');
  return secret ? s.split(secret).join('***') : s;
}

/**
 * A minimal client for the three dataset endpoints. Every non-2xx, network
 * failure or unparseable body throws BrightDataError; nothing is retried.
 */
export function makeClient({ key, fetchImpl = globalThis.fetch, base = API_BASE, timeoutMs = 120_000 }) {
  if (!key) throw new BrightDataError('BRIGHTDATA_API_KEY is not set');

  async function call(what, method, urlPath, body) {
    let res;
    try {
      res = await fetchImpl(`${base}${urlPath}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new BrightDataError(scrub(`BrightData ${what}: request failed (${err.message})`, key));
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const detail = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new BrightDataError(scrub(`BrightData ${what}: HTTP ${res.status}${detail ? ` - ${detail}` : ''}`, key),
        { status: res.status });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new BrightDataError(scrub(`BrightData ${what}: HTTP ${res.status} with a body that is not JSON: ` +
        text.replace(/\s+/g, ' ').trim().slice(0, 120), key), { status: res.status });
    }
  }

  return {
    /** Start a collection for these video URLs. Returns the snapshot id. */
    async trigger(urls) {
      const body = urls.map(url => ({ url, country: '', transcription_language: '' }));
      const res = await call('trigger', 'POST', `/trigger?dataset_id=${DATASET_ID}&include_errors=true`, body);
      if (!res?.snapshot_id) throw new BrightDataError('BrightData trigger: response has no snapshot_id');
      return res.snapshot_id;
    },
    progress: (id) => call(`progress ${id}`, 'GET', `/progress/${encodeURIComponent(id)}`),
    async snapshot(id) {
      const rows = await call(`snapshot ${id}`, 'GET', `/snapshot/${encodeURIComponent(id)}?format=json`);
      if (!Array.isArray(rows)) throw new BrightDataError(`BrightData snapshot ${id}: expected a JSON array of rows`);
      return rows;
    },
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Poll until the snapshot is ready. Waiting is not retrying: a non-2xx from
 * the progress endpoint still throws at once.
 */
export async function waitForSnapshot(client, id, { pollMs = POLL_MS, maxWaitMs = MAX_WAIT_MS, wait = sleep, now = Date.now } = {}) {
  const start = now();
  for (;;) {
    const p = await client.progress(id);
    if (p?.status === 'ready') return p;
    if (p?.status === 'failed') throw new BrightDataError(`BrightData snapshot ${id} failed`, { gone: true });
    if (now() - start >= maxWaitMs) {
      throw new BrightDataError(`BrightData snapshot ${id} not ready after ${Math.round(maxWaitMs / 60_000)} min ` +
        `(status ${p?.status ?? 'unknown'}); the next run collects it`);
    }
    await wait(pollMs);
  }
}

/** SRT timestamp for a millisecond offset. */
function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor(t / 60_000) % 60;
  const s = Math.floor(t / 1000) % 60;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

/**
 * formatted_transcript cues ({ start_time, end_time } in ms, text) as SRT.
 * Cues without text or timing are dropped; '' when none are usable.
 */
export function cuesToSrt(cues) {
  if (!Array.isArray(cues)) return '';
  const blocks = [];
  for (const c of cues) {
    const text = String(c?.text ?? '').replace(/\r/g, '').replace(/\n\s*\n/g, '\n').trim();
    const start = Number(c?.start_time);
    const end = Number(c?.end_time);
    if (!text || !Number.isFinite(start)) continue;
    const stop = Number.isFinite(end) && end >= start ? end : start;
    blocks.push(`${blocks.length + 1}\n${srtTime(start)} --> ${srtTime(stop)}\n${text}\n`);
  }
  return blocks.join('\n');
}

/** A snapshot row that BrightData returned as an error (include_errors=true). */
export function isErrorRow(row) {
  return !row || row.error != null || row.error_code != null || !(row.video_id || row.shortcode);
}

/**
 * The scraper's video record (lib/extract.js toVideo shape) for one snapshot
 * row. `transcript` is '' when the row has no usable cues.
 */
export function rowToVideo(row) {
  const id = row.video_id || row.shortcode;
  const posted = row.date_posted ? new Date(row.date_posted) : null;
  const valid = posted && !Number.isNaN(posted.getTime());
  const meta = {
    id,
    title: row.title,
    channel: row.handle_name || (row.youtuber || '').replace(/^@/, '') || undefined,
    channel_id: row.youtuber_id || null,
    upload_date: valid ? posted.toISOString().slice(0, 10).replace(/-/g, '') : undefined,
    timestamp: valid ? posted.getTime() / 1000 : undefined,
    duration: Number(row.video_length) || 0,
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
    description: row.description || '',
  };
  return toVideo(meta, cuesToSrt(row.formatted_transcript));
}

const VIDEO_ID_RE = /^[\w-]{11}$/;

/** The video id of a single-video URL (watch?v=, youtu.be/, /shorts/), else null. */
export function videoIdFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  let id = null;
  if (/(^|\.)youtube\.com$/.test(u.hostname)) {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/shorts\/([\w-]{11})/) || [])[1] || null;
  } else if (u.hostname === 'youtu.be') {
    id = u.pathname.slice(1, 12);
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

/**
 * New videos across all sources, in source order, deduplicated and filtered
 * against the ledger. Discovery uses the Data API only; a source that fails is
 * logged and skipped. A source that is an excluded channel is not listed at
 * all, and hits whose channelId is excluded are dropped. Returns [{ id, url, source }].
 */
export async function discoverNew(sources, { sinceHours, limit, rescrape = false, ledger, skip = () => false, exclude = new Set(), api = youtubeApi, log = console.log }) {
  const out = [];
  const taken = new Set();
  for (const src of sources) {
    if (isExcludedSource(src, exclude)) {
      log(`  ${src}: excluded channel, skipped`);
      continue;
    }
    let found;
    try {
      const search = src.match(SEARCH_PREFIX_RE);
      const single = !search && videoIdFromUrl(src);
      if (search) {
        found = await api.searchVideos(search[2].trim(), { limit: parseInt(search[1] || '1', 10) });
      } else if (single && !/[?&]list=/.test(src)) {
        found = [{ id: single, url: `https://www.youtube.com/watch?v=${single}` }];
      } else if (youtubeApi.parseSourceUrl(src)) {
        found = await api.discoverVideos(src, { sinceHours, limit });
      } else {
        log(`  ${src}: not discoverable through the Data API, skipped`);
        continue;
      }
    } catch (err) {
      log(`  ${src}: discovery failed (${err.message}), skipped`);
      continue;
    }
    const allowed = found.filter(v => !isExcludedChannel(v.channelId, exclude));
    const fresh = allowed.filter(v => !taken.has(v.id) && (rescrape || (!ledger.hasSeen(v.id) && !skip(v.id))));
    for (const v of fresh) {
      taken.add(v.id);
      out.push({ id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, source: src });
    }
    const dropped = found.length - allowed.length;
    log(`  ${src}: ${found.length} found, ${fresh.length} new` + (dropped ? `, ${dropped} from excluded channels dropped` : ''));
  }
  return out;
}

async function readPending(outputDir) {
  const file = path.join(outputDir, PENDING_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writePending(outputDir, record) {
  const file = path.join(outputDir, PENDING_FILE);
  await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

async function clearPending(outputDir) {
  await unlink(path.join(outputDir, PENDING_FILE)).catch(() => {});
}

async function readAttempts(outputDir) {
  const file = path.join(outputDir, ATTEMPTS_FILE);
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
}

async function writeAttempts(outputDir, attempts) {
  const file = path.join(outputDir, ATTEMPTS_FILE);
  await writeFile(`${file}.tmp`, JSON.stringify(attempts, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

/**
 * Scrape `sources` with BrightData as the transcript fetcher. Same options and
 * output as lib/scrape.js scrape(), plus `maxRecords` (records bought per run).
 * Returns { dayDir, totalNew, totalSkipped, rateLimited: false, stopped,
 * stopReason, submitted, deferred, noTranscript, recordErrors, excluded };
 * `stopped` is true when a BrightData error ended the run early.
 */
export async function scrapeBrightdata(sources, {
  outputDir = './output', sinceHours = 24, limit = 50, rescrape = false, model = 'ollama',
  forceCategory, summarize = true, keepSrt = false, maxRecords = DEFAULT_MAX_RECORDS, exclude = new Set(),
  env = process.env, fetchImpl = globalThis.fetch, api, wait, now, pollMs, maxWaitMs, log = console.log,
} = {}) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error(`brightdata_max_records must be a whole number >= 1 (got ${maxRecords})`);
  }
  if (!api && !youtubeApi.apiKey()) {
    throw new Error('YOUTUBE_API_KEY is not set: transcript_source brightdata discovers videos through the Data API');
  }
  const client = makeClient({ key: env.BRIGHTDATA_API_KEY, fetchImpl });

  const today = new Date().toISOString().slice(0, 10);
  const dayDir = path.join(outputDir, today);
  await mkdir(dayDir, { recursive: true });
  const ledger = await new Ledger(path.join(outputDir, 'seen.json')).load();

  const attempts = await readAttempts(outputDir);
  const stats = { totalNew: 0, totalSkipped: 0, submitted: 0, deferred: 0, noTranscript: 0, recordErrors: 0, givenUp: 0, excluded: 0 };
  const opts = { pollMs, maxWaitMs, wait, now };
  const result = (stopReason = null) => {
    log(`\nDone. ${stats.totalNew} new, ${stats.totalSkipped} skipped (already seen), ` +
      `${stats.noTranscript} without a transcript, ${stats.recordErrors} record error(s), ${stats.givenUp} given up on, ` +
      `${stats.excluded} from excluded channels dropped. ` +
      `Ledger: ${ledger.size} total.` +
      (stopReason ? ` Stopped: ${stopReason}` : ''));
    return { dayDir, ...stats, rateLimited: false, stopped: Boolean(stopReason), stopReason };
  };

  /** Count a miss for `id`; give up at MAX_ATTEMPTS, or at once when `terminal`. */
  function miss(id, why, terminal = false) {
    if (!id) return;
    const prev = attempts[id]?.attempts || 0;
    const givenUp = terminal || prev + 1 >= MAX_ATTEMPTS;
    attempts[id] = { attempts: prev + 1, last: why, at: new Date().toISOString(), given_up: givenUp };
    if (givenUp) {
      stats.givenUp++;
      log(`  giving up on ${id} after ${prev + 1} miss(es): ${why}`);
    }
  }

  async function collect(snapshotId) {
    await waitForSnapshot(client, snapshotId, opts);
    const rows = await client.snapshot(snapshotId);
    log(`  snapshot ${snapshotId}: ${rows.length} row(s)`);
    try {
      for (const row of rows) await take(row);
    } finally {
      await writeAttempts(outputDir, attempts);
    }
  }

  async function take(row) {
    if (isErrorRow(row)) {
      stats.recordErrors++;
      const src = row?.input?.url || row?.url || '';
      const what = String([row?.error_code, row?.error].filter(Boolean).join(': ') || 'row has no video_id').slice(0, 200);
      log(`  record error (${src || '?'}): ${what}`);
      miss(row?.video_id || videoIdFromUrl(src), what, TERMINAL_ERROR_CODES.has(row?.error_code));
      return;
    }
    // The last check before anything is written: the row's own channel, whatever source it came from.
    if (isExcludedChannel(row.youtuber_id, exclude)) {
      stats.excluded++;
      log(`  Dropping (excluded channel ${row.youtuber_id}): ${row.video_id || row.shortcode}`);
      const id = row.video_id || row.shortcode;
      // Never bought again: discovery skips given-up ids (an explicit video URL has no channel until this row).
      attempts[id] = { attempts: (attempts[id]?.attempts || 0) + 1, last: 'excluded channel', at: new Date().toISOString(), given_up: true };
      return;
    }
    const video = rowToVideo(row);
    if (!rescrape && ledger.hasSeen(video.id)) {
      stats.totalSkipped++;
      return;
    }
    if (!video.transcript) {
      stats.noTranscript++;
      log(`  Skipping (no transcript): ${video.title}`);
      miss(video.id, 'no transcript');
      return;
    }
    await saveVideo(video, { dayDir, ledger, model, forceCategory, summarize, keepSrt });
    delete attempts[video.id];
    stats.totalNew++;
  }

  // 1. A snapshot an earlier run paid for but never collected.
  const pending = await readPending(outputDir);
  if (pending?.snapshot_id) {
    log(`\nCollecting snapshot ${pending.snapshot_id} from an earlier run (${pending.video_ids?.length ?? '?'} video(s), already paid for)`);
    try {
      await collect(pending.snapshot_id);
      await clearPending(outputDir);
    } catch (err) {
      if (!(err instanceof BrightDataError)) throw err;
      // A snapshot that failed or no longer exists can never be collected; drop it so it stops blocking runs.
      if (err.gone) await clearPending(outputDir);
      return result(err.message);
    }
  }

  // 2. Discovery.
  log('\nDiscovering new videos through the YouTube Data API');
  const fresh = await discoverNew(sources, { sinceHours, limit, rescrape, ledger, exclude, api: api || youtubeApi, log,
    skip: (id) => attempts[id]?.given_up === true });
  const batch = fresh.slice(0, maxRecords);
  stats.deferred = fresh.length - batch.length;
  if (batch.length === 0) {
    log('  nothing new to fetch');
    return result();
  }

  // 3. One trigger, capped.
  stats.submitted = batch.length;
  log(`\nBrightData: requesting ${batch.length} video(s), about $${(batch.length * USD_PER_RECORD).toFixed(4)}` +
    (stats.deferred ? `; ${stats.deferred} more over the cap of ${maxRecords} wait for a later run` : ''));
  let snapshotId;
  try {
    snapshotId = await client.trigger(batch.map(v => v.url));
    log(`  snapshot ${snapshotId}`);
    await writePending(outputDir, {
      snapshot_id: snapshotId,
      dataset_id: DATASET_ID,
      triggered_at: new Date().toISOString(),
      video_ids: batch.map(v => v.id),
    });
    log(`  recorded in ${PENDING_FILE} until collected`);
    await collect(snapshotId);
    await clearPending(outputDir);
  } catch (err) {
    if (!(err instanceof BrightDataError)) throw err;
    if (snapshotId && err.gone) await clearPending(outputDir);
    return result(err.message);
  }
  return result();
}
