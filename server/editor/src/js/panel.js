// panel.js — Panel derecho: problemas de la campaña, dónde se usa lo que estás editando y ayuda.
import { h } from './util.js';
import { E, bus, pestana, usadoPor } from './estado.js';
import { irA as abrir, irAReglas as abrirReglas, irASonidos as abrirSonidos } from './navegacion.js';
import { CATEGORIAS } from './esquemas.js';

const CARPETA_A_CAT = { abilities: 'habilidades', items: 'objetos', enemies: 'enemigos', groups: 'grupos', options: 'opciones', traits: 'rasgos', states: 'estados', shops: 'tiendas', maps: 'mapas', tiles: 'tiles', journal: 'diario' };

// Qué sección de Reglas guarda cada clave de config.yaml (para que un error de configuración abra su sección y no siempre «General»)
const SECCION_DE_CLAVE = {
  servidor: 'general', mapa_inicial: 'general',
  estadisticas: 'estadisticas', recursos: 'estadisticas', recurso_vida: 'estadisticas', dados: 'estadisticas', tirada_estadistica: 'estadisticas',
  puntos_a_repartir: 'personajes', usar_grupos: 'personajes', sin_ficha: 'personajes', crear_personajes: 'personajes', stats_por_plantilla: 'personajes',
  campos_ficha: 'ficha', nombres: 'mesa', orden_menu: 'mesa',
  tablas: 'tablas', etiquetas: 'etiquetas', ventajas: 'etiquetas', efectos: 'automaticas',
  iniciativa: 'turnos', iniciativa_opciones: 'turnos', estadistica_iniciativa: 'turnos', movimiento: 'turnos', fin_combate: 'turnos',
  niveles: 'niveles',
  permisos: 'mesa', diario_reglas: 'mesa', inventario_grupo: 'mesa', sonidos_activos: 'mesa', chat: 'mesa', salas_chat: 'mesa', max_mensajes_chat: 'mesa',
  moneda: 'dinero', intercambios: 'dinero', dar_objetos: 'dinero', alcance_objetos: 'dinero', ciclo: 'sistema', clima: 'sistema', niebla: 'niebla', visibilidad: 'visibilidad', seguridad: 'seguridad',
};
/** Claves que aparecen en el texto de un error de configuración («config.yaml → juego → clima: …», «config.yaml: «fin_combate» debe…»), en orden. */
const clavesDe = (t) => [...t.replace(/^config\.yaml/, '').matchAll(/«([a-z_]+)»|\b([a-z_]{3,})\b/g)].map((m) => m[1] || m[2]);

