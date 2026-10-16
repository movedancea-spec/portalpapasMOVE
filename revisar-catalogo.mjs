// Revisa catalogo.json (lo corre el GitHub Action "Revisar catálogo" en
// cada push que lo toca; también se puede correr a mano con
// `node revisar-catalogo.mjs`). Si encuentra un error, dice cuál y en
// qué sección/clase, y el Action queda en rojo (GitHub manda un correo).
// Mismas reglas que catalogo.html (catalogoValido) y el Worker del quiz
// (problemaCatalogoPublico), más las del quiz de pasillos.
import fs from "node:fs";

const ESTILOS_QUIZ = new Set(["Pre Danza", "Ballet", "Jazz", "Acro", "Urbanos", "Contemporáneo", "Ballroom", "Salsa", "Bachata", "Salsa y Bachata"]);
const SIN_QUIZ = new Set(["waltz", "coreografia-especial"]);
const errores = [];
const error = (m) => errores.push(m);

let texto;
try {
  texto = fs.readFileSync(new URL("./catalogo.json", import.meta.url), "utf8");
} catch (e) {
  console.error("❌ No se encontró catalogo.json");
  process.exit(1);
}
let datos;
try {
  datos = JSON.parse(texto);
} catch (e) {
  // El mensaje de JSON trae la posición; se traduce a línea para encontrarlo fácil.
  const pos = Number((/position (\d+)/.exec(e.message) || [])[1]);
  const linea = Number.isFinite(pos) ? texto.slice(0, pos).split("\n").length : "?";
  console.error(`❌ catalogo.json está mal escrito cerca de la línea ${linea}: ${e.message}`);
  console.error("   (revisa comas, comillas y llaves; por ejemplo una coma de más antes de ] o })");
  process.exit(1);
}

const esTexto = (v) => typeof v === "string";
if (!Array.isArray(datos.grupos) || !datos.grupos.length) error("Faltan las secciones (\"grupos\").");
if (!Array.isArray(datos.rangosEdad) || !datos.rangosEdad.length) error("Faltan los rangos de edad (\"rangosEdad\").");
const ids = new Set();
for (const g of datos.grupos || []) {
  const donde = `sección "${g.id || g.chip || "?"}"`;
  if (!esTexto(g.id) || !g.id) error(`${donde}: falta "id".`);
  if (ids.has(g.id)) error(`${donde}: el "id" está repetido.`);
  ids.add(g.id);
  if (!esTexto(g.chip) || !g.chip) error(`${donde}: falta "chip" (el texto del botón).`);
  if (!esTexto(g.titulo)) error(`${donde}: falta "titulo".`);
  if (!Array.isArray(g.clases) || !g.clases.length) { error(`${donde}: no tiene clases.`); continue; }
  for (const c of g.clases) {
    const dc = `${donde}, clase "${c.nombre || "?"}"`;
    if (!esTexto(c.nombre) || !c.nombre) error(`${dc}: falta "nombre".`);
    if (!Array.isArray(c.horarios) || !c.horarios.every(esTexto)) error(`${dc}: "horarios" debe ser una lista de textos.`);
    if (!Array.isArray(c.precios) || !c.precios.length) error(`${dc}: faltan los precios.`);
    else c.precios.forEach((p) => {
      if (!p || !esTexto(p.label) || !esTexto(p.valor)) error(`${dc}: un precio no tiene "label" y "valor".`);
      else if (!/^Q[\d,]+(\.\d{2})?$/.test(p.valor)) error(`${dc}: el precio "${p.valor}" debe escribirse así: Q575 o Q2,810.`);
    });
    if (c.inscripcion && !/^Q[\d,]+(\.\d{2})?$/.test(c.inscripcion)) error(`${dc}: la inscripción "${c.inscripcion}" debe escribirse así: Q275.`);
    if (!SIN_QUIZ.has(g.id) && !ESTILOS_QUIZ.has(c.estilo)) error(`${dc}: "estilo" debe ser uno de: ${[...ESTILOS_QUIZ].join(", ")}.`);
  }
}
for (const r of datos.rangosEdad || []) {
  if (!r || !esTexto(r.id) || !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min > r.max) error(`Rango de edad mal escrito: ${JSON.stringify(r)}`);
  else if (!ids.has(r.id)) error(`El rango de edad "${r.id}" no tiene sección con ese mismo "id".`);
}
const q = datos.quizPasillos || {};
if (q.activoHasta !== undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(q.activoHasta));
  const fecha = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || fecha.getUTCMonth() !== +m[2] - 1 || fecha.getUTCDate() !== +m[3]) error(`quizPasillos.activoHasta "${q.activoHasta}" debe ser una fecha real escrita AAAA-MM-DD (ej. 2026-10-19).`);
}
if (q.promo !== undefined && !esTexto(q.promo)) error("quizPasillos.promo debe ser un texto (vacío \"\" para no mostrar promo).");
// Ruleta de premios: si este bloque queda mal, el Worker apaga la ruleta
// o usa sus valores de respaldo (el quiz y catalogo.html no lo leen).
const ru = datos.ruleta;
if (ru !== undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ru.activoHasta || ""));
  const fecha = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || fecha.getUTCMonth() !== +m[2] - 1 || fecha.getUTCDate() !== +m[3]) error(`ruleta.activoHasta "${ru.activoHasta}" debe ser una fecha real escrita AAAA-MM-DD (ej. 2026-10-19).`);
  if (ru.condiciones !== undefined && !esTexto(ru.condiciones)) error("ruleta.condiciones debe ser un texto.");
  const pr = ru.probabilidades || {};
  for (const k of ["semana", "mensualidad", "claseExtra", "camp", "inscripcion", "giraDeNuevo"]) {
    if (!Number.isFinite(pr[k]) || pr[k] < 0) error(`ruleta.probabilidades.${k} debe ser un número (0 o más).`);
  }
  if (Number.isFinite(pr.giraDeNuevo) && pr.giraDeNuevo > 90) error("ruleta.probabilidades.giraDeNuevo no puede pasar de 90.");
}

if (errores.length) {
  console.error(`❌ catalogo.json tiene ${errores.length} problema(s):`);
  errores.forEach((e) => console.error("   • " + e));
  process.exit(1);
}
const clases = datos.grupos.reduce((n, g) => n + g.clases.length, 0);
console.log(`✅ catalogo.json está bien: ${datos.grupos.length} secciones, ${clases} clases. Quiz hasta ${q.activoHasta || "(sin fecha)"}, promo: ${q.promo ? `"${q.promo}"` : "(vacía)"}.${ru ? ` Ruleta hasta ${ru.activoHasta}.` : ""}`);
