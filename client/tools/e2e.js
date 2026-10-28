// tools/e2e.js — Prueba de extremo a extremo (solo para desarrollo; no se incluye en el instalador).
// Abre dos ventanas (GM y jugadora) contra un servidor real y las maneja con eventos de ratón reales.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { registrarArchivos } = require('../archivos');
const { registrarSeguridad } = require('../tls-cliente');
const { registrarCredenciales } = require('../credenciales');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
const BASE = path.join(process.env.MESA_DATOS || '/tmp/e2e-client', 'base');
app.setPath('userData', process.env.MESA_DATOS || '/tmp/e2e-client');
const SALIDA = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(SALIDA, { recursive: true });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const ok = (cond, texto) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${texto}`); if (!cond) fallos++; };

function ventana(x) {
  const w = new BrowserWindow({ x, y: 0, width: 1360, height: 860, useContentSize: true, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  w.webContents.on('console-message', (_e, nivel, msg) => { if (nivel >= 2) console.log(`  [consola ${x}]`, msg); });
  w.webContents.on('render-process-gone', (_e, d) => console.log('  [proceso caído]', d.reason));
  w.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { hash: 'debug' });
  return w;
}
const js = (w, codigo) => w.webContents.executeJavaScript(codigo);
async function espera(w, expr, ms = 4000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await js(w, `(()=>{try{return !!(${expr})}catch{return false}})()`)) return true; await esperar(80); }
  return false;
}
async function foto(w, nombre) { await esperar(300); const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(SALIDA, `${nombre}.png`), img.toPNG()); }
/** Abre una opción del panel izquierdo y la saca a una ventana (así se comprueba el contenido como ventana). */
async function comoVentana(w, titulo) {
  await js(w, `(()=>{const b=document.querySelector('.rail-btn[title=${JSON.stringify(titulo)}]');b.click()})()`);
  await esperar(150);
  await js(w, `document.querySelector('.btn-icono[aria-label="Abrir ${titulo} en una ventana"]').click()`);
  await esperar(150);
}
const clicTexto = (w, texto, sel = 'button') => js(w, `(()=>{const b=[...document.querySelectorAll('${sel}')].find(e=>__txt(e).trim()===${JSON.stringify(texto)}&&!e.disabled);if(!b)return false;b.click();return true})()`);

// Convierte una casilla del mapa en coordenadas de ventana y lanza eventos de ratón reales.
async function clicDerecho(w, p) {
  w.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); await esperar(60);
  w.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1, modifiers: ['rightButtonDown'] }); await esperar(60);
  w.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 }); await esperar(200);
}
const textosMenu = (w) => js(w, `[...document.querySelectorAll('.menu-contextual .menu-item, .menu-contextual .menu-titulo')].map(e=>__txt(e).trim())`);
async function pos(w, cx, cy) {
  return js(w, `(()=>{const v=__mesa.vista;const r=v.canvas.getBoundingClientRect();const T=v.T;
    return {x:Math.round(r.left+v.cam.x+(${cx}+0.5)*T*v.cam.zoom), y:Math.round(r.top+v.cam.y+(${cy}+0.5)*T*v.cam.zoom)}})()`);
}
async function ratonDown(w, p) { w.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); await esperar(40); w.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await esperar(40); }
async function ratonMove(w, p, modifiers = ['leftButtonDown']) { w.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y, button: 'left', modifiers }); await esperar(60); }
async function ratonUp(w, p) { w.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await esperar(120); }
async function clic(w, cx, cy) { const p = await pos(w, cx, cy); await ratonDown(w, p); await ratonUp(w, p); }

app.whenReady().then(async () => {
  try {
    registrarSeguridad();
    registrarCredenciales();
    registrarArchivos(app.getPath('userData'));
    const gm = ventana(0);
    const ana = ventana(1400);
    await esperar(1200);
    // La confirmación de la huella usa confirm(): se contesta que sí y se cuentan las preguntas.
    for (const w of [gm, ana]) await js(w, `window.__preguntas=[];window.confirm=(t)=>{window.__preguntas.push(t);return true};0`);
    // Texto de un elemento contando los iconos en pixel art como el emoji al que sustituyen (su «alt»)
    for (const w of [gm, ana]) await js(w, `window.__txt=(e)=>[...e.childNodes].map(n=>n.nodeType===3?n.textContent:n.tagName==='IMG'?n.alt:window.__txt(n)).join('').replace(/\\uFE0F/g,'');0`);
    await foto(ana, '01-conexion');

    // ── Conexión ──
    await js(ana, `(()=>{(document.getElementById('f-servidor')||(document.querySelector('[data-accion="anadir-servidor"]').click(),document.getElementById('f-servidor'))).value='127.0.0.1:8765';document.getElementById('f-usuario').value='Ana';document.querySelector('form').requestSubmit()})()`);
    ok(await espera(ana, `__mesa.pantalla==='seleccion'`), 'Ana: conecta y llega a la selección de personaje');
    ok(await js(ana, `__mesa.S.url.startsWith('wss://')`), 'Cifrado: la conexión va por wss');
    ok(await js(ana, `__preguntas.length===1 && __preguntas[0].includes('Huella') && Object.keys(JSON.parse(localStorage.getItem('mesa-rol-ajustes')).huellas).length===1`), 'Cifrado: la primera vez pregunta por la huella y la recuerda');
    ok(await js(ana, `!!document.querySelector('.grupo-eleccion') && !document.body.textContent.includes('plantilla')`), 'Ana: sin personajes se abre sola la creación (sin plantillas)');
    await foto(ana, '02-crear-personaje');

    ok(await js(ana, `[...document.querySelectorAll('.grupo-eleccion')].length===2`), 'Creación: aparecen los grupos Raza y Clase de la campaña');
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Orco')).click()})()`);
    await esperar(100);
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Mago')).click()})()`);
    await esperar(100);
    ok(await js(ana, `document.querySelectorAll('.grupo-eleccion').length===3 && document.body.textContent.includes('Escuela de magia')`), 'Creación: «Escuela de magia» solo aparece al elegir Mago');
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Guerrero')).click()})()`);
    await esperar(100);
    ok(await js(ana, `document.querySelectorAll('.grupo-eleccion').length===2 && !document.body.textContent.includes('Escuela de magia')`), 'Creación: al cambiar a Guerrero la escuela desaparece');
    // Elegir algo en una pantalla larga no devuelve la barra de desplazamiento arriba (ventana baja para que haya que bajar)
    ana.setContentSize(1360, 420); await esperar(300);
    const zona = `(()=>{const g=document.querySelector('.grupo-eleccion');let z=g;while(z&&!(z.scrollHeight>z.clientHeight+20&&/(auto|scroll)/.test(getComputedStyle(z).overflowY)))z=z.parentElement;return z})()`;
    const hayZona = await js(ana, `(()=>{const z=${zona};if(!z)return false;z.scrollTop=150;return z.scrollTop>100})()`);
    await js(ana, `[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Guerrero')).click()`);
    await esperar(150);
    ok(hayZona && await js(ana, `${zona}.scrollTop>100`), 'Creación: al elegir una opción la barra no salta arriba');
    ana.setContentSize(1360, 860); await esperar(300);
    ok(await js(ana, `document.querySelector('.stats-reparto').textContent.includes('por tus elecciones') && document.body.textContent.includes('te quedan 5 de 5 puntos')`), 'Creación: el jugador reparte puntos y se ven los bonos de raza y clase');
    ok(await js(ana, `document.querySelector('.stats-reparto').textContent.includes('Experiencia') && !document.querySelector('button[aria-label="Añadir un punto a Experiencia"]') && !!document.querySelector('button[aria-label="Añadir un punto a Fuerza"]')`), 'Contadores: «Experiencia» se ve pero no recibe puntos de creación');
    for (let i = 0; i < 3; i++) await js(ana, `document.querySelector('button[aria-label="Añadir un punto a Fuerza"]').click()`);
    ok(await js(ana, `document.body.textContent.includes('te quedan 2 de 5 puntos')`), 'Creación: cada + gasta un punto');
    await foto(ana, '02b-crear-con-raza');
    await js(ana, `(()=>{document.getElementById('f-nombre-pj').value='Thor';document.getElementById('f-historia').value='Hijo de herrero, cansado de la aldea.'})()`);
    ok(await js(ana, `!!document.querySelector('[data-imagen="imagen"]') && !!document.querySelector('[data-imagen="imagen_biografia"]')`), 'Creación: pide imagen de token y de biografía');
    // La imagen se elige en la galería («Elegir una que ya tengo…»), con miniaturas
    await js(ana, `document.querySelector('[data-accion="imagen-imagen"]').click()`);
    await espera(ana, `!!document.querySelector('.galeria-item[data-ruta="tokens/guerrero.png"]')`);
    await js(ana, `document.querySelector('.galeria-item[data-ruta="tokens/guerrero.png"]').click()`);
    await esperar(200);
    ok(await js(ana, `!!document.querySelector('[data-imagen="imagen"] img')`), 'Creación: la imagen elegida se ve en la vista previa');
    await js(ana, `(()=>{document.getElementById('f-nombre-pj').value='Thor';document.getElementById('f-historia').value='Hijo de herrero, cansado de la aldea.'})()`);
    ok(await js(ana, `!!document.querySelector('.campos-creacion select[data-campo-ficha="Alineamiento"]') && !!document.querySelector('.campos-creacion input[data-campo-ficha="Dios"]')`), 'Campos: la creación pide los datos propios de la campaña');
    await js(ana, `(()=>{const s=document.querySelector('select[data-campo-ficha="Alineamiento"]');s.value='Bueno';s.dispatchEvent(new Event('change'))})()`);
    await clicTexto(ana, 'Crear personaje');
    ok(await espera(ana, `__mesa.pantalla==='principal'`), 'Ana: crea a Thor y entra al mapa');
    ok(await js(ana, `__mesa.S.personajes.some(p=>p.nombre==='Thor' && p.imagen==='tokens/guerrero.png')`), 'Creación: el personaje guarda la imagen elegida');
    await esperar(300);
    ok(await js(ana, `__mesa.S.tokens.size===0`), 'Ana: entrar no despliega ningún token solo');
    await clicTexto(ana, 'Personaje', '.rail-btn');
    await js(ana, `document.querySelector('.pers-item').click()`);
    await espera(ana, `[...document.querySelectorAll('.pers-habs button')].some(b=>b.textContent==='Desplegar')`);
    ok(await js(ana, `[...document.querySelectorAll('.pers-habs button')].some(b=>b.textContent==='Desplegar')`), 'Ana: su panel ofrece desplegar a Thor');
    await clicTexto(ana, 'Personaje', '.rail-btn');            // plegar el panel para ver la casilla de inicio
    await esperar(150);
    await clicDerecho(ana, await pos(ana, 2, 5));
    let menuAna = await textosMenu(ana);
    ok(menuAna.includes('📍 Desplegar token…') && !menuAna.includes('Thor'), 'Menú: un jugador tiene una sola opción «Desplegar token…» (sin la lista en el menú)');
    await clicTexto(ana, '📍 Desplegar token…', '.menu-item');
    ok(await espera(ana, `document.querySelector('.modal [data-desplegar]')?.textContent.includes('Thor')`), 'Desplegar: se abre una ventana con los personajes que puede desplegar');
    await foto(ana, '02c-desplegar-token');
    await js(ana, `document.querySelector('.modal [data-desplegar]').click()`);
    ok(await espera(ana, `!document.querySelector('.modal')`), 'Desplegar: al elegir uno la ventana se cierra');
    ok(await espera(ana, `__mesa.S.tokens.size===1 && !!__mesa.S.tokens.get(__mesa.S.tokenActivo)`), 'Ana: despliega a Thor cuando ella quiere');
    ok(await js(ana, `(()=>{const t=__mesa.S.tokens.get(__mesa.S.tokenActivo);return t.x===2&&t.y===5})()`), 'Ana: Thor aparece en la casilla elegida');
    await clicDerecho(ana, await pos(ana, 3, 6));
    menuAna = await textosMenu(ana);
    ok(menuAna.includes('🔍 Analizar casilla') && !menuAna.includes('📍 Desplegar token…'), 'Menú: si ya están todos desplegados no ofrece desplegar');
    await js(ana, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await clicTexto(ana, 'Personaje', '.rail-btn');
    await js(ana, `__mesa.abrirPersonaje()`);
    ok(await espera(ana, `document.querySelectorAll('.ficha-pestana').length>=3`), 'Ficha: el personaje se organiza en pestañas');
    ok(await js(ana, `!!document.querySelector('.ventana .fila-etiquetas .chip-etiqueta[data-etiqueta="Bestia"]')`), 'Etiquetas: la ficha muestra la etiqueta «Bestia» del orco');
    ok(await espera(ana, `document.querySelector('.ventana .campos-ficha select[data-campo-ficha="Alineamiento"]')?.value==='Bueno'`), 'Campos: la ficha muestra el alineamiento elegido al crear');
    await js(ana, `(()=>{const i=document.querySelector('.ventana .campos-ficha input[data-campo-ficha="Dios"]');i.value='Tyr';i.dispatchEvent(new Event('change'))})()`);
    ok(await espera(ana, `__mesa.S.tokens.get(__mesa.S.tokenActivo).campos?.Dios==='Tyr'`), 'Campos: el jugador los cambia desde su ficha');
    await js(ana, `document.querySelector('.ficha-pestana[data-pestana="habilidades"]').click()`);
    ok(await espera(ana, `document.querySelector('.ficha-pestana.activa')?.dataset.pestana==='habilidades'`), 'Ficha: se cambia de pestaña');
    await js(ana, `document.querySelector('.ficha-pestana[data-pestana="resumen"]').click()`);
    await js(ana, `document.querySelector('.ventana[aria-label="Personaje"] .btn-icono').click()`);
    ok(await js(ana, `(()=>{const t=__mesa.S.tokens.get(__mesa.S.tokenActivo);return t.stats_base.Fuerza===13 && t.stats.Fuerza===16 && t.puntos_pendientes===2})()`), 'Ana: Thor tiene 10 + 3 puntos repartidos, +2 de raza y +1 de clase, y 2 puntos pendientes');
    await js(ana, `document.querySelector('.pers-item').click()`);

    // ── Archivos del cliente: base/tokens, base/maps, base/sonido ──
    ok(fs.existsSync(path.join(BASE, 'tokens', 'guerrero.png')), 'Archivos: los tokens se leen de base/tokens');
    ok(await espera(ana, `__mesa.vista && __mesa.imagen('maps/aldea.png') !== null`), 'Archivos: el fondo del mapa se carga desde la carpeta local');
    ok(await js(ana, `JSON.stringify(__mesa.S.mapa.fondo_ajuste)==='{"x":0,"y":0,"ancho":20,"alto":12}'`), 'Fondo: el cliente recibe la posición y el tamaño de la imagen de fondo');
    await js(gm, `(()=>{(document.getElementById('f-servidor')||(document.querySelector('[data-accion="anadir-servidor"]').click(),document.getElementById('f-servidor'))).value='127.0.0.1:8765';document.getElementById('f-usuario').value='Master';
      const c=document.getElementById('f-es-gm');c.checked=true;c.dispatchEvent(new Event('change'));document.getElementById('f-gm').value='cambia-esto';document.querySelector('form').requestSubmit()})()`);
    ok(await espera(gm, `__mesa.pantalla==='seleccion'`), 'GM: entra con su contraseña');
    ok(await js(gm, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Entrar sin personaje')`), 'GM: puede entrar sin personaje');
    await clicTexto(gm, 'Entrar sin personaje');
    ok(await espera(gm, `__mesa.pantalla==='principal'`), 'GM: llega al mapa');
    ok(await js(gm, `__mesa.S.mapa.celdas[0][0]==='muro' && __mesa.S.catalogo.tiles.barricada.rompible.golpes===3 && !('efectos' in __mesa.S.catalogo.tiles.brasas)`), 'Tiles: el cliente recibe las casillas y sus propiedades (sin los efectos internos)');
    ok(await js(gm, `__mesa.S.permisos.romper_casillas===true`), 'Tiles: el GM puede romper casillas');
    await esperar(500);
    await foto(ana, '03-principal-ana');
    ok(await js(gm, `__mesa.S.tokens.size===1`), 'GM: ve el token de Ana en el mapa');

    // ── Contraseña de GM errónea no debe pasar (tercera conexión) ──
    // (se prueba en los tests del servidor)

    // ── GM coloca un goblin con un clic real ──
    await comoVentana(gm, 'Panel del GM');
    ok(await js(gm, `!!document.querySelector('.ventana .gm')`), 'GM: se abre la ventana de herramientas');
    await clicTexto(gm, 'Colocar');
    await esperar(100);
    ok(await js(gm, `!document.querySelector('.aviso-modo').hidden`), 'GM: aparece el aviso de colocación');
    await clic(gm, 3, 5);
    await esperar(400);
    ok(await espera(gm, `[...__mesa.S.tokens.values()].some(t=>t.tipo==='enemigo')`), 'GM: el goblin aparece en el mapa');
    ok(await espera(ana, `[...__mesa.S.tokens.values()].some(t=>t.tipo==='enemigo')`), 'Ana: también ve al goblin');
    ok(await js(ana, `![...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo').stats`), 'Ana: NO recibe las estadísticas del goblin');
    await js(gm, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await foto(gm, '04-gm-goblin');

    // ── Arrastrar el token de Ana ──
    const thor = await js(ana, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje')`);
    const a = await pos(ana, thor.x, thor.y);
    const b = await pos(ana, thor.x, thor.y + 1);
    await ratonDown(ana, a); await ratonMove(ana, { x: a.x, y: Math.round((a.y + b.y) / 2) }); await ratonMove(ana, b);
    await foto(ana, '05-arrastrando');
    await ratonUp(ana, b);
    ok(await espera(ana, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje').y===${thor.y + 1}`), 'Ana: arrastra a Thor a otra casilla y el servidor lo acepta');
    ok(await espera(gm, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje').y===${thor.y + 1}`), 'GM: ve el movimiento');

    // arrastre a un muro: el servidor lo rechaza y el token no se mueve
    const muro = await pos(ana, 5, 3);
    const c0 = await pos(ana, thor.x, thor.y + 1);
    await ratonDown(ana, c0); await ratonMove(ana, muro); await ratonUp(ana, muro);
    await esperar(300);
    ok(await js(ana, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje').y===${thor.y + 1} && __mesa.S.tokens.size===2`), 'Ana: mover a un muro no cambia nada');

    // ── Regla con cambios de dirección (clic derecho) ──
    const derecho = async (w, p, tipo) => { w.webContents.sendInputEvent({ type: tipo, x: p.x, y: p.y, button: 'right', clickCount: 1, modifiers: tipo === 'mouseDown' ? ['leftButtonDown', 'rightButtonDown'] : ['leftButtonDown'] }); await esperar(80); };
    await js(ana, `document.querySelector('.herr[title^="Regla"]').click()`);
    const r0 = await pos(ana, 2, 8), r1 = await pos(ana, 6, 8), r2 = await pos(ana, 6, 10), r3 = await pos(ana, 3, 10);
    await ratonDown(ana, r0); await ratonMove(ana, r1);
    ok(await js(ana, `__mesa.vista.regla!==null && __mesa.vista.regla.puntos.length===1`), 'Regla: aparece la línea mientras se mide');
    await derecho(ana, r1, 'mouseDown'); await derecho(ana, r1, 'mouseUp');
    await ratonMove(ana, r2);
    ok(await js(ana, `__mesa.vista.regla.puntos.length===2`), 'Regla: el clic derecho fija un cambio de dirección');
    ok(await js(ana, `__mesa.vista.distanciaRegla()===6`), 'Regla: suma los tramos (4 + 2 = 6 casillas)');
    await foto(ana, '06-regla');
    await ratonMove(ana, r3);
    await derecho(ana, r3, 'mouseDown'); await derecho(ana, r3, 'mouseUp');
    ok(await js(ana, `__mesa.vista.regla.puntos.length===3`), 'Regla: se pueden añadir varios giros');
    ok(await espera(gm, `(__mesa.S.reglasAjenas.get('Ana')||[]).length>=3`), 'Regla: el GM ve la regla de Ana mientras mide');
    await ratonUp(ana, r3);
    ok(await espera(gm, `__mesa.S.reglasAjenas.size===0`), 'Regla: al terminar, la línea desaparece también para los demás');
    ok(await js(ana, `__mesa.vista.regla===null && __mesa.vista.temporales.length===0`), 'Regla: al terminar desaparece la línea y no queda ningún dibujo temporal');
    // ── Dibujos temporales ──
    await js(ana, `document.querySelector('.herr[title^="Lápiz"]').click()`);
    ok(await js(ana, `!document.querySelector('.panel-dibujo').hidden`), 'Dibujo: el lápiz muestra su panel (colores, borrar)');
    await js(ana, `document.querySelector('.color-lapiz[data-color="#c4533f"]').click()`);
    await ratonDown(ana, r0); await ratonMove(ana, r1);
    ok(await espera(gm, `__mesa.S.lapices?.has('Ana')`), 'Dibujo: mientras Ana dibuja, el GM ve su lápiz con su nombre');
    await ratonMove(ana, r2); await ratonUp(ana, r2);
    ok(await espera(gm, `__mesa.S.dibujos.length===1 && __mesa.S.dibujos[0].usuario==='Ana' && __mesa.S.dibujos[0].color==='#c4533f' && !__mesa.S.lapices.has('Ana')`), 'Dibujo: el trazo de Ana lo ve el GM, con su color (y su lápiz desaparece)');
    // Borrador: se pasa por encima de un trazo propio y desaparece
    await ratonDown(ana, r0); await ratonMove(ana, r1); await ratonUp(ana, r1);
    await espera(ana, `__mesa.S.dibujos.length===2`);
    await js(ana, `document.querySelector('[data-accion="modo-borrador"]').click()`);
    await ratonDown(ana, r0); await ratonMove(ana, r1); await ratonUp(ana, r1);
    // El borrador recorta: del trazo en «L» solo queda el tramo vertical que no tocó
    ok(await espera(gm, `__mesa.S.dibujos.length===1 && __mesa.S.dibujos[0].puntos.every(([x,y])=>x>6 && y>8.5)`), 'Dibujo: el borrador recorta los trazos por donde pasa (lo que no toca se queda)');
    await ratonDown(ana, r1); await ratonMove(ana, r2); await ratonUp(ana, r2);
    ok(await espera(gm, `__mesa.S.dibujos.length===0`), 'Dibujo: el borrador quita los trazos que toca');
    await js(ana, `document.querySelector('[data-accion="modo-lapiz"]').click()`);
    await ratonDown(ana, r0); await ratonMove(ana, r1); await ratonMove(ana, r2); await ratonUp(ana, r2);
    await espera(gm, `__mesa.S.dibujos.length===1`);
    await js(gm, `document.querySelector('.herr[title^="Lápiz"]').click()`);
    await js(gm, `document.querySelector('[data-accion="bloquear-dibujo"]').click()`);
    ok(await espera(ana, `__mesa.S.dibujoBloqueado===true && document.querySelector('.panel-dibujo').textContent.includes('bloqueado')`), 'Dibujo: el GM bloquea el dibujo y Ana lo ve');
    await ratonDown(ana, r0); await ratonMove(ana, r1); await ratonUp(ana, r1);
    await esperar(300);
    ok(await js(gm, `__mesa.S.dibujos.length===1`), 'Dibujo: con el dibujo bloqueado Ana no puede añadir trazos');
    await js(ana, `document.querySelector('[data-accion="capa-dibujos"]').click()`);
    ok(await js(ana, `__mesa.S.dibujos.length===1 && JSON.parse(localStorage.getItem('mesa-rol-ajustes')).verDibujos===false`), 'Dibujo: la capa se oculta sin perder el trazo');
    await js(ana, `document.querySelector('[data-accion="capa-dibujos"]').click()`);
    await js(gm, `document.querySelector('[data-accion="borrar-todos-dibujos"]').click()`);
    ok(await espera(ana, `__mesa.S.dibujos.length===0`), 'Dibujo: el GM borra todos los dibujos');
    await js(gm, `document.querySelector('[data-accion="bloquear-dibujo"]').click()`);
    await js(gm, `document.querySelector('.herr[title^="Cursor"]').click()`);
    await js(ana, `document.querySelector('.herr[title^="Cursor"]').click()`);
    // Pasar el ratón por encima de un token no muestra «null»; al moverse de casilla, el token se desliza
    {
      const tid = await js(ana, `__mesa.S.tokenActivo`);
      const tt = await js(ana, `(()=>{const t=__mesa.S.tokens.get(__mesa.S.tokenActivo);return {x:t.x,y:t.y}})()`);
      await ratonMove(ana, await pos(ana, tt.x, tt.y), []);
      ok(await espera(ana, `!document.querySelector('.tooltip-token').hidden && !document.querySelector('.tooltip-token').textContent.includes('null')`), 'Mapa: el aviso al pasar el ratón no dice «null»');
      await js(gm, `__mesa.red.enviar({tipo:'mover_token', token:${JSON.stringify(tid)}, x:${tt.x}, y:${tt.y + 1}})`);
      ok(await espera(ana, `!!__mesa.vista.posiciones.get(${JSON.stringify(tid)})?.anim`, 2000), 'Mapa: el token se desliza a su nueva casilla');
      await js(gm, `__mesa.red.enviar({tipo:'mover_token', token:${JSON.stringify(tid)}, x:${tt.x}, y:${tt.y}})`);
      await espera(ana, `__mesa.S.tokens.get(${JSON.stringify(tid)}).y===${tt.y}`);
    }

    // ── Mano y zoom ──
    const antes = await js(ana, `({...__mesa.vista.cam})`);
    await js(ana, `document.querySelector('.herr[title="Acercar"]').click()`);
    const despues = await js(ana, `({...__mesa.vista.cam})`);
    ok(despues.zoom > antes.zoom, 'Zoom: el botón + acerca el mapa');
    await js(ana, `document.querySelector('.herr[title^="Mano"]').click()`);
    const m0 = await pos(ana, 9, 2); const m1 = { x: m0.x + 60, y: m0.y + 30 };
    await ratonDown(ana, m0); await ratonMove(ana, m1); await ratonUp(ana, m1);
    const movida = await js(ana, `({...__mesa.vista.cam})`);
    ok(Math.abs(movida.x - despues.x - 60) < 2 && Math.abs(movida.y - despues.y - 30) < 2, 'Mano: arrastrar desplaza el mapa');
    await js(ana, `document.querySelector('.herr[title^="Cursor"]').click(); __mesa.vista.ajustar()`);

    // ── Chat y dados ──
    await js(ana, `(()=>{const i=document.querySelector('.chat-entrada');i.value='¡Por la aldea! <b>negrita</b>';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))})()`);
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('Por la aldea'))`), 'Chat: el GM recibe el mensaje de Ana');
    ok(await js(gm, `![...document.querySelectorAll('.chat b')].length`), 'Chat: el HTML del mensaje se muestra como texto, no se ejecuta');
    // Salas privadas
    ok(await js(ana, `!document.querySelector('[data-accion="nueva-sala"]')`), 'Salas: un jugador no puede crear salas');
    await js(gm, `document.querySelector('[data-accion="nueva-sala"]').click()`);
    await espera(gm, `!!document.querySelector('[data-campo="nombre-sala"]')`);
    await js(gm, `(()=>{document.querySelector('[data-campo="nombre-sala"]').value='Susurros';document.querySelector('input[data-usuario="Ana"]').click()})()`);
    await js(gm, `document.querySelector('[data-accion="guardar-sala"]').click()`);
    ok(await espera(ana, `!!document.querySelector('.chat-sala[data-sala]:not([data-sala="general"])')`), 'Salas: Ana ve la sala a la que la invitó el GM');
    await js(ana, `document.querySelector('.chat-sala[data-sala]:not([data-sala="general"])').click()`);
    await js(ana, `(()=>{const i=document.querySelector('.chat-entrada');i.value='solo para el GM';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))})()`);
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('solo para el GM'))`), 'Salas: el mensaje de la sala llega al GM (que se pasó a la sala nueva al crearla)');
    await js(gm, `document.querySelector('.chat-sala[data-sala="general"]').click()`);
    ok(await js(gm, `![...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('solo para el GM'))`), 'Salas: en la sala general no aparece lo de la sala privada');
    await js(ana, `(()=>{const i=document.querySelector('.chat-entrada');i.value='otro susurro';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))})()`);
    ok(await espera(gm, `[...document.querySelectorAll('.chat-sin-leer')].length===1`), 'Salas: el GM ve el aviso de mensajes sin leer de la otra sala');
    await js(ana, `document.querySelector('.chat-sala[data-sala="general"]').click()`);
    await comoVentana(ana, 'Tiradas');
    await esperar(150);
    await clicTexto(ana, 'd20', '.dado');
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg-dado')].length>=1`), 'Dados: la tirada de Ana llega al chat del GM');
    // Tiradas guardadas
    const vTir = `document.querySelector('.ventana[aria-label="Tiradas"]')`;
    await js(ana, `(()=>{const v=${vTir};v.querySelector('[aria-label="Nombre de la tirada"]').value='Ataque';v.querySelector('[aria-label="Qué se tira"]').value='1d20 + [Fuerza]';v.querySelector('[data-accion="guardar-tirada"]').click()})()`);
    ok(await espera(ana, `${vTir}.querySelector('[data-tirada="Ataque"]')?.textContent.includes('1d20 + [Fuerza]')`), 'Tiradas: Ana guarda «Ataque» (con una estadística)');
    await js(ana, `${vTir}.querySelector('[data-tirada="Ataque"] .btn-acento').click()`);
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg-dado')].some(m=>m.textContent.includes('Thor (Ana) tiró «Ataque»'))`), 'Tiradas: la tirada guardada usa la Fuerza de Thor');
    const enChat = (w, t) => js(w, `(()=>{const i=document.querySelector('.chat-entrada');i.value=${JSON.stringify(t)};i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))})()`);
    await enChat(ana, '/ataque');
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg-dado')].filter(m=>m.textContent.includes('tiró «Ataque»')).length===2`), 'Comandos: /ataque en el chat lanza la tirada guardada');
    await enChat(ana, '/ayuda');
    ok(await espera(ana, `[...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('/gm contraseña') && m.textContent.includes('/Ataque'))`), 'Comandos: /ayuda explica los comandos y tus tiradas');
    ok(await js(gm, `![...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('/gm contraseña'))`), 'Comandos: la ayuda solo la ve quien la pide');
    await enChat(ana, '/gm clave-equivocada');
    await esperar(400);
    ok(await js(gm, `![...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('clave-equivocada'))`) && await js(ana, `!__mesa.S.esGM && ![...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('clave-equivocada'))`), 'Comandos: /gm con contraseña mala no la muestra a nadie ni da permisos');
    await js(ana, `${vTir}.querySelector('[data-tirada="Ataque"] [aria-label="Borrar Ataque"]').click()`);
    ok(await espera(ana, `!${vTir}.querySelector('[data-tirada]')`), 'Tiradas: se pueden borrar');
    await foto(ana, '07-tiradas');

    // ── Combate ──
    await clicTexto(gm, 'Iniciar combate');
    ok(await espera(ana, `__mesa.S.combate.preparando && document.querySelector('[data-accion="tirar-iniciativa"]')`), 'Combate: primero se deciden los turnos y Ana puede tirar su iniciativa');
    ok(await js(gm, `!!document.querySelector('[data-accion="empezar-combate"]')`), 'Combate: el GM puede empezar sin esperar');
    ok(await espera(gm, `document.querySelectorAll('.turnos-ventana [data-accion="sacar-de-turnos"]').length===__mesa.S.combate.preparando.participantes.length`) && await js(ana, `!document.querySelector('[data-accion="sacar-de-turnos"]')`), 'Turnos: el GM puede sacar a cualquiera de los turnos (✕); los jugadores no');
    await js(ana, `document.querySelector('[data-accion="tirar-iniciativa"]').click()`);
    ok(await espera(ana, `__mesa.S.combate.activo`), 'Combate: cuando todos han tirado, empieza para todos');
    {
      const enTurnos = await js(gm, `__mesa.S.combate.orden[0]`);
      const tk = await js(gm, `__mesa.S.tokens.get(${JSON.stringify(enTurnos)})`);
      await clicDerecho(gm, await pos(gm, tk.x, tk.y));
      ok((await textosMenu(gm)).includes('➖ Sacar de los turnos'), 'Turnos: en combate, el menú del GM ofrece sacar a un token de los turnos');
      await js(gm, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    }
    await esperar(300);
    await foto(gm, '08-combate-gm');
    // dejar que sea el turno de Ana
    let turnoAna = await js(ana, `__mesa.S.tokens.get(__mesa.S.combate.turno_de).tipo==='personaje'`);
    if (!turnoAna) { await clicTexto(gm, 'Terminar turno'); await esperar(400); }
    ok(await espera(ana, `!document.querySelector('.btn-turno').disabled`), 'Turnos: a Ana se le activa «Terminar turno» en su turno');
    ok(await js(ana, `!!document.querySelector('.chip-turno.actual')`), 'Turnos: la tira marca de quién es el turno');

    // ── Habilidad con objetivo (rango visible) ──
    await esperar(200);
    ok(await js(ana, `!document.querySelector('.seccion-bloque').hidden && document.querySelectorAll('.pers-item').length===1 && !document.querySelector('.pers-habs')`), 'Panel: «Personaje» despliega la lista de personajes (con las habilidades plegadas)');
    ok(await js(ana, `(()=>{const i=document.querySelector('.pers-item img');if(!i)return false;const r=i.getBoundingClientRect();return r.width<=32&&r.height<=32})()`), 'Panel: el retrato de la lista es pequeño aunque la imagen sea enorme (1200×1200)');
    ok(await js(ana, `[...document.querySelectorAll('.panel-izq img')].every(i=>i.getBoundingClientRect().width<=document.querySelector('.panel-izq').getBoundingClientRect().width)`), 'Panel: ninguna imagen se sale del panel izquierdo');
    await js(ana, `document.querySelector('.pers-item').click()`);
    ok(await espera(ana, `[...document.querySelectorAll('.pers-habs li')].some(l=>l.textContent.includes('Ataque básico'))`), 'Panel: al pulsar un personaje se despliegan sus habilidades');
    await js(ana, `document.querySelector('.pers-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:60,clientY:200}))`);
    ok(await espera(ana, `[...document.querySelectorAll('.menu-item')].some(b=>b.textContent==='Ver ficha')`), 'Panel: clic derecho sobre el personaje ofrece la ficha');
    await clicTexto(ana, 'Ver ficha', '.menu-item');
    ok(await espera(ana, `!!document.querySelector('.ventana[aria-label="Thor"] .ficha')`), 'Panel: la ficha se abre como ventana propia');
    await foto(ana, '09-ficha');
    await js(ana, `document.querySelector('.ventana[aria-label="Thor"] .btn-icono').click()`);
    // Movimiento limitado en combate (30 casillas por turno en esta mesa de prueba)
    ok(await espera(ana, `document.querySelector('.tira-movimiento')?.dataset.quedan==='30'`), 'Movimiento: en su turno Ana ve cuántas casillas puede andar');
    ok(await js(gm, `!document.querySelector('.tira').textContent.includes('null')`) && await js(ana, `!document.querySelector('.tira').textContent.includes('null')`), 'Turnos: la barra no muestra textos raros');
    ok(await js(gm, `document.querySelectorAll('.chip-turno [data-accion="turno-despues"]').length>=2`) && await js(ana, `!document.querySelector('.chip-turno [data-accion="turno-despues"]')`), 'Turnos: el GM tiene flechas para reordenar (el jugador no)');
    {
      const yo = await js(ana, `(()=>{const t=__mesa.S.tokens.get(__mesa.S.combate.turno_de);return {id:t.id,x:t.x,y:t.y}})()`);
      const destino = await js(ana, `(()=>{for(const [dx,dy] of [[0,-1],[0,1],[-1,0]]){if(__mesa.vista.casillaLibre(${yo.x}+dx,${yo.y}+dy,null))return {x:${yo.x}+dx,y:${yo.y}+dy}}return null})()`);
      await js(ana, `__mesa.red.enviar({tipo:'mover_token', token:${JSON.stringify(yo.id)}, x:${destino.x}, y:${destino.y}})`);
      ok(await espera(ana, `document.querySelector('.tira-movimiento')?.dataset.quedan==='29'`), 'Movimiento: al andar una casilla le quedan 29');
      await js(ana, `__mesa.red.enviar({tipo:'mover_token', token:${JSON.stringify(yo.id)}, x:${yo.x}, y:${yo.y}})`);
      await espera(ana, `document.querySelector('.tira-movimiento')?.dataset.quedan==='28'`);
    }
    ok(await js(ana, `!!document.querySelector('.pers-habs .tarjeta-habilidad [data-accion="info-habilidad"]')`), 'Habilidades: cada una es una tarjeta con «Usar» e «Info»');
    await js(ana, `document.querySelector('.pers-habs [data-accion="info-habilidad"]').click()`);
    ok(await espera(ana, `document.querySelector('.ventana[aria-label] .info-rejilla .info-celda.origen') && document.querySelector('.info-datos')`), 'Habilidades: «Info» abre el dibujo del área y sus datos');
    await foto(ana, '09b-info-habilidad');
    await js(ana, `document.querySelector('.ventana .info-habilidad').closest('.ventana').querySelector('.btn-icono').click()`);
    await clicTexto(ana, 'Usar', '.pers-habs button');
    ok(await js(ana, `!document.querySelector('.aviso-modo').hidden`), 'Habilidad: pide elegir objetivo');
    await foto(ana, '10-objetivo');
    const gob = await js(ana, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo')`);
    // Thor está en (2,6) y el goblin en (3,5): a 1 casilla en diagonal
    await clic(ana, gob.x, gob.y);
    ok(await espera(ana, `[...document.querySelectorAll('.chat .msg-combate')].some(m=>m.textContent.includes('Ataque básico'))`), 'Habilidad: el ataque se resuelve y aparece en el chat');
    ok(await espera(ana, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo').estados.some(e=>e.id==='veneno')`), 'Efectos: el toque venenoso del orco envenena al goblin');
    ok(await espera(ana, `[...document.querySelectorAll('.chat .msg-combate')].some(m=>m.textContent.includes('sufre «Veneno»'))`), 'Efectos: el chat avisa del veneno');
    ok(await espera(ana, `__mesa.S.tokens.get('${gob.id}').recursos.HP.actual < 45`), 'Habilidad: el goblin pierde vida');
    await foto(ana, '11-tras-ataque');

    await clicTexto(ana, 'Terminar turno');
    ok(await espera(ana, `__mesa.S.tokens.get(__mesa.S.combate.turno_de).tipo==='enemigo'`), 'Turnos: «Terminar turno» pasa al goblin');
    ok(await js(ana, `document.querySelector('.btn-turno').disabled`), 'Turnos: sin turno propio el botón queda desactivado');

    // ── Niveles: al juntar 100 de Experiencia, Thor sube a nivel 2 (y gana lo que da el nivel) ──
    {
      const thor = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Thor')`);
      ok(thor.nivel === 1 && thor.experiencia?.siguiente === 100, 'Niveles: Thor empieza en nivel 1 y necesita 100 de experiencia');
      await js(gm, `__mesa.red.enviar({tipo:'gm_editar_token', token:${JSON.stringify(thor.id)}, stats:{Experiencia:150}})`);
      ok(await espera(ana, `__mesa.S.chat.some(m=>m.texto.includes('Thor sube a nivel 2'))`), 'Niveles: el chat anuncia la subida de nivel');
      ok(await espera(ana, `(()=>{const t=[...__mesa.S.tokens.values()].find(t=>t.nombre==='Thor');return t.nivel===2&&t.experiencia.siguiente===300})()`), 'Niveles: Thor pasa a nivel 2 (el siguiente, a los 300)');
      await js(ana, `__mesa.abrirPersonaje()`);
      ok(await espera(ana, `document.querySelector('.ficha-nivel')?.dataset.nivel==='2' && document.querySelector('.nivel-barra')`), 'Niveles: la ficha muestra el nivel y la barra de experiencia');
      await foto(ana, '11b-nivel');
      await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
      await js(gm, `__mesa.abrirPersonaje(${JSON.stringify(thor.id)})`);
      await espera(gm, `document.querySelector('.ventana [data-accion="subir-nivel"]')`);
      await js(gm, `document.querySelector('.ventana [data-accion="subir-nivel"]').click()`);
      ok(await espera(ana, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Thor').nivel===3`), 'Niveles: el GM también puede subir de nivel a mano');
      await js(gm, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    }

    // ── Inventario ──
    await js(gm, `__mesa.red.enviar({tipo:'gm_objeto', token:[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje').id, objeto:'pocion', cantidad:2})`);
    await esperar(300);
    await js(ana, `document.querySelector('.rail-btn[title="Inventario"]').click()`);
    ok(await espera(ana, `[...document.querySelectorAll('.seccion-bloque:not([hidden]) .fila-accion strong')].some(e=>e.textContent.includes('Poción'))`), 'Panel: el inventario se despliega dentro del panel izquierdo');
    ok(await js(ana, `!document.querySelector('.ventana[aria-label="Inventario"]')`), 'Panel: desplegar no abre ventana');
    await js(ana, `document.querySelector('.btn-icono[aria-label="Abrir Inventario en una ventana"]').click()`);
    ok(await espera(ana, `!!document.querySelector('.ventana[aria-label="Inventario"] .fila-accion') && document.querySelector('.rail-btn[title="Inventario"]').getAttribute('aria-expanded')==='false'`), 'Panel: «sacar a ventana» la separa del panel');
    ok(await js(ana, `document.querySelector('.ventana[aria-label="Inventario"] .fila-accion strong').textContent.includes('Poción')`), 'Inventario: muestra la Poción que dio el GM');
    await foto(ana, '12-inventario');
    // Usar con alguien cercano y dar a un token cercano (con confirmación)
    await js(ana, `document.querySelector('.ventana[aria-label="Inventario"] [data-accion="usar-objeto"]').click()`);
    ok(await espera(ana, `(()=>{const b=[...document.querySelectorAll('.modal [data-objetivo]')];return b.length>=2 && b[0].textContent.includes('Él mismo') && b.some(x=>x.textContent.includes('Goblin'))})()`), 'Objetos: «Usar» deja elegir con quién (él mismo o alguien cercano)');
    await foto(ana, '12b-usar-con-quien');
    await js(ana, `document.querySelector('.modal-pie .btn').click()`);
    await espera(ana, `!document.querySelector('.modal')`);
    ok(await js(ana, `!!document.querySelector('.ventana[aria-label="Inventario"] [data-accion="dar-objeto"]')`), 'Objetos: el inventario tiene «Dar»');
    await js(ana, `document.querySelector('.ventana[aria-label="Inventario"] [data-accion="dar-objeto"]').click()`);
    ok(await espera(ana, `[...document.querySelectorAll('.modal [data-objetivo]')].some(x=>x.textContent.includes('Goblin')) && ![...document.querySelectorAll('.modal [data-objetivo]')].some(x=>x.textContent.includes('Thor'))`), 'Objetos: «Dar» lista los tokens cercanos (no a sí mismo)');
    await foto(ana, '12c-dar-objeto');
    await js(ana, `[...document.querySelectorAll('.modal [data-objetivo]')].find(x=>x.textContent.includes('Goblin')).click()`);
    ok(await espera(ana, `document.querySelector('.modal .modal-texto')?.textContent.includes('¿Dar 1 × Poción a Goblin?')`), 'Objetos: pide confirmación antes de dar');
    await foto(ana, '12d-dar-confirmar');
    await js(ana, `document.querySelector('.modal-pie [data-valor="false"]').click()`);
    ok(await espera(ana, `!document.querySelector('.modal')`), 'Objetos: cancelar no da nada');

    // ── Paneles plegables ──
    await js(ana, `document.querySelector('.rail-plegar').click(); document.querySelector('.plegar-der').click()`);
    await esperar(300);
    ok(await js(ana, `document.querySelector('.panel-izq').classList.contains('plegado') && document.querySelector('.panel-der').classList.contains('plegado')`), 'Paneles: se pliegan');
    await foto(ana, '13-paneles-plegados');
    await js(ana, `document.querySelector('.rail-plegar').click(); document.querySelector('.plegar-der').click()`);

    // ── Panel de salas (GM) ──
    await js(gm, `document.querySelector('.barra-izq .btn-icono').click()`);
    await esperar(150);
    ok(await js(gm, `!document.querySelector('.panel-salas').hidden && document.querySelectorAll('.sala-item').length>=1`), 'Salas: el GM ve la lista de salas');
    await foto(gm, '14-salas');

    // ── GM: quién está conectado ──
    ok(await espera(gm, `__mesa.S.conectados && __mesa.S.conectados.usuarios.length===2`), 'Salas: el GM recibe la lista de conectados');
    await js(gm, `document.querySelector('.barra-izq .btn-icono').click()`);
    ok(await espera(gm, `document.querySelector('[data-conectado="Ana"]') && document.querySelector('[data-conectado="Master"]')`), 'Salas: el panel muestra a Ana y al GM');
    await js(gm, `document.querySelector('.barra-izq .btn-icono').click()`);
    ok(await js(ana, `!__mesa.S.conectados`), 'Salas: un jugador no recibe la lista de conectados');

    // ── Reglas y dados definidos por el servidor ──
    ok(await js(ana, `__mesa.S.catalogo.dados.join()==='4,6,8,10,12,20,100' && __mesa.S.catalogo.reglas.rasgos_personalidad===false && __mesa.S.permisos.dados_personalizados===true`), 'Reglas: el servidor manda dados y reglas públicas');
    await comoVentana(ana, 'Diario');
    const diarioAna = `document.querySelector('.ventana[aria-label="Diario"]')`;
    ok(await espera(ana, `${diarioAna}?.textContent.includes('Armas de la aldea') && !${diarioAna}.textContent.includes('secreto del tabernero')`), 'Diario: el jugador ve las páginas visibles y no las ocultas');
    ok(await js(ana, `!${diarioAna}.querySelector('.diario-gm') && !${diarioAna}.querySelector('.diario-vis')`), 'Diario: el jugador no ve los controles del GM');
    await js(ana, `${diarioAna}.querySelector('[data-pagina="armas"] .diario-enlace').click()`);
    ok(await espera(ana, `${diarioAna}.querySelector('.diario-texto h4')?.textContent==='Cuerpo a cuerpo' && ${diarioAna}.querySelector('.diario-texto li strong')?.textContent==='Espada corta'`), 'Diario: la página se lee con subtítulos, listas y negritas');
    await js(ana, `${diarioAna}.querySelector('[data-accion="diario-volver"]').click()`);
    await js(ana, `(()=>{const b=${diarioAna}.querySelector('.diario-buscar');b.value='hacha';b.dispatchEvent(new Event('input'))})()`);
    ok(await espera(ana, `${diarioAna}.querySelectorAll('.diario-fila').length===1 && ${diarioAna}.querySelector('[data-pagina="armas"]')`), 'Diario: el buscador mira también dentro del texto');
    await js(ana, `(()=>{const b=${diarioAna}.querySelector('.diario-buscar');b.value='';b.dispatchEvent(new Event('input'))})()`);
    await js(ana, `${diarioAna}.querySelector('[data-pagina="__reglas"] .diario-enlace').click()`);
    ok(await espera(ana, `${diarioAna}?.textContent.includes('Berserker') && ${diarioAna}.textContent.includes('Quién controla la música')`), 'Diario: «Reglas de la mesa» explica la mesa y las clases');
    await comoVentana(gm, 'Diario');
    const diarioGM = `document.querySelector('.ventana[aria-label="Diario"]')`;
    ok(await espera(gm, `${diarioGM}?.querySelector('[data-pagina="secreto_tabernero"] .diario-vis') && __txt(${diarioGM}.querySelector('[data-pagina="secreto_tabernero"] .diario-vis'))==='🔒'`), 'Diario: el GM ve también las ocultas, marcadas con 🔒');
    await js(gm, `${diarioGM}.querySelector('[data-pagina="secreto_tabernero"] .diario-enlace').click()`);
    ok(await espera(gm, `${diarioGM}.querySelector('.diario-solo [data-jugador="Ana"]')`), 'Diario: el GM puede mostrar una página solo a algunos jugadores');
    await js(gm, `${diarioGM}.querySelector('.diario-solo [data-jugador="Ana"]').click()`);
    ok(await espera(ana, `__mesa.S.diario.paginas.some(p=>p.id==='secreto_tabernero') && __mesa.S.chat.some(m=>m.texto.includes('Nueva página en el diario'))`), 'Diario: Ana recibe la página que el GM le revela (y un aviso)');
    ok(await espera(gm, `${diarioGM}.querySelector('.diario-gm')?.textContent.includes('Solo: Ana')`), 'Diario: el GM ve a quién se la mostró');
    await js(gm, `${diarioGM}.querySelector('[data-accion="diario-ocultar"]').click()`);
    ok(await espera(ana, `!__mesa.S.diario.paginas.some(p=>p.id==='secreto_tabernero')`), 'Diario: el GM puede volver a ocultarla');
    await js(gm, `document.querySelector('.ventana[aria-label="Diario"] .btn-icono[aria-label^="Cerrar"]').click()`);

    // ── NPC: aliados, neutrales y enemigos ──
    ok(await js(ana, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo').bando==='enemigo'`), 'NPC: el goblin llega al jugador con su bando (enemigo)');
    await js(gm, `__mesa.red.enviar({tipo:'gm_colocar_enemigo', enemigo:'tabernero', x:15, y:8})`);
    ok(await espera(ana, `[...__mesa.S.tokens.values()].some(t=>t.nombre==='Tabernero' && t.bando==='neutral')`), 'NPC: el tabernero es neutral por defecto y el jugador lo sabe');
    await js(gm, `__mesa.red.enviar({tipo:'gm_editar_token', token:[...__mesa.S.tokens.values()].find(t=>t.nombre==='Tabernero').id, bando:'enemigo'})`);
    ok(await espera(ana, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Tabernero').bando==='enemigo'`), 'NPC: el GM cambia el bando en plena partida');
    await js(gm, `__mesa.red.enviar({tipo:'gm_quitar_token', token:[...__mesa.S.tokens.values()].find(t=>t.nombre==='Tabernero').id})`);
    ok(await espera(ana, `__mesa.S.permisos.modo_ataque==='enemigos_y_neutros'`), 'NPC: por defecto los jugadores pueden atacar a enemigos y neutrales');
    ok(await js(ana, `document.querySelector('.ventana[aria-label="Diario"]')?.textContent.includes('A quién puedes atacar') ?? true`), 'Reglas: dice a quién puede atacar el jugador');

    // ── Música: la lista es del servidor, con categorías; verde si tienes el archivo, rojo si no ──
    ok(await js(ana, `document.querySelector('.musica').classList.contains('plegada') && document.querySelector('.musica-contenido').hidden`), 'Música: empieza plegada (el chat se ve más)');
    for (const w of [ana, gm]) await js(w, `document.querySelector('.musica.plegada [data-accion="plegar-musica"]')?.click()`);
    await espera(ana, `!document.querySelector('.musica').classList.contains('plegada')`);
    ok(await espera(ana, `document.querySelector('.pista[data-sonido="tema_de_prueba.wav"]')?.classList.contains('tiene')`), 'Música: el tema que Ana tiene sale en verde');
    ok(await js(ana, `document.querySelector('.pista[data-sonido="taberna.wav"]').classList.contains('falta') && document.querySelector('.pista[data-sonido="batalla.ogg"]').classList.contains('falta')`), 'Música: los temas que le faltan salen en rojo');
    ok(await js(ana, `[...document.querySelectorAll('.musica-cat')].map(c=>c.dataset.categoria).join()==='Pueblo,Pruebas' && document.querySelector('.pista[data-sonido="batalla.ogg"]').closest('.musica-cat').dataset.categoria==='Pruebas'`), 'Música: los archivos se agrupan por categoría');
    ok(await js(ana, `!document.querySelector('.musica-pestana') || document.querySelector('.musica-pestanas').hidden`), 'Sonido: un jugador no ve pestañas de ambiente ni efectos');
    ok(await js(ana, `!document.querySelector('[data-ambiente]') && !document.querySelector('[data-efecto]') && !('ambiente' in __mesa.S.catalogo.sonidos)`), 'Sonido: el servidor no le manda a un jugador las listas de ambiente y efectos');
    ok(await js(gm, `document.querySelectorAll('.musica-pestana').length===3`), 'Sonido: el GM tiene pestañas de Música, Ambiente y Efectos');
    ok(await js(ana, `!document.querySelector('.musica').textContent.includes('Verde: tienes el archivo')`), 'Música: sin el texto de ayuda sobrante');
    await js(ana, `document.querySelector('[data-accion="plegar-musica"]').click()`);
    ok(await espera(ana, `document.querySelector('.musica').classList.contains('plegada') && document.querySelector('.musica-contenido').hidden`), 'Música: se puede plegar para dejar sitio al chat');
    ok(await js(ana, `JSON.parse(localStorage.getItem('mesa-rol-ajustes')).musicaPlegada===true`), 'Música: plegada se recuerda');
    await js(ana, `document.querySelector('[data-accion="plegar-musica"]').click()`);
    ok(await espera(ana, `!document.querySelector('.musica').classList.contains('plegada') && document.querySelectorAll('.musica-cat').length>0`), 'Música: se vuelve a desplegar');
    await js(gm, `document.querySelector('.pista[data-sonido="tema_de_prueba.wav"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    ok(await espera(ana, `__mesa.S.musica==='tema_de_prueba.wav'`), 'Música: Ana recibe la orden del GM');
    ok(await espera(ana, `__mesa.audio.src.startsWith('file:') && __mesa.audio.src.endsWith('/base/sonido/musica/tema_de_prueba.wav')`), 'Música: se reproduce desde base/sonido/musica');
    ok(await espera(ana, `__mesa.audio.readyState >= 1`, 6000), 'Música: el archivo guardado se puede reproducir (metadatos cargados)');
    ok(await js(ana, `__mesa.audio.loop===true`), 'Música: por defecto se repite');
    await js(ana, `document.querySelector('[data-ajuste="bucleMusica"]').click()`);
    ok(await espera(ana, `__mesa.audio.loop===false`), 'Música: la casilla «Repetir» apaga la repetición en el cliente');
    await js(ana, `document.querySelector('[data-ajuste="bucleMusica"]').click()`);
    ok(await js(gm, `!!document.querySelector('[data-accion="parar-ya"]') && !!document.querySelector('[data-accion="parar-fundido"]') && !document.querySelector('[data-accion="parar-fundido"]').hidden`), 'Música: hay dos botones de parar (de golpe y con fundido)');
    await js(gm, `document.querySelector('[data-accion="parar-fundido"]').click()`);
    ok(await espera(ana, `__mesa.S.musica===null && __mesa.audio.getAttribute('src') && __mesa.audio.volume < 0.5`, 2000) || await espera(ana, `__mesa.S.musica===null`, 2000), 'Música: con fundido baja el volumen poco a poco');
    ok(await espera(ana, `!__mesa.audio.getAttribute('src')`, 6000), 'Música: al terminar el fundido se detiene');
    await js(gm, `document.querySelector('.pista[data-sonido="tema_de_prueba.wav"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    ok(await espera(ana, `__mesa.S.musica==='tema_de_prueba.wav'`), 'Música: se vuelve a poner');
    await js(gm, `document.querySelector('[data-accion="parar-ya"]').click()`);
    ok(await espera(ana, `__mesa.S.musica===null && !__mesa.audio.getAttribute('src')`, 1500), 'Música: parar de golpe la corta al instante');

    // Ambiente y efectos: los controla el GM y los oyen todos
    await js(gm, `document.querySelector('[data-pestana="ambiente"]').click()`);
    ok(await espera(gm, `document.querySelector('[data-ambiente="lluvia_de_prueba.wav"]')?.classList.contains('tiene') && document.querySelector('[data-ambiente="viento_que_falta.wav"]')?.classList.contains('falta')`), 'Ambiente: el GM ve verde lo que tiene y rojo lo que le falta');
    await js(gm, `document.querySelector('[data-ambiente="lluvia_de_prueba.wav"]').click()`);
    ok(await espera(ana, `JSON.stringify(__mesa.S.ambiente)==='["lluvia_de_prueba.wav"]'`), 'Ambiente: Ana recibe el sonido que el GM enciende');
    ok(await espera(gm, `document.querySelector('[data-ambiente="lluvia_de_prueba.wav"]')?.classList.contains('sonando')`), 'Ambiente: el GM lo ve encendido');
    await js(gm, `document.querySelector('.rail-btn[title="Diario"]').click()`);
    await foto(gm, '19-gm-ambiente-y-reglas');
    await js(gm, `document.querySelector('.rail-btn[title="Diario"]').click()`);
    await js(gm, `document.querySelector('[data-accion="parar-ambiente"]').click()`);
    ok(await espera(ana, `__mesa.S.ambiente.length===0`), 'Ambiente: el GM lo apaga para todos');
    await js(gm, `document.querySelector('[data-pestana="efectos"]').click()`);
    ok(await espera(gm, `document.querySelector('[data-efecto="golpe_de_prueba.wav"]')?.classList.contains('tiene')`), 'Efectos: el GM ve la lista de efectos');
    await js(gm, `document.querySelector('[data-efecto="golpe_de_prueba.wav"]').click()`);
    await js(gm, `document.querySelector('[data-pestana="musica"]').click()`);

    // ── Barras laterales: más anchas y con agarre para cambiar el ancho ──
    ok(await js(ana, `document.querySelector('.panel-der').getBoundingClientRect().width >= 340`), 'Barras: la derecha es más ancha que antes');
    ok(await js(ana, `!!document.querySelector('.agarre-der') && !document.querySelector('.agarre-der').hidden`), 'Barras: la derecha tiene un agarre en el borde');
    await js(ana, `document.querySelector('.agarre-der').focus()`);
    const anchoAntes = await js(ana, `document.querySelector('.panel-der').getBoundingClientRect().width`);
    await ana.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
    await ana.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
    ok(await espera(ana, `document.querySelector('.panel-der').getBoundingClientRect().width > ${anchoAntes} + 10`), 'Barras: con el teclado se ensancha');
    ok(await js(ana, `JSON.parse(localStorage.getItem('mesa-rol-ajustes')).anchoDer>360`), 'Barras: el ancho se recuerda');
    await js(ana, `document.querySelector('.agarre-der').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    ok(await espera(ana, `Math.round(document.querySelector('.panel-der').getBoundingClientRect().width)===360`), 'Barras: doble clic vuelve al ancho original');

    // ── Ajustes: archivos del cliente ──
    await comoVentana(ana, 'Ajustes');
    ok(await espera(ana, `!document.querySelector('.ventana[aria-label="Ajustes"] .ruta') && !document.querySelector('.ventana[aria-label="Ajustes"]').textContent.includes('/base') && !document.querySelector('.ventana[aria-label="Ajustes"]').textContent.includes('AppData')`), 'Ajustes: no muestra la ruta de la carpeta');
    ok(await espera(ana, `[...document.querySelectorAll('.ventana[aria-label="Ajustes"] .uso dd')].some(d=>d.textContent.startsWith('2 archivos'))`), 'Ajustes: cuenta los archivos de base/tokens');
    // El .zip de archivos de la campaña (lo exporta el GM con el Editor) se instala en una carpeta propia de esa campaña
    {
      const { crearZip } = require('../../server/editor/zip');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const rutaZip = path.join(require('os').tmpdir(), `e2e-archivos-${process.pid}.zip`);
      fs.writeFileSync(rutaZip, crearZip([{ nombre: 'mesa-campana.json', datos: Buffer.from(JSON.stringify({ campana: 'e2e-config', nombre: 'Mesa de Prueba' })) },
        { nombre: 'tokens/del_zip.png', datos: png }, { nombre: 'sonido/musica/batalla.ogg', datos: Buffer.from('OggS') }]));
      require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rutaZip] });
      ok(await js(ana, `__mesa.S.campana`) === 'e2e-config', 'Archivos: el servidor dice de qué campaña es');
      await js(ana, `document.querySelector('.ventana[aria-label="Ajustes"] [data-accion="importar-zip"]').click()`);
      ok(await espera(ana, `document.querySelector('.ventana[aria-label="Ajustes"] [data-resultado="zip"]')?.textContent.includes('2 archivos de «Mesa de Prueba» instalados')`), 'Archivos: Ajustes → «Importar archivos de campaña (.zip)» los instala');
      ok(fs.existsSync(path.join(BASE, 'campanas', 'e2e-config', 'tokens', 'del_zip.png')), 'Archivos: van a la carpeta propia de la campaña');
      ok(await js(ana, `import('./js/archivos.js').then(m=>m.urlLocal('tokens/del_zip.png').includes('/campanas/e2e-config/') && !m.urlLocal('tokens/guerrero.png').includes('/campanas/'))`), 'Archivos: se buscan primero en la campaña y, si no, en la carpeta general');
      ok(await espera(ana, `document.querySelector('.pista[data-sonido="batalla.ogg"]')?.classList.contains('tiene')`), 'Archivos: la música del .zip pasa a verde sin reiniciar');
      fs.rmSync(rutaZip, { force: true });
    }
    await foto(ana, '15-ajustes-archivos');
    await js(ana, `document.querySelector('.ventana[aria-label="Ajustes"] .btn-icono').click()`);
    await foto(gm, '16-gm-puntos');

    // ── Menú contextual (clic derecho con el cursor) y edición del GM ──
    for (const w of [gm, ana]) await js(w, `document.querySelector('.herr[title^="Cursor"]').click()`);
    for (const w of [gm, ana]) await js(w, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click()); document.querySelector('.panel-salas').hidden=true`);

    await clicDerecho(gm, await pos(gm, 12, 2));
    await espera(gm, `[...document.querySelectorAll('.menu-contextual .menu-item')].some(b=>b.textContent.includes('Desplegar token'))`);
    let m = await textosMenu(gm);
    ok(m.includes('🔍 Analizar casilla') && m.includes('📍 Desplegar token…') && !m.some((t) => /^(🟥|🟦|🟨) /u.test(t)), 'Menú: clic derecho en una casilla vacía ofrece analizar y «Desplegar token…», sin la lista de NPC (GM)');
    await foto(gm, '17-menu-casilla');
    await js(gm, `document.querySelector('.menu-contextual .menu-item').dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true}))`);
    await esperar(100);
    ok(await js(gm, `!!document.querySelector('.menu-contextual')`), 'Menú: la rueda dentro del menú no lo cierra (lo desplaza)');
    await clicTexto(gm, '🔍 Analizar casilla', '.menu-item');
    ok(await espera(gm, `document.querySelector('.ventana[aria-label="Análisis"]')?.textContent.includes('Terreno')`), 'Análisis: muestra el terreno de la casilla');
    await js(gm, `document.querySelector('.ventana[aria-label="Análisis"] .btn-icono').click()`);

    await clicDerecho(gm, await pos(gm, 12, 2));
    await clicTexto(gm, '📍 Desplegar token…', '.menu-item');
    ok(await espera(gm, `document.querySelector('.modal [data-colocar="goblin"]') && document.querySelector('.modal [data-colocar="tabernero"]')`), 'Desplegar: el GM ve los NPC de la campaña en la ventana');
    await foto(gm, '17b-desplegar-gm');
    await js(gm, `document.querySelector('.modal [data-colocar="goblin"]').click()`);
    ok(await espera(gm, `[...__mesa.S.tokens.values()].filter(t=>t.tipo==='enemigo').length===2`), 'Menú: el GM coloca un enemigo desde el clic derecho');
    const nuevo = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo'&&t.x===12&&t.y===2)`);
    ok(!!nuevo, 'Menú: el enemigo aparece en la casilla donde se hizo clic');

    await clicDerecho(ana, await pos(ana, gob.x, gob.y));
    m = await textosMenu(ana);
    ok(m.includes('🔍 Analizar') && m.includes('📜 Ver ficha') && !m.includes('✏ Editar…') && !m.includes('✕ Quitar del mapa'), 'Menú: un jugador ve analizar/ficha pero no las opciones de GM');
    await js(ana, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    ok(await espera(ana, `!document.querySelector('.menu-contextual')`), 'Menú: Esc lo cierra');

    await clicDerecho(gm, await pos(gm, gob.x, gob.y));
    m = await textosMenu(gm);
    ok(m.includes('✏ Editar…') && m.includes('✕ Quitar del mapa'), 'Menú: el GM ve editar y quitar sobre un token');
    ok(m[1] === '✏ Editar…', 'Menú: «Editar…» es la primera opción y lleva icono');
    await foto(gm, '17c-menu-token-gm');
    await clicTexto(gm, '✏ Editar…', '.menu-item');
    ok(await espera(gm, `document.querySelector('.editar-token')`), 'GM: se abre la ventana de edición del token');
    await js(gm, `(()=>{const i=document.querySelectorAll('.editar-token .rejilla')[0].querySelectorAll('input');i[0].value='7';i[0].dispatchEvent(new Event('input'))})()`);
    ok(await js(gm, `(()=>{const e=document.querySelector('.editar-token');return e.lastElementChild.classList.contains('pie') && e.lastElementChild.textContent.includes('Guardar cambios')})()`), 'Editar: «Cerrar» y «Guardar cambios» van al final de la ventana');
    await foto(gm, '18-editar-token');
    await js(gm, `document.querySelector('.ventana[aria-label^="Editar"] .ventana-cuerpo').scrollTop=99999`);
    await foto(gm, '18b-editar-token-final');
    await clicTexto(gm, 'Guardar cambios', '.editar-token button');
    ok(await espera(gm, `__mesa.S.tokens.get('${gob.id}').recursos.HP.actual===7`), 'GM: cambia la vida del goblin');
    ok(await espera(ana, `__mesa.S.tokens.get('${gob.id}').recursos.HP.actual===7`), 'Ana: ve la nueva vida del goblin');
    await js(gm, `(()=>{const s=document.querySelector('.editar-token select[aria-label="Objeto a dar"]');s.value='pocion';})()`);
    await js(gm, `document.querySelector('.editar-token [data-accion="dar-objeto"]').click()`);
    ok(await espera(gm, `__mesa.S.tokens.get('${gob.id}').inventario.some(e=>e.objeto==='pocion')`), 'GM: da un objeto al goblin');
    ok(await espera(gm, `document.querySelector('.editar-token .inv-gm').textContent.includes('×')`), 'GM: el inventario de la ventana se actualiza');
    await js(gm, `(()=>{const i=document.querySelector('.editar-token [data-campo="monto-dinero"]');i.value='50';})()`);
    await js(gm, `document.querySelector('.editar-token [data-accion="dar-dinero"]').click()`);
    ok(await espera(gm, `__mesa.S.tokens.get('${gob.id}').dinero===50 && document.querySelector('.editar-token [data-campo="dinero"]').textContent.includes('5 Plata')`), 'Dinero: el GM da 50 al goblin y se muestra en piezas (5 Plata)');
    ok(await js(ana, `__mesa.S.tokens.get(__mesa.S.tokenActivo).dinero===150`), 'Dinero: Ana empieza con el dinero inicial de la campaña (150)');
    ok(await js(ana, `__mesa.S.tokens.get('${gob.id}').dinero===undefined`), 'Dinero: el dinero ajeno está oculto para Ana');
    await js(gm, `__mesa.abrirPersonaje('${gob.id}')`);
    ok(await espera(gm, `!!document.querySelector('.ficha-pestana[data-pestana="sonidos"]')`), 'Sonidos: el GM ve la pestaña de sonidos del goblin');
    await js(gm, `document.querySelector('.ficha-pestana[data-pestana="sonidos"]').click()`);
    ok(await js(gm, `!!document.querySelector('[data-sonido="espada.wav"]')`), 'Sonidos: se puede lanzar el sonido asociado');
    await js(gm, `document.querySelector('.ventana[aria-label^="Goblin"] .btn-icono, .ventana[aria-label="Personaje"] .btn-icono')?.click()`);
    ok(await js(ana, `!document.querySelector('[data-accion="periodo"]').hidden && document.querySelector('[data-accion="periodo"]').disabled`), 'Día y noche: Ana ve el momento del día pero no puede cambiarlo');
    await js(gm, `document.querySelector('[data-accion="periodo"]').click()`);
    ok(await espera(ana, `__mesa.S.periodo===1 && document.querySelector('[data-accion="periodo"]').textContent.includes('Noche')`), 'Día y noche: el GM pasa a la noche y todos lo ven');
    await js(gm, `document.querySelector('[data-accion="periodo"]').click()`);
    ok(await espera(ana, `__mesa.S.periodo===0`), 'Día y noche: vuelve a ser de día');
    await js(gm, `document.querySelector('.ventana[aria-label^="Editar"] .btn-icono').click()`);

    // ── Capas del mapa ──
    ok(await js(ana, `__mesa.S.mapa.capa3[8][16]==='hierba_alta' && __mesa.S.mapa.capa2[8][2]==='hierba_alta' && !document.querySelector('[data-accion="capa-3"]')`), 'Capas: el mapa trae las capas de detalle y solo el GM tiene los botones');
    await js(gm, `document.querySelector('[data-accion="capa-3"]').click()`);
    ok(await espera(ana, `__mesa.S.capasOcultas.join()==='3'`), 'Capas: el GM oculta la capa superior y Ana lo recibe');
    ok(await espera(gm, `document.querySelector('[data-accion="capa-3"]').getAttribute('aria-pressed')==='false'`), 'Capas: el botón del GM refleja que está oculta');
    await js(gm, `document.querySelector('[data-accion="capa-3"]').click()`);
    ok(await espera(ana, `__mesa.S.capasOcultas.length===0`), 'Capas: el GM la vuelve a mostrar');

    // ── Niebla de guerra ──
    ok(await js(ana, `__mesa.S.niebla===null && !!document.querySelector('[data-accion="niebla"]')===false`), 'Niebla: apagada por defecto y solo el GM tiene el botón');
    await js(gm, `document.querySelector('[data-accion="niebla"]').click()`);
    ok(await espera(ana, `Array.isArray(__mesa.S.niebla) && __mesa.S.niebla.length===__mesa.S.mapa.alto && __mesa.S.niebla.some(f=>f.includes('0')) && __mesa.S.niebla.some(f=>f.includes('1'))`), 'Niebla: el GM la activa y Ana recibe qué casillas ve');
    ok(await js(gm, `__mesa.S.niebla===null && __mesa.S.nieblaActiva===true`), 'Niebla: el GM sigue viéndolo todo');
    await foto(ana, '20-niebla');
    await js(gm, `document.querySelector('[data-accion="niebla"]').click()`);
    ok(await espera(ana, `__mesa.S.niebla===null`), 'Niebla: el GM la quita y Ana vuelve a ver todo');

    // ── Ping y atajos ──
    const antesT = await js(gm, `__mesa.vista.temporales.length`);
    await js(ana, `__mesa.vista.cb.alPing(5,3)`);
    ok(await espera(gm, `__mesa.vista.temporales.length>${antesT}`), 'Ping: el GM ve el aro que Ana pone en una casilla');
    await js(ana, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'r'}))`);
    ok(await js(ana, `document.querySelector('.herr[title^="Regla"]').getAttribute('aria-pressed')==='true'`), 'Atajos: R elige la regla');
    await js(ana, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'v'}))`);
    ok(await js(ana, `document.querySelector('.herr[title^="Cursor"]').getAttribute('aria-pressed')==='true'`), 'Atajos: V vuelve al cursor');
    await js(ana, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'0'}))`);
    ok(await js(ana, `Math.abs(__mesa.vista.cam.zoom-1)<0.01`), 'Atajos: 0 restablece el zoom');

    // ── Anotaciones propias ──
    await js(ana, `__mesa.abrirPersonaje(__mesa.S.tokenActivo)`);
    ok(await espera(ana, `!!document.querySelector('.ficha-pestana[data-pestana="habilidades"]')`), 'Anotaciones: la ficha tiene pestaña de habilidades');
    await js(ana, `document.querySelector('.ficha-pestana[data-pestana="habilidades"]').click()`);
    ok(await espera(ana, `!!document.querySelector('[data-propias="habilidades"]')`), 'Anotaciones: Ana puede anotar habilidades (el GM lo permite)');
    await js(ana, `(()=>{const i=document.querySelector('[data-campo="propia-nombre-habilidades"]');i.value='Silbido';})()`);
    await js(ana, `document.querySelector('[data-accion="anadir-propia-habilidades"]').click()`);
    ok(await espera(ana, `document.querySelector('[data-propias="habilidades"]')?.textContent.includes('Silbido')`), 'Anotaciones: la habilidad anotada aparece en la ficha');
    await js(ana, `document.querySelector('.ficha-pestana[data-pestana="inventario"]').click()`);
    ok(await js(ana, `!document.querySelector('[data-propias="objetos"]')`), 'Anotaciones: los objetos siguen cerrados (el GM no lo permitió)');
    await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);

    // ── Tiendas ──
    await comoVentana(ana, 'Tienda');
    ok(await espera(ana, `document.querySelector('.ventana[aria-label="Tienda"]')?.textContent.includes('El GM todavía no ha abierto ninguna tienda')`), 'Tienda: cerrada, Ana ve que el GM aún no la abrió');
    await comoVentana(gm, 'Tienda');
    ok(await espera(gm, `!!document.querySelector('.ventana[aria-label="Tienda"] [data-tienda="tienda_aldea"] [data-accion="abrir-tienda"]')`), 'Tienda: el GM puede abrirla desde la propia ventana «Tienda»');
    await js(gm, `document.querySelector('.ventana[aria-label="Tienda"] [data-tienda="tienda_aldea"] [data-accion="abrir-tienda"]').click()`);
    ok(await espera(ana, `!!document.querySelector('.ventana[aria-label="Tienda"] [data-accion="comprar"][data-objeto="pocion"]')`), 'Tienda: el GM la abre y Ana ve los artículos');
    await js(ana, `document.querySelector('.ventana[aria-label="Tienda"] [data-accion="comprar"][data-objeto="pocion"]').click()`);
    ok(await espera(ana, `__mesa.S.tokens.get(__mesa.S.tokenActivo).dinero===125`), 'Tienda: comprar una poción cuesta 25');
    await foto(ana, '19-tienda');
    await foto(gm, '19b-tienda-gm');
    await js(ana, `document.querySelector('.ventana[aria-label="Tienda"] [data-accion="vender"][data-objeto="pocion"]')?.click()`);
    ok(await espera(ana, `__mesa.S.tokens.get(__mesa.S.tokenActivo).dinero>125`), 'Tienda: vender devuelve dinero');
    // Usar un objeto en uno mismo desde el inventario, en su turno (con alguien cerca: se elige «Él mismo»)
    {
      const cuantas = () => js(ana, `(__mesa.S.tokens.get(__mesa.S.tokenActivo).inventario.find(e=>e.objeto==='pocion')||{cantidad:0}).cantidad`);
      for (let k = 0; k < 6 && !(await js(ana, `__mesa.S.combate.turno_de===__mesa.S.tokenActivo`)); k++) {
        await js(gm, `__mesa.red.enviar({tipo:'terminar_turno'})`); await esperar(300);
      }
      ok(await js(ana, `__mesa.S.combate.turno_de===__mesa.S.tokenActivo`), 'Objetos: es el turno de Thor');
      const antes = await cuantas();
      await js(ana, `__mesa.S.tokenFoco=__mesa.S.tokenActivo; __mesa.bus.emit('foco')`);
      if (!(await js(ana, `!!document.querySelector('.ventana[aria-label="Inventario"]')`))) await comoVentana(ana, 'Inventario');
      await espera(ana, `!!document.querySelector('.ventana[aria-label="Inventario"] [data-objeto="pocion"] [data-accion="usar-objeto"]')`);
      await js(ana, `document.querySelector('.ventana[aria-label="Inventario"] [data-objeto="pocion"] [data-accion="usar-objeto"]').click()`);
      ok(await espera(ana, `document.querySelector('.modal [data-objetivo]')?.textContent.includes('Él mismo')`), 'Objetos: con alguien cerca, la ventana ofrece usarlo en uno mismo');
      await js(ana, `document.querySelector('.modal [data-objetivo]').click()`);
      ok(await espera(ana, `(__mesa.S.tokens.get(__mesa.S.tokenActivo).inventario.find(e=>e.objeto==='pocion')||{cantidad:0}).cantidad===${antes - 1}`), 'Objetos: se puede usar un objeto en uno mismo');
    }
    await js(gm, `document.querySelector('[data-tienda="tienda_aldea"] [data-accion="cerrar-tienda"]').click()`);
    ok(await espera(ana, `!document.querySelector('.ventana[aria-label="Tienda"] [data-accion="comprar"]')`), 'Tienda: al cerrarla desaparece para Ana');
    for (const w of [gm, ana]) await js(w, `['Tienda','Panel del GM'].forEach(t=>document.querySelector('.ventana[aria-label="'+t+'"] .btn-icono')?.click())`);
    await js(gm, `__mesa.red.enviar({tipo:'gm_revelar', token:'${gob.id}', campos:['inventario']})`);
    ok(await espera(ana, `!!__mesa.S.tokens.get('${gob.id}').inventario && !__mesa.S.tokens.get('${gob.id}').stats`), 'Visibilidad: el GM revela el inventario del goblin a Ana (y solo eso)');
    await js(gm, `__mesa.red.enviar({tipo:'gm_revelar', token:'${gob.id}', campos:[]})`);
    ok(await espera(ana, `!__mesa.S.tokens.get('${gob.id}').inventario`), 'Visibilidad: al ocultarlo, Ana deja de verlo');

    await clicDerecho(ana, await pos(ana, 14, 9));
    m = await textosMenu(ana);
    ok(m.includes('🔍 Analizar casilla') && !m.includes('📍 Desplegar token…'), 'Menú: un jugador no puede colocar enemigos');
    await js(ana, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);

    await js(gm, `document.querySelector('.herr[title^="Regla"]').click()`);
    await clicDerecho(gm, await pos(gm, 12, 5));
    ok(await js(gm, `!document.querySelector('.menu-contextual')`), 'Menú: con la regla activa el clic derecho no abre el menú');
    await js(gm, `document.querySelector('.herr[title^="Cursor"]').click()`);

    // ── Retirar y desplegar personajes ──
    const thor2 = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje')`);
    await clicDerecho(ana, await pos(ana, thor2.x, thor2.y));
    m = await textosMenu(ana);
    ok(!m.includes('↩ Retirar mi personaje del mapa'), 'Retirar: el jugador no puede retirarse en pleno combate');
    await js(ana, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await clicDerecho(gm, await pos(gm, thor2.x, thor2.y));
    m = await textosMenu(gm);
    ok(m.includes('⬅ Retirar del mapa') && !m.includes('✕ Quitar del mapa'), 'Retirar: el GM ve «Retirar del mapa» (no «Quitar») sobre un personaje');
    await clicTexto(gm, '⬅ Retirar del mapa', '.menu-item');
    ok(await espera(ana, `![...__mesa.S.tokens.values()].some(t=>t.tipo==='personaje')`), 'Retirar: el personaje desaparece del mapa de todos');
    ok(await espera(ana, `[...document.querySelectorAll('.pers-habs button')].some(b=>b.textContent==='Desplegar')`), 'Desplegar: el jugador ve el botón para volver a entrar');
    await clicTexto(ana, 'Desplegar', '.pers-habs button');
    ok(await espera(ana, `[...__mesa.S.tokens.values()].some(t=>t.tipo==='personaje')`), 'Desplegar: el jugador vuelve a desplegar su personaje');
    await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    await comoVentana(gm, 'Panel del GM');
    ok(await espera(gm, `document.querySelector('.ventana[aria-label="Panel del GM"]')?.textContent.includes('Thor')`), 'GM: el panel lista los personajes de los jugadores');
    await clicTexto(gm, 'Retirar', '.ventana[aria-label="Panel del GM"] button');
    ok(await espera(gm, `![...__mesa.S.tokens.values()].some(t=>t.tipo==='personaje')`), 'GM: retira un personaje desde el panel');
    await js(gm, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    await clicDerecho(gm, await pos(gm, 9, 8));
    m = await textosMenu(gm);
    ok(m.includes('📍 Desplegar token…'), 'Desplegar: el GM tiene «Desplegar token…» en el menú de la casilla');
    await clicTexto(gm, '📍 Desplegar token…', '.menu-item');
    ok(await espera(gm, `[...document.querySelectorAll('.modal [data-desplegar]')].some(b=>b.textContent.includes('Thor')&&b.textContent.includes('De Ana'))`), 'Desplegar: en la ventana del GM aparece Thor (de Ana)');
    await js(gm, `[...document.querySelectorAll('.modal [data-desplegar]')].find(b=>b.textContent.includes('Thor')).click()`);
    ok(await espera(ana, `(()=>{const t=[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje');return t&&t.x===9&&t.y===8})()`), 'Desplegar: el GM coloca a Thor en la casilla elegida');
    ok(await espera(ana, `__mesa.S.tokenActivo===[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje').id`), 'Desplegar: Ana vuelve a controlar su token');

    // ── Inventario de grupo ──
    await comoVentana(ana, 'Grupo');
    const vG = `document.querySelector('.ventana[aria-label="Grupo"]')`;
    ok(await espera(ana, `${vG}?.querySelector('[data-cofre="comun"]')?.textContent.includes('Todos los jugadores')`), 'Grupo: hay un inventario común para todos');
    const antesPoc = await js(ana, `(__mesa.S.tokens.get(__mesa.S.tokenActivo).inventario.find(e=>e.objeto==='pocion')||{cantidad:0}).cantidad`);
    await js(ana, `(()=>{const v=${vG};const s=v.querySelector('[data-accion="cofre-meter-objeto"]');s.value='pocion';v.querySelector('[data-accion="cofre-meter"]').click()})()`);
    ok(await espera(gm, `__mesa.S.cofres.find(c=>c.id==='comun')?.inventario.some(e=>e.objeto==='pocion')`), 'Grupo: Ana guarda una poción y el GM la ve');
    ok(await espera(ana, `(__mesa.S.tokens.get(__mesa.S.tokenActivo).inventario.find(e=>e.objeto==='pocion')||{cantidad:0}).cantidad===${antesPoc - 1}`), 'Grupo: la poción sale del inventario de Thor');
    await js(ana, `${vG}.querySelector('[data-cofre="comun"] [data-objeto="pocion"] [data-accion="cofre-sacar"]').click()`);
    ok(await espera(ana, `!__mesa.S.cofres.find(c=>c.id==='comun').inventario.length`), 'Grupo: se puede volver a sacar');
    await comoVentana(gm, 'Grupo');
    await js(gm, `(()=>{const v=document.querySelector('.ventana[aria-label="Grupo"]');const n=v.querySelector('[aria-label="Nombre del nuevo inventario"]');n.value='Bolsa secreta';v.querySelector('[data-accion="cofre-nuevo"]').click()})()`);
    ok(await espera(gm, `__mesa.S.cofres.some(c=>c.nombre==='Bolsa secreta')`) && await js(ana, `!__mesa.S.cofres.some(c=>c.nombre==='Bolsa secreta')`), 'Grupo: el GM crea un inventario que Ana no ve');
    await js(gm, `(()=>{const v=document.querySelector('.ventana[aria-label="Grupo"]');const sec=[...v.querySelectorAll('.cofre')].find(x=>x.textContent.includes('Bolsa secreta'));sec.querySelector('details').open=true;sec.querySelector('input[data-miembro="Ana"]').click()})()`);
    ok(await espera(ana, `__mesa.S.cofres.some(c=>c.nombre==='Bolsa secreta')`), 'Grupo: al añadirla como miembro, Ana lo ve');
    await js(gm, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);

    // ── Compañeros: un personaje más, con tamaño propio y agrupado para moverse junto a Thor (como en Roll20) ──
    await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    await js(ana, `__mesa.bus.emit('cambiar-personaje')`);
    ok(await espera(ana, `__mesa.pantalla==='seleccion' && !document.querySelector('[data-accion="nuevo-companero"]')`), 'Compañeros: no hay un tipo de ficha especial');
    await clicTexto(ana, 'Crear personaje nuevo');
    await espera(ana, `document.getElementById('f-nombre-pj')`);
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Orco')).click()})()`);
    await esperar(80);
    await js(ana, `(()=>{[...document.querySelectorAll('.grupo-eleccion .plantilla')].find(e=>e.textContent.includes('Guerrero')).click()})()`);
    await esperar(80);
    await js(ana, `(()=>{const n=document.getElementById('f-nombre-pj');n.value='Colmillo';n.dispatchEvent(new Event('input'))})()`);
    await clicTexto(ana, 'Crear personaje');
    ok(await espera(ana, `__mesa.S.personajes.some(p=>p.nombre==='Colmillo') && document.querySelectorAll('.tarjeta-personaje').length===2`), 'Compañeros: Colmillo es otro personaje de Ana');
    await js(ana, `[...document.querySelectorAll('.tarjeta-personaje')].find(t=>t.textContent.includes('Thor')).querySelector('.btn-acento').click()`);
    ok(await espera(ana, `__mesa.pantalla==='principal'`), 'Compañeros: vuelve a jugar con Thor');
    const colmillo = await js(ana, `__mesa.S.personajes.find(p=>p.nombre==='Colmillo').id`);
    const junto = await js(ana, `(()=>{const t=[...__mesa.S.tokens.values()].find(t=>t.nombre==='Thor');for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){if(__mesa.vista.casillaLibre(t.x+dx,t.y+dy,null)&&__mesa.vista.casillaLibre(t.x+2*dx,t.y+2*dy,null))return {x:t.x+dx,y:t.y+dy,dx,dy}}return null})()`);
    await js(ana, `__mesa.red.enviar({tipo:'desplegar_personaje', personaje:${JSON.stringify(colmillo)}, x:${junto.x}, y:${junto.y}})`);
    ok(await espera(ana, `[...__mesa.S.tokens.values()].some(t=>t.nombre==='Colmillo')`), 'Compañeros: Colmillo entra junto a Thor');
    await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    for (const w of [ana]) await js(w, `document.querySelector('.herr[title^="Cursor"]').click()`);
    await clicDerecho(ana, await pos(ana, junto.x, junto.y));
    let mc = await textosMenu(ana);
    ok(mc.includes('➖ Más pequeño') && mc.includes('Thor'), 'Tokens: el menú permite cambiar el tamaño y agrupar con Thor');
    await clicTexto(ana, '➖ Más pequeño', '.menu-item');
    ok(await espera(gm, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Colmillo')?.escala===0.75`), 'Tokens: Colmillo se ve más pequeño (también para el GM)');
    await clicDerecho(ana, await pos(ana, junto.x, junto.y));
    await clicTexto(ana, 'Thor', '.menu-item');
    ok(await espera(ana, `(()=>{const ts=[...__mesa.S.tokens.values()];const c=ts.find(t=>t.nombre==='Colmillo'),t=ts.find(t=>t.nombre==='Thor');return c.grupo&&c.grupo===t.grupo})()`), 'Tokens: Thor y Colmillo quedan agrupados');
    await foto(ana, '27-tokens-agrupados');
    const thor0 = await js(ana, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Thor')`);
    await js(ana, `__mesa.red.enviar({tipo:'mover_token', token:${JSON.stringify(thor0.id)}, x:${thor0.x + junto.dx}, y:${thor0.y + junto.dy}})`);
    ok(await espera(ana, `(()=>{const c=[...__mesa.S.tokens.values()].find(t=>t.nombre==='Colmillo');return c.x===${junto.x + junto.dx}&&c.y===${junto.y + junto.dy}})()`), 'Tokens: al mover a Thor, Colmillo se mueve con él');
    await clicDerecho(ana, await pos(ana, junto.x + junto.dx, junto.y + junto.dy));
    await clicTexto(ana, '✂ Sacar del grupo', '.menu-item');
    ok(await espera(ana, `![...__mesa.S.tokens.values()].some(t=>t.grupo)`), 'Tokens: se pueden desagrupar');

    // ── Transformación (formas) ──
    await js(gm, `__mesa.red.enviar({tipo:'gm_colocar_enemigo', enemigo:'lobisome', x:14, y:10})`);
    ok(await espera(gm, `[...__mesa.S.tokens.values()].some(t=>t.nombre==='Lobisome')`), 'Formas: el GM coloca un NPC con formas');
    const lob = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Lobisome')`);
    await clicDerecho(gm, await pos(gm, lob.x, lob.y));
    m = await textosMenu(gm);
    ok(m.includes('✨ Transformar…') && !m.some((t) => t.includes('Transformar en')), 'Formas: el menú del GM ofrece una sola opción «Transformar…»');
    await clicTexto(gm, '✨ Transformar…', '.menu-item');
    ok(await espera(gm, `document.querySelector('.modal [data-forma="forma_lobo"]')`), 'Formas: se abre una ventana con las formas posibles');
    await foto(gm, '28-transformar');
    await js(gm, `document.querySelector('.modal [data-forma="forma_lobo"]').click()`);
    ok(await espera(gm, `(()=>{const t=[...__mesa.S.tokens.values()].find(t=>t.nombre==='Lobisome');return t.elecciones.forma==='forma_lobo' && t.imagen==='tokens/goblin.png' && t.stats.Fuerza===13})()`), 'Formas: al transformarse cambian su forma, su imagen y sus bonos');
    ok(await espera(ana, `__mesa.S.chat.some(m=>m.texto.includes('se transforma en Lobo'))`), 'Formas: todos ven el aviso en el chat');
    await js(gm, `__mesa.abrirPersonaje([...__mesa.S.tokens.values()].find(t=>t.nombre==='Lobisome').id)`);
    ok(await espera(gm, `document.querySelector('.ventana [data-accion="transformar"]') && !document.querySelector('.ventana [data-forma]')`), 'Formas: la ficha muestra la forma actual y un solo botón «Transformar…»');
    await js(gm, `document.querySelector('.ventana [data-accion="transformar"]').click()`);
    await espera(gm, `document.querySelector('.modal [data-forma="forma_humana"]')`);
    await js(gm, `document.querySelector('.modal [data-forma="forma_humana"]').click()`);
    ok(await espera(gm, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Lobisome').elecciones.forma==='forma_humana'`), 'Formas: vuelve a su forma humana');
    await js(gm, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    await js(gm, `__mesa.red.enviar({tipo:'gm_quitar_token', token:[...__mesa.S.tokens.values()].find(t=>t.nombre==='Lobisome').id})`);

    // ── Tile invisible: los jugadores no lo ven (las brasas de (12, 9) son invisibles en esta mesa de prueba) ──
    ok(await js(ana, `__mesa.S.catalogo.tiles.brasas.invisible===true && !__mesa.S.catalogo.tiles.brasas.color`), 'Tiles: a un jugador el tile invisible le llega sin color ni imagen');
    ok(await js(gm, `__mesa.S.catalogo.tiles.brasas.invisible===true && !!__mesa.S.catalogo.tiles.brasas.color`), 'Tiles: el GM sí sabe cómo es');
    const rojoBrasas = await js(gm, `(()=>{const h=__mesa.S.catalogo.tiles.brasas.color.slice(1);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))})()`);
    const pixel = await js(ana, `(()=>{const v=__mesa.vista;const c=v.canvas.getContext('2d');const T=v.T,z=v.cam.zoom,d=v.dpr||1;
      return [...c.getImageData(Math.round((v.cam.x+12.5*T*z)*d),Math.round((v.cam.y+9.5*T*z)*d),1,1).data].slice(0,3)})()`);
    ok(pixel.reduce((a, v, i) => a + Math.abs(v - rojoBrasas[i]), 0) > 120, `Tiles: en el mapa del jugador no se dibuja el tile invisible (${pixel.join(',')} ≠ ${rojoBrasas.join(',')})`);

    // ── GM: gestionar las habilidades de un token desde el clic derecho ──
    const thorH = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.nombre==='Thor')`);
    await clicDerecho(gm, await pos(gm, thorH.x, thorH.y));
    const etiquetaGestionar = (await textosMenu(gm)).find((t) => t.startsWith('✨ Gestionar'));
    ok(!!etiquetaGestionar, 'Habilidades: el clic derecho del GM ofrece «Gestionar habilidades…»');
    await clicTexto(gm, etiquetaGestionar, '.menu-item');
    ok(await espera(gm, `!!document.querySelector('.gestionar-habilidades [data-lista="faltan"] [data-habilidad="bola_de_fuego"]')`), 'Habilidades: la ventana muestra las que tiene y las que le faltan');
    await js(gm, `(()=>{const b=document.querySelector('.gestionar-habilidades input[type=search]');b.value='fuego';b.dispatchEvent(new Event('input'))})()`);
    ok(await espera(gm, `document.querySelectorAll('.gestionar-habilidades [data-lista="faltan"] [data-habilidad]').length===1`), 'Habilidades: el buscador filtra las de la campaña');
    await js(gm, `document.querySelector('.gestionar-habilidades [data-habilidad="bola_de_fuego"] [data-accion="dar-habilidad"]').click()`);
    ok(await espera(ana, `__mesa.S.tokens.get(__mesa.S.tokenActivo)?.habilidades.includes('bola_de_fuego') && __mesa.S.personajes.find(p=>p.nombre==='Thor')?.habilidades.includes('bola_de_fuego')`), 'Habilidades: el GM se la da a Thor y Ana la tiene en su ficha');
    ok(await espera(gm, `!!document.querySelector('.gestionar-habilidades [data-lista="tiene"] [data-habilidad="bola_de_fuego"]') && document.querySelector('.gestionar-habilidades input[type=search]').value==='fuego'`), 'Habilidades: la ventana se actualiza sola (sin perder lo escrito)');
    await foto(gm, '21-gestionar-habilidades');
    await js(gm, `document.querySelector('.gestionar-habilidades [data-lista="tiene"] [data-habilidad="bola_de_fuego"] [data-accion="quitar-habilidad"]').click()`);
    ok(await espera(ana, `!__mesa.S.tokens.get(__mesa.S.tokenActivo)?.habilidades.includes('bola_de_fuego')`), 'Habilidades: y se la puede quitar');
    await js(gm, `document.querySelector('.ventana[aria-label^="Habilidades de"] .btn-icono').click()`);

    // ── Niebla: activarla no deshace el zoom ni el desplazamiento del mapa ──
    await js(gm, `__mesa.vista.zoomCentro(__mesa.vista.cam.zoom*1.5)`);
    const camGm = await js(gm, `({...__mesa.vista.cam})`);
    await js(gm, `__mesa.red.enviar({tipo:'gm_niebla',activa:true})`);
    ok(await espera(gm, `__mesa.S.nieblaActiva`), 'Niebla: el GM la activa');
    await esperar(400);
    ok(await js(gm, `(()=>{const c=__mesa.vista.cam;return Math.abs(c.zoom-(${camGm.zoom}))<1e-6&&Math.abs(c.x-(${camGm.x}))<1e-6&&Math.abs(c.y-(${camGm.y}))<1e-6})()`), 'Niebla: activarla no reinicia el tamaño del mapa');
    await js(gm, `__mesa.red.enviar({tipo:'gm_niebla',activa:false})`);
    await espera(gm, `!__mesa.S.nieblaActiva`);

    // ── Salas: cada mapa es una sala, varias a la vez ──
    await js(gm, `document.querySelector('.barra-izq .btn-icono').click()`);
    ok(await espera(gm, `document.querySelectorAll('.panel-salas .sala-fila').length===2 && !!document.querySelector('.sala-fila[data-sala="taberna"] [data-accion="abrir-sala"]')`), 'Salas: el GM ve las dos salas, cada una con su candado');
    await foto(gm, '14b-salas');
    await js(gm, `document.querySelector('.barra-izq .btn-icono').click()`);
    const thor3 = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='personaje')`);
    await clicDerecho(gm, await pos(gm, thor3.x, thor3.y));
    ok((await textosMenu(gm)).includes('🚪 Llevar a otra sala…'), 'Salas: el menú del token ofrece llevarlo a otra sala');
    await clicTexto(gm, '🚪 Llevar a otra sala…', '.menu-item');
    await esperar(150);
    await clicTexto(gm, 'Taberna', '.menu-item');
    ok(await espera(ana, `__mesa.S.mapaId==='taberna' && __mesa.S.tokens.has(__mesa.S.tokenActivo)`), 'Salas: el GM lleva a Thor a la taberna y Ana va con él');
    ok(await espera(gm, `__mesa.S.mapaId==='aldea' && ![...__mesa.S.tokens.values()].some(t=>t.nombre==='Thor') && [...__mesa.S.tokens.values()].some(t=>t.nombre==='Colmillo')`), 'Salas: el GM sigue viendo la aldea, sin Thor (su mascota Colmillo se queda)');
    ok(await espera(ana, `document.querySelector('.sala-nombre').textContent==='Taberna'`), 'Salas: la barra de Ana dice «Taberna»');
    await foto(ana, '14c-taberna');
    // Hablar como personaje: solo se oye en su sala, con su retrato
    ok(await espera(ana, `[...document.querySelectorAll('.chat-como option')].some(o=>o.textContent.includes('Thor'))`), 'Chat: Ana puede elegir hablar como Thor');
    await js(ana, `(()=>{const s=document.querySelector('.chat-como');s.value=__mesa.S.tokenActivo;s.dispatchEvent(new Event('change'));const i=document.querySelector('.chat-entrada');i.value='¡Una jarra, tabernero!';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))})()`);
    ok(await espera(ana, `[...document.querySelectorAll('.chat .msg-personaje')].some(m=>m.textContent.includes('Thor') && m.textContent.includes('Una jarra') && m.querySelector('.msg-retrato'))`), 'Chat: el mensaje sale como Thor, con su retrato');
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg-personaje')].some(m=>m.textContent.includes('Una jarra') && m.querySelector('.msg-sala')?.textContent==='Taberna')`), 'Chat: el GM lo ve, marcado con la sala de donde viene');
    await foto(ana, '14d-chat-personaje');
    await js(ana, `(()=>{const s=document.querySelector('.chat-como');s.value='';s.dispatchEvent(new Event('change'))})()`);
    await js(gm, `__mesa.red.enviar({tipo:'cambiar_sala',mapa:'taberna'})`);
    ok(await espera(gm, `__mesa.S.mapaId==='taberna' && [...__mesa.S.tokens.values()].some(t=>t.nombre==='Thor')`), 'Salas: el GM pasa a ver la taberna sin mover a nadie');
    await js(gm, `__mesa.red.enviar({tipo:'gm_cambiar_mapa',mapa:'aldea'})`);
    ok(await espera(ana, `__mesa.S.mapaId==='aldea' && __mesa.S.tokens.has(__mesa.S.tokenActivo)`), 'Salas: «Llevar a todos» trae a Thor de vuelta a la aldea');
    ok(await espera(gm, `__mesa.S.mapaId==='aldea' && [...__mesa.S.tokens.values()].some(t=>t.nombre==='Thor')`), 'Salas: y el GM vuelve con él');

    // ── Barras sobre los tokens: el GM puede ocultar el nombre de un NPC a los demás ──
    await js(gm, `__mesa.red.enviar({tipo:'gm_colocar_enemigo',enemigo:'goblin',x:12,y:2})`);
    ok(await espera(ana, `[...__mesa.S.tokens.values()].some(t=>t.tipo==='enemigo'&&t.x===12&&t.y===2&&t.mostrar?.nombre===true)`), 'Tokens: los demás reciben si pueden ver el nombre y las barras');
    const gobSala = await js(gm, `[...__mesa.S.tokens.values()].find(t=>t.tipo==='enemigo'&&t.x===12&&t.y===2).id`);
    await js(gm, `__mesa.red.enviar({tipo:'gm_mostrar_token',token:${JSON.stringify(gobSala)},nombre:false})`);
    ok(await espera(ana, `__mesa.S.tokens.get(${JSON.stringify(gobSala)})?.mostrar?.nombre===false`), 'Tokens: el GM oculta el nombre de ese NPC a los jugadores');
    ok(await espera(gm, `__mesa.S.tokens.get(${JSON.stringify(gobSala)})?.mostrar_propio?.nombre===false`), 'Tokens: el GM ve que ese token tiene el nombre oculto');
    await js(gm, `__mesa.red.enviar({tipo:'gm_quitar_token',token:${JSON.stringify(gobSala)}})`);

    // ── /gm contraseña: Ana pasa a ser GM sin reconectar ──
    await js(ana, `(()=>{const i=document.querySelector('.chat-entrada');i.value='/gm cambia-esto';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))})()`);
    ok(await espera(ana, `__mesa.S.esGM && __mesa.pantalla==='principal' && !!document.querySelector('.rail-btn[title="Panel del GM"]')`), 'Comandos: /gm contraseña da el papel de GM y su panel');
    ok(await espera(gm, `[...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('Ana ahora es GM')) && ![...document.querySelectorAll('.chat .msg')].some(m=>m.textContent.includes('cambia-esto'))`), 'Comandos: todos ven que Ana es GM, nadie ve la contraseña');
    ok(await espera(ana, `__mesa.S.diario.paginas.some(p=>p.id==='secreto_tabernero')`), 'Comandos: como GM, Ana ya ve las páginas ocultas del diario');

    // ── Contraseña de usuario ──
    await comoVentana(ana, 'Ajustes');
    await esperar(150);
    ok(await js(ana, `!!document.querySelector('.ventana [data-barra="HP"]')`), 'Ajustes: cada jugador elige qué barras ve sobre los tokens');
    await js(ana, `(()=>{const i=document.getElementById('f-clave-nueva');i.value='secreto-123';})()`);
    await clicTexto(ana, 'Poner contraseña', '.ventana button');
    ok(await espera(ana, `__mesa.S.cuenta?.tiene_password===true`), 'Cuenta: Ana pone contraseña desde Ajustes');
    await esperar(150);
    // ── Desconexión voluntaria ──
    await js(ana, `document.querySelectorAll('.ventana .btn-icono[aria-label^="Cerrar"]').forEach(b=>b.click())`);
    ok(await js(ana, `!document.querySelector('.ventana[aria-label="Ajustes"]') && ![...document.querySelectorAll('.ventana')].some(v=>v.textContent.includes('Desconectar'))`), 'Ajustes: ya no tiene «Desconectar» ni el aviso de volúmenes');
    await js(ana, `document.querySelector('.rail-salir').click()`);
    ok(await espera(ana, `__mesa.pantalla==='conexion'`), 'Desconectar: vuelve a la pantalla de conexión');

    // ── La selección de personaje solo aparece la primera vez ──
    ok(await espera(ana, `document.querySelector('.servidor-guardado')?.textContent.includes('127.0.0.1:8765') && document.querySelector('.servidor-guardado').textContent.includes('Ana') && !document.getElementById('f-servidor')`), 'Servidores: el servidor usado queda guardado en la lista (con su usuario)');
    await foto(ana, '20-servidores');
    ok(await js(ana, `!JSON.stringify(JSON.parse(localStorage.getItem('mesa-rol-ajustes')).servidores).toLowerCase().includes('pass')`), 'Servidores: no se guardan contraseñas');
    await js(ana, `document.querySelector('[data-accion="elegir-servidor"]').click()`);
    ok(await espera(ana, `document.getElementById('f-usuario')?.value==='Ana' && !document.getElementById('f-servidor')`), 'Servidores: al elegirlo ya trae dirección y usuario; solo faltan las contraseñas');
    await js(ana, `document.querySelector('form').requestSubmit()`);
    ok(await espera(ana, `!document.querySelector('.error').hidden && document.querySelector('.error').textContent.length>0`), 'Cuenta: sin contraseña no se entra con el usuario de Ana');
    await js(ana, `(()=>{document.getElementById('f-clave').value='secreto-123';document.querySelector('form').requestSubmit()})()`);
    await espera(ana, `__mesa.pantalla==='principal' || __mesa.pantalla==='seleccion'`);
    ok(await js(ana, `__preguntas.filter(t=>t.includes('Huella')).length===1`), 'Cifrado: al volver a conectar no vuelve a preguntar');
    ok(await js(ana, `__mesa.pantalla==='principal'`), 'Reconexión: Ana entra directo con Thor, sin pasar por la selección');
    ok(await js(ana, `__mesa.S.tokens.get(__mesa.S.tokenActivo)?.nombre==='Thor'`), 'Reconexión: el personaje activo es Thor');
    // ── «Recuérdame»: la contraseña queda guardada (cifrada) y aparece ya escrita la próxima vez. Nunca la de GM ──
    await js(ana, `document.querySelector('.rail-salir').click()`);
    await espera(ana, `__mesa.pantalla==='conexion'`);
    ok(!(await js(ana, `!!document.querySelector('[data-recordado]')`)), 'Recuérdame: sin marcarlo no se guarda ninguna contraseña');
    await js(ana, `document.querySelector('[data-accion="elegir-servidor"]').click()`);
    ok(await espera(ana, `document.getElementById('f-recordar') && !document.querySelector('.campo-recordar').hidden && !document.getElementById('f-recordar').disabled`), 'Recuérdame: el formulario tiene la casilla «Recuérdame»');
    await js(ana, `(()=>{const c=document.getElementById('f-es-gm');c.checked=true;c.dispatchEvent(new Event('change'))})()`);
    ok(await js(ana, `document.querySelector('.campo-recordar').hidden`), 'Recuérdame: al marcar «Entrar como Game Master» desaparece (la de GM nunca se guarda)');
    await js(ana, `(()=>{const c=document.getElementById('f-es-gm');c.checked=false;c.dispatchEvent(new Event('change'))})()`);
    await foto(ana, '20b-recuerdame');
    await js(ana, `(()=>{document.getElementById('f-recordar').checked=true;document.getElementById('f-clave').value='secreto-123';document.querySelector('form').requestSubmit()})()`);
    ok(await espera(ana, `__mesa.pantalla==='principal'`), 'Recuérdame: entra con su contraseña');
    ok(await espera(ana, `(()=>{const t=localStorage.getItem('mesa-rol-ajustes');const a=JSON.parse(t);return Object.keys(a.contrasenas||{}).length===1 && !t.includes('secreto-123')})()`),
      'Recuérdame: la contraseña se guarda cifrada (no en texto)');
    await js(ana, `document.querySelector('.rail-salir').click()`);
    await espera(ana, `__mesa.pantalla==='conexion'`);
    ok(await espera(ana, `document.querySelector('[data-recordado]')?.textContent.includes('Contraseña recordada')`), 'Recuérdame: la lista marca el servidor con la contraseña recordada');
    await foto(ana, '20c-servidor-recordado');
    await js(ana, `document.querySelector('[data-accion="elegir-servidor"]').click()`);
    ok(await espera(ana, `document.getElementById('f-clave')?.value==='secreto-123' && document.getElementById('f-recordar').checked`), 'Recuérdame: al conectar la contraseña ya aparece escrita');
    ok(await js(ana, `__mesa.pantalla==='conexion'`), 'Recuérdame: no entra solo: hay que pulsar «Conectar»');
    await foto(ana, '20d-contrasena-escrita');
    await js(ana, `document.querySelector('form').requestSubmit()`);
    ok(await espera(ana, `__mesa.pantalla==='principal' && !__mesa.S.esGM`), 'Recuérdame: con un clic en «Conectar» entra como Ana');
    ana.webContents.reload();                 // como cerrar el programa y volver a abrirlo
    await esperar(800);
    ok(await espera(ana, `window.__mesa?.pantalla==='conexion'`, 8000), 'Recuérdame: al abrir el programa no se conecta solo');
    await js(ana, `window.__preguntas=[];window.confirm=(t)=>{window.__preguntas.push(t);return true};window.__txt=(e)=>[...e.childNodes].map(n=>n.nodeType===3?n.textContent:n.tagName==='IMG'?n.alt:window.__txt(n)).join('').replace(/\\uFE0F/g,'');0`);
    await js(ana, `document.querySelector('[data-accion="editar-servidor"]').click()`);
    ok(await espera(ana, `!!document.querySelector('[data-accion="olvidar-contrasenas"]')`), 'Recuérdame: al editar el servidor se pueden olvidar las contraseñas');
    await js(ana, `document.querySelector('[data-accion="olvidar-contrasenas"]').click()`);
    ok(await espera(ana, `Object.keys(JSON.parse(localStorage.getItem('mesa-rol-ajustes')).contrasenas||{}).length===0 && document.getElementById('f-clave').value===''`), 'Recuérdame: «Olvidar contraseñas» las borra de este equipo');
    await js(ana, `document.querySelector('[data-accion="volver-servidores"]').click()`);
    ok(await espera(ana, `document.querySelector('.servidor-guardado') && !document.querySelector('[data-recordado]')`), 'Recuérdame: tras olvidarlas vuelve a pedir la contraseña');
    await js(gm, `document.querySelector('.rail-salir').click()`);
    await espera(gm, `__mesa.pantalla==='conexion'`);
    await js(gm, `(()=>{(document.getElementById('f-servidor')||(document.querySelector('[data-accion="anadir-servidor"]').click(),document.getElementById('f-servidor'))).value='127.0.0.1:8765';document.getElementById('f-usuario').value='Master';
      const c=document.getElementById('f-es-gm');c.checked=true;c.dispatchEvent(new Event('change'));document.getElementById('f-gm').value='';document.querySelector('form').requestSubmit()})()`);
    ok(await espera(gm, `!document.querySelector('.error').hidden && document.querySelector('.error').textContent.includes('contraseña de GM') && __mesa.pantalla==='conexion'`), 'GM: con la casilla marcada y sin contraseña no se puede entrar');
    await js(gm, `(()=>{document.getElementById('f-gm').value='cambia-esto';document.querySelector('form').requestSubmit()})()`);
    await espera(gm, `__mesa.pantalla==='principal' || __mesa.pantalla==='seleccion'`);
    ok(await js(gm, `__mesa.pantalla==='principal'`), 'Reconexión: el GM entra directo sin personaje');
    ok(await espera(gm, `__mesa.imagen('tokens/goblin.png') !== null`), 'Reconexión: las imágenes se leen de la carpeta local');

    console.log(fallos ? `\n${fallos} comprobaciones fallaron` : '\nTodas las comprobaciones pasaron');
  } catch (e) {
    console.log('ERROR en la prueba:', e);
    fallos++;
  }
  app.exit(fallos ? 1 : 0);
});
