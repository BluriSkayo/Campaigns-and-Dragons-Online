// ventanas/ajustes.js — Configuración local de este cliente (no afecta a los demás jugadores).
import { h, toast } from '../util.js';
import { S, bus } from '../almacen.js';
import { ajustes, guardar } from '../ajustes.js';
import { abrirVentana } from '../ventanas.js';
import { red } from '../red.js';
import { hayAlmacen, usoArchivos, abrirCarpeta, importarZip } from '../archivos.js';

function interruptor(texto, clave) {
  const c = h('input', { type: 'checkbox' });
  c.checked = !!ajustes[clave];
  c.addEventListener('change', () => guardar({ [clave]: c.checked }));
  return h('label', { class: 'interruptor' }, c, h('span', null, texto));
}

/** Barras sobre los tokens: cuáles quiero ver (de las que muestra la campaña) y si también en los tokens de los demás. */
function seccionBarras() {
  const barras = S.catalogo?.sobre_tokens?.barras || [];
  if (!barras.length) return [];
  const casilla = (r) => {
    const c = h('input', { type: 'checkbox', 'data-barra': r });
    c.checked = ajustes.barras?.[r] !== false;
    c.addEventListener('change', () => { const n = { ...(ajustes.barras || {}) }; if (c.checked) delete n[r]; else n[r] = false; guardar({ barras: n }); });
    return h('label', { class: 'interruptor' }, c, h('span', null, `Barra de ${r}`));
  };
  const deOtros = (S.catalogo.sobre_tokens.barras_jugadores || S.catalogo.sobre_tokens.barras_npc) && !S.esGM;
  return [h('p', { class: 'tenue pequeno ajustes-nota' }, 'Barras bajo los tokens:'), ...barras.map(casilla),
    deOtros ? interruptor('Ver también las barras de los demás', 'barrasAjenas') : null];
}

function tamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const NOMBRES = { tokens: 'Tokens', maps: 'Mapas', icons: 'Iconos', tiles: 'Casillas', 'sonido/musica': 'Música', 'sonido/ambiente': 'Ambiente', 'sonido/efectos': 'Efectos', otros: 'Otros' };

function seccionArchivos() {
  const uso = h('dl', { class: 'stats uso' });
  const pintar = async () => {
    try {
      const u = await usoArchivos();
      uso.replaceChildren(...Object.keys(NOMBRES).flatMap((c) => {
        const { archivos, bytes } = u.categorias[c];
        return [h('dt', { title: NOMBRES[c] }, `base/${c}`), h('dd', null, `${archivos} ${archivos === 1 ? 'archivo' : 'archivos'}, ${tamano(bytes)}`)];
      }));
    } catch { uso.replaceChildren(h('dt', null, 'No se pudo leer la carpeta')); }
  };
  pintar();

  const resultado = h('p', { class: 'tenue pequeno', 'aria-live': 'polite', 'data-resultado': 'zip' });
  const importar = async () => {
    try {
      const r = await importarZip(S.campana || '');
      if (!r) return;
      resultado.textContent = `✅ ${r.copiados} archivos de «${r.nombre}» instalados${r.omitidos ? ` (${r.omitidos} ignorados por no ser imágenes ni sonidos)` : ''}.`;
      bus.emit('archivos'); pintar();
    } catch (e) { resultado.textContent = `⚠️ ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`; }
  };
  return [
    h('h4', { class: 'sub' }, 'Archivos de la campaña'),
    h('p', { class: 'tenue pequeno' }, 'Las imágenes y los sonidos no viajan por el servidor: el GM te pasa un .zip con los de su campaña y lo instalas aquí (cada campaña tiene su propia carpeta).'),
    h('div', { class: 'fila-botones' },
      h('button', { class: 'btn btn-acento', 'data-accion': 'importar-zip', onclick: importar }, '📦 Importar archivos de campaña (.zip)…'),
      h('button', { class: 'btn', onclick: () => abrirCarpeta() }, 'Abrir carpeta')),
    resultado,
    uso,
  ];
}

function seccionContrasena() {
  const tiene = !!S.cuenta?.tiene_password;
  const actual = h('input', { type: 'password', placeholder: 'Contraseña actual', autocomplete: 'off', id: 'f-clave-actual' });
  const nueva = h('input', { type: 'password', placeholder: 'Contraseña nueva', autocomplete: 'off', id: 'f-clave-nueva' });
  const guardarClave = (b) => {
    if (!nueva.value) { toast('Escribe la contraseña nueva.', 'error'); return; }
    red.enviar({ tipo: 'cambiar_contrasena', nueva: nueva.value, actual: tiene ? actual.value : undefined });
    b.disabled = true;
    setTimeout(() => { b.disabled = false; }, 1000);
  };
  return [
    h('h4', { class: 'sub' }, 'Tu contraseña'),
    h('p', { class: 'tenue pequeno' }, tiene ? 'Tu usuario está protegido con contraseña.' : 'Tu usuario no tiene contraseña: cualquiera podría entrar con tu nombre.'),
    tiene ? h('div', { class: 'campo' }, actual) : null,
    h('div', { class: 'campo' }, nueva),
    h('button', { class: 'btn', onclick: (e) => guardarClave(e.currentTarget) }, tiene ? 'Cambiar contraseña' : 'Poner contraseña'),
  ];
}

function contenido() {
  return h('div', { class: 'ajustes' },
    h('h4', { class: 'sub primero' }, 'Mapa'),
    interruptor('Mostrar la cuadrícula', 'cuadricula'),
    interruptor('Mostrar los nombres de los tokens', 'nombres'),
    ...seccionBarras(),
    S.esGM ? interruptor('Mostrar los puntos importantes del mapa', 'puntos') : null,
    hayAlmacen ? seccionArchivos() : null,
    ...seccionContrasena(),
    h('h4', { class: 'sub' }, 'Conexión'),
    h('p', { class: 'tenue' }, `Servidor: ${S.servidor?.nombre || '—'}`),
    h('p', { class: 'tenue' }, `Usuario: ${S.usuario}${S.esGM ? ' (GM)' : ''}`),
    ...acercaDe(),
    );
}

/** «Acerca de…»: nombre del programa y créditos. */
export function acercaDe() {
  return [h('h4', { class: 'sub', 'data-seccion': 'acerca-de' }, 'Acerca de…'),
    h('p', null, h('strong', null, 'Campaigns and Dragons Online'), ', creado por ', h('strong', null, 'BluriSkayo')),
    h('p', { class: 'tenue' }, 'Íconos de habilidades: ', h('strong', null, 'jfranci_px'))];
}

export const DEF_AJUSTES = { id: 'ajustes', titulo: 'Ajustes', ancho: 340, render: contenido, eventos: ['cuenta'] };
export const abrirAjustes = () => abrirVentana(DEF_AJUSTES);
