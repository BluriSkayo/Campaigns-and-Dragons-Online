// almacen.js — Estado del cliente (lo que el servidor nos ha contado) y un bus de eventos.
// El cliente NO decide nada del juego: solo guarda y muestra lo que envía el servidor.

const oyentes = new Map();

export const bus = {
  on(evento, fn) {
    if (!oyentes.has(evento)) oyentes.set(evento, new Set());
    oyentes.get(evento).add(fn);
    return () => oyentes.get(evento)?.delete(fn);
  },
  emit(evento, datos) {
    for (const fn of [...(oyentes.get(evento) || [])]) {
      try { fn(datos); } catch (e) { console.error(`Error en oyente de «${evento}»`, e); }
    }
  },
};

const COMBATE_VACIO = { activo: false, orden: [], indice: 0, ronda: 1, turno_de: null };

export const S = {
  url: '',
  host: '',
  servidor: null,       // {nombre}
  usuario: '',
  esGM: false,
  permisos: {},
  catalogo: null,
  personajes: [],
  todosPersonajes: [],  // solo GM: personajes de todos los usuarios
  conectados: null,     // solo GM: quién está conectado y con qué personajes
  cofres: [],           // inventarios de grupo que puede ver este usuario
  tiradas: [],          // tiradas guardadas de este usuario ({nombre, expresion})
  diario: { paginas: [], reglas: true },   // páginas del diario que puede leer este usuario (las manda el servidor)
  mapaId: null,
  mapa: null,
  tokens: new Map(),
  combate: { ...COMBATE_VACIO },
  chat: [],
  niebla: null,         // niebla de guerra: filas de '1' (se ve) y '0' (oculto); null = sin niebla
  capasOcultas: [],     // capas de detalle (2 y 3) que el GM ha ocultado a todos
  tiendas: [],          // tiendas abiertas [{id, nombre, recompra, articulos[{objeto,precio,stock}]}]
  intercambio: null,    // intercambio en curso {id, partes[...]}
  salas: [],            // salas de chat privadas que puedo ver [{id, nombre, miembros}]
  usuariosSalas: [],    // solo GM: usuarios que se pueden invitar a una sala
  musica: null,
  ambiente: [],         // sonidos de ambiente activos (nombres de archivo)
  periodo: 0,           // momento del día actual (índice en catalogo.ciclo.periodos)
  clima: 0,             // clima actual (índice en catalogo.clima.tipos)
  dibujos: [],          // trazos temporales de los usuarios sobre el mapa
  dibujoBloqueado: false,
  reglasAjenas: new Map(),   // usuario → puntos de la regla que está usando ahora
  tokenActivo: null,    // el token de mi personaje
  tokenFoco: null,      // el token seleccionado (para ficha e inventario)
};

export function reiniciar() {
  Object.assign(S, {
    url: '', host: '', servidor: null, usuario: '', esGM: false, permisos: {}, catalogo: null,
    personajes: [], todosPersonajes: [], conectados: null, salasMapa: [], mapaId: null, mapa: null, tokens: new Map(), combate: { ...COMBATE_VACIO },
    chat: [], tiendas: [], intercambio: null, salas: [], usuariosSalas: [], musica: null, ambiente: [], periodo: 0, clima: 0, niebla: null, nieblaActiva: false, nieblaGM: null, capasOcultas: [], cofres: [], tiradas: [], diario: { paginas: [], reglas: true }, dibujos: [], dibujoBloqueado: false, reglasAjenas: new Map(), tokenActivo: null, tokenFoco: null,
  });
}

/** El tile de una casilla (null = suelo libre sin tile). */
export function tileEn(x, y) {
  const id = S.mapa?.celdas?.[y]?.[x];
  return id ? S.catalogo?.tiles?.[id] || null : null;
}

