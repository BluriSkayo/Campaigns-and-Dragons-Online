// jugadores.js — Cuentas y fichas de personaje de una campaña (data/<campaña>/), para el Editor.
// Mismos formatos que el servidor: cuentas.yaml y jugadores/<usuario>.yaml. Solo se escribe con el servidor CERRADO,
// porque mientras está abierto guarda su propia copia en memoria y pisaría lo que cambiemos aquí.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const YAML = require('yaml');

const error = (m) => { throw new Error(m); };
const RE_USUARIO = /^[\p{L}\p{N}_\- ]{1,20}$/u;      // como el \w de Python del servidor (incluye letras con tilde y ñ)
const archivoUsuario = (u) => `${u.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '_')}.yaml`;   // igual que _archivo_usuario del servidor (Python \w)

function crear({ dirDatos, hashear }) {
  const dir = (id) => dirDatos(id);

  function servidorAbierto(id) {
    const marca = path.join(dir(id), 'servidor.pid');
    try {
      const pid = parseInt(fs.readFileSync(marca, 'utf8').trim(), 10);
      if (!Number.isInteger(pid) || pid <= 0) return { abierto: false };
      try { process.kill(pid, 0); return { abierto: true, pid }; } catch (e) { return { abierto: e.code === 'EPERM', pid }; }
    } catch { return { abierto: false }; }
  }
  const exigirCerrado = (id) => { if (servidorAbierto(id).abierto) error('El servidor de esta campaña está abierto. Ciérralo para cambiar cuentas y fichas (si no, la partida pisaría tus cambios).'); };

  function leer(ruta) {
    try { return YAML.parse(fs.readFileSync(ruta, 'utf8')) || {}; } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`No se pudo leer ${path.basename(ruta)}: ${e.message}`); }
  }
  function escribir(ruta, datos, privado = false) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    if (fs.existsSync(ruta)) fs.copyFileSync(ruta, `${ruta}.bak`);                  // una copia de seguridad por si algo sale mal
    const tmp = `${ruta}.tmp`;
    fs.writeFileSync(tmp, YAML.stringify(datos, { lineWidth: 0 }), { encoding: 'utf8', mode: privado ? 0o600 : 0o644 });
    fs.renameSync(tmp, ruta);
  }

  const rutaCuentas = (id) => path.join(dir(id), 'cuentas.yaml');
  const rutaFichas = (id, u) => path.join(dir(id), 'jugadores', archivoUsuario(u));
  const cuentasDe = (id) => { const c = leer(rutaCuentas(id)).cuentas; return c && typeof c === 'object' ? c : {}; };
  const canonico = (cuentas, u) => Object.keys(cuentas).find((k) => k.toLowerCase() === String(u).toLowerCase());
  const usuarioValido = (u) => { u = String(u ?? '').trim(); if (!RE_USUARIO.test(u)) error('El nombre de usuario debe tener entre 1 y 20 letras, números, espacios, guiones o guiones bajos.'); return u; };

  function listar(id) {
    const cuentas = cuentasDe(id);
    const res = new Map();
    for (const [u, d] of Object.entries(cuentas)) res.set(u, { usuario: u, cuenta: true, tiene_password: !!(d && d.hash), ataque: (d && d.ataque) || '', ver_ajenos: !(d && d.ver_ajenos === false), editar: !(d && d.editar === false), fichas: [] });
    const carpeta = path.join(dir(id), 'jugadores');
    if (fs.existsSync(carpeta)) {
      for (const f of fs.readdirSync(carpeta).filter((n) => n.endsWith('.yaml'))) {
        let d; try { d = YAML.parse(fs.readFileSync(path.join(carpeta, f), 'utf8')) || {}; } catch { continue; }
        const u = typeof d.usuario === 'string' ? (canonico(cuentas, d.usuario) || d.usuario) : null;
        if (!u) continue;
        if (!res.has(u)) res.set(u, { usuario: u, cuenta: false, tiene_password: false, fichas: [] });
        res.get(u).fichas = (Array.isArray(d.personajes) ? d.personajes : []).filter((p) => p && typeof p === 'object' && p.id && p.nombre);
      }
    }
    return { ...servidorAbierto(id), usuarios: [...res.values()].sort((a, b) => a.usuario.localeCompare(b.usuario)) };
  }

  function crearCuenta(id, usuario, password) {
    exigirCerrado(id);
    usuario = usuarioValido(usuario);
    const cuentas = cuentasDe(id);
    if (canonico(cuentas, usuario)) error('Ya existe un usuario con ese nombre.');
    cuentas[usuario] = { hash: password ? hashear(password) : '', creada: Math.floor(Date.now() / 1000) };
    escribir(rutaCuentas(id), { cuentas }, true);
    return usuario;
  }
  function fijarPassword(id, usuario, password) {          // password vacía = quitarla (el jugador elegirá una al entrar)
    exigirCerrado(id);
    const cuentas = cuentasDe(id);
    const u = canonico(cuentas, usuario) || error('Ese usuario no existe.');
    cuentas[u] = { ...(cuentas[u] || {}), hash: password ? hashear(password) : '' };
    escribir(rutaCuentas(id), { cuentas }, true);
    return true;
  }
  const MODOS_ATAQUE = ['enemigos', 'enemigos_y_neutros', 'todos', 'nadie'];
  function fijarAtaque(id, usuario, modo) {                // '' = sin límite propio: vale lo que diga la mesa (Reglas)
    exigirCerrado(id);
    if (modo && !MODOS_ATAQUE.includes(modo)) error('Valor no válido.');
    const cuentas = cuentasDe(id);
    const u = canonico(cuentas, usuario) || error('Ese usuario no existe.');
    const c = { ...(cuentas[u] || {}) };
    if (modo) c.ataque = modo; else delete c.ataque;
    cuentas[u] = c;
    escribir(rutaCuentas(id), { cuentas }, true);
    return true;
  }
  function fijarBloqueo(id, usuario, clave, permitido) {   // clave: 'ver_ajenos' | 'editar'. Solo se guarda «false»; permitido = lo normal
    exigirCerrado(id);
    if (!['ver_ajenos', 'editar'].includes(clave) || typeof permitido !== 'boolean') error('Valor no válido.');
    const cuentas = cuentasDe(id);
    const u = canonico(cuentas, usuario) || error('Ese usuario no existe.');
    const c = { ...(cuentas[u] || {}) };
    if (permitido) delete c[clave]; else c[clave] = false;
    cuentas[u] = c;
    escribir(rutaCuentas(id), { cuentas }, true);
    return true;
  }
  function borrarCuenta(id, usuario) {                     // las fichas se conservan: si el usuario vuelve a crearse, las recupera
    exigirCerrado(id);
    const cuentas = cuentasDe(id);
    const u = canonico(cuentas, usuario) || error('Ese usuario no existe.');
    delete cuentas[u];
    escribir(rutaCuentas(id), { cuentas }, true);
    return true;
  }

  const entero = (v) => Number.isInteger(v);
  /** Comprueba la ficha contra la campaña (catálogo ya cargado por el Editor) y devuelve la ficha limpia. */
  function limpiarFicha(ficha, camp) {
    if (!ficha || typeof ficha !== 'object') error('Ficha no válida');
    const nombre = String(ficha.nombre ?? '').trim();
    if (!nombre || nombre.length > 30) error('El nombre del personaje debe tener entre 1 y 30 caracteres.');
    const j = camp.config.juego || {};
    const defStats = Object.fromEntries((j.estadisticas || []).map((e) => [e.nombre, e]));
    const defRec = Object.fromEntries((j.recursos || []).map((r) => [r.nombre, r]));
    const usar = j.usar_grupos !== false;
    const grupos = usar ? camp.recursos.grupos || {} : {};
    const opciones = usar ? camp.recursos.opciones || {} : {};
    const activo = (g, n = 0) => { const si = grupos[g]?.solo_si; return !si || (n < 10 && (si.opciones || []).includes(elecciones[si.grupo]) && activo(si.grupo, n + 1)); };
    const elecciones = {};
    for (const [g, o] of Object.entries(ficha.elecciones || {})) {
      if (!grupos[g]) error(`El grupo «${g}» no existe.`);
      if (!opciones[o] || opciones[o].grupo !== g) error(`La opción «${o}» no pertenece al grupo «${grupos[g].nombre}».`);
      elecciones[g] = o;
    }
    for (const g of Object.keys(elecciones)) if (!activo(g)) error(`«${grupos[g].nombre}» no corresponde con lo que elegiste.`);
    for (const [g, gd] of Object.entries(grupos)) if (gd.obligatorio !== false && !elecciones[g] && activo(g) && Object.values(opciones).some((o) => o.grupo === g)) error(`Elige una opción de «${gd.nombre}».`);
    const stats = {};
    for (const [k, v] of Object.entries(ficha.stats || {})) {
      const e = defStats[k] || error(`La estadística «${k}» no existe.`);
      if (!entero(v) || v < (e.minimo ?? 0) || v > (e.maximo ?? 999)) error(`«${k}» debe estar entre ${e.minimo ?? 0} y ${e.maximo ?? 999}.`);
      stats[k] = v;
    }
    const recursos = {};
    for (const [k, v] of Object.entries(ficha.recursos || {})) {
      if (!defRec[k]) error(`El recurso «${k}» no existe.`);
      const mx = v?.max, ac = v?.actual;
      if (!entero(mx) || mx < (k === j.recurso_vida ? 1 : 0)) error(`El máximo de «${k}» no es válido.`);
      if (!entero(ac) || ac < 0 || ac > mx) error(`El valor actual de «${k}» debe estar entre 0 y ${mx}.`);
      recursos[k] = { actual: ac, max: mx };
    }
    if (!recursos[j.recurso_vida]) error(`Falta el recurso de vida («${j.recurso_vida}»).`);
    const habilidades = (ficha.habilidades || []).map((h) => camp.recursos.habilidades?.[h] ? h : error(`La habilidad «${h}» no existe.`));
    const inventario = (ficha.inventario || []).map((e) => {
      if (!camp.recursos.objetos?.[e.objeto]) error(`El objeto «${e.objeto}» no existe.`);
      if (!entero(e.cantidad) || e.cantidad < 1) error('Las cantidades del inventario deben ser enteros desde 1.');
      return { objeto: e.objeto, cantidad: e.cantidad };
    });
    const dinero = ficha.dinero ?? 0;
    if (!entero(dinero) || dinero < 0 || dinero > 1e9) error('El dinero debe ser un entero desde 0.');
    if (ficha.puntos_pendientes !== undefined && (!entero(ficha.puntos_pendientes) || ficha.puntos_pendientes < 0)) error('Los puntos pendientes deben ser un entero desde 0.');
    return {
      id: typeof ficha.id === 'string' && /^[\w-]{1,40}$/.test(ficha.id) ? ficha.id : crypto.randomBytes(5).toString('hex'),
      nombre, dueno: '', base: '', imagen: typeof ficha.imagen === 'string' ? ficha.imagen.slice(0, 200) : '',
      imagen_biografia: typeof ficha.imagen_biografia === 'string' ? ficha.imagen_biografia.slice(0, 200) : '',
      historia: String(ficha.historia ?? '').slice(0, 20000), elecciones, puntos_pendientes: ficha.puntos_pendientes ?? 0,
      stats, recursos, habilidades, inventario, dinero,
      ...(entero(ficha.nivel) && ficha.nivel >= 1 && ficha.nivel <= 100 ? { nivel: ficha.nivel } : {}),
      sonidos: (Array.isArray(ficha.sonidos) ? ficha.sonidos : []).filter((n, i, l) => typeof n === 'string' && n.length <= 120 && l.indexOf(n) === i),
      campos: Object.fromEntries(Object.entries(ficha.campos && typeof ficha.campos === 'object' ? ficha.campos : {})
        .filter(([k, v]) => (j.campos_ficha || []).some((c) => c.nombre === k) && v !== null && v !== '' && ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 300) : v])),
    };
  }

  /** `opciones` (solo al importar un personaje): `extras` = campos que el Editor no edita y se conservan tal cual (el servidor los
   *  vuelve a comprobar al cargar), `equipados` = objetos del inventario que van equipados, `reemplazar` = la ficha con ese id se
   *  sustituye entera en vez de mezclarse con la anterior. */
  function guardarFicha(id, usuario, ficha, camp, opciones = {}) {
    exigirCerrado(id);
    const cuentas = cuentasDe(id);
    const u = canonico(cuentas, usuario) || (cuentas[usuario] ? usuario : null) || error('Primero crea la cuenta de ese usuario.');
    const limpia = limpiarFicha(ficha, camp);
    limpia.dueno = u;
    const { extras = {}, equipados = [], reemplazar = false } = opciones;
    for (const [k, v] of Object.entries(extras)) if (!(k in limpia)) limpia[k] = v;
    if (typeof ficha.imagen_propia === 'string' && opciones.extras) limpia.imagen_propia = ficha.imagen_propia.slice(0, 200);
    for (const e of limpia.inventario) if (equipados.includes(e.objeto)) e.equipado = true;
    const ruta = rutaFichas(id, u);
    const doc = leer(ruta);
    const lista = Array.isArray(doc.personajes) ? doc.personajes : [];
    if (lista.some((p) => p.id !== limpia.id && String(p.nombre).toLowerCase() === limpia.nombre.toLowerCase())) error('Ese usuario ya tiene un personaje con ese nombre.');
    const i = lista.findIndex((p) => p.id === limpia.id);
    if (i >= 0) { lista[i] = reemplazar ? limpia : { ...lista[i], ...limpia }; delete lista[i].companero_de; } else lista.push(limpia);
    escribir(ruta, { usuario: u, personajes: lista });
    return limpia;
  }
  function borrarFicha(id, usuario, fichaId) {
    exigirCerrado(id);
    const ruta = rutaFichas(id, usuario);
    const doc = leer(ruta);
    const lista = Array.isArray(doc.personajes) ? doc.personajes : [];
    if (!lista.some((p) => p.id === fichaId)) error('Esa ficha no existe.');
    escribir(ruta, { usuario: doc.usuario || usuario, personajes: lista.filter((p) => p.id !== fichaId) });
    return true;
  }
  return { servidorAbierto, listar, crearCuenta, fijarPassword, fijarAtaque, fijarBloqueo, borrarCuenta, guardarFicha, borrarFicha, limpiarFicha };
}

module.exports = { crear, archivoUsuario };
