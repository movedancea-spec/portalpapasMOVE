// =====================================================================
// BIOMÉTRICO — Portal de Alumnos (papás)
// =====================================================================
// IMPORTANTE: cambia esta URL por la de TU Worker una vez publicado en
// Cloudflare — debe ser la MISMA URL que pusiste en academia.js y
// dueno.js. Sin "/" al final.
const API_URL = "https://biometrico-saas.movedancea.workers.dev";

const el = (id) => document.getElementById(id);

// Cada alumno agregado en ESTE dispositivo se guarda aquí (localStorage),
// igual de simple que el resto del sistema: se manda la clave en cada
// llamada y el servidor la revisa cada vez (no hay "sesión" del lado
// del servidor). Así, un mismo teléfono puede tener varios hijos
// agregadas a la vez.
let alumnasGuardadas = [];   // [{alumnaId, clave, nombre, codigo, fotoKey, clasesPorMes, academiaId, academiaNombre, colorMarca, logoKey}]
let alumnaActivaId = null;   // cuál de las de arriba se está viendo ahora
let alumnasParaElegir = [];  // resultado temporal de "buscar academia", antes de iniciar sesión

async function llamar(accion, datos) {
  const activa = alumnaActivaId ? alumnasGuardadas.find((a) => a.alumnaId === alumnaActivaId) : null;
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion, alumnaId: activa?.alumnaId, clave: activa?.clave, ...datos }),
  });
  return await resp.json();
}

