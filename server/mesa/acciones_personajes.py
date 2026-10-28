"""acciones_personajes.py — Acciones sobre personajes y tokens: crear, elegir, editar la ficha, desplegar, niveles y lo que el GM cambia.

Parte de `Servidor` (ver servidor.py). Cada manejador recibe (ws, sesión, mensaje) y se registra con
@accion("tipo de mensaje"): para una acción nueva basta con escribirla aquí (o en un archivo nuevo de manejadores)."""

from __future__ import annotations

from .errores import ErrorJuego
from .protocolo import entero_de, texto_de, accion


class AccionesPersonajes:
    def _exigir_edicion(self, s):
        if not s.es_gm and not self.cuentas.puede_editar(s.usuario):
            raise ErrorJuego("El propietario te ha bloqueado la edición de fichas")

    @accion("gm_revelar")
    async def _gm_revelar(self, ws, s, msg):
        tid = texto_de(msg, "token")
        campos = self.estado.revelar_token(tid, msg.get("campos"))
        await self._difundir_tokens([tid])
        await self._enviar(ws, {"tipo": "revelado", "token": tid, "campos": campos})

    @accion("crear_personaje")
    async def _crear_personaje(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.crear_personaje(s.usuario, s.es_gm, texto_de(msg, "base") if msg.get("base") else None, texto_de(msg, "nombre", 30),
                                        msg.get("historia", "") if isinstance(msg.get("historia", ""), str) else "",
                                        msg.get("elecciones"), msg.get("reparto"),
                                        msg.get("imagen", ""), msg.get("imagen_biografia", ""), campos=msg.get("campos"))
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario),
                                "creado": p["id"]})
        await self._avisar_gm_personajes()

    @accion("elegir_personaje")
    async def _elegir_personaje(self, ws, s, msg):
        pid = texto_de(msg, "personaje")
        if not self.estado.buscar_personaje(s.usuario, pid):
            raise ErrorJuego("Ese personaje no existe")
        token = self.estado.token_de_personaje(s.usuario, pid)     # no se despliega solo: lo decide el jugador o el GM
        s.personaje_id = pid
        if token:
            s.mapa = self.estado.sala_de_token(token["id"])          # el jugador va a la sala donde está su personaje
        await self._enviar(ws, {"tipo": "personaje_activo", "personaje": pid, "token": token["id"] if token else None})
        if token:
            await self._estado_a(ws, s)
            await self._difundir_conectados()

    @accion("editar_personalidad")
    async def _editar_personalidad(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.editar_personalidad(s.usuario, texto_de(msg, "personaje"), msg.get("rasgos"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"]]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    @accion("editar_campos")
    async def _editar_campos(self, ws, s, msg):
        """{personaje, campos, usuario?} — los datos propios de la ficha (Alineamiento, Edad…). El GM puede indicar el usuario."""
        self._exigir_edicion(s)
        usuario = texto_de(msg, "usuario") if s.es_gm and isinstance(msg.get("usuario"), str) else s.usuario
        p = self.estado.editar_campos(usuario, texto_de(msg, "personaje"), msg.get("campos"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"] and t["dueno"] == usuario]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    @accion("editar_propias")
    async def _editar_propias(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.editar_propias(s.usuario, texto_de(msg, "personaje"), msg.get("que"), msg.get("lista"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"]]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    @accion("repartir_puntos")
    async def _repartir_puntos(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.repartir_puntos(s.usuario, texto_de(msg, "personaje"), msg.get("reparto"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"]]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    @accion("gm_estado")
    async def _gm_estado(self, ws, s, msg):
        tid = texto_de(msg, "token")
        texto = self.estado.gm_estado(tid, msg.get("estado"), msg.get("poner"))
        await self._difundir_tokens([tid])
        await self._chat_sistema(texto)

    @accion("gm_dar_puntos")
    async def _gm_dar_puntos(self, ws, s, msg):
        nombre = self.estado.dar_puntos(texto_de(msg, "token"), entero_de(msg, "cantidad"))
        await self._difundir_tokens([texto_de(msg, "token")])
        await self._chat_sistema(f"⭐ El GM dio {msg['cantidad']} puntos de estadística a {nombre}.")

    @accion("desplegar_personaje")
    async def _desplegar_personaje(self, ws, s, msg):
        """{personaje, usuario?, x?, y?} — el dueño sin casilla; el GM puede indicar usuario y casilla."""
        usuario = texto_de(msg, "usuario") if msg.get("usuario") is not None else s.usuario
        x = entero_de(msg, "x") if msg.get("x") is not None else None
        y = entero_de(msg, "y") if msg.get("y") is not None else None
        if (x is None) != (y is None):
            raise ErrorJuego("Indica x e y a la vez")
        token, nuevo = self.estado.desplegar_personaje(usuario, texto_de(msg, "personaje"), s.usuario, s.es_gm, x, y)
        if not nuevo:
            donde = self.estado.sala_de_token(token["id"])
            raise ErrorJuego("Ese personaje ya está en el mapa" if donde == self.estado.mapa_id
                             else f"Ese personaje ya está en la sala «{self.cat.mapas[donde]['nombre']}»")
        await self._difundir_tokens([token["id"]])
        await self._chat_sistema(f"{self.estado.nombre_de(token)} ({usuario}) entra en escena.")
        await self._difundir_conectados()
        await self._avisar_gm_personajes()          # el GM ve quién está ya en alguna sala (para no ofrecerlo dos veces)
        for w, ses in list(self.sesiones.items()):          # el dueño pasa a controlar ese token
            if ses.usuario == usuario and ses.personaje_id in (None, token["personaje_id"]):
                ses.personaje_id = token["personaje_id"]
                ses.mapa = self.estado.mapa_id                # aparece en la sala donde se desplegó
                await self._enviar(w, {"tipo": "personaje_activo", "personaje": token["personaje_id"], "token": token["id"]})
                await self._estado_a(w, ses)

    @accion("retirar_personaje")
    async def _retirar_personaje(self, ws, s, msg):
        tid = texto_de(msg, "token")
        nombre = self.estado.retirar_personaje(tid, s.usuario, s.es_gm)
        await self._difundir_tokens([], quitados=[tid])
        await self._difundir_combate()
        await self._chat_sistema(f"{nombre} sale de escena.")
        await self._difundir_conectados()
        await self._avisar_gm_personajes()

    async def _avisar_gm_personajes(self):
        """Los GM conectados reciben la lista actualizada cuando alguien crea un personaje."""
        lista = None
        for w, ses in list(self.sesiones.items()):
            if ses.es_gm:
                lista = lista or self.estado.todos_los_personajes()
                await self._enviar(w, {"tipo": "todos_los_personajes", "personajes": lista})

    @accion("gm_listar_personajes")
    async def _gm_listar_personajes(self, ws, s, msg):
        await self._enviar(ws, {"tipo": "todos_los_personajes", "personajes": self.estado.todos_los_personajes()})

    @accion("gm_subir_nivel")
    async def _gm_subir_nivel(self, ws, s, msg):
        """{usuario, personaje} — sube un nivel a un personaje (desplegado o no)."""
        usuario = texto_de(msg, "usuario")
        self.estado.subir_nivel(usuario, texto_de(msg, "personaje"))
        await self._publicar_efectos()
        for w, x in list(self.sesiones.items()):          # su dueño ve la ficha nueva aunque no esté en el mapa
            if x.usuario == usuario:
                await self._enviar(w, {"tipo": "personajes", "personajes": self.estado.personajes_de(usuario)})
        await self._avisar_gm_personajes()

    @accion("gm_colocar_enemigo")
    async def _gm_colocar_enemigo(self, ws, s, msg):
        t = self.estado.colocar_enemigo(texto_de(msg, "enemigo"), entero_de(msg, "x"), entero_de(msg, "y"))
        await self._difundir_tokens([t["id"]])

    @accion("gm_quitar_token")
    async def _gm_quitar_token(self, ws, s, msg):
        tid = texto_de(msg, "token")
        self.estado.quitar_token(tid)
        await self._difundir_tokens([], quitados=[tid])
        await self._difundir_combate()

    @accion("transformar")
    async def _transformar(self, ws, s, msg):
        """{token, opcion} — cambia de forma (licántropo, evolución…). El GM siempre; el jugador si la mesa lo permite."""
        tid = texto_de(msg, "token")
        texto = self.estado.transformar(tid, texto_de(msg, "opcion", 80), s.usuario, s.es_gm)
        await self._difundir_tokens([tid])
        await self._chat_sistema(texto)
        await self._tras_cambio_de_vida()

    @accion("gm_editar_token")
    async def _gm_editar_token(self, ws, s, msg):
        tid = texto_de(msg, "token")
        nombre_antes = self.estado.nombre_de(self.estado._token(tid))
        nombre = msg.get("nombre")
        stats, recursos = msg.get("stats"), msg.get("recursos")
        if (stats is not None and not isinstance(stats, dict)) or (recursos is not None and not isinstance(recursos, dict)):
            raise ErrorJuego("Datos de edición inválidos")
        bando = msg.get("bando")
        if bando is not None and not isinstance(bando, str):
            raise ErrorJuego("Bando inválido")
        dar, cede = msg.get("dar_experiencia"), msg.get("cede")
        if (dar is not None and not isinstance(dar, dict)) or (cede is not None and not isinstance(cede, dict)):
            raise ErrorJuego("Datos de experiencia inválidos")
        ctrl = msg.get("controlado_por", False)
        if ctrl is not False and ctrl is not None and not isinstance(ctrl, str):
            raise ErrorJuego("Jugador inválido")
        dueno = msg.get("dueno", False)
        if dueno is not False and not isinstance(dueno, str):
            raise ErrorJuego("Usuario inválido")
        token = self.estado._token(tid)
        dueno_antes = token.get("dueno")
        usuarios = {*self.cuentas.datos, *(x.usuario for x in self.sesiones.values() if not x.es_gm)}
        # Un personaje también puede volver al GM (o pasar a otro GM conectado); los NPC solo se dan a jugadores.
        destinos = usuarios | {x.usuario for x in self.sesiones.values()} | ({dueno_antes} if dueno_antes else set())
        resumen = self.estado.editar_token(tid, nombre, stats, recursos, bando, dar, cede, ctrl, usuarios, dueno=dueno, usuarios_dueno=destinos)
        if token.get("dueno") != dueno_antes:          # cambió de dueño: los dos reciben su lista de personajes al día
            for u in (dueno_antes, token["dueno"]):
                for w, ses in list(self.sesiones.items()):
                    if ses.usuario.casefold() == u.casefold():
                        await self._enviar(w, {"tipo": "personajes", "personajes": self.estado.personajes_de(ses.usuario)})
            await self._avisar_gm_personajes()
        await self._difundir_tokens([tid])
        if resumen:
            await self._chat_sistema(f"🛠️ El GM modificó a {nombre_antes}: {resumen}")
        await self._publicar_efectos()          # si ganó experiencia, quizá subió de nivel
        await self._tras_cambio_de_vida()

    @accion("gm_objeto")
    async def _gm_objeto(self, ws, s, msg):
        tid = texto_de(msg, "token")
        cantidad = entero_de(msg, "cantidad")
        nombre_obj = self.estado.cambiar_objeto(tid, texto_de(msg, "objeto"), cantidad)
        await self._difundir_tokens([tid])
        quien = self.estado.nombre_de(self.estado._token(tid))
        verbo = f"dio {cantidad} × {nombre_obj} a" if cantidad > 0 else f"quitó {-cantidad} × {nombre_obj} a"
        await self._chat_sistema(f"🎒 El GM {verbo} {quien}.")

    @accion("gm_habilidad")
    async def _gm_habilidad(self, ws, s, msg):
        """{token, habilidad, poner} — el GM da o quita una habilidad a un token. Se enteran el GM y quien lo maneja (no se anuncia
        a toda la mesa: las habilidades de un NPC suelen ser un secreto)."""
        tid = texto_de(msg, "token")
        texto, t = self.estado.gm_habilidad(tid, msg.get("habilidad"), msg.get("poner"))
        await self._difundir_tokens([tid])
        if t["tipo"] == "personaje":
            await self._refrescar_personajes(t["dueno"])        # su ficha (también fuera del mapa) muestra la habilidad nueva
        aviso = {"tipo": "chat", "autor": "Sistema", "texto": texto, "categoria": "sistema"}
        for w, x in list(self.sesiones.items()):
            if x.es_gm or (self._sala_de(x) == self.estado.mapa_id and self.estado.controla(t, x.usuario)):
                await self._enviar(w, aviso)

    async def _refrescar_personajes(self, *usuarios: str):
        """Tras comprar o intercambiar: cada afectado recibe sus fichas y todos ven el token con lo que les toque ver."""
        for u in dict.fromkeys(usuarios):
            w = self._ws_de(u)
            if w:
                await self._enviar(w, {"tipo": "personajes", "personajes": self.estado.personajes_de(self.sesiones[w].usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["dueno"] in usuarios]
        if ids:
            await self._difundir_tokens_donde_esten(ids)
