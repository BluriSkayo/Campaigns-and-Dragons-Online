"""salas.py — Salas: cada mapa de la campaña es una sala con sus tokens, combate, dibujos y niebla; «la sala actual».

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from contextlib import contextmanager

from .errores import ErrorJuego


class SalasMixin:
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
