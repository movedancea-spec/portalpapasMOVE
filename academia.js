// =====================================================================
// BIOMÉTRICO — Panel de la Academia cliente
// =====================================================================
// IMPORTANTE: cambia esta URL por la de TU Worker una vez publicado en
// Cloudflare — debe ser la MISMA URL que pusiste en dueno.js. Sin "/"
// al final.
const API_URL = "https://biometrico-saas.movedancea.workers.dev";

const el = (id) => document.getElementById(id);

let sesion = null; // { academiaId, clave, nombre, limiteAlumnas }
let alumnaEditandoId = null;
let fotoNuevaBase64 = null; // usada tanto para crear como para editar (se limpia entre usos)
let intervaloAlumnas = null; // refresca sola la lista de alumnos (asistencias en tiempo casi real)

function urlFoto(fotoKey) {
  return fotoKey ? `${API_URL}/foto?key=${encodeURIComponent(fotoKey)}` : "";
}

async function llamar(accion, datos) {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion, academiaId: sesion?.academiaId, clave: sesion?.clave, ...datos }),
  });
  return await resp.json();
}

function escaparHtml(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

// Las fotos que salen directo de un celular pueden pesar varios MB —
// eso es lo que hacía que subir el logo (o una foto de alumno) se
// sintiera lentísimo, o hasta se quedara pegado. Antes de mandarla al
// servidor, se reduce aquí mismo en el navegador a un tamaño de sobra
// para cómo se usa en el sistema (nunca se muestra más grande que un
// círculo o un logo chiquito), así que baja de varios MB a unos pocos
// cientos de KB sin notarse la diferencia visualmente.
function redimensionarImagen(archivo, ladoMaximo = 480, calidadJpeg = 0.82) {
  return new Promise((resolve, reject) => {
    if (!archivo) return resolve(null);
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo abrir esa imagen. Prueba con un JPG o PNG."));
      img.onload = () => {
        let { width, height } = img;
        if (width > ladoMaximo || height > ladoMaximo) {
          if (width >= height) {
            height = Math.round(height * (ladoMaximo / width));
            width = ladoMaximo;
          } else {
            width = Math.round(width * (ladoMaximo / height));
            height = ladoMaximo;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Los logos suelen tener fondo transparente (PNG) — eso se
        // conserva. Las fotos normales (JPEG) se comprimen más, porque
        // no necesitan transparencia y así pesan bastante menos.
        const conservaTransparencia = /image\/(png|webp|gif)/.test(archivo.type);
        const dataUrl = conservaTransparencia
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", calidadJpeg);
        resolve(dataUrl);
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

// Lee cualquier archivo (PDF incluido) como data URL, tal cual, sin
// pasar por canvas — se usa para los comprobantes de pago cuando son
// PDF, porque un PDF no se puede "dibujar" en un canvas como una foto.
function leerArchivoBase64(archivo) {
  return new Promise((resolve, reject) => {
    if (!archivo) return resolve(null);
    const lector = new FileReader();
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.onload = () => resolve(lector.result);
    lector.readAsDataURL(archivo);
  });
}

// El comprobante de pago puede ser una foto (se reduce, igual que el
// resto de imágenes del sistema, pero a un tamaño más grande que un
// logo/foto de alumno para que los montos y datos se sigan leyendo
// bien) o un PDF (se manda tal cual, no se puede reducir).
async function leerComprobanteBase64(archivo) {
  if (!archivo) return null;
  if (archivo.type === "application/pdf") {
    return leerArchivoBase64(archivo);
  }
  return redimensionarImagen(archivo, 1400, 0.85);
}

// ---------------------------------------------------------------
// PERSONALIZACIÓN (color + logo) — se aplica con variables CSS, así
// que un solo color elegido por la academia recolorea todo el panel
// (y, con el mismo mecanismo, biometrico.js recolorea la pantalla de
// la tablet). Ver biometrico-style.css para las variables --color-*.
// ---------------------------------------------------------------
function hexARgb(hex) {
  const limpio = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(limpio.substr(i, 2), 16));
}

function rgbAHex(rgb) {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function mezclarConBlanco(hex, porcentaje) {
  return rgbAHex(hexARgb(hex).map((c) => c + (255 - c) * porcentaje));
}

function oscurecer(hex, porcentaje) {
  return rgbAHex(hexARgb(hex).map((c) => c * (1 - porcentaje)));
}

function aplicarMarca(colorMarca) {
  const raiz = document.documentElement.style;

  // Siempre se limpia primero: si este navegador ya había aplicado el
  // color de OTRA academia (por ejemplo, alguien salió e inició sesión
  // con una cuenta distinta), no debe quedarse pegado.
  ["--color-marca", "--color-marca-oscuro", "--color-marca-suave", "--color-marca-suave2",
    "--color-marca-suave3", "--color-marca-fondo", "--color-marca-fondo2", "--color-marca-fondo3",
    "--color-marca-texto-suave", "--color-marca-texto-suave2"].forEach((v) => raiz.removeProperty(v));

  if (!colorMarca || !/^#[0-9a-fA-F]{6}$/.test(colorMarca)) return;

  raiz.setProperty("--color-marca", colorMarca);
  raiz.setProperty("--color-marca-oscuro", oscurecer(colorMarca, 0.15));
  raiz.setProperty("--color-marca-suave", mezclarConBlanco(colorMarca, 0.88));
  raiz.setProperty("--color-marca-suave2", mezclarConBlanco(colorMarca, 0.82));
  raiz.setProperty("--color-marca-suave3", mezclarConBlanco(colorMarca, 0.75));
  raiz.setProperty("--color-marca-fondo", mezclarConBlanco(colorMarca, 0.96));
  raiz.setProperty("--color-marca-fondo2", mezclarConBlanco(colorMarca, 0.94));
  raiz.setProperty("--color-marca-fondo3", mezclarConBlanco(colorMarca, 0.92));
  raiz.setProperty("--color-marca-texto-suave", oscurecer(colorMarca, 0.25));
  raiz.setProperty("--color-marca-texto-suave2", oscurecer(colorMarca, 0.1));
}

function aplicarLogoEnHeader(logoKey) {
  const img = el("logoAcademia");
  if (logoKey) {
    img.src = urlFoto(logoKey);
    img.hidden = false;
  } else {
    img.hidden = true;
  }
}

// ---------------------------------------------------------------
// LOGIN / SESIÓN
// ---------------------------------------------------------------
function guardarSesion(s) {
  sesion = s;
  localStorage.setItem("biometrico_sesion_academia", JSON.stringify(s));
}

function cargarSesionGuardada() {
  try {
    const cruda = localStorage.getItem("biometrico_sesion_academia");
    if (!cruda) return null;
    return JSON.parse(cruda);
  } catch (e) {
    return null;
  }
}

function mostrarPanel() {
  el("pantallaLogin").hidden = true;
  el("pantallaPanel").hidden = false;
  el("tituloAcademia").textContent = `📋 ${sesion.nombre}`;
  aplicarMarca(sesion.colorMarca);
  aplicarLogoEnHeader(sesion.logoKey);
  el("inputColorMarca").value = sesion.colorMarca || "#ef4b9b";
  el("inputEmailCuenta").value = sesion.email || "";
  cargarAlumnas();
  cargarMensualidad();
  iniciarActualizacionAutomatica();
}

// Refresca sola la lista de alumnos Y el estado de la mensualidad
// cada pocos segundos mientras el panel está abierto — así, sin que
// nadie tenga que darle refresh a la página:
//   - cuando un alumno marca su entrada en la tablet (biometrico.html),
//     el conteo de "clases este mes" se actualiza solo.
//   - cuando Ana marca la academia como "pagada manualmente" desde su
//     panel de dueño, aquí deja de decir "Pendiente de pago" y pasa a
//     "✅ Al día" solo, sin que la academia tenga que recargar.
// Se detiene al salir de la sesión, y se pausa mientras la pestaña
// está en segundo plano para no gastar de más.
function iniciarActualizacionAutomatica() {
  detenerActualizacionAutomatica();
  intervaloAlumnas = setInterval(() => {
    if (document.hidden) return; // pestaña en segundo plano — no molesta con llamadas de más
    if (el("modalAlumna").hidden) cargarAlumnas(); // no refrescar la lista mientras se está editando un alumno
    cargarMensualidad();
  }, 15000);
}

function detenerActualizacionAutomatica() {
  if (intervaloAlumnas) {
    clearInterval(intervaloAlumnas);
    intervaloAlumnas = null;
  }
}

function volverALogin(mensaje) {
  sesion = null;
  localStorage.removeItem("biometrico_sesion_academia");
  detenerActualizacionAutomatica();
  el("pantallaPanel").hidden = true;
  el("pantallaLogin").hidden = false;
  aplicarMarca(null);
  aplicarLogoEnHeader(null);
  if (mensaje) el("mensajeErrorLogin").textContent = mensaje;
}

async function intentarEntrar() {
  const nombre = el("inputNombreAcademia").value.trim();
  const clave = el("inputClaveAcademia").value.trim();
  if (!nombre || !clave) return;
  el("mensajeErrorLogin").textContent = "";
  el("btnEntrarAcademia").disabled = true;
  el("btnEntrarAcademia").textContent = "Entrando...";

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "academiaLogin", nombre, clave }),
    });
    const r = await resp.json();
    if (!r.success) {
      el("mensajeErrorLogin").textContent = r.error || "No se pudo entrar.";
      return;
    }
    guardarSesion({
      academiaId: r.academiaId,
      clave,
      nombre: r.nombre,
      limiteAlumnas: r.limiteAlumnas,
      colorMarca: r.colorMarca || null,
      logoKey: r.logoKey || null,
      email: r.email || null,
    });
    mostrarPanel();
  } catch (e) {
    el("mensajeErrorLogin").textContent = "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";
  } finally {
    el("btnEntrarAcademia").disabled = false;
    el("btnEntrarAcademia").textContent = "Entrar →";
  }
}

el("btnEntrarAcademia").addEventListener("click", intentarEntrar);
el("inputClaveAcademia").addEventListener("keydown", (e) => { if (e.key === "Enter") intentarEntrar(); });

el("btnSalirAcademia").addEventListener("click", () => volverALogin());

// ---------------------------------------------------------------
// OLVIDÉ MI CONTRASEÑA — paso 1: pedir el enlace de recuperación.
// No requiere haber iniciado sesión (es justo para cuando no se
// puede entrar).
// ---------------------------------------------------------------
el("btnMostrarOlvide").addEventListener("click", () => {
  el("pantallaLogin").hidden = true;
  el("pantallaOlvide").hidden = false;
  el("inputOlvideNombre").value = el("inputNombreAcademia").value;
  el("mensajeErrorOlvide").textContent = "";
  el("mensajeExitoOlvide").textContent = "";
});

el("btnCancelarOlvide").addEventListener("click", () => {
  el("pantallaOlvide").hidden = true;
  el("pantallaLogin").hidden = false;
});

el("btnEnviarOlvide").addEventListener("click", async () => {
  const nombre = el("inputOlvideNombre").value.trim();
  const email = el("inputOlvideEmail").value.trim();
  el("mensajeErrorOlvide").textContent = "";
  el("mensajeExitoOlvide").textContent = "";

  if (!nombre || !email) {
    el("mensajeErrorOlvide").textContent = "Escribe el nombre de tu academia y tu correo registrado.";
    return;
  }

  el("btnEnviarOlvide").disabled = true;
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // "origenPanel" le dice al servidor a qué dirección apunta ESTA
      // misma página, para armar el enlace del correo — así el Worker
      // no necesita saber de antemano dónde quedó publicado el panel.
      body: JSON.stringify({
        accion: "academiaSolicitarRecuperacion",
        nombre,
        email,
        origenPanel: window.location.origin + window.location.pathname,
      }),
    });
    const r = await resp.json();
    if (!r.success) {
      el("mensajeErrorOlvide").textContent = r.error || "No se pudo procesar la solicitud.";
      return;
    }
    el("mensajeExitoOlvide").textContent = r.mensaje || "Si los datos coinciden con una cuenta, te llega un correo con instrucciones.";
  } catch (e) {
    el("mensajeErrorOlvide").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnEnviarOlvide").disabled = false;
  }
});

