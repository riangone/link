var CACHE_NAME = 'link-cache-v12';
var urlsToCache = [
  'index.html',
  './',
  'styles.css',
  'scripts/i18n.js',
  'scripts/network.js',
  'scripts/ui.js',
  'scripts/clipboard.js',
  'sounds/blop.mp3',
  'images/favicon-96x96.png'
];

self.addEventListener('install', function(event) {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      // Activate the new worker immediately instead of waiting for all
      // old tabs to be closed. Without this, a hard-refresh keeps being
      // served by the OLD worker (which still cache-first-serves the OLD
      // scripts/ui.js), so JS fixes never actually reach the browser.
      .then(function() { return self.skipWaiting(); })
  );
});


// Network-first for same-origin navigations and scripts so a deployed fix
// is picked up on the very next load instead of only after the cache
// expires. Falls back to cache when offline.
self.addEventListener('fetch', function(event) {
  const req = event.request;
  const isAppShellFile = req.method === 'GET' &&
    (req.mode === 'navigate' || /\.(?:js|css|html)$/.test(new URL(req.url).pathname));

  if (isAppShellFile) {
    event.respondWith(
      fetch(req)
        .then(function(response) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
          return response;
        })
        .catch(function() { return caches.match(req); })
    );
    return;
  }

  event.respondWith(
    caches.match(req)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(req);
      }
    )
  );
});


self.addEventListener('activate', function(event) {
  console.log('Updating Service Worker...')
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          // Return true if you want to remove this cache,
          // but remember that caches are shared across
          // the whole origin
          return cacheName !== CACHE_NAME;
        }).map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    // Take control of any already-open tabs right away so the fix applies
    // without requiring the user to fully close and reopen the browser.
    }).then(function() { return self.clients.claim(); })
  );
});
