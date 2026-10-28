// archivos.js — Conecta la carpeta de archivos con la ventana (IPC). Solo se carga en el proceso principal.
const { ipcMain, shell, dialog, BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const { Almacen, TODAS } = require('./archivos-logica');

/** Registra los canales IPC. `carpetaDatos` es la carpeta del programa; los archivos van en carpetaDatos/base. */
function registrarArchivos(carpetaDatos) {
  const almacen = new Almacen(path.join(carpetaDatos, 'base'));
  const listo = almacen.iniciar();

  const url = (d) => pathToFileURL(d).href.replace(/\/*$/, '/');
  const info = () => ({ base: almacen.base, urlBase: url(almacen.base), campana: almacen.campana,
    urlCampana: almacen.campana ? url(almacen.dirCampana()) : null, indice: [...almacen.indice] });
  ipcMain.handle('archivos:info', async () => { await listo; return info(); });
  // Al entrar a un servidor: qué campaña es (sus archivos están en base/campanas/<id>)
  ipcMain.handle('archivos:campana', async (_e, id) => { await listo; await almacen.usarCampana(id); return info(); });
  // El jugador instala el .zip de archivos que le pasó el GM
  ipcMain.handle('archivos:importarZip', async (e, conectada) => {
    await listo;
    const ventana = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(ventana, { title: 'Importar archivos de campaña (.zip)', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const st = await require('fs').promises.stat(r.filePaths[0]);
    if (st.size > 2 * 1024 * 1024 * 1024) throw new Error('El .zip pesa más de 2 GB');
    const res = await almacen.importarZip(await require('fs').promises.readFile(r.filePaths[0]), typeof conectada === 'string' ? conectada : '');
    return { ...res, info: info() };
  });
  ipcMain.handle('archivos:listar', async (_e, categoria) => { await listo; return almacen.listar(TODAS.includes(categoria) ? categoria : 'otros'); });
  ipcMain.handle('archivos:uso', async () => { await listo; return almacen.uso(); });
  // «Exportar personaje»: la ficha y sus imágenes en un .mesa-personaje (el GM lo importa en el Editor → Jugadores y fichas)
  ipcMain.handle('archivos:exportarPersonaje', async (e, datos) => {
    await listo;
    const { zip, archivos } = await almacen.paquetePersonaje(datos);
    const nombre = String(datos?.personaje?.nombre || 'personaje').normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '_').trim().slice(0, 40) || 'personaje';
    const ventana = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(ventana, { title: 'Exportar personaje', defaultPath: `${nombre}.mesa-personaje`, filters: [{ name: 'Personaje de Campaigns and Dragons Online', extensions: ['mesa-personaje'] }] });
    if (r.canceled || !r.filePath) return null;
    const destino = r.filePath.toLowerCase().endsWith('.mesa-personaje') ? r.filePath : `${r.filePath}.mesa-personaje`;
    await require('fs').promises.writeFile(destino, zip);
    return { ruta: destino, archivos };
  });
  ipcMain.handle('archivos:abrir', async () => { await listo; return shell.openPath(almacen.campana ? almacen.dirCampana() : almacen.base); });
  // El jugador elige una imagen de su equipo (diálogo del sistema) y se copia a base/tokens.
  ipcMain.handle('archivos:importar', async (e) => {
    await listo;
    const ventana = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(ventana, { title: 'Elegir imagen', properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return almacen.importarImagen('tokens', r.filePaths[0]);
  });
  return almacen;
}

module.exports = { registrarArchivos };
