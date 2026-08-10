// ==========================================
// MOVE — RECEPCIÓN
// MOVE Dance Academy
// ==========================================
// Pantalla para dejar abierta en la tablet/computadora de Recepción.
// Muestra las solicitudes que las maestras mandan desde el Panel de
// Clase (ej. "necesito que un papá suba a llevar a una alumna al
// baño") y hace sonar una alarma fuerte + vibración hasta que se
// marquen como atendidas — así, aunque Recepción esté en otro piso
// de atención al público, no se le pasa un aviso.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let claveRecepcion = "";
let mensajesActuales = [];
let pollIntervalo = null;
let alarmaIntervalo = null;
let audioCtx = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaRecepcion"].forEach((p) => {
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

document.addEventListener(
  "pointerdown",
  () => {
    if (!el("pantallaRecepcion").hidden) asegurarAudioCtx();
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
    mostrarPantalla("pantallaRecepcion");
    await cargarMensajes();
    iniciarAutoRefresco();
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

el("btnSalirRecepcion").addEventListener("click", () => {
  detenerAutoRefresco();
  detenerAlarma();
  claveRecepcion = "";
  mensajesActuales = [];
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
    el("mensajeErrorLogin").textContent = "";
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
