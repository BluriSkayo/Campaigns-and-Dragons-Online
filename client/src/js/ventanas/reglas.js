// ventanas/reglas.js — La página automática «Reglas de la mesa» del diario, solo para leer. Todo lo decide el servidor; aquí se explica en palabras sencillas.
import { h } from '../util.js';
import { S } from '../almacen.js';

const si = (v) => (v ? 'Sí' : 'No');

function fila(nombre, valor, ayuda) {
  return h('div', { class: 'regla-fila' }, h('strong', null, nombre), h('span', null, valor), ayuda ? h('span', { class: 'tenue pequeno' }, ayuda) : null);
}

export function contenidoReglas() {
  const c = S.catalogo, r = c.reglas || {};
  const bonos = (b) => Object.entries(b || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');
  const grupos = Object.entries(c.grupos || {}).map(([g, gd]) => {
    const ops = Object.values(c.opciones || {}).filter((o) => o.grupo === g);
    return h('section', { class: 'regla-bloque' }, h('h4', { class: 'sub' }, `${gd.nombre}${gd.obligatorio ? '' : ' (opcional)'}`),
      gd.descripcion ? h('p', { class: 'tenue pequeno' }, gd.descripcion) : null,
      h('ul', { class: 'lista-acciones' }, ops.map((o) => h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, h('strong', null, o.nombre),
        h('span', { class: 'tenue pequeno' }, [o.descripcion, bonos(o.bonos) && `Bonos: ${bonos(o.bonos)}`,
          Object.keys(o.estadisticas || {}).length && `Empieza con ${Object.entries(o.estadisticas).map(([k, v]) => `${k} ${v}`).join(', ')}`,
          Object.keys(o.recursos || {}).length && `Recursos: ${Object.entries(o.recursos).map(([k, v]) => `${k} ${v}`).join(', ')}`,
          o.puntos_extra && `+${o.puntos_extra} puntos para repartir`].filter(Boolean).join(' · ')))))));
  });
  return h('div', { class: 'reglas-ventana' },
    h('section', { class: 'regla-bloque' }, h('h4', { class: 'sub primero' }, 'Tu personaje'),
      fila('Crear personajes', si(r.crear_personajes), 'Si es «No», solo el GM prepara los personajes.'),
      fila('Entrar sin ficha', si(r.sin_ficha), 'Si es «Sí», puedes entrar sin personaje y el GM te asigna uno (o un NPC) en la partida.'),
      fila('Máximo por jugador', String(r.max_personajes_por_jugador ?? '—')),
      fila('Puntos para repartir al crear', String(r.puntos_a_repartir ?? 0)),
      fila('Repartir puntos al subir de nivel', r.editar_stats_jugador ? 'Lo haces tú' : 'Lo hace el GM'),
      fila('Rasgos de personalidad', r.rasgos_personalidad ? 'Puedes escribirlos tú' : 'Solo los pone el GM'),
      fila('Habilidades y objetos anotados', r.habilidades_propias || r.objetos_propios ? 'Puedes anotarlos tú' : 'Solo los pone el GM')),
    h('section', { class: 'regla-bloque' }, h('h4', { class: 'sub' }, 'En la mesa'),
      fila('Combate', r.acciones_solo_en_su_turno ? 'Solo actúa quien tiene el turno' : 'Se puede actuar en cualquier momento'),
      fila('Mover fichas ajenas', si(r.mover_tokens_ajenos)),
      fila('A quién puedes atacar', { nadie: 'A nadie', enemigos: 'Solo a enemigos', enemigos_y_neutros: 'A enemigos y neutrales', todos: 'A todos' }[S.permisos.modo_ataque || r.atacar] || '—',
        S.permisos.gm ? 'Como GM no tienes límite.' : (S.permisos.modo_ataque !== r.atacar ? 'El GM te ha puesto un límite propio.' : 'Los NPC pueden ser aliados, neutrales o enemigos; se ve en el color de su token.')),
      fila('Datos de los demás', (() => {
        const v = r.visibilidad || {}, n = { estadisticas: 'estadísticas', recursos: 'recursos', inventario: 'inventario', habilidades: 'habilidades', ficha: 'ficha' };
        const lista = (o) => Object.keys(n).filter((k) => o?.[k]).map((k) => n[k]).join(', ') || 'solo la vida';
        return `Jugadores: ${lista(v.jugadores)} · NPC: ${lista(v.npc)}`;
      })(), S.permisos.gm ? '' : 'El GM puede mostrarte más datos de un personaje concreto.'),
      S.permisos.gm || S.permisos.editar_fichas ? null : fila('Edición de fichas', 'Bloqueada', 'El propietario del servidor te ha quitado el permiso de editar fichas.'),
      fila('Quién controla la música', r.musica === 'todos' ? 'Todos los jugadores' : 'Solo el GM'),
      fila('Quién rompe casillas', r.romper_casillas === 'todos' ? 'Los jugadores también' : 'Solo el GM'),
      fila('Dados', (c.dados || []).map((d) => `d${d}`).join(', '), r.dados_personalizados ? 'También puedes tirar tus propias combinaciones (2d8+3…).' : 'Solo se pueden tirar los dados de la lista.'),
      fila('Iniciativa', c.iniciativa === 'manual' ? 'El GM decide el orden' : `d20 + ${r.estadistica_iniciativa || '—'}`, c.iniciativa === 'manual' ? null : 'El GM puede cambiar el orden durante el combate.'),
      c.movimiento?.limitado ? fila('Movimiento en combate', c.movimiento.estadistica ? `Tantas casillas como tu ${c.movimiento.estadistica}` : `${c.movimiento.casillas} casillas por turno`, 'Andando, sin diagonales. Fuera de combate no hay límite.') : null,
      c.niveles?.activo ? fila('Niveles', c.niveles.modo === 'manual' ? `Los sube el GM (hasta el ${c.niveles.maximo})`
        : `Con experiencia (${(c.niveles.experiencia || []).join(' + ')}): ${(c.niveles.umbrales || []).map((u, i) => `nivel ${i + 2} a los ${u}`).join(', ')}`) : null),
    h('section', { class: 'regla-bloque' }, h('h4', { class: 'sub' }, 'Estadísticas'),
      h('ul', { class: 'lista-acciones' }, (c.estadisticas || []).map((e) => h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' },
        h('strong', null, e.nombre), h('span', { class: 'tenue pequeno' }, [e.descripcion, e.para_todos === false ? 'Solo algunas clases o razas la tienen' : `Empieza en ${e.valor_inicial}`].filter(Boolean).join(' · ')))))),
      h('h4', { class: 'sub' }, 'Recursos'),
      h('ul', { class: 'lista-acciones' }, (c.recursos || []).map((e) => h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' },
        h('strong', null, e.nombre), h('span', { class: 'tenue pequeno' }, [e.descripcion, e.para_todos === false ? 'Solo algunas clases o razas lo tienen' : null].filter(Boolean).join(' · ')))))),
      r.tirada_estadistica ? h('p', { class: 'tenue pequeno' }, `Al tirar una estadística: ${r.tirada_estadistica.replace('[a.{estadistica}]', '+ la estadística')}`) : null),
    grupos,
    Object.keys(c.rasgos || {}).length ? h('section', { class: 'regla-bloque' }, h('h4', { class: 'sub' }, 'Rasgos'),
      h('ul', { class: 'lista-acciones' }, Object.values(c.rasgos).map((x) => h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, h('strong', null, x.nombre), x.descripcion ? h('span', { class: 'tenue pequeno' }, x.descripcion) : null))))) : null,
    Object.keys(c.estados || {}).length ? h('section', { class: 'regla-bloque' }, h('h4', { class: 'sub' }, 'Estados'),
      h('ul', { class: 'lista-acciones' }, Object.values(c.estados).map((x) => h('li', { class: 'fila-accion' }, h('div', { class: 'fila-texto' }, h('strong', null, x.nombre), x.descripcion ? h('span', { class: 'tenue pequeno' }, x.descripcion) : null))))) : null);
}

