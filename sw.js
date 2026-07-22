// Service Worker del Portal de Alumnas - MOVE Dance Academy
// Guarda en caché solo los archivos del portal (para que abra rápido / instalado
// se vea bien), NUNCA los datos que vienen del Worker (pagos, claves, etc. siempre
// se piden frescos a Airtable/Worker, jamás desde caché).

const CACHE_NAME = "move-portal-v2";

const ARCHIVOS_APP = [
  "./",
  "./index.html",
  "./portal.css",
  "./portal.js",
  "./logo.png",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_APP))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Si la petición va hacia otro dominio (el Worker que trae los datos de
  // Airtable: pagos, claves, evaluaciones, etc.), NUNCA la interceptamos.
  // Siempre debe ir directo a la red, sin caché, para que los datos sean
  // siempre los actuales.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Solo interceptamos peticiones GET de los archivos propios del portal.
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cacheada) => {
      const fetchPromise = fetch(event.request)
        .then((respuestaRed) => {
          if (respuestaRed && respuestaRed.status === 200) {
            const copia = respuestaRed.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
          }
          return respuestaRed;
        })
        .catch(() => cacheada);

      // Si hay versión en caché, la mostramos de una vez (rápido) y
      // actualizamos en segundo plano. Si no hay caché, esperamos la red.
      return cacheada || fetchPromise;
    })
  );
});
