// ==========================================
// MOVE PORTAL DE ALUMNAS - Cloudflare Worker
// MOVE Dance Academy
// ==========================================
// Este Worker es el único lugar donde vive la clave secreta de
// Airtable (AIRTABLE_TOKEN), configurada como "Secret" en
// Cloudflare, nunca en este código ni en la página pública.
//
// IMPORTANTE: lo que se muestra en el perfil de cada alumna (qué
// campos, con qué etiqueta, en qué orden) se controla 100% desde
// la tabla "CONFIGURACION PORTAL ALUMNAS" en Airtable. Para
// agregar, quitar, renombrar o reordenar un dato del perfil, edita
// esa tabla — no hace falta tocar este código.

const BASE_ID = "appPEfqYLEyfLcRJE";

const TABLES = {
  ALUMNAS: "tblenK3YMJxbxBXUM",
  CONFIGURACION: "tblewQNjHZApBa1Y6",
  PAGOS: "tblwuYhyCfgTjCaI1",
  PAGOS_ESPECIALES: "tbllo2fReK9emizXS",
  EVALUACIONES_MOVE: "tblq7WhJmXMgFUUrC",
  CHAT: "tbl2SMCaMFvqu3nDs",
  MAESTRAS: "tblfh3eL5l1DUkny0",
  GRUPOS: "tbl5AoLEq4bQHUirT",
  HORARIOS: "tblEef0P3BWP1oGXP",
  PRUEBAS: "tblXRQvBCTNKgTtHA",
  FAMILIAS: "tbl3IcsVBBQnFwdkR",
  ABONOS: "tblnAGbVfk4eMi9kb",
  ASISTENCIA: "tblLFLUpsiyy7UNx4",
  BITACORA_CLASE: "tbl4lCGATWk6AEclS",
};

// -------------------------------------
// Cuenta NUEVA de Paggo, exclusiva para "Pagos Especiales" (trajes,
// competencias, etc.) — es una cuenta distinta a la que ya usan las
// mensualidades (esa sigue funcionando por su propio camino, vía la
// automatización de Airtable). Todo lo de esta cuenta se configura
// con "Secrets"/variables en Cloudflare, nunca aquí en el código:
//   - PAGGO_ESPECIALES_API_KEY: la API Key generada en la pestaña
//     "Credenciales" de esta cuenta de Paggo.
//   - PAGGO_ESPECIALES_WEBHOOK_SECRET: una palabra secreta inventada
//     por nosotros (no la da Paggo) que agregamos como "?secret=..."
//     al final de la URL del webhook configurada en Paggo, para que
//     nadie más pueda llamar a ese endpoint y falsificar pagos.
const PAGGO_ESPECIALES_API_URL = "https://api.paggoapp.com/api/center/transactions/create-link";

// Las 17 calificaciones de EVALUACIONES MOVE, agrupadas en las mismas
// 3 categorías que usa la app de evaluaciones de las maestras (mismos
// títulos y mismo orden), para que el perfil de la alumna se vea
// exactamente igual de organizado.
const GRUPOS_EVALUACION = [
  {
    titulo: "💪 Técnica Corporal",
    items: [
      { label: "Técnica", campo: "TECNICA" },
      { label: "Postura", campo: "POSTURA" },
      { label: "Brazos", campo: "BRAZOS" },
      { label: "Piernas", campo: "PIERNAS" },
      { label: "Control y Limpieza", campo: "CONTROL Y LIMPIEZA" },
      { label: "Precisión de Ejercicios", campo: "PRECISION DE EJERCICIOS" },
      { label: "Anatomía del Cuerpo", campo: "ANATOMIA DEL CUERPO" },
    ],
  },
  {
    titulo: "🎭 Artístico",
    items: [
      { label: "Musicalidad", campo: "MUSICALIDAD" },
      { label: "Proyección Escénica", campo: "PROYECCIÓN ESCÉNICA" },
      { label: "Coordinación", campo: "COORDINACION" },
      { label: "Uso del Espacio", campo: "USO DEL ESPACIO / CONCIENCIA ESPACIAL" },
      { label: "Memoria Coreográfica", campo: "MEMORIA COREOGRAFICA / EJERCICIOS" },
    ],
  },
  {
    titulo: "⭐ Actitud y Disciplina",
    items: [
      { label: "Esfuerzo y Progreso", campo: "ESFUERZO Y PROGRESO" },
      { label: "Atención y Enfoque", campo: "ATENCIÓN Y ENFOQUE" },
      { label: "Actitud", campo: "ACTITUD" },
      { label: "Asistencia", campo: "ASISTENCIA" },
      { label: "Puntualidad", campo: "PUNTUALIDAD" },
    ],
  },
];

const CAMPOS_COMENTARIOS_EVALUACION = [
  { label: "Fortalezas", campo: "FORTALEZAS" },
  { label: "Aspectos a mejorar", campo: "ASPECTOS A MEJORAR" },
  { label: "Objetivo siguiente periodo", campo: "OBJETIVO SIGUIENTE PERIODO" },
  { label: "Observaciones", campo: "OBSERVACIONES" },
];

// ID del campo "SUBIR COMPROBANTE DE PAGO" en PAGOS (se usa por ID,
// no por nombre, porque la API de adjuntos de Airtable va en la URL).
const CAMPO_COMPROBANTE_ID = "fldAjorZNL6VyQ6OG";

// ID del campo "FOTO ALUMNA" en ALUMNAS (mismo motivo: se usa por ID
// para poder subir el archivo con la API de adjuntos de Airtable).
const CAMPO_FOTO_ALUMNA_ID = "fldoRv81hkFaiJRSz";

// ID del campo "COMPROBANTE" en ABONOS (mismo motivo: API de adjuntos).
const CAMPO_COMPROBANTE_ABONO_ID = "fldOE3wXS8hAZk3Ce";

// ID del campo "SUBIR COMPROBANTE DE PAGO" en PAGOS ESPECIALES (mismo
// motivo: API de adjuntos). A diferencia del comprobante de ABONOS, este
// SOLO adjunta el archivo al pago especial para que la academia lo
// revise — no crea ningún abono ni cambia el saldo automáticamente,
// para no arriesgar duplicar un pago ya confirmado por link.
const CAMPO_COMPROBANTE_PAGO_ESPECIAL_ID = "fldHXHgWZWYDmtPBm";

// Nombre EXACTO del campo "autorizo el show" en ALUMNAS — tiene espacios
// dobles (después de "ACEPTO", después de la coma tras "MISMO," y después
// de "TRAJES"), tal como está guardado en Airtable. Debe coincidir letra
// por letra y espacio por espacio, si no la API de Airtable lo rechaza.
const CAMPO_AUTORIZO_SHOW =
  "AUTORIZO QUE MI HIJA/O PARTICIPE EN EL SHOW DE FIN DE AÑO Y ACEPTO  LOS REQUISITOS PARA PARTICIPAR EN EL MISMO,  ASIMISMO ACEPTO Y ME COMPROMETO A REALIZAR LOS PAGOS CORRESPONDIENTES DE CADA UNO DE SUS TRAJES  EN LAS FECHAS ESTABLECIDAS.";

