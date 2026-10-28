"""chat.py — Dados, tiradas guardadas y chat (sala general y salas privadas que crea el GM).

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

import re

from . import formulas, recursos
from .errores import ErrorJuego
from .utiles import nuevo_id


MAX_TIRADAS = 30
RE_NOMBRE_TIRADA = re.compile(r"[\w][\w \-'+]{0,29}")


class ChatMixin:
    # ── Dados ────────────────────────────────────────────────
    _RE_DADO_SIMPLE = re.compile(r"^(\d{1,2})d(\d{1,4})\s*([+-]\s*\d{1,3})?$")

    def tirar(self, usuario: str, expresion: str, es_gm: bool = True) -> str:
        expresion = (expresion or "").strip()
        if not es_gm and not self.cfg["permisos"]["dados_personalizados"]:
            m = self._RE_DADO_SIMPLE.match(expresion)
            if not m or int(m.group(2)) not in self.cfg["juego"]["dados"]:
                raise ErrorJuego("En este servidor solo se pueden tirar los dados de la lista (d" + ", d".join(str(d) for d in self.cfg["juego"]["dados"]) + ")")
        try:
            r = formulas.evaluar(expresion, {}, None, self.rng, tablas=self.tablas())
        except formulas.FormulaError as e:
            raise ErrorJuego(f"Tirada inválida: {e}") from None
        return f"🎲 {usuario} tiró {expresion}: {r.valor}{recursos.DETALLE}{r.detalle}"

    # ── Tiradas guardadas ────────────────────────────────────
    def tiradas_de(self, usuario: str) -> list[dict]:
        return [dict(t) for t in self.tiradas_guardadas.get(usuario, [])]

    def _buscar_tirada(self, usuario: str, nombre: str) -> dict | None:
        n = (nombre or "").strip().casefold()
        return next((t for t in self.tiradas_guardadas.get(usuario, []) if t["nombre"].casefold() == n), None)

    def guardar_tirada(self, usuario: str, nombre, expresion, es_gm: bool) -> list[dict]:
        """Guarda (o reemplaza, si ya hay una con ese nombre) una tirada del usuario: «Ataque» → 1d20 + [Fuerza]."""
        if not es_gm and not self.cfg["permisos"]["dados_personalizados"]:
            raise ErrorJuego("En este servidor solo se pueden tirar los dados de la lista")
        if not isinstance(nombre, str) or not RE_NOMBRE_TIRADA.fullmatch(nombre.strip()):
            raise ErrorJuego("El nombre de la tirada debe tener de 1 a 30 letras, números o espacios")
        if not isinstance(expresion, str) or not expresion.strip() or len(expresion) > 100:
            raise ErrorJuego("Escribe la tirada (hasta 100 caracteres), por ejemplo 1d20 + [Fuerza]")
        nombre, expresion = nombre.strip(), expresion.strip()
        errores = formulas.validar(expresion, self.cat.nombres_formula(), self.tablas())
        if errores:
            raise ErrorJuego(f"Tirada inválida: {errores[0]}")
        lista = self.tiradas_guardadas.setdefault(usuario, [])
        previa = self._buscar_tirada(usuario, nombre)
        if previa:
            previa.update(nombre=nombre, expresion=expresion)
        elif len(lista) >= MAX_TIRADAS:
            raise ErrorJuego(f"Puedes guardar como mucho {MAX_TIRADAS} tiradas")
        else:
            lista.append({"nombre": nombre, "expresion": expresion})
        self.guardar_estado()
        return self.tiradas_de(usuario)

    def borrar_tirada(self, usuario: str, nombre) -> list[dict]:
        t = self._buscar_tirada(usuario, nombre if isinstance(nombre, str) else "")
        if not t:
            raise ErrorJuego("No tienes ninguna tirada con ese nombre")
        self.tiradas_guardadas[usuario].remove(t)
        if not self.tiradas_guardadas[usuario]:
            del self.tiradas_guardadas[usuario]
        self.guardar_estado()
        return self.tiradas_de(usuario)

    def tirar_guardada(self, usuario: str, nombre: str, token: dict | None) -> str:
        """Tira una tirada guardada. Si cita estadísticas ([Fuerza]), usa las del token elegido (que el usuario debe controlar)."""
        t = self._buscar_tirada(usuario, nombre)
        if not t:
            raise ErrorJuego("No tienes ninguna tirada con ese nombre")
        usa_stats = "[" in t["expresion"]
        if usa_stats and not token:
            raise ErrorJuego(f"«{t['nombre']}» usa estadísticas: elige antes uno de tus personajes en el mapa")
        try:
            r = formulas.evaluar(t["expresion"], self.stats_planas(token) if usa_stats else {}, None, self.rng, tablas=self.tablas())
        except formulas.FormulaError as e:
            raise ErrorJuego(f"Tirada inválida: {e}") from None
        quien = f"{self.datos_de(token)['nombre']} ({usuario})" if usa_stats else usuario
        return f"🎲 {quien} tiró «{t['nombre']}»: {r.valor}{recursos.DETALLE}{r.detalle}"

    # ── Salas de chat ────────────────────────────────────────
    def puede_ver_sala(self, usuario: str, es_gm: bool, sala: str) -> bool:
        if sala == "general" or es_gm:
            return sala == "general" or sala in self.salas_chat
        s = self.salas_chat.get(sala)
        return bool(s) and usuario.casefold() in (m.casefold() for m in s["miembros"])

    def salas_visibles(self, usuario: str, es_gm: bool) -> list[dict]:
        return [{"id": s["id"], "nombre": s["nombre"], "miembros": list(s["miembros"])}
                for s in self.salas_chat.values() if self.puede_ver_sala(usuario, es_gm, s["id"])]

    def ve_mensaje(self, m: dict, usuario: str, es_gm: bool, mapa: str | None) -> bool:
        """Un mensaje de una sala de chat privada, solo sus participantes. Uno que ocurrió en un mapa (combate, lo que dice un
        personaje…), solo quien está en esa sala; el GM lo ve todo."""
        if not self.puede_ver_sala(usuario, es_gm, m.get("sala", "general")):
            return False
        return es_gm or not m.get("mapa") or m["mapa"] == mapa

    def chat_visible(self, usuario: str, es_gm: bool, mapa: str | None = None) -> list[dict]:
        return [self.mensaje_para(m, es_gm) for m in self.chat if self.ve_mensaje(m, usuario, es_gm, mapa)]

    def hablante(self, token_id, usuario: str, es_gm: bool) -> dict:
        """Hablar en el chat como uno de tus tokens (de la sala actual): el GM, como cualquiera. → {token, nombre, imagen}."""
        t = self.tokens.get(token_id) if isinstance(token_id, str) else None
        if t is None:
            raise ErrorJuego("Ese personaje no está en esta sala")
        if not (es_gm or self.controla(t, usuario)):
            raise ErrorJuego("Solo puedes hablar como uno de tus personajes")
        d = self.datos_de(t)
        return {"token": t["id"], "nombre": d["nombre"], "imagen": d.get("imagen", "")}

    def mensaje_para(self, m: dict, es_gm: bool) -> dict:
        """El detalle de una tirada (cada dado, cada suma) lo ve el GM siempre; los jugadores, solo si la campaña lo activa."""
        if "detalle" in m and not es_gm and not self.cfg["juego"]["chat"].get("detalle_tiradas", False):
            return {k: v for k, v in m.items() if k != "detalle"}
        return m

    def _miembros_validos(self, miembros) -> list[str]:
        if not isinstance(miembros, list) or len(miembros) > 100 or not all(isinstance(m, str) and re.fullmatch(r"[\w\- ]{1,20}", m.strip()) for m in miembros):
            raise ErrorJuego("La lista de participantes no es válida")
        vistos, res = set(), []
        for m in miembros:
            m = m.strip()
            if m.casefold() not in vistos:
                vistos.add(m.casefold())
                res.append(m)
        return res

    def _nombre_sala(self, nombre, excepto: str | None = None) -> str:
        if not isinstance(nombre, str) or not (1 <= len(nombre.strip()) <= 24):
            raise ErrorJuego("El nombre de la sala debe tener entre 1 y 24 caracteres")
        nombre = nombre.strip()
        if nombre.casefold() == "general" or any(s["nombre"].casefold() == nombre.casefold() and s["id"] != excepto for s in self.salas_chat.values()):
            raise ErrorJuego("Ya existe una sala con ese nombre")
        return nombre

    def crear_sala(self, nombre, miembros) -> dict:
        if not self.cfg["juego"]["salas_chat"]:
            raise ErrorJuego("En esta mesa no hay salas de chat privadas")
        if len(self.salas_chat) >= 20:
            raise ErrorJuego("Ya hay demasiadas salas (máximo 20)")
        sala = {"id": nuevo_id(), "nombre": self._nombre_sala(nombre), "miembros": self._miembros_validos(miembros)}
        self.salas_chat[sala["id"]] = sala
        self.guardar_estado()
        return sala

    def editar_sala(self, sala_id, nombre=None, miembros=None) -> dict:
        s = self.salas_chat.get(sala_id) if isinstance(sala_id, str) else None
        if not s:
            raise ErrorJuego("Esa sala no existe")
        if nombre is not None:
            s["nombre"] = self._nombre_sala(nombre, excepto=sala_id)
        if miembros is not None:
            s["miembros"] = self._miembros_validos(miembros)
        self.guardar_estado()
        return s

    def borrar_sala(self, sala_id) -> dict:
        s = self.salas_chat.pop(sala_id, None) if isinstance(sala_id, str) else None
        if not s:
            raise ErrorJuego("Esa sala no existe")
        self.chat = [m for m in self.chat if m.get("sala", "general") != sala_id]
        self.guardar_estado()
        return s

    def limpiar_chat(self, sala_id="general") -> int:
        """El GM vacía el chat de una sala (la general o una privada) para todos. → cuántos mensajes se borraron."""
        if not isinstance(sala_id, str) or (sala_id != "general" and sala_id not in self.salas_chat):
            raise ErrorJuego("Esa sala no existe")
        antes = len(self.chat)
        self.chat = [m for m in self.chat if m.get("sala", "general") != sala_id]
        self.guardar_estado()
        return antes - len(self.chat)

    def anadir_chat(self, autor: str, texto: str, categoria: str = "normal", sala: str = "general",
                    mapa: str | None = None, personaje: dict | None = None) -> dict:
        """`mapa`: el mensaje es de esa sala (solo lo ve quien está allí, y el GM). `personaje`: lo dice uno de sus tokens."""
        texto, _, detalle = texto.partition(recursos.DETALLE)       # el detalle de la tirada va aparte: no todos lo ven
        msg = {"autor": autor, "texto": texto, "categoria": categoria}
        if detalle:
            msg["detalle"] = detalle
        if sala != "general":
            msg["sala"] = sala
        elif mapa:                    # en una sala de chat privada manda la sala de chat, no el mapa
            msg["mapa"] = mapa
        if personaje:
            msg["personaje"] = {"nombre": personaje["nombre"], "imagen": personaje.get("imagen", "")}
        self.chat.append(msg)
        del self.chat[:-self.cfg["juego"]["max_mensajes_chat"]]
        return msg
