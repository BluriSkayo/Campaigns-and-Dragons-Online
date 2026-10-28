// Pruebas de la papelera (ver, recuperar, borrar de verdad) sin abrir ventana: node --test tools/test-papelera.js
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');

const CAMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-pap-'));
process.env.MESA_CAMPANAS = CAMP;                       // antes de cargar api.js: es donde mira
const api = require('../api');

const escribir = (ruta, texto) => { fs.mkdirSync(path.dirname(ruta), { recursive: true }); fs.writeFileSync(ruta, texto); };
function campana(id, nombre, uid) {
  const r = path.join(CAMP, id);
  escribir(path.join(r, 'config.yaml'), `servidor:\n  nombre: "${nombre}"\n`);
  if (uid) escribir(path.join(r, 'campana.yaml'), `uid: ${uid}\n`);
  return r;
}
const limpiar = () => { for (const f of fs.readdirSync(CAMP)) fs.rmSync(path.join(CAMP, f), { recursive: true, force: true }); };

test('un recurso eliminado se ve en la papelera con su nombre, se recupera y vuelve a su carpeta', () => {
  limpiar(); const r = campana('c1', 'Uno');
  escribir(path.join(r, 'abilities', 'bola.yaml'), 'nombre: Bola de fuego\n');
  const pap = path.join(r, '_papelera');
  fs.mkdirSync(pap); fs.renameSync(path.join(r, 'abilities', 'bola.yaml'), path.join(pap, 'abilities-bola-1790000000000.yaml'));
  const l = api.listarPapelera('c1');
  assert.equal(l.recursos.length, 1);
  assert.deepEqual({ cat: l.recursos[0].cat, id: l.recursos[0].id, titulo: l.recursos[0].titulo }, { cat: 'habilidades', id: 'bola', titulo: 'Bola de fuego' });
  assert.equal(l.recursos[0].fecha, new Date(1790000000000).toISOString());
  const res = api.restaurarRecurso('c1', l.recursos[0].nombre);
  assert.deepEqual({ cat: res.cat, id: res.id, nuevoId: res.id !== res.idOriginal }, { cat: 'habilidades', id: 'bola', nuevoId: false });
  assert.equal(res.datos.nombre, 'Bola de fuego');
  assert.ok(fs.existsSync(path.join(r, 'abilities', 'bola.yaml')));
  assert.equal(api.listarPapelera('c1').recursos.length, 0);
});

test('recuperar un recurso cuyo id ya está en uso lo deja con otro id libre y no pisa nada', () => {
  limpiar(); const r = campana('c1', 'Uno');
  escribir(path.join(r, 'items', 'pocion.yaml'), 'nombre: Nueva\n');
  escribir(path.join(r, '_papelera', 'items-pocion-1790000000000.yaml'), 'nombre: Vieja\n');
  const res = api.restaurarRecurso('c1', 'items-pocion-1790000000000.yaml');
  assert.equal(res.id, 'pocion_2');
  assert.equal(fs.readFileSync(path.join(r, 'items', 'pocion.yaml'), 'utf8'), 'nombre: Nueva\n');
  assert.match(fs.readFileSync(path.join(r, 'items', 'pocion_2.yaml'), 'utf8'), /Vieja/);
});

test('borrar de la papelera elimina de verdad; vaciar quita todo lo de ese apartado', () => {
  limpiar(); const r = campana('c1', 'Uno');
  for (const n of ['a', 'b', 'c']) escribir(path.join(r, '_papelera', `items-${n}-179000000000${n === 'a' ? 1 : n === 'b' ? 2 : 3}.yaml`), `nombre: ${n}\n`);
  const [primero] = api.listarPapelera('c1').recursos;
  assert.equal(api.borrarDePapelera('c1', 'recursos', primero.nombre), true);
  assert.ok(!fs.existsSync(path.join(r, '_papelera', primero.nombre)));
  assert.equal(api.listarPapelera('c1').recursos.length, 2);
  assert.equal(api.vaciarPapelera('c1', 'recursos'), 2);
  assert.equal(api.listarPapelera('c1').recursos.length, 0);
  assert.equal(api.vaciarPapelera('c1', 'recursos'), 0);               // sin nada que vaciar: no falla
});

