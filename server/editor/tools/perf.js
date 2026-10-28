// tools/perf.js — Medición de memoria y tiempo del Editor con una campaña grande (solo desarrollo).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'); const path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('js-flags', '--expose-gc'); app.commandLine.appendSwitch('enable-precise-memory-info');
const { registrar } = require('../api');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let w; const js = (c) => w.webContents.executeJavaScript(c);
async function espera(expr, ms = 20000) { const fin = Date.now() + ms; while (Date.now() < fin) { if (await js(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return true; await esperar(100); } return false; }
const heap = async () => { await js('window.gc && window.gc()'); const r = Math.round((await js('performance.memory.usedJSHeapSize')) / 1e6);
  const tot = app.getAppMetrics().map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}`).join(' '); return `${r} (total procesos ${tot} MB, principal ${Math.round(process.memoryUsage().rss / 1e6)})`; };
app.whenReady().then(async () => {
  w = new BrowserWindow({ width: 1400, height: 880, show: true, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true } });
  w.webContents.on('render-process-gone', (_e, d) => console.log('CAIDO', d.reason));
  registrar(() => w); ipcMain.handle('ed:cerrarYa', () => {});
  await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { hash: 'debug' });
  await espera('document.querySelector(".pantalla-campanas [data-campana=grande]")');
  await js(`document.querySelector('.pantalla-campanas [data-campana=grande]').click()`);
  await espera('window.__ed && window.__ed.E.campana && window.__ed.E.campana.id==="grande"');
  await esperar(3000);
  const N = Number(process.env.N || 60);
  console.log('heap inicial MB', await heap());
  for (let i = 0; i < N; i++) {
    const id = `rasgo_${i % 40}`;
    const M = process.env.MODO || 'todo';
    if (M === 'cat') { await js(`window.__ed.irACategoria(${JSON.stringify(i % 2 ? 'habilidades' : 'rasgos')})`); await esperar(150); }
    if (M === 'abrir') { await js(`window.__ed.abrir('rasgos', ${JSON.stringify(id)})`); await esperar(150); }
    if (M === 'todo' || M === 'nav') {
      await js(`window.__ed.irACategoria ? window.__ed.irACategoria(${JSON.stringify(i % 2 ? 'habilidades' : 'rasgos')}) : 0`);
      await esperar(100);
      await js(`window.__ed.abrir('rasgos', ${JSON.stringify(id)})`);
      await esperar(50);
    }
    const t0 = Date.now();
    if (M === 'todo' || M === 'guardar') {
      if (M === 'guardar' && i === 0) await js(`window.__ed.abrir('rasgos', 'rasgo_0')`);
      const cl = M === 'guardar' ? 'rasgos/rasgo_0' : `rasgos/${id}`;
      await js(`(()=>{const p=window.__ed.E.pestanas.find(t=>t.clave===${JSON.stringify(cl)});p.borrador.descripcion='x${i}';window.__ed.bus.emit('cambio');})()`);
      await js(`window.__ed.guardar(${JSON.stringify(cl)})`);
      await espera(`window.__ed.E.problemas && window.__ed.E.problemas.estado !== 'validando'`);
    }
    if (M === 'validar') { await js(`window.__ed.validar ? window.__ed.validar() : window.__ed.bus.emit('guardado')`); await esperar(1200); }
    const dt = Date.now() - t0;
    if (i % 10 === 0 || i === N - 1) console.log(`guardado ${i}: ${dt} ms, heap ${await heap()} MB, pestañas ${await js('window.__ed.E.pestanas.length')}`);
  }
  // Efectos: abrir el rasgo con 90 efectos y cambiar uno, medir tiempo de repintado
  await js(`window.__ed.abrir('rasgos', 'muchos')`); await esperar(1500);
  const t1 = Date.now();
  for (let i = 0; i < 10; i++) await js(`(()=>{const e=document.querySelector('.ficha [data-efecto-campo]'); if(e){e.value=String(${i}+1); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  console.log('10 cambios en 90 efectos:', Date.now() - t1, 'ms; nodos DOM', await js('document.getElementsByTagName("*").length'), 'heap', await heap());
  app.exit(0);
});
