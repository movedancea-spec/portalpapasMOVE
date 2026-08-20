// ==========================================
// MOVE — PANTALLA EN VIVO DE ENTRADAS (recepción)
// MOVE Dance Academy
// ==========================================
// Pantalla privada de solo lectura (misma clave que el panel de
// administración y la caja, CLAVE_ENTRADAS_SHOW) pensada para
// quedar abierta en un monitor de recepción: muestra el turno en
// curso, su cronómetro, cuántas filas quedan disponibles y el mapa
// de butacas — todo actualizándose solo, sin que nadie tenga que
// tocar nada.
//
// La clave se guarda solo en memoria (no en localStorage).

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const MINUTOS_URGENTE = 2;
const SEGUNDOS_ENTRE_REFRESCOS = 7;

let clavePantalla = "";
let horaExpiraActual = null;
let relojTimer = null;
let refrescoTimer = null;

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaTablero"].forEach((p) => {
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

// ==========================================
// LOGIN
// ==========================================

async function entrarPantalla() {
  const clave = el("inputClavePantalla").value.trim();
  const msg = el("mensajeErrorLogin");
  msg.textContent = "";
  if (!clave) {
    msg.textContent = "Escribe la clave.";
    return;
  }

  const btn = el("btnEntrarPantalla");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Entrando...";
  try {
    await llamarWorker({ accion: "entradasAdminEntrar", clave });
    clavePantalla = clave;
    mostrarPantalla("pantallaTablero");
    iniciarReloj();
    await refrescarTablero();
    iniciarRefrescoAutomatico();
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ==========================================
// RELOJ (hora de Guatemala, en vivo)
// ==========================================

function iniciarReloj() {
  detenerReloj();
  actualizarReloj();
  relojTimer = setInterval(actualizarReloj, 1000);
}

function detenerReloj() {
  if (relojTimer) {
    clearInterval(relojTimer);
    relojTimer = null;
  }
}

function actualizarReloj() {
  try {
    el("textoRelojVivo").textContent = new Date().toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch (e) {
    el("textoRelojVivo").textContent = "";
  }
}

// ==========================================
// TABLERO — turno en curso, estadísticas y mapa
// ==========================================

function iniciarRefrescoAutomatico() {
  detenerRefrescoAutomatico();
  refrescoTimer = setInterval(refrescarTablero, SEGUNDOS_ENTRE_REFRESCOS * 1000);
}

function detenerRefrescoAutomatico() {
  if (refrescoTimer) {
    clearInterval(refrescoTimer);
    refrescoTimer = null;
  }
}

async function refrescarTablero() {
  try {
    const [panel, mapa] = await Promise.all([
      llamarWorker({ accion: "entradasAdminObtenerPanel", clave: clavePantalla }),
      llamarWorker({ accion: "entradasObtenerMapaFilas", clave: clavePantalla }),
    ]);
    pintarTurnoActivo(panel.turnoActivo);
    pintarStats(panel.conteoFilas || {});
    pintarMapaTeatro(mapa.filas || []);
  } catch (e) {
    // Un refresco fallido no debe tumbar la pantalla — simplemente
    // se intenta de nuevo en el siguiente ciclo automático.
    console.error("No se pudo refrescar la pantalla en vivo:", e.message);
  }
}

function pintarTurnoActivo(turnoActivo) {
  if (!turnoActivo) {
    el("textoNumeroTurnoVivo").textContent = "—";
    el("textoNombreTurnoVivo").textContent = "Sin turno activo en este momento.";
    el("textoCronometroVivo").textContent = "";
    horaExpiraActual = null;
    return;
  }
  el("textoNumeroTurnoVivo").textContent = `#${turnoActivo.numero}`;
  el("textoNombreTurnoVivo").textContent = `${turnoActivo.nombre || ""} — ${turnoActivo.whatsapp || ""}`;
  horaExpiraActual = turnoActivo.horaExpira ? new Date(turnoActivo.horaExpira) : null;
  actualizarCronometroVivo();
}

function actualizarCronometroVivo() {
  const elCron = el("textoCronometroVivo");
  if (!horaExpiraActual) {
    elCron.textContent = "";
    elCron.classList.remove("urgente");
    return;
  }
  const restanteMs = horaExpiraActual.getTime() - Date.now();
  if (restanteMs <= 0) {
    elCron.textContent = "⏱️ 0:00";
    elCron.classList.add("urgente");
    return;
  }
  const totalSeg = Math.floor(restanteMs / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  elCron.textContent = `⏱️ ${min}:${seg.toString().padStart(2, "0")}`;
  elCron.classList.toggle("urgente", totalSeg <= MINUTOS_URGENTE * 60);
}

function pintarStats(conteoFilas) {
  el("statDisponiblesVivo").textContent = conteoFilas["Disponible"] || 0;
  el("statReservadasVivo").textContent = conteoFilas["Reservada"] || 0;
  el("statVendidasVivo").textContent = conteoFilas["Vendida"] || 0;
}

// ==========================================
// MAPA DE BUTACAS — SOLO LECTURA (sin clics)
// ==========================================

function pintarMapaTeatro(filas) {
  const cont = el("mapaSecciones");
  cont.innerHTML = "";

  if (!filas.length) {
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar el mapa de butacas.</p>';
    return;
  }

  const porSeccion = {};
  filas.forEach((f) => {
    const s = f.seccion || "Otra";
    (porSeccion[s] = porSeccion[s] || []).push(f);
  });

  const bloqueIzquierda = crearBloqueSeccion("IZQUIERDA", porSeccion["Izquierda"]);

  const columnaCentro = document.createElement("div");
  columnaCentro.className = "mapa-columna-centro";
  const tituloCentro = document.createElement("p");
  tituloCentro.className = "mapa-bloque-titulo";
  tituloCentro.textContent = "CENTRO";
  const filaCentro = document.createElement("div");
  filaCentro.className = "mapa-grupo-centro";
  filaCentro.appendChild(crearBloqueSeccion("", porSeccion["Centro-Izquierda"]));
  const pasillo = document.createElement("div");
  pasillo.className = "pasillo-central";
  filaCentro.appendChild(pasillo);
  filaCentro.appendChild(crearBloqueSeccion("", porSeccion["Centro-Derecha"]));
  columnaCentro.appendChild(tituloCentro);
  columnaCentro.appendChild(filaCentro);

  const bloqueDerecha = crearBloqueSeccion("DERECHA", porSeccion["Derecha"]);

  cont.appendChild(bloqueIzquierda);
  cont.appendChild(columnaCentro);
  cont.appendChild(bloqueDerecha);
}

function crearBloqueSeccion(titulo, filas) {
  const bloque = document.createElement("div");
  bloque.className = "mapa-bloque";

  if (titulo) {
    const t = document.createElement("p");
    t.className = "mapa-bloque-titulo";
    t.textContent = titulo;
    bloque.appendChild(t);
  }

  (filas || [])
    .sort((a, b) => (a.letra || a.fila || "").localeCompare(b.letra || b.fila || ""))
    .forEach((f) => bloque.appendChild(crearFilaMapa(f)));

  return bloque;
}

function crearFilaMapa(f) {
  const div = document.createElement("div");
  div.className = "fila-mapa";
  if (f.estado !== "Disponible") {
    div.classList.add(f.estado === "Vendida" ? "vendida" : "reservada");
  }

  const etiqueta = document.createElement("span");
  etiqueta.className = "fila-mapa-etiqueta";
  etiqueta.textContent = f.letra || f.fila || "";

  const asientos = document.createElement("span");
  asientos.className = "fila-mapa-asientos";
  const cantidad = Math.max(1, Number(f.cantidad) || 1);
  for (let i = 0; i < cantidad; i++) {
    const punto = document.createElement("span");
    punto.className = "asiento";
    asientos.appendChild(punto);
  }

  div.title = `Fila ${f.letra || f.fila} — ${f.cantidad} butacas${
    f.estado !== "Disponible" ? " (" + f.estado.toLowerCase() + ")" : ""
  }`;

  div.appendChild(etiqueta);
  div.appendChild(asientos);
  return div;
}

// El cronómetro del turno en curso se recalcula cada segundo junto
// con el reloj, aunque los datos del turno solo se refresquen cada
// SEGUNDOS_ENTRE_REFRESCOS segundos.
setInterval(actualizarCronometroVivo, 1000);

// ==========================================
// EVENTOS
// ==========================================

el("btnEntrarPantalla").addEventListener("click", entrarPantalla);
el("inputClavePantalla").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrarPantalla();
});
