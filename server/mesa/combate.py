"""combate.py — Combate por turnos: iniciativa, orden, movimiento por turno, quién participa y fin de turno.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from . import recursos
from .errores import ErrorJuego


class CombateMixin:
    def token_en_turno(self) -> str | None:
        c = self.combate
        if not c["activo"] or not c["orden"]:
            return None
        return c["orden"][c["indice"]]

    def modos_iniciativa(self) -> list[str]:
        """Modos entre los que puede elegir el GM al iniciar un combate (uno solo = no se pregunta)."""
        j = self.cfg["juego"]
        return list(j["iniciativa_opciones"]) if j["iniciativa"] == "preguntar" else [j["iniciativa"]]

    def iniciar_combate(self, modo: str | None = None) -> str:
        """Empieza un combate. Modos: «estadistica» (cada jugador tira su iniciativa; los NPC tiran solos), «valor» (de mayor a menor
        estadística, sin dado) o «manual» (el GM ordena). Con «estadistica» primero hay una fase de «decidir turnos»."""
        if self.combate["activo"] or self.combate.get("preparando"):
            raise ErrorJuego("Ya hay un combate en curso")
        modos = self.modos_iniciativa()
        modo = modo or modos[0]
        if modo not in modos:
            raise ErrorJuego("Ese modo de decidir los turnos no está permitido en esta campaña")
        participantes = [t for t in self.tokens.values() if not self.derrotado(t)]
        if len(participantes) < 2:
            raise ErrorJuego("Hace falta al menos 2 tokens para iniciar un combate")
        if modo == "manual":
            # Sin tiradas: primero los personajes y luego los NPC; el GM los reordena a su gusto (gm_orden_turnos).
            orden = sorted(participantes, key=lambda t: (t["tipo"] != "personaje", self.nombre_de(t).casefold()))
            # Fase de espera: el GM ordena a los participantes (ventanita) y pulsa «Listo»; los demás esperan.
            self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {},
                            "preparando": {"modo": "manual", "participantes": [t["id"] for t in orden], "orden": [t["id"] for t in orden], "tiradas": {}}}
            self.guardar_estado()
            return "🧭 ¡Combate! El GM está decidiendo el orden de los turnos."
        if modo == "valor":
            valores = [(self.stats_efectivas(t).get(self.estadistica_iniciativa(t), 0), self.rng.random(), t) for t in participantes]
            valores.sort(key=lambda e: (-e[0], e[1]))           # empate: al azar
            self._empezar([e[2] for e in valores], "valor", {e[2]["id"]: e[0] for e in valores})
            return f"⚔️ ¡Comienza el combate! Por orden de estadística: {', '.join(f'{self.nombre_de(e[2])} ({e[0]})' for e in valores)}"
        # «estadistica»: los NPC tiran ya; cada jugador tira la de sus personajes (o el GM empieza y se tira por quien falte)
        tiradas = {t["id"]: self._tirada_iniciativa(t) for t in participantes if t["tipo"] != "personaje"}
        self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {},
                        "preparando": {"participantes": [t["id"] for t in participantes], "tiradas": tiradas}}
        if all(t["id"] in tiradas for t in participantes):
            return self.empezar_tras_tiradas()
        self.guardar_estado()
        return "🎲 ¡Combate! Decidiendo los turnos: cada jugador tira la iniciativa de su personaje."

    def _tirada_iniciativa(self, t: dict) -> list:
        return [self.rng.randint(1, 20) + self.stats_efectivas(t).get(self.estadistica_iniciativa(t), 0), self.rng.random()]

    def tirar_iniciativa(self, token_id: str, usuario: str, es_gm: bool) -> str:
        p = self.combate.get("preparando")
        if not p:
            raise ErrorJuego("Ahora no se están decidiendo los turnos")
        if p.get("modo") == "manual":
            raise ErrorJuego("En este combate el GM decide el orden: no se tira iniciativa")
        t = self._token(token_id)
        if t["id"] not in p["participantes"] or not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes tirar la iniciativa de ese token")
        if t["id"] in p["tiradas"]:
            raise ErrorJuego("Ya tiró su iniciativa")
        p["tiradas"][t["id"]] = self._tirada_iniciativa(t)
        self.guardar_estado()
        return f"🎲 {self.nombre_de(t)} tira iniciativa: {p['tiradas'][t['id']][0]}"

    def faltan_iniciativas(self) -> list[str]:
        p = self.combate.get("preparando")
        return [i for i in p["participantes"] if i in self.tokens and i not in p["tiradas"]] if p else []

    def empezar_tras_tiradas(self) -> str:
        """Fin de la fase de decidir turnos: se tira por quien falte y empieza el combate en orden de tirada."""
        p = self.combate.get("preparando")
        if not p:
            raise ErrorJuego("Ahora no se están decidiendo los turnos")
        if p.get("modo") == "manual":                      # el GM marcó «Listo»: empieza en el orden que dejó
            orden = [self.tokens[i] for i in p["orden"] if i in self.tokens and not self.derrotado(self.tokens[i])]
            if len(orden) < 2:
                self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}}
                raise ErrorJuego("Hace falta al menos 2 tokens para iniciar un combate")
            self._empezar(orden, "manual")
            return f"⚔️ ¡Comienza el combate! Orden decidido por el GM: {', '.join(self.nombre_de(t) for t in orden)}"
        for i in self.faltan_iniciativas():
            p["tiradas"][i] = self._tirada_iniciativa(self.tokens[i])
        tiradas = sorted(((v[0], v[1], self.tokens[i]) for i, v in p["tiradas"].items() if i in self.tokens), key=lambda e: (-e[0], e[1]))
        if len(tiradas) < 2:
            self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}}
            raise ErrorJuego("Hace falta al menos 2 tokens para iniciar un combate")
        self._empezar([e[2] for e in tiradas], "estadistica", {e[2]["id"]: e[0] for e in tiradas})
        return f"⚔️ ¡Comienza el combate! Iniciativa: {', '.join(f'{self.nombre_de(e[2])} ({e[0]})' for e in tiradas)}"

    def _empezar(self, orden: list[dict], modo: str = "manual", valores: dict | None = None):
        # `modo` y `valores` (la iniciativa de cada uno) sirven para meter después a alguien en su sitio (combate_anadir)
        self.combate = {"activo": True, "orden": [t["id"] for t in orden], "indice": 0, "ronda": 1, "movido": {},
                        "con_enemigos": any(t.get("bando") == "enemigo" for t in orden), "modo": modo, "valores": dict(valores or {})}
        self.guardar_estado()
        self.al_empezar_turno(orden[0])

    def ordenar_turnos(self, orden) -> str:
        """El GM cambia el orden: mismos participantes, en otro orden. El turno sigue siendo de quien lo tenía."""
        c = self.combate
        prep = c.get("preparando")
        if prep and prep.get("modo") == "manual":          # todavía no empezó: se ordena la lista de espera
            if not isinstance(orden, list) or sorted(map(str, orden)) != sorted(prep["orden"]) or len(set(orden)) != len(orden):
                raise ErrorJuego("El nuevo orden debe tener a los mismos participantes")
            prep["orden"] = list(orden)
            self.guardar_estado()
            return "🔀 El GM está ordenando los turnos."
        if not c["activo"]:
            raise ErrorJuego("No hay ningún combate en curso")
        if not isinstance(orden, list) or sorted(map(str, orden)) != sorted(c["orden"]) or len(set(orden)) != len(orden):
            raise ErrorJuego("El nuevo orden debe tener a los mismos participantes")
        actual = self.token_en_turno()
        c["orden"] = list(orden)
        c["indice"] = c["orden"].index(actual)
        self.guardar_estado()
        return f"🔀 El GM cambió el orden de los turnos: {', '.join(self.nombre_de(self.tokens[i]) for i in c['orden'] if i in self.tokens)}"

    # Movimiento limitado en combate: cada uno anda, en su turno, como mucho las casillas de la campaña (o el valor de una estadística).
    def movimiento_max(self, token: dict) -> int | None:
        mv = self.cfg["juego"]["movimiento"]
        if not mv["limitado"]:
            return None
        if mv["estadistica"]:
            return max(0, int(self.stats_efectivas(token).get(mv["estadistica"], 0)))
        return mv["casillas"]

    def movimiento_restante(self, token: dict) -> int | None:
        mx = self.movimiento_max(token)
        if mx is None or not self.combate["activo"]:
            return None
        return max(0, mx - self.combate.setdefault("movido", {}).get(token["id"], 0))

    def pasos_hasta(self, desde: tuple[int, int], hasta: tuple[int, int], limite: int) -> int | None:
        """Casillas que hay que andar (sin muros ni lados cerrados), o None si no se llega en `limite` pasos."""
        if desde == hasta:
            return 0
        vistos, frontera = {desde}, [desde]
        for paso in range(1, limite + 1):
            nueva = []
            for x, y in frontera:
                for lado, (dx, dy) in recursos.LADOS.items():
                    n = (x + dx, y + dy)
                    if n in vistos or not self.puede_pasar(x, y, lado):
                        continue
                    if n == hasta:
                        return paso
                    vistos.add(n)
                    nueva.append(n)
            frontera = nueva
            if not frontera:
                break
        return None

    def estadistica_iniciativa(self, token: dict) -> str:
        """La de su primera opción que la cambie (p. ej. un tipo de ficha «Compañero» que usa Agilidad); si no, la de la campaña."""
        for op in self.opciones_elegidas(self.datos_de(token)):
            if op.get("iniciativa"):
                return op["iniciativa"]
        return self.cfg["juego"]["estadistica_iniciativa"]

    def terminar_combate(self):
        self.combate = {"activo": False, "orden": [], "indice": 0, "ronda": 1, "movido": {}}
        self.guardar_estado()

    def combate_sin_enemigos(self) -> bool:
        """Con `juego.fin_combate: automatico`: ¿el combate debe terminar porque ya no queda ningún NPC enemigo en pie?
        Solo cuenta si al empezar había enemigos (un combate entre aliados o jugadores no termina por esto)."""
        c = self.combate
        if not c["activo"] or self.cfg["juego"].get("fin_combate") != "automatico" or not c.get("con_enemigos"):
            return False
        return not any(t.get("bando") == "enemigo" and not self.derrotado(t) for t in self.tokens.values())

    # ── El GM decide quién participa: quitar o añadir tokens a los turnos ──
    def en_combate(self, token_id: str) -> bool:
        c = self.combate
        prep = c.get("preparando")
        return token_id in (prep["participantes"] if prep else c["orden"] if c["activo"] else [])

    def combate_quitar(self, token_id: str) -> str:
        """Saca a un token de los turnos (sigue en el mapa). Si era su turno, empieza el del siguiente."""
        c = self.combate
        if not c["activo"] and not c.get("preparando"):
            raise ErrorJuego("No hay ningún combate en curso")
        t = self._token(token_id)
        if not self.en_combate(token_id):
            raise ErrorJuego(f"{self.nombre_de(t)} no está en los turnos")
        era_su_turno = c["activo"] and self.token_en_turno() == token_id
        self._retirar_del_combate(token_id)
        texto = f"➖ {self.nombre_de(t)} sale de los turnos."
        if not self.combate["activo"] and not self.combate.get("preparando"):
            return texto + " El combate termina: queda menos de 2."
        if era_su_turno:
            for _ in range(len(c["orden"])):              # el siguiente en pie
                sig = self.tokens.get(c["orden"][c["indice"]])
                if sig and not self.derrotado(sig):
                    break
                c["indice"] = (c["indice"] + 1) % len(c["orden"])
            sig = self.tokens[c["orden"][c["indice"]]]
            c.setdefault("movido", {})[sig["id"]] = 0
            self.al_empezar_turno(sig)
            texto += f" Turno de {self.nombre_de(sig)}."
        self.guardar_estado()
        return texto

    def combate_anadir(self, token_id: str) -> str:
        """Mete a un token en los turnos. Con iniciativa por tirada o por estadística entra en su sitio (tira o se mira su estadística);
        con el orden a mano, al final (el GM lo mueve con las flechas). Nunca le quita el turno a quien lo tiene."""
        c = self.combate
        t = self._token(token_id)
        if self.derrotado(t):
            raise ErrorJuego(f"{self.nombre_de(t)} está derrotado")
        if self.en_combate(token_id):
            raise ErrorJuego(f"{self.nombre_de(t)} ya está en los turnos")
        prep = c.get("preparando")
        if prep:                                           # aún se deciden los turnos: entra en la lista de espera
            prep["participantes"].append(token_id)
            if prep.get("modo") == "manual":
                prep["orden"].append(token_id)
            elif t["tipo"] != "personaje":
                prep["tiradas"][token_id] = self._tirada_iniciativa(t)
            self.guardar_estado()
            return f"➕ {self.nombre_de(t)} entra en los turnos."
        if not c["activo"]:
            raise ErrorJuego("No hay ningún combate en curso")
        modo, valores = c.get("modo", "manual"), c.setdefault("valores", {})
        if modo == "estadistica":
            valor = self._tirada_iniciativa(t)[0]
            extra = f" (iniciativa {valor})"
        elif modo == "valor":
            valor = self.stats_efectivas(t).get(self.estadistica_iniciativa(t), 0)
            extra = f" ({valor})"
        else:
            valor, extra = None, " (al final: el GM puede moverlo)"
        if valor is None:
            pos = len(c["orden"])
        else:
            valores[token_id] = valor
            pos = next((i for i, o in enumerate(c["orden"]) if valores.get(o, float("-inf")) < valor), len(c["orden"]))
        c["orden"].insert(pos, token_id)
        if pos <= c["indice"]:
            c["indice"] += 1                               # el turno sigue siendo de quien lo tenía
        self.guardar_estado()
        return f"➕ {self.nombre_de(t)} entra en los turnos{extra}."

    def _retirar_del_combate(self, token_id: str):
        c = self.combate
        prep = c.get("preparando")
        if prep:                                          # todavía deciden los turnos: se le quita de la lista de espera
            prep["participantes"] = [i for i in prep["participantes"] if i != token_id]
            prep["tiradas"].pop(token_id, None)
            if "orden" in prep:
                prep["orden"] = [i for i in prep["orden"] if i != token_id]
        if token_id not in c["orden"]:
            return
        pos = c["orden"].index(token_id)
        c["orden"].remove(token_id)
        if pos < c["indice"]:
            c["indice"] -= 1
        if len(c["orden"]) < 2:      # un combate de un solo participante no tiene sentido
            self.terminar_combate()
        elif c["indice"] >= len(c["orden"]):
            c["indice"] = 0
            c["ronda"] += 1

    def terminar_turno(self, usuario: str, es_gm: bool) -> str:
        c = self.combate
        if not c["activo"]:
            raise ErrorJuego("No hay ningún combate en curso")
        actual = self._token(self.token_en_turno())
        if not self.puede_controlar(actual, usuario, es_gm):
            raise ErrorJuego("No es tu turno")
        self.al_terminar_turno(actual)
        n = len(c["orden"])
        for _ in range(n):
            c["indice"] += 1
            if c["indice"] >= n:
                c["indice"] = 0
                c["ronda"] += 1
            sig = self.tokens.get(c["orden"][c["indice"]])
            if sig and not self.derrotado(sig):
                break
        else:
            self.terminar_combate()
            return "🏁 Todos han sido derrotados: el combate termina."
        siguiente = self.tokens[c["orden"][c["indice"]]]
        c.setdefault("movido", {})[siguiente["id"]] = 0          # en su turno vuelve a tener todo su movimiento
        self.al_empezar_turno(siguiente)
        self.guardar_estado()
        return f"⏭️ Turno de {self.nombre_de(siguiente)}"
