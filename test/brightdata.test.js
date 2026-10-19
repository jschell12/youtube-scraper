import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scrapeBrightdata, discoverNew, cuesToSrt, rowToVideo, isErrorRow, makeClient, scrub,
  videoIdFromUrl, PENDING_FILE, DATASET_ID,
} from '../lib/brightdata.js';
import { parseSrt } from '../lib/extract.js';
import { pushTranscripts } from '../lib/push.js';

// Recorded responses; see test/fixtures/brightdata/README.md for where each came from.
const FX = new URL('./fixtures/brightdata/', import.meta.url);
const json = (f) => JSON.parse(readFileSync(new URL(f, FX), 'utf8'));
const text = (f) => readFileSync(new URL(f, FX), 'utf8');
const ROWS = json('snapshot-sd_mvfl47b4i0700m0pb.json');
const ERROR_ROW = json('error-row-sd_mvfm460c1mgwbewzgj.json');
const READY = json('progress-ready.json');
const RUNNING = json('progress-running.json');
const SNAPSHOT_ID = READY.snapshot_id;
const TRIGGERED = json('scrape-202.json');   // carries a snapshot_id; the code reads nothing else

const KEY = 'test-key-0123456789abcdef';
const ENV = { BRIGHTDATA_API_KEY: KEY };
const quiet = () => {};
const noWait = async () => {};

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'bd-'));

/** A fetch that answers by route from `routes` ({ trigger, progress, snapshot } -> Response factories). */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const route = u.pathname.split('/')[3];        // /datasets/v3/<route>/...
    calls.push({ route, url: u, init, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes[route];
    if (!r) throw new Error(`unexpected route ${route}`);
    return r(calls.filter(c => c.route === route).length, u);
  };
  fn.calls = calls;
  fn.routes = () => calls.map(c => c.route);
  return fn;
}
const ok = (body) => () => new Response(JSON.stringify(body), { status: 200 });
const raw = (status, body) => () => new Response(body, { status });

/** Discovery stub returning these ids for the first source, nothing for the rest. */
function apiFor(ids) {
  return {
    searchVideos: async () => [],
    discoverVideos: async (src) => (src === 'https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw'
      ? ids.map(id => ({ id, url: `https://www.youtube.com/watch?v=${id}` })) : []),
  };
}
const SOURCES = ['https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw'];
const IDS = ROWS.map(r => r.video_id);

test('cuesToSrt turns the recorded cues into numbered SRT blocks, ms to HH:MM:SS,mmm', () => {
  const row = ROWS.find(r => r.video_id === 'elE_XUEp320');
  const srt = cuesToSrt(row.formatted_transcript);
  const blocks = srt.trim().split('\n\n');
  assert.equal(blocks.length, row.formatted_transcript.length);
  assert.equal(blocks[0], '1\n00:00:00,160 --> 00:00:04,400\nwinning a game with every NFL team in');
  assert.match(blocks.at(-1), /^44\n00:02:\d\d,\d{3} --> 00:02:\d\d,\d{3}\n\S/);
  // and it reads back through the same parser the yt-dlp path uses
  assert.match(parseSrt(srt), /^winning a game with every NFL team in Madden 27\./);
});

test('cuesToSrt is empty for no cues, and drops cues with no text or no start', () => {
  assert.equal(cuesToSrt(null), '');
  assert.equal(cuesToSrt([]), '');
  assert.equal(cuesToSrt([{ start_time: 0, end_time: 5, text: '  ' }, { end_time: 5, text: 'x' }]), '');
  assert.equal(cuesToSrt([{ start_time: 3_723_004, end_time: 1, text: 'a\n\nb' }]),
    '1\n01:02:03,004 --> 01:02:03,004\na\nb\n');
});

test('rowToVideo maps a recorded row to the yt-dlp video shape', () => {
  const v = rowToVideo(ROWS.find(r => r.video_id === 'z3QqntIenCI'));
  assert.equal(v.id, 'z3QqntIenCI');
  assert.equal(v.title, 'Torch Man Defense With This Madden 27 Money Play');
  assert.equal(v.channel, 'Madden School');
  assert.equal(v.channel_id, 'UCwZLmiLcq6QA7GD67NpGXhg');
  assert.equal(v.published_at, '2026-09-05T00:27:54.000Z');
  assert.equal(v.upload_date, '2026-09-05');
  assert.equal(v.duration_string, '2:35');
  assert.equal(v.url, 'https://www.youtube.com/watch?v=z3QqntIenCI');
  assert.match(v.transcript, /^Hey, what's going on guys\? It's Ian from/);
  assert.match(v.srt, /^1\n00:00:01,000 --> 00:00:03,720\n/);
});

