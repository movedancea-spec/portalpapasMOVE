// ==========================================
// MOVE — PANEL DE ADMINISTRACIÓN DE ENTRADAS SHOW
// MOVE Dance Academy
// ==========================================
// Pantalla privada (clave propia — CLAVE_ENTRADAS_SHOW, Secret de
// Cloudflare) para que Ana pueda:
//   - Programar o activar de inmediato la apertura del registro.
//   - Pausar/reanudar la venta si hace falta.
//   - Ver en vivo cuántas filas quedan, qué turno está activo, y la
//     lista completa de quién se registró.
//
// La clave se guarda solo en memoria (no en localStorage) — igual
// que recepcion.js — para no dejarla puesta en un dispositivo
// compartido.

// En local (localhost) habla con el Worker de prueba, como recepcion.js.
const WORKER_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : "https://portalalumnas.movedancea.workers.dev";

// Apagado para la venta en vivo del sábado: el botón de borrar estaba
// en cada turno no completado (incluidos los reales ya asignados) y
// con un toque de más se borraba de verdad. Volver a poner en true
// después de la venta si se necesita limpiar registros de prueba.
const PERMITIR_BORRAR_TURNOS = false;

let claveAdmin = "";
let panelActual = null; // último panel cargado, para poder filtrar la lista sin volver a pedirlo
let pollPanelTimer = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaPanel", "pantallaCambiarLugar"].forEach((p) => {
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

// Guatemala es UTC-6 todo el año (no tiene horario de verano), así
// que la conversión es una resta/suma fija de 6 horas. Se hace así
// —a mano, sin depender de la zona horaria del navegador de quien
// use el panel— para no repetir el error de guardar una hora que en
// realidad no correspondía a la hora de Guatemala.

// "YYYY-MM-DDTHH:mm" (como lo da <input type="datetime-local">),
// interpretado como hora de Guatemala -> ISO en UTC.
function guatemalaLocalAUtcIso(valor) {
  if (!valor) return "";
  const [fecha, hora] = valor.split("T");
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [h, m] = (hora || "00:00").split(":").map(Number);
  const utcMs = Date.UTC(anio, mes - 1, dia, h + 6, m, 0);
  return new Date(utcMs).toISOString();
}

