// =====================================================================
// BIOMÉTRICO — Pantalla de Entrada (para dejar en una tablet)
// =====================================================================
// Esta es la pantalla que se queda fija en la entrada: el alumno
// escribe su código con el teclado en pantalla, ve su foto y un
// mensaje de bienvenida, y automáticamente regresa a esperar el
// siguiente código. No tiene NADA de administración — para eso está
// academia.html, aparte.
//
// IMPORTANTE: misma URL que en dueno.js/academia.js. Sin "/" al final.
const API_URL = "https://biometrico-saas.movedancea.workers.dev";

const el = (id) => document.getElementById(id);

let sesion = null; // { academiaId, clave, nombre }
let codigoActual = "";
let timeoutResultado = null;

document.body.classList.add("modo-kiosko");

function urlFoto(fotoKey) {
  return fotoKey ? `${API_URL}/foto?key=${encodeURIComponent(fotoKey)}` : "";
}

function escaparHtml(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

// ---------------------------------------------------------------
// PERSONALIZACIÓN (color + logo) — la elige la academia desde su
// panel (academia.html); aquí solo se APLICA lo que ya está guardado.
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

  // Siempre se limpia primero: si esta tablet/navegador ya había
  // aplicado el color de OTRA academia (por ejemplo, alguien salió e
  // inició sesión con una cuenta distinta), no debe quedarse pegado.
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
  raiz.setProperty("--color-marca-texto-suave2", oscurecer(colorMarca, 0.1));
}

function aplicarLogoKiosko(logoKey) {
  const img = el("logoKiosko");
  if (logoKey) {
    img.src = urlFoto(logoKey);
    img.hidden = false;
  } else {
    img.hidden = true;
  }
}

async function llamar(accion, datos) {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion, academiaId: sesion?.academiaId, clave: sesion?.clave, ...datos }),
  });
  return await resp.json();
}

// ---------------------------------------------------------------
// LOGIN / SESIÓN (se guarda en esta tablet — no hay que repetirlo)
// ---------------------------------------------------------------
function guardarSesion(s) {
  sesion = s;
  localStorage.setItem("biometrico_sesion_kiosko", JSON.stringify(s));
}

function cargarSesionGuardada() {
  try {
    const cruda = localStorage.getItem("biometrico_sesion_kiosko");
    return cruda ? JSON.parse(cruda) : null;
  } catch (e) {
    return null;
  }
}

function mostrarTeclado() {
  el("pantallaLogin").hidden = true;
  el("pantallaResultado").hidden = true;
  el("pantallaTeclado").hidden = false;
  el("marcaAcademiaKiosko").textContent = sesion.nombre;
  aplicarMarca(sesion.colorMarca);
  aplicarLogoKiosko(sesion.logoKey);
  reiniciarCodigo();
  iniciarActualizacionAutomaticaDeMarca();
}

// ---------------------------------------------------------------
// ACTUALIZACIÓN AUTOMÁTICA DE COLOR/LOGO (sin salir e iniciar sesión)
// ---------------------------------------------------------------
// Como esta tablet se queda con la sesión guardada por días o semanas,
// si la academia cambia su color o logo desde OTRO dispositivo (su
// celular, su computadora), esta tablet nunca se entera por sí sola —
// se queda con lo que tenía guardado. Para que "se actualice sola",
// cada cierto tiempo se vuelve a preguntar al servidor en silencio
// (sin mostrar nada en pantalla) si hay un color/logo más reciente, y
// si lo hay, se aplica de inmediato sin interrumpir a quien esté
// usando el teclado.
const INTERVALO_ACTUALIZACION_MARCA_MS = 3 * 60 * 1000; // cada 3 minutos
let temporizadorActualizacionMarca = null;

async function refrescarMarcaEnSilencio() {
  if (!sesion || !sesion.nombre || !sesion.clave) return;
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "academiaLogin", nombre: sesion.nombre, clave: sesion.clave }),
    });
    const r = await resp.json();
    if (!r.success) return; // si falla (ej. desactivada), no se interrumpe el kiosko por esto
    const colorNuevo = r.colorMarca || null;
    const logoNuevo = r.logoKey || null;
    if (colorNuevo !== sesion.colorMarca || logoNuevo !== sesion.logoKey) {
      sesion.colorMarca = colorNuevo;
      sesion.logoKey = logoNuevo;
      guardarSesion(sesion);
      aplicarMarca(sesion.colorMarca);
      aplicarLogoKiosko(sesion.logoKey);
    }
  } catch (e) {
    // Sin conexión momentánea: no pasa nada, se vuelve a intentar en el siguiente ciclo.
  }
}

function iniciarActualizacionAutomaticaDeMarca() {
  if (temporizadorActualizacionMarca) return; // ya está corriendo, no duplicar
  temporizadorActualizacionMarca = setInterval(refrescarMarcaEnSilencio, INTERVALO_ACTUALIZACION_MARCA_MS);
  // Además de esperar el primer intervalo, se hace un primer chequeo
  // pronto después de entrar, por si el cambio de color ya se había
  // hecho antes de prender la tablet ese día.
  setTimeout(refrescarMarcaEnSilencio, 15000);
}

