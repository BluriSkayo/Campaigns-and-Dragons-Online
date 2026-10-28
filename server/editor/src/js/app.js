// app.js — La ventana del Editor: barra superior, explorador, pestañas con el formulario, panel de problemas y barra de estado.
import { h, toast, confirmar, dialogo, pedirTexto, preguntarCambios } from './util.js';
import { E, bus, iniciar, abrirCampana, refrescarCampanas, recargarAssets, validar, esperarEntorno, PENDIENTES, pestana, sucia, haySucias, guardar, guardarTodo, descartar, nuevo, duplicar, eliminar, usadoPor, clave, abrir, abrirReglas, lista, deshacer, rehacer, puedeDeshacer, puedeRehacer, iniciarHistorial, VISTAS_COMPLETAS, pluralDe } from './estado.js';
import { CATEGORIAS } from './esquemas.js';
import { construirCampo } from './campos.js';
import { construirReglas } from './reglas.js';
import { construirJugadores } from './jugadores.js';
import { construirSonidos } from './sonidos.js';
import { construirMapa } from './mapa.js';
import { SRV, vigilarServidor, aspectoBoton, dialogoServidor, abrirServidor } from './servidor.js';
import { crearExplorador } from './explorador.js';
import { crearPanel, ocultarTodosLosAvisos, mostrarAvisosOcultos, hayAvisosOcultos, hayAvisosVisibles } from './panel.js';
import { crearLista } from './lista.js';
import { dialogoPapelera } from './papelera.js';
import { tituloDe, iconoDe, soltarActual, cerrarActual, crear, quitar, irACategoria, irAReglas, irASonidos, irAJugadores } from './navegacion.js';

const raiz = document.getElementById('raiz');
let explorador = null;

