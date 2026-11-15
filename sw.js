// Self-contained offline shell. Cache ownership is isolated by registration scope.
const scopeURL = new URL(self.registration.scope);
const CACHE_PREFIX = 'loriano-archive-app:' + scopeURL.href + ':';
const CACHE = CACHE_PREFIX + 'v7-production-safe';
const offlineFallbackPage = new URL('index.html', scopeURL).href;
const assetVersions = new Map([
  ['mini-player.css', '?v=6'],
  ['mini-player-catalog.js', '?v=7'],
  ['mini-player-queue.js', '?v=6'],
  ['mini-player.js', '?v=6'],
  ['archive-policy.js', ''],
  ['aspect-evidence.json', ''],
  ['manifest.json', ''],
  ['icon-192.png', ''],
  ['icon-512.png', ''],
  ['icon-512-maskable.png', '']
]);
const assetKeys = new Map([...assetVersions].map(([name, query]) => {
  const url = new URL(name + query, scopeURL);
  return [url.pathname, url.href];
}));
const precacheURLs = [offlineFallbackPage, ...assetKeys.values()];

self.addEventListener('message', event => {
  // Updates remain opt-in; do not automatically take over existing clients.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('install', event => {
  // addAll is atomic: a missing required shell resource must fail installation.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(precacheURLs)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Never delete unscoped legacy caches: their ownership cannot be established.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map(key => caches.delete(key)));
    } catch (_) { /* Storage failures must not prevent network-only operation. */ }
    try {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    } catch (_) { /* Navigation preload is optional. */ }
  })());
});

function inScope(url) {
  return url.origin === scopeURL.origin && url.pathname.startsWith(scopeURL.pathname);
}

function isBackendOrMedia(url) {
  const relativePath = url.pathname.slice(scopeURL.pathname.length);
  return /^(?:api|backend|graphql|media)(?:\/|$)/i.test(relativePath) ||
    /\.(?:mp3|mp4|m4a|m4v|webm|ogg|ogv|wav|flac|aac|m3u8|mpd|ts)(?:$)/i.test(url.pathname);
}

function offlineResponse() {
  return new Response('This resource is unavailable offline.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function cachedOrOffline(key) {
  try {
    const cache = await caches.open(CACHE);
    return await cache.match(key) || offlineResponse();
  } catch (_) {
    return offlineResponse();
  }
}

function cacheable(response) {
  if (!response.ok || response.status !== 200 || response.redirected ||
      (response.type !== 'basic' && response.type !== 'default')) return false;
  // Synthetic responses may have no URL. Real responses must remain scope-local.
  return !response.url || inScope(new URL(response.url));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !inScope(url) || isBackendOrMedia(url)) return;

  const canonicalKey = assetKeys.get(url.pathname);
  if (canonicalKey) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Old/unknown query links can use the canonical offline asset, but cannot
        // overwrite the current version with their potentially stale response.
        if (url.href === canonicalKey && cacheable(response)) {
          try {
            const cache = await caches.open(CACHE);
            await cache.put(canonicalKey, response.clone());
          } catch (_) { /* Quota/storage errors must preserve the network response. */ }
        }
        return response;
      } catch (_) {
        return cachedOrOffline(canonicalKey);
      }
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // A preload rejection is not proof that an ordinary fetch will fail.
        let preload;
        try { preload = await event.preloadResponse; } catch (_) { /* Try fetch. */ }
        if (preload) return preload;
        return await fetch(request);
      } catch (_) {
        return cachedOrOffline(offlineFallbackPage);
      }
    })());
  }
});
