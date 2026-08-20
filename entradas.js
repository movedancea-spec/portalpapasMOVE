// ==========================================
// MOVE — ENTRADAS SHOW (venta pública por turnos)
// MOVE Dance Academy
// ==========================================
// Página pública (sin clave de familia) para que cualquier persona:
//   1) busque y elija a su alumna (ligando el turno a ella) y reciba
//      un código — para la venta por turnos, los avisos de registro,
//      turno y compra ya no van por WhatsApp: se ven en el Portal de
//      Alumnas de esa alumna,
//   2) consulte con ese código en qué va su turno,
//   3) cuando le toque, elija filas completas y pague con un link
//      de Paggo.
//
// Todo pasa por el mismo Worker de siempre, con el formato
// { accion, ... } de este proyecto. El código de turno se guarda en
// este dispositivo (localStorage) para que la persona pueda volver a
// esta página después sin tener que volver a escribirlo — igual que
// portal.js guarda la clave familiar.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const LLAVE_CODIGO_ENTRADAS = "move_entradas_codigo";
const MINUTOS_URGENTE = 2; // a partir de cuántos minutos restantes se pone rojo/parpadea

let codigoActual = "";
let turnoActualGlobal = 0;
let horaExpiraActual = null; // objeto Date, o null
let pollTimer = null;
let cronTimer = null;

// Venta individual (sin turnos) — cuando Ana la activa desde el
// panel, esta página deja de usar registro/turno por completo y
// entra directo aquí.
let asientosSeleccionados = new Map(); // "filaId:numero" -> {filaId, numero, precio}
let mapaIndividualCache = [];
let cronIndividualTimer = null;
let horaExpiraIndividual = null;

function el(id) {
  return document.getElementById(id);
}

const PANTALLAS = [
  "pantallaCargandoInicial",
  "pantallaCerrado",
  "pantallaRegistro",
  "pantallaBuscarCodigo",
  "pantallaRegistrado",
  "pantallaMiTurno",
  "pantallaAsientosIndividual",
  "pantallaLinkIndividual",
];

