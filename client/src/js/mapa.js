// mapa.js — El mapa: dibuja el tablero de casillas, la cuadrícula, objetos y tokens en un <canvas>,
// y gestiona zoom, desplazamiento, herramientas (cursor, mano, regla) y arrastre de tokens.
// Solo lee el estado (S); cuando el jugador hace algo, avisa mediante los callbacks `cb`.
//
// VistaMapa está repartida en varios archivos (un tema cada uno) que comparten `this`:
//   mapa.js         cámara, entrada (ratón, rueda, teclado) y el bucle que decide qué se dibuja y en qué orden
//   mapa-capas.js   tablero, capas, cuadrícula, objetos, alcance, niebla, día/noche y clima
//   mapa-tokens.js  tokens y avisos temporales
//   mapa-trazos.js  lápiz, borrador y regla
//   mapa-estilo.js  colores, fuentes e iconos · mapa-area.js  casillas de un área

import { S, tileEn, objetoCubre, rompibleEn } from './almacen.js';
import { ajustes } from './ajustes.js';
import { h, clamp, escribiendo } from './util.js';
import { COLOR, cursorLapiz } from './mapa-estilo.js';
import { CapasMapa } from './mapa-capas.js';
import { TokensMapa } from './mapa-tokens.js';
import { TrazosMapa } from './mapa-trazos.js';

export { celdasArea } from './mapa-area.js';

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 3;

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
    else if (this.herramienta === 'lapiz') c = this.borrador ? 'cell' : this.cb.puedeDibujar?.() ? cursorLapiz() : 'not-allowed';
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
}

// Las demás partes de VistaMapa: sus métodos pasan a la clase. Si dos partes definen el mismo nombre, se avisa en vez de taparse.
for (const parte of [CapasMapa, TokensMapa, TrazosMapa]) {
  for (const [nombre, desc] of Object.entries(Object.getOwnPropertyDescriptors(parte.prototype))) {
    if (nombre === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(VistaMapa.prototype, nombre)) throw new Error(`VistaMapa: «${nombre}» está definido dos veces`);
    Object.defineProperty(VistaMapa.prototype, nombre, desc);
  }
}
