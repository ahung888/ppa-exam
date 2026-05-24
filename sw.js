const CACHE = 'ppa-v2';
const CDN_CACHE = 'ppa-cdn-v1';
const NETWORK_TIMEOUT_MS = 3000;

const LOCAL_FILES = [
  './',
  './app.js',
  './data/questions.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(LOCAL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // GA 請求略過，離線時靜默失敗
  if (url.hostname.includes('googletagmanager') || url.hostname.includes('google-analytics')) return;

  // CDN 資源：Cache First，首次 fetch 後快取
  if (url.hostname !== self.location.hostname) {
    e.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(e.request).then(hit => hit || fetch(e.request).then(res => {
          cache.put(e.request, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // 本地檔案：Network First（有網路時取最新版，超時或離線 fallback 快取）
  e.respondWith(
    Promise.race([
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS)
      ),
    ]).catch(() => caches.match(e.request))
  );
});
