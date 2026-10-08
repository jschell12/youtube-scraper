/**
 * Push scraped transcripts to a webhook.
 *
 * Reads the _video-<id>.json sidecars a `keep_srt: true` scrape writes, and
 * POSTs one JSON body per video:
 *   { video_id, channel_id, channel_title, title, url, published_at, srt }
 *
 * Resumable and idempotent: every accepted push is appended to
 * <outputDir>/pushed.jsonl (one JSON object per line, never rewritten), and a
 * video already recorded there for the same target URL is not sent again.
 * The receiver is expected to be idempotent on video_id as well, so a crash
 * between the POST and the append costs one duplicate request, not data.
 *
 * Stops at the first non-2xx (or network error) and reports it. Header values
 * are never logged: callers pass them in and this module only prints names.
 */

import { appendFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIDECAR_RE = /^_video-([\w-]+)\.json$/;

export const PUSH_LEDGER = 'pushed.jsonl';
// The receiver rejects bodies over 2 MB with 413; skip those locally instead
// of sending them and stopping the run.
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class PushError extends Error {
  constructor(message, { status = null, videoId = null } = {}) {
    super(message);
    this.name = 'PushError';
    this.status = status;
    this.videoId = videoId;
  }
}

/** Read the pushed ledger into a Set of `${target}\t${videoId}` keys. */
export async function readPushed(outputDir) {
  const file = path.join(outputDir, PUSH_LEDGER);
  const done = new Set();
  if (!existsSync(file)) return done;
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.video_id && rec.target) done.add(`${rec.target}\t${rec.video_id}`);
    } catch {
      // A torn final line from a crash mid-append: ignore it; that video is
      // simply re-sent, which the receiver treats as a no-op.
    }
  }
  return done;
}

/**
 * List every pushable video under outputDir, oldest day first.
 * Returns [{ videoId, dayDir, sidecar }].
 */
export async function listPushable(outputDir) {
  if (!existsSync(outputDir)) return [];
  const days = (await readdir(outputDir)).filter(d => DAY_RE.test(d)).sort();
  const out = [];
  for (const day of days) {
    const dayDir = path.join(outputDir, day);
    for (const f of (await readdir(dayDir)).sort()) {
      const m = f.match(SIDECAR_RE);
      if (m) out.push({ videoId: m[1], dayDir, sidecar: path.join(dayDir, f) });
    }
  }
  return out;
}

/** Build the request body for one sidecar. */
export async function buildPayload({ sidecar, dayDir }) {
  const meta = JSON.parse(await readFile(sidecar, 'utf8'));
  const srt = await readFile(path.join(dayDir, meta.srt_file), 'utf8');
  return {
    video_id: meta.video_id,
    channel_id: meta.channel_id ?? null,
    channel_title: meta.channel_title ?? null,
    title: meta.title ?? null,
    url: meta.url ?? null,
    published_at: meta.published_at ?? null,
    srt,
  };
}

/**
 * Push every not-yet-pushed video in outputDir to `url`.
 * @param {object} opts
 * @param {string} opts.outputDir
 * @param {string} opts.url - full endpoint URL
 * @param {Record<string,string>} [opts.headers] - extra request headers (auth)
 * @param {number} [opts.limit] - max videos to send this run (0 = all)
 * @param {boolean} [opts.dryRun] - list what would be sent, send nothing
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ pushed: number, skipped: number, oversize: number, pending: number }>}
 * @throws {PushError} on the first non-2xx or network failure
 */
export async function pushTranscripts({
  outputDir,
  url,
  headers = {},
  limit = 0,
  dryRun = false,
  timeoutMs = 60_000,
  fetchImpl = globalThis.fetch,
  log = (m) => console.log(m),
}) {
  const target = new URL(url).toString();
  const done = await readPushed(outputDir);
  const all = await listPushable(outputDir);
  const todo = all.filter(v => !done.has(`${target}\t${v.videoId}`));
  const skipped = all.length - todo.length;

  let pushed = 0;
  let oversize = 0;
  for (const item of todo) {
    if (limit && pushed >= limit) break;

    const body = JSON.stringify(await buildPayload(item));
    const bytes = Buffer.byteLength(body);
    if (bytes > MAX_BODY_BYTES) {
      oversize++;
      log(`  skip ${item.videoId}: body is ${bytes} bytes, over the ${MAX_BODY_BYTES}-byte limit`);
      continue;
    }
    if (dryRun) {
      log(`  would push ${item.videoId} (${bytes} bytes)`);
      pushed++;
      continue;
    }

    let res;
    try {
      res = await fetchImpl(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new PushError(`push ${item.videoId}: request failed (${err.message})`, { videoId: item.videoId });
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 200); } catch {}
      throw new PushError(
        `push ${item.videoId}: HTTP ${res.status}${detail ? ` - ${detail}` : ''}`,
        { status: res.status, videoId: item.videoId },
      );
    }

    let status = null;
    try { status = (await res.json())?.status ?? null; } catch {}

    await appendFile(path.join(outputDir, PUSH_LEDGER), JSON.stringify({
      video_id: item.videoId,
      target,
      http: res.status,
      status,
      pushed_at: new Date().toISOString(),
    }) + '\n');
    pushed++;
    log(`  pushed ${item.videoId} (HTTP ${res.status}${status ? `, ${status}` : ''})`);
  }

  return { pushed, skipped, oversize, pending: todo.length - pushed - oversize };
}

/**
 * Cloudflare Access service-token headers from the environment.
 * Returns {} when neither variable is set; throws when only one is, since a
 * half-configured token can only produce a confusing 403.
 */
export function accessHeadersFromEnv(env, idVar, secretVar) {
  const id = env[idVar];
  const secret = env[secretVar];
  if (!id && !secret) return {};
  if (!id || !secret) {
    throw new PushError(`${!id ? idVar : secretVar} is not set (the other one is); set both or neither`);
  }
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}
