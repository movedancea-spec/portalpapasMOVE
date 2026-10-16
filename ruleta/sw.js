// Service worker SOLO de la ruleta de premios (academiamovedance.com/ruleta/).
// Está dentro de /ruleta/, así que no controla nada fuera de /ruleta/
// (ni el portal ni el quiz). Guarda la página y el logo para que la
// ruleta abra aunque se caiga el internet y diga "Conectando…": sin
// internet NO se gira (los premios los decide el Worker).
const CACHE = "ruleta-premios-v2";
const ARCHIVOS = ["/ruleta/", "/logo.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith("ruleta-premios-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (así siempre sale la versión nueva); sin red, lo guardado.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok || r.type === "opaque") {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
