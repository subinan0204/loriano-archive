const PLAYLIST_ID = 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-';
const SNAPSHOT_KEY = 'playlist:snapshot:v1';
const ALLOWED_ORIGIN = 'https://subinan0204.github.io';
const MAX_PAGES = 100;

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
};

function reply(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
  });
}

function seconds(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  return m ? Math.round(Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)) : 0;
}

async function youtubeJson(url, env) {
  url.searchParams.set('key', env.YOUTUBE_API_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    let body;
    try { body = await response.json(); } catch { throw new Error('YouTube returned invalid JSON'); }
    if (!response.ok || body?.error) throw new Error('YouTube API request failed (' + response.status + ')');
    return body;
  } finally { clearTimeout(timer); }
}

async function createSnapshot(env) {
  if (!env.YOUTUBE_API_KEY || !env.PLAYLIST_KV) throw new Error('Worker configuration is incomplete');
  const rawItems = [];
  const seenTokens = new Set();
  let token = '';
  let expectedTotal = null;
  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
    if (seenTokens.has(token)) throw new Error('YouTube returned a repeated page token');
    seenTokens.add(token);
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', PLAYLIST_ID);
    url.searchParams.set('maxResults', '50');
    if (token) url.searchParams.set('pageToken', token);
    const body = await youtubeJson(url, env);
    if (!Array.isArray(body.items) || !Number.isInteger(body.pageInfo?.totalResults)) throw new Error('YouTube returned an incomplete playlist page');
    if (expectedTotal === null) expectedTotal = body.pageInfo.totalResults;
    if (body.pageInfo.totalResults !== expectedTotal) throw new Error('Playlist changed while pages were being read');
    rawItems.push(...body.items);
    token = body.nextPageToken || '';
    if (!token) break;
    if (pageNo === MAX_PAGES - 1) throw new Error('Playlist exceeded the pagination safety limit');
  }
  if (expectedTotal === null || rawItems.length !== expectedTotal) throw new Error('Playlist pagination did not return every item');

  const byId = new Map();
  for (const item of rawItems) {
    const id = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
    if (!/^[\w-]{11}$/.test(id)) continue;
    const snippet = item.snippet || {};
    if (['Private video', 'Deleted video'].includes(snippet.title)) continue;
    if (!byId.has(id)) byId.set(id, {
      id,
      title: String(snippet.title || 'YouTube 영상').slice(0, 500),
      publishedAt: snippet.publishedAt || new Date(0).toISOString(),
      thumbnail: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      description: '', duration: 0, shorts: false, views: 0, likes: 0, comments: 0, tags: [], sample: false
    });
  }
  if (!byId.size) throw new Error('Playlist contained no usable video IDs; previous snapshot retained');

  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('maxResults', '50');
    const body = await youtubeJson(url, env);
    if (!Array.isArray(body.items)) throw new Error('YouTube returned incomplete video details');
    for (const video of body.items) {
      if (!byId.has(video.id)) continue;
      const row = byId.get(video.id);
      const snippet = video.snippet || {};
      const statistics = video.statistics || {};
      const thumbs = snippet.thumbnails || {};
      const duration = seconds(video.contentDetails?.duration);
      row.title = String(snippet.title || row.title).slice(0, 500);
      row.description = String(snippet.description || '').slice(0, 10000);
      row.publishedAt = snippet.publishedAt || row.publishedAt;
      row.thumbnail = (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default)?.url || row.thumbnail;
      row.duration = duration;
      row.shorts = duration > 0 && duration <= 180;
      row.views = Number(statistics.viewCount || 0);
      row.likes = Number(statistics.likeCount || 0);
      row.comments = Number(statistics.commentCount || 0);
      row.tags = Array.isArray(snippet.tags) ? snippet.tags.slice(0, 100) : [];
    }
  }

  const tracks = [...byId.values()];
  if (!tracks.length || tracks.some(track => !/^[\w-]{11}$/.test(track.id))) throw new Error('Snapshot validation failed');
  const snapshot = { schema: 1, playlistId: PLAYLIST_ID, updatedAt: new Date().toISOString(), count: tracks.length, tracks };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 20_000_000) throw new Error('Snapshot exceeded the safe storage size');
  // Single KV write only after all pages, metadata batches, and validation succeed.
  await env.PLAYLIST_KV.put(SNAPSHOT_KEY, serialized, { metadata: { schema: 1, updatedAt: snapshot.updatedAt, count: tracks.length } });
  return snapshot;
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/health' && request.method === 'GET') {
    const value = await env.PLAYLIST_KV?.get(SNAPSHOT_KEY);
    let snapshot;
    try { snapshot = value ? JSON.parse(value) : null; } catch { snapshot = null; }
    return reply(200, { ok: true, configured: !!(env.YOUTUBE_API_KEY && env.PLAYLIST_KV), hasSnapshot: !!snapshot, updatedAt: snapshot?.updatedAt || null, count: snapshot?.count || 0 });
  }
  if (url.pathname === '/api/playlist' && request.method === 'GET') {
    const value = await env.PLAYLIST_KV?.get(SNAPSHOT_KEY);
    if (!value) return reply(503, { error: 'Playlist has not been synchronized yet' });
    let snapshot;
    try { snapshot = JSON.parse(value); } catch { return reply(503, { error: 'Stored playlist snapshot is invalid' }); }
    if (snapshot?.schema !== 1 || snapshot?.playlistId !== PLAYLIST_ID || !Array.isArray(snapshot.tracks) || !snapshot.tracks.length || snapshot.count !== snapshot.tracks.length) return reply(503, { error: 'Stored playlist snapshot failed validation' });
    return reply(200, snapshot, { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=600' });
  }
  if (url.pathname === '/api/sync' && request.method === 'POST') {
    const provided = request.headers.get('Authorization') || '';
    const expected = env.ADMIN_TOKEN ? 'Bearer ' + env.ADMIN_TOKEN : '';
    if (!expected || provided !== expected) return reply(401, { error: 'Unauthorized' });
    try {
      const snapshot = await createSnapshot(env);
      return reply(200, { ok: true, updatedAt: snapshot.updatedAt, count: snapshot.count });
    } catch (error) {
      console.error('Manual sync failed; previous snapshot was retained:', error?.message || 'unknown error');
      return reply(502, { error: 'Playlist synchronization failed; the previous snapshot was retained' });
    }
  }
  return reply(404, { error: 'Not found' });
}

export default {
  async fetch(request, env) { return handleFetch(request, env); },
  async scheduled(_event, env, _ctx) {
    try {
      const snapshot = await createSnapshot(env);
      console.log('Scheduled playlist sync succeeded:', snapshot.count, 'tracks');
    } catch (error) {
      console.error('Scheduled sync failed; previous snapshot was retained:', error?.message || 'unknown error');
      throw error;
    }
  }
};
