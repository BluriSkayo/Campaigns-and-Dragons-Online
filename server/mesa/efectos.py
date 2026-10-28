"""
efectos.py — Catálogo extensible de efectos (rasgos, estados, etc.).

Un efecto se compone de tres partes:

    cuando:  momento que lo activa                (disparador)
    si:      condiciones opcionales, TODAS deben cumplirse   (lista de condiciones)
    hacer:   qué ocurre                           (acción)

Añadir un disparador, una condición o una acción nueva = añadir una entrada a DISPARADORES, CONDICIONES
o ACCIONES (y, para que haga algo en la partida, su caso en motor.py).
El Editor del Servidor usa estos mismos catálogos para construir sus formularios, de modo
que no hay que programar una pantalla nueva por cada tipo.

Este módulo SOLO describe y valida los efectos. Aplicarlos durante la partida es otra tarea.

Cada campo se describe con: tipo (estadistica | recurso | estado | objeto | habilidad | eleccion | periodo | etiqueta | entero |
formula | opcion), si es obligatorio, su «etiqueta» para el Editor y, para «opcion», las opciones posibles con
sus textos («textos»). «entero» admite «min», «max» y «sugerido» (valor con el que lo propone el Editor).
El Editor construye sus formularios con esta información.
"""

from __future__ import annotations

from . import formulas

OBJETIVOS = ("uno_mismo", "objetivo")
TEXTOS_OBJETIVO = {"uno_mismo": "Sobre sí mismo", "objetivo": "Sobre el objetivo"}
TEXTOS_QUIEN = {"uno_mismo": "Él mismo", "objetivo": "El objetivo"}
COMPARACIONES = ("menos_de", "al_menos", "igual_a")
TEXTOS_COMPARACION = {"menos_de": "menos de", "al_menos": "al menos", "igual_a": "exactamente"}
SI_NO = ("si", "no")
MAX_CONDICIONES = 10

_QUIEN = {"tipo": "opcion", "opciones": OBJETIVOS, "defecto": "uno_mismo", "etiqueta": "Quién", "textos": TEXTOS_QUIEN}

DISPARADORES = {
    "siempre": {
        "nombre": "Siempre activo",
        "campos": {},
    },
    "inicio_turno": {
        "nombre": "Al empezar su turno",
        "campos": {},
    },
    "fin_turno": {
        "nombre": "Al terminar su turno",
        "campos": {},
    },
    "tirada": {
        "nombre": "Al hacer una tirada",
        "campos": {"estadistica": {"tipo": "estadistica", "obligatorio": False, "etiqueta": "Estadística",
                                   "ayuda": "Solo tiradas de esta estadística (vacío = todas)"}},
    },
    "al_atacar": {
        "nombre": "Al atacar",
        "campos": {},
    },
    "al_ser_atacado": {
        "nombre": "Al recibir un ataque",
        "campos": {},
    },
    "al_derrotar": {
        "nombre": "Al derrotar a alguien",
        "campos": {},
    },
    "al_ser_derrotado": {
        "nombre": "Al ser derrotado",
        "campos": {},
    },
    "al_entrar": {
        "nombre": "Al pisar la casilla",
        "campos": {},
    },
    "al_usar": {
        "nombre": "Al usarlo",
        "campos": {},
    },
    "al_cambiar_momento": {
        "nombre": "Al cambiar el momento del día",
        "campos": {},
    },
    "al_cambiar_clima": {
        "nombre": "Al cambiar el clima",
        "campos": {},
    },
    "al_impactar": {
        "nombre": "Al alcanzar a cada objetivo",
        "campos": {},
    },
    "al_recibir_dano": {
        "nombre": "Al recibir daño (de cualquier origen)",
        "campos": {},
        "ayuda": "Ataques, veneno, casillas, daño devuelto… Si alguien lo causó, es «el objetivo». Condición útil: «El daño es…».",
    },
    "al_cruzar_umbral": {
        "nombre": "Al cruzar un umbral de un recurso",
        "campos": {"recurso": {"tipo": "recurso", "obligatorio": True, "etiqueta": "Recurso"},
                   "sentido": {"tipo": "opcion", "opciones": ("baja", "sube"), "defecto": "baja", "etiqueta": "Cuando",
                               "textos": {"baja": "baja de", "sube": "llega a"}},
                   "porcentaje": {"tipo": "entero", "obligatorio": True, "etiqueta": "% de su máximo", "min": 0, "max": 100, "sugerido": 30}},
        "ayuda": "Salta una vez cada vez que lo cruza (no en cada golpe mientras siga por debajo). Ej.: «baja de 30 %» → furia.",
    },
    "al_intentar": {
        "nombre": "Al intentar una acción",
        "campos": {"accion": {"tipo": "opcion", "opciones": ("atacar", "habilidad", "objeto", "mover", "cualquiera"), "defecto": "atacar",
                              "etiqueta": "Acción", "textos": {"atacar": "atacar", "habilidad": "usar una habilidad", "objeto": "usar un objeto",
                                                               "mover": "moverse", "cualquiera": "cualquier acción"}}},
        "ayuda": "Antes de que ocurra: puede impedirla («Impedir la acción»), desviar el ataque («Redirigir el ataque») o hacer algo más "
                 "(perder vida al moverse…). En un ataque, «el objetivo» es a quien ataca.",
    },
    "al_terminar_estado": {
        "nombre": "Al terminar este estado",
        "campos": {"motivo": {"tipo": "opcion", "opciones": ("cualquiera", "se_acaba", "se_quita"), "defecto": "cualquiera", "etiqueta": "Cuándo",
                              "textos": {"cualquiera": "de cualquier forma", "se_acaba": "porque se acaba su duración", "se_quita": "porque se lo quitan"}}},
        "ayuda": "Solo en estados. Ej.: una Marca que explota al acabarse, o un escudo que se vacía.",
    },
}

