"""
recursos.py — Carga y validación de la carpeta `config/`.

Estructura esperada:

    config/
        config.yaml
        abilities/   *.yaml   (habilidades)
        items/       *.yaml   (objetos)
        characters/  *.yaml   (personajes base)
        enemies/     *.yaml   (NPC: personajes no jugadores —aliados, neutrales o enemigos—; la carpeta conserva su nombre antiguo)
        maps/        *.yaml   (mapas)
        shops/       *.yaml   (tiendas)

El ID de cada recurso es el nombre del archivo sin extensión
("bola_de_fuego.yaml" → "bola_de_fuego"). El campo `nombre` es solo para mostrar.

`cargar()` devuelve un Catálogo con los datos ya normalizados (valores por defecto
aplicados) y un Informe con errores y avisos. Este módulo está pensado para ser
reutilizado por el Editor del Servidor.
"""

from __future__ import annotations

import copy
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import efectos, formulas

CATEGORIAS = {
    "habilidades": "abilities",
    "objetos": "items",
    "personajes": "characters",
    "enemigos": "enemies",
    "mapas": "maps",
    "tiendas": "shops",
    "grupos": "groups",      # grupos de elección: Raza, Clase, Origen…
    "opciones": "options",   # cada opción de un grupo: Elfo, Mago…
    "rasgos": "traits",
    "estados": "states",
    "tiles": "tiles",        # tipos de casilla (muro, agua, hierba alta…) con sus efectos
    "diario": "journal",     # páginas del diario del GM (armas, mundo, reglas de la casa…)
}

# Carpetas que pueden no existir sin que sea un aviso (se añadieron después).
CATEGORIAS_OPCIONALES = {"characters", "groups", "options", "traits", "states", "tiles", "journal"}

EXTENSIONES_MUSICA = {".ogg", ".mp3", ".wav"}
_NOMBRE_AUDIO = re.compile(r"^[^\\/:*?\"<>|\x00-\x1f]{1,120}\.(ogg|mp3|wav)$", re.I)


def nombre_audio_valido(nombre) -> bool:
    """El audio vive en la carpeta base/ de la campaña (y en la de cada cliente): el servidor solo comprueba que el nombre sea razonable (sin rutas)."""
    return isinstance(nombre, str) and bool(_NOMBRE_AUDIO.match(nombre)) and not nombre.startswith(".") and ".." not in nombre

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


@dataclass
class Informe:
    errores: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errores


@dataclass
class Catalogo:
    ruta: Path
    config: dict
    habilidades: dict = field(default_factory=dict)
    objetos: dict = field(default_factory=dict)
    personajes: dict = field(default_factory=dict)
    enemigos: dict = field(default_factory=dict)
    mapas: dict = field(default_factory=dict)
    tiendas: dict = field(default_factory=dict)
    grupos: dict = field(default_factory=dict)
    opciones: dict = field(default_factory=dict)
    rasgos: dict = field(default_factory=dict)
    estados: dict = field(default_factory=dict)
    tiles: dict = field(default_factory=dict)
    diario: dict = field(default_factory=dict)
    # Listas de sonidos (sonidos.yaml): {"musica": [{"categoria": "Taberna", "archivos": ["a.mp3"]}], "ambiente": [...], "efectos": [...]}
    sonidos: dict = field(default_factory=lambda: {t: [] for t in ("musica", "ambiente", "efectos")})

    def archivos_sonido(self, tipo: str) -> set:
        return {a for g in self.sonidos.get(tipo, []) for a in g["archivos"]}

    @property
    def assets(self) -> Path:
        return self.ruta / "assets"

    def nombres_stats(self) -> list[str]:
        return [s["nombre"] for s in self.config["juego"]["estadisticas"]]

    def nombres_recursos(self) -> list[str]:
        return [r["nombre"] for r in self.config["juego"]["recursos"]]

    def nombres_formula(self) -> list[str]:
        """Lo que una fórmula puede citar entre corchetes: estadísticas, recursos y, con niveles, [Nivel]."""
        rangos = [f"{RANGO} {s['nombre']}" for s in self.config["juego"]["estadisticas"] if s.get("escalones")]
        return self.nombres_stats() + self.nombres_recursos() + ([NIVEL] if self.config["juego"]["niveles"]["activo"] else []) + rangos + [CARGAS]

    def opciones_de(self, grupo: str) -> list[str]:
        return [k for k, o in self.opciones.items() if o.get("grupo") == grupo]

    def recurso_vida(self) -> str:
        return self.config["juego"]["recurso_vida"]

    # ── Lo que aporta cada opción elegida (clase, raza…) ─────────
    def _opciones_en_orden(self, elecciones: dict | None) -> list[dict]:
        el = elecciones or {}
        return [self.opciones[el[g]] for g in self.grupos if el.get(g) in self.opciones]

    def stats_base(self, elecciones: dict | None) -> dict:
        """Estadísticas con las que nace quien tiene estas elecciones: las «para todos» con su valor inicial,
        más las que añadan sus opciones; el valor que indique una opción sustituye al inicial (la última manda)."""
        ops = self._opciones_en_orden(elecciones)
        ids = {(elecciones or {}).get(g) for g in self.grupos}
        res = {s["nombre"]: s["valor_inicial"] for s in self.config["juego"]["estadisticas"] if s["para_todos"] or ids & set(s.get("solo_para") or ())}
        for op in ops:
            res.update(op.get("estadisticas") or {})
        return res

    def recursos_base(self, elecciones: dict | None) -> dict:
        ids = {(elecciones or {}).get(g) for g in self.grupos}
        res = {r["nombre"]: r["maximo_inicial"] for r in self.config["juego"]["recursos"] if r["para_todos"] or ids & set(r.get("solo_para") or ())}
        for op in self._opciones_en_orden(elecciones):
            res.update(op.get("recursos") or {})
        return res

    def puntos_a_repartir(self, elecciones: dict | None) -> int:
        return self.config["juego"]["puntos_a_repartir"] + sum(op.get("puntos_extra", 0) for op in self._opciones_en_orden(elecciones))


# ── Utilidades ───────────────────────────────────────────────────

def _fusionar(base: dict, extra: dict) -> dict:
    res = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(res.get(k), dict):
            res[k] = _fusionar(res[k], v)
        else:
            res[k] = v
    return res


# Lector de YAML en C (libyaml, incluido en PyYAML para Windows) si está: lee igual que el seguro de Python pero ~10 veces más rápido.
# Con miles de archivos era casi todo el tiempo de validar. Si no está, se usa el de siempre.
_CARGADOR = getattr(yaml, "CSafeLoader", yaml.SafeLoader)


def _leer_yaml(ruta: Path, informe: Informe, nombre_rel: str):
    try:
        with open(ruta, "r", encoding="utf-8") as f:
            datos = yaml.load(f, Loader=_CARGADOR)
    except yaml.YAMLError as e:
        informe.errores.append(f"{nombre_rel}: YAML inválido ({str(e).splitlines()[0] if str(e) else 'error'})")
        return None
    except OSError as e:
        informe.errores.append(f"{nombre_rel}: no se pudo leer ({e})")
        return None
    if datos is None:
        datos = {}
    if not isinstance(datos, dict):
        informe.errores.append(f"{nombre_rel}: el archivo debe contener un conjunto de campos, no una lista ni un valor suelto")
        return None
    return datos


