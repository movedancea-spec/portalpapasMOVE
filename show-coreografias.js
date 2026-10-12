// ==========================================
// MOVE — SHOW: COREOGRAFÍAS Y POSICIONES (Portal de Maestras)
// MOVE Dance Academy
// ==========================================
// Por cada baile de sus grupos (y el Opening y Closing, que son de
// todas): canción, alumnas que salen, formaciones en el escenario y
// correcciones. Reemplaza a show-maestras.html (que era solo lectura).
//
// El Worker (acciones maestraCoreografias, maestraCoreografiaDetalle,
// maestraGuardar...) revisa con la CLAVE de la maestra qué puede ver y
// editar; esta página no decide permisos. A la página tampoco le llegan
// IDs de alumnas: cada una viene con un código ("c") que solo sirve
// dentro de este módulo.
//
// Todo lo que escriben las maestras se pinta con textContent (nunca
// innerHTML) y en la imagen se dibuja con canvas, así que un nombre o
// una corrección con "<script>" se ve como texto y nunca se ejecuta.
//
// Si otra maestra guardó el mismo baile mientras esta lo tenía abierto,
// el Worker responde "conflicto": se avisa y se recargan los datos.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const MAX_FORMACIONES = 40;

let claveMaestra = "";
let datosLista = null;
let det = null; // respuesta de maestraCoreografiaDetalle
let alumnaPorCodigo = new Map();
let nombreCortoPorCodigo = new Map();
let pestanaActual = "datos";

// Copias de trabajo (lo que aún no se guarda).
let seleccion = new Set(); // códigos de alumnas marcadas
let formaciones = []; // [{ id, nombre, posiciones: [{c,x,y}] }]
let formacionActual = 0;
let sucioDatos = false;
let sucioFormaciones = false;
let elegidaDeBanca = ""; // tocar en la banca y luego en el escenario

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
  ["pantallaLogin", "pantallaLista", "pantallaBaile"].forEach((p) => {
    el(p).hidden = p !== id;
  });
  window.scrollTo(0, 0);
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
    error.datos = datos;
    throw error;
  }
  return datos;
}

function mensaje(id, texto, tipo) {
  const nodo = el(id);
  nodo.textContent = texto || "";
  nodo.className = "mensaje-form" + (tipo ? ` mensaje-form-${tipo}` : "");
}

// Clave cambiada desde otra pantalla: se borra la sesión y se pide otra vez.
function manejarClaveInvalida(e) {
  if (e.status !== 401) return false;
  borrarSesionMaestraCompartida();
  claveMaestra = "";
  mostrarPantalla("pantallaLogin");
  el("mensajeErrorLogin").textContent = "Tu clave cambió. Escríbela de nuevo.";
  return true;
}

function sinAcentos(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function hayCambiosSinGuardar() {
  return sucioDatos || sucioFormaciones;
}

window.addEventListener("beforeunload", (e) => {
  if (hayCambiosSinGuardar() && !el("pantallaBaile").hidden) {
    e.preventDefault();
    e.returnValue = "";
  }
});

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
    guardarSesionMaestraCompartida(clave, datos.nombre || "Maestra", datos.token);
    claveMaestra = clave;
    await cargarLista();
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar →";
  }
}

// ---------- lista de bailes ----------

async function cargarLista() {
  mostrarPantalla("pantallaLista");
  el("mensajeErrorLista").textContent = "";
  if (!datosLista) el("listaCoreo").replaceChildren(crearEl("p", "subtitulo", "Cargando..."));
  try {
    datosLista = await llamarWorker({ accion: "maestraCoreografias", clave: claveMaestra });
    renderLista();
  } catch (e) {
    if (manejarClaveInvalida(e)) return;
    el("listaCoreo").replaceChildren();
    el("mensajeErrorLista").textContent = e.message;
  }
}

function textoUltimaEdicion(u) {
  return u ? `Último cambio: ${u.por} · ${u.cuando}` : "";
}

function tarjetaBaile(b, { general = false } = {}) {
  const tarjeta = crearEl("button", "coreo-tarjeta" + (general ? " coreo-general" : ""));
  tarjeta.type = "button";
  const texto = crearEl("div", "coreo-tarjeta-texto");
  texto.appendChild(crearEl("div", "coreo-tarjeta-nombre", (general ? "✨ " : "") + b.nombre));
  const cancion = [b.cancion, b.artista].filter(Boolean).join(" — ");
  texto.appendChild(crearEl("div", "coreo-tarjeta-detalle", cancion ? `🎵 ${cancion}` : "🎵 Sin canción todavía"));
  if (b.ultimaEdicion) texto.appendChild(crearEl("div", "coreo-tarjeta-detalle", textoUltimaEdicion(b.ultimaEdicion)));
  tarjeta.appendChild(texto);
  const total = crearEl("div", "coreo-tarjeta-total");
  total.append(crearEl("strong", "", String(b.total)), crearEl("span", "", b.total === 1 ? "alumna" : "alumnas"));
  tarjeta.appendChild(total);
  tarjeta.addEventListener("click", () => abrirBaile(b.id));
  return tarjeta;
}