// ── Menús desplegables sencillos ──
function menu(ancla, items) {
  document.querySelector('.menu-flotante')?.remove();
  const cierre = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', cierre, true); } };
  const m = h('div', { class: 'menu-flotante', role: 'menu' }, items.map((i) => (i.sep ? h('div', { class: 'menu-sep' }) : i.titulo ? h('div', { class: 'menu-titulo' }, i.titulo)
    : h('button', { type: 'button', class: `menu-item${i.peligro ? ' peligro' : ''}`, role: 'menuitem', disabled: i.off, onclick: () => { m.remove(); document.removeEventListener('mousedown', cierre, true); i.fn(); } }, i.texto))));
  document.body.append(m);
  const r = ancla.getBoundingClientRect();
  m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${r.bottom + 4}px`;
  setTimeout(() => document.addEventListener('mousedown', cierre, true), 0);
}

const conErrorToast = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'error', 6000); return undefined; } };

// ── Acciones ──
const avisoServidor = () => (SRV.estado?.abierto ? ' El servidor está abierto: reinícialo para aplicar los cambios.' : '');
const accionGuardar = conErrorToast(async () => {
  const pend = [...PENDIENTES.values()].find((x) => x.sucia());
  if (pend) { if (await pend.guardar()) toast('Guardado.', 'ok', 1800); return; }
  const p = pestana(E.activa); if (p && await guardar(p.clave)) toast(`Guardado.${avisoServidor()}`, 'ok', SRV.estado?.abierto ? 5000 : 1800); });
const accionGuardarTodo = conErrorToast(async () => { const n = E.pestanas.filter(sucia).length; await guardarTodo(); if (n) toast(`Guardado${n > 1 ? ` (${n} cambios)` : ''}.${avisoServidor()}`, 'ok', SRV.estado?.abierto ? 5000 : 1800); });

async function confirmarSalida(mensaje) {
  if (!haySucias()) return true;
  const r = await preguntarCambios(mensaje);
  if (r === null) return false;
  if (r === 'guardar') {
    try { await guardarTodo(); } catch (e) { toast(e.message, 'error', 6000); return false; }
    for (const pend of PENDIENTES.values()) if (pend.sucia() && !(await pend.guardar())) return false;
  }
  return true;
}

async function menuNuevo(ancla) {
  const cats = ['habilidades', 'objetos', 'enemigos', 'grupos', 'opciones', 'rasgos', 'estados', 'mapas', 'tiles', 'tiendas', 'diario'];
  menu(ancla, [{ titulo: 'Crear…' }, ...cats.map((c) => ({ texto: `${CATEGORIAS[c].icono}  ${CATEGORIAS[c].genero === 'f' ? 'Nueva' : 'Nuevo'} ${CATEGORIAS[c].singular}`,
    off: c === 'opciones' && !lista('grupos').length, fn: () => crear(c) }))]);
}

async function accionDuplicar() {
  const p = pestana(E.activa);
  if (!p || p.tipo !== 'recurso') { toast('Abre algo para duplicarlo.', 'info'); return; }
  if (!(await soltarActual())) return;   // si tiene cambios, primero se guardan o se descartan
  await conErrorToast(() => duplicar(p.clave))();
}
async function accionRenombrar() {
  const p = pestana(E.activa);
  if (!p || p.tipo !== 'recurso') { toast('Abre un recurso para renombrarlo.', 'info'); return; }
  const nombre = await pedirTexto('Renombrar', 'Nombre nuevo', p.borrador.nombre || '');
  if (!nombre) return;
  p.borrador.nombre = nombre;
  bus.emit('cambio');
  ultimaMostrada = null; pintarZona();
}
async function accionEliminar() {
  const p = pestana(E.activa);
  if (!p || p.tipo !== 'recurso') { toast('Abre un recurso para poder eliminarlo.', 'info'); return; }
  await quitar(p.cat, p.id);
}

// ── Archivos de la campaña (imágenes y sonidos en campanas/<id>/base) ──
async function exportarArchivos() {
  await conErrorToast(async () => {
    const r = await window.editor.exportarArchivos();
    if (r) toast(`Listo: ${r.archivos} archivos en «${r.ruta}». Envíaselo a tus jugadores: lo importan en el cliente (Ajustes → «Importar archivos de campaña»).`, 'ok', 9000);
  })();
}

// ── Campañas ──
async function cambiarCampana(id) {
  if (E.campana?.id === id) return;
  if (!(await confirmarSalida('Antes de cambiar de campaña, ¿qué hacemos con los cambios sin guardar?'))) { barra.selector.value = E.campana?.id || ''; return; }
  await conErrorToast(() => abrirCampana(id))();
}
async function accionExportarCampana() {
  if (haySucias() && !(await confirmar('Hay cambios sin guardar', 'El archivo se hará con lo que está GUARDADO. Guarda antes si quieres incluir los cambios de las pestañas abiertas.', { si: 'Exportar igualmente' }))) return;
  await conErrorToast(async () => {
    toast('Exportando la campaña con sus imágenes y sonidos…', 'info', 3000);
    const r = await window.editor.exportarCampana(E.campana.id);
    if (r) toast(`Campaña exportada con ${r.archivos} ${r.archivos === 1 ? 'imagen o sonido' : 'imágenes y sonidos'}. No incluye contraseñas ni jugadores.`, 'ok', 7000);
  })();
}
const fechaCorta = (iso) => { if (!iso) return 'fecha desconocida'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'fecha desconocida' : d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }); };
/** Ya tienes la campaña del archivo: el GM elige entre importarla como copia o reemplazar la suya (lo de esta instalación se conserva). */
function preguntarConflictoCampana(c) {
  const cifras = (x) => `${x.mapas} ${x.mapas === 1 ? 'mapa' : 'mapas'} y ${x.recursos} ${x.recursos === 1 ? 'recurso' : 'recursos'}`;
  const avisos = [
    c.mapasQueSeQuitan.length ? h('p', { class: 'aviso-dialogo' }, `⚠️ El archivo no trae ${c.mapasQueSeQuitan.length === 1 ? 'el mapa' : 'los mapas'} «${c.mapasQueSeQuitan.join('», «')}»: lo que haya en ${c.mapasQueSeQuitan.length === 1 ? 'esa sala' : 'esas salas'} en la partida guardada se perderá al reemplazar.`) : null,
    c.servidorAbierto ? h('p', { class: 'aviso-dialogo' }, '⛔ El servidor de esta campaña está abierto. Ciérralo para poder reemplazarla (sí puedes importarla como copia).') : null,
  ];
  return dialogo({
    titulo: 'Ya tienes esta campaña',
    contenido: h('div', { class: 'conflicto-campana' },
      h('p', { class: 'dialogo-texto' }, c.porUid
        ? (c.nombre === c.nombreArchivo ? `«${c.nombre}» ya está en tu Editor.` : `Es la misma campaña que tu «${c.nombre}» (en el archivo se llama «${c.nombreArchivo}»).`)
        : `Ya tienes una campaña llamada «${c.nombre}».`),
      h('dl', { class: 'conflicto-datos' },
        h('dt', null, 'La que tienes'), h('dd', null, `modificada el ${fechaCorta(c.modificada)} · ${cifras(c.ahora)}`),
        h('dt', null, 'La del archivo'), h('dd', null, `exportada el ${fechaCorta(c.exportada)} · ${cifras(c.archivo)}`)),
      h('p', { class: 'tenue pequeno' }, `«Reemplazar» pone la del archivo en lugar de la tuya. Se conservan ${c.hayPartida ? 'la partida guardada, las cuentas y las fichas de los jugadores, ' : ''}tus contraseñas y la dirección del servidor. La versión anterior va entera a la Papelera (botón 🗑️), por si la necesitas.`),
      h('p', { class: 'tenue pequeno' }, '«Importar como copia» la añade como otra campaña, sin tocar la tuya.'),
      ...avisos),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Importar como copia', valor: 'copia' },
      ...(c.servidorAbierto ? [] : [{ texto: 'Reemplazar la campaña', valor: 'reemplazar', clase: 'btn-peligro' }])],
  });
}
async function accionImportarCampana() {
  await conErrorToast(async () => {
    let r = await window.editor.importarCampana();
    if (!r) return;
    if (r.conflicto) {
      const modo = await preguntarConflictoCampana(r.conflicto);
      if (!modo) return;
      const esLaAbierta = modo === 'reemplazar' && E.campana?.id === r.conflicto.id;
      if (!(await confirmarSalida(esLaAbierta ? 'Vas a reemplazar la campaña que tienes abierta. ¿Qué hacemos antes con los cambios sin guardar?' : 'Antes de abrir la campaña importada, ¿qué hacemos con los cambios sin guardar?'))) return;
      r = await window.editor.importarCampana(modo);
      if (!r) return;
    } else if (!(await confirmarSalida('Antes de abrir la campaña importada, ¿qué hacemos con los cambios sin guardar?'))) {
      await refrescarCampanas();            // ya está importada: queda en la lista aunque no se abra ahora
      return;
    }
    await refrescarCampanas(); await abrirCampana(r.id);
    const conArchivos = r.archivos ? `, con ${r.archivos} ${r.archivos === 1 ? 'imagen o sonido' : 'imágenes y sonidos'}${r.ignorados ? ` (se ignoraron ${r.ignorados} archivos que no son imágenes ni sonidos de campaña)` : ''}` : '';
    if (r.reemplazada) {
      toast(`Campaña reemplazada por la del archivo${conArchivos}. Se conservaron la partida, los jugadores, tus contraseñas y la dirección del servidor. La versión anterior está en la Papelera (🗑️).`, 'ok', 10000);
      return;
    }
    toast(r.archivos
      ? `Campaña importada como una campaña nueva${conArchivos}. Pon tus contraseñas en «Reglas del juego».`
      : 'Campaña importada como una campaña nueva. Este archivo no traía imágenes ni sonidos (es de una versión anterior): pide al GM original el .zip de archivos o importa tus imágenes de nuevo. Pon tus contraseñas en «Reglas del juego».', 'ok', 9000);
  })();
}
async function dialogoNuevaCampana() {
  const nombre = h('input', { type: 'text', class: 'entrada', maxlength: '60', placeholder: 'Por ejemplo: La Marca del Lobo', autofocus: true, 'aria-label': 'Nombre de la campaña' });
  let plantilla = 'vacia';
  const tarjetas = [['vacia', '📄 Campaña vacía', 'Empieza de cero con lo mínimo para jugar.'], ['ejemplo', '📚 Copia del ejemplo', 'Con razas, clases, NPC y un mapa ya hechos para aprender.']].map(([v, t, d]) =>
    h('button', { type: 'button', class: `tarjeta-opcion${v === plantilla ? ' elegida' : ''}`, 'data-plantilla': v, onclick: (e) => { plantilla = v; tarjetas.forEach((b) => b.classList.toggle('elegida', b === e.currentTarget)); } }, h('strong', null, t), h('span', { class: 'tenue' }, d)));
  const r = await dialogo({ titulo: 'Nueva campaña', contenido: h('div', { class: 'campos-dialogo' }, h('label', null, 'Nombre', nombre), h('div', { class: 'tarjetas-opcion' }, tarjetas)),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Crear campaña', valor: 'ok', clase: 'btn-acento' }],
    alMostrar: (_c, cierre) => nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') cierre('ok'); }) });
  if (r !== 'ok') return;
  if (!(await confirmarSalida('Antes de crear otra campaña, ¿qué hacemos con los cambios sin guardar?'))) return;
  await conErrorToast(async () => {
    const id = await window.editor.crearCampana(nombre.value, plantilla);
    await refrescarCampanas();
    await abrirCampana(id);
    toast('Campaña creada.', 'ok');
  })();
}
async function dialogoDuplicarCampana() {
  const nombre = await pedirTexto('Duplicar campaña', 'Nombre de la copia', `${E.campana.config.servidor?.nombre || E.campana.id} (copia)`);
  if (!nombre) return;
  await conErrorToast(async () => { const id = await window.editor.duplicarCampana(E.campana.id, nombre); await refrescarCampanas(); await abrirCampana(id); toast('Campaña duplicada.', 'ok'); })();
}
async function accionEliminarCampana() {
  const nombre = E.campana.config.servidor?.nombre || E.campana.id;
  if (!(await confirmar('Eliminar campaña', `¿Eliminar la campaña «${nombre}» entera?\n\nVa a la Papelera (botón 🗑️ de la barra superior): desde ahí puedes recuperarla o borrarla para siempre.`, { si: 'Eliminar campaña', peligro: true }))) return;
  await conErrorToast(async () => {
    await window.editor.borrarCampana(E.campana.id);
    E.pestanas = [];
    await refrescarCampanas();
    if (E.campanas.length) await abrirCampana(E.campanas[0].id); else { E.campana = null; bus.emit('campana'); pintarTodo(); }
  })();
}

const accionPapelera = () => dialogoPapelera();

// ── Atajos ──
export const ATAJOS = [
  ['Ctrl + S', 'Guardar lo que estás editando'], ['Ctrl + Mayús + S', 'Guardar todo'], ['Ctrl + Z', 'Deshacer'], ['Ctrl + Y  (o Ctrl + Mayús + Z)', 'Rehacer'],
  ['Ctrl + N', 'Crear un recurso nuevo'], ['F2', 'Renombrar el recurso abierto'], ['Ctrl + D', 'Duplicar el recurso abierto'], ['Ctrl + W', 'Cerrar la ficha y volver a la lista'], ['Ctrl + F', 'Buscar en la campaña'],
  ['↑ / ↓', 'En una lista: abrir el anterior o el siguiente'], ['F1', 'Mostrar esta lista'],
  ['— En el editor de mapas —', ''], ['B', 'Pincel'], ['G', 'Rellenar'], ['R', 'Rectángulo'], ['E', 'Borrador'], ['I', 'Punto de inicio'], ['P', 'Punto'], ['O', 'Objeto'], ['F', 'Imagen de fondo (moverla y estirarla)'], ['X', 'Quitar (puntos y objetos)'], ['1 / 2 / 3', 'Elegir capa'], ['H', 'Mostrar u ocultar la rejilla'], ['+ / −', 'Zoom'], ['Supr', 'Borrar el objeto elegido'], ['Esc', 'Soltar el objeto elegido'], ['Espacio + arrastrar', 'Mover la vista'], ['Ctrl + rueda', 'Zoom'],
];
function mostrarAtajos() {
  dialogo({ titulo: 'Atajos de teclado', contenido: h('dl', { class: 'lista-atajos' }, ATAJOS.flatMap(([k, d]) => (d ? [h('dt', null, h('kbd', null, k)), h('dd', null, d)] : [h('dt', { class: 'sep-atajos' }, k), h('dd')]))),
    botones: [{ texto: 'Cerrar', valor: null, clase: 'btn-acento' }] });
}
/** «Acerca de…»: nombre del programa y créditos. */
function mostrarAcercaDe() {
  dialogo({ titulo: 'Acerca de…', contenido: h('div', { class: 'acerca-de' },
    h('p', null, h('img', { class: 'marca-app', src: 'img/app.png', alt: '', width: 32, height: 32 }), ' ', h('strong', null, 'Campaigns and Dragons Online')),
    h('p', null, 'Creado por ', h('strong', null, 'BluriSkayo')),
    h('h4', null, 'Íconos de habilidades'),
    h('p', null, h('strong', null, 'jfranci_px'))),
  botones: [{ texto: 'Cerrar', valor: null, clase: 'btn-acento' }] });
}
const accionDeshacer = () => { if (!deshacer()) toast('No hay nada que deshacer.', 'info', 1200); };
const accionRehacer = () => { if (!rehacer()) toast('No hay nada que rehacer.', 'info', 1200); };

// ── Barra superior ──
const barra = (() => {
  const mk = (ico, texto, fn, titulo) => h('button', { type: 'button', class: 'tb-btn', title: titulo || texto, 'data-accion': texto, onclick: (e) => fn(e.currentTarget) }, h('span', { class: 'tb-ico' }, ico), h('span', { class: 'tb-txt' }, texto));
  const selector = h('select', { class: 'entrada selector-campana', 'aria-label': 'Campaña', onchange: () => cambiarCampana(selector.value) });
  const guardarBtn = mk('💾', 'Guardar', accionGuardar, 'Guardar (Ctrl+S)');
  const deshacerBtn = mk('↶', 'Deshacer', accionDeshacer, 'Deshacer (Ctrl+Z)');
  const rehacerBtn = mk('↷', 'Rehacer', accionRehacer, 'Rehacer (Ctrl+Y)');
  const ayudaBtn = h('button', { type: 'button', class: 'tb-btn', title: 'Atajos de teclado (F1)', 'aria-label': 'Atajos de teclado', onclick: mostrarAtajos }, '⌨');
  const acercaBtn = h('button', { type: 'button', class: 'tb-btn', 'data-accion': 'acerca-de', title: 'Acerca de…', 'aria-label': 'Acerca de', onclick: mostrarAcercaDe }, 'ℹ');
  const PANEL = 'editor.panelOculto';
  const ponerPanel = (oculto, guardar = true) => { document.body.classList.toggle('sin-panel', oculto); panelBtn.setAttribute('aria-pressed', String(!oculto)); if (guardar) try { localStorage.setItem(PANEL, oculto ? '1' : '0'); } catch { /* sin almacenamiento */ } };
  const panelBtn = h('button', { type: 'button', class: 'tb-btn', 'data-accion': 'panel-derecho', title: 'Mostrar u ocultar el panel de problemas y ayuda', 'aria-label': 'Panel de problemas y ayuda',
    onclick: () => ponerPanel(!document.body.classList.contains('sin-panel')) }, '◨');
  // Sin preferencia guardada, en pantallas estrechas el panel empieza plegado (deja sitio a la ficha).
  setTimeout(() => { let o = window.innerWidth < 1400; try { const g = localStorage.getItem(PANEL); if (g === '1' || g === '0') o = g === '1'; } catch { /* nada */ } ponerPanel(o, false); }, 0);
  const sin = h('span', { class: 'sin-guardar', hidden: true }, '● Cambios sin guardar');
  const servidorBtn = h('button', { type: 'button', class: 'tb-btn', 'data-accion': 'servidor', onclick: () => { if (E.campana && SRV.estado && !SRV.estado.abierto && !SRV.estado.abriendo && !SRV.estado.otraCampana) abrirServidor(); dialogoServidor(); } }, h('span', { class: 'tb-ico' }), h('span', { class: 'tb-txt' }));
  const masCampana = h('button', { type: 'button', class: 'tb-btn', 'aria-label': 'Más acciones de campaña', title: 'Más acciones de campaña', onclick: (e) => menu(e.currentTarget, [
    { texto: 'Nueva campaña…', fn: dialogoNuevaCampana }, { texto: 'Duplicar esta campaña…', fn: dialogoDuplicarCampana },
    { texto: 'Abrir su carpeta', fn: () => window.editor.abrirCarpeta(E.campana.id) }, { sep: true },
    { texto: 'Exportar esta campaña a un archivo…', fn: accionExportarCampana }, { texto: 'Importar una campaña desde un archivo…', fn: accionImportarCampana }, { sep: true },
    { texto: '📦 Exportar archivos para los jugadores (.zip)…', fn: exportarArchivos }, { sep: true },
    { texto: 'Ocultar todos los avisos', off: !hayAvisosVisibles(), fn: () => { const n = ocultarTodosLosAvisos(); toast(`${n} ${n === 1 ? 'aviso oculto' : 'avisos ocultos'}. Los errores siguen a la vista: impiden abrir el servidor.`, 'ok', 4000); } },
    { texto: 'Mostrar los avisos ocultos', off: !hayAvisosOcultos(), fn: mostrarAvisosOcultos },
    { texto: 'Abrir la carpeta de imágenes y música de la campaña', fn: conErrorToast(() => window.editor.abrirBase()) }, { sep: true }, { texto: '🗑️ Papelera…', fn: accionPapelera }, { texto: 'Eliminar esta campaña…', peligro: true, fn: accionEliminarCampana }]) }, '⋯');
  const nuevoBtn = mk('＋', 'Nuevo', menuNuevo, 'Crear un recurso (Ctrl+N)');
  const el = h('header', { class: 'barra-sup' },
    h('div', { class: 'marca' }, h('img', { class: 'marca-app', src: 'img/app.png', alt: '', width: 24, height: 24 }), h('strong', null, 'Editor del Servidor')),
    h('div', { class: 'tb-grupo' }, nuevoBtn, mk('⧉', 'Duplicar', accionDuplicar, 'Duplicar (Ctrl+D)'), mk('✏️', 'Renombrar', accionRenombrar, 'Renombrar (F2)'), mk('✕', 'Eliminar', accionEliminar), mk('🗑️', 'Papelera', accionPapelera, 'Papelera: recuperar lo eliminado o borrarlo para siempre'), guardarBtn),
    h('div', { class: 'tb-grupo' }, deshacerBtn, rehacerBtn),
    sin, h('div', { class: 'relleno' }), servidorBtn,
    h('label', { class: 'tb-campana' }, h('span', null, 'Campaña'), selector), panelBtn, ayudaBtn, acercaBtn, masCampana);
  return { el, selector, sin, guardarBtn, deshacerBtn, rehacerBtn, nuevoBtn, servidorBtn };
})();

// ── Zona central: lista de la categoría + ficha abierta ──
const zonaEl = h('div', { class: 'zona-edicion' });
const centro = h('main', { class: 'centro' }, zonaEl);
let ultimaMostrada = null;   // clave de la ficha pintada (para no rehacer el formulario en cada tecla)
let ultimoMarco = null;      // cómo está repartido el centro ahora mismo
let listaActual = null;      // componente de la lista (se destruye al cambiar de categoría)
let fichaEl = null;          // dónde va la ficha cuando se ve junto a la lista

const ANCHO_LISTA = 'editor.anchoLista';
const leerAncho = () => { try { const n = Number(localStorage.getItem(ANCHO_LISTA)); return n >= 200 && n <= 900 ? n : 320; } catch { return 320; } };

function inicio() {
  const tarjetas = [{ ico: '⚙️', t: 'Reglas del juego', d: 'Estadísticas, permisos, cuentas y funciones que se activan o desactivan.', fn: () => irAReglas('general') },
    { ico: '🎵', t: 'Sonidos', d: 'Las listas de música, ambiente y efectos, con categorías.', fn: () => irASonidos() },
    { ico: '👥', t: 'Jugadores y fichas', d: 'Crea usuarios y prepara las fichas de personaje de cada jugador.', fn: () => irAJugadores() },
    ...['habilidades', 'objetos', 'enemigos', 'grupos', 'rasgos', 'estados', 'mapas', 'tiles', 'tiendas', 'diario'].map((c) => ({ ico: CATEGORIAS[c].icono, t: c === 'grupos' ? 'Razas, clases y orígenes' : pluralDe(c, CATEGORIAS[c].plural), d: CATEGORIAS[c].ayuda,
      fn: () => irACategoria(c), n: lista(c).length }))];
  return h('div', { class: 'inicio' }, h('h1', null, E.campana.config.servidor?.nombre || E.campana.id),
    h('p', { class: 'tenue' }, 'Elige una categoría a la izquierda (o aquí abajo) para ver su lista y editar lo que tiene:'),
    h('div', { class: 'tarjetas-inicio' }, tarjetas.map((t) => h('button', { type: 'button', class: 'tarjeta-inicio', onclick: t.fn }, h('span', { class: 'tarjeta-ico' }, t.ico), h('strong', null, t.t), h('span', { class: 'tenue' }, t.d),
      h('span', { class: 'tarjeta-crear' }, t.n != null ? `Abrir la lista (${t.n})` : 'Abrir')))));
}

function vacio(vista) {
  const def = CATEGORIAS[vista === 'grupos' ? 'grupos' : vista];
  const nombre = vista === 'grupos' ? 'una raza, clase u origen' : `${def.genero === 'f' ? 'una' : 'un'} ${def.singular}`;
  return h('div', { class: 'ficha-vacia' }, h('span', { class: 'tarjeta-ico' }, vista === 'grupos' ? '🧬' : def.icono),
    h('p', null, `Elige ${nombre} en la lista para editarlo.`),
    h('p', { class: 'tenue pequeno' }, 'O pulsa ＋ para crear uno nuevo. La ✕ al lado de cada nombre lo elimina (va a la Papelera, donde puedes recuperarlo).'));
}

/** Cabecera y formulario de una ficha. */
function construirFicha(p, { volver = null } = {}) {
  const hubieraCambios = sucia(p);
  const ctx = { alCambiar: () => bus.emit('cambio'), propioId: p.id };
  let cuerpo;
  if (p.tipo === 'reglas') cuerpo = construirReglas(p, ctx);
  else if (p.tipo === 'sonidos') cuerpo = construirSonidos(p, ctx);
  else if (CATEGORIAS[p.cat].especial === 'mapa') cuerpo = construirMapa(p, ctx);
  else cuerpo = h('div', { class: 'formulario' }, CATEGORIAS[p.cat].campos.filter((def) => !def.solo || def.solo(E.campana.config)).map((def) => construirCampo(def, p.borrador, ctx)));
  // Los controles pueden rellenar valores por defecto al mostrarse: eso no cuenta como un cambio del usuario.
  if (!hubieraCambios) p.original = JSON.parse(JSON.stringify(p.borrador));
  iniciarHistorial(p);
  const cab = h('div', { class: 'edicion-cab' },
    volver ? h('button', { type: 'button', class: 'btn', 'data-accion': 'volver-lista', onclick: cerrarActual, title: 'Volver a la lista (Ctrl+W)' }, `← ${volver}`) : null,
    h('h2', null, `${iconoDe(p)} `, h('span', { class: 'edicion-titulo' }, tituloDe(p))),
    p.tipo === 'sonidos' ? h('span', { class: 'tenue pequeno' }, 'Música, ambiente y efectos de la campaña') : null,
    p.tipo === 'recurso' ? h('span', { class: 'tenue pequeno' }, `${CATEGORIAS[p.cat].singular[0].toUpperCase()}${CATEGORIAS[p.cat].singular.slice(1)}`) : null,
    h('div', { class: 'relleno' }),
    h('button', { type: 'button', class: 'btn', 'data-accion': 'descartar', onclick: () => { descartar(p.clave); ultimaMostrada = null; pintarZona(); } }, 'Descartar cambios'),
    h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'guardar-pestana', onclick: accionGuardar }, '💾 Guardar'),
    p.tipo === 'recurso' && !volver ? h('button', { type: 'button', class: 'btn-cerrar-ficha', 'data-accion': 'cerrar-ficha', title: 'Cerrar la ficha (Ctrl+W)', 'aria-label': 'Cerrar la ficha', onclick: cerrarActual }, '✕') : null);
  const ancho = p.tipo === 'sonidos' || (p.tipo === 'recurso' && CATEGORIAS[p.cat].especial === 'mapa');
  return [cab, h('div', { class: `edicion-cuerpo${ancho ? ' ancho' : ''}` }, cuerpo)];
}

function divisor(marco) {
  const d = h('div', { class: 'divisor', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Ancho de la lista (arrastra)', title: 'Arrastra para cambiar el ancho de la lista · doble clic: tamaño normal' });
  d.addEventListener('pointerdown', (e) => {
    e.preventDefault(); d.setPointerCapture(e.pointerId); d.classList.add('arrastrando');
    const izq = marco.getBoundingClientRect().left;
    const mover = (ev) => { const max = Math.max(220, marco.clientWidth - 380); marco.style.setProperty('--ancho-lista', `${Math.round(Math.min(max, Math.max(200, ev.clientX - izq)))}px`); };
    const soltar = () => { d.classList.remove('arrastrando'); d.removeEventListener('pointermove', mover); d.removeEventListener('pointerup', soltar);
      try { localStorage.setItem(ANCHO_LISTA, String(parseInt(marco.style.getPropertyValue('--ancho-lista'), 10) || 320)); } catch { /* sin almacenamiento: no pasa nada */ } };
    d.addEventListener('pointermove', mover); d.addEventListener('pointerup', soltar);
  });
  d.addEventListener('dblclick', () => { marco.style.setProperty('--ancho-lista', '320px'); try { localStorage.removeItem(ANCHO_LISTA); } catch { /* nada */ } });
  return d;
}

function pintarZona() {
  const p = pestana(E.activa);
  const v = E.vista;
  const mapaCompleto = p?.tipo === 'recurso' && CATEGORIAS[p.cat].especial === 'mapa';
  const marco = !E.campana ? 'nada' : v === null ? 'inicio' : VISTAS_COMPLETAS.includes(v) ? `completa:${v}` : mapaCompleto ? 'mapa' : `lista:${v}`;
  const quitarVieja = () => zonaEl.querySelector('.mapa-editor')?.alQuitar?.();
  if (marco !== ultimoMarco) {
    quitarVieja();
    ultimoMarco = marco; ultimaMostrada = null;
    listaActual?.destruir(); listaActual = null; fichaEl = null;
    if (marco === 'nada') { zonaEl.replaceChildren(); return; }
    if (marco === 'inicio') { zonaEl.replaceChildren(inicio()); return; }
    if (marco.startsWith('lista:')) {
      listaActual = crearLista(v);
      fichaEl = h('div', { class: 'ficha' });
      const div = h('div', { class: 'dividida' });
      div.style.setProperty('--ancho-lista', `${leerAncho()}px`);
      div.append(listaActual.el, divisor(div), fichaEl);
      zonaEl.replaceChildren(div);
    }
  }
  if (marco === 'inicio' || marco === 'nada') return;
  const clave = p ? (p.tipo === 'reglas' ? `reglas#${p.seccion || 'general'}` : p.clave) : null;   // en Reglas, cambiar de apartado también repinta
  if (ultimaMostrada === clave && clave !== null) return;
  if (ultimaMostrada === clave && fichaEl?.firstChild) return;
  quitarVieja();
  ultimaMostrada = clave;
  if (marco.startsWith('lista:')) {
    fichaEl.replaceChildren(...(p ? construirFicha(p) : [vacio(v)]));
    fichaEl.scrollTop = 0;
    return;
  }
  if (!p) return;
  if (p.tipo === 'jugadores') {      // sin borrador ni botón Guardar: cada acción se guarda al momento
    zonaEl.replaceChildren(h('div', { class: 'edicion-cab' }, h('h2', null, '👥 Jugadores y fichas'), h('span', { class: 'tenue pequeno' }, 'Usuarios y personajes de la partida')), h('div', { class: 'edicion-cuerpo ancho' }, construirJugadores()));
    return;
  }
  zonaEl.replaceChildren(...construirFicha(p, { volver: marco === 'mapa' ? CATEGORIAS.mapas.plural : null }));
}

