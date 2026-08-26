# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este repo

Sitio estático (sin build ni bundler ni `package.json`) que aloja **dos productos distintos** de MOVE Dance Academy, desplegados juntos como páginas HTML/CSS/JS sueltas en el mismo hosting (GitHub Pages, dominio custom en `CNAME`: `academiamovedance.com`). No hay servidor propio: cada página habla por `fetch()` a Cloudflare Workers externos (código de los Workers no vive en este repo) que a su vez leen/escriben una base de **Airtable**.

No hay proceso de build, lint ni tests. "Desarrollar" es editar el HTML/CSS/JS directamente y subir los archivos; no hay comando de arranque más allá de abrir los HTML con un servidor estático local (p. ej. `npx serve .` o la extensión Live Server) para probar los `fetch()` contra los Workers reales.

## Los dos productos

### 1. Portal de Alumnas / MOVE (producto principal)
Todo lo que habla con el Worker `https://portalalumnas.movedancea.workers.dev`. Es un solo backend/Airtable compartido por todas estas pantallas — la única fuente de verdad de qué tabla/campo de Airtable usa cada `accion` está en el propio Worker, no en este repo.

- `index.html` + `portal.js` + `portal.css` — **Portal de Alumnas**, la PWA para papás (login por alumna o por "clave familiar" para ver a varias hermanas juntas). Punto de entrada real de la PWA (`manifest.json`, `sw.js`, `portal-sw.js`).
- `recepcion.html`/`.js` — pantalla fija de Recepción: solicitudes de clase (chat con maestras), alta/edición de alumnas, ingresos diarios, pagos.
- `portal-maestras.html` — Portal de Maestras (home). `sesionmaestra.js` da sesión compartida entre esta página, el Chat y el Panel de Clase (clave se escribe una sola vez).
- `maestras.js`/`maestras.html` — Chat de Maestras.
- `clase.html`/`.js` — Panel de Clase, pensado para la tablet/laptop de la maestra durante su clase (cronómetro, ruleta de gamificación —solo de sesión, no se guarda—, calificación de la clase que sí se guarda para `ranking.html`).
- `control.html`/`.js` — control remoto desde el celular de la maestra: se empareja por PIN con `clase.html` y solo escribe comandos a un buzón temporal (nunca toca Airtable directo); `clase.html` hace polling cada 2s.
- `aviso.html`/`.js` — que una maestra mande un aviso (con foto/PDF opcional) solo a su grupo, siempre por el Portal (push + visible al abrir el Portal), nunca WhatsApp.
- `ranking.html`/`.js` — ranking mensual de grupos por calificación interna; solo directora, sin historial de meses pasados.
- `prueba.html`/`.js` — formulario público de "Reserva tu Clase de Prueba" (viene del catálogo). Manda `origen` distinto al que usa Recepción para agendar por teléfono, porque aún no hay cupo confirmado.
- `catalogo.html` — catálogo de precios público, sin JS propio (solo un `<script>` inline), enlaza a `prueba.html`.
- Sistema de **Entradas del Show** (venta de boletos por turnos), todos bajo la misma `CLAVE_ENTRADAS_SHOW` (Secret de Cloudflare) salvo `entradas.html` que es pública:
  - `entradas.html`/`.js` — venta pública: elegir alumna → recibir código de turno → consultar turno → cuando toca, elegir filas y pagar con link de Paggo.
  - `entradas-admin.html`/`.js` — panel de Ana: programar/activar registro, pausar venta, ver filas restantes y lista de registrados.
  - `entradas-caja.html`/`.js` — caja de Recepción: buscar turno por código, elegir butacas, generar link de pago (el Worker lo manda por WhatsApp).
  - `entradas-pantalla.html`/`.js` — pantalla de solo lectura para un monitor de recepción (turno en curso, cronómetro, mapa de butacas).
  - `entradas.css`, `entradas-admin.css`, `entradas-caja.css`, `entradas-pantalla.css`, `entradas-mapa.css` — el mapa de butacas (`entradas-mapa.css`) se comparte entre las tres pantallas privadas + la pública.

