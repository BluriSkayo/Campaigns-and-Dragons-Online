// archivos-logica.js — Carpeta de archivos del cliente (proceso principal de Electron).
//
// Las imágenes y la música NO las envía el servidor: viven en esta carpeta, que el dueño del servidor
// rellena con el Editor (y que reparte a sus jugadores, por ejemplo en un .zip).
//
//     base/
//       tokens/   imágenes de personajes, enemigos, objetos…
//       maps/     fondos de mapa
//       icons/    íconos de habilidades, objetos, estados…
//       tiles/    gráficos de las casillas (muro, agua, hierba…)
//       sonido/   (una sola carpeta con tres subcarpetas)
//         musica/    canciones (las oyen todos)
//         ambiente/  viento, lluvia… (lo pone el Game Master; lo oyen todos)
//         efectos/   efectos de sonido (los lanza el Game Master; lo oyen todos)
//       otros/    cualquier otra cosa
//
// Seguridad: los nombres vienen del servidor, así que TODA ruta se valida antes de tocar el disco
// (nada de «..», rutas absolutas, caracteres raros ni extensiones que no sean de imagen o audio).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SONIDO = ['sonido/musica', 'sonido/ambiente', 'sonido/efectos'];
const CATEGORIAS = ['tokens', 'maps', 'icons', 'tiles', 'otros', 'sonido'];  // carpetas con nombre propio (las rutas del servidor empiezan por ellas; «otros/…» es la que usa el Editor para objetos del mapa o el diario)
const TODAS = ['tokens', 'maps', 'icons', 'tiles', ...SONIDO, 'otros'];      // carpetas que se crean y se pueden listar
const EXT_IMAGEN = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const IMPORTABLES = ['tokens'];                                                // carpetas a las que el jugador puede añadir imágenes
const EXTENSIONES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ogg', '.mp3', '.wav']);

