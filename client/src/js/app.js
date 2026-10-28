// app.js — Arranque y orquestación: conecta la red con el estado y decide qué pantalla se ve.
import { abrirPersonaje } from './ventanas/personaje.js';
import { S, bus, reiniciar, tokenEnTurno, esMio, vidaDe } from './almacen.js';
import { red, normalizarDireccion } from './red.js';
import { ajustes, guardar } from './ajustes.js';
import { h, toast } from './util.js';
import { cerrarTodas } from './ventanas.js';
import { pitar } from './sonidos.js';
import { audio, reproducir, aplicarVolumen, sincronizarAmbiente, efecto } from './musica.js';
import { imagen, limpiarCache } from './imagenes.js';
import { iniciarArchivos, usarCampana } from './archivos.js';
import { crearConexion } from './pantallas/conexion.js';
import { crearCargando } from './pantallas/cargando.js';
import { crearSeleccion } from './pantallas/seleccion.js';
import { crearPrincipal } from './pantallas/principal.js';

const raiz = document.getElementById('raiz');
const SIN_PERSONAJE = '-';      // el GM (o un jugador, si la mesa deja entrar sin ficha) eligió entrar sin personaje
let pantalla = null;
let vistaActual = null;
let pendiente = null;           // inicio de sesión en curso: {ok, fallo}

// ── Pantallas ─────────────────────────────────────────────────
function mostrar(nombre, vista) {
  vistaActual?.destruir?.();
  cerrarTodas();
  document.querySelector('.overlay-conexion')?.remove();
  raiz.replaceChildren(vista.el);
  vistaActual = vista;
  pantalla = nombre;
}

function irConexion(aviso) {
  reproducir(null);
  sincronizarAmbiente([]);
  reiniciar();
  limpiarCache();
  mostrar('conexion', crearConexion({ alConectar: conectar, aviso }));
}
const irSeleccion = () => mostrar('seleccion', crearSeleccion({ alEntrarSinPersonaje: entrarSinPersonaje }));
const irPrincipal = () => {
  mostrar('principal', crearPrincipal());
  bus.emit('mapa');
};

// El último personaje usado se recuerda por servidor y usuario: la selección se muestra la primera vez.
const claveSesion = () => `${S.url}|${S.usuario.toLowerCase()}`;
const recordarPersonaje = (valor) => guardar({ ultimoPersonaje: { ...ajustes.ultimoPersonaje, [claveSesion()]: valor } });
function entrarSinPersonaje() { recordarPersonaje(SIN_PERSONAJE); irPrincipal(); }

const HUELLA_AVISO = 'Es la identidad del servidor. Pídele al administrador que te la confirme (por ejemplo por mensaje) antes de aceptar.';

/** Comprueba la identidad del servidor cifrado (primera vez: pregunta; después: debe ser la misma). */
async function confiarEnServidor({ host, puerto }) {
  const api = window.mesa?.tls;
  if (!api) return;
  let sonda;
  try { sonda = await api.sondear(host, puerto); } catch {
    throw new Error('No se pudo establecer una conexión cifrada. Comprueba la dirección y que el servidor esté encendido. '
      + 'Si tu servidor funciona sin cifrar, escribe ws:// delante de la dirección.');
  }
  const clave = `${host}:${puerto}`;
  const guardada = ajustes.huellas[clave];
  if (!sonda.valido && guardada !== sonda.huella) {
    const texto = guardada
      ? `⚠ ¡CUIDADO! La identidad de este servidor ha CAMBIADO desde la última vez.\n\nPuede ser que el administrador haya reinstalado el servidor… o que alguien se esté haciendo pasar por él.\n\nHuella nueva:\n${sonda.huella}\n\n${HUELLA_AVISO}\n\n¿Quieres confiar en la nueva identidad?`
      : `Es la primera vez que te conectas a este servidor.\n\nHuella del servidor:\n${sonda.huella}\n\n${HUELLA_AVISO}\n\n¿Confías en este servidor?`;
    if (!window.confirm(texto)) throw new Error('Conexión cancelada: no se aceptó la identidad del servidor.');
    guardar({ huellas: { ...ajustes.huellas, [clave]: sonda.huella } });
  }
  await api.confiar(host, sonda.valido ? sonda.huella : ajustes.huellas[clave]);
}

