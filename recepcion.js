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

function renderSolicitudes() {
  // Solo interesan a Recepción los mensajes que escribió una
  // maestra — sus propias respuestas no aparecen aquí como tarjetas.
  const deMaestras = mensajesActuales.filter((m) => m.autor === "Maestra");
  const pendientes = deMaestras.filter((m) => !m.atendido);
  const atendidas = deMaestras.filter((m) => m.atendido);

  const contPendientes = el("listaPendientes");
  contPendientes.innerHTML = "";
  if (!pendientes.length) {
    contPendientes.innerHTML = '<p class="lista-vacia">No hay solicitudes pendientes por ahora. 🎉</p>';
  } else {
    pendientes.forEach((m) => contPendientes.appendChild(crearTarjeta(m, true)));
  }

  const tituloAtendidas = el("tituloAtendidas");
  const contAtendidas = el("listaAtendidas");
  contAtendidas.innerHTML = "";
  if (atendidas.length) {
    tituloAtendidas.hidden = false;
    atendidas
      .slice()
      .reverse()
      .forEach((m) => contAtendidas.appendChild(crearTarjeta(m, false)));
  } else {
    tituloAtendidas.hidden = true;
  }

  if (pendientes.length) {
    iniciarAlarma();
  } else {
    detenerAlarma();
  }
}

function crearTarjeta(m, pendiente) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "tarjeta-solicitud " + (pendiente ? "pendiente" : "atendida");

  const grupo = document.createElement("p");
  grupo.className = "tarjeta-solicitud-grupo";
  grupo.textContent = "🩰 " + (m.grupo || "Sin grupo");
  tarjeta.appendChild(grupo);

  const texto = document.createElement("p");
  texto.className = "tarjeta-solicitud-texto";
  texto.textContent = m.mensaje;
  tarjeta.appendChild(texto);

  const hora = document.createElement("p");
  hora.className = "tarjeta-solicitud-hora";
  hora.textContent = formatearHora(m.fecha);
  tarjeta.appendChild(hora);

  if (pendiente) {
    const boton = document.createElement("button");
    boton.className = "btn-atender";
    boton.type = "button";
    boton.textContent = "✅ Marcar como atendido";
    boton.addEventListener("click", () => marcarAtendido(m.id, boton));
    tarjeta.appendChild(boton);
  } else {
    const etiqueta = document.createElement("span");
    etiqueta.className = "etiqueta-atendida";
    etiqueta.textContent = "Atendido";
    tarjeta.appendChild(etiqueta);
  }

  return tarjeta;
}

async function marcarAtendido(id, boton) {
  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    await llamarWorker({ accion: "marcarMensajeRecepcionAtendido", id });
    await cargarMensajes();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = "✅ Marcar como atendido";
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
