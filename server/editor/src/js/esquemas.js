// esquemas.js — Describe cada tipo de recurso: qué campos tiene y cómo se muestran. El formulario se construye solo a partir de aquí.
// Añadir un campo nuevo a un recurso = añadir una línea en `campos` (y en el servidor, su validación).

const estadisticasDe = (c) => (c?.config?.juego?.estadisticas || []);
const recursosDe = (c) => (c?.config?.juego?.recursos || []);

/** Campos que solo se muestran si la campaña usa niveles (Reglas → Niveles y experiencia). */
const conNiveles = (cfg) => !!cfg?.juego?.niveles?.activo;

export const CATEGORIAS = {
  habilidades: {
    singular: 'habilidad', plural: 'Habilidades', icono: '⚔️', genero: 'f',
    nombreNuevo: () => 'Habilidad nueva',
    ayuda: 'Lo que los personajes y NPC pueden hacer en combate: golpear, lanzar hechizos, curar…',
    plantilla: (c) => ({ nombre: '', descripcion: '', tipo: 'dano', objetivo: 'enemigo', alcance: 1, coste: {},
      formula: `[a.${estadisticasDe(c)[0]?.nombre || 'Fuerza'}] + 1d6` }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción', ayuda: 'Se muestra al jugador.' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'icons' },
      { t: 'opciones', k: 'tipo', etiqueta: '¿Qué hace?', opciones: [['dano', 'Hace daño'], ['curacion', 'Cura'], ['efecto', 'Solo efecto']],
        ayuda: '«Solo efecto»: no hace daño ni cura; sirve para activar poderes, poner estados o mover (no necesita fórmula).' },
      { t: 'seleccion', k: 'objetivo', etiqueta: '¿A quién se dirige?', opciones: [['enemigo', 'A un rival (enemigo o neutral)'], ['aliado', 'A un aliado (jugadores y NPC aliados)'], ['cualquiera', 'A cualquiera (también aliados)'], ['uno_mismo', 'A sí mismo']] },
      { t: 'numero', k: 'alcance', etiqueta: 'Alcance', sufijo: 'casillas', min: 0, max: 100, ayuda: '1 = cuerpo a cuerpo. Las diagonales cuentan como 1 casilla.' },
      { t: 'interruptor', k: 'sin_limite', etiqueta: 'Alcance sin límite', defecto: false, ayuda: 'Encendido = llega a cualquier parte del mapa (el alcance de arriba no cuenta).' },
      { t: 'interruptor', k: 'atraviesa_muros', etiqueta: 'Atraviesa muros', defecto: true, ayuda: 'Apagado = necesita ver al objetivo: no funciona si hay en medio una casilla que «bloquea la vista» (muros, puertas cerradas…).' },
      { t: 'area', k: 'area', etiqueta: 'Área', ayuda: 'Con un área, al usarla en la partida se puede apuntar a un token o a una casilla vacía, y se ven marcadas las casillas que alcanzará.' },
      { t: 'numero', k: 'golpes', etiqueta: 'Golpes', sufijo: 'veces', min: 1, max: 10, defecto: 1, ayuda: 'Cuántas veces golpea cada vez que se usa. Cada golpe tira sus propios dados (por ejemplo, «ataca dos veces»).' },
      { t: 'mover', k: 'mover_objetivo', etiqueta: 'Mueve al objetivo', ayuda: 'Después del golpe: atraer (por ejemplo, una pinza que lo trae delante de ti) o empujar. No atraviesa muros ni casillas ocupadas.' },
      { t: 'requisitos', k: 'requisitos', etiqueta: 'Solo se puede usar si…', ayuda: '«El objetivo»: a quien no los cumple no le afecta (por ejemplo, «no tiene la etiqueta Volador» para un ataque que solo da a los que están en tierra). «Él mismo»: si no los cumple, no la puede usar.' },
      { t: 'etiquetas', k: 'etiquetas', etiqueta: 'Etiquetas (tipo, elemento…)', ayuda: 'Si la fórmula usa ventaja(), se mira la tabla de ventajas entre estas etiquetas y las del objetivo.' },
      { t: 'interruptor', k: 'etiquetas_del_usuario', etiqueta: 'Cuenta también el tipo de quien la usa', defecto: false, ayuda: 'Encendido = ventaja() mira además las etiquetas de quien la usa (su raza, especie, elemento…). Así un mismo ataque es «de Fuego» si lo usa una criatura de Fuego.' },
      { t: 'valores', k: 'coste', etiqueta: 'Cuesta', de: 'recursos', modo: 'costes', ayuda: 'Cuánto gasta de cada recurso al usarla (vacío = gratis).' },
      { t: 'valoresLibres', k: 'valores', etiqueta: 'Valores propios', ayuda: 'Números de esta habilidad que su fórmula usa como [h.Nombre]. Ejemplo: Potencia 30 → [h.Potencia]. Así varias habilidades comparten la misma fórmula y solo cambia su valor.' },
      { t: 'formula', k: 'formula', etiqueta: 'Fórmula del daño o la curación', habilidad: true, ayuda: 'Obligatoria salvo en las de «Solo efecto».' },
      { t: 'critico', k: 'critico', etiqueta: 'Crítico' },
      { t: 'ref', k: 'aplica_estado', etiqueta: 'Pone este estado a cada objetivo', cat: 'estados', ayuda: 'Por ejemplo «Envenenado», o un estado propio como «Furia» en una habilidad «a sí mismo».' },
      { t: 'interruptor', k: 'aplicar_si_falla', etiqueta: 'Aplicar el estado y los efectos aunque falle', defecto: false, ayuda: 'Un ataque que hace 0 de daño (o que la defensa anula) cuenta como fallo: normalmente no pone su estado ni los efectos «al alcanzar». Márcalo para que se apliquen igual (un aura, un grito…).' },
      { t: 'interruptor', k: 'alternar', etiqueta: 'Si ya lo tiene, se lo quita (activar / desactivar)', defecto: false, ayuda: 'Para poderes que se encienden y se apagan con la misma habilidad.' },
      { t: 'efectos', k: 'efectos', etiqueta: 'Además, a cada objetivo alcanzado…', habilidad: true, ayuda: 'Por ejemplo: aplicarle «Quemado», quitarle aguante o curarte a ti. Se puede poner una probabilidad («Solo si… con una probabilidad de 30 %»).' },
      { t: 'simulador', k: '_simulador', etiqueta: 'Probar' },
    ],
  },
  objetos: {
    singular: 'objeto', plural: 'Objetos', icono: '🎒', genero: 'm',
    nombreNuevo: () => 'Objeto nuevo',
    ayuda: 'Pociones, armas, llaves… Lo que se puede llevar en el inventario y vender en las tiendas.',
    plantilla: () => ({ nombre: '', descripcion: '', tipo: 'misc', precio: 0 }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'icons' },
      { t: 'seleccion', k: 'tipo', etiqueta: 'Tipo', opciones: [['consumible', 'Consumible (se gasta al usarlo)'], ['equipo', 'Equipo'], ['misc', 'Otro']] },
      { t: 'numero', k: 'precio', etiqueta: 'Precio', sufijo: 'monedas', min: 0, max: 1000000 },
      { t: 'interruptor', k: 'equipable', etiqueta: 'Se puede equipar', defecto: (o) => o.tipo === 'equipo', ayuda: 'Solo si la campaña usa equipamiento (Reglas → Funciones de la mesa): entonces sus efectos «siempre» solo cuentan mientras está equipado.' },
      { t: 'texto', k: 'hueco', etiqueta: 'Hueco', ayuda: 'Dónde se lleva (Cabeza, Pecho, Pies…), uno de los huecos de las reglas. Solo se puede llevar un objeto por hueco. Vacío = no ocupa hueco.' },
      { t: 'efectoObjeto', k: 'efecto', etiqueta: 'Al usarlo (efecto sencillo)' },
      { t: 'efectos', k: 'efectos', etiqueta: 'Efectos (mientras lo lleve encima o al usarlo)', objeto: true,
        ayuda: '«Siempre» = bonos mientras lo lleve. «Al usarlo» = lo que pasa al usarlo (quitar un estado, curar, sumar experiencia…), siempre sobre quien lo usa.' },
    ],
  },
  enemigos: {
    singular: 'NPC', plural: 'NPC', icono: '🧑‍🤝‍🧑', genero: 'm',
    nombreNuevo: () => 'NPC nuevo',
    ayuda: 'Personajes que no son de jugadores: tenderos, guardias, criaturas, villanos… Eliges si son aliados, neutrales o enemigos. El GM los coloca en el mapa y cada copia tiene sus propios puntos de vida.',
    plantilla: (c) => ({
      nombre: '', descripcion: '', bando: 'neutral',
      stats: Object.fromEntries(estadisticasDe(c).filter((e) => e.para_todos !== false).map((e) => [e.nombre, e.valor_inicial ?? 10])),
      recursos: Object.fromEntries(recursosDe(c).filter((r) => r.para_todos !== false).map((r) => [r.nombre, r.maximo_inicial ?? 100])),
      habilidades: [],
    }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'categoriaNpc', k: 'categoria', etiqueta: 'Categoría', ayuda: 'Para ordenar la lista de NPC en grupos que se pliegan (Aliados, Enemigos, Bosque, Jefes…), aquí y en el Panel del GM de la partida. Escribe una nueva o elige una que ya uses. Vacío = «Sin categoría».' },
      { t: 'seleccion', k: 'bando', etiqueta: '¿De qué lado está?', opciones: [['neutral', 'Neutral: no está con nadie (se puede atacar, según las reglas)'], ['aliado', 'Aliado: ayuda a los jugadores'], ['enemigo', 'Enemigo: se enfrenta a los jugadores']], ayuda: 'El GM puede cambiarlo en plena partida (por ejemplo, si un neutral se enfada). Quién puede atacar a cada bando se decide en «Reglas del juego → Funciones de la mesa».' },
      { t: 'etiquetas', k: 'etiquetas', etiqueta: 'Etiquetas (tipo, elemento…)', ayuda: 'Tipos de este NPC (No-muerto, Fuego…): cuentan en la tabla de ventajas y en las condiciones «Tiene una etiqueta».' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen del token', carpeta: 'tokens' },
      { t: 'numero', k: 'nivel', etiqueta: 'Nivel', min: 1, max: 100, defecto: 1, ayuda: 'Para las fórmulas que usan [Nivel] (si la campaña usa niveles).' },
      { t: 'valores', k: 'stats', etiqueta: 'Estadísticas', de: 'stats', modo: 'valores', ayuda: 'Los valores del NPC (los de la campaña se definen en «Reglas del juego»).' },
      { t: 'valores', k: 'recursos', etiqueta: 'Recursos máximos', de: 'recursos', modo: 'valores', ayuda: 'Vida, magia… que tiene al empezar. El recurso de vida no puede ser 0.' },
      { t: 'valores', k: 'experiencia', etiqueta: 'Experiencia que cede', de: 'experiencia', modo: 'costes', ayuda: 'Lo que reciben los jugadores al derrotarlo (por tipo de experiencia; 0 = nada). El GM puede cambiarlo en cada token. Solo cuenta si la campaña usa niveles.' },
      { t: 'refs', k: 'habilidades', etiqueta: 'Habilidades', cat: 'habilidades', vacio: 'Añadir una habilidad…' },
      { t: 'inventario', k: 'inventario', etiqueta: 'Lleva' },
      { t: 'sonidos', k: 'sonidos', etiqueta: 'Sonidos asociados', ayuda: 'Efectos de la lista de «Sonidos» que el GM puede lanzar con este NPC.' },
      { t: 'numero', k: 'dinero', etiqueta: 'Dinero que lleva', min: 0, max: 1000000000, defecto: 0, ayuda: 'Lo que recibe quien lo derrote o le robe, o lo que tiene para comerciar. En la unidad más pequeña de la moneda (Reglas → Sistema).' },
    ],
  },
  grupos: {
    singular: 'grupo', plural: 'Grupos de elección', icono: '🧬', genero: 'm',
    nombreNuevo: () => 'Nueva categoría',          // se ve al momento en la lista; el GM la renombra (Raza, Clase, Origen…)
    ayuda: 'Una categoría que el jugador elige al crear su personaje: Raza, Clase, Origen… Dentro de cada grupo defines sus opciones.',
    plantilla: () => ({ nombre: '', descripcion: '', obligatorio: true, transformacion: 'no' }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre del grupo', obligatorio: true, ayuda: 'Por ejemplo: Raza, Clase, Origen.' },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'interruptor', k: 'obligatorio', etiqueta: 'El jugador debe elegir una opción', ayuda: 'Si lo desactivas, podrá dejarlo en blanco.' },
      { t: 'seleccion', k: 'transformacion', etiqueta: '¿Se puede cambiar en plena partida?', opciones: [['no', 'No: se elige al crear el personaje'], ['formas', 'Sí, como formas (ir y volver: humano ↔ lobo)'], ['evolucion', 'Sí, como evolución (solo hacia delante)']],
        ayuda: 'Para licántropos, cambiaformas, criaturas que evolucionan… Al cambiar, se aplican los bonos, habilidades, rasgos, etiquetas, recursos e imagen de la opción nueva; la vida se mantiene en proporción. El GM siempre puede transformar; los jugadores solo si lo permites en «Reglas del juego → Personajes».' },
      { t: 'soloSi', k: 'solo_si', etiqueta: 'Solo aparece si…', ayuda: 'Por ejemplo, «Escuela de magia» solo aparece si la Clase es Mago. Vacío = aparece siempre.' },
    ],
  },
  opciones: {
    singular: 'opción', plural: 'Opciones', icono: '🧬', genero: 'f',
    nombreNuevo: () => 'Opción nueva',
    ayuda: 'Una opción concreta de un grupo (Elfo, Mago…). Puede modificar estadísticas y dar rasgos y habilidades.',
    plantilla: (c) => ({ grupo: Object.keys(c.recursos.grupos || {})[0] || '', nombre: '', descripcion: '', bonos: {}, estadisticas: {}, recursos: {}, puntos_extra: 0, rasgos: [], habilidades: [] }),
    campos: [
      { t: 'ref', k: 'grupo', etiqueta: 'Pertenece al grupo', cat: 'grupos', obligatorio: true, sinVacio: true },
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'icons' },
      { t: 'valores', k: 'bonos', etiqueta: 'Estadísticas que modifica', de: 'stats', modo: 'bonos', ayuda: 'Suma (+) o resta (−) a las estadísticas de quien la elija. 0 = sin cambio.' },
      { t: 'interruptor', k: 'elegible', etiqueta: 'Se puede elegir al crear un personaje', defecto: true, ayuda: 'Apágalo para formas a las que solo se llega transformándose o que solo da el GM.' },
      { t: 'valores', k: 'estadisticas', etiqueta: 'Valor inicial propio', de: 'stats', modo: 'opcional',
        ayuda: 'Opcional: marca una estadística para que quien elija esta opción empiece con otro valor (los bonos de arriba se suman después). Qué opciones tienen cada estadística se decide en «Reglas del juego → Estadísticas y recursos».' },
      { t: 'valores', k: 'recursos', etiqueta: 'Máximo inicial propio', de: 'recursos', modo: 'opcional',
        ayuda: 'Opcional: otro máximo para quien elija esta opción. Qué opciones tienen cada recurso se decide en «Reglas del juego → Estadísticas y recursos».' },
      { t: 'numero', k: 'puntos_extra', etiqueta: 'Puntos extra para repartir', sufijo: 'puntos', min: 0, max: 10000, ayuda: 'Se suman a los puntos de la campaña al crear el personaje. 0 = ninguno.' },
      { t: 'refs', k: 'rasgos', etiqueta: 'Rasgos que da', cat: 'rasgos', vacio: 'Añadir un rasgo…' },
      { t: 'etiquetas', k: 'etiquetas', etiqueta: 'Etiquetas que da', ayuda: 'Quien elija esta opción tiene estas etiquetas (por ejemplo, una raza «No-muerto» o una especie de tipo Fuego).' },
      { t: 'refs', k: 'habilidades', etiqueta: 'Habilidades que da', cat: 'habilidades', vacio: 'Añadir una habilidad…' },
      { t: 'imagen', k: 'imagen_forma', etiqueta: 'Imagen del token con esta forma', carpeta: 'tokens', ayuda: 'Solo para grupos que se pueden cambiar en partida (formas o evolución): el token muestra esta imagen mientras tenga esta forma. Vacío = su imagen de siempre.' },
      { t: 'refs', k: 'evoluciona_a', etiqueta: 'Puede evolucionar a', cat: 'opciones', vacio: 'Añadir una opción…', filtrar: (id, obj, rec) => rec.opciones?.[id]?.grupo === obj.grupo && rec.opciones?.[id]?.nombre !== obj.nombre,
        ayuda: 'Solo en grupos de «evolución»: a qué opciones del mismo grupo puede pasar (Cría → Adulto). Las formas, en cambio, pueden ir a cualquiera.' },
      { t: 'numero', solo: conNiveles, k: 'puntos_por_nivel', etiqueta: 'Puntos para repartir al subir de nivel', sufijo: 'por nivel', min: 0, max: 1000, ayuda: 'Se suman a los de la campaña (Reglas → Niveles y experiencia) para quien elija esta opción. 0 = solo los de la campaña. Solo cuenta si los niveles los da el programa.' },
      { t: 'valores', solo: conNiveles, k: 'recursos_por_nivel', etiqueta: 'Máximo de recursos al subir de nivel', de: 'recursos', modo: 'bonos', ayuda: 'Cuánto sube (o baja) el máximo de cada recurso por nivel para quien elija esta opción (un guerrero +10 de vida, un mago +2). Se suma a lo de la campaña. 0 = nada.' },
      { t: 'aprende', solo: conNiveles, k: 'aprende', etiqueta: 'Aprende al subir de nivel', ayuda: 'Habilidades o hechizos que gana quien elija esta opción al llegar a ese nivel (solo si la campaña usa niveles: Reglas → Niveles y experiencia).' },
      { t: 'statSola', k: 'iniciativa', etiqueta: 'Iniciativa con', vacio: 'La de la campaña', ayuda: 'Estadística con la que tira la iniciativa quien elija esta opción (por ejemplo, un Mago con Inteligencia). Vacío = la de «Reglas del juego».' },
    ],
  },
  rasgos: {
    singular: 'rasgo', plural: 'Rasgos', icono: '✨', genero: 'm',
    nombreNuevo: () => 'Rasgo nuevo',
    ayuda: 'Habilidades pasivas: bonos permanentes o cosas que ocurren solas en ciertos momentos (al atacar, al empezar el turno…).',
    plantilla: () => ({ nombre: '', descripcion: '', efectos: [] }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'icons' },
      { t: 'efectos', k: 'efectos', etiqueta: 'Qué hace', estado: false },
    ],
  },
  estados: {
    singular: 'estado', plural: 'Estados', icono: '🌀', genero: 'm',
    nombreNuevo: () => 'Estado nuevo',
    ayuda: 'Condiciones temporales: veneno, aturdimiento, bendición… Duran un número de turnos y pueden hacer algo cada turno.',
    plantilla: () => ({ nombre: '', descripcion: '', duracion: 3, efectos: [] }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen', carpeta: 'icons' },
      { t: 'color', k: 'color', etiqueta: 'Color en el token', ayuda: 'Quien lo sufre lleva una insignia pequeña de este color (con la imagen del estado dentro, si tiene). Vacío = morado.' },
      { t: 'numero', k: 'duracion', etiqueta: 'Dura', sufijo: 'turnos', min: 0, max: 1000, ayuda: '0 = hasta que se quite.' },
      { t: 'casillas', k: 'impide', etiqueta: 'Mientras dure, no puede…', opciones: [['atacar', 'Atacar'], ['habilidades', 'Usar habilidades'], ['objetos', 'Usar objetos'], ['mover', 'Moverse']],
        ayuda: 'Aturdido, dormido, paralizado, silenciado… El GM siempre puede moverlo.' },
      { t: 'ref', k: 'al_terminar', etiqueta: 'Al terminar, pasa a', cat: 'estados', ayuda: 'Por ejemplo «Quemadura leve» → «Quemadura grave». Solo si dura un número de turnos.' },
      { t: 'etiquetas', k: 'impide_etiquetas', etiqueta: 'Mientras dure, no puede usar habilidades con estas etiquetas',
        ayuda: 'Un «Silencio» que solo bloquea la magia: marca la etiqueta Magia. Las habilidades sin esas etiquetas se siguen pudiendo usar.' },
      { t: 'etiquetas', k: 'etiquetas', etiqueta: 'Etiquetas mientras dure', ayuda: 'Por ejemplo, «Mojado» da la etiqueta Agua mientras dura.' },
      { t: 'seleccion', k: 'al_reaplicar', etiqueta: 'Si se lo vuelven a aplicar a quien ya lo tiene', defecto: 'renovar',
        opciones: [['renovar', 'Vuelve a empezar su duración'], ['ignorar', 'No pasa nada (se queda como está)'], ['sumar', 'Se suma la duración'], ['acumular', 'Acumula cargas (y vuelve a empezar su duración)']],
        ayuda: 'Con cargas, sus fórmulas pueden usar [Cargas] (por ejemplo «-2 * [Cargas]») y sus bonos fijos se multiplican por las cargas.' },
      { t: 'numero', k: 'max_cargas', etiqueta: 'Cargas como mucho', sufijo: 'cargas', min: 1, max: 100, defecto: 5, ayuda: 'Solo cuenta si acumula cargas.' },
      { t: 'efectos', k: 'efectos', etiqueta: 'Qué hace', estado: true },
    ],
  },
  tiles: {
    singular: 'tile', plural: 'Tiles (casillas)', icono: '🧱', genero: 'm',
    nombreNuevo: () => 'Tile nuevo',
    ayuda: 'Tipos de casilla para pintar los mapas: muro, agua, hierba alta, barricada, lava… Cada uno puede bloquear el paso, esconder, romperse o hacer algo a quien lo pise. Con o sin gráficos.',
    plantilla: () => ({ nombre: '', descripcion: '', color: '#6b7a55', transitable: true }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción', ayuda: 'Se muestra al analizar la casilla.' },
      { t: 'interruptor', k: 'invisible', etiqueta: 'Invisible', defecto: false, ayuda: 'No se dibuja en la partida (solo actúa: bloquea, daña, tapa la vista…), aunque tenga color o imagen. Útil sobre una imagen de mapa. En el editor se ve como un recuadro punteado.' },
      { t: 'color', k: 'color', etiqueta: 'Color', ayuda: 'Sin color ni imagen, el tile no se dibuja (solo actúa): útil sobre una imagen de mapa.' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen (opcional)', carpeta: 'tiles' },
      { t: 'interruptor', k: 'transitable', etiqueta: 'Se puede pasar', defecto: true, ayuda: 'Apagado = muro: nadie puede entrar ni colocarse aquí.' },
      { t: 'lados', k: 'bloquea_lados', etiqueta: 'Lados cerrados', ayuda: 'Como una valla o un mostrador: por los lados marcados no se puede entrar ni salir de la casilla, aunque se pueda estar en ella. Los jugadores no pueden atravesarlos al mover su token (el GM sí).' },
      { t: 'interruptor', k: 'bloquea_vision', etiqueta: 'Bloquea la vista', defecto: false, ayuda: 'Con niebla de guerra, no se ve a través de esta casilla (muros, puertas cerradas, humo espeso). La propia casilla sí se ve.' },
      { t: 'interruptor', k: 'esconde', etiqueta: 'Esconde a quien esté encima', defecto: false, ayuda: 'Hierba alta, humo, sombras: los demás jugadores no ven a quien esté aquí (el GM sí).' },
      { t: 'rompible', k: 'rompible', etiqueta: 'Se puede romper', ayuda: 'Puertas, barricadas, paredes frágiles. Se rompen a golpes (los dan el GM o, si lo permites en Reglas, los jugadores).' },
      { t: 'efectos', k: 'efectos', etiqueta: 'Qué hace', tile: true },
    ],
  },
  tiendas: {
    singular: 'tienda', plural: 'Tiendas', icono: '🏪', genero: 'f',
    nombreNuevo: () => 'Tienda nueva',
    ayuda: 'Lugares donde los jugadores compran (y, si quieres, venden) objetos. El GM abre y cierra cada tienda durante la partida, desde la ventana de GM del cliente.',
    plantilla: () => ({ nombre: '', descripcion: '', articulos: [], recompra: 0 }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Nombre', obligatorio: true },
      { t: 'largo', k: 'descripcion', etiqueta: 'Descripción' },
      { t: 'articulos', k: 'articulos', etiqueta: 'Artículos a la venta' },
      { t: 'refs', k: 'mapas', etiqueta: 'Mapas donde está', cat: 'mapas', vacio: 'Añadir un mapa…', ayuda: 'Solo se puede comprar o vender en ella mientras la partida está en uno de estos mapas (y el GM la tiene abierta). Sin ninguno = en cualquier mapa.' },
      { t: 'numero', k: 'recompra', etiqueta: 'Compra objetos a los jugadores (% del precio)', min: 0, max: 100, defecto: 0, ayuda: '0 = la tienda no compra nada. 50 = paga la mitad del precio por cada objeto que le vendan. Los precios están en la unidad más pequeña de la moneda.' },
    ],
  },
  mapas: {
    singular: 'mapa', plural: 'Mapas', icono: '🗺️', genero: 'm',
    nombreNuevo: () => 'Mapa nuevo',
    ayuda: 'Los lugares donde transcurre la partida.',
    plantilla: () => ({ nombre: '', descripcion: '', ancho: 20, alto: 14, tamano_tile: 64, tile_base: '', casillas: {}, inicio: { x: 2, y: 4 } }),
    especial: 'mapa',
    campos: [],
  },
  diario: {
    singular: 'página', plural: 'Diario', icono: '📖', genero: 'f',
    nombreNuevo: () => 'Página nueva',
    ayuda: 'Lo que los jugadores leen en la partida: tipos de armas, historia del mundo, reglas de la casa, cartas, pistas… Tú decides qué ve cada uno, y puedes revelar páginas en plena partida.',
    plantilla: () => ({ nombre: '', seccion: '', texto: '', visible: 'todos' }),
    campos: [
      { t: 'texto', k: 'nombre', etiqueta: 'Título', obligatorio: true },
      { t: 'texto', k: 'seccion', etiqueta: 'Sección', placeholder: 'Armas, Mundo, Personajes…', ayuda: 'Las páginas con la misma sección salen juntas en el diario. Vacío = «General».' },
      { t: 'opciones', k: 'visible', etiqueta: '¿Quién la ve al empezar?', opciones: [['todos', '👁 Todos los jugadores'], ['oculta', '🔒 Nadie (la revelo yo)']],
        ayuda: 'Durante la partida, el GM puede revelarla u ocultarla, para todos o solo para algunos jugadores, desde el propio diario.' },
      { t: 'imagen', k: 'imagen', etiqueta: 'Imagen (opcional)', carpeta: 'otros' },
      { t: 'largo', k: 'texto', etiqueta: 'Texto', max: 20000, filas: 16,
        ayuda: 'Una línea vacía separa párrafos. «# Título» crea un subtítulo, «- algo» una lista y **así** se escribe en negrita.' },
    ],
  },
};