class _Val:
    """Ayudantes de validación que acumulan errores con contexto."""

    def __init__(self, informe: Informe, assets: Path):
        self.inf = informe
        self.assets = assets

    def err(self, ctx, msg):
        self.inf.errores.append(f"{ctx}: {msg}")

    def aviso(self, ctx, msg):
        self.inf.avisos.append(f"{ctx}: {msg}")

    def texto(self, ctx, d, k, obligatorio=False, defecto=""):
        v = d.get(k)
        if v is None:
            if obligatorio:
                self.err(ctx, f"falta el campo obligatorio «{k}»")
            return defecto
        if not isinstance(v, str):
            self.err(ctx, f"«{k}» debe ser texto")
            return defecto
        if obligatorio and not v.strip():
            self.err(ctx, f"«{k}» no puede estar vacío")
        return v

    def entero(self, ctx, d, k, defecto, minimo=None, maximo=None):
        v = d.get(k)
        if v is None:
            return defecto
        if isinstance(v, bool) or not isinstance(v, int):
            self.err(ctx, f"«{k}» debe ser un número entero")
            return defecto
        if minimo is not None and v < minimo:
            self.err(ctx, f"«{k}» no puede ser menor que {minimo}")
        if maximo is not None and v > maximo:
            self.err(ctx, f"«{k}» no puede ser mayor que {maximo}")
        return v

    def booleano(self, ctx, d, k, defecto):
        v = d.get(k)
        if v is None:
            return defecto
        if not isinstance(v, bool):
            self.err(ctx, f"«{k}» debe ser verdadero o falso")
            return defecto
        return v

    def opcion(self, ctx, d, k, opciones, defecto):
        v = d.get(k)
        if v is None:
            return defecto
        v = efectos.sin_booleano(v, opciones)
        if v not in opciones:
            self.err(ctx, f"«{k}» debe ser uno de: {', '.join(sorted(opciones))} (es «{v}»)")
            return defecto
        return v

    def lista(self, ctx, d, k):
        v = d.get(k)
        if v is None:
            return []
        if not isinstance(v, list):
            self.err(ctx, f"«{k}» debe ser una lista")
            return []
        return v

    def diccionario(self, ctx, d, k):
        v = d.get(k)
        if v is None:
            return {}
        if not isinstance(v, dict):
            self.err(ctx, f"«{k}» debe ser un conjunto de campos")
            return {}
        return v

    def imagen(self, ctx, d, k="imagen"):
        # Las imágenes viven en la carpeta base/ de la campaña (y en la de cada cliente): el servidor solo guarda el nombre.
        return self.texto(ctx, d, k)


# ── Normalizadores por tipo ──────────────────────────────────────

def _num(x):
    return not isinstance(x, bool) and isinstance(x, (int, float)) and abs(x) <= 1e9


# Lados de una casilla y hacia dónde llevan (dx, dy). «sur» = hacia abajo en el mapa.
LADOS = {"norte": (0, -1), "sur": (0, 1), "este": (1, 0), "oeste": (-1, 0)}
OPUESTO = {"norte": "sur", "sur": "norte", "este": "oeste", "oeste": "este"}


def celdas_de_objeto(o: dict) -> set[tuple[int, int]]:
    """Casillas que ocupa un objeto del mapa: las que toca su rectángulo (x, y, ancho, alto)."""
    x0, y0 = o["x"], o["y"]
    x1, y1 = math.ceil(x0 + o.get("ancho", 1) - 1e-9), math.ceil(y0 + o.get("alto", 1) - 1e-9)
    return {(x, y) for x in range(x0, max(x0 + 1, x1)) for y in range(y0, max(y0 + 1, y1))}


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


def _etiquetas_de(ctx, d, v: _Val, cat) -> list[str]:
    """Lista de etiquetas de un recurso (habilidad, opción, NPC, estado): deben existir en la campaña."""
    lista = d.get("etiquetas")
    if lista is None:
        return []
    if not isinstance(lista, list):
        v.err(ctx, "«etiquetas» debe ser una lista")
        return []
    validas = {e["nombre"].casefold(): e["nombre"] for e in cat.config["juego"]["etiquetas"]}
    res = []
    for x in lista:
        n = validas.get(str(x).strip().casefold())
        if n is None:
            v.err(ctx, f"etiquetas → «{x}» no es una etiqueta de la campaña (se crean en Reglas → Etiquetas y ventajas)")
        elif n not in res:
            res.append(n)
    return res


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


def _aprende_de(ctx, lista, v: _Val, cat: Catalogo) -> list[dict]:
    """[{nivel, habilidad}]: al llegar a ese nivel se aprende esa habilidad (hechizos, técnicas…)."""
    res = []
    for i, e in enumerate(lista if isinstance(lista, list) else []):
        c = f"{ctx} → aprende[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "debe ser {nivel, habilidad}")
            continue
        nv, hab = e.get("nivel"), e.get("habilidad")
        if isinstance(nv, bool) or not isinstance(nv, int) or not 2 <= nv <= MAX_NIVEL:
            v.err(c, f"«nivel» debe ser un número entre 2 y {MAX_NIVEL}")
        elif hab not in cat.habilidades:
            v.err(c, f"la habilidad «{hab}» no existe")
        else:
            res.append({"nivel": nv, "habilidad": hab})
    return sorted(res, key=lambda x: x["nivel"])


def _validar_referencias_nuevas(cat: Catalogo, v: _Val):
    """Estados que citan habilidades y estados; opciones que dan estadísticas; y avisos de cosas que nada usa."""
    huecos = cat.config["juego"]["equipamiento"]["huecos"]
    for oid, o in cat.objetos.items():
        if o.get("hueco") and huecos and o["hueco"] not in huecos:
            v.err(f"items/{oid}.yaml", f"«hueco»: «{o['hueco']}» no está en los huecos de las reglas ({', '.join(huecos)})")
    for tid, t in cat.tiendas.items():
        for m in [m for m in t.get("mapas", []) if m not in cat.mapas]:
            v.err(f"shops/{tid}.yaml", f"«mapas»: el mapa «{m}» no existe")
            t["mapas"].remove(m)
    for hid, h in cat.habilidades.items():
        if h.get("aplica_estado") and h["aplica_estado"] not in cat.estados:
            v.err(f"abilities/{hid}.yaml", f"«aplica_estado»: el estado «{h['aplica_estado']}» no existe")
            h["aplica_estado"] = ""
        if h.get("alternar") and not h.get("aplica_estado"):
            v.aviso(f"abilities/{hid}.yaml", "«alternar» solo sirve con «aplica_estado»")
        if h["tipo"] == "efecto" and not h.get("aplica_estado") and not h.get("efectos") and not h.get("mover_objetivo"):
            v.aviso(f"abilities/{hid}.yaml", "es de «solo efecto» pero no aplica ningún estado ni efecto")
    for eid, e in cat.estados.items():
        if e.get("al_terminar") and (e["al_terminar"] not in cat.estados or e["al_terminar"] == eid):
            v.err(f"states/{eid}.yaml", f"«al_terminar»: «{e['al_terminar']}» debe ser otro estado que exista")
            e["al_terminar"] = ""
    j = cat.config["juego"]
    for lista, que in ((j["estadisticas"], "estadisticas"), (j["recursos"], "recursos")):
        for x in lista:
            malas = [o for o in x.get("solo_para", []) if o not in cat.opciones]
            if malas:
                v.err(f"config.yaml → juego → {que} → {x['nombre']}", f"«solo_para» cita opciones que no existen: {', '.join(malas)}")
                x["solo_para"] = [o for o in x["solo_para"] if o in cat.opciones]
    # Avisos (no impiden arrancar): estados que nada aplica, contadores que nada cambia, objetos que no hacen nada al usarlos
    aplicados, cambiadas = set(), set()
    def mirar(efs):
        for ef in efs or ():
            hh = ef.get("hacer", {})
            if hh.get("tipo") == "aplicar_estado":
                aplicados.add(hh.get("estado"))
            if hh.get("tipo") in ("modificar_estadistica", "bono_estadistica"):      # un bono también la cambia (aunque no toque el valor base)
                cambiadas.add(hh.get("estadistica"))
    for col in (cat.rasgos, cat.estados, cat.objetos, cat.tiles, cat.habilidades):
        for x in col.values():
            mirar(x.get("efectos"))
    mirar(j.get("efectos"))
    aplicados |= {h.get("aplica_estado") for h in cat.habilidades.values()} | {e.get("al_terminar") for e in cat.estados.values()}
    for eid, e in cat.estados.items():
        if eid not in aplicados:
            v.aviso(f"states/{eid}.yaml", f"nada aplica «{e['nombre']}»: solo lo pondrá el GM a mano")
    if j["niveles"]["activo"]:
        cambiadas |= set(j["niveles"]["experiencia"])          # la experiencia la ceden los enemigos y la da el GM
    for s_ in j["estadisticas"]:
        if not s_["repartible"] and not s_.get("formula") and s_["nombre"] not in cambiadas:
            v.aviso("config.yaml → juego → estadisticas", f"nada cambia el contador «{s_['nombre']}»: solo lo cambiará el GM a mano")
    for oid, o in cat.objetos.items():
        if o["tipo"] == "consumible" and not o.get("efecto") and not any(ef["cuando"]["tipo"] == "al_usar" for ef in o.get("efectos", [])):
            v.aviso(f"items/{oid}.yaml", "es consumible pero no hace nada al usarlo")


