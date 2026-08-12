// ==========================================
// MOVE — RECEPCIÓN
// MOVE Dance Academy
// ==========================================
// Pantalla para dejar abierta en la tablet/computadora de Recepción.
// Desde el menú, la recepcionista puede entrar a:
//   - Solicitudes de clases (chat + alarma con las maestras)
//   - Alumnas (buscar/editar, o inscribir una alumna nueva)
//   - Ingresos diarios (registrar y revisar los ingresos del día)
//   - Pagos (buscar el pago de mensualidad de una alumna y editarlo)
//
// Todo pasa por el mismo Worker de Cloudflare (mismo formato
// { accion, ... } que ya usa el resto de esta app) y exige la misma
// CLAVE_RECEPCION (Secret de Cloudflare) que ya usaba esta pantalla.
//
// El chat de solicitudes sigue revisándose en segundo plano (cada
// pocos segundos) sin importar en qué sección esté la recepcionista,
// para que la alarma siga sonando aunque esté en otra pantalla — el
// botón "Solicitudes" del menú muestra un punto 🔴 si hay algo
// pendiente.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const TAMANO_MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB, igual que el portal de alumnas.

let claveRecepcion = "";
let mensajesActuales = [];
let pollIntervalo = null;
let alarmaIntervalo = null;
let audioCtx = null;

function el(id) {
  return document.getElementById(id);
}

const PANTALLAS = [
  "pantallaLogin",
  "pantallaMenu",
  "pantallaRecepcion",
  "pantallaAlumnas",
  "pantallaIngresos",
  "pantallaPagos",
];

function mostrarPantalla(id) {
  PANTALLAS.forEach((p) => {
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

function leerArchivoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      const resultado = lector.result || "";
      const partes = resultado.split(",");
      resolve(partes[1] || "");
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}

// Fecha de HOY en la zona horaria de Guatemala, en formato YYYY-MM-DD
// (el truco del locale "sv-SE" es que ese formato ya viene así).
function fechaHoyGuatemala() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

function poblarSelectSimple(id, opciones, incluirVacio) {
  const select = el(id);
  select.innerHTML = "";
  if (incluirVacio) {
    const vacio = document.createElement("option");
    vacio.value = "";
    vacio.textContent = "— Elegir —";
    select.appendChild(vacio);
  }
  opciones.forEach((texto) => {
    const opcion = document.createElement("option");
    opcion.value = texto;
    opcion.textContent = texto;
    select.appendChild(opcion);
  });
}

// ---------- audio: mismo patrón de alarma que el Panel de Clase ----------

function asegurarAudioCtx() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  } catch (e) {
    // Si el navegador no soporta Web Audio, sencillamente no habrá sonido.
  }
  return audioCtx;
}

// Se necesita un gesto del usuario (tocar/hacer clic) para poder
// activar el audio — no importa en qué sección esté, la alarma debe
// poder sonar desde cualquier pantalla una vez adentro.
document.addEventListener(
  "pointerdown",
  () => {
    if (claveRecepcion) asegurarAudioCtx();
  },
  { passive: true }
);

function sonarBeep() {
  try {
    const ctx = asegurarAudioCtx();
    if (!ctx) return;
    [0, 0.18, 0.36].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = i === 2 ? 1046 : 880;

      const inicio = ctx.currentTime + delay;
      const fin = inicio + 0.15;
      gain.gain.setValueAtTime(0, inicio);
      gain.gain.linearRampToValueAtTime(0.85, inicio + 0.015);
      gain.gain.setValueAtTime(0.85, fin - 0.02);
      gain.gain.linearRampToValueAtTime(0, fin);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(inicio);
      osc.stop(fin);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (e) {
    // Si el navegador bloquea el audio, no pasa nada.
  }
}

function iniciarAlarma() {
  el("btnApagarAlarmaGeneral").hidden = false;
  if (alarmaIntervalo) return; // ya está sonando
  sonarBeep();
  alarmaIntervalo = setInterval(sonarBeep, 3500);
}

function detenerAlarma() {
  if (alarmaIntervalo) {
    clearInterval(alarmaIntervalo);
    alarmaIntervalo = null;
  }
  el("btnApagarAlarmaGeneral").hidden = true;
}

el("btnApagarAlarmaGeneral").addEventListener("click", () => {
  // El botón general solo "recuerda" que hay que atender cada
  // tarjeta — la alarma de verdad se apaga sola en cuanto ya no
  // quede ninguna solicitud pendiente (ver actualizarSolicitudes).
  asegurarAudioCtx();
  sonarBeep();
});

// ---------- login ----------

el("btnEntrarRecepcion").addEventListener("click", entrarRecepcion);
el("inputClaveRecepcion").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarRecepcion();
});

