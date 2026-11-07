// PocketEmu service worker
// 1) Offline: caches app + emulator cores after first use.
// 2) Adds COOP/COEP headers so SharedArrayBuffer works (needed by PSP core) on static hosts like GitHub Pages.
const VERSION = "pocketemu-v1";
const SHELL = [
  "./", "index.html", "play.html", "manifest.webmanifest",
  "css/app.css", "css/play.css",
  "js/app.js", "js/play.js", "js/db.js", "js/systems.js", "js/util.js",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "vendor/emulatorjs/data/loader.js", "vendor/emulatorjs/data/emulator.min.js", "vendor/emulatorjs/data/emulator.min.css",
  "vendor/emulatorjs/data/localization/en-US.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(res) {
  if (!res || res.status === 0 || res.type === "opaque") return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Pages: network first (get updates), fall back to cache offline.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(VERSION)).put(url.pathname.endsWith("/") ? "./" : req, res.clone());
        return isolate(res);
      } catch (err) {
        const c = await caches.match(req, { ignoreSearch: true }) || await caches.match("index.html");
        return isolate(c);
      }
    })());
    return;
  }

  // Everything else: cache first, then network (and store).
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return isolate(hit);
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return isolate(res);
    } catch (err) {
      return new Response("offline", { status: 503 });
    }
  })());
});
