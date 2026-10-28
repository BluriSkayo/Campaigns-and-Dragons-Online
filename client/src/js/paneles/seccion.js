// paneles/seccion.js — Una opción del panel izquierdo: se despliega dentro del panel y puede sacarse a una ventana independiente.
import { h, sinSaltoDeScroll } from '../util.js';
import { bus } from '../almacen.js';
import { icono } from '../iconos.js';
import { abrirVentana, estaAbierta, cerrarVentana } from '../ventanas.js';

/**
 * def: { id, titulo, ancho, render(v), eventos, alAbrir? } (la misma definición que usa abrirVentana)
 * opciones: { ico, alCambiar() } → alCambiar avisa al panel cuando la sección se abre o se cierra.
 */
export function crearSeccion(def, { ico, alCambiar }) {
  let offs = [];
  let abierta = false;
  const cuerpo = h('div', { class: 'seccion-cuerpo' });
  const v = { refrescar: () => sinSaltoDeScroll(cuerpo, () => cuerpo.replaceChildren(def.render(v))) };
  const sacar = h('button', { class: 'btn-icono', title: 'Sacar a una ventana aparte', 'aria-label': `Abrir ${def.titulo} en una ventana`,
    onclick: () => { abrir(false); abrirVentana(def); } }, icono('ventana', 16));
  const bloque = h('div', { class: 'seccion-bloque', hidden: true },
    h('div', { class: 'seccion-cab' }, h('span', { class: 'tenue pequeno' }, def.titulo), sacar), cuerpo);
  const boton = h('button', { class: 'rail-btn', title: def.titulo, 'aria-expanded': 'false', onclick: () => alternar() },
    icono(ico, 20), h('span', { class: 'rail-texto' }, def.titulo));

  function abrir(si) {
    if (si === abierta) return;
    abierta = si;
    bloque.hidden = !si;
    boton.setAttribute('aria-expanded', String(si));
    offs.forEach((f) => f());
    offs = [];
    if (!si) cuerpo.replaceChildren();        // sin restos ocultos (ids repetidos con la ventana)
    if (si) {
      def.alAbrir?.();
      v.refrescar();
      offs = (def.eventos || []).map((ev) => bus.on(ev, v.refrescar));
    }
    alCambiar?.();
  }
  function alternar() {
    if (estaAbierta(def.id)) { abrirVentana(def); return; }       // ya está como ventana: se trae al frente
    abrir(!abierta);
  }
  return { id: def.id, boton, bloque, get abierta() { return abierta; }, abrir, destruir: () => { offs.forEach((f) => f()); cerrarVentana(def.id); } };
}
