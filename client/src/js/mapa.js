// mapa.js — El mapa: dibuja el tablero de casillas, la cuadrícula, objetos y tokens en un <canvas>,
// y gestiona zoom, desplazamiento, herramientas (cursor, mano, regla) y arrastre de tokens.
// Solo lee el estado (S); cuando el jugador hace algo, avisa mediante los callbacks `cb`.

import { S, esMio, vidaDe, tileEn, bandoDe, objetoCubre, textoMedida, rompibleEn } from './almacen.js';
import { ajustes } from './ajustes.js';
import { imagen } from './imagenes.js';
import { h, clamp, inicial, escribiendo } from './util.js';


/** Recorta un texto con «…» para que no pase de `ancho` píxeles con la fuente actual del lienzo (con memoria: se dibuja muchas veces). */
// Barras de recursos sobre los tokens: la vida va en verde/ámbar/rojo según lo que quede; las demás, con estos colores.
const COLORES_BARRA = ['#7bc47f', '#4f8fd1', '#b07ad9', '#e0b04a'];
/** Qué barras dibujar: las que la campaña pone sobre los tokens, menos las que este jugador apagó (y, si así lo quiere, solo en los suyos). */
function barrasVisibles(mio) {
  const todas = S.catalogo?.sobre_tokens?.barras || (S.catalogo?.recurso_vida ? [S.catalogo.recurso_vida] : []);
  if (!mio && ajustes.barrasAjenas === false) return [];
  return todas.filter((r) => ajustes.barras?.[r] !== false);
}

const _recortes = new Map();
function recortarTexto(ctx, texto, ancho) {
  const clave = `${ctx.font}|${Math.round(ancho)}|${texto}`;
  let r = _recortes.get(clave);
  if (r !== undefined) return r;
  r = texto;
  if (ctx.measureText(texto).width > ancho) {
    let lo = 0, hi = texto.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(`${texto.slice(0, m)}…`).width <= ancho) lo = m; else hi = m - 1; }
    r = `${[...texto.slice(0, lo)].join('').trimEnd()}…`;
  }
  if (_recortes.size > 2000) _recortes.clear();
  _recortes.set(clave, r);
  return r;
}

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 3;

const COLOR = {
  fondo: '#0d1214',
  suelo: '#4a5361',
  propio: '#6fb7a8',
  aliado: '#4f8fd1',
  neutral: '#d6b04a',
  enemigo: '#c4533f',
  turno: '#f0b44c',
  tinta: '#12161d',
};
const FUENTE_TITULO = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
const FUENTE_UI = '"Segoe UI", system-ui, sans-serif';

const redondear = (v) => Math.floor(Math.abs(v) + 0.5) * (v >= 0 ? 1 : -1);
/** Casillas de un área (copia de EstadoPartida.celdas_area en el servidor). */
export function celdasArea(origen, px, py, area, alcance, sinLimite, ancho, alto) {
  const dentro = (x, y) => x >= 0 && y >= 0 && x < ancho && y < alto;
  const tam = area.tamano || 1, res = [];
  if (area.forma === 'explosion') {
    for (let y = py - tam; y <= py + tam; y++) for (let x = px - tam; x <= px + tam; x++) if (dentro(x, y)) res.push([x, y]);
    return res;
  }
  const dx = px - origen.x, dy = py - origen.y, n = Math.max(Math.abs(dx), Math.abs(dy));
  if (!n) return [];
  if (area.forma === 'linea') {
    const largo = sinLimite ? ancho + alto : alcance;
    for (let k = 1; k <= largo; k++) {
      const x = origen.x + redondear((k * dx) / n), y = origen.y + redondear((k * dy) / n);
      if (!dentro(x, y)) break;
      res.push([x, y]);
    }
    return res;
  }
  if (area.forma === 'cono' || area.forma === 'casillas') {
    const [fx, fy] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    const rx = -fy, ry = fx, vistas = new Set();
    const rel = [];
    if (area.forma === 'cono') { for (let k = 1; k <= tam; k++) for (let l = -(k - 1); l < k; l++) rel.push([k, l]); } else rel.push(...(area.casillas || []));
    for (const [f, l] of rel) {
      const x = origen.x + f * fx + l * rx, y = origen.y + f * fy + l * ry;
      if (dentro(x, y) && !vistas.has(`${x},${y}`)) { vistas.add(`${x},${y}`); res.push([x, y]); }
    }
    return res;
  }
  if (area.forma === 'frente') {
    const sx = Math.sign(dx), sy = Math.sign(dy), qx = -sy, qy = sx, mitad = Math.floor(tam / 2);
    for (let k = -mitad; k < tam - mitad; k++) if (dentro(px + k * qx, py + k * qy)) res.push([px + k * qx, py + k * qy]);
    return res;
  }
  return [[px, py]];
}

const ICONO_ENLACE = Object.assign(new Image(), { src: 'img/interfaz/enlace.png' });
// El lápiz en pixel art (img/interfaz/lapiz.png, punta abajo a la izquierda): de cursor al dibujar y junto al nombre de quien dibuja.
const ICONO_LAPIZ = Object.assign(new Image(), { src: 'img/interfaz/lapiz.png' });
let CURSOR_LAPIZ = 'url("img/interfaz/lapiz.png") 1 14, crosshair';
ICONO_LAPIZ.addEventListener('load', () => {          // a 32 px (al doble, sin suavizar) se ve mejor como cursor
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(ICONO_LAPIZ, 0, 0, 32, 32);
    CURSOR_LAPIZ = `url("${c.toDataURL('image/png')}") 2 29, crosshair`;
  } catch { /* se queda el de 16 px */ }
}, { once: true });

export class VistaMapa {
  /**
   * cb: { puedeMover(token), alSeleccionar(id|null), alMover(id,x,y), alObjetivo(id),
   *       alColocar(x,y), alHover(token|null, clientX, clientY), alZoom(z),
   *       alMenu({cx,cy,token,x,y}) }
   */
  constructor(contenedor, cb) {
    this.cb = cb;
    this.contenedor = contenedor;
    this.cam = { x: 40, y: 40, zoom: 1 };
    this.herramienta = 'cursor';
    this.ancho = 1;
    this.alto = 1;
    this.dpr = 1;
    this.sucio = true;
    this.vivo = true;
    this.hover = null;          // {cx, cy}
    this.arrastre = null;       // token que se está moviendo
    this.regla = null;          // medición en curso {puntos:[…], fin:{…}}
    this.reglaDerecho = false;  // el clic derecho de este gesto ya se contó
    this.posiciones = new Map();   // última casilla conocida de cada token y su animación al cambiar de casilla
    this.temporales = [];       // dibujos temporales sobre el mapa (la regla es uno; luego, pings, etc.)
    this.trazo = null;          // trazo que se está dibujando con el lápiz {puntos:[[x,y]…]}
    this.reglaEnviada = false;  // ¿ya se avisó a los demás de mi regla?
    this.ultimoEnvioRegla = 0;
    this.paneo = null;
    this.espacio = false;
    this.modoObjetivo = null;   // {origen: token, alcance}
    this.modoColocar = false;
    this.ultimoCuadro = 0;
    this.reducirMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.canvas = h('canvas', { class: 'mapa-canvas', tabindex: '-1' });
    contenedor.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(contenedor);
    this.registrarEventos();
    this.bucle = this.bucle.bind(this);
    requestAnimationFrame(this.bucle);
  }