def _validar_inventario_inicial(cat: Catalogo, v: _Val):
    """juego.inventario_grupo_inicial: {inventario: [{objeto, cantidad}], dinero} con lo que empieza el inventario común."""
    j = cat.config["juego"]
    crudo = j.get("inventario_grupo_inicial")
    ctx = "config.yaml → juego → inventario_grupo_inicial"
    if crudo is None:
        j["inventario_grupo_inicial"] = {"inventario": [], "dinero": 0}
        return
    if not isinstance(crudo, dict):
        v.err(ctx, "debe ser un conjunto de campos (inventario, dinero)")
        j["inventario_grupo_inicial"] = {"inventario": [], "dinero": 0}
        return
    j["inventario_grupo_inicial"] = {"inventario": _normalizar_inventario(ctx, crudo, v, cat),
                                     "dinero": v.entero(ctx, crudo, "dinero", 0, minimo=0, maximo=1_000_000_000)}


def _validar_aprende(cat: Catalogo, v: _Val):
    n = cat.config["juego"]["niveles"]
    n["aprende"] = _aprende_de("config.yaml → juego → niveles", n.get("aprende"), v, cat)
    for oid, o in cat.opciones.items():
        o["aprende"] = _aprende_de(f"options/{oid}.yaml", o.get("aprende"), v, cat)


def _normalizar_stats(ctx, d, v: _Val, cat: Catalogo) -> dict:
    crudo = v.diccionario(ctx, d, "stats")
    definidas = {s["nombre"]: s for s in cat.config["juego"]["estadisticas"]}
    for k in crudo:
        if k not in definidas:
            v.err(ctx, f"la estadística «{k}» no está definida en config.yaml")
    res = {}
    base = cat.stats_base(_elecciones_ya_validas(d, cat))     # las «para todos» + lo que aportan sus opciones
    for nombre, s in definidas.items():
        if nombre not in base and nombre not in crudo:
            continue
        val = crudo.get(nombre, base.get(nombre, s["valor_inicial"]))
        if isinstance(val, bool) or not isinstance(val, int):
            v.err(ctx, f"stats → «{nombre}» debe ser un número entero")
            val = s["valor_inicial"]
        elif not (s["minimo"] <= val <= s["maximo"]):
            v.err(ctx, f"stats → «{nombre}» debe estar entre {s['minimo']} y {s['maximo']} (es {val})")
        res[nombre] = val
    return res


def _elecciones_ya_validas(d, cat: Catalogo) -> dict:
    el = d.get("elecciones") if isinstance(d, dict) else None
    if not isinstance(el, dict):
        return {}
    return {g: o for g, o in el.items() if isinstance(o, str) and o in cat.opciones and cat.opciones[o].get("grupo") == g}


def _normalizar_recursos_max(ctx, d, v: _Val, cat: Catalogo) -> dict:
    crudo = v.diccionario(ctx, d, "recursos")
    definidos = {r["nombre"]: r for r in cat.config["juego"]["recursos"]}
    for k in crudo:
        if k not in definidos:
            v.err(ctx, f"el recurso «{k}» no está definido en config.yaml")
    res = {}
    base = cat.recursos_base(_elecciones_ya_validas(d, cat))
    for nombre, r in definidos.items():
        if nombre not in base and nombre not in crudo:
            continue
        val = crudo.get(nombre, base.get(nombre, r["maximo_inicial"]))
        minimo = 1 if nombre == cat.recurso_vida() else 0
        if isinstance(val, bool) or not isinstance(val, int) or val < minimo:
            v.err(ctx, f"recursos → «{nombre}» debe ser un entero mayor o igual que {minimo}")
            val = r["maximo_inicial"]
        res[nombre] = val
    return res


def _normalizar_ids(ctx, d, k, v: _Val, existentes: dict, que: str) -> list:
    res = []
    for i in v.lista(ctx, d, k):
        if not isinstance(i, str):
            v.err(ctx, f"«{k}» solo puede contener identificadores de {que}")
        elif i not in existentes:
            v.err(ctx, f"«{k}» cita {que} inexistente: «{i}»")
        else:
            res.append(i)
    return res


def _normalizar_inventario(ctx, d, v: _Val, cat: Catalogo) -> list:
    res = []
    for i, e in enumerate(v.lista(ctx, d, "inventario")):
        if isinstance(e, str):
            e = {"objeto": e}
        if not isinstance(e, dict):
            v.err(ctx, f"inventario[{i + 1}] debe ser un objeto o un conjunto de campos")
            continue
        oid = e.get("objeto")
        if oid not in cat.objetos:
            v.err(ctx, f"inventario[{i + 1}] cita un objeto inexistente: «{oid}»")
            continue
        res.append({"objeto": oid, "cantidad": v.entero(ctx, e, "cantidad", 1, minimo=1)})
    return res


MAX_GOLPES = 10
MAX_AREA = 20
DISTANCIA = "Distancia"      # en la fórmula de una habilidad: casillas entre quien la usa y cada objetivo
FORMAS_AREA = ("uno", "explosion", "linea", "frente", "cono", "casillas")
CON_DIRECCION = ("linea", "frente", "cono", "casillas")       # salen de quien la usa hacia donde apunta
MAX_CASILLAS_AREA = 10


def _area_habilidad(ctx, d, v: _Val) -> dict:
    """area: {forma: uno | explosion (radio alrededor del punto) | linea (atraviesa todo hasta su alcance) | frente (fila de casillas
    de cara al objetivo), tamano, afecta: rivales | todos | aliados}."""
    a = d.get("area")
    if a is None:
        return {"forma": "uno", "tamano": 1, "afecta": "rivales"}
    if not isinstance(a, dict):
        v.err(ctx, "«area» debe ser un conjunto de campos (forma, tamano, afecta)")
        return {"forma": "uno", "tamano": 1, "afecta": "rivales"}
    c = f"{ctx} → area"
    r = {"forma": v.opcion(c, a, "forma", set(FORMAS_AREA), "uno"),
         "tamano": v.entero(c, a, "tamano", 1, minimo=1, maximo=MAX_AREA),
         "afecta": v.opcion(c, a, "afecta", {"rivales", "todos", "aliados"}, "rivales")}
    if r["forma"] == "casillas":
        # Casillas dibujadas a mano: [adelante, lado] respecto a quien la usa, mirando hacia donde apunta (lado + = a su derecha)
        celdas = []
        for e in v.lista(c, a, "casillas"):
            if (not isinstance(e, list) or len(e) != 2 or any(isinstance(n, bool) or not isinstance(n, int) or abs(n) > MAX_CASILLAS_AREA for n in e)
                    or e == [0, 0]):
                v.err(c, f"cada casilla debe ser [adelante, lado] con números de -{MAX_CASILLAS_AREA} a {MAX_CASILLAS_AREA} (y no la propia)")
                continue
            if e not in celdas:
                celdas.append(e)
        if not celdas:
            v.err(c, "con forma «casillas» hay que marcar al menos una casilla")
            r["forma"] = "uno"
        else:
            r["casillas"] = celdas
    return r


def _critico(ctx, d, v: _Val) -> dict | None:
    """critico: {desde, multiplicador}: se tira 1d20 aparte en cada golpe; desde ese número, el resultado se multiplica."""
    c = d.get("critico")
    if c is None:
        return None
    if not isinstance(c, dict):
        v.err(ctx, "«critico» debe ser {desde, multiplicador}")
        return None
    m = c.get("multiplicador", 2)
    if isinstance(m, bool) or not isinstance(m, (int, float)) or not 0 <= m <= 100:
        v.err(f"{ctx} → critico", "«multiplicador» debe ser un número entre 0 y 100")
        m = 2
    return {"desde": v.entero(f"{ctx} → critico", c, "desde", 20, minimo=1, maximo=20), "multiplicador": m}


def _mover_objetivo(ctx, d, v: _Val) -> dict | None:
    """mover_objetivo: {modo: atraer | empujar, casillas (0 = hasta pegarlo)}: desplaza a cada objetivo alcanzado."""
    m = d.get("mover_objetivo")
    if m is None:
        return None
    if not isinstance(m, dict):
        v.err(ctx, "«mover_objetivo» debe ser un conjunto de campos (modo, casillas)")
        return None
    c = f"{ctx} → mover_objetivo"
    modo = v.opcion(c, m, "modo", {"no", "atraer", "empujar"}, "no")
    if modo == "no":
        return None
    return {"modo": modo, "casillas": v.entero(c, m, "casillas", 0 if modo == "atraer" else 1, minimo=0, maximo=MAX_AREA)}


