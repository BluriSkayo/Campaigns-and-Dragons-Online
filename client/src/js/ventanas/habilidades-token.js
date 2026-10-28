// ventanas/habilidades-token.js — Solo GM: dar o quitar habilidades a cualquier token (clic derecho → «Gestionar habilidades…»).
// Arriba, las que ya tiene (con «Quitar»); abajo, las de la campaña que le faltan, con un buscador. El servidor valida y guarda:
// en un personaje cambia su ficha; en un NPC, solo ese token.
import { h } from '../util.js';
import { S, bus, palabra } from '../almacen.js';
import { abrirVentana, cerrarVentana } from '../ventanas.js';
import { red } from '../red.js';
import { filaTexto } from '../retrato.js';
import { resumenHabilidad } from '../acciones.js';

export function gestionarHabilidades(id) {
  if (!S.esGM) return;
  const t0 = S.tokens.get(id);
  if (!t0) return;
  cerrarVentana('habilidades-token');          // si había otra abierta (de otro token), se reemplaza
  const nombreH = palabra('habilidades', 'Habilidades');      // la campaña puede llamarlas de otra forma (Hechizos, Movimientos…)
  let filtro = '';

  const tiene = h('ul', { class: 'lista-acciones', 'data-lista': 'tiene' });
  const faltan = h('ul', { class: 'lista-acciones', 'data-lista': 'faltan' });
  const vacioTiene = h('p', { class: 'tenue pequeno' }, `Todavía no tiene ${nombreH.toLowerCase()}.`);
  const buscar = h('input', { type: 'search', class: 'buscador', placeholder: `Buscar en ${nombreH.toLowerCase()} de la campaña…`, 'aria-label': 'Buscar habilidad',
    oninput: () => { filtro = buscar.value.trim().toLowerCase(); pintar(); } });
  const enviar = (habilidad, poner) => red.enviar({ tipo: 'gm_habilidad', token: id, habilidad, poner });
  const fila = (hid, poner) => {
    const hab = S.catalogo.habilidades?.[hid];
    return h('li', { class: 'fila-accion', 'data-habilidad': hid },
      filaTexto(hab?.imagen, h('strong', null, hab?.nombre || hid), h('span', { class: 'tenue pequeno' }, hab ? resumenHabilidad(hab) : 'Ya no existe en la campaña')),
      h('button', { class: `btn btn-mini${poner ? ' btn-acento' : ''}`, 'data-accion': poner ? 'dar-habilidad' : 'quitar-habilidad',
        title: poner ? `Dársela a ${t0.nombre}` : `Quitársela a ${t0.nombre}`, onclick: () => enviar(hid, poner) }, poner ? '＋ Dar' : 'Quitar'));
  };

  function pintar() {
    const t = S.tokens.get(id);
    if (!t) { cerrarVentana('habilidades-token'); return; }          // el token salió del mapa (o de la sala)
    const suyas = t.habilidades || [];
    tiene.replaceChildren(...suyas.map((hid) => fila(hid, false)));
    vacioTiene.hidden = suyas.length > 0;
    const coincide = (hid, hab) => !filtro || `${hab.nombre} ${hab.descripcion || ''} ${hid}`.toLowerCase().includes(filtro);
    const resto = Object.entries(S.catalogo.habilidades || {}).filter(([hid, hab]) => !suyas.includes(hid) && coincide(hid, hab))
      .sort((a, b) => String(a[1].nombre).localeCompare(String(b[1].nombre), 'es', { sensitivity: 'base' }));
    faltan.replaceChildren(...(resto.length ? resto.map(([hid]) => fila(hid, true))
      : [h('li', { class: 'tenue pequeno' }, filtro ? 'Ninguna coincide.' : 'Ya tiene todas las de la campaña.')]));
  }

  const raiz = h('div', { class: 'gestionar-habilidades' },
    h('p', { class: 'tenue pequeno' }, t0.tipo === 'personaje'
      ? 'Se guarda en su ficha: la conserva aunque salga del mapa. Solo os enteráis tú y su jugador.'
      : 'Solo cambia este token: la ficha del NPC en la campaña sigue igual.'),
    h('h4', { class: 'sub' }, 'Ya tiene'), tiene, vacioTiene,
    h('h4', { class: 'sub' }, 'Dar otra'), buscar, faltan);
  const v = abrirVentana({ id: 'habilidades-token', titulo: `${nombreH} de ${t0.nombre}`, ancho: 380, render: () => raiz });
  v.offs.push(bus.on('tokens', pintar), bus.on('estado', pintar));      // se repinta sin rehacer la ventana (no se pierde lo escrito)
  pintar();
  return v;
}
