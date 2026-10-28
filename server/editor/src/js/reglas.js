// reglas.js — «Reglas del juego»: config.yaml con controles en vez de texto. Aquí se activa o desactiva lo que se puede hacer en la campaña.
import { h, toast, confirmar, dialogo, entero, sinSaltoDeScroll } from './util.js';
import { construirCampo } from './campos.js';
import { E } from './estado.js';
import { construirEfectos } from './efectos.js';

const SECCIONES = [
  // Personajes
  { bloque: 'Personajes', id: 'estadisticas', titulo: 'Estadísticas y recursos', icono: '📊', ayuda: 'Qué números tienen los personajes (Fuerza…) y qué se gasta (vida, magia…).' },
  { bloque: 'Personajes', id: 'personajes', titulo: 'Creación de personajes', icono: '🧙', ayuda: 'Quién puede crear personajes y cómo se reparten los puntos.' },
  { bloque: 'Personajes', id: 'ficha', titulo: 'Ficha', icono: '📝', ayuda: 'Datos propios de la ficha de cada personaje: Alineamiento, Edad, Dios, Cordura…' },
  { bloque: 'Personajes', id: 'niveles', titulo: 'Niveles y experiencia', icono: '⭐', ayuda: 'Si los personajes suben de nivel: con experiencia (que puede ser de varios tipos) o cuando el GM decida, y qué da cada nivel (puntos, vida, habilidades o hechizos).' },
  // Partida
  { bloque: 'Partida', id: 'turnos', titulo: 'Turnos y movimiento', icono: '⏱️', ayuda: 'Quién decide el orden de los turnos en combate y cuántas casillas puede andar cada uno en su turno.' },
  { bloque: 'Partida', id: 'mesa', titulo: 'Funciones de la mesa', icono: '🎛️', ayuda: 'Activa o desactiva funciones: turnos, música, mover fichas…' },
  { bloque: 'Partida', id: 'visibilidad', titulo: 'Qué ven los jugadores', icono: '👁️', ayuda: 'Qué datos de los demás personajes y de los NPC se ven. Todo está oculto hasta que lo actives (o el GM lo muestre en el juego).' },
  // Mundo
  { bloque: 'Mundo', id: 'dinero', titulo: 'Dinero y comercio', icono: '🪙', ayuda: 'La moneda de la campaña, sus piezas y si los jugadores pueden intercambiar. Las tiendas se crean en la categoría «Tiendas» y el GM las abre en la partida.' },
  { bloque: 'Mundo', id: 'sistema', titulo: 'Día, noche y clima', icono: '🌦️', ayuda: 'Momentos del día y clima que el GM cambia durante la partida; tiñen el mapa y los efectos pueden depender de ellos.' },
  { bloque: 'Mundo', id: 'niebla', titulo: 'Niebla de guerra', icono: '🌫️', ayuda: 'Cada jugador solo ve lo que alcanza la visión de sus personajes. La visión extra se da con efectos de rasgos, estados, objetos y tiles.' },
  // Avanzado
  { bloque: 'Avanzado', id: 'automaticas', titulo: 'Reglas automáticas', icono: '⚡', ayuda: 'Efectos que valen para TODOS (personajes y NPC), sin tener que ponerlos en cada raza o clase. Usa las condiciones para limitarlos: «al derrotar a alguien, si es personaje de un jugador, +10 Experiencia».' },
  { bloque: 'Avanzado', id: 'etiquetas', titulo: 'Etiquetas y ventajas', icono: '🏷️', ayuda: 'Tipos, elementos o categorías (Fuego, Agua, No-muerto, Cortante…) que llevan las habilidades, razas/clases, NPC y estados, y quién es fuerte contra quién. Las fórmulas lo usan con ventaja().' },
  { bloque: 'Avanzado', id: 'tablas', titulo: 'Tablas para fórmulas', icono: '📋', ayuda: 'Tablas por tramos que las fórmulas consultan: «si saco 2–5 → ×1,5», tablas de críticos, de botín, de clima… Se usan en una fórmula con tabla(Nombre; valor).' },
  // Servidor
  { bloque: 'Servidor', id: 'general', titulo: 'General', icono: '🏷️', ayuda: 'Nombre de la campaña, mapa de inicio y acceso al servidor.' },
  { bloque: 'Servidor', id: 'seguridad', titulo: 'Seguridad y cuentas', icono: '🔒', ayuda: 'Contraseñas, registro de jugadores y cifrado.' },
];

/** «Niveles y experiencia»: modo, tipos de experiencia (estadísticas contador), umbrales, qué da cada nivel y qué se aprende. */
function nivelesYExperiencia(b, ctx, c) {
  const n = b.juego.niveles;
  const caja = h('div', { class: 'niveles-editor' });
  const pintar = () => {
    const contadores = (b.juego.estadisticas || []).filter((e) => e.repartible === false);
    const tipos = h('div', { class: 'chips', 'data-campo': 'experiencia' }, contadores.length ? contadores.map((e) => {
      const ch = h('input', { type: 'checkbox', 'data-experiencia': e.nombre });
      ch.checked = n.experiencia.includes(e.nombre);
      ch.addEventListener('change', () => { n.experiencia = ch.checked ? [...n.experiencia, e.nombre] : n.experiencia.filter((x) => x !== e.nombre); ctx.alCambiar(); });
      return h('label', { class: 'chip chip-check' }, ch, ' ', e.nombre);
    }) : h('span', { class: 'tenue pequeno' }, 'Primero crea una estadística contador (en «Estadísticas y recursos», desmarca «Puntos»): Experiencia, o varias como «Exp. combate» y «Exp. exploración».'));
    const umbrales = h('input', { type: 'text', class: 'entrada', 'data-campo': 'umbrales', placeholder: '100, 300, 600, 1000' });
    umbrales.value = n.umbrales.join(', ');
    umbrales.addEventListener('change', () => {
      const l = umbrales.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
      n.umbrales = l.filter((x, i) => i === 0 || x > l[i - 1]).slice(0, 99); umbrales.value = n.umbrales.join(', '); ctx.alCambiar(); pintar();
    });
    const recs = (b.juego.recursos || []).map((r) => {
      const i = h('input', { class: 'entrada entrada-num', type: 'number', min: -100000, max: 100000, step: 1, 'aria-label': `${r.nombre} por nivel`, 'data-por-nivel': r.nombre });
      i.value = n.por_nivel.recursos[r.nombre] ?? 0;
      i.addEventListener('input', () => { const v = Math.trunc(Number(i.value)) || 0; if (v) n.por_nivel.recursos[r.nombre] = v; else delete n.por_nivel.recursos[r.nombre]; ctx.alCambiar(); });
      return h('label', { class: 'mini-campo' }, r.nombre, i);
    });
    const habs = Object.entries(E.campana.recursos.habilidades || {});
    const filas = n.aprende.map((a, i) => {
      const nv = h('input', { class: 'entrada entrada-num', type: 'number', min: 2, max: 100, 'aria-label': 'Nivel', 'data-aprende-nivel': String(i) });
      nv.value = a.nivel; nv.addEventListener('input', () => { a.nivel = Math.max(2, Math.min(100, Math.trunc(Number(nv.value)) || 2)); ctx.alCambiar(); });
      const hs = h('select', { class: 'entrada', 'aria-label': 'Habilidad que aprende' }, habs.map(([id, x]) => h('option', { value: id }, x.nombre || id)));
      hs.value = a.habilidad; hs.addEventListener('change', () => { a.habilidad = hs.value; ctx.alCambiar(); });
      return h('div', { class: 'fila-lista' }, h('span', null, 'Al nivel'), nv, h('span', null, 'aprende'), hs,
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar', onclick: () => { n.aprende.splice(i, 1); ctx.alCambiar(); pintar(); } }, '✕'));
    });
    const manual = n.modo === 'manual';
    caja.replaceChildren(
      grupoCampos('Niveles',
        construirCampo({ t: 'interruptor', k: 'activo', etiqueta: 'Los personajes tienen nivel', ayuda: 'Se ve en la ficha y las fórmulas pueden usarlo como [Nivel] (los NPC también tienen nivel, en su ficha).' }, n,
          { ...ctx, alCambiar: (k) => { ctx.alCambiar(k); pintar(); } }),
        n.activo ? h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, '¿Cómo se sube?'), (() => {
          const s = h('div', { class: 'segmentos', role: 'group' }, [['manual', '✋ Lo decide el GM (recomendado)'], ['experiencia', '⭐ Con experiencia (automático)']].map(([v, t]) => h('button', { type: 'button', class: 'seg', 'data-valor': v, 'aria-pressed': String(n.modo === v),
            onclick: () => { n.modo = v; ctx.alCambiar(); pintar(); } }, t)));
          return s;
        })(), h('p', { class: 'ayuda' }, manual ? 'Nadie sube solo: el GM pulsa «⬆️ Subir de nivel» en la ficha o en el Panel del GM. Sirve si lleváis la experiencia fuera del programa (papel, Drive…).' : 'Al juntar la experiencia de cada umbral se sube solo. El GM puede además subir a alguien a mano.')) : null),
      n.activo ? grupoCampos('Experiencia',
        h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Qué cuenta como experiencia'), tipos,
          h('p', { class: 'ayuda' }, manual ? 'Se suman todas las marcadas y la ficha muestra el total y cada tipo. Con «Lo decide el GM» no sube sola: es una guía para el GM (por ejemplo, para decidir a qué evoluciona).'
            : 'Se suman todas las marcadas. La experiencia se gana con efectos («Al derrotar a alguien → sumar 10 a Exp. combate», en Reglas automáticas o en rasgos) la ceden los enemigos al caer (ver «Experiencia al derrotar enemigos»), o la da el GM con «Dar experiencia» al editar un token.')),
        manual ? null : h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Experiencia total para cada nivel'), umbrales,
          h('p', { class: 'ayuda' }, `Para llegar a nivel 2, 3, 4… separados por comas, cada uno mayor que el anterior. Con estos umbrales se llega hasta el nivel ${n.umbrales.length + 1} (el «Nivel máximo» de más abajo puede ser menor).`))) : null,
      n.activo ? grupoCampos('Experiencia al derrotar enemigos',
        c({ t: 'seleccion', k: 'reparto', etiqueta: '¿Quién la recibe?', opciones: [['todos', 'Todos los personajes que sigan en pie'], ['vencedor', 'Solo quien derrota al enemigo']],
          ayuda: 'Cada enemigo indica cuánta experiencia cede en su ficha («Experiencia que cede», por tipo) y el GM puede cambiarla en cada token. Hace falta marcar arriba al menos un tipo de experiencia.' }, n)) : null,
      n.activo ? grupoCampos('Rangos por tipo (opcional)',
        h('p', { class: 'ayuda' }, 'Para contadores que «suben de nivel» por su cuenta, como Valentía, Atractivo o Exp. sagrada. Escribe el valor que hace falta para llegar al rango 2, 3, 4… separados por comas. Las fórmulas y condiciones pueden usar el rango: [Rango Valentía]. Vacío = sin rangos.'),
        ...(contadores.length ? contadores.map((e) => {
          const i = h('input', { type: 'text', class: 'entrada', placeholder: '10, 30, 60', 'aria-label': `Rangos de ${e.nombre}`, 'data-escalones': e.nombre });
          i.value = (e.escalones || []).join(', ');
          i.addEventListener('change', () => {
            const l = i.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x) && x > 0).map(Math.trunc);
            const limpia = l.filter((x, k) => k === 0 || x > l[k - 1]).slice(0, 30);
            if (limpia.length) e.escalones = limpia; else delete e.escalones;
            i.value = limpia.join(', '); ctx.alCambiar();
          });
          return h('div', { class: 'fila-lista' }, h('strong', null, e.nombre), i, h('span', { class: 'tenue pequeno' }, `[Rango ${e.nombre}]`));
        }) : [h('p', { class: 'tenue pequeno' }, 'No hay estadísticas contador todavía (en «Estadísticas y recursos», desmarca «Puntos»).')])) : null,
      n.activo ? grupoCampos('Nivel máximo', c({ t: 'numero', k: 'maximo', etiqueta: 'Nivel máximo', min: 1, max: 100, defecto: 20,
        ayuda: manual ? 'El GM no podrá subir de nivel más allá de este.' : 'Aunque la experiencia sea automática, nadie pasa de este nivel. Si pones más niveles que umbrales, el tope real son los umbrales.' }, n)) : null,
      n.activo ? grupoCampos('Qué da cada nivel',
        h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, '¿Quién da lo que gana cada nivel?'),
          h('div', { class: 'segmentos', role: 'group', 'data-campo': 'entrega' }, [['automatica', '⚙️ El programa, solo'], ['gm', '✋ El GM, a mano']].map(([v, t]) => h('button', { type: 'button', class: 'seg', 'data-valor': v,
            'aria-pressed': String((n.entrega || 'automatica') === v), onclick: () => { n.entrega = v; ctx.alCambiar(); pintar(); } }, t))),
          h('p', { class: 'ayuda' }, n.entrega === 'gm' ? 'Al subir de nivel solo cambia el nivel: el GM da puntos, vida o habilidades a mano al editar el token.'
            : 'Al subir de nivel se da lo de abajo (para todos) más lo propio de su raza, clase u origen.')),
        n.entrega === 'gm' ? null : [c({ t: 'numero', k: 'puntos', etiqueta: 'Puntos para repartir', sufijo: 'por nivel', min: 0, max: 1000, defecto: 0, ayuda: 'Se suman a los pendientes; el jugador (o el GM, según «Creación de personajes») los reparte con «+» en la ficha.' }, n.por_nivel),
        h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Máximo de los recursos'), h('div', { class: 'fila-inline envolver' }, recs), h('p', { class: 'ayuda' }, 'Cuánto sube el máximo (y el valor actual) de cada recurso por nivel. 0 = nada.')),
        h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Habilidades o hechizos que se aprenden'), ...filas,
          habs.length ? h('button', { type: 'button', class: 'btn btn-mini', 'data-accion': 'anadir-aprende', onclick: () => { n.aprende.push({ nivel: 2, habilidad: habs[0][0] }); ctx.alCambiar(); pintar(); } }, '＋ Añadir') : null,
          h('p', { class: 'ayuda' }, 'Todo esto vale para todos. Lo propio de una raza o clase (un mago que aprende Bola de fuego al nivel 3, un guerrero con más vida por nivel) se pone en esa opción, en «Razas, clases y orígenes».'))]) : null);
  };
  pintar();
  return caja;
}

