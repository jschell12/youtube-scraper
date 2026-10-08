import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  pushTranscripts, readPushed, accessHeadersFromEnv, PushError, PUSH_LEDGER, MAX_BODY_BYTES,
} from '../lib/push.js';

const URL_ = 'https://pfe.example/api/ingest/transcript';
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nrun the mesh\n';

async function fixture(videos) {
  const dir = await mkdtemp(path.join(tmpdir(), 'push-'));
  for (const [day, id, srt = SRT] of videos) {
    const dayDir = path.join(dir, day);
    await mkdir(dayDir, { recursive: true });
    await writeFile(path.join(dayDir, `${id}-slug.srt`), srt);
    await writeFile(path.join(dayDir, `_video-${id}.json`), JSON.stringify({
      video_id: id, channel_id: 'UCx', channel_title: 'Chan', title: `T ${id}`,
      url: `https://www.youtube.com/watch?v=${id}`, published_at: '2026-10-01', srt_file: `${id}-slug.srt`,
    }));
  }
  return dir;
}

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responder(calls.length, JSON.parse(init.body));
  };
  fn.calls = calls;
  return fn;
}
const ok = (id) => new Response(JSON.stringify({ video_id: id, status: 'created' }), { status: 201 });

test('posts the contract body with auth headers, oldest day first', async () => {
  const dir = await fixture([['2026-10-02', 'bbbbbbbbbbb'], ['2026-10-01', 'aaaaaaaaaaa']]);
  const f = fakeFetch((_, b) => ok(b.video_id));
  const res = await pushTranscripts({
    outputDir: dir, url: URL_, headers: { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 's' },
    fetchImpl: f, log: () => {},
  });
  assert.equal(res.pushed, 2);
  assert.deepEqual(f.calls.map(c => c.body.video_id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(),
    ['channel_id', 'channel_title', 'published_at', 'srt', 'title', 'url', 'video_id']);
  assert.equal(f.calls[0].body.srt, SRT);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers['CF-Access-Client-Id'], 'id');
  assert.equal(f.calls[0].init.headers['content-type'], 'application/json');
});

test('is resumable: a second run sends nothing, ledger is append-only', async () => {
  const dir = await fixture([['2026-10-01', 'aaaaaaaaaaa']]);
  await pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: fakeFetch((_, b) => ok(b.video_id)), log: () => {} });
  const before = await readFile(path.join(dir, PUSH_LEDGER), 'utf8');
  const f = fakeFetch((_, b) => ok(b.video_id));
  const res = await pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: f, log: () => {} });
  assert.equal(f.calls.length, 0);
  assert.equal(res.skipped, 1);
  const rec = JSON.parse(before.trim());
  assert.equal(rec.video_id, 'aaaaaaaaaaa');
  assert.equal(rec.status, 'created');
  assert.equal(await readFile(path.join(dir, PUSH_LEDGER), 'utf8'), before);
});

test('stops at the first non-2xx and records only what was accepted', async () => {
  const dir = await fixture([['2026-10-01', 'aaaaaaaaaaa'], ['2026-10-02', 'bbbbbbbbbbb'], ['2026-10-03', 'ccccccccccc']]);
  const f = fakeFetch((n, b) => (n === 2 ? new Response('forbidden by access', { status: 403 }) : ok(b.video_id)));
  await assert.rejects(
    pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: f, log: () => {} }),
    (err) => err instanceof PushError && err.status === 403 && err.videoId === 'bbbbbbbbbbb' && /HTTP 403/.test(err.message),
  );
  assert.equal(f.calls.length, 2);
  const done = await readPushed(dir);
  assert.deepEqual([...done], [`${URL_}\taaaaaaaaaaa`]);

  // Next run resumes at the failed video.
  const g = fakeFetch((_, b) => ok(b.video_id));
  await pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: g, log: () => {} });
  assert.deepEqual(g.calls.map(c => c.body.video_id), ['bbbbbbbbbbb', 'ccccccccccc']);
});

test('network errors stop the run too', async () => {
  const dir = await fixture([['2026-10-01', 'aaaaaaaaaaa']]);
  const f = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: f, log: () => {} }), /request failed/);
});

test('oversize bodies are skipped locally, not sent', async () => {
  const dir = await fixture([['2026-10-01', 'aaaaaaaaaaa', 'x'.repeat(MAX_BODY_BYTES + 1)], ['2026-10-02', 'bbbbbbbbbbb']]);
  const f = fakeFetch((_, b) => ok(b.video_id));
  const res = await pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: f, log: () => {} });
  assert.equal(res.oversize, 1);
  assert.deepEqual(f.calls.map(c => c.body.video_id), ['bbbbbbbbbbb']);
});

test('dry run and limit send nothing / bound the run', async () => {
  const dir = await fixture([['2026-10-01', 'aaaaaaaaaaa'], ['2026-10-02', 'bbbbbbbbbbb']]);
  const f = fakeFetch((_, b) => ok(b.video_id));
  const dry = await pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: f, dryRun: true, log: () => {} });
  assert.equal(dry.pushed, 2);
  assert.equal(f.calls.length, 0);
  const lim = await pushTranscripts({ outputDir: dir, url: URL_, fetchImpl: f, limit: 1, log: () => {} });
  assert.equal(lim.pushed, 1);
  assert.equal(lim.pending, 1);
});

test('log lines never contain header values', async () => {
  const dir = await fixture([['2026-10-01', 'aaaaaaaaaaa']]);
  const lines = [];
  await pushTranscripts({
    outputDir: dir, url: URL_, headers: { 'CF-Access-Client-Secret': 'sekrit-value' },
    fetchImpl: fakeFetch((_, b) => ok(b.video_id)), log: (m) => lines.push(m),
  });
  assert.ok(!lines.join('\n').includes('sekrit-value'));
  assert.ok(!(await readFile(path.join(dir, PUSH_LEDGER), 'utf8')).includes('sekrit-value'));
});

test('accessHeadersFromEnv: both, neither, or a clear error', () => {
  assert.deepEqual(accessHeadersFromEnv({}, 'A', 'B'), {});
  assert.deepEqual(accessHeadersFromEnv({ A: 'i', B: 's' }, 'A', 'B'),
    { 'CF-Access-Client-Id': 'i', 'CF-Access-Client-Secret': 's' });
  assert.throws(() => accessHeadersFromEnv({ A: 'i' }, 'A', 'B'), (e) => /B is not set/.test(e.message) && !e.message.includes('i '));
});