// ---------------------------------------------------------------
// OLVIDÉ MI CONTRASEÑA — paso 2: se llega aquí desde el enlace del
// correo (academia.html?recuperar=TOKEN). Se detecta apenas carga la
// página y se muestra directo el formulario de contraseña nueva.
// ---------------------------------------------------------------
const tokenRecuperacion = new URLSearchParams(window.location.search).get("recuperar");

if (tokenRecuperacion) {
  el("pantallaLogin").hidden = true;
  el("pantallaOlvide").hidden = true;
  el("pantallaRestablecer").hidden = false;
}

el("btnRestablecerClave").addEventListener("click", async () => {
  const claveNueva = el("inputRestablecerClave").value;
  const confirmar = el("inputRestablecerClaveConfirmar").value;
  el("mensajeErrorRestablecer").textContent = "";
  el("mensajeExitoRestablecer").textContent = "";

  if (claveNueva.length < 4) {
    el("mensajeErrorRestablecer").textContent = "La contraseña nueva debe tener al menos 4 caracteres.";
    return;
  }
  if (claveNueva !== confirmar) {
    el("mensajeErrorRestablecer").textContent = "Las dos contraseñas no coinciden.";
    return;
  }

  el("btnRestablecerClave").disabled = true;
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "academiaRestablecerClave", token: tokenRecuperacion, claveNueva }),
    });
    const r = await resp.json();
    if (!r.success) {
      el("mensajeErrorRestablecer").textContent = r.error || "No se pudo cambiar la contraseña.";
      return;
    }
    el("mensajeExitoRestablecer").textContent = "¡Listo! Ya puedes entrar con tu contraseña nueva.";
    el("btnRestablecerClave").disabled = true;
    setTimeout(() => {
      // Se quita el "?recuperar=..." de la URL y regresa al login normal.
      window.location.href = window.location.pathname;
    }, 2000);
  } catch (e) {
    el("mensajeErrorRestablecer").textContent = "No se pudo conectar. Inténtalo de nuevo.";
    el("btnRestablecerClave").disabled = false;
  }
});

