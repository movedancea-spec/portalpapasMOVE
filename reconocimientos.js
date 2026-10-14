// ==========================================
// MOVE — RECONOCIMIENTOS DE MAESTRA A ALUMNA
// MOVE Dance Academy
// ==========================================
// La maestra elige una de sus clases, luego una alumna de esa clase,
// y escribe una notita corta (máximo 200 caracteres) que la alumna va
// a ver en su Portal. Reusa la sesión compartida (sesionmaestra.js),
// igual que aviso.js y mis-evaluaciones.js — si ya entró en cualquier
// otra pantalla de maestras, aquí no le vuelve a pedir la clave.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const LIMITE_MENSAJE_RECONOCIMIENTO = 200;

let gruposMaestra = [];
let grupoActual = null; // { id, nombre, estilo, totalAlumnas }
let alumnasDelGrupo = [];
let alumnaActual = null; // { id, nombre }

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaGrupos", "pantallaAlumnas", "pantallaMensaje", "pantallaHistorial"].forEach((p) => {
    el(p).hidden = p !== id;
  });
}

async function llamarWorker(payload) {
  const resp = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || !datos.success) {
    throw new Error(datos.error || "Ocurrió un error. Intenta de nuevo.");
  }
  return datos;
}

// ---------- login ----------

el("btnEntrarMaestra").addEventListener("click", () => entrarMaestra());
el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarMaestra();
});

async function entrarMaestra(claveAuto) {
  const esAuto = typeof claveAuto === "string";
  const clave = esAuto ? claveAuto : el("inputClaveMaestra").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  if (!esAuto) mensajeError.textContent = "";

  if (!clave) {
    if (!esAuto) mensajeError.textContent = "Escribe tu clave.";
    return;
  }

  const boton = el("btnEntrarMaestra");
  let textoOriginal = "";
  if (!esAuto) {
    boton.disabled = true;
    textoOriginal = boton.textContent;
    boton.textContent = "Entrando...";
  }

  try {
    const datos = await llamarWorker({ accion: "maestraEntrar", clave });
    guardarSesionMaestraCompartida(clave, datos.nombre || "Maestra", datos.token);
    await cargarGrupos();
    // La push de una reacción abre reconocimientos.html#historial.
    if (location.hash === "#historial") cargarHistorial();
    else actualizarIndicadorReacciones();
  } catch (e) {
    if (esAuto) {
      borrarSesionMaestraCompartida();
    } else {
      mensajeError.textContent = e.message;
    }
  } finally {
    if (!esAuto) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

// ---------- pantalla 1: elegir clase ----------

async function cargarGrupos() {
  const mensajeError = el("mensajeErrorGrupos");
  mensajeError.textContent = "";
  mostrarPantalla("pantallaGrupos");
  el("listaGrupos").innerHTML = '<p class="lista-alumnas-aviso">Cargando tus clases...</p>';

  try {
    const datos = await llamarWorkerComoMaestra({ accion: "gruposDeMaestra" });
    gruposMaestra = datos.grupos || [];
    renderGrupos();
  } catch (e) {
    mensajeError.textContent = e.message;
    el("listaGrupos").innerHTML = "";
  }
}

function renderGrupos() {
  const cont = el("listaGrupos");
  cont.innerHTML = "";

  if (!gruposMaestra.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Todavía no tienes clases asignadas como maestra principal.</p>';
    return;
  }

  gruposMaestra.forEach((g) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-grupo";
    btn.innerHTML =
      `<span class="btn-grupo-nombre">${g.nombre}</span>` +
      `<span class="btn-grupo-detalle">${g.estilo || ""}${g.estilo ? " · " : ""}${g.totalAlumnas} alumna(s)</span>`;
    btn.addEventListener("click", () => abrirAlumnas(g));
    cont.appendChild(btn);
  });
}

el("btnVerHistorial").addEventListener("click", cargarHistorial);

// ---------- pantalla 2: elegir alumna ----------

async function abrirAlumnas(grupo) {
  grupoActual = grupo;
  el("nombreGrupoAlumnas").textContent = grupo.nombre;
  el("mensajeErrorAlumnas").textContent = "";
  mostrarPantalla("pantallaAlumnas");
  el("listaAlumnasReconocimiento").innerHTML = '<p class="lista-alumnas-aviso">Cargando alumnas...</p>';

  try {
    const datos = await llamarWorkerComoMaestra({ accion: "maestraAlumnasDeGrupo", grupoId: grupo.id });
    alumnasDelGrupo = datos.alumnas || [];
    renderAlumnas();
  } catch (e) {
    el("mensajeErrorAlumnas").textContent = e.message;
    el("listaAlumnasReconocimiento").innerHTML = "";
  }
}

function renderAlumnas() {
  const cont = el("listaAlumnasReconocimiento");
  cont.innerHTML = "";

  if (!alumnasDelGrupo.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Esta clase todavía no tiene alumnas activas.</p>';
    return;
  }

  alumnasDelGrupo.forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-grupo";
    btn.innerHTML = `<span class="btn-grupo-nombre">${a.nombre}</span>`;
    btn.addEventListener("click", () => abrirMensaje(a));
    cont.appendChild(btn);
  });
}

