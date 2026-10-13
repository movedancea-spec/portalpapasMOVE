// ==========================================
// MOVE — LINK DE LA MODISTA
// MOVE Dance Academy
// ==========================================
// Página pública de solo lectura: cuántos trajes hay que hacer por baile
// y para quién (solo nombres). No tiene login: entra con el token que
// viene en el link (modista.html#t=TOKEN), que Recepción genera y puede
// regenerar desde "Alumnas Show" para invalidar el anterior.
//
// El token va después del # para que nunca viaje al servidor de esta
// página (no queda en logs ni en el "referer"); aquí se lee y se le
// manda al Worker (modistaShow), que es quien decide si es válido. El
// Worker ya responde solo nombres y totales — sin precios, tallas ni
// datos de contacto —, así que esta página no tiene nada que ocultar.
//
// "Mis pagos": lo que la academia le ha pagado, con su comprobante. El
// comprobante también se pide con el token (modistaComprobante), así que
// si Recepción regenera el link, el viejo deja de verlos.
//
// Avance del traje (2026-10-13): junto a cada alumna, 📏 Medidas y
// 🪡 Tallaje con el día en que Recepción los marcó, o "Pendiente", y
// 🧵 "Entregado por ti" (cuando Recepción recibió el traje). Es solo
// para ver: aquí no hay ningún botón para marcar ni desmarcar, y el Worker
// solo manda esas dos etapas (sin hora, sin las demás).

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

let gruposModista = [];
let pagosModista = [];
let totalPagado = 0;
let cuentasModista = null; // { totalTrajes, totalModista, pagado, saldo, bailesSinPrecio, detalle }
let filtroAvance = "todas";

// Qué trajes deja ver cada botón del filtro. Se cuenta por traje (una
// fila por alumna en cada baile), igual que el "N trajes" de cada baile.
const FILTROS_AVANCE = {
  todas: () => true,
  medidas: (a) => !a.medidas,
  tallaje: (a) => !a.tallaje,
  recibido: (a) => !a.recibido,
  entregados: (a) => Boolean(a.recibido),
};

function el(id) {
  return document.getElementById(id);
}

function crearEl(tag, clase, texto) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function tokenDelLink() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  return (params.get("t") || "").trim();
}

function mostrarError(texto) {
  el("textoCargando").hidden = true;
  el("contenido").hidden = true;
  el("cajaError").hidden = false;
  el("cajaError").textContent = texto;
}

async function cargar() {
  const token = tokenDelLink();
  if (!token) {
    mostrarError("Este link está incompleto. Pide el link de nuevo a la academia.");
    return;
  }
  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "modistaShow", token }),
    });
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok || !datos.success) {
      mostrarError(datos.error || "No se pudo cargar la lista. Intenta de nuevo en un momento.");
      return;
    }
    gruposModista = datos.grupos || [];
    pagosModista = datos.pagos || [];
    totalPagado = datos.totalPagado || 0;
    cuentasModista = datos.cuentas || null;
    el("textoActualizado").textContent = datos.actualizado ? `Actualizado: ${formatoFecha(datos.actualizado)}` : "";
    render();
  } catch (e) {
    mostrarError("No hay conexión. Revisa tu internet e intenta de nuevo.");
  }
}