/** Árbol de la izquierda. */
export const EXPLORADOR = [
  { tipo: 'reglas', etiqueta: 'Reglas del juego', icono: '⚙️', ayuda: 'Estadísticas, permisos, cuentas y todo lo que activa o desactiva funciones.' },
  { tipo: 'jugadores', etiqueta: 'Jugadores y fichas', icono: '👥', ayuda: 'Cuentas de los jugadores, sus contraseñas y permisos, y las fichas de sus personajes.' },
  { tipo: 'cat', cat: 'habilidades' },
  { tipo: 'cat', cat: 'objetos' },
  { tipo: 'cat', cat: 'enemigos' },
  { tipo: 'grupos', etiqueta: 'Razas, clases y orígenes', icono: '🧬', ayuda: 'Lo que se elige al crear un personaje (raza, clase, origen…) y lo que da cada opción.' },
  { tipo: 'cat', cat: 'rasgos' },
  { tipo: 'cat', cat: 'estados' },
  { tipo: 'cat', cat: 'mapas' },
  { tipo: 'cat', cat: 'tiles' },
  { tipo: 'sonidos', etiqueta: 'Sonidos', icono: '🎵', ayuda: 'Música, ambiente y efectos de sonido de la campaña, por categorías.' },
  { tipo: 'cat', cat: 'tiendas' },
  { tipo: 'cat', cat: 'diario' },
];

