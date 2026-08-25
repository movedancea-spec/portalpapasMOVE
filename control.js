// ==========================================
// MOVE — CONTROL REMOTO DEL PANEL DE CLASE
// MOVE Dance Academy
// ==========================================
// Página para el CELULAR de la maestra. Se conecta con el código PIN
// que aparece en la pantalla de la clase (la laptop, corriendo
// clase.html) y desde aquí manda comandos: cronómetro, ruleta,
// calificación y cambio de pestaña. La laptop revisa cada 2 segundos
// si hay comandos nuevos y los ejecuta tocando sus propios botones —
// este archivo nunca toca datos de alumnas ni de Airtable directamente,
// solo manda "comandos" cortos a un buzón temporal.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let pinActual = "";
let intervaloAhoraSuena = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaPin", "pantallaControl"].forEach((p) => {
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

// ---------- pantalla: entrar con el PIN ----------

const inputPin = el("inputPinControl");

inputPin.addEventListener("input", () => {
  // Solo dígitos, máximo 4 — así no hace falta validar formato aparte.
  inputPin.value = inputPin.value.replace(/\D/g, "").slice(0, 4);
});

inputPin.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") conectarControl();
});

el("btnConectarControl").addEventListener("click", conectarControl);

async function conectarControl() {
  const pin = inputPin.value.trim();
  const msg = el("mensajeErrorPin");
  msg.textContent = "";

  if (pin.length !== 4) {
    msg.textContent = "Escribe los 4 dígitos del código.";
    return;
  }

  const boton = el("btnConectarControl");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Conectando...";

  try {
    // No hay una acción aparte para "verificar" el código — se usa
    // controlRemotoObtener con un desdeId altísimo, que nunca trae
    // comandos, solo confirma si el código sigue activo.
    const datos = await llamarWorker({ accion: "controlRemotoObtener", pin, desdeId: 999999999 });
    if (!datos.activo) {
      msg.textContent = "Ese código no es válido o ya venció. Revisa la pantalla de la clase.";
      return;
    }
    pinActual = pin;
    el("pinConectadoTexto").textContent = pin;
    mostrarPantalla("pantallaControl");
    iniciarAhoraSuena();
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ---------- pantalla: botones de control ----------

const ETIQUETAS_COMANDO = {
  "cronometro:iniciar": "▶️ Cronómetro iniciado",
  "cronometro:pausar": "⏸ Cronómetro en pausa",
  "cronometro:reiniciar": "🔁 Cronómetro reiniciado",
  "ruleta:girar": "🎉 Ruleta girando",
  "ruleta:reiniciar": "🔄 Ruleta reiniciada",
  "calificacion:Excelente": "🌟 Calificada como Excelente",
  "calificacion:Buena": "👍 Calificada como Buena",
  "calificacion:Regular": "🙂 Calificada como Regular",
  "tab:Bienvenida": "👋 Cambiado a Bienvenida",
  "tab:Clase": "💃 Cambiado a Clase",
  "tab:Cierre": "🎀 Cambiado a Cierre",
  "tab:Bitacora": "📓 Cambiado a Bitácora",
  "tab:Video": "🎥 Cambiado a Video",
  "tab:Recepcion": "💬 Cambiado a Recepción",
};

document.querySelectorAll("[data-comando]").forEach((btn) => {
  btn.addEventListener("click", () => enviarComando(btn.dataset.comando, ETIQUETAS_COMANDO[btn.dataset.comando], btn));
});

// Función genérica: manda cualquier comando al Worker con este PIN.
// Por default va al buzón de comandos que revisa la laptop
// (accion "controlRemotoEnviar" — cronómetro, ruleta, calificación,
// pestañas). Los botones de Spotify usan la MISMA función pero con
// accion "spotifyComando", que el Worker ejecuta directo contra la
// cuenta de Spotify conectada (no pasa por el buzón ni por la
// laptop) — por eso Spotify sigue funcionando aunque el Panel de
// Clase esté cerrado, mientras el código PIN siga activo.
async function enviarComando(comando, etiquetaExito, btnControl, accion = "controlRemotoEnviar") {
  if (!pinActual) return;
  const mensaje = el("mensajeComandoControl");

  if (btnControl) btnControl.disabled = true;
  mensaje.style.color = "#999";
  mensaje.textContent = "Enviando...";

  try {
    const datos = await llamarWorker({ accion, pin: pinActual, comando });
    mensaje.style.color = "#1f9d63";
    // etiquetaExito puede ser un texto fijo, o una función que arma el
    // texto usando lo que devolvió el Worker (ej. el volumen de Spotify
    // después de subirlo/bajarlo, que cambia cada vez).
    const texto = typeof etiquetaExito === "function" ? etiquetaExito(datos) : etiquetaExito;
    mensaje.textContent = texto || "Comando enviado ✅";
    if (navigator.vibrate) navigator.vibrate(30);

    // Después de un comando de Spotify que cambia lo que está sonando,
    // se refresca "Ahora suena" un momento después (le da tiempo a
    // Spotify de actualizar su propio estado) en vez de esperar al
    // siguiente ciclo automático de 6 segundos.
    if (accion === "spotifyComando" && comando !== "volumen:subir" && comando !== "volumen:bajar") {
      setTimeout(actualizarAhoraSuena, 800);
    }
  } catch (e) {
    mensaje.style.color = "#e0245e";
    // Si el código ya venció (por ejemplo, la maestra ya cerró la
    // sesión en la laptop hace rato), se regresa sola a la pantalla
    // del PIN en vez de dejarla tocando botones que no llegan a
    // ningún lado.
    if (e.message.indexOf("válido") !== -1) {
      pinActual = "";
      detenerAhoraSuena();
      mostrarPantalla("pantallaPin");
      el("mensajeErrorPin").textContent = e.message;
      inputPin.value = "";
    } else {
      mensaje.textContent = e.message;
    }
  } finally {
    if (btnControl) btnControl.disabled = false;
  }
}

// ---------- Spotify (laptop) ----------

const ETIQUETAS_SPOTIFY = {
  reproducir: "▶️ Reproduciendo",
  pausar: "⏸ En pausa",
  siguiente: "⏭ Siguiente canción",
  anterior: "⏮ Canción anterior",
  "volumen:subir": (datos) => `🔊 Volumen: ${datos && datos.volumen != null ? datos.volumen : "?"}%`,
  "volumen:bajar": (datos) => `🔉 Volumen: ${datos && datos.volumen != null ? datos.volumen : "?"}%`,
};

document.querySelectorAll("[data-spotify]").forEach((btn) => {
  btn.addEventListener("click", () =>
    enviarComando(btn.dataset.spotify, ETIQUETAS_SPOTIFY[btn.dataset.spotify], btn, "spotifyComando")
  );
});

// Convierte texto a HTML seguro, para poder mostrar nombres de
// canciones/artistas (que vienen de Spotify, no los escribimos
// nosotros) sin arriesgarse a romper el HTML de la página.
function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

// ---------- Spotify: "Ahora suena" ----------
// Mientras la pantalla de control esté abierta y conectada, se revisa
// cada 6 segundos qué está sonando en Spotify y se muestra el nombre.

async function actualizarAhoraSuena() {
  if (!pinActual) return;
  const texto = el("ahoraSuenaTexto");
  if (!texto) return;

  try {
    const datos = await llamarWorker({ accion: "spotifyEstado", pin: pinActual });
    if (!datos.reproduciendo || !datos.cancion) {
      texto.textContent = "⏸ Nada sonando ahora mismo";
    } else {
      texto.innerHTML = `🎵 <strong>${escaparHtml(datos.cancion)}</strong>${datos.artista ? " — " + escaparHtml(datos.artista) : ""}`;
    }
  } catch (e) {
    // No se muestra como error grande — es solo información de fondo,
    // así que se deja un texto discreto y se sigue intentando en el
    // siguiente ciclo.
    texto.textContent = "No se pudo leer qué está sonando ahora.";
  }
}

function iniciarAhoraSuena() {
  detenerAhoraSuena();
  actualizarAhoraSuena();
  intervaloAhoraSuena = setInterval(actualizarAhoraSuena, 6000);
}

function detenerAhoraSuena() {
  if (intervaloAhoraSuena) {
    clearInterval(intervaloAhoraSuena);
    intervaloAhoraSuena = null;
  }
}

// ---------- Spotify: buscar canción ----------

el("btnBuscarCancionControl").addEventListener("click", buscarCancion);
el("inputBuscarCancionControl").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") buscarCancion();
});

