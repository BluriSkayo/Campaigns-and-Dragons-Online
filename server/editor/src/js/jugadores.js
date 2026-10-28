// jugadores.js — «Jugadores y fichas»: el GM crea usuarios (con o sin contraseña) y les prepara fichas de personaje.
// Todo se guarda al momento en data/<campaña> (no pasa por el botón Guardar), y solo con el servidor cerrado.
import { h, toast, confirmar, dialogo, preguntarCambios, clonar, entero, sinSaltoDeScroll } from './util.js';
import { E, bus, PENDIENTES, recargarAssets } from './estado.js';
import { construirCampo } from './campos.js';

const nombreDe = (cat, id) => E.campana.recursos[cat]?.[id]?.nombre || id;
const j = () => E.campana.config.juego || {};
const grupos = () => (j().usar_grupos === false ? [] : Object.entries(E.campana.recursos.grupos || {}));
/** ¿El grupo aplica a estas elecciones? («Solo aparece si…»: depende de lo elegido en otro grupo). */
const grupoActivo = (g, el, n = 0) => { const si = E.campana.recursos.grupos?.[g]?.solo_si; return !si || (n < 10 && (si.opciones || []).includes(el[si.grupo]) && grupoActivo(si.grupo, el, n + 1)); };
const opcionesDe = (g) => Object.entries(E.campana.recursos.opciones || {}).filter(([, o]) => o.grupo === g);
const opcionesElegidas = (el) => grupos().map(([g]) => E.campana.recursos.opciones?.[el[g]]).filter(Boolean);

// Lo mismo que calcula el servidor al crear un personaje (estadísticas «para todos» + lo que aporte cada opción).
export function statsBase(el) {
  const r = {};
  const ids = new Set(Object.values(el || {}));
  for (const e of j().estadisticas || []) if (e.para_todos !== false || (e.solo_para || []).some((o) => ids.has(o))) r[e.nombre] = e.valor_inicial ?? 10;
  for (const o of opcionesElegidas(el)) Object.assign(r, o.estadisticas || {});
  return r;
}
export function recursosBase(el) {
  const r = {};
  const ids = new Set(Object.values(el || {}));
  for (const x of j().recursos || []) if (x.para_todos !== false || (x.solo_para || []).some((o) => ids.has(o))) r[x.nombre] = x.maximo_inicial ?? 100;
  for (const o of opcionesElegidas(el)) Object.assign(r, o.recursos || {});
  return r;
}
export const puntosBase = (el) => (j().puntos_a_repartir || 0) + opcionesElegidas(el).reduce((a, o) => a + (o.puntos_extra || 0), 0);
const habilidadesDe = (el) => [...new Set(opcionesElegidas(el).flatMap((o) => o.habilidades || []))];

function fichaNueva() {
  const el = {};
  return { nombre: '', historia: '', imagen: '', imagen_biografia: '', dinero: j().moneda?.activa === false ? 0 : (j().moneda?.inicial ?? 0), elecciones: el, stats: statsBase(el),
    recursos: Object.fromEntries(Object.entries(recursosBase(el)).map(([k, v]) => [k, { actual: v, max: v }])),
    puntos_pendientes: puntosBase(el), habilidades: [], inventario: [] };
}

/** Al cambiar de clase/raza: ajusta estadísticas, recursos, puntos y habilidades a lo que concede la nueva elección, sin pisar lo que el GM tocó a mano. */
function alCambiarElecciones(f, antes) {
  const bA = statsBase(antes), bN = statsBase(f.elecciones);
  for (const k of Object.keys(f.stats)) if (!(k in bN) && k in bA) delete f.stats[k];
  for (const [k, v] of Object.entries(bN)) if (!(k in f.stats) || f.stats[k] === bA[k]) f.stats[k] = v;
  const rA = recursosBase(antes), rN = recursosBase(f.elecciones);
  for (const k of Object.keys(f.recursos)) if (!(k in rN) && k in rA) delete f.recursos[k];
  for (const [k, v] of Object.entries(rN)) if (!(k in f.recursos)) f.recursos[k] = { actual: v, max: v };
  else if (f.recursos[k].max === rA[k]) f.recursos[k] = { actual: Math.min(f.recursos[k].actual, v), max: v };
  f.puntos_pendientes = Math.max(0, f.puntos_pendientes + puntosBase(f.elecciones) - puntosBase(antes));
  for (const hb of habilidadesDe(f.elecciones)) if (!f.habilidades.includes(hb)) f.habilidades.push(hb);
}

