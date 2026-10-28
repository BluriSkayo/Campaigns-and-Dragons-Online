"""config_campana.py — config.yaml de una campaña: valores por defecto (CONFIG_DEFECTO) y su validación (reglas del juego,
estadísticas, recursos, niveles, día y noche, clima, moneda, campos de ficha, menús…). Lo usa `recursos.cargar`."""

from __future__ import annotations

import copy
import re

from . import formulas
from .validacion import _Val, _fusionar, _num


CONFIG_DEFECTO = {
    "servidor": {
        "nombre": "Campaigns and Dragons Online",
        "host": "0.0.0.0",
        "puerto": 8765,
        "password_servidor": "",
        "password_gm": "",
        "cifrado": True,                     # conexión cifrada (wss/https). false = sin cifrar (p. ej. detrás de un proxy que ya cifra)
        "certificado": "",                   # opcional: certificado propio (si se deja vacío se crea uno automático)
        "clave": "",
    },
    "seguridad": {
        "registro_abierto": True,            # un nombre nuevo se registra al entrar (false = solo cuentas creadas antes)
        "contrasena_obligatoria": False,     # true = todo usuario debe tener contraseña propia
        "max_intentos": 5,                   # fallos seguidos antes de bloquear
        "bloqueo_segundos": 60,
    },
    "permisos": {
        "musica": "gm",                      # gm | todos
        "cambiar_sala": "gm",                # gm | todos: ¿los jugadores pueden irse solos a otra sala (mapa) abierta, o los lleva el GM?
        "romper_casillas": "gm",             # gm | todos: quién puede golpear casillas rompibles (barricadas, puertas…)
        "atacar": "enemigos_y_neutros",      # a quién pueden atacar los jugadores: enemigos | enemigos_y_neutros | todos (el GM siempre puede)
        "mover_tokens_ajenos": False,
        "npc_para_jugadores": False,         # ¿el GM puede dar el control de un NPC a un jugador («Controlado por»)? Apagado: solo el GM los maneja
        "sin_ficha": False,                  # ¿los jugadores pueden entrar sin crearse una ficha? El GM les asigna personajes («Pertenece a») y NPC («Controlado por»)
        "desplegar_en_casilla": True,        # ¿el jugador puede elegir en qué casilla aparece su personaje (fuera de combate; con niebla, donde ve)?
        "transformarse": False,              # ¿el jugador puede cambiar de forma él mismo (licántropo, evolución…)? El GM siempre puede
        "intercambios": True,                # ¿los jugadores pueden intercambiar objetos y dinero entre ellos?
        "dar_objetos": True,                 # ¿los jugadores pueden dar objetos a otro token cercano (clic en «Dar» del inventario)? El GM siempre
        "alcance_objetos": 1,                # a cuántas casillas como mucho se usa un objeto con otro o se le da (1 = al lado)
        "sonidos_personaje": False,          # ¿el jugador puede lanzar los sonidos asociados a su personaje? (el GM siempre puede)
        "ping": True,                        # ¿los jugadores pueden señalar una casilla con Alt + clic? (el GM siempre)
        "regla_visible": True,               # ¿los demás ven la regla de un jugador mientras mide? (la del GM siempre se ve)
        "dibujar": True,                     # ¿los jugadores pueden dibujar en el mapa? (el GM puede además bloquearlo en plena partida)
        "acciones_solo_en_su_turno": True,   # solo aplica durante un combate
        "crear_personajes": True,
        "max_personajes_por_jugador": 3,
        "editar_stats_jugador": False,       # ¿el jugador puede repartir/cambiar sus puntos o solo el GM?
        "dados_personalizados": True,        # ¿los jugadores pueden tirar cualquier expresión (2d8+3) o solo los dados de la lista?
        "habilidades_propias": False,        # ¿el jugador puede anotar habilidades propias (solo texto, sin efecto en el juego)?
        "objetos_propios": False,            # ¿el jugador puede anotar objetos propios (solo texto, sin efecto en el juego)?
        "rasgos_personalidad": False,        # ¿el jugador puede escribir y cambiar los rasgos de personalidad de sus personajes?
    },
    "visibilidad": {                         # qué ven los jugadores de los DEMÁS (la vida del token se ve siempre; el GM puede mostrar más por token)
        "jugadores": {"estadisticas": False, "recursos": False, "inventario": False, "habilidades": False, "ficha": False},
        "npc":       {"estadisticas": False, "recursos": False, "inventario": False, "habilidades": False, "ficha": False},
        # Lo que se dibuja sobre cada token del mapa. Cada jugador puede además apagar en sus Ajustes lo que no quiera ver,
        # y el GM puede cambiarlo en un token concreto («Editar…»).
        "sobre_tokens": {
            "barras": None,              # recursos que se ven como barra bajo el token (None = solo la vida)
            "barras_jugadores": True,    # ¿se ven las barras de los personajes de los demás jugadores?
            "barras_npc": True,          # ¿y las de los NPC?
            "nombre_jugadores": True,    # ¿se ve el nombre de los personajes de los demás?
            "nombre_npc": True,          # ¿y el de los NPC?
        },
    },
    "juego": {
        "estadisticas": [
            {"nombre": "Fuerza", "valor_inicial": 10},
            {"nombre": "Resistencia", "valor_inicial": 10},
            {"nombre": "Poder Mágico", "valor_inicial": 10},
            {"nombre": "Defensa Mágica", "valor_inicial": 10},
            {"nombre": "Agilidad", "valor_inicial": 10},
        ],
        "recursos": [
            {"nombre": "HP", "descripcion": "Puntos de vida", "maximo_inicial": 100},
            {"nombre": "MP", "descripcion": "Puntos de magia", "maximo_inicial": 50},
        ],
        "recurso_vida": "HP",
        "dados": [4, 6, 8, 10, 12, 20, 100],  # los dados que ofrece la ventana de tiradas (caras)
        "estadistica_iniciativa": "Agilidad",
        # Cómo se decide el orden de los turnos: estadistica = cada uno tira (d20 + su estadística) · valor = de mayor a menor estadística,
        # sin dado · manual = el GM los ordena · preguntar = el GM elige al iniciar cada combate entre «iniciativa_opciones»
        "iniciativa": "estadistica",
        "iniciativa_opciones": ["estadistica", "valor", "manual"],
        # Cómo acaba un combate: manual = lo termina el GM · automatico = termina solo cuando ya no queda ningún NPC enemigo en pie
        "fin_combate": "manual",
        "movimiento": {"limitado": False, "casillas": 6, "estadistica": ""},   # en combate: cuántas casillas puede andar cada uno en su turno
        # Niveles: «manual» (por defecto) = solo el GM sube de nivel; «experiencia» = se sube solo al juntar la experiencia de los umbrales
        # (suma de varias estadísticas contador). «maximo» vale en los dos modos. «reparto»: la experiencia de un enemigo derrotado va a todos los
        # personajes en pie («todos») o solo a quien lo derrotó («vencedor»).
        "niveles": {"activo": False, "modo": "manual", "reparto": "todos", "experiencia": [], "umbrales": [], "maximo": 20,
                    "por_nivel": {"puntos": 0, "recursos": {}}, "aprende": [],
                    "entrega": "automatica"},     # automatica = el programa da lo de cada nivel | gm = solo sube el nivel; el GM da lo demás a mano
        "tirada_estadistica": "1d20 + [a.{estadistica}]",   # fórmula de «tirar una estadística»
        "puntos_a_repartir": 0,              # puntos de estadística al crear un personaje
        "usar_grupos": True,                 # false = la campaña no usa razas, clases ni otros grupos de elección
        "diario_reglas": True,               # ¿el diario incluye la página automática «Reglas de la mesa»?
        "inventario_grupo": True,            # ¿hay un inventario común para todos los jugadores? (el GM puede crear más en partida)
        "stats_por_plantilla": False,        # false = todos empiezan con el valor inicial global; true = cada plantilla trae sus propias estadísticas
        "mapa_inicial": None,
        "max_mensajes_chat": 100,
        "salas_chat": True,                  # ¿el GM puede crear salas de chat privadas para algunos jugadores?
        "sonidos_activos": True,             # false = la campaña no usa música ni sonidos (el cliente ni muestra su panel)
        "chat": {"modo": "libre", "espera_chat": 0, "espera_tiradas": 0, "detalle_tiradas": False},   # detalle_tiradas: los jugadores ven cada dado (el GM siempre)   # registro = los jugadores no escriben (solo tiradas y avisos); esperas en segundos
        "moneda": {                          # el dinero se guarda como un número entero de la unidad más pequeña
            "activa": True, "nombre": "Monedas", "simbolo": "🪙", "inicial": 0,
            "denominaciones": [],            # opcional, para mostrarlo en piezas: [{nombre: Oro, valor: 100}, {nombre: Plata, valor: 10}, {nombre: Cobre, valor: 1}]
        },
        "niebla": {                          # niebla de guerra: cada jugador solo ve lo que alcanza la visión de sus personajes
            "activa": False, "vision_base": 6, "compartir": True,       # compartir = los jugadores ven lo que ven los demás jugadores
        },
        "ciclo": {                           # día y noche (u otros momentos del día) que el GM cambia en plena partida
            "activo": False, "inicial": 0,
            "periodos": [{"nombre": "Día", "color": "", "opacidad": 0}, {"nombre": "Noche", "color": "#0a1233", "opacidad": 0.5}],
        },
        "clima": {                           # el clima (lluvia, niebla…) que el GM cambia en plena partida; los efectos pueden depender de él
            "activo": False, "inicial": 0,
            "tipos": [{"nombre": "Despejado", "color": "", "opacidad": 0}, {"nombre": "Lluvia", "color": "#2a4a6b", "opacidad": 0.25},
                      {"nombre": "Niebla", "color": "#cfd6dc", "opacidad": 0.35}, {"nombre": "Tormenta", "color": "#10182b", "opacidad": 0.45}],
        },
        "tablas": [],                        # tablas por tramos para las fórmulas: tabla(Nombre; 1d20)
        "etiquetas": [],                     # tipos o elementos (Fuego, No-muerto…) que llevan habilidades, opciones, NPC y estados
        "efectos": [],                       # efectos de la campaña: valen para todos los personajes y NPC (con sus condiciones)
        "ventajas": [],                      # «atacante contra defensor → ×multiplicador»; en las fórmulas, ventaja()
    },
}