// ---------------------------------------------------------------
// MI CUENTA — correo de recuperación y cambiar contraseña (estando
// ya logueado, distinto del flujo de "olvidé mi contraseña").
// ---------------------------------------------------------------
el("btnGuardarEmail").addEventListener("click", async () => {
  const email = el("inputEmailCuenta").value.trim();
  el("mensajeErrorEmail").textContent = "";
  el("mensajeExitoEmail").textContent = "";
  el("btnGuardarEmail").disabled = true;

  try {
    const r = await llamar("academiaActualizarEmail", { email });
    if (!r.success) { el("mensajeErrorEmail").textContent = r.error || "No se pudo guardar."; return; }
    sesion.email = r.email || null;
    guardarSesion(sesion);
    el("mensajeExitoEmail").textContent = "¡Correo guardado!";
  } catch (e) {
    el("mensajeErrorEmail").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnGuardarEmail").disabled = false;
  }
});

el("btnCambiarClave").addEventListener("click", async () => {
  const claveNueva = el("inputClaveNueva").value;
  const confirmar = el("inputClaveNuevaConfirmar").value;
  el("mensajeErrorClave").textContent = "";
  el("mensajeExitoClave").textContent = "";

  if (claveNueva.length < 4) {
    el("mensajeErrorClave").textContent = "La contraseña nueva debe tener al menos 4 caracteres.";
    return;
  }
  if (claveNueva !== confirmar) {
    el("mensajeErrorClave").textContent = "Las dos contraseñas no coinciden.";
    return;
  }

  el("btnCambiarClave").disabled = true;
  try {
    const r = await llamar("academiaCambiarClave", { claveNueva });
    if (!r.success) { el("mensajeErrorClave").textContent = r.error || "No se pudo cambiar."; return; }
    // La sesión guardada usa la clave para autenticar cada acción — si
    // no se actualiza aquí también, el siguiente clic (por ejemplo,
    // cargar la lista de alumnos) fallaría con "Sesión inválida".
    sesion.clave = claveNueva;
    guardarSesion(sesion);
    el("inputClaveNueva").value = "";
    el("inputClaveNuevaConfirmar").value = "";
    el("mensajeExitoClave").textContent = "¡Contraseña cambiada! La vas a necesitar la próxima vez que entres.";
  } catch (e) {
    el("mensajeErrorClave").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnCambiarClave").disabled = false;
  }
});

