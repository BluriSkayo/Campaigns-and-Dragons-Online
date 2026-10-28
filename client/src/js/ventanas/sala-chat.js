// ventanas/sala-chat.js — Solo GM: crear, cambiar o borrar una sala de chat privada (con quién habla cada sala).
import { h, toast } from '../util.js';
import { S } from '../almacen.js';
import { abrirVentana, cerrarVentana } from '../ventanas.js';
import { red } from '../red.js';

export function editarSala(id = null) {
  if (!S.esGM) return;
  const sala = id ? S.salas.find((s) => s.id === id) : null;
  if (id && !sala) return;
  cerrarVentana('sala-chat');
  const render = (v) => {
    const nombre = h('input', { type: 'text', maxlength: '24', value: sala?.nombre || '', placeholder: 'Nombre de la sala', 'aria-label': 'Nombre de la sala', 'data-campo': 'nombre-sala' });
    const miembros = new Set((sala?.miembros || []).map((m) => m.toLowerCase()));
    const conocidos = new Map();
    for (const u of [...S.usuariosSalas, ...(S.conectados?.usuarios || []).map((x) => x.usuario), ...(sala?.miembros || [])]) conocidos.set(u.toLowerCase(), u);
    conocidos.delete(S.usuario.toLowerCase());                       // el GM ve todas las salas sin estar «dentro»
    const casillas = [...conocidos.values()].sort((a, b) => a.localeCompare(b, 'es')).map((u) => {
      const c = h('input', { type: 'checkbox', 'data-usuario': u, 'aria-label': u });
      c.checked = miembros.has(u.toLowerCase());
      return h('li', { class: 'fila-accion' }, h('label', { class: 'fila-texto' }, c, ' ', u));
    });
    const elegidos = () => [...v.cuerpo.querySelectorAll('input[data-usuario]')].filter((c) => c.checked).map((c) => c.dataset.usuario);
    const guardar = () => {
      if (!nombre.value.trim()) { toast('Ponle un nombre a la sala.', 'error'); return; }
      if (sala) red.enviar({ tipo: 'gm_sala_editar', sala: sala.id, nombre: nombre.value.trim(), miembros: elegidos() });
      else red.enviar({ tipo: 'gm_sala_crear', nombre: nombre.value.trim(), miembros: elegidos() });
      cerrarVentana('sala-chat');
    };
    return h('div', { class: 'sala-chat-ed' },
      h('div', { class: 'campo' }, h('label', null, 'Nombre'), nombre),
      h('h4', { class: 'sub' }, 'Quién participa'),
      casillas.length ? h('ul', { class: 'lista-acciones' }, casillas) : h('p', { class: 'tenue' }, 'Todavía no hay otros usuarios. Aparecerán aquí cuando se conecten.'),
      h('p', { class: 'tenue pequeno' }, 'Tú (GM) ves todas las salas. Los demás solo ven las suyas.'),
      h('div', { class: 'pie' },
        sala ? h('button', { class: 'btn btn-peligro', 'data-accion': 'borrar-sala', onclick: () => { red.enviar({ tipo: 'gm_sala_borrar', sala: sala.id }); cerrarVentana('sala-chat'); } }, 'Eliminar sala') : null,
        h('button', { class: 'btn', onclick: () => cerrarVentana('sala-chat') }, 'Cancelar'),
        h('button', { class: 'btn btn-acento', 'data-accion': 'guardar-sala', onclick: guardar }, sala ? 'Guardar' : 'Crear sala')));
  };
  abrirVentana({ id: 'sala-chat', titulo: sala ? `Sala: ${sala.nombre}` : 'Nueva sala de chat', ancho: 320, render });
}
