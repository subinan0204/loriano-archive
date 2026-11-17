// Read-only public stream evidence. Never fetch stream URLs or persist player HTML.
export const DIMENSION_CHANNEL = 'UCusi43_1xufJnixaugM4_Ng';
const SOURCE = 'YouTube ytInitialPlayerResponse.streamingData';
const EXCLUDED = 'F5jQv9RPmhE';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const TTL = 3600;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value > 0 && value <= 32768;
function check(value) { if (!value) throw new Error('Invalid dimension evidence'); }

function codeAt(text, position) {
  let mode = '', escaped = false;
  for (let i = 0; i <= position; i++) {
    const c = text[i], next = text[i + 1];
    if (mode === 'line') { if (c === '\n' || c === '\r') mode = ''; else continue; }
    if (mode === 'block') { if (c === '*' && next === '/') { mode = ''; i++; } continue; }
    if (mode) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === mode) mode = '';
      continue;
    }
    if (i === position) return true;
    if (c === '/' && next === '/') { mode = 'line'; i++; }
    else if (c === '/' && next === '*') { mode = 'block'; i++; }
    else if (c === '"' || c === "'" || c === '`') mode = c;
  }
  return false;
}

// Only literal object assignments in script blocks, not arbitrary JS execution.
export function parsePlayerResponse(html) {
  check(typeof html === 'string' && html.length <= MAX_BYTES);
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  const assignment = /(?:^|[;\n\r])\s*(?:(?:var|let|const)\s+)?(?:ytInitialPlayerResponse|window\s*\[\s*["']ytInitialPlayerResponse["']\s*\]|window\.ytInitialPlayerResponse)\s*=\s*/g;
  let script, result, found = false;
  while ((script = scripts.exec(html))) {
    assignment.lastIndex = 0;
    let match, attempts = 0;
    while ((match = assignment.exec(script[1]))) {
      check(++attempts <= 16);
      // Ignore lookalikes inside JS strings, template literals and comments.
      if (!codeAt(script[1], match.index)) continue;
      check(!found); // Ambiguous/repeated assignments are not authoritative evidence.
      found = true;
      const text = script[1], start = assignment.lastIndex;
      check(text[start] === '{');
      const stack = [];
      let string = false, escape = false, end = -1;
      for (let i = start; i < text.length && i - start < MAX_JSON; i++) {
        const c = text[i];
        if (string) {
          if (escape) escape = false;
          else if (c === '\\') escape = true;
          else if (c === '"') string = false;
          continue;
        }
        if (c === '"') string = true;
        else if (c === '{' || c === '[') { stack.push(c); check(stack.length <= 128); }
        else if (c === '}' || c === ']') {
          check(stack.pop() === (c === '}' ? '{' : '['));
          if (!stack.length) { end = i + 1; break; }
        }
      }
      check(end > start);
      // JSON.parse is the sole parser; code, trailing expressions and malformed JSON fail closed.
      check(/^\s*(?:;|$)/.test(text.slice(end)));
      result = JSON.parse(text.slice(start, end));
      assignment.lastIndex = end;
    }
  }
  check(found && plain(result));
  return result;
}

function consistentStreams(streams) {
  check(Array.isArray(streams) && streams.length > 0 && streams.length <= 256);
  const seen = new Set();
  for (const s of streams) {
    check(plain(s) && Number.isSafeInteger(s.itag) && s.itag > 0 && s.itag <= 100000 &&
      integer(s.width) && integer(s.height) && !seen.has(s.itag));
    seen.add(s.itag);
  }
  const largest = [...streams].sort((a, b) => b.width * b.height - a.width * a.height || a.itag - b.itag)[0];
  for (const s of streams) {
    check(Math.sign(s.width - s.height) === Math.sign(largest.width - largest.height));
    const scale = Math.max(s.width, s.height) / Math.max(largest.width, largest.height);
    // Encoding rounds smaller resolutions. Never round or infer the chosen dimensions.
    check(Math.abs(s.width - largest.width * scale) <= 2 && Math.abs(s.height - largest.height * scale) <= 2);
  }
  return largest;
}
export function dimensionsFromPlayer(player, videoId, now = Date.now()) {
  check(player?.videoDetails?.videoId === videoId && player?.videoDetails?.channelId === DIMENSION_CHANNEL);
  const streams = [], byItag = new Map();
  for (const name of ['formats', 'adaptiveFormats']) {
    const formats = player.streamingData?.[name];
    if (formats === undefined) continue;
    check(Array.isArray(formats) && formats.length <= 256);
    for (const f of formats) {
      check(plain(f));
      if (typeof f.mimeType !== 'string' || !/^video\/[a-z0-9.+-]+(?:\s*;|$)/i.test(f.mimeType)) continue;
      // Missing dimensions mean insufficient evidence, never thumbnail/duration inference.
      check(integer(f.width) && integer(f.height));
      const s = { itag: f.itag, width: f.width, height: f.height };
      if (byItag.has(s.itag)) {
        const old = byItag.get(s.itag);
        check(old.width === s.width && old.height === s.height);
      } else { byItag.set(s.itag, s); streams.push(s); }
    }
  }
  const largest = consistentStreams(streams);
  return { schema: 1, videoId, channelId: DIMENSION_CHANNEL, width: largest.width, height: largest.height,
    source: SOURCE, observedAt: new Date(now).toISOString(), streams: streams.sort((a, b) => a.itag - b.itag) };
}

async function boundedText(response, maxBytes, signal) {
  const length = response.headers.get('content-length');
  check(length === null || (/^\d+$/.test(length) && Number(length) <= maxBytes));
  check(response.body);
  const reader = response.body.getReader(), chunks = [];
  let total = 0, done = false;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) { done = true; break; }
      total += part.value.byteLength;
      check(total <= maxBytes);
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!done) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function deadline(work, timeout = TIMEOUT_MS, controller = new AbortController()) {
  let timer;
  try {
    return await Promise.race([work(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Dimension request timed out')); }, timeout);
    })]);
  } finally { clearTimeout(timer); }
}
function cacheBody(value, videoId) {
  check(plain(value) && value.schema === 1 && value.videoId === videoId && value.channelId === DIMENSION_CHANNEL && value.source === SOURCE);
  check(typeof value.observedAt === 'string');
  const age = Date.now() - Date.parse(value.observedAt);
  check(Number.isFinite(age) && age >= 0 && age < TTL * 1000 && new Date(value.observedAt).toISOString() === value.observedAt);
  const streams = value.streams?.map(s => ({ itag: s.itag, width: s.width, height: s.height }));
  const largest = consistentStreams(streams);
  check(value.width === largest.width && value.height === largest.height);
  return { schema: 1, videoId, channelId: DIMENSION_CHANNEL, width: largest.width, height: largest.height,
    source: SOURCE, observedAt: value.observedAt, streams };
}

export async function videoDimensions(request, env, archiveVideo, reply) {
  if (request.method !== 'GET') return reply(405, { error: 'Only GET is supported' }, { Allow: 'GET' });
  const params = [...new URL(request.url).searchParams];
  if (params.length !== 1 || params[0][0] !== 'id' || !/^[A-Za-z0-9_-]{11}$/.test(params[0][1]) || params[0][1] === EXCLUDED)
    return reply(400, { error: 'Invalid video dimension query' });
  const videoId = params[0][1];
  if (typeof env.YOUTUBE_API_KEY !== 'string' || !env.YOUTUBE_API_KEY.trim())
    return reply(503, { error: 'Video dimensions are not configured' });
  try {
    // Ownership is mandatory even on a cache hit; never trust caller or watch HTML alone.
    await deadline(signal => archiveVideo(videoId, env, signal));
    const key = new Request(new URL('/api/video-dimensions?id=' + videoId, request.url).href);
    let cache;
    try { cache = globalThis.caches?.default; } catch { /* cache is optional */ }
    if (cache) {
      try {
        const hit = await deadline(() => cache.match(key), 250);
        if (hit?.status === 200) {
          const value = cacheBody(JSON.parse(await deadline(signal => boundedText(hit, 65536, signal), 250)), videoId);
          return reply(200, value, { 'Cache-Control': 'public, max-age=3600' });
        }
      } catch { /* Invalid/expired cache entries are never served. */ }
    }
    const html = await deadline(async signal => {
      const response = await fetch('https://www.youtube.com/watch?v=' + videoId, {
        method: 'GET', credentials: 'omit', redirect: 'error', signal,
        headers: { Accept: 'text/html' }
      });
      check(response.ok && /^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || ''));
      return boundedText(response, MAX_BYTES, signal);
    });
    const value = dimensionsFromPlayer(parsePlayerResponse(html), videoId);
    const response = reply(200, value, { 'Cache-Control': 'public, max-age=3600' });
    if (cache) {
      try { await deadline(() => cache.put(key, response.clone()), 250); } catch { /* cache failures do not fail evidence */ }
    }
    return response;
  } catch {
    return reply(502, { status: 'pending', error: 'Video dimensions unavailable; retain review' });
  }
}
