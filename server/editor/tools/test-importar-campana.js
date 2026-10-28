// Pruebas de «Importar una campaña» cuando ya existe (reemplazar o copia): node --test tools/test-importar-campana.js
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-imp-'));
const CAMP = path.join(tmp, 'campanas'), DATOS = path.join(tmp, 'data');
fs.cpSync(path.resolve(__dirname, '..', '..', 'campanas', 'ejemplo'), path.join(CAMP, 'mesa'), { recursive: true });
process.env.MESA_CAMPANAS = CAMP; process.env.MESA_DATOS = DATOS; process.env.MESA_EDITOR_AJUSTES = path.join(tmp, 'aj.json');
const api = require('../api');
const YAML = require('yaml');
const ruta = (id) => path.join(CAMP, id);
const leer = (id, rel) => fs.readFileSync(path.join(ruta(id), rel), 'utf8');
const ids = () => fs.readdirSync(CAMP).filter((d) => !d.startsWith('_')).sort();
/** Exporta la campaña como lo hace «Exportar esta campaña…» (con su uid). */
function exportar(id, quitarUid = false) {
  if (!quitarUid) api.uidDe(ruta(id));
  const base = path.join(ruta(id), 'base');
  const todos = [];
  (function rec(d, rel) { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d)) { const f = path.join(d, n), r = rel ? `${rel}/${n}` : n; if (fs.statSync(f).isDirectory()) rec(f, r); else todos.push(r); } })(base, '');
  const { zip } = api.paquete.empaquetarZip(ruta(id), id, () => todos);
  const f = path.join(tmp, `${id}-${Date.now()}-${Math.random()}.mesa-campana`);
  fs.writeFileSync(f, zip);
  return f;
}

test('importar una campaña que ya tienes: avisa sin tocar nada', () => {
  const f = exportar('mesa');
  const r = api.importarDesde(f);
  assert.ok(r.conflicto, 'avisa del conflicto');
  assert.equal(r.conflicto.id, 'mesa'); assert.equal(r.conflicto.porUid, true);
  assert.equal(r.conflicto.ahora.mapas, 2); assert.equal(r.conflicto.archivo.mapas, 2);
  assert.deepEqual(ids(), ['mesa'], 'no se crea nada');
});

test('como copia: otra campaña con otro identificador, sin tocar la tuya', () => {
  const f = exportar('mesa');
  const r = api.importarDesde(f, 'copia');
  assert.notEqual(r.id, 'mesa');
  assert.deepEqual(ids(), ['mesa', r.id].sort());
  assert.notEqual(api.leerMeta(ruta(r.id)).uid, api.leerMeta(ruta('mesa')).uid, 'la copia es otra campaña');
  fs.rmSync(ruta(r.id), { recursive: true });
});

test('reemplazar: pone la del archivo y conserva carpeta, partida, contraseñas, dirección y uid', () => {
  const f = exportar('mesa');                                   // el archivo: la campaña tal como estaba
  const uid = api.leerMeta(ruta('mesa')).uid;
  // En esta instalación: contraseñas y puerto propios, una partida guardada y un mapa nuevo que el archivo no trae
  const cfg = YAML.parseDocument(leer('mesa', 'config.yaml'));
  cfg.setIn(['servidor', 'password_gm'], 'scrypt$secreto'); cfg.setIn(['servidor', 'puerto'], 9999); cfg.setIn(['juego', 'max_mensajes_chat'], 777);
  fs.writeFileSync(path.join(ruta('mesa'), 'config.yaml'), String(cfg));
  fs.copyFileSync(path.join(ruta('mesa'), 'maps', 'taberna.yaml'), path.join(ruta('mesa'), 'maps', 'cueva.yaml'));
  fs.mkdirSync(path.join(DATOS, 'mesa', 'jugadores'), { recursive: true });
  fs.writeFileSync(path.join(DATOS, 'mesa', 'estado.yaml'), 'mapa: aldea\n');
  const c = api.importarDesde(f).conflicto;
  assert.deepEqual(c.mapasQueSeQuitan, ['Taberna'], 'avisa del mapa que el archivo no trae (cueva se llama Taberna)');
  assert.equal(c.hayPartida, true);
  const r = api.importarDesde(f, 'reemplazar');
  assert.equal(r.id, 'mesa'); assert.equal(r.reemplazada, true);
  assert.deepEqual(ids(), ['mesa'], 'sigue siendo la misma carpeta');
  const nueva = YAML.parse(leer('mesa', 'config.yaml'));
  assert.equal(nueva.juego.max_mensajes_chat, 100, 'las reglas son las del archivo');
  assert.equal(nueva.servidor.password_gm, 'scrypt$secreto', 'se conserva la contraseña de GM');
  assert.equal(nueva.servidor.puerto, 9999, 'y la dirección del servidor');
  assert.ok(!fs.existsSync(path.join(ruta('mesa'), 'maps', 'cueva.yaml')));
  assert.equal(api.leerMeta(ruta('mesa')).uid, uid, 'mismo uid');
  assert.equal(fs.readFileSync(path.join(DATOS, 'mesa', 'estado.yaml'), 'utf8'), 'mapa: aldea\n', 'la partida guardada sigue ahí');
  const pap = path.join(CAMP, r.papelera);
  assert.ok(fs.existsSync(path.join(pap, 'maps', 'cueva.yaml')), 'la versión anterior entera está en la papelera');
});

test('sin uid (archivo de una versión anterior) se reconoce por el nombre', () => {
  const f = exportar('mesa');
  const z = require('../zip-lector').leerZip(fs.readFileSync(f));
  const obj = JSON.parse(z.find((e) => e.nombre === 'campana.json').leer().toString());
  delete obj.uid; delete obj.archivos['campana.yaml'];
  const viejo = path.join(tmp, 'viejo.mesa-campana'); fs.writeFileSync(viejo, JSON.stringify(obj));
  const c = api.importarDesde(viejo).conflicto;
  assert.equal(c.id, 'mesa'); assert.equal(c.porUid, false);
});

test('con el servidor abierto no se reemplaza (ni se toca nada)', () => {
  const f = exportar('mesa');
  fs.writeFileSync(path.join(DATOS, 'mesa', 'servidor.pid'), String(process.pid));
  try {
    assert.equal(api.importarDesde(f).conflicto.servidorAbierto, true);
    assert.throws(() => api.importarDesde(f, 'reemplazar'), /servidor de esa campaña está abierto/);
    assert.deepEqual(ids(), ['mesa']);
    assert.ok(!fs.readdirSync(CAMP).some((d) => d.startsWith('_importando')));
  } finally { fs.rmSync(path.join(DATOS, 'mesa', 'servidor.pid')); }
});

test('un archivo dañado no toca la campaña que tienes', () => {
  const f = exportar('mesa');
  const z = require('../zip-lector').leerZip(fs.readFileSync(f));
  const obj = JSON.parse(z.find((e) => e.nombre === 'campana.json').leer().toString());
  obj.archivos['maps/aldea.yaml'] = 'nombre: [sin cerrar';
  const roto = path.join(tmp, 'roto.mesa-campana'); fs.writeFileSync(roto, JSON.stringify(obj));
  const antes = leer('mesa', 'maps/aldea.yaml');
  assert.throws(() => api.importarDesde(roto, 'reemplazar'), /no es un YAML válido/);
  assert.equal(leer('mesa', 'maps/aldea.yaml'), antes);
  assert.ok(!fs.readdirSync(CAMP).some((d) => d.startsWith('_importando')));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
