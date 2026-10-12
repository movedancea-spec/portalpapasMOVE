// ==========================================
// MOVE — RECEPCIÓN: EDITOR DE FICHAS DE INSCRIPCIÓN
// MOVE Dance Academy
// ==========================================
// "📝 Fichas de inscripción": edita las fichas públicas de academia y
// adultos (inscripcion.academiamovedance.com) sin tocar código. Usa las
// funciones de recepcion.js (el, llamarWorker, mostrarPantalla y
// claveRecepcion), por eso se carga después de ese archivo.
//
// - El Worker (recepcionFichasObtener / recepcionFichaGuardar) valida
//   todo de nuevo con la clave de Recepción; aquí solo se arma el
//   borrador. Todo se pinta con textContent / .value (nunca innerHTML).
// - Los campos "fijos" (nombre, WhatsApp, cumpleaños…) tienen su columna
//   en ALUMNAS: no se borran, solo se ocultan; nombre, WhatsApp y
//   políticas ni eso. Los campos nuevos guardan su respuesta con la
//   etiqueta que tenían (ALUMNAS.FICHA RESPUESTAS).
// - Vista previa: abre la ficha pública real con ?vistaPrevia=1 en un
//   recuadro y le manda el borrador por postMessage.
// - Si otra persona guardó mientras tanto, el Worker responde
//   "conflicto": se avisa y se recarga.

const FICHAS_BASE_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:8766/"
  : "https://inscripcion.academiamovedance.com/";
const FICHAS_LINKS = {
  academia: { nombre: "Academia (niñas y niños)", url: "https://inscripcion.academiamovedance.com/" },
  adultos: { nombre: "Adultos", url: "https://inscripcion.academiamovedance.com/adultos.html" },
};
const TIPOS_NUEVOS_FICHA = [
  ["texto", "Texto corto"],
  ["textoLargo", "Texto largo"],
  ["numero", "Número"],
  ["fecha", "Fecha"],
  ["telefono", "Teléfono"],
  ["correo", "Correo"],
  ["lista", "Lista desplegable"],
  ["opcion", "Opción única (botones)"],
  ["casillas", "Casillas (varias)"],
  ["siNo", "Sí / No"],
];
const NOMBRES_TIPO_FICHA = Object.fromEntries([
  ...TIPOS_NUEVOS_FICHA,
  ["cumpleanos", "Cumpleaños"],
  ["foto", "Foto"],
]);

let fichasDatos = null; // respuesta de recepcionFichasObtener
let fichaSeleccionada = "academia";
let fichaBorrador = null; // copia editable de la config
let fichaSucia = false;
let bloqueAbierto = ""; // id del elemento que se está editando

function nodo(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined && texto !== null && texto !== "") n.textContent = texto;
  return n;
}

function botonFicha(texto, clase, alTocar, titulo) {
  const b = nodo("button", clase || "ficha-mini", texto);
  b.type = "button";
  if (titulo) b.title = titulo;
  b.addEventListener("click", alTocar);
  return b;
}

function idNuevoFicha(prefijo) {
  const letras = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefijo;
  const azar = crypto.getRandomValues(new Uint8Array(8));
  azar.forEach((n) => (id += letras[n % letras.length]));
  return id;
}

function mensajeFicha(texto, tipo) {
  const m = el("mensajeFichas");
  m.textContent = texto || "";
  m.className = "mensaje-form" + (tipo ? ` mensaje-form-${tipo}` : "");
}

function marcarFichaSucia() {
  fichaSucia = true;
  mensajeFicha("Cambios sin guardar", "error");
}

function fijosDeLaFicha() {
  return new Map((fichasDatos.fichas[fichaSeleccionada].fijos || []).map((f) => [f.id, f]));
}