const grupoCampos = (titulo, ...hijos) => h('section', { class: 'bloque' }, titulo ? h('h3', null, titulo) : null, ...hijos);

function estadoContrasena(valor) {
  if (!valor) return { texto: 'Sin contraseña', clase: 'neutro' };
  if (/^scrypt\$/.test(valor)) return { texto: 'Protegida (guardada cifrada)', clase: 'bien' };
  return { texto: 'Guardada en texto plano: cámbiala para protegerla', clase: 'aviso' };
}

function campoContrasena(titulo, ayuda, obj, clave, ctx, { minimo = 6 } = {}) {
  const caja = h('div', { class: 'campo' });
  const pintar = () => {
    const e = estadoContrasena(obj[clave]);
    caja.replaceChildren(h('label', { class: 'campo-etiqueta' }, titulo),
      h('div', { class: 'fila-inline' }, h('span', { class: `insignia insignia-${e.clase}` }, e.texto),
        h('button', { type: 'button', class: 'btn', onclick: cambiar }, obj[clave] ? 'Cambiar…' : 'Poner contraseña…'),
        obj[clave] ? h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => { obj[clave] = ''; ctx.alCambiar(); pintar(); } }, 'Quitar') : null),
      h('p', { class: 'ayuda' }, ayuda));
  };
  async function cambiar() {
    const a = h('input', { type: 'password', class: 'entrada', autofocus: true, 'aria-label': 'Contraseña nueva', autocomplete: 'off' });
    const b = h('input', { type: 'password', class: 'entrada', 'aria-label': 'Repite la contraseña', autocomplete: 'off' });
    const aviso = h('p', { class: 'error' });
    const r = await dialogo({
      titulo: titulo, contenido: h('div', { class: 'campos-dialogo' }, h('label', null, 'Contraseña nueva', a), h('label', null, 'Repítela', b),
        h('p', { class: 'ayuda' }, `Mínimo ${minimo} caracteres. Se guarda cifrada: nadie podrá leerla después, ni tú.`), aviso),
      botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', valor: 'ok', clase: 'btn-acento' }],
      alMostrar: (_c, cierre) => {
        const ir = () => { if (a.value.length < minimo) { aviso.textContent = `Debe tener al menos ${minimo} caracteres.`; return; } if (a.value !== b.value) { aviso.textContent = 'No coinciden.'; return; } cierre('ok'); };
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
        const ok = _c.querySelector('.btn-acento'); ok.onclick = ir;
      },
    });
    if (r !== 'ok') return;
    try { obj[clave] = await window.editor.hash(a.value); ctx.alCambiar(); pintar(); toast('Contraseña guardada (recuerda pulsar Guardar).', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  pintar();
  return caja;
}

/** «Quién la tiene» de una estadística o recurso que no es de todos: razas, clases… (opciones) que la dan. */
function quienesLaTienen(x, ctx, repintar) {
  if (x.para_todos !== false) return null;
  const ops = Object.entries(E.campana.recursos.opciones || {});
  const grupos = E.campana.recursos.grupos || {};
  const nombre = (id) => { const o = E.campana.recursos.opciones?.[id]; return o ? `${grupos[o.grupo]?.nombre || o.grupo}: ${o.nombre || id}` : `${id} (no existe)`; };
  const lista = x.solo_para || [];
  const sel = h('select', { class: 'entrada entrada-anadir', 'aria-label': 'Añadir quién la tiene', 'data-col': 'solo_para' },
    h('option', { value: '' }, ops.length ? '+ Quién la tiene…' : '(crea razas o clases primero)'),
    ops.filter(([id]) => !lista.includes(id)).map(([id]) => h('option', { value: id }, nombre(id))));
  sel.addEventListener('change', () => { if (sel.value) { x.solo_para = [...lista, sel.value]; ctx.alCambiar(); repintar(); } });
  return h('div', { class: 'solo-para chips' }, h('span', { class: 'tenue pequeno' }, 'La tienen:'),
    ...lista.map((id, i) => h('span', { class: 'chip' }, nombre(id),
      h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Quitar', onclick: () => { lista.splice(i, 1); if (!lista.length) delete x.solo_para; ctx.alCambiar(); repintar(); } }, '✕'))),
    lista.length ? null : h('span', { class: 'tenue pequeno' }, 'nadie todavía'), sel);
}

// ── Tablas de estadísticas y recursos ──
/** Desplegable con las estadísticas del borrador (las que se ven ahora en «Estadísticas y recursos», aunque no estén guardadas). */
function selectorEstadistica(b, obj, clave, etiqueta, ayuda, ctx) {
  const nombres = (b.juego.estadisticas || []).map((e) => e.nombre).filter(Boolean);
  const s = h('select', { class: 'entrada', 'data-campo': clave }, nombres.map((n) => h('option', { value: n }, n)));
  if (obj[clave] && !nombres.includes(obj[clave])) s.append(h('option', { value: obj[clave] }, `${obj[clave]} (no existe)`));
  if (!obj[clave] && nombres.length) obj[clave] = nombres[0];
  s.value = obj[clave] || '';
  s.addEventListener('change', () => { obj[clave] = s.value; ctx.alCambiar(clave); });
  return h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, etiqueta), s, ayuda ? h('p', { class: 'ayuda' }, ayuda) : null);
}

function tablaEstadisticas(b, ctx, renombres) {
  const j = b.juego;
  const caja = h('div', { class: 'tabla-editable' });
  const pintar = () => {
    const filas = (j.estadisticas || (j.estadisticas = [])).map((e, i) => {
      const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '30', 'aria-label': 'Nombre', 'data-col': 'nombre' }); nombre.value = e.nombre;
      e._origen ??= e.nombre;
      nombre.addEventListener('input', () => {
        e.nombre = nombre.value;
        nombre.classList.toggle('invalido', !nombre.value.trim() || j.estadisticas.filter((x) => x.nombre.trim().toLowerCase() === nombre.value.trim().toLowerCase()).length > 1);
        ctx.alCambiar();
      });
      const desc = h('input', { class: 'entrada', type: 'text', maxlength: '120', placeholder: 'Descripción (opcional)', 'aria-label': 'Descripción' }); desc.value = e.descripcion || '';
      desc.addEventListener('input', () => { if (desc.value) e.descripcion = desc.value; else delete e.descripcion; ctx.alCambiar(); });
      const num = (k, etiqueta, def, min = 0) => { const n = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', min, 'aria-label': etiqueta, 'data-col': k }); n.value = e[k] ?? def;
        n.addEventListener('input', () => { e[k] = entero(n.value, def); ctx.alCambiar(); }); return h('label', { class: 'mini-campo' }, etiqueta, n); };
      const todos = h('input', { type: 'checkbox', 'data-col': 'para_todos', 'aria-label': 'La tienen todos los personajes' }); todos.checked = e.para_todos !== false;
      todos.addEventListener('change', () => { if (todos.checked) { delete e.para_todos; delete e.solo_para; } else e.para_todos = false; ctx.alCambiar(); pintar(); });
      const reparto = h('input', { type: 'checkbox', 'data-col': 'repartible', 'aria-label': 'Recibe puntos al crear y al subir de nivel' }); reparto.checked = e.repartible !== false;
      reparto.addEventListener('change', () => { if (reparto.checked) delete e.repartible; else e.repartible = false; ctx.alCambiar(); });
      const categoria = j.categorias_estadisticas ? h('input', { class: 'entrada entrada-categoria', type: 'text', maxlength: '30', list: 'categorias-stats', placeholder: 'Categoría', 'aria-label': 'Categoría', 'data-col': 'categoria', title: 'Bloque en que se muestra: Combate, Social…' }) : null;
      if (categoria) { categoria.value = e.categoria || ''; categoria.addEventListener('change', () => { const v = categoria.value.trim(); if (v) e.categoria = v; else delete e.categoria; ctx.alCambiar(); }); }
      // Estadística calculada (opcional): su valor sale de una fórmula con las demás (modificador, CA, salvación…)
      const formula = h('input', { class: 'entrada entrada-formula', type: 'text', maxlength: '1000', spellcheck: 'false', 'data-col': 'formula', 'aria-label': `Fórmula de ${e.nombre}`,
        placeholder: 'Calculada (opcional): abajo(([Fuerza] - 10) / 2)', title: 'Si escribes una fórmula, esta estadística se calcula sola con las demás (y con sus bonos) y no recibe puntos. Sin dados. Solo puede usar las calculadas que estén más arriba.' });
      formula.value = e.formula || '';
      formula.addEventListener('input', () => { const v = formula.value.trim(); if (v) { e.formula = v; e.repartible = false; } else delete e.formula; reparto.checked = e.repartible !== false; reparto.disabled = !!e.formula; ctx.alCambiar(); });
      reparto.disabled = !!e.formula;
      return h('div', { class: 'fila-tabla' }, nombre, categoria, desc, num('valor_inicial', 'Inicial', 10), num('minimo', 'Mínimo', 0), num('maximo', 'Máximo', 99), formula,
        h('label', { class: 'mini-campo', title: 'Desmárcalo si solo algunas razas o clases la tienen (y elige cuáles)' }, 'Todos', todos),
        h('label', { class: 'mini-campo', title: 'Desmárcalo para un contador (experiencia, cordura, reputación…): no recibe puntos; cambia con efectos («Sumar a una estadística») o el GM' }, 'Puntos', reparto),
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', title: 'Quitar esta estadística', 'aria-label': 'Quitar', onclick: async () => {
          if (j.estadisticas.length <= 1) { toast('Debe haber al menos una estadística.', 'error'); return; }
          if (!(await confirmar('Quitar estadística', `¿Quitar «${e.nombre}»? Lo que la use (fórmulas, bonos…) quedará con errores hasta que lo corrijas.`, { si: 'Quitar', peligro: true }))) return;
          j.estadisticas.splice(i, 1); ctx.alCambiar(); pintar();
        } }, '✕'), quienesLaTienen(e, ctx, pintar));
    });
    const lista = h('datalist', { id: 'categorias-stats' }, [...new Set(j.estadisticas.map((e) => e.categoria).filter(Boolean))].map((c) => h('option', { value: c })));
    caja.replaceChildren(lista, ...filas, h('button', { type: 'button', class: 'btn', onclick: () => {
      let n = 'Estadística nueva', k = 2; while (j.estadisticas.some((x) => x.nombre === n)) n = `Estadística nueva ${k++}`;
      j.estadisticas.push({ nombre: n, valor_inicial: 10, minimo: 0, maximo: 99, _origen: null }); ctx.alCambiar(); pintar();
    } }, '+ Añadir estadística'));
  };
  pintar();
  return caja;
}