function renderLista() {
  const cont = el("listaCoreo");
  cont.replaceChildren();

  const generales = crearEl("section", "coreo-bloque");
  const encGen = crearEl("div", "coreo-bloque-encabezado");
  encGen.append(crearEl("h2", "coreo-bloque-nombre", "Opening y Closing"), crearEl("span", "coreo-bloque-nota", "De todas las maestras"));
  generales.appendChild(encGen);
  datosLista.generales.forEach((g) => generales.appendChild(tarjetaBaile(g, { general: true })));
  cont.appendChild(generales);

  if (!datosLista.grupos.length) {
    cont.appendChild(crearEl("p", "subtitulo", "No tienes grupos asignados como maestra principal."));
    return;
  }
  datosLista.grupos.forEach((g) => {
    const bloque = crearEl("section", "coreo-bloque");
    const enc = crearEl("div", "coreo-bloque-encabezado");
    enc.appendChild(crearEl("h2", "coreo-bloque-nombre", g.nombre));
    enc.appendChild(crearEl("span", "coreo-bloque-nota", `${g.bailes.length} baile${g.bailes.length === 1 ? "" : "s"}`));
    bloque.appendChild(enc);
    if (!g.bailes.length) bloque.appendChild(crearEl("p", "coreo-vacio", "Todavía no hay bailes para este grupo."));
    g.bailes.forEach((b) => bloque.appendChild(tarjetaBaile(b)));
    if (g.activo) {
      const nuevo = crearEl("button", "coreo-nuevo", "＋ Nuevo baile");
      nuevo.type = "button";
      nuevo.addEventListener("click", () => abrirNuevoBaile(g));
      bloque.appendChild(nuevo);
    }
    cont.appendChild(bloque);
  });
}

// ---------- abrir un baile ----------

el("btnVolverLista").addEventListener("click", () => {
  if (hayCambiosSinGuardar() && !confirm("Tienes cambios sin guardar. ¿Salir de todos modos?")) return;
  salirDePantallaCompleta();
  det = null;
  sucioDatos = false;
  sucioFormaciones = false;
  cargarLista();
});

let grupoNuevoBaile = null;

function abrirNuevoBaile(grupo) {
  det = null;
  grupoNuevoBaile = grupo;
  sucioDatos = false;
  sucioFormaciones = false;
  mostrarPantalla("pantallaBaile");
  el("tituloBaile").textContent = "Nuevo baile";
  el("subtituloBaile").textContent = grupo.nombre;
  el("ultimaEdicion").textContent = "";
  el("avisoBaile").hidden = true;
  el("campoNombreBaile").hidden = false;
  ["inputNombreBaile", "inputCancion", "inputArtista", "inputNotasMezcla"].forEach((id) => (el(id).value = ""));
  el("bloqueAlumnas").hidden = true;
  el("pistaNuevoBaile").hidden = false;
  el("contadorCorrecciones").textContent = "";
  mensaje("mensajeDatos", "");
  cambiarPestana("datos");
  el("inputNombreBaile").focus();
}

async function abrirBaile(baileId) {
  grupoNuevoBaile = null;
  formacionActual = 0;
  mostrarPantalla("pantallaBaile");
  el("avisoBaile").hidden = true;
  el("tituloBaile").textContent = "Cargando...";
  el("subtituloBaile").textContent = "";
  el("ultimaEdicion").textContent = "";
  ["mensajeDatos", "mensajeFormaciones", "mensajeCorrecciones"].forEach((id) => mensaje(id, ""));
  try {
    await cargarDetalle(baileId);
    cambiarPestana("datos");
  } catch (e) {
    if (manejarClaveInvalida(e)) return;
    el("tituloBaile").textContent = "";
    mostrarAviso(e.message);
  }
}

function mostrarAviso(texto) {
  el("avisoBaile").textContent = texto;
  el("avisoBaile").hidden = !texto;
}

// conservar: { datos, formaciones } = no pisar lo que la maestra está
// editando en esa parte (por ejemplo, al guardar una corrección).
async function cargarDetalle(baileId, conservar = {}) {
  det = await llamarWorker({ accion: "maestraCoreografiaDetalle", clave: claveMaestra, baileId });
  alumnaPorCodigo = new Map(det.alumnas.map((a) => [a.c, a]));
  calcularNombresCortos();

  const b = det.baile;
  const general = b.tipo !== "Grupo";
  el("tituloBaile").textContent = general ? `✨ ${b.nombre}` : b.nombre;
  el("subtituloBaile").textContent = general
    ? "General del show · lo pueden ver y editar todas las maestras"
    : b.grupoNombre;
  el("ultimaEdicion").textContent = textoUltimaEdicion(b.ultimaEdicion);
  el("campoNombreBaile").hidden = general;
  el("bloqueAlumnas").hidden = false;
  el("pistaNuevoBaile").hidden = true;
  el("pistaAlumnas").textContent = general
    ? "Puedes escoger a cualquier alumna activa de la academia."
    : "Solo alumnas activas de este grupo.";

  if (!conservar.datos) {
    el("inputNombreBaile").value = b.nombre;
    el("inputCancion").value = b.cancion;
    el("inputArtista").value = b.artista;
    el("inputNotasMezcla").value = b.notasMezcla;
    seleccion = new Set(det.alumnas.filter((a) => a.enBaile).map((a) => a.c));
    el("buscarAlumna").value = "";
    el("filtroSoloSeleccion").checked = false;
    prepararFiltroGrupos();
    sucioDatos = false;
  }
  if (!conservar.formaciones) {
    formaciones = det.formaciones.map((f) => ({ id: f.id, nombre: f.nombre, posiciones: f.posiciones.map((p) => ({ ...p })) }));
    // Un baile sin formaciones empieza con una vacía (se crea al guardar).
    if (!formaciones.length) formaciones.push({ id: "", nombre: "", posiciones: [] });
    formacionActual = Math.min(formacionActual, formaciones.length - 1);
    sucioFormaciones = false;
  }
  elegidaDeBanca = "";
  renderAlumnas();
  renderFormaciones();
  renderCorrecciones();
}

