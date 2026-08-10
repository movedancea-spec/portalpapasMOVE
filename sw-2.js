// Service Worker del Portal de Alumnas - MOVE Dance Academy
// Guarda en caché solo los archivos del portal (para que abra rápido / instalado
// se vea bien, y para que siga funcionando si se pierde la señal un momento),
// NUNCA los datos que vienen del Worker (pagos, claves, etc. siempre se piden
// frescos a Airtable/Worker, jamás desde caché).
//
// Estrategia: RED PRIMERO. Cada vez que hay internet, se pide la versión más
// nueva del archivo directo al servidor (y de paso se actualiza la copia en
// caché). Solo si falla la conexión (sin señal / offline) se usa la copia
// guardada como respaldo. Así, cuando se sube un archivo nuevo al hosting,
// se ve reflejado de inmediato la siguiente vez que se abre o se recarga la
// página — sin tener que borrar caché a mano ni subir un número de versión
// nuevo cada vez.

const CACHE_NAME = "move-portal-v24";

const ARCHIVOS_APP = [
  "./",
  "./index.html",
  "./portal.css",
  "./portal.js",
  "./clase.html",
  "./clase.css",
  "./clase.js",
  "./maestras.html",
  "./maestras.css",
  "./maestras.js",
  "./portal-maestras.html",
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
    fetch(event.request)
      .then((respuestaRed) => {
        if (respuestaRed && respuestaRed.status === 200) {
          const copia = respuestaRed.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return respuestaRed;
      })
      .catch(() => caches.match(event.request))
  );
});