# Disparadores que solo tienen sentido en ciertos recursos.
SOLO_TILES = {"al_entrar"}
SOLO_OBJETOS = {"al_usar"}
SOLO_HABILIDADES = {"al_impactar"}
SOLO_ESTADOS = {"al_terminar_estado"}

ACCIONES = {
    "bono_estadistica": {
        "nombre": "Bono a una estadística (mientras esté activo)",
        "campos": {"estadistica": {"tipo": "estadistica", "obligatorio": True, "etiqueta": "Estadística"},
                   "valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Valor"}},
        "disparadores": {"siempre"},
    },
    "bono_vision": {
        "nombre": "Sumar o restar casillas de visión (niebla de guerra)",
        "campos": {"valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Casillas"}},
        "disparadores": {"siempre"},
    },
    "bono_tirada": {
        "nombre": "Sumar o restar al resultado de la tirada",
        "campos": {"valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Valor"}},
        "disparadores": {"tirada"},
    },
    "modificar_recurso": {
        "nombre": "Cambiar un recurso (vida, magia…)",
        "campos": {"recurso": {"tipo": "recurso", "obligatorio": True, "etiqueta": "Recurso"},
                   "formula": {"tipo": "formula", "obligatorio": True, "etiqueta": "Cantidad",
                               "ayuda": "Negativo resta, positivo suma. Ej.: -3 o -[a.Fuerza]/2"},
                   "objetivo": {"tipo": "opcion", "opciones": OBJETIVOS, "defecto": "uno_mismo", "etiqueta": "Sobre quién", "textos": TEXTOS_OBJETIVO}},
        "disparadores": None,       # None = cualquiera
    },
    "modificar_estadistica": {
        "nombre": "Sumar o restar a una estadística (para siempre)",
        "campos": {"estadistica": {"tipo": "estadistica", "obligatorio": True, "etiqueta": "Estadística"},
                   "formula": {"tipo": "formula", "obligatorio": True, "etiqueta": "Cantidad",
                               "ayuda": "Ej.: 10 (experiencia), -1 (cordura) o [o.Nivel] * 5. No pasa de su mínimo ni de su máximo."},
                   "objetivo": {"tipo": "opcion", "opciones": OBJETIVOS, "defecto": "uno_mismo", "etiqueta": "A quién", "textos": TEXTOS_OBJETIVO}},
        "disparadores": None,
    },
    # Defensa activa: solo «Al recibir un ataque» (de daño). Se aplican antes de restar la vida, en este orden: anular, reducir, devolver.
    "anular_ataque": {
        "nombre": "Anular el ataque (esquiva o bloqueo total)",
        "campos": {},
        "disparadores": {"al_ser_atacado"},
    },
    "reducir_dano": {
        "nombre": "Reducir el daño recibido",
        "campos": {"valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Cuánto", "min": 0, "max": 100000, "sugerido": 5},
                   "unidad": {"tipo": "opcion", "opciones": ("puntos", "porcentaje"), "defecto": "puntos", "etiqueta": "En",
                              "textos": {"puntos": "puntos", "porcentaje": "% del daño"}}},
        "disparadores": {"al_ser_atacado"},
    },
    "devolver_dano": {
        "nombre": "Devolver parte del daño a quien ataca",
        "campos": {"valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "%", "min": 1, "max": 1000, "sugerido": 50}},
        "disparadores": {"al_ser_atacado"},
    },
    "bono_critico": {
        "nombre": "Crítico más fácil (resta al número necesario)",
        "campos": {"valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Casillas del d20", "min": -19, "max": 19, "sugerido": 1}},
        "disparadores": {"siempre"},
    },
    "quitar_estado": {
        "nombre": "Quitar un estado",
        "campos": {"estado": {"tipo": "estado", "obligatorio": True, "etiqueta": "Estado"},
                   "objetivo": {"tipo": "opcion", "opciones": OBJETIVOS, "defecto": "uno_mismo", "etiqueta": "A quién", "textos": TEXTOS_OBJETIVO}},
        "disparadores": None,
    },
    "aplicar_estado": {
        "nombre": "Aplicar un estado",
        "campos": {"estado": {"tipo": "estado", "obligatorio": True, "etiqueta": "Estado"},
                   "objetivo": {"tipo": "opcion", "opciones": OBJETIVOS, "defecto": "uno_mismo", "etiqueta": "Sobre quién", "textos": TEXTOS_OBJETIVO}},
        "disparadores": None,
    },
    # Escudo: mientras esté activo, el daño se resta primero de ese recurso (y solo lo que sobre, de la vida).
    "absorber_dano": {
        "nombre": "Absorber el daño con un recurso (escudo)",
        "campos": {"recurso": {"tipo": "recurso", "obligatorio": True, "etiqueta": "Recurso que se gasta",
                               "ayuda": "Por ejemplo un recurso «Escudo» que empieza vacío y que llena una habilidad."}},
        "disparadores": {"siempre"},
    },
    # Confusión (quien ataca, «Al intentar: atacar») o Reflejo (quien recibe, «Al recibir un ataque»).
    "redirigir_ataque": {
        "nombre": "Redirigir el ataque",
        "campos": {"hacia": {"tipo": "opcion", "opciones": ("quien_ataca", "aleatorio"), "defecto": "quien_ataca", "etiqueta": "Hacia",
                             "textos": {"quien_ataca": "quien ataca (se golpea a sí mismo / le rebota)", "aleatorio": "otro token al azar"}}},
        "disparadores": {"al_intentar", "al_ser_atacado"},
        "ayuda": "Con «Al intentar: atacar» es una confusión: el golpe va a quien ataca o a otro al azar. Con «Al recibir un ataque» es un "
                 "reflejo: el golpe rebota. Solo ataques a un único objetivo. Suele ir con «Solo si… con una probabilidad».",
    },
    "impedir_accion": {
        "nombre": "Impedir la acción",
        "campos": {},
        "disparadores": {"al_intentar"},
        "ayuda": "La acción no ocurre (no gasta nada) y la mesa ve el aviso. Con una probabilidad, la acción «falla» a veces.",
    },
}

