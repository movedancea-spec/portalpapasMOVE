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
let alumnasMaestra = [];
let alumnaSeleccionadaMaestra = null;
let listaPollingInterval = null;
let chatPollingInterval = null;

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

// ---------- lista de alumnas ----------

async function cargarListaAlumnasMaestra() {
  try {
    const datos = await llamarWorkerMaestra({ accion: "maestraListaAlumnas" });
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
