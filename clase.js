// ==========================================
// MOVE — PANEL DE CLASE (para maestras)
// MOVE Dance Academy
// ==========================================
// Pensado para usarse en la tablet/celular de la maestra durante su
// propia clase. Habla con el mismo Worker que el resto del portal —
// nunca guarda datos sensibles aquí. La RACHA, la ruleta y las
// reacciones son solo de esta sesión (no se guardan en Airtable):
// sirven para gamificar el momento, no para llevar un historial
// permanente.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let maestraId = "";
let nombreMaestra = "";
let gruposMaestra = [];
let grupoActual = null;
let alumnasPanel = []; // lo que devuelve panelClase: [{id, nombre, cumpleanos, presente}]
let objetivoMensualActual = ""; // el único objetivo que existe — es el que se ve en el portal de papás
let ultimaNotaActual = null; // { fecha, nota } o null
let racha = 0; // contador de reacciones de la clase actual
let reaccionesConteo = {}; // { emoji: cantidad } — para el detalle del Cierre

// La racha y las reacciones se respaldan en localStorage (por grupo y por
// día) para que, si la maestra sale de la página, se le cierra la app o
// pierde la conexión un momento, no pierda lo que ya llevaba marcado —
// solo se borran cuando ella misma toca "Reiniciar racha" en el Cierre.

let intervaloBienvenida = null;

// ---------- recuperar clave (pantalla de login, antes de entrar) ----------
let maestrasParaRecuperar = [];
let maestraSeleccionadaRecuperar = null;

// ---------- cronómetro ----------
let cronIntervalo = null;
let cronSegundosTotal = 60;
let cronSegundosRestantes = 60;
let cronAlarmaIntervalo = null; // repite el beep hasta que se pause/reinicie

// ---------- ruleta ----------
let ruletaIntervalo = null;
let ruletaGirando = false;

// ---------- audio ----------
let audioCtx = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaGrupos", "pantallaPanel"].forEach((p) => {
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

// ---------- audio: contexto único, "desbloqueado" durante un toque real ----------

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

// Cualquier toque en la pantalla del panel "desbloquea" el audio, para que
// el beep del cronómetro (que suena desde un setInterval, no desde un toque
// directo) sí se escuche en navegadores como Safari/iOS.
document.addEventListener(
  "pointerdown",
  () => {
    if (!el("pantallaPanel").hidden) asegurarAudioCtx();
  },
  { passive: true }
);

// ---------- login ----------

el("btnEntrarMaestra").addEventListener("click", entrarMaestra);
el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarMaestra();
});

async function entrarMaestra() {
  const clave = el("inputClaveMaestra").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  mensajeError.textContent = "";

  if (!clave) {
    mensajeError.textContent = "Escribe tu clave.";
    return;
  }

  const boton = el("btnEntrarMaestra");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Entrando...";

  try {
    const datos = await llamarWorker({ accion: "maestraEntrar", clave });
    maestraId = datos.maestraId;
    nombreMaestra = datos.nombre || "Maestra";
    await cargarGrupos();
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ---------- recuperar clave (pantalla de login) ----------

el("btnMostrarRecuperarMaestra").addEventListener("click", mostrarBloqueRecuperarMaestra);
el("buscarRecuperarMaestra").addEventListener("input", (e) => renderListaRecuperarMaestra(e.target.value));
el("btnEnviarRecuperarMaestra").addEventListener("click", enviarRecuperarMaestra);

async function mostrarBloqueRecuperarMaestra() {
  const bloque = el("bloqueRecuperarMaestra");
  const yaAbierto = !bloque.hidden;
  bloque.hidden = yaAbierto;
  el("mensajeErrorLogin").textContent = "";
  el("mensajeRecuperarMaestra").hidden = true;

  if (yaAbierto) return;

  el("buscarRecuperarMaestra").value = "";
  el("listaRecuperarMaestra").innerHTML = "";
  el("bloqueConfirmarRecuperarMaestra").hidden = true;
  maestraSeleccionadaRecuperar = null;

  if (maestrasParaRecuperar.length) return;

  try {
    const datos = await llamarWorker({ accion: "maestrasActivas" });
    maestrasParaRecuperar = datos.maestras || [];
  } catch (e) {
    el("mensajeErrorLogin").textContent = e.message;
  }
}

function renderListaRecuperarMaestra(filtro) {
  const cont = el("listaRecuperarMaestra");
  cont.innerHTML = "";
  const texto = (filtro || "").trim().toLowerCase();

  if (!texto) {
    return;
  }

  const filtradas = maestrasParaRecuperar.filter((m) => m.nombre.toLowerCase().includes(texto));

  if (!filtradas.length) {
    const aviso = document.createElement("p");
    aviso.className = "lista-alumnas-aviso";
    aviso.textContent = "No encontramos ese nombre.";
    cont.appendChild(aviso);
    return;
  }

  filtradas.slice(0, 30).forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = m.nombre;
    btn.addEventListener("click", () => seleccionarRecuperarMaestra(m));
    cont.appendChild(btn);
  });
}

