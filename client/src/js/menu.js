// menu.js — Menú contextual (clic derecho). Se cierra con Esc, clic fuera, rueda fuera de él o al elegir una opción.
// items: { texto, accion, peligro?, deshabilitado?, detalle? } | { titulo } | { separador: true }
import { h } from './util.js';

let actual = null;

export function cerrarMenu() {
  if (!actual) return;
  actual.limpiar();
  actual = null;
}

export function menuAbierto() { return !!actual; }

export function abrirMenu(contenedor, clientX, clientY, items) {
  cerrarMenu();
  const utiles = items.filter(Boolean);
  if (!utiles.some((i) => i.accion)) return;

  const botones = [];
  const el = h('div', { class: 'menu-contextual', role: 'menu' }, utiles.map((i) => {
    if (i.separador) return h('div', { class: 'menu-sep', role: 'separator' });
    if (i.titulo) return h('div', { class: 'menu-titulo' }, i.titulo);
    const b = h('button', { class: `menu-item${i.peligro ? ' peligro' : ''}`, role: 'menuitem', disabled: !!i.deshabilitado,
      title: i.detalle || null, onclick: () => { cerrarMenu(); i.accion(); } }, i.texto);
    botones.push(b);
    return b;
  }));
  contenedor.append(el);

  // Colocarlo junto al cursor sin salirse de la zona del mapa.
  const r = contenedor.getBoundingClientRect();
  const x = Math.max(4, Math.min(clientX - r.left, r.width - el.offsetWidth - 4));
  const y = Math.max(4, Math.min(clientY - r.top, r.height - el.offsetHeight - 4));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  const habilitados = botones.filter((b) => !b.disabled);
  const alTecla = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cerrarMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = habilitados.indexOf(document.activeElement);
      const n = habilitados.length;
      habilitados[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    }
  };
  const alFuera = (e) => { if (!el.contains(e.target)) cerrarMenu(); };
  const alRueda = (e) => { if (!el.contains(e.target)) cerrarMenu(); };      // la rueda dentro del menú lo desplaza; fuera, lo cierra
  window.addEventListener('keydown', alTecla, true);
  window.addEventListener('pointerdown', alFuera, true);
  window.addEventListener('wheel', alRueda, { passive: true });
  window.addEventListener('blur', cerrarMenu);
  actual = {
    limpiar() {
      window.removeEventListener('keydown', alTecla, true);
      window.removeEventListener('pointerdown', alFuera, true);
      window.removeEventListener('wheel', alRueda);
      window.removeEventListener('blur', cerrarMenu);
      el.remove();
    },
  };
  habilitados[0]?.focus({ preventScroll: true });
}
