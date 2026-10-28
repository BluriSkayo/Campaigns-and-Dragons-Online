"""acciones_mapa.py — Acciones sobre el mapa: regla, señales, dibujos, mover y escalar tokens, romper casillas, niebla, capas y salas.

Parte de `Servidor` (ver servidor.py). Cada manejador recibe (ws, sesión, mensaje) y se registra con
@accion("tipo de mensaje"): para una acción nueva basta con escribirla aquí (o en un archivo nuevo de manejadores)."""

from __future__ import annotations

import time

from .errores import ErrorJuego
from .protocolo import entero_de, texto_de, accion


class AccionesMapa:
    @accion("regla")
    async def _regla(self, ws, s, msg):
        """La medición con la regla la ven los demás mientras dura (no se guarda). `puntos: null` = terminó."""
        puntos = msg.get("puntos")
        if puntos is not None:
            ahora = time.monotonic()
            if ahora - s.ultima_regla < 0.04:          # como mucho ~25 por segundo por jugador
                return
            s.ultima_regla = ahora
            puntos = self.estado.puntos_validos(puntos, 32, entero=True)
        if not s.es_gm and not self.cfg["permisos"]["regla_visible"]:
            return
        await self._difundir_sala({"tipo": "regla", "usuario": s.usuario, "puntos": puntos}, excepto=ws)

    @accion("ping")
    async def _ping(self, ws, s, msg):
        """Marca una casilla para que todos la miren un momento (no se guarda). Como mucho uno por segundo y persona."""
        if not s.es_gm and not self.cfg["permisos"]["ping"]:
            raise ErrorJuego("En esta mesa los jugadores no pueden señalar casillas")
        ahora = time.monotonic()
        if ahora - s.ultimo_ping < 1.0:
            return
        x, y, m = msg.get("x"), msg.get("y"), self.estado.mapa
        if any(isinstance(v, bool) or not isinstance(v, int) for v in (x, y)) or not (0 <= x < m["ancho"] and 0 <= y < m["alto"]):
            raise ErrorJuego("Casilla no válida")
        s.ultimo_ping = ahora
        await self._difundir_sala({"tipo": "ping", "usuario": s.usuario, "x": x, "y": y})

    @accion("lapiz")
    async def _lapiz(self, ws, s, msg):
        """Mientras alguien dibuja, los demás ven su lápiz con su nombre (no se guarda). Como mucho ~15 por segundo."""
        if not s.es_gm and (not self.cfg["permisos"]["dibujar"] or self.estado.dibujo_bloqueado):
            return
        if msg.get("fin"):
            m = {"tipo": "lapiz", "usuario": s.usuario, "fin": True}
        else:
            ahora = time.monotonic()
            if ahora - s.ultimo_lapiz < 0.06:
                return
            s.ultimo_lapiz = ahora
            x, y, mp = msg.get("x"), msg.get("y"), self.estado.mapa
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in (x, y)) or not (0 <= x <= mp["ancho"] and 0 <= y <= mp["alto"]):
                return
            m = {"tipo": "lapiz", "usuario": s.usuario, "x": round(float(x), 2), "y": round(float(y), 2)}
        await self._difundir_sala(m, excepto=ws)

    @accion("dibujar")
    async def _dibujar(self, ws, s, msg):
        d = self.estado.anadir_dibujo(s.usuario, s.es_gm, msg.get("color"), msg.get("puntos"), msg.get("grosor"))
        await self._difundir_sala({"tipo": "dibujo", "dibujo": d})

    @accion("borrar_zona")
    async def _borrar_zona(self, ws, s, msg):
        """Borrador: quita solo el trozo de trazo que toca (centros = recorrido del borrador, radio en casillas)."""
        borrados, nuevos = self.estado.borrar_zona(s.usuario, s.es_gm, msg.get("centros"), msg.get("radio"))
        if borrados:
            await self._difundir_sala({"tipo": "dibujos_borrados", "ids": borrados})
        for d in nuevos:
            await self._difundir_sala({"tipo": "dibujo", "dibujo": d})

    @accion("borrar_dibujo")
    async def _borrar_dibujo(self, ws, s, msg):
        ids = msg.get("ids")
        if not isinstance(ids, list):
            raise ErrorJuego("Datos no válidos")
        borrados = self.estado.borrar_dibujos(s.usuario, s.es_gm, ids=ids)
        if borrados:
            await self._difundir_sala({"tipo": "dibujos_borrados", "ids": borrados})

    @accion("gm_borrar_dibujos")
    async def _gm_borrar_dibujos(self, ws, s, msg):
        de = msg.get("usuario")
        borrados = self.estado.borrar_dibujos(s.usuario, True, de_usuario=de if isinstance(de, str) else None)
        await self._difundir_sala({"tipo": "dibujos_borrados", "ids": borrados})

    @accion("gm_bloquear_dibujo")
    async def _gm_bloquear_dibujo(self, ws, s, msg):
        self.estado.dibujo_bloqueado = bool(msg.get("activo"))
        await self._difundir({"tipo": "dibujo_bloqueo", "activo": self.estado.dibujo_bloqueado})

    @accion("mover_token")
    async def _mover_token(self, ws, s, msg):
        t = self.estado.mover_token(texto_de(msg, "token"), entero_de(msg, "x"), entero_de(msg, "y"), s.usuario, s.es_gm)
        await self._difundir_tokens(getattr(self.estado, "ultimos_movidos", None) or [t["id"]])     # también los agrupados con él
        if self.estado.combate["activo"] and self.cfg["juego"]["movimiento"]["limitado"]:
            await self._difundir_combate()      # cuántas casillas le quedan
        await self._publicar_efectos()          # lo que haya hecho la casilla al pisarla (daño, estados…)

    @accion("token_escala")
    async def _token_escala(self, ws, s, msg):
        """{token, escala} — tamaño con que se dibuja el token (0,5 · 0,75 · 1 · 1,5 · 2 · 3). Solo cambia cómo se ve."""
        t = self.estado.escalar_token(texto_de(msg, "token"), msg.get("escala"), s.usuario, s.es_gm)
        await self._difundir_tokens([t["id"]])

    @accion("agrupar_tokens")
    async def _agrupar_tokens(self, ws, s, msg):
        """{tokens: [...]} — al mover uno, se mueven todos (fuera de combate)."""
        await self._difundir_tokens(self.estado.agrupar_tokens(msg.get("tokens"), s.usuario, s.es_gm))

    @accion("desagrupar_token")
    async def _desagrupar_token(self, ws, s, msg):
        await self._difundir_tokens(self.estado.desagrupar_token(texto_de(msg, "token"), s.usuario, s.es_gm))

    @accion("golpear_casilla")
    async def _golpear_casilla(self, ws, s, msg):
        texto, cambio = self.estado.golpear_casilla(entero_de(msg, "x"), entero_de(msg, "y"), s.usuario, s.es_gm,
                                                    msg.get("token") if isinstance(msg.get("token"), str) else None,
                                                    romper_ya=msg.get("romper") is True)
        await self._difundir_golpe(texto, cambio)

    async def _difundir_golpe(self, texto: str, cambio: dict):
        """Un tile u objeto recibió un golpe (o se rompió): todos ven el cambio y el aviso en el chat."""
        if "objetos" in cambio:
            await self._difundir_sala({"tipo": "objetos_mapa", "objetos": cambio["objetos"]})
            if self.estado.niebla_activa():                 # un objeto que tapaba la vista ya no está
                await self._difundir_tokens(list(self.estado.tokens))
        else:
            await self._difundir_sala({"tipo": "casilla", **cambio})
            # Quien estaba escondido en una casilla que ya no esconde pasa a verse.
            await self._difundir_tokens([tid for tid, t in self.estado.tokens.items() if t["x"] == cambio["x"] and t["y"] == cambio["y"]])
        await self._chat_sistema(texto, categoria="combate")

    @accion("gm_niebla")
    async def _gm_niebla(self, ws, s, msg):
        activa = msg.get("activa")
        if not isinstance(activa, bool):
            raise ErrorJuego("Datos no válidos")
        self.estado.niebla_gm = activa                      # solo en esta sala
        self.estado.guardar_estado()
        for w, ses in self._en_sala():
            await self._estado_a(w, ses)                    # cada uno recibe de nuevo lo que le toca ver
        await self._chat_sistema(f"🌫️ El GM {'activó' if activa else 'quitó'} la niebla de guerra en «{self.estado.mapa['nombre']}».")

    @accion("gm_ver_niebla")
    async def _gm_ver_niebla(self, ws, s, msg):
        """{como: null | "*" | usuario}: el GM ve (semitransparente) la niebla del grupo o de un jugador, solo en su pantalla."""
        como = msg.get("como")
        if como is not None and (not isinstance(como, str) or (como != "*" and como not in self.estado.jugadores_en_mapa())):
            raise ErrorJuego("Ese jugador no tiene ningún token en este mapa")
        s.ver_niebla = como
        s.mascara = self.estado.mascara_para_gm(como)
        await self._enviar(ws, {"tipo": "niebla", "mascara": s.mascara, "como": como})

    @accion("gm_capa")
    async def _gm_capa(self, ws, s, msg):
        ocultas = self.estado.fijar_capa(msg.get("capa"), msg.get("visible"))
        await self._difundir_sala({"tipo": "capas", "ocultas": ocultas})

    @accion("gm_cambiar_mapa")
    async def _gm_cambiar_mapa(self, ws, s, msg):
        """«Llevar a todos aquí»: los personajes de los jugadores (de todas las salas) y todos los conectados pasan a esa sala."""
        destino = texto_de(msg, "mapa")
        self.estado.cambiar_mapa(destino)
        for w, ses in list(self.sesiones.items()):
            ses.mapa = destino
            await self._estado_a(w, ses)
        await self._chat_sistema(f"🗺️ El GM llevó a todos a «{self.estado.mapa['nombre']}».", local=False)
        await self._difundir_conectados()
        await self._difundir_salas_mapa()
        await self._avisar_gm_personajes()

    async def _tras_evento_global(self):
        """El clima o el momento del día cambiaron para todas las salas: cada una publica sus efectos y sus tokens."""
        for m in self.estado.salas_en_uso():
            self.estado.usar_sala(m)
            await self._publicar_efectos()
            await self._difundir_tokens(list(self.estado.tokens))

    async def _difundir_salas_mapa(self):
        """Lista de salas del panel «Salas»: el GM ve todas con lo que hay en cada una; un jugador, las que puede elegir."""
        for w, x in list(self.sesiones.items()):
            await self._enviar(w, {"tipo": "salas_mapa", "actual": self._sala_de(x), "salas": self.estado.vista_salas(x.es_gm, self._sala_de(x))})

    async def _llevar_sesiones(self, ids: list[str], origen: str, destino: str):
        """Tras mover tokens de sala: quien los ve en la sala de origen deja de verlos, quien está en la de destino los ve aparecer,
        y el jugador que los maneja se va con ellos si era su personaje activo (o ya no le queda nada suyo en la sala de origen)."""
        with self.estado.en_sala(origen):
            await self._difundir_tokens([], quitados=ids)
            await self._difundir_combate()
            restantes = list(self.estado.tokens.values())
        movidos = [t for _, t in self.estado.todos_los_tokens() if t["id"] in ids]
        with self.estado.en_sala(destino):
            await self._difundir_tokens(ids)
        for w, x in list(self.sesiones.items()):
            if x.es_gm or self._sala_de(x) != origen:
                continue
            suyos = [t for t in movidos if self.estado.controla(t, x.usuario)]
            if not suyos:
                continue
            activo = any(t["tipo"] == "personaje" and t["personaje_id"] == x.personaje_id for t in suyos)
            if activo or not any(self.estado.controla(t, x.usuario) for t in restantes):
                x.mapa = destino
                await self._estado_a(w, x)
                pj = next((t for t in suyos if t["tipo"] == "personaje" and t["personaje_id"] == x.personaje_id), None)
                if pj:
                    await self._enviar(w, {"tipo": "personaje_activo", "personaje": pj["personaje_id"], "token": pj["id"]})
        await self._difundir_conectados()
        await self._difundir_salas_mapa()
        if any(t["tipo"] == "personaje" for t in movidos):
            await self._avisar_gm_personajes()          # en qué sala está cada personaje

    @accion("cambiar_sala")
    async def _cambiar_sala(self, ws, s, msg):
        """{mapa, token?} — el GM pasa a ver esa sala (sin mover a nadie). Un jugador se va a esa sala con su personaje activo
        (o el token que diga) si la mesa lo permite y la sala está abierta."""
        destino = texto_de(msg, "mapa")
        origen = self.estado.mapa_id
        if s.es_gm:
            if destino not in self.cat.mapas:
                raise ErrorJuego("Esa sala no existe")
            s.mapa, s.ver_niebla = destino, None
            await self._estado_a(ws, s)
            await self._difundir_salas_mapa()
            return
        tid = msg.get("token") if isinstance(msg.get("token"), str) else None
        if tid is None and s.personaje_id:
            t = self.estado.token_de_personaje(s.usuario, s.personaje_id)
            tid = t["id"] if t and self.estado.sala_de_token(t["id"]) == origen else None
        nombre = self.estado.nombre_de(self.estado._token(tid)) if tid else s.usuario
        ids = self.estado.cambiar_de_sala(s.usuario, False, tid, destino)
        if destino == origen:
            return
        await self._chat_sistema(f"🚪 {nombre} se va a «{self.cat.mapas[destino]['nombre']}».")
        if ids:
            await self._llevar_sesiones(ids, origen, destino)
        if self._sala_de(s) != destino:            # sin token en el mapa: solo cambia lo que ve
            s.mapa = destino
            await self._estado_a(ws, s)
            await self._difundir_salas_mapa()
        self.estado.usar_sala(destino)
        await self._chat_sistema(f"🚪 {nombre} llega a la sala.")

    @accion("gm_mover_a_sala")
    async def _gm_mover_a_sala(self, ws, s, msg):
        """{token, mapa, x?, y?} — el GM lleva un token (y su grupo) de la sala que está viendo a otra."""
        tid, destino = texto_de(msg, "token"), texto_de(msg, "mapa")
        x = entero_de(msg, "x") if msg.get("x") is not None else None
        y = entero_de(msg, "y") if msg.get("y") is not None else None
        origen = self.estado.mapa_id
        nombre = self.estado.nombre_de(self.estado._token(tid))
        ids = self.estado.mover_a_sala(tid, destino, x, y)
        await self._chat_sistema(f"🚪 {nombre} se va a «{self.cat.mapas[destino]['nombre']}».")
        await self._llevar_sesiones(ids, origen, destino)
        self.estado.usar_sala(destino)
        await self._chat_sistema(f"🚪 {nombre} llega a la sala.")

    @accion("gm_mostrar_token")
    async def _gm_mostrar_token(self, ws, s, msg):
        """{token, barras?, nombre?} — en este token, los demás ven (true) o no (false) sus barras / su nombre; null = lo que diga la mesa."""
        tid = texto_de(msg, "token")
        self.estado.fijar_mostrar(tid, **{k: msg[k] for k in ("barras", "nombre") if k in msg})
        await self._difundir_tokens([tid])

    @accion("gm_sala_abierta")
    async def _gm_sala_abierta(self, ws, s, msg):
        """{mapa, abierta} — si los jugadores pueden entrar solos en esa sala (con «cambiar_sala: todos»)."""
        self.estado.abrir_sala(msg.get("mapa"), msg.get("abierta"))
        await self._difundir_salas_mapa()