// Nombre del mes actual en español, para comparar contra el campo
// MES (multipleSelects) de PAGOS.
const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function airtableFetch(env, path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Airtable error (${res.status})`);
  }
  return data;
}

async function listAll(env, tableId, params = "") {
  let records = [];
  let offset;
  do {
    const sep = params ? "&" : "?";
    const url = `${tableId}${params}${offset ? `${sep}offset=${offset}` : ""}`;
    const data = await airtableFetch(env, url);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

// Para el chat: solo mostramos/contamos mensajes del mes en curso
// (los meses anteriores no se borran de Airtable, solo se ocultan
// del chat para que no se vaya llenando de mensajes viejos).
function esDelMesActual(fechaIso) {
  const ahora = new Date();
  const f = new Date(fechaIso);
  return f.getUTCFullYear() === ahora.getUTCFullYear() && f.getUTCMonth() === ahora.getUTCMonth();
}

// -------------------------------------
// ACCIÓN: alumnas
// Lista de alumnas activas para la pantalla de "busca tu nombre".
// Solo devolvemos el nombre: nada sensible hasta que entren con
// su clave.
// -------------------------------------
async function getAlumnas(env) {
  const alumnas = await listAll(
    env,
    TABLES.ALUMNAS,
    `?${qs({ filterByFormula: '{ESTADO}="ACTIVA"' })}&fields%5B%5D=ALUMNA%2FO`
  );
  return {
    success: true,
    alumnas: alumnas.map((r) => ({
      id: r.id,
      nombre: r.fields["ALUMNA/O"] || "(Sin nombre)",
    })),
  };
}

// -------------------------------------
// Convierte el valor crudo de un campo de Airtable (texto, número,
// selección, adjunto, etc.) en algo listo para mostrar en la
// página: { tipo: "imagen"|"texto", valor }.
// -------------------------------------
function formatearCampo(valorCrudo) {
  if (valorCrudo === undefined || valorCrudo === null || valorCrudo === "") {
    return { tipo: "texto", valor: "" };
  }
  if (Array.isArray(valorCrudo)) {
    if (valorCrudo.length && valorCrudo[0] && typeof valorCrudo[0] === "object" && valorCrudo[0].url) {
      // multipleAttachments: usamos el primer archivo
      return { tipo: "imagen", valor: valorCrudo[0].url };
    }
    const textos = valorCrudo.map((v) => (v && typeof v === "object" && v.name ? v.name : v));
    return { tipo: "texto", valor: textos.join(", ") };
  }
  if (typeof valorCrudo === "object") {
    if (valorCrudo.url) return { tipo: "imagen", valor: valorCrudo.url };
    if (valorCrudo.name) return { tipo: "texto", valor: valorCrudo.name };
    return { tipo: "texto", valor: JSON.stringify(valorCrudo) };
  }
  return { tipo: "texto", valor: String(valorCrudo) };
}

// -------------------------------------
// Busca el registro de PAGOS del mes en curso para esta alumna
// (comparando por nombre, porque ARRAYJOIN() de un campo de
// registros enlazados da el nombre del registro, no su recordId —
// mismo detalle que en el Worker de reportes de prueba).
// -------------------------------------
async function obtenerPagoDelMes(env, alumnaNombre) {
  if (!alumnaNombre) return null;
  const nombreEscapado = alumnaNombre.replace(/"/g, '\\"');
  const mesActual = MESES_ES[new Date().getUTCMonth()];
  const anioActual = new Date().getUTCFullYear();

  const formula =
    `AND(` +
    `FIND("${nombreEscapado}", ARRAYJOIN({ALUMNA})), ` +
    `FIND("${mesActual}", ARRAYJOIN({MES})), ` +
    `{AÑO}="${anioActual}"` +
    `)`;

  const data = await airtableFetch(
    env,
    `${TABLES.PAGOS}?${qs({ filterByFormula: formula, maxRecords: 1 })}`
  );
  const rec = data.records && data.records[0];
  if (!rec) return null;
  return construirPago(rec);
}

function construirPago(rec) {
  const f = rec.fields || {};
  const estadoRaw = f["ESTADO"];
  const estado = estadoRaw && typeof estadoRaw === "object" ? estadoRaw.name : estadoRaw || "";
  let monto = f["MENSUALIDAD"];
  if (Array.isArray(monto)) monto = monto[0];
  const comprobantes = f["SUBIR COMPROBANTE DE PAGO"];

  // Los links de pago de Paggo se vencen después de un tiempo. Si ya
  // pasaron 12 horas desde que se generó (FECHA_LINK), lo tratamos
  // como si no existiera — así el portal vuelve a mostrar el botón
  // "Generar link de pago" en vez de un "Pagar ahora" que ya no sirve,
  // y generarLink() genera uno nuevo la próxima vez que lo pidan. Si
  // el registro no tiene FECHA_LINK (links viejos de antes de este
  // campo), lo dejamos como está para no romper nada.
  const HORAS_VIGENCIA_LINK = 12;
  let linkPago = f["LINK_PAGO"] || "";
  const fechaLinkRaw = f["FECHA_LINK"];
  if (linkPago && fechaLinkRaw) {
    const horasDesdeGenerado = (Date.now() - new Date(fechaLinkRaw).getTime()) / (1000 * 60 * 60);
    if (horasDesdeGenerado >= HORAS_VIGENCIA_LINK) {
      linkPago = "";
    }
  }

  return {
    pagoId: rec.id,
    estado,
    monto: monto ?? null,
    linkPago,
    tieneComprobante: Array.isArray(comprobantes) && comprobantes.length > 0,
  };
}

// -------------------------------------
// Trae los "PAGOS ESPECIALES" (trajes, competencias, etc.) que están
// enlazados a la alumna, leyendo directamente TIPO / MONTO TOTAL /
// MONTO PAGADO / SALDO / ESTADO de cada registro — así evitamos
// mostrar el texto largo y feo del campo "primary" (que es una
// fórmula concatenada) y en vez de eso armamos una tarjeta ordenada
// por cada pago especial.
// -------------------------------------
function construirPagoEspecial(rec, tieneComprobantePendiente) {
  const f = rec.fields || {};
  const tipoRaw = f["TIPO"];
  const tipo = tipoRaw && typeof tipoRaw === "object" ? tipoRaw.name : tipoRaw || "";
  const estadoRaw = f["ESTADO"];
  const estado = estadoRaw && typeof estadoRaw === "object" ? estadoRaw.name : estadoRaw || "";
  const comprobantes = f["SUBIR COMPROBANTE DE PAGO"];
  return {
    id: rec.id,
    tipo,
    montoTotal: f["MONTO TOTAL"] ?? null,
    montoPagado: f["MONTO PAGADO"] ?? null,
    saldo: f["SALDO"] ?? null,
    estado,
    fechaLimite: f["FECHA LIMITE"] || "",
    linkPago: f["LINK_PAGO"] || "",
    montoLink: f["MONTO_LINK"] ?? null,
    tieneComprobantePendiente: !!tieneComprobantePendiente,
    tieneComprobante: Array.isArray(comprobantes) && comprobantes.length > 0,
  };
}

// -------------------------------------
// IDs de PAGO ESPECIAL que tienen ahora mismo un abono con comprobante
// "Pendiente de revisión" (subido desde el Portal) — para mostrar ese
// aviso en la tarjeta y no dejar que suban otro comprobante encima.
// -------------------------------------
async function idsPagosEspecialesConComprobantePendiente(env) {
  const data = await airtableFetch(
    env,
    `${TABLES.ABONOS}?${qs({
      filterByFormula: `{ESTADO REVISION}="Pendiente de revisión"`,
    })}`
  );
  const ids = new Set();
  (data.records || []).forEach((r) => {
    const enlazados = r.fields["PAGO ESPECIAL"] || [];
    enlazados.forEach((id) => ids.add(id));
  });
  return ids;
}

async function obtenerPagosEspeciales(env, ids) {
  if (!ids || !ids.length) return [];
  const formula = "OR(" + ids.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const [records, idsPendientes] = await Promise.all([
    listAll(env, TABLES.PAGOS_ESPECIALES, `?${qs({ filterByFormula: formula })}`),
    idsPagosEspecialesConComprobantePendiente(env),
  ]);
  const porId = {};
  records.forEach((r) => {
    porId[r.id] = r;
  });
  // Conservamos el mismo orden en que están enlazados en ALUMNAS.
  return ids
    .filter((id) => porId[id])
    .map((id) => construirPagoEspecial(porId[id], idsPendientes.has(id)));
}

// -------------------------------------
// ACCIÓN: generarLinkEspecial
// Genera un link de pago en Paggo — con la cuenta NUEVA, exclusiva
// para Pagos Especiales — por el monto que haya elegido el papá/mamá
// (puede ser el saldo completo o un abono parcial). A diferencia de
// la mensualidad (que pasa por una automatización de Airtable), aquí
// llamamos directamente a la API de Paggo desde este Worker.
//
// Como cada abono puede ser de un monto distinto, cada clic genera
// un link NUEVO (no se reutiliza uno viejo): el link anterior, si no
// se pagó, simplemente deja de mostrarse en el portal al reemplazarlo.
// -------------------------------------
async function generarLinkEspecial(env, pagoEspecialId, montoElegido) {
  if (!pagoEspecialId) {
    return json({ success: false, error: "Falta el pago especial." }, 400);
  }

  let record = await airtableFetch(env, `${TABLES.PAGOS_ESPECIALES}/${pagoEspecialId}`);
  let pago = construirPagoEspecial(record);

  // Ya está pagado (SALDO llegó a 0 por los ABONOS) — nada que generar.
  if ((pago.estado || "").toUpperCase() === "PAGADO") {
    return json({ success: true, pagoEspecial: pago });
  }

  const saldo = Number(pago.saldo) || 0;
  const monto = Math.round((Number(montoElegido) || 0) * 100) / 100;

  if (!monto || monto < 2) {
    return json({ success: false, error: "El monto a abonar debe ser de al menos Q2.00." }, 400);
  }
  if (monto > saldo) {
    return json(
      { success: false, error: `El monto no puede ser mayor al saldo pendiente (Q${saldo}).` },
      400
    );
  }

  // Datos de la alumna (nombre, correo) para el link — son opcionales
  // para Paggo, así que si no hay correo simplemente no lo mandamos.
  const idsAlumna = record.fields["ALUMNA"] || [];
  let nombreAlumna = "";
  let correoAlumna = "";
  if (idsAlumna[0]) {
    const recAlumna = await airtableFetch(env, `${TABLES.ALUMNAS}/${idsAlumna[0]}`);
    nombreAlumna = recAlumna.fields["ALUMNA/O"] || "";
    correoAlumna = recAlumna.fields["CORREO"] || "";
  }

  const esAbonoParcial = monto < saldo;
  const cuerpo = {
    concept: `${esAbonoParcial ? "Abono " : ""}${pago.tipo || "Pago especial"}${
      nombreAlumna ? " - " + nombreAlumna : ""
    }`.slice(0, 140),
    amount: monto,
    metadata: {
      custom: { pagoEspecialId },
    },
  };
  if (nombreAlumna) cuerpo.customerName = nombreAlumna;
  if (correoAlumna) cuerpo.email = correoAlumna;

  const resPaggo = await fetch(PAGGO_ESPECIALES_API_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": env.PAGGO_ESPECIALES_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });
  const datosPaggo = await resPaggo.json();
  if (!resPaggo.ok || !datosPaggo.result) {
    throw new Error(datosPaggo.error || datosPaggo.name || "No se pudo generar el link de pago en Paggo.");
  }

  await airtableFetch(env, TABLES.PAGOS_ESPECIALES, {
    method: "PATCH",
    body: JSON.stringify({
      records: [
        {
          id: pagoEspecialId,
          fields: {
            LINK_PAGO: datosPaggo.result.link,
            PAGGO_LINK_ID: datosPaggo.result.id,
            FECHA_LINK: new Date().toISOString(),
            PAGGO_STATUS: "Pendiente",
            MONTO_LINK: monto,
          },
        },
      ],
      typecast: true,
    }),
  });

  record = await airtableFetch(env, `${TABLES.PAGOS_ESPECIALES}/${pagoEspecialId}`);
  return json({ success: true, pagoEspecial: construirPagoEspecial(record) });
}

// -------------------------------------
// Busca un PAGO ESPECIAL a partir del PAGGO_LINK_ID — respaldo para
// cuando el webhook no trae metadata.custom.pagoEspecialId (o viene
// de un link generado antes de tener esta lógica).
// -------------------------------------
async function buscarPagoEspecialPorLinkId(env, linkId) {
  if (!linkId) return null;
  const data = await airtableFetch(
    env,
    `${TABLES.PAGOS_ESPECIALES}?${qs({
      filterByFormula: `{PAGGO_LINK_ID}=${Number(linkId)}`,
      maxRecords: 1,
    })}`
  );
  return (data.records && data.records[0]) || null;
}

// -------------------------------------
// Busca si ya existe un ABONO creado para este link de Paggo (para
// no duplicar el abono si Paggo reintenta el mismo webhook), y para
// poder encontrarlo y borrarlo si el pago se revierte.
// -------------------------------------
async function buscarAbonoPorLinkId(env, linkId) {
  const etiqueta = `Paggo link ${linkId}`;
  const data = await airtableFetch(
    env,
    `${TABLES.ABONOS}?${qs({
      filterByFormula: `FIND("${etiqueta}", {COMENTARIOS})`,
      maxRecords: 1,
    })}`
  );
  return (data.records && data.records[0]) || null;
}

// -------------------------------------
// Recibe los webhooks de la cuenta nueva de Paggo (pagos especiales).
// No pasa por el mismo formato { accion, ... } del resto del Worker
// porque el cuerpo lo define Paggo, no nosotros — por eso se atiende
// aparte, por URL, antes del enrutador principal.
//
// LINK_PAYED_SUCCESS   -> crea un ABONO por el monto pagado (eso hace
//                que SALDO baje solo, vía el rollup/fórmula
//                que ya existe en PAGOS ESPECIALES).
// LINK_WRONG_PAYMENT   -> solo deja constancia (no cambia el saldo).
// LINK_REVERSED_SUCCESS-> borra el ABONO que se había creado, para
//                que el saldo vuelva a subir.
// -------------------------------------
async function webhookPagoEspeciales(request, env, url) {
  if (request.method !== "POST") {
    return json({ success: false, error: "Método no permitido" }, 405);
  }

  const secretEsperado = env.PAGGO_ESPECIALES_WEBHOOK_SECRET;
  if (secretEsperado && url.searchParams.get("secret") !== secretEsperado) {
    return json({ success: false, error: "No autorizado" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ success: false, error: "JSON inválido" }, 400);
  }

  try {
    const evento = body.event;
    const data = body.data || {};
    const linkId = data.linkId;

    let pagoEspecialId = data.metadata && data.metadata.custom && data.metadata.custom.pagoEspecialId;
    if (!pagoEspecialId) {
      const rec = await buscarPagoEspecialPorLinkId(env, linkId);
      if (rec) pagoEspecialId = rec.id;
    }
    if (!pagoEspecialId) {
      console.error("Webhook Paggo especiales: no se encontró el pago especial", evento, linkId);
      return json({ success: true, aviso: "Pago especial no encontrado" });
    }

    const recPago = await airtableFetch(env, `${TABLES.PAGOS_ESPECIALES}/${pagoEspecialId}`);
    // Solo limpiamos el LINK_PAGO guardado si sigue siendo ESTE link
    // (por si ya generaron uno más nuevo antes de que llegara este
    // webhook — no queremos borrar el link nuevo por error).
    const esElLinkActual = String(recPago.fields["PAGGO_LINK_ID"] || "") === String(linkId || "");
    const limpiarLink = esElLinkActual
      ? { LINK_PAGO: "", PAGGO_LINK_ID: null, MONTO_LINK: null }
      : {};

    if (evento === "LINK_PAYED_SUCCESS") {
      const yaExiste = await buscarAbonoPorLinkId(env, linkId);
      if (!yaExiste) {
        const idsAlumna = recPago.fields["ALUMNA"] || [];
        await airtableFetch(env, TABLES.ABONOS, {
          method: "POST",
          body: JSON.stringify({
            records: [
              {
                fields: {
                  ALUMNA: idsAlumna,
                  "PAGO ESPECIAL": [pagoEspecialId],
                  MONTO: Number(data.amount) || 0,
                  METODO: "LINK",
                  COMENTARIOS: `Pagado con link de Paggo (Paggo link ${linkId})`,
                  "ESTADO REVISION": "Confirmado",
                },
              },
            ],
            typecast: true,
          }),
        });

        // Aviso por WhatsApp a la academia de que entró un pago especial
        // por link, para poder enterarse al instante sin depender de
        // revisar una vista filtrada en Airtable.
        try {
          let nombreAlumna = "una alumna";
          if (idsAlumna[0]) {
            const recAlumna = await airtableFetch(env, `${TABLES.ALUMNAS}/${idsAlumna[0]}`);
            nombreAlumna = (recAlumna.fields || {})["ALUMNA/O"] || nombreAlumna;
          }
          const tipo = recPago.fields["TIPO"] || "Pago especial";
          await enviarWhatsapp(
            env,
            "50237529984",
            `💰 Nuevo pago por link recibido\n\nAlumna: ${nombreAlumna}\nConcepto: ${tipo}\nMonto: Q${
              Number(data.amount) || 0
            }\n\nYa quedó registrado en Airtable.`
          );
        } catch (e) {
          console.error("No se pudo avisar por WhatsApp del pago especial:", e.message);
        }
      }
      await airtableFetch(env, TABLES.PAGOS_ESPECIALES, {
        method: "PATCH",
        body: JSON.stringify({
          records: [{ id: pagoEspecialId, fields: { PAGGO_STATUS: "Pagado", ...limpiarLink } }],
          typecast: true,
        }),
      });
    } else if (evento === "LINK_WRONG_PAYMENT") {
      await airtableFetch(env, TABLES.PAGOS_ESPECIALES, {
        method: "PATCH",
        body: JSON.stringify({
          records: [{ id: pagoEspecialId, fields: { PAGGO_STATUS: "Pago fallido", ...limpiarLink } }],
          typecast: true,
        }),
      });
    } else if (evento === "LINK_REVERSED_SUCCESS") {
      const abono = await buscarAbonoPorLinkId(env, linkId);
      if (abono) {
        await airtableFetch(env, `${TABLES.ABONOS}/${abono.id}`, { method: "DELETE" });
      }
      await airtableFetch(env, TABLES.PAGOS_ESPECIALES, {
        method: "PATCH",
        body: JSON.stringify({
          records: [{ id: pagoEspecialId, fields: { PAGGO_STATUS: "Revertido", ...limpiarLink } }],
          typecast: true,
        }),
      });
    }

    return json({ success: true });
  } catch (e) {
    console.error("Error en webhook Paggo especiales:", e);
    // Respondemos 200 aunque falle para que Paggo no reintente en
    // bucle; el error queda en los logs del Worker para revisarlo.
    return json({ success: false, error: e.message || "Error interno" });
  }
}

// -------------------------------------
// Trae las evaluaciones (tabla EVALUACIONES MOVE) enlazadas a la
// alumna y las arma agrupadas en las mismas 3 categorías que usa la
// app de evaluaciones de las maestras, listas para mostrarse en
// tarjetas bonitas en el portal.
// -------------------------------------
function construirEvaluacion(rec, nombreAlumna) {
  const f = rec.fields || {};
  const idRaw = (f["ID"] || "").toString();

  // El ID se guarda como "ALUMNA - CLASE - PERIODO"; le quitamos el
  // nombre de la alumna (ya lo sabemos) para que el título quede
  // limpio, algo como "CONTEMPO - Periodo 2".
  let titulo = idRaw;
  if (nombreAlumna && idRaw.startsWith(nombreAlumna)) {
    titulo = idRaw.slice(nombreAlumna.length).replace(/^\s*-\s*/, "");
  }

  const tipoRaw = f["TIPO"];
  const tipo = tipoRaw && typeof tipoRaw === "object" ? tipoRaw.name : tipoRaw || "";

  const grupos = GRUPOS_EVALUACION.map((g) => ({
    titulo: g.titulo,
    items: g.items
      .map((it) => ({ label: it.label, valor: f[it.campo] }))
      .filter((it) => it.valor !== undefined && it.valor !== null && it.valor !== ""),
  })).filter((g) => g.items.length);

  const comentarios = CAMPOS_COMENTARIOS_EVALUACION.map((c) => ({
    label: c.label,
    valor: f[c.campo] || "",
  })).filter((c) => c.valor);

  // La "clase" se deriva del título quitando el último segmento (el
  // periodo, ej. "JULIO"): el título ya viene como "CLASE - PERIODO"
  // porque le quitamos el nombre de la alumna arriba. Esto nos deja
  // agrupar evaluaciones de la MISMA clase entre distintos periodos,
  // para poder comparar el progreso de un periodo al siguiente más
  // abajo, sin tener que agregar un campo nuevo en Airtable.
  const partesTitulo = (titulo || "").split(" - ");
  const claseKey = partesTitulo.length > 1 ? partesTitulo.slice(0, -1).join(" - ") : titulo;

  return {
    id: rec.id,
    titulo: titulo || "Evaluación",
    anio: f["AÑO"] || "",
    tipo,
    // NOTA FINAL a propósito NO se envía al portal: los papás no deben
    // ver la nota en porcentaje, solo las estrellitas por área (grupos).
    grupos,
    comentarios,
    claseKey,
    creada: rec.createdTime,
  };
}

// -------------------------------------
// Le agrega a cada evaluación (excepto la primera de cada clase) un
// "delta" por categoría comparado contra la evaluación INMEDIATAMENTE
// ANTERIOR de esa misma clase (ordenadas por fecha de creación), para
// que el progreso entre un periodo y el siguiente se vea de un
// vistazo (▲/▼) en vez de tener que comparar evaluaciones aisladas
// manualmente.
// -------------------------------------
function agregarProgreso(evaluaciones) {
  const porClase = new Map();
  evaluaciones.forEach((ev) => {
    if (!porClase.has(ev.claseKey)) porClase.set(ev.claseKey, []);
    porClase.get(ev.claseKey).push(ev);
  });

  porClase.forEach((lista) => {
    lista.sort((a, b) => new Date(a.creada) - new Date(b.creada));
    for (let i = 1; i < lista.length; i++) {
      const actual = lista[i];
      const anterior = lista[i - 1];
      actual.grupos = actual.grupos.map((g) => {
        const grupoAnterior = (anterior.grupos || []).find((ga) => ga.titulo === g.titulo);
        return {
          titulo: g.titulo,
          items: g.items.map((it) => {
            const itemAnterior =
              grupoAnterior && grupoAnterior.items.find((ia) => ia.label === it.label);
            if (
              !itemAnterior ||
              typeof it.valor !== "number" ||
              typeof itemAnterior.valor !== "number"
            ) {
              return { ...it, delta: null };
            }
            return { ...it, delta: it.valor - itemAnterior.valor };
          }),
        };
      });
    }
  });

  // Quitamos los campos internos (claseKey, creada) que solo servían
  // para este cálculo, antes de mandar la respuesta al portal.
  return evaluaciones.map(({ claseKey, creada, ...resto }) => resto);
}

async function getEvaluaciones(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const nombreAlumna = f["ALUMNA/O"] || "";

  const idsEval = f["EVALUACIONES MOVE"] || [];
  if (!idsEval.length) {
    return json({ success: true, evaluaciones: [] });
  }

  const formula = "OR(" + idsEval.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const records = await listAll(
    env,
    TABLES.EVALUACIONES_MOVE,
    `?${qs({ filterByFormula: formula })}`
  );

  // Solo mostramos las evaluaciones del año en curso — el próximo año
  // arranca vacío otra vez (mismo criterio que ya usamos para el
  // historial de mensualidades).
  const anioActual = new Date().getUTCFullYear();
  const evaluaciones = records
    .filter((r) => Number(r.fields["AÑO"]) === anioActual)
    .map((r) => construirEvaluacion(r, nombreAlumna))
    .sort((a, b) => (b.anio || 0) - (a.anio || 0));

  return json({ success: true, evaluaciones: agregarProgreso(evaluaciones) });
}

// -------------------------------------
// ACCIÓN: generarLink
// Marca GENERAR_LINK en el registro de pago (esto dispara la
// automatización de Airtable que ya tienen conectada a Paggo) y
// espera unos segundos a que el link aparezca en LINK_PAGO. Si el
// pago ya está PAGADO, o ya existe un link generado, no vuelve a
// generar uno nuevo.
// -------------------------------------
async function generarLink(env, pagoId) {
  if (!pagoId) {
    return json({ success: false, error: "Falta el pago." }, 400);
  }

  let record = await airtableFetch(env, `${TABLES.PAGOS}/${pagoId}`);
  let pago = construirPago(record);

  if (pago.estado === "PAGADO") {
    return json({ success: true, pago });
  }
  if (pago.linkPago) {
    return json({ success: true, pago });
  }

  await airtableFetch(env, TABLES.PAGOS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: pagoId, fields: { GENERAR_LINK: true } }],
      typecast: true,
    }),
  });

  // La automatización de Airtable/Paggo corre en segundo plano;
  // esperamos un poco y revisamos varias veces si ya llegó el link.
  for (let intento = 0; intento < 6; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    record = await airtableFetch(env, `${TABLES.PAGOS}/${pagoId}`);
    pago = construirPago(record);
    if (pago.linkPago) {
      return json({ success: true, pago });
    }
  }

  return json(
    {
      success: false,
      error: "El link de pago se está generando. Espera unos segundos y vuelve a intentar.",
    },
    202
  );
}

// -------------------------------------
// ACCIÓN: subirComprobante
// Sube un archivo (foto o PDF del comprobante) directamente al
// campo de adjuntos SUBIR COMPROBANTE DE PAGO del registro de pago,
// usando la API de adjuntos de Airtable (content.airtable.com).
// -------------------------------------
async function subirComprobante(env, pagoId, archivoBase64, nombreArchivo, tipoArchivo) {
  if (!pagoId || !archivoBase64) {
    return json({ success: false, error: "Falta el archivo." }, 400);
  }

  const res = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${pagoId}/${CAMPO_COMPROBANTE_ID}/uploadAttachment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType: tipoArchivo || "application/octet-stream",
        filename: nombreArchivo || "comprobante",
        file: archivoBase64,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `Error subiendo el archivo (${res.status})`);
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: subirComprobantePagoEspecial
// Igual que subirComprobante() de arriba, pero para un PAGO ESPECIAL:
// sube el archivo directo al campo de adjuntos SUBIR COMPROBANTE DE
// PAGO de ese registro. A propósito NO crea ningún ABONO ni cambia
// ESTADO/saldo — solo queda adjunto para que la academia lo revise a
// mano, así no hay riesgo de duplicar un pago que ya se confirmó solo
// por link de Paggo.
// -------------------------------------
async function subirComprobantePagoEspecial(env, pagoEspecialId, archivoBase64, nombreArchivo, tipoArchivo) {
  if (!pagoEspecialId || !archivoBase64) {
    return json({ success: false, error: "Falta el archivo." }, 400);
  }

  const res = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${pagoEspecialId}/${CAMPO_COMPROBANTE_PAGO_ESPECIAL_ID}/uploadAttachment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType: tipoArchivo || "application/octet-stream",
        filename: nombreArchivo || "comprobante",
        file: archivoBase64,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `Error subiendo el archivo (${res.status})`);
  }

  return json({ success: true });
}

// -------------------------------------
// Envía un mensaje de WhatsApp por Green API (mismas credenciales que
// usa el Worker de reportes de clase de prueba: GREEN_INSTANCE_ID y
// GREEN_API_TOKEN deben estar configuradas como Secret en este Worker
// también).
// -------------------------------------
async function enviarWhatsapp(env, telefonoLimpio, mensaje) {
  // Si a este Worker todavía no le has configurado los Secrets de
  // Green API, la URL queda mal formada (algo como
  // ".../waInstanceundefined/sendMessage/undefined") y el servidor
  // responde con una página de error en HTML en vez de JSON — sin
  // este chequeo, eso se veía como el críptico error "Unexpected
  // token '<' ... is not valid JSON". Con esto avisamos claro qué
  // falta configurar.
  if (!env.GREEN_INSTANCE_ID || !env.GREEN_API_TOKEN) {
    throw new Error(
      "Este Worker todavía no tiene configuradas las claves de WhatsApp (GREEN_INSTANCE_ID y GREEN_API_TOKEN) en Cloudflare. Agrégalas como Secret y vuelve a intentar."
    );
  }

  let numeroFinal = telefonoLimpio;
  if (!numeroFinal.startsWith("502")) numeroFinal = "502" + numeroFinal;

  const resp = await fetch(
    `https://api.green-api.com/waInstance${env.GREEN_INSTANCE_ID}/sendMessage/${env.GREEN_API_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: `${numeroFinal}@c.us`, message: mensaje }),
    }
  );

  const textoResp = await resp.text();
  let data;
  try {
    data = JSON.parse(textoResp);
  } catch (e) {
    throw new Error(
      `Green API no respondió con datos válidos (código ${resp.status}). Revisa que GREEN_INSTANCE_ID y GREEN_API_TOKEN estén bien puestos en este Worker.`
    );
  }

  if (!resp.ok || !data?.idMessage) {
    throw new Error(data?.reason || data?.message || `Green API error (${resp.status})`);
  }
}

