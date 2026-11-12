/* Marcos de "Foto con marco" de The Dance Rollercoaster.
   Un solo archivo para el mapa (show/index.html) y el portal de papás
   (portal.js, sección 📸 Foto del show): así los dos marcos son siempre los
   mismos. Todo se dibuja con canvas sobre los dos logos del show: nada pesado
   que descargar con mala señal. Cada diseño devuelve dónde va la foto (zona)
   y dibuja encima su decoración; el centro queda libre para la cara.
   El mapa lo pide por red primero (show/sw.js), así un cambio aquí llega a
   los dos sin esperar a que se venza una copia guardada. */
(function(){
'use strict';
// Los logos están junto a este archivo, se cargue desde /show/ o desde el portal.
const BASE = new URL('.', document.currentScript.src).href;

const MARCO_COLORES = { noche:'#0a0b1f', nocheMedia:'#1e2158', oro:'#f3d27a', oroHondo:'#c79a2e', oroBrillo:'#ffe9b0', rosa:'#f95b9b', crema:'#f6ecd6' };
const MARCO_FECHA = '25 DE NOVIEMBRE 2026';

function azarMarco(semilla){ return () => { semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0; let t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function caminoRedondo(ctx, x, y, w, h, r, nuevo = true){ if(nuevo) ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function oroLineal(ctx, x0, y0, x1, y1){ const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#8a6414'); g.addColorStop(.25, MARCO_COLORES.oroBrillo); g.addColorStop(.5, MARCO_COLORES.oroHondo); g.addColorStop(.75, MARCO_COLORES.oroBrillo); g.addColorStop(1, '#8a6414'); return g; }
function fondoNoche(ctx, W, H){ const g = ctx.createRadialGradient(W/2, H*.42, W*.1, W/2, H/2, H*.75); g.addColorStop(0, MARCO_COLORES.nocheMedia); g.addColorStop(1, MARCO_COLORES.noche); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
function destello(ctx, x, y, r, color = '#fff'){
  ctx.save(); ctx.translate(x, y);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6); halo.addColorStop(0, 'rgba(255,240,200,.55)'); halo.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath();
  for(let i = 0; i < 8; i++){ const a = i * Math.PI / 4; const rr = i % 2 ? r * .22 : r; ctx.lineTo(Math.cos(a - Math.PI/2) * rr, Math.sin(a - Math.PI/2) * rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
// Confeti y destellos solo fuera de la zona de la foto.
function confetiMarco(ctx, W, H, libre, cantidad, semilla){
  const azar = azarMarco(semilla); const colores = [MARCO_COLORES.oro, MARCO_COLORES.rosa, MARCO_COLORES.crema, MARCO_COLORES.oroBrillo];
  for(let i = 0, n = 0; n < cantidad && i < cantidad * 20; i++){
    const x = azar() * W, y = azar() * H;
    if(libre && x > libre.x - 8 && x < libre.x + libre.w + 8 && y > libre.y - 8 && y < libre.y + libre.h + 8) continue;
    n++;
    if(azar() < .22){ destello(ctx, x, y, W * (.008 + azar() * .014)); continue; }
    ctx.save(); ctx.translate(x, y); ctx.rotate(azar() * Math.PI); ctx.fillStyle = colores[Math.floor(azar() * colores.length)];
    ctx.globalAlpha = .55 + azar() * .45; ctx.fillRect(-W * .006, -W * .0025, W * .012, W * .005); ctx.restore();
  }
}
// cover + encuadre del usuario: zoom 1 = llena la zona; menos de 1 deja ver la
// foto entera (una grupal horizontal no cabe en una historia) con fondo de noche.
// dx/dy en fracción de la zona.
function dibujarFotoEnZona(ctx, foto, z, enc = { zoom: 1, dx: 0, dy: 0 }, radio = 0){
  const iw = foto.naturalWidth || foto.width, ih = foto.naturalHeight || foto.height;
  const escala = Math.max(z.w / iw, z.h / ih) * enc.zoom;
  const w = iw * escala, h = ih * escala;
  const maxX = Math.max(0, (w - z.w) / 2), maxY = Math.max(0, (h - z.h) / 2);
  const x = z.x + (z.w - w) / 2 + Math.max(-maxX, Math.min(maxX, enc.dx * z.w));
  const y = z.y + (z.h - h) / 2 + Math.max(-maxY, Math.min(maxY, enc.dy * z.h));
  ctx.save(); caminoRedondo(ctx, z.x, z.y, z.w, z.h, radio); ctx.clip();
  if(w < z.w || h < z.h) fondoDifuminado(ctx, foto, z, iw, ih);
  ctx.drawImage(foto, x, y, w, h); ctx.restore();
}
// Los huecos de una foto alejada: la misma foto muy ampliada y oscurecida.
// Se difumina achicándola a unos pocos píxeles (ctx.filter no existe en el
// Safari de muchos iPhone).
function fondoDifuminado(ctx, foto, z, iw, ih){
  if(!foto.__difuminada){
    const c = document.createElement('canvas'); c.width = 24; c.height = Math.max(1, Math.round(24 * ih / iw));
    c.getContext('2d').drawImage(foto, 0, 0, c.width, c.height); foto.__difuminada = c;
  }
  const escala = Math.max(z.w / iw, z.h / ih) * 1.1, w = iw * escala, h = ih * escala;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(foto.__difuminada, z.x + (z.w - w) / 2, z.y + (z.h - h) / 2, w, h);
  ctx.fillStyle = 'rgba(10,11,31,.55)'; ctx.fillRect(z.x, z.y, z.w, z.h); ctx.restore();
}
function textoMarco(ctx, texto, x, y, { tam, letra = 'Bebas Neue', color = MARCO_COLORES.oro, alinear = 'center', sombra = true, espacio = 0, peso = '', maxAncho }){
  ctx.save(); ctx.font = `${peso} ${tam}px '${letra}'`; ctx.textAlign = alinear; ctx.textBaseline = 'middle';
  if('letterSpacing' in ctx) ctx.letterSpacing = `${espacio}px`;
  if(sombra){ ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = tam * .25; ctx.shadowOffsetY = tam * .06; }
  // Si no cabe, se achica: las letras pueden no haber cargado y medir distinto.
  if(maxAncho){ const ancho = ctx.measureText(texto).width; if(ancho > maxAncho){ ctx.font = `${peso} ${tam * maxAncho / ancho}px '${letra}'`; } }
  ctx.fillStyle = color; ctx.fillText(texto, x, y); ctx.restore();
}
// El logo del show tiene aire alrededor: se recorta a lo que se ve.
function dibujarLogoShow(ctx, logos, cx, cy, ancho){
  const L = logos.show, rec = { x: .06, y: .14, w: .88, h: .72 };
  const sw = L.naturalWidth * rec.w, sh = L.naturalHeight * rec.h, alto = ancho * sh / sw;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = ancho * .04;
  ctx.drawImage(L, L.naturalWidth * rec.x, L.naturalHeight * rec.y, sw, sh, cx - ancho / 2, cy - alto / 2, ancho, alto); ctx.restore();
  return alto;
}
function dibujarLogoMove(ctx, logos, cx, cy, ancho, fondo = true){
  const L = logos.move, alto = ancho * L.naturalHeight / L.naturalWidth;
  if(fondo){ ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.92)'; caminoRedondo(ctx, cx - ancho * .58, cy - alto * .75, ancho * 1.16, alto * 1.5, alto * .4); ctx.fill(); ctx.restore(); }
  ctx.drawImage(L, cx - ancho / 2, cy - alto / 2, ancho, alto); return alto;
}

/* 1. Marquesina: bombillas de feria alrededor de la foto. */
function marcoMarquesina(ctx, W, H, foto, enc, logos){
  fondoNoche(ctx, W, H);
  const historia = H / W > 1.5;
  const m = W * .075, arriba = H * (historia ? .17 : .15), abajo = H * (historia ? .13 : .14);
  const z = { x: m, y: arriba, w: W - m * 2, h: H - arriba - abajo };
  confetiMarco(ctx, W, H, { x: z.x - W * .05, y: z.y - W * .05, w: z.w + W * .1, h: z.h + W * .1 }, 70, 7);
  dibujarFotoEnZona(ctx, foto, z, enc, W * .02);
  const t = W * .05, R = { x: z.x - t, y: z.y - t, w: z.w + t * 2, h: z.h + t * 2 };
  ctx.save(); caminoRedondo(ctx, R.x, R.y, R.w, R.h, W * .045); caminoRedondo(ctx, z.x, z.y, z.w, z.h, W * .02, false);
  ctx.fillStyle = oroLineal(ctx, R.x, R.y, R.x + R.w, R.y + R.h); ctx.fill('evenodd');
  ctx.lineWidth = W * .004; ctx.strokeStyle = '#6b4a0e'; ctx.stroke(); ctx.restore();
  // Bombillas: blancas cálidas y cada cuarta rosa Move, con halo.
  const paso = W * .062, c = { x: R.x + t / 2, y: R.y + t / 2, w: R.w - t, h: R.h - t };
  const puntos = [];
  const lado = (x0, y0, x1, y1) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / paso)); for(let i = 0; i < n; i++) puntos.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  lado(c.x, c.y, c.x + c.w, c.y); lado(c.x + c.w, c.y, c.x + c.w, c.y + c.h); lado(c.x + c.w, c.y + c.h, c.x, c.y + c.h); lado(c.x, c.y + c.h, c.x, c.y);
  puntos.forEach(([x, y], i) => {
    const rosa = i % 4 === 0, r = t * .3;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6); halo.addColorStop(0, rosa ? 'rgba(249,91,155,.85)' : 'rgba(255,233,176,.9)'); halo.addColorStop(1, 'rgba(255,233,176,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill();
    const foco = ctx.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r); foco.addColorStop(0, '#fff'); foco.addColorStop(1, rosa ? MARCO_COLORES.rosa : MARCO_COLORES.oroBrillo);
    ctx.fillStyle = foco; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  });
  dibujarLogoShow(ctx, logos, W / 2, arriba * .5, W * (historia ? .66 : .56));
  const pie = H - abajo / 2;
  textoMarco(ctx, MARCO_FECHA, W * .055, pie, { tam: W * .062, alinear: 'left', espacio: W * .004 });
  dibujarLogoMove(ctx, logos, W - W * .2, pie, W * .22);
  destello(ctx, z.x + z.w * .06, z.y + z.h * .05, W * .03); destello(ctx, z.x + z.w * .94, z.y + z.h * .95, W * .026);
  return z;
}

/* 2. Foto de la montaña rusa: como la foto de la bajada. */
function puntoBezier(p0, p1, p2, p3, t){ const u = 1 - t; return [u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]]; }
function marcoMontana(ctx, W, H, foto, enc, logos, numero){
  const z = { x: 0, y: 0, w: W, h: H };
  dibujarFotoEnZona(ctx, foto, z, enc);
  const sombraArriba = ctx.createLinearGradient(0, 0, 0, H * .26); sombraArriba.addColorStop(0, 'rgba(10,11,31,.85)'); sombraArriba.addColorStop(1, 'rgba(10,11,31,0)');
  ctx.fillStyle = sombraArriba; ctx.fillRect(0, 0, W, H * .26);
  const sombraAbajo = ctx.createLinearGradient(0, H * .7, 0, H); sombraAbajo.addColorStop(0, 'rgba(10,11,31,0)'); sombraAbajo.addColorStop(1, 'rgba(10,11,31,.85)');
  ctx.fillStyle = sombraAbajo; ctx.fillRect(0, H * .7, W, H * .3);
  // Vía: entra por abajo a la izquierda, rodea y sube por la derecha.
  const tramos = [
    [[-W * .1, H * .9], [W * .25, H * 1.0], [W * .62, H * .99], [W * .86, H * .84]],
    [[W * .86, H * .84], [W * 1.04, H * .72], [W * .99, H * .5], [W * 1.12, H * .34]],
  ];
  const trazar = () => { ctx.beginPath(); ctx.moveTo(...tramos[0][0]); tramos.forEach(([, a, b, c]) => ctx.bezierCurveTo(...a, ...b, ...c)); };
  ctx.save(); ctx.lineCap = 'butt';
  trazar(); ctx.setLineDash([W * .012, W * .022]); ctx.lineWidth = W * .085; ctx.strokeStyle = '#4a3108'; ctx.stroke();
  ctx.setLineDash([]); trazar(); ctx.lineWidth = W * .06; ctx.strokeStyle = oroLineal(ctx, 0, H * .6, W, H); ctx.stroke();
  trazar(); ctx.lineWidth = W * .036; ctx.strokeStyle = 'rgba(10,11,31,.92)'; ctx.stroke(); ctx.restore();
  // Carrito sobre la vía.
  const t = .38, [cx, cy] = puntoBezier(...tramos[0], t), [nx, ny] = puntoBezier(...tramos[0], t + .01);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(ny - cy, nx - cx));
  const cw = W * .27, ch = W * .11;
  ctx.fillStyle = MARCO_COLORES.rosa; caminoRedondo(ctx, -cw / 2, -ch - W * .028, cw, ch, ch * .35); ctx.fill();
  ctx.lineWidth = W * .006; ctx.strokeStyle = MARCO_COLORES.oroBrillo; ctx.stroke();
  ctx.fillStyle = MARCO_COLORES.oro; caminoRedondo(ctx, -cw / 2 + cw * .08, -ch - W * .02, cw * .84, ch * .22, ch * .1); ctx.fill();
  textoMarco(ctx, '★', 0, -ch * .45 - W * .028, { tam: ch * .55, color: MARCO_COLORES.oroBrillo, sombra: false });
  [-cw * .3, cw * .3].forEach(x => { ctx.fillStyle = '#1e2158'; ctx.beginPath(); ctx.arc(x, -W * .022, W * .02, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = MARCO_COLORES.oro; ctx.lineWidth = W * .005; ctx.stroke(); });
  ctx.restore();
  for(let i = 1; i < 7; i++){ const [x, y] = puntoBezier(...tramos[i < 4 ? 0 : 1], (i % 4) / 4 + .1); destello(ctx, x, y - W * .05, W * .018); }
  // Arriba: logo del show y Move; letrero de la foto de la bajada.
  dibujarLogoShow(ctx, logos, W * .3, W * .135, W * .5);
  const altoMove = dibujarLogoMove(ctx, logos, W * .8, W * .1, W * .2);
  ctx.save(); ctx.translate(W * .79, W * .1 + altoMove * .75 + W * .085); ctx.rotate(-.06);
  const tw = W * .32, th = W * .09; ctx.fillStyle = MARCO_COLORES.rosa; caminoRedondo(ctx, -tw / 2, -th / 2, tw, th, th * .25); ctx.fill();
  ctx.lineWidth = W * .005; ctx.strokeStyle = MARCO_COLORES.oroBrillo; ctx.stroke();
  textoMarco(ctx, '¡SONRÍAN! 🎢', 0, th * .04, { tam: th * .55, color: '#fff' }); ctx.restore();
  // Sello tipo boleto, abajo a la izquierda, sobre la vía.
  ctx.save(); ctx.translate(W * .25, H * .76); ctx.rotate(-.12);
  const sw = W * .38, sh = W * .17; ctx.fillStyle = 'rgba(10,11,31,.82)'; caminoRedondo(ctx, -sw / 2, -sh / 2, sw, sh, W * .015); ctx.fill();
  ctx.setLineDash([W * .012, W * .008]); ctx.lineWidth = W * .004; ctx.strokeStyle = MARCO_COLORES.oro; caminoRedondo(ctx, -sw / 2 + W * .012, -sh / 2 + W * .012, sw - W * .024, sh - W * .024, W * .01); ctx.stroke(); ctx.setLineDash([]);
  const dentro = sw - W * .07;
  textoMarco(ctx, 'THE DANCE ROLLERCOASTER', 0, -sh * .22, { tam: sh * .15, letra: 'Cinzel', peso: 600, sombra: false, maxAncho: dentro });
  textoMarco(ctx, '25 · NOV · 2026', 0, sh * .05, { tam: sh * .3, color: MARCO_COLORES.oroBrillo, sombra: false, maxAncho: dentro });
  textoMarco(ctx, `FOTO Nº ${numero}`, 0, sh * .3, { tam: sh * .14, letra: 'Space Mono', color: MARCO_COLORES.rosa, sombra: false, maxAncho: dentro });
  ctx.restore();
  return z;
}

/* 3. Boleto VIP dorado con perforaciones. */
function marcoBoleto(ctx, W, H, foto, enc, logos, numero){
  fondoNoche(ctx, W, H);
  const historia = H / W > 1.5;
  const B = { x: W * .06, y: H * (historia ? .15 : .13), w: W * .88, h: H * (historia ? .8 : .83) };
  confetiMarco(ctx, W, H, B, 60, 21);
  const talon = B.h * (historia ? .2 : .23), corte = B.y + B.h - talon, muesca = W * .045;
  // Boleto con muescas a los lados de la línea perforada.
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = W * .04; ctx.shadowOffsetY = W * .015;
  ctx.beginPath(); const r = W * .035;
  ctx.moveTo(B.x + r, B.y); ctx.arcTo(B.x + B.w, B.y, B.x + B.w, corte, r);
  ctx.lineTo(B.x + B.w, corte - muesca); ctx.arc(B.x + B.w, corte, muesca, -Math.PI / 2, Math.PI / 2, true);
  ctx.arcTo(B.x + B.w, B.y + B.h, B.x, B.y + B.h, r); ctx.arcTo(B.x, B.y + B.h, B.x, corte, r);
  ctx.lineTo(B.x, corte + muesca); ctx.arc(B.x, corte, muesca, Math.PI / 2, -Math.PI / 2, true);
  ctx.arcTo(B.x, B.y, B.x + B.w, B.y, r); ctx.closePath();
  ctx.fillStyle = oroLineal(ctx, B.x, B.y, B.x + B.w, B.y + B.h); ctx.fill(); ctx.restore();
  const forma = new Path2D(); caminoRedondo(forma, B.x, B.y, B.w, B.h, r, false);
  // Brillo diagonal, solo dentro del boleto.
  ctx.save(); ctx.clip(forma); ctx.globalAlpha = .18; ctx.fillStyle = '#fff';
  for(let i = 0; i < 3; i++){ ctx.beginPath(); const x = B.x + B.w * (.15 + i * .3); ctx.moveTo(x, B.y); ctx.lineTo(x + W * .06, B.y); ctx.lineTo(x - W * .25, B.y + B.h); ctx.lineTo(x - W * .31, B.y + B.h); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(90,60,10,.7)'; ctx.lineWidth = W * .004; caminoRedondo(ctx, B.x + W * .02, B.y + W * .02, B.w - W * .04, corte - B.y - W * .04, W * .02); ctx.stroke();
  // Encabezado y foto.
  const cab = W * .095;
  textoMarco(ctx, '★  ADMIT ONE  ★', W / 2, B.y + cab * .62, { tam: W * .062, color: '#1e2158', sombra: false, espacio: W * .008 });
  const z = { x: B.x + W * .045, y: B.y + cab * 1.15, w: B.w - W * .09, h: corte - B.y - cab * 1.15 - W * .045 };
  dibujarFotoEnZona(ctx, foto, z, enc, W * .02);
  ctx.lineWidth = W * .008; ctx.strokeStyle = '#1e2158'; caminoRedondo(ctx, z.x, z.y, z.w, z.h, W * .02); ctx.stroke();
  // Sello VIP rosa.
  ctx.save(); ctx.translate(z.x + z.w - W * .08, z.y + W * .08); ctx.rotate(.25);
  ctx.fillStyle = MARCO_COLORES.rosa; ctx.beginPath(); for(let i = 0; i < 24; i++){ const a = i * Math.PI / 12, rr = i % 2 ? W * .07 : W * .082; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
  ctx.lineWidth = W * .004; ctx.strokeStyle = '#fff'; ctx.stroke();
  textoMarco(ctx, 'VIP', 0, W * .004, { tam: W * .06, color: '#fff', sombra: false }); ctx.restore();
  // Perforación.
  ctx.save(); ctx.setLineDash([W * .012, W * .012]); ctx.lineWidth = W * .006; ctx.strokeStyle = 'rgba(30,33,88,.75)';
  ctx.beginPath(); ctx.moveTo(B.x + muesca * 1.3, corte); ctx.lineTo(B.x + B.w - muesca * 1.3, corte); ctx.stroke(); ctx.restore();
  // Talón: textos, código de barras y logo Move.
  const tc = corte + talon / 2, izq = B.x + W * .06, textoMax = B.w * .62;
  textoMarco(ctx, 'THE DANCE ROLLERCOASTER', izq, tc - talon * .24, { tam: W * .04, letra: 'Cinzel', peso: 600, color: '#1e2158', alinear: 'left', sombra: false, maxAncho: textoMax });
  textoMarco(ctx, MARCO_FECHA, izq, tc + talon * .0, { tam: W * .058, color: '#1e2158', alinear: 'left', sombra: false, maxAncho: textoMax });
  const azar = azarMarco(Number(numero) || 1); let bx = B.x + W * .06; const by = tc + talon * .2, bh = talon * .2;
  ctx.fillStyle = '#1e2158'; while(bx < B.x + W * .42){ const g = W * (.002 + azar() * .006); ctx.fillRect(bx, by, g, bh); bx += g + W * (.002 + azar() * .004); }
  textoMarco(ctx, `Nº ${numero}`, B.x + W * .45, by + bh / 2, { tam: W * .026, letra: 'Space Mono', color: '#1e2158', alinear: 'left', sombra: false });
  dibujarLogoMove(ctx, logos, B.x + B.w - W * .15, tc - talon * .1, W * .2, false);
  // El ancho sale del espacio que hay arriba del boleto, para que nunca se corte.
  const proporcionLogo = (logos.show.naturalHeight * .72) / (logos.show.naturalWidth * .88);
  dibujarLogoShow(ctx, logos, W / 2, B.y / 2, Math.min(W * (historia ? .62 : .5), (B.y * .9) / proporcionLogo));
  return z;
}

const MARCOS = [
  { id: 'marquesina', nombre: 'Marquesina', dibujar: marcoMarquesina, ajuste: { zoom: 1, dy: 0 } },
  // La vía tapa la parte de abajo: la foto arranca más arriba y un poco más cerca.
  { id: 'montana', nombre: 'Montaña rusa', dibujar: marcoMontana, ajuste: { zoom: 1.15, dy: -.1 } },
  { id: 'boleto', nombre: 'Boleto VIP', dibujar: marcoBoleto, ajuste: { zoom: 1, dy: 0 } },
];
const FORMATOS_MARCO = { historia: { w: 1080, h: 1920, nombre: 'Historia' }, publicacion: { w: 1080, h: 1350, nombre: 'Publicación' } };

const MARCO_LADO_MAX = 2000;
const MARCO_ZOOM_MAX = 4;
const MARCO_ESCALA_VISTA = .5;

function cargarImagen(src){
  return new Promise((listo, falla) => { const img = new Image(); img.onload = () => listo(img); img.onerror = falla; img.src = src; });
}
let logos = null;
function cargarLogos(){
  if(!logos) logos = Promise.all([cargarImagen(BASE + 'logo-dance-rollercoaster.webp'), cargarImagen(BASE + 'logo-academia-move.png')])
    .then(([show, move]) => ({ show, move }))
    .catch((e) => { logos = null; throw e; });
  return logos;
}
// El portal no carga estas letras: se piden aquí. document.fonts.load no
// espera a una hoja que todavía no llegó, por eso primero se espera la hoja.
// Sin señal pueden no llegar: no se espera más de 2.5 s (el texto se achica solo).
const HOJA_LETRAS = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cinzel:wght@600&family=Space+Mono&display=swap';
function letrasMarco(){
  let hoja = Promise.resolve();
  if(!document.querySelector('link[href*="family=Bebas+Neue"][href*="Cinzel"][href*="Space+Mono"]')){
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = HOJA_LETRAS;
    hoja = new Promise((listo) => { link.onload = link.onerror = listo; });
    document.head.appendChild(link);
  }
  const todas = hoja.then(() => Promise.all(["40px 'Bebas Neue'", "600 40px 'Cinzel'", "40px 'Space Mono'"].map(f => document.fonts.load(f))));
  return Promise.race([todas, new Promise(r => setTimeout(r, 2500))]).catch(() => {});
}
// Una foto del celular pesa varios MB: a este tamaño se mueve fluido y sale liviana.
function fotoManejable(img){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const escala = Math.min(1, MARCO_LADO_MAX / Math.max(iw, ih));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(iw * escala);
  lienzo.height = Math.round(ih * escala);
  lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return lienzo;
}

/* Editor: vista previa, flechas, miniaturas, formato, arrastrar, pellizcar y
   barra de zoom. Cada página pone sus botones y su manera de guardar.
   el = { lienzo, miniaturas, nombre, zoom, anterior, siguiente, formatos } */
function crearEditor(el, { alElegir = () => {} } = {}){
  const estado = { foto: null, diseno: 0, formato: 'historia', enc: { zoom: 1, dx: 0, dy: 0 }, numero: '', completa: false, tocada: false };
  let logosListos = null;
  let zona = null;
  const zonas = new Map();

  // Dónde cae la foto en cada diseño y formato (no depende de la foto).
  function zonaDe(d){
    const llave = `${d}-${estado.formato}`;
    if(!zonas.has(llave)){
      const f = FORMATOS_MARCO[estado.formato], c = document.createElement('canvas');
      c.width = Math.round(f.w * .02); c.height = Math.round(f.h * .02);
      const ctx = c.getContext('2d'); ctx.setTransform(.02, 0, 0, .02, 0, 0);
      zonas.set(llave, MARCOS[d].dibujar(ctx, f.w, f.h, estado.foto, MARCOS[d].ajuste, logosListos, '000000'));
    }
    return zonas.get(llave);
  }
  function medidas(d){
    const z = zonaDe(d), f = estado.foto, a = MARCOS[d].ajuste;
    const cubrir = Math.max(z.w / f.width, z.h / f.height), entera = Math.min(z.w / f.width, z.h / f.height);
    return { z, a, cubrir, zoomMin: Math.min(1, entera / cubrir / a.zoom) };
  }
  // Grupal: entera, que no quede nadie afuera. Foto vertical: un poco hacia
  // arriba, donde suele estar la cara (con el ajuste propio del diseño encima).
  function encuadreInicial(d){
    const { z, a, cubrir, zoomMin } = medidas(d), f = estado.foto;
    const zoom = estado.completa ? zoomMin : 1;
    const my = Math.max(0, (f.height * cubrir * zoom * a.zoom - z.h) / 2 / z.h);
    return { zoom, dx: 0, dy: !estado.completa && f.height > f.width ? my * .5 : 0 };
  }
  // El ajuste del diseño (la Montaña rusa sube la foto) se suma a lo que mueva la persona.
  function encDe(d){
    const a = MARCOS[d].ajuste, e = estado.enc;
    return { zoom: e.zoom * a.zoom, dx: e.dx, dy: e.dy + a.dy };
  }
  function dibujar(lienzo, d, escala){
    const f = FORMATOS_MARCO[estado.formato];
    lienzo.width = Math.round(f.w * escala);
    lienzo.height = Math.round(f.h * escala);
    const ctx = lienzo.getContext('2d');
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    return MARCOS[d].dibujar(ctx, f.w, f.h, estado.foto, encDe(d), logosListos, estado.numero);
  }
  let pendiente = false;
  function pintar(){
    if(pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; zona = dibujar(el.lienzo, estado.diseno, MARCO_ESCALA_VISTA); });
  }
  function ponerBarra(){
    el.zoom.step = 'any';
    el.zoom.min = medidas(estado.diseno).zoomMin.toFixed(3);
    el.zoom.value = estado.enc.zoom;
  }
  // Mientras la persona no mueva la foto, cada diseño arranca con su mejor encuadre.
  function reencuadrar(){
    if(!estado.tocada) estado.enc = encuadreInicial(estado.diseno);
    else limitar();
    ponerBarra();
  }
  function pintarMiniaturas(){
    el.miniaturas.innerHTML = '';
    MARCOS.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === estado.diseno ? 'activo' : '';
      b.setAttribute('aria-label', `Diseño ${m.nombre}`);
      const guardada = estado.enc;
      // Cada miniatura con el encuadre que tendría al elegirla.
      if(!estado.tocada) estado.enc = encuadreInicial(i);
      const c = document.createElement('canvas');
      dibujar(c, i, .1);
      estado.enc = guardada;
      b.appendChild(c);
      b.addEventListener('click', () => elegir(i));
      el.miniaturas.appendChild(b);
    });
    el.nombre.textContent = `${estado.diseno + 1}/${MARCOS.length} · ${MARCOS[estado.diseno].nombre}`;
  }
  function elegir(i){
    estado.diseno = (i + MARCOS.length) % MARCOS.length;
    alElegir();
    reencuadrar();
    pintar();
    pintarMiniaturas();
  }
  el.anterior.addEventListener('click', () => elegir(estado.diseno - 1));
  el.siguiente.addEventListener('click', () => elegir(estado.diseno + 1));
  el.formatos.forEach(b => b.addEventListener('click', () => {
    estado.formato = b.dataset.formato;
    el.formatos.forEach(x => x.classList.toggle('activo', x === b));
    alElegir();
    reencuadrar();
    pintar();
    pintarMiniaturas();
  }));

  // Que la foto no se pueda arrastrar hasta dejar un hueco dentro del marco.
  function limitar(){
    if(!estado.foto) return;
    const { z, a, cubrir, zoomMin } = medidas(estado.diseno), f = estado.foto;
    estado.enc.zoom = Math.max(zoomMin, Math.min(MARCO_ZOOM_MAX, estado.enc.zoom));
    const escala = cubrir * estado.enc.zoom * a.zoom;
    const mx = Math.max(0, (f.width * escala - z.w) / 2 / z.w), my = Math.max(0, (f.height * escala - z.h) / 2 / z.h);
    estado.enc.dx = Math.max(-mx, Math.min(mx, estado.enc.dx));
    estado.enc.dy = Math.max(-my - a.dy, Math.min(my - a.dy, estado.enc.dy));
  }
  function ponerZoom(zoom){
    estado.tocada = true;
    estado.enc.zoom = zoom;
    limitar();
    el.zoom.value = estado.enc.zoom;
    pintar();
  }
  el.zoom.addEventListener('input', () => ponerZoom(Number(el.zoom.value)));
  el.zoom.addEventListener('change', pintarMiniaturas);
  const punteros = new Map();
  let pellizco = null;
  const lienzo = el.lienzo;
  lienzo.addEventListener('pointerdown', (e) => {
    lienzo.setPointerCapture(e.pointerId);
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(punteros.size === 2){
      const [a, b] = [...punteros.values()];
      pellizco = { distancia: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: estado.enc.zoom };
    }
  });
  lienzo.addEventListener('pointermove', (e) => {
    const p = punteros.get(e.pointerId);
    if(!p || !zona) return;
    if(punteros.size === 1){
      // De píxeles de pantalla a fracción de la zona de la foto.
      const k = FORMATOS_MARCO[estado.formato].w / lienzo.getBoundingClientRect().width;
      estado.enc.dx += (e.clientX - p.x) * k / zona.w;
      estado.enc.dy += (e.clientY - p.y) * k / zona.h;
      estado.tocada = true;
    }
    p.x = e.clientX; p.y = e.clientY;
    if(punteros.size === 2 && pellizco){
      const [a, b] = [...punteros.values()];
      return ponerZoom(pellizco.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pellizco.distancia);
    }
    limitar();
    pintar();
  });
  function soltar(e){
    if(!punteros.delete(e.pointerId)) return;
    if(punteros.size < 2) pellizco = null;
    if(!punteros.size) pintarMiniaturas();
  }
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
  lienzo.addEventListener('wheel', (e) => { e.preventDefault(); ponerZoom(estado.enc.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });

  return {
    // imagen: <img>, ImageBitmap o canvas. completa: true para fotos grupales.
    async abrir(imagen, { completa = false } = {}){
      const [l] = await Promise.all([cargarLogos(), letrasMarco()]);
      logosListos = l;
      estado.foto = fotoManejable(imagen);
      estado.completa = completa;
      estado.tocada = false;
      estado.diseno = 0;
      // Distinto en cada foto: es un adorno, no se guarda en ningún lado.
      estado.numero = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
      zonas.clear();
      reencuadrar();
      pintar();
      pintarMiniaturas();
    },
    // La vista se dibuja a la mitad para que mover la foto sea fluido; lo que se
    // guarda o se comparte se vuelve a dibujar completo (1080 de ancho).
    blob(){
      const lienzo = document.createElement('canvas');
      dibujar(lienzo, estado.diseno, 1);
      return new Promise(r => lienzo.toBlob(r, 'image/jpeg', 0.86));
    },
    get diseno(){ return MARCOS[estado.diseno].id; },
    get formato(){ return estado.formato; },
  };
}

window.MarcoShow = { MARCOS, FORMATOS_MARCO, MARCO_FECHA, crearEditor };
})();
