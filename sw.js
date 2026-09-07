/* Service Worker — Block Fall (cache-first) */
const CACHE = 'block-fall-v1';
const ASSETS = ['./', './index.html', './game.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(res =>
      res || fetch(e.request).then(net => {
        const copy = net.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return net;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