// ---------------------------------------------------------------
// LISTAR / PINTAR ALUMNAS
// ---------------------------------------------------------------
async function cargarAlumnas() {
  try {
    const r = await llamar("academiaListarAlumnas", {});
    if (!r.success) {
      if (r.bloqueadaPorPago) {
        // Sigue con la sesión iniciada (NO se manda a volverALogin) —
        // así puede quedarse viendo la pantalla y usar "💳 Mensualidad"
        // para pagar y desbloquearse sola.
        el("listaAlumnas").innerHTML =
          '<p class="lista-vacia">Tu academia está desactivada por falta de pago de la mensualidad. Ve a "💳 Mensualidad" arriba para ponerte al día.</p>';
        el("infoLimiteAlumnas").textContent = "Cuenta desactivada";
        el("btnCrearAlumna").disabled = true;
        return;
      }
      volverALogin(r.error || "Tu sesión ya no es válida, vuelve a entrar.");
      return;
    }
    sesion.limiteAlumnas = r.limiteAlumnas;
    pintarAlumnas(r.alumnas, r.cantidadAlumnas, r.limiteAlumnas);
  } catch (e) {
    el("listaAlumnas").innerHTML = '<p class="lista-vacia">No se pudo cargar la lista. Revisa tu conexión.</p>';
  }
}

