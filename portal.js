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

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  const pantallas = ["pantallaCargando", "pantallaAlumna", "pantallaClave", "pantallaPerfil"];
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
      valor.textContent = f.valor;

      fila.appendChild(etiqueta);
      fila.appendChild(valor);
      cont.appendChild(fila);
    });
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
  el("buscarAlumna").value = "";
  renderAlumnas("");
  mostrarPantalla("pantallaAlumna");
});

// ---------- arranque ----------
iniciar();