# «objetivo» distinto de uno_mismo solo tiene sentido cuando hay otro participante.
DISPARADORES_CON_OBJETIVO = {"al_atacar", "al_ser_atacado", "al_derrotar", "al_ser_derrotado", "al_impactar", "al_recibir_dano", "al_intentar"}
# Condiciones sobre el golpe que se está dando o recibiendo (crítico, cuánto daño): solo con estos disparadores.
DISPARADORES_CON_GOLPE = {"al_atacar", "al_ser_atacado", "al_impactar", "al_recibir_dano"}

# ── Condiciones («solo si…») ──
# Se leen como una frase en el Editor: «Solo si <nombre> <campos>». Todas las de un efecto deben cumplirse.
# «pasivo: False» = no se puede usar con «siempre» (sería al azar o cambiaría a cada momento sin motivo).
CONDICIONES = {
    "recurso": {
        "nombre": "Un recurso (vida, magia…) está…",
        "campos": {"quien": _QUIEN,
                   "recurso": {"tipo": "recurso", "obligatorio": True, "etiqueta": "Recurso"},
                   "comparacion": {"tipo": "opcion", "opciones": COMPARACIONES, "defecto": "menos_de", "etiqueta": "Comparación", "textos": TEXTOS_COMPARACION},
                   "valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Valor", "min": 0, "max": 100000, "sugerido": 50},
                   "unidad": {"tipo": "opcion", "opciones": ("porcentaje", "puntos"), "defecto": "porcentaje", "etiqueta": "En",
                              "textos": {"porcentaje": "% de su máximo", "puntos": "puntos"}}},
        "ayuda": "Ej.: «Él mismo · Vida · menos de · 50 · % de su máximo». Quien no tiene ese recurso no cumple la condición.",
    },
    "estadistica": {
        "nombre": "Una estadística vale…",
        "campos": {"quien": _QUIEN,
                   "estadistica": {"tipo": "estadistica", "obligatorio": True, "etiqueta": "Estadística"},
                   "comparacion": {"tipo": "opcion", "opciones": COMPARACIONES, "defecto": "al_menos", "etiqueta": "Comparación", "textos": TEXTOS_COMPARACION},
                   "valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Valor", "min": -100000, "max": 100000}},
        "ayuda": "En los efectos «Siempre activo» se mira la estadística con los bonos de raza y clase, pero sin los de otros efectos.",
    },
    "tiene_estado": {
        "nombre": "Tiene un estado",
        "campos": {"quien": _QUIEN,
                   "tiene": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿Lo tiene?", "textos": {"si": "lo tiene", "no": "no lo tiene"}},
                   "estado": {"tipo": "estado", "obligatorio": True, "etiqueta": "Estado"}},
    },
    "lleva_objeto": {
        "nombre": "Lleva un objeto",
        "campos": {"quien": _QUIEN,
                   "tiene": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿Lo lleva?", "textos": {"si": "lo lleva", "no": "no lo lleva"}},
                   "objeto": {"tipo": "objeto", "obligatorio": True, "etiqueta": "Objeto"}},
    },
    "es_opcion": {
        "nombre": "Es de una raza, clase…",
        "campos": {"quien": _QUIEN,
                   "tiene": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿Lo es?", "textos": {"si": "lo es", "no": "no lo es"}},
                   "opcion": {"tipo": "eleccion", "obligatorio": True, "etiqueta": "Raza, clase…"}},
    },
    "bando": {
        "nombre": "Es de un bando",
        "campos": {"quien": {**_QUIEN, "defecto": "objetivo"},
                   "bando": {"tipo": "opcion", "opciones": ("jugador", "aliado", "neutral", "enemigo"), "defecto": "enemigo", "etiqueta": "Bando",
                             "textos": {"jugador": "personaje de un jugador", "aliado": "NPC aliado", "neutral": "NPC neutral", "enemigo": "NPC enemigo"}}},
    },
    "tiene_etiqueta": {
        "nombre": "Tiene una etiqueta (tipo, elemento…)",
        "campos": {"quien": _QUIEN,
                   "tiene": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿La tiene?", "textos": {"si": "la tiene", "no": "no la tiene"}},
                   "etiqueta": {"tipo": "etiqueta", "obligatorio": True, "etiqueta": "Etiqueta"}},
        "ayuda": "Las etiquetas vienen de su raza/clase, del NPC y de sus estados. Se crean en Reglas → Etiquetas y ventajas.",
    },
    "momento_dia": {
        "nombre": "Es un momento del día (día, noche…)",
        "campos": {"periodo": {"tipo": "periodo", "obligatorio": True, "etiqueta": "Momento"}},
        "ayuda": "Necesita «Día y noche» activado en Reglas del juego.",
    },
    "clima": {
        "nombre": "El clima es… (lluvia, niebla…)",
        "campos": {"clima": {"tipo": "clima", "obligatorio": True, "etiqueta": "Clima"}},
        "ayuda": "Necesita «Clima» activado en Reglas del juego (Día, noche y clima). Ejemplo: «Siempre, solo si el clima es Lluvia → restar 2 a la Visión».",
    },
    "en_combate": {
        "nombre": "Hay un combate en marcha",
        "campos": {"activo": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿Combate?", "textos": {"si": "sí, en combate", "no": "no, fuera de combate"}}},
    },
    "critico": {
        "nombre": "El golpe es crítico",
        "campos": {"es": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿Crítico?", "textos": {"si": "sí, crítico", "no": "no es crítico"}}},
        "ayuda": "Solo con «Al atacar», «Al recibir un ataque», «Al alcanzar a cada objetivo» o «Al recibir daño», y si la habilidad usa críticos.",
        "pasivo": False, "golpe": True,
    },
    "dano": {
        "nombre": "El daño es…",
        "campos": {"comparacion": {"tipo": "opcion", "opciones": COMPARACIONES, "defecto": "al_menos", "etiqueta": "Comparación", "textos": TEXTOS_COMPARACION},
                   "valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Puntos", "min": 0, "max": 1000000, "sugerido": 10}},
        "ayuda": "El daño de ese golpe (ya con defensas). Solo con «Al atacar», «Al recibir un ataque», «Al alcanzar a cada objetivo» o «Al recibir daño».",
        "pasivo": False, "golpe": True,
    },
    "ronda": {
        "nombre": "La ronda del combate es…",
        "campos": {"comparacion": {"tipo": "opcion", "opciones": COMPARACIONES, "defecto": "igual_a", "etiqueta": "Comparación", "textos": TEXTOS_COMPARACION},
                   "valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Ronda", "min": 1, "max": 10000, "sugerido": 1}},
        "ayuda": "«exactamente 1» = el primer turno del combate. Fuera de combate no se cumple.",
        "pasivo": False,
    },
    "tiene_habilidad": {
        "nombre": "Tiene una habilidad",
        "campos": {"quien": _QUIEN,
                   "tiene": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿La tiene?", "textos": {"si": "la tiene", "no": "no la tiene"}},
                   "habilidad": {"tipo": "habilidad", "obligatorio": True, "etiqueta": "Habilidad"}},
    },
    "actua_antes": {
        "nombre": "Actúa antes que el otro en los turnos",
        "campos": {"tiene": {"tipo": "opcion", "opciones": SI_NO, "defecto": "si", "etiqueta": "¿Antes?", "textos": {"si": "actúa antes", "no": "actúa después"}}},
        "ayuda": "Compara el orden de los turnos del combate de él mismo y el objetivo. Fuera de combate no se cumple.",
        "pasivo": False, "con_objetivo": True,
    },
    "cargas": {
        "nombre": "Un estado tiene… cargas",
        "campos": {"quien": _QUIEN,
                   "estado": {"tipo": "estado", "obligatorio": True, "etiqueta": "Estado"},
                   "comparacion": {"tipo": "opcion", "opciones": COMPARACIONES, "defecto": "al_menos", "etiqueta": "Comparación", "textos": TEXTOS_COMPARACION},
                   "valor": {"tipo": "entero", "obligatorio": True, "etiqueta": "Cargas", "min": 0, "max": 1000, "sugerido": 3}},
        "ayuda": "Para estados que se acumulan («Al volver a aplicarlo: acumular cargas»). Sin el estado, tiene 0 cargas.",
    },
    "probabilidad": {
        "nombre": "Con una probabilidad",
        "campos": {"porcentaje": {"tipo": "entero", "obligatorio": True, "etiqueta": "%", "min": 1, "max": 100, "sugerido": 25}},
        "ayuda": "Se tira cada vez que se activa: 25 = una de cada cuatro veces, más o menos.",
        "pasivo": False,
    },
}