function seleccionarRecuperarMaestra(m) {
  maestraSeleccionadaRecuperar = m;
  el("nombreRecuperarMaestraElegida").textContent = m.nombre;
  el("buscarRecuperarMaestra").value = "";
  el("listaRecuperarMaestra").innerHTML = "";
  el("bloqueConfirmarRecuperarMaestra").hidden = false;
  el("mensajeRecuperarMaestra").hidden = true;
}

async function enviarRecuperarMaestra() {
  if (!maestraSeleccionadaRecuperar) return;
  const btn = el("btnEnviarRecuperarMaestra");
  const msg = el("mensajeRecuperarMaestra");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";
  msg.hidden = true;
  el("mensajeErrorLogin").textContent = "";

  try {
    const datos = await llamarWorker({
      accion: "maestraRecuperarClave",
      maestraId: maestraSeleccionadaRecuperar.id,
    });
    msg.textContent =
      "✅ Te enviamos tu clave por WhatsApp al número terminado en " +
      (datos.ultimosDigitos || "****") +
      ".";
    msg.hidden = false;
  } catch (e) {
    el("mensajeErrorLogin").textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- elegir grupo ----------

async function cargarGrupos() {
  const mensajeError = el("mensajeErrorGrupos");
  mensajeError.textContent = "";
  mostrarPantalla("pantallaGrupos");
  el("listaGrupos").innerHTML = '<p class="lista-alumnas-aviso">Cargando tus grupos...</p>';

  try {
    const datos = await llamarWorker({ accion: "gruposDeMaestra", maestraId });
    gruposMaestra = datos.grupos || [];
    renderGrupos();
  } catch (e) {
    mensajeError.textContent = e.message;
    el("listaGrupos").innerHTML = "";
  }
}

function renderGrupos() {
  const cont = el("listaGrupos");
  cont.innerHTML = "";

  if (!gruposMaestra.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Todavía no tienes grupos asignados como maestra principal.</p>';
    return;
  }

  gruposMaestra.forEach((g) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-grupo";
    btn.innerHTML =
      `<span class="btn-grupo-nombre">${g.nombre}</span>` +
      `<span class="btn-grupo-detalle">${g.estilo || ""}${g.estilo ? " · " : ""}${g.totalAlumnas} alumna(s)</span>`;
    btn.addEventListener("click", () => abrirPanel(g));
    cont.appendChild(btn);
  });
}

// ---------- respaldo de racha/reacciones en localStorage ----------

function claveRachaStorage(grupoId) {
  return "move_racha_" + grupoId;
}

function fechaHoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Guarda el estado actual de racha/reacciones del grupo que está abierto.
// Si el navegador bloquea localStorage (modo privado, etc.) la app sigue
// funcionando normal, solo sin este respaldo.
function guardarRachaStorage() {
  if (!grupoActual) return;
  try {
    localStorage.setItem(
      claveRachaStorage(grupoActual.id),
      JSON.stringify({ fecha: fechaHoyStr(), racha, reacciones: reaccionesConteo })
    );
  } catch (e) {}
}

// Recupera lo guardado para ese grupo, pero solo si es de HOY — así una
// racha vieja de la última vez que se dio esa clase no se mezcla con la
// de hoy.
function cargarRachaStorage(grupoId) {
  try {
    const guardado = localStorage.getItem(claveRachaStorage(grupoId));
    if (!guardado) return { racha: 0, reacciones: {} };
    const datos = JSON.parse(guardado);
    if (!datos || datos.fecha !== fechaHoyStr()) return { racha: 0, reacciones: {} };
    return { racha: datos.racha || 0, reacciones: datos.reacciones || {} };
  } catch (e) {
    return { racha: 0, reacciones: {} };
  }
}

function borrarRachaStorage(grupoId) {
  try {
    localStorage.removeItem(claveRachaStorage(grupoId));
  } catch (e) {}
}

// ---------- panel de clase ----------

async function abrirPanel(grupo) {
  grupoActual = grupo;
  const rachaGuardada = cargarRachaStorage(grupo.id);
  racha = rachaGuardada.racha;
  reaccionesConteo = rachaGuardada.reacciones;
  objetivoMensualActual = "";
  ultimaNotaActual = null;
  el("inputNotaClase").value = "";
  el("inputObjetivoMensualCierre").value = "";
  el("mensajeBitacora").hidden = true;
  detenerCronometro();
  detenerAlarma();
  poblarSelectorMinutos();
  cronSegundosTotal = 60;
  cronSegundosRestantes = 60;
  el("selectorMinutos").value = "60";
  el("selectorMinutos").disabled = false;
  el("cronometroNumero").classList.remove("cronometro-terminado");
  actualizarPantallaCronometro();
  reiniciarRuletaVisual();
  actualizarRacha();

  el("nombreGrupoPanel").textContent = grupo.nombre;
  renderSaludoBienvenida(grupo);
  mostrarPantalla("pantallaPanel");
  cambiarTab("Bienvenida");

  await cargarPanelClase();
  iniciarAutoRefrescoBienvenida();
}

async function cargarPanelClase() {
  try {
    const datos = await llamarWorker({ accion: "panelClase", grupoId: grupoActual.id });
    alumnasPanel = datos.alumnas || [];
    objetivoMensualActual = datos.objetivoMensual || "";
    ultimaNotaActual = datos.ultimaNota || null;
    renderBienvenida();
    renderObjetivoYNota();
  } catch (e) {
    el("contadorLlegadas").textContent = "No se pudo cargar: " + e.message;
  }
}

function formatearFechaCorta(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-GT", { day: "numeric", month: "short" });
  } catch (e) {
    return "";
  }
}

