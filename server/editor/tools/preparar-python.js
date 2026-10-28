// tools/preparar-python.js — Prepara editor/python/: un Python para Windows con los componentes del servidor ya puestos,
// que viaja dentro del ejecutable del Editor (así quien lo usa no necesita instalar Python ni Node).
//
//  · Python: compilación «install_only_stripped» de python-build-standalone (la misma que usa uv), que no se instala: es una carpeta.
//  · Componentes: las ruedas (wheels) para Windows de PyPI, en versiones fijas. Instalar una rueda es extraerla en site-packages.
//  · Todo se comprueba con su sha256 (el de Python, aquí; el de cada rueda, el que publica PyPI) antes de usarlo.
//
// Uso: node tools/preparar-python.js        (lo llama «npm run portable»; si python/ ya está preparado con estas versiones, no hace nada)
// Necesita «curl» y «tar», que vienen con Windows 10 y 11 (y con Linux y macOS).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { leerZip } = require('../zip-lector');

// Para cambiar de versión: nueva URL y su .sha256 (está junto al archivo, en la misma página de la versión).
const PYTHON = {
  version: '3.12.11',
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20250612/cpython-3.12.11+20250612-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
  sha256: '51bc462f3d6caf4aef3d77209d01cd5f6c8fe8213c1ae739e573e1c2c473cb2b',
};
// Las mismas que pide server/requirements.txt (menos pytest, que solo sirve para las pruebas), fijadas y probadas con el servidor.
const PAQUETES = { PyYAML: '6.0.3', websockets: '17.2', cryptography: '50.0.1', cffi: '2.1.1', pycparser: '3.0' };

const EDITOR = path.resolve(__dirname, '..');
const DESTINO = path.join(EDITOR, 'python');
const CACHE = path.join(EDITOR, 'tools', '.cache');
const MARCA = path.join(DESTINO, '.preparado.json');
// Lo que el servidor no usa: interfaz gráfica de Python, editor IDLE, pruebas, cabeceras de C…
const SOBRA = ['tcl', 'include', 'libs', 'Scripts', 'Lib/tkinter', 'Lib/idlelib', 'Lib/turtledemo', 'Lib/test', 'Lib/ensurepip',
  'Lib/site-packages/pip', 'DLLs/_tkinter.pyd', 'DLLs/tcl86t.dll', 'DLLs/tk86t.dll'];

const decir = (t) => console.log(`  ${t}`);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function descargar(url, archivo) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', archivo, url], { stdio: 'inherit' });
  return fs.readFileSync(archivo);
}

function extraerRueda(buf, carpeta) {
  let n = 0;
  for (const e of leerZip(buf)) {
    if (e.carpeta) continue;
    const rel = path.normalize(e.nombre);
    if (path.isAbsolute(rel) || rel.split(path.sep).includes('..')) throw new Error(`Ruta peligrosa dentro de la rueda: ${e.nombre}`);
    const ruta = path.join(carpeta, rel);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, e.leer());
    n++;
  }
  return n;
}

function ruedaParaWindows(nombre, version) {
  const info = JSON.parse(execFileSync('curl', ['-sSfL', `https://pypi.org/pypi/${nombre}/${version}/json`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const archivos = info.urls.filter((u) => u.packagetype === 'bdist_wheel');
  const elegida = archivos.find((u) => /-(cp312-cp312|cp3\d+-abi3)-win_amd64\.whl$/.test(u.filename)) || archivos.find((u) => /-py3-none-any\.whl$/.test(u.filename));
  if (!elegida) throw new Error(`No hay rueda de ${nombre} ${version} para Windows de 64 bits con Python 3.12`);
  return elegida;
}

function main() {
  const quiero = { python: PYTHON.version, paquetes: PAQUETES };
  try {
    if (JSON.stringify(JSON.parse(fs.readFileSync(MARCA, 'utf8'))) === JSON.stringify(quiero) && fs.existsSync(path.join(DESTINO, 'python.exe'))) {
      console.log('Python para el Editor: ya está preparado.');
      return;
    }
  } catch { /* no está preparado */ }

  console.log(`Preparando Python ${PYTHON.version} para Windows con los componentes del servidor…`);
  fs.rmSync(DESTINO, { recursive: true, force: true });
  const tar = path.join(CACHE, path.basename(new URL(PYTHON.url).pathname).replace(/\+/g, '_'));
  let buf = fs.existsSync(tar) ? fs.readFileSync(tar) : null;
  if (!buf || sha256(buf) !== PYTHON.sha256) { decir('Descargando Python…'); buf = descargar(PYTHON.url, tar); }
  if (sha256(buf) !== PYTHON.sha256) throw new Error('La descarga de Python no coincide con su sha256: no se usa.');
  decir('Extrayendo…');
  execFileSync('tar', ['-xzf', tar, '-C', EDITOR]);          // el archivo trae una carpeta «python/»
  if (!fs.existsSync(path.join(DESTINO, 'python.exe'))) throw new Error('El archivo de Python no trae python.exe');
  for (const s of SOBRA) fs.rmSync(path.join(DESTINO, s), { recursive: true, force: true });
  for (const d of fs.readdirSync(path.join(DESTINO, 'Lib', 'site-packages'))) {     // los datos del pip que ya no está
    if (/^pip-.*\.dist-info$/.test(d)) fs.rmSync(path.join(DESTINO, 'Lib', 'site-packages', d), { recursive: true, force: true });
  }

  const sitio = path.join(DESTINO, 'Lib', 'site-packages');
  for (const [nombre, version] of Object.entries(PAQUETES)) {
    const r = ruedaParaWindows(nombre, version);
    const archivo = path.join(CACHE, r.filename);
    let rueda = fs.existsSync(archivo) ? fs.readFileSync(archivo) : null;
    if (!rueda || sha256(rueda) !== r.digests.sha256) rueda = descargar(r.url, archivo);
    if (sha256(rueda) !== r.digests.sha256) throw new Error(`${r.filename} no coincide con el sha256 de PyPI: no se usa.`);
    decir(`${r.filename}: ${extraerRueda(rueda, sitio)} archivos`);
  }
  fs.writeFileSync(MARCA, JSON.stringify(quiero, null, 2));
  console.log('Python para el Editor: listo en editor/python/.');
}

try { main(); } catch (e) { console.error(`\nNo se pudo preparar Python: ${e.message}`); process.exit(1); }
