/* Service Worker:讓 App 可以「加到主畫面」、離線也打得開
 *
 * 策略是 network-first:每次都先問伺服器拿最新的,拿不到(沒網路)才用快取。
 * 這樣既不會蓋掉 index.html 裡 ?v= 的快取破壞機制,離線時又還有東西可看。
 * 改版時把 CACHE 的日期換掉,舊快取會在啟用時自動清掉。
 */
const CACHE = 'badmap-20260823c';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=20260823c',
  './js/store.js?v=20260823c',
  './js/ui.js?v=20260823c',
  './js/sync.js?v=20260823c',
  './js/shuttles.js?v=20260823c',
  './js/members.js?v=20260823c',
  './js/sessions.js?v=20260823c',
  './js/finance.js?v=20260823c',
  './js/photos.js?v=20260823c',
  './js/app.js?v=20260823c',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))   // 有單一檔案抓不到也不要讓整個安裝失敗
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  /* 只管自己網站的 GET;Apps Script 同步和 Drive 照片一律直接走網路,不碰快取 */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
