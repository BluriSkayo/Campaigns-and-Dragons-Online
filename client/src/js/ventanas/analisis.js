// ventanas/analisis.js — «Analizar»: información de una casilla (terreno, objetos, distancia) o de un token.
// Solo muestra lo que el cliente ya recibió y puede ver; no pide nada nuevo al servidor.
import { h } from '../util.js';
import { S, tokenFoco, vidaDe, tileEn, quienEs, objetoCubre } from '../almacen.js';
import { abrirVentana } from '../ventanas.js';

let objetivo = null;   // { tipo: 'casilla', cx, cy } | { tipo: 'token', id }

const distancia = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));   // la diagonal cuenta como 1, igual que el servidor
const fila = (k, v) => [h('dt', null, k), h('dd', null, v)];

function datosCasilla(x, y) {
  const m = S.mapa;
  const ter = tileEn(x, y);
  const objetos = (m.objetos || []).filter((o) => objetoCubre(o, x, y));
  const puntos = S.esGM ? (m.puntos || []).filter((p) => p.x === x && p.y === y) : [];
  const filas = [fila('Posición', `${x}, ${y}`)];
  filas.push(fila('Terreno', ter ? ter.nombre : 'Suelo'));
  filas.push(fila('Se puede pasar', !ter || ter.transitable ? 'Sí' : 'No'));
  if (ter?.esconde) filas.push(fila('Esconde', 'Quien esté aquí no se ve desde fuera'));
  if (ter?.rompible) filas.push(fila('Se puede romper', `Aguanta ${ter.rompible.golpes} ${ter.rompible.golpes === 1 ? 'golpe' : 'golpes'}`));
  if (ter?.descripcion) filas.push(fila('Notas', ter.descripcion));
  for (const o of objetos) filas.push(fila('Objeto', `${o.nombre}${o.bloquea ? ' (bloquea el paso)' : ''}`));
  for (const p of puntos) filas.push(fila('Punto importante', p.nombre));
  return filas;
}

function contenido() {
  if (!objetivo || !S.mapa) return h('p', { class: 'tenue' }, 'Nada que analizar.');
  const foco = tokenFoco();

  if (objetivo.tipo === 'casilla') {
    const { cx, cy } = objetivo;
    const filas = datosCasilla(cx, cy);
    const t = [...S.tokens.values()].find((k) => k.x === cx && k.y === cy);
    if (t) filas.push(fila('Ocupada por', t.nombre));
    if (foco) filas.push(fila(`Distancia desde ${foco.nombre}`, `${distancia(foco, { x: cx, y: cy })} casillas`));
    return h('div', { class: 'analisis' }, h('h3', { class: 'ficha-nombre' }, 'Casilla'), h('dl', null, filas));
  }

  const t = S.tokens.get(objetivo.id);
  if (!t) return h('p', { class: 'tenue' }, 'Ese token ya no está en el mapa.');
  const v = vidaDe(t);
  const filas = [
    fila('Tipo', quienEs(t)),
    v ? fila(S.catalogo.recurso_vida, `${v.actual} / ${v.max}`) : null,
    t.derrotado ? fila('Estado', 'Derrotado') : null,
    t.estados?.length ? fila('Estados', t.estados.map((e) => S.catalogo.estados?.[e.id]?.nombre || e.id).join(', ')) : null,
    ...datosCasilla(t.x, t.y),
  ];
  if (foco && foco.id !== t.id) filas.push(fila(`Distancia desde ${foco.nombre}`, `${distancia(foco, t)} casillas`));
  return h('div', { class: 'analisis' }, h('h3', { class: 'ficha-nombre' }, t.nombre), h('dl', null, filas.filter(Boolean)));
}

export function analizar(nuevo) {
  objetivo = nuevo;
  const v = abrirVentana({ id: 'analisis', titulo: 'Análisis', ancho: 300, render: contenido, eventos: ['tokens', 'mapa', 'foco'] });
  v.refrescar();
}