async function recargarPorConflicto(e) {
  mostrarAviso("⚠️ " + e.message);
  try {
    await cargarDetalle(det.baile.id);
  } catch (err) {
    if (!manejarClaveInvalida(err)) mostrarAviso(err.message);
  }
}

// ---------- pestañas ----------

document.querySelectorAll(".coreo-pestana").forEach((boton) => {
  boton.addEventListener("click", () => cambiarPestana(boton.dataset.pestana));
});

function cambiarPestana(nombre) {
  // Un baile nuevo primero se guarda: sin ID no hay posiciones ni correcciones.
  if (!det && nombre !== "datos") return;
  pestanaActual = nombre;
  document.querySelectorAll(".coreo-pestana").forEach((b) => {
    b.classList.toggle("activa", b.dataset.pestana === nombre);
    b.disabled = !det && b.dataset.pestana !== "datos";
  });
  el("seccionDatos").hidden = nombre !== "datos";
  el("seccionPosiciones").hidden = nombre !== "posiciones";
  el("seccionCorrecciones").hidden = nombre !== "correcciones";
  if (nombre === "posiciones") renderEscenario();
}

// ---------- baile y alumnas ----------

["inputNombreBaile", "inputCancion", "inputArtista", "inputNotasMezcla"].forEach((id) => {
  el(id).addEventListener("input", () => (sucioDatos = true));
});
el("buscarAlumna").addEventListener("input", renderAlumnas);
el("filtroGrupo").addEventListener("change", renderAlumnas);
el("filtroSoloSeleccion").addEventListener("change", renderAlumnas);

function prepararFiltroGrupos() {
  const select = el("filtroGrupo");
  const general = det && det.baile.tipo !== "Grupo";
  select.hidden = !general;
  select.replaceChildren();
  if (!general) return;
  const grupos = [...new Set(det.alumnas.flatMap((a) => a.grupos || []))].sort((a, b) => a.localeCompare(b, "es"));
  const todas = crearEl("option", "", "Todos los grupos");
  todas.value = "";
  select.appendChild(todas);
  grupos.forEach((g) => {
    const opcion = crearEl("option", "", g);
    opcion.value = g;
    select.appendChild(opcion);
  });
}

function renderAlumnas() {
  if (!det) return;
  const cont = el("listaSeleccionAlumnas");
  cont.replaceChildren();
  const busqueda = sinAcentos(el("buscarAlumna").value.trim());
  const grupo = el("filtroGrupo").hidden ? "" : el("filtroGrupo").value;
  const soloSeleccion = el("filtroSoloSeleccion").checked;

  const visibles = det.alumnas.filter(
    (a) =>
      (!busqueda || sinAcentos(a.nombre).includes(busqueda)) &&
      (!grupo || (a.grupos || []).includes(grupo)) &&
      (!soloSeleccion || seleccion.has(a.c))
  );
  if (!visibles.length) cont.appendChild(crearEl("p", "coreo-vacio", "Ninguna alumna con ese filtro."));
  visibles.forEach((a) => {
    const fila = crearEl("label", "coreo-alumna");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.checked = seleccion.has(a.c);
    casilla.addEventListener("change", () => {
      if (casilla.checked) seleccion.add(a.c);
      else seleccion.delete(a.c);
      sucioDatos = true;
      actualizarContadorSeleccion();
    });
    const texto = crearEl("span", "coreo-alumna-texto", a.nombre);
    if (a.estado) texto.appendChild(crearEl("span", "coreo-estado", a.estado));
    if (a.grupos && a.grupos.length) texto.appendChild(crearEl("span", "coreo-alumna-grupos", a.grupos.join(" · ")));
    fila.append(casilla, texto);
    cont.appendChild(fila);
  });
  actualizarContadorSeleccion();
}

function actualizarContadorSeleccion() {
  el("contadorSeleccion").textContent = String(seleccion.size);
}

el("btnGuardarDatos").addEventListener("click", () => guardarDatos(false));

