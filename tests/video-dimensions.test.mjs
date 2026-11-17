import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../playlist-sync-worker.mjs';
import { parsePlayerResponse, dimensionsFromPlayer, DIMENSION_CHANNEL } from '../video-dimensions.mjs';

const id = '1zYk3516rEA';
const secret = 'synthetic-dimension-api-secret';
const admin = 'synthetic-dimension-admin-secret';
const stream = (width, height, itag = 137) => ({ itag, width, height, mimeType: 'video/mp4; codecs="avc1"', url: 'https://media.invalid/private?secret=' + secret });
const player = (streams = [stream(1920, 1080)]) => ({ videoDetails: { videoId: id, channelId: DIMENSION_CHANNEL,
  title: 'shorts landscape', lengthSeconds: '5', thumbnail: { width: 9, height: 16 } }, streamingData: { adaptiveFormats: streams } });
const html = p => '<html><script>var ytInitialPlayerResponse = ' + JSON.stringify(p) + ';var later = 1;</script></html>';

test('bounded public dimensions endpoint: synthetic fetch and cache only', async t => {
  const originalFetch = globalThis.fetch, originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const originalTimeout = globalThis.setTimeout;
  let writes = 0, reads = 0, calls = [], current = player(), apiMutate = () => {}, transport = null, cache = undefined;
  const env = { YOUTUBE_API_KEY: secret, ADMIN_TOKEN: admin, PLAYLIST_KV: {
    async get() { reads++; throw new Error('No KV reads permitted'); },
    async put() { writes++; throw new Error('No KV writes permitted'); }
  } };
  Object.defineProperty(globalThis, 'caches', { configurable: true, get: () => cache === 'getter-error' ? (() => { throw new Error(secret); })() : cache && { default: cache } });
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.origin === 'https://www.googleapis.com') {
      assert.equal(url.pathname, '/youtube/v3/videos');
      assert.equal(url.searchParams.get('id'), id);
      assert.equal(url.searchParams.get('key'), secret);
      const body = { items: [{ id, snippet: { channelId: DIMENSION_CHANNEL } }] };
      apiMutate(body);
      return Response.json(body);
    }
    assert.equal(url.href, 'https://www.youtube.com/watch?v=' + id);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'text/html' });
    assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal);
    if (transport) return transport(options);
    return new Response(html(current), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  async function run({ query = 'id=' + id, method = 'GET', status = 200, config = env } = {}) {
    calls = [];
    const response = await worker.fetch(new Request('https://worker.example/api/video-dimensions?' + query, { method,
      headers: { Cookie: 'caller-cookie=do-not-forward', Authorization: 'Bearer caller-token' } }), config);
    assert.equal(response.status, status);
    const text = await response.text();
    for (const unsafe of [secret, admin, 'media.invalid', 'caller-cookie', 'caller-token', '<script>']) assert.ok(!text.includes(unsafe), unsafe);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://subinan0204.github.io');
    const body = JSON.parse(text);
    if (status === 200) {
      assert.deepEqual(Object.keys(body).sort(), ['schema', 'videoId', 'channelId', 'width', 'height', 'source', 'observedAt', 'streams'].sort());
      assert.equal(body.schema, 1); assert.equal(body.videoId, id); assert.equal(body.channelId, DIMENSION_CHANNEL);
      assert.equal(body.source, 'YouTube ytInitialPlayerResponse.streamingData');
      assert.ok(Number.isFinite(Date.parse(body.observedAt)));
      assert.ok(body.streams.some(s => s.width === body.width && s.height === body.height));
      for (const s of body.streams) assert.deepEqual(Object.keys(s).sort(), ['height', 'itag', 'width']);
    } else if (status === 502) { assert.equal(body.status, 'pending'); assert.equal(response.headers.get('Cache-Control'), 'no-store'); }
    assert.equal(writes, 0); assert.equal(reads, 0);
    return { body, response };
  }
  try {
    for (const [name, width, height, duration] of [
      ['landscape under 180 seconds', 1920, 1080, '120'], ['landscape over 180 seconds', 1920, 1080, '240'],
      ['exact portrait', 1080, 1920, '60'], ['square', 1080, 1080, '30'], ['other known portrait', 720, 1280, '350']
    ]) await t.test(name, async () => {
      current = player([stream(width, height)]); current.videoDetails.lengthSeconds = duration;
      const { body } = await run(); assert.equal(body.width, width); assert.equal(body.height, height); assert.equal(calls.length, 2);
    });
    await t.test('rounded lower encodes keep largest actual exact dimensions', async () => {
      current = player([stream(608, 1080, 1), stream(480, 854, 2), stream(1080, 1920, 3)]);
      current.streamingData.formats = [stream(608, 1080, 1), { itag: 140, mimeType: 'audio/mp4', url: secret }];
      const { body } = await run(); assert.equal(body.width, 1080); assert.equal(body.height, 1920); assert.equal(body.streams.length, 3);
      current = player([stream(608, 1080)]);
      const roundedOnly = await run(); assert.equal(roundedOnly.body.width, 608); assert.equal(roundedOnly.body.height, 1080);
      assert.notEqual(roundedOnly.body.width * 16, roundedOnly.body.height * 9);
    });
    const badPlayers = [
      ['missing dimensions', () => { const p = player(); delete p.streamingData; return p; }],
      ['thumbnail and duration never substitute', () => ({ videoDetails: player().videoDetails })],
      ['audio only', () => player([{ itag: 140, mimeType: 'audio/mp4' }])],
      ['malformed dimension', () => player([stream('1080', 1920)])],
      ['zero dimension', () => player([stream(0, 1920)])],
      ['fractional dimension', () => player([stream(1080.5, 1920)])],
      ['oversized dimension', () => player([stream(1000000, 1920)])],
      ['missing one dimension', () => player([{ itag: 137, width: 1080, mimeType: 'video/mp4' }])],
      ['missing itag', () => player([{ width: 1080, height: 1920, mimeType: 'video/mp4' }])],
      ['conflicting orientation', () => player([stream(1080, 1920, 1), stream(1920, 1080, 2)])],
      ['materially conflicting ratio', () => player([stream(1080, 1920, 1), stream(720, 1440, 2)])],
      ['square versus portrait conflict', () => player([stream(1080, 1080, 1), stream(1080, 1920, 2)])],
      ['duplicate itag disagreement', () => player([stream(1080, 1920), stream(720, 1280)])],
      ['mismatched player ID', () => { const p = player(); p.videoDetails.videoId = 'xxxxxxxxxxx'; return p; }],
      ['cross channel player', () => { const p = player(); p.videoDetails.channelId = 'foreign'; return p; }]
    ];
    for (const [name, make] of badPlayers) await t.test(name, async () => { current = make(); await run({ status: 502 }); });
    current = player();
    for (const query of ['', 'id=bad', 'id=' + id + '&id=' + id, 'id=' + id + '&url=https://evil.invalid',
      'url=https://evil.invalid', 'id=F5jQv9RPmhE', 'id=' + id + '&key=caller', 'ID=' + id, 'id=' + id + '&extra='])
      await t.test('reject query ' + query, async () => { await run({ query, status: 400 }); assert.equal(calls.length, 0); });
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) await t.test('reject ' + method, async () => {
      await run({ method, status: 405 }); assert.equal(calls.length, 0);
    });
    await t.test('missing API config', async () => { await run({ config: {}, status: 503 }); assert.equal(calls.length, 0); });
    for (const [name, mutate] of [
      ['foreign official API ownership', b => { b.items[0].snippet.channelId = 'foreign'; }],
      ['mismatched official API ID', b => { b.items[0].id = 'xxxxxxxxxxx'; }],
      ['missing official API item', b => { b.items = []; }]
    ]) await t.test(name, async () => { apiMutate = mutate; await run({ status: 502 }); assert.equal(calls.length, 1); apiMutate = () => {}; });
    for (const [name, body, headers] of [
      ['malformed JSON', '<script>var ytInitialPlayerResponse = {bad};</script>'],
      ['unterminated JSON', '<script>var ytInitialPlayerResponse = {"x":"unterminated</script>'],
      ['no assignment', '<html>consent required</html>'],
      ['non HTML', html(current), { 'Content-Type': 'application/json' }],
      ['duplicate assignment', html(current) + html(current)],
      ['JS expression', '<script>var ytInitialPlayerResponse = ' + JSON.stringify(current) + ' || {};</script>'],
      ['template lookalike', '<script>const fake = `\nvar ytInitialPlayerResponse = ' + JSON.stringify(current) + ';`;</script>'],
      ['comment lookalike', '<script>/*\nvar ytInitialPlayerResponse = ' + JSON.stringify(current) + ';\n*/</script>'],
      ['declared oversize', 'small', { 'Content-Type': 'text/html', 'Content-Length': '4194305' }],
      ['actual oversize', 'x'.repeat(4194305)]
    ]) await t.test(name, async () => {
      transport = () => new Response(body, { headers: headers || { 'Content-Type': 'text/html' } });
      await run({ status: 502 }); transport = null;
    });
    await t.test('watch failure sanitized', async () => { transport = () => { throw new Error(secret + admin); }; await run({ status: 502 }); transport = null; });
    await t.test('watch redirect is not followed', async () => {
      transport = () => new Response('', { status: 302, headers: { Location: 'https://evil.invalid', 'Content-Type': 'text/html' } });
      await run({ status: 502 }); transport = null;
    });
    await t.test('timeout even if fetch ignores abort', async () => {
      globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, Math.min(ms, 10), ...args);
      transport = () => new Promise(() => {});
      await run({ status: 502 }); transport = null; globalThis.setTimeout = originalTimeout;
    });
    await t.test('ownership deadline aborts the actual upstream fetch', async () => {
      const wrappedFetch=globalThis.fetch;let aborted=false;
      globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===8000?5:ms===20000?1000:Math.min(ms,10),...args);
      globalThis.fetch=async(input,options={})=>{assert.equal(new URL(input).origin,'https://www.googleapis.com');return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('ownership aborted'));},{once:true}));};
      try{await run({status:502});assert.equal(aborted,true);}finally{globalThis.fetch=wrappedFetch;globalThis.setTimeout=originalTimeout;}
    });
    await t.test('body read timeout', async () => {
      globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, Math.min(ms, 10), ...args);
      transport = () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/html' } });
      await run({ status: 502 }); transport = null; globalThis.setTimeout = originalTimeout;
    });
    let stored, putCount = 0;
    cache = { async match() { return stored?.clone(); }, async put(key, value) {
      assert.equal(key.url, 'https://worker.example/api/video-dimensions?id=' + id);
      assert.equal([...key.headers].length, 0); assert.equal(value.headers.get('Cache-Control'), 'public, max-age=3600');
      stored = value.clone(); putCount++;
    } };
    await t.test('validated success cache and mandatory official ownership on hit', async () => {
      await run(); assert.equal(putCount, 1); assert.equal(calls.length, 2);
      await run(); assert.equal(calls.length, 1); assert.equal(putCount, 1);
      apiMutate = b => { b.items[0].snippet.channelId = 'foreign'; };
      await run({ status: 502 }); assert.equal(calls.length, 1); apiMutate = () => {};
    });
    const valid = await stored.clone().json();
    for (const [name, change] of [
      ['wrong ID', b => { b.videoId = 'xxxxxxxxxxx'; }], ['wrong channel', b => { b.channelId = 'foreign'; }],
      ['wrong source', b => { b.source = secret; }], ['wrong selected dimensions', b => { b.width = 123; }],
      ['expired', b => { b.observedAt = new Date(Date.now() - 3600001).toISOString(); }],
      ['future', b => { b.observedAt = new Date(Date.now() + 60000).toISOString(); }],
      ['conflicting streams', b => { b.streams.push({ itag: 1, width: 1080, height: 1920 }); }]
    ]) await t.test('cache poison rejected: ' + name, async () => {
      const poison = structuredClone(valid); change(poison); stored = Response.json(poison);
      await run(); assert.equal(calls.length, 2);
    });
    await t.test('cache extras never leak', async () => {
      stored = Response.json({ ...valid, url: secret, cookie: admin, streams: valid.streams.map(s => ({ ...s, url: secret })) });
      await run(); assert.equal(calls.length, 1);
    });
    await t.test('cache exceptions do not fail success', async () => {
      cache = { async match() { throw new Error(secret); }, async put() { throw new Error(admin); } }; await run();
      cache = 'getter-error'; await run();
    });
    await t.test('stalled optional cache never turns evidence into failure', async () => {
      globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, Math.min(ms, 10), ...args);
      cache = { async match() { return new Promise(() => {}); }, async put() { return new Promise(() => {}); } };
      await run(); assert.equal(calls.length, 2);
      globalThis.setTimeout = originalTimeout;
    });
    await t.test('official API transport failure sanitized before watch', async () => {
      apiMutate = () => { throw new Error(secret + admin); };
      await run({ status: 502 }); assert.equal(calls.length, 1); apiMutate = () => {};
    });
    await t.test('pending never cached', async () => {
      let puts = 0; cache = { async match() {}, async put() { puts++; } };
      current = player([]); await run({ status: 502 }); assert.equal(puts, 0);
    });
    assert.equal(reads, 0); assert.equal(writes, 0);
  } finally {
    globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout;
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches); else delete globalThis.caches;
  }
});

