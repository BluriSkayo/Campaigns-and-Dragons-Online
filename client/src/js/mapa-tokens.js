// mapa-tokens.js — Cómo se dibuja cada token (retrato, barras, nombre, turno, estados, animación al moverse) y los avisos temporales (pings).
// Parte de VistaMapa (ver mapa.js): sus métodos usan `this` como los de la clase.
import { S, esMio, tileEn, bandoDe } from './almacen.js';
import { ajustes } from './ajustes.js';
import { imagen } from './imagenes.js';
import { clamp, inicial } from './util.js';
import { COLOR, FUENTE_TITULO, FUENTE_UI, COLORES_BARRA, barrasVisibles, recortarTexto, ICONO_ENLACE } from './mapa-estilo.js';

export class TokensMapa {
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
}
