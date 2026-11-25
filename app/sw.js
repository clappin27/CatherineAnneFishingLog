// Billfish Log service worker: keeps the app itself available offshore with no signal.
// Catch data never goes through this cache; it lives in the app's own storage and Supabase.
const VERSION = 'bl-2026-11-24-2';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = 'runtime-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './vendor/supabase.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache so a release never mixes old and new files.
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase API, auth and realtime: always live, never cached.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Fonts: cache after first use.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Opening the app: always use this release's saved page, so the page and its scripts match.
  // New releases arrive by installing a new service worker, which then reloads the app.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE);
      const hit = (await c.match('./index.html')) || (await c.match('./'));
      if (hit) return hit;
      try { return await Promise.race([fetch(req), timeout(8000)]); } catch (e) { return Response.error(); }
    })());
    return;
  }

  // App files: always this release's saved copy (never refreshed in place, so files can't mix across releases).
  event.respondWith((async () => {
    const c = await caches.open(SHELL_CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch (e) { return new Response('', { status: 504, statusText: 'Offline' }); }
  })());
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { network.catch(() => {}); return cached; }
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}