/** ↑ / ↓ dentro de una lista abren el recurso anterior o el siguiente. */
function moverEnLista(paso) {
  const filas = [...zonaEl.querySelectorAll('.lista-cat .fila-recurso')];
  if (!filas.length) return false;
  const i = filas.findIndex((f) => f.classList.contains('activa'));
  const sig = filas[Math.min(filas.length - 1, Math.max(0, i < 0 ? 0 : i + paso))];
  if (!sig || sig === filas[i]) return true;
  sig.querySelector('.fila-abrir').click();
  setTimeout(() => zonaEl.querySelector(`.fila-recurso[data-clave="${CSS.escape(sig.dataset.clave)}"] .fila-abrir`)?.focus(), 50);
  return true;
}

// ── Estado inferior ──
const estadoEl = h('footer', { class: 'barra-estado' });
function pintarEstado() {
  const n = E.pestanas.filter(sucia).length;
  const pr = E.problemas;
  const txtPr = pr.estado === 'validando' ? '⏳ Comprobando…' : pr.estado === 'sin-python' ? '⚠️ Sin comprobación (falta Python)' : pr.estado === 'error' ? `⛔ ${pr.errores.length} errores` : pr.avisos.length ? `✅ Sin errores · ${pr.avisos.length} avisos` : '✅ Todo en orden';
  estadoEl.replaceChildren(h('span', null, `Campaña: ${E.campana ? (E.campana.config.servidor?.nombre || E.campana.id) : '—'}`), h('span', { class: 'estado-valid', 'data-estado': pr.estado }, txtPr),
    h('span', { class: 'relleno' }), h('span', null, n ? `${n} ${n === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}` : 'Todo guardado'), h('button', { type: 'button', class: 'enlace', 'data-accion': 'exportar-archivos', title: 'Crea un .zip con las imágenes y sonidos de esta campaña para enviárselo a tus jugadores', onclick: exportarArchivos }, '📦 Exportar archivos para los jugadores'));
  barra.sin.hidden = !n;
  barra.deshacerBtn.disabled = !puedeDeshacer();
  barra.rehacerBtn.disabled = !puedeRehacer();
  barra.guardarBtn.classList.toggle('btn-resaltado', !!pestana(E.activa) && sucia(pestana(E.activa)));
}