// ---------------------------------------------------------------
// MENSUALIDAD — estado del cobro del mes y botón para generar el
// link de pago de Paggo. A propósito NO depende de que la academia
// esté al día (por eso el servidor usa verificarAcademiaSoloActiva
// para estas dos acciones) — así siempre puede pagar y desbloquearse.
// ---------------------------------------------------------------
async function cargarMensualidad() {
  try {
    const r = await llamar("academiaConsultarPago", {});
    if (!r.success) {
      el("mensualidadTextoAyuda").textContent = r.error || "No se pudo consultar tu mensualidad.";
      return;
    }
    pintarMensualidad(r);
  } catch (e) {
    el("mensualidadTextoAyuda").textContent = "No se pudo consultar tu mensualidad. Revisa tu conexión.";
  }
}

function pintarMensualidad(r) {
  el("mensajeErrorMensualidad").textContent = "";
  el("mensajeExitoMensualidad").textContent = "";
  pintarEstadoComprobante(r);

  if (r.estadoMes === "pagado") {
    el("mensualidadTextoAyuda").textContent = `Tu mensualidad de este mes (${r.mes}) ya está pagada. ¡Gracias!`;
    el("mensualidadEstadoTexto").textContent = "✅ Al día";
    el("mensualidadEstadoTexto").style.color = "#1a9c5c";
    el("btnGenerarLinkPago").hidden = true;
    el("enlaceLinkPago").hidden = true;
    el("mensualidadTextoLinkVence").hidden = true;
    return;
  }

  el("mensualidadEstadoTexto").style.color = r.pagoAlDia ? "inherit" : "#d0304c";
  el("mensualidadEstadoTexto").textContent = r.pagoAlDia
    ? "⏳ Pendiente de pago"
    : "🚫 Cuenta desactivada por falta de pago";
  el("mensualidadTextoAyuda").textContent = r.mensualidad
    ? `Tu mensualidad de ${r.mes} es de Q${Number(r.mensualidad).toFixed(2)}. Genera tu link y págalo con tarjeta.`
    : "Todavía no tienes una mensualidad asignada — pídele al administrador del sistema que te la configure.";

  // Un botón a la vez: si ya hay un link generado y pendiente de pagar,
  // se muestra SOLO "Pagar ahora" (ya no tiene caso volver a generar
  // otro); si todavía no hay link (o el anterior ya venció, pasadas 24
  // horas), se muestra SOLO "Generar link de pago".
  if (r.link) {
    el("btnGenerarLinkPago").hidden = true;
    el("enlaceLinkPago").href = r.link;
    el("enlaceLinkPago").hidden = false;
    el("mensualidadTextoLinkVence").hidden = false;
    el("mensualidadTextoLinkVence").textContent = "Este link de pago es válido por 24 horas desde que se generó.";
  } else {
    el("btnGenerarLinkPago").hidden = !r.mensualidad;
    el("enlaceLinkPago").hidden = true;
    el("mensualidadTextoLinkVence").hidden = !r.linkExpirado;
    if (r.linkExpirado) {
      el("mensualidadTextoLinkVence").textContent = "Tu link anterior ya venció (duran 24 horas) — genera uno nuevo.";
    }
  }
}

function pintarEstadoComprobante(r) {
  el("comprobanteEstadoTexto").textContent = r.comprobanteSubido
    ? `✅ Ya subiste un comprobante para ${r.mes}${r.comprobanteSubidoEn ? " (" + r.comprobanteSubidoEn + " UTC)" : ""} — el administrador lo va a revisar.`
    : `Todavía no has subido ningún comprobante para ${r.mes}.`;
}

el("btnGenerarLinkPago").addEventListener("click", async () => {
  el("mensajeErrorMensualidad").textContent = "";
  el("mensajeExitoMensualidad").textContent = "";
  el("btnGenerarLinkPago").disabled = true;
  el("btnGenerarLinkPago").textContent = "Generando link...";

  try {
    const r = await llamar("academiaGenerarLinkPago", {});
    if (!r.success) { el("mensajeErrorMensualidad").textContent = r.error || "No se pudo generar el link de pago."; return; }
    if (r.estadoMes === "pagado") {
      el("mensajeExitoMensualidad").textContent = "Este mes ya estaba pagado.";
      cargarMensualidad();
      return;
    }
    el("btnGenerarLinkPago").hidden = true;
    el("enlaceLinkPago").href = r.link;
    el("enlaceLinkPago").hidden = false;
    el("mensajeExitoMensualidad").textContent = "¡Listo! Dale clic a \"Pagar ahora\" para completar el pago con tarjeta.";
  } catch (e) {
    el("mensajeErrorMensualidad").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnGenerarLinkPago").disabled = false;
    el("btnGenerarLinkPago").textContent = "Generar link de pago";
  }
});