// -------------------------------------
// Manda un correo con Resend (resend.com). RESEND_API_KEY debe estar
// configurada como Secret en este Worker (igual que GREEN_INSTANCE_ID
// y GREEN_API_TOKEN para WhatsApp). El remitente (EMAIL_REMITENTE)
// debe ser una dirección del dominio ya verificado en Resend.
// -------------------------------------
async function enviarCorreo(env, destinatario, asunto, html) {
  if (!env.RESEND_API_KEY) {
    throw new Error(
      "Este Worker todavía no tiene configurada la clave de correo (RESEND_API_KEY) en Cloudflare. Agrégala como Secret y vuelve a intentar."
    );
  }

  const remitente = env.EMAIL_REMITENTE || "MOVE Dance Academy <clave@academiamovedance.com>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: remitente,
      to: [destinatario],
      subject: asunto,
      html,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.message || `Resend no respondió correctamente (código ${resp.status}).`);
  }
  return data;
}

// -------------------------------------
// ACCIÓN: recuperarClave
// Le reenvía a la alumna/mamá su clave actual del portal por
// WhatsApp (no la cambia, solo se la recuerda). Usa WHATSAPP MAMA si
// existe, si no usa WHATSAPP.
// -------------------------------------
async function recuperarClave(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};

  const clave = (f["CLAVE PORTAL"] || "").toString().trim();
  if (!clave) {
    return json(
      { success: false, error: "Todavía no tienes una clave asignada. Contacta a la academia." },
      400
    );
  }

  const telefonoRaw = f["WHATSAPP MAMA"] || f["WHATSAPP"] || "";
  const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
  if (!telefonoLimpio) {
    return json(
      {
        success: false,
        error: "No tenemos un WhatsApp registrado para enviarte tu clave. Contacta a la academia.",
      },
      400
    );
  }

  try {
    await enviarWhatsapp(
      env,
      telefonoLimpio,
      `Hola! 👋 Este es tu clave para entrar al Portal de Alumnas de MOVE Dance Academy: ${clave}`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el WhatsApp: " + e.message }, 500);
  }

  return json({ success: true, ultimosDigitos: telefonoLimpio.slice(-4) });
}

