// ==========================================
// MOVE — AVISO DE MAESTRA A SUS ALUMNAS
// MOVE Dance Academy
// ==========================================
// Cada maestra puede mandar un aviso (con foto o PDF opcional) SOLO a
// las alumnas del grupo que ella elija, entre los grupos donde es
// maestra principal. Siempre va por el Portal (push + se ve al abrir
// el Portal de Alumnas) — nunca por WhatsApp. Reusa la misma sesión
// compartida (sesionmaestra.js) que el Portal de Maestras, el Chat de
// Maestras y el Panel de Clase, así que si ya entró en cualquiera de
// esas pantallas, aquí no le vuelve a pedir la clave.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";


let maestraId = "";
let nombreMaestra = "";
let gruposMaestra = [];
let grupoActual = null; // { id, nombre, estilo, totalAlumnas }
let archivoAviso = null;

// ---------- recuperar clave (pantalla de login) ----------
let maestrasParaRecuperar = [];
let maestraSeleccionadaRecuperar = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaGrupos", "pantallaAviso"].forEach((p) => {
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
// Misma lógica que en Recepción. Si se cambia aquí, revisar las otras copias (recepcion.js, portal.js).
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

// ---------- login ----------

el("btnEntrarMaestra").addEventListener("click", () => entrarMaestra());
el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarMaestra();
});

async function entrarMaestra(claveAuto) {
  // Si claveAuto viene definida (string), es un intento AUTOMÁTICO (sesión
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

  if (!texto) return;

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
      // Por nombre: la lista ya no trae IDs (parche de seguridad).
      nombre: maestraSeleccionadaRecuperar.nombre,
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
    btn.addEventListener("click", () => abrirAviso(g));
    cont.appendChild(btn);
  });
}

// ---------- escribir y mandar el aviso ----------

function abrirAviso(grupo) {
  grupoActual = grupo;
  el("nombreGrupoAviso").textContent = grupo.nombre;
  el("inputAvisoTitulo").value = "";
  el("inputAvisoMensaje").value = "";
  el("inputAdjuntoAviso").value = "";
  el("nombreAdjuntoAviso").hidden = true;
  archivoAviso = null;
  const mensajeEl = el("mensajeAviso");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";
  mostrarPantalla("pantallaAviso");
}

el("btnVolverGrupos").addEventListener("click", () => {
  mostrarPantalla("pantallaGrupos");
});

el("inputAdjuntoAviso").addEventListener("change", () => {
  const archivo = el("inputAdjuntoAviso").files[0];
  if (!archivo) return;
  const error = errorArchivoParaAirtable(archivo);
  if (error) {
    alert(error);
    el("inputAdjuntoAviso").value = "";
    return;
  }
  archivoAviso = archivo;
  const nombreEl = el("nombreAdjuntoAviso");
  nombreEl.textContent = "📎 " + archivo.name;
  nombreEl.hidden = false;
});

el("btnMandarAviso").addEventListener("click", async () => {
  if (!grupoActual) return;
  const titulo = el("inputAvisoTitulo").value.trim();
  const mensaje = el("inputAvisoMensaje").value.trim();
  const mensajeEl = el("mensajeAviso");

  if (!titulo) {
    mensajeEl.textContent = "Escribe un título para el aviso.";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }
  if (!mensaje) {
    mensajeEl.textContent = "Escribe el mensaje del aviso.";
    mensajeEl.className = "mensaje-form mensaje-form-error";
    return;
  }

  const confirmado = window.confirm(
    `¿Mandar este aviso a las familias de "${grupoActual.nombre}"?\n\n"${titulo}"\n\n${mensaje}`
  );
  if (!confirmado) return;

  const btn = el("btnMandarAviso");
  btn.disabled = true;
  btn.textContent = "Mandando...";
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  try {
    const payload = {
      accion: "maestraMandarAviso",
      maestraId,
      grupoId: grupoActual.id,
      titulo,
      mensaje,
    };

    if (archivoAviso) {
      btn.textContent = "Subiendo archivo...";
      const preparado = await prepararArchivoParaAirtable(archivoAviso);
      payload.archivoBase64 = preparado.base64;
      payload.nombreArchivo = preparado.nombre;
      payload.tipoArchivo = preparado.tipo;
      btn.textContent = "Mandando...";
    }

    const datos = await llamarWorker(payload);
    mensajeEl.textContent = "✅ " + (datos.resumen || "Aviso mandado.");
    mensajeEl.classList.add("mensaje-form-ok");
    el("inputAvisoTitulo").value = "";
    el("inputAvisoMensaje").value = "";
    el("inputAdjuntoAviso").value = "";
    el("nombreAdjuntoAviso").hidden = true;
    archivoAviso = null;
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📣 Mandar aviso";
  }
});

// ---------- sesión compartida (Portal de Maestras) ----------
// Si ya inició sesión antes (en el Portal de Maestras, el Chat de Maestras
// o el Panel de Clase), entra directo a sus grupos sin pedirle la clave
// otra vez.
const sesionCompartidaAviso = leerSesionMaestraCompartida();
if (sesionCompartidaAviso && sesionCompartidaAviso.clave) {
  entrarMaestra(sesionCompartidaAviso.clave);
}
