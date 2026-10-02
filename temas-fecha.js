// =====================================================================
// FECHAS ESPECIALES — decoración de temporada compartida
// =====================================================================
// Este es el ÚNICO lugar donde viven las fechas especiales (Día del
// Niño, Halloween, Navidad, etc.). Lo usan el Portal de Alumnas
// (index.html), el Panel de Clase (clase.html) y el kiosko del
// Biométrico. Para agregar una fecha nueva:
//   1. Agrégala aquí (emojis, cómo se mueven, letrero y cuándo toca).
//   2. Agrega su color en temas-fecha.css.
//   3. Sube el ?v= de este archivo en las páginas que lo usan.
// y aparece en todas las pantallas a la vez, sin repetir código.
//
// La fecha de "hoy" SIEMPRE se calcula en hora de Guatemala (no la del
// dispositivo ni UTC), para que el tema cambie a la medianoche de
// Guatemala aunque la tablet/laptop tenga mal la zona horaria.
//
// Para probar cualquier tema sin esperar a su fecha: abrir la página
// con ?temaPrueba=nombreDelTema al final del link (ej. ?temaPrueba=nino).
// =====================================================================

(function () {
  const EMOJIS_TEMA = {
    "back-to-dance": ["📚", "🩰", "🎒", "✨", "👟"],
    carino: ["💕", "❤️", "💌", "🌹", "💗"],
    mujer: ["💜", "🌷", "✨", "👑", "💪"],
    danza: ["💃", "🕺", "🎶", "✨", "👯"],
    madre: ["💐", "🌸", "💖", "🌷", "👩‍👧"],
    padre: ["👔", "💙", "🎩", "⭐", "👨‍👧"],
    independencia: ["🇬🇹", "🎆", "🔥", "💙", "🤍"],
    nino: ["🎈", "🧸", "🎨", "🎠", "🍭"],
    halloween: ["🎃", "👻", "🕸️", "🦇", "🕷️"],
    show: ["🎭", "🌟", "✨", "🎬", "👑"],
    navidad: ["❄️", "🎄", "🎅", "⛄", "🎁"],
    cumple: ["🎈", "🎉", "🎊", "🍰", "✨"],
  };

  // Cómo se mueven las partículas de cada tema: "cae" (bajan, como
  // confeti o nieve), "sube" (suben, como globos) o "flota" (se
  // mecen en su lugar, como fantasmas).
  const ESTILO_PARTICULA = {
    "back-to-dance": "sube",
    carino: "cae",
    mujer: "flota",
    danza: "flota",
    madre: "cae",
    padre: "cae",
    independencia: "cae",
    nino: "sube",
    halloween: "flota",
    show: "cae",
    navidad: "cae",
    cumple: "sube",
  };

  const BANNER_TEXTO = {
    "back-to-dance": "✨ ¡Bienvenidas de vuelta a MOVE!",
    carino: "💕 ¡Feliz Día del Cariño!",
    mujer: "💜 ¡Feliz Día de la Mujer!",
    danza: "💃 ¡Feliz Mes de la Danza!",
    madre: "💐 ¡Feliz Día de la Madre!",
    padre: "💙 ¡Feliz Día del Padre!",
    independencia: "🇬🇹 ¡Feliz Independencia, Guatemala!",
    nino: "🎈 ¡Feliz Día del Niño!",
    halloween: "🎃 Halloween",
    show: "🌟 ¡Se viene nuestro Show de Fin de Año! 🌟",
    navidad: "🎄 ¡Feliz Navidad!",
  };

  // Un tema por mes, todo el año. Julio y agosto se quedan sin tema.
  const TEMA_POR_MES = {
    1: "back-to-dance",
    2: "carino",
    3: "mujer",
    4: "danza",
    5: "madre",
    6: "padre",
    9: "independencia",
    10: "halloween",
    11: "show",
    12: "navidad",
  };

  // Excepciones de un solo día (formato "mes-día") que interrumpen por
  // ese único día el tema del mes. El 1 de octubre (Día del Niño)
  // interrumpe a Halloween; el resto de octubre sigue siendo Halloween.
  const TEMA_POR_DIA_ESPECIFICO = {
    "10-1": "nino",
  };

  // Mes y día de HOY en Guatemala, como números. Usa Intl con la zona
  // America/Guatemala (no getMonth()/getDate(), que dan la fecha del
  // dispositivo).
  function hoyGuatemala() {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const valor = (tipo) => Number(partes.find((p) => p.type === tipo).value);
    return { anio: valor("year"), mes: valor("month"), dia: valor("day") };
  }

  function temaDeHoy() {
    const forzado = new URLSearchParams(window.location.search).get("temaPrueba");
    if (forzado && EMOJIS_TEMA[forzado]) return forzado;

    const { mes, dia } = hoyGuatemala();
    return TEMA_POR_DIA_ESPECIFICO[`${mes}-${dia}`] || TEMA_POR_MES[mes] || null;
  }

  // Mes y día en que se celebra un cumpleaños en el año indicado, a
  // partir de la fecha de nacimiento "AAAA-MM-DD" (campo CUMPLEAÑOS, que
  // es solo fecha: se lee como texto, sin Date ni zona horaria, para que
  // no se corra un día). Las nacidas el 29 de febrero lo celebran el 28
  // en los años que no son bisiestos. Devuelve null si no hay fecha.
  // El Worker (maestraCumpleanosMes) aplica esta misma regla.
  function cumpleEnAnio(fechaISO, anio) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO || ""));
    if (!m) return null;
    const mes = Number(m[2]);
    let dia = Number(m[3]);
    const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    if (mes === 2 && dia === 29 && !bisiesto) dia = 28;
    return { mes, dia };
  }

  // ¿Cumple años HOY (en Guatemala)? Ignora el año de nacimiento.
  function esCumpleHoy(fechaISO) {
    const hoy = hoyGuatemala();
    const cumple = cumpleEnAnio(fechaISO, hoy.anio);
    return !!cumple && cumple.mes === hoy.mes && cumple.dia === hoy.dia;
  }

  function limpiar(contenedor, banner) {
    Object.keys(EMOJIS_TEMA).forEach((t) => document.body.classList.remove("tema-" + t));
    if (contenedor) contenedor.innerHTML = "";
    if (banner) {
      banner.hidden = true;
      banner.className = "tema-banner";
    }
  }

  // Pinta el tema: clase en <body> (color del brillo), partículas en
  // el contenedor y el letrero. `particulas` permite que cada pantalla
  // ponga más o menos (el Panel de Clase usa menos para no distraer).
  function aplicar(tema, { contenedor, banner, nombre, particulas = 18 } = {}) {
    limpiar(contenedor, banner);
    if (!tema) return;

    document.body.classList.add("tema-" + tema);

    if (contenedor) {
      const emojis = EMOJIS_TEMA[tema] || [];
      const estilo = ESTILO_PARTICULA[tema] || "cae";
      for (let i = 0; i < particulas; i++) {
        const span = document.createElement("span");
        span.className = "tema-particula " + estilo;
        span.textContent = emojis[i % emojis.length];
        span.style.left = Math.random() * 96 + "%";
        span.style.fontSize = 1.2 + Math.random() * 1.3 + "rem";
        // Entre 2.2 y 5.2 s por recorrido (el doble de rápido que los 4.4–10.3 s de antes).
        const duracion = 2.2 + Math.random() * 3;
        span.style.animationDuration = duracion + "s";
        // Retraso negativo: cada emoji arranca ya a media animación, así
        // ninguno se queda quieto esperando al abrir la página.
        span.style.animationDelay = -Math.random() * duracion + "s";
        if (estilo === "flota") span.style.top = Math.random() * 85 + "%";
        contenedor.appendChild(span);
      }
    }

    if (banner) {
      banner.className = "tema-banner " + tema;
      banner.textContent =
        tema === "cumple"
          ? "🎉 ¡Feliz cumpleaños, " + (nombre || "") + "! 🎉"
          : BANNER_TEXTO[tema] || "";
      banner.hidden = false;
    }
  }

  window.TemasFecha = {
    EMOJIS_TEMA,
    ESTILO_PARTICULA,
    BANNER_TEXTO,
    TEMA_POR_MES,
    TEMA_POR_DIA_ESPECIFICO,
    hoyGuatemala,
    temaDeHoy,
    cumpleEnAnio,
    esCumpleHoy,
    aplicar,
    limpiar,
  };
})();