function pintarServidor() {
  const a = aspectoBoton(), b = barra.servidorBtn;
  b.children[0].textContent = a.ico;
  b.children[1].textContent = a.texto;
  b.title = a.ayuda;
  b.setAttribute('aria-label', `${a.texto}. ${a.ayuda}`);
  b.classList.toggle('btn-resaltado', a.resaltar);
}

function pintarSelector() {
  barra.selector.replaceChildren(...E.campanas.map((c) => h('option', { value: c.id }, c.nombre)));
  barra.selector.value = E.campana?.id || '';
}

function pintarTodo() {
  pintarSelector(); pintarZona(); pintarEstado();
}

// ── Pantalla de inicio: elegir campaña ──
function elegirCampanaInicial() {
  return new Promise((resolver) => {
    const cerrar = (id) => { fondo.remove(); resolver(id); };
    const tarjetas = E.campanas.map((c) => h('button', { type: 'button', class: 'tarjeta-inicio tarjeta-campana', 'data-campana': c.id, onclick: () => cerrar(c.id) },
      h('span', { class: 'tarjeta-ico' }, '📚'), h('strong', null, c.nombre), h('span', { class: 'tenue pequeno' }, c.id), h('span', { class: 'tarjeta-crear' }, 'Editar esta campaña')));
    const nueva = h('button', { type: 'button', class: 'tarjeta-inicio tarjeta-campana', 'data-accion': 'nueva-campana', onclick: async () => { await dialogoNuevaCampana(); if (E.campana) cerrar(E.campana.id); } },
      h('span', { class: 'tarjeta-ico' }, '＋'), h('strong', null, 'Nueva campaña'), h('span', { class: 'tenue pequeno' }, 'Vacía o con el ejemplo'));
    const importar = h('button', { type: 'button', class: 'tarjeta-inicio tarjeta-campana', 'data-accion': 'importar-campana', onclick: async () => { await accionImportarCampana(); if (E.campana) cerrar(E.campana.id); } },
      h('span', { class: 'tarjeta-ico' }, '📥'), h('strong', null, 'Importar campaña'), h('span', { class: 'tenue pequeno' }, 'Desde un archivo .mesa-campana'));
    const papelera = h('button', { type: 'button', class: 'tarjeta-inicio tarjeta-campana', 'data-accion': 'papelera-inicio', onclick: async () => { const id = await dialogoPapelera(); if (id) cerrar(id); } },
      h('span', { class: 'tarjeta-ico' }, '🗑️'), h('strong', null, 'Papelera'), h('span', { class: 'tenue pequeno' }, 'Recuperar campañas eliminadas'));
    const fondo = h('div', { class: 'pantalla-campanas' }, h('div', { class: 'inicio' }, h('h1', null, h('img', { class: 'marca-app', src: 'img/app.png', alt: '', width: 32, height: 32 }), ' Editor del Servidor'),
      h('p', { class: 'tenue' }, E.campanas.length ? '¿Qué campaña quieres editar?' : 'Aún no tienes campañas. Crea la primera:'),
      h('div', { class: 'tarjetas-inicio' }, tarjetas, nueva, importar, papelera),
      null));
    document.body.append(fondo);
  });
}

