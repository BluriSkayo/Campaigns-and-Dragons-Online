// campos.js — Los controles de los formularios. Cada uno recibe la definición del campo (esquemas.js) y el objeto que edita,
// y lo modifica directamente; luego avisa con ctx.alCambiar() para que la pestaña muestre «sin guardar».
import { h, toast, entero } from './util.js';
import { E, bus, stats, recursosJuego, nombresFormula, lista, recargarAssets } from './estado.js';
import { revisarFormula } from './formula.js';
export { revisarFormula };
import { construirEfectos, construirCondiciones } from './efectos.js';
import { elegirImagen } from './galeria.js';
import { construirSimulador } from './simulador.js';

export function urlAsset(rel) {
  const base = E.cliente?.base;
  if (!rel || !base) return '';
  const b = base.replace(/\\/g, '/');
  return encodeURI(`file:///${b.startsWith('/') ? b.slice(1) : b}/${rel}`).replace(/#/g, '%23');
}

/** Las imágenes y sonidos van en la carpeta «base» de la campaña abierta (siempre disponible con una campaña abierta). */
export async function asegurarCliente() {
  if (E.cliente?.conectada) return true;
  await recargarAssets();
  return !!E.cliente?.conectada;
}

function envoltura(def, control, { sinEtiqueta = false } = {}) {
  return h('div', { class: `campo campo-${def.t}` },
    sinEtiqueta ? null : h('label', { class: 'campo-etiqueta' }, def.etiqueta, def.obligatorio ? h('span', { class: 'obligatorio', title: 'Obligatorio' }, ' *') : null),
    control, def.ayuda ? h('p', { class: 'ayuda' }, def.ayuda) : null);
}

function fijar(obj, k, v) {
  if (v === '' || v === undefined || v === null) delete obj[k]; else obj[k] = v;
}

// ── Controles sencillos ──
/** «120/1000» bajo un campo con límite de letras: se ve al escribir y se marca al acercarse al tope (así no se descubre al guardar). */
export function contador(el, max) {
  const c = h('span', { class: 'contador-letras', 'aria-live': 'polite' });
  const pintar = () => { const n = el.value.length; c.textContent = `${n}/${max}`; c.classList.toggle('casi', n >= max * 0.9); c.hidden = n < max * 0.5; };
  el.addEventListener('input', pintar);
  pintar();
  return c;
}
function texto(def, obj, ctx, largo = false) {
  const max = def.max || (largo ? 5000 : 80);
  const el = h(largo ? 'textarea' : 'input', { class: 'entrada', ...(largo ? { rows: String(def.filas || 3) } : { type: 'text' }), 'data-campo': def.k, maxlength: String(max), placeholder: def.placeholder || '' });
  el.value = obj[def.k] ?? '';
  const cuenta = contador(el, max);
  const marcar = () => el.classList.toggle('invalido', !!def.obligatorio && !el.value.trim());
  el.addEventListener('input', () => { if (def.obligatorio || largo || el.value) obj[def.k] = el.value; else delete obj[def.k]; marcar(); ctx.alCambiar(def.k); });
  marcar();
  return envoltura(def, h('div', { class: 'con-contador' }, el, cuenta));
}

function numero(def, obj, ctx) {
  const el = h('input', { class: 'entrada entrada-num', type: 'number', min: def.min ?? 0, max: def.max ?? 999999, step: def.decimal ? 'any' : '1', 'data-campo': def.k });
  el.value = obj[def.k] ?? def.defecto ?? 0;
  el.addEventListener('input', () => {
    const v = def.decimal ? Number(String(el.value).replace(',', '.')) : entero(el.value, 0);
    obj[def.k] = def.decimal ? (Number.isFinite(v) && v > 0 ? v : def.defecto ?? 1) : v;
    ctx.alCambiar(def.k);
  });
  return envoltura(def, h('div', { class: 'con-sufijo' }, el, def.sufijo ? h('span', { class: 'tenue' }, def.sufijo) : null));
}

function interruptor(def, obj, ctx) {
  const c = h('input', { type: 'checkbox', 'data-campo': def.k });
  c.checked = obj[def.k] !== false && !!(obj[def.k] ?? (typeof def.defecto === 'function' ? def.defecto(obj) : def.defecto) ?? false);
  c.addEventListener('change', () => { obj[def.k] = c.checked; ctx.alCambiar(def.k); });
  return h('div', { class: 'campo campo-interruptor' },
    h('label', { class: 'interruptor' }, c, h('span', { class: 'pista' }), h('span', { class: 'campo-etiqueta' }, def.etiqueta)),
    def.ayuda ? h('p', { class: 'ayuda' }, def.ayuda) : null);
}

function opciones(def, obj, ctx) {
  const actual = () => obj[def.k] ?? def.opciones[0][0];
  const botones = def.opciones.map(([v, t]) => h('button', { type: 'button', class: 'seg', 'data-valor': v, 'aria-pressed': String(actual() === v),
    onclick: () => { obj[def.k] = v; botones.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === v))); ctx.alCambiar(def.k); } }, t));
  return envoltura(def, h('div', { class: 'segmentos', role: 'group' }, botones));
}

function seleccion(def, obj, ctx) {
  const s = h('select', { class: 'entrada', 'data-campo': def.k }, def.opciones.map(([v, t]) => h('option', { value: v }, t)));
  s.value = obj[def.k] ?? def.opciones[0][0];
  s.addEventListener('change', () => { obj[def.k] = s.value; ctx.alCambiar(def.k); });
  return envoltura(def, s);
}

function ref(def, obj, ctx) {
  const s = h('select', { class: 'entrada', 'data-campo': def.k });
  const pintar = () => {
    const items = lista(def.cat);
    s.replaceChildren(...(def.sinVacio ? [] : [h('option', { value: '' }, '(ninguno)')]), ...items.map((i) => h('option', { value: i.id }, i.nombre)));
    if (obj[def.k] && !items.some((i) => i.id === obj[def.k])) s.append(h('option', { value: obj[def.k] }, `${obj[def.k]} (no existe)`));
    s.value = obj[def.k] ?? '';
    if (def.obligatorio) s.classList.toggle('invalido', !s.value);
  };
  pintar();
  s.addEventListener('change', () => { fijar(obj, def.k, s.value); if (def.obligatorio) s.classList.toggle('invalido', !s.value); ctx.alCambiar(def.k); });
  return envoltura(def, s);
}

