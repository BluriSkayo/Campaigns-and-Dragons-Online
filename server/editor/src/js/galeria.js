// galeria.js — Elegir una imagen de la carpeta de archivos de la campaña (base/…) viendo miniaturas: con buscador, subcarpetas
// («tokens/criaturas»), crear carpetas e importar directamente en la carpeta que se está viendo.
import { h, toast, dialogo, pedirTexto } from './util.js';
import { E, recargarAssets } from './estado.js';
import { urlAsset, asegurarCliente } from './campos.js';

const CATEGORIAS_IMG = [['tokens', 'Tokens'], ['icons', 'Iconos'], ['maps', 'Mapas'], ['tiles', 'Tiles'], ['otros', 'Otros']];
const TODAS = '*';
let carpetasCache = null;

async function carpetas() {
  try { carpetasCache = await window.editor.carpetasAssets(); } catch { carpetasCache = {}; }
  return carpetasCache;
}

/** Abre la galería. → ruta elegida («tokens/criaturas/lobo.png»), '' para «sin imagen», o null si se cancela. */
export async function elegirImagen({ carpeta, actual = '', titulo = 'Elegir imagen' }) {
  if (!(await asegurarCliente())) return null;
  let cat = carpeta;
  let sub = actual.startsWith(`${carpeta}/`) && actual.split('/').length > 2 ? actual.split('/').slice(1, -1).join('/') : TODAS;
  let filtro = '';
  let cerrar = () => {};
  await Promise.all([carpetas(), recargarAssets().catch(() => {})]);        // lo que se haya copiado a mano en base/ también aparece

  const buscar = h('input', { type: 'search', class: 'entrada', placeholder: 'Buscar por nombre…', 'aria-label': 'Buscar imagen', autofocus: true });
  const selCat = h('select', { class: 'entrada', 'aria-label': 'Categoría de imágenes', 'data-accion': 'galeria-categoria' },
    CATEGORIAS_IMG.map(([v, t]) => h('option', { value: v }, `${t} (base/${v})`)));
  selCat.value = cat;
  const chips = h('div', { class: 'galeria-carpetas', role: 'group', 'aria-label': 'Carpetas' });
  const rejilla = h('div', { class: 'galeria-rejilla', role: 'listbox', 'aria-label': 'Imágenes' });
  const pie = h('div', { class: 'tenue pequeno galeria-info' });

  const archivosCat = () => (E.campana.assets[cat] || []).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f));
  function pintar() {
    const subs = carpetasCache?.[cat] || [];
    if (sub !== TODAS && sub !== '' && !subs.includes(sub)) sub = TODAS;
    const chip = (v, t) => h('button', { type: 'button', class: `chip galeria-chip${sub === v ? ' activa' : ''}`, 'data-carpeta': v, 'aria-pressed': String(sub === v), onclick: () => { sub = v; pintar(); } }, t);
    chips.replaceChildren(chip(TODAS, 'Todas'), chip('', '📁 (principal)'), ...subs.map((s) => chip(s, `📁 ${s}`)),
      h('button', { type: 'button', class: 'btn btn-mini', 'data-accion': 'galeria-nueva-carpeta', onclick: nuevaCarpeta }, '＋ Carpeta'));
    const f = filtro.trim().toLowerCase();
    const lista = archivosCat().filter((a) => {
      const dir = a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
      return (sub === TODAS || dir === sub) && (!f || a.toLowerCase().includes(f));
    });
    rejilla.replaceChildren(...(lista.length ? lista.map((a) => {
      const ruta = `${cat}/${a}`;
      const soloIcono = ruta.startsWith('icons/habilidades/');           // iconos que trae el programa: sin nombre de archivo
      return h('button', { type: 'button', class: `galeria-item${ruta === actual ? ' actual' : ''}${soloIcono ? ' solo-icono' : ''}`, role: 'option', 'aria-selected': String(ruta === actual), 'data-archivo': ruta, title: soloIcono ? null : ruta, 'aria-label': soloIcono ? 'Icono' : null,
        onclick: () => cerrar(ruta) },
      h('span', { class: 'galeria-mini' }, h('img', { src: urlAsset(ruta), alt: '', loading: 'lazy' })),
      soloIcono ? null : h('span', { class: 'galeria-nombre' }, a.split('/').pop()));
    }) : [h('p', { class: 'tenue galeria-vacia' }, f ? 'Ninguna imagen coincide con la búsqueda.' : 'No hay imágenes aquí todavía. Pulsa «Importar aquí».')]));
    const destino = sub === TODAS ? '' : sub;
    pie.textContent = `${lista.length} ${lista.length === 1 ? 'imagen' : 'imágenes'} · Importar guarda en base/${cat}${destino ? `/${destino}` : ''}`;
  }
  async function nuevaCarpeta() {
    const nombre = await pedirTexto('Nueva carpeta', 'Nombre de la carpeta', '', { ayuda: `Dentro de base/${cat}${sub && sub !== TODAS ? `/${sub}` : ''}. Para ordenar: criaturas, pueblo, mazmorra…`, si: 'Crear' });
    if (!nombre) return;
    try {
      sub = await window.editor.crearCarpetaAssets(cat, sub && sub !== TODAS ? `${sub}/${nombre}` : nombre);
      await carpetas(); pintar();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function importarAqui() {
    try {
      const nuevos = await window.editor.importar(cat, sub === TODAS ? '' : sub);
      if (!nuevos.length) return;
      await recargarAssets(); await carpetas();
      if (nuevos.length === 1) { cerrar(nuevos[0]); toast(`Imagen lista: ${nuevos[0]}`, 'ok'); return; }
      pintar(); toast(`${nuevos.length} imágenes importadas (las repetidas se reutilizan).`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }
  buscar.addEventListener('input', () => { filtro = buscar.value; pintar(); });
  selCat.addEventListener('change', () => { cat = selCat.value; sub = TODAS; pintar(); });
  pintar();

  const contenido = h('div', { class: 'galeria' },
    h('div', { class: 'galeria-barra' }, buscar, selCat,
      h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'galeria-importar', onclick: importarAqui }, '📥 Importar aquí…')),
    chips, rejilla, pie);
  const r = await dialogo({ titulo, contenido, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Sin imagen', valor: '' }],
    alMostrar: (caja, cierre) => { caja.classList.add('dialogo-ancho'); cerrar = cierre; } });
  return r;
}
