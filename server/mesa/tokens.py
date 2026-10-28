"""tokens.py — Tokens del mapa: datos, colocar y quitar, edición del GM, control, movimiento, tamaño, grupos y bandos.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

import copy

from . import recursos
from .errores import ErrorJuego
from .utiles import nuevo_id, rango_de


class TokensMixin:
    def datos_de(self, token: dict) -> dict:
        """Dict que contiene stats/recursos/habilidades/inventario del token."""
        if token["tipo"] == "personaje":
            p = self.buscar_personaje(token["dueno"], token["personaje_id"])
            if p is None:
                raise ErrorJuego("El personaje de este token ya no existe")
            return p
        return token

    def nombre_de(self, token: dict) -> str:
        return self.datos_de(token)["nombre"]

    def stats_planas(self, token: dict) -> dict:
        """Estadísticas + valor actual de recursos, para usar en fórmulas."""
        d = self.datos_de(token)
        planas = {n: 0 for n in self.cat.nombres_stats() + self.cat.nombres_recursos()}   # lo que no tenga cuenta como 0
        planas.update(self.stats_efectivas(token))
        planas.update({n: r["actual"] for n, r in d["recursos"].items()})
        planas[recursos.CARGAS] = 1                                 # fuera de un estado acumulado, [Cargas] vale 1
        if self.cfg["juego"]["niveles"]["activo"]:
            planas[recursos.NIVEL] = self.nivel_de(token)
        for s in self.cfg["juego"]["estadisticas"]:                # [Rango Valentía]: el rango que le toca a esa estadística por su valor
            if s.get("escalones"):
                planas[f"{recursos.RANGO} {s['nombre']}"] = rango_de(s["escalones"], planas.get(s["nombre"], 0))
        return planas

    def derrotado(self, token: dict) -> bool:
        return self.datos_de(token)["recursos"][self.cat.recurso_vida()]["actual"] <= 0

    def colocar_personaje(self, usuario: str, personaje_id: str) -> tuple[dict, bool]:
        """Pone el token del personaje en el mapa (si ya estaba, lo reutiliza). → (token, es_nuevo)"""
        return self.desplegar_personaje(usuario, personaje_id, usuario, False)

    def colocar_enemigo(self, enemigo_id: str, x: int, y: int) -> dict:
        """Coloca un NPC (aliado, neutral o enemigo, según su ficha). `tipo: "enemigo"` es el nombre interno de «no jugador»."""
        base = self.cat.enemigos.get(enemigo_id)
        if not base:
            raise ErrorJuego("Ese NPC no existe")
        if not self.casilla_transitable(x, y):
            raise ErrorJuego("No se puede colocar ahí: casilla bloqueada o fuera del mapa")
        if self.casilla_ocupada(x, y):
            raise ErrorJuego("Esa casilla ya está ocupada")
        nombre = base["nombre"]
        repetidos = sum(1 for t in self.tokens.values() if t["tipo"] == "enemigo" and t["base"] == enemigo_id)
        if repetidos:
            nombre = f"{nombre} {repetidos + 1}"
        t = {
            "id": nuevo_id(), "tipo": "enemigo", "dueno": None, "base": enemigo_id, "x": x, "y": y, "bando": base["bando"],
            "nombre": nombre, "imagen": base["imagen"], "estados": [],
            "elecciones": dict(base.get("elecciones") or {}),
            "stats": copy.deepcopy(base["stats"]),
            "recursos": self._recursos_nuevos(base["recursos"]),
            "habilidades": list(base["habilidades"]),
            "inventario": copy.deepcopy(base["inventario"]),
            "dinero": base.get("dinero", 0),
            "sonidos": list(base.get("sonidos", [])),
        }
        self.tokens[t["id"]] = t
        self.guardar_estado()
        return t

    def quitar_token(self, token_id: str) -> None:
        t = self._token(token_id)
        resto = [o for o in self.tokens_del_grupo(t) if o is not t]
        if len(resto) == 1:
            resto[0].pop("grupo", None)          # un grupo de uno ya no es un grupo
        self.tokens.pop(token_id)
        if self.combate["activo"] or self.combate.get("preparando"):
            self._retirar_del_combate(t["id"])
        self.guardar_estado()

    def editar_token(self, token_id: str, nombre=None, stats=None, recursos=None, bando=None, dar_experiencia=None, cede=None,
                     controlado_por=False, usuarios_validos=(), dueno=False, usuarios_dueno=None) -> str:
        """Acción de GM: cambia nombre, estadísticas o recursos (actual/máximo) de cualquier token; da experiencia a un personaje (`dar_experiencia`:
        {tipo: cantidad que se SUMA}) o fija cuánta cede un NPC al caer (`cede`: {tipo: cantidad}).
        `controlado_por` y `dueno`: False = no se toca. Primero se valida todo; si algo falla, no cambia nada."""
        t = self._token(token_id)
        d = self.datos_de(t)
        if nombre is not None:
            if not isinstance(nombre, str) or not nombre.strip():
                raise ErrorJuego("El nombre no puede estar vacío")
            nombre = nombre.strip()[:60]
        nuevas_stats = self._stats_editadas(stats)
        nuevos_rec = self._recursos_editados(t, d, recursos)
        if bando is not None:
            if bando not in ("aliado", "neutral", "enemigo") or t["tipo"] == "personaje":
                raise ErrorJuego("El bando solo se puede cambiar a un NPC (aliado, neutral o enemigo)")
        niv = self.cfg["juego"]["niveles"]
        dar = {}
        if dar_experiencia:
            if not niv["activo"]:
                raise ErrorJuego("Esta campaña no usa niveles ni experiencia")
            if t["tipo"] != "personaje":
                raise ErrorJuego("Solo los personajes ganan experiencia")
            dar = self._cantidades_exp(dar_experiencia, niv, permitir_negativas=True)
        fija = None
        if cede is not None:
            if t["tipo"] != "enemigo":
                raise ErrorJuego("Solo un NPC puede ceder experiencia")
            fija = self._cantidades_exp(cede, niv, permitir_negativas=False, permitir_cero=True)
        if controlado_por is not False:
            controlado_por = self._control_editado(t, controlado_por, usuarios_validos)
        if dueno is not False:
            dueno = self._dueno_editado(t, d, dueno, nombre, usuarios_dueno if usuarios_dueno is not None else usuarios_validos)

        # Todo validado: ahora se aplica.
        cambios = []
        if dueno is not False and dueno != t["dueno"]:
            cambios.append(f"ahora es de {dueno}")
            self._traspasar_personaje(t, dueno)
        if controlado_por is not False and controlado_por != t.get("controlado_por"):
            cambios.append(f"controlado por → {controlado_por or 'solo el GM'}")
            if controlado_por:
                t["controlado_por"] = controlado_por
            else:
                t.pop("controlado_por", None)
            self._cache_vision.clear()
        if bando is not None and bando != self.bando_de(t):
            cambios.append(f"bando → {bando}")
            t["bando"] = bando
        if nombre is not None and nombre != d["nombre"]:
            cambios.append(f"nombre → {nombre}")
            d["nombre"] = nombre
        for k, val in nuevas_stats.items():
            if d["stats"].get(k) != val:
                cambios.append(f"{k} {d['stats'].get(k)} → {val}")
                d["stats"][k] = val
        for k, val in nuevos_rec.items():
            if d["recursos"][k] != val:
                cambios.append(f"{k} {d['recursos'][k]['actual']}/{d['recursos'][k]['max']} → {val['actual']}/{val['max']}")
                d["recursos"][k] = val
        if dar:
            cambios.append(f"experiencia {self._sumar_experiencia(t, dar) or '(sin cambios: ya en el máximo)'}")
        if fija is not None and fija != self.experiencia_que_cede(t):
            t["experiencia"] = fija
            cambios.append("experiencia que cede → " + (", ".join(f"{k} {c}" for k, c in fija.items()) or "ninguna"))
        self._guardar_afectados(t)
        if nuevas_stats:
            self.revisar_nivel(t)
        return "; ".join(cambios)

    def _stats_editadas(self, stats) -> dict:
        definidas = {e["nombre"]: e for e in self.cat.config["juego"]["estadisticas"]}
        nuevas = {}
        for k, val in (stats or {}).items():
            if k not in definidas:
                raise ErrorJuego(f"La estadística «{k}» no existe")
            if isinstance(val, bool) or not isinstance(val, int):
                raise ErrorJuego(f"«{k}» debe ser un número entero")
            e = definidas[k]
            if not (e["minimo"] <= val <= e["maximo"]):
                raise ErrorJuego(f"«{k}» debe estar entre {e['minimo']} y {e['maximo']}")
            nuevas[k] = val
        return nuevas

    def _recursos_editados(self, t: dict, d: dict, recursos) -> dict:
        """{recurso: {actual, max}} validados contra lo que tiene el token (un máximo con fórmula no se cambia a mano)."""
        vida = self.cat.recurso_vida()
        nuevos = {}
        for k, val in (recursos or {}).items():
            if k not in d["recursos"]:
                raise ErrorJuego(f"El recurso «{k}» no existe")
            if not isinstance(val, dict):
                raise ErrorJuego(f"«{k}» debe indicar actual y máximo")
            r = d["recursos"][k]
            mx, ac = val.get("max", r["max"]), val.get("actual", r["actual"])
            if any(isinstance(n, bool) or not isinstance(n, int) for n in (mx, ac)):
                raise ErrorJuego(f"«{k}»: actual y máximo deben ser números enteros")
            if mx < (1 if k == vida else 0):
                raise ErrorJuego(f"El máximo de «{k}» no puede ser {mx}")
            if mx != r["max"] and t["tipo"] == "personaje" and any(x["nombre"] == k and x.get("maximo_formula") for x in self.cat.config["juego"]["recursos"]):
                raise ErrorJuego(f"El máximo de «{k}» lo calcula su fórmula (Reglas → Estadísticas y recursos): cambia el valor actual o las estadísticas")
            if not (0 <= ac <= mx):
                raise ErrorJuego(f"El valor actual de «{k}» debe estar entre 0 y {mx}")
            nuevos[k] = {"actual": ac, "max": mx}
        return nuevos

    def _control_editado(self, t: dict, controlado_por, usuarios_validos) -> str | None:
        """Quién controla un NPC: None o "" = solo el GM; texto = ese jugador."""
        if t["tipo"] != "enemigo":
            raise ErrorJuego("Solo se puede dar el control de un NPC")
        if not self.npc_asignables():
            raise ErrorJuego("En esta mesa los NPC solo los controla el GM (Editor → Reglas → Funciones de la mesa)")
        if controlado_por and controlado_por not in usuarios_validos:
            raise ErrorJuego(f"No hay ningún jugador llamado «{controlado_por}»")
        return controlado_por or None

    def _dueno_editado(self, t: dict, d: dict, dueno, nombre: str | None, usuarios) -> str:
        """A qué usuario pasa un personaje (sin distinguir mayúsculas); no puede chocar con otro personaje suyo del mismo nombre."""
        if t["tipo"] != "personaje":
            raise ErrorJuego("Solo se puede cambiar de dueño a un personaje (a un NPC se le da el control)")
        if not self.cfg["permisos"].get("sin_ficha"):
            raise ErrorJuego("Para asignar personajes a otros usuarios, activa «Los jugadores pueden entrar sin ficha» (Editor → Reglas → Creación de personajes)")
        if not isinstance(dueno, str) or not dueno.strip():
            raise ErrorJuego("Elige a qué usuario pasa el personaje")
        buscado = dueno.strip()
        dueno = next((u for u in usuarios if u.casefold() == buscado.casefold()), None)
        if dueno is None:
            raise ErrorJuego(f"No hay ningún usuario llamado «{buscado[:30]}»")
        if dueno != t["dueno"]:
            self.registrar_usuario(dueno)
            nombre_final = nombre if nombre is not None else d["nombre"]
            if any(p["nombre"].casefold() == nombre_final.casefold() for p in self.personajes_de(dueno)):
                raise ErrorJuego(f"{dueno} ya tiene un personaje llamado «{nombre_final}»")
        return dueno

    def gm_estado(self, token_id: str, estado_id, poner) -> str:
        """Acción de GM en plena partida: pone (con su duración) o quita un estado a cualquier token. → texto para el chat."""
        t = self._token(token_id)
        if not isinstance(estado_id, str) or estado_id not in self.cat.estados or not isinstance(poner, bool):
            raise ErrorJuego("Ese estado no existe")
        est = self.cat.estados[estado_id]
        lista = t.setdefault("estados", [])
        ya = next((e for e in lista if e["id"] == estado_id), None)
        nombre = self.datos_de(t)["nombre"]
        if poner:
            puesto = self.poner_estado(t, estado_id) or est["nombre"]
            txt = f"🌀 El GM pone «{puesto}» a {nombre}"
        else:
            if not ya:
                raise ErrorJuego(f"{nombre} no tiene «{est['nombre']}»")
            self.quitar_estado_de(t, estado_id, "se_quita")
            txt = f"🌀 El GM quita «{est['nombre']}» a {nombre}"
        self._marcar(t)
        self.guardar_estado()
        return txt

    def gm_habilidad(self, token_id: str, habilidad_id, poner) -> tuple[str, dict]:
        """Acción de GM en plena partida: da (`poner`) o quita una habilidad a cualquier token. En un personaje cambia su ficha;
        en un NPC, solo ese token (la ficha del NPC en la campaña no cambia). → (texto para el chat, token)."""
        t = self._token(token_id)
        if not isinstance(habilidad_id, str) or habilidad_id not in self.cat.habilidades or not isinstance(poner, bool):
            raise ErrorJuego("Esa habilidad no existe")
        d = self.datos_de(t)
        lista = d.setdefault("habilidades", [])
        nombre_h = self.cat.habilidades[habilidad_id]["nombre"]
        if poner:
            if habilidad_id in lista:
                raise ErrorJuego(f"{d['nombre']} ya tiene «{nombre_h}»")
            lista.append(habilidad_id)
            txt = f"✨ El GM da «{nombre_h}» a {d['nombre']}"
        else:
            if habilidad_id not in lista:
                raise ErrorJuego(f"{d['nombre']} no tiene «{nombre_h}»")
            lista.remove(habilidad_id)
            txt = f"✨ El GM quita «{nombre_h}» a {d['nombre']}"
        self._guardar_afectados(t)
        return txt, t

    @staticmethod
    def _cantidades_exp(crudo, niv: dict, permitir_negativas: bool, permitir_cero: bool = False) -> dict:
        """Valida {tipo de experiencia: cantidad entera} que llega del cliente."""
        if not isinstance(crudo, dict):
            raise ErrorJuego("La experiencia debe indicar tipo y cantidad")
        res = {}
        for k, c in crudo.items():
            if k not in niv["experiencia"]:
                raise ErrorJuego(f"«{k}» no es un tipo de experiencia de esta campaña")
            if isinstance(c, bool) or not isinstance(c, int) or abs(c) > 1_000_000 or (c < 0 and not permitir_negativas):
                raise ErrorJuego(f"La experiencia de «{k}» debe ser un número entero{'' if permitir_negativas else ' sin signo'} (máximo 1000000)")
            if c != 0 or permitir_cero:
                res[k] = c
        return res

    def cambiar_objeto(self, token_id: str, objeto_id: str, cantidad: int) -> str:
        """Acción de GM: da (cantidad > 0) o quita (cantidad < 0) objetos del inventario de un token."""
        t = self._token(token_id)
        if objeto_id not in self.cat.objetos:
            raise ErrorJuego("Ese objeto no existe")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 999:
            raise ErrorJuego("La cantidad debe ser un entero distinto de 0 (máximo 999)")
        d = self.datos_de(t)
        entrada = next((e for e in d["inventario"] if e["objeto"] == objeto_id), None)
        if entrada is None:
            if cantidad < 0:
                raise ErrorJuego("Ese token no tiene ese objeto")
            d["inventario"].append({"objeto": objeto_id, "cantidad": cantidad})
        else:
            entrada["cantidad"] += cantidad
            if entrada["cantidad"] <= 0:
                d["inventario"].remove(entrada)
        self._guardar_afectados(t)
        return self.cat.objetos[objeto_id]["nombre"]

    def cambiar_dinero(self, token_id: str, cantidad: int) -> int:
        """Acción de GM: da (cantidad > 0) o quita (cantidad < 0) dinero a un token. No baja de 0. Devuelve lo que ya tiene."""
        t = self._token(token_id)
        if not self.cfg["juego"]["moneda"]["activa"]:
            raise ErrorJuego("Esta campaña no usa dinero")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 10 ** 9:
            raise ErrorJuego("La cantidad debe ser un entero distinto de 0")
        d = self.datos_de(t)
        d["dinero"] = max(0, min(10 ** 9, d.get("dinero", 0) + cantidad))
        self._guardar_afectados(t)
        return d["dinero"]

    # ── Control y movimiento ─────────────────────────────────
    def _token(self, token_id) -> dict:
        t = self.tokens.get(token_id)
        if not t:
            raise ErrorJuego("Ese token no existe")
        return t

    def controla(self, token: dict, usuario: str) -> bool:
        """¿Este jugador maneja el token? Su personaje, o un NPC que el GM le ha dado (`controlado_por`, si la mesa lo permite)."""
        if token["tipo"] == "personaje":
            return token["dueno"] == usuario
        return bool(usuario) and self.npc_asignables() and token.get("controlado_por") == usuario

    def npc_asignables(self) -> bool:
        """¿El GM puede dar NPC a los jugadores? Con «dar NPC a los jugadores» o con «entrar sin ficha» (que lo incluye)."""
        p = self.cfg["permisos"]
        return bool(p["npc_para_jugadores"] or p.get("sin_ficha"))

    def puede_controlar(self, token: dict, usuario: str, es_gm: bool) -> bool:
        return es_gm or self.controla(token, usuario)

    def _comprobar_turno(self, token: dict, es_gm: bool):
        if (self.combate["activo"] and not es_gm
                and self.cfg["permisos"]["acciones_solo_en_su_turno"]
                and token["id"] != self.token_en_turno()):
            raise ErrorJuego("No es el turno de ese personaje")

    def mover_token(self, token_id: str, x: int, y: int, usuario: str, es_gm: bool) -> dict:
        t = self._token(token_id)
        propio = self.puede_controlar(t, usuario, es_gm)
        if not propio and not (self.cfg["permisos"]["mover_tokens_ajenos"] and t["tipo"] == "personaje"):
            raise ErrorJuego("No puedes mover ese token")
        if propio:
            self._comprobar_turno(t, es_gm)
        elif self.combate["activo"] and not es_gm:
            raise ErrorJuego("No puedes mover tokens ajenos durante el combate")
        if not self.casilla_transitable(x, y):
            raise ErrorJuego("No se puede ir ahí: casilla bloqueada o fuera del mapa")
        impide = None if es_gm else self.impedido(t, "mover")
        if impide:
            raise ErrorJuego(f"«{impide}» no le deja moverse")
        # Fuera de combate, todo el grupo se mueve a la vez, lo mueva quien lo mueva (los que no puedan, se quedan donde están).
        acompanan = [] if self.combate["activo"] else [o for o in self.tokens_del_grupo(t) if o is not t and not self.impedido(o, "mover")]
        if any(o["x"] == x and o["y"] == y for o in self.tokens.values() if o is not t and o not in acompanan):
            raise ErrorJuego("Esa casilla ya está ocupada")
        if not es_gm and t.get("x", -1) >= 0 and not self.hay_camino((t["x"], t["y"]), (x, y)):
            raise ErrorJuego("No hay camino hasta ahí: hay muros o lados cerrados en medio")
        if not es_gm:
            self.intentar(t, {"mover"})                 # «Al intentar: moverse» (hemorragia, raíces que lo impiden a veces…)
        quedan = None if es_gm else self.movimiento_restante(t)
        if quedan is not None:
            pasos = self.pasos_hasta((t["x"], t["y"]), (x, y), quedan)
            if pasos is None:
                raise ErrorJuego(f"No llegas: te {'queda' if quedan == 1 else 'quedan'} {quedan} {'casilla' if quedan == 1 else 'casillas'} de movimiento en este turno")
            self.combate["movido"][t["id"]] = self.combate["movido"].get(t["id"], 0) + pasos
        dx, dy = x - t["x"], y - t["y"]
        del_grupo = {o["id"] for o in acompanan} | {t["id"]}
        ajenas = {(o["x"], o["y"]) for o in self.tokens.values() if o["id"] not in del_grupo}
        van = {o["id"]: (o["x"] + dx, o["y"] + dy) for o in acompanan
               if self.casilla_transitable(o["x"] + dx, o["y"] + dy) and (o["x"] + dx, o["y"] + dy) not in ajenas
               and (es_gm or self.hay_camino((o["x"], o["y"]), (o["x"] + dx, o["y"] + dy)))}
        while True:                            # quien no puede moverse se queda: nadie del grupo puede acabar en su casilla
            quietas = {(o["x"], o["y"]) for o in acompanan if o["id"] not in van}
            fuera = [i for i, dest in van.items() if dest in quietas]
            if not fuera:
                break
            for i in fuera:
                del van[i]
        if (x, y) in {(o["x"], o["y"]) for o in acompanan if o["id"] not in van}:
            raise ErrorJuego("Esa casilla ya está ocupada")
        t["x"], t["y"] = x, y
        movidos = [t]
        for o in acompanan:
            if o["id"] in van:
                o["x"], o["y"] = van[o["id"]]
                movidos.append(o)
        for m in movidos:
            self.disparar("al_entrar", m)       # lo que haga ese tile (daño, estados…) queda en las colas
        self.guardar_estado()
        self.ultimos_movidos = [m["id"] for m in movidos]
        return t

    # ── Tamaño y grupos de tokens (como en Roll20: solo cambia cómo se ven y cómo se mueven) ──
    ESCALAS = (0.5, 0.75, 1, 1.5, 2, 3)
    MAX_GRUPO = 12

    def tokens_del_grupo(self, t: dict) -> list[dict]:
        g = t.get("grupo")
        return [o for o in self.tokens.values() if g and o.get("grupo") == g] if g else [t]

    def escalar_token(self, token_id: str, escala, usuario: str, es_gm: bool) -> dict:
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("Solo puedes cambiar el tamaño de tus propios tokens")
        if isinstance(escala, bool) or escala not in self.ESCALAS:
            raise ErrorJuego("Tamaño no válido")
        if escala == 1:
            t.pop("escala", None)
        else:
            t["escala"] = escala
        self.guardar_estado()
        return t

    def agrupar_tokens(self, ids, usuario: str, es_gm: bool) -> list[str]:
        """Junta varios tokens (y los grupos en los que ya estuvieran) en uno solo: al mover uno, se mueven todos."""
        if not isinstance(ids, list) or not 2 <= len(ids) <= self.MAX_GRUPO or not all(isinstance(i, str) for i in ids):
            raise ErrorJuego(f"Elige entre 2 y {self.MAX_GRUPO} tokens para agrupar")
        tokens = {self._token(i)["id"]: self.tokens[i] for i in ids}
        for t in list(tokens.values()):
            for o in self.tokens_del_grupo(t):
                tokens[o["id"]] = o
        if len(tokens) > self.MAX_GRUPO:
            raise ErrorJuego(f"Un grupo puede tener como mucho {self.MAX_GRUPO} tokens")
        if not all(self.puede_controlar(t, usuario, es_gm) for t in tokens.values()):
            raise ErrorJuego("Solo puedes agrupar tokens que controlas")
        g = nuevo_id()
        for t in tokens.values():
            t["grupo"] = g
        self.guardar_estado()
        return list(tokens)

    def desagrupar_token(self, token_id: str, usuario: str, es_gm: bool) -> list[str]:
        """Saca un token de su grupo (si el grupo se queda con uno solo, desaparece). → tokens que cambiaron."""
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("Solo puedes desagrupar tus propios tokens")
        resto = [o for o in self.tokens_del_grupo(t) if o is not t]
        t.pop("grupo", None)
        if len(resto) == 1:
            resto[0].pop("grupo", None)
        self.guardar_estado()
        return [t["id"], *([resto[0]["id"]] if len(resto) == 1 else [])]

    # ── Bandos: quién es aliado, neutral o enemigo de quién ──
    def bando_de(self, t: dict) -> str:
        """«jugador» para los personajes de los jugadores; para un NPC, su bando actual (aliado, neutral o enemigo)."""
        if t["tipo"] == "personaje":
            return "jugador"
        b = t.get("bando") or self.cat.enemigos.get(t.get("base"), {}).get("bando")
        return b if b in ("aliado", "neutral", "enemigo") else "neutral"

    def relacion(self, origen: dict, destino: dict) -> str:
        """Cómo ve `origen` a `destino`: yo, aliado, neutral o enemigo. Jugadores y NPC aliados forman un equipo; los NPC enemigos, otro; los neutrales no están con nadie."""
        if origen is destino or origen["id"] == destino["id"]:
            return "yo"
        def lado(t):
            return {"jugador": "equipo", "aliado": "equipo", "enemigo": "rivales", "neutral": "neutral"}[self.bando_de(t)]
        a, b = lado(origen), lado(destino)
        if a == "neutral" or b == "neutral":
            return "neutral"
        return "aliado" if a == b else "enemigo"

    def _comprobar_ataque(self, origen: dict, destino: dict, modo: str):
        """La regla de la mesa sobre a quién se puede atacar (solo para jugadores; el GM no tiene límite)."""
        rel = self.relacion(origen, destino)
        if rel == "yo":
            return
        permitido = {"nadie": set(), "enemigos": {"enemigo"}, "enemigos_y_neutros": {"enemigo", "neutral"}, "todos": {"enemigo", "neutral", "aliado"}}.get(modo, set())
        if rel in permitido:
            return
        if modo == "nadie":
            raise ErrorJuego("El GM no te permite atacar a nadie")
        quienes = {"aliado": "aliados ni a otros jugadores", "neutral": "personajes neutrales", "enemigo": "enemigos"}[rel]
        raise ErrorJuego(f"En esta mesa no puedes atacar a {quienes}")

    def _guardar_afectados(self, *tokens: dict):
        for t in tokens:
            if t["tipo"] == "personaje":
                self.guardar_jugador(t["dueno"])
        self.guardar_estado()
