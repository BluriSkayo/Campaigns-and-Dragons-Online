"""vistas.py — Lo que se envía a cada cliente: qué ve de cada token, del combate y de la partida entera.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

import copy

from .errores import ErrorJuego
from .utiles import SIN_VALOR


CAMPOS_REVELABLES = ("estadisticas", "recursos", "inventario", "habilidades", "ficha")


class VistasMixin:
    def campos_visibles(self, t: dict, usuario: str) -> set:
        """Qué datos de un token AJENO ve este jugador: lo que la mesa deja ver de jugadores o de NPC, más lo que el GM
        haya revelado en ese token. Si el propietario le bloqueó la visión, nada (salvo nombre, imagen y posición)."""
        if not self.cuenta_permite(usuario, "ver_ajenos"):
            return set()
        base = self.cfg["visibilidad"]["jugadores" if t["tipo"] == "personaje" else "npc"]
        return {k for k, on in base.items() if on} | set(t.get("revelado") or [])

    def mostrar_sobre_token(self, t: dict) -> dict:
        """¿Los demás ven las barras y el nombre de este token sobre el mapa? Lo que diga la mesa, salvo que el GM lo cambie en el token."""
        st = self.cfg["visibilidad"]["sobre_tokens"]
        quien = "jugadores" if t["tipo"] == "personaje" else "npc"
        propio = t.get("mostrar") if isinstance(t.get("mostrar"), dict) else {}
        return {k: propio[k] if isinstance(propio.get(k), bool) else st[f"{k}_{quien}"] for k in ("barras", "nombre")}

    def fijar_mostrar(self, token_id: str, barras=SIN_VALOR, nombre=SIN_VALOR) -> dict:
        """Acción de GM: en este token, los demás ven (True) o no (False) sus barras / su nombre; None = lo que diga la mesa."""
        t = self._token(token_id)
        m = dict(t.get("mostrar") or {})
        for k, val in (("barras", barras), ("nombre", nombre)):
            if val is SIN_VALOR:
                continue
            if val is not None and not isinstance(val, bool):
                raise ErrorJuego("Valor no válido")
            if val is None:
                m.pop(k, None)
            else:
                m[k] = val
        if m:
            t["mostrar"] = m
        else:
            t.pop("mostrar", None)
        self.guardar_estado()
        return self.mostrar_sobre_token(t)

    def revelar_token(self, token_id: str, campos) -> list:
        """Acción de GM: muestra (o vuelve a ocultar) a todos los jugadores datos concretos de un token."""
        t = self._token(token_id)
        if not isinstance(campos, list) or any(c not in CAMPOS_REVELABLES for c in campos):
            raise ErrorJuego("Esos datos no se pueden revelar")
        t["revelado"] = [c for c in CAMPOS_REVELABLES if c in campos]
        self.guardar_estado()
        return t["revelado"]

    def vista_token(self, t: dict, usuario: str, es_gm: bool) -> dict:
        if self.recalcular_maximos(t):                  # máximos calculados al día (un objeto equipado, un estado que acaba…)
            self.guardar_jugador(t["dueno"])
        d = self.datos_de(t)
        vida = self.cat.recurso_vida()
        completo = es_gm or self.controla(t, usuario)
        ver = CAMPOS_REVELABLES if completo else self.campos_visibles(t, usuario)
        mostrar = self.mostrar_sobre_token(t)
        if completo or "recursos" in ver:
            recursos = copy.deepcopy(d["recursos"])
        elif self.cuenta_permite(usuario, "ver_ajenos"):
            recursos = {vida: copy.deepcopy(d["recursos"][vida])}          # la vida se ve siempre (salvo visión bloqueada)
            if mostrar["barras"]:                                          # y los recursos que la mesa muestra como barra
                for r in self.cfg["visibilidad"]["sobre_tokens"]["barras"]:
                    if r in d["recursos"]:
                        recursos[r] = copy.deepcopy(d["recursos"][r])
        else:
            recursos = {}
        v = {"id": t["id"], "tipo": t["tipo"], "nombre": d["nombre"], "imagen": d["imagen"],
             "x": t["x"], "y": t["y"], "dueno": t["dueno"], "derrotado": self.derrotado(t),
             "personaje": t.get("personaje_id"), "recursos": recursos}
        v["bando"] = self.bando_de(t)
        if not completo:
            v["mostrar"] = mostrar                     # si los demás ven sus barras y su nombre sobre el mapa
        elif t.get("mostrar"):
            v["mostrar_propio"] = dict(t["mostrar"])   # el GM (y su dueño) ven qué se ha cambiado en este token
        if t.get("escala", 1) != 1:
            v["escala"] = t["escala"]
        if t.get("grupo"):
            v["grupo"] = t["grupo"]
        if t["tipo"] == "enemigo" and t.get("controlado_por") and self.npc_asignables():
            v["controlado_por"] = t["controlado_por"]
        v["estados"] = [{"id": e["id"], "turnos": e["turnos"], **({"cargas": e["cargas"]} if isinstance(e.get("cargas"), int) and e["cargas"] > 1 else {})} for e in self.estados_de(t)]
        if es_gm:
            v["revelado"] = list(t.get("revelado") or [])
            if t["tipo"] == "enemigo" and self.cfg["juego"]["niveles"]["activo"]:
                v["cede"] = self.experiencia_que_cede(t)              # experiencia que cede al caer (el GM puede cambiarla por token)
        if completo or "estadisticas" in ver:
            v.update(stats=self.stats_efectivas(t), stats_base=copy.deepcopy(d["stats"]), bonos=self.bonos_de(t))
            if self.cfg["juego"]["niveles"]["activo"]:
                v["nivel"] = self.nivel_de(t)
                if t["tipo"] == "personaje":
                    v["experiencia"] = self.experiencia_de(d)
        if completo or "habilidades" in ver:
            v["habilidades"] = list(d["habilidades"])
            v["habilidades_propias"] = copy.deepcopy((d.get("propias") or {}).get("habilidades", []))
        if completo or "inventario" in ver:
            v["inventario"] = copy.deepcopy(d["inventario"])
            v["dinero"] = d.get("dinero", 0)
            v["objetos_propios"] = copy.deepcopy((d.get("propias") or {}).get("objetos", []))
        if completo or "ficha" in ver:
            v.update(elecciones=dict(d.get("elecciones") or {}), rasgos=self.rasgos_de(d), personalidad=list(d.get("personalidad") or []),
                     etiquetas=self.etiquetas_de(t))
        if completo:
            v["puntos_pendientes"] = d.get("puntos_pendientes", 0)
            if self.cfg["juego"]["niebla"]["activa"]:
                v["vision"] = self.vision_de(t)
            v["sonidos"] = list(d.get("sonidos", []))
        if (completo or "ficha" in ver) and t["tipo"] == "personaje":
            privados = {c["nombre"] for c in self.cfg["juego"]["campos_ficha"] if c["privado"]}
            v["campos"] = {k: val for k, val in (d.get("campos") or {}).items() if completo or k not in privados}
            v["imagen_biografia"] = d.get("imagen_biografia", "")
            v["historia"] = d.get("historia", "")
        return v

    def vista_combate(self, usuario: str | None = None, es_gm: bool = True) -> dict:
        """El combate tal como lo ve este usuario: con niebla de guerra, los NPC que no ve no aparecen en el orden de iniciativa."""
        c = self.combate
        orden, turno = list(c["orden"]), self.token_en_turno()
        if self.niebla_activa() and not es_gm and usuario is not None:
            visibles = {i for i in orden if i in self.tokens and self.puede_ver(self.tokens[i], usuario, False)}
            orden = [i for i in orden if i in visibles]
            if turno not in visibles:
                turno = None
        res = {"activo": c["activo"], "orden": orden, "indice": c["indice"], "ronda": c["ronda"], "turno_de": turno}
        p = c.get("preparando")
        if p:     # decidiendo turnos: quién participa (lo que este usuario ve) y lo que ya ha sacado cada uno
            ven = [i for i in p["participantes"] if i in self.tokens and (es_gm or usuario is None or self.puede_ver(self.tokens[i], usuario, False))]
            res["preparando"] = {"modo": p.get("modo", "tirada"), "participantes": ven, "tiradas": {i: p["tiradas"][i][0] for i in ven if i in p["tiradas"]}}
            if p.get("modo") == "manual":
                res["preparando"]["orden"] = [i for i in p["orden"] if i in ven]
        en_turno = self.tokens.get(self.token_en_turno() or "")
        if c["activo"] and en_turno and self.movimiento_max(en_turno) is not None:
            res["movimiento"] = {"token": en_turno["id"], "max": self.movimiento_max(en_turno), "quedan": self.movimiento_restante(en_turno)}
        return res

    def snapshot(self, usuario: str, es_gm: bool) -> dict:
        return {
            "mapa_id": self.mapa_id,
            "salas_mapa": self.vista_salas(es_gm, self.mapa_id),
            "mapa": self.mapa_vivo,
            "tokens": [self.vista_token(t, usuario, es_gm) for t in self.tokens.values() if self.puede_ver(t, usuario, es_gm)],
            "combate": self.vista_combate(usuario, es_gm),
            "chat": self.chat_visible(usuario, es_gm, self.mapa_id),
            "salas": self.salas_visibles(usuario, es_gm),
            "tiendas": self.vista_tiendas(),
            "musica": self.musica,
            "ambiente": list(self.ambiente),
            "periodo": self.periodo,
            "clima": self.clima,
            "capas_ocultas": list(self.capas_ocultas),
            "niebla": self.mascara_niebla(usuario, es_gm),
            "niebla_activa": self.niebla_activa(),
            "dibujos": list(self.dibujos),
            "dibujo_bloqueado": self.dibujo_bloqueado,
        }
