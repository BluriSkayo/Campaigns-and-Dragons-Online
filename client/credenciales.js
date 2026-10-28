// credenciales.js — «Recuérdame» (proceso principal): cifra y descifra las contraseñas que el jugador quiere recordar,
// con el almacén seguro del sistema (Windows: DPAPI de tu usuario; macOS: Llavero; Linux: el llavero del escritorio).
// La ventana solo guarda el texto cifrado: copiar sus ajustes a otro equipo o a otro usuario de Windows no sirve para leerlas.
// Nunca se usa para la contraseña de GM (lo decide la ventana y aquí no se distingue: solo se cifra lo que llega).
const { ipcMain, safeStorage } = require('electron');

const MAX = 512;                 // una contraseña razonable (el servidor admite hasta 128)

// Solo para las pruebas automáticas en Linux sin llavero: un «cifrado» de mentira (NO protege nada). Lo activa tools/correr-e2e.sh.
const PRUEBA = process.env.MESA_CREDENCIALES_PRUEBA === '1';
const cifrar = (t) => (PRUEBA ? Buffer.from(`prueba:${t}`).reverse() : safeStorage.encryptString(t));
const descifrar = (b) => (PRUEBA ? Buffer.from(b).reverse().toString().replace(/^prueba:/, '') : safeStorage.decryptString(b));

function disponible() {
  if (PRUEBA) return true;
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function registrarCredenciales() {
  ipcMain.handle('cred:disponible', () => disponible());
  ipcMain.handle('cred:cifrar', (_e, texto) => {
    if (typeof texto !== 'string' || texto.length > MAX || !disponible()) return null;
    return cifrar(texto).toString('base64');
  });
  ipcMain.handle('cred:descifrar', (_e, cifrado) => {
    if (typeof cifrado !== 'string' || cifrado.length > 4 * MAX || !disponible()) return null;
    try { return descifrar(Buffer.from(cifrado, 'base64')); } catch { return null; }     // de otro equipo o usuario: no se puede leer
  });
}

module.exports = { registrarCredenciales };
