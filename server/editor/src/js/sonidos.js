// sonidos.js — «Sonidos»: las listas de música, ambiente y efectos de la campaña, como la lista de canciones de Attorney Online:
// cada lista tiene categorías y cada categoría, nombres de archivo. Nada más (ni descripciones ni identificadores).
// Los audios viven en la carpeta de archivos de la campaña (base/sonido/…); aquí solo se guardan los nombres. Los cambios quedan en un borrador hasta pulsar «Guardar».
import { h, toast, confirmar, pedirTexto } from './util.js';
import { E, bus, recargarAssets } from './estado.js';
import { urlAsset, asegurarCliente } from './campos.js';

const TIPOS = [
  { id: 'musica', titulo: '🎵 Música', carpeta: 'sonido/musica',
    ayuda: 'La lista que ven todos los jugadores. Quien tenga permiso (Reglas → Funciones de la mesa) la pone para todos. Cada jugador la ve en verde si tiene el archivo en su cliente y en rojo si le falta.' },
  { id: 'ambiente', titulo: '🌧️ Ambiente', carpeta: 'sonido/ambiente',
    ayuda: 'Viento, lluvia, multitud… Solo el Game Master ve esta lista y decide cuáles suenan, pero lo oyen todos los jugadores que tengan el archivo.' },
  { id: 'efectos', titulo: '⚔️ Efectos', carpeta: 'sonido/efectos',
    ayuda: 'Sonidos cortos (golpes, puertas, trueno). Solo el Game Master los lanza y lo oyen todos los jugadores que tengan el archivo.' },
];

