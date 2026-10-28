// ventanas/elegir.js — Ventanas para elegir una cosa de una lista (en vez de llenar el menú del clic derecho):
// a qué forma transformarse, qué token desplegar en una casilla, con quién usar un objeto y a quién dárselo.
import { h } from '../util.js';
import { S, esMio, controloYo } from '../almacen.js';
import { dialogo, confirmar } from '../dialogo.js';
import { retrato } from '../retrato.js';
import { red } from '../red.js';
import { desplegarPersonaje } from '../acciones.js';

const ICONO_BANDO = { aliado: '🟦', neutral: '🟨', enemigo: '🟥' };
export const distancia = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Una tarjeta pulsable con imagen, nombre y una línea de detalle. */
function tarjeta({ imagen, nombre, detalle, deshabilitado, actual, datos = {}, alPulsar }) {
  return h('button', { type: 'button', class: `elegir-tarjeta${actual ? ' actual' : ''}`, disabled: !!deshabilitado, title: detalle || null,
    ...datos, onclick: alPulsar },
  retrato(imagen, nombre, 'retrato retrato-mini'),
  h('span', { class: 'elegir-texto' }, h('strong', null, nombre), detalle ? h('span', { class: 'tenue pequeno' }, detalle) : null));
}

/** Lista con buscador (si hay muchas) y secciones con título. `secciones`: [{ titulo, elementos: [tarjeta…] }]. */
function listaConBuscador(secciones, total) {
  const cuerpo = h('div', { class: 'elegir-lista' });
  const pintar = (filtro = '') => {
    const f = filtro.trim().toLowerCase();
    cuerpo.replaceChildren(...secciones.flatMap(({ titulo, elementos }) => {
      const vis = elementos.filter((el) => !f || el.textContent.toLowerCase().includes(f));
      return vis.length ? [titulo ? h('h4', { class: 'sub elegir-seccion' }, titulo) : null, h('div', { class: 'elegir-rejilla' }, vis)] : [];
    }));
    if (!cuerpo.children.length) cuerpo.append(h('p', { class: 'tenue' }, 'Nada coincide con la búsqueda.'));
  };
  pintar();
  if (total <= 8) return cuerpo;
  const buscar = h('input', { type: 'search', class: 'elegir-buscar', placeholder: 'Buscar…', 'aria-label': 'Buscar', autofocus: true, oninput: () => pintar(buscar.value) });
  return h('div', null, buscar, cuerpo);
}

// ── Transformar ───────────────────────────────────────────────
/** Formas a las que puede pasar un token, por grupo. El GM puede ir a cualquiera; el jugador, en una evolución, solo hacia delante. */
export function destinosTransformacion(t) {
  const cat = S.catalogo;
  return Object.entries(t.elecciones || {}).filter(([g]) => ['formas', 'evolucion'].includes(cat.grupos?.[g]?.transformacion)).map(([g, actual]) => {
    const grupo = cat.grupos[g];
    const todas = Object.entries(cat.opciones || {}).filter(([id, o]) => o.grupo === g && id !== actual);
    const destinos = S.esGM || grupo.transformacion === 'formas' ? todas : todas.filter(([id]) => (cat.opciones[actual]?.evoluciona_a || []).includes(id));
    return { g, grupo, actual, destinos };
  });
}

export function puedeTransformar(t) {
  return S.esGM || (esMio(t) && !!S.catalogo.reglas?.transformarse && !t.derrotado);
}

export const hayTransformaciones = (t) => puedeTransformar(t) && destinosTransformacion(t).some((x) => x.destinos.length);

export function abrirTransformar(tokenId) {
  const t = S.tokens.get(tokenId);
  if (!t) return;
  const grupos = destinosTransformacion(t).filter((x) => x.destinos.length);
  let cerrarYa = () => {};
  const secciones = grupos.map(({ grupo, actual, destinos }) => ({
    titulo: `${grupo.nombre} · ahora: ${S.catalogo.opciones[actual]?.nombre || actual}`,
    elementos: destinos.map(([id, o]) => tarjeta({ imagen: o.imagen || o.icono, nombre: o.nombre, datos: { 'data-forma': id },
      detalle: grupo.transformacion === 'evolucion' ? '⬆ Evolucionar (sin vuelta atrás)' : (o.descripcion || '✨ Cambiar de forma'),
      alPulsar: () => { red.enviar({ tipo: 'transformar', token: t.id, opcion: id }); cerrarYa(); } })),
  }));
  dialogo({ titulo: `✨ Transformar a ${t.nombre}`, ancho: 520, botones: [{ texto: 'Cancelar', valor: null, clase: 'btn-suave' }],
    contenido: grupos.length ? listaConBuscador(secciones, secciones.reduce((n, s) => n + s.elementos.length, 0)) : h('p', { class: 'tenue' }, 'No tiene formas a las que cambiar.'),
    alMostrar: (_caja, cerrar) => { cerrarYa = () => cerrar(null); } });
}

