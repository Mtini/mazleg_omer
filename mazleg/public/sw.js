/* MAZLEG service worker — app shell offline, never caches private API data. */
const VERSION = '__BUILD_ID__';
const SHELL = `mazleg-shell-${VERSION}`;
const LIBS = 'mazleg-libs-v1';
const SHELL_FILES = ['/', '/index.html', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/images/mazleg-logo.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mazleg-shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase API, auth and functions: always network, never stored on the device.
  if (/\/(rest|auth|functions|realtime|storage)\/v1\//.test(url.pathname)) return;
  if (req.mode === 'navigate') {   // /, /join/TOKEN, ... → network first, offline falls back to the shell
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  const pinnedCdn = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(url.hostname);
  if (pinnedCdn) {               // version-pinned libraries and fonts: cache first
    e.respondWith(caches.open(LIBS).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin === self.location.origin) {   // own static files: stale-while-revalidate
    e.respondWith(caches.open(SHELL).then(async (c) => { const hit = await c.match(req); const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; }));
  }
});
