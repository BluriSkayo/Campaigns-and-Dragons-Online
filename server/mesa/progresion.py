"""progresion.py — Cómo cambia un personaje: transformación (formas y evolución), experiencia y niveles.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from . import recursos
from .errores import ErrorJuego


class ProgresionMixin:
    # ── Transformación: cambiar de opción en un grupo de «formas» o de «evolución» ──
    def formas_posibles(self, token: dict, grupo: str, es_gm: bool) -> list[str]:
        """A qué opciones de ese grupo puede pasar ahora: en «formas», a cualquiera; en «evolución», a las que indica la actual (el GM, a cualquiera)."""
        g = self.cat.grupos.get(grupo)
        if not g or g["transformacion"] == "no":
            return []
        actual = (self.datos_de(token).get("elecciones") or {}).get(grupo)
        todas = [o for o in self.cat.opciones_de(grupo) if o != actual]
        if es_gm or g["transformacion"] == "formas":
            return todas
        return [o for o in (self.cat.opciones.get(actual, {}).get("evoluciona_a") or []) if o in todas]

    def transformar(self, token_id: str, opcion: str, usuario: str, es_gm: bool) -> str:
        """Cambia la opción de un grupo de formas (humano → lobo) o de evolución. Cambian bonos, rasgos, etiquetas, habilidades,
        recursos y estadísticas propias de la opción y la imagen; la vida y los demás recursos se mantienen en proporción."""
        t = self._token(token_id)
        if not es_gm:
            if not self.cfg["permisos"]["transformarse"]:
                raise ErrorJuego("En esta mesa solo el GM puede transformar a un personaje")
            if not self.puede_controlar(t, usuario, False):
                raise ErrorJuego("Solo puedes transformar a tus propios personajes")
            self._comprobar_turno(t, False)
        if opcion not in self.cat.opciones:
            raise ErrorJuego("Esa forma no existe")
        nueva = self.cat.opciones[opcion]
        grupo = nueva["grupo"]
        if opcion not in self.formas_posibles(t, grupo, es_gm):
            raise ErrorJuego("No puede transformarse en esa forma ahora")
        d = self.datos_de(t)
        antes = dict(d.get("elecciones") or {})
        despues = {**antes, grupo: opcion}
        for g in list(despues):                    # lo que dependía de la forma anterior («solo aparece si…») deja de valer
            if not self.grupo_activo(g, despues):
                del despues[g]
        # Estadísticas: se aplica la diferencia entre lo que fijaban las opciones de antes y las de ahora (los puntos ganados se conservan).
        sb_antes, sb_despues = self.cat.stats_base(antes), self.cat.stats_base(despues)
        definidas = {s["nombre"]: s for s in self.cfg["juego"]["estadisticas"]}
        for n in set(sb_antes) | set(sb_despues):
            if n not in sb_despues:
                if not definidas.get(n, {}).get("para_todos", True):
                    d["stats"].pop(n, None)
                continue
            nuevo = d["stats"].get(n, sb_antes.get(n, sb_despues[n])) + sb_despues[n] - sb_antes.get(n, sb_despues[n])
            e = definidas.get(n)
            d["stats"][n] = max(e["minimo"], min(e["maximo"], nuevo)) if e else nuevo
        # Recursos: máximos según las opciones nuevas, el valor actual en la misma proporción.
        rb_antes, rb_despues = self.cat.recursos_base(antes), self.cat.recursos_base(despues)
        vida = self.cat.recurso_vida()
        for n in set(rb_antes) | set(rb_despues):
            r = d["recursos"].get(n)
            if n not in rb_despues:
                if n != vida and not any(x["nombre"] == n and x.get("para_todos") for x in self.cfg["juego"]["recursos"]):
                    d["recursos"].pop(n, None)
                continue
            if rb_antes.get(n) == rb_despues[n] and r:
                continue
            if not r:
                d["recursos"][n] = self._recursos_nuevos({n: rb_despues[n]})[n]
                continue
            mx = max(1 if n == vida else 0, r["max"] + rb_despues[n] - rb_antes.get(n, r["max"]))
            r["actual"] = round(r["actual"] * mx / r["max"]) if r["max"] else min(r["actual"], mx)
            r["max"] = mx
        # Habilidades: se pierden las que solo daban las opciones de antes y se ganan las de las nuevas.
        de_antes = {h for o in antes.values() if o in self.cat.opciones for h in self.cat.opciones[o]["habilidades"]}
        de_ahora = [h for o in despues.values() if o in self.cat.opciones for h in self.cat.opciones[o]["habilidades"]]
        d["habilidades"] = [h for h in d.get("habilidades", []) if h not in de_antes or h in de_ahora]
        for h in de_ahora:
            if h not in d["habilidades"]:
                d["habilidades"].append(h)
        # Imagen del token: la de la forma, o la propia al volver a una forma sin imagen.
        if "imagen_propia" not in d:
            d["imagen_propia"] = d.get("imagen", "")
        d["imagen"] = nueva["imagen_forma"] or next((self.cat.opciones[o]["imagen_forma"] for o in despues.values()
                                                    if o in self.cat.opciones and self.cat.opciones[o]["imagen_forma"]), "") or d["imagen_propia"]
        d["elecciones"] = despues
        if t["tipo"] == "personaje":
            self.guardar_jugador(t["dueno"])
        self.guardar_estado()
        verbo = "evoluciona a" if self.cat.grupos[grupo]["transformacion"] == "evolucion" else "se transforma en"
        return f"✨ {d['nombre']} {verbo} {nueva['nombre']}."

    # ── Niveles y experiencia ────────────────────────────────
    def nivel_de(self, token: dict) -> int:
        if token["tipo"] == "personaje":
            return self.datos_de(token).get("nivel", 1)
        return token.get("nivel") or self.cat.enemigos.get(token.get("base"), {}).get("nivel", 1)

    def experiencia_de(self, p: dict) -> dict:
        """{total, por_tipo, siguiente (experiencia para el próximo nivel o None)} de un personaje (sus datos)."""
        n = self.cfg["juego"]["niveles"]
        por_tipo = {x: p["stats"].get(x, 0) for x in n["experiencia"]}
        nivel = p.get("nivel", 1)
        sig = n["umbrales"][nivel - 1] if n["modo"] == "experiencia" and nivel - 1 < len(n["umbrales"]) and nivel < recursos.nivel_maximo(self.cfg) else None
        anterior = n["umbrales"][nivel - 2] if n["modo"] == "experiencia" and 0 <= nivel - 2 < len(n["umbrales"]) else 0
        return {"total": sum(por_tipo.values()), "por_tipo": por_tipo, "siguiente": sig, "anterior": anterior}

    def experiencia_que_cede(self, token: dict) -> dict:
        """Lo que cede un NPC al ser derrotado ({tipo: cantidad}): lo que el GM puso a ese token o, si no, lo de su ficha de enemigo."""
        if token["tipo"] != "enemigo":
            return {}
        propia = token.get("experiencia")
        if isinstance(propia, dict):
            return propia
        return self.cat.enemigos.get(token.get("base"), {}).get("experiencia") or {}

    def _sumar_experiencia(self, token: dict, cantidades: dict) -> str:
        """Suma experiencia (por tipo) a un personaje, sin pasar del máximo de cada estadística, y sube de nivel si toca. → texto «Exp. combate +50»."""
        d = self.datos_de(token)
        definidas = {e["nombre"]: e for e in self.cfg["juego"]["estadisticas"]}
        partes = []
        for k, c in cantidades.items():
            e = definidas[k]
            antes = d["stats"].get(k, e["valor_inicial"])
            d["stats"][k] = max(e["minimo"], min(e["maximo"], antes + c))
            if d["stats"][k] != antes:
                partes.append(f"{k} {'+' if c > 0 else ''}{d['stats'][k] - antes}")
        self._guardar_afectados(token)
        self.revisar_nivel(token)
        return ", ".join(partes)

    def otorgar_experiencia(self, vencido: dict, vencedor: dict | None):
        """Un NPC acaba de ser derrotado: reparte la experiencia que cede, según `niveles.reparto` (todos los personajes en pie, o solo el vencedor).
        Una sola vez por token (si lo reviven y lo derrotan otra vez, no vuelve a dar)."""
        n = self.cfg["juego"]["niveles"]
        if not n["activo"] or vencido["tipo"] != "enemigo" or vencido.get("exp_cobrada"):
            return
        cede = {k: c for k, c in self.experiencia_que_cede(vencido).items() if c > 0 and k in n["experiencia"]}
        if not cede:
            return
        vencido["exp_cobrada"] = True
        if n["reparto"] == "vencedor":
            receptores = [vencedor] if vencedor is not None and vencedor["tipo"] == "personaje" else []
        else:
            receptores = [t for t in self.tokens.values() if t["tipo"] == "personaje" and not self.derrotado(t)]
        if not receptores:
            return
        texto = ", ".join(f"{k} +{c}" for k, c in cede.items())
        nombres = []
        for t in receptores:
            self._sumar_experiencia(t, cede)
            nombres.append(self.datos_de(t)["nombre"])
        self.cola_chat.append((f"🏆 {self.datos_de(vencido)['nombre']} cede experiencia ({texto}) a {', '.join(nombres)}", "sistema"))

    def revisar_nivel(self, token: dict) -> int:
        """En modo «experiencia», sube los niveles que correspondan a la experiencia total. → niveles subidos."""
        n = self.cfg["juego"]["niveles"]
        if not n["activo"] or n["modo"] != "experiencia" or token["tipo"] != "personaje":
            return 0
        p = self.datos_de(token)
        subidos = 0
        while p.get("nivel", 1) < recursos.nivel_maximo(self.cfg) and self.experiencia_de(p)["total"] >= n["umbrales"][p.get("nivel", 1) - 1]:
            self._subir_un_nivel(p)
            subidos += 1
        if subidos:
            self._marcar(token)
            self.guardar_jugador(p["dueno"])
        return subidos

    def _subir_un_nivel(self, p: dict):
        """Lo que da cada nivel: puntos para repartir, más máximo en algunos recursos y las habilidades que se aprenden a ese nivel."""
        n = self.cfg["juego"]["niveles"]
        p["nivel"] = p.get("nivel", 1) + 1
        nivel = p["nivel"]
        extras = []
        if n.get("entrega", "automatica") == "gm":         # el GM da a mano lo que corresponda (puntos, vida, habilidades…)
            self.cola_chat.append((f"🎉 {p['nombre']} sube a nivel {nivel} (el GM decide qué gana)", "sistema"))
            return
        opciones = self.opciones_elegidas(p)
        pn = n["por_nivel"]
        puntos = pn["puntos"] + sum(o.get("puntos_por_nivel", 0) for o in opciones)        # lo de la campaña + lo de su raza, clase…
        if puntos:
            p["puntos_pendientes"] = p.get("puntos_pendientes", 0) + puntos
            extras.append(f"+{puntos} puntos")
        suma_rec = dict(pn["recursos"])
        for o in opciones:
            for k, mas in o.get("recursos_por_nivel", {}).items():
                suma_rec[k] = suma_rec.get(k, 0) + mas
        vida = self.cat.recurso_vida()
        for k, mas in suma_rec.items():
            r = p["recursos"].get(k)
            if not r or not mas:
                continue
            r["max"] = max(1 if k == vida else 0, r["max"] + mas)
            r["actual"] = max(0, min(r["max"], r["actual"] + mas))
            extras.append(f"{k} {'+' if mas > 0 else ''}{mas}")
        aprende = list(n["aprende"]) + [a for o in opciones for a in o.get("aprende", [])]
        for a in aprende:
            if a["nivel"] == nivel and a["habilidad"] in self.cat.habilidades and a["habilidad"] not in p["habilidades"]:
                p["habilidades"].append(a["habilidad"])
                extras.append(f"aprende «{self.cat.habilidades[a['habilidad']]['nombre']}»")
        self.cola_chat.append((f"🎉 {p['nombre']} sube a nivel {nivel}{': ' + ', '.join(extras) if extras else ''}", "sistema"))

    def subir_nivel(self, usuario: str, personaje_id: str) -> str:
        """Acción del GM: sube un nivel a mano (en modo «manual» es la única forma; en «experiencia» sirve para premiar)."""
        if not self.cfg["juego"]["niveles"]["activo"]:
            raise ErrorJuego("Esta campaña no usa niveles")
        p = self.buscar_personaje(usuario, personaje_id) if isinstance(usuario, str) and isinstance(personaje_id, str) else None
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if p.get("nivel", 1) >= recursos.nivel_maximo(self.cfg):
            raise ErrorJuego(f"{p['nombre']} ya está en el nivel máximo ({recursos.nivel_maximo(self.cfg)})")
        self._subir_un_nivel(p)
        t = self.token_de_personaje(usuario, personaje_id)
        if t:
            self._marcar(t)
        self.guardar_jugador(usuario)
        return p["nombre"]