async function buscarCancion() {
  if (!pinActual) return;
  const input = el("inputBuscarCancionControl");
  const texto = input.value.trim();
  const lista = el("listaResultadosCancion");
  const mensaje = el("mensajeBusquedaCancion");

  if (!texto) {
    mensaje.textContent = "Escribe el nombre de una canción o artista.";
    lista.innerHTML = "";
    return;
  }

  const boton = el("btnBuscarCancionControl");
  boton.disabled = true;
  mensaje.style.color = "#999";
  mensaje.textContent = "Buscando...";
  lista.innerHTML = "";

  try {
    const datos = await llamarWorker({ accion: "spotifyBuscar", pin: pinActual, texto });
    renderResultadosCancion(datos.canciones || []);
    mensaje.textContent = "";
  } catch (e) {
    mensaje.style.color = "#e0245e";
    mensaje.textContent = e.message;
  } finally {
    boton.disabled = false;
  }
}

function renderResultadosCancion(canciones) {
  const lista = el("listaResultadosCancion");
  lista.innerHTML = "";

  if (!canciones.length) {
    const vacio = document.createElement("p");
    vacio.className = "lista-vacia";
    vacio.textContent = "No se encontraron canciones con ese nombre.";
    lista.appendChild(vacio);
    return;
  }

  canciones.forEach((cancion) => {
    const tarjeta = document.createElement("button");
    tarjeta.type = "button";
    tarjeta.className = "tarjeta-resultado";
    tarjeta.innerHTML = `
      <span class="tarjeta-resultado-nombre">${escaparHtml(cancion.nombre)}</span>
      <span class="tarjeta-resultado-detalle">${escaparHtml(cancion.artista)}${cancion.album ? " · " + escaparHtml(cancion.album) : ""}</span>
    `;
    tarjeta.addEventListener("click", () => reproducirCancionElegida(cancion, tarjeta));
    lista.appendChild(tarjeta);
  });
}

