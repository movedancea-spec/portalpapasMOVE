// =====================================================================
// MOVE — Reserva tu Clase de Prueba (formulario público)
// =====================================================================
// Esta página es la que ve directamente una familia interesada (desde
// el catálogo de precios). Es DISTINTA del link que usa Recepción para
// agendar por teléfono: aquí el mensaje de WhatsApp que recibe la
// familia avisa que la academia se va a comunicar para CONFIRMAR la
// fecha (no dice que ya quedó confirmada), porque nadie de Recepción
// ha revisado todavía si ese día hay cupo — eso lo hace el Worker según
// el campo "origen" que manda esta página (no se manda "recepcion").
const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

const el = (id) => document.getElementById(id);

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

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

let clasesDisponibles = []; // [{grupo, estilo, horarios:[{texto, dias}]}]

// ---------------------------------------------------------------
// CARGAR CLASES Y HORARIOS REALES
// ---------------------------------------------------------------
async function cargarClases() {
  const selectClase = el("selectClase");
  try {
    const datos = await llamarWorker({ accion: "horariosDisponibles" });
    clasesDisponibles = datos.clases || [];

    selectClase.innerHTML = "";
    const opcionVacia = document.createElement("option");
    opcionVacia.value = "";
    opcionVacia.textContent = "— Elige una clase —";
    selectClase.appendChild(opcionVacia);

    clasesDisponibles.forEach((c, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = c.estilo ? `${c.grupo} (${c.estilo})` : c.grupo;
      selectClase.appendChild(o);
    });

    if (!clasesDisponibles.length) {
      selectClase.innerHTML = '<option value="">No hay clases disponibles ahora</option>';
    }
  } catch (e) {
    selectClase.innerHTML = '<option value="">No se pudo cargar — recarga la página</option>';
  }
}

el("selectClase").addEventListener("change", () => {
  const selectHorario = el("selectHorario");
  const i = el("selectClase").value;
  selectHorario.innerHTML = "";

  if (i === "") {
    selectHorario.innerHTML = '<option value="">Elige primero una clase</option>';
    selectHorario.disabled = true;
    actualizarPistaFecha();
    return;
  }

  const clase = clasesDisponibles[Number(i)];
  const opcionVacia = document.createElement("option");
  opcionVacia.value = "";
  opcionVacia.textContent = "— Elige un horario —";
  selectHorario.appendChild(opcionVacia);

  (clase.horarios || []).forEach((h, j) => {
    const o = document.createElement("option");
    o.value = String(j);
    o.textContent = h.texto;
    selectHorario.appendChild(o);
  });

  selectHorario.disabled = false;
  actualizarPistaFecha();
});

el("selectHorario").addEventListener("change", actualizarPistaFecha);
el("inputFecha").addEventListener("change", actualizarPistaFecha);

function horarioElegido() {
  const i = el("selectClase").value;
  const j = el("selectHorario").value;
  if (i === "" || j === "") return null;
  const clase = clasesDisponibles[Number(i)];
  if (!clase) return null;
  return (clase.horarios || [])[Number(j)] || null;
}

// Avisa si la fecha elegida no cae en un día en que se da ese horario
// (los días reales vienen del Worker, leídos en vivo de Airtable) —
// así no se agenda una prueba un día en que la clase ni siquiera hay.
function actualizarPistaFecha() {
  const pista = el("pistaFecha");
  const horario = horarioElegido();
  const fecha = el("inputFecha").value;

  if (!horario || !horario.dias || !horario.dias.length) {
    pista.textContent = "";
    return;
  }

  const nombresDias = horario.dias.map((d) => NOMBRES_DIA[d]).join(", ");

  if (!fecha) {
    pista.textContent = `Esta clase es los: ${nombresDias}.`;
    pista.className = "pista-campo";
    return;
  }

  const [anio, mes, dia] = fecha.split("-").map(Number);
  const diaSemana = new Date(anio, mes - 1, dia).getDay();

  if (!horario.dias.includes(diaSemana)) {
    pista.textContent = `Ojo: esta clase es los ${nombresDias}, y elegiste un(a) ${NOMBRES_DIA[diaSemana]}. Puedes reservar igual y te confirmamos la fecha correcta.`;
    pista.className = "pista-campo mensaje-form-error";
  } else {
    pista.textContent = `Esta clase es los: ${nombresDias}. ¡Buena elección! 🎉`;
    pista.className = "pista-campo mensaje-form-ok";
  }
}

// ---------------------------------------------------------------
// ENVIAR RESERVA
// ---------------------------------------------------------------
el("btnReservar").addEventListener("click", async () => {
  const mensajeEl = el("mensajeFormulario");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  const nombre = el("inputNombre").value.trim();
  const edad = el("inputEdad").value.trim();
  const whatsapp = el("inputWhatsapp").value.trim();
  const fecha = el("inputFecha").value;
  const horario = horarioElegido();

  if (!nombre || !edad || !whatsapp || !fecha || !horario) {
    mensajeEl.textContent = "Completa todos los campos antes de reservar.";
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }

  const clase = clasesDisponibles[Number(el("selectClase").value)];

  const boton = el("btnReservar");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Reservando...";

  try {
    // No se manda "origen" — el Worker lo trata como "web" por defecto,
    // así el WhatsApp que recibe la familia avisa que vamos a confirmar
    // (no dice "confirmada"), a diferencia del que usa Recepción.
    await llamarWorker({
      accion: "agendarPrueba",
      alumna: nombre,
      edad,
      telefono: whatsapp,
      fecha,
      clase: clase.grupo,
      hora: horario.texto,
    });

    el("listoNombre").textContent = nombre.split(" ")[0] || nombre;
    el("pantallaFormulario").hidden = true;
    el("pantallaListo").hidden = false;
  } catch (e) {
    mensajeEl.textContent = e.message;
    mensajeEl.classList.add("mensaje-form-error");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

// ---------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------
// No se puede elegir una fecha en el pasado.
(() => {
  const hoy = new Date();
  const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
  el("inputFecha").min = iso;
})();

cargarClases();
