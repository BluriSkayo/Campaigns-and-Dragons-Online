// estado.js — Todo lo que el Editor sabe en un momento dado: la campaña abierta, los borradores, los problemas.
// Cada pestaña abierta tiene un borrador (copia de trabajo). «Guardar» lo escribe en disco; mientras tanto la pestaña muestra un punto.
import { clonar, igual, slug, toast } from './util.js';
import { CATEGORIAS, referenciasDe } from './esquemas.js';
import { renombresPendientes, limpiarOrigenes } from './reglas.js';

const oyentes = new Map();
// Suscripciones atadas a un elemento de la pantalla: se sueltan solas cuando ese elemento deja de estar en el documento
// (si no, cada formulario cerrado quedaba retenido en memoria esperando un evento que casi nunca llega).
const atadas = new Set();          // { el, off, visto }
function barrer() {
  for (const a of atadas) {
    if (a.el.isConnected) a.visto = true;
    else if (a.visto || Date.now() - a.creado > 5000) { a.off(); atadas.delete(a); }
  }
}
/** Versión «en calma» de `fn`: si se llama muchas veces seguidas (cada tecla), solo se ejecuta una vez, al parar. */
export function enCalma(fn, ms = 250) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const bus = {
  on(ev, fn) { if (!oyentes.has(ev)) oyentes.set(ev, new Set()); oyentes.get(ev).add(fn); return () => oyentes.get(ev).delete(fn); },
  /** Como `on`, pero ligada a `el`: se suelta sola cuando `el` sale de la pantalla. */
  mientras(el, ev, fn) { const off = bus.on(ev, fn); atadas.add({ el, off, visto: false, creado: Date.now() }); return off; },
  emit(ev, dato) {
    if (ev === 'pestanas' || ev === 'guardado' || ev === 'campana-cambiada') barrer();
    for (const fn of [...(oyentes.get(ev) || [])]) { try { fn(dato); } catch (e) { console.error(`Error en «${ev}»`, e); } }
  },
};

export const E = {
  info: null,
  campanas: [],
  campana: null,            // { id, config, recursos, assets, problemasLectura }
  cliente: { ruta: null, base: null, conectada: false },   // carpeta «base» de la campaña abierta (imágenes y música)
  esquemaEfectos: null,
  pestanas: [],             // [{ clave, tipo:'recurso'|'reglas', cat, id, borrador, original }] — en la práctica una sola a la vez
  activa: null,
  vista: null,              // qué se ve en el centro: null (inicio) | 'reglas' | 'sonidos' | 'jugadores' | una categoría ('habilidades', 'grupos'…)
  problemas: { estado: 'nada', errores: [], avisos: [], mensaje: '' },
};

export const clave = (cat, id) => `${cat}/${id}`;
export const pestana = (k) => E.pestanas.find((p) => p.clave === k);
const sinOrigen = (b) => JSON.parse(JSON.stringify(b, (k, v) => (k === '_origen' ? undefined : v)));
export const sucia = (p) => !igual(sinOrigen(p.borrador), sinOrigen(p.original));
/** Trabajo pendiente que no es una ficha de recurso (p. ej. la ficha de un jugador que se edita en «Jugadores y fichas», que guarda aparte).
 *  clave → { titulo, sucia(): bool, guardar(): Promise<bool>, descartar() }. La navegación y el cierre lo consultan igual que a las fichas. */