// ── Desplegar en una casilla ──────────────────────────────────
/** Personajes que este usuario puede desplegar (el GM: los de todos; un jugador: los suyos) que no están en ningún mapa. */
export function personajesDesplegables() {
  const enMapa = (p, dueno) => [...S.tokens.values()].some((t) => t.personaje === p.id && t.dueno === dueno);
  if (S.esGM) return S.todosPersonajes.filter((p) => !p.desplegado && !enMapa(p, p.usuario)).map((p) => ({ ...p, dueno: p.usuario }));
  return S.personajes.filter((p) => !enMapa(p, S.usuario)).map((p) => ({ ...p, dueno: S.usuario }));
}

/** Ventana «Desplegar token»: personajes (y, para el GM, NPC por categoría) que se pueden poner en la casilla (cx, cy). */
export function abrirDesplegar(cx, cy, { motivo = '' } = {}) {
  let cerrarYa = () => {};
  const fin = (fn) => () => { fn(); cerrarYa(); };
  const pjs = personajesDesplegables();
  const secciones = [];
  if (pjs.length) {
    secciones.push({ titulo: S.esGM ? '👤 Personajes' : null, elementos: pjs.map((p) => tarjeta({ imagen: p.imagen, nombre: p.nombre,
      detalle: motivo || (S.esGM ? `De ${p.dueno}` : 'Tu personaje'), deshabilitado: !!motivo, datos: { 'data-desplegar': p.id },
      alPulsar: fin(() => desplegarPersonaje(p.id, S.esGM ? p.dueno : null, cx, cy)) })) });
  }
  if (S.esGM) {
    const porCategoria = new Map();
    for (const [id, e] of Object.entries(S.catalogo.enemigos || {})) {
      const c = String(e.categoria || '').trim();
      if (!porCategoria.has(c)) porCategoria.set(c, []);
      porCategoria.get(c).push(tarjeta({ imagen: e.imagen, nombre: `${ICONO_BANDO[e.bando] || ''} ${e.nombre}`.trim(), detalle: motivo || e.descripcion,
        deshabilitado: !!motivo, datos: { 'data-colocar': id }, alPulsar: fin(() => red.enviar({ tipo: 'gm_colocar_enemigo', enemigo: id, x: cx, y: cy })) }));
    }
    [...porCategoria.keys()].sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'es', { sensitivity: 'base' }))
      .forEach((c) => secciones.push({ titulo: `👾 NPC${c ? ` · ${c}` : porCategoria.size > 1 ? ' · Sin categoría' : ''}`, elementos: porCategoria.get(c) }));
  }
  const total = secciones.reduce((n, s) => n + s.elementos.length, 0);
  dialogo({ titulo: `📍 Desplegar token en ${cx}, ${cy}`, ancho: 560, botones: [{ texto: 'Cancelar', valor: null, clase: 'btn-suave' }],
    contenido: h('div', null, motivo ? h('p', { class: 'aviso-suave' }, `⚠ ${motivo}`) : null,
      total ? listaConBuscador(secciones, total) : h('p', { class: 'tenue' }, 'No hay tokens para desplegar.')),
    alMostrar: (_caja, cerrar) => { cerrarYa = () => cerrar(null); } });
}

// ── Objetos: usar con alguien y dar a alguien ─────────────────
/** Tokens visibles de la sala junto a quien usa o da el objeto (a `alcance` casillas como mucho; el GM, todos). Los derrotados,
 *  solo si se pide (una poción para reanimar a un aliado caído). */
