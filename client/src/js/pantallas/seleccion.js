// pantallas/seleccion.js — Elegir personaje o crear uno nuevo. Los personajes pertenecen al servidor.
import { h, sinSaltoDeScroll } from '../util.js';
import { S, bus, gruposEstadisticas } from '../almacen.js';
import { red } from '../red.js';
import { retrato } from '../retrato.js';
import { camposFicha, controlCampo } from '../campos-ficha.js';
import { urlLocal, importarImagen, hayAlmacen } from '../archivos.js';
import { elegirImagen } from '../galeria.js';

/** Pantalla de elegir o crear personaje. Con `enPartida` es solo el creador, dentro de una ventana sobre la partida («Crear ficha nueva»):
 *  al crear o cancelar llama a `alTerminar(id del nuevo | null)` y no cambia de pantalla. */
export function crearSeleccion({ alEntrarSinPersonaje, enPartida = false, alTerminar = () => {} } = {}) {
  // Sin personajes se abre el creador automáticamente; el GM empieza en la lista porque puede dirigir sin personaje,
  // y también el jugador si la mesa deja entrar sin ficha (el GM le asignará personajes o NPC).
  const sinFicha = S.esGM || !!S.permisos.sin_ficha;
  let modo = enPartida ? 'crear' : S.personajes.length || sinFicha || !S.permisos.crear_personajes ? 'lista' : 'crear';
  let eraPrimero = S.personajes.length === 0;
  const el = h('div', { class: 'pantalla-centrada' });
  const offs = [];

  const entrar = (id) => red.enviar({ tipo: 'elegir_personaje', personaje: id });

  function lista() {
    const vida = S.catalogo.recurso_vida;
    const tarjetas = S.personajes.map((p) => {
      const v = p.recursos[vida];
      const origen = Object.entries(p.elecciones || {}).map(([, o]) => S.catalogo.opciones?.[o]?.nombre || o).join(' · ') || 'Aventurero';
      return h('article', { class: 'tarjeta-personaje', 'data-personaje': p.id }, retrato(p.imagen, p.nombre, 'retrato retrato-propio'),
        h('div', { class: 'tarjeta-texto' }, h('h3', null, p.nombre),
          h('p', { class: 'tenue' }, `${origen}, ${vida} ${v.actual}/${v.max}`)),
        h('button', { class: 'btn btn-acento', onclick: () => entrar(p.id) }, 'Jugar'));
    });
    const puedeCrear = S.permisos.crear_personajes;
    return h('div', { class: 'tarjeta-ancha' },
      h('h1', { class: 'titulo-seccion' }, 'Elige tu personaje'),
      S.personajes.length ? h('div', { class: 'rejilla-personajes' }, tarjetas)
        : h('p', { class: 'tenue' }, !S.esGM && S.permisos.sin_ficha ? `Todavía no tienes personajes. Puedes entrar sin ninguno: el GM te asignará uno (o un NPC) en la partida${puedeCrear ? ', o créate uno ahora' : ''}.`
          : puedeCrear ? 'Todavía no tienes personajes.' : 'No tienes personajes y este servidor no permite crearlos. Pide al GM que te los prepare.'),
      h('div', { class: 'fila-botones' },
        puedeCrear ? h('button', { class: 'btn', onclick: () => { borrador.elecciones = null; modo = 'crear'; pintar(); } }, 'Crear personaje nuevo') : null,
        sinFicha ? h('button', { class: `btn ${S.personajes.length || S.esGM ? 'btn-suave' : 'btn-acento'}`, 'data-accion': 'entrar-sin-personaje', onclick: alEntrarSinPersonaje }, 'Entrar sin personaje') : null,
        h('button', { class: 'btn btn-suave', onclick: () => red.cerrar() }, 'Desconectar')));
  }

  // Lo que el jugador va escribiendo se conserva aunque la pantalla se redibuje al cambiar de opción.
  const borrador = { nombre: '', historia: '', elecciones: null, reparto: {}, imagen: '', imagen_biografia: '', campos: {} };

  const iniciarBorrador = () => { borrador.elecciones = {}; borrador.reparto = {}; };

  const bonosDe = (elecciones) => {
    const total = {};
    for (const o of Object.values(elecciones)) for (const [k, v] of Object.entries(S.catalogo.opciones?.[o]?.bonos || {})) total[k] = (total[k] || 0) + v;
    return total;
  };
  // Lo que aportan las opciones elegidas (la clase puede añadir estadísticas, cambiar su valor inicial o dar puntos extra).
  const opcionesElegidas = (elecciones) => Object.entries(S.catalogo.grupos || {}).map(([g]) => S.catalogo.opciones?.[elecciones[g]]).filter(Boolean);
  const valoresIniciales = (elecciones) => {
    const res = {};
    const ids = new Set(Object.values(elecciones || {}));
    for (const e of S.catalogo.estadisticas) if (e.para_todos !== false || (e.solo_para || []).some((o) => ids.has(o))) res[e.nombre] = e.valor_inicial;
    for (const o of opcionesElegidas(elecciones)) Object.assign(res, o.estadisticas || {});
    return res;
  };
  const puntosTotales = (elecciones) => (S.catalogo.puntos_a_repartir || 0) + opcionesElegidas(elecciones).reduce((a, o) => a + (o.puntos_extra || 0), 0);
  const textoExtras = (o) => [
    Object.keys(o.estadisticas || {}).length ? `Empieza con ${Object.entries(o.estadisticas).map(([k, v]) => `${k} ${v}`).join(', ')}` : '',
    Object.keys(o.recursos || {}).length ? `Recursos: ${Object.entries(o.recursos).map(([k, v]) => `${k} ${v}`).join(', ')}` : '',
    o.puntos_extra ? `+${o.puntos_extra} puntos para repartir` : ''].filter(Boolean).join(' · ');
  const textoBonos = (bonos) => Object.entries(bonos).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');

  /** Selector de imagen: vista previa + elegir entre las que ya hay en la carpeta del cliente (base/tokens) o traer una nueva. */
  function selectorImagen(clave, titulo, ayuda) {
    const vista = h('div', { class: 'imagen-vista', 'data-imagen': clave });
    const ruta = borrador[clave];
    const url = ruta ? urlLocal(ruta) : null;
    if (url) vista.append(h('img', { src: url, alt: titulo })); else vista.append(h('span', { class: 'tenue pequeno' }, 'Sin imagen'));
    // «Elegir una que ya tengo…» abre la galería con miniaturas (las del .zip de la campaña, también en subcarpetas, y las propias).
    const lista = h('button', { type: 'button', class: 'btn', 'data-accion': `imagen-${clave}`, onclick: async () => {
      const r = await elegirImagen({ actual: borrador[clave] || '', titulo });
      if (r !== null) { borrador[clave] = r; pintar(); }
    } }, '🖼️ Elegir una que ya tengo…');
    const nueva = h('button', { type: 'button', class: 'btn btn-suave', 'data-accion': `importar-${clave}`, onclick: async () => {
      try { const n = await importarImagen(); if (n) { borrador[clave] = `tokens/${n}`; pintar(); } }
      catch (e) { error.textContent = e.message; error.hidden = false; }
    } }, 'Traer una imagen…');
    return h('div', { class: 'campo selector-imagen' }, h('label', null, titulo), vista,
      h('div', { class: 'fila-botones' }, hayAlmacen ? [lista, nueva] : h('span', { class: 'tenue pequeno' }, 'Solo disponible en la aplicación de escritorio.'),
        ruta ? h('button', { type: 'button', class: 'btn btn-suave', onclick: () => { borrador[clave] = ''; pintar(); } }, 'Quitar') : null),
      h('p', { class: 'tenue pequeno' }, ayuda));
  }

  let error = null;
  function crear() {
    if (!borrador.elecciones) iniciarBorrador();
    const nombre = h('input', { type: 'text', maxlength: '30', placeholder: 'Nombre de tu personaje', id: 'f-nombre-pj', value: borrador.nombre });
    const historia = h('textarea', { rows: '4', maxlength: '20000', placeholder: 'Su pasado, su carácter… (opcional)', id: 'f-historia' });
    historia.value = borrador.historia;
    nombre.addEventListener('input', () => { borrador.nombre = nombre.value; });
    historia.addEventListener('input', () => { borrador.historia = historia.value; });
    error = h('p', { class: 'error', role: 'alert', hidden: true });

    // Grupos de elección definidos por la campaña (raza, clase, origen…)
    // «Solo aparece si…»: un grupo puede depender de lo elegido en otro (p. ej. «Escuela de magia» solo para los magos).
    const activo = (g, n = 0) => { const si = S.catalogo.grupos?.[g]?.solo_si; return !si || (n < 10 && si.opciones.includes(borrador.elecciones[si.grupo]) && activo(si.grupo, n + 1)); };
    for (const g of Object.keys(borrador.elecciones)) if (!activo(g)) delete borrador.elecciones[g];      // lo que ya no corresponde se olvida
    const elegible = (o) => S.esGM || o.elegible !== false;           // las que solo se alcanzan transformándose no salen al crear
    const grupos = Object.entries(S.catalogo.grupos || {}).filter(([g]) => activo(g) && Object.values(S.catalogo.opciones || {}).some((o) => o.grupo === g && elegible(o)));
    const bloquesGrupo = grupos.map(([g, gd]) => {
      const opciones = Object.entries(S.catalogo.opciones).filter(([, o]) => o.grupo === g && elegible(o));
      const actual = borrador.elecciones[g];
      const pulsar = (id) => { if (id) borrador.elecciones[g] = id; else delete borrador.elecciones[g]; pintar(); };
      const detalle = actual ? S.catalogo.opciones[actual] : null;
      return h('div', { class: 'grupo-eleccion' },
        h('h4', { class: 'sub' }, `${gd.nombre}${gd.obligatorio ? '' : ' (opcional)'}`),
        h('div', { class: 'rejilla-plantillas' },
          !gd.obligatorio ? h('button', { type: 'button', class: `plantilla${!actual ? ' elegida' : ''}`, 'aria-pressed': String(!actual), onclick: () => pulsar(null) },
            h('strong', null, 'Ninguna')) : null,
          opciones.map(([id, o]) => h('button', { type: 'button', class: `plantilla${id === actual ? ' elegida' : ''}`, 'aria-pressed': String(id === actual),
            onclick: () => pulsar(id) }, h('strong', null, o.nombre),
            h('span', { class: 'tenue' }, [o.descripcion, textoBonos(o.bonos), textoExtras(o)].filter(Boolean).join(' · '))))),
        detalle && (detalle.rasgos.length || detalle.habilidades.length) ? h('p', { class: 'tenue pequeno' },
          detalle.rasgos.length ? `Rasgos: ${detalle.rasgos.map((r) => S.catalogo.rasgos[r]?.nombre || r).join(', ')}. ` : '',
          detalle.habilidades.length ? `Habilidades: ${detalle.habilidades.map((r) => S.catalogo.habilidades[r]?.nombre || r).join(', ')}.` : '') : null);
    });

    // Reparto de puntos de estadística (solo si la campaña lo permite a los jugadores)
    const total = puntosTotales(borrador.elecciones);
    const iniciales = valoresIniciales(borrador.elecciones);
    // Si al cambiar de clase se pierde una estadística o se reducen los puntos, se descarta el reparto que ya no encaja.
    for (const k of Object.keys(borrador.reparto)) if (!(k in iniciales)) delete borrador.reparto[k];
    while (Object.values(borrador.reparto).reduce((a, b) => a + b, 0) > total) {
      const k = Object.keys(borrador.reparto).pop();
      if (--borrador.reparto[k] <= 0) delete borrador.reparto[k];
    }
    const gastados = Object.values(borrador.reparto).reduce((a, b) => a + b, 0);
    const libres = total - gastados;
    const puedeRepartir = total > 0;       // al crear, cada jugador reparte sus puntos
    const bonos = bonosDe(borrador.elecciones);
    const inicial = (e) => iniciales[e.nombre];
    const cambiar = (nombreStat, d) => {
      const e = S.catalogo.estadisticas.find((x) => x.nombre === nombreStat);
      const nuevo = (borrador.reparto[nombreStat] || 0) + d;
      if (nuevo < 0 || (d > 0 && (libres <= 0 || (inicial(e) + nuevo) > e.maximo))) return;
      if (nuevo === 0) delete borrador.reparto[nombreStat]; else borrador.reparto[nombreStat] = nuevo;
      pintar();
    };
    const filaStat = (e) => {
      const rep = borrador.reparto[e.nombre] || 0;
      const bono = bonos[e.nombre] || 0;
      const valor = inicial(e) + rep + bono;
      return h('div', { class: 'fila-stat' },
        h('span', { class: 'fila-stat-nombre', title: e.descripcion || '' }, e.nombre),
        puedeRepartir && e.repartible !== false ? h('span', { class: 'mini-botones' },
          h('button', { type: 'button', class: 'btn btn-mini', 'aria-label': `Quitar un punto de ${e.nombre}`, disabled: rep === 0, onclick: () => cambiar(e.nombre, -1) }, '−'),
          h('button', { type: 'button', class: 'btn btn-mini', 'aria-label': `Añadir un punto a ${e.nombre}`, disabled: libres <= 0, onclick: () => cambiar(e.nombre, 1) }, '+')) : h('span'),
        e.formula ? h('span', { class: 'tenue', title: e.formula }, 'se calcula sola') : h('strong', null, String(valor)),
        h('span', { class: 'tenue pequeno' }, [rep ? `+${rep} puntos` : '', bono ? `${bono > 0 ? '+' : ''}${bono} por tus elecciones` : ''].filter(Boolean).join(', ')));
    };
    const filasStats = gruposEstadisticas(S.catalogo.estadisticas.filter((e) => e.nombre in iniciales))
      .flatMap(([cat, lst]) => [cat ? h('h5', { class: 'stats-categoria' }, cat) : null, ...lst.map(filaStat)]).filter(Boolean);
    const bloqueStats = h('div', { class: 'resumen-plantilla' },
      h('h4', { class: 'sub' }, total > 0 ? (puedeRepartir ? `Estadísticas — te quedan ${libres} de ${total} puntos por repartir` : 'Estadísticas') : 'Estadísticas'),
      h('div', { class: 'stats-reparto' }, filasStats),
      total > 0 && libres > 0 ? h('p', { class: 'tenue pequeno' }, 'Los puntos que no gastes ahora quedan pendientes en tu personaje.') : null);

    const enviar = () => {
      if (!nombre.value.trim()) { error.textContent = 'Escribe un nombre para tu personaje.'; error.hidden = false; nombre.focus(); return; }
      error.hidden = true;
      red.enviar({ tipo: 'crear_personaje', nombre: nombre.value.trim(), historia: historia.value,
        ...(borrador.imagen ? { imagen: borrador.imagen } : {}), ...(borrador.imagen_biografia ? { imagen_biografia: borrador.imagen_biografia } : {}),
        elecciones: borrador.elecciones, ...(Object.keys(borrador.reparto).length ? { reparto: borrador.reparto } : {}),
        ...(Object.keys(borrador.campos).length ? { campos: borrador.campos } : {}) });
    };
    nombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
    // El nombre se enfoca solo al abrir la creación, no en cada repintado (si no, la pantalla saltaba arriba al elegir algo abajo)
    if (!nombreEnfocado) { nombreEnfocado = true; setTimeout(() => { if (!borrador.nombre) nombre.focus({ preventScroll: true }); }, 0); }

    return h('div', { class: 'tarjeta-ancha' },
      h('h1', { class: 'titulo-seccion' }, 'Crea tu personaje'),
      bloquesGrupo, bloqueStats,
      h('div', { class: 'campo' }, h('label', { for: 'f-nombre-pj' }, 'Nombre'), nombre),
      selectorImagen('imagen', 'Imagen del token', 'Es la que se ve en el mapa. Los demás jugadores la verán solo si tienen el mismo archivo en su carpeta.'),
      h('div', { class: 'campo' }, h('label', { for: 'f-historia' }, 'Historia'), historia),
      (() => {
        const defs = camposFicha().filter((c) => c.quien !== 'gm' || S.esGM);
        if (!defs.length) return null;
        return h('div', { class: 'campo campos-creacion' }, h('label', null, 'Datos de la ficha'),
          h('dl', { class: 'campos-ficha' }, defs.flatMap((c) => [h('dt', { title: c.descripcion || '' }, c.nombre),
            h('dd', null, controlCampo(c, borrador.campos[c.nombre], (v) => { if (v === null) delete borrador.campos[c.nombre]; else borrador.campos[c.nombre] = v; }))])));
      })(),
      selectorImagen('imagen_biografia', 'Imagen de la biografía', 'Un retrato o ilustración para tu ficha (opcional).'), error,
      h('div', { class: 'fila-botones' },
        h('button', { class: 'btn btn-acento', onclick: enviar }, 'Crear personaje'),
        enPartida ? h('button', { class: 'btn btn-suave', 'data-accion': 'cancelar-ficha', onclick: () => alTerminar(null) }, 'Cancelar') : null,
        enPartida ? null : S.personajes.length || sinFicha ? h('button', { class: 'btn btn-suave', onclick: () => { modo = 'lista'; nombreEnfocado = false; pintar(); } }, 'Volver') : null,
        !enPartida && !S.personajes.length && !sinFicha ? h('button', { class: 'btn btn-suave', onclick: () => red.cerrar() }, 'Desconectar') : null));
  }

  let nombreEnfocado = false;
  function pintar() { sinSaltoDeScroll(el, () => el.replaceChildren(modo === 'lista' ? lista() : crear())); }

  offs.push(bus.on('personajes', (creado) => {
    if (enPartida) { if (creado) alTerminar(creado); return; }                    // dentro de la partida: se cierra la ventana y sigue el juego
    if (creado && eraPrimero) { eraPrimero = false; entrar(creado); return; }   // primer personaje: entrar directamente
    borrador.campos = {}; borrador.nombre = ''; borrador.historia = ''; borrador.elecciones = null; borrador.imagen = ''; borrador.imagen_biografia = '';
    modo = 'lista';
    pintar();
  }));
  offs.push(bus.on('error-servidor', (texto) => {
    const e = el.querySelector('.error');
    if (e) { e.textContent = texto; e.hidden = false; }
  }));
  pintar();
  return { el, destruir: () => offs.forEach((f) => f()) };
}
