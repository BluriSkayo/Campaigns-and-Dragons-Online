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

from . import efectos, formulas
# Validación genérica (validacion.py) y la de config.yaml (config_campana.py); se pueden seguir importando desde aquí.
from .config_campana import (CAMPOS_VISIBLES, CARGAS, CONFIG_DEFECTO, DETALLE, MAX_NIVEL, MENU_SECCIONES, MODOS_ATAQUE,  # noqa: F401
                             MODOS_INICIATIVA, NIVEL, RANGO, _normalizar_config, _validar_campos_ficha, _validar_etiquetas,
                             nivel_maximo, valor_campo)
from .validacion import Informe, _fusionar, _leer_yaml, _num, _Val  # noqa: F401

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

_NOMBRE_AUDIO = re.compile(r"^[^\\/:*?\"<>|\x00-\x1f]{1,120}\.(ogg|mp3|wav)$", re.I)


def nombre_audio_valido(nombre) -> bool:
    """El audio vive en la carpeta base/ de la campaña (y en la de cada cliente): el servidor solo comprueba que el nombre sea razonable (sin rutas)."""
    return isinstance(nombre, str) and bool(_NOMBRE_AUDIO.match(nombre)) and not nombre.startswith(".") and ".." not in nombre


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


# ── Normalizadores por tipo ──────────────────────────────────────


# Lados de una casilla y hacia dónde llevan (dx, dy). «sur» = hacia abajo en el mapa.
LADOS = {"norte": (0, -1), "sur": (0, 1), "este": (1, 0), "oeste": (-1, 0)}
OPUESTO = {"norte": "sur", "sur": "norte", "este": "oeste", "oeste": "este"}


def celdas_de_objeto(o: dict) -> set[tuple[int, int]]:
    """Casillas que ocupa un objeto del mapa: las que toca su rectángulo (x, y, ancho, alto)."""
    x0, y0 = o["x"], o["y"]
    x1, y1 = math.ceil(x0 + o.get("ancho", 1) - 1e-9), math.ceil(y0 + o.get("alto", 1) - 1e-9)
    return {(x, y) for x in range(x0, max(x0 + 1, x1)) for y in range(y0, max(y0 + 1, y1))}


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
TIPOS_HABILIDAD = ("dano", "curacion", "efecto")      # efecto = sin daño ni curación (solo estados y efectos)


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
        "tipo": v.opcion(ctx, d, "tipo", set(TIPOS_HABILIDAD), "dano"),   # efecto = sin daño ni curación (solo estados y efectos)
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


BANDOS_NPC = {"aliado", "neutral", "enemigo"}


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