/** Devuelve la ruta si es segura; si no, null. Las rutas usan «/» como separador. */
function normalizarRuta(ruta) {
  if (typeof ruta !== 'string' || ruta.length === 0 || ruta.length > 260) return null;
  if (/[\\\u0000-\u001f:*?"<>|]/.test(ruta) || ruta.startsWith('/')) return null;
  const partes = ruta.split('/');
  if (partes.some((p) => p === '' || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || p.startsWith(' '))) return null;
  if (partes.some((p) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p))) return null;   // nombres reservados de Windows
  if (!EXTENSIONES.has(path.posix.extname(ruta).toLowerCase())) return null;
  return ruta;
}

const categoriaDe = (ruta) => (CATEGORIAS.includes(ruta.split('/')[0]) ? ruta.split('/')[0] : 'otros');
/** Ruta que usa el servidor (p. ej. «tokens/orco.png») → ruta dentro de base/. */
const rutaLocal = (ruta) => (CATEGORIAS.includes(ruta.split('/')[0]) ? ruta : `otros/${ruta}`);

const RE_CAMPANA = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const PROFUNDIDAD = 4;          // tokens/criaturas/no_muertos/esqueleto.png

/** Archivos (rutas relativas con «/») de una carpeta y sus subcarpetas. */
async function recorrer(dir, rel = '', nivel = 0, res = []) {
  let nombres = [];
  try { nombres = await fsp.readdir(dir); } catch { return res; }
  for (const n of nombres) {
    if (n.startsWith('.')) continue;
    const r = path.join(dir, n);
    let st; try { st = await fsp.stat(r); } catch { continue; }
    if (st.isFile() && EXTENSIONES.has(path.extname(n).toLowerCase())) res.push(rel + n);
    else if (st.isDirectory() && nivel < PROFUNDIDAD) await recorrer(r, `${rel}${n}/`, nivel + 1, res);
  }
  return res;
}

class Almacen {
  constructor(base) { this.base = base; this.campana = ''; this.indice = new Set(); }

  /** Cada campaña tiene sus archivos en base/campanas/<id> (los importa el jugador del .zip que le pasa el GM).
   *  Lo que no esté ahí se busca en base/ (archivos de antes y las imágenes que elige el propio jugador). */
  dirCampana(id = this.campana) { return id ? path.join(this.base, 'campanas', id) : null; }
  async usarCampana(id) {
    this.campana = typeof id === 'string' && RE_CAMPANA.test(id) ? id : '';
    this.indice = new Set(this.campana ? await recorrer(this.dirCampana()) : []);
    return this.campana;
  }

  async iniciar() {
    for (const c of TODAS) await fsp.mkdir(path.join(this.base, c), { recursive: true });
  }

  /** Nombres de los archivos de una categoría (los de la campaña y los de base/, sin repetir). */
  async listar(categoria) {
    const propios = await this.listarEn(this.base, categoria);
    if (!this.campana) return propios;
    const deCampana = await this.listarEn(this.dirCampana(), categoria);
    return [...new Set([...deCampana, ...propios])].sort((a, b) => a.localeCompare(b, 'es'));
  }

  async listarEn(raiz, categoria) {
    if (!TODAS.includes(categoria)) return [];
    const dir = path.join(raiz, categoria);
    // Las imágenes pueden estar en subcarpetas («tokens/jugadores/ana.png»: así las guarda el Editor); los sonidos, no.
    if (!SONIDO.includes(categoria)) return (await recorrer(dir)).filter((n) => EXT_IMAGEN.has(path.extname(n).toLowerCase())).sort((a, b) => a.localeCompare(b, 'es'));
    let nombres = [];
    try { nombres = await fsp.readdir(dir); } catch { return []; }
    const buenos = [];
    for (const n of nombres) {
      if (!EXTENSIONES.has(path.extname(n).toLowerCase())) continue;
      try { if ((await fsp.stat(path.join(dir, n))).isFile()) buenos.push(n); } catch { /* desapareció */ }
    }
    return buenos.sort((a, b) => a.localeCompare(b, 'es'));
  }

  /** Una imagen de este equipo por su ruta del servidor («tokens/jugadores/ana.png»): primero en la carpeta de la campaña y luego en base/.
   *  Solo imágenes y rutas limpias (nada de «..»). → Buffer o null si no está. */
  async leerImagen(ruta) {
    if (typeof ruta !== 'string' || !ruta || ruta.length > 200) return null;
    const rel = normalizarRuta(rutaLocal(ruta));
    if (!rel || !EXT_IMAGEN.has(path.extname(rel).toLowerCase())) return null;
    const trozos = rel.split('/');
    for (const raiz of [this.campana ? this.dirCampana() : null, this.base].filter(Boolean)) {
      const f = path.join(raiz, ...trozos);
      if (!f.startsWith(raiz + path.sep)) continue;
      try { const st = await fsp.stat(f); if (st.isFile() && st.size <= 20 * 1024 * 1024) return await fsp.readFile(f); } catch { /* no está aquí */ }
    }
    return null;
  }

  /** «Exportar personaje»: un .zip con «personaje.json» (la ficha tal como la tiene el servidor) y «archivos/<ruta>» con sus imágenes
   *  (token, retrato…), para que el GM lo importe en el Editor. Las rutas de imagen salen de la propia ficha. → { zip, archivos } */
  async paquetePersonaje(datos) {
    if (!datos || typeof datos !== 'object' || !datos.personaje || typeof datos.personaje !== 'object') throw new Error('Ficha no válida');
    const p = datos.personaje;
    const json = { formato: 'mesa-de-rol/personaje', version: 1, exportado: new Date().toISOString(), campana: this.campana || '',
      servidor: String(datos.servidor || '').slice(0, 80), usuario: String(datos.usuario || '').slice(0, 40), personaje: p };
    const entradas = [];
    const vistas = new Set();
    for (const k of ['imagen', 'imagen_biografia', 'imagen_propia']) {
      const r = p[k];
      if (typeof r !== 'string' || !r || vistas.has(r)) continue;
      vistas.add(r);
      const buf = await this.leerImagen(r);
      if (buf) entradas.push({ nombre: `archivos/${rutaLocal(r)}`, datos: buf });
    }
    const texto = Buffer.from(JSON.stringify(json, null, 1), 'utf8');
    if (texto.length > 2 * 1024 * 1024) throw new Error('La ficha es demasiado grande para exportarla');
    const { crearZip } = require('./zip');
    return { zip: crearZip([{ nombre: 'personaje.json', datos: texto }, ...entradas]), archivos: entradas.length };
  }

  /** Copia una imagen elegida por el jugador a base/<categoria>. Devuelve el nombre final (nunca pisa un archivo existente).
   *  Solo imágenes, de hasta 10 MB, con un nombre limpio. */
  async importarImagen(categoria, origen) {
    if (!IMPORTABLES.includes(categoria)) throw new Error('Carpeta no permitida');
    const ext = path.extname(String(origen)).toLowerCase();
    if (!EXT_IMAGEN.has(ext)) throw new Error('Solo se pueden elegir imágenes (png, jpg, webp o gif)');
    const st = await fsp.stat(origen);
    if (!st.isFile()) throw new Error('Eso no es un archivo');
    if (st.size > 10 * 1024 * 1024) throw new Error('La imagen pesa más de 10 MB');
    let nombre = path.basename(origen, ext).normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 60) || 'imagen';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(nombre)) nombre = `_${nombre}`;
    const dir = path.join(this.base, categoria);
    let final = nombre + ext, i = 2;
    for (;;) {
      try { await fsp.copyFile(origen, path.join(dir, final), fs.constants.COPYFILE_EXCL); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; final = `${nombre}-${i++}${ext}`; }
    }
    return final;
  }

  /** Instala el .zip de archivos de una campaña. `conectada` = campaña del servidor al que se está conectado (o '').
   *  El .zip puede traer «mesa-campana.json» (lo pone el Editor) o estar hecho a mano (tokens/, maps/… en la raíz o en una carpeta). */
  async importarZip(buf, conectada = '') {
    const { leerZip } = require('./zip-lector');
    const entradas = leerZip(buf).filter((e) => !e.carpeta && !e.nombre.startsWith('__MACOSX/'));
    let manifiesto = null;
    const man = entradas.find((e) => /(^|\/)mesa-campana\.json$/.test(e.nombre));
    if (man) { try { manifiesto = JSON.parse(man.leer().toString('utf8')); } catch { manifiesto = null; } }
    const delZip = typeof manifiesto?.campana === 'string' && RE_CAMPANA.test(manifiesto.campana) ? manifiesto.campana : '';
    const destino = conectada || delZip;
    if (!destino) throw new Error('No sé de qué campaña es este .zip: conéctate antes al servidor de la partida y vuelve a importarlo.');
    if (conectada && delZip && delZip !== conectada) throw new Error(`Este .zip es de la campaña «${manifiesto.nombre || delZip}», no de la del servidor al que estás conectado.`);
    // Prefijo común (una carpeta que lo envuelve todo, típico al comprimir «la carpeta» a mano)
    const CAT = /^(tokens|maps|icons|tiles|otros|sonido)\//;
    let prefijo = '';
    const archivos = entradas.filter((e) => e !== man);
    if (archivos.length && !archivos.some((e) => CAT.test(e.nombre))) {
      const primero = archivos[0].nombre.split('/')[0] + '/';
      if (archivos.every((e) => e.nombre.startsWith(primero))) prefijo = primero;
    }
    const raiz = this.dirCampana(destino);
    let copiados = 0, omitidos = 0;
    for (const e of archivos) {
      const rel = e.nombre.slice(prefijo.length).normalize('NFC');
      if (!CAT.test(rel) || !normalizarRuta(rel) || rel.split('/').length > PROFUNDIDAD + 2) { omitidos++; continue; }
      const fin = path.join(raiz, ...rel.split('/'));
      if (!fin.startsWith(raiz + path.sep)) { omitidos++; continue; }       // nunca fuera de la carpeta de la campaña
      await fsp.mkdir(path.dirname(fin), { recursive: true });
      await fsp.writeFile(fin, e.leer());
      copiados++;
    }
    if (!copiados) throw new Error('El .zip no trae imágenes ni sonidos reconocibles (deben ir en tokens/, maps/, icons/, tiles/, otros/ o sonido/).');
    if (destino === this.campana) await this.usarCampana(destino);
    return { campana: destino, nombre: manifiesto?.nombre || destino, copiados, omitidos };
  }

  async uso() {
    const categorias = {};
    for (const c of TODAS) {
      let archivos = 0, bytes = 0;
      for (const raiz of [this.base, ...(this.campana ? [this.dirCampana()] : [])]) {
        for (const n of await this.listarEn(raiz, c)) {
          try { bytes += (await fsp.stat(path.join(raiz, c, n))).size; archivos++; } catch { /* ignorar */ }
        }
      }
      categorias[c] = { archivos, bytes };
    }
    return { categorias };
  }
}

module.exports = { Almacen, RE_CAMPANA, normalizarRuta, rutaLocal, categoriaDe, CATEGORIAS, TODAS, SONIDO, EXTENSIONES };
