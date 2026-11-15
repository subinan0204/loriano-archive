#!/usr/bin/env node
/**
 * Isolated mini-player regression suite. Node builtins only.
 * Run from any directory: node /path/to/tests/mini-player-regression.mjs
 * Optional: --root /path/to/archive (also supports stdin/eval execution).
 * Reads the three player sources and writes only results/mini-player-regression.json.
 * No server, real network, browser, IndexedDB, localStorage, credentials, or media.
 * Production source is unchanged. A read-only test hook is injected in VM memory only.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const rootArgument = process.argv.indexOf('--root');
if (rootArgument !== -1 && !process.argv[rootArgument + 1]) throw new Error('--root requires a directory');
const root = rootArgument === -1 ? fileURLToPath(new URL('../', import.meta.url)) : path.resolve(process.argv[rootArgument + 1]);
const resultPath = path.join(root, 'results', 'mini-player-regression.json');
const sourceNames = ['mini-player.js', 'mini-player.css', 'mini-player-queue.js', 'mini-player-catalog.js'];
const sources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await readFile(path.join(root, name), 'utf8')])));
const hashes = Object.fromEntries(sourceNames.map(name => [name, createHash('sha256').update(sources[name]).digest('hex')]));
const PLAYER = sources['mini-player.js'];
const QUEUE = sources['mini-player-queue.js'];
const CSS = sources['mini-player.css'];
const PLAYLIST = 'PLw0Eei7VXrvLJuQGHTo56dq0bGX9cKhy-';
const KEY = 'loriano-mini-player-v1';
const BLOCKED = 'F5jQv9RPmhE';
const PERSONAL = ['personal001', 'personal002', 'personal003'];
const PUBLIC = ['public00001', 'public00002', 'public00003'];
const rowsFor = ids => ids.map((id, index) => ({ id, title: 'Track ' + (index + 1), duration: 180 }));
const personalRows = () => rowsFor(PERSONAL);
const cloned = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let index = 0; index < 64; index++) await Promise.resolve(); };
const feedResponse = (tracks, extra = {}) => ({
  ok: true,
  json: async () => ({ schema: 1, playlistId: PLAYLIST, updatedAt: 'isolated-fixture', count: tracks.length, tracks, ...extra })
});

let assertions = 0;
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const equal = (actual, expected, message) => { assertions++; assert.strictEqual(actual, expected, message); };
const same = (actual, expected, message) => { assertions++; assert.deepStrictEqual(cloned(actual), cloned(expected), message); };

function harness(options = {}) {
  const nodes = new Map();
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const observers = [];
  const calls = [];
  const players = [];
  const detailPlayers = [];
  const storage = new Map();
  const feed = deferred();
  let rows = Object.hasOwn(options, 'rows') ? options.rows : personalRows();
  let timerId = 0;
  let archiveReads = 0;
  let detailFrame = null;
  let storageReadFails = !!options.storageReadFails;
  let storageWriteFails = !!options.storageWriteFails;
  if (options.saved) storage.set(KEY, JSON.stringify({ version: 1, playlist: PLAYLIST, ...options.saved }));

  function makeNode(id = '') {
    const node = {
      id, hidden: id === 'mpStage', disabled: false, textContent: '', value: '0', innerHTML: '',
      attributes: {}, listeners: new Map(), children: [],
      classList: { toggle(name, active) { calls.push({ type: 'class', name, active }); } },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, callback) { this.listeners.set(type, callback); },
      remove() { this.removed = true; },
      prepend(child) { if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child); this.children.unshift(child); child.parentNode = this; if (child.id) nodes.set(child.id, child); },
      append(child) { if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child); this.children.push(child); child.parentNode = this; if (child.id) nodes.set(child.id, child); },
      querySelector(selector) {
        if (selector === '.mp-bar') return nodes.get('mpBar');
        if (!/^#[A-Za-z][\w-]*$/.test(selector)) throw new Error('Unexpected fake DOM selector: ' + selector);
        const match = nodes.get(selector.slice(1));
        if (!match) throw new Error('Missing fake DOM node: ' + selector);
        return match;
      },
      getBoundingClientRect() { return { left: 0, top: 0, right: 330, bottom: 185.625, width: 330, height: 185.625 }; }
    };
    if (id) nodes.set(id, node);
    return node;
  }
  for (const id of ['lorianoMini', 'mpBar', 'mpExpand', 'mpTitle', 'mpNote', 'mpPlay', 'mpPrevious', 'mpNext', 'mpStop', 'mpMode', 'mpSeek', 'mpElapsed', 'mpTotal', 'mpStage', 'mpStorage', 'mpCatalogInfo', 'mpVideo', 'mpYouTube', 'view']) makeNode(id);
  const document = {
    hidden: false,
    getElementById(id) { return id === 'archiveVideoPlayer' ? detailFrame : nodes.get(id) || null; },
    createElement(tag) { const node = makeNode(); node.tagName = tag.toUpperCase(); return node; },
    head: { append(node) { calls.push({ type: 'script', src: node.src }); } },
    addEventListener(type, callback) { documentListeners.set(type, callback); }
  };
  const fakeStorage = {
    getItem(key) {
      if (key !== KEY) throw new Error('Unexpected storage key');
      if (storageReadFails) throw new Error('Fake storage read denied');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (key !== KEY) throw new Error('Unexpected storage key');
      if (storageWriteFails) throw new Error('Fake storage write denied');
      calls.push({ type: 'storageWrite' });
      storage.set(key, value);
    }
  };
  const archive = {};
  const originalGetVideos = async () => {
    archiveReads++;
    if (rows instanceof Error) throw rows;
    return typeof rows === 'function' ? rows() : rows;
  };
  Object.defineProperty(archive, 'getVideos', { value: originalGetVideos, writable: false, configurable: false, enumerable: true });

  function MockPlayer(target, config) {
    this.target = target;
    this.config = config;
    this.id = config.videoId || '';
    this.state = -1;
    this.time = 0;
    this.duration = 180;
    this.title = 'Mock video title';
    this.destroyed = false;
    this.emit = state => { this.state = state; config.events.onStateChange?.({ data: state }); };
    this.cueVideoById = value => {
      if (value.videoId === BLOCKED) throw new Error('Excluded ID reached fake playback');
      calls.push({ type: 'cue', id: value.videoId, start: value.startSeconds });
      this.id = value.videoId; this.time = value.startSeconds; this.emit(5);
    };
    this.playVideo = () => { calls.push({ type: 'play', id: this.id, detail: target !== 'mpYouTube' }); this.emit(1); };
    this.pauseVideo = () => { calls.push({ type: 'pause', detail: target !== 'mpYouTube' }); this.emit(2); };
    this.stopVideo = () => { calls.push({ type: 'stop', id: this.id }); this.emit(0); };
    this.destroy = () => { this.destroyed = true; calls.push({ type: 'destroy', id: this.id }); };
    this.getVideoData = () => ({ video_id: this.id, title: this.title });
    this.getDuration = () => this.duration;
    this.getCurrentTime = () => this.time;
    this.getPlayerState = () => this.state;
    this.seekTo = value => { calls.push({ type: 'seek', value }); this.time = value; };
    (target === 'mpYouTube' ? players : detailPlayers).push(this);
  }
  class MockAbortController {
    constructor() { this.signal = { aborted: false, listeners: [] }; }
    abort() { this.signal.aborted = true; for (const listener of this.signal.listeners) listener(); }
  }
  const fakeMath = Object.create(Math);
  fakeMath.random = () => 0;
  const context = vm.createContext({
    document, localStorage: fakeStorage, ArchiveEngine: archive, Math: fakeMath,
    innerWidth: 1280, innerHeight: 900, location: { origin: 'https://isolated.invalid', hash: '' },
    LorianoPlaylistCatalog: { playlist: PLAYLIST, updatedAt: 'bundled-fixture', tracks: options.catalog ?? rowsFor(PUBLIC) },
    AbortController: MockAbortController,
    fetch(url, settings) {
      if (url !== 'https://loriano-playlist-sync.subinan0204.workers.dev/api/playlist') throw new Error('Unexpected fake URL');
      if (settings.credentials !== 'omit') throw new Error('Fake fetch must omit credentials');
      calls.push({ type: 'fetch' });
      settings.signal.listeners.push(() => feed.reject(new Error('Fake fetch aborted')));
      return feed.promise;
    },
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, interval: false }); return id; },
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, interval: true }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, callback) { windowListeners.set(type, callback); }
  }, { codeGeneration: { strings: false, wasm: false } });
  context.window = context;
  const mockYT = { Player: MockPlayer };
  if (options.api !== false) context.YT = mockYT;
  Object.defineProperty(context, 'indexedDB', { get() { throw new Error('Real or fake DB access is forbidden in this suite'); } });
  new vm.Script(QUEUE, { filename: 'mini-player-queue.js' }).runInContext(context);
  const ending = /\}\)\(\);\s*$/;
  assert.match(PLAYER, ending, 'Expected player IIFE ending for in-memory instrumentation');
  const instrumented = PLAYER.replace(ending,
    'window.__miniRegression = { refreshCatalog, persist, bindDetail, state: () => ({ manual, activeId: activeId(), ids: [...queue.ids], queue: queue.snapshot(), mode, position, duration, title, ready, intent, playing, switching, selected }) };\n})();');
  new vm.Script(instrumented, { filename: 'mini-player.js (in-memory test hook)' }).runInContext(context);

  return {
    nodes, calls, players, detailPlayers, feed, timers, context, originalGetVideos,
    state: () => cloned(context.__miniRegression.state()),
    saved: () => storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null,
    count: type => calls.filter(call => call.type === type).length,
    archiveReads: () => archiveReads,
    setRows(value) { rows = value; },
    refresh: () => context.__miniRegression.refreshCatalog(),
    persist: () => context.__miniRegression.persist(),
    dispatch(id, type) {
      const node = nodes.get(id);
      assert.ok(node, 'Fake node must exist: ' + id);
      const callback = node.listeners.get(type);
      assert.ok(callback, 'Fake listener must exist: ' + id + '/' + type);
      if (id !== 'lorianoMini' && (type === 'click' || type === 'input')) nodes.get('lorianoMini').listeners.get(type)?.({ target: node });
      return callback({ target: node });
    },
    click(id) {
      assert.ok(!nodes.get(id)?.disabled, 'Cannot click disabled control: ' + id);
      return this.dispatch(id, 'click');
    },
    emitWindow(type) { return windowListeners.get(type)?.(); },
    emitDocument(type) { return documentListeners.get(type)?.(); },
    resolveAPI() { context.YT = mockYT; context.onYouTubeIframeAPIReady?.(); },
    attachDetail(id) {
      if (id) context.location.hash = '#video/' + id;
      detailFrame = makeNode('archiveVideoPlayer');
      nodes.get('view').append(detailFrame);
      detailFrame.contentWindow = { postMessage(message, origin) { calls.push({ type: 'detailMessage', message, origin }); } };
      for (const observer of observers) observer.callback();
    },
    async runTimers(delay, interval = false) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay && timer.interval === interval) {
        if (!timer.interval) timers.delete(id);
        timer.callback();
      }
      await flush();
    }
  };
}

async function start(h) {
  const count = h.players.length;
  const pending = h.click('mpPlay');
  await flush();
  const player = h.players.at(-1);
  assert.ok(player && h.players.length === count + 1, 'Expected one fresh fake player');
  player.config.events.onReady();
  await pending;
  await flush();
  return player;
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

// Queue authority is always the designated public playlist, never personal storage.
test('personal getter remains nonwritable and personal 577 never replaces public queue', async () => {
  const ids = Array.from({ length: 577 }, (_, i) => 'person' + String(i).padStart(5, '0'));
  const h = harness({ rows: rowsFor(ids) }); await flush();
  equal(h.context.ArchiveEngine.getVideos, h.originalGetVideos);
  equal(Object.getOwnPropertyDescriptor(h.context.ArchiveEngine, 'getVideos').writable, false);
  same(h.state().ids, PUBLIC); equal(h.count('fetch'), 1); equal(h.archiveReads(), 0);
  equal(h.count('storageWrite'), 0); equal(h.players.length, 0);
});
test('empty personal archive still uses designated public queue', async () => {
  const h = harness({ rows: [] }); await flush();
  same(h.state().ids, PUBLIC); equal(h.count('fetch'), 1); equal(h.players.length, 0);
});
test('failed personal archive read cannot block public queue', async () => {
  const h = harness({ rows: new Error('Fake DB pending') }); await flush();
  same(h.state().ids, PUBLIC); equal(h.count('fetch'), 1); equal(h.archiveReads(), 0);
});
test('pending personal archive read cannot delay public queue', async () => {
  const pending = deferred(); const h = harness({ rows: () => pending.promise }); await flush();
  same(h.state().ids, PUBLIC); equal(h.count('fetch'), 1); equal(h.archiveReads(), 0);
});
test('personal archive containing only excluded records cannot affect public queue', async () => {
  const h = harness({ rows: rowsFor([BLOCKED]) }); await flush();
  same(h.state().ids, PUBLIC); equal(h.count('fetch'), 1); ok(!h.nodes.get('mpNext').disabled);
});
test('personal archive failure after initialization cannot prevent public playback', async () => {
  const h = harness({ rows: [] }); await flush(); h.setRows(new Error('Fake DB unavailable'));
  await start(h); equal(h.players.length, 1); equal(h.state().playing, true);
});
test('real bundled playlist contains exactly 205 unique valid designated public IDs', async () => {
  const scope = { window: {} }; vm.runInNewContext(sources['mini-player-catalog.js'], scope);
  const catalog = scope.window.LorianoPlaylistCatalog;
  equal(catalog.playlist, PLAYLIST); equal(catalog.tracks.length, 205);
  equal(new Set(catalog.tracks.map(row => row.id)).size, 205);
  ok(catalog.tracks.every(row => /^[\w-]{11}$/.test(row.id) && row.id !== BLOCKED));
  const h = harness({ catalog: catalog.tracks }); await flush();
  same(h.state().ids, catalog.tracks.map(row => row.id)); equal(h.count('storageWrite'), 0);
});

// Restoration and exclusion.
test('saved current position mode and history restore without iframe or autoplay', async () => {
  const saved = { current: PUBLIC[1], position: 37, duration: 125, mode: 'repeat', history: PUBLIC.slice(0, 2), cursor: 1, visited: PUBLIC.slice(0, 2), title: 'Saved title' };
  const h = harness({ saved }); await flush();
  equal(h.state().queue.current, PUBLIC[1]); equal(h.state().position, 37); equal(h.state().duration, 125);
  equal(h.state().mode, 'repeat'); same(h.state().queue.history, saved.history);
  equal(h.players.length, 0); equal(h.count('play'), 0); ok(h.nodes.get('mpStage').hidden);
});
test('startup catalog and passive lifecycle preserve saved storage byte-for-byte until interaction', async () => {
  const saved = { current: PUBLIC[0], position: 21, mode: 'sequential', history: [PUBLIC[0]], cursor: 0 };
  const h = harness({ saved }); await flush(); const original = h.saved();
  h.persist(); h.emitWindow('pagehide'); h.context.document.hidden = true; h.emitDocument('visibilitychange');
  h.feed.resolve(feedResponse(rowsFor(PUBLIC))); await flush();
  same(h.saved(), original); equal(h.count('storageWrite'), 0); equal(h.state().position, 21);
  h.click('mpMode'); ok(h.count('storageWrite') > 0);
});
test('excluded saved current history and visited entries are purged', async () => {
  const h = harness({ rows: [], saved: { current: BLOCKED, position: 91, title: 'Excluded', history: [BLOCKED, PUBLIC[0]], cursor: 0, visited: [BLOCKED] } }); await flush();
  equal(h.count('storageWrite'), 0); equal(h.state().position, 0); same(h.state().ids, PUBLIC);
  ok(!JSON.stringify(h.state().queue).includes(BLOCKED)); h.click('mpMode'); ok(!JSON.stringify(h.saved()).includes(BLOCKED));
});
test('valid worker feed replaces bundled queue regardless of personal archive', async () => {
  const h = harness(); await flush(); h.feed.resolve(feedResponse(rowsFor(['remote00001', 'remote00002', 'remote00003']))); await flush();
  same(h.state().ids, ['remote00001', 'remote00002', 'remote00003']); equal(h.count('storageWrite'), 0); equal(h.archiveReads(), 0);
});
for (const [label, tracks, extra] of [
  ['excluded ID', rowsFor(['remote00001', BLOCKED, 'remote00002']), {}],
  ['decreased count', rowsFor(['remote00001']), {}],
  ['duplicate IDs', rowsFor(['remote00001', 'remote00001']), {}],
  ['malformed ID', rowsFor(['remote00001', 'bad']), {}],
  ['missing ID', [{ title: 'bad' }], {}],
  ['null track', [null], {}],
  ['empty feed', [], {}],
  ['incorrect count', rowsFor(['remote00001', 'remote00002', 'remote00003']), { count: 99 }],
  ['wrong playlist', rowsFor(['remote00001', 'remote00002', 'remote00003']), { playlistId: 'different-playlist' }],
  ['wrong schema', rowsFor(['remote00001', 'remote00002', 'remote00003']), { schema: 2 }]
]) test('invalid worker ' + label + ' retains trusted queue and displays explicit error', async () => {
  const h = harness(); await flush(); const before = h.nodes.get('mpNote').textContent;
  h.feed.resolve(feedResponse(tracks, extra)); await flush(); same(h.state().ids, PUBLIC);
  ok(h.nodes.get('mpNote').textContent !== before, 'Worker failure must not be silent');
  ok(/실패|오류|못|확인|연결|유효|invalid|fail|error|unavailable/i.test(h.nodes.get('mpNote').textContent), 'Explicit error text is required');
  equal(h.count('storageWrite'), 0); equal(h.players.length, 0);
});
test('failed worker request retains trusted bundled queue with explicit error', async () => {
  const h = harness(); await flush(); const before = h.nodes.get('mpNote').textContent;
  h.feed.reject(new Error('Fake offline')); await flush(); same(h.state().ids, PUBLIC);
  ok(h.nodes.get('mpNote').textContent !== before); equal(h.players.length, 0); equal(h.count('storageWrite'), 0);
});
test('late worker feed remains authoritative when personal archive changes', async () => {
  const h = harness({ rows: [] }); await flush(); h.setRows(personalRows());
  h.feed.resolve(feedResponse(rowsFor(['remote00001', 'remote00002', 'remote00003']))); await flush();
  same(h.state().ids, ['remote00001', 'remote00002', 'remote00003']); equal(h.archiveReads(), 0);
});
test('personal refresh during pending feed never selects personal records', async () => {
  const h = harness({ rows: [] }); await flush(); h.setRows(personalRows()); await h.refresh();
  same(h.state().ids, PUBLIC); h.feed.resolve(feedResponse(rowsFor(['remote00001', 'remote00002', 'remote00003']))); await flush();
  same(h.state().ids, ['remote00001', 'remote00002', 'remote00003']); equal(h.archiveReads(), 0);
});

// User controls; all media commands go only to MockPlayer.
test('explicit play creates one official-configured mock and resumes saved offset', async () => {
  const h = harness({ saved: { current: PUBLIC[0], position: 37, duration: 125, mode: 'sequential', history: [PUBLIC[0]], cursor: 0 } }); await flush();
  const player = await start(h);
  equal(h.players.length, 1); equal(player.config.playerVars.autoplay, 0); equal(player.config.playerVars.playsinline, 1);
  equal(player.config.playerVars.listType, undefined); equal(player.time, 37); equal(h.state().playing, true);
});
test('play control toggles pause and resume without replacing current video', async () => {
  const h = harness(); await flush(); const player = await start(h); player.time = 43;
  await h.click('mpPlay'); equal(h.state().playing, false); equal(h.state().position, 43);
  await h.click('mpPlay'); equal(h.state().playing, true); equal(h.players.length, 1); equal(player.time, 43);
});
test('stop resets progress and cues without restarting playback', async () => {
  const h = harness(); await flush(); const player = await start(h); player.time = 43; const plays = h.count('play');
  h.click('mpStop'); equal(h.state().position, 0); equal(h.state().intent, false); equal(h.state().playing, false);
  equal(h.count('play'), plays); equal(player.state, 5);
});
test('next previous and forward-history preserve real queue navigation', async () => {
  const h = harness({ saved: { mode: 'sequential' } }); await flush();
  ok(h.nodes.get('mpPrevious').disabled); h.click('mpNext'); equal(h.state().queue.current, PUBLIC[1]);
  h.click('mpPrevious'); equal(h.state().queue.current, PUBLIC[0]);
  h.click('mpNext'); equal(h.state().queue.current, PUBLIC[1]); same(h.state().queue.history, PUBLIC.slice(0, 2));
});
test('sequential mode stops at the last video', async () => {
  const h = harness({ saved: { mode: 'sequential' } }); await flush();
  h.click('mpNext'); h.click('mpNext'); h.click('mpNext');
  equal(h.state().queue.current, PUBLIC[2]); equal(h.state().playing, false); equal(h.state().position, 0);
});
test('repeat mode wraps from last video to first', async () => {
  const h = harness({ saved: { mode: 'repeat', current: PUBLIC[2], history: [PUBLIC[2]], cursor: 0 } }); await flush();
  h.click('mpNext'); equal(h.state().queue.current, PUBLIC[0]); equal(h.saved().mode, 'repeat');
});
test('shuffle visits all videos once before a nonrepeating boundary', async () => {
  const h = harness(); await flush(); const order = [h.state().queue.current];
  h.click('mpNext'); order.push(h.state().queue.current); h.click('mpNext'); order.push(h.state().queue.current);
  equal(new Set(order).size, 3); h.click('mpNext'); ok(h.state().queue.current !== order.at(-1));
});
test('mode control cycles shuffle sequential repeat and persists mode', async () => {
  const h = harness(); await flush();
  for (const mode of ['sequential', 'repeat', 'shuffle']) { h.click('mpMode'); equal(h.state().mode, mode); equal(h.saved().mode, mode); }
});
test('seeking a cued video updates offset without autoplay', async () => {
  const h = harness(); await flush(); const player = await start(h); await h.click('mpPlay'); player.state = 5;
  const plays = h.count('play'); h.nodes.get('mpSeek').value = '45'; h.dispatch('mpSeek', 'input'); h.dispatch('mpSeek', 'change');
  equal(player.time, 45); equal(h.state().intent, false); equal(h.count('play'), plays); equal(player.state, 5);
});
test('seeking a paused video uses seekTo without replaying', async () => {
  const h = harness(); await flush(); const player = await start(h); await h.click('mpPlay'); const plays = h.count('play');
  h.nodes.get('mpSeek').value = '52'; h.dispatch('mpSeek', 'change');
  equal(player.time, 52); equal(h.count('seek'), 1); equal(h.count('play'), plays); equal(h.state().playing, false);
});
test('metadata updates title elapsed duration and range', async () => {
  const h = harness(); await flush(); const player = await start(h); player.time = 75; player.duration = 180; player.title = 'Fixture piano';
  await h.runTimers(500, true);
  equal(h.nodes.get('mpTitle').textContent, 'Fixture piano'); equal(h.nodes.get('mpElapsed').textContent, '1:15');
  equal(h.nodes.get('mpTotal').textContent, '3:00'); equal(h.nodes.get('mpSeek').value, '75');
});
test('ended state advances once and retains user-authorized playback intent', async () => {
  const h = harness({ saved: { mode: 'sequential' } }); await flush(); const player = await start(h); player.emit(0);
  equal(h.state().queue.current, PUBLIC[1]); equal(h.state().playing, true); equal(h.state().queue.history.length, 2);
});

// Close, teardown, and reopening races.
test('close stops destroys hides and preserves position while ignoring old state events', async () => {
  const h = harness(); await flush(); const player = await start(h); player.time = 42; h.click('mpClose');
  ok(player.destroyed); ok(h.count('stop') > 0); equal(h.state().ready, false); equal(h.state().intent, false);
  ok(h.nodes.get('mpStage').hidden); equal(h.saved().position, 42);
  player.emit(1); equal(h.state().playing, false); equal(h.state().ready, false);
});
test('reopen constructs a fresh player at the retained video and position', async () => {
  const h = harness(); await flush(); const first = await start(h); first.time = 42; const current = h.state().queue.current;
  h.click('mpClose'); const second = await start(h);
  ok(first !== second); equal(h.players.length, 2); equal(second.id, current); equal(second.time, 42); equal(h.state().playing, true);
});
test('close during API loading prevents late iframe construction', async () => {
  const h = harness({ api: false }); await flush(); const pending = h.click('mpPlay'); await flush();
  equal(h.count('script'), 1); h.click('mpClose'); h.resolveAPI(); await pending;
  equal(h.players.length, 0); equal(h.state().ready, false); equal(h.state().intent, false);
});
test('close before onReady destroys pending player and permits clean reopening', async () => {
  const h = harness(); await flush(); const pending = h.click('mpPlay'); await flush(); const first = h.players[0];
  h.click('mpClose'); first.config.events.onReady(); await pending;
  ok(first.destroyed); equal(h.state().ready, false); const second = await start(h);
  first.emit(1); equal(h.state().playing, true); equal(h.players.length, 2); ok(!second.destroyed);
});
test('immediate close after play prevents late setup even with pending personal read', async () => {
  const h = harness(); await flush(); const rows = deferred(); h.setRows(() => rows.promise);
  const pending = h.click('mpPlay'); h.click('mpClose'); rows.resolve(personalRows()); await pending;
  equal(h.players.length, 0); equal(h.state().intent, false); ok(h.nodes.get('mpStage').hidden);
});

// Existing details integration and visibility policy.
test('details and mini players keep mutual-pause interaction', async () => {
  const h = harness(); await flush(); h.attachDetail(); const mini = await start(h); const detail = h.detailPlayers[0];
  ok(detail); ok(h.calls.some(call => call.type === 'pause' && call.detail));
  detail.playVideo(); equal(h.state().playing, false); equal(mini.state, 2);
  await h.click('mpPlay'); equal(h.state().playing, true); equal(detail.state, 2);
  ok(h.calls.some(call => call.type === 'detailMessage' && call.origin === 'https://www.youtube.com'));
});
test('document hiding pauses without autoplay on returning', async () => {
  const h = harness(); await flush(); await start(h); h.context.document.hidden = true; h.emitDocument('visibilitychange');
  equal(h.state().playing, false); const plays = h.count('play');
  h.context.document.hidden = false; h.emitDocument('visibilitychange'); equal(h.count('play'), plays);
});
test('opening a details route pauses mini playback', async () => {
  const h = harness(); await flush(); await start(h); h.context.location.hash = '#video/' + PUBLIC[0]; h.emitWindow('hashchange');
  equal(h.state().playing, false); equal(h.state().intent, false);
});
test('storage denial shows warning but leaves in-memory playback usable', async () => {
  const h = harness({ storageReadFails: true, storageWriteFails: true }); await flush();
  equal(h.nodes.get('mpStorage').hidden, false); await start(h); equal(h.state().playing, true); equal(h.saved(), null);
});
test('source invariants preserve archive API and compact uncropped viewport rules', async () => {
  new vm.Script(PLAYER); new vm.Script(QUEUE);
  ok(!/\b(?:ArchiveEngine|archiveEngine)\s*\.\s*getVideos\s*=/.test(PLAYER));
  ok(!PLAYER.includes('__playlistOverlay')); ok(!PLAYER.includes('getPlaylist()')); ok(!PLAYER.includes("listType: 'playlist'"));
  ok(CSS.includes('aspect-ratio:16/9')); ok(CSS.includes('width:min(352px,calc(100vw - 24px))'));
  ok(/@media\(min-width:681px\) and \(max-width:1023px\)\{\.loriano-mini \.mp-stage\{width:min\(320px,/.test(CSS));
  ok(/@media\(max-width:680px\)\{\.loriano-mini \.mp-stage\{[^}]*width:min\(280px,/.test(CSS));
  ok(/\.loriano-mini \.mp-button\{width:44px;height:44px\}/.test(CSS), 'Compact controls must expose 44px target height and width');
  ok(!CSS.includes('min-height:200px')); ok(!CSS.includes('height:270px'));
  equal((CSS.match(/\{/g) || []).length, (CSS.match(/\}/g) || []).length);
});


test('personal saved current is never added to public queue and storage stays untouched until interaction', async () => {
  const h = harness({ saved: { current: PERSONAL[0], position: 88, duration: 120, history: PERSONAL, cursor: 0, visited: PERSONAL } }); await flush();
  same(h.state().ids, PUBLIC); ok(!h.state().queue.history.some(id => PERSONAL.includes(id)));
  equal(h.state().position, 0); equal(h.count('storageWrite'), 0); equal(h.saved().current, PERSONAL[0]);
  h.click('mpMode'); ok(!JSON.stringify(h.saved()).includes(PERSONAL[0]));
});
test('real trusted205 catalog survives truncated worker snapshot with explicit count error', async () => {
  const scope = { window: {} }; vm.runInNewContext(sources['mini-player-catalog.js'], scope);
  const tracks = scope.window.LorianoPlaylistCatalog.tracks;
  const h = harness({ catalog: tracks }); await flush();
  h.feed.resolve(feedResponse(tracks.slice(0, 204))); await flush();
  same(h.state().ids, tracks.map(row => row.id)); equal(h.count('storageWrite'), 0);
  ok(/실패|오류|못|fail|error/i.test(h.nodes.get('mpCatalogInfo').textContent));
});
test('HTTP failure preserves public queue and reports synchronization failure', async () => {
  const h = harness(); await flush(); h.feed.resolve({ ok: false, json: async () => { throw new Error('Must not decode failed HTTP'); } }); await flush();
  same(h.state().ids, PUBLIC); ok(/실패|오류|못|fail|error/i.test(h.nodes.get('mpCatalogInfo').textContent)); equal(h.count('storageWrite'), 0);
});
test('invalid worker JSON preserves public queue and reports synchronization failure', async () => {
  const h = harness(); await flush(); h.feed.resolve({ ok: true, json: async () => { throw new SyntaxError('Malformed JSON'); } }); await flush();
  same(h.state().ids, PUBLIC); ok(/실패|오류|못|fail|error/i.test(h.nodes.get('mpCatalogInfo').textContent)); equal(h.count('storageWrite'), 0);
});
test('worker timeout preserves public queue without initialization storage writes', async () => {
  const h = harness(); await flush(); await h.runTimers(8000);
  same(h.state().ids, PUBLIC); ok(/실패|오류|못|fail|error/i.test(h.nodes.get('mpCatalogInfo').textContent)); equal(h.count('storageWrite'), 0);
});
test('floating controls move alongside video and return to original root when closed', async () => {
  const h = harness(); await flush(); const bar = h.nodes.get('mpBar'); const player = await start(h);
  equal(bar.parentNode, h.nodes.get('mpStage')); equal(h.nodes.get('mpStage').children.filter(item => item === bar).length, 1);
  h.click('mpClose'); equal(bar.parentNode, h.nodes.get('lorianoMini')); ok(player.destroyed);
  equal(h.nodes.get('mpStage').children.filter(item => item === bar).length, 0);
  await start(h); equal(bar.parentNode, h.nodes.get('mpStage')); equal(h.nodes.get('mpStage').children.filter(item => item === bar).length, 1);
});
test('detail player loads API and binds before mini player has ever played', async () => {
  const h = harness({ api: false }); await flush(); h.attachDetail(); await flush();
  equal(h.count('script'), 1); equal(h.players.length, 0); h.resolveAPI(); await flush();
  equal(h.detailPlayers.length, 1); equal(h.players.length, 0); equal(h.count('play'), 0); equal(h.count('storageWrite'), 0);
});


async function startManual(h, id = PERSONAL[0]) {
  h.attachDetail(id); const button = h.nodes.get('mpManualDetail');
  assert.ok(button, 'Runtime manual button must exist'); equal(button.getAttribute('data-mini-video'), id);
  const pending = h.click('mpManualDetail'); await flush(); const player = h.players.at(-1);
  assert.ok(player, 'Explicit manual action must create player');
  player.config.events.onReady(); await pending; await flush(); return player;
}
test('explicit personal short plays manually without modifying public205 queue or history', async () => {
  const scope = { window: {} }; vm.runInNewContext(sources['mini-player-catalog.js'], scope);
  const h = harness({ catalog: scope.window.LorianoPlaylistCatalog.tracks, rows: [{ id: PERSONAL[0], title: 'Personal short', duration: 45, shorts: true }] }); await flush();
  const before = h.state().queue; const player = await startManual(h);
  equal(player.id, PERSONAL[0]); equal(h.state().manual.id, PERSONAL[0]); equal(h.state().playing, true);
  equal(h.state().ids.length, 205); same(h.state().queue, before); ok(!h.state().ids.includes(PERSONAL[0]));
  equal(h.saved().manual.id, PERSONAL[0]); same(h.saved().history, before.history);
  ok(h.nodes.get('mpCatalogInfo').textContent.includes('개별 영상 · 랜덤 후보205곡 별도'));
  ok(h.calls.some(call => call.type === 'pause' && call.detail));
});
test('manual play pause seek stop metadata all target independent active ID', async () => {
  const h = harness(); await flush(); const player = await startManual(h); const before = h.state().queue;
  player.time = 12; await h.click('mpPlay'); equal(h.state().playing, false); equal(h.state().position, 12);
  h.nodes.get('mpSeek').value = '24'; h.dispatch('mpSeek', 'change'); equal(player.time, 24);
  await h.click('mpPlay'); equal(h.state().playing, true); equal(player.id, PERSONAL[0]);
  player.title = 'Short live title'; player.time = 31; await h.runTimers(500, true); equal(h.nodes.get('mpTitle').textContent, 'Short live title');
  h.click('mpStop'); equal(player.id, PERSONAL[0]); equal(player.time, 0); equal(h.state().playing, false); same(h.state().queue, before);
});
test('manual end stops without advancing random queue or auto playing queue video', async () => {
  const h = harness(); await flush(); const player = await startManual(h); const before = h.state().queue; const plays = h.count('play');
  player.emit(0); equal(h.state().playing, false); equal(h.state().intent, false); equal(h.count('play'), plays); same(h.state().queue, before); equal(h.state().manual.id, PERSONAL[0]);
});
for (const control of ['mpNext', 'mpPrevious']) test(control + ' leaves manual and resumes public queue without personal history', async () => {
  const h = harness(); await flush(); const before = h.state().queue; const player = await startManual(h);
  h.click(control); equal(h.state().manual, null); equal(player.id, before.current); same(h.state().queue, before); equal(h.saved().manual, null); equal(h.state().playing, true);
});
test('manual close and reopen creates fresh official player at retained manual offset', async () => {
  const h = harness(); await flush(); const first = await startManual(h); first.time = 17; h.click('mpClose');
  ok(first.destroyed); equal(h.saved().manual.position, 17); const second = await start(h);
  ok(first !== second); equal(second.id, PERSONAL[0]); equal(second.time, 17); equal(h.state().playing, true);
});
test('verified saved manual restores without iframe autoplay or initial storage writes', async () => {
  const h = harness({ saved: { current: PUBLIC[0], manual: { id: PERSONAL[0], position: 19, duration: 45 }, history: [PUBLIC[0]], cursor: 0 } }); await flush();
  equal(h.state().manual.id, PERSONAL[0]); equal(h.state().position, 19); equal(h.players.length, 0); equal(h.count('play'), 0); equal(h.count('storageWrite'), 0); same(h.state().ids, PUBLIC);
  const player = await start(h); equal(player.id, PERSONAL[0]); equal(player.time, 19);
});
test('unverified or removed saved manual never becomes active or enters queue', async () => {
  const h = harness({ rows: [], saved: { manual: { id: PERSONAL[0], position: 19 } } }); await flush();
  equal(h.state().manual, null); same(h.state().ids, PUBLIC); equal(h.players.length, 0); equal(h.count('storageWrite'), 0);
});
test('manual detail click rejects ID not present in personal archive', async () => {
  const h = harness({ rows: [] }); await flush(); h.attachDetail(PERSONAL[0]); await h.click('mpManualDetail'); await flush();
  equal(h.state().manual, null); equal(h.players.length, 0); same(h.state().ids, PUBLIC); ok(h.nodes.get('mpNote').textContent.includes('확인하지 못'));
});
test('close cancels outstanding manual verification before any iframe is created', async () => {
  const pendingRows = deferred(); const h = harness({ rows: () => pendingRows.promise }); await flush();
  h.attachDetail(PERSONAL[0]); const pending = h.click('mpManualDetail'); h.click('mpClose'); pendingRows.resolve(personalRows()); await pending;
  equal(h.players.length, 0); equal(h.state().manual, null); ok(h.nodes.get('mpStage').hidden);
});


test('manual selection reuses ready mini iframe and public next keeps it official', async () => {
  const h = harness(); await flush(); const player = await start(h); const before = h.state().queue;
  h.attachDetail(PERSONAL[0]); await h.click('mpManualDetail'); await flush();
  equal(h.players.length, 1); equal(player.id, PERSONAL[0]); same(h.state().queue, before);
  h.attachDetail(PERSONAL[1]); await h.click('mpManualDetail'); await flush();
  equal(player.id, PERSONAL[1]); equal(h.players.length, 1); same(h.state().queue, before);
  h.click('mpNext'); equal(player.id, before.current); equal(h.state().manual, null);
});
test('slow saved-manual verification cannot override explicit public navigation', async () => {
  const pendingRows = deferred(); const h = harness({ rows: () => pendingRows.promise, saved: { manual: { id: PERSONAL[0], position: 22 } } }); await flush();
  h.click('mpNext'); const current = h.state().queue.current; pendingRows.resolve(personalRows()); await flush();
  equal(h.state().manual, null); equal(h.state().activeId, current); equal(h.players.length, 0);
});
test('manual selection pending API load is cancelled safely by close', async () => {
  const h = harness({ api: false }); await flush(); h.attachDetail(PERSONAL[0]);
  const pending = h.click('mpManualDetail'); await flush(); h.click('mpClose'); h.resolveAPI(); await pending; await flush();
  equal(h.players.length, 0); equal(h.state().intent, false); ok(h.nodes.get('mpStage').hidden);
});
test('catalog refresh while manual is paused does not overwrite active manual title or progress', async () => {
  const h = harness(); await flush(); const player = await startManual(h); player.time = 23; await h.click('mpPlay');
  const before = h.state(); h.feed.resolve(feedResponse(rowsFor(['remote00001', 'remote00002', 'remote00003']))); await flush();
  equal(h.state().manual.id, PERSONAL[0]); equal(h.state().position, 23); equal(h.state().title, before.title);
  same(h.state().ids, ['remote00001', 'remote00002', 'remote00003']); equal(player.id, PERSONAL[0]); equal(h.state().playing, false);
});

const started = new Date().toISOString();
const outcomes = [];
for (const entry of tests) {
  const before = assertions;
  const clock = performance.now();
  try {
    await entry.run();
    outcomes.push({ name: entry.name, status: 'passed', assertions: assertions - before, durationMs: Number((performance.now() - clock).toFixed(3)) });
    console.log('PASS ' + entry.name);
  } catch (error) {
    outcomes.push({ name: entry.name, status: 'failed', assertions: assertions - before, durationMs: Number((performance.now() - clock).toFixed(3)), error: String(error?.stack || error) });
    console.error('FAIL ' + entry.name + '\n' + String(error?.stack || error));
  }
}
const changedSources = [];
for (const name of sourceNames) {
  const current = createHash('sha256').update(await readFile(path.join(root, name), 'utf8')).digest('hex');
  if (current !== hashes[name]) changedSources.push(name);
}
const passed = outcomes.filter(outcome => outcome.status === 'passed').length;
const failed = outcomes.length - passed;
const results = {
  schemaVersion: 1,
  suite: 'mini-player isolated fake-DOM/storage/YouTube regression',
  startedAt: started,
  finishedAt: new Date().toISOString(),
  nodeVersion: process.version,
  testCount: outcomes.length,
  passed,
  failed,
  assertions,
  success: failed === 0 && changedSources.length === 0,
  isolation: { nodeBuiltinsOnly: true, realNetwork: false, browser: false, realIndexedDB: false, realLocalStorage: false, secrets: false, actualMediaTested: false, fakeTimers: true, inMemoryReadOnlyTestHook: true },
  sourceSha256: hashes,
  sourceFilesUnchangedDuringRun: changedSources.length === 0,
  changedSourceFiles: changedSources,
  limitations: ['Mock API events do not establish real media playback or browser autoplay behavior.', 'Fake DOM does not measure layout, portrait letterboxing, player control fit, or mobile rendering.', 'Real IndexedDB and archive classification are intentionally outside this suite.'],
  tests: outcomes
};
await mkdir(path.dirname(resultPath), { recursive: true });
await writeFile(resultPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
console.log('\n' + passed + '/' + outcomes.length + ' tests passed; ' + failed + ' failed; ' + assertions + ' assertions.');
console.log('Results: ' + resultPath);
if (!results.success) process.exitCode = 1;