MAX_ETIQUETAS = 200


MAX_TABLAS = 50


MAX_FILAS_TABLA = 50


def _validar_tablas(ctx, lista, v: _Val) -> list[dict]:
    """juego.tablas: [{nombre, filas: [{desde, hasta, valor}], defecto}]. Un tramo sin «desde» o sin «hasta» no tiene límite por ese lado."""
    if lista is None:
        return []
    if not isinstance(lista, list):
        v.err(ctx, "debe ser una lista de tablas")
        return []
    res, nombres = [], set()
    for i, t in enumerate(lista[:MAX_TABLAS]):
        c = f"{ctx}[{i + 1}]"
        if not isinstance(t, dict):
            v.err(c, "cada tabla debe ser un conjunto de campos (nombre, filas)")
            continue
        nombre = v.texto(c, t, "nombre", obligatorio=True).strip()
        if not nombre:
            continue
        if any(ch in nombre for ch in ";()[]"):
            v.err(c, f"el nombre «{nombre}» no puede llevar ; ( ) [ ]")
            continue
        if nombre.casefold() in nombres:
            v.err(c, f"ya hay otra tabla llamada «{nombre}»")
            continue
        nombres.add(nombre.casefold())
        filas = []
        for k, f in enumerate(t.get("filas") or []):
            cf = f"{c} «{nombre}» → fila {k + 1}"
            if not isinstance(f, dict):
                v.err(cf, "cada fila necesita desde, hasta y valor")
                continue
            desde, hasta, valor = f.get("desde"), f.get("hasta"), f.get("valor")
            if (desde is not None and not _num(desde)) or (hasta is not None and not _num(hasta)):
                v.err(cf, "«desde» y «hasta» deben ser números (o quedar vacíos = sin límite)")
                continue
            if not _num(valor):
                v.err(cf, "«valor» debe ser un número")
                continue
            if desde is not None and hasta is not None and desde > hasta:
                v.err(cf, f"«desde» ({desde}) es mayor que «hasta» ({hasta})")
                continue
            filas.append({"desde": desde, "hasta": hasta, "valor": valor})
        if len(filas) > MAX_FILAS_TABLA:
            v.err(c, f"«{nombre}»: como mucho {MAX_FILAS_TABLA} filas")
            filas = filas[:MAX_FILAS_TABLA]
        if not filas:
            v.aviso(c, f"la tabla «{nombre}» no tiene filas: siempre dará su valor por defecto")
        defecto = t.get("defecto", 0)
        if not _num(defecto):
            v.err(c, f"«{nombre}»: «defecto» debe ser un número")
            defecto = 0
        res.append({"nombre": nombre, "descripcion": v.texto(c, t, "descripcion"), "filas": filas, "defecto": defecto})
    if len(lista) > MAX_TABLAS:
        v.err(ctx, f"como mucho {MAX_TABLAS} tablas")
    return res