el("btnVolverGruposDesdeAlumnas").addEventListener("click", () => mostrarPantalla("pantallaGrupos"));

// ---------- pantalla 3: escribir el reconocimiento ----------

function abrirMensaje(alumna) {
  alumnaActual = alumna;
  el("nombreAlumnaMensaje").textContent = alumna.nombre;
  el("inputMensajeReconocimiento").value = "";
  actualizarContadorMensaje();
  const mensajeEl = el("mensajeReconocimiento");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  mostrarPantalla("pantallaMensaje");
}

el("btnVolverAlumnas").addEventListener("click", () => mostrarPantalla("pantallaAlumnas"));

function actualizarContadorMensaje() {
  const restantes = LIMITE_MENSAJE_RECONOCIMIENTO - el("inputMensajeReconocimiento").value.length;
  const contador = el("contadorMensajeReconocimiento");
  contador.textContent = restantes + " caracteres disponibles";
  contador.classList.toggle("contador-limite", restantes <= 20);
}
el("inputMensajeReconocimiento").addEventListener("input", actualizarContadorMensaje);

el("btnMandarReconocimiento").addEventListener("click", async () => {
  if (!grupoActual || !alumnaActual) return;
  const mensaje = el("inputMensajeReconocimiento").value.trim();
  const mensajeEl = el("mensajeReconocimiento");

  if (!mensaje) {
    mensajeEl.textContent = "Escribe el mensaje del reconocimiento.";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }

  const btn = el("btnMandarReconocimiento");
  btn.disabled = true;
  btn.textContent = "Mandando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    await llamarWorkerComoMaestra({
      accion: "maestraEnviarReconocimiento",
      grupoId: grupoActual.id,
      alumnaId: alumnaActual.id,
      mensaje,
    });
    mensajeEl.textContent = "✅ ¡Reconocimiento mandado! Ya se ve en el Portal de " + alumnaActual.nombre + ".";
    mensajeEl.classList.add("mensaje-form-ok");
    el("inputMensajeReconocimiento").value = "";
    actualizarContadorMensaje();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💌 Mandar reconocimiento";
  }
});

// ---------- pantalla 4: historial de lo ya enviado ----------

function formatearFechaHistorial(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch (e) {
    return "";
  }
}

