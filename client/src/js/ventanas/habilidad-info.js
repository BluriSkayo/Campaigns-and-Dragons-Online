// ventanas/habilidad-info.js — «Info» de una habilidad: un dibujo de las casillas que abarca y sus datos, ordenados.
import { h } from '../util.js';
import { S, textoMedida } from '../almacen.js';
import { abrirVentana, cerrarVentana } from '../ventanas.js';
import { celdasArea } from '../mapa-area.js';
import { urlLocal } from '../archivos.js';
import { iniciarHabilidad, resumenHabilidad } from '../acciones.js';

const TIPO = { dano: 'Daño', curacion: 'Curación', efecto: 'Solo efecto' };
const FORMA = { uno: 'Un objetivo', explosion: 'Explosión', linea: 'Línea', frente: 'Frente', cono: 'Cono', casillas: 'Área propia' };
const AFECTA = { rivales: 'Solo rivales', aliados: 'Solo aliados', todos: 'Todos' };

/** Rejilla pequeña: quien la usa (◆) mira a la derecha; las casillas alcanzadas se pintan y el punto de mira lleva borde. */
function dibujoArea(hab) {
  const area = hab.area || { forma: 'uno', tamano: 1 };
  const tam = area.tamano || 1;
  const alcance = Math.max(1, Math.min(hab.sin_limite ? 6 : hab.alcance || 1, 10));
  const conDir = ['cono', 'casillas', 'linea'].includes(area.forma);
  const ancho = Math.min(17, Math.max(7, (conDir ? Math.max(alcance, tam, ...(area.casillas || []).map((c) => c[0] + 1)) : alcance + tam) + 3));
  const altoMedio = Math.min(6, Math.max(2, area.forma === 'cono' ? tam : area.forma === 'casillas' ? Math.max(1, ...(area.casillas || []).map((c) => Math.abs(c[1]))) : tam) + 1);
  const alto = altoMedio * 2 + 1;
  const o = { x: 1, y: altoMedio };
  const mira = { x: area.forma === 'cono' || area.forma === 'casillas' ? o.x + 1 : Math.min(ancho - 1, o.x + alcance), y: o.y };
  const tocadas = new Set(celdasArea(o, mira.x, mira.y, area, alcance, false, ancho, alto).map(([x, y]) => `${x},${y}`));
  const celdas = [];
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const k = `${x},${y}`;
    const clase = ['info-celda', tocadas.has(k) ? 'alcanzada' : '', x === o.x && y === o.y ? 'origen' : '', !conDir && area.forma !== 'uno' && x === mira.x && y === mira.y ? 'mira' : ''].filter(Boolean).join(' ');
    celdas.push(h('span', { class: clase }, x === o.x && y === o.y ? '◆' : ''));
  }
  return h('div', { class: 'info-area' },
    h('div', { class: 'info-rejilla', style: { gridTemplateColumns: `repeat(${ancho}, 14px)` } }, celdas),
    h('p', { class: 'tenue pequeno' }, '◆ quien la usa (mirando a la derecha) · en color, las casillas que alcanza', hab.sin_limite ? ' · el alcance real no tiene límite' : ''));
}

const fila = (etiqueta, valor) => (valor == null || valor === '' ? null : [h('dt', null, etiqueta), h('dd', null, valor)]);

export function abrirInfoHabilidad(id) {
  const hab = S.catalogo.habilidades?.[id];
  if (!hab) return;
  cerrarVentana('info-habilidad');
  const unidad = S.catalogo?.medida?.unidad;
  const alcance = hab.sin_limite ? 'Sin límite' : unidad && unidad !== 'casillas' ? textoMedida(hab.alcance) : `${hab.alcance} ${hab.alcance === 1 ? 'casilla' : 'casillas'}`;
  const coste = Object.entries(hab.coste || {}).map(([r, v]) => `${v} ${r}`).join(', ') || 'Sin coste';
  const estado = hab.aplica_estado ? S.catalogo.estados?.[hab.aplica_estado]?.nombre || hab.aplica_estado : null;
  const img = hab.imagen ? urlLocal(hab.imagen) : null;
  abrirVentana({ id: 'info-habilidad', titulo: hab.nombre, ancho: 360, render: () => h('div', { class: 'info-habilidad' },
    h('div', { class: 'info-cab' }, img ? h('img', { class: 'info-icono', src: img, alt: '', onerror: (e) => e.currentTarget.remove() }) : null, h('div', null, h('h3', null, hab.nombre), h('span', { class: 'tenue' }, TIPO[hab.tipo] || hab.tipo))),
    hab.descripcion ? h('p', null, hab.descripcion) : null,
    h('h4', { class: 'sub' }, 'Alcance y área'),
    dibujoArea(hab),
    h('dl', { class: 'info-datos' },
      fila('Coste', coste),
      fila('Alcance', ['cono', 'casillas'].includes(hab.area?.forma) ? 'Junto a quien la usa' : alcance),
      fila('Área', `${FORMA[hab.area?.forma || 'uno']}${hab.area?.forma && !['uno', 'linea', 'casillas'].includes(hab.area.forma) ? ` de ${hab.area.tamano || 1}` : ''}`),
      hab.area?.forma && hab.area.forma !== 'uno' ? fila('Alcanza a', AFECTA[hab.area.afecta] || hab.area.afecta) : null,
      hab.golpes > 1 ? fila('Golpes', String(hab.golpes)) : null,
      hab.mover_objetivo ? fila('Mueve', `${hab.mover_objetivo.modo === 'atraer' ? 'Atrae' : 'Empuja'} ${hab.mover_objetivo.casillas} ${hab.mover_objetivo.casillas === 1 ? 'casilla' : 'casillas'}`) : null,
      estado ? fila(hab.alternar ? 'Activa / desactiva' : 'Aplica', `«${estado}»`) : null,
      hab.critico ? fila('Crítico', `con ${hab.critico.desde}+ en un d20 (×${hab.critico.multiplicador})`) : null,
      hab.etiquetas?.length ? fila('Etiquetas', hab.etiquetas.join(', ')) : null,
      hab.requisitos?.length ? fila('Requisitos', `${hab.requisitos.length} ${hab.requisitos.length === 1 ? 'condición' : 'condiciones'}`) : null)) });
}

/** Tarjeta de una habilidad (ficha y panel lateral): icono, nombre y coste; debajo «Usar» e «Info». */
export function tarjetaHabilidad(id, tokenId, puede) {
  const hab = S.catalogo.habilidades?.[id];
  if (!hab) return null;
  const url = hab.imagen ? urlLocal(hab.imagen) : null;
  const coste = Object.entries(hab.coste || {}).map(([r, v]) => `${v} ${r}`).join(', ') || 'Sin coste';
  return h('li', { class: 'tarjeta-habilidad', 'data-habilidad': id, title: resumenHabilidad(hab) },
    h('div', { class: 'tarjeta-hab-cab' },
      url ? h('img', { class: 'tarjeta-hab-icono', src: url, alt: '', onerror: (e) => e.currentTarget.remove() }) : null,
      h('div', { class: 'tarjeta-hab-texto' }, h('strong', null, hab.nombre), h('span', { class: 'tenue pequeno' }, coste))),
    h('div', { class: 'tarjeta-hab-botones' },
      h('button', { class: 'btn btn-acento', disabled: !puede, 'data-accion': 'usar-habilidad', onclick: () => iniciarHabilidad(tokenId, id) }, 'Usar'),
      h('button', { class: 'btn', 'data-accion': 'info-habilidad', onclick: () => abrirInfoHabilidad(id) }, 'Info')));
}