// -------------------------------------
// ACCIÓN: recuperarClavePorCorreo
// La familia escribe su correo; solo se manda la clave si ese correo
// coincide EXACTAMENTE (sin mayúsculas/espacios) con el que ya está
// guardado en Airtable para esta alumna — así nadie puede recibir la
// clave de otra alumna con solo escribir cualquier correo.
// -------------------------------------
async function recuperarClavePorCorreo(env, alumnaId, correoIngresado) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }
  const correoLimpio = (correoIngresado || "").toString().trim().toLowerCase();
  if (!correoLimpio) {
    return json({ success: false, error: "Escribe tu correo." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};

  const clave = (f["CLAVE PORTAL"] || "").toString().trim();
  if (!clave) {
    return json(
      { success: false, error: "Todavía no tienes una clave asignada. Contacta a la academia." },
      400
    );
  }

  const correoGuardado = (f["CORREO"] || "").toString().trim().toLowerCase();
  if (!correoGuardado || correoGuardado !== correoLimpio) {
    return json(
      {
        success: false,
        error:
          "Ese correo no coincide con el que tenemos registrado. Verifica que esté bien escrito, o usa la opción de recuperar por WhatsApp.",
      },
      400
    );
  }

  try {
    await enviarCorreo(
      env,
      correoGuardado,
      "Tu clave del Portal de Alumnas — MOVE Dance Academy",
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;">
        <h2 style="color:#ef4b9b;margin-bottom:4px;">MOVE Dance Academy</h2>
        <p style="color:#555;font-size:15px;">¡Hola! Aquí está tu clave para entrar al Portal de Alumnas:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:3px;color:#ef4b9b;background:#fff0f6;padding:14px 22px;border-radius:14px;display:inline-block;margin:12px 0;">${clave}</p>
        <p style="color:#999;font-size:12.5px;margin-top:22px;">Si tú no solicitaste este correo, puedes ignorarlo con confianza — tu clave sigue siendo la misma.</p>
      </div>`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el correo: " + e.message }, 500);
  }

  return json({ success: true });
}

// -------------------------------------
// Busca a qué familia (tabla FAMILIAS PORTAL) pertenece una alumna,
// si es que pertenece a alguna. La usan las dos acciones de
// recuperación de la clave familiar de abajo.
// -------------------------------------
async function buscarFamiliaDeAlumna(env, alumnaId) {
  const familias = await listAll(env, TABLES.FAMILIAS);
  return familias.find((r) => (r.fields["ALUMNAS"] || []).includes(alumnaId)) || null;
}

// -------------------------------------
// ACCIÓN: recuperarClaveFamiliar
// Como no hay un WhatsApp/correo propio de la "familia" en Airtable,
// piden buscar a UNA de sus hijas — y le reenviamos la clave FAMILIAR
// (no la individual) al WhatsApp que ya tenemos registrado para ella.
// -------------------------------------
async function recuperarClaveFamiliar(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const familia = await buscarFamiliaDeAlumna(env, alumnaId);
  if (!familia) {
    return json({ success: false, error: "Esa alumna todavía no está en ningún grupo familiar." }, 400);
  }
  const claveFamiliar = (familia.fields["CLAVE FAMILIAR"] || "").toString().trim();
  if (!claveFamiliar) {
    return json({ success: false, error: "Ese grupo familiar todavía no tiene una clave asignada." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const telefonoRaw = f["WHATSAPP MAMA"] || f["WHATSAPP"] || "";
  const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
  if (!telefonoLimpio) {
    return json(
      {
        success: false,
        error: "No tenemos un WhatsApp registrado para enviarte la clave familiar. Contacta a la academia.",
      },
      400
    );
  }

  try {
    await enviarWhatsapp(
      env,
      telefonoLimpio,
      `Hola! 👋 Esta es la clave FAMILIAR del Portal de Alumnas de MOVE Dance Academy (con ella ven a todas las hermanas juntas): ${claveFamiliar}`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el WhatsApp: " + e.message }, 500);
  }

  return json({ success: true, ultimosDigitos: telefonoLimpio.slice(-4) });
}

// -------------------------------------
// ACCIÓN: recuperarClaveFamiliarPorCorreo
// Igual que arriba pero por correo, y con la misma validación de
// siempre: el correo escrito debe coincidir EXACTO con el que ya está
// guardado para esa alumna.
// -------------------------------------
async function recuperarClaveFamiliarPorCorreo(env, alumnaId, correoIngresado) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }
  const correoLimpio = (correoIngresado || "").toString().trim().toLowerCase();
  if (!correoLimpio) {
    return json({ success: false, error: "Escribe tu correo." }, 400);
  }

  const familia = await buscarFamiliaDeAlumna(env, alumnaId);
  if (!familia) {
    return json({ success: false, error: "Esa alumna todavía no está en ningún grupo familiar." }, 400);
  }
  const claveFamiliar = (familia.fields["CLAVE FAMILIAR"] || "").toString().trim();
  if (!claveFamiliar) {
    return json({ success: false, error: "Ese grupo familiar todavía no tiene una clave asignada." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const correoGuardado = (f["CORREO"] || "").toString().trim().toLowerCase();
  if (!correoGuardado || correoGuardado !== correoLimpio) {
    return json(
      {
        success: false,
        error:
          "Ese correo no coincide con el que tenemos registrado. Verifica que esté bien escrito, o usa la opción de recuperar por WhatsApp.",
      },
      400
    );
  }

  try {
    await enviarCorreo(
      env,
      correoGuardado,
      "Tu clave familiar del Portal de Alumnas — MOVE Dance Academy",
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;">
        <h2 style="color:#ef4b9b;margin-bottom:4px;">MOVE Dance Academy</h2>
        <p style="color:#555;font-size:15px;">¡Hola! Aquí está la clave FAMILIAR para ver a todas tus hijas juntas en el Portal de Alumnas:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:3px;color:#ef4b9b;background:#fff0f6;padding:14px 22px;border-radius:14px;display:inline-block;margin:12px 0;">${claveFamiliar}</p>
        <p style="color:#999;font-size:12.5px;margin-top:22px;">Si tú no solicitaste este correo, puedes ignorarlo con confianza — la clave sigue siendo la misma.</p>
      </div>`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el correo: " + e.message }, 500);
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: cambiarClave
// La alumna/mamá ya está dentro del portal (ya validó su clave
// actual para entrar); aquí la vuelve a confirmar por seguridad
// antes de guardar la nueva.
// -------------------------------------
async function cambiarClave(env, alumnaId, claveActual, claveNueva) {
  if (!alumnaId || !claveActual || !claveNueva) {
    return json({ success: false, error: "Completa todos los campos." }, 400);
  }
  const nuevaLimpia = claveNueva.toString().trim();
  if (nuevaLimpia.length < 6) {
    return json({ success: false, error: "Tu nueva clave debe tener al menos 6 caracteres." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const claveGuardada = (f["CLAVE PORTAL"] || "").toString().trim();

  if (!claveGuardada || claveGuardada.toLowerCase() !== claveActual.toString().trim().toLowerCase()) {
    return json({ success: false, error: "Tu clave actual no es correcta." }, 401);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { "CLAVE PORTAL": nuevaLimpia } }],
      typecast: true,
    }),
  });

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: historialPagos
// Devuelve todas las mensualidades (tabla PAGOS) de esta alumna del
// AÑO EN CURSO únicamente — el próximo año arranca vacío otra vez,
// no se va acumulando. Cada una trae su estado, monto y link de pago
// (si ya existe) para poder pagar las pendientes desde aquí mismo.
// -------------------------------------
async function getHistorialPagos(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const nombreAlumna = f["ALUMNA/O"] || "";
  if (!nombreAlumna) {
    return json({ success: true, historial: [] });
  }

  const nombreEscapado = nombreAlumna.replace(/"/g, '\\"');
  const anioActual = new Date().getUTCFullYear();
  const formula =
    `AND(` +
    `FIND("${nombreEscapado}", ARRAYJOIN({ALUMNA})), ` +
    `{AÑO}="${anioActual}"` +
    `)`;

  const records = await listAll(env, TABLES.PAGOS, `?${qs({ filterByFormula: formula })}`);

  const historial = records.map((r) => {
    const pago = construirPago(r);
    const mesRaw = r.fields["MES"];
    const mes = Array.isArray(mesRaw) ? mesRaw[0] : mesRaw || "";
    return { ...pago, mes };
  });

  historial.sort((a, b) => MESES_ES.indexOf(a.mes) - MESES_ES.indexOf(b.mes));

  return json({ success: true, anio: anioActual, historial });
}

// -------------------------------------
// ACCIÓN: actualizarCumpleanos
// Permite que la familia corrija la fecha de cumpleaños directamente
// desde el perfil, por si quedó mal escrita. Solo toca ese único
// campo — no se expone edición libre de ningún otro dato.
// -------------------------------------
async function actualizarCumpleanos(env, alumnaId, nuevaFecha) {
  if (!alumnaId || !nuevaFecha) {
    return json({ success: false, error: "Falta la fecha de cumpleaños." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha)) {
    return json({ success: false, error: "La fecha no tiene un formato válido." }, 400);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { "CUMPLEAÑOS": nuevaFecha } }],
      typecast: true,
    }),
  });

  return json({ success: true, cumpleanos: nuevaFecha });
}

// -------------------------------------
// ACCIÓN: actualizarCorreo
// Permite que la familia agregue o corrija su correo directamente
// desde el perfil — así las que todavía no lo tenían registrado
// pueden ponerlo ellas mismas y usar después la recuperación de
// clave por correo. Solo toca ese único campo.
// -------------------------------------
async function actualizarCorreo(env, alumnaId, nuevoCorreo) {
  if (!alumnaId || !nuevoCorreo) {
    return json({ success: false, error: "Falta el correo." }, 400);
  }
  const correoLimpio = nuevoCorreo.toString().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)) {
    return json({ success: false, error: "Ese correo no tiene un formato válido." }, 400);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { CORREO: correoLimpio } }],
      typecast: true,
    }),
  });

  return json({ success: true, correo: correoLimpio });
}

// -------------------------------------
// ACCIÓN: actualizarParticipacionShow
// Permite que la familia responda (o cambie su respuesta) directamente
// desde el perfil sobre si su hija/o participa en el show de fin de
// año. Solo toca ese único campo.
// -------------------------------------
async function actualizarParticipacionShow(env, alumnaId, valor) {
  if (!alumnaId || !valor) {
    return json({ success: false, error: "Falta indicar si participa en el show." }, 400);
  }
  const valorLimpio = valor.toString().trim().toUpperCase();
  if (valorLimpio !== "SI" && valorLimpio !== "NO") {
    return json({ success: false, error: "El valor debe ser SI o NO." }, 400);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { [CAMPO_AUTORIZO_SHOW]: valorLimpio } }],
      typecast: true,
    }),
  });

  return json({ success: true, participacionShow: valorLimpio });
}