function mostrarPantalla(id) {
  PANTALLAS.forEach((p) => {
    el(p).hidden = p !== id;
  });
  el("barraTotalIndividual").hidden = id !== "pantallaAsientosIndividual";
  if (id !== "pantallaMiTurno") {
    detenerPollTurno();
    detenerCronometro();
  }
  if (id !== "pantallaAsientosIndividual") {
    detenerCronometroIndividual();
  }
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

// Fecha/hora legible en español, siempre en horario de Guatemala
// (sin importar en qué zona horaria esté el navegador de quien la ve).
function formatearFechaHora(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch (e) {
    return "";
  }
}

function guardarCodigo(codigo) {
  codigoActual = codigo;
  try {
    localStorage.setItem(LLAVE_CODIGO_ENTRADAS, codigo);
  } catch (e) {
    // Si el navegador bloquea localStorage (modo privado, etc.) no
    // pasa nada grave: simplemente no se recuerda el código entre
    // visitas y la persona lo vuelve a escribir la próxima vez.
  }
}

function borrarCodigoGuardado() {
  codigoActual = "";
  try {
    localStorage.removeItem(LLAVE_CODIGO_ENTRADAS);
  } catch (e) {}
}

function leerCodigoGuardado() {
  try {
    return localStorage.getItem(LLAVE_CODIGO_ENTRADAS) || "";
  } catch (e) {
    return "";
  }
}

// ==========================================
// ARRANQUE
// ==========================================

async function iniciar() {
  // Si la venta individual está habilitada, el sistema de turnos
  // está apagado por completo — se ignora cualquier código de turno
  // guardado de antes y se va directo a elegir asientos, sin
  // registro ni espera.
  let datos;
  try {
    datos = await llamarWorker({ accion: "entradasEstadoGeneral" });
  } catch (e) {
    datos = null;
  }

  if (datos && datos.configurado && datos.ventaIndividualHabilitada) {
    await abrirPantallaAsientosIndividual(datos);
    return;
  }

  const guardado = leerCodigoGuardado();
  if (guardado) {
    codigoActual = guardado;
    await cargarYMostrarTurno();
    return;
  }

  mostrarPantallaInicialConDatos(datos);
}

async function cargarPantallaInicial() {
  let datos;
  try {
    datos = await llamarWorker({ accion: "entradasEstadoGeneral" });
  } catch (e) {
    el("textoEventoCerrado").textContent = "Entradas";
    el("textoMensajeCerrado").textContent = e.message || "No se pudo cargar la información. Intenta de nuevo.";
    mostrarPantalla("pantallaCerrado");
    return;
  }
  if (datos && datos.configurado && datos.ventaIndividualHabilitada) {
    await abrirPantallaAsientosIndividual(datos);
    return;
  }
  mostrarPantallaInicialConDatos(datos);
}

function mostrarPantallaInicialConDatos(datos) {
  if (!datos || !datos.configurado) {
    el("textoEventoCerrado").textContent = "Entradas";
    el("textoMensajeCerrado").textContent =
      "Todavía no está lista la venta de entradas. Vuelve a intentarlo más tarde.";
    mostrarPantalla("pantallaCerrado");
    return;
  }

  const encabezado = `${datos.evento}${datos.fechaShow ? " — " + formatearFechaHora(datos.fechaShow) : ""}`;

  if (!datos.registroAbierto) {
    el("textoEventoCerrado").textContent = encabezado;
    if (!datos.ventaHabilitada) {
      el("textoMensajeCerrado").textContent =
        "El registro para escoger turno todavía no está habilitado. Vuelve a revisar más tarde.";
    } else if (datos.horaApertura) {
      el("textoMensajeCerrado").textContent =
        `El registro abre el ${formatearFechaHora(datos.horaApertura)}. Vuelve en ese momento para registrarte y escoger tu turno.`;
    } else {
      el("textoMensajeCerrado").textContent = "El registro para escoger turno todavía no abre.";
    }
    mostrarPantalla("pantallaCerrado");
    return;
  }

  el("textoEventoRegistro").textContent = encabezado;
  el("avisoFilasDisponibles").textContent =
    datos.filasDisponibles > 0
      ? `Quedan ${datos.filasDisponibles} filas disponibles.`
      : "Por el momento ya no quedan filas disponibles.";
  mostrarPantalla("pantallaRegistro");
}

// ==========================================
// REGISTRO — se busca y se elige a la alumna (no se escribe nombre ni
// WhatsApp a mano); el turno queda ligado a esa alumna y los avisos
// le llegan dentro de su Portal, nunca por WhatsApp.
// ==========================================

let alumnaElegidaTurno = null; // { id, nombre }

el("inputBuscarAlumnaTurno").addEventListener("input", () => {
  alumnaElegidaTurno = null;
  el("btnRegistrarTurno").disabled = true;
  el("textoAlumnaElegidaTurno").hidden = true;
  clearTimeout(el("inputBuscarAlumnaTurno")._temporizador);
  el("inputBuscarAlumnaTurno")._temporizador = setTimeout(buscarAlumnaTurno, 350);
});

el("btnCambiarAlumnaTurno").addEventListener("click", () => {
  alumnaElegidaTurno = null;
  el("btnRegistrarTurno").disabled = true;
  el("textoAlumnaElegidaTurno").hidden = true;
  el("inputBuscarAlumnaTurno").value = "";
  el("inputBuscarAlumnaTurno").hidden = false;
  el("inputBuscarAlumnaTurno").focus();
  el("listaAlumnasTurno").innerHTML = "";
});

async function buscarAlumnaTurno() {
  const texto = el("inputBuscarAlumnaTurno").value.trim();
  const cont = el("listaAlumnasTurno");
  if (texto.length < 2) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML = '<p class="lista-vacia">Buscando...</p>';
  try {
    const datos = await llamarWorker({ accion: "entradasBuscarAlumna", query: texto });
    renderListaAlumnasTurno(datos.alumnas || []);
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderListaAlumnasTurno(alumnas) {
  const cont = el("listaAlumnasTurno");
  cont.innerHTML = "";
  if (!alumnas.length) {
    cont.innerHTML = '<p class="lista-vacia">No encontramos ninguna alumna con ese nombre.</p>';
    return;
  }
  alumnas.forEach((a) => {
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado";
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${a.nombre}</span>
      <span class="tarjeta-resultado-detalle">${a.grupos || "—"}</span>
    `;
    tarjeta.addEventListener("click", () => elegirAlumnaTurno(a));
    cont.appendChild(tarjeta);
  });
}

function elegirAlumnaTurno(a) {
  alumnaElegidaTurno = a;
  el("listaAlumnasTurno").innerHTML = "";
  el("inputBuscarAlumnaTurno").hidden = true;
  el("nombreAlumnaElegidaTurno").textContent = a.nombre;
  el("textoAlumnaElegidaTurno").hidden = false;
  el("btnRegistrarTurno").disabled = false;
}

async function registrarTurno() {
  const btn = el("btnRegistrarTurno");
  const msg = el("mensajeErrorRegistro");
  msg.textContent = "";

  if (!alumnaElegidaTurno || !alumnaElegidaTurno.id) {
    msg.textContent = "Busca el nombre de tu alumna y elígela de la lista.";
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Registrando...";
  try {
    const datos = await llamarWorker({
      accion: "entradasRegistrarTurno",
      alumnaId: alumnaElegidaTurno.id,
    });
    guardarCodigo(datos.codigo);
    el("textoCodigoNuevo").textContent = datos.codigo;
    el("tituloRegistrado").textContent = datos.yaRegistrado
      ? "Ya te habías registrado antes 👋"
      : "¡Ya quedaste en la fila! 🎉";
    mostrarPantalla("pantallaRegistrado");
  } catch (e) {
    msg.textContent = e.message;
    btn.disabled = false;
  } finally {
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// CONSULTAR TURNO (con código guardado o escrito a mano)
// ==========================================

async function obtenerEstadoTurno(codigo) {
  return await llamarWorker({ accion: "entradasConsultarEstado", codigo });
}

async function cargarYMostrarTurno() {
  try {
    const datos = await obtenerEstadoTurno(codigoActual);
    mostrarPantalla("pantallaMiTurno");
    pintarEstadoTurno(datos);
    iniciarPollTurno();
  } catch (e) {
    borrarCodigoGuardado();
    el("mensajeErrorCodigo").textContent = e.message || "No encontramos ese código.";
    mostrarPantalla("pantallaBuscarCodigo");
  }
}

async function buscarConCodigoManual() {
  const codigo = el("inputCodigoManual").value.trim().toUpperCase();
  const msg = el("mensajeErrorCodigo");
  msg.textContent = "";
  if (!codigo) {
    msg.textContent = "Escribe tu código.";
    return;
  }

  const btn = el("btnConsultarCodigo");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Buscando...";
  try {
    const datos = await obtenerEstadoTurno(codigo);
    guardarCodigo(codigo);
    mostrarPantalla("pantallaMiTurno");
    pintarEstadoTurno(datos);
    iniciarPollTurno();
  } catch (e) {
    msg.textContent = e.message || "No encontramos ese código.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function pintarEstadoTurno(datos) {
  const t = datos.turno || {};
  turnoActualGlobal = datos.turnoActual || 0;

  el("saludoTurno").textContent = t.nombre ? `¡Hola, ${t.nombre.split(" ")[0]}!` : "Tu turno";
  el("textoNumeroTurno").textContent = t.numero ? `#${t.numero}` : "—";
  el("bloqueTurnoActivo").hidden = true;
  el("bloqueResumenCompra").hidden = true;
  detenerCronometro();

  const detalle = el("detalleEstadoTurno");
  detalle.classList.remove("urgente");

  if (t.estado === "Pendiente") {
    el("textoEstadoTurno").textContent = "Ya estás en la fila 🕐";
    detalle.textContent = "En un momento te asignamos tu número de turno.";
  } else if (t.estado === "En Espera") {
    el("textoEstadoTurno").textContent = "Esperando tu turno";
    detalle.textContent = turnoActualGlobal
      ? `En este momento va el turno #${turnoActualGlobal}. Te avisamos dentro del Portal de Alumnas en cuanto te toque.`
      : "Te avisamos dentro del Portal de Alumnas en cuanto te toque.";
  } else if (t.estado === "Activo") {
    el("textoEstadoTurno").textContent = "¡Es tu turno! 🎉";
    el("bloqueTurnoActivo").hidden = false;
    el("textoCodigoActivo").textContent = codigoActual || "—";
    const linkBtn = el("linkPagoActivo");
    if (t.linkPago) {
      linkBtn.href = t.linkPago;
      linkBtn.hidden = false;
    } else {
      linkBtn.hidden = true;
    }
    horaExpiraActual = t.horaExpira ? new Date(t.horaExpira) : null;
    iniciarCronometro();
  } else if (t.estado === "Vencido") {
    el("textoEstadoTurno").textContent = "Tu turno venció";
    detalle.textContent = "Se pasó el tiempo de 15 minutos sin completar la compra.";
  } else if (t.estado === "Completado") {
    el("textoEstadoTurno").textContent = "¡Compra confirmada! 🎊";
    detalle.textContent = "Nos vemos en el show.";
    el("bloqueResumenCompra").hidden = false;
    el("textoResumenCompra").textContent = `Total pagado: Q${Number(t.totalPagado || 0).toFixed(2)}`;
    detenerPollTurno();
  } else if (t.estado === "Cancelado") {
    el("textoEstadoTurno").textContent = "Turno cancelado";
    detalle.textContent = "";
    detenerPollTurno();
  } else {
    el("textoEstadoTurno").textContent = "Cargando...";
    detalle.textContent = "";
  }
}

function iniciarPollTurno() {
  detenerPollTurno();
  pollTimer = setInterval(() => {
    if (!el("pantallaMiTurno").hidden) cargarYMostrarTurno();
  }, 15000);
}

function detenerPollTurno() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ==========================================
// CRONÓMETRO (turno activo — cuenta regresiva de los 15 minutos)
// ==========================================

function iniciarCronometro() {
  detenerCronometro();
  actualizarCronometro();
  cronTimer = setInterval(actualizarCronometro, 1000);
}

function detenerCronometro() {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}

function actualizarCronometro() {
  if (!horaExpiraActual) return;
  const restanteMs = horaExpiraActual.getTime() - Date.now();

  if (restanteMs <= 0) {
    detenerCronometro();
    if (!el("pantallaMiTurno").hidden) {
      el("detalleEstadoTurno").textContent = "Tu turno acaba de vencer — actualizando...";
      el("detalleEstadoTurno").classList.add("urgente");
      cargarYMostrarTurno();
    }
    return;
  }

  const totalSeg = Math.floor(restanteMs / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  const texto = `${min}:${seg.toString().padStart(2, "0")}`;
  const urgente = totalSeg <= MINUTOS_URGENTE * 60;

  if (!el("pantallaMiTurno").hidden) {
    el("detalleEstadoTurno").textContent = `Tienes ${texto} minutos para presentarte en recepción.`;
    el("detalleEstadoTurno").classList.toggle("urgente", urgente);
  }
}

// ==========================================
// VENTA INDIVIDUAL (sin turnos) — elegir asientos sueltos y pagar
// ==========================================

async function abrirPantallaAsientosIndividual(datosGenerales) {
  mostrarPantalla("pantallaAsientosIndividual");
  asientosSeleccionados.clear();
  actualizarBarraTotalIndividual();
  el("mensajeErrorIndividual").textContent = "";
  await cargarMapaAsientosIndividual();
}

async function cargarMapaAsientosIndividual() {
  const cont = el("mapaSeccionesIndividual");
  cont.innerHTML = '<p class="lista-vacia">Cargando mapa de butacas...</p>';
  try {
    const datos = await llamarWorker({ accion: "entradasObtenerMapaAsientos" });
    mapaIndividualCache = datos.filas || [];
    pintarMapaAsientosIndividual();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message || "No se pudo cargar el mapa de butacas."}</p>`;
  }
}

function pintarMapaAsientosIndividual() {
  const cont = el("mapaSeccionesIndividual");
  cont.innerHTML = "";

  if (!mapaIndividualCache.length) {
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar el mapa de butacas.</p>';
    return;
  }

  const porSeccion = {};
  mapaIndividualCache.forEach((f) => {
    const s = f.seccion || "Otra";
    (porSeccion[s] = porSeccion[s] || []).push(f);
  });

  const bloqueIzquierda = crearBloqueSeccionIndividual("IZQUIERDA", porSeccion["Izquierda"]);

  const columnaCentro = document.createElement("div");
  columnaCentro.className = "mapa-columna-centro";
  const tituloCentro = document.createElement("p");
  tituloCentro.className = "mapa-bloque-titulo";
  tituloCentro.textContent = "CENTRO";
  const filaCentro = document.createElement("div");
  filaCentro.className = "mapa-grupo-centro";
  filaCentro.appendChild(crearBloqueSeccionIndividual("", porSeccion["Centro-Izquierda"]));
  const pasillo = document.createElement("div");
  pasillo.className = "pasillo-central";
  filaCentro.appendChild(pasillo);
  filaCentro.appendChild(crearBloqueSeccionIndividual("", porSeccion["Centro-Derecha"]));
  columnaCentro.appendChild(tituloCentro);
  columnaCentro.appendChild(filaCentro);

  const bloqueDerecha = crearBloqueSeccionIndividual("DERECHA", porSeccion["Derecha"]);

  cont.appendChild(bloqueIzquierda);
  cont.appendChild(columnaCentro);
  cont.appendChild(bloqueDerecha);
}

function crearBloqueSeccionIndividual(titulo, filas) {
  const bloque = document.createElement("div");
  bloque.className = "mapa-bloque";

  if (titulo) {
    const t = document.createElement("p");
    t.className = "mapa-bloque-titulo";
    t.textContent = titulo;
    bloque.appendChild(t);
  }

  // La sección IZQUIERDA se dibuja como espejo de las demás (la letra
  // de la fila queda del lado del pasillo central en vez del lado de
  // la pared) — ver la clase CSS ".volteada" en entradas-mapa.css.
  const voltear = titulo === "IZQUIERDA";

  (filas || [])
    .sort((a, b) => (a.letra || a.fila || "").localeCompare(b.letra || b.fila || ""))
    .forEach((f) => bloque.appendChild(crearFilaIndividual(f, voltear)));

  return bloque;
}

function crearFilaIndividual(f, voltear) {
  const div = document.createElement("div");
  div.className = "fila-mapa-individual" + (voltear ? " volteada" : "");

  const etiqueta = document.createElement("span");
  etiqueta.className = "fila-mapa-etiqueta";
  etiqueta.textContent = f.letra || f.fila || "";

  const asientos = document.createElement("span");
  asientos.className = "fila-mapa-asientos";

  (f.butacas || []).forEach((b) => {
    const clave = `${f.id}:${b.numero}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "asiento-btn";
    btn.title = `Fila ${f.letra || f.fila} — asiento ${b.numero} — Q${Number(f.precioPorButaca || 0).toFixed(2)}`;

    if (b.estado !== "Disponible") {
      btn.disabled = true;
    } else {
      if (asientosSeleccionados.has(clave)) btn.classList.add("seleccionado");
      btn.addEventListener("click", () => {
        if (asientosSeleccionados.has(clave)) {
          asientosSeleccionados.delete(clave);
        } else {
          asientosSeleccionados.set(clave, { filaId: f.id, numero: b.numero, precio: f.precioPorButaca || 0 });
        }
        btn.classList.toggle("seleccionado", asientosSeleccionados.has(clave));
        actualizarBarraTotalIndividual();
      });
    }

    asientos.appendChild(btn);
  });

  div.appendChild(etiqueta);
  div.appendChild(asientos);
  return div;
}

function actualizarBarraTotalIndividual() {
  let total = 0;
  asientosSeleccionados.forEach((a) => {
    total += Number(a.precio || 0);
  });
  el("textoTotalSeleccionIndividual").textContent = `Q${total.toFixed(2)}`;
  el("btnGenerarLinkIndividual").disabled = asientosSeleccionados.size === 0;
}

function armarSeleccionesPorFila() {
  const porFila = new Map();
  asientosSeleccionados.forEach((a) => {
    if (!porFila.has(a.filaId)) porFila.set(a.filaId, []);
    porFila.get(a.filaId).push(a.numero);
  });
  return Array.from(porFila.entries()).map(([filaId, butacas]) => ({ filaId, butacas }));
}

async function generarLinkIndividual() {
  const btn = el("btnGenerarLinkIndividual");
  const msg = el("mensajeErrorIndividual");
  msg.textContent = "";

  const nombre = el("inputNombreIndividual").value.trim();
  const whatsapp = el("inputWhatsappIndividual").value.trim();
  if (!nombre) {
    msg.textContent = "Escribe tu nombre completo.";
    return;
  }
  if (!whatsapp) {
    msg.textContent = "Escribe tu número de WhatsApp.";
    return;
  }
  if (!asientosSeleccionados.size) return;

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Generando link...";
  try {
    const selecciones = armarSeleccionesPorFila();
    const datos = await llamarWorker({
      accion: "entradasComprarAsientosIndividual",
      nombre,
      whatsapp,
      selecciones,
    });
    el("textoTotalLinkIndividual").textContent = `Q${Number(datos.total || 0).toFixed(2)}`;
    el("linkPagarIndividual").href = datos.link;
    mostrarPantalla("pantallaLinkIndividual");
  } catch (e) {
    msg.textContent = e.message;
    if (String(e.message || "").toLowerCase().includes("disponible")) {
      asientosSeleccionados.clear();
      actualizarBarraTotalIndividual();
      cargarMapaAsientosIndividual();
    }
  } finally {
    btn.disabled = asientosSeleccionados.size === 0;
    btn.textContent = textoOriginal;
  }
}

function detenerCronometroIndividual() {
  if (cronIndividualTimer) {
    clearInterval(cronIndividualTimer);
    cronIndividualTimer = null;
  }
}

// ==========================================
// EVENTOS
// ==========================================

el("btnRegistrarTurno").addEventListener("click", registrarTurno);

el("btnYaTengoCodigo").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));
el("btnYaTengoCodigoCerrado").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));
el("btnVolverDesdeCodigo").addEventListener("click", () => cargarPantallaInicial());

el("btnConsultarCodigo").addEventListener("click", buscarConCodigoManual);
el("inputCodigoManual").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarConCodigoManual();
});

el("btnVerMiTurnoDesdeRegistro").addEventListener("click", () => cargarYMostrarTurno());
el("btnActualizarTurno").addEventListener("click", () => cargarYMostrarTurno());
el("btnOtroCodigo").addEventListener("click", () => {
  borrarCodigoGuardado();
  el("inputCodigoManual").value = "";
  el("mensajeErrorCodigo").textContent = "";
  mostrarPantalla("pantallaBuscarCodigo");
});

el("btnGenerarLinkIndividual").addEventListener("click", generarLinkIndividual);
el("btnElegirOtrosAsientos").addEventListener("click", () => {
  asientosSeleccionados.clear();
  actualizarBarraTotalIndividual();
  el("mensajeErrorIndividual").textContent = "";
  mostrarPantalla("pantallaAsientosIndividual");
  cargarMapaAsientosIndividual();
});

iniciar();
