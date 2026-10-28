// preload.js — Puente seguro entre la ventana del Editor y el disco (solo lo que api.js permite).
const { contextBridge, ipcRenderer } = require('electron');
const nombres = ['info', 'campanas', 'cargar', 'crearCampana', 'duplicarCampana', 'borrarCampana', 'papelera', 'restaurarRecursoPapelera', 'restaurarCampanaPapelera', 'borrarDePapelera', 'vaciarPapelera', 'guardarRecurso', 'renombrarRecurso', 'borrarRecurso',
  'guardarConfig', 'guardarSonidos', 'guardarOrden', 'validar', 'esquemaEfectos', 'simular', 'hash', 'importar', 'assets', 'carpetasAssets', 'crearCarpetaAssets', 'cliente', 'elegirCliente', 'abrirBase', 'exportarArchivos', 'abrirCarpeta',
  'jugadores', 'crearCuenta', 'fijarPassword', 'fijarAtaque', 'fijarBloqueo', 'borrarCuenta', 'guardarFicha', 'borrarFicha', 'importarPersonaje',
  'exportarCampana', 'importarCampana', 'servidorEstado', 'servidorIniciar', 'servidorDetener', 'servidorReiniciar'];
const api = {};
for (const n of nombres) api[n] = (...a) => ipcRenderer.invoke(`ed:${n}`, ...a).catch((e) => { throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); });
contextBridge.exposeInMainWorld('editor', api);
contextBridge.exposeInMainWorld('editorApp', {
  cerrarYa: () => ipcRenderer.invoke('ed:cerrarYa'),
  alIntentarCerrar: (fn) => ipcRenderer.on('ed:cerrar', () => fn()),
  alCambiarServidor: (fn) => ipcRenderer.on('ed:servidor', () => fn()),
});
