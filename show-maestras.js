// ==========================================
// MOVE — ALUMNAS SHOW (Portal de Maestras)
// MOVE Dance Academy
// ==========================================
// Solo lectura: por cada grupo donde la maestra es MAESTRA PRINCIPAL,
// sus bailes del show y qué alumnas salen en cada uno. El Worker
// (maestraShowAlumnas) es quien filtra los grupos con la CLAVE de la
// maestra — esta página no recibe grupos ajenos ni precios, así que no
// hay nada que "ocultar" aquí.
//
// Usa la misma sesión compartida (sesionmaestra.js) que el Portal, el
// Chat, el Panel de Clase y los Avisos: si ya entró en alguna de esas
// pantallas, aquí no le vuelve a pedir la clave.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

function el(id) {
  return document.getElementById(id);
}

function crearEl(tag, clase, texto) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaShow"].forEach((p) => {
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
    const error = new Error(datos.error || "Ocurrió un error. Intenta de nuevo.");
    error.status = resp.status;
    throw error;
  }
  return datos;
}

// ---------- login ----------

el("btnEntrarMaestra").addEventListener("click", entrarMaestra);
el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarMaestra();
});

async function entrarMaestra() {
  const clave = el("inputClaveMaestra").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  mensajeError.textContent = "";
  if (!clave) {
    mensajeError.textContent = "Escribe tu clave.";
    return;
  }
  const boton = el("btnEntrarMaestra");
  boton.disabled = true;
  boton.textContent = "Entrando...";
  try {
    const datos = await llamarWorker({ accion: "maestraEntrar", clave });
    guardarSesionMaestraCompartida(clave, datos.maestraId, datos.nombre || "Maestra");
    await cargarShow(clave);
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar →";
  }
}

// ---------- vista ----------

async function cargarShow(clave) {
  mostrarPantalla("pantallaShow");
  el("mensajeErrorShow").textContent = "";
  try {
    const datos = await llamarWorker({ accion: "maestraShowAlumnas", clave });
    renderShow(datos.grupos || []);
  } catch (e) {
    // Clave cambiada desde otra pantalla: se borra la sesión y se pide otra vez.
    if (e.status === 401) {
      borrarSesionMaestraCompartida();
      mostrarPantalla("pantallaLogin");
      el("mensajeErrorLogin").textContent = "Tu clave cambió. Escríbela de nuevo.";
      return;
    }
    el("listaShow").innerHTML = "";
    el("mensajeErrorShow").textContent = e.message;
  }
}

function renderShow(grupos) {
  const cont = el("listaShow");
  cont.innerHTML = "";
  if (!grupos.length) {
    cont.appendChild(crearEl("p", "subtitulo", "No tienes grupos asignados como maestra principal."));
    return;
  }
  grupos.forEach((g) => {
    const seccion = crearEl("section", "show-grupo");
    const encabezado = crearEl("div", "show-grupo-encabezado");
    encabezado.appendChild(crearEl("h2", "show-grupo-nombre", g.nombre));
    encabezado.appendChild(
      crearEl("span", "show-grupo-total", `${g.totalAlumnas} alumna${g.totalAlumnas === 1 ? "" : "s"} en el show`)
    );
    seccion.appendChild(encabezado);

    if (!g.bailes.length) {
      seccion.appendChild(crearEl("p", "show-vacio", "Todavía no hay bailes para este grupo."));
    }
    g.bailes.forEach((b) => seccion.appendChild(tarjetaBaile(b)));
    cont.appendChild(seccion);
  });
}

function tarjetaBaile(baile) {
  const tarjeta = crearEl("article", "show-baile");
  const encabezado = crearEl("div", "show-baile-encabezado");
  encabezado.appendChild(crearEl("h3", "show-baile-nombre", baile.nombre));
  const total = crearEl("div", "show-baile-total");
  total.append(crearEl("strong", "", String(baile.total)), crearEl("span", "", baile.total === 1 ? "alumna" : "alumnas"));
  encabezado.appendChild(total);
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

// ---------- arranque ----------

const sesionCompartidaShow = leerSesionMaestraCompartida();
if (sesionCompartidaShow && sesionCompartidaShow.clave) {
  cargarShow(sesionCompartidaShow.clave);
}
