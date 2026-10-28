"""niebla.py — Niebla de guerra: qué casillas ve cada jugador y qué tokens le llegan.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from contextlib import contextmanager

from . import recursos

MAX_CAMPOS_GUARDADOS = 4096      # campos de visión (x, y, radio) que se recuerdan por versión del terreno


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


class NieblaMixin:
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

    @contextmanager
    def lectura(self):
        """Mientras el servidor prepara lo que envía (sin cambiar la partida), lo que ve cada jugador se calcula una sola vez
        en lugar de una por cada token que se revisa. Solo es válido si dentro no cambia nada: el servidor lo usa al difundir."""
        anterior = self._memo_vision
        if anterior is None:
            self._memo_vision = {}
        try:
            yield
        finally:
            self._memo_vision = anterior

    def _campo(self, x: int, y: int, r: int, opacas: set) -> frozenset:
        """campo_de_vision con memoria: el mismo token en la misma casilla y con la misma visión ve lo mismo mientras no cambie el terreno
        (con la visión compartida, todos los jugadores piden los mismos campos)."""
        clave = (self.mapa_id, self._version_opacas, x, y, r)
        c = self._campos_vision.get(clave)
        if c is None:
            if len(self._campos_vision) >= MAX_CAMPOS_GUARDADOS:
                self._campos_vision.clear()
            c = self._campos_vision[clave] = frozenset(campo_de_vision(x, y, r, opacas, self.mapa["ancho"], self.mapa["alto"]))
        return c

    def visibles_para(self, usuario: str) -> set[tuple[int, int]]:
        """Casillas que ve un jugador: lo que alcanza la visión de sus personajes (y, si la mesa lo permite, la de los demás jugadores).
        Se guarda el último resultado mientras nadie se mueva ni cambie su visión (el servidor lo pide muchas veces por mensaje)."""
        memo = self._memo_vision
        if memo is not None:
            hecho = memo.get(("ve", usuario, self.mapa_id))
            if hecho is not None:
                return hecho
            res = self._visibles_para(usuario)
            memo[("ve", usuario, self.mapa_id)] = res
            return res
        return self._visibles_para(usuario)

    def _vision(self, t: dict) -> int:
        """vision_de, una sola vez por token mientras se difunde (con la visión compartida, todos los jugadores miran los mismos tokens)."""
        memo = self._memo_vision
        if memo is None:
            return self.vision_de(t)
        clave = ("vision", t["id"])
        if clave not in memo:
            memo[clave] = self.vision_de(t)
        return memo[clave]

    def _visibles_para(self, usuario: str) -> set[tuple[int, int]]:
        compartir = self.cfg["juego"]["niebla"]["compartir"]
        origenes = [t for t in self.tokens.values() if t.get("x", -1) >= 0
                    and ((t["tipo"] == "personaje" and compartir) or self.controla(t, usuario))]
        if not origenes:
            return set()
        opacas = self._opacas()
        base = [(t["x"], t["y"], self._vision(t)) for t in origenes]
        firma = (self._version_opacas, self.mapa_id, tuple(base))
        c = self._cache_vision.get((usuario, self.mapa_id))
        if c and c[0] == firma:
            return c[1]
        res: set[tuple[int, int]] = set()
        for x, y, r in base:
            res |= self._campo(x, y, r, opacas)
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