test('una campaña eliminada aparece, se recupera con su nombre y se puede borrar para siempre', () => {
  limpiar(); const r = campana('aldea', 'La Aldea', 'aaaaaaaaaaaaaaaa');
  escribir(path.join(r, 'base', 'tokens', 'x.png'), 'img');
  const destino = api.aPapelera(r, 'aldea');
  assert.ok(!fs.existsSync(r));
  const l = api.listarPapelera(null);
  assert.equal(l.campanas.length, 1);
  assert.deepEqual({ id: l.campanas[0].id, titulo: l.campanas[0].titulo, reemplazada: l.campanas[0].reemplazada }, { id: 'aldea', titulo: 'La Aldea', reemplazada: false });
  assert.equal(path.basename(destino), l.campanas[0].nombre);
  assert.ok(Math.abs(new Date(l.campanas[0].fecha) - Date.now()) < 60000, 'la fecha sale del nombre de la carpeta');
  const res = api.restaurarCampana(l.campanas[0].nombre);
  assert.deepEqual(res, { id: 'aldea', nombre: 'La Aldea' });
  assert.ok(fs.existsSync(path.join(CAMP, 'aldea', 'base', 'tokens', 'x.png')));
  assert.equal(api.listarPapelera(null).campanas.length, 0);
  // y ahora al revés: eliminarla para siempre
  const d2 = api.aPapelera(path.join(CAMP, 'aldea'), 'aldea');
  api.borrarDePapelera(null, 'campanas', path.basename(d2));
  assert.ok(!fs.existsSync(d2));
});

test('recuperar una campaña cuyo nombre está ocupado la distingue y cambia su uid si se repite', () => {
  limpiar(); const r = campana('aldea', 'La Aldea', 'bbbbbbbbbbbbbbbb');
  const copiaEnPapelera = path.join(CAMP, '_papelera', 'aldea-reemplazada-2026-10-27T15-10-00-123Z');
  fs.cpSync(r, copiaEnPapelera, { recursive: true });
  const l = api.listarPapelera(null).campanas[0];
  assert.equal(l.reemplazada, true); assert.equal(l.id, 'aldea'); assert.equal(l.fecha, '2026-10-27T15:10:00.123Z');
  const res = api.restaurarCampana(l.nombre);
  assert.equal(res.id, 'aldea-restaurada'); assert.equal(res.nombre, 'La Aldea (restaurada)');
  assert.match(fs.readFileSync(path.join(CAMP, 'aldea-restaurada', 'config.yaml'), 'utf8'), /La Aldea \(restaurada\)/);
  assert.notEqual(api.leerMeta(path.join(CAMP, 'aldea-restaurada')).uid, api.leerMeta(r).uid);
  assert.equal(api.leerMeta(r).uid, 'bbbbbbbbbbbbbbbb');                  // la original no se toca
});

test('la papelera no deja salir de su carpeta ni tocar lo que no es suyo', () => {
  limpiar(); const r = campana('c1', 'Uno');
  escribir(path.join(r, 'config.yaml'), 'servidor:\n  nombre: Uno\n');
  escribir(path.join(r, '_papelera', 'items-a-1790000000000.yaml'), 'nombre: a\n');
  for (const malo of ['../config.yaml', '..', '.', '', 'a/../../config.yaml', '..\\config.yaml', 5, null]) {
    assert.throws(() => api.borrarDePapelera('c1', 'recursos', malo), /no válido|no está/, `rechaza ${JSON.stringify(malo)}`);
    assert.throws(() => api.restaurarRecurso('c1', malo));
  }
  assert.throws(() => api.borrarDePapelera('c1', 'otra', 'x'), /no válida/);
  assert.throws(() => api.borrarDePapelera('../c1', 'recursos', 'x'), /no válido/);
  assert.ok(fs.existsSync(path.join(r, 'config.yaml')));
  assert.throws(() => api.borrarDePapelera('c1', 'recursos', 'no-existe.yaml'), /ya no está/);
});

test('un archivo ajeno en la papelera se ve y se puede borrar, pero no recuperar', () => {
  limpiar(); const r = campana('c1', 'Uno');
  escribir(path.join(r, '_papelera', 'notas.txt'), 'hola');
  const [x] = api.listarPapelera('c1').recursos;
  assert.equal(x.cat, null);
  assert.throws(() => api.restaurarRecurso('c1', 'notas.txt'), /no se puede recuperar/);
  api.borrarDePapelera('c1', 'recursos', 'notas.txt');
  assert.equal(api.listarPapelera('c1').recursos.length, 0);
});