async function conectar({ direccion, usuario, password, passServidor, passGM, gm }) {
  const dir = normalizarDireccion(direccion);
  const { url, host } = dir;
  if (dir.seguro) await confiarEnServidor(dir);
  await red.conectar(url);
  const espera = new Promise((ok, fallo) => { pendiente = { ok, fallo }; });
  S.url = url;
  S.host = host;
  red.enviar({ tipo: 'entrar', usuario, password: password || undefined, password_servidor: passServidor || undefined, password_gm: passGM || undefined, gm: gm || undefined });
  try {
    await espera;
  } catch (e) {
    pendiente = null;
    red.cerrar(true);
    throw e;
  }
}

function decidirPantalla() {
  const ultimo = ajustes.ultimoPersonaje[claveSesion()];
  if (ultimo === SIN_PERSONAJE && (S.esGM || S.permisos.sin_ficha)) { irPrincipal(); return; }
  if (ultimo && S.personajes.some((p) => p.id === ultimo)) {
    mostrar('cargando', crearCargando('Entrando a la mesa'));
    red.enviar({ tipo: 'elegir_personaje', personaje: ultimo });
    return;
  }
  irSeleccion();
}

// ── Mensajes del servidor ─────────────────────────────────────
bus.on('archivos', () => { limpiarCache(); bus.emit('imagen-cargada'); });

red.on('bienvenida', async (m) => {
  S.servidor = m.servidor;
  S.usuario = m.usuario;
  S.esGM = m.es_gm;
  S.permisos = m.permisos;
  S.cuenta = m.cuenta || { tiene_password: false };
  S.catalogo = m.catalogo;
  S.personajes = m.personajes;
  S.tiradas = Array.isArray(m.tiradas) ? m.tiradas : [];
  S.campana = typeof m.campana === 'string' ? m.campana : '';
  if (!m.elevado) { await usarCampana(S.campana); limpiarCache(); }          // sus imágenes y sonidos: base/campanas/<id>
  bus.emit('permisos');
  if (m.elevado) { toast('Ahora eres GM.', 'ok'); irPrincipal(); return; }      // «/gm contraseña» en el chat: se rehace la pantalla con lo del GM
  if (pendiente) { pendiente.ok(); pendiente = null; }
  decidirPantalla();
});

red.on('estado', (m) => {
  S.mapaId = m.mapa_id;
  S.mapa = m.mapa;
  S.tokens = new Map(m.tokens.map((t) => [t.id, t]));
  S.combate = { ...m.combate };
  S.chat = m.chat;
  S.salas = Array.isArray(m.salas) ? m.salas : [];
  S.tiendas = Array.isArray(m.tiendas) ? m.tiendas : [];
  S.capasOcultas = Array.isArray(m.capas_ocultas) ? m.capas_ocultas : [];
  S.niebla = Array.isArray(m.niebla) ? m.niebla : null;
  S.nieblaActiva = !!m.niebla_activa;
  S.nieblaGM = m.niebla_gm || null;          // solo GM: viendo la niebla del grupo («*») o de un jugador
  S.musica = m.musica;
  S.ambiente = Array.isArray(m.ambiente) ? m.ambiente : [];
  S.periodo = Number.isInteger(m.periodo) ? m.periodo : 0;
  S.clima = Number.isInteger(m.clima) ? m.clima : 0;
  S.dibujos = Array.isArray(m.dibujos) ? m.dibujos : [];
  S.dibujoBloqueado = !!m.dibujo_bloqueado;
  if (Array.isArray(m.salas_mapa)) S.salasMapa = m.salas_mapa;
  S.reglasAjenas = new Map();
  if (S.tokenActivo && !S.tokens.has(S.tokenActivo)) S.tokenActivo = null;
  if (S.tokenFoco && !S.tokens.has(S.tokenFoco)) S.tokenFoco = S.tokenActivo;
  reproducir(S.musica);
  sincronizarAmbiente(S.ambiente);
  bus.emit('mapa');
  bus.emit('tokens');
  bus.emit('combate');
  bus.emit('chat-historial');
  bus.emit('musica');
  bus.emit('salas-mapa');
  bus.emit('estado');
});