def validar_efectos(ctx: str, lista, v, cat, permitidos=None) -> list[dict]:
    """Valida y normaliza una lista de efectos.

    `v` es el ayudante de validación de recursos.py; `cat` el catálogo en construcción;
    `permitidos` (opcional) restringe los disparadores (p. ej. los estados no usan «tirada»).
    """
    if lista is None:
        return []
    if not isinstance(lista, list):
        v.err(ctx, "«efectos» debe ser una lista")
        return []
    res = []
    for i, e in enumerate(lista):
        c = f"{ctx} → efectos[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "cada efecto debe ser un conjunto de campos (cuando, hacer)")
            continue
        cuando = e.get("cuando")
        hacer = e.get("hacer")
        if isinstance(cuando, str):
            cuando = {"tipo": cuando}
        if not isinstance(cuando, dict) or "tipo" not in cuando:
            v.err(c, "falta «cuando» (por ejemplo: cuando: {tipo: inicio_turno})")
            continue
        if not isinstance(hacer, dict) or "tipo" not in hacer:
            v.err(c, "falta «hacer» (por ejemplo: hacer: {tipo: aplicar_estado, estado: veneno})")
            continue
        t_cuando, t_hacer = cuando["tipo"], hacer["tipo"]
        ok = True
        if t_cuando not in DISPARADORES:
            v.err(c, f"«cuando» → tipo desconocido «{t_cuando}». Opciones: {', '.join(DISPARADORES)}")
            ok = False
        elif permitidos is None and t_cuando in SOLO_TILES:
            v.err(c, f"«cuando» → «{t_cuando}» solo se puede usar en tiles (casillas)")
            ok = False
        elif permitidos is None and t_cuando in SOLO_OBJETOS:
            v.err(c, f"«cuando» → «{t_cuando}» solo se puede usar en objetos")
            ok = False
        elif permitidos is None and t_cuando in SOLO_HABILIDADES:
            v.err(c, f"«cuando» → «{t_cuando}» solo se puede usar en habilidades")
            ok = False
        elif t_cuando in SOLO_ESTADOS and (permitidos is None or t_cuando not in permitidos):
            v.err(c, f"«cuando» → «{t_cuando}» solo se puede usar en estados")
            ok = False
        elif permitidos is not None and t_cuando not in permitidos:
            v.err(c, f"«cuando» → «{t_cuando}» no se puede usar aquí. Opciones: {', '.join(sorted(permitidos))}")
            ok = False
        if t_hacer not in ACCIONES:
            v.err(c, f"«hacer» → tipo desconocido «{t_hacer}». Opciones: {', '.join(ACCIONES)}")
            ok = False
        if not ok:
            continue
        validos = ACCIONES[t_hacer]["disparadores"]
        if validos is not None and t_cuando not in validos:
            v.err(c, f"«{t_hacer}» solo se puede usar con: {', '.join(sorted(validos))} (no con «{t_cuando}»)")
            continue
        res.append({
            "cuando": _campos(f"{c} → cuando", cuando, DISPARADORES[t_cuando]["campos"], v, cat),
            "hacer": _campos(f"{c} → hacer", hacer, ACCIONES[t_hacer]["campos"], v, cat),
        })
        si = _condiciones(c, e.get("si"), t_cuando, v, cat)
        if si:
            res[-1]["si"] = si
        res[-1]["cuando"]["tipo"] = t_cuando
        res[-1]["hacer"]["tipo"] = t_hacer
        obj = res[-1]["hacer"].get("objetivo")
        if obj == "objetivo" and t_cuando not in DISPARADORES_CON_OBJETIVO:
            v.err(c, "«objetivo: objetivo» solo tiene sentido con «al_atacar», «al_ser_atacado», «al_derrotar», «al_ser_derrotado», «al_impactar», «al_recibir_dano» o «al_intentar»")
        if t_hacer == "modificar_estadistica" and t_cuando == "siempre":
            v.err(c, "«Sumar a una estadística (para siempre)» no se puede usar con «Siempre activo» (sumaría sin parar): usa «Bono a una estadística (mientras esté activo)»")
    return res


