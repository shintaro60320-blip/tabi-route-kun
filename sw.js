// 旅ルートくんの殻をキャッシュする（設計書 §10.2）。API・地図タイル・写真はキャッシュしない。
// 版ごとに丸ごと入れ替える：インストール時に殻を全部そろえる（1 つでも取れんかったら新しい版にせん）。
// 稼働中の版をファイル単位で上書きせん（新旧の混在を防ぐ）。更新は CACHE_NAME を上げて置き直す。
const CACHE_NAME = 'trk-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/ui.js', './js/store.js', './js/prompt.js', './js/gemini.js', './js/verify.js',
  './js/schedule.js', './js/maplinks.js', './js/trip.js', './js/flow.js', './js/speech.js',
  './js/screens/home.js', './js/screens/course.js', './js/screens/trip.js', './js/screens/map.js',
  './js/screens/spot.js', './js/screens/settings.js', './js/screens/loading.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];
// 外の物は取れんでも殻は成立させる（Leaflet は地図画面でネットから読める）
const OPTIONAL = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL); // 1 つでも失敗したらインストール失敗＝旧版が残る
    await Promise.all(OPTIONAL.map((u) => cache.add(u).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isShell(url) {
  if (url.origin === self.location.origin) return !url.pathname.includes('/tests/');
  return url.hostname === 'unpkg.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isShell(url)) return; // API・タイル・写真・フォントはそのままネットへ
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit; // 殻はキャッシュ優先（更新は版の入れ替えで届く）
    return fetch(req); // 殻に無い物（未登録の画像など）はネットから。稼働中の版には足さん
  })());
});
