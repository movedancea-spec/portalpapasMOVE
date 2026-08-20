// ==========================================
// MOVE PORTAL DE ALUMNAS
// MOVE Dance Academy
// ==========================================
// Esta página solo habla con el Worker de Cloudflare por fetch().
// El Worker es el único lugar donde vive la clave de Airtable;
// nunca está en este archivo. Lo que se muestra en el perfil de
// cada alumna se define desde la tabla "CONFIGURACION PORTAL
// ALUMNAS" en Airtable, no está escrito a mano aquí.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

// Llave pública VAPID (no es secreta — se usa del lado del navegador
// para suscribirse a notificaciones push). Con esta MISMA suscripción
// se avisa tanto la asistencia del biométrico (la manda el Worker
// move-checkin-v2) como los mensajes nuevos del Chat de Maestras (los
// manda el Worker portalalumnas, worker.js). Por eso la llave PRIVADA
// tiene que estar guardada, con el mismo valor, como Secret
// VAPID_PRIVATE_KEY en LOS DOS Workers. Si algún día se regenera la
// llave, hay que actualizar este valor Y los dos Secrets al mismo
// tiempo (si no, las suscripciones viejas dejan de servir).
const VAPID_PUBLIC_KEY =
  "BCDloougzpanTx9ZqIX5pEUVkCfwJqSZzxZUFmvm41gUQRzuyecawgi4WZhSePFEoY0DpAm-CvmPrWOJYx8Mvlk";

// Nombre EXACTO del campo "autorizo el show" en Airtable (tal como está
// guardado en CONFIGURACION PORTAL ALUMNAS → CAMPO EN ALUMNAS), para
// reconocer de forma confiable esa fila del perfil y mostrarla con su
// propio control editable Sí/No, igual que ya se hace con CUMPLEAÑOS y
// CORREO. Ojo: tiene espacios dobles (después de "ACEPTO", después de
// la coma tras "MISMO," y después de "TRAJES") — debe coincidir letra
// por letra con el nombre real del campo.
const CAMPO_PARTICIPACION_SHOW =
  "AUTORIZO QUE MI HIJA/O PARTICIPE EN EL SHOW DE FIN DE AÑO Y ACEPTO  LOS REQUISITOS PARA PARTICIPAR EN EL MISMO,  ASIMISMO ACEPTO Y ME COMPROMETO A REALIZAR LOS PAGOS CORRESPONDIENTES DE CADA UNO DE SUS TRAJES  EN LAS FECHAS ESTABLECIDAS.";

let alumnas = [];
let alumnaSeleccionada = null;
let pagoActual = null;
let pagosEspecialesActuales = []; // lista actual de Pagos Especiales, para poder refrescar un solo botón sin recargar todo el perfil
let claveActual = ""; // la clave con la que la alumna entró, se usa para confirmar cambios de clave

// ---------- clave familiar compartida (funciona en CUALQUIER dispositivo) ----------
// A diferencia del bloque de arriba (que solo recuerda cosas en ESTE
// navegador), la clave familiar vive en Airtable (tabla FAMILIAS
// PORTAL): con ella se ve a todas las hermanas juntas sin importar
// desde qué celular o computadora se entre. Aquí solo guardamos, de
// forma opcional, la ÚLTIMA clave familiar usada en este navegador
// para ofrecer un botón de acceso rápido — pero si no está guardada,
// de todos modos se puede escribir la clave desde cualquier lado.
const LLAVE_CLAVE_FAMILIAR = "moveClaveFamiliarGuardada";

let modoFamilia = false; // true mientras se está viendo el perfil vía clave familiar
let datosHijasFamilia = []; // perfiles completos de las hermanas (ya cargados, sin llamadas extra)
let nombreFamiliaActual = "";
let familiaIdActual = null; // ID del registro en FAMILIAS PORTAL, para poder cambiar su clave
let claveFamiliarActual = ""; // la clave familiar con la que se entró, se usa para confirmar el cambio
let hermanaSeleccionadaUnir = null; // hermana elegida en el buscador de "unir con otra hija"
let hijaSeleccionadaRecuperarFamiliar = null; // hija elegida en el buscador de "olvidé la clave familiar"

function guardarClaveFamiliarLocal(clave, nombreFamilia) {
  try {
    localStorage.setItem(LLAVE_CLAVE_FAMILIAR, JSON.stringify({ clave, nombreFamilia }));
  } catch (e) {
    // Igual que arriba: si no se puede guardar, el portal sigue
    // funcionando, solo no ofrece el atajo la próxima vez.
  }
}

function cargarClaveFamiliarLocal() {
  try {
    return JSON.parse(localStorage.getItem(LLAVE_CLAVE_FAMILIAR) || "null");
  } catch (e) {
    return null;
  }
}

function borrarClaveFamiliarLocal() {
  try {
    localStorage.removeItem(LLAVE_CLAVE_FAMILIAR);
  } catch (e) {}
}

function actualizarBotonFamiliaGuardada() {
  const btn = el("btnEntrarFamiliaGuardada");
  if (!btn) return;
  const guardado = cargarClaveFamiliarLocal();
  if (guardado && guardado.clave) {
    btn.hidden = false;
    btn.textContent = `👨‍👩‍👧‍👦 Entrar como ${guardado.nombreFamilia || "familia"}`;
  } else {
    btn.hidden = true;
  }
}

// Lugar original del botón de historial y del bloque de objetivo
// mensual en el HTML estático, para poder devolverlos ahí antes de
// cada render (ver renderPerfil) — evita el bug de "nodo huérfano" si
// cont.innerHTML se limpia mientras el nodo sigue adentro.
let btnHistorialPagosPadreOriginal = null;
let btnHistorialPagosHermanoOriginal = null;
let bloqueObjetivosMensualesPadreOriginal = null;
let bloqueObjetivosMensualesHermanoOriginal = null;

// Intervalo para revisar mensajes nuevos del chat mientras esa
// pantalla está abierta (se detiene al salir, ver mostrarPantalla).
let chatPollingInterval = null;
let maestraSeleccionadaChat = null;

const TAMANO_MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB
// La foto de perfil usa un límite más chico porque la API de adjuntos de
// Airtable (uploadAttachment) solo acepta hasta 5 MB por archivo.
const TAMANO_MAX_FOTO = 5 * 1024 * 1024; // 5 MB

const ESTADOS_BADGE = {
  PAGADO: "badge-pagado",
  PENDIENTE: "badge-pendiente",
  AUSENTE: "badge-malo",
  ANULADO: "badge-malo",
  "EN REVISION": "badge-neutro",
  PRUEBA: "badge-neutro",
  GENERADO: "badge-neutro",
};

function claseBadge(texto) {
  const clave = (texto || "").toString().trim().toUpperCase();
  return ESTADOS_BADGE[clave] || null;
}

function el(id) {
  return document.getElementById(id);
}

// ---------- decoración de temporada (un tema por mes, todo el año) ----------

const EMOJIS_TEMA = {
  "back-to-dance": ["📚", "🩰", "🎒", "✨", "👟"],
  carino: ["💕", "❤️", "💌", "🌹", "💗"],
  mujer: ["💜", "🌷", "✨", "👑", "💪"],
  danza: ["💃", "🕺", "🎶", "✨", "👯"],
  madre: ["💐", "🌸", "💖", "🌷", "👩‍👧"],
  padre: ["👔", "💙", "🎩", "⭐", "👨‍👧"],
  independencia: ["🇬🇹", "🎆", "🔥", "💙", "🤍"],
  nino: ["🎈", "🧸", "🎨", "🎠", "🍭"],
  halloween: ["🎃", "👻", "🕸️", "🦇", "🕷️"],
  show: ["🎭", "🌟", "✨", "🎬", "👑"],
  navidad: ["❄️", "🎄", "🎅", "⛄", "🎁"],
  cumple: ["🎈", "🎉", "🎊", "🍰", "✨"],
};

// Cómo se mueven las partículas de cada tema: "cae" (bajan, como
// confeti o nieve), "sube" (suben, como globos) o "flota" (se
// mecen en su lugar, como fantasmas).
const ESTILO_PARTICULA = {
  "back-to-dance": "sube",
  carino: "cae",
  mujer: "flota",
  danza: "flota",
  madre: "cae",
  padre: "cae",
  independencia: "cae",
  nino: "sube",
  halloween: "flota",
  show: "cae",
  navidad: "cae",
  cumple: "sube",
};

const BANNER_TEXTO = {
  "back-to-dance": "✨ ¡Bienvenidas de vuelta a MOVE!",
  carino: "💕 ¡Feliz Día del Cariño!",
  mujer: "💜 ¡Feliz Día de la Mujer!",
  danza: "💃 ¡Feliz Mes de la Danza!",
  madre: "💐 ¡Feliz Día de la Madre!",
  padre: "💙 ¡Feliz Día del Padre!",
  independencia: "🇬🇹 ¡Feliz Independencia, Guatemala!",
  nino: "🎈 ¡Feliz Día del Niño!",
  halloween: "🎃 ¡Feliz Halloween!",
  show: "🌟 ¡Se viene nuestro Show de Fin de Año! 🌟",
  navidad: "🎄 ¡Feliz Navidad!",
};

// Un tema por mes, todo el año. Julio y agosto se quedan sin tema
// especial (portal normal). Para probar cualquiera sin esperar al mes
// correcto, se puede abrir la página con ?temaPrueba=nombreDelTema al
// final del link (por ejemplo ?temaPrueba=danza o ?temaPrueba=cumple)
// — solo para pruebas, quítalo del link cuando termines de revisar.
const TEMA_POR_MES = {
  1: "back-to-dance",
  2: "carino",
  3: "mujer",
  4: "danza",
  5: "madre",
  6: "padre",
  9: "independencia",
  10: "halloween",
  11: "show",
  12: "navidad",
};

// Excepciones de un solo día dentro de un mes (formato "mes-día"),
// que interrumpen por ese único día el tema del mes completo. Por
// ahora solo el 1 de octubre (Día del Niño) interrumpe a Halloween;
// el resto de octubre sigue siendo Halloween normal.
const TEMA_POR_DIA_ESPECIFICO = {
  "10-1": "nino",
};

function obtenerTemaDelDia() {
  const forzado = new URLSearchParams(window.location.search).get("temaPrueba");
  if (forzado && EMOJIS_TEMA[forzado]) return forzado;

  const hoy = new Date();
  const mes = hoy.getMonth() + 1; // 1-12
  const claveDia = `${mes}-${hoy.getDate()}`;

  return TEMA_POR_DIA_ESPECIFICO[claveDia] || TEMA_POR_MES[mes] || null;
}

// Compara solo mes y día (ignora el año) contra la fecha "AAAA-MM-DD"
// que manda el campo CUMPLEAÑOS.
function esHoyElCumpleanos(fechaISO) {
  if (!fechaISO) return false;
  const partes = fechaISO.split("-");
  if (partes.length !== 3) return false;
  const hoy = new Date();
  return Number(partes[1]) === hoy.getMonth() + 1 && Number(partes[2]) === hoy.getDate();
}

function limpiarDecoracion() {
  Object.keys(EMOJIS_TEMA).forEach((t) => document.body.classList.remove("tema-" + t));
  el("temaDecoracion").innerHTML = "";
  const banner = el("temaBanner");
  banner.hidden = true;
  banner.className = "tema-banner";
}

function aplicarDecoracion(tema, nombre) {
  limpiarDecoracion();
  if (!tema) return;

  document.body.classList.add("tema-" + tema);

  const emojis = EMOJIS_TEMA[tema] || [];
  const cont = el("temaDecoracion");
  const estilo = ESTILO_PARTICULA[tema] || "cae";

  for (let i = 0; i < 18; i++) {
    const span = document.createElement("span");
    span.className = "tema-particula " + estilo;
    span.textContent = emojis[i % emojis.length];
    span.style.left = Math.random() * 96 + "%";
    span.style.fontSize = 1.2 + Math.random() * 1.3 + "rem";
    span.style.animationDuration = 6 + Math.random() * 8 + "s";
    span.style.animationDelay = Math.random() * 8 + "s";
    if (estilo === "flota") {
      span.style.top = Math.random() * 85 + "%";
    }
    cont.appendChild(span);
  }

  const banner = el("temaBanner");
  banner.className = "tema-banner " + tema;
  banner.textContent =
    tema === "cumple"
      ? "🎉 ¡Feliz cumpleaños, " + (nombre || "") + "! 🎉"
      : BANNER_TEXTO[tema] || "";
  banner.hidden = false;
}

function mostrarPantalla(id) {
  const pantallas = [
    "pantallaCargando",
    "pantallaAlumna",
    "pantallaClave",
    "pantallaPerfil",
    "pantallaEvaluaciones",
    "pantallaHistorialPagos",
    "pantallaMensajesAnuncios",
    "pantallaMensajesMaestra",
    "pantallaAvisosEntradas",
    "pantallaSelectorMaestra",
    "pantallaChat",
  ];
  pantallas.forEach((p) => {
    el(p).hidden = p !== id;
  });
  // Si nos vamos de la pantalla de chat, dejamos de revisar mensajes
  // nuevos cada pocos segundos (no tiene sentido seguir preguntando
  // si ya no se está viendo).
  if (id !== "pantallaChat") {
    detenerPollingChat();
  }
  mostrarError("");
}

function mostrarError(msg) {
  el("mensajeError").textContent = msg || "";
}

async function llamarWorker(payload) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const datos = await res.json();
  if (!datos.success) {
    throw new Error(datos.error || "Ocurrió un error inesperado.");
  }
  return datos;
}

async function iniciar() {
  aplicarDecoracion(obtenerTemaDelDia());
  mostrarPantalla("pantallaCargando");
  actualizarBotonFamiliaGuardada();
  try {
    const datos = await llamarWorker({ accion: "alumnas" });
    alumnas = datos.alumnas || [];
    renderAlumnas("");
    mostrarPantalla("pantallaAlumna");
  } catch (e) {
    mostrarPantalla("pantallaAlumna");
    mostrarError("No se pudo conectar: " + e.message);
  }
}