function refs(def, obj, ctx) {
  const caja = h('div', { class: 'refs' });
  const pintar = () => {
    const ids = obj[def.k] || (obj[def.k] = []);
    const libres = lista(def.cat).filter((i) => !ids.includes(i.id) && (!def.filtrar || def.filtrar(i.id, obj, E.campana.recursos)));
    const sel = h('select', { class: 'entrada entrada-anadir', 'aria-label': def.vacio }, h('option', { value: '' }, def.vacio), libres.map((i) => h('option', { value: i.id }, i.nombre)));
    sel.addEventListener('change', () => { if (sel.value) { ids.push(sel.value); ctx.alCambiar(def.k); pintar(); } });
    caja.replaceChildren(
      h('div', { class: 'chips' }, ids.length ? ids.map((id, n) => {
        const existe = !!E.campana.recursos[def.cat]?.[id];
        return h('span', { class: `chip${existe ? '' : ' chip-error'}` }, existe ? E.campana.recursos[def.cat][id].nombre || id : `${id} (no existe)`,
          h('button', { type: 'button', class: 'chip-x', title: 'Quitar', 'aria-label': 'Quitar', onclick: () => { ids.splice(n, 1); ctx.alCambiar(def.k); pintar(); } }, '✕'));
      }) : h('span', { class: 'tenue pequeno' }, 'Ninguno todavía.')),
      libres.length ? sel : '');
  };
  pintar();
  return envoltura(def, caja);
}