export const PENDIENTES = new Map();
export const hayPendientes = () => [...PENDIENTES.values()].some((x) => x.sucia());
export const haySucias = () => E.pestanas.some(sucia) || hayPendientes();
export const stats = () => (E.campana?.config?.juego?.estadisticas || []).map((e) => e.nombre);
export const recursosJuego = () => (E.campana?.config?.juego?.recursos || []).map((e) => e.nombre);
/** Lo que una fórmula puede citar: estadísticas, recursos y, si la campaña usa niveles, [Nivel]. */
export const nombresFormula = () => [...stats(), ...recursosJuego(), ...(E.campana?.config?.juego?.niveles?.activo ? ['Nivel'] : [])];
// Si el recurso está abierto, se usa el nombre que tiene en pantalla (así uno recién creado se puede elegir a sí mismo con su nombre nuevo).
const nombreAbierto = (cat, id) => E.pestanas?.find((t) => t.tipo === 'recurso' && t.cat === cat && t.id === id)?.borrador?.nombre;
export const lista = (cat) => Object.entries(E.campana?.recursos?.[cat] || {}).map(([id, d]) => ({ id, nombre: nombreAbierto(cat, id) || d?.nombre || id, datos: d }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' }));
export const nombreDe = (cat, id) => E.campana?.recursos?.[cat]?.[id]?.nombre || id;

// ── Orden de las listas («Ordenar por…»): por nombre, por orden de creación o el personalizado (arrastrando; la partida también lo usa) ──
export const MODOS_ORDEN = [['nombre', 'Nombre'], ['creacion', 'Orden de creación'], ['personalizado', 'Personalizado']];
const CLAVE_MODOS = 'editor.ordenListas';
const leerModos = () => { try { return JSON.parse(localStorage.getItem(CLAVE_MODOS) || '{}') || {}; } catch { return {}; } };
/** Cómo se ordena la lista de una vista (enemigos, habilidades, grupos…) en este equipo. Por defecto, por nombre; si la campaña ya
 *  tiene un orden personalizado para esa lista, ese. */
export function modoOrden(vista) {
  const m = leerModos()[`${E.campana?.id}/${vista}`];
  if (MODOS_ORDEN.some(([k]) => k === m)) return m;
  return Object.keys(E.campana?.orden?.personalizado || {}).some((c) => c === vista || (vista === 'grupos' && c === 'opciones')) ? 'personalizado' : 'nombre';
}
export function fijarModoOrden(vista, modo) {
  const m = leerModos();
  m[`${E.campana?.id}/${vista}`] = modo;
  try { localStorage.setItem(CLAVE_MODOS, JSON.stringify(m)); } catch { /* sin almacenamiento: dura hasta cerrar */ }
  bus.emit('orden');
}
/** La lista de una categoría en el orden pedido. «Orden de creación»: los que ya había antes de llevar la cuenta van primero (por
 *  archivo); «Personalizado»: los que el GM colocó, en su sitio, y detrás los demás por nombre de archivo (igual que la partida). */
export function listaOrdenada(cat, modo = 'nombre') {
  const items = lista(cat);
  if (modo === 'nombre') return items;
  const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const posicion = (l) => new Map((l || []).map((id, i) => [id, i]));
  if (modo === 'creacion') {
    const p = posicion(E.campana?.orden?.creacion?.[cat]);
    return [...items].sort((a, b) => (p.has(a.id) - p.has(b.id)) || ((p.get(a.id) ?? 0) - (p.get(b.id) ?? 0)) || porId(a, b));
  }
  const p = posicion(E.campana?.orden?.personalizado?.[cat]);
  const fuera = Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => ((p.get(a.id) ?? fuera) - (p.get(b.id) ?? fuera)) || porId(a, b));
}
/** Mueve `id` justo antes (o después) de `junto` en el orden personalizado de `cat`, partiendo de cómo se ve ahora la lista (`modo`),
 *  y lo guarda. La vista pasa a «Personalizado». */
export async function moverEnOrden(cat, id, junto, despues, vista = cat, modo = modoOrden(vista)) {
  if (!E.campana || id === junto) return false;
  const ids = listaOrdenada(cat, modo).map((i) => i.id).filter((x) => x !== id);
  const i = ids.indexOf(junto);
  if (i < 0) return false;
  ids.splice(despues ? i + 1 : i, 0, id);
  E.campana.orden = await window.editor.guardarOrden(E.campana.id, cat, ids);
  fijarModoOrden(vista, 'personalizado');
  return true;
}
/** Lo que creó el Editor (recurso nuevo o duplicado): la API lo apunta en campana.yaml; aquí se refleja sin recargar. */
function apuntarCreadoLocal(cat, id) {
  const o = (E.campana.orden ||= { personalizado: {}, creacion: {} });
  (o.creacion[cat] ||= []).push(id);
  if (o.personalizado[cat] && !o.personalizado[cat].includes(id)) o.personalizado[cat].push(id);
}
function renombrarEnOrdenLocal(cat, viejo, nuevo) {
  for (const k of ['creacion', 'personalizado']) {
    const l = E.campana.orden?.[k]?.[cat];
    const i = l ? l.indexOf(viejo) : -1;
    if (i >= 0) l[i] = nuevo;
  }
}

// ── Campañas ──
export async function iniciar() {
  E.info = await window.editor.info();
  E.esquemaEfectos = await window.editor.esquemaEfectos().catch(() => null);
  await refrescarCampanas();
}
export async function refrescarCampanas() {
  E.campanas = await window.editor.campanas();
  bus.emit('campanas');
}
/** La primera vez, al abrir el Editor se instalan en segundo plano los componentes de Python. Cuando terminan, se vuelve a pedir lo que dependía de ellos. */
export async function esperarEntorno() {
  if (!E.info?.preparando) return;
  toast('Preparando el Editor: instalando los componentes que faltan (solo la primera vez, necesita internet)…', 'info', 8000);
  while (E.info.preparando) {
    await new Promise((r) => setTimeout(r, 1500));
    E.info = await window.editor.info();
  }
  if (E.info.python) {
    E.esquemaEfectos = await window.editor.esquemaEfectos().catch(() => null);
    await validar();
    bus.emit('entorno');
    toast('Componentes instalados: ya funciona todo.', 'ok', 4000);
  } else {
    toast(E.info.error || 'No se pudieron instalar los componentes de Python.', 'error', 12000);
  }
}
export async function abrirCampana(id) {
  const c = await window.editor.cargar(id);
  E.campana = { ...c, problemasLectura: c.problemas || [] };
  E.cliente = c.cliente || E.cliente;
  E.pestanas = [];
  E.activa = null;
  E.vista = null;
  bus.emit('campana');
  if (c.migrados) toast(`Esta campaña ahora guarda sus imágenes y sonidos en su propia carpeta: copié ${c.migrados} archivos desde la carpeta del cliente.`, 'ok', 8000);
  await validar();
}
export async function recargarAssets() {
  E.campana.assets = await window.editor.assets();
  E.cliente = await window.editor.cliente();
  bus.emit('assets');
}

/** Imágenes que un recurso cita pero que no están en la carpeta de archivos de la campaña (el servidor no puede comprobarlo). */
function imagenesFaltantes() {
  if (!E.cliente?.conectada) return [];
  const hay = new Set(Object.entries(E.campana.assets || {}).flatMap(([c, l]) => l.map((f) => `${c}/${f}`)));
  const avisos = [];
  const mirar = (v, donde) => {
    if (typeof v === 'string') { if (/^(tokens|maps|icons|tiles|otros)\/.+\.(png|jpe?g|gif|webp)$/i.test(v) && !hay.has(v)) avisos.push(`${donde}: la imagen «${v}» no está en los archivos de la campaña`); }
    else if (Array.isArray(v)) v.forEach((x) => mirar(x, donde));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => mirar(x, donde));
  };
  for (const [cat, items] of Object.entries(E.campana.recursos || {})) for (const [id, d] of Object.entries(items)) {
    mirar(d, `${CARPETA_DE[cat] || cat}/${id}.yaml`);
  }
  // Los audios se buscan en base/sonido/<tipo> de la campaña.
  for (const [tipo, grupos] of Object.entries(E.campana.sonidos || {})) {
    const faltan = grupos.flatMap((g) => g.archivos).filter((a) => !hay.has(`sonido/${tipo}/${a}`));
    if (faltan.length) avisos.push(`sonidos.yaml: ${faltan.length === 1 ? `el archivo «${faltan[0]}» de ${tipo} no está` : `${faltan.length} archivos de ${tipo} no están (${faltan.slice(0, 3).join(', ')}${faltan.length > 3 ? '…' : ''})`} en la carpeta base/sonido/${tipo} de la campaña (los jugadores sin él lo verán en rojo)`);
  }
  return avisos;
}
const CARPETA_DE = { habilidades: 'abilities', objetos: 'items', enemigos: 'enemies', grupos: 'groups', opciones: 'options', rasgos: 'traits', estados: 'states', tiendas: 'shops', mapas: 'maps', tiles: 'tiles' };

