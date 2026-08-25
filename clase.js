// ==========================================
// MOVE — PANEL DE CLASE (para maestras)
// MOVE Dance Academy
// ==========================================
// Pensado para usarse en la tablet/celular de la maestra durante su
// propia clase. Habla con el mismo Worker que el resto del portal —
// nunca guarda datos sensibles aquí. La ruleta es solo de esta sesión
// (no se guarda en Airtable): sirve para gamificar el momento, no
// para llevar un historial permanente. La calificación de la clase sí
// se guarda (es interna, solo la ve la directora desde ranking.html).

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let maestraId = "";
let nombreMaestra = "";
let gruposMaestra = [];
let grupoActual = null;
let alumnasPanel = []; // lo que devuelve panelClase: [{id, nombre, cumpleanos, presente}]
let objetivoMensualActual = ""; // el único objetivo que existe — es el que se ve en el portal de papás
let ultimaNotaActual = null; // { fecha, nota } o null
let calificacionHoyActual = null; // "Excelente" | "Buena" | "Regular" | null

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
// IDs de alumnas que ya salieron en esta ronda — no se vuelven a
// escoger hasta que se reinicie la ruleta (botón "🔄 Reiniciar ruleta"
// o al iniciar una clase nueva / cerrar sesión).
let ruletaYaSalieron = new Set();

// ---------- control remoto desde el celular ----------
// La laptop (donde está abierto este Panel de Clase, conectado a la
// pantalla del salón) genera un código PIN y lo muestra en una
// burbuja flotante. Desde el celular, la maestra entra a
// control.html, escribe el PIN y desde ahí puede manejar el
// cronómetro, la ruleta, la calificación y el cambio de pestañas sin
// tener que regresar a la laptop. Los comandos se recogen aquí cada 2
// segundos y se ejecutan "tocando" los mismos botones de siempre —
// nunca se duplica la lógica del cronómetro/ruleta/etc., solo se
// dispara desde otro lado.
let pinControlRemoto = "";
let ultimoIdComandoRemoto = 0;
let intervaloControlRemoto = null;

// ---------- visualizador de música (Spotify) en la pestaña Clase ----------
// Puramente decorativo: como el navegador no "escucha" el audio real
// de Spotify (suena aparte, en la laptop, no dentro de esta página),
// no se puede sincronizar al beat exacto. En vez de eso, se pregunta
// cada pocos segundos si Spotify está reproduciendo algo (reusando el
// mismo PIN del control remoto) y el anillo se anima solo mientras
// haya música sonando — así se ve vivo, pero nunca depende de que
// Spotify esté conectado (si falla, simplemente no se muestra).
let intervaloVisualizadorMusica = null;

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

