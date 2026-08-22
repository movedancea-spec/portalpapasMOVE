// =====================================================================
// BIOMÉTRICO — Panel del Dueño (Ana)
// =====================================================================
// IMPORTANTE: cambia esta URL por la de TU Worker una vez que lo hayas
// publicado en Cloudflare (Settings → Domains and Routes, o la URL
// "*.workers.dev" que te da por defecto). Debe terminar SIN "/" al final.
const API_URL = "https://biometrico-saas.movedancea.workers.dev";

const el = (id) => document.getElementById(id);

let claveDueno = localStorage.getItem("biometrico_clave_dueno") || "";
let academiaEditandoId = null;

async function llamar(accion, datos) {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion, ...datos }),
  });
  return await resp.json();
}

// ---------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------
function mostrarPanel() {
  el("pantallaLogin").hidden = true;
  el("pantallaPanel").hidden = false;
  cargarAcademias();
}

async function intentarEntrar() {
  const clave = el("inputClaveDueno").value.trim();
  if (!clave) return;
  el("mensajeErrorLogin").textContent = "";
  el("btnEntrarDueno").disabled = true;
  el("btnEntrarDueno").textContent = "Entrando...";

  try {
    const r = await llamar("duenoListarAcademias", { claveDueno: clave });
    if (!r.success) {
      el("mensajeErrorLogin").textContent = r.error || "Clave incorrecta.";
      return;
    }
    claveDueno = clave;
    localStorage.setItem("biometrico_clave_dueno", clave);
    pintarAcademias(r.academias);
    mostrarPanel();
  } catch (e) {
    el("mensajeErrorLogin").textContent = "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";
  } finally {
    el("btnEntrarDueno").disabled = false;
    el("btnEntrarDueno").textContent = "Entrar →";
  }
}

el("btnEntrarDueno").addEventListener("click", intentarEntrar);
el("inputClaveDueno").addEventListener("keydown", (e) => { if (e.key === "Enter") intentarEntrar(); });

el("btnSalirDueno").addEventListener("click", () => {
  claveDueno = "";
  localStorage.removeItem("biometrico_clave_dueno");
  el("pantallaPanel").hidden = true;
  el("pantallaLogin").hidden = false;
  el("inputClaveDueno").value = "";
});

// ---------------------------------------------------------------
// LISTAR / PINTAR ACADEMIAS
// ---------------------------------------------------------------
async function cargarAcademias() {
  try {
    const r = await llamar("duenoListarAcademias", { claveDueno });
    if (!r.success) {
      // La clave guardada ya no sirve — regresa al login.
      el("pantallaPanel").hidden = true;
      el("pantallaLogin").hidden = false;
      el("mensajeErrorLogin").textContent = r.error || "Tu sesión ya no es válida, vuelve a entrar.";
      return;
    }
    pintarAcademias(r.academias);
  } catch (e) {
    el("listaAcademias").innerHTML = '<p class="lista-vacia">No se pudo cargar la lista. Revisa tu conexión.</p>';
  }
}

function pintarAcademias(academias) {
  el("statCantidadAcademias").textContent = academias.length;
  el("statAcademiasActivas").textContent = academias.filter((a) => a.activo).length;
  el("statTotalAlumnas").textContent = academias.reduce((s, a) => s + (a.cantidadAlumnas || 0), 0);

  const cont = el("listaAcademias");
  if (!academias.length) {
    cont.innerHTML = '<p class="lista-vacia">Todavía no has creado ninguna academia.</p>';
    return;
  }

  cont.innerHTML = "";
  academias.forEach((a) => {
    const div = document.createElement("div");
    div.className = "tarjeta-item";
    div.innerHTML = `
      <div class="info-principal">
        <div class="nombre-item">${escaparHtml(a.nombre)}</div>
        <div class="detalle-item">
          <span class="etiqueta-estado ${a.activo ? "activa" : "inactiva"}">${a.activo ? "Activa" : "Desactivada"}</span>
          &nbsp;·&nbsp; ${a.cantidadAlumnas} / ${a.limite_alumnas} alumnos
          &nbsp;·&nbsp; Q${Number(a.mensualidad || 0).toFixed(2)}/mes
          &nbsp;·&nbsp; <span class="etiqueta-estado ${a.pago_al_dia ? "activa" : "inactiva"}">${a.pago_al_dia ? "Al día" : "Debe mensualidad"}</span>
        </div>
      </div>
      <div class="acciones-item">
        <button class="btn secundario chico" data-accion="editar">Editar</button>
        <button class="btn ${a.activo ? "peligro" : ""} chico" data-accion="toggle">${a.activo ? "Desactivar" : "Activar"}</button>
      </div>
    `;
    div.querySelector('[data-accion="editar"]').addEventListener("click", () => abrirModalEditarAcademia(a));
    div.querySelector('[data-accion="toggle"]').addEventListener("click", () => alternarActivo(a));
    cont.appendChild(div);
  });
}