// ── Arranque ──
async function arrancar() {
  const cuerpo = h('div', { class: 'cuerpo' });
  explorador = crearExplorador();
  const panel = crearPanel();
  cuerpo.append(explorador.el, centro, panel.el);
  raiz.replaceChildren(barra.el, cuerpo, estadoEl);

  bus.on('campanas', pintarSelector);
  bus.on('servidor', pintarServidor);
  vigilarServidor();
  pintarServidor();
  bus.on('campana', () => { ultimaMostrada = null; ultimoMarco = null; pintarTodo(); });
  bus.on('campana-cambiada', pintarEstado);
  bus.on('pestanas', () => { pintarZona(); pintarEstado(); });
  bus.on('guardado', pintarEstado);
  bus.on('problemas', pintarEstado);
  bus.on('cambio', () => {
    pintarEstado();
    const p = pestana(E.activa);
    if (p) { const t = zonaEl.querySelector('.edicion-titulo'); if (t) t.textContent = tituloDe(p); }
  });

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const t = e.target;
    const escribiendo = t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color'].includes(t.type)));
    const k = e.key.toLowerCase();
    if (e.key === 'F1') { e.preventDefault(); mostrarAtajos(); return; }
    if (e.key === 'F2') { e.preventDefault(); accionRenombrar(); return; }
    // ↑/↓ en la lista (cuando el foco está en ella o en ningún campo de texto)
    if (!ctrl && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && t instanceof HTMLElement && (t.closest('.lista-cat') && !t.matches('input')) ) {
      if (moverEnLista(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
      return;
    }
    if (!ctrl) return;
    const nada = () => e.preventDefault();
    if (k === 's') { nada(); if (e.shiftKey) accionGuardarTodo(); else accionGuardar(); }
    else if (k === 'z' && !escribiendo) { nada(); if (e.shiftKey) accionRehacer(); else accionDeshacer(); }
    else if (k === 'y' && !escribiendo) { nada(); accionRehacer(); }
    else if (k === 'w' && E.activa) { nada(); cerrarActual(); }
    else if (k === 'n') { nada(); menuNuevo(barra.nuevoBtn); }
    else if (k === 'd' && !escribiendo) { nada(); accionDuplicar(); }
    else if (k === 'f') { nada(); explorador.enfocarBuscador(); }
  });
  bus.on('restaurado', () => {
    // El editor de mapas se repinta solo (sin perder zoom, pincel ni capa); el resto de vistas se vuelve a construir
    if (!(E.activa?.startsWith('mapas/') && document.querySelector('.mapa-editor'))) { ultimaMostrada = null; pintarZona(); }
    pintarEstado(); explorador.pintar();
  });
  bus.on('historial', pintarEstado);
  window.editorApp.alIntentarCerrar(async () => {
    if (SRV.estado?.propio && !(await confirmar('El servidor está abierto', 'Abriste el servidor desde el Editor: si sales, el servidor se cerrará y los jugadores conectados perderán la conexión. ¿Salir de todos modos?', { si: 'Cerrar servidor y salir', peligro: true }))) return;
    if (await confirmarSalida('¿Qué hacemos con los cambios sin guardar antes de salir?')) window.editorApp.cerrarYa(); });

  await iniciar();
  if (location.hash === '#debug') window.__ed = { E, bus, abrir, abrirReglas, nuevo, guardar, guardarTodo, clave, eliminar, duplicar, usadoPor, abrirCampana, irACategoria, recargarAssets };
  const elegida = await elegirCampanaInicial();
  if (elegida && E.campana?.id !== elegida) await abrirCampana(elegida);
  else if (!E.campana && E.campanas.length) await abrirCampana(E.campanas[0].id);
  if (E.info.preparando) esperarEntorno();
  else if (!E.info.python) toast(E.info.error || 'No se encontró Python: el Editor funciona, pero no podrá comprobar la campaña con las reglas del servidor.', 'error', 9000);
  pintarTodo();
}
arrancar().catch((e) => { console.error(e); raiz.replaceChildren(h('pre', { class: 'error-fatal' }, `El Editor no pudo arrancar:\n${e.stack || e.message}`)); });

// La página nunca se desplaza entera (solo sus paneles): si algo la mueve al enfocarse, se devuelve a su sitio.
document.addEventListener('scroll', (e) => { if (e.target === document && (scrollY || scrollX)) scrollTo(0, 0); });
