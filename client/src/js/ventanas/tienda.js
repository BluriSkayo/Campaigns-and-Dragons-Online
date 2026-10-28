// ventanas/tienda.js — Tiendas abiertas por el GM: comprar y vender con el personaje activo.
import { h } from '../util.js';
import { S } from '../almacen.js';
import { abrirVentana } from '../ventanas.js';
import { comprar, vender } from '../acciones.js';
import { textoDinero, monedaActiva } from '../dinero.js';
import { filaTexto } from '../retrato.js';
import { tiendasGM } from './gm.js';

function miToken() { return S.tokenActivo ? S.tokens.get(S.tokenActivo) : null; }

function contenido() {
  if (!monedaActiva()) return h('div', { class: 'vacio' }, h('p', null, 'Esta campaña no usa dinero, así que no hay tiendas.'));
  const tiendas = S.tiendas.filter((t) => t.aqui !== false);
  // El GM abre y cierra las tiendas desde aquí mismo (también desde el Panel del GM)
  const control = S.esGM ? [tiendasGM() || h('p', { class: 'tenue pequeno' }, 'La campaña no tiene tiendas: se crean en el Editor, categoría «Tiendas».'),
    h('p', { class: 'tenue pequeno' }, 'Los jugadores solo ven las tiendas abiertas, y las ligadas a un mapa solo en ese mapa.')] : null;
  if (!tiendas.length) {
    const nombreMapa = (id) => S.salasMapa?.find((m) => m.id === id)?.nombre || S.catalogo.mapas?.[id]?.nombre || id;
    const fuera = S.tiendas.filter((t) => t.aqui === false);
    return h('div', null, control, h('div', { class: 'vacio' },
      fuera.length
        ? fuera.map((t) => h('p', { 'data-tienda-fuera': t.id }, `«${t.nombre}» está abierta, pero atiende en ${t.mapas.map(nombreMapa).join(', ')}.`))
        : h('p', null, S.esGM ? 'No hay ninguna tienda abierta.' : 'El GM todavía no ha abierto ninguna tienda.')));
  }
  const yo = miToken();
  const dinero = yo?.dinero ?? 0;
  return h('div', { class: 'tienda' }, control,
    yo || !S.esGM ? h('p', { class: 'dinero' }, 'Tu dinero: ', h('strong', { 'data-dinero': String(dinero) }, textoDinero(dinero))) : null,
    !yo ? h('p', { class: 'tenue' }, S.esGM ? 'Para comprar hace falta un personaje en el mapa.' : 'Despliega tu personaje en el mapa para comprar o vender.') : null,
    tiendas.map((t) => h('div', { class: 'tienda-bloque', 'data-tienda': t.id },
      h('h4', { class: 'sub' }, t.nombre),
      t.descripcion ? h('p', { class: 'tenue pequeno' }, t.descripcion) : null,
      h('ul', { class: 'lista-acciones' }, t.articulos.map((a) => {
        const obj = S.catalogo.objetos[a.objeto];
        if (!obj) return null;
        const agotado = a.stock !== null && a.stock <= 0;
        return h('li', { class: 'fila-accion' },
          filaTexto(obj.imagen, h('strong', null, obj.nombre),
            h('span', { class: 'tenue pequeno' }, `${textoDinero(a.precio)}${a.stock !== null ? ` · quedan ${a.stock}` : ''}`)),
          h('button', { class: 'btn', 'data-accion': 'comprar', 'data-objeto': a.objeto, disabled: !yo || agotado || dinero < a.precio, onclick: () => comprar(t.id, a.objeto, 1) },
            agotado ? 'Agotado' : 'Comprar'));
      })),
      t.recompra > 0 && yo?.inventario?.length
        ? h('div', null, h('h4', { class: 'sub' }, `Vender (${t.recompra} % del precio)`),
          h('ul', { class: 'lista-acciones' }, yo.inventario.map((e) => {
            const obj = S.catalogo.objetos[e.objeto];
            if (!obj) return null;
            const art = t.articulos.find((a) => a.objeto === e.objeto);
            const precio = Math.floor((art ? art.precio : obj.precio || 0) * t.recompra / 100);
            return h('li', { class: 'fila-accion' },
              filaTexto(obj.imagen, h('strong', null, `${obj.nombre} ×${e.cantidad}`), h('span', { class: 'tenue pequeno' }, `Te pagan ${textoDinero(precio)} c/u`)),
              h('button', { class: 'btn', 'data-accion': 'vender', 'data-objeto': e.objeto, onclick: () => vender(t.id, e.objeto, 1) }, 'Vender'));
          })))
        : null)));
}

export const DEF_TIENDA = { id: 'tienda', titulo: 'Tienda', ancho: 340, render: contenido, eventos: ['tiendas', 'tokens', 'estado'] };
export const abrirTienda = () => abrirVentana(DEF_TIENDA);
