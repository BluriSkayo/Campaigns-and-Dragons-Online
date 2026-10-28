"""
servidor.py — Capa de red (WebSocket). Traduce mensajes JSON a acciones sobre EstadoPartida.

Aquí: conexión, entrada (cuentas y contraseñas), envíos y difusión por salas. Los manejadores de cada mensaje van por temas en
acciones_mapa.py, acciones_personajes.py, acciones_combate.py, acciones_chat.py, acciones_ambiente.py y acciones_comercio.py.

Protocolo: ver docs/PROTOCOLO.md
"""

from __future__ import annotations

import asyncio
import json
import logging

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from . import __version__
from . import cuentas as modulo_cuentas
from .acciones_ambiente import AccionesAmbiente
from .acciones_chat import AccionesChat
from .acciones_combate import AccionesCombate
from .acciones_comercio import AccionesComercio
from .acciones_mapa import AccionesMapa
from .acciones_personajes import AccionesPersonajes
from .cuentas import Cuentas, Limitador
from .estado import ErrorJuego, EstadoPartida
from .permisos import permisos_de
from .protocolo import RE_USUARIO, Sesion, ip_de, accion, id_campana  # noqa: F401  (Sesion e id_campana se importan desde aquí)
from .recursos import Catalogo

log = logging.getLogger("mesa")


class _AvisoConexionVacia(logging.Filter):
    """Una conexión que se abre y se cierra sin enviar nada (comprobador de puertos, router, antivirus, bots de internet) hace que
    `websockets` escriba un traceback largo. Se cambia por una explicación breve; los demás errores se muestran igual."""
    TEXTO = ("A connection was opened and closed without sending any data (probably a port checker, a router, an antivirus "
             "or an internet scanner). This is harmless: the server keeps running normally.")

    def filter(self, record: logging.LogRecord) -> bool:
        exc = record.exc_info[1] if record.exc_info else None
        while exc is not None:
            if isinstance(exc, EOFError):
                record.msg, record.args, record.exc_info, record.exc_text = self.TEXTO, (), None, None
                record.levelno, record.levelname = logging.WARNING, "WARNING"
                break
            exc = exc.__cause__ or exc.__context__
        return True


for _nombre in ("websockets.server", "websockets"):
    logging.getLogger(_nombre).addFilter(_AvisoConexionVacia())