function renderObjetivoYNota() {
  el("objetivoMensualTexto").textContent =
    objetivoMensualActual || "Todavía no hay un objetivo de este mes.";

  // Precargamos el campo de edición del Cierre con el valor actual,
  // para que la maestra pueda corregirlo directamente (o borrarlo por
  // completo dejándolo en blanco) en vez de escribirlo desde cero
  // cada vez.
  el("inputObjetivoMensualCierre").value = objetivoMensualActual;

  const tarjetaNota = el("tarjetaUltimaNota");
  if (ultimaNotaActual && ultimaNotaActual.nota) {
    tarjetaNota.hidden = false;
    el("ultimaNotaFecha").textContent = formatearFechaCorta(ultimaNotaActual.fecha);
    el("ultimaNotaTexto").textContent = ultimaNotaActual.nota;
  } else {
    tarjetaNota.hidden = true;
  }
}

// Saludo cálido de la pestaña Bienvenida: cambia según la hora del día
// y muestra el nombre de la maestra y el grupo, para que la pantalla
// se sienta más amena y menos como una lista fría de datos.
const FRASES_BIENVENIDA = [
  "Hoy es un buen día para brillar en la pista. ✨",
  "Que la energía de hoy se sienta en cada paso. 💃",
  "Cada clase suma — vamos con todo hoy. 🔥",
  "Respira, sonríe, y que empiece la magia. 🎶",
  "Hoy toca disfrutar y que ellas también lo sientan. 🩰",
  "Un paso a la vez, hoy también se avanza. 👣",
  "Que se note la buena vibra desde que entran. 🌸",
];

