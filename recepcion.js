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

// En localhost (prueba local con `wrangler dev`) se habla con el
// Worker local; en cualquier otro dominio, con el de producción. Así
// nunca se sube por olvido una URL local.
const WORKER_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : "https://portalalumnas.movedancea.workers.dev";

let claveRecepcion = "";
let mensajesActuales = [];
let pollIntervalo = null;
let alarmaIntervalo = null;
let audioCtx = null;

// Grupos que Recepción abrió a propósito desde "＋ Elegir un grupo
// para escribir", aunque todavía no tengan ningún mensaje hoy — así
// puede empezar la conversación ella primero, en vez de solo
// contestar a las que ya escribió una maestra. Se guarda en memoria
// (no en Airtable): { grupoId, grupo, abiertaEn }.
let hilosManualAbiertos = [];

function el(id) {
  return document.getElementById(id);
}

const PANTALLAS = [
  "pantallaLogin",
  "pantallaMenu",
  "pantallaRecepcion",
  "pantallaElegirGrupoChat",
  "pantallaAlumnas",
  "pantallaIngresos",
  "pantallaPagos",
  "pantallaCanalAsistencia",
  "pantallaCanalChat",
  "pantallaEvalMaestras",
  "pantallaEstadoPortal",
  "pantallaVentaEntradas",
  "pantallaAnuncios",
  "pantallaAvisoImportante",
  "pantallaExtranamos",
  "pantallaFeriados",
  "pantallaShow",
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

// ---------- archivos para Airtable (límite de 5 MB) ----------
// Todo archivo que se sube desde aquí termina en un campo de adjuntos de
// Airtable, y su API acepta como máximo 5 MB por archivo. Antes esta
// pantalla dejaba pasar hasta 8 MB, así que un archivo de 5 a 8 MB
// pasaba la revisión y luego fallaba en Airtable. Ahora:
// - Fotos: se achican y se vuelven JPG en el navegador (de paso
//   convierte HEIC del iPhone/iPad). Una foto de 2000 px en JPG casi
//   nunca pasa de 1 MB. Si el navegador no puede abrir la foto (p. ej.
//   HEIC en Chrome de computadora) y ya pesa 5 MB o menos, se manda tal
//   cual, como antes.
// - PDFs: no se pueden achicar aquí; si pasan de 5 MB se avisa con un
//   mensaje claro al escogerlos.
// La usan todas las subidas de esta pantalla (incluidos los pagos a la
// modista). Si se cambia aquí, revisar las otras copias (aviso.js, portal.js).
const MAX_BYTES_AIRTABLE = 5 * 1024 * 1024;
const LADO_MAX_FOTO = 2000;

function esPdfArchivo(archivo) {
  return archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name);
}

function esFotoArchivo(archivo) {
  return archivo.type.startsWith("image/") || /\.(heic|heif)$/i.test(archivo.name);
}

// Revisión al ESCOGER el archivo: devuelve el mensaje de error, o "" si
// se puede subir. soloFotos: para campos de foto (perfil, recogida...).
function errorArchivoParaAirtable(archivo, { soloFotos = false } = {}) {
  if (esFotoArchivo(archivo)) return "";
  if (soloFotos) return "El archivo tiene que ser una foto.";
  if (!esPdfArchivo(archivo)) return "El archivo tiene que ser una foto o un PDF.";
  if (archivo.size > MAX_BYTES_AIRTABLE) {
    const mb = (archivo.size / 1024 / 1024).toFixed(1);
    return `El PDF pesa ${mb} MB y el máximo es 5 MB. Guárdalo más liviano o mándalo como foto.`;
  }
  return "";
}

// Al ENVIAR: { base64, nombre, tipo } listo para el Worker (nombre y tipo
// son los del archivo que de verdad se manda, p. ej. ".jpg" tras achicar).
async function prepararArchivoParaAirtable(archivo, opciones) {
  const error = errorArchivoParaAirtable(archivo, opciones);
  if (error) throw new Error(error);
  if (esPdfArchivo(archivo)) {
    return { base64: await leerArchivoBase64(archivo), nombre: archivo.name, tipo: "application/pdf" };
  }
  for (const [lado, calidad] of [[LADO_MAX_FOTO, 0.85], [1600, 0.7], [1200, 0.6]]) {
    let blob;
    try {
      blob = await comprimirFoto(archivo, lado, calidad);
    } catch (e) {
      break; // el navegador no pudo abrir la foto
    }
    if (blob.size <= MAX_BYTES_AIRTABLE) {
      return {
        base64: await leerArchivoBase64(blob),
        nombre: archivo.name.replace(/\.[^.]+$/, "") + ".jpg",
        tipo: "image/jpeg",
      };
    }
  }
  if (archivo.size <= MAX_BYTES_AIRTABLE) {
    return { base64: await leerArchivoBase64(archivo), nombre: archivo.name, tipo: archivo.type || "application/octet-stream" };
  }
  throw new Error("No se pudo preparar la foto (pesa más de 5 MB). Toma la foto otra vez o mándala en JPG.");
}

function comprimirFoto(archivo, ladoMax, calidad) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
      const ctx = canvas.getContext("2d");
      // JPG no tiene transparencia: sin fondo blanco, lo transparente de
      // un PNG (capturas, logos) saldría negro.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo preparar la foto."))),
        "image/jpeg",
        calidad
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo abrir la foto."));
    };
    img.src = url;
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

el("btnMenuCanalAsistencia").addEventListener("click", () => {
  mostrarPantalla("pantallaCanalAsistencia");
  cargarCanalAsistencia();
});

el("btnMenuCanalChat").addEventListener("click", () => {
  mostrarPantalla("pantallaCanalChat");
  cargarCanalChat();
});

el("btnMenuEvalMaestras").addEventListener("click", () => {
  mostrarPantalla("pantallaEvalMaestras");
  cargarEvalMaestras();
});

el("btnMenuEstadoPortal").addEventListener("click", () => {
  mostrarPantalla("pantallaEstadoPortal");
  cargarEstadoPortal();
});

el("btnMenuVentaEntradas").addEventListener("click", () => {
  mostrarPantalla("pantallaVentaEntradas");
  cargarVentaEntradas();
});

el("btnMenuAnuncios").addEventListener("click", () => {
  mostrarPantalla("pantallaAnuncios");
  cargarCanalAnuncios();
  prepararFormularioAnuncio();
});

el("btnMenuAvisoImportante").addEventListener("click", () => {
  mostrarPantalla("pantallaAvisoImportante");
  prepararFormularioAvisoImportante();
});

el("btnMenuExtranamos").addEventListener("click", () => {
  mostrarPantalla("pantallaExtranamos");
  cargarExtranamos();
});

el("btnMenuFeriados").addEventListener("click", () => {
  mostrarPantalla("pantallaFeriados");
  cargarFeriados();
});

el("btnMenuShow").addEventListener("click", () => {
  mostrarPantalla("pantallaShow");
  abrirShow();
});

el("btnVolverSolicitudes").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverEvalMaestras").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverEstadoPortal").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverVentaEntradas").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnGuardarMensajePortal").addEventListener("click", () => guardarEstadoPortal(estadoPortalActual.estado));
el("btnActivarAccesoPrueba").addEventListener("click", activarAccesoPruebaPortal);
el("btnQuitarAccesoPrueba").addEventListener("click", quitarAccesoPruebaPortal);
el("btnVolverElegirGrupoChat").addEventListener("click", () => mostrarPantalla("pantallaRecepcion"));
el("btnVolverAlumnas").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverIngresos").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverPagos").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverCanalAsistencia").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverCanalChat").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverAnuncios").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverAvisoImportante").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverExtranamos").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverFeriados").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverShow").addEventListener("click", () => mostrarPantalla("pantallaMenu"));

