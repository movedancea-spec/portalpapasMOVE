// ==========================================
// MOVE — SESIÓN COMPARTIDA DE MAESTRAS
// MOVE Dance Academy
// ==========================================
// Permite que una maestra escriba su clave UNA sola vez (por ejemplo en el
// Portal de Maestras) y que el resto de pantallas (Chat de Maestras, Panel
// de Clase) la reconozcan automáticamente sin volver a pedirle la clave —
// así puede tener el portal instalado en su celular como una app real, sin
// iniciar sesión cada vez que entra a una sección distinta.
//
// Se guarda en localStorage (no sessionStorage) para que la sesión
// sobreviva aunque cierre la app y la vuelva a abrir horas o días después.
// Nunca se guarda nada más sensible que la clave que ella misma escribió —
// es la misma clave que ya viaja al Worker en cada pantalla individual.
//
// No existe un "token" de sesión real del lado del Worker (maestraEntrar es
// una simple búsqueda de la clave en la tabla MAESTRAS), así que cada
// pantalla que recupera esta sesión guardada la vuelve a validar contra el
// Worker antes de usarla. Si la clave ya no es válida (la cambió desde otra
// pantalla, o la desactivaron), la sesión guardada simplemente se borra y
// esa pantalla vuelve a mostrar su login normal — no se queda trabada.

const CLAVE_SESION_MAESTRA_COMPARTIDA = "moveMaestraSesion";

function guardarSesionMaestraCompartida(clave, maestraId, nombre) {
  try {
    localStorage.setItem(
      CLAVE_SESION_MAESTRA_COMPARTIDA,
      JSON.stringify({ clave, maestraId, nombre })
    );
  } catch (e) {
    // Si el navegador bloquea localStorage (modo incógnito, permisos, etc.)
    // simplemente no se comparte la sesión entre pantallas — cada una
    // seguirá pidiendo su propia clave, sin romper nada.
  }
}

function leerSesionMaestraCompartida() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_SESION_MAESTRA_COMPARTIDA) || "null");
    if (datos && datos.clave) return datos;
  } catch (e) {
    // ignorar — se comporta como si no hubiera sesión guardada
  }
  return null;
}

function borrarSesionMaestraCompartida() {
  try {
    localStorage.removeItem(CLAVE_SESION_MAESTRA_COMPARTIDA);
  } catch (e) {
    // ignorar
  }
}
