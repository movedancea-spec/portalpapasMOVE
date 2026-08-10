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

// ---------- horario de la clase (duración + alarma de 5 min antes) ----------
let horarioHoyActual = null; // { inicioMinutos, finMinutos, inicioTexto, finTexto } o null
let alarmaFinIntervalo = null; // repite el beep hasta que la maestra la apague
let alarmaFinApagada = false; // una vez apagada, no vuelve a sonar en esta clase

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
  horarioHoyActual = null;
  alarmaFinApagada = false;
  detenerAlarmaFin(false);
  el("bloqueHorarioClase").hidden = true;
  detenerCamaraVideo();
  mensajesRecepcionActual = [];
  detenerAlarmaRecepcion();
  el("inputMensajeRecepcion").value = "";
  renderMensajesRecepcion();
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
  renderSaludoAlumnas(grupo);
  renderDespedidaAlumnas(grupo);
  mostrarPantalla("pantallaPanel");
  cambiarTab("Bienvenida");

  await cargarPanelClase();
  iniciarAutoRefrescoBienvenida();
  cargarMensajesRecepcionPanel();
  iniciarAutoRefrescoRecepcion();
}

async function cargarPanelClase() {
  try {
    const datos = await llamarWorker({ accion: "panelClase", grupoId: grupoActual.id });
    alumnasPanel = datos.alumnas || [];
    objetivoMensualActual = datos.objetivoMensual || "";
    ultimaNotaActual = datos.ultimaNota || null;
    horarioHoyActual = datos.horarioHoy || null;
    renderBienvenida();
    renderObjetivoYNota();
    actualizarBarraTiempoClase();
    renderVideosClase(datos.videos || []);
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

// Convierte un texto (por ejemplo el id o nombre de un grupo) en un
// número estable, para poder elegir una frase distinta por CLASE y no
// solo por día — así dos grupos que dan clase el mismo día no repiten
// exactamente el mismo mensaje ("copy paste").
function hashTextoSimple(texto) {
  const str = (texto || "").toString();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 100000;
  }
  return Math.abs(hash);
}

function renderSaludoBienvenida(grupo) {
  const ahora = new Date();
  const hora = ahora.getHours();
  const saludoHora = hora < 12 ? "¡Buenos días" : hora < 19 ? "¡Buenas tardes" : "¡Buenas noches";
  const nombre = nombreMaestra ? `, ${nombreMaestra}` : "";
  el("bienvenidaSaludoTitulo").textContent = `${saludoHora}${nombre}! 👋`;

  const hashGrupo = hashTextoSimple(grupo && (grupo.id || grupo.nombre));
  const frase = FRASES_BIENVENIDA[(ahora.getDay() + hashGrupo) % FRASES_BIENVENIDA.length];
  const nombreGrupo = grupo && grupo.nombre ? grupo.nombre : "tu grupo";
  el("bienvenidaSaludoTexto").textContent = `Todo listo para ${nombreGrupo}. ${frase}`;
}

// Bienvenida y despedida pensadas para que las vean las ALUMNAS (esta
// pantalla se suele compartir con el grupo) — con frases distintas a
// las de la maestra, para que se sienta como un mensaje para ellas.
const FRASES_BIENVENIDA_ALUMNAS = [
  "Hoy toca sonreír, sudar la camiseta y disfrutar cada paso. 💫",
  "¡Que empiece la magia! Hoy vamos a brillar juntas. ✨",
  "Cada clase es una oportunidad de mejorar un poquito más. 🩰",
  "Vengan con toda la energía — ¡hoy es un gran día para bailar! 🔥",
  "Bienvenidas, equipo — hoy nos vamos a divertir mucho. 🎶",
  "Un paso, una sonrisa, y a darlo todo hoy. 👣",
  "¡Qué bueno tenerlas aquí! Hoy toca brillar. 🌸",
];

const FRASES_DESPEDIDA_ALUMNAS = [
  "¡Gracias por dar lo mejor hoy! Nos vemos en la próxima. 🎉",
  "Otra clase más en el camino — ¡se nota el progreso! 💪",
  "Hasta la próxima, sigan practicando en casa. 🩰",
  "¡Excelente clase de hoy! Descansen y nos vemos pronto. 🌟",
  "Gracias por su energía hoy — ¡nos vemos pronto! ✨",
  "Un aplauso para todas por el esfuerzo de hoy. 👏",
  "Nos vemos la próxima clase — ¡sigan brillando! 💫",
];

function renderSaludoAlumnas(grupo) {
  const ahora = new Date();
  const nombreGrupo = grupo && grupo.nombre ? grupo.nombre : "equipo";
  const hashGrupo = hashTextoSimple(grupo && (grupo.id || grupo.nombre));
  const frase = FRASES_BIENVENIDA_ALUMNAS[(ahora.getDay() + hashGrupo + 1) % FRASES_BIENVENIDA_ALUMNAS.length];
  el("bienvenidaAlumnasTitulo").textContent = `💫 ¡Bienvenidas, ${nombreGrupo}!`;
  el("bienvenidaAlumnasTexto").textContent = frase;
}

function renderDespedidaAlumnas(grupo) {
  const ahora = new Date();
  const hashGrupo = hashTextoSimple(grupo && (grupo.id || grupo.nombre));
  const frase = FRASES_DESPEDIDA_ALUMNAS[(ahora.getDay() + hashGrupo + 3) % FRASES_DESPEDIDA_ALUMNAS.length];
  el("cierreDespedidaTexto").textContent = frase;
}

// ---------- reloj de Guatemala (Bienvenida / Clase / Cierre) ----------

function actualizarRelojGuatemala() {
  let texto;
  try {
    texto = new Date().toLocaleTimeString("es-GT", {
      timeZone: "America/Guatemala",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return;
  }
  ["relojBienvenida", "relojClase", "relojCierre"].forEach((id) => {
    const elReloj = el(id);
    if (elReloj) elReloj.textContent = texto;
  });
}

actualizarRelojGuatemala();
setInterval(actualizarRelojGuatemala, 15000);

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
el("tabVideo").addEventListener("click", () => cambiarTab("Video"));
el("tabRecepcion").addEventListener("click", () => cambiarTab("Recepcion"));

// No es una pestaña del panel — abre el biométrico en una pestaña
// aparte (sin perder el cronómetro, la racha ni el resto del estado
// del Panel de Clase), para que una alumna pueda marcar su asistencia
// ahí mismo sin tener que bajar a recepción.
el("btnMarcarAsistencia").addEventListener("click", () => {
  window.open("https://movedancea-spec.github.io/BIOMETRICO-V4/", "_blank", "noopener");
});

function cambiarTab(nombre) {
  ["Bienvenida", "Clase", "Cierre", "Bitacora", "Video", "Recepcion"].forEach((t) => {
    el("tab" + t).classList.toggle("activo", t === nombre);
    el("modo" + t).hidden = t !== nombre;
  });
  if (nombre === "Cierre") renderCierre();
  // Al entrar a la pestaña de Recepción, la maestra ya "vio" las
  // respuestas pendientes — se marcan leídas y se apaga la alarma.
  if (nombre === "Recepcion") marcarLeidosRecepcion();
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

// ---------- modo clase: horario y barra de tiempo ----------

// Hora actual en minutos-del-día, en la zona horaria de Guatemala —
// misma fuente que el horarioHoy que manda el Worker, para que la
// barra y la alarma cuadren con el horario real de la clase.
function minutosAhoraGuatemala() {
  const texto = new Date().toLocaleTimeString("en-US", {
    timeZone: "America/Guatemala",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = texto.split(":").map(Number);
  return h * 60 + m;
}

function actualizarBarraTiempoClase() {
  const bloque = el("bloqueHorarioClase");
  const relleno = el("barraTiempoClaseRelleno");
  const estado = el("horarioClaseEstado");

  // Sin ningún horario cargado en Airtable para este grupo: no hay nada
  // que mostrar.
  if (!horarioHoyActual) {
    bloque.hidden = true;
    return;
  }
  bloque.hidden = false;

  // El horario (texto) se muestra SIEMPRE como referencia, sin importar
  // qué día se abra el Panel de Clase.
  el("horarioClaseTexto").textContent = `🕒 Horario: ${horarioHoyActual.textoHorario}`;

  // La barra de progreso y la alarma de los 5 minutos solo tienen
  // sentido si HOY es un día en que este grupo sí tiene clase.
  if (!horarioHoyActual.esHoy) {
    relleno.style.width = "0%";
    relleno.classList.remove("tiempo-casi-terminado");
    estado.textContent = "Hoy no hay clase de este grupo.";
    detenerAlarmaFin(false);
    return;
  }

  const { inicioMinutos, finMinutos } = horarioHoyActual;
  const total = finMinutos - inicioMinutos;
  const ahoraMin = minutosAhoraGuatemala();

  if (total <= 0) {
    relleno.style.width = "0%";
    estado.textContent = "";
    return;
  }

  if (ahoraMin < inicioMinutos) {
    relleno.style.width = "0%";
    relleno.classList.remove("tiempo-casi-terminado");
    estado.textContent = `⏳ Empieza en ${inicioMinutos - ahoraMin} min`;
  } else if (ahoraMin >= finMinutos) {
    relleno.style.width = "100%";
    relleno.classList.remove("tiempo-casi-terminado");
    estado.textContent = "✅ Clase terminada";
  } else {
    const transcurrido = ahoraMin - inicioMinutos;
    const porcentaje = Math.min(100, Math.round((transcurrido / total) * 100));
    relleno.style.width = porcentaje + "%";
    const restante = finMinutos - ahoraMin;
    relleno.classList.toggle("tiempo-casi-terminado", restante <= 5);
    estado.textContent = restante <= 1 ? "⏰ ¡Último minuto!" : `⏱ Quedan ${restante} min`;
  }

  // 5 minutos antes de que termine (y hasta una hora después, por si la
  // maestra no vio el aviso a tiempo) suena la alarma, y no para hasta
  // que ella la apague con el botón que aparece solo en ese momento.
  const restanteParaAlarma = finMinutos - ahoraMin;
  if (!alarmaFinApagada && ahoraMin >= inicioMinutos && restanteParaAlarma <= 5 && restanteParaAlarma > -60) {
    iniciarAlarmaFin();
  }
}

function iniciarAlarmaFin() {
  el("btnApagarAlarmaFin").hidden = false;
  if (alarmaFinIntervalo) return; // ya está sonando
  sonarBeep();
  alarmaFinIntervalo = setInterval(sonarBeep, 3500);
}

function detenerAlarmaFin(permanente) {
  if (alarmaFinIntervalo) {
    clearInterval(alarmaFinIntervalo);
    alarmaFinIntervalo = null;
  }
  el("btnApagarAlarmaFin").hidden = true;
  if (permanente) alarmaFinApagada = true;
}

el("btnApagarAlarmaFin").addEventListener("click", () => {
  asegurarAudioCtx();
  detenerAlarmaFin(true);
});

// Revisa la barra de tiempo y la alarma cada pocos segundos, sin
// depender de que la maestra esté justo viendo la pestaña de Clase.
setInterval(actualizarBarraTiempoClase, 5000);

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

// ---------- modo clase: grabar video para el portal ----------

const MAX_SEGUNDOS_VIDEO = 300; // 5 minutos

let streamCamaraVideo = null;
let mediaRecorderVideo = null;
let chunksGrabacionVideo = [];
let blobGrabadoVideo = null;
let mimeTypeGrabadoVideo = "";
let segundosGrabadosVideo = 0;
let timerGrabacionVideoIntervalo = null;
let videosClaseActual = [];

function elegirMimeTypeVideo() {
  const candidatos = [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidatos.find((c) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) || "";
}

function mostrarMensajeVideo(texto, esError) {
  const msg = el("videoClaseMensaje");
  msg.textContent = texto;
  msg.style.color = esError ? "#e0245e" : "#1f9d63";
  msg.hidden = !texto;
}

async function abrirCamaraVideo() {
  mostrarMensajeVideo("");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostrarMensajeVideo("Este navegador no puede usar la cámara aquí.", true);
    return;
  }
  try {
    streamCamaraVideo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: true,
    });
  } catch (e) {
    mostrarMensajeVideo("No se pudo abrir la cámara (revisa los permisos).", true);
    return;
  }

  const preview = el("videoPreviewClase");
  preview.srcObject = streamCamaraVideo;
  preview.hidden = false;
  el("videoRevisarClase").hidden = true;
  el("btnAbrirCamaraVideo").hidden = true;
  el("btnIniciarGrabacionVideo").hidden = false;
  el("btnDetenerGrabacionVideo").hidden = true;
  el("videoClaseBotonesRevision").hidden = true;
}

function formatearMMSSVideo(segundos) {
  const m = Math.floor(segundos / 60).toString().padStart(2, "0");
  const s = Math.floor(segundos % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function iniciarGrabacionVideo() {
  if (!streamCamaraVideo) return;
  mimeTypeGrabadoVideo = elegirMimeTypeVideo();
  chunksGrabacionVideo = [];
  try {
    mediaRecorderVideo = mimeTypeGrabadoVideo
      ? new MediaRecorder(streamCamaraVideo, {
          mimeType: mimeTypeGrabadoVideo,
          videoBitsPerSecond: 1000000,
          audioBitsPerSecond: 96000,
        })
      : new MediaRecorder(streamCamaraVideo);
  } catch (e) {
    mostrarMensajeVideo("No se pudo empezar a grabar en este dispositivo.", true);
    return;
  }
  if (!mimeTypeGrabadoVideo) mimeTypeGrabadoVideo = mediaRecorderVideo.mimeType || "video/webm";

  mediaRecorderVideo.ondataavailable = (e) => {
    if (e.data && e.data.size) chunksGrabacionVideo.push(e.data);
  };
  mediaRecorderVideo.onstop = () => {
    blobGrabadoVideo = new Blob(chunksGrabacionVideo, { type: mimeTypeGrabadoVideo });
    if (streamCamaraVideo) {
      streamCamaraVideo.getTracks().forEach((t) => t.stop());
      streamCamaraVideo = null;
    }
    const revisar = el("videoRevisarClase");
    revisar.src = URL.createObjectURL(blobGrabadoVideo);
    revisar.hidden = false;
    el("videoPreviewClase").hidden = true;
    el("videoClaseTimer").hidden = true;
    el("btnIniciarGrabacionVideo").hidden = true;
    el("btnDetenerGrabacionVideo").hidden = true;
    el("videoClaseBotonesRevision").hidden = false;
  };

  mediaRecorderVideo.start(1000);
  segundosGrabadosVideo = 0;
  el("videoClaseTimer").hidden = false;
  el("videoClaseTimer").textContent = "🔴 00:00";
  el("btnIniciarGrabacionVideo").hidden = true;
  el("btnDetenerGrabacionVideo").hidden = false;

  timerGrabacionVideoIntervalo = setInterval(() => {
    segundosGrabadosVideo += 1;
    el("videoClaseTimer").textContent = `🔴 ${formatearMMSSVideo(segundosGrabadosVideo)}`;
    if (segundosGrabadosVideo >= MAX_SEGUNDOS_VIDEO) {
      detenerGrabacionVideo();
    }
  }, 1000);
}

function detenerGrabacionVideo() {
  if (timerGrabacionVideoIntervalo) {
    clearInterval(timerGrabacionVideoIntervalo);
    timerGrabacionVideoIntervalo = null;
  }
  if (mediaRecorderVideo && mediaRecorderVideo.state !== "inactive") {
    mediaRecorderVideo.stop();
  }
}

function regrabarVideo() {
  blobGrabadoVideo = null;
  const revisar = el("videoRevisarClase");
  if (revisar.src) URL.revokeObjectURL(revisar.src);
  revisar.removeAttribute("src");
  revisar.hidden = true;
  el("videoClaseBotonesRevision").hidden = true;
  mostrarMensajeVideo("");
  abrirCamaraVideo();
}

function subirVideoXHR(url, blob, contentType, alProgresar) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", contentType || "video/webm");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && alProgresar) alProgresar(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let datos = {};
      try {
        datos = JSON.parse(xhr.responseText);
      } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && datos.success) {
        resolve(datos);
      } else {
        reject(new Error(datos.error || "No se pudo subir el video."));
      }
    };
    xhr.onerror = () => reject(new Error("Falló la conexión al subir el video."));
    xhr.send(blob);
  });
}

async function subirVideoAlPortal() {
  if (!blobGrabadoVideo || !grupoActual) return;
  const btn = el("btnSubirVideo");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Subiendo...";
  el("videoClaseProgreso").hidden = false;
  el("videoClaseProgresoRelleno").style.width = "0%";
  mostrarMensajeVideo("");

  try {
    const urlSubida = `${WORKER_URL}/subirVideoClase?grupoId=${encodeURIComponent(grupoActual.id)}`;
    await subirVideoXHR(urlSubida, blobGrabadoVideo, mimeTypeGrabadoVideo, (pct) => {
      el("videoClaseProgresoRelleno").style.width = pct + "%";
    });
    mostrarMensajeVideo("✅ Video subido — ya está en el portal de las alumnas de esta clase.", false);
    blobGrabadoVideo = null;
    const revisar = el("videoRevisarClase");
    if (revisar.src) URL.revokeObjectURL(revisar.src);
    revisar.removeAttribute("src");
    revisar.hidden = true;
    el("videoClaseBotonesRevision").hidden = true;
    el("btnAbrirCamaraVideo").hidden = false;
    el("videoClaseProgreso").hidden = true;
    await cargarPanelClase();
  } catch (e) {
    mostrarMensajeVideo(e.message, true);
    el("videoClaseProgreso").hidden = true;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function formatearFechaHoraVideo(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

function renderVideosClase(videos) {
  videosClaseActual = videos || [];
  const cont = el("listaVideosClase");
  const titulo = el("tituloVideosSubidos");
  cont.innerHTML = "";

  if (!videosClaseActual.length) {
    titulo.hidden = true;
    return;
  }
  titulo.hidden = false;

  videosClaseActual.forEach((v) => {
    const fila = document.createElement("div");
    fila.className = "video-clase-fila";

    const info = document.createElement("span");
    info.className = "video-clase-fila-info";
    info.textContent = `📼 ${formatearFechaHoraVideo(v.fecha)} · ${v.tamanoMB} MB`;
    fila.appendChild(info);

    const botones = document.createElement("div");
    botones.className = "video-clase-fila-botones";

    const verLink = document.createElement("a");
    verLink.className = "video-clase-fila-boton-ver";
    verLink.href = v.url;
    verLink.target = "_blank";
    verLink.rel = "noopener";
    verLink.textContent = "▶ Ver";
    botones.appendChild(verLink);

    const descargarLink = document.createElement("a");
    descargarLink.className = "video-clase-fila-boton-descargar";
    descargarLink.href = v.urlDescarga;
    descargarLink.textContent = "⬇ Descargar";
    botones.appendChild(descargarLink);

    const eliminarBtn = document.createElement("button");
    eliminarBtn.className = "video-clase-fila-boton-eliminar";
    eliminarBtn.type = "button";
    eliminarBtn.textContent = "🗑 Borrar";
    eliminarBtn.addEventListener("click", () => {
      if (eliminarBtn.dataset.confirmar === "1") {
        eliminarVideoClase(v.clave);
      } else {
        eliminarBtn.dataset.confirmar = "1";
        eliminarBtn.textContent = "¿Seguro? Toca de nuevo";
        setTimeout(() => {
          eliminarBtn.dataset.confirmar = "";
          eliminarBtn.textContent = "🗑 Borrar";
        }, 3000);
      }
    });
    botones.appendChild(eliminarBtn);

    fila.appendChild(botones);
    cont.appendChild(fila);
  });
}

async function eliminarVideoClase(clave) {
  try {
    await llamarWorker({ accion: "eliminarVideoClase", clave });
    await cargarPanelClase();
  } catch (e) {
    mostrarMensajeVideo(e.message, true);
  }
}

function detenerCamaraVideo() {
  if (timerGrabacionVideoIntervalo) {
    clearInterval(timerGrabacionVideoIntervalo);
    timerGrabacionVideoIntervalo = null;
  }
  if (mediaRecorderVideo && mediaRecorderVideo.state !== "inactive") {
    try {
      mediaRecorderVideo.stop();
    } catch (e) {}
  }
  mediaRecorderVideo = null;
  if (streamCamaraVideo) {
    streamCamaraVideo.getTracks().forEach((t) => t.stop());
    streamCamaraVideo = null;
  }
  blobGrabadoVideo = null;
  chunksGrabacionVideo = [];

  const revisar = el("videoRevisarClase");
  if (revisar.src) URL.revokeObjectURL(revisar.src);
  revisar.removeAttribute("src");
  revisar.hidden = true;
  el("videoPreviewClase").hidden = true;
  el("videoClaseTimer").hidden = true;
  el("btnAbrirCamaraVideo").hidden = false;
  el("btnIniciarGrabacionVideo").hidden = true;
  el("btnDetenerGrabacionVideo").hidden = true;
  el("videoClaseBotonesRevision").hidden = true;
  el("videoClaseProgreso").hidden = true;
  mostrarMensajeVideo("");
}

el("btnAbrirCamaraVideo").addEventListener("click", abrirCamaraVideo);
el("btnIniciarGrabacionVideo").addEventListener("click", iniciarGrabacionVideo);
el("btnDetenerGrabacionVideo").addEventListener("click", detenerGrabacionVideo);
el("btnRegrabarVideo").addEventListener("click", regrabarVideo);
el("btnSubirVideo").addEventListener("click", subirVideoAlPortal);

// ---------- modo recepción: chat rápido con recepción ----------
// Para pedidos del momento (ej. "que suba un papá a llevar a una
// alumna al baño"), ya que Recepción está en otro piso. Se consulta
// en segundo plano cada pocos segundos — no solo cuando la maestra
// tiene abierta esta pestaña — para que, si Recepción contesta, le
// suene la alarma (fuerte + vibración, igual que la de fin de clase)
// hasta que ella la vea o entre a la pestaña de Recepción.

let mensajesRecepcionActual = [];
let recepcionPollIntervalo = null;
let alarmaRecepcionIntervalo = null;

async function cargarMensajesRecepcionPanel() {
  if (!grupoActual) return;
  try {
    const datos = await llamarWorker({ accion: "obtenerMensajesRecepcion", grupoId: grupoActual.id });
    mensajesRecepcionActual = datos.mensajes || [];
    renderMensajesRecepcion();

    const hayRespuestaSinVer = mensajesRecepcionActual.some((m) => m.autor === "Recepcion" && !m.leidoMaestra);
    if (hayRespuestaSinVer) {
      iniciarAlarmaRecepcion();
    } else {
      detenerAlarmaRecepcion();
    }
  } catch (e) {
    // Si falla una consulta en segundo plano, no interrumpimos a la
    // maestra con un error — simplemente se intenta de nuevo en el
    // siguiente ciclo.
  }
}

function formatearHoraRecepcion(iso) {
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

function renderMensajesRecepcion() {
  const cont = el("chatMensajesRecepcion");
  cont.innerHTML = "";

  if (!mensajesRecepcionActual.length) {
    cont.innerHTML = '<p class="chat-vacio">Todavía no hay mensajes con Recepción hoy.</p>';
    return;
  }

  mensajesRecepcionActual.forEach((m) => {
    const esMaestra = m.autor === "Maestra";
    const fila = document.createElement("div");
    fila.className = "chat-fila " + (esMaestra ? "chat-fila-maestra" : "chat-fila-recepcion");

    const burbuja = document.createElement("div");
    burbuja.className =
      "chat-burbuja " + (esMaestra ? "chat-burbuja-maestra" : "chat-burbuja-recepcion") +
      (!esMaestra && !m.atendido ? " no-atendido" : "");

    const autor = document.createElement("div");
    autor.className = "chat-autor";
    autor.textContent = esMaestra ? "Tú" : "🏢 Recepción";
    burbuja.appendChild(autor);

    const texto = document.createElement("div");
    texto.className = "chat-texto";
    texto.textContent = m.mensaje;
    burbuja.appendChild(texto);

    const hora = document.createElement("div");
    hora.className = "chat-hora";
    hora.textContent = formatearHoraRecepcion(m.fecha);
    burbuja.appendChild(hora);

    fila.appendChild(burbuja);
    cont.appendChild(fila);
  });

  cont.scrollTop = cont.scrollHeight;
}

function iniciarAlarmaRecepcion() {
  el("btnApagarAlarmaRecepcion").hidden = false;
  if (alarmaRecepcionIntervalo) return; // ya está sonando
  sonarBeep();
  alarmaRecepcionIntervalo = setInterval(sonarBeep, 3500);
}

function detenerAlarmaRecepcion() {
  if (alarmaRecepcionIntervalo) {
    clearInterval(alarmaRecepcionIntervalo);
    alarmaRecepcionIntervalo = null;
  }
  el("btnApagarAlarmaRecepcion").hidden = true;
}

async function marcarLeidosRecepcion() {
  // Se marca a propósito (nunca en la consulta de fondo) — al abrir
  // la pestaña o al apagar la alarma a mano.
  mensajesRecepcionActual.forEach((m) => {
    if (m.autor === "Recepcion") m.leidoMaestra = true;
  });
  detenerAlarmaRecepcion();
  if (!grupoActual) return;
  try {
    await llamarWorker({ accion: "marcarMensajesRecepcionLeidosMaestra", grupoId: grupoActual.id });
  } catch (e) {
    // No pasa nada si falla — el siguiente ciclo lo vuelve a intentar.
  }
}

el("btnApagarAlarmaRecepcion").addEventListener("click", () => {
  asegurarAudioCtx();
  marcarLeidosRecepcion();
});

async function enviarMensajeRecepcionPanel() {
  const input = el("inputMensajeRecepcion");
  const texto = input.value.trim();
  const mensajeEl = el("mensajeRecepcionPanel");
  mensajeEl.hidden = true;

  if (!texto) return;
  if (!grupoActual) return;

  const boton = el("btnEnviarMensajeRecepcion");
  boton.disabled = true;

  try {
    await llamarWorker({
      accion: "enviarMensajeRecepcion",
      grupoId: grupoActual.id,
      grupoNombre: grupoActual.nombre,
      mensaje: texto,
      autor: "Maestra",
    });
    input.value = "";
    await cargarMensajesRecepcionPanel();
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.hidden = false;
  } finally {
    boton.disabled = false;
  }
}

el("btnEnviarMensajeRecepcion").addEventListener("click", enviarMensajeRecepcionPanel);
el("inputMensajeRecepcion").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensajeRecepcionPanel();
  }
});

// Los botones rápidos solo llenan el mensaje — la maestra igual tiene
// que tocar enviar, para evitar que un toque accidental mande un
// mensaje sin querer.
document.querySelectorAll(".btn-recepcion-rapido").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = el("inputMensajeRecepcion");
    input.value = btn.dataset.texto || "";
    input.focus();
  });
});

function iniciarAutoRefrescoRecepcion() {
  if (recepcionPollIntervalo) clearInterval(recepcionPollIntervalo);
  recepcionPollIntervalo = setInterval(cargarMensajesRecepcionPanel, 10000);
}

function detenerAutoRefrescoRecepcion() {
  if (recepcionPollIntervalo) {
    clearInterval(recepcionPollIntervalo);
    recepcionPollIntervalo = null;
  }
}

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
  detenerAlarmaFin(true);
  detenerCamaraVideo();
  detenerAutoRefrescoRecepcion();
  detenerAlarmaRecepcion();
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
  detenerAlarmaFin(true);
  detenerCamaraVideo();
  detenerAutoRefrescoRecepcion();
  detenerAlarmaRecepcion();
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
