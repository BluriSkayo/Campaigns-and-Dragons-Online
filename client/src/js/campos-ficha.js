// campos-ficha.js — Los datos propios de la ficha que define la campaña (Alineamiento, Edad, Dios, Cordura…).
// Se usan al crear el personaje y en su ficha. El servidor comprueba cada valor y quién puede cambiarlo.
import { h } from './util.js';
import { S } from './almacen.js';

export const camposFicha = () => S.catalogo?.campos_ficha || [];

/** Un control para un campo. `alCambiar(valor)` recibe el valor ya convertido (número, sí/no, texto o null si se vacía). */
export function controlCampo(c, valor, alCambiar, { desactivado = false } = {}) {
  const comun = { 'data-campo-ficha': c.nombre, 'aria-label': c.nombre, disabled: desactivado };
  if (c.tipo === 'casilla') {
    const x = h('input', { type: 'checkbox', ...comun });
    x.checked = valor === true;
    x.addEventListener('change', () => alCambiar(x.checked));
    return x;
  }
  if (c.tipo === 'lista') {
    const s = h('select', comun, h('option', { value: '' }, '—'), c.opciones.map((o) => h('option', { value: o }, o)));
    s.value = valor ?? '';
    s.addEventListener('change', () => alCambiar(s.value || null));
    return s;
  }
  if (c.tipo === 'numero') {
    const n = h('input', { type: 'number', min: String(c.minimo), max: String(c.maximo), step: '1', ...comun });
    n.value = valor ?? '';
    n.addEventListener('change', () => alCambiar(n.value === '' ? null : Math.max(c.minimo, Math.min(c.maximo, parseInt(n.value, 10) || 0))));
    return n;
  }
  const t = h('input', { type: 'text', maxlength: '300', ...comun });
  t.value = valor ?? '';
  t.addEventListener('change', () => alCambiar(t.value.trim() || null));
  return t;
}

export const textoValor = (c, v) => (v === undefined || v === null ? '—' : c.tipo === 'casilla' ? (v ? 'Sí' : 'No') : String(v));

/** Bloque «Datos» para la ficha: valores y, si se puede, edición en el sitio. `puedeEditar(c)` dice qué campos toca este usuario. */
export function bloqueCampos(valores, puedeEditar, guardar) {
  const defs = camposFicha().filter((c) => valores[c.nombre] !== undefined || puedeEditar(c));
  if (!defs.length) return null;
  return h('dl', { class: 'campos-ficha' }, defs.flatMap((c) => [
    h('dt', { title: c.descripcion || '' }, c.nombre, c.privado ? h('span', { class: 'tenue pequeno', title: 'Solo lo ven su dueño y el GM' }, ' 🔒') : null),
    h('dd', null, puedeEditar(c) ? controlCampo(c, valores[c.nombre], (v) => guardar({ [c.nombre]: v })) : textoValor(c, valores[c.nombre]))]));
}
