// papelera.js — La ventana de la Papelera: lo que se eliminó (recursos de la campaña abierta y campañas enteras),
// con «Recuperar» y «Eliminar para siempre» en cada elemento y «Vaciar» en cada apartado.
import { h, toast, confirmar, dialogo } from './util.js';
import { E, refrescarCampanas, incorporarRecurso } from './estado.js';
import { CATEGORIAS } from './esquemas.js';

const fecha = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : 'fecha desconocida'; };
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Abre la Papelera. → el identificador de la última campaña que se recuperó desde ella (null si ninguna). */
export async function dialogoPapelera() {
  const campana = E.campana;                         // puede no haber ninguna abierta (si se eliminó la última): entonces solo se ven campañas
  let recuperada = null;
  const cuerpo = h('div', { class: 'papelera' });

  const intentar = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, 'error', 6000); return undefined; } };

  async function pintar() {
    const datos = await window.editor.papelera(campana?.id || null);
    const nombreCampana = campana ? (campana.config?.servidor?.nombre || campana.id) : null;
    const hijos = [];
    if (campana) hijos.push(seccion({
      titulo: `Recursos eliminados de «${nombreCampana}»`, vacia: 'No hay recursos eliminados en esta campaña.', items: datos.recursos,
      fila: (r) => ({
        icono: r.cat ? CATEGORIAS[r.cat].icono : '📄', titulo: r.titulo,
        detalle: `${r.cat ? CATEGORIAS[r.cat].singular[0].toUpperCase() + CATEGORIAS[r.cat].singular.slice(1) : 'Archivo desconocido'} · eliminado el ${fecha(r.fecha)}`,
        recuperar: r.cat ? () => recuperarRecurso(r) : null,
        borrar: () => borrar('recursos', r, `¿Eliminar «${r.titulo}» para siempre?\n\nNo se podrá recuperar.`),
      }),
      vaciar: () => vaciar('recursos', datos.recursos.length, `los ${datos.recursos.length} recursos eliminados de esta campaña`),
    }));
    hijos.push(seccion({
      titulo: 'Campañas eliminadas', vacia: 'No hay campañas eliminadas.', items: datos.campanas,
      fila: (c) => ({
        icono: '📚', titulo: c.titulo,
        detalle: `${c.reemplazada ? 'Versión anterior de una campaña reemplazada' : 'Campaña eliminada'} · ${fecha(c.fecha)}`,
        recuperar: c.id !== null ? () => recuperarCampana(c) : null,
        borrar: () => borrar('campanas', c, `¿Eliminar la campaña «${c.titulo}» para siempre?\n\nSe borra entera, con sus imágenes y sonidos. No se podrá recuperar.`),
      }),
      vaciar: () => vaciar('campanas', datos.campanas.length, `las ${datos.campanas.length} campañas eliminadas`),
    }));
    cuerpo.replaceChildren(...hijos);
  }

  function seccion({ titulo, vacia, items, fila, vaciar: alVaciar }) {
    return h('section', { class: 'papelera-seccion' },
      h('div', { class: 'papelera-cab' }, h('h3', null, titulo), h('div', { class: 'relleno' }),
        items.length ? h('button', { type: 'button', class: 'enlace alerta', 'data-accion': 'vaciar-papelera', onclick: alVaciar }, 'Vaciar') : null),
      items.length
        ? h('ul', { class: 'papelera-lista' }, items.map((it) => {
          const f = fila(it);
          return h('li', { class: 'papelera-fila', 'data-nombre': it.nombre },
            h('span', { class: 'papelera-ico' }, f.icono),
            h('div', { class: 'papelera-texto' }, h('strong', null, f.titulo), h('span', { class: 'tenue pequeno' }, f.detalle)),
            f.recuperar ? h('button', { type: 'button', class: 'btn', 'data-accion': 'recuperar', onclick: f.recuperar }, 'Recuperar') : null,
            h('button', { type: 'button', class: 'btn btn-peligro', 'data-accion': 'eliminar-definitivo', onclick: f.borrar }, 'Eliminar para siempre'));
        }))
        : h('p', { class: 'tenue pequeno' }, vacia));
  }

  const recuperarRecurso = (r) => intentar(async () => {
    const res = await window.editor.restaurarRecursoPapelera(campana.id, r.nombre);
    if (res.datos) incorporarRecurso(res.cat, res.id, res.datos);
    else toast('Se recuperó, pero su archivo no se puede leer: ábrelo desde la carpeta de la campaña para arreglarlo.', 'error', 8000);
    toast(res.id === res.idOriginal ? `«${r.titulo}» recuperado.` : `«${r.titulo}» recuperado como «${res.id}»: ya había otro con el identificador «${res.idOriginal}».`, 'ok', 5000);
    await pintar();
  });
  const recuperarCampana = (c) => intentar(async () => {
    const res = await window.editor.restaurarCampanaPapelera(c.nombre);
    recuperada = res.id;
    await refrescarCampanas();
    toast(`Campaña «${res.nombre}» recuperada. Ya está en el selector de campañas.`, 'ok', 6000);
    await pintar();
  });
  const borrar = async (ambito, it, mensaje) => {
    if (!(await confirmar('Eliminar para siempre', mensaje, { si: 'Eliminar para siempre', peligro: true }))) return;
    await intentar(async () => { await window.editor.borrarDePapelera(campana?.id || null, ambito, it.nombre); toast('Eliminado definitivamente.', 'ok', 2500); await pintar(); });
  };
  const vaciar = async (ambito, n, que) => {
    if (!(await confirmar('Vaciar la papelera', `¿Eliminar para siempre ${que}?\n\nNo se podrán recuperar.`, { si: `Eliminar ${plural(n, 'elemento', 'elementos')} para siempre`, peligro: true }))) return;
    await intentar(async () => { const k = await window.editor.vaciarPapelera(campana?.id || null, ambito); toast(`${plural(k, 'elemento eliminado', 'elementos eliminados')} para siempre.`, 'ok', 3000); await pintar(); });
  };

  await pintar();
  await dialogo({ titulo: '🗑️ Papelera', contenido: h('div', null,
    h('p', { class: 'tenue pequeno' }, 'Aquí está lo que eliminaste. Puedes recuperarlo o borrarlo para siempre.'), cuerpo),
  botones: [{ texto: 'Cerrar', valor: null, clase: 'btn-acento' }] });
  return recuperada;
}
