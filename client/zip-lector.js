// zip-lector.js — Lee un .zip (el que exporta el Editor o uno hecho a mano con el explorador de Windows / 7-Zip) sin librerías externas.
// Pensado para archivos que vienen de otra persona: limita tamaños y número de entradas (nada de «bombas zip»),
// comprueba el CRC de cada archivo y nunca devuelve rutas peligrosas (las filtra quien lo usa con normalizarRuta).
const zlib = require('zlib');

const LIMITES = { entradas: 5000, archivo: 300 * 1024 * 1024, total: 2 * 1024 * 1024 * 1024 };

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Nombres sin la marca UTF-8 (zips antiguos de Windows): página de códigos 437 → caracteres
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const decodificar = (buf, utf8) => (utf8 ? buf.toString('utf8') : [...buf].map((b) => (b < 128 ? String.fromCharCode(b) : CP437[b - 128])).join(''));

class ErrorZip extends Error {}

/** buf: Buffer con el .zip → [{ nombre, carpeta: bool, leer: () => Buffer }]. Lanza ErrorZip si no es un zip válido. */
function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new ErrorZip('El archivo no es un .zip válido');
  const n = buf.readUInt16LE(fin + 10), tam = buf.readUInt32LE(fin + 12), ini = buf.readUInt32LE(fin + 16);
  if (n === 0xffff || ini === 0xffffffff) throw new ErrorZip('Ese .zip es demasiado grande (formato ZIP64 no admitido)');
  if (n > LIMITES.entradas) throw new ErrorZip(`El .zip tiene demasiados archivos (máximo ${LIMITES.entradas})`);
  if (ini + tam > buf.length) throw new ErrorZip('El .zip está dañado');
  const res = [];
  let p = ini, total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ErrorZip('El .zip está dañado');
    const flags = buf.readUInt16LE(p + 8), metodo = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20), real = buf.readUInt32LE(p + 24);
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), offLocal = buf.readUInt32LE(p + 42);
    const nombre = decodificar(buf.subarray(p + 46, p + 46 + ln), (flags & 0x0800) !== 0).replace(/\\/g, '/');
    p += 46 + ln + le + lc;
    const carpeta = nombre.endsWith('/');
    if (!carpeta) {
      if (flags & 1) throw new ErrorZip('El .zip tiene contraseña: no se puede abrir');
      if (real > LIMITES.archivo) throw new ErrorZip(`«${nombre}» es demasiado grande`);
      total += real;
      if (total > LIMITES.total) throw new ErrorZip('El contenido del .zip es demasiado grande');
    }
    res.push({ nombre, carpeta, tam: real, leer: () => {
      if (offLocal + 30 > buf.length || buf.readUInt32LE(offLocal) !== 0x04034b50) throw new ErrorZip('El .zip está dañado');
      const desde = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
      const datos = buf.subarray(desde, desde + comprimido);
      if (datos.length !== comprimido) throw new ErrorZip('El .zip está dañado');
      let salida;
      if (metodo === 0) salida = datos;
      else if (metodo === 8) {
        try { salida = zlib.inflateRawSync(datos, { maxOutputLength: Math.max(1, real) }); } catch { throw new ErrorZip(`No se pudo descomprimir «${nombre}»`); }
      } else throw new ErrorZip(`«${nombre}» usa un tipo de compresión no admitido`);
      if (salida.length !== real || crc32(salida) !== crc) throw new ErrorZip(`«${nombre}» está dañado`);
      return salida;
    } });
  }
  return res;
}

module.exports = { leerZip, ErrorZip, LIMITES, crc32 };
