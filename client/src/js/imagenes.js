// imagenes.js — Imágenes para el lienzo, leídas de la carpeta local del cliente (base/…).
// Mientras no están cargadas, `imagen()` devuelve null y quien dibuja usa una alternativa (inicial sobre color).
import { bus } from './almacen.js';
import { urlLocal } from './archivos.js';

const cache = new Map();

function cargar(ruta, entrada, reintento) {
  const img = new Image();
  img.onload = () => { entrada.img = img; entrada.estado = 'ok'; bus.emit('imagen-cargada'); };
  img.onerror = () => { entrada.estado = 'error'; };      // no está en la carpeta base de este equipo
  const url = urlLocal(ruta);
  if (!url) { entrada.estado = 'error'; return; }
  img.src = url + (reintento ? `?r=${Date.now()}` : '');
}

export function imagen(ruta) {
  if (!ruta) return null;
  let e = cache.get(ruta);
  if (!e) {
    e = { img: null, estado: 'cargando' };
    cache.set(ruta, e);
    cargar(ruta, e, false);
  }
  return e.estado === 'ok' ? e.img : null;
}

export function limpiarCache() { cache.clear(); }
