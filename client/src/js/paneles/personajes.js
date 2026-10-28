// paneles/personajes.js — Lista desplegable de personajes con sus habilidades (se usa en el panel izquierdo y como ventanita).
// Pulsar un personaje despliega sus habilidades; clic derecho abre su ficha completa en una ventana propia.
import { h, sinSaltoDeScroll, toast } from '../util.js';
import { S, bus, puedoControlar } from '../almacen.js';
import { retrato } from '../retrato.js';
import { desplegarPersonaje, exportarPersonaje } from '../acciones.js';
import { hayAlmacen } from '../archivos.js';
import { tarjetaHabilidad } from '../ventanas/habilidad-info.js';
import { abrirPersonaje } from '../ventanas/personaje.js';
import { abrirMenu } from '../menu.js';
import { crearSeleccion } from '../pantallas/seleccion.js';
import { dialogo } from '../dialogo.js';

/** ¿Este usuario puede crearse otra ficha ahora? El GM siempre; el jugador si la mesa lo permite y no llegó al máximo. */
export function puedeCrearFicha() {
  if (S.esGM) return true;
  const max = S.catalogo?.reglas?.max_personajes_por_jugador;
  return !!S.permisos.crear_personajes && (typeof max !== 'number' || S.personajes.length < max);
}
/** «Crear ficha nueva» sin salir de la partida: el creador de siempre, en una ventana encima del juego. */
export async function crearFichaNueva() {
  let cerrar = null;
  const comp = crearSeleccion({ enPartida: true, alTerminar: (id) => cerrar?.(id) });
  const r = await dialogo({ titulo: 'Crear ficha nueva', contenido: comp.el, botones: [], ancho: 860, alMostrar: (_c, c) => { cerrar = c; } });
  comp.destruir();
  if (r) toast('Ficha creada. Despliégala desde aquí (o arrástrala al mapa).', 'ok');
}

const abiertos = new Set();           // personajes con las habilidades desplegadas (se recuerda entre repintados)

/** Lo que se muestra: los personajes del jugador, o todos si es GM. Cada entrada trae su token si está en el mapa. */
function entradas() {
  const tokenDe = (id, dueno) => [...S.tokens.values()].find((t) => t.tipo === 'personaje' && t.personaje === id && t.dueno === dueno);
  return S.esGM
    ? S.todosPersonajes.map((p) => ({ id: p.id, nombre: p.nombre, imagen: p.imagen, dueno: p.usuario, token: tokenDe(p.id, p.usuario) }))
    : S.personajes.map((p) => ({ id: p.id, nombre: p.nombre, imagen: p.imagen, dueno: S.usuario, token: tokenDe(p.id, S.usuario) }));
}

function habilidadesDe(e) {
  const t = e.token;
  if (!t) {
    return h('div', { class: 'pers-habs' }, h('p', { class: 'tenue pequeno' }, 'No está en el mapa.'),
      h('button', { class: 'btn', onclick: () => desplegarPersonaje(e.id, e.dueno) }, 'Desplegar'));
  }
  const ids = t.habilidades || [];
  if (!ids.length) return h('div', { class: 'pers-habs' }, h('p', { class: 'tenue pequeno' }, t.stats ? 'No conoce ninguna habilidad.' : 'No puedes ver sus habilidades.'));
  const puede = puedoControlar(t) && !t.derrotado;
  return h('ul', { class: 'pers-habs' }, ids.map((id) => tarjetaHabilidad(id, t.id, puede)));
}

export function crearListaPersonajes() {
  const el = h('div', { class: 'lista-personajes' });
  function pintar() {
    const lista = entradas();
    const max = S.catalogo?.reglas?.max_personajes_por_jugador;
    const nueva = puedeCrearFicha() ? h('button', { type: 'button', class: 'btn btn-suave pers-nueva', 'data-accion': 'crear-ficha', onclick: crearFichaNueva,
      title: S.esGM ? 'Crear un personaje (luego puedes dárselo a un jugador con «Pertenece a», si la mesa lo permite)' : `Puedes tener hasta ${max} ${max === 1 ? 'personaje' : 'personajes'}` },
    '➕ Crear ficha nueva', !S.esGM && typeof max === 'number' ? h('span', { class: 'tenue pequeno' }, ` (${S.personajes.length}/${max})`) : null) : null;
    if (!lista.length) { el.replaceChildren(h('p', { class: 'tenue pequeno' }, 'No hay personajes todavía.'), ...(nueva ? [nueva] : [])); return; }
    sinSaltoDeScroll(el, () => el.replaceChildren(...lista.map((e) => {
      const abierto = abiertos.has(e.id);
      const arrastrable = !e.token;          // sin desplegar: se arrastra al mapa para ponerlo en esa casilla
      const cabecera = h('button', { class: `pers-item${abierto ? ' abierto' : ''}`, 'aria-expanded': String(abierto), draggable: arrastrable ? 'true' : null,
        title: arrastrable ? 'Pulsa para ver sus habilidades · Arrástralo al mapa para desplegarlo · Clic derecho: ficha completa' : 'Pulsa para ver sus habilidades. Clic derecho: ficha completa',
        ondragstart: arrastrable ? (ev) => { ev.dataTransfer.setData('application/x-mesa-personaje', JSON.stringify({ personaje: e.id, usuario: e.dueno })); ev.dataTransfer.effectAllowed = 'move'; } : null,
        onclick: () => { if (abiertos.has(e.id)) abiertos.delete(e.id); else abiertos.add(e.id); pintar(); },
        oncontextmenu: (ev) => {
          ev.preventDefault();
          abrirMenu(el.closest('.principal') || document.body, ev.clientX, ev.clientY, [
            { titulo: e.nombre }, { texto: 'Ver ficha', accion: () => abrirPersonaje(e.token?.id, e) },
            ...(hayAlmacen && e.dueno === S.usuario ? [{ texto: '📤 Exportar personaje…', accion: () => exportarPersonaje(e.id), detalle: 'Ficha e imágenes, para que el GM la importe en el Editor' }] : [])]);
        } },
      retrato(e.imagen, e.nombre, 'mini'),
      h('span', { class: 'pers-nombre' }, e.nombre, S.esGM ? h('span', { class: 'tenue pequeno' }, ` (${e.dueno})`) : null),
      h('span', { class: 'pers-flecha', 'aria-hidden': 'true' }, abierto ? '▾' : '▸'));
      return h('div', { class: 'pers-bloque' }, cabecera, abierto ? habilidadesDe(e) : null);
    }), ...(nueva ? [nueva] : [])));
  }
  const offs = ['tokens', 'estado', 'personajes', 'todos-personajes', 'combate', 'permisos'].map((ev) => bus.on(ev, pintar));
  pintar();
  return { el, destruir: () => offs.forEach((f) => f()) };
}
