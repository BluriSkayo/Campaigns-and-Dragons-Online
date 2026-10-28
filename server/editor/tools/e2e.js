// tools/e2e.js — Prueba de extremo a extremo del Editor (solo desarrollo). Usa una copia temporal de campañas (MESA_CAMPANAS).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const { registrar } = require('../api');
const SALIDA = process.env.SHOTS || '/tmp/shots-ed'; fs.mkdirSync(SALIDA, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0, total = 0;
const ok = (c, t) => { total++; console.log(`${c ? 'PASS' : 'FAIL'}  ${t}`); if (!c) fallos++; };
let w;
const js = (c) => w.webContents.executeJavaScript(c);
async function espera(expr, ms = 5000) { const fin = Date.now() + ms; while (Date.now() < fin) { if (await js(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return true; await esperar(80); } return false; }
async function foto(n) { await esperar(300); fs.writeFileSync(path.join(SALIDA, `${n}.png`), (await w.webContents.capturePage()).toPNG()); }
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const clickTexto = (sel, texto) => js(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.includes(${JSON.stringify(texto)})).click()`);
const escribir = (sel, v) => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);

async function principal() {
  w = new BrowserWindow({ width: 1400, height: 880, show: true, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true } });
  w.webContents.on('console-message', (_e, n, m) => { if (n >= 2) console.log('  [consola]', m); });
  w.webContents.on('render-process-gone', (_e, d) => console.log('  [caído]', d.reason));
  registrar(() => w);
  ipcMain.handle('ed:cerrarYa', () => {});
  await w.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { hash: 'debug' });
  const camp = process.env.MESA_CAMPANAS;
  // Imagen de fondo (4×2 px) para el mapa de ejemplo: la campaña la cita y está en la carpeta del cliente antigua (se migrará)
  fs.mkdirSync(path.join(process.env.MESA_CLIENTE, 'base', 'maps'), { recursive: true });
  fs.writeFileSync(path.join(process.env.MESA_CLIENTE, 'base', 'maps', 'fondo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGNocFCAIwZkDgBeGgcBzSxwNQAAAABJRU5ErkJggg==', 'base64'));
  fs.appendFileSync(path.join(camp, 'ejemplo', 'maps', 'aldea.yaml'), '\nfondo: maps/fondo.png\n');

  ok(await espera('document.querySelector(".pantalla-campanas [data-campana=ejemplo]")', 8000), 'Al arrancar muestra las campañas para elegir');
  ok(await js(`!!document.querySelector('.pantalla-campanas [data-accion="importar-campana"]')`), 'Al arrancar se ofrece importar una campaña desde un archivo');
  await js(`localStorage.removeItem('editor.avisosIntencionados.ejemplo')`);
  await click('.pantalla-campanas [data-campana=ejemplo]');
  ok(await espera('window.__ed && window.__ed.E.campana && window.__ed.E.campana.id==="ejemplo"', 8000), 'Elegir una campaña la abre');
  await esperar(1200); await foto('01-inicio');
  // Archivos por campaña: al abrir una campaña sin carpeta «base», se copia lo que usa desde la carpeta del cliente antigua
  const BASE = path.join(camp, 'ejemplo', 'base');
  ok(fs.existsSync(path.join(BASE, 'sonido', 'musica', 'taberna.wav')) && fs.existsSync(path.join(BASE, 'sonido', 'ambiente', 'lluvia.wav'))
    && !fs.existsSync(path.join(BASE, 'sonido', 'musica', 'extra.mp3')) && fs.existsSync(path.join(BASE, 'tokens')), 'Archivos: la campaña tiene su propia carpeta «base» (se copió solo lo que usa)');
  ok(await espera(`document.querySelector('.toast')?.textContent.includes('copié')`, 3000), 'Archivos: avisa de la copia');
  fs.copyFileSync(path.join(process.env.MESA_CLIENTE, 'base', 'sonido', 'musica', 'extra.mp3'), path.join(BASE, 'sonido', 'musica', 'extra.mp3'));
  await js(`window.__ed.recargarAssets && window.__ed.recargarAssets()`);
  ok(await js(`document.querySelectorAll('.explorador .cat-item').length > 8`), 'La barra izquierda muestra las categorías');
  ok(await js(`!document.querySelector('.explorador .fila-recurso') && !document.querySelector('.explorador').textContent.includes('Bola de Fuego')`), 'La barra izquierda no lista recursos, solo categorías');

  // Lista de una categoría en el centro
  await click('.explorador [data-vista="enemigos"]');
  ok(await espera(`document.querySelector('.lista-cat[data-lista="enemigos"] .fila-recurso[data-clave="enemigos/goblin"]')`), 'Lista: al pulsar «NPC» su lista se abre en el centro');
  ok(await js(`document.querySelector('.ficha .ficha-vacia') && document.querySelector('.fila-recurso[data-clave="enemigos/goblin"] .fila-resumen').textContent==='Enemigo'`), 'Lista: cada fila tiene un resumen y la ficha espera a que elijas uno');
  await click('.fila-recurso[data-clave="enemigos/goblin"] .fila-abrir');
  ok(await espera(`document.querySelector('.ficha .formulario [data-campo="bando"]') && document.querySelector('.lista-cat') && document.querySelector('.fila-recurso.activa')?.dataset.clave==='enemigos/goblin'`), 'Lista: abrir un NPC muestra su ficha al lado de la lista');
  await foto('01b-lista-npc');
  // Una imagen enorme no debe salirse de su recuadro de vista previa
  await js(`(()=>{const m=document.querySelector('.ficha .miniatura');const c=document.createElement('canvas');c.width=3000;c.height=2000;const i=document.createElement('img');i.src=c.toDataURL();m.replaceChildren(i);})()`);
  await esperar(300);
  ok(await js(`(()=>{const m=document.querySelector('.ficha .miniatura').getBoundingClientRect();const i=document.querySelector('.ficha .miniatura img').getBoundingClientRect();return m.width<=100&&i.width<=m.width&&i.height<=m.height})()`), 'Imagen: una imagen enorme se ajusta a su recuadro de vista previa');
  const nNpc = await js(`Object.keys(window.__ed.E.campana.recursos.enemigos).length`);
  await click('[data-accion="nuevo-en-lista"]');
  ok(await espera(`Object.keys(window.__ed.E.campana.recursos.enemigos).length===${nNpc + 1} && document.querySelectorAll('.lista-cat .fila-recurso').length===${nNpc + 1}`), 'Lista: «＋» añade un NPC a la lista');
  const nuevoNpc = await js(`window.__ed.E.activa`);
  ok(/^enemigos\//.test(nuevoNpc) && await espera(`document.querySelector('.ficha .formulario')`), 'Lista: el NPC nuevo queda abierto para editarlo');
  await js(`document.querySelector('.fila-recurso[data-clave="${nuevoNpc}"] [data-accion="quitar"]').click()`);
  ok(await espera(`document.querySelector('.dialogo')?.textContent.includes('Eliminar')`), 'Lista: «✕» pide confirmación');
  await click('.dialogo .btn-peligro');
  ok(await espera(`Object.keys(window.__ed.E.campana.recursos.enemigos).length===${nNpc} && !document.querySelector('.fila-recurso[data-clave="${nuevoNpc}"]')`), 'Lista: «✕» quita el NPC de la lista');
  // Cambiar de ficha con cambios: pregunta
  await click('.fila-recurso[data-clave="enemigos/goblin"] .fila-abrir');
  await espera('document.querySelector(".ficha .formulario input[type=text]")');
  await escribir('.ficha .formulario input[type=text]', 'Goblin cambiado');
  ok(await espera(`document.querySelector('.fila-recurso[data-clave="enemigos/goblin"] .punto-sucio') && document.querySelector('.fila-recurso[data-clave="enemigos/goblin"] .fila-nombre').textContent==='Goblin cambiado'`), 'Lista: la fila muestra el nombre nuevo y el punto de cambios');
  await click('.fila-recurso[data-clave="enemigos/guardia"] .fila-abrir');
  ok(await espera(`document.querySelector('.dialogo')?.textContent.includes('cambios sin guardar')`), 'Lista: abrir otro con cambios sin guardar pregunta antes');
  await clickTexto('.dialogo button', 'No guardar');
  ok(await espera(`window.__ed.E.activa==='enemigos/guardia' && window.__ed.E.campana.recursos.enemigos.goblin.nombre!=='Goblin cambiado' && window.__ed.E.pestanas.length===1`), 'Lista: «No guardar» descarta y abre el otro');
  // Ancho de la lista
  await js(`document.querySelector('.divisor').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  const ancho0 = await js(`document.querySelector('.lista-cat').offsetWidth`);
  ok(ancho0 >= 300 && ancho0 <= 340, 'Lista: doble clic en el borde vuelve al ancho normal');
  await js(`(()=>{const d=document.querySelector('.divisor');const r=d.getBoundingClientRect();const o={bubbles:true,pointerId:1,clientX:r.left+2,clientY:r.top+50};d.dispatchEvent(new PointerEvent('pointerdown',o));d.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:r.left+152}));d.dispatchEvent(new PointerEvent('pointerup',o));})()`);
  ok(await espera(`document.querySelector('.lista-cat').offsetWidth > ${ancho0 + 100}`), 'Lista: arrastrar el borde agranda la lista');
  ok(await js(`localStorage.getItem('editor.anchoLista')`) > 400, 'Lista: el ancho elegido se recuerda');
  await js(`document.querySelector('.divisor').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  // Razas y clases: grupos con sus opciones dentro
  await click('.explorador [data-vista="grupos"]');
  ok(await espera(`document.querySelector('.lista-cat[data-lista="grupos"] .fila-recurso[data-clave^="grupos/"]') && document.querySelector('.lista-cat .fila-recurso.nivel-2[data-clave="opciones/berserker"]')`), 'Lista: Razas y clases muestra los grupos con sus opciones');
  await foto('01c-lista-grupos');
  // Buscador global
  await escribir('.explorador .buscador', 'goblin');
  ok(await espera(`document.querySelector('.explorador .resultado[data-clave="enemigos/goblin"]')`), 'Buscador: encuentra recursos de cualquier categoría');
  await click('.explorador .resultado[data-clave="enemigos/goblin"]');
  ok(await espera(`window.__ed.E.activa==='enemigos/goblin' && document.querySelector('.lista-cat[data-lista="enemigos"]')`), 'Buscador: abre el resultado en su lista');
  await escribir('.explorador .buscador', '');
  ok(await js(`window.__ed.E.problemas.estado`) === 'ok', 'La campaña de ejemplo valida sin errores: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));

  // Abrir un recurso desde el explorador
  const prim = await js(`(()=>{const l=Object.keys(window.__ed.E.campana.recursos.habilidades);return l[0]})()`);
  await js(`window.__ed.abrir('habilidades', ${JSON.stringify(prim)})`);
  ok(await espera('document.querySelector(".formulario .campo")'), 'Abre una habilidad con formulario');
  await foto('02-habilidad');

  // Editar → punto de cambios sin guardar → guardar
  ok(!(await js(`!document.querySelector('.sin-guardar').hidden`)), 'Sin cambios al abrir');
  await escribir('.formulario input[type=text]', 'Golpe de prueba');
  ok(await espera('!document.querySelector(".sin-guardar").hidden'), 'Editar muestra «Cambios sin guardar»');
  ok(await espera('document.querySelector(".fila-recurso.activa .punto-sucio")'), 'La fila de la lista muestra punto de cambios');
  await js(`document.querySelector('[data-accion="guardar-pestana"]').click()`);
  ok(await espera('document.querySelector(".sin-guardar").hidden'), 'Guardar quita el aviso');
  const yaml = fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', prim + '.yaml'), 'utf8');
  ok(yaml.includes('Golpe de prueba'), 'El archivo YAML se actualizó en disco');
  await foto('03-guardado');

  // Crear recursos nuevos
  const antes = await js(`Object.keys(window.__ed.E.campana.recursos.objetos).length`);
  await js(`window.__ed.nuevo('objetos')`);
  ok(await espera(`Object.keys(window.__ed.E.campana.recursos.objetos).length===${antes + 1}`), 'Crear objeto lo añade a la campaña');
  await foto('04-objeto-nuevo');
  ok(await espera('window.__ed.E.problemas.estado!=="validando"'), 'Validación termina');
  console.log('  estado tras crear objeto:', await js(`window.__ed.E.problemas.estado + ' ' + JSON.stringify(window.__ed.E.problemas.errores)`));

  // Reglas
  await js(`window.__ed.abrirReglas('estadisticas')`);
  ok(await espera('document.querySelector(".reglas")'), 'Abre Reglas del juego');
  await foto('05-reglas');
  await js(`window.__ed.abrirReglas('mesa')`);
  await espera(`document.querySelector('[data-campo="activo"]')`);
  ok(await js(`!document.querySelector('[data-campo="huecos"]')`), 'Equipamiento: apagado por defecto');
  await js(`[...document.querySelectorAll('[data-campo="activo"]')].find(c=>c.closest('.campo').textContent.includes('se equipan')).click()`);
  ok(await espera(`document.querySelector('[data-campo="huecos"]')`), 'Equipamiento: al activarlo pide máximo y huecos');
  await escribir('[data-campo="huecos"]', 'Cabeza, Pecho, Cabeza');
  ok(await js(`JSON.stringify(window.__ed.E.pestanas.find(t=>t.clave==='reglas').borrador.juego.equipamiento.huecos)==='["Cabeza","Pecho"]'`), 'Equipamiento: los huecos se guardan sin repetir');
  await js(`(()=>{const j=window.__ed.E.pestanas.find(t=>t.clave==='reglas').borrador.juego;j.equipamiento={activo:false,maximo:0,huecos:[]}})()`);
  await js(`window.__ed.abrirReglas('estadisticas')`); await esperar(300);
  ok(await js(`!document.querySelector('[data-col="categoria"]')`), 'Categorías de estadísticas: apagadas por defecto (una sola lista)');
  await js(`document.querySelector('[data-campo="categorias_estadisticas"]').click()`);
  ok(await espera(`document.querySelector('[data-col="categoria"]')`), 'Categorías de estadísticas: al activarlas, cada estadística elige su categoría');
  await escribir('[data-col="categoria"]', 'Combate');
  ok(await js(`(()=>{const j=window.__ed.E.pestanas.find(t=>t.clave==='reglas').borrador.juego;return j.categorias_estadisticas===true&&j.estadisticas[0].categoria==='Combate'})()`), 'Categorías de estadísticas: se guardan en las reglas');
  await js(`document.querySelector('[data-campo="categorias_estadisticas"]').click()`);
  await js(`delete window.__ed.E.pestanas.find(t=>t.clave==='reglas').borrador.juego.estadisticas[0].categoria`);

  // Mapa
  const mapa = await js(`Object.keys(window.__ed.E.campana.recursos.mapas)[0]`);
  await js(`window.__ed.abrir('mapas', ${JSON.stringify(mapa)})`);
  ok(await espera('document.querySelector(".mapa-lienzo")'), 'Abre el editor de mapas');
  ok(await js(`!document.querySelector('.lista-cat') && !!document.querySelector('[data-accion="volver-lista"]')`), 'Mapa: ocupa todo el centro, con botón para volver a la lista');
  await foto('06-mapa');


  // Deshacer / rehacer con el teclado
  const en = await js(`Object.keys(window.__ed.E.campana.recursos.enemigos)[0]`);
  await js(`window.__ed.abrir('enemigos', ${JSON.stringify(en)})`);
  await espera('document.querySelector(".formulario input[type=text]")');
  const nom0 = await js(`document.querySelector('.formulario input[type=text]').value`);
  await escribir('.formulario input[type=text]', 'Nombre cambiado');
  await esperar(600);
  const tecla = async (key, mods) => { for (const type of ['keyDown', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: key, modifiers: mods }); await esperar(200); };
  await tecla('Z', ['control']);
  ok(await espera(`document.querySelector('.formulario input[type=text]').value===${JSON.stringify(nom0)}`), 'Ctrl+Z deshace el cambio de nombre');
  await tecla('Y', ['control']);
  ok(await espera(`document.querySelector('.formulario input[type=text]').value==='Nombre cambiado'`), 'Ctrl+Y lo rehace');
  await tecla('Z', ['control']);
  await js(`document.querySelector('[data-accion="descartar"]').click()`);
  await tecla('F1', []);
  ok(await espera('document.querySelector(".lista-atajos")'), 'F1 muestra los atajos');
  await js(`document.querySelector('.dialogo-pie button').click()`);

  // Renombrar una estadística en Reglas propaga el cambio al guardar
  const nombreStat = await js(`window.__ed.E.campana.config.juego.estadisticas[0].nombre`);
  await js(`window.__ed.abrirReglas('estadisticas')`);
  await js(`(()=>{const p=window.__ed.E.pestanas.find(t=>t.clave==='reglas');p.borrador.juego.estadisticas[0].nombre='Vigor';window.__ed.E.pestanas;})()`);
  await js(`window.__ed.guardar('reglas').then(()=>0)`);
  await esperar(800);
  const cfg = fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8');
  ok(cfg.includes('Vigor'), 'Renombrar estadística guarda config (' + nombreStat + ' → Vigor)');
  ok(/Vigor: 14/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'options', 'berserker.yaml'), 'utf8')), 'El renombre se propaga a las estadísticas propias de una clase');
  ok(fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', 'ataque_basico.yaml'), 'utf8').includes('[a.Vigor]'), 'El renombre se propaga a las fórmulas');
  ok(fs.readFileSync(path.join(camp, 'ejemplo', 'options', 'orco.yaml'), 'utf8').includes('Vigor: 2'), 'El renombre se propaga a los bonos');
  await espera('window.__ed.E.problemas.estado!=="validando"');
  console.log('  estado tras renombrar:', await js(`window.__ed.E.problemas.estado + ' ' + JSON.stringify(window.__ed.E.problemas.errores)`));

  // Una referencia rota se detecta
  const ab = fs.readdirSync(path.join(camp, 'ejemplo', 'abilities'))[0];
  // Eliminar → papelera
  const ids = await js(`Object.keys(window.__ed.E.campana.recursos.objetos)`);
  await js(`window.__ed.eliminar('objetos', ${JSON.stringify(ids[ids.length - 1])}).then(()=>0)`);
  await esperar(600);
  ok(fs.existsSync(path.join(camp, 'ejemplo', '_papelera')), 'Eliminar mueve a _papelera');
  ok(!(await js(`window.__ed.E.campana.recursos.objetos[${JSON.stringify(ids[ids.length - 1])}]`)), 'El recurso eliminado ya no está en la campaña');
  const lista = await js(`window.editor.campanas()`);
  ok(!lista.some((c) => c.id.startsWith('_')), 'La papelera no aparece como campaña');
  await foto('07-final');

  // Editor de mapas: pintar con el ratón, rectángulo, borrador, deshacer, tile rápido
  await js(`window.__ed.abrir('mapas', ${JSON.stringify(mapa)})`);
  ok(await espera('document.querySelector(".mapa-lienzo") && document.querySelector("[data-tile=agua]")'), 'Mapa: se reabre con su paleta');
  const clic = (cx, cy, tipo = 'mousedown') => js(`(()=>{const c=document.querySelector('.mapa-lienzo');const r=c.getBoundingClientRect();const k=r.width/window.__ed.E.pestanas.find(t=>t.clave==='mapas/${mapa}').borrador.ancho;
    c.dispatchEvent(new MouseEvent('${tipo}',{bubbles:true,clientX:r.left+(${cx}+.5)*k,clientY:r.top+(${cy}+.5)*k,button:0}))})()`);
  const casillasDe = () => js(`JSON.stringify(window.__ed.E.pestanas.find(t=>t.clave==='mapas/${mapa}').borrador.casillas)`).then(JSON.parse);
  await js(`document.querySelector('[data-tile="agua"] .tile-elegir').click()`);
  await clic(1, 1); await clic(2, 1, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  let cas = await casillasDe();
  ok((cas.agua || []).some(([x, y]) => x === 1 && y === 1) && (cas.agua || []).some(([x, y]) => x === 2 && y === 1), 'Mapa: el pincel pinta casillas (arrastrando)');
  await esperar(500);
  const zoomAntes = await js(`(()=>{const z=document.querySelector('.mapa-zoom input');z.value=50;z.dispatchEvent(new Event('input'));return document.querySelector('.mapa-lienzo').width})()`);
  const lienzo = await js(`(window.__lienzo=document.querySelector('.mapa-lienzo'), 0)`);
  await tecla('Z', ['control']);
  cas = await casillasDe();
  ok(!(cas.agua || []).some(([x, y]) => x === 1 && y === 1), 'Mapa: Ctrl+Z deshace lo pintado');
  ok(await js(`window.__lienzo.isConnected && document.querySelector('.mapa-zoom input').value==='50' && document.querySelector('.mapa-lienzo').width===${zoomAntes}`) && lienzo === 0, 'Mapa: Ctrl+Z no reinicia el zoom ni el editor');
  ok(await js(`document.querySelector('[data-tile="agua"]').classList.contains('elegido') || !!document.querySelector('[data-tile="agua"][aria-pressed="true"], [data-tile="agua"] [aria-pressed="true"]')`), 'Mapa: Ctrl+Z mantiene el tile elegido');
  await tecla('Y', ['control']);
  await tecla('E', []);
  ok(await js(`document.querySelector('[data-herr="borrar"]').getAttribute('aria-pressed')==='true'`), 'Mapa: la tecla E elige el borrador');
  await clic(1, 1); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  cas = await casillasDe();
  ok(!(cas.agua || []).some(([x, y]) => x === 1 && y === 1) && (cas.agua || []).some(([x, y]) => x === 2 && y === 1), 'Mapa: el borrador quita solo esa casilla');
  const nTiles = await js(`Object.keys(window.__ed.E.campana.recursos.tiles).length`);
  const nuevoId = await js(`window.__ed.nuevo('tiles', { color: '#112233', transitable: false }, { nombre: 'Lava de prueba', abrir: false })`);
  ok(await espera(`Object.keys(window.__ed.E.campana.recursos.tiles).length===${nTiles + 1} && document.querySelector('[data-tile="${nuevoId}"]')`), 'Mapa: un tile nuevo aparece en la paleta sin cambiar de pestaña');
  ok(await js(`window.__ed.E.activa==='mapas/${mapa}'`), 'Mapa: sigues en el mapa tras crear el tile');
  // Capas: pintar en la capa 2 no toca la base
  const bordeador = () => js(`JSON.stringify(window.__ed.E.pestanas.find(t=>t.clave==='mapas/${mapa}').borrador)`).then(JSON.parse);
  await js(`document.querySelector('[data-capa="2"]').click()`);
  ok(await js(`document.querySelector('[data-capa="2"]').getAttribute('aria-pressed')==='true'`), 'Capas: se elige la capa 2');
  await js(`document.querySelector('[data-tile="agua"] .tile-elegir').click()`);
  await tecla('B', []);
  await clic(3, 3); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  let bm = await bordeador();
  ok((bm.capas?.detalle?.agua || []).some(([x, y]) => x === 3 && y === 3) && !(bm.casillas.agua || []).some(([x, y]) => x === 3 && y === 3), 'Capas: pintar en la capa 2 no cambia la capa base');
  await tecla('3', []);
  await clic(4, 3); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  bm = await bordeador();
  ok((bm.capas?.superior?.agua || []).some(([x, y]) => x === 4 && y === 3), 'Capas: la tecla 3 elige la capa superior y se pinta en ella');
  await tecla('1', []);
  // Objetos del mapa: elegir, cambiar el tamaño arrastrando una esquina, moverlo y ponerle imagen
  const clicF = (fx, fy, tipo) => js(`(()=>{const c=document.querySelector('.mapa-lienzo');const r=c.getBoundingClientRect();const k=r.width/window.__ed.E.pestanas.find(t=>t.clave==='mapas/${mapa}').borrador.ancho;
    c.dispatchEvent(new MouseEvent('${tipo}',{bubbles:true,clientX:r.left+${fx}*k,clientY:r.top+${fy}*k,button:0}))})()`);
  const objMapa = () => bordeador().then((b) => b.objetos.find((o) => o.nombre === 'Carro'));
  await js(`window.__ed.E.pestanas.find(t=>t.clave==='mapas/${mapa}').borrador.objetos.push({nombre:'Carro',x:5,y:5,bloquea:true})`);
  await tecla('O', []);
  ok(await js(`document.querySelector('[data-herr="objeto"]').getAttribute('aria-pressed')==='true' && !document.querySelector('[data-herr="mover"]')`), 'Objetos: la tecla O elige «Objeto» (ya no hay «Mover» aparte)');
  await clicF(5.5, 5.5, 'mousedown'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  ok(await espera(`document.querySelector('.objeto-elegido')?.textContent.includes('Carro') && document.querySelector('.objeto-elegido .campo-imagen')`), 'Objetos: al elegir uno se puede cambiar su nombre, su imagen y su tamaño');
  await clicF(6, 6, 'mousedown'); await clicF(7.5, 6.5, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  ok(await js(`!!document.querySelector('[data-vista="habilidades"]')?.title && !!document.querySelector('[data-vista="jugadores"]')?.title`), 'Barra izquierda: cada categoría explica para qué sirve al dejar el ratón encima');
  let carro = await objMapa();
  ok(carro.ancho === 2.5 && carro.alto === 1.5 && carro.x === 5 && carro.y === 5, 'Objetos: arrastrar una esquina cambia el tamaño (en cuartos de casilla)');
  await clicF(5.5, 5.5, 'mousedown'); await clicF(8.5, 6.5, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  carro = await objMapa();
  ok(carro.x === 8 && carro.y === 6 && carro.ancho === 2.5, 'Objetos: arrastrarlo lo mueve sin cambiar su tamaño');
  await clicF(8, 6, 'mousedown'); await clicF(9, 9, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  carro = await objMapa();
  ok(carro.x === 9 && carro.y === 7 && carro.ancho === 1.5 && carro.alto === 0.5, 'Objetos: la esquina de arriba a la izquierda mueve ese borde (sin pasarse del otro)');
  await js(`(()=>{const n=document.querySelector('.objeto-elegido [data-tam="ancho"]');n.value='3';n.dispatchEvent(new Event('change'))})()`);
  ok((await objMapa()).ancho === 3, 'Objetos: el tamaño también se escribe a mano');
  // «Nuevo objeto» pide también la imagen, el tamaño y si bloquea
  fs.mkdirSync(path.join(BASE, 'otros'), { recursive: true });
  fs.writeFileSync(path.join(BASE, 'otros', 'cofre.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await tecla('O', []);
  await clicF(1.5, 10.5, 'mousedown'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  ok(await espera(`document.querySelector('.dialogo .objeto-nuevo [data-accion="elegir-imagen"]')`), 'Objetos: «Nuevo objeto» permite elegir la imagen');
  await escribir('.dialogo .objeto-nuevo [data-campo="nombre"]', 'Cofre');
  await click('.dialogo .objeto-nuevo [data-accion="elegir-imagen"]');
  await espera(`document.querySelector('.galeria [data-archivo="otros/cofre.png"]')`);
  await click('.galeria [data-archivo="otros/cofre.png"]');
  ok(await espera(`!document.querySelector('.galeria') && document.querySelector('.dialogo .objeto-nuevo .imagen-nombre')?.textContent==='otros/cofre.png'`), 'Objetos: la imagen elegida se ve en la ventana');
  await js(`(()=>{const n=document.querySelector('.dialogo [data-tam-nuevo="ancho"]');n.value='2';n.dispatchEvent(new Event('change'))})()`);
  await clickTexto('.dialogo button', 'Poner objeto');
  const cofre = await bordeador().then((b) => b.objetos.find((o) => o.nombre === 'Cofre'));
  ok(cofre && cofre.imagen === 'otros/cofre.png' && cofre.ancho === 2 && cofre.bloquea === true && cofre.x === 1 && cofre.y === 10, 'Objetos: se crea con su imagen, tamaño y bloqueo');
  ok(await espera(`document.querySelector('.objeto-mini img')`), 'Objetos: la lista muestra la miniatura (y se puede cambiar desde ahí)');
  await foto('22-objeto-nuevo');
  // Imagen de fondo: moverla y estirarla arrastrando sus bordes (herramienta 🖼️ Imagen, tecla F)
  await tecla('F', []);
  ok(await espera(`document.querySelector('[data-herr="fondo"]').getAttribute('aria-pressed')==='true' && document.querySelector('[data-fondo="ancho"]')`), 'Fondo: la tecla F elige «Imagen» y el panel muestra su posición y tamaño');
  const anchoMapa = (await bordeador()).ancho, altoMapa = (await bordeador()).alto;
  await clicF(anchoMapa, altoMapa / 2, 'mousedown'); await clicF(anchoMapa - 4, altoMapa / 2, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  let fa = (await bordeador()).fondo_ajuste;
  ok(fa && Math.abs(fa.ancho - (anchoMapa - 4)) < 0.2 && fa.alto === altoMapa && fa.x === 0, 'Fondo: arrastrar el borde derecho estrecha la imagen (sin tocar el alto)');
  await clicF(fa.ancho, fa.alto, 'mousedown'); await clicF(fa.ancho + 2, fa.alto + 5, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  fa = (await bordeador()).fondo_ajuste;
  ok(Math.abs(fa.ancho / fa.alto - 2) < 0.02, 'Fondo: una esquina estira sin deformar (la imagen es el doble de ancha que alta)');
  await clicF(2, 2, 'mousedown'); await clicF(3, 3.5, 'mousemove'); await js(`window.dispatchEvent(new MouseEvent('mouseup'))`);
  const movido = (await bordeador()).fondo_ajuste;
  ok(Math.abs(movido.x - 1) < 0.05 && Math.abs(movido.y - 1.5) < 0.05 && movido.ancho === fa.ancho, 'Fondo: arrastrar por dentro la mueve');
  await js(`(()=>{const n=document.querySelector('[data-fondo="x"]');n.value='-0.5';n.dispatchEvent(new Event('change'))})()`);
  ok((await bordeador()).fondo_ajuste.x === -0.5, 'Fondo: también se escribe a mano (puede sobresalir del mapa)');
  await foto('06c-fondo');
  await click('[data-accion="fondo-encajar"]');
  ok(!(await bordeador()).fondo_ajuste, 'Fondo: «Encajar en el mapa» la vuelve a dejar justa');
  await click('[data-accion="fondo-real"]');
  ok((await bordeador()).fondo_ajuste?.ancho === 0.06, 'Fondo: «Tamaño real» usa los píxeles por casilla (4 px / 64)');
  await js(`(()=>{const n=document.querySelector('[data-fondo="ancho"]');n.value='10';n.dispatchEvent(new Event('change'))})()`);
  await tecla('B', []);
  await js(`document.querySelector('[data-accion="guardar-pestana"]').click()`);
  await esperar(600);
  ok(/fondo_ajuste:[\s\S]*ancho: 10[\s\S]*alto: 5/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'maps', mapa + '.yaml'), 'utf8')), 'Fondo: el ajuste se guarda en el mapa');
  ok(await espera(`window.__ed.E.problemas.estado==='ok'`, 8000), 'Fondo: el servidor acepta el ajuste');
  const yamlMapa = fs.readFileSync(path.join(camp, 'ejemplo', 'maps', mapa + '.yaml'), 'utf8');
  ok(/casillas:/.test(yamlMapa) && /agua:/.test(yamlMapa) && !/filas:/.test(yamlMapa), 'Mapa: se guarda con el formato de tiles');
  ok(/capas:/.test(yamlMapa) && /detalle:/.test(yamlMapa) && /superior:/.test(yamlMapa), 'Capas: se guardan en el YAML del mapa');
  ok(/nombre: Carro[\s\S]*ancho: 3[\s\S]*alto: 0\.5/.test(yamlMapa), 'Objetos: el tamaño se guarda en el YAML del mapa');
  await foto('06b-mapa-pintado');
  await js(`window.__ed.abrir('tiles', 'barricada')`);
  ok(await espera('document.querySelector(".formulario [data-campo=rompible]")'), 'Tile: el formulario muestra «Se puede romper»');
  await foto('06c-tile');
  await js(`window.__ed.abrir('tiles', 'valla')`);
  ok(await espera(`document.querySelector('.lados [data-lado="norte"]')?.getAttribute('aria-pressed')==='true' && document.querySelector('.lados [data-lado="sur"]').getAttribute('aria-pressed')==='false'`), 'Tile: la valla del ejemplo tiene cerrado el lado norte');
  await click('.lados [data-lado="este"]');
  ok(await espera(`JSON.stringify(window.__ed.E.pestanas.find(t=>t.clave==='tiles/valla').borrador.bloquea_lados)==='["norte","este"]'`), 'Tile: pulsar un lado lo cierra (y se guardan en orden)');
  await click('.lados [data-lado="este"]');
  await js(`window.__ed.abrir('tiles', 'brasas')`);
  ok(await espera('document.querySelector(".efecto-tarjeta")'), 'Tile: los efectos del tile se muestran');
  ok(await js(`[...document.querySelectorAll('.efecto-tarjeta select')].some(s=>[...s.options].some(o=>o.textContent.includes('Al pisar')))`), 'Tile: ofrece el disparador «Al pisar la casilla»');
  await foto('06d-tile-efectos');

  // Condiciones («Solo si…») en los efectos
  await js(`window.__ed.abrir('rasgos', 'toque_venenoso')`);
  ok(await espera(`document.querySelector('.efecto-tarjeta [data-accion="anadir-condicion"]')`), 'Condiciones: cada efecto ofrece «+ Solo si…»');
  await click('.efecto-tarjeta [data-accion="anadir-condicion"]');
  ok(await espera(`document.querySelector('.efecto-condicion [data-efecto="si"]')`), 'Condiciones: se añade una condición');
  ok(await js(`[...document.querySelector('.efecto-condicion [data-efecto="si"]').options].some(o=>o.textContent.includes('Con una probabilidad')) && [...document.querySelector('.efecto-condicion [data-efecto="si"]').options].some(o=>o.textContent.includes('Un recurso'))`), 'Condiciones: la lista viene del catálogo del servidor');
  await js(`(()=>{const s=document.querySelector('.efecto-condicion [data-efecto="si"]');s.value='probabilidad';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  ok(await espera(`document.querySelector('.efecto-condicion [data-efecto-campo="porcentaje"]')?.value==='25'`), 'Condiciones: «Con una probabilidad» propone 25 %');
  await click('.efecto-tarjeta [data-accion="anadir-condicion"]');
  await js(`(()=>{const s=document.querySelectorAll('.efecto-condicion [data-efecto="si"]')[1];s.value='bando';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  ok(await espera(`document.querySelectorAll('.efecto-condicion').length===2 && document.querySelectorAll('.efecto-condicion')[1].textContent.includes('y además') && [...document.querySelectorAll('.efecto-condicion')[1].querySelector('[data-efecto-campo="quien"]').options].some(o=>o.textContent==='El objetivo')`), 'Condiciones: «y además» con una segunda condición sobre el objetivo');
  await foto('06g-condiciones');
  await click('[data-accion="panel-derecho"]');
  ok(await espera(`getComputedStyle(document.querySelector('.panel-derecho')).display==='none'`), 'Panel derecho: se puede plegar');
  await click('[data-accion="panel-derecho"]');
  ok(await espera(`getComputedStyle(document.querySelector('.panel-derecho')).display!=='none'`), 'Panel derecho: y volver a mostrar');
  await click('[data-accion="guardar-pestana"]');
  await esperar(700);
  const yRasgo = fs.readFileSync(path.join(camp, 'ejemplo', 'traits', 'toque_venenoso.yaml'), 'utf8');
  ok(/si:/.test(yRasgo) && /probabilidad/.test(yRasgo) && /porcentaje: 25/.test(yRasgo) && /bando: enemigo/.test(yRasgo), 'Condiciones: se guardan en el YAML del rasgo');
  ok(await espera('window.__ed.E.problemas.estado==="ok"', 8000), 'Condiciones: el servidor da por buena la campaña: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));
  await js(`(()=>{const s=document.querySelector('[data-efecto="cuando"]');s.value='siempre';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  ok(await espera(`document.querySelectorAll('.efecto-condicion').length===1 && document.querySelector('.efecto-condicion').dataset.condicion==='bando' && !document.querySelector('.efecto-condicion [data-efecto-campo="quien"]')`), 'Condiciones: con «Siempre activo» se quita la probabilidad y «el objetivo» deja de tener sentido');
  await click('[data-accion="quitar-condicion"]');
  ok(await espera(`!document.querySelector('.efecto-condicion') && !window.__ed.E.pestanas.find(t=>t.clave==='rasgos/toque_venenoso').borrador.efectos[0].si`), 'Condiciones: «✕» quita la condición');
  await click('[data-accion="descartar"]');

  // Tablas para fórmulas y valores propios de las habilidades
  await js(`window.__ed.abrirReglas('tablas')`);
  ok(await espera(`document.querySelector('[data-accion="nueva-tabla"]')`), 'Tablas: hay un apartado «Tablas para fórmulas» en Reglas');
  await click('[data-accion="nueva-tabla"]');
  await escribir('[data-tabla-nombre="0"]', 'Multiplicador');
  await escribir('[data-tabla="0"] [data-accion="probar-tabla"]', '20');
  ok(await espera(`document.querySelector('[data-tabla="0"] .tabla-resultado').textContent==='2'`), 'Tablas: el probador dice qué da cada valor (20 → 2)');
  await escribir('[data-tabla="0"] [data-accion="probar-tabla"]', '1');
  ok(await espera(`document.querySelector('[data-tabla="0"] .tabla-resultado').textContent==='0'`), 'Tablas: …y 1 → 0');
  await foto('06h-tablas');
  await click('[data-accion="guardar-pestana"]');
  await esperar(800);
  ok(/tablas:/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8')) && /Multiplicador/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8')), 'Tablas: se guardan en config.yaml');
  await js(`window.__ed.abrir('habilidades', 'ataque_basico')`);
  await espera(`document.querySelector('[data-accion="nuevo-valor"]')`);
  await click('[data-accion="nuevo-valor"]');
  ok(await espera(`document.querySelector('[data-valor-numero="Potencia"]') && [...document.querySelectorAll('.formula-grupo .chip-btn')].some(b=>b.textContent==='Potencia')`), 'Habilidad: «+ Añadir valor» crea Potencia y aparece como botón en la fórmula');
  await escribir('.formulario [data-campo="formula"]', 'max(0; ([a.Vigor] + [h.Potencia]/2 - [o.Resistencia]/1,6) * tabla(Multiplicador; 1d20))');
  ok(await espera(`document.querySelector('.formula-estado').classList.contains('bien')`), 'Habilidad: el Editor acepta funciones, decimales, [h.Potencia] y tabla(…): ' + await js(`document.querySelector('.formula-estado').textContent`));
  await escribir('.formulario [data-campo="formula"]', 'max(0, 1)');
  ok(await espera(`document.querySelector('.formula-estado').classList.contains('mal') && document.querySelector('.formula-estado').textContent.includes('«;»')`), 'Habilidad: avisa si se separa con coma en vez de «;»');
  await escribir('.formulario [data-campo="formula"]', 'max(0; ([a.Vigor] + [h.Potencia]/2 - [o.Resistencia]/1,6) * tabla(Multiplicador; 1d20))');
  await foto('06i-habilidad-valores');
  await click('[data-accion="guardar-pestana"]');
  await esperar(700);
  const yHab = fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', 'ataque_basico.yaml'), 'utf8');
  ok(/valores:/.test(yHab) && /Potencia: 10/.test(yHab) && /tabla\(Multiplicador; 1d20\)/.test(yHab), 'Habilidad: los valores propios y la fórmula se guardan');
  ok(await espera('window.__ed.E.problemas.estado==="ok"', 8000), 'Tablas: el servidor da por buena la campaña: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));

  // Etiquetas y tabla de ventajas
  await js(`window.__ed.abrirReglas('etiquetas')`);
  ok(await espera(`document.querySelector('[data-accion="nueva-etiqueta"]')`), 'Etiquetas: apartado «Etiquetas y ventajas» en Reglas');
  await click('[data-accion="nueva-etiqueta"]'); await click('[data-accion="nueva-etiqueta"]');
  await js(`(()=>{const e=document.querySelector('[data-etiqueta-nombre="0"]');e.value='Fuego';e.dispatchEvent(new Event('change'))})()`);
  await js(`(()=>{const e=document.querySelector('[data-etiqueta-nombre="1"]');e.value='Planta';e.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`document.querySelectorAll('.matriz .matriz-celda').length===4`), 'Etiquetas: la tabla de ventajas es una cuadrícula 2×2');
  await js(`(()=>{const c=document.querySelector('.matriz-celda[data-atacante="Fuego"][data-defensor="Planta"]');c.value='2';c.dispatchEvent(new Event('change'))})()`);
  await js(`(()=>{const c=document.querySelector('.matriz-celda[data-atacante="Planta"][data-defensor="Fuego"]');c.value='0,5';c.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`document.querySelector('.matriz-celda[data-atacante="Fuego"][data-defensor="Planta"]').classList.contains('fuerte') && document.querySelector('.matriz-celda[data-atacante="Planta"][data-defensor="Fuego"]').classList.contains('debil')`), 'Etiquetas: la casilla se colorea (verde = fuerte, rojo = débil)');
  await foto('06j-etiquetas');
  await click('[data-accion="guardar-pestana"]'); await esperar(800);
  let cfgE = fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8');
  ok(/etiquetas:/.test(cfgE) && /atacante: Fuego/.test(cfgE) && /multiplicador: 0.5/.test(cfgE), 'Etiquetas: se guardan con su tabla de ventajas');
  await js(`window.__ed.abrir('habilidades', 'bola_de_fuego')`);
  await espera(`document.querySelector('[data-accion="anadir-etiqueta"]')`);
  await js(`(()=>{const s=document.querySelector('[data-accion="anadir-etiqueta"]');s.value='Fuego';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`document.querySelector('.chip-etiqueta[data-etiqueta="Fuego"]') && [...document.querySelectorAll('.chip-btn')].some(b=>b.textContent.includes('Ventaja de tipo'))`), 'Habilidad: se le pone la etiqueta Fuego y la fórmula ofrece «× Ventaja de tipo»');
  const f0 = await js(`document.querySelector('.formulario [data-campo="formula"]').value`);
  await escribir('.formulario [data-campo="formula"]', '(' + f0 + ') * ventaja()');
  ok(await espera(`document.querySelector('.formula-estado').classList.contains('bien')`), 'Habilidad: ventaja() es válida en la fórmula');
  ok(await espera(`document.querySelector('.fila-recurso[data-clave="habilidades/bola_de_fuego"] .fila-resumen').textContent.includes('Fuego')`), 'Lista: el resumen de la habilidad muestra su etiqueta');
  await click('[data-accion="guardar-pestana"]'); await esperar(700);
  ok(/etiquetas:\s*\n\s*- Fuego/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', 'bola_de_fuego.yaml'), 'utf8')), 'Habilidad: la etiqueta se guarda');
  await js(`window.__ed.abrirReglas('etiquetas')`);
  await espera(`document.querySelector('[data-etiqueta-nombre="0"]')`);
  await js(`(()=>{const e=document.querySelector('[data-etiqueta-nombre="0"]');e.value='Llama';e.dispatchEvent(new Event('change'))})()`);
  await click('[data-accion="guardar-pestana"]'); await esperar(900);
  cfgE = fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8');
  ok(/atacante: Llama/.test(cfgE) && !/Fuego/.test(cfgE) && /- Llama/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', 'bola_de_fuego.yaml'), 'utf8')), 'Etiquetas: renombrar Fuego → Llama actualiza la tabla y las habilidades');
  ok(await espera('window.__ed.E.problemas.estado==="ok"', 8000), 'Etiquetas: el servidor da por buena la campaña: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));

  // Contadores y reglas automáticas
  await js(`window.__ed.abrirReglas('estadisticas')`);
  await espera(`document.querySelector('[data-col="repartible"]')`);
  await clickTexto('.tabla-editable .btn', '+ Añadir estadística');
  await esperar(200);
  await js(`(()=>{const fs=[...document.querySelectorAll('.tabla-editable')][0].querySelectorAll('.fila-tabla');const f=fs[fs.length-1];const n=f.querySelector('[data-col="nombre"]');n.value='Experiencia';n.dispatchEvent(new Event('input'));const r=f.querySelector('[data-col="repartible"]');r.checked=false;r.dispatchEvent(new Event('change'));const i=f.querySelector('[data-col="valor_inicial"]');i.value='0';i.dispatchEvent(new Event('input'))})()`);
  ok(await js(`document.querySelectorAll('[data-col="empieza_vacio"]').length>0`), 'Contadores: los recursos tienen la casilla «Vacío»');
  await click('[data-accion="guardar-pestana"]'); await esperar(800);
  ok(/nombre: Experiencia[\s\S]*?repartible: false/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8')), 'Contadores: «Experiencia» se guarda como estadística que no recibe puntos');
  await js(`window.__ed.abrirReglas('automaticas')`);
  ok(await espera(`[...document.querySelectorAll('.reglas-contenido .btn')].some(b=>b.textContent==='+ Añadir efecto')`), 'Reglas automáticas: hay un apartado para efectos de la campaña');
  await clickTexto('.reglas-contenido .btn', '+ Añadir efecto');
  await js(`(()=>{const s=document.querySelector('.reglas-contenido [data-efecto="cuando"]');s.value='al_derrotar';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await esperar(150);
  await js(`(()=>{const s=document.querySelector('.reglas-contenido [data-efecto="hacer"]');s.value='modificar_estadistica';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await esperar(150);
  await js(`(()=>{const s=document.querySelector('.reglas-contenido [data-efecto-campo="estadistica"]');s.value='Experiencia';s.dispatchEvent(new Event('change',{bubbles:true}));const f=document.querySelector('.reglas-contenido [data-efecto-campo="formula"]');f.value='10';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  ok(await js(`[...document.querySelector('.reglas-contenido [data-efecto="cuando"]').options].some(o=>o.textContent==='Al derrotar a alguien')`), 'Reglas automáticas: ofrece «Al derrotar a alguien»');
  await foto('06k-reglas-automaticas');
  await click('[data-accion="guardar-pestana"]'); await esperar(900);
  const cfgA = fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8');
  ok(/tipo: al_derrotar/.test(cfgA) && /tipo: modificar_estadistica/.test(cfgA), 'Reglas automáticas: el efecto se guarda en config.yaml');
  ok(await espera('window.__ed.E.problemas.estado==="ok"', 8000), 'Contadores: el servidor da por buena la campaña: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));

  // Opciones: estadísticas y recursos propios de la clase
  await js(`(()=>{window.NUM=(n)=>document.querySelector('[data-cambia="'+n+'"]').closest('.fila-valor').querySelector('input[type=number]');return 1})()`);
  await js(`window.__ed.abrir('opciones', 'berserker')`);
  ok(await espera(`document.querySelector('[data-cambia="Vigor"]')?.checked && NUM('Vigor').value==='14'`), 'Opción: Berserker marca Vigor (antes Fuerza) y empieza en 14');
  ok(await js(`document.querySelector('[data-cambia="Resistencia"]').checked===false && NUM('Resistencia').disabled===true`), 'Opción: lo no marcado usa el valor de la campaña (campo bloqueado)');
  ok(await js(`document.querySelector('[data-cambia="Furia"]')?.checked`), 'Opción: Berserker concede el recurso Furia');
  await click('[data-cambia="Resistencia"]');
  ok(await js(`NUM('Resistencia').disabled===false`), 'Opción: al marcar una estadística se puede fijar su valor');
  await foto('06e-opcion-clase');
  await js(`window.__ed.abrirReglas('estadisticas')`);
  ok(await espera(`[...document.querySelectorAll('[data-col="para_todos"]')].some(c=>c.checked===false)`), 'Reglas: Furia aparece como «no es de todos»');
  // Quién tiene una estadística que no es de todos: se elige aquí, en Reglas
  ok(await espera(`document.querySelector('.solo-para select[data-col="solo_para"]')`), 'Reglas: una estadística que no es de todos pregunta quién la tiene');
  await js(`(()=>{const s=document.querySelector('.solo-para select[data-col="solo_para"]');s.value='mago';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`[...document.querySelectorAll('.solo-para .chip')].some(c=>c.textContent.includes('Mago'))`), 'Reglas: se añade «Clase: Mago» a quienes la tienen');
  await click('[data-accion="guardar-pestana"]'); await esperar(800);
  ok(/solo_para:\s*\n\s*- mago/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8')), 'Reglas: «solo_para» se guarda');
  // Estados que impiden y que pasan a otro; habilidad de solo efecto; opción no elegible
  await js(`window.__ed.abrir('estados', 'veneno')`);
  await espera(`document.querySelector('[data-campo="impide"] [data-valor="mover"]')`);
  await click('[data-campo="impide"] [data-valor="mover"]');
  await click('[data-accion="guardar-pestana"]'); await esperar(600);
  ok(/impide:\s*\n\s*- mover/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'states', 'veneno.yaml'), 'utf8')), 'Estado: «Mientras dure, no puede… moverse» se guarda');
  ok(await espera(`document.querySelector('select[data-campo="al_reaplicar"]')?.value==='renovar' && document.querySelector('[data-campo="max_cargas"]') && document.querySelector('[data-campo="impide_etiquetas"]')`), 'Estado: «si se lo vuelven a aplicar», cargas y «no puede usar habilidades con estas etiquetas»');
  await escribir('select[data-campo="al_reaplicar"]', 'acumular');
  await click('[data-accion="guardar-pestana"]'); await esperar(600);
  ok(/al_reaplicar: acumular/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'states', 'veneno.yaml'), 'utf8')), 'Estado: «acumula cargas» se guarda');
  // «Nuevo estado»: en blanco o desde una plantilla
  await js(`window.__ed.irACategoria('estados')`);
  await espera(`document.querySelector('[data-lista="estados"] [data-accion="nuevo-en-lista"]')`);
  await click('[data-lista="estados"] [data-accion="nuevo-en-lista"]');
  ok(await espera(`document.querySelectorAll('.dialogo [data-plantilla]').length>=10 && document.querySelector('.dialogo [data-plantilla="confusion"]')`), 'Estados: «＋» ofrece empezar en blanco o desde una plantilla');
  await foto('06l-plantillas-estado');
  await click('.dialogo [data-plantilla="confusion"]');
  ok(await espera(`window.__ed.E.pestanas.some(p=>p.cat==='estados'&&p.borrador.nombre==='Confusión') && document.querySelector('[data-efecto="cuando"]')?.value==='al_intentar'`), 'Plantilla: la Confusión queda creada y abierta, con «Al intentar una acción»');
  ok(await js(`(()=>{const v=[...document.querySelector('[data-efecto="si"]').options].map(o=>o.value);return v.includes('probabilidad')&&!v.includes('critico')&&!v.includes('dano')})()`), 'Efectos: las condiciones del golpe no se ofrecen con «Al intentar»');
  ok(await js(`document.querySelector('[data-efecto="hacer"]').value==='redirigir_ataque'`), 'Plantilla: la Confusión redirige el ataque');
  await foto('06m-estado-confusion');
  ok(await espera(`window.__ed.E.problemas.estado==='ok'`, 8000), 'Plantilla: el servidor acepta la Confusión: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));
  {
    const idConf = await js(`window.__ed.E.pestanas.find(p=>p.cat==='estados'&&p.borrador.nombre==='Confusión').id`);
    await js(`window.__ed.eliminar('estados', ${JSON.stringify(idConf)})`);
  }
  await js(`window.__ed.abrir('habilidades', 'curacion')`);
  await espera(`document.querySelector('.seg[data-valor="efecto"]')`);
  await click('.seg[data-valor="efecto"]');
  await escribir('[data-campo="formula"]', '');
  await escribir('[data-campo="aplica_estado"]', 'veneno');
  await click('[data-accion="critico-activo"]');
  await click('[data-accion="guardar-pestana"]'); await esperar(800);
  const hc = fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', 'curacion.yaml'), 'utf8');
  ok(/tipo: efecto/.test(hc) && /aplica_estado: veneno/.test(hc) && /desde: 20/.test(hc), 'Habilidad: «Solo efecto» con estado y crítico se guarda');
  ok(await espera('window.__ed.E.problemas.estado!=="error"', 8000), 'Habilidad: «Solo efecto» no necesita fórmula: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));
  await js(`window.__ed.abrir('opciones', 'mago')`);
  await espera(`document.querySelector('[data-campo="elegible"]')`);
  ok(await js(`document.querySelector('[data-campo="elegible"]').checked`), 'Opción: por defecto se puede elegir al crear');

  // Sonidos: listas simples por categorías (como Attorney Online)
  await js(`document.querySelector('[data-clave="sonidos"]').click()`);
  ok(await espera(`document.querySelector('.sonido-pestana.activa')?.dataset.tipo==='musica' && document.querySelector('[data-categoria="Pueblo"] [data-archivo="taberna.wav"]')`), 'Sonidos: la lista de música muestra categorías y archivos');
  ok(await js(`!document.querySelector('[data-campo="descripcion"]') && !document.querySelector('[data-campo="bucle"]')`), 'Sonidos: sin descripciones ni opciones por canción');
  ok(await espera(`document.querySelector('[data-archivo="taberna.wav"]').classList.contains('tiene') && document.querySelector('[data-archivo="batalla.ogg"]').classList.contains('falta')`), 'Sonidos: marca lo que no está en los archivos de la campaña');
  ok(await espera(`document.querySelector('.panel-derecho')?.textContent.includes('batalla.ogg') `), 'Problemas: avisa del audio que falta');
  await js(`document.querySelector('.problema-cerrar').click()`);
  ok(await espera(`!document.querySelector('.panel-derecho')?.textContent.includes('batalla.ogg')`), 'Problemas: el aviso se puede marcar como intencionado');
  ok(await js(`(localStorage.getItem('editor.avisosIntencionados.ejemplo')||'').includes('batalla.ogg')`), 'Problemas: lo marcado como intencionado se recuerda');
  await clickTexto('.panel-derecho .enlace', 'Mostrar de nuevo');
  ok(await espera(`document.querySelector('.panel-derecho')?.textContent.includes('batalla.ogg')`), 'Problemas: «Mostrar de nuevo» devuelve los avisos');
  await click('[data-accion="añadir-existentes"]');
  ok(await espera(`document.querySelector('[data-categoria="General"] [data-archivo="extra.mp3"]')`), 'Sonidos: «añadir los que ya están» crea la lista rápido');
  await js(`(()=>{const s=document.querySelector('[data-archivo="extra.mp3"] select');s.value='Combate';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  ok(await espera(`document.querySelector('[data-categoria="Combate"] [data-archivo="extra.mp3"]')`), 'Sonidos: mover un archivo a otra categoría');
  await click('[data-tipo="ambiente"]');
  ok(await espera(`document.querySelector('[data-categoria="Clima"] [data-archivo="lluvia.wav"]')`), 'Sonidos: pestaña de ambiente');
  await click('[data-accion="nueva-categoria"]');
  await escribir('.dialogo input', 'Dungeon');
  await click('.dialogo .btn-acento');
  ok(await espera(`document.querySelector('[data-categoria="Dungeon"]')`), 'Sonidos: crear una categoría');
  await js(`document.querySelector('[data-categoria="Dungeon"] [data-accion="borrar-categoria"]').click()`);
  ok(await espera(`!document.querySelector('[data-categoria="Dungeon"]')`), 'Sonidos: borrar una categoría vacía');
  await click('[data-tipo="musica"]');
  await foto('06f-sonidos');
  ok(!/extra\.mp3/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'sonidos.yaml'), 'utf8')), 'Sonidos: sin pulsar Guardar no se escribe nada en disco');
  ok(await js(`document.querySelector('.sin-guardar') && !document.querySelector('.sin-guardar').hidden`), 'Sonidos: avisa de cambios sin guardar');
  await click('[data-accion="guardar-pestana"]');
  await esperar(500);
  const yamlSon = fs.readFileSync(path.join(camp, 'ejemplo', 'sonidos.yaml'), 'utf8');
  ok(/categoria: Combate/.test(yamlSon) && /extra\.mp3/.test(yamlSon) && !fs.existsSync(path.join(camp, 'ejemplo', 'sounds')), 'Sonidos: se guarda en sonidos.yaml de la campaña');

  // NPC: bando y regla de ataque
  await js(`window.__ed.abrir('enemigos', 'tabernero')`);
  ok(await espera(`document.querySelector('[data-campo="bando"]')?.value==='neutral'`), 'NPC: el tabernero es neutral');
  await js(`window.__ed.abrir('enemigos', 'guardia')`);
  ok(await espera(`document.querySelector('[data-campo="bando"]')?.value==='aliado'`), 'NPC: el guardia es aliado');
  await js(`window.__ed.abrir('enemigos', 'goblin')`);
  ok(await espera(`document.querySelector('.campo-sonidos input[data-sonido="espada.wav"]')?.checked===true`), 'Sonidos: el goblin del ejemplo trae su sonido asociado marcado');
  ok(await js(`document.querySelector('.explorador').textContent.includes('NPC') && !document.querySelector('.explorador').textContent.includes('Enemigos')`), 'NPC: el explorador dice NPC, no «Enemigos»');
  // Arrastrar un NPC a una categoría nueva (y luego a otra) la cambia y la guarda al momento
  await click('.explorador [data-vista="enemigos"]');
  ok(await espera(`!!document.querySelector('.lista-cat [data-accion="nueva-categoria-npc"]') && document.querySelector('.fila-recurso[data-clave="enemigos/tabernero"]')?.draggable`), 'NPC: las filas se arrastran y hay sitio para una categoría nueva');
  const arrastrar = (desde, hasta) => js(`(()=>{const dt=new DataTransfer();const a=document.querySelector(${JSON.stringify(desde)});const b=document.querySelector(${JSON.stringify(hasta)});
    a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
    b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));return true})()`);
  await arrastrar('.fila-recurso[data-clave="enemigos/tabernero"]', '[data-accion="nueva-categoria-npc"]');
  ok(await espera(`!!document.querySelector('.dialogo input')`), 'NPC: soltar en «nueva categoría» pide su nombre');
  await js(`(()=>{document.querySelector('.dialogo input').value='Aldeanos';[...document.querySelectorAll('.dialogo button')].find(b=>b.textContent==='Crear').click()})()`);
  ok(await espera(`window.__ed.E.campana.recursos.enemigos.tabernero.categoria==='Aldeanos' && !!document.querySelector('[data-categoria-npc="Aldeanos"]')`), 'NPC: el tabernero pasa a «Aldeanos» y la lista se agrupa');
  ok(/categoria: Aldeanos/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'enemies', 'tabernero.yaml'), 'utf8')), 'NPC: la categoría queda guardada en su archivo');
  await arrastrar('.fila-recurso[data-clave="enemigos/goblin"]', '[data-categoria-npc="Aldeanos"]');
  ok(await espera(`window.__ed.E.campana.recursos.enemigos.goblin.categoria==='Aldeanos' && document.querySelector('[data-categoria-npc="Aldeanos"] .cuenta')?.textContent==='2'`), 'NPC: arrastrar otro NPC sobre una categoría lo mete en ella');
  ok(await espera(`document.querySelector('.ficha [data-campo="categoria"]')?.value==='Aldeanos'`), 'NPC: su ficha abierta muestra la categoría nueva');
  await foto('npc-categorias');
  await arrastrar('.fila-recurso[data-clave="enemigos/goblin"]', '[data-categoria-npc="(sin categoría)"]');
  ok(await espera(`!window.__ed.E.campana.recursos.enemigos.goblin.categoria`), 'NPC: soltarlo en «Sin categoría» le quita la categoría');
  await arrastrar('.fila-recurso[data-clave="enemigos/tabernero"]', '[data-categoria-npc="(sin categoría)"]');
  await espera(`!window.__ed.E.campana.recursos.enemigos.tabernero.categoria`);
  await js(`window.__ed.abrir('enemigos', 'goblin')`);
  // «Ordenar por…» y arrastrar filas arriba o abajo (orden «Personalizado», que también usa la partida)
  await js(`localStorage.removeItem('editor.ordenListas')`);          // el modo elegido se recuerda en el equipo: la prueba empieza de cero
  await click('.explorador [data-vista="habilidades"]');
  await espera(`document.querySelector('.lista-cat[data-lista="habilidades"]')`);
  const nombresLista = () => js(`[...document.querySelectorAll('.lista-cat .fila-recurso')].map(f=>f.dataset.id)`);
  ok(await js(`document.querySelector('.lista-orden')?.value==='nombre'`), 'Orden: cada lista tiene «Ordenar por», por nombre si no eliges otra cosa');
  await js(`window.__ed.nuevo('habilidades', {}, { nombre: 'Abanico de prueba', abrir: false })`);
  await espera(`document.querySelectorAll('.lista-cat .fila-recurso').length >= 2 && [...document.querySelectorAll('.lista-cat .fila-recurso')].some(f=>f.dataset.id==='abanico_de_prueba')`);
  ok((await nombresLista())[0] === 'abanico_de_prueba', 'Orden: por nombre, «Abanico» va primero');
  await js(`(()=>{const s=document.querySelector('.lista-orden');s.value='creacion';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`[...document.querySelectorAll('.lista-cat .fila-recurso')].pop()?.dataset.id==='abanico_de_prueba'`), 'Orden: por orden de creación, el recién creado va el último');
  const antesArr = await nombresLista();
  const soltarSobre = (id, junto, abajo) => js(`(()=>{const dt=new DataTransfer();const a=document.querySelector('.fila-recurso[data-id="${id}"]');const b=document.querySelector('.fila-recurso[data-id="${junto}"]');const r=b.getBoundingClientRect();const y=${abajo}?r.bottom-2:r.top+2;
    a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:y}));
    b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:y}));a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));return true})()`);
  await soltarSobre(antesArr[2], antesArr[0], false);          // el tercero, encima del primero
  const esperado = [antesArr[2], antesArr[0], antesArr[1], ...antesArr.slice(3)];
  ok(await espera(`document.querySelector('.lista-orden').value==='personalizado' && JSON.stringify([...document.querySelectorAll('.lista-cat .fila-recurso')].map(f=>f.dataset.id))===${JSON.stringify(JSON.stringify(esperado))}`), 'Orden: arrastrar una fila encima de otra la pone delante y pasa a «Personalizado»');
  await foto('orden-personalizado');
  const metaE2e = () => fs.readFileSync(path.join(camp, 'ejemplo', 'campana.yaml'), 'utf8');
  ok(metaE2e().includes(`- ${antesArr[2]}`) && /orden:[\s\S]*abilities:/.test(metaE2e()), 'Orden: el orden personalizado se guarda en campana.yaml');
  await js(`(()=>{const b=document.querySelector('.fila-recurso[data-id="${antesArr[2]}"] .fila-abrir');b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))})()`);
  ok(await espera(`[...document.querySelectorAll('.lista-cat .fila-recurso')][1]?.dataset.id==='${antesArr[2]}'`), 'Orden: Alt + ↓ baja la fila un puesto');
  const ordenServidor = require('child_process').execFileSync('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from mesa import recursos;c,_=recursos.cargar(sys.argv[2]);print(",".join(c.habilidades))',
    path.join(__dirname, '..', '..'), path.join(camp, 'ejemplo')]).toString().trim().split(',');
  ok(JSON.stringify(ordenServidor) === await js(`JSON.stringify([...document.querySelectorAll('.lista-cat .fila-recurso')].map(f=>f.dataset.id))`), 'Orden: la partida (el servidor) usa el mismo orden personalizado');
  await js(`(()=>{const s=document.querySelector('.lista-orden');s.value='nombre';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`[...document.querySelectorAll('.lista-cat .fila-recurso')][0]?.dataset.id==='abanico_de_prueba'`), 'Orden: volver a «Nombre» solo cambia cómo se ve la lista');
  await js(`window.__ed.eliminar('habilidades', 'abanico_de_prueba')`);
  await js(`window.__ed.abrir('enemigos', 'goblin')`);
  await js(`window.__ed.abrirReglas('mesa')`);
  ok(await espera(`document.body.textContent.includes('¿A quién pueden atacar los jugadores?')`), 'Reglas: se elige a quién pueden atacar los jugadores');
  ok(await espera(`document.body.textContent.includes('¿Cómo se cambia de sala?') && !!document.querySelector('.seg[data-valor="todos"]')`), 'Reglas: se elige si los jugadores cambian de sala solos');
  await click('[data-sec="visibilidad"]');
  ok(await espera(`document.body.textContent.includes('De los NPC') && document.body.textContent.includes('De otros jugadores')`), 'Reglas: apartado «Qué ven los jugadores»');
  ok(await espera(`document.querySelector('[data-campo="barras"] input[value="HP"]')?.checked===true && document.querySelector('[data-campo="barras"] input[value="MP"]')?.checked===false && !!document.querySelector('[data-campo="nombre_npc"]')`), 'Reglas: barras sobre los tokens (por defecto, la vida) y si se ven los nombres');
  await js(`document.querySelector('[data-campo="barras"] input[value="MP"]').click()`);
  ok(await espera(`JSON.stringify(window.__ed.E.pestanas.find(t=>t.clave==='reglas').borrador.visibilidad.sobre_tokens.barras)==='["HP","MP"]'`), 'Reglas: marcar MP añade su barra');
  await foto('reglas-sobre-tokens');
  await js(`document.querySelector('[data-campo="barras"] input[value="MP"]').click()`);
  await click('[data-sec="dinero"]');
  ok(await espera(`document.body.textContent.includes('Piezas (opcional)') && document.querySelectorAll('.fila-tabla [data-col="valor"]').length===3 && document.querySelector('[data-campo="intercambios"]')`), 'Reglas: apartado «Dinero y comercio» con las piezas del ejemplo y los intercambios');
  ok(await espera(`document.querySelector('[data-campo="dar_objetos"]') && document.querySelector('[data-campo="alcance_objetos"]')`), 'Reglas: «Comercio y objetos» deja permitir dar objetos y elegir a qué distancia');
  await click('[data-sec="sistema"]');
  ok(await espera(`document.querySelectorAll('.fila-tabla [data-col="opacidad"]').length===6 && !document.body.textContent.includes('Piezas (opcional)')`), 'Reglas: apartado «Día, noche y clima» con los 2 momentos y los 4 climas del ejemplo');
  ok(await espera(`document.querySelectorAll('.reglas-nav-bloque').length===5`), 'Reglas: las secciones van agrupadas en 5 bloques');
  // Turnos y movimiento
  await click('[data-sec="turnos"]');
  ok(await espera(`document.querySelector('select[data-campo="iniciativa"]') && document.querySelector('[data-campo="limitado"]')`), 'Reglas: apartado «Turnos y movimiento»');
  ok(await espera(`document.querySelector('select[data-campo="estadistica_iniciativa"]')?.value==='Agilidad'`), 'Turnos: la estadística de iniciativa se elige aquí mismo');
  await escribir('select[data-campo="iniciativa"]', 'preguntar');
  ok(await espera(`document.querySelectorAll('[data-campo="iniciativa_opciones"] input').length===3`), 'Turnos: «El GM elige al iniciar» muestra qué opciones se le ofrecen');
  await escribir('select[data-campo="iniciativa"]', 'manual');
  ok(await espera(`!document.querySelector('[data-campo="iniciativa_opciones"]') && !document.querySelector('[data-campo="estadistica_iniciativa"]')`), 'Turnos: con el orden a mano no se pregunta ni se pide estadística');
  ok(await espera(`!document.querySelector('[data-campo="casillas"]')`), 'Movimiento: sin límite no se piden casillas');
  await click('[data-campo="limitado"]');
  ok(await espera(`document.querySelector('select[data-campo="modo"]') && document.querySelector('[data-campo="casillas"]')`), 'Movimiento: al limitarlo se elige entre casillas fijas o una estadística');
  await escribir('select[data-campo="modo"]', 'estadistica');
  ok(await espera(`document.querySelector('select[data-campo="estadistica"]') && !document.querySelector('[data-campo="casillas"]')`), 'Movimiento: «según una estadística» deja elegirla');
  await escribir('select[data-campo="iniciativa"]', 'estadistica');
  await espera(`document.querySelector('select[data-campo="estadistica_iniciativa"]')`);
  await js(`document.querySelector('[data-campo="modo"]').scrollIntoView({block:'center'})`);
  await foto('05b-turnos-movimiento');
  await escribir('select[data-campo="iniciativa"]', 'manual');
  await escribir('select[data-campo="modo"]', 'fijo');
  await espera(`document.querySelector('[data-campo="casillas"]')`);
  await escribir('[data-campo="casillas"]', '4');
  // Niveles y experiencia
  await click('[data-sec="niveles"]');
  await espera(`document.querySelector('.niveles-editor [data-campo="activo"]')`);
  await click('.niveles-editor [data-campo="activo"]');
  ok(await espera(`document.querySelector('.niveles-editor .seg[data-valor="manual"][aria-pressed="true"]') && !document.querySelector('.niveles-editor [data-campo="umbrales"]')`), 'Niveles: al activarlos empiezan en «lo decide el GM» (sin umbrales)');
  await click('.niveles-editor .seg[data-valor="experiencia"]');
  ok(await espera(`document.querySelector('.niveles-editor [data-campo="umbrales"]')`), 'Niveles: con experiencia automática aparecen los umbrales');
  await click('.niveles-editor .seg[data-valor="manual"]');
  ok(await espera(`!document.querySelector('.niveles-editor [data-campo="umbrales"]') && document.querySelector('.niveles-editor [data-campo="maximo"]')`), 'Niveles: en modo «lo decide el GM» no se piden umbrales');
  await escribir('.niveles-editor [data-campo="puntos"]', '2');
  await escribir('.niveles-editor [data-por-nivel="HP"]', '10');
  await click('.niveles-editor [data-accion="anadir-aprende"]');
  await escribir('.niveles-editor [data-aprende-nivel="0"]', '3');
  await js(`document.querySelector('[data-accion="guardar-pestana"]').click()`);
  await espera('window.__ed.E.problemas.estado!=="validando"', 8000);
  await esperar(400);
  {
    const cfgY = require('yaml').parse(fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8'));
    const nv = cfgY.juego.niveles;
    ok(cfgY.juego.iniciativa === 'manual' && cfgY.juego.movimiento.limitado === true && cfgY.juego.movimiento.casillas === 4, 'Turnos: se guardan el orden manual y el movimiento limitado');
    ok(nv.activo === true && nv.modo === 'manual' && nv.por_nivel.puntos === 2 && nv.por_nivel.recursos.HP === 10 && nv.aprende[0].nivel === 3, 'Niveles: se guardan modo, lo que da cada nivel y lo que se aprende');
  }
  ok(await espera(`window.__ed.E.problemas.estado==='ok'`, 8000), 'Niveles: el servidor acepta la configuración: ' + await js(`JSON.stringify(window.__ed.E.problemas.errores)`));
  await js(`window.__ed.abrir('opciones', 'mago')`);
  ok(await espera(`document.querySelector('.aprende[data-campo="aprende"] [data-accion="anadir-aprende"]')`), 'Niveles: cada opción (clase) tiene «Aprende al subir de nivel»');
  await js(`window.__ed.abrir('habilidades', 'ataque_basico')`);
  if (await espera(`document.querySelector('.dialogo')`, 1200)) await clickTexto('.dialogo button', 'No guardar');
  await escribir('[data-campo="formula"]', '[Nivel] * 2 + 1d4');
  ok(await espera(`document.querySelector('.formula-estado')?.classList.contains('bien')`), 'Niveles: las fórmulas aceptan [Nivel]');
  await js(`document.querySelector('[data-accion="descartar"]')?.click()`);
  if (await espera(`document.querySelector('.dialogo')`, 1200)) await js(`document.querySelector('.dialogo .btn-peligro, .dialogo .btn-acento')?.click()`);
  await js(`window.__ed.abrirReglas('niebla')`);
  ok(await espera(`document.body.textContent.includes('Activar la niebla de guerra') && document.body.textContent.includes('Visión base') && document.body.textContent.includes('Cómo dar más')`), 'Reglas: apartado «Niebla de guerra»');
  await js(`window.__ed.abrir('tiles', 'muro')`);
  ok(await espera(`document.querySelector('[data-campo="bloquea_vision"]') || [...document.querySelectorAll('.formulario label')].some(l=>l.textContent.includes('Bloquea la vista'))`), 'Tile: tiene la opción «Bloquea la vista»');
  await js(`window.__ed.abrir('objetos', 'antorcha')`);
  ok(await espera(`[...document.querySelectorAll('.formulario *')].some(e=>e.textContent.trim()==='Efectos (mientras lo lleve encima o al usarlo)')`), 'Objeto: tiene efectos «mientras lo lleve» y «al usarlo»');
  ok(await js(`window.__ed.E.campana.recursos.objetos.antorcha.efectos[0].hacer.tipo==='bono_vision'`), 'Objeto: la antorcha del ejemplo da visión');
  ok(await js(`(()=>{const s=document.querySelector('.campo-efectos [data-efecto="cuando"]');return [...s.options].map(o=>o.value).join()==='siempre,al_usar'})()`), 'Objeto: sus efectos son «Siempre» o «Al usarlo»');
  await js(`(()=>{const s=document.querySelector('.campo-efectos [data-efecto="cuando"]');s.value='al_usar';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`(()=>{const v=[...document.querySelector('.campo-efectos [data-efecto="hacer"]').options].map(o=>o.value);return v.includes('quitar_estado')&&v.includes('modificar_estadistica')&&!v.includes('bono_vision')})()`), 'Objeto: «Al usarlo» permite quitar estados y sumar estadísticas (sin bonos)');
  ok(await js(`!document.querySelector('.campo-efectos [data-efecto="hacer"]').closest('.efecto-tarjeta').querySelector('[data-campo="objetivo"]')`), 'Objeto: «Al usarlo» actúa siempre sobre quien lo usa');

  // Simulador: probar una habilidad con las reglas reales del servidor (con lo escrito sin guardar)
  await js(`window.__ed.abrir('habilidades', 'ataque_basico')`);
  if (await espera(`document.querySelector('.dialogo')`, 1200)) await clickTexto('.dialogo button', 'No guardar');
  ok(await espera(`document.querySelector('.campo-simulador summary')`), 'Simulador: la habilidad tiene «Probar esta habilidad»');
  await js(`document.querySelector('.campo-simulador details').open=true`);
  await escribir('[data-campo="formula"]', '7');
  await js(`(()=>{const s=document.querySelector('.campo-simulador select[aria-label="Cuántas veces"]');s.value='10';s.dispatchEvent(new Event('change'))})()`);
  await click('[data-accion="simular"]');
  ok(await espera(`document.querySelector('.sim-resumen')?.dataset.simMedia==='-7'`, 20000), 'Simulador: usa la fórmula sin guardar (7 de daño fijo, 10 veces)');
  ok(await js(`document.querySelector('.sim-resumen').textContent.includes('7 de daño') && document.querySelectorAll('.sim-detalle li').length===10`), 'Simulador: muestra la media y las tiradas');
  await escribir('[data-campo="formula"]', '[Nada] + 1');
  await click('[data-accion="simular"]');
  ok(await espera(`document.querySelector('.sim-salida .aviso-caja')?.textContent.includes('Nada')`, 20000), 'Simulador: si la habilidad tiene un error, lo explica');
  await foto('21-simulador');

  // Habilidades: área, golpes, mover al objetivo, requisitos, efectos al alcanzar y [Distancia]
  await clickTexto('[data-accion="descartar"]', 'Descartar');
  await esperar(200);
  await click('.campo-area [data-area="explosion"]');
  ok(await espera(`document.querySelector('.campo-area [data-area-tamano]') && document.querySelector('.campo-area [data-area-afecta]') && document.querySelector('.area-dibujo svg')`), 'Área: «Explosión» pide radio y a quién alcanza, con un dibujo');
  const bAB = `window.__ed.E.pestanas.find(t=>t.clave==='habilidades/ataque_basico').borrador`;
  await click('[data-area="casillas"]');
  await espera(`document.querySelector('.area-pintor [data-celda="2,-1"]')`);
  await js(`document.querySelector('.area-pintor [data-celda="2,-1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  ok(await espera(`JSON.stringify(${bAB}.area.casillas)==='[[1,0],[2,-1]]'`), 'Área: «Dibujar casillas» marca las casillas que alcanza pulsando en la rejilla');
  await click('[data-area="cono"]');
  ok(await espera(`${bAB}.area.forma==='cono' && !${bAB}.area.casillas && document.querySelector('.campo-area [data-area-tamano]')`), 'Área: «Cono» pide su largo');
  await click('[data-area="explosion"]'); await esperar(200);
  await js(`(()=>{const n=document.querySelector('.campo-area [data-area-tamano]');n.value='2';n.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await escribir('[data-campo="golpes"]', '2');
  await escribir('[data-mover-modo]', 'empujar');
  await click('[data-accion="anadir-requisito"]');
  ok(await espera(`document.querySelector('.requisitos .efecto-condicion [data-efecto-campo="quien"]')?.value==='objetivo'`), 'Requisitos: «+ Añadir requisito» propone una condición sobre el objetivo');
  await js(`[...document.querySelectorAll('.campo-efectos')].pop().querySelector('.btn:last-child').click()`);
  ok(await espera(`[...document.querySelectorAll('.campo-efectos')].pop().querySelector('[data-efecto="cuando"]')?.value==='al_impactar'`), 'Habilidad: sus efectos ocurren «Al alcanzar a cada objetivo»');
  await escribir('[data-campo="formula"]', '[Distancia] * 2 + 1d4');
  ok(await espera(`document.querySelector('.formula-estado.bien')`), 'Fórmula: [Distancia] vale en una habilidad');
  await click('[data-accion="guardar-pestana"]');
  await esperar(600);
  const hab = fs.readFileSync(path.join(camp, 'ejemplo', 'abilities', 'ataque_basico.yaml'), 'utf8');
  ok(/forma: explosion/.test(hab) && /tamano: 2/.test(hab) && /golpes: 2/.test(hab) && /modo: empujar/.test(hab) && /requisitos:/.test(hab) && /al_impactar/.test(hab), 'Habilidad: área, golpes, empuje, requisitos y efectos se guardan');
  ok(await js(`document.querySelector('.fila-recurso[data-clave="habilidades/ataque_basico"] .fila-resumen').textContent.includes('explosión')`), 'Lista: el resumen muestra el área');
  ok(!/: no$/m.test(hab.replace(/"no"/g, '')), 'YAML: los «no» van entre comillas (el servidor no los confunde con falso)');
  await foto('21b-habilidad-area');

  // Galería de imágenes: subcarpetas, buscador y elegir con miniaturas
  {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const dirTok = path.join(BASE, 'tokens');
    fs.mkdirSync(path.join(dirTok, 'criaturas'), { recursive: true });
    fs.writeFileSync(path.join(dirTok, 'criaturas', 'lobo_gris.png'), png);
    fs.writeFileSync(path.join(dirTok, 'criaturas', 'oso.png'), png);
    fs.writeFileSync(path.join(dirTok, 'aldeano.png'), png);
  }
  await js(`window.__ed.abrir('enemigos', 'goblin')`);
  if (await espera(`document.querySelector('.dialogo')`, 1200)) await clickTexto('.dialogo button', 'No guardar');
  await espera(`document.querySelector('.campo-imagen [data-accion="elegir-imagen"]')`);
  await click('.campo-imagen [data-accion="elegir-imagen"]');
  ok(await espera(`document.querySelector('.galeria .galeria-item[data-archivo="tokens/criaturas/lobo_gris.png"]') && document.querySelector('.galeria [data-carpeta="criaturas"]')`), 'Galería: muestra miniaturas y las subcarpetas (criaturas)');
  await foto('20-galeria');
  await click('.galeria [data-carpeta="criaturas"]');
  ok(await espera(`!document.querySelector('.galeria [data-archivo="tokens/aldeano.png"]') && document.querySelectorAll('.galeria .galeria-item').length===2`), 'Galería: elegir una carpeta muestra solo lo que tiene');
  await escribir('.galeria input[type=search]', 'lobo');
  ok(await espera(`document.querySelectorAll('.galeria .galeria-item').length===1`), 'Galería: el buscador filtra por nombre');
  await click('.galeria [data-archivo="tokens/criaturas/lobo_gris.png"]');
  ok(await espera(`!document.querySelector('.galeria') && window.__ed.E.pestanas.find(t=>t.clave==='enemigos/goblin')?.borrador.imagen==='tokens/criaturas/lobo_gris.png'`), 'Galería: al pulsar una imagen se elige y se cierra');
  ok(await js(`document.querySelector('.campo-imagen .miniatura img') && document.querySelector('.campo-imagen .imagen-nombre').textContent==='tokens/criaturas/lobo_gris.png'`), 'Galería: la ficha muestra la imagen elegida');
  ok(await js(`window.editor.crearCarpetaAssets('tokens', 'Pueblo / Tenderos').then(r=>r)`) === 'pueblo/tenderos' && fs.existsSync(path.join(BASE, 'tokens', 'pueblo', 'tenderos')), 'Galería: se pueden crear carpetas (con nombre limpio)');
  await js(`window.editor.crearCarpetaAssets('tokens', '../fuera').catch(()=>null)`);
  ok(!fs.existsSync(path.join(BASE, 'fuera')) && !fs.existsSync(path.join(camp, 'ejemplo', 'fuera')), 'Galería: una carpeta nunca sale de su categoría');

  // Exportar los archivos de la campaña como .zip para los jugadores
  {
    const destinoZip = path.join(require('os').tmpdir(), `ed-archivos-${process.pid}.zip`);
    require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinoZip });
    await click('[data-accion="exportar-archivos"]');
    ok(await espera(`document.querySelector('.toast')?.textContent.includes('Envíaselo a tus jugadores')`, 8000), 'Archivos: «Exportar archivos para los jugadores» crea el .zip');
    const { leerZip } = require(path.join(__dirname, '..', '..', '..', 'client', 'zip-lector.js'));
    const entradas = leerZip(fs.readFileSync(destinoZip));
    const nombres = entradas.map((e) => e.nombre);
    const manifiesto = JSON.parse(entradas.find((e) => e.nombre === 'mesa-campana.json').leer().toString());
    ok(manifiesto.campana === 'ejemplo' && nombres.includes('sonido/musica/taberna.wav') && nombres.includes('otros/cofre.png') && nombres.includes('tokens/criaturas/lobo_gris.png'),
      'Archivos: el .zip lleva la campaña, sus imágenes (con subcarpetas) y sus sonidos');
    fs.rmSync(destinoZip, { force: true });
  }

  // Diario: páginas que escribe el GM
  await js(`document.querySelector('.explorador [data-vista="diario"]').click()`);
  if (await espera(`document.querySelector('.dialogo')`, 1200)) await clickTexto('.dialogo button', 'No guardar');
  ok(await espera(`document.querySelector('.lista-cat .fila-recurso[data-clave="diario/armas"]') && document.querySelector('.lista-cat .fila-recurso[data-clave="diario/secreto_tabernero"]')?.textContent.includes('oculta')`), 'Diario: la lista muestra las páginas del ejemplo (y cuál está oculta)');
  await js(`window.__ed.abrir('diario', 'armas')`);
  ok(await espera(`document.querySelector('textarea[data-campo="texto"]')?.maxLength===20000 && document.querySelector('[data-campo="seccion"]')?.value==='Equipo'`), 'Diario: la página tiene texto largo y sección');

  // Una categoría nueva de «Razas, clases y orígenes» se llama «Nueva categoría» (y la siguiente, «Nueva categoría 2»)
  {
    const g1 = await js(`window.__ed.nuevo('grupos', {}, { abrir: false })`);
    const g2 = await js(`window.__ed.nuevo('grupos', {}, { abrir: false })`);
    ok(await js(`window.__ed.E.campana.recursos.grupos[${JSON.stringify(g1)}].nombre==='Nueva categoría' && window.__ed.E.campana.recursos.grupos[${JSON.stringify(g2)}].nombre==='Nueva categoría 2'`), 'Grupos: una categoría nueva se llama «Nueva categoría»');
    for (const g of [g1, g2]) await js(`window.__ed.eliminar('grupos', ${JSON.stringify(g)})`);
    await espera(`!window.__ed.E.campana.recursos.grupos[${JSON.stringify(g2)}]`);
  }
  // Grupos que dependen de otra elección e iniciativa por opción
  await js(`window.__ed.abrir('grupos', 'clase')`);
  ok(await espera(`document.querySelector('[data-accion="solo-si-grupo"]')?.value===''`), 'Grupo: «Solo aparece si…» empieza en «Siempre»');
  ok(await js(`![...document.querySelector('[data-accion="solo-si-grupo"]').options].some(o=>o.value==='clase')`), 'Grupo: no puede depender de sí mismo');
  await js(`(()=>{const s=document.querySelector('[data-accion="solo-si-grupo"]');s.value='raza';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`document.querySelector('[data-accion="solo-si-grupo"]').classList.contains('invalido') && document.querySelector('.solo-si [data-opcion="elfo"]')`), 'Grupo: al elegir otro grupo salen sus opciones (y avisa si no marcas ninguna)');
  await js(`document.querySelector('.solo-si [data-opcion="elfo"]').click()`);
  await js(`document.querySelector('[data-accion="guardar-pestana"]').click()`);
  ok(await espera(`(()=>{const p=window.__ed.E.pestanas.find(x=>x.cat==='grupos'&&x.id==='clase');return p&&JSON.stringify(p.borrador)===JSON.stringify(p.original)})()`), 'Grupo: se guarda');
  ok(/solo_si:[\s\S]*grupo: raza[\s\S]*- elfo/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'groups', 'clase.yaml'), 'utf8')), 'Grupo: «solo_si» queda en el YAML');
  await js(`(()=>{const s=document.querySelector('[data-accion="solo-si-grupo"]');s.value='';s.dispatchEvent(new Event('change'))})()`);
  await js(`document.querySelector('[data-accion="guardar-pestana"]').click()`);
  await espera(`(()=>{const p=window.__ed.E.pestanas.find(x=>x.cat==='grupos'&&x.id==='clase');return p&&JSON.stringify(p.borrador)===JSON.stringify(p.original)})()`);
  await esperar(300);
  ok(!/solo_si/.test(fs.readFileSync(path.join(camp, 'ejemplo', 'groups', 'clase.yaml'), 'utf8')), 'Grupo: volver a «Siempre» lo quita');
  await js(`window.__ed.abrir('opciones', 'mago')`);
  ok(await espera(`document.querySelector('[data-campo="iniciativa"]')?.value===''`), 'Opción: «Iniciativa con» empieza en la de la campaña');
  ok(await js(`(()=>{const s=document.querySelector('.campo-refs select[aria-label="Añadir una opción…"]');return s && [...s.options].slice(1).every(o=>window.__ed.E.campana.recursos.opciones[o.value].grupo==='clase') && ![...s.options].some(o=>o.value==='mago')})()`), 'Opción: «Puede evolucionar a» solo ofrece otras opciones del mismo grupo');
  ok(await js(`!!document.querySelector('.campo-imagen [data-campo="imagen_forma"]')`), 'Opción: tiene «Imagen del token con esta forma»');
  await js(`window.__ed.abrir('grupos', 'raza')`);
  if (await espera(`document.querySelector('.dialogo')`, 800)) await clickTexto('.dialogo button', 'No guardar');
  ok(await espera(`document.querySelector('select[data-campo="transformacion"]')?.value==='no'`), 'Grupo: «¿Se puede cambiar en plena partida?» empieza en «No»');

  // Ficha y nombres
  await js(`window.__ed.abrirReglas('ficha')`);
  if (await espera(`document.querySelector('.dialogo')`, 800)) await clickTexto('.dialogo button', 'No guardar');
  ok(await espera(`document.querySelector('[data-accion="nuevo-campo-ficha"]')`), 'Reglas: apartado «Ficha»');
  await click('[data-accion="nuevo-campo-ficha"]');
  await js(`(()=>{const s=document.querySelector('.fila-campo-ficha select[data-col="tipo"]');s.value='lista';s.dispatchEvent(new Event('change'))})()`);
  ok(await espera(`document.querySelector('.fila-campo-ficha input[data-col="opciones"]')`), 'Ficha: un campo de tipo lista pide sus opciones');
  await escribir('.fila-campo-ficha input[data-col="nombre"]', 'Alineamiento');
  await escribir('.fila-campo-ficha input[data-col="opciones"]', 'Bueno; Neutral; Malo');
  await js(`window.__ed.abrirReglas('mesa')`);
  ok(await espera(`document.querySelector('[data-nombre="habilidades"]') && document.querySelector('.orden-menu')`), 'Reglas: «Funciones de la mesa» trae los nombres y el orden del menú');
  await escribir('[data-nombre="habilidades"]', 'Hechizos');
  await js(`document.querySelector('[data-accion="guardar-pestana"]').click()`);
  await esperar(600);
  const cfgY = fs.readFileSync(path.join(camp, 'ejemplo', 'config.yaml'), 'utf8');
  ok(/campos_ficha:[\s\S]*Alineamiento[\s\S]*- Neutral/.test(cfgY) && require('yaml').parse(cfgY).juego?.nombres?.habilidades === 'Hechizos', 'Ficha: los campos y los nombres se guardan en config.yaml');
  ok(await espera(`[...document.querySelectorAll('.explorador .cat-item')].some(b=>b.textContent.includes('Hechizos'))`), 'Nombres: el explorador del Editor usa «Hechizos»');
  { const v = await js(`window.editor.validar('ejemplo')`); ok(v && v.ok, `Ficha: la campaña sigue siendo válida para el servidor ${v && !v.ok ? JSON.stringify(v.errores) : ''}`); }

  // Jugadores y fichas
  await js(`document.querySelector('[data-clave="jugadores"]').click()`);
  ok(await espera(`document.querySelector('[data-accion="nuevo-usuario"]')`), 'Jugadores: se abre la pantalla de usuarios y fichas');
  await click('[data-accion="nuevo-usuario"]');
  await escribir('.dialogo input[aria-label="Nombre de usuario"]', 'Luz Ñ');
  await escribir('.dialogo input[aria-label="Contraseña (opcional)"]', 'secreto1');
  await click('.dialogo .btn-acento');
  ok(await espera(`document.querySelector('[data-usuario="Luz Ñ"]')`), 'Jugadores: el usuario nuevo aparece');
  ok(/hash: scrypt\$/.test(fs.readFileSync('/tmp/ed-datos/ejemplo/cuentas.yaml', 'utf8')), 'Jugadores: la contraseña se guarda cifrada');
  await js(`(()=>{const s=document.querySelector('[data-usuario="Luz Ñ"] [data-accion="ataque"]');s.value='nadie';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  ok(await (async () => { for (let i = 0; i < 30; i++) { if (/ataque: nadie/.test(fs.readFileSync('/tmp/ed-datos/ejemplo/cuentas.yaml', 'utf8'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })(), 'Jugadores: se puede limitar a quién ataca un jugador');
  await js(`(()=>{const c=document.querySelector('[data-usuario="Luz Ñ"] [data-accion="bloqueo-editar"]');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  ok(await (async () => { for (let i = 0; i < 30; i++) { if (/editar: false/.test(fs.readFileSync('/tmp/ed-datos/ejemplo/cuentas.yaml', 'utf8'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })(), 'Jugadores: se puede bloquear la edición de un jugador');
  await click('[data-usuario="Luz Ñ"] [data-accion="nueva-ficha"]');
  ok(await espera(`document.querySelector('[data-grupo="clase"]')`), 'Ficha: aparece el formulario con raza y clase');
  await escribir('[data-grupo="raza"]', 'humano');
  await escribir('[data-grupo="clase"]', 'berserker');
  ok(await espera(`document.querySelector('[data-stat="Vigor"]').value==='14' && document.querySelector('[data-recurso-max="Furia"]')`), 'Ficha: elegir Berserker pone Vigor 14 y le da Furia');
  ok(await js(`document.querySelector('[data-campo="puntos"]').value==='8'`), 'Ficha: la clase suma sus puntos extra (5 + 3)');
  await escribir('.jug-form input[aria-label="Nombre del personaje"], .jug-form [data-campo="nombre"] input, .jug-form input[type=text]', 'Brutus');
  await foto('07-ficha');
  await click('[data-accion="guardar-ficha"]');
  ok(await espera(`document.querySelector('[data-ficha="Brutus"]')`), 'Ficha: se guarda y aparece en la lista del usuario');
  const fj = fs.readFileSync('/tmp/ed-datos/ejemplo/jugadores/luz_ñ.yaml', 'utf8');
  ok(/nombre: Brutus/.test(fj) && /Furia/.test(fj) && /dueno: Luz Ñ/.test(fj), 'Ficha: el archivo del jugador tiene la ficha asociada a su nickname');
  // Una segunda ficha (una mascota es, simplemente, otro personaje del jugador)
  await click('[data-usuario="Luz Ñ"] [data-accion="nueva-ficha"]');
  await espera(`document.querySelector('[data-grupo="raza"]')`);
  await escribir('[data-grupo="raza"]', 'humano');
  await escribir('[data-grupo="clase"]', 'berserker');
  await escribir('.jug-form input[type=text]', 'Lobito');
  await click('[data-accion="guardar-ficha"]');
  ok(await espera(`document.querySelector('[data-ficha="Lobito"]')`) && !/companero_de/.test(fs.readFileSync('/tmp/ed-datos/ejemplo/jugadores/luz_ñ.yaml', 'utf8')), 'Ficha: un usuario puede tener varias fichas (mascota incluida)');
  fs.writeFileSync('/tmp/ed-datos/ejemplo/servidor.pid', String(process.pid));
  await click('[data-accion="actualizar"], .jug-barra .btn:not(.btn-acento)');
  ok(await espera(`document.querySelector('.jug-aviso') && document.querySelector('[data-accion="nuevo-usuario"]').disabled`), 'Jugadores: con el servidor abierto solo se puede mirar');
  fs.unlinkSync('/tmp/ed-datos/ejemplo/servidor.pid');
  await foto('07b-jugadores');

  // Campaña nueva vacía
  const id = await js(`window.editor.crearCampana('Prueba Vacía','vacia')`);
  ok(id === 'prueba_vacia' || /prueba/.test(id), 'Crear campaña vacía devuelve id: ' + id);
  ok(fs.existsSync(path.join(camp, id, 'base', 'icons', 'habilidades', 'fuego.png')), 'Una campaña nueva trae los iconos de habilidades del programa');
  await js(`window.editor.cargar(${JSON.stringify(id)}).then(c=>0)`);
  const v = await js(`window.editor.validar(${JSON.stringify(id)})`);
  ok(v && v.errores.length === 0, 'Campaña vacía valida: ' + JSON.stringify(v));

  // Importar una campaña que ya tienes: avisa y deja importarla como copia o reemplazar la tuya
  {
    await js(`window.__ed.abrirCampana('ejemplo')`);
    await espera(`window.__ed.E.campana?.id==='ejemplo'`);
    const archivo = path.join(require('os').tmpdir(), `ed-campana-${process.pid}.mesa-campana`);
    require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: archivo });
    require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archivo] });
    await js(`window.editor.exportarCampana('ejemplo')`);
    const abrirMenuImportar = async () => {
      await click('[aria-label="Más acciones de campaña"]');
      await clickTexto('.menu-flotante .menu-item', 'Importar una campaña desde un archivo');
    };
    await abrirMenuImportar();
    ok(await espera(`document.querySelector('.dialogo h2')?.textContent==='Ya tienes esta campaña' && document.querySelector('.conflicto-datos')`), 'Importar: si ya tienes la campaña, avisa en vez de crear otra');
    await foto('importar-conflicto');
    const antes = fs.readdirSync(camp).filter((d) => !d.startsWith('_')).length;
    await clickTexto('.dialogo button', 'Importar como copia');
    if (await espera(`document.querySelector('.dialogo h2')?.textContent==='Hay cambios sin guardar'`, 1500)) await clickTexto('.dialogo button', 'No guardar');
    ok(await espera(`window.__ed.E.campana && window.__ed.E.campana.id!=='ejemplo'`) && fs.readdirSync(camp).filter((d) => !d.startsWith('_')).length === antes + 1, 'Importar: «Importar como copia» crea otra campaña');
    const copia = await js(`window.__ed.E.campana.id`);
    // Reemplazar: cambia la del Editor por la del archivo, conservando contraseñas y partida
    await js(`window.__ed.abrirCampana('ejemplo')`);
    await espera(`window.__ed.E.campana?.id==='ejemplo'`);
    fs.writeFileSync(path.join(camp, 'ejemplo', 'enemies', 'solo_aqui.yaml'), 'nombre: Solo aquí\n');
    const cfgE = path.join(camp, 'ejemplo', 'config.yaml');
    fs.writeFileSync(cfgE, fs.readFileSync(cfgE, 'utf8').replace(/password_gm: .*/, 'password_gm: "clave-propia"'));
    await abrirMenuImportar();
    await espera(`document.querySelector('.dialogo h2')?.textContent==='Ya tienes esta campaña'`);
    await clickTexto('.dialogo button', 'Reemplazar la campaña');
    if (await espera(`document.querySelector('.dialogo h2')?.textContent==='Hay cambios sin guardar'`, 1500)) await clickTexto('.dialogo button', 'No guardar');
    ok(await espera(`document.querySelector('.toast')?.textContent.includes('Campaña reemplazada')`, 8000), 'Importar: «Reemplazar» avisa de lo que hizo');
    ok(!fs.existsSync(path.join(camp, 'ejemplo', 'enemies', 'solo_aqui.yaml')) && /password_gm: "?clave-propia/.test(fs.readFileSync(cfgE, 'utf8')), 'Importar: reemplazar pone la del archivo y conserva la contraseña de GM');
    ok(fs.readdirSync(path.join(camp, '_papelera')).some((d) => d.startsWith('ejemplo-reemplazada') && fs.existsSync(path.join(camp, '_papelera', d, 'enemies', 'solo_aqui.yaml'))), 'Importar: la versión anterior queda entera en la papelera');
    ok(await js(`window.__ed.E.campana?.id==='ejemplo' && !window.__ed.E.campana.recursos.enemigos.solo_aqui`), 'Importar: el Editor muestra la campaña reemplazada');
    await js(`window.editor.borrarCampana(${JSON.stringify(copia)})`);
    fs.rmSync(archivo, { force: true });
  }

  console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
  app.exit(fallos ? 1 : 0);
}
app.whenReady().then(() => principal().catch((e) => { console.log('ERROR', e.stack); app.exit(2); }));
