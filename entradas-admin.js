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

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let claveAdmin = "";
let panelActual = null; // último panel cargado, para poder filtrar la lista sin volver a pedirlo
let pollPanelTimer = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaPanel"].forEach((p) => {
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
};

function pintarListaComprasIndividuales(compras) {
  el("tarjetaComprasIndividuales").hidden = compras.length === 0;
  if (!compras.length) return;

  const cont = el("listaComprasIndividuales");
  cont.innerHTML = "";
  compras.forEach((c) => {
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
        (t) => (t.nombre || "").toLowerCase().includes(filtro) || (t.whatsapp || "").includes(filtro)
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
    if (t.estado !== "Completado") {
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

el("btnSalirAdmin").addEventListener("click", () => {
  detenerPollPanel();
  claveAdmin = "";
  panelActual = null;
  el("inputClaveAdmin").value = "";
  mostrarPantalla("pantallaLogin");
});
