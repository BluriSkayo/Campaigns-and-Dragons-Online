// preload.js — Puente mínimo y seguro entre Electron y la página: solo expone la gestión de archivos del cliente.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mesa', {
  version: process.versions.electron,
  // «Recuérdame»: las contraseñas se guardan cifradas por el sistema (nunca la de GM)
  credenciales: {
    disponible: () => ipcRenderer.invoke('cred:disponible'),
    cifrar: (texto) => ipcRenderer.invoke('cred:cifrar', texto),
    descifrar: (cifrado) => ipcRenderer.invoke('cred:descifrar', cifrado),
  },
  tls: {
    sondear: (host, puerto) => ipcRenderer.invoke('tls:sondear', host, puerto),
    confiar: (host, huella) => ipcRenderer.invoke('tls:confiar', host, huella),
  },
  archivos: {
    info: () => ipcRenderer.invoke('archivos:info'),
    listar: (categoria) => ipcRenderer.invoke('archivos:listar', categoria),
    uso: () => ipcRenderer.invoke('archivos:uso'),
    importar: () => ipcRenderer.invoke('archivos:importar'),
    abrirCarpeta: () => ipcRenderer.invoke('archivos:abrir'),
    usarCampana: (id) => ipcRenderer.invoke('archivos:campana', id),
    importarZip: (conectada) => ipcRenderer.invoke('archivos:importarZip', conectada),
    exportarPersonaje: (datos) => ipcRenderer.invoke('archivos:exportarPersonaje', datos),
  },
});