def _validar_etiquetas(ctx, etiquetas, ventajas, v: _Val):
    """juego.etiquetas: [{nombre, descripcion, color}] y juego.ventajas: [{atacante, defensor, multiplicador}]."""
    res, nombres = [], {}
    if etiquetas is not None and not isinstance(etiquetas, list):
        v.err(f"{ctx} → etiquetas", "debe ser una lista")
        etiquetas = []
    for i, e in enumerate((etiquetas or [])[:MAX_ETIQUETAS]):
        c = f"{ctx} → etiquetas[{i + 1}]"
        if isinstance(e, str):
            e = {"nombre": e}
        if not isinstance(e, dict):
            v.err(c, "cada etiqueta necesita un nombre")
            continue
        n = v.texto(c, e, "nombre", obligatorio=True).strip()
        if not n:
            continue
        if any(ch in n for ch in ";()[]") or len(n) > 30:
            v.err(c, f"«{n}»: el nombre debe tener como mucho 30 caracteres y no llevar ; ( ) [ ]")
            continue
        if n.casefold() in nombres:
            v.err(c, f"ya hay otra etiqueta llamada «{n}»")
            continue
        nombres[n.casefold()] = n
        color = v.texto(c, e, "color")
        if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            v.err(c, f"«{n}»: el color debe ser #rrggbb")
            color = ""
        res.append({"nombre": n, "descripcion": v.texto(c, e, "descripcion"), "color": color})
    if len(etiquetas or []) > MAX_ETIQUETAS:
        v.err(f"{ctx} → etiquetas", f"como mucho {MAX_ETIQUETAS} etiquetas")
    tabla, vistos = [], set()
    if ventajas is not None and not isinstance(ventajas, list):
        v.err(f"{ctx} → ventajas", "debe ser una lista")
        ventajas = []
    for i, f in enumerate(ventajas or []):
        c = f"{ctx} → ventajas[{i + 1}]"
        if not isinstance(f, dict):
            v.err(c, "cada fila necesita atacante, defensor y multiplicador")
            continue
        a, d, m = str(f.get("atacante", "")).strip(), str(f.get("defensor", "")).strip(), f.get("multiplicador")
        if a.casefold() not in nombres or d.casefold() not in nombres:
            v.err(c, f"«{a}» contra «{d}»: las dos deben ser etiquetas de la campaña")
            continue
        if isinstance(m, bool) or not isinstance(m, (int, float)) or not 0 <= m <= 100:
            v.err(c, f"«{a}» contra «{d}»: el multiplicador debe ser un número entre 0 y 100")
            continue
        clave = (a.casefold(), d.casefold())
        if clave in vistos:
            v.err(c, f"«{a}» contra «{d}» está repetida")
            continue
        vistos.add(clave)
        tabla.append({"atacante": nombres[a.casefold()], "defensor": nombres[d.casefold()], "multiplicador": m})
    return res, tabla


TIPOS_CAMPO = {"texto", "numero", "lista", "casilla"}


# Palabras de la interfaz que la campaña puede cambiar («Hechizos» en vez de «Habilidades», «Investigador» en vez de «Personaje»…).
# Secciones del menú izquierdo del cliente, en el orden en que salen si la campaña no dice otro («gm» solo lo ve el GM)
MENU_SECCIONES = ("lista-personajes", "inventario", "cofres", "tiradas", "diario", "tienda", "ajustes", "gm")


NOMBRES_CAMBIABLES = ("personaje", "habilidades", "inventario", "estadisticas", "recursos", "rasgos", "estados", "diario", "grupo")


def _validar_campos_ficha(ctx, lista, v: _Val) -> list[dict]:
    """juego.campos_ficha: datos propios de la ficha que define la campaña (Alineamiento, Edad, Dios, Cordura…).
    {nombre, tipo: texto|numero|lista|casilla, opciones (lista), minimo/maximo (número), quien: jugador|gm, privado, descripcion}."""
    if lista is None:
        return []
    if not isinstance(lista, list):
        v.err(ctx, "debe ser una lista")
        return []
    res, vistos = [], set()
    for i, c in enumerate(lista[:40]):
        cc = f"{ctx}[{i + 1}]"
        if not isinstance(c, dict):
            v.err(cc, "debe ser un conjunto de campos")
            continue
        nombre = v.texto(cc, c, "nombre", obligatorio=True).strip()
        if not nombre or len(nombre) > 30:
            v.err(cc, "el nombre debe tener entre 1 y 30 caracteres")
            continue
        if nombre.casefold() in vistos:
            v.err(cc, f"ya hay otro campo llamado «{nombre}»")
            continue
        vistos.add(nombre.casefold())
        r = {"nombre": nombre, "descripcion": v.texto(cc, c, "descripcion")[:200], "tipo": v.opcion(cc, c, "tipo", TIPOS_CAMPO, "texto"),
             "quien": v.opcion(cc, c, "quien", {"jugador", "gm"}, "jugador"), "privado": v.booleano(cc, c, "privado", False)}
        if r["tipo"] == "lista":
            ops = [o.strip()[:40] for o in v.lista(cc, c, "opciones") if isinstance(o, str) and o.strip()]
            if not ops:
                v.err(cc, "una lista necesita al menos una opción")
            r["opciones"] = list(dict.fromkeys(ops))[:30]
        if r["tipo"] == "numero":
            r["minimo"] = v.entero(cc, c, "minimo", 0, minimo=-10 ** 9, maximo=10 ** 9)
            r["maximo"] = v.entero(cc, c, "maximo", 9999, minimo=-10 ** 9, maximo=10 ** 9)
            if r["minimo"] > r["maximo"]:
                v.err(cc, "el mínimo no puede ser mayor que el máximo")
        res.append(r)
    return res


