// Pruebas de api.js sin abrir ventana: node --test tools/test-api.js
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { escribirYaml, leerYaml, slug, hashear } = require('../api');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));

test('slug quita tildes y símbolos', () => { assert.equal(slug('Bola de Fuego'), 'bola_de_fuego'); assert.equal(slug('¡Ñandú!'), 'nandu'); assert.equal(slug('', 'x'), 'x'); });
test('escribir conserva los comentarios de lo que no cambia', () => {
  const f = path.join(tmp(), 'a.yaml');
  fs.writeFileSync(f, '# cabecera\nnombre: Hola  # comentario\ncosto: 3\n');
  const d = leerYaml(f); d.costo = 5;
  escribirYaml(f, d);
  const t = fs.readFileSync(f, 'utf8');
  assert.match(t, /# cabecera/); assert.match(t, /# comentario/); assert.match(t, /costo: 5/);
});
test('ida y vuelta mantiene los datos', () => {
  const f = path.join(tmp(), 'b.yaml'); const d = { nombre: 'Ñ', lista: [1, 2], mapa: { a: 'x' } };
  escribirYaml(f, d); assert.deepEqual(leerYaml(f), d);
});
test('hash de contraseña tiene el formato del servidor', async () => { const h = await hashear('secreto'); assert.match(h, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/); });

test('importar copia a base/<categoría> con nombre limpio, sin pisar y sin duplicar', () => {
  const { copiarAssets } = require('../api');
  const d = tmp(); const base = path.join(d, 'base');
  const a = path.join(d, 'Mi Dragón!.PNG'); fs.writeFileSync(a, 'x');
  const r1 = copiarAssets([a, path.join(d, 'virus.exe')], 'tokens', base);
  const r2 = copiarAssets([a], 'tokens', base);
  assert.deepEqual(r1, ['tokens/mi_dragon.png']); assert.deepEqual(r2, ['tokens/mi_dragon.png']);     // la misma imagen: se reutiliza
  const b = path.join(d, 'otra', 'Mi Dragón!.png'); fs.mkdirSync(path.dirname(b)); fs.writeFileSync(b, 'y');
  assert.deepEqual(copiarAssets([b], 'tokens', base), ['tokens/mi_dragon_2.png']);                 // mismo nombre, otra imagen: no se pisa
  const c = path.join(d, 'copia.png'); fs.writeFileSync(c, 'x');
  assert.deepEqual(copiarAssets([c], 'tokens', base), ['tokens/mi_dragon.png']);                   // otro nombre, misma imagen: no se duplica
  assert.deepEqual(fs.readdirSync(path.join(base, 'tokens')).sort(), ['mi_dragon.png', 'mi_dragon_2.png']);
});

test('imágenes en subcarpetas: listar, importar en una carpeta y no duplicar entre carpetas', () => {
  const { copiarAssets, subcarpetaSegura } = require('../api');
  const d = tmp(); const base = path.join(d, 'base');
  const a = path.join(d, 'Lobo.png'); fs.writeFileSync(a, 'lobo');
  assert.deepEqual(copiarAssets([a], 'tokens', base, 'criaturas'), ['tokens/criaturas/lobo.png']);
  assert.deepEqual(copiarAssets([a], 'tokens', base, 'otra'), ['tokens/criaturas/lobo.png']);       // ya estaba en otra carpeta: se reutiliza
  assert.equal(subcarpetaSegura('Criaturas / No Muertos'), 'criaturas/no_muertos');
  assert.equal(subcarpetaSegura(''), '');
  for (const malo of ['../fuera', 'a/b/c', 5]) {
    if (malo === '../fuera') assert.equal(subcarpetaSegura(malo), 'carpeta/fuera');          // «..» se limpia: nunca sale de la categoría
    else assert.throws(() => subcarpetaSegura(malo));
  }
});

test('cuentas y fichas: crear, validar, guardar y respetar al servidor abierto', () => {
  const { crear } = require('../jugadores');
  const datos = tmp();
  const J = crear({ dirDatos: () => datos, hashear });
  const camp = {
    config: { juego: { recurso_vida: 'HP', estadisticas: [{ nombre: 'Fuerza', minimo: 0, maximo: 20 }], recursos: [{ nombre: 'HP' }, { nombre: 'Furia' }] } },
    recursos: { grupos: { clase: { nombre: 'Clase', obligatorio: true } }, opciones: { mago: { grupo: 'clase' } }, habilidades: { golpe: {} }, objetos: { pocion: {} } },
  };
  const ficha = { nombre: 'Thor', elecciones: { clase: 'mago' }, stats: { Fuerza: 12 }, recursos: { HP: { actual: 50, max: 100 } }, habilidades: ['golpe'], inventario: [{ objeto: 'pocion', cantidad: 2 }] };
  assert.throws(() => J.guardarFicha('c', 'Ana', ficha, camp), /crea la cuenta/);
  assert.throws(() => J.crearCuenta('c', '../x', ''), /nombre de usuario/);
  assert.equal(J.crearCuenta('c', 'Ana', 'secreto1'), 'Ana');
  assert.throws(() => J.crearCuenta('c', 'ana', ''), /Ya existe/);
  assert.match(fs.readFileSync(path.join(datos, 'cuentas.yaml'), 'utf8'), /hash: scrypt\$/);
  assert.throws(() => J.guardarFicha('c', 'ana', { ...ficha, stats: { Fuerza: 99 } }, camp), /entre 0 y 20/);
  assert.throws(() => J.guardarFicha('c', 'ana', { ...ficha, elecciones: {} }, camp), /Elige una opción de «Clase»/);
  assert.throws(() => J.guardarFicha('c', 'ana', { ...ficha, recursos: { Furia: { actual: 1, max: 1 } } }, camp), /Falta el recurso de vida/);
  const g = J.guardarFicha('c', 'ana', ficha, camp);
  assert.equal(g.dueno, 'Ana');
  assert.throws(() => J.guardarFicha('c', 'ana', { ...ficha, id: 'otra' }, camp), /ya tiene un personaje con ese nombre/);
  const l = J.listar('c');
  assert.equal(l.usuarios.length, 1); assert.equal(l.usuarios[0].fichas[0].nombre, 'Thor'); assert.equal(l.usuarios[0].tiene_password, true);
  J.guardarFicha('c', 'Ana', { ...ficha, id: g.id, nombre: 'Thor II' }, camp);               // misma id = edita
  assert.equal(J.listar('c').usuarios[0].fichas.length, 1); assert.equal(J.listar('c').usuarios[0].fichas[0].nombre, 'Thor II');
  // servidor abierto: no se toca nada
  fs.writeFileSync(path.join(datos, 'servidor.pid'), String(process.pid));
  assert.equal(J.listar('c').abierto, true);
  assert.throws(() => J.crearCuenta('c', 'Bea', ''), /servidor de esta campaña está abierto/);
  assert.throws(() => J.borrarFicha('c', 'Ana', g.id), /abierto/);
  fs.writeFileSync(path.join(datos, 'servidor.pid'), '99999999');                            // proceso que no existe = marca vieja
  assert.equal(J.listar('c').abierto, false);
  J.borrarFicha('c', 'Ana', g.id); assert.equal(J.listar('c').usuarios[0].fichas.length, 0);
  J.fijarPassword('c', 'ana', ''); assert.equal(J.listar('c').usuarios[0].tiene_password, false);
  J.borrarCuenta('c', 'ANA'); assert.equal(J.listar('c').usuarios.length, 1);               // la cuenta se va, el archivo de fichas queda (usuario sin cuenta)
});

test('exportar e importar una campaña: ida y vuelta, sin contraseñas y rechazando archivos hostiles', () => {
  const { paquete } = require('../api');
  const { execFileSync } = require('child_process');
  const origen = path.resolve(__dirname, '..', '..', 'campanas', 'ejemplo');
  const d = tmp();
  const copia = path.join(d, 'ejemplo'); fs.cpSync(origen, copia, { recursive: true });
  fs.mkdirSync(path.join(copia, '_papelera')); fs.writeFileSync(path.join(copia, '_papelera', 'x.yaml'), 'a: 1');
  const cfg = leerYaml(path.join(copia, 'config.yaml')); cfg.servidor.password_gm = 'secretisima'; escribirYaml(path.join(copia, 'config.yaml'), cfg);
  const obj = paquete.empaquetar(copia, 'ejemplo');
  assert.ok(!JSON.stringify(obj).includes('secretisima'), 'la contraseña no debe salir en el archivo');
  assert.ok(!Object.keys(obj.archivos).some((k) => k.includes('_papelera')));
  assert.ok('options/berserker.yaml' in obj.archivos && 'tiles/muro.yaml' in obj.archivos && 'config.yaml' in obj.archivos);
  const destino = path.join(d, 'nueva');
  const n = paquete.desempaquetar(JSON.parse(JSON.stringify(obj)), destino);
  assert.equal(n, Object.keys(obj.archivos).length);
  const salida = execFileSync('python3', [path.resolve(__dirname, '..', '..', 'main.py'), '--validar', '--config', destino], { encoding: 'utf8' });
  assert.match(salida, /Configuración correcta/);
  // hostil
  const mal = (cambio, re) => { const o = JSON.parse(JSON.stringify(obj)); cambio(o); assert.throws(() => paquete.comprobar(o), re); };
  mal((o) => { o.archivos['../fuera.yaml'] = 'a: 1'; }, /no es de una campaña/);
  mal((o) => { o.archivos['maps/../../x.yaml'] = 'a: 1'; }, /no es de una campaña/);
  mal((o) => { o.archivos['evil/x.yaml'] = 'a: 1'; }, /no es de una campaña/);
  mal((o) => { o.archivos['maps/Mayus.yaml'] = 'a: 1'; }, /no es de una campaña/);
  mal((o) => { o.archivos['maps/x.exe'] = 'a'; }, /no es de una campaña/);
  mal((o) => { o.archivos['maps/roto.yaml'] = 'a: [1, 2'; }, /no es un YAML válido/);
  mal((o) => { o.archivos['maps/lista.yaml'] = '- 1\n- 2'; }, /formato esperado/);
  mal((o) => { o.archivos['maps/grande.yaml'] = 'a: ' + 'x'.repeat(1024 * 1024 + 1); }, /demasiado grande/);
  mal((o) => { o.formato = 'otra-cosa'; }, /no es una campaña/);
  mal((o) => { o.version = 99; }, /versión más nueva/);
  mal((o) => { delete o.archivos['config.yaml']; }, /no incluye la configuración/);
  assert.throws(() => paquete.desempaquetar({ formato: 'x' }, path.join(d, 'z')), /no es una campaña/);
  assert.ok(!fs.existsSync(path.join(d, 'z')));
});


test('el .mesa-campana lleva las imágenes y los sonidos de la campaña y se importa con ellos', () => {
  const { paquete, importarDesde } = require('../api');
  const origen = path.resolve(__dirname, '..', '..', 'campanas', 'ejemplo');
  const d = tmp();
  const copia = path.join(d, 'ejemplo'); fs.cpSync(origen, copia, { recursive: true });
  const base = path.join(copia, 'base');
  const poner = (rel, datos) => { const f = path.join(base, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, datos); };
  poner('tokens/criaturas/lobo.png', 'PNG-lobo'); poner('maps/aldea.jpg', 'JPG'); poner('sonido/musica/Tema Feliz.ogg', 'OGG');
  poner('tokens/virus.exe', 'MZ'); poner('tokens/.oculto.png', 'x');
  const listar = () => ['tokens/criaturas/lobo.png', 'maps/aldea.jpg', 'sonido/musica/Tema Feliz.ogg', 'tokens/virus.exe', 'tokens/.oculto.png'];
  const { zip, archivos } = paquete.empaquetarZip(copia, 'ejemplo', listar);
  assert.equal(archivos, 3, 'solo imágenes y audio admisibles');
  const f = path.join(d, 'x.mesa-campana'); fs.writeFileSync(f, zip);
  const primero = importarDesde(f);
  assert.ok(primero.conflicto, 'la campaña de ejemplo ya está: avisa en vez de duplicarla sin preguntar');
  const r = importarDesde(f, 'copia');
  const nueva = path.join(path.resolve(__dirname, '..', '..', 'campanas'), r.id);
  try {
    assert.equal(r.archivos, 3);
    assert.equal(fs.readFileSync(path.join(nueva, 'base', 'tokens', 'criaturas', 'lobo.png'), 'utf8'), 'PNG-lobo');
    assert.equal(fs.readFileSync(path.join(nueva, 'base', 'sonido', 'musica', 'Tema Feliz.ogg'), 'utf8'), 'OGG');
    assert.ok(!fs.existsSync(path.join(nueva, 'base', 'tokens', 'virus.exe')));
    assert.ok(fs.existsSync(path.join(nueva, 'config.yaml')));
  } finally { fs.rmSync(nueva, { recursive: true, force: true }); }
});

test('un .mesa-campana antiguo (solo JSON) se sigue importando', () => {
  const { paquete } = require('../api');
  const origen = path.resolve(__dirname, '..', '..', 'campanas', 'ejemplo');
  const obj = { ...paquete.empaquetar(origen, 'ejemplo'), version: 1 };
  const r = paquete.leerPaquete(Buffer.from(JSON.stringify(obj)));
  assert.equal(r.archivos.length, 0); paquete.comprobar(r.obj);
  const destino = path.join(tmp(), 'vieja');
  assert.ok(paquete.desempaquetar(r.obj, destino, r.archivos) > 5);
});

test('un .mesa-campana hostil no escribe fuera de la campaña ni copia lo que no es imagen o audio', () => {
  const { paquete } = require('../api');
  const { crearZip } = require('../zip');
  const origen = path.resolve(__dirname, '..', '..', 'campanas', 'ejemplo');
  const obj = paquete.empaquetar(origen, 'ejemplo');
  for (const malo of ['base/../../fuera.png', 'base/tokens/../../x.png', '../x.png', 'base/evil/x.png', 'base/tokens/a/b/c/d.png', 'base/sonido/musica/sub/x.ogg',
    'base/sonido/musica/x.png', 'base/tokens/x.ogg', 'base/tokens/con:dos.png', 'base/tokens/_p.png', 'base/tokens/x.png.', 'config.yaml', 'base/maps/x.svg']) {
    assert.equal(paquete.rutaArchivo(malo), null, malo);
  }
  assert.equal(paquete.rutaArchivo('base/tokens/a/b/x.png'), 'tokens/a/b/x.png');
  assert.equal(paquete.rutaArchivo('base/sonido/efectos/Golpe (fuerte).wav'), 'sonido/efectos/Golpe (fuerte).wav');
  const zip = crearZip([{ nombre: 'campana.json', datos: Buffer.from(JSON.stringify(obj)) }, { nombre: 'base/../../fuera.png', datos: Buffer.from('x') },
    { nombre: 'base/tokens/ok.png', datos: Buffer.from('ok') }, { nombre: 'base/tokens/virus.exe', datos: Buffer.from('MZ') }]);
  const r = paquete.leerPaquete(zip);
  assert.deepEqual(r.archivos.map((a) => a.rel), ['tokens/ok.png']); assert.equal(r.ignorados, 2);
  assert.throws(() => paquete.leerPaquete(crearZip([{ nombre: 'otra.json', datos: Buffer.from('{}') }])), /no es una campaña/);
  assert.throws(() => paquete.leerPaquete(Buffer.concat([zip.subarray(0, 40), Buffer.alloc(30)])), /dañado/);
});
