// retrato.js — Retrato redondo de un personaje: su imagen o, si no hay (o no carga), su inicial.
import { h, inicial } from './util.js';
import { urlLocal } from './archivos.js';

export function retrato(ruta, nombre, clase = 'retrato') {
  const letra = () => h('div', { class: clase }, inicial(nombre));
  if (!ruta) return letra();
  const img = h('img', { class: clase, src: urlLocal(ruta), alt: '' });
  img.addEventListener('error', () => img.replaceWith(letra()), { once: true });
  return img;
}

/** Bloque de texto de una fila de lista (objeto, habilidad, rasgo…) con su imagen a la izquierda, si la tiene.
 *  Si la imagen no está en la carpeta de este equipo, la fila queda como siempre (sin hueco ni icono roto). */
export function filaTexto(ruta, ...hijos) {
  const texto = h('div', { class: 'fila-texto' }, ...hijos);
  const url = ruta ? urlLocal(ruta) : null;
  if (!url) return texto;
  const img = h('img', { class: 'miniatura-recurso', src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.remove(), { once: true });
  return h('div', { class: 'fila-con-imagen' }, img, texto);
}