function escaparHtml(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function urlFoto(fotoKey) {
  return fotoKey ? `${API_URL}/foto?key=${encodeURIComponent(fotoKey)}` : "";
}

function formatearFechaHora(fechaSql) {
  try {
    const fecha = new Date(String(fechaSql).replace(" ", "T") + "Z");
    return fecha.toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch (e) {
    return fechaSql;
  }
}

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function formatearMes(mesTexto) {
  const [anio, mes] = String(mesTexto).split("-").map(Number);
  return `${NOMBRES_MES[mes - 1] || mesTexto} ${anio}`;
}

// ---------------------------------------------------------------
// Colores de marca — igual que en academia.js/biometrico.js, así el
// portal se ve "vestido" con el color y el logo de CADA academia.
// ---------------------------------------------------------------
function hexARgb(hex) {
  const limpio = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(limpio.substr(i, 2), 16));
}
function rgbAHex(rgb) {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}
function mezclarConBlanco(hex, porcentaje) {
  return rgbAHex(hexARgb(hex).map((c) => c + (255 - c) * porcentaje));
}
function oscurecer(hex, porcentaje) {
  return rgbAHex(hexARgb(hex).map((c) => c * (1 - porcentaje)));
}
function aplicarMarca(colorMarca) {
  const raiz = document.documentElement.style;
  ["--color-marca", "--color-marca-oscuro", "--color-marca-suave", "--color-marca-suave2",
    "--color-marca-suave3", "--color-marca-fondo", "--color-marca-fondo2", "--color-marca-fondo3",
    "--color-marca-texto-suave", "--color-marca-texto-suave2"].forEach((v) => raiz.removeProperty(v));

  if (!colorMarca || !/^#[0-9a-fA-F]{6}$/.test(colorMarca)) return;

  raiz.setProperty("--color-marca", colorMarca);
  raiz.setProperty("--color-marca-oscuro", oscurecer(colorMarca, 0.15));
  raiz.setProperty("--color-marca-suave", mezclarConBlanco(colorMarca, 0.88));
  raiz.setProperty("--color-marca-suave2", mezclarConBlanco(colorMarca, 0.82));
  raiz.setProperty("--color-marca-suave3", mezclarConBlanco(colorMarca, 0.75));
  raiz.setProperty("--color-marca-fondo", mezclarConBlanco(colorMarca, 0.96));
  raiz.setProperty("--color-marca-fondo2", mezclarConBlanco(colorMarca, 0.94));
  raiz.setProperty("--color-marca-fondo3", mezclarConBlanco(colorMarca, 0.92));
  raiz.setProperty("--color-marca-texto-suave", oscurecer(colorMarca, 0.25));
}
function aplicarLogoEnHeader(logoKey) {
  const img = el("logoPortalAcademia");
  if (logoKey) { img.src = urlFoto(logoKey); img.hidden = false; }
  else { img.hidden = true; }
}

// ---------------------------------------------------------------
// Guardar / cargar los alumnos de este dispositivo
// ---------------------------------------------------------------
function guardarAlumnasEnDisco() {
  localStorage.setItem("biometrico_portal_alumnas", JSON.stringify(alumnasGuardadas));
  localStorage.setItem("biometrico_portal_alumna_activa", alumnaActivaId || "");
}
function cargarAlumnasDeDisco() {
  try {
    alumnasGuardadas = JSON.parse(localStorage.getItem("biometrico_portal_alumnas") || "[]");
  } catch (e) {
    alumnasGuardadas = [];
  }
  alumnaActivaId = localStorage.getItem("biometrico_portal_alumna_activa") || null;
  if (!alumnasGuardadas.some((a) => a.alumnaId === alumnaActivaId)) {
    alumnaActivaId = alumnasGuardadas[0]?.alumnaId || null;
  }
}
function alumnasConNotificacionesActivas() {
  try {
    return new Set(JSON.parse(localStorage.getItem("biometrico_portal_push_activas") || "[]"));
  } catch (e) {
    return new Set();
  }
}
function guardarAlumnasConNotificacionesActivas(set) {
  localStorage.setItem("biometrico_portal_push_activas", JSON.stringify([...set]));
}

// ---------------------------------------------------------------
// PASO 1: buscar academia
// ---------------------------------------------------------------
function mostrarPantallaBuscarAcademia() {
  el("pantallaBuscarAcademia").hidden = false;
  el("pantallaElegirAlumna").hidden = true;
  el("pantallaOlvidePortal").hidden = true;
  el("pantallaRestablecerPortal").hidden = true;
  el("pantallaPortalPanel").hidden = true;
  el("inputPortalAcademia").value = "";
  el("mensajeErrorBuscarAcademia").textContent = "";
}

el("btnBuscarAcademia").addEventListener("click", async () => {
  const nombreAcademia = el("inputPortalAcademia").value.trim();
  el("mensajeErrorBuscarAcademia").textContent = "";
  if (!nombreAcademia) { el("mensajeErrorBuscarAcademia").textContent = "Escribe el nombre de la academia."; return; }

  el("btnBuscarAcademia").disabled = true;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "portalListarAlumnas", academiaNombre: nombreAcademia }),
    }).then((resp) => resp.json());

    if (!r.success) { el("mensajeErrorBuscarAcademia").textContent = r.error || "No se pudo continuar."; return; }
    if (!r.alumnas.length) { el("mensajeErrorBuscarAcademia").textContent = "Esa academia todavía no tiene alumnos registrados."; return; }

    alumnasParaElegir = { academiaId: r.academiaId, academiaNombre: nombreAcademia, alumnas: r.alumnas };

    const select = el("selectAlumnaPortal");
    select.innerHTML = r.alumnas.map((a) => `<option value="${a.id}">${escaparHtml(a.nombre)}</option>`).join("");
    el("subtituloElegirAlumna").textContent = `Elige el nombre de tu hijo en ${nombreAcademia} y escribe su contraseña del portal.`;
    el("inputPortalClave").value = "";
    el("mensajeErrorEntrarPortal").textContent = "";

    el("pantallaBuscarAcademia").hidden = true;
    el("pantallaElegirAlumna").hidden = false;
  } catch (e) {
    el("mensajeErrorBuscarAcademia").textContent = "No se pudo conectar. Revisa tu conexión.";
  } finally {
    el("btnBuscarAcademia").disabled = false;
  }
});

el("btnVolverBuscarAcademia").addEventListener("click", mostrarPantallaBuscarAcademia);

