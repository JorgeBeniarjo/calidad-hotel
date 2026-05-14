const CACHE_NAME = "calidad-hotel-v3";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./nueva-revision.html",
  "./revisiones.html",
  "./css/app.css",
  "./js/app.js",
  "./js/sheets.js",
  "./js/camera.js",
  "./manifest.json",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
];

// Instalar Service Worker y cachear assets estáticos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Cacheando assets estáticos");
      return cache.addAll(ASSETS_TO_CACHE);
    }),
  );
  self.skipWaiting();
});

// Activar y limpiar caches antiguos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("Eliminando cache antiguo:", key);
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

// Interceptar peticiones (estrategia cache-first para estáticos, network-first para APPS_SCRIPT_URL)
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  // Excluir peticiones a Google Apps Script para intentar siempre ir a la red primero (Network First)
  if (requestUrl.hostname.includes("script.google.com")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Si queremos cachear las respuestas ok de la API, podríamos hacerlo aquí
          return response;
        })
        .catch((err) => {
          console.log("Petición API fallida, offline o error de red:", err);
          // Si tuvieramos cache de la API se devolvería aquí
          throw err;
        }),
    );
    return;
  }

  // Estrategia Cache-First para el resto de assets estáticos
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cachear peticiones dinámicas de fuentes u otros si fuera necesario
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type !== "basic"
        ) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    }),
  );
});
