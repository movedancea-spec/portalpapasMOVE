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
  "pantallaMapaShow",
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
  "pantallaCampamento",
  "pantallaFichas",
  "pantallaRuleta",
  "pantallaAmonestaciones",
];

function mostrarPantalla(id) {
  PANTALLAS.filter((p) => el(p)).forEach((p) => {
    el(p).hidden = p !== id;
  });
  // Cada vez que se vuelve al menú se revisan los pagos por link.
  if (id === "pantallaMenu" && claveRecepcion) cargarPagosPorLink();
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
  cargarAvisoEntradas();
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
el("btnMenuMapaShow").addEventListener("click", () => {
  mostrarPantalla("pantallaMapaShow");
  abrirMapaShow();
});
el("btnMenuCampamento").addEventListener("click", () => {
  mostrarPantalla("pantallaCampamento");
  abrirCampamento();
});

el("btnMenuRuleta").addEventListener("click", () => {
  mostrarPantalla("pantallaRuleta");
  abrirRuleta();
});

el("btnMenuAmonestaciones").addEventListener("click", () => {
  mostrarPantalla("pantallaAmonestaciones");
  abrirAmonestaciones();
});
el("btnVolverAmonestaciones").addEventListener("click", () => mostrarPantalla("pantallaMenu"));

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
el("btnVolverMapaShow").addEventListener("click", () => mostrarPantalla("pantallaMenu"));
el("btnVolverCampamento").addEventListener("click", () => mostrarPantalla("pantallaMenu"));

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

// ---------- Aviso de entradas en el portal ----------
// Muestra u oculta el botón "🎟️ Avisos de entradas" del perfil del
// portal de alumnas (casilla "AVISO ENTRADAS PORTAL" de CONFIGURACION
// GENERAL). Solo se cambia aquí, con la clave de Recepción. Apagado, el
// Worker tampoco manda los avisos, pero no los borra. El 1 de enero el
// Worker lo apaga solo con los demás interruptores del show.

const OPCIONES_AVISO_ENTRADAS = [
  { activo: true, titulo: "🟢 Aviso de entradas: Se muestra", detalle: "Las familias ven el botón “🎟️ Avisos de entradas” en el perfil del portal." },
  { activo: false, titulo: "⚪ Aviso de entradas: Oculto", detalle: "El botón no aparece en el portal. Los avisos se quedan guardados." },
];

let avisoEntradasActual = null; // true / false, o null mientras carga

async function cargarAvisoEntradas() {
  const cont = el("opcionesAvisoEntradas");
  const mensajeEl = el("mensajeAvisoEntradas");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerAvisoEntradas", clave: claveRecepcion });
    avisoEntradasActual = !!datos.activo;
    renderAvisoEntradas();
  } catch (e) {
    cont.innerHTML = "";
    cont.appendChild(crearEl("p", "lista-vacia", e.message));
  }
}

function renderAvisoEntradas() {
  const cont = el("opcionesAvisoEntradas");
  cont.innerHTML = "";
  OPCIONES_AVISO_ENTRADAS.forEach((op) => {
    const activo = avisoEntradasActual === op.activo;
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.setAttribute("aria-pressed", activo ? "true" : "false");
    tarjeta.append(
      crearEl("span", "tarjeta-resultado-nombre", op.titulo + (activo ? " — ASÍ ESTÁ AHORA" : "")),
      crearEl("span", "tarjeta-resultado-detalle", op.detalle)
    );
    if (!activo) tarjeta.addEventListener("click", () => guardarAvisoEntradas(op.activo));
    cont.appendChild(tarjeta);
  });
}