// ── Validación (la hace el propio servidor, así el Editor nunca contradice al juego) ──
let validando = 0;
let enCurso = null, otraVez = false;       // una sola validación a la vez: si se guarda mientras valida, se repite UNA vez al terminar
export async function validar() {
  if (!E.campana) return;
  if (enCurso) { otraVez = true; return enCurso; }
  enCurso = validarYa().finally(() => { enCurso = null; if (otraVez) { otraVez = false; validar(); } });
  return enCurso;
}
async function validarYa() {
  const turno = ++validando;
  E.problemas = { ...E.problemas, estado: 'validando' };
  bus.emit('problemas');
  try {
    const r = await window.editor.validar(E.campana.id);
    if (turno !== validando) return;
    const lectura = (E.campana.problemasLectura || []).map((t) => t);
    E.problemas = { estado: r.errores.length || lectura.length ? 'error' : 'ok', errores: [...lectura, ...r.errores], avisos: [...r.avisos, ...imagenesFaltantes()], mensaje: '' };
  } catch (e) {
    if (turno !== validando) return;
    E.problemas = { estado: 'sin-python', errores: [], avisos: [], mensaje: e.message };
  }
  bus.emit('problemas');
}

// ── Fichas abiertas ──
// El centro muestra una categoría (su lista) y, como mucho, una ficha abierta a la vez. Al abrir otra, las fichas
// sin cambios se cierran solas; las que tienen cambios las resuelve antes la interfaz (navegacion.js pregunta).
export const VISTAS_COMPLETAS = ['reglas', 'sonidos', 'jugadores'];
export const vistaDe = (cat) => (cat === 'opciones' ? 'grupos' : cat);
export const vistaDePestana = (p) => (p.tipo === 'recurso' ? vistaDe(p.cat) : p.tipo);
function soltarLimpias(excepto) {
  E.pestanas = E.pestanas.filter((p) => p.clave === excepto || sucia(p));
  if (E.activa && !pestana(E.activa)) E.activa = null;
}
export function verCategoria(v) {
  if (VISTAS_COMPLETAS.includes(v)) { ({ reglas: abrirReglas, sonidos: abrirSonidos, jugadores: abrirJugadores })[v](); return; }
  const a = pestana(E.activa);
  soltarLimpias(a && vistaDePestana(a) === v ? a.clave : null);
  if (a && vistaDePestana(a) !== v) E.activa = null;
  E.vista = v;
  bus.emit('pestanas');
}
export function abrir(cat, id) {
  const k = clave(cat, id);
  if (!pestana(k)) {
    const datos = E.campana.recursos[cat]?.[id];
    if (!datos) return;
    E.pestanas.push({ clave: k, tipo: 'recurso', cat, id, borrador: clonar(datos), original: clonar(datos) });
  }
  soltarLimpias(k);
  E.vista = vistaDe(cat);
  activar(k);
}
export function abrirReglas(seccion = null) {
  if (!pestana('reglas')) {
    const c = E.campana.config;
    E.pestanas.push({ clave: 'reglas', tipo: 'reglas', borrador: clonar(c), original: clonar(c), seccion });
  }
  if (seccion) pestana('reglas').seccion = seccion;
  soltarLimpias('reglas');
  E.vista = 'reglas';
  activar('reglas');
}
export function abrirJugadores() {
  if (!pestana('jugadores')) E.pestanas.push({ clave: 'jugadores', tipo: 'jugadores', borrador: {}, original: {} });
  soltarLimpias('jugadores');
  E.vista = 'jugadores';
  activar('jugadores');
}
export function abrirSonidos() {
  if (!pestana('sonidos')) {
    const d = E.campana.sonidos || { musica: [], ambiente: [], efectos: [] };
    E.pestanas.push({ clave: 'sonidos', tipo: 'sonidos', borrador: clonar(d), original: clonar(d) });
  }
  soltarLimpias('sonidos');
  E.vista = 'sonidos';
  activar('sonidos');
}
export function activar(k) { E.activa = k; bus.emit('pestanas'); }
export function cambio() { bus.emit('cambio'); }

