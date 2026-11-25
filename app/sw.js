// Billfish Log service worker: keeps the app itself available offshore with no signal.
// Catch data never goes through this cache; it lives in the app's own storage and Supabase.
const VERSION = 'bl-2026-11-24-1';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = 'runtime-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './vendor/supabase.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // Opening the app: try the network briefly (weak signal offshore), fall back to the saved copy.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(req), timeout(3500)]);
        if (res && res.ok) { const c = await caches.open(SHELL_CACHE); c.put('./index.html', res.clone()); }
        return res;
      } catch (e) {
        const c = await caches.open(SHELL_CACHE);
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // App files: serve the saved copy instantly, refresh it in the background.
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: cacheName === SHELL_CACHE });
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { network.catch(() => {}); return cached; }
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}