// -------------------------------------
// ACCIÓN: entrar
// 1) Vuelve a leer el registro de la alumna EN VIVO
// 2) Compara la clave ingresada contra CLAVE PORTAL
// 3) Si coincide, arma el perfil según la tabla CONFIGURACION
//    PORTAL ALUMNAS (solo filas VISIBLE, en orden de ORDEN)
// -------------------------------------
// Arma el perfil completo (datos visibles + pago del mes + pagos
// especiales) de una alumna, ya sea que se recibió su registro de
// Airtable de antemano (para no volver a pedirlo) o solo su ID.
// La usan tanto "entrar" (una sola alumna) como "entrarFamilia"
// (varias hermanas a la vez con la clave familiar).
async function construirPerfilAlumna(env, alumnaId, recordYaLeido) {
  const record = recordYaLeido || (await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`));
  const f = record.fields || {};

  const filasConfig = await listAll(
    env,
    TABLES.CONFIGURACION,
    `?${qs({ filterByFormula: "{VISIBLE}=1" })}`
  );
  filasConfig.sort((a, b) => (a.fields["ORDEN"] || 0) - (b.fields["ORDEN"] || 0));

  const perfil = filasConfig.map((fila) => {
    const etiqueta = fila.fields["ETIQUETA"] || "";
    const nombreCampo = fila.fields["CAMPO EN ALUMNAS"] || "";
    const { tipo, valor } = formatearCampo(f[nombreCampo]);
    // Mandamos también el nombre real del campo de Airtable (no solo
    // la etiqueta) para que la página pueda reconocer de forma
    // confiable cuál fila es "CUMPLEAÑOS" y mostrarla editable, sin
    // depender del texto de la etiqueta (que la academia puede
    // cambiar libremente en CONFIGURACION PORTAL ALUMNAS).
    return { etiqueta, tipo, valor, campo: nombreCampo };
  });

  const pago = await obtenerPagoDelMes(env, f["ALUMNA/O"] || "");
  const pagosEspeciales = await obtenerPagosEspeciales(env, f["PAGOS ESPECIALES"] || []);

  // "GRUPOS MOVE" es el vínculo REAL entre ALUMNAS y GRUPOS (el
  // inverso automático del campo "ALUMNAS 2" que ya usa el Panel de
  // Clase) — a diferencia del campo "CLASE" (un simple selector de
  // texto que a veces no coincide exactamente con el nombre real del
  // grupo, y que solo permite un valor aunque la alumna esté en más
  // de un grupo). Usamos este vínculo para que el objetivo del mes
  // que se muestra en el portal SIEMPRE sea el del grupo correcto,
  // sin depender de que los nombres coincidan como texto.
  const idsGruposAlumna = f["GRUPOS MOVE"] || [];
  const objetivosMensuales = await obtenerObjetivosMensualesPortal(env, idsGruposAlumna);

  return {
    id: alumnaId,
    nombre: f["ALUMNA/O"] || "",
    perfil,
    pago,
    pagosEspeciales,
    objetivosMensuales,
  };
}

// -------------------------------------
// Objetivo técnico del MES EN CURSO para el portal de alumnas/papás,
// uno por cada grupo real (vía "GRUPOS MOVE") en el que esté la
// alumna — puede ser más de uno si toma varias clases. Solo se
// incluyen los grupos que sí tienen un objetivo MENSUAL cargado este
// mismo mes; nunca se muestra el de un mes anterior.
// -------------------------------------
async function obtenerObjetivosMensualesPortal(env, gruposIds) {
  if (!gruposIds || !gruposIds.length) return [];

  const resultados = [];
  for (const grupoId of gruposIds) {
    const bitacora = await obtenerBitacoraGrupo(env, grupoId);
    if (!bitacora.objetivoMensual) continue;

    let nombreGrupo = "";
    try {
      const grupoRec = await airtableFetch(env, `${TABLES.GRUPOS}/${grupoId}`);
      nombreGrupo = grupoRec.fields["NOMBRE DEL GRUPO"] || "";
    } catch (e) {
      // Si por algo no se puede leer el nombre del grupo, igual
      // mostramos el objetivo (sin nombre) en vez de perderlo.
    }

    resultados.push({ clase: nombreGrupo, objetivo: bitacora.objetivoMensual });
  }

  return resultados;
}

async function entrar(env, alumnaId, clave) {
  if (!alumnaId || !clave) {
    return json({ success: false, error: "Falta el código de acceso." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};

  const claveGuardada = (f["CLAVE PORTAL"] || "").toString().trim();
  const claveIngresada = clave.toString().trim();

  if (!claveGuardada || claveGuardada.toLowerCase() !== claveIngresada.toLowerCase()) {
    return json({ success: false, error: "Ese código no es correcto." }, 401);
  }

  const datos = await construirPerfilAlumna(env, alumnaId, record);
  return json({ success: true, ...datos });
}

// -------------------------------------
// ACCIÓN: entrarFamilia
// Con UNA clave familiar (tabla FAMILIAS PORTAL), devuelve el perfil
// completo de TODAS las hermanas que estén vinculadas a esa familia
// de una sola vez — así funciona igual sin importar el dispositivo,
// ya que no depende de nada guardado en el navegador.
// -------------------------------------
async function entrarFamilia(env, claveFamiliar) {
  const claveIngresada = (claveFamiliar || "").toString().trim().toLowerCase();
  if (!claveIngresada) {
    return json({ success: false, error: "Escribe la clave familiar." }, 400);
  }

  const familias = await listAll(env, TABLES.FAMILIAS);
  const familia = familias.find(
    (r) => (r.fields["CLAVE FAMILIAR"] || "").toString().trim().toLowerCase() === claveIngresada
  );

  if (!familia) {
    return json({ success: false, error: "Esa clave familiar no es correcta." }, 401);
  }

  const idsAlumnas = familia.fields["ALUMNAS"] || [];
  if (!idsAlumnas.length) {
    return json(
      { success: false, error: "Esta familia todavía no tiene hijas agregadas. Contacta a la academia." },
      400
    );
  }

  const hijas = [];
  for (const alumnaId of idsAlumnas) {
    try {
      const datos = await construirPerfilAlumna(env, alumnaId);
      hijas.push(datos);
    } catch (e) {
      console.error(`No se pudo cargar la alumna ${alumnaId} de la familia:`, e.message);
    }
  }

  if (!hijas.length) {
    return json({ success: false, error: "No se pudo cargar a ninguna hija de esta familia." }, 500);
  }

  return json({
    success: true,
    familiaId: familia.id,
    nombreFamilia: familia.fields["NOMBRE FAMILIA"] || "",
    hijas,
  });
}

// -------------------------------------
// ACCIÓN: cambiarClaveFamiliar
// Igual que "cambiarClave" pero para la clave de FAMILIAS PORTAL: la
// familia ya está dentro (ya validó su clave familiar actual para
// entrar), aquí la vuelve a confirmar por seguridad antes de guardar
// la nueva. Así los papás pueden cambiarla ellos mismos, sin depender
// de la academia.
// -------------------------------------
async function cambiarClaveFamiliar(env, familiaId, claveActual, claveNueva) {
  if (!familiaId || !claveActual || !claveNueva) {
    return json({ success: false, error: "Completa todos los campos." }, 400);
  }
  const nuevaLimpia = claveNueva.toString().trim();
  if (nuevaLimpia.length < 6) {
    return json({ success: false, error: "Tu nueva clave debe tener al menos 6 caracteres." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.FAMILIAS}/${familiaId}`);
  const f = record.fields || {};
  const claveGuardada = (f["CLAVE FAMILIAR"] || "").toString().trim();

  if (!claveGuardada || claveGuardada.toLowerCase() !== claveActual.toString().trim().toLowerCase()) {
    return json({ success: false, error: "Tu clave familiar actual no es correcta." }, 401);
  }

  // La clave familiar debe seguir siendo única entre todas las familias.
  const familias = await listAll(env, TABLES.FAMILIAS);
  const yaExiste = familias.some(
    (r) =>
      r.id !== familiaId &&
      (r.fields["CLAVE FAMILIAR"] || "").toString().trim().toLowerCase() === nuevaLimpia.toLowerCase()
  );
  if (yaExiste) {
    return json({ success: false, error: "Esa clave ya la está usando otra familia. Elige otra." }, 400);
  }

  await airtableFetch(env, TABLES.FAMILIAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: familiaId, fields: { "CLAVE FAMILIAR": nuevaLimpia } }],
      typecast: true,
    }),
  });

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: agregarHermanaAFamilia
// Deja que un papá/mamá una a dos (o más) hijas en un mismo grupo
// familiar PERMANENTE por su cuenta, sin que la academia tenga que
// hacerlo desde Airtable. Para probar que de verdad tiene derecho a
// juntar los perfiles, siempre se piden las claves individuales (o
// la clave familiar, si ya venía de ese lado) de AMBOS lados:
//   - identidad del lado "ancla" (desde donde se está agregando):
//     o bien alumnaId + claveAlumna (si entró con su clave individual)
//     o bien familiaId + claveFamiliar (si ya entró en modo familia)
//   - identidad de la hermana que se quiere agregar: hermanaId + claveHermana
// Reglas:
//   - Si ninguna de las dos pertenece todavía a una familia, se crea
//     una nueva (con la clave familiar que el papá/mamá elija aquí mismo).
//   - Si una de las dos ya pertenece a una familia, la otra se agrega
//     a esa misma familia (no se duplica).
//   - Si las dos ya pertenecen a familias DISTINTAS, no se juntan solas
//     (evita mezclar grupos por accidente) — se les pide escribir a la
//     academia para juntarlos manualmente.
// -------------------------------------
async function agregarHermanaAFamilia(env, datos) {
  const { alumnaId, claveAlumna, familiaId, claveFamiliar, hermanaId, claveHermana, claveFamiliarNueva } =
    datos || {};

  if (!hermanaId || !claveHermana) {
    return json({ success: false, error: "Busca a tu otra hija y escribe su clave." }, 400);
  }
  if (!alumnaId && !familiaId) {
    return json({ success: false, error: "No se pudo identificar el perfil actual." }, 400);
  }

  const familias = await listAll(env, TABLES.FAMILIAS);

  // 1) Confirmar identidad del lado "ancla" (desde donde agregan).
  let idAlumnaAncla = null;
  let recordAlumnaAncla = null;
  let familiaAncla = null;

  if (familiaId) {
    if (!claveFamiliar) {
      return json({ success: false, error: "Falta la clave familiar." }, 400);
    }
    familiaAncla = familias.find((r) => r.id === familiaId);
    const claveGuardada = familiaAncla ? (familiaAncla.fields["CLAVE FAMILIAR"] || "").toString().trim() : "";
    if (!claveGuardada || claveGuardada.toLowerCase() !== claveFamiliar.toString().trim().toLowerCase()) {
      return json({ success: false, error: "Tu clave familiar no es correcta." }, 401);
    }
  } else {
    if (!claveAlumna) {
      return json({ success: false, error: "Falta tu clave." }, 400);
    }
    recordAlumnaAncla = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
    const claveGuardada = (recordAlumnaAncla.fields["CLAVE PORTAL"] || "").toString().trim();
    if (!claveGuardada || claveGuardada.toLowerCase() !== claveAlumna.toString().trim().toLowerCase()) {
      return json({ success: false, error: "Tu clave no es correcta." }, 401);
    }
    idAlumnaAncla = alumnaId;
    familiaAncla = familias.find((r) => (r.fields["ALUMNAS"] || []).includes(alumnaId)) || null;
  }

  // 2) Confirmar identidad de la hermana que se quiere agregar.
  const recordHermana = await airtableFetch(env, `${TABLES.ALUMNAS}/${hermanaId}`);
  const claveHermanaGuardada = (recordHermana.fields["CLAVE PORTAL"] || "").toString().trim();
  if (!claveHermanaGuardada || claveHermanaGuardada.toLowerCase() !== claveHermana.toString().trim().toLowerCase()) {
    return json({ success: false, error: "La clave de tu otra hija no es correcta." }, 401);
  }
  if (hermanaId === idAlumnaAncla) {
    return json({ success: false, error: "Esa ya es la hija de este perfil." }, 400);
  }

  const familiaDeHermana = familias.find((r) => (r.fields["ALUMNAS"] || []).includes(hermanaId)) || null;

  if (familiaAncla && familiaDeHermana && familiaAncla.id !== familiaDeHermana.id) {
    return json(
      {
        success: false,
        error: "Tu otra hija ya pertenece a otro grupo familiar. Escríbele a la academia para juntar los dos grupos.",
      },
      400
    );
  }

  // Caso A: el lado ancla ya tiene familia -> solo agregamos a la hermana ahí.
  if (familiaAncla) {
    const listaActual = familiaAncla.fields["ALUMNAS"] || [];
    if (!listaActual.includes(hermanaId)) {
      await airtableFetch(env, TABLES.FAMILIAS, {
        method: "PATCH",
        body: JSON.stringify({
          records: [{ id: familiaAncla.id, fields: { ALUMNAS: [...listaActual, hermanaId] } }],
          typecast: true,
        }),
      });
    }
    const perfilHermana = await construirPerfilAlumna(env, hermanaId, recordHermana);
    return json({
      success: true,
      familiaId: familiaAncla.id,
      nombreFamilia: familiaAncla.fields["NOMBRE FAMILIA"] || "",
      // Devolvemos la clave familiar ya existente: quien logra unir a su
      // hermana (probando la clave individual de ambas) ya tiene derecho
      // a conocer el código familiar, para poder usarlo luego desde
      // cualquier otro dispositivo.
      claveFamiliar: familiaAncla.fields["CLAVE FAMILIAR"] || "",
      esNueva: false,
      hermana: perfilHermana,
    });
  }

  // Caso B: la hermana ya tenía familia (y el ancla no) -> se agrega el ancla a esa familia.
  if (familiaDeHermana) {
    const listaActual = familiaDeHermana.fields["ALUMNAS"] || [];
    if (idAlumnaAncla && !listaActual.includes(idAlumnaAncla)) {
      await airtableFetch(env, TABLES.FAMILIAS, {
        method: "PATCH",
        body: JSON.stringify({
          records: [{ id: familiaDeHermana.id, fields: { ALUMNAS: [...listaActual, idAlumnaAncla] } }],
          typecast: true,
        }),
      });
    }
    const perfilHermana = await construirPerfilAlumna(env, hermanaId, recordHermana);
    return json({
      success: true,
      familiaId: familiaDeHermana.id,
      nombreFamilia: familiaDeHermana.fields["NOMBRE FAMILIA"] || "",
      claveFamiliar: familiaDeHermana.fields["CLAVE FAMILIAR"] || "",
      esNueva: false,
      hermana: perfilHermana,
    });
  }

  // Caso C: ninguna de las dos tenía familia todavía -> se crea una nueva.
  const nuevaClaveLimpia = (claveFamiliarNueva || "").toString().trim();
  if (!nuevaClaveLimpia || nuevaClaveLimpia.length < 6) {
    return json({ success: false, error: "Crea una clave familiar de al menos 6 caracteres." }, 400);
  }
  const claveYaUsada = familias.some(
    (r) => (r.fields["CLAVE FAMILIAR"] || "").toString().trim().toLowerCase() === nuevaClaveLimpia.toLowerCase()
  );
  if (claveYaUsada) {
    return json({ success: false, error: "Esa clave familiar ya la está usando otra familia. Elige otra." }, 400);
  }

  const nombreAncla = recordAlumnaAncla?.fields?.["ALUMNA/O"] || "";
  const nombreHermana = recordHermana.fields["ALUMNA/O"] || "";

  const resp = await airtableFetch(env, TABLES.FAMILIAS, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            "NOMBRE FAMILIA": [nombreAncla, nombreHermana].filter(Boolean).join(" y "),
            "CLAVE FAMILIAR": nuevaClaveLimpia,
            ALUMNAS: [idAlumnaAncla, hermanaId],
          },
        },
      ],
      typecast: true,
    }),
  });

  const familiaCreada = resp?.records?.[0];
  const perfilHermana = await construirPerfilAlumna(env, hermanaId, recordHermana);

  return json({
    success: true,
    familiaId: familiaCreada?.id || null,
    nombreFamilia: familiaCreada?.fields?.["NOMBRE FAMILIA"] || "",
    claveFamiliar: nuevaClaveLimpia,
    esNueva: true,
    hermana: perfilHermana,
  });
}

