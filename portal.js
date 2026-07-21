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

let alumnas = [];
let alumnaSeleccionada = null;
let pagoActual = null;
let claveActual = ""; // la clave con la que la alumna entró, se usa para confirmar cambios de clave

const TAMANO_MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB

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
  ];
  pantallas.forEach((p) => {
    el(p).hidden = p !== id;
  });
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
  const filtradas = texto
    ? alumnas.filter((a) => a.nombre.toLowerCase().includes(texto))
    : alumnas;

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
    renderPerfil(datos);
    renderPago(datos.pago);
    renderPagosEspeciales(datos.pagosEspeciales);
    el("inputClaveNueva").value = "";
    el("inputClaveConfirmar").value = "";
    el("mensajeClaveOk").hidden = true;

    // El cumpleaños de HOY es más especial que el tema del mes, así
    // que si es su día, ese decora por encima de Halloween/Navidad.
    const filaCumple = (datos.perfil || []).find((f) => f.campo === "CUMPLEAÑOS");
    const esCumpleHoy = filaCumple && esHoyElCumpleanos(filaCumple.valor);
    const tema = esCumpleHoy ? "cumple" : obtenerTemaDelDia();
    aplicarDecoracion(tema, datos.nombre || alumnaSeleccionada.nombre);

    mostrarPantalla("pantallaPerfil");
  } catch (e) {
    mostrarError(e.message);
    el("inputClave").value = "";
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
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
  cont.innerHTML = "";
  (datos.perfil || [])
    .filter((f) => f.tipo !== "imagen")
    .forEach((f) => {
      // El cumpleaños se muestra siempre (aunque esté vacío) con su
      // propio control editable, para que los papás puedan corregirlo
      // si quedó mal escrito.
      if (f.campo === "CUMPLEAÑOS") {
        cont.appendChild(construirFilaCumpleanos(f));
        // El botón de historial ya existe en el HTML; lo movemos aquí
        // debajo del cumpleaños (appendChild reubica el nodo, no lo
        // duplica, así que su evento de click sigue funcionando igual).
        cont.appendChild(el("btnHistorialPagos"));
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
    montoEl.textContent = "Monto: Q" + pagoActual.monto;
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

    cont.appendChild(card);
  });
}

// ---------- evaluaciones ----------

function estrellas(valor) {
  const n = Math.round(Number(valor) || 0);
  const llenas = Math.max(0, Math.min(5, n));
  return "★".repeat(llenas) + "☆".repeat(5 - llenas);
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

    if (ev.notaFinal !== null && ev.notaFinal !== undefined) {
      const nota = document.createElement("span");
      nota.className = "nota-final-badge";
      nota.textContent = Math.round(ev.notaFinal) + "%";
      header.appendChild(nota);
    }
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

        const valor = document.createElement("span");
        valor.className = "rating-estrellas";
        valor.textContent = estrellas(it.valor);

        fila.appendChild(label);
        fila.appendChild(valor);
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

    cont.appendChild(card);
  });
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

// ---------- recuperar clave (pantalla de clave) ----------

async function recuperarClave() {
  const btn = el("btnOlvideClave");
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
  el("buscarAlumna").value = "";
  renderAlumnas("");
  // Quitamos la decoración de cumpleaños (era de esa alumna en
  // particular); si es octubre o diciembre, vuelve el tema del mes.
  aplicarDecoracion(obtenerTemaDelDia());
  mostrarPantalla("pantallaAlumna");
});

el("btnGenerarLink").addEventListener("click", generarLinkPago);

el("inputComprobante").addEventListener("change", (e) => {
  const archivo = e.target.files && e.target.files[0];
  if (archivo) subirComprobante(archivo);
});

el("btnVerEvaluaciones").addEventListener("click", verEvaluaciones);

el("btnAtrasEvaluaciones").addEventListener("click", () => {
  mostrarPantalla("pantallaPerfil");
});

el("btnOlvideClave").addEventListener("click", recuperarClave);

el("btnGuardarClave").addEventListener("click", guardarNuevaClave);

el("btnHistorialPagos").addEventListener("click", verHistorialPagos);

el("btnAtrasHistorial").addEventListener("click", () => {
  mostrarPantalla("pantallaPerfil");
});

// ---------- arranque ----------
iniciar();
