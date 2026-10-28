// main.js — Proceso principal del Editor del Servidor. Solo crea la ventana; la lógica está en api.js y src/.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registrar, servidor } = require('./api');

let ventana = null;

function crearVentana() {
  ventana = new BrowserWindow({
    icon: path.join(__dirname, 'src', 'img', 'app.png'),
    width: 1400, height: 880, minWidth: 1000, minHeight: 640, title: 'Editor del Servidor — Campaigns and Dragons Online',
    backgroundColor: '#12161d', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ventana.once('ready-to-show', () => ventana.show());
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventana.webContents.on('will-navigate', (e) => e.preventDefault());
  ventana.webContents.session.setPermissionRequestHandler((_wc, _permiso, responder) => responder(false));
  ventana.webContents.on('before-input-event', (_e, i) => {
    if (i.type === 'keyDown' && i.control && i.shift && i.key.toLowerCase() === 'i') ventana.webContents.toggleDevTools();
  });
  // Cierre: la propia página decide si hay cambios sin guardar (ver app.js).
  ventana.on('close', (e) => {
    if (ventana.forzarCierre) return;
    e.preventDefault();
    ventana.webContents.send('ed:cerrar');
  });
  ventana.loadFile(path.join(__dirname, 'src', 'index.html'), { hash: process.argv.includes('--debug') || process.env.MESA_EDITOR_DEBUG === '1' ? 'debug' : '' });
}

Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  registrar(() => ventana);
  servidor.prepararEntorno();            // instala lo que falte de Python ya al abrir el Editor (no espera a abrir el servidor)
  require('electron').ipcMain.handle('ed:cerrarYa', () => { ventana.forzarCierre = true; ventana.close(); });
  crearVentana();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => servidor.cerrarTodo());      // el servidor que abrió el Editor se cierra con él
