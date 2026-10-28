// api.js — Lo que el Editor hace con el disco: leer/guardar campañas (YAML), validar con el servidor, importar imágenes.
// Se ejecuta en el proceso principal; la ventana lo usa por IPC (ver preload.js). Todas las rutas se comprueban:
// nada sale de la carpeta de la campaña.
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const YAML = require('yaml');

// Dos formas de ejecutarse:
//  · Desde la carpeta del servidor (iniciar_editor.bat / npm start): el servidor es la carpeta de arriba y ahí están campanas/ y data/.
//  · Empaquetado (el .exe): el servidor (main.py, mesa/) y un Python con sus componentes van DENTRO del programa (resources/servidor y
//    resources/python), y campanas/ y data/ se guardan JUNTO al .exe (si ahí no se puede escribir, en la carpeta de datos del usuario).
//    La primera vez se copia allí la campaña de ejemplo.
const EMPAQUETADO = (() => { try { return require('electron').app.isPackaged; } catch { return false; } })();
const RAIZ_SERVIDOR = EMPAQUETADO ? path.join(process.resourcesPath, 'servidor') : path.resolve(__dirname, '..');
const PYTHON_PROPIO = EMPAQUETADO ? path.join(process.resourcesPath, 'python', process.platform === 'win32' ? 'python.exe' : path.join('bin', 'python3')) : null;
function carpetaDeTrabajo() {
  if (!EMPAQUETADO) return RAIZ_SERVIDOR;
  const junto = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  try {
    fs.accessSync(junto, fs.constants.W_OK);
    return junto;
  } catch {
    return path.join(require('electron').app.getPath('documents'), 'Campaigns and Dragons - Servidor');
  }
}
const CARPETA_CAMPANAS = process.env.MESA_CAMPANAS ? path.resolve(process.env.MESA_CAMPANAS) : path.join(carpetaDeTrabajo(), 'campanas');
if (EMPAQUETADO) {
  process.env.PYTHONDONTWRITEBYTECODE = '1';            // el servidor va dentro del programa: que Python no escriba cachés ahí
  // Primera vez: campanas/ con la campaña de ejemplo (si ya hay alguna campaña, no se toca nada)
  try {
    const hay = fs.existsSync(CARPETA_CAMPANAS) && fs.readdirSync(CARPETA_CAMPANAS, { withFileTypes: true }).some((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'));
    if (!hay) {
      fs.mkdirSync(CARPETA_CAMPANAS, { recursive: true });
      const ejemplo = path.join(RAIZ_SERVIDOR, 'campanas', 'ejemplo');
      if (fs.existsSync(ejemplo)) fs.cpSync(ejemplo, path.join(CARPETA_CAMPANAS, 'ejemplo'), { recursive: true });
    }
  } catch (e) { console.error('No se pudo preparar la carpeta de campañas:', e.message); }
}

// Dónde guarda el servidor la partida (cuentas y fichas): data/<campaña>. Se puede cambiar con MESA_DATOS (pruebas).
const dirDatos = (id) => {
  if (!esNombreCampana(id)) throw new Error('Nombre de campaña no válido');
  return process.env.MESA_DATOS ? path.resolve(process.env.MESA_DATOS, id) : path.join(path.dirname(CARPETA_CAMPANAS), 'data', id);
};

// categoría (como la llama el Editor) → carpeta dentro de la campaña
const CARPETAS = {
  habilidades: 'abilities', objetos: 'items', enemigos: 'enemies', grupos: 'groups', opciones: 'options',
  rasgos: 'traits', estados: 'states', tiles: 'tiles', tiendas: 'shops', mapas: 'maps', diario: 'journal',
};
// Carpetas de la carpeta del cliente (base/…). Los sonidos van juntos en base/sonido con tres subcarpetas.
const ASSETS = ['tokens', 'maps', 'icons', 'tiles', 'sonido/musica', 'sonido/ambiente', 'sonido/efectos', 'otros'];
const EXT_IMAGEN = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const EXT_AUDIO = ['ogg', 'mp3', 'wav'];

const error = (m) => { throw new Error(m); };
const esId = (s) => typeof s === 'string' && /^[a-z0-9_]{1,60}$/.test(s);
const esNombreCampana = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,59}$/.test(s);

const { nombreDeAudio } = require('./nombres');
function slug(texto, vacio = 'nuevo') {
  const s = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  return s || vacio;
}
function unico(base, existe) {
  if (!existe(base)) return base;
  for (let i = 2; i < 1000; i++) if (!existe(`${base}_${i}`)) return `${base}_${i}`;
  return error('No se pudo encontrar un nombre libre');
}

function rutaCampana(nombre) {
  if (!esNombreCampana(nombre)) error('Nombre de campaña no válido');
  const r = path.join(CARPETA_CAMPANAS, nombre);
  if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) error('La campaña no existe');
  return r;
}
function rutaRecurso(nombre, cat, id) {
  if (!CARPETAS[cat]) error('Categoría no válida');
  if (!esId(id)) error('Identificador no válido');
  return path.join(rutaCampana(nombre), CARPETAS[cat], `${id}.yaml`);
}

// ── YAML conservando los comentarios de las claves que no cambian ──
const esObjeto = (v) => v && typeof v === 'object' && !Array.isArray(v);

function aplicarMapa(doc, mapa, valor) {
  for (const par of [...mapa.items]) {
    const k = String(par.key && par.key.value !== undefined ? par.key.value : par.key);
    if (!(k in valor) || valor[k] === undefined) mapa.delete(par.key);
  }
  for (const [k, v] of Object.entries(valor)) {
    if (v === undefined) continue;
    const actual = mapa.get(k, true);
    if (YAML.isMap(actual) && esObjeto(v)) aplicarMapa(doc, actual, v);
    else if (YAML.isScalar(actual) && (v === null || typeof v !== 'object')) actual.value = v;
    else mapa.set(k, doc.createNode(v));
  }
}

/** Las listas de números (posiciones [x, y]) se escriben en una línea: así un mapa no ocupa miles de líneas. */
// El servidor lee YAML 1.1 (PyYAML): ahí «no», «yes», «on», «off»… sin comillas son verdadero/falso. Los textos así van entre comillas.
const AMBIGUO_11 = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?|[-+]?0[0-7_]+|[-+]?0x[0-9a-fA-F_]+|[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?)$/;
function compactar(doc) {
  YAML.visit(doc, {
    Seq(_k, nodo) { if (nodo.items.length && nodo.items.every((i) => YAML.isScalar(i) && typeof i.value === 'number')) nodo.flow = true; },
    Scalar(_k, nodo) { if (typeof nodo.value === 'string' && AMBIGUO_11.test(nodo.value)) nodo.type = 'QUOTE_DOUBLE'; },
  });
}

function escribirYaml(ruta, datos) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  let texto = null;
  if (fs.existsSync(ruta)) {
    const doc = YAML.parseDocument(fs.readFileSync(ruta, 'utf8'));
    if (!doc.errors.length && YAML.isMap(doc.contents)) {
      aplicarMapa(doc, doc.contents, datos);
      compactar(doc);
      texto = doc.toString({ lineWidth: 0 });
    }
  }
  if (texto === null) { const d = new YAML.Document(datos); compactar(d); texto = d.toString({ lineWidth: 0 }); }
  const tmp = `${ruta}.tmp`;
  fs.writeFileSync(tmp, texto, 'utf8');
  fs.renameSync(tmp, ruta);
}

function leerYaml(ruta) {
  const doc = YAML.parseDocument(fs.readFileSync(ruta, 'utf8'));
  if (doc.errors.length) throw new Error(doc.errors[0].message.split('\n')[0]);
  return doc.toJS() ?? {};
}