async function cargarHistorial() {
  mostrarPantalla("pantallaHistorial");
  const mensajeError = el("mensajeErrorHistorial");
  mensajeError.textContent = "";
  const cont = el("listaHistorialReconocimientos");
  cont.innerHTML = '<p class="lista-alumnas-aviso">Cargando...</p>';

  try {
    const datos = await llamarWorkerComoMaestra({ accion: "maestraListaReconocimientosEnviados" });
    const reconocimientos = datos.reconocimientos || [];
    cont.innerHTML = "";

    if (!reconocimientos.length) {
      cont.innerHTML = '<p class="lista-alumnas-aviso">Todavía no has mandado ningún reconocimiento.</p>';
      return;
    }

    reconocimientos.forEach((r) => {
      const caja = document.createElement("div");
      caja.className = "tarjeta-reconocimiento-historial";

      const cabecera = document.createElement("div");
      cabecera.className = "tarjeta-reconocimiento-historial-cabecera";

      const alumna = document.createElement("span");
      alumna.className = "tarjeta-reconocimiento-historial-alumna";
      alumna.textContent = r.alumna;
      cabecera.appendChild(alumna);

      const fecha = document.createElement("span");
      fecha.className = "tarjeta-reconocimiento-historial-fecha";
      fecha.textContent = formatearFechaHistorial(r.fecha);
      cabecera.appendChild(fecha);

      caja.appendChild(cabecera);

      const mensaje = document.createElement("p");
      mensaje.className = "tarjeta-reconocimiento-historial-mensaje";
      mensaje.textContent = r.mensaje;
      caja.appendChild(mensaje);

      if (r.grupo) {
        const grupo = document.createElement("p");
        grupo.className = "tarjeta-reconocimiento-historial-grupo";
        grupo.textContent = r.grupo;
        caja.appendChild(grupo);
      }

      // Solo si la alumna o su familia reaccionaron; si no, nada.
      if (r.reaccion) {
        const reaccion = document.createElement("p");
        reaccion.className = "tarjeta-reconocimiento-historial-reaccion" + (r.reaccionNueva ? " nueva" : "");
        reaccion.textContent = `${r.reaccion} Reaccionó · ${formatearFechaHistorial(r.reaccionFecha)}${r.reaccionNueva ? " · ¡nueva!" : ""}`;
        caja.appendChild(reaccion);
      }

      cont.appendChild(caja);
    });

    // Ya las vio: dejan de contar como nuevas (el resaltado se queda
    // mientras esté en esta pantalla).
    if (reconocimientos.some((r) => r.reaccionNueva)) {
      llamarWorkerComoMaestra({ accion: "maestraMarcarReaccionesVistas" }).catch(() => {});
    }
    el("indicadorReacciones").hidden = true;
  } catch (e) {
    mensajeError.textContent = e.message;
    cont.innerHTML = "";
  }
}

el("btnVolverGruposDesdeHistorial").addEventListener("click", () => {
  if (location.hash === "#historial") history.replaceState(null, "", location.pathname);
  mostrarPantalla("pantallaGrupos");
});

// Si la página ya estaba abierta, la push de una reacción solo cambia el
// #historial de la dirección (sin recargar): se abre el historial igual.
window.addEventListener("hashchange", () => {
  if (location.hash === "#historial" && leerSesionMaestraCompartida()) cargarHistorial();
});

// Indicador de reacciones nuevas en "📜 Ver lo que ya he mandado".
async function actualizarIndicadorReacciones() {
  const ind = el("indicadorReacciones");
  try {
    const datos = await llamarWorkerComoMaestra({ accion: "maestraReaccionesNuevas" });
    ind.textContent = `💗 ${datos.nuevas} nueva${datos.nuevas === 1 ? "" : "s"}`;
    ind.hidden = !datos.nuevas;
  } catch (e) {
    ind.hidden = true;
  }
}

// ---------- sesión compartida (Portal de Maestras) ----------
const sesionCompartidaReconocimientos = leerSesionMaestraCompartida();
if (sesionCompartidaReconocimientos && sesionCompartidaReconocimientos.clave) {
  entrarMaestra(sesionCompartidaReconocimientos.clave);
}
