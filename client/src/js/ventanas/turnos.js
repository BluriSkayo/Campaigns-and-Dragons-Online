// ventanas/turnos.js — «Decidiendo los turnos»: una ventanita para todos mientras el combate aún no ha empezado.
//  · A mano: el GM coloca a los participantes en orden (flechas o arrastrando) y pulsa «Listo»; los demás esperan.
//  · Por tirada: cada jugador tira la iniciativa de lo suyo y se espera a que tiren todos (el GM puede empezar ya).
// Se abre y se cierra sola según el estado del combate (S.combate.preparando); el servidor es quien decide.
import { h } from '../util.js';
import { S, controloYo } from '../almacen.js';
import { abrirVentana, cerrarVentana, estaAbierta } from '../ventanas.js';
import { red } from '../red.js';
import { retrato } from '../retrato.js';

const ID = 'decidir-turnos';
const puedoControlar = (t) => S.esGM || controloYo(t);

// El GM saca a alguien de los turnos (sigue en el mapa): para no obligar a que participe todo el que está en la sala.
const sacar = (t) => (S.esGM ? h('button', { class: 'chip-flecha chip-sacar', title: `Sacar a ${t.nombre} de los turnos`, 'aria-label': `Sacar a ${t.nombre} de los turnos`,
  'data-accion': 'sacar-de-turnos', onclick: () => red.enviar({ tipo: 'gm_combate_turnos', token: t.id, dentro: false }) }, '✕') : null);

function ficha(t, extra = []) {
  return h('div', { class: `turnos-ficha${t.tipo === 'enemigo' ? ' npc' : ''}`, 'data-turno': t.id, title: t.nombre }, retrato(t.imagen, t.nombre, 'mini'), h('span', { class: 'chip-nombre' }, t.nombre), ...extra, sacar(t));
}

function pintarManual(p) {
  const orden = p.orden || p.participantes;
  const mover = (i, d) => { const o = [...orden]; [o[i], o[i + d]] = [o[i + d], o[i]]; red.enviar({ tipo: 'gm_orden_turnos', orden: o }); };
  const mover_a = (desde, hasta) => { if (desde === hasta) return; const o = [...orden]; const [x] = o.splice(desde, 1); o.splice(hasta, 0, x); red.enviar({ tipo: 'gm_orden_turnos', orden: o }); };
  const cadena = h('div', { class: 'turnos-cadena', role: 'list', 'aria-label': 'Orden de los turnos' });
  orden.forEach((id, i) => {
    const t = S.tokens.get(id);
    if (!t) return;
    if (i > 0) cadena.append(h('span', { class: 'turnos-flecha', 'aria-hidden': 'true' }, '→'));
    const f = ficha(t, S.esGM ? [h('span', { class: 'chip-orden' },
      h('button', { class: 'chip-flecha', title: 'Antes', 'aria-label': `Mover a ${t.nombre} antes`, disabled: i === 0, 'data-accion': 'turno-antes', onclick: () => mover(i, -1) }, '◀'),
      h('button', { class: 'chip-flecha', title: 'Después', 'aria-label': `Mover a ${t.nombre} después`, disabled: i === orden.length - 1, 'data-accion': 'turno-despues', onclick: () => mover(i, 1) }, '▶'))] : []);
    f.setAttribute('role', 'listitem');
    if (S.esGM) {
      f.draggable = true;
      f.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      f.addEventListener('dragover', (e) => { e.preventDefault(); f.classList.add('soltar'); });
      f.addEventListener('dragleave', () => f.classList.remove('soltar'));
      f.addEventListener('drop', (e) => { e.preventDefault(); f.classList.remove('soltar'); mover_a(Number(e.dataTransfer.getData('text/plain')), i); });
    }
    cadena.append(f);
  });
  return h('div', { class: 'turnos-ventana', 'data-modo': 'manual' },
    h('p', { class: 'tenue' }, S.esGM ? 'Coloca a los participantes en el orden en que jugarán (de izquierda a derecha). Arrástralos o usa las flechas. Con ✕ sacas a quien no participe (clic derecho en un token del mapa para añadirlo).' : '⏳ El GM está decidiendo el orden de los turnos. Esperando a que marque «Listo»…'),
    cadena,
    S.esGM ? h('div', { class: 'pie' },
      h('button', { class: 'btn btn-suave', 'data-accion': 'cancelar-combate', onclick: () => red.enviar({ tipo: 'gm_terminar_combate' }) }, 'Cancelar combate'),
      h('button', { class: 'btn btn-acento', 'data-accion': 'turnos-listo', onclick: () => red.enviar({ tipo: 'gm_empezar_combate' }) }, '✔ Listo')) : null);
}

function pintarTirada(p) {
  const filas = p.participantes.map((id) => {
    const t = S.tokens.get(id);
    if (!t) return null;
    const valor = p.tiradas[id];
    const puedo = valor == null && puedoControlar(t) && t.tipo !== 'enemigo';
    return h('div', { class: 'turnos-fila' }, ficha(t),
      valor != null ? h('strong', { class: 'chip-valor', 'data-valor': String(valor) }, String(valor))
        : puedo ? h('button', { class: 'btn btn-mini btn-acento', 'data-accion': 'tirar-iniciativa', onclick: () => red.enviar({ tipo: 'tirar_iniciativa', token: id }) }, '🎲 Tirar')
          : h('span', { class: 'tenue pequeno' }, 'esperando…'));
  }).filter(Boolean);
  const hechos = p.participantes.filter((id) => p.tiradas[id] != null).length;
  return h('div', { class: 'turnos-ventana', 'data-modo': 'tirada' },
    h('p', { class: 'tenue' }, `Cada jugador tira la iniciativa de su personaje. El combate empieza cuando hayan tirado todos (${hechos}/${p.participantes.length}).`),
    h('div', { class: 'turnos-lista' }, filas),
    S.esGM ? h('div', { class: 'pie' },
      h('button', { class: 'btn btn-suave', 'data-accion': 'cancelar-combate', onclick: () => red.enviar({ tipo: 'gm_terminar_combate' }) }, 'Cancelar combate'),
      h('button', { class: 'btn btn-acento', 'data-accion': 'empezar-combate-ventana', title: 'Se tira por quien falte', onclick: () => red.enviar({ tipo: 'gm_empezar_combate' }) }, 'Empezar ya')) : null);
}

function render() {
  const p = S.combate.preparando;
  if (!p) return h('p', { class: 'tenue' }, '');
  return p.modo === 'manual' ? pintarManual(p) : pintarTirada(p);
}

/** Abre la ventana (o la trae al frente). */
export function abrirTurnos() {
  abrirVentana({ id: ID, titulo: '🎲 Decidiendo los turnos', ancho: 520, render, eventos: ['combate', 'tokens'] });
}

/** Se llama cuando cambia el combate: la ventana aparece sola al empezar a decidir los turnos y se cierra sola cuando empieza el combate. */
export function sincronizarTurnos() {
  if (S.combate.preparando) { if (!estaAbierta(ID)) abrirTurnos(); }
  else if (estaAbierta(ID)) cerrarVentana(ID);
}
