// ajustes.js — Configuración local del cliente (se guarda en este equipo, no en el servidor).
import { bus } from './almacen.js';

const CLAVE = 'mesa-rol-ajustes';
const DEFECTO = {
  servidor: 'localhost:8765',
  usuario: '',
  volMusica: 0.5,
  volAmbiente: 0.5,
  anchoIzq: 360,          // ancho de la barra izquierda cuando tiene opciones desplegadas
  anchoRail: 172,         // ancho del menú izquierdo cuando no hay ninguna categoría desplegada
  anchoDer: 360,          // ancho de la barra derecha (chat y música)
  bucleMusica: true,      // «Repetir» de la música
  bucleAmbiente: true,    // «Repetir» del ambiente
  musicaPlegada: true,    // panel de música plegado (deja más sitio al chat): así empieza, y cada uno lo despliega
  categoriasPlegadas: {}, // «musica/Combate»: true = esa categoría de sonidos está plegada (cada una por su cuenta)
  categoriasNpcPlegadas: {}, // GM: categorías de NPC plegadas en el Panel del GM («enemigos»: true)
  volSonidos: 0.5,
  cuadricula: true,
  nombres: true,
  barras: {},                // recurso → false si no quiero ver esa barra sobre los tokens (las demás, sí)
  barrasAjenas: true,        // ver también las barras de los tokens de los demás (si la mesa lo permite)
  panelIzq: true,
  panelDer: true,
  verDibujos: true,          // capa de dibujos de los usuarios
  colorDibujo: '#f0b44c',    // color de mi lápiz
  grosorLapiz: 4,            // grosor de mi lápiz (píxeles de pantalla)
  radioBorrador: 0.45,       // tamaño de mi borrador (radio, en casillas)
  puntos: true,              // puntos importantes del mapa (solo se muestran al GM)
  huellas: {},               // por servidor (nombre:puerto): huella del certificado que el jugador aceptó
  ultimoPersonaje: {},       // por servidor y usuario: se entra directo con el último personaje usado
  servidores: null,          // servidores guardados [{id, nombre, direccion, usuario}] (sin contraseñas)
  contrasenas: {},           // «Recuérdame»: por servidor guardado y usuario, sus contraseñas CIFRADAS por el sistema (nunca la de GM)
};

function leer() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; }
}

export const ajustes = { ...DEFECTO, ...leer() };
// Primera vez con la lista de servidores: el último servidor usado pasa a ser el primero de la lista (así nadie lo pierde).
if (!Array.isArray(ajustes.servidores)) {
  ajustes.servidores = ajustes.usuario ? [{ id: 's1', nombre: ajustes.servidor, direccion: ajustes.servidor, usuario: ajustes.usuario }] : [];
}

export function guardar(parcial) {
  Object.assign(ajustes, parcial);
  try { localStorage.setItem(CLAVE, JSON.stringify(ajustes)); } catch { /* sin almacenamiento: no pasa nada */ }
  bus.emit('ajustes');
}

// ── «Recuérdame»: contraseñas guardadas, cifradas por el sistema (solo la del usuario y la del servidor; nunca la de GM) ──
const cred = () => window.mesa?.credenciales;
const claveCred = (svId, usuario) => `${svId}|${String(usuario || '').toLowerCase()}`;
export const credencialesDisponibles = async () => { try { return !!(await cred()?.disponible()); } catch { return false; } };
export const hayContrasenas = (svId, usuario) => !!ajustes.contrasenas?.[claveCred(svId, usuario)];

/** Las contraseñas recordadas de ese servidor y usuario ({usuario, servidor}), o null si no hay o no se pueden leer en este equipo. */
export async function leerContrasenas(svId, usuario) {
  const g = ajustes.contrasenas?.[claveCred(svId, usuario)];
  if (!g || !cred()) return null;
  try {
    const [u, s] = await Promise.all([g.usuario ? cred().descifrar(g.usuario) : '', g.servidor ? cred().descifrar(g.servidor) : '']);
    return u === null || s === null ? null : { usuario: u, servidor: s };
  } catch { return null; }
}

export async function guardarContrasenas(svId, usuario, { usuario: pu = '', servidor: ps = '' }) {
  if (!(await credencialesDisponibles())) return false;
  const [u, s] = await Promise.all([pu ? cred().cifrar(pu) : '', ps ? cred().cifrar(ps) : '']);
  if (u === null || s === null) return false;
  guardar({ contrasenas: { ...(ajustes.contrasenas || {}), [claveCred(svId, usuario)]: { usuario: u, servidor: s } } });
  return true;
}

export function olvidarContrasenas(svId, usuario = null) {
  const c = { ...(ajustes.contrasenas || {}) };
  for (const k of Object.keys(c)) if (usuario == null ? k.startsWith(`${svId}|`) : k === claveCred(svId, usuario)) delete c[k];
  guardar({ contrasenas: c });
}
