"""
servidor.py — Capa de red (WebSocket). Traduce mensajes JSON a acciones sobre EstadoPartida.

Protocolo: ver docs/PROTOCOLO.md
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import re
import unicodedata
import time
from dataclasses import dataclass, field

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from . import __version__
from . import cuentas as modulo_cuentas
from .cuentas import Cuentas, Limitador
from .estado import ErrorJuego, EstadoPartida
from .permisos import permisos_de
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

RE_USUARIO = re.compile(r"[\w\- ]{1,20}")
RE_DADO = re.compile(r"/\s*(.+)")
MAX_CHAT = 500


@dataclass
class Sesion:
    usuario: str
    es_gm: bool
    personaje_id: str | None = None
    ultima_regla: float = 0.0
    ultimo_sonido: float = 0.0
    ultimo_ping: float = 0.0
    ultimo_lapiz: float = 0.0
    vistos: set = field(default_factory=set)      # ids de tokens que este cliente ya conoce (para la niebla de guerra)
    mascara: list | None = None                  # última máscara de niebla enviada
    ver_niebla: str | None = None                # solo GM: ver la niebla como el grupo («*») o como un jugador; None = no verla
    mapa: str | None = None                      # la sala (mapa) que está viendo: la de su personaje, o la que eligió el GM


def _iguales(a, b) -> bool:
    return hmac.compare_digest(str(a).encode(), str(b).encode())


def _ip(ws) -> str:
    try:
        return str(ws.remote_address[0])
    except (TypeError, IndexError, AttributeError):
        return "?"


def _entero(msg: dict, clave: str) -> int:
    v = msg.get(clave)
    if isinstance(v, bool) or not isinstance(v, int):
        raise ErrorJuego(f"El campo «{clave}» debe ser un número entero")
    return v


def id_campana(nombre: str) -> str:
    """Nombre de la carpeta de la campaña tal como lo usan el Editor y el cliente («mi-campana»)."""
    return re.sub(r"[^a-z0-9_-]+", "-", unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode().lower()).strip("-_")[:60] or "campana"


def _texto(msg: dict, clave: str, maximo: int = 200) -> str:
    v = msg.get(clave)
    if not isinstance(v, str):
        raise ErrorJuego(f"El campo «{clave}» debe ser texto")
    return v[:maximo]


class Servidor:
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
        self.estado.cuenta_permite = lambda u, k: self.cuentas.puede_ver_ajenos(u) if k == "ver_ajenos" else self.cuentas.puede_editar(u)

        self.acciones = {
            "pedir_estado": self._pedir_estado,
            "crear_personaje": self._crear_personaje,
            "elegir_personaje": self._elegir_personaje,
            "chat": self._chat,
            "tirar_dado": self._tirar_dado,
            "mover_token": self._mover_token,
            "golpear_casilla": self._golpear_casilla,
            "usar_habilidad": self._usar_habilidad,
            "usar_objeto": self._usar_objeto,
            "dar_objeto": self._dar_objeto,
            "equipar": self._equipar,
            "terminar_turno": self._terminar_turno,
            "reproducir_musica": self._reproducir_musica,
            "sonido_ambiente": self._sonido_ambiente,
            "sonido_efecto": self._sonido_efecto,
            "sonido_personaje": self._sonido_personaje,
            "regla": self._regla,
            "dibujar": self._dibujar,
            "lapiz": self._lapiz,
            "borrar_dibujo": self._borrar_dibujo,
            "borrar_zona": self._borrar_zona,
            "gm_borrar_dibujos": self._gm_borrar_dibujos,
            "gm_bloquear_dibujo": self._gm_bloquear_dibujo,
            "gm_tienda_abrir": self._gm_tienda_abrir,
            "comprar": self._comprar,
            "vender": self._vender,
            "intercambio_proponer": self._intercambio_proponer,
            "intercambio_ofrecer": self._intercambio_ofrecer,
            "intercambio_aceptar": self._intercambio_aceptar,
            "intercambio_cancelar": self._intercambio_cancelar,
            "gm_sonidos_token": self._gm_sonidos_token,
            "gm_sala_crear": self._gm_sala_crear,
            "gm_limpiar_chat": self._gm_limpiar_chat,
            "gm_sala_editar": self._gm_sala_editar,
            "gm_sala_borrar": self._gm_sala_borrar,
            "gm_dinero": self._gm_dinero,
            "gm_periodo": self._gm_periodo,
            "gm_clima": self._gm_clima,
            "gm_capa": self._gm_capa,
            "gm_niebla": self._gm_niebla,
            "gm_ver_niebla": self._gm_ver_niebla,
            "gm_diario": self._gm_diario,
            "token_escala": self._token_escala,
            "gm_subir_nivel": self._gm_subir_nivel,
            "gm_orden_turnos": self._gm_orden_turnos,
            "agrupar_tokens": self._agrupar_tokens,
            "desagrupar_token": self._desagrupar_token,
            "ser_gm": self._ser_gm,
            "transformar": self._transformar,
            "editar_campos": self._editar_campos,
            "cofre": self._cofre,
            "gm_cofre": self._gm_cofre,
            "tiradas": self._tiradas,
            "gm_revelar": self._gm_revelar,
            "gm_colocar_enemigo": self._gm_colocar_enemigo,
            "desplegar_personaje": self._desplegar_personaje,
            "retirar_personaje": self._retirar_personaje,
            "gm_listar_personajes": self._gm_listar_personajes,
            "repartir_puntos": self._repartir_puntos,
            "editar_personalidad": self._editar_personalidad,
            "editar_propias": self._editar_propias,
            "ping": self._ping,
            "tirar_estadistica": self._tirar_estadistica,
            "cambiar_contrasena": self._cambiar_contrasena,
            "gm_dar_puntos": self._gm_dar_puntos,
            "gm_estado": self._gm_estado,
            "gm_quitar_token": self._gm_quitar_token,
            "gm_editar_token": self._gm_editar_token,
            "gm_objeto": self._gm_objeto,
            "gm_habilidad": self._gm_habilidad,
            "gm_iniciar_combate": self._gm_iniciar_combate,
            "gm_empezar_combate": self._gm_empezar_combate,
            "tirar_iniciativa": self._tirar_iniciativa,
            "gm_terminar_combate": self._gm_terminar_combate,
            "gm_combate_turnos": self._gm_combate_turnos,
            "gm_cambiar_mapa": self._gm_cambiar_mapa,
            "cambiar_sala": self._cambiar_sala,
            "gm_mover_a_sala": self._gm_mover_a_sala,
            "gm_sala_abierta": self._gm_sala_abierta,
            "gm_mostrar_token": self._gm_mostrar_token,
        }

    # ── Envío ────────────────────────────────────────────────────
    async def _enviar(self, ws, msg: dict):
        try:
            # Un cliente que no lee (conexión colgada) no puede frenar a toda la mesa: se le corta y vuelve a conectar.
            await asyncio.wait_for(ws.send(json.dumps(msg, ensure_ascii=False)), 20)
        except ConnectionClosed:
            pass
        except asyncio.TimeoutError:
            log.warning("Un cliente no responde: se cierra su conexión")
            transporte = getattr(ws, "transport", None)
            if transporte is not None:
                transporte.abort()

    async def _difundir(self, msg: dict):
        """A todos los conectados, estén en la sala que estén (música, clima, tiendas…)."""
        await asyncio.gather(*(self._enviar(ws, msg) for ws in list(self.sesiones)))

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
        await asyncio.gather(*(self._enviar(w, msg) for w, _ in self._en_sala() if w is not excepto))

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
        with self.estado.en_sala(s.mapa):
            snap = self.estado.snapshot(s.usuario, s.es_gm)
            if s.es_gm:
                snap["niebla"] = self.estado.mascara_para_gm(s.ver_niebla)
                snap["niebla_gm"] = s.ver_niebla
        s.vistos = {t["id"] for t in snap["tokens"]}
        s.mascara = snap.get("niebla")
        await self._enviar(ws, {"tipo": "estado", **snap})
        await self._enviar_diario(ws, s)
        await self._enviar(ws, {"tipo": "cofres", "cofres": self.estado.cofres_para(s.usuario, s.es_gm)})

    async def _difundir_cofres(self):
        for w, x in list(self.sesiones.items()):
            await self._enviar(w, {"tipo": "cofres", "cofres": self.estado.cofres_para(x.usuario, x.es_gm)})

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

    async def _gm_cofre(self, ws, s, msg):
        texto = self.estado.gm_cofre(msg.get("accion"), msg.get("cofre"), msg.get("nombre"), msg.get("miembros"), msg.get("cerrado"),
                                     msg.get("objeto"), msg.get("cantidad"), msg.get("dinero"))
        await self._difundir_cofres()
        if msg.get("accion") in ("crear", "borrar"):       # solo el GM se entera (los miembros ven aparecer o desaparecer el inventario)
            await self._enviar(ws, {"tipo": "chat", "autor": "Sistema", "texto": texto, "categoria": "sistema"})
        else:
            await self._aviso_cofre(msg.get("cofre"), texto)

    async def _enviar_diario(self, ws, s):
        """Cada uno recibe solo las páginas del diario que puede leer (el GM, todas con su visibilidad)."""
        await self._enviar(ws, {"tipo": "diario", "paginas": self.estado.paginas_para(s.usuario, s.es_gm),
                                "reglas": self.cfg["juego"]["diario_reglas"]})

    async def _difundir_tokens(self, ids: list[str], quitados: list[str] | None = None):
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
        ip = _ip(ws)
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

    async def _ser_gm(self, ws, s, msg):
        """«/gm contraseña» en el chat: pasa a ser GM sin reconectar. Los fallos cuentan como los de la entrada (bloqueo por IP)."""
        if s.es_gm:
            raise ErrorJuego("Ya eres GM")
        pw = msg.get("password")
        clave = f"ip:{_ip(ws)}"
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

    async def _tiradas(self, ws, s, msg):
        """{accion: guardar|borrar|tirar, nombre, expresion?, token?} — las tiradas guardadas de cada usuario."""
        accion = msg.get("accion")
        if accion == "guardar":
            lista = self.estado.guardar_tirada(s.usuario, msg.get("nombre"), msg.get("expresion"), s.es_gm)
        elif accion == "borrar":
            lista = self.estado.borrar_tirada(s.usuario, msg.get("nombre"))
        elif accion == "tirar":
            await self._tirar_guardada(ws, s, _texto(msg, "nombre", 40), msg.get("token"), msg.get("sala", "general"))
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

    # ── Acciones ─────────────────────────────────────────────────
    async def _pedir_estado(self, ws, s, msg):
        await self._estado_a(ws, s)

    def _exigir_edicion(self, s):
        if not s.es_gm and not self.cuentas.puede_editar(s.usuario):
            raise ErrorJuego("El propietario te ha bloqueado la edición de fichas")

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

    async def _dibujar(self, ws, s, msg):
        d = self.estado.anadir_dibujo(s.usuario, s.es_gm, msg.get("color"), msg.get("puntos"), msg.get("grosor"))
        await self._difundir_sala({"tipo": "dibujo", "dibujo": d})

    async def _borrar_zona(self, ws, s, msg):
        """Borrador: quita solo el trozo de trazo que toca (centros = recorrido del borrador, radio en casillas)."""
        borrados, nuevos = self.estado.borrar_zona(s.usuario, s.es_gm, msg.get("centros"), msg.get("radio"))
        if borrados:
            await self._difundir_sala({"tipo": "dibujos_borrados", "ids": borrados})
        for d in nuevos:
            await self._difundir_sala({"tipo": "dibujo", "dibujo": d})

    async def _borrar_dibujo(self, ws, s, msg):
        ids = msg.get("ids")
        if not isinstance(ids, list):
            raise ErrorJuego("Datos no válidos")
        borrados = self.estado.borrar_dibujos(s.usuario, s.es_gm, ids=ids)
        if borrados:
            await self._difundir_sala({"tipo": "dibujos_borrados", "ids": borrados})

    async def _gm_borrar_dibujos(self, ws, s, msg):
        de = msg.get("usuario")
        borrados = self.estado.borrar_dibujos(s.usuario, True, de_usuario=de if isinstance(de, str) else None)
        await self._difundir_sala({"tipo": "dibujos_borrados", "ids": borrados})

    async def _gm_bloquear_dibujo(self, ws, s, msg):
        self.estado.dibujo_bloqueado = bool(msg.get("activo"))
        await self._difundir({"tipo": "dibujo_bloqueo", "activo": self.estado.dibujo_bloqueado})

    async def _gm_revelar(self, ws, s, msg):
        tid = _texto(msg, "token")
        campos = self.estado.revelar_token(tid, msg.get("campos"))
        await self._difundir_tokens([tid])
        await self._enviar(ws, {"tipo": "revelado", "token": tid, "campos": campos})

    async def _crear_personaje(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.crear_personaje(s.usuario, s.es_gm, _texto(msg, "base") if msg.get("base") else None, _texto(msg, "nombre", 30),
                                        msg.get("historia", "") if isinstance(msg.get("historia", ""), str) else "",
                                        msg.get("elecciones"), msg.get("reparto"),
                                        msg.get("imagen", ""), msg.get("imagen_biografia", ""), campos=msg.get("campos"))
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario),
                                "creado": p["id"]})
        await self._avisar_gm_personajes()

    async def _elegir_personaje(self, ws, s, msg):
        pid = _texto(msg, "personaje")
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

    async def _editar_personalidad(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.editar_personalidad(s.usuario, _texto(msg, "personaje"), msg.get("rasgos"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"]]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    async def _editar_campos(self, ws, s, msg):
        """{personaje, campos, usuario?} — los datos propios de la ficha (Alineamiento, Edad…). El GM puede indicar el usuario."""
        self._exigir_edicion(s)
        usuario = _texto(msg, "usuario") if s.es_gm and isinstance(msg.get("usuario"), str) else s.usuario
        p = self.estado.editar_campos(usuario, _texto(msg, "personaje"), msg.get("campos"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"] and t["dueno"] == usuario]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    async def _editar_propias(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.editar_propias(s.usuario, _texto(msg, "personaje"), msg.get("que"), msg.get("lista"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"]]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

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

    async def _repartir_puntos(self, ws, s, msg):
        self._exigir_edicion(s)
        p = self.estado.repartir_puntos(s.usuario, _texto(msg, "personaje"), msg.get("reparto"), s.es_gm)
        await self._enviar(ws, {"tipo": "personajes", "personajes": self.estado.personajes_de(s.usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["personaje_id"] == p["id"]]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

    async def _gm_estado(self, ws, s, msg):
        tid = _texto(msg, "token")
        texto = self.estado.gm_estado(tid, msg.get("estado"), msg.get("poner"))
        await self._difundir_tokens([tid])
        await self._chat_sistema(texto)

    async def _gm_dar_puntos(self, ws, s, msg):
        nombre = self.estado.dar_puntos(_texto(msg, "token"), _entero(msg, "cantidad"))
        await self._difundir_tokens([_texto(msg, "token")])
        await self._chat_sistema(f"⭐ El GM dio {msg['cantidad']} puntos de estadística a {nombre}.")

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

    async def _tirar_estadistica(self, ws, s, msg):
        t = self.estado._token(_texto(msg, "token"))
        if not self.estado.puede_controlar(t, s.usuario, s.es_gm):
            raise ErrorJuego("No puedes tirar con ese token")
        self._modo_lento(s, "tiradas")
        texto = self.estado.tirar_estadistica(t, _texto(msg, "estadistica", 40), s.usuario)
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario)

    async def _desplegar_personaje(self, ws, s, msg):
        """{personaje, usuario?, x?, y?} — el dueño sin casilla; el GM puede indicar usuario y casilla."""
        usuario = _texto(msg, "usuario") if msg.get("usuario") is not None else s.usuario
        x = _entero(msg, "x") if msg.get("x") is not None else None
        y = _entero(msg, "y") if msg.get("y") is not None else None
        if (x is None) != (y is None):
            raise ErrorJuego("Indica x e y a la vez")
        token, nuevo = self.estado.desplegar_personaje(usuario, _texto(msg, "personaje"), s.usuario, s.es_gm, x, y)
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

    async def _retirar_personaje(self, ws, s, msg):
        tid = _texto(msg, "token")
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

    async def _gm_listar_personajes(self, ws, s, msg):
        await self._enviar(ws, {"tipo": "todos_los_personajes", "personajes": self.estado.todos_los_personajes()})

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

    async def _chat(self, ws, s, msg):
        texto = _texto(msg, "texto", MAX_CHAT).strip()
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

    async def _tirar_dado(self, ws, s, msg):
        self._modo_lento(s, "tiradas")
        texto = self.estado.tirar(s.usuario, _texto(msg, "expresion", 60), s.es_gm)
        sala = msg.get("sala", "general")
        if not isinstance(sala, str) or not self.estado.puede_ver_sala(s.usuario, s.es_gm, sala):
            sala = "general"
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario, sala=sala, local=False)

    async def _mover_token(self, ws, s, msg):
        t = self.estado.mover_token(_texto(msg, "token"), _entero(msg, "x"), _entero(msg, "y"), s.usuario, s.es_gm)
        await self._difundir_tokens(getattr(self.estado, "ultimos_movidos", None) or [t["id"]])     # también los agrupados con él
        if self.estado.combate["activo"] and self.cfg["juego"]["movimiento"]["limitado"]:
            await self._difundir_combate()      # cuántas casillas le quedan
        await self._publicar_efectos()          # lo que haya hecho la casilla al pisarla (daño, estados…)

    async def _gm_subir_nivel(self, ws, s, msg):
        """{usuario, personaje} — sube un nivel a un personaje (desplegado o no)."""
        usuario = _texto(msg, "usuario")
        self.estado.subir_nivel(usuario, _texto(msg, "personaje"))
        await self._publicar_efectos()
        for w, x in list(self.sesiones.items()):          # su dueño ve la ficha nueva aunque no esté en el mapa
            if x.usuario == usuario:
                await self._enviar(w, {"tipo": "personajes", "personajes": self.estado.personajes_de(usuario)})
        await self._avisar_gm_personajes()

    async def _gm_orden_turnos(self, ws, s, msg):
        """{orden: [ids]} — el GM cambia el orden de los turnos (el mismo grupo de tokens, en otro orden)."""
        texto = self.estado.ordenar_turnos(msg.get("orden"))
        await self._difundir_combate()
        if not (self.estado.combate.get("preparando") or {}).get("modo") == "manual":      # mientras el GM ordena en la ventanita, no se llena el chat
            await self._chat_sistema(texto, categoria="combate")

    async def _token_escala(self, ws, s, msg):
        """{token, escala} — tamaño con que se dibuja el token (0,5 · 0,75 · 1 · 1,5 · 2 · 3). Solo cambia cómo se ve."""
        t = self.estado.escalar_token(_texto(msg, "token"), msg.get("escala"), s.usuario, s.es_gm)
        await self._difundir_tokens([t["id"]])

    async def _agrupar_tokens(self, ws, s, msg):
        """{tokens: [...]} — al mover uno, se mueven todos (fuera de combate)."""
        await self._difundir_tokens(self.estado.agrupar_tokens(msg.get("tokens"), s.usuario, s.es_gm))

    async def _desagrupar_token(self, ws, s, msg):
        await self._difundir_tokens(self.estado.desagrupar_token(_texto(msg, "token"), s.usuario, s.es_gm))

    async def _golpear_casilla(self, ws, s, msg):
        texto, cambio = self.estado.golpear_casilla(_entero(msg, "x"), _entero(msg, "y"), s.usuario, s.es_gm,
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

    def _modo_ataque(self, s) -> str:
        """A quién puede atacar este usuario: lo que diga la mesa, salvo que el GM le haya puesto un límite propio (en el Editor, «Jugadores y fichas»)."""
        return self.cuentas.ataque_de(s.usuario) or self.cfg["permisos"]["atacar"]

    async def _usar_habilidad(self, ws, s, msg):
        obj = msg.get("objetivo")
        c = msg.get("casilla")
        casilla = None
        if isinstance(c, dict) and all(isinstance(c.get(k), int) and not isinstance(c.get(k), bool) for k in ("x", "y")):
            casilla = (c["x"], c["y"])
        texto, ids = self.estado.usar_habilidad(_texto(msg, "token"), _texto(msg, "habilidad"),
                                                obj if isinstance(obj, str) else None, s.usuario, s.es_gm, self._modo_ataque(s), casilla)
        await self._difundir_tokens(ids)
        if texto:
            await self._chat_sistema(texto, categoria="combate")
        golpes, self.estado.golpes_pendientes = self.estado.golpes_pendientes, []
        for t, cambio in golpes:                     # tiles y objetos que la habilidad golpeó
            await self._difundir_golpe(t, cambio)
        await self._tras_cambio_de_vida()

    async def _equipar(self, ws, s, msg):
        token = _texto(msg, "token")
        texto = self.estado.equipar(token, msg.get("objeto"), msg.get("poner") is True, s.usuario, s.es_gm)
        await self._difundir_tokens([token])
        await self._chat_sistema(texto)
        await self._publicar_efectos()

    async def _usar_objeto(self, ws, s, msg):
        """{token, objeto, objetivo?} — usa un objeto del inventario; con `objetivo`, sobre otro token cercano (una poción a un aliado)."""
        objetivo = _texto(msg, "objetivo") if msg.get("objetivo") is not None else None      # sin «objetivo»: sobre sí mismo
        texto, ids = self.estado.usar_objeto(_texto(msg, "token"), _texto(msg, "objeto"), s.usuario, s.es_gm, objetivo)
        await self._difundir_tokens(ids)
        await self._chat_sistema(texto, categoria="combate")
        await self._publicar_efectos()
        await self._tras_cambio_de_vida()

    async def _dar_objeto(self, ws, s, msg):
        """{token, a, objeto, cantidad} — da objetos del inventario de un token propio a otro token cercano de la sala."""
        texto, ids = self.estado.dar_objeto(_texto(msg, "token"), _texto(msg, "a"), _texto(msg, "objeto"), msg.get("cantidad", 1), s.usuario, s.es_gm)
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

    async def _terminar_turno(self, ws, s, msg):
        texto = self.estado.terminar_turno(s.usuario, s.es_gm)
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()

    def _exigir_sonidos(self):
        if not self.cfg["juego"]["sonidos_activos"]:
            raise ErrorJuego("Esta campaña no usa música ni sonidos")

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

    async def _sonido_efecto(self, ws, s, msg):
        self._exigir_sonidos()
        if not s.es_gm:
            raise ErrorJuego("Solo el GM lanza efectos de sonido")
        await self._difundir({"tipo": "efecto", "archivo": self.estado.validar_efecto(msg.get("archivo"))})

    async def _sonido_personaje(self, ws, s, msg):
        self._exigir_sonidos()
        ahora = time.monotonic()
        if ahora - s.ultimo_sonido < 0.8:          # sin ametrallar a la mesa
            raise ErrorJuego("Espera un momento antes de lanzar otro sonido")
        archivo = self.estado.sonido_de_personaje(s.usuario, s.es_gm, _texto(msg, "token"), msg.get("archivo"))
        s.ultimo_sonido = ahora
        await self._difundir_sala({"tipo": "efecto", "archivo": archivo})

    # ── Acciones de GM ───────────────────────────────────────────
    async def _gm_colocar_enemigo(self, ws, s, msg):
        t = self.estado.colocar_enemigo(_texto(msg, "enemigo"), _entero(msg, "x"), _entero(msg, "y"))
        await self._difundir_tokens([t["id"]])

    async def _gm_quitar_token(self, ws, s, msg):
        tid = _texto(msg, "token")
        self.estado.quitar_token(tid)
        await self._difundir_tokens([], quitados=[tid])
        await self._difundir_combate()

    async def _transformar(self, ws, s, msg):
        """{token, opcion} — cambia de forma (licántropo, evolución…). El GM siempre; el jugador si la mesa lo permite."""
        tid = _texto(msg, "token")
        texto = self.estado.transformar(tid, _texto(msg, "opcion", 80), s.usuario, s.es_gm)
        await self._difundir_tokens([tid])
        await self._chat_sistema(texto)
        await self._tras_cambio_de_vida()

    async def _gm_editar_token(self, ws, s, msg):
        tid = _texto(msg, "token")
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

    async def _gm_objeto(self, ws, s, msg):
        tid = _texto(msg, "token")
        cantidad = _entero(msg, "cantidad")
        nombre_obj = self.estado.cambiar_objeto(tid, _texto(msg, "objeto"), cantidad)
        await self._difundir_tokens([tid])
        quien = self.estado.nombre_de(self.estado._token(tid))
        verbo = f"dio {cantidad} × {nombre_obj} a" if cantidad > 0 else f"quitó {-cantidad} × {nombre_obj} a"
        await self._chat_sistema(f"🎒 El GM {verbo} {quien}.")

    async def _gm_habilidad(self, ws, s, msg):
        """{token, habilidad, poner} — el GM da o quita una habilidad a un token. Se enteran el GM y quien lo maneja (no se anuncia
        a toda la mesa: las habilidades de un NPC suelen ser un secreto)."""
        tid = _texto(msg, "token")
        texto, t = self.estado.gm_habilidad(tid, msg.get("habilidad"), msg.get("poner"))
        await self._difundir_tokens([tid])
        if t["tipo"] == "personaje":
            await self._refrescar_personajes(t["dueno"])        # su ficha (también fuera del mapa) muestra la habilidad nueva
        aviso = {"tipo": "chat", "autor": "Sistema", "texto": texto, "categoria": "sistema"}
        for w, x in list(self.sesiones.items()):
            if x.es_gm or (self._sala_de(x) == self.estado.mapa_id and self.estado.controla(t, x.usuario)):
                await self._enviar(w, aviso)

    # ── Tiendas e intercambios ───────────────────────────────────
    def _ws_de(self, usuario: str):
        return next((w for w, ses in self.sesiones.items() if ses.usuario.casefold() == usuario.casefold()), None)

    async def _refrescar_personajes(self, *usuarios: str):
        """Tras comprar o intercambiar: cada afectado recibe sus fichas y todos ven el token con lo que les toque ver."""
        for u in dict.fromkeys(usuarios):
            w = self._ws_de(u)
            if w:
                await self._enviar(w, {"tipo": "personajes", "personajes": self.estado.personajes_de(self.sesiones[w].usuario)})
        ids = [t["id"] for _, t in self.estado.todos_los_tokens() if t["tipo"] == "personaje" and t["dueno"] in usuarios]
        if ids:
            await self._difundir_tokens_donde_esten(ids)

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

    async def _comprar(self, ws, s, msg):
        texto = self.estado.comprar(s.usuario, s.personaje_id, msg.get("tienda"), msg.get("objeto"), msg.get("cantidad"))
        await self._refrescar_personajes(s.usuario)
        await self._difundir_tiendas()
        await self._chat_sistema(texto, local=False)

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

    async def _intercambio_proponer(self, ws, s, msg):
        otro = msg.get("con")
        wo = self._ws_de(otro) if isinstance(otro, str) else None
        if wo is None or self.sesiones[wo].es_gm:
            raise ErrorJuego("Esa persona no está conectada")
        so = self.sesiones[wo]
        x = self.estado.proponer_intercambio(s.usuario, s.personaje_id, so.usuario, so.personaje_id)
        await self._enviar_intercambio(x)

    async def _intercambio_ofrecer(self, ws, s, msg):
        x = self.estado.ofrecer(s.usuario, msg.get("items", {}), msg.get("dinero", 0))
        await self._enviar_intercambio(x)

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

    async def _intercambio_cancelar(self, ws, s, msg):
        x = self.estado.cancelar_intercambio(s.usuario)
        if x:
            for p in x["partes"]:
                w = self._ws_de(p["usuario"])
                if w:
                    await self._enviar(w, {"tipo": "intercambio_fin", "motivo": "cancelado", "por": s.usuario})

    async def _gm_sonidos_token(self, ws, s, msg):
        tid = _texto(msg, "token")
        self.estado.asignar_sonidos(tid, msg.get("sonidos"))
        await self._difundir_tokens([tid])

    async def _gm_sala_crear(self, ws, s, msg):
        sala = self.estado.crear_sala(msg.get("nombre"), msg.get("miembros", []))
        await self._difundir_salas()
        await self._enviar(ws, {"tipo": "sala_creada", "sala": sala["id"]})

    async def _gm_sala_editar(self, ws, s, msg):
        self.estado.editar_sala(msg.get("sala"), msg.get("nombre"), msg.get("miembros"))
        await self._difundir_salas()

    async def _gm_limpiar_chat(self, ws, s, msg):
        """{sala?} — el GM vacía el chat de esa sala (por defecto, la general) para todos; queda solo un aviso de que se limpió."""
        sala = msg.get("sala") or "general"
        self.estado.limpiar_chat(sala)
        await self._difundir({"tipo": "chat_sala_borrada", "sala": sala})          # cada cliente vacía esa sala (el mismo aviso que al borrarla)
        await self._chat_sistema("🧹 El GM limpió el chat.", sala=sala, local=False)

    async def _gm_sala_borrar(self, ws, s, msg):
        sala = self.estado.borrar_sala(msg.get("sala"))
        await self._difundir_salas()
        await self._difundir({"tipo": "chat_sala_borrada", "sala": sala["id"]})

    async def _gm_dinero(self, ws, s, msg):
        tid = _texto(msg, "token")
        cantidad = _entero(msg, "cantidad")
        self.estado.cambiar_dinero(tid, cantidad)
        await self._difundir_tokens([tid])
        quien = self.estado.nombre_de(self.estado._token(tid))
        m = self.cfg["juego"]["moneda"]
        await self._chat_sistema(f"{m['simbolo']} El GM {'dio' if cantidad > 0 else 'quitó'} {abs(cantidad)} {m['nombre'].lower()} a {quien}.")

    async def _gm_niebla(self, ws, s, msg):
        activa = msg.get("activa")
        if not isinstance(activa, bool):
            raise ErrorJuego("Datos no válidos")
        self.estado.niebla_gm = activa                      # solo en esta sala
        self.estado.guardar_estado()
        for w, ses in self._en_sala():
            await self._estado_a(w, ses)                    # cada uno recibe de nuevo lo que le toca ver
        await self._chat_sistema(f"🌫️ El GM {'activó' if activa else 'quitó'} la niebla de guerra en «{self.estado.mapa['nombre']}».")

    async def _gm_ver_niebla(self, ws, s, msg):
        """{como: null | "*" | usuario}: el GM ve (semitransparente) la niebla del grupo o de un jugador, solo en su pantalla."""
        como = msg.get("como")
        if como is not None and (not isinstance(como, str) or (como != "*" and como not in self.estado.jugadores_en_mapa())):
            raise ErrorJuego("Ese jugador no tiene ningún token en este mapa")
        s.ver_niebla = como
        s.mascara = self.estado.mascara_para_gm(como)
        await self._enviar(ws, {"tipo": "niebla", "mascara": s.mascara, "como": como})

    async def _gm_diario(self, ws, s, msg):
        """{pagina, visible: todos|oculta, jugadores?: [...]} — revela u oculta una página del diario en plena partida."""
        antes = {w: {p["id"] for p in self.estado.paginas_para(x.usuario, x.es_gm)} for w, x in self.sesiones.items()}
        nombre = self.estado.fijar_visibilidad_pagina(_texto(msg, "pagina"), msg.get("visible"), msg.get("jugadores") or [])
        pid = msg["pagina"]
        for w, x in list(self.sesiones.items()):
            await self._enviar_diario(w, x)
            if not x.es_gm and pid not in antes.get(w, set()) and self.estado.ve_pagina(pid, x.usuario, False):
                await self._enviar(w, {"tipo": "chat", "autor": "Sistema", "texto": f"📖 Nueva página en el diario: «{nombre}».", "categoria": "sistema"})

    async def _gm_capa(self, ws, s, msg):
        ocultas = self.estado.fijar_capa(msg.get("capa"), msg.get("visible"))
        await self._difundir_sala({"tipo": "capas", "ocultas": ocultas})

    async def _gm_clima(self, ws, s, msg):
        c = self.estado.cambiar_clima(msg.get("indice"))
        await self._difundir({"tipo": "clima", "indice": self.estado.clima})
        await self._chat_sistema(f"🌦️ El clima cambia: {c['nombre']}.", local=False)
        await self._tras_evento_global()     # los efectos «solo con clima…» pueden cambiar bonos y visión en todas las salas

    async def _gm_periodo(self, ws, s, msg):
        p = self.estado.cambiar_periodo(msg.get("indice"))
        await self._difundir({"tipo": "periodo", "indice": self.estado.periodo})
        await self._chat_sistema(f"🕒 Ahora es: {p['nombre']}.", local=False)
        await self._tras_evento_global()     # efectos «solo de noche…» pueden cambiar bonos y visión en todas las salas

    async def _gm_iniciar_combate(self, ws, s, msg):
        modo = msg.get("modo")
        texto = self.estado.iniciar_combate(modo if isinstance(modo, str) else None)
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))     # efectos «solo en combate» cambian bonos y visión

    async def _tirar_iniciativa(self, ws, s, msg):
        """Fase de decidir turnos: el jugador tira la iniciativa de su personaje. Cuando han tirado todos, empieza el combate."""
        texto = self.estado.tirar_iniciativa(_texto(msg, "token"), s.usuario, s.es_gm)
        await self._chat_sistema(texto, categoria="dado", autor=s.usuario)
        if not self.estado.faltan_iniciativas():
            await self._gm_empezar_combate(ws, s, msg)
        else:
            await self._difundir_combate()

    async def _gm_empezar_combate(self, ws, s, msg):
        """El GM no espera más: se tira por quien falte y empieza el combate."""
        texto = self.estado.empezar_tras_tiradas()
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))

    async def _gm_combate_turnos(self, ws, s, msg):
        """{token, dentro: true|false} — el GM mete a un token en los turnos del combate o lo saca (sigue en el mapa)."""
        tid = _texto(msg, "token")
        texto = self.estado.combate_anadir(tid) if msg.get("dentro") is True else self.estado.combate_quitar(tid)
        await self._chat_sistema(texto, categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))        # «en combate» cambia efectos y bonos

    async def _gm_terminar_combate(self, ws, s, msg):
        self.estado.terminar_combate()
        await self._chat_sistema("🏳️ El combate ha terminado.", categoria="combate")
        await self._difundir_combate()
        await self._difundir_tokens(list(self.estado.tokens))

    async def _gm_cambiar_mapa(self, ws, s, msg):
        """«Llevar a todos aquí»: los personajes de los jugadores (de todas las salas) y todos los conectados pasan a esa sala."""
        destino = _texto(msg, "mapa")
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

    async def _cambiar_sala(self, ws, s, msg):
        """{mapa, token?} — el GM pasa a ver esa sala (sin mover a nadie). Un jugador se va a esa sala con su personaje activo
        (o el token que diga) si la mesa lo permite y la sala está abierta."""
        destino = _texto(msg, "mapa")
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

    async def _gm_mover_a_sala(self, ws, s, msg):
        """{token, mapa, x?, y?} — el GM lleva un token (y su grupo) de la sala que está viendo a otra."""
        tid, destino = _texto(msg, "token"), _texto(msg, "mapa")
        x = _entero(msg, "x") if msg.get("x") is not None else None
        y = _entero(msg, "y") if msg.get("y") is not None else None
        origen = self.estado.mapa_id
        nombre = self.estado.nombre_de(self.estado._token(tid))
        ids = self.estado.mover_a_sala(tid, destino, x, y)
        await self._chat_sistema(f"🚪 {nombre} se va a «{self.cat.mapas[destino]['nombre']}».")
        await self._llevar_sesiones(ids, origen, destino)
        self.estado.usar_sala(destino)
        await self._chat_sistema(f"🚪 {nombre} llega a la sala.")

    async def _gm_mostrar_token(self, ws, s, msg):
        """{token, barras?, nombre?} — en este token, los demás ven (true) o no (false) sus barras / su nombre; null = lo que diga la mesa."""
        tid = _texto(msg, "token")
        self.estado.fijar_mostrar(tid, **{k: msg[k] for k in ("barras", "nombre") if k in msg})
        await self._difundir_tokens([tid])

    async def _gm_sala_abierta(self, ws, s, msg):
        """{mapa, abierta} — si los jugadores pueden entrar solos en esa sala (con «cambiar_sala: todos»)."""
        self.estado.abrir_sala(msg.get("mapa"), msg.get("abierta"))
        await self._difundir_salas_mapa()


async def ejecutar(catalogo: Catalogo, estado: EstadoPartida, ssl_ctx=None):
    srv = Servidor(catalogo, estado)
    s = catalogo.config["servidor"]
    async with serve(srv.handler, s["host"], s["puerto"], max_size=2 ** 17, ssl=ssl_ctx):
        log.info("Servidor «%s» escuchando en %s://%s:%s", s["nombre"], "wss" if ssl_ctx else "ws", s["host"], s["puerto"])
        await asyncio.Future()
