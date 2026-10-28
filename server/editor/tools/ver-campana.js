// tools/ver-campana.js — Abre una campaña en el Editor y saca capturas (solo desarrollo). Uso: CAMPANA=<id> SHOTS=<carpeta>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'); const path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const { registrar } = require('../api');
const SALIDA = process.env.SHOTS || '/tmp/shots-campana'; fs.mkdirSync(SALIDA, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let w; const js = (c) => w.webContents.executeJavaScript(c);
async function espera(expr, ms = 8000) { const fin = Date.now() + ms; while (Date.now() < fin) { if (await js(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return true; await esperar(100); } return false; }
async function foto(n) { await esperar(700); fs.writeFileSync(path.join(SALIDA, `${n}.png`), (await w.webContents.capturePage()).toPNG()); console.log('foto', n); }
async function principal() {
  w = new BrowserWindow({ width: 1600, height: 950, show: true, useContentSize: true, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true } });
  w.webContents.on('console-message', (_e, n, m) => { if (n >= 2) console.log('  [consola]', m); });
  registrar(() => w); ipcMain.handle('ed:cerrarYa', () => {});
  await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { hash: 'debug' });
  const id = process.env.CAMPANA;
  await espera(`document.querySelector('.pantalla-campanas [data-campana="${id}"]')`);
  await js(`document.querySelector('.pantalla-campanas [data-campana="${id}"]').click()`);
  await espera(`window.__ed.E.campana && window.__ed.E.problemas.estado!=='validando' && window.__ed.E.problemas.estado!=='nada'`, 15000);
  console.log('problemas:', await js(`JSON.stringify(window.__ed.E.problemas)`));
  await foto('1-inicio');
  for (const [v, n] of [['grupos', '2-razas'], ['enemigos', '3-npc']]) { await js(`window.__ed.irACategoria('${v}')`); await foto(n); }
  const opcion = process.env.OPCION || await js(`Object.keys(window.__ed.E.campana.recursos.opciones)[0] || ''`);     // la opción que se quiera ver (OPCION=<id>)
  if (opcion) { await js(`window.__ed.abrir('opciones', ${JSON.stringify(opcion)})`); await foto('4-opcion'); }
  await js(`window.__ed.abrir('rasgos','instinto_de_supervivencia')`); await foto('5-rasgo');
  await js(`window.__ed.abrir('mapas','escuela')`); await espera('document.querySelector(".mapa-lienzo")'); await foto('6-mapa');
  await js(`window.__ed.abrirReglas('estadisticas')`); await foto('7-reglas');
  app.exit(0);
}
app.whenReady().then(() => principal().catch((e) => { console.log('ERROR', e.stack); app.exit(2); }));
