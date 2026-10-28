"""acciones_ambiente.py — Ambiente: música, sonidos, momento del día, clima y diario.

Parte de `Servidor` (ver servidor.py). Cada manejador recibe (ws, sesión, mensaje) y se registra con
@accion("tipo de mensaje"): para una acción nueva basta con escribirla aquí (o en un archivo nuevo de manejadores)."""

from __future__ import annotations

import time

from .errores import ErrorJuego
from .permisos import permisos_de
from .protocolo import texto_de, accion


class AccionesAmbiente:
    async def _enviar_diario(self, ws, s):
        """Cada uno recibe solo las páginas del diario que puede leer (el GM, todas con su visibilidad)."""
        await self._enviar(ws, {"tipo": "diario", "paginas": self.estado.paginas_para(s.usuario, s.es_gm),
                                "reglas": self.cfg["juego"]["diario_reglas"]})

    def _exigir_sonidos(self):
        if not self.cfg["juego"]["sonidos_activos"]:
            raise ErrorJuego("Esta campaña no usa música ni sonidos")

    @accion("reproducir_musica")
    async def _reproducir_musica(self, ws, s, msg):
        self._exigir_sonidos()
        if not permisos_de(self.cfg, s.es_gm)["controlar_musica"]:
            raise ErrorJuego("No tienes permiso para controlar la música")
        archivo = msg.get("archivo")
        if archivo is not None and not isinstance(archivo, str):
            raise ErrorJuego("Canción inválida")
        self.estado.cambiar_musica(archivo)
        # «gradual»: al parar, la música se apaga poco a poco en vez de cortarse de golpe.
        await self._difundir({"tipo": "musica", "archivo": self.estado.musica, "gradual": bool(msg.get("gradual")) and archivo is None})

    @accion("sonido_ambiente")
    async def _sonido_ambiente(self, ws, s, msg):
        """Solo el GM controla el ambiente (viento, lluvia…), pero lo oyen todos."""
        self._exigir_sonidos()
        if not s.es_gm:
            raise ErrorJuego("Solo el GM controla los sonidos de ambiente")
        archivo = msg.get("archivo")
        if archivo is not None and not isinstance(archivo, str):
            raise ErrorJuego("Sonido inválido")
        activos = self.estado.cambiar_ambiente(archivo, bool(msg.get("activo", True)))
        await self._difundir({"tipo": "ambiente", "activos": activos})

    @accion("sonido_efecto")
    async def _sonido_efecto(self, ws, s, msg):
        self._exigir_sonidos()
        if not s.es_gm:
            raise ErrorJuego("Solo el GM lanza efectos de sonido")
        await self._difundir({"tipo": "efecto", "archivo": self.estado.validar_efecto(msg.get("archivo"))})

    @accion("sonido_personaje")
    async def _sonido_personaje(self, ws, s, msg):
        self._exigir_sonidos()
        ahora = time.monotonic()
        if ahora - s.ultimo_sonido < 0.8:          # sin ametrallar a la mesa
            raise ErrorJuego("Espera un momento antes de lanzar otro sonido")
        archivo = self.estado.sonido_de_personaje(s.usuario, s.es_gm, texto_de(msg, "token"), msg.get("archivo"))
        s.ultimo_sonido = ahora
        await self._difundir_sala({"tipo": "efecto", "archivo": archivo})

    @accion("gm_sonidos_token")
    async def _gm_sonidos_token(self, ws, s, msg):
        tid = texto_de(msg, "token")
        self.estado.asignar_sonidos(tid, msg.get("sonidos"))
        await self._difundir_tokens([tid])

    @accion("gm_diario")
    async def _gm_diario(self, ws, s, msg):
        """{pagina, visible: todos|oculta, jugadores?: [...]} — revela u oculta una página del diario en plena partida."""
        antes = {w: {p["id"] for p in self.estado.paginas_para(x.usuario, x.es_gm)} for w, x in self.sesiones.items()}
        nombre = self.estado.fijar_visibilidad_pagina(texto_de(msg, "pagina"), msg.get("visible"), msg.get("jugadores") or [])
        pid = msg["pagina"]
        for w, x in list(self.sesiones.items()):
            await self._enviar_diario(w, x)
            if not x.es_gm and pid not in antes.get(w, set()) and self.estado.ve_pagina(pid, x.usuario, False):
                await self._enviar(w, {"tipo": "chat", "autor": "Sistema", "texto": f"📖 Nueva página en el diario: «{nombre}».", "categoria": "sistema"})

    @accion("gm_clima")
    async def _gm_clima(self, ws, s, msg):
        c = self.estado.cambiar_clima(msg.get("indice"))
        await self._difundir({"tipo": "clima", "indice": self.estado.clima})
        await self._chat_sistema(f"🌦️ El clima cambia: {c['nombre']}.", local=False)
        await self._tras_evento_global()     # los efectos «solo con clima…» pueden cambiar bonos y visión en todas las salas

    @accion("gm_periodo")
    async def _gm_periodo(self, ws, s, msg):
        p = self.estado.cambiar_periodo(msg.get("indice"))
        await self._difundir({"tipo": "periodo", "indice": self.estado.periodo})
        await self._chat_sistema(f"🕒 Ahora es: {p['nombre']}.", local=False)
        await self._tras_evento_global()     # efectos «solo de noche…» pueden cambiar bonos y visión en todas las salas
