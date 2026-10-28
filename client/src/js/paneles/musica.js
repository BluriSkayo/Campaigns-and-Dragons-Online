// paneles/musica.js — Reproductor. Las listas las define el servidor: aquí solo se ve lo que él ofrece, no lo que haya en tu carpeta.
// Cada archivo sale en verde si lo tienes en este equipo y en rojo si te falta. Están agrupados por categorías.
// Los jugadores ven solo la música; el GM ve además pestañas de Ambiente y Efectos (que oyen todos).
// Quién puede poner música lo decide el servidor (permisos.controlar_musica). «Repetir» es una preferencia de este equipo.
import { h, toast, sinSaltoDeScroll } from '../util.js';
import { S, bus } from '../almacen.js';
import { ajustes, guardar } from '../ajustes.js';
import { red } from '../red.js';
import { icono } from '../iconos.js';
import { aplicarVolumen, aplicarBucle } from '../musica.js';
import { listarArchivos } from '../archivos.js';

function deslizador(etiqueta, clave, alCambiar) {
  const valor = h('span', { class: 'vol-valor' }, `${Math.round(ajustes[clave] * 100)}%`);
  const rango = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(ajustes[clave] * 100)),
    'aria-label': etiqueta });
  rango.addEventListener('input', () => {
    guardar({ [clave]: Number(rango.value) / 100 });
    valor.textContent = `${rango.value}%`;
    alCambiar?.();
  });
  return h('label', { class: 'vol' }, h('span', { class: 'vol-nombre' }, etiqueta), rango, valor);
}

const PESTANAS = [['musica', 'Música'], ['ambiente', 'Ambiente'], ['efectos', 'Efectos']];