class Servidor(AccionesMapa, AccionesPersonajes, AccionesCombate, AccionesChat, AccionesAmbiente, AccionesComercio):
    """La conexión y lo común (envíos, difusión por salas, catálogo, entrada). Los manejadores de cada acción están en acciones_*.py."""

    def __init__(self, catalogo: Catalogo, estado: EstadoPartida):
        self.cat = catalogo
        self.cfg = catalogo.config
        self.estado = estado
        self.sesiones: dict = {}   # websocket → Sesion
        # Cada mensaje se atiende entero (con sus envíos) antes del siguiente: la partida trabaja sobre «la sala actual» y
        # otro mensaje no puede cambiarla a mitad de camino.
        self.cerrojo = asyncio.Lock()
        self._ultimos: dict = {}   # (usuario, chat|tiradas) → último momento (modo lento)
        seg = self.cfg["seguridad"]
        self.cuentas = Cuentas(estado.datos_dir / "cuentas.yaml" if estado.persistir else None)
        self.limitador = Limitador(seg["max_intentos"], seg["bloqueo_segundos"])
        self.estado.cuenta_permite = self.cuentas.permite

        # tipo de mensaje → manejador: los métodos marcados con @accion("tipo") aquí y en los mixins de acciones (acciones_*.py)
        self.acciones = {}
        for nombre in dir(type(self)):
            tipo = getattr(getattr(type(self), nombre), "tipo_accion", None)
            if tipo:
                assert tipo not in self.acciones, f"Dos manejadores para «{tipo}»"
                self.acciones[tipo] = getattr(self, nombre)

    # ── Envío ────────────────────────────────────────────────────
    async def _enviar(self, ws, msg: dict | str):
        """`msg`: el mensaje, o ya convertido a JSON (al difundir lo mismo a muchos se convierte una sola vez)."""
        try:
            texto = msg if isinstance(msg, str) else json.dumps(msg, ensure_ascii=False)
            # Un cliente que no lee (conexión colgada) no puede frenar a toda la mesa: se le corta y vuelve a conectar.
            await asyncio.wait_for(ws.send(texto), 20)
        except ConnectionClosed:
            pass
        except asyncio.TimeoutError:
            log.warning("Un cliente no responde: se cierra su conexión")
            transporte = getattr(ws, "transport", None)
            if transporte is not None:
                transporte.abort()

    async def _difundir(self, msg: dict):
        """A todos los conectados, estén en la sala que estén (música, clima, tiendas…)."""
        texto = json.dumps(msg, ensure_ascii=False)
        await asyncio.gather(*(self._enviar(ws, texto) for ws in list(self.sesiones)))

    # ── Salas ────────────────────────────────────────────────────
    def _sala_de(self, s) -> str:
        """La sala que ve esta sesión (si ya no existe, la principal)."""
        return s.mapa if s.mapa in self.cat.mapas else self.estado.mapa_principal

    def _sala_inicial(self, usuario: str, es_gm: bool) -> str:
        """Al entrar: un jugador aparece en la sala de uno de sus personajes; si no tiene ninguno en el mapa (o es GM), en la principal."""
        if not es_gm:
            for m, t in self.estado.todos_los_tokens():
                if t["tipo"] == "personaje" and t["dueno"] == usuario:
                    return m
        return self.estado.mapa_principal

    def _en_sala(self, mapa: str | None = None):
        """Sesiones que están en esa sala (por defecto, la actual)."""
        m = mapa or self.estado.mapa_id
        return [(w, x) for w, x in list(self.sesiones.items()) if self._sala_de(x) == m]

    async def _difundir_sala(self, msg: dict, excepto=None):
        """Solo a quienes están en la sala actual (dibujos, regla, señales, casillas…)."""
        texto = json.dumps(msg, ensure_ascii=False)
        await asyncio.gather(*(self._enviar(w, texto) for w, _ in self._en_sala() if w is not excepto))

    async def _difundir_tokens_donde_esten(self, ids: list[str]):
        """Avisa de unos tokens que pueden estar en otras salas (fichas que cambian desde fuera del mapa)."""
        por_sala: dict[str, list[str]] = {}
        for i in ids:
            m = self.estado.sala_de_token(i)
            if m:
                por_sala.setdefault(m, []).append(i)
        for m, lista in por_sala.items():
            with self.estado.en_sala(m):
                await self._difundir_tokens(lista)

    async def _estado_a(self, ws, s):
        """Envía el estado completo de su sala a una sesión y apunta qué tokens y niebla conoce ya (para enviar después solo las diferencias)."""
        s.mapa = self._sala_de(s)
        with self.estado.en_sala(s.mapa), self.estado.lectura():
            snap = self.estado.snapshot(s.usuario, s.es_gm)
            if s.es_gm:
                snap["niebla"] = self.estado.mascara_para_gm(s.ver_niebla)
                snap["niebla_gm"] = s.ver_niebla
        s.vistos = {t["id"] for t in snap["tokens"]}
        s.mascara = snap.get("niebla")
        await self._enviar(ws, {"tipo": "estado", **snap})
        await self._enviar_diario(ws, s)
        await self._enviar(ws, {"tipo": "cofres", "cofres": self.estado.cofres_para(s.usuario, s.es_gm)})

    async def _difundir_tokens(self, ids: list[str], quitados: list[str] | None = None):
        with self.estado.lectura():                # aquí no cambia nada: lo que ve cada jugador se calcula una vez
            await self._difundir_tokens_a_cada_uno(ids, quitados)

    async def _difundir_tokens_a_cada_uno(self, ids: list[str], quitados: list[str] | None):
        niebla = self.estado.niebla_activa()
        for ws, s in self._en_sala():
            tokens, ocultos = [], []
            for i in ids:
                t = self.estado.tokens.get(i)
                if not t:
                    continue
                if self.estado.puede_ver(t, s.usuario, s.es_gm):
                    tokens.append(self.estado.vista_token(t, s.usuario, s.es_gm))
                else:
                    ocultos.append(i)          # tile que esconde o fuera de la visión: para este usuario es como si no estuviera
            mascara = None
            if niebla and not s.es_gm:
                # Un movimiento cambia lo que ve cada jugador: se envían los tokens que aparecen y se quitan los que desaparecen.
                visibles = {i for i, t in self.estado.tokens.items() if self.estado.puede_ver(t, s.usuario, False)}
                tocados = set(ids)
                tokens += [self.estado.vista_token(self.estado.tokens[i], s.usuario, False) for i in visibles - s.vistos - tocados]
                ocultos += [i for i in s.vistos - visibles - tocados]
                s.vistos = visibles
                mascara = self.estado.mascara_niebla(s.usuario, False)
            elif niebla and s.es_gm and s.ver_niebla:
                mascara = self.estado.mascara_para_gm(s.ver_niebla) or []       # ayuda visual del GM: se rehace al moverse los tokens
            elif not niebla and s.mascara is not None:
                mascara = []                    # la niebla se apagó
            fuera = (quitados or []) + ocultos
            if niebla and not s.es_gm and self.estado.combate["activo"] and mascara is not None and mascara != s.mascara:
                await self._enviar(ws, {"tipo": "combate", **self.estado.vista_combate(s.usuario, False)})     # lo que ve cambió: también el orden de iniciativa
            if tokens or fuera or not ids:
                await self._enviar(ws, {"tipo": "tokens", "tokens": tokens, "quitados": fuera})
            if mascara is not None and mascara != s.mascara:
                s.mascara = mascara or None
                await self._enviar(ws, {"tipo": "niebla", "mascara": mascara or None})

    async def _publicar_efectos(self):
        """Difunde lo que ocurrió «solo» durante la acción (veneno, rasgos…), y avanza el turno si alguien cayó."""
        chat, tokens = self.estado.vaciar_colas()
        if tokens:
            await self._difundir_tokens(tokens)
        for texto, categoria in chat:
            await self._chat_sistema(texto, categoria=categoria)
        if chat or tokens:
            await self._tras_cambio_de_vida()

    async def _chat_sistema(self, texto: str, categoria: str = "sistema", autor: str = "Sistema", sala: str = "general", local: bool = True):
        """`local`: pasó en la sala (mapa) actual y solo se entera quien está allí (y el GM). Lo que es de toda la mesa
        (alguien entra, el clima, las tiendas…), `local=False`."""
        msg = self.estado.anadir_chat(autor, texto, categoria, sala, mapa=self.estado.mapa_id if local else None)
        self.estado.guardar_estado()
        await self._difundir_chat(msg)

    async def _difundir_chat(self, msg: dict):
        """Un mensaje de una sala de chat privada solo lo reciben sus participantes; uno de un mapa, quienes están en esa sala (y el GM)."""
        await asyncio.gather(*(self._enviar(w, {"tipo": "chat", **self.estado.mensaje_para(msg, ses.es_gm)}) for w, ses in list(self.sesiones.items())
                               if self.estado.ve_mensaje(msg, ses.usuario, ses.es_gm, self._sala_de(ses))))

    async def _enviar_salas(self, ws, s):
        m = {"tipo": "salas", "salas": self.estado.salas_visibles(s.usuario, s.es_gm)}
        if s.es_gm:          # para elegir participantes: los usuarios que tienen cuenta o están conectados
            m["usuarios"] = sorted({*self.cuentas.datos, *(x.usuario for x in self.sesiones.values())}, key=str.casefold)
        await self._enviar(ws, m)

    async def _difundir_salas(self):
        for w, ses in list(self.sesiones.items()):
            await self._enviar_salas(w, ses)

    # ── Catálogo visible para el cliente ─────────────────────────
    def _catalogo_cliente(self, es_gm: bool) -> dict:
        c = self.cat
        res = {
            "estadisticas": c.config["juego"]["estadisticas"],
            "recursos": c.config["juego"]["recursos"],
            "recurso_vida": c.recurso_vida(),
            "habilidades": c.habilidades,
            "objetos": c.objetos,
            "personajes_base": c.personajes,
            # Un tile «invisible» no se dibuja en la partida: a los jugadores ni se les envía su color ni su imagen.
            "tiles": {k: {"nombre": t["nombre"], "descripcion": t["descripcion"],
                          "color": "" if t["invisible"] and not es_gm else t["color"], "imagen": "" if t["invisible"] and not es_gm else t["imagen"],
                          "invisible": t["invisible"],
                          "transitable": t["transitable"], "esconde": t["esconde"], "bloquea_lados": t["bloquea_lados"],
                          "rompible": {"golpes": t["rompible"]["golpes"]} if t["rompible"] else None}
                      for k, t in c.tiles.items()},
            # Los jugadores solo ven la lista de música; el GM también la de ambiente y efectos (que oyen todos).
            "sonidos": {t: g for t, g in c.sonidos.items() if es_gm or t == "musica"},
            "dados": c.config["juego"]["dados"],
            # Reglas públicas de la mesa (para la ventana «Reglas» del cliente).
            "reglas": {k: c.config["permisos"][k] for k in ("crear_personajes", "sin_ficha", "max_personajes_por_jugador", "editar_stats_jugador", "acciones_solo_en_su_turno",
                                                          "mover_tokens_ajenos", "desplegar_en_casilla", "transformarse", "musica", "romper_casillas", "cambiar_sala", "atacar", "dados_personalizados", "rasgos_personalidad", "habilidades_propias", "objetos_propios", "dar_objetos", "alcance_objetos")}
                       | {"puntos_a_repartir": c.config["juego"]["puntos_a_repartir"], "estadistica_iniciativa": c.config["juego"]["estadistica_iniciativa"],
                          "tirada_estadistica": c.config["juego"]["tirada_estadistica"], "salas_chat": c.config["juego"]["salas_chat"], "sonidos_personaje": c.config["permisos"]["sonidos_personaje"],
                          "visibilidad": c.config["visibilidad"]},
            "moneda": c.config["juego"]["moneda"],
            "etiquetas": c.config["juego"].get("etiquetas", []),
            "campos_ficha": c.config["juego"]["campos_ficha"],
            "nombres": c.config["juego"]["nombres"],
            "orden_menu": c.config["juego"]["orden_menu"],
            "inventario_grupo": c.config["juego"]["inventario_grupo"],
            "ventajas": c.config["juego"].get("ventajas", []),
            "ciclo": c.config["juego"]["ciclo"],
            "clima": c.config["juego"]["clima"],
            "niveles": {k: c.config["juego"]["niveles"][k] for k in ("activo", "modo", "umbrales", "maximo", "experiencia")},
            "movimiento": c.config["juego"]["movimiento"],
            "sonidos_activos": c.config["juego"]["sonidos_activos"],
            "medida": c.config["juego"]["medida"],
            "sobre_tokens": c.config["visibilidad"]["sobre_tokens"],
            "categorias_estadisticas": c.config["juego"].get("categorias_estadisticas") is True,
            "equipamiento": c.config["juego"]["equipamiento"],
            "chat": c.config["juego"]["chat"],
            "iniciativa": c.config["juego"]["iniciativa"], "iniciativa_opciones": c.config["juego"]["iniciativa_opciones"],
            "puntos_a_repartir": c.config["juego"]["puntos_a_repartir"],
            "stats_por_plantilla": c.config["juego"]["stats_por_plantilla"],
            # Solo lo que el jugador necesita ver (nombres, descripciones, bonos); los efectos internos no se envían.
            "grupos": c.grupos if c.config["juego"]["usar_grupos"] else {},       # sin razas ni clases, el cliente no las ofrece
            "opciones": c.opciones if c.config["juego"]["usar_grupos"] else {},
            "rasgos": {k: {"nombre": r["nombre"], "descripcion": r["descripcion"], "imagen": r["imagen"]} for k, r in c.rasgos.items()},
            "estados": {k: {"nombre": e["nombre"], "descripcion": e["descripcion"], "imagen": e["imagen"], "color": e["color"], "duracion": e["duracion"]}
                        for k, e in c.estados.items()},
        }
        if es_gm:
            res["enemigos"] = c.enemigos
            res["tiendas"] = {k: {"nombre": t["nombre"], "descripcion": t["descripcion"], "recompra": t["recompra"]} for k, t in c.tiendas.items()}
            res["mapas"] = {k: {"nombre": m["nombre"], "ancho": m["ancho"], "alto": m["alto"]}
                            for k, m in c.mapas.items()}
        return res

    # ── Conexión ─────────────────────────────────────────────────
    async def handler(self, ws):
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    if not isinstance(msg, dict) or not isinstance(msg.get("tipo"), str):
                        raise ValueError
                except ValueError:
                    await self._enviar(ws, {"tipo": "error", "texto": "Mensaje inválido"})
                    continue
                try:
                    await self._despachar(ws, msg)
                except ErrorJuego as e:
                    await self._enviar(ws, {"tipo": "error", "texto": str(e), **({"codigo": e.codigo} if e.codigo else {})})
                except Exception:
                    log.exception("Error procesando %s", msg.get("tipo"))
                    await self._enviar(ws, {"tipo": "error", "texto": "Error interno del servidor"})
        except ConnectionClosed:
            pass
        finally:
            async with self.cerrojo:
                s = self.sesiones.pop(ws, None)
                if s:
                    log.info("[-] %s", s.usuario)
                    self.estado.usar_sala(self._sala_de(s))
                    x = self.estado.cancelar_intercambio(s.usuario)
                    if x:
                        for p in x["partes"]:
                            w = self._ws_de(p["usuario"])
                            if w:
                                await self._enviar(w, {"tipo": "intercambio_fin", "motivo": "cancelado", "por": s.usuario})
                    await self._difundir({"tipo": "regla", "usuario": s.usuario, "puntos": None})      # si estaba midiendo, su línea desaparece
                    await self._chat_sistema(f"{s.usuario} abandonó la mesa.", local=False)
                    await self._difundir_conectados()

    async def _despachar(self, ws, msg: dict):
        async with self.cerrojo:
            await self._atender(ws, msg)

    async def _atender(self, ws, msg: dict):
        tipo = msg["tipo"]
        if tipo == "entrar":
            return await self._entrar(ws, msg)
        sesion = self.sesiones.get(ws)
        if sesion is None:
            raise ErrorJuego("Primero debes entrar al servidor")
        accion = self.acciones.get(tipo)
        if accion is None:
            raise ErrorJuego(f"Acción desconocida: {tipo}")
        if tipo.startswith("gm_") and not sesion.es_gm:
            raise ErrorJuego("Solo el GM puede hacer eso")
        self.estado.usar_sala(self._sala_de(sesion))         # todo lo que pida ocurre en la sala que está viendo
        try:
            await accion(ws, sesion, msg)
        finally:
            await self._publicar_efectos()
            await self._revisar_fin_combate()

    async def _entrar(self, ws, msg: dict):
        if ws in self.sesiones:
            raise ErrorJuego("Ya has entrado")
        usuario = msg.get("usuario")
        if not isinstance(usuario, str) or not RE_USUARIO.fullmatch(usuario.strip()):
            raise ErrorJuego("El nombre debe tener de 1 a 20 caracteres (letras, números, espacios, - y _)")
        usuario = usuario.strip()
        s_cfg = self.cfg["servidor"]
        seg = self.cfg["seguridad"]
        ip = ip_de(ws)
        for clave in (f"ip:{ip}", f"u:{usuario.casefold()}"):
            espera = self.limitador.espera(clave)
            if espera:
                raise ErrorJuego(f"Demasiados intentos fallidos. Espera {espera} s antes de volver a probar.", "bloqueado")

        def fallo(texto, codigo):
            self.limitador.fallo(f"ip:{ip}")
            raise ErrorJuego(texto, codigo)

        if s_cfg["password_servidor"] and not modulo_cuentas.verificar(s_cfg["password_servidor"], msg.get("password_servidor", "")):
            fallo("Contraseña del servidor incorrecta", "password_servidor_incorrecta")
        es_gm = False
        if msg.get("gm") is True and not s_cfg["password_gm"] and not msg.get("password_gm"):
            es_gm = True                     # servidor sin contraseña de GM: basta con marcar la casilla
        elif msg.get("gm") is True and not msg.get("password_gm"):
            raise ErrorJuego("Este servidor tiene contraseña de GM. Escríbela para entrar como Game Master.", "password_gm_incorrecta")
        elif msg.get("password_gm"):
            if not s_cfg["password_gm"] or not await asyncio.to_thread(modulo_cuentas.verificar, s_cfg["password_gm"], msg["password_gm"]):
                fallo("Contraseña de GM incorrecta", "password_gm_incorrecta")
            es_gm = True

        # ── Cuenta del usuario ──
        pw = msg.get("password")
        if pw is not None and not isinstance(pw, str):
            raise ErrorJuego("La contraseña debe ser texto")
        pw = pw or None
        canonico = self.cuentas.canonico(usuario)
        if canonico:
            usuario = canonico
            if self.cuentas.tiene_password(usuario):
                if not pw:
                    raise ErrorJuego("Esta cuenta tiene contraseña. Escríbela para entrar.", "password_requerida")
                if not await asyncio.to_thread(self.cuentas.comprobar, usuario, pw):
                    self.limitador.fallo(f"u:{usuario.casefold()}")
                    fallo("Usuario o contraseña incorrectos", "password_incorrecta")
                self.limitador.exito(f"u:{usuario.casefold()}")
            elif pw or seg["contrasena_obligatoria"]:
                # Cuenta sin contraseña: la primera que se elija queda guardada (obligatoria si el servidor lo exige).
                if not pw:
                    raise ErrorJuego("Este servidor exige contraseña. Elige una para tu usuario.", "password_nueva_requerida")
                motivo = modulo_cuentas.validar_password_nueva(pw)
                if motivo:
                    raise ErrorJuego(motivo, "password_nueva_requerida")
                await asyncio.to_thread(self.cuentas.fijar_password, usuario, pw)
        else:
            if not seg["registro_abierto"]:
                raise ErrorJuego("Este usuario no está registrado en el servidor. Pide al propietario que lo cree.", "usuario_no_registrado")
            if seg["contrasena_obligatoria"] and not pw:
                raise ErrorJuego("Este servidor exige contraseña. Elige una para tu usuario nuevo.", "password_nueva_requerida")
            if pw:
                motivo = modulo_cuentas.validar_password_nueva(pw)
                if motivo:
                    raise ErrorJuego(motivo, "password_nueva_requerida")
            await asyncio.to_thread(self.cuentas.crear, usuario, pw)
        if any(s.usuario.casefold() == usuario.casefold() for s in self.sesiones.values()):
            raise ErrorJuego("Ese nombre ya está conectado")

        self.estado.registrar_usuario(usuario)
        self.sesiones[ws] = Sesion(usuario, es_gm, mapa=self._sala_inicial(usuario, es_gm))
        self.estado.usar_sala(self.sesiones[ws].mapa)
        log.info("[+] %s%s", usuario, " (GM)" if es_gm else "")
        await self._enviar(ws, self._bienvenida(usuario, es_gm))
        await self._estado_a(ws, self.sesiones[ws])
        await self._enviar_salas(ws, self.sesiones[ws])
        aviso = self.estado.anadir_chat("Sistema", f"{usuario} entró a la mesa.", "sistema")
        for otro in list(self.sesiones):
            if otro is not ws:
                await self._enviar(otro, {"tipo": "chat", **aviso})
        await self._difundir_conectados()

    def _bienvenida(self, usuario: str, es_gm: bool) -> dict:
        return {
            "tipo": "bienvenida", "version": __version__,
            "servidor": {"nombre": self.cfg["servidor"]["nombre"]},
            # Carpeta de la campaña: el cliente busca sus imágenes y sonidos en base/campanas/<id> (los importa del .zip del GM)
            "campana": id_campana(self.estado.cat.ruta.name),
            "usuario": usuario, "es_gm": es_gm, "cuenta": {"tiene_password": self.cuentas.tiene_password(usuario)},
            "permisos": permisos_de(self.cfg, es_gm) | {"ping": es_gm or self.cfg["permisos"]["ping"], "intercambios": self.cfg["permisos"]["intercambios"], "sonidos_personaje": es_gm or self.cfg["permisos"]["sonidos_personaje"], "dibujar": es_gm or self.cfg["permisos"]["dibujar"], "editar_fichas": es_gm or self.cuentas.puede_editar(usuario), "modo_ataque": "todos" if es_gm else (self.cuentas.ataque_de(usuario) or self.cfg["permisos"]["atacar"])},
            "catalogo": self._catalogo_cliente(es_gm),
            "personajes": self.estado.personajes_de(usuario),
            "tiradas": self.estado.tiradas_de(usuario),
        }

    @accion("ser_gm")
    async def _ser_gm(self, ws, s, msg):
        """«/gm contraseña» en el chat: pasa a ser GM sin reconectar. Los fallos cuentan como los de la entrada (bloqueo por IP)."""
        if s.es_gm:
            raise ErrorJuego("Ya eres GM")
        pw = msg.get("password")
        clave = f"ip:{ip_de(ws)}"
        espera = self.limitador.espera(clave)
        if espera:
            raise ErrorJuego(f"Demasiados intentos fallidos. Espera {espera} s antes de volver a probar.", "bloqueado")
        g = self.cfg["servidor"]["password_gm"]
        if not g:
            pass                          # sin contraseña de GM, basta con «/gm»
        elif not isinstance(pw, str) or not pw or len(pw) > 200 or not await asyncio.to_thread(modulo_cuentas.verificar, g, pw):
            self.limitador.fallo(clave)
            raise ErrorJuego("Contraseña de GM incorrecta", "password_gm_incorrecta")
        s.es_gm = True
        log.info("[GM] %s pasa a ser GM", s.usuario)
        await self._enviar(ws, self._bienvenida(s.usuario, True) | {"elevado": True})
        await self._estado_a(ws, s)
        await self._enviar_salas(ws, s)
        await self._chat_sistema(f"👑 {s.usuario} ahora es GM.", local=False)
        await self._difundir_conectados()

    # ── Acciones propias de la conexión (las demás, en acciones_*.py) ──
    @accion("pedir_estado")
    async def _pedir_estado(self, ws, s, msg):
        await self._estado_a(ws, s)

    async def _difundir_conectados(self):
        """El GM ve quién está conectado, en qué sala está cada uno y con qué personajes (en la sala que estén)."""
        gms = [(w, ses) for w, ses in self.sesiones.items() if ses.es_gm]
        if not gms:
            return
        usuarios = []
        for ses in self.sesiones.values():
            pjs = [self.estado.nombre_de(t) for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["dueno"] == ses.usuario]
            usuarios.append({"usuario": ses.usuario, "es_gm": ses.es_gm, "personajes": pjs, "sala": self._sala_de(ses)})
        usuarios.sort(key=lambda u: (not u["es_gm"], u["usuario"].casefold()))
        for w, ses in gms:
            await self._enviar(w, {"tipo": "conectados", "mapa": self._sala_de(ses), "usuarios": usuarios})

    @accion("cambiar_contrasena")
    async def _cambiar_contrasena(self, ws, s, msg):
        nueva = msg.get("nueva")
        motivo = modulo_cuentas.validar_password_nueva(nueva)
        if motivo:
            raise ErrorJuego(motivo)
        clave = f"u:{s.usuario.casefold()}"
        if self.limitador.espera(clave):
            raise ErrorJuego(f"Demasiados intentos fallidos. Espera {self.limitador.espera(clave)} s.", "bloqueado")
        if self.cuentas.tiene_password(s.usuario):
            actual = msg.get("actual")
            if not isinstance(actual, str) or not await asyncio.to_thread(self.cuentas.comprobar, s.usuario, actual):
                self.limitador.fallo(clave)
                raise ErrorJuego("La contraseña actual no es correcta", "password_incorrecta")
        await asyncio.to_thread(self.cuentas.fijar_password, s.usuario, nueva)
        await self._enviar(ws, {"tipo": "cuenta", "tiene_password": True})

    def _ws_de(self, usuario: str):
        return next((w for w, ses in self.sesiones.items() if ses.usuario.casefold() == usuario.casefold()), None)


async def ejecutar(catalogo: Catalogo, estado: EstadoPartida, ssl_ctx=None):
    srv = Servidor(catalogo, estado)
    s = catalogo.config["servidor"]
    async with serve(srv.handler, s["host"], s["puerto"], max_size=2 ** 17, ssl=ssl_ctx):
        log.info("Servidor «%s» escuchando en %s://%s:%s", s["nombre"], "wss" if ssl_ctx else "ws", s["host"], s["puerto"])
        await asyncio.Future()
