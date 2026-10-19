import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scrape, NO_CAPTION_STREAK } from '../lib/scrape.js';

const noop = async () => {};

test('a streak of new videos without captions stops the run as rate-limited', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'yt-'));
  let fetched = 0;
  const fetch = async () => { fetched++; return Array.from({ length: 3 }, (_, i) => ({ id: `v${fetched}-${i}`, title: 't', transcript: '' })); };
  const r = await scrape(['a', 'b', 'c', 'd'], { outputDir, fetch, deps: noop, summarize: false });
  assert.equal(r.rateLimited, true);
  assert.equal(fetched, Math.ceil(NO_CAPTION_STREAK / 3));       // stopped before fetching every source
});

test('sources are spaced by gapSeconds, none before the first', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'yt-'));
  const waits = [];
  const r = await scrape(['a', 'b', 'c'], { outputDir, fetch: async () => [], deps: noop, gapSeconds: 20,
                                           wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [20000, 20000]);
  assert.equal(r.rateLimited, false);
});
