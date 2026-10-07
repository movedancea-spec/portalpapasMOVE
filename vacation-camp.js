// =====================================================================
// MOVE — Ficha de inscripción del curso de vacaciones (formulario público)
// =====================================================================
// Página que llenan los papás sin entrar al Portal. Ya no tiene nada
// fijo del año: al abrir le pide al Worker ("vacationCampConfig") la
// temporada activa de la tabla CONFIG VACATION CAMP — nombre, fechas,
// horario, edades, precios, semanas, días sin curso, políticas y
// mensaje — y con eso arma la ficha. Para cambiar algo de un año a otro
// se edita en Recepción → Curso de vacaciones, no aquí.
//
// Al enviar ("inscribirVacationCamp") el Worker vuelve a revisar todo y
// calcula los montos con la configuración; lo que se muestra aquí es
// solo para que la familia lo vea. Aquí nunca hay claves de Airtable.

// En localhost (prueba con `wrangler dev`) se habla con el Worker local,
// igual que en recepcion.js; en el sitio publicado, con el real.
const WORKER_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : "https://portalalumnas.movedancea.workers.dev";

const TELEFONO_ACADEMIA = "3752-9984";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Temporada que mandó el Worker (null hasta que carga).
let temporada = null;

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

// ---------------------------------------------------------------
// FORMATOS
// ---------------------------------------------------------------
const formatoQ = (n) => "Q" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

// 'AAAA-MM-DD' → "2 de noviembre" (sin pasar por Date, para que la
// zona horaria del celular no corra el día).
function fechaLarga(iso) {
  const [, mes, dia] = iso.split("-").map(Number);
  return `${dia} de ${MESES[mes - 1]}`;
}

function diaSemana(iso) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