async function entrarRecepcion() {
  const clave = el("inputClaveRecepcion").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  mensajeError.textContent = "";

  if (!clave) {
    mensajeError.textContent = "Escribe la clave.";
    return;
  }

  const boton = el("btnEntrarRecepcion");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Entrando...";

  try {
    await llamarWorker({ accion: "recepcionEntrar", clave });
    claveRecepcion = clave;
    el("inputClaveRecepcion").value = "";
    mostrarPantalla("pantallaMenu");
    iniciarAutoRefresco();
    cargarMensajes();
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ---------- recuperar clave (una sola, compartida — se manda por WhatsApp a un número fijo) ----------

el("btnMostrarRecuperarRecepcion").addEventListener("click", () => {
  el("bloqueRecuperarRecepcion").hidden = !el("bloqueRecuperarRecepcion").hidden;
  el("mensajeRecuperarRecepcion").hidden = true;
});

el("btnEnviarRecuperarRecepcion").addEventListener("click", async () => {
  const boton = el("btnEnviarRecuperarRecepcion");
  const mensajeEl = el("mensajeRecuperarRecepcion");
  mensajeEl.hidden = true;

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Enviando...";

  try {
    const datos = await llamarWorker({ accion: "recepcionRecuperarClave" });
    mensajeEl.textContent = `✅ Se envió la clave por WhatsApp al número terminando en ${datos.ultimosDigitos}.`;
    mensajeEl.hidden = false;
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

// ---------- menú ----------

el("btnMenuSolicitudes").addEventListener("click", () => mostrarPantalla("pantallaRecepcion"));

el("btnMenuAlumnas").addEventListener("click", () => {
  mostrarPantalla("pantallaAlumnas");
  el("vistaAlumnaFormulario").hidden = true;
  el("vistaAlumnasBuscar").hidden = false;
});

el("btnMenuIngresos").addEventListener("click", () => {
  mostrarPantalla("pantallaIngresos");
  inicializarIngresos();
});

el("btnMenuPagos").addEventListener("click", () => {
  mostrarPantalla("pantallaPagos");
  el("vistaPagoFormulario").hidden = true;
  el("vistaPagosBuscar").hidden = false;
  inicializarPagos();
});

el("btnVolverSolicitudes").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverAlumnas").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverIngresos").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverPagos").addEventListener("click", () => mostrarPantalla("pantallaMenu"));

el("btnSalirMenu").addEventListener("click", () => {
  detenerAutoRefresco();
  detenerAlarma();
  claveRecepcion = "";
  mensajesActuales = [];
  datosApoyo = null;
  mostrarPantalla("pantallaLogin");
});

// ---------- solicitudes ----------

async function cargarMensajes() {
  if (!claveRecepcion) return;
  try {
    const datos = await llamarWorker({ accion: "obtenerMensajesRecepcionTodos", clave: claveRecepcion });
    mensajesActuales = datos.mensajes || [];
    renderSolicitudes();
  } catch (e) {
    // Si la clave dejó de ser válida (se cambió el Secret), regresa al login.
    if (/clave/i.test(e.message)) {
      detenerAutoRefresco();
      detenerAlarma();
      claveRecepcion = "";
      mostrarPantalla("pantallaLogin");
      el("mensajeErrorLogin").textContent = e.message;
    }
  }
}

function formatearHora(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-GT", {
      timeZone: "America/Guatemala",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

// Agrupa todos los mensajes de hoy por grupo (clase), para mostrar
// un hilo de conversación por clase — así Recepción puede leer el
// pedido Y contestarlo ahí mismo, en vez de solo marcarlo como
// atendido.
function agruparPorGrupo() {
  const hilos = new Map();
  mensajesActuales.forEach((m) => {
    const clave = m.grupoId || m.grupo || "sin-grupo";
    if (!hilos.has(clave)) {
      hilos.set(clave, { grupoId: m.grupoId, grupo: m.grupo || "Sin grupo", mensajes: [] });
    }
    hilos.get(clave).mensajes.push(m);
  });

  const lista = Array.from(hilos.values()).map((hilo) => {
    hilo.mensajes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    hilo.pendiente = hilo.mensajes.some((m) => m.autor === "Maestra" && !m.atendido);
    hilo.ultimaFecha = hilo.mensajes.length ? hilo.mensajes[hilo.mensajes.length - 1].fecha : null;
    return hilo;
  });

  // Los hilos pendientes primero (el más antiguo pendiente arriba,
  // para atenderlo en orden de llegada), y después los ya atendidos,
  // del más reciente al más viejo.
  const pendientes = lista
    .filter((h) => h.pendiente)
    .sort((a, b) => new Date(a.ultimaFecha) - new Date(b.ultimaFecha));
  const atendidos = lista
    .filter((h) => !h.pendiente)
    .sort((a, b) => new Date(b.ultimaFecha) - new Date(a.ultimaFecha));

  return pendientes.concat(atendidos);
}

function renderSolicitudes() {
  const hilos = agruparPorGrupo();
  const cont = el("listaHilos");
  cont.innerHTML = "";

  if (!hilos.length) {
    cont.innerHTML = '<p class="lista-vacia">No hay mensajes de clases hoy todavía. 🎉</p>';
  } else {
    hilos.forEach((hilo) => cont.appendChild(crearTarjetaHilo(hilo)));
  }

  const hayPendientes = hilos.some((h) => h.pendiente);
  el("alertaMenuSolicitudes").hidden = !hayPendientes;
  if (hayPendientes) {
    iniciarAlarma();
  } else {
    detenerAlarma();
  }
}

function crearTarjetaHilo(hilo) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "tarjeta-hilo " + (hilo.pendiente ? "pendiente" : "atendida");

  const header = document.createElement("div");
  header.className = "tarjeta-hilo-header";

  const grupo = document.createElement("span");
  grupo.className = "tarjeta-hilo-grupo";
  grupo.textContent = "🩰 " + hilo.grupo;
  header.appendChild(grupo);

  const etiqueta = document.createElement("span");
  etiqueta.className = hilo.pendiente ? "etiqueta-pendiente" : "etiqueta-atendida";
  etiqueta.textContent = hilo.pendiente ? "🔴 Pendiente" : "✅ Atendido";
  header.appendChild(etiqueta);

  tarjeta.appendChild(header);

  const chat = document.createElement("div");
  chat.className = "chat-mensajes-hilo";
  hilo.mensajes.forEach((m) => chat.appendChild(crearBurbuja(m)));
  tarjeta.appendChild(chat);

  // Sin GRUPO ID no se puede contestar ni marcar como atendido con
  // certeza (mensajes muy viejos, de antes de este campo) — en ese
  // caso solo se muestra el hilo, de lectura.
  if (hilo.grupoId) {
    const caja = document.createElement("div");
    caja.className = "chat-caja-hilo";

    const input = document.createElement("textarea");
    input.className = "chat-input-hilo";
    input.rows = 1;
    input.placeholder = "Responder a esta clase...";
    caja.appendChild(input);

    const btnEnviar = document.createElement("button");
    btnEnviar.className = "chat-btn-enviar-hilo";
    btnEnviar.type = "button";
    btnEnviar.textContent = "➤";
    btnEnviar.addEventListener("click", () => enviarRespuesta(hilo, input, btnEnviar));
    caja.appendChild(btnEnviar);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        enviarRespuesta(hilo, input, btnEnviar);
      }
    });

    tarjeta.appendChild(caja);

    if (hilo.pendiente) {
      const btnAtender = document.createElement("button");
      btnAtender.className = "btn-atender";
      btnAtender.type = "button";
      btnAtender.textContent = "✅ Marcar como atendido (sin responder)";
      btnAtender.addEventListener("click", () => marcarHiloAtendido(hilo, btnAtender));
      tarjeta.appendChild(btnAtender);
    }
  }

  return tarjeta;
}

function crearBurbuja(m) {
  const esMaestra = m.autor === "Maestra";
  const fila = document.createElement("div");
  fila.className = "chat-fila " + (esMaestra ? "chat-fila-maestra" : "chat-fila-recepcion");

  const burbuja = document.createElement("div");
  burbuja.className = "chat-burbuja " + (esMaestra ? "chat-burbuja-maestra" : "chat-burbuja-recepcion");

  const autor = document.createElement("div");
  autor.className = "chat-autor";
  autor.textContent = esMaestra ? "🩰 Maestra" : "🏢 Recepción";
  burbuja.appendChild(autor);

  const texto = document.createElement("div");
  texto.className = "chat-texto";
  texto.textContent = m.mensaje;
  burbuja.appendChild(texto);

  const hora = document.createElement("div");
  hora.className = "chat-hora";
  hora.textContent = formatearHora(m.fecha);
  burbuja.appendChild(hora);

  fila.appendChild(burbuja);
  return fila;
}

// Contestar un hilo también marca como atendidos los pedidos
// pendientes de esa misma clase (lo resuelve el Worker), así la
// alarma se apaga en cuanto Recepción responde.
async function enviarRespuesta(hilo, input, boton) {
  const texto = input.value.trim();
  if (!texto) return;

  boton.disabled = true;
  input.disabled = true;
  try {
    await llamarWorker({
      accion: "enviarMensajeRecepcion",
      grupoId: hilo.grupoId,
      grupoNombre: hilo.grupo,
      mensaje: texto,
      autor: "Recepcion",
      clave: claveRecepcion,
    });
    input.value = "";
    await cargarMensajes();
  } catch (e) {
    alert(e.message);
  } finally {
    boton.disabled = false;
    input.disabled = false;
  }
}

async function marcarHiloAtendido(hilo, boton) {
  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    await llamarWorker({ accion: "marcarGrupoRecepcionAtendido", grupoId: hilo.grupoId, clave: claveRecepcion });
    await cargarMensajes();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = "✅ Marcar como atendido (sin responder)";
  }
}