  destruir() {
    this.vivo = false;
    this.ro.disconnect();
    window.removeEventListener('keydown', this.alTeclaAbajo);
    window.removeEventListener('keyup', this.alTeclaArriba);
    this.canvas.remove();
  }

  marcar() { this.sucio = true; }

  // ── Geometría ────────────────────────────────────────────────
  get T() { return S.mapa ? S.mapa.tamano_tile : 64; }

  aMundo(px, py) { return { x: (px - this.cam.x) / this.cam.zoom, y: (py - this.cam.y) / this.cam.zoom }; }

  casilla(px, py) {
    const w = this.aMundo(px, py);
    return { cx: Math.floor(w.x / this.T), cy: Math.floor(w.y / this.T) };
  }

  dentro(cx, cy) { return !!S.mapa && cx >= 0 && cy >= 0 && cx < S.mapa.ancho && cy < S.mapa.alto; }

  tokenEn(cx, cy, ignorar = null) {
    for (const t of S.tokens.values()) if (t.x === cx && t.y === cy && t.id !== ignorar) return t;
    return null;
  }

  /** Aproximación para pintar el destino en verde/rojo; la decisión real la toma el servidor. */
  casillaLibre(cx, cy, ignorar) {
    const m = S.mapa;
    if (!this.dentro(cx, cy)) return false;
    if (tileEn(cx, cy)?.transitable === false) return false;
    if (m.objetos.some((o) => o.bloquea && objetoCubre(o, cx, cy))) return false;
    const otro = this.tokenEn(cx, cy, ignorar);
    const yo = ignorar && S.tokens.get(ignorar);
    return !otro || (!!yo?.grupo && otro.grupo === yo.grupo && !S.combate.activo);     // los de su grupo se apartan a la vez
  }

  /** Casillas a las que se llega andando desde (x, y): sin atravesar muros ni lados cerrados (vallas…). Igual que en el servidor. */
  /** `limite`: en combate con movimiento limitado, solo hasta las casillas que le quedan (andando, sin diagonales). */
  alcanzables(x, y, limite = Infinity) {
    const LADOS = { norte: [0, -1, 'sur'], sur: [0, 1, 'norte'], este: [1, 0, 'oeste'], oeste: [-1, 0, 'este'] };
    const pisable = (cx, cy) => this.dentro(cx, cy) && tileEn(cx, cy)?.transitable !== false && !S.mapa.objetos.some((o) => o.bloquea && objetoCubre(o, cx, cy));
    const vistos = new Set([`${x},${y}`]);
    const pasos = new Map([[`${x},${y}`, 0]]);
    const cola = [[x, y]];
    while (cola.length) {
      const [cx, cy] = cola.shift();
      const p = pasos.get(`${cx},${cy}`);
      if (p >= limite) continue;
      const a = tileEn(cx, cy);
      for (const [lado, [dx, dy, opuesto]] of Object.entries(LADOS)) {
        const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
        if (vistos.has(k) || !pisable(nx, ny) || a?.bloquea_lados?.includes(lado) || tileEn(nx, ny)?.bloquea_lados?.includes(opuesto)) continue;
        vistos.add(k);
        pasos.set(k, p + 1);
        cola.push([nx, ny]);
      }
    }
    return vistos;
  }