// ── Datos de la campaña que lleva el Editor (campana.yaml): su identificador y el orden de sus listas ──
// El identificador (uid) reconoce una campaña aunque cambie de nombre: al importar otra vez su archivo, el Editor sabe que ya la tienes.
const RE_UID = /^[a-f0-9]{8,40}$/;
const CABECERA_META = '# Datos de la campaña que guarda el Editor (no hace falta tocarlos a mano).\n# uid: identifica la campaña aunque cambie de nombre. orden: orden «Personalizado» de cada lista (la partida también lo usa).\n# creacion: orden en que se crearon los recursos de cada lista.\n';
function leerMeta(ruta) {
  let m = {};
  try { if (fs.existsSync(path.join(ruta, 'campana.yaml'))) m = leerYaml(path.join(ruta, 'campana.yaml')) || {}; } catch { m = {}; }
  if (!esObjeto(m)) m = {};
  const listas = (x) => Object.fromEntries(Object.entries(esObjeto(x) ? x : {})
    .filter(([c, l]) => Object.values(CARPETAS).includes(c) && Array.isArray(l)).map(([c, l]) => [c, [...new Set(l.filter((i) => esId(i)))]]));
  return { uid: typeof m.uid === 'string' && RE_UID.test(m.uid) ? m.uid : '', orden: listas(m.orden), creacion: listas(m.creacion) };
}
function escribirMeta(ruta, meta) {
  const limpio = { uid: meta.uid };
  for (const k of ['orden', 'creacion']) {
    const l = Object.fromEntries(Object.entries(meta[k] || {}).filter(([, v]) => v.length));
    if (Object.keys(l).length) limpio[k] = l;
  }
  fs.writeFileSync(path.join(ruta, 'campana.yaml'), CABECERA_META + YAML.stringify(limpio, { flow: false }), 'utf8');
}
const uidNuevo = () => require('crypto').randomBytes(8).toString('hex');
/** El uid de la campaña (si no tiene, se le crea uno y se guarda). */
function uidDe(ruta) {
  const m = leerMeta(ruta);
  if (!m.uid) { m.uid = uidNuevo(); escribirMeta(ruta, m); }
  return m.uid;
}
/** Apunta en campana.yaml que un recurso nuevo se creó ahora (para «Orden de creación») y lo añade al final del orden personalizado. */
function apuntarCreado(ruta, carpeta, id) {
  const m = leerMeta(ruta);
  if (!m.uid) m.uid = uidNuevo();
  for (const k of ['creacion', 'orden']) {
    if (k === 'orden' && !m.orden[carpeta]) continue;          // sin orden personalizado aún: no hace falta
    const l = (m[k][carpeta] ||= []);
    if (!l.includes(id)) l.push(id);
  }
  escribirMeta(ruta, m);
}
/** Un recurso cambió de identificador (al guardarlo por primera vez con su nombre): su sitio en las listas se conserva. */
function renombrarEnMeta(ruta, carpeta, viejo, nuevo) {
  const m = leerMeta(ruta);
  let cambio = false;
  for (const k of ['creacion', 'orden']) {
    const l = m[k][carpeta];
    const i = l ? l.indexOf(viejo) : -1;
    if (i >= 0) { l[i] = nuevo; cambio = true; }
  }
  if (cambio) escribirMeta(ruta, m);
}

/** El orden de las listas para el Editor, por categoría del Editor (enemigos, habilidades…): { personalizado: {cat: [ids]}, creacion: {cat: [ids]} }. */
function ordenDe(ruta) {
  const m = leerMeta(ruta);
  const porCat = (x) => Object.fromEntries(Object.entries(CARPETAS).filter(([, c]) => x[c]).map(([cat, c]) => [cat, x[c]]));
  return { personalizado: porCat(m.orden), creacion: porCat(m.creacion) };
}
/** Guarda el orden «Personalizado» de una categoría (el que se elige arrastrando en la lista). */
function guardarOrden(n, cat, ids) {
  if (!CARPETAS[cat]) error('Categoría no válida');
  if (!Array.isArray(ids) || ids.length > 20000 || !ids.every((i) => esId(i))) error('Orden no válido');
  const ruta = rutaCampana(n);
  const m = leerMeta(ruta);
  if (!m.uid) m.uid = uidNuevo();
  m.orden[CARPETAS[cat]] = [...new Set(ids)];
  escribirMeta(ruta, m);
  return ordenDe(ruta);
}

