// pantallas/cargando.js — Mientras el cliente guarda en este equipo las imágenes del servidor.
import { h } from '../util.js';
import { bus } from '../almacen.js';

export function crearCargando(titulo = 'Preparando la mesa') {
  const relleno = h('div', { class: 'carga-relleno' });
  const pista = h('div', { class: 'carga-pista', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, relleno);
  const detalle = h('p', { class: 'tenue carga-detalle' }, 'Comprobando los recursos del servidor…');
  const el = h('div', { class: 'pantalla-centrada' },
    h('div', { class: 'tarjeta-conexion' }, h('h1', { class: 'titulo-seccion' }, titulo), pista, detalle));

  const off = bus.on('descarga-recursos', ({ hecho, total, archivo }) => {
    const f = total ? hecho / total : 1;
    relleno.style.width = `${Math.round(f * 100)}%`;
    pista.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    detalle.textContent = total
      ? `Guardando recursos en este equipo: ${hecho} de ${total}${archivo ? `, ${archivo.split('/').pop()}` : ''}`
      : 'Todo está al día.';
  });
  return { el, destruir: off };
}
