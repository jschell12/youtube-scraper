import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toVideo, publishedAt, isRateLimited, parseFlatList, parseSrt } from '../lib/extract.js';

test('toVideo keeps raw SRT, channel id and publish time', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nhello\n\n2\n00:00:02,000 --> 00:00:03,000\nhello\n';
  const v = toVideo({
    id: 'abcdefghijk', title: 'T', channel: 'Goated Millz', channel_id: 'UCq0E2VxkuCLW030arg74_jA',
    upload_date: '20261005', timestamp: 1791200000, webpage_url: 'https://www.youtube.com/watch?v=abcdefghijk',
  }, srt);
  assert.equal(v.srt, srt);
  assert.equal(v.transcript, 'hello');
  assert.equal(v.channel_id, 'UCq0E2VxkuCLW030arg74_jA');
  assert.equal(v.published_at, new Date(1791200000 * 1000).toISOString());
  assert.equal(v.upload_date, '2026-10-05');
});

test('no captions gives empty transcript (the "no transcript" skip path)', () => {
  const v = toVideo({ id: 'abcdefghijk' }, '');
  assert.equal(v.transcript, '');
  assert.equal(v.channel_id, null);
});

test('publishedAt falls back to the upload date, never invents one', () => {
  assert.equal(publishedAt({ upload_date: '20261005' }), '2026-10-05');
  assert.equal(publishedAt({}), null);
});

test('isRateLimited matches yt-dlp 429 errors only', () => {
  assert.ok(isRateLimited("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"));
  assert.ok(!isRateLimited('ERROR: [youtube] x: Video unavailable'));
  // The soft block: same "Video unavailable" prefix, but a rate limit.
  assert.ok(isRateLimited("ERROR: [youtube] x: Video unavailable. This content isn't available, try again later. " +
    'The current session has been rate-limited by YouTube for up to an hour. It is recommended to use `-t sleep`'));
  assert.ok(!isRateLimited(''));
});

test('parseFlatList keeps video ids and drops channel hits', () => {
  const out = parseFlatList([
    JSON.stringify({ id: 'abcdefghijk', title: 'How to stop the Bills' }),
    JSON.stringify({ id: 'UCq0E2VxkuCLW030arg74_jA', title: 'a channel' }),
    'not json',
  ].join('\n'));
  assert.deepEqual(out, [{ id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'How to stop the Bills' }]);
});

test('parseSrt strips timing and dedups repeats', () => {
  assert.equal(parseSrt('1\n00:00:01,000 --> 00:00:02,000\n<font>a</font>\n\n2\n00:00:02,000 --> 00:00:03,000\na\nb\n'), 'a b');
});

import { proxyUrl, withProxy } from '../lib/extract.js';

test('no proxy unless host, user and password are all set', () => {
  assert.equal(proxyUrl({}), null);
  assert.equal(proxyUrl({ BRIGHTDATA_PROXY_HOST: 'h:1', BRIGHTDATA_PROXY_USER: 'u' }), null);
  assert.deepEqual(withProxy(['-x'], {}), ['-x']);
});

test('proxy pins a sticky session per day and escapes the password', () => {
  const env = { BRIGHTDATA_PROXY_HOST: 'brd.superproxy.io:44445', BRIGHTDATA_PROXY_USER: 'brd-customer-c1-zone-isp',
                BRIGHTDATA_PROXY_PASS: 'p@ss:w/rd' };
  const url = proxyUrl(env, new Date('2026-10-12T06:37:00Z'));
  assert.equal(url, 'http://brd-customer-c1-zone-isp-session-yt20261012:p%40ss%3Aw%2Frd@brd.superproxy.io:44445');
  assert.deepEqual(withProxy(['URL'], env, new Date('2026-10-12T06:37:00Z')), ['--proxy', url, 'URL']);
  // a user that already carries a session gets it replaced, not doubled
  assert.match(proxyUrl({ ...env, BRIGHTDATA_PROXY_USER: 'brd-customer-c1-zone-isp-session-old', YTDLP_PROXY_SESSION: 'x' }),
               /zone-isp-session-x:/);
});

import { redact } from '../lib/extract.js';

test('proxy credentials never survive into an error string', () => {
  const s = 'Command failed: yt-dlp --proxy http://brd-customer-c1-zone-isp-session-x:s3cr%40t@brd.superproxy.io:44445 --x';
  assert.equal(redact(s), 'Command failed: yt-dlp --proxy http://***@brd.superproxy.io:44445 --x');
  assert.doesNotMatch(redact(s), /s3cr/);
});