// ISO en UTC -> "YYYY-MM-DDTHH:mm" en hora de Guatemala, para
// precargar el <input type="datetime-local">.
function utcIsoAGuatemalaLocal(iso) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - 6 * 60 * 60 * 1000;
  const gt = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${gt.getUTCFullYear()}-${pad(gt.getUTCMonth() + 1)}-${pad(gt.getUTCDate())}T${pad(gt.getUTCHours())}:${pad(gt.getUTCMinutes())}`;
}

// ==========================================
// LOGIN
// ==========================================

async function entrarAdmin() {
  const clave = el("inputClaveAdmin").value.trim();
  const msg = el("mensajeErrorLogin");
  msg.textContent = "";
  if (!clave) {
    msg.textContent = "Escribe la clave.";
    return;
  }

  const btn = el("btnEntrarAdmin");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Entrando...";
  try {
    await llamarWorker({ accion: "entradasAdminEntrar", clave });
    claveAdmin = clave;
    mostrarPantalla("pantallaPanel");
    await cargarPanel();
    iniciarPollPanel();
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// PANEL
// ==========================================

async function cargarPanel() {
  try {
    const datos = await llamarWorker({ accion: "entradasAdminObtenerPanel", clave: claveAdmin });
    panelActual = datos;
    pintarPanel(datos);
  } catch (e) {
    el("mensajeConfig").textContent = e.message;
    el("mensajeConfig").className = "mensaje-form mensaje-form-error";
  }
}

function pintarPanel(datos) {
  const c = datos.config;

  el("tituloEventoPanel").textContent = `🎟️ ${c.evento}${c.fechaShow ? " — " + formatearFechaHora(c.fechaShow) : ""}`;

  // Solo se sobreescribe el checkbox/input si la persona no los está
  // editando en este momento (evita que un refresco automático le
  // borre lo que estaba a punto de guardar).
  if (document.activeElement !== el("chkVentaHabilitada")) {
    el("chkVentaHabilitada").checked = !!c.ventaHabilitada;
  }
  if (document.activeElement !== el("inputHoraApertura")) {
    el("inputHoraApertura").value = utcIsoAGuatemalaLocal(c.horaApertura);
  }
  if (document.activeElement !== el("chkVentaIndividual")) {
    el("chkVentaIndividual").checked = !!c.ventaIndividualHabilitada;
  }
  if (document.activeElement !== el("chkTurnosIniciados")) {
    el("chkTurnosIniciados").checked = !!c.turnosIniciados;
  }

  const registroAbierto =
    c.ventaHabilitada && (!c.horaApertura || new Date() >= new Date(c.horaApertura));
  let textoEstado;
  if (!c.ventaHabilitada) {
    textoEstado = "🔴 Venta pausada — nadie puede registrarse ni comprar ahora mismo.";
  } else if (!registroAbierto) {
    textoEstado = `🟡 Programado — el registro abre el ${formatearFechaHora(c.horaApertura)}.`;
  } else if (!c.turnosIniciados) {
    textoEstado = `🟢 Registro abierto — anotándose, todavía sin llamar turnos. Último turno numerado: #${c.ultimoTurnoAsignado}.`;
  } else {
    textoEstado = `🟢 Registro abierto y turnos en marcha. Último turno numerado: #${c.ultimoTurnoAsignado}.`;
  }
  el("textoEstadoRegistroActual").textContent = textoEstado;

  // Turno activo
  if (datos.turnoActivo) {
    el("tarjetaTurnoActivo").hidden = false;
    el("textoTurnoActivoNumero").textContent = `#${datos.turnoActivo.numero}`;
    const restante = datos.turnoActivo.horaExpira
      ? Math.max(0, Math.round((new Date(datos.turnoActivo.horaExpira).getTime() - Date.now()) / 60000))
      : null;
    el("textoTurnoActivoDetalle").textContent =
      (datos.turnoActivo.whatsapp
        ? `${datos.turnoActivo.nombre} — ${datos.turnoActivo.whatsapp}`
        : datos.turnoActivo.nombre) + (restante != null ? ` (le quedan ~${restante} min)` : "");
  } else {
    el("tarjetaTurnoActivo").hidden = true;
  }

  // Filas
  el("statFilasDisponibles").textContent = datos.conteoFilas.Disponible || 0;
  el("statFilasReservadas").textContent = datos.conteoFilas.Reservada || 0;
  el("statFilasVendidas").textContent = datos.conteoFilas.Vendida || 0;

  // Turnos
  el("statTurnosPendiente").textContent = datos.conteoTurnos["Pendiente"] || 0;
  el("statTurnosEnEspera").textContent = datos.conteoTurnos["En Espera"] || 0;
  el("statTurnosActivo").textContent = datos.conteoTurnos["Activo"] || 0;
  el("statTurnosVencido").textContent = datos.conteoTurnos["Vencido"] || 0;
  el("statTurnosCompletado").textContent = datos.conteoTurnos["Completado"] || 0;
  el("statTurnosCancelado").textContent = datos.conteoTurnos["Cancelado"] || 0;

  el("textoIngresosConfirmados").textContent = `Q${Number(datos.ingresosConfirmados || 0).toFixed(2)}`;
  el("textoDesgloseIngresos").textContent =
    `Por turnos: Q${Number(datos.ingresosPorTurnos || 0).toFixed(2)} · Individual: Q${Number(
      datos.ingresosIndividuales || 0
    ).toFixed(2)}`;

  pintarListaTurnos(datos.turnos || []);
  pintarListaComprasIndividuales(datos.comprasIndividuales || []);
}

const BADGE_POR_ESTADO_INDIVIDUAL = {
  "Reservado": "badge-pendiente",
  "Pagado": "badge-completado",
  "Vencido": "badge-vencido",
  "Cancelado": "badge-cancelado",
  // Pagó, pero sus butacas ya las tenía otra persona — se resuelve a mano.
  "Pagado - conflicto": "badge-vencido",
  // Anulada desde el Panel: sus butacas ya se liberaron.
  "Anulado": "badge-cancelado",
};

