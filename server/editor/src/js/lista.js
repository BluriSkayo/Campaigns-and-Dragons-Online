// lista.js — La lista de una categoría en el centro del Editor: «＋» para añadir, «✕» al lado de cada nombre para quitarlo,
// un filtro, «Ordenar por…» y una línea de resumen por recurso. Pulsar un nombre abre su ficha al lado.
// Las filas se arrastran arriba o abajo para ponerlas en el orden que quieras (orden «Personalizado», que también usa la partida);
// con el teclado, Alt + ↑ / ↓ sobre una fila. En los NPC, soltar una fila sobre otra categoría la cambia de categoría.
import { h, pedirTexto, toast } from './util.js';
import { E, bus, listaOrdenada, clave, pestana, sucia, pluralDe, enCalma, cambiarCategoriaNpc, MODOS_ORDEN, modoOrden, fijarModoOrden, moverEnOrden } from './estado.js';
import { CATEGORIAS, resumen } from './esquemas.js';
import { urlAsset } from './campos.js';
import { irA, crear, quitar } from './navegacion.js';
import { conErrores, nombreVisible } from './explorador.js';

const art = (def) => (def.genero === 'f' ? 'Nueva' : 'Nuevo');
const TIPO_FILA = 'application/x-editor-fila';          // lo que se arrastra: {cat, id}

