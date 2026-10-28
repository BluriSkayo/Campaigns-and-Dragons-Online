// ventanas/personaje.js — Ficha del token seleccionado (por defecto, tu personaje).
// Solo muestra lo que el servidor permite ver de cada token (la vida siempre; lo demás según las reglas de la mesa y lo que el GM revele).
// Los datos se organizan en pestañas: Resumen, Habilidades, Inventario, Historia (y Visibilidad para el GM).
import { h } from '../util.js';
import { urlLocal } from '../archivos.js';
import { bloqueCampos } from '../campos-ficha.js';
import { S, tokenFoco, esMio, puedoControlar, vidaDe, bandoDe, quienEs, palabra, gruposEstadisticas } from '../almacen.js';
import { abrirVentana } from '../ventanas.js';
import { cambiarPersonaje, desplegarPersonaje, retirarPersonaje, exportarPersonaje } from '../acciones.js';
import { hayAlmacen } from '../archivos.js';
import { retrato, filaTexto } from '../retrato.js';
import { red } from '../red.js';
import { listaInventario } from './inventario.js';
import { tarjetaHabilidad } from './habilidad-info.js';
import { destinosTransformacion, hayTransformaciones, abrirTransformar } from './elegir.js';

function barra(nombre, descripcion, r, clase = '') {
  const f = r.max > 0 ? Math.max(0, Math.min(1, r.actual / r.max)) : 0;
  return h('div', { class: `recurso ${clase}`, title: descripcion || nombre },
    h('div', { class: 'recurso-cab' }, h('span', null, nombre), h('span', { class: 'recurso-num' }, `${r.actual} / ${r.max}`)),
    h('div', { class: 'recurso-pista' }, h('div', { class: 'recurso-relleno', style: { width: `${f * 100}%` } })));
}

const retratoDe = (t) => retrato(t.imagen, t.nombre, `retrato retrato-${t.tipo === 'enemigo' ? bandoDe(t) : esMio(t) ? 'propio' : 'aliado'}`);

function listaEstados(t) {
  if (!t.estados?.length) return null;
  return [h('h4', { class: 'sub' }, palabra('estados', 'Estados')),
    h('ul', { class: 'lista-acciones' }, t.estados.map((e) => {
      const def = S.catalogo.estados?.[e.id];
      return h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, h('strong', null, def?.nombre || e.id, e.cargas > 1 ? h('span', { class: 'cantidad', 'data-cargas': String(e.cargas) }, ` ×${e.cargas}`) : null),
        h('span', { class: 'tenue pequeno' }, [def?.descripcion, e.turnos > 0 ? `${e.turnos} ${e.turnos === 1 ? 'turno' : 'turnos'} restantes` : 'Hasta que se quite'].filter(Boolean).join(' · '))));
    }))];
}

