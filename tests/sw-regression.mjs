// Node built-ins only. Run: node tests/sw-regression.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const workerPath = new URL('../sw.js', import.meta.url);
const source = await readFile(workerPath, 'utf8');
const reportPath = new URL('../results/sw-regression.json', import.meta.url);
const results = [];
const origin = 'https://example.test';
const names = ['index.html', 'mini-player.css?v=8', 'mini-player-catalog.js?v=7', 'mini-player-queue.js?v=6', 'mini-player.js?v=8', 'archive-policy.js', 'aspect-evidence.json', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];

function harness(scopePath = '/test/', options = {}) {
  const scope = origin + scopePath;
  const listeners = new Map();
  const stores = new Map();
  const deleted = [], fetched = [], added = [], puts = [];
  let cacheFailure = false, network = async request => new Response('network:' + key(request));
  let skipped = 0, preloadEnabled = 0;
  const key = request => typeof request === 'string' ? new URL(request, scope).href : request.url;
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async addAll(urls) {
        added.push(...urls);
        if (options.installFailure) throw new Error('precache failed');
        for (const url of urls) store.set(key(url), new Response('precache:' + key(url)));
      },
      async match(request) {
        if (options.matchFailure) throw new Error('match failed');
        return store.get(key(request))?.clone();
      },
      async put(request, response) {
        if (options.putFailure) throw new Error('quota exceeded');
        puts.push(key(request));
        store.set(key(request), response.clone());
      }
    };
  };
  const self = {
    location: new URL(scope + 'sw.js'),
    registration: {
      scope,
      ...(options.noPreload ? {} : { navigationPreload: { async enable() {
        preloadEnabled++;
        if (options.preloadFailure) throw new Error('preload unsupported');
      } } })
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    async skipWaiting() { skipped++; }
  };
  const caches = {
    async open(name) {
      if (cacheFailure || options.openFailure) throw new Error('storage unavailable');
      return cacheFor(name);
    },
    async keys() {
      if (options.keysFailure) throw new Error('keys unavailable');
      return [...stores.keys()];
    },
    async delete(name) {
      deleted.push(name);
      return stores.delete(name);
    }
  };
  vm.runInNewContext(source, {
    self, caches, URL, Request, Response, Promise, Set,
    fetch: async request => { fetched.push(key(request)); return network(request); },
    console
  }, { filename: fileURLToPath(workerPath) });
  return {
    scope, stores, deleted, fetched, added, puts,
    get skipped() { return skipped; }, get preloadEnabled() { return preloadEnabled; },
    setNetwork(value) { network = value; },
    failCache() { cacheFailure = true; },
    seed(name) { stores.set(name, new Map()); },
    async lifecycle(type, data) {
      const waits = [];
      listeners.get(type)?.({ data, waitUntil(promise) { waits.push(promise); } });
      await Promise.all(waits);
    },
    async request(path, { mode = 'cors', method = 'GET', preload } = {}) {
      const waits = [];
      let responsePromise;
      const request = { url: new URL(path, scope).href, mode, method };
      listeners.get('fetch')({
        request, preloadResponse: Promise.resolve(preload),
        respondWith(promise) { assert.equal(responsePromise, undefined); responsePromise = Promise.resolve(promise); },
        waitUntil(promise) { waits.push(promise); }
      });
      const intercepted = responsePromise !== undefined;
      const response = intercepted ? await responsePromise : undefined;
      await Promise.all(waits);
      return { intercepted, response };
    }
  };
}
const offline = async () => { throw new TypeError('offline'); };
async function test(name, fn) {
  try { await fn(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', error: error.stack }); }
}

for (const scope of ['/loriano-archive/', '/test/']) {
  await test(`${scope} install precaches eleven scope-local shell, policy, manifest and icon resources`, async () => {
    const h = harness(scope); await h.lifecycle('install');
    assert.deepEqual(h.added, names.map(name => h.scope + name));
    assert.equal(h.stores.size, 1);
    assert.match([...h.stores.keys()][0], /v8-stable-topbar$/);
    assert.equal(h.skipped, 0);
  });
  await test(`${scope} offline navigation uses scope index including nested routes and queries`, async () => {
    const h = harness(scope); await h.lifecycle('install'); h.setNetwork(offline);
    for (const path of ['', 'index.html?old=1', 'nested/route?x=1']) {
      const result = await h.request(path, { mode: 'navigate' });
      assert.equal(await result.response.text(), 'precache:' + h.scope + 'index.html');
    }
  });
  await test(`${scope} canonical assets use network first and refresh offline cache`, async () => {
    const h = harness(scope); await h.lifecycle('install');
    for (const name of names.slice(1)) {
      const live = await h.request(name);
      assert.equal(await live.response.text(), 'network:' + h.scope + name);
    }
    assert.equal(h.puts.length, names.length - 1);
    h.setNetwork(offline);
    for (const name of names.slice(1)) {
      assert.equal(await (await h.request(name)).response.text(), 'network:' + h.scope + name);
    }
  });
  await test(`${scope} old version query links fall back to current canonical versions without poisoning cache`, async () => {
    const h = harness(scope); await h.lifecycle('install');
    for (const name of names.filter(name => name.includes('?v='))) {
      const old = name.replace(/\?v=\d+/, '?v=1');
      await h.request(old);
      assert.equal(h.puts.length, 0);
      h.setNetwork(offline);
      assert.equal(await (await h.request(old)).response.text(), 'precache:' + h.scope + name);
      h.setNetwork(async () => new Response('old network'));
    }
  });
  await test(`${scope} exact paths prevent nested asset and scope-prefix escape interception`, async () => {
    const h = harness(scope);
    for (const path of ['/mini-player.js?v=8', scope.slice(0, -1) + '-other/mini-player.js', 'nested/mini-player.js', '../mini-player.js']) {
      assert.equal((await h.request(path)).intercepted, false, path);
    }
    assert.equal((await h.request('/outside/', { mode: 'navigate' })).intercepted, false);
    assert.equal((await h.request(scope.slice(0, -1), { mode: 'navigate' })).intercepted, false);
  });
}
await test('scope cache namespaces differ and activation never broadly deletes legacy or sibling caches', async () => {
  const a = harness('/test/'), b = harness('/loriano-archive/');
  await a.lifecycle('install'); await b.lifecycle('install');
  const current = [...a.stores.keys()][0], sibling = [...b.stores.keys()][0];
  assert.notEqual(current, sibling);
  const obsolete = current.replace(/v8-stable-topbar$/, 'v4-old');
  for (const name of [obsolete, sibling, 'pwabuilder-page-v4-mini-player', 'unrelated-user-cache']) a.seed(name);
  await a.lifecycle('activate');
  assert.deepEqual(a.deleted, [obsolete]);
  assert.equal(a.preloadEnabled, 1);
  assert.equal(a.skipped, 0);
});
await test('install fails clearly when precache or storage fails', async () => {
  await assert.rejects(harness('/test/', { installFailure: true }).lifecycle('install'), /precache failed/);
  await assert.rejects(harness('/test/', { openFailure: true }).lifecycle('install'), /storage unavailable/);
});
await test('activation tolerates unavailable CacheStorage and navigation preload', async () => {
  for (const options of [{ keysFailure: true }, { preloadFailure: true }, { noPreload: true }]) {
    await harness('/test/', options).lifecycle('activate');
  }
});
await test('only explicit SKIP_WAITING message opts into activation', async () => {
  const h = harness();
  await h.lifecycle('message', { type: 'OTHER' }); await h.lifecycle('message', null);
  assert.equal(h.skipped, 0);
  await h.lifecycle('message', { type: 'SKIP_WAITING' }); assert.equal(h.skipped, 1);
});
await test('navigation preload takes priority and does not populate runtime cache', async () => {
  const h = harness();
  const result = await h.request('route', { mode: 'navigate', preload: new Response('preloaded') });
  assert.equal(await result.response.text(), 'preloaded');
  assert.equal(h.fetched.length, 0); assert.equal(h.puts.length, 0);
});
await test('rejected navigation preload still attempts network', async () => {
  const h = harness();
  const result = await h.request('route', { mode: 'navigate', preload: Promise.reject(new Error('preload failed')) });
  assert.equal(await result.response.text(), 'network:' + h.scope + 'route');
  assert.equal(h.fetched.length, 1);
});
await test('successful navigation uses network but never changes pinned offline index', async () => {
  const h = harness(); await h.lifecycle('install');
  assert.equal(await (await h.request('index.html', { mode: 'navigate' })).response.text(), 'network:' + h.scope + 'index.html');
  assert.equal(h.puts.length, 0); h.setNetwork(offline);
  assert.equal(await (await h.request('index.html', { mode: 'navigate' })).response.text(), 'precache:' + h.scope + 'index.html');
});
await test('cache open failure does not turn a successful network response into failure', async () => {
  const h = harness('/test/', { openFailure: true });
  assert.equal((await h.request('mini-player.js?v=8')).response.status, 200);
});
await test('quota/write failure preserves successful network response', async () => {
  const h = harness('/test/', { putFailure: true }); await h.lifecycle('install');
  assert.equal(await (await h.request('mini-player.js?v=8')).response.text(), 'network:' + h.scope + 'mini-player.js?v=8');
});
await test('offline cache open/match failures return valid 503 responses', async () => {
  for (const options of [{ openFailure: true }, { matchFailure: true }, {}]) {
    const h = harness('/test/', options); h.setNetwork(offline);
    for (const [path, mode] of [['mini-player.js?v=8', 'cors'], ['route', 'navigate']]) {
      const result = await h.request(path, { mode });
      assert.equal(result.response.status, 503); assert.match(await result.response.text(), /offline/i);
    }
  }
});
await test('HTTP errors do not overwrite good precached assets', async () => {
  const h = harness(); await h.lifecycle('install');
  h.setNetwork(async () => new Response('failure', { status: 500 }));
  assert.equal((await h.request('mini-player.js?v=8')).response.status, 500);
  assert.equal(h.puts.length, 0); h.setNetwork(offline);
  assert.equal(await (await h.request('mini-player.js?v=8')).response.text(), 'precache:' + h.scope + 'mini-player.js?v=8');
});
await test('opaque and redirected or cross-origin responses are never cached', async () => {
  for (const extra of [{ type: 'opaque' }, { redirected: true }, { url: 'https://cdn.example/mini-player.js' }, { url: origin + '/outside/mini-player.js' }]) {
    const h = harness();
    h.setNetwork(async () => ({ ok: true, status: 200, type: 'basic', redirected: false, ...extra, clone() { throw new Error('must not clone'); } }));
    await h.request('mini-player.js?v=8'); assert.equal(h.puts.length, 0);
  }
});
await test('cross-origin, API, media, non-GET and unknown assets are bypassed without cache/network work', async () => {
  const h = harness();
  for (const url of ['https://youtube.com/watch?v=1', 'https://example.net/test/mini-player.js?v=8', 'https://api.example.net/test/mini-player.js', 'api/playlist', 'api/mini-player.js', 'video.mp4', 'audio.mp3', 'unknown.json', 'sw.js']) {
    assert.equal((await h.request(url)).intercepted, false, url);
  }
  assert.equal((await h.request('mini-player.js?v=8', { method: 'POST' })).intercepted, false);
  assert.equal((await h.request('route', { method: 'POST', mode: 'navigate' })).intercepted, false);
  assert.equal((await h.request('https://example.net/test/', { mode: 'navigate' })).intercepted, false);
  assert.equal(h.fetched.length, 0); assert.equal(h.stores.size, 0);
});
await test('same-origin API and media navigations are not handled', async () => {
  const h = harness();
  for (const name of ['api/playlist', 'api', 'graphql', 'video.mp4', 'audio.mp3', 'media/clip', 'backend/state']) {
    assert.equal((await h.request(name, { mode: 'navigate' })).intercepted, false, name);
  }
});
await test('worker is self-contained and never touches persistent user data or claims clients', async () => {
  assert.doesNotMatch(source, /importScripts\s*\(|indexedDB|localStorage|clients\.claim\s*\(/);
});

const passed = results.filter(item => item.status === 'passed').length;
const report = { suite: 'sw-regression', generatedAt: new Date().toISOString(), nodeVersion: process.version,
  source: 'sw.js', execution: 'Node built-in vm with mocked service-worker APIs; no real browser or network',
  total: results.length, passed, failed: results.length - passed, results };
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
for (const item of results) console.log(`${item.status === 'passed' ? 'PASS' : 'FAIL'} ${item.name}${item.error ? '\n' + item.error : ''}`);
console.log(`\n${passed}/${results.length} passed; ${report.failed} failed. Report: ${fileURLToPath(reportPath)}`);
process.exitCode = report.failed ? 1 : 0;