function pintarListaComprasIndividuales(compras) {
  el("tarjetaComprasIndividuales").hidden = compras.length === 0;
  if (!compras.length) return;

  const filtro = (el("inputBuscarCompra").value || "").trim().toLowerCase();
  const filtradas = filtro
    ? compras.filter((c) => [c.nombre, c.whatsapp, c.resumen].some((t) => (t || "").toLowerCase().includes(filtro)))
    : compras;
  const cont = el("listaComprasIndividuales");
  cont.innerHTML = "";
  if (!filtradas.length) {
    cont.innerHTML = '<p class="lista-vacia">No hay compras que coincidan.</p>';
    return;
  }
  filtradas.forEach((c) => {
    const fila = document.createElement("div");
    fila.className = "fila-turno-admin";

    const info = document.createElement("div");
    info.className = "fila-turno-admin-info";

    const nombreEl = document.createElement("span");
    nombreEl.className = "fila-turno-admin-nombre";
    nombreEl.textContent = c.nombre || "(sin nombre)";

    const detalleEl = document.createElement("span");
    detalleEl.className = "fila-turno-admin-detalle";
    detalleEl.textContent = (c.resumen || "") + (c.formaPago ? " · " + c.formaPago : "");

    info.appendChild(nombreEl);
    info.appendChild(detalleEl);

    // Solo las pagadas se pueden cambiar o anular (las reservadas vencen solas).
    if (c.estado === "Pagado") {
      const acciones = document.createElement("div");
      acciones.className = "acciones-compra";
      const cambiar = document.createElement("button");
      cambiar.type = "button";
      cambiar.className = "btn-compra";
      cambiar.textContent = "🔄 Cambiar lugar";
      cambiar.addEventListener("click", () => abrirCambiarLugar(c));
      const anular = document.createElement("button");
      anular.type = "button";
      anular.className = "btn-compra btn-compra-anular";
      anular.textContent = "🗑️ Anular entrada";
      anular.addEventListener("click", () => anularCompra(c));
      acciones.append(cambiar, anular);
      info.appendChild(acciones);
    }
    if (c.historial) {
      const historial = document.createElement("span");
      historial.className = "historial-compra";
      historial.textContent = c.historial;
      info.appendChild(historial);
    }

    const der = document.createElement("div");
    der.className = "fila-turno-admin-derecha";

    const total = document.createElement("span");
    total.className = "fila-turno-admin-numero";
    total.textContent = `Q${Number(c.total || 0).toFixed(2)}`;

    const badge = document.createElement("span");
    badge.className = "badge-turno " + (BADGE_POR_ESTADO_INDIVIDUAL[c.estado] || "badge-pendiente");
    badge.textContent = c.estado || "";

    der.appendChild(total);
    der.appendChild(badge);

    fila.appendChild(info);
    fila.appendChild(der);
    cont.appendChild(fila);
  });
}

const BADGE_POR_ESTADO = {
  "Pendiente": "badge-pendiente",
  "En Espera": "badge-en-espera",
  "Activo": "badge-activo",
  "Vencido": "badge-vencido",
  "Completado": "badge-completado",
  "Cancelado": "badge-cancelado",
};