export const tokenFoco = () => S.tokens.get(S.tokenFoco) || S.tokens.get(S.tokenActivo) || null;
export const tokenEnTurno = () => (S.combate.turno_de ? S.tokens.get(S.combate.turno_de) || null : null);
export const esMio = (t) => !!t && t.tipo === 'personaje' && t.dueno === S.usuario;
/** Bando de un token: «jugador», o para un NPC «aliado», «neutral» o «enemigo» (el servidor lo envía en cada token). */
export const bandoDe = (t) => t.bando || (t.tipo === 'enemigo' ? 'enemigo' : 'jugador');
/** Cómo se presenta un token en las fichas: «Enemigo», «NPC neutral», «NPC aliado», «Tu personaje»… */
export const quienEs = (t) => (t.tipo === 'personaje'
  ? (esMio(t) ? 'Tu personaje' : `Personaje de ${t.dueno}`)
  : t.controlado_por === S.usuario && t.controlado_por ? 'NPC que controlas'
  : { enemigo: 'NPC enemigo', neutral: 'NPC neutral', aliado: 'NPC aliado' }[bandoDe(t)] || 'NPC');
/** ¿Manejo yo este token? Mi personaje, o un NPC que el GM me ha dado («Controlado por»). */
export const controloYo = (t) => esMio(t) || (!!t && t.tipo === 'enemigo' && !!t.controlado_por && t.controlado_por === S.usuario);
export const puedoControlar = (t) => !!t && (S.esGM || controloYo(t));
export const puedoMover = (t) => puedoControlar(t) || (!!S.permisos.mover_tokens_ajenos && t.tipo === 'personaje');
export const puedoTerminarTurno = () => {
  const t = tokenEnTurno();
  return !!t && S.combate.activo && puedoControlar(t);
};
export const vidaDe = (t) => t?.recursos?.[S.catalogo?.recurso_vida] || null;

/** ¿El objeto del mapa ocupa esta casilla? (los objetos pueden medir varias casillas: ancho × alto desde x, y). */
/** Lo que se puede romper en una casilla: { nombre, golpes } de un tile rompible o de un objeto destruible, o null. */
export function rompibleEn(cx, cy) {
  const t = tileEn(cx, cy);
  if (t?.rompible) return { nombre: t.nombre, golpes: t.rompible.golpes };
  const o = (S.mapa?.objetos || []).find((x) => x.destruible && objetoCubre(x, cx, cy));
  return o ? { nombre: o.nombre, golpes: o.destruible } : null;
}
export const objetoCubre = (o, cx, cy) => cx >= o.x && cy >= o.y && cx < Math.max(o.x + 1, Math.ceil(o.x + (o.ancho || 1) - 1e-9)) && cy < Math.max(o.y + 1, Math.ceil(o.y + (o.alto || 1) - 1e-9));

/** Palabras de la interfaz que la campaña puede cambiar («Hechizos» en vez de «Habilidades», «Investigador» en vez de «Personaje»…). */
export const palabra = (clave, defecto) => S.catalogo?.nombres?.[clave] || defecto;

/** «3 casillas», «4,5 m» o «15 pies»: una distancia en casillas con la medida que eligió el GM en el Editor. */
export function textoMedida(n) {
  const m = S.catalogo?.medida || {};
  if (!m.unidad || m.unidad === 'casillas') return `${n} ${n === 1 ? 'casilla' : 'casillas'}`;
  const v = Math.round(n * (m.tamano || 1) * 100) / 100;
  return `${String(v).replace('.', ',')} ${m.unidad === 'metros' ? 'm' : v === 1 ? 'pie' : 'pies'}`;
}

/** Estadísticas en bloques por categoría (si la campaña lo activó en el Editor): [[categoría | null, [estadísticas]], …]. */
export function gruposEstadisticas(lista) {
  if (!S.catalogo?.categorias_estadisticas || !lista.some((e) => e.categoria)) return [[null, lista]];
  const g = new Map();
  for (const e of lista) { const c = e.categoria || 'Otras'; if (!g.has(c)) g.set(c, []); g.get(c).push(e); }
  if (g.has('Otras')) { const o = g.get('Otras'); g.delete('Otras'); g.set('Otras', o); }
  return [...g];
}
