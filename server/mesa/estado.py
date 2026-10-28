"""
estado.py — Lógica de la partida. No sabe nada de red ni de WebSockets.

Contiene: personajes de los jugadores, tokens del mapa, combate por turnos,
habilidades, objetos, dados, chat y música.
Toda regla se valida aquí; el cliente solo pide acciones.
"""

from __future__ import annotations

import copy
import math
from contextlib import contextmanager
import random
import re
import uuid
from pathlib import Path

import yaml

from . import formulas, recursos
from .motor import MotorEfectos
from .comercio import ComercioMixin, CofresMixin
from .errores import ErrorJuego
from .recursos import Catalogo, MAX_NIVEL


class _Dumper(yaml.SafeDumper):
    def ignore_aliases(self, data):  # evita anclas &id001 en los YAML
        return True


def _id() -> str:
    return uuid.uuid4().hex[:8]


def _archivo_usuario(usuario: str) -> str:
    return re.sub(r"[^\w\-]", "_", usuario.casefold()) + ".yaml"


COLORES_DIBUJO = ("#f0b44c", "#c4533f", "#6fb7a8", "#4f8fd1", "#b07ad9", "#e8ecf4", "#7ac74f")
MAX_PUNTOS_TRAZO, MAX_TRAZOS = 300, 400
GROSOR_DIBUJO = (1.0, 24.0, 4.0)            # lápiz: mínimo, máximo y el de siempre (en píxeles de pantalla)
RADIO_BORRADOR = (0.1, 3.0)                 # borrador: mínimo y máximo, en casillas
MAX_CENTROS_BORRADOR = 120                  # posiciones del borrador que caben en un solo mensaje
CAMPOS_REVELABLES = ("estadisticas", "recursos", "inventario", "habilidades", "ficha")
_EXT_IMAGEN = (".png", ".jpg", ".jpeg", ".webp", ".gif")
_CARPETAS_IMAGEN = ("tokens", "icons", "otros")      # de dónde puede elegir un jugador la imagen de su personaje


def nombre_imagen(v) -> str:
    """Imagen elegida por un jugador: un archivo de la carpeta de imágenes del cliente («tokens/orco.png», «tokens/jugadores/ana.png»,
    «icons/retratos/lobo.png»…). Puede estar en tokens/, icons/ u otros/ y en hasta tres subcarpetas; un nombre suelto se entiende en tokens/.
    El servidor solo guarda el nombre (no guarda ni envía imágenes); lo que no parezca una ruta segura se descarta."""
    if not isinstance(v, str):
        return ""
    v = v.strip()
    if not v or len(v) > 200:
        return ""
    partes = v.split("/")
    if len(partes) == 1 or partes[0] not in _CARPETAS_IMAGEN:
        partes = ["tokens", *partes] if len(partes) == 1 else partes
    if partes[0] not in _CARPETAS_IMAGEN or not 1 <= len(partes) - 1 <= 4:
        return ""
    for t in partes[1:]:
        if not t or len(t) > 100 or any(c in t for c in '\\:*?"<>|\x00') or t.startswith(".") or t.endswith((".", " ")):
            return ""
    return "/".join(partes) if partes[-1].lower().endswith(_EXT_IMAGEN) else ""


LIMITE_PROPIAS = 30
MAX_TIRADAS = 30
RE_NOMBRE_TIRADA = re.compile(r"[\w][\w \-'+]{0,29}")


def campo_de_vision(ox: int, oy: int, radio: int, opacas: set, ancho: int, alto: int) -> set[tuple[int, int]]:
    """Casillas visibles desde (ox, oy) hasta `radio` casillas (círculo), sin ver a través de `opacas` (se ve la propia pared, no lo que hay tras ella).
    Sombreado recursivo por octantes."""
    vis = {(ox, oy)}
    r2 = radio * radio + radio
    mult = ((1, 0, 0, -1, -1, 0, 0, 1), (0, 1, -1, 0, 0, -1, 1, 0), (0, 1, 1, 0, 0, -1, -1, 0), (1, 0, 0, 1, -1, 0, 0, -1))

    def barrer(fila, ini, fin, xx, xy, yx, yy):
        if ini < fin:
            return
        nuevo_inicio = 0.0
        for j in range(fila, radio + 1):
            dx, dy = -j - 1, -j
            bloqueado = False
            while dx <= 0:
                dx += 1
                x, y = ox + dx * xx + dy * xy, oy + dx * yx + dy * yy
                izq, der = (dx - 0.5) / (dy + 0.5), (dx + 0.5) / (dy - 0.5)
                if ini < der:
                    continue
                if fin > izq:
                    break
                dentro = 0 <= x < ancho and 0 <= y < alto
                if dentro and dx * dx + dy * dy <= r2:
                    vis.add((x, y))
                opaca = (not dentro) or ((x, y) in opacas)
                if bloqueado:
                    if opaca:
                        nuevo_inicio = der
                        continue
                    bloqueado = False
                    ini = nuevo_inicio
                elif opaca and j < radio:
                    bloqueado = True
                    barrer(j + 1, ini, izq, xx, xy, yx, yy)
                    nuevo_inicio = der
            if bloqueado:
                break

    for o in range(8):
        barrer(1, 1.0, 0.0, mult[0][o], mult[1][o], mult[2][o], mult[3][o])
    return vis


def normalizar_propias(d, estricto: bool = False) -> dict:
    """{habilidades:[{nombre,descripcion}], objetos:[{nombre,descripcion,cantidad}]}; texto acotado. Con `estricto` lanza error si algo no cuadra."""
    d = d if isinstance(d, dict) else {}
    res = {"habilidades": [], "objetos": []}
    for tipo in res:
        crudo = d.get(tipo) if isinstance(d.get(tipo), list) else []
        for e in crudo[:LIMITE_PROPIAS]:
            nombre = str(e.get("nombre", "")).strip()[:40] if isinstance(e, dict) else ""
            if not nombre:
                if estricto:
                    raise ErrorJuego("Cada anotación necesita un nombre")
                continue
            item = {"nombre": nombre, "descripcion": str(e.get("descripcion", "")).strip()[:300]}
            if tipo == "objetos":
                c = e.get("cantidad", 1)
                item["cantidad"] = max(1, min(999, c)) if isinstance(c, int) and not isinstance(c, bool) else 1
            res[tipo].append(item)
    return res


MAX_HISTORIA = 20000         # la historia del personaje (varias páginas)