export function construirSonidos(p, ctx) {
  const raiz = h('div', { class: 'sonidos-ed' });
  let tipo = 'musica';
  let sonando = null, sonandoNombre = null;
  const parar = () => { if (sonando) { sonando.pause(); sonando = null; sonandoNombre = null; } };
  const datos = () => p.borrador;
  const grupos = () => (datos()[tipo] ||= []);
  const def = () => TIPOS.find((t) => t.id === tipo);
  const enCarpeta = () => E.campana.assets?.[def().carpeta] || [];
  const listados = () => new Set(grupos().flatMap((g) => g.archivos));

  function cambiar(fn) { fn(); ctx.alCambiar(); pintar(); }

  /** Importa archivos al cliente (los copia a base/sonido/<tipo>) y devuelve solo los nombres. */
  async function importar() {
    try {
      if (!(await asegurarCliente())) return [];
      const nuevos = await window.editor.importar(def().carpeta);
      if (!nuevos.length) return [];
      await recargarAssets();
      toast(`${nuevos.length} audio${nuevos.length === 1 ? '' : 's'} copiado${nuevos.length === 1 ? '' : 's'} a los archivos de la campaña (base/${def().carpeta}).`, 'ok');
      return nuevos.map((n) => n.split('/').pop());
    } catch (e) { toast(e.message, 'error'); return []; }
  }
  function anadirA(g, nombres) {
    const ya = listados();
    for (const n of nombres) if (!ya.has(n)) { g.archivos.push(n); ya.add(n); }
  }
  function categoriaNueva(nombre = 'Nueva categoría') {
    let n = nombre, i = 2;
    while (grupos().some((g) => g.categoria === n)) n = `${nombre} ${i++}`;
    const g = { categoria: n, archivos: [] };
    grupos().push(g);
    return g;
  }

  function escuchar(nombre, boton) {
    if (sonando && sonandoNombre === nombre) { parar(); pintar(); return; }
    parar();
    sonando = new Audio(urlAsset(`${def().carpeta}/${nombre}`)); sonando.volume = 0.6; sonandoNombre = nombre;
    sonando.addEventListener('ended', () => { parar(); pintar(); });
    sonando.play().catch(() => { toast('No se pudo reproducir este archivo.', 'error'); parar(); pintar(); });
    boton.textContent = '■';
  }

  // Categorías plegadas (cada una por su cuenta), recordadas en este equipo: «musica/Combate».
  const CLAVE_PLEGADAS = 'editor.sonidosPlegados';
  const plegadas = (() => { try { return new Set(JSON.parse(localStorage.getItem(CLAVE_PLEGADAS) || '[]')); } catch { return new Set(); } })();
  const alternarPlegada = (k) => {
    if (plegadas.has(k)) plegadas.delete(k); else plegadas.add(k);
    try { localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify([...plegadas].slice(-300))); } catch { /* sin almacenamiento */ }
    pintar();
  };

  function tarjeta(g, i) {
    const hay = new Set(enCarpeta());
    const clavePleg = `${tipo}/${g.categoria}`;
    const plegada = plegadas.has(clavePleg);
    const nombre = h('input', { type: 'text', class: 'entrada', value: g.categoria, maxlength: '40', 'aria-label': 'Nombre de la categoría', 'data-campo': 'categoria' });
    nombre.addEventListener('change', () => {
      const v = nombre.value.trim();
      if (!v) { nombre.value = g.categoria; return; }
      if (grupos().some((x) => x !== g && x.categoria === v)) { toast('Ya existe una categoría con ese nombre.', 'error'); nombre.value = g.categoria; return; }
      cambiar(() => { g.categoria = v; });
    });
    const mover = (d) => cambiar(() => { const l = grupos(); [l[i], l[i + d]] = [l[i + d], l[i]]; });
    const filas = g.archivos.map((a, k) => {
      const existe = hay.has(a);
      const oir = h('button', { type: 'button', class: 'btn btn-chico', title: existe ? 'Escuchar' : 'El archivo no está en los archivos de la campaña', disabled: !existe, 'data-accion': 'oir-sonido',
        onclick: (e) => escuchar(a, e.currentTarget) }, sonandoNombre === a ? '■' : '▶');
      const destino = h('select', { class: 'entrada entrada-chica', 'aria-label': `Mover ${a} a otra categoría`, 'data-accion': 'mover-sonido' },
        h('option', { value: '' }, 'Mover a…'), grupos().filter((x) => x !== g).map((x) => h('option', { value: x.categoria }, x.categoria)));
      destino.addEventListener('change', () => { const x = grupos().find((y) => y.categoria === destino.value); if (x) cambiar(() => { g.archivos.splice(k, 1); x.archivos.push(a); }); });
      return h('li', { class: `sonido-fila ${existe ? 'tiene' : 'falta'}`, 'data-archivo': a },
        h('span', { class: 'sonido-estado', title: existe ? 'Está en los archivos de la campaña' : 'No está en los archivos de la campaña: los jugadores que no lo tengan lo verán en rojo' }, existe ? '✓' : '⚠'),
        h('span', { class: 'sonido-nombre' }, a), oir, grupos().length > 1 ? destino : null,
        h('button', { type: 'button', class: 'btn btn-chico', title: 'Quitar de la lista (no borra el archivo)', 'aria-label': `Quitar ${a}`, 'data-accion': 'quitar-sonido', onclick: () => cambiar(() => g.archivos.splice(k, 1)) }, '✕'));
    });
    return h('section', { class: `sonido-cat${plegada ? ' plegada' : ''}`, 'data-categoria': g.categoria },
      h('div', { class: 'sonido-cat-cab' },
        h('button', { type: 'button', class: 'btn btn-chico sonido-plegar', 'aria-expanded': String(!plegada), 'data-accion': 'plegar-categoria',
          title: plegada ? 'Desplegar esta categoría' : 'Plegar esta categoría', 'aria-label': `${plegada ? 'Desplegar' : 'Plegar'} ${g.categoria}`, onclick: () => alternarPlegada(clavePleg) }, plegada ? '▸' : '▾'),
        nombre, h('span', { class: 'cuenta' }, g.archivos.length),
        h('div', { class: 'relleno' }),
        h('button', { type: 'button', class: 'btn btn-chico', title: 'Subir', 'aria-label': 'Subir categoría', disabled: i === 0, onclick: () => mover(-1) }, '▲'),
        h('button', { type: 'button', class: 'btn btn-chico', title: 'Bajar', 'aria-label': 'Bajar categoría', disabled: i === grupos().length - 1, onclick: () => mover(1) }, '▼'),
        h('button', { type: 'button', class: 'btn btn-chico', title: 'Eliminar categoría (no borra los archivos)', 'aria-label': 'Eliminar categoría', 'data-accion': 'borrar-categoria', onclick: async () => {
          if (g.archivos.length && !(await confirmar('Eliminar categoría', `¿Eliminar «${g.categoria}»? Sus ${g.archivos.length} archivos dejarán de estar en la lista (los audios no se borran).`, { si: 'Eliminar', peligro: true }))) return;
          cambiar(() => grupos().splice(i, 1));
        } }, '✕')),
      plegada ? null : filas.length ? h('ul', { class: 'sonido-lista' }, filas) : h('p', { class: 'ayuda' }, 'Vacía todavía.'),
      plegada ? null : h('div', { class: 'fila-inline' },
        h('button', { type: 'button', class: 'btn', 'data-accion': 'importar-en-categoria', onclick: async () => { const n = await importar(); if (n.length) cambiar(() => anadirA(g, n)); } }, '➕ Añadir audios…')));
  }

  function pintar() {
    parar();
    const d = def();
    const huerfanos = enCarpeta().filter((f) => !listados().has(f));
    const pestanas = h('div', { class: 'sonido-pestanas', role: 'tablist' }, TIPOS.map((t) => {
      const n = (datos()[t.id] || []).reduce((a, g) => a + g.archivos.length, 0);
      return h('button', { type: 'button', role: 'tab', class: `sonido-pestana${t.id === tipo ? ' activa' : ''}`, 'aria-selected': String(t.id === tipo), 'data-tipo': t.id,
        onclick: () => { tipo = t.id; pintar(); } }, t.titulo, h('span', { class: 'cuenta' }, n));
    }));
    const acciones = h('div', { class: 'fila-inline sonido-acciones' },
      h('button', { type: 'button', class: 'btn btn-acento', 'data-accion': 'importar-lista', onclick: async () => {
        const n = await importar(); if (!n.length) return;
        cambiar(() => anadirA(grupos()[0] || categoriaNueva('General'), n));
      } }, '📥 Importar audios…'),
      h('button', { type: 'button', class: 'btn', 'data-accion': 'nueva-categoria', onclick: async () => {
        const v = await pedirTexto('Nueva categoría', 'Nombre de la categoría', '', { si: 'Crear' });
        if (v && v.trim()) { if (grupos().some((g) => g.categoria === v.trim())) { toast('Ya existe una categoría con ese nombre.', 'error'); return; } cambiar(() => { grupos().push({ categoria: v.trim().slice(0, 40), archivos: [] }); }); }
      } }, '🗂️ Nueva categoría'),
      huerfanos.length ? h('button', { type: 'button', class: 'btn', 'data-accion': 'añadir-existentes', title: 'Mete en la lista los audios que ya están en los archivos de la campaña y todavía no aparecen aquí',
        onclick: () => cambiar(() => anadirA(grupos().find((g) => g.categoria === 'General') || categoriaNueva('General'), huerfanos)) }, `🔍 Añadir los ${huerfanos.length} que ya están en la carpeta de la campaña`) : null);
    const cats = grupos().map((g) => `${tipo}/${g.categoria}`);
    const todasPlegadas = cats.length && cats.every((k) => plegadas.has(k));
    const aviso = cats.length > 1 ? h('div', { class: 'fila-inline' }, h('button', { type: 'button', class: 'btn btn-chico', 'data-accion': 'plegar-todas',
      onclick: () => { for (const k of cats) { if (todasPlegadas) plegadas.delete(k); else plegadas.add(k); } try { localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify([...plegadas].slice(-300))); } catch { /* nada */ } pintar(); } },
    todasPlegadas ? '▾ Desplegar todas' : '▸ Plegar todas')) : null;
    raiz.replaceChildren(...[pestanas, h('p', { class: 'ayuda' }, d.ayuda), aviso, acciones,
      grupos().length ? h('div', { class: 'sonido-cats' }, grupos().map(tarjeta))
        : h('div', { class: 'vacio-suave' }, h('p', null, 'Esta lista está vacía.'), h('p', { class: 'ayuda' }, 'Pulsa «Importar audios…» y elige varios archivos a la vez: se copian al cliente y quedan en la lista.'))].filter(Boolean));
  }
  const apagar = bus.mientras(raiz, 'assets', () => { if (raiz.isConnected) pintar(); else apagar(); });
  pintar();
  return raiz;
}
