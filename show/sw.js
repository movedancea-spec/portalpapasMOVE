// Service worker SOLO del mapa del show (academiamovedance.com/show/).
// Está dentro de /show/, así que el navegador no lo deja controlar nada
// fuera de /show/: el portal, sus push y sus llaves VAPID siguen con el
// sw.js de la raíz. Aquí no hay push: la señal en el teatro es mala y lo
// único que hace es que el mapa abra aunque casi no haya internet.
const CACHE = "show-rollercoaster-v3";
const PAGINA = "/show/";
const ARCHIVOS = [
  PAGINA,
  "/show/park-map.webp",
  "/show/logo-dance-rollercoaster.webp",
  "/show/logo-academia-move.png",
];
// Con señal mala una petición puede quedarse colgada sin llegar a fallar;
// sin este límite la página tardaría en caer a la copia guardada.
const ESPERA_RED_MS = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith("show-rollercoaster-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function guardar(pedido, respuesta) {
  if (respuesta.ok || respuesta.type === "opaque") {
    const copia = respuesta.clone();
    caches.open(CACHE).then((c) => c.put(pedido, copia));
  }
  return respuesta;
}

// La página: primero la red (así sale el reparto más nuevo); si no responde
// a tiempo, la copia guardada, y la red la actualiza por detrás al llegar.
function paginaConRespaldo(pedido) {
  const red = fetch(pedido).then((r) => guardar(PAGINA, r));
  const espera = new Promise((listo) => setTimeout(listo, ESPERA_RED_MS));
  const copia = () => caches.match(PAGINA);
  return Promise.race([red, espera.then(copia)])
    .then((r) => r || red)
    .catch(() => copia().then((r) => r || red));
}

// Imágenes y letras no cambian: primero lo guardado, para no gastar datos.
function archivoGuardadoPrimero(pedido) {
  return caches.match(pedido, { ignoreSearch: true }).then((guardada) => guardada || fetch(pedido).then((r) => guardar(pedido, r)));
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const esLetra = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (e.request.mode === "navigate") e.respondWith(paginaConRespaldo(e.request));
  else if (esLetra || url.origin === self.location.origin) e.respondWith(archivoGuardadoPrimero(e.request));
});
