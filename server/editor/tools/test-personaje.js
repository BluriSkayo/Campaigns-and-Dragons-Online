// Pruebas de «Importar personaje» (Jugadores y fichas): node --test tools/test-personaje.js
// Usa el empaquetado REAL del cliente (../../client) si está junto al servidor; si no, arma el .zip a mano.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-pers-'));
fs.cpSync(path.resolve(__dirname, '..', '..', 'campanas', 'ejemplo'), path.join(tmp, 'campanas', 'ejemplo'), { recursive: true });
process.env.MESA_CAMPANAS = path.join(tmp, 'campanas'); process.env.MESA_DATOS = path.join(tmp, 'data'); process.env.MESA_EDITOR_AJUSTES = path.join(tmp, 'aj.json');
const api = require('../api');
const { crearZip } = require('../zip');
const CLIENTE = path.resolve(__dirname, '..', '..', '..', 'client', 'archivos-logica.js');

async function paquete(personaje, imagenes = {}) {
  if (fs.existsSync(CLIENTE)) {                 // el mismo código que usa el botón «Exportar personaje» del cliente
    const { Almacen } = require(CLIENTE);
    const a = new Almacen(path.join(tmp, 'cliente', 'base')); await a.iniciar();
    for (const [r, d] of Object.entries(imagenes)) { const f = path.join(a.base, ...r.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); }
    return (await a.paquetePersonaje({ personaje, usuario: 'Ana' })).zip;
  }
  return crearZip([{ nombre: 'personaje.json', datos: Buffer.from(JSON.stringify({ formato: 'mesa-de-rol/personaje', version: 1, personaje })) },
    ...Object.entries(imagenes).map(([r, d]) => ({ nombre: `archivos/${r}`, datos: Buffer.from(d) }))]);
}
const ficha = (extra = {}) => ({ id: 'abc', nombre: 'Thor', elecciones: { raza: 'humano', clase: 'guerrero' }, stats: { Fuerza: 14 }, recursos: { HP: { actual: 80, max: 100 } },
  habilidades: ['ataque_basico'], inventario: [{ objeto: 'pocion', cantidad: 2 }], dinero: 15, nivel: 3, historia: 'Un guerrero.', ...extra });
const escribir = (nombre, buf) => { const f = path.join(tmp, nombre); fs.writeFileSync(f, buf); return f; };

