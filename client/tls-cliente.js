// tls-cliente.js — Conexión cifrada del cliente (proceso principal).
// El servidor usa un certificado propio (autofirmado). La primera vez, el jugador confirma su «huella»; desde
// entonces solo se acepta ESE certificado para ese servidor. Si cambia, la ventana avisa antes de fijar otra.
const { ipcMain, session, net } = require('electron');
const tls = require('tls');
const crypto = require('crypto');

const confiados = new Map();          // nombre de servidor → huella aceptada (se rellena desde la ventana al conectar)

function huellaDePem(pem) {
  const der = Buffer.from(String(pem).replace(/-----[^-]+-----|\s+/g, ''), 'base64');
  return formatear(crypto.createHash('sha256').update(der).digest('hex'));
}
function formatear(hex) { return hex.toUpperCase().match(/../g).join(':'); }
const esHuella = (v) => typeof v === 'string' && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v);
const esNombre = (v) => typeof v === 'string' && v.length > 0 && v.length < 256;

/** Se conecta (sin confiar en nada) para leer el certificado del servidor. */
function sondear(host, puerto) {
  return new Promise((resolver, rechazar) => {
    const opciones = { host, port: puerto, rejectUnauthorized: false };
    if (!/^[\d.]+$|:/.test(host)) opciones.servername = host;
    const s = tls.connect(opciones, () => {
      const c = s.getPeerCertificate();
      const huella = c && c.raw ? formatear(crypto.createHash('sha256').update(c.raw).digest('hex')) : null;
      const valido = s.authorized;
      s.end();
      huella ? resolver({ huella, valido }) : rechazar(new Error('El servidor no presentó certificado'));
    });
    s.setTimeout(6000, () => { s.destroy(); rechazar(new Error('Tiempo agotado')); });
    s.on('error', rechazar);
  });
}

function registrarSeguridad() {
  session.defaultSession.setCertificateVerifyProc((peticion, resultado) => {
    if (peticion.verificationResult === 'net::OK') return resultado(0);
    const esperada = confiados.get(peticion.hostname);
    resultado(esperada && esperada === huellaDePem(peticion.certificate.data) ? 0 : -2);
  });
  ipcMain.handle('tls:sondear', (_e, host, puerto) => {
    if (!esNombre(host) || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('Dirección no válida');
    return sondear(host, puerto);
  });
  ipcMain.handle('tls:confiar', (_e, host, huella) => {
    if (!esNombre(host) || !esHuella(huella)) throw new Error('Datos no válidos');
    confiados.set(host, huella);
    return true;
  });
}

/** fetch del proceso principal que respeta la confianza anterior (el de Node no la conoce). */
const fetchSeguro = (url, opciones) => net.fetch(url, opciones);

module.exports = { registrarSeguridad, fetchSeguro, sondear, huellaDePem };