### 2. Biométrico (producto SaaS aparte, multi-academia)
Todo lo que habla con el Worker `https://biometrico-saas.movedancea.workers.dev`. Es un SaaS de control de asistencia por biométrico, con sus propias plantillas (`biometrico-style.css`) — **no comparte Airtable ni Worker con el Portal de Alumnas**.

- `dueno.html`/`.js` — panel del dueño del SaaS (Ana): alta/gestión de academias clientes.
- `academia.html`/`.js` — panel de una academia cliente: alumnas, fotos, asistencias casi en tiempo real (polling).
- `biometrico.html`/`.js` — pantalla de entrada tipo kiosko (para dejar fija en una tablet): captura código, muestra foto y bienvenida, regresa sola a esperar el siguiente.
- `portal.html` (¡ojo, no confundir con `index.html`!) — "Portal de Alumnos" de este producto: historial de asistencia del hijo + activar avisos de llegada. Usa `biometrico-style.css`, no `portal.css`, y no tiene relación con `portal.js`/Airtable del otro producto.

## Patrones importantes

- **Nunca hay claves de Airtable en el frontend.** Cada página solo conoce la URL pública del Worker; el Worker es el único lugar con la API key de Airtable y los Secrets (p. ej. `CLAVE_ENTRADAS_SHOW`, `VAPID_PRIVATE_KEY`). Si necesitas agregar una funcionalidad que lea/escriba Airtable, se hace agregando una `accion` nueva en el Worker (fuera de este repo) y consumiéndola desde aquí — nunca llamando a Airtable directo.
- **Convención de llamada al Worker** — casi todos los archivos redefinen la misma función local (`llamarWorker(payload)` o `llamar(accion, datos)`) que hace `fetch(WORKER_URL, {method:"POST", body: JSON.stringify({accion, ...})})` y valida `datos.success`. Es duplicado a propósito (no hay módulo compartido/bundler); si tocas esta lógica en un archivo, revisa si el mismo bug existe en los demás.
- **Sesión compartida de maestras** (`sesionmaestra.js`) vive en `localStorage` (no `sessionStorage`) para sobrevivir cierres de la app; la usan `portal-maestras.html`, `maestras.js`, `clase.js`, `aviso.js`. El Biométrico usa sus propias llaves de `localStorage` (`biometrico_clave_dueno`, `biometrico_sesion_academia`, `biometrico_sesion_kiosko`), independientes de las del Portal.
- **Notificaciones push**: una sola suscripción VAPID sirve tanto para avisos de asistencia del biométrico (Worker `move-checkin-v2`) como para mensajes del Chat de Maestras (Worker `portalalumnas`). La llave privada VAPID debe coincidir, como Secret, en ambos Workers a la vez si se regenera.
- **Service workers duales en el Portal**: `sw.js` cachea los archivos estáticos del portal con estrategia "red primero, caché de respaldo" (nunca cachea datos del Worker) y sube `CACHE_NAME` (`move-portal-vNN`) cada vez que se quiere forzar refresco; `portal-sw.js` es aparte y solo existe para recibir `push`/`notificationclick` aunque el portal esté cerrado.
- **Cache-busting manual**: algunos `<script src="archivo.js?v=hash">`/`<link href="...css?v=hash">` llevan un query param a mano (no generado por build) para invalidar caché de navegador tras un cambio; al editar esos archivos conviene cambiar el `?v=`.
- **Textos en español, con muchos comentarios explicando el "por qué"** (audiencia no técnica: Ana, la dueña/directora). Sigue ese tono/idioma al modificar comentarios o UI.
- Nombres de campos de Airtable a veces se referencian larguísimos y literales en el JS (p. ej. `CAMPO_PARTICIPACION_SHOW` en `portal.js`), con espacios dobles intencionales — deben coincidir letra por letra con Airtable; no "limpiar" ese texto pensando que es un typo.
