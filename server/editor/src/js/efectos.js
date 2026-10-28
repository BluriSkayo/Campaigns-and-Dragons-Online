// efectos.js — Editor de «cuando… solo si… entonces…». Se construye a partir del catálogo del servidor (mesa/efectos.py):
// si allí se añade un disparador, una condición o una acción, aparece aquí sin tocar el Editor (con sus textos y opciones).
import { h, entero } from './util.js';
import { E, stats, recursosJuego, lista, nombresFormula } from './estado.js';
import { revisarFormula } from './formula.js';

// Textos de reserva por si el catálogo de una versión anterior del servidor no trae «etiqueta» o «textos».
const ETIQUETAS = { estadistica: 'Estadística', valor: 'Valor', recurso: 'Recurso', formula: 'Cantidad', objetivo: 'Sobre quién', estado: 'Estado' };
const OBJETIVOS = { uno_mismo: 'Sobre sí mismo', objetivo: 'Sobre el objetivo' };
const ES_QUIEN = (k) => k === 'objetivo' || k === 'quien';

const periodos = () => (E.campana.config.juego?.ciclo?.periodos || []).map((p) => p.nombre).filter(Boolean);
const climas = () => (E.campana.config.juego?.clima?.tipos || []).map((p) => p.nombre).filter(Boolean);
const nombreGrupo = (g) => E.campana.recursos.grupos?.[g]?.nombre || g || '¿sin grupo?';

/** Lo que se puede elegir en un campo que apunta a algo de la campaña. → [[valor, texto]] o null si no es de esos. */
function elementos(tipo) {
  switch (tipo) {
    case 'estadistica': return stats().map((n) => [n, n]);
    case 'recurso': return recursosJuego().map((n) => [n, n]);
    case 'estado': return lista('estados').map((e) => [e.id, e.nombre]);
    case 'objeto': return lista('objetos').map((e) => [e.id, e.nombre]);
    case 'habilidad': return lista('habilidades').map((e) => [e.id, e.nombre]);
    case 'eleccion': return lista('opciones').map((o) => [o.id, `${nombreGrupo(o.datos?.grupo)}: ${o.nombre}`]);
    case 'periodo': return periodos().map((n) => [n, n]);
    case 'clima': return climas().map((n) => [n, n]);
    case 'etiqueta': return (E.campana.config.juego?.etiquetas || []).map((e) => [e.nombre, e.nombre]);
    default: return null;
  }
}
const VACIO = { etiqueta: '(crea etiquetas en Reglas)', estado: '(crea un estado primero)', objeto: '(crea un objeto primero)', habilidad: '(crea una habilidad primero)', eleccion: '(crea razas o clases primero)', clima: '(activa el clima en Reglas)', periodo: '(activa día y noche en Reglas)' };

function valorInicial(d) {
  if (d.sugerido !== undefined) return d.sugerido;
  if (d.tipo === 'recurso') return E.campana.config.juego.recurso_vida || recursosJuego()[0] || '';
  const els = elementos(d.tipo);
  if (els) return els[0]?.[0] || '';
  switch (d.tipo) {
    case 'entero': return d.min > 1 ? d.min : 1;
    case 'formula': return '-3';
    case 'opcion': return d.defecto ?? d.opciones[0];
    default: return '';
  }
}
/** Rellena los campos obligatorios o con valor por defecto de un bloque recién elegido. */
function rellenar(destino, campos, conObjetivo) {
  for (const [c, d] of Object.entries(campos)) {
    if (ES_QUIEN(c) && !conObjetivo) { destino[c] = 'uno_mismo'; continue; }
    if (d.obligatorio || d.defecto !== undefined) destino[c] = valorInicial(d);
  }
  return destino;
}

