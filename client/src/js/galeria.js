// galeria.js — Elegir una imagen que ya está en este equipo (las del .zip de la campaña y las que trajo el jugador), viendo miniaturas:
// por carpeta (tokens, iconos, otros), con sus subcarpetas y un buscador; o traer una nueva desde el equipo.
import { h } from './util.js';
import { dialogo } from './dialogo.js';
import { urlLocal, listarArchivos, importarImagen } from './archivos.js';

const CATEGORIAS = [['tokens', 'Tokens'], ['icons', 'Iconos'], ['otros', 'Otras']];

/** → ruta elegida («tokens/jugadores/ana.png»), '' si se quita la imagen, o null si se cancela. */
export async function elegirImagen({ actual = '', titulo = 'Elegir imagen' } = {}) {
  let categoria = CATEGORIAS.some(([c]) => actual.startsWith(`${c}/`)) ? actual.split('/')[0] : 'tokens';
  let carpeta = actual.startsWith(`${categoria}/`) ? actual.split('/').slice(1, -1).join('/') : '';
  let filtro = '';
  const listas = {};
  const caja = h('div', { class: 'galeria' });
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre…', 'aria-label': 'Buscar imagen', autofocus: true });
  buscar.addEventListener('input', () => { filtro = buscar.value.trim().toLowerCase(); pintar(); });
  let cerrarYa = null;
  const traer = h('button', { type: 'button', class: 'btn btn-suave', 'data-accion': 'traer-imagen', onclick: async () => {
    try {
      const n = await importarImagen();
      if (n && cerrarYa) cerrarYa(`tokens/${n}`);
    } catch (e) { aviso.textContent = e.message; aviso.hidden = false; }
  } }, '📁 Traer una imagen de mi equipo…');
  const aviso = h('p', { class: 'error', hidden: true });

  async function cargar(c) { listas[c] ??= await listarArchivos(c).catch(() => []); return listas[c]; }

  async function pintar() {
    const todos = await cargar(categoria);
    const subcarpetas = [...new Set(todos.filter((f) => f.includes('/')).map((f) => f.split('/').slice(0, -1).join('/')))].sort((a, b) => a.localeCompare(b, 'es'));
    const visibles = todos.filter((f) => (filtro ? f.toLowerCase().includes(filtro) : f.split('/').slice(0, -1).join('/') === carpeta));
    const pestanas = h('div', { class: 'galeria-pestanas', role: 'tablist' }, CATEGORIAS.map(([c, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(c === categoria),
      class: `galeria-pestana${c === categoria ? ' activa' : ''}`, 'data-categoria': c, onclick: () => { categoria = c; carpeta = ''; pintar(); } }, t)));
    const chips = subcarpetas.length && !filtro ? h('div', { class: 'galeria-carpetas' },
      h('button', { type: 'button', class: `chip${carpeta === '' ? ' activa' : ''}`, onclick: () => { carpeta = ''; pintar(); } }, '📂 (principal)'),
      subcarpetas.map((s) => h('button', { type: 'button', class: `chip${carpeta === s ? ' activa' : ''}`, 'data-carpeta': s, onclick: () => { carpeta = s; pintar(); } }, `📁 ${s}`))) : null;
    const rejilla = visibles.length ? h('div', { class: 'galeria-rejilla' }, visibles.map((f) => {
      const ruta = `${categoria}/${f}`;
      const nombre = f.split('/').pop().replace(/\.[^.]+$/, '');
      return h('button', { type: 'button', class: `galeria-item${ruta === actual ? ' elegida' : ''}`, title: ruta, 'data-ruta': ruta, onclick: () => cerrarYa?.(ruta) },
        h('img', { src: urlLocal(ruta), alt: '', loading: 'lazy' }), h('span', null, nombre));
    })) : h('p', { class: 'tenue galeria-vacia' }, todos.length ? 'No hay imágenes que coincidan.'
      : 'No hay imágenes aquí todavía. Importa el .zip de la campaña (Ajustes → «Importar archivos de campaña») o trae una imagen de tu equipo.');
    caja.replaceChildren(pestanas, h('div', { class: 'galeria-barra' }, buscar), chips, rejilla, aviso);
  }
  await pintar();
  return dialogo({ titulo, contenido: caja, ancho: 760,
    botones: [...(actual ? [{ texto: 'Quitar la imagen', valor: '', clase: 'btn-suave' }] : []), { texto: 'Cancelar', valor: null, clase: 'btn-suave' }],
    alMostrar: (el, cerrar) => { cerrarYa = cerrar; el.querySelector('.modal-pie').prepend(traer); buscar.focus(); } });
}
