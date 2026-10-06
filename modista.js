// ==========================================
// MOVE — LINK DE LA MODISTA
// MOVE Dance Academy
// ==========================================
// Página pública de solo lectura: cuántos trajes hay que hacer por baile
// y para quién (solo nombres). No tiene login: entra con el token que
// viene en el link (modista.html#t=TOKEN), que Recepción genera y puede
// regenerar desde "Alumnas Show" para invalidar el anterior.
//
// El token va después del # para que nunca viaje al servidor de esta
// página (no queda en logs ni en el "referer"); aquí se lee y se le
// manda al Worker (modistaShow), que es quien decide si es válido. El
// Worker ya responde solo nombres y totales — sin precios, tallas ni
// datos de contacto —, así que esta página no tiene nada que ocultar.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let gruposModista = [];

function el(id) {
  return document.getElementById(id);
}

function crearEl(tag, clase, texto) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function tokenDelLink() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  return (params.get("t") || "").trim();
}

function mostrarError(texto) {
  el("textoCargando").hidden = true;
  el("contenido").hidden = true;
  el("cajaError").hidden = false;
  el("cajaError").textContent = texto;
}

async function cargar() {
  const token = tokenDelLink();
  if (!token) {
    mostrarError("Este link está incompleto. Pide el link de nuevo a la academia.");
    return;
  }
  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "modistaShow", token }),
    });
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok || !datos.success) {
      mostrarError(datos.error || "No se pudo cargar la lista. Intenta de nuevo en un momento.");
      return;
    }
    gruposModista = datos.grupos || [];
    el("textoActualizado").textContent = datos.actualizado ? `Actualizado: ${formatoFecha(datos.actualizado)}` : "";
    render();
  } catch (e) {
    mostrarError("No hay conexión. Revisa tu internet e intenta de nuevo.");
  }
}

// "2026-10-06 14:05" (hora de Guatemala, ya calculada en el Worker) → "6/10/2026, 14:05"
function formatoFecha(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(texto);
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}, ${m[4]}` : texto;
}

function render() {
  el("textoCargando").hidden = true;
  el("contenido").hidden = false;

  const bailes = gruposModista.flatMap((g) => g.bailes.map((b) => ({ ...b, grupo: g.nombre })));
  el("totalTrajes").textContent = bailes.reduce((suma, b) => suma + b.total, 0);
  el("totalBailes").textContent = bailes.length;

  // 1) Por Grupo MOVE: grupo → bailes → alumnas
  const vistaGrupo = el("vistaGrupo");
  vistaGrupo.innerHTML = "";
  if (!gruposModista.length) {
    vistaGrupo.appendChild(crearEl("p", "show-vacio", "Todavía no hay bailes cargados."));
  }
  gruposModista.forEach((g) => {
    const seccion = crearEl("section", "show-grupo");
    const encabezado = crearEl("div", "show-grupo-encabezado");
    const trajes = g.bailes.reduce((suma, b) => suma + b.total, 0);
    encabezado.appendChild(crearEl("h2", "show-grupo-nombre", g.nombre));
    encabezado.appendChild(crearEl("span", "show-grupo-total", `${trajes} traje${trajes === 1 ? "" : "s"}`));
    seccion.appendChild(encabezado);
    g.bailes.forEach((b) => seccion.appendChild(tarjetaBaile(b, "")));
    vistaGrupo.appendChild(seccion);
  });

  // 2) Por baile: todos los bailes en orden alfabético, indicando su grupo
  const vistaBaile = el("vistaBaile");
  vistaBaile.innerHTML = "";
  const seccion = crearEl("section", "show-grupo");
  bailes
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base", numeric: true }) || a.grupo.localeCompare(b.grupo, "es"))
    .forEach((b) => seccion.appendChild(tarjetaBaile(b, b.grupo)));
  if (!bailes.length) seccion.appendChild(crearEl("p", "show-vacio", "Todavía no hay bailes cargados."));
  vistaBaile.appendChild(seccion);
}

function tarjetaBaile(baile, grupo) {
  const tarjeta = crearEl("article", "show-baile");
  const encabezado = crearEl("div", "show-baile-encabezado");
  const titulos = crearEl("div", "show-baile-titulos");
  titulos.appendChild(crearEl("h3", "show-baile-nombre", baile.nombre));
  if (grupo) titulos.appendChild(crearEl("p", "show-baile-grupo", grupo));
  const total = crearEl("div", "show-baile-total");
  total.append(crearEl("strong", "", String(baile.total)), crearEl("span", "", baile.total === 1 ? "traje" : "trajes"));
  encabezado.append(titulos, total);
  tarjeta.appendChild(encabezado);

  if (!baile.alumnas.length) {
    tarjeta.appendChild(crearEl("p", "show-vacio", "Sin alumnas asignadas todavía."));
  } else {
    const lista = crearEl("ol", "show-alumnas");
    baile.alumnas.forEach((nombre) => lista.appendChild(crearEl("li", "", nombre)));
    tarjeta.appendChild(lista);
  }
  return tarjeta;
}

document.querySelectorAll(".pestana").forEach((boton) => {
  boton.addEventListener("click", () => {
    document.querySelectorAll(".pestana").forEach((b) => {
      const activa = b === boton;
      b.classList.toggle("activa", activa);
      b.setAttribute("aria-selected", String(activa));
    });
    el("vistaGrupo").hidden = boton.dataset.vista !== "Grupo";
    el("vistaBaile").hidden = boton.dataset.vista !== "Baile";
  });
});

el("btnImprimir").addEventListener("click", () => window.print());

cargar();
