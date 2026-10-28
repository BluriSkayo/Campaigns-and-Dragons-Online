// servidor.js — El Editor abre, cierra y reinicia el servidor de la campaña que se está editando (proceso principal).
// El servidor lee la campaña al arrancar: cualquier cambio guardado mientras está abierto solo se aplica al reiniciarlo.
// Por eso aquí se apuntan las campañas con cambios pendientes de aplicar (`pendientes`) y se ofrece «Reiniciar».
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_LINEAS = 300;

// Lo que necesita el servidor (igual que requirements.txt, sin lo de pruebas)
const MODULOS = ['websockets', 'yaml', 'cryptography'];
const PAQUETES = ['websockets>=13.0', 'PyYAML>=6.0', 'cryptography>=42.0'];

function crear({ raiz, rutaCampana, dirDatos, encontrarPython, encontrarPythonBase = encontrarPython, olvidarPython = () => {}, servidorAbierto,
  modulos = MODULOS, paquetes = PAQUETES }) {
  let hijo = null;                 // { proc, campana, pid, listo, direccion } — el servidor que abrió el Editor (solo uno a la vez)
  let salida = [];                 // últimas líneas que escribió
  const pendientes = new Set();    // campañas con cambios guardados que el servidor abierto aún no ha leído
  let aviso = () => {};
  let entorno = null;              // promesa mientras se preparan los componentes de Python al abrir el Editor
  let errorEntorno = null;
  let abriendo = null;             // campaña cuyo servidor se está preparando (buscar Python, instalar componentes)

  const poner = (texto) => {
    for (const l of String(texto).split(/\r?\n/)) if (l.trim()) salida.push(l.replace(/\s+$/, ''));
    if (salida.length > MAX_LINEAS) salida.splice(0, salida.length - MAX_LINEAS);
  };

  function estado(campana) {
    const externo = campana ? servidorAbierto(campana) : { abierto: false };
    const propio = !!hijo && hijo.campana === campana;
    const abierto = propio || !!externo.abierto;
    if (!abierto) pendientes.delete(campana);
    return {
      campana, abierto, propio, pid: propio ? hijo.pid : externo.pid || null,
      abriendo: abriendo === campana, listo: propio ? hijo.listo : abierto, direccion: propio ? hijo.direccion : null,
      pendiente: abierto && pendientes.has(campana),
      otraCampana: hijo && !propio ? hijo.campana : null,      // el Editor tiene abierto el servidor de otra campaña
      salida: propio || !abierto ? [...salida] : [],
    };
  }

  /** Borra servidor.pid si quedó de un proceso que ya no existe (al cerrarlo a la fuerza no se ejecuta su limpieza). */
  function limpiarMarca(campana) {
    try {
      const marca = path.join(dirDatos(campana), 'servidor.pid');
      const pid = parseInt(fs.readFileSync(marca, 'utf8').trim(), 10);
      let vivo = false;
      try { process.kill(pid, 0); vivo = true; } catch (e) { vivo = e.code === 'EPERM'; }
      if (!vivo) fs.unlinkSync(marca);
    } catch { /* no había marca */ }
  }

  function matar(proc) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else proc.kill('SIGTERM');
  }

  /** Ejecuta un comando de Python y devuelve si terminó bien; su salida va al registro que se ve en el cuadro del servidor. */
  function correr(py, args, mostrar) {
    return new Promise((resolver) => {
      const p = spawn(py[0], [...py.slice(1), ...args], { cwd: raiz, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const alDato = (d) => { if (mostrar) { poner(d.toString('utf8')); aviso(); } };
      p.stdout.on('data', alDato); p.stderr.on('data', alDato);
      p.on('error', () => resolver(false));
      p.on('close', (c) => resolver(c === 0));
    });
  }

  /** Busca un Python y, si le faltan los componentes del servidor, los instala (solo pasa la primera vez en cada equipo). */
  async function prepararPython() {
    let py = await encontrarPython();
    if (py) return py;
    py = await encontrarPythonBase();
    if (!py) throw new Error('No se encontró Python 3.10 o superior. Instálalo desde python.org (marcando «Add python.exe to PATH») y vuelve a pulsar «Iniciar servidor».');
    if (!(await correr(py, ['-c', `import ${modulos.join(', ')}`], false))) {
      poner('Instalando los componentes del servidor (solo la primera vez; necesita internet)…');
      aviso();
      if (!(await correr(py, ['-m', 'pip', 'install', '--quiet', '--only-binary=:all:', ...paquetes], true))) {
        throw new Error('No se pudieron instalar los componentes del servidor. Revisa tu conexión a internet. Si tu Python es muy nuevo (3.15 o más), instala también Python 3.13 desde python.org: el Editor lo usará solo.');
      }
      poner('Componentes instalados.');
      olvidarPython();
    }
    return py;
  }

  /** Al abrir el Editor: busca Python y le instala lo que falte, para que desde la primera vez funcionen la validación, los efectos y el simulador
   *  (todo eso lo calcula el propio servidor). Nunca falla hacia fuera: si no puede, deja el motivo en `entorno().error`. */
  function prepararEntorno() {
    if (entorno) return entorno;
    errorEntorno = null;
    if (!hijo) salida = [];
    entorno = prepararPython().then(() => {}, (e) => { errorEntorno = e.message; poner(e.message); }).finally(() => { entorno = null; aviso(); });
    aviso();
    return entorno;
  }

  async function iniciar(campana) {
    const ruta = rutaCampana(campana);
    if (abriendo) throw new Error('El servidor ya se está abriendo.');
    if (hijo) throw new Error(hijo.campana === campana ? 'El servidor ya está abierto.' : `El Editor ya tiene abierto el servidor de «${hijo.campana}». Ciérralo antes.`);
    if (servidorAbierto(campana).abierto) throw new Error('Esta campaña ya tiene un servidor abierto fuera del Editor. Ciérralo (o ciérralo y vuelve a abrirlo desde aquí).');
    salida = [];
    abriendo = campana;                                      // mientras se prepara Python, el botón ya figura como «abriendo»
    aviso();
    let py;
    try { if (entorno) await entorno; py = await prepararPython(); } catch (e) { poner(e.message); throw e; } finally { abriendo = null; aviso(); }
    const proc = spawn(py[0], [...py.slice(1), '-u', path.join(raiz, 'main.py'), '--config', ruta, '--datos', dirDatos(campana)], {
      cwd: raiz, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    const h = { proc, campana, pid: proc.pid, listo: false, direccion: null };
    hijo = h;
    pendientes.delete(campana);
    const alDato = (d) => {
      const t = d.toString('utf8');
      poner(t);
      const m = /escuchando en (\S+)/.exec(t);
      if (m) { h.listo = true; h.direccion = m[1]; }
      aviso();
    };
    proc.stdout.on('data', alDato);
    proc.stderr.on('data', alDato);
    proc.on('error', (e) => { poner(`No se pudo abrir el servidor: ${e.message}`); if (hijo === h) hijo = null; aviso(); });
    proc.on('close', (codigo) => {
      poner(codigo ? `— El servidor se cerró (código ${codigo}) —` : '— El servidor se cerró —');
      if (hijo === h) hijo = null;
      setTimeout(() => { limpiarMarca(campana); aviso(); }, 300);
      aviso();
    });
    aviso();
    return estado(campana);
  }

  function esperarCierre(h, ms = 6000) {
    return new Promise((resolver) => {
      if (h.proc.exitCode !== null || h.proc.signalCode !== null) return resolver();
      const t = setTimeout(resolver, ms);
      h.proc.once('close', () => { clearTimeout(t); resolver(); });
    });
  }

  async function detener(campana) {
    if (!hijo || hijo.campana !== campana) {
      if (servidorAbierto(campana).abierto) throw new Error('Este servidor no lo abrió el Editor: ciérralo desde su propia ventana.');
      return estado(campana);
    }
    const h = hijo;
    matar(h.proc);
    await esperarCierre(h);
    await new Promise((r) => setTimeout(r, 350));          // deja que se retire la marca de «servidor abierto»
    limpiarMarca(campana);
    if (hijo === h) hijo = null;
    pendientes.delete(campana);
    aviso();
    return estado(campana);
  }

  async function reiniciar(campana) {
    await detener(campana);
    return iniciar(campana);
  }

  /** Se llama tras guardar algo: si esa campaña tiene el servidor abierto, ya no está al día. */
  function marcarCambio(campana) {
    if (campana && servidorAbierto(campana).abierto) { pendientes.add(campana); aviso(); }
  }

  /** Al cerrar el Editor, el servidor que abrió desde aquí se cierra con él. */
  function cerrarTodo() {
    if (hijo) { const h = hijo; hijo = null; matar(h.proc); setTimeout(() => limpiarMarca(h.campana), 400); }
  }

  return { esperarEntorno: () => entorno || Promise.resolve(), entorno: () => ({ preparando: !!entorno, error: errorEntorno }), prepararEntorno, estado, iniciar, detener, reiniciar, marcarCambio, cerrarTodo, alAvisar: (fn) => { aviso = fn; } };
}

module.exports = { crear };