function pintarListaTurnos(turnos) {
  const filtro = (el("inputBuscarTurno").value || "").trim().toLowerCase();
  const cont = el("listaTurnosAdmin");
  cont.innerHTML = "";

  const filtrados = filtro
    ? turnos.filter(
        (t) =>
          (t.nombre || "").toLowerCase().includes(filtro) ||
          (t.whatsapp || "").includes(filtro) ||
          (t.codigo || "").toLowerCase().includes(filtro)
      )
    : turnos;

  if (!filtrados.length) {
    cont.innerHTML = '<p class="lista-vacia">No hay turnos que coincidan.</p>';
    return;
  }

  filtrados.forEach((t) => {
    const fila = document.createElement("div");
    fila.className = "fila-turno-admin";

    const info = document.createElement("div");
    info.className = "fila-turno-admin-info";
    const detalle = [t.whatsapp || "", t.totalPagado ? "Q" + Number(t.totalPagado).toFixed(2) : ""]
      .filter(Boolean)
      .join(" · ");

    const nombreEl = document.createElement("span");
    nombreEl.className = "fila-turno-admin-nombre";
    nombreEl.textContent = t.nombre || "(sin nombre)";

    const detalleEl = document.createElement("span");
    detalleEl.className = "fila-turno-admin-detalle";
    detalleEl.textContent = detalle;

    info.appendChild(nombreEl);
    info.appendChild(detalleEl);

    const der = document.createElement("div");
    der.className = "fila-turno-admin-derecha";

    const numero = document.createElement("span");
    numero.className = "fila-turno-admin-numero";
    numero.textContent = t.numero ? `#${t.numero}` : "—";

    const badge = document.createElement("span");
    badge.className = "badge-turno " + (BADGE_POR_ESTADO[t.estado] || "badge-pendiente");
    badge.textContent = t.estado || "";

    der.appendChild(numero);
    der.appendChild(badge);

    // Borrar turno — completo, uno por uno, con confirmación. No se
    // deja borrar un turno que ya completó su compra (entradas
    // vendidas de verdad), para no perder ese registro por error.
    if (PERMITIR_BORRAR_TURNOS && t.estado !== "Completado") {
      const btnBorrar = document.createElement("button");
      btnBorrar.type = "button";
      btnBorrar.className = "btn-borrar-turno";
      btnBorrar.textContent = "🗑️ Borrar";
      btnBorrar.addEventListener("click", () => borrarTurno(t));
      der.appendChild(btnBorrar);
    }

    fila.appendChild(info);
    fila.appendChild(der);
    cont.appendChild(fila);
  });
}

// ==========================================
// BORRAR TURNO (uno por uno, con confirmación)
// ==========================================

async function borrarTurno(t) {
  const confirmado = window.confirm(
    `¿Borrar por completo el turno${t.numero ? " #" + t.numero : ""} de ${t.nombre || "esta persona"}? Esto no se puede deshacer.`
  );
  if (!confirmado) return;

  try {
    await llamarWorker({ accion: "entradasAdminBorrarTurno", clave: claveAdmin, turnoId: t.id });
    await cargarPanel();
  } catch (e) {
    window.alert(e.message || "No se pudo borrar el turno.");
  }
}

// ==========================================
// SALTAR TURNO ACTIVO (solo Ana — si no se presentó)
// ==========================================

