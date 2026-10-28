// plantillas.js — «Nuevo estado desde plantilla»: estados habituales (Veneno, Confusión, Escudo…) armados con las piezas normales
// del sistema de efectos. No son nada especial: al crearlos quedan como cualquier otro estado y el GM los cambia a su gusto.
// Se adaptan a la campaña (su recurso de vida, su primera estadística, su primera etiqueta) y, si falta algo, la ficha lo marca.
import { h } from './util.js';
import { E, stats, recursosJuego } from './estado.js';

const ef = (cuando, hacer, si) => ({ cuando: typeof cuando === 'string' ? { tipo: cuando } : cuando, hacer, ...(si ? { si } : {}) });
const prob = (porcentaje) => [{ tipo: 'probabilidad', porcentaje }];

/** Plantillas para la campaña abierta. → [{ id, nombre, resumen, datos }] */
export function plantillasEstado() {
  const j = E.campana?.config?.juego || {};
  const vida = j.recurso_vida || recursosJuego()[0] || '';
  const stat = stats()[0] || '';
  const etiqueta = (j.etiquetas || [])[0]?.nombre || '';
  const escudo = recursosJuego().find((r) => /escudo|barrera|shield/i.test(r)) || '';
  const recurso = (formula) => ({ tipo: 'modificar_recurso', recurso: vida, formula });
  return [
    { id: 'veneno', nombre: 'Veneno', resumen: `Pierde ${vida} al empezar cada turno; se acumula (más cargas, más daño).`,
      datos: { duracion: 4, color: '#5aa04a', al_reaplicar: 'acumular', max_cargas: 5, efectos: [ef('inicio_turno', recurso('-2 * [Cargas]'))] } },
    { id: 'quemadura', nombre: 'Quemadura', resumen: `Pierde ${vida} cada turno y${stat ? ` tiene −2 de ${stat}` : ' pega más flojo'}.`,
      datos: { duracion: 3, color: '#d9662b', efectos: [ef('inicio_turno', recurso('-4')),
        ...(stat ? [ef('siempre', { tipo: 'bono_estadistica', estadistica: stat, valor: -2 })] : [])] } },
    { id: 'aturdimiento', nombre: 'Aturdimiento', resumen: 'No puede atacar, usar habilidades u objetos ni moverse durante 1 turno.',
      datos: { duracion: 1, color: '#d6b04a', impide: ['atacar', 'habilidades', 'objetos', 'mover'], efectos: [] } },
    { id: 'regeneracion', nombre: 'Regeneración', resumen: `Recupera ${vida} al empezar cada turno.`,
      datos: { duracion: 3, color: '#6fb7a8', efectos: [ef('inicio_turno', recurso('5'))] } },
    { id: 'escudo', nombre: 'Escudo', resumen: escudo ? `El daño se resta primero de «${escudo}»; al acabarse, lo que quede se pierde.`
      : 'El daño se resta primero de un recurso (crea en Reglas un recurso «Escudo» que empiece vacío y elígelo aquí).',
      datos: { duracion: 3, color: '#4f8fd1', efectos: [ef('siempre', { tipo: 'absorber_dano', recurso: escudo }),
        ...(escudo ? [ef('al_terminar_estado', { tipo: 'modificar_recurso', recurso: escudo, formula: `-[${escudo}]` })] : [])] } },
    { id: 'espinas', nombre: 'Espinas', resumen: 'Devuelve el 30 % del daño a quien le ataca.',
      datos: { duracion: 3, color: '#7ac74f', efectos: [ef('al_ser_atacado', { tipo: 'devolver_dano', valor: 30 })] } },
    { id: 'proteccion', nombre: 'Protección', resumen: 'Recibe la mitad de daño de los ataques.',
      datos: { duracion: 3, color: '#9fb4c9', efectos: [ef('al_ser_atacado', { tipo: 'reducir_dano', valor: 50, unidad: 'porcentaje' })] } },
    { id: 'silencio', nombre: 'Silencio', resumen: etiqueta ? `No puede usar habilidades con la etiqueta «${etiqueta}».` : 'No puede usar habilidades (con etiquetas, puedes bloquear solo las de un tipo).',
      datos: { duracion: 2, color: '#8d9aac', ...(etiqueta ? { impide_etiquetas: [etiqueta] } : { impide: ['habilidades'] }), efectos: [] } },
    { id: 'confusion', nombre: 'Confusión', resumen: 'Al atacar, la mitad de las veces se golpea a sí mismo.',
      datos: { duracion: 2, color: '#b07ad9', efectos: [ef({ tipo: 'al_intentar', accion: 'atacar' }, { tipo: 'redirigir_ataque', hacia: 'quien_ataca' }, prob(50))] } },
    { id: 'reflejo', nombre: 'Reflejo', resumen: 'Un 30 % de los ataques que recibe rebotan a quien los lanza.',
      datos: { duracion: 2, color: '#e8ecf4', efectos: [ef('al_ser_atacado', { tipo: 'redirigir_ataque', hacia: 'quien_ataca' }, prob(30))] } },
    { id: 'hemorragia', nombre: 'Hemorragia', resumen: `Pierde ${vida} cada vez que intenta moverse y al terminar su turno.`,
      datos: { duracion: 3, color: '#c4533f', efectos: [ef({ tipo: 'al_intentar', accion: 'mover' }, recurso('-2')), ef('fin_turno', recurso('-1'))] } },
    { id: 'marca', nombre: 'Marca explosiva', resumen: `Al acabarse su duración, explota: pierde 10 de ${vida}.`,
      datos: { duracion: 2, color: '#f0b44c', efectos: [ef({ tipo: 'al_terminar_estado', motivo: 'se_acaba' }, recurso('-10'))] } },
  ];
}

/** Ventana para elegir: «En blanco» o una plantilla. → { nombre, datos } | {} (en blanco) | null (cancelar) */
export function elegirPlantillaEstado(dialogo) {
  const lista = plantillasEstado();
  let elegir = () => {};
  const tarjeta = (p) => h('button', { type: 'button', class: 'plantilla-tarjeta', 'data-plantilla': p.id, onclick: () => elegir(p) },
    h('strong', null, p.nombre), h('span', { class: 'tenue pequeno' }, p.resumen));
  return dialogo({
    titulo: 'Nuevo estado',
    contenido: h('div', { class: 'plantillas' },
      h('p', { class: 'ayuda' }, 'Empieza en blanco o desde una plantilla. Una plantilla es un estado normal ya armado: después puedes cambiar todo.'),
      h('button', { type: 'button', class: 'plantilla-tarjeta plantilla-blanco', 'data-plantilla': '', onclick: () => elegir({}) },
        h('strong', null, '＋ En blanco'), h('span', { class: 'tenue pequeno' }, 'Un estado vacío.')),
      h('div', { class: 'plantillas-rejilla' }, lista.map(tarjeta))),
    botones: [{ texto: 'Cancelar', valor: null }],
    alMostrar: (_caja, cierre) => { elegir = (p) => cierre(p.id ? { nombre: p.nombre, datos: { descripcion: p.resumen, ...p.datos } } : {}); },
  });
}