export function crearPanelMusica() {
  let pestana = 'musica';
  const contenido = h('div', { class: 'musica-contenido' });
  const pestanasEl = h('div', { class: 'musica-pestanas', role: 'tablist' });
  const ahora = h('div', { class: 'musica-ahora' });
  const pararYa = h('button', { class: 'btn-icono', title: 'Parar la música de golpe', 'aria-label': 'Parar la música de golpe', 'data-accion': 'parar-ya',
    onclick: () => pedir(null, false) }, icono('parar', 16));
  const pararFundido = h('button', { class: 'btn-icono btn-texto', title: 'Parar la música apagándola poco a poco', 'aria-label': 'Parar con fundido', 'data-accion': 'parar-fundido',
    onclick: () => pedir(null, true) }, icono('parar', 16), ' Fundido');

  const pedir = (archivo, gradual = false) => {
    if (!S.permisos.controlar_musica) { toast('No tienes permiso para controlar la música.', 'info'); return; }
    red.enviar({ tipo: 'reproducir_musica', archivo, ...(gradual ? { gradual: true } : {}) });
  };
  const alternarAmbiente = (archivo) => red.enviar({ tipo: 'sonido_ambiente', archivo, activo: !(S.ambiente || []).includes(archivo) });
  const lanzarEfecto = (archivo) => red.enviar({ tipo: 'sonido_efecto', archivo });

  let locales = new Set();
  const lista = (tipo) => S.catalogo?.sonidos?.[tipo] || [];
  const rescanear = async () => {
    const [m, a, e] = await Promise.all(['musica', 'ambiente', 'efectos'].map((c) => listarArchivos(`sonido/${c}`)));
    locales = new Set([...m.map((n) => `musica/${n}`), ...a.map((n) => `ambiente/${n}`), ...e.map((n) => `efectos/${n}`)]);
    pintar();
  };
  const tiene = (tipo, archivo) => locales.has(`${tipo}/${archivo}`);
  const titulo = (tipo, archivo, accion) => (tiene(tipo, archivo) ? accion : `Te falta el archivo «${archivo}» en base/sonido/${tipo}`);

  /** Las categorías con sus archivos; `fila` crea cada elemento clicable. Cada categoría se pliega por su cuenta (se recuerda en este equipo);
   *  plegada, sigue avisando si dentro hay algo sonando. */
  function categorias(tipo, fila, suena = () => false) {
    const grupos = lista(tipo).filter((g) => g.archivos.length);
    const plegadas = ajustes.categoriasPlegadas || {};
    return grupos.map((g) => {
      const clave = `${tipo}/${g.categoria}`;
      const plegada = !!plegadas[clave];
      const sonando = plegada && g.archivos.some(suena);
      const cab = h('button', { type: 'button', class: 'musica-cat-cab', 'aria-expanded': String(!plegada), 'data-accion': 'plegar-categoria',
        title: plegada ? 'Desplegar esta categoría' : 'Plegar esta categoría',
        onclick: () => { const n = { ...(ajustes.categoriasPlegadas || {}) }; if (plegada) delete n[clave]; else n[clave] = true; guardar({ categoriasPlegadas: n }); pintar(); } },
      h('span', { class: 'musica-flecha', 'aria-hidden': 'true' }, '▾'), h('span', { class: 'sub' }, g.categoria),
      h('span', { class: 'musica-cat-cuenta' }, `${sonando ? '♪ ' : ''}${g.archivos.length}`));
      return h('section', { class: `musica-cat${plegada ? ' plegada' : ''}`, 'data-categoria': g.categoria },
        cab, plegada ? null : h('ul', { class: 'musica-lista' }, g.archivos.map((a) => fila(a))));
    });
  }
  const casillaRepetir = (clave, etiqueta) => {
    const c = h('input', { type: 'checkbox', 'data-ajuste': clave, 'aria-label': etiqueta });
    c.checked = ajustes[clave] !== false;
    c.addEventListener('change', () => { guardar({ [clave]: c.checked }); aplicarBucle(); });
    return h('label', { class: 'musica-repetir' }, c, ` ${etiqueta}`);
  };

  function pintarMusica() {
    const puede = !!S.permisos.controlar_musica;
    const cats = categorias('musica', (a) => h('li', {
      class: `pista ${tiene('musica', a) ? 'tiene' : 'falta'}${S.musica === a ? ' sonando' : ''}${puede ? '' : ' bloqueada'}`, 'data-sonido': a,
      tabindex: '0', title: titulo('musica', a, puede ? 'Doble clic para reproducir' : 'Solo quien controla la música puede cambiarla'),
      ondblclick: () => pedir(a), onkeydown: (e) => { if (e.key === 'Enter') pedir(a); },
    }, a), (a) => S.musica === a);
    ahora.textContent = S.musica ? `Sonando: ${S.musica}` : 'Sin música';
    pararYa.hidden = pararFundido.hidden = !puede || !S.musica;
    return [h('div', { class: 'musica-paros' }, pararFundido, pararYa), ahora, ...cats, cats.length ? null : h('p', { class: 'musica-ayuda' }, 'El servidor no ofrece música.'),
      casillaRepetir('bucleMusica', 'Repetir'), deslizador('Música', 'volMusica', aplicarVolumen)];
  }
  function pintarAmbiente() {
    const cats = categorias('ambiente', (a) => {
      const suena = (S.ambiente || []).includes(a);
      return h('li', { class: `pista ${tiene('ambiente', a) ? 'tiene' : 'falta'}${suena ? ' sonando' : ''}`, 'data-ambiente': a, tabindex: '0',
        title: titulo('ambiente', a, 'Clic para encender o apagar (lo oyen todos)'), onclick: () => alternarAmbiente(a), onkeydown: (e) => { if (e.key === 'Enter') alternarAmbiente(a); } },
      `${suena ? '🔊 ' : ''}${a}`);
    }, (a) => (S.ambiente || []).includes(a));
    return [h('button', { class: 'btn btn-mini', 'data-accion': 'parar-ambiente', hidden: !(S.ambiente || []).length, onclick: () => red.enviar({ tipo: 'sonido_ambiente', archivo: null }) }, 'Apagar todo el ambiente'),
      ...cats, h('p', { class: 'musica-ayuda' }, cats.length ? 'Clic para encender o apagar. Pueden sonar varios a la vez, y los oyen todos los jugadores que tengan el archivo.' : 'El servidor no ofrece sonidos de ambiente.'),
      casillaRepetir('bucleAmbiente', 'Repetir'), deslizador('Ambiente', 'volAmbiente', aplicarVolumen)];
  }
  function pintarEfectos() {
    const cats = categorias('efectos', (a) => h('li', { class: `pista ${tiene('efectos', a) ? 'tiene' : 'falta'}`, 'data-efecto': a, tabindex: '0',
      title: titulo('efectos', a, 'Clic para lanzarlo (lo oyen todos)'), onclick: () => lanzarEfecto(a), onkeydown: (e) => { if (e.key === 'Enter') lanzarEfecto(a); } }, a));
    return [...cats, h('p', { class: 'musica-ayuda' }, cats.length ? 'Clic para lanzarlo: suena una vez en el equipo de todos los jugadores que lo tengan.' : 'El servidor no ofrece efectos.'),
      deslizador('Efectos y avisos', 'volSonidos')];
  }

  function pintar() {
    const esGM = !!S.esGM;
    if (!esGM) pestana = 'musica';
    pestanasEl.hidden = !esGM;
    pestanasEl.replaceChildren(...PESTANAS.map(([id, t]) => h('button', { type: 'button', role: 'tab', class: `musica-pestana${pestana === id ? ' activa' : ''}`, 'data-pestana': id,
      'aria-selected': String(pestana === id), onclick: () => { pestana = id; pintar(); } }, t)));
    const plegada = !!ajustes.musicaPlegada;
    el.classList.toggle('plegada', plegada);
    plegar.setAttribute('aria-expanded', String(!plegada));
    plegar.title = plegada ? 'Desplegar la música' : 'Plegar la música (más sitio para el chat)';
    resumen.textContent = plegada && S.musica ? `♪ ${S.musica}` : '';
    contenido.hidden = plegada;
    if (plegada) pestanasEl.hidden = true;
    sinSaltoDeScroll(contenido, () => contenido.replaceChildren(...(plegada ? [] : pestana === 'ambiente' ? pintarAmbiente() : pestana === 'efectos' ? pintarEfectos() : pintarMusica()).filter(Boolean)));
  }

  const offs = [bus.on('archivos', () => rescanear()), bus.on('musica', pintar), bus.on('estado', pintar), bus.on('permisos', pintar), bus.on('ambiente', pintar)];
  const alEnfocar = () => rescanear();
  window.addEventListener('focus', alEnfocar);
  const resumen = h('span', { class: 'musica-resumen' });
  const plegar = h('button', { type: 'button', class: 'musica-plegar', 'data-accion': 'plegar-musica', 'aria-label': 'Plegar o desplegar la música',
    onclick: () => { guardar({ musicaPlegada: !ajustes.musicaPlegada }); pintar(); } },
  h('span', { class: 'musica-flecha', 'aria-hidden': 'true' }, '▾'), h('h2', { class: 'panel-titulo' }, 'Música'));
  const el = h('section', { class: 'musica', 'aria-label': 'Música' },
    h('div', { class: 'musica-cab' }, plegar, resumen), pestanasEl, contenido);
  rescanear();
  pintar();

  return { el, destruir: () => { offs.forEach((f) => f()); window.removeEventListener('focus', alEnfocar); } };
}