function tablaRecursos(b, ctx) {
  const j = b.juego;
  const caja = h('div', { class: 'tabla-editable' });
  const pintar = () => {
    const filas = (j.recursos || (j.recursos = [])).map((r, i) => {
      const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '30', 'aria-label': 'Nombre', 'data-col': 'nombre' }); nombre.value = r.nombre;
      r._origen ??= r.nombre;
      nombre.addEventListener('input', () => { if (j.recurso_vida === r.nombre) j.recurso_vida = nombre.value; r.nombre = nombre.value; nombre.classList.toggle('invalido', !nombre.value.trim()); ctx.alCambiar(); });
      nombre.addEventListener('change', () => ctx.refrescarSeccion?.());        // el desplegable «Recurso de vida» muestra el nombre nuevo
      const desc = h('input', { class: 'entrada', type: 'text', maxlength: '120', placeholder: 'Descripción (opcional)' }); desc.value = r.descripcion || '';
      desc.addEventListener('input', () => { if (desc.value) r.descripcion = desc.value; else delete r.descripcion; ctx.alCambiar(); });
      const n = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', min: 0, 'aria-label': 'Máximo inicial' }); n.value = r.maximo_inicial ?? 100;
      n.addEventListener('input', () => { r.maximo_inicial = entero(n.value, 100); ctx.alCambiar(); });
      const todos = h('input', { type: 'checkbox', 'data-col': 'para_todos', 'aria-label': 'Lo tienen todos los personajes' }); todos.checked = r.para_todos !== false;
      todos.addEventListener('change', () => { if (todos.checked) { delete r.para_todos; delete r.solo_para; } else r.para_todos = false; ctx.alCambiar(); pintar(); });
      const vacio = h('input', { type: 'checkbox', 'data-col': 'empieza_vacio', 'aria-label': 'Empieza vacío' }); vacio.checked = !!r.empieza_vacio;
      vacio.addEventListener('change', () => { if (vacio.checked) r.empieza_vacio = true; else delete r.empieza_vacio; ctx.alCambiar(); });
      const fmax = h('input', { class: 'entrada entrada-formula', type: 'text', maxlength: '1000', spellcheck: 'false', 'data-col': 'maximo_formula', 'aria-label': `Máximo con fórmula de ${r.nombre}`,
        placeholder: 'Máximo calculado (opcional): 10 + [Constitución] * [Nivel]', title: 'Si escribes una fórmula, el máximo de los personajes se calcula solo con sus estadísticas (y [Nivel]); al subir, el valor actual sube lo mismo. Los NPC usan el de su ficha. Sin dados.' });
      fmax.value = r.maximo_formula || '';
      fmax.addEventListener('input', () => { const v = fmax.value.trim(); if (v) r.maximo_formula = v; else delete r.maximo_formula; ctx.alCambiar(); });
      return h('div', { class: 'fila-tabla' }, nombre, desc, h('label', { class: 'mini-campo' }, 'Máximo inicial', n), fmax,
        h('label', { class: 'mini-campo', title: 'Marcado: empieza en 0 y se va llenando (experiencia, furia…). La vida no puede.' }, 'Vacío', vacio),
        h('label', { class: 'mini-campo', title: 'Desmárcalo si solo algunas razas o clases lo tienen (y elige cuáles). La vida debe ser de todos.' }, 'Todos', todos),
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', title: 'Quitar este recurso', 'aria-label': 'Quitar', onclick: async () => {
          if (j.recursos.length <= 1) { toast('Debe haber al menos un recurso (la vida).', 'error'); return; }
          if (!(await confirmar('Quitar recurso', `¿Quitar «${r.nombre}»? Lo que lo use quedará con errores hasta que lo corrijas.`, { si: 'Quitar', peligro: true }))) return;
          if (j.recurso_vida === r.nombre) j.recurso_vida = j.recursos.find((x) => x !== r)?.nombre;
          j.recursos.splice(i, 1); ctx.alCambiar(); pintar(); ctx.refrescarSeccion?.();
        } }, '✕'), quienesLaTienen(r, ctx, pintar));
    });
    caja.replaceChildren(...filas, h('button', { type: 'button', class: 'btn', onclick: () => {
      let n = 'Recurso nuevo', k = 2; while (j.recursos.some((x) => x.nombre === n)) n = `Recurso nuevo ${k++}`;
      j.recursos.push({ nombre: n, maximo_inicial: 50, _origen: null }); ctx.alCambiar(); pintar();
    } }, '+ Añadir recurso'));
  };
  pintar();
  return caja;
}

const TIPOS_CAMPO = [['texto', 'Texto'], ['numero', 'Número'], ['lista', 'Lista de opciones'], ['casilla', 'Sí / No']];
function tablaCamposFicha(j, ctx) {
  const caja = h('div', { class: 'tabla-editable' });
  const pintar = () => {
    const lista = j.campos_ficha || (j.campos_ficha = []);
    const filas = lista.map((c, i) => {
      const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '30', 'aria-label': 'Nombre del campo', 'data-col': 'nombre' }); nombre.value = c.nombre || '';
      nombre.addEventListener('input', () => { c.nombre = nombre.value; nombre.classList.toggle('invalido', !nombre.value.trim() || lista.filter((x) => x.nombre?.trim().toLowerCase() === nombre.value.trim().toLowerCase()).length > 1); ctx.alCambiar(); });
      const tipo = h('select', { class: 'entrada', 'aria-label': 'Tipo', 'data-col': 'tipo' }, TIPOS_CAMPO.map(([v, t]) => h('option', { value: v }, t))); tipo.value = c.tipo || 'texto';
      tipo.addEventListener('change', () => {
        c.tipo = tipo.value; delete c.opciones; delete c.minimo; delete c.maximo;
        if (c.tipo === 'lista') c.opciones = ['Opción 1']; if (c.tipo === 'numero') { c.minimo = 0; c.maximo = 100; }
        ctx.alCambiar(); pintar();
      });
      let extra = null;
      if (c.tipo === 'lista') {
        const ops = h('input', { class: 'entrada', type: 'text', maxlength: '600', placeholder: 'Opciones separadas por «;»', 'aria-label': 'Opciones', 'data-col': 'opciones' }); ops.value = (c.opciones || []).join('; ');
        ops.addEventListener('input', () => { c.opciones = ops.value.split(';').map((x) => x.trim()).filter(Boolean); ops.classList.toggle('invalido', !c.opciones.length); ctx.alCambiar(); });
        extra = ops;
      } else if (c.tipo === 'numero') {
        const num = (k, d) => { const n = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', 'aria-label': k === 'minimo' ? 'Mínimo' : 'Máximo' }); n.value = c[k] ?? d; n.addEventListener('input', () => { c[k] = entero(n.value, d); ctx.alCambiar(); }); return n; };
        extra = h('span', { class: 'fila-inline' }, 'de', num('minimo', 0), 'a', num('maximo', 100));
      }
      const quien = h('select', { class: 'entrada', 'aria-label': 'Quién lo rellena', 'data-col': 'quien' }, h('option', { value: 'jugador' }, 'Lo rellena el jugador'), h('option', { value: 'gm' }, 'Solo el GM')); quien.value = c.quien || 'jugador';
      quien.addEventListener('change', () => { if (quien.value === 'gm') c.quien = 'gm'; else delete c.quien; ctx.alCambiar(); });
      const priv = h('input', { type: 'checkbox', 'aria-label': 'Privado', 'data-col': 'privado' }); priv.checked = !!c.privado;
      priv.addEventListener('change', () => { if (priv.checked) c.privado = true; else delete c.privado; ctx.alCambiar(); });
      return h('div', { class: 'fila-tabla fila-campo-ficha' }, nombre, tipo, extra, quien,
        h('label', { class: 'mini-campo', title: 'Solo lo ven su dueño y el GM' }, 'Privado', priv),
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar', title: 'Quitar este campo', onclick: () => { lista.splice(i, 1); ctx.alCambiar(); pintar(); } }, '✕'));
    });
    caja.replaceChildren(...filas, h('button', { type: 'button', class: 'btn', 'data-accion': 'nuevo-campo-ficha', onclick: () => {
      let n = 'Campo nuevo', k = 2; while (lista.some((x) => x.nombre === n)) n = `Campo nuevo ${k++}`;
      lista.push({ nombre: n, tipo: 'texto' }); ctx.alCambiar(); pintar();
    } }, '+ Añadir campo'));
  };
  pintar();
  return caja;
}

const NOMBRES = [['personaje', 'Personaje'], ['habilidades', 'Habilidades'], ['inventario', 'Inventario'], ['estadisticas', 'Estadísticas'], ['recursos', 'Recursos'],
  ['rasgos', 'Rasgos'], ['estados', 'Estados'], ['diario', 'Diario'], ['grupo', 'Grupo']];
