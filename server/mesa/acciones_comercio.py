"""acciones_comercio.py — Tiendas, intercambios entre jugadores, cofres y dinero.

Parte de `Servidor` (ver servidor.py). Cada manejador recibe (ws, sesión, mensaje) y se registra con
@accion("tipo de mensaje"): para una acción nueva basta con escribirla aquí (o en un archivo nuevo de manejadores)."""

from __future__ import annotations

import asyncio

from .errores import ErrorJuego
from .protocolo import entero_de, texto_de, accion


class AccionesComercio:
    async def _difundir_cofres(self):
        for w, x in list(self.sesiones.items()):
            await self._enviar(w, {"tipo": "cofres", "cofres": self.estado.cofres_para(x.usuario, x.es_gm)})

    @accion("cofre")
    async def _cofre(self, ws, s, msg):
        """{accion: meter|sacar, cofre, personaje, objeto + cantidad | dinero} — inventario de grupo."""
        accion = msg.get("accion")
        if accion not in ("meter", "sacar"):
            raise ErrorJuego("Acción no válida")
        self._exigir_edicion(s)
        texto = self.estado.mover_a_cofre(s.usuario, s.es_gm, msg.get("cofre"), msg.get("personaje"), msg.get("objeto"),
                                          msg.get("cantidad"), msg.get("dinero"), sacar=accion == "sacar")
        await self._difundir_cofres()
        tok = self.estado.token_de_personaje(s.usuario, msg.get("personaje")) if isinstance(msg.get("personaje"), str) else None
        if tok:
            await self._difundir_tokens_donde_esten([tok["id"]])
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        await self._aviso_cofre(msg.get("cofre"), texto)

    async def _aviso_cofre(self, cofre_id, texto):
        """Lo que pasa en el inventario común lo ve todo el mundo; lo de uno privado, solo sus miembros y el GM."""
        c = self.estado.cofres.get(cofre_id) if isinstance(cofre_id, str) else None
        if c is None or c["miembros"] is None:
            await self._chat_sistema(texto, local=False)
            return
        for w, x in list(self.sesiones.items()):
            if self.estado.es_miembro(c, x.usuario, x.es_gm):
                await self._enviar(w, {"tipo": "chat", "autor": "Sistema", "texto": texto, "categoria": "sistema"})

    @accion("gm_cofre")
    async def _gm_cofre(self, ws, s, msg):
        texto = self.estado.gm_cofre(msg.get("accion"), msg.get("cofre"), msg.get("nombre"), msg.get("miembros"), msg.get("cerrado"),
                                     msg.get("objeto"), msg.get("cantidad"), msg.get("dinero"))
        await self._difundir_cofres()
        if msg.get("accion") in ("crear", "borrar"):       # solo el GM se entera (los miembros ven aparecer o desaparecer el inventario)
            await self._enviar(ws, {"tipo": "chat", "autor": "Sistema", "texto": texto, "categoria": "sistema"})
        else:
            await self._aviso_cofre(msg.get("cofre"), texto)

    @accion("gm_tienda_abrir")
    async def _gm_tienda_abrir(self, ws, s, msg):
        t = self.estado.abrir_tienda(msg.get("tienda"), bool(msg.get("abierta")), bool(msg.get("reponer")))
        await self._difundir_tiendas()
        if msg.get("abierta") and not msg.get("reponer"):
            await self._chat_sistema(f"🏪 Se abrió «{t['nombre']}».", local=False)
        elif not msg.get("abierta"):
            await self._chat_sistema(f"🏪 Se cerró «{t['nombre']}».", local=False)

    async def _difundir_tiendas(self):
        """Las tiendas abiertas, a cada uno con «aqui» calculado en SU sala (una tienda ligada a un mapa solo atiende en él)."""
        envios = []
        for w, ses in list(self.sesiones.items()):
            with self.estado.en_sala(self._sala_de(ses)):
                envios.append(self._enviar(w, {"tipo": "tiendas", "tiendas": self.estado.vista_tiendas()}))
        await asyncio.gather(*envios)

    @accion("comprar")
    async def _comprar(self, ws, s, msg):
        texto = self.estado.comprar(s.usuario, s.personaje_id, msg.get("tienda"), msg.get("objeto"), msg.get("cantidad"))
        await self._refrescar_personajes(s.usuario)
        await self._difundir_tiendas()
        await self._chat_sistema(texto, local=False)

    @accion("vender")
    async def _vender(self, ws, s, msg):
        texto = self.estado.vender(s.usuario, s.personaje_id, msg.get("tienda"), msg.get("objeto"), msg.get("cantidad"))
        await self._refrescar_personajes(s.usuario)
        await self._chat_sistema(texto, local=False)

    async def _enviar_intercambio(self, x: dict):
        m = {"tipo": "intercambio", **self.estado.vista_intercambio(x)}
        for p in x["partes"]:
            w = self._ws_de(p["usuario"])
            if w:
                await self._enviar(w, m)

    @accion("intercambio_proponer")
    async def _intercambio_proponer(self, ws, s, msg):
        otro = msg.get("con")
        wo = self._ws_de(otro) if isinstance(otro, str) else None
        if wo is None or self.sesiones[wo].es_gm:
            raise ErrorJuego("Esa persona no está conectada")
        so = self.sesiones[wo]
        x = self.estado.proponer_intercambio(s.usuario, s.personaje_id, so.usuario, so.personaje_id)
        await self._enviar_intercambio(x)

    @accion("intercambio_ofrecer")
    async def _intercambio_ofrecer(self, ws, s, msg):
        x = self.estado.ofrecer(s.usuario, msg.get("items", {}), msg.get("dinero", 0))
        await self._enviar_intercambio(x)

    @accion("intercambio_aceptar")
    async def _intercambio_aceptar(self, ws, s, msg):
        x, texto = self.estado.aceptar_intercambio(s.usuario, bool(msg.get("acepto")))
        if texto is None:
            await self._enviar_intercambio(x)
            return
        for p in x["partes"]:
            w = self._ws_de(p["usuario"])
            if w:
                await self._enviar(w, {"tipo": "intercambio_fin", "motivo": "completado"})
        await self._refrescar_personajes(*(p["usuario"] for p in x["partes"]))
        await self._chat_sistema(texto, local=False)

    @accion("intercambio_cancelar")
    async def _intercambio_cancelar(self, ws, s, msg):
        x = self.estado.cancelar_intercambio(s.usuario)
        if x:
            for p in x["partes"]:
                w = self._ws_de(p["usuario"])
                if w:
                    await self._enviar(w, {"tipo": "intercambio_fin", "motivo": "cancelado", "por": s.usuario})

    @accion("gm_dinero")
    async def _gm_dinero(self, ws, s, msg):
        tid = texto_de(msg, "token")
        cantidad = entero_de(msg, "cantidad")
        self.estado.cambiar_dinero(tid, cantidad)
        await self._difundir_tokens([tid])
        quien = self.estado.nombre_de(self.estado._token(tid))
        m = self.cfg["juego"]["moneda"]
        await self._chat_sistema(f"{m['simbolo']} El GM {'dio' if cantidad > 0 else 'quitó'} {abs(cantidad)} {m['nombre'].lower()} a {quien}.")