// ---------------------------------------------------------------
// PASO 2: elegir alumno + contraseña → entrar
// ---------------------------------------------------------------
el("btnEntrarPortal").addEventListener("click", async () => {
  const alumnaId = Number(el("selectAlumnaPortal").value);
  const clave = el("inputPortalClave").value.trim();
  el("mensajeErrorEntrarPortal").textContent = "";
  if (!clave) { el("mensajeErrorEntrarPortal").textContent = "Escribe la contraseña."; return; }

  el("btnEntrarPortal").disabled = true;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "portalLogin", alumnaId, clave }),
    }).then((resp) => resp.json());

    if (!r.success) {
      el("mensajeErrorEntrarPortal").textContent = r.error || "No se pudo entrar.";
      return;
    }

    const entrada = {
      alumnaId: r.alumnaId, clave, nombre: r.nombre, codigo: r.codigo, fotoKey: r.fotoKey,
      clasesPorMes: r.clasesPorMes, academiaId: r.academiaId, academiaNombre: r.academiaNombre,
      colorMarca: r.colorMarca, logoKey: r.logoKey,
    };
    alumnasGuardadas = alumnasGuardadas.filter((a) => a.alumnaId !== entrada.alumnaId);
    alumnasGuardadas.push(entrada);
    alumnaActivaId = entrada.alumnaId;
    guardarAlumnasEnDisco();

    mostrarPanel();
  } catch (e) {
    el("mensajeErrorEntrarPortal").textContent = "No se pudo conectar. Revisa tu conexión.";
  } finally {
    el("btnEntrarPortal").disabled = false;
  }
});

el("btnAgregarOtraAlumna").addEventListener("click", mostrarPantallaBuscarAcademia);

// ---------------------------------------------------------------
// "Olvidé mi contraseña" del portal
// ---------------------------------------------------------------
let alumnaIdParaOlvide = null;

el("btnMostrarOlvidePortal").addEventListener("click", () => {
  alumnaIdParaOlvide = Number(el("selectAlumnaPortal").value);
  el("pantallaElegirAlumna").hidden = true;
  el("pantallaOlvidePortal").hidden = false;
  el("inputOlvidePortalEmail").value = "";
  el("mensajeErrorOlvidePortal").textContent = "";
  el("mensajeExitoOlvidePortal").textContent = "";
});

el("btnCancelarOlvidePortal").addEventListener("click", () => {
  el("pantallaOlvidePortal").hidden = true;
  el("pantallaElegirAlumna").hidden = false;
});

el("btnEnviarOlvidePortal").addEventListener("click", async () => {
  const email = el("inputOlvidePortalEmail").value.trim();
  el("mensajeErrorOlvidePortal").textContent = "";
  el("mensajeExitoOlvidePortal").textContent = "";
  if (!email) { el("mensajeErrorOlvidePortal").textContent = "Escribe tu correo."; return; }

  el("btnEnviarOlvidePortal").disabled = true;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "portalSolicitarRecuperacion",
        alumnaId: alumnaIdParaOlvide,
        email,
        origenPortal: location.origin + location.pathname,
      }),
    }).then((resp) => resp.json());

    if (!r.success) { el("mensajeErrorOlvidePortal").textContent = r.error || "No se pudo enviar."; return; }
    el("mensajeExitoOlvidePortal").textContent = r.mensaje;
  } catch (e) {
    el("mensajeErrorOlvidePortal").textContent = "No se pudo conectar. Revisa tu conexión.";
  } finally {
    el("btnEnviarOlvidePortal").disabled = false;
  }
});

el("btnRestablecerPortalClave").addEventListener("click", async () => {
  const params = new URLSearchParams(location.search);
  const token = params.get("recuperar");
  const claveNueva = el("inputRestablecerPortalClave").value.trim();
  const claveConfirmar = el("inputRestablecerPortalClaveConfirmar").value.trim();

  el("mensajeErrorRestablecerPortal").textContent = "";
  el("mensajeExitoRestablecerPortal").textContent = "";

  if (claveNueva.length < 4) { el("mensajeErrorRestablecerPortal").textContent = "La contraseña debe tener al menos 4 caracteres."; return; }
  if (claveNueva !== claveConfirmar) { el("mensajeErrorRestablecerPortal").textContent = "Las contraseñas no coinciden."; return; }

  el("btnRestablecerPortalClave").disabled = true;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "portalRestablecerClave", token, claveNueva }),
    }).then((resp) => resp.json());

    if (!r.success) { el("mensajeErrorRestablecerPortal").textContent = r.error || "No se pudo actualizar."; return; }
    el("mensajeExitoRestablecerPortal").textContent = "¡Listo! Ya puedes iniciar sesión con tu contraseña nueva.";
    history.replaceState(null, "", location.pathname);
    setTimeout(() => {
      el("pantallaRestablecerPortal").hidden = true;
      mostrarPantallaBuscarAcademia();
    }, 1800);
  } catch (e) {
    el("mensajeErrorRestablecerPortal").textContent = "No se pudo conectar. Revisa tu conexión.";
  } finally {
    el("btnRestablecerPortalClave").disabled = false;
  }
});

