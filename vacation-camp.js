// =====================================================================
// MOVE — Ficha de inscripción Move Vacation Camp (formulario público)
// =====================================================================
// Página que llenan los papás sin entrar al Portal. Manda todo al
// Worker (acción "inscribirVacationCamp"), que vuelve a revisar los
// datos, calcula los montos y guarda la fila en la tabla
// "VACATION CAMP 2026" de Airtable. Aquí nunca hay claves de Airtable.

// ---------------------------------------------------------------
// TEXTO DE LAS POLÍTICAS — se edita aquí.
// Reglas para que se vea bien: la primera línea es el título; una
// línea que empieza con número ("1. ...") es una política; cualquier
// otra línea es el nombre de un grupo (p. ej. "Pagos"). Las líneas
// vacías se ignoran.
// ---------------------------------------------------------------
const POLITICAS_VACATION_CAMP = `
POLÍTICAS DEL MOVE VACATION CAMP

Fechas y horario
1. El campamento se realiza del 2 de noviembre al 4 de diciembre, de 9:00 a.m. a 12:00 p.m.
2. El 18, el 23 y el 25 de noviembre NO habrá campamento por el recital de la academia.
3. Las alumnas se reciben de 8:45 a 9:00 a.m. para empezar las actividades puntualmente. Les pedimos recogerlas puntualmente a las 12:00 p.m.
4. Las alumnas solo se entregan a la persona responsable o a quien ella autorice.
5. No se reponen clases ni días perdidos.

Pagos
6. Para reservar el lugar se debe pagar el 50% del total. El 50% restante se paga el primer día del campamento.
7. Una vez realizado el pago, no se devuelve el dinero en caso de cancelación, ni el anticipo ni el pago completo.
8. El cupo es limitado a 20 participantes.

Qué deben traer
9. Cada participante debe traer su propia lonchera.
10. Cada participante debe traer una gabacha para pintar, una gabacha para cocinar y lo que la academia indique para actividades específicas.
11. El precio incluye los materiales y todas las actividades. Todo lo que las niñas creen se lo llevan a casa.

Responsabilidades
12. Si una participante daña algo de las instalaciones o del equipo de la academia, la persona responsable deberá cubrir el costo de la reparación o reposición.
13. La persona responsable confirma que la información médica proporcionada es verdadera y completa, y se compromete a avisar a la academia de cualquier cambio.
`;

// Precios solo para MOSTRAR la reserva y el saldo en pantalla. El
// monto que se guarda lo calcula el Worker (si cambias un precio,
// cámbialo también allá, en VACATION_CAMP_MODALIDADES).
const PRECIOS = { completo: 2250, dosSemanas: 1350 };

// Semanas de la modalidad "2 semanas". El número es lo que se manda
// al Worker; el texto debe coincidir con VACATION_CAMP_SEMANAS allá.
const SEMANAS = [
  { numero: 1, texto: "Semana 1: 2–6 nov" },
  { numero: 2, texto: "Semana 2: 9–13 nov" },
  { numero: 3, texto: "Semana 3: 16–20 nov", nota: "El miércoles 18 no hay campamento por el recital." },
  { numero: 4, texto: "Semana 4: 23–27 nov", nota: "El lunes 23 y el miércoles 25 no hay campamento por el recital." },
  { numero: 5, texto: "Semana 5: 30 nov–4 dic" },
];

// La edad se calcula al primer día del campamento.
const INICIO_CAMPAMENTO = { anio: 2026, mes: 11, dia: 2 };
const EDAD_MINIMA = 6;
const EDAD_MAXIMA = 12;

// Solo al probar en la computadora (localhost) se puede apuntar a un
// Worker local con ?worker=http://localhost:8787. En el sitio
// publicado siempre se usa el Worker real.
const WORKER_URL =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1") &&
  new URLSearchParams(location.search).get("worker")
    ? new URLSearchParams(location.search).get("worker")
    : "https://portalalumnas.movedancea.workers.dev";

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

const formatoQ = (n) => "Q" + n.toLocaleString("en-US");