async function guardarDatos(confirmarQuitar) {
  const boton = el("btnGuardarDatos");
  mensaje("mensajeDatos", "");
  const payload = {
    accion: "maestraGuardarCoreografia",
    clave: claveMaestra,
    nombre: el("inputNombreBaile").value,
    cancion: el("inputCancion").value,
    artista: el("inputArtista").value,
    notasMezcla: el("inputNotasMezcla").value,
  };
  if (det) {
    Object.assign(payload, { baileId: det.baile.id, version: det.baile.version, alumnas: [...seleccion], confirmarQuitar });
  } else {
    if (!el("inputNombreBaile").value.trim()) return mensaje("mensajeDatos", "Escribe el nombre del baile.", "error");
    Object.assign(payload, { grupoId: grupoNuevoBaile.id, alumnas: [] });
  }

  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    const resp = await llamarWorker(payload);
    sucioDatos = false;
    mostrarAviso("");
    // Las formaciones que se estén editando se respetan.
    await cargarDetalle(resp.baileId, { formaciones: sucioFormaciones });
    cambiarPestana("datos");
    mensaje("mensajeDatos", "✅ Guardado", "ok");
  } catch (e) {
    if (manejarClaveInvalida(e)) return;
    if (e.datos && e.datos.requiereConfirmacion) {
      if (confirm(e.message + "\n\n¿Guardar de todos modos?")) {
        boton.disabled = false;
        boton.textContent = "Guardar baile";
        return guardarDatos(true);
      }
      mensaje("mensajeDatos", "No se guardó.", "error");
    } else if (e.datos && e.datos.conflicto) {
      await recargarPorConflicto(e);
    } else {
      mensaje("mensajeDatos", e.message, "error");
    }
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar baile";
  }
}

// ---------- formaciones ----------

function alumnasEnBaile() {
  return det ? det.alumnas.filter((a) => a.enBaile) : [];
}

// Nombre corto para el escenario: el primer nombre, y si dos se llaman
// igual, con la inicial del segundo.
function calcularNombresCortos() {
  nombreCortoPorCodigo = new Map();
  const lista = det ? det.alumnas : [];
  const conteo = new Map();
  lista.forEach((a) => {
    const primero = a.nombre.split(" ")[0];
    conteo.set(primero, (conteo.get(primero) || 0) + 1);
  });
  lista.forEach((a) => {
    const partes = a.nombre.split(" ").filter(Boolean);
    const primero = partes[0] || a.nombre;
    nombreCortoPorCodigo.set(a.c, conteo.get(primero) > 1 && partes[1] ? `${primero} ${partes[1][0]}.` : primero);
  });
}

function iniciales(nombre) {
  const partes = String(nombre).split(" ").filter(Boolean);
  return ((partes[0] || "?")[0] + (partes[1] ? partes[1][0] : "")).toUpperCase();
}

function nombreFormacion(f, i) {
  return f.nombre ? `${i + 1}. ${f.nombre}` : `Formación ${i + 1}`;
}

function marcarFormacionesSucias() {
  sucioFormaciones = true;
  mensaje("mensajeFormaciones", "Cambios sin guardar", "error");
}

function renderFormaciones() {
  const cont = el("listaFormaciones");
  cont.replaceChildren();
  formaciones.forEach((f, i) => {
    const chip = crearEl("button", "coreo-chip-formacion" + (i === formacionActual ? " activa" : ""), nombreFormacion(f, i));
    chip.type = "button";
    chip.addEventListener("click", () => {
      formacionActual = i;
      elegidaDeBanca = "";
      renderFormaciones();
    });
    cont.appendChild(chip);
  });
  const f = formaciones[formacionActual];
  el("inputNombreFormacion").value = f ? f.nombre : "";
  el("btnFormacionIzq").disabled = formacionActual === 0;
  el("btnFormacionDer").disabled = formacionActual >= formaciones.length - 1;
  el("btnBorrarFormacion").disabled = formaciones.length <= 1;
  el("btnNuevaFormacion").disabled = formaciones.length >= MAX_FORMACIONES;
  el("btnDuplicarFormacion").disabled = formaciones.length >= MAX_FORMACIONES;
  renderEscenario();
}

el("inputNombreFormacion").addEventListener("input", () => {
  const f = formaciones[formacionActual];
  if (!f) return;
  f.nombre = el("inputNombreFormacion").value.slice(0, 40);
  marcarFormacionesSucias();
  // Solo se actualiza el texto del chip, para no perder el foco.
  const chip = el("listaFormaciones").children[formacionActual];
  if (chip) chip.textContent = nombreFormacion(f, formacionActual);
  el("tituloEscenario").textContent = tituloEscenario();
});

el("btnNuevaFormacion").addEventListener("click", () => {
  formaciones.splice(formacionActual + 1, 0, { id: "", nombre: "", posiciones: [] });
  formacionActual++;
  marcarFormacionesSucias();
  renderFormaciones();
});

el("btnDuplicarFormacion").addEventListener("click", () => {
  const f = formaciones[formacionActual];
  formaciones.splice(formacionActual + 1, 0, {
    id: "",
    nombre: f.nombre ? `${f.nombre} (copia)`.slice(0, 40) : "",
    posiciones: f.posiciones.map((p) => ({ ...p })),
  });
  formacionActual++;
  marcarFormacionesSucias();
  renderFormaciones();
});

el("btnBorrarFormacion").addEventListener("click", () => {
  if (formaciones.length <= 1) return;
  if (!confirm(`¿Borrar "${nombreFormacion(formaciones[formacionActual], formacionActual)}"? Se borra al guardar.`)) return;
  formaciones.splice(formacionActual, 1);
  formacionActual = Math.max(0, formacionActual - 1);
  marcarFormacionesSucias();
  renderFormaciones();
});