el("btnSubirComprobante").addEventListener("click", async () => {
  el("mensajeErrorComprobante").textContent = "";
  el("mensajeExitoComprobante").textContent = "";

  const archivo = el("inputComprobantePago").files[0] || null;
  if (!archivo) { el("mensajeErrorComprobante").textContent = "Elige primero una foto o un PDF de tu comprobante."; return; }
  if (archivo.type !== "application/pdf" && !archivo.type.startsWith("image/")) {
    el("mensajeErrorComprobante").textContent = "Ese archivo no es una foto ni un PDF."; return;
  }

  el("btnSubirComprobante").disabled = true;
  el("btnSubirComprobante").textContent = "Subiendo...";
  try {
    const comprobanteBase64 = await leerComprobanteBase64(archivo);
    const r = await llamar("academiaSubirComprobante", { comprobanteBase64 });
    if (!r.success) { el("mensajeErrorComprobante").textContent = r.error || "No se pudo subir el comprobante."; return; }
    el("mensajeExitoComprobante").textContent = r.mensaje || "¡Comprobante subido!";
    el("inputComprobantePago").value = "";
    cargarMensualidad();
  } catch (e) {
    el("mensajeErrorComprobante").textContent = e.message || "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnSubirComprobante").disabled = false;
    el("btnSubirComprobante").textContent = "Subir comprobante";
  }
});

function pintarAlumnas(alumnas, cantidad, limite) {
  el("infoLimiteAlumnas").textContent = `${cantidad} / ${limite} alumnos`;
  el("ayudaCantidadAlumnas").textContent =
    cantidad >= limite
      ? `Llegaste al límite de tu plan (${limite}). Para agregar más, hay que ampliar el plan con el administrador del sistema.`
      : `Tienes ${cantidad} de ${limite} alumnos de tu plan actual.`;

  el("btnCrearAlumna").disabled = cantidad >= limite;

  const cont = el("listaAlumnas");
  if (!alumnas.length) {
    cont.innerHTML = '<p class="lista-vacia">Todavía no has agregado ningún alumno.</p>';
    return;
  }

  cont.innerHTML = "";
  alumnas.forEach((a) => {
    const div = document.createElement("div");
    div.className = "tarjeta-item";
    const foto = a.foto_key
      ? `<img class="foto-miniatura" src="${urlFoto(a.foto_key)}" alt="" />`
      : `<div class="foto-miniatura vacia">🧑</div>`;
    div.innerHTML = `
      ${foto}
      <div class="info-principal">
        <div class="nombre-item">#${a.codigo} — ${escaparHtml(a.nombre)}</div>
        <div class="detalle-item">
          <span class="etiqueta-estado ${a.estado === "Activa" ? "activa" : "inactiva"}">${a.estado}</span>
          &nbsp;·&nbsp; ${a.clasesEsteMes} / ${a.clases_por_mes} clases este mes
        </div>
      </div>
      <div class="acciones-item">
        <button class="btn secundario chico" data-accion="editar">Editar</button>
      </div>
    `;
    div.querySelector('[data-accion="editar"]').addEventListener("click", () => abrirModalEditar(a));
    cont.appendChild(div);
  });
}

