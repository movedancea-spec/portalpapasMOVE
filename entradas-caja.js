// ==========================================
// MOVE — CAJA DE ENTRADAS (recepción)
// MOVE Dance Academy
// ==========================================
// Pantalla privada (misma clave que el panel de administración,
// CLAVE_ENTRADAS_SHOW) para que recepción:
//   1) busque el turno de una persona por su código,
//   2) si ya es su turno (Activo), le elija las filas completas
//      en el mapa de butacas,
//   3) genere el link de pago (el Worker ya se lo manda por
//      WhatsApp a la persona automáticamente).
//
// La clave se guarda solo en memoria (no en localStorage), igual
// que en entradas-admin.js — no se deja puesta en un dispositivo
// compartido de recepción.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const MINUTOS_URGENTE = 2;

let claveCaja = "";
let codigoActual = "";
let turnoActualCaja = null; // {id, nombre, estado, numero, horaExpira, ...}
let horaExpiraActual = null;
let filasSeleccionadas = new Map();
let filasMapaCache = [];
let cronTimer = null;

// Venta individual (sin turnos) — cuando está activa, la caja
// salta directo a elegir asientos sueltos en vez de buscar por
// código de turno.
let asientosSeleccionadosCaja = new Map(); // "filaId:numero" -> {filaId, numero, precio}
let mapaIndividualCajaCache = [];

function el(id) {
  return document.getElementById(id);
}

const PANTALLAS = [
  "pantallaLogin",
  "pantallaBuscarCodigo",
  "pantallaTurnoInfo",
  "pantallaComprarCaja",
  "pantallaLinkGenerado",
  "pantallaEfectivoConfirmado",
  "pantallaAsientosCaja",
  "pantallaResultadoCajaIndividual",
];

