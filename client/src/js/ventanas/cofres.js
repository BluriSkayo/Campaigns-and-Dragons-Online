// ventanas/cofres.js — Inventarios de grupo: objetos y dinero en común. Por defecto, uno para todos los jugadores;
// el GM puede crear más (con sus miembros), cerrarlos para que nadie saque, o borrarlos. El servidor decide quién ve cada uno.
import { h, clamp } from '../util.js';
import { S, tokenFoco, esMio } from '../almacen.js';
import { red } from '../red.js';
import { textoDinero, monedaActiva } from '../dinero.js';
import { filaTexto } from '../retrato.js';

/** El personaje con el que se mete o saca: el seleccionado si es tuyo; si no, tu personaje activo. */
function miPersonaje() {
  const f = tokenFoco();
  if (f && esMio(f) && f.personaje) return f;
  const a = S.tokens.get(S.tokenActivo);
  return a && esMio(a) ? a : null;
}

const cantidadInput = (max, etiqueta) => h('input', { type: 'number', class: 'cofre-cant', min: '1', max: String(max), value: '1', 'aria-label': etiqueta });
const leer = (inp, max) => clamp(parseInt(inp.value, 10) || 1, 1, max);

function usuariosConocidos() {
  const s = new Set([...(S.conectados?.usuarios || []).filter((u) => !u.es_gm).map((u) => u.usuario), ...(S.todosPersonajes || []).map((p) => p.usuario)]);
  return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
}

function controlesGM(c) {
  const gm = (datos) => red.enviar({ tipo: 'gm_cofre', cofre: c.id, ...datos });
  const objetos = Object.entries(S.catalogo.objetos || {});
  const sel = h('select', { 'aria-label': 'Objeto para poner', 'data-accion': 'cofre-gm-objeto' }, objetos.map(([id, o]) => h('option', { value: id }, o.nombre)));
  const cant = cantidadInput(9999, 'Cantidad para poner');
  const miembros = h('div', { class: 'cofre-miembros' },
    h('label', { class: 'chip chip-check' }, Object.assign(h('input', { type: 'checkbox', 'data-miembro': '*' }), { checked: c.miembros === null,
      onchange: (e) => gm({ accion: 'editar', miembros: e.target.checked ? 'todos' : [] }) }), ' Todos'),
    c.miembros !== null ? usuariosConocidos().concat((c.miembros || []).filter((m) => !usuariosConocidos().includes(m))).map((u) =>
      h('label', { class: 'chip chip-check' }, Object.assign(h('input', { type: 'checkbox', 'data-miembro': u }), { checked: c.miembros.includes(u),
        onchange: (e) => gm({ accion: 'editar', miembros: e.target.checked ? [...c.miembros, u] : c.miembros.filter((x) => x !== u) }) }), ` ${u}`)) : null);
  return h('details', { class: 'cofre-gm' }, h('summary', null, 'Opciones del GM'),
    h('div', { class: 'cofre-fila' }, h('span', { class: 'tenue pequeno' }, 'Quién lo usa:'), miembros),
    h('div', { class: 'cofre-fila' },
      h('button', { class: 'btn btn-mini', 'data-accion': 'cofre-cerrar', onclick: () => gm({ accion: 'editar', cerrado: !c.cerrado }) }, c.cerrado ? '🔓 Abrir' : '🔒 Cerrar (nadie saca)'),

      h('button', { class: 'btn btn-mini btn-peligro', onclick: () => { if (confirm(`¿Borrar «${c.nombre}» con todo lo que tiene?`)) gm({ accion: 'borrar' }); } }, '✕')),
    (() => {
      const n = h('input', { type: 'text', maxlength: '40', value: c.nombre, 'aria-label': 'Nombre del inventario' });
      return h('div', { class: 'cofre-fila' }, n, h('button', { class: 'btn btn-mini', onclick: () => { if (n.value.trim()) gm({ accion: 'editar', nombre: n.value.trim() }); } }, 'Renombrar'));
    })(),
    objetos.length ? h('div', { class: 'cofre-fila' }, sel, cant, h('button', { class: 'btn btn-mini', 'data-accion': 'cofre-gm-poner',
      onclick: () => gm({ accion: 'objeto', objeto: sel.value, cantidad: leer(cant, 9999) }) }, 'Poner')) : null,
    monedaActiva() ? (() => {
      const d = h('input', { type: 'number', class: 'cofre-cant', value: '10', 'aria-label': 'Dinero (negativo para quitar)' });
      return h('div', { class: 'cofre-fila' }, h('span', { class: 'tenue pequeno' }, `${S.catalogo.moneda.nombre}:`), d,
        h('button', { class: 'btn btn-mini', onclick: () => gm({ accion: 'dinero', dinero: parseInt(d.value, 10) || 0 }) }, 'Dar / quitar'));
    })() : null);
}