// ── Deshacer / rehacer (por pestaña) ──
// Cada pestaña recuerda sus estados anteriores. Los cambios seguidos (escribir, arrastrar un pincel) se agrupan en uno solo.
const HIST_MAX = 100;
const instantanea = (p) => JSON.stringify(p.borrador);
export function iniciarHistorial(p) { if (!p.hist) p.hist = { pasado: [], futuro: [], base: instantanea(p), timer: null }; }
function confirmarHist(p) {
  const H = p.hist; if (!H) return;
  clearTimeout(H.timer); H.timer = null;
  const s = instantanea(p);
  if (s === H.base) return;
  H.pasado.push(H.base); if (H.pasado.length > HIST_MAX) H.pasado.shift();
  H.base = s; H.futuro = [];
}
bus.on('cambio', () => {
  const p = pestana(E.activa); if (!p) return;
  iniciarHistorial(p);
  clearTimeout(p.hist.timer); p.hist.timer = setTimeout(() => { confirmarHist(p); bus.emit('historial'); }, 350);
});
export function puedeDeshacer(p = pestana(E.activa)) { if (!p?.hist) return false; return p.hist.pasado.length > 0 || instantanea(p) !== p.hist.base; }
export function puedeRehacer(p = pestana(E.activa)) { return !!p?.hist?.futuro.length; }
/** Vuelve a un estado guardado sin cambiar el objeto del borrador (así el editor de mapas sigue con su zoom, pincel y capa). */
function restaurar(p, texto) {
  const n = JSON.parse(texto);
  for (const k of Object.keys(p.borrador)) if (!(k in n)) delete p.borrador[k];
  Object.assign(p.borrador, n);
  bus.emit('restaurado', p);
}
export function deshacer() {
  const p = pestana(E.activa); if (!p) return false;
  iniciarHistorial(p); confirmarHist(p);
  const H = p.hist; if (!H.pasado.length) return false;
  H.futuro.push(H.base); H.base = H.pasado.pop(); restaurar(p, H.base);
  return true;
}
export function rehacer() {
  const p = pestana(E.activa); if (!p?.hist?.futuro.length) return false;
  confirmarHist(p);
  const H = p.hist; if (!H.futuro.length) return false;
  H.pasado.push(H.base); H.base = H.futuro.pop(); restaurar(p, H.base);
  return true;
}

