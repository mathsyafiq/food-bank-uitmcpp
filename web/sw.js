// Service worker: keeps the app shell available offline (CLAUDE.md section 9).
// API calls are cross-site POSTs and always go to the network; the app keeps its own data in IndexedDB.
// Bump VERSION with every release: a new version caches a complete, matching set of files.
const VERSION = 'foodbank-0.2.2';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'app.js',
  'lib/api.js',
  'lib/store.js',
  'lib/scanner.js',
  'core/gtin.js',
  'core/student-id.js',
  'core/queue.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// GitHub Pages lets browsers keep files for 10 minutes. Skip that copy so a new version never caches old files.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from the cache straight away and refresh the cached copy in the background,
// checking with the server (a cheap "not modified" answer when nothing changed).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const isAppPage = url.pathname === scope || url.pathname === scope + 'index.html';
  if (request.mode === 'navigate' && !isAppPage) return; // Not the student app: leave it to the network.
  const navigate = request.mode === 'navigate';
  const key = navigate ? 'index.html' : request;
  // A navigation request cannot be copied with new options, so the page is fetched by name instead.
  const fresh = navigate ? new Request('index.html', { cache: 'no-cache' }) : new Request(request, { cache: 'no-cache' });
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: navigate });
    const network = fetch(fresh).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
