"""ambiente.py — Ambiente de la partida: momento del día, clima, música, sonidos de ambiente y sonidos de los personajes.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from .errores import ErrorJuego


class AmbienteMixin:
    # ── Momento del día y clima ──────────────────────────────
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

    # ── Música y sonidos ─────────────────────────────────────
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