def _condiciones(ctx: str, lista, t_cuando: str, v, cat) -> list[dict]:
    """Valida «si:» (lista de condiciones). Todas deben cumplirse para que el efecto se aplique."""
    if lista is None:
        return []
    if isinstance(lista, (dict, str)):
        lista = [lista]
    if not isinstance(lista, list):
        v.err(ctx, "«si» debe ser una lista de condiciones")
        return []
    if len(lista) > MAX_CONDICIONES:
        v.err(ctx, f"«si»: como mucho {MAX_CONDICIONES} condiciones por efecto")
        lista = lista[:MAX_CONDICIONES]
    res = []
    for j, cond in enumerate(lista):
        cc = f"{ctx} → si[{j + 1}]"
        if isinstance(cond, str):
            cond = {"tipo": cond}
        if not isinstance(cond, dict) or "tipo" not in cond:
            v.err(cc, "cada condición necesita un «tipo» (por ejemplo: {tipo: probabilidad, porcentaje: 25})")
            continue
        t = cond["tipo"]
        if t not in CONDICIONES:
            v.err(cc, f"condición desconocida «{t}». Opciones: {', '.join(CONDICIONES)}")
            continue
        d = CONDICIONES[t]
        if t_cuando == "siempre" and d.get("pasivo") is False:
            v.err(cc, f"«{d['nombre']}» no se puede usar con «Siempre activo»")
            continue
        n = _campos(cc, cond, d["campos"], v, cat)
        n["tipo"] = t
        if d.get("golpe") and t_cuando not in DISPARADORES_CON_GOLPE:
            v.err(cc, f"«{d['nombre']}» solo tiene sentido con «Al atacar», «Al recibir un ataque», «Al alcanzar a cada objetivo» o «Al recibir daño»")
            continue
        if d.get("con_objetivo") and t_cuando not in DISPARADORES_CON_OBJETIVO:
            v.err(cc, f"«{d['nombre']}» necesita a otro (con «Al atacar», «Al recibir un ataque»…)")
            continue
        if n.get("quien") == "objetivo" and t_cuando not in DISPARADORES_CON_OBJETIVO:
            v.err(cc, "«quien: objetivo» solo tiene sentido con «al_atacar», «al_ser_atacado», «al_derrotar» o «al_ser_derrotado» (en los demás casos no hay objetivo)")
            continue
        if t == "recurso" and n.get("unidad") == "porcentaje" and isinstance(n.get("valor"), int) and n["valor"] > 100:
            v.err(cc, "«valor» en porcentaje no puede pasar de 100")
        if t == "momento_dia" and not cat.config["juego"]["ciclo"]["activo"]:
            v.aviso(cc, "la campaña no usa día y noche: esta condición nunca se cumplirá")
        if t == "clima" and not cat.config["juego"]["clima"]["activo"]:
            v.aviso(cc, "la campaña no usa clima: esta condición nunca se cumplirá")
        res.append(n)
    return res