async function pedirPassword(titulo, usuario) {
  const a = h('input', { type: 'password', class: 'entrada', autofocus: true, 'aria-label': 'Contraseña nueva', autocomplete: 'off' });
  const aviso = h('p', { class: 'error' });
  const r = await dialogo({
    titulo, contenido: h('div', { class: 'campos-dialogo' }, h('label', null, `Contraseña de ${usuario}`, a),
      h('p', { class: 'ayuda' }, 'Mínimo 6 caracteres. Se guarda cifrada: nadie podrá leerla después. Déjala vacía para que el jugador elija la suya al entrar.'), aviso),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', valor: 'ok', clase: 'btn-acento' }],
    alMostrar: (c, cierre) => {
      const ir = () => { if (a.value && a.value.length < 6) { aviso.textContent = 'Debe tener al menos 6 caracteres.'; return; } cierre('ok'); };
      a.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
      c.querySelector('.btn-acento').onclick = ir;
    },
  });
  return r === 'ok' ? a.value : null;
}

export function construirJugadores() {
  const raiz = h('div', { class: 'jugadores' });
  let datos = { abierto: false, usuarios: [] };
  let editando = null;          // { usuario, ficha, nueva }

  const id = () => E.campana.id;
  const intentar = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok, 'ok'); return r ?? true; } catch (e) { toast(e.message, 'error', 6000); return null; } };
  async function recargar() {
    try { datos = await window.editor.jugadores(id()); } catch (e) { toast(e.message, 'error'); }
    pintar();
  }
  // Si el servidor se abre o se cierra desde el botón de la barra, la lista se actualiza sola (sin pisar lo que se esté editando)
  const dejarDeVigilar = bus.mientras(raiz, 'servidor', () => { if (!raiz.isConnected) dejarDeVigilar(); else if (!editando) recargar(); });

  // ── Lista de usuarios ──
  function resumenFicha(f) {
    const partes = grupos().map(([g]) => f.elecciones?.[g] ? nombreDe('opciones', f.elecciones[g]) : null).filter(Boolean);
    const vida = f.recursos?.[j().recurso_vida];
    return [...partes, vida ? `${j().recurso_vida} ${vida.actual}/${vida.max}` : null, f.puntos_pendientes ? `${f.puntos_pendientes} puntos por repartir` : null].filter(Boolean).join(' · ');
  }
  /** El límite de ataque propio de un jugador (solo sirve para quitarle o darle más libertad que al resto). */
  function filaAtaque(u, bloq) {
    const sel = h('select', { class: 'entrada entrada-chica', 'data-accion': 'ataque', disabled: bloq, 'aria-label': `A quién puede atacar ${u.usuario}` },
      [['', 'Lo que diga la mesa (Reglas)'], ['nadie', 'A nadie'], ['enemigos', 'Solo a enemigos'], ['enemigos_y_neutros', 'A enemigos y neutrales'], ['todos', 'A todos (incluso aliados y otros jugadores)']].map(([v, t]) => h('option', { value: v }, t)));
    sel.value = u.ataque || '';
    sel.addEventListener('change', async () => { if (await intentar(() => window.editor.fijarAtaque(id(), u.usuario, sel.value), 'Guardado')) recargar(); });
    return h('div', { class: 'jug-ataque' }, h('span', { class: 'tenue pequeno' }, 'Puede atacar a:'), sel);
  }
  /** Bloqueos individuales: ver los datos de otros y editar fichas (por defecto, permitido). */
  function filaBloqueos(u, bloq) {
    const casilla = (clave, texto, ayuda) => {
      const c = h('input', { type: 'checkbox', disabled: bloq, 'data-accion': `bloqueo-${clave}`, 'aria-label': `${texto} (${u.usuario})` });
      c.checked = u[clave] !== false;
      c.addEventListener('change', async () => { if (await intentar(() => window.editor.fijarBloqueo(id(), u.usuario, clave, c.checked), 'Guardado')) recargar(); else c.checked = !c.checked; });
      return h('label', { class: 'jug-bloqueo', title: ayuda }, c, ' ', texto);
    };
    return h('div', { class: 'jug-bloqueos' },
      casilla('ver_ajenos', 'Puede ver datos de otros', 'Desmárcalo y este jugador solo verá nombre, imagen y posición de los demás (ni siquiera su vida).'),
      casilla('editar', 'Puede editar fichas', 'Desmárcalo y no podrá crear personajes, repartir puntos ni cambiar rasgos; solo jugar con lo que ya tiene.'));
  }
  function tarjetaUsuario(u) {
    const bloq = datos.abierto;
    return h('section', { class: 'jug-usuario', 'data-usuario': u.usuario },
      h('div', { class: 'jug-cab' },
        h('strong', { class: 'jug-nombre' }, `👤 ${u.usuario}`),
        u.cuenta ? h('span', { class: `insignia insignia-${u.tiene_password ? 'bien' : 'neutro'}` }, u.tiene_password ? '🔒 Con contraseña' : '🔓 Sin contraseña (la elige al entrar)')
          : h('span', { class: 'insignia insignia-aviso', title: 'Tiene fichas pero no tiene cuenta. Créala para que pueda entrar.' }, 'Sin cuenta'),
        h('div', { class: 'relleno' }),
        u.cuenta ? h('button', { type: 'button', class: 'btn btn-mini', disabled: bloq, 'data-accion': 'password', onclick: async () => {
          const pw = await pedirPassword('Contraseña del jugador', u.usuario); if (pw === null) return;
          if (await intentar(() => window.editor.fijarPassword(id(), u.usuario, pw), pw ? 'Contraseña guardada' : 'Contraseña quitada')) recargar();
        } }, 'Contraseña…') : h('button', { type: 'button', class: 'btn btn-mini', disabled: bloq, onclick: async () => {
          if (await intentar(() => window.editor.crearCuenta(id(), u.usuario, ''), 'Cuenta creada')) recargar();
        } }, 'Crear cuenta'),
        h('button', { type: 'button', class: 'btn btn-mini', disabled: bloq || !u.cuenta, 'data-accion': 'nueva-ficha', onclick: () => { editando = { usuario: u.usuario, ficha: fichaNueva(), nueva: true }; pintar(); } }, '＋ Nueva ficha'),
        h('button', { type: 'button', class: 'btn btn-mini', disabled: bloq || !u.cuenta, 'data-accion': 'importar-personaje',
          title: 'Trae un personaje que el jugador exportó desde su cliente (archivo .mesa-personaje), con sus imágenes', onclick: async () => {
            let r = await intentar(() => window.editor.importarPersonaje(id(), u.usuario));
            if (r?.conflicto) {
              const modo = await dialogo({ titulo: 'Ya existe esa ficha',
                contenido: h('p', { class: 'dialogo-texto' }, `${u.usuario} ya tiene una ficha llamada «${r.conflicto.nombre}». «Actualizar» la sustituye por la del archivo, con todos sus datos e imágenes (si ese personaje está en la partida, sigue siendo el mismo). «Importar como copia» la añade aparte con otro nombre.`),
                botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Importar como copia', valor: 'copia' }, { texto: 'Actualizar la ficha', valor: 'reemplazar', clase: 'btn-acento' }] });
              if (!modo) return;
              r = await intentar(() => window.editor.importarPersonaje(id(), u.usuario, modo));
            }
            if (!r || r === true) return;
            const conImg = r.imagenes ? ` (con ${r.imagenes} ${r.imagenes === 1 ? 'imagen nueva' : 'imágenes nuevas'})` : '';
            toast(r.reemplazada ? `Ficha «${r.nombre}» de ${u.usuario} actualizada desde el archivo${conImg}.` : `«${r.nombre}» importado como ficha de ${u.usuario}${conImg}.`, 'ok', 6000);
            await recargarAssets(); await recargar();
          } }, '📥 Importar personaje…'),
        u.cuenta ? h('button', { type: 'button', class: 'btn btn-mini btn-peligro', disabled: bloq, 'aria-label': `Quitar a ${u.usuario}`, title: 'Quitar usuario', 'data-accion': 'quitar-usuario', onclick: async () => {
          if (!(await confirmar('Quitar usuario', `¿Quitar a «${u.usuario}»? Ya no podrá entrar. Sus fichas se conservan por si vuelve a crearse.`, { si: 'Quitar', peligro: true }))) return;
          if (await intentar(() => window.editor.borrarCuenta(id(), u.usuario), 'Usuario quitado')) recargar();
        } }, '✕') : null),
      u.cuenta ? filaAtaque(u, bloq) : null,
      u.cuenta ? filaBloqueos(u, bloq) : null,
      u.fichas.length ? h('div', { class: 'jug-fichas' }, u.fichas.map((f) => h('div', { class: 'jug-ficha', 'data-ficha': f.nombre },
        h('div', { class: 'jug-ficha-txt' }, h('strong', null, f.nombre), h('span', { class: 'tenue pequeno' }, resumenFicha(f) || 'Sin elecciones')),
        h('button', { type: 'button', class: 'btn btn-mini', disabled: bloq, 'data-accion': 'editar-ficha', onclick: () => { editando = { usuario: u.usuario, ficha: clonar(f), nueva: false }; pintar(); } }, 'Editar'),
        h('button', { type: 'button', class: 'btn btn-mini btn-peligro', disabled: bloq, 'aria-label': `Eliminar la ficha ${f.nombre}`, onclick: async () => {
          if (!(await confirmar('Eliminar ficha', `¿Eliminar a «${f.nombre}»? Esta acción no se puede deshacer (queda una copia .bak del archivo del jugador).`, { si: 'Eliminar', peligro: true }))) return;
          if (await intentar(() => window.editor.borrarFicha(id(), u.usuario, f.id), 'Ficha eliminada')) recargar();
        } }, '✕'))))
        : h('p', { class: 'tenue pequeno jug-vacio' }, u.cuenta ? 'Aún no tiene fichas: el jugador podrá crear la suya al entrar (si la campaña lo permite), o créala tú con «Nueva ficha».' : 'Sin fichas.'));
  }

  async function nuevoUsuario() {
    const nombre = h('input', { type: 'text', class: 'entrada', maxlength: '20', autofocus: true, 'aria-label': 'Nombre de usuario', placeholder: 'Nombre con el que entrará' });
    const pw = h('input', { type: 'password', class: 'entrada', 'aria-label': 'Contraseña (opcional)', autocomplete: 'off', placeholder: 'Opcional' });
    const aviso = h('p', { class: 'error' });
    const r = await dialogo({
      titulo: 'Nuevo usuario',
      contenido: h('div', { class: 'campos-dialogo' }, h('label', null, 'Nombre de usuario (nickname)', nombre), h('label', null, 'Contraseña', pw),
        h('p', { class: 'ayuda' }, 'El nombre debe ser el mismo con el que el jugador se conectará. Si dejas la contraseña vacía, la elegirá él al entrar.'), aviso),
      botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Crear', valor: 'ok', clase: 'btn-acento' }],
      alMostrar: (c, cierre) => {
        const ir = () => { if (!nombre.value.trim()) { aviso.textContent = 'Escribe un nombre de usuario.'; return; } if (pw.value && pw.value.length < 6) { aviso.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; } cierre('ok'); };
        for (const e of [nombre, pw]) e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ir(); });
        c.querySelector('.btn-acento').onclick = ir;
      },
    });
    if (r !== 'ok') return;
    if (await intentar(() => window.editor.crearCuenta(id(), nombre.value.trim(), pw.value), 'Usuario creado')) recargar();
  }

  function lista() {
    const aviso = datos.abierto ? h('div', { class: 'jug-aviso', role: 'alert' }, '🔒 El servidor de esta campaña está abierto. Puedes mirar, pero para cambiar usuarios y fichas ciérralo primero (si no, la partida pisaría tus cambios). Si lo abriste desde el Editor, ciérralo con el botón «Servidor abierto» de la barra superior.') : null;
    return h('div', { class: 'jug-lista' }, aviso,
      h('div', { class: 'jug-barra' },
        h('button', { type: 'button', class: 'btn btn-acento', disabled: datos.abierto, 'data-accion': 'nuevo-usuario', onclick: nuevoUsuario }, '＋ Nuevo usuario'),
        h('button', { type: 'button', class: 'btn', onclick: recargar }, '↻ Actualizar'),
        h('span', { class: 'tenue pequeno' }, 'El nombre de usuario es el nickname del jugador: las fichas se asocian a él.')),
      datos.usuarios.length ? datos.usuarios.map(tarjetaUsuario)
        : h('p', { class: 'tenue' }, 'Todavía no hay usuarios. Crea uno para prepararle una ficha, o deja que los jugadores se registren al entrar (según las reglas de seguridad).'));
  }

  // ── Editor de una ficha ──
  function formulario() {
    const { usuario, ficha: f, nueva } = editando;
    const ctx = { alCambiar: () => {}, propioId: null };
    const cuerpo = h('div', { class: 'jug-form' });
    const pintarForm = () => {
      const c = (def) => construirCampo(def, f, ctx);
      for (const g of Object.keys(f.elecciones)) if (!grupoActivo(g, f.elecciones)) delete f.elecciones[g];
      const selGrupos = grupos().filter(([g]) => grupoActivo(g, f.elecciones)).map(([g, gd]) => {
        const sel = h('select', { class: 'entrada', 'data-grupo': g, 'aria-label': gd.nombre }, gd.obligatorio === false ? h('option', { value: '' }, '— Ninguna —') : h('option', { value: '', disabled: true }, 'Elige…'),
          opcionesDe(g).map(([oid, o]) => h('option', { value: oid }, o.nombre)));
        sel.value = f.elecciones[g] || '';
        sel.addEventListener('change', () => {
          const antes = clonar(f.elecciones);
          if (sel.value) f.elecciones[g] = sel.value; else delete f.elecciones[g];
          alCambiarElecciones(f, antes); pintarForm();
        });
        return h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, `${gd.nombre}${gd.obligatorio === false ? '' : ' *'}`), sel);
      });
      const numero = (obj, k, min, max, etiqueta, dataset) => {
        const n = h('input', { class: 'entrada entrada-num', type: 'number', step: '1', min, max, 'aria-label': etiqueta, ...dataset });
        n.value = obj[k]; n.addEventListener('input', () => { obj[k] = entero(n.value, 0); });
        return n;
      };
      const stats = (j().estadisticas || []).filter((e) => e.nombre in f.stats).map((e) =>
        h('div', { class: 'fila-valor' }, h('span', { title: e.descripcion || '' }, e.nombre), numero(f.stats, e.nombre, e.minimo ?? 0, e.maximo ?? 999, e.nombre, { 'data-stat': e.nombre })));
      const recursos = (j().recursos || []).filter((r) => r.nombre in f.recursos).map((r) => {
        const rv = f.recursos[r.nombre];
        const mx = numero(rv, 'max', r.nombre === j().recurso_vida ? 1 : 0, 99999, `${r.nombre} máximo`, { 'data-recurso-max': r.nombre });
        mx.addEventListener('input', () => { if (rv.actual > rv.max) rv.actual = rv.max; });
        return h('div', { class: 'fila-valor' }, h('span', null, r.nombre), h('label', { class: 'mini-campo' }, 'Actual', numero(rv, 'actual', 0, 99999, `${r.nombre} actual`, { 'data-recurso': r.nombre })), h('label', { class: 'mini-campo' }, 'Máximo', mx));
      });
      sinSaltoDeScroll(cuerpo.closest('.edicion-cuerpo') || cuerpo, () => cuerpo.replaceChildren(
        h('section', { class: 'bloque' }, h('h3', null, 'Quién es'),
          c({ t: 'texto', k: 'nombre', etiqueta: 'Nombre del personaje', obligatorio: true }),
          c({ t: 'imagen', k: 'imagen', etiqueta: 'Imagen del token', carpeta: 'tokens' }),
          c({ t: 'imagen', k: 'imagen_biografia', etiqueta: 'Imagen de la biografía', carpeta: 'tokens' }),
          c({ t: 'largo', k: 'historia', etiqueta: 'Historia', max: 20000, filas: 8 })),
        selGrupos.length ? h('section', { class: 'bloque' }, h('h3', null, 'Elecciones'), h('p', { class: 'ayuda' }, 'Al elegir raza, clase… se ajustan solos las estadísticas, recursos, puntos y habilidades que conceden. Lo que cambies a mano se respeta.'), selGrupos) : null,
        (j().campos_ficha || []).length ? h('section', { class: 'bloque' }, h('h3', null, 'Datos de la ficha'),
          ...(j().campos_ficha || []).map((cf) => {
            f.campos ||= {};
            const def = cf.tipo === 'numero' ? { t: 'numero', k: cf.nombre, etiqueta: cf.nombre, min: cf.minimo ?? 0, max: cf.maximo ?? 9999, ayuda: cf.descripcion }
              : cf.tipo === 'lista' ? { t: 'seleccion', k: cf.nombre, etiqueta: cf.nombre, opciones: [['', '—'], ...(cf.opciones || []).map((o) => [o, o])], ayuda: cf.descripcion }
                : cf.tipo === 'casilla' ? { t: 'interruptor', k: cf.nombre, etiqueta: cf.nombre, ayuda: cf.descripcion }
                  : { t: 'texto', k: cf.nombre, etiqueta: cf.nombre, ayuda: cf.descripcion };
            return construirCampo(def, f.campos, ctx);
          })) : null,
        h('section', { class: 'bloque' }, h('h3', null, 'Estadísticas'), h('div', { class: 'tabla-valores' }, stats),
          h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Puntos por repartir'), numero(f, 'puntos_pendientes', 0, 10000, 'Puntos por repartir', { 'data-campo': 'puntos' }),
            h('p', { class: 'ayuda' }, 'Los que el jugador (o tú) aún no ha gastado.'))),
        h('section', { class: 'bloque' }, h('h3', null, 'Recursos'), h('div', { class: 'tabla-valores' }, recursos)),
        h('section', { class: 'bloque' }, h('h3', null, 'Habilidades y objetos'),
          c({ t: 'refs', k: 'habilidades', etiqueta: 'Habilidades que conoce', cat: 'habilidades', vacio: 'Añadir una habilidad…' }),
          j().moneda?.activa === false ? null : h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, `${j().moneda?.nombre || 'Dinero'} que lleva`), numero(f, 'dinero', 0, 1000000000, 'Dinero', { 'data-campo': 'dinero' }),
            h('p', { class: 'ayuda' }, 'En la unidad más pequeña de la moneda (por ejemplo, cobre).')),
          c({ t: 'inventario', k: 'inventario', etiqueta: 'Lleva' }),
          c({ t: 'sonidos', k: 'sonidos', etiqueta: 'Sonidos asociados', ayuda: 'Efectos que este personaje puede lanzar (si la mesa deja a los jugadores hacerlo).' }))));
    };
    pintarForm();
    editando.inicial ??= JSON.stringify(f);            // cómo estaba al abrirla: sirve para saber si hay cambios sin guardar
    const haySinGuardar = () => !!editando && JSON.stringify(f) !== editando.inicial;
    const guardar = async () => {
      const r = await intentar(() => window.editor.guardarFicha(id(), usuario, f), f.imagen ? 'Ficha guardada. Si su imagen es nueva, los jugadores la verán cuando importen los archivos de campaña (📦 Exportar archivos para los jugadores).' : 'Ficha guardada');
      if (r) { editando = null; await recargar(); }
      return !!r;
    };
    PENDIENTES.set('jugadores', { titulo: `La ficha de ${usuario}`, sucia: haySinGuardar, guardar, descartar: () => { editando = null; } });
    const volver = async () => {
      if (haySinGuardar()) {
        const r = await preguntarCambios(`La ficha de ${usuario} tiene cambios sin guardar.`);
        if (r === null) return;
        if (r === 'guardar' && !(await guardar())) return;
        if (r === 'guardar') return;                    // guardar ya vuelve a la lista
      }
      editando = null; pintar();
    };
    return h('div', { class: 'jug-editor' },
      h('div', { class: 'jug-barra' },
        h('button', { type: 'button', class: 'btn', onclick: volver }, '← Volver'),
        h('strong', null, `${nueva ? 'Nueva ficha' : 'Editar ficha'} de ${usuario}`),
        h('div', { class: 'relleno' }),
        h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'guardar-ficha', onclick: guardar }, '💾 Guardar ficha')),
      cuerpo);
  }

  function pintar() { raiz.replaceChildren(editando ? formulario() : lista()); }
  pintar(); recargar();
  return raiz;
}
