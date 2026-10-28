// mapa.js — Editor de mapas. Idea: importar la imagen del mapa y pintar encima los tiles que importan (muros, agua, hierba alta…).
//   Izquierda: paleta de tiles · Centro: el mapa · Derecha: propiedades, puntos y objetos.
// Los datos del mapa son: casillas {tile: [[x, y], …]}, capas {detalle, superior} (decoración, mismo formato), tile_base (suelo por defecto), fondo (imagen), inicio, puntos y objetos.
// Capa 1 = base (la que manda: bloquea, daña…) · Capa 2 = detalle bajo los tokens · Capa 3 = superior, encima de los tokens. Las capas 2 y 3 son solo decoración.
import { h, toast, pedirTexto, dialogo, entero } from './util.js';
import { irA } from './navegacion.js';
import { E, bus, nuevo, recargarAssets } from './estado.js';
import { construirCampo, urlAsset, asegurarCliente } from './campos.js';
import { elegirImagen } from './galeria.js';

const HERRAMIENTAS = [
  ['pintar', '🖌️', 'Pincel', 'B', 'Haz clic o arrastra para pintar casillas con el tile elegido'],
  ['rellenar', '🪣', 'Rellenar', 'G', 'Rellena toda la zona conectada del mismo tile'],
  ['rectangulo', '⬛', 'Rectángulo', 'R', 'Arrastra para pintar un rectángulo'],
  ['borrar', '🧽', 'Borrador', 'E', 'Quita el tile: la casilla vuelve al suelo base del mapa'],
  ['inicio', '⭐', 'Inicio', 'I', 'Marca dónde aparecen los personajes'],
  ['punto', '📍', 'Punto', 'P', 'Añade un punto importante (puerta, tienda…) solo visible para el GM'],
  ['objeto', '📦', 'Objeto', 'O', 'Coloca un objeto sobre el mapa (barril, cofre…). Clic en uno que ya está para elegirlo, moverlo o estirar sus esquinas'],
  ['fondo', '🖼️', 'Imagen', 'F', 'Mueve y estira la imagen de fondo del mapa arrastrando sus bordes y esquinas'],
  ['quitar', '❌', 'Quitar', 'X', 'Quita el punto u objeto de una casilla'],
];
const CAPAS = [
  [1, 'Base', 'El mapa en sí: aquí mandan los tiles que bloquean, dañan o esconden'],
  [2, 'Detalle', 'Decoración bajo los tokens (flores, grietas, charcos). No tiene efectos'],
  [3, 'Superior', 'Decoración encima de los tokens (techos, copas de árboles). No tiene efectos'],
];
const CLAVE_CAPA = { 2: 'detalle', 3: 'superior' };
const TECLA_A_HERRAMIENTA = Object.fromEntries(HERRAMIENTAS.map(([id, , , k]) => [k.toLowerCase(), id]));

/** Marcas pequeñas que resumen qué hace un tile (se ven en la paleta y sobre el mapa). */
export function marcasDe(t) {
  const m = [];
  if (t.transitable === false) m.push(['🚫', 'No se puede pasar']);
  if (t.esconde) m.push(['👁️', 'Esconde a quien esté encima']);
  if (t.rompible) m.push(['🔨', 'Se puede romper']);
  if (Array.isArray(t.bloquea_lados) && t.bloquea_lados.length) m.push(['🚧', `Lados cerrados: ${t.bloquea_lados.join(', ')}`]);
  if (Array.isArray(t.efectos) && t.efectos.length) m.push(['⚡', 'Tiene efectos']);
  return m;
}

// Iconos en pixel art del programa dibujados en el lienzo (si aún no cargaron, el emoji de siempre)
const ICONOS = {};
function icono(cx, nombre, emoji, x, y, lado) {
  let img = ICONOS[nombre];
  if (!img) { img = ICONOS[nombre] = new Image(); img.src = `img/interfaz/${nombre}.png`; img.onload = () => document.dispatchEvent(new Event('iconos-mapa')); }
  if (img.complete && img.naturalWidth) {
    const l = Math.max(8, Math.round(lado / 16) * 16 || lado);
    const suave = cx.imageSmoothingEnabled; cx.imageSmoothingEnabled = false;
    cx.drawImage(img, Math.round(x - l / 2), Math.round(y - l / 2), l, l);
    cx.imageSmoothingEnabled = suave;
  } else cx.fillText(emoji, x, y + 1);
}

