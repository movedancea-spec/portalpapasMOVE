# CLAUDE.md

Sitio de MOVE Dance Academy en academiamovedance.com: páginas HTML/CSS/JS sueltas publicadas con GitHub Pages. No hay build, bundler ni tests. Para probar basta un servidor estático local. Hacer push a `main` publica el sitio.

**Este repo es público.** La documentación completa está en el repo privado portalalumnas, en `docs/portalpapasMOVE.md` (en esta Mac: `../portalalumnas/docs/portalpapasMOVE.md`). Léela antes de cambiar algo y documenta ahí, no aquí.

## Reglas

- Nunca subas a este repo nombres de alumnas ni otros datos personales, claves, tokens o detalles internos: quedan públicos y en el historial.
- Nada de claves en el frontend: las páginas solo hablan con el Worker.
- Páginas nuevas: proponer primero una dirección que empiece con academiamovedance.com. No usar workers.dev ni subdominios para páginas públicas sin preguntar.
- Una página con service worker propio lo tiene en su carpeta y con su scope. No toques el `sw.js` de la raíz por una página aparte.
- Textos y comentarios en español, explicando el porqué.
- Los `?v=` de scripts y estilos se cambian a mano al editar esos archivos.
- Los nombres de campos largos deben coincidir letra por letra con los datos: no los "limpies".
