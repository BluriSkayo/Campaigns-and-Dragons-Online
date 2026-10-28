// paquete.js — Exportar e importar una campaña como UN solo archivo (.mesa-campana).
// Desde la versión 2 es un .zip: «campana.json» (las reglas y recursos: los .yaml de la campaña) y «base/…» (sus imágenes y sonidos).
// NO lleva contraseñas ni jugadores ni sus fichas (viven en data/). Los .mesa-campana antiguos (versión 1: solo el JSON, sin archivos) se siguen importando.
// Al importar nada se confía en el archivo: solo se aceptan nombres de archivo conocidos, tipos de imagen y audio, tamaños razonables
// y YAML válido, y nunca se pisa una campaña que ya existe.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { crearZip } = require('./zip');
const { leerZip, ErrorZip } = require('./zip-lector');

const FORMATO = 'mesa-de-rol/campana';
const VERSION = 2;
const MAX_ARCHIVOS = 3000, MAX_ARCHIVO = 1024 * 1024, MAX_TOTAL = 24 * 1024 * 1024;
const JSON_EN_ZIP = 'campana.json';
const RE_IMAGEN = /\.(png|jpe?g|gif|webp)$/i, RE_AUDIO = /\.(ogg|mp3|wav)$/i;
const TROZO_OK = /^[^\\/:*?"<>|\x00-\x1f]{1,120}$/;
const error = (m) => { throw new Error(m); };

function crear({ CARPETAS, esId, ASSETS = [], PROFUNDIDAD = 3 }) {
  const carpetas = new Set(Object.values(CARPETAS));

  /** «base/tokens/criaturas/lobo.png» → «tokens/criaturas/lobo.png» si es un archivo de campaña admisible; si no, null.
   *  Imágenes en tokens/maps/icons/tiles/otros (con hasta PROFUNDIDAD-1 subcarpetas); audio en sonido/<musica|ambiente|efectos>, sin subcarpetas. */
  function rutaArchivo(nombre) {
    if (typeof nombre !== 'string' || !nombre.startsWith('base/')) return null;
    const trozos = nombre.slice(5).split('/');
    if (trozos.some((t) => !TROZO_OK.test(t) || t === '.' || t === '..' || t.startsWith('.') || t.startsWith('_') || /[. ]$/.test(t))) return null;
    const esSonido = trozos[0] === 'sonido';
    const cat = esSonido ? `${trozos[0]}/${trozos[1]}` : trozos[0];
    if (!ASSETS.includes(cat)) return null;
    const resto = trozos.slice(esSonido ? 2 : 1);
    if (!resto.length || resto.length > (esSonido ? 1 : PROFUNDIDAD)) return null;
    if (!(esSonido ? RE_AUDIO : RE_IMAGEN).test(resto[resto.length - 1])) return null;
    return trozos.join('/');
  }
  const rutaValida = (rel) => {
    if (rel === 'config.yaml' || rel === 'sonidos.yaml' || rel === 'campana.yaml') return true;
    const m = /^([a-z]+)\/([a-z0-9_]{1,60})\.yaml$/.exec(rel);
    return !!m && carpetas.has(m[1]) && esId(m[2]);
  };

  /** Lee la campaña y la convierte en un objeto listo para guardar. Las contraseñas se vacían: compartir reglas no es compartir accesos. */
  function empaquetar(ruta, id) {
    const archivos = {};
    const leer = (rel) => fs.readFileSync(path.join(ruta, rel), 'utf8');
    archivos['config.yaml'] = leer('config.yaml');
    const cfg = YAML.parseDocument(archivos['config.yaml']);
    for (const k of ['password_gm', 'password_servidor']) if (cfg.getIn(['servidor', k])) cfg.setIn(['servidor', k], '');
    archivos['config.yaml'] = String(cfg);
    if (fs.existsSync(path.join(ruta, 'sonidos.yaml'))) archivos['sonidos.yaml'] = leer('sonidos.yaml');
    if (fs.existsSync(path.join(ruta, 'campana.yaml'))) archivos['campana.yaml'] = leer('campana.yaml');     // identificador y orden de las listas
    for (const carpeta of carpetas) {
      const dir = path.join(ruta, carpeta);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).sort()) {
        const rel = `${carpeta}/${f}`;
        if (rutaValida(rel)) archivos[rel] = leer(rel);
      }
    }
    const nombre = cfg.getIn(['servidor', 'nombre']) || id;
    let uid = '';
    try { uid = String(YAML.parse(archivos['campana.yaml'] || '')?.uid || ''); } catch { /* sin identificador */ }
    return { formato: FORMATO, version: VERSION, nombre: String(nombre), ...(uid ? { uid } : {}), exportada: new Date().toISOString(), archivos };
  }

  /** El .mesa-campana completo (un .zip): las reglas y, de la carpeta base/ de la campaña, cada imagen y sonido admisible. */
  function empaquetarZip(ruta, id, listarBase) {
    const obj = empaquetar(ruta, id);
    const entradas = [{ nombre: JSON_EN_ZIP, datos: Buffer.from(JSON.stringify(obj, null, 1), 'utf8') }];
    for (const rel of listarBase()) {
      const ok = rutaArchivo(`base/${rel}`);
      if (ok) entradas.push({ nombre: `base/${ok}`, datos: fs.readFileSync(path.join(ruta, 'base', ...ok.split('/'))) });
    }
    obj.incluidos = entradas.length - 1;
    entradas[0].datos = Buffer.from(JSON.stringify(obj, null, 1), 'utf8');
    return { zip: crearZip(entradas), archivos: entradas.length - 1 };
  }

  /** Contenido de un .mesa-campana (zip nuevo o JSON antiguo) → { obj, archivos: [{ rel, leer }], ignorados }. */
  function leerPaquete(buf) {
    if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
      let entradas;
      try { entradas = leerZip(buf); } catch (e) { error(e instanceof ErrorZip ? `El archivo está dañado: ${e.message}.` : 'El archivo está dañado: no se puede leer.'); }
      const json = entradas.find((e) => e.nombre === JSON_EN_ZIP);
      if (!json) error('Este archivo no es una campaña de Campaigns and Dragons Online.');
      if (json.tam > MAX_TOTAL * 2) error('El archivo es demasiado grande.');
      let obj; try { obj = JSON.parse(json.leer().toString('utf8')); } catch { error('El archivo está dañado: no se puede leer la campaña.'); }
      const archivos = [];
      let ignorados = 0;
      for (const e of entradas) {
        if (e.carpeta || e === json) continue;
        const rel = rutaArchivo(e.nombre);
        if (rel) archivos.push({ rel, leer: e.leer }); else ignorados++;           // lo que no es una imagen o un audio de la campaña no se copia
      }
      return { obj, archivos, ignorados };
    }
    if (buf.length > 30 * 1024 * 1024) error('El archivo es demasiado grande para ser una campaña.');
    let obj; try { obj = JSON.parse(buf.toString('utf8')); } catch { error('El archivo está dañado: no se puede leer.'); }
    return { obj, archivos: [], ignorados: 0 };
  }

  /** Comprueba el contenido de un archivo exportado y devuelve la lista [ruta relativa, texto] ya segura. */
  function comprobar(obj) {
    if (!obj || typeof obj !== 'object' || obj.formato !== FORMATO) error('Este archivo no es una campaña de Campaigns and Dragons Online.');
    if (!Number.isInteger(obj.version) || obj.version > VERSION) error('Este archivo es de una versión más nueva del Editor. Actualiza el Editor para abrirlo.');
    if (!obj.archivos || typeof obj.archivos !== 'object' || Array.isArray(obj.archivos)) error('El archivo está dañado: no contiene la campaña.');
    const entradas = Object.entries(obj.archivos);
    if (!entradas.length || entradas.length > MAX_ARCHIVOS) error('El archivo está dañado o es demasiado grande.');
    if (!('config.yaml' in obj.archivos)) error('El archivo no incluye la configuración de la campaña.');
    let total = 0;
    for (const [rel, texto] of entradas) {
      if (!rutaValida(rel)) error(`El archivo contiene algo que no es de una campaña («${String(rel).slice(0, 60)}»).`);
      if (typeof texto !== 'string' || texto.length > MAX_ARCHIVO) error(`«${rel}» está dañado o es demasiado grande.`);
      total += texto.length;
      if (total > MAX_TOTAL) error('El archivo es demasiado grande.');
      let doc;
      try { doc = YAML.parse(texto); } catch (e) { error(`«${rel}» no es un YAML válido (${e.message.split('\n')[0]}).`); }
      if (doc !== null && (typeof doc !== 'object' || Array.isArray(doc))) error(`«${rel}» no tiene el formato esperado.`);
    }
    return entradas;
  }

  /** Crea una campaña NUEVA en `destino` (carpeta que aún no existe), con sus imágenes y sonidos si los trae (`archivos` de leerPaquete). */
  function desempaquetar(obj, destino, archivos = []) {
    const entradas = comprobar(obj);
    fs.mkdirSync(destino);
    try {
      for (const c of carpetas) fs.mkdirSync(path.join(destino, c));
      for (const [rel, texto] of entradas) fs.writeFileSync(path.join(destino, rel), texto, 'utf8');
      // Por si el archivo traía contraseñas: nunca se importan accesos de otra persona.
      const cfg = YAML.parseDocument(fs.readFileSync(path.join(destino, 'config.yaml'), 'utf8'));
      for (const k of ['password_gm', 'password_servidor']) if (cfg.getIn(['servidor', k])) cfg.setIn(['servidor', k], '');
      fs.writeFileSync(path.join(destino, 'config.yaml'), String(cfg), 'utf8');
      for (const { rel, leer } of archivos) {
        const final = path.join(destino, 'base', ...rel.split('/'));
        if (!final.startsWith(path.join(destino, 'base') + path.sep)) error('El archivo contiene una ruta no válida.');
        fs.mkdirSync(path.dirname(final), { recursive: true });
        let datos; try { datos = leer(); } catch (e) { error(`El archivo está dañado: ${e.message}.`); }
        fs.writeFileSync(final, datos);
      }
    } catch (e) { fs.rmSync(destino, { recursive: true, force: true }); throw e; }
    return entradas.length;
  }
  return { empaquetar, empaquetarZip, leerPaquete, desempaquetar, comprobar, rutaValida, rutaArchivo };
}

module.exports = { crear, FORMATO, VERSION };
