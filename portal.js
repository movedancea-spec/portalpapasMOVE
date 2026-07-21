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

function mostrarPantalla(id) {
  const pantallas = [
    "pantallaCargando",
    "pantallaAlumna",
    "pantallaClave",
    "pantallaPerfil",
    "pantallaEvaluaciones",
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
    renderPerfil(datos);
    renderPago(datos.pago);
    renderPagosEspeciales(datos.pagosEspeciales);
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
  el("buscarAlumna").value = "";
  renderAlumnas("");
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

// ---------- arranque ----------
iniciar();
