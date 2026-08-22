// Service Worker del Portal de Alumnas — solo existe para poder
// recibir notificaciones push aunque el portal no esté abierto en ese
// momento. No cachea nada del sitio (no es para funcionar sin
// internet), solo escucha 'push' y 'notificationclick'.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

self.addEventListener("push", (evento) => {
  let datos = { titulo: "Biométrico", cuerpo: "Tu hija tiene una novedad." };
  try {
    if (evento.data) datos = evento.data.json();
  } catch (e) {
    // Si por lo que sea no viene como JSON, se usa el texto tal cual.
    if (evento.data) datos.cuerpo = evento.data.text();
  }

  evento.waitUntil(
    self.registration.showNotification(datos.titulo || "Biométrico", {
      body: datos.cuerpo || "",
      tag: "biometrico-asistencia",
    })
  );
});

// Al tocar la notificación, abre el portal (o le da foco a la
// pestaña que ya esté abierta, en vez de abrir una nueva).
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((listaClientes) => {
      for (const cliente of listaClientes) {
        if (cliente.url.includes("portal.html") && "focus" in cliente) return cliente.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("portal.html");
    })
  );
});
