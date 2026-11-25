// Replaces the service worker from the old billfish-log address: clears its saved copy of the app
// and sends any open window (including a home-screen icon) to the new address.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    const wins = await self.clients.matchAll({ type: 'window' });
    for (const w of wins) {
      const u = new URL(w.url);
      try { await w.navigate('https://clappin27.github.io/CatherineAnneFishingLog/' + u.search + u.hash); } catch (e) {}
    }
  })());
});