def valor_campo(c: dict, valor):
    """Comprueba y limpia el valor de un campo propio. → valor limpio (o lanza ValueError con el motivo)."""
    if valor is None or valor == "":
        return None
    if c["tipo"] == "texto":
        if not isinstance(valor, str) or len(valor) > 300:
            raise ValueError(f"«{c['nombre']}» admite hasta 300 letras")
        return valor.strip() or None
    if c["tipo"] == "numero":
        if isinstance(valor, bool) or not isinstance(valor, int) or not c["minimo"] <= valor <= c["maximo"]:
            raise ValueError(f"«{c['nombre']}» debe ser un número entre {c['minimo']} y {c['maximo']}")
        return valor
    if c["tipo"] == "lista":
        if valor not in c["opciones"]:
            raise ValueError(f"«{c['nombre']}» debe ser una de sus opciones")
        return valor
    if not isinstance(valor, bool):
        raise ValueError(f"«{c['nombre']}» debe ser sí o no")
    return valor


def _validar_nombres(ctx, d, v: _Val) -> dict:
    if d is None:
        return {}
    if not isinstance(d, dict):
        v.err(ctx, "debe ser un conjunto de nombres")
        return {}
    res = {}
    for k, val in d.items():
        if k not in NOMBRES_CAMBIABLES:
            v.err(ctx, f"«{k}» no es un nombre que se pueda cambiar ({', '.join(NOMBRES_CAMBIABLES)})")
        elif not isinstance(val, str) or not 1 <= len(val.strip()) <= 30:
            v.err(ctx, f"«{k}» debe tener entre 1 y 30 letras")
        else:
            res[k] = val.strip()
    return res


def _validar_orden_menu(ctx, d, v: _Val) -> list:
    """Orden del menú del cliente. Lo que falte se añade al final en el orden de siempre (así una sección nueva nunca queda oculta)."""
    if d is None:
        return list(MENU_SECCIONES)
    if not isinstance(d, list):
        v.err(ctx, "debe ser una lista con las secciones en el orden deseado")
        return list(MENU_SECCIONES)
    res: list = []
    for x in d:
        if x not in MENU_SECCIONES:
            v.err(ctx, f"«{x}» no es una sección del menú ({', '.join(MENU_SECCIONES)})")
        elif x not in res:
            res.append(x)
    return res + [x for x in MENU_SECCIONES if x not in res]


def _validar_velos(ctx, lista, campo: str, cosa: str, ejemplo: str, v: _Val, defecto: list) -> list:
    """Lista de «momentos del día» o de «climas»: cada uno con nombre, color del velo sobre el mapa y fuerza de ese velo."""
    if not isinstance(lista, list) or not 1 <= len(lista) <= 12:
        v.err(ctx, f"«{campo}» debe ser una lista de 1 a 12 {cosa}s {ejemplo}")
        return copy.deepcopy(defecto)
    limpios = []
    for i, e in enumerate(lista):
        cp = f"{ctx} → {campo}[{i + 1}]"
        if not isinstance(e, dict) or not isinstance(e.get("nombre"), str) or not e["nombre"].strip():
            v.err(cp, f"cada {cosa} necesita un «nombre»")
            continue
        color = e.get("color") or ""
        if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(color)):
            v.err(cp, "«color» debe ser un color como #0a1233 (o vacío)")
            color = ""
        op = e.get("opacidad", 0)
        if isinstance(op, bool) or not isinstance(op, (int, float)) or not 0 <= op <= 0.9:
            v.err(cp, "«opacidad» debe ser un número entre 0 y 0.9")
            op = 0
        limpios.append({"nombre": e["nombre"].strip()[:30], "color": color, "opacidad": float(op)})
    return limpios or copy.deepcopy(defecto)


def _validar_clima(ctx, j: dict, v: _Val):
    """juego.clima: tipos de clima (Lluvia, Niebla…) que el GM cambia en partida; los efectos de la campaña pueden depender de ellos."""
    c, ctxc = j.get("clima"), f"{ctx} → juego → clima"
    if not isinstance(c, dict):
        if c is not None:
            v.err(ctxc, "debe ser un conjunto de campos")
        j["clima"] = copy.deepcopy(CONFIG_DEFECTO["juego"]["clima"])
        return
    v.booleano(ctxc, c, "activo", False)
    c["tipos"] = _validar_velos(ctxc, c.get("tipos"), "tipos", "clima", "(por ejemplo Despejado, Lluvia, Niebla)", v, CONFIG_DEFECTO["juego"]["clima"]["tipos"])
    vistos: set = set()
    for t in c["tipos"]:
        if t["nombre"].casefold() in vistos:
            v.err(ctxc, f"el clima «{t['nombre']}» está repetido")
        vistos.add(t["nombre"].casefold())
    v.entero(ctxc, c, "inicial", 0, minimo=0, maximo=11)
    if not isinstance(c.get("inicial"), int) or isinstance(c.get("inicial"), bool) or c["inicial"] >= len(c["tipos"]):
        c["inicial"] = 0