async function entrarMaestra(claveAuto) {
  // Si claveAuto viene como texto, es un intento AUTOMÁTICO (la sesión
  // compartida que dejó guardada el Portal de Maestras u otra pantalla) —
  // en ese caso no tocamos el botón ni mostramos errores si falla, solo
  // borramos la sesión guardada y se queda la pantalla de login normal.
  const esAuto = typeof claveAuto === "string";
  const clave = esAuto ? claveAuto : el("inputClaveMaestra").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  if (!esAuto) mensajeError.textContent = "";

  if (!clave) {
    if (!esAuto) mensajeError.textContent = "Escribe tu clave.";
    return;
  }

  const boton = el("btnEntrarMaestra");
  let textoOriginal = "";
  if (!esAuto) {
    boton.disabled = true;
    textoOriginal = boton.textContent;
    boton.textContent = "Entrando...";
  }

  try {
    const datos = await llamarWorker({ accion: "maestraEntrar", clave });
    maestraId = datos.maestraId;
    nombreMaestra = datos.nombre || "Maestra";
    guardarSesionMaestraCompartida(clave, maestraId, nombreMaestra);
    await cargarGrupos();
  } catch (e) {
    if (esAuto) {
      borrarSesionMaestraCompartida();
    } else {
      mensajeError.textContent = e.message;
    }
  } finally {
    if (!esAuto) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
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

// ---------- panel de clase ----------

async function abrirPanel(grupo) {
  grupoActual = grupo;
  calificacionHoyActual = null;
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
  renderCalificacion();

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
  iniciarControlRemoto();
}

async function cargarPanelClase() {
  try {
    const datos = await llamarWorker({ accion: "panelClase", grupoId: grupoActual.id });
    alumnasPanel = datos.alumnas || [];
    objetivoMensualActual = datos.objetivoMensual || "";
    ultimaNotaActual = datos.ultimaNota || null;
    horarioHoyActual = datos.horarioHoy || null;
    calificacionHoyActual = datos.calificacionHoy || null;
    renderBienvenida();
    renderObjetivoYNota();
    actualizarBarraTiempoClase();
    renderVideosClase(datos.videos || []);
    renderCalificacion();
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
// aparte (sin perder el cronómetro ni el resto del estado del Panel
// de Clase), para que una alumna pueda marcar su asistencia ahí mismo
// sin tener que bajar a recepción.
//
// Solo debe usarse durante el horario de clases (2:00 p.m. a 9:00
// p.m., hora de Guatemala) — fuera de ese rango el botón se ve
// apagado y, si lo tocan, avisa el horario en vez de abrir el
// biométrico.
function dentroHorarioAsistencia() {
  try {
    const horaGuate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Guatemala",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    const [h, m] = horaGuate.split(":").map(Number);
    const minutosDelDia = h * 60 + m;
    return minutosDelDia >= 14 * 60 && minutosDelDia <= 21 * 60; // 2:00 p.m. – 9:00 p.m.
  } catch (e) {
    // Si por lo que sea no se puede calcular la hora, no bloqueamos
    // el botón (mejor dejar pasar que dejar a alguien sin poder
    // marcar su asistencia por un error nuestro).
    return true;
  }
}

function actualizarBotonMarcarAsistencia() {
  const btn = el("btnMarcarAsistencia");
  if (!btn) return;
  const habilitado = dentroHorarioAsistencia();
  btn.classList.toggle("deshabilitado", !habilitado);
  btn.title = habilitado ? "" : "Disponible de 2:00 p.m. a 9:00 p.m. (hora de Guatemala)";
}

function avisarFueraDeHorarioAsistencia() {
  let aviso = el("avisoFueraHorarioAsistencia");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "avisoFueraHorarioAsistencia";
    aviso.className = "aviso-flotante-horario";
    document.body.appendChild(aviso);
  }
  aviso.textContent = "⏰ El registro de asistencia solo está disponible de 2:00 p.m. a 9:00 p.m. (hora de Guatemala).";
  aviso.hidden = false;
  clearTimeout(avisarFueraDeHorarioAsistencia._temporizador);
  avisarFueraDeHorarioAsistencia._temporizador = setTimeout(() => {
    aviso.hidden = true;
  }, 3500);
}

actualizarBotonMarcarAsistencia();
setInterval(actualizarBotonMarcarAsistencia, 15000);

el("btnMarcarAsistencia").addEventListener("click", () => {
  if (!dentroHorarioAsistencia()) {
    avisarFueraDeHorarioAsistencia();
    return;
  }
  window.open("https://movedancea-spec.github.io/BIOMETRICO-V4/", "_blank", "noopener");
});

function cambiarTab(nombre) {
  ["Bienvenida", "Clase", "Cierre", "Bitacora", "Video", "Recepcion"].forEach((t) => {
    el("tab" + t).classList.toggle("activo", t === nombre);
    el("modo" + t).hidden = t !== nombre;
  });
  // Al entrar a la pestaña de Recepción, la maestra ya "vio" las
  // respuestas pendientes — se marcan leídas y se apaga la alarma.
  if (nombre === "Recepcion") marcarLeidosRecepcion();
  // Al entrar a la pestaña Clase, se refresca el visualizador de
  // música de una vez, en vez de esperar hasta 6 segundos.
  if (nombre === "Clase") actualizarVisualizadorMusica();
  // El punto rojo / banner de Recepción solo debe verse cuando NO
  // está viendo ya esa pestaña (para no duplicar el aviso).
  sincronizarAlertaRecepcion();
}

// ---------- control remoto desde el celular ----------

function asegurarBadgeControlRemoto() {
  if (el("badgeControlRemoto")) return;
  const badge = document.createElement("div");
  badge.id = "badgeControlRemoto";
  badge.hidden = true;
  badge.style.cssText =
    "position:fixed;left:10px;bottom:10px;z-index:9999;background:#ef4b9b;color:#fff;" +
    "font-family:'Poppins',sans-serif;font-weight:700;font-size:12px;line-height:1.35;" +
    "padding:8px 12px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,0.28);" +
    "text-align:center;max-width:160px;pointer-events:none;";
  document.body.appendChild(badge);
}

function actualizarBadgeControlRemoto(pin) {
  asegurarBadgeControlRemoto();
  const badge = el("badgeControlRemoto");
  if (!pin) {
    badge.hidden = true;
    return;
  }
  badge.innerHTML =
    '📱 Control remoto<br><span style="font-size:21px;letter-spacing:3px;">' + pin + "</span>";
  badge.hidden = false;
}

// Le pide al Worker un código nuevo (esto crea el "buzón" en el KV).
// Si por lo que sea no se puede (Worker sin el KV configurado
// todavía, sin conexión, etc.), simplemente no aparece la burbuja del
// código y el resto del Panel de Clase sigue funcionando normal — el
// control remoto es un extra, nunca algo de lo que dependa la clase.
async function iniciarPinControlRemoto() {
  try {
    const datos = await llamarWorker({ accion: "controlRemotoIniciar" });
    pinControlRemoto = datos.pin || "";
    ultimoIdComandoRemoto = 0;
    actualizarBadgeControlRemoto(pinControlRemoto);
  } catch (e) {
    pinControlRemoto = "";
    actualizarBadgeControlRemoto("");
  }
}

function iniciarControlRemoto() {
  iniciarPinControlRemoto();
  if (intervaloControlRemoto) clearInterval(intervaloControlRemoto);
  intervaloControlRemoto = setInterval(revisarComandosRemotos, 2000);
  iniciarVisualizadorMusica();
}

function detenerControlRemoto() {
  if (intervaloControlRemoto) {
    clearInterval(intervaloControlRemoto);
    intervaloControlRemoto = null;
  }
  pinControlRemoto = "";
  ultimoIdComandoRemoto = 0;
  actualizarBadgeControlRemoto("");
  detenerVisualizadorMusica();
}

// Convierte texto a HTML seguro, para poder mostrar el nombre de la
// canción/artista (viene de Spotify, no lo escribimos nosotros) sin
// arriesgarse a romper el HTML de la página.
function escaparHtmlClase(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function iniciarVisualizadorMusica() {
  if (intervaloVisualizadorMusica) clearInterval(intervaloVisualizadorMusica);
  actualizarVisualizadorMusica();
  intervaloVisualizadorMusica = setInterval(actualizarVisualizadorMusica, 6000);
}

function detenerVisualizadorMusica() {
  if (intervaloVisualizadorMusica) {
    clearInterval(intervaloVisualizadorMusica);
    intervaloVisualizadorMusica = null;
  }
  const bloque = el("visualizadorMusica");
  if (bloque) bloque.hidden = true;
}

async function actualizarVisualizadorMusica() {
  const bloque = el("visualizadorMusica");
  if (!bloque) return;
  // Solo vale la pena preguntar si la pestaña Clase está a la vista —
  // igual que el resto de los auto-refrescos del panel.
  if (el("modoClase").hidden) return;
  if (!pinControlRemoto) {
    bloque.hidden = true;
    return;
  }

  try {
    const datos = await llamarWorker({ accion: "spotifyEstado", pin: pinControlRemoto });
    const texto = el("visualizadorTexto");
    bloque.hidden = false;
    if (datos.reproduciendo && datos.cancion) {
      bloque.classList.add("sonando");
      texto.innerHTML = `<strong>${escaparHtmlClase(datos.cancion)}</strong>${
        datos.artista ? " — " + escaparHtmlClase(datos.artista) : ""
      }`;
    } else {
      bloque.classList.remove("sonando");
      texto.textContent = "⏸ Sin música por ahora";
    }
  } catch (e) {
    // Spotify no está conectado, la cuenta no es Premium, etc. — el
    // visualizador es un extra decorativo, así que si algo falla
    // simplemente se esconde en vez de mostrar un error en pantalla.
    bloque.hidden = true;
  }
}

async function revisarComandosRemotos() {
  if (!pinControlRemoto) return;
  try {
    const datos = await llamarWorker({
      accion: "controlRemotoObtener",
      pin: pinControlRemoto,
      desdeId: ultimoIdComandoRemoto,
    });
    if (!datos.activo) {
      // El código venció (más de 6 horas) — se genera uno nuevo solo,
      // sin interrumpir a la maestra ni pedirle que haga nada.
      await iniciarPinControlRemoto();
      return;
    }
    (datos.comandos || []).forEach((c) => {
      ejecutarComandoRemoto(c.comando);
      if (c.id > ultimoIdComandoRemoto) ultimoIdComandoRemoto = c.id;
    });
  } catch (e) {
    // Si falla una consulta (sin señal un instante, etc.) se intenta
    // de nuevo sola en el siguiente ciclo de 2 segundos.
  }
}

// Ejecuta un comando que llegó del celular — "tocando" el mismo botón
// que usaría la maestra directamente en la laptop, para no duplicar
// nada de la lógica del cronómetro, la ruleta, la calificación, etc.
function ejecutarComandoRemoto(comando) {
  if (!comando) return;

  if (comando.indexOf("cronometro:minutos:") === 0) {
    // Igual que en la laptop: solo se puede cambiar el tiempo mientras
    // el cronómetro está detenido o en pausa, nunca mientras corre.
    if (cronIntervalo) return;
    const segundos = comando.slice("cronometro:minutos:".length);
    const select = el("selectorMinutos");
    if (select) {
      select.value = segundos;
      select.dispatchEvent(new Event("change"));
    }
    return;
  }
  if (comando === "cronometro:iniciar") {
    el("btnIniciarCronometro").click();
    return;
  }
  if (comando === "cronometro:pausar") {
    el("btnPausarCronometro").click();
    return;
  }
  if (comando === "cronometro:reiniciar") {
    el("btnReiniciarCronometro").click();
    return;
  }
  if (comando === "ruleta:girar") {
    el("btnRuleta").click();
    return;
  }
  if (comando === "ruleta:reiniciar") {
    el("btnReiniciarRuleta").click();
    return;
  }
  if (comando.indexOf("calificacion:") === 0) {
    const categoria = comando.slice("calificacion:".length);
    const btn = document.querySelector('.btn-calificacion[data-categoria="' + categoria + '"]');
    if (btn) btn.click();
    return;
  }
  if (comando.indexOf("tab:") === 0) {
    const nombreTab = comando.slice("tab:".length);
    if (["Bienvenida", "Clase", "Cierre", "Bitacora", "Video", "Recepcion"].includes(nombreTab)) {
      cambiarTab(nombreTab);
    }
    return;
  }
}

// ---------- modo bienvenida ----------

// Compara solo mes y día como texto (nunca con objetos Date/UTC, que
// es justo lo que antes hacía que esto se corriera un día — de 6pm a
// medianoche, hora de Guatemala, la fecha en UTC ya es "mañana").
// "Hoy" se calcula en la zona horaria de Guatemala, no la del
// dispositivo, para que coincida siempre con lo que muestra Airtable.
function estaCumpleHoy(fechaIso) {
  if (!fechaIso) return false;
  const partes = fechaIso.toString().split("T")[0].split("-");
  if (partes.length < 3) return false;
  const [, mesCumple, diaCumple] = partes;

  const hoyGuatemala = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
  const [, mesHoy, diaHoy] = hoyGuatemala.split("-");

  return mesCumple === mesHoy && diaCumple === diaHoy;
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
    const cumpleanos = estaCumpleHoy(a.cumpleanos);
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
  for (let m = 1; m <= 30; m++) {
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
    // Volumen bajado de nuevo (0.2 de 1, antes 0.425, y originalmente
    // 0.85) y onda "square" en vez de "sine": una señal cuadrada suena
    // más fuerte y más "cortante" a la misma intensidad, para que se
    // note sobre la música de la clase sin quedar tan alto como antes.
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
      gain.gain.linearRampToValueAtTime(0.2, inicio + 0.015);
      gain.gain.setValueAtTime(0.2, fin - 0.02);
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
  ruletaYaSalieron.clear();
  const resultado = el("ruletaResultado");
  resultado.textContent = "Toca girar";
  resultado.classList.remove("ruleta-final");
}

el("btnRuleta").addEventListener("click", () => {
  asegurarAudioCtx();
  if (ruletaGirando) return;

  const resultado = el("ruletaResultado");

  // Solo entran a la ruleta las alumnas marcadas como presentes hoy
  // (se recalcula en cada giro, por si alguna llegó tarde y la
  // acaban de marcar). Las que ya salieron en esta ronda quedan
  // afuera hasta que se reinicie con el botón "🔄 Reiniciar ruleta".
  const presentes = alumnasPanel.filter((a) => a.presente);
  if (!presentes.length) {
    resultado.textContent = "No hay alumnas marcadas como presentes";
    return;
  }

  const candidatas = presentes.filter((a) => !ruletaYaSalieron.has(a.id));
  if (!candidatas.length) {
    resultado.textContent = "🎉 Ya salieron todas — toca 🔄 Reiniciar";
    return;
  }

  ruletaGirando = true;
  resultado.classList.remove("ruleta-final");

  let vueltas = 0;
  const vueltasTotales = 14 + Math.floor(Math.random() * 6); // 14–19 "saltos"

  ruletaIntervalo = setInterval(() => {
    const azar = candidatas[Math.floor(Math.random() * candidatas.length)];
    resultado.textContent = azar.nombre;
    vueltas++;

    if (vueltas >= vueltasTotales) {
      clearInterval(ruletaIntervalo);
      ruletaIntervalo = null;
      const elegida = candidatas[Math.floor(Math.random() * candidatas.length)];
      ruletaYaSalieron.add(elegida.id);
      resultado.textContent = "🎉 " + elegida.nombre;
      resultado.classList.add("ruleta-final");
      ruletaGirando = false;
      if (navigator.vibrate) navigator.vibrate(150);
    }
  }, 90);
});

el("btnReiniciarRuleta").addEventListener("click", () => {
  if (ruletaGirando) return; // no interrumpir un giro en curso
  reiniciarRuletaVisual();
  if (navigator.vibrate) navigator.vibrate(60);
});

// ---------- modo clase: calificación interna de la clase ----------
// Solo interna: no aparece en el portal de alumnas. Cada clase (por
// grupo y por día) se puede calificar UNA vez — si la maestra toca
// otra categoría, se actualiza en vez de sumar aparte. Los puntos se
// van acumulando en Airtable durante todo el mes, y solo la
// directora puede ver la tabla de posiciones (desde ranking.html).

const EMOJI_CALIFICACION = {
  Excelente: "🌟 Excelente",
  Buena: "👍 Buena",
  Regular: "🙂 Regular",
};

function renderCalificacion() {
  document.querySelectorAll(".btn-calificacion").forEach((btn) => {
    btn.classList.toggle("activa", btn.dataset.categoria === calificacionHoyActual);
  });
  const mensaje = el("calificacionMensaje");
  if (calificacionHoyActual) {
    mensaje.textContent = `Calificaste esta clase como "${calificacionHoyActual}" hoy. Puedes cambiarla tocando otra opción.`;
    mensaje.hidden = false;
  } else {
    mensaje.hidden = true;
  }

  // En el Cierre, las alumnas ven la calificación de HOY (para
  // celebrarlo en el momento) — pero como esto solo se calcula con la
  // calificación de HOY (calificacionHoyActual, que ya viene filtrada
  // por día desde el Worker), al día siguiente esto ya no tiene nada
  // que mostrar y el bloque se oculta solo. El registro con puntos
  // sigue guardado en Airtable, pero eso solo lo ve la directora
  // desde ranking.html — aquí nunca se muestran puntos ni el mes.
  const bloqueCierre = el("cierreCalificacionHoy");
  if (calificacionHoyActual) {
    el("cierreCalificacionValor").textContent = EMOJI_CALIFICACION[calificacionHoyActual] || calificacionHoyActual;
    bloqueCierre.hidden = false;
  } else {
    bloqueCierre.hidden = true;
  }
}

document.querySelectorAll(".btn-calificacion").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!grupoActual) return;
    const categoria = btn.dataset.categoria;
    if (categoria === calificacionHoyActual) return; // ya está en esa categoría

    document.querySelectorAll(".btn-calificacion").forEach((b) => (b.disabled = true));
    try {
      await llamarWorker({
        accion: "calificarClase",
        grupoId: grupoActual.id,
        grupoNombre: grupoActual.nombre,
        categoria,
      });
      calificacionHoyActual = categoria;
      renderCalificacion();
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (e) {
      const mensaje = el("calificacionMensaje");
      mensaje.textContent = e.message;
      mensaje.hidden = false;
    } finally {
      document.querySelectorAll(".btn-calificacion").forEach((b) => (b.disabled = false));
    }
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
  if (!alarmaRecepcionIntervalo) {
    sonarBeep();
    alarmaRecepcionIntervalo = setInterval(sonarBeep, 3500);
  }
  // Se sincroniza AL FINAL, ya con alarmaRecepcionIntervalo puesto —
  // si no, la primera vez el punto rojo / banner no alcanzaban a
  // aparecer porque todavía se leía como "sin alarma".
  sincronizarAlertaRecepcion();
}

function detenerAlarmaRecepcion() {
  if (alarmaRecepcionIntervalo) {
    clearInterval(alarmaRecepcionIntervalo);
    alarmaRecepcionIntervalo = null;
  }
  el("btnApagarAlarmaRecepcion").hidden = true;
  sincronizarAlertaRecepcion();
}

// El sonido de la alarma se oye igual en cualquier pestaña, pero
// antes NO aparecía nada en pantalla si la maestra no estaba
// justo en la pestaña de Recepción — solo el pitido, sin poder
// confirmar de dónde venía. Esto agrega dos avisos VISUALES que se
// ven desde cualquier pestaña del Panel de Clase:
//   1) un punto rojo sobre la pestaña "📞 Recepción"
//   2) una franja rosa fija arriba de la pantalla, que al tocarla
//      lleva directo a esa pestaña (y así se marca como leído,
//      igual que ya pasaba al entrar a la pestaña a mano).
// El banner no se muestra si ya está viendo la pestaña de Recepción
// (ahí ya se ve el aviso normal, adentro del chat).
function asegurarBannerAlertaRecepcion() {
  if (el("bannerAlertaRecepcion")) return;
  const banner = document.createElement("button");
  banner.id = "bannerAlertaRecepcion";
  banner.type = "button";
  banner.hidden = true;
  banner.textContent = "🔔 ¡Recepción te escribió! Toca para ver el mensaje";
  banner.style.cssText =
    "position:fixed;left:10px;right:10px;top:10px;z-index:9999;border:none;" +
    "background:linear-gradient(180deg,#ff72b7,#ef4b9b);color:#fff;" +
    "font-family:'Poppins',sans-serif;font-weight:800;font-size:clamp(13px,3.6vw,15px);line-height:1.3;" +
    "padding:12px 16px;border-radius:16px;box-shadow:0 6px 18px rgba(239,75,155,.35);" +
    "text-align:center;cursor:pointer;animation:bannerAlertaRecepcionPulso 1.4s ease infinite;";
  banner.addEventListener("click", () => {
    sonarBeep();
    cambiarTab("Recepcion");
  });
  document.body.appendChild(banner);

  if (!el("estiloBannerAlertaRecepcion")) {
    const estilo = document.createElement("style");
    estilo.id = "estiloBannerAlertaRecepcion";
    estilo.textContent =
      "@keyframes bannerAlertaRecepcionPulso{0%,100%{transform:scale(1);}50%{transform:scale(1.015);}}";
    document.head.appendChild(estilo);
  }
}

function sincronizarAlertaRecepcion() {
  asegurarBannerAlertaRecepcion();
  const hayAlarma = !!alarmaRecepcionIntervalo;
  const enPestanaRecepcion = el("tabRecepcion").classList.contains("activo");
  el("alertaTabRecepcion").hidden = !hayAlarma;
  el("bannerAlertaRecepcion").hidden = !hayAlarma || enPestanaRecepcion;
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
  detenerControlRemoto();
  grupoActual = null;
  alumnasPanel = [];
  calificacionHoyActual = null;
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
  detenerControlRemoto();
  maestraId = "";
  nombreMaestra = "";
  gruposMaestra = [];
  grupoActual = null;
  alumnasPanel = [];
  calificacionHoyActual = null;
  el("inputClaveMaestra").value = "";
  // "Salir" es un cierre de sesión de verdad: borra también la sesión
  // compartida, para que no vuelva a entrar sola la próxima vez que abra
  // esta pantalla (ni el Portal de Maestras ni el Chat de Maestras).
  borrarSesionMaestraCompartida();
  mostrarPantalla("pantallaLogin");
});

// ---------- sesión compartida (Portal de Maestras) ----------
// Si ya inició sesión antes (en el Portal de Maestras o en el Chat de
// Maestras), entra directo a sus grupos sin pedirle la clave otra vez.
const sesionCompartidaClase = leerSesionMaestraCompartida();
if (sesionCompartidaClase && sesionCompartidaClase.clave) {
  entrarMaestra(sesionCompartidaClase.clave);
}
