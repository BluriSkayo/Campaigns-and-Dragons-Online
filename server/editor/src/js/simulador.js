// simulador.js — «🧪 Probar»: usa la habilidad que estás editando entre dos combatientes con las reglas reales del servidor
// (fórmulas, etiquetas, rasgos, estados, reglas automáticas…), sin guardar y sin abrir una partida.
import { h } from './util.js';
import { E } from './estado.js';

const ESPECIAL = '__pj';

/** Elegir un combatiente: un NPC de la campaña o un «personaje de prueba» con las opciones (raza, clase…) que elijas. */
function selectorCombatiente(titulo, estado) {
  const caja = h('div', { class: 'sim-combatiente' });
  const pintar = () => {
    const npcs = Object.entries(E.campana.recursos.enemigos || {});
    const sel = h('select', { class: 'entrada', 'aria-label': titulo, 'data-sim': titulo },
      h('option', { value: ESPECIAL }, 'Personaje de prueba'), npcs.map(([id, n]) => h('option', { value: id }, `NPC: ${n.nombre || id}`)));
    sel.value = estado.tipo === 'npc' ? estado.id : ESPECIAL;
    sel.addEventListener('change', () => {
      if (sel.value === ESPECIAL) { estado.tipo = 'personaje'; delete estado.id; } else { estado.tipo = 'npc'; estado.id = sel.value; }
      pintar();
    });
    const grupos = estado.tipo === 'npc' ? [] : Object.entries(E.campana.recursos.grupos || {}).filter(([g]) => Object.values(E.campana.recursos.opciones || {}).some((o) => o.grupo === g));
    const elecciones = estado.elecciones || (estado.elecciones = {});
    const opciones = grupos.map(([g, gd]) => {
      const s = h('select', { class: 'entrada', 'aria-label': `${titulo}: ${gd.nombre}`, 'data-grupo': g }, h('option', { value: '' }, `${gd.nombre}: (la primera, si es obligatoria)`),
        Object.entries(E.campana.recursos.opciones).filter(([, o]) => o.grupo === g).map(([id, o]) => h('option', { value: id }, `${gd.nombre}: ${o.nombre || id}`)));
      s.value = elecciones[g] || '';
      s.addEventListener('change', () => { if (s.value) elecciones[g] = s.value; else delete elecciones[g]; });
      return s;
    });
    const estados = Object.entries(E.campana.recursos.estados || {});
    const est = estados.length ? h('select', { class: 'entrada', 'aria-label': `${titulo}: empieza con un estado` }, h('option', { value: '' }, 'Sin estados'),
      estados.map(([id, e]) => h('option', { value: id }, `Con «${e.nombre || id}»`))) : null;
    if (est) { est.value = estado.estados?.[0] || ''; est.addEventListener('change', () => { estado.estados = est.value ? [est.value] : []; }); }
    caja.replaceChildren(...[h('strong', null, titulo), sel, ...opciones, est].filter(Boolean));
  };
  pintar();
  return caja;
}

export function construirSimulador(def, obj, ctx) {
  const atacante = { tipo: 'personaje', elecciones: {} };
  const objetivo = { tipo: 'npc', id: Object.keys(E.campana.recursos.enemigos || {})[0] };
  if (!objetivo.id) objetivo.tipo = 'personaje';
  const veces = h('select', { class: 'entrada entrada-chica', 'aria-label': 'Cuántas veces' }, [1, 10, 100].map((n) => h('option', { value: String(n) }, `${n} ${n === 1 ? 'vez' : 'veces'}`)));
  veces.value = '10';
  const distancia = h('select', { class: 'entrada entrada-chica', 'aria-label': 'A qué distancia', 'data-sim-distancia': '' },
    [1, 2, 3, 4, 5, 6, 8, 10, 15].map((n) => h('option', { value: String(n) }, n === 1 ? 'Pegados' : `A ${n} casillas`)));
  const salida = h('div', { class: 'sim-salida', 'aria-live': 'polite' });
  const boton = h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'simular', onclick: async () => {
    boton.disabled = true; salida.replaceChildren(h('p', { class: 'tenue' }, 'Probando con las reglas del servidor…'));
    try {
      const r = await window.editor.simular(E.campana.id, { borrador: { cat: 'habilidades', id: ctx.propioId, datos: obj }, habilidad: ctx.propioId,
        atacante, objetivo, veces: Number(veces.value), distancia: Number(distancia.value) });
      pintarResultado(r);
    } catch (e) { salida.replaceChildren(h('p', { class: 'error' }, e.message)); }
    boton.disabled = false;
  } }, '🧪 Probar');

  function pintarResultado(r) {
    if (!r.ok) { salida.replaceChildren(h('div', { class: 'aviso-caja' }, h('strong', null, 'No se puede probar todavía:'), h('ul', null, (r.errores || []).map((e) => h('li', null, e))))); return; }
    const res = r.resumen;
    const verbo = (n) => (n < 0 ? `${-n} de daño` : n > 0 ? `cura ${n}` : 'sin cambio');
    salida.replaceChildren(...[
      res ? h('div', { class: 'sim-resumen', 'data-sim-media': String(res.media) },
        h('span', null, `${r.atacante} → ${r.objetivo} (${r.vida} máx. ${r.vida_max})`),
        h('strong', null, r.veces > 1 ? `Media: ${verbo(Math.round(res.media))} · mínimo ${verbo(res.max)} · máximo ${verbo(res.min)}` : verbo(res.media))) : null,
      r.n_fallos ? h('p', { class: 'error' }, `${r.n_fallos} de ${r.veces} no se pudieron usar: ${r.fallos.join(' · ')}`) : null,
      r.pruebas.length ? h('details', { class: 'sim-detalle', open: r.veces === 1 ? true : null }, h('summary', null, `Ver ${r.pruebas.length === 1 ? 'la tirada' : `las primeras ${r.pruebas.length} tiradas`}`),
        h('ol', null, r.pruebas.map((p) => h('li', null, h('div', null, p.texto), ...p.extra.map((x) => h('div', { class: 'tenue pequeno' }, x)))))) : null].filter(Boolean));
  }

  return h('div', { class: 'campo campo-simulador' },
    h('details', { class: 'bloque plegable sim' }, h('summary', null, '🧪 Probar esta habilidad'),
      h('p', { class: 'ayuda' }, 'Se usa con las reglas reales del servidor (fórmula, etiquetas y ventajas, rasgos, estados y reglas automáticas), con lo que tienes escrito aunque no lo hayas guardado. No toca ninguna partida.'),
      h('div', { class: 'sim-lados' }, selectorCombatiente('Quién la usa', atacante), selectorCombatiente('Sobre quién', objetivo)),
      h('div', { class: 'fila-inline' }, distancia, veces, boton), salida));
}
