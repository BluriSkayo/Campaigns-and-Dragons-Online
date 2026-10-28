// archivos.js — Archivos guardados en este equipo (imágenes, música…). Organización en disco:
//   base/tokens   base/maps   base/icons   base/tiles   base/otros
//   base/sonido/musica   base/sonido/ambiente   base/sonido/efectos
// El servidor NO envía archivos: solo dice sus nombres. Aquí se localizan en la carpeta «base» del cliente.
const api = window.mesa?.archivos || null;
let urlBaseLocal = null;
let urlCampana = null;       // base/campanas/<id>: los archivos de la campaña (del .zip del GM)
let indice = new Set();
let carpeta = '';
let campana = '';
const aplicar = (info) => { urlBaseLocal = info.urlBase; carpeta = info.base; urlCampana = info.urlCampana; campana = info.campana || ''; indice = new Set(info.indice || []); };

export const hayAlmacen = !!api;

export async function iniciarArchivos() {
  if (!api) return;
  try {
    aplicar(await api.info());
  } catch (e) { console.error('No se pudo iniciar la carpeta de archivos', e); }
}

const CATEGORIAS = ['tokens', 'maps', 'icons', 'tiles', 'otros', 'sonido'];
/** Ruta que usa el servidor → ruta dentro de base/. (Debe coincidir con archivos-logica.js.) */
export const rutaLocal = (ruta) => (CATEGORIAS.includes(ruta.split('/')[0]) ? ruta : `otros/${ruta}`);

/** Dirección del archivo en este equipo (null si no hay carpeta local). */
export function urlLocal(ruta) {
  if (!ruta || !urlBaseLocal) return null;
  const rl = rutaLocal(ruta);
  return (urlCampana && indice.has(rl) ? urlCampana : urlBaseLocal) + rl.split('/').map(encodeURIComponent).join('/');
}

/** Al entrar a un servidor: sus archivos se buscan primero en la carpeta de su campaña. */
export async function usarCampana(id) { if (api) aplicar(await api.usarCampana(id || '')); }
export const campanaActual = () => campana;
/** Instala el .zip del GM. → { campana, nombre, copiados, omitidos } o null si se cancela. */
export async function importarZip(conectada = '') {
  if (!api) return null;
  const r = await api.importarZip(conectada);
  if (r?.info) aplicar(r.info);
  return r;
}

export const carpetaBase = () => carpeta;
export const listarArchivos = (categoria) => (api ? api.listar(categoria) : Promise.resolve([]));
export const usoArchivos = () => api.uso();
export const abrirCarpeta = () => api.abrirCarpeta();
/** Abre el selector de imágenes del sistema, copia la elegida a base/tokens y devuelve su nombre (null si se cancela). */
export const importarImagen = () => (api ? api.importar() : Promise.resolve(null));
/** Guarda la ficha y sus imágenes en un .mesa-personaje (diálogo «Guardar como»). → { ruta, archivos } o null si se cancela. */
export const exportarPersonajeArchivo = (datos) => (api?.exportarPersonaje ? api.exportarPersonaje(datos) : Promise.reject(new Error('Solo disponible en la aplicación de escritorio.')));