// Secciones del menú del cliente en el orden de siempre (igual que MENU_SECCIONES en mesa/recursos.py)
const MENU = [['lista-personajes', 'Personaje'], ['inventario', 'Inventario'], ['cofres', 'Grupo'], ['tiradas', 'Tiradas'], ['diario', 'Diario'], ['tienda', 'Tienda'], ['ajustes', 'Ajustes'], ['gm', 'Panel del GM (solo lo ve el GM)']];
function ordenMenu(j, ctx) {
  const base = MENU.map(([k]) => k);
  const caja = h('div', { class: 'orden-menu' });
  const actual = () => { const l = (Array.isArray(j.orden_menu) ? j.orden_menu : []).filter((k) => base.includes(k)); return [...new Set(l), ...base.filter((k) => !l.includes(k))]; };
  const guardar = (l) => { if (l.join() === base.join()) delete j.orden_menu; else j.orden_menu = l; ctx.alCambiar(); pintar(); };
  const mover = (i, d) => { const l = actual(); const o = i + d; if (o < 0 || o >= l.length) return; [l[i], l[o]] = [l[o], l[i]]; guardar(l); };
  function pintar() {
    const l = actual();
    caja.replaceChildren(
      h('ol', { class: 'orden-menu-lista' }, l.map((k, i) => h('li', { class: 'orden-menu-fila', 'data-seccion': k },
        h('span', { class: 'orden-menu-nombre' }, MENU.find(([x]) => x === k)[1]),
        h('button', { type: 'button', class: 'btn btn-suave', disabled: i === 0, 'aria-label': `Subir ${MENU.find(([x]) => x === k)[1]}`, 'data-subir': k, onclick: () => mover(i, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn btn-suave', disabled: i === l.length - 1, 'aria-label': `Bajar ${MENU.find(([x]) => x === k)[1]}`, 'data-bajar': k, onclick: () => mover(i, 1) }, '↓')))),
      h('button', { type: 'button', class: 'btn btn-suave', disabled: l.join() === base.join(), 'data-accion': 'orden-menu-original', onclick: () => guardar(base) }, 'Volver al orden de siempre'));
  }
  pintar();
  return caja;
}

function nombresMesa(j, ctx) {
  const n = j.nombres || (j.nombres = {});
  return h('div', { class: 'nombres-mesa' }, NOMBRES.map(([k, defecto]) => {
    const i = h('input', { class: 'entrada', type: 'text', maxlength: '30', placeholder: defecto, 'aria-label': `Nombre para «${defecto}»`, 'data-nombre': k }); i.value = n[k] || '';
    i.addEventListener('input', () => { if (i.value.trim()) n[k] = i.value.trim(); else delete n[k]; ctx.alCambiar(); });
    return h('label', { class: 'mini-campo' }, defecto, i);
  }));
}

/** Calcula los cambios de nombre hechos en las tablas (para actualizar todo lo que los cita al guardar). */
export function renombresPendientes(b) {
  const sacar = (lista) => Object.fromEntries((lista || []).filter((x) => x._origen && x._origen !== x.nombre).map((x) => [x._origen, x.nombre]));
  return { stats: sacar(b.juego?.estadisticas), recursos: sacar(b.juego?.recursos), etiquetas: sacar(b.juego?.etiquetas) };
}
export function limpiarOrigenes(b) {
  for (const lista of [b.juego?.estadisticas, b.juego?.recursos, b.juego?.etiquetas]) for (const x of lista || []) delete x._origen;
}

// ── Tablas por tramos para las fórmulas ──
const numONulo = (texto) => { const t = String(texto).trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : undefined; };
const verNum = (n) => (n == null ? '' : String(n).replace('.', ','));
/** Igual que mesa/formulas.py → buscar_en_tabla. */
export function buscarEnTabla(tabla, valor) {
  for (const f of tabla.filas || []) if ((f.desde == null || valor >= f.desde) && (f.hasta == null || valor <= f.hasta)) return f.valor;
  return tabla.defecto ?? 0;
}

function tablasFormulas(tablas, ctx) {
  const caja = h('div', { class: 'tablas-formulas' });
  const pintar = () => {
    const tarjetas = tablas.map((t, i) => {
      t.filas ||= [];
      const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '40', 'aria-label': 'Nombre de la tabla', 'data-tabla-nombre': i }); nombre.value = t.nombre || '';
      nombre.addEventListener('input', () => {
        t.nombre = nombre.value;
        const malo = !nombre.value.trim() || /[;()[\]]/.test(nombre.value) || tablas.filter((x) => (x.nombre || '').trim().toLowerCase() === nombre.value.trim().toLowerCase()).length > 1;
        nombre.classList.toggle('invalido', malo); uso.textContent = `En una fórmula: tabla(${nombre.value.trim() || '…'}; 1d20)`; ctx.alCambiar();
      });
      const desc = h('input', { class: 'entrada', type: 'text', maxlength: '120', placeholder: 'Para qué sirve (opcional)', 'aria-label': 'Descripción' }); desc.value = t.descripcion || '';
      desc.addEventListener('input', () => { if (desc.value) t.descripcion = desc.value; else delete t.descripcion; ctx.alCambiar(); });
      const uso = h('code', { class: 'tabla-uso' }, `En una fórmula: tabla(${(t.nombre || '…').trim()}; 1d20)`);
      const celda = (fila, k, etiqueta, vacio) => {
        const e = h('input', { class: 'entrada entrada-num', type: 'text', inputmode: 'decimal', placeholder: vacio, 'aria-label': etiqueta, 'data-col': k }); e.value = verNum(fila[k]);
        e.addEventListener('input', () => {
          const n = numONulo(e.value);
          const ok = n !== undefined && !(k === 'valor' && n === null);
          e.classList.toggle('invalido', !ok);
          if (ok) { fila[k] = n; probar(); ctx.alCambiar(); }
        });
        return h('label', { class: 'mini-campo' }, etiqueta, e);
      };
      const filas = h('div', { class: 'tabla-editable' });
      const pintarFilas = () => filas.replaceChildren(...t.filas.map((f, k) => h('div', { class: 'fila-tabla', 'data-fila': k },
        celda(f, 'desde', 'Desde', 'sin límite'), celda(f, 'hasta', 'Hasta', 'sin límite'), h('span', { class: 'tenue' }, '→'), celda(f, 'valor', 'Resultado', ''),
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar fila', onclick: () => { t.filas.splice(k, 1); ctx.alCambiar(); pintarFilas(); probar(); } }, '✕'))),
      h('button', { type: 'button', class: 'btn', 'data-accion': 'nueva-fila', onclick: () => {
        const ult = t.filas[t.filas.length - 1];
        const desde = ult?.hasta != null ? ult.hasta + 1 : (ult ? null : 1);
        t.filas.push({ desde, hasta: desde, valor: 1 }); ctx.alCambiar(); pintarFilas(); probar();
      } }, '+ Añadir tramo'));
      const defecto = h('input', { class: 'entrada entrada-num', type: 'text', inputmode: 'decimal', 'aria-label': 'Si no cae en ningún tramo', 'data-col': 'defecto' }); defecto.value = verNum(t.defecto ?? 0);
      defecto.addEventListener('input', () => { const n = numONulo(defecto.value); defecto.classList.toggle('invalido', n == null); if (n != null) { t.defecto = n; probar(); ctx.alCambiar(); } });
      const prueba = h('input', { class: 'entrada entrada-num', type: 'text', inputmode: 'decimal', value: '10', 'aria-label': 'Probar con este valor', 'data-accion': 'probar-tabla' });
      const resultado = h('strong', { class: 'tabla-resultado' });
      const probar = () => { const n = numONulo(prueba.value); resultado.textContent = n == null ? '—' : verNum(buscarEnTabla(t, n)); };
      prueba.addEventListener('input', probar);
      pintarFilas(); probar();
      return h('section', { class: 'bloque tabla-formula', 'data-tabla': i },
        h('div', { class: 'fila-inline' }, nombre, h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar la tabla', onclick: async () => {
          if (!(await confirmar('Quitar tabla', `¿Quitar la tabla «${t.nombre}»? Las fórmulas que la usen darán error hasta que lo corrijas.`, { si: 'Quitar', peligro: true }))) return;
          tablas.splice(i, 1); ctx.alCambiar(); pintar();
        } }, '✕')),
        desc, uso,
        h('p', { class: 'ayuda' }, 'Cada tramo va de «Desde» a «Hasta» (ambos incluidos; vacío = sin límite). Se usa el primer tramo que encaje.'),
        filas,
        h('div', { class: 'dos-columnas' },
          h('label', { class: 'mini-campo' }, 'Si no cae en ningún tramo', defecto),
          h('div', { class: 'mini-campo' }, 'Probar', h('div', { class: 'fila-inline' }, prueba, h('span', { class: 'tenue' }, '→'), resultado))));
    });
    caja.replaceChildren(...(tarjetas.length ? tarjetas : [h('p', { class: 'ayuda' }, 'No hay tablas todavía.')]),
      h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'nueva-tabla', onclick: () => {
        let n = 'Tabla nueva', k = 2; while (tablas.some((x) => x.nombre === n)) n = `Tabla nueva ${k++}`;
        tablas.push({ nombre: n, defecto: 0, filas: [{ desde: null, hasta: 1, valor: 0 }, { desde: 2, hasta: 19, valor: 1 }, { desde: 20, hasta: null, valor: 2 }] });
        ctx.alCambiar(); pintar();
      } }, '+ Nueva tabla'),
      h('section', { class: 'bloque' }, h('h3', null, 'Cómo se usan'),
        h('p', { class: 'ayuda' }, 'En cualquier fórmula (habilidades, efectos, tiradas): tabla(Nombre; valor). Ejemplo de daño con críticos: ([a.Fuerza] + [h.Potencia]) * tabla(Multiplicador; 1d20). Otras funciones: max(0; …) para que nunca baje de 0, min(…; …), redondear(…), si(condición; sí; no).')));
  };
  pintar();
  return caja;
}

// ── Etiquetas y tabla de ventajas ──
const COLORES = ['#d9531e', '#2a6fb0', '#3f8f3a', '#c9a227', '#7a4fb5', '#8d9aac', '#c4533f', '#6fb7a8'];
function etiquetasYVentajas(j, ctx) {
  const caja = h('div', { class: 'etiquetas-ventajas' });
  const mult = (a, d) => j.ventajas.find((f) => f.atacante === a && f.defensor === d)?.multiplicador;
  const fijar = (a, d, m) => {
    j.ventajas = j.ventajas.filter((f) => !(f.atacante === a && f.defensor === d));
    if (m != null && m !== 1) j.ventajas.push({ atacante: a, defensor: d, multiplicador: m });
    ctx.alCambiar();
  };
  const pintar = () => {
    const lista = j.etiquetas.map((e, i) => {
      e._origen ??= e.nombre;
      const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '30', 'aria-label': 'Nombre de la etiqueta', 'data-etiqueta-nombre': i }); nombre.value = e.nombre;
      nombre.addEventListener('change', () => {
        const n = nombre.value.trim();
        if (!n || /[;()[\]]/.test(n) || j.etiquetas.some((x) => x !== e && x.nombre.toLowerCase() === n.toLowerCase())) { toast('Nombre vacío, repetido o con ; ( ) [ ].', 'error'); nombre.value = e.nombre; return; }
        for (const f of j.ventajas) { if (f.atacante === e.nombre) f.atacante = n; if (f.defensor === e.nombre) f.defensor = n; }
        e.nombre = n; ctx.alCambiar(); pintar();
      });
      const color = h('input', { type: 'color', 'aria-label': `Color de ${e.nombre}`, value: e.color || '#8d9aac' });
      color.addEventListener('input', () => { e.color = color.value; ctx.alCambiar(); pintarTabla(); });
      const desc = h('input', { class: 'entrada', type: 'text', maxlength: '120', placeholder: 'Descripción (opcional)', 'aria-label': 'Descripción' }); desc.value = e.descripcion || '';
      desc.addEventListener('input', () => { if (desc.value) e.descripcion = desc.value; else delete e.descripcion; ctx.alCambiar(); });
      return h('div', { class: 'fila-tabla' }, color, nombre, desc,
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': `Quitar ${e.nombre}`, onclick: async () => {
          if (!(await confirmar('Quitar etiqueta', `¿Quitar «${e.nombre}»? Se borran sus ventajas, y lo que la use (habilidades, NPC…) quedará con errores hasta que lo corrijas.`, { si: 'Quitar', peligro: true }))) return;
          j.ventajas = j.ventajas.filter((f) => f.atacante !== e.nombre && f.defensor !== e.nombre);
          j.etiquetas.splice(i, 1); ctx.alCambiar(); pintar();
        } }, '✕'));
    });
    const tablaCaja = h('div', { class: 'matriz-cont' });
    function pintarTabla() {
      const ns = j.etiquetas.map((e) => e.nombre);
      if (ns.length < 1) { tablaCaja.replaceChildren(h('p', { class: 'ayuda' }, 'Crea al menos una etiqueta para rellenar la tabla.')); return; }
      const chip = (e) => h('span', { class: 'matriz-etq', style: { borderColor: e.color || 'var(--linea)' } }, e.nombre);
      const celda = (a, d) => {
        const m = mult(a, d);
        const inp = h('input', { class: `matriz-celda${m == null ? '' : m > 1 ? ' fuerte' : m < 1 ? ' debil' : ''}`, type: 'text', inputmode: 'decimal', placeholder: '1',
          'aria-label': `${a} contra ${d}`, 'data-atacante': a, 'data-defensor': d, title: `${a} contra ${d}` });
        inp.value = m == null ? '' : String(m).replace('.', ',');
        inp.addEventListener('change', () => {
          const t = inp.value.trim().replace(',', '.');
          const n = t === '' ? null : Number(t);
          if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) { toast('Un número entre 0 y 100 (vacío = ×1).', 'error'); inp.value = m == null ? '' : String(m).replace('.', ','); return; }
          fijar(a, d, n); pintarTabla();
        });
        return h('td', null, inp);
      };
      tablaCaja.replaceChildren(h('table', { class: 'matriz' },
        h('thead', null, h('tr', null, h('th', { class: 'matriz-esquina' }, h('span', null, 'Ataca ↓'), h('span', null, 'Recibe →')), ...j.etiquetas.map((e) => h('th', null, chip(e))))),
        h('tbody', null, ...j.etiquetas.map((a) => h('tr', null, h('th', null, chip(a)), ...ns.map((d) => celda(a.nombre, d)))))));
    }
    pintarTabla();
    caja.replaceChildren(
      h('section', { class: 'bloque' }, h('h3', null, 'Etiquetas'),
        h('p', { class: 'ayuda' }, 'Se ponen en habilidades, razas/clases (opciones), NPC y estados. Un personaje tiene las de sus opciones y las de sus estados activos.'),
        h('div', { class: 'tabla-editable' }, ...(lista.length ? lista : [h('p', { class: 'tenue pequeno' }, 'Todavía no hay etiquetas.')]),
          h('button', { type: 'button', class: 'btn', 'data-accion': 'nueva-etiqueta', onclick: () => {
            let n = 'Etiqueta nueva', k = 2; while (j.etiquetas.some((x) => x.nombre === n)) n = `Etiqueta nueva ${k++}`;
            j.etiquetas.push({ nombre: n, color: COLORES[j.etiquetas.length % COLORES.length], _origen: null }); ctx.alCambiar(); pintar();
          } }, '+ Añadir etiqueta'))),
      h('section', { class: 'bloque' }, h('h3', null, 'Tabla de ventajas'),
        h('p', { class: 'ayuda' }, 'Cada fila es la etiqueta del ataque (de la habilidad); cada columna, la del que lo recibe. Escribe el multiplicador: 2 = el doble, 0,5 = la mitad, 0 = no le afecta. Vacío = ×1. Si el objetivo tiene varias etiquetas, se multiplican.'),
        tablaCaja,
        h('p', { class: 'ayuda' }, 'Para usarla, la fórmula de la habilidad debe multiplicar por ventaja(). Ejemplo: ([a.Fuerza] + 1d6) * ventaja().')));
  };
  pintar();
  return caja;
}

