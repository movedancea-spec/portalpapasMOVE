// ==========================================
// MOVE — MIS EVALUACIONES (lo que las alumnas dicen de la maestra)
// MOVE Dance Academy
// ==========================================
// La maestra ve SOLO sus evaluaciones y de forma ANÓNIMA: el Worker
// (maestraEvaluacionesRecibidas) nunca manda el nombre de la alumna ni
// la fecha exacta, y desordena las evaluaciones dentro de cada ronda.
// Reusa la sesión compartida (sesionmaestra.js), igual que aviso.js.

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

const CRITERIOS_MIS_EVAL = [
  ["puntualidad", "Puntualidad"],
  ["explicaClaro", "Explica claro"],
  ["paciencia", "Paciencia"],
  ["motiva", "Motiva"],
  ["ambiente", "Ambiente de la clase"],
  ["atencionIndividual", "Atención individual"],
  ["organizacionTiempo", "Organización del tiempo"],
  ["disciplina", "Disciplina y control del grupo"],
];

const CARITA_POR_VALOR = { 1: "😞", 3: "😐", 5: "😊" };

function el(id) {
  return document.getElementById(id);
}

function mostrarPantalla(id) {
  ["pantallaLogin", "pantallaEvaluaciones"].forEach((p) => {
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

function promedio(numeros) {
  if (!numeros.length) return 0;
  return numeros.reduce((a, b) => a + b, 0) / numeros.length;
}

function crear(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined) n.textContent = texto;
  return n;
}

function renderEvaluaciones(evaluaciones) {
  const cont = el("listaEvaluaciones");
  cont.innerHTML = "";

  if (!evaluaciones.length) {
    cont.appendChild(crear("p", "lista-vacia", "Todavía no has recibido evaluaciones."));
    return;
  }

  const rondas = [...new Set(evaluaciones.map((e) => e.ronda))].sort((a, b) => b - a);
  rondas.forEach((ronda) => {
    const deRonda = evaluaciones.filter((e) => e.ronda === ronda);

    cont.appendChild(crear("p", "mis-eval-ronda", "Ronda " + ronda));
    cont.appendChild(
      crear(
        "p",
        "mis-eval-resumen",
        `${deRonda.length} evaluación${deRonda.length === 1 ? "" : "es"} · Calificación general promedio: ★ ${promedio(
          deRonda.map((e) => e.general)
        ).toFixed(1)} / 5`
      )
    );

    // Promedio por criterio (caritas: 1 mal, 3 regular, 5 bien).
    const prom = crear("div", "mis-eval-promedios");
    CRITERIOS_MIS_EVAL.forEach(([k, etiqueta]) => {
      const p = promedio(deRonda.map((e) => e.criterios[k]));
      const fila = crear("div", "mis-eval-prom-fila");
      fila.appendChild(crear("span", "mis-eval-prom-nombre", etiqueta));
      const barra = crear("span", "mis-eval-barra");
      const relleno = crear("span", "mis-eval-barra-relleno");
      relleno.style.width = Math.round((p / 5) * 100) + "%";
      barra.appendChild(relleno);
      fila.append(barra, crear("span", "mis-eval-prom-valor", p.toFixed(1)));
      prom.appendChild(fila);
    });
    cont.appendChild(prom);

    deRonda.forEach((ev) => {
      const t = crear("div", "mis-eval-tarjeta");
      const cab = crear("div", "mis-eval-cabecera");
      cab.appendChild(crear("span", "mis-eval-estrellas", "★".repeat(ev.general) + "☆".repeat(5 - ev.general)));
      if (ev.grupo) cab.appendChild(crear("span", "mis-eval-grupo", ev.grupo));
      t.appendChild(cab);
      t.appendChild(
        crear(
          "p",
          "mis-eval-criterios",
          CRITERIOS_MIS_EVAL.map(([k, etiqueta]) => `${etiqueta} ${CARITA_POR_VALOR[ev.criterios[k]] || "—"}`).join(" · ")
        )
      );
      if (ev.comentario) t.appendChild(crear("p", "mis-eval-comentario", "“" + ev.comentario + "”"));
      cont.appendChild(t);
    });
  });
}

async function cargarMisEvaluaciones(clave, esAuto) {
  const boton = el("btnEntrarMaestra");
  const mensajeError = el("mensajeErrorLogin");
  if (!esAuto) {
    mensajeError.textContent = "";
    boton.disabled = true;
  }
  try {
    const datos = await llamarWorker({ accion: "maestraEvaluacionesRecibidas", clave });
    const sesion = leerSesionMaestraCompartida();
    if (!sesion || sesion.clave !== clave) {
      // Solo hay clave: pedimos el id/nombre al login normal para dejar la sesión compartida.
      const login = await llamarWorker({ accion: "maestraEntrar", clave });
      guardarSesionMaestraCompartida(clave, login.maestraId, login.nombre || datos.nombre);
    }
    el("tituloMaestra").textContent = "⭐ " + (datos.nombre || "Mis evaluaciones");
    renderEvaluaciones(datos.evaluaciones || []);
    mostrarPantalla("pantallaEvaluaciones");
  } catch (e) {
    if (esAuto) {
      borrarSesionMaestraCompartida();
    } else {
      mensajeError.textContent = e.message;
    }
  } finally {
    if (!esAuto) boton.disabled = false;
  }
}

el("btnEntrarMaestra").addEventListener("click", () => {
  const clave = el("inputClaveMaestra").value.trim();
  if (!clave) {
    el("mensajeErrorLogin").textContent = "Escribe tu clave.";
    return;
  }
  cargarMisEvaluaciones(clave, false);
});
el("inputClaveMaestra").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("btnEntrarMaestra").click();
});

// ---------- arranque ----------
(function iniciar() {
  const sesion = leerSesionMaestraCompartida();
  if (sesion && sesion.clave) cargarMisEvaluaciones(sesion.clave, true);
})();
