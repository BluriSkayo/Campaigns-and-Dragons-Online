// main.js — Proceso principal de Electron: solo crea la ventana. Toda la lógica está en src/.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { registrarArchivos } = require('./archivos');
const { registrarSeguridad } = require('./tls-cliente');
const { registrarCredenciales } = require('./credenciales');

const modoDev = process.argv.includes('--dev');

function crearVentana() {
  const win = new BrowserWindow({
    icon: path.join(__dirname, 'src', 'img', 'app.png'),
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Campaigns and Dragons Online',
    backgroundColor: '#12161d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', // la música sincronizada debe poder sonar sin clic previo
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permiso, responder) => responder(false));     // sin cámara, micrófono, ubicación…

  // Atajos útiles aunque no haya menú: F11 pantalla completa, Ctrl+Mayús+I herramientas de desarrollo.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (modoDev) win.webContents.openDevTools({ mode: 'detach' });
}

// Dónde está la carpeta «base» (tokens, music, maps…):
//  - Ejecutando con iniciar_cliente.bat / npm start:  <carpeta del cliente>/base
//  - Instalado: junto al programa (<carpeta de instalación>/base) si se puede escribir ahí;
//    si no (p. ej. Archivos de programa), en %APPDATA%\Mesa de Rol\base.
// MESA_DATOS (variable de entorno) fuerza otra carpeta; la usan las pruebas automáticas.
function carpetaDelCliente() {
  if (process.env.MESA_DATOS) return process.env.MESA_DATOS;
  const respaldo = path.join(app.getPath('appData'), 'Mesa de Rol');
  if (!app.isPackaged) return __dirname;
  const junto = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  try { fs.accessSync(junto, fs.constants.W_OK); return junto; } catch { return respaldo; }
}

// Los ajustes del navegador interno (localStorage…) siguen en AppData para no mezclarse con los archivos descargados.
app.setPath('userData', process.env.MESA_DATOS || path.join(app.getPath('appData'), 'Mesa de Rol'));

Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  registrarSeguridad();
  registrarCredenciales();
  registrarArchivos(carpetaDelCliente());
  crearVentana();
});
app.on('window-all-closed', () => app.quit());