function renderSaludoBienvenida(grupo) {
  const ahora = new Date();
  const hora = ahora.getHours();
  const saludoHora = hora < 12 ? "¡Buenos días" : hora < 19 ? "¡Buenas tardes" : "¡Buenas noches";
  const nombre = nombreMaestra ? `, ${nombreMaestra}` : "";
  el("bienvenidaSaludoTitulo").textContent = `${saludoHora}${nombre}! 👋`;

  const frase = FRASES_BIENVENIDA[ahora.getDay() % FRASES_BIENVENIDA.length];
  const nombreGrupo = grupo && grupo.nombre ? grupo.nombre : "tu grupo";
  el("bienvenidaSaludoTexto").textContent = `Todo listo para ${nombreGrupo}. ${frase}`;
}

function iniciarAutoRefrescoBienvenida() {
  if (intervaloBienvenida) clearInterval(intervaloBienvenida);
  intervaloBienvenida = setInterval(() => {
    if (!el("modoBienvenida").hidden) {
      cargarPanelClase();
    }
  }, 25000);
}

// ---------- tabs ----------

el("tabBienvenida").addEventListener("click", () => cambiarTab("Bienvenida"));
el("tabClase").addEventListener("click", () => cambiarTab("Clase"));
el("tabCierre").addEventListener("click", () => cambiarTab("Cierre"));
el("tabBitacora").addEventListener("click", () => cambiarTab("Bitacora"));

function cambiarTab(nombre) {
  ["Bienvenida", "Clase", "Cierre", "Bitacora"].forEach((t) => {
    el("tab" + t).classList.toggle("activo", t === nombre);
    el("modo" + t).hidden = t !== nombre;
  });
  if (nombre === "Cierre") renderCierre();
}

// ---------- modo bienvenida ----------

function estaCumpleEstaSemana(fechaIso) {
  if (!fechaIso) return false;
  const cumple = new Date(fechaIso + "T00:00:00Z");
  if (isNaN(cumple.getTime())) return false;
  const hoy = new Date();
  const mesHoy = hoy.getUTCMonth();
  const diaHoy = hoy.getUTCDate();
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), mesHoy, diaHoy + offset));
    if (d.getUTCMonth() === cumple.getUTCMonth() && d.getUTCDate() === cumple.getUTCDate()) {
      return true;
    }
  }
  return false;
}

function renderBienvenida() {
  const total = alumnasPanel.length;
  const presentes = alumnasPanel.filter((a) => a.presente).length;
  el("contadorLlegadas").textContent = total
    ? `✨ ${presentes} de ${total} ya llegaron`
    : "Este grupo todavía no tiene alumnas.";

  const relleno = el("barraLlegadasRelleno");
  const porcentaje = total ? Math.round((presentes / total) * 100) : 0;
  relleno.style.width = porcentaje + "%";

  const cont = el("listaBienvenida");
  cont.innerHTML = "";

  alumnasPanel.forEach((a) => {
    const cumpleanos = estaCumpleEstaSemana(a.cumpleanos);
    const fila = document.createElement("div");
    fila.className = "fila-bienvenida" + (a.presente ? " presente" : "") + (cumpleanos ? " cumple" : "");

    const icono = document.createElement("span");
    icono.className = "icono-bienvenida";
    icono.textContent = a.presente ? "✅" : "⬜";
    fila.appendChild(icono);

    const nombre = document.createElement("span");
    nombre.className = "nombre-bienvenida";
    nombre.textContent = a.nombre;
    fila.appendChild(nombre);

    if (cumpleanos) {
      const cumple = document.createElement("span");
      cumple.className = "cumple-bienvenida";
      cumple.textContent = "🎂 ¡Cumple!";
      fila.appendChild(cumple);
    }

    cont.appendChild(fila);
  });
}