function detenerActualizacionAutomaticaDeMarca() {
  clearInterval(temporizadorActualizacionMarca);
  temporizadorActualizacionMarca = null;
}

async function intentarEntrar() {
  const nombre = el("inputNombreAcademia").value.trim();
  const clave = el("inputClaveAcademia").value.trim();
  if (!nombre || !clave) return;
  el("mensajeErrorLogin").textContent = "";
  el("btnEntrarAcademia").disabled = true;
  el("btnEntrarAcademia").textContent = "Entrando...";

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "academiaLogin", nombre, clave }),
    });
    const r = await resp.json();
    if (!r.success) {
      el("mensajeErrorLogin").textContent = r.error || "No se pudo entrar.";
      return;
    }
    guardarSesion({
      academiaId: r.academiaId,
      clave,
      nombre: r.nombre,
      colorMarca: r.colorMarca || null,
      logoKey: r.logoKey || null,
    });
    mostrarTeclado();
  } catch (e) {
    el("mensajeErrorLogin").textContent = "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";
  } finally {
    el("btnEntrarAcademia").disabled = false;
    el("btnEntrarAcademia").textContent = "Entrar →";
  }
}

el("btnEntrarAcademia").addEventListener("click", intentarEntrar);
el("inputClaveAcademia").addEventListener("keydown", (e) => { if (e.key === "Enter") intentarEntrar(); });

el("btnSalirKiosko").addEventListener("click", () => {
  if (!window.confirm("¿Salir de esta pantalla? Vas a tener que volver a escribir el nombre y la contraseña de la academia para volver a dejarla lista.")) return;
  sesion = null;
  localStorage.removeItem("biometrico_sesion_kiosko");
  el("pantallaTeclado").hidden = true;
  el("pantallaLogin").hidden = false;
  aplicarMarca(null);
  aplicarLogoKiosko(null);
  el("inputNombreAcademia").value = "";
  el("inputClaveAcademia").value = "";
});

// ---------------------------------------------------------------
// TECLADO NUMÉRICO
// ---------------------------------------------------------------
const LARGO_MAXIMO_CODIGO = 6;

function reiniciarCodigo() {
  codigoActual = "";
  el("mensajeErrorKiosko").textContent = "";
  pintarVisor();
}

function pintarVisor() {
  const visor = el("visorCodigo");
  if (!codigoActual) {
    visor.textContent = "Escribe tu número";
    visor.classList.add("vacio");
  } else {
    visor.textContent = codigoActual;
    visor.classList.remove("vacio");
  }
}

function agregarDigito(d) {
  if (codigoActual.length >= LARGO_MAXIMO_CODIGO) return;
  codigoActual += d;
  el("mensajeErrorKiosko").textContent = "";
  pintarVisor();
}

function borrarDigito() {
  codigoActual = codigoActual.slice(0, -1);
  pintarVisor();
}

document.querySelectorAll(".tecla-numpad[data-tecla]").forEach((btn) => {
  btn.addEventListener("click", () => agregarDigito(btn.dataset.tecla));
});
el("btnBorrarDigito").addEventListener("click", borrarDigito);
el("btnConfirmarCodigo").addEventListener("click", buscarAlumnaParaConfirmar);
el("btnSiSoyYo").addEventListener("click", confirmarEntradaFinal);
el("btnNoSoyYo").addEventListener("click", cancelarConfirmacion);

// También acepta un teclado físico, por si la tablet tiene uno conectado.
document.addEventListener("keydown", (e) => {
  if (!el("pantallaTeclado").hidden) {
    if (e.key >= "0" && e.key <= "9") agregarDigito(e.key);
    else if (e.key === "Backspace") borrarDigito();
    else if (e.key === "Enter") buscarAlumnaParaConfirmar();
  } else if (!el("pantallaConfirmacion").hidden) {
    if (e.key === "Enter") confirmarEntradaFinal();
    else if (e.key === "Escape") cancelarConfirmacion();
  }
});

// ---------------------------------------------------------------
// MARCAR ASISTENCIA (primero se busca y se confirma, luego se marca)
// ---------------------------------------------------------------
// El flujo tiene dos pasos a propósito: 1) se busca el código y se
// muestra la foto y el nombre del alumno para que confirme que sí
// es ella, y 2) solo al darle "Sí, entrar" se marca la asistencia de
// verdad. Así, si alguien teclea mal el código y por casualidad cae
// en el código de otro alumno, no se marca su entrada por error — se
// ve el nombre equivocado y se puede corregir antes de confirmar.
let codigoPendienteConfirmacion = null;
let timeoutConfirmacion = null;

