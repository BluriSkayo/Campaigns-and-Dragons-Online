// dialogo.js — Cuadro modal sencillo (encima de todo, también en la pantalla de creación, que no tiene ventanas flotantes).
// dialogo({ titulo, contenido, botones: [{ texto, valor, clase }], ancho }) → Promise con el `valor` del botón pulsado (null si se cierra con Esc o la ✕).
import { h } from './util.js';

export function dialogo({ titulo, contenido, botones = [{ texto: 'Cerrar', valor: null }], ancho = 520, alMostrar }) {
  return new Promise((resolver) => {
    const anterior = document.activeElement;
    const cerrar = (valor) => { document.removeEventListener('keydown', tecla, true); fondo.remove(); anterior?.focus?.(); resolver(valor); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); } };
    const caja = h('section', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo, style: { width: `min(${ancho}px, calc(100vw - 32px))` } },
      h('header', { class: 'modal-cab' }, h('h2', null, titulo), h('button', { type: 'button', class: 'btn-icono', 'aria-label': 'Cerrar', title: 'Cerrar', onclick: () => cerrar(null) }, '✕')),
      h('div', { class: 'modal-cuerpo' }, contenido),
      botones.length ? h('footer', { class: 'modal-pie' }, botones.map((b) => h('button', { type: 'button', class: `btn ${b.clase || ''}`, 'data-valor': String(b.valor), onclick: () => cerrar(b.valor) }, b.texto))) : null);
    const fondo = h('div', { class: 'modal-fondo', onclick: (e) => { if (e.target === fondo) cerrar(null); } }, caja);
    document.body.append(fondo);
    document.addEventListener('keydown', tecla, true);
    (caja.querySelector('[autofocus]') || caja.querySelector('.modal-pie .btn:last-child'))?.focus();
    alMostrar?.(caja, cerrar);
  });
}

/** Pregunta sí/no. → true si se confirma. `peligro` pinta el botón en rojo. */
export async function confirmar(titulo, texto, { si = 'Aceptar', no = 'Cancelar', peligro = false } = {}) {
  return (await dialogo({ titulo, contenido: h('p', { class: 'modal-texto' }, texto), botones: [{ texto: no, valor: false, clase: 'btn-suave' }, { texto: si, valor: true, clase: peligro ? 'btn-peligro' : 'btn-acento' }], ancho: 440 })) === true;
}
