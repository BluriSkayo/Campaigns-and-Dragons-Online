// ventanas/editar-token.js — Solo GM: cambiar nombre, recursos, estadísticas y objetos de cualquier token.
// El servidor valida todo (rangos, nombres) y rechaza lo inválido con un mensaje.
import { h, toast } from '../util.js';
import { S, bus } from '../almacen.js';
import { abrirVentana, cerrarVentana } from '../ventanas.js';
import { red } from '../red.js';
import { textoDinero, monedaActiva } from '../dinero.js';

const num = (valor) => h('input', { type: 'number', value: String(valor), step: '1' });

export function editarToken(id) {
  if (!S.esGM) return;
  const t0 = S.tokens.get(id);
  if (!t0?.stats) return;
  cerrarVentana('editar-token');           // si había otro abierto, se reemplaza

  const render = (v) => {
    const t = S.tokens.get(id) || t0;
    const cat = S.catalogo;
    const nombre = h('input', { type: 'text', value: t.nombre, maxlength: '60', 'aria-label': 'Nombre' });
    const recs = cat.recursos.filter((r) => r.nombre in t.recursos).map((r) => ({ r, actual: num(t.recursos[r.nombre]?.actual ?? 0), max: num(t.recursos[r.nombre]?.max ?? 0) }));
    const stats = cat.estadisticas.filter((e) => !e.formula && e.nombre in (t.stats_base || t.stats)).map((e) => ({ e, campo: num((t.stats_base || t.stats)[e.nombre] ?? e.valor_inicial) }));

    // Solo un NPC tiene bando: el GM puede cambiarlo en plena partida (un neutral que se enfada, un enemigo que se une).
    const bando = h('select', { 'aria-label': 'Bando del NPC', 'data-campo': 'bando' },
      [['neutral', 'Neutral: no está con nadie'], ['aliado', 'Aliado: ayuda a los jugadores'], ['enemigo', 'Enemigo: se enfrenta a los jugadores']].map(([v2, tx]) => h('option', { value: v2 }, tx)));
    bando.value = t.bando || 'neutral';
    // «Controlado por» (si la mesa deja dar NPC a los jugadores): ese jugador lo mueve y actúa con él como con su personaje.
    const darNpc = t.tipo === 'enemigo' && S.permisos.npc_para_jugadores;
    const jugadores = [...new Set([...S.usuariosSalas, ...(S.conectados?.usuarios || []).filter((u) => !u.es_gm).map((u) => u.usuario),
      ...(t.controlado_por ? [t.controlado_por] : [])])].sort((a, b) => a.localeCompare(b));
    const control = h('select', { 'aria-label': 'Controlado por', 'data-campo': 'controlado_por' },
      h('option', { value: '' }, 'Solo el GM'), jugadores.map((u) => h('option', { value: u }, u)));
    control.value = t.controlado_por || '';
    // «Pertenece a» (si la mesa deja entrar sin ficha): el personaje —su ficha y su token— pasa a ser de ese usuario.
    const darPj = t.tipo === 'personaje' && S.permisos.sin_ficha;
    const duenos = [...new Set([...jugadores, S.usuario, t.dueno].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const dueno = h('select', { 'aria-label': 'Pertenece a', 'data-campo': 'dueno' }, duenos.map((u) => h('option', { value: u }, u === S.usuario ? `${u} (tú)` : u)));
    dueno.value = t.dueno || '';
    const aplicar = () => {
      const recursos = {}, st = {};
      for (const { r, actual, max } of recs) recursos[r.nombre] = { actual: Number(actual.value), max: Number(max.value) };
      for (const { e, campo } of stats) st[e.nombre] = Number(campo.value);
      red.enviar({ tipo: 'gm_editar_token', token: id, nombre: nombre.value, recursos, stats: st, ...(t.tipo === 'enemigo' ? { bando: bando.value } : {}),
        ...(darNpc ? { controlado_por: control.value || null } : {}), ...(darPj && dueno.value && dueno.value !== t.dueno ? { dueno: dueno.value } : {}) });
      toast('Cambios enviados', 'info');
    };

    // Inventario: cada cambio se envía al momento y la lista se repinta con lo que confirme el servidor.
    const inventario = h('div', { class: 'inv-gm' });
    const objetos = Object.entries(cat.objetos || {});
    const selector = h('select', { 'aria-label': 'Objeto a dar' }, objetos.map(([oid, o]) => h('option', { value: oid }, o.nombre)));
    const cantidad = h('input', { type: 'number', value: '1', min: '1', max: '999', 'aria-label': 'Cantidad' });
    const pintarInventario = () => {
      const cur = S.tokens.get(id);
      if (!cur) return;
      inventario.replaceChildren(...((cur.inventario || []).length
        ? cur.inventario.map((e) => h('div', { class: 'fila-accion' },
          h('span', null, `${cat.objetos[e.objeto]?.nombre || e.objeto} × ${e.cantidad}`),
          h('span', { class: 'mini-botones' },
            h('button', { class: 'btn btn-mini', title: 'Quitar uno', 'aria-label': 'Quitar uno',
              onclick: () => red.enviar({ tipo: 'gm_objeto', token: id, objeto: e.objeto, cantidad: -1 }) }, '−'),
            h('button', { class: 'btn btn-mini', title: 'Añadir uno', 'aria-label': 'Añadir uno',
              onclick: () => red.enviar({ tipo: 'gm_objeto', token: id, objeto: e.objeto, cantidad: 1 }) }, '+'),
            h('button', { class: 'btn btn-mini btn-peligro', title: 'Quitar todos', 'aria-label': 'Quitar todos',
              onclick: () => red.enviar({ tipo: 'gm_objeto', token: id, objeto: e.objeto, cantidad: -e.cantidad }) }, '✕'))))
        : [h('p', { class: 'tenue' }, 'Sin objetos.')]));
    };
    const dineroEl = h('p', { class: 'dinero', 'data-campo': 'dinero' });
    const pintarDinero = () => { const cur = S.tokens.get(id); if (cur) dineroEl.replaceChildren('Tiene: ', h('strong', null, textoDinero(cur.dinero))); };
    pintarInventario();
    pintarDinero();
    v.offs.push(bus.on('tokens', () => { pintarInventario(); pintarDinero(); }));      // solo el inventario se repinta: así no se borra lo que escribes arriba

    // Experiencia (solo si la campaña usa niveles): a un personaje se le DA (se suma a lo que tiene); a un NPC se le fija lo que CEDE al caer.
    const tiposExp = cat.niveles?.activo ? (cat.niveles.experiencia || []) : [];
    const experiencia = (() => {
      if (!tiposExp.length || (t.tipo !== 'personaje' && t.tipo !== 'enemigo')) return null;
      const filas = tiposExp.map((k) => {
        const campo = h('input', { type: 'number', step: '1', 'aria-label': t.tipo === 'personaje' ? `Dar ${k}` : `${k} que cede`, 'data-exp': k });
        campo.value = t.tipo === 'personaje' ? '0' : String(t.cede?.[k] ?? 0);
        return { k, campo };
      });
      const rejilla = h('div', { class: 'rejilla dos' }, filas.map(({ k, campo }) => [h('span', null, k), campo]));
      if (t.tipo === 'personaje') {
        return [h('h4', { class: 'sub' }, 'Dar experiencia'),
          h('p', { class: 'tenue pequeno' }, `Se suma a lo que ya tiene${t.experiencia ? ` (ahora: ${t.experiencia.total} en total)` : ''}. Un número negativo la resta. Si los niveles suben con experiencia, sube de nivel sola.`),
          rejilla,
          h('div', { class: 'fila-botones' }, h('button', { class: 'btn btn-acento', 'data-accion': 'dar-experiencia', onclick: () => {
            const dar = {};
            for (const { k, campo } of filas) { const n = Math.trunc(Number(campo.value)); if (Number.isFinite(n) && n !== 0) dar[k] = n; }
            if (!Object.keys(dar).length) { toast('Escribe cuánta experiencia dar', 'info'); return; }
            red.enviar({ tipo: 'gm_editar_token', token: id, dar_experiencia: dar });
            for (const { campo } of filas) campo.value = '0';
          } }, 'Dar experiencia'))];
      }
      return [h('h4', { class: 'sub' }, 'Experiencia que cede'),
        h('p', { class: 'tenue pequeno' }, 'Lo que reciben los jugadores al derrotar a este NPC (por tipo). Solo cambia este token; la ficha del enemigo en el Editor no se toca.'),
        rejilla,
        h('div', { class: 'fila-botones' }, h('button', { class: 'btn', 'data-accion': 'guardar-experiencia-cede', onclick: () => {
          const cede = {};
          for (const { k, campo } of filas) cede[k] = Math.max(0, Math.trunc(Number(campo.value)) || 0);
          red.enviar({ tipo: 'gm_editar_token', token: id, cede });
          toast('Experiencia que cede: enviada', 'info');
        } }, 'Guardar'))];
    })();

    // Lo que los demás ven de este token sobre el mapa (barras y nombre): lo de la mesa, o lo que el GM elija aquí.
    const st = S.catalogo.sobre_tokens || {};
    const quien = t.tipo === 'personaje' ? 'jugadores' : 'npc';
    const propio = t.mostrar_propio || {};
    const elegir = (clave, texto) => {
      const mesa = st[`${clave}_${quien}`] !== false;
      const sel = h('select', { 'aria-label': texto, 'data-campo': `mostrar-${clave}`, onchange: () => {
        red.enviar({ tipo: 'gm_mostrar_token', token: id, [clave]: sel.value === '' ? null : sel.value === 'si' });
      } }, h('option', { value: '' }, `Como diga la mesa (${mesa ? 'sí' : 'no'})`), h('option', { value: 'si' }, 'Sí'), h('option', { value: 'no' }, 'No'));
      sel.value = typeof propio[clave] === 'boolean' ? (propio[clave] ? 'si' : 'no') : '';
      return h('div', { class: 'campo' }, h('label', { title: 'Solo cambia lo que ven los demás jugadores en el mapa. Tú y su dueño lo veis siempre.' }, texto), sel);
    };
    const mostrar = h('div', { class: 'dos-columnas' }, elegir('barras', 'Los demás ven sus barras'), elegir('nombre', 'Los demás ven su nombre'));

    return h('div', { class: 'editar-token' },
      h('div', { class: 'campo' }, h('label', null, 'Nombre'), nombre),
      mostrar,
      t.tipo === 'enemigo' ? h('div', { class: 'campo' }, h('label', null, '¿De qué lado está?'), bando) : null,
      darNpc ? h('div', { class: 'campo' }, h('label', { title: 'Ese jugador lo mueve y actúa con él como con su personaje (y ve lo que ve el NPC). El GM siempre puede.' }, 'Controlado por'), control) : null,
      darPj ? h('div', { class: 'campo' }, h('label', { title: 'El personaje (su ficha y su token) pasa a ser de ese usuario: le aparece en su lista y lo maneja él. Solo usuarios conectados o con cuenta.' }, 'Pertenece a'), dueno) : null,
      h('h4', { class: 'sub' }, 'Recursos'),
      h('div', { class: 'rejilla' }, h('span', { class: 'cab' }), h('span', { class: 'cab' }, 'Actual'), h('span', { class: 'cab' }, 'Máximo'),
        recs.map(({ r, actual, max }) => [h('span', { title: r.descripcion || '' }, r.nombre), actual, max])),
      h('h4', { class: 'sub' }, 'Estadísticas base (sin bonos de raza, clase ni rasgos)'),
      h('div', { class: 'rejilla dos' }, stats.map(({ e, campo }) => [h('span', { title: e.descripcion || '' }, e.nombre), campo])),
      experiencia,
      t.tipo === 'personaje' ? h('div', { class: 'fila-accion' },
        h('span', null, `Puntos de estadística pendientes: ${t.puntos_pendientes || 0}`),
        h('span', { class: 'mini-botones' },
          h('button', { class: 'btn btn-mini', title: 'Dar 1 punto', onclick: () => red.enviar({ tipo: 'gm_dar_puntos', token: id, cantidad: 1 }) }, '+1'),
          h('button', { class: 'btn btn-mini', title: 'Dar 5 puntos', onclick: () => red.enviar({ tipo: 'gm_dar_puntos', token: id, cantidad: 5 }) }, '+5'))) : null,
      monedaActiva() && t.dinero !== undefined ? [h('h4', { class: 'sub' }, S.catalogo.moneda.nombre),
        dineroEl,
        (() => {
          const monto = h('input', { type: 'number', value: '10', min: '1', 'aria-label': 'Cantidad de dinero', 'data-campo': 'monto-dinero' });
          const enviar = (signo) => { const n = Number(monto.value); if (Number.isInteger(n) && n > 0) red.enviar({ tipo: 'gm_dinero', token: id, cantidad: signo * n }); };
          return h('div', { class: 'fila-botones' }, monto, h('button', { class: 'btn', 'data-accion': 'dar-dinero', onclick: () => enviar(1) }, 'Dar'),
            h('button', { class: 'btn btn-suave', 'data-accion': 'quitar-dinero', onclick: () => enviar(-1) }, 'Quitar'));
        })()] : null,
      (() => {
        const efectos = (cat.sonidos?.efectos || []).flatMap((g) => g.archivos);
        if (!efectos.length) return null;
        const tiene = new Set(t.sonidos || []);
        const casillas = efectos.map((n) => {
          const c = h('input', { type: 'checkbox', 'data-sonido-token': n, 'aria-label': n });
          c.checked = tiene.has(n);
          c.addEventListener('change', () => {
            const nuevo = new Set(S.tokens.get(id)?.sonidos || []); if (c.checked) nuevo.add(n); else nuevo.delete(n);
            red.enviar({ tipo: 'gm_sonidos_token', token: id, sonidos: [...nuevo] });
          });
          return h('label', { class: 'fila-texto' }, c, ' ', n.replace(/\.[^.]+$/, ''));
        });
        return [h('h4', { class: 'sub' }, 'Sonidos del personaje'),
          h('p', { class: 'tenue pequeno' }, S.catalogo.reglas?.sonidos_personaje ? 'El jugador puede lanzar estos sonidos desde su ficha.' : 'Tú puedes lanzarlos desde su ficha. Para que el jugador también pueda, actívalo en las reglas de la mesa.'),
          h('div', { class: 'sonidos-token' }, casillas)];
      })(),
      h('h4', { class: 'sub' }, 'Inventario'),
      inventario,
      objetos.length ? h('div', { class: 'fila-botones', style: { marginTop: '8px' } }, selector, cantidad,
        h('button', { class: 'btn', 'data-accion': 'dar-objeto', onclick: () => {
          const n = Number(cantidad.value);
          if (Number.isInteger(n) && n > 0) red.enviar({ tipo: 'gm_objeto', token: id, objeto: selector.value, cantidad: n });
        } }, 'Dar')) : null,
      // Al final del todo (y pegado abajo al desplazar): guarda nombre, bando, recursos y estadísticas de arriba.
      h('div', { class: 'pie' },
        h('button', { class: 'btn', 'data-accion': 'cerrar-editar', onclick: () => cerrarVentana('editar-token') }, 'Cerrar'),
        h('button', { class: 'btn btn-acento', 'data-accion': 'aplicar-editar', onclick: aplicar }, 'Guardar cambios')));
  };

  abrirVentana({ id: 'editar-token', titulo: `Editar: ${t0.nombre}`, ancho: 340, render });   // sin «eventos»: no se repinta mientras escribes
}
