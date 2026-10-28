// sonidos.js — Avisos sonoros sencillos generados al vuelo (sin archivos). Respetan el volumen de sonidos.
import { ajustes } from './ajustes.js';

let ctx = null;

function nota(frecuencia, inicio, duracion, tipo = 'sine', fuerza = 1) {
  const vol = ajustes.volSonidos;
  if (vol <= 0) return;
  ctx ||= new AudioContext();
  const osc = ctx.createOscillator();
  const gan = ctx.createGain();
  osc.type = tipo;
  osc.frequency.value = frecuencia;
  const t0 = ctx.currentTime + inicio;
  gan.gain.setValueAtTime(0.0001, t0);
  gan.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.25 * vol * fuerza), t0 + 0.02);
  gan.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
  osc.connect(gan).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracion + 0.05);
}

export function pitar(tipo) {
  try {
    if (tipo === 'turno') { nota(660, 0, 0.15); nota(880, 0.14, 0.25); }
    else if (tipo === 'dado') { nota(300, 0, 0.05, 'square'); nota(420, 0.06, 0.05, 'square'); nota(520, 0.12, 0.08, 'square'); }
    else if (tipo === 'error') nota(180, 0, 0.18, 'triangle');
    else if (tipo === 'golpe') { nota(150, 0, 0.09, 'square', 0.8); nota(95, 0.05, 0.14, 'square', 0.8); }
    else if (tipo === 'cura') { nota(523, 0, 0.12); nota(784, 0.1, 0.22); }
    else if (tipo === 'mover') nota(240, 0, 0.05, 'triangle', 0.5);
  } catch { /* sin audio disponible */ }
}
