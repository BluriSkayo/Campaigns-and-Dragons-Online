// servidor.js — El servidor de la campaña, desde el Editor: botón de la barra superior y cuadro para abrirlo, reiniciarlo y ver su salida.
// El servidor lee la campaña al arrancar, así que lo guardado mientras está abierto solo se aplica al reiniciarlo.
import { h, toast, dialogo } from './util.js';
import { E, bus } from './estado.js';

export const SRV = { estado: null };

export async function refrescarServidor() {
  let nuevo = null;
  if (E.campana) { try { nuevo = await window.editor.servidorEstado(E.campana.id); } catch { nuevo = null; } }
  const antes = JSON.stringify(SRV.estado);
  SRV.estado = nuevo;
  if (JSON.stringify(nuevo) !== antes) bus.emit('servidor');
}

/** Pone en marcha el aviso automático: cuando el servidor cambia (lo avisa el Editor) y, por si lo abren o cierran fuera, cada pocos segundos. */
export function vigilarServidor() {
  window.editorApp.alCambiarServidor(refrescarServidor);
  bus.on('campana', refrescarServidor);
  setInterval(() => { if (!document.hidden) refrescarServidor(); }, 3000);
  refrescarServidor();
}

const accion = async (fn) => {
  try { await fn(); } catch (e) { toast(e.message, 'error', 7000); }
  await refrescarServidor();
};
export const abrirServidor = () => accion(() => window.editor.servidorIniciar(E.campana.id));
export const reiniciarServidor = () => accion(() => window.editor.servidorReiniciar(E.campana.id));
export const cerrarServidor = () => accion(() => window.editor.servidorDetener(E.campana.id));

/** Texto, icono y ayuda del botón según cómo esté el servidor. */
export function aspectoBoton() {
  const s = SRV.estado;
  if (s?.abriendo || (s?.propio && !s.listo)) return { ico: '🟡', texto: 'Abriendo…', ayuda: 'El servidor se está abriendo.', resaltar: false };
  if (!s || !s.abierto) return { ico: '▶', texto: 'Iniciar servidor', ayuda: 'El servidor de esta campaña está cerrado. Pulsa para iniciarlo.', resaltar: false };
  if (s.pendiente) return { ico: '🟠', texto: 'Reiniciar servidor', ayuda: 'Hay cambios guardados que el servidor abierto aún no usa. Pulsa para ver el servidor y reiniciarlo.', resaltar: true };
  return { ico: '🟢', texto: 'Servidor abierto', ayuda: 'El servidor está abierto y al día. Pulsa para ver su salida, reiniciarlo o cerrarlo.', resaltar: false };
}

export function dialogoServidor() {
  if (!E.campana) { toast('Abre una campaña primero.', 'info'); return; }
  const cuerpo = h('div', { class: 'srv-cuerpo' });
  const pintar = () => {
    const s = SRV.estado || { abierto: false };
    const aspecto = aspectoBoton();
    const estado = s.abriendo ? 'Abriéndose…' : !s.abierto ? 'Cerrado' : s.propio ? (s.listo ? 'Abierto desde el Editor' : 'Abriéndose…') : 'Abierto (fuera del Editor)';
    const log = h('pre', { class: 'srv-salida', tabindex: '0', 'aria-label': 'Salida del servidor' }, (s.salida || []).join('\n') || (s.abierto && !s.propio ? 'Este servidor lo abrió otro programa: aquí no se ve lo que escribe.' : 'Aún no hay salida.'));
    const boton = (texto, fn, clase = '', desactivado = false, id = '') => h('button', { type: 'button', class: `btn ${clase}`, disabled: desactivado, 'data-accion': id, onclick: fn }, texto);
    cuerpo.replaceChildren(
      h('p', { class: 'srv-estado' }, h('strong', null, `${aspecto.ico} ${estado}`), s.direccion ? h('span', { class: 'tenue' }, ` · ${s.direccion}`) : null, s.pid ? h('span', { class: 'tenue' }, ` · proceso ${s.pid}`) : null),
      s.pendiente ? h('p', { class: 'srv-aviso', role: 'status' }, '🟠 Has guardado cambios con el servidor abierto. No se aplican hasta que lo reinicies.') : null,
      s.otraCampana ? h('p', { class: 'srv-aviso' }, `El Editor tiene abierto el servidor de «${s.otraCampana}». Ciérralo antes de abrir este.`) : null,
      h('div', { class: 'srv-botones' },
        s.abierto && s.propio ? boton('↻ Reiniciar', reiniciarServidor, s.pendiente ? 'btn-acento' : '', false, 'servidor-reiniciar') : null,
        s.abierto && s.propio ? boton('⏹ Cerrar el servidor', cerrarServidor, 'btn-peligro', false, 'servidor-cerrar') : null,
        !s.abierto ? boton('▶ Iniciar el servidor', abrirServidor, 'btn-acento', !!s.otraCampana || !!s.abriendo, 'servidor-abrir') : null),
      s.abierto && !s.propio ? h('p', { class: 'tenue pequeno' }, 'Para aplicar los cambios, ciérralo y vuelve a abrirlo (o ciérralo y ábrelo desde aquí).') : null,
      h('p', { class: 'tenue pequeno' }, 'Al cerrar el Editor, el servidor que abrió desde aquí se cierra con él.'),
      log);
    log.scrollTop = log.scrollHeight;
  };
  const quitar = bus.on('servidor', pintar);
  pintar();
  dialogo({ titulo: 'Servidor de la campaña', contenido: cuerpo, botones: [{ texto: 'Cerrar esta ventana', valor: null, clase: 'btn-acento' }],
    alMostrar: (caja) => caja.classList.add('dialogo-ancho') }).then(quitar);
  refrescarServidor();
}