def _normalizar_habilidad(ctx, d, v: _Val, cat: Catalogo) -> dict:
    r = {
        "nombre": v.texto(ctx, d, "nombre", obligatorio=True),
        "descripcion": v.texto(ctx, d, "descripcion"),
        "imagen": v.imagen(ctx, d),
        "tipo": v.opcion(ctx, d, "tipo", {"dano", "curacion", "efecto"}, "dano"),   # efecto = sin daño ni curación (solo estados y efectos)
        "objetivo": v.opcion(ctx, d, "objetivo", {"enemigo", "aliado", "cualquiera", "uno_mismo"}, "enemigo"),
        "alcance": v.entero(ctx, d, "alcance", 1, minimo=0, maximo=100),
        "atraviesa_muros": v.booleano(ctx, d, "atraviesa_muros", True),   # false = necesita ver al objetivo (los muros son casillas que bloquean la vista)
        "formula": v.texto(ctx, d, "formula", obligatorio=d.get("tipo") != "efecto"),
        "coste": {},
        "valores": {},          # valores propios de la habilidad («Potencia: 30»), para la fórmula como [h.Potencia]
        "etiquetas": _etiquetas_de(ctx, d, v, cat),     # p. ej. [Fuego]: en la fórmula, ventaja() mira estas contra las del objetivo
        "etiquetas_del_usuario": v.booleano(ctx, d, "etiquetas_del_usuario", False),   # ventaja() también con las etiquetas de quien la usa
        "sin_limite": v.booleano(ctx, d, "sin_limite", False),   # alcance infinito (todo el mapa)
        "golpes": v.entero(ctx, d, "golpes", 1, minimo=1, maximo=MAX_GOLPES),   # cuántas veces golpea (cada golpe tira sus dados)
        "area": _area_habilidad(ctx, d, v),
        "mover_objetivo": _mover_objetivo(ctx, d, v),
        "aplica_estado": v.texto(ctx, d, "aplica_estado"),            # estado que pone a cada objetivo alcanzado (se revisa al final)
        "alternar": v.booleano(ctx, d, "alternar", False),
        "aplicar_si_falla": v.booleano(ctx, d, "aplicar_si_falla", False),   # el estado y los efectos «al alcanzar» también si el ataque hace 0           # si ya lo tiene, se lo quita (activar / desactivar un poder)
        "critico": _critico(ctx, d, v),
        # Requisitos («solo se puede usar si…»): condiciones sobre quien la usa o sobre el objetivo (el objetivo que no las cumple no se ve afectado)
        "requisitos": efectos.validar_requisitos(f"{ctx} → requisitos", d.get("requisitos"), v, cat),
        # Lo que pasa además a cada objetivo alcanzado (aplicar un estado, quitar aguante…)
        "efectos": efectos.validar_efectos(ctx, d.get("efectos"), v, cat, permitidos={"al_impactar"}),
    }
    if r["objetivo"] == "uno_mismo" and r["area"]["forma"] in CON_DIRECCION:
        v.err(ctx, "una habilidad «a sí mismo» solo puede tener área «explosión» (alrededor suyo) o ninguna")
    for k, val in v.diccionario(ctx, d, "valores").items():
        k = str(k).strip()
        if not k or len(k) > 40 or any(ch in k for ch in ".;()[]"):
            v.err(ctx, f"valores → el nombre «{k}» no vale (1–40 caracteres, sin . ; ( ) [ ])")
        elif not _num(val):
            v.err(ctx, f"valores → «{k}» debe ser un número")
        else:
            r["valores"][k] = val
    for k, val in v.diccionario(ctx, d, "coste").items():
        if k not in cat.nombres_recursos():
            v.err(ctx, f"coste → el recurso «{k}» no existe")
        elif isinstance(val, bool) or not isinstance(val, int) or val < 0:
            v.err(ctx, f"coste → «{k}» debe ser un entero mayor o igual que 0")
        else:
            r["coste"][k] = val
    if r["formula"].strip():
        for e in formulas.validar(r["formula"], cat.nombres_formula() + [DISTANCIA], formulas.tablas_de(cat.config), list(r["valores"])):
            v.err(ctx, f"formula → {e}")
    return r


def _normalizar_objeto(ctx, d, v: _Val, cat: Catalogo) -> dict:
    r = {
        "nombre": v.texto(ctx, d, "nombre", obligatorio=True),
        "descripcion": v.texto(ctx, d, "descripcion"),
        "imagen": v.imagen(ctx, d),
        "tipo": v.opcion(ctx, d, "tipo", {"consumible", "equipo", "misc"}, "misc"),
        "precio": v.entero(ctx, d, "precio", 0, minimo=0),
        # Con el equipamiento activado: solo da sus efectos mientras está equipado; «hueco» = dónde va (Casco, Pecho…; vacío = cualquiera)
        "equipable": v.booleano(ctx, d, "equipable", d.get("tipo") == "equipo"),
        "hueco": v.texto(ctx, d, "hueco")[:30],
        "efecto": None,
        # «Siempre activo» = mientras se lleva encima (solo bonos a estadísticas o visión); «Al usarlo» = cualquier otra acción
        "efectos": efectos.validar_efectos(ctx, d.get("efectos"), v, cat, permitidos={"siempre", "al_usar"}),
    }
    for i, e in enumerate(r["efectos"]):
        pasivo = e["cuando"]["tipo"] == "siempre"
        if pasivo and e["hacer"]["tipo"] not in ("bono_estadistica", "bono_vision", "bono_critico"):
            v.err(f"{ctx} → efectos[{i + 1}]", "mientras se lleva encima, un objeto solo puede dar bonos a estadísticas o visión (para lo demás usa «Al usarlo»)")
        if not pasivo and e["hacer"].get("objetivo") == "objetivo":
            v.err(f"{ctx} → efectos[{i + 1}]", "un objeto se usa sobre quien lo lleva: «A quién» debe ser «Sobre sí mismo»")
    ef = d.get("efecto")
    if ef is not None:
        c = f"{ctx} → efecto"
        if not isinstance(ef, dict):
            v.err(ctx, "«efecto» debe ser un conjunto de campos")
        else:
            tipo = v.opcion(c, ef, "tipo", {"restaurar"}, "restaurar")
            recurso = v.texto(c, ef, "recurso", obligatorio=True)
            if recurso and recurso not in cat.nombres_recursos():
                v.err(c, f"el recurso «{recurso}» no existe")
            r["efecto"] = {"tipo": tipo, "recurso": recurso,
                           "valor": v.entero(c, ef, "valor", 1, minimo=1)}
    return r


def _normalizar_elecciones(ctx, d, v: _Val, cat: Catalogo) -> dict:
    """elecciones: {raza: elfo, clase: mago}. Cada opción debe pertenecer a su grupo."""
    crudo = v.diccionario(ctx, d, "elecciones")
    res = {}
    for g, o in crudo.items():
        if g not in cat.grupos:
            v.err(ctx, f"elecciones: el grupo «{g}» no existe")
        elif o not in cat.opciones:
            v.err(ctx, f"elecciones → «{g}»: la opción «{o}» no existe")
        elif cat.opciones[o].get("grupo") != g:
            v.err(ctx, f"elecciones → «{g}»: la opción «{o}» pertenece al grupo «{cat.opciones[o].get('grupo')}»")
        else:
            res[g] = o
    for g, gd in cat.grupos.items():
        if ctx.startswith("characters/") and gd.get("obligatorio") and g not in res and cat.opciones_de(g):
            v.aviso(ctx, f"no elige nada en el grupo obligatorio «{gd.get('nombre') or g}»")
    return res


def _normalizar_grupo(ctx, d, v: _Val, cat: Catalogo) -> dict:
    r = {"nombre": v.texto(ctx, d, "nombre", obligatorio=True),
         "descripcion": v.texto(ctx, d, "descripcion"),
         "obligatorio": v.booleano(ctx, d, "obligatorio", True),
         # ¿se puede cambiar de opción en plena partida? no | formas (ir y volver: humano ↔ lobo) | evolucion (solo hacia delante)
         "transformacion": v.opcion(ctx, d, "transformacion", {"no", "formas", "evolucion"}, "no")}
    s = d.get("solo_si")
    if s is not None:         # «solo aparece si…»: se revisa al final, cuando ya existen todas las opciones (_validar_solo_si)
        r["solo_si"] = s
    return r


