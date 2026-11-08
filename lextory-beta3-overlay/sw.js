const CACHE_NAME = 'lextory-shell-v5';
const APP_FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin || ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'].includes(url.hostname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && (response.ok || response.type === 'opaque')) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
      return response;
    }).catch(() => url.origin === self.location.origin ? caches.match('./index.html') : Promise.reject(new Error('Recurso externo no disponible sin conexión')))));
  }
});