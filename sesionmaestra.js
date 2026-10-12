// ==========================================
// MOVE — SESIÓN COMPARTIDA DE MAESTRAS
// MOVE Dance Academy
// ==========================================
// Permite que una maestra escriba su clave UNA sola vez (por ejemplo en el
// Portal de Maestras) y que el resto de pantallas (Chat de Maestras, Panel
// de Clase, Avisos...) la reconozcan automáticamente sin volver a pedirle
// la clave — así puede tener el portal instalado en su celular como una
// app real, sin iniciar sesión cada vez que entra a una sección distinta.
//
// Se guarda en localStorage (no sessionStorage) para que la sesión
// sobreviva aunque cierre la app y la vuelva a abrir horas o días después.
// Si el navegador no deja usar localStorage, se guarda solo en memoria
// (esa pantalla funciona, pero no se comparte con las demás).
//
// Token de sesión (desde el 2026-10-11): maestraEntrar ya no devuelve el
// ID de la maestra, sino un token firmado por el Worker que vence en
// unas horas. Las acciones de maestra se mandan con
// llamarWorkerComoMaestra(payload), que agrega el token y, si venció, pide
// otro solo con la clave guardada (la maestra no lo nota). Si la clave
// ya no sirve (la cambió desde otra pantalla o la desactivaron), se borra
// la sesión y la pantalla vuelve a pedir la clave.
// Las sesiones viejas guardadas con { clave, maestraId } siguen sirviendo
// porque tienen la clave; el maestraId ya no se usa para nada.

const CLAVE_SESION_MAESTRA_COMPARTIDA = "moveMaestraSesion";
const WORKER_SESION_MAESTRA = "https://portalalumnas.movedancea.workers.dev";

let sesionMaestraEnMemoria = null;

function guardarSesionMaestraCompartida(clave, nombre, token) {
  sesionMaestraEnMemoria = { clave, nombre, token: token || "" };
  try {
    localStorage.setItem(CLAVE_SESION_MAESTRA_COMPARTIDA, JSON.stringify(sesionMaestraEnMemoria));
  } catch (e) {
    // Si el navegador bloquea localStorage (modo incógnito, permisos, etc.)
    // la sesión queda solo en memoria de esta pantalla.
  }
}

function leerSesionMaestraCompartida() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_SESION_MAESTRA_COMPARTIDA) || "null");
    if (datos && datos.clave) return datos;
  } catch (e) {
    // ignorar — se usa lo que haya en memoria
  }
  return sesionMaestraEnMemoria;
}

function borrarSesionMaestraCompartida() {
  sesionMaestraEnMemoria = null;
  try {
    localStorage.removeItem(CLAVE_SESION_MAESTRA_COMPARTIDA);
  } catch (e) {
    // ignorar
  }
}

// El token es "datos.firma"; la página solo lee cuándo vence (no puede
// ni necesita revisar la firma: eso lo hace el Worker).
function tokenMaestraVigente(token) {
  try {
    const cuerpo = String(token || "").split(".")[0];
    const datos = JSON.parse(atob(cuerpo.replace(/-/g, "+").replace(/_/g, "/")));
    return datos.e * 1000 - Date.now() > 5 * 60 * 1000;
  } catch (e) {
    return false;
  }
}

function errorSesionMaestra(mensaje, status) {
  const error = new Error(mensaje);
  error.status = status;
  error.sesionVencida = true;
  return error;
}

async function obtenerTokenMaestra(forzarNuevo) {
  const sesion = leerSesionMaestraCompartida();
  if (!sesion || !sesion.clave) throw errorSesionMaestra("Escribe tu clave de maestra para continuar.", 401);
  if (!forzarNuevo && tokenMaestraVigente(sesion.token)) return sesion.token;

  const resp = await fetch(WORKER_SESION_MAESTRA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "maestraEntrar", clave: sesion.clave }),
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || !datos.success || !datos.token) {
    if (resp.status === 401) {
      borrarSesionMaestraCompartida();
      throw errorSesionMaestra("Tu clave cambió. Escríbela de nuevo.", 401);
    }
    throw new Error(datos.error || "No se pudo confirmar tu sesión. Intenta de nuevo.");
  }
  guardarSesionMaestraCompartida(sesion.clave, datos.nombre || sesion.nombre, datos.token);
  return datos.token;
}

// Llama al Worker como la maestra que inició sesión. Devuelve los datos
// si success; si no, lanza un Error con .status y .datos.
async function llamarWorkerComoMaestra(payload) {
  for (let intento = 0; intento < 2; intento++) {
    const token = await obtenerTokenMaestra(intento > 0);
    const resp = await fetch(WORKER_SESION_MAESTRA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, token }),
    });
    const datos = await resp.json().catch(() => ({}));
    // Token vencido o de una clave vieja: se pide otro una sola vez.
    if (resp.status === 401 && datos.sesionVencida && intento === 0) continue;
    if (!resp.ok || !datos.success) {
      const error = new Error(datos.error || "Ocurrió un error. Intenta de nuevo.");
      error.status = resp.status;
      error.datos = datos;
      throw error;
    }
    return datos;
  }
}