el("btnActualizarRecepcion").addEventListener("click", cargarMensajes);

function iniciarAutoRefresco() {
  if (pollIntervalo) clearInterval(pollIntervalo);
  pollIntervalo = setInterval(cargarMensajes, 8000);
}

function detenerAutoRefresco() {
  if (pollIntervalo) {
    clearInterval(pollIntervalo);
    pollIntervalo = null;
  }
}

// ==========================================
// ALUMNAS
// ==========================================

let datosApoyo = null; // { grupos:[{id,nombre}], maestras:[{id,nombre}] } — se carga una sola vez
let alumnaEditandoId = null; // null = se está creando una alumna nueva
let archivoFotoAlumna = null;

const OPCIONES_ESTADO_ALUMNA = ["ACTIVA", "INACTIVA"];
const OPCIONES_AUTORIZO_SHOW = ["SI", "NO"];
const OPCIONES_CLASE = [
  "LITTLE MOVERS", "MINI MOVERS", "MOVERS TEAM", "TEENS", "TEENS INT",
  "CONTEMPO", "BALLROOM", "BALLET PRIMARY", "BALLET 2", "BALLET 4",
  "BALLET ADULTOS", "PUNTAS", "ELEVE", "HIP HOP MINI", "ACRO MINI",
  "ACRO 2", "COREOGRAFIA", "SALSA", "BACHATA",
];

// La configuración de todo el formulario de alumna vive en un solo
// lugar — así se arma igual tanto para "Nueva alumna" como para
// "Editar alumna", y coincide 1 a 1 con la lista blanca de campos
// editables que ya tiene el Worker (CAMPOS_EDITABLES_ALUMNA).
const CAMPOS_ALUMNA = [
  { key: "nombre", label: "Nombre completo", tipo: "texto", requerido: true },
  { key: "estado", label: "Estado", tipo: "select", opciones: OPCIONES_ESTADO_ALUMNA, soloEdicion: true },
  { key: "edad", label: "Edad", tipo: "texto", requerido: true },
  { key: "cumpleanos", label: "Fecha de cumpleaños", tipo: "fecha", requerido: true },
  { key: "whatsapp", label: "WhatsApp de la alumna", tipo: "texto", requerido: true },
  { key: "nombrePadre", label: "Nombre de un padre/encargado", tipo: "texto" },
  { key: "whatsappMama", label: "WhatsApp de mamá/encargada", tipo: "texto" },
  { key: "correo", label: "Correo", tipo: "email" },
  { key: "nit", label: "NIT", tipo: "texto" },
  { key: "contactoEmergencia", label: "Contacto de emergencia", tipo: "texto", requerido: true },
  { key: "numeroEmergencia", label: "Número de contacto de emergencia", tipo: "texto", requerido: true },
  { key: "condicionMedica", label: "Condición médica o alergias", tipo: "textarea" },
  { key: "horario", label: "Horario", tipo: "texto" },
  { key: "mensualidad", label: "Mensualidad (Q)", tipo: "numero" },
  { key: "clasesMes", label: "Clases al mes", tipo: "numero" },
  { key: "clase", label: "Clase(s)", tipo: "chips", opciones: OPCIONES_CLASE },
  { key: "grupoIds", label: "Grupo(s) asignado(s)", tipo: "checklistGrupos" },
  { key: "maestraIds", label: "Maestra(s)", tipo: "checklistMaestras" },
  { key: "aceptoShow", label: "Autorizó participar en el show de fin de año", tipo: "select", opciones: OPCIONES_AUTORIZO_SHOW },
  { key: "observaciones", label: "Observaciones", tipo: "textarea" },
];

async function asegurarDatosApoyo() {
  if (datosApoyo) return datosApoyo;
  const datos = await llamarWorker({ accion: "recepcionDatosApoyo", clave: claveRecepcion });
  datosApoyo = { grupos: datos.grupos || [], maestras: datos.maestras || [] };
  return datosApoyo;
}