async function saltarTurnoActivo() {
  const btn = el("btnSaltarTurno");
  const msg = el("mensajeSaltarTurno");
  msg.textContent = "";
  msg.className = "mensaje-form";

  const confirmado = window.confirm("¿Saltar el turno activo? Se le avisará al siguiente turno que ya le toca.");
  if (!confirmado) return;

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Saltando...";
  try {
    await llamarWorker({ accion: "entradasAdminSaltarTurno", clave: claveAdmin });
    msg.textContent = "✅ Turno saltado — se avisó al siguiente.";
    msg.className = "mensaje-form mensaje-form-ok";
    await cargarPanel();
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "mensaje-form mensaje-form-error";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// VENTA INDIVIDUAL (apaga el sistema de turnos)
// ==========================================

async function guardarVentaIndividual() {
  const btn = el("btnGuardarVentaIndividual");
  const msg = el("mensajeVentaIndividual");
  msg.textContent = "";
  msg.className = "mensaje-form";

  const activando = el("chkVentaIndividual").checked;
  const yaEstaba = panelActual && panelActual.config && !!panelActual.config.ventaIndividualHabilitada;

  if (activando && !yaEstaba) {
    const confirmado = window.confirm(
      "¿Activar la venta individual? Desde este momento se apaga el sistema de turnos: cualquiera puede entrar directo a elegir sus asientos y pagar, sin turno. Si ya se vendieron asientos sueltos, no se puede volver limpio al modo de fila completa."
    );
    if (!confirmado) return;
  } else if (!activando && yaEstaba) {
    const confirmado = window.confirm(
      "¿Apagar la venta individual? Ojo: si ya se vendieron asientos sueltos dentro de alguna fila, esa fila queda con una mezcla que el sistema de turnos (que vende por fila completa) no sabe manejar bien."
    );
    if (!confirmado) return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";
  try {
    await llamarWorker({
      accion: "entradasAdminActualizarConfig",
      clave: claveAdmin,
      campos: { ventaIndividualHabilitada: activando },
    });
    msg.textContent = "✅ Guardado.";
    msg.className = "mensaje-form mensaje-form-ok";
    await cargarPanel();
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "mensaje-form mensaje-form-error";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// TURNOS INICIADOS (empezar a llamar turnos, separado del registro)
// ==========================================

async function guardarTurnosIniciados() {
  const btn = el("btnGuardarTurnosIniciados");
  const msg = el("mensajeTurnosIniciados");
  msg.textContent = "";
  msg.className = "mensaje-form";

  const activando = el("chkTurnosIniciados").checked;
  const yaEstaba = panelActual && panelActual.config && !!panelActual.config.turnosIniciados;

  if (activando && !yaEstaba) {
    const confirmado = window.confirm(
      "¿Empezar a llamar turnos ahora? En cuanto guardes, se le avisa por el Portal de Alumnas al primer turno en la fila que ya le toca comprar."
    );
    if (!confirmado) return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";
  try {
    await llamarWorker({
      accion: "entradasAdminActualizarConfig",
      clave: claveAdmin,
      campos: { turnosIniciados: activando },
    });
    msg.textContent = "✅ Guardado.";
    msg.className = "mensaje-form mensaje-form-ok";
    await cargarPanel();
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "mensaje-form mensaje-form-error";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function guardarConfig() {
  const btn = el("btnGuardarConfig");
  const msg = el("mensajeConfig");
  msg.textContent = "";
  msg.className = "mensaje-form";

  const campos = {
    ventaHabilitada: el("chkVentaHabilitada").checked,
    horaApertura: guatemalaLocalAUtcIso(el("inputHoraApertura").value),
  };

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";
  try {
    await llamarWorker({ accion: "entradasAdminActualizarConfig", clave: claveAdmin, campos });
    msg.textContent = "✅ Guardado.";
    msg.className = "mensaje-form mensaje-form-ok";
    await cargarPanel();
  } catch (e) {
    msg.textContent = e.message;
    msg.className = "mensaje-form mensaje-form-error";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function iniciarPollPanel() {
  detenerPollPanel();
  pollPanelTimer = setInterval(() => {
    if (!el("pantallaPanel").hidden) cargarPanel();
  }, 20000);
}

function detenerPollPanel() {
  if (pollPanelTimer) {
    clearInterval(pollPanelTimer);
    pollPanelTimer = null;
  }
}


// ==========================================
// CAMBIAR LUGAR / ANULAR (compras por butaca, 2026-11-03)
// ==========================================
// El Worker revisa todo otra vez con el candado de las filas: que las
// butacas nuevas sigan libres, que las viejas sean de la compra y que
// la compra siga "Pagado". El pago no se toca; la diferencia de precio
// solo se avisa.

let compraCambiando = null; // la compra de la pantalla "Cambiar lugar"
let mapaCambio = []; // filas del mapa (entradasAdminMapaAsientos)
const nuevasCambio = new Map(); // "filaId:numero" → { filaId, numero, precio }
let ultimoQuien = ""; // el nombre escrito la última vez (solo en memoria)

const claveButaca = (filaId, numero) => `${filaId}:${numero}`;

function mensajeCompras(texto, tipo) {
  const m = el("mensajeCompras");
  m.textContent = texto;
  m.className = "mensaje-form" + (tipo === "error" ? " mensaje-form-error" : "");
}

async function abrirCambiarLugar(c) {
  compraCambiando = c;
  nuevasCambio.clear();
  mostrarPantalla("pantallaCambiarLugar");
  window.scrollTo(0, 0);
  el("tituloCambiarLugar").textContent = c.nombre || "(sin nombre)";
  el("textoCompraCambiar").textContent = `Ahora: ${c.resumen || "—"} · Pagó Q${Number(c.total || 0).toFixed(2)}${c.formaPago ? " (" + c.formaPago + ")" : ""}`;
  el("avisoEntregadasCambiar").hidden = !c.entregadas;
  el("chkWhatsappCambio").checked = !!c.whatsapp;
  el("chkWhatsappCambio").disabled = !c.whatsapp;
  el("textoWhatsappCambio").textContent = c.whatsapp
    ? `Mandar WhatsApp con el lugar nuevo a ${c.whatsapp}`
    : "Esta compra no tiene WhatsApp: avísale a la familia.";
  el("inputQuienCambio").value = ultimoQuien;
  el("mensajeCambio").textContent = "";
  el("mapaCambiarLugar").innerHTML = '<p class="lista-vacia">Cargando mapa de butacas...</p>';
  el("listaButacasActuales").innerHTML = "";
  try {
    const datos = await llamarWorker({ accion: "entradasAdminMapaAsientos", clave: claveAdmin });
    mapaCambio = datos.filas || [];
  } catch (e) {
    el("mapaCambiarLugar").innerHTML = `<p class="lista-vacia">${e.message}</p>`;
    return;
  }
  pintarButacasActuales();
  pintarMapaCambio();
  actualizarResumenCambio();
}

function filaDelMapa(filaId) {
  return mapaCambio.find((f) => f.id === filaId) || {};
}

// Las butacas de la compra, para marcar cuáles se cambian (todas, de entrada).
function pintarButacasActuales() {
  const cont = el("listaButacasActuales");
  cont.innerHTML = "";
  (compraCambiando.detalle || []).forEach((d) => {
    const f = filaDelMapa(d.filaId);
    d.butacas.forEach((n) => {
      const label = document.createElement("label");
      const caja = document.createElement("input");
      caja.type = "checkbox";
      caja.checked = true;
      caja.dataset.filaId = d.filaId;
      caja.dataset.numero = n;
      caja.addEventListener("change", () => {
        // Si ahora se cambian menos, se sueltan las nuevas que sobran.
        while (nuevasCambio.size > butacasACambiar().length) nuevasCambio.delete([...nuevasCambio.keys()].pop());
        pintarMapaCambio();
        actualizarResumenCambio();
      });
      label.append(caja, ` Fila ${f.fila || "?"} · butaca ${n}`);
      cont.appendChild(label);
    });
  });
}

function butacasACambiar() {
  return [...el("listaButacasActuales").querySelectorAll("input:checked")].map((i) => ({ filaId: i.dataset.filaId, numero: Number(i.dataset.numero) }));
}

function pintarMapaCambio() {
  const cont = el("mapaCambiarLugar");
  cont.innerHTML = "";
  const porSeccion = {};
  mapaCambio.forEach((f) => (porSeccion[f.seccion || "Otra"] = porSeccion[f.seccion || "Otra"] || []).push(f));
  const centro = document.createElement("div");
  centro.className = "mapa-columna-centro";
  const tituloCentro = document.createElement("p");
  tituloCentro.className = "mapa-bloque-titulo";
  tituloCentro.textContent = "CENTRO";
  const grupo = document.createElement("div");
  grupo.className = "mapa-grupo-centro";
  const pasillo = document.createElement("div");
  pasillo.className = "pasillo-central";
  grupo.append(bloqueSeccionCambio("", porSeccion["Centro-Izquierda"]), pasillo, bloqueSeccionCambio("", porSeccion["Centro-Derecha"]));
  centro.append(tituloCentro, grupo);
  cont.append(bloqueSeccionCambio("IZQUIERDA", porSeccion["Izquierda"]), centro, bloqueSeccionCambio("DERECHA", porSeccion["Derecha"]));
}

function bloqueSeccionCambio(titulo, filas) {
  const bloque = document.createElement("div");
  bloque.className = "mapa-bloque";
  if (titulo) {
    const t = document.createElement("p");
    t.className = "mapa-bloque-titulo";
    t.textContent = titulo;
    bloque.appendChild(t);
  }
  (filas || [])
    .slice()
    .sort((a, b) => (a.letra || a.fila || "").localeCompare(b.letra || b.fila || ""))
    .forEach((f) => bloque.appendChild(filaCambio(f, titulo === "IZQUIERDA")));
  return bloque;
}

function filaCambio(f, voltear) {
  const div = document.createElement("div");
  div.className = "fila-mapa-individual" + (voltear ? " volteada" : "");
  const etiqueta = document.createElement("span");
  etiqueta.className = "fila-mapa-etiqueta";
  etiqueta.textContent = f.letra || f.fila || "";
  const asientos = document.createElement("span");
  asientos.className = "fila-mapa-asientos";
  const propias = new Set(
    (compraCambiando.detalle || []).filter((d) => d.filaId === f.id).flatMap((d) => d.butacas)
  );
  (f.butacas || []).forEach((b) => {
    const clave = claveButaca(f.id, b.numero);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "asiento-btn";
    btn.textContent = b.numero;
    btn.title = `Fila ${f.fila} — butaca ${b.numero} — Q${Number(f.precioPorButaca || 0).toFixed(2)}`;
    btn.setAttribute("aria-label", btn.title);
    if (propias.has(b.numero)) {
      btn.classList.add("actual");
      btn.disabled = true;
      btn.title += " (su lugar de ahora)";
    } else if (b.estado !== "Disponible") {
      btn.disabled = true;
    } else {
      btn.classList.toggle("seleccionado", nuevasCambio.has(clave));
      btn.addEventListener("click", () => {
        if (nuevasCambio.has(clave)) nuevasCambio.delete(clave);
        else if (nuevasCambio.size < butacasACambiar().length) nuevasCambio.set(clave, { filaId: f.id, numero: b.numero, precio: f.precioPorButaca || 0 });
        else {
          el("mensajeCambio").textContent = `Ya elegiste ${nuevasCambio.size}: quita una para elegir otra.`;
          return;
        }
        el("mensajeCambio").textContent = "";
        btn.classList.toggle("seleccionado", nuevasCambio.has(clave));
        actualizarResumenCambio();
      });
    }
    asientos.appendChild(btn);
  });
  div.append(etiqueta, asientos);
  return div;
}

const textoButacas = (lista) =>
  lista
    .map((x) => `Fila ${filaDelMapa(x.filaId).fila || "?"} ${x.numero}`)
    .join(", ");

function actualizarResumenCambio() {
  const viejas = butacasACambiar();
  const nuevas = [...nuevasCambio.values()];
  const faltan = viejas.length - nuevas.length;
  el("textoCuantasNuevas").textContent = viejas.length === 1 ? "la butaca nueva" : `las ${viejas.length} butacas nuevas`;
  const precioDe = (lista) => lista.reduce((s, x) => s + Number(filaDelMapa(x.filaId).precioPorButaca || 0), 0);
  const diferencia = Math.round((precioDe(nuevas) - precioDe(viejas)) * 100) / 100;
  let texto = !viejas.length ? "Marca arriba qué butacas se cambian." : `Se cambia: ${textoButacas(viejas)}`;
  if (viejas.length) texto += nuevas.length ? `\nPor: ${textoButacas(nuevas)}` : "";
  if (viejas.length && faltan > 0) texto += `\nFalta elegir ${faltan} en el mapa.`;
  if (viejas.length && !faltan) {
    texto += diferencia > 0
      ? `\n⚠️ El lugar nuevo cuesta Q${diferencia.toFixed(2)} más: cóbralo a mano (el pago no cambia).`
      : diferencia < 0
        ? `\n⚠️ El lugar nuevo cuesta Q${(-diferencia).toFixed(2)} menos: saldo a favor de la familia, a mano.`
        : "\nMismo precio.";
  }
  el("resumenCambio").textContent = texto;
  el("btnConfirmarCambio").disabled = !viejas.length || faltan !== 0;
}

const agruparPorFila = (lista) => {
  const m = new Map();
  lista.forEach((x) => (m.get(x.filaId) || m.set(x.filaId, []).get(x.filaId)).push(x.numero));
  return [...m.entries()].map(([filaId, butacas]) => ({ filaId, butacas }));
};

async function confirmarCambioLugar() {
  const quien = el("inputQuienCambio").value.trim();
  if (!quien) {
    el("mensajeCambio").textContent = "Escribe tu nombre (queda en el historial).";
    return;
  }
  const viejas = butacasACambiar();
  const nuevas = [...nuevasCambio.values()];
  if (!window.confirm(`¿Cambiar el lugar de ${compraCambiando.nombre}?\n\n${textoButacas(viejas)}\n→ ${textoButacas(nuevas)}`)) return;
  const btn = el("btnConfirmarCambio");
  btn.disabled = true;
  el("mensajeCambio").textContent = "Cambiando...";
  try {
    const r = await llamarWorker({
      accion: "entradasAdminCambiarLugar",
      clave: claveAdmin,
      compraId: compraCambiando.id,
      quitar: agruparPorFila(viejas),
      nuevas: agruparPorFila(nuevas.map((x) => ({ filaId: x.filaId, numero: x.numero }))),
      quien,
      mandarWhatsapp: el("chkWhatsappCambio").checked,
    });
    ultimoQuien = quien;
    const wa = r.whatsapp === "enviado" ? " WhatsApp enviado." : "";
    mensajeCompras(`✅ ${compraCambiando.nombre}: ${r.de} → ${r.a}.${wa}${(r.avisos || []).map((a) => " ⚠️ " + a).join("")}`, (r.avisos || []).length ? "error" : "ok");
    compraCambiando = null;
    mostrarPantalla("pantallaPanel");
    await cargarPanel();
    el("mensajeCompras").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    // Lo más común: alguien compró esa butaca mientras tanto. Se vuelve a
    // cargar el mapa para que se vea ocupada.
    el("mensajeCambio").textContent = e.message;
    try {
      mapaCambio = (await llamarWorker({ accion: "entradasAdminMapaAsientos", clave: claveAdmin })).filas || [];
      [...nuevasCambio.entries()].forEach(([k, x]) => {
        const b = (filaDelMapa(x.filaId).butacas || []).find((y) => y.numero === x.numero);
        if (!b || b.estado !== "Disponible") nuevasCambio.delete(k);
      });
      pintarMapaCambio();
      actualizarResumenCambio();
    } catch (e2) {}
  } finally {
    btn.disabled = !(butacasACambiar().length && butacasACambiar().length === nuevasCambio.size);
  }
}

async function anularCompra(c) {
  const quien = window.prompt(`Anular la entrada de ${c.nombre} (${c.resumen}).\n\nSus butacas quedan libres y la compra queda «Anulado» (no se borra). Si hay que devolver dinero, se hace a mano.\n\nEscribe tu nombre para confirmar:`, ultimoQuien);
  if (quien === null) return;
  if (!quien.trim()) {
    mensajeCompras("Escribe tu nombre para anular (queda en el historial).", "error");
    return;
  }
  if (!window.confirm(`¿Seguro? Se anula la compra de ${c.nombre} y se liberan: ${c.resumen}.`)) return;
  try {
    const r = await llamarWorker({ accion: "entradasAdminAnularCompra", clave: claveAdmin, compraId: c.id, quien: quien.trim() });
    ultimoQuien = quien.trim();
    mensajeCompras(`✅ Compra de ${c.nombre} anulada; quedó libre: ${r.liberadas}.${(r.avisos || []).map((a) => " ⚠️ " + a).join("")}`, "error");
    await cargarPanel();
  } catch (e) {
    mensajeCompras(e.message, "error");
  }
}

// ==========================================
// EVENTOS
// ==========================================

el("btnEntrarAdmin").addEventListener("click", entrarAdmin);
el("inputClaveAdmin").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarAdmin();
});

el("btnActualizarPanel").addEventListener("click", cargarPanel);
el("btnGuardarConfig").addEventListener("click", guardarConfig);
el("btnSaltarTurno").addEventListener("click", saltarTurnoActivo);
el("btnGuardarVentaIndividual").addEventListener("click", guardarVentaIndividual);
el("btnGuardarTurnosIniciados").addEventListener("click", guardarTurnosIniciados);
el("inputBuscarTurno").addEventListener("input", () => {
  if (panelActual) pintarListaTurnos(panelActual.turnos || []);
});

el("inputBuscarCompra").addEventListener("input", () => {
  if (panelActual) pintarListaComprasIndividuales(panelActual.comprasIndividuales || []);
});
el("btnVolverCambiarLugar").addEventListener("click", () => {
  compraCambiando = null;
  mostrarPantalla("pantallaPanel");
});
el("btnConfirmarCambio").addEventListener("click", confirmarCambioLugar);

el("btnSalirAdmin").addEventListener("click", () => {
  detenerPollPanel();
  claveAdmin = "";
  panelActual = null;
  el("inputClaveAdmin").value = "";
  mostrarPantalla("pantallaLogin");
});