// ---------------------------------------------------------------
// PANEL PRINCIPAL
// ---------------------------------------------------------------
function pintarSelectorAlumnas() {
  const cont = el("selectorAlumnasPortal");
  if (alumnasGuardadas.length <= 1) { cont.innerHTML = ""; return; }
  cont.innerHTML = alumnasGuardadas.map((a) => `
    <button type="button" class="chip-alumna ${a.alumnaId === alumnaActivaId ? "activo" : ""}" data-id="${a.alumnaId}">${escaparHtml(a.nombre)}</button>
  `).join("");
  cont.querySelectorAll(".chip-alumna").forEach((btn) => {
    btn.addEventListener("click", () => seleccionarAlumna(Number(btn.dataset.id)));
  });
}

async function mostrarPanel() {
  el("pantallaBuscarAcademia").hidden = true;
  el("pantallaElegirAlumna").hidden = true;
  el("pantallaOlvidePortal").hidden = true;
  el("pantallaRestablecerPortal").hidden = true;
  el("pantallaPortalPanel").hidden = false;
  await seleccionarAlumna(alumnaActivaId);
}

async function seleccionarAlumna(alumnaId) {
  const entrada = alumnasGuardadas.find((a) => a.alumnaId === alumnaId);
  if (!entrada) { mostrarPantallaBuscarAcademia(); return; }

  alumnaActivaId = alumnaId;
  guardarAlumnasEnDisco();
  pintarSelectorAlumnas();

  aplicarMarca(entrada.colorMarca);
  aplicarLogoEnHeader(entrada.logoKey);
  el("tituloPortalAcademia").textContent = `👨‍👩‍👧 ${entrada.academiaNombre}`;
  el("nombreAlumnaPortal").textContent = entrada.nombre;
  el("codigoAlumnaPortal").textContent = `#${entrada.codigo}`;
  pintarFotoAlumna(entrada.fotoKey);
  el("statClasesEsteMes").textContent = "—";
  el("inputEmailFamiliaPortal").value = "";
  el("mensajeErrorPush").textContent = "";

  actualizarBotonPush();

  try {
    const r = await llamar("portalConsultarAlumna", {});
    if (!r.success) {
      // La sesión guardada para este alumno ya no sirve (le cambiaron
      // la clave desde otro lado, etc.) — se quita sola de este
      // dispositivo para no dejarla "pegada" sin funcionar.
      quitarAlumnaDelDispositivo(alumnaId, false);
      return;
    }
    entrada.nombre = r.nombre; entrada.codigo = r.codigo; entrada.fotoKey = r.fotoKey;
    entrada.clasesPorMes = r.clasesPorMes; entrada.colorMarca = r.academia.colorMarca; entrada.logoKey = r.academia.logoKey;
    entrada.academiaNombre = r.academia.nombre;
    guardarAlumnasEnDisco();

    aplicarMarca(entrada.colorMarca);
    aplicarLogoEnHeader(entrada.logoKey);
    el("tituloPortalAcademia").textContent = `👨‍👩‍👧 ${entrada.academiaNombre}`;
    el("nombreAlumnaPortal").textContent = entrada.nombre;
    el("codigoAlumnaPortal").textContent = `#${entrada.codigo}`;
    pintarFotoAlumna(entrada.fotoKey);
    el("statClasesEsteMes").textContent = `${r.clasesEsteMes} / ${r.clasesPorMes}`;
    el("inputEmailFamiliaPortal").value = r.emailFamilia || "";
  } catch (e) {
    // Sin conexión — se deja lo que ya había en caché en vez de tronar.
  }

  cargarHistorialMeses();
  cargarHistorialEntradas();
}

function pintarFotoAlumna(fotoKey) {
  const img = el("fotoAlumnaPortal");
  const vacia = el("fotoAlumnaPortalVacia");
  if (fotoKey) { img.src = urlFoto(fotoKey); img.hidden = false; vacia.hidden = true; }
  else { img.hidden = true; vacia.hidden = false; }
}