// -------------------------------------
// CHAT: familia <-> maestras (un hilo privado por alumna)
// -------------------------------------
// No filtramos por fórmula de Airtable (ARRAYJOIN de un campo
// enlazado da el NOMBRE del registro, no su recordId — y como hay
// alumnas con el mismo nombre podría mezclar mensajes de una familia
// con los de otra). En vez de eso, traemos todos los mensajes y
// filtramos aquí mismo por el recordId exacto de la alumna, que sí
// viene directo en fields.ALUMNA al leer.
// -------------------------------------

async function chatObtener(env, alumnaId, quien, maestraId) {
  if (!alumnaId || !maestraId) {
    return json({ success: false, error: "Falta indicar la alumna y la maestra." }, 400);
  }
  const quienNormalizado = quien === "maestra" ? "maestra" : "familia";

  const todos = await listAll(env, TABLES.CHAT);
  const propios = todos.filter(
    (r) =>
      (r.fields.ALUMNA || []).includes(alumnaId) &&
      (r.fields.MAESTRA || []).includes(maestraId) &&
      esDelMesActual(r.createdTime)
  );
  propios.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

  // Al abrir el chat, marcamos como leídos los mensajes que escribió
  // "el otro lado" (si soy familia, marco leídos los de la maestra, y
  // viceversa) — así el que no abrió el chat ve que sigue pendiente.
  const campoLeido = quienNormalizado === "familia" ? "LEIDO FAMILIA" : "LEIDO MAESTRA";
  const rolContrario = quienNormalizado === "familia" ? "MAESTRA" : "FAMILIA";
  const porMarcar = propios.filter((r) => r.fields.ROL === rolContrario && !r.fields[campoLeido]);

  for (let i = 0; i < porMarcar.length; i += 10) {
    const lote = porMarcar.slice(i, i + 10);
    await airtableFetch(env, TABLES.CHAT, {
      method: "PATCH",
      body: JSON.stringify({
        records: lote.map((r) => ({ id: r.id, fields: { [campoLeido]: true } })),
        typecast: true,
      }),
    });
  }

  const mensajes = propios.map((r) => ({
    id: r.id,
    texto: r.fields.MENSAJE || "",
    rol: r.fields.ROL || "FAMILIA",
    autor: r.fields.AUTOR || "",
    fecha: r.createdTime,
  }));

  return json({ success: true, mensajes });
}

