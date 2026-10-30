// ==========================================
// MOVE — AMONESTACIONES (Portal de Maestras)
// MOVE Dance Academy
// ==========================================
// La maestra ve SOLO sus llamadas de atención / amonestaciones del año
// en curso (lo decide el Worker con su token, nunca un ID que mande la
// página). La lista no trae la descripción: llega al tocar una, con
// maestraAbrirAmonestacion, que es la que la marca como leída con fecha
// y hora. Aquí llega la push de una amonestación nueva. Reusa la sesión
// compartida (sesionmaestra.js). Todo el texto va con textContent.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let amonestaciones = [];
const detalles = new Map(); // id → amonestación completa ya abierta

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaLista"].forEach((p) => {
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

function fechaHora(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-GT", {
    timeZone: "America/Guatemala", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function nodo(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined) n.textContent = texto;
  return n;
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
  boton.disabled = true;
  try {
    const datos = await llamarWorker({ accion: "maestraEntrar", clave });
    guardarSesionMaestraCompartida(clave, datos.nombre || "Maestra", datos.token);
    await cargarLista();
  } catch (e) {
    if (esAuto) borrarSesionMaestraCompartida();
    else mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
  }
}

// ---------- lista ----------

async function cargarLista() {
  mostrarPantalla("pantallaLista");
  el("mensajeErrorLista").textContent = "";
  const cont = el("listaAmonestaciones");
  cont.replaceChildren(nodo("p", "lista-alumnas-aviso", "Cargando..."));
  try {
    const datos = await llamarWorkerComoMaestra({ accion: "maestraAmonestaciones" });
    amonestaciones = datos.amonestaciones || [];
    renderLista();
  } catch (e) {
    cont.replaceChildren();
    el("mensajeErrorLista").textContent = e.message;
  }
}

function renderLista() {
  const cont = el("listaAmonestaciones");
  cont.replaceChildren();
  if (!amonestaciones.length) {
    cont.appendChild(nodo("p", "amon-vacio", "No tienes amonestaciones este año. 💗"));
    return;
  }
  amonestaciones.forEach((a) => {
    const item = nodo("button", "amon-item" + (a.tipo === "Amonestación escrita" ? " amon-escrita" : "") + (a.leida ? "" : " amon-nueva"));
    item.type = "button";
    const cab = nodo("div", "amon-item-cabecera");
    cab.appendChild(nodo("span", "amon-item-tipo", a.tipo));
    if (!a.leida) cab.appendChild(nodo("span", "amon-item-nueva", "Sin leer"));
    item.appendChild(cab);
    item.appendChild(nodo("div", "amon-item-motivo", a.motivo));
    item.appendChild(nodo("div", "amon-item-fecha", fechaHora(a.fecha)));
    const detalle = nodo("div", "amon-item-detalle");
    detalle.hidden = true;
    item.appendChild(detalle);
    item.addEventListener("click", () => abrir(a, item, detalle));
    cont.appendChild(item);
  });
}

async function abrir(a, item, detalle) {
  if (!detalle.hidden) {
    detalle.hidden = true;
    return;
  }
  detalle.hidden = false;
  if (detalles.has(a.id)) return;
  detalle.replaceChildren(nodo("div", "amon-item-fecha", "Abriendo..."));
  try {
    const datos = await llamarWorkerComoMaestra({ accion: "maestraAbrirAmonestacion", id: a.id });
    const completa = datos.amonestacion;
    detalles.set(a.id, completa);
    detalle.replaceChildren(
      nodo("div", "amon-item-descripcion", completa.descripcion),
      nodo("div", "amon-item-lectura", `✓ Leída el ${fechaHora(completa.fechaLectura)}`)
    );
    if (!a.leida) {
      a.leida = true;
      item.classList.remove("amon-nueva");
      const marca = item.querySelector(".amon-item-nueva");
      if (marca) marca.remove();
    }
  } catch (e) {
    detalle.replaceChildren(nodo("div", "mensaje-error", e.message));
  }
}

// ---------- sesión compartida (Portal de Maestras) ----------
const sesionCompartidaAmonestaciones = leerSesionMaestraCompartida();
if (sesionCompartidaAmonestaciones && sesionCompartidaAmonestaciones.clave) {
  entrarMaestra(sesionCompartidaAmonestaciones.clave);
}
