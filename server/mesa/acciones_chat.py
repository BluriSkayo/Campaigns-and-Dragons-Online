"""acciones_chat.py — Chat, dados, comandos («/r», «/yo», «/gm») y salas privadas de chat.

Parte de `Servidor` (ver servidor.py). Cada manejador recibe (ws, sesión, mensaje) y se registra con
@accion("tipo de mensaje"): para una acción nueva basta con escribirla aquí (o en un archivo nuevo de manejadores)."""

from __future__ import annotations

import time

from .errores import ErrorJuego
from .protocolo import MAX_CHAT, RE_DADO, texto_de, accion


class AccionesChat:
    @accion("tiradas")
    async def _tiradas(self, ws, s, msg):
        """{accion: guardar|borrar|tirar, nombre, expresion?, token?} — las tiradas guardadas de cada usuario."""
        accion = msg.get("accion")
        if accion == "guardar":
            lista = self.estado.guardar_tirada(s.usuario, msg.get("nombre"), msg.get("expresion"), s.es_gm)
        elif accion == "borrar":
            lista = self.estado.borrar_tirada(s.usuario, msg.get("nombre"))
        elif accion == "tirar":
            await self._tirar_guardada(ws, s, texto_de(msg, "nombre", 40), msg.get("token"), msg.get("sala", "general"))
            return
        else:
            raise ErrorJuego("Acción no válida")
        await self._enviar(ws, {"tipo": "tiradas", "tiradas": lista})

    async def _tirar_guardada(self, ws, s, nombre, token_id, sala="general"):
        self._modo_lento(s, "tiradas")
        token = None
        if isinstance(token_id, str) and token_id:
            token = self.estado._token(token_id)
            if not self.estado.puede_controlar(token, s.usuario, s.es_gm):
                raise ErrorJuego("No puedes tirar con ese token")
        texto = self.estado.tirar_guardada(s.usuario, nombre, token)
        if not isinstance(sala, str) or not self.estado.puede_ver_sala(s.usuario, s.es_gm, sala):
            sala = "general"
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario, sala=sala, local=token is not None)

    async def _comando(self, ws, s, texto: str, sala: str, token_id, como: dict | None = None) -> bool:
        """Comandos del chat (empiezan por «/»). → True si era un comando (ya atendido)."""
        cmd, _, resto = texto[1:].strip().partition(" ")
        cmd, resto = cmd.casefold(), resto.strip()
        if cmd == "gm":                          # la contraseña nunca llega al chat
            await self._ser_gm(ws, s, {"password": resto})
            return True
        if cmd in ("ayuda", "help", "?"):
            mis = ", ".join(f"/{t['nombre']}" for t in self.estado.tiradas_de(s.usuario))
            ayuda = ("Comandos: /r 2d6+3 (tirar dados) · /2d6 (igual) · /yo texto (acción) · /gm contraseña (pasar a GM) · /ayuda"
                     + (f" · Tus tiradas: {mis}" if mis else ""))
            await self._enviar(ws, {"tipo": "chat", "autor": "Sistema", "texto": ayuda, "categoria": "sistema", **({"sala": sala} if sala != "general" else {})})
            return True
        if cmd in ("r", "tirar", "roll"):
            if not resto:
                raise ErrorJuego("Escribe qué tirar: /r 2d6+3")
            await self._tirar_dado(ws, s, {"expresion": resto, "sala": sala})
            return True
        if cmd in ("yo", "me"):
            if resto:
                quien = como["nombre"] if como else s.usuario
                await self._difundir_chat(self.estado.anadir_chat(s.usuario, f"✦ {quien} {resto}", "accion", sala,
                                                                  mapa=self.estado.mapa_id if como else None, personaje=como))
                self.estado.guardar_estado()
            return True
        if self.estado._buscar_tirada(s.usuario, texto[1:]):
            await self._tirar_guardada(ws, s, texto[1:].strip(), token_id, sala)
            return True
        return False

    @accion("tirar_estadistica")
    async def _tirar_estadistica(self, ws, s, msg):
        t = self.estado._token(texto_de(msg, "token"))
        if not self.estado.puede_controlar(t, s.usuario, s.es_gm):
            raise ErrorJuego("No puedes tirar con ese token")
        self._modo_lento(s, "tiradas")
        texto = self.estado.tirar_estadistica(t, texto_de(msg, "estadistica", 40), s.usuario)
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario)

    def _modo_lento(self, s, que: str):
        """Modo lento de la campaña (juego.chat): espera mínima entre mensajes o entre tiradas de cada jugador. El GM no espera."""
        if s.es_gm:
            return
        espera = self.cfg["juego"]["chat"][f"espera_{que}"]
        if not espera:
            return
        ahora = time.monotonic()
        ultimo = self._ultimos.get((s.usuario, que), -1e9)
        if ahora - ultimo < espera:
            falta = int(espera - (ahora - ultimo)) + 1
            raise ErrorJuego(f"Modo lento: espera {falta} s antes de {'escribir' if que == 'chat' else 'tirar'} otra vez")
        self._ultimos[(s.usuario, que)] = ahora

    @accion("chat")
    async def _chat(self, ws, s, msg):
        texto = texto_de(msg, "texto", MAX_CHAT).strip()
        if not texto:
            return
        sala = msg.get("sala", "general")
        if not isinstance(sala, str) or not self.estado.puede_ver_sala(s.usuario, s.es_gm, sala):
            raise ErrorJuego("No puedes escribir en esa sala")
        # «Hablar como»: uno de sus tokens de esta sala (el GM, cualquiera). Lo que dice un personaje se oye solo en su sala.
        como = self.estado.hablante(msg["como"], s.usuario, s.es_gm) if isinstance(msg.get("como"), str) and msg["como"] else None
        if texto.startswith("/") and await self._comando(ws, s, texto, sala, msg.get("token"), como):
            return
        m = RE_DADO.fullmatch(texto)
        if m:
            return await self._tirar_dado(ws, s, {"expresion": m.group(1), "sala": sala})
        if self.cfg["juego"]["chat"]["modo"] == "registro" and not s.es_gm:
            raise ErrorJuego("En esta mesa el chat es solo un registro: no se pueden escribir mensajes (sí tirar dados)")
        self._modo_lento(s, "chat")
        await self._difundir_chat(self.estado.anadir_chat(s.usuario, texto, "normal", sala,
                                                          mapa=self.estado.mapa_id if como else None, personaje=como))
        self.estado.guardar_estado()

    @accion("tirar_dado")
    async def _tirar_dado(self, ws, s, msg):
        self._modo_lento(s, "tiradas")
        texto = self.estado.tirar(s.usuario, texto_de(msg, "expresion", 60), s.es_gm)
        sala = msg.get("sala", "general")
        if not isinstance(sala, str) or not self.estado.puede_ver_sala(s.usuario, s.es_gm, sala):
            sala = "general"
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario, sala=sala, local=False)

    @accion("gm_sala_crear")
    async def _gm_sala_crear(self, ws, s, msg):
        sala = self.estado.crear_sala(msg.get("nombre"), msg.get("miembros", []))
        await self._difundir_salas()
        await self._enviar(ws, {"tipo": "sala_creada", "sala": sala["id"]})

    @accion("gm_sala_editar")
    async def _gm_sala_editar(self, ws, s, msg):
        self.estado.editar_sala(msg.get("sala"), msg.get("nombre"), msg.get("miembros"))
        await self._difundir_salas()

    @accion("gm_limpiar_chat")
    async def _gm_limpiar_chat(self, ws, s, msg):
        """{sala?} — el GM vacía el chat de esa sala (por defecto, la general) para todos; queda solo un aviso de que se limpió."""
        sala = msg.get("sala") or "general"
        self.estado.limpiar_chat(sala)
        await self._difundir({"tipo": "chat_sala_borrada", "sala": sala})          # cada cliente vacía esa sala (el mismo aviso que al borrarla)
        await self._chat_sistema("🧹 El GM limpió el chat.", sala=sala, local=False)

    @accion("gm_sala_borrar")
    async def _gm_sala_borrar(self, ws, s, msg):
        sala = self.estado.borrar_sala(msg.get("sala"))
        await self._difundir_salas()
        await self._difundir({"tipo": "chat_sala_borrada", "sala": sala["id"]})
