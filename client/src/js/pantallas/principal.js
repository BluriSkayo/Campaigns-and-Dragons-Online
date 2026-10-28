// pantallas/principal.js — Ventana principal: barra superior, panel izquierdo, mapa, panel derecho.
// El mapa ocupa casi todo el espacio; los paneles laterales se pliegan.
import { h, escribiendo } from '../util.js';
import { S, bus, puedoMover, puedoControlar, controloYo, puedoTerminarTurno, vidaDe, tokenFoco, tileEn, rompibleEn, bandoDe, palabra, textoMedida } from '../almacen.js';
import { retrato } from '../retrato.js';
import { ajustes, guardar } from '../ajustes.js';
import { crearAgarre } from '../redimensionar.js';
import { red } from '../red.js';
import { icono } from '../iconos.js';
import { VistaMapa, ZOOM_MIN, ZOOM_MAX } from '../mapa.js';
import { montarVentanas } from '../ventanas.js';
import { terminarTurno, desplegarPersonaje, retirarPersonaje, pedirPersonajes } from '../acciones.js';
import { abrirTransformar, hayTransformaciones, abrirDesplegar, personajesDesplegables } from '../ventanas/elegir.js';
import { crearChat } from '../paneles/chat.js';
import { crearPanelMusica } from '../paneles/musica.js';
import { crearListaPersonajes } from '../paneles/personajes.js';
import { crearSeccion } from '../paneles/seccion.js';
import { abrirPersonaje } from '../ventanas/personaje.js';
import { DEF_INVENTARIO } from '../ventanas/inventario.js';
import { DEF_TIENDA } from '../ventanas/tienda.js';
import { abrirIntercambio } from '../ventanas/intercambio.js';
import { abrirTurnos, sincronizarTurnos } from '../ventanas/turnos.js';
import { proponerIntercambio } from '../acciones.js';
import { DEF_TIRADAS } from '../ventanas/tiradas.js';
import { DEF_AJUSTES } from '../ventanas/ajustes.js';
import { DEF_DIARIO } from '../ventanas/diario.js';
import { DEF_COFRES } from '../ventanas/cofres.js';
import { DEF_GM } from '../ventanas/gm.js';
import { analizar } from '../ventanas/analisis.js';
import { editarToken } from '../ventanas/editar-token.js';
import { gestionarHabilidades } from '../ventanas/habilidades-token.js';
import { abrirMenu, cerrarMenu } from '../menu.js';

