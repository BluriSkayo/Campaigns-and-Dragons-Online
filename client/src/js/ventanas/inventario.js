// ventanas/inventario.js — Objetos del token seleccionado. Los objetos oficiales los define el servidor.
import { h } from '../util.js';
import { S, tokenFoco, puedoControlar } from '../almacen.js';
import { abrirVentana } from '../ventanas.js';
import { usarObjeto } from '../acciones.js';
import { red } from '../red.js';
import { textoDinero, monedaActiva } from '../dinero.js';
import { filaTexto } from '../retrato.js';
import { abrirUsarObjeto, abrirDarObjeto, tokensCerca } from './elegir.js';

function efectoTexto(obj) {
  return obj.efecto ? `Restaura ${obj.efecto.valor} ${obj.efecto.recurso}.` : '';
}
/** Se puede usar si restaura algo o tiene efectos «Al usarlo» (quitar estados, aplicar otros…). */
function usable(obj) {
  return !!obj.efecto || (obj.efectos || []).some((e) => e?.cuando?.tipo === 'al_usar');
}

/** «Usar»: si hay alguien cerca, se elige con quién; si no, se usa directamente sobre sí mismo (como siempre). */
function usarConQuien(t, objeto) {
  const alcance = S.catalogo.reglas?.alcance_objetos ?? 1;
  if (S.tokens.has(t.id) && tokensCerca(t, alcance, { derrotados: true }).length) abrirUsarObjeto(t, objeto);
  else usarObjeto(t.id, objeto);
}

/** Lista de objetos de un token (la usa la ventana de inventario y la pestaña «Inventario» de la ficha). */
export function listaInventario(t) {
  const dinero = monedaActiva() && t.dinero !== undefined ? h('p', { class: 'dinero', 'data-dinero': String(t.dinero) }, `${S.catalogo.moneda.nombre}: `, h('strong', null, textoDinero(t.dinero))) : null;
  if (!t.inventario.length) return h('div', null, dinero, h('p', { class: 'tenue' }, `${t.nombre} no lleva ningún objeto.`));
  const puede = puedoControlar(t) && !t.derrotado;
  const puedeDar = (S.esGM || S.catalogo.reglas?.dar_objetos !== false) && S.tokens.has(t.id);       // solo un token del mapa (tiene a quién dárselo)
  return h('div', null, dinero, h('ul', { class: 'lista-acciones' }, t.inventario.map((e) => {
    const obj = S.catalogo.objetos[e.objeto];
    if (!obj) return null;
    const equipable = S.catalogo.equipamiento?.activo && obj.equipable;
    return h('li', { class: `fila-accion${e.equipado ? ' equipado' : ''}`, 'data-objeto': e.objeto },
      filaTexto(obj.imagen,
        h('strong', null, obj.nombre, e.cantidad > 1 ? h('span', { class: 'cantidad' }, ` ×${e.cantidad}`) : null,
          equipable ? h('span', { class: 'tenue pequeno' }, e.equipado ? ` · equipado${obj.hueco ? ` (${obj.hueco})` : ''}` : obj.hueco ? ` · ${obj.hueco}` : '') : null),
        obj.descripcion ? h('span', { class: 'tenue' }, obj.descripcion) : null,
        obj.efecto ? h('span', { class: 'tenue pequeno' }, efectoTexto(obj)) : null),
      h('span', { class: 'mini-botones' },
        equipable ? h('button', { class: 'btn', 'data-accion': e.equipado ? 'quitar-equipo' : 'equipar', disabled: !puede,
          title: 'Sus efectos solo cuentan mientras está equipado', onclick: () => red.enviar({ tipo: 'equipar', token: t.id, objeto: e.objeto, poner: !e.equipado }) }, e.equipado ? 'Quitar' : 'Equipar') : null,
        usable(obj) ? h('button', { class: 'btn', 'data-accion': 'usar-objeto', disabled: !puede, title: 'Contigo o con alguien que esté cerca',
          onclick: () => usarConQuien(t, e.objeto) }, 'Usar') : null,
        puedeDar ? h('button', { class: 'btn btn-suave', 'data-accion': 'dar-objeto', disabled: !puede, title: 'Dárselo a alguien que esté cerca',
          onclick: () => abrirDarObjeto(t, e.objeto, e.cantidad) }, 'Dar') : null));
  })));
}

function contenido() {
  const t = tokenFoco();
  if (!t) return h('div', { class: 'vacio' }, h('p', null, 'No hay ningún token seleccionado.'));
  if (!t.inventario) return h('div', { class: 'vacio' }, h('p', null, 'No puedes ver el inventario de este token.'));
  return h('div', null, h('p', { class: 'tenue pequeno' }, `Inventario de ${t.nombre}`), listaInventario(t));
}

export const DEF_INVENTARIO = { id: 'inventario', titulo: 'Inventario', ancho: 340, render: contenido, eventos: ['tokens', 'foco', 'estado'] };
export const abrirInventario = () => abrirVentana(DEF_INVENTARIO);
