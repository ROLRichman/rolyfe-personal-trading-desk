/* RO’Lyfe Personal Trading Desk: offline app-shell cache.
   Live market data, Supabase sync/auth, external charts and AI remain online services. */
const CACHE_NAME = "rolyfe-personal-desk-shell-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles.css",
  "./auth.css",
  "./chart.css",
  "./execution.css",
  "./app.js",
  "./execution.js",
  "./market-metrics.js",
  "./market-library.js",
  "./shared/rolyfe-global-tools.js",
  "./shared/atlas-local.js",
  "./shared/atlas-universal.js",
  "./assets/rolyfe-mark.svg"
];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("rolyfe-personal-desk-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never cache account, market-data, AI or other API responses.
  if (url.hostname.includes("supabase.co") || url.pathname.includes("/functions/v1/")) return;
  // Cache third-party ESM modules only after a successful CORS fetch so a previously
  // opened app can still load its cached code when the connection is unavailable.
  if (url.hostname === "esm.sh") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
        return response;
      } catch (_) {
        return new Response("This library has not been cached yet. Reopen RO’Lyfe while online to prepare offline access.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./"));
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response("This item is not available offline yet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
