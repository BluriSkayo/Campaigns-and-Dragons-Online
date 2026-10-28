// paneles/chat.js — Chat integrado. Los mensajes llegan ya filtrados por el servidor.
// Hay una sala general (todos) y, si el GM las crea, salas privadas con solo algunos jugadores.
import { h } from '../util.js';
import { S, bus, controloYo } from '../almacen.js';
import { retrato } from '../retrato.js';
import { enviarChat } from '../acciones.js';
import { icono } from '../iconos.js';
import { editarSala } from '../ventanas/sala-chat.js';
import { red } from '../red.js';
import { confirmar } from '../dialogo.js';

const MAX_VISIBLES = 250;
const sala = (m) => m.sala || 'general';
let hablarComo = '';               // '' = como usuario; si no, el id del token (de la sala actual) con el que se habla

/** Tokens de la sala con los que puedo hablar: los míos (y los NPC que controlo); el GM, cualquiera. */
function voces() {
  return [...S.tokens.values()].filter((t) => S.esGM || controloYo(t))
    .sort((a, b) => (a.tipo !== 'personaje') - (b.tipo !== 'personaje') || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

export function crearChat() {
  let actual = 'general';
  const sinLeer = new Map();                       // sala → mensajes nuevos que no has visto
  const lista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite' });
  const pestanas = h('div', { class: 'chat-salas', role: 'tablist', 'aria-label': 'Salas de chat' });
  const entrada = h('input', { class: 'chat-entrada', type: 'text', maxlength: '500',
    placeholder: S.catalogo?.chat?.modo === 'registro' && !S.esGM ? 'Solo registro: aquí puedes tirar dados (/2d6)' : 'Escribe un mensaje o /2d6 para tirar dados', 'aria-label': 'Mensaje de chat' });
  // «Hablar como»: tu nombre de usuario (fuera de personaje: lo lee toda la mesa) o uno de tus tokens (lo oye su sala).
  const selectorComo = h('select', { class: 'chat-como', 'aria-label': 'Hablar como', title: 'Hablar como tu usuario (lo ve toda la mesa) o como uno de tus personajes (lo oye quien esté en su sala)',
    onchange: () => { hablarComo = selectorComo.value; } });
  // Un desplegable no puede mostrar imágenes: el icono de «cómo hablas» (pixel art) va a su lado y cambia con lo elegido.
  const icoComo = h('span', { class: 'chat-como-ico', 'aria-hidden': 'true' });
  const pintarIcoComo = () => icoComo.replaceChildren(...h('span', null, hablarComo ? '🎭' : '🙂').childNodes);
  selectorComo.addEventListener('change', pintarIcoComo);
  const pintarComo = () => {
    const lista = voces();
    if (hablarComo && !lista.some((t) => t.id === hablarComo)) hablarComo = '';
    selectorComo.replaceChildren(h('option', { value: '' }, `${S.usuario || 'Yo'} (tu usuario)`),
      ...lista.map((t) => h('option', { value: t.id }, t.nombre)));
    selectorComo.value = hablarComo;
    selectorComo.hidden = icoComo.hidden = !lista.length || actual !== 'general';
    pintarIcoComo();
  };
  const enviar = () => {
    const texto = entrada.value.trim();
    if (!texto) return;
    enviarChat(texto, actual, actual === 'general' && !selectorComo.hidden ? hablarComo : '');
    entrada.value = '';
  };
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });

  // El GM ve también lo que pasa en las demás salas: se marca de cuál viene.
  const etiquetaSala = (m) => (S.esGM && m.mapa && m.mapa !== S.mapaId
    ? h('span', { class: 'msg-sala', title: 'Pasó en otra sala' }, (S.salasMapa || []).find((x) => x.id === m.mapa)?.nombre || m.mapa) : null);
  const burbuja = (m) => {
    const cat = m.categoria || 'normal';
    if (m.personaje && (cat === 'normal' || cat === 'accion')) {     // lo dice un personaje: con su retrato
      return h('div', { class: `msg msg-personaje msg-${cat}` }, retrato(m.personaje.imagen, m.personaje.nombre, 'retrato msg-retrato'),
        h('div', { class: 'msg-cuerpo' }, cat === 'normal' ? h('span', { class: 'msg-autor', title: `Lo escribe ${m.autor}` }, m.personaje.nombre) : null,
          etiquetaSala(m), cat === 'normal' ? ' ' : null, m.texto));
    }
    if (cat === 'normal') {
      return h('div', { class: 'msg msg-normal' }, h('span', { class: 'msg-autor' }, m.autor), etiquetaSala(m), ' ', m.texto);
    }
    // El detalle de una tirada (cada dado) solo llega si este usuario puede verlo (el GM siempre): debajo, en pequeño; y al pasar el ratón.
    return h('div', { class: `msg msg-${cat}`, title: m.detalle || null }, etiquetaSala(m), m.texto, m.detalle ? h('span', { class: 'msg-detalle' }, m.detalle) : null);
  };

  const pintarPestanas = () => {
    if (actual !== 'general' && !S.salas.some((s) => s.id === actual)) actual = 'general';     // la sala ya no existe
    const puedeCrear = S.esGM && S.catalogo?.reglas?.salas_chat !== false;
    pestanas.hidden = !S.salas.length && !puedeCrear;
    const tab = (id, texto, titulo) => h('button', { type: 'button', role: 'tab', class: `chat-sala${id === actual ? ' activa' : ''}`, 'aria-selected': String(id === actual),
      'data-sala': id, title: titulo, onclick: () => { actual = id; sinLeer.delete(id); pintarPestanas(); pintarTodo(); pintarComo(); } },
    texto, sinLeer.get(id) ? h('span', { class: 'chat-sin-leer', 'aria-label': `${sinLeer.get(id)} sin leer` }, String(sinLeer.get(id))) : null);
    pestanas.replaceChildren(...[tab('general', 'General', 'Todos los jugadores'),
      ...S.salas.map((s) => tab(s.id, s.nombre, `Sala privada con ${s.miembros.join(', ') || 'nadie más'}`)),
      S.esGM && actual !== 'general' ? h('button', { type: 'button', class: 'chat-sala', title: 'Cambiar participantes o borrar esta sala', 'aria-label': 'Ajustes de la sala', 'data-accion': 'editar-sala', onclick: () => editarSala(actual) }, '⚙') : null,
      puedeCrear ? h('button', { type: 'button', class: 'chat-sala', title: 'Crear una sala de chat privada', 'aria-label': 'Nueva sala de chat', 'data-accion': 'nueva-sala', onclick: () => editarSala() }, '＋') : null].filter(Boolean));
  };

  const pintarTodo = () => {
    lista.replaceChildren(...S.chat.filter((m) => sala(m) === actual).slice(-MAX_VISIBLES).map(burbuja));
    lista.scrollTop = lista.scrollHeight;
  };
  const anadir = (m) => {
    if (sala(m) !== actual) {
      if (m.categoria === 'normal' || m.categoria === 'dado') { sinLeer.set(sala(m), (sinLeer.get(sala(m)) || 0) + 1); pintarPestanas(); }
      return;
    }
    const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
    lista.append(burbuja(m));
    while (lista.children.length > MAX_VISIBLES) lista.firstChild.remove();
    if (abajo) lista.scrollTop = lista.scrollHeight;
  };

  const offs = [bus.on('chat-historial', () => { pintarPestanas(); pintarTodo(); pintarComo(); }), bus.on('chat-nuevo', anadir),
    bus.on('tokens', pintarComo), bus.on('personaje-activo', pintarComo),
    bus.on('salas', () => { pintarPestanas(); pintarTodo(); }),
    bus.on('sala-creada', (id) => { actual = id; sinLeer.delete(id); pintarPestanas(); pintarTodo(); })];
  pintarPestanas();
  pintarTodo();
  pintarComo();

  // Solo el GM: vaciar el chat de la sala que está viendo, para todos (con confirmación).
  const limpiar = async () => {
    const nombre = actual === 'general' ? 'General' : S.salas.find((x) => x.id === actual)?.nombre || 'esta sala';
    if (!(await confirmar('Limpiar el chat', `¿Borrar todos los mensajes de «${nombre}»?\n\nSe borran para todos los jugadores y no se pueden recuperar.`, { si: 'Limpiar el chat', peligro: true }))) return;
    red.enviar({ tipo: 'gm_limpiar_chat', sala: actual });
  };
  const botonLimpiar = S.esGM ? h('button', { type: 'button', class: 'btn-icono chat-limpiar', title: 'Limpiar el chat de esta sala (para todos)', 'aria-label': 'Limpiar el chat', 'data-accion': 'limpiar-chat', onclick: limpiar }, '🧹') : null;
  const el = h('section', { class: 'chat', 'aria-label': 'Chat' },
    h('div', { class: 'chat-cab' }, h('h2', { class: 'panel-titulo' }, 'Chat'), botonLimpiar),
    pestanas,
    lista,
    h('div', { class: 'chat-barra' }, icoComo, selectorComo, entrada,
      h('button', { class: 'btn-icono btn-acento', title: 'Enviar', 'aria-label': 'Enviar mensaje', onclick: enviar }, icono('enviar', 18))));
  return { el, destruir: () => offs.forEach((f) => f()) };
}