def _validar_moneda_y_ciclo(ctx, j: dict, v: _Val):
    m, ctxm = j["moneda"], f"{ctx} → juego → moneda"
    if not isinstance(m, dict):
        v.err(ctxm, "debe ser un conjunto de campos")
        j["moneda"] = copy.deepcopy(CONFIG_DEFECTO["juego"]["moneda"])
        return
    v.booleano(ctxm, m, "activa", True)
    v.texto(ctxm, m, "nombre")
    v.texto(ctxm, m, "simbolo")
    v.entero(ctxm, m, "inicial", 0, minimo=0, maximo=10 ** 9)
    den = m.get("denominaciones")
    if den is not None and not isinstance(den, list):
        v.err(ctxm, "«denominaciones» debe ser una lista")
        m["denominaciones"] = []
    else:
        limpias, vistos = [], set()
        for i, e in enumerate(den or []):
            c = f"{ctxm} → denominaciones[{i + 1}]"
            if not isinstance(e, dict) or not isinstance(e.get("nombre"), str) or not e["nombre"].strip():
                v.err(c, "cada pieza necesita un «nombre»")
                continue
            valor = e.get("valor")
            if isinstance(valor, bool) or not isinstance(valor, int) or valor < 1:
                v.err(c, "«valor» debe ser un entero de 1 o más (cuántas unidades pequeñas vale)")
                continue
            if e["nombre"].strip().casefold() in vistos:
                v.err(c, f"la pieza «{e['nombre']}» está repetida")
                continue
            vistos.add(e["nombre"].strip().casefold())
            limpias.append({"nombre": e["nombre"].strip()[:30], "valor": valor})
        m["denominaciones"] = sorted(limpias, key=lambda x: -x["valor"])
    c = j["ciclo"]
    ctxc = f"{ctx} → juego → ciclo"
    if not isinstance(c, dict):
        v.err(ctxc, "debe ser un conjunto de campos")
        j["ciclo"] = copy.deepcopy(CONFIG_DEFECTO["juego"]["ciclo"])
        return
    v.booleano(ctxc, c, "activo", False)
    c["periodos"] = _validar_velos(ctxc, c.get("periodos"), "periodos", "momento", "(por ejemplo Día y Noche)", v, CONFIG_DEFECTO["juego"]["ciclo"]["periodos"])
    v.entero(ctxc, c, "inicial", 0, minimo=0, maximo=11)
    if not isinstance(c.get("inicial"), int) or isinstance(c.get("inicial"), bool) or c["inicial"] >= len(c["periodos"]):
        c["inicial"] = 0


