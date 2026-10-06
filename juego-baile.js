// ==========================================
// MOVE — MINI JUEGO "COPIA LA COREOGRAFÍA"
// MOVE Dance Academy
// ==========================================
// Estilo Simón dice: el juego ilumina una secuencia de pasos de baile
// (cada uno con su color y su sonido) y la alumna la repite tocando
// los botones. Cada ronda correcta agrega un paso nuevo.
//
// Todo pasa en el navegador: no lee ni guarda nada en Airtable. El
// récord personal vive solo en este dispositivo (localStorage). Los
// sonidos se generan con Web Audio API, sin archivos externos.
//
// Solo se abre si el portal está Activo: antes de abrir (y antes de
// cada partida nueva) se le pregunta al Worker con "portalDisponible",
// que está bloqueada en modo mantenimiento igual que el resto de las
// acciones del portal. Si está cerrado, llamarWorker (portal.js) ya
// muestra la pantalla de aviso y el juego no se abre.
//
// Depende de llamarWorker() de portal.js, que se carga antes.
// ==========================================

(function () {
  const PASOS = [
    { id: "plie", emoji: "👟", nombre: "Plié", color: "#ff5fa8", frecuencia: 329.63 },
    { id: "releve", emoji: "⬆️", nombre: "Relevé", color: "#9b6bff", frecuencia: 392.0 },
    { id: "giro", emoji: "🔄", nombre: "Giro", color: "#1fb8a8", frecuencia: 523.25 },
    { id: "jazz", emoji: "✨", nombre: "Jazz hands", color: "#ef8a17", frecuencia: 659.25 },
  ];

  const LLAVE_RECORD = "move_juego_coreografia_record";

  // Mensaje final según cuántos pasos logró repetir.
  const MENSAJES_FINALES = [
    { desde: 0, texto: "¡Todas empezamos por el primer paso! Inténtalo otra vez 💕" },
    { desde: 1, texto: "¡Buen calentamiento! Tu memoria de bailarina ya está despertando 🌸" },
    { desde: 4, texto: "¡Qué bien! Ya te sabes una coreografía cortita 💃" },
    { desde: 7, texto: "¡Wow! Tienes memoria de escenario ✨" },
    { desde: 10, texto: "¡Eres una estrella de MOVE! 🌟 Ni la maestra te gana" },
  ];

  let secuencia = [];
  let posicion = 0;
  let turnoAlumna = false;
  let temporizadores = [];
  let audioCtx = null;
  let modal = null;

  // ---------- récord (localStorage puede estar bloqueado) ----------
  function leerRecord() {
    try {
      return Number(localStorage.getItem(LLAVE_RECORD)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function guardarRecord(valor) {
    try {
      localStorage.setItem(LLAVE_RECORD, String(valor));
    } catch (e) {}
  }

  // ---------- sonido ----------
  // El AudioContext se crea con el primer toque: los navegadores de
  // celular (sobre todo iPhone) no dejan sonar nada antes de eso.
  function asegurarAudio() {
    if (!audioCtx) {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto) return null;
      audioCtx = new Contexto();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tocarTono(frecuencia, duracionMs, tipo) {
    const ctx = asegurarAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const volumen = ctx.createGain();
    osc.type = tipo || "triangle";
    osc.frequency.value = frecuencia;
    const ahora = ctx.currentTime;
    const fin = ahora + duracionMs / 1000;
    volumen.gain.setValueAtTime(0.0001, ahora);
    volumen.gain.exponentialRampToValueAtTime(0.25, ahora + 0.02);
    volumen.gain.exponentialRampToValueAtTime(0.0001, fin);
    osc.connect(volumen).connect(ctx.destination);
    osc.start(ahora);
    osc.stop(fin + 0.02);
  }

  function sonidoError() {
    tocarTono(160, 380, "sawtooth");
  }

  // ---------- temporizadores (se cancelan al cerrar) ----------
  function esperar(ms, fn) {
    temporizadores.push(setTimeout(fn, ms));
  }

  function cancelarTemporizadores() {
    temporizadores.forEach(clearTimeout);
    temporizadores = [];
    // Un paso que estaba encendido ya no se va a apagar solo.
    if (modal) botonesPasos().forEach((b) => b.classList.remove("iluminado"));
  }

  // ---------- interfaz ----------
  function q(selector) {
    return modal.querySelector(selector);
  }

  function construirModal() {
    modal = document.createElement("div");
    modal.id = "juegoBaile";
    modal.className = "juego-baile";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "juegoBaileTitulo");
    modal.innerHTML = `
      <div class="juego-baile-caja">
        <button class="juego-baile-cerrar" type="button" aria-label="Cerrar el juego">✕</button>
        <p class="juego-baile-marca">MOVE DANCE ACADEMY</p>
        <h2 class="juego-baile-titulo" id="juegoBaileTitulo">💃 Copia la coreografía</h2>
        <div class="juego-baile-marcador">
          <span>Pasos: <strong class="juego-baile-puntos">0</strong></span>
          <span>🏆 Récord: <strong class="juego-baile-record">0</strong></span>
        </div>
        <p class="juego-baile-estado" aria-live="polite"></p>
        <div class="juego-baile-pasos"></div>
        <div class="juego-baile-final" hidden>
          <p class="juego-baile-final-puntos"></p>
          <p class="juego-baile-final-mensaje"></p>
          <p class="juego-baile-final-record" hidden>🏆 ¡Nuevo récord personal!</p>
        </div>
        <button class="btn-grande btn-siguiente juego-baile-empezar" type="button">▶️ ¡Empezar!</button>
      </div>`;

    const cont = q(".juego-baile-pasos");
    PASOS.forEach((paso, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "juego-baile-paso";
      btn.style.setProperty("--color-paso", paso.color);
      btn.dataset.indice = String(i);
      btn.setAttribute("aria-label", paso.nombre);
      btn.innerHTML = `<span class="juego-baile-paso-emoji" aria-hidden="true">${paso.emoji}</span><span class="juego-baile-paso-nombre">${paso.nombre}</span>`;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        tocarPaso(i);
      });
      // Teclado (Enter/Espacio) para quien no usa pantalla táctil.
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          tocarPaso(i);
        }
      });
      cont.appendChild(btn);
    });

    q(".juego-baile-cerrar").addEventListener("click", cerrarJuego);
    q(".juego-baile-empezar").addEventListener("click", empezarPartidaSiDisponible);
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cerrarJuego();
    });
    document.body.appendChild(modal);
  }

  function botonesPasos() {
    return modal.querySelectorAll(".juego-baile-paso");
  }

  function habilitarPasos(habilitar) {
    turnoAlumna = habilitar;
    modal.classList.toggle("turno-alumna", habilitar);
  }

  function iluminar(indice, duracionMs) {
    const btn = botonesPasos()[indice];
    btn.classList.add("iluminado");
    tocarTono(PASOS[indice].frecuencia, duracionMs);
    esperar(duracionMs, () => btn.classList.remove("iluminado"));
  }

  function actualizarMarcador() {
    q(".juego-baile-puntos").textContent = String(Math.max(0, secuencia.length - 1));
    q(".juego-baile-record").textContent = String(leerRecord());
  }

  function ponerEstado(texto) {
    q(".juego-baile-estado").textContent = texto;
  }

  // ---------- partida ----------
  function velocidadMs() {
    // Más rápido mientras más larga la coreografía, sin bajar de 280 ms.
    return Math.max(280, 620 - secuencia.length * 25);
  }

  function nuevaRonda() {
    secuencia.push(Math.floor(Math.random() * PASOS.length));
    posicion = 0;
    actualizarMarcador();
    habilitarPasos(false);
    ponerEstado("👀 Mira la coreografía...");
    const paso = velocidadMs();
    secuencia.forEach((indice, i) => {
      esperar(700 + i * (paso + 160), () => iluminar(indice, paso));
    });
    esperar(700 + secuencia.length * (paso + 160), () => {
      habilitarPasos(true);
      ponerEstado("💃 ¡Tu turno! Repite los pasos");
    });
  }

  function tocarPaso(indice) {
    if (!turnoAlumna) return;
    asegurarAudio();
    if (indice !== secuencia[posicion]) {
      terminarPartida();
      return;
    }
    iluminar(indice, 220);
    posicion++;
    if (posicion === secuencia.length) {
      habilitarPasos(false);
      ponerEstado("✅ ¡Muy bien!");
      modal.classList.add("acierto");
      esperar(450, () => modal.classList.remove("acierto"));
      esperar(900, nuevaRonda);
    }
  }

  function terminarPartida() {
    habilitarPasos(false);
    cancelarTemporizadores();
    sonidoError();
    modal.classList.add("error");
    esperar(500, () => modal.classList.remove("error"));

    const logrados = secuencia.length - 1;
    const recordAnterior = leerRecord();
    const esRecord = logrados > recordAnterior;
    if (esRecord) guardarRecord(logrados);

    const mensaje = MENSAJES_FINALES.filter((m) => logrados >= m.desde).pop();
    q(".juego-baile-final-puntos").textContent =
      logrados === 1 ? "Repetiste 1 paso" : `Repetiste ${logrados} pasos`;
    q(".juego-baile-final-mensaje").textContent = mensaje.texto;
    q(".juego-baile-final-record").hidden = !esRecord;
    q(".juego-baile-final").hidden = false;
    ponerEstado("Ups, ese no era el paso 🙈");
    actualizarMarcador();

    const empezar = q(".juego-baile-empezar");
    empezar.textContent = "🔁 Jugar otra vez";
    empezar.hidden = false;
    empezar.focus();
  }

  function empezarPartida() {
    cancelarTemporizadores();
    asegurarAudio();
    secuencia = [];
    q(".juego-baile-final").hidden = true;
    q(".juego-baile-empezar").hidden = true;
    nuevaRonda();
  }

  // Antes de cada partida se confirma que el portal siga abierto.
  async function portalDisponible() {
    try {
      await llamarWorker({ accion: "portalDisponible" });
      return true;
    } catch (e) {
      // Si fue por mantenimiento, llamarWorker ya tapó la página con el
      // aviso. Si fue la conexión, no se abre: mejor no dejar jugar
      // sin saber si el portal está cerrado.
      if (!document.getElementById("avisoMantenimientoPortal")) {
        window.alert("No se pudo abrir el juego. Revisa tu conexión e inténtalo de nuevo.");
      }
      return false;
    }
  }

  async function empezarPartidaSiDisponible() {
    const btn = q(".juego-baile-empezar");
    btn.disabled = true;
    // El audio se "despierta" dentro del toque, antes de esperar al Worker.
    asegurarAudio();
    const disponible = await portalDisponible();
    btn.disabled = false;
    if (!disponible) {
      cerrarJuego();
      return;
    }
    empezarPartida();
  }

  // ---------- abrir / cerrar ----------
  async function abrirJuego() {
    const boton = document.getElementById("btnJugarBaile");
    if (boton) boton.disabled = true;
    asegurarAudio();
    const disponible = await portalDisponible();
    if (boton) boton.disabled = false;
    if (!disponible) return;

    if (!modal) construirModal();
    cancelarTemporizadores();
    secuencia = [];
    habilitarPasos(false);
    actualizarMarcador();
    ponerEstado("Mira la secuencia de pasos y repítela en el mismo orden.");
    q(".juego-baile-final").hidden = true;
    const empezar = q(".juego-baile-empezar");
    empezar.textContent = "▶️ ¡Empezar!";
    empezar.hidden = false;
    modal.hidden = false;
    document.body.classList.add("juego-baile-abierto");
    empezar.focus();
  }

  function cerrarJuego() {
    if (!modal) return;
    cancelarTemporizadores();
    habilitarPasos(false);
    modal.hidden = true;
    document.body.classList.remove("juego-baile-abierto");
    const boton = document.getElementById("btnJugarBaile");
    if (boton) boton.focus();
  }

  const botonJugar = document.getElementById("btnJugarBaile");
  if (botonJugar) botonJugar.addEventListener("click", abrirJuego);
})();