// "09:00" → "9:00 a.m."; "12:00" → "12:00 p.m."
function horaBonita(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm || "";
  const sufijo = h < 12 ? "a.m." : "p.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

// Mismo redondeo que el Worker, para que lo que se ve sea lo que se guarda.
function montos(total) {
  const reserva = Math.round(total * temporada.porcentajeReserva * 100) / 100;
  return { reserva, saldo: Math.round((total - reserva) * 100) / 100 };
}

const porcentajeTexto = () => Math.round(temporada.porcentajeReserva * 100);

// ---------------------------------------------------------------
// POLÍTICAS: vienen como texto de la configuración. La primera línea
// es el título; una línea que empieza con número ("1. ...") es una
// política; cualquier otra línea es el nombre de un grupo. Se arman con
// textContent (no innerHTML), así cualquier carácter se muestra tal cual.
// ---------------------------------------------------------------
function pintarPoliticas(texto) {
  const contenedor = el("textoPoliticas");
  contenedor.innerHTML = "";
  const lineas = String(texto || "").split("\n").map((l) => l.trim()).filter(Boolean);
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
// EDAD: se calcula al primer día del curso. Solo avisa, nunca bloquea.
// ---------------------------------------------------------------
function edadAlInicio(fechaIso) {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  const [aI, mI, dI] = temporada.inicio.split("-").map(Number);
  let edad = aI - anio;
  if (mI < mes || (mI === mes && dI < dia)) edad--;
  return edad;
}

function actualizarPistaEdad() {
  const pista = el("pistaEdad");
  const fecha = el("inputNacimiento").value;
  if (!fecha || !temporada) {
    pista.textContent = "";
    return;
  }
  const edad = edadAlInicio(fecha);
  const { edadMinima: min, edadMaxima: max } = temporada;
  if ((min !== null && edad < min) || (max !== null && edad > max)) {
    pista.textContent = `Ojo: al empezar el curso tendrá ${edad} años, y el curso es para niñas de ${min} a ${max}. Puedes enviar la ficha igual; te contactaremos.`;
    pista.className = "pista-campo mensaje-form-error";
  } else {
    pista.textContent = `Al empezar el curso tendrá ${edad} años. 🎉`;
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

// "el lunes 23 y el miércoles 25"
function listaDeDias(dias) {
  const textos = dias.map((d) => `el ${NOMBRES_DIA[diaSemana(d.fecha)]} ${Number(d.fecha.slice(8))}`);
  return textos.length > 1 ? textos.slice(0, -1).join(", ") + " y " + textos[textos.length - 1] : textos[0];
}

function notaSemana(semana) {
  if (!semana.sinCurso.length) return "";
  const motivos = [...new Set(semana.sinCurso.map((d) => d.motivo).filter(Boolean))];
  return `No hay curso ${listaDeDias(semana.sinCurso)}` + (motivos.length ? ` (${motivos.join(", ")}).` : ".");
}

function pintarSemanas() {
  const lista = el("listaSemanas");
  lista.innerHTML = "";
  temporada.semanas.forEach((s) => {
    const label = document.createElement("label");
    label.className = "opcion opcion-semana";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "semana";
    input.value = String(s.numero);
    const span = document.createElement("span");
    span.textContent = s.texto;
    label.append(input, " ", span);
    const nota = notaSemana(s);
    if (nota) {
      const spanNota = document.createElement("span");
      spanNota.className = "nota-semana";
      spanNota.textContent = "⚠️ " + nota;
      label.appendChild(spanNota);
    }
    lista.appendChild(label);
  });
}

const semanasMarcadas = () =>
  [...document.querySelectorAll('input[name="semana"]:checked')].map((i) => Number(i.value));

// Al llegar al número de semanas del paquete se apagan las demás, para
// que nunca se puedan elegir de más.
function actualizarSemanas() {
  const cuantas = temporada.semanasParcial;
  const marcadas = semanasMarcadas();
  document.querySelectorAll('input[name="semana"]').forEach((i) => {
    i.disabled = !i.checked && marcadas.length >= cuantas;
  });
  const pista = el("pistaSemanas");
  const listo = marcadas.length === cuantas;
  pista.textContent = listo
    ? `¡Listo! Elegiste ${cuantas} ${cuantas === 1 ? "semana" : "semanas"}. 🎉`
    : `Elegiste ${marcadas.length} de ${cuantas}.`;
  pista.className = listo ? "pista-campo mensaje-form-ok" : "pista-campo";
}

function totalDeModalidad(modalidad) {
  if (modalidad === "completo") return temporada.precioCompleto;
  if (modalidad === "parcial") return temporada.precioParcial;
  return 0;
}

function actualizarModalidad() {
  const modalidad = valorRadio("modalidad");
  el("campoSemanas").hidden = modalidad !== "parcial";
  if (modalidad === "parcial") actualizarSemanas();

  const total = totalDeModalidad(modalidad);
  el("resumenPago").hidden = !total;
  if (total) {
    const { reserva, saldo } = montos(total);
    el("montoReserva").textContent = formatoQ(reserva);
    el("montoSaldo").textContent = formatoQ(saldo);
    // Las opciones de forma de pago muestran el monto de la modalidad
    // elegida (el Worker lo vuelve a calcular al guardar).
    el("textoFormaReserva").textContent = `Reserva ${porcentajeTexto()}% — ${formatoQ(reserva)} (el saldo se paga el primer día)`;
    el("textoFormaTotal").textContent = `Pago total — ${formatoQ(total)}`;
  }
  document.querySelectorAll('input[name="formaPago"]').forEach((i) => {
    i.disabled = !total;
  });
  el("pistaFormaPago").hidden = !!total;
}

// ---------------------------------------------------------------
// PANTALLA FINAL: botón de Paggo o instrucciones, según el método.
// ---------------------------------------------------------------
function pintarPagoFinal(resp) {
  const caja = el("pagoFinal");
  const boton = el("btnPagar");
  const texto = el("pagoFinalTexto");
  const queSePaga = resp.formaPago === "total" ? "Pago total" : "Reserva";
  el("pagoFinalMonto").textContent = `${queSePaga}: ${formatoQ(resp.montoElegido || 0)}`;
  boton.hidden = true;
  texto.hidden = true;

  if (resp.metodoPago === "link" && resp.linkPago) {
    boton.href = resp.linkPago;
    boton.textContent = resp.formaPago === "total" ? "Pagar total →" : "Pagar reserva →";
    boton.hidden = false;
  } else if (resp.metodoPago === "link") {
    // Paggo no pudo crear el link: Recepción lo manda por WhatsApp.
    texto.textContent = `En breve te enviaremos el link de pago por WhatsApp. Cualquier duda: ${TELEFONO_ACADEMIA}.`;
    texto.hidden = false;
  } else {
    texto.textContent = resp.instrucciones || "";
    texto.hidden = !resp.instrucciones;
  }
  caja.hidden = false;
}

// ---------------------------------------------------------------
// ARMAR LA FICHA CON LA CONFIGURACIÓN
// ---------------------------------------------------------------
function mostrarSolo(id) {
  ["pantallaCargando", "pantallaCerrado", "pantallaFormulario", "pantallaListo"].forEach((p) => {
    el(p).hidden = p !== id;
  });
}

function mostrarCerrado(texto) {
  el("textoCerrado").textContent = texto;
  mostrarSolo("pantallaCerrado");
}

function pintarFicha() {
  const t = temporada;
  el("tituloFicha").textContent = `Ficha de inscripción — ${t.nombre}`;
  document.title = `MOVE — Ficha de inscripción ${t.nombre}`;

  // horaBonita ya termina en punto ("12:00 p.m."), así que no se le agrega otro.
  el("subtituloFicha").textContent =
    `Del ${fechaLarga(t.inicio)} al ${fechaLarga(t.fin)}, de ${horaBonita(t.horaInicio)} a ${horaBonita(t.horaFin)} ` +
    `Para niñas de ${t.edadMinima} a ${t.edadMaxima} años. Los campos con * son obligatorios. 🌴`;

  el("seccionActividades").hidden = !t.actividades;
  el("textoActividades").textContent = t.actividades || "";

  const semanasTexto = t.semanasParcial === 1 ? "1 semana" : `${t.semanasParcial} semanas`;
  el("textoModalidadCompleto").textContent = `Campamento completo — ${formatoQ(t.precioCompleto)}`;
  el("textoModalidadParcial").textContent = `Mínimo ${semanasTexto} — ${formatoQ(t.precioParcial)}`;
  el("etiquetaSemanas").textContent =
    t.semanasParcial === 1
      ? "¿Qué semana va a asistir? * (elige 1)"
      : `¿Qué ${t.semanasParcial} semanas va a asistir? * (elige exactamente ${t.semanasParcial})`;

  const pct = porcentajeTexto();
  el("etiquetaReserva").textContent = `Reserva (${pct}%)`;
  el("etiquetaSaldo").textContent = `Saldo (${100 - pct}%) — el primer día`;

  pintarSemanas();
  pintarPoliticas(t.politicas);
  el("textoListo").textContent = t.mensajeConfirmacion;
  mostrarSolo("pantallaFormulario");
}

async function cargarTemporada() {
  try {
    const datos = await llamarWorker({ accion: "vacationCampConfig" });
    temporada = datos.temporada;
  } catch (e) {
    el("textoCargando").textContent = `No se pudo cargar la ficha. Recarga la página o escríbenos al ${TELEFONO_ACADEMIA}.`;
    return;
  }

  if (!temporada) {
    mostrarCerrado(`Por ahora no hay inscripciones abiertas para el curso de vacaciones. Cualquier duda: ${TELEFONO_ACADEMIA}. 💗`);
  } else if (!temporada.abierta) {
    mostrarCerrado(`Las inscripciones para el ${temporada.nombre} están cerradas por ahora. Cualquier duda: ${TELEFONO_ACADEMIA}. 💗`);
  } else if (temporada.lleno) {
    mostrarCerrado(`¡Gracias por tu interés! Ya se llenó el cupo del ${temporada.nombre}. Cualquier duda: ${TELEFONO_ACADEMIA}. 💗`);
  } else {
    pintarFicha();
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
  if (!d.formaPago) faltan.push("forma de pago");
  if (!d.metodoPago) faltan.push("método de pago");
  if (!d.nombreAcepta) faltan.push("nombre de quien acepta");
  if (faltan.length) return "Falta: " + faltan.join(", ") + ".";

  const telR = soloDigitos(d.telefonoResponsable);
  const telE = soloDigitos(d.telefonoEmergencia);
  if (telR.length < 8) return "El teléfono de la persona responsable debe tener 8 dígitos.";
  if (telE.length < 8) return "El teléfono de emergencia debe tener 8 dígitos.";
  if (telR.slice(-8) === telE.slice(-8)) {
    return "El teléfono de emergencia debe ser distinto al de la persona responsable.";
  }
  if (d.modalidad === "parcial" && d.semanas.length !== temporada.semanasParcial) {
    return `Elige exactamente ${temporada.semanasParcial} ${temporada.semanasParcial === 1 ? "semana" : "semanas"}.`;
  }
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
    semanas: modalidad === "parcial" ? semanasMarcadas() : [],
    formaPago: valorRadio("formaPago"),
    metodoPago: valorRadio("metodoPago"),
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
    const resp = await llamarWorker(datos);
    if (resp.mensaje) el("textoListo").textContent = resp.mensaje;
    pintarPagoFinal(resp);
    mostrarSolo("pantallaListo");
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

cargarTemporada();