function crearControlAlumna(cfg, valor) {
  const wrap = document.createElement("div");
  wrap.className = "campo-form";

  const label = document.createElement("p");
  label.className = "etiqueta-campo";
  label.textContent = cfg.label + (cfg.requerido ? " *" : "");
  wrap.appendChild(label);

  const idControl = "campoAlumna_" + cfg.key;

  if (cfg.tipo === "texto" || cfg.tipo === "numero" || cfg.tipo === "fecha" || cfg.tipo === "email") {
    const input = document.createElement("input");
    input.type = cfg.tipo === "numero" ? "number" : cfg.tipo === "fecha" ? "date" : cfg.tipo === "email" ? "email" : "text";
    input.className = "input-texto";
    input.id = idControl;
    if (cfg.tipo === "numero") input.step = "0.01";
    if (valor !== undefined && valor !== null) input.value = valor;
    wrap.appendChild(input);
  } else if (cfg.tipo === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.className = "input-textarea";
    textarea.rows = 2;
    textarea.id = idControl;
    textarea.value = valor || "";
    wrap.appendChild(textarea);
  } else if (cfg.tipo === "select") {
    const select = document.createElement("select");
    select.className = "input-select";
    select.id = idControl;
    const opcionVacia = document.createElement("option");
    opcionVacia.value = "";
    opcionVacia.textContent = "— Sin elegir —";
    select.appendChild(opcionVacia);
    cfg.opciones.forEach((op) => {
      const o = document.createElement("option");
      o.value = op;
      o.textContent = op;
      select.appendChild(o);
    });
    select.value = valor || "";
    wrap.appendChild(select);
  } else if (cfg.tipo === "chips") {
    const cont = document.createElement("div");
    cont.className = "chips-contenedor";
    cont.id = idControl;
    const seleccionados = Array.isArray(valor) ? valor : [];
    cfg.opciones.forEach((op) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (seleccionados.includes(op) ? " activo" : "");
      chip.textContent = op;
      chip.dataset.valor = op;
      chip.addEventListener("click", () => chip.classList.toggle("activo"));
      cont.appendChild(chip);
    });
    wrap.appendChild(cont);
  } else if (cfg.tipo === "checklistGrupos" || cfg.tipo === "checklistMaestras") {
    const lista = cfg.tipo === "checklistGrupos" ? (datosApoyo && datosApoyo.grupos) || [] : (datosApoyo && datosApoyo.maestras) || [];
    const cont = document.createElement("div");
    cont.className = "checklist-contenedor";
    cont.id = idControl;
    const seleccionados = Array.isArray(valor) ? valor : [];
    if (!lista.length) {
      const vacio = document.createElement("p");
      vacio.className = "lista-vacia";
      vacio.textContent = "No hay opciones disponibles todavía.";
      cont.appendChild(vacio);
    }
    lista.forEach((item) => {
      const opcion = document.createElement("label");
      opcion.className = "opcion-checkbox opcion-checklist";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.id;
      input.checked = seleccionados.includes(item.id);
      const span = document.createElement("span");
      span.textContent = item.nombre;
      opcion.appendChild(input);
      opcion.appendChild(span);
      cont.appendChild(opcion);
    });
    wrap.appendChild(cont);
  }

  return wrap;
}

function renderFormularioAlumna(valores, modoEdicion) {
  const cont = el("camposAlumna");
  cont.innerHTML = "";
  CAMPOS_ALUMNA.forEach((cfg) => {
    if (cfg.soloEdicion && !modoEdicion) return;
    cont.appendChild(crearControlAlumna(cfg, valores ? valores[cfg.key] : undefined));
  });
  el("bloqueAceptoPoliticas").hidden = modoEdicion;
  el("chkAceptoPoliticas").checked = false;
}

