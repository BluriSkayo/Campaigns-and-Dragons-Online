// ventanas/intercambio.js — Intercambio de objetos y dinero entre dos jugadores (como en un MMO).
// Cambiar la oferta quita las dos aceptaciones; el trato se cierra cuando ambos aceptan.
import { h } from '../util.js';
import { S, bus } from '../almacen.js';
import { abrirVentana, cerrarVentana } from '../ventanas.js';
import { red } from '../red.js';
import { textoDinero, monedaActiva } from '../dinero.js';

let borrador = null;      // {items:{objeto:n}, dinero} lo que estoy escribiendo (se pierde al terminar)

function render() {
  const x = S.intercambio;
  if (!x) return h('p', { class: 'tenue' }, 'No hay intercambio en curso.');
  const yo = x.partes.find((p) => p.usuario === S.usuario) || x.partes[0];
  const otro = x.partes.find((p) => p !== yo);
  const token = S.tokenActivo ? S.tokens.get(S.tokenActivo) : null;
  if (!borrador) borrador = { items: Object.fromEntries(yo.items.map((i) => [i.objeto, i.cantidad])), dinero: yo.dinero };
  const enviar = () => red.enviar({ tipo: 'intercambio_ofrecer', items: Object.fromEntries(Object.entries(borrador.items).filter(([, n]) => n > 0)), dinero: borrador.dinero });
  const nombreObj = (id) => S.catalogo.objetos[id]?.nombre || id;
  const resumen = (p) => h('ul', { class: 'lista-acciones' },
    p.items.map((i) => h('li', { class: 'fila-accion' }, `${nombreObj(i.objeto)} ×${i.cantidad}`)),
    p.dinero ? h('li', { class: 'fila-accion' }, textoDinero(p.dinero)) : null,
    !p.items.length && !p.dinero ? h('li', { class: 'tenue' }, 'Nada todavía') : null);

  const mio = (token?.inventario || []).map((e) => {
    const c = h('input', { type: 'number', min: '0', max: String(e.cantidad), value: String(borrador.items[e.objeto] || 0), 'aria-label': `Cantidad de ${nombreObj(e.objeto)}`, 'data-objeto': e.objeto, class: 'num-corto',
      onchange: () => { borrador.items[e.objeto] = Math.max(0, Math.min(e.cantidad, parseInt(c.value, 10) || 0)); enviar(); } });
    return h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, `${nombreObj(e.objeto)} (tienes ${e.cantidad})`), c);
  });
  const dineroIn = monedaActiva() ? h('input', { type: 'number', min: '0', max: String(token?.dinero ?? 0), value: String(borrador.dinero || 0), 'aria-label': 'Dinero a ofrecer', 'data-campo': 'dinero-oferta', class: 'num-corto',
    onchange: () => { borrador.dinero = Math.max(0, Math.min(token?.dinero ?? 0, parseInt(dineroIn.value, 10) || 0)); enviar(); } }) : null;

  return h('div', { class: 'intercambio' },
    h('h4', { class: 'sub primero' }, `Tu oferta${yo.acepto ? ' ✔ aceptada' : ''}`),
    mio.length || dineroIn ? h('ul', { class: 'lista-acciones' }, mio, dineroIn ? h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, 'Dinero'), dineroIn) : null) : h('p', { class: 'tenue' }, 'No tienes nada que ofrecer.'),
    h('h4', { class: 'sub' }, `Oferta de ${otro.nombre}${otro.acepto ? ' ✔ aceptada' : ''}`),
    resumen(otro),
    h('div', { class: 'pie' },
      h('button', { class: 'btn', 'data-accion': 'cancelar-intercambio', onclick: () => red.enviar({ tipo: 'intercambio_cancelar' }) }, 'Cancelar'),
      h('button', { class: 'btn btn-acento', 'data-accion': 'aceptar-intercambio', onclick: () => red.enviar({ tipo: 'intercambio_aceptar', acepto: !yo.acepto }) }, yo.acepto ? 'Quitar aceptación' : 'Aceptar')));
}

export function abrirIntercambio() { abrirVentana({ id: 'intercambio', titulo: 'Intercambio', ancho: 340, render, eventos: ['intercambio', 'tokens'], alCerrar: () => { if (S.intercambio) red.enviar({ tipo: 'intercambio_cancelar' }); } }); }
bus.on('intercambio-fin', () => { borrador = null; cerrarVentana('intercambio'); });