// ── Campañas ──
function listarCampanas() {
  if (!fs.existsSync(CARPETA_CAMPANAS)) return [];
  return fs.readdirSync(CARPETA_CAMPANAS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && esNombreCampana(d.name))
    .map((d) => {
      let nombre = d.name;
      try { nombre = leerYaml(path.join(CARPETA_CAMPANAS, d.name, 'config.yaml')).servidor?.nombre || d.name; } catch { /* sin config legible */ }
      return { id: d.name, nombre };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ── Carpeta del cliente ──
// Las imágenes y la música NO se guardan en la campaña ni las reparte el servidor: viven en la carpeta «base» del
// cliente (base/tokens, maps, icons, music). El Editor necesita saber dónde está esa carpeta para copiar ahí lo que importas.
const os = require('os');
function archivoAjustes() {
  if (process.env.MESA_EDITOR_AJUSTES) return process.env.MESA_EDITOR_AJUSTES;
  let dir = path.join(os.homedir(), '.mesa-rol');
  try { dir = require('electron').app.getPath('userData'); } catch { /* sin Electron (pruebas) */ }
  return path.join(dir, 'editor.json');
}
function leerAjustes() { try { return JSON.parse(fs.readFileSync(archivoAjustes(), 'utf8')) || {}; } catch { return {}; } }
function guardarAjustes(a) { const f = archivoAjustes(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(a, null, 2)); }

const esCarpeta = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
/** Carpeta del cliente: la que se eligió, la variable MESA_CLIENTE, o el cliente que está junto al servidor (repositorio completo). */
function carpetaCliente() {
  const candidatas = [process.env.MESA_CLIENTE, leerAjustes().carpetaCliente, path.join(RAIZ_SERVIDOR, '..', 'client')].filter(Boolean);
  for (const c of candidatas) if (esCarpeta(c) && (esCarpeta(path.join(c, 'base')) || fs.existsSync(path.join(c, 'main.js')) || leerAjustes().carpetaCliente === c || process.env.MESA_CLIENTE === c)) return path.resolve(c);
  return null;
}
function baseCliente(crear = false) {
  const c = carpetaCliente();
  if (!c) return null;
  const base = path.join(c, 'base');
  if (crear) for (const a of ASSETS) fs.mkdirSync(path.join(base, a), { recursive: true });
  return base;
}
// ── Archivos de cada campaña (imágenes y sonidos): campanas/<id>/base/… ──
// Antes vivían en la carpeta del cliente (compartida por todas las campañas); ahora cada campaña tiene la suya, que el GM
// exporta como .zip para sus jugadores. Las funciones de abajo trabajan sobre la campaña abierta en el Editor.
let campanaActual = null;
function baseCampana(crear = false) {
  if (!campanaActual) return null;
  const base = path.join(rutaCampana(campanaActual), 'base');
  if (crear) for (const a of ASSETS) fs.mkdirSync(path.join(base, a), { recursive: true });
  return base;
}
function infoCliente() { const base = baseCampana(true); return { ruta: base, base, conectada: !!base }; }

/** Rutas de archivo («tokens/orco.png», «sonido/musica/tema.mp3») que cita una campaña en sus YAML. */
function archivosCitados(ruta) {
  const res = new Set();
  const textos = [];
  const andar = (d, nivel) => {
    let nombres = [];
    try { nombres = fs.readdirSync(d); } catch { return; }
    for (const f of nombres) {
      if (f === 'base' || f.startsWith('_') || f.startsWith('.')) continue;
      const r = path.join(d, f);
      if (esCarpeta(r)) { if (nivel < 2) andar(r, nivel + 1); } else if (f.endsWith('.yaml')) { try { textos.push([f, fs.readFileSync(r, 'utf8')]); } catch { /* nada */ } }
    }
  };
  andar(ruta, 0);
  for (const [f, t] of textos) {
    for (const m of t.matchAll(/(?:tokens|maps|icons|tiles|otros)\/[^\s'"#,\]}]+?\.(?:png|jpe?g|gif|webp)/gi)) res.add(m[0]);
    if (f === 'sonidos.yaml') {
      try {
        const so = normalizarSonidos(leerYaml(path.join(ruta, f)));
        for (const tipo of TIPOS_SONIDO) for (const g of so[tipo]) for (const a of g.archivos) res.add(`sonido/${tipo}/${a}`);
      } catch { /* nada */ }
    }
  }
  return [...res];
}
/** La primera vez que se abre una campaña sin carpeta «base», se copian a ella los archivos que usa desde la carpeta del cliente antigua. */
function migrarArchivos(nombre) {
  const destino = path.join(rutaCampana(nombre), 'base');
  if (esCarpeta(destino)) return 0;
  const vieja = baseCliente();
  for (const a of ASSETS) fs.mkdirSync(path.join(destino, a), { recursive: true });
  if (!vieja) return 0;
  let n = 0;
  for (const rel of archivosCitados(rutaCampana(nombre))) {
    const partes = rel.split('/');
    if (partes.some((p) => !p || p === '.' || p === '..')) continue;
    const origen = path.join(vieja, ...partes), fin = path.join(destino, ...partes);
    try {
      if (!fs.statSync(origen).isFile()) continue;
      fs.mkdirSync(path.dirname(fin), { recursive: true });
      fs.copyFileSync(origen, fin, fs.constants.COPYFILE_EXCL);
      n++;
    } catch { /* no estaba o ya existe */ }
  }
  return n;
}

/** Zip con los archivos de la campaña para los jugadores (lo importan en el cliente: Ajustes → «Importar archivos de campaña»). */
async function exportarArchivos(ventana) {
  const base = baseCampana(true);
  const cfg = leerYaml(path.join(rutaCampana(campanaActual), 'config.yaml'));
  const entradas = [{ nombre: 'mesa-campana.json', datos: Buffer.from(JSON.stringify({ campana: campanaActual, nombre: cfg.servidor?.nombre || campanaActual, version: 1 }, null, 1)) }];
  for (const a of ASSETS) for (const f of archivosDe(path.join(base, a), !a.startsWith('sonido/'))) {
    entradas.push({ nombre: `${a}/${f}`, datos: fs.readFileSync(path.join(base, a, ...f.split('/'))) });
  }
  const r = await dialog.showSaveDialog(ventana, { title: 'Exportar archivos para los jugadores', defaultPath: `${campanaActual}-archivos.zip`, filters: [{ name: 'Zip', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return null;
  const destino = r.filePath.toLowerCase().endsWith('.zip') ? r.filePath : `${r.filePath}.zip`;
  fs.writeFileSync(destino, require('./zip').crearZip(entradas));
  return { ruta: destino, archivos: entradas.length - 1 };
}

const PROFUNDIDAD_ASSETS = 3;          // base/tokens/criaturas/no-muertos/esqueleto.png como mucho
const oculto = (n) => n.startsWith('.') || n.startsWith('_');
/** Archivos de una carpeta de base/, con sus subcarpetas («criaturas/lobo.png»). Los sonidos siguen sin subcarpetas. */
function archivosDe(dir, conSub, rel = '', nivel = 0, res = []) {
  let nombres = [];
  try { nombres = fs.readdirSync(dir); } catch { return res; }
  for (const f of nombres) {
    if (oculto(f)) continue;
    const r = path.join(dir, f);
    let st; try { st = fs.statSync(r); } catch { continue; }
    if (st.isFile() && /\.(png|jpe?g|gif|webp|ogg|mp3|wav)$/i.test(f)) res.push(rel + f);
    else if (st.isDirectory() && conSub && nivel < PROFUNDIDAD_ASSETS - 1) archivosDe(r, conSub, `${rel}${f}/`, nivel + 1, res);
  }
  return res;
}
function listarAssets() {
  const res = {};
  const base = baseCampana();
  for (const c of ASSETS) {
    const dir = base && path.join(base, c);
    res[c] = dir && esCarpeta(dir) ? archivosDe(dir, !c.startsWith('sonido/')).sort((x, y) => x.localeCompare(y, 'es', { numeric: true })) : [];
  }
  return res;
}
/** Subcarpetas de cada categoría de imágenes (también las vacías, para poder importar en ellas). */
function carpetasAssets() {
  const res = {};
  const base = baseCampana();
  for (const c of ASSETS.filter((x) => !x.startsWith('sonido/'))) {
    const lista = [];
    const andar = (dir, rel, nivel) => {
      let nombres = [];
      try { nombres = fs.readdirSync(dir); } catch { return; }
      for (const f of nombres) {
        if (oculto(f)) continue;
        const r = path.join(dir, f);
        try { if (!fs.statSync(r).isDirectory()) continue; } catch { continue; }
        lista.push(rel + f);
        if (nivel < PROFUNDIDAD_ASSETS - 2) andar(r, `${rel}${f}/`, nivel + 1);
      }
    };
    if (base && esCarpeta(path.join(base, c))) andar(path.join(base, c), '', 0);
    res[c] = lista.sort((x, y) => x.localeCompare(y, 'es', { numeric: true }));
  }
  return res;
}
/** «criaturas/no muertos» → ruta segura dentro de la categoría (cada trozo con nombre limpio). '' = la carpeta de la categoría. */
function subcarpetaSegura(sub) {
  if (sub == null || sub === '') return '';
  if (typeof sub !== 'string' || sub.length > 120) error('Carpeta no válida');
  const trozos = sub.split('/').map((t) => t.trim()).filter(Boolean);
  if (!trozos.length || trozos.length > PROFUNDIDAD_ASSETS - 1) error('Carpeta no válida');
  return trozos.map((t) => slug(t, 'carpeta')).join('/');
}
function crearCarpetaAssets(categoria, sub) {
  if (!ASSETS.includes(categoria) || categoria.startsWith('sonido/')) error('Categoría de archivos no válida');
  if (!baseCampana()) error('Abre una campaña primero');
  const limpia = subcarpetaSegura(sub);
  if (!limpia) error('Escribe un nombre para la carpeta');
  fs.mkdirSync(path.join(baseCampana(true), categoria, ...limpia.split('/')), { recursive: true });
  return limpia;
}

// ── Listas de sonidos (sonidos.yaml): {musica|ambiente|efectos: [{categoria, archivos: [nombre.ext]}]} ──
const TIPOS_SONIDO = ['musica', 'ambiente', 'efectos'];
const sonidosVacios = () => ({ musica: [], ambiente: [], efectos: [] });
const AUDIO_OK = /^[^\\/:*?"<>|\x00-\x1f]{1,120}\.(ogg|mp3|wav)$/i;
/** Deja la lista en su forma canónica y descarta lo que no sea un nombre de audio razonable. */
function normalizarSonidos(d) {
  const res = sonidosVacios();
  if (!esObjeto(d)) return res;
  for (const tipo of TIPOS_SONIDO) {
    const vistos = new Set();
    const grupos = new Map();
    const lista = Array.isArray(d[tipo]) ? d[tipo] : [];
    for (const g of lista) {
      const cat = typeof g === 'string' ? 'General' : (typeof g?.categoria === 'string' && g.categoria.trim() ? g.categoria.trim().slice(0, 40) : 'General');
      const nombres = typeof g === 'string' ? [g] : (Array.isArray(g?.archivos) ? g.archivos : []);
      if (!grupos.has(cat)) grupos.set(cat, []);
      for (const n of nombres) if (typeof n === 'string' && AUDIO_OK.test(n) && !n.includes('..') && !n.startsWith('.') && !vistos.has(n)) { vistos.add(n); grupos.get(cat).push(n); }
    }
    res[tipo] = [...grupos].map(([categoria, archivos]) => ({ categoria, archivos }));
  }
  return res;
}
function guardarSonidos(nombre, datos) {
  if (!esObjeto(datos)) error('Datos no válidos');
  const limpio = normalizarSonidos(datos);
  const cab = '# Listas de sonidos de la campaña. Solo nombres de archivo: los audios están en el cliente (base/sonido/musica, ambiente y efectos).\n';
  fs.writeFileSync(path.join(rutaCampana(nombre), 'sonidos.yaml'), cab + YAML.stringify(limpio), 'utf8');
  return limpio;
}

function cargarCampana(nombre) {
  const ruta = rutaCampana(nombre);
  const recursos = {};
  const problemas = [];
  for (const [cat, carpeta] of Object.entries(CARPETAS)) {
    recursos[cat] = {};
    const dir = path.join(ruta, carpeta);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.yaml')) continue;
      const id = f.slice(0, -5);
      if (!esId(id)) { problemas.push(`${carpeta}/${f}: el nombre del archivo solo puede tener letras minúsculas, números y _`); continue; }
      try { recursos[cat][id] = leerYaml(path.join(dir, f)); }
      catch (e) { problemas.push(`${carpeta}/${f}: no se pudo leer (${e.message})`); }
    }
  }
  let config = {};
  try { config = leerYaml(path.join(ruta, 'config.yaml')); } catch (e) { problemas.push(`config.yaml: no se pudo leer (${e.message})`); }
  let sonidos = sonidosVacios();
  try { if (fs.existsSync(path.join(ruta, 'sonidos.yaml'))) sonidos = normalizarSonidos(leerYaml(path.join(ruta, 'sonidos.yaml'))); }
  catch (e) { problemas.push(`sonidos.yaml: no se pudo leer (${e.message})`); }
  const migrados = migrarArchivos(nombre);
  copiarPredeterminados(ruta);            // las campañas de antes también reciben los iconos de habilidades del programa
  campanaActual = nombre;
  return { id: nombre, ruta, config, recursos, sonidos, assets: listarAssets(), cliente: infoCliente(), problemas, migrados, orden: ordenDe(ruta) };
}

const CONFIG_VACIA = `# Configuración de la campaña. Se edita desde el Editor (apartado «Reglas del juego»).
servidor:
  nombre: "%NOMBRE%"
  host: 0.0.0.0
  puerto: 8765
  password_servidor: ""
  password_gm: ""

permisos:
  musica: gm
  romper_casillas: gm
  mover_tokens_ajenos: false
  acciones_solo_en_su_turno: true
  crear_personajes: true
  editar_stats_jugador: false
  max_personajes_por_jugador: 3

juego:
  estadisticas:
    - { nombre: Fuerza, valor_inicial: 10, minimo: 0, maximo: 99 }
    - { nombre: Agilidad, valor_inicial: 10, minimo: 0, maximo: 99 }
    - { nombre: Mente, valor_inicial: 10, minimo: 0, maximo: 99 }
  recursos:
    - { nombre: HP, descripcion: Puntos de vida, maximo_inicial: 100 }
  recurso_vida: HP
  puntos_a_repartir: 10
  estadistica_iniciativa: Agilidad
  mapa_inicial: sala_inicial
  max_mensajes_chat: 100
`;

/** Casillas [x, y] del borde del mapa (para rodear la sala inicial de muros). */
function bordeDeMuros(ancho, alto) {
  const r = [];
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) if (x === 0 || y === 0 || x === ancho - 1 || y === alto - 1) r.push([x, y]);
  return r;
}

/** Iconos por defecto que trae toda campaña nueva (en su galería: icons/habilidades). */
function copiarPredeterminados(destino) {
  const origen = path.join(__dirname, 'predeterminados', 'habilidades');
  const final = path.join(destino, 'base', 'icons', 'habilidades');
  if (!fs.existsSync(origen) || fs.existsSync(final)) return;
  fs.mkdirSync(final, { recursive: true });
  for (const f of fs.readdirSync(origen)) if (/\.png$/i.test(f)) fs.copyFileSync(path.join(origen, f), path.join(final, f));
}

function crearCampana(nombreVisible, plantilla) {
  const nombre = String(nombreVisible || '').trim();
  if (!nombre || nombre.length > 60) error('Escribe un nombre para la campaña (hasta 60 letras)');
  fs.mkdirSync(CARPETA_CAMPANAS, { recursive: true });
  const id = unico(slug(nombre, 'campana').replace(/_/g, '-'), (s) => fs.existsSync(path.join(CARPETA_CAMPANAS, s)));
  const destino = path.join(CARPETA_CAMPANAS, id);
  const ejemplo = path.join(CARPETA_CAMPANAS, 'ejemplo');
  if (plantilla === 'ejemplo' && fs.existsSync(ejemplo)) {
    fs.cpSync(ejemplo, destino, { recursive: true });
    const cfg = leerYaml(path.join(destino, 'config.yaml'));
    cfg.servidor = { ...(cfg.servidor || {}), nombre };
    escribirYaml(path.join(destino, 'config.yaml'), cfg);
    copiarPredeterminados(destino);
    escribirMeta(destino, { ...leerMeta(destino), uid: uidNuevo() });         // una campaña nueva, aunque salga del ejemplo
    return id;
  }
  fs.mkdirSync(destino);
  for (const c of Object.values(CARPETAS)) fs.mkdirSync(path.join(destino, c), { recursive: true });
  fs.writeFileSync(path.join(destino, 'config.yaml'), CONFIG_VACIA.replace('%NOMBRE%', nombre.replace(/"/g, '')), 'utf8');
  escribirYaml(path.join(destino, 'tiles', 'suelo.yaml'), { nombre: 'Suelo', descripcion: 'Terreno despejado.', color: '#6b7a55', transitable: true });
  escribirYaml(path.join(destino, 'tiles', 'muro.yaml'), { nombre: 'Muro', descripcion: 'Nadie puede atravesarlo.', color: '#555555', transitable: false });
  escribirYaml(path.join(destino, 'maps', 'sala_inicial.yaml'), {
    nombre: 'Sala inicial', descripcion: '', ancho: 14, alto: 9, tamano_tile: 64,
    tile_base: 'suelo', casillas: { muro: bordeDeMuros(14, 9) }, inicio: { x: 2, y: 4 },
  });
  escribirYaml(path.join(destino, 'abilities', 'ataque_basico.yaml'), {
    nombre: 'Ataque básico', descripcion: 'Un golpe cuerpo a cuerpo.', tipo: 'dano', objetivo: 'enemigo', alcance: 1, coste: {},
    formula: '[a.Fuerza] + 1d6', imagen: 'icons/habilidades/filo.png',
  });
  copiarPredeterminados(destino);
  escribirMeta(destino, { uid: uidNuevo() });
  return id;
}

function duplicarCampana(origen, nombreVisible) {
  const o = rutaCampana(origen);
  const nombre = String(nombreVisible || '').trim();
  if (!nombre) error('Escribe un nombre para la copia');
  const id = unico(slug(nombre, 'campana').replace(/_/g, '-'), (s) => fs.existsSync(path.join(CARPETA_CAMPANAS, s)));
  const destino = path.join(CARPETA_CAMPANAS, id);
  fs.cpSync(o, destino, { recursive: true });
  const cfg = leerYaml(path.join(destino, 'config.yaml'));
  cfg.servidor = { ...(cfg.servidor || {}), nombre };
  escribirYaml(path.join(destino, 'config.yaml'), cfg);
  escribirMeta(destino, { ...leerMeta(destino), uid: uidNuevo() });           // la copia es otra campaña: otro identificador
  return id;
}

/** Nada se borra de verdad: va a campanas/_papelera/ (el servidor no la ve). */
function aPapelera(ruta, etiqueta) {
  const papelera = path.join(CARPETA_CAMPANAS, '_papelera');
  fs.mkdirSync(papelera, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(papelera, `${etiqueta}-${marca}`);
  fs.renameSync(ruta, destino);
  return destino;
}

// ── Papelera: ver lo eliminado, recuperarlo o borrarlo de verdad ──
// Hay dos: campanas/_papelera/ (campañas enteras eliminadas o reemplazadas, una carpeta cada una) y campanas/<id>/_papelera/
// (recursos sueltos eliminados, un .yaml cada uno, con la forma «<carpeta>-<id>-<milisegundos>.yaml»).
const CAT_DE_CARPETA = Object.fromEntries(Object.entries(CARPETAS).map(([cat, c]) => [c, cat]));
const RE_PAP_RECURSO = /^([a-z]+)-([a-z0-9_]{1,60})-(\d{10,})\.yaml$/;
const RE_PAP_CAMPANA = /^(.+)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

/** Carpeta de la papelera: la de una campaña (ámbito «recursos») o la general (ámbito «campanas»). */
function carpetaPapelera(n, ambito) {
  if (ambito === 'recursos') return path.join(rutaCampana(n), '_papelera');
  if (ambito === 'campanas') return path.join(CARPETA_CAMPANAS, '_papelera');
  return error('Papelera no válida');
}
/** Un elemento de la papelera por su nombre. Solo vale un nombre suelto que exista dentro de ella: nada puede salir de esa carpeta. */
function elementoPapelera(n, ambito, nombre) {
  const base = carpetaPapelera(n, ambito);
  if (typeof nombre !== 'string' || !nombre || nombre === '.' || nombre === '..' || /[\\/\0]/.test(nombre)) error('Elemento no válido');
  const ruta = path.join(base, nombre);
  try { fs.lstatSync(ruta); } catch { error('Ese elemento ya no está en la papelera'); }
  return ruta;
}
const fechaDeArchivo = (ruta) => { try { return fs.statSync(ruta).mtime.toISOString(); } catch { return null; } };

/** → { recursos: [...], campanas: [...] }, lo más reciente primero. `n` es la campaña abierta (puede no haber ninguna). */
function listarPapelera(n) {
  const leer = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
  const recursos = [];
  if (n) {
    const dir = carpetaPapelera(n, 'recursos');
    for (const f of leer(dir)) {
      const m = RE_PAP_RECURSO.exec(f);
      const cat = m && CAT_DE_CARPETA[m[1]];
      const ruta = path.join(dir, f);
      if (!cat) { recursos.push({ nombre: f, cat: null, id: null, titulo: f, fecha: fechaDeArchivo(ruta) }); continue; }   // algo ajeno: se puede borrar, no recuperar
      let titulo = m[2];
      try { const d = leerYaml(ruta); if (typeof d.nombre === 'string' && d.nombre.trim()) titulo = d.nombre.trim(); } catch { /* ilegible: se muestra su id */ }
      recursos.push({ nombre: f, cat, id: m[2], titulo, fecha: new Date(Number(m[3])).toISOString() });
    }
  }
  const campanas = [];
  const dirC = carpetaPapelera(null, 'campanas');
  for (const f of leer(dirC)) {
    const ruta = path.join(dirC, f);
    if (!esCarpeta(ruta)) { campanas.push({ nombre: f, id: null, titulo: f, fecha: fechaDeArchivo(ruta), reemplazada: false }); continue; }
    const m = RE_PAP_CAMPANA.exec(f);
    const etiqueta = m ? m[1] : f;
    const reemplazada = etiqueta.endsWith('-reemplazada');
    const id = reemplazada ? etiqueta.slice(0, -'-reemplazada'.length) : etiqueta;
    let titulo = id;
    try { titulo = leerYaml(path.join(ruta, 'config.yaml')).servidor?.nombre || id; } catch { /* sin config legible */ }
    campanas.push({ nombre: f, id: m ? id : null, titulo, fecha: m ? `${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z` : fechaDeArchivo(ruta), reemplazada });
  }
  const masNuevo = (a, b) => String(b.fecha).localeCompare(String(a.fecha));
  return { recursos: recursos.sort(masNuevo), campanas: campanas.sort(masNuevo) };
}

/** Borra de verdad un elemento de la papelera (no se puede deshacer). */
function borrarDePapelera(n, ambito, nombre) {
  fs.rmSync(elementoPapelera(n, ambito, nombre), { recursive: true, force: true });
  return true;
}
/** Vacía una papelera entera. → cuántos elementos borró. */
function vaciarPapelera(n, ambito) {
  const base = carpetaPapelera(n, ambito);
  let borrados = 0;
  let nombres = [];
  try { nombres = fs.readdirSync(base); } catch { /* no hay papelera: nada que vaciar */ }
  for (const f of nombres) { fs.rmSync(path.join(base, f), { recursive: true, force: true }); borrados++; }
  return borrados;
}

/** Devuelve un recurso a su carpeta. Si ya hay otro con ese identificador, el recuperado toma uno libre. → { cat, id, idOriginal, datos } */
function restaurarRecurso(n, nombre) {
  const origen = elementoPapelera(n, 'recursos', nombre);
  const m = RE_PAP_RECURSO.exec(nombre);
  const cat = m && CAT_DE_CARPETA[m[1]];
  if (!cat) error('Este archivo no se puede recuperar: no es un recurso eliminado por el Editor');
  const ruta = rutaCampana(n);
  const dir = path.join(ruta, m[1]);
  fs.mkdirSync(dir, { recursive: true });
  const id = unico(m[2], (s) => fs.existsSync(path.join(dir, `${s}.yaml`)));
  fs.renameSync(origen, path.join(dir, `${id}.yaml`));
  apuntarCreado(ruta, m[1], id);
  let datos = null;
  try { datos = leerYaml(path.join(dir, `${id}.yaml`)); } catch { /* ilegible: el Editor lo avisará al abrir la campaña */ }
  return { cat, id, idOriginal: m[2], datos };
}

/** Devuelve una campaña a la lista. Si ya hay otra con ese nombre de carpeta (o con su identificador interno), la recuperada se distingue. → { id, nombre } */
function restaurarCampana(nombre) {
  const origen = elementoPapelera(null, 'campanas', nombre);
  if (!esCarpeta(origen)) error('Este elemento no se puede recuperar: no es una campaña');
  const m = RE_PAP_CAMPANA.exec(nombre);
  let base = m ? m[1].replace(/-reemplazada$/, '') : '';
  if (!esNombreCampana(base)) base = slug(base || 'campana', 'campana').replace(/_/g, '-');
  base = base.slice(0, 45);
  const libre = (s) => !fs.existsSync(path.join(CARPETA_CAMPANAS, s));
  let id = base, renombrada = false;
  for (let i = 1; !libre(id); i++) { id = i === 1 ? `${base}-restaurada` : `${base}-restaurada-${i}`; renombrada = true; if (i > 500) error('No se pudo encontrar un nombre libre'); }
  const destino = path.join(CARPETA_CAMPANAS, id);
  fs.renameSync(origen, destino);
  const meta = leerMeta(destino);
  const uidRepetido = meta.uid && listarCampanas().some((c) => c.id !== id && leerMeta(path.join(CARPETA_CAMPANAS, c.id)).uid === meta.uid);
  if (uidRepetido || !meta.uid) { escribirMeta(destino, { ...meta, uid: uidNuevo() }); }       // dos campañas con el mismo uid se confundirían al importar
  let titulo = id;
  try {
    const cfg = leerYaml(path.join(destino, 'config.yaml'));
    titulo = cfg.servidor?.nombre || id;
    if (renombrada) { titulo = `${titulo} (restaurada)`; escribirYaml(path.join(destino, 'config.yaml'), { ...cfg, servidor: { ...(cfg.servidor || {}), nombre: titulo } }); }
  } catch { /* sin config legible: el Editor ya lo avisa al abrirla */ }
  return { id, nombre: titulo };
}

// ── Validación con el propio servidor (una sola fuente de verdad) ──
let pythonCache;
function probar([cmd, ...pre], codigo = 'import yaml') {
  return new Promise((res) => execFile(cmd, [...pre, '-c', codigo], { timeout: 8000, windowsHide: true }, (e) => res(!e)));
}
// Primero las versiones con componentes ya compilados (3.13, 3.12, 3.14, 3.11): las más nuevas pueden no tenerlos
// Empaquetado: primero el Python que trae el propio Editor (ya con los componentes del servidor).
const candidatosPython = () => [PYTHON_PROPIO && fs.existsSync(PYTHON_PROPIO) && [PYTHON_PROPIO], process.env.MESA_PYTHON && [process.env.MESA_PYTHON], ...['3.13', '3.12', '3.14', '3.11'].map((v) => ['py', `-${v}`]), ['python3'], ['python'], ['py']].filter(Boolean);
/** El Python que ya tiene los componentes del servidor (los instala el propio Editor al abrir el servidor por primera vez). */
async function encontrarPython() {
  if (pythonCache !== undefined) return pythonCache;
  for (const c of candidatosPython()) {
    if (await probar(c)) { pythonCache = c; return c; }
  }
  pythonCache = null;
  return null;
}
/** Cualquier Python 3.10+ del equipo, tenga o no los componentes (para instalárselos). */
async function encontrarPythonBase() {
  for (const c of candidatosPython()) {
    if (await probar(c, 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)')) return c;
  }
  return null;
}
const olvidarPython = () => { pythonCache = undefined; };
async function servidorPy(args, { esperar = true } = {}) {
  if (esperar) await servidor.esperarEntorno();            // la primera vez, mientras se instalan los componentes, la comprobación espera
  const py = await encontrarPython();
  if (!py) error(servidor.entorno().error || 'No se encontró Python con los componentes del servidor. Instala Python (python.org, marcando «Add python.exe to PATH») y vuelve a abrir el Editor: al abrirlo instala lo que falta.');
  return new Promise((resolver, rechazar) => {
    execFile(py[0], [...py.slice(1), path.join(RAIZ_SERVIDOR, 'main.py'), ...args], { cwd: RAIZ_SERVIDOR, timeout: 30000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (e, out, err) => {
      try { resolver(JSON.parse(out)); } catch { rechazar(new Error((err || (e && e.message) || 'Respuesta no válida del servidor').toString().slice(0, 400))); }
    });
  });
}
const validar = (nombre) => servidorPy(['--validar', '--json', '--config', rutaCampana(nombre)]);
const esquemaEfectos = () => servidorPy(['--esquema'], { esperar: false });      // sin esperar: el Editor debe abrirse ya (el cliente lo pide de nuevo al terminar la instalación)
/** Prueba una habilidad con las reglas reales del servidor (con el borrador sin guardar, si lo hay). */
async function simular(nombre, peticion) {
  if (!esObjeto(peticion)) error('Petición no válida');
  const tmp = path.join(require('os').tmpdir(), `mesa-sim-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(peticion), 'utf8');
  try { return await servidorPy(['--simular', tmp, '--config', rutaCampana(nombre)]); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── Contraseñas (mismo formato que el servidor: scrypt$N$r$p$sal$hash) ──
function hashear(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) error('La contraseña debe tener entre 6 y 128 caracteres');
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(password, sal, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${sal.toString('base64')}$${h.toString('base64')}`;
}

// ── Imágenes y música ──
async function elegirCarpetaCliente(ventana) {
  const r = await dialog.showOpenDialog(ventana, { title: 'Elige la carpeta del cliente (la que contiene «base»)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return infoCliente();
  const elegida = r.filePaths[0];
  // Si eligió la propia carpeta «base», se sube un nivel.
  const carpeta = path.basename(elegida).toLowerCase() === 'base' ? path.dirname(elegida) : elegida;
  guardarAjustes({ ...leerAjustes(), carpetaCliente: carpeta });
  baseCliente(true);
  return infoCliente();
}

async function importarArchivo(ventana, categoria, sub = '') {
  if (!ASSETS.includes(categoria)) error('Categoría de archivos no válida');
  const limpia = categoria.startsWith('sonido/') ? '' : subcarpetaSegura(sub);
  if (!baseCampana()) error('Abre una campaña primero');
  const base = baseCampana(true);
  const esMusica = categoria.startsWith('sonido/');
  const r = await dialog.showOpenDialog(ventana, {
    title: esMusica ? 'Elige un archivo de audio' : 'Elige una imagen', properties: ['openFile', 'multiSelections'],
    filters: [{ name: esMusica ? 'Audio' : 'Imágenes', extensions: esMusica ? EXT_AUDIO : EXT_IMAGEN }],
  });
  if (r.canceled) return [];
  return copiarAssets(r.filePaths, categoria, base, limpia);
}

/** Huella del contenido de un archivo (para no copiar dos veces el mismo). */
function huellaArchivo(ruta) {
  return crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
}
/** ¿Ya hay en la carpeta de la categoría (o en sus subcarpetas) un archivo idéntico (mismo tamaño y contenido)? → su ruta relativa, o null. */
function yaExiste(dir, origen, conSub = true) {
  const tam = fs.statSync(origen).size;
  let huella = null;
  for (const n of archivosDe(dir, conSub)) {
    const r = path.join(dir, ...n.split('/'));
    let st;
    try { st = fs.statSync(r); } catch { continue; }
    if (st.size !== tam) continue;
    huella ??= huellaArchivo(origen);
    if (huellaArchivo(r) === huella) return n;
  }
  return null;
}

/** Copia archivos a base/<categoría>/ con nombre limpio y sin pisar los que ya existen. Si el mismo archivo ya está, lo reutiliza
 *  en vez de duplicarlo. Devuelve «categoría/archivo». */
function copiarAssets(origenes, categoria, base, sub = '') {
  const esMusica = categoria.startsWith('sonido/');
  const raiz = path.join(base, categoria);
  const dir = sub ? path.join(raiz, ...sub.split('/')) : raiz;
  fs.mkdirSync(dir, { recursive: true });
  const nuevos = [];
  for (const origen of origenes) {
    const ext = path.extname(origen).slice(1).toLowerCase();
    if (!(esMusica ? EXT_AUDIO : EXT_IMAGEN).includes(ext)) continue;
    const igual = yaExiste(raiz, origen, !esMusica);
    if (igual) { nuevos.push(`${categoria}/${igual}`); continue; }
    const nombre = esMusica ? nombreDeAudio(origen) : slug(path.basename(origen, path.extname(origen)), 'archivo');     // el sonido conserva su título tal cual
    const final = unico(nombre, (x) => fs.existsSync(path.join(dir, `${x}.${ext}`)));
    fs.copyFileSync(origen, path.join(dir, `${final}.${ext}`));
    nuevos.push(`${categoria}/${sub ? `${sub}/` : ''}${final}.${ext}`);
  }
  return nuevos;
}

const paquete = require('./paquete').crear({ CARPETAS, esId, ASSETS, PROFUNDIDAD: PROFUNDIDAD_ASSETS });
/** Archivos de base/ de una campaña («tokens/orco.png», «sonido/musica/tema.ogg»), para exportarla entera. */
const archivosBase = (ruta) => ASSETS.flatMap((a) => archivosDe(path.join(ruta, 'base', a), !a.startsWith('sonido/')).map((f) => `${a}/${f}`));

async function exportarCampana(ventana, id) {
  const ruta = rutaCampana(id);
  const cfg = leerYaml(path.join(ruta, 'config.yaml'));
  const r = await dialog.showSaveDialog(ventana, {
    title: 'Exportar campaña', defaultPath: `${slug(cfg.servidor?.nombre || id, 'campana')}.mesa-campana`,
    filters: [{ name: 'Campaña de Campaigns and Dragons Online', extensions: ['mesa-campana'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const destino = r.filePath.toLowerCase().endsWith('.mesa-campana') ? r.filePath : `${r.filePath}.mesa-campana`;
  uidDe(ruta);                     // así, al importar este archivo otra vez, el Editor reconoce la campaña
  const { zip, archivos } = paquete.empaquetarZip(ruta, id, () => archivosBase(ruta));
  fs.writeFileSync(destino, zip);
  return { ruta: destino, archivos };
}
/** ¿Ya hay una campaña que sea la del archivo? Primero por su identificador (uid, aunque se haya renombrado); si el archivo no lo trae
 *  (exportado con una versión anterior), por el nombre. → id de la campaña o null. */
function campanaParecida(obj) {
  let uid = typeof obj.uid === 'string' ? obj.uid : '';
  if (!uid) { try { uid = String(YAML.parse(obj.archivos?.['campana.yaml'] || '')?.uid || ''); } catch { /* sin uid */ } }
  const todas = listarCampanas();
  if (RE_UID.test(uid)) {
    const porUid = todas.find((c) => leerMeta(path.join(CARPETA_CAMPANAS, c.id)).uid === uid);
    if (porUid) return { id: porUid.id, porUid: true };
  }
  const nombre = String(obj.nombre || '').trim().toLowerCase();
  const porNombre = nombre && todas.find((c) => String(c.nombre).trim().toLowerCase() === nombre);
  return porNombre ? { id: porNombre.id, porUid: false } : null;
}
/** Lo que el GM necesita para decidir si reemplaza: qué tiene ahora y qué trae el archivo. */
function infoConflicto(id, porUid, obj) {
  const ruta = path.join(CARPETA_CAMPANAS, id);
  let modificada = 0;
  const cuenta = (lista) => lista.length;
  const yamlsDe = (carpeta) => { try { return fs.readdirSync(path.join(ruta, carpeta)).filter((f) => f.endsWith('.yaml')); } catch { return []; } };
  for (const f of ['config.yaml', 'sonidos.yaml', ...Object.values(CARPETAS).flatMap((c) => yamlsDe(c).map((x) => `${c}/${x}`))]) {
    try { modificada = Math.max(modificada, fs.statSync(path.join(ruta, f)).mtimeMs); } catch { /* no está */ }
  }
  const mapasAhora = Object.fromEntries(yamlsDe('maps').map((f) => [f.slice(0, -5), (() => { try { return leerYaml(path.join(ruta, 'maps', f)).nombre || f.slice(0, -5); } catch { return f.slice(0, -5); } })()]));
  const mapasArchivo = Object.keys(obj.archivos || {}).filter((k) => k.startsWith('maps/')).map((k) => k.slice(5, -5));
  const recursosArchivo = Object.keys(obj.archivos || {}).filter((k) => k.includes('/')).length;
  const recursosAhora = Object.values(CARPETAS).reduce((n, c) => n + cuenta(yamlsDe(c)), 0);
  const actual = listarCampanas().find((c) => c.id === id);
  return {
    id, porUid, nombre: actual?.nombre || id, nombreArchivo: String(obj.nombre || ''),
    modificada: modificada ? new Date(modificada).toISOString() : null, exportada: typeof obj.exportada === 'string' ? obj.exportada : null,
    ahora: { mapas: Object.keys(mapasAhora).length, recursos: recursosAhora },
    archivo: { mapas: mapasArchivo.length, recursos: recursosArchivo },
    mapasQueSeQuitan: Object.entries(mapasAhora).filter(([m]) => !mapasArchivo.includes(m)).map(([, n]) => n),
    hayPartida: fs.existsSync(path.join(dirDatos(id), 'estado.yaml')) || fs.existsSync(path.join(dirDatos(id), 'jugadores')),
    servidorAbierto: !!servidor.estado(id).abierto,
  };
}
/** Sustituye la campaña `id` por la del archivo, conservando lo que es de esta instalación: el mismo identificador de carpeta (así la
 *  partida guardada, las cuentas y las fichas de data/<id>/ siguen valiendo), las contraseñas y la dirección del servidor y su uid.
 *  La versión anterior entera (con sus imágenes y sonidos) va a campanas/_papelera/: nada se pierde. */
function reemplazarCampana(id, obj, archivos) {
  const ruta = rutaCampana(id);
  if (servidor.estado(id).abierto) error('El servidor de esa campaña está abierto. Ciérralo antes de reemplazarla (la partida tiene la campaña en memoria).');
  const temporal = path.join(CARPETA_CAMPANAS, `_importando-${uidNuevo()}`);
  paquete.desempaquetar(obj, temporal, archivos);              // primero se comprueba y se escribe aparte: si algo falla, la campaña sigue intacta
  try {
    let viejo = {};
    try { viejo = leerYaml(path.join(ruta, 'config.yaml')).servidor || {}; } catch { /* config ilegible: no hay nada que conservar */ }
    const doc = YAML.parseDocument(fs.readFileSync(path.join(temporal, 'config.yaml'), 'utf8'));
    for (const k of ['password_gm', 'password_servidor', 'host', 'puerto', 'cifrado', 'certificado', 'clave']) {
      if (viejo[k] !== undefined && viejo[k] !== '') doc.setIn(['servidor', k], viejo[k]);
    }
    fs.writeFileSync(path.join(temporal, 'config.yaml'), String(doc), 'utf8');
    const meta = leerMeta(temporal);
    escribirMeta(temporal, { ...meta, uid: leerMeta(ruta).uid || meta.uid || uidNuevo() });
    const papelera = aPapelera(ruta, `${id}-reemplazada`);
    try { fs.renameSync(temporal, ruta); } catch (e) { fs.renameSync(papelera, ruta); throw e; }
    return path.relative(CARPETA_CAMPANAS, papelera);
  } catch (e) { fs.rmSync(temporal, { recursive: true, force: true }); throw e; }
}
// El archivo elegido se recuerda para la segunda llamada (cuando ya existe la campaña y el GM eligió qué hacer).
let campanaPendiente = null;
async function importarCampana(ventana, modo) {
  let archivo;
  if (modo) {
    if (!campanaPendiente) error('Vuelve a elegir el archivo de la campaña.');
    archivo = campanaPendiente;
  } else {
    const r = await dialog.showOpenDialog(ventana, { title: 'Importar campaña', properties: ['openFile'], filters: [{ name: 'Campaña de Campaigns and Dragons Online', extensions: ['mesa-campana'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    archivo = r.filePaths[0];
  }
  campanaPendiente = null;
  const res = importarDesde(archivo, modo || undefined);
  if (res.conflicto) campanaPendiente = archivo;
  return res;
}
/** Importa un .mesa-campana (el .zip nuevo, con imágenes y sonidos, o el JSON antiguo).
 *  Si ya tienes esa campaña (mismo uid o mismo nombre) y no se dice `modo`, no toca nada y devuelve `{ conflicto: {…} }`:
 *  `modo: 'copia'` la importa como campaña NUEVA (con otro identificador) y `modo: 'reemplazar'` sustituye la que tienes.
 *  → { id, archivos, ignorados, reemplazada?, papelera? } */
function importarDesde(archivo, modo) {
  if (modo !== undefined && !['copia', 'reemplazar'].includes(modo)) error('Modo de importación no válido.');
  if (fs.statSync(archivo).size > 2 * 1024 * 1024 * 1024) error('El archivo es demasiado grande para ser una campaña.');
  const { obj, archivos, ignorados } = paquete.leerPaquete(fs.readFileSync(archivo));
  paquete.comprobar(obj);
  const parecida = campanaParecida(obj);
  if (parecida && !modo) return { conflicto: infoConflicto(parecida.id, parecida.porUid, obj) };
  if (parecida && modo === 'reemplazar') {
    const papelera = reemplazarCampana(parecida.id, obj, archivos);
    return { id: parecida.id, archivos: archivos.length, ignorados, reemplazada: true, papelera };
  }
  const nombre = String(obj.nombre || 'Campaña importada').slice(0, 60);
  fs.mkdirSync(CARPETA_CAMPANAS, { recursive: true });
  const id = unico(slug(nombre, 'campana').replace(/_/g, '-'), (s) => fs.existsSync(path.join(CARPETA_CAMPANAS, s)));
  const destino = path.join(CARPETA_CAMPANAS, id);
  paquete.desempaquetar(obj, destino, archivos);
  const meta = leerMeta(destino);
  if (parecida || !meta.uid) escribirMeta(destino, { ...meta, uid: uidNuevo() });     // una copia es otra campaña: otro identificador
  return { id, archivos: archivos.length, ignorados };
}

const jugadores = require('./jugadores').crear({ dirDatos, hashear });

// ── Personajes exportados desde el cliente (.mesa-personaje: un .zip con «personaje.json» y «archivos/<ruta>» con sus imágenes) ──
const CAMPOS_IMAGEN = ['imagen', 'imagen_biografia', 'imagen_propia'];
// Lo que guarda el servidor en una ficha además de lo que se edita en el Editor: se conserva al importar (el servidor lo vuelve a
// comprobar al cargar la ficha, igual que todo lo demás).
const CAMPOS_EXTRA = ['personalidad', 'propias'];
const nombreCopia = (nombre, ocupado) => {
  for (let i = 2; i < 100; i++) {
    const suf = ` (${i})`;
    const n = `${nombre.slice(0, 30 - suf.length).trim()}${suf}`;
    if (!ocupado(n)) return n;
  }
  return error('No se encontró un nombre libre para la copia.');
};
/** Importa un personaje exportado desde el cliente como ficha del usuario `usuario` de la campaña `n`, con todos sus datos e imágenes.
 *  Se comprueba contra la campaña igual que una ficha hecha en el Editor (si no encaja, no se importa nada).
 *  Si el usuario ya tiene una ficha con ese nombre y no se dice `modo`, no se toca nada y se devuelve `{ conflicto: { nombre } }`:
 *  `modo: 'reemplazar'` sustituye esa ficha por la del archivo (conserva su id, así el token y la partida la siguen reconociendo) y
 *  `modo: 'copia'` la importa como ficha nueva con otro nombre («Thor (2)»).
 *  Imágenes: si la campaña ya tiene ese mismo archivo (idéntico) se reutiliza; si no, se copia a base/tokens/importados/<nombre>/. */
function importarPersonajeDesde(n, usuario, archivo, modo) {
  const ruta = rutaCampana(n);
  if (modo !== undefined && modo !== null && !['reemplazar', 'copia'].includes(modo)) error('Modo de importación no válido.');
  if (fs.statSync(archivo).size > 100 * 1024 * 1024) error('El archivo es demasiado grande para ser un personaje.');
  const buf = fs.readFileSync(archivo);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) error('Este archivo no es un personaje exportado desde el cliente (.mesa-personaje).');
  let entradas;
  try { entradas = require('./zip-lector').leerZip(buf); } catch (e) { error(`El archivo está dañado: ${e.message}.`); }
  const json = entradas.find((e) => e.nombre === 'personaje.json');
  if (!json || json.tam > 2 * 1024 * 1024) error('Este archivo no es un personaje exportado desde el cliente (.mesa-personaje).');
  let obj; try { obj = JSON.parse(json.leer().toString('utf8')); } catch { error('El archivo está dañado: no se puede leer la ficha.'); }
  if (obj?.formato !== 'mesa-de-rol/personaje' || !obj.personaje || typeof obj.personaje !== 'object' || Array.isArray(obj.personaje)) error('Este archivo no es un personaje exportado desde el cliente (.mesa-personaje).');
  if (!Number.isInteger(obj.version) || obj.version > 1) error('Este personaje es de una versión más nueva del programa. Actualiza el Editor para importarlo.');
  const ficha = { ...obj.personaje };
  delete ficha.id;                       // el id lo decide el Editor: nunca se pisa otra ficha por accidente
  const nombreArchivo = String(ficha.nombre ?? '').trim();
  const existentes = jugadores.listar(n).usuarios.find((u) => u.usuario.toLowerCase() === String(usuario).toLowerCase())?.fichas || [];
  const igual = existentes.find((f) => String(f.nombre).toLowerCase() === nombreArchivo.toLowerCase());
  if (igual && !modo) return { conflicto: { nombre: igual.nombre } };
  if (igual && modo === 'reemplazar') ficha.id = igual.id;
  if (igual && modo === 'copia') ficha.nombre = nombreCopia(nombreArchivo, (x) => existentes.some((f) => String(f.nombre).toLowerCase() === x.toLowerCase()));
  // Los objetos equipados y los datos que el Editor no edita (personalidad, anotaciones propias) también viajan.
  const equipados = new Set((Array.isArray(ficha.inventario) ? ficha.inventario : []).filter((e) => e?.equipado === true).map((e) => e.objeto));
  const extras = Object.fromEntries(CAMPOS_EXTRA.filter((k) => ficha[k] !== undefined).map((k) => [k, ficha[k]]));
  const base = path.join(ruta, 'base');
  const carpeta = `tokens/importados/${slug(ficha.nombre, 'personaje')}`;
  const copias = [];
  const mismoArchivo = (f, datos) => { try { return fs.statSync(f).size === datos.length && fs.readFileSync(f).equals(datos); } catch { return false; } };
  for (const k of CAMPOS_IMAGEN) {
    const r = ficha[k];
    if (typeof r !== 'string' || !r) { if (k === 'imagen_propia') delete ficha[k]; else ficha[k] = ''; continue; }
    const rel = paquete.rutaArchivo(`base/${r}`) || paquete.rutaArchivo(`base/otros/${r}`);
    const entrada = rel && entradas.find((e) => e.nombre === `archivos/${rel}` && !e.carpeta);
    const enCampana = rel && path.join(base, ...rel.split('/'));
    if (!entrada) { ficha[k] = rel && fs.existsSync(enCampana) ? rel : ''; continue; }      // sin la imagen en el archivo: solo vale si la campaña ya la tiene
    const datos = entrada.leer();
    if (mismoArchivo(enCampana, datos)) { ficha[k] = rel; continue; }                        // la campaña ya tiene esa misma imagen (del .zip del GM)
    const ya = copias.find((c) => c.datos.equals(datos));
    if (ya) { ficha[k] = ya.rel; continue; }                                                 // la misma imagen en dos campos: una sola copia
    const ext = path.extname(rel).toLowerCase();
    const raiz = slug(path.basename(rel, ext), 'imagen');
    const destino = (x) => path.join(base, ...carpeta.split('/'), `${x}${ext}`);
    // Al reimportar el mismo personaje, una imagen idéntica que ya se copió antes se reutiliza en vez de duplicarse.
    let nombre = raiz;
    for (let i = 2; fs.existsSync(destino(nombre)) && !mismoArchivo(destino(nombre), datos); i++) nombre = `${raiz}_${i}`;
    while (copias.some((c) => c.rel === `${carpeta}/${nombre}${ext}`)) nombre = `${nombre}_b`;
    copias.push({ rel: `${carpeta}/${nombre}${ext}`, datos, existe: fs.existsSync(destino(nombre)) });
    ficha[k] = `${carpeta}/${nombre}${ext}`;
  }
  let guardada;
  try { guardada = jugadores.guardarFicha(n, usuario, ficha, conCampana(n), { extras, equipados: [...equipados], reemplazar: modo === 'reemplazar' }); }
  catch (e) { error(/abierto|cuenta|ya tiene/.test(e.message) ? e.message : `Este personaje no encaja con la campaña: ${e.message} (¿es de otra campaña?)`); }
  for (const c of copias) {
    if (c.existe) continue;
    const f = path.join(base, ...c.rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, c.datos);
  }
  return { nombre: guardada.nombre, imagenes: copias.filter((c) => !c.existe).length, reemplazada: modo === 'reemplazar' && !!igual, campana: typeof obj.campana === 'string' ? obj.campana.slice(0, 60) : '' };
}
// El archivo elegido se recuerda para la segunda llamada (cuando hubo conflicto de nombre y el GM eligió qué hacer):
// la ventana nunca envía rutas de disco, solo el modo.
let personajePendiente = null;
async function importarPersonaje(ventana, n, usuario, modo) {
  rutaCampana(n);
  let archivo;
  if (modo) {
    if (!personajePendiente || personajePendiente.n !== n || personajePendiente.usuario !== usuario) error('Vuelve a elegir el archivo del personaje.');
    archivo = personajePendiente.archivo;
  } else {
    const r = await dialog.showOpenDialog(ventana, { title: `Importar un personaje para ${usuario}`, properties: ['openFile'], filters: [{ name: 'Personaje de Campaigns and Dragons Online', extensions: ['mesa-personaje'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    archivo = r.filePaths[0];
  }
  personajePendiente = null;
  const res = importarPersonajeDesde(n, usuario, archivo, modo || undefined);
  if (res.conflicto) personajePendiente = { n, usuario, archivo };
  return res;
}
const conCampana = (n) => { rutaCampana(n); return cargarCampana(n); };
const servidor = require('./servidor').crear({ raiz: RAIZ_SERVIDOR, rutaCampana, dirDatos, encontrarPython, encontrarPythonBase, olvidarPython, servidorAbierto: (n) => jugadores.servidorAbierto(n) });
// Lo que escribe en la campaña (o en sus archivos): si su servidor está abierto, hay que reiniciarlo para que lo lea. Nombre → qué argumento es la campaña (-1: la abierta, no se sabe)
const ESCRIBEN = { guardarRecurso: 0, renombrarRecurso: 0, borrarRecurso: 0, guardarConfig: 0, guardarSonidos: 0, guardarOrden: 0, restaurarRecursoPapelera: 0, importar: -1, crearCarpetaAssets: -1, importarCampana: -1 };

function registrar(obtenerVentana) {
  const api = {
    exportarCampana: async (n) => exportarCampana(obtenerVentana(), n),
    importarCampana: async (modo) => importarCampana(obtenerVentana(), typeof modo === 'string' ? modo : undefined),
    jugadores: async (n) => { rutaCampana(n); return jugadores.listar(n); },
    crearCuenta: async (n, u, pw) => { rutaCampana(n); return jugadores.crearCuenta(n, u, pw || ''); },
    fijarPassword: async (n, u, pw) => { rutaCampana(n); return jugadores.fijarPassword(n, u, pw || ''); },
    fijarAtaque: async (n, u, modo) => { rutaCampana(n); return jugadores.fijarAtaque(n, u, modo || ''); },
    fijarBloqueo: async (n, u, clave, permitido) => { rutaCampana(n); return jugadores.fijarBloqueo(n, u, clave, permitido); },
    borrarCuenta: async (n, u) => { rutaCampana(n); return jugadores.borrarCuenta(n, u); },
    guardarFicha: async (n, u, f) => jugadores.guardarFicha(n, u, f, conCampana(n)),
    borrarFicha: async (n, u, fid) => { rutaCampana(n); return jugadores.borrarFicha(n, u, fid); },
    importarPersonaje: async (n, u, modo) => importarPersonaje(obtenerVentana(), n, String(u ?? ''), typeof modo === 'string' ? modo : undefined),
    info: async () => ({ campanas: CARPETA_CAMPANAS, python: !!(await encontrarPython()), ...servidor.entorno() }),
    campanas: async () => listarCampanas(),
    cargar: async (n) => cargarCampana(n),
    crearCampana: async (nombre, plantilla) => crearCampana(nombre, plantilla),
    duplicarCampana: async (o, nombre) => duplicarCampana(o, nombre),
    borrarCampana: async (n) => { aPapelera(rutaCampana(n), n); return true; },
    papelera: async (n) => listarPapelera(n || null),
    restaurarRecursoPapelera: async (n, nombre) => restaurarRecurso(n, nombre),
    restaurarCampanaPapelera: async (nombre) => restaurarCampana(nombre),
    borrarDePapelera: async (n, ambito, nombre) => borrarDePapelera(n, ambito, nombre),
    vaciarPapelera: async (n, ambito) => vaciarPapelera(n, ambito),
    guardarRecurso: async (n, cat, id, datos) => {
      if (!esObjeto(datos)) error('Datos no válidos');
      const r = rutaRecurso(n, cat, id);
      const nuevo = !fs.existsSync(r);
      escribirYaml(r, datos);
      if (nuevo) apuntarCreado(rutaCampana(n), CARPETAS[cat], id);       // para «Orden de creación»
      return true;
    },
    // Recurso recién creado que pasa a llamarse como su nombre (habilidad_nueva.yaml → bola_de_fuego.yaml): se mueve, sin papelera
    renombrarRecurso: async (n, cat, viejo, nuevo, datos) => {
      if (!esObjeto(datos)) error('Datos no válidos');
      const a = rutaRecurso(n, cat, viejo), b = rutaRecurso(n, cat, nuevo);
      if (fs.existsSync(b)) error('Ya existe un recurso con ese identificador');
      if (fs.existsSync(a)) fs.renameSync(a, b);
      escribirYaml(b, datos);
      renombrarEnMeta(rutaCampana(n), CARPETAS[cat], viejo, nuevo);       // conserva su sitio en las listas
      return true;
    },
    borrarRecurso: async (n, cat, id) => {
      const r = rutaRecurso(n, cat, id);
      if (!fs.existsSync(r)) return true;
      const papelera = path.join(rutaCampana(n), '_papelera');
      fs.mkdirSync(papelera, { recursive: true });
      fs.renameSync(r, path.join(papelera, `${CARPETAS[cat]}-${id}-${Date.now()}.yaml`));
      return true;
    },
    guardarConfig: async (n, datos) => {
      if (!esObjeto(datos)) error('Datos no válidos');
      escribirYaml(path.join(rutaCampana(n), 'config.yaml'), datos);
      return true;
    },
    guardarSonidos: async (n, datos) => guardarSonidos(n, datos),
    guardarOrden: async (n, cat, ids) => guardarOrden(n, cat, ids),
    validar: async (n) => validar(n),
    esquemaEfectos: async () => esquemaEfectos(),
    simular: async (n, peticion) => simular(n, peticion),
    hash: async (p) => hashear(p),
    importar: async (cat, sub) => importarArchivo(obtenerVentana(), cat, sub),
    assets: async () => listarAssets(),
    carpetasAssets: async () => carpetasAssets(),
    crearCarpetaAssets: async (cat, sub) => crearCarpetaAssets(cat, sub),
    cliente: async () => infoCliente(),
    elegirCliente: async () => elegirCarpetaCliente(obtenerVentana()),
    abrirBase: async () => { const b = baseCampana(true); if (!b) error('Abre una campaña primero'); return require('electron').shell.openPath(b); },
    exportarArchivos: async () => exportarArchivos(obtenerVentana()),
    abrirCarpeta: async (n) => require('electron').shell.openPath(rutaCampana(n)),
    servidorEstado: async (n) => servidor.estado(n),
    servidorIniciar: async (n) => servidor.iniciar(n),
    servidorDetener: async (n) => servidor.detener(n),
    servidorReiniciar: async (n) => servidor.reiniciar(n),
  };
  servidor.alAvisar(() => { const v = obtenerVentana(); if (v && !v.isDestroyed()) v.webContents.send('ed:servidor'); });
  for (const [k, fn] of Object.entries(api)) {
    ipcMain.handle(`ed:${k}`, async (_e, ...args) => {
      const r = await fn(...args);
      if (k in ESCRIBEN) {
        if (ESCRIBEN[k] >= 0) servidor.marcarCambio(args[ESCRIBEN[k]]);
        else for (const c of listarCampanas().map((x) => x.id)) servidor.marcarCambio(c);
      }
      return r;
    });
  }
}

module.exports = { aPapelera, listarPapelera, borrarDePapelera, vaciarPapelera, restaurarRecurso, restaurarCampana, leerMeta, uidDe, paquete, importarDesde, importarPersonajeDesde, jugadores, servidor, registrar, escribirYaml, leerYaml, slug, hashear, CARPETAS, copiarAssets, listarAssets, carpetasAssets, subcarpetaSegura, carpetaCliente };