/** Un sonido por actualización: daño > curación > movimiento. */
function sonidoDeCambios(nuevos) {
  let golpe = false, cura = false, mueve = false;
  for (const t of nuevos) {
    const antes = S.tokens.get(t.id);
    if (!antes) continue;
    const v0 = vidaDe(antes)?.actual, v1 = vidaDe(t)?.actual;
    if (v0 != null && v1 != null && v1 < v0) golpe = true;
    else if (v0 != null && v1 != null && v1 > v0) cura = true;
    if (antes.x !== t.x || antes.y !== t.y) mueve = true;
  }
  if (golpe) pitar('golpe'); else if (cura) pitar('cura'); else if (mueve) pitar('mover');
}

red.on('casilla', (m) => {                // una casilla cambió (se rompió o resiste un golpe)
  if (S.mapa?.celdas?.[m.y]) S.mapa.celdas[m.y][m.x] = m.tile;
  bus.emit('celdas');
});

red.on('objetos_mapa', (m) => {            // un objeto del mapa se rompió (ya no está) o resiste un golpe
  if (S.mapa) S.mapa.objetos = m.objetos || [];
  bus.emit('celdas');
});

red.on('periodo', (m) => { S.periodo = m.indice; bus.emit('periodo'); });
red.on('clima', (m) => { S.clima = m.indice; bus.emit('clima'); });

// Regla y dibujos de los demás
red.on('regla', (m) => {
  if (m.puntos) S.reglasAjenas.set(m.usuario, m.puntos); else S.reglasAjenas.delete(m.usuario);
  bus.emit('dibujos');
});
red.on('dibujo', (m) => { S.dibujos.push(m.dibujo); S.lapices?.delete(m.dibujo.usuario); bus.emit('dibujos'); });
red.on('lapiz', (m) => {          // alguien está dibujando: su lápiz y su nombre se ven mientras traza
  S.lapices ||= new Map();
  if (m.fin) S.lapices.delete(m.usuario); else S.lapices.set(m.usuario, { x: m.x, y: m.y, t: performance.now() });
  bus.emit('lapices');
});
red.on('dibujos_borrados', (m) => {
  S.dibujos = m.ids ? S.dibujos.filter((d) => !m.ids.includes(d.id)) : [];
  bus.emit('dibujos');
});
red.on('dibujo_bloqueo', (m) => { S.dibujoBloqueado = !!m.activo; bus.emit('dibujos'); });

red.on('tokens', (m) => {
  sonidoDeCambios(m.tokens);
  for (const t of m.tokens) S.tokens.set(t.id, t);
  for (const id of m.quitados) {
    S.tokens.delete(id);
    if (S.tokenFoco === id) S.tokenFoco = S.tokenActivo;
    if (S.tokenActivo === id) S.tokenActivo = null;
  }
  bus.emit('tokens');
});

red.on('combate', (m) => {
  const anterior = S.combate.turno_de;
  S.combate = { activo: m.activo, orden: m.orden, indice: m.indice, ronda: m.ronda, turno_de: m.turno_de, movimiento: m.movimiento || null, preparando: m.preparando || null };
  bus.emit('combate');
  if (m.activo && m.turno_de && m.turno_de !== anterior && esMio(tokenEnTurno())) {
    pitar('turno');
    toast('Es tu turno.', 'turno');
  }
});

red.on('tiendas', (m) => { S.tiendas = m.tiendas; bus.emit('tiendas'); });
red.on('intercambio', (m) => { const nuevo = !S.intercambio; S.intercambio = m; bus.emit('intercambio', nuevo); });
red.on('intercambio_fin', (m) => {
  S.intercambio = null;
  bus.emit('intercambio-fin');
  if (m.motivo === 'completado') toast('Intercambio completado.', 'ok');
  else toast(m.por && m.por !== S.usuario ? `${m.por} canceló el intercambio.` : 'Intercambio cancelado.', 'info');
});
red.on('tiradas', (m) => { S.tiradas = Array.isArray(m.tiradas) ? m.tiradas : []; bus.emit('tiradas'); });
red.on('cofres', (m) => { S.cofres = Array.isArray(m.cofres) ? m.cofres : []; bus.emit('cofres'); });
red.on('diario', (m) => { S.diario = { paginas: Array.isArray(m.paginas) ? m.paginas : [], reglas: m.reglas !== false }; bus.emit('diario'); });
red.on('capas', (m) => { S.capasOcultas = Array.isArray(m.ocultas) ? m.ocultas : []; bus.emit('capas'); });
red.on('niebla', (m) => { S.niebla = Array.isArray(m.mascara) ? m.mascara : null; if ('como' in m) S.nieblaGM = m.como || null; bus.emit('niebla'); });
red.on('ping', (m) => bus.emit('ping', m));
red.on('salas', (m) => { S.salas = m.salas; if (m.usuarios) S.usuariosSalas = m.usuarios; bus.emit('salas'); });
red.on('sala_creada', (m) => bus.emit('sala-creada', m.sala));
red.on('chat_sala_borrada', (m) => { S.chat = S.chat.filter((x) => (x.sala || 'general') !== m.sala); bus.emit('chat-historial'); });

