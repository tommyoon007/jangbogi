/* 장보기 서비스 워커 — 앱을 휴대폰에 설치하고, 인터넷이 약해도 열리게 합니다. */
var CACHE = 'jangbogi-v1';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* 한 파일이 없어도 설치를 막지 않음 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* 영수증 자료: 새것을 먼저 받고, 안 되면 저장해 둔 것 */
  if (/\/data\/receipts\.json$/.test(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  /* 화면 이동: 새 화면을 먼저, 안 되면 저장해 둔 첫 화면 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) { return hit || caches.match('./'); });
      })
    );
    return;
  }

  /* 나머지 파일: 저장본을 바로 보여 주고, 뒤에서 새것으로 바꿔 둡니다. */
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req, { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