function moverFormacion(delta) {
  const destino = formacionActual + delta;
  if (destino < 0 || destino >= formaciones.length) return;
  const [f] = formaciones.splice(formacionActual, 1);
  formaciones.splice(destino, 0, f);
  formacionActual = destino;
  marcarFormacionesSucias();
  renderFormaciones();
}
el("btnFormacionIzq").addEventListener("click", () => moverFormacion(-1));
el("btnFormacionDer").addEventListener("click", () => moverFormacion(1));

function tituloEscenario() {
  if (!det) return "";
  const f = formaciones[formacionActual];
  return `${det.baile.nombre} · ${f ? nombreFormacion(f, formacionActual) : ""}`;
}

function renderEscenario() {
  if (!det) return;
  el("tituloEscenario").textContent = tituloEscenario();
  const capa = el("capaBailarinas");
  capa.replaceChildren();
  const f = formaciones[formacionActual];
  if (!f) return;
  const enBaile = new Set(alumnasEnBaile().map((a) => a.c));
  // Una alumna que se quitó del baile ya no sale en el escenario.
  f.posiciones = f.posiciones.filter((p) => enBaile.has(p.c));
  f.posiciones.forEach((p) => capa.appendChild(nodoBailarina(alumnaPorCodigo.get(p.c), p)));
  renderBanca();
}

function nodoBailarina(alumna, p) {
  const nodo = crearEl("div", "bailarina");
  nodo.style.left = `${p.x}%`;
  nodo.style.top = `${p.y}%`;
  nodo.title = alumna.nombre;
  nodo.append(
    crearEl("span", "bailarina-circulo", iniciales(alumna.nombre)),
    crearEl("span", "bailarina-nombre", nombreCortoPorCodigo.get(alumna.c) || alumna.nombre)
  );
  nodo.addEventListener("pointerdown", (e) => empezarArrastre(e, alumna.c, nodo, false));
  return nodo;
}

function renderBanca() {
  const banca = el("banca");
  banca.replaceChildren();
  const f = formaciones[formacionActual];
  const colocadas = new Set(f ? f.posiciones.map((p) => p.c) : []);
  const fuera = alumnasEnBaile().filter((a) => !colocadas.has(a.c));
  const total = alumnasEnBaile().length;
  if (!total) {
    el("pistaBanca").textContent = "Este baile no tiene alumnas. Escógelas en \"Baile y alumnas\" y guarda.";
  } else if (fuera.length) {
    el("pistaBanca").textContent = `Arrastra cada alumna al escenario (o tócala y luego toca su lugar). Faltan ${fuera.length}.`;
  } else {
    el("pistaBanca").textContent = "✅ Todas en el escenario. Para quitar a una, arrástrala aquí abajo.";
  }
  fuera.forEach((a) => {
    const chip = crearEl("button", "banca-chip" + (a.c === elegidaDeBanca ? " elegida" : ""), nombreCortoPorCodigo.get(a.c) || a.nombre);
    chip.type = "button";
    chip.title = a.nombre;
    chip.addEventListener("pointerdown", (e) => empezarArrastre(e, a.c, chip, true));
    banca.appendChild(chip);
  });
}

// ---------- arrastrar (dedo y mouse, con Pointer Events) ----------

let arrastre = null;

function empezarArrastre(e, codigo, nodo, desdeBanca) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  arrastre = { codigo, nodo, desdeBanca, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, movio: false, fantasma: null };
  document.addEventListener("pointermove", moverArrastre);
  document.addEventListener("pointerup", soltarArrastre);
  document.addEventListener("pointercancel", cancelarArrastre);
}

function rectEscenario() {
  return el("escenario").getBoundingClientRect();
}

function dentroDe(rect, e, margen = 0) {
  return (
    e.clientX >= rect.left - margen &&
    e.clientX <= rect.right + margen &&
    e.clientY >= rect.top - margen &&
    e.clientY <= rect.bottom + margen
  );
}

function puntoEnEscenario(e) {
  const r = rectEscenario();
  const limitar = (v) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
  return { x: limitar(((e.clientX - r.left) / r.width) * 100), y: limitar(((e.clientY - r.top) / r.height) * 100) };
}

function moverArrastre(e) {
  if (!arrastre || e.pointerId !== arrastre.pointerId) return;
  if (!arrastre.movio && Math.hypot(e.clientX - arrastre.x0, e.clientY - arrastre.y0) < 6) return;
  arrastre.movio = true;
  e.preventDefault();
  el("banca").classList.toggle("sobre", !arrastre.desdeBanca && dentroDe(el("banca").getBoundingClientRect(), e));
  if (arrastre.desdeBanca) {
    if (!arrastre.fantasma) {
      const alumna = alumnaPorCodigo.get(arrastre.codigo);
      arrastre.fantasma = nodoBailarina(alumna, { x: 0, y: 0 });
      arrastre.fantasma.classList.add("fantasma");
      // En pantalla completa nativa solo se ve lo que está dentro de la caja.
      (document.fullscreenElement ? el("cajaEscenario") : document.body).appendChild(arrastre.fantasma);
    }
    arrastre.fantasma.style.left = `${e.clientX}px`;
    arrastre.fantasma.style.top = `${e.clientY}px`;
  } else {
    const p = puntoEnEscenario(e);
    arrastre.nodo.classList.add("arrastrando");
    arrastre.nodo.style.left = `${p.x}%`;
    arrastre.nodo.style.top = `${p.y}%`;
  }
}

