// tools/estres.js — Capturas del Editor con la campaña de estrés a varios tamaños de ventana (solo desarrollo).
// Uso: CAMPANA=<id> SHOTS=<carpeta> TAM=1280x720
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'); const path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const { registrar } = require('../api');
const SALIDA = process.env.SHOTS || '/tmp/shots-estres'; fs.mkdirSync(SALIDA, { recursive: true });
const [W, H] = (process.env.TAM || '1280x720').split('x').map(Number);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let w; const js = (c) => w.webContents.executeJavaScript(c);
async function espera(expr, ms = 8000) { const fin = Date.now() + ms; while (Date.now() < fin) { if (await js(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return true; await esperar(100); } return false; }
async function foto(n) {
  await esperar(600);
  const desborde = await js(`(()=>{const r=[];for(const e of document.querySelectorAll('body *')){const b=e.getBoundingClientRect();if(b.width>0&&(b.right>innerWidth+2||b.width>innerWidth+2)&&!e.closest('.mapa-scroll'))r.push(e.className||e.tagName);}return [...new Set(r)].slice(0,6)})()`);
  const imgs = await js(`[...document.querySelectorAll('img')].filter(i=>{const b=i.getBoundingClientRect();const c=i.parentElement.getBoundingClientRect();return b.width>c.width+2||b.height>c.height+2&&!i.closest('.mapa-scroll')}).map(i=>i.className||i.parentElement.className).slice(0,6)`);
  console.log(`foto ${n}${desborde.length ? ' · SE SALE: ' + desborde.join(', ') : ''}${imgs.length ? ' · IMG MÁS GRANDE QUE SU CAJA: ' + imgs.join(', ') : ''}`);
  fs.writeFileSync(path.join(SALIDA, `${W}-${n}.png`), (await w.webContents.capturePage()).toPNG());
}
async function principal() {
  w = new BrowserWindow({ width: W, height: H, show: true, useContentSize: true, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true } });
  w.webContents.on('console-message', (_e, n, m) => { if (n >= 2) console.log('  [consola]', m); });
  registrar(() => w); ipcMain.handle('ed:cerrarYa', () => {});
  await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { hash: 'debug' });
  const id = process.env.CAMPANA;
  await espera(`document.querySelector('.pantalla-campanas [data-campana="${id}"]')`);
  await foto('0-campanas');
  await js(`document.querySelector('.pantalla-campanas [data-campana="${id}"]').click()`);
  await espera(`window.__ed.E.campana && !['validando','nada'].includes(window.__ed.E.problemas.estado)`, 20000);
  console.log('problemas:', await js(`JSON.stringify(window.__ed.E.problemas).slice(0,300)`));
  await foto('1-inicio');
  await js(`window.__ed.irACategoria('enemigos')`); await foto('2-npc-lista');
  await js(`window.__ed.abrir('enemigos','npc_000')`); await foto('3-npc-ficha');
  await js(`window.__ed.abrir('enemigos','npc_001')`); await foto('3b-npc-alto');
  await js(`window.__ed.abrir('enemigos','npc_002')`); await foto('3c-npc-ancho');
  await js(`window.__ed.abrir('habilidades','bola_de_fuego')`); await foto('4-habilidad');
  await js(`window.__ed.abrir('objetos','objeto_00')`); await foto('5-objeto');
  await js(`window.__ed.abrir('tiendas','tienda_aldea')`); await foto('6-tienda');
  await js(`window.__ed.abrirReglas('estadisticas')`); await foto('7-reglas-stats');
  await js(`window.__ed.abrirReglas('tablas')`); await foto('8-tablas');
  await js(`window.__ed.abrir('mapas','enorme')`); await espera('document.querySelector(".mapa-lienzo")'); await foto('9-mapa-enorme');
  await js(`document.querySelector('[data-clave="jugadores"]').click()`); await foto('10-jugadores');
  app.exit(0);
}
app.whenReady().then(() => principal().catch((e) => { console.log('ERROR', e.stack); app.exit(2); }));