test('brace scanner handles escaped strings, nested structures and supported assignments', () => {
  const p = player(); p.extra = { nested: [{ text: 'braces } { [ ] and escaped " \\ \\"' }] };
  for (const assignment of ['var ytInitialPlayerResponse', 'window["ytInitialPlayerResponse"]', "window['ytInitialPlayerResponse']", 'window.ytInitialPlayerResponse']) {
    assert.deepEqual(parsePlayerResponse('<script>' + assignment + ' = ' + JSON.stringify(p) + ';</script>'), p);
  }
  assert.throws(() => parsePlayerResponse('<script>var ytInitialPlayerResponse = {"x":' + '['.repeat(129) + '0' + ']'.repeat(129) + '};</script>'));
  assert.throws(() => parsePlayerResponse('<script>var ytInitialPlayerResponse = {"x":"' + 'a'.repeat(2 * 1024 * 1024) + '"};</script>'));
  assert.equal(dimensionsFromPlayer(p, id).width, 1920);
});

test('health version is additive and existing fields are retained', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health'), {
    YOUTUBE_API_KEY: secret, PLAYLIST_KV: { async get() { return null; }, async put() { assert.fail('No writes'); } }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, dimensionsVersion: 'v1-20261118', configured: true,
    hasSnapshot: false, updatedAt: null, count: 0 });
});