red.on('chat', (m) => {
  const msg = { autor: m.autor, texto: m.texto, categoria: m.categoria, sala: m.sala || 'general', ...(m.detalle ? { detalle: m.detalle } : {}),
    ...(m.mapa ? { mapa: m.mapa } : {}), ...(m.personaje ? { personaje: m.personaje } : {}) };
  S.chat.push(msg);
  if (S.chat.length > 300) S.chat.shift();
  bus.emit('chat-nuevo', msg);
  if (m.categoria === 'dado') pitar('dado');
});

red.on('musica', (m) => { S.musica = m.archivo; reproducir(S.musica, { gradual: !!m.gradual }); bus.emit('musica'); });
red.on('ambiente', (m) => { S.ambiente = m.activos; sincronizarAmbiente(S.ambiente); bus.emit('ambiente'); });
red.on('efecto', (m) => efecto(m.archivo));
red.on('conectados', (m) => { S.conectados = m; bus.emit('conectados'); });
red.on('salas_mapa', (m) => { S.salasMapa = Array.isArray(m.salas) ? m.salas : []; bus.emit('salas-mapa'); });
red.on('cuenta', (m) => { S.cuenta = { tiene_password: !!m.tiene_password }; bus.emit('cuenta'); });
red.on('personajes', (m) => { S.personajes = m.personajes; bus.emit('personajes', m.creado); });

red.on('todos_los_personajes', (m) => { S.todosPersonajes = m.personajes; bus.emit('todos-personajes'); });

red.on('personaje_activo', (m) => {
  S.tokenActivo = m.token;
  S.tokenFoco = m.token;
  recordarPersonaje(m.personaje);
  if (pantalla === 'principal') { bus.emit('foco'); bus.emit('tokens'); return; }     // ya en el mapa (p. ej. se acaba de desplegar): no se reconstruye la pantalla
  irPrincipal();
});

red.on('error', (m) => {
  if (pendiente) { pendiente.fallo(Object.assign(new Error(m.texto), { codigo: m.codigo })); pendiente = null; return; }
  bus.emit('error-servidor', m.texto);
  toast(m.texto, 'error');
  pitar('error');
  if (pantalla === 'cargando') irSeleccion();       // no se pudo entrar con el último personaje: que elija
});

red.on('__cerrado', ({ voluntario }) => {
  if (pendiente) { pendiente.fallo(new Error('Se cerró la conexión con el servidor.')); pendiente = null; return; }
  if (voluntario || pantalla === 'conexion') { irConexion(); return; }
  document.querySelector('.overlay-conexion')?.remove();
  document.body.append(h('div', { class: 'overlay-conexion', role: 'alertdialog' },
    h('div', { class: 'tarjeta-conexion' },
      h('h2', { class: 'titulo-seccion' }, 'Se perdió la conexión'),
      h('p', { class: 'tenue' }, 'El servidor se cerró o se cortó la red. Tu partida sigue guardada en el servidor.'),
      h('button', { class: 'btn btn-acento btn-grande', onclick: () => irConexion() }, 'Volver a conectar'))));
});

bus.on('cambiar-personaje', irSeleccion);
bus.on('ajustes', aplicarVolumen);
aplicarVolumen();

if (location.hash === '#debug') {
  window.__mesa = { S, bus, red, imagen, audio, abrirPersonaje, get vista() { return vistaActual?.vista; }, get pantalla() { return pantalla; } };
}

await iniciarArchivos();
irConexion();

// La página nunca se desplaza entera (solo sus paneles): si algo la mueve al enfocarse, se devuelve a su sitio.
document.addEventListener('scroll', (e) => { if (e.target === document && (scrollY || scrollX)) scrollTo(0, 0); });
