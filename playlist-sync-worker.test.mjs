import assert from 'node:assert/strict';
import worker from './playlist-sync-worker.mjs';

const ids = Array.from({ length: 205 }, (_, i) => 'v' + String(i).padStart(10, '0'));
let failPage = -1;
const kv = {
  value: null, writes: 0,
  async get() { return this.value; },
  async put(_key, value) { this.writes++; this.value = value; }
};
const env = { YOUTUBE_API_KEY: 'test-only-not-a-real-key', ADMIN_TOKEN: 'test-admin-token', PLAYLIST_KV: kv };

globalThis.fetch = async input => {
  const url = new URL(input);
  if (url.hostname !== 'www.googleapis.com' || url.searchParams.get('key') !== env.YOUTUBE_API_KEY) throw new Error('unexpected API request');
  if (url.pathname.endsWith('/playlistItems')) {
    const pageNo = url.searchParams.get('pageToken') ? Number(url.searchParams.get('pageToken').slice(1)) : 0;
    if (pageNo === failPage) return Response.json({ error: { message: 'simulated failure' } }, { status: 503 });
    const items = ids.slice(pageNo * 50, pageNo * 50 + 50).map((id, i) => ({
      contentDetails: { videoId: id },
      snippet: { title: 'track ' + (pageNo * 50 + i), publishedAt: '2026-01-01T00:00:00Z', thumbnails: {} }
    }));
    return Response.json({ items, pageInfo: { totalResults: ids.length }, ...(pageNo < 4 ? { nextPageToken: 'p' + (pageNo + 1) } : {}) });
  }
  if (url.pathname.endsWith('/videos')) {
    return Response.json({ items: url.searchParams.get('id').split(',').map(id => ({
      id, snippet: { title: 'verified ' + id, description: 'metadata', publishedAt: '2025-12-31T00:00:00Z', tags: ['praise'], thumbnails: {} },
      contentDetails: { duration: 'PT5M2S' }, statistics: { viewCount: '42', likeCount: '4', commentCount: '2' }
    })) });
  }
  throw new Error('unexpected URL');
};

await worker.scheduled({}, env, {});
assert.equal(kv.writes, 1, 'successful full sync writes once');
let snapshot = JSON.parse(kv.value);
assert.equal(snapshot.count, 205, 'all playlist pages collected');
assert.equal(snapshot.tracks.length, 205);
assert.equal(snapshot.tracks[0].title, 'verified v0000000000', 'video metadata enriched');
assert.equal(snapshot.tracks[0].duration, 302, 'duration parsed');
assert.equal(snapshot.tracks[0].views, 42);

const previous = kv.value;
failPage = 2;
await assert.rejects(worker.scheduled({}, env, {}), /YouTube API request failed/);
assert.equal(kv.value, previous, 'partial page failure retains previous snapshot');
assert.equal(kv.writes, 1, 'failed sync never writes partial data');

failPage = -1;
let response = await worker.fetch(new Request('https://worker.example/api/sync', { method: 'POST' }), env);
assert.equal(response.status, 401, 'manual sync requires admin token');
response = await worker.fetch(new Request('https://worker.example/api/playlist', { headers: { Origin: 'https://subinan0204.github.io' } }), env);
assert.equal(response.status, 200, 'public JSON endpoint serves snapshot');
assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://subinan0204.github.io');
assert.equal((await response.json()).count, 205);
response = await worker.fetch(new Request('https://worker.example/api/sync', { method: 'POST', headers: { Authorization: 'Bearer test-admin-token' } }), env);
assert.equal(response.status, 200, 'authorized manual sync succeeds');
assert.equal(kv.writes, 2);
console.log('PASS: 11 Worker assertions (205-item pagination, detail enrichment, atomic failure retention, CORS, protected manual sync).');
