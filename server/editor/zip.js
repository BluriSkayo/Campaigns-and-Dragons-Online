// zip.js — Escribe un .zip normal (se abre con el explorador de Windows, 7-Zip…) sin librerías externas.
// Las imágenes y audios ya comprimidos (png, jpg, webp, gif, ogg, mp3) se guardan tal cual; el resto se comprime.
const zlib = require('zlib');

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
const YA_COMPRIMIDOS = /\.(png|jpe?g|webp|gif|ogg|mp3)$/i;

/** entradas: [{ nombre: 'tokens/orco.png', datos: Buffer }] → Buffer con el .zip */
function crearZip(entradas) {
  const locales = [], central = [];
  let offset = 0;
  const fecha = new Date();
  const hora = ((fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1)) & 0xffff;
  const dia = (((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate()) & 0xffff;
  for (const { nombre, datos } of entradas) {
    const n = Buffer.from(nombre, 'utf8');
    const guardar = YA_COMPRIMIDOS.test(nombre);
    const cuerpo = guardar ? datos : zlib.deflateRawSync(datos, { level: 6 });
    const metodo = guardar || cuerpo.length >= datos.length ? 0 : 8;
    const final = metodo === 0 ? datos : cuerpo;
    const crc = crc32(datos);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(metodo, 8);
    loc.writeUInt16LE(hora, 10); loc.writeUInt16LE(dia, 12); loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(final.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26); loc.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(metodo, 10);
    cen.writeUInt16LE(hora, 12); cen.writeUInt16LE(dia, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(final.length, 20); cen.writeUInt32LE(datos.length, 24);
    cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locales.push(loc, n, final);
    central.push(cen, n);
    offset += loc.length + n.length + final.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(tamCentral, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, ...central, fin]);
}

module.exports = { crearZip, crc32 };