  // ── Cámara ───────────────────────────────────────────────────
  redimensionar() {
    const r = this.contenedor.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.ancho = Math.max(1, Math.round(r.width));
    this.alto = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.ancho * this.dpr);
    this.canvas.height = Math.round(this.alto * this.dpr);
    this.marcar();
  }

  zoomEn(nuevo, px, py) {
    const z = clamp(nuevo, ZOOM_MIN, ZOOM_MAX);
    const k = z / this.cam.zoom;
    this.cam.x = px - (px - this.cam.x) * k;
    this.cam.y = py - (py - this.cam.y) * k;
    this.cam.zoom = z;
    this.cb.alZoom?.(z);
    this.marcar();
  }

  zoomCentro(nuevo) { this.zoomEn(nuevo, this.ancho / 2, this.alto / 2); }

  ajustar() {
    const m = S.mapa;
    if (!m) return;
    const w = m.ancho * m.tamano_tile;
    const hh = m.alto * m.tamano_tile;
    const z = clamp(Math.min(this.ancho / w, this.alto / hh) * 0.92, ZOOM_MIN, 1.5);
    this.cam.zoom = z;
    this.cam.x = (this.ancho - w * z) / 2;
    this.cam.y = (this.alto - hh * z) / 2;
    this.cb.alZoom?.(z);
    this.marcar();
  }

  setHerramienta(nombre) {
    this.herramienta = nombre;
    this.terminarRegla();
    this.trazo = null;
    this.actualizarCursor();
    this.marcar();
  }

  setModoObjetivo(modo) { this.modoObjetivo = modo; this.actualizarCursor(); this.marcar(); }
  setModoColocar(v) { this.modoColocar = v; this.actualizarCursor(); this.marcar(); }

  actualizarCursor() {
    let c = 'default';
    if (this.paneo || this.herramienta === 'mano' || this.espacio) c = this.paneo ? 'grabbing' : 'grab';
    else if (this.modoObjetivo || this.modoColocar || this.herramienta === 'regla') c = 'crosshair';
    else if (this.herramienta === 'lapiz') c = this.borrador ? 'cell' : this.cb.puedeDibujar?.() ? CURSOR_LAPIZ : 'not-allowed';
    else if (this.arrastre) c = 'grabbing';
    else if (this.hover) {
      const t = this.tokenEn(this.hover.cx, this.hover.cy);
      if (t) c = this.cb.puedeMover?.(t) ? 'grab' : 'pointer';
    }
    this.canvas.style.cursor = c;
  }

  // ── Entrada ──────────────────────────────────────────────────
  posicion(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  registrarEventos() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.alBajar(e));
    // Soltar aquí un personaje arrastrado desde el panel lateral: se despliega en esa casilla
    c.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-mesa-personaje')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const p = this.posicion(e); const k = this.casilla(p.x, p.y); this.hover = this.dentro(k.cx, k.cy) ? k : null; this.marcar(); } });
    c.addEventListener('drop', (e) => {
      const datos = e.dataTransfer.getData('application/x-mesa-personaje');
      if (!datos) return;
      e.preventDefault();
      const p = this.posicion(e); const { cx, cy } = this.casilla(p.x, p.y);
      try { const d = JSON.parse(datos); if (this.dentro(cx, cy)) this.cb.alSoltarPersonaje?.(d.personaje, d.usuario, cx, cy); } catch { /* datos ajenos */ }
    });
    c.addEventListener('pointermove', (e) => this.alMover(e));
    c.addEventListener('pointerup', (e) => this.alSubir(e));
    c.addEventListener('pointercancel', (e) => this.alSubir(e));
    // Con el botón izquierdo pulsado, algunos sistemas avisan del clic derecho solo con estos eventos de ratón.
    c.addEventListener('mousedown', (e) => { if (e.button === 2) this.agregarPuntoRegla(); });
    c.addEventListener('mouseup', (e) => { if (e.button === 2) this.reglaDerecho = false; });
    c.addEventListener('pointerleave', () => {
      if (this.arrastre || this.paneo) return;
      this.hover = null;
      this.cb.alHover?.(null);
      this.marcar();
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Con el cursor, el clic derecho abre el menú contextual. Con la regla suma un punto de giro (ya gestionado arriba).
      if (this.herramienta !== 'cursor' || this.modoObjetivo || this.modoColocar || this.arrastre || this.regla || this.espacio) return;
      const p = this.posicion(e);
      const { cx, cy } = this.casilla(p.x, p.y);
      if (!this.dentro(cx, cy)) return;
      this.cb.alMenu?.({ cx, cy, token: this.tokenEn(cx, cy), x: e.clientX, y: e.clientY });
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.posicion(e);
      this.zoomEn(this.cam.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });

    this.alTeclaAbajo = (e) => {
      if (e.code === 'Space' && !escribiendo(e) && !this.espacio) {
        this.espacio = true;
        this.actualizarCursor();
        if (e.target === document.body) e.preventDefault();
      }
    };
    this.alTeclaArriba = (e) => {
      if (e.code === 'Space' && this.espacio) { this.espacio = false; this.actualizarCursor(); }
    };
    window.addEventListener('keydown', this.alTeclaAbajo);
    window.addEventListener('keyup', this.alTeclaArriba);
  }

  alBajar(e) {
    if (e.button === 2) { this.agregarPuntoRegla(); return; }
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* sin captura: el arrastre sigue funcionando dentro del lienzo */ }
    const p = this.posicion(e);

    if (e.button === 1 || this.herramienta === 'mano' || this.espacio) {
      this.paneo = { px: p.x, py: p.y, x: this.cam.x, y: this.cam.y };
      this.actualizarCursor();
      return;
    }
    if (e.button !== 0) return;

    const { cx, cy } = this.casilla(p.x, p.y);
    if (e.altKey) { if (this.dentro(cx, cy)) this.cb.alPing?.(cx, cy); return; }       // Alt + clic: señalar una casilla
    if (this.modoColocar) { if (this.dentro(cx, cy)) this.cb.alColocar?.(cx, cy); return; }
    if (this.modoObjetivo) {
      const t = this.tokenEn(cx, cy);
      if (t) this.cb.alObjetivo?.(t.id);
      // con área se puede apuntar a una casilla vacía; un ataque también puede apuntar a un tile u objeto que se rompe
      else if (this.dentro(cx, cy) && (this.modoObjetivo.area || (this.modoObjetivo.dano && rompibleEn(cx, cy)))) this.cb.alCasillaObjetivo?.(cx, cy);
      return;
    }

    if (this.herramienta === 'lapiz') {
      if (this.borrador) { this.borrando = { ultimo: null, pendiente: [], t: 0 }; this.borrarEn(p); }      // borrador: quita solo el trozo que toca (de los suyos; el GM, de todos)
      else if (this.cb.puedeDibujar?.()) { const w = this.aMundo(p.x, p.y); this.trazo = { puntos: [[w.x / this.T, w.y / this.T]] }; }
      this.marcar();
      return;
    }
    if (this.herramienta === 'regla') {
      if (this.dentro(cx, cy)) {
        this.terminarRegla();
        this.regla = { puntos: [{ cx, cy }], fin: { cx, cy } };
        this.dibujoRegla = this.agregarTemporal({ dibujar: (T, z) => this.dibujarRegla(T, z) });
        this.enviarRegla(true);
      }
      this.marcar();
      return;
    }

    const t = this.tokenEn(cx, cy);
    this.cb.alSeleccionar?.(t ? t.id : null);
    if (t && this.cb.puedeMover?.(t)) {
      this.arrastre = { id: t.id, desde: { cx, cy }, hasta: { cx, cy }, mundo: this.aMundo(p.x, p.y), inicio: p, movido: false };
      this.actualizarCursor();
    }
    this.marcar();
  }

  alMover(e) {
    const p = this.posicion(e);
    this.hoverMundo = this.aMundo(p.x, p.y);      // siempre, también al arrastrar (si no, el círculo del borrador se queda quieto mientras borras)
    if (this.regla) { if (e.buttons & 2) this.agregarPuntoRegla(); else this.reglaDerecho = false; }
    if (this.borrando) { this.borrarEn(p); this.marcar(); return; }
    if (this.trazo) {
      const w = this.aMundo(p.x, p.y), T = this.T;
      const u = this.trazo.puntos[this.trazo.puntos.length - 1];
      if (Math.hypot(w.x / T - u[0], w.y / T - u[1]) > 0.08 && this.trazo.puntos.length < 300) this.trazo.puntos.push([w.x / T, w.y / T]);
      const ahora = performance.now();
      if (!this.ultimoLapiz || ahora - this.ultimoLapiz > 80) { this.ultimoLapiz = ahora; this.cb.alLapiz?.(w.x / T, w.y / T); }    // los demás ven el lápiz con mi nombre
      this.marcar();
      return;
    }
    if (this.herramienta === 'lapiz' && this.borrador) this.marcar();      // el círculo del borrador sigue al ratón
    if (this.paneo) {
      this.cam.x = this.paneo.x + (p.x - this.paneo.px);
      this.cam.y = this.paneo.y + (p.y - this.paneo.py);
      this.marcar();
      return;
    }
    const { cx, cy } = this.casilla(p.x, p.y);
    this.hoverMundo = this.aMundo(p.x, p.y);
    const antes = this.hover;
    this.hover = this.dentro(cx, cy) ? { cx, cy } : null;
    if (this.modoObjetivo?.area && (antes?.cx !== this.hover?.cx || antes?.cy !== this.hover?.cy)) this.marcar();     // el área sigue al ratón

    if (this.arrastre) {
      const a = this.arrastre;
      if (Math.hypot(p.x - a.inicio.x, p.y - a.inicio.y) > 4) a.movido = true;
      a.mundo = this.aMundo(p.x, p.y);
      a.hasta = { cx, cy };
    } else if (this.regla) {
      this.regla.fin = { cx: clamp(cx, 0, S.mapa.ancho - 1), cy: clamp(cy, 0, S.mapa.alto - 1) };
      this.enviarRegla();
    } else {
      this.cb.alHover?.(this.hover ? this.tokenEn(cx, cy) : null, e.clientX, e.clientY);
      this.actualizarCursor();
    }
    this.marcar();
  }

  alSubir(e) {
    if (e.button === 2) { this.reglaDerecho = false; return; }      // soltar el derecho no termina la medición
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.arrastre) {
      const a = this.arrastre;
      if (a.movido && this.dentro(a.hasta.cx, a.hasta.cy) && (a.hasta.cx !== a.desde.cx || a.hasta.cy !== a.desde.cy)) {
        this.posiciones.set(a.id, { x: a.hasta.cx, y: a.hasta.cy });      // ya se ve donde lo soltó: sin animación de vuelta
        this.cb.alMover?.(a.id, a.hasta.cx, a.hasta.cy);
      }
      this.arrastre = null;
    }
    if (this.borrando) {
      this.enviarBorrado(true);
      this.borrando = null;
    }
    if (this.trazo) {
      const puntos = this.trazo.puntos.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      this.trazo = null;
      this.cb.alLapiz?.(null);
      if (puntos.length === 1) puntos.push([puntos[0][0] + 0.02, puntos[0][1]]);     // un toque deja un punto
      this.cb.alDibujar?.(puntos);
    }
    this.terminarRegla();  // la línea de medición nunca permanece en el mapa
    this.paneo = null;
    this.actualizarCursor();
    this.marcar();
  }

  // ── Dibujo ───────────────────────────────────────────────────
  bucle(ts) {
    if (!this.vivo) return;
    const animar = (S.combate.activo && S.combate.turno_de && !this.reducirMovimiento) || this.temporales.some((t) => t.expira);
    if (this.sucio || (animar && ts - this.ultimoCuadro > 50)) {
      this.sucio = false;
      this.ultimoCuadro = ts;
      this.dibujar(ts);
    }
    requestAnimationFrame(this.bucle);
  }

  dibujar(ts) {
    const { ctx, dpr, cam } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOR.fondo;
    ctx.fillRect(0, 0, this.ancho, this.alto);
    const m = S.mapa;
    if (!m) return;

    const T = m.tamano_tile;
    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * cam.x, dpr * cam.y);
    const x0 = clamp(Math.floor(-cam.x / z / T), 0, m.ancho);
    const x1 = clamp(Math.ceil((this.ancho - cam.x) / z / T), 0, m.ancho);
    const y0 = clamp(Math.floor(-cam.y / z / T), 0, m.alto);
    const y1 = clamp(Math.ceil((this.alto - cam.y) / z / T), 0, m.alto);

    this.dibujarTablero(m, T, z, x0, x1, y0, y1);
    if (ajustes.cuadricula) this.dibujarCuadricula(T, z, x0, x1, y0, y1);
    this.dibujarCapa(m.capa2, 2, T, z, x0, x1, y0, y1);
    this.dibujarObjetos(m, T);
    this.dibujarRango(m, T, x0, x1, y0, y1);
    this.dibujarResaltes(T, z);
    this.dibujarPuntos(m, T, z);

    const tokens = [...S.tokens.values()].sort((a, b) => a.y - b.y);
    for (const t of tokens) {
      const arrastrando = this.arrastre && this.arrastre.id === t.id && this.arrastre.movido;
      const p = this.posicionAnimada(t, T);
      this.dibujarToken(t, T, z, ts, arrastrando ? 0.3 : 1, p?.x ?? null, p?.y ?? null);
    }
    if (this.arrastre?.movido) {
      const t = S.tokens.get(this.arrastre.id);
      if (t) this.dibujarToken(t, T, z, ts, 0.85, this.arrastre.mundo.x - T / 2, this.arrastre.mundo.y - T / 2);
    }
    this.dibujarCapa(m.capa3, 3, T, z, x0, x1, y0, y1);
    this.dibujarMomento(m, T);
    this.dibujarClima(m, T);
    this.dibujarNiebla(T, z, x0, x1, y0, y1);
    this.dibujarTrazos(T, z);
    this.dibujarReglasAjenas(T, z);
    this.dibujarTemporales(T, z, ts);
  }

  dibujarTablero(m, T, z, x0, x1, y0, y1) {
    const ctx = this.ctx;
    const fondo = imagen(m.fondo);
    if (fondo) {
      const a = m.fondo_ajuste;                // posición y tamaño de la imagen en casillas (lo ajusta el GM en el Editor)
      if (a) {                                 // lo que sobresale del mapa no se dibuja
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, m.ancho * T, m.alto * T); ctx.clip();
        ctx.drawImage(fondo, a.x * T, a.y * T, a.ancho * T, a.alto * T);
        ctx.restore();
      } else ctx.drawImage(fondo, 0, 0, m.ancho * T, m.alto * T);
    }
    const sobra = 0.6 / z;       // evita rendijas entre casillas con zoom fraccionario
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = tileEn(x, y);
        if (!tile) {
          if (!fondo) { ctx.fillStyle = COLOR.suelo; ctx.fillRect(x * T, y * T, T + sobra, T + sobra); }
          continue;
        }
        if (tile.invisible) continue;              // invisible: solo actúa, no se dibuja
        const img = tile.imagen ? imagen(tile.imagen) : null;
        if (img) { ctx.drawImage(img, x * T, y * T, T + sobra, T + sobra); continue; }
        if (!tile.color) continue;                 // tile «sin gráficos»: solo actúa, no se dibuja
        ctx.globalAlpha = fondo ? 0.6 : 1;         // sobre una imagen de fondo, el color deja verla
        ctx.fillStyle = tile.color;
        ctx.fillRect(x * T, y * T, T + sobra, T + sobra);
        ctx.globalAlpha = 1;
      }
    }
    // Lados cerrados (vallas, mostradores…) de los tiles sin imagen: una línea gruesa en ese borde.
    ctx.lineWidth = Math.max(T * 0.09, 2 / z);
    ctx.strokeStyle = '#5a3d22';
    ctx.lineCap = 'round';
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const lados = tileEn(x, y);
        if (!lados?.bloquea_lados?.length || lados.imagen) continue;
        ctx.beginPath();
        const i = T * 0.06;
        for (const l of lados.bloquea_lados) {
          if (l === 'norte') { ctx.moveTo(x * T + i, y * T + i); ctx.lineTo((x + 1) * T - i, y * T + i); }
          if (l === 'sur') { ctx.moveTo(x * T + i, (y + 1) * T - i); ctx.lineTo((x + 1) * T - i, (y + 1) * T - i); }
          if (l === 'oeste') { ctx.moveTo(x * T + i, y * T + i); ctx.lineTo(x * T + i, (y + 1) * T - i); }
          if (l === 'este') { ctx.moveTo((x + 1) * T - i, y * T + i); ctx.lineTo((x + 1) * T - i, (y + 1) * T - i); }
        }
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.lineWidth = 3 / z;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeRect(0, 0, m.ancho * T, m.alto * T);
  }

  /** Capas de detalle (solo decoración). Si el GM oculta una, los jugadores no la ven y el GM la ve tenue. */
  dibujarCapa(rejilla, numero, T, z, x0, x1, y0, y1) {
    if (!rejilla) return;
    const oculta = S.capasOcultas.includes(numero);
    if (oculta && !S.esGM) return;
    const ctx = this.ctx, sobra = 0.6 / z;
    ctx.save();
    ctx.globalAlpha = oculta ? 0.3 : 1;
    for (let y = y0; y < y1; y++) {
      const fila = rejilla[y];
      if (!fila) continue;
      for (let x = x0; x < x1; x++) {
        const tile = fila[x] ? S.catalogo?.tiles?.[fila[x]] : null;
        if (!tile) continue;
        if (tile.invisible) continue;              // invisible: solo actúa, no se dibuja
        const img = tile.imagen ? imagen(tile.imagen) : null;
        if (img) { ctx.drawImage(img, x * T, y * T, T + sobra, T + sobra); continue; }
        if (!tile.color) continue;
        ctx.fillStyle = tile.color;
        ctx.fillRect(x * T, y * T, T + sobra, T + sobra);
      }
    }
    ctx.restore();
  }

  dibujarCuadricula(T, z, x0, x1, y0, y1) {
    const ctx = this.ctx;
    if (z < 0.3) return;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { ctx.moveTo(x * T, y0 * T); ctx.lineTo(x * T, y1 * T); }
    for (let y = y0; y <= y1; y++) { ctx.moveTo(x0 * T, y * T); ctx.lineTo(x1 * T, y * T); }
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = 'rgba(255,255,255,0.17)';
    ctx.stroke();
  }

  dibujarObjetos(m, T) {
    const ctx = this.ctx;
    for (const o of m.objetos) {
      const img = imagen(o.imagen);
      const w = (o.ancho || 1) * T, hh = (o.alto || 1) * T;
      if (img) { ctx.drawImage(img, o.x * T, o.y * T, w, hh); continue; }
      ctx.fillStyle = '#7a5a3a';
      ctx.strokeStyle = '#3d2c1b';
      ctx.lineWidth = T * 0.04;
      const r = T * 0.12;
      ctx.beginPath();
      ctx.roundRect(o.x * T + T * 0.14, o.y * T + T * 0.14, w - T * 0.28, hh - T * 0.28, r);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e8d8bd';
      ctx.font = `600 ${T * 0.34}px ${FUENTE_TITULO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(inicial(o.nombre), o.x * T + w / 2, o.y * T + hh / 2 + T * 0.02);
    }
  }

  dibujarRango(m, T, x0, x1, y0, y1) {
    const modo = this.modoObjetivo;
    if (!modo?.origen) return;
    const { x: ox, y: oy } = modo.origen;
    const ctx = this.ctx;
    if (!modo.sinLimite) {
      ctx.fillStyle = 'rgba(240,180,76,0.17)';
      for (let y = Math.max(y0, oy - modo.alcance); y < Math.min(y1, oy + modo.alcance + 1); y++) {
        for (let x = Math.max(x0, ox - modo.alcance); x < Math.min(x1, ox + modo.alcance + 1); x++) {
          ctx.fillRect(x * T, y * T, T, T);
        }
      }
    }
    // Con área: las casillas que alcanzaría apuntando a la casilla bajo el ratón (lo mismo que calcula el servidor, sin contar muros)
    if (modo.area && this.hover) {
      const { cx, cy } = this.hover;
      const enAlcance = modo.sinLimite || Math.max(Math.abs(cx - ox), Math.abs(cy - oy)) <= modo.alcance;
      ctx.fillStyle = enAlcance ? 'rgba(214,82,58,0.38)' : 'rgba(140,140,140,0.30)';
      for (const [x, y] of celdasArea(modo.origen, cx, cy, modo.area, modo.alcance, modo.sinLimite, m.ancho, m.alto)) ctx.fillRect(x * T, y * T, T, T);
    }
  }

  dibujarResaltes(T, z) {
    const ctx = this.ctx;
    if (this.hover && !this.arrastre && !this.paneo) {
      ctx.lineWidth = 2 / z;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.strokeRect(this.hover.cx * T + 1 / z, this.hover.cy * T + 1 / z, T - 2 / z, T - 2 / z);
    }
    if (this.arrastre?.movido) {
      const { cx, cy } = this.arrastre.hasta;
      if (this.dentro(cx, cy)) {
        const mov = S.combate.activo && S.combate.movimiento?.token === this.arrastre.id ? S.combate.movimiento.quedan : Infinity;
        if (!S.esGM && !this.arrastre.alcance) this.arrastre.alcance = this.alcanzables(this.arrastre.desde.cx, this.arrastre.desde.cy, mov);
        const ok = (cx === this.arrastre.desde.cx && cy === this.arrastre.desde.cy)
          || (this.casillaLibre(cx, cy, this.arrastre.id) && (S.esGM || this.arrastre.alcance.has(`${cx},${cy}`)));
        ctx.fillStyle = ok ? 'rgba(111,183,168,0.30)' : 'rgba(196,83,63,0.34)';
        ctx.fillRect(cx * T, cy * T, T, T);
      }
    }
  }

  colorDe(t) { return t.tipo === 'enemigo' ? (COLOR[bandoDe(t)] || COLOR.neutral) : esMio(t) ? COLOR.propio : COLOR.aliado; }

  /** El tamaño del token (escala) solo cambia cómo se dibuja: crece o encoge desde el centro de su casilla. */
  dibujarToken(t, T, z, ts, alfa = 1, px = null, py = null) {
    const e = t.escala || 1;
    if (e === 1) { this.dibujarTokenBase(t, T, z, ts, alfa, px, py); return; }
    const ax = (px ?? t.x * T) + T / 2, ay = (py ?? t.y * T) + T / 2;
    this.ctx.save();
    this.ctx.translate(ax, ay); this.ctx.scale(e, e); this.ctx.translate(-ax, -ay);
    this.dibujarTokenBase(t, T, z * e, ts, alfa, px, py);
    this.ctx.restore();
  }

  /** Al cambiar de casilla, el token se desliza (~¼ s) en vez de aparecer de golpe. → {x, y} en píxeles del mundo, o null. */
  posicionAnimada(t, T) {
    const DUR = 240;
    const ahora = performance.now();
    let u = this.posiciones.get(t.id);
    if (!u) { this.posiciones.set(t.id, { x: t.x, y: t.y }); return null; }
    if (u.x !== t.x || u.y !== t.y) {
      const desde = u.anim ? u.actual : { x: u.x, y: u.y };
      const lejos = Math.max(Math.abs(t.x - desde.x), Math.abs(t.y - desde.y)) > 12;      // un salto de mapa o un teletransporte no se anima
      u = { x: t.x, y: t.y, anim: this.reducirMovimiento || lejos ? null : { fx: desde.x, fy: desde.y, ini: ahora } };
      this.posiciones.set(t.id, u);
    }
    if (!u.anim) return null;
    const k = Math.min(1, (ahora - u.anim.ini) / DUR);
    if (k >= 1) { u.anim = null; return null; }
    const e = 1 - (1 - k) ** 3;
    u.actual = { x: u.anim.fx + (t.x - u.anim.fx) * e, y: u.anim.fy + (t.y - u.anim.fy) * e };
    this.marcar();
    return { x: u.actual.x * T, y: u.actual.y * T };
  }

  dibujarTokenBase(t, T, z, ts, alfa = 1, px = null, py = null) {
    const ctx = this.ctx;
    // Escondido (hierba alta, sombras…): los demás no lo reciben; su dueño y el GM lo ven translúcido y sin nombre, barra ni estados.
    const escondido = !!tileEn(t.x, t.y)?.esconde;
    if (escondido) alfa *= 0.4;
    const x = px ?? t.x * T;
    const y = py ?? t.y * T;
    const cx = x + T / 2;
    const cy = y + T * 0.46;
    const r = T * 0.38;
    const color = this.colorDe(t);
    const enTurno = S.combate.activo && S.combate.turno_de === t.id;
    const seleccionado = S.tokenFoco === t.id;

    ctx.save();
    ctx.globalAlpha = alfa * (t.derrotado ? 0.55 : 1);

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.92, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // turno: aro de lámpara que late suavemente
    if (enTurno) {
      const pulso = this.reducirMovimiento ? 0 : Math.sin(ts / 280) * 0.05;
      ctx.shadowColor = COLOR.turno;
      ctx.shadowBlur = T * 0.28;
      ctx.strokeStyle = COLOR.turno;
      ctx.lineWidth = T * 0.07;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1.16 + pulso), 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (seleccionado) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = T * 0.035;
      ctx.setLineDash([T * 0.1, T * 0.07]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // cuerpo
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const img = imagen(t.imagen);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
      ctx.clip();
      const lado = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(18,22,29,0.82)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef1f5';
      ctx.font = `700 ${r * 1.05}px ${FUENTE_TITULO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.derrotado ? '✕' : inicial(t.nombre), cx, cy + r * 0.06);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = T * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (t.derrotado && img) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
      ctx.fill();
    }

    if (escondido) { ctx.restore(); return; }
    // Barras (vida, magia…): las que la campaña muestra sobre los tokens y este jugador no ha apagado en sus Ajustes.
    // De los tokens ajenos, solo si la mesa (o el GM en ese token) lo deja ver.
    const mio = S.esGM || esMio(t);
    const bh = T * 0.075;
    let sobra = 0;
    if (mio || t.mostrar?.barras !== false) {
      const bw = T * 0.74;
      const bx = x + (T - bw) / 2;
      let by = y + T * 0.9;
      for (const [i, nombre] of barrasVisibles(mio).entries()) {
        const r = t.recursos?.[nombre];
        if (!r || !(r.max > 0)) continue;
        const f = clamp(r.actual / r.max, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - T * 0.015, by - T * 0.015, bw + T * 0.03, bh + T * 0.03);
        ctx.fillStyle = nombre === S.catalogo?.recurso_vida ? (f > 0.5 ? '#7bc47f' : f > 0.25 ? '#e0b04a' : '#d9573f') : COLORES_BARRA[i % COLORES_BARRA.length];
        ctx.fillRect(bx, by, bw * f, bh);
        if (by > y + T * 0.9) sobra += bh + T * 0.03;
        by += bh + T * 0.03;
      }
    }

    // nombre
    if (ajustes.nombres && z >= 0.45 && (mio || t.mostrar?.nombre !== false)) {
      const tam = Math.max(T * 0.2, 11 / z);
      ctx.font = `600 ${tam}px ${FUENTE_TITULO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      ctx.lineWidth = tam * 0.28;
      ctx.strokeStyle = 'rgba(8,10,14,0.9)';
      const etiqueta = recortarTexto(ctx, t.nombre, T * 1.15);     // un nombre largo no se monta sobre los vecinos
      ctx.strokeText(etiqueta, cx, y + T + 1 + sobra);
      ctx.fillStyle = '#f1ece0';
      ctx.fillText(etiqueta, cx, y + T + 1 + sobra);
    }
    // agrupado con otros (se mueven juntos): una cadena pequeña abajo a la izquierda, solo para quien lo controla
    if (t.grupo && (S.esGM || esMio(t))) {
      const gx = cx - r * 0.85, gy = cy + r * 0.7, gr = T * 0.12;
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = T * 0.02;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = `${Math.round(T * 0.14)}px "Segoe UI Emoji", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ICONO_ENLACE.complete && ICONO_ENLACE.naturalWidth) { const l = gr * 1.5; const su = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false; ctx.drawImage(ICONO_ENLACE, gx - l / 2, gy - l / 2, l, l); ctx.imageSmoothingEnabled = su; }
      else ctx.fillText('🔗', gx, gy + T * 0.005);
    }
    // estados activos (veneno, etc.): insignias pequeñas arriba, con el color y la imagen de cada estado (hasta 3; luego «+N»)
    if (t.estados?.length) {
      const br = T * 0.13, paso = br * 1.85;
      const max = t.estados.length > 3 ? 2 : t.estados.length;
      const insignias = t.estados.slice(0, max).map((e) => S.catalogo?.estados?.[e.id] || {});
      if (t.estados.length > max) insignias.push({ mas: t.estados.length - max });
      let bx = cx + r * 0.85, by = cy - r * 0.85;
      for (const est of insignias) {
        ctx.fillStyle = est.mas ? '#3a3f4b' : (est.color || '#7a4fb5');
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = T * 0.022;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const ico = !est.mas && est.imagen ? imagen(est.imagen) : null;
        if (ico) {
          ctx.save();
          ctx.beginPath(); ctx.arc(bx, by, br * 0.82, 0, Math.PI * 2); ctx.clip();
          const lado = Math.min(ico.width, ico.height);
          ctx.drawImage(ico, (ico.width - lado) / 2, (ico.height - lado) / 2, lado, lado, bx - br * 0.82, by - br * 0.82, br * 1.64, br * 1.64);
          ctx.restore();
        } else {
          ctx.fillStyle = '#fff';
          ctx.font = `700 ${Math.round(T * (est.mas ? 0.12 : 0.15))}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(est.mas ? `+${est.mas}` : inicial(est.nombre || '?'), bx, by + T * 0.005);
        }
        bx -= paso;
      }
    }
    ctx.restore();
  }

  // ── Dibujos temporales ───────────────────────────────────────
  /** obj: { dibujar(T, z, ts), expira? (marca de tiempo en ms; si falta, dura hasta que se quite) } */
  agregarTemporal(obj) { this.temporales.push(obj); this.marcar(); return obj; }
  quitarTemporal(obj) { this.temporales = this.temporales.filter((t) => t !== obj); this.marcar(); }

  dibujarTemporales(T, z, ts) {
    const ahora = performance.now();
    this.temporales = this.temporales.filter((t) => !t.expira || t.expira > ahora);
    for (const t of this.temporales) t.dibujar(T, z, ts);
  }

  /** Un aro que se expande sobre una casilla (lo envía quien señala; dura un par de segundos). */
  ping(cx, cy, usuario) {
    const ini = performance.now(), dur = 2200;
    this.agregarTemporal({ expira: ini + dur, dibujar: (T, z) => {
      const t = Math.min(1, (performance.now() - ini) / dur), ctx = this.ctx;
      const x = cx * T + T / 2, y = cy * T + T / 2;
      ctx.save();
      ctx.strokeStyle = '#f0b44c'; ctx.lineWidth = 3 / z;
      for (let k = 0; k < 3; k++) {
        const f = (t * 3 - k * 0.5);
        if (f <= 0 || f >= 1.4) continue;
        ctx.globalAlpha = Math.max(0, 1 - f / 1.4);
        ctx.beginPath(); ctx.arc(x, y, T * (0.3 + f * 1.1), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = '#f0b44c'; ctx.beginPath(); ctx.arc(x, y, 5 / z, 0, Math.PI * 2); ctx.fill();
      ctx.font = `600 ${12 / z}px ${FUENTE_UI}`; ctx.textAlign = 'center'; ctx.fillStyle = '#e8ecf4';
      ctx.fillText(usuario, x, y - T * 0.7);
      ctx.restore();
    } });
  }

  /** Niebla de guerra: las casillas que el jugador no ve quedan negras (el servidor tampoco le envía lo que hay en ellas). */
  dibujarNiebla(T, z, x0, x1, y0, y1) {
    const f = S.niebla;
    if (!f) return;
    const ctx = this.ctx, sobra = 0.6 / z;
    ctx.save();
    if (S.esGM) ctx.globalAlpha = 0.55;          // ayuda visual del GM: ve lo que hay debajo y qué queda oculto a los jugadores
    ctx.fillStyle = '#05070a';
    for (let y = y0; y < y1; y++) {
      const fila = f[y];
      if (!fila) continue;
      let x = x0;
      while (x < x1) {                                            // tramos seguidos de niebla en un solo rectángulo
        if (fila[x] === '1') { x++; continue; }
        let fin = x + 1;
        while (fin < x1 && fila[fin] !== '1') fin++;
        ctx.fillRect(x * T, y * T, (fin - x) * T + sobra, T + sobra);
        x = fin;
      }
    }
    ctx.restore();
  }

  /** Día y noche: un velo de color sobre el mapa, según el momento que haya puesto el GM. */
  dibujarMomento(m, T) {
    const c = S.catalogo?.ciclo;
    if (c?.activo) this.velo(c.periodos?.[S.periodo], m, T);
  }
  /** Clima (lluvia, niebla…): otro velo, encima del de día y noche. */
  dibujarClima(m, T) {
    const c = S.catalogo?.clima;
    if (c?.activo) this.velo(c.tipos?.[S.clima], m, T);
  }
  velo(p, m, T) {
    if (!p || !p.color || !(p.opacidad > 0)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(0.9, p.opacidad);
    ctx.fillStyle = p.color;
    ctx.fillRect(0, 0, m.ancho * T, m.alto * T);
    ctx.restore();
  }

  /** Radio del borrador, en casillas (lo elige cada uno en el panel del lápiz). */
  get radioBorrador() { return clamp(Number(ajustes.radioBorrador) || 0.45, 0.1, 3); }
  /** El borrador pasó por aquí: se guardan los puntos del recorrido (también los de en medio, si el ratón fue rápido) y se envían al servidor,
   *  que recorta los trazos y devuelve solo lo que queda. */
  borrarEn(p) {
    const w = this.aMundo(p.x, p.y), x = w.x / this.T, y = w.y / this.T, b = this.borrando;
    const paso = this.radioBorrador / 2, u = b.ultimo;
    if (u) {
      const n = Math.min(60, Math.floor(Math.hypot(x - u[0], y - u[1]) / paso));
      for (let i = 1; i <= n; i++) b.pendiente.push([u[0] + (x - u[0]) * i / (n + 1), u[1] + (y - u[1]) * i / (n + 1)]);
    }
    b.pendiente.push([x, y]);
    b.ultimo = [x, y];
    this.enviarBorrado(false);
  }
  enviarBorrado(fin) {
    const b = this.borrando, ahora = performance.now();
    if (!b?.pendiente.length || (!fin && ahora - b.t < 70)) return;      // como mucho ~14 envíos por segundo mientras se arrastra
    b.t = ahora;
    const radio = Math.round(this.radioBorrador * 100) / 100;
    while (b.pendiente.length) {
      const centros = b.pendiente.splice(0, 100).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      this.cb.alBorrarZona?.(centros, radio);
    }
  }

  // ── Dibujos de los usuarios (capa propia: se puede ocultar) ──
  dibujarTrazos(T, z) {
    const ctx = this.ctx;
    const lista = ajustes.verDibujos === false ? [] : (S.dibujos || []);
    // Lápices de los demás mientras dibujan: el lápiz con su nombre (desaparece al terminar o tras un momento sin moverse)
    const ahora = performance.now();
    for (const [u, l] of S.lapices || []) {
      if (ahora - l.t > 1500) { S.lapices.delete(u); continue; }
      ctx.save();
      if (ICONO_LAPIZ.complete && ICONO_LAPIZ.naturalWidth) {          // la punta del lápiz, en el punto donde dibuja
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ICONO_LAPIZ, l.x * T - 1 / z, l.y * T - 31 / z, 32 / z, 32 / z);
      }
      ctx.font = `600 ${12 / z}px sans-serif`; ctx.lineWidth = 3 / z; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#fff';
      ctx.strokeText(u, l.x * T + 18 / z, l.y * T - 4 / z); ctx.fillText(u, l.x * T + 18 / z, l.y * T - 4 / z);
      ctx.restore();
      this.marcar();
    }
    if (this.herramienta === 'lapiz' && this.borrador && this.hoverMundo) {      // el círculo del borrador
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([4 / z, 3 / z]); ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(this.hoverMundo.x, this.hoverMundo.y, this.radioBorrador * T, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (!lista.length && !this.trazo) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const linea = (puntos, color, grosor) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = (grosor || 4) / z;
      ctx.beginPath();
      puntos.forEach(([x, y], i) => { if (i) ctx.lineTo(x * T, y * T); else ctx.moveTo(x * T, y * T); });
      ctx.stroke();
    };
    for (const d of lista) linea(d.puntos, d.color, d.grosor);
    if (this.trazo) linea(this.trazo.puntos, ajustes.colorDibujo || '#f0b44c', ajustes.grosorLapiz);      // el mío mientras lo trazo
    ctx.restore();
  }

  /** La regla de otros jugadores mientras miden. */
  dibujarReglasAjenas(T, z) {
    if (!S.reglasAjenas?.size) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const [usuario, puntos] of S.reglasAjenas) {
      const color = '#e8ecf4';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 / z;
      ctx.setLineDash([10 / z, 7 / z]);
      ctx.beginPath();
      puntos.forEach(([cx, cy], i) => { if (i) ctx.lineTo(cx * T + T / 2, cy * T + T / 2); else ctx.moveTo(cx * T + T / 2, cy * T + T / 2); });
      ctx.stroke();
      ctx.setLineDash([]);
      let total = 0;
      for (let i = 1; i < puntos.length; i++) total += Math.max(Math.abs(puntos[i][0] - puntos[i - 1][0]), Math.abs(puntos[i][1] - puntos[i - 1][1]));
      const [fx, fy] = puntos[puntos.length - 1];
      const texto = `${usuario}: ${textoMedida(total)}`;
      ctx.font = `600 ${13 / z}px ${FUENTE_UI}`;
      const w = ctx.measureText(texto).width + 14 / z;
      const x = fx * T + T / 2, y = fy * T + T / 2 - 22 / z;
      ctx.fillStyle = 'rgba(18,22,29,0.92)';
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11 / z, w, 22 / z, 6 / z); ctx.fill();
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(texto, x, y);
      for (const [cx, cy] of puntos) { ctx.beginPath(); ctx.arc(cx * T + T / 2, cy * T + T / 2, 5 / z, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  // ── Regla ────────────────────────────────────────────────────
  /** Clic derecho mientras se mide: fija un punto de giro y la medición sigue desde ahí. */
  agregarPuntoRegla() {
    const r = this.regla;
    if (!r || this.reglaDerecho) return;
    this.reglaDerecho = true;
    const ultimo = r.puntos[r.puntos.length - 1];
    if (ultimo.cx !== r.fin.cx || ultimo.cy !== r.fin.cy) {
      r.puntos.push({ cx: r.fin.cx, cy: r.fin.cy });
      this.enviarRegla(true);
      this.marcar();
    }
  }

  /** Avisa a los demás de mi medición (como mucho unas 15 veces por segundo; `ya` = sin esperar). */
  enviarRegla(ya = false) {
    const r = this.regla;
    if (!r || !this.cb.alRegla) return;
    const ahora = performance.now();
    if (!ya && ahora - this.ultimoEnvioRegla < 66) return;
    this.ultimoEnvioRegla = ahora;
    this.reglaEnviada = true;
    this.cb.alRegla([...r.puntos, r.fin].map((p) => [p.cx, p.cy]));
  }

  terminarRegla() {
    if (this.reglaEnviada) { this.reglaEnviada = false; this.cb.alRegla?.(null); }
    if (this.dibujoRegla) { this.quitarTemporal(this.dibujoRegla); this.dibujoRegla = null; }
    this.regla = null;
    this.reglaDerecho = false;
  }

  /** Distancia total en casillas (la diagonal cuenta como 1, igual que en el servidor). */
  distanciaRegla() {
    const r = this.regla;
    if (!r) return 0;
    const pts = [...r.puntos, r.fin];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.max(Math.abs(pts[i].cx - pts[i - 1].cx), Math.abs(pts[i].cy - pts[i - 1].cy));
    return total;
  }

  dibujarRegla(T, z) {
    const r = this.regla;
    if (!r) return;
    const ctx = this.ctx;
    const centro = (p) => [p.cx * T + T / 2, p.cy * T + T / 2];
    const pts = [...r.puntos, r.fin];

    ctx.save();
    ctx.strokeStyle = COLOR.turno;
    ctx.fillStyle = COLOR.turno;
    ctx.lineWidth = 3 / z;
    ctx.lineJoin = 'round';
    ctx.setLineDash([10 / z, 7 / z]);
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = centro(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);

    const etiqueta = (x, y, texto, tam) => {
      ctx.font = `600 ${tam / z}px ${FUENTE_UI}`;
      const w = ctx.measureText(texto).width + 14 / z;
      ctx.fillStyle = 'rgba(18,22,29,0.92)';
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - (tam * 0.85) / z, w, (tam * 1.7) / z, 6 / z);
      ctx.fill();
      ctx.fillStyle = COLOR.turno;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(texto, x, y);
    };

    let acumulado = 0;
    pts.forEach((p, i) => {
      if (i > 0) acumulado += Math.max(Math.abs(p.cx - pts[i - 1].cx), Math.abs(p.cy - pts[i - 1].cy));
      const [x, y] = centro(p);
      const esGiro = i > 0 && i < pts.length - 1;
      ctx.fillStyle = COLOR.turno;
      ctx.beginPath();
      ctx.arc(x, y, (esGiro ? 7 : 5) / z, 0, Math.PI * 2);
      ctx.fill();
      if (esGiro) etiqueta(x, y - 20 / z, String(acumulado), 12);
    });
    const [fx, fy] = centro(r.fin);
    etiqueta(fx, fy - 22 / z, `${acumulado} ${acumulado === 1 ? 'casilla' : 'casillas'}`, 14);
    ctx.restore();
  }

  // ── Puntos importantes del mapa (solo los ve el GM) ──────────
  dibujarPuntos(m, T, z) {
    if (!S.esGM || !ajustes.puntos || !m.puntos?.length || z < 0.35) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const p of m.puntos) {
      const x = p.x * T + T * 0.2;
      const y = p.y * T + T * 0.2;
      const r = T * 0.11;
      ctx.fillStyle = 'rgba(18,22,29,0.88)';
      ctx.strokeStyle = COLOR.turno;
      ctx.lineWidth = T * 0.035;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (z >= 0.5) {
        const tam = Math.max(T * 0.17, 10 / z);
        ctx.font = `600 ${tam}px ${FUENTE_TITULO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = tam * 0.3;
        ctx.strokeStyle = 'rgba(8,10,14,0.9)';
        ctx.strokeText(p.nombre, x + r * 1.5, y);
        ctx.fillStyle = '#ffe2a8';
        ctx.fillText(p.nombre, x + r * 1.5, y);
      }
    }
    ctx.restore();
  }
}