export function construirMapa(p, ctx) {
  const m = p.borrador;
  m.casillas ||= {}; m.objetos ||= []; m.puntos ||= []; m.inicio ||= { x: 0, y: 0 };
  const tiles = () => E.campana.recursos.tiles || {};
  let herramienta = 'pintar';
  let pincel = Object.keys(tiles())[0] || '';
  let tam = 28;
  let verRejilla = true;
  let capaActiva = 1;
  const rejillas = { 1: [], 2: [], 3: [] };   // rejillas[capa][y][x] = id de tile pintado ('' = vacío / suelo base)
  let celdas = [];        // la rejilla de la capa activa
  let arrastre = null;
  let espacio = false;
  let fondo = null;
  let sel = -1;           // índice del objeto elegido (para moverlo, cambiar su tamaño, su imagen…)
  const desmontar = [];
  const anchoDe = (o) => o.ancho || 1, altoDe = (o) => o.alto || 1;
  const cuarto = (n) => Math.round(n * 4) / 4;
  /** El objeto que hay bajo un punto (en casillas, con decimales); el de encima gana. */
  const objetoEn = (fx, fy) => { for (let i = m.objetos.length - 1; i >= 0; i--) { const o = m.objetos[i]; if (fx >= o.x && fy >= o.y && fx < o.x + anchoDe(o) && fy < o.y + altoDe(o)) return i; } return -1; };
  const ASAS = ['no', 'ne', 'so', 'se'];
  // ── Imagen de fondo: rectángulo en casillas (por defecto, el mapa justo) y sus 8 asas ──
  let proporcion = true;          // las esquinas mantienen la forma de la imagen
  const rectFondo = () => m.fondo_ajuste || { x: 0, y: 0, ancho: m.ancho, alto: m.alto };
  const ASAS_FONDO = ['no', 'n', 'ne', 'e', 'se', 's', 'so', 'o'];
  const posAsaFondo = (a) => {
    const r = rectFondo();
    const x = a.includes('o') ? r.x : a.includes('e') ? r.x + r.ancho : r.x + r.ancho / 2;
    const y = a.startsWith('n') ? r.y : a.startsWith('s') ? r.y + r.alto : r.y + r.alto / 2;
    // si la imagen se sale del lienzo, el asa se dibuja en el borde (se sigue pudiendo arrastrar)
    return { x: Math.min(Math.max(x * tam, 7), canvas.width - 7), y: Math.min(Math.max(y * tam, 7), canvas.height - 7) };
  };
  const asaFondoEn = (px, py) => ASAS_FONDO.find((a) => { const q = posAsaFondo(a); return Math.abs(q.x - px) <= 8 && Math.abs(q.y - py) <= 8; }) || null;
  const redondear = (n) => Math.round(n * 100) / 100;
  const posAsa = (o, a) => ({ x: (a[1] === 'e' ? o.x + anchoDe(o) : o.x) * tam, y: (a[0] === 's' ? o.y + altoDe(o) : o.y) * tam });
  const asaEn = (px, py) => { const o = m.objetos[sel]; if (!o) return null; return ASAS.find((a) => { const q = posAsa(o, a); return Math.abs(q.x - px) <= 7 && Math.abs(q.y - py) <= 7; }) || null; };

  // ── Datos ↔ rejilla ──
  function leerCasillas() {
    for (const n of [1, 2, 3]) {
      const fuente = n === 1 ? m.casillas : (m.capas?.[CLAVE_CAPA[n]] || {});
      const r = Array.from({ length: m.alto }, () => Array(m.ancho).fill(''));
      for (const [id, lst] of Object.entries(fuente)) for (const q of lst || []) if (Array.isArray(q) && r[q[1]] && q[0] >= 0 && q[0] < m.ancho) r[q[1]][q[0]] = id;
      rejillas[n] = r;
    }
    celdas = rejillas[capaActiva];
  }
  function volcar() {
    const agrupar = (r, base) => {
      const g = {};
      for (let y = 0; y < m.alto; y++) for (let x = 0; x < m.ancho; x++) { const id = r[y][x]; if (id && id !== base) (g[id] ||= []).push([x, y]); }
      return g;
    };
    m.casillas = agrupar(rejillas[1], m.tile_base);
    const capas = {};
    for (const n of [2, 3]) { const g = agrupar(rejillas[n], null); if (Object.keys(g).length) capas[CLAVE_CAPA[n]] = g; }
    if (Object.keys(capas).length) m.capas = capas; else delete m.capas;
    ctx.alCambiar();
  }
  leerCasillas();
  const cambiar = () => { volcar(); pintarAvisos(); };
  const idEnCelda = (x, y) => rejillas[1][y][x] || m.tile_base || '';
  const idEnCapa = (n, x, y) => (n === 1 ? idEnCelda(x, y) : rejillas[n][y][x]);
  const huerfanas = () => { let n = 0; for (const k of [1, 2, 3]) for (const f of rejillas[k]) for (const id of f) if (id && !tiles()[id]) n++; return n; };

  const canvas = h('canvas', { class: 'mapa-lienzo', 'aria-label': 'Mapa' });
  const cx = canvas.getContext('2d');
  const info = h('span', { class: 'tenue pequeno mapa-info', 'aria-live': 'polite' });
  const cacheImg = new Map();
  const imagenTile = (rel) => {
    if (!rel) return null;
    let e = cacheImg.get(rel);
    if (!e) { e = new Image(); e.onload = () => dibujar(); e.src = urlAsset(rel); cacheImg.set(rel, e); }
    return e.complete && e.naturalWidth ? e : null;
  };

  function dibujar(previa = null) {
    const W = m.ancho, A = m.alto;
    if (canvas.width !== W * tam || canvas.height !== A * tam) { canvas.width = W * tam; canvas.height = A * tam; }
    cx.clearRect(0, 0, canvas.width, canvas.height);
    cx.fillStyle = '#10141a'; cx.fillRect(0, 0, canvas.width, canvas.height);
    const tieneFondo = fondo?.complete && fondo.naturalWidth;
    if (tieneFondo) { const r = rectFondo(); cx.drawImage(fondo, r.x * tam, r.y * tam, r.ancho * tam, r.alto * tam); }
    const pintarCapa = (n) => {
      const opaca = n === 1 || n === capaActiva;            // las capas que no se están editando se ven más tenues
      for (let y = 0; y < A; y++) for (let x = 0; x < W; x++) {
        const id = idEnCapa(n, x, y);
        if (!id) continue;
        const t = tiles()[id];
        if (!t) { cx.fillStyle = 'rgba(196,83,63,.55)'; cx.fillRect(x * tam, y * tam, tam, tam); continue; }
        cx.globalAlpha = opaca ? 1 : 0.45;
        const img = t.invisible ? null : imagenTile(t.imagen);
        if (img) { cx.drawImage(img, x * tam, y * tam, tam, tam); cx.globalAlpha = 1; continue; }
        if (t.color && !t.invisible) { cx.globalAlpha *= (n === 1 && tieneFondo ? 0.6 : 1); cx.fillStyle = t.color; cx.fillRect(x * tam, y * tam, tam, tam); }
        else { cx.fillStyle = 'rgba(111,183,168,.18)'; cx.fillRect(x * tam, y * tam, tam, tam); cx.strokeStyle = 'rgba(111,183,168,.7)'; cx.setLineDash([3, 3]); cx.strokeRect(x * tam + 1.5, y * tam + 1.5, tam - 3, tam - 3); cx.setLineDash([]); }
        cx.globalAlpha = 1;
      }
    };
    pintarCapa(1);
    // Lados cerrados (vallas…): una línea marrón en ese borde de la casilla
    cx.strokeStyle = '#c98a44'; cx.lineWidth = Math.max(2, tam * 0.1); cx.lineCap = 'round';
    for (let y = 0; y < A; y++) for (let x = 0; x < W; x++) {
      const t = tiles()[idEnCelda(x, y)];
      if (!t?.bloquea_lados?.length) continue;
      const i = tam * 0.08;
      cx.beginPath();
      for (const l of t.bloquea_lados) {
        if (l === 'norte') { cx.moveTo(x * tam + i, y * tam + i); cx.lineTo((x + 1) * tam - i, y * tam + i); }
        if (l === 'sur') { cx.moveTo(x * tam + i, (y + 1) * tam - i); cx.lineTo((x + 1) * tam - i, (y + 1) * tam - i); }
        if (l === 'oeste') { cx.moveTo(x * tam + i, y * tam + i); cx.lineTo(x * tam + i, (y + 1) * tam - i); }
        if (l === 'este') { cx.moveTo((x + 1) * tam - i, y * tam + i); cx.lineTo((x + 1) * tam - i, (y + 1) * tam - i); }
      }
      cx.stroke();
    }
    cx.lineCap = 'butt';
    pintarCapa(2);
    if (verRejilla) {
      cx.strokeStyle = 'rgba(255,255,255,.16)'; cx.lineWidth = 1; cx.beginPath();
      for (let x = 0; x <= W; x++) { cx.moveTo(x * tam + .5, 0); cx.lineTo(x * tam + .5, A * tam); }
      for (let y = 0; y <= A; y++) { cx.moveTo(0, y * tam + .5); cx.lineTo(W * tam, y * tam + .5); }
      cx.stroke();
    }
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    if (tam >= 22) {                                   // marcas pequeñas de lo que hace cada tile
      cx.font = `${Math.round(tam * .34)}px "Segoe UI Emoji", sans-serif`;
      for (let y = 0; y < A; y++) for (let x = 0; x < W; x++) {
        const t = tiles()[idEnCelda(x, y)];
        if (!t) continue;
        marcasDe(t).filter(([e]) => e !== '🚫' || t.invisible || (!t.color && !t.imagen)).forEach(([e], i) => cx.fillText(e, x * tam + tam * (0.22 + 0.28 * (i % 3)), y * tam + tam * (i < 3 ? 0.22 : 0.5)));
      }
    }
    cx.font = `${Math.round(tam * .62)}px "Segoe UI Emoji", sans-serif`;
    m.objetos.forEach((o, i) => {
      const w = anchoDe(o) * tam, a = altoDe(o) * tam, img = imagenTile(o.imagen);
      if (img) cx.drawImage(img, o.x * tam, o.y * tam, w, a);
      else { cx.fillStyle = o.bloquea ? 'rgba(120,80,40,.9)' : 'rgba(90,110,60,.9)'; cx.fillRect(o.x * tam + 3, o.y * tam + 3, w - 6, a - 6); cx.fillStyle = '#fff'; icono(cx, 'paquete', '📦', o.x * tam + w / 2, o.y * tam + a / 2, Math.min(w, a) * 0.6); }
      if (i === sel) {
        cx.strokeStyle = '#f0b44c'; cx.lineWidth = 2; cx.setLineDash([5, 3]); cx.strokeRect(o.x * tam + 1, o.y * tam + 1, w - 2, a - 2); cx.setLineDash([]);
        cx.fillStyle = '#f0b44c'; cx.strokeStyle = '#10141a'; cx.lineWidth = 1.5;
        for (const asa of ASAS) { const q = posAsa(o, asa); cx.fillRect(q.x - 5, q.y - 5, 10, 10); cx.strokeRect(q.x - 5, q.y - 5, 10, 10); }
      }
    });
    for (const q of m.puntos) icono(cx, 'punto', '📍', q.x * tam + tam / 2, q.y * tam + tam / 2, tam * 0.7);
    if (m.inicio) icono(cx, 'estrella', '⭐', m.inicio.x * tam + tam / 2, m.inicio.y * tam + tam / 2, tam * 0.7);
    pintarCapa(3);
    if (herramienta === 'fondo' && tieneFondo) {
      const r = rectFondo();
      cx.save();
      cx.strokeStyle = '#f0b44c'; cx.lineWidth = 2; cx.setLineDash([6, 4]);
      cx.strokeRect(r.x * tam, r.y * tam, r.ancho * tam, r.alto * tam);
      cx.setLineDash([]); cx.fillStyle = '#f0b44c'; cx.strokeStyle = '#10141a'; cx.lineWidth = 1.5;
      for (const a of ASAS_FONDO) { const q = posAsaFondo(a); const t = a.length === 2 ? 12 : 9; cx.fillRect(q.x - t / 2, q.y - t / 2, t, t); cx.strokeRect(q.x - t / 2, q.y - t / 2, t, t); }
      cx.restore();
    }
    if (previa) { cx.strokeStyle = '#f0b44c'; cx.lineWidth = 2; cx.strokeRect(previa.x0 * tam + 1, previa.y0 * tam + 1, (previa.x1 - previa.x0 + 1) * tam - 2, (previa.y1 - previa.y0 + 1) * tam - 2); }
  }
  const cargarFondo = () => {
    fondo = null;
    if (m.fondo && E.cliente?.conectada) { fondo = new Image(); fondo.onload = () => { dibujar(); pintarLateral(); }; fondo.onerror = () => { fondo = null; dibujar(); }; fondo.src = urlAsset(m.fondo); }
  };

  /** Punto del ratón en casillas con decimales y en píxeles del lienzo. */
  const punto = (e) => {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (canvas.width / r.width), py = (e.clientY - r.top) * (canvas.height / r.height);
    return { px, py, fx: px / tam, fy: py / tam };
  };
  const elegirObjeto = (i) => { sel = i; dibujar(); pintarLateral(); };
  const celda = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / m.ancho)), y = Math.floor((e.clientY - r.top) / (r.height / m.alto));
    return (x >= 0 && y >= 0 && x < m.ancho && y < m.alto) ? { x, y } : null;
  };
  const poner = (x, y, id) => { if (celdas[y][x] !== id) { celdas[y][x] = id; return true; } return false; };
  function rellenar(c, id) {
    const objetivo = celdas[c.y][c.x];
    if (objetivo === id) return false;
    const pila = [[c.x, c.y]];
    while (pila.length) {
      const [x, y] = pila.pop();
      if (x < 0 || y < 0 || x >= m.ancho || y >= m.alto || celdas[y][x] !== objetivo) continue;
      celdas[y][x] = id;
      pila.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return true;
  }
  const sinPincel = () => { toast('Primero elige o crea un tile en la paleta de la izquierda.', 'info', 2500); };

  async function alPulsar(c) {
    if (herramienta === 'pintar' || herramienta === 'borrar') {
      if (herramienta === 'pintar' && !pincel) { sinPincel(); arrastre = null; return; }
      if (poner(c.x, c.y, herramienta === 'pintar' ? pincel : '')) { dibujar(); cambiar(); }
    } else if (herramienta === 'rellenar') {
      if (!pincel) { sinPincel(); return; }
      if (rellenar(c, pincel)) { dibujar(); cambiar(); }
    } else if (herramienta === 'inicio') { m.inicio = { x: c.x, y: c.y }; dibujar(); ctx.alCambiar(); pintarLateral(); }
    else if (herramienta === 'punto' || herramienta === 'objeto') {
      const esPunto = herramienta === 'punto';
      if (!esPunto) { const i = objetoEn(c.x + 0.5, c.y + 0.5); if (i >= 0) { elegirObjeto(i); return; } }
      if (esPunto) {
        const nombre = await pedirTexto('Nuevo punto importante', 'Nombre', 'Punto');
        if (!nombre) return;
        m.puntos.push({ nombre, x: c.x, y: c.y });
      } else {
        const o = await dialogoObjetoNuevo(c);
        if (!o) return;
        m.objetos.push(o);
        sel = m.objetos.length - 1;
      }
      dibujar(); ctx.alCambiar(); pintarLateral();
    } else if (herramienta === 'quitar') {
      const antes = m.puntos.length + m.objetos.length;
      m.puntos = m.puntos.filter((q) => !(q.x === c.x && q.y === c.y));
      const i = objetoEn(c.x + 0.5, c.y + 0.5);
      if (i >= 0) { m.objetos.splice(i, 1); sel = -1; }
      if (m.puntos.length + m.objetos.length !== antes) { dibujar(); ctx.alCambiar(); pintarLateral(); }
    }
  }

  /** «Nuevo objeto»: nombre, imagen (con la galería), tamaño y si bloquea, todo de una vez. → objeto o null. */
  async function dialogoObjetoNuevo(c) {
    const o = { nombre: 'Barril', x: c.x, y: c.y, bloquea: true };
    const sinCambios = { alCambiar: () => {}, propioId: null };
    const tam = (k) => {
      const n = h('input', { class: 'entrada entrada-num', type: 'number', min: 0.25, max: 50, step: 0.25, value: '1', 'aria-label': k === 'ancho' ? 'Ancho del objeto' : 'Alto del objeto', 'data-tam-nuevo': k });
      n.addEventListener('change', () => {
        const lim = k === 'ancho' ? m.ancho - o.x : m.alto - o.y;
        const v = Math.min(lim, Math.max(0.25, cuarto(Number(String(n.value).replace(',', '.')) || 1)));
        n.value = v; if (v === 1) delete o[k]; else o[k] = v;
      });
      return n;
    };
    const bloquea = h('input', { type: 'checkbox', checked: true, 'data-campo-nuevo': 'bloquea' });
    bloquea.addEventListener('change', () => { o.bloquea = bloquea.checked; });
    const r = await dialogo({ titulo: 'Nuevo objeto', contenido: h('div', { class: 'campos-dialogo objeto-nuevo' },
      construirCampo({ t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true }, o, sinCambios),
      construirCampo({ t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'otros' }, o, sinCambios),
      h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Tamaño (casillas)'), h('div', { class: 'fila-inline' }, 'Ancho', tam('ancho'), 'Alto', tam('alto')),
        h('p', { class: 'ayuda' }, 'Luego también puedes moverlo y estirarlo arrastrando sus esquinas con la herramienta 📦 Objeto (O).')),
      h('label', { class: 'interruptor' }, bloquea, h('span', { class: 'pista' }), h('span', null, 'Bloquea el paso'))),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Poner objeto', valor: 'ok', clase: 'btn-acento' }],
    alMostrar: (caja, cierre) => { const n = caja.querySelector('[data-campo="nombre"]'); n?.select(); n?.addEventListener('keydown', (e) => { if (e.key === 'Enter') cierre('ok'); }); } });
    if (r !== 'ok' || !String(o.nombre || '').trim()) return null;
    o.nombre = o.nombre.trim();
    if (!o.imagen) delete o.imagen;
    return o;
  }

  const scroll = h('div', { class: 'mapa-scroll' }, canvas);
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && espacio)) { e.preventDefault(); arrastre = { mano: true, x: e.clientX, y: e.clientY, sx: scroll.scrollLeft, sy: scroll.scrollTop }; canvas.classList.add('agarrando'); return; }
    if (e.button !== 0) return;
    if (herramienta === 'fondo') {          // las asas pueden quedar justo en el borde del lienzo
      if (!m.fondo || !fondo?.naturalWidth) { toast('Primero importa la imagen del mapa (panel derecho).', 'info', 3000); return; }
      const p = punto(e);
      const asa = asaFondoEn(p.px, p.py), r = rectFondo();
      const dentro = p.fx >= r.x && p.fy >= r.y && p.fx <= r.x + r.ancho && p.fy <= r.y + r.alto;
      if (asa || dentro) arrastre = { fondo: asa || 'mover', ini: { ...r }, fx: p.fx, fy: p.fy };
      return;
    }
    const c = celda(e); if (!c) return;
    if (herramienta === 'objeto') {          // con 📦 Objeto se ponen objetos y también se eligen, mueven y estiran
      const p = punto(e), asa = asaEn(p.px, p.py);
      if (asa) { const o = m.objetos[sel]; arrastre = { asa, o, x1: o.x + anchoDe(o), y1: o.y + altoDe(o) }; return; }
      const i = objetoEn(p.fx, p.fy);
      if (i >= 0) { elegirObjeto(i); const o = m.objetos[i]; arrastre = { moviendo: o, dx: p.fx - o.x, dy: p.fy - o.y }; return; }
    }
    if (herramienta === 'rectangulo') { if (!pincel) { sinPincel(); return; } arrastre = { rect: true, x0: c.x, y0: c.y, x1: c.x, y1: c.y }; dibujar(arrastre); }
    else { if (herramienta === 'pintar' || herramienta === 'borrar') arrastre = { pintando: true }; alPulsar(c); }
  });
  canvas.addEventListener('mousemove', (e) => {
    if (arrastre?.mano) { scroll.scrollLeft = arrastre.sx - (e.clientX - arrastre.x); scroll.scrollTop = arrastre.sy - (e.clientY - arrastre.y); return; }
    const c = celda(e);
    if (c) { const id = idEnCapa(capaActiva, c.x, c.y); info.textContent = `Casilla ${c.x}, ${c.y} (capa ${capaActiva}) — ${id ? (tiles()[id]?.nombre || '⚠️ tile que ya no existe') : (capaActiva === 1 ? 'suelo libre' : 'vacía')}`; } else info.textContent = '';
    if (arrastre?.fondo) {
      const p = punto(e), { ini } = arrastre, a = arrastre.fondo;
      const dx = p.fx - arrastre.fx, dy = p.fy - arrastre.fy;
      let { x, y, ancho, alto } = ini;
      if (a === 'mover') { x += dx; y += dy; }
      else {
        if (a.includes('e')) ancho = Math.max(0.5, ini.ancho + dx);
        if (a.includes('o')) { ancho = Math.max(0.5, ini.ancho - dx); x = ini.x + ini.ancho - ancho; }
        if (a.startsWith('s')) alto = Math.max(0.5, ini.alto + dy);
        if (a.startsWith('n')) { alto = Math.max(0.5, ini.alto - dy); y = ini.y + ini.alto - alto; }
        if (proporcion && a.length === 2 && fondo?.naturalWidth) {          // esquina: sin deformar la imagen
          const ratio = fondo.naturalWidth / fondo.naturalHeight;
          alto = ancho / ratio;
          if (a.startsWith('n')) y = ini.y + ini.alto - alto;
        }
      }
      m.fondo_ajuste = { x: redondear(x), y: redondear(y), ancho: redondear(ancho), alto: redondear(alto) };
      arrastre.cambio = true; dibujar();
      info.textContent = `Imagen: ${m.fondo_ajuste.ancho} × ${m.fondo_ajuste.alto} casillas, en (${m.fondo_ajuste.x}, ${m.fondo_ajuste.y})`;
      return;
    }
    if (arrastre?.moviendo || arrastre?.asa) {
      const p = punto(e), o = arrastre.moviendo || arrastre.o;
      if (arrastre.moviendo) {
        const nx = Math.min(Math.max(0, Math.round(p.fx - arrastre.dx)), Math.max(0, Math.floor(m.ancho - anchoDe(o))));
        const ny = Math.min(Math.max(0, Math.round(p.fy - arrastre.dy)), Math.max(0, Math.floor(m.alto - altoDe(o))));
        if (nx !== o.x || ny !== o.y) { o.x = nx; o.y = ny; arrastre.cambio = true; dibujar(); }
      } else {
        const { asa } = arrastre;
        // Las esquinas de la derecha y de abajo cambian el tamaño en cuartos de casilla; las de arriba/izquierda mueven además la casilla de inicio.
        if (asa[1] === 'e') o.ancho = Math.min(Math.max(0.25, cuarto(p.fx - o.x)), m.ancho - o.x);
        else { const nx = Math.min(Math.max(0, Math.round(p.fx)), Math.ceil(arrastre.x1) - 1); o.ancho = Math.max(0.25, cuarto(arrastre.x1 - nx)); o.x = nx; }
        if (asa[0] === 's') o.alto = Math.min(Math.max(0.25, cuarto(p.fy - o.y)), m.alto - o.y);
        else { const ny = Math.min(Math.max(0, Math.round(p.fy)), Math.ceil(arrastre.y1) - 1); o.alto = Math.max(0.25, cuarto(arrastre.y1 - ny)); o.y = ny; }
        if (o.ancho === 1) delete o.ancho;
        if (o.alto === 1) delete o.alto;
        arrastre.cambio = true; dibujar();
      }
      return;
    }
    if (herramienta === 'objeto') {
      const p = punto(e);
      canvas.style.cursor = asaEn(p.px, p.py) ? 'nwse-resize' : objetoEn(p.fx, p.fy) >= 0 ? 'move' : '';
    } else if (herramienta === 'fondo') {
      const p = punto(e), a = asaFondoEn(p.px, p.py);
      canvas.style.cursor = a ? ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', o: 'ew-resize', no: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', so: 'nesw-resize' })[a] : 'move';
    } else canvas.style.cursor = '';
    if (!arrastre || !c) return;
    if (arrastre.pintando) { if (poner(c.x, c.y, herramienta === 'pintar' ? pincel : '')) { dibujar(); cambiar(); } }
    else if (arrastre.rect) { arrastre.x1 = c.x; arrastre.y1 = c.y; dibujar(arrastre); }
  });
  const soltar = () => {
    if (!arrastre) return;
    if (arrastre.rect) {
      const { x0, y0, x1, y1 } = arrastre;
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) celdas[y][x] = pincel;
      cambiar();
    }
    if (arrastre.cambio) { ctx.alCambiar(); pintarLateral(); }
    arrastre = null; canvas.classList.remove('agarrando'); dibujar();
  };
  window.addEventListener('mouseup', soltar); desmontar.push(() => window.removeEventListener('mouseup', soltar));
  canvas.addEventListener('mouseleave', () => { info.textContent = ''; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); ponerZoom(tam * (e.deltaY < 0 ? 1.12 : 0.89));
  }, { passive: false });

  // ── Teclado del editor de mapas ──
  const alTecla = (e) => {
    if (!canvas.isConnected) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || ['TEXTAREA', 'SELECT'].includes(t.tagName) || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type)))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { if (!espacio) { espacio = true; canvas.classList.add('mano'); } e.preventDefault(); return; }
    if (['1', '2', '3'].includes(e.key)) { elegirCapa(Number(e.key)); e.preventDefault(); return; }
    const id = TECLA_A_HERRAMIENTA[e.key.toLowerCase()];
    if (id) { elegirHerramienta(id); e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') ponerZoom(tam * 1.15);
    else if (e.key === '-') ponerZoom(tam / 1.15);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && m.objetos[sel]) { m.objetos.splice(sel, 1); sel = -1; ctx.alCambiar(); dibujar(); pintarLateral(); e.preventDefault(); }
    else if (e.key === 'Escape' && sel !== -1) elegirObjeto(-1);
    else if (e.key.toLowerCase() === 'h') { verRejilla = !verRejilla; rejillaBtn.setAttribute('aria-pressed', String(verRejilla)); dibujar(); }
  };
  const alSoltarTecla = (e) => { if (e.code === 'Space') { espacio = false; canvas.classList.remove('mano'); } };
  document.addEventListener('keydown', alTecla); document.addEventListener('keyup', alSoltarTecla);
  desmontar.push(() => { document.removeEventListener('keydown', alTecla); document.removeEventListener('keyup', alSoltarTecla); });

  // ── Herramientas y zoom ──
  const botones = HERRAMIENTAS.map(([id, ico, nombre, tecla, ayuda]) => h('button', { type: 'button', class: 'herramienta', 'data-herr': id, title: `${ayuda} (${tecla})`, 'aria-pressed': String(id === herramienta),
    onclick: () => elegirHerramienta(id) }, h('span', null, ico), nombre, h('kbd', { class: 'tecla-mini' }, tecla)));
  const botonesCapa = CAPAS.map(([n, nombre, ayuda]) => h('button', { type: 'button', class: 'herramienta', 'data-capa': String(n), title: `${ayuda} (${n})`, 'aria-pressed': String(n === capaActiva),
    onclick: () => elegirCapa(n) }, `${n} · ${nombre}`));
  function elegirCapa(n) {
    capaActiva = n; celdas = rejillas[n];
    botonesCapa.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.capa === String(n))));
    avisoCapa.hidden = n === 1;
    dibujar();
  }
  const avisoCapa = h('span', { class: 'tenue pequeno', hidden: true }, 'Las capas 2 y 3 son solo decoración: no bloquean ni dañan.');
  function elegirHerramienta(id) {
    const antes = herramienta;
    herramienta = id; botones.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.herr === id)));
    if (id === 'fondo') sel = -1;          // con la imagen no se ven las asas de un objeto elegido
    if (antes === 'fondo' || id === 'fondo') { dibujar(); pintarLateral(); }
  }
  const zoom = h('input', { type: 'range', min: 8, max: 96, value: tam, 'aria-label': 'Zoom' });
  function ponerZoom(n) { tam = Math.round(Math.min(96, Math.max(8, n))); zoom.value = tam; dibujar(); }
  zoom.addEventListener('input', () => ponerZoom(Number(zoom.value)));
  const rejillaBtn = h('button', { type: 'button', class: 'herramienta', 'aria-pressed': 'true', title: 'Mostrar u ocultar la cuadrícula (H)', onclick: () => { verRejilla = !verRejilla; rejillaBtn.setAttribute('aria-pressed', String(verRejilla)); dibujar(); } }, '▦ Cuadrícula');
  const ajustar = h('button', { type: 'button', class: 'herramienta', title: 'Ajustar el mapa al espacio disponible', onclick: () => ponerZoom(Math.min(scroll.clientWidth / m.ancho, 800 / m.alto)) }, '⤢ Ajustar');
  const vaciar = h('button', { type: 'button', class: 'herramienta', 'data-accion': 'vaciar-capa', title: 'Borra todos los tiles pintados en la capa que estás editando. No toca las otras capas, la imagen de fondo, los objetos ni los puntos. Se puede deshacer (Ctrl+Z).',
    onclick: () => {
      if (!confirm(`¿Borrar toda la capa ${capaActiva}? Se puede deshacer con Ctrl+Z.`)) return;
      rejillas[capaActiva] = Array.from({ length: m.alto }, () => Array(m.ancho).fill(''));
      celdas = rejillas[capaActiva];
      volcar(); dibujar();
    } }, '🧽 Borrar toda la capa');
  const barra = h('div', { class: 'mapa-barra' }, h('span', { class: 'mapa-capas', role: 'group', 'aria-label': 'Capa que se edita' }, botonesCapa), avisoCapa, botones, h('span', { class: 'mapa-zoom' }, '🔍', zoom), ajustar, rejillaBtn, vaciar);

  // ── Paleta de tiles ──
  const paleta = h('aside', { class: 'mapa-paleta', 'aria-label': 'Paleta de tiles' });
  async function dialogoTileRapido() {
    const nombre = h('input', { type: 'text', class: 'entrada', maxlength: '40', placeholder: 'Por ejemplo: Muro, Agua, Hierba alta', 'aria-label': 'Nombre del tile' });
    const color = h('input', { type: 'color', class: 'selector-color', value: '#6b7a55', 'aria-label': 'Color' });
    const trans = h('input', { type: 'checkbox', checked: true });
    const r = await dialogo({ titulo: 'Nuevo tile', contenido: h('div', { class: 'campos-dialogo' },
      h('label', null, 'Nombre', nombre), h('label', { class: 'fila-inline' }, 'Color', color),
      h('label', { class: 'interruptor' }, trans, h('span', { class: 'pista' }), h('span', null, 'Se puede pasar')),
      h('p', { class: 'ayuda' }, 'Luego puedes abrirlo con ✎ para darle imagen, esconder, hacerlo rompible o añadir efectos.')),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Crear tile', valor: 'ok', clase: 'btn-acento' }],
    alMostrar: (_c, cierre) => nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') cierre('ok'); }) });
    if (r !== 'ok' || !nombre.value.trim()) return;
    const id = await nuevo('tiles', { color: color.value, transitable: trans.checked }, { nombre: nombre.value.trim(), abrir: false });
    pincel = id; elegirHerramienta('pintar'); pintarPaleta(); dibujar();
  }
  function pintarPaleta() {
    const todos = Object.entries(tiles()).map(([id, t]) => ({ id, ...t })).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    if (pincel && !tiles()[pincel]) pincel = todos[0]?.id || '';
    const miniatura = (t) => { const img = t.imagen && E.cliente?.conectada ? h('img', { src: urlAsset(t.imagen), alt: '' }) : null; return h('span', { class: 'muestra-tile', style: { background: t.color || 'transparent' }, 'data-sin-grafico': !t.color && !t.imagen ? 'sí' : null }, img); };
    const filas = todos.map((t) => h('div', { class: `tile-fila${t.id === pincel ? ' actual' : ''}`, 'data-tile': t.id },
      h('button', { type: 'button', class: 'tile-elegir', 'aria-pressed': String(t.id === pincel), title: t.descripcion || t.nombre, onclick: () => { pincel = t.id; if (!['pintar', 'rellenar', 'rectangulo'].includes(herramienta)) elegirHerramienta('pintar'); pintarPaleta(); } },
        miniatura(t), h('span', { class: 'tile-nombre' }, t.nombre || t.id), h('span', { class: 'tile-marcas' }, marcasDe(t).map(([e, tt]) => h('span', { title: tt }, e)))),
      h('button', { type: 'button', class: 'btn btn-mini', title: 'Editar este tile (imagen, efectos…)', 'aria-label': `Editar ${t.nombre}`, onclick: () => irA('tiles', t.id) }, '✎')));
    const base = h('label', { class: 'mini-campo' }, 'Suelo base del mapa',
      (() => { const s = h('select', { class: 'entrada', 'data-campo': 'tile_base' }, h('option', { value: '' }, '(nada: suelo libre)'), todos.map((t) => h('option', { value: t.id }, t.nombre)));
        s.value = m.tile_base || ''; s.addEventListener('change', () => { if (s.value) m.tile_base = s.value; else delete m.tile_base; ctx.alCambiar(); cambiar(); dibujar(); }); return s; })());
    paleta.replaceChildren(h('h3', null, 'Tiles'),
      todos.length ? h('div', { class: 'tile-lista' }, filas) : h('p', { class: 'ayuda' }, 'Aún no hay tiles. Un tile es un tipo de casilla (muro, agua, hierba…). Crea el primero para empezar a pintar.'),
      h('button', { type: 'button', class: 'btn btn-acento', onclick: dialogoTileRapido }, '＋ Nuevo tile'), base);
  }

  // ── Panel lateral: propiedades ──
  const lat = h('div', { class: 'mapa-lateral' });
  const avisos = h('div', { class: 'mapa-avisos' });
  function pintarAvisos() {
    const n = huerfanas();
    avisos.replaceChildren(n ? h('div', { class: 'aviso-caja' }, `⚠️ ${n} casillas usan un tile que ya no existe (se ven en rojo). `,
      h('button', { type: 'button', class: 'enlace', onclick: () => { for (const k of [1, 2, 3]) for (const f of rejillas[k]) for (let x = 0; x < f.length; x++) if (f[x] && !tiles()[f[x]]) f[x] = ''; cambiar(); dibujar(); } }, 'Quitarlas')) : '');
  }
  function redimensionar(ancho, alto) {
    ancho = Math.min(200, Math.max(1, ancho)); alto = Math.min(200, Math.max(1, alto));
    for (const k of [1, 2, 3]) rejillas[k] = Array.from({ length: alto }, (_, y) => Array.from({ length: ancho }, (_, x) => rejillas[k][y]?.[x] ?? ''));
    celdas = rejillas[capaActiva]; m.ancho = ancho; m.alto = alto;
    m.puntos = m.puntos.filter((q) => q.x < ancho && q.y < alto);
    m.objetos = m.objetos.filter((q) => q.x < ancho && q.y < alto);
    for (const q of m.objetos) { if (q.x + anchoDe(q) > ancho) q.ancho = Math.max(0.25, ancho - q.x); if (q.y + altoDe(q) > alto) q.alto = Math.max(0.25, alto - q.y); }
    sel = -1;
    m.inicio = { x: Math.min(m.inicio.x, ancho - 1), y: Math.min(m.inicio.y, alto - 1) };
    cambiar(); dibujar(); pintarLateral();
  }
  const numeroCelda = (obj, k, max) => { const n = h('input', { class: 'entrada entrada-num', type: 'number', min: 0, max, 'aria-label': k.toUpperCase() }); n.value = obj[k];
    n.addEventListener('input', () => { obj[k] = Math.min(max, Math.max(0, entero(n.value, 0))); ctx.alCambiar(); dibujar(); }); return n; };

  async function importarFondo() {
    try {
      if (!(await asegurarCliente())) return;
      const nuevos = await window.editor.importar('maps');
      if (!nuevos.length) return;
      await recargarAssets();
      m.fondo = nuevos[0];
      ctx.alCambiar(); cargarFondo();
      const img = new Image();
      img.onload = () => {
        if (!Object.keys(m.casillas).length) { ajustarAImagen(img); toast('Imagen importada. Ajusté la cuadrícula a su tamaño; ahora pinta los tiles que importan (muros, agua…).', 'ok', 5000); }
        else toast('Imagen importada. Usa «Ajustar cuadrícula a la imagen» si quieres que la cuadrícula coincida.', 'ok', 5000);
      };
      img.src = urlAsset(m.fondo);
    } catch (e) { toast(e.message, 'error'); }
  }
  function ajustarAImagen(img = fondo) {
    if (!img?.naturalWidth) return;
    const t = m.tamano_tile || 64;
    redimensionar(Math.round(img.naturalWidth / t), Math.round(img.naturalHeight / t));
    ponerZoom(Math.min(scroll.clientWidth / m.ancho, 800 / m.alto) || tam);
  }

  /** Posición y tamaño de la imagen de fondo: con el ratón (herramienta 🖼️ Imagen) o escribiendo los números. */
  function ajusteFondo() {
    const r = rectFondo();
    const num = (k, etiqueta) => {
      const n = h('input', { class: 'entrada entrada-num', type: 'number', step: 0.25, 'aria-label': etiqueta, 'data-fondo': k });
      n.value = r[k];
      n.addEventListener('change', () => {
        const v = Number(String(n.value).replace(',', '.'));
        if (!Number.isFinite(v)) { n.value = rectFondo()[k]; return; }
        const nuevo = { ...rectFondo(), [k]: redondear(k === 'ancho' || k === 'alto' ? Math.max(0.5, v) : v) };
        if (proporcion && fondo?.naturalWidth && (k === 'ancho' || k === 'alto')) {
          const ratio = fondo.naturalWidth / fondo.naturalHeight;
          if (k === 'ancho') nuevo.alto = redondear(nuevo.ancho / ratio); else nuevo.ancho = redondear(nuevo.alto * ratio);
        }
        m.fondo_ajuste = nuevo; ctx.alCambiar(); dibujar(); pintarLateral();
      });
      return h('label', { class: 'mini-campo' }, etiqueta, n);
    };
    const prop = h('input', { type: 'checkbox', 'data-campo': 'proporcion' });
    prop.checked = proporcion;
    prop.addEventListener('change', () => { proporcion = prop.checked; });
    const real = () => {
      if (!fondo?.naturalWidth) return;
      const t = m.tamano_tile || 64;
      m.fondo_ajuste = { x: 0, y: 0, ancho: redondear(fondo.naturalWidth / t), alto: redondear(fondo.naturalHeight / t) };
      ctx.alCambiar(); dibujar(); pintarLateral();
    };
    return h('div', { class: 'campo ajuste-fondo' }, h('label', { class: 'campo-etiqueta' }, 'Posición y tamaño de la imagen (en casillas)'),
      h('div', { class: 'fila-inline envolver' }, num('x', 'X'), num('y', 'Y'), num('ancho', 'Ancho'), num('alto', 'Alto')),
      h('label', { class: 'fila-inline' }, prop, ' Mantener la proporción de la imagen'),
      h('div', { class: 'fila-botones' },
        h('button', { type: 'button', class: `btn${herramienta === 'fondo' ? ' btn-acento' : ''}`, 'data-accion': 'ajustar-fondo', onclick: () => elegirHerramienta(herramienta === 'fondo' ? 'pintar' : 'fondo') },
          herramienta === 'fondo' ? '✓ Terminar de ajustar' : '🖼️ Ajustar con el ratón'),
        h('button', { type: 'button', class: 'btn', 'data-accion': 'fondo-encajar', title: 'La imagen ocupa el mapa justo', onclick: () => { delete m.fondo_ajuste; ctx.alCambiar(); dibujar(); pintarLateral(); } }, 'Encajar en el mapa'),
        h('button', { type: 'button', class: 'btn', 'data-accion': 'fondo-real', title: 'Según «Tamaño de cada casilla» (píxeles de la imagen por casilla)', onclick: real }, 'Tamaño real')),
      h('p', { class: 'ayuda' }, 'Con «Ajustar con el ratón» (tecla F) arrastra la imagen para moverla y sus bordes o esquinas para estirarla hasta que encaje con la cuadrícula. Lo que sobresalga del mapa no se ve en la partida.'));
  }

  function pintarLateral() {
    const infoImg = fondo?.naturalWidth ? `Imagen de ${fondo.naturalWidth}×${fondo.naturalHeight} px` : null;
    const fondoSec = h('section', { class: 'bloque' }, h('h3', null, 'Imagen del mapa'),
      m.fondo ? h('p', { class: 'tenue pequeno' }, `🖼️ ${m.fondo.split('/').pop()}${infoImg ? ` — ${infoImg}` : ''}`) : h('p', { class: 'ayuda' }, 'Importa la imagen de tu mapa y pinta encima solo lo que importa: muros, agua, hierba alta…'),
      h('div', { class: 'fila-botones' },
        h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'importar-fondo', onclick: importarFondo }, m.fondo ? '📥 Cambiar imagen…' : '📥 Importar imagen…'),
        m.fondo ? h('button', { type: 'button', class: 'btn', onclick: () => { delete m.fondo_ajuste; ajustarAImagen(); } }, 'Ajustar cuadrícula a la imagen') : null,
        m.fondo ? h('button', { type: 'button', class: 'btn', onclick: () => { delete m.fondo; ctx.alCambiar(); cargarFondo(); dibujar(); pintarLateral(); } }, 'Quitar') : null),
      construirCampo({ t: 'numero', k: 'tamano_tile', etiqueta: 'Tamaño de cada casilla', sufijo: 'píxeles', min: 16, max: 256, defecto: 64, ayuda: 'En la imagen original: define cuántas casillas caben. Después pulsa «Ajustar cuadrícula».' }, m, ctx),
      m.fondo ? ajusteFondo() : null);
    const datos = h('section', { class: 'bloque' }, h('h3', null, 'Datos del mapa'),
      construirCampo({ t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true }, m, ctx),
      construirCampo({ t: 'largo', k: 'descripcion', etiqueta: 'Descripción' }, m, ctx),
      construirCampo({ t: 'interruptor', k: 'niebla', etiqueta: 'Niebla de guerra en este mapa', defecto: true, ayuda: 'Solo tiene efecto si la campaña activa la niebla (Reglas → Niebla de guerra). Apágalo aquí para mapas pequeños o de ciudad donde todos deben verlo todo.' }, m, ctx),
      (() => {
        const a = h('input', { class: 'entrada entrada-num', type: 'number', min: 1, max: 200, 'aria-label': 'Ancho', 'data-campo': 'ancho' }); a.value = m.ancho;
        const l = h('input', { class: 'entrada entrada-num', type: 'number', min: 1, max: 200, 'aria-label': 'Alto', 'data-campo': 'alto' }); l.value = m.alto;
        const aplicar = () => redimensionar(entero(a.value, m.ancho), entero(l.value, m.alto));
        a.addEventListener('change', aplicar); l.addEventListener('change', aplicar);
        return h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Tamaño (casillas)'), h('div', { class: 'fila-inline' }, 'Ancho', a, 'Alto', l),
          h('p', { class: 'ayuda' }, 'Al reducir se recorta por la derecha y abajo.'));
      })());
    const puntos = h('details', { class: 'bloque plegable' }, h('summary', null, `Puntos importantes (${m.puntos.length})`),
      h('p', { class: 'ayuda' }, 'Marcas solo para el GM (una puerta, una tienda…). Herramienta 📍.'),
      ...m.puntos.map((q, i) => { const n = h('input', { class: 'entrada', type: 'text', maxlength: '40', 'aria-label': 'Nombre del punto' }); n.value = q.nombre; n.addEventListener('input', () => { q.nombre = n.value; ctx.alCambiar(); });
        return h('div', { class: 'fila-lista' }, n, numeroCelda(q, 'x', m.ancho - 1), numeroCelda(q, 'y', m.alto - 1), h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar punto', onclick: () => { m.puntos.splice(i, 1); ctx.alCambiar(); dibujar(); pintarLateral(); } }, '✕')); }));
    const ctxObj = { ...ctx, alCambiar: (k) => { ctx.alCambiar(k); dibujar(); } };
    const tamano = (q, k) => {
      const n = h('input', { class: 'entrada entrada-num', type: 'number', min: 0.25, max: 50, step: 0.25, 'aria-label': k === 'ancho' ? 'Ancho del objeto' : 'Alto del objeto', 'data-tam': k });
      n.value = q[k] || 1;
      n.addEventListener('change', () => {
        const lim = k === 'ancho' ? m.ancho - q.x : m.alto - q.y;
        const v = Math.min(lim, Math.max(0.25, cuarto(Number(String(n.value).replace(',', '.')) || 1)));
        if (v === 1) delete q[k]; else q[k] = v;
        n.value = v; ctx.alCambiar(); dibujar();
      });
      return n;
    };
    const elegido = m.objetos[sel];
    const ficha = elegido ? h('div', { class: 'objeto-elegido', 'data-objeto': String(sel) },
      h('div', { class: 'fila-inline' }, h('strong', null, `📦 ${elegido.nombre || 'Objeto'}`), h('button', { type: 'button', class: 'btn btn-mini', onclick: () => elegirObjeto(-1) }, 'Listo')),
      construirCampo({ t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true }, elegido, ctxObj),
      construirCampo({ t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'otros' }, elegido, ctxObj),
      h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Tamaño (casillas)'), h('div', { class: 'fila-inline' }, 'Ancho', tamano(elegido, 'ancho'), 'Alto', tamano(elegido, 'alto')),
        h('p', { class: 'ayuda' }, 'También puedes arrastrar sus esquinas en el mapa (admite cuartos de casilla: 1,5 · 2,25). La imagen se estira a ese tamaño.'))) : null;
    const objetos = h('details', { class: 'bloque plegable', open: elegido || m.objetos.length ? true : null }, h('summary', null, `Objetos del mapa (${m.objetos.length})`),
      h('p', { class: 'ayuda' }, 'Cosas colocadas sobre el mapa. «Bloquea» = no se puede atravesar. Herramienta 📦 Objeto para ponerlos y también para moverlos o cambiar su tamaño (o el botón 👆 de cada fila para elegirlo).'),
      ficha,
      ...m.objetos.map((q, i) => { const n = h('input', { class: 'entrada', type: 'text', maxlength: '40', 'aria-label': 'Nombre del objeto' }); n.value = q.nombre; n.addEventListener('input', () => { q.nombre = n.value; ctx.alCambiar(); });
        const b = h('input', { type: 'checkbox', 'aria-label': 'Bloquea' }); b.checked = !!q.bloquea; b.addEventListener('change', () => { q.bloquea = b.checked; ctx.alCambiar(); });
        const bv = h('input', { type: 'checkbox', 'aria-label': 'Tapa la vista' }); bv.checked = q.bloquea_vision ?? !!q.bloquea; bv.addEventListener('change', () => { q.bloquea_vision = bv.checked; ctx.alCambiar(); });
        // Destruible: cuántos golpes aguanta (0 = no se rompe). Roto, desaparece del mapa durante la partida.
        const dz = h('input', { class: 'entrada entrada-num', type: 'number', min: 0, max: 1000, step: 1, 'aria-label': `Golpes para romper ${q.nombre}`, 'data-objeto-destruible': String(i), style: { width: '4.5em' } });
        dz.value = String(q.destruible || 0);
        dz.addEventListener('input', () => { const v = Math.max(0, Math.min(1000, Math.trunc(Number(dz.value)) || 0)); if (v) q.destruible = v; else delete q.destruible; ctx.alCambiar(); });
        const mini = h('button', { type: 'button', class: 'btn btn-mini objeto-mini', title: 'Cambiar la imagen', 'aria-label': `Imagen de ${q.nombre}`, 'data-accion': 'imagen-objeto',
          onclick: async () => { const r = await elegirImagen({ carpeta: 'otros', actual: q.imagen || '', titulo: `Imagen de ${q.nombre}` }); if (r === null) return; if (r) q.imagen = r; else delete q.imagen; ctx.alCambiar(); dibujar(); pintarLateral(); } },
        q.imagen ? h('img', { src: urlAsset(q.imagen), alt: '' }) : '🖼️');
        return h('div', { class: `fila-lista${i === sel ? ' elegida' : ''}` }, mini, h('button', { type: 'button', class: 'btn btn-mini', title: 'Elegir para moverlo, cambiar su tamaño o su imagen', 'aria-label': `Elegir ${q.nombre}`, 'data-accion': 'elegir-objeto', onclick: () => { elegirHerramienta('objeto'); elegirObjeto(i); } }, '👆'),
          n, numeroCelda(q, 'x', m.ancho - 1), numeroCelda(q, 'y', m.alto - 1), h('label', { class: 'mini-campo', title: 'No se puede atravesar' }, 'Bloquea', b), h('label', { class: 'mini-campo', title: 'Con niebla de guerra, no se ve a través de este objeto' }, 'Tapa la vista', bv), h('label', { class: 'mini-campo', title: 'Golpes que aguanta antes de romperse y desaparecer (0 = no se rompe). Quién puede romper: Reglas → Funciones de la mesa → «¿Quién puede romper tiles y objetos?».' }, 'Se rompe con', dz), h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar objeto', onclick: () => { m.objetos.splice(i, 1); sel = -1; ctx.alCambiar(); dibujar(); pintarLateral(); } }, '✕')); }));
    lat.replaceChildren(fondoSec, datos, puntos, objetos);
  }

  // Si se edita o crea un tile en otra pestaña, la paleta y el mapa se actualizan.
  desmontar.push(bus.on('campana-cambiada', () => { pintarPaleta(); dibujar(); pintarAvisos(); }));
  desmontar.push(bus.on('guardado', () => { pintarPaleta(); dibujar(); pintarAvisos(); }));
  const alIconos = () => dibujar();
  document.addEventListener('iconos-mapa', alIconos);
  desmontar.push(() => document.removeEventListener('iconos-mapa', alIconos));
  desmontar.push(bus.on('restaurado', (q) => {
    if (q !== p) return;
    m.casillas ||= {}; m.objetos ||= []; m.puntos ||= []; m.inicio ||= { x: 0, y: 0 };
    leerCasillas(); celdas = rejillas[capaActiva];
    if (sel >= m.objetos.length) sel = -1;
    cargarFondo(); pintarLateral(); pintarAvisos(); dibujar();
  }));

  cargarFondo(); pintarPaleta(); pintarLateral(); pintarAvisos(); dibujar();
  const raiz = h('div', { class: 'mapa-editor' }, paleta,
    h('div', { class: 'mapa-zona' }, barra, avisos, scroll, info), lat);
  raiz.alQuitar = () => desmontar.forEach((f) => f());
  return raiz;
}