function camposDe(esquema, destino, alCambiar, { conObjetivo }) {
  const res = [];
  for (const [k, d] of Object.entries(esquema)) {
    if (ES_QUIEN(k) && !conObjetivo) { destino[k] = 'uno_mismo'; continue; }       // solo tiene sentido cuando hay otro participante
    const etiqueta = d.etiqueta || ETIQUETAS[k] || k;
    let control;
    const els = elementos(d.tipo);
    if (els) {
      control = h('select', { class: 'entrada', 'aria-label': etiqueta, 'data-efecto-campo': k },
        d.obligatorio ? null : h('option', { value: '' }, d.tipo === 'estadistica' ? '(todas)' : '(cualquiera)'), els.map(([v, t]) => h('option', { value: v }, t)));
      if (!els.length && VACIO[d.tipo]) control.append(h('option', { value: '' }, VACIO[d.tipo]));
      control.value = destino[k] ?? '';
      if (destino[k] && control.value !== destino[k]) { control.append(h('option', { value: destino[k] }, `${destino[k]} (no existe)`)); control.value = destino[k]; }
      control.addEventListener('change', () => { if (control.value) destino[k] = control.value; else delete destino[k]; alCambiar(); });
    } else if (d.tipo === 'entero') {
      control = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', min: d.min, max: d.max, 'aria-label': etiqueta, 'data-efecto-campo': k });
      control.value = destino[k] ?? 0;
      control.addEventListener('input', () => { destino[k] = entero(control.value, 0); alCambiar(); });
    } else if (d.tipo === 'opcion') {
      control = h('select', { class: 'entrada', 'aria-label': etiqueta, 'data-efecto-campo': k },
        d.opciones.filter((o) => !ES_QUIEN(k) || conObjetivo || o === 'uno_mismo').map((o) => h('option', { value: o }, d.textos?.[o] || OBJETIVOS[o] || o)));
      control.value = destino[k] ?? d.defecto ?? d.opciones[0];
      control.addEventListener('change', () => { destino[k] = control.value; alCambiar(); });
    } else {
      control = h('input', { class: 'entrada entrada-formula', type: 'text', maxlength: '1000', spellcheck: 'false', 'aria-label': etiqueta, 'data-efecto-campo': k });
      control.value = destino[k] ?? '';
      const revisar = () => {      // misma revisión rápida que en las habilidades (sin [h.…]: un efecto no es una habilidad)
        const p = d.tipo === 'formula' ? revisarFormula(control.value, nombresFormula(), { tablas: (E.campana.config.juego?.tablas || []).map((t) => t.nombre) }) : '';
        control.classList.toggle('invalido', !!p); control.title = p || d.ayuda || '';
      };
      control.addEventListener('input', () => { destino[k] = control.value; revisar(); alCambiar(); });
      revisar();
    }
    res.push(h('label', { class: 'efecto-campo', title: d.ayuda || '' }, h('span', { class: 'tenue pequeno' }, etiqueta), control));
  }
  return res;
}