window.addEventListener("beforeunload", (e) => {
  if (fichaSucia && !el("pantallaFichas").hidden) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------- abrir / cargar ----------

el("btnMenuFichas").addEventListener("click", () => {
  mostrarPantalla("pantallaFichas");
  cargarFichasEditor();
});

el("btnVolverFichas").addEventListener("click", () => {
  if (fichaSucia && !confirm("Tienes cambios sin guardar en la ficha. ¿Salir de todos modos?")) return;
  fichaSucia = false;
  mostrarPantalla("pantallaMenu");
});

async function cargarFichasEditor() {
  pintarLinksFichas();
  mensajeFicha("");
  el("fichaEditor").replaceChildren(nodo("p", "lista-vacia", "Cargando las fichas..."));
  try {
    fichasDatos = await llamarWorker({ accion: "recepcionFichasObtener", clave: claveRecepcion });
    elegirFicha(fichaSeleccionada, true);
  } catch (e) {
    el("fichaEditor").replaceChildren(nodo("p", "mensaje-form mensaje-form-error", e.message));
  }
}

function elegirFicha(ficha, forzar) {
  if (!forzar && ficha !== fichaSeleccionada && fichaSucia && !confirm("Tienes cambios sin guardar en esta ficha. ¿Cambiar de ficha y perderlos?")) return;
  fichaSeleccionada = ficha;
  fichaBorrador = JSON.parse(JSON.stringify(fichasDatos.fichas[ficha].config));
  fichaSucia = false;
  bloqueAbierto = "";
  mensajeFicha("");
  document.querySelectorAll("#fichasTabs button").forEach((b) => b.classList.toggle("activa", b.dataset.ficha === ficha));
  pintarCabeceraFicha();
  pintarEditorFicha();
}

document.querySelectorAll("#fichasTabs button").forEach((b) => b.addEventListener("click", () => elegirFicha(b.dataset.ficha)));

function pintarCabeceraFicha() {
  const datos = fichasDatos.fichas[fichaSeleccionada];
  const u = datos.ultimaEdicion;
  el("fichaUltimaEdicion").textContent = u
    ? `Versión ${datos.version} · último cambio: ${u.por} · ${u.cuando}`
    : "Versión inicial (todavía nadie la ha editado desde aquí).";
  const hist = el("fichaHistorial");
  hist.replaceChildren();
  if (!datos.historial.length) hist.appendChild(nodo("p", "pista-campo", "Todavía no hay cambios guardados."));
  datos.historial.forEach((h) => hist.appendChild(nodo("p", "ficha-historial-fila", `v${h.version} · ${h.por} · ${h.cuando}`)));
}

// ---------- links públicos ----------

function pintarLinksFichas() {
  const cont = el("fichasLinks");
  cont.replaceChildren();
  Object.entries(FICHAS_LINKS).forEach(([ficha, info]) => {
    const tarjeta = nodo("div", "ficha-link-tarjeta");
    tarjeta.appendChild(nodo("p", "ficha-link-nombre", `📝 Ficha de ${info.nombre}`));
    tarjeta.appendChild(nodo("p", "ficha-link-url", info.url));
    const botones = nodo("div", "ficha-link-botones");
    const qr = nodo("div", "ficha-qr");
    qr.hidden = true;
    botones.append(
      botonFicha("📋 Copiar link", "ficha-mini", async (e) => {
        try {
          await navigator.clipboard.writeText(info.url);
          e.target.textContent = "✅ Copiado";
        } catch (err) {
          prompt("Copia el link:", info.url);
        }
        setTimeout(() => (e.target.textContent = "📋 Copiar link"), 2000);
      }),
      botonFicha("↗ Abrir", "ficha-mini", () => window.open(info.url, "_blank", "noopener")),
      botonFicha("💬 WhatsApp", "ficha-mini", () => {
        const texto = `Ficha de inscripción de MOVE Dance Academy (${info.nombre}): ${info.url}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
      }),
      botonFicha("▦ Código QR", "ficha-mini", () => {
        qr.hidden = !qr.hidden;
        if (!qr.hidden && !qr.childNodes.length) pintarQrFicha(qr, info.url, ficha);
      })
    );
    tarjeta.append(botones, qr);
    cont.appendChild(tarjeta);
  });
}

// Código QR dibujado aquí mismo (librería qrcode-generator), sin mandar
// el link a ningún servicio de afuera.
function pintarQrFicha(cont, url, ficha) {
  if (typeof qrcode !== "function") {
    cont.appendChild(nodo("p", "pista-campo", "No se pudo cargar el generador de QR. Revisa la conexión."));
    return;
  }
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const modulos = qr.getModuleCount();
  const tam = 10;
  const margen = 4;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = (modulos + margen * 2) * tam;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let f = 0; f < modulos; f++) {
    for (let c = 0; c < modulos; c++) {
      if (qr.isDark(f, c)) ctx.fillRect((c + margen) * tam, (f + margen) * tam, tam, tam);
    }
  }
  canvas.className = "ficha-qr-imagen";
  const descargar = botonFicha("⬇ Descargar QR", "ficha-mini", () => {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-ficha-inscripcion-${ficha}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  cont.append(canvas, descargar);
}

// ---------- editor ----------

function inputFicha(valor, alCambiar, opciones = {}) {
  const largo = opciones.largo;
  const control = nodo(largo ? "textarea" : "input", largo ? "input-texto ficha-textarea" : "input-texto");
  if (!largo) control.type = "text";
  control.value = valor || "";
  if (opciones.max) control.maxLength = opciones.max;
  if (opciones.placeholder) control.placeholder = opciones.placeholder;
  if (opciones.filas && largo) control.rows = opciones.filas;
  control.addEventListener("input", () => {
    alCambiar(control.value);
    marcarFichaSucia();
  });
  return control;
}

function etiquetaYCampo(texto, control, pista) {
  const caja = nodo("div", "campo-form");
  caja.appendChild(nodo("p", "etiqueta-campo", texto));
  caja.appendChild(control);
  if (pista) caja.appendChild(nodo("p", "pista-campo", pista));
  return caja;
}

function casillaFicha(texto, marcada, alCambiar, deshabilitada) {
  const etiqueta = nodo("label", "ficha-check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = marcada;
  input.disabled = Boolean(deshabilitada);
  input.addEventListener("change", () => {
    alCambiar(input.checked);
    marcarFichaSucia();
  });
  etiqueta.append(input, document.createTextNode(" " + texto));
  return etiqueta;
}

function pintarEditorFicha() {
  const cont = el("fichaEditor");
  cont.replaceChildren();
  const c = fichaBorrador;

  // Interruptor del show, arriba y bien visible.
  const seccionShow = c.secciones.find((s) => s.bloques.some((b) => b.id === "show"));
  if (seccionShow) cont.appendChild(pintarInterruptorShow(seccionShow));
  else if (fichaSeleccionada === "adultos") {
    cont.appendChild(nodo("p", "pista-campo", "Esta ficha no tiene sección de Show. Cualquier sección se puede apagar con su interruptor."));
  }

  const generales = nodo("details", "ficha-bloque-general");
  generales.appendChild(nodo("summary", "", "✏️ Títulos y textos generales"));
  generales.append(
    etiquetaYCampo("Título", inputFicha(c.titulo, (v) => (c.titulo = v), { max: 150 })),
    etiquetaYCampo("Texto de introducción", inputFicha(c.subtitulo, (v) => (c.subtitulo = v), { largo: true, max: 1000, filas: 3 })),
    etiquetaYCampo("Enlace a la otra ficha: texto", inputFicha(c.otraFichaTexto, (v) => (c.otraFichaTexto = v), { max: 200 })),
    etiquetaYCampo("Enlace a la otra ficha: palabras del enlace", inputFicha(c.otraFichaEnlace, (v) => (c.otraFichaEnlace = v), { max: 120 }), "Déjalos vacíos para no mostrar el enlace."),
    etiquetaYCampo("Botón de enviar", inputFicha(c.botonEnviar, (v) => (c.botonEnviar = v), { max: 60 })),
    etiquetaYCampo("Mensaje al terminar: título", inputFicha(c.exitoTitulo, (v) => (c.exitoTitulo = v), { max: 120 })),
    etiquetaYCampo("Mensaje al terminar: texto", inputFicha(c.exitoTexto, (v) => (c.exitoTexto = v), { largo: true, max: 1500, filas: 3 }))
  );
  cont.appendChild(generales);

  cont.appendChild(nodo("p", "ficha-subtitulo-editor", "Secciones"));
  c.secciones.forEach((s, i) => cont.appendChild(pintarSeccionFicha(s, i)));
  cont.appendChild(
    botonFicha("＋ Agregar sección", "btn-secundario btn-ancho", () => {
      c.secciones.push({ id: idNuevoFicha("s_"), titulo: "Sección nueva", activa: true, textoApagada: "", bloques: [] });
      marcarFichaSucia();
      pintarEditorFicha();
    })
  );
}

function pintarInterruptorShow(seccion) {
  const caja = nodo("div", "ficha-show " + (seccion.activa ? "activa" : "apagada"));
  caja.appendChild(nodo("p", "ficha-show-titulo", "🎭 Sección Show de Fin de Año"));
  const botones = nodo("div", "ficha-interruptor");
  const activar = botonFicha("✅ Activa", seccion.activa ? "ficha-interruptor-btn elegido" : "ficha-interruptor-btn", () => {
    seccion.activa = true;
    marcarFichaSucia();
    pintarEditorFicha();
  });
  const apagar = botonFicha("⛔ Apagada", !seccion.activa ? "ficha-interruptor-btn elegido" : "ficha-interruptor-btn", () => {
    seccion.activa = false;
    marcarFichaSucia();
    pintarEditorFicha();
  });
  botones.append(activar, apagar);
  caja.appendChild(botones);
  caja.appendChild(
    nodo(
      "p",
      "pista-campo",
      seccion.activa
        ? "Se muestra el contrato del show y se guarda si autorizan que participe."
        : "No aparece en la ficha y no se guarda nada del show. Se muestra este texto en su lugar:"
    )
  );
  caja.appendChild(inputFicha(seccion.textoApagada, (v) => (seccion.textoApagada = v), { largo: true, max: 1000, filas: 2, placeholder: "Ej. Las inscripciones al show de este año ya cerraron." }));
  caja.appendChild(nodo("p", "pista-campo", "Se aplica a la ficha pública al tocar «Guardar cambios». Los montos y fechas del contrato se editan en la sección del show, más abajo."));
  return caja;
}

function moverEnLista(lista, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return false;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return true;
}

function pintarSeccionFicha(s, indice) {
  const c = fichaBorrador;
  const fijos = fijosDeLaFicha();
  const tieneFijos = s.bloques.some((b) => fijos.has(b.id));
  const tieneNucleo = s.bloques.some((b) => fijos.has(b.id) && fijos.get(b.id).nucleo);
  const caja = nodo("div", "ficha-seccion" + (s.activa ? "" : " apagada"));

  const cabeza = nodo("div", "ficha-seccion-cabeza");
  cabeza.appendChild(nodo("span", "ficha-seccion-numero", `${indice + 1}`));
  cabeza.appendChild(inputFicha(s.titulo, (v) => (s.titulo = v), { max: 150, placeholder: "Título de la sección (opcional)" }));
  const acciones = nodo("div", "ficha-acciones");
  acciones.append(
    botonFicha("▲", "ficha-mini", () => moverEnLista(c.secciones, indice, -1) && (marcarFichaSucia(), pintarEditorFicha()), "Subir sección"),
    botonFicha("▼", "ficha-mini", () => moverEnLista(c.secciones, indice, 1) && (marcarFichaSucia(), pintarEditorFicha()), "Bajar sección")
  );
  if (!tieneFijos) {
    acciones.appendChild(
      botonFicha("🗑", "ficha-mini ficha-peligro", () => {
        if (s.bloques.length && !confirm("¿Quitar esta sección con todo lo que tiene? (Las respuestas ya guardadas no se pierden.)")) return;
        c.secciones.splice(indice, 1);
        marcarFichaSucia();
        pintarEditorFicha();
      }, "Quitar sección")
    );
  }
  cabeza.appendChild(acciones);
  caja.appendChild(cabeza);

  if (tieneNucleo) {
    caja.appendChild(nodo("p", "pista-campo", "Siempre activa (tiene el nombre, el WhatsApp o las políticas)."));
  } else {
    caja.appendChild(casillaFicha("Sección activa (si se apaga, no aparece y no se guarda nada de ella)", s.activa, (v) => {
      s.activa = v;
      pintarEditorFicha();
    }));
    if (!s.activa) {
      caja.appendChild(etiquetaYCampo("Texto que se muestra en su lugar (opcional)", inputFicha(s.textoApagada, (v) => (s.textoApagada = v), { largo: true, max: 1000, filas: 2 })));
    }
  }

  const lista = nodo("div", "ficha-bloques");
  s.bloques.forEach((b, i) => lista.appendChild(pintarBloqueEditor(s, b, i)));
  if (!s.bloques.length) lista.appendChild(nodo("p", "pista-campo", "Sección vacía."));
  caja.appendChild(lista);

  const agregar = nodo("div", "ficha-agregar");
  const tipo = nodo("select", "input-texto");
  [
    ...TIPOS_NUEVOS_FICHA.map(([v, t]) => ["campo:" + v, "Campo: " + t]),
    ["texto:normal", "Texto informativo"],
    ["texto:aviso", "Aviso destacado (ej. precios)"],
    ["legal", "Reglamento con aceptación (Sí/No)"],
    ["separador", "Línea separadora"],
  ].forEach(([v, t]) => {
    const op = nodo("option", "", t);
    op.value = v;
    tipo.appendChild(op);
  });
  agregar.append(
    tipo,
    botonFicha("＋ Agregar", "ficha-mini", () => {
      const [clase, sub] = tipo.value.split(":");
      let nuevo;
      if (clase === "campo") {
        nuevo = { tipo: "campo", id: idNuevoFicha("c_"), tipoCampo: sub, etiqueta: "Pregunta nueva", placeholder: "", ayuda: "", obligatorio: false, oculto: false, opciones: ["lista", "opcion", "casillas"].includes(sub) ? ["Opción 1", "Opción 2"] : [] };
      } else if (clase === "texto") {
        nuevo = { tipo: "texto", id: idNuevoFicha("t_"), estilo: sub, texto: "Escribe aquí el texto." };
      } else if (clase === "legal") {
        nuevo = { tipo: "legal", id: idNuevoFicha("l_"), titulo: "Reglamento", items: ["Punto 1"], pregunta: "¿Aceptas?", textoSi: "Sí, acepto", textoNo: "No acepto", obligatorioAceptar: false, oculto: false };
      } else {
        nuevo = { tipo: "separador", id: idNuevoFicha("h_") };
      }
      s.bloques.push(nuevo);
      bloqueAbierto = nuevo.id;
      marcarFichaSucia();
      pintarEditorFicha();
    })
  );
  caja.appendChild(agregar);
  return caja;
}

function resumenBloque(b) {
  if (b.tipo === "separador") return "— Línea separadora —";
  if (b.tipo === "texto") return (b.estilo === "aviso" ? "📌 " : "📄 ") + b.texto.slice(0, 80);
  if (b.tipo === "legal") return `📋 ${b.titulo || b.pregunta}`;
  return `${b.etiqueta} · ${NOMBRES_TIPO_FICHA[b.tipoCampo] || b.tipoCampo}`;
}

function pintarBloqueEditor(s, b, i) {
  const fijos = fijosDeLaFicha();
  const fijo = fijos.get(b.id);
  const fila = nodo("div", "ficha-bloque" + (b.oculto ? " oculto" : ""));
  const cabeza = nodo("div", "ficha-bloque-cabeza");
  const texto = nodo("span", "ficha-bloque-texto", resumenBloque(b));
  cabeza.appendChild(texto);
  const marcas = nodo("span", "ficha-marcas");
  if (fijo) marcas.appendChild(nodo("span", "ficha-marca", fijo.nucleo ? "fijo · siempre" : "fijo"));
  if (b.obligatorio) marcas.appendChild(nodo("span", "ficha-marca", "obligatorio"));
  if (b.oculto) marcas.appendChild(nodo("span", "ficha-marca ficha-marca-oculto", "oculto"));
  cabeza.appendChild(marcas);

  const acciones = nodo("div", "ficha-acciones");
  acciones.append(
    botonFicha("▲", "ficha-mini", () => moverEnLista(s.bloques, i, -1) && (marcarFichaSucia(), pintarEditorFicha()), "Subir"),
    botonFicha("▼", "ficha-mini", () => moverEnLista(s.bloques, i, 1) && (marcarFichaSucia(), pintarEditorFicha()), "Bajar")
  );
  if (b.tipo !== "separador") {
    acciones.appendChild(
      botonFicha(bloqueAbierto === b.id ? "Cerrar" : "✏️ Editar", "ficha-mini", () => {
        bloqueAbierto = bloqueAbierto === b.id ? "" : b.id;
        pintarEditorFicha();
      })
    );
  }
  if (fijo && !fijo.nucleo) {
    acciones.appendChild(
      botonFicha(b.oculto ? "👁 Mostrar" : "🙈 Ocultar", "ficha-mini", () => {
        b.oculto = !b.oculto;
        marcarFichaSucia();
        pintarEditorFicha();
      })
    );
  }
  if (!fijo) {
    acciones.appendChild(
      botonFicha("🗑", "ficha-mini ficha-peligro", () => {
        if (!confirm("¿Quitar este elemento de la ficha? Las respuestas que ya se guardaron no se pierden.")) return;
        s.bloques.splice(i, 1);
        marcarFichaSucia();
        pintarEditorFicha();
      }, "Quitar")
    );
  }
  cabeza.appendChild(acciones);
  fila.appendChild(cabeza);
  if (bloqueAbierto === b.id) fila.appendChild(pintarEdicionBloque(s, b, fijo));
  return fila;
}

function pintarEdicionBloque(seccionActual, b, fijo) {
  const caja = nodo("div", "ficha-bloque-edicion");
  const refrescarTexto = () => {
    // Solo cambia el resumen; no se repinta todo para no perder el foco.
  };
  if (b.tipo === "texto") {
    caja.appendChild(etiquetaYCampo("Texto", inputFicha(b.texto, (v) => (b.texto = v), { largo: true, max: 4000, filas: 5 })));
    const estilo = nodo("select", "input-texto");
    [["normal", "Texto normal"], ["aviso", "Aviso destacado"]].forEach(([v, t]) => {
      const op = nodo("option", "", t);
      op.value = v;
      estilo.appendChild(op);
    });
    estilo.value = b.estilo;
    estilo.addEventListener("change", () => {
      b.estilo = estilo.value;
      marcarFichaSucia();
    });
    caja.appendChild(etiquetaYCampo("Estilo", estilo));
  } else if (b.tipo === "legal") {
    caja.append(
      etiquetaYCampo("Título", inputFicha(b.titulo, (v) => (b.titulo = v), { max: 200 })),
      etiquetaYCampo(
        "Puntos (uno por línea)",
        inputFicha(b.items.join("\n"), (v) => (b.items = v.split("\n").map((t) => t.trim()).filter(Boolean)), { largo: true, filas: 10 }),
        "Aquí se cambian montos, fechas y requisitos (ej. precio de trajes o anticipo). Cada línea es un punto numerado."
      ),
      etiquetaYCampo("Pregunta de aceptación", inputFicha(b.pregunta, (v) => (b.pregunta = v), { max: 300 })),
      etiquetaYCampo("Texto del «Sí»", inputFicha(b.textoSi, (v) => (b.textoSi = v), { max: 80 })),
      etiquetaYCampo("Texto del «No»", inputFicha(b.textoNo, (v) => (b.textoNo = v), { max: 80 }))
    );
    if (!fijo) {
      caja.appendChild(casillaFicha("Para inscribirse hay que contestar «Sí»", b.obligatorioAceptar, (v) => (b.obligatorioAceptar = v)));
    } else if (b.id === "politicas") {
      caja.appendChild(nodo("p", "pista-campo", "Siempre hay que aceptarlas para inscribirse."));
    }
  } else {
    caja.appendChild(etiquetaYCampo("Pregunta (lo que ve la familia)", inputFicha(b.etiqueta, (v) => (b.etiqueta = v), { max: 200 })));
    if (!fijo) {
      const tipo = nodo("select", "input-texto");
      TIPOS_NUEVOS_FICHA.forEach(([v, t]) => {
        const op = nodo("option", "", t);
        op.value = v;
        tipo.appendChild(op);
      });
      tipo.value = b.tipoCampo;
      tipo.addEventListener("change", () => {
        b.tipoCampo = tipo.value;
        if (["lista", "opcion", "casillas"].includes(b.tipoCampo) && !b.opciones.length) b.opciones = ["Opción 1", "Opción 2"];
        marcarFichaSucia();
        pintarEditorFicha();
      });
      caja.appendChild(etiquetaYCampo("Tipo de campo", tipo));
    } else {
      caja.appendChild(nodo("p", "pista-campo", `Tipo: ${NOMBRES_TIPO_FICHA[b.tipoCampo] || b.tipoCampo} (fijo, se guarda en su columna de ALUMNAS).`));
    }
    if (["texto", "textoLargo", "numero", "telefono", "correo"].includes(b.tipoCampo)) {
      caja.appendChild(etiquetaYCampo("Texto de ejemplo dentro del campo", inputFicha(b.placeholder, (v) => (b.placeholder = v), { max: 200 })));
    }
    if (["lista", "opcion", "casillas"].includes(b.tipoCampo)) {
      caja.appendChild(
        etiquetaYCampo(
          "Opciones (una por línea)",
          inputFicha(b.opciones.join("\n"), (v) => (b.opciones = v.split("\n").map((t) => t.trim()).filter(Boolean)), { largo: true, filas: 6 }),
          "Ej. grupos, horarios o estilos."
        )
      );
    }
    caja.appendChild(etiquetaYCampo("Ayuda debajo del campo (opcional)", inputFicha(b.ayuda, (v) => (b.ayuda = v), { largo: true, max: 500, filas: 2 })));
    caja.appendChild(casillaFicha(fijo && fijo.nucleo ? "Obligatorio (siempre)" : "Obligatorio", b.obligatorio, (v) => (b.obligatorio = v), fijo && fijo.nucleo));
  }

  // Mover a otra sección.
  const secciones = fichaBorrador.secciones;
  if (secciones.length > 1) {
    const mover = nodo("select", "input-texto");
    secciones.forEach((s, i) => {
      const op = nodo("option", "", `${i + 1}. ${s.titulo || "(sin título)"}`);
      op.value = String(i);
      mover.appendChild(op);
    });
    mover.value = String(secciones.indexOf(seccionActual));
    mover.addEventListener("change", () => {
      const destino = secciones[Number(mover.value)];
      if (!destino || destino === seccionActual) return;
      seccionActual.bloques.splice(seccionActual.bloques.indexOf(b), 1);
      destino.bloques.push(b);
      marcarFichaSucia();
      pintarEditorFicha();
    });
    caja.appendChild(etiquetaYCampo("Mover a la sección", mover));
  }
  refrescarTexto();
  return caja;
}

// ---------- vista previa ----------

let vistaPreviaOrigen = "";

el("btnVistaPreviaFicha").addEventListener("click", () => {
  const url = new URL(fichaSeleccionada === "adultos" ? "adultos.html" : "", FICHAS_BASE_URL);
  url.searchParams.set("vistaPrevia", "1");
  vistaPreviaOrigen = url.origin;
  el("marcoVistaPreviaFicha").src = url.toString();
  el("vistaPreviaFicha").hidden = false;
  document.body.style.overflow = "hidden";
});

window.addEventListener("message", (e) => {
  if (!vistaPreviaOrigen || e.origin !== vistaPreviaOrigen) return;
  if (!e.data || e.data.tipo !== "vistaPreviaLista") return;
  el("marcoVistaPreviaFicha").contentWindow.postMessage({ tipo: "vistaPreviaFicha", config: fichaBorrador }, vistaPreviaOrigen);
});

el("btnCerrarVistaPreviaFicha").addEventListener("click", () => {
  el("vistaPreviaFicha").hidden = true;
  el("marcoVistaPreviaFicha").src = "about:blank";
  document.body.style.overflow = "";
});

// ---------- guardar / descartar ----------

el("btnDescartarFicha").addEventListener("click", () => {
  if (!fichaSucia) return;
  if (!confirm("¿Descartar los cambios sin guardar?")) return;
  elegirFicha(fichaSeleccionada, true);
});

el("btnGuardarFicha").addEventListener("click", async () => {
  const editadoPor = el("inputEditadoPorFicha").value.trim();
  if (!editadoPor) {
    mensajeFicha("Escribe tu nombre para registrar quién hizo el cambio.", "error");
    el("inputEditadoPorFicha").focus();
    return;
  }
  const boton = el("btnGuardarFicha");
  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    const datos = await llamarWorker({
      accion: "recepcionFichaGuardar",
      clave: claveRecepcion,
      ficha: fichaSeleccionada,
      version: fichasDatos.fichas[fichaSeleccionada].version,
      config: fichaBorrador,
      editadoPor,
    });
    fichaSucia = false;
    await cargarFichasEditor();
    mensajeFicha(`✅ Guardado (versión ${datos.version}). La ficha pública ya muestra los cambios (puede tardar hasta 30 segundos).`, "ok");
  } catch (e) {
    if (/mientras la editabas/.test(e.message)) {
      fichaSucia = false;
      await cargarFichasEditor();
    }
    mensajeFicha(e.message, "error");
  } finally {
    boton.disabled = false;
    boton.textContent = "💾 Guardar cambios";
  }
});
