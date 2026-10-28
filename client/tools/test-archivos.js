// Pruebas de la carpeta de archivos del cliente. Ejecutar con:  node --test tools/test-archivos.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Almacen, normalizarRuta, rutaLocal, categoriaDe } = require('../archivos-logica');

async function conAlmacen(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-'));
  const a = new Almacen(path.join(dir, 'base'));
  await a.iniciar();
  try { await fn(a, dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('normalizarRuta acepta rutas normales', () => {
  for (const r of ['tokens/orco.png', 'sonido/musica/Batalla final.ogg', 'maps/aldea.jpg', 'icons/espada.webp']) assert.equal(normalizarRuta(r), r);
});
test('normalizarRuta rechaza rutas peligrosas', () => {
  for (const r of ['../x.png', '/etc/x.png', 'a/../b.png', 'a\\b.png', 'tokens/con.png', 'tokens/x.exe', 'tokens/', '', 'a//b.png', 'tokens/x.png.', 'c:/x.png', null, 5]) assert.equal(normalizarRuta(r), null, String(r));
});
test('organización: base/tokens, maps, icons, tiles, sonido/{musica,ambiente,efectos} y otros', () => {
  assert.equal(rutaLocal('tokens/a.png'), 'tokens/a.png');
  assert.equal(rutaLocal('icons/a.png'), 'icons/a.png');
  assert.equal(rutaLocal('raro/a.png'), 'otros/raro/a.png');
  // Regresión: el Editor guarda las imágenes de la carpeta «otros» (objetos del mapa, diario) como «otros/barril.png»; no debe quedar en otros/otros/
  assert.equal(rutaLocal('otros/barril.png'), 'otros/barril.png');
  assert.equal(rutaLocal('barril.png'), 'otros/barril.png');          // rutas antiguas sin carpeta: siguen valiendo
  assert.equal(categoriaDe('otros/barril.png'), 'otros');
  assert.equal(rutaLocal('sonido/musica/a.ogg'), 'sonido/musica/a.ogg');
  assert.equal(categoriaDe('sonido/ambiente/a.ogg'), 'sonido');
  assert.equal(categoriaDe('x/a.ogg'), 'otros');
});
test('crea la estructura de carpetas', () => conAlmacen(async (a) => {
  for (const c of ['tokens', 'maps', 'icons', 'tiles', 'sonido/musica', 'sonido/ambiente', 'sonido/efectos', 'otros']) assert.ok(fs.statSync(path.join(a.base, c)).isDirectory(), c);
}));
test('listar devuelve solo imágenes y audio, ordenados', () => conAlmacen(async (a) => {
  fs.writeFileSync(path.join(a.base, 'tokens', 'b.png'), 'x');
  fs.writeFileSync(path.join(a.base, 'tokens', 'a.png'), 'x');
  fs.writeFileSync(path.join(a.base, 'tokens', 'nota.txt'), 'x');
  fs.mkdirSync(path.join(a.base, 'tokens', 'carpeta.png'));
  assert.deepEqual(await a.listar('tokens'), ['a.png', 'b.png']);
  assert.deepEqual(await a.listar('../..'), []);
}));
test('uso cuenta archivos y bytes', () => conAlmacen(async (a) => {
  fs.writeFileSync(path.join(a.base, 'sonido', 'musica', 'a.ogg'), '12345');
  const u = await a.uso();
  assert.deepEqual(u.categorias['sonido/musica'], { archivos: 1, bytes: 5 });
  assert.deepEqual(u.categorias.tokens, { archivos: 0, bytes: 0 });
}));

test('importarImagen copia a tokens, no pisa y rechaza lo que no es imagen', () => conAlmacen(async (a, dir) => {
  const o = path.join(dir, 'Mi héroe.png'); fs.writeFileSync(o, 'x');
  assert.equal(await a.importarImagen('tokens', o), 'Mi héroe.png');
  assert.equal(await a.importarImagen('tokens', o), 'Mi héroe-2.png');
  const mala = path.join(dir, 'virus.exe'); fs.writeFileSync(mala, 'x');
  await assert.rejects(a.importarImagen('tokens', mala), /imágenes/);
  await assert.rejects(a.importarImagen('sonido/musica', o), /no permitida/);
  assert.deepEqual(await a.listar('tokens'), ['Mi héroe-2.png', 'Mi héroe.png']);
}));

// ── Archivos por campaña: el .zip que prepara el GM ──
const { crearZip } = require('../../server/editor/zip');
const zipDe = (archivos) => crearZip(Object.entries(archivos).map(([nombre, d]) => ({ nombre, datos: Buffer.from(d) })));

test('importar el .zip de una campaña (del Editor) y buscar primero en su carpeta', () => conAlmacen(async (a) => {
  const z = zipDe({ 'mesa-campana.json': JSON.stringify({ campana: 'aldea', nombre: 'La Aldea' }), 'tokens/criaturas/lobo.png': 'L', 'sonido/musica/tema.mp3': 'M' });
  const r = await a.importarZip(z, '');
  assert.deepEqual([r.campana, r.nombre, r.copiados], ['aldea', 'La Aldea', 2]);
  assert.ok(fs.existsSync(path.join(a.base, 'campanas', 'aldea', 'tokens', 'criaturas', 'lobo.png')));
  await a.usarCampana('aldea');
  assert.ok(a.indice.has('tokens/criaturas/lobo.png'));
  assert.deepEqual(await a.listar('sonido/musica'), ['tema.mp3']);
  await assert.rejects(a.importarZip(z, 'otra'), /no de la del servidor/);        // el .zip es de otra campaña
  await a.usarCampana('../fuera');
  assert.equal(a.campana, '');                                                     // un id raro no se usa
}));

test('un .zip hecho a mano (con una carpeta que lo envuelve) y entradas peligrosas', () => conAlmacen(async (a) => {
  const z = zipDe({ 'Mi campaña/tokens/orco.png': 'O', 'Mi campaña/maps/aldea.jpg': 'A', 'Mi campaña/leeme.txt': 'x', 'Mi campaña/../../malo.png': 'X', 'Mi campaña/tokens/virus.exe': 'V' });
  await assert.rejects(a.importarZip(z, ''), /conéctate antes/);                 // sin manifiesto ni conexión no se sabe de qué campaña es
  const r = await a.importarZip(z, 'aldea');
  assert.equal(r.copiados, 2);
  assert.equal(r.omitidos, 3);
  assert.ok(!fs.existsSync(path.join(a.base, 'malo.png')) && !fs.existsSync(path.join(a.base, '..', 'malo.png')));
  await assert.rejects(a.importarZip(Buffer.from('no es un zip'), 'aldea'), /no es un .zip/);
  await assert.rejects(a.importarZip(zipDe({ 'leeme.txt': 'x' }), 'aldea'), /no trae imágenes/);
}));
test('listar entra en las subcarpetas de imágenes (así las guarda el Editor), y en sonidos no', () => conAlmacen(async (a) => {
  fs.mkdirSync(path.join(a.base, 'tokens', 'jugadores', 'criaturas'), { recursive: true });
  fs.writeFileSync(path.join(a.base, 'tokens', 'jugadores', 'ana.png'), 'x');
  fs.writeFileSync(path.join(a.base, 'tokens', 'jugadores', 'criaturas', 'lobo.png'), 'x');
  fs.writeFileSync(path.join(a.base, 'tokens', 'suelto.png'), 'x');
  fs.writeFileSync(path.join(a.base, 'tokens', 'jugadores', 'tema.ogg'), 'x');
  assert.deepEqual(await a.listar('tokens'), ['jugadores/ana.png', 'jugadores/criaturas/lobo.png', 'suelto.png']);
  fs.mkdirSync(path.join(a.base, 'sonido', 'musica', 'sub'));
  fs.writeFileSync(path.join(a.base, 'sonido', 'musica', 'sub', 'x.ogg'), 'x');
  assert.deepEqual(await a.listar('sonido/musica'), []);
}));

test('exportar personaje: ficha + sus imágenes (de la campaña o propias), sin salir de la carpeta', () => conAlmacen(async (a) => {
  const { leerZip } = require('../zip-lector');
  fs.mkdirSync(path.join(a.base, 'campanas', 'prueba', 'tokens', 'jugadores'), { recursive: true });
  fs.writeFileSync(path.join(a.base, 'campanas', 'prueba', 'tokens', 'jugadores', 'lobo.png'), 'LOBO');
  fs.writeFileSync(path.join(a.base, 'tokens', 'retrato.png'), 'RETRATO');
  await a.usarCampana('prueba');
  const p = { id: 'x1', nombre: 'Lobo', imagen: 'tokens/jugadores/lobo.png', imagen_biografia: 'tokens/retrato.png', imagen_propia: '../../secreto.png', stats: { Poder: 30 } };
  const { zip, archivos } = await a.paquetePersonaje({ personaje: p, servidor: 'Mesa', usuario: 'Ana' });
  assert.equal(archivos, 2);
  const e = leerZip(zip);
  const json = JSON.parse(e.find((x) => x.nombre === 'personaje.json').leer().toString());
  assert.equal(json.formato, 'mesa-de-rol/personaje'); assert.equal(json.campana, 'prueba'); assert.equal(json.personaje.stats.Poder, 30);
  assert.equal(e.find((x) => x.nombre === 'archivos/tokens/jugadores/lobo.png').leer().toString(), 'LOBO');
  assert.equal(e.find((x) => x.nombre === 'archivos/tokens/retrato.png').leer().toString(), 'RETRATO');
  assert.ok(!e.some((x) => x.nombre.includes('secreto')));
  for (const malo of ['../x.png', 'tokens/../../x.png', '/etc/passwd', 'tokens/x.exe', 'tokens/con.png', 5]) assert.equal(await a.leerImagen(malo), null, String(malo));
  await assert.rejects(() => a.paquetePersonaje({}), /no válida/);
}));
