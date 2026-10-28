// pixel.js — Iconos en pixel art (src/img/interfaz) en lugar de emojis. h() los pone solo al encontrar el emoji en un texto;
// lo que no tenga dibujo (✕, ✋…) se queda como emoji. Para añadir uno: el PNG en src/img/interfaz y una línea en MAPA.
export const MAPA = {
  '🧑‍🤝‍🧑': 'jugadores', '👥': 'jugadores', '👤': 'personaje', '🧑': 'personaje', '🧙': 'personaje',
  '🔒': 'candado', '🔓': 'candado_abierto', '⚠': 'aviso', '⛔': 'error', '❌': 'error', '🚫': 'error',
  '✅': 'correcto', '✔': 'correcto', '📦': 'paquete', '📥': 'importar', '💾': 'guardar', '🗑': 'papelera',
  '👁': 'ojo', '🎲': 'dado', '⚙': 'ajustes', '🎛': 'ajustes', '🧽': 'borrador', '🖼': 'imagen', '📁': 'carpeta', '🗂': 'carpeta',
  '🧬': 'razas_clases', '🪙': 'moneda', '⬆': 'subir_nivel', '📊': 'estadisticas', '⭐': 'estrella', '📍': 'punto',
  '🧪': 'probar', '✨': 'efectos', '🎵': 'musica', '♪': 'musica', '🔊': 'sonido', '🌫': 'niebla', '🌧': 'niebla',
  '➕': 'mas', '➖': 'menos', '🔗': 'enlace', '✂': 'cortar', '🛡': 'escudo', '⚔': 'espadas', '⚡': 'rayo',
  '👣': 'pasos', '🕒': 'reloj', '🎯': 'diana', '💥': 'explosion', '🧲': 'iman', '💨': 'viento', '🔨': 'martillo',
  '🤝': 'apreton', '🔍': 'lupa', '🏷': 'etiqueta', '📖': 'diario', '📚': 'diario', '🗺': 'mapas', '🏪': 'tiendas',
  '🎒': 'mochila', '🧱': 'muro', '🌀': 'remolino', '📄': 'documento', '📝': 'documento', '📋': 'documento',
  '❓': 'pregunta', '🏠': 'casa',
  // Tanda del 27-oct-2026: iconos nuevos (lapiz, avanceflecha, puerta, exportar, burbujatexto) y emojis que reutilizan uno que ya había
  '✏': 'lapiz', '✎': 'lapiz', '📜': 'documento', '⏭': 'avanceflecha', '🚪': 'puerta', '📤': 'exportar', '🔑': 'etiqueta',
  '🎁': 'apreton', '👾': 'personaje', '🎭': 'personaje', '🙂': 'burbujatexto', '🟦': 'correcto', '🟨': 'menos', '🟥': 'error',
  '🌦': 'viento', '🧭': 'reloj', '📂': 'carpeta',
  // Tanda 2 del 27-oct-2026: mensajes del chat (calavera, banderaroja y banderablanca son nuevos)
  '☠': 'calavera', '🏁': 'banderaroja', '🏳': 'banderablanca', '🔀': 'etiqueta', '🎉': 'subir_nivel', '🏆': 'efectos',
  '💰': 'moneda', '🛒': 'mochila', '🛠': 'ajustes', '👑': 'estrella', '😵': 'pregunta', '↩': 'remolino', '✦': 'efectos',
  '⏳': 'reloj', '🧹': 'martillo', '⬅': 'flechaatras',
};
const claves = Object.keys(MAPA).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const RE = new RegExp(`(${claves.join('|')})️?`, 'gu');

/** Imagen de un icono de la interfaz. tam: 16 (su tamaño real) o múltiplos para que el pixel art no se emborrone. */
export function iconoPx(nombre, tam = 16, alt = '') {
  const img = document.createElement('img');
  img.src = `img/interfaz/${nombre}.png`;
  img.className = 'ico-px';
  img.width = tam; img.height = tam;
  img.alt = alt;
  img.draggable = false;
  return img;
}

/** Texto → [nodos]: los emojis con dibujo pasan a ser su icono. null si el texto no tiene ninguno. */
export function conIconos(texto) {
  RE.lastIndex = 0;
  if (!RE.test(texto)) return null;
  RE.lastIndex = 0;
  const res = [];
  let i = 0;
  for (const m of texto.matchAll(RE)) {
    if (m.index > i) res.push(document.createTextNode(texto.slice(i, m.index)));
    res.push(iconoPx(MAPA[m[1]], 16, m[1]));
    i = m.index + m[0].length;
  }
  if (i < texto.length) res.push(document.createTextNode(texto.slice(i)));
  return res;
}