// ── «Solo aparece si…» de un grupo: otro grupo + las opciones que lo activan ──
function soloSi(def, obj, ctx) {
  const caja = h('div', { class: 'solo-si', 'data-campo': def.k });
  const pintar = () => {
    const v = obj[def.k];
    const grupos = lista('grupos').filter((g) => g.id !== ctx.propioId);
    const sel = h('select', { class: 'entrada', 'aria-label': 'Grupo del que depende', 'data-accion': 'solo-si-grupo' },
      h('option', { value: '' }, 'Siempre (no depende de nada)'), grupos.map((g) => h('option', { value: g.id }, `Si en «${g.nombre}» elige…`)));
    if (v?.grupo && !grupos.some((g) => g.id === v.grupo)) sel.append(h('option', { value: v.grupo }, `${v.grupo} (no existe)`));
    sel.value = v?.grupo || '';
    sel.addEventListener('change', () => {
      if (sel.value) obj[def.k] = { grupo: sel.value, opciones: [] }; else delete obj[def.k];
      ctx.alCambiar(def.k); pintar();
    });
    let opciones = null;
    if (v?.grupo) {
      const delGrupo = Object.entries(E.campana.recursos.opciones || {}).filter(([, o]) => o.grupo === v.grupo);
      opciones = h('div', { class: 'chips' }, delGrupo.length ? delGrupo.map(([id, o]) => {
        const c = h('input', { type: 'checkbox', 'data-opcion': id });
        c.checked = v.opciones.includes(id);
        c.addEventListener('change', () => {
          v.opciones = c.checked ? [...v.opciones, id] : v.opciones.filter((x) => x !== id);
          marcar(); ctx.alCambiar(def.k);
        });
        return h('label', { class: 'chip chip-check' }, c, ' ', o.nombre || id);
      }) : h('span', { class: 'tenue pequeno' }, 'Ese grupo todavía no tiene opciones.'));
    }
    const marcar = () => sel.classList.toggle('invalido', !!v?.grupo && !v.opciones.length);
    marcar();
    caja.replaceChildren(...[sel, opciones].filter(Boolean));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Lados cerrados de un tile: un cuadrado con un botón en cada borde ──
function lados(def, obj, ctx) {
  const caja = h('div', { class: 'lados', 'data-campo': def.k });
  const NOMBRES = { norte: 'Arriba (norte)', sur: 'Abajo (sur)', este: 'Derecha (este)', oeste: 'Izquierda (oeste)' };
  const pintar = () => {
    const actual = Array.isArray(obj[def.k]) ? obj[def.k] : [];
    const boton = (l) => h('button', { type: 'button', class: `lado lado-${l}`, 'data-lado': l, 'aria-pressed': String(actual.includes(l)), title: NOMBRES[l], 'aria-label': `Cerrar ${NOMBRES[l]}`,
      onclick: () => {
        const n = actual.includes(l) ? actual.filter((x) => x !== l) : [...actual, l];
        if (n.length) obj[def.k] = ['norte', 'sur', 'este', 'oeste'].filter((x) => n.includes(x)); else delete obj[def.k];
        ctx.alCambiar(def.k); pintar();
      } });
    caja.replaceChildren(boton('norte'), boton('oeste'), h('span', { class: 'lado-centro', style: { background: obj.color || 'var(--panel)' } }), boton('este'), boton('sur'),
      h('span', { class: 'tenue pequeno lado-texto' }, actual.length ? `Cerrado: ${actual.join(', ')}` : 'Todos abiertos'));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Categoría de un NPC: texto libre con las categorías que ya usan los demás NPC como sugerencias ──
export const categoriasNpc = () => [...new Set(Object.values(E.campana?.recursos?.enemigos || {}).map((n) => String(n?.categoria || '').trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
function categoriaNpc(def, obj, ctx) {
  const id = `sugerencias-${def.k}`;
  const el = h('input', { class: 'entrada', type: 'text', maxlength: '40', list: id, 'data-campo': def.k, placeholder: 'Aliados, Enemigos, Jefes…' });
  el.value = obj[def.k] || '';
  el.addEventListener('input', () => { fijar(obj, def.k, el.value.trim() ? el.value : ''); ctx.alCambiar(def.k); });
  el.addEventListener('change', () => { const v = el.value.trim(); el.value = v; fijar(obj, def.k, v); ctx.alCambiar(def.k); });
  const sugerencias = h('datalist', { id }, ['Aliados', 'Enemigos', ...categoriasNpc()].filter((x, i, l) => l.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).map((c) => h('option', { value: c })));
  return envoltura(def, h('div', null, el, sugerencias));
}

// ── Una estadística de la campaña (o ninguna) ──
function statSola(def, obj, ctx) {
  const s = h('select', { class: 'entrada', 'data-campo': def.k }, h('option', { value: '' }, def.vacio || '(ninguna)'), stats().map((n) => h('option', { value: n }, n)));
  if (obj[def.k] && !stats().includes(obj[def.k])) s.append(h('option', { value: obj[def.k] }, `${obj[def.k]} (no existe)`));
  s.value = obj[def.k] || '';
  s.addEventListener('change', () => { fijar(obj, def.k, s.value); ctx.alCambiar(def.k); });
  return envoltura(def, s);
}

// ── «Aprende al subir de nivel»: [{nivel, habilidad}] ──
function aprende(def, obj, ctx) {
  const caja = h('div', { class: 'aprende', 'data-campo': def.k });
  const pintar = () => {
    const l = obj[def.k] || (obj[def.k] = []);
    const habs = lista('habilidades');
    caja.replaceChildren(...l.map((a, i) => {
      const nv = h('input', { class: 'entrada entrada-num', type: 'number', min: 2, max: 100, 'aria-label': 'Nivel' });
      nv.value = a.nivel; nv.addEventListener('input', () => { a.nivel = Math.max(2, Math.min(100, entero(nv.value, 2))); ctx.alCambiar(def.k); });
      const hs = h('select', { class: 'entrada', 'aria-label': 'Habilidad' }, habs.map((x) => h('option', { value: x.id }, x.nombre)));
      if (a.habilidad && !habs.some((x) => x.id === a.habilidad)) hs.append(h('option', { value: a.habilidad }, `${a.habilidad} (no existe)`));
      hs.value = a.habilidad; hs.addEventListener('change', () => { a.habilidad = hs.value; ctx.alCambiar(def.k); });
      return h('div', { class: 'fila-lista' }, h('span', null, 'Nivel'), nv, h('span', null, '→'), hs,
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar', onclick: () => { l.splice(i, 1); if (!l.length) delete obj[def.k]; ctx.alCambiar(def.k); pintar(); } }, '✕'));
    }), habs.length ? h('button', { type: 'button', class: 'btn btn-mini', 'data-accion': 'anadir-aprende', onclick: () => { l.push({ nivel: 2, habilidad: habs[0].id }); ctx.alCambiar(def.k); pintar(); } }, '＋ Añadir')
      : h('span', { class: 'tenue pequeno' }, 'Todavía no hay habilidades.'));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Etiquetas de la campaña (Fuego, No-muerto…): chips de colores ──
export const etiquetasCampana = () => (E.campana?.config?.juego?.etiquetas || []).filter((e) => e?.nombre);
export function chipEtiqueta(nombre, extra = null) {
  const e = etiquetasCampana().find((x) => x.nombre.toLowerCase() === String(nombre).toLowerCase());
  return h('span', { class: `chip chip-etiqueta${e ? '' : ' chip-error'}`, style: e?.color ? { borderColor: e.color, boxShadow: `inset 3px 0 ${e.color}` } : null, 'data-etiqueta': nombre },
    e ? e.nombre : `${nombre} (no existe)`, extra);
}
function etiquetas(def, obj, ctx) {
  const caja = h('div', { class: 'refs', 'data-campo': def.k });
  const pintar = () => {
    const lista_ = obj[def.k] || (obj[def.k] = []);
    const todas = etiquetasCampana();
    const libres = todas.filter((e) => !lista_.some((x) => x.toLowerCase() === e.nombre.toLowerCase()));
    const sel = h('select', { class: 'entrada entrada-anadir', 'aria-label': 'Añadir una etiqueta', 'data-accion': 'anadir-etiqueta' },
      h('option', { value: '' }, 'Añadir una etiqueta…'), libres.map((e) => h('option', { value: e.nombre }, e.nombre)));
    sel.addEventListener('change', () => { if (sel.value) { lista_.push(sel.value); ctx.alCambiar(def.k); pintar(); } });
    caja.replaceChildren(
      h('div', { class: 'chips' }, lista_.length ? lista_.map((n, i) => chipEtiqueta(n,
        h('button', { type: 'button', class: 'chip-x', title: 'Quitar', 'aria-label': `Quitar ${n}`, onclick: () => { lista_.splice(i, 1); if (!lista_.length) delete obj[def.k]; ctx.alCambiar(def.k); pintar(); } }, '✕')))
        : h('span', { class: 'tenue pequeno' }, todas.length ? 'Sin etiquetas.' : 'La campaña aún no tiene etiquetas (se crean en Reglas del juego → Etiquetas y ventajas).')),
      libres.length ? sel : '');
  };
  pintar();
  return envoltura(def, caja);
}

function imagen(def, obj, ctx) {
  const caja = h('div', { class: 'imagen-campo' });
  const pintar = () => {
    const carpeta = def.carpeta;
    const actual = obj[def.k] || '';
    const [cat, ...resto] = actual.split('/');
    const existe = !!actual && (E.campana.assets[cat] || []).includes(resto.join('/'));
    const vista = h('div', { class: 'miniatura' }, existe ? h('img', { src: urlAsset(actual), alt: '' }) : h('span', { class: 'tenue' }, '🖼️'));
    const elegir = async () => {
      const r = await elegirImagen({ carpeta, actual, titulo: def.etiqueta || 'Elegir imagen' });
      if (r === null || r === actual) return;
      fijar(obj, def.k, r); ctx.alCambiar(def.k); pintar();
    };
    const delPrograma = actual.startsWith('icons/habilidades/');          // icono que trae el programa: no se enseña su archivo
    const nombre = h('span', { class: `imagen-nombre${actual && !existe ? ' error' : ''}`, 'data-campo': def.k, title: delPrograma ? null : actual },
      actual ? (delPrograma && existe ? 'Icono elegido' : `${actual}${existe ? '' : ' (no encontrada)'}`) : 'Sin imagen');
    caja.replaceChildren(vista, h('div', { class: 'imagen-controles' }, nombre,
      h('div', { class: 'fila-inline' },
        h('button', { type: 'button', class: 'btn', 'data-accion': 'elegir-imagen', onclick: elegir }, '🖼️ Elegir o importar…'),
        actual ? h('button', { type: 'button', class: 'btn btn-mini', 'aria-label': 'Quitar la imagen', onclick: () => { fijar(obj, def.k, ''); ctx.alCambiar(def.k); pintar(); } }, '✕') : null)));
  };
  pintar();
  const off = bus.mientras(caja, 'assets', () => { if (caja.isConnected) pintar(); else off?.(); });
  return envoltura(def, caja);
}

// ── Valores por estadística / recurso ──
function valores(def, obj, ctx) {
  const cuerpo = h('div', { class: 'tabla-valores' });
  const tiposExp = def.de === 'experiencia';          // «Experiencia que cede»: una fila por tipo de experiencia de la campaña (Reglas → Niveles y experiencia)
  const nombres = tiposExp ? (E.campana.config.juego.niveles?.activo ? E.campana.config.juego.niveles.experiencia || [] : []) : def.de === 'stats' ? stats() : recursosJuego();
  const definiciones = def.de === 'recursos' ? E.campana.config.juego.recursos : E.campana.config.juego.estadisticas;
  if (tiposExp && !nombres.length) return envoltura(def, h('p', { class: 'tenue pequeno' }, 'Esta campaña no usa niveles o no tiene tipos de experiencia (Reglas → Niveles y experiencia).'));
  const inicial = (n) => { const d = definiciones.find((x) => x.nombre === n); return def.de === 'stats' ? (d?.valor_inicial ?? 10) : (d?.maximo_inicial ?? 100); };
  const dato = () => obj[def.k] || (obj[def.k] = {});
  const pintar = () => {
    const d = dato();
    const filas = nombres.map((n) => {
      if (def.modo === 'opcional' || (def.modo === 'valores' && definiciones.find((x) => x.nombre === n)?.para_todos === false)) {          // «Cambiar» = esta opción fija el valor inicial; sin marcar = usa el de la campaña
        const activo = n in d;
        const marca = h('input', { type: 'checkbox', 'data-cambia': n, 'aria-label': `Cambiar ${n}` }); marca.checked = activo;
        const num = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', min: 0, max: 99999, 'data-valor': n, 'aria-label': n });
        num.value = d[n] ?? inicial(n); num.disabled = !activo;
        marca.addEventListener('change', () => {
          num.disabled = !marca.checked;
          if (marca.checked) d[n] = entero(num.value, inicial(n)); else delete d[n];
          ctx.alCambiar(def.k);
        });
        num.addEventListener('input', () => { if (marca.checked) { d[n] = entero(num.value, inicial(n)); ctx.alCambiar(def.k); } });
        return h('div', { class: 'fila-valor' }, h('label', { class: 'fila-marca' }, marca, ` ${n}`), num);
      }
      const entrada = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', 'data-valor': n,
        min: def.modo === 'bonos' ? -999 : 0, max: 99999, 'aria-label': n });
      entrada.value = d[n] ?? (def.modo === 'valores' ? inicial(n) : 0);
      entrada.addEventListener('input', () => {
        const v = entero(entrada.value, 0);
        if (def.modo !== 'valores' && v === 0) delete d[n]; else d[n] = v;
        ctx.alCambiar(def.k);
        if (def.modo === 'bonos') entrada.classList.toggle('positivo', v > 0), entrada.classList.toggle('negativo', v < 0);
      });
      if (def.modo === 'bonos') { const v = d[n] || 0; entrada.classList.toggle('positivo', v > 0); entrada.classList.toggle('negativo', v < 0); }
      return h('div', { class: 'fila-valor' }, h('span', null, n), entrada);
    });
    const sobran = Object.keys(d).filter((n) => !nombres.includes(n));
    for (const n of sobran) {
      filas.push(h('div', { class: 'fila-valor fila-error' }, h('span', null, `${n} (ya no existe)`),
        h('button', { type: 'button', class: 'btn btn-mini', onclick: () => { delete d[n]; ctx.alCambiar(def.k); pintar(); } }, 'Quitar')));
    }
    cuerpo.replaceChildren(...(filas.length ? filas : [h('p', { class: 'tenue pequeno' }, def.de === 'stats' ? 'La campaña no tiene estadísticas todavía.' : 'La campaña no tiene recursos todavía.')]));
  };
  if (def.modo === 'valores' && !obj[def.k]) obj[def.k] = {};
  pintar();
  return envoltura(def, cuerpo);
}

// ── Sonidos de un personaje: casillas con los efectos de la lista «Sonidos» de la campaña ──
function sonidosPersonaje(def, obj, ctx) {
  const caja = h('div', { class: 'sonidos-token' });
  const pintar = () => {
    const efectos = ((E.campana.sonidos?.efectos) || []).flatMap((g) => g.archivos);
    const tiene = new Set(Array.isArray(obj[def.k]) ? obj[def.k] : []);
    for (const n of tiene) if (!efectos.includes(n)) efectos.push(n);                      // uno que ya no está en la lista se ve para poder quitarlo
    if (!efectos.length) { caja.replaceChildren(h('p', { class: 'ayuda' }, 'Aún no hay efectos de sonido. Añádelos en «Sonidos → Efectos».')); return; }
    caja.replaceChildren(...efectos.map((n) => {
      const c = h('input', { type: 'checkbox', 'data-sonido': n, 'aria-label': n });
      c.checked = tiene.has(n);
      c.addEventListener('change', () => {
        const nuevo = new Set(Array.isArray(obj[def.k]) ? obj[def.k] : []);
        if (c.checked) nuevo.add(n); else nuevo.delete(n);
        if (nuevo.size) obj[def.k] = [...nuevo]; else delete obj[def.k];
        ctx.alCambiar(def.k);
      });
      return h('label', { class: 'interruptor-fila' }, c, ' ', n);
    }));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Objetos: efecto al usar ──
function efectoObjeto(def, obj, ctx) {
  const caja = h('div', { class: 'efecto-objeto' });
  const pintar = () => {
    const ef = obj[def.k];
    const c = h('input', { type: 'checkbox', 'data-campo': 'efecto-activo' });
    c.checked = !!ef;
    c.addEventListener('change', () => {
      if (c.checked) obj[def.k] = { tipo: 'restaurar', recurso: E.campana.config.juego.recurso_vida || recursosJuego()[0], valor: 10 }; else delete obj[def.k];
      ctx.alCambiar(def.k); pintar();
    });
    caja.replaceChildren(h('label', { class: 'interruptor' }, c, h('span', { class: 'pista' }), h('span', null, 'Se puede usar para restaurar un recurso')),
      ef ? h('div', { class: 'fila-inline' }, 'Restaura',
        (() => { const n = h('input', { class: 'entrada entrada-num', type: 'number', min: 1, max: 99999 }); n.value = ef.valor ?? 1;
          n.addEventListener('input', () => { ef.valor = Math.max(1, entero(n.value, 1)); ctx.alCambiar(def.k); }); return n; })(),
        'puntos de',
        (() => { const s = h('select', { class: 'entrada' }, recursosJuego().map((r) => h('option', { value: r }, r))); s.value = ef.recurso;
          s.addEventListener('change', () => { ef.recurso = s.value; ctx.alCambiar(def.k); }); return s; })()) : h('p', { class: 'ayuda' }, 'Sin esto, el objeto no se puede «usar» (por ejemplo, una llave o un adorno).'));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Listas de objetos ──
function listaObjetos(def, obj, ctx, { articulos }) {
  const caja = h('div', { class: 'lista-filas' });
  const pintar = () => {
    if (!Array.isArray(obj[def.k])) obj[def.k] = [];
    obj[def.k] = obj[def.k].map((x) => (typeof x === 'string' ? { objeto: x, ...(articulos ? {} : { cantidad: 1 }) } : x));
    const datos = obj[def.k];
    const filas = datos.map((e, i) => {
      const sel = h('select', { class: 'entrada', 'aria-label': 'Objeto' }, h('option', { value: '' }, '(elige un objeto)'),
        lista('objetos').map((o) => h('option', { value: o.id }, o.nombre)));
      if (e.objeto && !E.campana.recursos.objetos[e.objeto]) sel.append(h('option', { value: e.objeto }, `${e.objeto} (no existe)`));
      sel.value = e.objeto || '';
      sel.addEventListener('change', () => { e.objeto = sel.value; ctx.alCambiar(def.k); });
      const quitar = h('button', { type: 'button', class: 'btn btn-mini btn-peligro', title: 'Quitar', 'aria-label': 'Quitar', onclick: () => { datos.splice(i, 1); ctx.alCambiar(def.k); pintar(); } }, '✕');
      if (!articulos) {
        const n = h('input', { class: 'entrada entrada-num', type: 'number', min: 1, max: 9999, 'aria-label': 'Cantidad' }); n.value = e.cantidad ?? 1;
        n.addEventListener('input', () => { e.cantidad = Math.max(1, entero(n.value, 1)); ctx.alCambiar(def.k); });
        return h('div', { class: 'fila-lista' }, sel, h('span', { class: 'tenue' }, '×'), n, quitar);
      }
      const precio = h('input', { class: 'entrada entrada-num', type: 'number', min: 0, max: 1000000000, 'aria-label': 'Precio',
        placeholder: String(E.campana.recursos.objetos[e.objeto]?.precio ?? 0) });
      precio.value = e.precio ?? '';
      precio.addEventListener('input', () => { if (precio.value === '') delete e.precio; else e.precio = Math.max(0, entero(precio.value, 0)); ctx.alCambiar(def.k); });
      const stock = h('input', { class: 'entrada entrada-num', type: 'number', min: 0, max: 100000, 'aria-label': 'Existencias', placeholder: '∞' });
      stock.value = e.stock ?? '';
      stock.addEventListener('input', () => { if (stock.value === '') delete e.stock; else e.stock = Math.max(0, entero(stock.value, 0)); ctx.alCambiar(def.k); });
      return h('div', { class: 'fila-lista' }, sel, h('label', { class: 'mini-campo' }, 'Precio', precio), h('label', { class: 'mini-campo' }, 'Existencias', stock), quitar);
    });
    caja.replaceChildren(...filas.length ? filas : [h('p', { class: 'tenue pequeno' }, articulos ? 'Esta tienda aún no vende nada.' : 'No lleva ningún objeto.')],
      h('button', { type: 'button', class: 'btn', onclick: () => {
        const primero = lista('objetos')[0];
        if (!primero) { toast('Primero crea algún objeto.', 'error'); return; }
        datos.push(articulos ? { objeto: primero.id } : { objeto: primero.id, cantidad: 1 });
        ctx.alCambiar(def.k); pintar();
      } }, articulos ? '+ Añadir artículo' : '+ Añadir objeto'));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Fórmulas ──
const DADOS = [4, 6, 8, 10, 12, 20, 100];

const tablasCampana = () => (E.campana?.config?.juego?.tablas || []).map((t) => t.nombre).filter(Boolean);

function formula(def, obj, ctx) {
  const entrada = h('input', { class: 'entrada entrada-formula', type: 'text', maxlength: '1000', spellcheck: 'false', 'data-campo': def.k });
  entrada.value = obj[def.k] ?? '';
  const estado = h('p', { class: 'formula-estado' });
  const cuentaFormula = contador(entrada, 1000);
  const deHabilidad = def.habilidad === true;                     // en una habilidad se pueden usar sus «Valores propios» como [h.X]
  const todos = nombresFormula();
  const nombres = deHabilidad && !todos.some((n) => n.toLowerCase() === 'distancia') ? [...todos, 'Distancia'] : todos;
  const valoresHab = () => (deHabilidad ? Object.keys(obj.valores || {}) : null);
  const revisar = () => {
    const p = revisarFormula(entrada.value, nombres, { tablas: tablasCampana(), valoresHabilidad: valoresHab() });
    estado.textContent = p || '✓ La fórmula es correcta';
    estado.className = `formula-estado ${p ? 'mal' : 'bien'}`;
    entrada.classList.toggle('invalido', !!p);
  };
  const insertar = (texto) => {
    const ini = entrada.selectionStart ?? entrada.value.length, fin = entrada.selectionEnd ?? ini;
    entrada.value = entrada.value.slice(0, ini) + texto + entrada.value.slice(fin);
    entrada.focus(); entrada.setSelectionRange(ini + texto.length, ini + texto.length);
    entrada.dispatchEvent(new Event('input'));
  };
  entrada.addEventListener('input', () => { obj[def.k] = entrada.value; revisar(); ctx.alCambiar(def.k); });
  const grupo = (titulo, botones) => (botones.length ? h('div', { class: 'formula-grupo' }, h('span', { class: 'tenue pequeno' }, titulo), h('div', { class: 'chips' }, botones)) : null);
  const boton = (t, v, ayuda) => h('button', { type: 'button', class: 'chip chip-btn', title: ayuda || '', onclick: () => insertar(v) }, t);
  const ayuda = h('div', { class: 'formula-ayuda' });
  const pintarAyuda = () => ayuda.replaceChildren(...[
    grupo('Del que la usa (atacante)', todos.map((n) => boton(n, `[a.${n}]`, `El valor de ${n} de quien la usa`))),
    grupo('Del objetivo', todos.map((n) => boton(n, `[o.${n}]`, `El valor de ${n} del objetivo`))),
    deHabilidad ? grupo('De esta habilidad', [...(valoresHab() || []).map((n) => boton(n, `[h.${n}]`, `El valor «${n}» de esta habilidad`)),
      boton('Distancia', '[Distancia]', 'Casillas entre quien la usa y cada objetivo (1 = pegado). Por ejemplo, tabla(Daño por distancia; [Distancia]) para que pegue más fuerte de cerca.')]) : null,
    grupo('Dados', DADOS.map((d) => boton(`d${d}`, `1d${d}`, `Un dado de ${d} caras`))),
    grupo('Operaciones', [['+', ' + '], ['−', ' - '], ['×', ' * '], ['÷', ' / '], ['( )', '()']].map(([t, v]) => boton(t, v))),
    grupo('Funciones', [['Nunca menos de 0', 'max(0; )', 'max(0; …) = el mayor: el resultado nunca baja de 0'], ['Como mucho…', 'min( ; )', 'min(a; b) = el menor de los dos'],
      ['Redondear', 'redondear()', 'Redondea al entero más cercano'], ['Si… entonces…', 'si(1d20 >= 15; 2; 1)', 'si(condición; valor si se cumple; valor si no)']].map(([t, v, a]) => boton(t, v, a))),
    grupo('Tablas de la campaña', tablasCampana().map((n) => boton(n, `tabla(${n}; 1d20)`, `Busca el resultado del dado en la tabla «${n}» (Reglas del juego → Tablas)`))),
    etiquetasCampana().length ? grupo('Etiquetas', [boton('× Ventaja de tipo', ' * ventaja()', 'Multiplica por la ventaja entre las etiquetas de esta habilidad y las del objetivo (Reglas del juego → Etiquetas y ventajas). Sin ventaja vale 1.')]) : null,
  ].filter(Boolean));
  pintarAyuda();
  // Si cambian los «Valores propios» de la habilidad, la fórmula se revisa otra vez (y aparecen sus botones).
  const baja = bus.mientras(entrada, 'cambio', () => { if (!entrada.isConnected) { baja(); return; } revisar(); pintarAyuda(); });
  revisar();
  return envoltura(def, h('div', null, entrada, cuentaFormula, estado, h('details', { class: 'formula-detalles', open: true }, h('summary', null, 'Ayuda para escribir la fórmula'), ayuda,
    h('p', { class: 'ayuda' }, 'Ejemplo: [a.Fuerza] * 2 - [o.Resistencia] + 2d6 = el doble de tu Fuerza, menos la Resistencia del objetivo, más dos dados de 6 caras. Decimales con coma (1,5) y, dentro de una función, separa con «;». El resultado se redondea hacia abajo y nunca baja de 0.'))));
}

// ── Valores propios (nombre → número), p. ej. la Potencia de una habilidad ──
function valoresLibres(def, obj, ctx) {
  const caja = h('div', { class: 'tabla-editable', 'data-campo': def.k });
  const datos = () => obj[def.k] || (obj[def.k] = {});
  const pintar = () => {
    const d = datos();
    const filas = Object.entries(d).map(([k, v]) => {
      const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '40', 'aria-label': 'Nombre del valor', 'data-valor-nombre': k }); nombre.value = k;
      const num = h('input', { class: 'entrada entrada-num', type: 'text', inputmode: 'decimal', 'aria-label': `Valor de ${k}`, 'data-valor-numero': k }); num.value = String(v).replace('.', ',');
      nombre.addEventListener('change', () => {
        const n = nombre.value.trim();
        if (!n || /[.;()[\]]/.test(n) || (n !== k && n in d)) { toast('Nombre no válido o repetido (sin . ; ( ) [ ]).', 'error'); nombre.value = k; return; }
        const nuevo = {}; for (const [kk, vv] of Object.entries(d)) nuevo[kk === k ? n : kk] = vv;
        obj[def.k] = nuevo; ctx.alCambiar(def.k); pintar();
      });
      num.addEventListener('input', () => { const x = Number(num.value.replace(',', '.')); num.classList.toggle('invalido', !Number.isFinite(x)); if (Number.isFinite(x)) { d[k] = x; ctx.alCambiar(def.k); } });
      return h('div', { class: 'fila-tabla' }, nombre, num,
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': `Quitar ${k}`, onclick: () => { delete d[k]; ctx.alCambiar(def.k); pintar(); } }, '✕'));
    });
    caja.replaceChildren(...(filas.length ? filas : [h('p', { class: 'tenue pequeno' }, 'Sin valores propios.')]),
      h('button', { type: 'button', class: 'btn', 'data-accion': 'nuevo-valor', onclick: () => {
        let n = 'Potencia', i = 2; while (n in datos()) n = `Valor ${i++}`;
        datos()[n] = 10; ctx.alCambiar(def.k); pintar();
      } }, '+ Añadir valor'));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Punto de entrada ──
// ── Color (con «sin color») ──
function color(def, obj, ctx) {
  const c = h('input', { type: 'color', class: 'selector-color', 'data-campo': def.k, 'aria-label': def.etiqueta });
  c.value = obj[def.k] || '#888888';
  const quitar = h('button', { type: 'button', class: 'btn btn-mini', onclick: () => { delete obj[def.k]; c.value = '#888888'; estado(); ctx.alCambiar(def.k); } }, 'Sin color');
  const txt = h('span', { class: 'tenue' });
  const estado = () => { txt.textContent = obj[def.k] ? obj[def.k] : '(sin color)'; quitar.hidden = !obj[def.k]; };
  c.addEventListener('input', () => { obj[def.k] = c.value; estado(); ctx.alCambiar(def.k); });
  estado();
  return envoltura(def, h('div', { class: 'con-sufijo' }, c, txt, quitar));
}

// ── Se puede romper (activar + golpes + en qué se convierte) ──
function rompible(def, obj, ctx) {
  const activo = h('input', { type: 'checkbox', 'data-campo': def.k });
  activo.checked = !!obj[def.k];
  const detalle = h('div', { class: 'sub-campos' });
  const pintar = () => {
    detalle.hidden = !activo.checked;
    if (!activo.checked) return;
    const r = obj[def.k];
    const golpes = h('input', { class: 'entrada entrada-num', type: 'number', min: '1', max: '999', 'data-campo': 'golpes' });
    golpes.value = r.golpes ?? 3;
    golpes.addEventListener('input', () => { r.golpes = Math.max(1, entero(golpes.value, 1)); ctx.alCambiar(def.k); });
    const dest = h('select', { class: 'entrada', 'data-campo': 'se_convierte_en' },
      h('option', { value: '' }, '(el suelo base del mapa)'), lista('tiles').filter((t) => t.id !== ctx.propioId).map((t) => h('option', { value: t.id }, t.nombre)));
    dest.value = r.se_convierte_en || '';
    dest.addEventListener('change', () => { r.se_convierte_en = dest.value; ctx.alCambiar(def.k); });
    detalle.replaceChildren(
      h('label', { class: 'mini-campo' }, 'Golpes que aguanta', golpes),
      h('label', { class: 'mini-campo' }, 'Al romperse se convierte en', dest));
  };
  activo.addEventListener('change', () => {
    if (activo.checked) obj[def.k] = { golpes: 3, se_convierte_en: '' }; else delete obj[def.k];
    pintar(); ctx.alCambiar(def.k);
  });
  pintar();
  return h('div', { class: 'campo campo-interruptor' },
    h('label', { class: 'interruptor' }, activo, h('span', { class: 'pista' }), h('span', { class: 'campo-etiqueta' }, def.etiqueta)),
    def.ayuda ? h('p', { class: 'ayuda' }, def.ayuda) : null, detalle);
}

// ── Área de una habilidad: forma + tamaño + a quién afecta, con un dibujo de las casillas ──
const FORMAS_AREA = [['uno', '🎯 Un objetivo'], ['explosion', '💥 Explosión'], ['linea', '➖ Línea'], ['frente', '↔️ Frente'], ['cono', '🔺 Cono'], ['casillas', '✏️ Dibujar casillas']];
function area(def, obj, ctx) {
  const caja = h('div', { class: 'area', 'data-campo': def.k });
  const pintar = () => {
    const a = obj[def.k] || { forma: 'uno' };
    const forma = a.forma || 'uno';
    const poner = (cambios) => {
      const n = { forma, tamano: a.tamano || 1, afecta: a.afecta || 'rivales', ...(a.casillas ? { casillas: a.casillas } : {}), ...cambios };
      if (n.forma === 'casillas' && !n.casillas?.length) n.casillas = [[1, 0]];
      if (n.forma !== 'casillas') delete n.casillas;
      if (n.forma === 'uno') delete obj[def.k]; else obj[def.k] = n;
      ctx.alCambiar(def.k); pintar();
    };
    const segs = h('div', { class: 'segmentos', role: 'group' }, FORMAS_AREA.map(([v, t]) => h('button', { type: 'button', class: 'seg', 'data-area': v, 'aria-pressed': String(forma === v), onclick: () => poner({ forma: v }) }, t)));
    const explicacion = {
      uno: 'Alcanza solo al objetivo que elijas.',
      explosion: 'Alcanza todo lo que haya alrededor de la casilla elegida (o de quien la usa, si es «a sí mismo»).',
      linea: 'Sale de quien la usa hacia donde apuntes y atraviesa a todos hasta su alcance (se para en los muros si no los atraviesa).',
      frente: 'Una fila de casillas de cara a la dirección en que apuntas, centrada en la casilla elegida (por ejemplo, 3 casillas delante).',
      cono: 'Sale de quien la usa y se abre hacia donde apuntes (arriba, abajo, izquierda o derecha): 1 casilla, luego 3, luego 5…',
      casillas: 'Pulsa las casillas del dibujo para marcar o desmarcar las que alcanza. Quien la usa es el punto verde y mira hacia la derecha; en la partida, el dibujo gira hacia donde apunte.',
    }[forma];
    let extra = [];
    if (forma === 'explosion' || forma === 'frente' || forma === 'cono') {
      const nombreTam = { explosion: 'Radio', frente: 'Ancho', cono: 'Largo' }[forma];
      const n = h('input', { class: 'entrada entrada-num', type: 'number', min: 1, max: 20, 'data-area-tamano': '', 'aria-label': nombreTam });
      n.value = a.tamano || 1;
      n.addEventListener('change', () => poner({ tamano: Math.max(1, Math.min(20, entero(n.value, 1))) }));
      extra.push(h('label', { class: 'fila-inline' }, h('span', null, nombreTam), n, h('span', { class: 'tenue' }, 'casillas')));
    }
    if (forma !== 'uno') {
      const s = h('select', { class: 'entrada', 'data-area-afecta': '', 'aria-label': 'A quién alcanza' },
        [['rivales', 'Solo a los rivales'], ['todos', 'A todos (también a sus aliados)'], ['aliados', 'Solo a los aliados (y a sí mismo)']].map(([v, t]) => h('option', { value: v }, t)));
      s.value = a.afecta || 'rivales';
      s.addEventListener('change', () => poner({ afecta: s.value }));
      extra.push(h('label', { class: 'fila-inline' }, h('span', null, 'Alcanza'), s));
    }
    const dibujo = forma === 'casillas' ? pintorArea(a.casillas || [], (celdas) => poner({ casillas: celdas })) : dibujoArea(forma, a.tamano || 1, obj.alcance || 1);
    caja.replaceChildren(segs, h('div', { class: 'area-cuerpo' }, dibujo, h('div', null, h('p', { class: 'ayuda' }, explicacion), ...extra)));
  };
  pintar();
  const baja = bus.mientras(caja, 'cambio', () => { if (!caja.isConnected) { baja(); return; } pintar(); });
  return envoltura(def, caja);
}
/** Rejilla de 11 × 11 para dibujar un área a mano: quien la usa en el centro, mirando a la derecha. Guarda [adelante, lado]. */
function pintorArea(celdas, alCambiar) {
  const N = 11, c = 5, T = 18;
  const marcadas = new Set(celdas.map(([f, l]) => `${f},${l}`));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${N * T} ${N * T}`); svg.setAttribute('width', N * T); svg.setAttribute('height', N * T);
  svg.setAttribute('class', 'area-pintor'); svg.setAttribute('role', 'grid'); svg.setAttribute('aria-label', 'Casillas que alcanza');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const f = x - c, l = y - c, yo = !f && !l, k = `${f},${l}`;
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries({ x: x * T, y: y * T, width: T - 2, height: T - 2, rx: 3, 'data-celda': k,
      fill: yo ? 'var(--acento)' : marcadas.has(k) ? 'rgba(220,90,60,.8)' : 'rgba(127,127,127,.18)' }).forEach(([a, v]) => r.setAttribute(a, v));
    if (!yo) {
      r.style.cursor = 'pointer';
      r.addEventListener('click', () => {
        if (marcadas.has(k)) { if (marcadas.size > 1) marcadas.delete(k); } else marcadas.add(k);
        alCambiar([...marcadas].map((s) => s.split(',').map(Number)));
      });
    }
    svg.append(r);
  }
  const flecha = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  Object.entries({ x: c * T + T - 1, y: c * T + T * 0.75, 'font-size': 12, fill: 'var(--texto)' }).forEach(([a, v]) => flecha.setAttribute(a, v));
  flecha.textContent = '›';
  svg.append(flecha);
  return h('span', { class: 'area-dibujo' }, svg);
}
/** Un dibujito de 7 × 7 casillas: quien la usa (●) a la izquierda, apuntando hacia la derecha. */
function dibujoArea(forma, tam, alcance) {
  const N = 7, c = 3, ox = 0;
  const marcadas = new Set();
  const px = Math.min(N - 1, ox + Math.max(1, Math.min(alcance, N - 1)));
  if (forma === 'uno') marcadas.add(`${px},${c}`);
  else if (forma === 'explosion') { const cx = Math.min(N - 1 - Math.min(tam, 3), Math.max(px, Math.min(tam, 3))); for (let y = c - tam; y <= c + tam; y++) for (let x = cx - tam; x <= cx + tam; x++) marcadas.add(`${x},${y}`); }
  else if (forma === 'linea') for (let x = 1; x <= Math.min(N - 1, alcance); x++) marcadas.add(`${x},${c}`);
  else if (forma === 'frente') { const m = Math.floor(tam / 2); for (let k = -m; k < tam - m; k++) marcadas.add(`${px},${c + k}`); }
  else if (forma === 'cono') for (let k = 1; k <= Math.min(tam, N - 1); k++) for (let l = -(k - 1); l < k; l++) marcadas.add(`${k},${c + l}`);
  const T = 12, celdas = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const yo = x === ox && y === c;
    celdas.push(`<rect x="${x * T}" y="${y * T}" width="${T - 1}" height="${T - 1}" rx="2" fill="${yo ? 'var(--acento)' : marcadas.has(`${x},${y}`) ? 'rgba(220,90,60,.75)' : 'rgba(127,127,127,.18)'}"/>`);
  }
  const svg = h('span', { class: 'area-dibujo', 'aria-hidden': 'true' });
  svg.innerHTML = `<svg viewBox="0 0 ${N * T} ${N * T}" width="${N * T}" height="${N * T}">${celdas.join('')}</svg>`;
  return svg;
}

// ── Mover al objetivo: atraer o empujar ──
function moverObjetivo(def, obj, ctx) {
  const caja = h('div', { class: 'fila-inline', 'data-campo': def.k });
  const pintar = () => {
    const m = obj[def.k];
    const modo = m?.modo || 'no';
    const s = h('select', { class: 'entrada', 'aria-label': 'Mover al objetivo', 'data-mover-modo': '' },
      [['no', 'No lo mueve'], ['atraer', '🧲 Lo atrae hacia quien la usa'], ['empujar', '💨 Lo empuja lejos']].map(([v, t]) => h('option', { value: v }, t)));
    s.value = modo;
    s.addEventListener('change', () => { if (s.value === 'no') delete obj[def.k]; else obj[def.k] = { modo: s.value, casillas: s.value === 'atraer' ? 0 : 1 }; ctx.alCambiar(def.k); pintar(); });
    let n = null;
    if (modo !== 'no') {
      n = h('input', { class: 'entrada entrada-num', type: 'number', min: 0, max: 20, 'aria-label': 'Casillas', 'data-mover-casillas': '' });
      n.value = m.casillas ?? 0;
      n.addEventListener('input', () => { m.casillas = Math.max(0, Math.min(20, entero(n.value, 0))); ctx.alCambiar(def.k); });
    }
    caja.replaceChildren(...[s, n, n ? h('span', { class: 'tenue' }, modo === 'atraer' ? 'casillas (0 = hasta tenerlo delante)' : 'casillas') : null].filter(Boolean));
  };
  pintar();
  return envoltura(def, caja);
}

// ── Varias casillas (lista de valores fijos): [valor, …] ──
function casillas(def, obj, ctx) {
  const caja = h('div', { class: 'chips', 'data-campo': def.k });
  const actual = () => (Array.isArray(obj[def.k]) ? obj[def.k] : []);
  caja.append(...def.opciones.map(([v, t]) => {
    const c = h('input', { type: 'checkbox', 'data-valor': v });
    c.checked = actual().includes(v);
    c.addEventListener('change', () => {
      const n = def.opciones.map(([x]) => x).filter((x) => (x === v ? c.checked : actual().includes(x)));
      if (n.length) obj[def.k] = n; else delete obj[def.k];
      ctx.alCambiar(def.k);
    });
    return h('label', { class: 'chip chip-check' }, c, ' ', t);
  }));
  return envoltura(def, caja);
}

// ── Crítico de una habilidad: {desde, multiplicador} ──
function critico(def, obj, ctx) {
  const caja = h('div', { 'data-campo': def.k });
  const pintar = () => {
    const c = obj[def.k];
    const on = h('input', { type: 'checkbox', 'data-accion': 'critico-activo' });
    on.checked = !!c;
    on.addEventListener('change', () => { if (on.checked) obj[def.k] = { desde: 20, multiplicador: 2 }; else delete obj[def.k]; ctx.alCambiar(def.k); pintar(); });
    const filas = [h('label', { class: 'interruptor' }, on, h('span', { class: 'pista' }), h('span', null, 'Puede ser crítico (se tira un d20 aparte en cada golpe)'))];
    if (c) {
      const desde = h('input', { class: 'entrada entrada-num', type: 'number', min: 1, max: 20, 'aria-label': 'Desde', 'data-critico': 'desde' }); desde.value = c.desde;
      desde.addEventListener('input', () => { c.desde = Math.max(1, Math.min(20, entero(desde.value, 20))); ctx.alCambiar(def.k); });
      const mult = h('input', { class: 'entrada entrada-num', type: 'text', inputmode: 'decimal', 'aria-label': 'Multiplica por', 'data-critico': 'multiplicador' }); mult.value = String(c.multiplicador).replace('.', ',');
      mult.addEventListener('input', () => { const n = Number(mult.value.replace(',', '.')); mult.classList.toggle('invalido', !(n >= 0 && n <= 100)); if (n >= 0 && n <= 100) { c.multiplicador = n; ctx.alCambiar(def.k); } });
      filas.push(h('div', { class: 'fila-inline' }, 'Con', desde, 'o más en el d20, el resultado se multiplica por', mult));
    }
    caja.replaceChildren(...filas);
  };
  pintar();
  return envoltura({ ...def, ayuda: 'En el chat sale «¡Crítico!». Los rasgos, estados u objetos pueden hacerlo más fácil con «Crítico más fácil».' }, caja);
}

/** Cómo se dibuja cada tipo de campo (`t:` en las definiciones de esquemas.js y reglas.js). Un tipo nuevo = una función arriba y una fila aquí. */
export const CAMPOS = {
  texto,
  largo: (d, o, c) => texto(d, o, c, true),
  numero,
  interruptor,
  opciones,
  seleccion,
  ref,
  refs,
  imagen,
  valores,
  efectoObjeto,
  sonidos: (d, o, c) => sonidosPersonaje(d, o, c),
  inventario: (d, o, c) => listaObjetos(d, o, c, { articulos: false }),
  articulos: (d, o, c) => listaObjetos(d, o, c, { articulos: true }),
  formula,
  valoresLibres,
  etiquetas,
  soloSi,
  aprende,
  simulador: (d, o, c) => construirSimulador(d, o, c),
  statSola,
  categoriaNpc,
  lados,
  color,
  rompible,
  efectos: (d, o, c) => envoltura(d, construirEfectos(d, o, c)),
  requisitos: (d, o, c) => envoltura(d, construirCondiciones(d, o, c)),
  area,
  mover: (d, o, c) => moverObjetivo(d, o, c),
  casillas,
  critico,
};

export function construirCampo(def, obj, ctx) {
  const dibujar = CAMPOS[def.t];
  return dibujar ? dibujar(def, obj, ctx) : h('p', null, `Campo desconocido: ${def.t}`);
}
export { envoltura, fijar, texto, numero, interruptor, opciones, seleccion };