// ---------------------------------------------------------------
// CREAR ALUMNA
// ---------------------------------------------------------------
el("btnCrearAlumna").addEventListener("click", async () => {
  const nombre = el("inputNuevaAlumnaNombre").value.trim();
  const clasesPorMes = Number(el("inputNuevaAlumnaClases").value) || 8;
  const archivo = el("inputNuevaAlumnaFoto").files[0] || null;

  el("mensajeErrorCrear").textContent = "";
  el("mensajeExitoCrear").textContent = "";

  if (!nombre) { el("mensajeErrorCrear").textContent = "Escribe el nombre del alumno."; return; }

  el("btnCrearAlumna").disabled = true;
  try {
    const fotoBase64 = await redimensionarImagen(archivo);
    const r = await llamar("academiaCrearAlumna", { nombre, clasesPorMes, fotoBase64 });
    if (!r.success) {
      el("mensajeErrorCrear").textContent = r.error || "No se pudo agregar.";
      return;
    }
    const textoClavePortal = r.claveInicialPortal
      ? ` Su contraseña del Portal de Alumnos es ${r.claveInicialPortal} — cómpartesela a los papás (la pueden cambiar después).`
      : "";
    el("mensajeExitoCrear").textContent = r.advertenciaFoto
      ? `"${nombre}" agregada con el código #${r.codigo}.${textoClavePortal} ⚠️ ${r.advertenciaFoto}`
      : `"${nombre}" agregada con el código #${r.codigo}.${textoClavePortal}`;
    el("inputNuevaAlumnaNombre").value = "";
    el("inputNuevaAlumnaClases").value = "8";
    el("inputNuevaAlumnaFoto").value = "";
    cargarAlumnas();
  } catch (e) {
    el("mensajeErrorCrear").textContent = e.message || "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnCrearAlumna").disabled = false;
  }
});

// ---------------------------------------------------------------
// EDITAR / BORRAR ALUMNA (modal)
// ---------------------------------------------------------------
function abrirModalEditar(alumna) {
  alumnaEditandoId = alumna.id;
  el("inputEditarNombre").value = alumna.nombre;
  el("inputEditarClases").value = alumna.clases_por_mes;
  el("selectEditarEstado").value = alumna.estado;
  el("inputEditarFoto").value = "";
  el("mensajeErrorEditar").textContent = "";

  el("textoEstadoClavePortal").textContent = alumna.tieneClavePortal
    ? "Ya tiene una contraseña asignada — si la perdió, puedes generarle una nueva (la anterior deja de servir)."
    : "Todavía no tiene contraseña del Portal de Alumnos — genérale una para poder compartírsela a los papás.";
  el("btnGenerarClavePortal").textContent = alumna.tieneClavePortal ? "Generar contraseña nueva" : "Generar contraseña";
  el("mensajeClavePortalGenerada").textContent = "";

  const preview = el("fotoPreviewModal");
  if (alumna.foto_key) {
    preview.src = urlFoto(alumna.foto_key);
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }

  el("modalAlumna").hidden = false;
}

el("btnGenerarClavePortal").addEventListener("click", async () => {
  if (!window.confirm("¿Generar una contraseña nueva del Portal de Alumnos para este alumno? Si ya tenía una, deja de funcionar.")) return;

  el("btnGenerarClavePortal").disabled = true;
  el("mensajeClavePortalGenerada").textContent = "";
  try {
    const r = await llamar("academiaGenerarClavePortalAlumna", { alumnaId: alumnaEditandoId });
    if (!r.success) { el("mensajeErrorEditar").textContent = r.error || "No se pudo generar."; return; }
    el("mensajeClavePortalGenerada").textContent = `Contraseña nueva: ${r.clave} — cómpartesela a los papás.`;
    el("textoEstadoClavePortal").textContent = "Ya tiene una contraseña asignada — si la perdió, puedes generarle una nueva (la anterior deja de servir).";
    el("btnGenerarClavePortal").textContent = "Generar contraseña nueva";
  } catch (e) {
    el("mensajeErrorEditar").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnGenerarClavePortal").disabled = false;
  }
});

el("btnCancelarEditar").addEventListener("click", () => { el("modalAlumna").hidden = true; });

el("btnGuardarEditar").addEventListener("click", async () => {
  const nombre = el("inputEditarNombre").value.trim();
  const clasesPorMes = Number(el("inputEditarClases").value) || 8;
  const estado = el("selectEditarEstado").value;
  const archivo = el("inputEditarFoto").files[0] || null;

  if (!nombre) { el("mensajeErrorEditar").textContent = "El nombre no puede quedar vacío."; return; }

  el("btnGuardarEditar").disabled = true;
  try {
    const fotoBase64 = await redimensionarImagen(archivo);
    const r = await llamar("academiaEditarAlumna", {
      alumnaId: alumnaEditandoId,
      nombre,
      clasesPorMes,
      estado,
      ...(fotoBase64 ? { fotoBase64 } : {}),
    });
    if (!r.success) { el("mensajeErrorEditar").textContent = r.error || "No se pudo guardar."; return; }
    if (r.advertenciaFoto) {
      // Se deja el modal abierto (en vez de cerrarlo de una vez) para
      // que se alcance a leer el aviso — si no, "se guarda pero no se
      // ve la foto" y nadie se entera de por qué.
      el("mensajeErrorEditar").textContent = "⚠️ " + r.advertenciaFoto;
      cargarAlumnas();
      return;
    }
    el("modalAlumna").hidden = true;
    cargarAlumnas();
  } catch (e) {
    el("mensajeErrorEditar").textContent = e.message || "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnGuardarEditar").disabled = false;
  }
});

