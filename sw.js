const CACHE_NAME = "usuarios-v3";

const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./app.css",
    "./app.js",
    "./icono2.png"
];

// Instalación: guarda los archivos de la app para usarlos sin internet
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activación: borra cachés de versiones anteriores
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;

    // Agregar, actualizar y eliminar (POST, PUT, DELETE) van directo a la red
    if (request.method !== "GET") return;
    if (!request.url.startsWith("http")) return;

    const sameOrigin = new URL(request.url).origin === location.origin;
    event.respondWith(sameOrigin ? staticFirst(event) : networkAndCache(request));
});

// Archivos de la app: responde desde la caché y actualiza la copia en segundo plano
async function staticFirst(event) {
    const request = event.request;
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });

    const update = fetch(request)
        .then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    if (cached) {
        event.waitUntil(update);
        return cached;
    }

    const fresh = await update;
    if (fresh) return fresh;
    if (request.mode === "navigate") return cache.match("./index.html");
    return Response.error();
}

// API: primero red (y guarda copia); sin internet usa la última copia
async function networkAndCache(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
    } catch (error) {
        return (await cache.match(request)) || Response.error();
    }
}