// En esta pantalla (la tablet, a la vista de los alumnos y sus papás)
// no se debe mostrar el motivo real de un bloqueo por falta de pago —
// eso es un asunto entre la academia y el administrador del sistema,
// no algo que deba verse públicamente en la entrada. Por eso, cuando
// el bloqueo es por mensualidad (r.bloqueadaPorPago), se reemplaza por
// un mensaje genérico; cualquier otro error se sigue mostrando tal cual.
function mensajeErrorParaKiosko(r, textoPorDefecto) {
  if (r && r.bloqueadaPorPago) {
    return "Esta cuenta está desactivada. Favor contactar a soporte.";
  }
  return (r && r.error) || textoPorDefecto;
}

async function buscarAlumnaParaConfirmar() {
  if (!codigoActual) return;
  const codigo = Number(codigoActual);
  el("btnConfirmarCodigo").disabled = true;

  try {
    const r = await llamar("academiaBuscarAlumnaPorCodigo", { codigo });
    if (!r.success) {
      el("mensajeErrorKiosko").textContent = mensajeErrorParaKiosko(r, "No se pudo buscar ese código.");
      codigoActual = "";
      pintarVisor();
      return;
    }
    codigoPendienteConfirmacion = codigo;
    mostrarConfirmacion(r.alumna);
  } catch (e) {
    el("mensajeErrorKiosko").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnConfirmarCodigo").disabled = false;
  }
}

function mostrarConfirmacion(alumna) {
  el("pantallaTeclado").hidden = true;
  el("pantallaConfirmacion").hidden = false;

  const foto = alumna.fotoKey
    ? `<img class="foto-bienvenida" src="${urlFoto(alumna.fotoKey)}" alt="" />`
    : `<div class="foto-bienvenida vacia">💃</div>`;

  el("contenidoConfirmacion").innerHTML = `
    <div class="kiosko-bienvenida">
      ${foto}
      <div class="mensaje-bienvenida">¿Eres tú, ${escaparHtml(alumna.nombre)}?</div>
      <div class="detalle-bienvenida">Confirma para marcar tu entrada.</div>
    </div>
  `;

  // Si nadie confirma ni cancela (por ejemplo, se aleja de la tablet),
  // regresa sola al teclado después de un rato para no quedarse
  // trabada esperando.
  clearTimeout(timeoutConfirmacion);
  timeoutConfirmacion = setTimeout(cancelarConfirmacion, 10000);
}

async function confirmarEntradaFinal() {
  if (!codigoPendienteConfirmacion) return;
  clearTimeout(timeoutConfirmacion);
  el("btnSiSoyYo").disabled = true;
  el("btnNoSoyYo").disabled = true;

  try {
    const r = await llamar("academiaMarcarAsistencia", { codigo: codigoPendienteConfirmacion, metodo: "Codigo" });
    el("pantallaConfirmacion").hidden = true;
    if (!r.success) {
      el("pantallaTeclado").hidden = false;
      el("mensajeErrorKiosko").textContent = mensajeErrorParaKiosko(r, "No se pudo marcar la asistencia.");
      reiniciarCodigo();
      return;
    }
    mostrarBienvenida(r);
  } catch (e) {
    el("pantallaConfirmacion").hidden = true;
    el("pantallaTeclado").hidden = false;
    el("mensajeErrorKiosko").textContent = "No se pudo conectar. Inténtalo de nuevo.";
    reiniciarCodigo();
  } finally {
    codigoPendienteConfirmacion = null;
    el("btnSiSoyYo").disabled = false;
    el("btnNoSoyYo").disabled = false;
  }
}

function cancelarConfirmacion() {
  clearTimeout(timeoutConfirmacion);
  codigoPendienteConfirmacion = null;
  el("pantallaConfirmacion").hidden = true;
  el("pantallaTeclado").hidden = false;
  reiniciarCodigo();
}

function mostrarBienvenida(r) {
  el("pantallaTeclado").hidden = true;
  el("pantallaResultado").hidden = false;

  const foto = r.alumna.fotoKey
    ? `<img class="foto-bienvenida" src="${urlFoto(r.alumna.fotoKey)}" alt="" />`
    : `<div class="foto-bienvenida vacia">💃</div>`;

  el("contenidoResultado").innerHTML = `
    <div class="kiosko-bienvenida">
      ${foto}
      <div class="mensaje-bienvenida">¡Bienvenido, ${escaparHtml(r.alumna.nombre)}!</div>
      <div class="detalle-bienvenida">Asistencia marcada — ${r.clasesEsteMes} / ${r.clasesPorMes} clases este mes.</div>
    </div>
  `;

  clearTimeout(timeoutResultado);
  timeoutResultado = setTimeout(() => {
    el("pantallaResultado").hidden = true;
    el("pantallaTeclado").hidden = false;
    reiniciarCodigo();
  }, 4000);
}

// ---------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------
const sesionGuardada = cargarSesionGuardada();
if (sesionGuardada) {
  sesion = sesionGuardada;
  mostrarTeclado();
}