export function construirEfectos(def, obj, ctx) {
  const esq = E.esquemaEfectos;
  const caja = h('div', { class: 'efectos' });
  if (!esq) return h('p', { class: 'ayuda' }, 'No se pudo cargar el catálogo de efectos del servidor (¿está instalado Python?).');
  const condiciones = esq.condiciones || {};
  const lista_ = () => {
    const l = obj[def.k] || (obj[def.k] = []);
    for (const e of l) {
      if (typeof e?.cuando === 'string') e.cuando = { tipo: e.cuando };     // el servidor admite «cuando: inicio_turno» abreviado
      if (typeof e?.si === 'string') e.si = [{ tipo: e.si }];
      else if (e?.si && !Array.isArray(e.si)) e.si = [e.si];
    }
    return l;
  };
  const permitidos = def.habilidad ? (esq.disparadores_habilidad || ['al_impactar']) : def.objeto ? esq.disparadores_objeto : def.tile ? esq.disparadores_tile : def.estado ? esq.disparadores_estado : (esq.disparadores_generales || Object.keys(esq.disparadores));
  const accionesPara = (cuando) => Object.entries(esq.acciones).filter(([k, a]) => (!def.objeto || (cuando === 'siempre') === ['bono_estadistica', 'bono_vision', 'bono_critico'].includes(k)) && (a.disparadores === null || a.disparadores.includes(cuando)));
  // Las condiciones sobre el golpe (crítico, daño) solo con los disparadores de un golpe; «actúa antes» solo cuando hay otro.
  const condicionesPara = (cuando) => Object.entries(condiciones).filter(([, c]) => !(cuando === 'siempre' && c.pasivo === false)
    && (!c.golpe || (esq.disparadores_con_golpe || []).includes(cuando)) && (!c.con_objetivo || esq.disparadores_con_objetivo.includes(cuando)));
  const ayuda = (texto) => (texto ? h('span', { class: 'efecto-ayuda', title: texto, 'aria-label': texto }, 'ⓘ') : null);
  const cambio = () => ctx.alCambiar(def.k);

  /** Al cambiar «cuando», las condiciones que ya no encajan se quitan y las que miraban «al objetivo» pasan a «él mismo». */
  function ajustarCondiciones(ef) {
    if (!ef.si) return;
    const vale = new Set(condicionesPara(ef.cuando.tipo).map(([k]) => k));
    const conObjetivo = esq.disparadores_con_objetivo.includes(ef.cuando.tipo);
    ef.si = ef.si.filter((c) => vale.has(c.tipo));
    for (const c of ef.si) if (!conObjetivo && c.quien === 'objetivo') c.quien = 'uno_mismo';
    if (!ef.si.length) delete ef.si;
  }

  function filaCondicion(ef, c, j, conObjetivo) {
    const opciones = condicionesPara(ef.cuando.tipo);
    const sel = h('select', { class: 'entrada', 'aria-label': 'Condición', 'data-efecto': 'si' }, opciones.map(([k, d]) => h('option', { value: k }, d.nombre)));
    if (!condiciones[c.tipo]) sel.append(h('option', { value: c.tipo }, `${c.tipo} (desconocida)`));
    sel.value = c.tipo;
    sel.addEventListener('change', () => { ef.si[j] = rellenar({ tipo: sel.value }, condiciones[sel.value].campos, conObjetivo); cambio(); pintar(); });
    const d = condiciones[c.tipo];
    return h('div', { class: 'efecto-fila efecto-condicion', 'data-condicion': c.tipo },
      h('span', { class: 'efecto-etq' }, j === 0 ? 'Solo si' : 'y además'), sel,
      ...(d ? camposDe(d.campos, c, cambio, { conObjetivo }) : []),
      d?.ayuda ? h('span', { class: 'efecto-ayuda', title: d.ayuda, 'aria-label': d.ayuda }, 'ⓘ') : null,
      h('button', { type: 'button', class: 'efecto-quitar-si', title: 'Quitar esta condición', 'aria-label': 'Quitar esta condición', 'data-accion': 'quitar-condicion',
        onclick: () => { ef.si.splice(j, 1); if (!ef.si.length) delete ef.si; cambio(); pintar(); } }, '✕'));
  }

  const pintar = () => {
    const efectos = lista_();
    const tarjetas = efectos.map((ef, i) => {
      const cuando = ef.cuando || (ef.cuando = { tipo: permitidos[0] });
      const hacer = ef.hacer || (ef.hacer = { tipo: accionesPara(cuando.tipo)[0][0] });
      const conObjetivo = esq.disparadores_con_objetivo.includes(cuando.tipo);
      const selCuando = h('select', { class: 'entrada', 'aria-label': 'Cuándo', 'data-efecto': 'cuando' },
        permitidos.map((k) => h('option', { value: k }, esq.disparadores[k].nombre)));
      selCuando.value = cuando.tipo;
      selCuando.addEventListener('change', () => {
        ef.cuando = { tipo: selCuando.value };
        const ok = accionesPara(selCuando.value).some(([k]) => k === ef.hacer.tipo);
        if (!ok) { const [k, a] = accionesPara(selCuando.value)[0]; ef.hacer = rellenar({ tipo: k }, a.campos, true); }
        if (!esq.disparadores_con_objetivo.includes(selCuando.value) && ef.hacer.objetivo) ef.hacer.objetivo = 'uno_mismo';
        ajustarCondiciones(ef);
        cambio(); pintar();
      });
      const selHacer = h('select', { class: 'entrada', 'aria-label': 'Qué hace', 'data-efecto': 'hacer' },
        accionesPara(cuando.tipo).map(([k, a]) => h('option', { value: k }, a.nombre)));
      selHacer.value = hacer.tipo;
      selHacer.addEventListener('change', () => {
        ef.hacer = rellenar({ tipo: selHacer.value }, esq.acciones[selHacer.value].campos, conObjetivo);
        cambio(); pintar();
      });
      const conds = (ef.si || []).map((c, j) => filaCondicion(ef, c, j, conObjetivo));
      const masSi = Object.keys(condiciones).length && (ef.si?.length || 0) < 10 ? h('button', { type: 'button', class: 'btn btn-mini efecto-mas-si', 'data-accion': 'anadir-condicion',
        title: 'El efecto solo ocurre si se cumplen TODAS sus condiciones', onclick: () => {
          const [k, d] = condicionesPara(cuando.tipo)[0];
          (ef.si || (ef.si = [])).push(rellenar({ tipo: k }, d.campos, conObjetivo));
          cambio(); pintar();
        } }, ef.si?.length ? '+ Otra condición' : '+ Solo si…') : null;
      return h('div', { class: 'efecto-tarjeta' },
        h('div', { class: 'efecto-fila' }, h('span', { class: 'efecto-etq' }, 'Cuando'), selCuando,
          ...camposDe(esq.disparadores[cuando.tipo].campos, ef.cuando, cambio, { conObjetivo: false }), ayuda(esq.disparadores[cuando.tipo].ayuda)),
        conds.length ? h('div', { class: 'efecto-condiciones' }, conds) : null,
        masSi,
        h('div', { class: 'efecto-fila' }, h('span', { class: 'efecto-etq' }, 'Entonces'), selHacer,
          ...camposDe(esq.acciones[hacer.tipo].campos, ef.hacer, cambio, { conObjetivo }), ayuda(esq.acciones[hacer.tipo].ayuda)),
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro efecto-quitar', title: 'Quitar este efecto', 'aria-label': 'Quitar este efecto',
          onclick: () => { efectos.splice(i, 1); cambio(); pintar(); } }, '✕'));
    });
    caja.replaceChildren(...(tarjetas.length ? tarjetas : [h('p', { class: 'tenue pequeno' }, 'Todavía no hace nada. Añade un efecto.')]),
      h('button', { type: 'button', class: 'btn', onclick: () => {
        const cuando = permitidos[0];
        const [k, a] = accionesPara(cuando)[0];
        efectos.push({ cuando: { tipo: cuando }, hacer: rellenar({ tipo: k }, a.campos, esq.disparadores_con_objetivo.includes(cuando)) });
        cambio(); pintar();
      } }, '+ Añadir efecto'));
  };
  pintar();
  return caja;
}