// ---------------------------------------------------------------
// POLÍTICAS: se arman desde el texto de arriba con textContent (no
// innerHTML), así cualquier carácter del texto se muestra tal cual.
// ---------------------------------------------------------------
function pintarPoliticas() {
  const contenedor = el("textoPoliticas");
  const lineas = POLITICAS_VACATION_CAMP.split("\n").map((l) => l.trim()).filter(Boolean);
  let lista = null;

  lineas.forEach((linea, i) => {
    if (i === 0) {
      const h2 = document.createElement("h2");
      h2.id = "tituloPoliticas";
      h2.textContent = linea;
      contenedor.appendChild(h2);
      return;
    }
    const numerada = linea.match(/^(\d+)\.\s*(.*)$/);
    if (numerada) {
      if (!lista) {
        lista = document.createElement("ol");
        lista.start = Number(numerada[1]);
        contenedor.appendChild(lista);
      }
      const li = document.createElement("li");
      li.textContent = numerada[2];
      lista.appendChild(li);
    } else {
      const h3 = document.createElement("h3");
      h3.textContent = linea;
      contenedor.appendChild(h3);
      lista = null;
    }
  });
}

// ---------------------------------------------------------------
// EDAD: solo avisa, nunca bloquea el envío.
// ---------------------------------------------------------------
function edadAlInicio(fechaIso) {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  const c = INICIO_CAMPAMENTO;
  let edad = c.anio - anio;
  if (c.mes < mes || (c.mes === mes && c.dia < dia)) edad--;
  return edad;
}

function actualizarPistaEdad() {
  const pista = el("pistaEdad");
  const fecha = el("inputNacimiento").value;
  if (!fecha) {
    pista.textContent = "";
    return;
  }
  const edad = edadAlInicio(fecha);
  if (edad < EDAD_MINIMA || edad > EDAD_MAXIMA) {
    pista.textContent = `Ojo: al empezar el campamento tendrá ${edad} años, y el campamento es para niñas de ${EDAD_MINIMA} a ${EDAD_MAXIMA}. Puedes enviar la ficha igual; te contactaremos.`;
    pista.className = "pista-campo mensaje-form-error";
  } else {
    pista.textContent = `Al empezar el campamento tendrá ${edad} años. 🎉`;
    pista.className = "pista-campo mensaje-form-ok";
  }
}

// ---------------------------------------------------------------
// ALERGIA, MODALIDAD Y SEMANAS
// ---------------------------------------------------------------
const valorRadio = (nombre) => {
  const marcado = document.querySelector(`input[name="${nombre}"]:checked`);
  return marcado ? marcado.value : "";
};

function pintarSemanas() {
  const lista = el("listaSemanas");
  SEMANAS.forEach((s) => {
    const label = document.createElement("label");
    label.className = "opcion opcion-semana";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "semana";
    input.value = String(s.numero);
    const span = document.createElement("span");
    span.textContent = s.texto;
    label.append(input, " ", span);
    if (s.nota) {
      const nota = document.createElement("span");
      nota.className = "nota-semana";
      nota.textContent = "⚠️ " + s.nota;
      label.appendChild(nota);
    }
    lista.appendChild(label);
  });
}

const semanasMarcadas = () =>
  [...document.querySelectorAll('input[name="semana"]:checked')].map((i) => Number(i.value));

// Con 2 semanas marcadas se apagan las demás, para que nunca se
// puedan elegir más de 2.
function actualizarSemanas() {
  const marcadas = semanasMarcadas();
  document.querySelectorAll('input[name="semana"]').forEach((i) => {
    i.disabled = !i.checked && marcadas.length >= 2;
  });
  const pista = el("pistaSemanas");
  pista.textContent = marcadas.length === 2 ? "¡Listo! Elegiste 2 semanas. 🎉" : `Elegiste ${marcadas.length} de 2.`;
  pista.className = marcadas.length === 2 ? "pista-campo mensaje-form-ok" : "pista-campo";
}

function actualizarModalidad() {
  const modalidad = valorRadio("modalidad");
  el("campoSemanas").hidden = modalidad !== "dosSemanas";
  if (modalidad === "dosSemanas") actualizarSemanas();

  const total = PRECIOS[modalidad];
  el("resumenPago").hidden = !total;
  if (total) {
    el("montoReserva").textContent = formatoQ(total / 2);
    el("montoSaldo").textContent = formatoQ(total - total / 2);
  }
}

// ---------------------------------------------------------------
// ENVIAR
// ---------------------------------------------------------------
const soloDigitos = (t) => t.replace(/\D/g, "");