function renderAlumnas(filtro) {
  const cont = el("listaAlumnas");
  cont.innerHTML = "";
  const texto = (filtro || "").trim().toLowerCase();

  // Ya no mostramos el listado completo de alumnas al abrir el portal
  // (por privacidad, para que un papá no vea los nombres de todas las
  // demás). Solo aparece algo aquí cuando escriben un nombre a buscar.
  if (!texto) {
    const aviso = document.createElement("p");
    aviso.className = "lista-alumnas-aviso";
    aviso.textContent = "Escribe el nombre de tu bailarina para buscarla.";
    cont.appendChild(aviso);
    return;
  }

  const filtradas = alumnas.filter((a) => a.nombre.toLowerCase().includes(texto));

  if (filtradas.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "lista-alumnas-aviso";
    vacio.textContent = "No encontramos ese nombre. Revisa cómo lo escribiste.";
    cont.appendChild(vacio);
    return;
  }

  filtradas.slice(0, 30).forEach((a) => {
    const btn = document.createElement("button");
    btn.textContent = a.nombre;
    btn.addEventListener("click", () => seleccionarAlumna(a));
    cont.appendChild(btn);
  });
}

function seleccionarAlumna(a) {
  alumnaSeleccionada = a;
  el("nombreElegido").textContent = a.nombre;
  el("inputClave").value = "";
  el("mensajeRecuperarClave").hidden = true;
  mostrarPantalla("pantallaClave");
  el("inputClave").focus();
}