export function crearPrincipal() {
  const offs = [];
  const escuchar = (ev, fn) => offs.push(bus.on(ev, fn));
  escuchar('intercambio', (nuevo) => { if (nuevo) abrirIntercambio(); });

  // ── Barra superior ──────────────────────────────────────────
  const tituloSala = h('h1', { class: 'sala-nombre' });
  const subtituloSala = h('span', { class: 'sala-servidor' });
  const botonSalas = h('button', { class: 'btn-icono', title: 'Mostrar u ocultar las salas', 'aria-label': 'Mostrar u ocultar el panel de salas',
    'aria-expanded': 'false', onclick: () => alternarSalas() }, icono('salas', 20));
  const tira = h('div', { class: 'tira', 'aria-label': 'Orden de turnos' });
  const botonTurno = h('button', { class: 'btn btn-turno', onclick: terminarTurno }, 'Terminar turno');
  const usuarioEtiqueta = h('span', { class: 'usuario-etiqueta' });
  // Momento del día (si la campaña usa día y noche): todos lo ven; el GM lo cambia con un clic.
  const chipPeriodo = h('button', { class: 'chip-periodo', hidden: true, 'data-accion': 'periodo' });
  chipPeriodo.addEventListener('click', () => {
    const n = S.catalogo?.ciclo?.periodos?.length || 0;
    if (S.esGM && n > 1) red.enviar({ tipo: 'gm_periodo', indice: (S.periodo + 1) % n });
  });
  // Clima (si la campaña lo usa): todos lo ven; el GM lo cambia con un clic.
  const chipClima = h('button', { class: 'chip-periodo', hidden: true, 'data-accion': 'clima' });
  chipClima.addEventListener('click', () => {
    const n = S.catalogo?.clima?.tipos?.length || 0;
    if (S.esGM && n > 1) red.enviar({ tipo: 'gm_clima', indice: (S.clima + 1) % n });
  });
  const barra = h('header', { class: 'barra-sup' },
    h('div', { class: 'barra-izq' }, botonSalas, h('div', { class: 'sala' }, tituloSala, subtituloSala)),
    h('div', { class: 'barra-centro' }, tira, botonTurno),
    h('div', { class: 'barra-der' }, chipPeriodo, chipClima, h('div', { class: 'futuro' }), usuarioEtiqueta));

  // ── Panel de salas (desplegable) ────────────────────────────
  const panelSalas = h('div', { class: 'panel-salas', hidden: true });
  function alternarSalas(forzar) {
    const abrir = forzar ?? panelSalas.hidden;
    panelSalas.hidden = !abrir;
    botonSalas.setAttribute('aria-expanded', String(abrir));
    if (abrir) pintarSalas();
  }
  // Cada mapa es una sala con sus propios tokens. El GM ve todas y pasa de una a otra sin mover a nadie; los jugadores
  // van con su personaje a las salas abiertas si la mesa lo permite (si no, los lleva el GM).
  function pintarSalas() {
    const salas = S.salasMapa || [];
    const contenido = [h('h2', { class: 'panel-titulo' }, 'Salas')];
    const libres = S.permisos.cambiar_sala && !S.esGM;
    const nombreSala = (id) => salas.find((x) => x.id === id)?.nombre || S.catalogo.mapas?.[id]?.nombre || id;
    if (S.esGM) {
      contenido.push(h('p', { class: 'tenue pequeno sala-ayuda' }, 'Pulsa una sala para verla (nadie se mueve). Para llevar a alguien, clic derecho en su token → «Llevar a otra sala».'));
      contenido.push(h('ul', { class: 'lista-salas' }, salas.map((m) => {
        const actual = m.id === S.mapaId;
        const datos = [`${m.ancho} × ${m.alto}`, m.personajes ? `👤 ${m.personajes}` : '', m.npc ? `${m.npc} NPC` : '', m.combate ? '⚔️ en combate' : ''].filter(Boolean).join(' · ');
        return h('li', { class: 'sala-fila', 'data-sala': m.id },
          h('button', { class: `sala-item${actual ? ' actual' : ''}`, 'aria-current': actual ? 'true' : null, onclick: () => {
            if (!actual) { red.enviar({ tipo: 'cambiar_sala', mapa: m.id }); alternarSalas(false); }
          } }, h('strong', null, m.nombre, m.principal ? h('span', { class: 'insignia-sala', title: 'Aquí aparece quien entra sin personaje en el mapa' }, 'principal') : null),
          h('span', { class: 'tenue pequeno' }, datos)),
          h('div', { class: 'sala-acciones' },
            h('button', { class: 'btn-mini-sala', 'data-accion': 'llevar-todos', title: 'Llevar aquí a todos los personajes de los jugadores (de todas las salas)', onclick: () => {
              if (confirm(`¿Llevar a todos los jugadores a «${m.nombre}»? Los NPC se quedan en su sala.`)) { red.enviar({ tipo: 'gm_cambiar_mapa', mapa: m.id }); alternarSalas(false); }
            } }, '⤵ Todos'),
            h('button', { class: `btn-mini-sala${m.abierta ? '' : ' cerrada'}`, 'data-accion': 'abrir-sala', 'aria-pressed': String(!m.abierta),
              title: S.catalogo.reglas?.cambiar_sala === 'todos'
                ? (m.abierta ? 'Abierta: los jugadores pueden entrar solos. Pulsa para cerrarla' : 'Cerrada: solo entra quien lleves tú. Pulsa para abrirla')
                : 'Los jugadores no cambian de sala solos (Editor → Reglas → Funciones de la mesa). Puedes cerrarla igualmente',
              onclick: () => red.enviar({ tipo: 'gm_sala_abierta', mapa: m.id, abierta: !m.abierta }) }, m.abierta ? '🔓' : '🔒')));
      })));
    } else {
      contenido.push(h('ul', { class: 'lista-salas' }, salas.map((m) => {
        const actual = m.id === S.mapaId;
        return h('li', { class: 'sala-fila', 'data-sala': m.id }, h('button', { class: `sala-item${actual ? ' actual' : ''}`, disabled: !libres && !actual, onclick: () => {
          if (actual) return;
          const mio = S.tokenActivo && S.tokens.get(S.tokenActivo);
          if (confirm(mio ? `¿Ir a «${m.nombre}» con ${mio.nombre}?` : `¿Ir a «${m.nombre}»?`)) { red.enviar({ tipo: 'cambiar_sala', mapa: m.id }); alternarSalas(false); }
        } }, h('strong', null, m.nombre), h('span', { class: 'tenue pequeno' }, actual ? 'Estás aquí' : 'Pulsa para ir con tu personaje')));
      })));
      contenido.push(h('p', { class: 'tenue pequeno' }, libres ? (S.combate.activo ? 'Durante un combate no puedes irte de la sala.' : 'Puedes ir a las salas abiertas con tu personaje.')
        : 'El GM decide cuándo cambias de sala.'));
    }
    if (S.permisos.gm && S.conectados) {            // quién está conectado y en qué sala
      const u = S.conectados.usuarios;
      contenido.push(h('h3', { class: 'sub' }, `Conectados: ${u.length} ${u.length === 1 ? 'persona' : 'personas'}`),
        h('ul', { class: 'lista-conectados' }, u.map((x) => h('li', { 'data-conectado': x.usuario },
          h('strong', null, `${x.es_gm ? '🛡️ ' : ''}${x.usuario}`),
          h('span', { class: 'tenue pequeno' }, ` — ${x.sala ? `en «${nombreSala(x.sala)}»` : ''}${x.personajes.length ? ` · ${x.personajes.join(', ')}` : ' · sin personaje en el mapa'}`)))));
    }
    panelSalas.replaceChildren(...contenido);
  }
  escuchar('salas-mapa', () => { if (!panelSalas.hidden) pintarSalas(); });
  bus.on('conectados', () => { if (!panelSalas.hidden) pintarSalas(); });

  // ── Panel izquierdo ─────────────────────────────────────────
  const botonIzq = (ico, texto, accion) => h('button', { class: 'rail-btn', title: texto, onclick: accion },
    icono(ico, 20), h('span', { class: 'rail-texto' }, texto));
  const plegarIzq = h('button', { class: 'rail-btn rail-plegar', title: 'Plegar o desplegar el panel', 'aria-label': 'Plegar o desplegar el panel izquierdo' },
    icono('izquierda', 20));
  // Cada opción se despliega dentro del panel y puede sacarse a una ventana independiente.
  const listaPers = crearListaPersonajes();
  const DEF_PERSONAJES = { id: 'lista-personajes', titulo: 'Personaje', ancho: 300, render: () => listaPers.el, eventos: [] };
  const secciones = [
    crearSeccion({ ...DEF_PERSONAJES, titulo: palabra('personaje', 'Personaje'), render: () => listaPers.el }, { ico: 'personaje', alCambiar: () => ajustarAncho() }),
    crearSeccion({ ...DEF_INVENTARIO, titulo: palabra('inventario', 'Inventario') }, { ico: 'inventario', alCambiar: () => ajustarAncho() }),
    crearSeccion(DEF_TIENDA, { ico: 'tienda', alCambiar: () => ajustarAncho() }),
    S.catalogo?.inventario_grupo === false ? null : crearSeccion({ ...DEF_COFRES, titulo: palabra('grupo', 'Grupo') }, { ico: 'cofre', alCambiar: () => ajustarAncho() }),
    crearSeccion(DEF_TIRADAS, { ico: 'dados', alCambiar: () => ajustarAncho() }),
    crearSeccion({ ...DEF_DIARIO, titulo: palabra('diario', 'Diario') }, { ico: 'reglas', alCambiar: () => ajustarAncho() }),
    crearSeccion(DEF_AJUSTES, { ico: 'ajustes', alCambiar: () => ajustarAncho() }),
    S.permisos.gm ? crearSeccion(DEF_GM, { ico: 'gm', alCambiar: () => ajustarAncho() }) : null,
  ].filter(Boolean);
  // El orden del menú lo decide la campaña (el GM lo cambia en el Editor); lo que no aparezca en su lista va al final
  const ordenMenu = S.catalogo?.orden_menu || [];
  const puesto = (x) => { const i = ordenMenu.indexOf(x.id); return i < 0 ? ordenMenu.length : i; };
  secciones.sort((a, b) => puesto(a) - puesto(b));
  function ajustarAncho() {
    const alguna = secciones.some((x) => x.abierta);
    if (alguna && !ajustes.panelIzq) { guardar({ panelIzq: true }); aplicarIzq(); }
    panelIzq.classList.toggle('con-secciones', alguna);
    ponerAgarresIzq();
  }
  const btnSalir = botonIzq('salir', 'Desconectar', () => { if (confirm('¿Desconectarte del servidor?')) red.cerrar(); });
  btnSalir.classList.add('rail-salir');
  const panelIzq = h('nav', { class: 'panel-izq', 'aria-label': 'Accesos' },
    ...secciones.flatMap((x) => [x.boton, x.bloque]),
    h('div', { class: 'rail-relleno' }), plegarIzq, btnSalir);
  const agarreIzq = crearAgarre(panelIzq, { lado: 'izq', clave: 'anchoIzq', propiedad: '--ancho-izq', min: 240, max: 640, defecto: 360, etiqueta: 'Cambiar el ancho de la barra izquierda' });
  // Sin categoría desplegada el menú también se puede ensanchar o estrechar (con otro ancho guardado aparte)
  const agarreRail = crearAgarre(panelIzq, { lado: 'izq', clave: 'anchoRail', propiedad: '--ancho-rail', min: 130, max: 320, defecto: 172, etiqueta: 'Cambiar el ancho del menú izquierdo' });
  function ponerAgarresIzq() {
    const con = panelIzq.classList.contains('con-secciones');
    agarreIzq.hidden = !ajustes.panelIzq || !con;
    agarreRail.hidden = !ajustes.panelIzq || con;
  }
  ponerAgarresIzq();
  const aplicarIzq = () => {
    panelIzq.classList.toggle('plegado', !ajustes.panelIzq);
    ponerAgarresIzq();
    plegarIzq.replaceChildren(icono(ajustes.panelIzq ? 'izquierda' : 'derecha', 20));
  };
  plegarIzq.addEventListener('click', () => { guardar({ panelIzq: !ajustes.panelIzq }); aplicarIzq(); });

  // ── Mapa y controles flotantes ──────────────────────────────
  const zona = h('main', { class: 'zona-mapa' });
  const botonesHerr = {};
  const herramientas = h('div', { class: 'herramientas', role: 'toolbar', 'aria-label': 'Herramientas del mapa' },
    ['cursor', 'mano', 'regla', 'lapiz'].map((id) => {
      const nombres = { cursor: 'Cursor (V): seleccionar y mover. Alt + clic señala una casilla', mano: 'Mano (H): desplazar el mapa', regla: 'Regla (R): medir distancias (la ven los demás)', lapiz: 'Lápiz (L): dibujar en el mapa (temporal)' };
      const b = h('button', { class: 'herr', title: nombres[id], 'aria-label': nombres[id], 'aria-pressed': String(id === 'cursor'),
        onclick: () => elegirHerramienta(id) }, icono(id, 20));
      botonesHerr[id] = b;
      return b;
    }));
  function elegirHerramienta(id) {
    vista.setHerramienta(id);
    for (const [k, b] of Object.entries(botonesHerr)) { b.classList.toggle('activa', k === id); b.setAttribute('aria-pressed', String(k === id)); }
    pintarPanelDibujo();
  }
  // Capa de dibujos: se puede ocultar sin perder los trazos.
  const botonCapa = h('button', { class: 'herr', 'data-accion': 'capa-dibujos', onclick: () => { guardar({ verDibujos: ajustes.verDibujos === false }); pintarPanelDibujo(); vista.marcar(); } });
  herramientas.append(botonCapa);
  // Solo GM: mostrar u ocultar a todos las capas de detalle del mapa (② bajo los tokens, ③ encima de ellos).
  const botonesCapa = S.esGM ? [[2, '②', 'Capa de detalle (bajo los tokens)'], [3, '③', 'Capa superior (sobre los tokens: techos, copas de árboles)']].map(([n, txt, nombre]) =>
    h('button', { class: 'herr', 'data-accion': `capa-${n}`, onclick: () => red.enviar({ tipo: 'gm_capa', capa: n, visible: S.capasOcultas.includes(n) }) }, txt)) : [];
  function pintarCapas() {
    botonesCapa.forEach((b, i) => {
      const n = i + 2, visible = !S.capasOcultas.includes(n);
      const nombre = n === 2 ? 'Capa de detalle (bajo los tokens)' : 'Capa superior (sobre los tokens: techos, copas de árboles)';
      b.classList.toggle('activa', visible);
      b.setAttribute('aria-pressed', String(visible));
      b.title = `${nombre}: ${visible ? 'visible para todos. Pulsa para ocultarla' : 'oculta para los jugadores. Pulsa para mostrarla'}`;
      b.setAttribute('aria-label', b.title);
    });
  }
  const botonNiebla = S.esGM ? h('button', { class: 'herr', 'data-accion': 'niebla', onclick: () => red.enviar({ tipo: 'gm_niebla', activa: !S.nieblaActiva }) }, '🌫') : null;
  // Ayuda visual del GM: ver (semitransparente) la niebla de todo el grupo o de un jugador, solo en su pantalla.
  const botonVerNiebla = S.esGM ? h('button', { class: 'herr', 'data-accion': 'ver-niebla', onclick: () => {
    const r = botonVerNiebla.getBoundingClientRect();
    const jugadores = [...new Set([...S.tokens.values()].map((t) => (t.tipo === 'personaje' ? t.dueno : t.controlado_por)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const ver = (como) => red.enviar({ tipo: 'gm_ver_niebla', como });
    abrirMenu(zona, r.left, r.bottom, [{ titulo: 'Niebla en mi pantalla' },
      { texto: `${S.nieblaGM ? '' : '✓ '}No verla`, accion: () => ver(null) },
      { texto: `${S.nieblaGM === '*' ? '✓ ' : ''}Lo que ve el grupo`, accion: () => ver('*') },
      ...(jugadores.length ? [{ separador: true }, { titulo: 'Lo que ve un jugador' }, ...jugadores.map((u) => ({ texto: `${S.nieblaGM === u ? '✓ ' : ''}${u}`, accion: () => ver(u) }))] : [])]);
  } }, '👁') : null;
  function pintarNiebla() {
    if (botonVerNiebla) {
      botonVerNiebla.hidden = !S.nieblaActiva;
      botonVerNiebla.classList.toggle('activa', !!S.nieblaGM);
      botonVerNiebla.title = !S.nieblaGM ? 'Ver la niebla en tu pantalla (solo tú): la del grupo o la de un jugador'
        : `Viendo la niebla de ${S.nieblaGM === '*' ? 'todo el grupo' : S.nieblaGM} (solo en tu pantalla). Pulsa para cambiar`;
      botonVerNiebla.setAttribute('aria-label', botonVerNiebla.title);
    }
    if (!botonNiebla) return;
    botonNiebla.classList.toggle('activa', S.nieblaActiva);
    botonNiebla.setAttribute('aria-pressed', String(S.nieblaActiva));
    botonNiebla.title = S.nieblaActiva ? 'Niebla de guerra activada: los jugadores solo ven lo que alcanza su visión. Pulsa para quitarla' : 'Niebla de guerra desactivada. Pulsa para activarla';
    botonNiebla.setAttribute('aria-label', botonNiebla.title);
  }
  herramientas.append(...botonesCapa, ...(botonNiebla ? [botonNiebla, botonVerNiebla] : []));
  pintarNiebla();
  pintarCapas();
  escuchar('capas', () => { pintarCapas(); vista.marcar(); });
  escuchar('estado', () => { pintarCapas(); pintarNiebla(); vista.marcar(); });
  escuchar('niebla', () => { pintarNiebla(); vista.marcar(); });
  // Panel del lápiz: color, borrar lo mío y, para el GM, borrar todo o bloquear el dibujo.
  const panelDibujo = h('div', { class: 'panel-dibujo', hidden: true });
  const COLORES_LAPIZ = ['#f0b44c', '#c4533f', '#6fb7a8', '#4f8fd1', '#b07ad9', '#e8ecf4', '#7ac74f'];
  const puedeDibujar = () => !!S.permisos.dibujar && (S.esGM || !S.dibujoBloqueado);
  /** Deslizador del panel del lápiz (grosor) o del borrador (tamaño). Se recuerda en este equipo. */
  function deslizadorDibujo(etiqueta, clave, { min, max, paso, texto, muestra }) {
    const valor = Number(ajustes[clave]);
    const leer = () => Math.min(max, Math.max(min, Number.isFinite(valor) ? valor : min));
    const dato = h('span', { class: 'vol-valor' }, texto(leer()));
    const rayita = muestra ? h('span', { class: 'muestra-grosor', style: { height: `${leer()}px`, background: ajustes.colorDibujo } }) : null;
    const rango = h('input', { type: 'range', min: String(min), max: String(max), step: String(paso), value: String(leer()), 'aria-label': etiqueta, 'data-dibujo': clave });
    rango.addEventListener('input', () => {
      const v = Number(rango.value);
      ajustes[clave] = v;                       // al instante; se guarda en el equipo al soltar
      dato.textContent = texto(v);
      if (rayita) rayita.style.height = `${v}px`;
      vista.marcar();                           // el círculo del borrador cambia de tamaño mientras se arrastra
    });
    rango.addEventListener('pointerdown', () => { ajustandoDibujo = true; window.addEventListener('pointerup', () => { ajustandoDibujo = false; }, { once: true }); });
    rango.addEventListener('change', () => guardar({ [clave]: Number(rango.value) }));
    return h('label', { class: 'vol vol-dibujo' }, h('span', { class: 'vol-nombre' }, etiqueta), rango, dato, rayita);
  }
  let ajustandoDibujo = false;                  // mientras se arrastra un deslizador, el panel no se repinta (si no, se perdería el arrastre)
  function pintarPanelDibujo() {
    if (ajustandoDibujo) return;
    const visible = ajustes.verDibujos !== false;
    botonCapa.replaceChildren(icono('ojo', 20));
    botonCapa.classList.toggle('activa', visible);
    botonCapa.setAttribute('aria-pressed', String(visible));
    botonCapa.title = visible ? 'Ocultar los dibujos' : 'Mostrar los dibujos';
    botonCapa.setAttribute('aria-label', botonCapa.title);
    panelDibujo.hidden = vista?.herramienta !== 'lapiz';
    if (panelDibujo.hidden) return;
    panelDibujo.replaceChildren(
      !S.permisos.dibujar ? h('p', { class: 'tenue pequeno' }, 'En esta mesa los jugadores no pueden dibujar.')
        : !puedeDibujar() ? h('p', { class: 'tenue pequeno' }, 'El GM ha bloqueado el dibujo.') : '',
      h('div', { class: 'fila-botones', role: 'group', 'aria-label': 'Lápiz o borrador' },
        h('button', { class: `btn btn-suave${!vista.borrador ? ' activo' : ''}`, 'aria-pressed': String(!vista.borrador), 'data-accion': 'modo-lapiz', onclick: () => { vista.borrador = false; vista.actualizarCursor(); pintarPanelDibujo(); } }, '✏️ Lápiz'),
        h('button', { class: `btn btn-suave${vista.borrador ? ' activo' : ''}`, 'aria-pressed': String(!!vista.borrador), 'data-accion': 'modo-borrador', title: S.esGM ? 'Borra lo que toques de cualquier trazo' : 'Borra lo que toques de tus trazos',
          onclick: () => { vista.borrador = true; vista.actualizarCursor(); pintarPanelDibujo(); } }, '🧽 Borrador')),
      vista.borrador
        ? deslizadorDibujo('Tamaño del borrador', 'radioBorrador', { min: 0.2, max: 2, paso: 0.05, texto: () => '' })
        : deslizadorDibujo('Grosor del lápiz', 'grosorLapiz', { min: 1, max: 16, paso: 1, texto: (v) => `${v} px`, muestra: true }),
      vista.borrador ? null : h('div', { class: 'colores-lapiz', role: 'radiogroup', 'aria-label': 'Color del lápiz' }, COLORES_LAPIZ.map((c) =>
        h('button', { class: `color-lapiz${ajustes.colorDibujo === c ? ' activo' : ''}`, style: { background: c }, role: 'radio', 'aria-checked': String(ajustes.colorDibujo === c),
          'aria-label': `Color ${c}`, 'data-color': c, onclick: () => { guardar({ colorDibujo: c }); pintarPanelDibujo(); } }))),
      h('div', { class: 'fila-botones' },
        h('button', { class: 'btn btn-suave', 'data-accion': 'borrar-mis-dibujos', onclick: () => {
          const ids = S.dibujos.filter((d) => d.usuario === S.usuario).map((d) => d.id);
          if (ids.length) red.enviar({ tipo: 'borrar_dibujo', ids });
        } }, 'Borrar los míos'),
        S.esGM ? h('button', { class: 'btn btn-suave', 'data-accion': 'borrar-todos-dibujos', onclick: () => red.enviar({ tipo: 'gm_borrar_dibujos' }) }, 'Borrar todos') : null,
        S.esGM ? h('button', { class: 'btn btn-suave', 'data-accion': 'bloquear-dibujo', 'aria-pressed': String(S.dibujoBloqueado),
          onclick: () => red.enviar({ tipo: 'gm_bloquear_dibujo', activo: !S.dibujoBloqueado }) }, S.dibujoBloqueado ? '🔓 Dejar dibujar' : '🔒 Bloquear dibujo') : null));
  }

  const zoomRango = h('input', { type: 'range', min: String(ZOOM_MIN * 100), max: String(ZOOM_MAX * 100), step: '5', value: '100',
    'aria-label': 'Nivel de zoom' });
  const zoomTexto = h('span', { class: 'zoom-texto' }, '100%');
  const zoom = h('div', { class: 'zoom' },
    h('button', { class: 'herr', title: 'Alejar', 'aria-label': 'Alejar', onclick: () => vista.zoomCentro(vista.cam.zoom / 1.25) }, icono('menos', 18)),
    zoomRango,
    h('button', { class: 'herr', title: 'Acercar', 'aria-label': 'Acercar', onclick: () => vista.zoomCentro(vista.cam.zoom * 1.25) }, icono('mas', 18)),
    zoomTexto,
    h('button', { class: 'herr', title: 'Restablecer el tamaño (100%)', 'aria-label': 'Restablecer el zoom', 'data-accion': 'zoom-reset', onclick: () => vista.zoomCentro(1) }, icono('reiniciar', 18)));
  zoomRango.addEventListener('input', () => vista.zoomCentro(Number(zoomRango.value) / 100));

  const aviso = h('div', { class: 'aviso-modo', hidden: true });
  const tooltip = h('div', { class: 'tooltip-token', hidden: true });
  const plegarDer = h('button', { class: 'herr plegar-der', title: 'Mostrar u ocultar chat y música', 'aria-label': 'Mostrar u ocultar el panel derecho' });
  const ventanasEl = h('div', { class: 'ventanas' });
  zona.append(herramientas, panelDibujo, zoom, aviso, tooltip, plegarDer, ventanasEl);
  montarVentanas(ventanasEl);

  // ── Panel derecho ───────────────────────────────────────────
  const musica = crearPanelMusica();
  if (S.catalogo?.sonidos_activos === false) musica.el.hidden = true;          // la campaña no usa música ni sonidos
  const chat = crearChat();
  const panelDer = h('aside', { class: 'panel-der', 'aria-label': 'Chat y música' }, musica.el, chat.el);
  const agarreDer = crearAgarre(panelDer, { lado: 'der', clave: 'anchoDer', propiedad: '--ancho-der', min: 260, max: 700, defecto: 360, etiqueta: 'Cambiar el ancho de la barra derecha' });
  const aplicarDer = () => {
    panelDer.classList.toggle('plegado', !ajustes.panelDer);
    agarreDer.hidden = !ajustes.panelDer;
    plegarDer.replaceChildren(icono(ajustes.panelDer ? 'derecha' : 'izquierda', 18));
  };
  plegarDer.addEventListener('click', () => { guardar({ panelDer: !ajustes.panelDer }); aplicarDer(); });

  const raiz = h('div', { class: 'principal' }, barra, panelSalas,
    h('div', { class: 'cuerpo' }, panelIzq, agarreIzq, agarreRail, zona, agarreDer, panelDer));

  // ── Modos: elegir objetivo / colocar NPC ─────────────────
  let modoObj = null;
  let modoCol = null;
  const mostrarAviso = (texto) => { aviso.textContent = texto || ''; aviso.hidden = !texto; };
  const limpiarModos = () => { modoObj = null; modoCol = null; vista.setModoObjetivo(null); vista.setModoColocar(false); mostrarAviso(''); };

  // ── Vista del mapa ──────────────────────────────────────────
  let hoverId = null;
  function pintarTooltip(t) {
    const v = vidaDe(t);
    tooltip.replaceChildren(h('strong', null, t.nombre),
      h('span', { class: 'tenue' }, t.derrotado ? 'Derrotado' : v ? `${S.catalogo.recurso_vida} ${v.actual}/${v.max}` : ''),
      t.estados?.length ? h('span', { class: 'tenue' }, t.estados.map((e) => S.catalogo.estados?.[e.id]?.nombre || e.id).join(', ')) : null);
    tooltip.hidden = false;
  }
  const vista = new VistaMapa(zona, {
    puedeMover: puedoMover,
    puedeDibujar,
    alPing(x, y) { if (S.permisos.ping) red.enviar({ tipo: 'ping', x, y }); },
    alRegla(puntos) { red.enviar({ tipo: 'regla', puntos }); },
    alDibujar(puntos) { red.enviar({ tipo: 'dibujar', color: ajustes.colorDibujo, grosor: ajustes.grosorLapiz, puntos }); },
    alSeleccionar(id) { S.tokenFoco = id || S.tokenActivo; bus.emit('foco'); vista.marcar(); },
    alMover(id, x, y) { red.enviar({ tipo: 'mover_token', token: id, x, y }); },
    alObjetivo(id) {
      if (!modoObj) return;
      red.enviar({ tipo: 'usar_habilidad', token: modoObj.tokenId, habilidad: modoObj.habId, objetivo: id });
      limpiarModos();
    },
    alLapiz(x, y) { red.enviar({ tipo: 'lapiz', ...(x == null ? { fin: true } : { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }) }); },
    alBorrarZona(centros, radio) { red.enviar({ tipo: 'borrar_zona', centros, radio }); },
    alSoltarPersonaje(personaje, usuario, x, y) { desplegarPersonaje(personaje, S.esGM ? usuario : null, x, y); },
    alCasillaObjetivo(x, y) {
      if (!modoObj) return;
      red.enviar({ tipo: 'usar_habilidad', token: modoObj.tokenId, habilidad: modoObj.habId, casilla: { x, y } });
      limpiarModos();
    },
    alColocar(x, y) { if (modoCol) red.enviar({ tipo: 'gm_colocar_enemigo', enemigo: modoCol, x, y }); },
    alHover(t, cx, cy) {
      hoverId = t ? t.id : null;
      if (!t) { tooltip.hidden = true; return; }
      pintarTooltip(t);
      const r = zona.getBoundingClientRect();
      tooltip.style.left = `${Math.min(cx - r.left + 14, r.width - 170)}px`;
      tooltip.style.top = `${Math.min(cy - r.top + 14, r.height - 60)}px`;
    },
    alMenu({ cx, cy, token, x, y }) {
      tooltip.hidden = true;
      const items = [];
      if (token) {
        S.tokenFoco = token.id;
        bus.emit('foco');
        items.push({ titulo: token.nombre },
          S.esGM ? { texto: '✏️ Editar…', accion: () => editarToken(token.id), detalle: 'Cambiar vida, estadísticas, nombre y objetos' } : null,
          { texto: '📜 Ver ficha', accion: abrirPersonaje },
          { texto: '🔍 Analizar', accion: () => analizar({ tipo: 'token', id: token.id }) });
        if (S.combate.turno_de === token.id && puedoTerminarTurno()) items.push({ texto: '⏭️ Terminar turno', accion: terminarTurno });
        // El GM decide quién participa en los turnos: sacar a alguien del combate (sigue en el mapa) o meterlo
        if (S.esGM && (S.combate.activo || S.combate.preparando)) {
          const dentro = (S.combate.preparando?.participantes || S.combate.orden || []).includes(token.id);
          items.push(dentro
            ? { texto: '➖ Sacar de los turnos', detalle: 'Deja de participar en este combate (sigue en el mapa)', accion: () => red.enviar({ tipo: 'gm_combate_turnos', token: token.id, dentro: false }) }
            : { texto: '➕ Añadir a los turnos', deshabilitado: !!token.derrotado, detalle: token.derrotado ? 'Está derrotado' : 'Entra en este combate en su sitio según la iniciativa',
              accion: () => red.enviar({ tipo: 'gm_combate_turnos', token: token.id, dentro: true }) });
        }
        if (hayTransformaciones(token)) items.push({ texto: '✨ Transformar…', detalle: 'Elegir la forma en una ventana', accion: () => abrirTransformar(token.id) });
        // Tamaño y grupos (como en Roll20): solo cambian cómo se ve el token y que se mueva junto a otros
        if (S.esGM || controloYo(token)) {
          const ESCALAS = [0.5, 0.75, 1, 1.5, 2, 3];
          const i = Math.max(0, ESCALAS.indexOf(token.escala || 1));
          const nombreEscala = (e) => ({ 0.5: 'muy pequeño', 0.75: 'pequeño', 1: 'normal', 1.5: 'grande', 2: 'muy grande', 3: 'enorme' })[e];
          const escalar = (e) => red.enviar({ tipo: 'token_escala', token: token.id, escala: e });
          items.push({ separador: true },
            { texto: '➕ Más grande', deshabilitado: i === ESCALAS.length - 1, detalle: `Ahora: ${nombreEscala(ESCALAS[i])}. Solo cambia cómo se ve`, accion: () => escalar(ESCALAS[i + 1]) },
            { texto: '➖ Más pequeño', deshabilitado: i === 0, detalle: `Ahora: ${nombreEscala(ESCALAS[i])}. Solo cambia cómo se ve`, accion: () => escalar(ESCALAS[i - 1]) });
          if (i !== ESCALAS.indexOf(1)) items.push({ texto: '↺ Tamaño normal', accion: () => escalar(1) });
          const mios = (o) => o.id !== token.id && (S.esGM || controloYo(o));
          const cerca = [...S.tokens.values()].filter((o) => mios(o) && (!token.grupo || o.grupo !== token.grupo)
            && Math.max(Math.abs(o.x - token.x), Math.abs(o.y - token.y)) <= 5).slice(0, 8);
          if (cerca.length) {
            items.push({ titulo: '🔗 Agrupar con (se mueven juntos)' },
              ...cerca.map((o) => ({ texto: o.nombre, detalle: 'Al mover uno, se mueven todos (fuera de combate)', accion: () => red.enviar({ tipo: 'agrupar_tokens', tokens: [token.id, o.id] }) })));
          }
          if (token.grupo) items.push({ texto: '✂️ Sacar del grupo', accion: () => red.enviar({ tipo: 'desagrupar_token', token: token.id }) });
        }
        if (token.tipo === 'personaje' && token.dueno !== S.usuario && !S.esGM && S.permisos.intercambios && S.tokenActivo && !S.intercambio) {
          items.push({ texto: `🤝 Intercambiar con ${token.nombre}`, accion: () => proponerIntercambio(token.dueno) });
        }
        const mioFueraDeCombate = token.tipo === 'personaje' && token.dueno === S.usuario && !S.combate.activo;
        if (S.esGM) {
          items.push({ separador: true },
            { texto: `✨ Gestionar ${palabra('habilidades', 'Habilidades').toLowerCase()}…`, detalle: `Dar o quitar ${palabra('habilidades', 'habilidades').toLowerCase()} a este token`,
              accion: () => gestionarHabilidades(token.id) },
            Object.keys(S.catalogo.estados || {}).length ? { texto: '🌀 Estados…', detalle: 'Poner o quitar estados a este token', accion: () => {
              const tiene = new Set((token.estados || []).map((e) => e.id));
              abrirMenu(zona, x, y, [{ titulo: `Estados de ${token.nombre}` }, ...Object.entries(S.catalogo.estados).map(([id, e]) => ({
                texto: `${tiene.has(id) ? '✓ ' : ''}${e.nombre}`, detalle: tiene.has(id) ? 'Pulsa para quitarlo' : `Pulsa para ponerlo${e.duracion ? ` (${e.duracion} turnos)` : ' (permanente)'}`,
                accion: () => red.enviar({ tipo: 'gm_estado', token: token.id, estado: id, poner: !tiene.has(id) }) }))]);
            } } : null,
            (S.salasMapa || []).length > 1 ? { texto: '🚪 Llevar a otra sala…', detalle: token.grupo ? 'Se va con todo su grupo' : 'Aparece junto al punto de inicio de esa sala', accion: () => {
              abrirMenu(zona, x, y, [{ titulo: `Llevar a ${token.nombre} a…` }, ...S.salasMapa.filter((m) => m.id !== S.mapaId).map((m) => ({
                texto: m.nombre, detalle: [m.personajes ? `👤 ${m.personajes}` : '', m.npc ? `${m.npc} NPC` : ''].filter(Boolean).join(' · ') || 'Vacía',
                accion: () => red.enviar({ tipo: 'gm_mover_a_sala', token: token.id, mapa: m.id }) }))]);
            } } : null,
            token.tipo === 'personaje'
              ? { texto: '⬅️ Retirar del mapa', accion: () => retirarPersonaje(token.id), detalle: 'El personaje no se borra: se puede volver a desplegar' }
              : { texto: '✕ Quitar del mapa', peligro: true, accion: () => {
                if (confirm(`¿Quitar a ${token.nombre} del mapa?`)) red.enviar({ tipo: 'gm_quitar_token', token: token.id });
              } });
        } else if (mioFueraDeCombate) {
          items.push({ separador: true }, { texto: '↩️ Retirar mi personaje del mapa', accion: () => retirarPersonaje(token.id) });
        }
      } else {
        items.push({ titulo: `Casilla ${cx}, ${cy}` },
          { texto: '🔍 Analizar casilla', accion: () => analizar({ tipo: 'casilla', cx, cy }) });
        const tile = rompibleEn(cx, cy);           // un tile rompible o un objeto destruible
        if (tile && S.permisos.romper_casillas) {
          const quien = tokenFoco();
          const cerca = !!quien && Math.max(Math.abs(quien.x - cx), Math.abs(quien.y - cy)) <= 1;
          if (quien) {
            items.push({ texto: `🔨 Golpear ${tile.nombre.toLowerCase()}`, deshabilitado: !cerca, detalle: cerca ? `Aguanta ${tile.golpes} golpes` : `${quien.nombre} está lejos`,
              accion: () => red.enviar({ tipo: 'golpear_casilla', token: quien.id, x: cx, y: cy }) });
          }
          if (S.esGM) items.push({ texto: '💥 Romper de golpe', accion: () => red.enviar({ tipo: 'golpear_casilla', x: cx, y: cy, romper: true }) });
        }
        if (!S.esGM && S.catalogo.reglas?.desplegar_en_casilla && personajesDesplegables().length) {
          const libre = vista.casillaLibre(cx, cy, null);
          const veo = !S.niebla || S.niebla[cy]?.[cx] === '1';
          const motivo = S.combate.activo ? 'Durante un combate, solo el GM' : !veo ? 'Con niebla, solo donde ves' : !libre ? 'Casilla bloqueada u ocupada' : '';
          items.push({ texto: '📍 Desplegar token…', deshabilitado: !!motivo, detalle: motivo || 'Elegir qué personaje aparece en esta casilla', accion: () => abrirDesplegar(cx, cy) });
        }
        if (S.esGM) {
          const libre = vista.casillaLibre(cx, cy, null);
          const foco = tokenFoco();
          if (foco) {
            items.push({ texto: `Mover aquí a ${foco.nombre}`, deshabilitado: !libre, detalle: libre ? '' : 'Casilla bloqueada u ocupada',
              accion: () => red.enviar({ tipo: 'mover_token', token: foco.id, x: cx, y: cy }) });
          }
          // Personajes que no están en ninguna sala y NPC de la campaña, en una ventana (con buscador y categorías) en vez de en el menú
          if (personajesDesplegables().length || Object.keys(S.catalogo.enemigos || {}).length) {
            items.push({ texto: '📍 Desplegar token…', deshabilitado: !libre, detalle: libre ? 'Elegir un personaje o un NPC para esta casilla' : 'Casilla bloqueada u ocupada',
              accion: () => abrirDesplegar(cx, cy) });
          }
        }
      }
      abrirMenu(zona, x, y, items);
    },
    alZoom(z) { zoomRango.value = String(Math.round(z * 100)); zoomTexto.textContent = `${Math.round(z * 100)}%`; },
  });
  herramientas.firstChild.classList.add('activa');
  pintarPanelDibujo();

  escuchar('modo-objetivo', (m) => {
    limpiarModos();
    const origen = S.tokens.get(m.tokenId);
    if (!origen) return;
    modoObj = m;
    vista.setModoObjetivo({ origen, alcance: m.alcance, sinLimite: m.sinLimite, area: m.area, dano: m.dano });
    const alc = ['cono', 'casillas'].includes(m.area?.forma) ? 'sale de ti hacia donde apuntes' : m.sinLimite ? 'sin límite de alcance' : `alcance ${textoMedida(m.alcance)}`;
    mostrarAviso(m.area ? `Apunta ${m.nombre} a un token o a una casilla (${alc}): en rojo, lo que alcanzará. Esc para cancelar.`
      : `Elige un objetivo para ${m.nombre} (${alc}). Esc para cancelar.`);
  });
  escuchar('modo-colocar', ({ enemigo }) => {
    limpiarModos();
    modoCol = enemigo;
    vista.setModoColocar(true);
    mostrarAviso(`Haz clic en el mapa para colocar a ${S.catalogo.enemigos[enemigo]?.nombre || 'el NPC'}. Esc para terminar.`);
  });
  escuchar('cancelar-modos', limpiarModos);
  escuchar('ping', (m) => vista.ping(m.x, m.y, m.usuario));
  // Atajos: V cursor · H mano · R regla · L lápiz · + / − zoom · 0 restablecer zoom · Esc cancelar.
  const ATAJOS = { v: 'cursor', h: 'mano', r: 'regla', l: 'lapiz' };
  const alTecla = (e) => {
    if (escribiendo(e)) return;
    if (e.key === 'Escape') { limpiarModos(); alternarSalas(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (ATAJOS[k]) elegirHerramienta(ATAJOS[k]);
    else if (k === '+' || k === '=') vista.zoomCentro(vista.cam.zoom * 1.25);
    else if (k === '-') vista.zoomCentro(vista.cam.zoom / 1.25);
    else if (k === '0') vista.zoomCentro(1);
  };
  window.addEventListener('keydown', alTecla);

  // ── Tira de iniciativa ──────────────────────────────────────
  function pintarTira() {
    const c = S.combate;
    sincronizarTurnos();                      // la ventanita «Decidiendo los turnos» se abre y se cierra sola
    botonTurno.disabled = !puedoTerminarTurno();
    if (c.preparando) {          // decidiendo turnos: cada jugador tira la iniciativa de lo suyo; el GM puede empezar ya
      const p = c.preparando;
      const chips = p.participantes.map((id) => {
        const t = S.tokens.get(id);
        if (!t) return null;
        const valor = p.tiradas[id];
        const puedo = valor == null && puedoControlar(t);
        return h('div', { class: 'chip-turno', 'data-turno': id }, retrato(t.imagen, t.nombre, 'mini'), h('span', { class: 'chip-nombre' }, t.nombre),
          valor != null ? h('strong', { class: 'chip-valor' }, String(valor))
            : puedo ? h('button', { class: 'btn btn-mini', 'data-accion': 'tirar-iniciativa', onclick: () => red.enviar({ tipo: 'tirar_iniciativa', token: id }) }, '🎲 Tirar')
              : h('span', { class: 'tenue pequeno' }, '…'));
      });
      tira.replaceChildren(...[h('span', { class: 'tira-ronda' }, p.modo === 'manual' ? '🧭 El GM ordena los turnos' : '🎲 Decidiendo turnos'), h('button', { class: 'btn btn-mini', 'data-accion': 'abrir-turnos', title: 'Abrir la ventana de turnos', onclick: abrirTurnos }, 'Ver ventana'), ...(p.modo === 'manual' ? [] : chips),
        S.esGM ? h('button', { class: 'btn btn-mini btn-acento', 'data-accion': 'empezar-combate', title: 'Se tira por quien falte', onclick: () => red.enviar({ tipo: 'gm_empezar_combate' }) }, 'Empezar ya') : null].filter(Boolean));
      return;
    }
    if (!c.activo) {
      tira.replaceChildren(h('span', { class: 'tira-vacia' }, 'Sin combate'));
      return;
    }
    // El GM puede cambiar el orden de los turnos con las flechas de cada participante.
    const mover = (i, d) => { const o = [...c.orden]; [o[i], o[i + d]] = [o[i + d], o[i]]; red.enviar({ tipo: 'gm_orden_turnos', orden: o }); };
    const chips = c.orden.map((id, i) => {
      const t = S.tokens.get(id);
      if (!t) return null;
      const clase = `chip-turno${id === c.turno_de ? ' actual' : ''}${t.derrotado ? ' caido' : ''}${t.tipo === 'enemigo' ? ` ${bandoDe(t)}` : ''}`;
      const flechas = S.esGM && c.orden.length > 1 ? h('span', { class: 'chip-orden' },
        h('button', { class: 'chip-flecha', title: 'Antes', 'aria-label': `Mover a ${t.nombre} antes`, disabled: i === 0, 'data-accion': 'turno-antes', onclick: (e) => { e.stopPropagation(); mover(i, -1); } }, '◀'),
        h('button', { class: 'chip-flecha', title: 'Después', 'aria-label': `Mover a ${t.nombre} después`, disabled: i === c.orden.length - 1, 'data-accion': 'turno-despues', onclick: (e) => { e.stopPropagation(); mover(i, 1); } }, '▶')) : null;
      return h('div', { class: clase, title: t.nombre, 'data-turno': id }, retrato(t.imagen, t.nombre, 'mini'), h('span', { class: 'chip-nombre' }, t.nombre), flechas);
    });
    const mov = c.movimiento && S.tokens.get(c.movimiento.token);
    const movTxt = mov && (S.esGM || controloYo(mov))
      ? h('span', { class: `tira-movimiento${c.movimiento.quedan === 0 ? ' agotado' : ''}`, 'data-quedan': String(c.movimiento.quedan), title: `Casillas que ${mov.nombre} puede andar en este turno` },
        `👣 ${c.movimiento.quedan}/${c.movimiento.max}`) : null;
    tira.replaceChildren(...[h('span', { class: 'tira-ronda' }, `Ronda ${c.ronda}`), movTxt, ...chips].filter(Boolean));
    tira.querySelector('.actual')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function pintarCabecera() {
    tituloSala.textContent = S.mapa?.nombre || '';
    subtituloSala.textContent = S.servidor?.nombre || '';
    usuarioEtiqueta.textContent = `${S.usuario}${S.esGM ? ' (GM)' : ''}`;
    const ciclo = S.catalogo?.ciclo;
    chipPeriodo.hidden = !ciclo?.activo;
    if (ciclo?.activo) {
      chipPeriodo.textContent = `🕒 ${ciclo.periodos[S.periodo]?.nombre || ''}`;
      chipPeriodo.title = S.esGM ? 'Pulsa para pasar al siguiente momento del día' : 'Momento del día';
      chipPeriodo.disabled = !S.esGM;
    }
    const clima = S.catalogo?.clima;
    chipClima.hidden = !clima?.activo;
    if (clima?.activo) {
      chipClima.textContent = `🌦️ ${clima.tipos[S.clima]?.nombre || ''}`;
      chipClima.title = S.esGM ? 'Pulsa para pasar al siguiente clima' : 'Clima';
      chipClima.disabled = !S.esGM;
    }
  }

  escuchar('celdas', () => vista.marcar());
  escuchar('periodo', () => { pintarCabecera(); vista.marcar(); });
  escuchar('clima', () => { pintarCabecera(); vista.marcar(); });
  escuchar('dibujos', () => { vista.marcar(); pintarPanelDibujo(); vista.actualizarCursor(); });
  escuchar('lapices', () => vista.marcar());
  // Solo se reencuadra la vista al cambiar de mapa (o de tamaño): un «estado» nuevo del mismo mapa (niebla, capas…)
  // no debe deshacer el zoom ni el desplazamiento que eligió el usuario.
  let mapaEncuadrado = S.mapa ? `${S.mapaId}:${S.mapa.ancho}x${S.mapa.alto}` : null;
  escuchar('mapa', () => {
    pintarCabecera(); vista.marcar();
    const clave = S.mapa ? `${S.mapaId}:${S.mapa.ancho}x${S.mapa.alto}` : null;
    if (clave !== mapaEncuadrado) { mapaEncuadrado = clave; requestAnimationFrame(() => vista.ajustar()); }
    if (!panelSalas.hidden) pintarSalas();
  });
  escuchar('tokens', () => {
    vista.marcar();
    pintarTira();
    if (!tooltip.hidden && hoverId) {       // el tooltip abierto refleja los cambios (daño, curación) al instante
      const t = S.tokens.get(hoverId);
      if (t) pintarTooltip(t); else { tooltip.hidden = true; hoverId = null; }
    }
  });
  escuchar('combate', () => { vista.marcar(); pintarTira(); });
  escuchar('foco', () => vista.marcar());
  escuchar('ajustes', () => vista.marcar());
  escuchar('imagen-cargada', () => { vista.marcar(); pintarTira(); });

  if (S.esGM) pedirPersonajes();
  pintarCabecera();
  pintarTira();
  aplicarIzq();
  aplicarDer();
  requestAnimationFrame(() => { vista.redimensionar(); vista.ajustar(); });

  return {
    el: raiz,
    vista,
    destruir() {
      offs.forEach((f) => f());
      window.removeEventListener('keydown', alTecla);
      cerrarMenu();
      vista.destruir();
      musica.destruir();
      listaPers.destruir();
      chat.destruir();
    },
  };
}