export function cerrarPestana(k) {
  const i = E.pestanas.findIndex((p) => p.clave === k);
  if (i < 0) return;
  E.pestanas.splice(i, 1);
  if (E.activa === k) E.activa = null;   // se vuelve a la lista de la categoría
  bus.emit('pestanas');
}

// ── Guardar ──
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function renombrarFormula(texto, viejo, nuevo) {
  return String(texto).replace(new RegExp(`\\[(\\s*(?:[ao]\\.)?\\s*)${escapar(viejo)}(\\s*)\\]`, 'gi'), (_m, a, z) => `[${a}${nuevo}${z}]`);
}
function renombrarClaves(obj, mapa) {
  if (!obj || typeof obj !== 'object') return obj;
  const r = {};
  for (const [k, v] of Object.entries(obj)) r[mapa[k] ?? k] = v;
  return r;
}

/** Recorre un trozo de recurso y cambia los nombres citados en campos «estadistica»/«recurso» y en cualquier fórmula. */
function renombrarProfundo(x, ren, nombres) {
  if (Array.isArray(x)) { for (const y of x) renombrarProfundo(y, ren, nombres); return; }
  if (!x || typeof x !== 'object') return;
  for (const [k, v] of Object.entries(x)) {
    if (typeof v === 'string') {
      if (k === 'estadistica' && ren.stats[v]) x[k] = ren.stats[v];
      else if (k === 'recurso' && ren.recursos[v]) x[k] = ren.recursos[v];
      else if (/formula|valor|cantidad/i.test(k)) for (const [a, b] of Object.entries(nombres)) x[k] = renombrarFormula(x[k], a, b);
    } else renombrarProfundo(v, ren, nombres);
  }
}

/** Renombres dentro de una lista de efectos (condiciones, acciones y fórmulas). */
function renombrarEnEfectos(lista, ren) {
  const nombres = { ...ren.stats, ...ren.recursos };
  const etq = ren.etiquetas || {};
  for (const e of Array.isArray(lista) ? lista : []) {
    for (const c of Array.isArray(e.si) ? e.si : []) {
      if (c.estadistica && ren.stats[c.estadistica]) c.estadistica = ren.stats[c.estadistica];
      if (c.recurso && ren.recursos[c.recurso]) c.recurso = ren.recursos[c.recurso];
      if (c.etiqueta && etq[c.etiqueta]) c.etiqueta = etq[c.etiqueta];
    }
    if (e.cuando?.estadistica && ren.stats[e.cuando.estadistica]) e.cuando.estadistica = ren.stats[e.cuando.estadistica];
    if (e.cuando?.recurso && ren.recursos[e.cuando.recurso]) e.cuando.recurso = ren.recursos[e.cuando.recurso];       // «al cruzar un umbral»
    if (e.hacer?.estadistica && ren.stats[e.hacer.estadistica]) e.hacer.estadistica = ren.stats[e.hacer.estadistica];
    if (e.hacer?.recurso && ren.recursos[e.hacer.recurso]) e.hacer.recurso = ren.recursos[e.hacer.recurso];
    if (e.hacer?.formula) for (const [v, nv] of Object.entries(nombres)) e.hacer.formula = renombrarFormula(e.hacer.formula, v, nv);
  }
}

