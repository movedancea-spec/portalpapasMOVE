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

const CACHE_NAME = "move-portal-v31";

const ARCHIVOS_APP = [
  "./",
  "./index.html",
  "./portal.css",
  "./portal.js",
  "./clase.html",
  "./clase.css",
  "./clase.js",
  "./control.html",
  "./control.css",
  "./control.js",
  "./maestras.html",
  "./maestras.css",
  "./maestras.js",
  "./sesionmaestra.js",
  "./portal-maestras.html",
  "./manifestmaestras.json",
  "./recepcion.html",
  "./recepcion.css",
  "./recepcion.js",
  "./ranking.html",
  "./ranking.css",
  "./ranking.js",
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

// -------------------------------------
// NOTIFICACIONES PUSH (avisos de asistencia del biométrico)
// -------------------------------------
// Cuando el Worker del biométrico manda un push (ver worker-biometrico.js
// -> enviarPush), este evento se dispara aunque el portal NO esté abierto
// en ninguna pestaña, e incluso con el celular bloqueado — el sistema
// operativo se encarga de mostrar la notificación usando los datos que
// le pasamos aquí a showNotification(). Esto es lo que hace posible el
// aviso "en tiempo real" sin depender de WhatsApp/GREEN-API.
self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (e) {
    // Por si algún día se manda un push de solo texto plano (sin JSON),
    // no queremos que la notificación se pierda por un error de parseo.
    datos = { title: "MOVE Dance Academy", body: event.data ? event.data.text() : "" };
  }

  const titulo = datos.title || "🩷 MOVE Dance Academy";
  const opciones = {
    body: datos.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    // El mismo "tag" reemplaza una notificación anterior en vez de
    // amontonar varias — por ahora cada aviso lleva un tag distinto
    // (incluye el ID de evento), así que en la práctica no se
    // reemplazan entre sí, solo evita duplicados exactos.
    tag: datos.tag || "move-notificacion",
    data: { url: datos.url || "./index.html" },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

// Al tocar la notificación, llevamos a la persona al portal — si ya
// tiene una pestaña/ventana abierta (incluso instalada como app), la
// enfocamos en vez de abrir una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./index.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((listaClientes) => {
      for (const cliente of listaClientes) {
        if ("focus" in cliente) {
          return cliente.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
