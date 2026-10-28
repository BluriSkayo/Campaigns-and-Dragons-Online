// mapa-capas.js — El tablero y lo que se pinta sobre él: tiles, capas de detalle, cuadrícula, objetos, alcance y área de una habilidad, resaltes, niebla, día y noche, clima y puntos de interés.
// Parte de VistaMapa (ver mapa.js): sus métodos usan `this` como los de la clase.
import { S, tileEn } from './almacen.js';
import { ajustes } from './ajustes.js';
import { imagen } from './imagenes.js';
import { inicial } from './util.js';
import { COLOR, FUENTE_TITULO } from './mapa-estilo.js';
import { celdasArea } from './mapa-area.js';

export class CapasMapa {
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