/** Cambia el nombre de estadísticas o recursos en TODO lo que los cita (fórmulas, bonos, costes…). Devuelve cuántos recursos cambió. */
async function aplicarRenombres(ren) {
  const nombres = { ...ren.stats, ...ren.recursos };
  const etq = ren.etiquetas || {};
  if (!Object.keys(nombres).length && !Object.keys(etq).length) return 0;
  let cambiados = 0;
  const celdas = { stats: ren.stats, recursos: ren.recursos };
  for (const [cat, items] of Object.entries(E.campana.recursos)) {
    for (const [id, d] of Object.entries(items)) {
      const n = clonar(d);
      if (Array.isArray(n.etiquetas)) n.etiquetas = n.etiquetas.map((x) => etq[x] ?? x);
      if (Array.isArray(n.impide_etiquetas)) n.impide_etiquetas = n.impide_etiquetas.map((x) => etq[x] ?? x);      // estados: «Silencio» de una etiqueta
      for (const e of Array.isArray(n.efectos) ? n.efectos : []) for (const c of Array.isArray(e.si) ? e.si : []) if (c.etiqueta && etq[c.etiqueta]) c.etiqueta = etq[c.etiqueta];
      if (cat === 'habilidades') { n.coste = renombrarClaves(n.coste, ren.recursos); if (n.formula) for (const [v, nv] of Object.entries(nombres)) n.formula = renombrarFormula(n.formula, v, nv); }
      if (cat === 'objetos' && n.efecto?.recurso && ren.recursos[n.efecto.recurso]) n.efecto.recurso = ren.recursos[n.efecto.recurso];
      if (cat === 'enemigos') { n.stats = renombrarClaves(n.stats, ren.stats); n.recursos = renombrarClaves(n.recursos, ren.recursos); }
      if (cat === 'opciones') { n.bonos = renombrarClaves(n.bonos, ren.stats); if (n.estadisticas) n.estadisticas = renombrarClaves(n.estadisticas, ren.stats); if (n.recursos) n.recursos = renombrarClaves(n.recursos, ren.recursos); }
      // Efectos, requisitos y fórmulas de CUALQUIER recurso (habilidades incluidas): se recorre todo lo que cite una estadística o un recurso.
      for (const k of ['efectos', 'requisitos', 'efecto']) if (n[k]) renombrarProfundo(n[k], ren, nombres);
      if (!igual(n, d)) {
        await window.editor.guardarRecurso(E.campana.id, cat, id, n);
        E.campana.recursos[cat][id] = n;
        const t = pestana(clave(cat, id));
        if (t) { t.borrador = clonar(n); t.original = clonar(n); }
        cambiados++;
      }
    }
  }
  void celdas;
  return cambiados;
}

