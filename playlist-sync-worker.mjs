import { videoDimensions } from './video-dimensions.mjs';

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

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireData(condition, message) {
  if (!condition) throw new Error(message);
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function thumbnail(thumbnails, fallback) {
  if (thumbnails === undefined) return fallback;
  requireData(object(thumbnails), 'Invalid thumbnails');
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    if (thumbnails[key] === undefined) continue;
    const entry = thumbnails[key];
    requireData(object(entry) && typeof entry.url === 'string' && /^https:\/\/[^\s]+$/.test(entry.url), 'Invalid thumbnail URL');
  }
  return ['maxres', 'standard', 'high', 'medium', 'default'].map(key => thumbnails[key]?.url).find(Boolean) || fallback;
}
function statistic(value) {
  if (value === undefined) return 0; // YouTube may hide individual counters.
  requireData(typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)), 'Invalid video statistics');
  return Number(value);
}
function validSnapshot(value) {
  return object(value) && value.schema === 1 && value.playlistId === PLAYLIST_ID && validDate(value.updatedAt) &&
    Array.isArray(value.tracks) && value.tracks.length > 0 && value.count === value.tracks.length &&
    new Set(value.tracks.map(track => track?.id)).size === value.count &&
    value.tracks.every(track => object(track) && typeof track.id === 'string' && VIDEO_ID.test(track.id) &&
      typeof track.title === 'string' && track.title.trim() && validDate(track.publishedAt));
}

function seconds(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  requireData(typeof iso === 'string' && m && m.slice(1).some(value => value !== undefined) && !iso.endsWith('T'), 'Invalid video duration');
  const value = Math.round(Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0));
  requireData(Number.isSafeInteger(value) && value >= 0, 'Invalid video duration');
  return value;
}

async function youtubeJson(url, env, externalSignal) {
  url.searchParams.set('key', env.YOUTUBE_API_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const abortExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener('abort', abortExternal, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal });
    let body;
    try { body = await response.json(); } catch { throw new Error('YouTube returned invalid JSON'); }
    if (!response.ok || body?.error) throw new Error('YouTube API request failed (' + response.status + ')');
    requireData(object(body), 'YouTube returned an invalid response');
    return body;
  } catch {
    // Never propagate URLs, upstream bodies, or transport messages containing secrets.
    throw new Error('YouTube API request or response failed');
  } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abortExternal); }
}

async function createSnapshot(env) {
  if (typeof env.YOUTUBE_API_KEY !== 'string' || !env.YOUTUBE_API_KEY.trim() ||
    typeof env.PLAYLIST_KV?.get !== 'function' || typeof env.PLAYLIST_KV?.put !== 'function') throw new Error('Worker configuration is incomplete');
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
    requireData(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 50 &&
      Number.isSafeInteger(body.pageInfo?.totalResults) && body.pageInfo.totalResults > 0,
      'YouTube returned an incomplete playlist page');
    if (expectedTotal === null) expectedTotal = body.pageInfo.totalResults;
    requireData(body.pageInfo.totalResults === expectedTotal, 'Playlist changed while pages were being read');
    const next = body.nextPageToken;
    requireData(next === undefined || (typeof next === 'string' && next.trim().length > 0), 'Invalid next page token');
    rawItems.push(...body.items);
    requireData(rawItems.length <= expectedTotal, 'Playlist returned excess items');
    token = next || '';
    requireData(!token || rawItems.length < expectedTotal, 'Unexpected extra playlist page');
    if (!token) break;
    if (pageNo === MAX_PAGES - 1) throw new Error('Playlist exceeded the pagination safety limit');
  }
  requireData(expectedTotal !== null && rawItems.length === expectedTotal, 'Playlist pagination did not return every item');

  const byId = new Map();
  for (const [position, item] of rawItems.entries()) {
    const snippet = item?.snippet;
    const id = item?.contentDetails?.videoId;
    requireData(typeof id === 'string' && VIDEO_ID.test(id) && object(snippet) &&
      snippet.playlistId === PLAYLIST_ID && snippet.position === position &&
      snippet.resourceId?.videoId === id && snippet.resourceId?.kind === 'youtube#video' &&
      typeof snippet.title === 'string' && snippet.title.trim().length > 0 && validDate(snippet.publishedAt),
      'Invalid playlist entry or order');
    requireData(!['Private video', 'Deleted video'].includes(snippet.title), 'Playlist contains unavailable video');
    requireData(!byId.has(id), 'Playlist returned a duplicate video ID');
    byId.set(id, {
      id, title: snippet.title.slice(0, 500), publishedAt: snippet.publishedAt,
      thumbnail: thumbnail(snippet.thumbnails, 
        'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'),
      description: '', duration: 0, shorts: false, views: 0, likes: 0, comments: 0, tags: [], sample: false
    });
  }

  // A large drop needs operator investigation, not an automatic destructive replacement.
  // Use the last good count, not a permanent 205-item requirement; small edits and growth work.
  const previousValue = await env.PLAYLIST_KV.get(SNAPSHOT_KEY);
  let previous;
  try { previous = previousValue ? JSON.parse(previousValue) : null; } catch { previous = null; }
  if (validSnapshot(previous)) {
    requireData(byId.size >= Math.ceil(previous.count * 0.8), 'Suspicious playlist count decrease');
  }

  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const remaining = new Set(batch);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('maxResults', '50');
    const body = await youtubeJson(url, env);
    requireData(Array.isArray(body.items) && body.items.length === batch.length, 'Incomplete video details batch');
    for (const video of body.items) {
      requireData(object(video) && remaining.delete(video.id), 'Unexpected or duplicate video details ID');
      const row = byId.get(video.id);
      const snippet = video.snippet;
      const statistics = video.statistics;
      requireData(object(snippet) && typeof snippet.title === 'string' && snippet.title.trim().length > 0 &&
        !['Private video', 'Deleted video'].includes(snippet.title) && typeof snippet.description === 'string' &&
        validDate(snippet.publishedAt) && object(statistics) &&
        (snippet.tags === undefined || (Array.isArray(snippet.tags) && snippet.tags.every(tag => typeof tag === 'string'))),
        'Invalid video metadata');
      const duration = seconds(video.contentDetails?.duration);
      row.title = snippet.title.slice(0, 500);
      row.description = snippet.description.slice(0, 10000);
      row.publishedAt = snippet.publishedAt;
      row.thumbnail = thumbnail(snippet.thumbnails, row.thumbnail);
      row.duration = duration;
      // Duration alone cannot establish whether a video is a Short.
      row.shorts = null;
      row.views = statistic(statistics.viewCount);
      row.likes = statistic(statistics.likeCount);
      row.comments = statistic(statistics.commentCount);
      row.tags = snippet.tags?.slice(0, 100) || [];
    }
    requireData(remaining.size === 0, 'Incomplete video details batch');
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

