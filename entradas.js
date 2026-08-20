// ==========================================
// MOVE — ENTRADAS SHOW (venta pública por turnos)
// MOVE Dance Academy
// ==========================================
// Página pública (sin clave de familia) para que cualquier persona:
//   1) se registre con su nombre y WhatsApp y reciba un código,
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
let filasSeleccionadas = new Map(); // id de FILAS SHOW -> objeto fila
let filasDisponiblesCache = [];
let pollTimer = null;
let cronTimer = null;

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
  "pantallaComprar",
  "pantallaLinkPago",
];

function mostrarPantalla(id) {
  PANTALLAS.forEach((p) => {
    el(p).hidden = p !== id;
  });
  el("barraTotalSeleccion").hidden = id !== "pantallaComprar";
  if (id !== "pantallaMiTurno") detenerPollTurno();
  if (id !== "pantallaComprar" && id !== "pantallaMiTurno") detenerCronometro();
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
  const guardado = leerCodigoGuardado();
  if (guardado) {
    codigoActual = guardado;
    await cargarYMostrarTurno();
    return;
  }
  await cargarPantallaInicial();
}

async function cargarPantallaInicial() {
  try {
    const datos = await llamarWorker({ accion: "entradasEstadoGeneral" });

    if (!datos.configurado) {
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
  } catch (e) {
    el("textoEventoCerrado").textContent = "Entradas";
    el("textoMensajeCerrado").textContent = e.message || "No se pudo cargar la información. Intenta de nuevo.";
    mostrarPantalla("pantallaCerrado");
  }
}

// ==========================================
// REGISTRO
// ==========================================

async function registrarTurno() {
  const nombre = el("inputNombreTurno").value.trim();
  const whatsapp = el("inputWhatsappTurno").value.trim();
  const btn = el("btnRegistrarTurno");
  const msg = el("mensajeErrorRegistro");
  msg.textContent = "";

  if (!nombre) {
    msg.textContent = "Escribe tu nombre completo.";
    return;
  }
  if (!whatsapp) {
    msg.textContent = "Escribe tu número de WhatsApp.";
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Registrando...";
  try {
    const datos = await llamarWorker({ accion: "entradasRegistrarTurno", nombre, whatsapp });
    guardarCodigo(datos.codigo);
    el("textoCodigoNuevo").textContent = datos.codigo;
    el("tituloRegistrado").textContent = datos.yaRegistrado
      ? "Ya te habías registrado antes 👋"
      : "¡Ya quedaste en la fila! 🎉";
    mostrarPantalla("pantallaRegistrado");
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
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
  el("btnIrAComprar").hidden = true;
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
      ? `En este momento va el turno #${turnoActualGlobal}. Te avisamos por WhatsApp en cuanto te toque.`
      : "Te avisamos por WhatsApp en cuanto te toque.";
  } else if (t.estado === "Activo") {
    el("textoEstadoTurno").textContent = "¡Es tu turno! 🎉";
    el("btnIrAComprar").hidden = false;
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
    if (!el("pantallaComprar").hidden) {
      el("mensajeErrorComprar").textContent = "Tu turno venció. Vuelve a \"Mi turno\" para ver el estado.";
      el("textoCronometro").textContent = "⏱️ 0:00";
    }
    return;
  }

  const totalSeg = Math.floor(restanteMs / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  const texto = `${min}:${seg.toString().padStart(2, "0")}`;
  const urgente = totalSeg <= MINUTOS_URGENTE * 60;

  if (!el("pantallaMiTurno").hidden) {
    el("detalleEstadoTurno").textContent = `Tienes ${texto} minutos para comprar.`;
    el("detalleEstadoTurno").classList.toggle("urgente", urgente);
  }
  if (!el("pantallaComprar").hidden) {
    el("textoCronometro").textContent = `⏱️ ${texto}`;
    el("textoCronometro").classList.toggle("urgente", urgente);
  }
}

// ==========================================
// COMPRAR FILAS
// ==========================================

const ORDEN_SECCIONES = ["Izquierda", "Centro-Izquierda", "Centro-Derecha", "Derecha"];

async function abrirPantallaComprar() {
  mostrarPantalla("pantallaComprar");
  filasSeleccionadas.clear();
  actualizarBarraTotal();
  el("mensajeErrorComprar").textContent = "";
  if (horaExpiraActual) iniciarCronometro();
  await cargarFilasDisponibles();
}

async function cargarFilasDisponibles() {
  const cont = el("listaFilasDisponibles");
  cont.innerHTML = '<p class="lista-vacia">Cargando filas disponibles...</p>';
  try {
    const datos = await llamarWorker({ accion: "entradasObtenerFilasDisponibles" });
    filasDisponiblesCache = datos.filas || [];
    pintarFilasDisponibles();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message || "No se pudieron cargar las filas."}</p>`;
  }
}

function pintarFilasDisponibles() {
  const cont = el("listaFilasDisponibles");
  cont.innerHTML = "";

  if (!filasDisponiblesCache.length) {
    cont.innerHTML = '<p class="lista-vacia">Ya no quedan filas disponibles.</p>';
    return;
  }

  const porSeccion = {};
  filasDisponiblesCache.forEach((f) => {
    const s = f.seccion || "Otra";
    if (!porSeccion[s]) porSeccion[s] = [];
    porSeccion[s].push(f);
  });

  const secciones = Object.keys(porSeccion).sort(
    (a, b) => ORDEN_SECCIONES.indexOf(a) - ORDEN_SECCIONES.indexOf(b)
  );

  secciones.forEach((seccion) => {
    const grupo = document.createElement("div");

    const titulo = document.createElement("p");
    titulo.className = "grupo-seccion-titulo";
    titulo.textContent = seccion;
    grupo.appendChild(titulo);

    const listaFilas = document.createElement("div");
    listaFilas.className = "grupo-seccion-filas";

    porSeccion[seccion]
      .sort((a, b) => (a.fila || "").localeCompare(b.fila || ""))
      .forEach((f) => listaFilas.appendChild(crearTarjetaFila(f)));

    grupo.appendChild(listaFilas);
    cont.appendChild(grupo);
  });
}

function crearTarjetaFila(f) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tarjeta-fila";
  btn.dataset.id = f.id;

  const marcada = filasSeleccionadas.has(f.id);
  if (marcada) btn.classList.add("seleccionada");

  const info = document.createElement("div");
  info.className = "tarjeta-fila-info";
  info.innerHTML = `
    <span class="tarjeta-fila-nombre">Fila ${f.letra || f.fila}</span>
    <span class="tarjeta-fila-detalle">${f.cantidad} butacas — #${f.butacas}</span>
  `;

  const precio = document.createElement("span");
  precio.className = "tarjeta-fila-precio";
  precio.textContent = `Q${Number(f.precio || 0).toFixed(2)}`;

  const marca = document.createElement("span");
  marca.className = "tarjeta-fila-marca";
  marca.textContent = marcada ? "✓" : "";

  btn.appendChild(info);
  btn.appendChild(precio);
  btn.appendChild(marca);

  btn.addEventListener("click", () => {
    if (filasSeleccionadas.has(f.id)) {
      filasSeleccionadas.delete(f.id);
    } else {
      filasSeleccionadas.set(f.id, f);
    }
    const ahoraMarcada = filasSeleccionadas.has(f.id);
    btn.classList.toggle("seleccionada", ahoraMarcada);
    marca.textContent = ahoraMarcada ? "✓" : "";
    actualizarBarraTotal();
  });

  return btn;
}

function actualizarBarraTotal() {
  let total = 0;
  filasSeleccionadas.forEach((f) => {
    total += Number(f.precio || 0);
  });
  el("textoTotalSeleccion").textContent = `Q${total.toFixed(2)}`;
  el("btnPagarFilas").disabled = filasSeleccionadas.size === 0;
}

async function pagarFilasSeleccionadas() {
  const btn = el("btnPagarFilas");
  const msg = el("mensajeErrorComprar");
  msg.textContent = "";
  if (!filasSeleccionadas.size) return;

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Generando link...";
  try {
    const filaIds = Array.from(filasSeleccionadas.keys());
    const datos = await llamarWorker({ accion: "entradasComprarFilas", codigo: codigoActual, filaIds });
    el("textoTotalLinkPago").textContent = `Q${Number(datos.total || 0).toFixed(2)}`;
    el("linkPagarEntradas").href = datos.link;
    detenerCronometro();
    mostrarPantalla("pantallaLinkPago");
  } catch (e) {
    msg.textContent = e.message;
    // Si el error fue porque alguna fila ya no estaba disponible,
    // refrescamos la lista para que no vuelvan a intentar elegirla.
    if (String(e.message || "").toLowerCase().includes("disponible")) {
      cargarFilasDisponibles();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// EVENTOS
// ==========================================

el("btnRegistrarTurno").addEventListener("click", registrarTurno);
el("inputWhatsappTurno").addEventListener("keydown", (e) => {
  if (e.key === "Enter") registrarTurno();
});

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

el("btnIrAComprar").addEventListener("click", abrirPantallaComprar);
el("btnVolverComprar").addEventListener("click", () => cargarYMostrarTurno());
el("btnPagarFilas").addEventListener("click", pagarFilasSeleccionadas);

el("btnVolverMiTurnoDesdeLink").addEventListener("click", () => cargarYMostrarTurno());

iniciar();