def _validar_solo_si(cat: Catalogo, v: _Val):
    """grupos/*.yaml → solo_si: {grupo, opciones}: el grupo solo existe para quien eligió una de esas opciones en otro grupo."""
    for gid, g in cat.grupos.items():
        if "solo_si" not in g:
            continue
        ctx = f"groups/{gid}.yaml → solo_si"
        s = g.pop("solo_si")
        if not isinstance(s, dict):
            v.err(ctx, "debe indicar «grupo» y «opciones»")
            continue
        otro, ops = s.get("grupo"), s.get("opciones")
        if isinstance(ops, str):
            ops = [ops]
        if otro == gid or otro not in cat.grupos:
            v.err(ctx, f"«grupo» debe ser otro grupo de la campaña (es «{otro}»)")
            continue
        if not isinstance(ops, list) or not ops:
            v.err(ctx, "«opciones» debe ser una lista con al menos una opción")
            continue
        malas = [o for o in ops if o not in cat.opciones or cat.opciones[o].get("grupo") != otro]
        if malas:
            v.err(ctx, f"estas opciones no son del grupo «{otro}»: {', '.join(map(str, malas))}")
            continue
        g["solo_si"] = {"grupo": otro, "opciones": list(dict.fromkeys(ops))}
    # Sin ciclos: A depende de B y B de A dejaría ambos sin poder elegirse.
    for gid in cat.grupos:
        visto, actual = set(), gid
        while "solo_si" in cat.grupos[actual]:
            if actual in visto:
                v.err(f"groups/{gid}.yaml → solo_si", "los grupos dependen unos de otros en círculo")
                cat.grupos[gid].pop("solo_si", None)
                break
            visto.add(actual)
            actual = cat.grupos[actual]["solo_si"]["grupo"]


def _normalizar_opcion(ctx, d, v: _Val, cat: Catalogo) -> dict:
    grupo = v.texto(ctx, d, "grupo", obligatorio=True)
    if grupo and grupo not in cat.grupos:
        v.err(ctx, f"«grupo» cita un grupo inexistente: «{grupo}»")
    bonos = {}
    for k, val in v.diccionario(ctx, d, "bonos").items():
        if k not in cat.nombres_stats():
            v.err(ctx, f"bonos → la estadística «{k}» no existe")
        elif isinstance(val, bool) or not isinstance(val, int):
            v.err(ctx, f"bonos → «{k}» debe ser un número entero (puede ser negativo)")
        else:
            bonos[k] = val
    ini_stats = {}
    definidas = {s["nombre"]: s for s in cat.config["juego"]["estadisticas"]}
    for k, val in v.diccionario(ctx, d, "estadisticas").items():
        if k not in definidas:
            v.err(ctx, f"estadisticas → la estadística «{k}» no existe")
        elif isinstance(val, bool) or not isinstance(val, int):
            v.err(ctx, f"estadisticas → «{k}» debe ser un número entero")
        elif not (definidas[k]["minimo"] <= val <= definidas[k]["maximo"]):
            v.err(ctx, f"estadisticas → «{k}» debe estar entre {definidas[k]['minimo']} y {definidas[k]['maximo']} (es {val})")
        else:
            ini_stats[k] = val
    ini_rec = {}
    defrec = {r["nombre"]: r for r in cat.config["juego"]["recursos"]}
    for k, val in v.diccionario(ctx, d, "recursos").items():
        minimo = 1 if k == cat.recurso_vida() else 0
        if k not in defrec:
            v.err(ctx, f"recursos → el recurso «{k}» no existe")
        elif isinstance(val, bool) or not isinstance(val, int) or val < minimo:
            v.err(ctx, f"recursos → «{k}» debe ser un entero mayor o igual que {minimo}")
        else:
            ini_rec[k] = val
    return {"nombre": v.texto(ctx, d, "nombre", obligatorio=True),
            "descripcion": v.texto(ctx, d, "descripcion"),
            "imagen": v.imagen(ctx, d),
            "grupo": grupo, "bonos": bonos,
            "estadisticas": ini_stats, "recursos": ini_rec,
            "puntos_extra": v.entero(ctx, d, "puntos_extra", 0, minimo=0, maximo=10000),
            "elegible": v.booleano(ctx, d, "elegible", True),     # false = no sale al crear personaje (solo por transformación o el GM)
            "rasgos": _normalizar_ids(ctx, d, "rasgos", v, cat.rasgos, "rasgo"),
            "habilidades": _normalizar_ids(ctx, d, "habilidades", v, cat.habilidades, "habilidad"),
            "etiquetas": _etiquetas_de(ctx, d, v, cat),     # quien elija esta opción (raza, clase, especie…) lleva estas etiquetas
            "iniciativa": _iniciativa_de(ctx, d, v, cat),   # estadística propia para la iniciativa (vacío = la de la campaña)
            "imagen_forma": v.imagen(ctx, d, "imagen_forma"),   # imagen del token mientras tenga esta forma (vacío = la suya)
            "evoluciona_a": [x for x in v.lista(ctx, d, "evoluciona_a") if isinstance(x, str)],   # se revisa al final (_validar_evoluciones)
            "puntos_por_nivel": v.entero(ctx, d, "puntos_por_nivel", 0, minimo=0, maximo=1000),   # se suman a los de la campaña al subir de nivel
            "recursos_por_nivel": _recursos_por_nivel(ctx, d, v, defrec),
            "aprende": d.get("aprende") if isinstance(d.get("aprende"), list) else []}       # [{nivel, habilidad}] (se revisa al final)


def _recursos_por_nivel(ctx, d, v: _Val, defrec) -> dict:
    """{recurso: cuánto sube su máximo por nivel} propio de una opción (se suma al de la campaña; puede ser negativo)."""
    res = {}
    for k, val in v.diccionario(ctx, d, "recursos_por_nivel").items():
        if k not in defrec:
            v.err(ctx, f"recursos_por_nivel → el recurso «{k}» no existe")
        elif isinstance(val, bool) or not isinstance(val, int) or not -100000 <= val <= 100000:
            v.err(ctx, f"recursos_por_nivel → «{k}» debe ser un número entero")
        elif val:
            res[k] = val
    return res


def _validar_evoluciones(cat: Catalogo, v: _Val):
    """options/*.yaml → evoluciona_a: opciones del mismo grupo en las que puede convertirse (solo en grupos de «evolución»)."""
    for oid, o in cat.opciones.items():
        ok = []
        for x in o.get("evoluciona_a", []):
            if x == oid or x not in cat.opciones or cat.opciones[x]["grupo"] != o["grupo"]:
                v.err(f"options/{oid}.yaml → evoluciona_a", f"«{x}» debe ser otra opción del mismo grupo")
            elif x not in ok:
                ok.append(x)
        o["evoluciona_a"] = ok


def _iniciativa_de(ctx, d, v: _Val, cat) -> str:
    n = v.texto(ctx, d, "iniciativa").strip()
    if n and n not in cat.nombres_stats():
        v.err(ctx, f"iniciativa → la estadística «{n}» no existe")
        return ""
    return n


TIPOS_SONIDO = ("musica", "ambiente", "efectos")


def _cargar_sonidos(ruta: Path, informe: Informe) -> dict:
    """sonidos.yaml: para cada tipo, una lista de categorías con los nombres de archivo (como la lista de música de Attorney Online).

    Los archivos de audio viven en la carpeta base/ de la campaña (y en la de cada cliente); aquí solo hay nombres. También se acepta una lista
    simple de nombres, que queda en la categoría «General».
    """
    res = {t: [] for t in TIPOS_SONIDO}
    archivo = ruta / "sonidos.yaml"
    if not archivo.is_file():
        return res
    datos = _leer_yaml(archivo, informe, "sonidos.yaml") or {}
    for tipo in TIPOS_SONIDO:
        crudo = datos.get(tipo)
        if crudo is None:
            continue
        if not isinstance(crudo, list):
            informe.errores.append(f"sonidos.yaml: «{tipo}» debe ser una lista")
            continue
        grupos: dict[str, list] = {}
        vistos: set = set()

        def anadir(cat: str, nombre):
            if not nombre_audio_valido(nombre):
                informe.errores.append(f"sonidos.yaml: «{nombre}» en {tipo} no es un nombre de archivo .ogg, .mp3 o .wav sin carpetas")
            elif nombre in vistos:
                informe.avisos.append(f"sonidos.yaml: «{nombre}» está repetido en {tipo}")
            else:
                vistos.add(nombre)
                grupos.setdefault(cat, []).append(nombre)

        for item in crudo:
            if isinstance(item, str):
                anadir("General", item)
            elif isinstance(item, dict):
                cat = item.get("categoria", "General")
                if not isinstance(cat, str) or not cat.strip() or len(cat) > 40:
                    informe.errores.append(f"sonidos.yaml: la categoría «{cat}» de {tipo} debe ser un texto de 1 a 40 letras")
                    continue
                lista = item.get("archivos") or []
                if not isinstance(lista, list):
                    informe.errores.append(f"sonidos.yaml: «archivos» de la categoría «{cat}» debe ser una lista")
                    continue
                grupos.setdefault(cat.strip(), [])
                for n in lista:
                    anadir(cat.strip(), n)
            else:
                informe.errores.append(f"sonidos.yaml: cada elemento de {tipo} debe ser un nombre de archivo o una categoría")
        res[tipo] = [{"categoria": c, "archivos": a} for c, a in grupos.items()]
    return res


