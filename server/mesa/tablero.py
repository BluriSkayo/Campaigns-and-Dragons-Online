"""tablero.py — El tablero de la sala actual: mapa, tiles y objetos, casillas que se rompen, paso entre casillas y caminos.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from . import recursos
from .errores import ErrorJuego


class TableroMixin:
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
        m = self.mapa
        if not (0 <= x < m["ancho"] and 0 <= y < m["alto"]):
            return None
        c = self._celdas[y][x]
        return self.cat.tiles.get(c) if c else None

    def casilla_transitable(self, x: int, y: int) -> bool:
        m = self.mapa
        if not (0 <= x < m["ancho"] and 0 <= y < m["alto"]):
            return False
        tile = self.tile_en(x, y)
        if tile and not tile["transitable"]:
            return False
        return (x, y) not in self._bloqueadas

    # ── Casillas y objetos que se rompen; paso entre casillas ──
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

    # ── Mapa actual y capas ──────────────────────────────────
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

    @staticmethod
    def distancia(a: dict, b: dict) -> int:
        return max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"]))
