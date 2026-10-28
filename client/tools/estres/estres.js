// tools/estres/estres.js — Capturas del cliente con la campaña de estrés (solo desarrollo; lo lanza correr-estres.sh).
// GM y jugadora contra un servidor real; nombres larguísimos, imágenes enormes de varios formatos, 100 NPC, 30 estadísticas.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { registrarArchivos } = require('../../archivos');
const { registrarSeguridad } = require('../../tls-cliente');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', process.env.MESA_DATOS || '/tmp/estres-cliente');
const SALIDA = process.env.SHOTS || '/tmp/estres/shots-cli';
fs.mkdirSync(SALIDA, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (w, c) => w.webContents.executeJavaScript(c);
async function espera(w, expr, ms = 6000) { const fin = Date.now() + ms; while (Date.now() < fin) { if (await js(w, `(()=>{try{return !!(${expr})}catch{return false}})()`)) return true; await esperar(100); } return false; }
let problemas = 0;
async function foto(w, nombre) {
  await esperar(500);
  const r = await js(w, `(()=>{
    const fuera=[];for(const e of document.querySelectorAll('body *')){if(e.closest('canvas'))continue;const b=e.getBoundingClientRect();if(b.width>0&&b.height>0&&(b.right>innerWidth+2||b.bottom>innerHeight+2)&&getComputedStyle(e).position!=='fixed'){const p=e.parentElement;const ps=p&&getComputedStyle(p);if(ps&&/(auto|scroll|hidden)/.test(ps.overflow+ps.overflowX+ps.overflowY))continue;fuera.push((e.className||e.tagName)+'');}}
    const imgs=[...document.querySelectorAll('img')].filter(i=>{const b=i.getBoundingClientRect();return b.width>Math.min(innerWidth*0.6,700)||b.height>Math.min(innerHeight*0.7,700)}).map(i=>i.className||i.parentElement.className);
    const scrollH=document.documentElement.scrollWidth>innerWidth+2;
    for(const v of document.querySelectorAll('.ventana')){const c=v.querySelector('.ventana-cuerpo')||v;if(c.scrollWidth>c.clientWidth+1){let peor=null,w=0;for(const e of c.querySelectorAll('*')){if(e.scrollWidth>w&&e.scrollWidth>c.clientWidth){w=e.scrollWidth;peor=e;}}fuera.push('BARRA H en '+v.getAttribute('aria-label')+': '+c.scrollWidth+'>'+c.clientWidth+' por '+(peor?(peor.className||peor.tagName):'?'));}const cr=c.getBoundingClientRect();for(const e of c.querySelectorAll('*')){const b=e.getBoundingClientRect();if(b.width&&b.right>cr.right+2){fuera.push('EN VENTANA: '+(e.className||e.tagName)+' '+Math.round(b.right-cr.right)+'px');break;}}}
    return {fuera:[...new Set(fuera)].slice(0,5),imgs:imgs.slice(0,5),scrollH};})()`);
  const malo = r.fuera.length || r.imgs.length || r.scrollH;
  if (malo) problemas++;
  console.log(`foto ${nombre}${r.scrollH ? ' · LA PÁGINA TIENE BARRA HORIZONTAL' : ''}${r.fuera.length ? ' · SE SALE: ' + r.fuera.join(', ') : ''}${r.imgs.length ? ' · IMAGEN ENORME: ' + r.imgs.join(', ') : ''}`);
  fs.writeFileSync(path.join(SALIDA, `${nombre}.png`), (await w.webContents.capturePage()).toPNG());
}
function ventana(x) {
  const w = new BrowserWindow({ x, y: 0, width: 1280, height: 720, useContentSize: true, show: true,
    webPreferences: { preload: path.join(__dirname, '..', '..', 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  w.webContents.on('console-message', (_e, n, m) => { if (n >= 2) console.log('  [consola]', m); });
  w.loadFile(path.join(__dirname, '..', '..', 'src', 'index.html'), { hash: 'debug' });
  return w;
}
const clicTexto = (w, texto, sel = 'button') => js(w, `(()=>{const b=[...document.querySelectorAll('${sel}')].find(e=>e.textContent.trim()===${JSON.stringify(texto)}&&!e.disabled);if(!b)return false;b.click();return true})()`);
async function enVentana(w, titulo) {
  await js(w, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
  await js(w, `document.querySelector('.rail-btn[title=${JSON.stringify(titulo)}]')?.click()`);
  await esperar(200);
  await js(w, `document.querySelector('.btn-icono[aria-label="Abrir ${titulo} en una ventana"]')?.click()`);
  await esperar(300);
}

app.whenReady().then(async () => {
  try {
    registrarSeguridad();
    registrarArchivos(app.getPath('userData'));
    const gm = ventana(0), ana = ventana(1300);
    await esperar(1500);
    for (const w of [gm, ana]) await js(w, `window.confirm=()=>true;0`);
    await js(ana, `(()=>{document.getElementById('f-servidor').value='127.0.0.1:8766';document.getElementById('f-usuario').value='María José Ñúñez';document.querySelector('form').requestSubmit()})()`);
    await espera(ana, `__mesa.pantalla==='seleccion'`, 10000);
    await foto(ana, '1280-01-crear');
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Orco')).click()})()`); await esperar(150);
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Guerrero')).click()})()`); await esperar(150);
    await js(ana, `(()=>{const s=document.querySelector('select[data-accion="imagen-imagen"]');s.value='tokens/gigante.jpg';s.dispatchEvent(new Event('change'));const b=document.querySelector('select[data-accion="imagen-imagen_biografia"]');if(b){b.value='tokens/alto.png';b.dispatchEvent(new Event('change'))}})()`);
    await esperar(300);
    await js(ana, `(()=>{document.getElementById('f-nombre-pj').value='Bartolomé Ñúñez de la Cruz y Gran Campeón de las Siete Lunas 🌙';document.getElementById('f-historia').value='${'Historia muy larga. '.repeat(60)}'})()`);
    await foto(ana, '1280-02-crear-relleno');
    await clicTexto(ana, 'Crear personaje');
    await espera(ana, `__mesa.pantalla==='principal'`, 8000);
    await js(ana, `document.querySelector('.rail-btn[title="Personaje"]').click()`); await esperar(200);
    await js(ana, `document.querySelector('.pers-item').click()`); await esperar(200);
    await clicTexto(ana, 'Desplegar', '.pers-habs button');
    await espera(ana, `__mesa.S.tokens.size>=1`);

    await js(gm, `(()=>{document.getElementById('f-servidor').value='127.0.0.1:8766';document.getElementById('f-usuario').value='Master';const c=document.getElementById('f-es-gm');c.checked=true;c.dispatchEvent(new Event('change'));document.getElementById('f-gm').value='cambia-esto';document.querySelector('form').requestSubmit()})()`);
    await espera(gm, `__mesa.pantalla==='seleccion'`, 8000);
    await clicTexto(gm, 'Entrar sin personaje');
    await espera(gm, `__mesa.pantalla==='principal'`);
    const t = await js(ana, `(()=>{const t=__mesa.S.tokens.get(__mesa.S.tokenActivo);return {x:t.x,y:t.y}})()`);
    for (let i = 0; i < 8; i++) await js(gm, `__mesa.red.enviar({tipo:'gm_colocar_enemigo', enemigo:'npc_${String(i * 10).padStart(3, '0')}', x:${t.x + 1 + (i % 4)}, y:${t.y + 1 + Math.floor(i / 4)}})`);
    await js(gm, `__mesa.red.enviar({tipo:'gm_objeto', token:[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje').id, objeto:'objeto_00', cantidad:5})`);
    await esperar(800);

    for (const [W, H] of [[1280, 720], [1920, 1080]]) {
      for (const w of [gm, ana]) { w.setContentSize(W, H); }
      await esperar(600);
      const p = `${W}`;
      await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
      await js(ana, `(()=>{const b=document.querySelector('.rail-btn[title="Personaje"]');if(b.getAttribute('aria-expanded')!=='true')b.click()})()`);
      await esperar(300);
      await foto(ana, `${p}-03-principal`);
      await js(ana, `__mesa.abrirPersonaje()`); await esperar(400);
      await foto(ana, `${p}-04-ficha`);
      await js(ana, `document.querySelector('.ficha-pestana[data-pestana="historia"]')?.click()`); await foto(ana, `${p}-05-ficha-historia`);
      await js(ana, `document.querySelector('.ficha-pestana[data-pestana="inventario"]')?.click()`); await foto(ana, `${p}-06-ficha-inventario`);
      await enVentana(ana, 'Inventario'); await foto(ana, `${p}-07-inventario`);
      await enVentana(ana, 'Tiradas'); await foto(ana, `${p}-08-tiradas`);
      await enVentana(ana, 'Diario'); await foto(ana, `${p}-09-diario`);
      await js(ana, `document.querySelector('.ventana[aria-label="Diario"] [data-pagina="pagina_00"] .diario-enlace')?.click()`); await esperar(300); await foto(ana, `${p}-09b-diario-pagina`);
      await enVentana(gm, 'Panel del GM'); await foto(gm, `${p}-10-panel-gm`);
      await js(gm, `document.querySelector('[data-tienda="tienda_aldea"] [data-accion="abrir-tienda"]')?.click()`); await esperar(500);
      await enVentana(ana, 'Tienda'); await foto(ana, `${p}-11-tienda`);
      await js(gm, `document.querySelector('[data-tienda="tienda_aldea"] [data-accion="cerrar-tienda"]')?.click()`);
      await js(gm, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
      await js(gm, `(()=>{const id=[...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo').id;__mesa.abrirPersonaje(id)})()`); await esperar(400);
      await foto(gm, `${p}-12-gm-ficha-npc`);
      await js(gm, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
      await foto(gm, `${p}-13-gm-mapa`);
    }
    console.log(problemas ? `${problemas} capturas con algo raro` : 'Sin problemas detectados');
    app.exit(0);
  } catch (e) { console.log('ERROR', e.stack); app.exit(2); }
});