test('isErrorRow: the recorded dead_page row is an error, a recorded video row is not', () => {
  assert.equal(isErrorRow(ERROR_ROW), true);
  assert.equal(isErrorRow(ROWS[0]), false);
  assert.equal(isErrorRow({}), true);
});

test('videoIdFromUrl', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=elE_XUEp320'), 'elE_XUEp320');
  assert.equal(videoIdFromUrl('https://youtu.be/elE_XUEp320?t=3'), 'elE_XUEp320');
  assert.equal(videoIdFromUrl('https://www.youtube.com/shorts/elE_XUEp320'), 'elE_XUEp320');
  assert.equal(videoIdFromUrl('https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw'), null);
  assert.equal(videoIdFromUrl('not a url'), null);
});

test('end to end: one capped trigger, the files push reads, error rows logged, push works unchanged', async () => {
  const outputDir = await tmp();
  const f = fakeFetch({
    trigger: ok(TRIGGERED),
    progress: (n) => new Response(JSON.stringify(n === 1 ? RUNNING : READY), { status: 200 }),
    snapshot: ok([...ROWS, ERROR_ROW]),
  });
  const r = await scrapeBrightdata(SOURCES, {
    outputDir, env: ENV, fetchImpl: f, api: apiFor(IDS), wait: noWait, keepSrt: true,
    summarize: false, forceCategory: 'madden', log: quiet,
  });
  assert.deepEqual([r.totalNew, r.recordErrors, r.noTranscript, r.submitted, r.deferred, r.stopped], [3, 1, 0, 3, 0, false]);
  assert.deepEqual(f.routes(), ['trigger', 'progress', 'progress', 'snapshot']);

  const trig = f.calls[0];
  assert.equal(trig.init.method, 'POST');
  assert.equal(trig.url.searchParams.get('dataset_id'), DATASET_ID);
  assert.equal(trig.url.searchParams.get('include_errors'), 'true');
  assert.equal(trig.init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(trig.body, IDS.map(id => ({ url: `https://www.youtube.com/watch?v=${id}`, country: '', transcription_language: '' })));
  assert.ok(f.calls.slice(1).every(c => c.init.method === 'GET' && c.url.pathname.endsWith(TRIGGERED.snapshot_id)));

  const files = await readdir(r.dayDir);
  for (const id of IDS) {
    assert.ok(files.includes(`_video-${id}.json`), id);
    const meta = JSON.parse(await readFile(path.join(r.dayDir, `_video-${id}.json`), 'utf8'));
    assert.equal(meta.video_id, id);
    assert.match(meta.srt_file, new RegExp(`^${id}-[a-z0-9-]+\\.srt$`));
    assert.match(await readFile(path.join(r.dayDir, meta.srt_file), 'utf8'), /^1\n\d\d:\d\d:\d\d,\d{3} --> /);
    assert.ok(files.includes(meta.srt_file.replace(/\.srt$/, '.md')));
  }
  assert.equal(Object.keys(JSON.parse(await readFile(path.join(outputDir, 'seen.json'), 'utf8'))).length, 3);
  assert.equal(existsSync(path.join(outputDir, PENDING_FILE)), false);

  const pushed = await pushTranscripts({ outputDir, url: 'https://pfe.example/api/ingest/transcript', dryRun: true, log: quiet });
  assert.equal(pushed.pushed, 3);
});

test('the cap: only the first maxRecords new videos are bought, in source order', async () => {
  const outputDir = await tmp();
  const many = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
  const f = fakeFetch({ trigger: ok(TRIGGERED), progress: ok(READY), snapshot: ok([]) });
  const r = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f, api: apiFor(many), wait: noWait,
    maxRecords: 2, log: quiet, summarize: false, forceCategory: 'madden' });
  assert.deepEqual(f.calls[0].body.map(b => b.url.slice(-11)), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.deepEqual([r.submitted, r.deferred], [2, 3]);
});

