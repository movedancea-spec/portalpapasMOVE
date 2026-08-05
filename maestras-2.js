// ==========================================
// MOVE — CHAT DE MAESTRAS
// MOVE Dance Academy
// ==========================================
// Habla con el mismo Worker que el Portal de Alumnas. Cada maestra
// entra con su propia clave individual (tabla MAESTRAS, campo
// "CLAVE CHAT"); el Worker devuelve su nombre real, así que los
// mensajes siempre quedan firmados correctamente sin que ella tenga
// que escribir su nombre cada vez.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let nombreMaestra = "";
let maestraIdActual = "";
let claveMaestraActual = ""; // la clave con la que la maestra entró, se usa para confirmar el cambio de clave
let alumnasMaestra = [];
let alumnaSeleccionadaMaestra = null;
let listaPollingInterval = null;
let chatPollingInterval = null;

// ---------- recuperar clave (pantalla de login, antes de entrar) ----------
let maestrasParaRecuperar = [];
let maestraSeleccionadaRecuperar = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantallaMaestra(id) {
  const pantallas = ["pantallaLogin", "pantallaLista", "pantallaChatMaestra"];
  pantallas.forEach((p) => {
    el(p).hidden = p !== id;
  });
  if (id !== "pantallaLista") {
    detenerPollingLista();
  }
  if (id !== "pantallaChatMaestra") {
    detenerPollingChat();
  }
  mostrarErrorMaestra("");
}

function mostrarErrorMaestra(msg) {
  el("mensajeErrorMaestra").textContent = msg || "";
}