def _normalizar_config(raw: dict, v: _Val) -> dict:
    cfg = _fusionar(CONFIG_DEFECTO, raw)
    ctx = "config.yaml"
    s, p, j = cfg["servidor"], cfg["permisos"], cfg["juego"]
    v.texto(ctx, s, "nombre", obligatorio=True)
    v.entero(ctx, s, "puerto", 0, minimo=1, maximo=65535)
    for k in ("password_servidor", "password_gm", "certificado", "clave"):
        v.texto(ctx, s, k)
    v.booleano(ctx, s, "cifrado", True)
    if bool(s["certificado"]) != bool(s["clave"]):
        v.err(ctx, "«certificado» y «clave» deben indicarse los dos juntos")
    seg = cfg["seguridad"]
    for k in ("registro_abierto", "contrasena_obligatoria"):
        v.booleano(f"{ctx} → seguridad", seg, k, False)
    v.entero(f"{ctx} → seguridad", seg, "max_intentos", 5, minimo=1, maximo=100)
    v.entero(f"{ctx} → seguridad", seg, "bloqueo_segundos", 60, minimo=1, maximo=86400)
    v.opcion(ctx, p, "musica", {"gm", "todos"}, "gm")
    v.opcion(ctx, p, "romper_casillas", {"gm", "todos"}, "gm")
    v.opcion(ctx, p, "cambiar_sala", {"gm", "todos"}, "gm")
    v.opcion(ctx, p, "atacar", MODOS_ATAQUE, "enemigos_y_neutros")
    for k in ("mover_tokens_ajenos", "npc_para_jugadores", "sin_ficha", "desplegar_en_casilla", "transformarse", "intercambios", "dar_objetos", "sonidos_personaje", "regla_visible", "ping", "dibujar", "acciones_solo_en_su_turno", "crear_personajes", "editar_stats_jugador", "dados_personalizados", "rasgos_personalidad", "habilidades_propias", "objetos_propios"):
        v.booleano(ctx, p, k, False)
    v.entero(ctx, p, "max_personajes_por_jugador", 3, minimo=1, maximo=50)
    v.entero(ctx, p, "alcance_objetos", 1, minimo=1, maximo=50)
    for quien in ("jugadores", "npc"):
        for k in CAMPOS_VISIBLES:
            v.booleano(f"{ctx} → visibilidad → {quien}", cfg["visibilidad"][quien], k, False)
    v.entero(ctx, j, "max_mensajes_chat", 100, minimo=10, maximo=5000)
    v.booleano(ctx, j, "salas_chat", True)
    v.entero(ctx, j, "puntos_a_repartir", 0, minimo=0, maximo=10000)
    v.booleano(ctx, j, "stats_por_plantilla", False)
    v.booleano(ctx, j, "usar_grupos", True)
    v.booleano(ctx, j, "diario_reglas", True)
    v.booleano(ctx, j, "inventario_grupo", True)
    v.booleano(ctx, j, "sonidos_activos", True)
    v.booleano(ctx, j, "categorias_estadisticas", False)
    # Habilidades fuera de combate: todas | sin_dano (curar, buffs… sí; golpes y hechizos de daño no) | ninguna. El GM siempre puede.
    j["habilidades_fuera_de_combate"] = v.opcion(ctx, j, "habilidades_fuera_de_combate", ("todas", "sin_dano", "ninguna"), "todas")
    # Equipar objetos (apagado por defecto): {activo, maximo (0 = sin límite), huecos: ["Casco", "Pecho"…] (uno de cada a la vez)}
    eq = j.get("equipamiento")
    if not isinstance(eq, dict):
        if eq is not None:
            v.err(f"{ctx} → juego → equipamiento", "debe ser {activo, maximo, huecos}")
        eq = {}
    j["equipamiento"] = {"activo": v.booleano(f"{ctx} → juego → equipamiento", eq, "activo", False),
                         "maximo": v.entero(f"{ctx} → juego → equipamiento", eq, "maximo", 0, minimo=0, maximo=100),
                         "huecos": list(dict.fromkeys(str(x).strip()[:30] for x in v.lista(f"{ctx} → juego → equipamiento", eq, "huecos")
                                                      if isinstance(x, str) and x.strip()))}   # true = la ficha y la creación muestran las estadísticas por bloques
    # Medida de cada casilla: la regla y los alcances se muestran en casillas, metros o pies
    me = j.get("medida")
    if not isinstance(me, dict):
        if me is not None:
            v.err(f"{ctx} → juego → medida", "debe ser {unidad, tamano}")
        me = j["medida"] = {}
    me["unidad"] = v.opcion(f"{ctx} → juego → medida", me, "unidad", ("casillas", "metros", "pies"), "casillas")
    t = me.get("tamano", 1.5 if me["unidad"] == "metros" else 5 if me["unidad"] == "pies" else 1)
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not 0 < t <= 10000:
        v.err(f"{ctx} → juego → medida", "«tamano» debe ser un número mayor que 0")
        t = 1
    me["tamano"] = t
    ch = j.get("chat")
    if not isinstance(ch, dict):
        if ch is not None:
            v.err(f"{ctx} → juego → chat", "debe ser {modo, espera_chat, espera_tiradas}")
        j["chat"] = copy.deepcopy(CONFIG_DEFECTO["juego"]["chat"])
    else:
        c = f"{ctx} → juego → chat"
        j["chat"] = {"modo": v.opcion(c, ch, "modo", {"libre", "registro"}, "libre"),
                     "espera_chat": v.entero(c, ch, "espera_chat", 0, minimo=0, maximo=3600),
                     "espera_tiradas": v.entero(c, ch, "espera_tiradas", 0, minimo=0, maximo=3600),
                     "detalle_tiradas": v.booleano(c, ch, "detalle_tiradas", False)}
    _validar_moneda_y_ciclo(ctx, j, v)
    _validar_clima(ctx, j, v)
    j["tablas"] = _validar_tablas(f"{ctx} → juego → tablas", j.get("tablas"), v)
    j["campos_ficha"] = _validar_campos_ficha(f"{ctx} → juego → campos_ficha", j.get("campos_ficha"), v)
    j["nombres"] = _validar_nombres(f"{ctx} → juego → nombres", j.get("nombres"), v)
    j["orden_menu"] = _validar_orden_menu(f"{ctx} → juego → orden_menu", j.get("orden_menu"), v)
    j["etiquetas"], j["ventajas"] = _validar_etiquetas(f"{ctx} → juego", j.get("etiquetas"), j.get("ventajas"), v)
    n = j.get("niebla")
    if not isinstance(n, dict):
        j["niebla"] = copy.deepcopy(CONFIG_DEFECTO["juego"]["niebla"]) if n is None else v.err(f"{ctx} → juego → niebla", "debe ser un conjunto de campos") or copy.deepcopy(CONFIG_DEFECTO["juego"]["niebla"])
    else:
        v.booleano(f"{ctx} → juego → niebla", n, "activa", False)
        v.entero(f"{ctx} → juego → niebla", n, "vision_base", 6, minimo=0, maximo=50)
        v.booleano(f"{ctx} → juego → niebla", n, "compartir", True)
    dados = j.get("dados")
    if not isinstance(dados, list) or not dados or len(dados) > 12 or any(isinstance(d, bool) or not isinstance(d, int) or not 2 <= d <= 1000 for d in dados) or len(set(dados)) != len(dados):
        v.err(ctx, "«dados» debe ser una lista de 1 a 12 dados distintos, cada uno de 2 a 1000 caras (por ejemplo [4, 6, 20])")
        j["dados"] = list(CONFIG_DEFECTO["juego"]["dados"])

    # estadísticas
    nombres = set()
    stats = []
    for i, e in enumerate(j["estadisticas"] if isinstance(j["estadisticas"], list) else []):
        c = f"{ctx} → estadisticas[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "cada estadística debe ser un conjunto de campos")
            continue
        n = v.texto(c, e, "nombre", obligatorio=True).strip()
        if n.casefold() in nombres:
            v.err(c, f"nombre repetido «{n}»")
        nombres.add(n.casefold())
        minimo = v.entero(c, e, "minimo", 0)
        maximo = v.entero(c, e, "maximo", 999)
        ini = v.entero(c, e, "valor_inicial", 10)
        if minimo > maximo:
            v.err(c, "«minimo» no puede superar a «maximo»")
        esc = v.lista(c, e, "escalones")
        if len(esc) > 30 or not all(_num(x) and x > 0 for x in esc) or any(b <= a for a, b in zip(esc, esc[1:])):
            v.err(c, "escalones → deben ser números positivos cada vez mayores (valor de la estadística para llegar al rango 2, 3, 4…)")
            esc = []
        stats.append({"nombre": n, "descripcion": v.texto(c, e, "descripcion"), "escalones": [int(x) for x in esc],
                      "valor_inicial": ini, "minimo": minimo, "maximo": maximo,
                      "para_todos": v.booleano(c, e, "para_todos", True),
                      "solo_para": [x for x in v.lista(c, e, "solo_para") if isinstance(x, str)],   # opciones que la dan (se revisa al final)
                      # false = contador (experiencia, cordura…): no recibe puntos de creación ni de nivel; cambia con efectos o el GM
                      "repartible": v.booleano(c, e, "repartible", True),
                      # Bloque en que se muestra (Combate, Social…) si la campaña agrupa las estadísticas por categorías
                      "categoria": v.texto(c, e, "categoria")[:30],
                      # Estadística calculada: su valor sale de esta fórmula (p. ej. abajo(([Fuerza] - 10) / 2)) y no se reparte ni se edita
                      "formula": v.texto(c, e, "formula").strip()})
    if not isinstance(j["estadisticas"], list):
        v.err(ctx, "«estadisticas» debe ser una lista")
    j["estadisticas"] = stats

    # recursos
    recs = []
    for i, e in enumerate(j["recursos"] if isinstance(j["recursos"], list) else []):
        c = f"{ctx} → recursos[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "cada recurso debe ser un conjunto de campos")
            continue
        n = v.texto(c, e, "nombre", obligatorio=True).strip()
        if n.casefold() in nombres:
            v.err(c, f"el nombre «{n}» ya lo usa otra estadística o recurso")
        nombres.add(n.casefold())
        recs.append({"nombre": n, "descripcion": v.texto(c, e, "descripcion"),
                     "maximo_inicial": v.entero(c, e, "maximo_inicial", 100, minimo=0),
                     "para_todos": v.booleano(c, e, "para_todos", True),
                     "solo_para": [x for x in v.lista(c, e, "solo_para") if isinstance(x, str)],
                     "empieza_vacio": v.booleano(c, e, "empieza_vacio", False),     # barra que se llena (experiencia, furia…)
                     # Máximo calculado para los personajes: p. ej. 10 + [Constitución] * [Nivel] (los NPC usan el de su ficha)
                     "maximo_formula": v.texto(c, e, "maximo_formula").strip()})
    if not isinstance(j["recursos"], list):
        v.err(ctx, "«recursos» debe ser una lista")
    j["recursos"] = recs

    _validar_calculadas(ctx, stats, recs, cfg, v)

    tirada = v.texto(ctx, j, "tirada_estadistica") or CONFIG_DEFECTO["juego"]["tirada_estadistica"]
    if stats:
        for e in formulas.validar(tirada.replace("{estadistica}", stats[0]["nombre"]), [s["nombre"] for s in stats], formulas.tablas_de(cfg)):
            v.err(ctx, f"tirada_estadistica → {e}")
    nombres_rec = [r["nombre"] for r in recs]
    if j.get("recurso_vida") not in nombres_rec:
        v.err(ctx, f"«recurso_vida» ({j.get('recurso_vida')}) no es un recurso definido")
    elif not next(r for r in recs if r["nombre"] == j["recurso_vida"])["para_todos"]:
        v.err(ctx, f"«recurso_vida» ({j['recurso_vida']}) debe ser un recurso «para_todos»: todos necesitan vida")
    elif next(r for r in recs if r["nombre"] == j["recurso_vida"])["empieza_vacio"]:
        v.err(ctx, f"«recurso_vida» ({j['recurso_vida']}) no puede empezar vacío: todos nacerían derrotados")
    st = cfg["visibilidad"].get("sobre_tokens")
    if not isinstance(st, dict):
        if st is not None:
            v.err(f"{ctx} → visibilidad", "«sobre_tokens» debe ser un diccionario")
        st = cfg["visibilidad"]["sobre_tokens"] = dict(CONFIG_DEFECTO["visibilidad"]["sobre_tokens"])
    for k in ("barras_jugadores", "barras_npc", "nombre_jugadores", "nombre_npc"):
        st[k] = v.booleano(f"{ctx} → visibilidad → sobre_tokens", st, k, True)
    barras = st.get("barras")
    if barras is None:
        st["barras"] = [j["recurso_vida"]] if j.get("recurso_vida") in nombres_rec else []
    elif not isinstance(barras, list) or not all(isinstance(b, str) for b in barras):
        v.err(f"{ctx} → visibilidad → sobre_tokens", "«barras» debe ser una lista de recursos")
        st["barras"] = []
    else:
        for b in barras:
            if b not in nombres_rec:
                v.err(f"{ctx} → visibilidad → sobre_tokens", f"«barras» cita «{b}», que no es un recurso")
        st["barras"] = [b for b in dict.fromkeys(barras) if b in nombres_rec][:4]
    if j.get("estadistica_iniciativa") not in [s["nombre"] for s in stats]:
        v.err(ctx, f"«estadistica_iniciativa» ({j.get('estadistica_iniciativa')}) no es una estadística definida")
    v.opcion(ctx, j, "iniciativa", set(MODOS_INICIATIVA) | {"preguntar"}, "estadistica")
    v.opcion(ctx, j, "fin_combate", {"manual", "automatico"}, "manual")
    ops = [x for x in v.lista(ctx, j, "iniciativa_opciones") if x in MODOS_INICIATIVA] if j.get("iniciativa_opciones") is not None else list(MODOS_INICIATIVA)
    if j.get("iniciativa_opciones") is not None and len(ops) != len(v.lista(ctx, j, "iniciativa_opciones")):
        v.err(ctx, f"«iniciativa_opciones» solo admite: {', '.join(MODOS_INICIATIVA)}")
    j["iniciativa_opciones"] = [m for m in MODOS_INICIATIVA if m in ops] or list(MODOS_INICIATIVA)
    mv = j.get("movimiento")
    if not isinstance(mv, dict):
        if mv is not None:
            v.err(f"{ctx} → juego → movimiento", "debe ser un conjunto de campos")
        j["movimiento"] = mv = copy.deepcopy(CONFIG_DEFECTO["juego"]["movimiento"])
    cm = f"{ctx} → juego → movimiento"
    v.booleano(cm, mv, "limitado", False)
    v.entero(cm, mv, "casillas", 6, minimo=0, maximo=200)
    v.texto(cm, mv, "estadistica")
    if mv.get("estadistica") and mv["estadistica"] not in [s["nombre"] for s in stats]:
        v.err(cm, f"«{mv['estadistica']}» no es una estadística definida")
    _validar_niveles(ctx, cfg, v)
    return cfg


