// ==========================================
// MOVE — PANEL DE CLASE (para maestras)
// MOVE Dance Academy
// ==========================================
// Pensado para usarse en la tablet/celular de la maestra durante su
// propia clase. Habla con el mismo Worker que el resto del portal —
// nunca guarda datos sensibles aquí. Los PUNTOS de la clase son solo
// de esta sesión (no se guardan en Airtable): sirven para gamificar
// el momento, no para llevar un historial permanente.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let maestraId = "";
let nombreMaestra = "";
let gruposMaestra = [];
let grupoActual = null;
let alumnasPanel = []; // lo que devuelve panelClase: [{id, nombre, cumpleanos, presente}]
let puntos = {}; // { alumnaId: numero }

let intervaloBienvenida = null;

// ---------- cronómetro ----------
let cronIntervalo = null;
let cronSegundosTotal = 30;
let cronSegundosRestantes = 30;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaGrupos", "pantallaPanel"].forEach((p) => {
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

// ---------- login ----------

el("btnEntrarMaestra").addEventListener("click", entrarMaestra);
el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarMaestra();
});

async function entrarMaestra() {
  const clave = el("inputClaveMaestra").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  mensajeError.textContent = "";

  if (!clave) {
    mensajeError.textContent = "Escribe tu clave.";
    return;
  }

  const boton = el("btnEntrarMaestra");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Entrando...";

  try {
    const datos = await llamarWorker({ accion: "maestraEntrar", clave });
    maestraId = datos.maestraId;
    nombreMaestra = datos.nombre || "Maestra";
    await cargarGrupos();
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
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
    btn.addEventListener("click", () => abrirPanel(g));
    cont.appendChild(btn);
  });
}

// ---------- panel de clase ----------

async function abrirPanel(grupo) {
  grupoActual = grupo;
  puntos = {};
  detenerCronometro();
  cronSegundosTotal = 30;
  cronSegundosRestantes = 30;
  actualizarPantallaCronometro();

  el("nombreGrupoPanel").textContent = grupo.nombre;
  mostrarPantalla("pantallaPanel");
  cambiarTab("Bienvenida");

  await cargarPanelClase();
  iniciarAutoRefrescoBienvenida();
}

async function cargarPanelClase() {
  try {
    const datos = await llamarWorker({ accion: "panelClase", grupoId: grupoActual.id });
    alumnasPanel = datos.alumnas || [];
    alumnasPanel.forEach((a) => {
      if (!(a.id in puntos)) puntos[a.id] = 0;
    });
    renderBienvenida();
    renderPuntos();
  } catch (e) {
    el("contadorLlegadas").textContent = "No se pudo cargar: " + e.message;
  }
}

function iniciarAutoRefrescoBienvenida() {
  if (intervaloBienvenida) clearInterval(intervaloBienvenida);
  intervaloBienvenida = setInterval(() => {
    if (!el("modoBienvenida").hidden) {
      cargarPanelClase();
    }
  }, 25000);
}

// ---------- tabs ----------

el("tabBienvenida").addEventListener("click", () => cambiarTab("Bienvenida"));
el("tabClase").addEventListener("click", () => cambiarTab("Clase"));
el("tabCierre").addEventListener("click", () => cambiarTab("Cierre"));

function cambiarTab(nombre) {
  ["Bienvenida", "Clase", "Cierre"].forEach((t) => {
    el("tab" + t).classList.toggle("activo", t === nombre);
    el("modo" + t).hidden = t !== nombre;
  });
  if (nombre === "Cierre") renderCierre();
}

// ---------- modo bienvenida ----------

function estaCumpleEstaSemana(fechaIso) {
  if (!fechaIso) return false;
  const cumple = new Date(fechaIso + "T00:00:00Z");
  if (isNaN(cumple.getTime())) return false;
  const hoy = new Date();
  const mesHoy = hoy.getUTCMonth();
  const diaHoy = hoy.getUTCDate();
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), mesHoy, diaHoy + offset));
    if (d.getUTCMonth() === cumple.getUTCMonth() && d.getUTCDate() === cumple.getUTCDate()) {
      return true;
    }
  }
  return false;
}

function renderBienvenida() {
  const total = alumnasPanel.length;
  const presentes = alumnasPanel.filter((a) => a.presente).length;
  el("contadorLlegadas").textContent = total
    ? `${presentes} / ${total} ya llegaron hoy`
    : "Este grupo todavía no tiene alumnas.";

  const cont = el("listaBienvenida");
  cont.innerHTML = "";

  alumnasPanel.forEach((a) => {
    const fila = document.createElement("div");
    fila.className = "fila-bienvenida" + (a.presente ? " presente" : "");

    const icono = document.createElement("span");
    icono.className = "icono-bienvenida";
    icono.textContent = a.presente ? "✅" : "⬜";
    fila.appendChild(icono);

    const nombre = document.createElement("span");
    nombre.className = "nombre-bienvenida";
    nombre.textContent = a.nombre;
    fila.appendChild(nombre);

    if (estaCumpleEstaSemana(a.cumpleanos)) {
      const cumple = document.createElement("span");
      cumple.className = "cumple-bienvenida";
      cumple.textContent = "🎂";
      fila.appendChild(cumple);
    }

    cont.appendChild(fila);
  });
}

el("btnRefrescarBienvenida").addEventListener("click", cargarPanelClase);

// ---------- modo clase: cronómetro ----------