function escaparHtml(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

// ---------------------------------------------------------------
// ACTIVAR / DESACTIVAR
// ---------------------------------------------------------------
async function alternarActivo(academia) {
  const nuevoEstado = !academia.activo;
  const confirmacion = nuevoEstado
    ? `¿Activar el acceso de "${academia.nombre}"?`
    : `¿Desactivar el acceso de "${academia.nombre}"? No podrán usar el sistema hasta que lo vuelvas a activar.`;
  if (!window.confirm(confirmacion)) return;

  try {
    const r = await llamar("duenoActualizarAcademia", { claveDueno, academiaId: academia.id, activo: nuevoEstado });
    if (!r.success) { alert(r.error || "No se pudo actualizar."); return; }
    cargarAcademias();
  } catch (e) {
    alert("No se pudo conectar. Inténtalo de nuevo.");
  }
}

// ---------------------------------------------------------------
// EDITAR / BORRAR ACADEMIA (modal)
// ---------------------------------------------------------------
let academiaEditandoNombre = "";

function abrirModalEditarAcademia(academia) {
  academiaEditandoId = academia.id;
  academiaEditandoNombre = academia.nombre;
  el("inputEditarNombreAcademia").value = academia.nombre;
  el("inputEditarClaveAcademia").value = "";
  el("inputEditarLimite").value = academia.limite_alumnas;
  el("inputEditarEmailAcademia").value = academia.email || "";
  el("inputEditarMensualidad").value = academia.mensualidad || 0;
  el("textoEstadoPagoAcademia").textContent = academia.pago_al_dia
    ? "Este mes está al día."
    : "Debe la mensualidad de este mes (o de un mes anterior).";
  el("mensajeErrorEditarAcademia").textContent = "";
  el("modalEditarAcademia").hidden = false;
  cargarHistorialPagos(academia.id);
}

// ---------------------------------------------------------------
// HISTORIAL DE PAGOS (todos los meses de una academia) — incluye los
// links de pago que generó y los comprobantes que haya subido.
// ---------------------------------------------------------------
async function cargarHistorialPagos(academiaId) {
  const cont = el("listaHistorialPagos");
  cont.innerHTML = '<p class="lista-vacia">Cargando historial...</p>';
  try {
    const r = await llamar("duenoListarPagosAcademia", { claveDueno, academiaId });
    // Si mientras cargaba se cerró el modal o se abrió otra academia,
    // no pintar un historial que ya no corresponde a lo que se ve.
    if (academiaId !== academiaEditandoId) return;
    if (!r.success) {
      cont.innerHTML = `<p class="lista-vacia">${escaparHtml(r.error || "No se pudo cargar el historial.")}</p>`;
      return;
    }
    pintarHistorialPagos(r.pagos);
  } catch (e) {
    if (academiaId !== academiaEditandoId) return;
    cont.innerHTML = '<p class="lista-vacia">No se pudo cargar el historial. Revisa tu conexión.</p>';
  }
}

function pintarHistorialPagos(pagos) {
  const cont = el("listaHistorialPagos");
  if (!pagos || !pagos.length) {
    cont.innerHTML = '<p class="lista-vacia">Todavía no hay ningún cobro generado para esta academia.</p>';
    return;
  }

  cont.innerHTML = "";
  pagos.forEach((p) => {
    const div = document.createElement("div");
    div.className = "tarjeta-item";
    const partes = [];
    if (p.paggo_link) {
      partes.push(`<a href="${escaparHtml(p.paggo_link)}" target="_blank" rel="noopener">Ver link de pago →</a>`);
    }
    if (p.comprobante_key) {
      partes.push(`<a href="${API_URL}/foto?key=${encodeURIComponent(p.comprobante_key)}" target="_blank" rel="noopener">📎 Ver comprobante →</a>`);
    }
    div.innerHTML = `
      <div class="info-principal">
        <div class="nombre-item">${escaparHtml(p.mes)} — Q${Number(p.monto || 0).toFixed(2)}</div>
        <div class="detalle-item">
          <span class="etiqueta-estado ${p.estado === "pagado" ? "activa" : "inactiva"}">${p.estado === "pagado" ? "Pagado" : "Pendiente"}</span>
          ${p.pagado_en ? `&nbsp;·&nbsp; pagado el ${escaparHtml(p.pagado_en)} UTC` : ""}
          ${partes.length ? `<br/>${partes.join("&nbsp;·&nbsp;")}` : ""}
        </div>
      </div>
    `;
    cont.appendChild(div);
  });
}

el("btnMarcarPagadoManual").addEventListener("click", async () => {
  if (!window.confirm(`¿Marcar a "${academiaEditandoNombre}" como al día, aunque no haya llegado el pago por Paggo (por ejemplo, si te pagó en efectivo o transferencia)?`)) return;

  try {
    const r = await llamar("duenoActualizarAcademia", { claveDueno, academiaId: academiaEditandoId, pagoAlDia: true });
    if (!r.success) { alert(r.error || "No se pudo actualizar."); return; }
    el("textoEstadoPagoAcademia").textContent = "Este mes está al día.";
    cargarAcademias();
  } catch (e) {
    alert("No se pudo conectar. Inténtalo de nuevo.");
  }
});

el("btnCancelarEditarAcademia").addEventListener("click", () => { el("modalEditarAcademia").hidden = true; });

el("btnGuardarEditarAcademia").addEventListener("click", async () => {
  const nombre = el("inputEditarNombreAcademia").value.trim();
  const claveNueva = el("inputEditarClaveAcademia").value.trim();
  const nuevoLimite = Number(el("inputEditarLimite").value);
  const email = el("inputEditarEmailAcademia").value.trim();
  const mensualidad = Number(el("inputEditarMensualidad").value) || 0;

  el("mensajeErrorEditarAcademia").textContent = "";

  if (!nombre) { el("mensajeErrorEditarAcademia").textContent = "El nombre no puede quedar vacío."; return; }
  if (!nuevoLimite || nuevoLimite < 1) { el("mensajeErrorEditarAcademia").textContent = "Escribe un límite de alumnos válido."; return; }
  if (claveNueva && claveNueva.length < 4) { el("mensajeErrorEditarAcademia").textContent = "La contraseña nueva debe tener al menos 4 caracteres."; return; }
  if (mensualidad < 0) { el("mensajeErrorEditarAcademia").textContent = "La mensualidad no puede ser negativa."; return; }

  el("btnGuardarEditarAcademia").disabled = true;
  try {
    const r = await llamar("duenoActualizarAcademia", {
      claveDueno,
      academiaId: academiaEditandoId,
      nombre,
      limite: nuevoLimite,
      email,
      mensualidad,
      ...(claveNueva ? { clave: claveNueva } : {}),
    });
    if (!r.success) { el("mensajeErrorEditarAcademia").textContent = r.error || "No se pudo guardar."; return; }
    el("modalEditarAcademia").hidden = true;
    cargarAcademias();
  } catch (e) {
    el("mensajeErrorEditarAcademia").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnGuardarEditarAcademia").disabled = false;
  }
});

el("btnBorrarAcademia").addEventListener("click", async () => {
  if (!window.confirm(`¿Borrar por completo a "${academiaEditandoNombre}"? Se elimina para siempre junto con sus alumnos, su historial de asistencias, sus pagos y sus fotos — después SÍ vas a poder crear otra academia con ese mismo nombre. Esto no se puede deshacer.`)) return;

  try {
    const r = await llamar("duenoBorrarAcademia", { claveDueno, academiaId: academiaEditandoId });
    if (!r.success) { el("mensajeErrorEditarAcademia").textContent = r.error || "No se pudo borrar."; return; }
    el("modalEditarAcademia").hidden = true;
    cargarAcademias();
  } catch (e) {
    el("mensajeErrorEditarAcademia").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  }
});

// ---------------------------------------------------------------
// CREAR ACADEMIA
// ---------------------------------------------------------------
el("btnCrearAcademia").addEventListener("click", async () => {
  const nombre = el("inputNuevaAcademiaNombre").value.trim();
  const clave = el("inputNuevaAcademiaClave").value.trim();
  const limite = Number(el("inputNuevaAcademiaLimite").value) || 150;
  const email = el("inputNuevaAcademiaEmail").value.trim();
  const mensualidad = Number(el("inputNuevaAcademiaMensualidad").value) || 0;

  el("mensajeErrorCrear").textContent = "";
  el("mensajeExitoCrear").textContent = "";

  if (!nombre) { el("mensajeErrorCrear").textContent = "Escribe el nombre de la academia."; return; }
  if (clave.length < 4) { el("mensajeErrorCrear").textContent = "La contraseña debe tener al menos 4 caracteres."; return; }

  el("btnCrearAcademia").disabled = true;
  try {
    const r = await llamar("duenoCrearAcademia", { claveDueno, nombre, clave, limite, email, mensualidad });
    if (!r.success) { el("mensajeErrorCrear").textContent = r.error || "No se pudo crear."; return; }
    el("mensajeExitoCrear").textContent = `Academia "${nombre}" creada. Avísales el nombre y la contraseña para que entren a su panel.`;
    el("inputNuevaAcademiaNombre").value = "";
    el("inputNuevaAcademiaClave").value = "";
    el("inputNuevaAcademiaLimite").value = "150";
    el("inputNuevaAcademiaEmail").value = "";
    el("inputNuevaAcademiaMensualidad").value = "";
    cargarAcademias();
  } catch (e) {
    el("mensajeErrorCrear").textContent = "No se pudo conectar. Inténtalo de nuevo.";
  } finally {
    el("btnCrearAcademia").disabled = false;
  }
});

// ---------------------------------------------------------------
// INICIO — si ya había una clave guardada, entra directo
// ---------------------------------------------------------------
if (claveDueno) {
  el("inputClaveDueno").value = claveDueno;
  intentarEntrar();
}
