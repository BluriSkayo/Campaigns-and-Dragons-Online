// navegacion.js — Moverse por el Editor: abrir categorías y fichas, crear y quitar recursos.
// Todo cambio de ficha pasa por aquí para preguntar antes de abandonar una ficha con cambios sin guardar.
import { toast, confirmar, preguntarCambios, dialogo } from './util.js';
import { elegirPlantillaEstado } from './plantillas.js';
import { E, PENDIENTES, pestana, sucia, guardar, descartar, clave, abrir, abrirReglas, abrirSonidos, abrirJugadores, verCategoria, nuevo, cerrarPestana, eliminar, usadoPor, lista, VISTAS_COMPLETAS } from './estado.js';
import { CATEGORIAS } from './esquemas.js';

export function tituloDe(p) { return p.tipo === 'reglas' ? 'Reglas del juego' : p.tipo === 'jugadores' ? 'Jugadores y fichas' : p.tipo === 'sonidos' ? 'Sonidos' : (p.borrador.nombre || '(sin nombre)'); }
export function iconoDe(p) { return p.tipo === 'reglas' ? '⚙️' : p.tipo === 'jugadores' ? '👥' : p.tipo === 'sonidos' ? '🎵' : CATEGORIAS[p.cat].icono; }

/** Deja libre la ficha abierta (salvo que sea `destino`). Si tiene cambios, pregunta. → false si el usuario cancela. */
export async function soltarActual(destino = null) {
  for (const [clave, pend] of PENDIENTES) {                    // trabajo que guarda aparte (ficha de un jugador…)
    if (clave === destino || !pend.sucia()) continue;
    const r = await preguntarCambios(`${pend.titulo} tiene cambios sin guardar.`);
    if (r === null) return false;
    if (r === 'guardar') { if (!(await pend.guardar())) return false; } else pend.descartar();
  }
  const p = pestana(E.activa);
  if (!p || p.clave === destino || !sucia(p)) return true;
  const r = await preguntarCambios(`«${tituloDe(p)}» tiene cambios sin guardar.`);
  if (r === null) return false;
  if (r === 'guardar') {
    try { await guardar(p.clave); } catch (e) { toast(e.message, 'error', 6000); return false; }
  } else descartar(p.clave);
  return true;
}

// Devuelven si de verdad se navegó (false = el usuario canceló el aviso de «cambios sin guardar»)
export async function irA(cat, id) { if (!(await soltarActual(clave(cat, id)))) return false; abrir(cat, id); return true; }
export async function irAReglas(seccion = null) { if (!(await soltarActual('reglas'))) return false; abrirReglas(seccion); return true; }
export async function irASonidos() { if (!(await soltarActual('sonidos'))) return false; abrirSonidos(); return true; }
export async function irAJugadores() { if (await soltarActual('jugadores')) abrirJugadores(); }
/** Muestra la lista de una categoría (o el inicio con null). Si la ficha abierta es de esa misma categoría, sigue abierta. */
export async function irACategoria(v) {
  const p = pestana(E.activa);
  const misma = p && (p.tipo === 'recurso' ? (p.cat === 'opciones' ? 'grupos' : p.cat) : p.tipo) === v;
  if (!misma && !(await soltarActual())) return;
  verCategoria(v);
}
/** Cierra la ficha abierta y vuelve a la lista (o al inicio, si era Reglas, Sonidos o Jugadores). */
export async function cerrarActual() {
  const p = pestana(E.activa);
  if (!p || !(await soltarActual())) return;
  const v = E.vista;
  cerrarPestana(p.clave);
  verCategoria(VISTAS_COMPLETAS.includes(v) ? null : v);
}

export async function crear(cat, extra = {}) {
  if (cat === 'opciones' && !lista('grupos').length) { toast('Crea antes un grupo (Raza, Clase…).', 'info'); return; }
  let opc = {};
  if (cat === 'estados') {              // en blanco o desde una plantilla (Veneno, Confusión, Escudo…)
    const p = await elegirPlantillaEstado(dialogo);
    if (!p) return;
    if (p.datos) { extra = { ...extra, ...structuredClone(p.datos) }; opc = { nombre: p.nombre }; }
  }
  if (!(await soltarActual())) return;
  try { await nuevo(cat, extra, opc); } catch (e) { toast(e.message, 'error', 6000); }
}

/** Pide confirmación (avisando de lo que lo usa) y lo manda a la papelera de la campaña. */
export async function quitar(cat, id) {
  const p = pestana(clave(cat, id));
  const nombre = (p ? p.borrador.nombre : E.campana.recursos[cat]?.[id]?.nombre) || id;
  const usos = usadoPor(cat, id);
  const extra = usos.length ? `\n\nSe usa en: ${usos.map((u) => u.nombre).join(', ')}. Esos recursos quedarán con errores hasta que lo corrijas.` : '';
  const hijos = cat === 'grupos' ? lista('opciones').filter((o) => o.datos?.grupo === id).length : 0;
  const aviso = hijos ? `\n\nTiene ${hijos} opción(es) dentro que quedarán sin grupo.` : '';
  const sinGuardar = p && sucia(p) ? '\n\nTiene cambios sin guardar que se perderán.' : '';
  if (!(await confirmar('Eliminar', `¿Eliminar «${nombre}»?${extra}${aviso}${sinGuardar}\n\nVa a la Papelera (botón 🗑️ de la barra superior): desde ahí puedes recuperarlo o borrarlo para siempre.`, { si: 'Eliminar', peligro: true }))) return false;
  try { await eliminar(cat, id); } catch (e) { toast(e.message, 'error', 6000); return false; }
  toast(`«${nombre}» eliminado.`, 'ok', 2000);
  return true;
}