el("btnRefrescarBienvenida").addEventListener("click", cargarPanelClase);

// ---------- modo clase: cronómetro ----------

function poblarSelectorMinutos() {
  const select = el("selectorMinutos");
  select.innerHTML = "";

  const opciones = [{ seg: 30, texto: "30 segundos" }];
  for (let m = 1; m <= 10; m++) {
    opciones.push({ seg: m * 60, texto: m === 1 ? "1 minuto" : `${m} minutos` });
  }

  opciones.forEach((op) => {
    const opt = document.createElement("option");
    opt.value = String(op.seg);
    opt.textContent = op.texto;
    select.appendChild(opt);
  });
}

function formatearMMSS(segundos) {
  const m = Math.floor(segundos / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(segundos % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function actualizarPantallaCronometro() {
  el("cronometroNumero").textContent = formatearMMSS(cronSegundosRestantes);
}

el("selectorMinutos").addEventListener("change", () => {
  if (cronIntervalo) return; // no cambiar mientras corre
  cronSegundosTotal = Number(el("selectorMinutos").value) || 60;
  cronSegundosRestantes = cronSegundosTotal;
  el("cronometroNumero").classList.remove("cronometro-terminado");
  actualizarPantallaCronometro();
});

el("btnIniciarCronometro").addEventListener("click", () => {
  asegurarAudioCtx();
  detenerAlarma();
  if (cronIntervalo) return;
  if (cronSegundosRestantes <= 0) cronSegundosRestantes = cronSegundosTotal;
  el("cronometroNumero").classList.remove("cronometro-terminado");
  el("selectorMinutos").disabled = true;
  cronIntervalo = setInterval(() => {
    cronSegundosRestantes -= 1;
    actualizarPantallaCronometro();
    if (cronSegundosRestantes <= 0) {
      detenerCronometro();
      el("cronometroNumero").classList.add("cronometro-terminado");
      sonarBeep();
      // Repite el beep hasta que la maestra toque Pausar o Reiniciar —
      // así no se pasa por alto en un salón con música o ruido.
      cronAlarmaIntervalo = setInterval(sonarBeep, 3500);
    }
  }, 1000);
});

el("btnPausarCronometro").addEventListener("click", () => {
  detenerCronometro();
  detenerAlarma();
});

el("btnReiniciarCronometro").addEventListener("click", () => {
  detenerCronometro();
  detenerAlarma();
  cronSegundosRestantes = cronSegundosTotal;
  el("cronometroNumero").classList.remove("cronometro-terminado");
  actualizarPantallaCronometro();
});

function detenerCronometro() {
  if (cronIntervalo) {
    clearInterval(cronIntervalo);
    cronIntervalo = null;
  }
  el("selectorMinutos").disabled = false;
}

function detenerAlarma() {
  if (cronAlarmaIntervalo) {
    clearInterval(cronAlarmaIntervalo);
    cronAlarmaIntervalo = null;
  }
}

function sonarBeep() {
  try {
    const ctx = asegurarAudioCtx();
    if (!ctx) return;
    // Volumen alto (0.85 de 1) y onda "square" en vez de "sine": una
    // señal cuadrada suena más fuerte y más "cortante" a la misma
    // intensidad, para que se note mejor sobre la música de la clase.
    // La rampita de subida/bajada (attack/release) evita que se
    // escuche un "clic" seco al prender/apagar cada nota.
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
    // Si el navegador bloquea el audio, no pasa nada — el cronómetro
    // igual llega a cero visualmente.
  }
}

// ---------- modo clase: ruleta ----------

function reiniciarRuletaVisual() {
  ruletaGirando = false;
  if (ruletaIntervalo) {
    clearInterval(ruletaIntervalo);
    ruletaIntervalo = null;
  }
  const resultado = el("ruletaResultado");
  resultado.textContent = "Toca girar";
  resultado.classList.remove("ruleta-final");
}

el("btnRuleta").addEventListener("click", () => {
  asegurarAudioCtx();
  if (ruletaGirando) return;

  if (!alumnasPanel.length) {
    el("ruletaResultado").textContent = "No hay alumnas en este grupo";
    return;
  }

  ruletaGirando = true;
  const resultado = el("ruletaResultado");
  resultado.classList.remove("ruleta-final");

  let vueltas = 0;
  const vueltasTotales = 14 + Math.floor(Math.random() * 6); // 14–19 "saltos"

  ruletaIntervalo = setInterval(() => {
    const azar = alumnasPanel[Math.floor(Math.random() * alumnasPanel.length)];
    resultado.textContent = azar.nombre;
    vueltas++;

    if (vueltas >= vueltasTotales) {
      clearInterval(ruletaIntervalo);
      ruletaIntervalo = null;
      const elegida = alumnasPanel[Math.floor(Math.random() * alumnasPanel.length)];
      resultado.textContent = "🎉 " + elegida.nombre;
      resultado.classList.add("ruleta-final");
      ruletaGirando = false;
      if (navigator.vibrate) navigator.vibrate(150);
    }
  }, 90);
});

// ---------- modo clase: reacciones + racha ----------

const REACCIONES_ETIQUETAS = {
  "🔥": "Increíble",
  "👏": "Bien hecho",
  "💪": "Sigan así",
  "✨": "Wow",
};

function actualizarRacha() {
  el("rachaNumero").textContent = racha;
}

function lanzarBurst(emoji) {
  const cont = el("burstContainer");
  const span = document.createElement("span");
  span.className = "burst-emoji";
  span.textContent = emoji;

  // posición horizontal aleatoria para que no salgan todas apiladas
  const desplazamiento = (Math.random() - 0.5) * 60; // -30px a +30px
  span.style.setProperty("--desplazamiento", desplazamiento + "px");

  cont.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
  // por si el navegador no dispara animationend por algún motivo
  setTimeout(() => span.remove(), 1600);
}

document.querySelectorAll(".btn-reaccion").forEach((btn) => {
  btn.addEventListener("click", () => {
    asegurarAudioCtx();
    const emoji = btn.dataset.emoji || "✨";
    racha += 1;
    reaccionesConteo[emoji] = (reaccionesConteo[emoji] || 0) + 1;
    actualizarRacha();
    guardarRachaStorage();
    lanzarBurst(emoji);
    if (navigator.vibrate) navigator.vibrate(40);
  });
});

// ---------- modo cierre ----------

function renderCierre() {
  el("cierreRacha").textContent = `${racha} reacción(es) 🎉`;

  const cont = el("cierreReacciones");
  cont.innerHTML = "";

  const emojisUsados = Object.keys(reaccionesConteo).filter((e) => reaccionesConteo[e] > 0);

  if (!emojisUsados.length) {
    return;
  }

  // de mayor a menor, para que se note cuál fue la reacción "favorita"
  emojisUsados.sort((a, b) => reaccionesConteo[b] - reaccionesConteo[a]);

  emojisUsados.forEach((emoji) => {
    const fila = document.createElement("div");
    fila.className = "cierre-reaccion-fila";

    const etiqueta = document.createElement("span");
    etiqueta.className = "cierre-reaccion-etiqueta";
    etiqueta.textContent = `${emoji} ${REACCIONES_ETIQUETAS[emoji] || ""}`.trim();
    fila.appendChild(etiqueta);

    const valor = document.createElement("span");
    valor.className = "cierre-reaccion-valor";
    valor.textContent = "x" + reaccionesConteo[emoji];
    fila.appendChild(valor);

    cont.appendChild(fila);
  });
}

el("btnReiniciarRacha").addEventListener("click", () => {
  racha = 0;
  reaccionesConteo = {};
  if (grupoActual) borrarRachaStorage(grupoActual.id);
  actualizarRacha();
  renderCierre();
});

// ---------- bitácora de clase (objetivo mensual + nota) ----------

// Guarda la bitácora tal como está en ese momento en los 2 campos del
// Cierre. La usan tanto el botón "Guardar bitácora" como el botón
// "Borrar objetivo del mes" — al borrar, queremos que quede guardado (y
// por lo tanto reflejado en Airtable) de una vez, sin obligar a la
// maestra a dar un segundo toque en "Guardar" para que el borrado
// realmente se aplique.
async function guardarBitacoraAhora({ mensajeSinCambios } = {}) {
  const notaClase = el("inputNotaClase").value.trim();
  const objetivoMensualNuevo = el("inputObjetivoMensualCierre").value.trim();
  const msg = el("mensajeBitacora");
  msg.hidden = true;

  const sinCambios = !notaClase && objetivoMensualNuevo === objetivoMensualActual;

  if (sinCambios) {
    msg.textContent = mensajeSinCambios || "No hay cambios que guardar.";
    msg.style.color = "#e0245e";
    msg.hidden = false;
    return;
  }

  const btn = el("btnGuardarBitacora");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";

  try {
    await llamarWorker({
      accion: "guardarBitacora",
      grupoId: grupoActual.id,
      maestraId,
      objetivoMensual: objetivoMensualNuevo,
      notaClase,
    });

    // El objetivo es "estado actual": se actualiza siempre al valor
    // recién guardado, incluso si quedó en blanco (eso significa que la
    // maestra lo borró a propósito). La nota, en cambio, es un registro
    // por clase: solo se actualiza si se escribió una nueva.
    objetivoMensualActual = objetivoMensualNuevo;
    if (notaClase) ultimaNotaActual = { fecha: new Date().toISOString(), nota: notaClase };
    renderObjetivoYNota();

    el("inputNotaClase").value = "";
    msg.style.color = "#1f9d63";
    msg.textContent = "✅ Bitácora guardada.";
    msg.hidden = false;
  } catch (e) {
    msg.style.color = "#e0245e";
    msg.textContent = e.message;
    msg.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

el("btnBorrarObjetivoMensual").addEventListener("click", async () => {
  el("inputObjetivoMensualCierre").value = "";
  await guardarBitacoraAhora();
});

el("btnGuardarBitacora").addEventListener("click", async () => {
  await guardarBitacoraAhora();
});

el("btnNuevaClase").addEventListener("click", () => {
  if (intervaloBienvenida) clearInterval(intervaloBienvenida);
  detenerCronometro();
  detenerAlarma();
  reiniciarRuletaVisual();
  grupoActual = null;
  alumnasPanel = [];
  racha = 0;
  reaccionesConteo = {};
  cargarGrupos();
});

// ---------- salir ----------

el("btnCerrarSesionPanel").addEventListener("click", () => {
  if (intervaloBienvenida) clearInterval(intervaloBienvenida);
  detenerCronometro();
  detenerAlarma();
  reiniciarRuletaVisual();
  maestraId = "";
  nombreMaestra = "";
  gruposMaestra = [];
  grupoActual = null;
  alumnasPanel = [];
  racha = 0;
  reaccionesConteo = {};
  el("inputClaveMaestra").value = "";
  mostrarPantalla("pantallaLogin");
});