const ARCHIVE_CHANNEL = 'UCusi43_1xufJnixaugM4_Ng';
const ARCHIVE_UPLOADS = 'UUusi43_1xufJnixaugM4_Ng';
const PROXY_PARAMS = {
  channels: ['part', 'id', 'forHandle', 'maxResults'],
  playlistItems: ['part', 'playlistId', 'maxResults', 'pageToken'],
  videos: ['part', 'id', 'maxResults'],
  commentThreads: ['part', 'videoId', 'maxResults', 'pageToken', 'order', 'textFormat'],
  comments: ['part', 'parentId', 'archiveVideoId', 'maxResults', 'pageToken', 'textFormat']
};
const PROXY_PARTS = {
  channels: ['snippet', 'contentDetails', 'statistics'],
  playlistItems: ['snippet', 'contentDetails'], videos: ['snippet', 'contentDetails', 'statistics'],
  commentThreads: ['snippet', 'replies'], comments: ['snippet']
};
async function archiveVideo(id, env, signal) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', id);
  const body = await youtubeJson(url, env, signal);
  requireData(Array.isArray(body.items) && body.items.length === 1 && body.items[0]?.id === id &&
    body.items[0]?.snippet?.channelId === ARCHIVE_CHANNEL, 'Video is outside the archive channel');
}
async function youtubeProxy(request, env, endpoint) {
  if (request.method !== 'GET') return reply(405, { error: 'Only GET is supported' }, { Allow: 'GET, OPTIONS' });
  if (!Object.hasOwn(PROXY_PARAMS, endpoint)) return reply(404, { error: 'Not found' });
  const params = new URL(request.url).searchParams;
  const upstream = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
  // Reject caller-provided keys, access tokens, duplicate parameters, and unbounded options.
  const seen = new Set();
  for (const [key, value] of params) {
    if (!PROXY_PARAMS[endpoint].includes(key) || seen.has(key) || !value || value.length > 1024)
      return reply(400, { error: 'Invalid YouTube query parameters' });
    seen.add(key);
    if (key !== 'archiveVideoId') upstream.searchParams.set(key, value);
  }
  const parts = (params.get('part') || '').split(',');
  if (parts.some(part => !PROXY_PARTS[endpoint].includes(part)) || new Set(parts).size !== parts.length)
    return reply(400, { error: 'Invalid resource parts' });
  // Channel/video ownership validation must never be bypassed by omitting snippet.
  upstream.searchParams.set('part', [...new Set([...parts, 'snippet'])].join(','));
  if (params.has('maxResults') && (!/^[1-9]\d*$/.test(params.get('maxResults')) ||
    Number(params.get('maxResults')) > (['comments', 'commentThreads'].includes(endpoint) ? 100 : 50)))
    return reply(400, { error: 'Invalid page size' });
  if (params.has('pageToken') && !/^[A-Za-z0-9_+=/-]{1,512}$/.test(params.get('pageToken')))
    return reply(400, { error: 'Invalid page token' });
  if (params.has('textFormat') && !['plainText', 'html'].includes(params.get('textFormat')))
    return reply(400, { error: 'Invalid text format' });
  if (params.has('order') && !['time', 'relevance'].includes(params.get('order')))
    return reply(400, { error: 'Invalid comment order' });
  let videoId, requestedIds;
  if (endpoint === 'channels') {
    const id = params.get('id'), handle = params.get('forHandle');
    if ((!id && !handle) || (id && handle) || (id && id !== ARCHIVE_CHANNEL) ||
      (handle && !/^@?[A-Za-z0-9_.\u0080-\uFFFF-]{1,100}$/.test(handle)))
      return reply(400, { error: 'Invalid archive channel selector' });
  } else if (endpoint === 'playlistItems') {
    if (![ARCHIVE_UPLOADS, PLAYLIST_ID].includes(params.get('playlistId')))
      return reply(400, { error: 'Playlist is outside the archive scope' });
  } else if (endpoint === 'videos') {
    requestedIds = (params.get('id') || '').split(',');
    if (requestedIds.length > 50 || new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some(id => !VIDEO_ID.test(id))) return reply(400, { error: 'Invalid video IDs' });
  } else {
    videoId = params.get(endpoint === 'comments' ? 'archiveVideoId' : 'videoId');
    if (!videoId || !VIDEO_ID.test(videoId) || (endpoint === 'comments' &&
      !/^[A-Za-z0-9_-]{1,256}$/.test(params.get('parentId') || '')))
      return reply(400, { error: 'Invalid archive comment selector' });
  }
  if (typeof env.YOUTUBE_API_KEY !== 'string' || !env.YOUTUBE_API_KEY.trim())
    return reply(503, { error: 'YouTube proxy is not configured' });
  try {
    if (videoId) await archiveVideo(videoId, env);
    const body = await youtubeJson(upstream, env);
    requireData(Array.isArray(body.items), 'Invalid resource response');
    if (endpoint === 'channels') {
      requireData(body.items.length === 1 && body.items[0]?.id === ARCHIVE_CHANNEL &&
        (body.items[0]?.contentDetails?.relatedPlaylists?.uploads === undefined ||
          body.items[0].contentDetails.relatedPlaylists.uploads === ARCHIVE_UPLOADS),
        'Channel is outside the archive scope');
    } else if (endpoint === 'playlistItems') {
      requireData(body.items.every(item => item?.snippet?.playlistId === params.get('playlistId') &&
        VIDEO_ID.test(item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || '')),
        'Invalid playlist response');
    } else if (endpoint === 'videos') {
      const returned = new Set();
      requireData(body.items.every(item => requestedIds.includes(item?.id) && !returned.has(item.id) &&
        returned.add(item.id) && item?.snippet?.channelId === ARCHIVE_CHANNEL),
        'Video is outside the archive channel');
    } else if (endpoint === 'commentThreads') {
      requireData(body.items.every(item => item?.snippet?.videoId === videoId &&
        item?.snippet?.topLevelComment?.snippet?.videoId === videoId &&
        (item.replies === undefined || (Array.isArray(item.replies?.comments) &&
          item.replies.comments.every(comment => comment?.snippet?.videoId === videoId)))),
        'Comment thread is outside the requested video');
    } else {
      requireData(body.items.every(item => item?.snippet?.videoId === videoId &&
        item?.snippet?.parentId === params.get('parentId')), 'Reply is outside the requested video');
    }
    const serialized = JSON.stringify(body);
    requireData(!serialized.includes(env.YOUTUBE_API_KEY) &&
      !(env.ADMIN_TOKEN && serialized.includes(env.ADMIN_TOKEN)), 'Unsafe upstream response');
    return reply(200, body, { 'Cache-Control': 'public, max-age=60' });
  } catch {
    // Never return upstream error bodies, URLs, credentials or transport messages.
    return reply(502, { error: 'YouTube archive request failed' });
  }
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/video-dimensions') return videoDimensions(request, env, archiveVideo, reply);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname.startsWith('/api/youtube/')) return youtubeProxy(request, env, url.pathname.slice('/api/youtube/'.length));
  if (url.pathname === '/health' && request.method === 'GET') {
    const value = await env.PLAYLIST_KV?.get(SNAPSHOT_KEY);
    let snapshot;
    try { snapshot = value ? JSON.parse(value) : null; } catch { snapshot = null; }
    return reply(200, { ok: true, dimensionsVersion: 'v1-20261118', configured: !!(env.YOUTUBE_API_KEY && env.PLAYLIST_KV), hasSnapshot: !!snapshot, updatedAt: snapshot?.updatedAt || null, count: snapshot?.count || 0 });
  }
  if (url.pathname === '/api/playlist' && request.method === 'GET') {
    const value = await env.PLAYLIST_KV?.get(SNAPSHOT_KEY);
    if (!value) return reply(503, { error: 'Playlist has not been synchronized yet' });
    let snapshot;
    try { snapshot = JSON.parse(value); } catch { return reply(503, { error: 'Stored playlist snapshot is invalid' }); }
    if (!validSnapshot(snapshot)) return reply(503, { error: 'Stored playlist snapshot failed validation' });
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
      console.error('Manual sync failed; previous snapshot was retained');
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
      console.error('Scheduled sync failed; previous snapshot was retained');
      throw new Error('Playlist synchronization failed; previous snapshot retained');
    }
  }
};