export async function guardar(k) {
  const p = pestana(k);
  if (!p) return false;
  if (p.tipo === 'reglas') {
    const ren = renombresPendientes(p.borrador);
    const hayRen = Object.keys(ren.stats).length + Object.keys(ren.recursos).length + Object.keys(ren.etiquetas || {}).length > 0;
    if (hayRen && E.pestanas.some((t) => t.tipo === 'recurso' && sucia(t))) {
      throw new Error('Cambiaste nombres de estadísticas o recursos. Guarda (o descarta) antes los demás recursos abiertos para que se actualicen bien.');
    }
    const j = p.borrador.juego;
    if (hayRen) {
      if (ren.stats[j.estadistica_iniciativa]) j.estadistica_iniciativa = ren.stats[j.estadistica_iniciativa];
      if (j.movimiento && ren.stats[j.movimiento.estadistica]) j.movimiento.estadistica = ren.stats[j.movimiento.estadistica];
      renombrarEnEfectos(j.efectos, ren);          // las reglas automáticas de la propia campaña también citan estadísticas, recursos y etiquetas
      for (const x of [...(j.estadisticas || []), ...(j.recursos || [])]) for (const k of ['formula', 'maximo_formula']) {      // fórmulas de calculadas
        if (x[k]) for (const [a, b] of Object.entries({ ...ren.stats, ...ren.recursos })) x[k] = renombrarFormula(x[k], a, b);
      }
      await aplicarRenombres(ren);
    }
    const limpio = sinOrigen(p.borrador);
    await window.editor.guardarConfig(E.campana.id, limpio);
    E.campana.config = clonar(limpio);
    p.original = clonar(limpio);
    limpiarOrigenes(p.borrador);
    for (const lista of [p.borrador.juego?.estadisticas, p.borrador.juego?.recursos, p.borrador.juego?.etiquetas]) for (const x of lista || []) x._origen = x.nombre;
    bus.emit('campana-cambiada');
  } else if (p.tipo === 'sonidos') {
    await window.editor.guardarSonidos(E.campana.id, p.borrador);
    E.campana.sonidos = clonar(p.borrador);
    p.original = clonar(p.borrador);
  } else if (p.tipo === 'jugadores') {
    // Las fichas se guardan una a una con su botón; «Guardar» aquí guarda la ficha abierta (si hay)
    const b = document.querySelector('[data-accion="guardar-ficha"]');
    if (!b) throw new Error('Aquí no hay nada que guardar: abre una ficha y pulsa «Guardar ficha».');
    b.click();
    return false;
  } else {
    if (!String(p.borrador.nombre || '').trim()) {
      const tipo = CATEGORIAS[p.cat]?.singular || 'este elemento';
      throw new Error(`Ponle un nombre a ${tipo} «${p.id}» antes de guardar (el campo «Nombre» es obligatorio).`);
    }
    // Recién creado («Habilidad nueva 3»): al guardarlo por primera vez con su nombre de verdad, su archivo pasa a llamarse como él
    // (bola_de_fuego.yaml), siempre que nada lo cite todavía.
    if (p.idProvisional) {
      p.idProvisional = false;
      const base = slug(p.borrador.nombre, CATEGORIAS[p.cat].singular);
      if (base !== p.id && !p.id.startsWith(`${base}_`) && !usadoPor(p.cat, p.id).length && !citadoEnOtraParte(p)) {
        const viejo = p.id, nuevoId = idLibre(p.cat, p.borrador.nombre);
        cambiarId(p.borrador, viejo, nuevoId);          // si se cita a sí mismo (un estado que pasa a otro, que se renueva…)
        await window.editor.renombrarRecurso(E.campana.id, p.cat, viejo, nuevoId, p.borrador);
        delete E.campana.recursos[p.cat][viejo];
        renombrarEnOrdenLocal(p.cat, viejo, nuevoId);
        const antes = p.clave;
        p.id = nuevoId; p.clave = clave(p.cat, nuevoId);
        if (E.activa === antes) E.activa = p.clave;
        bus.emit('campana-cambiada');
      }
    }
    await window.editor.guardarRecurso(E.campana.id, p.cat, p.id, p.borrador);
    E.campana.recursos[p.cat][p.id] = clonar(p.borrador);
    p.original = clonar(p.borrador);
  }
  bus.emit('guardado');
  bus.emit('pestanas');
  validar();
  return true;
}
export async function guardarTodo() {
  for (const p of E.pestanas.filter(sucia)) await guardar(p.clave);
}
export function descartar(k) {
  const p = pestana(k);
  if (p) { p.borrador = clonar(p.original); p.hist = null; bus.emit('pestanas'); }
}