/** Lleva hasta el campo del formulario que tiene el error (si está en pantalla): lo muestra, lo enfoca y lo resalta un momento. */
function resaltarCampo(clave) {
  if (!clave) return;
  requestAnimationFrame(() => setTimeout(() => {
    const el = document.querySelector(`[data-campo="${CSS.escape(clave)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const caja = el.closest('.campo') || el;
    caja.classList.add('campo-error');
    setTimeout(() => caja.classList.remove('campo-error'), 3500);
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, 120));
}

/** Abre el sitio del error y, si hay forma, el campo exacto. Devuelve una promesa de «se abrió algo» (false si no hay a dónde ir o se canceló el cambio). */
async function abrirDesdeTexto(t) {
  const m = /^(abilities|items|enemies|groups|options|traits|states|shops|maps|tiles)\/([a-z0-9_]+)\.yaml:?\s*(.*)$/.exec(t);
  if (m && E.campana.recursos[CARPETA_A_CAT[m[1]]]?.[m[2]]) {
    if (!(await abrir(CARPETA_A_CAT[m[1]], m[2]))) return false;
    resaltarCampo(/^[«"]?([a-z_]+)/.exec(m[3])?.[1]);
    return true;
  }
  if (t.startsWith('config.yaml')) {
    const claves = clavesDe(t);
    const enDinero = claves.find((k) => ['intercambios', 'dar_objetos', 'alcance_objetos'].includes(k));
    const clave = enDinero || claves.find((k) => SECCION_DE_CLAVE[k]);      // «permisos → intercambios / dar_objetos…» está en Dinero y comercio
    if (!(await abrirReglas(SECCION_DE_CLAVE[clave] || 'general'))) return false;
    resaltarCampo(claves.find((k) => k !== 'juego' && SECCION_DE_CLAVE[k]) || clave);
    return true;
  }
  if (t.startsWith('sonidos.yaml')) return abrirSonidos();
  return false;
}

/** «abilities/bola_de_fuego.yaml: formula → …» → «Bola de Fuego: formula → …» */
function amigable(t) {
  const m = /^(abilities|items|enemies|groups|options|traits|states|shops|maps|tiles)\/([a-z0-9_]+)\.yaml:?\s*(.*)$/.exec(t);
  if (!m) return t.replace(/^config\.yaml:?\s*/, 'Reglas del juego: ').replace(/^sonidos\.yaml:?\s*/, 'Sonidos: ');
  const cat = CARPETA_A_CAT[m[1]];
  const nombre = E.campana.recursos[cat]?.[m[2]]?.nombre || m[2];
  return `${CATEGORIAS[cat].singular[0].toUpperCase()}${CATEGORIAS[cat].singular.slice(1)} «${nombre}»: ${m[3]}`;
}

// Avisos marcados como intencionados: se recuerdan por campaña en este equipo (no son errores: el servidor arranca igual).
const CLAVE_AVISOS = () => `editor.avisosIntencionados.${E.campana?.id || ''}`;
const descartados = {
  leer() { try { return new Set(JSON.parse(localStorage.getItem(CLAVE_AVISOS()) || '[]')); } catch { return new Set(); } },
  has(t) { return this.leer().has(t); },
  add(t) { const s = this.leer(); s.add(t); try { localStorage.setItem(CLAVE_AVISOS(), JSON.stringify([...s].slice(-500))); } catch { /* sin almacenamiento */ } },
  clear() { try { localStorage.removeItem(CLAVE_AVISOS()); } catch { /* sin almacenamiento */ } },
};

/** Oculta de una vez todos los avisos que hay ahora (quedan como «intencionados» en esta campaña). → cuántos. Los errores no se pueden ocultar. */
export function ocultarTodosLosAvisos() {
  const nuevos = E.problemas.avisos.filter((t) => !descartados.has(t));
  for (const t of nuevos) descartados.add(t);
  bus.emit('problemas');
  return nuevos.length;
}
/** Vuelve a mostrar los avisos ocultos de esta campaña. */
export function mostrarAvisosOcultos() { descartados.clear(); bus.emit('problemas'); }
export const hayAvisosOcultos = () => E.problemas.avisos.some((t) => descartados.has(t));
export const hayAvisosVisibles = () => E.problemas.avisos.some((t) => !descartados.has(t));

const CLAVE_PLEGADO = 'editor.problemasPlegados';
const plegado = { leer() { try { return localStorage.getItem(CLAVE_PLEGADO) === '1'; } catch { return false; } }, poner(v) { try { localStorage.setItem(CLAVE_PLEGADO, v ? '1' : '0'); } catch { /* nada */ } } };

export function crearPanel() {
  const el = h('aside', { class: 'panel-derecho', 'aria-label': 'Problemas y ayuda' });
  function pintar() {
    if (!E.campana) { el.replaceChildren(); return; }
    const pr = E.problemas;
    const todas = [...pr.errores.map((t) => ({ t, tipo: 'error' })), ...pr.avisos.map((t) => ({ t, tipo: 'aviso' }))];
    // Solo los avisos se pueden cerrar: un error impide arrancar el servidor y no debe esconderse.
    const ign = descartados.leer();
    const filas = todas.filter((f) => f.tipo === 'error' || !ign.has(f.t));
    const ocultos = todas.length - filas.length;
    const nAvisos = filas.filter((f) => f.tipo === 'aviso').length;
    const cabProblemas = pr.estado === 'validando' ? 'Comprobando…' : pr.estado === 'sin-python' ? 'No se pudo comprobar' : filas.length ? `${pr.errores.length} errores · ${nAvisos} avisos` : 'Todo en orden';
    // La lista se puede plegar (si hay muchos); los avisos se pueden ocultar todos de una vez. Los errores no se esconden: impiden abrir el servidor.
    const plegada = plegado.leer() && filas.length > 0;
    const titulo = filas.length
      ? h('button', { type: 'button', class: 'problemas-plegar', 'aria-expanded': String(!plegada), 'data-accion': 'plegar-problemas', title: plegada ? 'Mostrar la lista' : 'Plegar la lista',
        onclick: () => { plegado.poner(!plegada); pintar(); } }, h('span', { class: 'flecha', 'aria-hidden': 'true' }, '▾'), 'Problemas')
      : 'Problemas ';
    const acciones = !plegada && nAvisos > 1 ? h('div', { class: 'problemas-acciones' },
      h('button', { type: 'button', class: 'btn btn-mini', 'data-accion': 'ocultar-avisos', title: 'Marca todos los avisos como intencionados en esta campaña (no los errores: esos impiden abrir el servidor)',
        onclick: () => ocultarTodosLosAvisos() }, `✕ Ocultar los ${nAvisos} avisos`)) : null;
    const problemas = h('section', { class: 'bloque-panel' }, h('h3', null, titulo, ' ', h('span', { class: `insignia insignia-${pr.estado === 'error' ? 'error' : pr.estado === 'ok' ? 'bien' : 'neutro'}` }, cabProblemas)),
      pr.estado === 'sin-python' ? h('p', { class: 'ayuda' }, pr.mensaje) : null,
      acciones,
      plegada ? null : filas.length ? h('ul', { class: 'lista-problemas' }, filas.map(({ t, tipo }) => h('li', { class: 'problema-fila' },
        h('button', { type: 'button', class: `problema problema-${tipo}`, title: 'Ir al error', onclick: () => abrirDesdeTexto(t) }, h('span', { class: 'problema-ico' }, tipo === 'error' ? '⛔' : '⚠️'), h('span', { class: 'problema-texto' }, amigable(t))),
        tipo === 'aviso' ? h('button', { type: 'button', class: 'problema-cerrar', title: 'Es intencionado: no volver a avisar (en esta campaña)', 'aria-label': 'Marcar como intencionado', onclick: () => { descartados.add(t); pintar(); } }, '✕') : null)))
        : (pr.estado === 'ok' ? h('p', { class: 'ayuda' }, 'El servidor puede arrancar con esta campaña.') : null),
      ocultos ? h('p', { class: 'ayuda' }, `${ocultos} aviso${ocultos === 1 ? '' : 's'} marcado${ocultos === 1 ? '' : 's'} como intencionado${ocultos === 1 ? '' : 's'}. `, h('button', { type: 'button', class: 'enlace', onclick: () => { descartados.clear(); pintar(); } }, 'Mostrar de nuevo')) : null);

    const p = pestana(E.activa);
    let contexto = null;
    if (p?.tipo === 'recurso') {
      const usos = usadoPor(p.cat, p.id);
      contexto = h('section', { class: 'bloque-panel' }, h('h3', null, 'Se usa en'),
        usos.length ? h('ul', { class: 'lista-usos' }, usos.map((u) => h('li', null, h('button', { type: 'button', class: 'enlace', onclick: () => (u.cat === 'reglas' ? abrirReglas('general') : abrir(u.cat, u.id)) }, `${u.cat === 'reglas' ? '⚙️' : CATEGORIAS[u.cat].icono} ${u.nombre}`))))
          : h('p', { class: 'ayuda' }, 'Nada lo usa todavía.'));
    }
    const ayuda = p?.tipo === 'recurso' ? h('section', { class: 'bloque-panel' }, h('h3', null, 'Ayuda'), h('p', { class: 'ayuda' }, CATEGORIAS[p.cat].ayuda)) : null;
    el.replaceChildren(...[problemas, contexto, ayuda].filter(Boolean));
  }
  for (const ev of ['campana', 'campana-cambiada', 'pestanas', 'problemas', 'guardado']) bus.on(ev, pintar);
  pintar();
  return { el };
}