async function reproducirCancionElegida(cancion, tarjeta) {
  if (!pinActual) return;
  const mensaje = el("mensajeBusquedaCancion");
  tarjeta.disabled = true;
  mensaje.style.color = "#999";
  mensaje.textContent = "Poniendo la canción...";

  try {
    await llamarWorker({ accion: "spotifyReproducirCancion", pin: pinActual, uri: cancion.uri });
    mensaje.style.color = "#1f9d63";
    mensaje.textContent = `▶️ Sonando: ${cancion.nombre}`;
    if (navigator.vibrate) navigator.vibrate(30);
    setTimeout(actualizarAhoraSuena, 800);
  } catch (e) {
    mensaje.style.color = "#e0245e";
    mensaje.textContent = e.message;
  } finally {
    tarjeta.disabled = false;
  }
}

// ---------- selector de minutos del cronómetro ----------
// Mismas opciones que en la laptop (30 segundos, y de 1 a 30 minutos),
// para que lo que se elija aquí se vea idéntico allá.

function poblarSelectorMinutosControl() {
  const select = el("selectorMinutosControl");
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

  select.value = "60"; // mismo valor por defecto que trae la laptop al abrir una clase
}

poblarSelectorMinutosControl();

el("btnFijarMinutosControl").addEventListener("click", () => {
  const select = el("selectorMinutosControl");
  const segundos = select.value;
  const texto = select.options[select.selectedIndex].textContent;
  enviarComando("cronometro:minutos:" + segundos, "⏱ Tiempo puesto en " + texto, el("btnFijarMinutosControl"));
});

// ---------- desconectar ----------

el("btnDesconectarControl").addEventListener("click", () => {
  pinActual = "";
  inputPin.value = "";
  el("mensajeErrorPin").textContent = "";
  el("mensajeComandoControl").textContent = "";
  detenerAhoraSuena();
  mostrarPantalla("pantallaPin");
});