async function chatEnviar(env, alumnaId, quien, autor, texto, maestraId) {
  if (!alumnaId || !maestraId || !texto || !texto.toString().trim()) {
    return json({ success: false, error: "Escribe un mensaje." }, 400);
  }
  const rol = quien === "maestra" ? "MAESTRA" : "FAMILIA";
  const autorFinal = (autor || "").toString().trim() || (rol === "MAESTRA" ? "Academia" : "Familia");

  await airtableFetch(env, TABLES.CHAT, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            MENSAJE: texto.toString().trim(),
            ALUMNA: [alumnaId],
            MAESTRA: [maestraId],
            ROL: rol,
            AUTOR: autorFinal,
            "LEIDO FAMILIA": rol === "FAMILIA",
            "LEIDO MAESTRA": rol === "MAESTRA",
          },
        },
      ],
      typecast: true,
    }),
  });

  // Avisamos por WhatsApp al lado que NO escribió que tiene un mensaje
  // nuevo (solo el aviso, no el contenido, para no duplicar el chat
  // completo por WhatsApp) — así ninguno de los dos se queda sin
  // enterarse, aunque no tenga abierta la página en ese momento.
  if (rol === "MAESTRA") {
    try {
      const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
      const f = record.fields || {};
      const telefonoRaw = f["WHATSAPP MAMA"] || f["WHATSAPP"] || "";
      const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
      if (telefonoLimpio) {
        await enviarWhatsapp(
          env,
          telefonoLimpio,
          `💬 Tienes un mensaje nuevo de ${autorFinal} en el Portal de Alumnas sobre ${
            f["ALUMNA/O"] || "tu alumna"
          }. Entra a academiamovedance.com para verlo.`
        );
      }
    } catch (e) {
      // No interrumpe el envío del mensaje aunque falle el aviso de WhatsApp.
      console.error("No se pudo avisar por WhatsApp:", e.message);
    }
  } else {
    try {
      const [alumnaRecord, maestraRecord] = await Promise.all([
        airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`),
        airtableFetch(env, `${TABLES.MAESTRAS}/${maestraId}`),
      ]);
      const nombreAlumna = (alumnaRecord.fields || {})["ALUMNA/O"] || "una alumna";
      const telefonoRaw = (maestraRecord.fields || {})["WHATSAPP"] || "";
      const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
      if (telefonoLimpio) {
        await enviarWhatsapp(
          env,
          telefonoLimpio,
          `💬 Tienes un mensaje nuevo en el Chat de Maestras sobre ${nombreAlumna}. Entra a academiamovedance.com/maestras.html para verlo.`
        );
      }
    } catch (e) {
      // No interrumpe el envío del mensaje aunque falle el aviso de WhatsApp.
      console.error("No se pudo avisar a la maestra por WhatsApp:", e.message);
    }
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: maestrasDeAlumna
// Para que el papá/mamá elija CON QUIÉN quiere hablar (y no le llegue
// a cualquier maestra), necesitamos saber las maestras reales de esa
// alumna. El campo directo "MAESTRA" en ALUMNAS casi no se usa, pero
// cada alumna SÍ tiene sus grupos en "GRUPOS MOVE", y cada grupo ya
// tiene su "MAESTRA PRINCIPAL" — así que derivamos la lista de
// maestras a través de los grupos de la alumna.
// -------------------------------------
async function maestrasDeAlumna(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const idsGrupos = f["GRUPOS MOVE"] || [];

  if (!idsGrupos.length) {
    return json({ success: true, maestras: [] });
  }

  const formula = "OR(" + idsGrupos.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const grupos = await listAll(env, TABLES.GRUPOS, `?${qs({ filterByFormula: formula })}`);

  const idsMaestras = [];
  grupos.forEach((g) => {
    (g.fields["MAESTRA PRINCIPAL"] || []).forEach((id) => {
      if (!idsMaestras.includes(id)) idsMaestras.push(id);
    });
  });

  if (!idsMaestras.length) {
    return json({ success: true, maestras: [] });
  }

  const todas = await listAll(env, TABLES.MAESTRAS);
  const porId = {};
  todas.forEach((r) => {
    porId[r.id] = r;
  });

  const maestras = idsMaestras
    .filter((id) => porId[id] && porId[id].fields["ACTIVA"] !== false)
    .map((id) => ({ id, nombre: porId[id].fields["MAESTRA"] || "Maestra" }));

  return json({ success: true, maestras });
}

// -------------------------------------
// MAESTRAS: cada maestra tiene su propia clave individual, guardada
// en el campo "CLAVE CHAT" de la tabla MAESTRAS (junto a su nombre).
// Así el mensaje siempre queda firmado con el nombre real de quien
// escribió, sin que la maestra tenga que escribirlo ella misma.
// -------------------------------------

async function maestraEntrar(env, clave) {
  if (!clave || !clave.toString().trim()) {
    return json({ success: false, error: "Escribe tu clave." }, 400);
  }
  const claveIngresada = clave.toString().trim();

  const maestras = await listAll(env, TABLES.MAESTRAS);
  const encontrada = maestras.find((r) => {
    const f = r.fields || {};
    const claveGuardada = (f["CLAVE CHAT"] || "").toString().trim();
    return claveGuardada && claveGuardada === claveIngresada && f["ACTIVA"] !== false;
  });

  if (!encontrada) {
    return json({ success: false, error: "Clave incorrecta." }, 401);
  }

  return json({
    success: true,
    maestraId: encontrada.id,
    nombre: encontrada.fields["MAESTRA"] || "Maestra",
  });
}

// -------------------------------------
// ACCIÓN: maestraListaAlumnas
// Lista SOLO de las alumnas de ESTA maestra — derivada de los grupos
// donde ella es "MAESTRA PRINCIPAL" (mismo dato real que usamos del
// lado de los papás), así una maestra nunca ve ni puede escribirle a
// una alumna que no es suya, por privacidad — con la cantidad de
// mensajes suyos sin leer, para que sepa a quién responder primero.
// -------------------------------------
async function maestraListaAlumnas(env, maestraId) {
  if (!maestraId) {
    return json({ success: false, error: "Falta indicar la maestra." }, 400);
  }

  const todosLosGrupos = await listAll(env, TABLES.GRUPOS);
  const gruposDeMaestra = todosLosGrupos.filter((g) =>
    (g.fields["MAESTRA PRINCIPAL"] || []).includes(maestraId)
  );

  const idsAlumnas = [];
  gruposDeMaestra.forEach((g) => {
    (g.fields["ALUMNAS 2"] || []).forEach((id) => {
      if (!idsAlumnas.includes(id)) idsAlumnas.push(id);
    });
  });

  if (!idsAlumnas.length) {
    return json({ success: true, alumnas: [] });
  }

  const formula = "OR(" + idsAlumnas.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const alumnas = await listAll(
    env,
    TABLES.ALUMNAS,
    `?${qs({ filterByFormula: `AND(${formula}, {ESTADO}="ACTIVA")` })}&fields%5B%5D=ALUMNA%2FO`
  );

  const mensajes = await listAll(env, TABLES.CHAT);

  const noLeidosPorAlumna = {};
  mensajes.forEach((m) => {
    const f = m.fields || {};
    if (
      f["ROL"] === "FAMILIA" &&
      !f["LEIDO MAESTRA"] &&
      (f["MAESTRA"] || []).includes(maestraId) &&
      esDelMesActual(m.createdTime)
    ) {
      (f["ALUMNA"] || []).forEach((id) => {
        noLeidosPorAlumna[id] = (noLeidosPorAlumna[id] || 0) + 1;
      });
    }
  });

  const lista = alumnas.map((r) => ({
    id: r.id,
    nombre: r.fields["ALUMNA/O"] || "(Sin nombre)",
    noLeidos: noLeidosPorAlumna[r.id] || 0,
  }));

  lista.sort((a, b) => b.noLeidos - a.noLeidos || a.nombre.localeCompare(b.nombre));

  return json({ success: true, alumnas: lista });
}

// -------------------------------------
// ACCIÓN: gruposDeMaestra
// Lista de los grupos donde esta maestra es "MAESTRA PRINCIPAL" — para
// que elija con cuál va a dar clase antes de entrar al Panel de Clase.
// -------------------------------------
async function gruposDeMaestra(env, maestraId) {
  if (!maestraId) {
    return json({ success: false, error: "Falta indicar la maestra." }, 400);
  }

  const todosLosGrupos = await listAll(env, TABLES.GRUPOS);
  const grupos = todosLosGrupos.filter((g) =>
    (g.fields["MAESTRA PRINCIPAL"] || []).includes(maestraId)
  );

  const nombreEstilo = (v) => (v && typeof v === "object" ? v.name : v || "");

  return json({
    success: true,
    grupos: grupos
      .map((g) => ({
        id: g.id,
        nombre: g.fields["NOMBRE DEL GRUPO"] || "Grupo",
        estilo: nombreEstilo(g.fields["ESTILO"]),
        totalAlumnas: (g.fields["ALUMNAS 2"] || []).length,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
  });
}

// -------------------------------------
// ACCIÓN: panelClase
// Todo lo que necesita el "Panel de Clase" para un grupo: la lista de
// alumnas (con su cumpleaños, para poder festejarlas), y quiénes de
// ellas YA marcaron asistencia HOY (biométrico/QR/código/manual) —
// para la pantalla de bienvenida que ve la maestra antes de empezar.
// -------------------------------------
async function panelClase(env, grupoId) {
  if (!grupoId) {
    return json({ success: false, error: "Falta indicar el grupo." }, 400);
  }

  const grupo = await airtableFetch(env, `${TABLES.GRUPOS}/${grupoId}`);
  const idsAlumnas = grupo.fields["ALUMNAS 2"] || [];

  if (!idsAlumnas.length) {
    const bitacoraVacio = await obtenerBitacoraGrupo(env, grupoId);
    return json({
      success: true,
      grupo: { id: grupoId, nombre: grupo.fields["NOMBRE DEL GRUPO"] || "Grupo" },
      alumnas: [],
      objetivoSemanal: bitacoraVacio.objetivoSemanal,
      objetivoMensual: bitacoraVacio.objetivoMensual,
      ultimaNota: bitacoraVacio.ultimaNota,
    });
  }

  const formula = "OR(" + idsAlumnas.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const alumnas = await listAll(
    env,
    TABLES.ALUMNAS,
    `?${qs({ filterByFormula: `AND(${formula}, {ESTADO}="ACTIVA")` })}`
  );

  // Asistencia de HOY (en la zona horaria de la base) — solo pedimos
  // los registros de hoy, en vez de traer todo el historial, para que
  // esto cargue rápido incluso con meses de datos acumulados.
  const asistenciaHoy = await listAll(
    env,
    TABLES.ASISTENCIA,
    `?${qs({ filterByFormula: `IS_SAME({FECHA ASISTENCIA}, TODAY(), "day")` })}`
  );

  const presentesHoy = new Set();
  asistenciaHoy.forEach((r) => {
    const f = r.fields || {};
    const estado = f["ESTADO"] && typeof f["ESTADO"] === "object" ? f["ESTADO"].name : f["ESTADO"];
    if (!estado || !estado.includes("Presente")) return;
    (f["ALUMNA"] || []).forEach((id) => presentesHoy.add(id));
  });

  const lista = alumnas
    .map((r) => ({
      id: r.id,
      nombre: r.fields["ALUMNA/O"] || "(Sin nombre)",
      cumpleanos: r.fields["CUMPLEAÑOS"] || "",
      presente: presentesHoy.has(r.id),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const bitacora = await obtenerBitacoraGrupo(env, grupoId);

  return json({
    success: true,
    grupo: { id: grupoId, nombre: grupo.fields["NOMBRE DEL GRUPO"] || "Grupo" },
    alumnas: lista,
    objetivoSemanal: bitacora.objetivoSemanal,
    objetivoMensual: bitacora.objetivoMensual,
    ultimaNota: bitacora.ultimaNota,
  });
}

// -------------------------------------
// BITÁCORA DE CLASE
// Cada maestra que da un grupo puede: (a) actualizar el objetivo
// técnico de la semana para ese grupo (queda igual hasta que alguien
// lo vuelva a cambiar), y (b) dejar una nota corta de qué se trabajó
// en cada clase, para que la próxima vez (ella u otra maestra que dé
// el mismo grupo) tenga continuidad en vez de empezar de cero.
// -------------------------------------

function esDelMesEnCurso(fechaValor) {
  if (!fechaValor) return false;
  const fecha = new Date(fechaValor);
  if (isNaN(fecha.getTime())) return false;
  const ahora = new Date();
  return fecha.getUTCFullYear() === ahora.getUTCFullYear() && fecha.getUTCMonth() === ahora.getUTCMonth();
}

async function obtenerBitacoraGrupo(env, grupoId) {
  const registros = await listAll(env, TABLES.BITACORA_CLASE);
  const delGrupo = registros
    .filter((r) => (r.fields["GRUPO"] || []).includes(grupoId))
    .sort((a, b) => new Date(b.fields["FECHA"] || b.createdTime) - new Date(a.fields["FECHA"] || a.createdTime));

  const conObjetivo = delGrupo.find((r) => (r.fields["OBJETIVO SEMANAL"] || "").toString().trim());
  const conNota = delGrupo.find((r) => (r.fields["NOTA DE CLASE"] || "").toString().trim());
  // El objetivo MENSUAL solo cuenta si es del mes en curso — igual que
  // se ve en el portal de alumnas, para que nunca se quede pegado un
  // objetivo de un mes anterior.
  const conObjetivoMensual = delGrupo.find(
    (r) =>
      (r.fields["OBJETIVO MENSUAL"] || "").toString().trim() &&
      esDelMesEnCurso(r.fields["FECHA"] || r.createdTime)
  );

  return {
    objetivoSemanal: conObjetivo ? (conObjetivo.fields["OBJETIVO SEMANAL"] || "").toString().trim() : "",
    objetivoMensual: conObjetivoMensual
      ? (conObjetivoMensual.fields["OBJETIVO MENSUAL"] || "").toString().trim()
      : "",
    ultimaNota: conNota
      ? {
          fecha: conNota.fields["FECHA"] || conNota.createdTime,
          nota: (conNota.fields["NOTA DE CLASE"] || "").toString().trim(),
        }
      : null,
  };
}

// -------------------------------------
// ACCIÓN: guardarBitacora
// Se llama desde el Cierre del Panel de Clase. El objetivo semanal,
// el objetivo mensual y la nota son los tres opcionales, pero se
// exige al menos uno de los tres (si no, no tiene sentido guardar el
// registro). El objetivo semanal solo lo ven las maestras en el
// Panel de Clase; el objetivo MENSUAL es el único que se muestra en
// el portal de alumnas/papás (ver obtenerObjetivosMensualesPortal).
// -------------------------------------
async function guardarBitacora(env, grupoId, maestraId, objetivoSemanal, notaClase, objetivoMensual) {
  if (!grupoId || !maestraId) {
    return json({ success: false, error: "Falta indicar el grupo o la maestra." }, 400);
  }

  const objetivoLimpio = (objetivoSemanal || "").toString().trim();
  const objetivoMensualLimpio = (objetivoMensual || "").toString().trim();
  const notaLimpia = (notaClase || "").toString().trim();

  if (!objetivoLimpio && !objetivoMensualLimpio && !notaLimpia) {
    return json(
      {
        success: false,
        error: "Escribe el objetivo de la semana, el del mes, o la nota de la clase antes de guardar.",
      },
      400
    );
  }

  const fields = {
    FECHA: new Date().toISOString(),
    GRUPO: [grupoId],
    MAESTRA: [maestraId],
  };
  if (objetivoLimpio) fields["OBJETIVO SEMANAL"] = objetivoLimpio;
  if (objetivoMensualLimpio) fields["OBJETIVO MENSUAL"] = objetivoMensualLimpio;
  if (notaLimpia) fields["NOTA DE CLASE"] = notaLimpia;

  await airtableFetch(env, TABLES.BITACORA_CLASE, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });

  return json({ success: true });
}

// ----------------------------------------
// ACCIÓN: maestrasActivas
// Lista de maestras activas para la pantalla de "olvidé mi clave"
// (buscar tu nombre). Solo devolvemos el nombre: nada sensible hasta
// que después mandemos la clave por WhatsApp a SU propio número.
// ----------------------------------------
async function getMaestrasActivas(env) {
  const maestras = await listAll(env, TABLES.MAESTRAS);
  const activas = maestras.filter((r) => (r.fields || {})["ACTIVA"] !== false);
  return {
    success: true,
    maestras: activas.map((r) => ({
      id: r.id,
      nombre: (r.fields || {})["MAESTRA"] || "(Sin nombre)",
    })),
  };
}

// ----------------------------------------
// ACCIÓN: maestraRecuperarClave
// Le reenvía a la maestra su CLAVE CHAT actual por WhatsApp (no la
// cambia, solo se la recuerda). Mismo patrón que recuperarClave de
// alumnas, pero leyendo MAESTRAS / CLAVE CHAT / WHATSAPP.
// ----------------------------------------
async function maestraRecuperarClave(env, maestraId) {
  if (!maestraId) {
    return json({ success: false, error: "Falta indicar la maestra." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.MAESTRAS}/${maestraId}`);
  const f = record.fields || {};

  const clave = (f["CLAVE CHAT"] || "").toString().trim();
  if (!clave) {
    return json(
      { success: false, error: "Todavía no tienes una clave asignada. Contacta a la academia." },
      400
    );
  }

  const telefonoRaw = f["WHATSAPP"] || "";
  const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
  if (!telefonoLimpio) {
    return json(
      {
        success: false,
        error: "No tenemos un WhatsApp registrado para enviarte tu clave. Contacta a la academia.",
      },
      400
    );
  }

  try {
    await enviarWhatsapp(
      env,
      telefonoLimpio,
      `Hola! 👋 Esta es tu clave para entrar al Chat de Maestras de MOVE Dance Academy: ${clave}`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el WhatsApp: " + e.message }, 500);
  }

  return json({ success: true, ultimosDigitos: telefonoLimpio.slice(-4) });
}

// ----------------------------------------
// ACCIÓN: maestraCambiarClave
// La maestra ya está dentro del chat (ya validó su clave actual para
// entrar); aquí la vuelve a confirmar por seguridad antes de guardar
// la nueva. Mismo patrón que cambiarClave de alumnas.
// ----------------------------------------
async function maestraCambiarClave(env, maestraId, claveActual, claveNueva) {
  if (!maestraId || !claveActual || !claveNueva) {
    return json({ success: false, error: "Completa todos los campos." }, 400);
  }
  const nuevaLimpia = claveNueva.toString().trim();
  if (nuevaLimpia.length < 6) {
    return json({ success: false, error: "Tu nueva clave debe tener al menos 6 caracteres." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.MAESTRAS}/${maestraId}`);
  const f = record.fields || {};
  const claveGuardada = (f["CLAVE CHAT"] || "").toString().trim();

  if (!claveGuardada || claveGuardada.toLowerCase() !== claveActual.toString().trim().toLowerCase()) {
    return json({ success: false, error: "Tu clave actual no es correcta." }, 401);
  }

  await airtableFetch(env, TABLES.MAESTRAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: maestraId, fields: { "CLAVE CHAT": nuevaLimpia } }],
      typecast: true,
    }),
  });

  return json({ success: true });
}

// -------------------------------------
// PÁGINA PÚBLICA "AGENDAR CLASE DE PRUEBA"
// -------------------------------------

// -------------------------------------
// ACCIÓN: horariosDisponibles
// Para que el selector de "clase" y "hora" de la página de clase de
// prueba SIEMPRE muestre las clases y horarios reales — leído en vivo
// de GRUPOS + HORARIOS, para no tener que editar código cada vez que
// cambie un horario en la academia.
// -------------------------------------
async function horariosDisponibles(env) {
  const grupos = await listAll(
    env,
    TABLES.GRUPOS,
    `?${qs({ filterByFormula: '{ESTADO}="ACTIVO"' })}`
  );
  const horarios = await listAll(env, TABLES.HORARIOS);

  // Algunos horarios ya traen el día metido dentro de INICIO/FIN
  // (ej. clases que se reúnen días distintos a horas distintas: "MARTES
  // 6:00 PM, VIERNES 5:30 PM") — en esos casos NO repetimos el campo
  // DIA para no duplicar el día en el texto final.
  const DIAS_REGEX = /(LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)/i;
  const DIAS_REGEX_GLOBAL = /(LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)/gi;
  // Números de día de JS: domingo=0 ... sábado=6 — así el formulario
  // puede exigir que la fecha elegida caiga justo en un día en que
  // esa clase se imparte.
  const DIAS_NUMERO = { DOMINGO: 0, LUNES: 1, MARTES: 2, MIERCOLES: 3, JUEVES: 4, VIERNES: 5, SABADO: 6 };

  function extraerDiasSemana(...textos) {
    const encontrados = new Set();
    textos.forEach((t) => {
      const sinAcentos = (t || "")
        .toString()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      const coincidencias = sinAcentos.match(DIAS_REGEX_GLOBAL) || [];
      coincidencias.forEach((dia) => {
        if (DIAS_NUMERO[dia] !== undefined) encontrados.add(DIAS_NUMERO[dia]);
      });
    });
    return [...encontrados].sort((a, b) => a - b);
  }

  const horariosPorGrupo = {};
  horarios.forEach((h) => {
    const f = h.fields || {};
    (f["GRUPO"] || []).forEach((id) => {
      if (!horariosPorGrupo[id]) horariosPorGrupo[id] = [];
      const dia = (f["DIA"] || "").toString().trim();
      const inicio = (f["INICIO"] || "").toString().trim();
      const fin = (f["FIN"] || "").toString().trim();
      if (!inicio && !fin) return;

      const yaTraeDia = DIAS_REGEX.test(inicio) || DIAS_REGEX.test(fin);
      const texto = yaTraeDia
        ? [inicio, fin].filter(Boolean).join(" – ")
        : [dia, [inicio, fin].filter(Boolean).join(" – ")].filter(Boolean).join(", ");

      const dias = extraerDiasSemana(dia, inicio, fin);

      if (texto) horariosPorGrupo[id].push({ texto, dias });
    });
  });

  const clases = grupos
    .map((g) => {
      const f = g.fields || {};
      const estiloRaw = f["ESTILO"];
      const estilo = estiloRaw && typeof estiloRaw === "object" ? estiloRaw.name : estiloRaw || "";
      return {
        grupo: (f["NOMBRE DEL GRUPO"] || "").toString().trim(),
        estilo,
        horarios: horariosPorGrupo[g.id] || [],
      };
    })
    // El grupo ELEVE es privado (solo alumnas seleccionadas) — nunca debe
    // ofrecerse como opción de clase de prueba pública.
    .filter((c) => !/\beleve\b/i.test(c.grupo))
    .filter((c) => c.estilo && c.grupo && c.horarios.length);

  return json({ success: true, clases });
}

// -------------------------------------
// ACCIÓN: agendarPrueba
// Crea el registro en PRUEBAS (misma tabla y vista "INGRESOS DE
// PRUEBAS" que ya usa la academia) y le manda un WhatsApp bonito de
// confirmación a la familia — el aviso de que se agendó, no una
// confirmación final (el staff la confirma o reagenda a mano).
// -------------------------------------
async function agendarPrueba(env, datos) {
  const alumna = (datos.alumna || "").toString().trim();
  const edad = (datos.edad || "").toString().trim();
  const telefonoRaw = (datos.telefono || "").toString();
  const fecha = (datos.fecha || "").toString().trim();
  const clase = (datos.clase || "").toString().trim();
  const hora = (datos.hora || "").toString().trim();

  if (!alumna || !edad || !fecha || !clase || !hora) {
    return json({ success: false, error: "Completa todos los campos." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return json({ success: false, error: "La fecha no tiene un formato válido." }, 400);
  }
  const telefonoLimpio = telefonoRaw.replace(/\D/g, "");
  if (telefonoLimpio.length < 8) {
    return json({ success: false, error: "Escribe un número de WhatsApp válido." }, 400);
  }
  // "web" = viene de la página pública (todavía puede cambiar de fecha,
  // se manda un mensaje avisando que la academia confirmará o reagendará).
  // "recepcion" = se llenó en Recepción, donde ya se validó con la
  // alumna que esa fecha/hora sí funciona, así que el mensaje es de
  // confirmación directa, sin condicionales.
  const origen = datos.origen === "recepcion" ? "recepcion" : "web";

  await airtableFetch(env, TABLES.PRUEBAS, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            ALUMNA: alumna,
            EDAD: edad,
            TELEFONO: telefonoLimpio,
            "FECHA CLASE PRUEBA": fecha,
            CLASE: clase,
            HORA: hora,
          },
        },
      ],
      typecast: true,
    }),
  });

  try {
    const [anio, mes, dia] = fecha.split("-").map(Number);
    const fechaTexto = `${dia} de ${MESES_ES[mes - 1]}`;

    const mensaje =
      origen === "recepcion"
        ? `¡Hola ${alumna}! 🎉✅ Tu Clase de Prueba en MOVE Dance Academy quedó CONFIRMADA.\n\n` +
          `📌 Clase: ${clase}\n🕐 Horario: ${hora}\n📅 Fecha: ${fechaTexto}\n\n` +
          `¡Te esperamos para que vivas la experiencia MOVE! 💃🕺`
        : `¡Hola ${alumna}! 🎉✨ Gracias por agendar tu Clase de Prueba en MOVE Dance Academy.\n\n` +
          `📌 Clase: ${clase}\n🕐 Horario: ${hora}\n📅 Fecha que elegiste: ${fechaTexto}\n\n` +
          `Nos vamos a comunicar contigo pronto para confirmarte la clase, o para reagendarte si ese día no nos es posible. ¡Te esperamos para que vivas la experiencia MOVE! 💃🕺`;

    await enviarWhatsapp(env, telefonoLimpio, mensaje);
  } catch (e) {
    // No interrumpe el registro aunque falle el WhatsApp de confirmación.
    console.error("No se pudo enviar el WhatsApp de confirmación de prueba:", e.message);
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: crearInscripcion
// Crea una nueva alumna a partir de la Ficha de Inscripción pública
// (reemplaza el formulario de Fillout, escribe en la misma tabla
// ALUMNAS). Si viene una foto, se sube DESPUÉS de crear el registro,
// igual que subirComprobante — y si falla la subida de la foto, no
// se bloquea la inscripción (la alumna ya quedó registrada).
// -------------------------------------
async function crearInscripcion(env, datos) {
  const alumna = (datos.alumna || "").toString().trim();
  const edad = (datos.edad || "").toString().trim();
  const cumpleanos = (datos.cumpleanos || "").toString().trim();
  const whatsappRaw = (datos.whatsapp || "").toString();
  const correo = (datos.correo || "").toString().trim();
  const nit = (datos.nit || "").toString().trim();
  const nombrePadre = (datos.nombrePadre || "").toString().trim();
  const contactoEmergencia = (datos.contactoEmergencia || "").toString().trim();
  const numeroEmergencia = (datos.numeroEmergencia || "").toString().trim();
  const condicionMedica = (datos.condicionMedica || "").toString().trim();
  const aceptoPoliticas = (datos.aceptoPoliticas || "").toString().trim().toUpperCase();
  const aceptoShow = (datos.aceptoShow || "").toString().trim().toUpperCase();

  if (
    !alumna ||
    !edad ||
    !cumpleanos ||
    !whatsappRaw ||
    !contactoEmergencia ||
    !numeroEmergencia
  ) {
    return json({ success: false, error: "Completa todos los campos obligatorios." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cumpleanos)) {
    return json({ success: false, error: "La fecha de cumpleaños no tiene un formato válido." }, 400);
  }
  const whatsappLimpio = whatsappRaw.replace(/\D/g, "");
  if (whatsappLimpio.length < 8) {
    return json({ success: false, error: "Escribe un número de WhatsApp válido." }, 400);
  }
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return json({ success: false, error: "Ese correo no tiene un formato válido." }, 400);
  }
  if (aceptoPoliticas !== "SI") {
    return json(
      { success: false, error: "Debes aceptar las Políticas de Ingreso a la Academia para continuar." },
      400
    );
  }

  const fechaInscripcion = new Date().toISOString().slice(0, 10);

  const fields = {
    "FECHA INSCRIPCION": fechaInscripcion,
    "ALUMNA/O": alumna,
    EDAD: edad,
    "CUMPLEAÑOS": cumpleanos,
    WHATSAPP: whatsappLimpio,
    "CONTACTO DE EMERGENCIA": contactoEmergencia,
    "NÚMERO CONTACTO DE EMERGENCIA": numeroEmergencia,
    ESTADO: "ACTIVA",
    "ACEPTO LAS POLITICAS DE INGRESO A LA ACADEMIA": "SI",
  };
  // "Nombre de un padre" solo aplica a la ficha de menores de edad —
  // en la ficha de adultos ese campo ni siquiera se pregunta.
  if (nombrePadre) fields["NOMBRE DE UN PADRE"] = nombrePadre;
  if (correo) fields.CORREO = correo;
  if (nit) fields.NIT = nit;
  if (condicionMedica) fields["CONDICION MEDICA O ALERGIAS"] = condicionMedica;
  if (aceptoShow === "SI" || aceptoShow === "NO") {
    fields[CAMPO_AUTORIZO_SHOW] = aceptoShow;
  }

  const resp = await airtableFetch(env, TABLES.ALUMNAS, {
    method: "POST",
    body: JSON.stringify({
      records: [{ fields }],
      typecast: true,
    }),
  });

  const nuevaAlumnaId = resp?.records?.[0]?.id;

  if (nuevaAlumnaId && datos.fotoBase64) {
    try {
      const res = await fetch(
        `https://content.airtable.com/v0/${BASE_ID}/${nuevaAlumnaId}/${CAMPO_FOTO_ALUMNA_ID}/uploadAttachment`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contentType: datos.fotoTipo || "application/octet-stream",
            filename: datos.fotoNombre || "foto-alumna",
            file: datos.fotoBase64,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(
          "No se pudo subir la foto de la nueva alumna:",
          data?.error?.message || data?.error || res.status
        );
      }
    } catch (e) {
      // No interrumpe la inscripción aunque falle la subida de la foto.
      console.error("No se pudo subir la foto de la nueva alumna:", e.message);
    }
  }

  return json({ success: true, alumnaId: nuevaAlumnaId });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Los webhooks de la cuenta nueva de Paggo (Pagos Especiales) no
    // vienen en el formato { accion, ... } de este Worker — Paggo
    // define su propio formato — así que se atienden aparte, por
    // pathname, antes del enrutador de siempre.
    const url = new URL(request.url);
    if (url.pathname === "/webhook-paggo-especiales") {
      return await webhookPagoEspeciales(request, env, url);
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Método no permitido" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ success: false, error: "JSON inválido" }, 400);
    }

    try {
      if (body.accion === "alumnas") {
        return json(await getAlumnas(env));
      }
      if (body.accion === "entrar") {
        return await entrar(env, body.alumnaId, body.clave);
      }
      if (body.accion === "entrarFamilia") {
        return await entrarFamilia(env, body.claveFamiliar);
      }
      if (body.accion === "generarLink") {
        return await generarLink(env, body.pagoId);
      }
      if (body.accion === "generarLinkEspecial") {
        return await generarLinkEspecial(env, body.pagoEspecialId, body.monto);
      }
      if (body.accion === "subirComprobante") {
        return await subirComprobante(env, body.pagoId, body.archivoBase64, body.nombreArchivo, body.tipoArchivo);
      }
      if (body.accion === "subirComprobantePagoEspecial") {
        return await subirComprobantePagoEspecial(
          env,
          body.pagoEspecialId,
          body.archivoBase64,
          body.nombreArchivo,
          body.tipoArchivo
        );
      }
      if (body.accion === "evaluaciones") {
        return await getEvaluaciones(env, body.alumnaId);
      }
      if (body.accion === "recuperarClave") {
        return await recuperarClave(env, body.alumnaId);
      }
      if (body.accion === "recuperarClavePorCorreo") {
        return await recuperarClavePorCorreo(env, body.alumnaId, body.correo);
      }
      if (body.accion === "recuperarClaveFamiliar") {
        return await recuperarClaveFamiliar(env, body.alumnaId);
      }
      if (body.accion === "recuperarClaveFamiliarPorCorreo") {
        return await recuperarClaveFamiliarPorCorreo(env, body.alumnaId, body.correo);
      }
      if (body.accion === "cambiarClave") {
        return await cambiarClave(env, body.alumnaId, body.claveActual, body.claveNueva);
      }
      if (body.accion === "cambiarClaveFamiliar") {
        return await cambiarClaveFamiliar(env, body.familiaId, body.claveActual, body.claveNueva);
      }
      if (body.accion === "agregarHermanaAFamilia") {
        return await agregarHermanaAFamilia(env, body);
      }
      if (body.accion === "historialPagos") {
        return await getHistorialPagos(env, body.alumnaId);
      }
      if (body.accion === "actualizarCumpleanos") {
        return await actualizarCumpleanos(env, body.alumnaId, body.nuevaFecha);
      }
      if (body.accion === "actualizarCorreo") {
        return await actualizarCorreo(env, body.alumnaId, body.nuevoCorreo);
      }
      if (body.accion === "actualizarParticipacionShow") {
        return await actualizarParticipacionShow(env, body.alumnaId, body.valor);
      }
      if (body.accion === "maestrasDeAlumna") {
        return await maestrasDeAlumna(env, body.alumnaId);
      }
      if (body.accion === "gruposDeMaestra") {
        return await gruposDeMaestra(env, body.maestraId);
      }
      if (body.accion === "panelClase") {
        return await panelClase(env, body.grupoId);
      }
      if (body.accion === "guardarBitacora") {
        return await guardarBitacora(
          env,
          body.grupoId,
          body.maestraId,
          body.objetivoSemanal,
          body.notaClase,
          body.objetivoMensual
        );
      }
      if (body.accion === "chatObtener") {
        return await chatObtener(env, body.alumnaId, body.quien, body.maestraId);
      }
      if (body.accion === "chatEnviar") {
        return await chatEnviar(env, body.alumnaId, body.quien, body.autor, body.texto, body.maestraId);
      }
      if (body.accion === "maestraEntrar") {
        return await maestraEntrar(env, body.clave);
      }
      if (body.accion === "maestraListaAlumnas") {
        return await maestraListaAlumnas(env, body.maestraId);
      }
      if (body.accion === "maestrasActivas") {
        return json(await getMaestrasActivas(env));
      }
      if (body.accion === "maestraRecuperarClave") {
        return await maestraRecuperarClave(env, body.maestraId);
      }
      if (body.accion === "maestraCambiarClave") {
        return await maestraCambiarClave(env, body.maestraId, body.claveActual, body.claveNueva);
      }
      if (body.accion === "horariosDisponibles") {
        return await horariosDisponibles(env);
      }
      if (body.accion === "agendarPrueba") {
        return await agendarPrueba(env, body);
      }
      if (body.accion === "crearInscripcion") {
        return await crearInscripcion(env, body);
      }
      return json({ success: false, error: "Acción desconocida" }, 400);
    } catch (e) {
      console.error(e);
      return json({ success: false, error: e.message || "Error interno" }, 500);
    }
  },
};
