
// This is the "Offline page" service worker

importScripts('https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js');

const CACHE = "pwabuilder-page-v3-mini-player";

const offlineFallbackPage = "/loriano-archive/index.html";

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener('install', async (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([offlineFallbackPage, './mini-player.css?v=1', './mini-player-catalog.js?v=1', './mini-player-queue.js?v=1', './mini-player.js?v=1']))
  );
});

if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

// Only this feature's same-origin assets are cached. YouTube/API traffic is untouched.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pwabuilder-page-v') && key !== CACHE).map(key => caches.delete(key)))));
});
const miniAssets = new Set(['mini-player.css', 'mini-player-catalog.js', 'mini-player-queue.js', 'mini-player.js']);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.origin === self.location.origin && miniAssets.has(url.pathname.split('/').pop())) {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(event.request))));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloadResp = await event.preloadResponse;

        if (preloadResp) {
          return preloadResp;
        }

        const networkResp = await fetch(event.request);
        return networkResp;
      } catch (error) {
        const cache = await caches.open(CACHE);
        const cachedResp = await cache.match(offlineFallbackPage);
        return cachedResp;
      }
    })());
  }
});
