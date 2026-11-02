// Datakul service worker: keeps the app working offline.
// Network first, so a new deploy shows up straight away; the saved copy is used only when the network fails.
// Gateway calls (/api) and anything that isn't a GET are never touched.
const CACHE = "datakul-v1";
const SHELL = ["./", "index.html", "library.js", "community.js", "problems.js", "certs.js", "diagrams.js", "app.js",
  "pyrunner.js", "practice.js", "quests.js", "exam.js", "account.js", "pwa.js", "config.js", "manifest.webmanifest", "icons/datakul-icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  const fonts = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.origin !== location.origin && !fonts) return;
  if (u.origin === location.origin && u.pathname.startsWith("/api/")) return;
  if (u.pathname.endsWith("/admin.html")) return;
  e.respondWith(
    fetch(r).then((res) => {
      if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then((hit) => hit || (r.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