function leerControlAlumna(cfg) {
  const control = el("campoAlumna_" + cfg.key);
  if (!control) return undefined;
  if (cfg.tipo === "chips") {
    return Array.from(control.querySelectorAll(".chip.activo")).map((c) => c.dataset.valor);
  }
  if (cfg.tipo === "checklistGrupos" || cfg.tipo === "checklistMaestras") {
    return Array.from(control.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
  }
  if (cfg.tipo === "numero") {
    return control.value === "" ? null : Number(control.value);
  }
  return control.value.trim ? control.value.trim() : control.value;
}

function recolectarValoresAlumna(modoEdicion) {
  const valores = {};
  CAMPOS_ALUMNA.forEach((cfg) => {
    if (cfg.soloEdicion && !modoEdicion) return;
    valores[cfg.key] = leerControlAlumna(cfg);
  });
  return valores;
}

el("inputBuscarAlumna").addEventListener("input", () => {
  clearTimeout(el("inputBuscarAlumna")._temporizador);
  el("inputBuscarAlumna")._temporizador = setTimeout(buscarAlumnas, 350);
});

async function buscarAlumnas() {
  const texto = el("inputBuscarAlumna").value.trim();
  const cont = el("listaAlumnas");
  if (texto.length < 2) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML = '<p class="lista-vacia">Buscando...</p>';
  try {
    const datos = await llamarWorker({ accion: "recepcionBuscarAlumnas", clave: claveRecepcion, query: texto });
    renderListaAlumnas(datos.alumnas || []);
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderListaAlumnas(alumnas) {
  const cont = el("listaAlumnas");
  cont.innerHTML = "";
  if (!alumnas.length) {
    cont.innerHTML = '<p class="lista-vacia">No se encontraron alumnas con ese nombre.</p>';
    return;
  }
  alumnas.forEach((a) => {
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado";
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${a.nombre}</span>
      <span class="tarjeta-resultado-detalle">${a.estado || "—"}${a.grupos ? " · " + a.grupos : ""}</span>
    `;
    tarjeta.addEventListener("click", () => abrirAlumna(a.id));
    cont.appendChild(tarjeta);
  });
}

async function abrirAlumna(id) {
  el("mensajeAlumnaForm").textContent = "";
  el("mensajeAlumnaForm").className = "mensaje-form";
  try {
    await asegurarDatosApoyo();
    const datos = await llamarWorker({ accion: "recepcionObtenerAlumna", clave: claveRecepcion, alumnaId: id });
    alumnaEditandoId = id;
    archivoFotoAlumna = null;
    el("tituloFormAlumna").textContent = "Editar: " + (datos.alumna.nombre || "");
    renderFormularioAlumna(datos.alumna, true);

    const preview = el("previewFotoAlumna");
    if (datos.alumna.fotoUrl) {
      preview.src = datos.alumna.fotoUrl;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }

    el("vistaAlumnasBuscar").hidden = true;
    el("vistaAlumnaFormulario").hidden = false;
  } catch (e) {
    alert(e.message);
  }
}

async function abrirNuevaAlumna() {
  try {
    await asegurarDatosApoyo();
  } catch (e) {
    alert(e.message);
  }
  alumnaEditandoId = null;
  archivoFotoAlumna = null;
  el("tituloFormAlumna").textContent = "Nueva alumna";
  el("mensajeAlumnaForm").textContent = "";
  el("mensajeAlumnaForm").className = "mensaje-form";
  renderFormularioAlumna({}, false);
  el("previewFotoAlumna").hidden = true;
  el("inputFotoAlumna").value = "";
  el("vistaAlumnasBuscar").hidden = true;
  el("vistaAlumnaFormulario").hidden = false;
}

el("btnNuevaAlumna").addEventListener("click", abrirNuevaAlumna);

el("btnCancelarAlumna").addEventListener("click", () => {
  el("vistaAlumnaFormulario").hidden = true;
  el("vistaAlumnasBuscar").hidden = false;
});

el("inputFotoAlumna").addEventListener("change", () => {
  const archivo = el("inputFotoAlumna").files[0];
  if (!archivo) return;
  if (archivo.size > TAMANO_MAX_ARCHIVO) {
    alert("La foto es muy grande (máximo 8 MB). Intenta con una más liviana.");
    el("inputFotoAlumna").value = "";
    return;
  }
  archivoFotoAlumna = archivo;
  const preview = el("previewFotoAlumna");
  preview.src = URL.createObjectURL(archivo);
  preview.hidden = false;
});

el("btnGuardarAlumna").addEventListener("click", guardarAlumna);

async function guardarAlumna() {
  const modoEdicion = !!alumnaEditandoId;
  const valores = recolectarValoresAlumna(modoEdicion);
  const mensajeEl = el("mensajeAlumnaForm");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  const faltantes = CAMPOS_ALUMNA.filter(
    (c) => c.requerido && (!c.soloEdicion || modoEdicion) && !valores[c.key]
  );
  if (faltantes.length) {
    mensajeEl.textContent = "Completa: " + faltantes.map((c) => c.label).join(", ");
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }
  if (!modoEdicion && !el("chkAceptoPoliticas").checked) {
    mensajeEl.textContent = "Confirma que se aceptaron las Políticas de Ingreso a la Academia.";
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }

  const boton = el("btnGuardarAlumna");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Guardando...";

  try {
    let alumnaId = alumnaEditandoId;
    if (modoEdicion) {
      await llamarWorker({
        accion: "recepcionActualizarAlumna",
        clave: claveRecepcion,
        alumnaId,
        campos: valores,
      });
    } else {
      const resp = await llamarWorker({
        accion: "crearInscripcion",
        alumna: valores.nombre,
        edad: valores.edad,
        cumpleanos: valores.cumpleanos,
        whatsapp: valores.whatsapp,
        correo: valores.correo,
        nit: valores.nit,
        nombrePadre: valores.nombrePadre,
        contactoEmergencia: valores.contactoEmergencia,
        numeroEmergencia: valores.numeroEmergencia,
        condicionMedica: valores.condicionMedica,
        aceptoPoliticas: "SI",
        aceptoShow: valores.aceptoShow || "",
        grupoIds: valores.grupoIds,
        maestraIds: valores.maestraIds,
        clase: valores.clase,
        horario: valores.horario,
        mensualidad: valores.mensualidad,
      });
      alumnaId = resp.alumnaId;
    }

    if (alumnaId && archivoFotoAlumna) {
      try {
        const base64 = await leerArchivoBase64(archivoFotoAlumna);
        await llamarWorker({
          accion: "recepcionSubirFotoAlumna",
          clave: claveRecepcion,
          alumnaId,
          archivoBase64: base64,
          nombreArchivo: archivoFotoAlumna.name,
          tipoArchivo: archivoFotoAlumna.type,
        });
      } catch (e) {
        console.error("No se pudo subir la foto:", e.message);
      }
    }

    mensajeEl.textContent = modoEdicion ? "✅ Cambios guardados." : "✅ Alumna inscrita correctamente.";
    mensajeEl.classList.add("mensaje-form-ok");
    archivoFotoAlumna = null;

    if (!modoEdicion) {
      setTimeout(() => {
        el("vistaAlumnaFormulario").hidden = true;
        el("vistaAlumnasBuscar").hidden = false;
        el("inputBuscarAlumna").value = "";
        el("listaAlumnas").innerHTML = "";
      }, 1200);
    }
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ==========================================
// INGRESOS DIARIOS
// ==========================================

const OPCIONES_METODO_PAGO = ["EFECTIVO", "TARJETA BAC", "TARJETA PAGGO", "TRANSFERENCIA", "LINK", "LINK RECEPCION"];

let ingresoAlumnaIdElegida = "";
let ingresosInicializados = false;

function inicializarIngresos() {
  if (!ingresosInicializados) {
    poblarSelectSimple("selectIngresoMetodo", OPCIONES_METODO_PAGO, true);
    ingresosInicializados = true;
  }
  if (!el("inputIngresoFecha").value) {
    el("inputIngresoFecha").value = fechaHoyGuatemala();
  }
  el("inputVerFechaIngresos").value = fechaHoyGuatemala();
  cargarIngresosDelDia();
}

el("inputIngresoAlumna").addEventListener("input", () => {
  clearTimeout(el("inputIngresoAlumna")._temporizador);
  ingresoAlumnaIdElegida = "";
  el("ingresoAlumnaElegida").hidden = true;
  el("inputIngresoAlumna")._temporizador = setTimeout(buscarAlumnaParaIngreso, 350);
});

async function buscarAlumnaParaIngreso() {
  const texto = el("inputIngresoAlumna").value.trim();
  const cont = el("listaIngresoAlumnaSugerencias");
  if (texto.length < 2) {
    cont.hidden = true;
    cont.innerHTML = "";
    return;
  }
  try {
    const datos = await llamarWorker({ accion: "recepcionBuscarAlumnas", clave: claveRecepcion, query: texto });
    const alumnas = (datos.alumnas || []).slice(0, 8);
    cont.innerHTML = "";
    if (!alumnas.length) {
      cont.hidden = true;
      return;
    }
    alumnas.forEach((a) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "sugerencia-item";
      item.textContent = a.nombre;
      item.addEventListener("click", () => {
        ingresoAlumnaIdElegida = a.id;
        el("inputIngresoAlumna").value = a.nombre;
        el("ingresoAlumnaElegida").textContent = "✅ " + a.nombre;
        el("ingresoAlumnaElegida").hidden = false;
        cont.hidden = true;
      });
      cont.appendChild(item);
    });
    cont.hidden = false;
  } catch (e) {
    cont.hidden = true;
  }
}

el("btnGuardarIngreso").addEventListener("click", guardarIngreso);

async function guardarIngreso() {
  const mensajeEl = el("mensajeIngresoForm");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  const descripcion = el("inputIngresoDescripcion").value.trim();
  const monto = Number(el("inputIngresoMonto").value);
  const metodoPago = el("selectIngresoMetodo").value;
  const fecha = el("inputIngresoFecha").value || fechaHoyGuatemala();
  const observaciones = el("inputIngresoObservaciones").value.trim();

  if (!descripcion || !monto || monto <= 0) {
    mensajeEl.textContent = "Escribe una descripción y un monto válido.";
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }

  const boton = el("btnGuardarIngreso");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Guardando...";

  try {
    await llamarWorker({
      accion: "recepcionCrearIngreso",
      clave: claveRecepcion,
      descripcion,
      monto,
      metodoPago,
      fecha,
      observaciones,
      alumnaId: ingresoAlumnaIdElegida,
    });

    mensajeEl.textContent = "✅ Ingreso registrado.";
    mensajeEl.classList.add("mensaje-form-ok");

    el("inputIngresoDescripcion").value = "";
    el("inputIngresoMonto").value = "";
    el("selectIngresoMetodo").value = "";
    el("inputIngresoObservaciones").value = "";
    el("inputIngresoAlumna").value = "";
    ingresoAlumnaIdElegida = "";
    el("ingresoAlumnaElegida").hidden = true;

    el("inputVerFechaIngresos").value = fecha;
    await cargarIngresosDelDia();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

el("inputVerFechaIngresos").addEventListener("change", cargarIngresosDelDia);

async function cargarIngresosDelDia() {
  const fecha = el("inputVerFechaIngresos").value || fechaHoyGuatemala();
  const cont = el("listaIngresosDia");
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  el("tituloListaIngresos").textContent = fecha === fechaHoyGuatemala() ? "Ingresos de hoy" : "Ingresos del " + fecha;
  try {
    const datos = await llamarWorker({ accion: "recepcionListarIngresos", clave: claveRecepcion, fecha });
    renderListaIngresos(datos.ingresos || [], datos.total || 0);
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
    el("totalIngresosDia").textContent = "";
  }
}

function renderListaIngresos(ingresos, total) {
  const cont = el("listaIngresosDia");
  cont.innerHTML = "";
  if (!ingresos.length) {
    cont.innerHTML = '<p class="lista-vacia">Todavía no hay ingresos registrados ese día.</p>';
    el("totalIngresosDia").textContent = "";
    return;
  }
  ingresos.forEach((i) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta-ingreso";
    tarjeta.innerHTML = `
      <div class="tarjeta-ingreso-fila">
        <span class="tarjeta-ingreso-desc">${i.descripcion}</span>
        <span class="tarjeta-ingreso-monto">Q${Number(i.monto || 0).toFixed(2)}</span>
      </div>
      <div class="tarjeta-ingreso-detalle">${i.metodoPago || "—"}${i.observaciones ? " · " + i.observaciones : ""}</div>
    `;
    cont.appendChild(tarjeta);
  });
  el("totalIngresosDia").textContent = `Total: Q${Number(total || 0).toFixed(2)}`;
}

// ==========================================
// PAGOS
// ==========================================
// Esta sección refleja lo que ya existe en la tabla PAGOS de
// Airtable: los mismos campos con información real (agrupados por
// tema, para que no sea una pared de datos) y las mismas vistas
// (como chips que arman la misma condición que esa vista en
// Airtable). El detalle completo de UN pago se trae con la acción
// recepcionObtenerPago; la búsqueda/lista liviana con
// recepcionBuscarPagos.

const OPCIONES_ESTADO_PAGO = ["PAGADO", "PENDIENTE", "AUSENTE", "ANULADO", "EN REVISION", "PRUEBA"];
const OPCIONES_FORMA_PAGO = ["TARJETA BAC", "EFECTIVO", "TRANSFERENCIA", "LINK", "LINK RECEPCION", "TARJETA PAGGO"];
const OPCIONES_FACTURA = ["ENVIADA", "NO ENVIADA", "NO HACER"];
const NOMBRES_MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Cada una de estas es una vista real que ya existe en Airtable — el
// Worker arma, del lado del servidor, la misma condición que esa
// vista usa.
const VISTAS_PAGOS = [
  { id: "pagados", texto: "✅ Pagados" },
  { id: "ausentes_mes", texto: "🚫 Ausentes del mes" },
  { id: "morosos", texto: "⏰ Morosos" },
  { id: "link_mes_actual", texto: "🔗 Por link (mes actual)" },
  { id: "transferencia_mes_actual", texto: "🏦 Transferencia (mes actual)" },
  { id: "envio_link_hoy", texto: "💳 Enviar link hoy" },
];

let pagoEditandoId = null;
let pagosInicializados = false;
let vistaPagoActiva = "";

function inicializarPagos() {
  if (!pagosInicializados) {
    poblarSelectSimple("selectPagoMesFiltro", NOMBRES_MESES, true);
    renderChipsVistaPagos();
    pagosInicializados = true;
  }
}

function renderChipsVistaPagos() {
  const cont = el("chipsVistaPagos");
  cont.innerHTML = "";
  VISTAS_PAGOS.forEach((v) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (vistaPagoActiva === v.id ? " activo" : "");
    chip.textContent = v.texto;
    chip.addEventListener("click", () => {
      vistaPagoActiva = vistaPagoActiva === v.id ? "" : v.id;
      renderChipsVistaPagos();
      buscarPagos();
    });
    cont.appendChild(chip);
  });
}

el("inputBuscarPago").addEventListener("input", () => {
  clearTimeout(el("inputBuscarPago")._temporizador);
  el("inputBuscarPago")._temporizador = setTimeout(buscarPagos, 350);
});

el("btnFiltrarMesPago").addEventListener("click", buscarPagos);

async function buscarPagos() {
  const texto = el("inputBuscarPago").value.trim();
  const mes = el("selectPagoMesFiltro").value;
  const anio = el("inputPagoAnioFiltro").value.trim();
  const cont = el("listaPagos");
  const pista = el("pistaResultadosPagos");

  if (!texto && !vistaPagoActiva && !mes && !anio) {
    cont.innerHTML = "";
    pista.textContent = "Busca por nombre, elige una vista, o un mes/año para ver resultados.";
    return;
  }
  if (texto && texto.length < 2) {
    cont.innerHTML = "";
    return;
  }

  cont.innerHTML = '<p class="lista-vacia">Buscando...</p>';
  pista.textContent = "";
  try {
    const datos = await llamarWorker({
      accion: "recepcionBuscarPagos",
      clave: claveRecepcion,
      query: texto,
      vista: vistaPagoActiva,
      mes,
      anio,
    });
    renderListaPagos(datos.pagos || []);
    if (datos.limitado) {
      pista.textContent = `Mostrando los primeros ${datos.totalEncontrados} — afina con el nombre o el mes/año para ver el resto.`;
    } else if (datos.totalEncontrados) {
      pista.textContent = `${datos.totalEncontrados} resultado(s).`;
    } else {
      pista.textContent = "";
    }
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderListaPagos(pagos) {
  const cont = el("listaPagos");
  cont.innerHTML = "";
  if (!pagos.length) {
    cont.innerHTML = '<p class="lista-vacia">No se encontraron pagos.</p>';
    return;
  }
  pagos.forEach((p) => {
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado";
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${p.alumna || "(Sin nombre)"} — ${p.mes || ""} ${p.anio || ""}</span>
      <span class="tarjeta-resultado-detalle">${p.estado || "—"}${p.mensualidad ? " · Q" + p.mensualidad : ""}${
      p.mora ? " · Mora Q" + p.mora : ""
    }${p.tieneComprobante ? " · 📎" : ""}</span>
    `;
    tarjeta.addEventListener("click", () => abrirPago(p.id));
    cont.appendChild(tarjeta);
  });
}

function formatQ(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : "Q" + n.toFixed(2);
}

function siNo(v) {
  return v ? "Sí" : "No";
}

function filaInfo(label, valorHtml) {
  const p = document.createElement("div");
  p.className = "fila-info";
  const lab = document.createElement("span");
  lab.className = "fila-info-label";
  lab.textContent = label;
  const val = document.createElement("span");
  val.className = "fila-info-valor";
  val.innerHTML = valorHtml === "" || valorHtml === null || valorHtml === undefined ? "—" : valorHtml;
  p.appendChild(lab);
  p.appendChild(val);
  return p;
}

function bloqueInfo(titulo, filas) {
  const div = document.createElement("div");
  div.className = "bloque-info";
  const h = document.createElement("p");
  h.className = "bloque-info-titulo";
  h.textContent = titulo;
  div.appendChild(h);
  filas.forEach(([label, valor]) => div.appendChild(filaInfo(label, valor)));
  return div;
}

function crearCampoEditablePago(idControl, label, tipo, valor, opciones) {
  const wrap = document.createElement("div");
  wrap.className = "campo-form";
  const lab = document.createElement("p");
  lab.className = "etiqueta-campo";
  lab.textContent = label;
  wrap.appendChild(lab);

  if (tipo === "select") {
    const select = document.createElement("select");
    select.className = "input-select";
    select.id = idControl;
    const vacio = document.createElement("option");
    vacio.value = "";
    vacio.textContent = "— Sin elegir —";
    select.appendChild(vacio);
    opciones.forEach((op) => {
      const o = document.createElement("option");
      o.value = op;
      o.textContent = op;
      select.appendChild(o);
    });
    select.value = valor || "";
    wrap.appendChild(select);
  } else if (tipo === "fecha") {
    const input = document.createElement("input");
    input.type = "date";
    input.className = "input-texto";
    input.id = idControl;
    input.value = valor || "";
    wrap.appendChild(input);
  } else if (tipo === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.className = "input-textarea";
    textarea.rows = 2;
    textarea.id = idControl;
    textarea.value = valor || "";
    wrap.appendChild(textarea);
  }
  return wrap;
}

async function abrirPago(id) {
  inicializarPagos();
  el("mensajePagoForm").textContent = "";
  el("mensajePagoForm").className = "mensaje-form";
  el("tituloFormPago").textContent = "Cargando...";
  el("detallePago").innerHTML = '<p class="lista-vacia">Cargando...</p>';
  el("vistaPagosBuscar").hidden = true;
  el("vistaPagoFormulario").hidden = false;

  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerPago", clave: claveRecepcion, pagoId: id });
    pagoEditandoId = id;
    el("tituloFormPago").textContent = `${datos.pago.alumna} — ${datos.pago.mesCompleto || datos.pago.mes}`;
    renderDetallePago(datos.pago);
  } catch (e) {
    el("detallePago").innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderDetallePago(p) {
  const cont = el("detallePago");
  cont.innerHTML = "";

  cont.appendChild(
    bloqueInfo("Identificación", [
      ["Alumna", p.alumna],
      ["Periodo", p.mesCompleto || `${p.mes} ${p.anio}`],
      ["Resumen", p.resumenPago],
    ])
  );

  const editable1 = document.createElement("div");
  editable1.className = "campos-formulario";
  editable1.appendChild(crearCampoEditablePago("campoPago_estado", "Estado", "select", p.estado, OPCIONES_ESTADO_PAGO));
  editable1.appendChild(crearCampoEditablePago("campoPago_formaPago", "Forma de pago", "select", p.formaPago, OPCIONES_FORMA_PAGO));
  editable1.appendChild(crearCampoEditablePago("campoPago_fechaPago", "Fecha de pago", "fecha", p.fechaPago));
  editable1.appendChild(crearCampoEditablePago("campoPago_factura", "Factura", "select", p.factura, OPCIONES_FACTURA));
  cont.appendChild(editable1);

  cont.appendChild(
    bloqueInfo("Montos", [
      ["Mensualidad", formatQ(p.mensualidad)],
      ["Mora", formatQ(p.mora)],
      ["Mensualidad con mora", formatQ(p.mensualidadConMora)],
      ["IVA", formatQ(p.iva)],
      ["ISR", formatQ(p.isr)],
      ["Comisión", formatQ(p.comision)],
      ["Neto", formatQ(p.neto)],
    ])
  );

  cont.appendChild(
    bloqueInfo("Facturación", [
      ["NIT", p.nit],
      ["Estado de la alumna", p.estadoAlumna],
      ["Estado del mes actual", p.estadoMesActual],
    ])
  );

  cont.appendChild(
    bloqueInfo("Link de pago (Paggo)", [
      ["Estado en Paggo", p.paggoStatus],
      ["Link de pago", p.linkPago ? `<a href="${p.linkPago}" target="_blank" rel="noopener">Abrir link ↗</a>` : "—"],
      ["Fecha del link", p.fechaLink || "—"],
      [
        "Link de WhatsApp de cobro",
        p.linkWhatsappPago ? `<a href="${p.linkWhatsappPago}" target="_blank" rel="noopener">Abrir WhatsApp ↗</a>` : "—",
      ],
    ])
  );

  cont.appendChild(
    bloqueInfo("Recordatorios de cobro", [
      ["Día de recordatorio", p.diaRecordatorio],
      ["Día de envío de link", p.diaEnvioLink],
      ["¿Hoy toca enviar?", siNo(p.esDiaDeEnvio)],
      ["Link enviado", siNo(p.linkEnviado)],
      ["Recordatorio enviado", siNo(p.recordatorioEnviado)],
      ["Error de envío", p.errorEnvio || "—"],
      ["WhatsApp", p.whatsapp || "—"],
    ])
  );

  const bloqueComprobante = document.createElement("div");
  bloqueComprobante.className = "bloque-info";
  const tituloComp = document.createElement("p");
  tituloComp.className = "bloque-info-titulo";
  tituloComp.textContent = "Comprobante";
  bloqueComprobante.appendChild(tituloComp);

  if (p.comprobantes && p.comprobantes.length) {
    p.comprobantes.forEach((c, i) => {
      const enlace = document.createElement("a");
      enlace.href = c.url;
      enlace.target = "_blank";
      enlace.rel = "noopener";
      enlace.className = "enlace-comprobante";
      enlace.textContent = "📎 Ver comprobante " + (i + 1);
      bloqueComprobante.appendChild(enlace);
    });
  } else {
    bloqueComprobante.appendChild(filaInfo("Comprobante subido", "— No"));
  }
  bloqueComprobante.appendChild(filaInfo("Fecha del comprobante", p.fechaComprobante || "—"));

  const labelSubir = document.createElement("label");
  labelSubir.className = "btn-secundario btn-ancho btn-subir-foto btn-subir-comprobante";
  labelSubir.textContent = "📎 Subir comprobante nuevo";
  labelSubir.setAttribute("for", "inputComprobantePago");
  const inputSubir = document.createElement("input");
  inputSubir.type = "file";
  inputSubir.id = "inputComprobantePago";
  inputSubir.accept = "image/*,application/pdf";
  inputSubir.hidden = true;
  inputSubir.addEventListener("change", () => subirComprobantePago(inputSubir.files[0]));
  bloqueComprobante.appendChild(labelSubir);
  bloqueComprobante.appendChild(inputSubir);
  const mensajeComprobante = document.createElement("p");
  mensajeComprobante.className = "mensaje-form";
  mensajeComprobante.id = "mensajeComprobantePago";
  bloqueComprobante.appendChild(mensajeComprobante);
  cont.appendChild(bloqueComprobante);

  const editable2 = document.createElement("div");
  editable2.className = "campos-formulario";
  editable2.appendChild(crearCampoEditablePago("campoPago_observaciones", "Observaciones", "textarea", p.observaciones));
  cont.appendChild(editable2);

  const chkWrap = document.createElement("label");
  chkWrap.className = "opcion-checkbox";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.id = "campoPago_revisado";
  chk.checked = !!p.revisado;
  const chkSpan = document.createElement("span");
  chkSpan.textContent = "Ya revisado por Recepción";
  chkWrap.appendChild(chk);
  chkWrap.appendChild(chkSpan);
  cont.appendChild(chkWrap);

  cont.appendChild(
    bloqueInfo("Otros", [
      ["Bloqueado", siNo(p.bloqueado)],
      ["Creado", p.creado ? new Date(p.creado).toLocaleString("es-GT", { timeZone: "America/Guatemala" }) : "—"],
    ])
  );
}

async function subirComprobantePago(archivo) {
  if (!archivo || !pagoEditandoId) return;
  const mensajeEl = el("mensajeComprobantePago");
  if (!mensajeEl) return;

  if (archivo.size > TAMANO_MAX_ARCHIVO) {
    mensajeEl.textContent = "El archivo es muy grande (máximo 8 MB).";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }

  mensajeEl.textContent = "Subiendo...";
  mensajeEl.className = "mensaje-form";

  try {
    const base64 = await leerArchivoBase64(archivo);
    await llamarWorker({
      accion: "subirComprobante",
      pagoId: pagoEditandoId,
      archivoBase64: base64,
      nombreArchivo: archivo.name,
      tipoArchivo: archivo.type,
    });
    const datos = await llamarWorker({ accion: "recepcionObtenerPago", clave: claveRecepcion, pagoId: pagoEditandoId });
    renderDetallePago(datos.pago);
    el("mensajeComprobantePago").textContent = "✅ Comprobante subido.";
    el("mensajeComprobantePago").className = "mensaje-form mensaje-form-ok";
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.className = "mensaje-form mensaje-form-error";
  }
}

el("btnCancelarPago").addEventListener("click", () => {
  el("vistaPagoFormulario").hidden = true;
  el("vistaPagosBuscar").hidden = false;
});

el("btnGuardarPago").addEventListener("click", guardarPago);

async function guardarPago() {
  const mensajeEl = el("mensajePagoForm");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  const boton = el("btnGuardarPago");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Guardando...";

  try {
    const factura = el("campoPago_factura").value;
    await llamarWorker({
      accion: "recepcionActualizarPago",
      clave: claveRecepcion,
      pagoId: pagoEditandoId,
      campos: {
        estado: el("campoPago_estado").value,
        formaPago: el("campoPago_formaPago").value,
        fechaPago: el("campoPago_fechaPago").value,
        factura: factura ? [factura] : [],
        observaciones: el("campoPago_observaciones").value.trim(),
        revisado: el("campoPago_revisado").checked,
      },
    });
    mensajeEl.textContent = "✅ Cambios guardados.";
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}