function tarjeta(c, p) {
  const accion = (acc, datos) => red.enviar({ tipo: 'cofre', accion: acc, cofre: c.id, personaje: p?.personaje, ...datos });
  const puedeSacar = !!p && (!c.cerrado || S.esGM);
  const filas = c.inventario.map((e) => {
    const o = S.catalogo.objetos[e.objeto];
    if (!o) return null;
    const cant = cantidadInput(e.cantidad, `Cuántos sacar de ${o.nombre}`);
    return h('li', { class: 'fila-accion', 'data-objeto': e.objeto },
      filaTexto(o.imagen, h('strong', null, o.nombre, e.cantidad > 1 ? h('span', { class: 'cantidad' }, ` ×${e.cantidad}`) : null)),
      puedeSacar ? [e.cantidad > 1 ? cant : null, h('button', { class: 'btn btn-mini', 'data-accion': 'cofre-sacar', title: `Pasarlo a ${p.nombre}`,
        onclick: () => accion('sacar', { objeto: e.objeto, cantidad: e.cantidad > 1 ? leer(cant, e.cantidad) : 1 }) }, 'Sacar')] : null);
  });
  // Meter: lo que lleva tu personaje
  let meter = null;
  if (p?.inventario?.length) {
    const sel = h('select', { 'aria-label': 'Objeto para guardar', 'data-accion': 'cofre-meter-objeto' },
      p.inventario.map((e) => h('option', { value: e.objeto }, `${S.catalogo.objetos[e.objeto]?.nombre || e.objeto} (×${e.cantidad})`)));
    const cant = cantidadInput(9999, 'Cuántos guardar');
    meter = h('div', { class: 'cofre-fila' }, sel, cant, h('button', { class: 'btn btn-mini btn-acento', 'data-accion': 'cofre-meter',
      onclick: () => accion('meter', { objeto: sel.value, cantidad: leer(cant, p.inventario.find((e) => e.objeto === sel.value)?.cantidad || 1) }) }, 'Guardar'));
  }
  let dinero = null;
  if (monedaActiva()) {
    const d = h('input', { type: 'number', class: 'cofre-cant', min: '1', value: '1', 'aria-label': 'Dinero' });
    dinero = h('div', { class: 'cofre-fila' }, h('span', null, `${S.catalogo.moneda.nombre}: `, h('strong', { 'data-dinero': String(c.dinero) }, textoDinero(c.dinero))),
      p ? [d, h('button', { class: 'btn btn-mini', onclick: () => accion('meter', { dinero: Math.max(1, parseInt(d.value, 10) || 1) }) }, 'Guardar'),
        puedeSacar ? h('button', { class: 'btn btn-mini', onclick: () => accion('sacar', { dinero: Math.max(1, parseInt(d.value, 10) || 1) }) }, 'Sacar') : null] : null);
  }
  const quien = c.miembros === null ? 'Todos los jugadores' : c.miembros.length ? c.miembros.join(', ') : 'Solo el GM';
  return h('section', { class: 'cofre', 'data-cofre': c.id },
    h('h4', { class: 'sub' }, `📦 ${c.nombre}`, c.cerrado ? h('span', { class: 'tenue pequeno' }, ' · 🔒 cerrado') : null),
    h('p', { class: 'tenue pequeno' }, quien),
    filas.filter(Boolean).length ? h('ul', { class: 'lista-acciones' }, filas) : h('p', { class: 'tenue pequeno' }, 'Está vacío.'),
    dinero, meter, S.esGM ? controlesGM(c) : null);
}

function contenido() {
  const p = miPersonaje();
  const cofres = S.cofres || [];
  return h('div', { class: 'cofres' },
    !S.esGM ? h('p', { class: 'tenue pequeno' }, p ? `Guardas y sacas con ${p.nombre}.` : 'Despliega o selecciona uno de tus personajes para guardar o sacar cosas.') : null,
    cofres.length ? cofres.map((c) => tarjeta(c, p)) : h('p', { class: 'tenue' }, 'No hay inventarios de grupo.'),
    S.esGM ? (() => {
      const n = h('input', { type: 'text', maxlength: '40', placeholder: 'Nombre (Bolsa de los exploradores…)', 'aria-label': 'Nombre del nuevo inventario' });
      const crear = () => { if (n.value.trim()) red.enviar({ tipo: 'gm_cofre', accion: 'crear', nombre: n.value.trim(), miembros: [] }); };
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter') crear(); });
      return h('div', { class: 'cofre-fila cofre-nuevo' }, n, h('button', { class: 'btn', 'data-accion': 'cofre-nuevo', onclick: crear }, '＋ Nuevo inventario'));
    })() : null);
}

export const DEF_COFRES = { id: 'cofres', titulo: 'Grupo', ancho: 360, render: contenido, eventos: ['cofres', 'tokens', 'foco', 'conectados', 'todos-personajes'] };
