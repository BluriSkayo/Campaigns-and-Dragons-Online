"""habilidades.py — Usar habilidades: objetivos, áreas, tiradas, daño, curación, estados y desplazamientos.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from . import formulas, recursos
from .errores import ErrorJuego
from .recursos import CON_DIRECCION
from .utiles import redondear

AREA_UNO = {"forma": "uno", "tamano": 1, "afecta": "rivales"}       # sin área: un solo objetivo
# Qué hace el golpe según el tipo de habilidad: tipo → método (texto, cantidad). Un tipo nuevo = una fila y un método.
IMPACTOS = {"dano": "_impacto_dano", "curacion": "_impacto_curacion", "efecto": "_impacto_efecto"}


class HabilidadesMixin:
    # Usar una habilidad va por etapas. Nada cambia en la partida hasta que todo está comprobado y tirado
    # (un error en la fórmula no deja la habilidad a medias):
    #   comprobar quién y qué → apuntar → objetivos y casillas → coste → desvío («al intentar») → tirar → pagar → aplicar a cada uno → contar
    # El orden importa: es el de las validaciones que ve el jugador y el de los dados (misma semilla = misma partida).
    def usar_habilidad(self, token_id: str, habilidad_id: str, objetivo_id: str | None,
                       usuario: str, es_gm: bool, modo_ataque: str | None = None,
                       casilla: tuple[int, int] | None = None) -> tuple[str, list[str]]:
        """Usa una habilidad. Con un área (explosión, línea, frente) se puede apuntar a un token o a una casilla (`casilla`)."""
        origen = self._token(token_id)
        datos, hab = self._comprobar_uso(origen, habilidad_id, usuario, es_gm)
        forma = (hab.get("area") or AREA_UNO)["forma"]
        modo = modo_ataque or self.cfg["permisos"]["atacar"]
        destino, punto = self._apuntar(origen, hab, forma, objetivo_id, casilla, es_gm, modo)

        # Requisitos sobre quien la usa: si no se cumplen, no se puede usar. Los del objetivo filtran a quién alcanza.
        req = hab.get("requisitos") or []
        propios = [c for c in req if c.get("quien", "uno_mismo") == "uno_mismo"]
        del_objetivo = [c for c in req if c.get("quien") == "objetivo"]
        if propios and not self.cumple({"si": propios}, origen, None):
            raise ErrorJuego(f"No puedes usar «{hab['nombre']}» ahora: {self.texto_requisitos(propios)}")

        rompibles = self._rompibles_alcanzados(origen, hab, forma, destino, punto, es_gm)
        objetivos = self._objetivos_de(origen, hab, forma, destino, punto, del_objetivo, bool(rompibles), es_gm, modo)
        self._comprobar_coste(hab, datos)
        destino, objetivos, nota_desvio = self._desviar(origen, hab, forma, destino, objetivos)
        tiradas = self._tirar_golpes(origen, hab, objetivos)
        self._pagar_coste(origen, hab, datos)

        afectados = [origen]
        partes = [self._resolver_en(origen, hab, d, res, afectados) for d, res in tiradas]
        if nota_desvio and partes:
            n0, t0, d0 = partes[0]
            partes[0] = (n0, nota_desvio + t0, d0)
        texto = self._texto_uso(origen, hab, forma, partes)
        for cx, cy in rompibles:                         # cada tile u objeto rompible alcanzado recibe un golpe
            self.golpes_pendientes.append(self.golpe(cx, cy))
        self._guardar_afectados(*afectados)
        return texto, list(dict.fromkeys(t["id"] for t in afectados))

    def _comprobar_uso(self, origen: dict, habilidad_id: str, usuario: str, es_gm: bool) -> tuple[dict, dict]:
        """¿Puede este token usar esta habilidad ahora? (control, turno, derrota, si la conoce, fuera de combate, estados que lo impiden).
        → (sus datos, la habilidad)."""
        if not self.puede_controlar(origen, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        self._comprobar_turno(origen, es_gm)
        if self.derrotado(origen):
            raise ErrorJuego("Un personaje derrotado no puede actuar")
        datos = self.datos_de(origen)
        if habilidad_id not in datos["habilidades"]:
            raise ErrorJuego("Ese personaje no conoce esa habilidad")
        hab = self.cat.habilidades[habilidad_id]
        fuera = self.cfg["juego"].get("habilidades_fuera_de_combate", "todas")
        if not es_gm and not self.combate["activo"] and (fuera == "ninguna" or (fuera == "sin_dano" and hab["tipo"] == "dano")):
            raise ErrorJuego("Fuera de combate no se pueden usar " + ("habilidades" if fuera == "ninguna" else "habilidades que hacen daño"))
        for accion in ("habilidades", "atacar") if hab["tipo"] == "dano" else ("habilidades",):
            impide = self.impedido(origen, accion)
            if impide:
                raise ErrorJuego(f"«{impide}» no le deja {'atacar' if accion == 'atacar' else 'usar habilidades'}")
        silencio = self.impedido_por_etiqueta(origen, hab.get("etiquetas"))
        if silencio:
            raise ErrorJuego(f"«{silencio[0]}» no le deja usar habilidades de {', '.join(silencio[1])}")
        return datos, hab

    def _apuntar(self, origen: dict, hab: dict, forma: str, objetivo_id, casilla, es_gm: bool, modo: str) -> tuple[dict | None, tuple[int, int]]:
        """A quién o a dónde apunta: → (token apuntado o None si es una casilla, casilla del centro). Comprueba alcance, dirección,
        muros y, contra un solo objetivo, si es aliado o rival."""
        if hab["objetivo"] == "uno_mismo":
            return origen, (origen["x"], origen["y"])
        destino = None
        if objetivo_id:
            destino = self._token(objetivo_id)
            punto = (destino["x"], destino["y"])
        elif casilla is not None and (forma != "uno" or (hab["tipo"] == "dano" and self.rompible_en(*casilla))):
            punto = casilla
            if not (0 <= punto[0] < self.mapa["ancho"] and 0 <= punto[1] < self.mapa["alto"]):
                raise ErrorJuego("Esa casilla está fuera del mapa")
        else:
            raise ErrorJuego("Debes elegir un objetivo")
        p = {"x": punto[0], "y": punto[1]}
        if forma not in ("cono", "casillas") and not hab.get("sin_limite") and self.distancia(origen, p) > hab["alcance"]:
            raise ErrorJuego(f"El objetivo está fuera de alcance ({hab['alcance']} casillas)")
        if forma in CON_DIRECCION and punto == (origen["x"], origen["y"]):
            raise ErrorJuego("Apunta a otra casilla: la dirección sale de ti hacia ella")
        if not hab.get("atraviesa_muros", True) and not self.linea_libre(origen, p):
            raise ErrorJuego("Hay un muro en medio: esta habilidad no lo atraviesa")
        if forma == "uno" and destino is not None:
            rel = self.relacion(origen, destino)
            if hab["objetivo"] == "enemigo" and rel in ("aliado", "yo"):
                raise ErrorJuego("Esa habilidad es contra enemigos y neutrales, no sobre aliados")
            if hab["objetivo"] == "aliado" and rel not in ("aliado", "yo"):
                raise ErrorJuego("Esa habilidad solo se puede usar sobre aliados")
            if hab["tipo"] == "dano" and not es_gm:
                self._comprobar_ataque(origen, destino, modo)
        return destino, punto

    def _rompibles_alcanzados(self, origen: dict, hab: dict, forma: str, destino: dict | None, punto, es_gm: bool) -> list[tuple[int, int]]:
        """Tiles y objetos rompibles que alcanza un ataque (si quien ataca puede romper: el GM, o todos según «romper_casillas»).
        Un objeto grande cuenta una vez aunque ocupe varias casillas."""
        puede_romper = hab["tipo"] == "dano" and (es_gm or self.cfg["permisos"]["romper_casillas"] == "todos")
        solo_casilla = forma == "uno" and destino is None
        if not puede_romper or hab["objetivo"] == "uno_mismo":
            celdas = []
        elif solo_casilla:
            celdas = [punto]
        else:
            celdas = self.celdas_area(origen, punto, hab) if forma != "uno" else []
        if solo_casilla and not puede_romper:
            raise ErrorJuego("En esta mesa solo el GM puede romper casillas y objetos")
        rompibles, vistos = [], set()
        for cx, cy in celdas:
            q = self.rompible_en(cx, cy)
            clave = q and (q[0], q[1]["nombre"] if q[0] == "tile" else q[1], (cx, cy) if q[0] == "tile" else None)
            if q and clave not in vistos:
                vistos.add(clave)
                rompibles.append((cx, cy))
        return rompibles

    def _objetivos_de(self, origen: dict, hab: dict, forma: str, destino: dict | None, punto, del_objetivo: list,
                      hay_rompibles: bool, es_gm: bool, modo: str) -> list[dict]:
        """Los tokens que alcanza: el apuntado (forma «uno») o los del área, filtrados por los requisitos sobre el objetivo."""
        if forma == "uno" and destino is None:
            return []
        if forma == "uno":
            if del_objetivo and destino is not origen and not self.cumple({"si": del_objetivo}, origen, destino):
                raise ErrorJuego(f"«{hab['nombre']}» no sirve contra {self.nombre_de(destino)}: {self.texto_requisitos(del_objetivo)}")
            return [destino]
        objetivos = self.afectados_por_area(origen, punto, hab, es_gm, modo)
        if del_objetivo:
            objetivos = [t for t in objetivos if t is origen or self.cumple({"si": del_objetivo}, origen, t)]
        if not objetivos and not hay_rompibles:
            raise ErrorJuego("No hay nadie a quien alcanzar en esa zona")
        return objetivos

    @staticmethod
    def _comprobar_coste(hab: dict, datos: dict):
        for rec, coste in hab["coste"].items():
            if rec not in datos["recursos"]:
                raise ErrorJuego(f"Tu personaje no tiene «{rec}», que esta habilidad necesita")
            if datos["recursos"][rec]["actual"] < coste:
                raise ErrorJuego(f"No tienes suficiente {rec} (necesitas {coste})")

    def _pagar_coste(self, origen: dict, hab: dict, datos: dict):
        for rec, coste in hab["coste"].items():
            antes = datos["recursos"][rec]["actual"]
            datos["recursos"][rec]["actual"] -= coste
            self.cambio_de_recurso(origen, rec, antes, datos["recursos"][rec]["actual"])

    def _desviar(self, origen: dict, hab: dict, forma: str, destino: dict | None, objetivos: list[dict]) -> tuple[dict | None, list[dict], str]:
        """«Al intentar…»: puede impedir la acción o, en un ataque a un solo objetivo, desviarlo (confusión: se golpea a sí mismo u otro al azar).
        → (destino, objetivos, nota para el chat)."""
        ataca = hab["tipo"] == "dano" and hab["objetivo"] != "uno_mismo"
        desvio = self.intentar(origen, {"habilidad", "atacar"} if ataca else {"habilidad"}, destino if destino is not origen else None)
        if not (desvio and ataca and forma == "uno" and destino is not None):
            return destino, objetivos, ""
        nuevo = origen if desvio[0] == "quien_ataca" else (self.otro_al_azar(origen) or destino)
        if nuevo is destino:
            return destino, objetivos, ""
        nota = (f"😵 {desvio[1]}: {self.nombre_de(origen)} " +
                ("se golpea a sí mismo · " if nuevo is origen else f"ataca a {self.nombre_de(nuevo)} sin querer · "))
        return nuevo, [nuevo], nota

    def _tirar_golpes(self, origen: dict, hab: dict, objetivos: list[dict]) -> list[tuple[dict, list]]:
        """Tira la fórmula (y el crítico) de cada golpe contra cada objetivo, sin cambiar nada todavía. Una habilidad de solo efecto no tira."""
        planas_o = self.stats_planas(origen)
        golpes = hab.get("golpes", 1) if hab["tipo"] != "efecto" else 0
        # Las etiquetas del ataque (para ventaja()): las de la habilidad y, si se marca, también las de quien la usa (su elemento, su tipo…)
        etq_ataque = list(hab.get("etiquetas") or []) + (self.etiquetas_de(origen) if hab.get("etiquetas_del_usuario") else [])
        tiradas = []
        for d in objetivos:
            atacante = dict(planas_o)
            atacante.setdefault(recursos.DISTANCIA, self.distancia(origen, d))
            planas_d = self.stats_planas(d)
            ventaja = self.multiplicador_ventaja(etq_ataque, self.etiquetas_de(d))
            tiradas.append((d, [self._un_golpe(origen, hab, atacante, planas_d, ventaja) for _ in range(golpes)]))
        return tiradas

    def _un_golpe(self, origen: dict, hab: dict, atacante: dict, planas_d: dict, ventaja: float):
        try:
            r = formulas.evaluar(hab["formula"], atacante, planas_d, self.rng, tablas=self.tablas(),
                                 habilidad=hab.get("valores") or {}, ventaja=ventaja)
        except formulas.FormulaError as e:
            raise ErrorJuego(f"Error en la fórmula de «{hab['nombre']}»: {e}") from None
        crit = hab.get("critico")
        if crit:           # crítico nativo: un d20 aparte por golpe; los bonos de crítico rebajan el número necesario
            dado = self.rng.randint(1, 20)
            if dado >= max(1, crit["desde"] - self.bono_critico_de(origen)):
                r.valor = int(max(0, r.valor) * crit["multiplicador"])
                r.detalle += f" | ¡Crítico! (d20={dado}, ×{formulas._numero(crit['multiplicador'])})"
        return r

    def _resolver_en(self, origen: dict, hab: dict, d: dict, res: list, afectados: list[dict]) -> tuple[str, str, str]:
        """Aplica a un objetivo lo ya tirado: el impacto según el tipo (daño, curación o solo efecto) y después lo común
        (disparadores, estado, efectos «al alcanzar», empujar o atraer, derrota). → (nombre, texto, detalle de la tirada)."""
        rv = self.datos_de(d)["recursos"][self.cat.recurso_vida()]
        valores = [max(0, r.valor) for r in res]
        vivo_antes = rv["actual"] > 0
        nombre_d = self.nombre_de(d)
        desglose = f" ({' + '.join(str(x) for x in valores)})" if len(valores) > 1 else ""
        detalle = " · ".join(r.detalle for r in res)
        critico = any("¡Crítico!" in r.detalle for r in res)
        if critico:
            desglose += " ¡Crítico!"
        total = sum(valores)
        self._golpe = {"critico": critico, "dano": total}     # para «El golpe es crítico» y «El daño es…»
        txt, total = getattr(self, IMPACTOS[hab["tipo"]])(origen, d, total, desglose, afectados)
        ataque = hab["tipo"] == "dano" and d is not origen
        derrota = hab["tipo"] == "dano" and vivo_antes and rv["actual"] == 0
        # Un ataque que no hace daño (0 en la tirada, o anulado por la defensa) FALLA: no pone su estado ni sus efectos «al alcanzar»,
        # salvo que la habilidad diga lo contrario (`aplicar_si_falla`).
        falla = ataque and total <= 0 and not hab.get("aplicar_si_falla")
        if falla:
            txt += " (falla)"
        if ataque:
            self.disparar("al_atacar", origen, d)             # quien ataca, aunque el golpe derribe al objetivo (gasta su munición, sus cargas…)
            if not self.derrotado(d):
                self.disparar("al_ser_atacado", d, origen)
        if not falla:
            txt = self._aplicar_estado_de(hab, d, txt)
            for ef in hab.get("efectos") or ():
                if not self.derrotado(d) and self.cumple(ef, origen, d):
                    self.aplicar_accion(hab["nombre"], origen, d, ef["hacer"])
        mov = hab.get("mover_objetivo")
        if mov and d is not origen and not self.derrotado(d):
            pasos = self.desplazar(d, origen, mov["modo"], mov["casillas"])
            if pasos:
                txt += f" ({'atraído' if mov['modo'] == 'atraer' else 'empujado'} {pasos} {'casilla' if pasos == 1 else 'casillas'})"
        if derrota:
            self.al_derrotar(origen, d)
        self._golpe = None
        if d not in afectados:
            afectados.append(d)
        return nombre_d, txt, detalle

    # ── Impacto según el tipo de habilidad (IMPACTOS). Cada uno → (texto, cantidad que contó de verdad) ──
    def _impacto_efecto(self, origen: dict, d: dict, total: int, desglose: str, afectados: list[dict]) -> tuple[str, int]:
        return "", total

    def _impacto_curacion(self, origen: dict, d: dict, total: int, desglose: str, afectados: list[dict]) -> tuple[str, int]:
        vida = self.cat.recurso_vida()
        rv = self.datos_de(d)["recursos"][vida]
        antes = rv["actual"]
        rv["actual"] = min(rv["max"], antes + total)
        self.cambio_de_recurso(d, vida, antes, rv["actual"], origen if d is not origen else None)
        return f"+{rv['actual'] - antes} {vida}{desglose}", total

    def _impacto_dano(self, origen: dict, d: dict, total: int, desglose: str, afectados: list[dict]) -> tuple[str, int]:
        """Daño: primero la defensa de quien lo recibe (redirigir, esquivar, bloquear, devolver…), después el daño y lo que rebota."""
        rv = self.datos_de(d)["recursos"][self.cat.recurso_vida()]
        vivo_antes = rv["actual"] > 0
        nombre_d = self.nombre_de(d)
        notas, devuelto, rebote = [], 0, None
        if d is not origen:
            refl = self.reflejo(d, origen)          # «Redirigir el ataque» de quien lo recibe: el golpe rebota o se desvía
            if refl and total > 0:
                rebote = origen if refl[0] == "quien_ataca" else self.otro_al_azar(d)
                if rebote is not None:
                    notas.append(f"↩️ {refl[1]}: el golpe va a {self.nombre_de(rebote)}")
                    rebote = (rebote, total)
                    total = 0
            if total > 0:                       # defensa activa: esquivar, bloquear, devolver…
                total, mas, devuelto = self.defensa(d, origen, total)
                notas += mas
        self._golpe["dano"] = total
        _, absorbido = self.danar(d, total, origen if d is not origen else None)
        notas += absorbido
        txt = f"{total} de daño{desglose}" + (f" ({', '.join(notas)})" if notas else "")
        if rv["actual"] == 0 and vivo_antes:
            txt += f" ☠️ {nombre_d} ha sido derrotado"
        for quien, cuanto in ([(origen, devuelto)] if devuelto else []) + ([rebote] if rebote else []):
            vivo = not self.derrotado(quien)
            p2, n2 = self.danar(quien, cuanto, d)
            txt += f" · {self.nombre_de(quien)} recibe {p2}" + (f" ({', '.join(n2)})" if n2 else "")
            if vivo and self.derrotado(quien):
                txt += f" ☠️ {self.nombre_de(quien)} ha sido derrotado"
                self.al_derrotar(d, quien)
            if quien not in afectados:
                afectados.append(quien)
        return txt, total

    def _aplicar_estado_de(self, hab: dict, d: dict, txt: str) -> str:
        """El estado que pone la habilidad (según «Al volver a aplicarlo»: renovar, acumular cargas…); con `alternar`, lo quita si ya lo tenía."""
        est = hab.get("aplica_estado")
        if est not in self.cat.estados or self.derrotado(d):
            return txt
        lista = d.setdefault("estados", [])
        if hab.get("alternar") and any(e["id"] == est for e in lista):      # activar / desactivar un poder
            self.quitar_estado_de(d, est, "se_quita")
            txt = (txt + " · " if txt else "") + f"ya no está en «{self.cat.estados[est]['nombre']}»"
        else:
            puesto = self.poner_estado(d, est)
            if puesto:
                txt = (txt + " · " if txt else "") + f"«{puesto}»"
        self._marcar(d)
        return txt

    def _texto_uso(self, origen: dict, hab: dict, forma: str, partes: list[tuple[str, str, str]]) -> str:
        """La línea del chat: «⚔️ Ana usó Bola de fuego sobre Goblin: 12 de daño» (lo que va tras DETALLE solo se ve al desplegar)."""
        icono = "⚔️" if hab["tipo"] == "dano" else "✨"
        nombre_o = self.nombre_de(origen)
        if not partes:                                   # solo golpeó tiles u objetos
            return f"{icono} {nombre_o} usó {hab['nombre']}"
        if len(partes) == 1 and forma == "uno":
            nombre_d, txt, detalle = partes[0]
            return (f"{icono} {nombre_o} usó {hab['nombre']}" + ("" if nombre_d == nombre_o and not txt else f" sobre {nombre_d}")
                    + (f": {txt}" if txt else "") + (f"{recursos.DETALLE}{detalle}" if detalle else ""))
        detalles = " · ".join(dt for _, _, dt in partes if dt)
        return (f"{icono} {nombre_o} usó {hab['nombre']}: " + " · ".join(f"{n} {t}".strip() for n, t, _ in partes)
                + (f"{recursos.DETALLE}{detalles}" if detalles else ""))

    def texto_requisitos(self, conds: list[dict]) -> str:
        """Los requisitos en una frase corta, para el aviso cuando no se cumplen."""
        trozos = []
        for c in conds:
            quien = "tú" if c.get("quien", "uno_mismo") == "uno_mismo" else "el objetivo"
            no = c.get("tiene", "si") == "no"
            t = c["tipo"]
            if t == "tiene_etiqueta":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} tener la etiqueta «{c.get('etiqueta')}»")
            elif t == "tiene_estado":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} sufrir «{self.cat.estados.get(c.get('estado'), {}).get('nombre', c.get('estado'))}»")
            elif t == "lleva_objeto":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} llevar «{self.cat.objetos.get(c.get('objeto'), {}).get('nombre', c.get('objeto'))}»")
            elif t == "es_opcion":
                trozos.append(f"{quien} {'no debe' if no else 'debe'} ser «{self.cat.opciones.get(c.get('opcion'), {}).get('nombre', c.get('opcion'))}»")
            elif t in ("recurso", "estadistica"):
                que = c.get("recurso") or c.get("estadistica")
                comp = {"menos_de": "menos de", "al_menos": "al menos", "igual_a": "exactamente"}.get(c.get("comparacion"), "")
                unidad = "%" if t == "recurso" and c.get("unidad") == "porcentaje" else ""
                trozos.append(f"{quien}: {que} {comp} {c.get('valor')}{unidad}")
            elif t == "en_combate":
                trozos.append("solo en combate" if c.get("activo", "si") == "si" else "solo fuera de combate")
            elif t == "momento_dia":
                trozos.append(f"solo de {c.get('periodo')}")
            elif t == "clima":
                trozos.append(f"solo con clima: {c.get('clima')}")
            elif t == "bando":
                trozos.append(f"{quien} debe ser {c.get('bando')}")
            else:
                trozos.append("no se cumplen sus requisitos")
        return "; ".join(trozos)

    def celdas_area(self, origen: dict, punto: tuple[int, int], hab: dict) -> list[tuple[int, int]]:
        """Casillas que alcanza una habilidad con área, apuntando a `punto` (el cliente dibuja lo mismo al apuntar)."""
        area = hab.get("area") or {}
        forma, tam = area.get("forma", "uno"), area.get("tamano", 1)
        an, al = self.mapa["ancho"], self.mapa["alto"]
        dentro = lambda x, y: 0 <= x < an and 0 <= y < al          # noqa: E731
        px, py = punto
        if forma == "explosion":
            return [(x, y) for y in range(py - tam, py + tam + 1) for x in range(px - tam, px + tam + 1) if dentro(x, y)]
        ox, oy = origen["x"], origen["y"]
        dx, dy = px - ox, py - oy
        n = max(abs(dx), abs(dy))
        if n == 0:
            return [(px, py)] if forma == "uno" else []
        if forma == "linea":
            largo = an + al if hab.get("sin_limite") else hab["alcance"]
            opacas = set() if hab.get("atraviesa_muros", True) else self._opacas()
            res = []
            for k in range(1, largo + 1):
                x, y = ox + redondear(k * dx / n), oy + redondear(k * dy / n)
                if not dentro(x, y) or (x, y) in opacas:
                    break
                res.append((x, y))
            return res
        if forma in ("cono", "casillas"):
            # Mira hacia el lado dominante (arriba, abajo, izquierda o derecha); el área sale de quien la usa
            fx, fy = ((dx > 0) - (dx < 0), 0) if abs(dx) >= abs(dy) else (0, (dy > 0) - (dy < 0))
            rx, ry = -fy, fx                  # su derecha
            if forma == "cono":
                rel = [(k, l) for k in range(1, tam + 1) for l in range(-(k - 1), k)]
            else:
                rel = [tuple(c) for c in area.get("casillas", [])]
            res = []
            for f, l in rel:
                x, y = ox + f * fx + l * rx, oy + f * fy + l * ry
                if dentro(x, y) and (x, y) not in res:
                    res.append((x, y))
            return res
        if forma == "frente":
            sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
            qx, qy = -sy, sx                  # perpendicular a la dirección
            mitad = tam // 2
            res = []
            for k in range(-mitad, tam - mitad):
                x, y = px + k * qx, py + k * qy
                if dentro(x, y):
                    res.append((x, y))
            return res
        return [(px, py)]

    def afectados_por_area(self, origen: dict, punto: tuple[int, int], hab: dict, es_gm: bool, modo: str) -> list[dict]:
        celdas = self.celdas_area(origen, punto, hab)
        orden = {c: i for i, c in enumerate(celdas)}
        afecta = (hab.get("area") or {}).get("afecta", "rivales")
        res = []
        for t in self.tokens.values():
            if (t.get("x"), t.get("y")) not in orden or self.derrotado(t):
                continue
            rel = self.relacion(origen, t)
            if afecta == "aliados":
                if rel not in ("aliado", "yo"):
                    continue
            elif rel == "yo":
                continue
            elif afecta == "rivales" and rel == "aliado":
                continue
            if hab["tipo"] == "dano" and not es_gm and rel != "yo":
                try:
                    self._comprobar_ataque(origen, t, modo)
                except ErrorJuego:
                    continue
            res.append(t)
        return sorted(res, key=lambda t: orden[(t["x"], t["y"])])

    def desplazar(self, t: dict, respecto: dict, modo: str, casillas: int) -> int:
        """Atrae (hacia `respecto`) o empuja (lejos de él) a un token casilla a casilla, sin entrar en muros ni casillas ocupadas.
        casillas = 0 al atraer: hasta quedar pegado. → casillas que se ha movido."""
        movidas = 0
        limite = casillas or (self.mapa["ancho"] + self.mapa["alto"])
        while movidas < limite:
            dx, dy = respecto["x"] - t["x"], respecto["y"] - t["y"]
            if modo == "atraer" and max(abs(dx), abs(dy)) <= 1:
                break
            sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
            if modo == "empujar":
                sx, sy = -sx, -sy
                if sx == sy == 0:
                    break
            nx, ny = t["x"] + sx, t["y"] + sy
            if not self.casilla_transitable(nx, ny) or self.casilla_ocupada(nx, ny, t["id"]):
                break
            t["x"], t["y"] = nx, ny
            movidas += 1
        return movidas