export function tokensCerca(origen, alcance, { incluirOrigen = false, derrotados = false } = {}) {
  return [...S.tokens.values()].filter((t) => (incluirOrigen || t.id !== origen.id) && (derrotados || !t.derrotado) && (t.id === origen.id || S.esGM || distancia(t, origen) <= alcance))
    .sort((a, b) => (a.id === origen.id ? -1 : b.id === origen.id ? 1 : distancia(a, origen) - distancia(b, origen) || a.nombre.localeCompare(b.nombre)));
}

const detalleToken = (t, origen) => (t.id === origen.id ? 'Él mismo'
  : `${esMio(t) || controloYo(t) ? 'Tuyo · ' : ''}${t.derrotado ? 'Derrotado · ' : ''}a ${distancia(t, origen)} ${distancia(t, origen) === 1 ? 'casilla' : 'casillas'}`);

/** Elegir con quién usar un objeto (quien lo lleva incluido). */
export function abrirUsarObjeto(origen, objetoId) {
  const obj = S.catalogo.objetos?.[objetoId];
  if (!obj) return;
  const alcance = S.catalogo.reglas?.alcance_objetos ?? 1;
  const candidatos = tokensCerca(origen, alcance, { incluirOrigen: true, derrotados: true });
  let cerrarYa = () => {};
  dialogo({ titulo: `Usar ${obj.nombre}: ¿con quién?`, ancho: 480, botones: [{ texto: 'Cancelar', valor: null, clase: 'btn-suave' }],
    contenido: h('div', null, h('p', { class: 'tenue pequeno' }, alcance === 1 ? 'Contigo o con alguien que esté a tu lado.' : `Contigo o con alguien a ${alcance} casillas como mucho.`),
      listaConBuscador([{ elementos: candidatos.map((t) => tarjeta({ imagen: t.imagen, nombre: t.nombre, detalle: detalleToken(t, origen), datos: { 'data-objetivo': t.id },
        alPulsar: () => { red.enviar({ tipo: 'usar_objeto', token: origen.id, objeto: objetoId, ...(t.id !== origen.id ? { objetivo: t.id } : {}) }); cerrarYa(); } })) }], candidatos.length)),
    alMostrar: (_caja, cerrar) => { cerrarYa = () => cerrar(null); } });
}

/** Elegir a quién dar un objeto (tokens cercanos) y confirmar. */
export function abrirDarObjeto(origen, objetoId, cantidadMax = 1) {
  const obj = S.catalogo.objetos?.[objetoId];
  if (!obj) return;
  const alcance = S.catalogo.reglas?.alcance_objetos ?? 1;
  const candidatos = tokensCerca(origen, alcance);
  const cantidad = h('input', { type: 'number', min: '1', max: String(cantidadMax), value: '1', 'aria-label': 'Cantidad', 'data-campo': 'cantidad-dar', class: 'elegir-cantidad' });
  let cerrarYa = () => {};
  const elegir = async (t) => {
    const n = Math.max(1, Math.min(cantidadMax, Math.trunc(Number(cantidad.value)) || 1));
    cerrarYa();
    if (await confirmar('Dar objeto', `¿Dar ${n} × ${obj.nombre} a ${t.nombre}?`, { si: 'Dar' })) {
      red.enviar({ tipo: 'dar_objeto', token: origen.id, a: t.id, objeto: objetoId, cantidad: n });
    }
  };
  dialogo({ titulo: `🎁 Dar ${obj.nombre}`, ancho: 480, botones: [{ texto: 'Cancelar', valor: null, clase: 'btn-suave' }],
    contenido: h('div', null,
      cantidadMax > 1 ? h('label', { class: 'elegir-cantidad-fila' }, 'Cantidad', cantidad, h('span', { class: 'tenue pequeno' }, `de ${cantidadMax}`)) : null,
      candidatos.length
        ? [h('p', { class: 'tenue pequeno' }, S.esGM ? 'A quien sea de la sala:' : alcance === 1 ? 'A alguien que esté a tu lado:' : `A alguien a ${alcance} casillas como mucho:`),
          listaConBuscador([{ elementos: candidatos.map((t) => tarjeta({ imagen: t.imagen, nombre: t.nombre, detalle: detalleToken(t, origen), datos: { 'data-objetivo': t.id }, alPulsar: () => elegir(t) })) }], candidatos.length)]
        : h('p', { class: 'tenue' }, `No hay nadie lo bastante cerca de ${origen.nombre}. Acércate a quien se lo quieras dar.`)),
    alMostrar: (_caja, cerrar) => { cerrarYa = () => cerrar(null); } });
}
