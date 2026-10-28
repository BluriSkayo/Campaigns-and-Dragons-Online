// explorador.js — La barra de la izquierda: las categorías de la campaña (al pulsar una, su lista se abre en el centro)
// y un buscador que encuentra cualquier recurso de la campaña.
import { h } from './util.js';
import { E, bus, lista, clave, pestana, sucia, vistaDePestana, activar, pluralDe, enCalma } from './estado.js';
import { CATEGORIAS, EXPLORADOR } from './esquemas.js';
import { irA, irACategoria, irAReglas, irASonidos, irAJugadores } from './navegacion.js';

const CARPETA_A_CAT = { abilities: 'habilidades', items: 'objetos', enemies: 'enemigos', groups: 'grupos', options: 'opciones', traits: 'rasgos', states: 'estados', shops: 'tiendas', maps: 'mapas', tiles: 'tiles', journal: 'diario' };

/** Recursos con errores según el último análisis: Set de «cat/id». */
export function conErrores() {
  const s = new Set();
  for (const t of E.problemas.errores || []) {
    const m = /^(abilities|items|enemies|groups|options|traits|states|shops|maps|tiles)\/([a-z0-9_]+)\.yaml/.exec(t);
    if (m) s.add(`${CARPETA_A_CAT[m[1]]}/${m[2]}`);
    else if (t.startsWith('config.yaml')) s.add('reglas');
    else if (t.startsWith('sonidos.yaml')) s.add('sonidos');
  }
  return s;
}
export const nombreVisible = (cat, id) => {
  const p = pestana(clave(cat, id));
  return (p ? p.borrador.nombre : E.campana.recursos[cat][id]?.nombre) || id;
};

/** Cada entrada de la barra: qué vista abre, su icono, su nombre y cuántos recursos tiene. */
function entradas() {
  return EXPLORADOR.map((n) => {
    if (n.tipo === 'cat') return { vista: n.cat, icono: CATEGORIAS[n.cat].icono, etiqueta: pluralDe(n.cat, CATEGORIAS[n.cat].plural), cuenta: lista(n.cat).length, cats: [n.cat], ayuda: CATEGORIAS[n.cat].ayuda };
    if (n.tipo === 'grupos') return { vista: 'grupos', icono: n.icono, etiqueta: n.etiqueta, cuenta: lista('grupos').length, cats: ['grupos', 'opciones'], ayuda: n.ayuda || CATEGORIAS.grupos?.ayuda };
    return { vista: n.tipo, icono: n.icono, etiqueta: n.etiqueta, cuenta: null, cats: [], ayuda: n.ayuda };
  });
}

export function crearExplorador() {
  let filtro = '';
  const buscar = h('input', { type: 'search', class: 'entrada buscador', placeholder: 'Buscar en la campaña…', 'aria-label': 'Buscar recursos' });
  buscar.addEventListener('input', () => { filtro = buscar.value.trim().toLowerCase(); pintar(); });
  buscar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { buscar.value = ''; filtro = ''; pintar(); } });
  const cont = h('nav', { class: 'categorias', 'aria-label': 'Categorías' });
  const el = h('aside', { class: 'explorador', 'aria-label': 'Explorador de recursos' }, buscar, cont);
  const coincide = (t) => String(t).toLowerCase().includes(filtro);

  function ir(vista) {
    if (vista === 'reglas') return irAReglas(pestana('reglas')?.seccion || 'general');
    if (vista === 'sonidos') return irASonidos();
    if (vista === 'jugadores') return irAJugadores();
    return irACategoria(vista);
  }

  function pintarCategorias() {
    const errores = conErrores();
    const activa = pestana(E.activa);
    const fila = (e) => {
      const conError = e.vista === 'reglas' || e.vista === 'sonidos' ? errores.has(e.vista) : [...errores].some((k) => e.cats.some((c) => k.startsWith(`${c}/`)));
      const conCambios = activa && sucia(activa) && vistaDePestana(activa) === e.vista;
      return h('button', { type: 'button', class: `cat-item${E.vista === e.vista ? ' activa' : ''}`, 'data-vista': e.vista, 'data-clave': e.cats.length ? null : e.vista,
        'aria-current': E.vista === e.vista ? 'page' : null, title: e.ayuda || null, onclick: () => ir(e.vista) },
      h('span', { class: 'cat-icono' }, e.icono), h('span', { class: 'cat-nombre' }, e.etiqueta),
      conCambios ? h('span', { class: 'punto punto-sucio', title: 'Cambios sin guardar' }) : null,
      conError ? h('span', { class: 'punto punto-error', title: 'Tiene problemas' }) : null,
      e.cuenta != null ? h('span', { class: 'cuenta' }, e.cuenta) : null);
    };
    const inicio = h('button', { type: 'button', class: `cat-item${E.vista === null ? ' activa' : ''}`, 'data-vista': 'inicio', title: 'Resumen de la campaña y accesos rápidos.', onclick: () => irACategoria(null) },
      h('span', { class: 'cat-icono' }, '🏠'), h('span', { class: 'cat-nombre' }, 'Inicio'));
    cont.replaceChildren(inicio, h('div', { class: 'cat-sep' }), ...entradas().map(fila));
  }

  function pintarResultados() {
    const res = [];
    for (const e of entradas()) {
      if (!e.cats.length) { if (coincide(e.etiqueta)) res.push(h('button', { type: 'button', class: 'resultado', onclick: () => ir(e.vista) }, h('span', { class: 'cat-icono' }, e.icono), h('span', { class: 'cat-nombre' }, e.etiqueta))); continue; }
      const items = e.cats.flatMap((c) => lista(c).filter((i) => coincide(nombreVisible(c, i.id))).map((i) => ({ c, i })));
      if (!items.length) continue;
      res.push(h('div', { class: 'resultado-titulo' }, `${e.icono} ${e.etiqueta}`));
      for (const { c, i } of items) {
        res.push(h('button', { type: 'button', class: `resultado${E.activa === clave(c, i.id) ? ' activa' : ''}`, 'data-clave': clave(c, i.id), onclick: () => irA(c, i.id) },
          h('span', { class: 'cat-nombre' }, nombreVisible(c, i.id)), c === 'grupos' ? h('span', { class: 'tenue pequeno' }, 'grupo') : null));
      }
    }
    cont.replaceChildren(...(res.length ? res : [h('p', { class: 'vacio' }, 'Nada coincide con la búsqueda.')]));
  }

  function pintar() {
    if (!E.campana) { cont.replaceChildren(); return; }
    if (filtro) pintarResultados(); else pintarCategorias();
  }
  for (const ev of ['campana', 'campana-cambiada', 'pestanas', 'guardado', 'problemas']) bus.on(ev, pintar);
  bus.on('cambio', enCalma(pintar));          // al escribir, una vez al parar (no en cada tecla)
  pintar();
  return { el, pintar, enfocarBuscador: () => { buscar.focus(); buscar.select(); } };
}
export { activar };