def _normalizar_rasgo(ctx, d, v: _Val, cat: Catalogo) -> dict:
    return {"nombre": v.texto(ctx, d, "nombre", obligatorio=True),
            "descripcion": v.texto(ctx, d, "descripcion"),
            "imagen": v.imagen(ctx, d),
            "efectos": efectos.validar_efectos(ctx, d.get("efectos"), v, cat)}


# Los estados no reaccionan a tiradas ni a ataques por sí mismos (eso lo hacen los rasgos).
_DISPARADORES_ESTADO = {"siempre", "inicio_turno", "fin_turno", "al_cambiar_momento", "al_cambiar_clima", "al_atacar", "al_ser_atacado",
                        "al_derrotar", "al_ser_derrotado", "al_recibir_dano", "al_cruzar_umbral", "al_intentar", "al_terminar_estado"}
REAPLICAR = ("renovar", "ignorar", "sumar", "acumular")      # qué pasa si se le vuelve a aplicar a quien ya lo tiene


def _normalizar_estado(ctx, d, v: _Val, cat: Catalogo) -> dict:
    color = v.texto(ctx, d, "color")
    if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        v.err(ctx, f"«color» debe ser un color como #7a4fb5 (es «{color}»)")
        color = ""
    return {"nombre": v.texto(ctx, d, "nombre", obligatorio=True),
            "descripcion": v.texto(ctx, d, "descripcion"),
            "imagen": v.imagen(ctx, d),
            "color": color,                                  # color de su insignia sobre el token (vacío = morado)
            "duracion": v.entero(ctx, d, "duracion", 0, minimo=0, maximo=1000),   # turnos; 0 = hasta que se quite
            "etiquetas": _etiquetas_de(ctx, d, v, cat),      # mientras dure, quien lo sufre tiene estas etiquetas (Mojado → Agua)
            "impide": _impide(ctx, d, v),                    # lo que no puede hacer mientras dure (aturdido, dormido, silenciado…)
            "al_terminar": v.texto(ctx, d, "al_terminar"),   # estado que pasa a sufrir cuando este se acaba (se revisa al final)
            # Volver a aplicarlo: renovar la duración (lo de siempre), ignorarlo, sumar la duración o acumular cargas (y renovar)
            "al_reaplicar": v.opcion(ctx, d, "al_reaplicar", set(REAPLICAR), "renovar"),
            "max_cargas": v.entero(ctx, d, "max_cargas", 5, minimo=1, maximo=100),     # solo con «acumular»; [Cargas] en sus fórmulas
            "impide_etiquetas": _etiquetas_de(ctx, {"etiquetas": d.get("impide_etiquetas")}, v, cat),   # habilidades con estas etiquetas no se pueden usar
            "efectos": efectos.validar_efectos(ctx, d.get("efectos"), v, cat, permitidos=_DISPARADORES_ESTADO)}


IMPIDE = ("atacar", "habilidades", "objetos", "mover")
MODOS_INICIATIVA = ("estadistica", "valor", "manual")


def _impide(ctx, d, v: _Val) -> list[str]:
    l = v.lista(ctx, d, "impide")
    for x in l:
        if x not in IMPIDE:
            v.err(ctx, f"«impide» → «{x}» no vale. Opciones: {', '.join(IMPIDE)}")
    return [x for x in IMPIDE if x in l]


# Un tile puede reaccionar a que alguien lo pise o permanezca en él (y dar bonos mientras tanto).
_DISPARADORES_TILE = {"siempre", "al_entrar", "inicio_turno", "fin_turno"}


def _normalizar_tile(ctx, d, v: _Val, cat: Catalogo) -> dict:
    r = {"nombre": v.texto(ctx, d, "nombre", obligatorio=True),
         "descripcion": v.texto(ctx, d, "descripcion"),
         "color": v.texto(ctx, d, "color"),                 # vacío + sin imagen = «sin gráficos»
         "imagen": v.imagen(ctx, d),
         "invisible": v.booleano(ctx, d, "invisible", False),   # no se dibuja en la partida aunque tenga color o imagen
         "transitable": v.booleano(ctx, d, "transitable", True),
         "bloquea_vision": v.booleano(ctx, d, "bloquea_vision", False),   # niebla de guerra: no se ve a través (muros, puertas cerradas, humo espeso)
         "esconde": v.booleano(ctx, d, "esconde", False),   # quien está encima no se ve para los demás jugadores
         "bloquea_lados": [],                               # lados por los que no se puede entrar ni salir (vallas, mostradores, acantilados)
         "rompible": None,
         "efectos": efectos.validar_efectos(ctx, d.get("efectos"), v, cat, permitidos=_DISPARADORES_TILE)}
    if r["color"] and not re.fullmatch(r"#[0-9a-fA-F]{6}", r["color"]):
        v.err(ctx, f"«color» debe ser un color como #4f8a3c (es «{r['color']}»)")
    for lado in v.lista(ctx, d, "bloquea_lados"):
        if lado not in LADOS:
            v.err(ctx, f"bloquea_lados → «{lado}» no es un lado (norte, sur, este, oeste)")
        elif lado not in r["bloquea_lados"]:
            r["bloquea_lados"].append(lado)
    r["bloquea_lados"].sort(key=list(LADOS).index)
    rom = d.get("rompible")
    if rom:
        c = f"{ctx} → rompible"
        if not isinstance(rom, dict):
            v.err(c, "debe tener los campos golpes y se_convierte_en")
        else:
            destino = v.texto(c, rom, "se_convierte_en")
            if destino and destino not in cat.tiles:
                v.err(c, f"«se_convierte_en»: el tile «{destino}» no existe")
            r["rompible"] = {"golpes": v.entero(c, rom, "golpes", 3, minimo=1, maximo=999), "se_convierte_en": destino}
    return r


def _normalizar_sonidos_personaje(ctx, d, v: _Val, cat: Catalogo) -> list:
    """Efectos de la lista «efectos» de sonidos.yaml que tiene este personaje (el jugador los lanza si la mesa lo permite).
    Un nombre que ya no está en la lista se descarta con un aviso: no impide cargar la campaña."""
    res = []
    for n in v.lista(ctx, d, "sonidos"):
        if not isinstance(n, str):
            v.err(ctx, "«sonidos» solo puede contener nombres de archivo")
        elif n not in cat.archivos_sonido("efectos"):
            v.aviso(ctx, f"el sonido «{n}» ya no está en la lista de efectos y se ignora")
        elif n not in res:
            res.append(n)
    return res


def _normalizar_personaje(ctx, d, v: _Val, cat: Catalogo) -> dict:
    return {
        "elecciones": _normalizar_elecciones(ctx, d, v, cat),
        "nombre": v.texto(ctx, d, "nombre", obligatorio=True),
        "descripcion": v.texto(ctx, d, "descripcion"),
        "imagen": v.imagen(ctx, d),
        "stats": _normalizar_stats(ctx, d, v, cat),
        "recursos": _normalizar_recursos_max(ctx, d, v, cat),
        "habilidades": _normalizar_ids(ctx, d, "habilidades", v, cat.habilidades, "habilidad"),
        "inventario": _normalizar_inventario(ctx, d, v, cat),
        "dinero": v.entero(ctx, d, "dinero", 0, minimo=0, maximo=10 ** 9),
        "sonidos": _normalizar_sonidos_personaje(ctx, d, v, cat),
    }


CAMPOS_VISIBLES = ("estadisticas", "recursos", "inventario", "habilidades", "ficha")   # «ficha» = elecciones, rasgos y personalidad
BANDOS_NPC = {"aliado", "neutral", "enemigo"}
MODOS_ATAQUE = {"enemigos", "enemigos_y_neutros", "todos"}


def _normalizar_enemigo(ctx, d, v: _Val, cat: Catalogo) -> dict:
    """Un NPC: como un personaje, más su bando (aliado, neutral o enemigo). Sin indicarlo es neutral."""
    npc = _normalizar_personaje(ctx, d, v, cat)
    npc["bando"] = v.opcion(ctx, d, "bando", BANDOS_NPC, "neutral")
    npc["etiquetas"] = _etiquetas_de(ctx, d, v, cat)
    npc["nivel"] = v.entero(ctx, d, "nivel", 1, minimo=1, maximo=MAX_NIVEL)     # para [Nivel] en las fórmulas
    npc["experiencia"] = _experiencia_que_cede(ctx, d.get("experiencia"), v, cat)
    # Categoría para ordenarlos (Aliados, Enemigos, Bosque…): solo agrupa en el Editor y en el Panel del GM; vacío = «Sin categoría».
    npc["categoria"] = v.texto(ctx, d, "categoria").strip()[:40]
    return npc


