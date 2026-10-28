// ventanas/gm.js — Panel del Game Master: combate y NPC. (Los mapas se cambian desde el panel de salas.)
import { h } from '../util.js';
import { S, tokenFoco, quienEs } from '../almacen.js';
import { abrirVentana } from '../ventanas.js';
import { red } from '../red.js';
import { colocarEnemigoModo, desplegarPersonaje, retirarPersonaje, pedirPersonajes } from '../acciones.js';
import { editarToken } from './editar-token.js';
import { analizar } from './analisis.js';
import { abrirMenu } from '../menu.js';
import { ajustes, guardar } from '../ajustes.js';

const NOMBRES_MODO = {
  estadistica: ['🎲 Cada uno tira su iniciativa', 'd20 + estadística; los NPC tiran solos'],
  valor: ['📊 Por la estadística más alta', 'Sin dados: de mayor a menor'],
  manual: ['✋ Lo decido yo', 'Se abre una ventanita para ordenar a los participantes; los demás esperan a que marques «Listo»'],
};
/** «Iniciar combate»: si la campaña deja elegir cómo se deciden los turnos, se pregunta aquí. */
function iniciarCombate(ev) {
  const modos = S.catalogo.iniciativa === 'preguntar' ? (S.catalogo.iniciativa_opciones || []) : [];
  if (modos.length < 2) { red.enviar({ tipo: 'gm_iniciar_combate', ...(modos.length ? { modo: modos[0] } : {}) }); return; }
  const r = ev.currentTarget.getBoundingClientRect();
  abrirMenu(document.querySelector('.principal') || document.body, r.left, r.bottom, [{ titulo: '¿Cómo se deciden los turnos?' },
    ...modos.map((m) => ({ texto: NOMBRES_MODO[m][0], detalle: NOMBRES_MODO[m][1], accion: () => red.enviar({ tipo: 'gm_iniciar_combate', modo: m }) }))]);
}

export function tiendasGM() {
  const todas = Object.entries(S.catalogo.tiendas || {});
  if (!todas.length) return null;
  return h('div', { class: 'gm-tiendas' }, h('h4', { class: 'sub' }, 'Tiendas'),
    h('ul', { class: 'lista-acciones' }, todas.map(([id, t]) => {
      const abierta = S.tiendas.some((x) => x.id === id);
      const fuera = abierta && S.tiendas.find((x) => x.id === id).aqui === false;
      return h('li', { class: 'fila-accion', 'data-tienda': id },
        h('div', { class: 'fila-texto' }, h('strong', null, t.nombre), h('span', { class: 'tenue pequeno' }, fuera ? 'Abierta, pero no en este mapa' : abierta ? 'Abierta' : 'Cerrada')),
        h('span', { class: 'mini-botones' },
          h('button', { class: 'btn', 'data-accion': abierta ? 'cerrar-tienda' : 'abrir-tienda', onclick: () => red.enviar({ tipo: 'gm_tienda_abrir', tienda: id, abierta: !abierta }) }, abierta ? 'Cerrar' : 'Abrir'),
          h('button', { class: 'btn', title: 'Vuelve a llenar las existencias', onclick: () => red.enviar({ tipo: 'gm_tienda_abrir', tienda: id, abierta, reponer: true }) }, 'Reponer')));
    })));
}

/** «Colocar NPC» agrupados por su categoría (Aliados, Enemigos…), cada una plegable y recordada en este equipo. Sin categorías, la lista de siempre. */
function listaNpc(enemigos, alCambiar) {
  const fila = ([id, e]) => h('li', { class: 'fila-accion' },
    h('div', { class: 'fila-texto' }, h('strong', null, e.nombre), h('span', { class: `etiqueta-bando bando-${e.bando}` }, { aliado: 'Aliado', neutral: 'Neutral', enemigo: 'Enemigo' }[e.bando] || 'Neutral'),
      e.descripcion ? h('span', { class: 'tenue pequeno' }, e.descripcion) : null),
    h('button', { class: 'btn', onclick: () => colocarEnemigoModo(id) }, 'Colocar'));
  const grupos = new Map();
  for (const par of enemigos) {
    const c = String(par[1].categoria || '').trim();
    const k = [...grupos.keys()].find((x) => x.toLowerCase() === c.toLowerCase()) ?? c;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(par);
  }
  if (grupos.size === 1 && grupos.has('')) return h('ul', { class: 'lista-acciones' }, enemigos.map(fila));
  const plegadas = ajustes.categoriasNpcPlegadas || {};
  return h('div', { class: 'npc-categorias' }, [...grupos.keys()].sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'es', { sensitivity: 'base' })).map((c) => {
    const k = c.toLowerCase();
    const plegada = !!plegadas[k];
    return h('section', { class: `npc-categoria${plegada ? ' plegada' : ''}`, 'data-categoria': c || '(sin categoría)' },
      h('button', { type: 'button', class: 'npc-categoria-cab', 'aria-expanded': String(!plegada), 'data-accion': 'plegar-categoria-npc',
        onclick: () => { const n = { ...(ajustes.categoriasNpcPlegadas || {}) }; if (plegada) delete n[k]; else n[k] = true; guardar({ categoriasNpcPlegadas: n }); alCambiar(); } },
      h('span', { class: 'musica-flecha', 'aria-hidden': 'true' }, '▾'), h('span', null, c || 'Sin categoría'), h('span', { class: 'tenue pequeno' }, String(grupos.get(c).length))),
      plegada ? null : h('ul', { class: 'lista-acciones' }, grupos.get(c).map(fila)));
  }));
}

