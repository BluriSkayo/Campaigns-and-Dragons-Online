// iconos.js — Iconos SVG sencillos (trazo), para no depender de fuentes ni emojis.
import { iconoPx } from './pixel.js';

const NS = 'http://www.w3.org/2000/svg';
// Los que tienen dibujo en pixel art (src/img/interfaz); el cursor, la mano, la regla y el lápiz siguen siendo de línea.
const PIXEL = { personaje: 'personaje', inventario: 'mochila', tienda: 'tiendas', dados: 'dado', ajustes: 'ajustes', cofre: 'paquete', reglas: 'diario', musica: 'musica', ojo: 'ojo', mas: 'mas', menos: 'menos', gm: 'escudo', salas: 'jugadores' };

const RUTAS = {
  cursor: 'M5 3v16l4.2-4 3 6.5 2.6-1.2-3-6.3H18z',
  mano: 'M8 13V6.5a1.5 1.5 0 013 0V11m0-4.5v-2a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v7c0 4-2.6 7-6.5 7-2.8 0-4.4-1.5-5.8-3.8L3.6 13.8a1.5 1.5 0 012.4-1.6L8 14.5',
  regla: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  lapiz: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19zM14 7l3 3',
  ojo: 'M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  mas: 'M12 5v14M5 12h14',
  menos: 'M5 12h14',
  reiniciar: 'M4 12a8 8 0 102.6-5.9M4 4v5h5',
  personaje: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 21c0-4.2 3.4-6.5 7.5-6.5s7.5 2.3 7.5 6.5',
  inventario: 'M6 8h12l1 12H5zM9 8V6.5a3 3 0 016 0V8',
  tienda: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0M9 20v-5h6v5',
  dados: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM12 12l8.5-4.7M12 12v9.5M12 12L3.5 7.3',
  ajustes: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  gm: 'M12 3l7.5 2.8v5.7c0 4.4-3.1 7.6-7.5 9-4.4-1.4-7.5-4.6-7.5-9V5.8z',
  cofre: 'M3 10h18v10H3zM3 10l2.5-5h13L21 10M10 14h4',
  reglas: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  salas: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  izquierda: 'M15 6l-6 6 6 6',
  derecha: 'M9 6l6 6-6 6',
  cerrar: 'M6 6l12 12M18 6L6 18',
  salir: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  ventana: 'M4 6h16v12H4zM4 10h16',
  musica: 'M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0z',
  parar: 'M7 7h10v10H7z',
  enviar: 'M4 12l16-8-6 16-2.5-6.5z',
  calavera: 'M12 3a7 7 0 00-4 12.7V19h8v-3.3A7 7 0 0012 3zM9.5 11.5h.01M14.5 11.5h.01M10.5 19v2M13.5 19v2',
};

export function icono(nombre, tam = 18) {
  if (PIXEL[nombre]) return iconoPx(PIXEL[nombre], tam >= 28 ? 32 : 16);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', tam);
  svg.setAttribute('height', tam);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', RUTAS[nombre] || '');
  svg.append(p);
  return svg;
}