def recortar_trazo(puntos: list, cx: float, cy: float, r: float) -> list[list] | None:
    """Quita de un trazo la parte que cae dentro del círculo (cx, cy, r). → None si el círculo no lo toca; si lo toca, la lista de
    trozos que quedan (cada uno con 2 o más puntos; puede estar vacía). Corta también segmentos largos entre dos puntos."""
    def dentro(p):
        return math.hypot(p[0] - cx, p[1] - cy) <= r

    if len(puntos) == 1:
        return [] if dentro(puntos[0]) else None
    trozos: list[list] = []
    actual: list = [] if dentro(puntos[0]) else [list(puntos[0])]
    tocado = dentro(puntos[0])
    for a, b in zip(puntos, puntos[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        fx, fy = a[0] - cx, a[1] - cy
        A, B, C = dx * dx + dy * dy, 2 * (fx * dx + fy * dy), fx * fx + fy * fy - r * r
        if A == 0:
            ini, fin = (0.0, 1.0) if C <= 0 else (None, None)
        else:
            disc = B * B - 4 * A * C
            if disc <= 0:                                # no llega a entrar (o solo roza el borde)
                ini = fin = None
            else:
                raiz = math.sqrt(disc)
                t1, t2 = (-B - raiz) / (2 * A), (-B + raiz) / (2 * A)
                ini, fin = (None, None) if (t2 < 0 or t1 > 1) else (max(t1, 0.0), min(t2, 1.0))
        if ini is None:
            actual.append(list(b))                       # el segmento queda entero fuera
            continue
        tocado = True
        if ini > 0:                                      # entra en el círculo: se corta justo en el borde
            actual.append([a[0] + dx * ini, a[1] + dy * ini])
            trozos.append(actual)
            actual = []
        elif actual:                                     # empezaba justo en el borde
            trozos.append(actual)
            actual = []
        if fin < 1:                                      # sale del círculo: empieza otro trozo
            actual = [[a[0] + dx * fin, a[1] + dy * fin], list(b)]
    if actual:
        trozos.append(actual)
    if not tocado:
        return None
    return [[[round(x, 2), round(y, 2)] for x, y in t] for t in trozos if len(t) >= 2]


_SIN_VALOR = object()


def _indice_en(valor, n: int):
    """Un índice entero válido de una lista de `n` elementos, o _SIN_VALOR (para no tocar lo que ya había)."""
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and 0 <= valor < n else _SIN_VALOR


def rango_de(escalones: list, valor) -> int:
    """El rango (1, 2, 3…) que le toca a una estadística con `escalones` por su valor: 1 + los escalones que ya alcanzó."""
    return 1 + sum(1 for u in escalones if valor >= u)


def _redondear(v: float) -> int:
    """Redondeo «de toda la vida» (0,5 hacia fuera), igual en el servidor y en el cliente."""
    return int(math.floor(abs(v) + 0.5)) * (1 if v >= 0 else -1)


class EstadoPartida(ComercioMixin, CofresMixin, MotorEfectos):
    def __init__(self, catalogo: Catalogo, datos_dir, rng: random.Random | None = None,
                 persistir: bool = True):
        self.cat = catalogo
        self.cfg = catalogo.config
        self.datos_dir = Path(datos_dir)
        self.persistir = persistir
        self.rng = rng or random.Random()
        self.cuenta_permite = lambda usuario, clave: True      # el servidor lo cambia: bloqueos individuales de cada cuenta (ver_ajenos, editar)

        self.personajes: dict[str, list[dict]] = {}   # usuario → personajes
        # Salas: cada mapa de la campaña es una sala con sus propios tokens, combate, dibujos, capas y niebla. Varias pueden estar
        # en uso a la vez. Casi todo el código trabaja sobre «la sala actual» (`mapa_id`): el servidor la elige antes de atender
        # cada mensaje (ver `usar_sala` / `en_sala`), así cada regla sigue escrita como si hubiera un solo mapa.
        self.salas: dict[str, dict] = {}
        self.salas_cerradas: set[str] = set()     # salas a las que los jugadores no pueden entrar por su cuenta (las decide el GM)
        self.cambios_casillas: dict[str, dict[str, dict]] = {}   # mapa → {"x,y": {tile?, golpes}}: lo que la partida ha cambiado
        self.objetos_golpeados: dict[str, dict[str, int]] = {}  # mapa → {huella del objeto: golpes recibidos; -1 = roto (ya no está)}
        self.mapa_id: str = self._mapa_por_defecto()
        self.mapa_principal: str = self.mapa_id   # la sala donde aparece quien entra sin personaje en el mapa («Llevar a todos» la cambia)
        self.chat: list[dict] = []
        self.salas_chat: dict[str, dict] = {}   # salas privadas de chat que crea el GM: id → {id, nombre, miembros}. La sala «general» es de todos y no se guarda aquí.
        self.musica: str | None = None
        self.periodo = self.cfg["juego"]["ciclo"]["inicial"]      # momento del día actual (índice en juego.ciclo.periodos)
        self.clima = self.cfg["juego"]["clima"]["inicial"]        # clima actual (índice en juego.clima.tipos)
        self._iniciar_comercio()
        self._iniciar_cofres()
        self._version_opacas = 0
        self._cache_vision: dict = {}
        self.tiradas_guardadas: dict = {}      # tiradas que guarda cada usuario: {usuario: [{"nombre", "expresion"}]}
        self.diario_vis: dict = {}             # páginas del diario que el GM reveló u ocultó en partida: {id: {"visible", "jugadores"}}
        self.dibujo_bloqueado = False          # el GM puede impedir que los jugadores dibujen
        self.ambiente: list[str] = []          # sonidos de ambiente sonando ahora (nombres de archivo)
        self.golpes_pendientes: list = []                        # (texto, cambio) de tiles/objetos golpeados por una habilidad, para avisar a todos
        self._init_motor()

    # ── Salas (un mapa = una sala) ───────────────────────────────
    @staticmethod
    def _sala_nueva() -> dict:
        return {"tokens": {}, "combate": {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}},
                "dibujos": [],          # trazos temporales sobre el mapa (no se guardan)
                "capas_ocultas": [],    # capas de detalle (2 y 3) que el GM ha ocultado en esta sala
                "niebla_gm": None,      # el GM enciende o apaga la niebla de esta sala en plena partida (None = lo que diga la campaña)
                "cola_chat": [], "cola_tokens": set(),     # lo que ocurrió «solo» (efectos) en esta sala y falta avisar
                "cache": {}}            # casillas bloqueadas, celdas y casillas opacas de este mapa (se recalculan solas)

    def _sala(self) -> dict:
        s = self.salas.get(self.mapa_id)
        if s is None:
            s = self.salas[self.mapa_id] = self._sala_nueva()
        return s

    def _campo_sala(nombre):  # noqa: N805 — fabrica una propiedad que lee y escribe en la sala actual
        return property(lambda self: self._sala()[nombre], lambda self, v: self._sala().__setitem__(nombre, v))

    tokens = _campo_sala("tokens")
    combate = _campo_sala("combate")
    dibujos = _campo_sala("dibujos")
    capas_ocultas = _campo_sala("capas_ocultas")
    niebla_gm = _campo_sala("niebla_gm")
    cola_chat = _campo_sala("cola_chat")
    cola_tokens = _campo_sala("cola_tokens")
    del _campo_sala

    @property
    def _bloqueadas(self) -> set:
        c = self._sala()["cache"]
        if "bloqueadas" not in c:
            self._recalcular_bloqueos()
        return c["bloqueadas"]

    @property
    def _celdas(self) -> list:
        c = self._sala()["cache"]
        if "celdas" not in c:
            self._recalcular_bloqueos()
        return c["celdas"]

    @_bloqueadas.setter
    def _bloqueadas(self, v):
        self._celdas                     # se calculan juntas: que no se pise lo que se pone aquí
        self._sala()["cache"]["bloqueadas"] = v

    @_celdas.setter
    def _celdas(self, v):
        self._bloqueadas
        self._sala()["cache"]["celdas"] = v

    @property
    def _cache_opacas(self):
        return self._sala()["cache"].get("opacas")

    @_cache_opacas.setter
    def _cache_opacas(self, v):
        self._sala()["cache"]["opacas"] = v

    def usar_sala(self, mapa_id: str):
        """Pasa a trabajar sobre esa sala (el servidor lo hace antes de atender cada mensaje)."""
        if mapa_id not in self.cat.mapas:
            raise ErrorJuego("Esa sala no existe")
        self.mapa_id = mapa_id
        self._sala()

    @contextmanager
    def en_sala(self, mapa_id: str):
        """`with estado.en_sala(m):` — trabaja un momento sobre otra sala y luego vuelve a la de antes."""
        antes = self.mapa_id
        self.usar_sala(mapa_id)
        try:
            yield self
        finally:
            self.mapa_id = antes

    def salas_en_uso(self) -> list[str]:
        """Las salas con algún token, más la principal (en orden de la campaña)."""
        return [m for m in self.cat.mapas if m == self.mapa_principal or (self.salas.get(m) or {}).get("tokens")]

    def todos_los_tokens(self):
        """(sala, token) de todas las salas."""
        for m, s in self.salas.items():
            for t in s["tokens"].values():
                yield m, t

    def sala_de_token(self, token_id: str) -> str | None:
        return next((m for m, s in self.salas.items() if token_id in s["tokens"]), None)

    def sala_abierta(self, mapa_id: str) -> bool:
        return mapa_id in self.cat.mapas and mapa_id not in self.salas_cerradas

    def abrir_sala(self, mapa_id, abierta) -> None:
        """El GM deja (o no) que los jugadores entren solos en esa sala."""
        if not isinstance(mapa_id, str) or mapa_id not in self.cat.mapas or not isinstance(abierta, bool):
            raise ErrorJuego("Esa sala no existe")
        if abierta:
            self.salas_cerradas.discard(mapa_id)
        else:
            self.salas_cerradas.add(mapa_id)
        self.guardar_estado()

    def vista_salas(self, es_gm: bool, actual: str | None = None) -> list[dict]:
        """Las salas que puede ver este usuario en el panel «Salas». El GM, todas (con cuántos tokens hay); un jugador, las abiertas
        si la mesa le deja moverse solo (y siempre la suya)."""
        libres = self.cfg["permisos"]["cambiar_sala"] == "todos"
        res = []
        for m, d in self.cat.mapas.items():
            abierta = self.sala_abierta(m)
            if not es_gm and m != actual and not (libres and abierta):
                continue
            v = {"id": m, "nombre": d["nombre"], "abierta": abierta}
            if es_gm:
                toks = list((self.salas.get(m) or {}).get("tokens", {}).values())
                v.update(ancho=d["ancho"], alto=d["alto"], principal=m == self.mapa_principal,
                         personajes=sum(1 for t in toks if t["tipo"] == "personaje"), npc=sum(1 for t in toks if t["tipo"] == "enemigo"),
                         combate=bool((self.salas.get(m) or {}).get("combate", {}).get("activo")))
            res.append(v)
        return res

    def _colocar_en_sala(self, tokens: list[dict], destino: str, x: int | None = None, y: int | None = None) -> None:
        """Mete en la sala `destino` unos tokens que ya no están en ninguna: el primero en (x, y) o junto al punto de inicio;
        los demás (su grupo), lo más cerca posible."""
        with self.en_sala(destino):
            if x is not None and y is not None:
                if not self.casilla_transitable(x, y) or self.casilla_ocupada(x, y):
                    raise ErrorJuego("No se puede colocar ahí: casilla bloqueada u ocupada")
                cx, cy = x, y
            else:
                ini = self.mapa["inicio"]
                cx, cy = ini["x"], ini["y"]
            for t in tokens:
                t["x"], t["y"] = -1, -1
            for t in tokens:
                t["x"], t["y"] = self._casilla_libre_cerca(cx, cy)
                self.tokens[t["id"]] = t
            self._cache_vision.clear()

    def _limpiar_grupos(self, tokens: list[dict] | None = None) -> None:
        """Un grupo del que solo queda un token en la sala ya no es un grupo."""
        lista = list(self.tokens.values()) if tokens is None else tokens
        cuenta: dict[str, int] = {}
        for t in lista:
            if t.get("grupo"):
                cuenta[t["grupo"]] = cuenta.get(t["grupo"], 0) + 1
        for t in lista:
            if t.get("grupo") and cuenta[t["grupo"]] < 2:
                t.pop("grupo")

    def _sacar_de_sala(self, tokens: list[dict]) -> None:
        """Quita unos tokens de la sala actual sin borrarlos (para llevarlos a otra)."""
        for t in tokens:
            self.tokens.pop(t["id"], None)
            if self.combate["activo"] or self.combate.get("preparando"):
                self._retirar_del_combate(t["id"])

    def mover_a_sala(self, token_id: str, destino, x: int | None = None, y: int | None = None) -> list[str]:
        """El GM lleva un token (y su grupo) de la sala actual a otra. → ids de los tokens movidos."""
        if not isinstance(destino, str) or destino not in self.cat.mapas:
            raise ErrorJuego("Esa sala no existe")
        if destino == self.mapa_id:
            raise ErrorJuego("Ese token ya está en esta sala")
        t = self._token(token_id)
        grupo = self.tokens_del_grupo(t)
        self._sacar_de_sala(grupo)
        try:
            self._colocar_en_sala(grupo, destino, x, y)
        except ErrorJuego:
            for o in grupo:                 # no cabía: todo vuelve a su sitio
                self.tokens[o["id"]] = o
            raise
        self.guardar_estado()
        return [o["id"] for o in grupo]

    def cambiar_de_sala(self, usuario: str, es_gm: bool, token_id: str | None, destino) -> list[str]:
        """Un jugador se va a otra sala por su cuenta (si la mesa lo permite y la sala está abierta), con su token activo y su grupo.
        Sin token en el mapa, solo cambia lo que ve. → ids de los tokens que viajaron."""
        if not isinstance(destino, str) or destino not in self.cat.mapas:
            raise ErrorJuego("Esa sala no existe")
        if not es_gm:
            if self.cfg["permisos"]["cambiar_sala"] != "todos":
                raise ErrorJuego("En esta mesa solo el GM puede llevarte a otra sala")
            if not self.sala_abierta(destino):
                raise ErrorJuego("El GM ha cerrado esa sala")
        if destino == self.mapa_id or not token_id or es_gm:
            return []
        t = self._token(token_id)
        if not self.controla(t, usuario):
            raise ErrorJuego("Solo puedes llevarte tus propios tokens")
        if self.combate["activo"] or self.combate.get("preparando"):
            raise ErrorJuego("No puedes irte de la sala en pleno combate")
        return self.mover_a_sala(token_id, destino)

    # ── Mapa ─────────────────────────────────────────────────────
    def _mapa_por_defecto(self) -> str:
        m = self.cfg["juego"].get("mapa_inicial")
        return m if m in self.cat.mapas else sorted(self.cat.mapas)[0]

    @property
    def mapa(self) -> dict:
        return self.cat.mapas[self.mapa_id]

    @staticmethod
    def huella_objeto(o: dict) -> str:
        """Cómo se reconoce un objeto del mapa entre sesiones: nombre y posición (no su lugar en la lista, que cambia al borrar o reordenar)."""
        return f"{o['nombre']}|{o['x']}|{o['y']}"

    def _roto(self, o: dict) -> bool:
        return bool(o.get("destruible")) and self.objetos_golpeados.get(self.mapa_id, {}).get(self.huella_objeto(o)) == -1

    def objetos_vivos(self) -> list[dict]:
        """Objetos del mapa que siguen en pie. Solo puede faltar uno destruible que se rompió."""
        return [o for o in self.mapa["objetos"] if not self._roto(o)]

    def _recalcular_bloqueos(self):
        cache = self._sala()["cache"]
        cache["bloqueadas"] = {c for o in self.objetos_vivos() if o["bloquea"] for c in recursos.celdas_de_objeto(o)}
        celdas = cache["celdas"] = [list(f) for f in self.mapa["celdas"]]
        for k, c in self.cambios_casillas.get(self.mapa_id, {}).items():
            x, y = (int(n) for n in k.split(","))
            if "tile" in c and 0 <= x < self.mapa["ancho"] and 0 <= y < self.mapa["alto"]:
                celdas[y][x] = c["tile"]

    @property
    def mapa_vivo(self) -> dict:
        """El mapa tal como está ahora (con las casillas rotas), listo para enviar a los clientes."""
        return {**self.mapa, "celdas": [list(f) for f in self._celdas], "objetos": self.objetos_vivos()}

    def tile_en(self, x: int, y: int) -> dict | None:
        """El tile de esa casilla, o None si es suelo libre sin tile."""
        if not (0 <= x < self.mapa["ancho"] and 0 <= y < self.mapa["alto"]):
            return None
        return self.cat.tiles.get(self._celdas[y][x]) if self._celdas[y][x] else None

    def casilla_transitable(self, x: int, y: int) -> bool:
        m = self.mapa
        if not (0 <= x < m["ancho"] and 0 <= y < m["alto"]):
            return False
        tile = self.tile_en(x, y)
        if tile and not tile["transitable"]:
            return False
        return (x, y) not in self._bloqueadas

    # ── Niebla de guerra ─────────────────────────────────────────
    def niebla_activa(self) -> bool:
        """¿Hay niebla ahora? La campaña la activa (o el GM la enciende/apaga en plena partida) y el mapa puede excluirse con «niebla: false»."""
        base = self.cfg["juego"]["niebla"]["activa"] if self.niebla_gm is None else self.niebla_gm
        return bool(base and self.mapa.get("niebla", True))

    def _opacas(self) -> set[tuple[int, int]]:
        """Casillas que tapan la vista: tiles con «bloquea_vision» y objetos del mapa que la bloquean (se recalcula solo si cambia el terreno)."""
        m = self.mapa
        firma = (self.mapa_id, tuple(sorted(self.cambios_casillas.get(self.mapa_id, {}))), tuple(sorted(c.get("tile", "") for c in self.cambios_casillas.get(self.mapa_id, {}).values())),
                 tuple(sorted(k for k, g in self.objetos_golpeados.get(self.mapa_id, {}).items() if g == -1)))
        if self._cache_opacas and self._cache_opacas[0] == firma:
            return self._cache_opacas[1]
        res = {c for o in self.objetos_vivos() if o.get("bloquea_vision") for c in recursos.celdas_de_objeto(o)}
        for y in range(m["alto"]):
            fila = self._celdas[y]
            for x in range(m["ancho"]):
                t = self.cat.tiles.get(fila[x]) if fila[x] else None
                if t and t.get("bloquea_vision"):
                    res.add((x, y))
        self._version_opacas += 1
        self._cache_opacas = (firma, res)
        return res

    def linea_libre(self, a: dict, b: dict) -> bool:
        """¿Se ve b desde a sin que lo tape una casilla que bloquea la vista? (la misma regla que la niebla de guerra)."""
        d = self.distancia(a, b)
        if d <= 1:
            return True
        radio = d * 3 // 2 + 1                    # el campo es circular; la distancia, en casillas con diagonales
        return (b["x"], b["y"]) in campo_de_vision(a["x"], a["y"], radio, self._opacas(), self.mapa["ancho"], self.mapa["alto"])

    def visibles_para(self, usuario: str) -> set[tuple[int, int]]:
        """Casillas que ve un jugador: lo que alcanza la visión de sus personajes (y, si la mesa lo permite, la de los demás jugadores).
        Se guarda el último resultado mientras nadie se mueva ni cambie su visión (el servidor lo pide muchas veces por mensaje)."""
        compartir = self.cfg["juego"]["niebla"]["compartir"]
        origenes = [t for t in self.tokens.values() if t.get("x", -1) >= 0
                    and ((t["tipo"] == "personaje" and compartir) or self.controla(t, usuario))]
        if not origenes:
            return set()
        opacas = self._opacas()
        base = [(t["x"], t["y"], self.vision_de(t)) for t in origenes]
        firma = (self._version_opacas, self.mapa_id, tuple(base))
        c = self._cache_vision.get((usuario, self.mapa_id))
        if c and c[0] == firma:
            return c[1]
        res: set[tuple[int, int]] = set()
        for x, y, r in base:
            res |= campo_de_vision(x, y, r, opacas, self.mapa["ancho"], self.mapa["alto"])
        self._cache_vision[(usuario, self.mapa_id)] = (firma, res)
        return res

    def mascara_niebla(self, usuario: str, es_gm: bool) -> list[str] | None:
        """Una fila de '1' (se ve) y '0' (niebla) por cada fila del mapa. None = sin niebla para este usuario."""
        if es_gm or not self.niebla_activa():
            return None
        vis = self.visibles_para(usuario)
        m = self.mapa
        return ["".join("1" if (x, y) in vis else "0" for x in range(m["ancho"])) for y in range(m["alto"])]

    def jugadores_en_mapa(self) -> list[str]:
        """Jugadores con algún token en este mapa (su personaje o un NPC que controlan): para la niebla «como la ve…» del GM."""
        us = {t["dueno"] if t["tipo"] == "personaje" else t.get("controlado_por") for t in self.tokens.values() if t.get("x", -1) >= 0}
        return sorted((u for u in us if u and any(self.controla(t, u) for t in self.tokens.values())), key=str.casefold)

    def mascara_para_gm(self, como: str | None) -> list[str] | None:
        """Ayuda visual del GM: la niebla tal como la ve un jugador (`como`) o todo el grupo junto («*»). None = sin niebla."""
        if not como or not self.niebla_activa():
            return None
        vis: set = set()
        for u in (self.jugadores_en_mapa() if como == "*" else [como]):
            vis |= self.visibles_para(u)
        m = self.mapa
        return ["".join("1" if (x, y) in vis else "0" for x in range(m["ancho"])) for y in range(m["alto"])]

    def puede_ver(self, t: dict, usuario: str, es_gm: bool) -> bool:
        """Un token sobre un tile que esconde solo lo ven el GM y su dueño; con niebla, solo se ve lo que cae en la visión del jugador."""
        if es_gm or self.controla(t, usuario):
            return True
        if self.niebla_activa() and (t["x"], t["y"]) not in self.visibles_para(usuario):
            return False
        tile = self.tile_en(t["x"], t["y"])
        return not (tile and tile["esconde"])

    def golpear_casilla(self, x: int, y: int, usuario: str, es_gm: bool, token_id: str | None = None,
                        romper_ya: bool = False) -> tuple[str, dict]:
        """Un golpe a una casilla rompible. El GM puede romperla de golpe; un jugador necesita permiso, un token propio al lado y su turno."""
        if not self.rompible_en(x, y):
            raise ErrorJuego("Esa casilla no se puede romper")
        permisos = self.cfg["permisos"]
        if romper_ya and not es_gm:
            raise ErrorJuego("Solo el GM puede romper una casilla de golpe")
        if not es_gm:
            if permisos["romper_casillas"] != "todos":
                raise ErrorJuego("En esta mesa solo el GM puede romper casillas")
            t = self._token(token_id or "")
            if not self.puede_controlar(t, usuario, False):
                raise ErrorJuego("Debes golpear con uno de tus personajes")
            self._comprobar_turno(t, False)
            if self.derrotado(t):
                raise ErrorJuego("Un personaje derrotado no puede actuar")
            if max(abs(t["x"] - x), abs(t["y"] - y)) > 1:
                raise ErrorJuego("Tienes que estar junto a la casilla para golpearla")
        return self.golpe(x, y, romper_ya)

    def rompible_en(self, x: int, y: int):
        """¿Qué se puede romper en esa casilla? → ("tile", tile) | ("objeto", índice) | None. Primero el tile; si no, un objeto destruible encima."""
        tile = self.tile_en(x, y)
        if tile and tile["rompible"]:
            return ("tile", tile)
        for i, o in enumerate(self.mapa["objetos"]):
            if o.get("destruible") and not self._roto(o) and (x, y) in recursos.celdas_de_objeto(o):
                return ("objeto", i)
        return None

    def golpe(self, x: int, y: int, romper_ya: bool = False) -> tuple[str, dict]:
        """Un golpe (o romperlo de golpe) a lo rompible de esa casilla, sin comprobar permisos. → (texto del chat, cambio para los clientes)."""
        que = self.rompible_en(x, y)
        if not que:
            raise ErrorJuego("Ahí no hay nada que se pueda romper")
        if que[0] == "objeto":
            i = que[1]
            o = self.mapa["objetos"][i]
            reg = self.objetos_golpeados.setdefault(self.mapa_id, {})
            huella = self.huella_objeto(o)
            golpes = reg.get(huella, 0) + 1
            if romper_ya or golpes >= o["destruible"]:
                reg[huella] = -1
                self._recalcular_bloqueos()
                texto = f"💥 {o['nombre']} se ha roto"
            else:
                reg[huella] = golpes
                texto = f"🔨 {o['nombre']} resiste ({golpes}/{o['destruible']})"
            self.guardar_estado()
            return texto, {"objetos": self.objetos_vivos()}
        tile = que[1]
        reg = self.cambios_casillas.setdefault(self.mapa_id, {})
        k = f"{x},{y}"
        golpes = 0 if romper_ya else reg.get(k, {}).get("golpes", 0) + 1
        if romper_ya or golpes >= tile["rompible"]["golpes"]:
            nuevo = tile["rompible"]["se_convierte_en"] or self.mapa["tile_base"]
            reg[k] = {"tile": nuevo, "golpes": 0}
            self._celdas[y][x] = nuevo
            texto = f"💥 {tile['nombre']} en ({x}, {y}) se ha roto"
        else:
            reg[k] = {**reg.get(k, {}), "golpes": golpes}
            texto = f"🔨 {tile['nombre']} en ({x}, {y}) resiste ({golpes}/{tile['rompible']['golpes']})"
        self.guardar_estado()
        return texto, {"x": x, "y": y, "tile": self._celdas[y][x], "golpes": reg[k]["golpes"]}

    def puede_pasar(self, x: int, y: int, lado: str) -> bool:
        """¿Se puede dar un paso desde (x, y) hacia ese lado? Ni la casilla de salida ni la de llegada deben cerrar ese borde
        (vallas, mostradores, acantilados…) y la de llegada debe poder pisarse."""
        dx, dy = recursos.LADOS[lado]
        nx, ny = x + dx, y + dy
        if not self.casilla_transitable(nx, ny):
            return False
        a, b = self.tile_en(x, y), self.tile_en(nx, ny)
        return not ((a and lado in a.get("bloquea_lados", ())) or (b and recursos.OPUESTO[lado] in b.get("bloquea_lados", ())))

    def hay_camino(self, desde: tuple[int, int], hasta: tuple[int, int]) -> bool:
        """¿Se puede llegar andando (sin atravesar muros ni lados cerrados)? Los tokens no cortan el paso; solo la casilla final debe estar libre."""
        if desde == hasta:
            return True
        vistos, cola = {desde}, [desde]
        while cola:
            x, y = cola.pop()
            for lado, (dx, dy) in recursos.LADOS.items():
                n = (x + dx, y + dy)
                if n in vistos or not self.puede_pasar(x, y, lado):
                    continue
                if n == hasta:
                    return True
                vistos.add(n)
                cola.append(n)
        return False

    def casilla_ocupada(self, x: int, y: int, ignorar: str | None = None) -> bool:
        return any(t["x"] == x and t["y"] == y and tid != ignorar for tid, t in self.tokens.items())

    def _casilla_libre_cerca(self, x: int, y: int) -> tuple[int, int]:
        m = self.mapa
        for radio in range(0, max(m["ancho"], m["alto"])):
            for dy in range(-radio, radio + 1):
                for dx in range(-radio, radio + 1):
                    if max(abs(dx), abs(dy)) != radio:
                        continue
                    cx, cy = x + dx, y + dy
                    if self.casilla_transitable(cx, cy) and not self.casilla_ocupada(cx, cy):
                        return cx, cy
        raise ErrorJuego("No hay casillas libres en el mapa")

    def cambiar_mapa(self, mapa_id: str) -> list[str]:
        """«Llevar a todos»: los personajes de los jugadores de todas las salas pasan a esta (junto al punto de inicio), que queda
        como sala principal. Los NPC se quedan en la sala donde el GM los dejó. Pasa a trabajar sobre esa sala. → ids de los tokens movidos."""
        if not isinstance(mapa_id, str) or mapa_id not in self.cat.mapas:
            raise ErrorJuego("Ese mapa no existe")
        movidos: list[dict] = []
        for m in list(self.salas):
            if m == mapa_id:
                continue
            with self.en_sala(m):
                pjs = [t for t in self.tokens.values() if t["tipo"] == "personaje"]
                if pjs:
                    self._sacar_de_sala(pjs)
                    self._limpiar_grupos()
                    movidos += pjs
        self.mapa_principal = mapa_id
        self.usar_sala(mapa_id)
        if movidos:
            self._limpiar_grupos(movidos)
            self._colocar_en_sala(movidos, mapa_id)
        self.guardar_estado()
        return [t["id"] for t in movidos]

    def fijar_capa(self, capa, visible) -> list[int]:
        """El GM muestra u oculta a todos una capa de detalle (2 = detalle, 3 = superior)."""
        if isinstance(capa, bool) or capa not in (2, 3) or not isinstance(visible, bool):
            raise ErrorJuego("Capa no válida")
        if visible and capa in self.capas_ocultas:
            self.capas_ocultas.remove(capa)
        elif not visible and capa not in self.capas_ocultas:
            self.capas_ocultas.append(capa)
        self.capas_ocultas.sort()
        return list(self.capas_ocultas)

    # ── Regla y dibujos temporales ───────────────────────────────
    def puntos_validos(self, puntos, maximo: int, entero: bool = False) -> list:
        """Lista de [x, y] dentro del mapa (en casillas). Lo que no cuadre se rechaza: este dato lo pone un cliente."""
        m = self.mapa
        if not isinstance(puntos, list) or not (1 <= len(puntos) <= maximo):
            raise ErrorJuego("Trazo no válido")
        res = []
        for p in puntos:
            if not (isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in p)):
                raise ErrorJuego("Trazo no válido")
            x, y = p
            if not (-1 <= x <= m["ancho"] + 1 and -1 <= y <= m["alto"] + 1) or x != x or y != y:
                raise ErrorJuego("Trazo fuera del mapa")
            res.append([int(x), int(y)] if entero else [round(float(x), 2), round(float(y), 2)])
        return res

    @staticmethod
    def grosor_valido(grosor) -> float:
        """El grosor del lápiz lo manda el cliente: se limita a un rango razonable (cualquier cosa rara = el de siempre)."""
        mn, mx, defecto = GROSOR_DIBUJO
        if isinstance(grosor, bool) or not isinstance(grosor, (int, float)) or grosor != grosor:
            return defecto
        return round(min(max(float(grosor), mn), mx), 1)

    def anadir_dibujo(self, usuario: str, es_gm: bool, color, puntos, grosor=None) -> dict:
        if not es_gm:
            if not self.cfg["permisos"]["dibujar"]:
                raise ErrorJuego("En esta mesa los jugadores no pueden dibujar")
            if self.dibujo_bloqueado:
                raise ErrorJuego("El GM ha bloqueado el dibujo")
        d = {"id": _id(), "usuario": usuario, "color": color if color in COLORES_DIBUJO else COLORES_DIBUJO[0],
             "grosor": self.grosor_valido(grosor), "puntos": self.puntos_validos(puntos, MAX_PUNTOS_TRAZO)}
        self.dibujos.append(d)
        del self.dibujos[:-MAX_TRAZOS]
        return d

    def borrar_dibujos(self, usuario: str, es_gm: bool, ids=None, de_usuario=None) -> list[str]:
        """Un jugador borra los suyos; el GM, cualquiera (por ids, de un usuario, o todos si no dice cuáles)."""
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids)):
            raise ErrorJuego("Datos no válidos")
        def sale(d):
            if not es_gm and d["usuario"] != usuario:
                return False
            if ids is not None:
                return d["id"] in ids
            return de_usuario is None or d["usuario"] == de_usuario
        borrados = [d["id"] for d in self.dibujos if sale(d)]
        self.dibujos = [d for d in self.dibujos if d["id"] not in borrados]
        return borrados

    def borrar_zona(self, usuario: str, es_gm: bool, centros, radio) -> tuple[list[str], list[dict]]:
        """El borrador: quita de los trazos solo lo que queda dentro de los círculos (uno por posición del borrador). Un jugador solo
        toca los suyos; el GM, todos. → (ids de los trazos que ya no existen, trazos nuevos con los trozos que quedaron)."""
        mn, mx = RADIO_BORRADOR
        if isinstance(radio, bool) or not isinstance(radio, (int, float)) or radio != radio or not (mn <= radio <= mx):
            raise ErrorJuego("Tamaño de borrador no válido")
        centros = self.puntos_validos(centros, MAX_CENTROS_BORRADOR)
        originales = {d["id"]: d for d in self.dibujos}
        vigentes = list(self.dibujos)
        for cx, cy in centros:
            siguiente = []
            for d in vigentes:
                if not es_gm and d["usuario"] != usuario:
                    siguiente.append(d)
                    continue
                trozos = recortar_trazo(d["puntos"], cx, cy, radio)
                if trozos is None:
                    siguiente.append(d)
                else:
                    siguiente += [{**d, "id": _id(), "puntos": t} for t in trozos]
            vigentes = siguiente
        del vigentes[:-MAX_TRAZOS]          # recortar puede multiplicar los trazos: se respeta el tope antes de avisar a nadie
        ids_vigentes = {d["id"] for d in vigentes}
        borrados = [i for i in originales if i not in ids_vigentes]
        nuevos = [d for d in vigentes if d["id"] not in originales]
        if borrados or nuevos:
            self.dibujos = vigentes
        return borrados, nuevos

    # ── Usuarios y personajes ────────────────────────────────────
    def registrar_usuario(self, usuario: str):
        if usuario not in self.personajes:
            self.personajes[usuario] = self._leer_jugador(usuario)

    def personajes_de(self, usuario: str) -> list[dict]:
        return self.personajes.get(usuario, [])

    def buscar_personaje(self, usuario: str, personaje_id: str) -> dict | None:
        return next((p for p in self.personajes_de(usuario) if p["id"] == personaje_id), None)

    def crear_personaje(self, usuario: str, es_gm: bool, base_id: str, nombre: str, historia: str = "",
                        elecciones: dict | None = None, reparto: dict | None = None,
                        imagen: str = "", imagen_biografia: str = "", campos=None) -> dict:
        """Crea un personaje del jugador. Una mascota, una criatura o una invocación es, simplemente, otro personaje suyo."""
        permisos = self.cfg["permisos"]
        if not permisos["crear_personajes"] and not es_gm:
            raise ErrorJuego("En este servidor los jugadores no pueden crear personajes")
        if len(self.personajes_de(usuario)) >= permisos["max_personajes_por_jugador"] and not es_gm:
            raise ErrorJuego(f"Solo puedes tener {permisos['max_personajes_por_jugador']} personajes")
        # Plantilla opcional (el cliente ya no las usa): sin ella, todo sale de las estadísticas y recursos globales y de las elecciones.
        base = self.cat.personajes.get(base_id) if base_id else {}
        if base_id and not base:
            raise ErrorJuego("Esa plantilla de personaje no existe")
        nombre = (nombre or "").strip()
        if not (1 <= len(nombre) <= 30):
            raise ErrorJuego("El nombre del personaje debe tener entre 1 y 30 caracteres")
        if any(p["nombre"].casefold() == nombre.casefold() for p in self.personajes_de(usuario)):
            raise ErrorJuego("Ya tienes un personaje con ese nombre")
        elegidas = self._validar_elecciones(base, elecciones, es_gm)
        stats = self.stats_iniciales(base, elegidas)
        puntos = self.cat.puntos_a_repartir(elegidas)
        if reparto:        # al crear, cada jugador reparte sus puntos; «editar_stats_jugador» solo manda sobre los puntos que se ganen después
            puntos -= self._aplicar_reparto(stats, reparto, puntos)
        habilidades = list(base.get("habilidades", []))
        for o in elegidas.values():
            for h in self.cat.opciones[o]["habilidades"]:
                if h not in habilidades:
                    habilidades.append(h)
        p = {
            "id": _id(), "nombre": nombre, "dueno": usuario, "base": base_id,
            "imagen": nombre_imagen(imagen) or base.get("imagen", ""), "imagen_biografia": nombre_imagen(imagen_biografia),
            "historia": (historia or "")[:MAX_HISTORIA],
            "elecciones": elegidas, "nivel": 1, "puntos_pendientes": puntos, "personalidad": [], "propias": {"habilidades": [], "objetos": []},
            "stats": stats,
            "recursos": self._recursos_nuevos({**self.cat.recursos_base(elegidas), **(base.get("recursos") or {})}),
            "habilidades": habilidades,
            "inventario": copy.deepcopy(base.get("inventario", [])),
            "dinero": base.get("dinero") or self.cfg["juego"]["moneda"]["inicial"],
            "sonidos": list(base.get("sonidos", [])),
        }
        # Si alguna opción elegida trae imagen de forma (una especie, la forma de lobo…), el token la usa desde el principio;
        # la imagen que eligió el jugador se guarda como la suya propia (para cuando vuelva a una forma sin imagen).
        forma = next((self.cat.opciones[o]["imagen_forma"] for o in elegidas.values() if self.cat.opciones[o].get("imagen_forma")), "")
        if forma:
            p["imagen_propia"] = p["imagen"]
            p["imagen"] = forma
        p["campos"] = self.campos_limpios(campos, {}, es_gm)
        self.personajes.setdefault(usuario, []).append(p)
        self.guardar_jugador(usuario)
        return p

    def _recursos_nuevos(self, maximos: dict) -> dict:
        """Recursos de alguien que acaba de aparecer: llenos, salvo los que la campaña marca «empieza vacío» (experiencia, furia…)."""
        vacios = {r["nombre"] for r in self.cfg["juego"]["recursos"] if r.get("empieza_vacio")}
        return {n: {"actual": 0 if n in vacios else mx, "max": mx} for n, mx in maximos.items()}

    def stats_iniciales(self, base: dict, elecciones: dict | None = None) -> dict:
        """Estadísticas con las que nace un personaje: las de la plantilla solo si la campaña lo pide; si no, las globales
        («para todos») más lo que aporten sus opciones (la clase puede añadir estadísticas o cambiar su valor inicial)."""
        if base and self.cfg["juego"]["stats_por_plantilla"]:
            return copy.deepcopy(base["stats"])
        return self.cat.stats_base(elecciones)

    def _validar_elecciones(self, base: dict, elecciones: dict | None, es_gm: bool = True) -> dict:
        """Una opción por grupo. Lo que no se elija se toma de la plantilla; los grupos obligatorios no pueden quedar vacíos."""
        if elecciones is not None and not isinstance(elecciones, dict):
            raise ErrorJuego("Las elecciones deben ser un conjunto de grupo → opción")
        if not self.cfg["juego"]["usar_grupos"]:
            return {}                      # la campaña no usa razas ni clases: se ignoran
        res = dict((base or {}).get("elecciones") or {})
        for g, o in (elecciones or {}).items():
            if g not in self.cat.grupos:
                raise ErrorJuego(f"El grupo «{g}» no existe")
            if o not in self.cat.opciones or self.cat.opciones[o]["grupo"] != g:
                raise ErrorJuego(f"La opción «{o}» no pertenece al grupo «{self.cat.grupos[g]['nombre']}»")
            if not es_gm and not self.cat.opciones[o].get("elegible", True):
                raise ErrorJuego(f"«{self.cat.opciones[o]['nombre']}» no se puede elegir al crear un personaje")
            res[g] = o
        for g in list(res):
            if not self.grupo_activo(g, res):
                raise ErrorJuego(f"«{self.cat.grupos[g]['nombre']}» no corresponde con lo que elegiste")
        for g, gd in self.cat.grupos.items():
            elegibles = [o for o in self.cat.opciones_de(g) if es_gm or self.cat.opciones[o].get("elegible", True)]
            if gd["obligatorio"] and g not in res and elegibles and self.grupo_activo(g, res):
                raise ErrorJuego(f"Debes elegir una opción de «{gd['nombre']}»")
        return res

    def grupo_activo(self, grupo: str, elecciones: dict, _n: int = 0) -> bool:
        """¿Este grupo de elección aplica a quien eligió `elecciones`? (solo_si: solo si en otro grupo eligió ciertas opciones)."""
        s = self.cat.grupos.get(grupo, {}).get("solo_si")
        if not s or _n > 10:
            return True
        return elecciones.get(s["grupo"]) in s["opciones"] and self.grupo_activo(s["grupo"], elecciones, _n + 1)

    def _aplicar_reparto(self, stats: dict, reparto: dict, disponibles: int) -> int:
        """Suma puntos a las estadísticas base (sin pasar de su máximo ni de los puntos disponibles). → puntos gastados."""
        if not isinstance(reparto, dict):
            raise ErrorJuego("El reparto debe indicar cuántos puntos va a cada estadística")
        definidas = {e["nombre"]: e for e in self.cfg["juego"]["estadisticas"]}
        gasto = 0
        nuevas = dict(stats)
        for k, n in reparto.items():
            if k not in definidas:
                raise ErrorJuego(f"La estadística «{k}» no existe")
            if k not in stats:
                raise ErrorJuego(f"Este personaje no tiene la estadística «{k}»")
            if not definidas[k].get("repartible", True):
                if n:
                    raise ErrorJuego(f"«{k}» no recibe puntos: cambia durante la partida (efectos o el GM)")
                continue
            if isinstance(n, bool) or not isinstance(n, int) or n < 0:
                raise ErrorJuego(f"Los puntos de «{k}» deben ser un entero mayor o igual que 0")
            if nuevas[k] + n > definidas[k]["maximo"]:
                raise ErrorJuego(f"«{k}» no puede superar {definidas[k]['maximo']}")
            nuevas[k] += n
            gasto += n
        if gasto > disponibles:
            raise ErrorJuego(f"Solo tienes {disponibles} puntos para repartir")
        stats.update(nuevas)
        return gasto

    def repartir_puntos(self, usuario: str, personaje_id: str, reparto: dict, es_gm: bool) -> dict:
        """Gasta puntos pendientes de un personaje. El dueño solo puede si la campaña lo permite (editar_stats_jugador)."""
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if not (es_gm or self.cfg["permisos"]["editar_stats_jugador"]):
            raise ErrorJuego("En este servidor solo el GM reparte los puntos de estadística")
        gasto = self._aplicar_reparto(p["stats"], reparto, p.get("puntos_pendientes", 0))
        p["puntos_pendientes"] = p.get("puntos_pendientes", 0) - gasto
        self.guardar_jugador(usuario)
        return p

    def editar_personalidad(self, usuario: str, personaje_id: str, rasgos, es_gm: bool) -> dict:
        """Rasgos de personalidad (Maldito, Maniático…): los escribe el jugador si el GM lo permite."""
        if not (es_gm or self.cfg["permisos"]["rasgos_personalidad"]):
            raise ErrorJuego("En este servidor solo el GM puede cambiar los rasgos de personalidad")
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if not isinstance(rasgos, list) or len(rasgos) > 8:
            raise ErrorJuego("Puedes tener hasta 8 rasgos de personalidad")
        limpios: list[str] = []
        for r in rasgos:
            if not isinstance(r, str) or not (1 <= len(r.strip()) <= 30):
                raise ErrorJuego("Cada rasgo debe tener entre 1 y 30 caracteres")
            if r.strip().casefold() not in (x.casefold() for x in limpios):
                limpios.append(r.strip())
        p["personalidad"] = limpios
        self.guardar_jugador(usuario)
        return p

    def campos_limpios(self, crudo, previos: dict | None, es_gm: bool, estricto: bool = True) -> dict:
        """Valores de los campos propios de la ficha (los define la campaña). El jugador no puede tocar los que son «del GM»."""
        defs = {c["nombre"]: c for c in self.cfg["juego"]["campos_ficha"]}
        res = {k: v for k, v in (previos or {}).items() if k in defs}
        if crudo is None:
            return res
        if not isinstance(crudo, dict) or len(crudo) > 40:
            if estricto:
                raise ErrorJuego("Datos de la ficha no válidos")
            return res
        for k, val in crudo.items():
            c = defs.get(k)
            if not c:
                if estricto:
                    raise ErrorJuego(f"La ficha no tiene el campo «{k}»")
                continue
            if c["quien"] == "gm" and not es_gm:
                if estricto and val != res.get(k):
                    raise ErrorJuego(f"«{k}» solo lo puede cambiar el GM")
                continue
            try:
                limpio = recursos.valor_campo(c, val)
            except ValueError as e:
                if estricto:
                    raise ErrorJuego(str(e)) from None
                continue
            if limpio is None:
                res.pop(k, None)
            else:
                res[k] = limpio
        return res

    def editar_campos(self, usuario: str, personaje_id: str, campos, es_gm: bool) -> dict:
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        p["campos"] = self.campos_limpios(campos, p.get("campos"), es_gm)
        self.guardar_jugador(usuario)
        return p

    def editar_propias(self, usuario: str, personaje_id: str, tipo, lista, es_gm: bool) -> dict:
        """Habilidades u objetos que el jugador anota él mismo: solo texto, sin efecto en el juego (el GM decide qué significan)."""
        if tipo not in ("habilidades", "objetos"):
            raise ErrorJuego("Tipo no válido")
        if not (es_gm or self.cfg["permisos"][f"{tipo}_propias" if tipo == "habilidades" else "objetos_propios"]):
            raise ErrorJuego("En este servidor solo el GM puede anotar eso")
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if not isinstance(lista, list) or len(lista) > LIMITE_PROPIAS:
            raise ErrorJuego(f"Puedes anotar hasta {LIMITE_PROPIAS}")
        limpia = normalizar_propias({tipo: lista}, estricto=True)[tipo]
        p.setdefault("propias", {"habilidades": [], "objetos": []})[tipo] = limpia
        self.guardar_jugador(usuario)
        return p

    def dar_puntos(self, token_id: str, cantidad: int) -> str:
        """Acción de GM: entrega (o quita) puntos de estadística pendientes (p. ej. al subir de nivel)."""
        t = self._token(token_id)
        if t["tipo"] != "personaje":
            raise ErrorJuego("Solo los personajes de jugadores tienen puntos pendientes")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 1000:
            raise ErrorJuego("La cantidad debe ser un entero distinto de 0")
        p = self.datos_de(t)
        p["puntos_pendientes"] = max(0, p.get("puntos_pendientes", 0) + cantidad)
        self.guardar_jugador(t["dueno"])
        self._marcar(t)
        return p["nombre"]

    def todos_los_personajes(self) -> list[dict]:
        """Resumen de los personajes de TODOS los usuarios (también de quienes no están conectados). Para el GM."""
        usuarios = set(self.personajes)
        carpeta = self.datos_dir / "jugadores"
        if carpeta.is_dir():
            for ruta in carpeta.glob("*.yaml"):
                try:
                    with open(ruta, "r", encoding="utf-8") as f:
                        u = (yaml.safe_load(f) or {}).get("usuario")
                except (OSError, yaml.YAMLError):
                    continue
                if isinstance(u, str):
                    usuarios.add(u)
        res = []
        for u in sorted(usuarios, key=str.casefold):
            self.registrar_usuario(u)
            for p in self.personajes_de(u):
                res.append({"usuario": u, "id": p["id"], "nombre": p["nombre"], "imagen": p.get("imagen", ""),
                            "desplegado": self.token_de_personaje(u, p["id"]) is not None, "sala": self.sala_de_personaje(u, p["id"]),
                            "nivel": p.get("nivel", 1)})
        return res

    def token_de_personaje(self, usuario: str, personaje_id: str) -> dict | None:
        """El token de ese personaje, esté en la sala que esté (un personaje solo puede estar en una a la vez)."""
        return next((t for _, t in self.todos_los_tokens()
                     if t["tipo"] == "personaje" and t["dueno"] == usuario and t["personaje_id"] == personaje_id), None)

    def sala_de_personaje(self, usuario: str, personaje_id: str) -> str | None:
        t = self.token_de_personaje(usuario, personaje_id)
        return self.sala_de_token(t["id"]) if t else None

    def desplegar_personaje(self, usuario: str, personaje_id: str, solicitante: str, es_gm: bool,
                            x: int | None = None, y: int | None = None) -> tuple[dict, bool]:
        """Pone un personaje en el mapa: en el punto de inicio o en la casilla elegida. El GM despliega a cualquiera donde quiera;
        el dueño puede elegir casilla si la mesa lo permite, fuera de combate y (con niebla) solo donde ve."""
        if usuario != solicitante and not es_gm:
            raise ErrorJuego("Solo puedes desplegar tus propios personajes")
        self.registrar_usuario(usuario)
        if not self.buscar_personaje(usuario, personaje_id):
            raise ErrorJuego("Ese personaje no existe")
        existente = self.token_de_personaje(usuario, personaje_id)
        if existente:
            return existente, False
        if x is not None or y is not None:
            if not es_gm:
                if not self.cfg["permisos"]["desplegar_en_casilla"]:
                    raise ErrorJuego("Solo el GM puede elegir la casilla")
                if self.combate["activo"]:
                    raise ErrorJuego("Durante un combate solo el GM puede elegir dónde aparece un personaje")
                if self.niebla_activa() and (x, y) not in self.visibles_para(usuario):
                    raise ErrorJuego("Con niebla de guerra solo puedes desplegar donde ves")
            if not isinstance(x, int) or not isinstance(y, int) or not self.casilla_transitable(x, y):
                raise ErrorJuego("No se puede colocar ahí: casilla bloqueada o fuera del mapa")
            if self.casilla_ocupada(x, y):
                raise ErrorJuego("Esa casilla ya está ocupada")
        else:
            ini = self.mapa["inicio"]
            x, y = self._casilla_libre_cerca(ini["x"], ini["y"])
        t = {"id": _id(), "tipo": "personaje", "dueno": usuario, "personaje_id": personaje_id, "x": x, "y": y}
        self.tokens[t["id"]] = t
        self.guardar_estado()
        return t, True

    def _traspasar_personaje(self, token: dict, nuevo: str):
        """El GM da un personaje (su ficha y su token) a otro usuario: pasa de la lista del dueño anterior a la del nuevo."""
        viejo = token["dueno"]
        p = self.buscar_personaje(viejo, token["personaje_id"])
        if p is None:
            raise ErrorJuego("El personaje de este token ya no existe")
        self.registrar_usuario(nuevo)
        self.personajes[viejo] = [x for x in self.personajes_de(viejo) if x is not p]
        if any(x["id"] == p["id"] for x in self.personajes_de(nuevo)):
            p["id"] = _id()
        self.personajes[nuevo].append(p)
        token["dueno"], token["personaje_id"] = nuevo, p["id"]
        self._cache_vision.clear()
        self.guardar_jugador(viejo)
        self.guardar_jugador(nuevo)
        self.guardar_estado()

    def retirar_personaje(self, token_id: str, solicitante: str, es_gm: bool) -> str:
        """Quita del mapa el token de un personaje SIN borrar al personaje. El dueño solo puede hacerlo fuera de combate."""
        t = self._token(token_id)
        if t["tipo"] != "personaje":
            raise ErrorJuego("Eso no es un personaje")
        if not es_gm:
            if t["dueno"] != solicitante:
                raise ErrorJuego("Solo puedes retirar tus propios personajes")
            if self.combate["activo"]:
                raise ErrorJuego("No puedes retirarte durante un combate")
        nombre = self.nombre_de(t)
        self.quitar_token(token_id)
        return nombre

    # ── Tokens ───────────────────────────────────────────────────
    def datos_de(self, token: dict) -> dict:
        """Dict que contiene stats/recursos/habilidades/inventario del token."""
        if token["tipo"] == "personaje":
            p = self.buscar_personaje(token["dueno"], token["personaje_id"])
            if p is None:
                raise ErrorJuego("El personaje de este token ya no existe")
            return p
        return token

    def nombre_de(self, token: dict) -> str:
        return self.datos_de(token)["nombre"]

    def stats_planas(self, token: dict) -> dict:
        """Estadísticas + valor actual de recursos, para usar en fórmulas."""
        d = self.datos_de(token)
        planas = {n: 0 for n in self.cat.nombres_stats() + self.cat.nombres_recursos()}   # lo que no tenga cuenta como 0
        planas.update(self.stats_efectivas(token))
        planas.update({n: r["actual"] for n, r in d["recursos"].items()})
        planas[recursos.CARGAS] = 1                                 # fuera de un estado acumulado, [Cargas] vale 1
        if self.cfg["juego"]["niveles"]["activo"]:
            planas[recursos.NIVEL] = self.nivel_de(token)
        for s in self.cfg["juego"]["estadisticas"]:                # [Rango Valentía]: el rango que le toca a esa estadística por su valor
            if s.get("escalones"):
                planas[f"{recursos.RANGO} {s['nombre']}"] = rango_de(s["escalones"], planas.get(s["nombre"], 0))
        return planas

    def derrotado(self, token: dict) -> bool:
        return self.datos_de(token)["recursos"][self.cat.recurso_vida()]["actual"] <= 0

    def colocar_personaje(self, usuario: str, personaje_id: str) -> tuple[dict, bool]:
        """Pone el token del personaje en el mapa (si ya estaba, lo reutiliza). → (token, es_nuevo)"""
        return self.desplegar_personaje(usuario, personaje_id, usuario, False)

    def colocar_enemigo(self, enemigo_id: str, x: int, y: int) -> dict:
        """Coloca un NPC (aliado, neutral o enemigo, según su ficha). `tipo: "enemigo"` es el nombre interno de «no jugador»."""
        base = self.cat.enemigos.get(enemigo_id)
        if not base:
            raise ErrorJuego("Ese NPC no existe")
        if not self.casilla_transitable(x, y):
            raise ErrorJuego("No se puede colocar ahí: casilla bloqueada o fuera del mapa")
        if self.casilla_ocupada(x, y):
            raise ErrorJuego("Esa casilla ya está ocupada")
        nombre = base["nombre"]
        repetidos = sum(1 for t in self.tokens.values() if t["tipo"] == "enemigo" and t["base"] == enemigo_id)
        if repetidos:
            nombre = f"{nombre} {repetidos + 1}"
        t = {
            "id": _id(), "tipo": "enemigo", "dueno": None, "base": enemigo_id, "x": x, "y": y, "bando": base["bando"],
            "nombre": nombre, "imagen": base["imagen"], "estados": [],
            "elecciones": dict(base.get("elecciones") or {}),
            "stats": copy.deepcopy(base["stats"]),
            "recursos": self._recursos_nuevos(base["recursos"]),
            "habilidades": list(base["habilidades"]),
            "inventario": copy.deepcopy(base["inventario"]),
            "dinero": base.get("dinero", 0),
            "sonidos": list(base.get("sonidos", [])),
        }
        self.tokens[t["id"]] = t
        self.guardar_estado()
        return t

    def quitar_token(self, token_id: str) -> None:
        t = self._token(token_id)
        resto = [o for o in self.tokens_del_grupo(t) if o is not t]
        if len(resto) == 1:
            resto[0].pop("grupo", None)          # un grupo de uno ya no es un grupo
        self.tokens.pop(token_id)
        if self.combate["activo"] or self.combate.get("preparando"):
            self._retirar_del_combate(t["id"])
        self.guardar_estado()

    def editar_token(self, token_id: str, nombre=None, stats=None, recursos=None, bando=None, dar_experiencia=None, cede=None,
                    controlado_por=False, usuarios_validos=(), dueno=False, usuarios_dueno=None) -> str:
        """Acción de GM: cambia nombre, estadísticas o recursos (actual/máximo) de cualquier token; da experiencia a un personaje (`dar_experiencia`:
        {tipo: cantidad que se SUMA}) o fija cuánta cede un NPC al caer (`cede`: {tipo: cantidad})."""
        t = self._token(token_id)
        d = self.datos_de(t)
        cambios = []
        if nombre is not None:
            if not isinstance(nombre, str) or not nombre.strip():
                raise ErrorJuego("El nombre no puede estar vacío")
            nombre = nombre.strip()[:60]
        definidas = {e["nombre"]: e for e in self.cat.config["juego"]["estadisticas"]}
        nuevas_stats = {}
        for k, val in (stats or {}).items():
            if k not in definidas:
                raise ErrorJuego(f"La estadística «{k}» no existe")
            if isinstance(val, bool) or not isinstance(val, int):
                raise ErrorJuego(f"«{k}» debe ser un número entero")
            e = definidas[k]
            if not (e["minimo"] <= val <= e["maximo"]):
                raise ErrorJuego(f"«{k}» debe estar entre {e['minimo']} y {e['maximo']}")
            nuevas_stats[k] = val
        vida = self.cat.recurso_vida()
        nuevos_rec = {}
        for k, val in (recursos or {}).items():
            if k not in d["recursos"]:
                raise ErrorJuego(f"El recurso «{k}» no existe")
            if not isinstance(val, dict):
                raise ErrorJuego(f"«{k}» debe indicar actual y máximo")
            r = d["recursos"][k]
            mx, ac = val.get("max", r["max"]), val.get("actual", r["actual"])
            if any(isinstance(n, bool) or not isinstance(n, int) for n in (mx, ac)):
                raise ErrorJuego(f"«{k}»: actual y máximo deben ser números enteros")
            if mx < (1 if k == vida else 0):
                raise ErrorJuego(f"El máximo de «{k}» no puede ser {mx}")
            if mx != r["max"] and t["tipo"] == "personaje" and any(x["nombre"] == k and x.get("maximo_formula") for x in self.cat.config["juego"]["recursos"]):
                raise ErrorJuego(f"El máximo de «{k}» lo calcula su fórmula (Reglas → Estadísticas y recursos): cambia el valor actual o las estadísticas")
            if not (0 <= ac <= mx):
                raise ErrorJuego(f"El valor actual de «{k}» debe estar entre 0 y {mx}")
            nuevos_rec[k] = {"actual": ac, "max": mx}
        if bando is not None:
            if bando not in ("aliado", "neutral", "enemigo") or t["tipo"] == "personaje":
                raise ErrorJuego("El bando solo se puede cambiar a un NPC (aliado, neutral o enemigo)")
        niv = self.cfg["juego"]["niveles"]
        dar = {}
        if dar_experiencia:
            if not niv["activo"]:
                raise ErrorJuego("Esta campaña no usa niveles ni experiencia")
            if t["tipo"] != "personaje":
                raise ErrorJuego("Solo los personajes ganan experiencia")
            dar = self._cantidades_exp(dar_experiencia, niv, permitir_negativas=True)
        fija = None
        if cede is not None:
            if t["tipo"] != "enemigo":
                raise ErrorJuego("Solo un NPC puede ceder experiencia")
            fija = self._cantidades_exp(cede, niv, permitir_negativas=False, permitir_cero=True)
        if controlado_por is not False:            # False = no se toca; None o "" = solo el GM; texto = ese jugador
            if t["tipo"] != "enemigo":
                raise ErrorJuego("Solo se puede dar el control de un NPC")
            if not self.npc_asignables():
                raise ErrorJuego("En esta mesa los NPC solo los controla el GM (Editor → Reglas → Funciones de la mesa)")
            if controlado_por and controlado_por not in usuarios_validos:
                raise ErrorJuego(f"No hay ningún jugador llamado «{controlado_por}»")
            controlado_por = controlado_por or None
        if dueno is not False:                     # False = no se toca; texto = el personaje pasa a ser de ese usuario
            if t["tipo"] != "personaje":
                raise ErrorJuego("Solo se puede cambiar de dueño a un personaje (a un NPC se le da el control)")
            if not self.cfg["permisos"].get("sin_ficha"):
                raise ErrorJuego("Para asignar personajes a otros usuarios, activa «Los jugadores pueden entrar sin ficha» (Editor → Reglas → Creación de personajes)")
            if not isinstance(dueno, str) or not dueno.strip():
                raise ErrorJuego("Elige a qué usuario pasa el personaje")
            buscado = dueno.strip()
            dueno = next((u for u in (usuarios_validos if usuarios_dueno is None else usuarios_dueno) if u.casefold() == buscado.casefold()), None)
            if dueno is None:
                raise ErrorJuego(f"No hay ningún usuario llamado «{buscado[:30]}»")
            if dueno != t["dueno"]:
                self.registrar_usuario(dueno)
                nombre_final = nombre if nombre is not None else d["nombre"]
                if any(p["nombre"].casefold() == nombre_final.casefold() for p in self.personajes_de(dueno)):
                    raise ErrorJuego(f"{dueno} ya tiene un personaje llamado «{nombre_final}»")
        # Todo validado: ahora se aplica.
        if dueno is not False and dueno != t["dueno"]:
            cambios.append(f"ahora es de {dueno}")
            self._traspasar_personaje(t, dueno)
        if controlado_por is not False and controlado_por != t.get("controlado_por"):
            cambios.append(f"controlado por → {controlado_por or 'solo el GM'}")
            if controlado_por:
                t["controlado_por"] = controlado_por
            else:
                t.pop("controlado_por", None)
            self._cache_vision.clear()
        if bando is not None and bando != self.bando_de(t):
            cambios.append(f"bando → {bando}")
            t["bando"] = bando
        if nombre is not None and nombre != d["nombre"]:
            cambios.append(f"nombre → {nombre}")
            d["nombre"] = nombre
        for k, val in nuevas_stats.items():
            if d["stats"].get(k) != val:
                cambios.append(f"{k} {d['stats'].get(k)} → {val}")
                d["stats"][k] = val
        for k, val in nuevos_rec.items():
            if d["recursos"][k] != val:
                cambios.append(f"{k} {d['recursos'][k]['actual']}/{d['recursos'][k]['max']} → {val['actual']}/{val['max']}")
                d["recursos"][k] = val
        if dar:
            cambios.append(f"experiencia {self._sumar_experiencia(t, dar) or '(sin cambios: ya en el máximo)'}")
        if fija is not None and fija != self.experiencia_que_cede(t):
            t["experiencia"] = fija
            cambios.append("experiencia que cede → " + (", ".join(f"{k} {c}" for k, c in fija.items()) or "ninguna"))
        self._guardar_afectados(t)
        if nuevas_stats:
            self.revisar_nivel(t)
        return "; ".join(cambios)

    def gm_estado(self, token_id: str, estado_id, poner) -> str:
        """Acción de GM en plena partida: pone (con su duración) o quita un estado a cualquier token. → texto para el chat."""
        t = self._token(token_id)
        if not isinstance(estado_id, str) or estado_id not in self.cat.estados or not isinstance(poner, bool):
            raise ErrorJuego("Ese estado no existe")
        est = self.cat.estados[estado_id]
        lista = t.setdefault("estados", [])
        ya = next((e for e in lista if e["id"] == estado_id), None)
        nombre = self.datos_de(t)["nombre"]
        if poner:
            puesto = self.poner_estado(t, estado_id) or est["nombre"]
            txt = f"🌀 El GM pone «{puesto}» a {nombre}"
        else:
            if not ya:
                raise ErrorJuego(f"{nombre} no tiene «{est['nombre']}»")
            self.quitar_estado_de(t, estado_id, "se_quita")
            txt = f"🌀 El GM quita «{est['nombre']}» a {nombre}"
        self._marcar(t)
        self.guardar_estado()
        return txt

    def gm_habilidad(self, token_id: str, habilidad_id, poner) -> tuple[str, dict]:
        """Acción de GM en plena partida: da (`poner`) o quita una habilidad a cualquier token. En un personaje cambia su ficha;
        en un NPC, solo ese token (la ficha del NPC en la campaña no cambia). → (texto para el chat, token)."""
        t = self._token(token_id)
        if not isinstance(habilidad_id, str) or habilidad_id not in self.cat.habilidades or not isinstance(poner, bool):
            raise ErrorJuego("Esa habilidad no existe")
        d = self.datos_de(t)
        lista = d.setdefault("habilidades", [])
        nombre_h = self.cat.habilidades[habilidad_id]["nombre"]
        if poner:
            if habilidad_id in lista:
                raise ErrorJuego(f"{d['nombre']} ya tiene «{nombre_h}»")
            lista.append(habilidad_id)
            txt = f"✨ El GM da «{nombre_h}» a {d['nombre']}"
        else:
            if habilidad_id not in lista:
                raise ErrorJuego(f"{d['nombre']} no tiene «{nombre_h}»")
            lista.remove(habilidad_id)
            txt = f"✨ El GM quita «{nombre_h}» a {d['nombre']}"
        self._guardar_afectados(t)
        return txt, t

    @staticmethod
    def _cantidades_exp(crudo, niv: dict, permitir_negativas: bool, permitir_cero: bool = False) -> dict:
        """Valida {tipo de experiencia: cantidad entera} que llega del cliente."""
        if not isinstance(crudo, dict):
            raise ErrorJuego("La experiencia debe indicar tipo y cantidad")
        res = {}
        for k, c in crudo.items():
            if k not in niv["experiencia"]:
                raise ErrorJuego(f"«{k}» no es un tipo de experiencia de esta campaña")
            if isinstance(c, bool) or not isinstance(c, int) or abs(c) > 1_000_000 or (c < 0 and not permitir_negativas):
                raise ErrorJuego(f"La experiencia de «{k}» debe ser un número entero{'' if permitir_negativas else ' sin signo'} (máximo 1000000)")
            if c != 0 or permitir_cero:
                res[k] = c
        return res

    def cambiar_objeto(self, token_id: str, objeto_id: str, cantidad: int) -> str:
        """Acción de GM: da (cantidad > 0) o quita (cantidad < 0) objetos del inventario de un token."""
        t = self._token(token_id)
        if objeto_id not in self.cat.objetos:
            raise ErrorJuego("Ese objeto no existe")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 999:
            raise ErrorJuego("La cantidad debe ser un entero distinto de 0 (máximo 999)")
        d = self.datos_de(t)
        entrada = next((e for e in d["inventario"] if e["objeto"] == objeto_id), None)
        if entrada is None:
            if cantidad < 0:
                raise ErrorJuego("Ese token no tiene ese objeto")
            d["inventario"].append({"objeto": objeto_id, "cantidad": cantidad})
        else:
            entrada["cantidad"] += cantidad
            if entrada["cantidad"] <= 0:
                d["inventario"].remove(entrada)
        self._guardar_afectados(t)
        return self.cat.objetos[objeto_id]["nombre"]

    def cambiar_dinero(self, token_id: str, cantidad: int) -> int:
        """Acción de GM: da (cantidad > 0) o quita (cantidad < 0) dinero a un token. No baja de 0. Devuelve lo que ya tiene."""
        t = self._token(token_id)
        if not self.cfg["juego"]["moneda"]["activa"]:
            raise ErrorJuego("Esta campaña no usa dinero")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 10 ** 9:
            raise ErrorJuego("La cantidad debe ser un entero distinto de 0")
        d = self.datos_de(t)
        d["dinero"] = max(0, min(10 ** 9, d.get("dinero", 0) + cantidad))
        self._guardar_afectados(t)
        return d["dinero"]

    def cambiar_periodo(self, indice) -> dict:
        c = self.cfg["juego"]["ciclo"]
        if not c["activo"]:
            raise ErrorJuego("Esta campaña no usa día y noche")
        if isinstance(indice, bool) or not isinstance(indice, int) or not 0 <= indice < len(c["periodos"]):
            raise ErrorJuego("Ese momento del día no existe")
        self.periodo = indice
        for m in list(self.salas):                     # «Al cambiar el momento del día» (en todas las salas): hambre, cansancio, licantropía…
            with self.en_sala(m):
                for t in list(self.tokens.values()):
                    if t.get("x", -1) >= 0:
                        self.disparar("al_cambiar_momento", t)
        self.guardar_estado()
        return c["periodos"][indice]

    def cambiar_clima(self, indice) -> dict:
        c = self.cfg["juego"]["clima"]
        if not c["activo"]:
            raise ErrorJuego("Esta campaña no usa clima")
        if isinstance(indice, bool) or not isinstance(indice, int) or not 0 <= indice < len(c["tipos"]):
            raise ErrorJuego("Ese clima no existe")
        self.clima = indice
        for m in list(self.salas):                     # «Al cambiar el clima» (en todas las salas)
            with self.en_sala(m):
                for t in list(self.tokens.values()):
                    if t.get("x", -1) >= 0:
                        self.disparar("al_cambiar_clima", t)
        self.guardar_estado()
        return c["tipos"][indice]

    def _token(self, token_id) -> dict:
        t = self.tokens.get(token_id)
        if not t:
            raise ErrorJuego("Ese token no existe")
        return t

    def controla(self, token: dict, usuario: str) -> bool:
        """¿Este jugador maneja el token? Su personaje, o un NPC que el GM le ha dado (`controlado_por`, si la mesa lo permite)."""
        if token["tipo"] == "personaje":
            return token["dueno"] == usuario
        return bool(usuario) and self.npc_asignables() and token.get("controlado_por") == usuario

    def npc_asignables(self) -> bool:
        """¿El GM puede dar NPC a los jugadores? Con «dar NPC a los jugadores» o con «entrar sin ficha» (que lo incluye)."""
        p = self.cfg["permisos"]
        return bool(p["npc_para_jugadores"] or p.get("sin_ficha"))

    def puede_controlar(self, token: dict, usuario: str, es_gm: bool) -> bool:
        return es_gm or self.controla(token, usuario)

    def _comprobar_turno(self, token: dict, es_gm: bool):
        if (self.combate["activo"] and not es_gm
                and self.cfg["permisos"]["acciones_solo_en_su_turno"]
                and token["id"] != self.token_en_turno()):
            raise ErrorJuego("No es el turno de ese personaje")

    def mover_token(self, token_id: str, x: int, y: int, usuario: str, es_gm: bool) -> dict:
        t = self._token(token_id)
        propio = self.puede_controlar(t, usuario, es_gm)
        if not propio and not (self.cfg["permisos"]["mover_tokens_ajenos"] and t["tipo"] == "personaje"):
            raise ErrorJuego("No puedes mover ese token")
        if propio:
            self._comprobar_turno(t, es_gm)
        elif self.combate["activo"] and not es_gm:
            raise ErrorJuego("No puedes mover tokens ajenos durante el combate")
        if not self.casilla_transitable(x, y):
            raise ErrorJuego("No se puede ir ahí: casilla bloqueada o fuera del mapa")
        impide = None if es_gm else self.impedido(t, "mover")
        if impide:
            raise ErrorJuego(f"«{impide}» no le deja moverse")
        # Fuera de combate, todo el grupo se mueve a la vez, lo mueva quien lo mueva (los que no puedan, se quedan donde están).
        acompanan = [] if self.combate["activo"] else [o for o in self.tokens_del_grupo(t) if o is not t and not self.impedido(o, "mover")]
        if any(o["x"] == x and o["y"] == y for o in self.tokens.values() if o is not t and o not in acompanan):
            raise ErrorJuego("Esa casilla ya está ocupada")
        if not es_gm and t.get("x", -1) >= 0 and not self.hay_camino((t["x"], t["y"]), (x, y)):
            raise ErrorJuego("No hay camino hasta ahí: hay muros o lados cerrados en medio")
        if not es_gm:
            self.intentar(t, {"mover"})                 # «Al intentar: moverse» (hemorragia, raíces que lo impiden a veces…)
        quedan = None if es_gm else self.movimiento_restante(t)
        if quedan is not None:
            pasos = self.pasos_hasta((t["x"], t["y"]), (x, y), quedan)
            if pasos is None:
                raise ErrorJuego(f"No llegas: te {'queda' if quedan == 1 else 'quedan'} {quedan} {'casilla' if quedan == 1 else 'casillas'} de movimiento en este turno")
            self.combate["movido"][t["id"]] = self.combate["movido"].get(t["id"], 0) + pasos
        dx, dy = x - t["x"], y - t["y"]
        del_grupo = {o["id"] for o in acompanan} | {t["id"]}
        ajenas = {(o["x"], o["y"]) for o in self.tokens.values() if o["id"] not in del_grupo}
        van = {o["id"]: (o["x"] + dx, o["y"] + dy) for o in acompanan
               if self.casilla_transitable(o["x"] + dx, o["y"] + dy) and (o["x"] + dx, o["y"] + dy) not in ajenas
               and (es_gm or self.hay_camino((o["x"], o["y"]), (o["x"] + dx, o["y"] + dy)))}
        while True:                            # quien no puede moverse se queda: nadie del grupo puede acabar en su casilla
            quietas = {(o["x"], o["y"]) for o in acompanan if o["id"] not in van}
            fuera = [i for i, dest in van.items() if dest in quietas]
            if not fuera:
                break
            for i in fuera:
                del van[i]
        if (x, y) in {(o["x"], o["y"]) for o in acompanan if o["id"] not in van}:
            raise ErrorJuego("Esa casilla ya está ocupada")
        t["x"], t["y"] = x, y
        movidos = [t]
        for o in acompanan:
            if o["id"] in van:
                o["x"], o["y"] = van[o["id"]]
                movidos.append(o)
        for m in movidos:
            self.disparar("al_entrar", m)       # lo que haga ese tile (daño, estados…) queda en las colas
        self.guardar_estado()
        self.ultimos_movidos = [m["id"] for m in movidos]
        return t

    # ── Tamaño y grupos de tokens (como en Roll20: solo cambia cómo se ven y cómo se mueven) ──
    ESCALAS = (0.5, 0.75, 1, 1.5, 2, 3)
    MAX_GRUPO = 12

    def tokens_del_grupo(self, t: dict) -> list[dict]:
        g = t.get("grupo")
        return [o for o in self.tokens.values() if g and o.get("grupo") == g] if g else [t]

    def escalar_token(self, token_id: str, escala, usuario: str, es_gm: bool) -> dict:
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("Solo puedes cambiar el tamaño de tus propios tokens")
        if isinstance(escala, bool) or escala not in self.ESCALAS:
            raise ErrorJuego("Tamaño no válido")
        if escala == 1:
            t.pop("escala", None)
        else:
            t["escala"] = escala
        self.guardar_estado()
        return t

    def agrupar_tokens(self, ids, usuario: str, es_gm: bool) -> list[str]:
        """Junta varios tokens (y los grupos en los que ya estuvieran) en uno solo: al mover uno, se mueven todos."""
        if not isinstance(ids, list) or not 2 <= len(ids) <= self.MAX_GRUPO or not all(isinstance(i, str) for i in ids):
            raise ErrorJuego(f"Elige entre 2 y {self.MAX_GRUPO} tokens para agrupar")
        tokens = {self._token(i)["id"]: self.tokens[i] for i in ids}
        for t in list(tokens.values()):
            for o in self.tokens_del_grupo(t):
                tokens[o["id"]] = o
        if len(tokens) > self.MAX_GRUPO:
            raise ErrorJuego(f"Un grupo puede tener como mucho {self.MAX_GRUPO} tokens")
        if not all(self.puede_controlar(t, usuario, es_gm) for t in tokens.values()):
            raise ErrorJuego("Solo puedes agrupar tokens que controlas")
        g = _id()
        for t in tokens.values():
            t["grupo"] = g
        self.guardar_estado()
        return list(tokens)

    def desagrupar_token(self, token_id: str, usuario: str, es_gm: bool) -> list[str]:
        """Saca un token de su grupo (si el grupo se queda con uno solo, desaparece). → tokens que cambiaron."""
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("Solo puedes desagrupar tus propios tokens")
        resto = [o for o in self.tokens_del_grupo(t) if o is not t]
        t.pop("grupo", None)
        if len(resto) == 1:
            resto[0].pop("grupo", None)
        self.guardar_estado()
        return [t["id"], *([resto[0]["id"]] if len(resto) == 1 else [])]

    # ── Transformación: cambiar de opción en un grupo de «formas» o de «evolución» ──
    def formas_posibles(self, token: dict, grupo: str, es_gm: bool) -> list[str]:
        """A qué opciones de ese grupo puede pasar ahora: en «formas», a cualquiera; en «evolución», a las que indica la actual (el GM, a cualquiera)."""
        g = self.cat.grupos.get(grupo)
        if not g or g["transformacion"] == "no":
            return []
        actual = (self.datos_de(token).get("elecciones") or {}).get(grupo)
        todas = [o for o in self.cat.opciones_de(grupo) if o != actual]
        if es_gm or g["transformacion"] == "formas":
            return todas
        return [o for o in (self.cat.opciones.get(actual, {}).get("evoluciona_a") or []) if o in todas]

    def transformar(self, token_id: str, opcion: str, usuario: str, es_gm: bool) -> str:
        """Cambia la opción de un grupo de formas (humano → lobo) o de evolución. Cambian bonos, rasgos, etiquetas, habilidades,
        recursos y estadísticas propias de la opción y la imagen; la vida y los demás recursos se mantienen en proporción."""
        t = self._token(token_id)
        if not es_gm:
            if not self.cfg["permisos"]["transformarse"]:
                raise ErrorJuego("En esta mesa solo el GM puede transformar a un personaje")
            if not self.puede_controlar(t, usuario, False):
                raise ErrorJuego("Solo puedes transformar a tus propios personajes")
            self._comprobar_turno(t, False)
        if opcion not in self.cat.opciones:
            raise ErrorJuego("Esa forma no existe")
        nueva = self.cat.opciones[opcion]
        grupo = nueva["grupo"]
        if opcion not in self.formas_posibles(t, grupo, es_gm):
            raise ErrorJuego("No puede transformarse en esa forma ahora")
        d = self.datos_de(t)
        antes = dict(d.get("elecciones") or {})
        despues = {**antes, grupo: opcion}
        for g in list(despues):                    # lo que dependía de la forma anterior («solo aparece si…») deja de valer
            if not self.grupo_activo(g, despues):
                del despues[g]
        # Estadísticas: se aplica la diferencia entre lo que fijaban las opciones de antes y las de ahora (los puntos ganados se conservan).
        sb_antes, sb_despues = self.cat.stats_base(antes), self.cat.stats_base(despues)
        definidas = {s["nombre"]: s for s in self.cfg["juego"]["estadisticas"]}
        for n in set(sb_antes) | set(sb_despues):
            if n not in sb_despues:
                if not definidas.get(n, {}).get("para_todos", True):
                    d["stats"].pop(n, None)
                continue
            nuevo = d["stats"].get(n, sb_antes.get(n, sb_despues[n])) + sb_despues[n] - sb_antes.get(n, sb_despues[n])
            e = definidas.get(n)
            d["stats"][n] = max(e["minimo"], min(e["maximo"], nuevo)) if e else nuevo
        # Recursos: máximos según las opciones nuevas, el valor actual en la misma proporción.
        rb_antes, rb_despues = self.cat.recursos_base(antes), self.cat.recursos_base(despues)
        vida = self.cat.recurso_vida()
        for n in set(rb_antes) | set(rb_despues):
            r = d["recursos"].get(n)
            if n not in rb_despues:
                if n != vida and not any(x["nombre"] == n and x.get("para_todos") for x in self.cfg["juego"]["recursos"]):
                    d["recursos"].pop(n, None)
                continue
            if rb_antes.get(n) == rb_despues[n] and r:
                continue
            if not r:
                d["recursos"][n] = self._recursos_nuevos({n: rb_despues[n]})[n]
                continue
            mx = max(1 if n == vida else 0, r["max"] + rb_despues[n] - rb_antes.get(n, r["max"]))
            r["actual"] = round(r["actual"] * mx / r["max"]) if r["max"] else min(r["actual"], mx)
            r["max"] = mx
        # Habilidades: se pierden las que solo daban las opciones de antes y se ganan las de las nuevas.
        de_antes = {h for o in antes.values() if o in self.cat.opciones for h in self.cat.opciones[o]["habilidades"]}
        de_ahora = [h for o in despues.values() if o in self.cat.opciones for h in self.cat.opciones[o]["habilidades"]]
        d["habilidades"] = [h for h in d.get("habilidades", []) if h not in de_antes or h in de_ahora]
        for h in de_ahora:
            if h not in d["habilidades"]:
                d["habilidades"].append(h)
        # Imagen del token: la de la forma, o la propia al volver a una forma sin imagen.
        if "imagen_propia" not in d:
            d["imagen_propia"] = d.get("imagen", "")
        d["imagen"] = nueva["imagen_forma"] or next((self.cat.opciones[o]["imagen_forma"] for o in despues.values()
                                                    if o in self.cat.opciones and self.cat.opciones[o]["imagen_forma"]), "") or d["imagen_propia"]
        d["elecciones"] = despues
        if t["tipo"] == "personaje":
            self.guardar_jugador(t["dueno"])
        self.guardar_estado()
        verbo = "evoluciona a" if self.cat.grupos[grupo]["transformacion"] == "evolucion" else "se transforma en"
        return f"✨ {d['nombre']} {verbo} {nueva['nombre']}."

    # ── Bandos: quién es aliado, neutral o enemigo de quién ──────
    def bando_de(self, t: dict) -> str:
        """«jugador» para los personajes de los jugadores; para un NPC, su bando actual (aliado, neutral o enemigo)."""
        if t["tipo"] == "personaje":
            return "jugador"
        b = t.get("bando") or self.cat.enemigos.get(t.get("base"), {}).get("bando")
        return b if b in ("aliado", "neutral", "enemigo") else "neutral"

    def relacion(self, origen: dict, destino: dict) -> str:
        """Cómo ve `origen` a `destino`: yo, aliado, neutral o enemigo. Jugadores y NPC aliados forman un equipo; los NPC enemigos, otro; los neutrales no están con nadie."""
        if origen is destino or origen["id"] == destino["id"]:
            return "yo"
        def lado(t):
            return {"jugador": "equipo", "aliado": "equipo", "enemigo": "rivales", "neutral": "neutral"}[self.bando_de(t)]
        a, b = lado(origen), lado(destino)
        if a == "neutral" or b == "neutral":
            return "neutral"
        return "aliado" if a == b else "enemigo"

    def _comprobar_ataque(self, origen: dict, destino: dict, modo: str):
        """La regla de la mesa sobre a quién se puede atacar (solo para jugadores; el GM no tiene límite)."""
        rel = self.relacion(origen, destino)
        if rel == "yo":
            return
        permitido = {"nadie": set(), "enemigos": {"enemigo"}, "enemigos_y_neutros": {"enemigo", "neutral"}, "todos": {"enemigo", "neutral", "aliado"}}.get(modo, set())
        if rel in permitido:
            return
        if modo == "nadie":
            raise ErrorJuego("El GM no te permite atacar a nadie")
        quienes = {"aliado": "aliados ni a otros jugadores", "neutral": "personajes neutrales", "enemigo": "enemigos"}[rel]
        raise ErrorJuego(f"En esta mesa no puedes atacar a {quienes}")

    # ── Habilidades y objetos ────────────────────────────────────
    @staticmethod
    def distancia(a: dict, b: dict) -> int:
        return max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"]))

    def usar_habilidad(self, token_id: str, habilidad_id: str, objetivo_id: str | None,
                       usuario: str, es_gm: bool, modo_ataque: str | None = None,
                       casilla: tuple[int, int] | None = None) -> tuple[str, list[str]]:
        """Usa una habilidad. Con un área (explosión, línea, frente) se puede apuntar a un token o a una casilla (`casilla`)."""
        origen = self._token(token_id)
        if not self.puede_controlar(origen, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        self._comprobar_turno(origen, es_gm)
        if self.derrotado(origen):
            raise ErrorJuego("Un personaje derrotado no puede actuar")
        datos = self.datos_de(origen)
        if habilidad_id not in datos["habilidades"]:
            raise ErrorJuego("Ese personaje no conoce esa habilidad")
        hab = self.cat.habilidades[habilidad_id]
        fuera = self.cfg["juego"].get("habilidades_fuera_de_combate", "todas")
        if not es_gm and not self.combate["activo"] and (fuera == "ninguna" or (fuera == "sin_dano" and hab["tipo"] == "dano")):
            raise ErrorJuego("Fuera de combate no se pueden usar " + ("habilidades" if fuera == "ninguna" else "habilidades que hacen daño"))
        for accion in ("habilidades", "atacar") if hab["tipo"] == "dano" else ("habilidades",):
            impide = self.impedido(origen, accion)
            if impide:
                raise ErrorJuego(f"«{impide}» no le deja {'atacar' if accion == 'atacar' else 'usar habilidades'}")
        silencio = self.impedido_por_etiqueta(origen, hab.get("etiquetas"))
        if silencio:
            raise ErrorJuego(f"«{silencio[0]}» no le deja usar habilidades de {', '.join(silencio[1])}")
        area = hab.get("area") or {"forma": "uno", "tamano": 1, "afecta": "rivales"}
        forma = area["forma"]
        modo = modo_ataque or self.cfg["permisos"]["atacar"]

        destino = None
        if hab["objetivo"] == "uno_mismo":
            destino = origen
            punto = (origen["x"], origen["y"])
        else:
            if objetivo_id:
                destino = self._token(objetivo_id)
                punto = (destino["x"], destino["y"])
            elif casilla is not None and (forma != "uno" or (hab["tipo"] == "dano" and self.rompible_en(*casilla))):
                punto = casilla
                if not (0 <= punto[0] < self.mapa["ancho"] and 0 <= punto[1] < self.mapa["alto"]):
                    raise ErrorJuego("Esa casilla está fuera del mapa")
            else:
                raise ErrorJuego("Debes elegir un objetivo")
            p = {"x": punto[0], "y": punto[1]}
            if forma not in ("cono", "casillas") and not hab.get("sin_limite") and self.distancia(origen, p) > hab["alcance"]:
                raise ErrorJuego(f"El objetivo está fuera de alcance ({hab['alcance']} casillas)")
            if forma in ("linea", "frente", "cono", "casillas") and punto == (origen["x"], origen["y"]):
                raise ErrorJuego("Apunta a otra casilla: la dirección sale de ti hacia ella")
            if not hab.get("atraviesa_muros", True) and not self.linea_libre(origen, p):
                raise ErrorJuego("Hay un muro en medio: esta habilidad no lo atraviesa")
            if forma == "uno" and destino is not None:
                rel = self.relacion(origen, destino)
                if hab["objetivo"] == "enemigo" and rel in ("aliado", "yo"):
                    raise ErrorJuego("Esa habilidad es contra enemigos y neutrales, no sobre aliados")
                if hab["objetivo"] == "aliado" and rel not in ("aliado", "yo"):
                    raise ErrorJuego("Esa habilidad solo se puede usar sobre aliados")
                if hab["tipo"] == "dano" and not es_gm:
                    self._comprobar_ataque(origen, destino, modo)

        # Requisitos sobre quien la usa: si no se cumplen, no se puede usar. Los del objetivo filtran a quién alcanza.
        req = hab.get("requisitos") or []
        propios = [c for c in req if c.get("quien", "uno_mismo") == "uno_mismo"]
        del_objetivo = [c for c in req if c.get("quien") == "objetivo"]
        if propios and not self.cumple({"si": propios}, origen, None):
            raise ErrorJuego(f"No puedes usar «{hab['nombre']}» ahora: {self.texto_requisitos(propios)}")

        # Tiles y objetos rompibles que alcanza un ataque (si quien ataca puede romper: el GM, o todos según «romper_casillas»)
        puede_romper = hab["tipo"] == "dano" and (es_gm or self.cfg["permisos"]["romper_casillas"] == "todos")
        celdas_golpe = ([] if not puede_romper or hab["objetivo"] == "uno_mismo" else
                        [punto] if forma == "uno" and destino is None else self.celdas_area(origen, punto, hab) if forma != "uno" else [])
        if forma == "uno" and destino is None and not puede_romper:
            raise ErrorJuego("En esta mesa solo el GM puede romper casillas y objetos")
        rompibles, vistos = [], set()
        for cx, cy in celdas_golpe:
            q = self.rompible_en(cx, cy)
            clave_r = q and (q[0], q[1]["nombre"] if q[0] == "tile" else q[1], (cx, cy) if q[0] == "tile" else None)
            if q and clave_r not in vistos:                  # un objeto grande cuenta una vez aunque ocupe varias casillas
                vistos.add(clave_r)
                rompibles.append((cx, cy))

        if forma == "uno" and destino is None:
            objetivos = []
        elif forma == "uno":
            objetivos = [destino]
            if del_objetivo and destino is not origen and not self.cumple({"si": del_objetivo}, origen, destino):
                raise ErrorJuego(f"«{hab['nombre']}» no sirve contra {self.nombre_de(destino)}: {self.texto_requisitos(del_objetivo)}")
        else:
            objetivos = self.afectados_por_area(origen, punto, hab, es_gm, modo)
            if del_objetivo:
                objetivos = [t for t in objetivos if t is origen or self.cumple({"si": del_objetivo}, origen, t)]
            if not objetivos and not rompibles:
                raise ErrorJuego("No hay nadie a quien alcanzar en esa zona")

        for rec, coste in hab["coste"].items():
            if rec not in datos["recursos"]:
                raise ErrorJuego(f"Tu personaje no tiene «{rec}», que esta habilidad necesita")
            if datos["recursos"][rec]["actual"] < coste:
                raise ErrorJuego(f"No tienes suficiente {rec} (necesitas {coste})")

        # «Al intentar…»: puede impedir la acción o, en un ataque a un solo objetivo, desviarlo (confusión: se golpea a sí mismo u otro al azar)
        ataca = hab["tipo"] == "dano" and hab["objetivo"] != "uno_mismo"
        desvio = self.intentar(origen, {"habilidad", "atacar"} if ataca else {"habilidad"}, destino if destino is not origen else None)
        nota_desvio = ""
        if desvio and ataca and forma == "uno" and destino is not None:
            nuevo = origen if desvio[0] == "quien_ataca" else (self.otro_al_azar(origen) or destino)
            if nuevo is not destino:
                nota_desvio = (f"😵 {desvio[1]}: {self.nombre_de(origen)} " +
                               ("se golpea a sí mismo · " if nuevo is origen else f"ataca a {self.nombre_de(nuevo)} sin querer · "))
                destino = nuevo
                objetivos = [nuevo]

        planas_o = self.stats_planas(origen)
        golpes = hab.get("golpes", 1)
        # Las etiquetas del ataque (para ventaja()): las de la habilidad y, si se marca, también las de quien la usa (su elemento, su tipo…)
        etq_ataque = list(hab.get("etiquetas") or []) + (self.etiquetas_de(origen) if hab.get("etiquetas_del_usuario") else [])
        tiradas = []                    # se calcula todo antes de cambiar nada: un error en la fórmula no deja la habilidad a medias
        for d in objetivos:
            atacante = dict(planas_o)
            atacante.setdefault(recursos.DISTANCIA, self.distancia(origen, d))
            planas_d = self.stats_planas(d)
            ventaja = self.multiplicador_ventaja(etq_ataque, self.etiquetas_de(d))
            res = []
            for _ in range(golpes if hab["tipo"] != "efecto" else 0):
                try:
                    r = formulas.evaluar(hab["formula"], atacante, planas_d, self.rng, tablas=self.tablas(),
                                         habilidad=hab.get("valores") or {}, ventaja=ventaja)
                except formulas.FormulaError as e:
                    raise ErrorJuego(f"Error en la fórmula de «{hab['nombre']}»: {e}") from None
                crit = hab.get("critico")
                if crit:           # crítico nativo: un d20 aparte por golpe; los bonos de crítico rebajan el número necesario
                    dado = self.rng.randint(1, 20)
                    if dado >= max(1, crit["desde"] - self.bono_critico_de(origen)):
                        r.valor = int(max(0, r.valor) * crit["multiplicador"])
                        r.detalle += f" | ¡Crítico! (d20={dado}, ×{formulas._numero(crit['multiplicador'])})"
                res.append(r)
            tiradas.append((d, res))

        for rec, coste in hab["coste"].items():
            antes = datos["recursos"][rec]["actual"]
            datos["recursos"][rec]["actual"] -= coste
            self.cambio_de_recurso(origen, rec, antes, datos["recursos"][rec]["actual"])

        vida = self.cat.recurso_vida()
        nombre_o = self.nombre_de(origen)
        partes, afectados = [], [origen]
        for d, res in tiradas:
            rv = self.datos_de(d)["recursos"][vida]
            valores = [max(0, r.valor) for r in res]
            total = sum(valores)
            vivo_antes = rv["actual"] > 0
            nombre_d = self.nombre_de(d)
            desglose = f" ({' + '.join(str(x) for x in valores)})" if len(valores) > 1 else ""
            detalle = " · ".join(r.detalle for r in res)
            if any("¡Crítico!" in r.detalle for r in res):
                desglose += " ¡Crítico!"
            critico = any("¡Crítico!" in r.detalle for r in res)
            self._golpe = {"critico": critico, "dano": total}     # para «El golpe es crítico» y «El daño es…»
            if hab["tipo"] == "efecto":
                txt = ""
            elif hab["tipo"] == "dano":
                notas, devuelto, rebote = [], 0, None
                if d is not origen:
                    refl = self.reflejo(d, origen)          # «Redirigir el ataque» de quien lo recibe: el golpe rebota o se desvía
                    if refl and total > 0:
                        rebote = origen if refl[0] == "quien_ataca" else self.otro_al_azar(d)
                        if rebote is not None:
                            notas.append(f"↩️ {refl[1]}: el golpe va a {self.nombre_de(rebote)}")
                            rebote = (rebote, total)
                            total = 0
                    if total > 0:                       # defensa activa: esquivar, bloquear, devolver…
                        total, mas, devuelto = self.defensa(d, origen, total)
                        notas += mas
                self._golpe["dano"] = total
                perdido, absorbido = self.danar(d, total, origen if d is not origen else None)
                notas += absorbido
                txt = f"{total} de daño{desglose}" + (f" ({', '.join(notas)})" if notas else "")
                if rv["actual"] == 0 and vivo_antes:
                    txt += f" ☠️ {nombre_d} ha sido derrotado"
                for quien, cuanto in ([(origen, devuelto)] if devuelto else []) + ([rebote] if rebote else []):
                    vivo = not self.derrotado(quien)
                    p2, n2 = self.danar(quien, cuanto, d)
                    txt += f" · {self.nombre_de(quien)} recibe {p2}" + (f" ({', '.join(n2)})" if n2 else "")
                    if vivo and self.derrotado(quien):
                        txt += f" ☠️ {self.nombre_de(quien)} ha sido derrotado"
                        self.al_derrotar(d, quien)
                    if quien not in afectados:
                        afectados.append(quien)
            else:
                antes = rv["actual"]
                rv["actual"] = min(rv["max"], antes + total)
                self.cambio_de_recurso(d, vida, antes, rv["actual"], origen if d is not origen else None)
                txt = f"+{rv['actual'] - antes} {vida}{desglose}"
            derrota = hab["tipo"] == "dano" and vivo_antes and rv["actual"] == 0
            # Un ataque que no hace daño (0 en la tirada, o anulado por la defensa) FALLA: no pone su estado ni sus efectos «al alcanzar»,
            # salvo que la habilidad diga lo contrario (`aplicar_si_falla`).
            falla = hab["tipo"] == "dano" and d is not origen and total <= 0 and not hab.get("aplicar_si_falla")
            if falla:
                txt += " (falla)"
            if hab["tipo"] == "dano" and d is not origen:
                self.disparar("al_atacar", origen, d)             # quien ataca, aunque el golpe derribe al objetivo (gasta su munición, sus cargas…)
                if not self.derrotado(d):
                    self.disparar("al_ser_atacado", d, origen)
            est = hab.get("aplica_estado")
            if est in self.cat.estados and not self.derrotado(d) and not falla:
                lista = d.setdefault("estados", [])
                if hab.get("alternar") and any(e["id"] == est for e in lista):      # activar / desactivar un poder
                    self.quitar_estado_de(d, est, "se_quita")
                    txt = (txt + " · " if txt else "") + f"ya no está en «{self.cat.estados[est]['nombre']}»"
                else:
                    puesto = self.poner_estado(d, est)       # según «Al volver a aplicarlo» (renovar, acumular cargas…)
                    if puesto:
                        txt = (txt + " · " if txt else "") + f"«{puesto}»"
                self._marcar(d)
            for ef in () if falla else (hab.get("efectos") or ()):
                if not self.derrotado(d) and self.cumple(ef, origen, d):
                    self.aplicar_accion(hab["nombre"], origen, d, ef["hacer"])
            mov = hab.get("mover_objetivo")
            if mov and d is not origen and not self.derrotado(d):
                pasos = self.desplazar(d, origen, mov["modo"], mov["casillas"])
                if pasos:
                    txt += f" ({'atraído' if mov['modo'] == 'atraer' else 'empujado'} {pasos} {'casilla' if pasos == 1 else 'casillas'})"
            if derrota:
                self.al_derrotar(origen, d)
            self._golpe = None
            partes.append((nombre_d, txt, detalle))
            if d not in afectados:
                afectados.append(d)
        if nota_desvio and partes:
            n0, t0, d0 = partes[0]
            partes[0] = (n0, nota_desvio + t0, d0)
        icono = "⚔️" if hab["tipo"] == "dano" else "✨"
        detalles = " · ".join(dt for _, _, dt in partes if dt)
        if not partes:                                   # solo golpeó tiles u objetos
            texto = f"{icono} {nombre_o} usó {hab['nombre']}"
        elif len(partes) == 1 and forma == "uno":
            nombre_d, txt, detalle = partes[0]
            texto = f"{icono} {nombre_o} usó {hab['nombre']}" + ("" if nombre_d == nombre_o and not txt else f" sobre {nombre_d}") + (f": {txt}" if txt else "") + (f"{recursos.DETALLE}{detalle}" if detalle else "")
        else:
            texto = f"{icono} {nombre_o} usó {hab['nombre']}: " + " · ".join(f"{n} {t}".strip() for n, t, _ in partes) + (f"{recursos.DETALLE}{detalles}" if detalles else "")
        for cx, cy in rompibles:                         # cada tile u objeto rompible alcanzado recibe un golpe
            self.golpes_pendientes.append(self.golpe(cx, cy))
        self._guardar_afectados(*afectados)
        return texto, list(dict.fromkeys(t["id"] for t in afectados))

    def texto_requisitos(self, conds: list[dict]) -> str:
        """Los requisitos en una frase corta, para el aviso cuando no se cumplen."""
        trozos = []
        for c in conds:
            quien = "tú" if c.get("quien", "uno_mismo") == "uno_mismo" else "el objetivo"
            no = c.get("tiene", "si") == "no"
            t = c["tipo"]
            if t == "tiene_etiqueta":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} tener la etiqueta «{c.get('etiqueta')}»")
            elif t == "tiene_estado":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} sufrir «{self.cat.estados.get(c.get('estado'), {}).get('nombre', c.get('estado'))}»")
            elif t == "lleva_objeto":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} llevar «{self.cat.objetos.get(c.get('objeto'), {}).get('nombre', c.get('objeto'))}»")
            elif t == "es_opcion":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} ser «{self.cat.opciones.get(c.get('opcion'), {}).get('nombre', c.get('opcion'))}»")
            elif t in ("recurso", "estadistica"):
                que = c.get("recurso") or c.get("estadistica")
                comp = {"menos_de": "menos de", "al_menos": "al menos", "igual_a": "exactamente"}.get(c.get("comparacion"), "")
                unidad = "%" if t == "recurso" and c.get("unidad") == "porcentaje" else ""
                trozos.append(f"{quien}: {que} {comp} {c.get('valor')}{unidad}")
            elif t == "en_combate":
                trozos.append("solo en combate" if c.get("activo", "si") == "si" else "solo fuera de combate")
            elif t == "momento_dia":
                trozos.append(f"solo de {c.get('periodo')}")
            elif t == "clima":
                trozos.append(f"solo con clima: {c.get('clima')}")
            elif t == "bando":
                trozos.append(f"{quien} debe ser {c.get('bando')}")
            else:
                trozos.append("no se cumplen sus requisitos")
        return "; ".join(trozos)

    def celdas_area(self, origen: dict, punto: tuple[int, int], hab: dict) -> list[tuple[int, int]]:
        """Casillas que alcanza una habilidad con área, apuntando a `punto` (el cliente dibuja lo mismo al apuntar)."""
        area = hab.get("area") or {}
        forma, tam = area.get("forma", "uno"), area.get("tamano", 1)
        an, al = self.mapa["ancho"], self.mapa["alto"]
        dentro = lambda x, y: 0 <= x < an and 0 <= y < al          # noqa: E731
        px, py = punto
        if forma == "explosion":
            return [(x, y) for y in range(py - tam, py + tam + 1) for x in range(px - tam, px + tam + 1) if dentro(x, y)]
        ox, oy = origen["x"], origen["y"]
        dx, dy = px - ox, py - oy
        n = max(abs(dx), abs(dy))
        if n == 0:
            return [(px, py)] if forma == "uno" else []
        if forma == "linea":
            largo = an + al if hab.get("sin_limite") else hab["alcance"]
            opacas = set() if hab.get("atraviesa_muros", True) else self._opacas()
            res = []
            for k in range(1, largo + 1):
                x, y = ox + _redondear(k * dx / n), oy + _redondear(k * dy / n)
                if not dentro(x, y) or (x, y) in opacas:
                    break
                res.append((x, y))
            return res
        if forma in ("cono", "casillas"):
            # Mira hacia el lado dominante (arriba, abajo, izquierda o derecha); el área sale de quien la usa
            fx, fy = ((dx > 0) - (dx < 0), 0) if abs(dx) >= abs(dy) else (0, (dy > 0) - (dy < 0))
            rx, ry = -fy, fx                  # su derecha
            if forma == "cono":
                rel = [(k, l) for k in range(1, tam + 1) for l in range(-(k - 1), k)]
            else:
                rel = [tuple(c) for c in area.get("casillas", [])]
            res = []
            for f, l in rel:
                x, y = ox + f * fx + l * rx, oy + f * fy + l * ry
                if dentro(x, y) and (x, y) not in res:
                    res.append((x, y))
            return res
        if forma == "frente":
            sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
            qx, qy = -sy, sx                  # perpendicular a la dirección
            mitad = tam // 2
            res = []
            for k in range(-mitad, tam - mitad):
                x, y = px + k * qx, py + k * qy
                if dentro(x, y):
                    res.append((x, y))
            return res
        return [(px, py)]

    def afectados_por_area(self, origen: dict, punto: tuple[int, int], hab: dict, es_gm: bool, modo: str) -> list[dict]:
        celdas = self.celdas_area(origen, punto, hab)
        orden = {c: i for i, c in enumerate(celdas)}
        afecta = (hab.get("area") or {}).get("afecta", "rivales")
        res = []
        for t in self.tokens.values():
            if (t.get("x"), t.get("y")) not in orden or self.derrotado(t):
                continue
            rel = self.relacion(origen, t)
            if afecta == "aliados":
                if rel not in ("aliado", "yo"):
                    continue
            elif rel == "yo":
                continue
            elif afecta == "rivales" and rel == "aliado":
                continue
            if hab["tipo"] == "dano" and not es_gm and rel != "yo":
                try:
                    self._comprobar_ataque(origen, t, modo)
                except ErrorJuego:
                    continue
            res.append(t)
        return sorted(res, key=lambda t: orden[(t["x"], t["y"])])

    def desplazar(self, t: dict, respecto: dict, modo: str, casillas: int) -> int:
        """Atrae (hacia `respecto`) o empuja (lejos de él) a un token casilla a casilla, sin entrar en muros ni casillas ocupadas.
        casillas = 0 al atraer: hasta quedar pegado. → casillas que se ha movido."""
        movidas = 0
        limite = casillas or (self.mapa["ancho"] + self.mapa["alto"])
        while movidas < limite:
            dx, dy = respecto["x"] - t["x"], respecto["y"] - t["y"]
            if modo == "atraer" and max(abs(dx), abs(dy)) <= 1:
                break
            sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
            if modo == "empujar":
                sx, sy = -sx, -sy
                if sx == sy == 0:
                    break
            nx, ny = t["x"] + sx, t["y"] + sy
            if not self.casilla_transitable(nx, ny) or self.casilla_ocupada(nx, ny, t["id"]):
                break
            t["x"], t["y"] = nx, ny
            movidas += 1
        return movidas

    def equipar(self, token_id: str, objeto_id, poner: bool, usuario: str, es_gm: bool) -> str:
        """Equipa o quita un objeto (si la campaña usa equipamiento). Un hueco ocupado se libera solo: se cambia una cosa por otra."""
        eq = self.cfg["juego"].get("equipamiento") or {}
        if not eq.get("activo"):
            raise ErrorJuego("Esta campaña no usa equipamiento")
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        datos = self.datos_de(t)
        entrada = next((e for e in datos["inventario"] if e["objeto"] == objeto_id), None) if isinstance(objeto_id, str) else None
        if not entrada:
            raise ErrorJuego("No tienes ese objeto")
        obj = self.cat.objetos[objeto_id]
        if not obj.get("equipable"):
            raise ErrorJuego("Ese objeto no se puede equipar")
        if not poner:
            entrada.pop("equipado", None)
            self._guardar_afectados(t)
            return f"{datos['nombre']} se quita {obj['nombre']}."
        if entrada.get("equipado"):
            return f"{datos['nombre']} ya lleva {obj['nombre']}."
        quitados = []
        if obj.get("hueco"):
            for e in datos["inventario"]:
                o = self.cat.objetos.get(e["objeto"]) or {}
                if e.get("equipado") and o.get("hueco") == obj["hueco"]:
                    e.pop("equipado", None)
                    quitados.append(o["nombre"])
        puestos = sum(1 for e in datos["inventario"] if e.get("equipado"))
        if eq.get("maximo") and puestos >= eq["maximo"]:
            for e in datos["inventario"]:          # deshace el cambio de hueco si al final no cabe
                if (self.cat.objetos.get(e["objeto"]) or {}).get("nombre") in quitados:
                    e["equipado"] = True
            raise ErrorJuego(f"Solo se pueden llevar {eq['maximo']} objetos equipados: quítate otro antes")
        entrada["equipado"] = True
        self._guardar_afectados(t)
        return f"{datos['nombre']} se equipa {obj['nombre']}" + (f" (se quita {', '.join(quitados)})." if quitados else ".")

    def _token_cercano(self, origen: dict, otro_id, usuario: str, es_gm: bool, para: str) -> dict:
        """Otro token de la sala al que `origen` le hace algo con un objeto (usarlo con él, dárselo): tiene que verlo y estar
        a `permisos.alcance_objetos` casillas como mucho (el GM no tiene límite de distancia)."""
        otro = self.tokens.get(otro_id) if isinstance(otro_id, str) else None
        if not otro or not self.puede_ver(otro, usuario, es_gm):
            raise ErrorJuego("Ese token no está en esta sala")
        alcance = self.cfg["permisos"]["alcance_objetos"]
        if not es_gm and self.distancia(origen, otro) > alcance:
            casillas = "casilla" if alcance == 1 else "casillas"
            raise ErrorJuego(f"{self.nombre_de(otro)} está demasiado lejos para {para} (como mucho a {alcance} {casillas})")
        return otro

    def usar_objeto(self, token_id: str, objeto_id: str, usuario: str, es_gm: bool, objetivo_id: str | None = None) -> tuple[str, list[str]]:
        """Usa un objeto del inventario de `token_id`: sobre sí mismo o, con `objetivo_id`, sobre otro token cercano (una poción a un
        aliado). Lo que hace el objeto (su recurso y sus efectos «Al usarlo») le pasa a quien lo recibe; se gasta del que lo lleva."""
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        self._comprobar_turno(t, es_gm)
        impide = self.impedido(t, "objetos")
        if impide:
            raise ErrorJuego(f"«{impide}» no le deja usar objetos")
        datos = self.datos_de(t)
        entrada = next((e for e in datos["inventario"] if e["objeto"] == objeto_id), None)
        if not entrada:
            raise ErrorJuego("No tienes ese objeto")
        obj = self.cat.objetos[objeto_id]
        al_usar = [e for e in obj.get("efectos", []) if e["cuando"]["tipo"] == "al_usar"]
        if not obj["efecto"] and not al_usar:
            raise ErrorJuego(f"«{obj['nombre']}» no se puede usar")
        dest = t if objetivo_id in (None, "", token_id) else self._token_cercano(t, objetivo_id, usuario, es_gm, f"usar {obj['nombre']} con él")
        self.intentar(t, {"objeto"}, dest if dest is not t else None)
        dd = self.datos_de(dest)
        ef = obj["efecto"]
        texto = f"🧪 {datos['nombre']} usó {obj['nombre']}" + (f" con {dd['nombre']}" if dest is not t else "")
        if ef:
            if ef["recurso"] not in dd["recursos"]:
                if not al_usar:
                    quien = "Este personaje" if dest is t else dd["nombre"]
                    raise ErrorJuego(f"{quien} no tiene «{ef['recurso']}», así que «{obj['nombre']}» no le sirve")
            else:
                r = dd["recursos"][ef["recurso"]]
                antes = r["actual"]
                r["actual"] = min(r["max"], antes + ef["valor"])
                self.cambio_de_recurso(dest, ef["recurso"], antes, r["actual"])
                texto += f": {ef['recurso']} {antes} → {r['actual']}"
        for e in al_usar:              # «Al usarlo»: quitar estados, aplicar otros, sumar experiencia… (con sus condiciones), en quien lo recibe
            if self.cumple(e, dest):
                self.aplicar_accion(obj["nombre"], dest, None, e["hacer"])
        if obj["tipo"] == "consumible":
            entrada["cantidad"] -= 1
            if entrada["cantidad"] <= 0:
                datos["inventario"].remove(entrada)
        self._guardar_afectados(t, *([dest] if dest is not t else []))
        return texto, [t["id"]] + ([dest["id"]] if dest is not t else [])

    def dar_objeto(self, token_id: str, a_id: str, objeto_id: str, cantidad, usuario: str, es_gm: bool) -> tuple[str, list[str]]:
        """Pasa `cantidad` unidades de un objeto del inventario de un token propio al de otro token cercano de la sala.
        Si estaba equipado y se dan todas, deja de estarlo. En combate (con «solo en su turno») solo en el turno de quien da."""
        if not es_gm and not self.cfg["permisos"]["dar_objetos"]:
            raise ErrorJuego("En esta mesa no se pueden dar objetos")
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        if a_id == token_id:
            raise ErrorJuego("No puedes darte un objeto a ti mismo")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or not 1 <= cantidad <= 999:
            raise ErrorJuego("La cantidad debe ser un entero entre 1 y 999")
        self._comprobar_turno(t, es_gm)
        datos = self.datos_de(t)
        entrada = next((e for e in datos["inventario"] if e["objeto"] == objeto_id), None) if isinstance(objeto_id, str) else None
        if not entrada:
            raise ErrorJuego("No tienes ese objeto")
        if cantidad > entrada["cantidad"]:
            raise ErrorJuego(f"Solo tienes {entrada['cantidad']}")
        obj = self.cat.objetos[objeto_id]
        dest = self._token_cercano(t, a_id, usuario, es_gm, "darle algo")
        dd = self.datos_de(dest)
        entrada["cantidad"] -= cantidad
        if entrada["cantidad"] <= 0:
            datos["inventario"].remove(entrada)
        suya = next((e for e in dd["inventario"] if e["objeto"] == objeto_id), None)
        if suya:
            suya["cantidad"] += cantidad
        else:
            dd["inventario"].append({"objeto": objeto_id, "cantidad": cantidad})
        self._guardar_afectados(t, dest)
        return f"🎁 {datos['nombre']} dio {cantidad} × {obj['nombre']} a {dd['nombre']}.", [t["id"], dest["id"]]

    def _guardar_afectados(self, *tokens: dict):
        for t in tokens:
            if t["tipo"] == "personaje":
                self.guardar_jugador(t["dueno"])
        self.guardar_estado()

    # ── Niveles y experiencia ────────────────────────────────────
    def nivel_de(self, token: dict) -> int:
        if token["tipo"] == "personaje":
            return self.datos_de(token).get("nivel", 1)
        return token.get("nivel") or self.cat.enemigos.get(token.get("base"), {}).get("nivel", 1)

    def experiencia_de(self, p: dict) -> dict:
        """{total, por_tipo, siguiente (experiencia para el próximo nivel o None)} de un personaje (sus datos)."""
        n = self.cfg["juego"]["niveles"]
        por_tipo = {x: p["stats"].get(x, 0) for x in n["experiencia"]}
        nivel = p.get("nivel", 1)
        sig = n["umbrales"][nivel - 1] if n["modo"] == "experiencia" and nivel - 1 < len(n["umbrales"]) and nivel < recursos.nivel_maximo(self.cfg) else None
        anterior = n["umbrales"][nivel - 2] if n["modo"] == "experiencia" and 0 <= nivel - 2 < len(n["umbrales"]) else 0
        return {"total": sum(por_tipo.values()), "por_tipo": por_tipo, "siguiente": sig, "anterior": anterior}

    def experiencia_que_cede(self, token: dict) -> dict:
        """Lo que cede un NPC al ser derrotado ({tipo: cantidad}): lo que el GM puso a ese token o, si no, lo de su ficha de enemigo."""
        if token["tipo"] != "enemigo":
            return {}
        propia = token.get("experiencia")
        if isinstance(propia, dict):
            return propia
        return self.cat.enemigos.get(token.get("base"), {}).get("experiencia") or {}

    def _sumar_experiencia(self, token: dict, cantidades: dict) -> str:
        """Suma experiencia (por tipo) a un personaje, sin pasar del máximo de cada estadística, y sube de nivel si toca. → texto «Exp. combate +50»."""
        d = self.datos_de(token)
        definidas = {e["nombre"]: e for e in self.cfg["juego"]["estadisticas"]}
        partes = []
        for k, c in cantidades.items():
            e = definidas[k]
            antes = d["stats"].get(k, e["valor_inicial"])
            d["stats"][k] = max(e["minimo"], min(e["maximo"], antes + c))
            if d["stats"][k] != antes:
                partes.append(f"{k} {'+' if c > 0 else ''}{d['stats'][k] - antes}")
        self._guardar_afectados(token)
        self.revisar_nivel(token)
        return ", ".join(partes)

    def otorgar_experiencia(self, vencido: dict, vencedor: dict | None):
        """Un NPC acaba de ser derrotado: reparte la experiencia que cede, según `niveles.reparto` (todos los personajes en pie, o solo el vencedor).
        Una sola vez por token (si lo reviven y lo derrotan otra vez, no vuelve a dar)."""
        n = self.cfg["juego"]["niveles"]
        if not n["activo"] or vencido["tipo"] != "enemigo" or vencido.get("exp_cobrada"):
            return
        cede = {k: c for k, c in self.experiencia_que_cede(vencido).items() if c > 0 and k in n["experiencia"]}
        if not cede:
            return
        vencido["exp_cobrada"] = True
        if n["reparto"] == "vencedor":
            receptores = [vencedor] if vencedor is not None and vencedor["tipo"] == "personaje" else []
        else:
            receptores = [t for t in self.tokens.values() if t["tipo"] == "personaje" and not self.derrotado(t)]
        if not receptores:
            return
        texto = ", ".join(f"{k} +{c}" for k, c in cede.items())
        nombres = []
        for t in receptores:
            self._sumar_experiencia(t, cede)
            nombres.append(self.datos_de(t)["nombre"])
        self.cola_chat.append((f"🏆 {self.datos_de(vencido)['nombre']} cede experiencia ({texto}) a {', '.join(nombres)}", "sistema"))

    def revisar_nivel(self, token: dict) -> int:
        """En modo «experiencia», sube los niveles que correspondan a la experiencia total. → niveles subidos."""
        n = self.cfg["juego"]["niveles"]
        if not n["activo"] or n["modo"] != "experiencia" or token["tipo"] != "personaje":
            return 0
        p = self.datos_de(token)
        subidos = 0
        while p.get("nivel", 1) < recursos.nivel_maximo(self.cfg) and self.experiencia_de(p)["total"] >= n["umbrales"][p.get("nivel", 1) - 1]:
            self._subir_un_nivel(p)
            subidos += 1
        if subidos:
            self._marcar(token)
            self.guardar_jugador(p["dueno"])
        return subidos

    def _subir_un_nivel(self, p: dict):
        """Lo que da cada nivel: puntos para repartir, más máximo en algunos recursos y las habilidades que se aprenden a ese nivel."""
        n = self.cfg["juego"]["niveles"]
        p["nivel"] = p.get("nivel", 1) + 1
        nivel = p["nivel"]
        extras = []
        if n.get("entrega", "automatica") == "gm":         # el GM da a mano lo que corresponda (puntos, vida, habilidades…)
            self.cola_chat.append((f"🎉 {p['nombre']} sube a nivel {nivel} (el GM decide qué gana)", "sistema"))
            return
        opciones = self.opciones_elegidas(p)
        pn = n["por_nivel"]
        puntos = pn["puntos"] + sum(o.get("puntos_por_nivel", 0) for o in opciones)        # lo de la campaña + lo de su raza, clase…
        if puntos:
            p["puntos_pendientes"] = p.get("puntos_pendientes", 0) + puntos
            extras.append(f"+{puntos} puntos")
        suma_rec = dict(pn["recursos"])
        for o in opciones:
            for k, mas in o.get("recursos_por_nivel", {}).items():
                suma_rec[k] = suma_rec.get(k, 0) + mas
        vida = self.cat.recurso_vida()
        for k, mas in suma_rec.items():
            r = p["recursos"].get(k)
            if not r or not mas:
                continue
            r["max"] = max(1 if k == vida else 0, r["max"] + mas)
            r["actual"] = max(0, min(r["max"], r["actual"] + mas))
            extras.append(f"{k} {'+' if mas > 0 else ''}{mas}")
        aprende = list(n["aprende"]) + [a for o in opciones for a in o.get("aprende", [])]
        for a in aprende:
            if a["nivel"] == nivel and a["habilidad"] in self.cat.habilidades and a["habilidad"] not in p["habilidades"]:
                p["habilidades"].append(a["habilidad"])
                extras.append(f"aprende «{self.cat.habilidades[a['habilidad']]['nombre']}»")
        self.cola_chat.append((f"🎉 {p['nombre']} sube a nivel {nivel}{': ' + ', '.join(extras) if extras else ''}", "sistema"))

    def subir_nivel(self, usuario: str, personaje_id: str) -> str:
        """Acción del GM: sube un nivel a mano (en modo «manual» es la única forma; en «experiencia» sirve para premiar)."""
        if not self.cfg["juego"]["niveles"]["activo"]:
            raise ErrorJuego("Esta campaña no usa niveles")
        p = self.buscar_personaje(usuario, personaje_id) if isinstance(usuario, str) and isinstance(personaje_id, str) else None
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if p.get("nivel", 1) >= recursos.nivel_maximo(self.cfg):
            raise ErrorJuego(f"{p['nombre']} ya está en el nivel máximo ({recursos.nivel_maximo(self.cfg)})")
        self._subir_un_nivel(p)
        t = self.token_de_personaje(usuario, personaje_id)
        if t:
            self._marcar(t)
        self.guardar_jugador(usuario)
        return p["nombre"]

    # ── Combate ──────────────────────────────────────────────────
    def token_en_turno(self) -> str | None:
        c = self.combate
        if not c["activo"] or not c["orden"]:
            return None
        return c["orden"][c["indice"]]

    def modos_iniciativa(self) -> list[str]:
        """Modos entre los que puede elegir el GM al iniciar un combate (uno solo = no se pregunta)."""
        j = self.cfg["juego"]
        return list(j["iniciativa_opciones"]) if j["iniciativa"] == "preguntar" else [j["iniciativa"]]

    def iniciar_combate(self, modo: str | None = None) -> str:
        """Empieza un combate. Modos: «estadistica» (cada jugador tira su iniciativa; los NPC tiran solos), «valor» (de mayor a menor
        estadística, sin dado) o «manual» (el GM ordena). Con «estadistica» primero hay una fase de «decidir turnos»."""
        if self.combate["activo"] or self.combate.get("preparando"):
            raise ErrorJuego("Ya hay un combate en curso")
        modos = self.modos_iniciativa()
        modo = modo or modos[0]
        if modo not in modos:
            raise ErrorJuego("Ese modo de decidir los turnos no está permitido en esta campaña")
        participantes = [t for t in self.tokens.values() if not self.derrotado(t)]
        if len(participantes) < 2:
            raise ErrorJuego("Hace falta al menos 2 tokens para iniciar un combate")
        if modo == "manual":
            # Sin tiradas: primero los personajes y luego los NPC; el GM los reordena a su gusto (gm_orden_turnos).
            orden = sorted(participantes, key=lambda t: (t["tipo"] != "personaje", self.nombre_de(t).casefold()))
            # Fase de espera: el GM ordena a los participantes (ventanita) y pulsa «Listo»; los demás esperan.
            self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {},
                            "preparando": {"modo": "manual", "participantes": [t["id"] for t in orden], "orden": [t["id"] for t in orden], "tiradas": {}}}
            self.guardar_estado()
            return "🧭 ¡Combate! El GM está decidiendo el orden de los turnos."
        if modo == "valor":
            valores = [(self.stats_efectivas(t).get(self.estadistica_iniciativa(t), 0), self.rng.random(), t) for t in participantes]
            valores.sort(key=lambda e: (-e[0], e[1]))           # empate: al azar
            self._empezar([e[2] for e in valores], "valor", {e[2]["id"]: e[0] for e in valores})
            return f"⚔️ ¡Comienza el combate! Por orden de estadística: {', '.join(f'{self.nombre_de(e[2])} ({e[0]})' for e in valores)}"
        # «estadistica»: los NPC tiran ya; cada jugador tira la de sus personajes (o el GM empieza y se tira por quien falte)
        tiradas = {t["id"]: self._tirada_iniciativa(t) for t in participantes if t["tipo"] != "personaje"}
        self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {},
                        "preparando": {"participantes": [t["id"] for t in participantes], "tiradas": tiradas}}
        if all(t["id"] in tiradas for t in participantes):
            return self.empezar_tras_tiradas()
        self.guardar_estado()
        return "🎲 ¡Combate! Decidiendo los turnos: cada jugador tira la iniciativa de su personaje."

    def _tirada_iniciativa(self, t: dict) -> list:
        return [self.rng.randint(1, 20) + self.stats_efectivas(t).get(self.estadistica_iniciativa(t), 0), self.rng.random()]

    def tirar_iniciativa(self, token_id: str, usuario: str, es_gm: bool) -> str:
        p = self.combate.get("preparando")
        if not p:
            raise ErrorJuego("Ahora no se están decidiendo los turnos")
        if p.get("modo") == "manual":
            raise ErrorJuego("En este combate el GM decide el orden: no se tira iniciativa")
        t = self._token(token_id)
        if t["id"] not in p["participantes"] or not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes tirar la iniciativa de ese token")
        if t["id"] in p["tiradas"]:
            raise ErrorJuego("Ya tiró su iniciativa")
        p["tiradas"][t["id"]] = self._tirada_iniciativa(t)
        self.guardar_estado()
        return f"🎲 {self.nombre_de(t)} tira iniciativa: {p['tiradas'][t['id']][0]}"

    def faltan_iniciativas(self) -> list[str]:
        p = self.combate.get("preparando")
        return [i for i in p["participantes"] if i in self.tokens and i not in p["tiradas"]] if p else []

    def empezar_tras_tiradas(self) -> str:
        """Fin de la fase de decidir turnos: se tira por quien falte y empieza el combate en orden de tirada."""
        p = self.combate.get("preparando")
        if not p:
            raise ErrorJuego("Ahora no se están decidiendo los turnos")
        if p.get("modo") == "manual":                      # el GM marcó «Listo»: empieza en el orden que dejó
            orden = [self.tokens[i] for i in p["orden"] if i in self.tokens and not self.derrotado(self.tokens[i])]
            if len(orden) < 2:
                self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}}
                raise ErrorJuego("Hace falta al menos 2 tokens para iniciar un combate")
            self._empezar(orden, "manual")
            return f"⚔️ ¡Comienza el combate! Orden decidido por el GM: {', '.join(self.nombre_de(t) for t in orden)}"
        for i in self.faltan_iniciativas():
            p["tiradas"][i] = self._tirada_iniciativa(self.tokens[i])
        tiradas = sorted(((v[0], v[1], self.tokens[i]) for i, v in p["tiradas"].items() if i in self.tokens), key=lambda e: (-e[0], e[1]))
        if len(tiradas) < 2:
            self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}}
            raise ErrorJuego("Hace falta al menos 2 tokens para iniciar un combate")
        self._empezar([e[2] for e in tiradas], "estadistica", {e[2]["id"]: e[0] for e in tiradas})
        return f"⚔️ ¡Comienza el combate! Iniciativa: {', '.join(f'{self.nombre_de(e[2])} ({e[0]})' for e in tiradas)}"

    def _empezar(self, orden: list[dict], modo: str = "manual", valores: dict | None = None):
        # `modo` y `valores` (la iniciativa de cada uno) sirven para meter después a alguien en su sitio (combate_anadir)
        self.combate = {"activo": True, "orden": [t["id"] for t in orden], "indice": 0, "ronda": 1, "movido": {},
                        "con_enemigos": any(t.get("bando") == "enemigo" for t in orden), "modo": modo, "valores": dict(valores or {})}
        self.guardar_estado()
        self.al_empezar_turno(orden[0])

    def ordenar_turnos(self, orden) -> str:
        """El GM cambia el orden: mismos participantes, en otro orden. El turno sigue siendo de quien lo tenía."""
        c = self.combate
        prep = c.get("preparando")
        if prep and prep.get("modo") == "manual":          # todavía no empezó: se ordena la lista de espera
            if not isinstance(orden, list) or sorted(map(str, orden)) != sorted(prep["orden"]) or len(set(orden)) != len(orden):
                raise ErrorJuego("El nuevo orden debe tener a los mismos participantes")
            prep["orden"] = list(orden)
            self.guardar_estado()
            return "🔀 El GM está ordenando los turnos."
        if not c["activo"]:
            raise ErrorJuego("No hay ningún combate en curso")
        if not isinstance(orden, list) or sorted(map(str, orden)) != sorted(c["orden"]) or len(set(orden)) != len(orden):
            raise ErrorJuego("El nuevo orden debe tener a los mismos participantes")
        actual = self.token_en_turno()
        c["orden"] = list(orden)
        c["indice"] = c["orden"].index(actual)
        self.guardar_estado()
        return f"🔀 El GM cambió el orden de los turnos: {', '.join(self.nombre_de(self.tokens[i]) for i in c['orden'] if i in self.tokens)}"

    # Movimiento limitado en combate: cada uno anda, en su turno, como mucho las casillas de la campaña (o el valor de una estadística).
    def movimiento_max(self, token: dict) -> int | None:
        mv = self.cfg["juego"]["movimiento"]
        if not mv["limitado"]:
            return None
        if mv["estadistica"]:
            return max(0, int(self.stats_efectivas(token).get(mv["estadistica"], 0)))
        return mv["casillas"]

    def movimiento_restante(self, token: dict) -> int | None:
        mx = self.movimiento_max(token)
        if mx is None or not self.combate["activo"]:
            return None
        return max(0, mx - self.combate.setdefault("movido", {}).get(token["id"], 0))

    def pasos_hasta(self, desde: tuple[int, int], hasta: tuple[int, int], limite: int) -> int | None:
        """Casillas que hay que andar (sin muros ni lados cerrados), o None si no se llega en `limite` pasos."""
        if desde == hasta:
            return 0
        vistos, frontera = {desde}, [desde]
        for paso in range(1, limite + 1):
            nueva = []
            for x, y in frontera:
                for lado, (dx, dy) in recursos.LADOS.items():
                    n = (x + dx, y + dy)
                    if n in vistos or not self.puede_pasar(x, y, lado):
                        continue
                    if n == hasta:
                        return paso
                    vistos.add(n)
                    nueva.append(n)
            frontera = nueva
            if not frontera:
                break
        return None

    def estadistica_iniciativa(self, token: dict) -> str:
        """La de su primera opción que la cambie (p. ej. un tipo de ficha «Compañero» que usa Agilidad); si no, la de la campaña."""
        for op in self.opciones_elegidas(self.datos_de(token)):
            if op.get("iniciativa"):
                return op["iniciativa"]
        return self.cfg["juego"]["estadistica_iniciativa"]

    def terminar_combate(self):
        self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}}
        self.guardar_estado()

    def combate_sin_enemigos(self) -> bool:
        """Con `juego.fin_combate: automatico`: ¿el combate debe terminar porque ya no queda ningún NPC enemigo en pie?
        Solo cuenta si al empezar había enemigos (un combate entre aliados o jugadores no termina por esto)."""
        c = self.combate
        if not c["activo"] or self.cfg["juego"].get("fin_combate") != "automatico" or not c.get("con_enemigos"):
            return False
        return not any(t.get("bando") == "enemigo" and not self.derrotado(t) for t in self.tokens.values())

    # ── El GM decide quién participa: quitar o añadir tokens a los turnos ──
    def en_combate(self, token_id: str) -> bool:
        c = self.combate
        prep = c.get("preparando")
        return token_id in (prep["participantes"] if prep else c["orden"] if c["activo"] else [])

    def combate_quitar(self, token_id: str) -> str:
        """Saca a un token de los turnos (sigue en el mapa). Si era su turno, empieza el del siguiente."""
        c = self.combate
        if not c["activo"] and not c.get("preparando"):
            raise ErrorJuego("No hay ningún combate en curso")
        t = self._token(token_id)
        if not self.en_combate(token_id):
            raise ErrorJuego(f"{self.nombre_de(t)} no está en los turnos")
        era_su_turno = c["activo"] and self.token_en_turno() == token_id
        self._retirar_del_combate(token_id)
        texto = f"➖ {self.nombre_de(t)} sale de los turnos."
        if not self.combate["activo"] and not self.combate.get("preparando"):
            return texto + " El combate termina: queda menos de 2."
        if era_su_turno:
            for _ in range(len(c["orden"])):              # el siguiente en pie
                sig = self.tokens.get(c["orden"][c["indice"]])
                if sig and not self.derrotado(sig):
                    break
                c["indice"] = (c["indice"] + 1) % len(c["orden"])
            sig = self.tokens[c["orden"][c["indice"]]]
            c.setdefault("movido", {})[sig["id"]] = 0
            self.al_empezar_turno(sig)
            texto += f" Turno de {self.nombre_de(sig)}."
        self.guardar_estado()
        return texto

    def combate_anadir(self, token_id: str) -> str:
        """Mete a un token en los turnos. Con iniciativa por tirada o por estadística entra en su sitio (tira o se mira su estadística);
        con el orden a mano, al final (el GM lo mueve con las flechas). Nunca le quita el turno a quien lo tiene."""
        c = self.combate
        t = self._token(token_id)
        if self.derrotado(t):
            raise ErrorJuego(f"{self.nombre_de(t)} está derrotado")
        if self.en_combate(token_id):
            raise ErrorJuego(f"{self.nombre_de(t)} ya está en los turnos")
        prep = c.get("preparando")
        if prep:                                           # aún se deciden los turnos: entra en la lista de espera
            prep["participantes"].append(token_id)
            if prep.get("modo") == "manual":
                prep["orden"].append(token_id)
            elif t["tipo"] != "personaje":
                prep["tiradas"][token_id] = self._tirada_iniciativa(t)
            self.guardar_estado()
            return f"➕ {self.nombre_de(t)} entra en los turnos."
        if not c["activo"]:
            raise ErrorJuego("No hay ningún combate en curso")
        modo, valores = c.get("modo", "manual"), c.setdefault("valores", {})
        if modo == "estadistica":
            valor = self._tirada_iniciativa(t)[0]
            extra = f" (iniciativa {valor})"
        elif modo == "valor":
            valor = self.stats_efectivas(t).get(self.estadistica_iniciativa(t), 0)
            extra = f" ({valor})"
        else:
            valor, extra = None, " (al final: el GM puede moverlo)"
        if valor is None:
            pos = len(c["orden"])
        else:
            valores[token_id] = valor
            pos = next((i for i, o in enumerate(c["orden"]) if valores.get(o, float("-inf")) < valor), len(c["orden"]))
        c["orden"].insert(pos, token_id)
        if pos <= c["indice"]:
            c["indice"] += 1                               # el turno sigue siendo de quien lo tenía
        self.guardar_estado()
        return f"➕ {self.nombre_de(t)} entra en los turnos{extra}."

    def _retirar_del_combate(self, token_id: str):
        c = self.combate
        prep = c.get("preparando")
        if prep:                                          # todavía deciden los turnos: se le quita de la lista de espera
            prep["participantes"] = [i for i in prep["participantes"] if i != token_id]
            prep["tiradas"].pop(token_id, None)
            if "orden" in prep:
                prep["orden"] = [i for i in prep["orden"] if i != token_id]
        if token_id not in c["orden"]:
            return
        pos = c["orden"].index(token_id)
        c["orden"].remove(token_id)
        if pos < c["indice"]:
            c["indice"] -= 1
        if len(c["orden"]) < 2:      # un combate de un solo participante no tiene sentido
            self.terminar_combate()
        elif c["indice"] >= len(c["orden"]):
            c["indice"] = 0
            c["ronda"] += 1

    def terminar_turno(self, usuario: str, es_gm: bool) -> str:
        c = self.combate
        if not c["activo"]:
            raise ErrorJuego("No hay ningún combate en curso")
        actual = self._token(self.token_en_turno())
        if not self.puede_controlar(actual, usuario, es_gm):
            raise ErrorJuego("No es tu turno")
        self.al_terminar_turno(actual)
        n = len(c["orden"])
        for _ in range(n):
            c["indice"] += 1
            if c["indice"] >= n:
                c["indice"] = 0
                c["ronda"] += 1
            sig = self.tokens.get(c["orden"][c["indice"]])
            if sig and not self.derrotado(sig):
                break
        else:
            self.terminar_combate()
            return "🏁 Todos han sido derrotados: el combate termina."
        siguiente = self.tokens[c["orden"][c["indice"]]]
        c.setdefault("movido", {})[siguiente["id"]] = 0          # en su turno vuelve a tener todo su movimiento
        self.al_empezar_turno(siguiente)
        self.guardar_estado()
        return f"⏭️ Turno de {self.nombre_de(siguiente)}"

    # ── Dados, chat y música ─────────────────────────────────────
    _RE_DADO_SIMPLE = re.compile(r"^(\d{1,2})d(\d{1,4})\s*([+-]\s*\d{1,3})?$")

    def tirar(self, usuario: str, expresion: str, es_gm: bool = True) -> str:
        expresion = (expresion or "").strip()
        if not es_gm and not self.cfg["permisos"]["dados_personalizados"]:
            m = self._RE_DADO_SIMPLE.match(expresion)
            if not m or int(m.group(2)) not in self.cfg["juego"]["dados"]:
                raise ErrorJuego("En este servidor solo se pueden tirar los dados de la lista (d" + ", d".join(str(d) for d in self.cfg["juego"]["dados"]) + ")")
        try:
            r = formulas.evaluar(expresion, {}, None, self.rng, tablas=self.tablas())
        except formulas.FormulaError as e:
            raise ErrorJuego(f"Tirada inválida: {e}") from None
        return f"🎲 {usuario} tiró {expresion}: {r.valor}{recursos.DETALLE}{r.detalle}"

    # ── Tiradas guardadas ────────────────────────────────────────
    def tiradas_de(self, usuario: str) -> list[dict]:
        return [dict(t) for t in self.tiradas_guardadas.get(usuario, [])]

    def _buscar_tirada(self, usuario: str, nombre: str) -> dict | None:
        n = (nombre or "").strip().casefold()
        return next((t for t in self.tiradas_guardadas.get(usuario, []) if t["nombre"].casefold() == n), None)

    def guardar_tirada(self, usuario: str, nombre, expresion, es_gm: bool) -> list[dict]:
        """Guarda (o reemplaza, si ya hay una con ese nombre) una tirada del usuario: «Ataque» → 1d20 + [Fuerza]."""
        if not es_gm and not self.cfg["permisos"]["dados_personalizados"]:
            raise ErrorJuego("En este servidor solo se pueden tirar los dados de la lista")
        if not isinstance(nombre, str) or not RE_NOMBRE_TIRADA.fullmatch(nombre.strip()):
            raise ErrorJuego("El nombre de la tirada debe tener de 1 a 30 letras, números o espacios")
        if not isinstance(expresion, str) or not expresion.strip() or len(expresion) > 100:
            raise ErrorJuego("Escribe la tirada (hasta 100 caracteres), por ejemplo 1d20 + [Fuerza]")
        nombre, expresion = nombre.strip(), expresion.strip()
        errores = formulas.validar(expresion, self.cat.nombres_formula(), self.tablas())
        if errores:
            raise ErrorJuego(f"Tirada inválida: {errores[0]}")
        lista = self.tiradas_guardadas.setdefault(usuario, [])
        previa = self._buscar_tirada(usuario, nombre)
        if previa:
            previa.update(nombre=nombre, expresion=expresion)
        elif len(lista) >= MAX_TIRADAS:
            raise ErrorJuego(f"Puedes guardar como mucho {MAX_TIRADAS} tiradas")
        else:
            lista.append({"nombre": nombre, "expresion": expresion})
        self.guardar_estado()
        return self.tiradas_de(usuario)

    def borrar_tirada(self, usuario: str, nombre) -> list[dict]:
        t = self._buscar_tirada(usuario, nombre if isinstance(nombre, str) else "")
        if not t:
            raise ErrorJuego("No tienes ninguna tirada con ese nombre")
        self.tiradas_guardadas[usuario].remove(t)
        if not self.tiradas_guardadas[usuario]:
            del self.tiradas_guardadas[usuario]
        self.guardar_estado()
        return self.tiradas_de(usuario)

    def tirar_guardada(self, usuario: str, nombre: str, token: dict | None) -> str:
        """Tira una tirada guardada. Si cita estadísticas ([Fuerza]), usa las del token elegido (que el usuario debe controlar)."""
        t = self._buscar_tirada(usuario, nombre)
        if not t:
            raise ErrorJuego("No tienes ninguna tirada con ese nombre")
        usa_stats = "[" in t["expresion"]
        if usa_stats and not token:
            raise ErrorJuego(f"«{t['nombre']}» usa estadísticas: elige antes uno de tus personajes en el mapa")
        try:
            r = formulas.evaluar(t["expresion"], self.stats_planas(token) if usa_stats else {}, None, self.rng, tablas=self.tablas())
        except formulas.FormulaError as e:
            raise ErrorJuego(f"Tirada inválida: {e}") from None
        quien = f"{self.datos_de(token)['nombre']} ({usuario})" if usa_stats else usuario
        return f"🎲 {quien} tiró «{t['nombre']}»: {r.valor}{recursos.DETALLE}{r.detalle}"

    # ── Salas de chat ────────────────────────────────────────────
    def puede_ver_sala(self, usuario: str, es_gm: bool, sala: str) -> bool:
        if sala == "general" or es_gm:
            return sala == "general" or sala in self.salas_chat
        s = self.salas_chat.get(sala)
        return bool(s) and usuario.casefold() in (m.casefold() for m in s["miembros"])

    def salas_visibles(self, usuario: str, es_gm: bool) -> list[dict]:
        return [{"id": s["id"], "nombre": s["nombre"], "miembros": list(s["miembros"])}
                for s in self.salas_chat.values() if self.puede_ver_sala(usuario, es_gm, s["id"])]

    def ve_mensaje(self, m: dict, usuario: str, es_gm: bool, mapa: str | None) -> bool:
        """Un mensaje de una sala de chat privada, solo sus participantes. Uno que ocurrió en un mapa (combate, lo que dice un
        personaje…), solo quien está en esa sala; el GM lo ve todo."""
        if not self.puede_ver_sala(usuario, es_gm, m.get("sala", "general")):
            return False
        return es_gm or not m.get("mapa") or m["mapa"] == mapa

    def chat_visible(self, usuario: str, es_gm: bool, mapa: str | None = None) -> list[dict]:
        return [self.mensaje_para(m, es_gm) for m in self.chat if self.ve_mensaje(m, usuario, es_gm, mapa)]

    def hablante(self, token_id, usuario: str, es_gm: bool) -> dict:
        """Hablar en el chat como uno de tus tokens (de la sala actual): el GM, como cualquiera. → {token, nombre, imagen}."""
        t = self.tokens.get(token_id) if isinstance(token_id, str) else None
        if t is None:
            raise ErrorJuego("Ese personaje no está en esta sala")
        if not (es_gm or self.controla(t, usuario)):
            raise ErrorJuego("Solo puedes hablar como uno de tus personajes")
        d = self.datos_de(t)
        return {"token": t["id"], "nombre": d["nombre"], "imagen": d.get("imagen", "")}

    def mensaje_para(self, m: dict, es_gm: bool) -> dict:
        """El detalle de una tirada (cada dado, cada suma) lo ve el GM siempre; los jugadores, solo si la campaña lo activa."""
        if "detalle" in m and not es_gm and not self.cfg["juego"]["chat"].get("detalle_tiradas", False):
            return {k: v for k, v in m.items() if k != "detalle"}
        return m

    def _miembros_validos(self, miembros) -> list[str]:
        if not isinstance(miembros, list) or len(miembros) > 100 or not all(isinstance(m, str) and re.fullmatch(r"[\w\- ]{1,20}", m.strip()) for m in miembros):
            raise ErrorJuego("La lista de participantes no es válida")
        vistos, res = set(), []
        for m in miembros:
            m = m.strip()
            if m.casefold() not in vistos:
                vistos.add(m.casefold())
                res.append(m)
        return res

    def _nombre_sala(self, nombre, excepto: str | None = None) -> str:
        if not isinstance(nombre, str) or not (1 <= len(nombre.strip()) <= 24):
            raise ErrorJuego("El nombre de la sala debe tener entre 1 y 24 caracteres")
        nombre = nombre.strip()
        if nombre.casefold() == "general" or any(s["nombre"].casefold() == nombre.casefold() and s["id"] != excepto for s in self.salas_chat.values()):
            raise ErrorJuego("Ya existe una sala con ese nombre")
        return nombre

    def crear_sala(self, nombre, miembros) -> dict:
        if not self.cfg["juego"]["salas_chat"]:
            raise ErrorJuego("En esta mesa no hay salas de chat privadas")
        if len(self.salas_chat) >= 20:
            raise ErrorJuego("Ya hay demasiadas salas (máximo 20)")
        sala = {"id": _id(), "nombre": self._nombre_sala(nombre), "miembros": self._miembros_validos(miembros)}
        self.salas_chat[sala["id"]] = sala
        self.guardar_estado()
        return sala

    def editar_sala(self, sala_id, nombre=None, miembros=None) -> dict:
        s = self.salas_chat.get(sala_id) if isinstance(sala_id, str) else None
        if not s:
            raise ErrorJuego("Esa sala no existe")
        if nombre is not None:
            s["nombre"] = self._nombre_sala(nombre, excepto=sala_id)
        if miembros is not None:
            s["miembros"] = self._miembros_validos(miembros)
        self.guardar_estado()
        return s

    def borrar_sala(self, sala_id) -> dict:
        s = self.salas_chat.pop(sala_id, None) if isinstance(sala_id, str) else None
        if not s:
            raise ErrorJuego("Esa sala no existe")
        self.chat = [m for m in self.chat if m.get("sala", "general") != sala_id]
        self.guardar_estado()
        return s

    def limpiar_chat(self, sala_id="general") -> int:
        """El GM vacía el chat de una sala (la general o una privada) para todos. → cuántos mensajes se borraron."""
        if not isinstance(sala_id, str) or (sala_id != "general" and sala_id not in self.salas_chat):
            raise ErrorJuego("Esa sala no existe")
        antes = len(self.chat)
        self.chat = [m for m in self.chat if m.get("sala", "general") != sala_id]
        self.guardar_estado()
        return antes - len(self.chat)

    def anadir_chat(self, autor: str, texto: str, categoria: str = "normal", sala: str = "general",
                    mapa: str | None = None, personaje: dict | None = None) -> dict:
        """`mapa`: el mensaje es de esa sala (solo lo ve quien está allí, y el GM). `personaje`: lo dice uno de sus tokens."""
        texto, _, detalle = texto.partition(recursos.DETALLE)       # el detalle de la tirada va aparte: no todos lo ven
        msg = {"autor": autor, "texto": texto, "categoria": categoria}
        if detalle:
            msg["detalle"] = detalle
        if sala != "general":
            msg["sala"] = sala
        elif mapa:                    # en una sala de chat privada manda la sala de chat, no el mapa
            msg["mapa"] = mapa
        if personaje:
            msg["personaje"] = {"nombre": personaje["nombre"], "imagen": personaje.get("imagen", "")}
        self.chat.append(msg)
        del self.chat[:-self.cfg["juego"]["max_mensajes_chat"]]
        return msg

    def cambiar_musica(self, archivo: str | None):
        """`archivo` es un nombre de la lista de música de la campaña (o None para parar)."""
        if archivo is not None and (not isinstance(archivo, str) or archivo not in self.cat.archivos_sonido("musica")):
            raise ErrorJuego("Esa canción no está en la lista del servidor")
        self.musica = archivo
        self.guardar_estado()

    def cambiar_ambiente(self, archivo: str | None, activo: bool = True) -> list[str]:
        """Enciende o apaga un sonido de ambiente; con `archivo=None` apaga todos. Devuelve los que quedan sonando."""
        if archivo is None:
            self.ambiente = []
        else:
            if not isinstance(archivo, str) or archivo not in self.cat.archivos_sonido("ambiente"):
                raise ErrorJuego("Ese sonido de ambiente no está en la lista del servidor")
            if activo and archivo not in self.ambiente:
                self.ambiente.append(archivo)
            elif not activo and archivo in self.ambiente:
                self.ambiente.remove(archivo)
        self.guardar_estado()
        return list(self.ambiente)

    def asignar_sonidos(self, token_id: str, sonidos) -> list:
        """Acción de GM: qué efectos de la lista tiene asociados este token."""
        t = self._token(token_id)
        if not isinstance(sonidos, list) or not all(isinstance(n, str) and n in self.cat.archivos_sonido("efectos") for n in sonidos):
            raise ErrorJuego("Alguno de esos sonidos no está en la lista de efectos")
        d = self.datos_de(t)
        d["sonidos"] = list(dict.fromkeys(sonidos))
        self._guardar_afectados(t)
        return d["sonidos"]

    def sonido_de_personaje(self, usuario: str, es_gm: bool, token_id, archivo) -> str:
        """Un jugador lanza un sonido de SU personaje (si la mesa lo permite); el GM, el de cualquier token."""
        t = self._token(token_id)
        if not es_gm:
            if not self.cfg["permisos"]["sonidos_personaje"]:
                raise ErrorJuego("En esta mesa los jugadores no pueden lanzar los sonidos de su personaje")
            if not self.controla(t, usuario):
                raise ErrorJuego("Ese token no es tuyo")
        if not isinstance(archivo, str) or archivo not in self.datos_de(t).get("sonidos", []):
            raise ErrorJuego("Ese personaje no tiene ese sonido")
        return archivo

    def validar_efecto(self, archivo) -> str:
        if not isinstance(archivo, str) or archivo not in self.cat.archivos_sonido("efectos"):
            raise ErrorJuego("Ese efecto no está en la lista del servidor")
        return archivo

    # ── Vistas para el cliente ───────────────────────────────────
    def campos_visibles(self, t: dict, usuario: str) -> set:
        """Qué datos de un token AJENO ve este jugador: lo que la mesa deja ver de jugadores o de NPC, más lo que el GM
        haya revelado en ese token. Si el propietario le bloqueó la visión, nada (salvo nombre, imagen y posición)."""
        if not self.cuenta_permite(usuario, "ver_ajenos"):
            return set()
        base = self.cfg["visibilidad"]["jugadores" if t["tipo"] == "personaje" else "npc"]
        return {k for k, on in base.items() if on} | set(t.get("revelado") or [])

    def mostrar_sobre_token(self, t: dict) -> dict:
        """¿Los demás ven las barras y el nombre de este token sobre el mapa? Lo que diga la mesa, salvo que el GM lo cambie en el token."""
        st = self.cfg["visibilidad"]["sobre_tokens"]
        quien = "jugadores" if t["tipo"] == "personaje" else "npc"
        propio = t.get("mostrar") if isinstance(t.get("mostrar"), dict) else {}
        return {k: propio[k] if isinstance(propio.get(k), bool) else st[f"{k}_{quien}"] for k in ("barras", "nombre")}

    def fijar_mostrar(self, token_id: str, barras=_SIN_VALOR, nombre=_SIN_VALOR) -> dict:
        """Acción de GM: en este token, los demás ven (True) o no (False) sus barras / su nombre; None = lo que diga la mesa."""
        t = self._token(token_id)
        m = dict(t.get("mostrar") or {})
        for k, val in (("barras", barras), ("nombre", nombre)):
            if val is _SIN_VALOR:
                continue
            if val is not None and not isinstance(val, bool):
                raise ErrorJuego("Valor no válido")
            if val is None:
                m.pop(k, None)
            else:
                m[k] = val
        if m:
            t["mostrar"] = m
        else:
            t.pop("mostrar", None)
        self.guardar_estado()
        return self.mostrar_sobre_token(t)

    def revelar_token(self, token_id: str, campos) -> list:
        """Acción de GM: muestra (o vuelve a ocultar) a todos los jugadores datos concretos de un token."""
        t = self._token(token_id)
        if not isinstance(campos, list) or any(c not in CAMPOS_REVELABLES for c in campos):
            raise ErrorJuego("Esos datos no se pueden revelar")
        t["revelado"] = [c for c in CAMPOS_REVELABLES if c in campos]
        self.guardar_estado()
        return t["revelado"]

    def vista_token(self, t: dict, usuario: str, es_gm: bool) -> dict:
        if self.recalcular_maximos(t):                  # máximos calculados al día (un objeto equipado, un estado que acaba…)
            self.guardar_jugador(t["dueno"])
        d = self.datos_de(t)
        vida = self.cat.recurso_vida()
        completo = es_gm or self.controla(t, usuario)
        ver = CAMPOS_REVELABLES if completo else self.campos_visibles(t, usuario)
        mostrar = self.mostrar_sobre_token(t)
        if completo or "recursos" in ver:
            recursos = copy.deepcopy(d["recursos"])
        elif self.cuenta_permite(usuario, "ver_ajenos"):
            recursos = {vida: copy.deepcopy(d["recursos"][vida])}          # la vida se ve siempre (salvo visión bloqueada)
            if mostrar["barras"]:                                          # y los recursos que la mesa muestra como barra
                for r in self.cfg["visibilidad"]["sobre_tokens"]["barras"]:
                    if r in d["recursos"]:
                        recursos[r] = copy.deepcopy(d["recursos"][r])
        else:
            recursos = {}
        v = {"id": t["id"], "tipo": t["tipo"], "nombre": d["nombre"], "imagen": d["imagen"],
             "x": t["x"], "y": t["y"], "dueno": t["dueno"], "derrotado": self.derrotado(t),
             "personaje": t.get("personaje_id"), "recursos": recursos}
        v["bando"] = self.bando_de(t)
        if not completo:
            v["mostrar"] = mostrar                     # si los demás ven sus barras y su nombre sobre el mapa
        elif t.get("mostrar"):
            v["mostrar_propio"] = dict(t["mostrar"])   # el GM (y su dueño) ven qué se ha cambiado en este token
        if t.get("escala", 1) != 1:
            v["escala"] = t["escala"]
        if t.get("grupo"):
            v["grupo"] = t["grupo"]
        if t["tipo"] == "enemigo" and t.get("controlado_por") and self.npc_asignables():
            v["controlado_por"] = t["controlado_por"]
        v["estados"] = [{"id": e["id"], "turnos": e["turnos"], **({"cargas": e["cargas"]} if isinstance(e.get("cargas"), int) and e["cargas"] > 1 else {})} for e in self.estados_de(t)]
        if es_gm:
            v["revelado"] = list(t.get("revelado") or [])
            if t["tipo"] == "enemigo" and self.cfg["juego"]["niveles"]["activo"]:
                v["cede"] = self.experiencia_que_cede(t)              # experiencia que cede al caer (el GM puede cambiarla por token)
        if completo or "estadisticas" in ver:
            v.update(stats=self.stats_efectivas(t), stats_base=copy.deepcopy(d["stats"]), bonos=self.bonos_de(t))
            if self.cfg["juego"]["niveles"]["activo"]:
                v["nivel"] = self.nivel_de(t)
                if t["tipo"] == "personaje":
                    v["experiencia"] = self.experiencia_de(d)
        if completo or "habilidades" in ver:
            v["habilidades"] = list(d["habilidades"])
            v["habilidades_propias"] = copy.deepcopy((d.get("propias") or {}).get("habilidades", []))
        if completo or "inventario" in ver:
            v["inventario"] = copy.deepcopy(d["inventario"])
            v["dinero"] = d.get("dinero", 0)
            v["objetos_propios"] = copy.deepcopy((d.get("propias") or {}).get("objetos", []))
        if completo or "ficha" in ver:
            v.update(elecciones=dict(d.get("elecciones") or {}), rasgos=self.rasgos_de(d), personalidad=list(d.get("personalidad") or []),
                     etiquetas=self.etiquetas_de(t))
        if completo:
            v["puntos_pendientes"] = d.get("puntos_pendientes", 0)
            if self.cfg["juego"]["niebla"]["activa"]:
                v["vision"] = self.vision_de(t)
            v["sonidos"] = list(d.get("sonidos", []))
        if (completo or "ficha" in ver) and t["tipo"] == "personaje":
            privados = {c["nombre"] for c in self.cfg["juego"]["campos_ficha"] if c["privado"]}
            v["campos"] = {k: val for k, val in (d.get("campos") or {}).items() if completo or k not in privados}
            v["imagen_biografia"] = d.get("imagen_biografia", "")
            v["historia"] = d.get("historia", "")
        return v

    def vista_combate(self, usuario: str | None = None, es_gm: bool = True) -> dict:
        """El combate tal como lo ve este usuario: con niebla de guerra, los NPC que no ve no aparecen en el orden de iniciativa."""
        c = self.combate
        orden, turno = list(c["orden"]), self.token_en_turno()
        if self.niebla_activa() and not es_gm and usuario is not None:
            visibles = {i for i in orden if i in self.tokens and self.puede_ver(self.tokens[i], usuario, False)}
            orden = [i for i in orden if i in visibles]
            if turno not in visibles:
                turno = None
        res = {"activo": c["activo"], "orden": orden, "indice": c["indice"], "ronda": c["ronda"], "turno_de": turno}
        p = c.get("preparando")
        if p:     # decidiendo turnos: quién participa (lo que este usuario ve) y lo que ya ha sacado cada uno
            ven = [i for i in p["participantes"] if i in self.tokens and (es_gm or usuario is None or self.puede_ver(self.tokens[i], usuario, False))]
            res["preparando"] = {"modo": p.get("modo", "tirada"), "participantes": ven, "tiradas": {i: p["tiradas"][i][0] for i in ven if i in p["tiradas"]}}
            if p.get("modo") == "manual":
                res["preparando"]["orden"] = [i for i in p["orden"] if i in ven]
        en_turno = self.tokens.get(self.token_en_turno() or "")
        if c["activo"] and en_turno and self.movimiento_max(en_turno) is not None:
            res["movimiento"] = {"token": en_turno["id"], "max": self.movimiento_max(en_turno), "quedan": self.movimiento_restante(en_turno)}
        return res

    def snapshot(self, usuario: str, es_gm: bool) -> dict:
        return {
            "mapa_id": self.mapa_id,
            "salas_mapa": self.vista_salas(es_gm, self.mapa_id),
            "mapa": self.mapa_vivo,
            "tokens": [self.vista_token(t, usuario, es_gm) for t in self.tokens.values() if self.puede_ver(t, usuario, es_gm)],
            "combate": self.vista_combate(usuario, es_gm),
            "chat": self.chat_visible(usuario, es_gm, self.mapa_id),
            "salas": self.salas_visibles(usuario, es_gm),
            "tiendas": self.vista_tiendas(),
            "musica": self.musica,
            "ambiente": list(self.ambiente),
            "periodo": self.periodo,
            "clima": self.clima,
            "capas_ocultas": list(self.capas_ocultas),
            "niebla": self.mascara_niebla(usuario, es_gm),
            "niebla_activa": self.niebla_activa(),
            "dibujos": list(self.dibujos),
            "dibujo_bloqueado": self.dibujo_bloqueado,
        }

    # ── Persistencia ─────────────────────────────────────────────
    def _volcar(self, ruta: Path, datos: dict):
        if not self.persistir:
            return
        ruta.parent.mkdir(parents=True, exist_ok=True)
        tmp = ruta.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            yaml.dump(datos, f, Dumper=_Dumper, allow_unicode=True, sort_keys=False)
        tmp.replace(ruta)

    def guardar_jugador(self, usuario: str):
        self._volcar(self.datos_dir / "jugadores" / _archivo_usuario(usuario),
                     {"usuario": usuario, "personajes": self.personajes.get(usuario, [])})

    def _leer_jugador(self, usuario: str) -> list[dict]:
        ruta = self.datos_dir / "jugadores" / _archivo_usuario(usuario)
        if not ruta.is_file():
            return []
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                datos = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError):
            return []
        res, vistos = [], set()
        for p in (datos.get("personajes") if isinstance(datos.get("personajes"), list) else []):
            limpio = self._sanear_personaje(p, usuario)
            if limpio and limpio["id"] not in vistos:
                vistos.add(limpio["id"])
                res.append(limpio)
        return res

    def _sanear_personaje(self, p, usuario: str) -> dict | None:
        """Un personaje leído del disco puede venir del Editor o de un archivo editado a mano: se comprueba todo y lo que
        no encaje con la campaña se corrige o se descarta, para que un dato malo nunca rompa la partida."""
        if not isinstance(p, dict) or not isinstance(p.get("id"), (str, int)) or not str(p.get("nombre") or "").strip():
            return None
        entero = lambda v, d=0: v if isinstance(v, int) and not isinstance(v, bool) else d
        definidas = {e["nombre"]: e for e in self.cfg["juego"]["estadisticas"]}
        el = p.get("elecciones") if isinstance(p.get("elecciones"), dict) else {}
        elecciones = {g: o for g, o in el.items() if g in self.cat.grupos and o in self.cat.opciones and self.cat.opciones[o]["grupo"] == g}
        stats = {}
        base = self.cat.stats_base(elecciones)
        crudo = p.get("stats") if isinstance(p.get("stats"), dict) else {}
        for k, e in definidas.items():
            if k in crudo or k in base:
                stats[k] = max(e["minimo"], min(e["maximo"], entero(crudo.get(k), base.get(k, e["valor_inicial"]))))
        defrec = {r["nombre"]: r for r in self.cfg["juego"]["recursos"]}
        rbase = self.cat.recursos_base(elecciones)
        rcrudo = p.get("recursos") if isinstance(p.get("recursos"), dict) else {}
        recursos = {}
        for k, r in defrec.items():
            if k not in rcrudo and k not in rbase:
                continue
            d = rcrudo.get(k) if isinstance(rcrudo.get(k), dict) else {}
            mx = max(1 if k == self.cat.recurso_vida() else 0, entero(d.get("max"), rbase.get(k, r["maximo_inicial"])))
            recursos[k] = {"actual": max(0, min(mx, entero(d.get("actual"), mx))), "max": mx}
        habilidades = [h for h in (p.get("habilidades") if isinstance(p.get("habilidades"), list) else []) if h in self.cat.habilidades]
        inventario = []
        for e in (p.get("inventario") if isinstance(p.get("inventario"), list) else []):
            if isinstance(e, dict) and e.get("objeto") in self.cat.objetos:
                inventario.append({"objeto": e["objeto"], "cantidad": max(1, entero(e.get("cantidad"), 1)),
                                   **({"equipado": True} if e.get("equipado") is True else {})})
        res = {**p, "id": str(p["id"]), "nombre": str(p["nombre"]).strip()[:30], "dueno": usuario,
                "base": p["base"] if isinstance(p.get("base"), str) else "", "imagen": p["imagen"] if isinstance(p.get("imagen"), str) else "",
                "imagen_biografia": nombre_imagen(p.get("imagen_biografia")),
                **({"imagen_propia": nombre_imagen(p["imagen_propia"])} if isinstance(p.get("imagen_propia"), str) else {}),
                "historia": str(p.get("historia") or "")[:MAX_HISTORIA], "elecciones": elecciones,
                "puntos_pendientes": max(0, entero(p.get("puntos_pendientes"))),
                "nivel": max(1, min(MAX_NIVEL, entero(p.get("nivel"), 1))),
                "propias": normalizar_propias(p.get("propias")),
                "personalidad": [r.strip()[:30] for r in (p.get("personalidad") if isinstance(p.get("personalidad"), list) else []) if isinstance(r, str) and r.strip()][:8],
                "stats": stats, "recursos": recursos, "habilidades": habilidades, "inventario": inventario,
                "dinero": max(0, min(10 ** 9, entero(p.get("dinero"), 0))),
                "sonidos": [n for n in (p.get("sonidos") if isinstance(p.get("sonidos"), list) else []) if isinstance(n, str) and n in self.cat.archivos_sonido("efectos")]}
        res["campos"] = self.campos_limpios(p.get("campos"), {}, True, estricto=False)
        res.pop("companero_de", None)                 # de una versión anterior: ahora un compañero es un personaje más
        return res

    # ── Diario ───────────────────────────────────────────────────
    def visibilidad_pagina(self, pid: str) -> dict:
        p = self.cat.diario[pid]
        return self.diario_vis.get(pid) or {"visible": p["visible"], "jugadores": list(p["jugadores"])}

    def ve_pagina(self, pid: str, usuario: str, es_gm: bool) -> bool:
        if es_gm:
            return True
        v = self.visibilidad_pagina(pid)
        return v["visible"] == "todos" or usuario in v["jugadores"]

    def paginas_para(self, usuario: str, es_gm: bool) -> list[dict]:
        """Las páginas del diario que puede leer este usuario (el GM las ve todas, con su visibilidad)."""
        res = []
        for pid, p in self.cat.diario.items():
            if not self.ve_pagina(pid, usuario, es_gm):
                continue
            d = {"id": pid, "nombre": p["nombre"], "seccion": p["seccion"], "texto": p["texto"], "imagen": p["imagen"]}
            if es_gm:
                d.update(self.visibilidad_pagina(pid))
            res.append(d)
        return res

    def fijar_visibilidad_pagina(self, pid, visible, jugadores) -> str:
        """El GM revela u oculta una página en plena partida: «todos», «oculta» (y, si está oculta, la pueden ver algunos jugadores)."""
        if pid not in self.cat.diario:
            raise ErrorJuego("Esa página no existe")
        if visible not in ("todos", "oculta"):
            raise ErrorJuego("Visibilidad no válida")
        if not isinstance(jugadores, list) or len(jugadores) > 50 or not all(isinstance(u, str) and 0 < len(u) <= 40 for u in jugadores):
            raise ErrorJuego("Lista de jugadores no válida")
        self.diario_vis[pid] = {"visible": visible, "jugadores": list(dict.fromkeys(jugadores)) if visible == "oculta" else []}
        self.guardar_estado()
        return self.cat.diario[pid]["nombre"]

    def _campos_simples(self) -> dict:
        """Los datos de la partida que se guardan tal cual en estado.yaml: clave → (atributo, validador al cargar).
        El validador devuelve el valor a poner, o _SIN_VALOR para dejar el que ya hay. Añadir un dato nuevo (viento, luna…) = una fila aquí
        (más su aviso a los clientes en la vista); ya no hay que acordarse de tocar guardar y cargar por separado."""
        sonido = self.cat.archivos_sonido
        return {
            "musica": ("musica", lambda v: v if isinstance(v, str) and v in sonido("musica") else None),
            "ambiente": ("ambiente", lambda v: [a for a in (v if isinstance(v, list) else []) if isinstance(a, str) and a in sonido("ambiente")]),
            "periodo": ("periodo", lambda v: _indice_en(v, len(self.cfg["juego"]["ciclo"]["periodos"]))),
            "clima": ("clima", lambda v: _indice_en(v, len(self.cfg["juego"]["clima"]["tipos"]))),
        }

    def guardar_estado(self):
        self._volcar(self.datos_dir / "estado.yaml", {
            "mapa": self.mapa_principal,
            "salas": {m: {"tokens": list(d["tokens"].values()), "combate": d["combate"],
                          **({"niebla": d["niebla_gm"]} if d["niebla_gm"] is not None else {})}
                      for m, d in self.salas.items() if d["tokens"] or d["niebla_gm"] is not None or d["combate"]["activo"]},
            "salas_cerradas": sorted(self.salas_cerradas),
            "chat": self.chat, "salas_chat": list(self.salas_chat.values()), "tiendas": {"abiertas": self.tiendas_abiertas, "stock": self.stock_tienda}, **{clave: getattr(self, atributo) for clave, (atributo, _) in self._campos_simples().items()},
            "casillas": self.cambios_casillas, "objetos_golpeados": self.objetos_golpeados, "diario": self.diario_vis, "tiradas": self.tiradas_guardadas, "cofres": self.cofres,
        })

    def _casillas_validas(self, crudo) -> dict:
        """Casillas rotas guardadas: solo se conservan las que siguen teniendo sentido con los mapas y tiles actuales."""
        res: dict[str, dict] = {}
        if not isinstance(crudo, dict):
            return res
        for mid, lista in crudo.items():
            m = self.cat.mapas.get(mid)
            if not m or not isinstance(lista, dict):
                continue
            for k, c in lista.items():
                try:
                    x, y = (int(n) for n in str(k).split(","))
                except ValueError:
                    continue
                if not (isinstance(c, dict) and 0 <= x < m["ancho"] and 0 <= y < m["alto"]):
                    continue
                nuevo = {}
                if isinstance(c.get("tile"), str) and (c["tile"] == "" or c["tile"] in self.cat.tiles):
                    nuevo["tile"] = c["tile"]
                if isinstance(c.get("golpes"), int) and c["golpes"] >= 0:
                    nuevo["golpes"] = c["golpes"]
                if nuevo:
                    res.setdefault(mid, {})[f"{x},{y}"] = nuevo
        return res

    def _cargar_sala(self, sd: dict, vistos: set):
        """Tokens, combate y niebla guardados de la sala actual. `vistos`: tokens y personajes ya colocados en otra sala (no se repiten)."""
        for t in sd.get("tokens") or []:
            if not isinstance(t, dict) or "id" not in t or t.get("tipo") not in ("personaje", "enemigo") or t["id"] in vistos:
                continue
            if t["tipo"] == "personaje":
                self.registrar_usuario(t.get("dueno", ""))
                if not self.buscar_personaje(t.get("dueno", ""), t.get("personaje_id", "")):
                    continue
                clave = f"pj:{t.get('dueno')}:{t.get('personaje_id')}"
                if clave in vistos:
                    continue
                vistos.add(clave)
            elif t.get("base") not in self.cat.enemigos:
                continue
            t["revelado"] = [c for c in CAMPOS_REVELABLES if isinstance(t.get("revelado"), list) and c in t["revelado"]]
            if t.get("escala") not in self.ESCALAS or isinstance(t.get("escala"), bool) or t.get("escala") == 1:
                t.pop("escala", None)
            if not (isinstance(t.get("grupo"), str) and 0 < len(t["grupo"]) <= 40):
                t.pop("grupo", None)
            t["estados"] = [e for e in t.get("estados", []) if isinstance(e, dict) and e.get("id") in self.cat.estados]
            m = {k: b for k, b in (t.get("mostrar") or {}).items() if k in ("barras", "nombre") and isinstance(b, bool)} if isinstance(t.get("mostrar"), dict) else {}
            if m:
                t["mostrar"] = m
            else:
                t.pop("mostrar", None)
            if isinstance(t.get("x"), int) and isinstance(t.get("y"), int) and self.casilla_transitable(t["x"], t["y"]):
                self.tokens[t["id"]] = t
                vistos.add(t["id"])
        c = sd.get("combate") or {}
        orden = [i for i in c.get("orden", []) if i in self.tokens] if isinstance(c, dict) else []
        if isinstance(c, dict) and c.get("activo") and len(orden) >= 2:
            mov = c.get("movido") if isinstance(c.get("movido"), dict) else {}
            self.combate = {"activo": True, "orden": orden,
                            "indice": min(int(c.get("indice", 0)), len(orden) - 1),
                            "ronda": int(c.get("ronda", 1)),
                            "movido": {i: n for i, n in mov.items() if i in orden and isinstance(n, int) and not isinstance(n, bool) and n >= 0},
                            "modo": c.get("modo") if c.get("modo") in recursos.MODOS_INICIATIVA else "manual",
                            "valores": {i: v for i, v in (c.get("valores") or {}).items() if i in orden and isinstance(v, (int, float)) and not isinstance(v, bool)}
                            if isinstance(c.get("valores"), dict) else {}}
        if isinstance(sd.get("niebla"), bool):
            self.niebla_gm = sd["niebla"]

    def cargar_estado(self):
        """Restaura la partida guardada. Ignora lo que ya no sea válido."""
        ruta = self.datos_dir / "estado.yaml"
        if not ruta.is_file():
            return
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                datos = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError):
            return
        self.cambios_casillas = self._casillas_validas(datos.get("casillas"))
        crudo = datos.get("objetos_golpeados") if isinstance(datos.get("objetos_golpeados"), dict) else {}
        # Solo se conservan los golpes de objetos que siguen existiendo (misma huella) y que se pueden romper.
        self.objetos_golpeados = {}
        for mid, v in crudo.items():
            if mid not in self.cat.mapas or not isinstance(v, dict):
                continue
            validas = {self.huella_objeto(o) for o in self.cat.mapas[mid]["objetos"] if o.get("destruible")}
            limpio = {k: g for k, g in v.items() if k in validas and isinstance(g, int) and not isinstance(g, bool) and g >= -1}
            if limpio:
                self.objetos_golpeados[mid] = limpio
        if "cofres" in datos:                 # lo que el GM dejó (si borró el común, sigue borrado)
            self.cofres = self.cofres_validos(datos.get("cofres"))
        tg = datos.get("tiradas") if isinstance(datos.get("tiradas"), dict) else {}
        for u, lista in tg.items():
            if isinstance(u, str) and isinstance(lista, list):
                ok = [{"nombre": t["nombre"], "expresion": t["expresion"]} for t in lista[:MAX_TIRADAS]
                      if isinstance(t, dict) and isinstance(t.get("nombre"), str) and RE_NOMBRE_TIRADA.fullmatch(t["nombre"])
                      and isinstance(t.get("expresion"), str) and 0 < len(t["expresion"]) <= 100]
                if ok:
                    self.tiradas_guardadas[u] = ok
        dv = datos.get("diario") if isinstance(datos.get("diario"), dict) else {}
        for pid, x in dv.items():
            if pid in self.cat.diario and isinstance(x, dict) and x.get("visible") in ("todos", "oculta"):
                self.diario_vis[pid] = {"visible": x["visible"], "jugadores": [u for u in x.get("jugadores") or [] if isinstance(u, str)][:50]}
        if datos.get("mapa") in self.cat.mapas:
            self.mapa_principal = self.mapa_id = datos["mapa"]
        self.salas_cerradas = {m for m in (datos.get("salas_cerradas") or []) if isinstance(m, str) and m in self.cat.mapas}
        crudas = datos.get("salas") if isinstance(datos.get("salas"), dict) else None
        if crudas is None:            # partida guardada antes de las salas: un solo mapa con sus tokens, su combate y su niebla
            crudas = {self.mapa_principal: {"tokens": datos.get("tokens", []), "combate": datos.get("combate"),
                                            "niebla": datos.get("niebla")}}
        vistos: set[str] = set()
        for mid, sd in crudas.items():
            if mid not in self.cat.mapas or not isinstance(sd, dict):
                continue
            with self.en_sala(mid):
                self._cargar_sala(sd, vistos)
        self.usar_sala(self.mapa_principal)
        td = datos.get("tiendas") if isinstance(datos.get("tiendas"), dict) else {}
        self.tiendas_abiertas = [i for i in (td.get("abiertas") or []) if isinstance(i, str) and i in self.cat.tiendas]
        st = td.get("stock") if isinstance(td.get("stock"), dict) else {}
        self.stock_tienda = {i: {o: n for o, n in v.items() if isinstance(o, str) and isinstance(n, int) and not isinstance(n, bool) and n >= 0}
                             for i, v in st.items() if i in self.cat.tiendas and isinstance(v, dict)}
        for sd in datos.get("salas_chat") or []:
            try:
                if isinstance(sd, dict) and isinstance(sd.get("id"), str):
                    self.salas_chat[sd["id"]] = {"id": sd["id"], "nombre": self._nombre_sala(sd.get("nombre"), excepto=sd["id"]),
                                                 "miembros": self._miembros_validos(sd.get("miembros") or [])}
            except ErrorJuego:
                continue
        self.chat = [m for m in datos.get("chat", []) if isinstance(m, dict) and m.get("sala", "general") in ("general", *self.salas_chat)
                     and (not m.get("mapa") or m["mapa"] in self.cat.mapas)][-self.cfg["juego"]["max_mensajes_chat"]:]
        for clave, (atributo, validar) in self._campos_simples().items():
            valor = validar(datos.get(clave))
            if valor is not _SIN_VALOR:
                setattr(self, atributo, valor)