function mostrarPantalla(id) {
  PANTALLAS.forEach((p) => {
    el(p).hidden = p !== id;
  });
  el("barraTotalSeleccionCaja").hidden = id !== "pantallaComprarCaja";
  el("barraTotalCajaIndividual").hidden = id !== "pantallaAsientosCaja";
  if (id !== "pantallaComprarCaja") detenerCronometro();
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

// ==========================================
// LOGIN
// ==========================================

async function entrarCaja() {
  const clave = el("inputClaveCaja").value.trim();
  const msg = el("mensajeErrorLogin");
  msg.textContent = "";
  if (!clave) {
    msg.textContent = "Escribe la clave.";
    return;
  }

  const btn = el("btnEntrarCaja");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Entrando...";
  try {
    await llamarWorker({ accion: "entradasAdminEntrar", clave });
    claveCaja = clave;

    let estadoGeneral = null;
    try {
      estadoGeneral = await llamarWorker({ accion: "entradasEstadoGeneral" });
    } catch (e) {
      estadoGeneral = null;
    }

    if (estadoGeneral && estadoGeneral.configurado && estadoGeneral.ventaIndividualHabilitada) {
      await abrirPantallaAsientosCaja();
    } else {
      mostrarPantalla("pantallaBuscarCodigo");
    }
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// BUSCAR TURNO POR CÓDIGO
// ==========================================

async function buscarTurnoCaja() {
  const codigo = el("inputCodigoCaja").value.trim().toUpperCase();
  const msg = el("mensajeErrorBuscar");
  msg.textContent = "";
  if (!codigo) {
    msg.textContent = "Escribe el código.";
    return;
  }

  const btn = el("btnBuscarCodigoCaja");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Buscando...";
  try {
    const datos = await llamarWorker({ accion: "entradasConsultarEstado", codigo });
    codigoActual = codigo;
    turnoActualCaja = datos.turno || {};
    el("inputCodigoCaja").value = "";

    if (turnoActualCaja.estado === "Activo") {
      await abrirPantallaComprarCaja();
    } else {
      mostrarInfoTurno();
    }
  } catch (e) {
    msg.textContent = e.message || "No encontramos ese código.";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

const TEXTO_POR_ESTADO_CAJA = {
  "Pendiente": "Todavía no se le asigna número de turno.",
  "En Espera": "Todavía no le toca — está esperando su turno.",
  "Vencido": "Su turno venció — se pasaron los 10 minutos. Puede pedirle a Ana que le reactive el turno si hace falta.",
  "Completado": "Ya completó su compra.",
  "Cancelado": "Este turno fue cancelado.",
};

function mostrarInfoTurno() {
  const t = turnoActualCaja || {};
  el("textoNumeroTurnoCaja").textContent = t.numero ? `#${t.numero}` : "—";
  el("textoNombreTurnoCaja").textContent = t.nombre || "";
  el("textoEstadoTurnoCaja").textContent =
    TEXTO_POR_ESTADO_CAJA[t.estado] || `Estado: ${t.estado || "desconocido"}`;
  el("mensajeInfoTurno").textContent =
    t.estado === "Completado" && t.totalPagado
      ? `Total pagado: Q${Number(t.totalPagado).toFixed(2)}`
      : "";
  mostrarPantalla("pantallaTurnoInfo");
}

// ==========================================
// ELEGIR FILAS Y COBRAR (turno Activo)
// ==========================================

async function abrirPantallaComprarCaja() {
  mostrarPantalla("pantallaComprarCaja");
  filasSeleccionadas.clear();
  actualizarBarraTotal();
  el("mensajeErrorComprarCaja").textContent = "";
  el("avisoTurnoActivoCaja").textContent =
    `Turno #${turnoActualCaja.numero || "—"} — ${turnoActualCaja.nombre || ""}`;
  horaExpiraActual = turnoActualCaja.horaExpira ? new Date(turnoActualCaja.horaExpira) : null;
  if (horaExpiraActual) iniciarCronometro();
  await cargarMapaFilasCaja();
}

async function cargarMapaFilasCaja() {
  const cont = el("mapaSecciones");
  cont.innerHTML = '<p class="lista-vacia">Cargando mapa de butacas...</p>';
  try {
    const datos = await llamarWorker({ accion: "entradasObtenerMapaFilas", clave: claveCaja });
    filasMapaCache = datos.filas || [];
    pintarMapaTeatro();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message || "No se pudo cargar el mapa de butacas."}</p>`;
  }
}

function pintarMapaTeatro() {
  const cont = el("mapaSecciones");
  cont.innerHTML = "";

  if (!filasMapaCache.length) {
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar el mapa de butacas.</p>';
    return;
  }

  const porSeccion = {};
  filasMapaCache.forEach((f) => {
    const s = f.seccion || "Otra";
    (porSeccion[s] = porSeccion[s] || []).push(f);
  });

  const bloqueIzquierda = crearBloqueSeccion("IZQUIERDA", porSeccion["Izquierda"]);

  const columnaCentro = document.createElement("div");
  columnaCentro.className = "mapa-columna-centro";
  const tituloCentro = document.createElement("p");
  tituloCentro.className = "mapa-bloque-titulo";
  tituloCentro.textContent = "CENTRO";
  const filaCentro = document.createElement("div");
  filaCentro.className = "mapa-grupo-centro";
  filaCentro.appendChild(crearBloqueSeccion("", porSeccion["Centro-Izquierda"]));
  const pasillo = document.createElement("div");
  pasillo.className = "pasillo-central";
  filaCentro.appendChild(pasillo);
  filaCentro.appendChild(crearBloqueSeccion("", porSeccion["Centro-Derecha"]));
  columnaCentro.appendChild(tituloCentro);
  columnaCentro.appendChild(filaCentro);

  const bloqueDerecha = crearBloqueSeccion("DERECHA", porSeccion["Derecha"]);

  cont.appendChild(bloqueIzquierda);
  cont.appendChild(columnaCentro);
  cont.appendChild(bloqueDerecha);
}

function crearBloqueSeccion(titulo, filas) {
  const bloque = document.createElement("div");
  bloque.className = "mapa-bloque";

  if (titulo) {
    const t = document.createElement("p");
    t.className = "mapa-bloque-titulo";
    t.textContent = titulo;
    bloque.appendChild(t);
  }

  // La sección IZQUIERDA se dibuja como espejo de las demás (ver la
  // clase CSS ".volteada" en entradas-mapa.css).
  const voltear = titulo === "IZQUIERDA";

  (filas || [])
    .sort((a, b) => (a.letra || a.fila || "").localeCompare(b.letra || b.fila || ""))
    .forEach((f) => bloque.appendChild(crearFilaMapa(f, voltear)));

  return bloque;
}

function crearFilaMapa(f, voltear) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fila-mapa" + (voltear ? " volteada" : "");
  btn.dataset.id = f.id;

  const disponible = f.estado === "Disponible";
  if (!disponible) {
    btn.disabled = true;
    btn.classList.add(f.estado === "Vendida" ? "vendida" : "reservada");
  }
  if (filasSeleccionadas.has(f.id)) btn.classList.add("seleccionada");

  const etiqueta = document.createElement("span");
  etiqueta.className = "fila-mapa-etiqueta";
  etiqueta.textContent = f.letra || f.fila || "";

  const asientos = document.createElement("span");
  asientos.className = "fila-mapa-asientos";
  const cantidad = Math.max(1, Number(f.cantidad) || 1);
  for (let i = 0; i < cantidad; i++) {
    const punto = document.createElement("span");
    punto.className = "asiento";
    asientos.appendChild(punto);
  }

  btn.title = `Fila ${f.letra || f.fila} — ${f.cantidad} butacas — Q${Number(f.precio || 0).toFixed(2)}${
    disponible ? "" : " (ya no disponible)"
  }`;

  btn.appendChild(etiqueta);
  btn.appendChild(asientos);

  if (disponible) {
    btn.addEventListener("click", () => {
      if (filasSeleccionadas.has(f.id)) {
        filasSeleccionadas.delete(f.id);
      } else {
        filasSeleccionadas.set(f.id, f);
      }
      btn.classList.toggle("seleccionada", filasSeleccionadas.has(f.id));
      actualizarBarraTotal();
    });
  }

  return btn;
}

function actualizarBarraTotal() {
  let total = 0;
  filasSeleccionadas.forEach((f) => {
    total += Number(f.precio || 0);
  });
  el("textoTotalSeleccionCaja").textContent = `Q${total.toFixed(2)}`;
  el("btnCobrarFilas").disabled = filasSeleccionadas.size === 0;
  el("btnCobrarEfectivo").disabled = filasSeleccionadas.size === 0;
}

async function cobrarFilasSeleccionadas() {
  const btn = el("btnCobrarFilas");
  const msg = el("mensajeErrorComprarCaja");
  msg.textContent = "";
  if (!filasSeleccionadas.size) return;

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Generando link...";
  try {
    const filaIds = Array.from(filasSeleccionadas.keys());
    const datos = await llamarWorker({
      accion: "entradasComprarFilas",
      clave: claveCaja,
      codigo: codigoActual,
      filaIds,
    });
    el("textoTotalLinkCaja").textContent = `Q${Number(datos.total || 0).toFixed(2)}`;
    el("linkPagarCaja").href = datos.link;
    detenerCronometro();
    mostrarPantalla("pantallaLinkGenerado");
  } catch (e) {
    msg.textContent = e.message;
    if (String(e.message || "").toLowerCase().includes("disponible")) {
      filasSeleccionadas.clear();
      actualizarBarraTotal();
      cargarMapaFilasCaja();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function cobrarEnEfectivo() {
  const btnLink = el("btnCobrarFilas");
  const btnEfectivo = el("btnCobrarEfectivo");
  const msg = el("mensajeErrorComprarCaja");
  msg.textContent = "";
  if (!filasSeleccionadas.size) return;

  const confirmado = window.confirm("¿Confirmas que ya recibiste el efectivo? Las filas elegidas quedarán marcadas como vendidas.");
  if (!confirmado) return;

  btnLink.disabled = true;
  btnEfectivo.disabled = true;
  const textoOriginal = btnEfectivo.textContent;
  btnEfectivo.textContent = "Confirmando...";
  try {
    const filaIds = Array.from(filasSeleccionadas.keys());
    const datos = await llamarWorker({
      accion: "entradasCobrarEfectivo",
      clave: claveCaja,
      codigo: codigoActual,
      filaIds,
    });
    el("textoTotalEfectivoCaja").textContent = `Q${Number(datos.total || 0).toFixed(2)}`;
    detenerCronometro();
    mostrarPantalla("pantallaEfectivoConfirmado");
  } catch (e) {
    msg.textContent = e.message;
    if (String(e.message || "").toLowerCase().includes("disponible")) {
      filasSeleccionadas.clear();
      actualizarBarraTotal();
      cargarMapaFilasCaja();
    }
  } finally {
    btnLink.disabled = filasSeleccionadas.size === 0;
    btnEfectivo.disabled = filasSeleccionadas.size === 0;
    btnEfectivo.textContent = textoOriginal;
  }
}

// ==========================================
// CRONÓMETRO (cuenta regresiva del turno activo)
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
    el("textoCronometroCaja").textContent = "⏱️ 0:00 — turno vencido";
    el("textoCronometroCaja").classList.add("urgente");
    return;
  }

  const totalSeg = Math.floor(restanteMs / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  const texto = `${min}:${seg.toString().padStart(2, "0")}`;
  const urgente = totalSeg <= MINUTOS_URGENTE * 60;

  el("textoCronometroCaja").textContent = `⏱️ ${texto}`;
  el("textoCronometroCaja").classList.toggle("urgente", urgente);
}

// ==========================================
// VENTA INDIVIDUAL (sin turnos) — recepción elige asientos sueltos
// para alguien y cobra con tarjeta (link) o efectivo
// ==========================================

async function abrirPantallaAsientosCaja() {
  mostrarPantalla("pantallaAsientosCaja");
  asientosSeleccionadosCaja.clear();
  actualizarBarraTotalCajaIndividual();
  el("mensajeErrorCajaIndividual").textContent = "";
  el("inputNombreCajaIndividual").value = "";
  el("inputWhatsappCajaIndividual").value = "";
  await cargarMapaAsientosCaja();
}

async function cargarMapaAsientosCaja() {
  const cont = el("mapaSeccionesCajaIndividual");
  cont.innerHTML = '<p class="lista-vacia">Cargando mapa de butacas...</p>';
  try {
    const datos = await llamarWorker({ accion: "entradasObtenerMapaAsientos" });
    mapaIndividualCajaCache = datos.filas || [];
    pintarMapaAsientosCaja();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message || "No se pudo cargar el mapa de butacas."}</p>`;
  }
}

function pintarMapaAsientosCaja() {
  const cont = el("mapaSeccionesCajaIndividual");
  cont.innerHTML = "";

  if (!mapaIndividualCajaCache.length) {
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar el mapa de butacas.</p>';
    return;
  }

  const porSeccion = {};
  mapaIndividualCajaCache.forEach((f) => {
    const s = f.seccion || "Otra";
    (porSeccion[s] = porSeccion[s] || []).push(f);
  });

  const bloqueIzquierda = crearBloqueSeccionIndividualCaja("IZQUIERDA", porSeccion["Izquierda"]);

  const columnaCentro = document.createElement("div");
  columnaCentro.className = "mapa-columna-centro";
  const tituloCentro = document.createElement("p");
  tituloCentro.className = "mapa-bloque-titulo";
  tituloCentro.textContent = "CENTRO";
  const filaCentro = document.createElement("div");
  filaCentro.className = "mapa-grupo-centro";
  filaCentro.appendChild(crearBloqueSeccionIndividualCaja("", porSeccion["Centro-Izquierda"]));
  const pasillo = document.createElement("div");
  pasillo.className = "pasillo-central";
  filaCentro.appendChild(pasillo);
  filaCentro.appendChild(crearBloqueSeccionIndividualCaja("", porSeccion["Centro-Derecha"]));
  columnaCentro.appendChild(tituloCentro);
  columnaCentro.appendChild(filaCentro);

  const bloqueDerecha = crearBloqueSeccionIndividualCaja("DERECHA", porSeccion["Derecha"]);

  cont.appendChild(bloqueIzquierda);
  cont.appendChild(columnaCentro);
  cont.appendChild(bloqueDerecha);
}

function crearBloqueSeccionIndividualCaja(titulo, filas) {
  const bloque = document.createElement("div");
  bloque.className = "mapa-bloque";

  if (titulo) {
    const t = document.createElement("p");
    t.className = "mapa-bloque-titulo";
    t.textContent = titulo;
    bloque.appendChild(t);
  }

  // La sección IZQUIERDA se dibuja como espejo de las demás (ver la
  // clase CSS ".volteada" en entradas-mapa.css).
  const voltear = titulo === "IZQUIERDA";

  (filas || [])
    .sort((a, b) => (a.letra || a.fila || "").localeCompare(b.letra || b.fila || ""))
    .forEach((f) => bloque.appendChild(crearFilaIndividualCaja(f, voltear)));

  return bloque;
}

function crearFilaIndividualCaja(f, voltear) {
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
      if (asientosSeleccionadosCaja.has(clave)) btn.classList.add("seleccionado");
      btn.addEventListener("click", () => {
        if (asientosSeleccionadosCaja.has(clave)) {
          asientosSeleccionadosCaja.delete(clave);
        } else {
          asientosSeleccionadosCaja.set(clave, { filaId: f.id, numero: b.numero, precio: f.precioPorButaca || 0 });
        }
        btn.classList.toggle("seleccionado", asientosSeleccionadosCaja.has(clave));
        actualizarBarraTotalCajaIndividual();
      });
    }

    asientos.appendChild(btn);
  });

  div.appendChild(etiqueta);
  div.appendChild(asientos);
  return div;
}

function actualizarBarraTotalCajaIndividual() {
  let total = 0;
  asientosSeleccionadosCaja.forEach((a) => {
    total += Number(a.precio || 0);
  });
  el("textoTotalCajaIndividual").textContent = `Q${total.toFixed(2)}`;
  el("btnGenerarLinkCajaIndividual").disabled = asientosSeleccionadosCaja.size === 0;
  el("btnCobrarEfectivoCajaIndividual").disabled = asientosSeleccionadosCaja.size === 0;
}

function armarSeleccionesPorFilaCaja() {
  const porFila = new Map();
  asientosSeleccionadosCaja.forEach((a) => {
    if (!porFila.has(a.filaId)) porFila.set(a.filaId, []);
    porFila.get(a.filaId).push(a.numero);
  });
  return Array.from(porFila.entries()).map(([filaId, butacas]) => ({ filaId, butacas }));
}

function validarNombreWhatsappCajaIndividual() {
  const nombre = el("inputNombreCajaIndividual").value.trim();
  const whatsapp = el("inputWhatsappCajaIndividual").value.trim();
  const msg = el("mensajeErrorCajaIndividual");
  msg.textContent = "";
  if (!nombre) {
    msg.textContent = "Escribe el nombre de la persona.";
    return null;
  }
  if (!whatsapp) {
    msg.textContent = "Escribe el WhatsApp de la persona.";
    return null;
  }
  if (!asientosSeleccionadosCaja.size) {
    msg.textContent = "Elige al menos un asiento.";
    return null;
  }
  return { nombre, whatsapp };
}

async function generarLinkCajaIndividual() {
  const btnLink = el("btnGenerarLinkCajaIndividual");
  const btnEfectivo = el("btnCobrarEfectivoCajaIndividual");
  const datosPersona = validarNombreWhatsappCajaIndividual();
  if (!datosPersona) return;

  btnLink.disabled = true;
  btnEfectivo.disabled = true;
  const textoOriginal = btnLink.textContent;
  btnLink.textContent = "Generando link...";
  try {
    const selecciones = armarSeleccionesPorFilaCaja();
    const datos = await llamarWorker({
      accion: "entradasCajaVenderAsientosIndividual",
      clave: claveCaja,
      nombre: datosPersona.nombre,
      whatsapp: datosPersona.whatsapp,
      selecciones,
      formaPago: "Tarjeta",
    });
    el("tituloResultadoCajaIndividual").textContent = "✅ Link de pago generado";
    el("detalleResultadoCajaIndividual").textContent =
      `Total a cobrar: Q${Number(datos.total || 0).toFixed(2)} — el link ya se envió por WhatsApp. También puedes abrirlo aquí.`;
    const linkBtn = el("linkResultadoCajaIndividual");
    linkBtn.href = datos.link;
    linkBtn.hidden = false;
    mostrarPantalla("pantallaResultadoCajaIndividual");
  } catch (e) {
    el("mensajeErrorCajaIndividual").textContent = e.message;
    if (String(e.message || "").toLowerCase().includes("disponible")) {
      asientosSeleccionadosCaja.clear();
      actualizarBarraTotalCajaIndividual();
      cargarMapaAsientosCaja();
    }
  } finally {
    btnLink.disabled = asientosSeleccionadosCaja.size === 0;
    btnEfectivo.disabled = asientosSeleccionadosCaja.size === 0;
    btnLink.textContent = textoOriginal;
  }
}

async function cobrarEfectivoCajaIndividual() {
  const btnLink = el("btnGenerarLinkCajaIndividual");
  const btnEfectivo = el("btnCobrarEfectivoCajaIndividual");
  const datosPersona = validarNombreWhatsappCajaIndividual();
  if (!datosPersona) return;

  const confirmado = window.confirm("¿Confirmas que ya recibiste el efectivo? Los asientos elegidos quedarán marcados como vendidos.");
  if (!confirmado) return;

  btnLink.disabled = true;
  btnEfectivo.disabled = true;
  const textoOriginal = btnEfectivo.textContent;
  btnEfectivo.textContent = "Confirmando...";
  try {
    const selecciones = armarSeleccionesPorFilaCaja();
    const datos = await llamarWorker({
      accion: "entradasCajaVenderAsientosIndividual",
      clave: claveCaja,
      nombre: datosPersona.nombre,
      whatsapp: datosPersona.whatsapp,
      selecciones,
      formaPago: "Efectivo",
    });
    el("tituloResultadoCajaIndividual").textContent = "✅ Pago en efectivo confirmado";
    el("detalleResultadoCajaIndividual").textContent =
      `Total cobrado: Q${Number(datos.total || 0).toFixed(2)} — los asientos ya quedaron marcados como vendidos.`;
    el("linkResultadoCajaIndividual").hidden = true;
    mostrarPantalla("pantallaResultadoCajaIndividual");
  } catch (e) {
    el("mensajeErrorCajaIndividual").textContent = e.message;
    if (String(e.message || "").toLowerCase().includes("disponible")) {
      asientosSeleccionadosCaja.clear();
      actualizarBarraTotalCajaIndividual();
      cargarMapaAsientosCaja();
    }
  } finally {
    btnLink.disabled = asientosSeleccionadosCaja.size === 0;
    btnEfectivo.disabled = asientosSeleccionadosCaja.size === 0;
    btnEfectivo.textContent = textoOriginal;
  }
}

// ==========================================
// EVENTOS
// ==========================================

el("btnEntrarCaja").addEventListener("click", entrarCaja);
el("inputClaveCaja").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarCaja();
});

el("btnBuscarCodigoCaja").addEventListener("click", buscarTurnoCaja);
el("inputCodigoCaja").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarTurnoCaja();
});

el("btnSalirCaja").addEventListener("click", () => {
  claveCaja = "";
  el("inputClaveCaja").value = "";
  mostrarPantalla("pantallaLogin");
});

el("btnVolverDesdeInfo").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));
el("btnVolverComprarCaja").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));
el("btnCobrarFilas").addEventListener("click", cobrarFilasSeleccionadas);
el("btnCobrarEfectivo").addEventListener("click", cobrarEnEfectivo);
el("btnNuevaBusquedaDesdeLink").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));
el("btnNuevaBusquedaDesdeEfectivo").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));

el("btnSalirCajaIndividual").addEventListener("click", () => {
  claveCaja = "";
  el("inputClaveCaja").value = "";
  mostrarPantalla("pantallaLogin");
});
el("btnGenerarLinkCajaIndividual").addEventListener("click", generarLinkCajaIndividual);
el("btnCobrarEfectivoCajaIndividual").addEventListener("click", cobrarEfectivoCajaIndividual);
el("btnNuevaVentaCajaIndividual").addEventListener("click", () => abrirPantallaAsientosCaja());