export function construirReglas(p, ctx) {
  const b = p.borrador;
  b.servidor ||= {}; b.permisos ||= {}; b.juego ||= {}; b.seguridad ||= {};
  b.visibilidad ||= {}; b.visibilidad.jugadores ||= {}; b.visibilidad.npc ||= {};
  b.juego.moneda ||= { activa: true, nombre: 'Monedas', simbolo: '🪙', inicial: 0, denominaciones: [] };
  b.juego.niebla ||= { activa: false, vision_base: 6, compartir: true };
  b.juego.tablas ||= [];
  b.juego.etiquetas ||= [];
  b.juego.efectos ||= [];
  b.juego.ventajas ||= [];
  b.juego.movimiento ||= { limitado: false, casillas: 6, estadistica: '' };
  b.juego.inventario_grupo_inicial ||= { inventario: [], dinero: 0 };
  b.juego.chat ||= { modo: 'libre', espera_chat: 0, espera_tiradas: 0 };
  b.juego.niveles ||= { activo: false, modo: 'manual', reparto: 'todos', experiencia: [], umbrales: [], maximo: 20, por_nivel: { puntos: 0, recursos: {} }, aprende: [] };
  b.juego.niveles.por_nivel ||= { puntos: 0, recursos: {} };
  b.juego.niveles.por_nivel.recursos ||= {};
  b.juego.niveles.experiencia ||= [];
  b.juego.niveles.modo ||= 'manual';
  b.juego.niveles.reparto ||= 'todos';
  b.juego.niveles.umbrales ||= [];
  b.juego.niveles.aprende ||= [];
  b.juego.ciclo ||= { activo: false, inicial: 0, periodos: [{ nombre: 'Día', color: '', opacidad: 0 }, { nombre: 'Noche', color: '#0a1233', opacidad: 0.5 }] };
  b.juego.clima ||= { activo: false, inicial: 0, tipos: [{ nombre: 'Despejado', color: '', opacidad: 0 }, { nombre: 'Lluvia', color: '#2a4a6b', opacidad: 0.25 }, { nombre: 'Niebla', color: '#cfd6dc', opacidad: 0.35 }, { nombre: 'Tormenta', color: '#10182b', opacidad: 0.45 }] };
  const contenido = h('div', { class: 'reglas-contenido' });
  const nav = h('nav', { class: 'reglas-nav', 'aria-label': 'Apartados de las reglas' });
  const c = (def, obj) => construirCampo(def, obj, ctx);
  const ctxLocal = { ...ctx, refrescarSeccion: () => mostrar(p.seccion) };

  const vistas = {
    general: () => [
      grupoCampos('Tu campaña',
        c({ t: 'texto', k: 'nombre', etiqueta: 'Nombre de la campaña', obligatorio: true, ayuda: 'Es el nombre que verán los jugadores al conectarse.' }, b.servidor),
        c({ t: 'ref', k: 'mapa_inicial', etiqueta: 'Mapa donde empieza la partida', cat: 'mapas', ayuda: 'Si no eliges ninguno, empieza en el primero.' }, b.juego)),
      grupoCampos('Contraseñas',
        campoContrasena('Contraseña del servidor', 'Si la pones, solo entra quien la sepa. Sin contraseña, entra cualquiera que tenga la dirección.', b.servidor, 'password_servidor', ctxLocal),
        campoContrasena('Contraseña de Game Master', 'Con esta contraseña se entra como GM. Si la dejas vacía, cualquiera que marque «Entrar como Game Master» lo será.', b.servidor, 'password_gm', ctxLocal)),
      grupoCampos('Conexión (avanzado)',
        c({ t: 'seleccion', k: 'host', etiqueta: 'Quién puede conectarse', opciones: [['0.0.0.0', 'Cualquiera de mi red (y de internet si abro el puerto)'], ['localhost', 'Solo este equipo']], ayuda: 'Para jugar con otras personas elige la primera.' }, b.servidor),
        c({ t: 'numero', k: 'puerto', etiqueta: 'Puerto de la partida', min: 1, max: 65535, defecto: 8765, ayuda: 'Es el único puerto que hay que abrir en el router.' }, b.servidor)),
    ],
    estadisticas: () => [
      grupoCampos('Estadísticas', h('p', { class: 'ayuda' }, 'Los números que definen a un personaje: Fuerza, Agilidad… Todos los personajes y NPC tienen las mismas. Si cambias un nombre, se actualiza en todos los sitios donde se usa al guardar.'),
        c({ t: 'interruptor', k: 'categorias_estadisticas', defecto: false, etiqueta: 'Agrupar las estadísticas por categorías', ayuda: 'Por ejemplo «Combate» y «Social»: cada estadística dice a cuál pertenece y la ficha y la creación de personaje las muestran en bloques separados. Apagado: una sola lista.' },
          { get categorias_estadisticas() { return !!b.juego.categorias_estadisticas; }, set categorias_estadisticas(v) { if (v) b.juego.categorias_estadisticas = true; else delete b.juego.categorias_estadisticas; ctxLocal.refrescarSeccion(); } }),
        tablaEstadisticas(b, ctxLocal)),
      grupoCampos('Recursos', h('p', { class: 'ayuda' }, 'Lo que se gasta y se recupera: vida, magia, energía…'), tablaRecursos(b, ctxLocal),
        (() => {
          const vida = h('select', { class: 'entrada', 'data-campo': 'recurso_vida' }, recursosJuegoDe(b).map((n) => h('option', { value: n }, n)));
          vida.value = b.juego.recurso_vida || ''; vida.addEventListener('change', () => { b.juego.recurso_vida = vida.value; ctx.alCambiar(); });
          return h('div', { class: 'dos-columnas' },
            h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Recurso de vida'), vida, h('p', { class: 'ayuda' }, 'Al llegar a 0, el personaje queda derrotado.')));
        })()),
    ],
    personajes: () => [
      grupoCampos('Creación',
        c({ t: 'interruptor', k: 'crear_personajes', etiqueta: 'Los jugadores pueden crear sus personajes', ayuda: 'Si lo desactivas, solo el GM prepara los personajes.' }, b.permisos),
        c({ t: 'interruptor', k: 'sin_ficha', defecto: false, etiqueta: 'Los jugadores pueden entrar sin ficha',
          ayuda: 'Apagado (lo normal): cada jugador necesita un personaje para entrar a la mesa. Encendido: pueden entrar sin ninguno y el GM, en la partida (clic derecho en un token → Editar), les asigna personajes con «Pertenece a» y NPC con «Controlado por». Los personajes se pueden preparar antes en «Jugadores y fichas» o crearlos el GM en la partida.' }, b.permisos),
        c({ t: 'numero', k: 'max_personajes_por_jugador', etiqueta: 'Personajes por jugador (máximo)', min: 1, max: 50, defecto: 3 }, b.permisos),
        c({ t: 'interruptor', k: 'transformarse', etiqueta: 'Los jugadores pueden transformar a sus personajes', ayuda: 'En los grupos que se pueden cambiar en partida (formas o evolución). Apagado: solo el GM los transforma.' }, b.permisos),
        c({ t: 'interruptor', k: 'usar_grupos', defecto: true, etiqueta: 'Usar razas, clases y otros grupos de elección', ayuda: 'Apágalo si tu mesa no los usa (o lleva su propio sistema): al crear un personaje solo se pide nombre, imagen e historia. Los grupos que ya tengas no se borran.' }, b.juego)),
      grupoCampos('Puntos de estadística',
        c({ t: 'numero', k: 'puntos_a_repartir', etiqueta: 'Puntos a repartir al crear un personaje', min: 0, max: 10000, ayuda: 'Cada estadística empieza en su valor inicial; el jugador reparte estos puntos entre ellas. 0 = no hay reparto.' }, b.juego),
        c({ t: 'interruptor', k: 'editar_stats_jugador', etiqueta: 'El jugador reparte los puntos que gane después', ayuda: 'Activado: al subir de nivel, cada jugador gasta sus puntos. Desactivado: solo el GM los reparte.' }, b.permisos)),
      grupoCampos('Personalidad',
        c({ t: 'interruptor', k: 'rasgos_personalidad', etiqueta: 'Los jugadores editan los rasgos de personalidad de su personaje', ayuda: 'Rasgos libres como «Maldito» o «Maniático». Desactivado: solo los pone el GM.', defecto: false }, b.permisos)),
      grupoCampos('Anotaciones propias de los jugadores',
        c({ t: 'interruptor', k: 'habilidades_propias', etiqueta: 'Los jugadores anotan habilidades propias', ayuda: 'Son solo texto (nombre y descripción): no tienen efecto automático, el GM decide qué significan. Las habilidades reales siguen saliendo del Editor.', defecto: false }, b.permisos),
        c({ t: 'interruptor', k: 'objetos_propios', etiqueta: 'Los jugadores anotan objetos propios', ayuda: 'Solo texto, sin efecto automático ni intercambio. Los objetos reales los crea el Editor o el GM.', defecto: false }, b.permisos)),
    ],
    turnos: () => [
      grupoCampos('Orden de los turnos',
        c({ t: 'seleccion', k: 'iniciativa', etiqueta: '¿Cómo se decide el orden?', opciones: [['estadistica', '🎲 Cada uno tira su iniciativa (d20 + estadística)'], ['valor', '📊 Por la estadística más alta, sin dados'], ['manual', '✋ Lo decide el GM a mano (ventanita con «Listo»; los demás esperan)'], ['preguntar', '❓ El GM elige al iniciar cada combate']],
          ayuda: 'Con «tira», al iniciar el combate cada jugador tira la de su personaje (los NPC tiran solos) y el GM puede empezar sin esperar. En todos los casos el GM puede cambiar el orden en plena partida con las flechas de la barra de turnos.' }, { ...b.juego, get iniciativa() { return b.juego.iniciativa; }, set iniciativa(v) { b.juego.iniciativa = v; ctxLocal.refrescarSeccion(); } }),
        b.juego.iniciativa === 'preguntar' ? c({ t: 'casillas', k: 'iniciativa_opciones', etiqueta: 'Opciones que se ofrecen al GM', opciones: [['estadistica', '🎲 Cada uno tira'], ['valor', '📊 Estadística más alta'], ['manual', '✋ A mano']],
          ayuda: 'Si solo marcas una, no se pregunta. Sin ninguna marcada, se ofrecen las tres.' }, b.juego) : null,
        b.juego.iniciativa !== 'manual' ? selectorEstadistica(b, b.juego, 'estadistica_iniciativa', 'Estadística que decide el orden',
          b.juego.iniciativa === 'valor' ? 'Va primero quien la tenga más alta (con sus bonos).' : 'Cada uno tira d20 + esta estadística (con sus bonos). Una raza o clase puede usar otra: se elige en su ficha («Iniciativa con»).', ctx) : null),
      grupoCampos('Fin del combate',
        c({ t: 'seleccion', k: 'fin_combate', etiqueta: '¿Cómo termina el combate?', opciones: [['manual', '✋ Lo termina el GM a mano'], ['automatico', '🏁 Solo, cuando no queda ningún enemigo en pie']],
          ayuda: 'Automático: el combate acaba al caer (o quitar) al último NPC enemigo. Los aliados y neutrales no cuentan, y un combate que empezó sin enemigos no termina por esto. El GM siempre puede terminarlo a mano.' }, b.juego)),
      (() => {
        b.juego.medida ||= { unidad: 'casillas', tamano: 1 };
        const me = b.juego.medida;
        const unidad = { ...me, get unidad() { return me.unidad || 'casillas'; }, set unidad(v) { me.unidad = v; me.tamano = v === 'metros' ? 1.5 : v === 'pies' ? 5 : 1; ctxLocal.refrescarSeccion(); } };
        return grupoCampos('Medida de las casillas',
          c({ t: 'seleccion', k: 'unidad', etiqueta: 'La regla y los alcances se muestran en', opciones: [['casillas', 'Casillas'], ['metros', 'Metros'], ['pies', 'Pies']],
            ayuda: 'Solo cambia cómo se muestran las distancias: todo se sigue contando en casillas por debajo.' }, unidad),
          me.unidad && me.unidad !== 'casillas' ? c({ t: 'numero', k: 'tamano', decimal: true, min: 0.01, max: 10000, defecto: me.unidad === 'metros' ? 1.5 : 5, etiqueta: 'Cada casilla mide', sufijo: me.unidad === 'metros' ? 'm' : 'pies' }, me) : null);
      })(),
      grupoCampos('Fuera de combate',
        c({ t: 'seleccion', k: 'habilidades_fuera_de_combate', etiqueta: '¿Se pueden usar habilidades fuera de combate?', defecto: 'todas',
          opciones: [['todas', 'Sí, todas'], ['sin_dano', 'Solo las que no hacen daño (curar, mejorar, efectos…)'], ['ninguna', 'No: solo durante un combate']],
          ayuda: 'Golpes, hechizos y demás habilidades. El GM siempre puede usarlas.' }, b.juego)),
      (() => {
        const mv = b.juego.movimiento;
        const limitado = { get limitado() { return !!mv.limitado; }, set limitado(v) { mv.limitado = v; ctxLocal.refrescarSeccion(); } };
        const modo = {
          get modo() { return mv.estadistica ? 'estadistica' : 'fijo'; },
          set modo(v) { mv.estadistica = v === 'estadistica' ? ((b.juego.estadisticas || [])[0]?.nombre || '') : ''; ctxLocal.refrescarSeccion(); },
        };
        return grupoCampos('Movimiento en combate',
          c({ t: 'interruptor', k: 'limitado', etiqueta: 'Limitar las casillas que se andan en cada turno', ayuda: 'Fuera de combate se mueve libremente. El GM nunca tiene límite.' }, limitado),
          mv.limitado ? c({ t: 'seleccion', k: 'modo', etiqueta: '¿Cuántas casillas puede andar?', opciones: [['fijo', '🔢 Las mismas para todos'], ['estadistica', '📊 Según una estadística']],
            ayuda: 'Se cuentan andando (sin diagonales) y rodeando muros. Se puede repartir: andar 2, atacar y andar 4 más.' }, modo) : null,
          mv.limitado && !mv.estadistica ? c({ t: 'numero', k: 'casillas', etiqueta: 'Casillas por turno', sufijo: 'casillas', min: 0, max: 200, defecto: 6 }, mv) : null,
          mv.limitado && mv.estadistica ? selectorEstadistica(b, mv, 'estadistica', 'Estadística que da las casillas',
            'Cada uno anda tantas casillas como el valor de esta estadística (con sus bonos de raza, rasgos, estados…). Por ejemplo «Velocidad».', ctx) : null);
      })(),
    ],
    niveles: () => [nivelesYExperiencia(b, ctx, c)],
    mesa: () => [
      (() => {
        const eq = (b.juego.equipamiento ||= { activo: false, maximo: 0, huecos: [] });
        const proxy = { get activo() { return !!eq.activo; }, set activo(v) { eq.activo = v; ctxLocal.refrescarSeccion(); } };
        const huecos = h('input', { class: 'entrada', type: 'text', 'data-campo': 'huecos', placeholder: 'Cabeza, Pecho, Manos, Pies' });
        huecos.value = (eq.huecos || []).join(', ');
        huecos.addEventListener('change', () => { eq.huecos = [...new Set(huecos.value.split(',').map((x) => x.trim().slice(0, 30)).filter(Boolean))]; ctx.alCambiar(); });
        return grupoCampos('Equipamiento',
          c({ t: 'interruptor', k: 'activo', etiqueta: 'Los objetos se equipan', ayuda: 'Apagado: los objetos dan sus efectos solo por llevarlos. Encendido: los marcados como «Se puede equipar» solo cuentan mientras están equipados (botón «Equipar» del inventario).' }, proxy),
          eq.activo ? c({ t: 'numero', k: 'maximo', etiqueta: 'Objetos equipados a la vez (máximo)', min: 0, max: 100, defecto: 0, ayuda: '0 = sin límite.' }, eq) : null,
          eq.activo ? h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Huecos (opcional)'), huecos,
            h('p', { class: 'ayuda' }, 'Separados por comas. Cada objeto puede ocupar uno, y solo se lleva un objeto por hueco: al equipar otro, el anterior se quita solo.')) : null);
      })(),
      grupoCampos('Inventario de grupo',
        c({ t: 'interruptor', k: 'inventario_grupo', defecto: true, etiqueta: 'Hay inventarios de grupo', ayuda: 'Objetos y dinero que comparte el grupo (ventana «Grupo» del cliente): un inventario común para todos y, en la partida, los que cree el GM. Si lo desactivas, la sección «Grupo» desaparece del cliente (lo ya guardado vuelve si lo reactivas).' }, b.juego),
        c({ t: 'inventario', k: 'inventario', etiqueta: 'Empieza con estos objetos', ayuda: 'Lo que ya hay en el inventario común al empezar la campaña (por ejemplo, lo que el grupo ha recogido antes de la primera sesión).' }, b.juego.inventario_grupo_inicial),
        c({ t: 'numero', k: 'dinero', etiqueta: 'Y con este dinero', min: 0, max: 1000000000, defecto: 0, ayuda: 'En la unidad más pequeña de la moneda (Reglas → Dinero y comercio).' }, b.juego.inventario_grupo_inicial)),
      grupoCampos('Diario',
        c({ t: 'interruptor', k: 'diario_reglas', defecto: true, etiqueta: 'Incluir «Reglas de la mesa» en el diario', ayuda: 'Una página automática que explica a los jugadores estas reglas, las razas, clases, estadísticas y estados. Las demás páginas se escriben en la categoría «Diario».' }, b.juego)),
      grupoCampos('Combate',
        c({ t: 'interruptor', k: 'acciones_solo_en_su_turno', etiqueta: 'En combate, solo actúa quien tiene el turno', ayuda: 'Desactivado: cualquiera puede actuar en cualquier momento.' }, b.permisos),
        c({ t: 'interruptor', k: 'mover_tokens_ajenos', etiqueta: 'Los jugadores pueden mover fichas de otros', ayuda: 'Normalmente cada jugador mueve solo su personaje.' }, b.permisos),
        c({ t: 'interruptor', k: 'npc_para_jugadores', etiqueta: 'El GM puede dar NPC a los jugadores', ayuda: 'En la partida, al editar un NPC, el GM elige «Controlado por»: ese jugador lo mueve, actúa con él en su turno y ve su ficha y lo que ve. Sirve para compañeros, mascotas o invocaciones. Apagado: solo el GM maneja los NPC.' }, b.permisos),
        c({ t: 'interruptor', k: 'desplegar_en_casilla', defecto: true, etiqueta: 'Los jugadores eligen dónde aparece su personaje', ayuda: 'Clic derecho en una casilla → «Desplegar aquí». Solo fuera de combate y, con niebla, donde ya ven. Si lo apagas, aparecen en el punto de inicio del mapa.' }, b.permisos),
        c({ t: 'opciones', k: 'atacar', etiqueta: '¿A quién pueden atacar los jugadores?', opciones: [['enemigos', 'Solo a enemigos'], ['enemigos_y_neutros', 'A enemigos y neutrales'], ['todos', 'A todos (incluso aliados y otros jugadores)']], ayuda: 'Cada NPC es aliado, neutral o enemigo (se elige en su ficha). El GM no tiene límite. Una habilidad «A un rival» nunca sirve sobre aliados; para atacar aliados hace falta una habilidad «A cualquiera». Para limitar a un jugador concreto, usa «Jugadores y fichas».' }, b.permisos)),
      grupoCampos('Mapa',
        c({ t: 'interruptor', k: 'ping', etiqueta: 'Los jugadores pueden señalar casillas (Alt + clic)', ayuda: 'Hace aparecer un aro en esa casilla para todos, un instante. El GM siempre puede.', defecto: true }, b.permisos),
        c({ t: 'interruptor', k: 'regla_visible', etiqueta: 'Los demás ven la regla de un jugador mientras mide', ayuda: 'La línea desaparece al terminar. La regla del GM siempre se ve.', defecto: true }, b.permisos),
        c({ t: 'interruptor', k: 'dibujar', etiqueta: 'Los jugadores pueden dibujar en el mapa', ayuda: 'Son trazos temporales: cada sala tiene los suyos y no se guardan al cerrar el servidor. El GM puede borrarlos o bloquear el dibujo en plena partida.', defecto: true }, b.permisos)),
      grupoCampos('Salas',
        h('p', { class: 'ayuda' }, 'Cada mapa es una sala con sus propios tokens, combate, niebla y dibujos, y varias pueden estar en uso a la vez (un grupo en la taberna y otro en el bosque). El GM pasa de una a otra desde el panel «Salas» sin mover a nadie, y lleva un token a otra sala con clic derecho → «Llevar a otra sala». Lo que dice un personaje y lo que pasa en el combate solo lo leen quienes están en esa sala; lo que se escribe como usuario lo lee toda la mesa.'),
        c({ t: 'opciones', k: 'cambiar_sala', etiqueta: '¿Cómo se cambia de sala?', opciones: [['gm', 'El GM lleva a los jugadores'], ['todos', 'Los jugadores van solos a las salas abiertas']],
          ayuda: 'Con «van solos», cada jugador elige una sala en el panel «Salas» y se va con su personaje (fuera de combate). El GM puede cerrar una sala (🔒) para que solo entre quien él lleve.' }, b.permisos)),
      grupoCampos('Sonidos',
        c({ t: 'interruptor', k: 'sonidos_personaje', etiqueta: 'Los jugadores pueden lanzar los sonidos de su personaje', ayuda: 'Cada personaje tiene sus efectos asociados (se eligen en su ficha). El GM siempre puede lanzarlos.' }, b.permisos)),
      grupoCampos('Música y sonidos',
        c({ t: 'interruptor', k: 'sonidos_activos', defecto: true, etiqueta: 'La campaña usa música y sonidos', ayuda: 'Apagado: el panel de música ni aparece en el cliente.' }, b.juego),
        c({ t: 'opciones', k: 'musica', etiqueta: '¿Quién controla la música?', opciones: [['gm', 'Solo el GM'], ['todos', 'Todos los jugadores']] }, b.permisos)),
      grupoCampos('Chat',
        c({ t: 'opciones', k: 'modo', etiqueta: '¿Cómo es el chat?', opciones: [['libre', 'Todos escriben'], ['registro', 'Solo registro']],
          ayuda: '«Solo registro»: los jugadores no escriben mensajes; se ve lo que pasa en la partida (ataques, tiradas, avisos). Las tiradas siguen funcionando.' }, b.juego.chat),
        c({ t: 'numero', k: 'espera_chat', etiqueta: 'Modo lento del chat', sufijo: 'segundos entre mensajes', min: 0, max: 3600, defecto: 0, ayuda: '0 = sin espera. El GM nunca espera.' }, b.juego.chat),
        c({ t: 'numero', k: 'espera_tiradas', etiqueta: 'Modo lento de las tiradas', sufijo: 'segundos entre tiradas', min: 0, max: 3600, defecto: 0, ayuda: '0 = sin espera. Cuenta los dados, las tiradas de estadística y las tiradas guardadas.' }, b.juego.chat),
        c({ t: 'interruptor', k: 'detalle_tiradas', etiqueta: 'Los jugadores ven el detalle de las tiradas', defecto: false, ayuda: 'Apagado: en el registro los jugadores ven solo qué se tiró y el resultado («🎲 Ana tiró Fuerza: 15»). Encendido: también cada dado y cada suma. El GM siempre ve el detalle.' }, b.juego.chat),
        c({ t: 'opciones', k: 'romper_casillas', etiqueta: '¿Quién puede romper tiles y objetos?', opciones: [['gm', 'Solo el GM'], ['todos', 'Los jugadores también']], ayuda: 'Barricadas, puertas y otros tiles marcados como «Se puede romper», y los objetos del mapa con «Se rompe con N golpes». Cada ataque que los alcanza (también las habilidades de área, o apuntando a su casilla) cuenta un golpe; también se puede «Golpear» con clic derecho estando al lado.' }, b.permisos),
        c({ t: 'interruptor', k: 'salas_chat', etiqueta: 'El GM puede crear salas de chat privadas', ayuda: 'Salas con solo algunos jugadores (por ejemplo, un grupo que se separa). El GM ve todas.', defecto: true }, b.juego),
        c({ t: 'numero', k: 'max_mensajes_chat', etiqueta: 'Mensajes de chat que se conservan', min: 10, max: 5000, defecto: 100 }, b.juego)),
      grupoCampos('Tiradas',
        c({ t: 'interruptor', k: 'dados_personalizados', etiqueta: 'Los jugadores pueden escribir sus propias tiradas', ayuda: 'Desactivado: solo pueden usar los dados de la lista de abajo (el GM siempre puede todo).', defecto: true }, b.permisos),
        (() => {
          const ent = h('input', { type: 'text', class: 'entrada', 'data-campo': 'dados', placeholder: '4, 6, 8, 10, 12, 20, 100' });
          ent.value = (b.juego.dados || [4, 6, 8, 10, 12, 20, 100]).join(', ');
          ent.addEventListener('change', () => {
            const n = ent.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((x, i, l) => Number.isInteger(x) && x >= 2 && x <= 1000 && l.indexOf(x) === i).slice(0, 12);
            b.juego.dados = n.length ? n : [4, 6, 8, 10, 12, 20, 100]; ent.value = b.juego.dados.join(', '); ctx.alCambiar();
          });
          return h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Dados disponibles en la ventana de tiradas'), ent, h('p', { class: 'ayuda' }, 'Caras separadas por comas (máximo 12). Ejemplo: 4, 6, 20.'));
        })(),
        c({ t: 'texto', k: 'tirada_estadistica', etiqueta: 'Fórmula al tirar una estadística', placeholder: '1d20 + [a.{estadistica}]', ayuda: '{estadistica} se sustituye por la estadística elegida. Ejemplo: 1d20 + [a.{estadistica}].' }, b.juego)),
      grupoCampos('Cómo se llaman las cosas en la mesa', h('p', { class: 'ayuda' }, 'Cambia las palabras que ven los jugadores para que encajen con tu sistema. Vacío = el nombre de siempre.'),
        nombresMesa(b.juego, ctxLocal)),
      grupoCampos('Orden del menú del cliente', h('p', { class: 'ayuda' }, 'El orden en que los jugadores ven las secciones del menú de la izquierda (Personaje, Inventario, Tienda…). Se aplica a toda la mesa al reiniciar el servidor.'),
        ordenMenu(b.juego, ctxLocal))],
    ficha: () => [
      grupoCampos('Datos propios de la ficha', h('p', { class: 'ayuda' }, 'Lo que cada personaje apunta además de sus estadísticas: Alineamiento, Edad, Dios, Trasfondo, Cordura… El jugador los rellena al crearlo y en su ficha (salvo los «Solo el GM»). Los privados solo los ven su dueño y el GM.'),
        tablaCamposFicha(b.juego, ctxLocal))],
    tablas: () => [tablasFormulas(b.juego.tablas, ctxLocal)],
    etiquetas: () => [etiquetasYVentajas(b.juego, ctxLocal)],
    automaticas: () => [grupoCampos('Efectos de la campaña', construirEfectos({ k: 'efectos' }, b.juego, ctxLocal)),
      grupoCampos('Ideas', h('p', { class: 'ayuda' }, 'Experiencia al derrotar: «Al derrotar a alguien» → «Sumar o restar a una estadística (para siempre)» Experiencia +10, solo si «él mismo es personaje de un jugador». Cordura: «Al empezar su turno», si «tiene el estado Aterrado», Cordura −1. Clima: «Siempre activo», si «es de noche», visión −2.'))],
    niebla: () => [
      grupoCampos('Niebla de guerra',
        c({ t: 'interruptor', k: 'activa', etiqueta: 'Activar la niebla de guerra', ayuda: 'Los jugadores solo ven lo que alcanza la visión de sus personajes, y no ven a través de los tiles y objetos que bloquean la vista. El GM siempre lo ve todo y puede encenderla o apagarla en plena partida. Cada mapa puede excluirse.', defecto: false }, b.juego.niebla),
        c({ t: 'numero', k: 'vision_base', etiqueta: 'Visión base', sufijo: 'casillas', min: 0, max: 50, defecto: 6, ayuda: 'Cuántas casillas ve cualquier personaje sin bonos.' }, b.juego.niebla),
        c({ t: 'interruptor', k: 'compartir', etiqueta: 'Los jugadores ven lo que ven los demás jugadores', ayuda: 'Apagado: cada uno ve solo lo que alcanzan sus propios personajes.', defecto: true }, b.juego.niebla)),
      grupoCampos('Cómo dar más (o menos) visión',
        h('p', { class: 'ayuda' }, 'En un rasgo, estado, tile u objeto añade el efecto «Sumar o restar casillas de visión» con el momento «Siempre». Ejemplos: una Antorcha (objeto, +2 mientras la lleve), Visión nocturna (rasgo de una raza, +3), Ceguera (estado, −5), un Faro (tile, +4 a quien esté encima).'),
        h('p', { class: 'ayuda' }, 'Qué bloquea la vista: marca «Bloquea la vista» en el tile (muros, puertas cerradas) o en el objeto del mapa.'))],
    sistema: (dineroSolo = false) => {
      const m = b.juego.moneda, ci = b.juego.ciclo, cl = b.juego.clima;
      m.denominaciones ||= []; ci.periodos ||= []; cl.tipos ||= [];
      const tabla = (lista, columnas, nuevo, vacio, refrescar, ordenable = null) => {        // ordenable: objeto con «inicial» (índice) que se mantiene al mover
        const mover = (i, d, pintar) => {
          const j = i + d;
          if (j < 0 || j >= lista.length) return;
          [lista[i], lista[j]] = [lista[j], lista[i]];
          if (ordenable && typeof ordenable.inicial === 'number') ordenable.inicial = ordenable.inicial === i ? j : ordenable.inicial === j ? i : ordenable.inicial;
          ctx.alCambiar(); pintar();
        };
        const caja = h('div', { class: 'tabla-editable' });
        const pintar = () => caja.replaceChildren(...lista.map((fila, i) => h('div', { class: 'fila-tabla' },
          ...columnas.map(([k, etiqueta, tipo, extra]) => {
            const e = h('input', { class: `entrada${tipo === 'number' ? ' entrada-num' : ''}`, type: tipo === 'color' ? 'color' : tipo, 'aria-label': etiqueta, 'data-col': k, ...extra });
            e.value = fila[k] ?? '';
            e.addEventListener('input', () => { fila[k] = tipo === 'number' ? Number(e.value) : e.value; ctx.alCambiar(); });
            return tipo === 'number' || tipo === 'color' ? h('label', { class: 'mini-campo' }, etiqueta, e) : e;
          }),
          ordenable ? h('span', { class: 'mini-botones' },
            h('button', { type: 'button', class: 'btn btn-mini', 'aria-label': 'Subir', title: 'Subir', 'data-accion': 'subir', disabled: i === 0, onclick: () => mover(i, -1, pintar) }, '↑'),
            h('button', { type: 'button', class: 'btn btn-mini', 'aria-label': 'Bajar', title: 'Bajar', 'data-accion': 'bajar', disabled: i === lista.length - 1, onclick: () => mover(i, 1, pintar) }, '↓')) : null,
          h('button', { type: 'button', class: 'btn btn-mini btn-peligro', 'aria-label': 'Quitar', onclick: () => { if (lista.length <= vacio) { toast(`Debe quedar al menos ${vacio}.`, 'error'); return; } lista.splice(i, 1); ctx.alCambiar(); pintar(); refrescar?.(); } }, '✕'))),
          h('button', { type: 'button', class: 'btn', onclick: () => { lista.push(nuevo()); ctx.alCambiar(); pintar(); } }, '+ Añadir'));
        pintar();
        return caja;
      };
      if (dineroSolo) return [
        grupoCampos('Dinero',
          c({ t: 'interruptor', k: 'activa', etiqueta: 'Esta campaña usa dinero', ayuda: 'Desactivado: no hay dinero en las fichas ni tiendas.', defecto: true }, m),
          h('div', { class: 'dos-columnas' },
            c({ t: 'texto', k: 'nombre', etiqueta: 'Nombre de la moneda', placeholder: 'Monedas' }, m),
            c({ t: 'texto', k: 'simbolo', etiqueta: 'Símbolo', placeholder: '🪙' }, m)),
          c({ t: 'numero', k: 'inicial', etiqueta: 'Dinero con el que empieza cada personaje', min: 0, max: 1000000000, defecto: 0, ayuda: 'En la unidad más pequeña (por ejemplo, cobre).' }, m),
          h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Piezas (opcional)'),
            h('p', { class: 'ayuda' }, 'Si quieres mostrar el dinero en piezas, define cuánto vale cada una en la unidad más pequeña. Ejemplo: Oro = 100, Plata = 10, Cobre = 1. El dinero se guarda como un solo número; las piezas solo cambian cómo se ve.'),
            tabla(m.denominaciones, [['nombre', 'Nombre', 'text', { maxlength: '30', placeholder: 'Oro' }], ['valor', 'Vale', 'number', { min: '1', step: '1' }]], () => ({ nombre: 'Pieza nueva', valor: 1 }), 0))),
        grupoCampos('Comercio y objetos',
          c({ t: 'interruptor', k: 'intercambios', etiqueta: 'Los jugadores pueden intercambiar objetos y dinero entre ellos', ayuda: 'Se hace como en un MMO: cada uno pone lo que ofrece y el cambio se hace cuando los dos aceptan.', defecto: true }, b.permisos),
          c({ t: 'interruptor', k: 'dar_objetos', etiqueta: 'Los jugadores pueden dar objetos a otro token cercano', ayuda: 'Botón «Dar» del inventario: eligen a quién (un personaje o un NPC que esté cerca) y lo confirman. En combate, solo en su turno. El GM siempre puede.', defecto: true }, b.permisos),
          c({ t: 'numero', k: 'alcance_objetos', etiqueta: 'Distancia para dar un objeto o usarlo con otro', sufijo: 'casillas', min: 1, max: 50, defecto: 1, ayuda: '1 = solo a quien esté al lado. También vale para «Usar» un objeto con otro (por ejemplo, darle una poción a un aliado). El GM no tiene límite.' }, b.permisos),
          h('p', { class: 'ayuda' }, 'Las tiendas (qué venden, a qué precio y en qué mapas) se crean en la categoría «Tiendas»; el GM las abre durante la partida.'))];
      return [
        grupoCampos('Día y noche',
          c({ t: 'interruptor', k: 'activo', etiqueta: 'La campaña tiene momentos del día', ayuda: 'El GM cambia el momento con un clic en la barra superior y el mapa se tiñe del color que elijas (por ejemplo, oscuro de noche).' }, ci),
          h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Momentos'),
            h('p', { class: 'ayuda' }, 'Nombre, color del velo sobre el mapa y qué tan fuerte es (0 = sin velo, 0.9 = muy oscuro). Con fuerza 0 no hay velo. Las flechas ↑ ↓ cambian el orden en que el GM los recorre.'),
            tabla(ci.periodos, [['nombre', 'Nombre', 'text', { maxlength: '30' }], ['color', 'Color', 'color', {}], ['opacidad', 'Fuerza', 'number', { min: '0', max: '0.9', step: '0.05' }]], () => ({ nombre: 'Momento nuevo', color: '', opacidad: 0 }), 1, null, ci))),
        grupoCampos('Clima',
          c({ t: 'interruptor', k: 'activo', etiqueta: 'La campaña tiene clima', ayuda: 'El GM cambia el clima con un clic en la barra superior (junto al momento del día) y el mapa se tiñe del color que elijas. Los efectos de la campaña pueden depender de él: en Efectos automáticos, condición «El clima es…» (por ejemplo, −2 de Visión con Niebla).' }, cl),
          h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Tipos de clima'),
            h('p', { class: 'ayuda' }, 'Nombre, color del velo sobre el mapa y qué tan fuerte es (0 = sin velo, 0.9 = muy opaco). El primero es el que hay al empezar la partida.'),
            tabla(cl.tipos, [['nombre', 'Nombre', 'text', { maxlength: '30' }], ['color', 'Color', 'color', {}], ['opacidad', 'Fuerza', 'number', { min: '0', max: '0.9', step: '0.05' }]], () => ({ nombre: 'Clima nuevo', color: '', opacidad: 0 }), 1, null, cl)))];
    },
    dinero: () => vistas.sistema(true),
    visibilidad: () => {
      const bloque = (titulo, obj) => grupoCampos(titulo,
        c({ t: 'interruptor', k: 'estadisticas', etiqueta: 'Estadísticas (Fuerza, Agilidad…)' }, obj),
        c({ t: 'interruptor', k: 'recursos', etiqueta: 'Todos los recursos (magia, energía…)', ayuda: 'La vida del token se ve siempre.' }, obj),
        c({ t: 'interruptor', k: 'inventario', etiqueta: 'Inventario' }, obj),
        c({ t: 'interruptor', k: 'habilidades', etiqueta: 'Habilidades' }, obj),
        c({ t: 'interruptor', k: 'ficha', etiqueta: 'Ficha (raza, clase, rasgos, personalidad y biografía)' }, obj));
      // Sobre el mapa: qué barras se dibujan bajo cada token y si se ven las barras y el nombre de los tokens ajenos.
      const st = b.visibilidad.sobre_tokens ||= {};
      const recs = recursosJuegoDe(b);
      const vidaJ = b.juego.recurso_vida || recs[0];
      const elegidas = () => (Array.isArray(st.barras) ? st.barras : [vidaJ]).filter((r) => recs.includes(r));
      const casillas = h('div', { class: 'casillas-barras', 'data-campo': 'barras' }, recs.map((r) => {
        const cb = h('input', { type: 'checkbox', value: r });
        cb.checked = elegidas().includes(r);
        cb.addEventListener('change', () => {
          const ahora = elegidas().filter((x) => x !== r);
          if (cb.checked) ahora.push(r);
          st.barras = recs.filter((x) => ahora.includes(x)).slice(0, 4);       // en el orden de la lista de recursos; como mucho 4
          ctx.alCambiar(); mostrar('visibilidad');
        });
        return h('label', { class: 'casilla-barra' }, cb, h('span', null, r));
      }));
      const sobre = grupoCampos('Sobre los tokens del mapa',
        h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Barras bajo cada token'), casillas,
          h('p', { class: 'ayuda' }, 'Recursos que se ven como barra bajo el token (hasta 4). La vida se pinta verde, ámbar o roja según lo que quede. Cada jugador puede apagar en sus Ajustes las que no quiera ver.')),
        c({ t: 'interruptor', k: 'barras_jugadores', defecto: true, etiqueta: 'Se ven las barras de los personajes de los demás jugadores', ayuda: 'Apagado: cada jugador ve solo las de sus tokens (el GM, todas).' }, st),
        c({ t: 'interruptor', k: 'barras_npc', defecto: true, etiqueta: 'Se ven las barras de los NPC' }, st),
        c({ t: 'interruptor', k: 'nombre_jugadores', defecto: true, etiqueta: 'Se ve el nombre de los personajes de los demás' }, st),
        c({ t: 'interruptor', k: 'nombre_npc', defecto: true, etiqueta: 'Se ve el nombre de los NPC', ayuda: 'Útil para enemigos misteriosos. En la partida, el GM puede cambiar esto en un token concreto (clic derecho → Editar…).' }, st));
      return [h('p', { class: 'ayuda' }, 'Los jugadores siempre ven todo lo suyo. El GM puede mostrar datos concretos de un personaje desde el juego, y el propietario puede bloquear la visión de un jugador en «Jugadores y fichas».'),
        sobre, bloque('De otros jugadores', b.visibilidad.jugadores), bloque('De los NPC (aliados, neutrales y enemigos)', b.visibilidad.npc)];
    },
    seguridad: () => [
      grupoCampos('Cuentas de jugadores',
        c({ t: 'interruptor', k: 'registro_abierto', etiqueta: 'Cualquiera puede crear su usuario al entrar', ayuda: 'Desactivado: solo entran usuarios creados antes por el administrador.', defecto: true }, b.seguridad),
        c({ t: 'interruptor', k: 'contrasena_obligatoria', etiqueta: 'Todos los jugadores deben tener contraseña', ayuda: 'Recomendado: sin contraseña, quien entre primero con un nombre libre se queda con esa cuenta y sus personajes. Cada jugador también puede ponerse una por su cuenta.' }, b.seguridad)),
      grupoCampos('Protección contra intrusos',
        h('div', { class: 'dos-columnas' },
          c({ t: 'numero', k: 'max_intentos', etiqueta: 'Intentos fallidos permitidos', min: 1, max: 100, defecto: 5 }, b.seguridad),
          c({ t: 'numero', k: 'bloqueo_segundos', etiqueta: 'Bloqueo tras fallar', sufijo: 'segundos', min: 1, max: 86400, defecto: 60 }, b.seguridad))),
      grupoCampos('Cifrado',
        c({ t: 'interruptor', k: 'cifrado', etiqueta: 'Cifrar la conexión (recomendado)', defecto: true, ayuda: 'Protege las contraseñas y la partida en internet. Desactívalo solo si un servicio de hosting ya cifra por fuera.' }, b.servidor)),
    ],
  };
  function recursosJuegoDe(bb) { return (bb.juego.recursos || []).map((r) => r.nombre); }

  function mostrar(id) {
    const mismaSeccion = contenido.isConnected && p.seccion === (vistas[id] ? id : 'general');
    p.seccion = vistas[id] ? id : 'general';
    for (const s of SECCIONES) nav.querySelector(`[data-sec="${s.id}"]`)?.classList.toggle('activa', s.id === p.seccion);
    const sec = SECCIONES.find((s) => s.id === p.seccion);
    const pintar = () => contenido.replaceChildren(h('header', { class: 'reglas-cab' }, h('h2', null, `${sec.icono} ${sec.titulo}`), h('p', { class: 'ayuda' }, sec.ayuda)), ...vistas[p.seccion]());
    if (mismaSeccion) sinSaltoDeScroll(contenido.closest('.edicion-cuerpo') || contenido, pintar); else pintar();      // al refrescar la misma, la barra no salta arriba
  }
  const boton = (s) => h('button', { type: 'button', class: 'reglas-nav-item', 'data-sec': s.id, onclick: () => mostrar(s.id) }, h('span', null, s.icono), s.titulo);
  nav.append(...[...new Set(SECCIONES.map((s) => s.bloque))].map((bl) => h('div', { class: 'reglas-nav-bloque' },
    h('span', { class: 'reglas-nav-titulo' }, bl), ...SECCIONES.filter((s) => s.bloque === bl).map(boton))));
  mostrar(p.seccion || 'general');
  return h('div', { class: 'reglas' }, nav, contenido);
}