// "2026-10-06 14:05" (hora de Guatemala, ya calculada en el Worker) → "6/10/2026, 14:05"
function formatoFecha(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(texto);
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}, ${m[4]}` : texto;
}

function render() {
  el("textoCargando").hidden = true;
  el("contenido").hidden = false;

  const bailes = gruposModista.flatMap((g) => g.bailes.map((b) => ({ ...b, grupo: g.nombre })));
  el("totalTrajes").textContent = bailes.reduce((suma, b) => suma + b.total, 0);
  el("totalBailes").textContent = bailes.length;

  // Con un filtro activo solo quedan los bailes (y grupos) que tienen al
  // menos una alumna en ese filtro: si no, los de arriba no cambiaban y
  // no se notaba el filtro (pedido de Ana, 2026-10-13).
  const filtrando = filtroAvance !== "todas";
  const enFiltro = (b) => (b.alumnasAvance || []).filter(FILTROS_AVANCE[filtroAvance]).length;
  const visible = (b) => !filtrando || enFiltro(b) > 0;
  const textoVacio = filtrando ? "No hay trajes en este filtro" : "Todavía no hay bailes cargados.";

  // 1) Por Grupo MOVE: grupo → bailes → alumnas
  const vistaGrupo = el("vistaGrupo");
  vistaGrupo.innerHTML = "";
  const gruposVisibles = gruposModista.filter((g) => g.bailes.some(visible));
  if (!gruposVisibles.length) vistaGrupo.appendChild(crearEl("p", "show-vacio filtro-vacio", textoVacio));
  gruposVisibles.forEach((g) => {
    const seccion = crearEl("section", "show-grupo");
    const encabezado = crearEl("div", "show-grupo-encabezado");
    const trajes = g.bailes.reduce((suma, b) => suma + b.total, 0);
    const vistos = g.bailes.reduce((suma, b) => suma + enFiltro(b), 0);
    encabezado.appendChild(crearEl("h2", "show-grupo-nombre", g.nombre));
    encabezado.appendChild(
      crearEl("span", "show-grupo-total", filtrando ? `${vistos} de ${trajes} trajes` : `${trajes} traje${trajes === 1 ? "" : "s"}`)
    );
    seccion.appendChild(encabezado);
    g.bailes.filter(visible).forEach((b) => seccion.appendChild(tarjetaBaile(b, "")));
    vistaGrupo.appendChild(seccion);
  });

  // 2) Por baile: todos los bailes en orden alfabético, indicando su grupo
  const vistaBaile = el("vistaBaile");
  vistaBaile.innerHTML = "";
  const seccion = crearEl("section", "show-grupo");
  const bailesVisibles = bailes.filter(visible);
  bailesVisibles
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base", numeric: true }) || a.grupo.localeCompare(b.grupo, "es"))
    .forEach((b) => seccion.appendChild(tarjetaBaile(b, b.grupo)));
  if (!bailesVisibles.length) seccion.appendChild(crearEl("p", "show-vacio filtro-vacio", textoVacio));
  vistaBaile.appendChild(seccion);

  renderPagos();
  actualizarFiltros();
}

function formatoQuetzales(monto) {
  return "Q" + Number(monto || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "2026-10-01" → "1 oct 2026" (sin pasar por Date, para que la zona
// horaria del celular no la corra un día).
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatoFechaCorta(fechaIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso || "");
  return m ? `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1]} ${m[1]}` : "Sin fecha";
}

// Resumen de "Mis pagos": total de los trajes con su precio, lo pagado y
// el saldo, y el detalle por baile (trajes × precio = subtotal). Todo
// viene calculado del Worker; aquí no se suma nada.
function renderCuentasModista() {
  const cont = el("cuentasModista");
  cont.innerHTML = "";
  const c = cuentasModista;
  if (!c) return;
  const linea = (etiqueta, valor, clase = "") => {
    const fila = crearEl("div", "cuentas-linea " + clase);
    fila.append(crearEl("span", "", etiqueta), crearEl("strong", "", valor));
    return fila;
  };
  const precio = (monto) => (typeof monto === "number" ? formatoQuetzales(monto) : "Sin precio");

  const caja = crearEl("div", "cuentas-caja");
  caja.appendChild(crearEl("p", "cuentas-titulo", `🧵 Tus trajes · ${c.totalTrajes} traje${c.totalTrajes === 1 ? "" : "s"}`));
  caja.append(linea("Total trajes", formatoQuetzales(c.totalModista)), linea("Pagado", formatoQuetzales(c.pagado)));
  caja.appendChild(
    c.saldo < 0
      ? linea("Saldo a favor de la academia", formatoQuetzales(-c.saldo), "cuentas-saldo a-favor")
      : linea("Saldo pendiente", formatoQuetzales(c.saldo), "cuentas-saldo")
  );
  if (c.bailesSinPrecio) {
    caja.appendChild(
      crearEl("p", "cuentas-aviso", `⚠️ ${c.bailesSinPrecio} baile${c.bailesSinPrecio === 1 ? "" : "s"} todavía sin precio: no ${c.bailesSinPrecio === 1 ? "está sumado" : "están sumados"} en el total.`)
    );
  }
  cont.appendChild(caja);

  const detalle = crearEl("details", "cuentas-detalle");
  detalle.appendChild(crearEl("summary", "", "Ver detalle por baile"));
  c.detalle.forEach((d) => {
    detalle.appendChild(
      linea(
        `${d.nombre}${d.activo ? "" : " (desactivado)"} · ${d.grupo} — ${d.trajes} × ${precio(d.precio)}`,
        precio(d.subtotal),
        d.subtotal === null ? "sin-precio" : ""
      )
    );
  });
  cont.appendChild(detalle);
}

// 3) Mis pagos: total recibido y cada pago, del más reciente al más viejo.
function renderPagos() {
  renderCuentasModista();
  el("totalRecibido").textContent = formatoQuetzales(totalPagado);
  const lista = el("listaPagos");
  lista.innerHTML = "";
  if (!pagosModista.length) {
    lista.appendChild(crearEl("p", "show-vacio", "Todavía no hay pagos registrados."));
    return;
  }
  pagosModista.forEach((p) => {
    const tarjeta = crearEl("article", "show-baile pago");
    const encabezado = crearEl("div", "show-baile-encabezado");
    const titulos = crearEl("div", "show-baile-titulos");
    titulos.appendChild(crearEl("h3", "show-baile-nombre", formatoQuetzales(p.monto)));
    titulos.appendChild(crearEl("p", "show-baile-grupo", `${formatoFechaCorta(p.fecha)}${p.metodo ? " · " + p.metodo : ""}`));
    encabezado.appendChild(titulos);
    if (p.comprobante) {
      const ver = crearEl("button", "btn-comprobante", p.comprobante === "pdf" ? "📄 Comprobante" : "🖼️ Comprobante");
      ver.type = "button";
      ver.addEventListener("click", () => verComprobante(p.id));
      encabezado.appendChild(ver);
    }
    tarjeta.appendChild(encabezado);
    if (p.concepto) tarjeta.appendChild(crearEl("p", "pago-concepto", p.concepto));
    if (p.bailes.length) tarjeta.appendChild(crearEl("p", "pago-bailes", "Bailes: " + p.bailes.join(", ")));
    lista.appendChild(tarjeta);
  });
}

// El archivo llega del Worker como binario. La ventana se abre en el
// mismo toque (antes de esperar al Worker) para que el celular no la
// bloquee como ventana emergente.
async function verComprobante(pagoId) {
  const aviso = el("mensajePagos");
  aviso.hidden = true;
  const ventana = window.open("", "_blank");
  if (ventana) ventana.document.title = "Abriendo comprobante...";
  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "modistaComprobante", token: tokenDelLink(), pagoId }),
    });
    const tipo = resp.headers.get("Content-Type") || "";
    if (!resp.ok || tipo.includes("application/json")) {
      const error = await resp.json().catch(() => ({}));
      throw new Error(error.error || "No se pudo abrir el comprobante.");
    }
    const url = URL.createObjectURL(await resp.blob());
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (ventana) ventana.close();
    aviso.textContent = e.message;
    aviso.hidden = false;
  }
}

// "2026-10-14" → "14 oct" (sin pasar por Date: el Worker ya calculó el
// día en hora de Guatemala).
function formatoDiaCorto(fechaIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso || "");
  return m ? `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1]}` : "";
}

function indicadorAvance(icono, nombre, fechaIso, etiqueta = "") {
  const hecho = Boolean(fechaIso);
  const chip = crearEl("span", "avance-chip" + (hecho ? " hecho" : ""));
  chip.textContent = `${icono} ${etiqueta}${hecho ? "✓ " + formatoDiaCorto(fechaIso) : "Pendiente"}`;
  chip.title = `${nombre}: ${hecho ? "listo el " + formatoDiaCorto(fechaIso) : "pendiente"}`;
  return chip;
}

function listaConAvance(baile, tarjeta) {
  const avance = baile.alumnasAvance;
  const total = avance.length;
  const conMedidas = avance.filter((a) => a.medidas).length;
  const conTallaje = avance.filter((a) => a.tallaje).length;
  const entregados = avance.filter((a) => a.recibido).length;
  // Cada parte en su propio span para que, al bajar de línea, el ícono
  // no se quede separado de su texto.
  const resumen = crearEl("p", "avance-resumen");
  [`📏 Medidas: ${conMedidas} de ${total}`, `🪡 Tallaje: ${conTallaje} de ${total}`, `🧵 Entregados: ${entregados} de ${total}`].forEach(
    (texto, i) => {
      if (i) resumen.append(" · ");
      resumen.appendChild(crearEl("span", "avance-resumen-parte", texto));
    }
  );
  tarjeta.appendChild(resumen);

  // Con el filtro, cada alumna conserva su número de la lista completa.
  // El resumen de arriba siempre lleva los totales reales del baile.
  const visibles = avance.map((a, i) => ({ ...a, numero: i + 1 })).filter(FILTROS_AVANCE[filtroAvance]);
  // Respaldo: render() ya oculta los bailes sin alumnas en el filtro.
  if (!visibles.length) return;
  const lista = crearEl("ol", "avance-alumnas");
  visibles.forEach((a) => {
    const fila = crearEl("li", "avance-alumna");
    fila.value = a.numero;
    const chips = crearEl("span", "avance-chips");
    chips.append(
      indicadorAvance("📏", "Medidas", a.medidas),
      indicadorAvance("🪡", "Tallaje", a.tallaje),
      indicadorAvance("🧵", "Entregado por ti", a.recibido, "Entregado por ti: ")
    );
    fila.append(crearEl("span", "avance-nombre", a.nombre), chips);
    lista.appendChild(fila);
  });
  tarjeta.appendChild(lista);
}

function tarjetaBaile(baile, grupo) {
  const tarjeta = crearEl("article", "show-baile");
  const encabezado = crearEl("div", "show-baile-encabezado");
  const titulos = crearEl("div", "show-baile-titulos");
  titulos.appendChild(crearEl("h3", "show-baile-nombre", baile.nombre));
  if (grupo) titulos.appendChild(crearEl("p", "show-baile-grupo", grupo));
  const total = crearEl("div", "show-baile-total");
  total.append(crearEl("strong", "", String(baile.total)), crearEl("span", "", baile.total === 1 ? "traje" : "trajes"));
  encabezado.append(titulos, total);
  tarjeta.appendChild(encabezado);

  if (!baile.alumnas.length) {
    tarjeta.appendChild(crearEl("p", "show-vacio", "Sin alumnas asignadas todavía."));
  } else if (Array.isArray(baile.alumnasAvance)) {
    listaConAvance(baile, tarjeta);
  } else {
    const lista = crearEl("ol", "show-alumnas");
    baile.alumnas.forEach((nombre) => lista.appendChild(crearEl("li", "", nombre)));
    tarjeta.appendChild(lista);
  }
  return tarjeta;
}

document.querySelectorAll(".pestana").forEach((boton) => {
  boton.addEventListener("click", () => {
    document.querySelectorAll(".pestana").forEach((b) => {
      const activa = b === boton;
      b.classList.toggle("activa", activa);
      b.setAttribute("aria-selected", String(activa));
    });
    el("vistaGrupo").hidden = boton.dataset.vista !== "Grupo";
    el("vistaBaile").hidden = boton.dataset.vista !== "Baile";
    el("vistaPagos").hidden = boton.dataset.vista !== "Pagos";
    // El conteo de trajes y el filtro no aplican a "Mis pagos" (y así no salen al imprimirlos).
    el("resumenTrajes").hidden = boton.dataset.vista === "Pagos";
    el("filtroAvance").hidden = boton.dataset.vista === "Pagos";
    el("textoFiltro").hidden = boton.dataset.vista === "Pagos";
  });
});

// Aviso de cuántos trajes se están viendo: sin eso, al empezar el show
// (nada marcado todavía) "Faltan medidas" muestra la misma lista que
// "Todas" y parecía que el botón no hacía nada (reporte de Ana,
// 2026-10-13).
function actualizarFiltros() {
  const trajes = gruposModista.flatMap((g) => g.bailes).flatMap((b) => b.alumnasAvance || []);
  document.querySelectorAll(".filtro-btn").forEach((b) => {
    const activo = b.dataset.filtro === filtroAvance;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  });
  const vistos = trajes.filter(FILTROS_AVANCE[filtroAvance]).length;
  const aviso = el("textoFiltro");
  aviso.hidden = false;
  aviso.classList.toggle("filtrando", filtroAvance !== "todas");
  aviso.textContent = "Mostrando ";
  aviso.append(crearEl("strong", "", String(vistos)), ` de ${trajes.length} trajes`);
}

// Un solo listener en el contenedor de los botones.
el("filtroAvance").addEventListener("click", (evento) => {
  const boton = evento.target.closest(".filtro-btn");
  if (!boton || !FILTROS_AVANCE[boton.dataset.filtro]) return;
  filtroAvance = boton.dataset.filtro;
  render();
  // Regresa al inicio de la lista: los botones y el conteo quedan arriba.
  const inicio = el("filtroAvance").getBoundingClientRect().top + window.scrollY - 8;
  // Directo, sin animación: la lista ya cambió y así se ve al instante.
  if (window.scrollY > inicio) window.scrollTo(0, inicio);
});

el("btnImprimir").addEventListener("click", () => window.print());

cargar();
