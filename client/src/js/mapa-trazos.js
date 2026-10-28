// mapa-trazos.js — Lápiz, borrador y regla: los dibujos de los usuarios y las mediciones (propias y las que ven los demás).
// Parte de VistaMapa (ver mapa.js): sus métodos usan `this` como los de la clase.
import { S, textoMedida } from './almacen.js';
import { ajustes } from './ajustes.js';
import { clamp } from './util.js';
import { COLOR, FUENTE_UI, ICONO_LAPIZ } from './mapa-estilo.js';

export class TrazosMapa {
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
}