function terminarArrastre() {
  document.removeEventListener("pointermove", moverArrastre);
  document.removeEventListener("pointerup", soltarArrastre);
  document.removeEventListener("pointercancel", cancelarArrastre);
  el("banca").classList.remove("sobre");
  if (arrastre && arrastre.fantasma) arrastre.fantasma.remove();
  const a = arrastre;
  arrastre = null;
  return a;
}

function cancelarArrastre() {
  terminarArrastre();
  renderEscenario();
}

function soltarArrastre(e) {
  if (!arrastre || e.pointerId !== arrastre.pointerId) return;
  const a = terminarArrastre();
  const f = formaciones[formacionActual];
  if (!f) return;

  if (!a.movio) {
    // Toque sin mover: en la banca, se "elige" para ponerla tocando el escenario.
    if (a.desdeBanca) {
      elegidaDeBanca = elegidaDeBanca === a.codigo ? "" : a.codigo;
      renderBanca();
    }
    return;
  }
  const sobreBanca = dentroDe(el("banca").getBoundingClientRect(), e);
  if (!a.desdeBanca && sobreBanca) {
    f.posiciones = f.posiciones.filter((p) => p.c !== a.codigo);
  } else if (!a.desdeBanca || dentroDe(rectEscenario(), e, 10)) {
    const punto = puntoEnEscenario(e);
    f.posiciones = f.posiciones.filter((p) => p.c !== a.codigo);
    f.posiciones.push({ c: a.codigo, ...punto });
  } else {
    return; // de la banca a ningún lado: no cambia nada
  }
  elegidaDeBanca = "";
  marcarFormacionesSucias();
  renderEscenario();
}

// Tocar el escenario con una alumna elegida en la banca la pone ahí.
el("escenario").addEventListener("click", (e) => {
  if (!elegidaDeBanca) return;
  const f = formaciones[formacionActual];
  if (!f) return;
  f.posiciones.push({ c: elegidaDeBanca, ...puntoEnEscenario(e) });
  elegidaDeBanca = "";
  marcarFormacionesSucias();
  renderEscenario();
});

el("btnGuardarFormaciones").addEventListener("click", guardarFormaciones);

async function guardarFormaciones() {
  if (!det) return;
  const boton = el("btnGuardarFormaciones");
  boton.disabled = true;
  boton.textContent = "Guardando...";
  mensaje("mensajeFormaciones", "");
  try {
    await llamarWorker({
      accion: "maestraGuardarFormaciones",
      clave: claveMaestra,
      baileId: det.baile.id,
      version: det.baile.version,
      formaciones: formaciones.map((f) => ({ id: f.id, nombre: f.nombre, posiciones: f.posiciones })),
    });
    sucioFormaciones = false;
    mostrarAviso("");
    // Se recarga para tener los IDs de las formaciones nuevas y la
    // versión nueva; lo que esté a medias en "Baile y alumnas" se respeta.
    await cargarDetalle(det.baile.id, { datos: sucioDatos });
    mensaje("mensajeFormaciones", "✅ Posiciones guardadas", "ok");
  } catch (e) {
    if (manejarClaveInvalida(e)) return;
    if (e.datos && e.datos.conflicto) await recargarPorConflicto(e);
    else mensaje("mensajeFormaciones", e.message, "error");
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar posiciones";
  }
}

// ---------- pantalla completa ----------
// Con la API del navegador cuando existe; en iPhone (no la tiene para
// un div) se cubre la pantalla con la clase .completa.

el("btnPantallaCompleta").addEventListener("click", async () => {
  const caja = el("cajaEscenario");
  if (caja.requestFullscreen) {
    try {
      await caja.requestFullscreen();
      return;
    } catch (e) {
      // sigue con el modo de respaldo
    }
  }
  caja.classList.add("completa");
  document.body.classList.add("coreo-completa");
  el("btnSalirCompleta").hidden = false;
});

el("btnSalirCompleta").addEventListener("click", salirDePantallaCompleta);

document.addEventListener("fullscreenchange", () => {
  el("btnSalirCompleta").hidden = !document.fullscreenElement && !el("cajaEscenario").classList.contains("completa");
});

function salirDePantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el("cajaEscenario").classList.remove("completa");
  document.body.classList.remove("coreo-completa");
  el("btnSalirCompleta").hidden = true;
}

// ---------- imagen de la formación ----------

el("btnImagen").addEventListener("click", compartirImagen);

