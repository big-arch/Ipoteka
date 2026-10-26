const CACHE_NAME = "ipoteka-pwa-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./calc.js",
  "./data.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// сначала сеть (чтобы обновления приходили сразу), без сети — из кэша
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "reload" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) =>
          cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error())
        )
      )
  );
});