DETALLE = "\x1f"          # en un texto del chat separa el resultado (lo ven todos) del detalle de la tirada (dados, sumas…)


NIVEL = "Nivel"          # en las fórmulas, [Nivel] es el nivel del personaje (si la campaña usa niveles)


CARGAS = "Cargas"        # en las fórmulas de los efectos de un estado que se acumula, [Cargas] = cuántas lleva (1 si no se acumula)


RANGO = "Rango"                                # con «escalones» en una estadística: [Rango Valentía] = rango que le toca por su valor


MAX_NIVEL = 100


def _validar_niveles(ctx, cfg: dict, v: _Val):
    j = cfg["juego"]
    n = j.get("niveles")
    cn = f"{ctx} → juego → niveles"
    if not isinstance(n, dict):
        if n is not None:
            v.err(cn, "debe ser un conjunto de campos")
        j["niveles"] = n = copy.deepcopy(CONFIG_DEFECTO["juego"]["niveles"])
    v.booleano(cn, n, "activo", False)
    v.opcion(cn, n, "modo", {"experiencia", "manual"}, "manual")
    v.opcion(cn, n, "reparto", {"todos", "vencedor"}, "todos")
    v.entero(cn, n, "maximo", 20, minimo=1, maximo=MAX_NIVEL)
    stats = {s["nombre"]: s for s in j["estadisticas"]}
    recs = {r["nombre"] for r in j["recursos"]}
    exp = [x for x in v.lista(cn, n, "experiencia") if isinstance(x, str)]
    for x in exp:
        if x not in stats:
            v.err(cn, f"experiencia → «{x}» no es una estadística definida")
    n["experiencia"] = list(dict.fromkeys(x for x in exp if x in stats))
    umbrales = v.lista(cn, n, "umbrales")
    if not all(_num(u) and u >= 0 for u in umbrales) or any(b <= a for a, b in zip(umbrales, umbrales[1:])):
        v.err(cn, "umbrales → deben ser números cada vez mayores (experiencia para llegar a nivel 2, 3, 4…)")
        umbrales = []
    n["umbrales"] = [int(u) for u in umbrales][:MAX_NIVEL - 1]
    pn = n.get("por_nivel") if isinstance(n.get("por_nivel"), dict) else {}
    pn_r = pn.get("recursos") if isinstance(pn.get("recursos"), dict) else {}
    for k in pn_r:
        if k not in recs:
            v.err(cn, f"por_nivel → recursos → «{k}» no es un recurso definido")
    n["por_nivel"] = {"puntos": v.entero(cn, pn, "puntos", 0, minimo=0, maximo=1000),
                      "recursos": {k: int(x) for k, x in pn_r.items() if k in recs and _num(x) and -100000 <= x <= 100000}}
    n["aprende"] = n.get("aprende") if isinstance(n.get("aprende"), list) else []      # se revisa al final (_validar_aprende)
    if n.get("entrega", "automatica") not in ("automatica", "gm"):
        v.err(cn, "entrega debe ser «automatica» (lo da el programa) o «gm» (lo gestiona el GM)")
    n["entrega"] = n.get("entrega") if n.get("entrega") in ("automatica", "gm") else "automatica"
    if n["activo"]:
        if NIVEL in stats:
            v.err(cn, f"con niveles activos, ninguna estadística puede llamarse «{NIVEL}» (ese nombre es el nivel en las fórmulas)")
        if n["modo"] == "experiencia" and (not n["experiencia"] or not n["umbrales"]):
            v.err(cn, "en modo «experiencia» hace falta al menos una estadística de experiencia y los umbrales de cada nivel")
        if n["modo"] == "experiencia" and n["umbrales"] and n["maximo"] > len(n["umbrales"]) + 1:
            v.aviso(cn, f"el nivel máximo es {n['maximo']}, pero los umbrales solo llegan al nivel {len(n['umbrales']) + 1}: añade umbrales o baja el máximo")
        for x in n["experiencia"]:
            if stats[x].get("repartible", True):
                v.err(cn, f"experiencia → «{x}» debe ser un contador (desmarca «Puntos» en esa estadística)")