test('seen videos are not bought, and with nothing new BrightData is never called', async () => {
  const outputDir = await tmp();
  await writeFile(path.join(outputDir, 'seen.json'), JSON.stringify(Object.fromEntries(IDS.map(id => [id, { title: id }]))));
  const f = fakeFetch({});
  const r = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f, api: apiFor(IDS), log: quiet });
  assert.equal(f.calls.length, 0);
  assert.deepEqual([r.submitted, r.totalNew, r.stopped], [0, 0, false]);
});

test('an HTTP error stops the run after one request, with no retry and no key in the message', async () => {
  for (const [status, body] of [[401, text('progress-401.txt')], [500, `upstream said: Bearer ${KEY}`]]) {
    const outputDir = await tmp();
    const f = fakeFetch({ trigger: raw(status, body) });
    const r = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f, api: apiFor(IDS), log: quiet });
    assert.equal(f.calls.length, 1);
    assert.equal(r.stopped, true);
    assert.match(r.stopReason, new RegExp(`^BrightData trigger: HTTP ${status}`));
    assert.doesNotMatch(r.stopReason, new RegExp(KEY));
    assert.equal(existsSync(path.join(outputDir, PENDING_FILE)), false);   // nothing was bought
  }
  const r401 = await scrapeBrightdata(SOURCES, { outputDir: await tmp(), env: ENV, fetchImpl: fakeFetch({ trigger: raw(401, text('progress-401.txt')) }), api: apiFor(IDS), log: quiet });
  assert.equal(r401.stopReason, 'BrightData trigger: HTTP 401 - Invalid credentials');
});

test('a network failure stops the run and the key is scrubbed from the message', async () => {
  const f = async () => { throw new Error(`connect failed for ${KEY}`); };
  const r = await scrapeBrightdata(SOURCES, { outputDir: await tmp(), env: ENV, fetchImpl: f, api: apiFor(IDS), log: quiet });
  assert.equal(r.stopped, true);
  assert.equal(r.stopReason, 'BrightData trigger: request failed (connect failed for ***)');
  assert.equal(scrub(`a${KEY}b${KEY}`, KEY), 'a***b***');
});

test('the snapshot id is recorded before polling; a later run collects it instead of buying again', async () => {
  const outputDir = await tmp();
  // run 1: trigger succeeds, the progress endpoint then fails -> stop, pending kept
  const f1 = fakeFetch({ trigger: ok(TRIGGERED), progress: raw(502, 'Bad Gateway') });
  const r1 = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f1, api: apiFor(IDS), log: quiet });
  assert.equal(r1.stopped, true);
  assert.deepEqual(f1.routes(), ['trigger', 'progress']);
  const pending = JSON.parse(await readFile(path.join(outputDir, PENDING_FILE), 'utf8'));
  assert.equal(pending.snapshot_id, TRIGGERED.snapshot_id);
  assert.deepEqual(pending.video_ids, IDS);
  assert.doesNotMatch(JSON.stringify(pending), new RegExp(KEY));

  // run 2: collects the recorded snapshot; the same videos are then seen, so no new trigger
  const f2 = fakeFetch({ progress: ok(READY), snapshot: ok(ROWS) });
  const r2 = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f2, api: apiFor(IDS), log: quiet,
    keepSrt: true, summarize: false, forceCategory: 'madden' });
  assert.deepEqual(f2.routes(), ['progress', 'snapshot']);
  assert.equal(r2.totalNew, 3);
  assert.equal(r2.stopped, false);
  assert.equal(existsSync(path.join(outputDir, PENDING_FILE)), false);
});

test('a pending snapshot that no longer exists (recorded 404) is dropped, and the run stops', async () => {
  const outputDir = await tmp();
  await writeFile(path.join(outputDir, PENDING_FILE), JSON.stringify({ snapshot_id: 'sd_doesnotexist0000', video_ids: [] }));
  const f = fakeFetch({ progress: raw(404, text('progress-404.txt')) });
  const r = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f, api: apiFor(IDS), log: quiet });
  assert.equal(r.stopReason, 'BrightData progress sd_doesnotexist0000: HTTP 404 - Snapshot does not exist');
  assert.equal(f.calls.length, 1);
  assert.equal(existsSync(path.join(outputDir, PENDING_FILE)), false);
});

