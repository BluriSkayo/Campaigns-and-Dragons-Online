// nombres.js — nombres de archivo (sin dependencias, para poder probarlo solo).
const path = require('path');

/** Nombre de un archivo de música, ambiente o efecto tal cual lo puso su dueño («Taberna Baja»): se respetan mayúsculas, espacios y acentos.
 *  Solo se cambian los caracteres que ningún sistema de archivos admite, los puntos seguidos y los espacios o puntos de los extremos. */
function nombreDeAudio(origen) {
  const base = path.basename(String(origen), path.extname(String(origen)))
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 100)
    .replace(/^[ .]+|[ .]+$/g, '');             // después de recortar: Windows no admite un espacio o un punto al final
  // Windows no deja crear archivos con estos nombres (CON, NUL, COM1…), aunque lleven extensión
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(base)) return `${base}_`;
  return base || 'archivo';
}

module.exports = { nombreDeAudio };
