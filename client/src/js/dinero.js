// dinero.js — Cómo se muestra el dinero de la campaña (la moneda y sus piezas las define el servidor).
import { S } from './almacen.js';

export const monedaActiva = () => !!S.catalogo?.moneda?.activa;

/** 125 → «1 Oro 2 Plata 5 Cobre» (si la campaña define piezas) o «125 🪙». */
export function textoDinero(n) {
  const m = S.catalogo?.moneda || {};
  n = Number(n) || 0;
  const piezas = m.denominaciones || [];
  if (!piezas.length) return `${n.toLocaleString('es')} ${m.simbolo || ''}`.trim();
  let resto = n;
  const partes = [];
  for (const p of piezas) {
    const q = Math.floor(resto / p.valor);
    if (q > 0) { partes.push(`${q.toLocaleString('es')} ${p.nombre}`); resto -= q * p.valor; }
  }
  if (resto > 0) partes.push(`${resto} ${m.nombre || ''}`.trim());
  return `${m.simbolo || ''} ${partes.join(' · ') || `0 ${piezas[piezas.length - 1].nombre}`}`.trim();
}
