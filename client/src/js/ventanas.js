// ventanas.js — Ventanas flotantes (arrastrables) para Personaje, Inventario, Tiradas, Ajustes, etc.
import { h, clamp, sinSaltoDeScroll } from './util.js';
import { bus } from './almacen.js';
import { icono } from './iconos.js';

const abiertas = new Map();
let contenedor = null;
let zSuperior = 40;
let cascada = 0;

export function montarVentanas(el) { contenedor = el; }

/**
 * abrirVentana({ id, titulo, ancho, render, eventos, alCerrar })
 *  - render(v) devuelve el contenido (se vuelve a llamar cuando ocurre alguno de `eventos` del bus)
 *  - si la ventana ya está abierta, solo se trae al frente
 */
export function abrirVentana({ id, titulo, ancho = 360, render, eventos = [], alCerrar }) {
  if (abiertas.has(id)) {
    traerAlFrente(abiertas.get(id));
    return abiertas.get(id);
  }
  const cuerpo = h('div', { class: 'ventana-cuerpo' });
  const barra = h('div', { class: 'ventana-barra' },
    h('span', { class: 'ventana-titulo' }, titulo),
    h('button', { class: 'btn-icono', title: 'Cerrar', 'aria-label': `Cerrar ${titulo}`, onclick: () => cerrarVentana(id) }, icono('cerrar', 16)));
  const el = h('section', { class: 'ventana', role: 'dialog', 'aria-label': titulo, style: { width: `${ancho}px` } }, barra, cuerpo);
  contenedor.append(el);

  const v = { id, el, cuerpo, alCerrar, offs: [] };
  v.refrescar = () => sinSaltoDeScroll(cuerpo, () => cuerpo.replaceChildren(render(v)));
  for (const ev of eventos) v.offs.push(bus.on(ev, v.refrescar));
  v.refrescar();

  // Se abren pegadas al borde derecho del mapa para no tapar el centro, donde se juega.
  const desfase = (cascada % 5) * 26;
  el.style.left = `${Math.max(8, contenedor.clientWidth - ancho - 16 - desfase)}px`;
  el.style.top = `${Math.max(8, Math.min(56 + desfase, contenedor.clientHeight - el.offsetHeight - 8))}px`;   // nunca se sale por abajo
  cascada++;
  el.addEventListener('pointerdown', () => traerAlFrente(v));
  arrastrable(el, barra);
  traerAlFrente(v);
  abiertas.set(id, v);
  return v;
}

export function cerrarVentana(id) {
  const v = abiertas.get(id);
  if (!v) return;
  v.offs.forEach((f) => f());
  v.el.remove();
  abiertas.delete(id);
  v.alCerrar?.();
}

export function cerrarTodas() { [...abiertas.keys()].forEach(cerrarVentana); cascada = 0; }
export const estaAbierta = (id) => abiertas.has(id);

function traerAlFrente(v) { v.el.style.zIndex = String(++zSuperior); }

function arrastrable(el, barra) {
  let inicio = null;
  barra.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    barra.setPointerCapture(e.pointerId);
    inicio = { x: e.clientX, y: e.clientY, l: el.offsetLeft, t: el.offsetTop };
  });
  barra.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    const lim = contenedor.getBoundingClientRect();
    el.style.left = `${clamp(inicio.l + e.clientX - inicio.x, 0, Math.max(0, lim.width - 80))}px`;
    el.style.top = `${clamp(inicio.t + e.clientY - inicio.y, 0, Math.max(0, lim.height - 40))}px`;
  });
  const fin = () => { inicio = null; };
  barra.addEventListener('pointerup', fin);
  barra.addEventListener('pointercancel', fin);
}