def _experiencia_que_cede(ctx, crudo, v: _Val, cat: Catalogo) -> dict:
    """Lo que cede un NPC al ser derrotado: {tipo de experiencia: cantidad}. Un número suelto va al primer tipo."""
    if crudo is None:
        return {}
    n = cat.config["juego"]["niveles"]
    tipos = n["experiencia"]
    if _num(crudo) and not isinstance(crudo, bool):
        if not tipos:
            v.err(ctx, "«experiencia»: la campaña no tiene tipos de experiencia (Reglas → Niveles y experiencia)")
            return {}
        crudo = {tipos[0]: crudo}
    if not isinstance(crudo, dict):
        v.err(ctx, "«experiencia» debe ser un número o una lista «tipo: cantidad»")
        return {}
    res = {}
    for k, c in crudo.items():
        if k not in tipos:
            v.err(ctx, f"«experiencia» → «{k}» no es un tipo de experiencia de la campaña ({', '.join(tipos) or 'ninguno'})")
        elif not _num(c) or isinstance(c, bool) or not 0 <= c <= 1_000_000:
            v.err(ctx, f"«experiencia» → «{k}» debe ser un número entre 0 y 1000000")
        else:
            res[k] = int(c)
    if res and not n["activo"]:
        v.aviso(ctx, "«experiencia»: la campaña no usa niveles, así que no se repartirá")
    return res


def _normalizar_tienda(ctx, d, v: _Val, cat: Catalogo) -> dict:
    arts = []
    for i, e in enumerate(v.lista(ctx, d, "articulos")):
        c = f"{ctx} → articulos[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "cada artículo debe ser un conjunto de campos")
            continue
        oid = e.get("objeto")
        if oid not in cat.objetos:
            v.err(c, f"cita un objeto inexistente: «{oid}»")
            continue
        stock = e.get("stock")
        if stock is not None and (isinstance(stock, bool) or not isinstance(stock, int) or stock < 0):
            v.err(c, "«stock» debe ser un entero mayor o igual que 0, o quedar vacío (ilimitado)")
            stock = None
        arts.append({"objeto": oid, "precio": v.entero(c, e, "precio", cat.objetos[oid]["precio"], minimo=0),
                     "stock": stock})
    return {"nombre": v.texto(ctx, d, "nombre", obligatorio=True),
            "descripcion": v.texto(ctx, d, "descripcion"), "articulos": arts,
            "recompra": v.entero(ctx, d, "recompra", 0, minimo=0, maximo=100),
            "mapas": [m for m in v.lista(ctx, d, "mapas") if isinstance(m, str)]}   # vacío = se puede abrir en cualquier mapa      # % del precio que paga la tienda al comprar objetos a los jugadores (0 = no compra)


def _leer_capa(c, datos, r, cat, v: _Val) -> list[list[str]]:
    """Una capa de decoración: rejilla del tamaño del mapa con el id del tile en cada casilla ('' = vacía)."""
    rejilla = [[""] * r["ancho"] for _ in range(r["alto"])]
    if datos is None:
        return rejilla
    if not isinstance(datos, dict):
        v.err(c, "debe ser un conjunto «tile: lista de casillas»")
        return rejilla
    for tid, lista in datos.items():
        cc = f"{c}[{tid}]"
        if tid not in cat.tiles:
            v.err(cc, f"el tile «{tid}» no existe (crea ese tile o quita estas casillas)")
            continue
        if not isinstance(lista, list):
            v.err(cc, "debe ser una lista de posiciones [x, y]")
            continue
        for p in lista:
            if not (isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(n, int) and not isinstance(n, bool) for n in p)):
                v.err(cc, f"posición no válida: {p!r} (debe ser [x, y])")
                continue
            x, y = p
            if not (0 <= x < r["ancho"] and 0 <= y < r["alto"]):
                v.err(cc, f"la posición ({x}, {y}) queda fuera del mapa ({r['ancho']}×{r['alto']})")
                continue
            rejilla[y][x] = tid
    return rejilla


def _normalizar_mapa(ctx, d, v: _Val, cat: Catalogo) -> dict:
    r = {
        "nombre": v.texto(ctx, d, "nombre", obligatorio=True),
        "descripcion": v.texto(ctx, d, "descripcion"),
        "ancho": v.entero(ctx, d, "ancho", 20, minimo=1, maximo=200),
        "alto": v.entero(ctx, d, "alto", 15, minimo=1, maximo=200),
        "tamano_tile": v.entero(ctx, d, "tamano_tile", 64, minimo=16, maximo=256),
        "fondo": v.imagen(ctx, d, "fondo"),
        "tile_base": v.texto(ctx, d, "tile_base"),         # lo que hay donde no se pinta nada (vacío = suelo libre y sin gráficos)
        "niebla": v.booleano(ctx, d, "niebla", True),       # si la campaña usa niebla de guerra, este mapa puede desactivarla poniendo «niebla: false»
        "celdas": [], "capa2": [], "capa3": [], "objetos": [], "puntos": [], "inicio": None,
    }
    if r["tile_base"] and r["tile_base"] not in cat.tiles:
        v.err(ctx, f"«tile_base»: el tile «{r['tile_base']}» no existe")
        r["tile_base"] = ""
    # Dónde va la imagen de fondo, en casillas (puede salirse del mapa o no cubrirlo entero). Sin indicarlo, ocupa el mapa justo.
    fa = d.get("fondo_ajuste")
    if fa is not None:
        if not isinstance(fa, dict) or not all(_num(fa.get(k)) for k in ("x", "y", "ancho", "alto")):
            v.err(ctx, "«fondo_ajuste» debe tener x, y, ancho y alto (en casillas)")
        elif not (0.1 <= fa["ancho"] <= 2000 and 0.1 <= fa["alto"] <= 2000 and -2000 <= fa["x"] <= 2000 and -2000 <= fa["y"] <= 2000):
            v.err(ctx, "«fondo_ajuste»: tamaño entre 0,1 y 2000 casillas y posición entre -2000 y 2000")
        else:
            r["fondo_ajuste"] = {k: round(float(fa[k]), 3) for k in ("x", "y", "ancho", "alto")}
    celdas = [[r["tile_base"]] * r["ancho"] for _ in range(r["alto"])]
    pintadas: dict[tuple, str] = {}
    for tid, lista in v.diccionario(ctx, d, "casillas").items():
        c = f"{ctx} → casillas[{tid}]"
        if tid not in cat.tiles:
            v.err(c, f"el tile «{tid}» no existe (crea ese tile o quita estas casillas)")
            continue
        if not isinstance(lista, list):
            v.err(c, "debe ser una lista de posiciones [x, y]")
            continue
        for p in lista:
            if not (isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(n, int) and not isinstance(n, bool) for n in p)):
                v.err(c, f"posición no válida: {p!r} (debe ser [x, y])")
                continue
            x, y = p
            if not (0 <= x < r["ancho"] and 0 <= y < r["alto"]):
                v.err(c, f"la posición ({x}, {y}) queda fuera del mapa ({r['ancho']}×{r['alto']})")
                continue
            if (x, y) in pintadas and pintadas[(x, y)] != tid:
                v.aviso(c, f"la casilla ({x}, {y}) está en dos tiles (también en «{pintadas[(x, y)]}»); se usa «{tid}»")
            pintadas[(x, y)] = tid
            celdas[y][x] = tid
    r["celdas"] = celdas
    # Capas de detalle (solo decoración: no bloquean ni dañan). «detalle» va bajo los tokens y «superior» encima de ellos.
    capas = v.diccionario(ctx, d, "capas")
    for k in capas:
        if k not in ("detalle", "superior"):
            v.err(f"{ctx} → capas", f"capa desconocida «{k}» (solo existen «detalle» y «superior»)")
    for clave, destino in (("detalle", "capa2"), ("superior", "capa3")):
        r[destino] = _leer_capa(f"{ctx} → capas[{clave}]", capas.get(clave), r, cat, v)

    def pos(c, e):
        x = v.entero(c, e, "x", 0, minimo=0)
        y = v.entero(c, e, "y", 0, minimo=0)
        if x >= r["ancho"] or y >= r["alto"]:
            v.err(c, f"la posición ({x}, {y}) queda fuera del mapa")
        return x, y

    for i, e in enumerate(v.lista(ctx, d, "objetos")):
        c = f"{ctx} → objetos[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "debe ser un conjunto de campos")
            continue
        x, y = pos(c, e)
        o = {"nombre": v.texto(c, e, "nombre", obligatorio=True), "x": x, "y": y,
             "imagen": v.imagen(c, e), "bloquea": v.booleano(c, e, "bloquea", False)}
        o["bloquea_vision"] = v.booleano(c, e, "bloquea_vision", o["bloquea"])
        o["destruible"] = v.entero(c, e, "destruible", 0, minimo=0, maximo=1000)    # golpes para romperlo (0 = no se rompe); roto, desaparece
        for k in ("ancho", "alto"):                    # tamaño en casillas (la imagen se estira a ese tamaño); admite cuartos: 1,5 · 2,25
            t = e.get(k, 1)
            if not _num(t) or not (0.25 <= t <= 50):
                v.err(c, f"«{k}» debe ser un número de casillas entre 0,25 y 50")
                t = 1
            o[k] = round(t * 4) / 4
        if x + o["ancho"] > r["ancho"] + 1e-9 or y + o["alto"] > r["alto"] + 1e-9:
            v.err(c, "el objeto se sale del mapa (revisa su posición y su tamaño)")
        r["objetos"].append(o)
    for i, e in enumerate(v.lista(ctx, d, "puntos")):
        c = f"{ctx} → puntos[{i + 1}]"
        if not isinstance(e, dict):
            v.err(c, "debe ser un conjunto de campos")
            continue
        x, y = pos(c, e)
        r["puntos"].append({"nombre": v.texto(c, e, "nombre", obligatorio=True), "x": x, "y": y})
    ini = d.get("inicio")
    if isinstance(ini, dict):
        x, y = pos(f"{ctx} → inicio", ini)
        r["inicio"] = {"x": x, "y": y}
    elif ini is not None:
        v.err(ctx, "«inicio» debe tener los campos x e y")
    if r["inicio"] is None:
        r["inicio"] = {"x": 0, "y": 0}
    return r