function dibujarFormacion() {
  const ancho = 1600;
  const altoEscenario = 1000;
  const margen = 40;
  const canvas = document.createElement("canvas");
  canvas.width = ancho + margen * 2;
  canvas.height = altoEscenario + 260;
  const ctx = canvas.getContext("2d");
  const fuente = (peso, px) => `${peso} ${px}px Poppins, Arial, sans-serif`;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ef4b9b";
  ctx.textAlign = "center";
  ctx.font = fuente(800, 46);
  ctx.fillText(det.baile.nombre, canvas.width / 2, 70, canvas.width - 80);
  const f = formaciones[formacionActual];
  ctx.fillStyle = "#a15277";
  ctx.font = fuente(700, 32);
  const sub = [det.baile.grupoNombre, nombreFormacion(f, formacionActual)].filter(Boolean).join(" · ");
  ctx.fillText(sub, canvas.width / 2, 116, canvas.width - 80);

  const x0 = margen;
  const y0 = 150;
  ctx.fillStyle = "#463644";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, y0, ancho, altoEscenario, 24);
  else ctx.rect(x0, y0, ancho, altoEscenario);
  ctx.fill();

  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 2;
  [0.25, 0.75].forEach((p) => {
    ctx.strokeStyle = "rgba(255,255,255,.2)";
    ctx.beginPath();
    ctx.moveTo(x0 + ancho * p, y0);
    ctx.lineTo(x0 + ancho * p, y0 + altoEscenario);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(x0, y0 + altoEscenario / 2);
  ctx.lineTo(x0 + ancho, y0 + altoEscenario / 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,170,215,.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0 + ancho / 2, y0);
  ctx.lineTo(x0 + ancho / 2, y0 + altoEscenario);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = fuente(800, 22);
  ctx.fillStyle = "rgba(255,255,255,.45)";
  ctx.fillText("FONDO", x0 + ancho / 2, y0 + 32);
  ctx.textAlign = "left";
  ctx.fillText("◀ LATERAL", x0 + 14, y0 + altoEscenario / 2 - 14);
  ctx.textAlign = "right";
  ctx.fillText("LATERAL ▶", x0 + ancho - 14, y0 + altoEscenario / 2 - 14);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,170,215,.85)";
  ctx.fillText("CENTRO", x0 + ancho / 2, y0 + altoEscenario - 14);

  const radio = 30;
  f.posiciones.forEach((p) => {
    const alumna = alumnaPorCodigo.get(p.c);
    if (!alumna) return;
    const cx = x0 + (p.x / 100) * ancho;
    const cy = y0 + (p.y / 100) * altoEscenario;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4b9b";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = fuente(800, 22);
    ctx.fillText(iniciales(alumna.nombre), cx, cy + 8);
    const nombre = nombreCortoPorCodigo.get(p.c) || alumna.nombre;
    ctx.font = fuente(800, 22);
    const anchoTexto = Math.min(ctx.measureText(nombre).width, 200);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(cx - anchoTexto / 2 - 6, cy + radio + 4, anchoTexto + 12, 30);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(nombre, cx, cy + radio + 27, 200);
  });

  ctx.fillStyle = "#ef4b9b";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, y0 + altoEscenario + 16, ancho, 56, 14);
  else ctx.rect(x0, y0 + altoEscenario + 16, ancho, 56);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = fuente(800, 28);
  ctx.fillText("P Ú B L I C O", canvas.width / 2, y0 + altoEscenario + 54);

  ctx.fillStyle = "#aaaaaa";
  ctx.font = fuente(600, 20);
  ctx.fillText("MOVE Dance Academy", canvas.width / 2, canvas.height - 18);
  return canvas;
}