def validar_requisitos(ctx: str, lista, v, cat) -> list[dict]:
    """Requisitos de una habilidad: condiciones sobre quien la usa («Él mismo») o sobre cada objetivo («El objetivo»).
    No admiten «probabilidad» (para eso, un efecto «Al alcanzar a cada objetivo» con esa condición)."""
    res = []
    for c in _condiciones(ctx, lista, "al_impactar", v, cat):
        if c["tipo"] == "probabilidad":
            v.err(ctx, "un requisito no puede ser una probabilidad (usa un efecto «Al alcanzar a cada objetivo» con esa condición)")
        else:
            res.append(c)
    return res


def esquema_publico() -> dict:
    """El catálogo completo tal como lo usa el Editor (main.py --esquema)."""
    from . import recursos
    def _lista(x):
        return sorted(x) if x is not None else None
    return {
        "disparadores": DISPARADORES,
        "acciones": {k: {**a, "disparadores": _lista(a["disparadores"])} for k, a in ACCIONES.items()},
        "condiciones": CONDICIONES,
        "disparadores_estado": sorted(recursos._DISPARADORES_ESTADO),
        "disparadores_tile": sorted(recursos._DISPARADORES_TILE),
        "disparadores_generales": sorted(set(DISPARADORES) - SOLO_TILES - SOLO_OBJETOS - SOLO_HABILIDADES - SOLO_ESTADOS),
        "disparadores_habilidad": sorted(SOLO_HABILIDADES),
        "disparadores_objeto": ["siempre", "al_usar"],
        "disparadores_con_objetivo": sorted(DISPARADORES_CON_OBJETIVO),
        "disparadores_con_golpe": sorted(DISPARADORES_CON_GOLPE),
    }


