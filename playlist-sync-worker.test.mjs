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
      snippet: { playlistId: 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-', position: pageNo * 50 + i,
        resourceId: { kind: 'youtube#video', videoId: id },
        title: 'track ' + (pageNo * 50 + i), publishedAt: '2026-01-01T00:00:00Z', thumbnails: {} }
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
await assert.rejects(worker.scheduled({}, env, {}), /Playlist synchronization failed/);
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
console.log('PASS: base Worker regression assertions (205 items, pagination, metadata, atomic failure, CORS, authorization).');

// All requests below wrap the synthetic fetch above, never the network.
const mockFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;
const captured = [];
let scenarios = 0;
console.log = console.error = (...args) => captured.push(args.join(' '));
async function failure(name, mutate, path = 'playlistItems', transport) {
  const saved = kv.value, writes = kv.writes;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'www.googleapis.com');
    if (url.pathname.endsWith('/playlistItems')) assert.equal(url.searchParams.get('playlistId'), 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-');
    const result = await mockFetch(input, options);
    if (!url.pathname.endsWith('/' + path)) return result;
    if (transport) return transport();
    const body = await result.json();
    mutate(body, url);
    return Response.json(body);
  };
  await assert.rejects(worker.scheduled({}, env, {}), /Playlist synchronization failed/, name);
  assert.equal(kv.value, saved, name + ': last good bytes retained');
  assert.equal(kv.writes, writes, name + ': no KV writes');
  scenarios++;
}
try {
  const pageCases = [
    ['missing items', b => delete b.items], ['null item', b => { b.items[0] = null; }],
    ['empty page', b => { b.items = []; }], ['missing total', b => delete b.pageInfo],
    ['negative total', b => { b.pageInfo.totalResults = -1; }],
    ['fractional total', b => { b.pageInfo.totalResults = 205.5; }],
    ['missing next token', b => delete b.nextPageToken],
    ['object next token', b => { b.nextPageToken = {}; }],
    ['empty next token', b => { b.nextPageToken = ''; }],
    ['repeated token', b => { b.nextPageToken = 'p1'; }],
    ['oversized page', b => b.items.push(b.items[0])],
    ['invalid ID', b => { b.items[0].contentDetails.videoId = 'bad'; }],
    ['missing ID', b => delete b.items[0].contentDetails],
    ['resource mismatch', b => { b.items[0].snippet.resourceId.videoId = 'xxxxxxxxxxx'; }],
    ['wrong playlist', b => { b.items[0].snippet.playlistId = 'personal'; }],
    ['position gap', b => { b.items[0].snippet.position++; }],
    ['missing title', b => delete b.items[0].snippet.title],
    ['invalid date', b => { b.items[0].snippet.publishedAt = 'bad'; }],
    ['private video', b => { b.items[0].snippet.title = 'Private video'; }],
    ['deleted video', b => { b.items[0].snippet.title = 'Deleted video'; }],
    ['duplicate ID', b => { b.items[1].contentDetails.videoId = b.items[0].contentDetails.videoId; b.items[1].snippet.resourceId.videoId = b.items[0].contentDetails.videoId; }],
    ['changed total', (b, u) => { if (u.searchParams.has('pageToken')) b.pageInfo.totalResults--; }],
    ['extra final token', b => { if (b.items.length === 5) b.nextPageToken = 'p5'; }]
  ];
  for (const [name, mutate] of pageCases) await failure(name, mutate);
  const detailCases = [
    ['missing results', b => delete b.items], ['missing detail', b => b.items.pop()],
    ['duplicate details', b => { b.items[1] = b.items[0]; }],
    ['foreign detail', b => { b.items[0].id = 'xxxxxxxxxxx'; }],
    ['null detail', b => { b.items[0] = null; }],
    ['missing snippet', b => delete b.items[0].snippet],
    ['empty title', b => { b.items[0].snippet.title = ''; }],
    ['invalid description', b => { b.items[0].snippet.description = {}; }],
    ['invalid date', b => { b.items[0].snippet.publishedAt = 'bad'; }],
    ['invalid tags', b => { b.items[0].snippet.tags = [1]; }],
    ['invalid thumbnail', b => { b.items[0].snippet.thumbnails.high = { url: 'javascript:bad' }; }],
    ['missing stats', b => delete b.items[0].statistics],
    ['invalid count', b => { b.items[0].statistics.viewCount = 'NaN'; }],
    ['negative count', b => { b.items[0].statistics.likeCount = '-1'; }],
    ['unsafe count', b => { b.items[0].statistics.commentCount = '9007199254740992'; }],
    ['missing duration', b => delete b.items[0].contentDetails],
    ['invalid duration', b => { b.items[0].contentDetails.duration = 'PT'; }]
  ];
  for (const [name, mutate] of detailCases) await failure(name, mutate, 'videos');
  for (const [name, transport] of [
    ['HTTP failure', () => Response.json({ error: {} }, { status: 503 })],
    ['API error', () => Response.json({ error: {} })],
    ['invalid JSON', () => new Response('{')], ['null body', () => Response.json(null)],
    ['transport error', () => { throw new Error(env.YOUTUBE_API_KEY + ' ' + env.ADMIN_TOKEN); }]
  ]) await failure(name, () => {}, 'playlistItems', transport);
  await failure('self-consistent suspicious truncation', (b, u) => {
    b.pageInfo.totalResults = 100;
    if (u.searchParams.has('pageToken')) delete b.nextPageToken;
  });
  for (const count of [204, 206]) {
    const savedIds = [...ids];
    if (count === 204) ids.pop(); else ids.push('v0000000205');
    globalThis.fetch = mockFetch;
    await worker.scheduled({}, env, {});
    const s = JSON.parse(kv.value);
    assert.equal(s.count, count);
    assert.deepEqual(s.tracks.map(t => t.id), ids);
    assert.ok(s.tracks.every(t => t.shorts === null && t.description === 'metadata' && t.publishedAt === '2025-12-31T00:00:00Z'));
    ids.splice(0, ids.length, ...savedIds); scenarios++;
  }
  globalThis.fetch = async (input, options) => {
    const result = await mockFetch(input, options), b = await result.json();
    if (new URL(input).pathname.endsWith('/videos')) {
      b.items.reverse();
      for (const v of b.items) { v.statistics = {}; delete v.snippet.tags; delete v.snippet.thumbnails; v.contentDetails.duration = 'PT0S'; }
    }
    return Response.json(b);
  };
  await worker.scheduled({}, env, {});
  assert.deepEqual(JSON.parse(kv.value).tracks.map(t => t.id), ids);
  assert.equal(JSON.parse(kv.value).tracks[0].views, 0);
  assert.equal(JSON.parse(kv.value).tracks[0].duration, 0); scenarios++;
  const saved = kv.value, writes = kv.writes;
  globalThis.fetch = async () => { throw new Error(env.YOUTUBE_API_KEY); };
  response = await worker.fetch(new Request('https://worker.example/api/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN } }), env);
  assert.equal(response.status, 502); assert.equal(kv.value, saved); assert.equal(kv.writes, writes); scenarios++;
  for (const value of [null, '{', JSON.stringify({ ...JSON.parse(saved), playlistId: 'personal' }), JSON.stringify({ ...JSON.parse(saved), tracks: [{ id: 'bad' }], count: 1 })]) {
    kv.value = value;
    response = await worker.fetch(new Request('https://worker.example/api/playlist'), env);
    assert.equal(response.status, 503); assert.equal(kv.writes, writes);
  }
  kv.value = saved; scenarios++;
  response = await worker.fetch(new Request('https://worker.example/health'), env);
  assert.equal((await response.json()).count, 205);
  response = await worker.fetch(new Request('https://worker.example/api/playlist'), env);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=120, stale-while-revalidate=600');
  assert.equal((await worker.fetch(new Request('https://worker.example/api/sync', { method: 'OPTIONS' }), env)).status, 204);
  assert.equal((await worker.fetch(new Request('https://worker.example/api/sync'), env)).status, 404); scenarios++;
  const { YOUTUBE_API_KEY, ...missingKey } = env;
  await assert.rejects(worker.scheduled({}, missingKey, {}));
  assert.equal(kv.value, saved); assert.equal(kv.writes, writes); scenarios++;
  globalThis.fetch = mockFetch;
  const get = kv.get;
  kv.get = async () => { throw new Error(env.YOUTUBE_API_KEY); };
  await assert.rejects(worker.scheduled({}, env, {}));
  assert.equal(kv.value, saved); assert.equal(kv.writes, writes); kv.get = get; scenarios++;
  assert.ok(captured.length);
  assert.ok(!captured.join(' ').includes(env.YOUTUBE_API_KEY));
  assert.ok(!captured.join(' ').includes(env.ADMIN_TOKEN)); scenarios++;
  originalLog('PASS: ' + scenarios + ' additional Worker safety scenarios; synthetic API only; no live requests.');
} finally {
  globalThis.fetch = mockFetch;
  console.log = originalLog;
  console.error = originalError;
}

// Proxy security regression tests. The upstream is always synthetic and KV must be untouched.
const proxyOriginalFetch = globalThis.fetch;
const channel = 'UCusi43_1xufJnixaugM4_Ng';
const uploads = 'UUusi43_1xufJnixaugM4_Ng';
let proxyCases = 0, proxyCalls = [], proxyMutate = () => {}, proxyTransport = null;
const proxyEnv = { YOUTUBE_API_KEY: 'synthetic-proxy-secret', ADMIN_TOKEN: 'synthetic-proxy-admin',
  PLAYLIST_KV: { async get() { throw new Error('Proxy must not read KV'); }, async put() { throw new Error('Proxy must not write KV'); } } };
const proxyVideo = 'v0000000000';
function proxyRequest(endpoint, params, method = 'GET') {
  return new Request('https://worker.example/api/youtube/' + endpoint + '?' + new URLSearchParams(params), { method });
}
async function proxyCheck(endpoint, params, status = 200, method = 'GET') {
  proxyCalls = [];
  const r = await worker.fetch(proxyRequest(endpoint, params, method), proxyEnv);
  assert.equal(r.status, status, endpoint + ' ' + JSON.stringify(params));
  const text = await r.text();
  assert.ok(!text.includes(proxyEnv.YOUTUBE_API_KEY)); assert.ok(!text.includes(proxyEnv.ADMIN_TOKEN));
  proxyCases++;
  return { r, body: JSON.parse(text) };
}
globalThis.fetch = async input => {
  const url = new URL(input); proxyCalls.push(url);
  assert.equal(url.origin, 'https://www.googleapis.com');
  assert.equal(url.searchParams.get('key'), proxyEnv.YOUTUBE_API_KEY);
  assert.equal(url.searchParams.has('archiveVideoId'), false);
  if (proxyTransport) return proxyTransport();
  const endpoint = url.pathname.split('/').pop();
  let body;
  if (endpoint === 'channels') body = { items: [{ id: channel, snippet: { title: 'Archive' }, contentDetails: { relatedPlaylists: { uploads } } }] };
  else if (endpoint === 'playlistItems') body = { items: [{ snippet: { playlistId: url.searchParams.get('playlistId'), resourceId: { videoId: proxyVideo } } }] };
  else if (endpoint === 'videos') body = { items: url.searchParams.get('id').split(',').map(id => ({ id, snippet: { channelId: channel } })) };
  else if (endpoint === 'commentThreads') body = { items: [{ id: 'thread', snippet: { videoId: proxyVideo,
    topLevelComment: { snippet: { videoId: proxyVideo } } }, replies: { comments: [{ snippet: { videoId: proxyVideo } }] } }] };
  else if (endpoint === 'comments') body = { items: [{ id: 'reply', snippet: { videoId: proxyVideo, parentId: url.searchParams.get('parentId') } }] };
  else throw new Error('Unexpected proxy endpoint');
  proxyMutate(body, endpoint, url);
  return Response.json(body);
};
try {
  await proxyCheck('channels', { part: 'contentDetails', id: channel });
  assert.ok(proxyCalls[0].searchParams.get('part').includes('snippet'));
  await proxyCheck('channels', { part: 'snippet', forHandle: '@loriano' });
  for (const playlistId of [uploads, 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-'])
    await proxyCheck('playlistItems', { part: 'snippet', playlistId, maxResults: '50', pageToken: 'CAUQAA' });
  await proxyCheck('videos', { part: 'snippet', id: ids.slice(0, 50).join(',') });
  await proxyCheck('videos', { part: 'snippet', id: ids.slice(0, 51).join(',') }, 400);
  assert.equal(proxyCalls.length, 0);
  const result = await proxyCheck('videos', { part: 'snippet,contentDetails,statistics', id: proxyVideo });
  assert.equal(result.r.headers.get('Cache-Control'), 'public, max-age=60');
  await proxyCheck('commentThreads', { part: 'snippet,replies', videoId: proxyVideo, maxResults: '100', order: 'time', textFormat: 'plainText' });
  assert.equal(proxyCalls.length, 2); assert.equal(proxyCalls[0].pathname, '/youtube/v3/videos');
  await proxyCheck('comments', { part: 'snippet', parentId: 'Ugx_parent', archiveVideoId: proxyVideo, maxResults: '100' });
  assert.equal(proxyCalls.length, 2);
  const bad = [
    ['search', { part: 'snippet', q: 'anything' }, 404],
    ['videos', { part: 'snippet', id: proxyVideo, key: 'caller-key' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo, token: 'token' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo, access_token: 'token' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo, fields: 'items' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo, maxResults: '100000' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo, maxResults: '1.5' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo, maxResults: '0' }, 400],
    ['videos', { part: 'snippet', id: 'bad' }, 400],
    ['videos', { part: 'snippet', id: proxyVideo + ',' + proxyVideo }, 400],
    ['videos', { part: 'player', id: proxyVideo }, 400],
    ['videos', { id: proxyVideo }, 400],
    ['channels', { part: 'snippet', id: 'foreign-channel' }, 400],
    ['channels', { part: 'snippet', id: channel, forHandle: '@loriano' }, 400],
    ['channels', { part: 'snippet' }, 400],
    ['playlistItems', { part: 'snippet', playlistId: 'personal' }, 400],
    ['playlistItems', { part: 'snippet', playlistId: uploads, pageToken: 'bad token' }, 400],
    ['commentThreads', { part: 'snippet', videoId: proxyVideo, order: 'invalid' }, 400],
    ['commentThreads', { part: 'snippet', videoId: proxyVideo, textFormat: 'invalid' }, 400],
    ['commentThreads', { part: 'snippet', videoId: 'bad' }, 400],
    ['comments', { part: 'snippet', parentId: 'parent' }, 400],
    ['comments', { part: 'snippet', archiveVideoId: proxyVideo }, 400],
    ['videos', { part: 'snippet', id: proxyVideo }, 405, 'POST'],
    ['comments', { part: 'snippet', archiveVideoId: proxyVideo, parentId: 'parent' }, 405, 'DELETE']
  ];
  for (const [endpoint, params, status, method] of bad) {
    await proxyCheck(endpoint, params, status, method);
    assert.equal(proxyCalls.length, 0, 'invalid caller inputs must not spend upstream quota');
  }
  await proxyCheck('videos', [['part', 'snippet'], ['id', proxyVideo], ['id', proxyVideo]], 400);
  const selectors = {
    channels: { part: 'snippet', forHandle: '@foreign' },
    playlistItems: { part: 'snippet', playlistId: uploads },
    videos: { part: 'snippet', id: proxyVideo },
    commentThreads: { part: 'snippet,replies', videoId: proxyVideo },
    comments: { part: 'snippet', archiveVideoId: proxyVideo, parentId: 'parent' }
  };
  for (const [endpoint, mutate] of [
    ['channels', b => { b.items[0].id = 'foreign'; }],
    ['channels', b => { b.items[0].contentDetails.relatedPlaylists.uploads = 'personal'; }],
    ['playlistItems', b => { b.items[0].snippet.playlistId = 'personal'; }],
    ['videos', b => { b.items[0].snippet.channelId = 'foreign'; }],
    ['videos', b => { b.items[0].id = 'xxxxxxxxxxx'; }],
    ['videos', b => b.items.push(b.items[0])],
    ['commentThreads', b => { b.items[0].snippet.videoId = 'xxxxxxxxxxx'; }],
    ['commentThreads', b => { b.items[0].replies.comments[0].snippet.videoId = 'xxxxxxxxxxx'; }],
    ['comments', b => { b.items[0].snippet.videoId = 'xxxxxxxxxxx'; }],
    ['comments', b => { b.items[0].snippet.parentId = 'other'; }]
  ]) {
    proxyMutate = (b, actual) => { if (actual === endpoint) mutate(b); };
    await proxyCheck(endpoint, selectors[endpoint], 502);
  }
  proxyMutate = (b, actual) => { if (actual === 'videos') b.items[0].snippet.channelId = 'foreign'; };
  for (const endpoint of ['comments', 'commentThreads']) {
    await proxyCheck(endpoint, selectors[endpoint], 502);
    assert.equal(proxyCalls.length, 1, 'foreign video blocks comment fetch');
  }
  proxyMutate = b => { b.leak = proxyEnv.YOUTUBE_API_KEY; };
  await proxyCheck('videos', selectors.videos, 502);
  proxyMutate = () => {};
  for (const transport of [
    () => Response.json({ error: { message: proxyEnv.YOUTUBE_API_KEY } }, { status: 403 }),
    () => new Response('{'), () => Response.json(null),
    () => { throw new Error(proxyEnv.YOUTUBE_API_KEY); }
  ]) { proxyTransport = transport; await proxyCheck('videos', selectors.videos, 502); }
  proxyTransport = null;
  const unconfigured = await worker.fetch(proxyRequest('videos', selectors.videos), {});
  assert.equal(unconfigured.status, 503); proxyCases++;
  console.log('PASS: ' + proxyCases + ' secure YouTube proxy scenarios; no live network or KV access.');
} finally { globalThis.fetch = proxyOriginalFetch; }
