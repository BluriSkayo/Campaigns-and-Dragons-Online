// musica.js — Música, ambiente y efectos, sincronizados con el servidor. Los oyen todos los jugadores que tengan el archivo.
//
// • Música: el servidor dice qué archivo de SU lista suena; tiene que estar en base/sonido/musica de este equipo.
//   Al parar puede ser de golpe o con un fundido (el servidor solo reenvía la orden).
// • Ambiente: el GM enciende y apaga sonidos (puede haber varios a la vez); todos los oyen.
// • Efectos: el GM los lanza y suenan una vez en todos los equipos.
// • «Repetir» es una preferencia de cada equipo (Ajustes): decide si la música y el ambiente vuelven a empezar al terminar.
import { ajustes } from './ajustes.js';
import { urlLocal } from './archivos.js';
import { clamp, toast } from './util.js';

const FUNDIDO_MS = 3000;
const FUNDIDO_AMBIENTE_MS = 1500;
export const audio = new Audio();
let fundido = null;

const url = (tipo, archivo) => urlLocal(`sonido/${tipo}/${archivo}`);
const aviso = (tipo, archivo) => toast(`Falta «${archivo}» en tu carpeta base/sonido/${tipo}.`, 'info');

audio.addEventListener('error', () => {
  const a = audio.getAttribute('src');
  if (a) aviso('musica', decodeURIComponent(a.split('/').pop()));
});

const ambientes = new Map();      // archivo → Audio (los que están sonando en este equipo)

export function aplicarVolumen() {
  if (!fundido) audio.volume = clamp(ajustes.volMusica, 0, 1);
  for (const a of ambientes.values()) a.volume = clamp(ajustes.volAmbiente, 0, 1);
}

/** Cambia al momento si la música y el ambiente se repiten (la casilla «Repetir» del reproductor). */
export function aplicarBucle() {
  audio.loop = ajustes.bucleMusica !== false;
  for (const a of ambientes.values()) a.loop = ajustes.bucleAmbiente !== false;
}

function cortar() {
  clearInterval(fundido); fundido = null;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  aplicarVolumen();
}

/** Pone la canción `archivo` (de la lista del servidor) o la para. `gradual`: apagarla poco a poco. */
export function reproducir(archivo, { gradual = false } = {}) {
  if (!archivo) {
    if (gradual && audio.getAttribute('src') && !audio.paused) {
      clearInterval(fundido);
      const inicio = audio.volume, t0 = Date.now();
      fundido = setInterval(() => {
        const f = 1 - (Date.now() - t0) / FUNDIDO_MS;
        if (f <= 0) cortar(); else audio.volume = clamp(inicio * f, 0, 1);
      }, 50);
    } else cortar();
    return;
  }
  clearInterval(fundido); fundido = null;
  aplicarVolumen();
  const u = url('musica', archivo);
  if (!u) return;
  audio.loop = ajustes.bucleMusica !== false;
  if (audio.getAttribute('src') !== u) audio.src = u;
  audio.play().catch(() => { /* el sistema puede bloquear la reproducción hasta que haya interacción */ });
}

// ── Ambiente ──
function pararAmbiente(archivo) {
  const a = ambientes.get(archivo);
  if (!a) return;
  ambientes.delete(archivo);
  const inicio = a.volume, t0 = Date.now();
  const t = setInterval(() => {
    const f = 1 - (Date.now() - t0) / FUNDIDO_AMBIENTE_MS;
    if (f <= 0) { clearInterval(t); a.pause(); } else a.volume = clamp(inicio * f, 0, 1);
  }, 50);
}

/** Deja sonando exactamente los sonidos de ambiente de la lista `activos` (los que ya suenan no se reinician). */
export function sincronizarAmbiente(activos) {
  const quiero = new Set(Array.isArray(activos) ? activos : []);
  for (const archivo of [...ambientes.keys()]) if (!quiero.has(archivo)) pararAmbiente(archivo);
  for (const archivo of quiero) {
    if (ambientes.has(archivo)) continue;
    const u = url('ambiente', archivo);
    if (!u) continue;
    const a = new Audio(u);
    a.loop = ajustes.bucleAmbiente !== false;
    a.volume = clamp(ajustes.volAmbiente, 0, 1);
    a.addEventListener('error', () => { aviso('ambiente', archivo); ambientes.delete(archivo); });
    a.addEventListener('ended', () => { if (ambientes.get(archivo) === a) ambientes.delete(archivo); });
    ambientes.set(archivo, a);
    a.play().catch(() => {});
  }
}

// ── Efectos: suenan una vez, encima de todo ──
export function efecto(archivo) {
  const u = url('efectos', archivo);
  if (!u) return;
  const a = new Audio(u);
  a.volume = clamp(ajustes.volSonidos, 0, 1);
  a.addEventListener('error', () => aviso('efectos', archivo));
  a.play().catch(() => {});
}