// ── Crear, duplicar, eliminar ──
const existe = (cat, id) => !!E.campana.recursos[cat]?.[id];
export function idLibre(cat, nombre) {
  const base = slug(nombre, CATEGORIAS[cat].singular);
  if (!existe(cat, base)) return base;
  for (let i = 2; i < 1000; i++) if (!existe(cat, `${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now()}`;
}
export async function nuevo(cat, extra = {}, opc = {}) {
  const def = CATEGORIAS[cat];
  const datos = { ...def.plantilla(E.campana), ...extra };
  let nombre = opc.nombre || def.nombreNuevo(lista(cat).length + 1);
  if (!opc.nombre) {            // «Nueva categoría», «Nueva categoría 2»…: que cada nueva se distinga en la lista
    const usados = new Set(lista(cat).map((r) => String(r.nombre ?? '').toLowerCase()));
    for (let i = 2, base = nombre; usados.has(nombre.toLowerCase()); i++) nombre = `${base} ${i}`;
  }
  datos.nombre = nombre;
  const id = idLibre(cat, nombre);
  await window.editor.guardarRecurso(E.campana.id, cat, id, datos);
  E.campana.recursos[cat][id] = clonar(datos);
  apuntarCreadoLocal(cat, id);
  bus.emit('campana-cambiada');
  if (opc.abrir !== false) { abrir(cat, id); const p = pestana(clave(cat, id)); if (p) p.idProvisional = true; }
  validar();
  return id;
}
/** Cambia la categoría de un NPC (al arrastrarlo a otra en la lista) y la guarda al momento. Si su ficha está abierta con otros
 *  cambios sin guardar, esos siguen sin guardar: solo se guarda la categoría. `categoria` vacía = sin categoría. */
export async function cambiarCategoriaNpc(id, categoria) {
  const actual = E.campana?.recursos?.enemigos?.[id];
  if (!actual) return false;
  const c = String(categoria || '').trim().slice(0, 40);
  if (String(actual.categoria || '').trim() === c) return false;
  const datos = clonar(actual);
  if (c) datos.categoria = c; else delete datos.categoria;
  await window.editor.guardarRecurso(E.campana.id, 'enemigos', id, datos);
  E.campana.recursos.enemigos[id] = clonar(datos);
  const p = pestana(clave('enemigos', id));
  if (p) {
    for (const x of [p.borrador, p.original]) { if (c) x.categoria = c; else delete x.categoria; }
    if (p.hist) p.hist.base = instantanea(p);        // «Deshacer» no debe devolver la categoría de antes (ya está guardada)
    if (E.activa === p.clave) bus.emit('restaurado', p);      // su ficha abierta muestra la categoría nueva
  }
  bus.emit('guardado');
  bus.emit('pestanas');
  validar();
  return true;
}
export async function duplicar(k) {
  const p = pestana(k) || (() => { const [cat, id] = k.split('/'); return { cat, id, borrador: E.campana.recursos[cat][id] }; })();
  const datos = clonar(p.borrador);
  datos.nombre = `${datos.nombre} (copia)`;
  const id = idLibre(p.cat, datos.nombre);
  await window.editor.guardarRecurso(E.campana.id, p.cat, id, datos);
  E.campana.recursos[p.cat][id] = clonar(datos);
  apuntarCreadoLocal(p.cat, id);
  bus.emit('campana-cambiada');
  abrir(p.cat, id);
  validar();
}
/** Cambia, sin crear objetos nuevos (los formularios abiertos siguen apuntando a ellos), cada texto igual a `viejo` por `nuevo`. */
function cambiarId(x, viejo, nuevo) {
  if (!x || typeof x !== 'object') return;
  for (const k of Object.keys(x)) {
    if (x[k] === viejo) x[k] = nuevo;
    else cambiarId(x[k], viejo, nuevo);
  }
}

/** ¿Algo que no son los recursos guardados cita este id? (reglas de la campaña y lo que está abierto sin guardar).
 *  Si es así, un recurso recién creado conserva su id provisional en vez de cambiar de archivo: así ninguna referencia queda rota. */
function citadoEnOtraParte(p) {
  const buscado = JSON.stringify(p.id);
  if (JSON.stringify(E.campana.config || {}).includes(buscado)) return true;
  return E.pestanas.some((t) => t !== p && t.borrador && JSON.stringify(t.borrador).includes(buscado));
}

export function usadoPor(cat, id) {
  const res = [];
  for (const [c, items] of Object.entries(E.campana.recursos)) {
    for (const [i, d] of Object.entries(items)) {
      if (referenciasDe(c, d).some(([rc, ri]) => rc === cat && ri === id)) res.push({ cat: c, id: i, nombre: d?.nombre || i });
    }
  }
  if (cat === 'mapas' && E.campana.config?.juego?.mapa_inicial === id) res.push({ cat: 'reglas', id: 'reglas', nombre: 'Reglas del juego (mapa inicial)' });
  return res;
}
/** Un recurso que vuelve de la papelera (ya está en su carpeta): se añade a lo que muestra el Editor. */
export function incorporarRecurso(cat, id, datos) {
  E.campana.recursos[cat][id] = clonar(datos);
  apuntarCreadoLocal(cat, id);
  bus.emit('campana-cambiada');
  validar();
}
export async function eliminar(cat, id) {
  await window.editor.borrarRecurso(E.campana.id, cat, id);
  delete E.campana.recursos[cat][id];
  cerrarPestana(clave(cat, id));
  bus.emit('campana-cambiada');
  validar();
}

/** Nombre de una categoría tal como la llama la campaña («Hechizos» en vez de «Habilidades»; Reglas → Funciones de la mesa). */
const CLAVE_NOMBRE = { habilidades: 'habilidades', rasgos: 'rasgos', estados: 'estados', diario: 'diario' };
export function pluralDe(cat, defecto) {
  const k = CLAVE_NOMBRE[cat];
  return (k && E.campana?.config?.juego?.nombres?.[k]) || defecto;
}
