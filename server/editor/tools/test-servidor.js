// Prueba del servidor abierto desde el Editor (servidor.js). Usa un main.py de mentira que hace lo mismo que el real:
// avisa de que escucha, deja servidor.pid y espera. Se ejecuta con:  node --test tools/test-servidor.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crear } = require('../servidor');

function montar(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-srv-'));
  const raiz = path.join(tmp, 'servidor'), camp = path.join(raiz, 'campanas', 'ejemplo'), datos = path.join(tmp, 'data');
  fs.mkdirSync(camp, { recursive: true });
  fs.writeFileSync(path.join(raiz, 'main.py'), `
import sys, os, time, argparse, atexit
ap = argparse.ArgumentParser(); ap.add_argument("--config"); ap.add_argument("--datos"); a = ap.parse_args()
if os.path.exists(os.path.join(a.config, "roto")):
    print("  ERROR  la configuración tiene errores"); sys.exit(1)
os.makedirs(a.datos, exist_ok=True)
open(os.path.join(a.datos, "servidor.pid"), "w").write(str(os.getpid()))
print("Campaña:", os.path.basename(a.config))
print("12:00:00 Servidor «Prueba» escuchando en wss://0.0.0.0:8765")
time.sleep(120)
`);
  const dirDatos = () => datos;
  const marca = () => path.join(datos, 'servidor.pid');
  const servidorAbierto = () => {
    try { const pid = parseInt(fs.readFileSync(marca(), 'utf8'), 10); process.kill(pid, 0); return { abierto: true, pid }; } catch { return { abierto: false }; }
  };
  const avisos = [];
  const s = crear({ raiz, rutaCampana: () => camp, dirDatos, servidorAbierto, encontrarPython: async () => ['python3'], ...extra });
  s.alAvisar(() => avisos.push(Date.now()));
  return { s, camp, marca, avisos, tmp };
}
const esperar = async (cond, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('abrir, notar un cambio pendiente, reiniciar y cerrar', async (t) => {
  const { s, marca, avisos, tmp } = montar();
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });

  assert.equal(s.estado('ejemplo').abierto, false);
  await s.iniciar('ejemplo');
  assert.ok(await esperar(() => s.estado('ejemplo').listo && fs.existsSync(marca())), 'el servidor debía quedar listo');
  let e = s.estado('ejemplo');
  assert.equal(e.abierto, true); assert.equal(e.propio, true); assert.equal(e.direccion, 'wss://0.0.0.0:8765');
  assert.ok(e.salida.some((l) => l.includes('escuchando')), 'la salida debe guardarse');
  assert.equal(e.pendiente, false);
  assert.ok(avisos.length > 0, 'debe avisar a la ventana');

  await assert.rejects(s.iniciar('ejemplo'), /ya está abierto/);

  s.marcarCambio('ejemplo');
  assert.equal(s.estado('ejemplo').pendiente, true, 'guardar con el servidor abierto deja el cambio pendiente');

  const pidAntes = s.estado('ejemplo').pid;
  await s.reiniciar('ejemplo');
  assert.ok(await esperar(() => s.estado('ejemplo').listo && fs.existsSync(marca())));
  e = s.estado('ejemplo');
  assert.equal(e.pendiente, false, 'al reiniciar, el cambio ya está aplicado');
  assert.notEqual(e.pid, pidAntes);

  await s.detener('ejemplo');
  assert.equal(s.estado('ejemplo').abierto, false);
  assert.equal(fs.existsSync(marca()), false, 'no debe quedar servidor.pid de un proceso muerto');
});

test('si el servidor no arranca, se ve el motivo y queda cerrado', async (t) => {
  const { s, camp, tmp } = montar();
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(camp, 'roto'), '');
  await s.iniciar('ejemplo');
  assert.ok(await esperar(() => !s.estado('ejemplo').abierto), 'debía cerrarse solo');
  const e = s.estado('ejemplo');
  assert.ok(e.salida.some((l) => l.includes('ERROR')), 'el error debe verse en la salida');
  assert.ok(e.salida.some((l) => l.includes('código 1')));
});

test('un servidor abierto fuera del Editor no se toca ni se pisa', async (t) => {
  const { s, marca, tmp } = montar();
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });
  fs.mkdirSync(path.dirname(marca()), { recursive: true });
  fs.writeFileSync(marca(), String(process.pid));          // «alguien» lo abrió por su cuenta (aquí: este mismo proceso, que está vivo)
  const e = s.estado('ejemplo');
  assert.equal(e.abierto, true); assert.equal(e.propio, false);
  await assert.rejects(s.iniciar('ejemplo'), /fuera del Editor/);
  await assert.rejects(s.detener('ejemplo'), /no lo abrió el Editor/);
  s.marcarCambio('ejemplo');
  assert.equal(s.estado('ejemplo').pendiente, true, 'también avisa de cambios pendientes si el servidor es externo');
});

test('si faltan componentes y no se pueden instalar, se explica y no queda a medias', async (t) => {
  // Python existe pero «no tiene» el módulo; la instalación (pip sin paquetes) falla igual que sin internet
  const { s, tmp } = montar({ encontrarPython: async () => null, encontrarPythonBase: async () => ['python3'], modulos: ['modulo_que_no_existe_xyz'], paquetes: [] });
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const p = s.iniciar('ejemplo');
  assert.equal(s.estado('ejemplo').abriendo, true, 'mientras prepara Python figura como «abriendo»');
  await assert.rejects(p, /No se pudieron instalar los componentes/);
  const e = s.estado('ejemplo');
  assert.equal(e.abriendo, false); assert.equal(e.abierto, false);
  assert.ok(e.salida.some((l) => l.includes('Instalando los componentes')));
  await assert.rejects(montar({ encontrarPython: async () => null, encontrarPythonBase: async () => null }).s.iniciar('ejemplo'), /No se encontró Python 3\.10/);
});

test('si ya hay un Python con todo, no se instala nada', async (t) => {
  const { s, tmp } = montar({ modulos: ['sys'] });
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await s.iniciar('ejemplo');
  assert.ok(await esperar(() => s.estado('ejemplo').listo));
  assert.ok(!s.estado('ejemplo').salida.some((l) => l.includes('Instalando')));
});

test('al abrir el Editor se prepara el entorno sin esperar al servidor, y avisa si no puede', async (t) => {
  const { s, tmp } = montar({ encontrarPython: async () => null, encontrarPythonBase: async () => ['python3'], modulos: ['modulo_que_no_existe_xyz'], paquetes: [] });
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const p = s.prepararEntorno();
  assert.equal(s.entorno().preparando, true, 'mientras instala figura como «preparando»');
  assert.strictEqual(s.prepararEntorno(), p, 'no se lanza dos veces a la vez');
  await p;                                                  // nunca rechaza hacia fuera
  const e = s.entorno();
  assert.equal(e.preparando, false);
  assert.match(e.error, /No se pudieron instalar los componentes/);
});

test('si el entorno ya está listo, prepararlo no instala nada y no deja error', async (t) => {
  const { s, tmp } = montar({ modulos: ['sys'] });
  t.after(() => { s.cerrarTodo(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await s.prepararEntorno();
  assert.deepEqual(s.entorno(), { preparando: false, error: null });
  await s.esperarEntorno();
});