async function cargarHistorialMeses() {
  const cont = el("listaHistorialMeses");
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const r = await llamar("portalHistorialAsistenciasPorMes", {});
    if (!r.success || !r.historial.length) {
      cont.innerHTML = '<p class="lista-vacia">Todavía no hay ninguna asistencia registrada.</p>';
      return;
    }
    cont.innerHTML = r.historial.map((h) => `
      <div class="tarjeta-item">
        <div class="info-principal">
          <div class="nombre-item">${escaparHtml(formatearMes(h.mes))}</div>
          <div class="detalle-item">${h.cantidad} / ${r.clasesPorMes} clases</div>
        </div>
      </div>
    `).join("");
  } catch (e) {
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar. Revisa tu conexión.</p>';
  }
}

async function cargarHistorialEntradas() {
  const cont = el("listaHistorialEntradas");
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const r = await llamar("portalHistorialEntradas", {});
    if (!r.success || !r.entradas.length) {
      cont.innerHTML = '<p class="lista-vacia">Todavía no hay ninguna entrada registrada.</p>';
      return;
    }
    cont.innerHTML = r.entradas.map((e) => `
      <div class="tarjeta-item">
        <div class="info-principal">
          <div class="nombre-item">${escaparHtml(formatearFechaHora(e.fecha))}</div>
          <div class="detalle-item">${e.metodo === "Huella" ? "👆 Huella" : "🔢 Código"}</div>
        </div>
      </div>
    `).join("");
  } catch (e) {
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar. Revisa tu conexión.</p>';
  }
}

// ---------------------------------------------------------------
// Notificaciones push
// ---------------------------------------------------------------
function base64UrlAUint8Array(base64Url) {
  const relleno = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function actualizarBotonPush() {
  const activas = alumnasConNotificacionesActivas();
  const boton = el("btnActivarPush");
  if (activas.has(alumnaActivaId)) {
    boton.textContent = "🔕 Desactivar avisos de llegada";
    el("textoEstadoPush").textContent = "Los avisos están ACTIVADOS para este alumno en este dispositivo.";
  } else {
    boton.textContent = "🔔 Activar avisos de llegada";
    el("textoEstadoPush").textContent = "Actívalos para que te avisemos apenas marque su entrada.";
  }
}

el("btnActivarPush").addEventListener("click", async () => {
  el("mensajeErrorPush").textContent = "";
  const activas = alumnasConNotificacionesActivas();
  const boton = el("btnActivarPush");
  boton.disabled = true;

  try {
    if (activas.has(alumnaActivaId)) {
      // Apagar solo para ESTE alumno (el dispositivo puede seguir
      // suscrito para otro hermano).
      const registro = await navigator.serviceWorker.getRegistration();
      const suscripcion = registro ? await registro.pushManager.getSubscription() : null;
      if (suscripcion) {
        await llamar("portalDesuscribirPush", { endpoint: suscripcion.endpoint });
      }
      activas.delete(alumnaActivaId);
      guardarAlumnasConNotificacionesActivas(activas);
      actualizarBotonPush();
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      el("mensajeErrorPush").textContent = "Este navegador no soporta notificaciones push. En iPhone, agrega este portal a tu pantalla de inicio primero (Compartir → Agregar a pantalla de inicio) y ábrelo desde ahí.";
      return;
    }

    const registro = await navigator.serviceWorker.register("portal-sw.js");
    await navigator.serviceWorker.ready;

    let suscripcion = await registro.pushManager.getSubscription();
    if (!suscripcion) {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        el("mensajeErrorPush").textContent = "No diste permiso para las notificaciones — actívalo desde los ajustes de este navegador para poder usar esta función.";
        return;
      }
      const config = await llamar("portalConfiguracionPush", {});
      if (!config.success || !config.vapidPublicKey) {
        el("mensajeErrorPush").textContent = "Las notificaciones todavía no están activadas del lado del sistema — avísale al administrador de tu academia.";
        return;
      }
      suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlAUint8Array(config.vapidPublicKey),
      });
    }

    const r = await llamar("portalSuscribirPush", { suscripcion: suscripcion.toJSON() });
    if (!r.success) { el("mensajeErrorPush").textContent = r.error || "No se pudo activar."; return; }

    activas.add(alumnaActivaId);
    guardarAlumnasConNotificacionesActivas(activas);
    actualizarBotonPush();
  } catch (e) {
    el("mensajeErrorPush").textContent = "No se pudo activar: " + e.message;
  } finally {
    boton.disabled = false;
  }
});