async function llamarWorkerMaestra(payload) {
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

// ---------- login ----------

async function entrarMaestra() {
  const clave = el("inputClaveMaestra").value.trim();
  if (!clave) {
    mostrarErrorMaestra("Escribe tu clave.");
    return;
  }

  const btn = el("btnEntrarMaestra");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Entrando...";
  mostrarErrorMaestra("");

  try {
    const datos = await llamarWorkerMaestra({ accion: "maestraEntrar", clave });
    nombreMaestra = datos.nombre || "Maestra";
    maestraIdActual = datos.maestraId || "";
    claveMaestraActual = clave;
    el("inputClaveMaestra").value = "";
    mostrarPantallaMaestra("pantallaLista");
    await cargarListaAlumnasMaestra();
    detenerPollingLista();
    listaPollingInterval = setInterval(cargarListaAlumnasMaestra, 20000);
  } catch (e) {
    mostrarErrorMaestra(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- recuperar clave (pantalla de login) ----------

async function mostrarBloqueRecuperarMaestra() {
  const bloque = el("bloqueRecuperarMaestra");
  const yaAbierto = !bloque.hidden;
  bloque.hidden = yaAbierto;
  mostrarErrorMaestra("");
  el("mensajeRecuperarMaestra").hidden = true;

  if (yaAbierto) return;

  el("buscarRecuperarMaestra").value = "";
  el("listaRecuperarMaestra").innerHTML = "";
  el("bloqueConfirmarRecuperarMaestra").hidden = true;
  maestraSeleccionadaRecuperar = null;

  if (maestrasParaRecuperar.length) return;

  try {
    const datos = await llamarWorkerMaestra({ accion: "maestrasActivas" });
    maestrasParaRecuperar = datos.maestras || [];
  } catch (e) {
    mostrarErrorMaestra(e.message);
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
  mostrarErrorMaestra("");

  try {
    const datos = await llamarWorkerMaestra({
      accion: "maestraRecuperarClave",
      maestraId: maestraSeleccionadaRecuperar.id,
    });
    msg.textContent =
      "✅ Te enviamos tu clave por WhatsApp al número terminado en " +
      (datos.ultimosDigitos || "****") +
      ".";
    msg.hidden = false;
  } catch (e) {
    mostrarErrorMaestra(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- cambiar clave (pantalla de lista, ya conectada) ----------

async function guardarNuevaClaveMaestra() {
  const nueva = el("inputClaveNuevaMaestra").value.trim();
  const confirmar = el("inputClaveConfirmarMaestra").value.trim();
  mostrarErrorMaestra("");
  el("mensajeClaveOkMaestra").hidden = true;

  if (!nueva || !confirmar) {
    mostrarErrorMaestra("Escribe tu nueva clave y confírmala.");
    return;
  }
  if (nueva.length < 6) {
    mostrarErrorMaestra("Tu nueva clave debe tener al menos 6 caracteres.");
    return;
  }
  if (nueva !== confirmar) {
    mostrarErrorMaestra("Las dos claves no coinciden.");
    return;
  }

  const btn = el("btnGuardarClaveMaestra");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";

  try {
    await llamarWorkerMaestra({
      accion: "maestraCambiarClave",
      maestraId: maestraIdActual,
      claveActual: claveMaestraActual,
      claveNueva: nueva,
    });
    claveMaestraActual = nueva;
    el("inputClaveNuevaMaestra").value = "";
    el("inputClaveConfirmarMaestra").value = "";
    el("mensajeClaveOkMaestra").hidden = false;
  } catch (e) {
    mostrarErrorMaestra(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- lista de alumnas ----------

async function cargarListaAlumnasMaestra() {
  try {
    const datos = await llamarWorkerMaestra({ accion: "maestraListaAlumnas", maestraId: maestraIdActual });
    alumnasMaestra = datos.alumnas || [];
    renderListaAlumnasMaestra(el("buscarAlumnaMaestra").value);
  } catch (e) {
    mostrarErrorMaestra(e.message);
  }
}

function renderListaAlumnasMaestra(filtro) {
  const cont = el("listaAlumnasMaestra");
  cont.innerHTML = "";
  const texto = (filtro || "").trim().toLowerCase();
  const filtradas = texto
    ? alumnasMaestra.filter((a) => a.nombre.toLowerCase().includes(texto))
    : alumnasMaestra;

  if (!filtradas.length) {
    const aviso = document.createElement("p");
    aviso.className = "lista-alumnas-aviso";
    aviso.textContent = texto ? "No encontramos ese nombre." : "No hay alumnas activas.";
    cont.appendChild(aviso);
    return;
  }

  filtradas.slice(0, 60).forEach((a) => {
    const btn = document.createElement("button");

    const nombre = document.createElement("span");
    nombre.textContent = a.nombre;
    btn.appendChild(nombre);

    if (a.noLeidos > 0) {
      const badge = document.createElement("span");
      badge.className = "badge-no-leidos";
      badge.textContent = a.noLeidos;
      btn.appendChild(badge);
    }

    btn.addEventListener("click", () => seleccionarAlumnaMaestra(a));
    cont.appendChild(btn);
  });
}

function detenerPollingLista() {
  if (listaPollingInterval) {
    clearInterval(listaPollingInterval);
    listaPollingInterval = null;
  }
}

// ---------- chat con una alumna ----------

function seleccionarAlumnaMaestra(a) {
  alumnaSeleccionadaMaestra = a;
  el("chatMaestraTitulo").textContent = "💬 " + a.nombre;
  el("chatInputMaestra").value = "";
  mostrarPantallaMaestra("pantallaChatMaestra");
  cargarChatMaestra(true);

  detenerPollingChat();
  chatPollingInterval = setInterval(() => cargarChatMaestra(false), 12000);
}

function formatearHoraChatMaestra(fechaIso) {
  const f = new Date(fechaIso);
  return f.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });
}

function renderChatMaestra(mensajes) {
  const cont = el("chatMensajesMaestra");
  const estabaAbajo = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40;

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
    fila.className = "chat-fila " + (m.rol === "MAESTRA" ? "chat-fila-maestra" : "chat-fila-familia");

    const burbuja = document.createElement("div");
    burbuja.className = "chat-burbuja " + (m.rol === "MAESTRA" ? "chat-burbuja-maestra" : "chat-burbuja-familia");

    const autor = document.createElement("p");
    autor.className = "chat-autor";
    autor.textContent = m.rol === "MAESTRA" ? m.autor || "Maestras" : "Familia";
    burbuja.appendChild(autor);

    const texto = document.createElement("p");
    texto.className = "chat-texto";
    texto.textContent = m.texto;
    burbuja.appendChild(texto);

    const hora = document.createElement("p");
    hora.className = "chat-hora";
    hora.textContent = formatearHoraChatMaestra(m.fecha);
    burbuja.appendChild(hora);

    fila.appendChild(burbuja);
    cont.appendChild(fila);
  });

  if (estabaAbajo) {
    cont.scrollTop = cont.scrollHeight;
  }
}

async function cargarChatMaestra(mostrarCargando) {
  if (mostrarCargando) {
    el("chatMensajesMaestra").innerHTML = '<p class="chat-vacio">Cargando mensajes...</p>';
  }
  try {
    const datos = await llamarWorkerMaestra({
      accion: "chatObtener",
      alumnaId: alumnaSeleccionadaMaestra.id,
      maestraId: maestraIdActual,
      quien: "maestra",
    });
    renderChatMaestra(datos.mensajes || []);
  } catch (e) {
    mostrarErrorMaestra(e.message);
  }
}

function detenerPollingChat() {
  if (chatPollingInterval) {
    clearInterval(chatPollingInterval);
    chatPollingInterval = null;
  }
}

async function enviarMensajeChatMaestra() {
  const input = el("chatInputMaestra");
  const texto = input.value.trim();
  if (!texto) return;

  const btn = el("btnChatEnviarMaestra");
  btn.disabled = true;
  input.value = "";

  try {
    await llamarWorkerMaestra({
      accion: "chatEnviar",
      alumnaId: alumnaSeleccionadaMaestra.id,
      maestraId: maestraIdActual,
      quien: "maestra",
      autor: nombreMaestra,
      texto,
    });
    await cargarChatMaestra(false);
  } catch (e) {
    input.value = texto;
    mostrarErrorMaestra(e.message);
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

// ---------- eventos ----------

el("btnEntrarMaestra").addEventListener("click", entrarMaestra);

el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarMaestra();
});

el("btnMostrarRecuperarMaestra").addEventListener("click", mostrarBloqueRecuperarMaestra);

el("buscarRecuperarMaestra").addEventListener("input", (e) => renderListaRecuperarMaestra(e.target.value));

el("btnEnviarRecuperarMaestra").addEventListener("click", enviarRecuperarMaestra);

el("btnGuardarClaveMaestra").addEventListener("click", guardarNuevaClaveMaestra);

el("buscarAlumnaMaestra").addEventListener("input", (e) => renderListaAlumnasMaestra(e.target.value));

el("btnAtrasChatMaestra").addEventListener("click", () => {
  alumnaSeleccionadaMaestra = null;
  mostrarPantallaMaestra("pantallaLista");
  cargarListaAlumnasMaestra();
});

el("btnChatEnviarMaestra").addEventListener("click", enviarMensajeChatMaestra);

el("chatInputMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensajeChatMaestra();
  }
});

// ---------- arranque ----------
mostrarPantallaMaestra("pantallaLogin");