function contenido(v) {
  const enemigos = Object.entries(S.catalogo.enemigos || {});
  const foco = tokenFoco();
  const combate = S.combate.activo || !!S.combate.preparando;

  return h('div', { class: 'gm' },
    h('h4', { class: 'sub primero' }, 'Combate'),
    h('div', { class: 'fila-botones' },
      h('button', { class: 'btn btn-acento', disabled: combate, 'data-accion': 'iniciar-combate', onclick: iniciarCombate }, 'Iniciar combate'),
      h('button', { class: 'btn', disabled: !combate, onclick: () => red.enviar({ tipo: 'gm_terminar_combate' }) }, 'Terminar combate')),
    combate ? h('p', { class: 'tenue pequeno' }, `Ronda ${S.combate.ronda}`) : null,

    h('h4', { class: 'sub' }, 'Personajes de los jugadores'),
    S.todosPersonajes.length
      ? h('ul', { class: 'lista-acciones' }, S.todosPersonajes.map((p) => {
        const token = [...S.tokens.values()].find((t) => t.personaje === p.id && t.dueno === p.usuario);
        const otraSala = !token && p.desplegado && p.sala && p.sala !== S.mapaId ? p.sala : null;      // está en otra sala
        const nombreSala = otraSala ? ((S.salasMapa || []).find((m) => m.id === otraSala)?.nombre || otraSala) : '';
        return h('li', { class: 'fila-accion' },
          h('div', { class: 'fila-texto' }, h('strong', null, p.nombre),
            h('span', { class: 'tenue pequeno' }, `${p.usuario}${S.catalogo.niveles?.activo ? ` · nivel ${p.nivel || 1}` : ''} · ${token ? 'en el mapa' : otraSala ? `en «${nombreSala}»` : 'fuera del mapa'}`)),
          S.catalogo.niveles?.activo ? h('button', { class: 'btn btn-mini', title: 'Subir un nivel', 'aria-label': `Subir de nivel a ${p.nombre}`, 'data-accion': 'subir-nivel',
            onclick: () => red.enviar({ tipo: 'gm_subir_nivel', usuario: p.usuario, personaje: p.id }) }, '⬆️') : null,
          otraSala
            ? h('button', { class: 'btn', title: `Pasar a ver «${nombreSala}» (nadie se mueve)`, 'data-accion': 'ver-sala', onclick: () => red.enviar({ tipo: 'cambiar_sala', mapa: otraSala }) }, 'Ver su sala')
          : token
            ? h('button', { class: 'btn', title: 'Lo quita del mapa; el personaje no se borra', onclick: () => retirarPersonaje(token.id) }, 'Retirar')
            : h('button', { class: 'btn', title: 'Aparece en el punto de inicio. Para elegir casilla usa el clic derecho en el mapa.',
              onclick: () => desplegarPersonaje(p.id, p.usuario) }, 'Desplegar'));
      }))
      : h('p', { class: 'tenue' }, 'Todavía no hay personajes creados.'),

    h('h4', { class: 'sub' }, 'Colocar NPC'),
    enemigos.length
      ? listaNpc(enemigos, () => v?.refrescar?.())
      : h('p', { class: 'tenue' }, 'No hay NPC definidos en el servidor.'),
    h('p', { class: 'tenue pequeno' }, 'Pulsa «Colocar» y haz clic en el mapa. Esc para terminar.'),

    tiendasGM(),

    h('h4', { class: 'sub' }, 'Token seleccionado'),
    foco
      ? h('div', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, h('strong', null, foco.nombre), h('span', { class: 'tenue pequeno' }, quienEs(foco))),
        h('span', { class: 'mini-botones' },
          foco.tipo === 'personaje' ? h('button', { class: 'btn', title: 'Lo quita del mapa; el personaje no se borra', onclick: () => retirarPersonaje(foco.id) }, 'Retirar') : null,
          h('button', { class: 'btn', disabled: !foco.stats, onclick: () => editarToken(foco.id) }, 'Editar'),
          h('button', { class: 'btn', onclick: () => analizar({ tipo: 'token', id: foco.id }) }, 'Analizar'),
          foco.tipo === 'enemigo' ? h('button', { class: 'btn btn-peligro', onclick: () => {
            if (confirm(`¿Quitar a ${foco.nombre} del mapa?`)) red.enviar({ tipo: 'gm_quitar_token', token: foco.id });
          } }, 'Quitar') : null))
      : h('p', { class: 'tenue' }, 'Haz clic en un token para seleccionarlo. También puedes usar el clic derecho sobre el mapa.'));
}

export const DEF_GM = { id: 'gm', titulo: 'Panel del GM', ancho: 340, render: contenido, alAbrir: pedirPersonajes,
  eventos: ['tokens', 'foco', 'combate', 'estado', 'todos-personajes', 'tiendas'] };
export function abrirGM() { pedirPersonajes(); abrirVentana(DEF_GM); }