// ---------------------------------------------------------------
// Mi cuenta: correo de recuperación, cambiar contraseña, quitar alumno
// ---------------------------------------------------------------
el("btnGuardarEmailFamilia").addEventListener("click", async () => {
  const email = el("inputEmailFamiliaPortal").value.trim();
  el("mensajeErrorEmailFamilia").textContent = "";
  el("mensajeExitoEmailFamilia").textContent = "";
  el("btnGuardarEmailFamilia").disabled = true;
  try {
    const r = await llamar("portalActualizarEmailFamilia", { email });
    if (!r.success) { el("mensajeErrorEmailFamilia").textContent = r.error || "No se pudo guardar."; return; }
    el("mensajeExitoEmailFamilia").textContent = "Correo guardado.";
  } catch (e) {
    el("mensajeErrorEmailFamilia").textContent = "No se pudo conectar.";
  } finally {
    el("btnGuardarEmailFamilia").disabled = false;
  }
});

el("btnCambiarClavePortal").addEventListener("click", async () => {
  const claveNueva = el("inputClaveNuevaPortal").value.trim();
  const claveConfirmar = el("inputClaveNuevaPortalConfirmar").value.trim();
  el("mensajeErrorClavePortal").textContent = "";
  el("mensajeExitoClavePortal").textContent = "";

  if (claveNueva.length < 4) { el("mensajeErrorClavePortal").textContent = "La contraseña debe tener al menos 4 caracteres."; return; }
  if (claveNueva !== claveConfirmar) { el("mensajeErrorClavePortal").textContent = "Las contraseñas no coinciden."; return; }

  el("btnCambiarClavePortal").disabled = true;
  try {
    const r = await llamar("portalCambiarClave", { claveNueva });
    if (!r.success) { el("mensajeErrorClavePortal").textContent = r.error || "No se pudo cambiar."; return; }

    const entrada = alumnasGuardadas.find((a) => a.alumnaId === alumnaActivaId);
    if (entrada) { entrada.clave = claveNueva; guardarAlumnasEnDisco(); }

    el("mensajeExitoClavePortal").textContent = "Contraseña actualizada.";
    el("inputClaveNuevaPortal").value = "";
    el("inputClaveNuevaPortalConfirmar").value = "";
  } catch (e) {
    el("mensajeErrorClavePortal").textContent = "No se pudo conectar.";
  } finally {
    el("btnCambiarClavePortal").disabled = false;
  }
});

el("btnQuitarAlumnaPortal").addEventListener("click", () => {
  const entrada = alumnasGuardadas.find((a) => a.alumnaId === alumnaActivaId);
  if (!entrada) return;
  if (!window.confirm(`¿Quitar a "${entrada.nombre}" de este dispositivo? Su historial y su cuenta NO se borran — puedes volver a agregarla cuando quieras.`)) return;
  quitarAlumnaDelDispositivo(alumnaActivaId, true);
});

async function quitarAlumnaDelDispositivo(alumnaId, avisarPush) {
  if (avisarPush) {
    const activas = alumnasConNotificacionesActivas();
    if (activas.has(alumnaId)) {
      try {
        const registro = await navigator.serviceWorker.getRegistration();
        const suscripcion = registro ? await registro.pushManager.getSubscription() : null;
        if (suscripcion) await llamar("portalDesuscribirPush", { endpoint: suscripcion.endpoint });
      } catch (e) { /* mejor esfuerzo — no bloquea quitarla igual */ }
      activas.delete(alumnaId);
      guardarAlumnasConNotificacionesActivas(activas);
    }
  }

  alumnasGuardadas = alumnasGuardadas.filter((a) => a.alumnaId !== alumnaId);
  alumnaActivaId = alumnasGuardadas[0]?.alumnaId || null;
  guardarAlumnasEnDisco();

  if (alumnasGuardadas.length) mostrarPanel();
  else mostrarPantallaBuscarAcademia();
}

// ---------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------
(function iniciar() {
  const params = new URLSearchParams(location.search);
  if (params.get("recuperar")) {
    el("pantallaBuscarAcademia").hidden = true;
    el("pantallaRestablecerPortal").hidden = false;
    return;
  }

  cargarAlumnasDeDisco();
  if (alumnasGuardadas.length) mostrarPanel();
  else mostrarPantallaBuscarAcademia();
})();
