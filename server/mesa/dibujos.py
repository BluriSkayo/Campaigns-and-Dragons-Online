"""dibujos.py — Regla y dibujos temporales sobre el mapa (no se guardan).

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

import math

from .errores import ErrorJuego
from .utiles import nuevo_id


COLORES_DIBUJO = ("#f0b44c", "#c4533f", "#6fb7a8", "#4f8fd1", "#b07ad9", "#e8ecf4", "#7ac74f")
MAX_PUNTOS_TRAZO, MAX_TRAZOS = 300, 400
GROSOR_DIBUJO = (1.0, 24.0, 4.0)            # lápiz: mínimo, máximo y el de siempre (en píxeles de pantalla)
RADIO_BORRADOR = (0.1, 3.0)                 # borrador: mínimo y máximo, en casillas
MAX_CENTROS_BORRADOR = 120                  # posiciones del borrador que caben en un solo mensaje


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


class DibujosMixin:
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
        d = {"id": nuevo_id(), "usuario": usuario, "color": color if color in COLORES_DIBUJO else COLORES_DIBUJO[0],
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
                    siguiente += [{**d, "id": nuevo_id(), "puntos": t} for t in trozos]
            vigentes = siguiente
        del vigentes[:-MAX_TRAZOS]          # recortar puede multiplicar los trazos: se respeta el tope antes de avisar a nadie
        ids_vigentes = {d["id"] for d in vigentes}
        borrados = [i for i in originales if i not in ids_vigentes]
        nuevos = [d for d in vigentes if d["id"] not in originales]
        if borrados or nuevos:
            self.dibujos = vigentes
        return borrados, nuevos