/** Lo que citan los efectos: estados que aplican y lo que miran sus condiciones (estados, objetos, razas/clases). */
function refsEfectos(efectos, r) {
  if (!Array.isArray(efectos)) return;
  for (const e of efectos) {
    if (['aplicar_estado', 'quitar_estado'].includes(e?.hacer?.tipo) && e.hacer.estado) r.push(['estados', e.hacer.estado]);
    for (const c of Array.isArray(e?.si) ? e.si : []) {
      if (c?.estado) r.push(['estados', c.estado]);
      if (c?.objeto) r.push(['objetos', c.objeto]);
      if (c?.opcion) r.push(['opciones', c.opcion]);
    }
  }
}

/** A qué otros recursos apunta un recurso (para avisar al borrar y para «se usa en»). → [[categoría, id], …] */
export function referenciasDe(cat, d) {
  const r = [];
  if (!d || typeof d !== 'object') return r;
  const lista = (c, v) => { if (Array.isArray(v)) for (const x of v) r.push([c, typeof x === 'object' && x ? x.objeto : x]); };
  if (cat === 'grupos') {
    if (d.solo_si?.grupo) r.push(['grupos', d.solo_si.grupo]);
    lista('opciones', d.solo_si?.opciones);
  } else if (cat === 'opciones') {
    if (d.grupo) r.push(['grupos', d.grupo]);
    lista('rasgos', d.rasgos); lista('habilidades', d.habilidades);
    if (Array.isArray(d.aprende)) for (const a of d.aprende) if (a?.habilidad) r.push(['habilidades', a.habilidad]); lista('opciones', d.evoluciona_a);
  } else if (cat === 'enemigos') {
    lista('habilidades', d.habilidades);
    if (Array.isArray(d.inventario)) for (const x of d.inventario) r.push(['objetos', typeof x === 'object' && x ? x.objeto : x]);
  } else if (cat === 'tiendas') {
    if (Array.isArray(d.articulos)) for (const a of d.articulos) if (a?.objeto) r.push(['objetos', a.objeto]);
    for (const m of d.mapas || []) r.push(['mapas', m]);
  } else if (cat === 'tiles') {
    if (d.rompible?.se_convierte_en) r.push(['tiles', d.rompible.se_convierte_en]);
    refsEfectos(d.efectos, r);
  } else if (cat === 'mapas') {
    if (d.tile_base) r.push(['tiles', d.tile_base]);
    for (const t of Object.keys(d.casillas || {})) r.push(['tiles', t]);
    for (const capa of Object.values(d.capas || {})) for (const t of Object.keys(capa || {})) r.push(['tiles', t]);
  } else if (cat === 'habilidades') {
    refsEfectos(d.efectos, r);
    if (d.aplica_estado) r.push(['estados', d.aplica_estado]);
    refsEfectos([{ si: d.requisitos }], r);
  } else if (cat === 'rasgos' || cat === 'estados' || cat === 'objetos') {
    if (cat === 'estados' && d.al_terminar) r.push(['estados', d.al_terminar]);
    refsEfectos(d.efectos, r);
  }
  return r.filter(([, id]) => id);
}

