import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scrapeBrightdata, discoverNew, rowToVideo, ATTEMPTS_FILE } from '../lib/brightdata.js';
import { excludedChannels, isExcludedSource } from '../lib/exclude.js';
import { loadConfig } from '../lib/config.js';
import { pushTranscripts, PUSH_LEDGER } from '../lib/push.js';
import { scrape } from '../lib/scrape.js';
import { Ledger } from '../lib/ledger.js';
import * as youtubeApi from '../lib/youtube-api.js';

// Recorded responses (2026-10-19); see test/fixtures/brightdata/README.md. Both happen to carry an excluded
// channel: the search for "Madden 27 how to beat the Bills" returned a HuddleGG video as its third hit, and
// the BrightData snapshot's second row is a Madden School video.
const BD = new URL('./fixtures/brightdata/', import.meta.url);
const YT = new URL('./fixtures/youtube-api/', import.meta.url);
const json = (base, f) => JSON.parse(readFileSync(new URL(f, base), 'utf8'));
const ROWS = json(BD, 'snapshot-sd_mvfl47b4i0700m0pb.json');
const READY = json(BD, 'progress-ready.json');
const TRIGGERED = json(BD, 'scrape-202.json');
const SEARCH = json(YT, 'search-madden-27-how-to-beat-the-bills.json');
const PLAYLIST = json(YT, 'playlistitems-UUBJb4FwDLbfJzArYeM42Qiw.json');

const MADDEN_SCHOOL = 'UCwZLmiLcq6QA7GD67NpGXhg';
const HUDDLEGG = 'UCIYBt_UqUqiXs-RZDYLC0sw';
const KURT = 'UCBJb4FwDLbfJzArYeM42Qiw';
const EXCLUDE = new Set([MADDEN_SCHOOL, HUDDLEGG]);
const IDS = ROWS.map(r => r.video_id);                                       // elE_XUEp320, z3QqntIenCI, cmdbjLA8z2Y
const SCHOOL_ID = ROWS.find(r => r.youtuber_id === MADDEN_SCHOOL).video_id;  // z3QqntIenCI
const HUDDLE_HIT = SEARCH.items.find(i => i.snippet.channelId === HUDDLEGG).id.videoId;   // bGZkRvkwX6Q

const ENV = { BRIGHTDATA_API_KEY: 'test-key-0123456789abcdef' };
const quiet = () => {};
const noWait = async () => {};
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'excl-'));
const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

/** BrightData fetch by route; records each trigger body. */
function bdFetch(rows) {
  const triggers = [];
  const fn = async (url, init = {}) => {
    const route = new URL(url).pathname.split('/')[3];
    if (route === 'trigger') { triggers.push(JSON.parse(init.body).map(b => b.url.slice(-11))); return new Response(JSON.stringify(TRIGGERED)); }
    if (route === 'progress') return new Response(JSON.stringify(READY));
    if (route === 'snapshot') return new Response(JSON.stringify(rows));
    throw new Error(`unexpected route ${route}`);
  };
  fn.triggers = triggers;
  return fn;
}

