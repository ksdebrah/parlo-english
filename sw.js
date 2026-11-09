// Offline support. Everything is fetched fresh when online (so updates appear straight away)
// and falls back to the saved copy when offline.
// VERSION only needs changing if you want to clear old saved copies.
const VERSION = "parlo-v3";
const SHELL = [
  "./", "index.html", "css/style.css", "js/app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);

  if (url.origin === location.origin) {
    // app files and content: always try the network first so updates show straight away,
    // fall back to the saved copy when offline
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else if (isFont) {
    // fonts never change: cache first
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req, { cache: "no-cache" }).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});