async function compartirImagen() {
  if (!det || !formaciones[formacionActual]) return;
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = dibujarFormacion();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const base = `${det.baile.nombre} - ${nombreFormacion(formaciones[formacionActual], formacionActual)}`
      .replace(/[^\p{L}\p{N} ._-]/gu, "")
      .trim()
      .slice(0, 80) || "formacion";
    const archivo = new File([blob], `${base}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try {
        await navigator.share({ files: [archivo], title: base });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = archivo.name;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    mensaje("mensajeFormaciones", "No se pudo crear la imagen en este navegador.", "error");
  }
}

// ---------- correcciones ----------

function opcionesAlumnasCorreccion(select, valor) {
  select.replaceChildren();
  const todas = crearEl("option", "", "Para todo el baile");
  todas.value = "";
  select.appendChild(todas);
  alumnasEnBaile().forEach((a) => {
    const opcion = crearEl("option", "", a.nombre);
    opcion.value = a.c;
    select.appendChild(opcion);
  });
  // Si la corrección era de una alumna que ya no está en el baile.
  if (valor && !alumnasEnBaile().some((a) => a.c === valor)) {
    const c = det.correcciones.find((x) => x.alumna === valor);
    const opcion = crearEl("option", "", c ? c.alumnaNombre : "Alumna");
    opcion.value = valor;
    select.appendChild(opcion);
  }
  select.value = valor || "";
}

function renderCorrecciones() {
  if (!det) return;
  const elegida = el("selectAlumnaCorreccion").value;
  opcionesAlumnasCorreccion(el("selectAlumnaCorreccion"), alumnasEnBaile().some((a) => a.c === elegida) ? elegida : "");
  const pendientes = det.correcciones.filter((c) => !c.resuelta).length;
  el("contadorCorrecciones").textContent = pendientes ? `(${pendientes})` : "";
  const cont = el("listaCorrecciones");
  cont.replaceChildren();
  if (!det.correcciones.length) {
    cont.appendChild(crearEl("p", "coreo-vacio", "Todavía no hay correcciones."));
    return;
  }
  det.correcciones.forEach((c) => cont.appendChild(tarjetaCorreccion(c)));
}

function tarjetaCorreccion(c) {
  const tarjeta = crearEl("div", "coreo-correccion" + (c.resuelta ? " resuelta" : ""));
  if (c.alumna) tarjeta.appendChild(crearEl("span", "coreo-correccion-alumna", c.alumnaNombre || "Alumna"));
  tarjeta.appendChild(crearEl("div", "coreo-correccion-texto", c.texto));
  tarjeta.appendChild(crearEl("div", "coreo-correccion-meta", [c.por, c.cuando].filter(Boolean).join(" · ")));
  const botones = crearEl("div", "coreo-correccion-botones");
  const resolver = crearEl("button", "coreo-mini", c.resuelta ? "↩ Reabrir" : "✓ Resuelta");
  resolver.type = "button";
  resolver.addEventListener("click", () =>
    guardarCorreccion({ correccion: c, texto: c.texto, alumna: c.alumna, resuelta: !c.resuelta, boton: resolver })
  );
  const editar = crearEl("button", "coreo-mini", "✏️ Editar");
  editar.type = "button";
  editar.addEventListener("click", () => editarCorreccion(tarjeta, c));
  const borrar = crearEl("button", "coreo-mini coreo-mini-peligro", "🗑 Borrar");
  borrar.type = "button";
  borrar.addEventListener("click", () => borrarCorreccion(c, borrar));
  botones.append(resolver, editar, borrar);
  tarjeta.appendChild(botones);
  return tarjeta;
}

function editarCorreccion(tarjeta, c) {
  tarjeta.replaceChildren();
  const area = crearEl("textarea", "input-textarea");
  area.maxLength = 1000;
  area.value = c.texto;
  const select = crearEl("select", "coreo-select coreo-select-ancho");
  opcionesAlumnasCorreccion(select, c.alumna);
  const botones = crearEl("div", "coreo-correccion-botones");
  const guardar = crearEl("button", "coreo-mini", "💾 Guardar");
  guardar.type = "button";
  guardar.addEventListener("click", () =>
    guardarCorreccion({ correccion: c, texto: area.value, alumna: select.value, resuelta: c.resuelta, boton: guardar })
  );
  const cancelar = crearEl("button", "coreo-mini", "Cancelar");
  cancelar.type = "button";
  cancelar.addEventListener("click", renderCorrecciones);
  botones.append(guardar, cancelar);
  tarjeta.append(area, select, botones);
  area.focus();
}

el("btnAgregarCorreccion").addEventListener("click", () => {
  guardarCorreccion({
    correccion: null,
    texto: el("inputCorreccion").value,
    alumna: el("selectAlumnaCorreccion").value,
    resuelta: false,
    boton: el("btnAgregarCorreccion"),
  });
});

async function guardarCorreccion({ correccion, texto, alumna, resuelta, boton }) {
  if (!texto.trim()) return mensaje("mensajeCorrecciones", "Escribe la corrección.", "error");
  mensaje("mensajeCorrecciones", "");
  boton.disabled = true;
  try {
    await llamarWorker({
      accion: "maestraGuardarCorreccion",
      clave: claveMaestra,
      baileId: det.baile.id,
      correccionId: correccion ? correccion.id : "",
      textoAnterior: correccion ? correccion.texto : "",
      resueltaAnterior: correccion ? correccion.resuelta : false,
      texto,
      alumna,
      resuelta,
    });
    if (!correccion) {
      el("inputCorreccion").value = "";
      el("selectAlumnaCorreccion").value = "";
    }
    await cargarDetalle(det.baile.id, { datos: sucioDatos, formaciones: sucioFormaciones });
    mensaje("mensajeCorrecciones", "✅ Guardado", "ok");
  } catch (e) {
    if (manejarClaveInvalida(e)) return;
    if (e.datos && e.datos.conflicto) {
      mensaje("mensajeCorrecciones", e.message, "error");
      await cargarDetalle(det.baile.id, { datos: sucioDatos, formaciones: sucioFormaciones }).catch(() => {});
    } else {
      mensaje("mensajeCorrecciones", e.message, "error");
    }
  } finally {
    boton.disabled = false;
  }
}

async function borrarCorreccion(c, boton) {
  if (!confirm("¿Borrar esta corrección?")) return;
  boton.disabled = true;
  try {
    await llamarWorker({ accion: "maestraEliminarCorreccion", clave: claveMaestra, baileId: det.baile.id, correccionId: c.id });
    await cargarDetalle(det.baile.id, { datos: sucioDatos, formaciones: sucioFormaciones });
  } catch (e) {
    if (manejarClaveInvalida(e)) return;
    mensaje("mensajeCorrecciones", e.message, "error");
    boton.disabled = false;
  }
}

// ---------- arranque ----------

const sesionCompartidaCoreo = leerSesionMaestraCompartida();
if (sesionCompartidaCoreo && sesionCompartidaCoreo.clave) {
  claveMaestra = sesionCompartidaCoreo.clave;
  cargarLista();
}
