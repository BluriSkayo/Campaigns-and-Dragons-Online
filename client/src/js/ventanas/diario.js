// ventanas/diario.js — El diario de la partida: páginas que escribe el GM en el Editor (armas, mundo, pistas…) y la página automática
// «Reglas de la mesa». Cada jugador recibe solo las páginas que puede leer; el GM las ve todas y decide en plena partida quién ve cada una.
import { h } from '../util.js';
import { S } from '../almacen.js';
import { red } from '../red.js';
import { urlLocal } from '../archivos.js';
import { contenidoReglas } from './reglas.js';

const REGLAS = '__reglas';
let abierta = null;          // id de la página que se está leyendo (null = índice)
let filtro = '';

/** Texto con un formato muy sencillo (sin HTML): «# Título», «- elemento», **negrita** y líneas vacías entre párrafos. */
export function formatear(texto) {
  const negritas = (linea) => linea.split(/\*\*(.+?)\*\*/g).map((trozo, i) => (i % 2 ? h('strong', null, trozo) : trozo));
  const bloques = [];
  let parrafo = [], lista = null;
  const cerrar = () => {
    if (parrafo.length) bloques.push(h('p', null, ...parrafo.flatMap((l, i) => (i ? [h('br'), ...negritas(l)] : negritas(l)))));
    if (lista) bloques.push(h('ul', null, lista));
    parrafo = []; lista = null;
  };
  for (const crudo of String(texto || '').split(/\r?\n/)) {
    const l = crudo.trimEnd();
    if (!l.trim()) { cerrar(); continue; }
    const t = /^#{1,3}\s+(.*)$/.exec(l);
    if (t) { cerrar(); bloques.push(h('h4', { class: 'sub' }, ...negritas(t[1]))); continue; }
    const li = /^\s*[-•*]\s+(.*)$/.exec(l);
    if (li) { if (parrafo.length) { const p = parrafo; parrafo = []; bloques.push(h('p', null, ...p.flatMap((x, i) => (i ? [h('br'), ...negritas(x)] : negritas(x))))); } (lista || (lista = [])).push(h('li', null, ...negritas(li[1]))); continue; }
    if (lista) cerrar();
    parrafo.push(l);
  }
  cerrar();
  return h('div', { class: 'diario-texto' }, bloques);
}

const icoVis = (p) => (p.visible === 'todos' ? '👁' : p.jugadores?.length ? '👥' : '🔒');
const textoVis = (p) => (p.visible === 'todos' ? 'La ven todos' : p.jugadores?.length ? `Solo: ${p.jugadores.join(', ')}` : 'Oculta para los jugadores');

function usuariosConocidos() {
  const s = new Set([...(S.conectados?.usuarios || []).filter((u) => !u.es_gm).map((u) => u.usuario), ...(S.todosPersonajes || []).map((p) => p.usuario)]);
  return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
}

/** Controles del GM: revelar a todos, ocultar, o mostrar solo a algunos jugadores. */
function controlesGM(p) {
  const enviar = (visible, jugadores = []) => red.enviar({ tipo: 'gm_diario', pagina: p.id, visible, jugadores });
  const usuarios = [...new Set([...usuariosConocidos(), ...(p.jugadores || [])])];
  return h('div', { class: 'diario-gm' },
    h('div', { class: 'tenue pequeno' }, `${icoVis(p)} ${textoVis(p)}`),
    h('div', { class: 'diario-botones' },
      h('button', { class: `btn btn-mini${p.visible === 'todos' ? ' btn-acento' : ''}`, 'data-accion': 'diario-todos', onclick: () => enviar('todos') }, '👁 Revelar a todos'),
      h('button', { class: `btn btn-mini${p.visible === 'oculta' && !p.jugadores?.length ? ' btn-acento' : ''}`, 'data-accion': 'diario-ocultar', onclick: () => enviar('oculta') }, '🔒 Ocultar')),
    usuarios.length ? h('div', { class: 'diario-solo' }, h('span', { class: 'tenue pequeno' }, 'O solo para:'),
      usuarios.map((u) => {
        const c = h('input', { type: 'checkbox', 'data-jugador': u });
        c.checked = p.visible === 'oculta' && (p.jugadores || []).includes(u);
        c.addEventListener('change', () => {
          const actuales = p.visible === 'oculta' ? (p.jugadores || []) : [];
          enviar('oculta', c.checked ? [...actuales, u] : actuales.filter((x) => x !== u));
        });
        return h('label', { class: 'chip chip-check' }, c, ' ', u);
      })) : h('p', { class: 'tenue pequeno' }, 'Cuando haya jugadores conectados podrás mostrarla solo a algunos.'));
}