export function crearLista(vista) {
  const esGrupos = vista === 'grupos';
  const def = CATEGORIAS[esGrupos ? 'grupos' : vista];
  const titulo = esGrupos ? 'Razas, clases y orígenes' : pluralDe(vista, def.plural);
  const icono = esGrupos ? '🧬' : def.icono;
  let filtro = '';

  const cuenta = h('span', { class: 'cuenta' });
  const mas = h('button', { type: 'button', class: 'lista-mas', 'data-accion': 'nuevo-en-lista',
    title: esGrupos ? 'Nueva categoría (Raza, Clase, Origen…)' : `${art(def)} ${def.singular}`, 'aria-label': esGrupos ? 'Nueva categoría' : `${art(def)} ${def.singular}`,
    onclick: () => crear(esGrupos ? 'grupos' : vista) }, '＋');
  const buscar = h('input', { type: 'search', class: 'entrada lista-filtro', placeholder: `Filtrar ${titulo.toLowerCase()}…`, 'aria-label': `Filtrar ${titulo}` });
  buscar.addEventListener('input', () => { filtro = buscar.value.trim().toLowerCase(); pintar(); });
  // «Ordenar por…»: se recuerda en este equipo para cada lista. «Personalizado» es el orden que eliges arrastrando (y el de la partida).
  const ordenar = h('select', { class: 'entrada lista-orden', 'data-accion': 'ordenar-lista', 'aria-label': 'Ordenar por',
    title: 'Ordenar por. «Personalizado» es el orden que eliges arrastrando las filas; la partida usa ese mismo orden.',
    onchange: () => fijarModoOrden(vista, ordenar.value) }, MODOS_ORDEN.map(([v, t]) => h('option', { value: v }, t)));
  const ayudaOrden = h('p', { class: 'lista-ayuda-orden tenue pequeno', hidden: true }, 'Arrastra una fila arriba o abajo para cambiar el orden (o Alt + ↑ / ↓). La partida usa este orden.');
  const filas = h('div', { class: 'lista-filas', role: 'list' });
  const el = h('section', { class: 'lista-cat', 'data-lista': vista, 'aria-label': titulo },
    h('header', { class: 'lista-cab' }, h('h2', null, h('span', null, icono), ' ', titulo), cuenta, h('div', { class: 'relleno' }), mas),
    buscar, h('label', { class: 'lista-orden-etq' }, h('span', { class: 'tenue pequeno' }, 'Ordenar por'), ordenar),
    ayudaOrden, filas);

  const coincide = (t) => !filtro || String(t).toLowerCase().includes(filtro);
  const modo = () => modoOrden(vista);
  const ordenada = (cat) => listaOrdenada(cat, modo());

  // ── Arrastrar filas ──
  // Al soltar una fila sobre otra, va justo antes o justo después (según la mitad de la fila donde caiga). En la lista de NPC,
  // si la de destino es de otra categoría, también se cambia de categoría. Una opción solo se mueve entre las de su mismo grupo.
  let arrastrada = null;          // {cat, id} mientras se arrastra (dataTransfer no se puede leer en «dragover»)
  const categoriaNpc = (id) => String((pestana(clave('enemigos', id))?.borrador || E.campana.recursos.enemigos[id])?.categoria || '').trim();
  const grupoDe = (id) => (pestana(clave('opciones', id))?.borrador || E.campana.recursos.opciones[id])?.grupo;
  const limpiarMarcas = () => filas.querySelectorAll('.soltar-antes, .soltar-despues').forEach((x) => x.classList.remove('soltar-antes', 'soltar-despues'));
  async function mover(cat, id, junto, despues) {
    try {
      if (cat === 'opciones' && grupoDe(id) !== grupoDe(junto)) { toast('Una opción solo se ordena dentro de su grupo. Para pasarla a otro grupo, ábrela y cambia su «Grupo».', 'info', 6000); return; }
      if (cat === 'enemigos' && categoriaNpc(id).toLowerCase() !== categoriaNpc(junto).toLowerCase()) await cambiarCategoriaNpc(id, categoriaNpc(junto));
      if (await moverEnOrden(cat, id, junto, despues, vista, modo())) {
        requestAnimationFrame(() => filas.querySelector(`[data-clave="${clave(cat, id)}"] .fila-abrir`)?.focus());
      }
    } catch (e) { toast(e.message, 'error'); }
  }
  function hacerArrastrable(fila, cat, id) {
    fila.draggable = true;
    fila.addEventListener('dragstart', (e) => {
      arrastrada = { cat, id };
      e.dataTransfer.setData(TIPO_FILA, JSON.stringify(arrastrada));
      e.dataTransfer.effectAllowed = 'move';
      fila.classList.add('arrastrando');
    });
    fila.addEventListener('dragend', () => { arrastrada = null; fila.classList.remove('arrastrando'); limpiarMarcas(); });
    fila.addEventListener('dragover', (e) => {
      if (!arrastrada || arrastrada.cat !== cat || arrastrada.id === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = fila.getBoundingClientRect();
      const despues = e.clientY > r.top + r.height / 2;
      limpiarMarcas();
      fila.classList.add(despues ? 'soltar-despues' : 'soltar-antes');
    });
    fila.addEventListener('dragleave', () => fila.classList.remove('soltar-antes', 'soltar-despues'));
    fila.addEventListener('drop', (e) => {
      if (!arrastrada || arrastrada.cat !== cat) return;
      e.preventDefault();
      e.stopPropagation();
      const despues = fila.classList.contains('soltar-despues');
      const que = arrastrada;
      limpiarMarcas();
      if (que.id !== id) mover(cat, que.id, id, despues);
    });
    // Con el teclado: Alt + ↑ / ↓ sube o baja la fila un puesto (entre las que se ven).
    fila.querySelector('.fila-abrir').addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      e.stopPropagation();
      const vecinas = [...filas.querySelectorAll(`.fila-recurso[data-cat="${cat}"]`)].filter((x) => cat !== 'opciones' || grupoDe(x.dataset.id) === grupoDe(id));
      const i = vecinas.findIndex((x) => x.dataset.id === id);
      const otra = vecinas[e.key === 'ArrowUp' ? i - 1 : i + 1];
      if (otra) mover(cat, id, otra.dataset.id, e.key === 'ArrowDown');
    });
  }

  function fila(cat, id, errores, { nivel = 1, extra = null } = {}) {
    const k = clave(cat, id);
    const p = pestana(k);
    const d = p ? p.borrador : E.campana.recursos[cat][id];
    const nombre = nombreVisible(cat, id);
    const img = d?.imagen ? urlAsset(d.imagen) : '';
    const muestra = cat === 'tiles' ? h('span', { class: 'fila-muestra', style: { background: d?.color || 'var(--panel-3)' } })
      : img ? h('img', { class: 'fila-muestra', src: img, alt: '', onerror: (e) => e.currentTarget.replaceWith(h('span', { class: 'fila-muestra' })) })
        : null;
    const txt = resumen(cat, d);
    const el_ = h('div', { class: `fila-recurso nivel-${nivel}${E.activa === k ? ' activa' : ''}`, role: 'listitem', 'data-clave': k, 'data-cat': cat, 'data-id': id },
      h('span', { class: 'fila-asa', 'aria-hidden': 'true', title: 'Arrastra arriba o abajo para cambiar el orden' }, '⠿'),
      h('button', { type: 'button', class: 'fila-abrir', onclick: () => irA(cat, id), title: `Abrir ${nombre} (Alt + ↑ / ↓ para moverlo)` },
        muestra,
        h('span', { class: 'fila-textos' }, h('span', { class: 'fila-nombre' }, nombre), txt ? h('span', { class: 'fila-resumen' }, txt) : null),
        p && sucia(p) ? h('span', { class: 'punto punto-sucio', title: 'Cambios sin guardar' }) : null,
        errores.has(k) ? h('span', { class: 'punto punto-error', title: 'Tiene problemas' }) : null),
      extra,
      h('button', { type: 'button', class: 'fila-quitar', 'data-accion': 'quitar', title: `Eliminar ${nombre}`, 'aria-label': `Eliminar ${nombre}`, onclick: () => quitar(cat, id) }, '✕'));
    hacerArrastrable(el_, cat, id);
    return el_;
  }

  function pintarGrupos(errores) {
    const grupos = ordenada('grupos');
    const opciones = ordenada('opciones');
    const out = [];
    for (const g of grupos) {
      const ops = opciones.filter((o) => o.datos?.grupo === g.id);
      const visibles = ops.filter((o) => coincide(nombreVisible('opciones', o.id)));
      if (filtro && !visibles.length && !coincide(nombreVisible('grupos', g.id))) continue;
      const masOpcion = h('button', { type: 'button', class: 'fila-mas', 'data-accion': 'nueva-opcion', title: `Nueva opción en ${nombreVisible('grupos', g.id)}`, 'aria-label': `Nueva opción en ${nombreVisible('grupos', g.id)}`,
        onclick: () => crear('opciones', { grupo: g.id }) }, '＋');
      out.push(fila('grupos', g.id, errores, { extra: masOpcion }));
      out.push(...(filtro ? visibles : ops).map((o) => fila('opciones', o.id, errores, { nivel: 2 })));
      if (!ops.length && !filtro) out.push(h('p', { class: 'vacio nivel-2' }, 'Sin opciones todavía: pulsa ＋ en el grupo.'));
    }
    const huerfanas = opciones.filter((o) => !grupos.some((g) => g.id === o.datos?.grupo) && coincide(nombreVisible('opciones', o.id)));
    if (huerfanas.length) out.push(h('div', { class: 'lista-subtitulo' }, '⚠️ Opciones sin grupo'), ...huerfanas.map((o) => fila('opciones', o.id, errores, { nivel: 2 })));
    cuenta.textContent = grupos.length;
    return out.length ? out : [h('p', { class: 'vacio' }, filtro ? 'Nada coincide.' : 'Crea un grupo (Raza, Clase…) con el botón ＋.')];
  }

  // NPC por categorías (Aliados, Enemigos…): cada una se pliega por su cuenta y se recuerda en este equipo.
  const CLAVE_PLEGADAS = 'editor.categoriasNpcPlegadas';
  const plegadas = (() => { try { return new Set(JSON.parse(localStorage.getItem(CLAVE_PLEGADAS) || '[]')); } catch { return new Set(); } })();
  const guardarPlegadas = () => { try { localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify([...plegadas].slice(-200))); } catch { /* sin almacenamiento */ } };
  // Soltar un NPC sobre la cabecera de una categoría (o sobre «Nueva categoría» / «Sin categoría») lo cambia de categoría y se guarda al momento.
  const soltarEnCategoria = (el_, alSoltar) => {
    el_.addEventListener('dragover', (e) => { if (arrastrada?.cat === 'enemigos') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el_.classList.add('soltar-aqui'); } });
    el_.addEventListener('dragleave', () => el_.classList.remove('soltar-aqui'));
    el_.addEventListener('drop', async (e) => {
      el_.classList.remove('soltar-aqui');
      if (arrastrada?.cat !== 'enemigos') return;
      const id = arrastrada.id;
      e.preventDefault();
      try {
        const c = await alSoltar();
        if (c === null) return;
        if (await cambiarCategoriaNpc(id, c)) toast(c ? `«${nombreVisible('enemigos', id)}» ahora está en «${c}».` : `«${nombreVisible('enemigos', id)}» ya no tiene categoría.`, 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
    return el_;
  };
  const zonaNueva = () => soltarEnCategoria(h('div', { class: 'zona-categoria-nueva', 'data-accion': 'nueva-categoria-npc' }, '＋ Arrastra aquí un NPC para crear una categoría nueva'),
    () => pedirTexto('Nueva categoría', 'Nombre de la categoría', '', { ayuda: 'Por ejemplo: Aliados, Enemigos, Jefes, Tienda…', si: 'Crear' }).then((t) => (t ? t : null)));
  function pintarNpc(errores, items) {
    const porCat = new Map();
    for (const i of items) {
      const c = categoriaNpc(i.id);
      const k = [...porCat.keys()].find((x) => x.toLowerCase() === c.toLowerCase()) ?? c;     // «aliados» y «Aliados» van juntos
      if (!porCat.has(k)) porCat.set(k, []);
      porCat.get(k).push(i);
    }
    if (porCat.size === 1 && porCat.has('')) return [...items.map((i) => fila('enemigos', i.id, errores)), ...(filtro ? [] : [zonaNueva()])];     // sin categorías: la lista de siempre
    const nombres = [...porCat.keys()].sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return nombres.flatMap((c) => {
      const k = c.toLowerCase();
      const plegada = !filtro && plegadas.has(k);
      const cab = h('button', { type: 'button', class: 'lista-subtitulo lista-categoria', 'aria-expanded': String(!plegada), 'data-categoria-npc': c || '(sin categoría)',
        title: plegada ? 'Desplegar' : 'Plegar', onclick: () => { if (plegadas.has(k)) plegadas.delete(k); else plegadas.add(k); guardarPlegadas(); pintar(); } },
      h('span', { class: 'flecha', 'aria-hidden': 'true' }, plegada ? '▸' : '▾'), ` ${c || 'Sin categoría'} `, h('span', { class: 'cuenta' }, porCat.get(c).length));
      soltarEnCategoria(cab, async () => c);
      return [cab, ...(plegada ? [] : porCat.get(c).map((i) => fila('enemigos', i.id, errores, { nivel: 2 })))];
    }).concat(filtro ? [] : [...(porCat.has('') ? [] : [soltarEnCategoria(h('div', { class: 'zona-categoria-nueva zona-sin-categoria' }, 'Arrastra aquí para quitarle la categoría'), async () => '')]), zonaNueva()]);
  }

  function pintar() {
    if (!E.campana) return;
    ordenar.value = modo();
    ayudaOrden.hidden = modo() !== 'personalizado';
    const errores = conErrores();
    if (esGrupos) { filas.replaceChildren(...pintarGrupos(errores)); return; }
    if (vista === 'enemigos') {
      const todosNpc = ordenada(vista);
      cuenta.textContent = todosNpc.length;
      const itemsNpc = todosNpc.filter((i) => coincide(nombreVisible(vista, i.id)) || coincide(i.datos?.categoria || ''));
      filas.replaceChildren(...(itemsNpc.length ? pintarNpc(errores, itemsNpc) : [h('p', { class: 'vacio' }, filtro ? 'Nada coincide.' : 'Aún no hay NPC. Pulsa ＋ para crear el primero.')]));
      return;
    }
    const todos = ordenada(vista);
    cuenta.textContent = todos.length;
    const items = todos.filter((i) => coincide(nombreVisible(vista, i.id)));
    filas.replaceChildren(...(items.length ? items.map((i) => fila(vista, i.id, errores))
      : [h('p', { class: 'vacio' }, filtro ? 'Nada coincide.' : `Aún no hay ${def.plural.toLowerCase()}. Pulsa ＋ para crear ${def.genero === 'f' ? 'la primera' : 'el primero'}.`)]));
  }

  // Al escribir en la ficha («cambio» en cada tecla) la lista se repinta una sola vez al parar: con miles de filas, repintarla en cada tecla era lo que más pesaba.
  const pintarEnCalma = enCalma(() => { if (el.isConnected) pintar(); });
  const bajas = ['campana-cambiada', 'pestanas', 'guardado', 'problemas', 'restaurado', 'assets', 'orden'].map((ev) => bus.on(ev, pintar)).concat(bus.on('cambio', pintarEnCalma));
  pintar();
  return { el, pintar, destruir: () => bajas.forEach((f) => f()) };
}
