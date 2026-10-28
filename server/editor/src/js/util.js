// util.js — Pequeñas herramientas: crear elementos, avisos y cuadros de diálogo propios (sin alert/confirm del navegador).
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
      else if (k === 'value') el.value = v;
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

export const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const entero = (v, defecto = 0) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : defecto; };

export function slug(texto, vacio = 'nuevo') {
  const s = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  return s || vacio;
}

export function toast(texto, tipo = 'info', ms = 3500) {
  const cont = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${tipo}`, role: 'status' }, texto);
  cont.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Cuadro de diálogo modal. botones: [{texto, valor, clase?}] → devuelve el valor del botón pulsado (null si se cierra con Esc). */
export function dialogo({ titulo, contenido, botones, alMostrar }) {
  return new Promise((resolver) => {
    const cierre = (valor) => { fondo.remove(); document.removeEventListener('keydown', alTecla, true); resolver(valor); };
    const alTecla = (e) => {          // con dos diálogos abiertos (uno encima de otro), Esc cierra solo el de encima
      if (e.key === 'Escape' && [...document.querySelectorAll('.dialogo-fondo')].pop() === fondo) { e.stopPropagation(); cierre(null); }
    };
    const caja = h('div', { class: 'dialogo', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('h2', null, titulo), h('div', { class: 'dialogo-cuerpo' }, contenido),
      h('div', { class: 'dialogo-pie' }, botones.map((b) => h('button', { class: `btn ${b.clase || ''}`, type: 'button', onclick: () => cierre(b.valor) }, b.texto))));
    const fondo = h('div', { class: 'dialogo-fondo' }, caja);
    document.body.append(fondo);
    document.addEventListener('keydown', alTecla, true);
    alMostrar?.(caja, cierre);
    (caja.querySelector('[autofocus]') || caja.querySelector('.btn-acento') || caja.querySelector('button'))?.focus();
  });
}

export const confirmar = (titulo, mensaje, { si = 'Aceptar', no = 'Cancelar', peligro = false } = {}) =>
  dialogo({ titulo, contenido: h('p', { class: 'dialogo-texto' }, mensaje),
    botones: [{ texto: no, valor: false }, { texto: si, valor: true, clase: peligro ? 'btn-peligro' : 'btn-acento' }] });

/** Tres salidas para «cambios sin guardar». → 'guardar' | 'descartar' | null (cancelar) */
export const preguntarCambios = (mensaje) =>
  dialogo({ titulo: 'Hay cambios sin guardar', contenido: h('p', { class: 'dialogo-texto' }, mensaje),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'No guardar', valor: 'descartar', clase: 'btn-peligro' }, { texto: 'Guardar', valor: 'guardar', clase: 'btn-acento' }] });

export function pedirTexto(titulo, etiqueta, valor = '', { ayuda, si = 'Aceptar' } = {}) {
  const campo = h('input', { type: 'text', value: valor, maxlength: '60', autofocus: true, 'aria-label': etiqueta });
  return dialogo({
    titulo, contenido: h('label', { class: 'campo-dialogo' }, etiqueta, campo, ayuda ? h('span', { class: 'ayuda' }, ayuda) : null),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: si, valor: 'ok', clase: 'btn-acento' }],
    alMostrar: (_caja, cierre) => campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') cierre('ok'); }),
  }).then((r) => (r === 'ok' ? campo.value.trim() : null));
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