el("btnBorrarAlumna").addEventListener("click", async () => {
  const nombre = el("inputEditarNombre").value.trim();
  if (!window.confirm(`¿Borrar a "${nombre}"? Se elimina para siempre junto con su historial de asistencia y su foto. Esto no se puede deshacer.`)) return;

  try {
    const r = await llamar("academiaBorrarAlumna", { alumnaId: alumnaEditandoId });
    if (!r.success) { el("mensajeErrorEditar").textContent = r.error || "No se pudo borrar."; return; }
    el("modalAlumna").hidden = true;
    cargarAlumnas();
  } catch (e) {
    el("mensajeErrorEditar").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  }
});

// NOTA: marcar asistencia (la pantalla de "meter el código") ya NO vive
// aquí — vive aparte, en biometrico.html/biometrico.js, pensada para
// quedarse abierta en una tablet en la entrada. Esta página
// (academia.html) es solo para administrar alumnos.

// ---------------------------------------------------------------
// GUARDAR PERSONALIZACIÓN (color + logo)
// ---------------------------------------------------------------

// Vista previa en vivo del color mientras lo eligen, antes de guardar.
el("inputColorMarca").addEventListener("input", () => {
  aplicarMarca(el("inputColorMarca").value);
});

el("inputLogoMarca").addEventListener("change", async () => {
  const archivo = el("inputLogoMarca").files[0] || null;
  const preview = el("logoPreviewPersonalizar");
  if (!archivo) { preview.hidden = true; return; }
  el("mensajeErrorMarca").textContent = "";
  try {
    const dataUrl = await redimensionarImagen(archivo);
    preview.src = dataUrl;
    preview.hidden = false;
  } catch (e) {
    preview.hidden = true;
    el("mensajeErrorMarca").textContent = e.message || "No se pudo abrir esa imagen.";
  }
});

el("btnGuardarMarca").addEventListener("click", async () => {
  const color = el("inputColorMarca").value;
  const archivo = el("inputLogoMarca").files[0] || null;

  el("mensajeErrorMarca").textContent = "";
  el("mensajeExitoMarca").textContent = "";
  el("btnGuardarMarca").disabled = true;

  try {
    const logoBase64 = await redimensionarImagen(archivo);
    const r = await llamar("academiaActualizarMarca", {
      colorMarca: color,
      ...(logoBase64 ? { logoBase64 } : {}),
    });
    if (!r.success) { el("mensajeErrorMarca").textContent = r.error || "No se pudo guardar."; return; }

    // Vuelve a pedir los datos de sesión para tener la key real del
    // logo que asignó el servidor (así queda bien guardada y se ve
    // igual la próxima vez que entren, sin tener que adivinarla aquí).
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "academiaLogin", nombre: sesion.nombre, clave: sesion.clave }),
      });
      const refresco = await resp.json();
      if (refresco.success) {
        sesion.colorMarca = refresco.colorMarca || null;
        sesion.logoKey = refresco.logoKey || null;
        aplicarLogoEnHeader(sesion.logoKey);
      }
    } catch (e) {
      // Si esto falla no pasa nada grave — el color ya se aplicó en
      // pantalla, y el logo se refresca solo la próxima vez que entren.
    }
    guardarSesion(sesion);
    el("mensajeExitoMarca").textContent = "¡Personalización guardada!";
    el("inputLogoMarca").value = "";
    el("logoPreviewPersonalizar").hidden = true;
  } catch (e) {
    el("mensajeErrorMarca").textContent = e.message || "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnGuardarMarca").disabled = false;
  }
});

// ---------------------------------------------------------------
// INICIO — si ya había sesión guardada, entra directo (a menos que se
// haya llegado aquí desde un enlace de "olvidé mi contraseña" — en
// ese caso se prioriza poner la contraseña nueva, no colar la sesión
// vieja que ya estaba guardada en este navegador).
// ---------------------------------------------------------------
if (!tokenRecuperacion) {
  const sesionGuardada = cargarSesionGuardada();
  if (sesionGuardada) {
    sesion = sesionGuardada;
    mostrarPanel();
  }
}
