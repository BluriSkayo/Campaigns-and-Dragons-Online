// acciones.js — Lo que el jugador puede pedir al servidor. Cada función solo envía la petición;
// el servidor valida y responde (con el cambio o con un error).
import { red } from './red.js';
import { S, bus, tokenFoco, puedoControlar, textoMedida } from './almacen.js';
import { toast } from './util.js';
import { exportarPersonajeArchivo } from './archivos.js';

export function iniciarHabilidad(tokenId, habId) {
  const hab = S.catalogo.habilidades[habId];
  if (!hab) return;
  if (hab.objetivo === 'uno_mismo') {
    red.enviar({ tipo: 'usar_habilidad', token: tokenId, habilidad: habId });
    return;
  }
  const area = hab.area && hab.area.forma !== 'uno' ? hab.area : null;
  bus.emit('modo-objetivo', { tokenId, habId, alcance: hab.alcance, sinLimite: !!hab.sin_limite || ['cono', 'casillas'].includes(area?.forma), area, nombre: hab.nombre, dano: hab.tipo === 'dano' });
}

export const usarObjeto = (tokenId, objetoId) => red.enviar({ tipo: 'usar_objeto', token: tokenId, objeto: objetoId });
export const terminarTurno = () => red.enviar({ tipo: 'terminar_turno' });
export const tirarDado = (expresion) => red.enviar({ tipo: 'tirar_dado', expresion });
/** Un mensaje de chat. Los comandos («/r 2d6», «/Ataque», «/gm …») los entiende el servidor; para las tiradas guardadas que usan
 *  estadísticas se manda también el token seleccionado (el servidor comprueba que puedas usarlo). */
/** `como`: id de un token propio de la sala para hablar como ese personaje ('' = como usuario). */
export function enviarChat(texto, sala = 'general', como = '') {
  const t = texto.startsWith('/') ? tokenFoco() : null;
  red.enviar({ tipo: 'chat', texto, ...(sala !== 'general' ? { sala } : {}), ...(t && puedoControlar(t) ? { token: t.id } : {}), ...(como ? { como } : {}) });
}
export const tiradaGuardada = (accion, datos) => red.enviar({ tipo: 'tiradas', accion, ...datos });
export const colocarEnemigoModo = (enemigo) => bus.emit('modo-colocar', { enemigo });
export const cancelarModos = () => bus.emit('cancelar-modos');
export const cambiarPersonaje = () => bus.emit('cambiar-personaje');
export const desplegarPersonaje = (personaje, usuario = null, x = null, y = null) =>
  red.enviar({ tipo: 'desplegar_personaje', personaje, ...(usuario ? { usuario } : {}), ...(x != null ? { x, y } : {}) });
export const retirarPersonaje = (token) => red.enviar({ tipo: 'retirar_personaje', token });
export const pedirPersonajes = () => red.enviar({ tipo: 'gm_listar_personajes' });
export const comprar = (tienda, objeto, cantidad = 1) => red.enviar({ tipo: 'comprar', tienda, objeto, cantidad });
export const vender = (tienda, objeto, cantidad = 1) => red.enviar({ tipo: 'vender', tienda, objeto, cantidad });
export const proponerIntercambio = (con) => red.enviar({ tipo: 'intercambio_proponer', con });

/** «Daño · alcance 3 · línea · 2 golpes»: lo esencial de una habilidad en una línea. */
export function resumenHabilidad(hab) {
  const forma = { explosion: `explosión de ${hab.area?.tamano || 1}`, linea: 'línea', frente: `frente de ${hab.area?.tamano || 1}`, cono: `cono de ${hab.area?.tamano || 1}`, casillas: 'área propia' }[hab.area?.forma];
  const conDir = ['cono', 'casillas'].includes(hab.area?.forma);
  const unidad = S.catalogo?.medida?.unidad;
  return [hab.tipo === 'curacion' ? 'Cura' : hab.tipo === 'efecto' ? 'Efecto' : 'Daño', conDir ? null : hab.sin_limite ? 'alcance sin límite' : `alcance ${unidad && unidad !== 'casillas' ? textoMedida(hab.alcance) : hab.alcance}`, forma,
    hab.golpes > 1 ? `${hab.golpes} golpes` : null, hab.mover_objetivo ? (hab.mover_objetivo.modo === 'atraer' ? 'atrae' : 'empuja') : null].filter(Boolean).join(' · ');
}

/** «Exportar personaje»: guarda una ficha propia (con sus imágenes) en un .mesa-personaje, para que el GM la importe en el Editor. */
export async function exportarPersonaje(personajeId) {
  const p = S.personajes.find((x) => x.id === personajeId);
  if (!p) { toast('Solo puedes exportar tus propios personajes.', 'error'); return; }
  try {
    const r = await exportarPersonajeArchivo({ personaje: p, servidor: S.servidor?.nombre || '', usuario: S.usuario });
    if (r) toast(`«${p.nombre}» exportado${r.archivos ? ` con ${r.archivos} ${r.archivos === 1 ? 'imagen' : 'imágenes'}` : ''}. Envía el archivo .mesa-personaje al GM: lo importa en el Editor (Jugadores y fichas).`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
}