async function guardarAvisoEntradas(activo) {
  const pregunta = activo
    ? "¿Mostrar el aviso de entradas en el portal? Las familias verán el botón “🎟️ Avisos de entradas” en el perfil de su alumna."
    : "¿Ocultar el aviso de entradas en el portal? Las familias dejarán de ver el botón “🎟️ Avisos de entradas” (los avisos no se borran).";
  if (!window.confirm(pregunta)) return;

  const mensajeEl = el("mensajeAvisoEntradas");
  mensajeEl.textContent = "Guardando...";
  mensajeEl.className = "mensaje-form";
  try {
    const datos = await llamarWorker({ accion: "recepcionGuardarAvisoEntradas", clave: claveRecepcion, activo });
    avisoEntradasActual = !!datos.activo;
    renderAvisoEntradas();
    mensajeEl.textContent = avisoEntradasActual
      ? "✅ Listo — las familias verán el botón al entrar al perfil (puede tardar unos 20 segundos)."
      : "✅ Listo — el botón deja de verse en el portal (puede tardar unos 20 segundos).";
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
    descripcion:
      "Los anuncios llegan por WhatsApp, uno por uno con pausas, solo a familias de alumnas activas y maestras activas (un mensaje por número). Máximo 50 al día entre todo lo masivo; el resto sigue al día siguiente desde las 9:00 a.m. ⚠️ Para avisos urgentes usá Portal; WhatsApp puede tardar varios días.",
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
// El Worker dice si WhatsApp para anuncios se puede usar (2026-11-01:
// bloqueado mientras se arregla el envío; antes no salía nada).
let whatsappAnunciosDisponible = false;

async function cargarCanalAnuncios() {
  const cont = el("opcionesCanalAnuncios");
  const mensajeEl = el("mensajeCanalAnuncios");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  cont.innerHTML = '<p class="lista-vacia">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "recepcionObtenerCanalAnuncios", clave: claveRecepcion, admiteWhatsapp: true });
    canalAnunciosActual = datos.canal || "Portal";
    whatsappAnunciosDisponible = datos.whatsappDisponible === true;
    renderCanalAnuncios();
    cargarEstadoWaAnuncios();
  } catch (e) {
    cont.innerHTML = `<p class="lista-vacia">${e.message}</p>`;
  }
}

function renderCanalAnuncios() {
  const cont = el("opcionesCanalAnuncios");
  cont.innerHTML = "";

  OPCIONES_CANAL_ANUNCIOS.forEach((op) => {
    const activo = canalAnunciosActual === op.valor;
    const bloqueada = op.valor === "WhatsApp" && !whatsappAnunciosDisponible;

    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : "");
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${op.titulo}${activo ? " — ✅ Activo ahora para todas" : ""}</span>
      <span class="tarjeta-resultado-detalle">${bloqueada ? "⛔ Desactivado por ahora: el envío de anuncios por WhatsApp se está arreglando. Usa Portal." : op.descripcion}</span>
    `;
    tarjeta.disabled = activo || bloqueada;
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
    await llamarWorker({ accion: "recepcionGuardarCanalAnuncios", clave: claveRecepcion, canal, admiteWhatsapp: true });
    canalAnunciosActual = canal;
    renderCanalAnuncios();
    cargarEstadoWaAnuncios();
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

  // Por WhatsApp: primero cuántos números son y cuántos días tarda con el
  // tope de 50 al día; se confirma ESE número (si cambia, el Worker no manda).
  let confirmados;
  if (canalAnunciosActual === "WhatsApp") {
    mensajeEl.textContent = "Contando números...";
    mensajeEl.className = "mensaje-form";
    let previa;
    try {
      previa = await llamarWorker({ accion: "recepcionAnuncioWhatsappPrevia", clave: claveRecepcion, destinatario });
    } catch (e) {
      mensajeEl.textContent = e.message;
      mensajeEl.className = "mensaje-form mensaje-form-error";
      return;
    }
    mensajeEl.textContent = "";
    pintarEstadoWaAnuncios(previa.estado);
    if (previa.ocupado) {
      mensajeEl.textContent = "Ya hay un anuncio por WhatsApp sin terminar. Espera a que termine o detenlo.";
      mensajeEl.className = "mensaje-form mensaje-form-error";
      return;
    }
    if (!previa.numeros) {
      mensajeEl.textContent = "No hay ningún número de WhatsApp válido para ese grupo.";
      mensajeEl.className = "mensaje-form mensaje-form-error";
      return;
    }
    const p = previa.plan;
    const horario = textoEmpiezaWa(previa.empiezaEn);
    const cuando =
      (previa.trasCampamento ? "Hay un envío del campamento en curso: el anuncio empieza cuando termine.\n" : "") +
      (horario ? `${horario}\n` : "") +
      (p.diasExtra
        ? `El primer día salen ${p.hoy} y el resto sigue los días siguientes desde las 9:00 a.m.: tarda unos ${p.dias} día${p.dias === 1 ? "" : "s"}.`
        : `Sale todo ${horario ? "ese día" : "hoy"}, uno por uno (unos minutos).`) +
      "\nSolo se manda de 8:00 a.m. a 8:00 p.m.";
    const ok = window.confirm(
      `¿Mandar este anuncio por WhatsApp a ${previa.numeros} número${previa.numeros === 1 ? "" : "s"} (${aQuien})?\n\n` +
        `${cuando}\nTope compartido (campamento + anuncios): quedan ${previa.estado.quedanAlEmpezar} de ${previa.estado.maximo} para el día en que empieza.` +
        (previa.sinTelefono ? `\n${previa.sinTelefono} sin número válido no lo reciben.` : "") +
        `\n\nCada mensaje empieza con «${previa.ejemploSaludo} 💕».\n\n"${titulo}"\n\n${mensaje}\n\nPara avisos urgentes usá Portal.`
    );
    if (!ok) return;
    confirmados = previa.numeros;
  } else {
    const confirmado = window.confirm(`¿Mandar este anuncio a ${aQuien}?\n\n"${titulo}"\n\n${mensaje}`);
    if (!confirmado) return;
  }

  const btn = el("btnMandarAnuncio");
  btn.disabled = true;
  btn.textContent = "Mandando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    const payload = { accion: "recepcionMandarAnuncio", clave: claveRecepcion, titulo, mensaje, destinatario, confirmados };

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
    if (datos.canal === "WhatsApp") cargarEstadoWaAnuncios();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📢 Mandar anuncio";
  }
});

// ---------- Avance del envío por WhatsApp (compartido) ----------
// El mismo enviador manda lo del campamento y los anuncios, con un solo
// tope de 50 al día. Aquí se ve el envío actual, sea cual sea.
let temporizadorWaAnuncios = null;

function textoEstadoEnvioWa(v) {
  const hechos = v.enviados + v.errores;
  if (v.estado === "enviando" && v.continuaManana) return `⏳ «${v.nombre}»: enviados ${v.enviados} de ${v.total}, continúa mañana a las 9:00 a.m.`;
  if (v.estado === "enviando" && v.esperaHorario) return `🌙 «${v.nombre}»: enviados ${v.enviados} de ${v.total}, sigue a las 8:00 a.m. (horario de envíos).`;
  if (v.estado === "pausado") return `⏸️ «${v.nombre}»: enviados ${v.enviados} de ${v.total}, en espera (sale primero lo del campamento).`;
  if (v.estado === "enviando") return `⏳ Enviando «${v.nombre}»: ${hechos} de ${v.total}${v.errores ? ` (${v.errores} con error)` : ""}`;
  if (v.estado === "terminado") return `✅ «${v.nombre}» terminado: ${v.enviados} de ${v.total} enviados${v.errores ? `, ${v.errores} con error` : ""}.`;
  return `⏹️ «${v.nombre}» detenido: ${v.enviados} de ${v.total} enviados. ${v.motivo}`;
}

function pintarEstadoWaAnuncios(estado) {
  clearTimeout(temporizadorWaAnuncios);
  const caja = el("cajaAnuncioWaEstado");
  const v = estado && estado.envio;
  el("cajaAnuncioWaPrueba").hidden = canalAnunciosActual !== "WhatsApp";
  caja.hidden = !estado || (!v && canalAnunciosActual !== "WhatsApp");
  if (!estado) return;
  el("textoAnuncioWaHoy").textContent = `Hoy: ${estado.enviadosHoy} de ${estado.maximo} mensajes masivos (quedan ${estado.quedanHoy}).`;
  el("textoAnuncioWaEnvio").textContent =
    (v ? textoEstadoEnvioWa(v) : "No hay ningún envío en curso.") +
    (estado.enEspera ? `\n${textoEstadoEnvioWa({ ...estado.enEspera, estado: "pausado" })}` : "");
  el("textoAnuncioWaSiguiente").textContent =
    v && v.estado === "enviando" && v.siguienteEn ? `Siguiente mensaje: ${new Date(v.siguienteEn).toLocaleString("es-GT", { timeZone: "America/Guatemala", weekday: "long", hour: "numeric", minute: "2-digit", hour12: true })}.` : "";
  el("btnAnuncioWaDetener").hidden = !(v && v.estado === "enviando");
  if (v && v.estado === "enviando") {
    temporizadorWaAnuncios = setTimeout(() => {
      if (!el("pantallaAnuncios").hidden) cargarEstadoWaAnuncios();
    }, 15000);
  }
}

async function cargarEstadoWaAnuncios() {
  try {
    const r = await llamarWorker({ accion: "vcWhatsappDatos", clave: claveRecepcion });
    pintarEstadoWaAnuncios(r.estado);
    el("mensajeAnuncioWa").textContent = "";
  } catch (e) {
    el("cajaAnuncioWaEstado").hidden = false;
    el("mensajeAnuncioWa").textContent = e.message;
  }
}

el("btnAnuncioWaActualizar").addEventListener("click", cargarEstadoWaAnuncios);

el("btnAnuncioWaProbar").addEventListener("click", async () => {
  const mensajeEl = el("mensajeAnuncio");
  const boton = el("btnAnuncioWaProbar");
  boton.disabled = true;
  mensajeEl.textContent = "Mandando la prueba...";
  mensajeEl.className = "mensaje-form";
  try {
    const r = await llamarWorker({
      accion: "recepcionAnuncioWhatsappPrueba",
      clave: claveRecepcion,
      titulo: el("inputAnuncioTitulo").value.trim(),
      mensaje: el("inputAnuncioMensaje").value.trim(),
      destinatario: el("selectAnuncioDestinatario").value,
      telefono: el("inputAnuncioWaTelefono").value,
    });
    pintarEstadoWaAnuncios(r.estado);
    mensajeEl.textContent = "✅ Prueba en camino a tu número.";
    mensajeEl.className = "mensaje-form mensaje-form-ok";
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.className = "mensaje-form mensaje-form-error";
  } finally {
    boton.disabled = false;
  }
});
el("btnAnuncioWaDetener").addEventListener("click", async () => {
  if (!confirm("¿Detener el envío por WhatsApp? Los mensajes que faltan no se van a mandar (tampoco mañana).")) return;
  try {
    const r = await llamarWorker({ accion: "vcWhatsappDetener", clave: claveRecepcion });
    pintarEstadoWaAnuncios(r.estado);
  } catch (e) {
    el("mensajeAnuncioWa").textContent = e.message;
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
        // Con la clave, el Worker acepta grupo, maestra, clase, horario y
        // mensualidad (desde la ficha pública ya no se aceptan).
        clave: claveRecepcion,
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
// FOTOS DEL SHOW
// Aquí se prepara la foto: el navegador la recorta y la achica, así al Worker
// y a las familias solo llega lo necesario, y de paso se van los datos internos
// de la foto (como el GPS). Foto de alumna: cuadrada, ~400 px, menos de 60 KB;
// grupal: 1200 px de ancho. Más una JPG de hasta 1600 px solo para descargar.
// Las 80 fotos no se abren de una vez (no cabrían en memoria): se abren al subir.
// Lo guardado en Airtable se confirma de 10 en 10.
// ==========================================
const FOTO_LADO = 400;
const FOTO_MAX_BYTES = 60 * 1024;
const FOTO_GRUPAL_ANCHO = 1200;
const FOTO_GRUPAL_MAX_BYTES = 300 * 1024;
const FOTO_DESCARGA_LADO = 1600;
const FOTO_DESCARGA_MAX_BYTES = 390 * 1024;
const FOTOS_A_LA_VEZ = 3;
let fotosDatos = null;
let fotosLote = [];
let fotoDestinoIndividual = null; // { tipo, id } de la subida de una sola foto
let encuadreActual = null;

function encuadrePorDefecto(ancho, alto) {
  const lado = Math.min(ancho, alto);
  // En una foto vertical la cara suele ir arriba: mejor no cortar la cabeza.
  return { x: (ancho - lado) / 2, y: alto > ancho ? (alto - lado) * 0.2 : 0, lado };
}

function canvasABlob(canvas, tipo, calidad) {
  return new Promise((listo) => canvas.toBlob(listo, tipo, calidad));
}

// Baja la calidad hasta que quepa. Safari no sabe crear WebP (devuelve PNG):
// ahí sale JPG, que el Worker y el mapa también aceptan.
async function comprimirCanvas(canvas, tipo, maxBytes) {
  let blob = null;
  for (let calidad = 0.82; calidad >= 0.3; calidad -= 0.08) {
    blob = await canvasABlob(canvas, tipo, calidad);
    if (!blob || blob.type !== tipo) return tipo === "image/webp" ? comprimirCanvas(canvas, "image/jpeg", maxBytes) : blob;
    if (blob.size <= maxBytes) return blob;
  }
  return blob;
}

function dibujar(fuente, sx, sy, sw, sh, ancho, alto) {
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fuente, sx, sy, sw, sh, 0, 0, ancho, alto);
  return canvas;
}

async function abrirImagenFoto(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("No se pudo abrir (si es HEIC, conviértela a JPG).");
  }
}

// La misma optimización para alumnas y staff.
function miniDeFoto(img, { tipo, encuadre }) {
  const { width: w, height: h } = img;
  if (tipo === "baile") {
    const ancho = Math.min(FOTO_GRUPAL_ANCHO, w);
    return comprimirCanvas(dibujar(img, 0, 0, w, h, ancho, Math.round((ancho * h) / w)), "image/webp", FOTO_GRUPAL_MAX_BYTES);
  }
  const c = encuadre || encuadrePorDefecto(w, h);
  return comprimirCanvas(dibujar(img, c.x, c.y, c.lado, c.lado, FOTO_LADO, FOTO_LADO), "image/webp", FOTO_MAX_BYTES);
}

async function prepararFoto(file, { tipo, encuadre }) {
  const img = await abrirImagenFoto(file);
  const { width: w, height: h } = img;
  const mini = await miniDeFoto(img, { tipo, encuadre });
  const escala = Math.min(1, FOTO_DESCARGA_LADO / Math.max(w, h));
  const descarga = await comprimirCanvas(dibujar(img, 0, 0, w, h, Math.round(w * escala), Math.round(h * escala)), "image/jpeg", FOTO_DESCARGA_MAX_BYTES);
  img.close();
  return { mini, descarga };
}

async function subirArchivosFoto({ tipo, file, encuadre }) {
  const { mini, descarga } = await prepararFoto(file, { tipo, encuadre });
  const form = new FormData();
  form.set("tipo", tipo);
  form.set("mini", mini, "mini");
  form.set("descarga", descarga, "descarga.jpg");
  const resp = await fetch(`${WORKER_URL}/subirFotoShow`, { method: "POST", headers: { "X-Clave-Recepcion": claveRecepcion }, body: form });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || !datos.success) throw new Error(datos.error || "No se pudo subir.");
  return { ...datos, bytesMini: mini.size, bytesDescarga: descarga.size };
}

async function cargarFotosShow() {
  try {
    fotosDatos = await llamarWorker({ accion: "showFotosDatos", clave: claveRecepcion });
    mensajeShow("mensajeFotos", "");
  } catch (e) {
    mensajeShow("mensajeFotos", e.message, "error");
    return;
  }
  el("fotosPortalActivo").checked = fotosDatos.portalActivo;
  pintarFotosBailes();
  pintarFotosLote();
  if (showAlumnaElegida) pintarFotoAlumnaAsignar();
}

const alumnaDeFotos = (id) => (fotosDatos ? fotosDatos.alumnas.find((a) => a.id === id) : null);

function pintarFotoAlumnaAsignar() {
  const a = alumnaDeFotos(showAlumnaElegida && showAlumnaElegida.id);
  el("btnFotoAlumnaSubir").textContent = a && a.foto ? "📸 Reemplazar foto" : "📸 Subir foto";
  el("showAlumnaFotoEstado").textContent = !a
    ? "Sin bailes todavía: asígnale uno para poder subir su foto."
    : !a.foto
      ? "Sin foto."
      : a.oculta
        ? "Tiene foto, oculta: no sale en el mapa. Su familia sí la ve en el portal."
        : "Tiene foto: sale en el mapa.";
  el("btnFotoAlumnaSubir").disabled = !a;
}

el("btnFotoAlumnaSubir")?.addEventListener("click", () => {
  fotoDestinoIndividual = { tipo: "alumna", id: showAlumnaElegida.id, mensaje: "mensajeFotoAlumna" };
  el("inputFotoArchivo").value = "";
  el("inputFotoArchivo").click();
});

el("inputFotoArchivo")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const destino = fotoDestinoIndividual;
  if (!file || !destino) return;
  try {
    const encuadre = destino.tipo === "alumna" ? await pedirEncuadre(file) : null;
    if (destino.tipo === "alumna" && !encuadre) return;
    mensajeShow(destino.mensaje, "Subiendo...");
    const s = await subirArchivosFoto({ tipo: destino.tipo, file, encuadre });
    await llamarWorker({ accion: "showFotosConfirmar", clave: claveRecepcion, items: [{ tipo: destino.tipo, id: destino.id, mini: s.mini, descarga: s.descarga }] });
    mensajeShow(destino.mensaje, "✅ Foto guardada.", "ok");
    await cargarFotosShow();
  } catch (err) {
    mensajeShow(destino.mensaje, err.message, "error");
  }
});

// --- Encuadre: la foto se arrastra debajo de un cuadro fijo ---
function pintarEncuadre() {
  const e = encuadreActual;
  const ctx = el("canvasEncuadre").getContext("2d");
  ctx.drawImage(e.img, e.x, e.y, e.lado, e.lado, 0, 0, 280, 280);
}
function limitarEncuadre() {
  const e = encuadreActual;
  e.x = Math.max(0, Math.min(e.img.width - e.lado, e.x));
  e.y = Math.max(0, Math.min(e.img.height - e.lado, e.y));
}
function pedirEncuadre(file, previo) {
  return new Promise(async (listo, falla) => {
    let img;
    try {
      img = await createImageBitmap(file);
    } catch {
      falla(new Error("No se pudo abrir (si es HEIC, conviértela a JPG)."));
      return;
    }
    const base = previo || encuadrePorDefecto(img.width, img.height);
    encuadreActual = { img, ...base, zoom: Math.min(img.width, img.height) / base.lado, listo };
    el("zoomEncuadre").value = encuadreActual.zoom;
    pintarEncuadre();
    el("ventanaEncuadre").hidden = false;
  });
}
function cerrarEncuadre(valor) {
  const e = encuadreActual;
  el("ventanaEncuadre").hidden = true;
  encuadreActual = null;
  if (!e) return;
  e.img.close();
  e.listo(valor);
}
el("btnEncuadreListo")?.addEventListener("click", () => {
  const { x, y, lado } = encuadreActual;
  cerrarEncuadre({ x, y, lado });
});
el("btnEncuadreCancelar")?.addEventListener("click", () => cerrarEncuadre(null));
el("zoomEncuadre")?.addEventListener("input", (ev) => {
  const e = encuadreActual;
  const centroX = e.x + e.lado / 2;
  const centroY = e.y + e.lado / 2;
  e.zoom = Number(ev.target.value);
  e.lado = Math.min(e.img.width, e.img.height) / e.zoom;
  e.x = centroX - e.lado / 2;
  e.y = centroY - e.lado / 2;
  limitarEncuadre();
  pintarEncuadre();
});
el("canvasEncuadre")?.addEventListener("pointerdown", (ev) => {
  const lienzo = ev.currentTarget;
  lienzo.setPointerCapture(ev.pointerId);
  let px = ev.clientX;
  let py = ev.clientY;
  const mover = (m) => {
    const e = encuadreActual;
    const escala = e.lado / lienzo.clientWidth;
    e.x -= (m.clientX - px) * escala;
    e.y -= (m.clientY - py) * escala;
    px = m.clientX;
    py = m.clientY;
    limitarEncuadre();
    pintarEncuadre();
  };
  const soltar = () => {
    lienzo.removeEventListener("pointermove", mover);
    lienzo.removeEventListener("pointerup", soltar);
    lienzo.removeEventListener("pointercancel", soltar);
  };
  lienzo.addEventListener("pointermove", mover);
  lienzo.addEventListener("pointerup", soltar);
  lienzo.addEventListener("pointercancel", soltar);
});

// --- Subida masiva ---
function normalizarNombreFoto(texto) {
  return String(texto || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function emparejarFoto(nombreArchivo) {
  const buscado = normalizarNombreFoto(nombreArchivo);
  const candidatas = fotosDatos.alumnas.filter((a) => normalizarNombreFoto(a.nombreShow) === buscado || normalizarNombreFoto(a.nombre) === buscado);
  return candidatas.length === 1 ? candidatas[0].id : "";
}

el("btnFotosElegir")?.addEventListener("click", () => {
  el("inputFotosArchivos").value = "";
  el("inputFotosArchivos").click();
});

el("inputFotosArchivos")?.addEventListener("change", async (e) => {
  if (!fotosDatos) await cargarFotosShow();
  if (!fotosDatos) return;
  fotosLote.forEach((f) => URL.revokeObjectURL(f.url));
  fotosLote = [...e.target.files].map((file) => ({ file, url: URL.createObjectURL(file), alumnaId: emparejarFoto(file.name), encuadre: null, estado: "", error: "" }));
  mensajeShow("mensajeFotosLote", "");
  pintarFotosLote();
});

function pintarFotosLote() {
  const cont = el("listaFotosLote");
  cont.innerHTML = "";
  const pendientes = fotosLote.filter((f) => f.estado !== "lista");
  el("btnFotosSubir").hidden = !pendientes.length;
  if (!fotosLote.length || !fotosDatos) return;
  const usos = new Map();
  pendientes.forEach((f) => f.alumnaId && usos.set(f.alumnaId, (usos.get(f.alumnaId) || 0) + 1));
  fotosLote.forEach((f, i) => {
    const fila = crearEl("div", "foto-fila" + (f.estado === "lista" ? " lista" : ""));
    const mini = crearEl("img", "foto-fila-mini");
    mini.loading = "lazy";
    mini.src = f.url;
    mini.alt = "";
    const centro = crearEl("div", "foto-fila-centro");
    centro.appendChild(crearEl("span", "tarjeta-resultado-detalle", f.file.name));
    if (f.estado === "lista") {
      centro.appendChild(crearEl("span", "show-tarjeta-nombre", `✅ ${alumnaDeFotos(f.alumnaId)?.nombreShow || "Guardada"}`));
    } else {
      const select = crearEl("select", "input-select foto-fila-select");
      select.setAttribute("aria-label", `Alumna de ${f.file.name}`);
      select.appendChild(new Option("— Elegir alumna —", ""));
      fotosDatos.alumnas.forEach((a) => select.appendChild(new Option(`${a.nombreShow}${a.foto ? " (reemplaza)" : ""}`, a.id)));
      select.value = f.alumnaId;
      select.addEventListener("change", () => {
        f.alumnaId = select.value;
        pintarFotosLote();
      });
      centro.appendChild(select);
      const aviso = !f.alumnaId ? "⚠️ Sin emparejar" : usos.get(f.alumnaId) > 1 ? "⚠️ Hay otra foto para esta alumna" : "";
      if (f.error || aviso) centro.appendChild(crearEl("span", "foto-fila-aviso", f.error || aviso));
      const acciones = crearEl("div", "show-acciones");
      const ajustar = crearEl("button", "btn-secundario btn-chico", "✂️ Ajustar");
      ajustar.type = "button";
      ajustar.addEventListener("click", async () => {
        try {
          const nuevo = await pedirEncuadre(f.file, f.encuadre);
          if (nuevo) f.encuadre = nuevo;
        } catch (e) {
          f.error = e.message;
          pintarFotosLote();
        }
      });
      const quitar = crearEl("button", "btn-secundario btn-chico show-btn-peligro", "✕");
      quitar.type = "button";
      quitar.addEventListener("click", () => {
        URL.revokeObjectURL(f.url);
        fotosLote.splice(i, 1);
        pintarFotosLote();
      });
      acciones.append(ajustar, quitar);
      centro.appendChild(acciones);
    }
    fila.append(mini, centro);
    cont.appendChild(fila);
  });
}

el("btnFotosSubir")?.addEventListener("click", async () => {
  const conAlumna = fotosLote.filter((f) => f.estado !== "lista" && f.alumnaId);
  const usadas = new Set();
  const lote = conAlumna.filter((f) => !usadas.has(f.alumnaId) && usadas.add(f.alumnaId));
  if (!lote.length) return mensajeShow("mensajeFotosLote", "Elige la alumna de cada foto.", "error");
  const boton = el("btnFotosSubir");
  boton.disabled = true;
  let hechas = 0;
  let porConfirmar = [];
  const confirmar = async () => {
    const items = porConfirmar.splice(0, 10);
    if (!items.length) return;
    await llamarWorker({ accion: "showFotosConfirmar", clave: claveRecepcion, items: items.map((x) => x.item) });
    items.forEach((x) => { x.foto.estado = "lista"; hechas++; });
    mensajeShow("mensajeFotosLote", `Subiendo... ${hechas} de ${lote.length}`);
  };
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < lote.length) {
      const foto = lote[siguiente++];
      foto.error = "";
      for (let intento = 1; intento <= 2 && foto.estado !== "subida"; intento++) {
        try {
          const s = await subirArchivosFoto({ tipo: "alumna", file: foto.file, encuadre: foto.encuadre });
          foto.estado = "subida";
          porConfirmar.push({ foto, item: { tipo: "alumna", id: foto.alumnaId, mini: s.mini, descarga: s.descarga } });
        } catch (e) {
          foto.error = e.message;
        }
      }
      if (porConfirmar.length >= 10) await confirmar().catch((e) => { mensajeShow("mensajeFotosLote", e.message, "error"); });
    }
  };
  await Promise.all(Array.from({ length: FOTOS_A_LA_VEZ }, trabajador));
  while (porConfirmar.length) {
    try {
      await confirmar();
    } catch (e) {
      mensajeShow("mensajeFotosLote", e.message, "error");
      break;
    }
  }
  const fallas = lote.filter((f) => f.estado !== "lista").length;
  lote.forEach((f) => { if (f.estado === "subida") f.estado = ""; });
  await cargarFotosShow();
  boton.disabled = false;
  mensajeShow("mensajeFotosLote", fallas ? `${hechas} guardadas, ${fallas} con error: revísalas abajo.` : `✅ ${hechas} fotos guardadas.`, fallas ? "error" : "ok");
});

// --- Vista por baile ---
async function verFotoRecepcion(archivo, nombre) {
  try {
    const resp = await fetch(WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "showFotoRecepcion", clave: claveRecepcion, archivo }) });
    if (!resp.ok) throw new Error("No se pudo abrir la foto.");
    el("imgVentanaFoto").src = URL.createObjectURL(await resp.blob());
    el("imgVentanaFoto").alt = nombre;
    el("ventanaFoto").hidden = false;
  } catch (e) {
    mensajeShow("mensajeFotos", e.message, "error");
  }
}
el("btnVentanaFotoCerrar")?.addEventListener("click", () => {
  URL.revokeObjectURL(el("imgVentanaFoto").src);
  el("imgVentanaFoto").removeAttribute("src");
  el("ventanaFoto").hidden = true;
});

async function accionFoto(boton, accion, datos) {
  boton.disabled = true;
  try {
    await llamarWorker({ accion, clave: claveRecepcion, ...datos });
    await cargarFotosShow();
  } catch (e) {
    mensajeShow("mensajeFotos", e.message, "error");
    boton.disabled = false;
  }
}

function botonFoto(texto, alTocar, peligro) {
  const b = crearEl("button", "btn-secundario btn-chico" + (peligro ? " show-btn-peligro" : ""), texto);
  b.type = "button";
  b.addEventListener("click", () => alTocar(b));
  return b;
}

// Dos toques, sin confirm(): borrar no se puede deshacer.
function botonBorrarFoto(tipo, id) {
  let armado = false;
  return botonFoto("🗑", (b) => {
    if (armado) return accionFoto(b, "showFotoBorrar", { tipo, id });
    armado = true;
    b.textContent = "¿Borrar?";
    setTimeout(() => { armado = false; b.textContent = "🗑"; }, 4000);
  }, true);
}

function filaFotoAlumna(a) {
  const fila = crearEl("div", "foto-alumna-fila");
  const texto = crearEl("div", "foto-fila-centro");
  texto.appendChild(crearEl("span", "show-tarjeta-nombre", `${a.foto ? "📸" : "⬜"} ${a.nombreShow}${a.estado ? ` (${a.estado})` : ""}`));
  if (a.oculta) texto.appendChild(crearEl("span", "tarjeta-resultado-detalle", "🙈 Oculta"));
  const acciones = crearEl("div", "show-acciones");
  acciones.appendChild(botonFoto(a.foto ? "Reemplazar" : "Subir foto", () => {
    fotoDestinoIndividual = { tipo: "alumna", id: a.id, mensaje: "mensajeFotos" };
    el("inputFotoArchivo").value = "";
    el("inputFotoArchivo").click();
  }));
  if (a.foto) {
    acciones.append(
      botonFoto("Ver", () => verFotoRecepcion(a.foto, a.nombreShow)),
      botonFoto(a.oculta ? "Mostrar" : "Ocultar foto", (b) => accionFoto(b, "showFotoOcultar", { id: a.id, oculta: !a.oculta })),
      botonBorrarFoto("alumna", a.id)
    );
  }
  fila.append(texto, acciones);
  return fila;
}

function pintarFotosBailes() {
  const cont = el("listaFotosBailes");
  cont.innerHTML = "";
  const filtro = el("selectFotosFiltro").value;
  const pasa = (a) =>
    !filtro || (filtro === "sinFoto" && !a.foto) || (filtro === "ocultas" && a.oculta);
  fotosDatos.bailes.forEach((b) => {
    const alumnas = b.alumnas.map(alumnaDeFotos).filter(Boolean);
    const tarjeta = crearEl("div", "show-tarjeta" + (b.activo ? "" : " inactivo"));
    tarjeta.appendChild(crearEl("span", "show-tarjeta-nombre", `${b.nombre}${b.atraccion ? ` · 🗺️ ${b.atraccion}` : ""}`));
    const conFoto = alumnas.filter((a) => a.foto).length;
    tarjeta.appendChild(crearEl("span", "tarjeta-resultado-detalle", `📸 ${conFoto} de ${alumnas.length} con foto`));
    const grupal = crearEl("div", "foto-grupal");
    grupal.appendChild(crearEl("span", "tarjeta-resultado-detalle", b.foto ? "Foto grupal:" : "Sin foto grupal"));
    const acciones = crearEl("div", "show-acciones");
    acciones.appendChild(botonFoto(b.foto ? "Reemplazar grupal" : "Subir grupal", () => {
      fotoDestinoIndividual = { tipo: "baile", id: b.id, mensaje: "mensajeFotos" };
      el("inputFotoArchivo").value = "";
      el("inputFotoArchivo").click();
    }));
    if (b.foto) {
      acciones.append(botonFoto("Ver", () => verFotoRecepcion(b.foto, b.nombre)), botonBorrarFoto("baile", b.id));
      const casilla = crearEl("label", "mapa-interruptor");
      const input = crearEl("input");
      input.type = "checkbox";
      input.checked = b.publica;
      input.addEventListener("change", () => accionFoto(input, "showFotoBailePublica", { id: b.id, publica: input.checked }));
      casilla.append(input, crearEl("span", "", "Mostrar en el mapa"));
      grupal.append(acciones, casilla);
    } else {
      grupal.appendChild(acciones);
    }
    tarjeta.appendChild(grupal);
    alumnas.filter(pasa).forEach((a) => tarjeta.appendChild(filaFotoAlumna(a)));
    cont.appendChild(tarjeta);
  });
}
el("selectFotosFiltro")?.addEventListener("change", () => fotosDatos && pintarFotosBailes());

el("fotosPortalActivo")?.addEventListener("change", async (e) => {
  const casilla = e.currentTarget;
  casilla.disabled = true;
  try {
    await llamarWorker({ accion: "showFotosPortal", clave: claveRecepcion, activo: casilla.checked });
  } catch (err) {
    casilla.checked = !casilla.checked;
    mensajeShow("mensajeFotos", err.message, "error");
  } finally {
    casilla.disabled = false;
  }
});

// ==========================================
// MAPA DEL SHOW
// Encendido, textos, votos y reacciones de academiamovedance.com/show/.
// Todo lo guarda y lo calcula el Worker (acciones mapaShow*): aquí no se suma
// ni se calcula nada. Los textos viven en memoria hasta tocar Guardar, por eso
// el refresco solo repinta Votos.
// ==========================================
let mapaDatos = null;
let mapaPestana = "Votos";
let mapaConfirmar = "";

function hayAlgoQueMirarMapa() {
  return claveRecepcion && !el("pantallaMapaShow").hidden && !document.hidden && mapaPestana === "Votos";
}
setInterval(() => {
  if (hayAlgoQueMirarMapa()) cargarMapaShow({ soloVivo: true }).catch(() => {});
}, 5000);

function abrirMapaShow() {
  mensajeShow("mensajeMapaShow", "");
  cambiarPestanaMapa(mapaPestana);
  cargarMapaShow().catch((e) => mensajeShow("mensajeMapaShow", e.message, "error"));
}

document.querySelectorAll("[data-mapa-pestana]").forEach((chip) => {
  chip.addEventListener("click", () => cambiarPestanaMapa(chip.dataset.mapaPestana));
});

function cambiarPestanaMapa(nombre) {
  mapaPestana = nombre;
  document.querySelectorAll("[data-mapa-pestana]").forEach((chip) => {
    chip.classList.toggle("activo", chip.dataset.mapaPestana === nombre);
  });
  ["Textos", "Votos", "Atracciones", "Staff"].forEach((n) => {
    const vista = el("vistaMapa" + n);
    if (vista) vista.hidden = n !== nombre;
  });
  if (nombre === "Atracciones" || nombre === "Staff") cargarCatalogoMapa();
}

async function cargarMapaShow({ soloVivo = false } = {}) {
  aplicarMapaShow(await llamarWorker({ accion: "mapaShowDatos", clave: claveRecepcion }), { soloVivo });
}

function aplicarMapaShow(d, { soloVivo = false } = {}) {
  mapaDatos = d;
  el("mapaActivo").checked = d.config.activo;
  pintarMapaVotos();
  if (soloVivo) return;
  el("inputMapaRefresco").value = d.config.refrescoSeg;
  el("inputMapaRefrescoAtento").value = d.config.refrescoAtentoSeg;
  pintarMapaTextos();
}

function nombreMapa(id) {
  const t = mapaDatos.config.textos[id] || {};
  const nueva = (mapaDatos.config.nuevas || []).find((n) => n.id === id);
  return t.nombre || (nueva ? nueva.nombre : id);
}
async function guardarMapa(boton, accion, datos, aviso) {
  boton.disabled = true;
  mensajeShow("mensajeMapaShow", "");
  try {
    aplicarMapaShow(await llamarWorker({ accion, clave: claveRecepcion, ...datos }));
    mensajeShow("mensajeMapaShow", aviso, "ok");
  } catch (e) {
    mensajeShow("mensajeMapaShow", e.message, "error");
  } finally {
    boton.disabled = false;
  }
}
function pintarMapaTextos() {
  const cont = el("listaMapaTextos");
  cont.innerHTML = "";
  Object.entries(mapaDatos.textosBase).forEach(([id, base]) => {
    const t = mapaDatos.config.textos[id] || {};
    const fila = crearEl("div", "mapa-texto");
    fila.dataset.id = id;
    fila.appendChild(crearEl("p", "etiqueta-campo", id));
    const nombre = crearEl("input", "input-texto");
    nombre.dataset.campo = "nombre";
    nombre.maxLength = 40;
    nombre.placeholder = id;
    nombre.value = t.nombre || "";
    nombre.setAttribute("aria-label", `Nombre de ${id}`);
    const tema = crearEl("input", "input-texto");
    tema.dataset.campo = "tema";
    tema.maxLength = 60;
    tema.placeholder = base.tema;
    tema.value = t.tema || "";
    tema.setAttribute("aria-label", `Tema de ${id}`);
    const emoji = crearEl("input", "input-texto");
    emoji.dataset.campo = "emoji";
    emoji.placeholder = base.emoji || "";
    emoji.value = t.emoji || "";
    emoji.setAttribute("aria-label", `Emoji de ${id}`);
    const color = crearEl("input", "mapa-color");
    color.type = "color";
    color.dataset.campo = "color";
    color.value = t.color || base.color;
    color.setAttribute("aria-label", `Color de ${id}`);
    fila.append(nombre, tema, emoji, color);
    cont.appendChild(fila);
  });
}
el("btnMapaGuardarTextos").addEventListener("click", (e) => {
  const textos = {};
  document.querySelectorAll("#listaMapaTextos .mapa-texto").forEach((f) => {
    textos[f.dataset.id] = Object.fromEntries([...f.querySelectorAll("[data-campo]")].map((c) => [c.dataset.campo, c.value]));
  });
  guardarMapa(e.currentTarget, "mapaShowGuardarTextos", { textos }, "✅ Textos guardados.");
});

function pintarMapaVotos() {
  const d = mapaDatos;
  el("mapaVotacion").checked = d.config.votacionAbierta;
  el("mapaResultados").checked = d.config.resultadosPublicos;
  el("mapaReacciones").checked = d.config.reaccionesAbiertas;
  el("mapaEmojis").checked = d.config.mostrarEmojis;
  el("mapaSonidos").checked = d.config.sonidos;
  const s = d.sincronizacion;
  el("mapaSincronizacion").textContent = s.error
    ? `⚠️ ${s.error}`
    : s.ultima
      ? `Último respaldo en Airtable: ${new Date(s.ultima).toLocaleTimeString("es-GT", { timeZone: "America/Guatemala", hour: "numeric", minute: "2-digit" })}`
      : "Todavía no hay respaldo en Airtable.";
  const a = d.actividad;
  const raro = a.celularesUltimoMinuto > 150;
  el("mapaActividad").textContent = `${raro ? "⚠️ Muchos celulares nuevos de golpe. " : ""}Celulares nuevos: ${a.celularesUltimoMinuto} en el último minuto, ${a.celularesUltimos10Min} en 10 minutos.`;

  const cont = el("listaMapaResultados");
  cont.innerHTML = "";
  const votos = new Map(d.ranking.map((f) => [f.id, f.votos]));
  const ids = [...new Set([...d.ranking.map((f) => f.id), ...Object.keys(d.textosBase), ...(d.config.nuevas || []).map((n) => n.id)])];
  ids.forEach((id, i) => {
    const r = d.reacciones[id] || {};
    const textoReacciones = d.emojis.filter((e) => r[e]).map((e) => `${e} ${r[e]}`).join("  ");
    const tarjeta = crearEl("div", "show-tarjeta show-tarjeta-fila");
    const texto = crearEl("span", "show-tarjeta-texto");
    texto.appendChild(crearEl("span", "show-tarjeta-nombre", `${votos.get(id) ? i + 1 + ". " : ""}${nombreMapa(id)}`));
    texto.appendChild(crearEl("span", "tarjeta-resultado-detalle", textoReacciones || "Sin reacciones"));
    tarjeta.append(texto, crearEl("span", "show-etiqueta", `${votos.get(id) || 0} votos`));
    cont.appendChild(tarjeta);
  });
}

[["mapaActivo", "activo"], ["mapaVotacion", "votacionAbierta"], ["mapaResultados", "resultadosPublicos"], ["mapaReacciones", "reaccionesAbiertas"], ["mapaEmojis", "mostrarEmojis"], ["mapaSonidos", "sonidos"]].forEach(([id, campo]) => {
  el(id)?.addEventListener("change", async (e) => {
    const casilla = e.currentTarget;
    casilla.disabled = true;
    mensajeShow("mensajeMapaShow", "");
    try {
      aplicarMapaShow(await llamarWorker({ accion: "mapaShowInterruptor", clave: claveRecepcion, campo, valor: casilla.checked }), { soloVivo: true });
    } catch (err) {
      casilla.checked = !casilla.checked;
      mensajeShow("mensajeMapaShow", err.message, "error");
    } finally {
      casilla.disabled = false;
    }
  });
});

el("btnMapaGuardarRefresco").addEventListener("click", (e) =>
  guardarMapa(
    e.currentTarget,
    "mapaShowRefresco",
    { refrescoSeg: Number(el("inputMapaRefresco").value), refrescoAtentoSeg: Number(el("inputMapaRefrescoAtento").value) },
    "✅ Guardado. Los celulares lo toman en su próxima actualización."
  )
);

// Dos toques, sin confirm(): el primero pregunta y el segundo reinicia.
function botonReiniciarMapa(id, tipo, texto) {
  const boton = el(id);
  boton.addEventListener("click", async () => {
    if (mapaConfirmar !== tipo) {
      mapaConfirmar = tipo;
      boton.textContent = "¿Segura? Toca otra vez";
      setTimeout(() => {
        if (mapaConfirmar === tipo) mapaConfirmar = "";
        boton.textContent = texto;
      }, 5000);
      return;
    }
    mapaConfirmar = "";
    boton.textContent = texto;
    await guardarMapa(boton, "mapaShowReiniciar", { tipo, confirmar: true }, "✅ Reiniciado.");
  });
}
botonReiniciarMapa("btnMapaReiniciarVotos", "votos", "🔄 Reiniciar votos");
botonReiniciarMapa("btnMapaReiniciarReacciones", "reacciones", "🔄 Reiniciar reacciones");

// ==========================================
// ATRACCIONES NUEVAS Y STAFF DEL MAPA
// Sin máximo de atracciones. Los datos salen de mapaShowCatalogo, que sí va a
// Airtable: por eso no entra en el refresco de cada 5 segundos.
// ==========================================
let catalogoMapaDatos = null;
let atrEdicion = null; // { id?, nombre, emoji, tema, color, x, y, origen, foto }
let atrConfirmarBorrar = false;
let staffEdicion = null; // { id?, foto, fotoSrc }
let staffAbiertaAtraccion = "";
// El mapa en un celular de 375 px y lo que mide un pin ahí (ver show/index.html).
const ANCHO_MAPA_CELULAR = 343;
const ALTO_MAPA_CELULAR = 229;
const PIN_CELULAR = 36;

async function cargarCatalogoMapa() {
  try {
    aplicarCatalogoMapa(await llamarWorker({ accion: "mapaShowCatalogo", clave: claveRecepcion }));
  } catch (e) {
    mensajeShow("mensajeMapaShow", e.message, "error");
  }
}

function aplicarCatalogoMapa(d) {
  catalogoMapaDatos = d;
  pintarEditorMapa();
  pintarListaAtracciones();
  pintarListaStaff();
}

async function accionCatalogo(boton, accion, datos, aviso) {
  if (boton) boton.disabled = true;
  mensajeShow("mensajeMapaShow", "");
  try {
    const d = await llamarWorker({ accion, clave: claveRecepcion, ...datos });
    if (d.necesitaConfirmar) return d;
    aplicarCatalogoMapa(d);
    if (aviso) mensajeShow("mensajeMapaShow", aviso, "ok");
    return d;
  } catch (e) {
    mensajeShow("mensajeMapaShow", e.message, "error");
    return null;
  } finally {
    if (boton) boton.disabled = false;
  }
}

function todasLasAtracciones() {
  const { textosBase, nuevas } = catalogoMapaDatos;
  const textos = (mapaDatos && mapaDatos.config.textos) || {};
  return [
    ...Object.entries(textosBase).map(([id, b]) => {
      const t = textos[id] || {};
      return { id, nombre: t.nombre || id, emoji: t.emoji || b.emoji, color: t.color || b.color, x: b.x, y: b.y, fija: true };
    }),
    ...nuevas,
  ];
}

// Se avisa, no se impide: Ana decide si lo mueve.
function atraccionesMuyCerca(x, y, propia) {
  return todasLasAtracciones().filter((a) => {
    if (a.id === propia) return false;
    const dx = ((a.x - x) / 100) * ANCHO_MAPA_CELULAR;
    const dy = ((a.y - y) / 100) * ALTO_MAPA_CELULAR;
    return Math.hypot(dx, dy) < PIN_CELULAR;
  });
}

function pinSeCorta(x, y) {
  const margenX = (PIN_CELULAR / 2 / ANCHO_MAPA_CELULAR) * 100;
  const margenY = (PIN_CELULAR / 2 / ALTO_MAPA_CELULAR) * 100;
  return x < margenX || x > 100 - margenX || y < margenY || y > 100 - margenY;
}

function pintarAvisoCerca() {
  const aviso = el("mapaAvisoCerca");
  const hayLugar = atrEdicion && atrEdicion.x !== null;
  const lista = hayLugar ? atraccionesMuyCerca(atrEdicion.x, atrEdicion.y, atrEdicion.id) : [];
  const avisos = [];
  if (lista.length) avisos.push(`En celular queda muy pegada a ${lista.map((a) => `«${a.nombre}»`).join(", ")}.`);
  if (hayLugar && pinSeCorta(atrEdicion.x, atrEdicion.y)) avisos.push("En celular el pin se corta en la orilla del mapa.");
  aviso.hidden = !avisos.length;
  aviso.textContent = avisos.length ? `⚠️ ${avisos.join(" ")} Arrastra el pin para moverlo o guarda así si te parece bien.` : "";
}

function crearPinMapa(a, clase) {
  const pin = crearEl("span", `mapa-pin ${clase}`, a.emoji || "📍");
  pin.style.left = `${a.x}%`;
  pin.style.top = `${a.y}%`;
  pin.style.background = a.color;
  pin.title = a.nombre || "";
  return pin;
}

function pintarEditorMapa() {
  const editor = el("mapaEditor");
  if (!editor || !catalogoMapaDatos) return;
  editor.querySelectorAll(".mapa-pin").forEach((p) => p.remove());
  editor.classList.toggle("eligiendo", Boolean(atrEdicion) && atrEdicion.x === null);
  todasLasAtracciones().forEach((a) => {
    if (atrEdicion && a.id && a.id === atrEdicion.id) return;
    const pin = crearPinMapa(a, a.fija ? "fijo" : "movible");
    if (!a.fija) pin.addEventListener("pointerdown", (e) => empezarArrastre(e, a));
    editor.appendChild(pin);
  });
  if (atrEdicion && atrEdicion.x !== null) {
    const pin = crearPinMapa({ ...atrEdicion, emoji: el("atrEmoji").value.trim() || atrEdicion.emoji, color: el("atrColor").value }, "movible editando");
    pin.addEventListener("pointerdown", (e) => empezarArrastre(e, atrEdicion));
    editor.appendChild(pin);
  }
  pintarAvisoCerca();
}

function lugarEnMapa(ev) {
  const r = el("mapaEditor").getBoundingClientRect();
  const limitar = (v) => Math.round(Math.max(0, Math.min(100, v)) * 100) / 100;
  return { x: limitar(((ev.clientX - r.left) / r.width) * 100), y: limitar(((ev.clientY - r.top) / r.height) * 100) };
}

// Tocar un pin nuevo lo abre; arrastrarlo además lo mueve. Se guarda con el botón.
function empezarArrastre(ev, atraccion) {
  ev.preventDefault();
  ev.stopPropagation();
  if (!atrEdicion || atrEdicion.id !== atraccion.id) abrirFormAtraccion(atraccion);
  const pin = el("mapaEditor").querySelector(".editando");
  pin.setPointerCapture(ev.pointerId);
  const mover = (m) => {
    Object.assign(atrEdicion, lugarEnMapa(m));
    pin.style.left = `${atrEdicion.x}%`;
    pin.style.top = `${atrEdicion.y}%`;
    pintarAvisoCerca();
  };
  const soltar = () => {
    pin.removeEventListener("pointermove", mover);
    pin.removeEventListener("pointerup", soltar);
    pin.removeEventListener("pointercancel", soltar);
  };
  pin.addEventListener("pointermove", mover);
  pin.addEventListener("pointerup", soltar);
  pin.addEventListener("pointercancel", soltar);
}

el("mapaEditor")?.addEventListener("click", (ev) => {
  if (!atrEdicion) return;
  // Un toque suelto solo pone el pin la primera vez; después se arrastra.
  if (atrEdicion.x !== null) return;
  Object.assign(atrEdicion, lugarEnMapa(ev));
  el("mapaAyudaLugar").textContent = "Arrastra el pin si quieres moverlo.";
  pintarEditorMapa();
  el("atrNombre").focus();
});

function abrirFormAtraccion(a) {
  atrEdicion = { ...a };
  atrConfirmarBorrar = false;
  el("formAtraccion").hidden = false;
  el("atrNombre").value = a.nombre || "";
  el("atrEmoji").value = a.emoji || "";
  el("atrTema").value = a.tema || "";
  el("atrColor").value = a.color || "#6a3fa0";
  el("atrOrigen").value = a.origen || "Alumnas";
  const borrar = el("btnAtrBorrar");
  borrar.hidden = !a.id;
  borrar.textContent = "🗑️ Borrar atracción";
  pintarFotoAtraccion();
  pintarCasillasStaff(el("atrStaffLista"), a.id ? catalogoMapaDatos.staff.filter((p) => p.atracciones.includes(a.id)) : []);
  pintarStaffAtraccion();
  pintarEditorMapa();
}

function pintarStaffAtraccion() {
  el("atrStaffCaja").hidden = el("atrOrigen").value !== "Staff";
}

function pintarFotoAtraccion() {
  // Todo lo que no es "Alumnas" guarda su foto grupal aquí (la de alumnas va
  // con su baile en Alumnas Show → Fotos).
  const guardadaDeStaff = atrEdicion && atrEdicion.id && atrEdicion.origen && atrEdicion.origen !== "Alumnas" && el("atrOrigen").value === atrEdicion.origen;
  el("atrFotoCaja").hidden = !guardadaDeStaff;
  el("btnAtrFotoQuitar").hidden = !(guardadaDeStaff && atrEdicion.foto);
  el("btnAtrFoto").textContent = guardadaDeStaff && atrEdicion.foto ? "📸 Reemplazar foto grupal" : "📸 Subir foto grupal";
}

function cerrarFormAtraccion() {
  atrEdicion = null;
  el("formAtraccion").hidden = true;
  el("mapaAyudaLugar").textContent = "Las atracciones nuevas se conservan para el próximo año. Toca un pin nuevo para editarlo o arrástralo para moverlo.";
  pintarEditorMapa();
}

el("btnMapaAgregarAtraccion")?.addEventListener("click", () => {
  abrirFormAtraccion({ x: null, y: null });
  el("mapaAyudaLugar").textContent = "👆 Toca el lugar del mapa donde va el pin.";
  el("mapaEditor").scrollIntoView({ block: "center", behavior: "smooth" });
});
el("btnAtrCancelar")?.addEventListener("click", cerrarFormAtraccion);
el("atrOrigen")?.addEventListener("change", () => {
  pintarFotoAtraccion();
  pintarStaffAtraccion();
});
["atrEmoji", "atrColor"].forEach((id) => el(id)?.addEventListener("input", pintarEditorMapa));

el("btnAtrGuardar")?.addEventListener("click", async (e) => {
  if (atrEdicion.x === null) {
    mensajeShow("mensajeMapaShow", "Toca el mapa para elegir el lugar.", "error");
    return;
  }
  const atraccion = {
    id: atrEdicion.id,
    nombre: el("atrNombre").value,
    emoji: el("atrEmoji").value,
    tema: el("atrTema").value,
    color: el("atrColor").value,
    x: atrEdicion.x,
    y: atrEdicion.y,
    origen: el("atrOrigen").value,
  };
  const boton = e.currentTarget;
  // Se lee antes de guardar: guardar repinta el catálogo.
  const staffIds = atraccion.origen === "Staff" ? [...document.querySelectorAll("#atrStaffLista input:checked")].map((c) => c.value) : null;
  const aviso = "✅ Atracción guardada. Se ve en el mapa en unos 20 segundos.";
  const r = await accionCatalogo(boton, "mapaShowAtraccionGuardar", { atraccion }, aviso);
  if (!r) return;
  // Si lo del staff falla y se reintenta, no debe crear otra atracción igual.
  atrEdicion.id = atraccion.id || r.id;
  if (staffIds && !(await accionCatalogo(boton, "mapaShowStaffAsignar", { atraccion: atrEdicion.id, staffIds }, aviso))) return;
  cerrarFormAtraccion();
});

// Dos toques, sin confirm(): el primero dice qué se pierde.
el("btnAtrBorrar")?.addEventListener("click", async (e) => {
  const boton = e.currentTarget;
  const r = await accionCatalogo(boton, "mapaShowAtraccionEliminar", { id: atrEdicion.id, confirmar: atrConfirmarBorrar }, "✅ Atracción borrada.");
  if (!r) return;
  if (r.necesitaConfirmar) {
    atrConfirmarBorrar = true;
    const partes = [r.votos && `${r.votos} votos`, r.reacciones && `${r.reacciones} reacciones`].filter(Boolean);
    boton.textContent = "¿Segura? Toca otra vez";
    mensajeShow(
      "mensajeMapaShow",
      `${partes.length ? `Tiene ${partes.join(" y ")}, que salen del ranking. ` : ""}${r.baile ? `El baile «${r.baile}» queda libre, no se borra.` : ""}`,
      "error"
    );
    return;
  }
  cerrarFormAtraccion();
});

el("btnAtrFoto")?.addEventListener("click", () => {
  el("inputAtrFoto").value = "";
  el("inputAtrFoto").click();
});
el("inputAtrFoto")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !atrEdicion) return;
  try {
    mensajeShow("mensajeMapaShow", "Subiendo...");
    const img = await abrirImagenFoto(file);
    const archivo = await subirFotoMapa("grupal", await miniDeFoto(img, { tipo: "baile" }));
    img.close();
    const r = await accionCatalogo(null, "mapaShowAtraccionFoto", { id: atrEdicion.id, foto: archivo }, "✅ Foto grupal guardada.");
    if (r) {
      atrEdicion.foto = archivo;
      pintarFotoAtraccion();
    }
  } catch (err) {
    mensajeShow("mensajeMapaShow", err.message, "error");
  }
});
el("btnAtrFotoQuitar")?.addEventListener("click", async (e) => {
  const r = await accionCatalogo(e.currentTarget, "mapaShowAtraccionFoto", { id: atrEdicion.id, foto: "" }, "✅ Foto quitada.");
  if (r) {
    atrEdicion.foto = "";
    pintarFotoAtraccion();
  }
});

async function subirFotoMapa(tipo, blob) {
  const form = new FormData();
  form.set("tipo", tipo);
  form.set("foto", blob, "foto");
  const resp = await fetch(`${WORKER_URL}/subirFotoStaff`, { method: "POST", headers: { "X-Clave-Recepcion": claveRecepcion }, body: form });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || !datos.success) throw new Error(datos.error || "No se pudo subir.");
  return datos.archivo;
}

function pintarListaAtracciones() {
  const cont = el("listaMapaAtracciones");
  if (!cont) return;
  cont.innerHTML = "";
  const { staff, baileDe } = catalogoMapaDatos;
  todasLasAtracciones().forEach((a) => {
    const suyos = staff.filter((p) => p.atracciones.includes(a.id));
    const tarjeta = crearEl("div", "show-tarjeta show-tarjeta-fila");
    tarjeta.style.flexWrap = "wrap";
    const texto = crearEl("span", "show-tarjeta-texto");
    texto.style.flex = "1 1 60%"; // Si no, un detalle largo baja los botones a otra línea.
    texto.appendChild(crearEl("span", "show-tarjeta-nombre", `${a.emoji} ${a.nombre}`));
    const alumnas = a.origen === "Staff" ? "" : baileDe[a.id] ? `Alumnas: ${baileDe[a.id]}` : "";
    const detalle = [alumnas, suyos.length ? `Staff: ${suyos.map((p) => p.nombre).join(", ")}` : "Sin staff"].filter(Boolean).join(" · ");
    texto.appendChild(crearEl("span", "tarjeta-resultado-detalle", detalle));
    const acciones = crearEl("span", "staff-botones");
    if (!a.fija) {
      const editar = crearEl("button", "", "✏️");
      editar.type = "button";
      editar.setAttribute("aria-label", `Editar ${a.nombre}`);
      editar.addEventListener("click", () => {
        abrirFormAtraccion(a);
        el("mapaEditor").scrollIntoView({ block: "center", behavior: "smooth" });
      });
      acciones.appendChild(editar);
    }
    const elegir = crearEl("button", "mapa-btn-staff", "👩‍🏫 Elegir staff");
    elegir.type = "button";
    elegir.setAttribute("aria-label", `Elegir staff de ${a.nombre}`);
    elegir.addEventListener("click", () => {
      staffAbiertaAtraccion = staffAbiertaAtraccion === a.id ? "" : a.id;
      pintarListaAtracciones();
    });
    acciones.appendChild(elegir);
    tarjeta.append(texto, acciones);
    if (staffAbiertaAtraccion === a.id) tarjeta.appendChild(crearElegirStaff(a, suyos));
    cont.appendChild(tarjeta);
    // Sin esto, en las últimas tarjetas la lista abre debajo de la pantalla y
    // parece que el botón no hizo nada.
    if (staffAbiertaAtraccion === a.id) tarjeta.scrollIntoView({ block: "nearest" });
  });
}

// Todas las personas, también las que tienen «Mapa» apagado.
function pintarCasillasStaff(caja, suyos) {
  caja.innerHTML = "";
  const { staff } = catalogoMapaDatos;
  if (!staff.length) {
    caja.appendChild(crearEl("p", "pista-campo", "Primero agrega personas en la pestaña Staff."));
    return;
  }
  staff.forEach((p) => {
    const fila = crearEl("label", "mapa-interruptor");
    const casilla = crearEl("input");
    casilla.type = "checkbox";
    casilla.value = p.id;
    casilla.checked = suyos.includes(p);
    fila.append(casilla, crearEl("span", "", p.mostrar ? p.nombre : `${p.nombre} (Mapa apagado)`));
    caja.appendChild(fila);
  });
}

function crearElegirStaff(a, suyos) {
  const caja = crearEl("div", "mapa-staff-opciones");
  pintarCasillasStaff(caja, suyos);
  if (!catalogoMapaDatos.staff.length) return caja;
  const guardar = crearEl("button", "btn-secundario btn-chico", "Guardar staff");
  guardar.type = "button";
  guardar.addEventListener("click", async () => {
    const staffIds = [...caja.querySelectorAll("input:checked")].map((c) => c.value);
    staffAbiertaAtraccion = "";
    await accionCatalogo(guardar, "mapaShowStaffAsignar", { atraccion: a.id, staffIds }, "✅ Staff guardado.");
  });
  caja.appendChild(guardar);
  return caja;
}

function inicialesStaff(nombre) {
  return nombre.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// La foto de quien no se muestra no tiene URL pública: se pide con la clave.
async function ponerFotoPrivada(img, archivo) {
  const resp = await fetch(WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "showFotoRecepcion", clave: claveRecepcion, archivo }) });
  if (resp.ok) img.src = URL.createObjectURL(await resp.blob());
}

function crearAvatarStaff(nombre, { archivo = "", src = "" } = {}) {
  const avatar = crearEl("span", "staff-avatar", archivo || src ? "" : inicialesStaff(nombre || "?"));
  if (archivo || src) {
    const img = crearEl("img");
    img.alt = "";
    if (src) img.src = src;
    else ponerFotoPrivada(img, archivo);
    avatar.appendChild(img);
  }
  return avatar;
}

function pintarListaStaff() {
  const cont = el("listaMapaStaff");
  if (!cont) return;
  cont.innerHTML = "";
  const { staff } = catalogoMapaDatos;
  if (!staff.length) cont.appendChild(crearEl("p", "pista-campo", "Todavía no hay nadie."));
  staff.forEach((p, i) => {
    const fila = crearEl("div", "staff-fila");
    fila.dataset.id = p.id;
    const agarre = crearEl("span", "staff-agarre", "⠿");
    agarre.setAttribute("aria-label", `Arrastrar a ${p.nombre}`);
    agarre.addEventListener("pointerdown", (e) => arrastrarFilaStaff(e, fila));
    const texto = crearEl("span", "staff-texto");
    texto.appendChild(crearEl("span", "show-tarjeta-nombre", p.nombre));
    texto.appendChild(crearEl("span", "tarjeta-resultado-detalle", p.puesto || "Sin puesto"));
    const mostrar = crearEl("label", "mapa-interruptor");
    const casilla = crearEl("input");
    casilla.type = "checkbox";
    casilla.checked = p.mostrar;
    casilla.setAttribute("aria-label", `Mostrar a ${p.nombre} en el mapa`);
    casilla.addEventListener("change", async () => {
      const ok = await accionCatalogo(casilla, "mapaShowStaffGuardar", { persona: { id: p.id, nombre: p.nombre, puesto: p.puesto, foto: p.foto, mostrar: casilla.checked } });
      if (!ok) casilla.checked = !casilla.checked;
    });
    mostrar.append(casilla, crearEl("span", "", "Mapa"));
    const botones = crearEl("span", "staff-botones");
    const boton = (t, etiqueta, fn, apagado) => {
      const b = crearEl("button", "", t);
      b.type = "button";
      b.setAttribute("aria-label", etiqueta);
      b.disabled = Boolean(apagado);
      b.addEventListener("click", fn);
      botones.appendChild(b);
    };
    boton("↑", `Subir a ${p.nombre}`, () => moverStaff(i, -1), i === 0);
    boton("↓", `Bajar a ${p.nombre}`, () => moverStaff(i, 1), i === staff.length - 1);
    boton("✏️", `Editar a ${p.nombre}`, () => abrirFormStaff(p));
    boton("🗑️", `Borrar a ${p.nombre}`, (e) => borrarStaff(e.currentTarget, p));
    fila.append(agarre, crearAvatarStaff(p.nombre, { archivo: p.foto }), texto, mostrar, botones);
    cont.appendChild(fila);
  });
}

async function moverStaff(i, paso) {
  const ids = catalogoMapaDatos.staff.map((p) => p.id);
  [ids[i], ids[i + paso]] = [ids[i + paso], ids[i]];
  await accionCatalogo(null, "mapaShowStaffOrdenar", { ids });
}

// El DOM se reordena en vivo y solo al soltar se guarda. Se escucha en window:
// mover la fila en el DOM suelta el setPointerCapture y se perdería el dedo.
function arrastrarFilaStaff(ev, fila) {
  ev.preventDefault();
  fila.classList.add("moviendo");
  const cont = el("listaMapaStaff");
  const mover = (m) => {
    const otra = [...cont.children].find((f) => {
      if (f === fila) return false;
      const r = f.getBoundingClientRect();
      return m.clientY > r.top && m.clientY < r.bottom;
    });
    if (!otra) return;
    const r = otra.getBoundingClientRect();
    cont.insertBefore(fila, m.clientY < r.top + r.height / 2 ? otra : otra.nextSibling);
  };
  const soltar = async () => {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
    fila.classList.remove("moviendo");
    const ids = [...cont.children].map((f) => f.dataset.id);
    if (ids.join() !== catalogoMapaDatos.staff.map((p) => p.id).join()) await accionCatalogo(null, "mapaShowStaffOrdenar", { ids }, "✅ Orden guardado.");
  };
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);
}

function pintarFotoStaffForm() {
  const vista = el("staffFotoVista");
  vista.replaceWith(Object.assign(crearAvatarStaff(el("staffNombre").value, { archivo: staffEdicion.fotoSrc ? "" : staffEdicion.foto, src: staffEdicion.fotoSrc }), { id: "staffFotoVista" }));
  el("btnStaffFotoQuitar").hidden = !staffEdicion.foto;
  el("btnStaffFoto").textContent = staffEdicion.foto ? "📸 Reemplazar foto" : "📸 Elegir foto";
}

function abrirFormStaff(p) {
  staffEdicion = { id: p && p.id, foto: (p && p.foto) || "", fotoSrc: "" };
  el("formStaff").hidden = false;
  el("cajaStaffMaestras").hidden = true;
  el("staffNombre").value = (p && p.nombre) || "";
  el("staffPuesto").value = (p && p.puesto) || "";
  el("staffMostrar").checked = Boolean(p && p.mostrar);
  pintarFotoStaffForm();
  el("staffNombre").focus();
}
function cerrarFormStaff() {
  staffEdicion = null;
  el("formStaff").hidden = true;
}
el("btnStaffAgregar")?.addEventListener("click", () => abrirFormStaff(null));
el("btnStaffCancelar")?.addEventListener("click", cerrarFormStaff);
el("btnStaffFoto")?.addEventListener("click", () => {
  el("inputStaffFoto").value = "";
  el("inputStaffFoto").click();
});
el("inputStaffFoto")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !staffEdicion) return;
  try {
    const encuadre = await pedirEncuadre(file);
    if (!encuadre) return;
    mensajeShow("mensajeMapaShow", "Subiendo...");
    const img = await abrirImagenFoto(file);
    const blob = await miniDeFoto(img, { tipo: "alumna", encuadre });
    img.close();
    staffEdicion.foto = await subirFotoMapa("staff", blob);
    staffEdicion.fotoSrc = URL.createObjectURL(blob);
    pintarFotoStaffForm();
    mensajeShow("mensajeMapaShow", "Foto lista. Falta tocar Guardar.", "ok");
  } catch (err) {
    mensajeShow("mensajeMapaShow", err.message, "error");
  }
});
el("btnStaffFotoQuitar")?.addEventListener("click", () => {
  staffEdicion.foto = "";
  staffEdicion.fotoSrc = "";
  pintarFotoStaffForm();
});
el("btnStaffGuardar")?.addEventListener("click", async (e) => {
  const persona = { id: staffEdicion.id, nombre: el("staffNombre").value, puesto: el("staffPuesto").value, foto: staffEdicion.foto, mostrar: el("staffMostrar").checked };
  const r = await accionCatalogo(e.currentTarget, "mapaShowStaffGuardar", { persona }, "✅ Guardado.");
  if (r) cerrarFormStaff();
});

let staffPorBorrar = "";
async function borrarStaff(boton, p) {
  if (staffPorBorrar !== p.id) {
    staffPorBorrar = p.id;
    boton.textContent = "❓";
    mensajeShow("mensajeMapaShow", `Toca otra vez para borrar a ${p.nombre}.`, "error");
    setTimeout(() => {
      if (staffPorBorrar === p.id) staffPorBorrar = "";
      boton.textContent = "🗑️";
    }, 5000);
    return;
  }
  staffPorBorrar = "";
  await accionCatalogo(boton, "mapaShowStaffEliminar", { id: p.id }, `✅ ${p.nombre} se quitó de la lista.`);
}

el("btnStaffMaestras")?.addEventListener("click", async (e) => {
  const caja = el("cajaStaffMaestras");
  if (!caja.hidden) {
    caja.hidden = true;
    return;
  }
  cerrarFormStaff();
  const boton = e.currentTarget;
  boton.disabled = true;
  mensajeShow("mensajeMapaShow", "");
  try {
    const { maestras } = await llamarWorker({ accion: "mapaShowStaffMaestras", clave: claveRecepcion });
    const lista = el("listaStaffMaestras");
    lista.innerHTML = "";
    if (!maestras.length) lista.appendChild(crearEl("p", "pista-campo", "Ya están todas en la lista."));
    maestras.forEach((n) => {
      const fila = crearEl("label", "mapa-interruptor");
      const casilla = crearEl("input");
      casilla.type = "checkbox";
      casilla.value = n;
      casilla.checked = true;
      fila.append(casilla, crearEl("span", "", n));
      lista.appendChild(fila);
    });
    el("btnStaffImportar").hidden = !maestras.length;
    caja.hidden = false;
  } catch (err) {
    mensajeShow("mensajeMapaShow", err.message, "error");
  } finally {
    boton.disabled = false;
  }
});
el("btnStaffImportar")?.addEventListener("click", async (e) => {
  const nombres = [...document.querySelectorAll("#listaStaffMaestras input:checked")].map((c) => c.value);
  const r = await accionCatalogo(e.currentTarget, "mapaShowStaffImportar", { nombres });
  if (r) {
    el("cajaStaffMaestras").hidden = true;
    mensajeShow("mensajeMapaShow", `✅ ${r.agregadas} agregadas, sin mostrarse en el mapa todavía.`, "ok");
  }
});

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
  // "?.": hasta 10 min tras publicar, un recepcion.html viejo en caché puede
  // cargar este archivo nuevo (GitHub Pages ignora el ?v=).
  ["Catalogo", "Asignar", "Fotos", "Resumen", "Trajes", "Recibir", "Pagos", "Modista"].forEach((n) => {
    const vista = el("vistaShow" + n);
    if (vista) vista.hidden = n !== nombre;
  });
  if (nombre === "Asignar" && !showAlumnas) cargarAlumnasShow();
  if ((nombre === "Asignar" || nombre === "Fotos") && el("vistaShowFotos")) cargarFotosShow();
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
  renderSelectAtraccionBaile();
  renderCatalogoShow();
  renderResumenShow();
  renderTrajePortal();
  renderSelectGruposTrajes();
  renderTrajesShow();
  renderRecibirTrajes();
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
// Las atracciones de otro baile salen deshabilitadas: cada una es de un solo
// baile (el Worker también lo revisa).
function renderSelectAtraccionBaile() {
  const select = el("selectShowAtraccionBaile");
  const elegida = select.value;
  select.innerHTML = "";
  const vacia = crearEl("option", "", "Sin atracción");
  vacia.value = "";
  select.appendChild(vacia);
  const todas = [...(showDatos.atraccionesMapa || []).map((a) => ({ id: a, nombre: a })), ...(showDatos.atraccionesNuevas || [])];
  todas.forEach(({ id: atraccion, nombre }) => {
    const duena = showDatos.bailes.find((b) => b.atraccion === atraccion && b.id !== showBaileEditandoId);
    const opcion = crearEl("option", "", duena ? `${nombre} (ya es de ${duena.nombre})` : nombre);
    opcion.value = atraccion;
    opcion.disabled = Boolean(duena);
    select.appendChild(opcion);
  });
  select.value = elegida;
}

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
          `Modista ${formatoQuetzales(b.precio)} · Venta ${formatoQuetzales(b.precioVenta)} · ${b.alumnas.length} alumna${b.alumnas.length === 1 ? "" : "s"}`
        )
      );
      tarjeta.appendChild(crearEl("span", "tarjeta-resultado-detalle", b.atraccion ? `🗺️ ${b.atraccionNombre || b.atraccion}` : "🗺️ Sin atracción (no sale en el mapa)"));

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
  el("inputShowPrecioVentaBaile").value = typeof baile.precioVenta === "number" ? baile.precioVenta : "";
  renderSelectAtraccionBaile();
  el("selectShowAtraccionBaile").value = baile.atraccion || "";
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
  el("inputShowPrecioVentaBaile").value = "";
  el("selectShowAtraccionBaile").value = "";
  if (showDatos) renderSelectAtraccionBaile();
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
  const precioVenta = el("inputShowPrecioVentaBaile").value;
  if (!grupoId) return mensajeShow("mensajeFormBaile", "Escoge el Grupo MOVE.", "error");
  if (!nombre) return mensajeShow("mensajeFormBaile", "Escribe el nombre del baile.", "error");
  if (precio === "" || Number(precio) < 0) {
    return mensajeShow("mensajeFormBaile", "Escribe el precio de la modista.", "error");
  }
  if (precioVenta !== "" && Number(precioVenta) < 0) {
    return mensajeShow("mensajeFormBaile", "El precio de venta no puede ser negativo (o déjalo vacío).", "error");
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
      // Vacío = "Sin precio" (el Worker lo borra en Airtable).
      precioVenta: precioVenta === "" ? "" : Number(precioVenta),
      atraccion: el("selectShowAtraccionBaile").value,
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
    const r = await llamarWorker({ accion: "showEliminarBaile", clave: claveRecepcion, baileId: baile.id, confirmar: true });
    if (showBaileEditandoId === baile.id) limpiarFormularioBaile();
    // Las que se quedaron sin ningún baile perdieron su "SI SALE" en el
    // Worker: la lista de "Asignar alumnas" se vuelve a pedir para que la
    // etiqueta no quede vieja.
    if (r.alumnasSinShow) {
      showAlumnas = null;
      showResultadosBusqueda = null;
    }
    mensajeShow(
      "mensajeShow",
      `✅ Se eliminó "${baile.nombre}".` +
        (r.alumnasSinShow ? ` ${r.alumnasSinShow} alumna(s) se quedaron sin baile y ya no dicen "SI SALE".` : ""),
      "ok"
    );
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
  mensajeShow("mensajeNombreMapa", "");
  el("inputShowNombreMapa").value = alumna.nombreShow || "";
  el("inputShowNombreMapa").placeholder = alumna.nombreShowAuto || "";
  if (el("mensajeFotoAlumna")) {
    mensajeShow("mensajeFotoAlumna", "");
    pintarFotoAlumnaAsignar();
  }
  renderSelectGrupoAlumna();
  renderAlumnaShow();
}

el("btnGuardarNombreMapa").addEventListener("click", async () => {
  const alumna = showAlumnaElegida;
  if (!alumna) return;
  const boton = el("btnGuardarNombreMapa");
  boton.disabled = true;
  try {
    const r = await llamarWorker({ accion: "showGuardarNombreShow", clave: claveRecepcion, alumnaId: alumna.id, nombreShow: el("inputShowNombreMapa").value });
    alumna.nombreShow = r.nombreShow;
    el("inputShowNombreMapa").value = r.nombreShow;
    mensajeShow("mensajeNombreMapa", "✅ Guardado. El mapa se actualiza en máximo 5 minutos.", "ok");
  } catch (e) {
    mensajeShow("mensajeNombreMapa", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

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
    if (r.quitadas && !r.creadas && !r.show) partes.push('ya no tiene bailes, así que se le quitó el "SI SALE"');
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
    const r = await llamarWorker({ accion: "showQuitarAsignacion", clave: claveRecepcion, asignacionId: asignacion.asignacionId });
    // Era su último baile: el Worker le vació SHOW.
    if (r.showVaciado && showAlumnaElegida) showAlumnaElegida.show = "";
    mensajeShow(
      "mensajeAsignarShow",
      `✅ Se quitó de "${baile.nombre}".` + (r.showVaciado ? ' Ya no tiene bailes: se le quitó el "SI SALE".' : ""),
      "ok"
    );
    await recargarDatosShow();
  } catch (e) {
    mensajeShow("mensajeAsignarShow", e.message, "error");
    boton.disabled = false;
  }
}

// ---------- Resumen por baile ----------

// Cuentas con la modista y venta a papás. Todo viene calculado del
// Worker (showDatos.cuentas); aquí solo se pinta. Un baile sin precio
// sale "Sin precio" y arriba se avisa que el total no lo incluye.
function renderCuentasShow() {
  const cont = el("cuentasShowResumen");
  cont.innerHTML = "";
  const c = showDatos.cuentas;
  if (!c) return;

  const linea = (etiqueta, valor, clase = "") => {
    const fila = crearEl("div", "cuentas-linea " + clase);
    fila.append(crearEl("span", "", etiqueta), crearEl("strong", "", valor));
    return fila;
  };
  const aviso = (n, que) =>
    n ? crearEl("p", "cuentas-aviso", `⚠️ ${n} baile${n === 1 ? "" : "s"} con alumnas sin ${que}: el total no ${n === 1 ? "lo" : "los"} incluye.`) : null;

  const modista = crearEl("div", "cuentas-caja");
  modista.appendChild(crearEl("p", "cuentas-titulo", `🧵 Modista · ${c.totalTrajes} traje${c.totalTrajes === 1 ? "" : "s"}`));
  modista.append(linea("Total trajes", formatoQuetzales(c.totalModista)), linea("Pagado", formatoQuetzales(c.pagado)));
  modista.appendChild(
    c.saldo < 0
      ? linea("Saldo a favor de la academia", formatoQuetzales(-c.saldo), "cuentas-saldo a-favor")
      : linea("Saldo pendiente", formatoQuetzales(c.saldo), "cuentas-saldo")
  );
  const avisoModista = aviso(c.bailesSinPrecio, "precio de modista");
  if (avisoModista) modista.appendChild(avisoModista);
  cont.appendChild(modista);

  const venta = crearEl("div", "cuentas-caja cuentas-privada");
  venta.appendChild(crearEl("p", "cuentas-titulo", "🔒 Venta a papás (solo Recepción)"));
  venta.append(
    linea("Total venta a papás", formatoQuetzales(c.totalVenta)),
    linea("Ganancia estimada", formatoQuetzales(c.ganancia), "cuentas-ganancia" + (c.ganancia < 0 ? " negativa" : ""))
  );
  const avisoVenta = aviso(c.bailesSinPrecioVenta, "precio de venta");
  if (avisoVenta) venta.appendChild(avisoVenta);
  if (c.bailesSinPrecioVenta) {
    venta.appendChild(crearEl("p", "cuentas-nota", "La ganancia solo cuenta los bailes que tienen los dos precios."));
  }
  cont.appendChild(venta);

  cont.appendChild(crearEl("p", "subtitulo", "Detalle por baile"));
  const lista = crearEl("div", "show-lista");
  if (!c.detalle.length) lista.appendChild(crearEl("p", "lista-vacia", "Todavía no hay bailes."));
  c.detalle.forEach((d) => {
    const tarjeta = crearEl("div", "show-tarjeta cuentas-baile" + (d.activo ? "" : " inactivo"));
    const fila = crearEl("div", "show-tarjeta-fila");
    fila.appendChild(crearEl("span", "show-tarjeta-nombre", `${d.nombre}${d.activo ? "" : " (desactivado)"}`));
    fila.appendChild(crearEl("span", "show-contador", String(d.trajes)));
    tarjeta.appendChild(fila);
    tarjeta.appendChild(crearEl("span", "tarjeta-resultado-detalle", `${d.grupo} · ${d.trajes} traje${d.trajes === 1 ? "" : "s"}`));
    const precios = crearEl("div", "cuentas-precios");
    precios.append(
      linea(`Modista ${formatoQuetzales(d.precio)} × ${d.trajes}`, formatoQuetzales(d.subtotal), d.subtotal === null ? "sin-precio" : ""),
      linea(`Venta ${formatoQuetzales(d.precioVenta)} × ${d.trajes}`, formatoQuetzales(d.subtotalVenta), "cuentas-privada-linea" + (d.subtotalVenta === null ? " sin-precio" : ""))
    );
    tarjeta.appendChild(precios);
    lista.appendChild(tarjeta);
  });
  cont.appendChild(lista);
}

function renderResumenShow() {
  renderCuentasShow();
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

// ---------- Estado del traje ----------
// Seguimiento tipo "rastreo de paquete" que las familias ven en el
// portal ("👗 Mi traje para el show"). Cada toque se guarda solo; la
// fecha y hora las pone el Worker (no el reloj de esta computadora).
// "Medidas" es por alumna (el Worker la pone en todos sus trajes); lo
// demás es por traje (cada baile asignado). No se exige orden: se puede
// marcar "Entregado" aunque falte "Tallaje" (decisión de Ana). Solo salen
// los bailes ACTIVOS, que son los mismos que ve el portal.
// "🧵 Recibido" (la modista ya nos entregó el traje) es INTERNA: el
// Worker nunca la manda al portal. Va con borde punteado morado y 🔒
// para que no se confunda con lo que ven las familias.

const ETAPAS_TRAJE_RECEPCION = [
  { id: "confeccion", nombre: "✂️ Confección" },
  { id: "tallaje", nombre: "📐 Tallaje" },
  { id: "recibido", nombre: "🧵 Recibido", interna: true },
  { id: "listo", nombre: "📦 Listo" },
  { id: "entregado", nombre: "🎁 Entregado" },
  { id: "devuelto", nombre: "↩️ Devuelto" },
];
const MESES_CORTOS_TRAJE = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const FORMATO_HORA_GUATEMALA_TRAJE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Guatemala",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

// "14 oct, 4:30 p.m.", siempre en hora de Guatemala aunque la
// computadora tenga otra zona horaria. Misma función en portal.js.
function fechaHoraTraje(iso) {
  const fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return "";
  const p = {};
  FORMATO_HORA_GUATEMALA_TRAJE.formatToParts(fecha).forEach((x) => (p[x.type] = x.value));
  const hora = Number(p.hour) % 24;
  return `${Number(p.day)} ${MESES_CORTOS_TRAJE[Number(p.month) - 1]}, ${hora % 12 || 12}:${p.minute} ${hora < 12 ? "a.m." : "p.m."}`;
}

function sinAcentosTraje(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

let guardandoTrajePortal = false;

function renderTrajePortal() {
  const activo = showDatos.estadoTrajePortal === true;
  el("cajaTrajePortal").className = "ficha-show " + (activo ? "activa" : "apagada");
  el("btnTrajePortalSi").classList.toggle("elegido", activo);
  el("btnTrajePortalNo").classList.toggle("elegido", !activo);
  el("btnTrajePortalSi").disabled = guardandoTrajePortal;
  el("btnTrajePortalNo").disabled = guardandoTrajePortal;
  el("pistaTrajePortal").textContent = activo
    ? "Encendido: las familias de las alumnas asignadas a algún baile activo ven “👗 Mi traje para el show” en su perfil."
    : "Apagado: en el portal no se ve nada del traje. Se apaga solo el 1 de enero.";
}

async function guardarTrajePortal(activo) {
  if (!showDatos || showDatos.estadoTrajePortal === activo || guardandoTrajePortal) return;
  const pregunta = activo
    ? "¿Mostrar el estado del traje en el portal? Las familias de las alumnas asignadas a un baile lo verán en su perfil."
    : "¿Dejar de mostrar el estado del traje en el portal? Las familias ya no lo verán (las fechas no se borran).";
  if (!window.confirm(pregunta)) return;
  guardandoTrajePortal = true;
  renderTrajePortal();
  try {
    const datos = await llamarWorker({ accion: "showGuardarEstadoTrajePortal", clave: claveRecepcion, activo });
    showDatos.estadoTrajePortal = datos.activo === true;
    mensajeShow("mensajeShow", datos.activo ? "✅ El portal ya muestra el estado del traje." : "✅ El portal ya no muestra el estado del traje.", "ok");
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
  }
  guardandoTrajePortal = false;
  renderTrajePortal();
}

el("btnTrajePortalSi").addEventListener("click", () => guardarTrajePortal(true));
el("btnTrajePortalNo").addEventListener("click", () => guardarTrajePortal(false));

function bailesActivosTrajes() {
  return showDatos.bailes.filter((b) => b.activo);
}

function renderSelectGruposTrajes() {
  const select = el("selectTrajesGrupo");
  const elegido = select.value;
  select.innerHTML = "";
  select.appendChild(new Option("Todos los grupos", ""));
  const conBailes = new Set(bailesActivosTrajes().map((b) => b.grupoId));
  showDatos.grupos
    .filter((g) => conBailes.has(g.id))
    .forEach((g) => select.appendChild(new Option(g.nombre, g.id)));
  if ([...select.options].some((o) => o.value === elegido)) select.value = elegido;
}

el("selectTrajesGrupo").addEventListener("change", () => renderTrajesShow());
el("inputTrajesBuscar").addEventListener("input", () => renderTrajesShow());

// Alumnas con sus trajes (bailes activos), con el filtro de grupo y nombre.
function alumnasConTrajes() {
  const grupoId = el("selectTrajesGrupo").value;
  const texto = sinAcentosTraje(el("inputTrajesBuscar").value.trim());
  const porAlumna = new Map();
  bailesActivosTrajes()
    .filter((b) => !grupoId || b.grupoId === grupoId)
    .forEach((baile) => {
      baile.alumnas.forEach((a) => {
        if (texto && !sinAcentosTraje(a.nombre).includes(texto)) return;
        if (!porAlumna.has(a.alumnaId)) {
          porAlumna.set(a.alumnaId, { alumnaId: a.alumnaId, nombre: a.nombre, estado: a.estado, trajes: [] });
        }
        porAlumna.get(a.alumnaId).trajes.push({ baile, asignacion: a });
      });
    });
  return [...porAlumna.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" }));
}

// Fecha de medidas de la alumna en TODOS sus trajes (no solo los del
// grupo filtrado): es la misma en todos.
function medidasDeAlumnaTraje(alumnaId) {
  const fechas = showDatos.bailes
    .flatMap((b) => b.alumnas)
    .filter((a) => a.alumnaId === alumnaId && a.etapas && a.etapas.medidas)
    .map((a) => a.etapas.medidas)
    .sort();
  return fechas[0] || "";
}

// Nota de medidas (por alumna; la misma en todos sus trajes). Sirve para
// cuando no se le pudieron tomar medidas y la modista se basa en otra
// niña. La ven Recepción y la modista, nunca el portal (puede mencionar
// a otras niñas). No marca 📏 Medidas.
let notaEditandoAlumnaId = "";

function notaMedidasDeAlumnaTraje(alumnaId) {
  const fila = showDatos.bailes.flatMap((b) => b.alumnas).find((a) => a.alumnaId === alumnaId && a.notaMedidas);
  return fila ? fila.notaMedidas : "";
}

function editorNotaMedidas(alumna, nota) {
  const caja = crearEl("div", "traje-nota-editor");
  const texto = document.createElement("textarea");
  texto.className = "input-texto traje-nota-texto";
  texto.maxLength = 500;
  texto.rows = 3;
  texto.placeholder = "Ej. No se pudo medir, usar medidas de Fulanita, es un poco más alta";
  texto.value = nota;
  const acciones = crearEl("div", "show-acciones");
  const guardar = crearEl("button", "btn-secundario btn-chico", "💾 Guardar nota");
  guardar.type = "button";
  guardar.addEventListener("click", () => guardarNotaMedidas(alumna, texto.value, guardar));
  acciones.appendChild(guardar);
  if (nota) {
    const borrar = crearEl("button", "btn-secundario btn-chico show-btn-peligro", "🗑 Borrar nota");
    borrar.type = "button";
    borrar.addEventListener("click", () => {
      if (window.confirm(`¿Borrar la nota de medidas de ${alumna.nombre}?`)) guardarNotaMedidas(alumna, "", borrar);
    });
    acciones.appendChild(borrar);
  }
  const cancelar = crearEl("button", "btn-enlace", "Cancelar");
  cancelar.type = "button";
  cancelar.addEventListener("click", () => {
    notaEditandoAlumnaId = "";
    renderTrajesShow();
  });
  acciones.appendChild(cancelar);
  caja.append(texto, crearEl("p", "pista-campo", "La ve la modista en su link. Las familias no la ven."), acciones);
  setTimeout(() => texto.focus(), 0);
  return caja;
}

async function guardarNotaMedidas(alumna, nota, boton) {
  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    const r = await llamarWorker({ accion: "showGuardarNotaMedidas", clave: claveRecepcion, alumnaId: alumna.alumnaId, nota });
    const ids = new Set(r.asignacionIds || []);
    showDatos.bailes.forEach((b) =>
      b.alumnas.forEach((a) => {
        if (ids.has(a.asignacionId)) a.notaMedidas = r.nota || "";
      })
    );
    notaEditandoAlumnaId = "";
    mensajeShow("mensajeShow", r.nota ? `✅ Nota de medidas guardada para ${alumna.nombre}.` : `✅ Nota de medidas borrada.`, "ok");
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
  }
  renderTrajesShow();
}

function botonEtapaTraje(nombre, fecha, alGuardar, interna = false) {
  const boton = crearEl("button", "traje-etapa" + (fecha ? " marcada" : "") + (interna ? " interna" : ""));
  boton.type = "button";
  if (interna) boton.title = "Interno: las familias no lo ven en el portal";
  boton.setAttribute("aria-pressed", fecha ? "true" : "false");
  boton.appendChild(crearEl("span", "traje-etapa-nombre", nombre));
  boton.appendChild(crearEl("span", "traje-etapa-fecha", fecha ? "✓ " + fechaHoraTraje(fecha) : "Sin marcar"));
  boton.addEventListener("click", () => alGuardar(boton));
  return boton;
}

function renderTrajesShow() {
  const cont = el("listaTrajes");
  cont.innerHTML = "";
  const alumnas = alumnasConTrajes();

  const trajes = alumnas.flatMap((a) => a.trajes);
  const contar = (etapa) => trajes.filter((t) => t.asignacion.etapas && t.asignacion.etapas[etapa]).length;
  const conMedidas = alumnas.filter((a) => medidasDeAlumnaTraje(a.alumnaId)).length;
  el("resumenTrajes").textContent = trajes.length
    ? `${alumnas.length} alumnas · ${trajes.length} trajes · 📏 ${conMedidas} con medidas · ✂️ ${contar("confeccion")} · 📐 ${contar("tallaje")} · 🧵 ${contar("recibido")} · 📦 ${contar("listo")} · 🎁 ${contar("entregado")} entregados`
    : "";

  if (!alumnas.length) {
    const hayFiltro = el("selectTrajesGrupo").value || el("inputTrajesBuscar").value.trim();
    cont.appendChild(
      crearEl("p", "lista-vacia", hayFiltro ? "Ninguna alumna coincide." : "Todavía no hay alumnas asignadas a bailes activos.")
    );
    return;
  }

  alumnas.forEach((a) => {
    const tarjeta = crearEl("div", "show-tarjeta traje-tarjeta");
    const titulo = crearEl("div", "show-tarjeta-fila");
    titulo.appendChild(crearEl("span", "show-tarjeta-nombre", a.nombre));
    const estado = etiquetaEstadoAlumna(a.estado);
    if (estado) titulo.appendChild(estado);
    tarjeta.appendChild(titulo);

    const nota = notaMedidasDeAlumnaTraje(a.alumnaId);
    if (nota) tarjeta.appendChild(crearEl("p", "traje-nota", `📝 ${nota}`));

    const medidas = medidasDeAlumnaTraje(a.alumnaId);
    const filaMedidas = crearEl("div", "traje-etapas traje-etapas-medidas");
    filaMedidas.appendChild(
      botonEtapaTraje("📏 Medidas", medidas, (boton) =>
        marcarEtapaTraje({ etapa: "medidas", alumnaId: a.alumnaId }, !medidas, `“Medidas” de ${a.nombre}`, boton)
      )
    );
    const botonNota = crearEl("button", "traje-etapa traje-nota-boton" + (nota ? " con-nota" : ""));
    botonNota.type = "button";
    botonNota.append(crearEl("span", "traje-etapa-nombre", "📝 Nota"), crearEl("span", "traje-etapa-fecha", nota ? "Editar" : "Agregar"));
    botonNota.addEventListener("click", () => {
      notaEditandoAlumnaId = notaEditandoAlumnaId === a.alumnaId ? "" : a.alumnaId;
      renderTrajesShow();
    });
    filaMedidas.appendChild(botonNota);
    tarjeta.appendChild(filaMedidas);
    if (notaEditandoAlumnaId === a.alumnaId) tarjeta.appendChild(editorNotaMedidas(a, nota));

    a.trajes
      .sort((x, y) => x.baile.nombre.localeCompare(y.baile.nombre, "es", { sensitivity: "base" }))
      .forEach(({ baile, asignacion }) => {
        const traje = crearEl("div", "traje-baile");
        traje.appendChild(crearEl("p", "traje-baile-nombre", `👗 ${baile.nombre} · ${baile.grupoNombre}`));
        const etapas = crearEl("div", "traje-etapas");
        ETAPAS_TRAJE_RECEPCION.forEach((et) => {
          const fecha = (asignacion.etapas || {})[et.id] || "";
          etapas.appendChild(
            botonEtapaTraje(et.nombre, fecha, (boton) =>
              marcarEtapaTraje(
                { etapa: et.id, asignacionId: asignacion.asignacionId },
                !fecha,
                `“${et.nombre.replace(/^\S+\s/, "")}” del traje ${baile.nombre} de ${a.nombre}`,
                boton
              ),
              et.interna
            )
          );
        });
        traje.appendChild(etapas);
        tarjeta.appendChild(traje);
      });
    cont.appendChild(tarjeta);
  });
}

async function marcarEtapaTraje(datos, marcar, descripcion, boton) {
  if (!marcar && !window.confirm(`¿Desmarcar ${descripcion}? Se borra su fecha y hora.`)) return;
  boton.disabled = true;
  boton.querySelector(".traje-etapa-fecha").textContent = "Guardando...";
  try {
    const r = await llamarWorker({ accion: "showMarcarEtapaTraje", clave: claveRecepcion, marcar, ...datos });
    // Se actualiza en memoria (sin recargar todo Alumnas Show).
    const ids = new Set(r.asignacionIds || []);
    showDatos.bailes.forEach((b) =>
      b.alumnas.forEach((a) => {
        if (ids.has(a.asignacionId)) a.etapas = { ...(a.etapas || {}), [r.etapa]: r.fecha || "" };
      })
    );
    mensajeShow("mensajeShow", "");
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
  }
  renderTrajesShow();
  renderRecibirTrajes();
}

// ---------- Recibir trajes de la modista ----------
// Marca "🧵 Recibido" en varios trajes de un baile con un solo toque
// (cuando la modista llega con una bolsa de trajes). Los que ya estaban
// recibidos salen marcados y bloqueados: aquí solo se marca; desmarcar es
// traje por traje en "Estado trajes", con su confirmación.

let guardandoRecibidos = false;

function conteoRecibidos(baile) {
  return { recibidos: baile.alumnas.filter((a) => a.etapas && a.etapas.recibido).length, total: baile.alumnas.length };
}

function nombreBaileRecibir(baile) {
  return `${baile.nombre} · ${baile.grupoNombre}`;
}

function bailesParaRecibir() {
  return bailesActivosTrajes()
    .filter((b) => b.alumnas.length)
    .sort((x, y) => nombreBaileRecibir(x).localeCompare(nombreBaileRecibir(y), "es", { sensitivity: "base", numeric: true }));
}

function renderRecibirTrajes() {
  if (!showDatos) return;
  const select = el("selectRecibirBaile");
  const elegido = select.value;
  const bailes = bailesParaRecibir();
  select.innerHTML = "";
  select.appendChild(new Option(bailes.length ? "Escoge un baile..." : "No hay bailes activos con alumnas", ""));
  bailes.forEach((b) => {
    const { recibidos, total } = conteoRecibidos(b);
    select.appendChild(new Option(`${nombreBaileRecibir(b)} (${recibidos} de ${total})`, b.id));
  });
  if ([...select.options].some((o) => o.value === elegido)) select.value = elegido;

  // Resumen de todos los bailes, para ver de un vistazo qué falta.
  const resumen = el("resumenRecibirBailes");
  resumen.innerHTML = "";
  if (!bailes.length) resumen.appendChild(crearEl("p", "lista-vacia", "Todavía no hay alumnas asignadas a bailes activos."));
  bailes.forEach((b) => {
    const { recibidos, total } = conteoRecibidos(b);
    const fila = crearEl("div", "show-tarjeta-fila traje-recibir-fila" + (recibidos === total ? " completo" : ""));
    fila.append(
      crearEl("span", "show-tarjeta-nombre", nombreBaileRecibir(b)),
      crearEl("span", "traje-recibir-conteo", `Recibidos: ${recibidos} de ${total}`)
    );
    resumen.appendChild(fila);
  });

  renderListaRecibir();
}

function renderListaRecibir() {
  const baile = bailesParaRecibir().find((b) => b.id === el("selectRecibirBaile").value);
  const lista = el("listaRecibir");
  const boton = el("btnMarcarRecibidos");
  lista.hidden = !baile;
  boton.hidden = !baile;
  if (!baile) {
    el("resumenRecibir").textContent = "";
    return;
  }
  const marcadas = new Set([...lista.querySelectorAll("input:checked:not(:disabled)")].map((c) => c.value));
  if (lista.dataset.baileId !== baile.id) marcadas.clear();
  lista.dataset.baileId = baile.id;
  lista.innerHTML = "";

  const { recibidos, total } = conteoRecibidos(baile);
  el("resumenRecibir").textContent = `🧵 Recibidos: ${recibidos} de ${total}`;
  [...baile.alumnas]
    .sort((x, y) => x.nombre.localeCompare(y.nombre, "es", { sensitivity: "base" }))
    .forEach((a) => {
      const recibido = (a.etapas || {}).recibido || "";
      const etiqueta = crearEl("label", "opcion-checkbox traje-recibir-opcion" + (recibido ? " ya-recibido" : ""));
      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.value = a.asignacionId;
      casilla.checked = Boolean(recibido) || marcadas.has(a.asignacionId);
      casilla.disabled = Boolean(recibido) || guardandoRecibidos;
      casilla.addEventListener("change", actualizarBotonRecibidos);
      const texto = crearEl("span", "traje-recibir-texto");
      texto.appendChild(crearEl("span", "", a.nombre));
      if (a.estado) texto.appendChild(etiquetaEstadoAlumna(a.estado));
      if (recibido) texto.appendChild(crearEl("span", "traje-recibir-fecha", "✓ Recibido " + fechaHoraTraje(recibido)));
      etiqueta.append(casilla, texto);
      lista.appendChild(etiqueta);
    });
  actualizarBotonRecibidos();
}

function actualizarBotonRecibidos() {
  const n = el("listaRecibir").querySelectorAll("input:checked:not(:disabled)").length;
  const boton = el("btnMarcarRecibidos");
  boton.disabled = guardandoRecibidos || n === 0;
  boton.textContent = guardandoRecibidos ? "Guardando..." : n ? `Marcar como recibidos (${n})` : "Marcar como recibidos";
}

async function marcarRecibidos() {
  const ids = [...el("listaRecibir").querySelectorAll("input:checked:not(:disabled)")].map((c) => c.value);
  if (!ids.length || guardandoRecibidos) return;
  guardandoRecibidos = true;
  renderListaRecibir();
  try {
    const r = await llamarWorker({ accion: "showMarcarRecibidosModista", clave: claveRecepcion, asignacionIds: ids });
    const fechas = r.fechas || {};
    showDatos.bailes.forEach((b) =>
      b.alumnas.forEach((a) => {
        if (fechas[a.asignacionId]) a.etapas = { ...(a.etapas || {}), recibido: fechas[a.asignacionId] };
      })
    );
    mensajeShow("mensajeShow", `✅ ${r.marcados} traje${r.marcados === 1 ? "" : "s"} marcado${r.marcados === 1 ? "" : "s"} como recibido${r.marcados === 1 ? "" : "s"}.`, "ok");
  } catch (e) {
    mensajeShow("mensajeShow", e.message, "error");
  }
  guardandoRecibidos = false;
  renderRecibirTrajes();
  renderTrajesShow();
}

el("selectRecibirBaile").addEventListener("change", () => renderListaRecibir());
el("btnMarcarRecibidos").addEventListener("click", marcarRecibidos);

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

// =====================================================================
// CURSO DE VACACIONES (Move Vacation Camp)
// =====================================================================
// Todo vive en Airtable: CONFIG VACATION CAMP (una fila por temporada),
// VACATION CAMP INSCRIPCIONES y ASISTENCIA VACATION CAMP. Esta pantalla
// solo habla con el Worker (acciones vc*), que revisa la clave de
// Recepción antes de leer o guardar cualquier cosa.
//
// Los nombres y datos de las inscritas los escriben los papás en una
// ficha pública, así que aquí todo se pinta con textContent (nunca
// innerHTML con esos datos).

let vcDatos = null; // última respuesta de vcRecepcionDatos
let vcConfigId = ""; // temporada elegida en el selector
let vcDiasSinCurso = []; // copia editable de los días sin curso
let vcPestana = "Inscritas";

// Dirección pública de la ficha. El link de cada temporada es esta
// dirección + "?curso=" + su NOMBRE LINK. La vieja (vacation-camp.html)
// redirige a la nueva y abre la temporada 2026.
const VC_URL_FICHA = "https://academiamovedance.com/inscripcion.html";
const VC_URL_FICHA_VIEJA = "https://academiamovedance.com/vacation-camp.html";

// Opciones especiales del selector de temporadas.
const VC_OPCION_ARCHIVADOS = "__archivados";
const VC_OPCION_ACTIVOS = "__activos";

// En "Temporada nueva" el nombre del link se propone solo (nombre del
// curso + temporada) hasta que Recepción lo cambie a mano.
let vcNombreLinkNuevaEditado = false;

function vcCrear(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  return nodo;
}

function vcMensaje(id, texto, tipo) {
  const m = el(id);
  m.textContent = texto || "";
  m.className = "mensaje-form" + (tipo === "error" ? " mensaje-form-error" : tipo === "ok" ? " mensaje-form-ok" : "");
}

const vcQ = (n) => (n === null || n === undefined ? "—" : "Q" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

// 'AAAA-MM-DD' → '18/11/2026' sin pasar por Date (no se corre el día).
function vcFechaCorta(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}/${m}/${a}`;
}

function vcHoraGuatemala(isoInstante) {
  if (!isoInstante) return "";
  return new Date(isoInstante).toLocaleTimeString("es-GT", {
    timeZone: "America/Guatemala",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ---------- Códigos del campamento en el biométrico ----------
// Interruptor global (lo guarda el Worker en CONFIGURACION GENERAL).
// Inactivo: el biométrico rechaza los códigos del campamento con
// "Código del campamento no activo, consulta en recepción" y no registra
// nada. Alumnas y maestras no se ven afectadas. El cambio vale desde la
// siguiente marcación.

function vcPintarCodigos() {
  const c = vcDatos.codigosBiometrico;
  const caja = el("cajaVcCodigos");
  caja.hidden = !c;
  if (!c) return;
  caja.classList.toggle("activo", c.activo);
  caja.classList.toggle("inactivo", !c.activo);
  el("btnVcCodigosActivo").classList.toggle("elegido", c.activo);
  el("btnVcCodigosInactivo").classList.toggle("elegido", !c.activo);
  el("textoVcCodigosEstado").textContent = c.activo
    ? "Activos: las participantes marcan entrada y salida con su código cualquier día y hora."
    : "Inactivos: el biométrico rechaza los códigos del campamento y no registra asistencia.";
  el("textoVcCodigosCuenta").textContent =
    `${c.conCodigo} de ${c.total} participante${c.total === 1 ? "" : "s"} tienen código asignado (temporada ${vcDatos.config.temporada}).`;
  const lista = el("listaVcCodigosSin");
  lista.innerHTML = "";
  c.sinCodigo.forEach((p) => {
    const li = vcCrear("li", "");
    li.appendChild(vcCrear("b", "", p.alumna));
    li.appendChild(document.createTextNode(` — ${p.motivo}`));
    lista.appendChild(li);
  });
  lista.hidden = !c.sinCodigo.length;
}

async function vcGuardarCodigos(activo) {
  if (!vcDatos || !vcDatos.codigosBiometrico || vcDatos.codigosBiometrico.activo === activo) return;
  vcMensaje("mensajeVcCodigos", "Guardando...");
  try {
    const r = await llamarWorker({ accion: "vcRecepcionGuardarCodigosBiometrico", clave: claveRecepcion, activo });
    vcDatos.codigosBiometrico.activo = r.activo;
    vcPintarCodigos();
    vcMensaje(
      "mensajeVcCodigos",
      r.activo ? "✅ Códigos activos desde ya." : "✅ Códigos desactivados desde ya. El biométrico los va a rechazar.",
      "ok"
    );
  } catch (e) {
    vcMensaje("mensajeVcCodigos", e.message, "error");
  }
}

el("btnVcCodigosActivo").addEventListener("click", () => vcGuardarCodigos(true));
el("btnVcCodigosInactivo").addEventListener("click", () => vcGuardarCodigos(false));

async function abrirCampamento() {
  vcMensaje("mensajeVc", "");
  await vcCargar();
}

async function vcCargar() {
  el("listaVcInscritas").innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    vcDatos = await llamarWorker({ accion: "vcRecepcionDatos", clave: claveRecepcion, configId: vcConfigId });
  } catch (e) {
    vcMensaje("mensajeVc", e.message, "error");
    el("listaVcInscritas").innerHTML = "";
    return;
  }
  vcPintarPagosRevisar();
  if (!vcDatos.config) {
    vcMensaje("mensajeVc", "Todavía no hay ninguna temporada en CONFIG VACATION CAMP.", "error");
    el("listaVcInscritas").innerHTML = "";
    return;
  }
  vcConfigId = vcDatos.config.id;
  vcPintarTodo();
}

function vcPintarTodo() {
  const cfg = vcDatos.config;

  // El selector enseña o las temporadas normales o las archivadas,
  // según cuál esté elegida; la última opción cambia de grupo.
  const archivado = cfg.estado === "Archivada";
  const archivadas = vcDatos.temporadas.filter((t) => t.estado === "Archivada");
  const normales = vcDatos.temporadas.filter((t) => t.estado !== "Archivada");
  const select = el("selectVcTemporada");
  select.innerHTML = "";
  (archivado ? archivadas : normales).forEach((t) => {
    const op = vcCrear(
      "option",
      "",
      `${archivado ? "📦 " : ""}${t.temporada}${t.id === vcDatos.temporadaSinCodigoId ? " (link sin código)" : ""}`
    );
    op.value = t.id;
    select.appendChild(op);
  });
  if (!archivado && archivadas.length) {
    const op = vcCrear("option", "", `📦 Ver cursos archivados (${archivadas.length})`);
    op.value = VC_OPCION_ARCHIVADOS;
    select.appendChild(op);
  }
  if (archivado && normales.length) {
    const op = vcCrear("option", "", "← Volver a los cursos activos");
    op.value = VC_OPCION_ACTIVOS;
    select.appendChild(op);
  }
  select.value = cfg.id;
  el("cajaVcArchivada").hidden = !archivado;
  el("bloqueVcEstado").hidden = archivado;
  vcCerrarEliminar();
  el("pistaVcTemporada").textContent =
    `Del ${vcFechaCorta(cfg.inicio)} al ${vcFechaCorta(cfg.fin)}.`;

  const activas = vcDatos.inscritas.filter((i) => i.estado !== "Cancelada").length;
  el("contadorVc").textContent = `${activas} de ${cfg.cupo ?? "—"}`;

  vcPintarLink();
  vcPintarCodigos();
  vcPintarEstado();
  vcPintarInscritas();
  vcPintarDiasPasados();
  vcPintarAsistencia();
  vcLlenarFormulario();
  // Otra temporada (u otra lista): la vista previa ya no vale.
  vcWaInvalidarPrevia();
  if (vcPestana === "Clases") vcClasesCargar();
  vcWaPintarSeleccion();
  el("pistaVcNueva").textContent =
    `Se copian los precios, horario, edades, cupo, actividades, políticas y mensaje de la temporada ${cfg.temporada}. ` +
    "Nace con inscripciones Cerradas, sin días sin curso y con su propio link de la ficha: revisa todo en Configuración antes de abrirla.";
  vcProponerNombreLinkNuevo();
}

// ---------- Link de la ficha ----------
// El link de cada temporada es VC_URL_FICHA + "?curso=" + su NOMBRE LINK.
// Las temporadas de antes pueden tener además un link viejo con ?c=
// (CODIGO LINK), que sigue funcionando pero ya no se edita.

// Misma regla que el Worker (vcNormalizarNombreLink): minúsculas, sin
// tildes, ñ → n, y guiones en lugar de espacios o símbolos. Aquí solo
// sirve para enseñar cómo quedará el link; el Worker es el que guarda.
function vcNormalizarNombreLink(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

const vcLinkDeNombre = (nombreLink) => `${VC_URL_FICHA}?curso=${nombreLink}`;

function vcLinkFicha() {
  const nombre = vcDatos && vcDatos.config && vcDatos.config.nombreLink;
  return nombre ? vcLinkDeNombre(nombre) : "";
}

// "Así queda el link: …" debajo de un campo de nombre del link.
function vcPintarVistaLink(idInput, idVista) {
  const nombre = vcNormalizarNombreLink(el(idInput).value);
  el(idVista).textContent =
    nombre.length >= 3
      ? `Así queda el link: ${vcLinkDeNombre(nombre)}`
      : "Escribe al menos 3 letras o números.";
}

function vcPintarLink() {
  const cfg = vcDatos.config;
  const link = vcLinkFicha();
  el("textoVcLink").textContent = link || "Esta temporada todavía no tiene link. Usa \"✏️ Editar nombre del link\".";
  ["btnVcCopiarLink", "btnVcAbrirLink", "btnVcWhatsappLink"].forEach((id) => (el(id).disabled = !link));
  el("cajaVcEditarLink").hidden = true;
  el("btnVcEditarLink").hidden = false;

  const viejos = [];
  if (cfg.id === vcDatos.temporadaSinCodigoId) viejos.push(VC_URL_FICHA_VIEJA);
  if (cfg.codigoLink) viejos.push(`${VC_URL_FICHA_VIEJA}?c=${cfg.codigoLink}`);
  el("pistaVcLink").textContent =
    `Este link abre solo la temporada ${cfg.temporada}. Si las inscripciones están Cerradas o ya se llenó el cupo, la ficha lo avisa.` +
    (viejos.length ? ` Los links viejos ${viejos.join(" y ")} también siguen abriendo esta temporada.` : "");
  vcMensaje("mensajeVcLink", "");
}

el("btnVcCopiarLink").addEventListener("click", async () => {
  const link = vcLinkFicha();
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    vcMensaje("mensajeVcLink", "✅ Link copiado.", "ok");
  } catch (e) {
    // Sin permiso para el portapapeles: se deja el link seleccionado
    // para copiarlo a mano.
    const rango = document.createRange();
    rango.selectNodeContents(el("textoVcLink"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rango);
    vcMensaje("mensajeVcLink", "No se pudo copiar solo. El link quedó seleccionado: cópialo con Ctrl+C.", "error");
  }
});

el("btnVcAbrirLink").addEventListener("click", () => {
  let link = vcLinkFicha();
  if (!link) return;
  // En una prueba local se abre la ficha local (que habla con el Worker
  // local), con el mismo nombre.
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    link = new URL("inscripcion.html" + new URL(link).search, location.href).href;
  }
  window.open(link, "_blank", "noopener");
});

el("btnVcWhatsappLink").addEventListener("click", () => {
  const link = vcLinkFicha();
  if (!link) return;
  const texto = `¡Inscribe a tu hija al ${vcDatos.config.nombre}! Llena la ficha aquí: ${link}`;
  window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank", "noopener");
});

el("btnVcEditarLink").addEventListener("click", () => {
  const cfg = vcDatos && vcDatos.config;
  if (!cfg) return;
  el("inputVcNombreLink").value = cfg.nombreLink || vcNormalizarNombreLink(`${cfg.nombre} ${cfg.temporada}`);
  vcPintarVistaLink("inputVcNombreLink", "vistaVcNombreLink");
  el("cajaVcEditarLink").hidden = false;
  el("btnVcEditarLink").hidden = true;
  vcMensaje("mensajeVcLink", "");
  el("inputVcNombreLink").focus();
});

el("inputVcNombreLink").addEventListener("input", () => vcPintarVistaLink("inputVcNombreLink", "vistaVcNombreLink"));

el("btnVcCancelarLink").addEventListener("click", () => {
  el("cajaVcEditarLink").hidden = true;
  el("btnVcEditarLink").hidden = false;
  vcMensaje("mensajeVcLink", "");
});

el("btnVcGuardarLink").addEventListener("click", async () => {
  const cfg = vcDatos && vcDatos.config;
  if (!cfg) return;
  const nombre = vcNormalizarNombreLink(el("inputVcNombreLink").value);
  if (nombre.length < 3) {
    vcMensaje("mensajeVcLink", "El nombre del link debe tener al menos 3 letras o números.", "error");
    return;
  }
  if (nombre === cfg.nombreLink) {
    vcMensaje("mensajeVcLink", "Ese ya es el nombre del link.", "error");
    return;
  }
  const pregunta = cfg.nombreLink
    ? `¿Cambiar el link de la temporada ${cfg.temporada}?\n\nNuevo: ${vcLinkDeNombre(nombre)}\n\n⚠️ El link anterior (${vcLinkFicha()}) DEJARÁ DE FUNCIONAR: quien lo abra verá un aviso para escribir al 3752-9984. Tendrás que compartir el link nuevo.`
    : `¿Guardar este link para la temporada ${cfg.temporada}?\n\n${vcLinkDeNombre(nombre)}`;
  if (!window.confirm(pregunta)) return;
  const boton = el("btnVcGuardarLink");
  boton.disabled = true;
  vcMensaje("mensajeVcLink", "Guardando...");
  try {
    const resp = await llamarWorker({ accion: "vcRecepcionGuardarNombreLink", clave: claveRecepcion, configId: cfg.id, nombreLink: nombre });
    const habiaLink = !!cfg.nombreLink;
    cfg.nombreLink = resp.nombreLink;
    vcPintarLink();
    vcMensaje("mensajeVcLink", habiaLink ? "✅ Link cambiado. El anterior ya no funciona." : "✅ Link guardado.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcLink", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

// ---------- Pagos por revisar ----------
// Pagos de Paggo que llegaron a un curso/inscripción eliminado,
// cancelado o archivado. Vienen de TODAS las temporadas.
function vcFechaHora(isoInstante) {
  if (!isoInstante) return "";
  return new Date(isoInstante).toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function vcPintarPagosRevisar() {
  const lista = (vcDatos && vcDatos.pagosPorRevisar) || [];
  el("cajaVcPagosRevisar").hidden = !lista.length;
  const cont = el("listaVcPagosRevisar");
  cont.innerHTML = "";
  lista.forEach((p) => {
    const item = vcCrear("div", "vc-pago-revisar");
    const deQue =
      p.motivo === "Inscripción cancelada"
        ? "de una inscripción cancelada"
        : p.motivo === "Curso archivado"
          ? "de un curso archivado"
          : "de un curso eliminado";
    item.append(vcCrear("strong", "", `${p.evento === "Revertido" ? "Pago revertido" : "Pago recibido"} ${deQue}: ${vcQ(p.monto)}`));
    [
      ["Fecha", vcFechaHora(p.fecha)],
      ["Concepto", p.concepto],
      ["Alumna", p.alumna],
      ["Responsable", [p.responsable, p.telefono].filter(Boolean).join(" — ")],
      ["Temporada", p.temporada],
      ["Link de Paggo", p.paggoLinkId],
      ["Pagó en Paggo", [p.pagador, p.fechaPago && vcFechaHora(p.fechaPago)].filter(Boolean).join(" — ")],
      ["Tarjeta", [p.tarjeta, p.autorizacion && `autorización ${p.autorizacion}`].filter(Boolean).join(", ")],
    ].forEach(([etiqueta, valor]) => {
      if (valor) item.append(vcCrear("div", "", `${etiqueta}: ${valor}`));
    });
    if (p.evento === "Pagado") {
      item.append(
        vcCrear("div", "", p.confirmado ? "✅ Paggo confirma que se cobró." : "⚠️ Paggo todavía no lo muestra como cobrado: revísalo en Paggo.")
      );
    }
    const boton = vcCrear("button", "btn-secundario btn-chico", "✅ Ya lo resolví (reembolsado)");
    boton.type = "button";
    boton.addEventListener("click", async () => {
      if (!window.confirm(`¿Marcar como resuelto el pago de ${vcQ(p.monto)} (Paggo ${p.paggoLinkId})?\n\nDeja de salir aquí, pero queda guardado en Airtable.`)) return;
      boton.disabled = true;
      try {
        await llamarWorker({ accion: "vcRecepcionResolverPagoRevisar", clave: claveRecepcion, id: p.id });
        vcDatos.pagosPorRevisar = vcDatos.pagosPorRevisar.filter((x) => x.id !== p.id);
        vcPintarPagosRevisar();
      } catch (e) {
        boton.disabled = false;
        window.alert(e.message);
      }
    });
    const acciones = vcCrear("div", "show-acciones");
    acciones.append(boton);
    item.append(acciones);
    cont.append(item);
  });
}

// ---------- Eliminar / archivar curso ----------
// Las reglas las decide el Worker (vcRecepcionRevisarEliminar) y las
// vuelve a revisar al eliminar; aquí solo se enseñan.
let vcRevisionEliminar = null;

function vcCerrarEliminar() {
  vcRevisionEliminar = null;
  el("cajaVcEliminar").hidden = true;
  el("confirmarVcEliminar").hidden = true;
  el("archivarVcEliminar").hidden = true;
  el("btnVcEliminarCurso").hidden = false;
  el("inputVcConfirmarEliminar").value = "";
  vcMensaje("mensajeVcEliminar", "");
}

// Lista <ul> de links de Paggo pendientes.
function vcListaLinks(links) {
  const ul = vcCrear("ul");
  links.forEach((l) => ul.append(vcCrear("li", "", `Paggo ${l.paggoLinkId} — ${l.alumna} — ${l.concepto} ${vcQ(l.monto)}`)));
  return ul;
}

el("btnVcEliminarCurso").addEventListener("click", async () => {
  const boton = el("btnVcEliminarCurso");
  boton.disabled = true;
  vcMensaje("mensajeVcEliminar", "Revisando el curso...");
  try {
    vcRevisionEliminar = await llamarWorker({ accion: "vcRecepcionRevisarEliminar", clave: claveRecepcion, configId: vcConfigId });
  } catch (e) {
    vcMensaje("mensajeVcEliminar", e.message, "error");
    return;
  } finally {
    boton.disabled = false;
  }
  vcMensaje("mensajeVcEliminar", "");
  const r = vcRevisionEliminar;
  const texto = el("textoVcEliminar");
  texto.innerHTML = "";
  if (r.caso === 3) {
    texto.append(
      vcCrear(
        "p",
        "",
        `⛔ No se puede eliminar la temporada ${r.temporada}: tiene pagos registrados (${r.alumnasConPagos.join(", ")}). ` +
          "Eliminarla borraría el registro de esos pagos."
      ),
      vcCrear(
        "p",
        "",
        r.estado === "Archivada"
          ? "Este curso ya está archivado."
          : "En su lugar puedes archivarlo: se cierra la ficha, los códigos del kiosko dejan de funcionar y se oculta del selector, pero no se borra ningún dato."
      )
    );
    el("archivarVcEliminar").hidden = r.estado === "Archivada";
  } else {
    texto.append(
      vcCrear(
        "p",
        "",
        r.caso === 1
          ? `La temporada ${r.temporada} no tiene inscripciones.`
          : `⚠️ La temporada ${r.temporada} tiene ${r.totalInscripciones} ${r.totalInscripciones === 1 ? "inscripción" : "inscripciones"}` +
              (r.canceladas ? ` (${r.canceladas} cancelada${r.canceladas === 1 ? "" : "s"})` : "") +
              ", ninguna con pagos. Al eliminar el curso TAMBIÉN se borran esas inscripciones y su asistencia."
      ),
      vcCrear("p", "", "Esto no se puede deshacer.")
    );
    if (r.linksPendientes.length) {
      texto.append(
        vcCrear("p", "", "Estos links de Paggo siguen activos y se podrían pagar. Desactívalos tú en el panel de Paggo (desde aquí no se pueden desactivar):"),
        vcListaLinks(r.linksPendientes)
      );
    }
    el("etiquetaVcConfirmarEliminar").textContent = `Para confirmar, escribe el nombre de la temporada: ${r.temporada}`;
    el("confirmarVcEliminar").hidden = false;
  }
  el("cajaVcEliminar").hidden = false;
  el("btnVcEliminarCurso").hidden = true;
});

el("btnVcCancelarEliminar").addEventListener("click", vcCerrarEliminar);
el("btnVcCancelarArchivar").addEventListener("click", vcCerrarEliminar);

el("btnVcConfirmarEliminar").addEventListener("click", async () => {
  const r = vcRevisionEliminar;
  if (!r) return;
  const escrito = el("inputVcConfirmarEliminar").value.trim();
  if (escrito.toLowerCase() !== r.temporada.toLowerCase()) {
    vcMensaje("mensajeVcEliminar", `Escribe exactamente: ${r.temporada}`, "error");
    return;
  }
  const boton = el("btnVcConfirmarEliminar");
  boton.disabled = true;
  vcMensaje("mensajeVcEliminar", "Eliminando...");
  try {
    const resp = await llamarWorker({
      accion: "vcRecepcionEliminarTemporada",
      clave: claveRecepcion,
      configId: vcConfigId,
      confirmacion: escrito,
    });
    el("tituloVcResultadoEliminar").textContent = `🗑️ Se eliminó la temporada ${resp.temporada}`;
    const texto = el("textoVcResultadoEliminar");
    texto.innerHTML = "";
    texto.append(
      vcCrear(
        "p",
        "",
        `Se borraron ${resp.inscripcionesBorradas} ${resp.inscripcionesBorradas === 1 ? "inscripción" : "inscripciones"} y ${resp.asistenciasBorradas} ${resp.asistenciasBorradas === 1 ? "registro" : "registros"} de asistencia.`
      )
    );
    if (resp.linksPendientes.length) {
      texto.append(vcCrear("p", "", "⚠️ Desactiva estos links en el panel de Paggo:"), vcListaLinks(resp.linksPendientes));
      texto.append(vcCrear("p", "", "Si alguien paga uno antes, el pago aparecerá aquí arriba en \"Pagos por revisar\"."));
    } else {
      texto.append(vcCrear("p", "", "No tenía links de Paggo pendientes."));
    }
    el("cajaVcResultadoEliminar").hidden = false;
    vcConfigId = "";
    vcCambiarPestana("Inscritas");
    await vcCargar();
    el("pantallaCampamento").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    vcMensaje("mensajeVcEliminar", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

el("btnVcCerrarResultado").addEventListener("click", () => {
  el("cajaVcResultadoEliminar").hidden = true;
});

async function vcArchivar(archivar) {
  const cfg = vcDatos.config;
  const pregunta = archivar
    ? `¿Archivar el curso ${cfg.temporada}?\n\n• La ficha mostrará que las inscripciones no están abiertas.\n• Los códigos del kiosko de sus participantes dejarán de funcionar.\n• Se ocultará del selector (lo encuentras en "📦 Ver cursos archivados").\n\nNo se borra ningún dato.`
    : `¿Desarchivar el curso ${cfg.temporada}?\n\nQueda con inscripciones Cerradas: revísalo antes de abrirlo. Los códigos del kiosko vuelven a funcionar (si el interruptor de códigos está activo).`;
  if (!window.confirm(pregunta)) return;
  try {
    await llamarWorker({ accion: "vcRecepcionArchivar", clave: claveRecepcion, configId: cfg.id, archivar });
    await vcCargar();
    vcMensaje("mensajeVc", archivar ? `📦 Curso ${cfg.temporada} archivado.` : `♻️ Curso ${cfg.temporada} desarchivado (Cerradas).`, "ok");
    el("pantallaCampamento").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    vcMensaje(archivar ? "mensajeVcEliminar" : "mensajeVc", e.message, "error");
  }
}

el("btnVcArchivar").addEventListener("click", () => vcArchivar(true));
el("btnVcDesarchivar").addEventListener("click", () => vcArchivar(false));

// ---------- Abiertas / Cerradas ----------
function vcPintarEstado() {
  const cont = el("opcionesVcEstado");
  cont.innerHTML = "";
  const actual = vcDatos.config.estado;
  [
    { estado: "Abiertas", titulo: "🟢 Abiertas", detalle: "La ficha pública recibe inscripciones (mientras haya cupo)." },
    { estado: "Cerradas", titulo: "⛔ Cerradas", detalle: "La ficha muestra un mensaje amable con el teléfono, sin formulario." },
  ].forEach((op) => {
    const activo = actual === op.estado;
    const tarjeta = vcCrear("button", "tarjeta-resultado tarjeta-canal-asistencia" + (activo ? " activo" : ""));
    tarjeta.type = "button";
    tarjeta.setAttribute("aria-pressed", activo ? "true" : "false");
    tarjeta.append(
      vcCrear("span", "tarjeta-resultado-nombre", op.titulo + (activo ? " — ASÍ ESTÁ AHORA" : "")),
      vcCrear("span", "tarjeta-resultado-detalle", op.detalle)
    );
    if (!activo) tarjeta.addEventListener("click", () => vcAbrirCerrar(op.estado === "Abiertas"));
    cont.appendChild(tarjeta);
  });
}

async function vcAbrirCerrar(abiertas) {
  const nombre = vcDatos.config.temporada;
  if (!window.confirm(abiertas ? `¿Abrir las inscripciones de la temporada ${nombre}?` : `¿Cerrar las inscripciones de la temporada ${nombre}?`)) return;
  vcMensaje("mensajeVc", "Guardando...");
  try {
    await llamarWorker({ accion: "vcRecepcionAbrirCerrar", clave: claveRecepcion, configId: vcConfigId, abiertas });
    vcDatos.config.estado = abiertas ? "Abiertas" : "Cerradas";
    vcPintarEstado();
    vcMensaje("mensajeVc", abiertas ? "✅ Inscripciones abiertas." : "✅ Inscripciones cerradas.", "ok");
  } catch (e) {
    vcMensaje("mensajeVc", e.message, "error");
  }
}

// ---------- Inscritas ----------
function vcLinea(etiqueta, valor, clase) {
  const p = vcCrear("span", clase || "");
  p.append(vcCrear("strong", "", etiqueta + ": "), document.createTextNode(valor || "—"));
  return p;
}

function vcTelefono(etiqueta, nombre, parentesco, telefono) {
  const p = vcCrear("span");
  p.append(vcCrear("strong", "", etiqueta + ": "), document.createTextNode(`${nombre} (${parentesco}) · `));
  const a = vcCrear("a", "", telefono);
  a.href = "tel:" + String(telefono || "").replace(/\D/g, "");
  p.appendChild(a);
  return p;
}

function vcPintarInscritas() {
  const cont = el("listaVcInscritas");
  cont.innerHTML = "";
  if (!vcDatos.inscritas.length) {
    cont.appendChild(vcCrear("p", "lista-vacia", "Todavía no hay inscripciones en esta temporada."));
    return;
  }
  vcDatos.inscritas.forEach((i) => cont.appendChild(vcTarjetaInscrita(i)));
}

// "Por clases": las que ya usaron más días que los de su paquete (el
// kiosko les avisa pero registra la entrada).
function vcPintarDiasPasados() {
  const pasadas = (vcDatos.config.porClases ? vcDatos.inscritas : []).filter((i) => i.estado !== "Cancelada" && i.diasUsados && i.diasUsados.pasada);
  el("cajaVcDiasPasados").hidden = !pasadas.length;
  const lista = el("listaVcDiasPasados");
  lista.innerHTML = "";
  pasadas.forEach((i) => lista.appendChild(vcCrear("li", "", `${i.alumna} — ${i.diasUsados.texto} días (${i.paquete})`)));
}

function vcTarjetaInscrita(i) {
  const cancelada = i.estado === "Cancelada";
  const tarjeta = vcCrear("details", "show-tarjeta vc-inscrita" + (cancelada ? " inactivo" : ""));

  const resumen = vcCrear("summary", "show-tarjeta-fila");
  const texto = vcCrear("span", "show-tarjeta-texto");
  const nombre = vcCrear("span", "show-tarjeta-nombre");
  nombre.append(vcCrear("span", "vc-flecha", "▸"), document.createTextNode(i.alumna));
  // "Por clases": el paquete y los días usados ("3 de 4").
  const detalleModalidad = i.paquete
    ? `📦 ${i.paquete}${i.diasUsados && i.diasUsados.texto ? ` · ${i.diasUsados.texto} días` : ""}`
    : i.modalidad + (i.semanas.length ? " · " + i.semanas.join(", ") : "");
  texto.append(nombre, vcCrear("span", "tarjeta-resultado-detalle", detalleModalidad));
  const etiquetas = vcCrear("span", "show-etiquetas");
  if (i.pagoRevertido) etiquetas.appendChild(vcCrear("span", "show-etiqueta vc-alerta", "⚠️ PAGO REVERTIDO"));
  if (i.whatsappEnviado === "No") etiquetas.appendChild(vcCrear("span", "show-etiqueta show-etiqueta-no", "Bienvenida pendiente"));
  if (cancelada) etiquetas.appendChild(vcCrear("span", "show-etiqueta show-etiqueta-estado", "CANCELADA"));
  if (i.codigo) etiquetas.appendChild(vcCrear("span", "vc-codigo", i.codigo));
  etiquetas.appendChild(
    vcCrear("span", "show-etiqueta " + (i.reservaPagada ? "show-etiqueta-si" : "show-etiqueta-pendiente"), i.reservaPagada ? "Reserva ✓" : "Reserva pendiente")
  );
  if (i.tieneAlergia === "SI") etiquetas.appendChild(vcCrear("span", "show-etiqueta show-etiqueta-no", "⚠️ Alergia"));
  if (!cancelada && i.diasUsados && i.diasUsados.pasada) etiquetas.appendChild(vcCrear("span", "show-etiqueta show-etiqueta-no", `⚠️ ${i.diasUsados.texto} días`));
  resumen.append(texto, etiquetas);
  tarjeta.appendChild(resumen);

  const detalle = vcCrear("div", "vc-detalle");
  detalle.append(
    vcTelefono("Responsable", i.responsable, i.parentescoResponsable, i.telefonoResponsable),
    vcTelefono("Emergencia", i.contactoEmergencia, i.parentescoEmergencia, i.telefonoEmergencia),
    vcLinea("Nacimiento", vcFechaCorta(i.fechaNacimiento)),
    vcLinea("Alergia", i.tieneAlergia === "SI" ? i.descripcionAlergia : "No", i.tieneAlergia === "SI" ? "vc-medico" : ""),
    vcLinea("Condiciones médicas", i.condicionesMedicas, i.condicionesMedicas ? "vc-medico" : ""),
    vcLinea("Medicamentos", i.medicamentos, i.medicamentos ? "vc-medico" : ""),
    vcLinea("Restricciones alimentarias", i.restriccionesAlimentarias, i.restriccionesAlimentarias ? "vc-medico" : ""),
    vcLinea("Otra información", i.otraInformacion),
    vcLinea("Total", `${vcQ(i.montoTotal)} (reserva ${vcQ(i.montoReserva)} + saldo ${vcQ(i.montoSaldo)})`),
    vcLinea("Pago", [i.formaPago, i.metodoPago].filter(Boolean).join(" · ")),
    vcLinea("WhatsApp de bienvenida", i.whatsappEnviado === "No" ? "Bienvenida pendiente — mándala desde «📲 Mensajes WhatsApp» (filtro «Bienvenida pendiente»)" : i.whatsappEnviado || "—", i.whatsappEnviado === "No" ? "vc-medico" : ""),
    vcLinea("Código del kiosko", i.codigo || (cancelada ? "—" : "se genera al marcar la reserva"))
  );
  [["Link reserva", i.linkReserva], ["Link total", i.linkTotal], ["Link saldo", i.linkSaldo]].forEach(([nombre, url]) => {
    if (!url) return;
    const p = vcCrear("span");
    const a = vcCrear("a", "", url);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    p.append(vcCrear("strong", "", nombre + ": "), a);
    detalle.appendChild(p);
  });
  if (i.historialPagos) {
    const historial = vcCrear("details", "vc-historial");
    historial.append(vcCrear("summary", "", "Historial de pagos"), vcCrear("pre", "", i.historialPagos));
    detalle.appendChild(historial);
  }
  tarjeta.appendChild(detalle);

  const pagos = vcCrear("div", "vc-pagos");
  pagos.append(
    vcCasilla(`Reserva pagada (${vcQ(i.montoReserva)})`, i.reservaPagada, cancelada, (valor, input) =>
      vcMarcarPago(i, "reservaPagada", valor, input)
    ),
    vcCasilla(`Saldo pagado (${vcQ(i.montoSaldo)})`, i.saldoPagado, cancelada, (valor, input) =>
      vcMarcarPago(i, "saldoPagado", valor, input)
    )
  );
  tarjeta.appendChild(pagos);

  const acciones = vcCrear("div", "show-acciones");
  // "Enviar link de pago": reserva o total si no han pagado nada (según
  // su forma de pago), o el saldo si ya pagaron la reserva.
  const falta = !i.reservaPagada ? (i.formaPago === "Pago total" ? "total" : "reserva") : !i.saldoPagado ? "saldo" : "";
  if (!cancelada && falta) {
    const montoFalta = { reserva: i.montoReserva, total: i.montoTotal, saldo: i.montoSaldo }[falta];
    const botonLink = vcCrear("button", "btn-secundario btn-chico", `📲 Enviar link de pago (${falta} ${vcQ(montoFalta)})`);
    botonLink.type = "button";
    botonLink.addEventListener("click", () => vcEnviarLinkPago(i, falta, montoFalta, botonLink));
    acciones.appendChild(botonLink);
  }
  if (i.pagoRevertido) {
    const quitar = vcCrear("button", "btn-secundario btn-chico", "Quitar alerta de pago revertido");
    quitar.type = "button";
    quitar.addEventListener("click", () => vcActualizarInscripcion(i, { quitarAlertaRevertido: true }));
    acciones.appendChild(quitar);
  }
  const boton = vcCrear("button", "btn-secundario btn-chico" + (cancelada ? "" : " show-btn-peligro"), cancelada ? "Reactivar inscripción" : "Cancelar inscripción");
  boton.type = "button";
  boton.addEventListener("click", () => {
    const pregunta = cancelada
      ? `¿Reactivar la inscripción de ${i.alumna}? Vuelve a contar para el cupo y su código vuelve a funcionar.`
      : `¿Cancelar la inscripción de ${i.alumna}? No se borra: deja de contar para el cupo y su código del kiosko deja de funcionar.`;
    if (window.confirm(pregunta)) vcActualizarInscripcion(i, { estado: cancelada ? "Activa" : "Cancelada" });
  });
  acciones.appendChild(boton);
  tarjeta.appendChild(acciones);
  return tarjeta;
}

function vcCasilla(texto, marcada, deshabilitada, alCambiar) {
  const label = vcCrear("label", "opcion-checkbox");
  const input = vcCrear("input");
  input.type = "checkbox";
  input.checked = marcada;
  input.disabled = deshabilitada;
  input.addEventListener("change", () => alCambiar(input.checked, input));
  label.append(input, vcCrear("span", "", texto));
  return label;
}

// Marcar un pago a mano también manda el WhatsApp de pago confirmado
// (una vez por concepto), así que se pregunta antes.
function vcMarcarPago(inscrita, campo, valor, input) {
  if (valor) {
    const que = campo === "reservaPagada" ? "la reserva" : "el saldo";
    const pregunta =
      `¿Marcar ${que} de ${inscrita.alumna} como pagado?` +
      (campo === "reservaPagada" && !inscrita.codigo ? " Se generará su código del kiosko." : "") +
      ` Si todavía no se le avisó, se manda el WhatsApp de pago confirmado a ${inscrita.responsable}.`;
    if (!window.confirm(pregunta)) {
      input.checked = false;
      return;
    }
  }
  vcActualizarInscripcion(inscrita, { [campo]: valor });
}

async function vcActualizarInscripcion(inscrita, cambios) {
  vcMensaje("mensajeVc", "Guardando...");
  try {
    const resp = await llamarWorker({ accion: "vcRecepcionActualizarInscripcion", clave: claveRecepcion, id: inscrita.id, ...cambios });
    const nueva = { ...resp.inscrita, entradaHoy: inscrita.entradaHoy, salidaHoy: inscrita.salidaHoy };
    const posicion = vcDatos.inscritas.findIndex((x) => x.id === inscrita.id);
    if (posicion >= 0) vcDatos.inscritas[posicion] = nueva;
    const codigoNuevo = !inscrita.codigo && nueva.codigo;
    vcPintarTodo();
    vcMensaje(
      "mensajeVc",
      codigoNuevo ? `✅ Guardado. Código del kiosko de ${nueva.alumna}: ${nueva.codigo}` : "✅ Guardado.",
      "ok"
    );
  } catch (e) {
    vcMensaje("mensajeVc", e.message, "error");
    vcPintarInscritas(); // regresa las casillas a como estaban
  }
}

async function vcEnviarLinkPago(inscrita, falta, monto, boton) {
  const pregunta = `¿Generar un link de Paggo por ${vcQ(monto)} (${falta}) y mandarlo por WhatsApp a ${inscrita.responsable}?`;
  if (!window.confirm(pregunta)) return;
  boton.disabled = true;
  vcMensaje("mensajeVc", "Generando link...");
  try {
    const resp = await llamarWorker({ accion: "vcRecepcionEnviarLinkPago", clave: claveRecepcion, id: inscrita.id });
    const nueva = { ...resp.inscrita, entradaHoy: inscrita.entradaHoy, salidaHoy: inscrita.salidaHoy };
    const posicion = vcDatos.inscritas.findIndex((x) => x.id === inscrita.id);
    if (posicion >= 0) vcDatos.inscritas[posicion] = nueva;
    vcPintarTodo();
    vcMensaje(
      "mensajeVc",
      resp.whatsapp
        ? `✅ Link enviado por WhatsApp a ${nueva.responsable}.`
        : `⚠️ Se generó el link pero NO se pudo mandar por WhatsApp. Cópialo de la tarjeta de ${nueva.alumna} y mándalo a mano.`,
      resp.whatsapp ? "ok" : "error"
    );
  } catch (e) {
    vcMensaje("mensajeVc", e.message, "error");
    boton.disabled = false;
  }
}

// ---------- Asistencia de hoy ----------
function vcPintarAsistencia() {
  const cont = el("listaVcAsistencia");
  cont.innerHTML = "";
  if (!vcDatos.hayCursoHoy) {
    cont.appendChild(vcCrear("p", "lista-vacia", `Hoy (${vcFechaCorta(vcDatos.hoy)}) no hay curso en esta temporada.`));
  }
  const activas = vcDatos.inscritas.filter((i) => i.estado !== "Cancelada");
  const grupos = [
    { titulo: "✅ Ya salieron", lista: activas.filter((i) => i.salidaHoy) },
    { titulo: "🏕️ Están aquí", lista: activas.filter((i) => i.entradaHoy && !i.salidaHoy) },
    { titulo: "⏳ No han llegado", lista: activas.filter((i) => !i.entradaHoy) },
  ];
  grupos.forEach((g) => {
    cont.appendChild(vcCrear("p", "show-grupo-titulo", `${g.titulo} (${g.lista.length})`));
    if (!g.lista.length) {
      cont.appendChild(vcCrear("p", "lista-vacia", "Nadie."));
      return;
    }
    g.lista.forEach((i) => {
      const fila = vcCrear("div", "show-tarjeta show-tarjeta-fila");
      fila.appendChild(vcCrear("span", "show-tarjeta-nombre", i.alumna));
      const horas = [];
      if (i.entradaHoy) horas.push("Entró " + vcHoraGuatemala(i.entradaHoy));
      if (i.salidaHoy) horas.push("Salió " + vcHoraGuatemala(i.salidaHoy));
      if (!i.codigo) horas.push("sin código");
      fila.appendChild(vcCrear("span", "vc-hora", horas.join(" · ")));
      cont.appendChild(fila);
    });
  });
}

// ---------- Configuración ----------
// ---------- Tipo de curso ----------
// "Campamento": horario, edades, precios y cupo generales. "Por clases":
// esos campos no aplican (se ocultan) y el curso son sus clases, cada una
// con su precio. El Worker no deja cambiarlo si ya hay inscripciones.
function vcPintarTipoCurso() {
  const porClases = !!vcDatos.config.porClases;
  document.querySelectorAll("[data-solo-campamento]").forEach((e) => (e.hidden = porClases));
  el("btnVcTipoCampamento").classList.toggle("elegido", !porClases);
  el("btnVcTipoPorClases").classList.toggle("elegido", porClases);
  const conInscritas = vcDatos.inscritas.length > 0;
  el("btnVcTipoCampamento").disabled = conInscritas && porClases;
  el("btnVcTipoPorClases").disabled = conInscritas && !porClases;
  el("textoVcTipoCurso").textContent =
    (porClases
      ? "Por clases: el curso son solo sus clases (🗓️ Clases y horarios), cada una con días, horario, edades y cupo, y el precio sale del paquete de días que elige la mamá (📦 Paquetes, abajo). La ficha no muestra horario ni precio general; elegir al menos una clase y un paquete es obligatorio."
      : "Campamento: horario, edades, precio completo, paquete parcial y cupo generales.") +
    (conInscritas ? " Esta temporada ya tiene inscripciones: el tipo ya no se puede cambiar." : "");
}

async function vcGuardarTipoCurso(tipo) {
  if (!vcDatos || !vcDatos.config || vcDatos.config.tipo === tipo) return;
  const aviso = tipo === "Por clases"
    ? "¿Pasar esta temporada a «Por clases»? El horario, edades, precios y cupo generales dejan de usarse (no se borran): el curso serán sus clases y el precio saldrá de los paquetes de días."
    : "¿Pasar esta temporada a «Campamento»? Vuelven el horario, edades, precios y cupo generales; revísalos en esta pantalla antes de abrir inscripciones.";
  if (!confirm(aviso)) return;
  vcMensaje("mensajeVcTipoCurso", "Guardando...");
  try {
    await llamarWorker({ accion: "vcRecepcionGuardarTipoCurso", clave: claveRecepcion, configId: vcConfigId, tipo });
    await vcCargar();
    vcMensaje("mensajeVcTipoCurso", `✅ La temporada ahora es «${tipo}».`, "ok");
  } catch (e) {
    vcMensaje("mensajeVcTipoCurso", e.message, "error");
  }
}
el("btnVcTipoCampamento").addEventListener("click", () => vcGuardarTipoCurso("Campamento"));
el("btnVcTipoPorClases").addEventListener("click", () => vcGuardarTipoCurso("Por clases"));

// ---------- Paquetes de días ("Por clases") ----------
// El Worker valida (precio mínimo Q2, días 1–100) y no deja borrar uno
// con inscritas: se oculta de la ficha con "Activo".
let vcPaqueteEditando = null; // id del paquete del formulario (null = nuevo)
const vcPaqueteDiasTexto = (p) => (p.dias ? `${p.dias} ${p.dias === 1 ? "día" : "días"}` : "Curso completo");

function vcPintarPaquetes() {
  const porClases = !!vcDatos.config.porClases;
  el("cajaVcPaquetes").hidden = !porClases;
  if (!porClases) return;
  const cont = el("listaVcPaquetes");
  cont.innerHTML = "";
  const paquetes = vcDatos.paquetes || [];
  if (!paquetes.length) cont.appendChild(vcCrear("p", "lista-vacia", "Todavía no hay paquetes: sin al menos uno activo, la ficha no deja inscribirse."));
  paquetes.forEach((p) => {
    const t = vcCrear("div", "show-tarjeta vc-clase-tarjeta" + (p.activo ? "" : " inactivo"));
    t.appendChild(vcCrear("p", "vc-clase-nombre", p.nombre + (p.activo ? "" : " (oculto de la ficha)")));
    t.appendChild(vcCrear("p", "vc-clase-detalle", `${vcPaqueteDiasTexto(p)} · ${vcQ(p.precio)} · ${p.inscritas} inscrita${p.inscritas === 1 ? "" : "s"}`));
    const acciones = vcCrear("div", "show-acciones");
    const editar = vcCrear("button", "btn-secundario btn-chico", "✏️ Editar");
    editar.type = "button";
    editar.addEventListener("click", () => vcPaqueteAbrirForm(p));
    acciones.appendChild(editar);
    if (!p.inscritas) {
      const borrar = vcCrear("button", "btn-secundario btn-chico", "🗑️ Borrar");
      borrar.type = "button";
      borrar.addEventListener("click", () => vcPaqueteBorrar(p));
      acciones.appendChild(borrar);
    }
    t.appendChild(acciones);
    cont.appendChild(t);
  });
}

function vcPaqueteAbrirForm(p) {
  vcPaqueteEditando = p ? p.id : null;
  el("tituloFormVcPaquete").textContent = p ? `Editar «${p.nombre}»` : "Paquete nuevo";
  el("inputVcPaqueteNombre").value = p ? p.nombre : "";
  el("inputVcPaqueteDias").value = p && p.dias ? p.dias : "";
  el("inputVcPaquetePrecio").value = p && p.precio !== null ? p.precio : "";
  el("chkVcPaqueteActivo").checked = p ? p.activo : true;
  vcMensaje("mensajeVcPaquete", p && p.inscritas ? `Tiene ${p.inscritas} inscrita${p.inscritas === 1 ? "" : "s"}: si cambias el precio, ellas conservan su total.` : "");
  el("formVcPaquete").hidden = false;
}
el("btnVcPaqueteNuevo").addEventListener("click", () => vcPaqueteAbrirForm(null));
el("btnVcPaqueteCancelar").addEventListener("click", () => (el("formVcPaquete").hidden = true));

el("btnVcPaqueteGuardar").addEventListener("click", async () => {
  const boton = el("btnVcPaqueteGuardar");
  boton.disabled = true;
  vcMensaje("mensajeVcPaquete", "Guardando...");
  try {
    const r = await llamarWorker({
      accion: "vcPaquetesGuardar",
      clave: claveRecepcion,
      configId: vcConfigId,
      id: vcPaqueteEditando || undefined,
      paquete: {
        nombre: el("inputVcPaqueteNombre").value,
        dias: el("inputVcPaqueteDias").value,
        precio: el("inputVcPaquetePrecio").value,
        activo: el("chkVcPaqueteActivo").checked,
      },
    });
    vcDatos.paquetes = r.paquetes;
    el("formVcPaquete").hidden = true;
    vcPintarPaquetes();
    vcMensaje("mensajeVcPaquetes", `✅ Paquete «${r.paquete.nombre}» guardado.`, "ok");
  } catch (e) {
    vcMensaje("mensajeVcPaquete", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

async function vcPaqueteBorrar(p) {
  if (!confirm(`¿Borrar el paquete «${p.nombre}»?`)) return;
  try {
    const r = await llamarWorker({ accion: "vcPaquetesEliminar", clave: claveRecepcion, configId: vcConfigId, id: p.id });
    vcDatos.paquetes = r.paquetes;
    vcPintarPaquetes();
    vcMensaje("mensajeVcPaquetes", `✅ «${r.paquete}» borrado.`, "ok");
  } catch (e) {
    vcMensaje("mensajeVcPaquetes", e.message, "error");
  }
}

function vcLlenarFormulario() {
  const c = vcDatos.config;
  vcPintarTipoCurso();
  vcPintarPaquetes();
  el("inputVcNombre").value = c.nombre || "";
  el("inputVcInicio").value = c.inicio || "";
  el("inputVcFin").value = c.fin || "";
  el("inputVcHoraRecepcion").value = c.horaRecepcion || "";
  el("inputVcHoraInicio").value = c.horaInicio || "";
  el("inputVcHoraFin").value = c.horaFin || "";
  el("inputVcEdadMin").value = c.edadMinima ?? "";
  el("inputVcEdadMax").value = c.edadMaxima ?? "";
  el("inputVcPrecioCompleto").value = c.precioCompleto ?? "";
  el("inputVcSemanasParcial").value = c.semanasParcial ?? "";
  el("inputVcPrecioParcial").value = c.precioParcial ?? "";
  el("inputVcPorcentaje").value = c.porcentajeReserva === null ? "" : Math.round(c.porcentajeReserva * 100);
  el("inputVcCupo").value = c.cupo ?? "";
  el("inputVcActividades").value = c.actividades || "";
  el("inputVcPoliticas").value = c.politicas || "";
  el("inputVcMensaje").value = c.mensajeConfirmacion || "";
  el("inputVcDatosTransferencia").value = c.datosTransferencia || "";
  el("inputVcInstruccionesEfectivo").value = c.instruccionesEfectivo || "";
  el("inputVcWhatsapp").value = c.mensajeWhatsapp || "";
  el("inputVcWhatsappPago").value = c.mensajeWhatsappPago || "";
  vcDiasSinCurso = c.diasSinCurso.map((d) => ({ ...d }));
  vcPintarDiasSinCurso();
  el("chkVcFinesDeSemana").checked = !!c.finesDeSemana;
  vcMensaje("mensajeVcConfig", "");
}

function vcPintarDiasSinCurso() {
  const cont = el("listaVcDiasSinCurso");
  cont.innerHTML = "";
  if (!vcDiasSinCurso.length) {
    cont.appendChild(vcCrear("p", "lista-vacia", "No hay días sin curso."));
    return;
  }
  vcDiasSinCurso.forEach((d, indice) => {
    const fila = vcCrear("div", "show-tarjeta show-tarjeta-fila");
    fila.appendChild(vcCrear("span", "show-tarjeta-nombre", vcFechaCorta(d.fecha) + (d.motivo ? " — " + d.motivo : "")));
    const quitar = vcCrear("button", "btn-secundario btn-chico show-btn-peligro", "Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", () => {
      vcDiasSinCurso.splice(indice, 1);
      vcPintarDiasSinCurso();
      vcMensaje("mensajeVcConfig", "Recuerda guardar la configuración.");
    });
    fila.appendChild(quitar);
    cont.appendChild(fila);
  });
}

el("btnVcAgregarDia").addEventListener("click", () => {
  const fecha = el("inputVcDiaSinCurso").value;
  const motivo = el("inputVcMotivoSinCurso").value.trim();
  if (!fecha) {
    vcMensaje("mensajeVcConfig", "Escoge la fecha sin curso.", "error");
    return;
  }
  vcDiasSinCurso = vcDiasSinCurso.filter((d) => d.fecha !== fecha);
  vcDiasSinCurso.push({ fecha, motivo });
  vcDiasSinCurso.sort((a, b) => a.fecha.localeCompare(b.fecha));
  el("inputVcDiaSinCurso").value = "";
  el("inputVcMotivoSinCurso").value = "";
  vcPintarDiasSinCurso();
  vcMensaje("mensajeVcConfig", "Recuerda guardar la configuración.");
});

el("btnVcGuardarConfig").addEventListener("click", async () => {
  const boton = el("btnVcGuardarConfig");
  boton.disabled = true;
  vcMensaje("mensajeVcConfig", "Guardando...");
  try {
    await llamarWorker({
      accion: "vcRecepcionGuardarConfig",
      clave: claveRecepcion,
      configId: vcConfigId,
      campos: {
        nombre: el("inputVcNombre").value,
        inicio: el("inputVcInicio").value,
        fin: el("inputVcFin").value,
        diasSinCurso: vcDiasSinCurso,
        finesDeSemana: el("chkVcFinesDeSemana").checked,
        horaRecepcion: el("inputVcHoraRecepcion").value,
        horaInicio: el("inputVcHoraInicio").value,
        horaFin: el("inputVcHoraFin").value,
        edadMinima: el("inputVcEdadMin").value,
        edadMaxima: el("inputVcEdadMax").value,
        precioCompleto: el("inputVcPrecioCompleto").value,
        semanasParcial: el("inputVcSemanasParcial").value,
        precioParcial: el("inputVcPrecioParcial").value,
        porcentajeReserva: el("inputVcPorcentaje").value,
        cupo: el("inputVcCupo").value,
        actividades: el("inputVcActividades").value,
        politicas: el("inputVcPoliticas").value,
        mensajeConfirmacion: el("inputVcMensaje").value,
        datosTransferencia: el("inputVcDatosTransferencia").value,
        instruccionesEfectivo: el("inputVcInstruccionesEfectivo").value,
        mensajeWhatsapp: el("inputVcWhatsapp").value,
        mensajeWhatsappPago: el("inputVcWhatsappPago").value,
      },
    });
    await vcCargar();
    vcMensaje("mensajeVcConfig", "✅ Configuración guardada. La ficha pública ya muestra lo nuevo.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcConfig", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

// ---------- Temporada nueva ----------
// Propone el nombre del link con el nombre del curso (el de la
// temporada que se copia) + la temporada, p. ej. "move-vacation-camp-2027".
// Si Recepción ya lo cambió a mano, no se toca.
function vcProponerNombreLinkNuevo() {
  if (!vcNombreLinkNuevaEditado && vcDatos && vcDatos.config) {
    const temporada = el("inputVcNuevaTemporada").value.trim();
    el("inputVcNuevaNombreLink").value = temporada ? vcNormalizarNombreLink(`${vcDatos.config.nombre} ${temporada}`) : "";
  }
  vcPintarVistaLink("inputVcNuevaNombreLink", "vistaVcNuevaNombreLink");
}

el("inputVcNuevaTemporada").addEventListener("input", vcProponerNombreLinkNuevo);
el("inputVcNuevaNombreLink").addEventListener("input", () => {
  // Si lo borra todo, se vuelve a proponer solo.
  vcNombreLinkNuevaEditado = el("inputVcNuevaNombreLink").value.trim() !== "";
  vcPintarVistaLink("inputVcNuevaNombreLink", "vistaVcNuevaNombreLink");
});

el("btnVcCrearTemporada").addEventListener("click", async () => {
  const temporada = el("inputVcNuevaTemporada").value.trim();
  const inicio = el("inputVcNuevaInicio").value;
  const fin = el("inputVcNuevaFin").value;
  const nombreLink = vcNormalizarNombreLink(el("inputVcNuevaNombreLink").value);
  if (!temporada || !inicio || !fin) {
    vcMensaje("mensajeVcNueva", "Escribe el nombre y las dos fechas.", "error");
    return;
  }
  if (nombreLink.length < 3) {
    vcMensaje("mensajeVcNueva", "Escribe el nombre del link (al menos 3 letras o números).", "error");
    return;
  }
  const boton = el("btnVcCrearTemporada");
  boton.disabled = true;
  vcMensaje("mensajeVcNueva", "Creando...");
  try {
    const resp = await llamarWorker({
      accion: "vcRecepcionCrearTemporada",
      clave: claveRecepcion,
      desdeId: vcConfigId,
      temporada,
      inicio,
      fin,
      nombreLink,
    });
    vcConfigId = resp.configId;
    vcNombreLinkNuevaEditado = false;
    el("inputVcNuevaNombreLink").value = "";
    el("inputVcNuevaTemporada").value = "";
    el("inputVcNuevaInicio").value = "";
    el("inputVcNuevaFin").value = "";
    await vcCargar();
    vcCambiarPestana("Config");
    vcMensaje(
      "mensajeVcConfig",
      `✅ Temporada ${temporada} creada (Cerrada) con su propio link (arriba). Revisa precios, días sin curso y políticas, guarda, y luego ábrela.` +
        (resp.clasesCopiadas ? ` Se copiaron ${resp.clasesCopiadas} clase${resp.clasesCopiadas === 1 ? "" : "s"} (con la sección apagada en la ficha).` : "") +
        (resp.clasesSinFechas
          ? ` ⚠️ ${resp.clasesSinFechas === 1 ? "1 clase de fechas específicas quedó" : `${resp.clasesSinFechas} clases de fechas específicas quedaron`} sin fechas (las de la otra temporada no sirven): márcalas en 🗓️ Clases y horarios; mientras tanto no salen en la ficha.`
          : "") +
        (resp.avisoClases ? ` ⚠️ ${resp.avisoClases}` : ""),
      resp.avisoClases ? "error" : "ok"
    );
  } catch (e) {
    vcMensaje("mensajeVcNueva", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

// ---------- Mensajes WhatsApp a los responsables ----------
// El Worker arma cada mensaje (uno por teléfono, con todas sus niñas),
// revisa que no vaya a canceladas y los manda uno por uno con pausas de
// 20 a 60 s, máximo 50 al día. Aquí solo se escoge, se revisa la vista
// previa y se confirma. Los datos entran siempre con textContent.

// Botones de datos: las plantillas sirven para cualquier temporada, así
// que lo del curso sale siempre de aquí (de la temporada elegida).
// "hoy a las 8:00 a.m." / "mañana a las 8:00 a.m." si un envío que se
// manda ahora tiene que esperar el horario (8:00 a.m. a 8:00 p.m.).
function textoEmpiezaWa(empiezaEn) {
  if (!empiezaEn || empiezaEn <= Date.now() + 60000) return "";
  const dia = (ms) => new Date(ms - 6 * 3600000).toISOString().slice(0, 10);
  return `Fuera del horario de envíos (8:00 a.m. a 8:00 p.m.): empieza ${dia(empiezaEn) === dia(Date.now()) ? "hoy" : "mañana"} a las 8:00 a.m.`;
}

const VC_WA_VARIABLES = [
  "nombre_responsable", "nombre_participante", "codigo", "saldo", "total", "reserva",
  "nombre_curso", "fechas_curso", "fecha_inicio", "fecha_fin", "horario", "hora_recepcion",
  "dias_sin_curso", "edades", "precio_completo", "precio_parcial", "clases", "paquete",
];
let vcWaPlantillas = [];
let vcWaFiltro = "todas";
const vcWaSeleccion = new Set();
let vcWaPrevia = null; // última vista previa: es la que se manda
let vcWaTemporizador = null;

function vcWaPayload() {
  return {
    clave: claveRecepcion,
    configId: vcConfigId,
    filtro: vcWaFiltro,
    ids: [...vcWaSeleccion],
    texto: el("inputVcWaTexto").value,
    nombre: el("inputVcWaNombre").value.trim(),
  };
}

// Cualquier cambio (texto, destinatarias, temporada) obliga a ver la
// vista previa otra vez antes de enviar.
function vcWaInvalidarPrevia() {
  vcWaPrevia = null;
  el("cajaVcWaPrevia").hidden = true;
}

const vcWaTelefono = (numero) => {
  const d = String(numero || "").slice(-8);
  return d.length === 8 ? `${d.slice(0, 4)} ${d.slice(4)}` : String(numero || "");
};

function vcWaHora(ms) {
  return new Date(ms).toLocaleTimeString("es-GT", { timeZone: "America/Guatemala", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

async function vcWaCargar() {
  vcWaPintarSeleccion();
  try {
    const r = await llamarWorker({ accion: "vcWhatsappDatos", clave: claveRecepcion });
    vcWaPlantillas = r.plantillas || [];
    vcWaPintarPlantillas();
    vcWaPintarEstado(r.estado);
  } catch (e) {
    vcMensaje("mensajeVcWaEstado", e.message, "error");
  }
}

function vcWaPintarPlantillas(elegida) {
  const select = el("selectVcWaPlantilla");
  const actual = elegida !== undefined ? elegida : select.value;
  select.innerHTML = "";
  const nueva = vcCrear("option", "", "— Mensaje nuevo —");
  nueva.value = "";
  select.appendChild(nueva);
  vcWaPlantillas.forEach((p) => {
    const op = vcCrear("option", "", p.nombre);
    op.value = p.id;
    select.appendChild(op);
  });
  select.value = vcWaPlantillas.some((p) => p.id === actual) ? actual : "";
  el("btnVcWaBorrarPlantilla").disabled = !select.value;
  el("textoVcWaSinPlantillas").hidden = vcWaPlantillas.length > 0;
}

el("selectVcWaPlantilla").addEventListener("change", () => {
  const p = vcWaPlantillas.find((x) => x.id === el("selectVcWaPlantilla").value);
  el("inputVcWaNombre").value = p ? p.nombre : "";
  el("inputVcWaTexto").value = p ? p.texto : "";
  el("btnVcWaBorrarPlantilla").disabled = !p;
  vcMensaje("mensajeVcWaPlantilla", "");
  vcWaInvalidarPrevia();
});

el("btnVcWaGuardarPlantilla").addEventListener("click", async () => {
  const id = el("selectVcWaPlantilla").value;
  const boton = el("btnVcWaGuardarPlantilla");
  boton.disabled = true;
  vcMensaje("mensajeVcWaPlantilla", "Guardando...");
  try {
    const r = await llamarWorker({
      accion: "vcWhatsappPlantillaGuardar",
      clave: claveRecepcion,
      id: id || undefined,
      nombre: el("inputVcWaNombre").value,
      texto: el("inputVcWaTexto").value,
    });
    vcWaPlantillas = r.plantillas;
    vcWaPintarPlantillas(r.plantilla.id);
    vcMensaje("mensajeVcWaPlantilla", id ? "✅ Plantilla actualizada." : "✅ Plantilla guardada.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcWaPlantilla", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

el("btnVcWaBorrarPlantilla").addEventListener("click", async () => {
  const p = vcWaPlantillas.find((x) => x.id === el("selectVcWaPlantilla").value);
  if (!p || !confirm(`¿Borrar la plantilla «${p.nombre}»? No se puede deshacer.`)) return;
  vcMensaje("mensajeVcWaPlantilla", "Borrando...");
  try {
    const r = await llamarWorker({ accion: "vcWhatsappPlantillaEliminar", clave: claveRecepcion, id: p.id });
    vcWaPlantillas = r.plantillas;
    vcWaPintarPlantillas("");
    el("inputVcWaNombre").value = "";
    el("inputVcWaTexto").value = "";
    vcWaInvalidarPrevia();
    vcMensaje("mensajeVcWaPlantilla", "✅ Plantilla borrada.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcWaPlantilla", e.message, "error");
  }
});

// Botones que meten {dato} donde está el cursor.
VC_WA_VARIABLES.forEach((v) => {
  const b = vcCrear("button", "vc-wa-variable", `{${v}}`);
  b.type = "button";
  b.addEventListener("click", () => {
    const area = el("inputVcWaTexto");
    const ini = area.selectionStart ?? area.value.length;
    const fin = area.selectionEnd ?? area.value.length;
    area.setRangeText(`{${v}}`, ini, fin, "end");
    area.focus();
    vcWaInvalidarPrevia();
  });
  el("listaVcWaVariables").appendChild(b);
});

el("inputVcWaTexto").addEventListener("input", vcWaInvalidarPrevia);

// ---- Destinatarias ----
document.querySelectorAll("[data-vc-wa-filtro]").forEach((chip) => {
  chip.addEventListener("click", () => {
    vcWaFiltro = chip.dataset.vcWaFiltro;
    document.querySelectorAll("[data-vc-wa-filtro]").forEach((c) => c.classList.toggle("activo", c === chip));
    el("cajaVcWaSeleccion").hidden = vcWaFiltro !== "seleccion";
    vcWaInvalidarPrevia();
  });
});

function vcWaPintarSeleccion() {
  const cont = el("listaVcWaSeleccion");
  cont.innerHTML = "";
  const activas = vcDatos && vcDatos.inscritas ? vcDatos.inscritas.filter((i) => i.estado !== "Cancelada") : [];
  const ids = new Set(activas.map((i) => i.id));
  [...vcWaSeleccion].forEach((id) => ids.has(id) || vcWaSeleccion.delete(id));
  if (!activas.length) {
    cont.appendChild(vcCrear("p", "lista-vacia", "No hay inscritas activas en esta temporada."));
    return;
  }
  activas.forEach((i) => {
    const fila = vcCrear("label", "");
    const caja = document.createElement("input");
    caja.type = "checkbox";
    caja.checked = vcWaSeleccion.has(i.id);
    caja.addEventListener("change", () => {
      if (caja.checked) vcWaSeleccion.add(i.id);
      else vcWaSeleccion.delete(i.id);
      vcWaInvalidarPrevia();
    });
    const texto = vcCrear("span", "", i.alumna);
    const pagos = !i.reservaPagada ? "reserva pendiente" : !i.saldoPagado ? "saldo pendiente" : "pagado";
    texto.appendChild(vcCrear("small", "", `${i.responsable || "Sin responsable"} · ${vcWaTelefono(i.telefonoResponsable)} · ${i.codigo ? "código " + i.codigo : "sin código"} · ${pagos}`));
    fila.append(caja, texto);
    cont.appendChild(fila);
  });
}

function vcWaMarcarTodas(marcar) {
  vcWaSeleccion.clear();
  if (marcar && vcDatos) vcDatos.inscritas.filter((i) => i.estado !== "Cancelada").forEach((i) => vcWaSeleccion.add(i.id));
  vcWaPintarSeleccion();
  vcWaInvalidarPrevia();
}
el("btnVcWaMarcarTodas").addEventListener("click", () => vcWaMarcarTodas(true));
el("btnVcWaDesmarcar").addEventListener("click", () => vcWaMarcarTodas(false));

// ---- Vista previa y envío ----
el("btnVcWaVistaPrevia").addEventListener("click", async () => {
  const boton = el("btnVcWaVistaPrevia");
  boton.disabled = true;
  vcWaInvalidarPrevia();
  vcMensaje("mensajeVcWa", "Armando los mensajes...");
  try {
    const payload = vcWaPayload();
    const r = await llamarWorker({ accion: "vcWhatsappVistaPrevia", ...payload });
    vcWaPrevia = { ...r, payload };
    vcWaPintarPrevia();
    if (r.estado) vcWaPintarEstado(r.estado);
    vcMensaje("mensajeVcWa", "");
  } catch (e) {
    vcMensaje("mensajeVcWa", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

function vcWaPintarPrevia() {
  const r = vcWaPrevia;
  const n = r.mensajes.length;
  const participantes = r.mensajes.reduce((t, m) => t + m.nombres.length, 0);
  const minutos = Math.max(1, Math.round(((n - 1) * 40) / 60));
  el("textoVcWaCuantos").textContent = n
    ? `${n} responsable${n === 1 ? "" : "s"} (${participantes} participante${participantes === 1 ? "" : "s"}). Tarda unos ${minutos} min.`
    : "Nadie recibiría este mensaje.";

  const avisos = el("listaVcWaAvisos");
  avisos.innerHTML = "";
  const quedan = r.estado ? r.estado.quedanAlEmpezar : n;
  const activo = r.estado && r.estado.envio && r.estado.envio.estado === "enviando" ? r.estado.envio : null;
  const problemas = [];
  if (r.desconocidas.length) problemas.push(`El mensaje tiene datos que no existen aquí: ${r.desconocidas.map((v) => `{${v}}`).join(", ")}. Corrígelos antes de enviar.`);
  (r.vacias || []).forEach((v) =>
    problemas.push(
      v.todas
        ? `{${v.variable}} no tiene dato en la temporada ${vcDatos.config.temporada}: complétalo en ⚙️ Configuración o quítalo del mensaje.`
        : `{${v.variable}} no tiene dato para: ${v.nombres.join(", ")}. Quítalas de la lista o quita el dato del mensaje.`
    )
  );
  if (r.porEscribir) problemas.push("El mensaje todavía dice «[ESCRIBÍ AQUÍ…»: escribe el aviso antes de enviar.");
  if (n > quedan) problemas.push(`Solo quedan ${quedan} mensajes de 50 para el día en que sale. Elige menos responsables o envía otro día.`);
  if ((activo && !activo.multiDia) || (r.estado && r.estado.enEspera)) problemas.push("Hay un envío del campamento en curso: espera a que termine para mandar otro.");
  problemas.forEach((t) => avisos.appendChild(vcCrear("li", "vc-wa-error", t)));
  if (r.sinTelefono.length) avisos.appendChild(vcCrear("li", "", `Sin teléfono válido (no reciben): ${r.sinTelefono.join(", ")}`));
  // Solo aviso: en su mensaje la línea de {clases} se quita sola.
  if (r.sinClase && r.sinClase.length) avisos.appendChild(vcCrear("li", "", `Sin clase asignada (su mensaje sale sin la línea de clases): ${r.sinClase.join(", ")}`));
  const horario = textoEmpiezaWa(r.estado && r.estado.empiezaEn);
  if (horario) avisos.appendChild(vcCrear("li", "", horario));
  if (activo && activo.multiDia && !(r.estado && r.estado.enEspera)) {
    avisos.appendChild(vcCrear("li", "", `El anuncio «${activo.nombre}» se pausa: sale primero esto y después el anuncio sigue solo.`));
  }
  avisos.hidden = !avisos.children.length;

  const select = el("selectVcWaPrevia");
  select.innerHTML = "";
  r.mensajes.forEach((m, i) => {
    const op = vcCrear("option", "", `${m.nombres.join(" y ")} — ${m.responsable || "Sin responsable"} (${vcWaTelefono(m.numero)})`);
    op.value = String(i);
    select.appendChild(op);
  });
  select.hidden = !n;
  vcWaPintarBurbuja();

  const enviar = el("btnVcWaEnviar");
  enviar.textContent = `📲 Enviar a ${n} responsable${n === 1 ? "" : "s"}`;
  enviar.disabled = !n || problemas.length > 0;
  el("btnVcWaProbar").disabled = !n || r.desconocidas.length > 0 || (r.vacias || []).length > 0 || r.porEscribir;
  el("cajaVcWaPrevia").hidden = false;
}

function vcWaPintarBurbuja() {
  const m = vcWaPrevia && vcWaPrevia.mensajes[Number(el("selectVcWaPrevia").value) || 0];
  el("textoVcWaPrevia").textContent = m ? m.texto : "";
  el("textoVcWaPrevia").hidden = !m;
}
el("selectVcWaPrevia").addEventListener("change", vcWaPintarBurbuja);

el("btnVcWaEnviar").addEventListener("click", async () => {
  if (!vcWaPrevia) return;
  const n = vcWaPrevia.mensajes.length;
  const nombre = vcWaPrevia.payload.nombre || "Mensaje sin plantilla";
  const minutos = Math.max(1, Math.round(((n - 1) * 40) / 60));
  const horario = textoEmpiezaWa(vcWaPrevia.estado && vcWaPrevia.estado.empiezaEn);
  if (!confirm(`¿Enviar «${nombre}» a ${n} responsable${n === 1 ? "" : "s"}?\n\nSe mandan uno por uno, con pausas de 20 a 60 segundos (unos ${minutos} min), solo de 8:00 a.m. a 8:00 p.m.${horario ? `\n${horario}` : ""}\nPuedes cerrar esta pantalla: el envío sigue solo.`)) return;
  const boton = el("btnVcWaEnviar");
  boton.disabled = true;
  vcMensaje("mensajeVcWa", "Iniciando el envío...");
  try {
    const r = await llamarWorker({ accion: "vcWhatsappEnviar", ...vcWaPrevia.payload, confirmados: n });
    vcWaInvalidarPrevia();
    vcWaPintarEstado(r.estado);
    vcMensaje("mensajeVcWa", "✅ Envío iniciado. Arriba ves el avance.", "ok");
    el("cajaVcWaEstado").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    vcMensaje("mensajeVcWa", e.message, "error");
    boton.disabled = false;
  }
});

el("btnVcWaProbar").addEventListener("click", async () => {
  if (!vcWaPrevia) return;
  const telefono = el("inputVcWaTelefono").value;
  const boton = el("btnVcWaProbar");
  boton.disabled = true;
  vcMensaje("mensajeVcWa", "Mandando la prueba...");
  try {
    const r = await llamarWorker({
      accion: "vcWhatsappPrueba",
      ...vcWaPrevia.payload,
      indice: Number(el("selectVcWaPrevia").value) || 0,
      telefono,
    });
    vcWaPintarEstado(r.estado);
    vcMensaje("mensajeVcWa", `✅ Prueba en camino a ${vcWaTelefono(telefono.replace(/\D/g, ""))}.`, "ok");
  } catch (e) {
    vcMensaje("mensajeVcWa", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

// ---- Estado del envío ----
function vcWaPintarEstado(estado) {
  clearTimeout(vcWaTemporizador);
  if (!estado) {
    el("textoVcWaHoy").textContent = "No se pudo leer el estado de los envíos.";
    el("cajaVcWaEnvio").hidden = true;
    return;
  }
  el("textoVcWaHoy").textContent = `Hoy: ${estado.enviadosHoy} de ${estado.maximo} mensajes masivos, contando anuncios (quedan ${estado.quedanHoy}).`;
  const v = estado.envio;
  el("cajaVcWaEnvio").hidden = !v;
  if (!v) return;
  const nombre = `«${v.nombre}»${v.temporada ? ` (${v.temporada})` : ""}`;
  const hechos = v.enviados + v.errores;
  const titulo = el("textoVcWaEnvio");
  titulo.className = "vc-wa-envio-titulo" + (v.estado === "detenido" ? " vc-wa-detenido" : "");
  if (v.estado === "enviando" && v.continuaManana) titulo.textContent = `⏳ ${nombre}: enviados ${v.enviados} de ${v.total}, continúa mañana a las 9:00 a.m.`;
  else if (v.estado === "enviando" && v.esperaHorario) titulo.textContent = `🌙 ${nombre}: enviados ${v.enviados} de ${v.total}, sigue a las 8:00 a.m. (horario de envíos).`;
  else if (v.estado === "enviando") titulo.textContent = `⏳ Enviando ${nombre}: ${hechos} de ${v.total}${v.errores ? ` (${v.errores} con error)` : ""}`;
  else if (v.estado === "terminado") titulo.textContent = `✅ ${nombre} terminado: ${v.enviados} de ${v.total} enviados${v.errores ? `, ${v.errores} con error` : ""}.`;
  else titulo.textContent = `⏹️ ${nombre} detenido: ${v.enviados} de ${v.total} enviados. ${v.motivo}`;
  el("textoVcWaSiguiente").textContent =
    v.estado === "enviando" && v.siguienteEn
      ? `Siguiente mensaje ${v.continuaManana ? "mañana a las 9:00 a.m." : `a las ${vcWaHora(v.siguienteEn)}`}.`
      : `Empezó a las ${vcWaHora(v.creado)}.`;
  el("btnVcWaDetener").hidden = v.estado !== "enviando";
  // Lo que espera (un anuncio pausado o en cola) y el último terminado.
  const extra = [];
  if (estado.enEspera) extra.push(`⏸️ En espera: «${estado.enEspera.nombre}», ${estado.enEspera.enviados} de ${estado.enEspera.total} enviados; sigue solo cuando termine este.`);
  if (estado.ultimo) extra.push(`Último terminado: ${textoEstadoEnvioWa(estado.ultimo)}`);
  el("textoVcWaSiguiente").textContent += extra.length ? ` ${extra.join(" ")}` : "";

  const lista = el("listaVcWaResultados");
  lista.innerHTML = "";
  v.resultados.forEach((x) => {
    const icono = x.estado === "enviado" ? "✅" : x.estado === "error" ? "❌" : "⏸️";
    const li = vcCrear("li", x.estado === "enviado" ? "vc-wa-ok" : "vc-wa-error", `${icono} ${x.nombres.join(" y ")} — ${vcWaTelefono(x.numero)} · ${vcWaHora(x.hora)}${x.error ? ` · ${x.error}` : ""}`);
    lista.appendChild(li);
  });
  v.porEnviar.forEach((x) => lista.appendChild(vcCrear("li", "", `⏳ ${x.nombres.join(" y ")} — ${vcWaTelefono(x.numero)}`)));

  // Mientras se envía, se actualiza solo (solo con esta pestaña abierta).
  if (v.estado === "enviando") {
    vcWaTemporizador = setTimeout(() => {
      if (vcPestana === "Whatsapp" && !el("pantallaCampamento").hidden) vcWaActualizarEstado();
    }, 15000);
  }
}

async function vcWaActualizarEstado() {
  try {
    const r = await llamarWorker({ accion: "vcWhatsappDatos", clave: claveRecepcion });
    vcWaPintarEstado(r.estado);
    vcMensaje("mensajeVcWaEstado", "");
  } catch (e) {
    vcMensaje("mensajeVcWaEstado", e.message, "error");
  }
}
el("btnVcWaActualizar").addEventListener("click", vcWaActualizarEstado);

el("btnVcWaDetener").addEventListener("click", async () => {
  if (!confirm("¿Detener el envío? Los mensajes que faltan no se van a mandar.")) return;
  try {
    const r = await llamarWorker({ accion: "vcWhatsappDetener", clave: claveRecepcion });
    vcWaPintarEstado(r.estado);
    vcMensaje("mensajeVcWaEstado", "Envío detenido.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcWaEstado", e.message, "error");
  }
});

// ---------- Clases y horarios de la temporada ----------
// El Worker guarda y revisa todo (cupo con candado, choques de horario);
// aquí se configura, se ve por clase / por alumna y se descarga. Las
// canceladas no vienen. Los datos entran siempre con textContent.

const VC_DIAS_CLASE = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
let vcClasesDatos = null; // última respuesta de vcClasesDatos
let vcClasesVista = "Config";
let vcClaseEditando = null; // id de la clase del formulario (null = nueva)

async function vcClasesCargar() {
  if (!vcConfigId) return;
  vcMensaje("mensajeVcClases", "Cargando...");
  try {
    vcClasesDatos = await llamarWorker({ accion: "vcClasesDatos", clave: claveRecepcion, configId: vcConfigId });
    vcMensaje("mensajeVcClases", "");
    vcClasesPintar();
  } catch (e) {
    vcMensaje("mensajeVcClases", e.message, "error");
  }
}

function vcClasesPintar() {
  if (!vcClasesDatos) return;
  vcClasesPintarConfig();
  vcClasesPintarLista();
  vcClasesPintarPorClase();
  vcClasesPintarPorAlumna();
}

function vcClasesCambiarVista(nombre) {
  vcClasesVista = nombre;
  document.querySelectorAll("[data-vc-clases-vista]").forEach((c) => c.classList.toggle("activo", c.dataset.vcClasesVista === nombre));
  ["Config", "PorClase", "PorAlumna"].forEach((n) => (el("vistaVcClases" + n).hidden = n !== nombre));
}
document.querySelectorAll("[data-vc-clases-vista]").forEach((chip) => chip.addEventListener("click", () => vcClasesCambiarVista(chip.dataset.vcClasesVista)));

const vcCupoTexto = (c) => (c.cupo === null ? `${c.inscritas} inscrita${c.inscritas === 1 ? "" : "s"} (sin cupo)` : `${c.inscritas} / ${c.cupo}`);
const vcEdadesTexto = (c) =>
  c.edadMinima !== null && c.edadMaxima !== null ? `${c.edadMinima} a ${c.edadMaxima} años`
    : c.edadMinima !== null ? `desde ${c.edadMinima} años`
    : c.edadMaxima !== null ? `hasta ${c.edadMaxima} años`
    : "";

// --- Interruptor, mínimo y máximo ---
function vcClasesPintarConfig() {
  const cfg = vcClasesDatos.config;
  const caja = el("cajaVcClasesFicha");
  caja.classList.toggle("activo", cfg.mostrar);
  caja.classList.toggle("inactivo", !cfg.mostrar);
  el("btnVcClasesActivo").classList.toggle("elegido", cfg.mostrar);
  el("btnVcClasesInactivo").classList.toggle("elegido", !cfg.mostrar);
  // "Por clases": las clases siempre salen en la ficha (no hay interruptor)
  // y hay que elegir al menos una.
  const porClases = !!vcClasesDatos.porClases;
  el("botonesVcClasesFicha").hidden = porClases;
  el("inputVcClasesMinimo").min = porClases ? 1 : 0;
  el("textoVcClasesEstado").textContent = porClases
    ? `Curso «Por clases»: la ficha de ${vcClasesDatos.temporada} siempre muestra sus clases (sin precio: el precio sale del paquete) y hay que elegir al menos una.`
    : cfg.mostrar
      ? `Activo: la ficha de la temporada ${vcClasesDatos.temporada} muestra la sección «Clases».`
      : `Inactivo: la ficha de la temporada ${vcClasesDatos.temporada} queda igual que siempre, sin clases.`;
  // La ficha de una temporada que no está "Abiertas" no la ven las
  // familias, aunque el interruptor esté activo (incidente del 2026-11-02).
  const aviso = el("avisoVcClasesTemporada");
  const abiertas = (vcDatos && vcDatos.temporadas ? vcDatos.temporadas : []).filter((t) => t.estado === "Abiertas").map((t) => `«${t.temporada}»`);
  aviso.hidden = vcClasesDatos.estadoTemporada === "Abiertas";
  aviso.textContent = aviso.hidden
    ? ""
    : `⚠️ Estás viendo la temporada «${vcClasesDatos.temporada}», que está ${vcClasesDatos.estadoTemporada === "Archivada" ? "archivada" : "cerrada"}: las familias no ven su ficha (ni sus clases) hasta que abras las inscripciones.` +
      (abiertas.length ? ` La ficha abierta ahora es la de ${abiertas.join(" y ")}: para que salgan clases ahí, elígela arriba en «Temporada».` : "");
  el("inputVcClasesMinimo").value = cfg.minimo || 0;
  el("inputVcClasesMaximo").value = cfg.maximo ?? "";
}

async function vcClasesGuardarConfig(mostrar) {
  const cfg = vcClasesDatos && vcClasesDatos.config;
  if (!cfg) return;
  if (mostrar && !vcClasesDatos.clases.length && !confirm("Esta temporada todavía no tiene clases. ¿Activar igual la sección en la ficha?")) return;
  vcMensaje("mensajeVcClases", "Guardando...");
  try {
    const r = await llamarWorker({
      accion: "vcClasesGuardarConfig",
      clave: claveRecepcion,
      configId: vcConfigId,
      mostrar,
      minimo: el("inputVcClasesMinimo").value,
      maximo: el("inputVcClasesMaximo").value,
    });
    vcClasesDatos.config = r.config;
    vcClasesPintarConfig();
    vcMensaje("mensajeVcClases", "✅ Guardado.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcClases", e.message, "error");
  }
}
el("btnVcClasesActivo").addEventListener("click", () => vcClasesDatos && !vcClasesDatos.config.mostrar && vcClasesGuardarConfig(true));
el("btnVcClasesInactivo").addEventListener("click", () => vcClasesDatos && vcClasesDatos.config.mostrar && vcClasesGuardarConfig(false));
el("btnVcClasesGuardarLimites").addEventListener("click", () => vcClasesDatos && vcClasesGuardarConfig(vcClasesDatos.config.mostrar));

// --- Lista de clases y formulario ---
function vcClasesPintarLista() {
  const cont = el("listaVcClases");
  cont.innerHTML = "";
  if (!vcClasesDatos.clases.length) {
    cont.appendChild(vcCrear("p", "lista-vacia", "Todavía no hay clases en esta temporada."));
    return;
  }
  vcClasesDatos.clases.forEach((c) => {
    const t = vcCrear("div", "show-tarjeta vc-clase-tarjeta");
    t.appendChild(vcCrear("p", "vc-clase-nombre", c.nombre));
    t.appendChild(vcCrear("p", "vc-clase-detalle", `${c.diasTexto} · ${c.horario}`));
    const extra = [vcCupoTexto(c), vcEdadesTexto(c)].filter(Boolean).join(" · ");
    t.appendChild(vcCrear("p", "vc-clase-detalle", extra));
    if (c.cupo !== null && c.inscritas > c.cupo) t.appendChild(vcCrear("p", "vc-wa-error", `⚠️ Tiene más inscritas (${c.inscritas}) que cupo (${c.cupo}).`));
    vcAvisosFechasClase(c).forEach((a) => t.appendChild(vcCrear("p", "vc-wa-error", a)));
    const hc = vcClasesDatos.horarioCurso;
    if (hc && (c.horaInicio < hc.inicio || c.horaFin > hc.fin)) t.appendChild(vcCrear("p", "vc-wa-error", `⚠️ Fuera del horario del curso (${hc.texto}). ¿a.m. en vez de p.m.?`));
    if (c.descripcion) t.appendChild(vcCrear("p", "vc-clase-descripcion", c.descripcion));
    const acciones = vcCrear("div", "show-acciones");
    const editar = vcCrear("button", "btn-secundario btn-chico", "✏️ Editar");
    editar.type = "button";
    editar.addEventListener("click", () => vcClaseAbrirForm(c));
    const borrar = vcCrear("button", "btn-secundario btn-chico", "🗑️ Borrar");
    borrar.type = "button";
    borrar.addEventListener("click", () => vcClaseBorrar(c));
    acciones.append(editar, borrar);
    t.appendChild(acciones);
    cont.appendChild(t);
  });
}

VC_DIAS_CLASE.forEach((dia) => {
  const label = vcCrear("label", "vc-clase-dia");
  const caja = document.createElement("input");
  caja.type = "checkbox";
  caja.value = dia;
  label.append(caja, document.createTextNode(" " + dia));
  el("listaVcClaseDias").appendChild(label);
});

// --- "Cuándo es": días de la semana o fechas específicas (calendario) ---
// Mismas reglas que el Worker (src/clasesCampamento.js en portalalumnas);
// el Worker las vuelve a revisar al guardar. Fechas como "AAAA-MM-DD" y
// cuentas en UTC, nunca la zona del navegador.
const VC_CUANDO_FECHAS = "Fechas específicas";
const VC_DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const VC_MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const VC_MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
let vcClaseFechas = new Set(); // fechas marcadas en el formulario

const vcFechaUtc = (iso) => new Date(iso + "T00:00:00Z");
const vcIso = (d) => d.toISOString().slice(0, 10);
const vcFechaClase = (iso) => `${VC_DIAS_CORTOS[vcFechaUtc(iso).getUTCDay()]} ${Number(iso.slice(8, 10))} ${VC_MESES_CORTOS[Number(iso.slice(5, 7)) - 1]}`;

function vcMotivoFechaBloqueada(fecha, curso) {
  if (!curso || !curso.inicio || !curso.fin) return "la temporada no tiene fecha de inicio y fin";
  if (fecha < curso.inicio || fecha > curso.fin) return "fuera de las fechas del curso";
  const sinCurso = (curso.diasSinCurso || []).find((d) => d.fecha === fecha);
  if (sinCurso) return sinCurso.motivo ? `sin curso (${sinCurso.motivo})` : "sin curso";
  const dia = vcFechaUtc(fecha).getUTCDay();
  if ((dia === 0 || dia === 6) && !curso.finesDeSemana) return "fin de semana (la temporada no tiene curso sábados y domingos)";
  return "";
}

function vcAvisosFechasClase(c) {
  if (c.cuando !== VC_CUANDO_FECHAS) return [];
  const avisos = [];
  if (!c.fechas.length) avisos.push("⚠️ Falta poner las fechas: no sale en la ficha hasta que las marques (✏️ Editar).");
  if ((c.fechasFuera || []).length) {
    avisos.push(`⚠️ ${c.fechasFuera.length === 1 ? "Esta fecha ya no es" : "Estas fechas ya no son"} del curso y no cuenta${c.fechasFuera.length === 1 ? "" : "n"}: ${c.fechasFuera.map(vcFechaClase).join(", ")}. Cambió la temporada; edita la clase para corregirla.`);
  }
  return avisos;
}

const vcCuandoElegido = () => (document.querySelector('input[name="vcClaseCuando"]:checked') || {}).value || "Días de la semana";

function vcClasePintarCuando() {
  const conFechas = vcCuandoElegido() === VC_CUANDO_FECHAS;
  el("bloqueVcClaseDias").hidden = conFechas;
  el("bloqueVcClaseFechas").hidden = !conFechas;
  if (conFechas) vcPintarCalendario();
}
document.querySelectorAll('input[name="vcClaseCuando"]').forEach((r) => r.addEventListener("change", vcClasePintarCuando));

// Un mes por recuadro, de lunes a domingo, desde el mes del inicio hasta
// el del fin. Lo que no se puede marcar se ve en gris (los días sin curso
// en rosa tachado) y dice el motivo al pasar el dedo.
function vcPintarCalendario() {
  const cont = el("calendarioVcClase");
  cont.innerHTML = "";
  const curso = vcClasesDatos && vcClasesDatos.curso;
  if (!curso || !curso.inicio || !curso.fin) {
    cont.appendChild(vcCrear("p", "vc-wa-error", "Primero pon la fecha de inicio y la de fin en ⚙️ Configuración y guarda."));
    vcPintarResumenFechas();
    return;
  }
  let mes = curso.inicio.slice(0, 7);
  const ultimo = curso.fin.slice(0, 7);
  for (let n = 0; mes <= ultimo && n < 24; n++) {
    const [a, m] = mes.split("-").map(Number);
    const caja = vcCrear("div", "vc-cal-mes");
    caja.appendChild(vcCrear("p", "vc-cal-titulo", `${VC_MESES_LARGOS[m - 1]} ${a}`));
    const grilla = vcCrear("div", "vc-cal-grilla");
    ["lu", "ma", "mi", "ju", "vi", "sá", "do"].forEach((d) => grilla.appendChild(vcCrear("span", "vc-cal-cabeza", d)));
    const primero = vcFechaUtc(`${mes}-01`);
    for (let i = 0; i < (primero.getUTCDay() + 6) % 7; i++) grilla.appendChild(document.createElement("span"));
    for (let d = new Date(primero); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = vcIso(d);
      const motivo = vcMotivoFechaBloqueada(iso, curso);
      const boton = vcCrear("button", "vc-cal-dia", String(d.getUTCDate()));
      boton.type = "button";
      boton.disabled = !!motivo;
      boton.title = motivo ? `${vcFechaClase(iso)}: ${motivo}` : vcFechaClase(iso);
      boton.setAttribute("aria-label", boton.title);
      if ((curso.diasSinCurso || []).some((x) => x.fecha === iso)) boton.classList.add("sin-curso");
      const marcar = () => {
        boton.classList.toggle("marcada", vcClaseFechas.has(iso));
        boton.setAttribute("aria-pressed", vcClaseFechas.has(iso) ? "true" : "false");
      };
      marcar();
      boton.addEventListener("click", () => {
        if (vcClaseFechas.has(iso)) vcClaseFechas.delete(iso);
        else vcClaseFechas.add(iso);
        marcar();
        vcPintarResumenFechas();
      });
      grilla.appendChild(boton);
    }
    caja.appendChild(grilla);
    cont.appendChild(caja);
    mes = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  }
  vcPintarResumenFechas();
}

function vcPintarResumenFechas() {
  const n = vcClaseFechas.size;
  const orden = [...vcClaseFechas].sort();
  el("resumenVcClaseFechas").textContent = n ? `${n} fecha${n === 1 ? "" : "s"}: ${orden.map(vcFechaClase).join(", ")}` : "Todavía no marcaste ninguna fecha.";
}

function vcClaseAbrirForm(c) {
  vcClaseEditando = c ? c.id : null;
  el("tituloFormVcClase").textContent = c ? `Editar «${c.nombre}»` : "Clase nueva";
  el("inputVcClaseNombre").value = c ? c.nombre : "";
  const conFechas = !!c && c.cuando === VC_CUANDO_FECHAS;
  document.querySelectorAll('input[name="vcClaseCuando"]').forEach((r) => (r.checked = r.value === (conFechas ? VC_CUANDO_FECHAS : "Días de la semana")));
  // Solo las fechas vigentes: las que ya no son del curso se quitan al guardar.
  vcClaseFechas = new Set(conFechas ? c.fechas : []);
  const fuera = conFechas ? c.fechasFuera || [] : [];
  el("avisoVcClaseFechas").hidden = !fuera.length;
  el("avisoVcClaseFechas").textContent = fuera.length ? `⚠️ Ya no son del curso y se quitan al guardar: ${fuera.map(vcFechaClase).join(", ")}.` : "";
  vcClasePintarCuando();
  el("listaVcClaseDias").querySelectorAll("input").forEach((i) => (i.checked = !!c && c.dias.includes(i.value)));
  el("inputVcClaseInicio").value = c ? c.horaInicio : "";
  el("inputVcClaseFin").value = c ? c.horaFin : "";
  el("inputVcClaseCupo").value = c && c.cupo !== null ? c.cupo : "";
  el("inputVcClaseEdadMin").value = c && c.edadMinima !== null ? c.edadMinima : "";
  el("inputVcClaseEdadMax").value = c && c.edadMaxima !== null ? c.edadMaxima : "";
  el("inputVcClaseDescripcion").value = c ? c.descripcion : "";
  vcMensaje("mensajeVcClase", "");
  el("formVcClase").hidden = false;
  el("formVcClase").scrollIntoView({ behavior: "smooth", block: "start" });
}
el("btnVcClaseNueva").addEventListener("click", () => vcClaseAbrirForm(null));
el("btnVcClaseCancelar").addEventListener("click", () => (el("formVcClase").hidden = true));

el("btnVcClaseGuardar").addEventListener("click", async () => {
  const boton = el("btnVcClaseGuardar");
  boton.disabled = true;
  vcMensaje("mensajeVcClase", "Guardando...");
  try {
    const r = await llamarWorker({
      accion: "vcClasesGuardar",
      clave: claveRecepcion,
      configId: vcConfigId,
      id: vcClaseEditando || undefined,
      clase: {
        nombre: el("inputVcClaseNombre").value,
        cuando: vcCuandoElegido(),
        dias: [...el("listaVcClaseDias").querySelectorAll("input:checked")].map((i) => i.value),
        fechas: [...vcClaseFechas].sort(),
        horaInicio: el("inputVcClaseInicio").value,
        horaFin: el("inputVcClaseFin").value,
        cupo: el("inputVcClaseCupo").value,
        edadMinima: el("inputVcClaseEdadMin").value,
        edadMaxima: el("inputVcClaseEdadMax").value,
        descripcion: el("inputVcClaseDescripcion").value,
      },
    });
    el("formVcClase").hidden = true;
    await vcClasesCargar();
    vcMensaje("mensajeVcClases", r.aviso ? `⚠️ ${r.aviso}` : `✅ Clase «${r.clase.nombre}» guardada.`, r.aviso ? "error" : "ok");
  } catch (e) {
    vcMensaje("mensajeVcClase", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

async function vcClaseBorrar(c) {
  if (!confirm(`¿Borrar la clase «${c.nombre}»?`)) return;
  const pedido = { accion: "vcClasesEliminar", clave: claveRecepcion, configId: vcConfigId, id: c.id };
  try {
    // Con niñas inscritas el Worker no borra y devuelve sus nombres para
    // confirmar (viene con success: false, por eso no va con llamarWorker).
    let r = await llamarWorkerSinError(pedido);
    if (!r) throw new Error("No se pudo conectar. Intenta de nuevo.");
    if (!r.success) {
      if (!r.necesitaConfirmar) throw new Error(r.error || "No se pudo borrar la clase.");
      if (!confirm(`«${c.nombre}» tiene ${r.afectadas.length} inscrita${r.afectadas.length === 1 ? "" : "s"}:\n\n${r.afectadas.join("\n")}\n\nSi la borras, se les quita esta clase. ¿Borrar igual?`)) return;
      r = await llamarWorker({ ...pedido, confirmar: true });
    }
    await vcClasesCargar();
    vcMensaje(
      "mensajeVcClases",
      r.afectadas.length ? `✅ «${r.clase}» borrada. Se le quitó a: ${r.afectadas.join(", ")}.` : `✅ «${r.clase}» borrada.`,
      "ok"
    );
  } catch (e) {
    vcMensaje("mensajeVcClases", e.message, "error");
  }
}

// llamarWorker tira error si success es false; aquí se necesita la
// respuesta completa (la lista de afectadas viene con success: false).
async function llamarWorkerSinError(payload) {
  const resp = await fetch(WORKER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return resp.json().catch(() => null);
}

// --- Por clase ---
function vcClasesPintarPorClase() {
  const cont = el("listaVcClasesPorClase");
  cont.innerHTML = "";
  if (!vcClasesDatos.clases.length) {
    cont.appendChild(vcCrear("p", "lista-vacia", "Todavía no hay clases en esta temporada."));
    return;
  }
  vcClasesDatos.clases.forEach((c) => {
    const t = vcCrear("details", "show-tarjeta vc-clase-tarjeta");
    const resumen = vcCrear("summary", "show-tarjeta-fila");
    const texto = vcCrear("span", "show-tarjeta-texto");
    texto.append(vcCrear("span", "show-tarjeta-nombre", c.nombre), vcCrear("span", "tarjeta-resultado-detalle", `${c.diasTexto} · ${c.horario}`));
    const lleno = c.cupo !== null && c.inscritas >= c.cupo;
    resumen.append(texto, vcCrear("span", "show-etiqueta " + (lleno ? "show-etiqueta-no" : "show-etiqueta-si"), vcCupoTexto(c) + (lleno ? " · Lleno" : "")));
    t.appendChild(resumen);
    const lista = vcCrear("ol", "vc-clase-ninas");
    c.ninas.forEach((n) => {
      const li = vcCrear("li", "", `${n.alumna}${n.edad !== null ? ` (${n.edad} años)` : ""} — ${n.responsable || "Sin responsable"} ${n.telefono || ""}`);
      if (n.fueraDeEdad) li.appendChild(vcCrear("span", "vc-wa-error", " · fuera de la edad de la clase"));
      lista.appendChild(li);
    });
    if (!c.ninas.length) t.appendChild(vcCrear("p", "lista-vacia", "Nadie inscrita todavía."));
    else t.appendChild(lista);
    const acciones = vcCrear("div", "show-acciones");
    const pdf = vcCrear("button", "btn-secundario btn-chico", "📄 PDF");
    pdf.type = "button";
    pdf.addEventListener("click", () => vcClasesDescargarPdf([c]));
    const csv = vcCrear("button", "btn-secundario btn-chico", "📊 Excel (CSV)");
    csv.type = "button";
    csv.addEventListener("click", () => vcClasesDescargarCsv([c]));
    acciones.append(pdf, csv);
    t.appendChild(acciones);
    cont.appendChild(t);
  });
}

const vcNombreArchivoClases = (clases) =>
  `clases-${vcClasesDatos.temporada}-${clases.length === 1 ? clases[0].nombre : "todas"}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");

function vcClasesDescargarCsv(clases) {
  const filas = [["Clase", "Cuándo", "Horario", "Cupo", "#", "Alumna", "Edad", "Responsable", "Teléfono"]];
  clases.forEach((c) => {
    if (!c.ninas.length) filas.push([c.nombre, c.diasTexto, c.horario, c.cupo ?? "", "", "(sin inscritas)", "", "", ""]);
    c.ninas.forEach((n, i) => filas.push([c.nombre, c.diasTexto, c.horario, c.cupo ?? "", i + 1, n.alumna, n.edad ?? "", n.responsable, n.telefono]));
  });
  const texto = "﻿" + filas.map((f) => f.map(celdaCsvAmon).join(",")).join("\r\n");
  descargarArchivoAmon(new Blob([texto], { type: "text/csv;charset=utf-8" }), `${vcNombreArchivoClases(clases)}.csv`);
  vcMensaje("mensajeVcClases", "✅ Excel (CSV) descargado.", "ok");
}

async function vcClasesDescargarPdf(clases) {
  vcMensaje("mensajeVcClases", "Preparando el PDF...");
  try {
    const jsPDF = await asegurarJsPdf();
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    clases.forEach((c, i) => {
      if (i) doc.addPage();
      doc.setFontSize(15);
      doc.text(textoPdfAmon(`${c.nombre} · Temporada ${vcClasesDatos.temporada}`), 40, 50);
      doc.setFontSize(10.5);
      // Con muchas fechas la línea no cabe: se parte en varias.
      const lineas = doc.splitTextToSize(textoPdfAmon(`${c.diasTexto} · ${c.horario} · ${vcCupoTexto(c)}${vcEdadesTexto(c) ? " · " + vcEdadesTexto(c) : ""}`), 532);
      doc.text(lineas, 40, 68);
      doc.autoTable({
        startY: 84 + (lineas.length - 1) * 13,
        head: [["#", "Alumna", "Edad", "Responsable", "Teléfono"]],
        body: c.ninas.length
          ? c.ninas.map((n, j) => [j + 1, textoPdfAmon(n.alumna), n.edad ?? "", textoPdfAmon(n.responsable), textoPdfAmon(n.telefono)])
          : [["", "Sin inscritas todavía", "", "", ""]],
        styles: { fontSize: 10, cellPadding: 4 },
        headStyles: { fillColor: [235, 87, 141] },
        columnStyles: { 0: { cellWidth: 28 }, 2: { cellWidth: 40 } },
        margin: { left: 40, right: 40 },
      });
    });
    doc.save(`${vcNombreArchivoClases(clases)}.pdf`);
    vcMensaje("mensajeVcClases", "✅ PDF descargado.", "ok");
  } catch (e) {
    vcMensaje("mensajeVcClases", e.message, "error");
  }
}
el("btnVcClasesPdfTodas").addEventListener("click", () => vcClasesDatos && vcClasesDescargarPdf(vcClasesDatos.clases));
el("btnVcClasesCsvTodas").addEventListener("click", () => vcClasesDatos && vcClasesDescargarCsv(vcClasesDatos.clases));

// --- Por alumna (primero las que no tienen clase) ---
function vcClasesPintarPorAlumna() {
  const cont = el("listaVcClasesPorAlumna");
  cont.innerHTML = "";
  const { participantes, clases, sinClase } = vcClasesDatos;
  el("textoVcClasesSin").textContent = participantes.length
    ? sinClase
      ? `⚠️ ${sinClase} de ${participantes.length} participante${participantes.length === 1 ? "" : "s"} sin clase asignada (arriba).`
      : `✅ Las ${participantes.length} participantes tienen clase.`
    : "No hay inscritas activas en esta temporada.";
  const porId = new Map(clases.map((c) => [c.id, c]));
  [...participantes].sort((a, b) => (a.clases.length ? 1 : 0) - (b.clases.length ? 1 : 0) || a.alumna.localeCompare(b.alumna, "es")).forEach((p) => {
    const t = vcCrear("details", "show-tarjeta vc-clase-tarjeta" + (p.clases.length ? "" : " vc-sin-clase"));
    const resumen = vcCrear("summary", "show-tarjeta-fila");
    const texto = vcCrear("span", "show-tarjeta-texto");
    const detalle = p.clases.length ? p.clases.map((id) => porId.get(id)).filter(Boolean).map((c) => `${c.nombre} (${c.diasTexto}, ${c.horario})`).join(" · ") : "";
    texto.append(vcCrear("span", "show-tarjeta-nombre", `${p.alumna}${p.edad !== null ? ` · ${p.edad} años` : ""}`), vcCrear("span", "tarjeta-resultado-detalle", detalle || p.modalidad));
    resumen.append(texto, vcCrear("span", "show-etiqueta " + (p.clases.length ? "show-etiqueta-si" : "show-etiqueta-no"), p.clases.length ? `${p.clases.length} clase${p.clases.length === 1 ? "" : "s"}` : "Sin clase asignada"));
    t.appendChild(resumen);
    // "Por clases": paquete, días usados y lo que debe la familia (cambia
    // al cambiar el paquete; cambiar clases ya no cambia el precio).
    if (vcClasesDatos.porClases) {
      const saldoTexto = p.montoSaldo < 0 ? `saldo a favor ${vcQ(-p.montoSaldo)}` : `saldo ${vcQ(p.montoSaldo)}${p.saldoPagado ? " (pagado)" : ""}`;
      const dias = p.diasUsados && p.diasUsados.texto ? ` · ${p.diasUsados.texto} días${p.diasUsados.pasada ? " ⚠️ se pasó" : ""}` : "";
      t.appendChild(vcCrear("p", "vc-clase-detalle", `📦 ${p.paquete.nombre || "Sin paquete"}${dias}`));
      t.appendChild(vcCrear("p", "vc-clase-detalle", `Total ${vcQ(p.montoTotal)} · reserva ${vcQ(p.montoReserva)}${p.reservaPagada ? " (pagada)" : ""} · ${saldoTexto}`));
      t.appendChild(vcFilaCambiarPaquete(p));
    }

    // Asignar / cambiar / quitar (el Worker revisa cupo y choques).
    const marcas = vcCrear("div", "vc-wa-seleccion");
    clases.forEach((c) => {
      const label = vcCrear("label", "");
      const caja = document.createElement("input");
      caja.type = "checkbox";
      caja.value = c.id;
      caja.checked = p.clases.includes(c.id);
      const lleno = c.cupo !== null && c.inscritas >= c.cupo && !caja.checked;
      const fuera = (c.edadMinima !== null && p.edad !== null && p.edad < c.edadMinima) || (c.edadMaxima !== null && p.edad !== null && p.edad > c.edadMaxima);
      const nombre = vcCrear("span", "", c.nombre);
      nombre.appendChild(vcCrear("small", "", `${c.diasTexto} · ${c.horario} · ${vcCupoTexto(c)}${lleno ? " · Lleno" : ""}${fuera ? " · no es de su edad" : ""}`));
      if (lleno) caja.disabled = true;
      label.append(caja, nombre);
      marcas.appendChild(label);
    });
    if (!clases.length) marcas.appendChild(vcCrear("p", "lista-vacia", "Primero agrega clases en ⚙️ Clases."));
    t.appendChild(marcas);
    const guardar = vcCrear("button", "btn-secundario btn-chico", "💾 Guardar clases");
    guardar.type = "button";
    const msg = vcCrear("p", "mensaje-form");
    guardar.addEventListener("click", async () => {
      guardar.disabled = true;
      msg.textContent = "Guardando...";
      msg.className = "mensaje-form";
      try {
        const r = await llamarWorker({ accion: "vcClasesAsignar", clave: claveRecepcion, inscripcionId: p.id, clasesIds: [...marcas.querySelectorAll("input:checked")].map((i) => i.value) });
        await vcClasesCargar();
        // "Por clases": el Worker dice cómo quedó lo que debe la familia.
        vcMensaje("mensajeVcClases", `✅ Clases de ${p.alumna} guardadas.${r.aviso ? " " + r.aviso : ""}`, "ok");
      } catch (e) {
        msg.textContent = e.message;
        msg.className = "mensaje-form mensaje-form-error";
        guardar.disabled = false;
      }
    });
    t.append(guardar, msg);
    cont.appendChild(t);
  });
}

// "Cambiar paquete": el Worker recalcula según lo pagado (sin pagar →
// todo nuevo; reserva pagada → total y saldo; todo pagado → solo avisa la
// diferencia) y lo deja en el historial. Se puede elegir un paquete oculto.
function vcFilaCambiarPaquete(p) {
  const fila = vcCrear("div", "show-acciones");
  const select = document.createElement("select");
  select.className = "input-texto";
  (vcClasesDatos.paquetes || []).forEach((q) => {
    const op = vcCrear("option", "", `${q.nombre} · ${vcQ(q.precio)}${q.activo ? "" : " (oculto)"}`);
    op.value = q.id;
    select.appendChild(op);
  });
  if (!p.paquete.id) {
    const op = vcCrear("option", "", "Elige un paquete");
    op.value = "";
    select.prepend(op);
  }
  select.value = p.paquete.id || "";
  const boton = vcCrear("button", "btn-secundario btn-chico", "📦 Cambiar paquete");
  boton.type = "button";
  const msg = vcCrear("p", "mensaje-form");
  boton.addEventListener("click", async () => {
    const elegido = (vcClasesDatos.paquetes || []).find((q) => q.id === select.value);
    if (!elegido || elegido.id === p.paquete.id) return;
    if (!confirm(`¿Cambiar el paquete de ${p.alumna} a «${elegido.nombre}» (${vcQ(elegido.precio)})? Se recalcula lo que debe según lo que ya pagó.`)) return;
    boton.disabled = true;
    msg.textContent = "Guardando...";
    msg.className = "mensaje-form";
    try {
      const r = await llamarWorker({ accion: "vcCambiarPaquete", clave: claveRecepcion, inscripcionId: p.id, paqueteId: elegido.id });
      await vcClasesCargar();
      vcMensaje("mensajeVcClases", `✅ Paquete de ${p.alumna}: «${elegido.nombre}».${r.aviso ? " " + r.aviso : ""}`, "ok");
    } catch (e) {
      msg.textContent = e.message;
      msg.className = "mensaje-form mensaje-form-error";
      boton.disabled = false;
    }
  });
  fila.append(select, boton);
  const envoltura = vcCrear("div", "");
  envoltura.append(fila, msg);
  return envoltura;
}

// ---------- Pestañas y selector ----------
function vcCambiarPestana(nombre) {
  vcPestana = nombre;
  document.querySelectorAll("[data-vc-pestana]").forEach((chip) => {
    chip.classList.toggle("activo", chip.dataset.vcPestana === nombre);
  });
  ["Inscritas", "Asistencia", "Config", "Nueva", "Clases", "Whatsapp"].forEach((n) => {
    el("vistaVc" + n).hidden = n !== nombre;
  });
  if (nombre === "Whatsapp") vcWaCargar();
  if (nombre === "Clases") vcClasesCargar();
}

document.querySelectorAll("[data-vc-pestana]").forEach((chip) => {
  chip.addEventListener("click", () => vcCambiarPestana(chip.dataset.vcPestana));
});

el("selectVcTemporada").addEventListener("change", () => {
  const valor = el("selectVcTemporada").value;
  if (valor === VC_OPCION_ARCHIVADOS) {
    vcConfigId = (vcDatos.temporadas.find((t) => t.estado === "Archivada") || {}).id || "";
  } else if (valor === VC_OPCION_ACTIVOS) {
    vcConfigId = ""; // el Worker elige la más reciente que no esté archivada
  } else {
    vcConfigId = valor;
  }
  vcMensaje("mensajeVc", "");
  vcCargar();
});

el("btnVcActualizarAsistencia").addEventListener("click", async () => {
  await vcCargar();
  vcMensaje("mensajeVc", "✅ Actualizado.", "ok");
});

// ==========================================
// PAGOS NUEVOS POR LINK (arriba del menú)
// ==========================================
// Los pagos por link de Paggo (mensualidades y pagos especiales) de las
// últimas 48 h con el resultado de su aviso a la academia (WhatsApp a
// cada número + correo), que el Worker guarda en "AVISO ENVIADO". Si un
// aviso falló, se ve aquí y se puede reenviar (sale como "Aviso
// atrasado"). Existe porque del 10 al 13 de octubre de 2026 los avisos
// dejaron de salir y nadie se enteró. "🧪 Probar WhatsApp" pregunta a
// Green API si la instancia está conectada y puede mandar un PRUEBA a
// uno de los números del aviso.

let cargandoPagosLink = false;

function quetzalesPagoLink(monto) {
  return "Q" + Number(monto || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaPagoLink(iso) {
  const fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return "";
  return fecha.toLocaleString("es-GT", { timeZone: "America/Guatemala", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

async function cargarPagosPorLink() {
  if (cargandoPagosLink) return;
  cargandoPagosLink = true;
  try {
    const datos = await llamarWorker({ accion: "recepcionPagosPorLink", clave: claveRecepcion });
    renderPagosPorLink(datos.pagos || []);
  } catch (e) {
    el("listaPagosLink").innerHTML = "";
    el("listaPagosLink").appendChild(crearEl("p", "lista-vacia", e.message));
  }
  cargandoPagosLink = false;
}

function renderPagosPorLink(pagos) {
  const lista = el("listaPagosLink");
  lista.innerHTML = "";
  const conProblema = pagos.filter((p) => !p.aviso.startsWith("✅"));
  el("contadorPagosLink").textContent = pagos.length ? `(${pagos.length})` : "";
  el("cajaPagosLink").classList.toggle("con-problema", conProblema.length > 0);
  if (!pagos.length) {
    lista.appendChild(crearEl("p", "lista-vacia", "Sin pagos por link en las últimas 48 horas."));
    return;
  }
  pagos.forEach((p) => {
    const fila = crearEl("div", "pago-link");
    const arriba = crearEl("div", "pago-link-arriba");
    arriba.append(crearEl("span", "pago-link-alumna", p.alumna), crearEl("strong", "pago-link-monto", quetzalesPagoLink(p.monto)));
    fila.appendChild(arriba);
    fila.appendChild(crearEl("span", "pago-link-detalle", `${p.concepto} · ${fechaPagoLink(p.fecha)}`));

    const ok = p.aviso.startsWith("✅");
    const aviso = crearEl(
      "span",
      "pago-link-aviso" + (ok ? " ok" : p.aviso ? " falla" : " sin-registro"),
      p.aviso ? p.aviso.split(" · ").slice(0, 2).join(" · ") : "Sin registro de aviso"
    );
    aviso.title = p.aviso || "Este pago no tiene registro de que se haya avisado.";
    fila.appendChild(aviso);
    if (!ok) {
      const boton = crearEl("button", "btn-secundario btn-chico", "Reenviar aviso");
      boton.type = "button";
      boton.addEventListener("click", () => reenviarAvisoPago(p, boton));
      fila.appendChild(boton);
    }
    lista.appendChild(fila);
  });
}

async function reenviarAvisoPago(pago, boton) {
  if (!window.confirm(`¿Reenviar el aviso del pago de ${pago.alumna} (${quetzalesPagoLink(pago.monto)})? Sale marcado como “Aviso atrasado”.`)) return;
  boton.disabled = true;
  boton.textContent = "Enviando...";
  try {
    const r = await llamarWorker({ accion: "recepcionReenviarAvisoPago", clave: claveRecepcion, tipo: pago.tipo, id: pago.id });
    mensajeShow("mensajePagosLink", r.todoBien ? "✅ Aviso reenviado." : `⚠️ ${r.resumen}`, r.todoBien ? "ok" : "error");
  } catch (e) {
    mensajeShow("mensajePagosLink", e.message, "error");
  }
  cargarPagosPorLink();
}

el("btnRecargarPagosLink").addEventListener("click", cargarPagosPorLink);

async function abrirPruebaWhatsapp() {
  const caja = el("cajaProbarWhatsapp");
  caja.hidden = !caja.hidden;
  if (caja.hidden) return;
  const estado = el("estadoWhatsapp");
  estado.innerHTML = "";
  estado.appendChild(crearEl("p", "lista-vacia", "Revisando..."));
  try {
    const r = await llamarWorker({ accion: "diagnosticoWhatsapp", clave: claveRecepcion });
    mostrarDiagnosticoWhatsapp(r);
    const select = el("selectPruebaWhatsapp");
    select.innerHTML = "";
    (r.destinos || []).forEach((n) => select.appendChild(new Option(`+${n.slice(0, 3)} ${n.slice(3, 7)}-${n.slice(7)}`, n)));
  } catch (e) {
    estado.innerHTML = "";
    estado.appendChild(crearEl("p", "lista-vacia", e.message));
  }
}

// Muestra la respuesta de Green API tal cual (código y texto).
function mostrarDiagnosticoWhatsapp(r) {
  const estado = el("estadoWhatsapp");
  estado.innerHTML = "";
  const [state, wa] = r.llamadas || [];
  const conectada = state && state.respuesta && state.respuesta.stateInstance === "authorized";
  estado.appendChild(
    crearEl(
      "p",
      "pagos-link-estado " + (conectada ? "ok" : "falla"),
      conectada
        ? `✅ WhatsApp conectado${wa && wa.respuesta && wa.respuesta.phone ? ` (número ${wa.respuesta.phone})` : ""}`
        : "⚠️ WhatsApp NO está conectado"
    )
  );
  const detalle = crearEl("pre", "pagos-link-respuesta");
  detalle.textContent = JSON.stringify({ host: r.host, llamadas: r.llamadas, envio: r.envio }, null, 1);
  estado.appendChild(detalle);
}

el("btnProbarWhatsapp").addEventListener("click", abrirPruebaWhatsapp);
el("btnMandarPruebaWhatsapp").addEventListener("click", async () => {
  const numero = el("selectPruebaWhatsapp").value;
  if (!numero || !window.confirm(`¿Mandar “PRUEBA – aviso de pagos MOVE” al ${numero}?`)) return;
  const boton = el("btnMandarPruebaWhatsapp");
  boton.disabled = true;
  mensajeShow("mensajePruebaWhatsapp", "Enviando...");
  try {
    const r = await llamarWorker({ accion: "diagnosticoWhatsapp", clave: claveRecepcion, enviarPrueba: true, telefono: numero });
    mostrarDiagnosticoWhatsapp(r);
    const ok = r.envio && r.envio.respuesta && r.envio.respuesta.idMessage;
    mensajeShow(
      "mensajePruebaWhatsapp",
      ok ? "✅ Green API aceptó el mensaje. Revisa que haya llegado." : `⚠️ Green API respondió ${r.envio?.status || ""}: ${JSON.stringify(r.envio?.respuesta || r.envio?.error)}`,
      ok ? "ok" : "error"
    );
  } catch (e) {
    mensajeShow("mensajePruebaWhatsapp", e.message, "error");
  }
  boton.disabled = false;
});

// Con el menú abierto se vuelve a revisar cada 2 minutos (Recepción deja
// la pantalla abierta todo el día).
setInterval(() => {
  if (claveRecepcion && !el("pantallaMenu").hidden) cargarPagosPorLink();
}, 2 * 60 * 1000);

// ---------- Ruleta de premios (academiamovedance.com/ruleta/) ----------
// Canjear códigos (tabla PREMIOS RULETA) y manejar los cupos. Los cupos
// y el nombre del evento viven en el Worker, que es el único que decide
// premios; aquí solo se ven y se cambian con la clave de Recepción.

let ruletaEstado = null; // { evento, premios: [{ id, nombre, inicial, entregados, disponibles }] }

function fechaHoraRuleta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-GT", {
    timeZone: "America/Guatemala", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function abrirRuleta() {
  el("inputRuletaCodigo").value = "";
  el("resultadoRuletaCodigo").innerHTML = "";
  ["mensajeRuletaCodigo", "mensajeRuletaCupos", "mensajeRuletaReiniciar"].forEach((id) => {
    el(id).textContent = "";
    el(id).className = "mensaje-form";
  });
  el("confirmarRuletaReiniciar").hidden = true;
  cargarRuleta();
}

async function cargarRuleta() {
  el("tablaRuletaCupos").innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    ruletaEstado = await llamarWorker({ accion: "recepcionRuletaEstado", clave: claveRecepcion });
    renderRuletaCupos();
  } catch (e) {
    el("tablaRuletaCupos").innerHTML = "";
    el("tablaRuletaCupos").appendChild(Object.assign(document.createElement("p"), { className: "lista-vacia", textContent: e.message }));
  }
}

function renderRuletaCupos() {
  el("ruletaEventoActual").textContent = `Evento actual: ${ruletaEstado.evento}`;
  const tabla = document.createElement("table");
  tabla.className = "ruleta-tabla";
  const cab = tabla.createTHead().insertRow();
  ["Premio", "Cantidad", "Entregados", "Disponibles"].forEach((t) => {
    const th = document.createElement("th");
    th.textContent = t;
    cab.appendChild(th);
  });
  const cuerpo = tabla.createTBody();
  ruletaEstado.premios.forEach((p) => {
    const fila = cuerpo.insertRow();
    fila.insertCell().textContent = p.nombre;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "9999";
    input.inputMode = "numeric";
    input.value = p.inicial;
    input.dataset.premio = p.id;
    fila.insertCell().appendChild(input);
    fila.insertCell().textContent = p.entregados;
    const disp = fila.insertCell();
    if (p.disponibles > 0) disp.textContent = p.disponibles;
    else {
      disp.textContent = "0 · YA SALIÓ ✔";
      disp.className = "ruleta-agotado";
    }
  });
  el("tablaRuletaCupos").innerHTML = "";
  el("tablaRuletaCupos").appendChild(tabla);
  if (ruletaEstado.filasPorGuardar) {
    const aviso = document.createElement("p");
    aviso.className = "pista-campo";
    aviso.textContent = `⏳ ${ruletaEstado.filasPorGuardar} giro(s) todavía guardándose en Airtable (se reintenta solo).`;
    el("tablaRuletaCupos").appendChild(aviso);
  }
}

el("btnRuletaGuardarCupos").addEventListener("click", async () => {
  const mensaje = el("mensajeRuletaCupos");
  const cupos = {};
  for (const input of el("tablaRuletaCupos").querySelectorAll("input[data-premio]")) {
    const n = Number(input.value);
    if (input.value === "" || !Number.isInteger(n) || n < 0) {
      mensaje.textContent = "Las cantidades deben ser números enteros (0 o más).";
      mensaje.className = "mensaje-form mensaje-form-error";
      return;
    }
    cupos[input.dataset.premio] = n;
  }
  mensaje.textContent = "Guardando...";
  mensaje.className = "mensaje-form";
  try {
    ruletaEstado = await llamarWorker({ accion: "recepcionRuletaGuardarCupos", clave: claveRecepcion, cupos });
    renderRuletaCupos();
    mensaje.textContent = "✅ Cantidades guardadas. La ruleta las toma en menos de un minuto.";
    mensaje.className = "mensaje-form mensaje-form-ok";
  } catch (e) {
    mensaje.textContent = e.message;
    mensaje.className = "mensaje-form mensaje-form-error";
  }
});

el("btnRuletaReiniciar").addEventListener("click", () => {
  const mensaje = el("mensajeRuletaReiniciar");
  if (!el("inputRuletaEvento").value.trim()) {
    mensaje.textContent = "Escribe el nombre del evento nuevo (puede ser el mismo).";
    mensaje.className = "mensaje-form mensaje-form-error";
    return;
  }
  mensaje.textContent = "";
  el("confirmarRuletaReiniciar").hidden = false;
});
el("btnRuletaReiniciarNo").addEventListener("click", () => (el("confirmarRuletaReiniciar").hidden = true));
el("btnRuletaReiniciarSi").addEventListener("click", async () => {
  el("confirmarRuletaReiniciar").hidden = true;
  const mensaje = el("mensajeRuletaReiniciar");
  mensaje.textContent = "Reiniciando...";
  mensaje.className = "mensaje-form";
  try {
    ruletaEstado = await llamarWorker({ accion: "recepcionRuletaReiniciar", clave: claveRecepcion, evento: el("inputRuletaEvento").value });
    renderRuletaCupos();
    el("inputRuletaEvento").value = "";
    mensaje.textContent = `✅ Ruleta reiniciada. Evento: ${ruletaEstado.evento}. Todos los premios están disponibles otra vez.`;
    mensaje.className = "mensaje-form mensaje-form-ok";
  } catch (e) {
    mensaje.textContent = e.message;
    mensaje.className = "mensaje-form mensaje-form-error";
  }
});

function renderPremioRuleta(r) {
  const cont = el("resultadoRuletaCodigo");
  cont.innerHTML = "";
  const caja = document.createElement("div");
  caja.className = "ruleta-tarjeta" + (r.canjeado ? " canjeado" : "");
  const linea = (texto, clase = "ruleta-tarjeta-linea") => {
    const d = document.createElement("div");
    d.className = clase;
    d.textContent = texto;
    caja.appendChild(d);
  };
  linea(`${r.codigo} · ${r.premio}`, "ruleta-tarjeta-premio");
  linea(`👧 ${r.nombreNina}${r.edad ? ` (${r.edad})` : ""}`);
  if (r.adulto) linea(`👤 ${r.adulto}`);
  linea(`📱 ${r.whatsapp}`);
  linea(`🎡 ${r.evento} · ${fechaHoraRuleta(r.fecha)}`);
  if (r.canjeado) {
    linea(`✅ Ya canjeado${r.canjeadoFecha ? ` el ${fechaHoraRuleta(r.canjeadoFecha)}` : ""}`, "ruleta-tarjeta-estado");
  } else {
    linea("Sin canjear", "ruleta-tarjeta-estado");
    const confirmar = document.createElement("div");
    confirmar.className = "ruleta-confirmar";
    confirmar.hidden = true;
    const pregunta = document.createElement("p");
    pregunta.textContent = `¿Marcar ${r.codigo} como canjeado? Ya no se podrá volver a usar.`;
    const botones = document.createElement("div");
    botones.className = "ruleta-confirmar-botones";
    const si = Object.assign(document.createElement("button"), { type: "button", className: "btn-secundario btn-chico", textContent: "Sí, canjear" });
    const no = Object.assign(document.createElement("button"), { type: "button", className: "btn-secundario btn-chico", textContent: "Cancelar" });
    botones.append(si, no);
    confirmar.append(pregunta, botones);
    const boton = Object.assign(document.createElement("button"), { type: "button", className: "btn-grande btn-siguiente", textContent: "✅ Marcar como canjeado" });
    boton.addEventListener("click", () => {
      boton.hidden = true;
      confirmar.hidden = false;
    });
    no.addEventListener("click", () => {
      boton.hidden = false;
      confirmar.hidden = true;
    });
    si.addEventListener("click", () => canjearRuleta(r.codigo));
    caja.append(boton, confirmar);
  }
  cont.appendChild(caja);
}

async function buscarCodigoRuleta() {
  const mensaje = el("mensajeRuletaCodigo");
  const codigo = el("inputRuletaCodigo").value.trim();
  el("resultadoRuletaCodigo").innerHTML = "";
  if (!codigo) return;
  mensaje.textContent = "Buscando...";
  mensaje.className = "mensaje-form";
  try {
    const r = await llamarWorker({ accion: "recepcionRuletaBuscarCodigo", clave: claveRecepcion, codigo });
    if (!r.encontrado) {
      mensaje.textContent = `No existe el código ${r.codigo}. Revisa que esté bien escrito.`;
      mensaje.className = "mensaje-form mensaje-form-error";
      return;
    }
    mensaje.textContent = "";
    renderPremioRuleta(r);
  } catch (e) {
    mensaje.textContent = e.message;
    mensaje.className = "mensaje-form mensaje-form-error";
  }
}

async function canjearRuleta(codigo) {
  const mensaje = el("mensajeRuletaCodigo");
  mensaje.textContent = "Guardando...";
  mensaje.className = "mensaje-form";
  try {
    const r = await llamarWorker({ accion: "recepcionRuletaCanjear", clave: claveRecepcion, codigo });
    renderPremioRuleta(r);
    mensaje.textContent = "✅ Código canjeado.";
    mensaje.className = "mensaje-form mensaje-form-ok";
  } catch (e) {
    mensaje.textContent = e.message;
    mensaje.className = "mensaje-form mensaje-form-error";
  }
}

el("btnRuletaBuscar").addEventListener("click", buscarCodigoRuleta);
el("inputRuletaCodigo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarCodigoRuleta();
});
el("btnVolverRuleta").addEventListener("click", () => mostrarPantalla("pantallaMenu"));

// ---------- Amonestaciones maestras ----------
// Llamadas de atención y amonestaciones escritas a maestras (tabla
// AMONESTACIONES). Solo Recepción crea, edita y elimina; la lista es la
// del año en curso (el Worker filtra por el campo AÑO, en hora de
// Guatemala). Cada maestra ve solo las suyas en amonestaciones.html.
// En enero sale "Respaldo del año anterior" (CSV + PDF armados aquí con
// los datos del Worker): es el respaldo permanente, porque el 1 de
// febrero el Worker las borra de Airtable. Todo el texto va con
// textContent / .value, nunca innerHTML.

let amonDatos = null; // { anio, respaldoDisponible, maestras, amonestaciones }
let amonEditandoId = "";

function fechaHoraAmon(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-GT", {
    timeZone: "America/Guatemala", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function mensajeAmon(id, texto, tipo) {
  el(id).textContent = texto;
  el(id).className = "mensaje-form" + (tipo ? ` mensaje-form-${tipo}` : "");
}

function opcionAmon(valor, texto) {
  const o = document.createElement("option");
  o.value = valor;
  o.textContent = texto;
  return o;
}

function abrirAmonestaciones() {
  limpiarFormAmonestacion();
  mensajeAmon("mensajeAmonestacion", "");
  mensajeAmon("mensajeRespaldoAmonestaciones", "");
  el("selectAmonFiltro").value = "";
  cargarAmonestaciones();
}

function limpiarFormAmonestacion() {
  amonEditandoId = "";
  el("selectAmonMaestra").value = "";
  el("selectAmonTipo").value = "";
  el("inputAmonMotivo").value = "";
  el("inputAmonDescripcion").value = "";
  el("tituloFormAmonestacion").textContent = "Nueva amonestación";
  el("pistaEdicionAmonestacion").hidden = true;
  el("btnCancelarEdicionAmonestacion").hidden = true;
}

async function cargarAmonestaciones() {
  const lista = el("listaAmonestaciones");
  lista.innerHTML = '<p class="lista-vacia">Cargando...</p>';
  try {
    amonDatos = await llamarWorker({
      accion: "recepcionAmonestacionesListar",
      clave: claveRecepcion,
      maestraId: el("selectAmonFiltro").value,
    });
    renderSelectsAmon();
    renderListaAmon();
    el("cajaRespaldoAmonestaciones").hidden = !amonDatos.respaldoDisponible;
    el("tituloListaAmonestaciones").textContent = `Amonestaciones ${amonDatos.anio}`;
  } catch (e) {
    lista.innerHTML = "";
    lista.appendChild(Object.assign(document.createElement("p"), { className: "lista-vacia", textContent: e.message }));
  }
}

function renderSelectsAmon() {
  const formValor = el("selectAmonMaestra").value;
  const filtroValor = el("selectAmonFiltro").value;
  const form = el("selectAmonMaestra");
  const filtro = el("selectAmonFiltro");
  form.innerHTML = "";
  filtro.innerHTML = "";
  form.appendChild(opcionAmon("", "Elige la maestra..."));
  filtro.appendChild(opcionAmon("", "Todas las maestras"));
  amonDatos.maestras.forEach((m) => {
    if (m.activa) form.appendChild(opcionAmon(m.id, m.nombre));
    filtro.appendChild(opcionAmon(m.id, m.activa ? m.nombre : `${m.nombre} (inactiva)`));
  });
  form.value = formValor;
  filtro.value = filtroValor;
}

function renderListaAmon() {
  const lista = el("listaAmonestaciones");
  lista.innerHTML = "";
  if (!amonDatos.amonestaciones.length) {
    lista.appendChild(Object.assign(document.createElement("p"), { className: "lista-vacia", textContent: "No hay amonestaciones este año." }));
    return;
  }
  amonDatos.amonestaciones.forEach((a) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "amon-tarjeta" + (a.tipo === "Amonestación escrita" ? " amon-escrita" : "");

    const cab = document.createElement("div");
    cab.className = "amon-cabecera";
    cab.appendChild(Object.assign(document.createElement("span"), { className: "amon-maestra", textContent: a.maestra }));
    cab.appendChild(Object.assign(document.createElement("span"), { className: "amon-tipo", textContent: a.tipo }));
    tarjeta.appendChild(cab);

    tarjeta.appendChild(Object.assign(document.createElement("p"), { className: "amon-motivo", textContent: a.motivo }));
    tarjeta.appendChild(Object.assign(document.createElement("p"), { className: "amon-descripcion", textContent: a.descripcion }));
    tarjeta.appendChild(Object.assign(document.createElement("p"), {
      className: "amon-meta",
      textContent: `${fechaHoraAmon(a.fecha)}${a.registradaPor ? ` · Registró: ${a.registradaPor}` : ""}`,
    }));
    tarjeta.appendChild(Object.assign(document.createElement("p"), {
      className: "amon-lectura" + (a.leida ? " amon-leida" : ""),
      textContent: a.leida ? `✅ Leída el ${fechaHoraAmon(a.fechaLectura)}` : "⏳ Sin leer",
    }));

    const botones = document.createElement("div");
    botones.className = "ruleta-confirmar-botones";
    const editar = Object.assign(document.createElement("button"), { type: "button", className: "btn-secundario btn-chico", textContent: "✏️ Editar" });
    editar.addEventListener("click", () => editarAmonestacion(a));
    const eliminar = Object.assign(document.createElement("button"), { type: "button", className: "btn-secundario btn-chico show-btn-peligro", textContent: "🗑️ Eliminar" });
    botones.append(editar, eliminar);
    tarjeta.appendChild(botones);

    // Confirmación dentro de la página (sin confirm(), como la ruleta).
    const confirmar = document.createElement("div");
    confirmar.className = "ruleta-confirmar";
    confirmar.hidden = true;
    confirmar.appendChild(Object.assign(document.createElement("p"), { innerHTML: "<b>¿Eliminar esta amonestación? No se puede deshacer.</b>" }));
    const filaSiNo = document.createElement("div");
    filaSiNo.className = "ruleta-confirmar-botones";
    const si = Object.assign(document.createElement("button"), { type: "button", className: "btn-secundario btn-chico show-btn-peligro", textContent: "Sí, eliminar" });
    const no = Object.assign(document.createElement("button"), { type: "button", className: "btn-secundario btn-chico", textContent: "Cancelar" });
    filaSiNo.append(si, no);
    confirmar.appendChild(filaSiNo);
    const msg = Object.assign(document.createElement("p"), { className: "mensaje-form" });
    confirmar.appendChild(msg);
    tarjeta.appendChild(confirmar);

    eliminar.addEventListener("click", () => { confirmar.hidden = false; });
    no.addEventListener("click", () => { confirmar.hidden = true; });
    si.addEventListener("click", async () => {
      si.disabled = true;
      msg.textContent = "Eliminando...";
      msg.className = "mensaje-form";
      try {
        await llamarWorker({ accion: "recepcionAmonestacionEliminar", clave: claveRecepcion, id: a.id });
        if (amonEditandoId === a.id) limpiarFormAmonestacion();
        await cargarAmonestaciones();
      } catch (e) {
        si.disabled = false;
        msg.textContent = e.message;
        msg.className = "mensaje-form mensaje-form-error";
      }
    });

    lista.appendChild(tarjeta);
  });
}

function editarAmonestacion(a) {
  amonEditandoId = a.id;
  // Una maestra inactiva no está en el formulario: se agrega solo para editar la suya.
  if (![...el("selectAmonMaestra").options].some((o) => o.value === a.maestraId)) {
    el("selectAmonMaestra").appendChild(opcionAmon(a.maestraId, `${a.maestra} (inactiva)`));
  }
  el("selectAmonMaestra").value = a.maestraId;
  el("selectAmonTipo").value = a.tipo;
  el("inputAmonMotivo").value = a.motivo;
  el("inputAmonDescripcion").value = a.descripcion;
  el("inputAmonRegistradaPor").value = a.registradaPor;
  el("tituloFormAmonestacion").textContent = "Editar amonestación";
  el("pistaEdicionAmonestacion").hidden = !a.leida;
  el("btnCancelarEdicionAmonestacion").hidden = false;
  mensajeAmon("mensajeAmonestacion", "");
  el("tituloFormAmonestacion").scrollIntoView({ behavior: "smooth", block: "start" });
}

el("btnCancelarEdicionAmonestacion").addEventListener("click", () => {
  limpiarFormAmonestacion();
  mensajeAmon("mensajeAmonestacion", "");
});

el("btnGuardarAmonestacion").addEventListener("click", async () => {
  const datos = {
    maestraId: el("selectAmonMaestra").value,
    tipo: el("selectAmonTipo").value,
    motivo: el("inputAmonMotivo").value.trim(),
    descripcion: el("inputAmonDescripcion").value.trim(),
    registradaPor: el("inputAmonRegistradaPor").value.trim(),
  };
  if (!datos.maestraId) return mensajeAmon("mensajeAmonestacion", "Elige la maestra.", "error");
  if (!datos.tipo) return mensajeAmon("mensajeAmonestacion", "Elige el tipo.", "error");
  if (!datos.motivo) return mensajeAmon("mensajeAmonestacion", "Escribe el motivo.", "error");
  if (!datos.descripcion) return mensajeAmon("mensajeAmonestacion", "Escribe la descripción.", "error");
  if (!datos.registradaPor) return mensajeAmon("mensajeAmonestacion", "Escribe tu nombre en “Registrada por”.", "error");

  const boton = el("btnGuardarAmonestacion");
  boton.disabled = true;
  mensajeAmon("mensajeAmonestacion", "Guardando...");
  try {
    const r = await llamarWorker({ accion: "recepcionAmonestacionGuardar", clave: claveRecepcion, id: amonEditandoId || undefined, ...datos });
    const texto = r.creada
      ? "✅ Guardada. A la maestra le llega una notificación."
      : r.vuelveASinLeer
        ? "✅ Cambios guardados. Vuelve a “sin leer” y a la maestra le llega otra notificación."
        : "✅ Cambios guardados.";
    limpiarFormAmonestacion();
    mensajeAmon("mensajeAmonestacion", texto, "ok");
    await cargarAmonestaciones();
  } catch (e) {
    mensajeAmon("mensajeAmonestacion", e.message, "error");
  } finally {
    boton.disabled = false;
  }
});

el("selectAmonFiltro").addEventListener("change", cargarAmonestaciones);

// --- Respaldo del año anterior (solo en enero) ---

async function pedirRespaldoAmon() {
  mensajeAmon("mensajeRespaldoAmonestaciones", "Preparando el archivo...");
  const r = await llamarWorker({ accion: "recepcionAmonestacionesRespaldo", clave: claveRecepcion });
  if (!r.amonestaciones.length) throw new Error(`No hay amonestaciones de ${r.anio}.`);
  return r;
}

function descargarArchivoAmon(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Excel ejecuta como fórmula una celda que empieza con = + - @ (o
// tabulador / retorno): se le antepone un apóstrofo.
function celdaCsvAmon(valor) {
  let t = String(valor ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
}

const COLUMNAS_RESPALDO_AMON = ["Maestra", "Fecha y hora", "Tipo", "Motivo", "Descripción", "Registrada por", "Leída", "Fecha de lectura"];

function filaRespaldoAmon(a) {
  return [a.maestra, fechaHoraAmon(a.fecha), a.tipo, a.motivo, a.descripcion, a.registradaPor, a.leida ? "Sí" : "No", fechaHoraAmon(a.fechaLectura)];
}

// El BOM al inicio es para que Excel lea bien las tildes.
function armarCsvAmon(r) {
  const lineas = [COLUMNAS_RESPALDO_AMON, ...r.amonestaciones.map(filaRespaldoAmon)].map((f) => f.map(celdaCsvAmon).join(","));
  return "\uFEFF" + lineas.join("\r\n");
}

el("btnRespaldoAmonExcel").addEventListener("click", async () => {
  try {
    const r = await pedirRespaldoAmon();
    descargarArchivoAmon(new Blob([armarCsvAmon(r)], { type: "text/csv;charset=utf-8" }), `amonestaciones-${r.anio}.csv`);
    mensajeAmon("mensajeRespaldoAmonestaciones", `✅ Descargado: ${r.amonestaciones.length} amonestaciones de ${r.anio}.`, "ok");
  } catch (e) {
    mensajeAmon("mensajeRespaldoAmonestaciones", e.message, "error");
  }
});

// jsPDF se carga solo cuando se pide el PDF (una vez al año).
function cargarScriptAmon(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar el generador de PDF. Revisa el internet."));
    document.head.appendChild(s);
  });
}

async function asegurarJsPdf() {
  if (!window.jspdf) await cargarScriptAmon("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  const { jsPDF } = window.jspdf;
  if (!jsPDF.API.autoTable) await cargarScriptAmon("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  return jsPDF;
}

// La letra estándar del PDF no tiene emojis ni letras fuera del alfabeto
// latino: se quitan para que no salgan símbolos raros.
function textoPdfAmon(t) {
  return String(t ?? "").replace(/[^\n\u0020-\u00FF]/g, "");
}

function armarPdfAmon(jsPDF, r) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  doc.setFontSize(16);
  doc.text(textoPdfAmon(`MOVE Dance Academy - Amonestaciones a maestras ${r.anio}`), 40, 40);
  doc.setFontSize(9);
  doc.text(textoPdfAmon(`Respaldo descargado el ${fechaHoraAmon(new Date().toISOString())} (hora de Guatemala). Total: ${r.amonestaciones.length}.`), 40, 56);

  const porMaestra = new Map();
  r.amonestaciones.forEach((a) => {
    if (!porMaestra.has(a.maestra)) porMaestra.set(a.maestra, []);
    porMaestra.get(a.maestra).push(a);
  });
  let y = 76;
  for (const [maestra, lista] of porMaestra) {
    if (y > 520) {
      doc.addPage();
      y = 40;
    }
    doc.setFontSize(12);
    doc.text(textoPdfAmon(`${maestra} (${lista.length})`), 40, y);
    doc.autoTable({
      startY: y + 6,
      head: [COLUMNAS_RESPALDO_AMON.slice(1).map(textoPdfAmon)],
      body: lista.map((a) => filaRespaldoAmon(a).slice(1).map(textoPdfAmon)),
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [239, 75, 155] },
      // Anchos fijos (suman los 712 pt útiles de carta horizontal) para
      // que las tablas de todas las maestras queden alineadas.
      columnStyles: {
        0: { cellWidth: 100 }, 1: { cellWidth: 92 }, 2: { cellWidth: 95 }, 3: { cellWidth: 220 },
        4: { cellWidth: 70 }, 5: { cellWidth: 35 }, 6: { cellWidth: 100 },
      },
      margin: { left: 40, right: 40 },
    });
    y = doc.lastAutoTable.finalY + 24;
  }
  return doc;
}

el("btnRespaldoAmonPdf").addEventListener("click", async () => {
  try {
    const r = await pedirRespaldoAmon();
    const doc = armarPdfAmon(await asegurarJsPdf(), r);
    doc.save(`amonestaciones-${r.anio}.pdf`);
    mensajeAmon("mensajeRespaldoAmonestaciones", `✅ PDF descargado: ${r.amonestaciones.length} amonestaciones de ${r.anio}.`, "ok");
  } catch (e) {
    mensajeAmon("mensajeRespaldoAmonestaciones", e.message, "error");
  }
});