test('a snapshot still running at the wait limit stops the run and stays pending', async () => {
  const outputDir = await tmp();
  let t = 0;
  const f = fakeFetch({ trigger: ok(TRIGGERED), progress: ok(RUNNING) });
  const r = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f, api: apiFor(IDS), log: quiet,
    pollMs: 60_000, maxWaitMs: 180_000, now: () => t, wait: async (ms) => { t += ms; } });
  assert.equal(r.stopped, true);
  assert.match(r.stopReason, /^BrightData snapshot \S+ not ready after 3 min \(status running\); the next run collects it$/);
  assert.deepEqual(f.routes(), ['trigger', 'progress', 'progress', 'progress', 'progress']);
  assert.ok(existsSync(path.join(outputDir, PENDING_FILE)));
});

test('a row with no cues is not saved or marked seen (real row, cues removed: none observed live yet)', async () => {
  const outputDir = await tmp();
  const bare = { ...ROWS[0], formatted_transcript: null };
  const f = fakeFetch({ trigger: ok(TRIGGERED), progress: ok(READY), snapshot: ok([bare]) });
  const r = await scrapeBrightdata(SOURCES, { outputDir, env: ENV, fetchImpl: f, api: apiFor([bare.video_id]), log: quiet,
    keepSrt: true, summarize: false, forceCategory: 'madden' });
  assert.deepEqual([r.totalNew, r.noTranscript], [0, 1]);
  assert.equal(existsSync(path.join(outputDir, 'seen.json')), false);
});

test('refuses to start without the keys or with a bad cap', async () => {
  const outputDir = await tmp();
  await assert.rejects(scrapeBrightdata(SOURCES, { outputDir, env: {}, api: apiFor(IDS), log: quiet }), /BRIGHTDATA_API_KEY is not set/);
  await assert.rejects(scrapeBrightdata(SOURCES, { outputDir, env: ENV, api: apiFor(IDS), maxRecords: 0, log: quiet }), /brightdata_max_records/);
  await assert.rejects(scrapeBrightdata(SOURCES, { outputDir, env: ENV, api: apiFor(IDS), maxRecords: NaN, log: quiet }), /brightdata_max_records/);
  const saved = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    await assert.rejects(scrapeBrightdata(SOURCES, { outputDir, env: ENV, log: quiet }), /YOUTUBE_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.YOUTUBE_API_KEY = saved;
  }
  assert.throws(() => makeClient({ key: '' }), /BRIGHTDATA_API_KEY/);
});

test('discoverNew: searches, single videos, channels; dedup across sources; a failing source is skipped', async () => {
  const calls = [];
  const api = {
    searchVideos: async (q, o) => { calls.push(['search', q, o.limit]); return [{ id: 'aaaaaaaaaaa' }, { id: 'bbbbbbbbbbb' }]; },
    discoverVideos: async (src, o) => {
      calls.push(['channel', src, o.sinceHours, o.limit]);
      if (src.endsWith('UCxxxxxxxxxxxxxxxxxxxxxx')) throw new Error('quota');
      return [{ id: 'bbbbbbbbbbb' }, { id: 'ccccccccccc' }];
    },
  };
  const ledger = { hasSeen: (id) => id === 'ccccccccccc' };
  const logs = [];
  const out = await discoverNew([
    'ytsearch3:Madden 27 how to beat the Bills',
    'https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw',
    'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx',
    'https://www.youtube.com/watch?v=ddddddddddd',
    'https://www.youtube.com/c/vanity',
  ], { sinceHours: 72, limit: 3, ledger, api, log: (m) => logs.push(m) });
  assert.deepEqual(out.map(v => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ddddddddddd']);
  assert.deepEqual(calls[0], ['search', 'Madden 27 how to beat the Bills', 3]);
  assert.deepEqual(calls[1], ['channel', 'https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw', 72, 3]);
  assert.ok(logs.some(l => /UCxxx.*discovery failed \(quota\)/.test(l)));
  assert.ok(logs.some(l => /\/c\/vanity: not discoverable/.test(l)));
});
