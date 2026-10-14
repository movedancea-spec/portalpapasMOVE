// Service worker SOLO del quiz de pasillos (academiamovedance.com/quiz/).
// Está dentro de /quiz/, así que el navegador no lo deja controlar nada
// fuera de /quiz/: el portal (sw.js de la raíz) y las demás páginas no
// se enteran de que existe. Guarda la página y el logo para que el quiz
// vuelva a abrir aunque se caiga el internet en el stand. Los registros
// (POST al Worker) no pasan por aquí: los guarda la página en la tablet.
const CACHE = "quiz-pasillos-v1";
const ARCHIVOS = ["/quiz/", "/logo.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith("quiz-pasillos-") && n !== CACHE).map((n) => caches.delete(n))))
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