el("btnSalirMenu").addEventListener("click", () => {
  detenerAutoRefresco();
  detenerAlarma();
  claveRecepcion = "";
  mensajesActuales = [];
  datosApoyo = null;
  limpiarShow();
  hilosManualAbiertos = [];
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

  // Primero los grupos que Recepción abrió a propósito (sin mensajes
  // todavía), para que su hilo (vacío) ya aparezca y pueda escribir.
  hilosManualAbiertos.forEach((h) => {
    if (!hilos.has(h.grupoId)) {
      hilos.set(h.grupoId, { grupoId: h.grupoId, grupo: h.grupo, mensajes: [], abiertaEn: h.abiertaEn });
    }
  });

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
    // Un hilo recién abierto por Recepción (sin mensajes aún) usa la
    // hora en que lo abrió, para que se ordene como "recién tocado"
    // en vez de desaparecer al fondo de la lista.
    hilo.ultimaFecha = hilo.mensajes.length
      ? hilo.mensajes[hilo.mensajes.length - 1].fecha
      : hilo.abiertaEn || new Date().toISOString();
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
  if (hilo.grupoId) tarjeta.dataset.grupoId = hilo.grupoId;

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
  if (!hilo.mensajes.length) {
    chat.innerHTML = '<p class="lista-vacia">Todavía no hay mensajes — escríbele tú primero. 👇</p>';
  } else {
    hilo.mensajes.forEach((m) => chat.appendChild(crearBurbuja(m)));
  }
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

// ---------- elegir grupo para escribir primero ----------
// Deja que Recepción arranque una conversación con cualquier grupo,
// no solo contestar a los que ya escribió una maestra hoy.

let gruposChatCache = [];

el("btnElegirGrupoChat").addEventListener("click", abrirElegirGrupoChat);

async function abrirElegirGrupoChat() {
  mostrarPantalla("pantallaElegirGrupoChat");
  el("inputBuscarGrupoChat").value = "";
  el("listaGruposChat").innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const datos = await asegurarDatosApoyo();
    gruposChatCache = (datos.grupos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    renderListaGruposChat(gruposChatCache);
  } catch (e) {
    el("listaGruposChat").innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderListaGruposChat(grupos) {
  const cont = el("listaGruposChat");
  cont.innerHTML = "";
  if (!grupos.length) {
    cont.innerHTML = '<p class="lista-vacia">No se encontró ningún grupo con ese nombre.</p>';
    return;
  }
  grupos.forEach((g) => {
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado";
    tarjeta.innerHTML = `<span class="tarjeta-resultado-nombre">🩰 ${g.nombre}</span>`;
    tarjeta.addEventListener("click", () => elegirGrupoChat(g));
    cont.appendChild(tarjeta);
  });
}

el("inputBuscarGrupoChat").addEventListener("input", () => {
  const texto = el("inputBuscarGrupoChat").value.trim().toLowerCase();
  const filtrados = texto
    ? gruposChatCache.filter((g) => g.nombre.toLowerCase().includes(texto))
    : gruposChatCache;
  renderListaGruposChat(filtrados);
});

function elegirGrupoChat(grupo) {
  if (!hilosManualAbiertos.some((h) => h.grupoId === grupo.id)) {
    hilosManualAbiertos.push({ grupoId: grupo.id, grupo: grupo.nombre, abiertaEn: new Date().toISOString() });
  }
  mostrarPantalla("pantallaRecepcion");
  renderSolicitudes();

  // Lleva la vista hasta la tarjeta de este grupo y deja el cursor
  // listo en su caja de texto, para que Recepción escriba de una vez.
  const tarjeta = document.querySelector(`.tarjeta-hilo[data-grupo-id="${CSS.escape(grupo.id)}"]`);
  if (tarjeta) {
    tarjeta.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = tarjeta.querySelector(".chat-input-hilo");
    if (input) input.focus();
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
// CANAL DE ASISTENCIA (interruptor GLOBAL — aplica a TODA la
// academia a la vez, no por alumna)
// ==========================================
// Decide si el aviso de "ya llegó a la academia" del biométrico se
// manda por WhatsApp (GREEN-API) o por el Portal (notificación push)
// — para TODAS las familias al mismo tiempo. Se guarda en la tabla
// CONFIGURACION GENERAL de Airtable y lo lee worker-biometrico.js en
// cada marca de asistencia.

const OPCIONES_CANAL_ASISTENCIA = [
  {
    valor: "WhatsApp",
    titulo: "📱 WhatsApp",
    descripcion: "El aviso de asistencia llega por WhatsApp (GREEN-API), como hasta ahora.",
  },
  {
    valor: "Portal",
    titulo: "🔔 Portal",
    descripcion:
      "El aviso de asistencia llega como notificación push del Portal de Alumnas. Solo le llega a las familias que ya activaron las notificaciones desde el Portal en su celular — las que no lo hayan activado NO reciben ningún aviso.",
  },
];

let canalAsistenciaActual = "";

async function cargarCanalAsistencia() {
  const cont = el("opcionesCanalAsistencia");
  const mensajeEl = el("mensajeCanalAsistencia");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerCanalAsistencia", clave: claveRecepcion });
    canalAsistenciaActual = datos.canal || "WhatsApp";
    renderCanalAsistencia();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderCanalAsistencia() {
  const cont = el("opcionesCanalAsistencia");
  cont.innerHTML = "";

  OPCIONES_CANAL_ASISTENCIA.forEach((op) => {
    const activo = canalAsistenciaActual === op.valor;

    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${op.titulo}${activo ? " — ✅ Activo ahora para todas" : ""}</span>
      <span class="tarjeta-resultado-detalle">${op.descripcion}</span>
    `;
    tarjeta.disabled = activo;
    tarjeta.addEventListener("click", () => elegirCanalAsistencia(op.valor, op.titulo));
    cont.appendChild(tarjeta);
  });
}

async function elegirCanalAsistencia(canal, titulo) {
  const confirmado = window.confirm(
    `¿Cambiar el canal de asistencia a ${titulo} para TODAS las familias? Este cambio aplica de inmediato a todas las alumnas, no se puede elegir por alumna.`
  );
  if (!confirmado) return;

  const mensajeEl = el("mensajeCanalAsistencia");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";

  try {
    await llamarWorker({ accion: "recepcionGuardarCanalAsistencia", clave: claveRecepcion, canal });
    canalAsistenciaActual = canal;
    renderCanalAsistencia();
    mensajeEl.textContent = `✅ Listo — el aviso de asistencia ahora llega por ${titulo} para todas las familias.`;
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

// ==========================================
// CANAL DE CHAT (interruptor GLOBAL — igual que el de asistencia, pero
// para el aviso de mensaje nuevo del Chat de Maestras — más un canal
// propio opcional POR MAESTRA)
// ==========================================
// Decide si el aviso de "tienes un mensaje nuevo" del Chat de Maestras
// se manda por WhatsApp (GREEN-API) o por el Portal (notificación
// push). El interruptor general vale para TODAS las familias y para
// las maestras que no tengan canal propio. Se guarda en la tabla
// CONFIGURACION GENERAL de Airtable (campo "CANAL CHAT") y lo lee
// worker.js (chatEnviar) en cada mensaje.

const OPCIONES_CANAL_CHAT = [
  {
    valor: "WhatsApp",
    titulo: "📱 WhatsApp",
    descripcion: "El aviso de mensaje nuevo llega por WhatsApp (GREEN-API), como hasta ahora.",
  },
  {
    valor: "Portal",
    titulo: "🔔 Portal",
    descripcion:
      "El aviso de mensaje nuevo llega como notificación push del Portal. Solo le llega a quienes ya activaron las notificaciones desde el Portal (familias: en el Portal de Alumnas; maestras: en el Portal de Maestras) — quienes no las hayan activado NO reciben ningún aviso.",
  },
];

let canalChatActual = "";

async function cargarCanalChat() {
  const cont = el("opcionesCanalChat");
  const mensajeEl = el("mensajeCanalChat");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerCanalChat", clave: claveRecepcion });
    canalChatActual = datos.canal || "WhatsApp";
    renderCanalChat();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }

  cargarCanalChatMaestras();
}

function renderCanalChat() {
  const cont = el("opcionesCanalChat");
  cont.innerHTML = "";

  OPCIONES_CANAL_CHAT.forEach((op) => {
    const activo = canalChatActual === op.valor;

    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${op.titulo}${activo ? " — ✅ Activo ahora (general)" : ""}</span>
      <span class="tarjeta-resultado-detalle">${op.descripcion}</span>
    `;
    tarjeta.disabled = activo;
    tarjeta.addEventListener("click", () => elegirCanalChat(op.valor, op.titulo));
    cont.appendChild(tarjeta);
  });
}

async function elegirCanalChat(canal, titulo) {
  const confirmado = window.confirm(
    `¿Cambiar el canal de chat general a ${titulo}? Aplica de inmediato a TODAS las familias y a las maestras que siguen el general (las que tienen canal propio no cambian).`
  );
  if (!confirmado) return;

  const mensajeEl = el("mensajeCanalChat");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";

  try {
    await llamarWorker({ accion: "recepcionGuardarCanalChat", clave: claveRecepcion, canal });
    canalChatActual = canal;
    renderCanalChat();
    // Las maestras que "siguen el general" cambian con esto — se vuelve
    // a pintar su lista para que la etiqueta muestre el canal nuevo.
    if (canalChatMaestras.length) renderCanalChatMaestras();
    mensajeEl.textContent = `✅ Listo — el aviso de mensaje nuevo del chat ahora llega por ${titulo} para las familias y las maestras que siguen el general.`;
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

// ==========================================
// CANAL DE CHAT POR MAESTRA
// ==========================================
// Cada maestra puede tener su propio canal para el aviso que le llega
// A ELLA cuando una familia le escribe (campo "CANAL CHAT" de la tabla
// MAESTRAS en Airtable). Vacío = "Seguir el general" (el interruptor
// de arriba), que es como quedan todas al principio — así nadie cambia
// de canal hasta que Recepción lo elija a propósito. El aviso que le
// llega a las FAMILIAS no se toca aquí.

const OPCIONES_CANAL_CHAT_MAESTRA = [
  { valor: "", titulo: "Seguir el general" },
  { valor: "WhatsApp", titulo: "📱 WhatsApp" },
  { valor: "Portal", titulo: "🔔 Portal" },
];

let canalChatMaestras = [];

async function cargarCanalChatMaestras() {
  const cont = el("listaCanalChatMaestras");
  const mensajeEl = el("mensajeCanalChatMaestras");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionListarCanalChatMaestras", clave: claveRecepcion });
    canalChatMaestras = datos.maestras || [];
    renderCanalChatMaestras();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function tituloCanalChat(valor) {
  return valor === "Portal" ? "🔔 Portal" : "📱 WhatsApp";
}

function renderCanalChatMaestras() {
  const cont = el("listaCanalChatMaestras");
  cont.innerHTML = "";

  if (!canalChatMaestras.length) {
    cont.innerHTML = '<p class="lista-vacia">No hay maestras activas.</p>';
    return;
  }

  canalChatMaestras.forEach((m) => {
    // El canal que de verdad le va a llegar hoy (propio, o el general).
    const canalEfectivo = m.canal || canalChatActual || "WhatsApp";

    const fila = document.createElement("div");
    fila.className = "tarjeta-resultado fila-canal-maestra";

    const nombre = document.createElement("span");
    nombre.className = "tarjeta-resultado-nombre";
    nombre.textContent = m.nombre;

    const detalle = document.createElement("span");
    detalle.className = "tarjeta-resultado-detalle";
    detalle.textContent = m.canal
      ? `Le llega por ${tituloCanalChat(canalEfectivo)} (canal propio)`
      : `Le llega por ${tituloCanalChat(canalEfectivo)} (sigue el general)`;

    fila.appendChild(nombre);
    fila.appendChild(detalle);

    // Avisos para que no quede en un canal por el que no le llega nada.
    let alerta = "";
    if (canalEfectivo === "Portal" && !m.tienePush) {
      alerta = "⚠️ Todavía no activó las notificaciones en el Portal de Maestras — así NO le llega ningún aviso.";
    } else if (canalEfectivo === "WhatsApp" && !m.tieneWhatsapp) {
      alerta = "⚠️ No tiene WhatsApp registrado en Airtable — así NO le llega ningún aviso.";
    }
    if (alerta) {
      const alertaEl = document.createElement("span");
      alertaEl.className = "tarjeta-resultado-detalle alerta-canal-maestra";
      alertaEl.textContent = alerta;
      fila.appendChild(alertaEl);
    }

    const chips = document.createElement("div");
    chips.className = "chips-contenedor chips-canal-maestra";
    OPCIONES_CANAL_CHAT_MAESTRA.forEach((op) => {
      const activo = (m.canal || "") === op.valor;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (activo ? " activo" : "");
      chip.textContent = op.titulo;
      chip.disabled = activo;
      chip.addEventListener("click", () => elegirCanalChatMaestra(m, op.valor, op.titulo));
      chips.appendChild(chip);
    });
    fila.appendChild(chips);

    cont.appendChild(fila);
  });
}

async function elegirCanalChatMaestra(maestra, canal, titulo) {
  const texto = canal
    ? `¿Cambiar el canal de chat de ${maestra.nombre} a ${titulo}? Solo cambia el aviso que le llega a ella; aplica de inmediato.`
    : `¿Que ${maestra.nombre} vuelva a seguir el canal general (${tituloCanalChat(canalChatActual)})? Aplica de inmediato.`;
  if (!window.confirm(texto)) return;

  const mensajeEl = el("mensajeCanalChatMaestras");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";

  try {
    await llamarWorker({
      accion: "recepcionGuardarCanalChatMaestra",
      clave: claveRecepcion,
      maestraId: maestra.id,
      canal,
    });
    maestra.canal = canal;
    renderCanalChatMaestras();
    mensajeEl.textContent = canal
      ? `✅ Listo — a ${maestra.nombre} ahora le llega el aviso por ${titulo}.`
      : `✅ Listo — ${maestra.nombre} ahora sigue el canal general.`;
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

// ==========================================
// EVALUACIÓN DE MAESTRAS (interruptor GLOBAL — las alumnas evalúan a
// sus maestras)
// ==========================================
// Enciende/apaga el botón "⭐ Evaluar a mis maestras" del Portal de
// Alumnas para TODAS a la vez. Se guarda en CONFIGURACION GENERAL
// (campos "EVALUACION MAESTRAS ACTIVA" y "RONDA EVALUACION MAESTRAS").
// El Worker sube la ronda en 1 cada vez que pasa de apagado a
// encendido; por eso aquí solo mostramos el número que devuelve.

let evalMaestrasActual = { activa: false, ronda: 0 };

async function cargarEvalMaestras() {
  const cont = el("opcionesEvalMaestras");
  const mensajeEl = el("mensajeEvalMaestras");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerEvaluacionMaestras", clave: claveRecepcion });
    evalMaestrasActual = { activa: !!datos.activa, ronda: datos.ronda || 0 };
    renderEvalMaestras();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }

  cargarListaEvaluacionesMaestras();
}

// ---------- todas las evaluaciones (con nombre de alumna) ----------
// Solo Recepción ve quién evaluó; el Worker ordena por maestra → grupo →
// ronda (la más nueva primero) → alumna, aquí solo se agrupa para mostrar.

const ETIQUETAS_CRITERIOS_EVAL = [
  ["puntualidad", "Puntualidad"],
  ["explicaClaro", "Explica claro"],
  ["paciencia", "Paciencia"],
  ["motiva", "Motiva"],
  ["ambiente", "Ambiente"],
  ["atencionIndividual", "Atención individual"],
  ["organizacionTiempo", "Organización del tiempo"],
  ["disciplina", "Disciplina"],
];

const CARITA_POR_VALOR_EVAL = { 1: "😞", 3: "😐", 5: "😊" };

let evaluacionesMaestrasTodas = [];

async function cargarListaEvaluacionesMaestras() {
  const cont = el("listaEvalMaestrasTodas");
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const datos = await llamarWorker({ accion: "recepcionListarEvaluacionesMaestras", clave: claveRecepcion });
    evaluacionesMaestrasTodas = datos.evaluaciones || [];

    const rondas = [...new Set(evaluacionesMaestrasTodas.map((e) => e.ronda))].sort((a, b) => b - a);
    const select = el("selectRondaEvalMaestras");
    const previa = select.value;
    select.innerHTML = "";
    const optTodas = document.createElement("option");
    optTodas.value = "";
    optTodas.textContent = "Todas las rondas";
    select.appendChild(optTodas);
    rondas.forEach((r) => {
      const o = document.createElement("option");
      o.value = String(r);
      o.textContent = "Ronda " + r;
      select.appendChild(o);
    });
    if (rondas.map(String).includes(previa)) select.value = previa;

    renderListaEvaluacionesMaestras();
  } catch (e) {
    cont.innerHTML = "";
    const p = document.createElement("p");
    p.className = "lista-vacia";
    p.textContent = e.message;
    cont.appendChild(p);
  }
}

el("selectRondaEvalMaestras").addEventListener("change", renderListaEvaluacionesMaestras);

function renderListaEvaluacionesMaestras() {
  const cont = el("listaEvalMaestrasTodas");
  cont.innerHTML = "";
  const filtro = el("selectRondaEvalMaestras").value;
  const lista = evaluacionesMaestrasTodas.filter((e) => !filtro || String(e.ronda) === filtro);

  if (!lista.length) {
    const p = document.createElement("p");
    p.className = "lista-vacia";
    p.textContent = "Todavía no hay evaluaciones.";
    cont.appendChild(p);
    return;
  }

  let maestraActual = null;
  let grupoActual = null;
  lista.forEach((ev) => {
    if (ev.maestra !== maestraActual) {
      maestraActual = ev.maestra;
      grupoActual = null;
      const h = document.createElement("p");
      h.className = "eval-rec-maestra";
      h.textContent = "👩‍🏫 " + ev.maestra;
      cont.appendChild(h);
    }
    if (ev.grupo !== grupoActual) {
      grupoActual = ev.grupo;
      const h = document.createElement("p");
      h.className = "eval-rec-grupo";
      h.textContent = "💃 " + ev.grupo;
      cont.appendChild(h);
    }

    const tarjeta = document.createElement("div");
    tarjeta.className = "eval-rec-tarjeta";

    const cab = document.createElement("div");
    cab.className = "eval-rec-cabecera";
    const nombre = document.createElement("span");
    nombre.className = "eval-rec-alumna";
    nombre.textContent = ev.alumna;
    const meta = document.createElement("span");
    meta.className = "eval-rec-meta";
    meta.textContent = `Ronda ${ev.ronda} · ${"★".repeat(ev.general)}${"☆".repeat(5 - ev.general)}`;
    cab.append(nombre, meta);

    const criterios = document.createElement("p");
    criterios.className = "eval-rec-criterios";
    criterios.textContent = ETIQUETAS_CRITERIOS_EVAL.map(
      ([k, etiqueta]) => `${etiqueta} ${CARITA_POR_VALOR_EVAL[ev.criterios[k]] || "—"}`
    ).join(" · ");

    tarjeta.append(cab, criterios);
    if (ev.comentario) {
      const c = document.createElement("p");
      c.className = "eval-rec-comentario";
      c.textContent = "“" + ev.comentario + "”";
      tarjeta.appendChild(c);
    }
    cont.appendChild(tarjeta);
  });
}

function renderEvalMaestras() {
  const cont = el("opcionesEvalMaestras");
  cont.innerHTML = "";
  const { activa, ronda } = evalMaestrasActual;

  const tarjeta = document.createElement("button");
  tarjeta.type = "button";
  tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activa ? " activo" : "");
  const nombre = document.createElement("span");
  nombre.className = "tarjeta-resultado-nombre";
  nombre.textContent = activa
    ? `⭐ Evaluación ENCENDIDA — ronda ${ronda}`
    : "⭐ Evaluación apagada";
  const detalle = document.createElement("span");
  detalle.className = "tarjeta-resultado-detalle";
  detalle.textContent = activa
    ? "Toca aquí para APAGARLA. El botón desaparece del Portal de las alumnas."
    : ronda > 0
      ? `Toca aquí para ENCENDERLA. Se abrirá la ronda ${ronda + 1}: podrán evaluar otra vez a cada maestra.`
      : "Toca aquí para ENCENDERLA. Se abrirá la ronda 1.";
  tarjeta.append(nombre, detalle);
  tarjeta.addEventListener("click", () => cambiarEvalMaestras(!activa));
  cont.appendChild(tarjeta);
}

async function cambiarEvalMaestras(activar) {
  const pregunta = activar
    ? `¿Encender la evaluación de maestras? Se abre la ronda ${evalMaestrasActual.ronda + 1} para TODAS las alumnas.`
    : "¿Apagar la evaluación de maestras? El botón desaparece del Portal de las alumnas.";
  if (!window.confirm(pregunta)) return;

  const mensajeEl = el("mensajeEvalMaestras");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";

  try {
    const datos = await llamarWorker({
      accion: "recepcionGuardarEvaluacionMaestras",
      clave: claveRecepcion,
      activa: activar,
    });
    evalMaestrasActual = { activa: !!datos.activa, ronda: datos.ronda || 0 };
    renderEvalMaestras();
    mensajeEl.textContent = activar
      ? `✅ Listo — ronda ${datos.ronda} abierta. Las alumnas ya ven el botón.`
      : "✅ Listo — la evaluación quedó apagada.";
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

// ==========================================
// VENTA DE ENTRADAS (botón "🎟️ Caja de entradas (solo personal)")
// ==========================================
// Dos opciones, solo una activa. Se guarda en CONFIGURACION GENERAL
// (campo "VENTA ENTRADAS RECEPCION", casilla), igual que la evaluación
// de maestras. La pantalla de bienvenida de recepción (repo
// move-recepcion2-sin-biometrico) lo lee cada minuto con la acción
// pública ventaEntradasVisible y muestra u oculta el botón.

const OPCIONES_VENTA_ENTRADAS = [
  { activa: true, titulo: "🟢 Venta de entradas: Encendida", detalle: "El botón \"🎟️ Caja de entradas (solo personal)\" aparece en la pantalla de bienvenida (en alrededor de un minuto)." },
  { activa: false, titulo: "⚪ Venta de entradas: Apagada", detalle: "El botón no se muestra. Úsalo fuera de temporada de venta." },
];

let ventaEntradasActual = null; // true / false, o null mientras carga

async function cargarVentaEntradas() {
  const cont = el("opcionesVentaEntradas");
  const mensajeEl = el("mensajeVentaEntradas");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerVentaEntradas", clave: claveRecepcion });
    ventaEntradasActual = !!datos.activa;
    renderVentaEntradas();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderVentaEntradas() {
  const cont = el("opcionesVentaEntradas");
  cont.innerHTML = "";
  OPCIONES_VENTA_ENTRADAS.forEach((op) => {
    const activo = ventaEntradasActual === op.activa;
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.setAttribute("aria-pressed", activo ? "true" : "false");
    const nombre = document.createElement("span");
    nombre.className = "tarjeta-resultado-nombre";
    nombre.textContent = op.titulo + (activo ? " — ASÍ ESTÁ AHORA" : "");
    const detalle = document.createElement("span");
    detalle.className = "tarjeta-resultado-detalle";
    detalle.textContent = op.detalle;
    tarjeta.append(nombre, detalle);
    if (!activo) tarjeta.addEventListener("click", () => guardarVentaEntradas(op.activa));
    cont.appendChild(tarjeta);
  });
}

async function guardarVentaEntradas(activa) {
  const pregunta = activa
    ? "¿Encender la venta de entradas? El botón \"🎟️ Caja de entradas (solo personal)\" aparecerá en la pantalla de bienvenida."
    : "¿Apagar la venta de entradas? El botón desaparecerá de la pantalla de bienvenida.";
  if (!window.confirm(pregunta)) return;

  const mensajeEl = el("mensajeVentaEntradas");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";
  try {
    const datos = await llamarWorker({ accion: "recepcionGuardarVentaEntradas", clave: claveRecepcion, activa });
    ventaEntradasActual = !!datos.activa;
    renderVentaEntradas();
    mensajeEl.textContent = ventaEntradasActual
      ? "✅ Listo — el botón aparecerá en la pantalla de bienvenida en alrededor de un minuto."
      : "✅ Listo — el botón desaparecerá de la pantalla de bienvenida en alrededor de un minuto.";
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

// ==========================================
// ESTADO DEL PORTAL DE ALUMNAS (modo mantenimiento)
// ==========================================
// Tres opciones, solo una activa. Se guarda en CONFIGURACION GENERAL
// (campos "ESTADO PORTAL ALUMNAS" y "MENSAJE PORTAL ALUMNAS"), igual
// que la evaluación de maestras. El Worker bloquea el portal de
// alumnas mientras no esté "Activo".

const OPCIONES_ESTADO_PORTAL = [
  { valor: "Activo", titulo: "🟢 Portal activo (normal)", detalle: "Las alumnas entran y usan el portal como siempre." },
  { valor: "Mantenimiento", titulo: "🔧 Portal en mantenimiento", detalle: "Nadie entra. Ven: \"Estamos dando mantenimiento al portal\"." },
  { valor: "Mejoras", titulo: "✨ Haciendo mejoras / agregando algo nuevo", detalle: "Nadie entra. Ven: \"¡Estamos preparando algo nuevo para ti!\"." },
];
const LLAVE_ACCESO_PRUEBA_PORTAL = "move_acceso_prueba_portal";

let estadoPortalActual = { estado: "Activo", mensaje: "" };

async function cargarEstadoPortal() {
  const cont = el("opcionesEstadoPortal");
  const mensajeEl = el("mensajeEstadoPortal");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  renderAccesoPruebaPortal();
  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerEstadoPortal", clave: claveRecepcion });
    estadoPortalActual = { estado: datos.estado || "Activo", mensaje: datos.mensaje || "" };
    el("inputMensajePortal").value = estadoPortalActual.mensaje;
    renderEstadoPortal();
    if (datos.forzado) {
      mensajeEl.textContent = "⚠️ Entorno de prueba: el estado está forzado con ESTADO_PORTAL_FORZADO y no se guarda.";
    }
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderEstadoPortal() {
  const cont = el("opcionesEstadoPortal");
  cont.innerHTML = "";
  OPCIONES_ESTADO_PORTAL.forEach((op) => {
    const activo = estadoPortalActual.estado === op.valor;
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.setAttribute("aria-pressed", activo ? "true" : "false");
    const nombre = document.createElement("span");
    nombre.className = "tarjeta-resultado-nombre";
    nombre.textContent = op.titulo + (activo ? " — ACTIVO AHORA" : "");
    const detalle = document.createElement("span");
    detalle.className = "tarjeta-resultado-detalle";
    detalle.textContent = op.detalle;
    tarjeta.append(nombre, detalle);
    if (!activo) tarjeta.addEventListener("click", () => guardarEstadoPortal(op.valor, true));
    cont.appendChild(tarjeta);
  });
}

async function guardarEstadoPortal(estado, confirmar) {
  if (confirmar) {
    const pregunta =
      estado === "Activo"
        ? "¿Volver a abrir el portal? Las alumnas podrán entrar de nuevo."
        : "¿Cerrar el portal de alumnas? Nadie podrá entrar (ni quien ya tenía sesión abierta) hasta que lo vuelvas a activar.";
    if (!window.confirm(pregunta)) return;
  }
  const mensajeEl = el("mensajeEstadoPortal");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";
  try {
    const datos = await llamarWorker({
      accion: "recepcionGuardarEstadoPortal",
      clave: claveRecepcion,
      estado,
      mensaje: el("inputMensajePortal").value.trim(),
    });
    estadoPortalActual = { estado: datos.estado, mensaje: datos.mensaje || "" };
    renderEstadoPortal();
    mensajeEl.textContent =
      datos.estado === "Activo"
        ? "✅ Listo — el portal está activo."
        : "✅ Listo — el portal quedó cerrado. Se aplica en unos segundos.";
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

function renderAccesoPruebaPortal() {
  let guardado = null;
  try {
    guardado = JSON.parse(localStorage.getItem(LLAVE_ACCESO_PRUEBA_PORTAL) || "null");
  } catch (e) {}
  const vigente = guardado && Date.now() < Number(guardado.expira);
  el("textoAccesoPruebaPortal").textContent = vigente
    ? `✅ Este navegador tiene acceso de prueba hasta las ${new Date(Number(guardado.expira)).toLocaleString("es-GT", {
        timeZone: "America/Guatemala",
        hour: "numeric",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      })}.`
    : "Este navegador no tiene acceso de prueba.";
  el("btnQuitarAccesoPrueba").hidden = !vigente;
}

async function activarAccesoPruebaPortal() {
  const mensajeEl = el("mensajeEstadoPortal");
  mensajeEl.className = "mensaje-form";
  try {
    const datos = await llamarWorker({ accion: "recepcionGenerarAccesoPruebaPortal", clave: claveRecepcion });
    localStorage.setItem(LLAVE_ACCESO_PRUEBA_PORTAL, JSON.stringify({ ficha: datos.ficha, expira: datos.expira }));
    mensajeEl.textContent = "✅ Acceso de prueba activado. Abre el portal en este mismo navegador.";
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
  renderAccesoPruebaPortal();
}

function quitarAccesoPruebaPortal() {
  try {
    localStorage.removeItem(LLAVE_ACCESO_PRUEBA_PORTAL);
  } catch (e) {}
  renderAccesoPruebaPortal();
  el("mensajeEstadoPortal").textContent = "Acceso de prueba quitado de este navegador.";
}

// ==========================================
// ANUNCIOS (interruptor GLOBAL — mismo patrón que asistencia/chat —
// más el formulario para escribir y mandar un anuncio/recordatorio a
// las familias, a las maestras, o a ambas)
// ==========================================

const OPCIONES_CANAL_ANUNCIOS = [
  {
    valor: "WhatsApp",
    titulo: "📱 WhatsApp",
    descripcion: "Los anuncios llegan por WhatsApp (GREEN-API), mandados uno por uno para no verse como mensajería masiva.",
  },
  {
    valor: "Portal",
    titulo: "🔔 Portal",
    descripcion:
      "Los anuncios llegan como notificación push del Portal. Solo le llega a quienes ya activaron las notificaciones (familias: Portal de Alumnas; maestras: Portal de Maestras) — quienes no las hayan activado NO reciben ningún aviso, aunque sí queda guardado en su Portal para que lo vean al entrar.",
  },
];

const OPCIONES_DESTINATARIO_ANUNCIO = ["Familias", "Maestras", "Ambas"];

let canalAnunciosActual = "";

async function cargarCanalAnuncios() {
  const cont = el("opcionesCanalAnuncios");
  const mensajeEl = el("mensajeCanalAnuncios");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerCanalAnuncios", clave: claveRecepcion });
    canalAnunciosActual = datos.canal || "WhatsApp";
    renderCanalAnuncios();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderCanalAnuncios() {
  const cont = el("opcionesCanalAnuncios");
  cont.innerHTML = "";

  OPCIONES_CANAL_ANUNCIOS.forEach((op) => {
    const activo = canalAnunciosActual === op.valor;

    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${op.titulo}${activo ? " — ✅ Activo ahora para todas" : ""}</span>
      <span class="tarjeta-resultado-detalle">${op.descripcion}</span>
    `;
    tarjeta.disabled = activo;
    tarjeta.addEventListener("click", () => elegirCanalAnuncios(op.valor, op.titulo));
    cont.appendChild(tarjeta);
  });
}

async function elegirCanalAnuncios(canal, titulo) {
  const confirmado = window.confirm(
    `¿Cambiar el canal de anuncios a ${titulo} para TODOS los anuncios? Este cambio aplica de inmediato.`
  );
  if (!confirmado) return;

  const mensajeEl = el("mensajeCanalAnuncios");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";

  try {
    await llamarWorker({ accion: "recepcionGuardarCanalAnuncios", clave: claveRecepcion, canal });
    canalAnunciosActual = canal;
    renderCanalAnuncios();
    mensajeEl.textContent = `✅ Listo — los anuncios ahora llegan por ${titulo}.`;
    mensajeEl.classList.add("mensaje-form-ok");
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  }
}

let archivoAnuncio = null;

function prepararFormularioAnuncio() {
  poblarSelectSimple("selectAnuncioDestinatario", OPCIONES_DESTINATARIO_ANUNCIO, false);
  el("inputAnuncioTitulo").value = "";
  el("inputAnuncioMensaje").value = "";
  el("inputAdjuntoAnuncio").value = "";
  el("nombreAdjuntoAnuncio").hidden = true;
  archivoAnuncio = null;
  const mensajeEl = el("mensajeAnuncio");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
}

el("inputAdjuntoAnuncio").addEventListener("change", () => {
  const archivo = el("inputAdjuntoAnuncio").files[0];
  if (!archivo) return;
  const error = errorArchivoParaAirtable(archivo);
  if (error) {
    alert(error);
    el("inputAdjuntoAnuncio").value = "";
    return;
  }
  archivoAnuncio = archivo;
  const nombreEl = el("nombreAdjuntoAnuncio");
  nombreEl.textContent = "📎 " + archivo.name;
  nombreEl.hidden = false;
});

el("btnMandarAnuncio").addEventListener("click", async () => {
  const titulo = el("inputAnuncioTitulo").value.trim();
  const mensaje = el("inputAnuncioMensaje").value.trim();
  const destinatario = el("selectAnuncioDestinatario").value;
  const mensajeEl = el("mensajeAnuncio");

  if (!titulo) {
    mensajeEl.textContent = "Escribe un título para el anuncio.";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }
  if (!mensaje) {
    mensajeEl.textContent = "Escribe el mensaje del anuncio.";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }

  const aQuien = destinatario === "Ambas" ? "FAMILIAS y MAESTRAS" : destinatario === "Familias" ? "TODAS las familias" : "TODAS las maestras";
  const confirmado = window.confirm(`¿Mandar este anuncio a ${aQuien}?\n\n"${titulo}"\n\n${mensaje}`);
  if (!confirmado) return;

  const btn = el("btnMandarAnuncio");
  btn.disabled = true;
  btn.textContent = "Mandando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    const payload = { accion: "recepcionMandarAnuncio", clave: claveRecepcion, titulo, mensaje, destinatario };

    if (archivoAnuncio) {
      btn.textContent = "Subiendo archivo...";
      const preparado = await prepararArchivoParaAirtable(archivoAnuncio);
      payload.archivoBase64 = preparado.base64;
      payload.nombreArchivo = preparado.nombre;
      payload.tipoArchivo = preparado.tipo;
      btn.textContent = "Mandando...";
    }

    const datos = await llamarWorker(payload);
    mensajeEl.textContent = "✅ " + (datos.resumen || "Anuncio mandado.");
    mensajeEl.classList.add("mensaje-form-ok");
    el("inputAnuncioTitulo").value = "";
    el("inputAnuncioMensaje").value = "";
    el("inputAdjuntoAnuncio").value = "";
    el("nombreAdjuntoAnuncio").hidden = true;
    archivoAnuncio = null;
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📢 Mandar anuncio";
  }
});

let archivosAvisoImportante = [];

function prepararFormularioAvisoImportante() {
  el("inputAvisoImportanteMensaje").value = "";
  el("inputAdjuntosAvisoImportante").value = "";
  archivosAvisoImportante = [];
  renderAdjuntosAvisoImportante();
  const mensajeEl = el("mensajeAvisoImportante");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
}

function renderAdjuntosAvisoImportante() {
  const cont = el("listaAdjuntosAvisoImportante");
  cont.innerHTML = "";
  archivosAvisoImportante.forEach((archivo, indice) => {
    const fila = document.createElement("div");
    fila.className = "tarjeta-resultado";
    fila.style.cssText = "flex-direction:row;align-items:center;justify-content:space-between;cursor:default;";
    fila.innerHTML = `<span class="tarjeta-resultado-nombre">📎 ${archivo.name}</span>`;
    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn-enlace";
    btnQuitar.textContent = "Quitar";
    btnQuitar.addEventListener("click", () => {
      archivosAvisoImportante.splice(indice, 1);
      renderAdjuntosAvisoImportante();
    });
    fila.appendChild(btnQuitar);
    cont.appendChild(fila);
  });
}

el("inputAdjuntosAvisoImportante").addEventListener("change", () => {
  const nuevos = Array.from(el("inputAdjuntosAvisoImportante").files || []);
  el("inputAdjuntosAvisoImportante").value = "";
  for (const archivo of nuevos) {
    const error = errorArchivoParaAirtable(archivo);
    if (error) {
      alert(`"${archivo.name}": ${error}`);
      continue;
    }
    archivosAvisoImportante.push(archivo);
  }
  renderAdjuntosAvisoImportante();
});

el("btnPublicarAvisoImportante").addEventListener("click", async () => {
  const mensaje = el("inputAvisoImportanteMensaje").value.trim();
  const mensajeEl = el("mensajeAvisoImportante");

  if (!mensaje) {
    mensajeEl.textContent = "Escribe el mensaje del aviso.";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }

  const confirmado = window.confirm(`¿Publicar este aviso para TODAS las familias?\n\n${mensaje}`);
  if (!confirmado) return;

  const btn = el("btnPublicarAvisoImportante");
  btn.disabled = true;
  btn.textContent = "Publicando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    const archivos = [];
    for (const archivo of archivosAvisoImportante) {
      btn.textContent = `Subiendo ${archivo.name}...`;
      const preparado = await prepararArchivoParaAirtable(archivo);
      archivos.push({
        archivoBase64: preparado.base64,
        nombreArchivo: preparado.nombre,
        tipoArchivo: preparado.tipo,
      });
    }
    btn.textContent = "Publicando...";

    const datos = await llamarWorker({
      accion: "recepcionMandarAvisoImportante",
      clave: claveRecepcion,
      mensaje,
      archivos,
    });
    mensajeEl.textContent = "✅ " + (datos.resumen || "Aviso publicado.");
    mensajeEl.classList.add("mensaje-form-ok");
    prepararFormularioAvisoImportante();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📋 Publicar aviso";
  }
});

// ==========================================
// LAS EXTRAÑAMOS
// Alumnas activas y monitoreadas (mismo criterio que el aviso semanal
// de WhatsApp: ESTADO=ACTIVA + CLASES SEMANA puesto) que llevan 5 días
// hábiles o más sin ninguna clase. A propósito NO es un reporte de
// cobranza/bajas — es para que Recepción les escriba como gesto de
// comunidad, así que el tono es cálido en vez de administrativo.
// ==========================================

function formatearFechaCortaExtranamos(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-GT", {
      timeZone: "America/Guatemala",
      day: "numeric",
      month: "short",
    });
  } catch (e) {
    return "";
  }
}

async function cargarExtranamos() {
  const cont = el("listaExtranamos");
  const mensajeError = el("mensajeErrorExtranamos");
  mensajeError.textContent = "";
  el("mensajeProbarInasistencias").textContent = "";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionAlumnasSinAsistencia", clave: claveRecepcion });
    renderExtranamos(datos.alumnas || []);
  } catch (e) {
    cont.innerHTML = "";
    mensajeError.textContent = e.message;
  }
}

function renderExtranamos(alumnas) {
  const cont = el("listaExtranamos");
  cont.innerHTML = "";

  if (!alumnas.length) {
    cont.innerHTML = '<p class="lista-vacia">¡Nadie lleva 5 días hábiles o más sin venir! 💗</p>';
    return;
  }

  alumnas.forEach((a) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta-resultado";
    tarjeta.style.cursor = "default";

    const nombre = document.createElement("span");
    nombre.className = "tarjeta-resultado-nombre";
    nombre.textContent = a.nombre;
    tarjeta.appendChild(nombre);

    const grupos = document.createElement("span");
    grupos.className = "tarjeta-resultado-detalle";
    grupos.textContent = a.grupos && a.grupos.length ? a.grupos.join(", ") : "(sin grupo)";
    tarjeta.appendChild(grupos);

    const detalle = document.createElement("span");
    detalle.className = "tarjeta-resultado-detalle";
    detalle.textContent =
      `Última clase: hace ${a.diasHabiles} día${a.diasHabiles === 1 ? "" : "s"} hábil${a.diasHabiles === 1 ? "" : "es"}` +
      (a.ultimaFecha ? ` (${formatearFechaCortaExtranamos(a.ultimaFecha)})` : "");
    tarjeta.appendChild(detalle);

    cont.appendChild(tarjeta);
  });
}

el("btnProbarInasistencias").addEventListener("click", async () => {
  const btn = el("btnProbarInasistencias");
  const mensajeEl = el("mensajeProbarInasistencias");
  btn.disabled = true;
  btn.textContent = "Revisando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    const datos = await llamarWorker({ accion: "recepcionProbarInasistenciasSemanales", clave: claveRecepcion });
    const faltantes = datos.faltantes || [];

    if (datos.error) {
      mensajeEl.textContent = "⚠️ Encontró un error: " + datos.error;
      mensajeEl.classList.add("mensaje-form-error");
    } else if (!faltantes.length) {
      mensajeEl.textContent = "✅ Revisado: nadie de las monitoreadas faltó TODA la semana (no se manda WhatsApp).";
      mensajeEl.classList.add("mensaje-form-ok");
    } else if (datos.enviado) {
      mensajeEl.textContent = `✅ Se encontraron ${faltantes.length} alumna(s) sin ninguna clase esta semana y el WhatsApp SÍ se mandó a Recepción: ${faltantes.map((f) => f.nombre).join(", ")}.`;
      mensajeEl.classList.add("mensaje-form-ok");
    } else {
      mensajeEl.textContent = `⚠️ Se encontraron ${faltantes.length} alumna(s), pero el WhatsApp NO se pudo mandar: ${datos.error || "error desconocido"}.`;
      mensajeEl.classList.add("mensaje-form-error");
    }
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔔 Probar aviso de inasistencias semanal ahora";
  }
});

el("btnProbarRacha").addEventListener("click", async () => {
  const confirmado = window.confirm(
    "Esto SÍ puede mandar notificaciones push reales a las alumnas con racha ≥ 2 semanas que todavía no hayan sido notificadas esta semana (aunque lo corras varias veces, a cada una solo le llega una vez por semana). ¿Continuar?"
  );
  if (!confirmado) return;

  const btn = el("btnProbarRacha");
  const mensajeEl = el("mensajeProbarRacha");
  btn.disabled = true;
  btn.textContent = "Revisando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    const datos = await llamarWorker({ accion: "recepcionProbarNotificacionRacha", clave: claveRecepcion });
    const notificadas = datos.notificadas || [];
    const omitidas = datos.omitidas || [];

    if (datos.error) {
      mensajeEl.textContent = "⚠️ Encontró un error: " + datos.error;
      mensajeEl.classList.add("mensaje-form-error");
    } else if (!notificadas.length && !omitidas.length) {
      mensajeEl.textContent = "✅ Revisado: ninguna alumna tiene racha de 2 semanas o más ahorita.";
      mensajeEl.classList.add("mensaje-form-ok");
    } else {
      const partes = [];
      if (notificadas.length) {
        partes.push(`✅ Se mandó push a ${notificadas.length}: ${notificadas.map((n) => `${n.nombre} (${n.racha} sem.)`).join(", ")}.`);
      }
      if (omitidas.length) {
        partes.push(`ℹ️ ${omitidas.length} ya estaban notificadas esta semana (no se les volvió a mandar): ${omitidas.map((n) => n.nombre).join(", ")}.`);
      }
      mensajeEl.textContent = partes.join(" ");
      mensajeEl.classList.add("mensaje-form-ok");
    }
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔥 Probar push de racha semanal ahora";
  }
});

// ==========================================
// DÍAS FERIADOS
// Fechas en las que la academia no tuvo clase — una semana que
// contenga alguna de estas fechas no le rompe la racha de asistencia
// a ninguna alumna en el Portal. Se mantienen aquí, sin ir a Airtable
// directo.
// ==========================================

function formatearFechaFeriado(fechaIso) {
  if (!fechaIso) return "";
  try {
    return new Date(`${fechaIso}T12:00:00`).toLocaleDateString("es-GT", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch (e) {
    return fechaIso;
  }
}

async function cargarFeriados() {
  const cont = el("listaFeriados");
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionListarFeriados", clave: claveRecepcion });
    renderFeriados(datos.feriados || []);
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderFeriados(feriados) {
  const cont = el("listaFeriados");
  cont.innerHTML = "";

  if (!feriados.length) {
    cont.innerHTML = '<p class="lista-vacia">Todavía no has agregado ningún feriado.</p>';
    return;
  }

  feriados.forEach((f) => {
    const fila = document.createElement("div");
    fila.className = "tarjeta-resultado";
    fila.style.cssText = "flex-direction:row;align-items:center;justify-content:space-between;cursor:default;";

    const texto = document.createElement("div");
    texto.innerHTML =
      `<span class="tarjeta-resultado-nombre">${f.nombre}</span><br>` +
      `<span class="tarjeta-resultado-detalle">${formatearFechaFeriado(f.fecha)}</span>`;
    fila.appendChild(texto);

    const btnBorrar = document.createElement("button");
    btnBorrar.type = "button";
    btnBorrar.className = "btn-enlace";
    btnBorrar.textContent = "Borrar";
    btnBorrar.addEventListener("click", () => eliminarFeriado(f.id, f.nombre));
    fila.appendChild(btnBorrar);

    cont.appendChild(fila);
  });
}

el("btnAgregarFeriado").addEventListener("click", async () => {
  const fecha = el("inputFeriadoFecha").value;
  const nombre = el("inputFeriadoNombre").value.trim();
  const mensajeEl = el("mensajeFeriado");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  if (!fecha) {
    mensajeEl.textContent = "Elige una fecha.";
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }
  if (!nombre) {
    mensajeEl.textContent = "Escribe el nombre del feriado.";
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }

  const btn = el("btnAgregarFeriado");
  btn.disabled = true;
  btn.textContent = "Agregando...";

  try {
    await llamarWorker({ accion: "recepcionAgregarFeriado", clave: claveRecepcion, fecha, nombre });
    el("inputFeriadoFecha").value = "";
    el("inputFeriadoNombre").value = "";
    mensajeEl.textContent = "✅ Feriado agregado.";
    mensajeEl.classList.add("mensaje-form-ok");
    cargarFeriados();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Agregar feriado";
  }
});

async function eliminarFeriado(id, nombre) {
  const confirmado = window.confirm(`¿Borrar "${nombre}" de la lista de feriados?`);
  if (!confirmado) return;

  const mensajeEl = el("mensajeFeriado");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    await llamarWorker({ accion: "recepcionEliminarFeriado", clave: claveRecepcion, id });
    cargarFeriados();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
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
  } else if (cfg.tipo === "toggle2") {
    const cont = document.createElement("div");
    cont.className = "chips-contenedor";
    cont.id = idControl;
    const valorActual = valor || cfg.valorPorDefecto || cfg.opciones[0];
    cfg.opciones.forEach((op, i) => {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "chip" + (valorActual === op ? " activo" : "");
      boton.textContent = (cfg.etiquetas && cfg.etiquetas[i]) || op;
      boton.dataset.valor = op;
      boton.addEventListener("click", () => {
        cont.querySelectorAll(".chip").forEach((b) => b.classList.remove("activo"));
        boton.classList.add("activo");
      });
      cont.appendChild(boton);
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
  if (cfg.tipo === "toggle2") {
    const activo = control.querySelector(".chip.activo");
    return activo ? activo.dataset.valor : cfg.valorPorDefecto || cfg.opciones[0];
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
  const error = errorArchivoParaAirtable(archivo, { soloFotos: true });
  if (error) {
    alert(error);
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
        const preparado = await prepararArchivoParaAirtable(archivoFotoAlumna, { soloFotos: true });
        await llamarWorker({
          accion: "recepcionSubirFotoAlumna",
          clave: claveRecepcion,
          alumnaId,
          archivoBase64: preparado.base64,
          nombreArchivo: preparado.nombre,
          tipoArchivo: preparado.tipo,
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
  { id: "link_mes_actual", texto: "🔗 Link (mes actual)" },
  { id: "link_recepcion_mes_actual", texto: "🔗 Link Recepción (mes actual)" },
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
    tarjeta.className = "tarjeta-resultado tarjeta-pago";
    const detalle2 = [p.formaPago, p.fechaPago].filter(Boolean).join(" · ");
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${p.alumna || "(Sin nombre)"} — ${p.mes || ""} ${p.anio || ""}</span>
      <span class="tarjeta-resultado-detalle">${p.estado || "—"}${p.mensualidad ? " · Q" + p.mensualidad : ""}${
      p.mora ? " · Mora Q" + p.mora : ""
    }${p.tieneComprobante ? " · 📎" : ""}</span>
      ${detalle2 ? `<span class="tarjeta-resultado-detalle">${detalle2}</span>` : ""}
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

  const error = errorArchivoParaAirtable(archivo);
  if (error) {
    mensajeEl.textContent = error;
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }

  mensajeEl.textContent = "Subiendo...";
  mensajeEl.className = "mensaje-form";

  try {
    const preparado = await prepararArchivoParaAirtable(archivo);
    await llamarWorker({
      accion: "subirComprobante",
      // La clave deja pasar la subida aunque el Portal de Alumnas esté
      // en mantenimiento (esta acción también la usa el portal).
      clave: claveRecepcion,
      pagoId: pagoEditandoId,
      archivoBase64: preparado.base64,
      nombreArchivo: preparado.nombre,
      tipoArchivo: preparado.tipo,
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

// ==========================================
// ALUMNAS SHOW
// Catálogo de bailes/trajes del show, qué alumna sale en cuál, resumen
// por baile y el link de solo lectura para la modista. Todo lo guarda
// el Worker (acciones show*), que es quien valida la clave, evita
// duplicar a una alumna en el mismo baile y pone su SHOW en "SI SALE"
// cuando se le asigna al menos un baile.
//
// Los nombres (de alumnas, bailes y grupos) se pintan siempre con
// textContent, nunca dentro de innerHTML: los escribe gente y podrían
// traer caracteres como < o &.
// ==========================================

let showDatos = null; // { grupos:[{id,nombre,activo}], bailes:[{id,nombre,grupoId,grupoNombre,precio,activo,alumnas:[...]}] }
let showAlumnas = null; // [{id,nombre,show,grupoIds}] — se carga al abrir "Asignar alumnas"
let showAlumnaElegida = null;
let showBaileEditandoId = "";
let showPestanaActual = "Catalogo";

function limpiarShow() {
  pagosModista = null;
  showResultadosBusqueda = null;
  showDatos = null;
  showAlumnas = null;
  showAlumnaElegida = null;
  showBaileEditandoId = "";
}

function crearEl(tag, clase, texto) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function formatoQuetzales(monto) {
  if (typeof monto !== "number") return "Sin precio";
  return "Q" + monto.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mensajeShow(id, texto, tipo) {
  const m = el(id);
  m.textContent = texto || "";
  m.className = "mensaje-form" + (tipo ? ` mensaje-form-${tipo}` : "");
}

async function abrirShow() {
  mensajeShow("mensajeShow", "");
  cambiarPestanaShow(showPestanaActual);
  await recargarDatosShow();
}

document.querySelectorAll("[data-show-pestana]").forEach((chip) => {
  chip.addEventListener("click", () => cambiarPestanaShow(chip.dataset.showPestana));
});

function cambiarPestanaShow(nombre) {
  showPestanaActual = nombre;
  document.querySelectorAll("[data-show-pestana]").forEach((chip) => {
    chip.classList.toggle("activo", chip.dataset.showPestana === nombre);
  });
  ["Catalogo", "Asignar", "Resumen", "Pagos", "Modista"].forEach((n) => {
    el("vistaShow" + n).hidden = n !== nombre;
  });
  if (nombre === "Asignar" && !showAlumnas) cargarAlumnasShow();
  if (nombre === "Pagos") cargarPagosModista();
  if (nombre === "Modista") cargarLinkModista();
}

async function recargarDatosShow() {
  try {
    showDatos = await llamarWorker({ accion: "showRecepcionDatos", clave: claveRecepcion });
    mensajeShow("mensajeShow", "");
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
    return;
  }
  renderSelectGruposBaile();
  renderCatalogoShow();
  renderResumenShow();
  renderChecklistBailesPago();
  if (showAlumnaElegida) renderAlumnaShow();
}

// ---------- a) Catálogo ----------

function renderSelectGruposBaile() {
  const select = el("selectShowGrupoBaile");
  const elegido = select.value;
  select.innerHTML = "";
  const vacio = crearEl("option", "", "Escoge un grupo...");
  vacio.value = "";
  select.appendChild(vacio);
  showDatos.grupos.forEach((g) => {
    const op = crearEl("option", "", g.nombre + (g.activo ? "" : " (inactivo)"));
    op.value = g.id;
    select.appendChild(op);
  });
  select.value = elegido;
}

// Bailes agrupados por Grupo MOVE, en el orden que ya manda el Worker.
function bailesPorGrupoShow() {
  const grupos = new Map();
  showDatos.bailes.forEach((b) => {
    if (!grupos.has(b.grupoNombre)) grupos.set(b.grupoNombre, []);
    grupos.get(b.grupoNombre).push(b);
  });
  return grupos;
}

function renderCatalogoShow() {
  const cont = el("listaShowBailes");
  cont.innerHTML = "";
  if (!showDatos.bailes.length) {
    cont.appendChild(crearEl("p", "lista-vacia", "Todavía no hay bailes. Agrega el primero arriba. 💃"));
    return;
  }
  bailesPorGrupoShow().forEach((bailes, grupoNombre) => {
    cont.appendChild(crearEl("p", "show-grupo-titulo", grupoNombre));
    bailes.forEach((b) => {
      const tarjeta = crearEl("div", "show-tarjeta" + (b.activo ? "" : " inactivo"));
      const fila = crearEl("div", "show-tarjeta-fila");
      fila.appendChild(crearEl("span", "show-tarjeta-nombre", b.nombre));
      if (!b.activo) fila.appendChild(crearEl("span", "show-etiqueta show-etiqueta-gris", "Desactivado"));
      tarjeta.appendChild(fila);
      tarjeta.appendChild(
        crearEl(
          "span",
          "tarjeta-resultado-detalle",
          `${formatoQuetzales(b.precio)} · ${b.alumnas.length} alumna${b.alumnas.length === 1 ? "" : "s"}`
        )
      );

      const acciones = crearEl("div", "show-acciones");
      const btnEditar = crearEl("button", "btn-secundario btn-chico", "✏️ Editar");
      btnEditar.type = "button";
      btnEditar.addEventListener("click", () => editarBaileShow(b));
      const btnActivar = crearEl("button", "btn-secundario btn-chico", b.activo ? "⏸ Desactivar" : "▶️ Activar");
      btnActivar.type = "button";
      btnActivar.addEventListener("click", () => activarBaileShow(b, !b.activo, btnActivar));
      const btnEliminar = crearEl("button", "btn-secundario btn-chico show-btn-peligro", "🗑 Eliminar");
      btnEliminar.type = "button";
      btnEliminar.addEventListener("click", () => eliminarBaileShow(b, btnEliminar));
      acciones.append(btnEditar, btnActivar, btnEliminar);
      tarjeta.appendChild(acciones);
      cont.appendChild(tarjeta);
    });
  });
}

function editarBaileShow(baile) {
  showBaileEditandoId = baile.id;
  el("tituloFormBaile").textContent = "Editar baile";
  el("selectShowGrupoBaile").value = baile.grupoId;
  el("inputShowNombreBaile").value = baile.nombre;
  el("inputShowPrecioBaile").value = typeof baile.precio === "number" ? baile.precio : "";
  el("btnGuardarBaile").textContent = "Guardar cambios";
  el("btnCancelarEdicionBaile").hidden = false;
  mensajeShow("mensajeFormBaile", "");
  el("tituloFormBaile").scrollIntoView({ behavior: "smooth", block: "start" });
}

function limpiarFormularioBaile() {
  showBaileEditandoId = "";
  el("tituloFormBaile").textContent = "Agregar baile";
  el("inputShowNombreBaile").value = "";
  el("inputShowPrecioBaile").value = "";
  el("btnGuardarBaile").textContent = "Agregar baile";
  el("btnCancelarEdicionBaile").hidden = true;
}

el("btnCancelarEdicionBaile").addEventListener("click", () => {
  limpiarFormularioBaile();
  mensajeShow("mensajeFormBaile", "");
});

el("btnGuardarBaile").addEventListener("click", async () => {
  const grupoId = el("selectShowGrupoBaile").value;
  const nombre = el("inputShowNombreBaile").value.trim();
  const precio = el("inputShowPrecioBaile").value;
  if (!grupoId) return mensajeShow("mensajeFormBaile", "Escoge el Grupo MOVE.", "error");
  if (!nombre) return mensajeShow("mensajeFormBaile", "Escribe el nombre del baile.", "error");
  if (precio === "" || Number(precio) < 0) {
    return mensajeShow("mensajeFormBaile", "Escribe el precio del traje.", "error");
  }

  const boton = el("btnGuardarBaile");
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    const editando = Boolean(showBaileEditandoId);
    await llamarWorker({
      accion: "showGuardarBaile",
      clave: claveRecepcion,
      baileId: showBaileEditandoId || undefined,
      grupoId,
      nombre,
      precio: Number(precio),
    });
    limpiarFormularioBaile();
    mensajeShow("mensajeFormBaile", editando ? "✅ Cambios guardados." : "✅ Baile agregado.", "ok");
    await recargarDatosShow();
  } catch (e) {
    boton.textContent = textoOriginal;
    mensajeShow("mensajeFormBaile", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

async function activarBaileShow(baile, activo, boton) {
  boton.disabled = true;
  try {
    await llamarWorker({ accion: "showActivarBaile", clave: claveRecepcion, baileId: baile.id, activo });
    await recargarDatosShow();
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
    boton.disabled = false;
  }
}

async function eliminarBaileShow(baile, boton) {
  const total = baile.alumnas.length;
  const pagos = baile.pagosModista || 0;
  const avisoPagos = pagos
    ? `\n\nTiene ${pagos} pago${pagos === 1 ? "" : "s"} a la modista vinculado${pagos === 1 ? "" : "s"}: ` +
      "esos pagos se quedan, solo dejan de mostrar este baile."
    : "";
  const aviso =
    (total > 0
      ? `⚠️ "${baile.nombre}" tiene ${total} alumna${total === 1 ? "" : "s"} asignada${total === 1 ? "" : "s"}.\n\n` +
        "Si lo eliminas, también se borran esas asignaciones (y la modista deja de ver ese baile). " +
        "Si solo quieres ocultarlo, usa \"Desactivar\".\n\n¿Eliminarlo de todos modos?"
      : `¿Eliminar el baile "${baile.nombre}"? Esto no se puede deshacer.`) + avisoPagos;
  if (!window.confirm(aviso)) return;

  boton.disabled = true;
  try {
    await llamarWorker({ accion: "showEliminarBaile", clave: claveRecepcion, baileId: baile.id, confirmar: true });
    if (showBaileEditandoId === baile.id) limpiarFormularioBaile();
    mensajeShow("mensajeShow", `✅ Se eliminó "${baile.nombre}".`, "ok");
    await recargarDatosShow();
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
    boton.disabled = false;
  }
}

// ---------- b) Asignación de alumnas ----------

// Sin texto se muestran las ACTIVAS (se cargan una vez y se guardan en
// showAlumnas). Al escribir, el Worker busca por nombre en TODAS las
// alumnas (cualquier ESTADO): a veces se inscriben y se salen, pero igual
// deben pagar su traje. Se busca en el Worker, no aquí, para no traer todo
// el histórico de alumnas antiguas a la tablet.
let showResultadosBusqueda = null; // { texto, alumnas, hayMas }
let showBusquedaPendiente = null;
let showNumeroBusqueda = 0;

async function cargarAlumnasShow() {
  el("listaShowAlumnas").innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const datos = await llamarWorker({ accion: "showListarAlumnas", clave: claveRecepcion });
    showAlumnas = datos.alumnas;
    renderListaAlumnasShow();
  } catch (e) {
    el("listaShowAlumnas").innerHTML = "";
    el("listaShowAlumnas").appendChild(crearEl("p", "lista-vacia", e.message));
  }
}

async function buscarAlumnasShow() {
  const texto = el("inputShowBuscarAlumna").value.trim();
  if (!texto) {
    showResultadosBusqueda = null;
    renderListaAlumnasShow();
    return;
  }
  // Si llegan respuestas fuera de orden, solo cuenta la de lo último escrito.
  const numero = ++showNumeroBusqueda;
  el("listaShowAlumnas").innerHTML = '<p class="lista-vacia">Buscando...</p>';
  try {
    const datos = await llamarWorker({ accion: "showListarAlumnas", clave: claveRecepcion, busqueda: texto });
    if (numero !== showNumeroBusqueda) return;
    showResultadosBusqueda = { texto, alumnas: datos.alumnas, hayMas: datos.hayMas };
    renderListaAlumnasShow();
  } catch (e) {
    if (numero !== showNumeroBusqueda) return;
    el("listaShowAlumnas").innerHTML = "";
    el("listaShowAlumnas").appendChild(crearEl("p", "lista-vacia", e.message));
  }
}

// Solo para las que NO están activas ("INACTIVA", "SIN ESTADO").
function etiquetaEstadoAlumna(estado) {
  return estado ? crearEl("span", "show-etiqueta show-etiqueta-estado", estado) : null;
}

function etiquetaShowAlumna(show) {
  const clases = { "SI SALE": "show-etiqueta-si", "NO SALE": "show-etiqueta-no", PENDIENTE: "show-etiqueta-pendiente" };
  return crearEl("span", "show-etiqueta " + (clases[show] || "show-etiqueta-gris"), show || "Sin dato");
}

function renderListaAlumnasShow() {
  const cont = el("listaShowAlumnas");
  cont.innerHTML = "";
  const buscando = Boolean(showResultadosBusqueda);
  const lista = buscando ? showResultadosBusqueda.alumnas : showAlumnas;
  if (!lista) return;
  if (!lista.length) {
    cont.appendChild(crearEl("p", "lista-vacia", buscando ? "No se encontró ninguna alumna con ese nombre." : "No hay alumnas activas."));
    return;
  }
  const bailesPorAlumna = contarBailesPorAlumna();
  lista.forEach((a) => {
    const tarjeta = crearEl("button", "tarjeta-resultado");
    tarjeta.type = "button";
    const fila = crearEl("span", "show-tarjeta-fila");
    fila.appendChild(crearEl("span", "tarjeta-resultado-nombre", a.nombre));
    const etiquetas = crearEl("span", "show-etiquetas");
    const estado = etiquetaEstadoAlumna(a.estado);
    if (estado) etiquetas.appendChild(estado);
    etiquetas.appendChild(etiquetaShowAlumna(a.show));
    fila.appendChild(etiquetas);
    tarjeta.appendChild(fila);
    const n = bailesPorAlumna.get(a.id) || 0;
    tarjeta.appendChild(crearEl("span", "tarjeta-resultado-detalle", n ? `${n} baile${n === 1 ? "" : "s"}` : "Sin bailes"));
    tarjeta.addEventListener("click", () => elegirAlumnaShow(a));
    cont.appendChild(tarjeta);
  });
  if (buscando && showResultadosBusqueda.hayMas) {
    cont.appendChild(crearEl("p", "lista-vacia", "Hay más alumnas con ese nombre: escribe más letras para encontrarla."));
  }
}

function contarBailesPorAlumna() {
  const conteo = new Map();
  (showDatos ? showDatos.bailes : []).forEach((b) => {
    b.alumnas.forEach((a) => conteo.set(a.alumnaId, (conteo.get(a.alumnaId) || 0) + 1));
  });
  return conteo;
}

el("inputShowBuscarAlumna").addEventListener("input", () => {
  clearTimeout(showBusquedaPendiente);
  showBusquedaPendiente = setTimeout(buscarAlumnasShow, 300);
});

function elegirAlumnaShow(alumna) {
  showAlumnaElegida = alumna;
  el("cajaShowBuscarAlumna").hidden = true;
  el("cajaShowAlumna").hidden = false;
  mensajeShow("mensajeAsignarShow", "");
  renderSelectGrupoAlumna();
  renderAlumnaShow();
}

el("btnShowCambiarAlumna").addEventListener("click", () => {
  showAlumnaElegida = null;
  el("cajaShowAlumna").hidden = true;
  el("cajaShowBuscarAlumna").hidden = false;
  renderListaAlumnasShow();
});

// Prellena con el primer grupo que la alumna ya tenga en "GRUPOS MOVE";
// sus grupos salen primero en la lista, pero se puede escoger cualquiera.
function renderSelectGrupoAlumna() {
  const select = el("selectShowGrupoAlumna");
  select.innerHTML = "";
  const suyos = showDatos.grupos.filter((g) => showAlumnaElegida.grupoIds.includes(g.id));
  const otros = showDatos.grupos.filter((g) => !showAlumnaElegida.grupoIds.includes(g.id));
  if (!suyos.length) {
    const vacio = crearEl("option", "", "Escoge un grupo...");
    vacio.value = "";
    select.appendChild(vacio);
  }
  [
    ["Sus grupos", suyos],
    ["Otros grupos", otros],
  ].forEach(([titulo, grupos]) => {
    if (!grupos.length) return;
    const og = document.createElement("optgroup");
    og.label = titulo;
    grupos.forEach((g) => {
      const op = crearEl("option", "", g.nombre);
      op.value = g.id;
      og.appendChild(op);
    });
    select.appendChild(og);
  });
  select.value = suyos.length ? suyos[0].id : "";
}

el("selectShowGrupoAlumna").addEventListener("change", renderChecklistBailesShow);

function renderAlumnaShow() {
  const a = showAlumnaElegida;
  const titulo = el("showAlumnaNombre");
  titulo.innerHTML = "";
  titulo.append(crearEl("span", "", a.nombre + " "));
  const estado = etiquetaEstadoAlumna(a.estado);
  if (estado) titulo.append(estado);
  titulo.append(etiquetaShowAlumna(a.show));

  const cont = el("listaShowBailesActuales");
  cont.innerHTML = "";
  const suyos = showDatos.bailes
    .map((b) => ({ baile: b, asignacion: b.alumnas.find((x) => x.alumnaId === a.id) }))
    .filter((x) => x.asignacion);
  if (!suyos.length) {
    cont.appendChild(crearEl("p", "lista-vacia", "Todavía no tiene bailes."));
  }
  suyos.forEach(({ baile, asignacion }) => {
    const tarjeta = crearEl("div", "show-tarjeta show-tarjeta-fila" + (baile.activo ? "" : " inactivo"));
    const texto = crearEl("span", "show-tarjeta-texto");
    texto.appendChild(crearEl("span", "show-tarjeta-nombre", baile.nombre));
    texto.appendChild(
      crearEl("span", "tarjeta-resultado-detalle", baile.grupoNombre + (baile.activo ? "" : " · baile desactivado"))
    );
    const quitar = crearEl("button", "btn-secundario btn-chico show-btn-peligro", "✕ Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", () => quitarAsignacionShow(baile, asignacion, quitar));
    tarjeta.append(texto, quitar);
    cont.appendChild(tarjeta);
  });

  renderChecklistBailesShow();
}

function renderChecklistBailesShow() {
  const cont = el("checklistShowBailes");
  cont.innerHTML = "";
  const grupoId = el("selectShowGrupoAlumna").value;
  const boton = el("btnGuardarAsignacionesShow");
  if (!grupoId) {
    cont.appendChild(crearEl("p", "lista-vacia", "Escoge un grupo para ver sus bailes."));
    boton.disabled = true;
    return;
  }
  const bailes = showDatos.bailes.filter((b) => b.activo && b.grupoId === grupoId);
  if (!bailes.length) {
    cont.appendChild(crearEl("p", "lista-vacia", "Este grupo todavía no tiene bailes activos. Agrégalos en \"💃 Bailes\"."));
    boton.disabled = true;
    return;
  }
  boton.disabled = false;
  bailes.forEach((b) => {
    const etiqueta = crearEl("label", "opcion-checkbox");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.value = b.id;
    casilla.checked = b.alumnas.some((x) => x.alumnaId === showAlumnaElegida.id);
    etiqueta.append(casilla, crearEl("span", "", `${b.nombre} (${b.alumnas.length})`));
    cont.appendChild(etiqueta);
  });
}

el("btnGuardarAsignacionesShow").addEventListener("click", async () => {
  const grupoId = el("selectShowGrupoAlumna").value;
  if (!showAlumnaElegida || !grupoId) return;
  const baileIds = [...el("checklistShowBailes").querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);

  const boton = el("btnGuardarAsignacionesShow");
  boton.disabled = true;
  boton.textContent = "Guardando...";
  mensajeShow("mensajeAsignarShow", "");
  try {
    const r = await llamarWorker({
      accion: "showGuardarAsignaciones",
      clave: claveRecepcion,
      alumnaId: showAlumnaElegida.id,
      grupoId,
      baileIds,
    });
    showAlumnaElegida.show = r.show;
    const partes = [];
    if (r.creadas) partes.push(`se agregó a ${r.creadas} baile${r.creadas === 1 ? "" : "s"}`);
    if (r.quitadas) partes.push(`se quitó de ${r.quitadas} baile${r.quitadas === 1 ? "" : "s"}`);
    mensajeShow("mensajeAsignarShow", partes.length ? `✅ Listo: ${partes.join(" y ")}.` : "✅ No había cambios.", "ok");
    await recargarDatosShow();
  } catch (e) {
    mensajeShow("mensajeAsignarShow", e.message, "error");
  } finally {
    boton.textContent = "Guardar bailes";
    boton.disabled = false;
  }
});

async function quitarAsignacionShow(baile, asignacion, boton) {
  if (!window.confirm(`¿Quitar a ${asignacion.nombre} del baile "${baile.nombre}"?`)) return;
  boton.disabled = true;
  try {
    await llamarWorker({ accion: "showQuitarAsignacion", clave: claveRecepcion, asignacionId: asignacion.asignacionId });
    mensajeShow("mensajeAsignarShow", `✅ Se quitó de "${baile.nombre}".`, "ok");
    await recargarDatosShow();
  } catch (e) {
    mensajeShow("mensajeAsignarShow", e.message, "error");
    boton.disabled = false;
  }
}

// ---------- Resumen por baile ----------

function renderResumenShow() {
  const cont = el("listaShowResumen");
  cont.innerHTML = "";
  if (!showDatos.bailes.length) {
    cont.appendChild(crearEl("p", "lista-vacia", "Todavía no hay bailes."));
    return;
  }
  bailesPorGrupoShow().forEach((bailes, grupoNombre) => {
    cont.appendChild(crearEl("p", "show-grupo-titulo", grupoNombre));
    bailes.forEach((b) => {
      const tarjeta = crearEl("div", "show-tarjeta" + (b.activo ? "" : " inactivo"));
      const fila = crearEl("div", "show-tarjeta-fila");
      fila.appendChild(crearEl("span", "show-tarjeta-nombre", b.nombre + (b.activo ? "" : " (desactivado)")));
      fila.appendChild(crearEl("span", "show-contador", String(b.alumnas.length)));
      tarjeta.appendChild(fila);
      const nombres = crearEl("span", "tarjeta-resultado-detalle");
      if (!b.alumnas.length) nombres.textContent = "Sin alumnas todavía";
      b.alumnas.forEach((a, i) => {
        if (i) nombres.append(", ");
        nombres.append(a.nombre);
        const estado = etiquetaEstadoAlumna(a.estado);
        if (estado) nombres.append(" ", estado);
      });
      tarjeta.appendChild(nombres);
      cont.appendChild(tarjeta);
    });
  });
}

// ---------- c) Link de la modista ----------

// El token va después del # para que no viaje al servidor de la página
// (no queda en logs ni en el "referer"); modista.html lo lee de ahí y
// se lo manda al Worker.
function urlLinkModista(token) {
  const carpeta = location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
  return `${carpeta}modista.html#t=${token}`;
}

function mostrarLinkModista(token) {
  el("inputShowLinkModista").value = token ? urlLinkModista(token) : "";
  el("btnCopiarLinkModista").disabled = !token;
  el("btnRegenerarLinkModista").textContent = token ? "🔄 Generar link nuevo (invalida el anterior)" : "✨ Generar link";
}

async function cargarLinkModista() {
  mensajeShow("mensajeModista", "Cargando...");
  try {
    const { token } = await llamarWorker({ accion: "showObtenerTokenModista", clave: claveRecepcion });
    mostrarLinkModista(token);
    mensajeShow("mensajeModista", "");
  } catch (e) {
    mensajeShow("mensajeModista", e.message, "error");
  }
}

el("btnCopiarLinkModista").addEventListener("click", async () => {
  const input = el("inputShowLinkModista");
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (e) {
    // Sin permiso de portapapeles (http, navegador viejo): se selecciona
    // el texto y se usa el método antiguo.
    input.select();
    document.execCommand("copy");
  }
  mensajeShow("mensajeModista", "✅ Link copiado. Pégalo en WhatsApp para la modista.", "ok");
});

el("btnRegenerarLinkModista").addEventListener("click", async () => {
  if (
    el("inputShowLinkModista").value &&
    !window.confirm("¿Generar un link nuevo? El link anterior dejará de funcionar y tendrás que mandarle el nuevo a la modista.")
  ) {
    return;
  }
  const boton = el("btnRegenerarLinkModista");
  boton.disabled = true;
  try {
    const { token } = await llamarWorker({ accion: "showRegenerarTokenModista", clave: claveRecepcion });
    mostrarLinkModista(token);
    mensajeShow("mensajeModista", "✅ Link nuevo listo. Cópialo y mándaselo a la modista.", "ok");
  } catch (e) {
    mensajeShow("mensajeModista", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

// ---------- d) Pagos a la modista ----------
// Recepción registra lo que se le paga a la modista (con su comprobante)
// y ella lo ve en "Mis pagos" de su link. El comprobante se guarda en
// Airtable, pero aquí nunca se usa su URL de Airtable: se le pide al
// Worker (showComprobantePagoModista) y se abre como archivo temporal.

let pagosModista = null; // [{id, fecha, monto, concepto, metodo, comprobante, bailes:[{id,nombre,grupoNombre}]}]
let hoyGuatemalaPagos = "";
let pagoModistaEditando = null;
let archivoPagoModista = null;

// "2026-10-01" → "1 oct 2026" (sin pasar por Date, para que la zona
// horaria del dispositivo no la corra un día).
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatoFechaCortaShow(fechaIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso || "");
  return m ? `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1]} ${m[1]}` : "Sin fecha";
}

async function cargarPagosModista() {
  const cont = el("listaPagosModista");
  if (!pagosModista) cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const datos = await llamarWorker({ accion: "showPagosModistaListar", clave: claveRecepcion });
    pagosModista = datos.pagos;
    hoyGuatemalaPagos = datos.hoy;
    el("totalPagosModista").textContent = formatoQuetzales(datos.total);
    el("inputPagoModistaFecha").max = datos.hoy;
    if (!pagoModistaEditando && !el("inputPagoModistaFecha").value) el("inputPagoModistaFecha").value = datos.hoy;
    renderPagosModista();
    renderChecklistBailesPago();
  } catch (e) {
    cont.innerHTML = "";
    cont.appendChild(crearEl("p", "lista-vacia", e.message));
  }
}

// Casillas de bailes agrupadas por Grupo MOVE (incluye desactivados: un
// pago puede ser de un baile que ya se ocultó).
function renderChecklistBailesPago() {
  const cont = el("checklistPagoModistaBailes");
  if (!showDatos) return;
  const marcados = new Set(
    pagoModistaEditando
      ? pagoModistaEditando.bailes.map((b) => b.id)
      : [...cont.querySelectorAll("input:checked")].map((c) => c.value)
  );
  cont.innerHTML = "";
  if (!showDatos.bailes.length) {
    cont.appendChild(crearEl("p", "lista-vacia", "Todavía no hay bailes."));
    return;
  }
  bailesPorGrupoShow().forEach((bailes, grupoNombre) => {
    cont.appendChild(crearEl("p", "show-checklist-grupo", grupoNombre));
    bailes.forEach((b) => {
      const etiqueta = crearEl("label", "opcion-checkbox");
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.value = b.id;
      casilla.checked = marcados.has(b.id);
      etiqueta.append(casilla, crearEl("span", "", b.nombre + (b.activo ? "" : " (desactivado)")));
      cont.appendChild(etiqueta);
    });
  });
}

function renderPagosModista() {
  const cont = el("listaPagosModista");
  cont.innerHTML = "";
  if (!pagosModista.length) {
    cont.appendChild(crearEl("p", "lista-vacia", "Todavía no hay pagos registrados."));
    return;
  }
  pagosModista.forEach((p) => {
    const tarjeta = crearEl("div", "show-tarjeta");
    const fila = crearEl("div", "show-tarjeta-fila");
    fila.appendChild(crearEl("span", "show-tarjeta-nombre", formatoQuetzales(p.monto)));
    fila.appendChild(crearEl("span", "show-etiqueta show-etiqueta-gris", formatoFechaCortaShow(p.fecha)));
    tarjeta.appendChild(fila);
    if (p.concepto) tarjeta.appendChild(crearEl("span", "show-pago-concepto", p.concepto));
    const detalle = [p.metodo || "Sin método"];
    if (p.bailes.length) detalle.push(p.bailes.map((b) => `${b.nombre} (${b.grupoNombre})`).join(", "));
    tarjeta.appendChild(crearEl("span", "tarjeta-resultado-detalle", detalle.join(" · ")));

    const acciones = crearEl("div", "show-acciones");
    if (p.comprobante) {
      const ver = crearEl("button", "btn-secundario btn-chico", p.comprobante === "pdf" ? "📄 Ver comprobante" : "🖼️ Ver comprobante");
      ver.type = "button";
      ver.addEventListener("click", () =>
        abrirComprobanteShow({ accion: "showComprobantePagoModista", clave: claveRecepcion, pagoId: p.id }, "mensajePagoModista")
      );
      acciones.appendChild(ver);
    } else {
      acciones.appendChild(crearEl("span", "show-etiqueta show-etiqueta-pendiente", "Sin comprobante"));
    }
    const editar = crearEl("button", "btn-secundario btn-chico", "✏️ Editar");
    editar.type = "button";
    editar.addEventListener("click", () => editarPagoModista(p));
    const eliminar = crearEl("button", "btn-secundario btn-chico show-btn-peligro", "🗑 Eliminar");
    eliminar.type = "button";
    eliminar.addEventListener("click", () => eliminarPagoModista(p, eliminar));
    acciones.append(editar, eliminar);
    tarjeta.appendChild(acciones);
    cont.appendChild(tarjeta);
  });
}

// El archivo viene del Worker como binario (no JSON). La ventana se abre
// en el mismo clic, antes de esperar al Worker: si se abriera después,
// Safari del iPad la bloquearía como ventana emergente.
async function abrirComprobanteShow(datos, idMensaje) {
  const ventana = window.open("", "_blank");
  if (ventana) ventana.document.title = "Abriendo comprobante...";
  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const tipo = resp.headers.get("Content-Type") || "";
    if (!resp.ok || tipo.includes("application/json")) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.error || "No se pudo abrir el comprobante.");
    }
    const url = URL.createObjectURL(await resp.blob());
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (ventana) ventana.close();
    mensajeShow(idMensaje, e.message, "error");
  }
}

el("inputPagoModistaArchivo").addEventListener("change", () => {
  const archivo = el("inputPagoModistaArchivo").files[0];
  const error = archivo ? errorArchivoParaAirtable(archivo) : "";
  if (error) {
    mensajeShow("mensajePagoModista", error, "error");
    el("inputPagoModistaArchivo").value = "";
    return;
  }
  archivoPagoModista = archivo || null;
  const nombre = el("nombrePagoModistaArchivo");
  nombre.hidden = !archivo;
  nombre.textContent = archivo ? `📎 ${archivo.name}` : "";
});

function limpiarFormularioPagoModista() {
  pagoModistaEditando = null;
  archivoPagoModista = null;
  el("inputPagoModistaArchivo").value = "";
  el("nombrePagoModistaArchivo").hidden = true;
  el("pistaComprobanteActualPago").hidden = true;
  el("tituloFormPagoModista").textContent = "Registrar pago";
  el("btnGuardarPagoModista").textContent = "Registrar pago";
  el("btnCancelarEdicionPagoModista").hidden = true;
  el("inputPagoModistaFecha").value = hoyGuatemalaPagos;
  el("inputPagoModistaMonto").value = "";
  el("inputPagoModistaConcepto").value = "";
  el("selectPagoModistaMetodo").value = "";
  el("checklistPagoModistaBailes").querySelectorAll("input").forEach((c) => (c.checked = false));
}

function editarPagoModista(pago) {
  limpiarFormularioPagoModista();
  pagoModistaEditando = pago;
  el("tituloFormPagoModista").textContent = "Editar pago";
  el("btnGuardarPagoModista").textContent = "Guardar cambios";
  el("btnCancelarEdicionPagoModista").hidden = false;
  el("inputPagoModistaFecha").value = pago.fecha;
  el("inputPagoModistaMonto").value = pago.monto;
  el("inputPagoModistaConcepto").value = pago.concepto;
  el("selectPagoModistaMetodo").value = pago.metodo;
  el("pistaComprobanteActualPago").hidden = !pago.comprobante;
  renderChecklistBailesPago();
  mensajeShow("mensajePagoModista", "");
  el("tituloFormPagoModista").scrollIntoView({ behavior: "smooth", block: "start" });
}

el("btnCancelarEdicionPagoModista").addEventListener("click", () => {
  limpiarFormularioPagoModista();
  mensajeShow("mensajePagoModista", "");
});

el("btnGuardarPagoModista").addEventListener("click", async () => {
  const fecha = el("inputPagoModistaFecha").value;
  const monto = el("inputPagoModistaMonto").value;
  const metodo = el("selectPagoModistaMetodo").value;
  if (!fecha) return mensajeShow("mensajePagoModista", "Escribe la fecha del pago.", "error");
  if (hoyGuatemalaPagos && fecha > hoyGuatemalaPagos) {
    return mensajeShow("mensajePagoModista", "La fecha del pago no puede ser en el futuro.", "error");
  }
  if (monto === "" || Number(monto) <= 0) return mensajeShow("mensajePagoModista", "Escribe el monto.", "error");
  if (!metodo) return mensajeShow("mensajePagoModista", "Escoge el método de pago.", "error");

  const boton = el("btnGuardarPagoModista");
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  try {
    let archivo = null;
    if (archivoPagoModista) {
      boton.textContent = "Preparando comprobante...";
      archivo = await prepararArchivoParaAirtable(archivoPagoModista);
    }
    boton.textContent = "Guardando...";
    const editando = Boolean(pagoModistaEditando);
    const r = await llamarWorker({
      accion: "showGuardarPagoModista",
      clave: claveRecepcion,
      pagoId: pagoModistaEditando ? pagoModistaEditando.id : undefined,
      fecha,
      monto: Number(monto),
      concepto: el("inputPagoModistaConcepto").value.trim(),
      metodo,
      baileIds: [...el("checklistPagoModistaBailes").querySelectorAll("input:checked")].map((c) => c.value),
      archivoBase64: archivo ? archivo.base64 : undefined,
    });
    limpiarFormularioPagoModista();
    boton.textContent = "Registrar pago";
    if (r.avisoComprobante) mensajeShow("mensajePagoModista", "⚠️ " + r.avisoComprobante, "error");
    else mensajeShow("mensajePagoModista", editando ? "✅ Cambios guardados." : "✅ Pago registrado.", "ok");
    await cargarPagosModista();
    // El catálogo cuenta pagos por baile (aviso al eliminar un baile).
    recargarDatosShow();
  } catch (e) {
    boton.textContent = textoOriginal;
    mensajeShow("mensajePagoModista", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

async function eliminarPagoModista(pago, boton) {
  const texto = `¿Eliminar el pago de ${formatoQuetzales(pago.monto)} del ${formatoFechaCortaShow(pago.fecha)}` +
    (pago.concepto ? ` ("${pago.concepto}")` : "") + "?\n\nTambién se borra su comprobante y la modista deja de verlo. Esto no se puede deshacer.";
  if (!window.confirm(texto)) return;
  boton.disabled = true;
  try {
    await llamarWorker({ accion: "showEliminarPagoModista", clave: claveRecepcion, pagoId: pago.id });
    if (pagoModistaEditando && pagoModistaEditando.id === pago.id) limpiarFormularioPagoModista();
    mensajeShow("mensajePagoModista", "✅ Pago eliminado.", "ok");
    await cargarPagosModista();
    recargarDatosShow();
  } catch (e) {
    mensajeShow("mensajePagoModista", e.message, "error");
    boton.disabled = false;
  }
}
