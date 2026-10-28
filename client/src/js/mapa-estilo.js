// mapa-estilo.js — Lo común a todas las capas del mapa: colores, fuentes, iconos y el recorte de textos largos.
import { S } from './almacen.js';
import { ajustes } from './ajustes.js';

export const COLOR = {
  fondo: '#0d1214',
  suelo: '#4a5361',
  propio: '#6fb7a8',
  aliado: '#4f8fd1',
  neutral: '#d6b04a',
  enemigo: '#c4533f',
  turno: '#f0b44c',
  tinta: '#12161d',
};
export const FUENTE_TITULO = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
export const FUENTE_UI = '"Segoe UI", system-ui, sans-serif';

// Barras de recursos sobre los tokens: la vida va en verde/ámbar/rojo según lo que quede; las demás, con estos colores.
export const COLORES_BARRA = ['#7bc47f', '#4f8fd1', '#b07ad9', '#e0b04a'];
/** Qué barras dibujar: las que la campaña pone sobre los tokens, menos las que este jugador apagó (y, si así lo quiere, solo en los suyos). */
export function barrasVisibles(mio) {
  const todas = S.catalogo?.sobre_tokens?.barras || (S.catalogo?.recurso_vida ? [S.catalogo.recurso_vida] : []);
  if (!mio && ajustes.barrasAjenas === false) return [];
  return todas.filter((r) => ajustes.barras?.[r] !== false);
}


/** Recorta un texto con «…» para que no pase de `ancho` píxeles con la fuente actual del lienzo (con memoria: se dibuja muchas veces). */
const _recortes = new Map();
export function recortarTexto(ctx, texto, ancho) {
  const clave = `${ctx.font}|${Math.round(ancho)}|${texto}`;
  let r = _recortes.get(clave);
  if (r !== undefined) return r;
  r = texto;
  if (ctx.measureText(texto).width > ancho) {
    let lo = 0, hi = texto.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(`${texto.slice(0, m)}…`).width <= ancho) lo = m; else hi = m - 1; }
    r = `${[...texto.slice(0, lo)].join('').trimEnd()}…`;
  }
  if (_recortes.size > 2000) _recortes.clear();
  _recortes.set(clave, r);
  return r;
}

export const ICONO_ENLACE = Object.assign(new Image(), { src: 'img/interfaz/enlace.png' });
// El lápiz en pixel art (img/interfaz/lapiz.png, punta abajo a la izquierda): de cursor al dibujar y junto al nombre de quien dibuja.
export const ICONO_LAPIZ = Object.assign(new Image(), { src: 'img/interfaz/lapiz.png' });
let cursor = 'url("img/interfaz/lapiz.png") 1 14, crosshair';
ICONO_LAPIZ.addEventListener('load', () => {          // a 32 px (al doble, sin suavizar) se ve mejor como cursor
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(ICONO_LAPIZ, 0, 0, 32, 32);
    cursor = `url("${c.toDataURL('image/png')}") 2 29, crosshair`;
  } catch { /* se queda el de 16 px */ }
}, { once: true });

/** El cursor del lápiz (a 32 px en cuanto se carga la imagen). */
export const cursorLapiz = () => cursor;