def sin_booleano(val, opciones):
    """YAML 1.1 lee «no» y «si/yes» sin comillas como falso/verdadero: si la opción es «no» o «si», se recupera el texto."""
    if val is False and "no" in opciones:
        return "no"
    if val is True and "si" in opciones:
        return "si"
    return val


def _campos(ctx, datos: dict, esquema: dict, v, cat) -> dict:
    res = {}
    for k in datos:
        if k != "tipo" and k not in esquema:
            v.err(ctx, f"campo desconocido «{k}». Campos válidos: {', '.join(esquema) or '(ninguno)'}")
    for k, d in esquema.items():
        val = datos.get(k)
        if val is None or val == "":
            if d.get("obligatorio"):
                v.err(ctx, f"falta el campo obligatorio «{k}»")
            elif "defecto" in d:
                res[k] = d["defecto"]
            continue
        t = d["tipo"]
        if t == "estadistica":
            if val not in cat.nombres_stats():
                v.err(ctx, f"«{k}»: la estadística «{val}» no existe")
        elif t == "recurso":
            if val not in cat.nombres_recursos():
                v.err(ctx, f"«{k}»: el recurso «{val}» no existe")
        elif t == "estado":
            if val not in cat.estados:
                v.err(ctx, f"«{k}»: el estado «{val}» no existe")
        elif t == "objeto":
            if val not in cat.objetos:
                v.err(ctx, f"«{k}»: el objeto «{val}» no existe")
        elif t == "habilidad":
            if val not in cat.habilidades:
                v.err(ctx, f"«{k}»: la habilidad «{val}» no existe")
        elif t == "eleccion":
            if val not in cat.opciones:
                v.err(ctx, f"«{k}»: la opción (raza, clase…) «{val}» no existe")
        elif t == "etiqueta":
            validas = {e["nombre"].casefold(): e["nombre"] for e in cat.config["juego"]["etiquetas"]}
            if str(val).casefold() not in validas:
                v.err(ctx, f"«{k}»: la etiqueta «{val}» no existe (se crean en Reglas → Etiquetas y ventajas)")
            else:
                val = validas[str(val).casefold()]
        elif t == "periodo":
            if val not in [p["nombre"] for p in cat.config["juego"]["ciclo"]["periodos"]]:
                v.err(ctx, f"«{k}»: el momento del día «{val}» no existe (se definen en Reglas → Día, noche y clima)")
        elif t == "clima":
            if val not in [p["nombre"] for p in cat.config["juego"]["clima"]["tipos"]]:
                v.err(ctx, f"«{k}»: el clima «{val}» no existe (se definen en Reglas → Día, noche y clima)")
        elif t == "entero":
            if isinstance(val, bool) or not isinstance(val, int):
                v.err(ctx, f"«{k}» debe ser un número entero")
            elif ("min" in d and val < d["min"]) or ("max" in d and val > d["max"]):
                v.err(ctx, f"«{k}» debe estar entre {d.get('min', '…')} y {d.get('max', '…')} (es {val})")
        elif t == "formula":
            if not isinstance(val, (str, int)) or isinstance(val, bool):
                v.err(ctx, f"«{k}» debe ser una fórmula (texto o número)")
            else:
                val = str(val)
                for e in formulas.validar(val, cat.nombres_formula(), formulas.tablas_de(cat.config)):
                    v.err(ctx, f"«{k}» → {e}")
        elif t == "opcion":
            val = sin_booleano(val, d["opciones"])
            if val not in d["opciones"]:
                v.err(ctx, f"«{k}» debe ser uno de: {', '.join(d['opciones'])} (es «{val}»)")
        res[k] = val
    return res