function pagina(v, p) {
  const atras = h('button', { class: 'btn btn-mini', 'data-accion': 'diario-volver', onclick: () => { abierta = null; v.refrescar(); } }, '← Diario');
  if (p === REGLAS) return h('div', { class: 'diario' }, atras, h('h3', { class: 'diario-titulo' }, 'Reglas de la mesa'), contenidoReglas());
  const url = p.imagen ? urlLocal(p.imagen) : '';
  return h('div', { class: 'diario', 'data-pagina': p.id }, atras,
    h('h3', { class: 'diario-titulo' }, p.nombre), p.seccion ? h('div', { class: 'tenue pequeno' }, p.seccion) : null,
    S.esGM ? controlesGM(p) : null,
    url ? h('img', { class: 'diario-imagen', src: url, alt: '', onerror: (e) => { e.target.hidden = true; } }) : null,
    formatear(p.texto));
}

function indice(v) {
  const buscar = h('input', { type: 'search', class: 'diario-buscar', placeholder: 'Buscar en el diario…', 'aria-label': 'Buscar en el diario', value: filtro });
  buscar.addEventListener('input', () => {
    filtro = buscar.value;
    const pos = buscar.selectionStart;
    v.refrescar();
    const nuevo = document.querySelector('.diario-buscar');
    if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
  });
  const f = filtro.trim().toLowerCase();
  const coincide = (p) => !f || `${p.nombre} ${p.seccion} ${p.texto}`.toLowerCase().includes(f);
  const paginas = S.diario.paginas.filter(coincide);
  const secciones = new Map();
  for (const p of paginas) { const s = p.seccion || 'General'; if (!secciones.has(s)) secciones.set(s, []); secciones.get(s).push(p); }
  const fila = (p) => h('li', { class: 'fila-accion diario-fila', 'data-pagina': p.id },
    h('button', { class: 'diario-enlace', onclick: () => { abierta = p.id; v.refrescar(); } }, p.nombre),
    S.esGM ? h('span', { class: 'diario-vis', title: textoVis(p) }, icoVis(p)) : null);
  const reglas = S.diario.reglas && (!f || 'reglas de la mesa'.includes(f))
    ? h('ul', { class: 'lista-acciones' }, h('li', { class: 'fila-accion diario-fila', 'data-pagina': REGLAS },
      h('button', { class: 'diario-enlace', onclick: () => { abierta = REGLAS; v.refrescar(); } }, '⚙️ Reglas de la mesa'))) : null;
  const vacio = !paginas.length && !reglas;
  return h('div', { class: 'diario' }, buscar, reglas,
    [...secciones.entries()].map(([s, lista]) => h('section', { class: 'diario-seccion' }, h('h4', { class: 'sub' }, s), h('ul', { class: 'lista-acciones' }, lista.map(fila)))),
    vacio ? h('p', { class: 'tenue pequeno' }, f ? 'Nada coincide con la búsqueda.' : 'El diario está vacío por ahora.') : null);
}

function contenido(v) {
  if (abierta === REGLAS && S.diario.reglas) return pagina(v, REGLAS);
  const p = abierta && S.diario.paginas.find((x) => x.id === abierta);
  if (p) return pagina(v, p);
  abierta = null;                // la página dejó de estar visible: se vuelve al índice
  return indice(v);
}

export const DEF_DIARIO = { id: 'diario', titulo: 'Diario', ancho: 380, render: contenido, eventos: ['diario', 'conectados', 'todos-personajes'] };
