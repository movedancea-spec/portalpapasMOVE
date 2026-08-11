// ==========================================
// MOVE — RANKING DE GRUPOS (interno, solo directora)
// MOVE Dance Academy
// ==========================================
// Muestra, mes por mes, qué grupo va acumulando más puntos según las
// calificaciones internas que las maestras van marcando al cerrar
// cada clase (🌟 Excelente / 👍 Buena / 🙂 Regular). Es una pantalla
// SOLO para la directora — las maestras no tienen acceso a esto, ni
// aparece en el portal de alumnas. Solo importa el mes en curso: no
// se guarda historial de meses anteriores.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

const NOMBRES_MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

let claveRanking = "";
let pollIntervalo = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaRanking"].forEach((p) => {
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

el("btnEntrarRanking").addEventListener("click", entrarRanking);
el("inputClaveRanking").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarRanking();
});

async function entrarRanking() {
  const clave = el("inputClaveRanking").value.trim();
  const mensajeError = el("mensajeErrorLogin");
  mensajeError.textContent = "";

  if (!clave) {
    mensajeError.textContent = "Escribe la clave.";
    return;
  }

  const boton = el("btnEntrarRanking");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Entrando...";

  try {
    await llamarWorker({ accion: "rankingEntrar", clave });
    claveRanking = clave;
    el("inputClaveRanking").value = "";
    const ahora = new Date();
    el("subtituloMes").textContent = `Calificación interna de ${NOMBRES_MESES[ahora.getMonth()]}`;
    mostrarPantalla("pantallaRanking");
    await cargarRanking();
    iniciarAutoRefresco();
  } catch (e) {
    mensajeError.textContent = e.message;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ---------- recuperar clave (una sola, compartida — se manda por WhatsApp a un número fijo) ----------

el("btnMostrarRecuperarRanking").addEventListener("click", () => {
  el("bloqueRecuperarRanking").hidden = !el("bloqueRecuperarRanking").hidden;
  el("mensajeRecuperarRanking").hidden = true;
});

el("btnEnviarRecuperarRanking").addEventListener("click", async () => {
  const boton = el("btnEnviarRecuperarRanking");
  const mensajeEl = el("mensajeRecuperarRanking");
  mensajeEl.hidden = true;

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Enviando...";

  try {
    const datos = await llamarWorker({ accion: "rankingRecuperarClave" });
    mensajeEl.textContent = `✅ Se envió la clave por WhatsApp al número terminando en ${datos.ultimosDigitos}.`;
    mensajeEl.hidden = false;
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

el("btnSalirRanking").addEventListener("click", () => {
  detenerAutoRefresco();
  claveRanking = "";
  mostrarPantalla("pantallaLogin");
});

// ---------- ranking ----------

async function cargarRanking() {
  if (!claveRanking) return;
  try {
    const datos = await llamarWorker({ accion: "obtenerRankingGrupos", clave: claveRanking });
    renderRanking(datos.ranking || []);
  } catch (e) {
    if (/clave/i.test(e.message)) {
      detenerAutoRefresco();
      claveRanking = "";
      mostrarPantalla("pantallaLogin");
      el("mensajeErrorLogin").textContent = e.message;
    }
  }
}

function renderRanking(ranking) {
  const cont = el("listaRanking");
  cont.innerHTML = "";

  if (!ranking.length) {
    cont.innerHTML = '<p class="lista-vacia">Todavía no hay calificaciones este mes.</p>';
    return;
  }

  ranking.forEach((g, i) => {
    const fila = document.createElement("div");
    fila.className = "fila-ranking" + (i === 0 ? " primer-lugar" : "");

    const puesto = document.createElement("div");
    puesto.className = "fila-ranking-puesto";
    puesto.textContent = i === 0 ? "🏆" : String(i + 1);
    fila.appendChild(puesto);

    const info = document.createElement("div");
    info.className = "fila-ranking-info";

    const nombre = document.createElement("div");
    nombre.className = "fila-ranking-grupo";
    nombre.textContent = g.grupo;
    info.appendChild(nombre);

    const detalle = document.createElement("div");
    detalle.className = "fila-ranking-detalle";
    detalle.textContent = g.clases + (g.clases === 1 ? " clase calificada" : " clases calificadas");
    info.appendChild(detalle);

    fila.appendChild(info);

    const puntos = document.createElement("div");
    puntos.className = "fila-ranking-puntos";
    puntos.textContent = g.puntos + " pts";
    fila.appendChild(puntos);

    cont.appendChild(fila);
  });
}

el("btnActualizarRanking").addEventListener("click", cargarRanking);

function iniciarAutoRefresco() {
  if (pollIntervalo) clearInterval(pollIntervalo);
  pollIntervalo = setInterval(cargarRanking, 20000);
}

function detenerAutoRefresco() {
  if (pollIntervalo) {
    clearInterval(pollIntervalo);
    pollIntervalo = null;
  }
}