/** Una línea corta para la lista de cada categoría («Hace daño · alcance 1», «Aliado», «20 × 14 casillas»…). */
export function resumen(cat, d) {
  if (!d || typeof d !== 'object') return '';
  const corto = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > 70 ? `${s.slice(0, 68)}…` : s; };
  const casillas = (n) => `${n} ${n === 1 ? 'casilla' : 'casillas'}`;
  switch (cat) {
    case 'habilidades': return [d.tipo === 'curacion' ? 'Cura' : d.tipo === 'efecto' ? 'Solo efecto' : 'Hace daño', d.sin_limite ? 'alcance sin límite' : d.alcance != null ? `alcance ${casillas(Number(d.alcance) || 0)}` : null,
      { explosion: 'explosión', linea: 'línea', frente: 'frente', cono: 'cono', casillas: 'área dibujada' }[d.area?.forma] || null, d.golpes > 1 ? `${d.golpes} golpes` : null, ...(Array.isArray(d.etiquetas) ? d.etiquetas : [])].filter(Boolean).join(' · ');
    case 'objetos': return [{ consumible: 'Consumible', equipo: 'Equipo' }[d.tipo] || 'Otro', d.precio ? `${d.precio} monedas` : null].filter(Boolean).join(' · ');
    case 'enemigos': return [{ aliado: 'Aliado', enemigo: 'Enemigo' }[d.bando] || 'Neutral', d.nivel > 1 ? `nivel ${d.nivel}` : null].filter(Boolean).join(' · ');
    case 'mapas': return `${d.ancho || '?'} × ${d.alto || '?'} casillas`;
    case 'diario': return [d.seccion || 'General', d.visible === 'oculta' ? '🔒 oculta' : '👁 todos'].join(' · ');
    case 'tiendas': { const n = Array.isArray(d.articulos) ? d.articulos.length : 0; return `${n} ${n === 1 ? 'artículo' : 'artículos'}`; }
    case 'tiles': return [d.transitable === false ? 'No se puede pasar' : 'Se puede pasar', d.esconde ? 'esconde' : null, d.bloquea_vision ? 'tapa la vista' : null, d.bloquea_lados?.length ? `lados cerrados: ${d.bloquea_lados.join(', ')}` : null, d.rompible ? 'se rompe' : null].filter(Boolean).join(' · ');
    case 'estados': return [d.duracion ? `${d.duracion} turnos` : null, corto(d.descripcion)].filter(Boolean).join(' · ');
    default: return corto(d.descripcion);
  }
}
