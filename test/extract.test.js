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
