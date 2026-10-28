// ventanas/tiradas.js — Tiradas de dados. El servidor tira y el resultado aparece en el chat para todos.
import { h, clamp } from '../util.js';
import { abrirVentana } from '../ventanas.js';
import { tirarDado, tiradaGuardada } from '../acciones.js';
import { S, tokenFoco, puedoControlar } from '../almacen.js';
import { red } from '../red.js';

const DADOS_DEFECTO = [4, 6, 8, 10, 12, 20, 100];      // si el servidor no manda lista
const historial = [];

function lanzar(expresion, alCambiar) {
  tirarDado(expresion);
  const i = historial.indexOf(expresion);
  if (i >= 0) historial.splice(i, 1);
  historial.unshift(expresion);
  historial.length = Math.min(historial.length, 8);
  alCambiar?.();
}

function contenido(v) {
  let cantidad = 1;
  let mod = 0;
  const inCantidad = h('input', { type: 'number', min: '1', max: '20', value: '1', 'aria-label': 'Cantidad de dados' });
  const inMod = h('input', { type: 'number', min: '-99', max: '99', value: '0', 'aria-label': 'Modificador' });
  inCantidad.addEventListener('input', () => { cantidad = clamp(parseInt(inCantidad.value, 10) || 1, 1, 20); });
  inMod.addEventListener('input', () => { mod = clamp(parseInt(inMod.value, 10) || 0, -99, 99); });

  const expr = (caras) => `${cantidad}d${caras}${mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''}`;
  const personalizada = h('input', { type: 'text', maxlength: '60', placeholder: 'Por ejemplo 2d8+3', 'aria-label': 'Tirada personalizada' });
  const tirarPers = () => { const t = personalizada.value.trim(); if (t) { lanzar(t, v.refrescar); } };
  personalizada.addEventListener('keydown', (e) => { if (e.key === 'Enter') tirarPers(); });

  // Tirada de una estadística del personaje seleccionado (la fórmula la define la campaña; el servidor suma los rasgos).
  const t = tokenFoco();
  const estadisticas = t && puedoControlar(t) && t.stats
    ? [h('h4', { class: 'sub' }, `Tirar una estadística de ${t.nombre}`),
      h('div', { class: 'recientes' }, S.catalogo.estadisticas.filter((e) => e.nombre in t.stats).map((e) => h('button', { class: 'chip', title: e.descripcion || '',
        onclick: () => red.enviar({ tipo: 'tirar_estadistica', token: t.id, estadistica: e.nombre }) }, `${e.nombre} ${t.stats[e.nombre]}`))),
      h('h4', { class: 'sub' }, 'Dados')] : null;

  // Tiradas guardadas: cada usuario guarda las suyas (se pueden lanzar aquí o escribiendo /Nombre en el chat).
  const foco = t && puedoControlar(t) ? t : null;
  const usaStats = (e) => e.includes('[');
  const tirarGuardada = (g) => tiradaGuardada('tirar', { nombre: g.nombre, ...(foco ? { token: foco.id } : {}) });
  const inNombre = h('input', { type: 'text', maxlength: '30', placeholder: 'Nombre (Ataque)', 'aria-label': 'Nombre de la tirada' });
  const inExpr = h('input', { type: 'text', maxlength: '100', placeholder: '1d20 + [Fuerza]', 'aria-label': 'Qué se tira' });
  const guardarNueva = () => {
    const nombre = inNombre.value.trim(), expresion = inExpr.value.trim();
    if (nombre && expresion) tiradaGuardada('guardar', { nombre, expresion });
  };
  inExpr.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardarNueva(); });
  const mias = S.permisos.dados_personalizados === false && !S.esGM ? null : h('section', { class: 'tiradas-guardadas' },
    h('h4', { class: 'sub primero' }, 'Mis tiradas'),
    (S.tiradas || []).length ? h('ul', { class: 'lista-acciones' }, S.tiradas.map((g) => h('li', { class: 'fila-accion', 'data-tirada': g.nombre },
      h('button', { class: 'btn btn-mini btn-acento', disabled: usaStats(g.expresion) && !foco, title: usaStats(g.expresion) && !foco ? 'Usa estadísticas: selecciona antes uno de tus personajes' : `También: /${g.nombre} en el chat`,
        onclick: () => tirarGuardada(g) }, '🎲'),
      h('div', { class: 'fila-texto' }, h('strong', null, g.nombre), h('span', { class: 'tenue pequeno' }, g.expresion)),
      h('button', { class: 'btn-icono', title: `Borrar «${g.nombre}»`, 'aria-label': `Borrar ${g.nombre}`, onclick: () => tiradaGuardada('borrar', { nombre: g.nombre }) }, '✕'))))
      : h('p', { class: 'tenue pequeno' }, 'Guarda las tiradas que más usas. Pueden usar estadísticas entre corchetes: 1d20 + [Fuerza].'),
    h('div', { class: 'tiradas-nueva' }, inNombre, inExpr, h('button', { class: 'btn', 'data-accion': 'guardar-tirada', onclick: guardarNueva }, 'Guardar')));

  return h('div', { class: 'tiradas' }, mias, estadisticas,
    h('div', { class: 'tiradas-campos' },
      h('label', null, 'Dados', inCantidad), h('label', null, 'Modificador', inMod)),
    h('div', { class: 'dados' }, (S.catalogo.dados || DADOS_DEFECTO).map((c) => h('button', { class: 'dado', onclick: () => lanzar(expr(c), v.refrescar) }, `d${c}`))),
    S.permisos.dados_personalizados === false ? h('p', { class: 'tenue pequeno' }, 'En este servidor solo se pueden tirar los dados de la lista.')
      : h('div', { class: 'tiradas-personal' }, personalizada, h('button', { class: 'btn', onclick: tirarPers }, 'Tirar')),
    historial.length ? [h('h4', { class: 'sub' }, 'Tiradas recientes'),
      h('div', { class: 'recientes' }, historial.map((e) => h('button', { class: 'chip', onclick: () => lanzar(e, v.refrescar) }, e)))] : null,
    h('p', { class: 'tenue pequeno' }, 'El resultado aparece en el chat para todos. En el chat también puedes escribir /r 2d6+3 o /ayuda.'));
}

export const DEF_TIRADAS = { id: 'tiradas', titulo: 'Tiradas', ancho: 320, render: contenido, eventos: ['foco', 'tokens', 'tiradas'] };
export const abrirTiradas = () => abrirVentana(DEF_TIRADAS);
