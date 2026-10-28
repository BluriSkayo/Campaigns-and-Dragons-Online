// redimensionar.js — Un agarre en el borde de una barra lateral: se arrastra con el ratón (o con las flechas del teclado) para ensancharla o estrecharla.
// El ancho se recuerda en los ajustes. Doble clic sobre el agarre vuelve al ancho original.
import { h, clamp } from './util.js';
import { ajustes, guardar } from './ajustes.js';

/**
 * panel: la barra lateral. lado: 'izq' (agarre en su borde derecho) o 'der' (agarre en su borde izquierdo).
 * clave: ajuste donde se guarda el ancho. propiedad: variable CSS que usa el panel para su ancho.
 */
export function crearAgarre(panel, { lado, clave, propiedad, min, max, defecto, etiqueta }) {
  const tope = () => Math.max(min + 40, Math.min(max, Math.floor(window.innerWidth * 0.45)));   // nunca se come el mapa
  const poner = (px) => { const v = Math.round(clamp(px, min, tope())); panel.style.setProperty(propiedad, `${v}px`); return v; };
  poner(ajustes[clave] || defecto);

  const el = h('div', { class: `agarre agarre-${lado}`, role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', title: 'Arrastra para cambiar el ancho (doble clic: tamaño original)',
    'aria-label': etiqueta });
  const actual = () => panel.getBoundingClientRect().width;
  const fijar = (px) => guardar({ [clave]: poner(px) });

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = actual();
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('redimensionando');
    const mover = (m) => poner(w0 + (lado === 'izq' ? m.clientX - x0 : x0 - m.clientX));
    const soltar = () => {
      el.removeEventListener('pointermove', mover); el.removeEventListener('pointerup', soltar); el.removeEventListener('pointercancel', soltar);
      document.body.classList.remove('redimensionando');
      fijar(actual());
    };
    el.addEventListener('pointermove', mover); el.addEventListener('pointerup', soltar); el.addEventListener('pointercancel', soltar);
  });
  el.addEventListener('dblclick', () => fijar(defecto));
  el.addEventListener('keydown', (e) => {
    const paso = e.shiftKey ? 60 : 20;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const mas = (e.key === 'ArrowRight') === (lado === 'izq');
    fijar(actual() + (mas ? paso : -paso));
  });
  window.addEventListener('resize', () => poner(ajustes[clave] || defecto));
  return el;
}