def _validar_calculadas(ctx, stats: list, recs: list, cfg: dict, v: _Val):
    """Fórmulas de estadísticas calculadas y de máximos de recursos: sin dados (darían un valor distinto cada vez) y citando solo
    estadísticas (una calculada solo puede usar las calculadas que estén ANTES en la lista, para que no se citen en círculo) y [Nivel]."""
    tablas = formulas.tablas_de(cfg)
    normales = [s["nombre"] for s in stats if not s["formula"]]
    previas: list[str] = []
    extra = [NIVEL] if cfg["juego"].get("niveles", {}).get("activo") else []
    for s in stats:
        if s["formula"]:
            c = f"{ctx} → estadisticas → {s['nombre']} → formula"
            _una_calculada(c, s["formula"], normales + previas + extra, tablas, v)
            if not any(e.startswith(c) for e in v.inf.errores):
                previas.append(s["nombre"])
            s["repartible"] = False                     # no recibe puntos: su valor lo da la fórmula
    todas = [s["nombre"] for s in stats] + extra
    for r in recs:
        if r["maximo_formula"]:
            _una_calculada(f"{ctx} → recursos → {r['nombre']} → maximo_formula", r["maximo_formula"], todas, tablas, v)


def _una_calculada(c, formula, nombres, tablas, v: _Val):
    if formulas._DADO.search(formula):
        v.err(c, "no puede tirar dados: una estadística calculada debe dar siempre lo mismo")
        return
    for e in formulas.validar(formula, nombres, tablas):
        v.err(c, e)


def nivel_maximo(cfg: dict) -> int:
    n = cfg["juego"]["niveles"]
    if n["modo"] == "experiencia":
        return max(1, min(n["maximo"], len(n["umbrales"]) + 1))      # el máximo del Editor manda, pero sin umbrales no se puede pasar de ahí
    return n["maximo"]


MODOS_INICIATIVA = ("estadistica", "valor", "manual")


CAMPOS_VISIBLES = ("estadisticas", "recursos", "inventario", "habilidades", "ficha")   # «ficha» = elecciones, rasgos y personalidad


MODOS_ATAQUE = {"enemigos", "enemigos_y_neutros", "todos"}
