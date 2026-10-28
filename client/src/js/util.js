// util.js — Utilidades pequeñas. `h()` construye elementos del DOM de forma segura
// (los textos se insertan como texto, nunca como HTML, así un mensaje de chat no puede ejecutar código).
import { conIconos } from './pixel.js';

const SIN_ICONOS = new Set(['OPTION', 'TEXTAREA', 'TITLE', 'STYLE', 'SCRIPT']);

// Un hijo «null» (de un «cond ? algo : null») no debe aparecer como el texto «null»: estos métodos lo ignoran.
for (const P of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['replaceChildren', 'append', 'prepend']) {
    const original = P[m];
    if (original.__sinNulos) continue;
    const nuevo = function (...hijos) { return original.apply(this, hijos.filter((x) => x !== null && x !== undefined && x !== false)); };
    nuevo.__sinNulos = true;
    P[m] = nuevo;
  }
}

export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    if (c instanceof Node) { el.append(c); continue; }
    const conIco = SIN_ICONOS.has(el.tagName) ? null : conIconos(String(c));     // emojis con dibujo → icono en pixel art
    el.append(...(conIco || [document.createTextNode(String(c))]));
  }
  return el;
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function nombreBonito(archivo) {
  return archivo.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
}

export function inicial(nombre) {
  return (nombre || '?').trim().charAt(0).toUpperCase() || '?';
}

export function escribiendo(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function toast(texto, tipo = 'info') {
  const cont = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${tipo}`, role: 'status' }, texto);
  cont.append(t);
  while (cont.children.length > 4) cont.firstChild.remove();
  setTimeout(() => {
    t.classList.add('saliendo');
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

/** Vuelve a pintar `raiz` con `pintar()` sin que la barra de desplazamiento salte arriba: se recuerda dónde estaba cada zona
 *  desplazable (la propia raíz, sus contenedores y las zonas de dentro, reconocidas por su clase y su orden) y se restaura. */
export function sinSaltoDeScroll(raiz, pintar) {
  const clave = (el) => `${el.tagName}.${el.className}`;
  const antes = [];
  for (let a = raiz; a && a !== document.documentElement; a = a.parentElement) if (a.scrollTop || a.scrollLeft) antes.push([a, a.scrollTop, a.scrollLeft]);
  const dentro = new Map();
  for (const el of raiz.querySelectorAll('*')) {
    if (!el.scrollTop && !el.scrollLeft) continue;
    const k = clave(el);
    if (!dentro.has(k)) dentro.set(k, []);
    dentro.get(k).push([el.scrollTop, el.scrollLeft]);
  }
  const r = pintar();
  for (const [el, t, l] of antes) { el.scrollTop = t; el.scrollLeft = l; }
  if (dentro.size) {
    const vistos = new Map();
    for (const el of raiz.querySelectorAll('*')) {
      const l = dentro.get(clave(el));
      if (!l) continue;
      const i = vistos.get(clave(el)) || 0;
      vistos.set(clave(el), i + 1);
      if (l[i]) { el.scrollTop = l[i][0]; el.scrollLeft = l[i][1]; }
    }
  }
  return r;
}
