const V = "lecture-v4";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.json", "icon-192.png", "icon-512.png"];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(SHELL);
    // Librairies externes : on les garde pour le hors-ligne (best effort)
    await Promise.all(LIBS.map(async (u) => {
      try { await c.put(u, await fetch(new Request(u, { mode: "no-cors" }))); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Réseau d'abord (toujours la dernière version), cache si hors-ligne
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((r) => {
      if (r && (r.ok || r.type === "opaque")) {
        const cp = r.clone();
        caches.open(V).then((c) => c.put(req, cp));
      }
      return r;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./"))
    )
  );
});
