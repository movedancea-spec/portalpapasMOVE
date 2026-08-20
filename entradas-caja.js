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

function el(id) {
  return document.getElementById(id);
}

const PANTALLAS = [
  "pantallaLogin",
  "pantallaBuscarCodigo",
  "pantallaTurnoInfo",
  "pantallaComprarCaja",
  "pantallaLinkGenerado",
];

function mostrarPantalla(id) {
  PANTALLAS.forEach((p) => {
    el(p).hidden = p !== id;
  });
  el("barraTotalSeleccionCaja").hidden = id !== "pantallaComprarCaja";
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
    mostrarPantalla("pantallaBuscarCodigo");
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

  (filas || [])
    .sort((a, b) => (a.letra || a.fila || "").localeCompare(b.letra || b.fila || ""))
    .forEach((f) => bloque.appendChild(crearFilaMapa(f)));

  return bloque;
}

function crearFilaMapa(f) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fila-mapa";
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
el("btnNuevaBusquedaDesdeLink").addEventListener("click", () => mostrarPantalla("pantallaBuscarCodigo"));