/** Answer every Data API request with `body` for the duration of fn. */
async function withDataApi(body, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
  process.env.YOUTUBE_API_KEY ??= 'test-yt-key';
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('a search hit from an excluded channel is dropped before it is bought; the other hits are not', async () => {
  const outputDir = await tmp();
  const f = bdFetch(ROWS.filter(r => r.youtuber_id !== MADDEN_SCHOOL));
  const r = await withDataApi(SEARCH, () => scrapeBrightdata(['ytsearch3:Madden 27 how to beat the Bills'], {
    outputDir, env: ENV, fetchImpl: f, api: youtubeApi, wait: noWait, exclude: EXCLUDE,
    summarize: false, forceCategory: 'madden', log: quiet,
  }));
  assert.equal(f.triggers.length, 1);
  assert.deepEqual(f.triggers[0], ['E3fHnxeUzCY', 'Fj5DKdZhgXY']);
  assert.ok(!f.triggers[0].includes(HUDDLE_HIT));
  assert.equal(r.submitted, 2);

  // and without the list the same recorded search keeps all three, so the drop is the exclusion's doing
  const all = await withDataApi(SEARCH, () => discoverNew(['ytsearch3:Madden 27 how to beat the Bills'],
    { ledger: { hasSeen: () => false }, api: youtubeApi, log: quiet }));
  assert.deepEqual(all.map(v => v.id), ['E3fHnxeUzCY', 'Fj5DKdZhgXY', HUDDLE_HIT]);
});

test('playlist hits carry the video owner channel and are dropped when it is excluded', async () => {
  const src = 'https://www.youtube.com/playlist?list=UUBJb4FwDLbfJzArYeM42Qiw';
  const ledger = { hasSeen: () => false };
  const kept = await withDataApi(PLAYLIST, () => discoverNew([src], { sinceHours: 0, limit: 3, ledger, api: youtubeApi, exclude: EXCLUDE, log: quiet }));
  assert.equal(kept.length, 3);
  const dropped = await withDataApi(PLAYLIST, () => discoverNew([src], { sinceHours: 0, limit: 3, ledger, api: youtubeApi, exclude: new Set([KURT]), log: quiet }));
  assert.deepEqual(dropped, []);
});

test('an excluded channel source is never listed', async () => {
  const listed = [];
  const api = { searchVideos: async () => [], discoverVideos: async (src) => { listed.push(src); return []; } };
  const sources = [`https://www.youtube.com/channel/${MADDEN_SCHOOL}`, `https://www.youtube.com/channel/${KURT}`];
  await discoverNew(sources, { ledger: { hasSeen: () => false }, api, exclude: EXCLUDE, log: quiet });
  assert.deepEqual(listed, [`https://www.youtube.com/channel/${KURT}`]);
  assert.equal(isExcludedSource(`https://www.youtube.com/channel/${HUDDLEGG}/videos`, EXCLUDE), true);
  assert.equal(isExcludedSource(watch(SCHOOL_ID), EXCLUDE), false);   // a video URL names no channel
});

test('a BrightData row from an excluded channel is not written, marked seen, or bought again', async () => {
  const outputDir = await tmp();
  // explicit video URLs: no channel is known until the row comes back, so the row check is the only guard
  const sources = IDS.map(watch);
  const f = bdFetch(ROWS);
  const r = await scrapeBrightdata(sources, {
    outputDir, env: ENV, fetchImpl: f, api: { searchVideos: async () => [], discoverVideos: async () => [] },
    wait: noWait, keepSrt: true, exclude: EXCLUDE, summarize: false, forceCategory: 'madden', log: quiet,
  });
  assert.deepEqual(f.triggers[0], IDS);
  assert.deepEqual([r.totalNew, r.excluded], [2, 1]);

  const files = await readdir(r.dayDir);
  assert.deepEqual(files.filter(n => n.includes(SCHOOL_ID)), []);
  for (const id of IDS.filter(i => i !== SCHOOL_ID)) assert.ok(files.includes(`_video-${id}.json`), id);
  const seen = JSON.parse(await readFile(path.join(outputDir, 'seen.json'), 'utf8'));
  assert.deepEqual(Object.keys(seen).sort(), IDS.filter(i => i !== SCHOOL_ID).sort());
  const attempts = JSON.parse(await readFile(path.join(outputDir, ATTEMPTS_FILE), 'utf8'));
  assert.deepEqual([attempts[SCHOOL_ID].given_up, attempts[SCHOOL_ID].last], [true, 'excluded channel']);

  const again = bdFetch(ROWS);
  const r2 = await scrapeBrightdata(sources, { outputDir, env: ENV, fetchImpl: again,
    api: { searchVideos: async () => [], discoverVideos: async () => [] }, exclude: EXCLUDE, log: quiet });
  assert.deepEqual([again.triggers.length, r2.submitted], [0, 0]);
});

test('push skips a sidecar from an excluded channel that an earlier scrape wrote, and does not mark it pushed', async () => {
  const outputDir = await tmp();
  // written before the channel was excluded: all three sidecars are on disk
  await scrapeBrightdata(IDS.map(watch), { outputDir, env: ENV, fetchImpl: bdFetch(ROWS),
    api: { searchVideos: async () => [], discoverVideos: async () => [] }, wait: noWait, keepSrt: true,
    summarize: false, forceCategory: 'madden', log: quiet });

  const sent = [];
  const fetchImpl = async (_url, init) => {
    const id = JSON.parse(init.body).video_id;
    sent.push(id);
    return new Response(JSON.stringify({ video_id: id, status: 'queued' }), { status: 200 });
  };
  const url = 'https://pfe.example/api/ingest/transcript';
  const res = await pushTranscripts({ outputDir, url, exclude: EXCLUDE, fetchImpl, log: quiet });
  assert.deepEqual([res.pushed, res.excluded, res.pending], [2, 1, 0]);
  assert.ok(!sent.includes(SCHOOL_ID));
  assert.deepEqual(sent.sort(), IDS.filter(i => i !== SCHOOL_ID).sort());
  const ledger = await readFile(path.join(outputDir, PUSH_LEDGER), 'utf8');
  assert.ok(!ledger.includes(SCHOOL_ID));

  // the other boundary: without the list that sidecar is the one thing left to send
  sent.length = 0;
  const open = await pushTranscripts({ outputDir, url, fetchImpl, log: quiet });
  assert.deepEqual([open.pushed, sent], [1, [SCHOOL_ID]]);
});

test('yt-dlp scrape: an excluded channel source is not fetched and a fetched excluded video is not written', async () => {
  const outputDir = await tmp();
  const fetched = [];
  const fetch = async (url) => { fetched.push(url); return ROWS.map(rowToVideo); };   // real rows, the yt-dlp video shape
  const r = await scrape([`https://www.youtube.com/channel/${MADDEN_SCHOOL}`, 'ytsearch3:Madden 27'], {
    outputDir, fetch, deps: async () => {}, exclude: EXCLUDE, summarize: false, forceCategory: 'madden', keepSrt: true,
  });
  assert.deepEqual(fetched, ['ytsearch3:Madden 27']);
  assert.deepEqual([r.totalNew, r.totalExcluded], [2, 1]);
  const ledger = await new Ledger(path.join(outputDir, 'seen.json')).load();
  assert.equal(ledger.hasSeen(SCHOOL_ID), false);
  assert.equal(ledger.hasSeen(IDS[0]), true);
  assert.equal(existsSync(path.join(r.dayDir, `_video-${SCHOOL_ID}.json`)), false);
});

test('exclude_channels: config.madden.yaml lists both channels and no longer scrapes them', async () => {
  const config = await loadConfig(new URL('../config.madden.yaml', import.meta.url).pathname);
  assert.deepEqual([...excludedChannels(config)].sort(), [HUDDLEGG, MADDEN_SCHOOL].sort());
  const sources = [...config.channels, ...(config.playlists || []), ...(config.videos || [])];
  assert.ok(sources.length > 0);
  assert.ok(sources.every(s => !s.includes(MADDEN_SCHOOL) && !s.includes(HUDDLEGG)), sources.join(' '));
});

test('exclude_channels: missing or empty is no exclusion; a malformed id fails loudly', () => {
  assert.equal(excludedChannels({}).size, 0);
  assert.equal(excludedChannels({ exclude_channels: [] }).size, 0);
  assert.throws(() => excludedChannels({ exclude_channels: ['UCwZLmiLcq6QA7GD67NpGX'] }), /not a channel id/);
  assert.throws(() => excludedChannels({ exclude_channels: [`https://www.youtube.com/channel/${HUDDLEGG}`] }), /not a channel id/);
});