async function entrar() {
  const clave = el("inputClave").value.trim();
  if (!clave) {
    mostrarError("Escribe tu clave del portal.");
    return;
  }

  const btn = el("btnEntrar");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Entrando...";
  mostrarError("");

  try {
    const datos = await llamarWorker({
      accion: "entrar",
      alumnaId: alumnaSeleccionada.id,
      clave,
    });
    claveActual = clave;
    modoFamilia = false;
    datosHijasFamilia = [];
    familiaIdActual = null;
    claveFamiliarActual = "";

    mostrarPerfilDesdeDatos(datos);
  } catch (e) {
    mostrarError(e.message);
    el("inputClave").value = "";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- entrar con clave familiar (funciona en cualquier dispositivo) ----------

async function entrarConClaveFamiliar(claveGuardada) {
  const esAtajo = claveGuardada !== undefined;
  const clave = (esAtajo ? claveGuardada : el("inputClaveFamiliar").value).toString().trim();

  if (!clave) {
    mostrarError("Escribe la clave familiar.");
    return;
  }

  const btn = esAtajo ? el("btnEntrarFamiliaGuardada") : el("btnEntrarFamilia");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Entrando...";
  mostrarError("");

  try {
    const datos = await llamarWorker({ accion: "entrarFamilia", claveFamiliar: clave });
    const hijas = datos.hijas || [];
    if (!hijas.length) {
      throw new Error("Esta familia no tiene hijas para mostrar.");
    }

    modoFamilia = true;
    datosHijasFamilia = hijas;
    nombreFamiliaActual = datos.nombreFamilia || "";
    familiaIdActual = datos.familiaId || null;
    claveFamiliarActual = clave;
    guardarClaveFamiliarLocal(clave, nombreFamiliaActual);
    actualizarBotonFamiliaGuardada();

    el("inputClaveFamiliar").value = "";
    el("bloqueClaveFamiliar").hidden = true;

    mostrarPerfilDesdeDatos(hijas[0]);
  } catch (e) {
    if (esAtajo) {
      // La clave guardada ya no sirve (la cambiaron en Airtable) —
      // la quitamos para no seguir ofreciéndola sola.
      borrarClaveFamiliarLocal();
      actualizarBotonFamiliaGuardada();
    }
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- pinta en pantalla el perfil ya cargado de una alumna ----------
// La usan "entrar" (login individual) y "entrarConClaveFamiliar"
// (varias hermanas de una vez) — así el render queda en un solo
// lugar sin importar de dónde vinieron los datos.
function mostrarPerfilDesdeDatos(datos) {
  alumnaSeleccionada = { id: datos.id, nombre: datos.nombre };

  renderChipsFamilia();
  renderPerfil(datos);
  renderPago(datos.pago);
  renderPagosEspeciales(datos.pagosEspeciales);
  el("inputClaveNueva").value = "";
  el("inputClaveConfirmar").value = "";
  el("mensajeClaveOk").hidden = true;
  el("inputClaveFamiliarNueva").value = "";
  el("inputClaveFamiliarConfirmar").value = "";
  el("mensajeClaveFamiliarOk").hidden = true;
  el("bloqueUnirFamilia").hidden = true;
  el("bloqueConfirmarUnir").hidden = true;
  el("buscarHermanaUnir").value = "";
  el("listaHermanaUnir").innerHTML = "";
  hermanaSeleccionadaUnir = null;
  actualizarSeccionCambiarClave();

  // El cumpleaños de HOY es más especial que el tema del mes, así
  // que si es su día, ese decora por encima de Halloween/Navidad.
  const filaCumple = (datos.perfil || []).find((f) => f.campo === "CUMPLEAÑOS");
  const esCumpleHoy = filaCumple && esHoyElCumpleanos(filaCumple.valor);
  const tema = esCumpleHoy ? "cumple" : obtenerTemaDelDia();
  aplicarDecoracion(tema, datos.nombre || alumnaSeleccionada.nombre);

  mostrarPantalla("pantallaPerfil");
  window.scrollTo({ top: 0, behavior: "smooth" });

  // No se espera (sin "await" a propósito): revisa/ofrece activar las
  // notificaciones push en segundo plano, sin retrasar que se vea el
  // perfil. Ver sección "NOTIFICACIONES PUSH" más abajo.
  actualizarBloqueNotificacionesPush();

  // Los Mensajes de Recepción y los Avisos de la maestra ya NO se
  // muestran solos al entrar — quedan detrás de sus propios botones
  // ("📢 Mensajes de Recepción" / "👩‍🏫 Mensajes de tu maestra"), cada
  // uno abre su propia pantalla con TODO el historial de este mes y
  // la fecha/hora exacta de cada uno (ver secciones "MENSAJES DE
  // RECEPCIÓN" y "AVISO DE LA MAESTRA" más abajo) — así queda un
  // registro real al que se puede volver, en vez de un mensaje que
  // aparece un momento y ya.

  // El panel de ingresos del mes se arma plegado (no pide datos al
  // Worker hasta que lo abran) — ver sección más abajo.
  cargarAsistenciaMes();
}

// ==========================================
// MENSAJES DE RECEPCIÓN (anuncios/recordatorios generales que
// Recepción manda a todas las familias — ej. "no hay clases el
// lunes") — viven detrás del botón "📢 Mensajes de Recepción" en el
// perfil, con fecha y hora de cuándo se mandó cada uno, para que quede
// un registro real al que la familia pueda volver. Solo se muestran
// los del MES EN CURSO; el mes que viene, esta pantalla simplemente
// deja de traerlos (el historial completo se queda guardado para
// siempre en Airtable, tabla ANUNCIOS, eso nunca se borra).
// ==========================================

// Fecha y hora en la zona horaria de Guatemala, en un formato corto y
// legible (ej. "15 ago, 3:45 p.m.") — mismo formato que ya se usa para
// los videos de clase, para que el portal se vea consistente.
function formatearFechaHoraMensajePortal(iso) {
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

el("btnMensajesAnuncios").addEventListener("click", abrirMensajesAnuncios);
el("btnAtrasMensajesAnuncios").addEventListener("click", () => mostrarPantalla("pantallaPerfil"));

async function abrirMensajesAnuncios() {
  mostrarPantalla("pantallaMensajesAnuncios");
  const cont = el("listaMensajesAnuncios");
  cont.innerHTML = '<p class="lista-alumnas-aviso">Cargando...</p>';

  try {
    const datos = await llamarWorker({ accion: "obtenerAnunciosMes", publico: "Familias" });
    renderMensajesAnuncios(datos.anuncios || []);
  } catch (e) {
    cont.innerHTML = "";
    mostrarError(e.message);
  }
}

function renderMensajesAnuncios(anuncios) {
  const cont = el("listaMensajesAnuncios");
  cont.innerHTML = "";

  if (!anuncios.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Todavía no hay mensajes de Recepción este mes.</p>';
    return;
  }

  anuncios.forEach((a) => {
    const caja = document.createElement("div");
    caja.style.cssText =
      "background:#fff0f6;border:1px solid #ffd3e6;border-radius:14px;padding:12px 14px;margin:0 0 10px;";

    const fecha = document.createElement("p");
    fecha.textContent = "🕐 " + formatearFechaHoraMensajePortal(a.fecha);
    fecha.style.cssText = "font-weight:700;font-size:11.5px;color:#a15277;margin:0 0 4px;";
    caja.appendChild(fecha);

    const titulo = document.createElement("p");
    titulo.textContent = "📢 " + a.titulo;
    titulo.style.cssText = "font-weight:700;font-size:14.5px;color:#c2185b;margin:0 0 4px;";
    caja.appendChild(titulo);

    const cuerpo = document.createElement("p");
    cuerpo.textContent = a.mensaje;
    cuerpo.style.cssText = "font-size:13.5px;color:#444;margin:0;white-space:pre-line;";
    caja.appendChild(cuerpo);

    if (a.adjunto && a.adjunto.url) {
      caja.appendChild(crearAdjuntoAnuncio(a.adjunto));
    }

    cont.appendChild(caja);
  });
}

// La imagen/PDF que Recepción haya adjuntado al anuncio (opcional):
// si es imagen, se ve directo como miniatura clickeable; si es
// cualquier otra cosa (normalmente un PDF), se muestra como un enlace
// "Ver archivo" que lo abre en una pestaña nueva.
function crearAdjuntoAnuncio(adjunto) {
  const esImagen = (adjunto.tipo || "").startsWith("image/");

  if (esImagen) {
    const img = document.createElement("img");
    img.src = adjunto.url;
    img.alt = adjunto.filename || "Adjunto del anuncio";
    img.style.cssText = "display:block;max-width:100%;border-radius:10px;margin-top:10px;cursor:pointer;";
    img.addEventListener("click", () => window.open(adjunto.url, "_blank", "noopener"));
    return img;
  }

  const enlace = document.createElement("a");
  enlace.href = adjunto.url;
  enlace.target = "_blank";
  enlace.rel = "noopener";
  enlace.textContent = "📎 Ver " + (adjunto.filename || "archivo adjunto");
  enlace.style.cssText = "display:inline-block;margin-top:10px;font-size:13px;color:#c2185b;font-weight:600;text-decoration:underline;";
  return enlace;
}

// ==========================================
// MENSAJES DE TU MAESTRA (avisos que la maestra de cada grupo le manda
// SOLO a las alumnas de ESE grupo — a diferencia de los Mensajes de
// Recepción, que van a TODAS las familias) — viven detrás del botón
// "👩‍🏫 Mensajes de tu maestra" en el perfil, con fecha y hora de
// cuándo se mandó cada uno. Igual que los de Recepción, solo se
// muestran los del MES EN CURSO; el mes que viene esta pantalla deja
// de traerlos, pero el historial completo se queda guardado para
// siempre en Airtable, tabla AVISOS MAESTRA. Siempre llega por el
// Portal (nunca por WhatsApp).
// ==========================================

el("btnMensajesMaestra").addEventListener("click", abrirMensajesMaestra);
el("btnAtrasMensajesMaestra").addEventListener("click", () => mostrarPantalla("pantallaPerfil"));

async function abrirMensajesMaestra() {
  mostrarPantalla("pantallaMensajesMaestra");
  const cont = el("listaMensajesMaestra");
  cont.innerHTML = '<p class="lista-alumnas-aviso">Cargando...</p>';

  if (!alumnaSeleccionada || !alumnaSeleccionada.id) {
    cont.innerHTML = "";
    return;
  }

  try {
    const datos = await llamarWorker({ accion: "avisosMaestraDeAlumna", alumnaId: alumnaSeleccionada.id });
    renderMensajesMaestra(datos.avisos || []);
  } catch (e) {
    cont.innerHTML = "";
    mostrarError(e.message);
  }
}

function renderMensajesMaestra(avisos) {
  const cont = el("listaMensajesMaestra");
  cont.innerHTML = "";

  if (!avisos.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Todavía no hay mensajes de tu maestra este mes.</p>';
    return;
  }

  avisos.forEach((a) => {
    const caja = document.createElement("div");
    caja.style.cssText =
      "background:#f4f0ff;border:1px solid #ddd2ff;border-radius:14px;padding:12px 14px;margin:0 0 10px;";

    const firma = document.createElement("p");
    const deQuien = [a.maestra, a.grupo].filter(Boolean).join(" · ");
    firma.textContent = "👩‍🏫 " + (deQuien || "Tu maestra") + " · 🕐 " + formatearFechaHoraMensajePortal(a.fecha);
    firma.style.cssText = "font-weight:700;font-size:11.5px;color:#7a5cd6;margin:0 0 4px;";
    caja.appendChild(firma);

    const titulo = document.createElement("p");
    titulo.textContent = a.titulo;
    titulo.style.cssText = "font-weight:700;font-size:14.5px;color:#4b2ea8;margin:0 0 4px;";
    caja.appendChild(titulo);

    const cuerpo = document.createElement("p");
    cuerpo.textContent = a.mensaje;
    cuerpo.style.cssText = "font-size:13.5px;color:#444;margin:0;white-space:pre-line;";
    caja.appendChild(cuerpo);

    if (a.adjunto && a.adjunto.url) {
      caja.appendChild(crearAdjuntoAnuncio(a.adjunto));
    }

    cont.appendChild(caja);
  });
}

// ==========================================
// AVISOS DE ENTRADAS (registro, turno y compra de la venta de
// entradas del show por turnos) — viven detrás del botón "🎟️ Avisos
// de entradas" en el perfil. A diferencia de los Mensajes de
// Recepción/Maestra, estos NUNCA se mandan por WhatsApp: reemplazan
// esos 3 WhatsApp de siempre (registro exitoso, "ya es tu turno" y
// confirmación de compra) — se ven únicamente aquí, y se quedan
// guardados para siempre (no se filtran por mes).
// ==========================================

el("btnAvisosEntradas").addEventListener("click", abrirAvisosEntradas);
el("btnAtrasAvisosEntradas").addEventListener("click", () => mostrarPantalla("pantallaPerfil"));

async function abrirAvisosEntradas() {
  mostrarPantalla("pantallaAvisosEntradas");
  const cont = el("listaAvisosEntradas");
  cont.innerHTML = '<p class="lista-alumnas-aviso">Cargando...</p>';

  if (!alumnaSeleccionada || !alumnaSeleccionada.id) {
    cont.innerHTML = "";
    return;
  }

  try {
    const datos = await llamarWorker({ accion: "avisosEntradasDeAlumna", alumnaId: alumnaSeleccionada.id });
    renderAvisosEntradas(datos.avisos || []);
  } catch (e) {
    cont.innerHTML = "";
    mostrarError(e.message);
  }
}

const ETIQUETA_POR_TIPO_AVISO_ENTRADAS = {
  Registro: "📝 Registro",
  Turno: "⏰ Tu turno",
  Compra: "🎉 Compra confirmada",
};

function renderAvisosEntradas(avisos) {
  const cont = el("listaAvisosEntradas");
  cont.innerHTML = "";

  if (!avisos.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Todavía no tienes avisos de entradas.</p>';
    return;
  }

  avisos.forEach((a) => {
    const caja = document.createElement("div");
    caja.style.cssText =
      "background:#fff7e6;border:1px solid #ffe1a8;border-radius:14px;padding:12px 14px;margin:0 0 10px;";

    const firma = document.createElement("p");
    firma.textContent =
      (ETIQUETA_POR_TIPO_AVISO_ENTRADAS[a.tipo] || "🎟️ Aviso") + " · 🕐 " + formatearFechaHoraMensajePortal(a.fecha);
    firma.style.cssText = "font-weight:700;font-size:11.5px;color:#a15a00;margin:0 0 4px;";
    caja.appendChild(firma);

    const cuerpo = document.createElement("p");
    cuerpo.textContent = a.mensaje;
    cuerpo.style.cssText = "font-size:13.5px;color:#444;margin:0;white-space:pre-line;";
    caja.appendChild(cuerpo);

    cont.appendChild(caja);
  });
}

// -------------------------------------
// NOTIFICACIONES PUSH (aviso de asistencia por el Portal, en vez de
// WhatsApp) — cada familia decide desde Portal Recepción si sus avisos
// de asistencia llegan por WhatsApp o por el Portal; esto de aquí es
// SOLO para que, si eligieron "Portal", el navegador de la familia
// quede suscrito y pueda recibir esos avisos aunque no tenga el portal
// abierto (o el celular esté bloqueado).
// -------------------------------------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// iOS/iPadOS Safari SOLO entrega notificaciones push si el sitio está
// instalado en la pantalla de inicio (no funciona en una pestaña normal
// del navegador, sin importar el permiso que se conceda) — por eso, en
// iOS que todavía no está instalado como app, mostramos instrucciones
// en vez del botón de activar.
function esIOS() {
  return (
    /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function esInstaladoComoApp() {
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

function soportaNotificacionesPush() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// IDs de todas las alumnas que se están viendo ahora mismo (una sola
// en modo individual, todas las hermanas en modo familia) — la
// suscripción de este navegador/dispositivo se guarda para cada una,
// así el aviso de asistencia de CUALQUIERA de ellas llega aquí.
function idsAlumnasActuales() {
  if (modoFamilia) return datosHijasFamilia.map((d) => d.id);
  return alumnaSeleccionada ? [alumnaSeleccionada.id] : [];
}

// Nombres de la(s) alumna(s) que quedan cubiertas por las
// notificaciones de ESTE navegador en este momento — en modo familia
// (clave familiar / hijas unidas) son TODAS las hermanas a la vez; si
// no, es solo la que está viendo ahorita. Se usa para que el botón de
// activar/desactivar diga con nombre y apellido a quién cubre, en vez
// de dejarlo ambiguo.
function nombresAlumnasActuales() {
  const nombres = modoFamilia ? datosHijasFamilia.map((d) => d.nombre) : alumnaSeleccionada ? [alumnaSeleccionada.nombre] : [];
  const limpios = nombres.filter(Boolean);
  if (!limpios.length) return "";
  if (limpios.length === 1) return limpios[0];
  return limpios.slice(0, -1).join(", ") + " y " + limpios[limpios.length - 1];
}

function asegurarBloqueNotificacionesPush() {
  let bloque = el("bloqueNotificacionesPush");
  if (bloque) return bloque;
  bloque = document.createElement("div");
  bloque.id = "bloqueNotificacionesPush";
  bloque.style.margin = "14px 0";
  const listaPerfil = el("perfilLista");
  if (listaPerfil && listaPerfil.parentNode) {
    listaPerfil.parentNode.insertBefore(bloque, listaPerfil);
  }
  return bloque;
}

function crearAvisoNotificacionesPush(texto, esOk) {
  const p = document.createElement("p");
  p.textContent = texto;
  p.style.cssText =
    "font-size:13.5px;padding:10px 14px;border-radius:12px;margin:0;" +
    (esOk ? "background:#eafff1;color:#1a7f4e;" : "background:#fff7e6;color:#8a5a00;");
  return p;
}

async function actualizarBloqueNotificacionesPush() {
  const bloque = asegurarBloqueNotificacionesPush();
  if (!bloque) return;
  bloque.innerHTML = "";

  if (!soportaNotificacionesPush()) {
    // Navegador viejo o sin soporte — no molestamos con ningún aviso,
    // esa familia simplemente sigue recibiendo por WhatsApp.
    return;
  }

  if (esIOS() && !esInstaladoComoApp()) {
    bloque.appendChild(
      crearAvisoNotificacionesPush(
        "📲 Para recibir las notificaciones de asistencia en este iPhone/iPad, agrega primero el portal a tu pantalla de inicio (botón Compartir → Agregar a pantalla de inicio) y ábrelo desde ahí.",
        false
      )
    );
    return;
  }

  let suscripcionActual = null;
  try {
    const registro = await navigator.serviceWorker.ready;
    suscripcionActual = await registro.pushManager.getSubscription();

    // Si la suscripción que ya tiene este navegador quedó armada con
    // una llave VAPID VIEJA (por ejemplo, porque se tuvo que
    // regenerar), el navegador jamás la deja "reactivar" con la llave
    // nueva sin antes darla de baja — y mostrarle a la familia "ya
    // están activadas" sería mentira, porque esa suscripción vieja ya
    // no le sirve a los Workers. La damos de baja sola, sin pedirle
    // nada, para que abajo aparezca de nuevo el botón de activar y
    // quede al día con un solo toque.
    if (suscripcionActual) {
      const llaveActualBytes = new Uint8Array(suscripcionActual.options.applicationServerKey);
      const llaveEsperadaBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const coinciden =
        llaveActualBytes.length === llaveEsperadaBytes.length &&
        llaveActualBytes.every((b, i) => b === llaveEsperadaBytes[i]);
      if (!coinciden) {
        try {
          const alumnaIds = idsAlumnasActuales();
          await llamarWorker({
            accion: "eliminarSuscripcionPush",
            alumnaIds,
            endpoint: suscripcionActual.endpoint,
          });
        } catch (e) {
          // No pasa nada si esto falla — igual la damos de baja del
          // navegador, y si quedó un registro viejo en Airtable el
          // Worker ya lo limpia solo la próxima vez que falle un envío.
        }
        await suscripcionActual.unsubscribe();
        suscripcionActual = null;
      }
    }
  } catch (e) {
    // Si algo falla revisando el estado actual, simplemente ofrecemos
    // el botón de activar más abajo.
  }

  if (Notification.permission === "granted" && suscripcionActual) {
    // Refuerzo silencioso: si el navegador YA tenía el permiso
    // concedido y una suscripción válida (por ejemplo, porque mamá ya
    // las había activado antes viendo el perfil de OTRA hija, sin
    // clave familiar), nos aseguramos de que la hija (o hijas) que se
    // están viendo AHORA MISMO también queden conectadas — sin que
    // haga falta tocar ningún botón. guardarSuscripcionPush ya
    // deduplica por endpoint, así que repetir esto no genera nada
    // duplicado, solo confirma que quede bien guardado.
    const idsParaReforzar = idsAlumnasActuales();
    if (idsParaReforzar.length) {
      llamarWorker({
        accion: "guardarSuscripcionPush",
        alumnaIds: idsParaReforzar,
        subscription: suscripcionActual.toJSON(),
      }).catch(() => {
        // Si falla, no interrumpimos nada — la próxima vez que se
        // abra el perfil se vuelve a intentar solo.
      });
    }

    const nombres = nombresAlumnasActuales();
    bloque.appendChild(
      crearAvisoNotificacionesPush(
        "🔔 Las notificaciones del portal están activadas en este dispositivo" +
          (nombres ? " para " + nombres + "." : "."),
        true
      )
    );
    const btnDesactivar = document.createElement("button");
    btnDesactivar.type = "button";
    btnDesactivar.className = "btn-enlace";
    btnDesactivar.textContent = "Desactivar notificaciones en este dispositivo";
    btnDesactivar.addEventListener("click", () => desactivarNotificacionesPush(btnDesactivar, suscripcionActual));
    bloque.appendChild(btnDesactivar);
    return;
  }

  if (Notification.permission === "denied") {
    bloque.appendChild(
      crearAvisoNotificacionesPush(
        "🔕 Bloqueaste las notificaciones de este sitio. Si quieres recibir avisos por el portal, actívalas desde los ajustes de notificaciones de tu navegador.",
        false
      )
    );
    return;
  }

  const nombresParaActivar = nombresAlumnasActuales();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-secundario btn-ancho";
  btn.textContent = "🔔 Activar notificaciones" + (nombresParaActivar ? " para " + nombresParaActivar : " del portal");
  btn.addEventListener("click", () => activarNotificacionesPush(btn));
  bloque.appendChild(btn);
}

async function activarNotificacionesPush(btn) {
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Activando...";
  mostrarError("");

  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      throw new Error("El permiso de notificaciones no quedó concedido.");
    }

    const registro = await navigator.serviceWorker.ready;
    let suscripcion = await registro.pushManager.getSubscription();
    if (!suscripcion) {
      suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const alumnaIds = idsAlumnasActuales();
    if (!alumnaIds.length) {
      throw new Error("No se pudo identificar a la alumna para guardar la suscripción.");
    }

    await llamarWorker({
      accion: "guardarSuscripcionPush",
      alumnaIds,
      subscription: suscripcion.toJSON(),
    });

    await actualizarBloqueNotificacionesPush();
  } catch (e) {
    mostrarError("No se pudieron activar las notificaciones: " + e.message);
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// Quita las notificaciones SOLO de este navegador/dispositivo — si la
// familia tiene otro celular suscrito (ej. el de papá), ese sigue
// recibiendo avisos normal. Primero avisamos al Worker (mientras
// todavía tenemos a mano el "endpoint" de esta suscripción) y luego
// cancelamos la suscripción del lado del navegador.
async function desactivarNotificacionesPush(btn, suscripcion) {
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Desactivando...";
  mostrarError("");

  try {
    const alumnaIds = idsAlumnasActuales();
    await llamarWorker({
      accion: "eliminarSuscripcionPush",
      alumnaIds,
      endpoint: suscripcion.endpoint,
    });
    await suscripcion.unsubscribe();
    await actualizarBloqueNotificacionesPush();
  } catch (e) {
    mostrarError("No se pudieron desactivar las notificaciones: " + e.message);
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// -------------------------------------
// INGRESOS DEL MES EN CURSO (marcas del biométrico)
// -------------------------------------
// Panel plegable (mismo patrón que "Objetivo mensual de clases" y
// "Videos de mis clases") con la lista de días/horas en que la alumna
// marcó su ingreso este mes. Se pregunta siempre por el mes Y año en
// curso — no se borra nada de Airtable, simplemente el mes siguiente
// esta lista vuelve a arrancar vacía sola, sin que nadie tenga que
// borrar nada a mano.
// -------------------------------------

const NOMBRES_MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function asegurarBloqueAsistenciaMes() {
  let bloque = el("bloqueAsistenciaMes");
  if (bloque) return bloque;
  bloque = document.createElement("div");
  bloque.id = "bloqueAsistenciaMes";
  bloque.style.margin = "14px 0";
  const listaPerfil = el("perfilLista");
  if (listaPerfil && listaPerfil.parentNode) {
    listaPerfil.parentNode.insertBefore(bloque, listaPerfil);
  }
  return bloque;
}

function cargarAsistenciaMes() {
  const bloque = asegurarBloqueAsistenciaMes();
  if (!bloque || !alumnaSeleccionada) return;
  bloque.innerHTML = "";

  const mesActual = NOMBRES_MESES_LARGOS[new Date().getMonth()];
  const textoCerrado = `📅 Ingresos de ${mesActual}`;
  const textoAbierto = `📅 Ocultar ingresos de ${mesActual}`;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-secundario btn-ancho";
  btn.textContent = textoCerrado;

  const panel = document.createElement("div");
  panel.hidden = true;
  panel.style.marginTop = "10px";

  btn.addEventListener("click", async () => {
    if (panel.hidden && !panel.dataset.cargado) {
      panel.hidden = false;
      btn.textContent = textoAbierto;
      panel.innerHTML = '<p class="lista-alumnas-aviso">Cargando...</p>';
      try {
        const datos = await llamarWorker({ accion: "obtenerAsistenciaMes", alumnaId: alumnaSeleccionada.id });
        renderAsistenciaMes(panel, datos.registros || [], mesActual);
        panel.dataset.cargado = "1";
      } catch (e) {
        panel.innerHTML = `<p class="lista-alumnas-aviso">${e.message}</p>`;
      }
    } else {
      panel.hidden = !panel.hidden;
      btn.textContent = panel.hidden ? textoCerrado : textoAbierto;
    }
  });

  bloque.appendChild(btn);
  bloque.appendChild(panel);
}

function renderAsistenciaMes(panel, registros, mesActual) {
  panel.innerHTML = "";

  if (!registros.length) {
    const vacio = document.createElement("p");
    vacio.className = "lista-alumnas-aviso";
    vacio.textContent = `Todavía no hay ingresos registrados en ${mesActual}.`;
    panel.appendChild(vacio);
    return;
  }

  const contador = document.createElement("p");
  contador.className = "lista-alumnas-aviso";
  contador.textContent = `${registros.length} ingreso${registros.length === 1 ? "" : "s"} en ${mesActual}:`;
  panel.appendChild(contador);

  registros.forEach((r) => {
    const fila = document.createElement("p");
    fila.style.cssText =
      "font-size:13.5px;padding:9px 14px;margin:0 0 6px;border-radius:12px;background:#fff0f6;color:#8a3b5e;";
    fila.textContent = `🩰 ${r.fechaTexto} — ${r.horaTexto}`;
    panel.appendChild(fila);
  });
}

// Cuando se entró con la clave FAMILIAR (no la individual de esta
// hija), no sabemos su clave personal — así que en vez de dejar
// intentar cambiarla ahí (lo que confundiría con un "clave
// incorrecta" que en realidad es solo que no la tenemos a mano),
// mostramos el bloque para cambiar la CLAVE FAMILIAR en su lugar.
function actualizarSeccionCambiarClave() {
  const bloqueIndividual = el("bloqueCambiarClaveIndividual");
  const bloqueFamiliar = el("bloqueCambiarClaveFamiliar");
  const titulo = el("tituloCambiarClave");
  if (!bloqueIndividual || !bloqueFamiliar) return;
  bloqueIndividual.hidden = modoFamilia;
  bloqueFamiliar.hidden = !modoFamilia;
  if (titulo) {
    titulo.textContent = modoFamilia ? "🔒 Cambiar la clave familiar" : "🔒 Cambiar mi clave";
  }
}

// ---------- chips del perfil familiar ----------
// Solo existen en modo familia (clave familiar compartida): ya
// tenemos el perfil completo de todas las hermanas en memoria, así
// que cambiar de una a otra es instantáneo, sin volver a llamar al
// Worker.
function renderChipsFamilia() {
  const cont = el("chipsFamilia");
  cont.innerHTML = "";

  if (!modoFamilia || datosHijasFamilia.length < 2) return;

  datosHijasFamilia.forEach((d) => {
    const activa = alumnaSeleccionada && d.id === alumnaSeleccionada.id;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip-familia" + (activa ? " activa" : "");
    chip.textContent = d.nombre;
    chip.addEventListener("click", () => {
      if (alumnaSeleccionada && d.id === alumnaSeleccionada.id) return;
      mostrarPerfilDesdeDatos(d);
    });
    cont.appendChild(chip);
  });
}

function renderPerfil(datos) {
  el("perfilNombre").textContent = datos.nombre || alumnaSeleccionada.nombre;

  const foto = el("fotoPerfil");
  const filaFoto = (datos.perfil || []).find((f) => f.tipo === "imagen" && f.valor);
  if (filaFoto) {
    foto.src = filaFoto.valor;
    foto.hidden = false;
  } else {
    foto.hidden = true;
  }

  const cont = el("perfilLista");

  // El botón de historial y el bloque de objetivo mensual viven en el
  // HTML estático, pero los movemos de lugar cada vez que se renderiza
  // el perfil (ver más abajo). Si quedaron metidos adentro de un
  // render anterior, cont.innerHTML = "" los destruiría (no solo los
  // saca, los borra de la página), y la próxima vez que quisiéramos
  // moverlos ya no existirían en ningún lado — eso es justo lo que
  // causaba el error intermitente "Argument 1 ('node') to
  // Node.appendChild must be an instance of Node" al cambiar de una
  // alumna a otra. Por eso, antes de limpiar, los devolvemos siempre a
  // su lugar original en el HTML.
  const btnHistorial = el("btnHistorialPagos");
  if (btnHistorial && btnHistorialPagosPadreOriginal === null) {
    btnHistorialPagosPadreOriginal = btnHistorial.parentNode;
    btnHistorialPagosHermanoOriginal = btnHistorial.nextSibling;
  }
  if (btnHistorial && btnHistorialPagosPadreOriginal) {
    if (btnHistorialPagosHermanoOriginal) {
      btnHistorialPagosPadreOriginal.insertBefore(btnHistorial, btnHistorialPagosHermanoOriginal);
    } else {
      btnHistorialPagosPadreOriginal.appendChild(btnHistorial);
    }
  }

  const bloqueObjetivos = el("bloqueObjetivosMensuales");
  if (bloqueObjetivos && bloqueObjetivosMensualesPadreOriginal === null) {
    bloqueObjetivosMensualesPadreOriginal = bloqueObjetivos.parentNode;
    bloqueObjetivosMensualesHermanoOriginal = bloqueObjetivos.nextSibling;
  }
  if (bloqueObjetivos && bloqueObjetivosMensualesPadreOriginal) {
    if (bloqueObjetivosMensualesHermanoOriginal) {
      bloqueObjetivosMensualesPadreOriginal.insertBefore(bloqueObjetivos, bloqueObjetivosMensualesHermanoOriginal);
    } else {
      bloqueObjetivosMensualesPadreOriginal.appendChild(bloqueObjetivos);
    }
  }

  cont.innerHTML = "";
  (datos.perfil || [])
    .filter((f) => f.tipo !== "imagen")
    .forEach((f) => {
      // El cumpleaños se muestra siempre (aunque esté vacío) con su
      // propio control editable, para que los papás puedan corregirlo
      // si quedó mal escrito.
      if (f.campo === "CUMPLEAÑOS") {
        cont.appendChild(construirFilaCumpleanos(f));
        return;
      }

      // El correo también se muestra siempre (aunque esté vacío), con
      // su propio control editable, para que las familias que todavía
      // no lo tienen registrado lo puedan agregar ellas mismas — así
      // luego pueden usar la recuperación de clave por correo.
      if (f.campo === "CORREO") {
        cont.appendChild(construirFilaCorreo(f));
        return;
      }

      // La participación en el show también se muestra siempre (aunque
      // todavía no hayan respondido), con botones de Sí/No para que la
      // familia pueda contestar o cambiar su respuesta ella misma.
      if (f.campo === CAMPO_PARTICIPACION_SHOW) {
        cont.appendChild(construirFilaParticipacionShow(f));
        return;
      }

      if (!f.valor) return;
      const fila = document.createElement("div");
      fila.className = "perfil-fila";

      const etiqueta = document.createElement("p");
      etiqueta.className = "perfil-etiqueta";
      etiqueta.textContent = f.etiqueta;

      const valor = document.createElement("p");
      valor.className = "perfil-valor";

      const clase = claseBadge(f.valor);
      if (clase) {
        const badge = document.createElement("span");
        badge.className = "badge-estado " + clase;
        badge.textContent = f.valor;
        valor.appendChild(badge);
      } else {
        valor.textContent = f.valor;
      }

      fila.appendChild(etiqueta);
      fila.appendChild(valor);
      cont.appendChild(fila);

      // El botón "🎯 Objetivo mensual de clases" va justo debajo de
      // "Tu clase" (appendChild reubica el nodo, no lo duplica, así
      // que su evento de click sigue funcionando igual).
      if (f.campo === "CLASE" && bloqueObjetivos) {
        cont.appendChild(bloqueObjetivos);
      }
    });

  // El botón de historial va justo arriba de "💳 Mensualidad de este
  // mes" — no es parte de la lista de campos del perfil, así que se
  // ubica aparte, después del forEach.
  const seccionPago = el("seccionPago");
  if (btnHistorial && seccionPago && seccionPago.parentNode) {
    seccionPago.parentNode.insertBefore(btnHistorial, seccionPago);
  }

  renderBotonObjetivosMensuales(datos.objetivosMensuales || []);
  renderBotonVideosClase(datos.videos || []);
}

// Debajo de las clases de la alumna va un botón "🎯 Objetivo mensual de
// clases" — pero SOLO si hay al menos un objetivo cargado para el mes en
// curso (si ningún grupo tiene objetivo este mes, el botón ni aparece).
// Al tocarlo se abre/cierra el detalle con el objetivo de cada clase.
function renderBotonObjetivosMensuales(objetivosMensuales) {
  const btn = el("btnObjetivosMensuales");
  const panel = el("panelObjetivosMensuales");

  const conObjetivo = (objetivosMensuales || []).filter((o) => o && o.objetivo);

  panel.innerHTML = "";
  panel.hidden = true;
  btn.textContent = "🎯 Objetivo mensual de clases";

  if (!conObjetivo.length) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;

  conObjetivo.forEach((obj) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta-objetivo-mensual-portal";

    const tituloObjetivo = document.createElement("p");
    tituloObjetivo.className = "objetivo-mensual-portal-titulo";
    tituloObjetivo.textContent = obj.clase ? `📅 Objetivo del mes — ${obj.clase}` : "📅 Objetivo del mes";
    tarjeta.appendChild(tituloObjetivo);

    const textoObjetivo = document.createElement("p");
    textoObjetivo.className = "objetivo-mensual-portal-texto";
    textoObjetivo.textContent = obj.objetivo;
    tarjeta.appendChild(textoObjetivo);

    panel.appendChild(tarjeta);
  });
}

// Debajo del botón de objetivo mensual va otro, "🎥 Videos de mis
// clases" — SOLO si al menos una de sus clases tiene algún video
// subido desde el Panel de Clase. Agrupa los videos por clase, igual
// que el objetivo mensual.
function formatearFechaHoraVideoPortal(iso) {
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

function renderBotonVideosClase(videosPorClase) {
  const btn = el("btnVideosClase");
  const panel = el("panelVideosClase");

  const conVideos = (videosPorClase || []).filter((g) => g && g.videos && g.videos.length);

  panel.innerHTML = "";
  panel.hidden = true;
  btn.textContent = "🎥 Videos de mis clases";

  if (!conVideos.length) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;

  conVideos.forEach((grupo) => {
    const bloqueGrupo = document.createElement("div");

    const titulo = document.createElement("p");
    titulo.className = "videos-clase-grupo-titulo";
    titulo.textContent = grupo.clase ? `🎥 ${grupo.clase}` : "🎥 Videos";
    bloqueGrupo.appendChild(titulo);

    const lista = document.createElement("div");
    lista.className = "videos-clase-grupo-lista";

    grupo.videos.forEach((v) => {
      const fila = document.createElement("div");
      fila.className = "video-portal-fila";

      const info = document.createElement("span");
      info.className = "video-portal-fila-info";
      info.textContent = `📼 ${formatearFechaHoraVideoPortal(v.fecha)} · ${v.tamanoMB} MB`;
      fila.appendChild(info);

      const botones = document.createElement("div");
      botones.className = "video-portal-fila-botones";

      const verLink = document.createElement("a");
      verLink.className = "video-portal-boton-ver";
      verLink.href = v.url;
      verLink.target = "_blank";
      verLink.rel = "noopener";
      verLink.textContent = "▶ Ver";
      botones.appendChild(verLink);

      const descargarLink = document.createElement("a");
      descargarLink.className = "video-portal-boton-descargar";
      descargarLink.href = v.urlDescarga;
      descargarLink.textContent = "⬇ Descargar";
      botones.appendChild(descargarLink);

      fila.appendChild(botones);
      lista.appendChild(fila);
    });

    bloqueGrupo.appendChild(lista);
    panel.appendChild(bloqueGrupo);
  });
}

// ---------- cumpleaños editable ----------

function construirFilaCumpleanos(f) {
  const fila = document.createElement("div");
  fila.className = "perfil-fila";

  const etiqueta = document.createElement("p");
  etiqueta.className = "perfil-etiqueta";
  etiqueta.textContent = f.etiqueta || "🎂 Cumpleaños";
  fila.appendChild(etiqueta);

  const filaValor = document.createElement("div");
  filaValor.className = "cumple-fila-valor";

  const valorTexto = document.createElement("p");
  valorTexto.className = "perfil-valor";
  valorTexto.textContent = f.valor ? formatearFechaCorta(f.valor) : "Sin registrar";
  filaValor.appendChild(valorTexto);

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn-editar-cumple";
  btnEditar.type = "button";
  btnEditar.textContent = "✏️ Editar";
  filaValor.appendChild(btnEditar);

  fila.appendChild(filaValor);

  const bloqueEdicion = document.createElement("div");
  bloqueEdicion.className = "cumple-edicion";
  bloqueEdicion.hidden = true;

  const input = document.createElement("input");
  input.type = "date";
  input.className = "input-cumple";
  if (f.valor) input.value = f.valor;

  const filaBotones = document.createElement("div");
  filaBotones.className = "cumple-botones";

  const btnGuardar = document.createElement("button");
  btnGuardar.className = "btn-secundario";
  btnGuardar.type = "button";
  btnGuardar.textContent = "Guardar";

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn-cancelar-cumple";
  btnCancelar.type = "button";
  btnCancelar.textContent = "Cancelar";

  filaBotones.appendChild(btnGuardar);
  filaBotones.appendChild(btnCancelar);

  const mensajeOk = document.createElement("p");
  mensajeOk.className = "mensaje-clave-ok";
  mensajeOk.hidden = true;
  mensajeOk.textContent = "✅ Fecha actualizada.";

  bloqueEdicion.appendChild(input);
  bloqueEdicion.appendChild(filaBotones);
  bloqueEdicion.appendChild(mensajeOk);
  fila.appendChild(bloqueEdicion);

  btnEditar.addEventListener("click", () => {
    mensajeOk.hidden = true;
    bloqueEdicion.hidden = !bloqueEdicion.hidden;
  });

  btnCancelar.addEventListener("click", () => {
    input.value = f.valor || "";
    mensajeOk.hidden = true;
    bloqueEdicion.hidden = true;
  });

  btnGuardar.addEventListener("click", async () => {
    const nuevaFecha = input.value;
    if (!nuevaFecha) {
      mostrarError("Elige una fecha.");
      return;
    }

    btnGuardar.disabled = true;
    const textoOriginal = btnGuardar.textContent;
    btnGuardar.textContent = "Guardando...";
    mostrarError("");

    try {
      await llamarWorker({
        accion: "actualizarCumpleanos",
        alumnaId: alumnaSeleccionada.id,
        nuevaFecha,
      });
      f.valor = nuevaFecha;
      valorTexto.textContent = formatearFechaCorta(nuevaFecha);
      mensajeOk.hidden = false;
      bloqueEdicion.hidden = true;
    } catch (e) {
      mostrarError(e.message);
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = textoOriginal;
    }
  });

  return fila;
}

// ---------- correo editable ----------

function construirFilaCorreo(f) {
  const fila = document.createElement("div");
  fila.className = "perfil-fila";

  const etiqueta = document.createElement("p");
  etiqueta.className = "perfil-etiqueta";
  etiqueta.textContent = f.etiqueta || "✉️ Correo";
  fila.appendChild(etiqueta);

  const filaValor = document.createElement("div");
  filaValor.className = "cumple-fila-valor";

  const valorTexto = document.createElement("p");
  valorTexto.className = "perfil-valor";
  valorTexto.textContent = f.valor || "Sin registrar";
  filaValor.appendChild(valorTexto);

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn-editar-cumple";
  btnEditar.type = "button";
  btnEditar.textContent = "✏️ Editar";
  filaValor.appendChild(btnEditar);

  fila.appendChild(filaValor);

  const bloqueEdicion = document.createElement("div");
  bloqueEdicion.className = "cumple-edicion";
  bloqueEdicion.hidden = true;

  const input = document.createElement("input");
  input.type = "email";
  input.className = "input-cumple";
  input.placeholder = "tucorreo@ejemplo.com";
  if (f.valor) input.value = f.valor;

  const filaBotones = document.createElement("div");
  filaBotones.className = "cumple-botones";

  const btnGuardar = document.createElement("button");
  btnGuardar.className = "btn-secundario";
  btnGuardar.type = "button";
  btnGuardar.textContent = "Guardar";

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn-cancelar-cumple";
  btnCancelar.type = "button";
  btnCancelar.textContent = "Cancelar";

  filaBotones.appendChild(btnGuardar);
  filaBotones.appendChild(btnCancelar);

  const mensajeOk = document.createElement("p");
  mensajeOk.className = "mensaje-clave-ok";
  mensajeOk.hidden = true;
  mensajeOk.textContent = "✅ Correo actualizado.";

  bloqueEdicion.appendChild(input);
  bloqueEdicion.appendChild(filaBotones);
  bloqueEdicion.appendChild(mensajeOk);
  fila.appendChild(bloqueEdicion);

  btnEditar.addEventListener("click", () => {
    mensajeOk.hidden = true;
    bloqueEdicion.hidden = !bloqueEdicion.hidden;
  });

  btnCancelar.addEventListener("click", () => {
    input.value = f.valor || "";
    mensajeOk.hidden = true;
    bloqueEdicion.hidden = true;
  });

  btnGuardar.addEventListener("click", async () => {
    const nuevoCorreo = input.value.trim();
    if (!nuevoCorreo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoCorreo)) {
      mostrarError("Escribe un correo válido.");
      return;
    }

    btnGuardar.disabled = true;
    const textoOriginal = btnGuardar.textContent;
    btnGuardar.textContent = "Guardando...";
    mostrarError("");

    try {
      await llamarWorker({
        accion: "actualizarCorreo",
        alumnaId: alumnaSeleccionada.id,
        nuevoCorreo,
      });
      f.valor = nuevoCorreo;
      valorTexto.textContent = nuevoCorreo;
      mensajeOk.hidden = false;
      bloqueEdicion.hidden = true;
    } catch (e) {
      mostrarError(e.message);
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = textoOriginal;
    }
  });

  return fila;
}

// ---------- participación en el show editable ----------

function construirFilaParticipacionShow(f) {
  const fila = document.createElement("div");
  fila.className = "perfil-fila";

  const etiqueta = document.createElement("p");
  etiqueta.className = "perfil-etiqueta";
  etiqueta.textContent = f.etiqueta || "🪩 Participación show";
  fila.appendChild(etiqueta);

  const filaValor = document.createElement("div");
  filaValor.className = "cumple-fila-valor";

  const valorTexto = document.createElement("p");
  valorTexto.className = "perfil-valor";
  valorTexto.textContent = f.valor || "Sin responder";
  filaValor.appendChild(valorTexto);

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn-editar-cumple";
  btnEditar.type = "button";
  btnEditar.textContent = "✏️ Editar";
  filaValor.appendChild(btnEditar);

  fila.appendChild(filaValor);

  const bloqueEdicion = document.createElement("div");
  bloqueEdicion.className = "cumple-edicion";
  bloqueEdicion.hidden = true;

  const filaOpciones = document.createElement("div");
  filaOpciones.className = "cumple-botones";

  const btnSi = document.createElement("button");
  btnSi.className = "btn-secundario";
  btnSi.type = "button";
  btnSi.textContent = "Sí participa";

  const btnNo = document.createElement("button");
  btnNo.className = "btn-secundario";
  btnNo.type = "button";
  btnNo.textContent = "No participa";

  filaOpciones.appendChild(btnSi);
  filaOpciones.appendChild(btnNo);

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn-cancelar-cumple";
  btnCancelar.type = "button";
  btnCancelar.textContent = "Cancelar";

  const mensajeOk = document.createElement("p");
  mensajeOk.className = "mensaje-clave-ok";
  mensajeOk.hidden = true;
  mensajeOk.textContent = "✅ Respuesta guardada.";

  bloqueEdicion.appendChild(filaOpciones);
  bloqueEdicion.appendChild(btnCancelar);
  bloqueEdicion.appendChild(mensajeOk);
  fila.appendChild(bloqueEdicion);

  btnEditar.addEventListener("click", () => {
    mensajeOk.hidden = true;
    bloqueEdicion.hidden = !bloqueEdicion.hidden;
  });

  btnCancelar.addEventListener("click", () => {
    mensajeOk.hidden = true;
    bloqueEdicion.hidden = true;
  });

  async function guardarRespuesta(valor, boton) {
    const botones = [btnSi, btnNo];
    botones.forEach((b) => (b.disabled = true));
    const textoOriginal = boton.textContent;
    boton.textContent = "Guardando...";
    mostrarError("");

    try {
      await llamarWorker({
        accion: "actualizarParticipacionShow",
        alumnaId: alumnaSeleccionada.id,
        valor,
      });
      f.valor = valor;
      valorTexto.textContent = valor === "SI" ? "SI" : "NO";
      mensajeOk.hidden = false;
      bloqueEdicion.hidden = true;
    } catch (e) {
      mostrarError(e.message);
    } finally {
      botones.forEach((b) => (b.disabled = false));
      boton.textContent = textoOriginal;
    }
  }

  btnSi.addEventListener("click", () => guardarRespuesta("SI", btnSi));
  btnNo.addEventListener("click", () => guardarRespuesta("NO", btnNo));

  return fila;
}

// ---------- sección de pago (link de pago + comprobante) ----------

function renderPago(pago) {
  pagoActual = pago || null;
  const seccion = el("seccionPago");

  if (!pagoActual) {
    seccion.hidden = true;
    return;
  }
  seccion.hidden = false;

  const badgeCont = el("pagoEstadoBadge");
  badgeCont.innerHTML = "";
  const clase = claseBadge(pagoActual.estado);
  const badge = document.createElement("span");
  badge.className = "badge-estado " + (clase || "badge-neutro");
  badge.textContent = pagoActual.estado || "-";
  badgeCont.appendChild(badge);

  const montoEl = el("pagoMonto");
  if (pagoActual.monto) {
    montoEl.textContent =
      "Monto: Q" + pagoActual.monto + (pagoActual.notaMonto ? " — " + pagoActual.notaMonto : "");
    montoEl.hidden = false;
  } else {
    montoEl.hidden = true;
  }

  const btnGenerar = el("btnGenerarLink");
  const linkPagar = el("linkPagar");
  const yaPagado = (pagoActual.estado || "").toUpperCase() === "PAGADO";

  if (yaPagado) {
    btnGenerar.hidden = true;
    linkPagar.hidden = true;
  } else if (pagoActual.linkPago) {
    btnGenerar.hidden = true;
    linkPagar.hidden = false;
    linkPagar.href = pagoActual.linkPago;
  } else {
    btnGenerar.hidden = false;
    linkPagar.hidden = true;
  }

  // Bloque de comprobante
  const bloqueComprobante = el("bloqueComprobante");
  const comprobanteOk = el("comprobanteOk");
  const labelSubir = el("labelSubirArchivo");
  if (pagoActual.tieneComprobante) {
    comprobanteOk.hidden = false;
    labelSubir.hidden = true;
  } else {
    comprobanteOk.hidden = true;
    labelSubir.hidden = false;
  }
  bloqueComprobante.hidden = false;
}

// ---------- pagos especiales (trajes / competencias) ----------

function formatearFechaCorta(fechaISO) {
  // Airtable manda la fecha como "AAAA-MM-DD"; la mostramos como
  // "DD/MM/AAAA" sin usar Date() para no depender de zona horaria.
  const partes = (fechaISO || "").split("-");
  if (partes.length !== 3) return fechaISO || "";
  const [anio, mes, dia] = partes;
  return `${dia}/${mes}/${anio}`;
}

function renderPagosEspeciales(lista) {
  pagosEspecialesActuales = lista || [];

  const seccion = el("seccionPagosEspeciales");
  const cont = el("listaPagosEspeciales");
  cont.innerHTML = "";

  if (!lista || !lista.length) {
    seccion.hidden = true;
    return;
  }
  seccion.hidden = false;

  lista.forEach((p) => {
    const card = document.createElement("div");
    card.className = "pago-especial-card";

    const titulo = document.createElement("div");
    titulo.className = "pago-especial-titulo";

    const tipo = document.createElement("span");
    tipo.className = "pago-especial-tipo";
    tipo.textContent = p.tipo || "Pago especial";
    titulo.appendChild(tipo);

    const clase = claseBadge(p.estado);
    const badge = document.createElement("span");
    badge.className = "badge-estado " + (clase || "badge-neutro");
    badge.textContent = p.estado || "-";
    titulo.appendChild(badge);

    card.appendChild(titulo);

    const filas = [
      ["Total", p.montoTotal],
      ["Pagado", p.montoPagado],
      ["Saldo pendiente", p.saldo],
    ];
    filas.forEach(([etiqueta, monto]) => {
      if (monto === null || monto === undefined) return;
      const fila = document.createElement("div");
      fila.className = "pago-especial-fila";
      const izq = document.createElement("span");
      izq.textContent = etiqueta;
      const der = document.createElement("span");
      der.textContent = "Q" + monto;
      fila.appendChild(izq);
      fila.appendChild(der);
      card.appendChild(fila);
    });

    if (p.fechaLimite && (p.estado || "").toUpperCase() !== "PAGADO") {
      const limite = document.createElement("p");
      limite.className = "pago-especial-limite";
      limite.textContent = "⏰ Límite: " + formatearFechaCorta(p.fechaLimite);
      card.appendChild(limite);
    }

    // Pagar el saldo pendiente de este pago especial (cuenta nueva de
    // Paggo) — dejamos elegir el monto para poder hacer abonos
    // parciales, no solo el saldo completo de una vez.
    const yaPagado = (p.estado || "").toUpperCase() === "PAGADO";
    if (!yaPagado) {
      const saldoNum = Number(p.saldo) || 0;

      // Si ya hay un link generado y pendiente, mostramos su botón de
      // pago (con el monto exacto de ESE link, que puede ser un abono
      // parcial distinto al saldo total).
      if (p.linkPago) {
        const link = document.createElement("a");
        link.className = "btn-secundario btn-link-pago-chico";
        link.href = p.linkPago;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent =
          "💳 Pagar" + (p.montoLink != null ? " Q" + Number(p.montoLink).toFixed(2) : "") + " ahora";
        card.appendChild(link);
      }

      // Y siempre dejamos abierta la opción de generar un link nuevo
      // (por el saldo completo, o por el monto que quieran abonar).
      const bloqueAbono = document.createElement("div");
      bloqueAbono.className = "pago-especial-abono";

      const labelMonto = document.createElement("label");
      labelMonto.className = "pago-especial-label-monto";
      labelMonto.textContent = "¿Cuánto quieres abonar?";

      const inputMonto = document.createElement("input");
      inputMonto.type = "number";
      inputMonto.className = "pago-especial-input-monto";
      inputMonto.min = "2";
      inputMonto.max = String(saldoNum);
      inputMonto.step = "0.01";
      inputMonto.inputMode = "decimal";
      inputMonto.value = saldoNum > 0 ? saldoNum.toFixed(2) : "";

      const btnGenerar = document.createElement("button");
      btnGenerar.className = "btn-secundario btn-generar-chico";
      btnGenerar.textContent = p.linkPago ? "Generar link por otro monto" : "Generar link de pago";
      btnGenerar.addEventListener("click", () => {
        const monto = Number(inputMonto.value);
        if (!monto || monto < 2) {
          mostrarError("Ingresa un monto válido para abonar (mínimo Q2.00).");
          return;
        }
        if (monto > saldoNum + 0.01) {
          mostrarError(`El monto no puede ser mayor al saldo pendiente (Q${saldoNum.toFixed(2)}).`);
          return;
        }
        generarLinkPagoEspecial(p.id, monto, btnGenerar);
      });

      bloqueAbono.appendChild(labelMonto);
      bloqueAbono.appendChild(inputMonto);
      bloqueAbono.appendChild(btnGenerar);
      card.appendChild(bloqueAbono);
    }

    // Subir comprobante de pago de este pago especial, para cuando
    // pagan por OTRO medio (transferencia, depósito, etc.), no con el
    // link de Paggo. A propósito esto SOLO adjunta el archivo para que
    // la academia lo revise — no crea ningún abono ni cambia el saldo
    // solo, así no hay riesgo de duplicar un pago que ya se confirmó
    // automáticamente por link.
    if (p.tieneComprobante) {
      const ok = document.createElement("p");
      ok.className = "comprobante-ok";
      ok.textContent = "✅ Ya subiste tu comprobante de pago.";
      card.appendChild(ok);
    } else {
      const label = document.createElement("label");
      label.className = "btn-secundario btn-subir-archivo-historial";

      const span = document.createElement("span");
      span.textContent = "📎 Subir comprobante de pago";

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,.pdf";
      input.hidden = true;
      input.addEventListener("change", (e) => {
        const archivo = e.target.files && e.target.files[0];
        if (archivo) subirComprobantePagoEspecial(p.id, archivo, span);
      });

      label.appendChild(span);
      label.appendChild(input);
      card.appendChild(label);
    }

    cont.appendChild(card);
  });
}

async function subirComprobantePagoEspecial(pagoEspecialId, archivo, spanTexto) {
  if (archivo.size > TAMANO_MAX_ARCHIVO) {
    mostrarError("El archivo es muy grande (máximo 8 MB). Intenta con una foto más liviana.");
    return;
  }

  const textoOriginal = spanTexto.textContent;
  spanTexto.textContent = "Subiendo...";
  mostrarError("");

  try {
    const archivoBase64 = await leerArchivoBase64(archivo);
    await llamarWorker({
      accion: "subirComprobantePagoEspecial",
      pagoEspecialId,
      archivoBase64,
      nombreArchivo: archivo.name,
      tipoArchivo: archivo.type,
    });
    const idx = pagosEspecialesActuales.findIndex((p) => p.id === pagoEspecialId);
    if (idx !== -1) pagosEspecialesActuales[idx].tieneComprobante = true;
    renderPagosEspeciales(pagosEspecialesActuales);
  } catch (e) {
    mostrarError(e.message);
    spanTexto.textContent = textoOriginal;
  }
}

async function generarLinkPagoEspecial(pagoEspecialId, monto, boton) {
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Generando... espera un momento";
  mostrarError("");

  try {
    const datos = await llamarWorker({ accion: "generarLinkEspecial", pagoEspecialId, monto });
    const idx = pagosEspecialesActuales.findIndex((p) => p.id === pagoEspecialId);
    if (idx !== -1) pagosEspecialesActuales[idx] = datos.pagoEspecial;
    renderPagosEspeciales(pagosEspecialesActuales);
  } catch (e) {
    mostrarError(e.message);
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// NOTA: se quitó a propósito la vieja enviarComprobantePagoEspecial() —
// esa subía el comprobante Y ADEMÁS creaba un ABONO nuevo "Pendiente de
// revisión", con riesgo de duplicar un pago ya confirmado por link. En
// su lugar, renderPagosEspeciales() usa subirComprobantePagoEspecial()
// (más abajo), que solo adjunta el archivo al pago especial para que la
// academia lo revise, sin crear ningún abono ni tocar el saldo.

// ---------- evaluaciones ----------

function estrellas(valor) {
  const n = Math.round(Number(valor) || 0);
  const llenas = Math.max(0, Math.min(5, n));
  return "★".repeat(llenas) + "☆".repeat(5 - llenas);
}

// Texto y clase CSS para la flechita de progreso vs. la evaluación
// anterior de la misma clase. delta === null significa que no hay
// una evaluación previa con la que comparar (primera vez, o cambió
// de clase) — en ese caso no mostramos nada.
function progresoTexto(delta) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null;
  if (delta > 0) return { texto: `▲ +${delta}`, clase: "progreso-sube" };
  if (delta < 0) return { texto: `▼ ${delta}`, clase: "progreso-baja" };
  return { texto: "— igual", clase: "progreso-igual" };
}

async function verEvaluaciones() {
  const btn = el("btnVerEvaluaciones");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Cargando...";
  mostrarError("");

  try {
    const datos = await llamarWorker({
      accion: "evaluaciones",
      alumnaId: alumnaSeleccionada.id,
    });
    renderEvaluaciones(datos.evaluaciones || []);
    mostrarPantalla("pantallaEvaluaciones");
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function renderEvaluaciones(lista) {
  const cont = el("listaEvaluaciones");
  cont.innerHTML = "";

  if (!lista.length) {
    const vacio = document.createElement("p");
    vacio.className = "mensaje-vacio";
    vacio.textContent = "Todavía no tienes evaluaciones registradas.";
    cont.appendChild(vacio);
    return;
  }

  lista.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "evaluacion-card";

    const header = document.createElement("div");
    header.className = "evaluacion-header";

    const titulo = document.createElement("p");
    titulo.className = "evaluacion-titulo";
    titulo.textContent = ev.titulo;
    header.appendChild(titulo);

    // Nota final oculta a propósito: los papás no deben ver la nota en
    // porcentaje, solo las estrellitas por área (ver más abajo).
    card.appendChild(header);

    const subtitulo = [ev.tipo, ev.anio].filter(Boolean).join(" • ");
    if (subtitulo) {
      const sub = document.createElement("p");
      sub.className = "evaluacion-subtitulo";
      sub.textContent = subtitulo;
      card.appendChild(sub);
    }

    (ev.grupos || []).forEach((g) => {
      const grupo = document.createElement("div");
      grupo.className = "grupo-evaluacion";

      const tituloGrupo = document.createElement("p");
      tituloGrupo.className = "grupo-evaluacion-titulo";
      tituloGrupo.textContent = g.titulo;
      grupo.appendChild(tituloGrupo);

      g.items.forEach((it) => {
        const fila = document.createElement("div");
        fila.className = "rating-fila";

        const label = document.createElement("span");
        label.className = "rating-label";
        label.textContent = it.label;

        const valorGrupo = document.createElement("span");
        valorGrupo.className = "rating-valor-grupo";

        const valor = document.createElement("span");
        valor.className = "rating-estrellas";
        valor.textContent = estrellas(it.valor);
        valorGrupo.appendChild(valor);

        const prog = progresoTexto(it.delta);
        if (prog) {
          const badge = document.createElement("span");
          badge.className = "rating-progreso " + prog.clase;
          badge.textContent = prog.texto;
          valorGrupo.appendChild(badge);
        }

        fila.appendChild(label);
        fila.appendChild(valorGrupo);
        grupo.appendChild(fila);
      });

      card.appendChild(grupo);
    });

    (ev.comentarios || []).forEach((c) => {
      const bloque = document.createElement("div");
      bloque.className = "evaluacion-comentario";

      const tituloC = document.createElement("p");
      tituloC.className = "evaluacion-comentario-titulo";
      tituloC.textContent = c.label;

      const texto = document.createElement("p");
      texto.className = "evaluacion-comentario-texto";
      texto.textContent = c.valor;

      bloque.appendChild(tituloC);
      bloque.appendChild(texto);
      card.appendChild(bloque);
    });

    const btnDescargar = document.createElement("button");
    btnDescargar.className = "btn-secundario btn-descargar-evaluacion";
    btnDescargar.textContent = "📥 Descargar PDF";
    btnDescargar.addEventListener("click", () => descargarEvaluacionPDF(ev));
    card.appendChild(btnDescargar);

    cont.appendChild(card);
  });
}

// -------------------------------------
// Arma un PDF con las mismas estrellitas y comentarios que ya se ven
// en la tarjeta de la evaluación, para que los papás puedan
// guardarlo o imprimirlo. Las calificaciones se dibujan como
// circulitos (rellenos = calificado) en vez de estrellas de texto,
// para no depender de que la fuente del PDF tenga ese símbolo.
// -------------------------------------
// La fuente que usa el PDF (helvetica) no sabe dibujar emojis — sin
// esto, títulos como "💪 Técnica Corporal" salían como símbolos
// rotos ("Ø=Üª..."). Quitamos emojis y símbolos raros, pero dejamos
// intactas las tildes/ñ (esas sí las dibuja bien).
function limpiarTextoPDF(texto) {
  return (texto || "")
    .toString()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function descargarEvaluacionPDF(ev) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    mostrarError("No se pudo generar el PDF. Intenta de nuevo en unos segundos.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margenIzq = 50;
  const anchoPagina = doc.internal.pageSize.getWidth();
  const altoPagina = doc.internal.pageSize.getHeight();
  let y = 60;

  function saltoDePaginaSiHaceFalta(alturaNecesaria) {
    if (y + alturaNecesaria > altoPagina - 40) {
      doc.addPage();
      y = 50;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(239, 75, 155);
  doc.text("MOVE Dance Academy", margenIzq, y);
  y += 24;

  doc.setFontSize(13);
  doc.setTextColor(90, 90, 90);
  doc.text(
    "Evaluación de " + limpiarTextoPDF((alumnaSeleccionada && alumnaSeleccionada.nombre) || ""),
    margenIzq,
    y
  );
  y += 20;

  const subt = [ev.titulo, ev.tipo, ev.anio].filter(Boolean).map(limpiarTextoPDF).join("  •  ");
  if (subt) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(120, 120, 120);
    doc.text(subt, margenIzq, y);
    y += 26;
  } else {
    y += 10;
  }

  (ev.grupos || []).forEach((g) => {
    saltoDePaginaSiHaceFalta(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(239, 75, 155);
    doc.text(limpiarTextoPDF(g.titulo), margenIzq, y);
    y += 18;

    g.items.forEach((it) => {
      saltoDePaginaSiHaceFalta(18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(70, 70, 70);
      doc.text(limpiarTextoPDF(it.label), margenIzq + 10, y);

      const n = Math.max(0, Math.min(5, Math.round(Number(it.valor) || 0)));
      const xCirculos = anchoPagina - margenIzq - 5 * 14;
      for (let i = 0; i < 5; i++) {
        const cx = xCirculos + i * 14;
        if (i < n) {
          doc.setFillColor(239, 75, 155);
          doc.circle(cx, y - 3, 4, "F");
        } else {
          doc.setDrawColor(230, 200, 215);
          doc.circle(cx, y - 3, 4, "S");
        }
      }
      y += 16;
    });
    y += 10;
  });

  (ev.comentarios || []).forEach((c) => {
    saltoDePaginaSiHaceFalta(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(239, 75, 155);
    doc.text(limpiarTextoPDF(c.label), margenIzq, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(70, 70, 70);
    const lineas = doc.splitTextToSize(limpiarTextoPDF(c.valor || ""), anchoPagina - margenIzq * 2);
    lineas.forEach((linea) => {
      saltoDePaginaSiHaceFalta(14);
      doc.text(linea, margenIzq, y);
      y += 14;
    });
    y += 10;
  });

  const nombreArchivo =
    "Evaluacion_" +
    ((alumnaSeleccionada && alumnaSeleccionada.nombre) || "alumna")
      .toString()
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_") +
    (ev.anio ? "_" + ev.anio : "") +
    ".pdf";
  doc.save(nombreArchivo);
}

async function generarLinkPago() {
  if (!pagoActual) return;
  const btn = el("btnGenerarLink");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Generando... espera un momento";
  mostrarError("");

  try {
    const datos = await llamarWorker({ accion: "generarLink", pagoId: pagoActual.pagoId });
    renderPago(datos.pago);
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
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

async function subirComprobante(archivo) {
  if (!pagoActual || !archivo) return;

  if (archivo.size > TAMANO_MAX_ARCHIVO) {
    mostrarError("El archivo es muy grande (máximo 8 MB). Intenta con una foto más liviana.");
    return;
  }

  const textoLabel = el("textoSubirArchivo");
  const textoOriginal = textoLabel.textContent;
  textoLabel.textContent = "Subiendo...";
  mostrarError("");

  try {
    const archivoBase64 = await leerArchivoBase64(archivo);
    await llamarWorker({
      accion: "subirComprobante",
      pagoId: pagoActual.pagoId,
      archivoBase64,
      nombreArchivo: archivo.name,
      tipoArchivo: archivo.type,
    });
    pagoActual.tieneComprobante = true;
    renderPago(pagoActual);
  } catch (e) {
    mostrarError(e.message);
    textoLabel.textContent = textoOriginal;
  }
}

// ---------- foto de perfil editable ----------
// Deja que la propia familia cambie la foto de su hija desde el
// Portal, sin tener que pedírselo a Recepción. Se sube apenas eligen
// el archivo (no hay que tocar "Guardar" aparte), igual que el
// comprobante de pago especial. El worker responde con el perfil
// completo y actualizado (misma forma que "entrar"), así que
// reusamos mostrarPerfilDesdeDatos() para repintar todo con la foto
// nueva de una sola vez.
async function subirFotoPerfil(archivo) {
  if (!alumnaSeleccionada) return;

  if (archivo.size > TAMANO_MAX_FOTO) {
    mostrarError("La foto es muy grande (máximo 5 MB). Intenta con otra foto o una más liviana.");
    return;
  }

  const textoSpan = el("textoFotoPerfil");
  const textoOriginal = textoSpan.textContent;
  textoSpan.textContent = "Subiendo...";
  el("mensajeFotoPerfilOk").hidden = true;
  mostrarError("");

  try {
    const archivoBase64 = await leerArchivoBase64(archivo);
    const datos = await llamarWorker({
      accion: "subirFotoAlumnaFamilia",
      alumnaId: alumnaSeleccionada.id,
      archivoBase64,
      nombreArchivo: archivo.name,
      tipoArchivo: archivo.type,
    });
    mostrarPerfilDesdeDatos(datos);
    el("mensajeFotoPerfilOk").hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    textoSpan.textContent = textoOriginal;
  }
}

// ---------- recuperar clave (pantalla de clave) ----------

async function recuperarClave() {
  const btn = el("btnRecuperarWhatsapp");
  const msg = el("mensajeRecuperarClave");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";
  msg.hidden = true;
  mostrarError("");

  try {
    const datos = await llamarWorker({
      accion: "recuperarClave",
      alumnaId: alumnaSeleccionada.id,
    });
    msg.textContent =
      "✅ Te enviamos tu clave por WhatsApp al número terminado en " +
      (datos.ultimosDigitos || "****") +
      ".";
    msg.hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function recuperarClavePorCorreo() {
  const btn = el("btnEnviarRecuperarCorreo");
  const msg = el("mensajeRecuperarClave");
  const correo = el("inputRecuperarCorreo").value.trim();
  msg.hidden = true;
  mostrarError("");

  if (!correo) {
    mostrarError("Escribe tu correo.");
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    await llamarWorker({
      accion: "recuperarClavePorCorreo",
      alumnaId: alumnaSeleccionada.id,
      correo,
    });
    msg.textContent = "✅ Te enviamos tu clave a tu correo. Revisa tu bandeja de entrada (y la carpeta de spam).";
    msg.hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- recuperar clave FAMILIAR (pantalla inicial) ----------
// Como la "familia" no tiene su propio WhatsApp/correo en Airtable,
// piden buscar a UNA de sus hijas y le reenviamos la clave familiar
// al contacto que ya tenemos registrado para ella.

function renderListaHijaRecuperarFamiliar(filtro) {
  const cont = el("listaHijaRecuperarFamiliar");
  cont.innerHTML = "";
  const texto = (filtro || "").trim().toLowerCase();

  if (!texto) {
    const aviso = document.createElement("p");
    aviso.className = "lista-alumnas-aviso";
    aviso.textContent = "Escribe el nombre de tu hija para buscarla.";
    cont.appendChild(aviso);
    return;
  }

  const filtradas = alumnas.filter((a) => a.nombre.toLowerCase().includes(texto));

  if (filtradas.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "lista-alumnas-aviso";
    vacio.textContent = "No encontramos ese nombre. Revisa cómo lo escribiste.";
    cont.appendChild(vacio);
    return;
  }

  filtradas.slice(0, 30).forEach((a) => {
    const btn = document.createElement("button");
    btn.textContent = a.nombre;
    btn.addEventListener("click", () => seleccionarHijaRecuperarFamiliar(a));
    cont.appendChild(btn);
  });
}

function seleccionarHijaRecuperarFamiliar(a) {
  hijaSeleccionadaRecuperarFamiliar = a;
  el("nombreHijaRecuperarFamiliar").textContent = a.nombre;
  el("buscarHijaRecuperarFamiliar").value = "";
  el("listaHijaRecuperarFamiliar").innerHTML = "";
  el("bloqueOpcionesRecuperarFamiliar").hidden = false;
  el("bloqueRecuperarFamiliarCorreo").hidden = true;
  el("inputRecuperarFamiliarCorreo").value = "";
  el("mensajeRecuperarFamiliar").hidden = true;
}

async function recuperarClaveFamiliarPorWhatsapp() {
  if (!hijaSeleccionadaRecuperarFamiliar) return;
  const btn = el("btnRecuperarFamiliarWhatsapp");
  const msg = el("mensajeRecuperarFamiliar");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";
  msg.hidden = true;
  mostrarError("");

  try {
    const datos = await llamarWorker({
      accion: "recuperarClaveFamiliar",
      alumnaId: hijaSeleccionadaRecuperarFamiliar.id,
    });
    msg.textContent =
      "✅ Te enviamos la clave familiar por WhatsApp al número terminado en " +
      (datos.ultimosDigitos || "****") +
      ".";
    msg.hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function recuperarClaveFamiliarPorCorreo() {
  if (!hijaSeleccionadaRecuperarFamiliar) return;
  const btn = el("btnEnviarRecuperarFamiliarCorreo");
  const msg = el("mensajeRecuperarFamiliar");
  const correo = el("inputRecuperarFamiliarCorreo").value.trim();
  msg.hidden = true;
  mostrarError("");

  if (!correo) {
    mostrarError("Escribe tu correo.");
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    await llamarWorker({
      accion: "recuperarClaveFamiliarPorCorreo",
      alumnaId: hijaSeleccionadaRecuperarFamiliar.id,
      correo,
    });
    msg.textContent = "✅ Te enviamos la clave familiar a tu correo. Revisa tu bandeja de entrada (y la carpeta de spam).";
    msg.hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- cambiar clave (dentro del perfil) ----------

async function guardarNuevaClave() {
  const nueva = el("inputClaveNueva").value.trim();
  const confirmar = el("inputClaveConfirmar").value.trim();
  mostrarError("");
  el("mensajeClaveOk").hidden = true;

  if (!nueva || !confirmar) {
    mostrarError("Escribe tu nueva clave y confírmala.");
    return;
  }
  if (nueva.length < 6) {
    mostrarError("Tu nueva clave debe tener al menos 6 caracteres.");
    return;
  }
  if (nueva !== confirmar) {
    mostrarError("Las dos claves no coinciden.");
    return;
  }

  const btn = el("btnGuardarClave");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";

  try {
    await llamarWorker({
      accion: "cambiarClave",
      alumnaId: alumnaSeleccionada.id,
      claveActual,
      claveNueva: nueva,
    });
    claveActual = nueva;
    el("inputClaveNueva").value = "";
    el("inputClaveConfirmar").value = "";
    el("mensajeClaveOk").hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- cambiar clave familiar (dentro del perfil, en modo familia) ----------

async function guardarNuevaClaveFamiliar() {
  const nueva = el("inputClaveFamiliarNueva").value.trim();
  const confirmar = el("inputClaveFamiliarConfirmar").value.trim();
  mostrarError("");
  el("mensajeClaveFamiliarOk").hidden = true;

  if (!nueva || !confirmar) {
    mostrarError("Escribe la nueva clave familiar y confírmala.");
    return;
  }
  if (nueva.length < 6) {
    mostrarError("La nueva clave familiar debe tener al menos 6 caracteres.");
    return;
  }
  if (nueva !== confirmar) {
    mostrarError("Las dos claves familiares no coinciden.");
    return;
  }

  const btn = el("btnGuardarClaveFamiliar");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";

  try {
    await llamarWorker({
      accion: "cambiarClaveFamiliar",
      familiaId: familiaIdActual,
      claveActual: claveFamiliarActual,
      claveNueva: nueva,
    });
    claveFamiliarActual = nueva;
    // Actualizamos también el atajo guardado en este dispositivo, para
    // que "Entrar como [familia]" siga funcionando con la clave nueva.
    guardarClaveFamiliarLocal(nueva, nombreFamiliaActual);
    actualizarBotonFamiliaGuardada();
    el("inputClaveFamiliarNueva").value = "";
    el("inputClaveFamiliarConfirmar").value = "";
    el("mensajeClaveFamiliarOk").hidden = false;
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- unir con otra hija (grupo familiar permanente) ----------
// A diferencia de "Agregar a otra hija" (que solo recuerda cosas en
// ESTE dispositivo), esto crea/actualiza de verdad la relación en la
// tabla FAMILIAS PORTAL de Airtable, para que quede igual desde
// cualquier celular o computadora. No depende de la academia: basta
// con que quien lo haga sepa las claves individuales de las dos hijas
// que quiere unir (o la clave familiar, si ya está en modo familia).

// IDs que ya se están mostrando en el perfil actual, para no
// ofrecerlos de nuevo en el buscador.
function idsYaEnPerfilActual() {
  if (modoFamilia) return datosHijasFamilia.map((d) => d.id);
  return alumnaSeleccionada ? [alumnaSeleccionada.id] : [];
}

function renderListaHermanaUnir(filtro) {
  const cont = el("listaHermanaUnir");
  cont.innerHTML = "";
  const texto = (filtro || "").trim().toLowerCase();

  if (!texto) {
    const aviso = document.createElement("p");
    aviso.className = "lista-alumnas-aviso";
    aviso.textContent = "Escribe el nombre de tu otra hija para buscarla.";
    cont.appendChild(aviso);
    return;
  }

  const yaIncluidas = idsYaEnPerfilActual();
  const filtradas = alumnas.filter(
    (a) => a.nombre.toLowerCase().includes(texto) && !yaIncluidas.includes(a.id)
  );

  if (filtradas.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "lista-alumnas-aviso";
    vacio.textContent = "No encontramos ese nombre. Revisa cómo lo escribiste.";
    cont.appendChild(vacio);
    return;
  }

  filtradas.slice(0, 30).forEach((a) => {
    const btn = document.createElement("button");
    btn.textContent = a.nombre;
    btn.addEventListener("click", () => seleccionarHermanaUnir(a));
    cont.appendChild(btn);
  });
}

function seleccionarHermanaUnir(a) {
  hermanaSeleccionadaUnir = a;
  el("nombreHermanaUnirElegida").textContent = a.nombre;
  el("inputClaveHermanaUnir").value = "";
  el("inputClaveFamiliarNuevaUnir").value = "";
  el("inputClaveFamiliarNuevaUnirConfirmar").value = "";
  el("buscarHermanaUnir").value = "";
  el("listaHermanaUnir").innerHTML = "";
  el("bloqueConfirmarUnir").hidden = false;
  el("inputClaveHermanaUnir").focus();
}

async function confirmarUnirFamilia() {
  if (!hermanaSeleccionadaUnir) return;

  const claveHermana = el("inputClaveHermanaUnir").value.trim();
  const nuevaClave = el("inputClaveFamiliarNuevaUnir").value.trim();
  const nuevaClaveConfirmar = el("inputClaveFamiliarNuevaUnirConfirmar").value.trim();

  mostrarError("");
  el("mensajeUnirFamiliaOk").hidden = true;

  if (!claveHermana) {
    mostrarError("Escribe la clave de tu otra hija.");
    return;
  }
  if (nuevaClave || nuevaClaveConfirmar) {
    if (nuevaClave.length < 6) {
      mostrarError("La nueva clave familiar debe tener al menos 6 caracteres.");
      return;
    }
    if (nuevaClave !== nuevaClaveConfirmar) {
      mostrarError("Las dos claves familiares no coinciden.");
      return;
    }
  }

  const btn = el("btnConfirmarUnirFamilia");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Uniendo...";

  const nombreHermanaUnida = hermanaSeleccionadaUnir.nombre;

  try {
    const payload = {
      accion: "agregarHermanaAFamilia",
      hermanaId: hermanaSeleccionadaUnir.id,
      claveHermana,
    };
    if (nuevaClave) payload.claveFamiliarNueva = nuevaClave;

    if (modoFamilia) {
      payload.familiaId = familiaIdActual;
      payload.claveFamiliar = claveFamiliarActual;
    } else {
      payload.alumnaId = alumnaSeleccionada.id;
      payload.claveAlumna = claveActual;
    }

    const resp = await llamarWorker(payload);

    hermanaSeleccionadaUnir = null;
    el("bloqueUnirFamilia").hidden = true;
    el("bloqueConfirmarUnir").hidden = true;
    el("buscarHermanaUnir").value = "";
    el("listaHermanaUnir").innerHTML = "";
    el("inputClaveHermanaUnir").value = "";
    el("inputClaveFamiliarNuevaUnir").value = "";
    el("inputClaveFamiliarNuevaUnirConfirmar").value = "";

    // Recargamos el grupo familiar completo (todas las hermanas juntas)
    // usando la clave familiar que se acaba de confirmar o crear —
    // así el perfil que se ve ya queda en modo familia, actualizado.
    await entrarConClaveFamiliar(resp.claveFamiliar);

    if (resp.claveFamiliar) {
      const mensajeClave = resp.esNueva
        ? `✅ ¡Listo! Unieron a ${nombreHermanaUnida}. Guarda esta clave familiar — la van a necesitar para entrar juntas desde cualquier celular o computadora:\n\n${resp.claveFamiliar}`
        : `✅ ¡Listo! Unieron a ${nombreHermanaUnida} a su grupo familiar.\n\nLa clave familiar es: ${resp.claveFamiliar}`;
      window.alert(mensajeClave);
    }
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- historial de mensualidades ----------

async function verHistorialPagos() {
  const btn = el("btnHistorialPagos");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Cargando...";
  mostrarError("");

  try {
    const datos = await llamarWorker({
      accion: "historialPagos",
      alumnaId: alumnaSeleccionada.id,
    });
    renderHistorialPagos(datos.historial || [], datos.anio);
    mostrarPantalla("pantallaHistorialPagos");
  } catch (e) {
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function actualizarHistorialPagos() {
  try {
    const datos = await llamarWorker({
      accion: "historialPagos",
      alumnaId: alumnaSeleccionada.id,
    });
    renderHistorialPagos(datos.historial || [], datos.anio);
  } catch (e) {
    mostrarError(e.message);
  }
}

function renderHistorialPagos(lista, anio) {
  el("historialTitulo").textContent = "📅 Mensualidades " + (anio || "");

  const cont = el("listaHistorialPagos");
  cont.innerHTML = "";

  if (!lista || !lista.length) {
    const vacio = document.createElement("p");
    vacio.className = "mensaje-vacio";
    vacio.textContent = "Todavía no hay mensualidades registradas este año.";
    cont.appendChild(vacio);
    return;
  }

  lista.forEach((p) => {
    const card = document.createElement("div");
    card.className = "historial-card";

    const filaSuperior = document.createElement("div");
    filaSuperior.className = "historial-fila-superior";

    const mes = document.createElement("span");
    mes.className = "historial-mes";
    mes.textContent = p.mes || "-";
    filaSuperior.appendChild(mes);

    const clase = claseBadge(p.estado);
    const badge = document.createElement("span");
    badge.className = "badge-estado " + (clase || "badge-neutro");
    badge.textContent = p.estado || "-";
    filaSuperior.appendChild(badge);

    card.appendChild(filaSuperior);

    // Todo lo demás (monto, botón de pago, botón de comprobante) va
    // dentro de un solo contenedor con espaciado parejo (gap), para
    // que nunca queden encimados sin importar cuáles de estos
    // elementos aparezcan o no en cada mensualidad.
    const cuerpo = document.createElement("div");
    cuerpo.className = "historial-cuerpo";

    if (p.monto) {
      const monto = document.createElement("p");
      monto.className = "historial-monto";
      monto.textContent = "Monto: Q" + p.monto;
      cuerpo.appendChild(monto);
    }

    const yaPagado = (p.estado || "").toUpperCase() === "PAGADO";
    if (!yaPagado) {
      if (p.linkPago) {
        const link = document.createElement("a");
        link.className = "btn-secundario btn-link-pago-chico";
        link.href = p.linkPago;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "💳 Pagar ahora";
        cuerpo.appendChild(link);
      } else {
        const btnGenerar = document.createElement("button");
        btnGenerar.className = "btn-secundario btn-generar-chico";
        btnGenerar.textContent = "Generar link de pago";
        btnGenerar.addEventListener("click", () => generarLinkHistorial(p.pagoId, btnGenerar));
        cuerpo.appendChild(btnGenerar);
      }
    }

    // Subir comprobante de pago de ESTA mensualidad (dispara la misma
    // automatización que ya tienen: al subirlo, el estado pasa a "EN
    // REVISION"). Se ofrece en cualquier mensualidad, no solo la del
    // mes actual, por si pagan por otro medio y necesitan mandar el
    // comprobante.
    if (p.tieneComprobante) {
      const ok = document.createElement("p");
      ok.className = "comprobante-ok";
      ok.textContent = "✅ Ya subiste tu comprobante de pago.";
      cuerpo.appendChild(ok);
    } else {
      const label = document.createElement("label");
      label.className = "btn-secundario btn-subir-archivo-historial";

      const span = document.createElement("span");
      span.textContent = "📎 Subir comprobante de pago";

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,.pdf";
      input.hidden = true;
      input.addEventListener("change", (e) => {
        const archivo = e.target.files && e.target.files[0];
        if (archivo) subirComprobanteHistorial(p.pagoId, archivo, span);
      });

      label.appendChild(span);
      label.appendChild(input);
      cuerpo.appendChild(label);
    }

    card.appendChild(cuerpo);
    cont.appendChild(card);
  });
}

async function generarLinkHistorial(pagoId, boton) {
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Generando...";
  mostrarError("");

  try {
    await llamarWorker({ accion: "generarLink", pagoId });
    await actualizarHistorialPagos();
  } catch (e) {
    mostrarError(e.message);
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

async function subirComprobanteHistorial(pagoId, archivo, spanTexto) {
  if (archivo.size > TAMANO_MAX_ARCHIVO) {
    mostrarError("El archivo es muy grande (máximo 8 MB). Intenta con una foto más liviana.");
    return;
  }

  const textoOriginal = spanTexto.textContent;
  spanTexto.textContent = "Subiendo...";
  mostrarError("");

  try {
    const archivoBase64 = await leerArchivoBase64(archivo);
    await llamarWorker({
      accion: "subirComprobante",
      pagoId,
      archivoBase64,
      nombreArchivo: archivo.name,
      tipoArchivo: archivo.type,
    });
    await actualizarHistorialPagos();
  } catch (e) {
    mostrarError(e.message);
    spanTexto.textContent = textoOriginal;
  }
}

// ---------- chat con las maestras ----------

function formatearHoraChat(fechaIso) {
  const f = new Date(fechaIso);
  return f.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });
}

function renderChat(mensajes) {
  const cont = el("chatMensajes");
  const estabaAbajo =
    cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40;

  cont.innerHTML = "";

  if (!mensajes || !mensajes.length) {
    const vacio = document.createElement("p");
    vacio.className = "chat-vacio";
    vacio.textContent = "Todavía no hay mensajes. Escribe el primero 👇";
    cont.appendChild(vacio);
    return;
  }

  mensajes.forEach((m) => {
    const fila = document.createElement("div");
    fila.className = "chat-fila " + (m.rol === "FAMILIA" ? "chat-fila-familia" : "chat-fila-maestra");

    const burbuja = document.createElement("div");
    burbuja.className = "chat-burbuja " + (m.rol === "FAMILIA" ? "chat-burbuja-familia" : "chat-burbuja-maestra");

    const autor = document.createElement("p");
    autor.className = "chat-autor";
    autor.textContent = m.rol === "FAMILIA" ? "Tú" : m.autor || "Maestras";
    burbuja.appendChild(autor);

    const texto = document.createElement("p");
    texto.className = "chat-texto";
    texto.textContent = m.texto;
    burbuja.appendChild(texto);

    const hora = document.createElement("p");
    hora.className = "chat-hora";
    hora.textContent = formatearHoraChat(m.fecha);
    burbuja.appendChild(hora);

    fila.appendChild(burbuja);
    cont.appendChild(fila);
  });

  // Si ya estaba viendo el final de la conversación, lo dejamos ahí
  // (auto-scroll); si había subido a leer mensajes viejos, no lo
  // interrumpimos brincándolo hasta abajo en cada revisión.
  if (estabaAbajo) {
    cont.scrollTop = cont.scrollHeight;
  }
}

async function cargarChat(mostrarCargando) {
  if (mostrarCargando) {
    el("chatMensajes").innerHTML = '<p class="chat-vacio">Cargando mensajes...</p>';
  }
  try {
    const datos = await llamarWorker({
      accion: "chatObtener",
      alumnaId: alumnaSeleccionada.id,
      maestraId: maestraSeleccionadaChat.id,
      quien: "familia",
    });
    renderChat(datos.mensajes || []);
  } catch (e) {
    mostrarError(e.message);
  }
}

function detenerPollingChat() {
  if (chatPollingInterval) {
    clearInterval(chatPollingInterval);
    chatPollingInterval = null;
  }
}

// ---------- selector de maestra ----------
// Cada conversación es privada por alumna Y por maestra (para
// privacidad de todos), así que antes de abrir el chat el papá elige
// con cuál de las maestras de su alumna quiere hablar.

function renderListaMaestrasChat(maestras) {
  const cont = el("listaMaestrasChat");
  cont.innerHTML = "";

  if (!maestras || !maestras.length) {
    const aviso = document.createElement("p");
    aviso.className = "lista-alumnas-aviso";
    aviso.textContent = "Todavía no hay maestras asignadas a tu alumna. Contacta a la academia.";
    cont.appendChild(aviso);
    return;
  }

  maestras.forEach((m) => {
    const btn = document.createElement("button");
    btn.textContent = m.nombre;
    btn.addEventListener("click", () => abrirChat(m));
    cont.appendChild(btn);
  });
}

async function abrirSelectorMaestra() {
  mostrarPantalla("pantallaSelectorMaestra");
  el("listaMaestrasChat").innerHTML = '<p class="lista-alumnas-aviso">Cargando maestras...</p>';
  try {
    const datos = await llamarWorker({
      accion: "maestrasDeAlumna",
      alumnaId: alumnaSeleccionada.id,
    });
    renderListaMaestrasChat(datos.maestras || []);
  } catch (e) {
    mostrarError(e.message);
  }
}

async function abrirChat(maestra) {
  maestraSeleccionadaChat = maestra;
  el("chatTitulo").textContent = "💬 " + maestra.nombre;
  el("chatInput").value = "";
  mostrarPantalla("pantallaChat");
  await cargarChat(true);

  detenerPollingChat();
  chatPollingInterval = setInterval(() => cargarChat(false), 12000);
}

async function enviarMensajeChat() {
  const input = el("chatInput");
  const texto = input.value.trim();
  if (!texto) return;

  const btn = el("btnChatEnviar");
  btn.disabled = true;
  input.value = "";

  try {
    await llamarWorker({
      accion: "chatEnviar",
      alumnaId: alumnaSeleccionada.id,
      maestraId: maestraSeleccionadaChat.id,
      quien: "familia",
      texto,
    });
    await cargarChat(false);
  } catch (e) {
    input.value = texto;
    mostrarError(e.message);
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

// ---------- eventos ----------
el("buscarAlumna").addEventListener("input", (e) => renderAlumnas(e.target.value));

el("btnAtrasClave").addEventListener("click", () => {
  alumnaSeleccionada = null;
  mostrarPantalla("pantallaAlumna");
});

el("btnEntrar").addEventListener("click", entrar);

el("inputClave").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrar();
});

el("btnSalir").addEventListener("click", () => {
  alumnaSeleccionada = null;
  pagoActual = null;
  claveActual = "";
  modoFamilia = false;
  datosHijasFamilia = [];
  familiaIdActual = null;
  claveFamiliarActual = "";
  el("buscarAlumna").value = "";
  renderAlumnas("");
  // Quitamos la decoración de cumpleaños (era de esa alumna en
  // particular); si es octubre o diciembre, vuelve el tema del mes.
  aplicarDecoracion(obtenerTemaDelDia());
  mostrarPantalla("pantallaAlumna");
});

// ---------- objetivo mensual de clases (botón que abre/cierra el panel) ----------

el("btnObjetivosMensuales").addEventListener("click", () => {
  const panel = el("panelObjetivosMensuales");
  panel.hidden = !panel.hidden;
  el("btnObjetivosMensuales").textContent = panel.hidden
    ? "🎯 Objetivo mensual de clases"
    : "🎯 Ocultar objetivo mensual de clases";
});

// ---------- videos de clase (botón que abre/cierra el panel) ----------

el("btnVideosClase").addEventListener("click", () => {
  const panel = el("panelVideosClase");
  panel.hidden = !panel.hidden;
  el("btnVideosClase").textContent = panel.hidden
    ? "🎥 Videos de mis clases"
    : "🎥 Ocultar videos de mis clases";
});

// ---------- perfil familiar: unir / cambiar / olvidar ----------

el("btnUnirFamilia").addEventListener("click", () => {
  const bloque = el("bloqueUnirFamilia");
  bloque.hidden = !bloque.hidden;
  if (!bloque.hidden) {
    el("buscarHermanaUnir").value = "";
    el("listaHermanaUnir").innerHTML = "";
    el("bloqueConfirmarUnir").hidden = true;
    hermanaSeleccionadaUnir = null;
    el("mensajeUnirFamiliaOk").hidden = true;
    el("buscarHermanaUnir").focus();
  }
});

el("buscarHermanaUnir").addEventListener("input", (e) => renderListaHermanaUnir(e.target.value));

el("btnCancelarUnirFamilia").addEventListener("click", () => {
  hermanaSeleccionadaUnir = null;
  el("bloqueConfirmarUnir").hidden = true;
  el("buscarHermanaUnir").value = "";
  el("listaHermanaUnir").innerHTML = "";
  el("buscarHermanaUnir").focus();
});

el("btnConfirmarUnirFamilia").addEventListener("click", confirmarUnirFamilia);

el("btnOlvidarDispositivo").addEventListener("click", () => {
  const conFirmar = window.confirm(
    "¿Olvidar la clave familiar guardada en este dispositivo? La próxima vez van a necesitar escribirla otra vez."
  );
  if (!conFirmar) return;
  borrarClaveFamiliarLocal();
  actualizarBotonFamiliaGuardada();
});

// ---------- entrar con clave familiar ----------

el("btnMostrarClaveFamiliar").addEventListener("click", () => {
  const bloque = el("bloqueClaveFamiliar");
  bloque.hidden = !bloque.hidden;
  if (!bloque.hidden) el("inputClaveFamiliar").focus();
});

el("btnEntrarFamilia").addEventListener("click", () => entrarConClaveFamiliar());

el("btnMostrarRecuperarFamiliar").addEventListener("click", () => {
  const bloque = el("bloqueRecuperarFamiliar");
  bloque.hidden = !bloque.hidden;
  if (!bloque.hidden) {
    hijaSeleccionadaRecuperarFamiliar = null;
    el("buscarHijaRecuperarFamiliar").value = "";
    el("listaHijaRecuperarFamiliar").innerHTML = "";
    el("bloqueOpcionesRecuperarFamiliar").hidden = true;
    el("mensajeRecuperarFamiliar").hidden = true;
    el("buscarHijaRecuperarFamiliar").focus();
  }
});

el("buscarHijaRecuperarFamiliar").addEventListener("input", (e) =>
  renderListaHijaRecuperarFamiliar(e.target.value)
);

el("btnRecuperarFamiliarWhatsapp").addEventListener("click", recuperarClaveFamiliarPorWhatsapp);

el("btnMostrarRecuperarFamiliarCorreo").addEventListener("click", () => {
  el("bloqueRecuperarFamiliarCorreo").hidden = !el("bloqueRecuperarFamiliarCorreo").hidden;
});

el("btnEnviarRecuperarFamiliarCorreo").addEventListener("click", recuperarClaveFamiliarPorCorreo);

el("inputRecuperarFamiliarCorreo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") recuperarClaveFamiliarPorCorreo();
});

el("inputClaveFamiliar").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarConClaveFamiliar();
});

el("btnEntrarFamiliaGuardada").addEventListener("click", () => {
  const guardado = cargarClaveFamiliarLocal();
  if (guardado && guardado.clave) entrarConClaveFamiliar(guardado.clave);
});

el("btnGenerarLink").addEventListener("click", generarLinkPago);

el("inputComprobante").addEventListener("change", (e) => {
  const archivo = e.target.files && e.target.files[0];
  if (archivo) subirComprobante(archivo);
});

el("inputFotoPerfil").addEventListener("change", (e) => {
  const archivo = e.target.files && e.target.files[0];
  if (archivo) subirFotoPerfil(archivo);
  el("inputFotoPerfil").value = "";
});

el("btnVerEvaluaciones").addEventListener("click", verEvaluaciones);

el("btnAtrasEvaluaciones").addEventListener("click", () => {
  mostrarPantalla("pantallaPerfil");
});

el("btnMostrarRecuperar").addEventListener("click", () => {
  const bloque = el("bloqueRecuperar");
  bloque.hidden = !bloque.hidden;
});

el("btnRecuperarWhatsapp").addEventListener("click", recuperarClave);

el("btnMostrarRecuperarCorreo").addEventListener("click", () => {
  el("bloqueRecuperarCorreo").hidden = !el("bloqueRecuperarCorreo").hidden;
});

el("btnEnviarRecuperarCorreo").addEventListener("click", recuperarClavePorCorreo);

el("inputRecuperarCorreo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") recuperarClavePorCorreo();
});

el("btnGuardarClave").addEventListener("click", guardarNuevaClave);
el("btnGuardarClaveFamiliar").addEventListener("click", guardarNuevaClaveFamiliar);

el("btnHistorialPagos").addEventListener("click", verHistorialPagos);

el("btnAtrasHistorial").addEventListener("click", () => {
  mostrarPantalla("pantallaPerfil");
});

el("btnChat").addEventListener("click", abrirSelectorMaestra);

el("btnAtrasSelectorMaestra").addEventListener("click", () => {
  mostrarPantalla("pantallaPerfil");
});

el("btnAtrasChat").addEventListener("click", () => {
  maestraSeleccionadaChat = null;
  abrirSelectorMaestra();
});

el("btnChatEnviar").addEventListener("click", enviarMensajeChat);

el("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensajeChat();
  }
});

// ---------- arranque ----------
iniciar();
