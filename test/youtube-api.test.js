import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverVideos, searchVideos, uploadsPlaylistId } from '../lib/youtube-api.js';

// Recorded Data API v3 responses (2026-10-19); see test/fixtures/brightdata/README.md.
const FX = new URL('./fixtures/youtube-api/', import.meta.url);
const PLAYLIST = JSON.parse(readFileSync(new URL('playlistitems-UUBJb4FwDLbfJzArYeM42Qiw.json', FX), 'utf8'));
const SEARCH = JSON.parse(readFileSync(new URL('search-madden-27-how-to-beat-the-bills.json', FX), 'utf8'));

/** Swap global fetch and Date.now for one test; every request URL is recorded. */
async function withFetch(body, fn, { now } = {}) {
  const realFetch = globalThis.fetch, realNow = Date.now, urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(url)); return new Response(JSON.stringify(body), { status: 200 }); };
  if (now) Date.now = () => now;
  process.env.YOUTUBE_API_KEY ??= 'test-yt-key';
  try {
    return await fn(urls);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

test('a channel id source goes straight to its UU uploads playlist, no channels.list call', async () => {
  assert.equal(await uploadsPlaylistId({ kind: 'channelId', value: 'UCBJb4FwDLbfJzArYeM42Qiw' }), 'UUBJb4FwDLbfJzArYeM42Qiw');
  await withFetch(PLAYLIST, async (urls) => {
    const v = await discoverVideos('https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw', { sinceHours: 0, limit: 3 });   // limit 3 stops at the first page
    assert.deepEqual(urls.map(u => u.pathname), ['/youtube/v3/playlistItems']);
    assert.equal(urls[0].searchParams.get('playlistId'), 'UUBJb4FwDLbfJzArYeM42Qiw');
    assert.deepEqual(v.map(x => x.id), ['pEtsxVaZzu4', 'P9n7dOY0RZY', '6GN6jV27pmw']);
    assert.equal(v[0].url, 'https://www.youtube.com/watch?v=pEtsxVaZzu4');
  });
});

test('discovery honors since_hours and limit on the recorded uploads page', async () => {
  // uploads at 17:30, 16:40 and 15:24 UTC; at 18:00 a 2-hour window keeps the first two
  await withFetch(PLAYLIST, async () => {
    const v = await discoverVideos('https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw', { sinceHours: 2, limit: 50 });
    assert.deepEqual(v.map(x => x.id), ['pEtsxVaZzu4', 'P9n7dOY0RZY']);
    const one = await discoverVideos('https://www.youtube.com/channel/UCBJb4FwDLbfJzArYeM42Qiw', { sinceHours: 2, limit: 1 });
    assert.deepEqual(one.map(x => x.id), ['pEtsxVaZzu4']);
  }, { now: Date.parse('2026-10-19T18:00:00Z') });
});

test('searchVideos asks for relevance-ordered videos and returns watch URLs', async () => {
  await withFetch(SEARCH, async (urls) => {
    const v = await searchVideos('Madden 27 how to beat the Bills', { limit: 3 });
    const q = urls[0].searchParams;
    assert.equal(urls[0].pathname, '/youtube/v3/search');
    assert.deepEqual([q.get('type'), q.get('order'), q.get('maxResults'), q.get('q')],
      ['video', 'relevance', '3', 'Madden 27 how to beat the Bills']);
    assert.deepEqual(v.map(x => x.id), ['E3fHnxeUzCY', 'Fj5DKdZhgXY', 'bGZkRvkwX6Q']);
    assert.equal(v[1].url, 'https://www.youtube.com/watch?v=Fj5DKdZhgXY');
  });
});