test('un personaje exportado se importa como ficha nueva, con sus imágenes', async () => {
  api.jugadores.crearCuenta('ejemplo', 'Ana', '');
  const f = escribir('thor.mesa-personaje', await paquete(ficha({ imagen: 'tokens/jugadores/thor.png', imagen_biografia: 'tokens/retrato thor.png' }),
    { 'tokens/jugadores/thor.png': 'PNG-THOR', 'tokens/retrato thor.png': 'PNG-RETRATO' }));
  const r = api.importarPersonajeDesde('ejemplo', 'Ana', f);
  assert.equal(r.nombre, 'Thor'); assert.equal(r.imagenes, 2);
  const fichas = api.jugadores.listar('ejemplo').usuarios.find((u) => u.usuario === 'Ana').fichas;
  const t = fichas.find((x) => x.nombre === 'Thor');
  assert.ok(t && t.id !== 'abc', 'ficha nueva, con id propio');
  assert.equal(t.nivel, 3); assert.equal(t.dinero, 15); assert.deepEqual(t.inventario, [{ objeto: 'pocion', cantidad: 2 }]);
  assert.match(t.imagen, /^tokens\/importados\/thor\//);
  const base = path.join(tmp, 'campanas', 'ejemplo', 'base');
  assert.equal(fs.readFileSync(path.join(base, ...t.imagen.split('/')), 'utf8'), 'PNG-THOR');
  assert.equal(fs.readFileSync(path.join(base, ...t.imagen_biografia.split('/')), 'utf8'), 'PNG-RETRATO');
  // Otra vez, mismo nombre, sin decir qué hacer → no se toca nada y se avisa del conflicto
  assert.deepEqual(api.importarPersonajeDesde('ejemplo', 'Ana', f), { conflicto: { nombre: 'Thor' } });
  assert.equal(api.jugadores.listar('ejemplo').usuarios.find((u) => u.usuario === 'Ana').fichas.length, 1);
});

test('reimportar un personaje que ya existe: actualizar (todos los datos e imágenes) o importar como copia', async () => {
  const fichas = () => api.jugadores.listar('ejemplo').usuarios.find((u) => u.usuario === 'Ana').fichas;
  const antes = fichas().find((x) => x.nombre === 'Thor');
  const f = escribir('thor2.mesa-personaje', await paquete(ficha({ nivel: 5, dinero: 99, historia: 'Volvió.', personalidad: ['Valiente'],
    propias: { habilidades: [{ nombre: 'Rugido', descripcion: 'Asusta' }], objetos: [] },
    inventario: [{ objeto: 'pocion', cantidad: 4, equipado: true }],
    imagen: 'tokens/jugadores/thor.png', imagen_propia: 'tokens/thor humano.png' }),
  { 'tokens/jugadores/thor.png': 'PNG-THOR-NUEVO', 'tokens/thor humano.png': 'PNG-HUMANO' }));
  const r = api.importarPersonajeDesde('ejemplo', 'Ana', f, 'reemplazar');
  assert.equal(r.reemplazada, true); assert.equal(r.imagenes, 2);
  const t = fichas().filter((x) => x.nombre === 'Thor');
  assert.equal(t.length, 1, 'sigue habiendo una sola ficha');
  assert.equal(t[0].id, antes.id, 'conserva el id: la partida la sigue reconociendo');
  assert.equal(t[0].nivel, 5); assert.equal(t[0].dinero, 99); assert.equal(t[0].historia, 'Volvió.');
  assert.deepEqual(t[0].personalidad, ['Valiente']); assert.equal(t[0].propias.habilidades[0].nombre, 'Rugido');
  assert.deepEqual(t[0].inventario, [{ objeto: 'pocion', cantidad: 4, equipado: true }]);
  assert.equal(t[0].imagen_biografia, '', 'el archivo nuevo no trae retrato: se sustituye entera');
  const base = path.join(tmp, 'campanas', 'ejemplo', 'base');
  assert.equal(fs.readFileSync(path.join(base, ...t[0].imagen.split('/')), 'utf8'), 'PNG-THOR-NUEVO');
  assert.equal(fs.readFileSync(path.join(base, ...t[0].imagen_propia.split('/')), 'utf8'), 'PNG-HUMANO');
  // La misma importación otra vez no duplica imágenes
  const r2 = api.importarPersonajeDesde('ejemplo', 'Ana', f, 'reemplazar');
  assert.equal(r2.imagenes, 0);
  assert.equal(fichas().find((x) => x.nombre === 'Thor').imagen, t[0].imagen);
  // Como copia: ficha aparte con otro nombre
  const c = api.importarPersonajeDesde('ejemplo', 'Ana', f, 'copia');
  assert.equal(c.nombre, 'Thor (2)');
  assert.deepEqual(fichas().map((x) => x.nombre).sort(), ['Thor', 'Thor (2)']);
  assert.throws(() => api.importarPersonajeDesde('ejemplo', 'Ana', f, 'pisar'), /Modo/);
});

test('un personaje de otra campaña no se importa (ni deja imágenes sueltas)', async () => {
  const f = escribir('otro.mesa-personaje', await paquete(ficha({ nombre: 'Ajeno', stats: { Carisma: 9 }, imagen: 'tokens/ajeno.png' }), { 'tokens/ajeno.png': 'X' }));
  assert.throws(() => api.importarPersonajeDesde('ejemplo', 'Ana', f), /no encaja con la campaña: La estadística «Carisma» no existe/);
  assert.ok(!fs.existsSync(path.join(tmp, 'campanas', 'ejemplo', 'base', 'tokens', 'importados', 'ajeno')));
});

test('archivos que no son personajes, o con rutas hostiles', async () => {
  assert.throws(() => api.importarPersonajeDesde('ejemplo', 'Ana', escribir('a.mesa-personaje', Buffer.from('{"x":1}'))), /no es un personaje/);
  assert.throws(() => api.importarPersonajeDesde('ejemplo', 'Ana', escribir('b.mesa-personaje', crearZip([{ nombre: 'otra.json', datos: Buffer.from('{}') }]))), /no es un personaje/);
  const hostil = crearZip([{ nombre: 'personaje.json', datos: Buffer.from(JSON.stringify({ formato: 'mesa-de-rol/personaje', version: 1, personaje: ficha({ nombre: 'Hostil', imagen: '../../fuera.png' }) })) },
    { nombre: 'archivos/../../fuera.png', datos: Buffer.from('X') }]);
  const r = api.importarPersonajeDesde('ejemplo', 'Ana', escribir('c.mesa-personaje', hostil));
  assert.equal(r.imagenes, 0);
  assert.ok(!fs.existsSync(path.join(tmp, 'fuera.png')) && !fs.existsSync(path.join(tmp, 'campanas', 'fuera.png')));
  const nueva = crearZip([{ nombre: 'personaje.json', datos: Buffer.from(JSON.stringify({ formato: 'mesa-de-rol/personaje', version: 9, personaje: ficha() })) }]);
  assert.throws(() => api.importarPersonajeDesde('ejemplo', 'Ana', escribir('d.mesa-personaje', nueva)), /versión más nueva/);
  const sinCuenta = escribir('e.mesa-personaje', await paquete(ficha({ nombre: 'Sin cuenta' })));
  assert.throws(() => api.importarPersonajeDesde('ejemplo', 'Nadie', sinCuenta), /cuenta/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