MAX_TEXTO_PAGINA = 20000
VISIBILIDAD_PAGINA = {"todos", "oculta"}


def _normalizar_pagina(ctx, d, v: _Val, cat: Catalogo) -> dict:
    """Una página del diario: título, sección (para agruparlas), texto e imagen. Al empezar la partida es visible para todos,
    oculta (el GM la revela cuando quiera) o solo para algunos jugadores."""
    r = {"nombre": v.texto(ctx, d, "nombre", obligatorio=True)[:120],
         "seccion": v.texto(ctx, d, "seccion").strip()[:60],
         "texto": v.texto(ctx, d, "texto"),
         "imagen": v.imagen(ctx, d),
         "visible": v.opcion(ctx, d, "visible", VISIBILIDAD_PAGINA, "todos"),
         "jugadores": []}
    if len(r["texto"]) > MAX_TEXTO_PAGINA:
        v.err(ctx, f"el texto es demasiado largo (máximo {MAX_TEXTO_PAGINA} letras)")
        r["texto"] = r["texto"][:MAX_TEXTO_PAGINA]
    for u in v.lista(ctx, d, "jugadores"):
        if not isinstance(u, str) or not u.strip() or len(u) > 40:
            v.err(ctx, "jugadores → cada jugador debe ser un nombre de usuario")
        elif u.strip() not in r["jugadores"]:
            r["jugadores"].append(u.strip())
    return r


# ── Carga principal ──────────────────────────────────────────────

def cargar(ruta_config) -> tuple[Catalogo, Informe]:
    ruta = Path(ruta_config)
    informe = Informe()
    if not ruta.is_dir():
        informe.errores.append(f"No existe la carpeta de configuración: {ruta}")
        return Catalogo(ruta=ruta, config=copy.deepcopy(CONFIG_DEFECTO)), informe

    v = _Val(informe, ruta / "assets")

    # config.yaml
    archivo_cfg = ruta / "config.yaml"
    if archivo_cfg.is_file():
        raw = _leer_yaml(archivo_cfg, informe, "config.yaml") or {}
    else:
        informe.avisos.append("config.yaml no existe: se usan los valores por defecto")
        raw = {}
    catalogo = Catalogo(ruta=ruta, config=_normalizar_config(raw, v))

    # Leer en crudo cada categoría
    crudos: dict[str, dict] = {}
    for cat_es, carpeta in CATEGORIAS.items():
        crudos[cat_es] = {}
        dir_cat = ruta / carpeta
        if not dir_cat.is_dir():
            if carpeta not in CATEGORIAS_OPCIONALES:
                informe.avisos.append(f"{carpeta}/: la carpeta no existe")
            continue
        for archivo in sorted(dir_cat.glob("*.yaml")):
            datos = _leer_yaml(archivo, informe, f"{carpeta}/{archivo.name}")
            if datos is not None:
                crudos[cat_es][archivo.stem] = datos

    # Orden «Personalizado» que el GM eligió en el Editor (campana.yaml → orden: {carpeta: [ids]}): la partida lo respeta en sus listas
    # (grupos y opciones al crear personaje, NPC del panel del GM, salas…). Lo que no esté en esa lista va detrás, por nombre de archivo.
    meta_cfg = ruta / "campana.yaml"
    orden_propio = {}
    if meta_cfg.is_file():
        aparte = Informe()                       # un campana.yaml roto no impide jugar: solo se avisa y se usa el orden de siempre
        meta = _leer_yaml(meta_cfg, aparte, "campana.yaml") or {}
        informe.avisos += [f"{e} — se usa el orden de siempre" for e in aparte.errores]
        if isinstance(meta, dict) and isinstance(meta.get("orden"), dict):
            orden_propio = {c: [i for i in l if isinstance(i, str)] for c, l in meta["orden"].items() if isinstance(l, list)}
    for cat_es, carpeta in CATEGORIAS.items():
        lista = orden_propio.get(carpeta)
        if lista:
            posicion = {rid: n for n, rid in enumerate(lista)}
            crudos[cat_es] = dict(sorted(crudos[cat_es].items(), key=lambda kv: (posicion.get(kv[0], len(posicion)), kv[0])))

    # Normalizar en orden de dependencias
    orden = [
        ("estados", _normalizar_estado, "states"),
        ("rasgos", _normalizar_rasgo, "traits"),
        ("grupos", _normalizar_grupo, "groups"),
        ("habilidades", _normalizar_habilidad, "abilities"),
        ("objetos", _normalizar_objeto, "items"),
        ("opciones", _normalizar_opcion, "options"),
        ("personajes", _normalizar_personaje, "characters"),
        ("enemigos", _normalizar_enemigo, "enemies"),
        ("tiendas", _normalizar_tienda, "shops"),
        ("tiles", _normalizar_tile, "tiles"),
        ("mapas", _normalizar_mapa, "maps"),
        ("diario", _normalizar_pagina, "journal"),
    ]
    # objetos y habilidades primero con ids sin normalizar para poder resolver referencias
    catalogo.estados = {k: {} for k in crudos["estados"]}
    catalogo.rasgos = {k: {} for k in crudos["rasgos"]}
    catalogo.grupos = {k: {} for k in crudos["grupos"]}
    catalogo.tiles = {k: {} for k in crudos["tiles"]}
    catalogo.habilidades = {k: {} for k in crudos["habilidades"]}
    catalogo.objetos = {k: {"precio": 0} for k in crudos["objetos"]}
    catalogo.opciones = {k: {} for k in crudos["opciones"]}           # las condiciones «es de una raza/clase» las citan
    catalogo.sonidos = _cargar_sonidos(ruta, informe)       # antes que los personajes: ellos citan efectos de esa lista
    for cat_es, fn, carpeta in orden:
        destino = {}
        for rid, datos in crudos[cat_es].items():
            destino[rid] = fn(f"{carpeta}/{rid}.yaml", datos, v, catalogo)
        setattr(catalogo, cat_es, destino)

    _validar_solo_si(catalogo, v)
    _validar_aprende(catalogo, v)
    _validar_evoluciones(catalogo, v)
    _validar_inventario_inicial(catalogo, v)
    _validar_referencias_nuevas(catalogo, v)
    # Efectos de la campaña (al final: pueden citar estados, objetos, opciones y etiquetas)
    catalogo.config["juego"]["efectos"] = efectos.validar_efectos("config.yaml → juego → efectos", catalogo.config["juego"].get("efectos"), v, catalogo)

    if not catalogo.mapas:
        informe.errores.append("maps/: no hay ningún mapa; crea al menos uno")
    mi = catalogo.config["juego"].get("mapa_inicial")
    if mi is not None and mi not in catalogo.mapas:
        informe.errores.append(f"config.yaml: «mapa_inicial» cita un mapa inexistente: «{mi}»")

    return catalogo, informe
