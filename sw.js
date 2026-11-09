// Offline support. Content files are fetched fresh when online (so weekly updates
// appear straight away) and fall back to the saved copy when offline.
// If you change index.html, css or js, bump VERSION so phones pick up the new files.
const VERSION = "parlo-v2";
const SHELL = [
  "./", "index.html", "css/style.css", "js/app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  const isContent = url.origin === location.origin && url.pathname.includes("/content/");
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);

  if (isContent) {
    // network first, then cache
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else if (url.origin === location.origin || isFont) {
    // cache first, then network
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        return res;
      }))
    );
  }
});