function errorDelFormulario(d) {
  const faltan = [];
  if (!d.alumna) faltan.push("nombre de la alumna");
  if (!d.fechaNacimiento) faltan.push("fecha de nacimiento");
  if (!d.responsable) faltan.push("nombre de la persona responsable");
  if (!d.parentescoResponsable) faltan.push("parentesco de la persona responsable");
  if (!d.telefonoResponsable) faltan.push("teléfono de la persona responsable");
  if (!d.contactoEmergencia) faltan.push("nombre del contacto de emergencia");
  if (!d.parentescoEmergencia) faltan.push("parentesco del contacto de emergencia");
  if (!d.telefonoEmergencia) faltan.push("teléfono de emergencia");
  if (!d.tieneAlergia) faltan.push("si tiene alguna alergia");
  if (d.tieneAlergia === "SI" && !d.descripcionAlergia) faltan.push("descripción de la alergia");
  if (!d.modalidad) faltan.push("modalidad de inscripción");
  if (!d.nombreAcepta) faltan.push("nombre de quien acepta");
  if (faltan.length) return "Falta: " + faltan.join(", ") + ".";

  const telR = soloDigitos(d.telefonoResponsable);
  const telE = soloDigitos(d.telefonoEmergencia);
  if (telR.length < 8) return "El teléfono de la persona responsable debe tener 8 dígitos.";
  if (telE.length < 8) return "El teléfono de emergencia debe tener 8 dígitos.";
  if (telR.slice(-8) === telE.slice(-8)) {
    return "El teléfono de emergencia debe ser distinto al de la persona responsable.";
  }
  if (d.modalidad === "dosSemanas" && d.semanas.length !== 2) return "Elige exactamente 2 semanas.";
  if (!d.aceptoPoliticas) return "Para enviar, marca que leíste y aceptas las políticas del curso de vacaciones.";
  return "";
}

el("pantallaFormulario").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const mensajeEl = el("mensajeFormulario");
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-form";

  const modalidad = valorRadio("modalidad");
  const datos = {
    accion: "inscribirVacationCamp",
    alumna: el("inputAlumna").value.trim(),
    fechaNacimiento: el("inputNacimiento").value,
    responsable: el("inputResponsable").value.trim(),
    parentescoResponsable: el("inputParentescoResponsable").value.trim(),
    telefonoResponsable: el("inputTelefonoResponsable").value.trim(),
    contactoEmergencia: el("inputEmergencia").value.trim(),
    parentescoEmergencia: el("inputParentescoEmergencia").value.trim(),
    telefonoEmergencia: el("inputTelefonoEmergencia").value.trim(),
    tieneAlergia: valorRadio("alergia"),
    descripcionAlergia: el("inputDescripcionAlergia").value.trim(),
    condicionesMedicas: el("inputCondiciones").value.trim(),
    medicamentos: el("inputMedicamentos").value.trim(),
    restriccionesAlimentarias: el("inputRestricciones").value.trim(),
    otraInformacion: el("inputOtraInfo").value.trim(),
    modalidad,
    semanas: modalidad === "dosSemanas" ? semanasMarcadas() : [],
    aceptoPoliticas: el("chkAcepto").checked,
    nombreAcepta: el("inputNombreAcepta").value.trim(),
  };

  const error = errorDelFormulario(datos);
  if (error) {
    mensajeEl.textContent = error;
    mensajeEl.classList.add("mensaje-form-error");
    return;
  }

  const boton = el("btnEnviar");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Enviando...";

  try {
    await llamarWorker(datos);
    el("pantallaFormulario").hidden = true;
    el("pantallaListo").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
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
pintarPoliticas();
pintarSemanas();

el("inputNacimiento").addEventListener("change", actualizarPistaEdad);
document.querySelectorAll('input[name="alergia"]').forEach((i) =>
  i.addEventListener("change", () => {
    el("campoDescripcionAlergia").hidden = valorRadio("alergia") !== "SI";
  })
);
document.querySelectorAll('input[name="modalidad"]').forEach((i) => i.addEventListener("change", actualizarModalidad));
el("listaSemanas").addEventListener("change", actualizarSemanas);

// No se puede elegir una fecha de nacimiento en el futuro.
(() => {
  const hoy = new Date();
  el("inputNacimiento").max = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
})();
