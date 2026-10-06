# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este repo

Sitio estático (sin build ni bundler ni `package.json`) que aloja el **Portal de Alumnas de MOVE Dance Academy** (y, solo como redirecciones, los links viejos del Biométrico SaaS — ver sección 2), desplegado como páginas HTML/CSS/JS sueltas en el mismo hosting (GitHub Pages, dominio custom en `CNAME`: `academiamovedance.com`). No hay servidor propio: cada página habla por `fetch()` a Cloudflare Workers externos (código de los Workers no vive en este repo) que a su vez leen/escriben una base de **Airtable**.

No hay proceso de build, lint ni tests. "Desarrollar" es editar el HTML/CSS/JS directamente y subir los archivos; no hay comando de arranque más allá de abrir los HTML con un servidor estático local (p. ej. `npx serve .` o la extensión Live Server) para probar los `fetch()` contra los Workers reales.

## Productos

### 1. Portal de Alumnas / MOVE (producto principal)
Todo lo que habla con el Worker `https://portalalumnas.movedancea.workers.dev`. Es un solo backend/Airtable compartido por todas estas pantallas — la única fuente de verdad de qué tabla/campo de Airtable usa cada `accion` está en el propio Worker, no en este repo.

- `index.html` + `portal.js` + `portal.css` — **Portal de Alumnas**, la PWA para papás (login por alumna o por "clave familiar" para ver a varias hermanas juntas). Punto de entrada real de la PWA (`manifest.json`, `sw.js` — que también recibe sus notificaciones push). Las acciones que confirman que quien pregunta es la familia (código de recogida, `maestrasDeAlumna`, `evaluacionMaestrasEstado`) mandan la clave con `credencialesAlumna()`.
- `recepcion.html`/`.js` — pantalla fija de Recepción: solicitudes de clase (chat con maestras), alta/edición de alumnas, ingresos diarios, pagos. También tiene los interruptores que se guardan en `CONFIGURACION GENERAL` (evaluación de maestras, estado del portal, y "🎟️ Venta de entradas", que muestra u oculta el botón "🎟️ Caja de entradas (solo personal)" en la pantalla de bienvenida de recepción, repo `move-recepcion2-sin-biometrico`).
- `portal-maestras.html` — Portal de Maestras (home). Tiene el aviso "🎉 Hoy cumple…" y la vista "🎂 Cumpleaños" del mes (acción `maestraCumpleanosMes`, con la clave de la maestra; "hoy" con `TemasFecha.hoyGuatemala()`). La regla de cumpleaños (solo mes y día, sin zona horaria, 29 de febrero → 28 en años no bisiestos) vive solo en `temas-fecha.js` (`cumpleEnAnio` / `esCumpleHoy`), que también usan `portal.js` y `clase.js`. `sesionmaestra.js` da sesión compartida entre esta página, el Chat y el Panel de Clase (clave se escribe una sola vez).
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

### 2. Biométrico (producto SaaS aparte, multi-academia) — YA NO VIVE AQUÍ
El SaaS de asistencia por biométrico (Worker `https://biometrico-saas.movedancea.workers.dev`, base D1 propia, **no comparte Airtable ni Worker con el Portal de Alumnas**) vive en su propio repo: **`movedancea-spec/biometrico-clientes`**, publicado en `https://movedancea-spec.github.io/biometrico-clientes/`. Cualquier cambio del SaaS se hace allá, nunca aquí.

- `portal.html`, `biometrico.html`, `academia.html`, `dueno.html` — en este repo son **solo redirecciones** a la misma página en `biometrico-clientes` (conservan `?…` y `#…`), para que los links viejos sigan funcionando. No les agregues nada.
- Los JS/CSS de la copia vieja del SaaS (`biometrico.js`, `academia.js`, `dueno.js`, `biometrico-style.css`, `portal-sw.js`) se quitaron de este repo el 1 de octubre de 2026; si los buscas, están en `biometrico-clientes`.
- **Regla: el SaaS nunca debe compartir nombres de archivo con el Portal de MOVE.** El 22 de agosto de 2026 un "Update portal.js" subido desde la web de GitHub pisó el `portal.js` del SaaS con el del Portal de MOVE (los dos se llamaban igual) y el portal de papás del SaaS quedó roto en este sitio. Si algún día algo del SaaS tiene que volver a este repo, usa nombres que no existan en el Portal de MOVE.

## Patrones importantes

- **Nunca hay claves de Airtable en el frontend.** Cada página solo conoce la URL pública del Worker; el Worker es el único lugar con la API key de Airtable y los Secrets (p. ej. `CLAVE_ENTRADAS_SHOW`, `VAPID_PRIVATE_KEY`). Si necesitas agregar una funcionalidad que lea/escriba Airtable, se hace agregando una `accion` nueva en el Worker (fuera de este repo) y consumiéndola desde aquí — nunca llamando a Airtable directo.
- **Convención de llamada al Worker** — casi todos los archivos redefinen la misma función local (`llamarWorker(payload)` o `llamar(accion, datos)`) que hace `fetch(WORKER_URL, {method:"POST", body: JSON.stringify({accion, ...})})` y valida `datos.success`. Es duplicado a propósito (no hay módulo compartido/bundler); si tocas esta lógica en un archivo, revisa si el mismo bug existe en los demás.
- **Sesión compartida de maestras** (`sesionmaestra.js`) vive en `localStorage` (no `sessionStorage`) para sobrevivir cierres de la app; la usan `portal-maestras.html`, `maestras.js`, `clase.js`, `aviso.js`.
- **Notificaciones push**: una sola suscripción VAPID sirve tanto para avisos de asistencia del biométrico (Worker `move-checkin-v2`) como para mensajes del Chat de Maestras (Worker `portalalumnas`). La llave privada VAPID debe coincidir, como Secret, en ambos Workers a la vez si se regenera.
- **Service worker del Portal**: `sw.js` cachea los archivos estáticos del portal con estrategia "red primero, caché de respaldo" (nunca cachea datos del Worker), recibe `push`/`notificationclick`, y sube `CACHE_NAME` (`move-portal-vNN`) cada vez que se quiere forzar refresco. (Aquí ya no hay `portal-sw.js`: era del SaaS viejo, ver sección 2.)
- **Fechas especiales** (Día del Niño, Halloween, Navidad…): las fechas, emojis y letreros viven solo en `temas-fecha.js`, y los colores y animaciones en `temas-fecha.css`. Los usan `index.html` y `clase.html`; "hoy" se calcula en hora de Guatemala. Para una fecha nueva se edita solo ahí y se sube el `?v=` en esas páginas. BIOMETRICO-V4 (repo aparte) tiene su propia copia de las fechas.
- **Cache-busting manual**: algunos `<script src="archivo.js?v=hash">`/`<link href="...css?v=hash">` llevan un query param a mano (no generado por build) para invalidar caché de navegador tras un cambio; al editar esos archivos conviene cambiar el `?v=`.
- **Textos en español, con muchos comentarios explicando el "por qué"** (audiencia no técnica: Ana, la dueña/directora). Sigue ese tono/idioma al modificar comentarios o UI.
- Nombres de campos de Airtable a veces se referencian larguísimos y literales en el JS (p. ej. `CAMPO_PARTICIPACION_SHOW` en `portal.js`), con espacios dobles intencionales — deben coincidir letra por letra con Airtable; no "limpiar" ese texto pensando que es un typo.