function formatearMMSS(segundos) {
  const m = Math.floor(segundos / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(segundos % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function actualizarPantallaCronometro() {
  el("cronometroNumero").textContent = formatearMMSS(cronSegundosRestantes);
}

document.querySelectorAll(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    detenerCronometro();
    cronSegundosTotal = Number(btn.dataset.seg) || 30;
    cronSegundosRestantes = cronSegundosTotal;
    actualizarPantallaCronometro();
  });
});

el("btnIniciarCronometro").addEventListener("click", () => {
  if (cronIntervalo) return;
  if (cronSegundosRestantes <= 0) cronSegundosRestantes = cronSegundosTotal;
  el("cronometroNumero").classList.remove("cronometro-terminado");
  cronIntervalo = setInterval(() => {
    cronSegundosRestantes -= 1;
    actualizarPantallaCronometro();
    if (cronSegundosRestantes <= 0) {
      detenerCronometro();
      el("cronometroNumero").classList.add("cronometro-terminado");
      sonarBeep();
    }
  }, 1000);
});

el("btnPausarCronometro").addEventListener("click", detenerCronometro);

el("btnReiniciarCronometro").addEventListener("click", () => {
  detenerCronometro();
  cronSegundosRestantes = cronSegundosTotal;
  el("cronometroNumero").classList.remove("cronometro-terminado");
  actualizarPantallaCronometro();
});

function detenerCronometro() {
  if (cronIntervalo) {
    clearInterval(cronIntervalo);
    cronIntervalo = null;
  }
}

function sonarBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1046 : 880;
      gain.gain.value = 0.2;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.15);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (e) {
    // Si el navegador bloquea el audio (falta interacción previa), no
    // pasa nada — el cronómetro igual llega a cero visualmente.
  }
}

// ---------- modo clase: puntos ----------

function listaOrdenadaPorPuntos() {
  return [...alumnasPanel].sort(
    (a, b) => (puntos[b.id] || 0) - (puntos[a.id] || 0) || a.nombre.localeCompare(b.nombre)
  );
}

function renderPuntos() {
  const cont = el("listaPuntos");
  cont.innerHTML = "";

  if (!alumnasPanel.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Este grupo todavía no tiene alumnas.</p>';
    return;
  }

  listaOrdenadaPorPuntos().forEach((a, index) => {
    const fila = document.createElement("div");
    fila.className = "fila-puntos";

    const posicion = document.createElement("span");
    posicion.className = "posicion-puntos";
    posicion.textContent = index === 0 && puntos[a.id] > 0 ? "🥇" : index + 1;
    fila.appendChild(posicion);

    const nombre = document.createElement("span");
    nombre.className = "nombre-puntos";
    nombre.textContent = a.nombre;
    fila.appendChild(nombre);

    const valor = document.createElement("span");
    valor.className = "valor-puntos";
    valor.textContent = puntos[a.id] || 0;
    fila.appendChild(valor);

    const botones = document.createElement("div");
    botones.className = "botones-puntos";
    [1, 3, 5].forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-punto";
      b.textContent = "+" + n;
      b.addEventListener("click", () => {
        puntos[a.id] = (puntos[a.id] || 0) + n;
        renderPuntos();
      });
      botones.appendChild(b);
    });
    fila.appendChild(botones);

    cont.appendChild(fila);
  });
}

el("btnReiniciarPuntos").addEventListener("click", () => {
  alumnasPanel.forEach((a) => {
    puntos[a.id] = 0;
  });
  renderPuntos();
});

// ---------- modo cierre ----------

function renderCierre() {
  const cont = el("listaCierre");
  cont.innerHTML = "";

  if (!alumnasPanel.length) {
    cont.innerHTML = '<p class="lista-alumnas-aviso">Este grupo todavía no tiene alumnas.</p>';
    return;
  }

  const medallas = ["👑", "🥈", "🥉"];

  listaOrdenadaPorPuntos().forEach((a, index) => {
    const fila = document.createElement("div");
    fila.className = "fila-cierre" + (index === 0 && puntos[a.id] > 0 ? " primer-lugar" : "");

    const medalla = document.createElement("span");
    medalla.className = "medalla-cierre";
    medalla.textContent = index < 3 && puntos[a.id] > 0 ? medallas[index] : "•";
    fila.appendChild(medalla);

    const nombre = document.createElement("span");
    nombre.className = "nombre-cierre";
    nombre.textContent = a.nombre;
    fila.appendChild(nombre);

    const valor = document.createElement("span");
    valor.className = "valor-cierre";
    valor.textContent = (puntos[a.id] || 0) + " pts";
    fila.appendChild(valor);

    cont.appendChild(fila);
  });
}

el("btnNuevaClase").addEventListener("click", () => {
  if (intervaloBienvenida) clearInterval(intervaloBienvenida);
  detenerCronometro();
  grupoActual = null;
  alumnasPanel = [];
  puntos = {};
  cargarGrupos();
});

// ---------- salir ----------

el("btnCerrarSesionPanel").addEventListener("click", () => {
  if (intervaloBienvenida) clearInterval(intervaloBienvenida);
  detenerCronometro();
  maestraId = "";
  nombreMaestra = "";
  gruposMaestra = [];
  grupoActual = null;
  alumnasPanel = [];
  puntos = {};
  el("inputClaveMaestra").value = "";
  mostrarPantalla("pantallaLogin");
});
