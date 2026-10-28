"""acciones_combate.py — Acciones de combate: habilidades, objetos, turnos e iniciativa.

Parte de `Servidor` (ver servidor.py). Cada manejador recibe (ws, sesión, mensaje) y se registra con
@accion("tipo de mensaje"): para una acción nueva basta con escribirla aquí (o en un archivo nuevo de manejadores)."""

from __future__ import annotations

import asyncio

from .protocolo import texto_de, accion


class AccionesCombate:
    async def _revisar_fin_combate(self):
        """Con `juego.fin_combate: automatico`, el combate termina solo al caer o salir el último NPC enemigo."""
        if not self.estado.combate_sin_enemigos():
            return
        self.estado.terminar_combate()
        await self._chat_sistema("🏁 No queda ningún enemigo: el combate termina.", categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))

    async def _difundir_combate(self):
        await asyncio.gather(*(self._enviar(ws, {"tipo": "combate", **self.estado.vista_combate(s.usuario, s.es_gm)}) for ws, s in self._en_sala()))

    @accion("gm_orden_turnos")
    async def _gm_orden_turnos(self, ws, s, msg):
        """{orden: [ids]} — el GM cambia el orden de los turnos (el mismo grupo de tokens, en otro orden)."""
        texto = self.estado.ordenar_turnos(msg.get("orden"))
        await self._difundir_combate()
        if not (self.estado.combate.get("preparando") or {}).get("modo") == "manual":      # mientras el GM ordena en la ventanita, no se llena el chat
            await self._chat_sistema(texto, categoria="combate")

    def _modo_ataque(self, s) -> str:
        """A quién puede atacar este usuario: lo que diga la mesa, salvo que el GM le haya puesto un límite propio (en el Editor, «Jugadores y fichas»)."""
        return self.cuentas.ataque_de(s.usuario) or self.cfg["permisos"]["atacar"]

    @accion("usar_habilidad")
    async def _usar_habilidad(self, ws, s, msg):
        obj = msg.get("objetivo")
        c = msg.get("casilla")
        casilla = None
        if isinstance(c, dict) and all(isinstance(c.get(k), int) and not isinstance(c.get(k), bool) for k in ("x", "y")):
            casilla = (c["x"], c["y"])
        texto, ids = self.estado.usar_habilidad(texto_de(msg, "token"), texto_de(msg, "habilidad"),
                                                obj if isinstance(obj, str) else None, s.usuario, s.es_gm, self._modo_ataque(s), casilla)
        await self._difundir_tokens(ids)
        if texto:
            await self._chat_sistema(texto, categoria="combate")
        golpes, self.estado.golpes_pendientes = self.estado.golpes_pendientes, []
        for t, cambio in golpes:                     # tiles y objetos que la habilidad golpeó
            await self._difundir_golpe(t, cambio)
        await self._tras_cambio_de_vida()

    @accion("equipar")
    async def _equipar(self, ws, s, msg):
        token = texto_de(msg, "token")
        texto = self.estado.equipar(token, msg.get("objeto"), msg.get("poner") is True, s.usuario, s.es_gm)
        await self._difundir_tokens([token])
        await self._chat_sistema(texto)
        await self._publicar_efectos()

    @accion("usar_objeto")
    async def _usar_objeto(self, ws, s, msg):
        """{token, objeto, objetivo?} — usa un objeto del inventario; con `objetivo`, sobre otro token cercano (una poción a un aliado)."""
        objetivo = texto_de(msg, "objetivo") if msg.get("objetivo") is not None else None      # sin «objetivo»: sobre sí mismo
        texto, ids = self.estado.usar_objeto(texto_de(msg, "token"), texto_de(msg, "objeto"), s.usuario, s.es_gm, objetivo)
        await self._difundir_tokens(ids)
        await self._chat_sistema(texto, categoria="combate")
        await self._publicar_efectos()
        await self._tras_cambio_de_vida()

    @accion("dar_objeto")
    async def _dar_objeto(self, ws, s, msg):
        """{token, a, objeto, cantidad} — da objetos del inventario de un token propio a otro token cercano de la sala."""
        texto, ids = self.estado.dar_objeto(texto_de(msg, "token"), texto_de(msg, "a"), texto_de(msg, "objeto"), msg.get("cantidad", 1), s.usuario, s.es_gm)
        await self._difundir_tokens(ids)
        await self._chat_sistema(texto)

    async def _tras_cambio_de_vida(self):
        """Si el token en turno cae (daño, veneno…), el turno avanza solo; si el siguiente también cae al empezar, sigue."""
        e = self.estado
        for _ in range(len(e.tokens) + 1):
            if not e.combate["activo"]:
                return
            actual = e.tokens.get(e.token_en_turno())
            if not (actual and e.derrotado(actual)):
                return
            await self._chat_sistema(e.terminar_turno("", True), categoria="combate")
            await self._difundir_combate()
            chat, tokens = e.vaciar_colas()
            if tokens:
                await self._difundir_tokens(tokens)
            for texto, categoria in chat:
                await self._chat_sistema(texto, categoria=categoria)

    @accion("terminar_turno")
    async def _terminar_turno(self, ws, s, msg):
        texto = self.estado.terminar_turno(s.usuario, s.es_gm)
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()

    @accion("gm_iniciar_combate")
    async def _gm_iniciar_combate(self, ws, s, msg):
        modo = msg.get("modo")
        texto = self.estado.iniciar_combate(modo if isinstance(modo, str) else None)
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))     # efectos «solo en combate» cambian bonos y visión

    @accion("tirar_iniciativa")
    async def _tirar_iniciativa(self, ws, s, msg):
        """Fase de decidir turnos: el jugador tira la iniciativa de su personaje. Cuando han tirado todos, empieza el combate."""
        texto = self.estado.tirar_iniciativa(texto_de(msg, "token"), s.usuario, s.es_gm)
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario)
        if not self.estado.faltan_iniciativas():
            await self._gm_empezar_combate(ws, s, msg)
        else:
            await self._difundir_combate()

    @accion("gm_empezar_combate")
    async def _gm_empezar_combate(self, ws, s, msg):
        """El GM no espera más: se tira por quien falte y empieza el combate."""
        texto = self.estado.empezar_tras_tiradas()
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))

    @accion("gm_combate_turnos")
    async def _gm_combate_turnos(self, ws, s, msg):
        """{token, dentro: true|false} — el GM mete a un token en los turnos del combate o lo saca (sigue en el mapa)."""
        tid = texto_de(msg, "token")
        texto = self.estado.combate_anadir(tid) if msg.get("dentro") is True else self.estado.combate_quitar(tid)
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))        # «en combate» cambia efectos y bonos

    @accion("gm_terminar_combate")
    async def _gm_terminar_combate(self, ws, s, msg):
        self.estado.terminar_combate()
        await self._chat_sistema("🏳️ El combate ha terminado.", categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))