/** «Solo se puede usar si…» de una habilidad: condiciones sobre quien la usa o sobre el objetivo (sin probabilidad). */
export function construirCondiciones(def, obj, ctx) {
  const esq = E.esquemaEfectos;
  const caja = h('div', { class: 'efectos requisitos', 'data-campo': def.k });
  if (!esq) return h('p', { class: 'ayuda' }, 'No se pudo cargar el catálogo del servidor (¿está instalado Python?).');
  const conds = Object.entries(esq.condiciones || {}).filter(([k, c]) => k !== 'probabilidad' && c.pasivo !== false);
  const cambio = () => ctx.alCambiar(def.k);
  const pintar = () => {
    const l = Array.isArray(obj[def.k]) ? obj[def.k] : [];
    const filas = l.map((c, j) => {
      const sel = h('select', { class: 'entrada', 'aria-label': 'Requisito', 'data-efecto': 'si' }, conds.map(([k, d]) => h('option', { value: k }, d.nombre)));
      if (!esq.condiciones[c.tipo]) sel.append(h('option', { value: c.tipo }, `${c.tipo} (desconocida)`));
      sel.value = c.tipo;
      sel.addEventListener('change', () => { l[j] = rellenar({ tipo: sel.value }, esq.condiciones[sel.value].campos, true); if (l[j].quien) l[j].quien = 'objetivo'; cambio(); pintar(); });
      const d = esq.condiciones[c.tipo];
      return h('div', { class: 'efecto-fila efecto-condicion', 'data-condicion': c.tipo },
        h('span', { class: 'efecto-etq' }, j === 0 ? 'Solo si' : 'y además'), sel, ...(d ? camposDe(d.campos, c, cambio, { conObjetivo: true }) : []),
        h('button', { type: 'button', class: 'efecto-quitar-si', title: 'Quitar este requisito', 'aria-label': 'Quitar este requisito', 'data-accion': 'quitar-requisito',
          onclick: () => { l.splice(j, 1); if (!l.length) delete obj[def.k]; cambio(); pintar(); } }, '✕'));
    });
    caja.replaceChildren(...(filas.length ? filas : [h('p', { class: 'tenue pequeno' }, 'Sin requisitos: se puede usar siempre.')]),
      l.length < 10 ? h('button', { type: 'button', class: 'btn btn-mini', 'data-accion': 'anadir-requisito', onclick: () => {
        const [k, d] = conds.find(([x]) => x === 'tiene_etiqueta') || conds[0];
        const n = rellenar({ tipo: k }, d.campos, true);
        if (n.quien) n.quien = 'objetivo';
        (obj[def.k] = l).push(n); cambio(); pintar();
      } }, l.length ? '+ Otro requisito' : '+ Añadir requisito') : '');
  };
  pintar();
  return caja;
}