function contenido(tokenId, entrada, v) {
  const t = tokenId ? S.tokens.get(tokenId) : tokenFoco();
  if (!t && entrada) {
    return h('div', { class: 'vacio' },
      h('p', null, `${entrada.nombre} no está en el mapa.`),
      h('button', { class: 'btn btn-acento', onclick: () => desplegarPersonaje(entrada.id, entrada.dueno) }, 'Desplegar'));
  }
  if (!t) {
    const fuera = S.personajes.filter((p) => ![...S.tokens.values()].some((k) => k.personaje === p.id && k.dueno === S.usuario));
    if (!S.esGM && fuera.length) {
      return h('div', { class: 'vacio' },
        h('p', null, 'Tu personaje no está en el mapa.'),
        h('ul', { class: 'lista-acciones' }, fuera.map((p) => h('li', { class: 'fila-accion' },
          h('div', { class: 'fila-texto' }, h('strong', null, p.nombre)),
          h('button', { class: 'btn btn-acento', onclick: () => desplegarPersonaje(p.id) }, 'Desplegar')))));
    }
    return h('div', { class: 'vacio' },
      h('p', null, 'No hay ningún token seleccionado.'),
      h('p', { class: 'tenue' }, 'Haz clic en un token del mapa para ver su ficha.'));
  }
  const cat = S.catalogo;
  const mio = esMio(t);

  const cab = h('div', { class: 'ficha-cab' }, retratoDe(t),
    h('div', null, h('h3', { class: 'ficha-nombre' }, t.nombre),
      h('p', { class: 'tenue' }, quienEs(t), t.nivel ? h('span', { class: 'ficha-nivel', 'data-nivel': String(t.nivel) }, ` · Nivel ${t.nivel}`) : null)));

  if (!mio && !S.esGM && !t.stats && !t.habilidades && !t.inventario && !t.elecciones && Object.keys(t.recursos || {}).length <= 1) {
    const vida = vidaDe(t);
    return h('div', { class: 'ficha' }, cab, vida ? barra(cat.recurso_vida, '', vida) : null,
      h('p', { class: 'tenue' }, t.derrotado ? 'Ha sido derrotado.' : 'No puedes ver más datos de este token.'), listaEstados(t));
  }

  const recursos = cat.recursos.map((r) => (t.recursos[r.nombre] ? barra(r.nombre, r.descripcion, t.recursos[r.nombre],
    r.nombre === cat.recurso_vida ? 'vida' : 'otro') : null));
  const editable = !!S.permisos.editar_fichas;                // el propietario puede bloquear la edición de un jugador
  const puedeRepartir = mio && editable && (t.puntos_pendientes || 0) > 0 && S.permisos.repartir_puntos;
  const filaStat = (e) => {
    const bono = t.bonos?.[e.nombre] || 0;
    return [h('dt', { title: e.descripcion || '' }, e.nombre),
      h('dd', { title: bono ? `Base ${t.stats_base?.[e.nombre]} ${bono > 0 ? '+' : '−'} ${Math.abs(bono)} por raza, clase, rasgos o estados` : '' },
        String(t.stats[e.nombre] ?? '—'),
        e.escalones?.length ? h('span', { class: 'tenue pequeno', 'data-rango': e.nombre, title: 'Rango según su valor' }, ` · Rango ${1 + e.escalones.filter((u) => (t.stats[e.nombre] ?? 0) >= u).length}`) : null,
        bono ? h('span', { class: `bono ${bono > 0 ? 'positivo' : 'negativo'}` }, ` (${bono > 0 ? '+' : ''}${bono})`) : null,
        puedeRepartir && e.repartible !== false ? h('button', { class: 'btn btn-mini', 'aria-label': `Añadir un punto a ${e.nombre}`,
          onclick: () => red.enviar({ tipo: 'repartir_puntos', personaje: t.personaje, reparto: { [e.nombre]: 1 } }) }, '+') : null)];
  };
  const stats = t.stats ? gruposEstadisticas(cat.estadisticas.filter((e) => e.nombre in t.stats))
    .flatMap(([c, lst]) => [c ? h('h5', { class: 'stats-categoria' }, c) : null, h('dl', { class: 'stats' }, lst.map(filaStat))]).filter(Boolean) : null;
  const puntos = (t.puntos_pendientes || 0) > 0
    ? h('p', { class: 'tenue pequeno' }, `Puntos de estadística pendientes: ${t.puntos_pendientes}. ${S.permisos.repartir_puntos && mio && editable ? 'Pulsa + para repartirlos.' : 'Los reparte el GM.'}`) : null;
  // Nivel y experiencia (si la campaña usa niveles): barra hasta el siguiente nivel y cuánto aporta cada tipo
  const xp = t.experiencia;
  const nivelBloque = t.nivel && t.tipo === 'personaje' ? h('div', { class: 'nivel-bloque' },
    xp && xp.siguiente != null ? [
      h('div', { class: 'nivel-barra', title: `${xp.total} de ${xp.siguiente} para el nivel ${t.nivel + 1}` },
        h('span', { style: { width: `${Math.max(0, Math.min(100, ((xp.total - xp.anterior) / Math.max(1, xp.siguiente - xp.anterior)) * 100))}%` } })),
      h('p', { class: 'tenue pequeno', 'data-experiencia': String(xp.total) }, `Experiencia: ${xp.total} / ${xp.siguiente} para el nivel ${t.nivel + 1}`
        + (Object.keys(xp.por_tipo).length > 1 ? ` (${Object.entries(xp.por_tipo).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''))]
      : xp && xp.siguiente == null && Object.keys(xp.por_tipo).length ? h('p', { class: 'tenue pequeno', 'data-experiencia': String(xp.total) }, `Experiencia: ${xp.total}`
        + (cat.niveles?.modo === 'manual' ? (Object.keys(xp.por_tipo).length > 1 ? ` (${Object.entries(xp.por_tipo).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nada todavía'})` : '') : ' (nivel máximo)')) : null,
    S.esGM && t.personaje ? h('button', { class: 'btn btn-mini', 'data-accion': 'subir-nivel', title: 'Sube un nivel ahora (da lo que dé ese nivel)',
      onclick: () => red.enviar({ tipo: 'gm_subir_nivel', usuario: t.dueno, personaje: t.personaje }) }, '⬆️ Subir de nivel') : null) : null;
  const elecciones = Object.entries(t.elecciones || {}).map(([g, o]) => [cat.grupos?.[g]?.nombre || g, cat.opciones?.[o]?.nombre || o]);
  // Etiquetas (tipo, elemento…) con el color que les dio la campaña
  const chipsEtiquetas = (lista) => (lista?.length ? h('span', { class: 'etiquetas' }, lista.map((n) => {
    const e = (cat.etiquetas || []).find((x) => x.nombre === n);
    return h('span', { class: 'chip-etiqueta', 'data-etiqueta': n, title: e?.descripcion || n, style: e?.color ? { borderColor: e.color } : null }, n);
  })) : null);
  const rasgos = (t.rasgos || []).map((r) => cat.rasgos?.[r]).filter(Boolean);

  // Formas y evoluciones: se ve la forma actual de cada grupo y un solo botón abre la ventana para elegir otra
  // (el GM siempre; el jugador, si la mesa lo permite).
  const formas = destinosTransformacion(t).map(({ g, grupo, actual }) => h('div', { class: 'formas', 'data-grupo': g },
    h('span', { class: 'tenue pequeno' }, `${grupo.nombre}: `), h('strong', null, cat.opciones[actual]?.nombre || actual)));
  if (formas.length && hayTransformaciones(t)) {
    formas.push(h('button', { class: 'btn btn-mini', 'data-accion': 'transformar', title: 'Elegir otra forma', onclick: () => abrirTransformar(t.id) }, '✨ Transformar…'));
  }

  const puede = puedoControlar(t) && !t.derrotado;
  const habilidades = (t.habilidades || []).map((id) => {
    const hab = cat.habilidades[id];
    if (!hab) return null;
    return tarjetaHabilidad(id, t.id, puede);          // icono, nombre y coste; «Info» abre el dibujo del área y los datos
  });

  // Rasgos de personalidad (Maldito, Maniático…): los edita el jugador solo si el GM lo permite.
  const pers = t.personalidad || [];
  const puedeEditarPers = mio && editable && !!S.permisos.editar_personalidad && !!t.personaje;
  const enviarPers = (lista) => red.enviar({ tipo: 'editar_personalidad', personaje: t.personaje, rasgos: lista });
  const nuevoRasgo = h('input', { type: 'text', maxlength: '30', placeholder: 'Nuevo rasgo…', 'aria-label': 'Nuevo rasgo de personalidad' });
  const anadirRasgo = () => { const v = nuevoRasgo.value.trim(); if (v) enviarPers([...pers, v]); };
  nuevoRasgo.addEventListener('keydown', (e) => { if (e.key === 'Enter') anadirRasgo(); });
  const personalidad = pers.length || puedeEditarPers ? [h('h4', { class: 'sub' }, 'Personalidad'),
    h('div', { class: 'recientes' }, pers.map((r, i) => h('span', { class: 'chip chip-rasgo', 'data-rasgo': r }, r,
      puedeEditarPers ? h('button', { class: 'chip-x', 'aria-label': `Quitar ${r}`, onclick: () => enviarPers(pers.filter((_, j) => j !== i)) }, '✕') : null))),
    puedeEditarPers && pers.length < 8 ? h('div', { class: 'tiradas-personal' }, nuevoRasgo, h('button', { class: 'btn', onclick: anadirRasgo }, 'Añadir')) : null,
    !pers.length && !puedeEditarPers ? h('p', { class: 'tenue pequeno' }, 'Sin rasgos de personalidad.') : null] : null;

  // ── Pestañas: solo aparecen las que tienen algo que mostrar (lo que el servidor deja ver de este token) ──
  const paginas = {
    resumen: () => [nivelBloque, h('div', { class: 'recursos' }, recursos),
      t.vision !== undefined ? h('p', { class: 'tenue pequeno', 'data-vision': String(t.vision) }, `👁 Visión: ${t.vision} ${t.vision === 1 ? 'casilla' : 'casillas'}`) : null,
      elecciones.length ? h('p', { class: 'tenue' }, elecciones.map(([g, o]) => `${g}: ${o}`).join(' · ')) : null,
      formas.length ? formas : null,
      t.campos ? bloqueCampos(t.campos, (c) => !!t.personaje && (S.esGM || (mio && editable && c.quien !== 'gm')),
        (cambio) => red.enviar({ tipo: 'editar_campos', personaje: t.personaje, campos: cambio, ...(S.esGM ? { usuario: t.dueno } : {}) })) : null,
      t.etiquetas?.length ? h('p', { class: 'fila-etiquetas' }, chipsEtiquetas(t.etiquetas)) : null,
      listaEstados(t),
      stats ? [h('h4', { class: 'sub' }, palabra('estadisticas', 'Estadísticas')), stats, puntos] : null],
    habilidades: () => [habilidades.length ? h('ul', { class: 'lista-acciones' }, habilidades) : h('p', { class: 'tenue' }, 'No conoce ninguna habilidad.'),
      listaPropias(t, 'habilidades', mio && editable && !!S.permisos.habilidades_propias && !!t.personaje)],
    inventario: () => [listaInventario(t), listaPropias(t, 'objetos', mio && editable && !!S.permisos.objetos_propios && !!t.personaje)],
    historia: () => [personalidad,
      rasgos.length ? [h('h4', { class: 'sub' }, palabra('rasgos', 'Rasgos')),
        h('ul', { class: 'lista-acciones' }, rasgos.map((r) => h('li', { class: 'fila-accion' },
          filaTexto(r.imagen, h('strong', null, r.nombre), r.descripcion ? h('span', { class: 'tenue pequeno' }, r.descripcion) : null))))] : null,
      t.imagen_biografia && urlLocal(t.imagen_biografia) ? h('img', { class: 'imagen-biografia', src: urlLocal(t.imagen_biografia), alt: `Retrato de ${t.nombre}` }) : null,
      t.historia ? [h('h4', { class: 'sub' }, 'Historia'), h('p', { class: 'historia' }, t.historia)] : null],
    sonidos: () => [h('p', { class: 'tenue pequeno' }, S.esGM ? 'Sonidos de este personaje: los oyen todos los que tengan el archivo.' : 'Los sonidos de tu personaje los oyen todos los que tengan el archivo.'),
      h('ul', { class: 'lista-acciones' }, t.sonidos.map((n) => h('li', { class: 'fila-accion' },
        h('div', { class: 'fila-texto' }, h('strong', null, n.replace(/\.[^.]+$/, ''))),
        h('button', { class: 'btn', 'data-sonido': n, onclick: () => red.enviar({ tipo: 'sonido_personaje', token: t.id, archivo: n }) }, '▶ Lanzar'))))],
    gm: () => panelRevelar(t),
  };
  const hayHistoria = !!(pers.length || puedeEditarPers || rasgos.length || t.imagen_biografia || t.historia);
  const pestanas = [['resumen', 'Resumen'], t.habilidades ? ['habilidades', palabra('habilidades', 'Habilidades')] : null, t.inventario ? ['inventario', palabra('inventario', 'Inventario')] : null,
    hayHistoria ? ['historia', 'Historia'] : null,
    t.sonidos?.length && S.permisos.sonidos_personaje && (mio || S.esGM) ? ['sonidos', '🔊 Sonidos'] : null, S.esGM ? ['gm', '👁 Visibilidad'] : null].filter(Boolean);
  if (!pestanas.some(([id]) => id === v.pestana)) v.pestana = 'resumen';
  const barraPestanas = h('div', { class: 'ficha-pestanas', role: 'tablist' }, pestanas.map(([id, texto]) =>
    h('button', { type: 'button', role: 'tab', class: `ficha-pestana${id === v.pestana ? ' activa' : ''}`, 'aria-selected': String(id === v.pestana), 'data-pestana': id,
      onclick: () => { v.pestana = id; v.refrescar(); } }, texto)));

  return h('div', { class: 'ficha' }, cab, barraPestanas, h('div', { class: 'ficha-pagina' }, paginas[v.pestana]()),
    mio ? h('div', { class: 'ficha-pie' },
      h('button', { class: 'btn btn-suave', onclick: cambiarPersonaje }, 'Cambiar de personaje'),
      hayAlmacen && t.tipo === 'personaje' && S.personajes.some((p) => p.id === t.personaje) ? h('button', { class: 'btn btn-suave', 'data-accion': 'exportar-personaje',
        title: 'Guarda la ficha y sus imágenes en un archivo .mesa-personaje para que el GM la importe en el Editor', onclick: () => exportarPersonaje(t.personaje) }, '📤 Exportar personaje') : null,
      h('button', { class: 'btn btn-suave', disabled: S.combate.activo, title: S.combate.activo ? 'No puedes retirarte durante un combate' : 'Lo quita del mapa; el personaje no se borra',
        onclick: () => retirarPersonaje(t.id) }, 'Retirar del mapa')) : null);
}


/** Anotaciones propias (habilidades u objetos escritos por el jugador): solo texto. `tipo` = 'habilidades' | 'objetos'. */
function listaPropias(t, tipo, puede) {
  const lista = (tipo === 'habilidades' ? t.habilidades_propias : t.objetos_propios) || [];
  const envia = (nueva) => red.enviar({ tipo: 'editar_propias', personaje: t.personaje, que: tipo, lista: nueva });
  const nombre = h('input', { type: 'text', maxlength: '40', placeholder: tipo === 'habilidades' ? 'Nueva habilidad…' : 'Nuevo objeto…', 'aria-label': 'Nombre', 'data-campo': `propia-nombre-${tipo}` });
  const desc = h('input', { type: 'text', maxlength: '300', placeholder: 'Descripción (opcional)', 'aria-label': 'Descripción', 'data-campo': `propia-desc-${tipo}` });
  const anadir = () => { const n = nombre.value.trim(); if (n) envia([...lista, { nombre: n, descripcion: desc.value.trim(), ...(tipo === 'objetos' ? { cantidad: 1 } : {}) }]); };
  if (!lista.length && !puede) return null;
  return h('div', { class: 'propias', 'data-propias': tipo },
    h('h4', { class: 'sub' }, tipo === 'habilidades' ? 'Habilidades anotadas' : 'Objetos anotados'),
    h('p', { class: 'tenue pequeno' }, 'Anotaciones de texto: no tienen efecto automático, el GM decide cómo valen en la partida.'),
    lista.length ? h('ul', { class: 'lista-acciones' }, lista.map((e, i) => h('li', { class: 'fila-accion' },
      h('div', { class: 'fila-texto' }, h('strong', null, e.nombre, e.cantidad > 1 ? ` ×${e.cantidad}` : ''), e.descripcion ? h('span', { class: 'tenue pequeno' }, e.descripcion) : null),
      puede ? h('button', { class: 'btn btn-mini', 'aria-label': `Quitar ${e.nombre}`, 'data-accion': 'quitar-propia', onclick: () => envia(lista.filter((_, j) => j !== i)) }, '✕') : null))) : null,
    puede && lista.length < 30 ? h('div', { class: 'tiradas-personal' }, nombre, desc, h('button', { class: 'btn', 'data-accion': `anadir-propia-${tipo}`, onclick: anadir }, 'Añadir')) : null);
}

const CAMPOS_VER = [['estadisticas', 'Estadísticas'], ['recursos', 'Todos los recursos'], ['inventario', 'Inventario'], ['habilidades', 'Habilidades'], ['ficha', 'Ficha, rasgos e historia']];
/** Solo GM: muestra a los jugadores datos concretos de este token (los demás siguen ocultos según las reglas de la mesa). */
function panelRevelar(t) {
  const reglas = S.catalogo.reglas?.visibilidad?.[t.tipo === 'personaje' ? 'jugadores' : 'npc'] || {};
  const actual = new Set(t.revelado || []);
  return [h('p', { class: 'tenue pequeno' }, 'Marca lo que los jugadores podrán ver de este token. Lo ya permitido por las reglas de la mesa aparece marcado y no se puede quitar aquí.'),
    h('ul', { class: 'lista-acciones' }, CAMPOS_VER.map(([k, texto]) => {
      const porRegla = !!reglas[k];
      const c = h('input', { type: 'checkbox', 'data-revelar': k, 'aria-label': texto, disabled: porRegla });
      c.checked = porRegla || actual.has(k);
      c.addEventListener('change', () => {
        const nuevo = new Set(actual); if (c.checked) nuevo.add(k); else nuevo.delete(k);
        red.enviar({ tipo: 'gm_revelar', token: t.id, campos: [...nuevo] });
      });
      return h('li', { class: 'fila-accion' }, h('label', { class: 'fila-texto' }, c, ' ', texto, porRegla ? h('span', { class: 'tenue pequeno' }, ' (por las reglas de la mesa)') : null));
    }))];
}

/** Sin argumentos: la ficha del token seleccionado. Con `tokenId` (y opcionalmente la entrada de la lista): la ficha fija de ese personaje. */
export function abrirPersonaje(tokenId, entrada) {
  const fijo = typeof tokenId === 'string' ? tokenId : null;
  abrirVentana({ id: fijo ? `personaje:${fijo}` : entrada ? `personaje:${entrada.id}` : 'personaje', titulo: entrada?.nombre || 'Personaje', ancho: 340,
    render: (v) => contenido(fijo, entrada, v), eventos: ['tokens', 'foco', 'estado'] });
}
