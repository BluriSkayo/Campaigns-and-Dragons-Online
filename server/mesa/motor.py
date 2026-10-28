"""
motor.py — Aplica en la partida los efectos definidos en la campaña (rasgos, estados, bonos de raza/clase).

Es una mezcla (mixin) de EstadoPartida: usa su catálogo, sus tokens y su generador de azar.
Todo lo que ocurre «solo» (un veneno al empezar el turno, un rasgo al atacar…) se anota en dos colas
que el servidor vacía después de cada acción y difunde a los clientes:

    cola_chat    mensajes para el chat: [(texto, categoria)]
    cola_tokens  ids de tokens que han cambiado

Disparadores: los de efectos.DISPARADORES. Los que dependen del daño pasan por `danar` (escudos, umbrales, «al recibir daño»),
los de estados por `poner_estado` / `quitar_estado_de` («al volver a aplicarlo», «al terminar este estado») y los de «al intentar» por `intentar`.
Condiciones («si»): ver `cumple` y el registro CONDICIONES. Un efecto sin condiciones se aplica siempre que se dispare.
Mientras se resuelve un golpe, `_golpe` dice si fue crítico y cuánto daño hizo (condiciones «El golpe es crítico» y «El daño es…»).
"""

from __future__ import annotations

from . import formulas, recursos

# Placeholder de la fórmula de tirada de estadística (configurable por campaña en juego.tirada_estadistica).
TIRADA_ESTADISTICA_DEFECTO = "1d20 + [a.{estadistica}]"


def _comparar(a, como: str, b) -> bool:
    return a < b if como == "menos_de" else a == b if como == "igual_a" else a >= b


class MotorEfectos:
    def _init_motor(self):
        self.cola_chat: list[tuple[str, str]] = []
        self.cola_tokens: set[str] = set()
        self._golpe: dict | None = None          # {critico, dano} del golpe que se está resolviendo (o None)
        self._profundidad_dano = 0               # «al recibir daño» que causa daño que causa…: se corta la cadena

    def tablas(self) -> dict:
        """Tablas por tramos de la campaña, para las fórmulas (tabla(Nombre; valor))."""
        return formulas.tablas_de(self.cat.config)

    def vaciar_colas(self) -> tuple[list[tuple[str, str]], list[str]]:
        chat, tokens = self.cola_chat, sorted(self.cola_tokens)
        self.cola_chat, self.cola_tokens = [], set()
        return chat, [t for t in tokens if t in self.tokens]

    # ── Qué rasgos y bonos tiene alguien ─────────────────────────
    def opciones_elegidas(self, datos: dict) -> list[dict]:
        return [self.cat.opciones[o] for o in (datos.get("elecciones") or {}).values() if o in self.cat.opciones]

    def rasgos_de(self, datos: dict) -> list[str]:
        ids: list[str] = []
        for op in self.opciones_elegidas(datos):
            for r in op["rasgos"]:
                if r not in ids:
                    ids.append(r)
        return ids

    def estados_de(self, token: dict) -> list[dict]:
        return [e for e in token.get("estados", []) if e["id"] in self.cat.estados]

    def _efectos_activos(self, token: dict):
        """(origen, efecto) de todo lo que tiene el token: rasgos de sus opciones y estados activos."""
        datos = self.datos_de(token)
        for rid in self.rasgos_de(datos):
            for ef in self.cat.rasgos[rid]["efectos"]:
                yield self.cat.rasgos[rid]["nombre"], ef
        for est in self.estados_de(token):
            cargas = est.get("cargas", 1)
            for ef in self.cat.estados[est["id"]]["efectos"]:      # cada efecto sabe de qué estado viene y cuántas cargas lleva ([Cargas])
                yield self.cat.estados[est["id"]]["nombre"], {**ef, "hacer": {**ef["hacer"], "_cargas": cargas, "_estado": est["id"]}}
        equipando = (self.cfg["juego"].get("equipamiento") or {}).get("activo")
        for it in (datos.get("inventario") or []):            # lo que da cada objeto mientras se lleva encima (o equipado)
            obj = self.cat.objetos.get(it.get("objeto"))
            if equipando and (obj or {}).get("equipable") and not it.get("equipado"):
                continue
            for ef in (obj or {}).get("efectos", []):
                yield obj["nombre"], ef
        tile = self.tile_en(token["x"], token["y"]) if token.get("x", -1) >= 0 else None
        if tile:                                   # lo que da el terreno sobre el que está
            for ef in tile["efectos"]:
                yield tile["nombre"], ef
        for ef in self.cfg["juego"].get("efectos") or []:      # reglas de la campaña: valen para todos (sus condiciones filtran)
            yield "Reglas de la campaña", ef

    # ── Etiquetas y ventajas ─────────────────────────────────────
    def etiquetas_de(self, token: dict) -> list[str]:
        """Etiquetas de un token: las de sus opciones (raza, clase…), las propias del NPC y las de sus estados activos."""
        d = self.datos_de(token)
        res: list[str] = []
        fuentes = [op.get("etiquetas", []) for op in self.opciones_elegidas(d)]
        if token["tipo"] != "personaje":
            fuentes.append(d.get("etiquetas") or self.cat.enemigos.get(token.get("base"), {}).get("etiquetas", []))
        fuentes += [self.cat.estados[e["id"]].get("etiquetas", []) for e in self.estados_de(token)]
        for lista in fuentes:
            for e in lista:
                if e not in res:
                    res.append(e)
        return res

    def multiplicador_ventaja(self, del_ataque: list[str], del_objetivo: list[str]) -> float:
        """Producto de la tabla de ventajas para cada pareja (etiqueta del ataque, etiqueta del objetivo). Sin filas = 1."""
        tabla = {(f["atacante"], f["defensor"]): f["multiplicador"] for f in self.cfg["juego"].get("ventajas", [])}
        m = 1.0
        for a in del_ataque:
            for o in del_objetivo:
                m *= tabla.get((a, o), 1)
        return int(m) if float(m).is_integer() else m

    def bonos_de(self, token: dict) -> dict[str, int]:
        """Suma de bonos permanentes: opciones elegidas (raza, clase…) + efectos «siempre» de rasgos y estados."""
        datos = self.datos_de(token)
        bonos: dict[str, int] = {}
        for op in self.opciones_elegidas(datos):
            for k, v in op["bonos"].items():
                bonos[k] = bonos.get(k, 0) + v
        for _, ef in self._efectos_activos(token):
            if ef["cuando"]["tipo"] == "siempre" and ef["hacer"]["tipo"] == "bono_estadistica" and self.cumple(ef, token, pasivo=True):
                k = ef["hacer"]["estadistica"]
                bonos[k] = bonos.get(k, 0) + ef["hacer"]["valor"] * ef["hacer"].get("_cargas", 1)     # un estado acumulado da su bono por carga
        return {k: v for k, v in bonos.items() if v}

    def bono_critico_de(self, token: dict) -> int:
        """Cuánto se rebaja el número del d20 necesario para un crítico (rasgos, estados, objetos que lleva, terreno)."""
        return sum(ef["hacer"]["valor"] for _, ef in self._efectos_activos(token)
                   if ef["cuando"]["tipo"] == "siempre" and ef["hacer"]["tipo"] == "bono_critico" and self.cumple(ef, token, pasivo=True))

    def impedido_por_etiqueta(self, token: dict, etiquetas) -> tuple[str, list[str]] | None:
        """(nombre del estado, etiquetas) si un estado impide usar habilidades con alguna de esas etiquetas (Silencio → Magia)."""
        for est in self.estados_de(token):
            e = self.cat.estados.get(est["id"]) or {}
            choque = [x for x in (e.get("impide_etiquetas") or ()) if x in (etiquetas or ())]
            if choque:
                return e["nombre"], choque
        return None

    def impedido(self, token: dict, accion: str) -> str | None:
        """Nombre del estado que impide esta acción (atacar, habilidades, objetos, mover), o None."""
        for est in self.estados_de(token):
            e = self.cat.estados.get(est["id"])
            if e and accion in e.get("impide", ()):
                return e["nombre"]
        return None

    def defensa(self, defensor: dict, atacante: dict, dano: int) -> tuple[int, list[str], int]:
        """Defensa activa del que recibe un ataque de daño: efectos «Al recibir un ataque» que anulan, reducen o devuelven daño
        (con sus condiciones, probabilidad incluida). → (daño que recibe, notas para el chat, daño devuelto al atacante)."""
        notas, devuelto = [], 0
        defensivas = [(o, ef) for o, ef in self._efectos_activos(defensor)
                      if ef["cuando"]["tipo"] == "al_ser_atacado" and ef["hacer"]["tipo"] in ("anular_ataque", "reducir_dano", "devolver_dano")]
        orden = {"anular_ataque": 0, "reducir_dano": 1, "devolver_dano": 2}
        for origen, ef in sorted(defensivas, key=lambda x: orden[x[1]["hacer"]["tipo"]]):
            if dano <= 0 or not self.cumple(ef, defensor, atacante):
                continue
            h = ef["hacer"]
            if h["tipo"] == "anular_ataque":
                notas.append(f"🛡️ {origen}: anula el ataque")
                dano = 0
            elif h["tipo"] == "reducir_dano":
                menos = h["valor"] if h.get("unidad", "puntos") == "puntos" else dano * h["valor"] // 100
                dano = max(0, dano - menos)
                notas.append(f"🛡️ {origen}: −{menos}")
            else:
                devuelto += dano * h["valor"] // 100
                notas.append(f"↩️ {origen}: devuelve {dano * h['valor'] // 100}")
        return dano, notas, devuelto

    def reflejo(self, defensor: dict, atacante: dict) -> tuple[str, str] | None:
        """¿El defensor desvía este ataque? («Al recibir un ataque» → «Redirigir el ataque»). → (hacia, nombre del origen) o None."""
        for origen, ef in self._efectos_activos(defensor):
            if ef["cuando"]["tipo"] == "al_ser_atacado" and ef["hacer"]["tipo"] == "redirigir_ataque" and self.cumple(ef, defensor, atacante):
                return ef["hacer"].get("hacia", "quien_ataca"), origen
        return None

    def otro_al_azar(self, *excepto: dict) -> dict | None:
        """Un token cualquiera de la sala en pie (para «redirigir el ataque: otro al azar»), o None si no hay."""
        fuera = {t["id"] for t in excepto}
        posibles = [t for t in self.tokens.values() if t["id"] not in fuera and not self.derrotado(t)]
        return self.rng.choice(posibles) if posibles else None

    # ── Daño (pasa todo por aquí: escudos, umbrales y «al recibir daño») ──
    def danar(self, token: dict, cantidad: int, fuente: dict | None = None) -> tuple[int, list[str]]:
        """Quita `cantidad` de vida a `token`: primero lo absorben sus escudos («Absorber el daño con un recurso»), luego la vida.
        Salta «al cruzar un umbral» y «al recibir daño» (con `fuente` como el otro). → (vida que perdió, notas para el chat).
        No anuncia la derrota: lo hace quien llama (que sabe quién lo causó)."""
        notas: list[str] = []
        if cantidad <= 0:
            return 0, notas
        d = self.datos_de(token)
        resto = cantidad
        for origen, ef in list(self._efectos_activos(token)):
            if resto <= 0:
                break
            h = ef["hacer"]
            if ef["cuando"]["tipo"] != "siempre" or h["tipo"] != "absorber_dano" or not self.cumple(ef, token, pasivo=True):
                continue
            r = d["recursos"].get(h["recurso"])
            if not r or r["actual"] <= 0:
                continue
            quita = min(r["actual"], resto)
            antes = r["actual"]
            r["actual"] -= quita
            resto -= quita
            notas.append(f"🛡️ {origen}: absorbe {quita}")
            self.cambio_de_recurso(token, h["recurso"], antes, r["actual"], fuente)
        vida = d["recursos"][self.cat.recurso_vida()]
        antes = vida["actual"]
        vida["actual"] = max(0, antes - resto)
        perdido = antes - vida["actual"]
        self.cola_tokens.add(token["id"])
        if perdido:
            self.cambio_de_recurso(token, self.cat.recurso_vida(), antes, vida["actual"], fuente)
        if cantidad > 0 and self._profundidad_dano < 3:          # «al recibir daño» (también si el escudo lo paró todo)
            self._profundidad_dano += 1
            golpe_antes = self._golpe
            self._golpe = {**(golpe_antes or {"critico": False}), "dano": perdido}
            try:
                self.disparar("al_recibir_dano", token, fuente if fuente is not token else None)
            finally:
                self._golpe = golpe_antes
                self._profundidad_dano -= 1
        return perdido, notas

    def cambio_de_recurso(self, token: dict, recurso: str, antes: int, despues: int, otro: dict | None = None):
        """Un recurso cambió: salta «Al cruzar un umbral» si pasó por el porcentaje de algún efecto (una vez por cruce)."""
        if antes == despues or self._profundidad_dano >= 3:
            return
        r = self.datos_de(token)["recursos"].get(recurso)
        if not r:
            return
        for origen, ef in list(self._efectos_activos(token)):
            c = ef["cuando"]
            if c["tipo"] != "al_cruzar_umbral" or c.get("recurso") != recurso:
                continue
            limite = c["porcentaje"] * max(1, r["max"])        # se compara ×100 para no usar decimales
            a, b = antes * 100, despues * 100
            cruza = (a >= limite > b) if c.get("sentido", "baja") == "baja" else (a < limite <= b)
            if cruza and self.cumple(ef, token, otro):
                self._profundidad_dano += 1
                try:
                    self.aplicar_accion(origen, token, otro, ef["hacer"])
                finally:
                    self._profundidad_dano -= 1

    # ── «Al intentar una acción» ─────────────────────────────────
    def intentar(self, token: dict, acciones: set[str], otro: dict | None = None) -> tuple[str, str] | None:
        """Antes de atacar, usar una habilidad o un objeto, o moverse. Aplica los efectos «Al intentar…» que coincidan:
        «Impedir la acción» la para (ErrorJuego y aviso para la mesa); «Redirigir el ataque» (solo al atacar) devuelve
        (hacia, nombre del origen); lo demás (perder vida al moverse, ponerse un estado…) se aplica sin más."""
        from .errores import ErrorJuego
        redirigir, impide = None, None
        for origen, ef in list(self._efectos_activos(token)):
            c = ef["cuando"]
            if c["tipo"] != "al_intentar" or (c.get("accion", "atacar") not in acciones and c.get("accion") != "cualquiera"):
                continue
            if not self.cumple(ef, token, otro):
                continue
            h = ef["hacer"]
            if h["tipo"] == "impedir_accion":
                impide = impide or origen
            elif h["tipo"] == "redirigir_ataque":
                if "atacar" in acciones and redirigir is None:
                    redirigir = (h.get("hacia", "quien_ataca"), origen)
            else:
                self.aplicar_accion(origen, token, otro, h)
        if impide:
            verbo = ("atacar" if "atacar" in acciones else "usar la habilidad" if "habilidad" in acciones
                     else "usar el objeto" if "objeto" in acciones else "moverse")
            nombre = self.datos_de(token)["nombre"]
            self.cola_chat.append((f"🚫 {impide}: {nombre} intenta {verbo}, pero no lo consigue", "combate"))
            raise ErrorJuego(f"«{impide}» no te deja {verbo} ahora")
        return redirigir

    def vision_de(self, token: dict) -> int:
        """Casillas que ve este token: la visión base de la campaña más los efectos «siempre» de rasgos, estados, objetos y terreno."""
        total = self.cfg["juego"]["niebla"]["vision_base"]
        for _, ef in self._efectos_activos(token):
            if ef["cuando"]["tipo"] == "siempre" and ef["hacer"]["tipo"] == "bono_vision" and self.cumple(ef, token, pasivo=True):
                total += ef["hacer"]["valor"]
        return max(0, min(50, total))

    def stats_efectivas(self, token: dict) -> dict[str, int]:
        datos = self.datos_de(token)
        definidas = {e["nombre"]: e for e in self.cat.config["juego"]["estadisticas"]}
        res = dict(datos["stats"])
        bonos = self.bonos_de(token)
        for k, v in bonos.items():
            if k in res and not definidas[k].get("formula"):
                e = definidas[k]
                res[k] = max(e["minimo"], min(e["maximo"], res[k] + v))
        self._calcular_estadisticas(token, res, bonos, definidas)
        return res

    def _calcular_estadisticas(self, token: dict, res: dict, bonos: dict, definidas: dict):
        """Estadísticas calculadas (con «formula»): se calculan en orden, con los valores ya bonificados (así un objeto que sube
        la Fuerza sube también su modificador), y después se les suman sus propios bonos."""
        calculadas = [e for e in self.cat.config["juego"]["estadisticas"] if e.get("formula")]
        if not calculadas:
            return
        variables = dict(res)
        if self.cfg["juego"]["niveles"]["activo"]:
            variables[recursos.NIVEL] = self.nivel_de(token)
        for e in calculadas:
            try:
                v = formulas.evaluar(e["formula"], variables, None, self.rng, tablas=self.tablas()).valor
            except formulas.FormulaError:
                v = e["valor_inicial"]
            v = max(e["minimo"], min(e["maximo"], v + bonos.get(e["nombre"], 0)))
            variables[e["nombre"]] = res[e["nombre"]] = v

    def recalcular_maximos(self, token: dict) -> bool:
        """Recursos con «maximo_formula» (solo personajes): ajusta el máximo; si sube o baja, el valor actual se mueve lo mismo
        (como al subir de nivel en muchos juegos). → ¿cambió algo?"""
        if token.get("tipo") != "personaje":
            return False
        defs = [r for r in self.cat.config["juego"]["recursos"] if r.get("maximo_formula")]
        if not defs:
            return False
        datos = self.datos_de(token)
        variables = self.stats_efectivas(token)
        if self.cfg["juego"]["niveles"]["activo"]:
            variables[recursos.NIVEL] = self.nivel_de(token)
        vida, cambio = self.cat.recurso_vida(), False
        for r in defs:
            actual = datos["recursos"].get(r["nombre"])
            if not actual:
                continue
            try:
                mx = formulas.evaluar(r["maximo_formula"], variables, None, self.rng, tablas=self.tablas()).valor
            except formulas.FormulaError:
                continue
            mx = max(1 if r["nombre"] == vida else 0, min(10_000_000, mx))
            if mx != actual["max"]:
                actual["actual"] = max(0, min(mx, actual["actual"] + mx - actual["max"]))
                actual["max"] = mx
                cambio = True
        return cambio

    # ── Disparadores ─────────────────────────────────────────────
    def disparar(self, cuando: str, token: dict, otro: dict | None = None, estadistica: str | None = None) -> int:
        """Aplica los efectos de `token` que se activan con `cuando`. Devuelve la suma de bonos de tirada."""
        bono_tirada = 0
        for origen, ef in list(self._efectos_activos(token)):
            c = ef["cuando"]
            if c["tipo"] != cuando:
                continue
            if cuando == "tirada" and c.get("estadistica") and c["estadistica"] != estadistica:
                continue
            if not self.cumple(ef, token, otro):
                continue
            h = ef["hacer"]
            if h["tipo"] == "bono_tirada":
                bono_tirada += h["valor"]
            else:
                self.aplicar_accion(origen, token, otro, h)
        return bono_tirada

    def aplicar_accion(self, origen: str, token: dict, otro: dict | None, h: dict):
        """Ejecuta una acción de efecto que cambia algo en la partida (los bonos se calculan aparte). Qué método ejecuta cada tipo: `ACCIONES_ACTIVAS`."""
        metodo = ACCIONES_ACTIVAS.get(h["tipo"])
        if metodo:
            getattr(self, metodo)(origen, token, otro, h)

    def _efecto_quitar_estado(self, origen: str, token: dict, otro: dict | None, h: dict):
        destino = self._destino(h, token, otro)
        if destino is None or not any(e["id"] == h["estado"] for e in destino.get("estados", [])):
            return
        nombre = self.cat.estados.get(h["estado"], {}).get("nombre", h["estado"])
        self.cola_chat.append((f"🌀 {origen}: {self.datos_de(destino)['nombre']} ya no sufre «{nombre}»", "combate"))
        self.quitar_estado_de(destino, h["estado"], "se_quita")

    # ── Poner y quitar estados (todo pasa por aquí: efectos, habilidades y el GM) ──
    def poner_estado(self, destino: dict, estado_id: str) -> str | None:
        """Aplica un estado según su «Al volver a aplicarlo» (renovar, ignorar, sumar duración o acumular cargas).
        → texto corto («Veneno», «Veneno ×3») o None si no cambió nada (ignorado)."""
        est = self.cat.estados.get(estado_id)
        if not est:
            return None
        lista = destino.setdefault("estados", [])
        ya = next((e for e in lista if e["id"] == estado_id), None)
        modo = est.get("al_reaplicar", "renovar")
        if not ya:
            lista.append({"id": estado_id, "turnos": est["duracion"], **({"cargas": 1} if modo == "acumular" else {})})
            texto = est["nombre"]
        elif modo == "ignorar":
            return None
        elif modo == "sumar":
            ya["turnos"] = ya["turnos"] + est["duracion"] if ya["turnos"] > 0 and est["duracion"] > 0 else est["duracion"]
            texto = f"{est['nombre']} ({ya['turnos']} turnos)" if ya["turnos"] else est["nombre"]
        elif modo == "acumular":
            ya["cargas"] = min(est.get("max_cargas", 5), ya.get("cargas", 1) + 1)
            ya["turnos"] = est["duracion"]
            texto = f"{est['nombre']} ×{ya['cargas']}"
        else:
            ya["turnos"] = est["duracion"]
            texto = est["nombre"]
        self._marcar(destino)
        return texto

    def quitar_estado_de(self, token: dict, estado_id: str, motivo: str = "se_quita") -> bool:
        """Quita un estado (porque se acaba: `se_acaba`; porque se lo quitan: `se_quita`) y aplica sus efectos «Al terminar este
        estado». Si se acaba solo, después pasa al estado siguiente («Al terminar, pasa a…»). → ¿lo tenía?"""
        lista = token.get("estados", [])
        est = next((e for e in lista if e["id"] == estado_id), None)
        if est is None:
            return False
        lista.remove(est)
        defi = self.cat.estados.get(estado_id)
        if defi:
            for ef in defi["efectos"]:
                c = ef["cuando"]
                if c["tipo"] == "al_terminar_estado" and c.get("motivo", "cualquiera") in ("cualquiera", motivo):
                    h = {**ef["hacer"], "_cargas": est.get("cargas", 1), "_estado": estado_id}
                    if self.cumple(ef, token):
                        self.aplicar_accion(defi["nombre"], token, None, h)
            sig = defi.get("al_terminar") if motivo == "se_acaba" else None     # progresión: Quemadura leve → Quemadura grave
            if sig in self.cat.estados and not any(e["id"] == sig for e in token.get("estados", [])):
                self.poner_estado(token, sig)
                self.cola_chat.append((f"🌀 {self.datos_de(token)['nombre']} pasa a sufrir «{self.cat.estados[sig]['nombre']}»", "combate"))
        self._marcar(token)
        return True

    # ── Derrotas ─────────────────────────────────────────────────
    _profundidad_derrota = 0

    def al_derrotar(self, vencedor: dict | None, vencido: dict):
        """Alguien acaba de llegar a 0 de vida: «al ser derrotado» en el vencido y «al derrotar» en quien lo hizo.
        (Con un límite de cadena, por si un efecto de derrota derrota a su vez a otro.)"""
        if self._profundidad_derrota >= 5:
            return
        self._profundidad_derrota += 1
        try:
            self.otorgar_experiencia(vencido, vencedor)
            self.disparar("al_ser_derrotado", vencido, vencedor if vencedor is not vencido else None)
            if vencedor is not None and vencedor is not vencido:
                self.disparar("al_derrotar", vencedor, vencido)
        finally:
            self._profundidad_derrota -= 1

    # ── Condiciones («solo si…») ─────────────────────────────────
    def cumple(self, ef: dict, token: dict, otro: dict | None = None, pasivo: bool = False) -> bool:
        """¿Se cumplen TODAS las condiciones del efecto? `pasivo` = se está calculando un bono «siempre»
        (entonces las estadísticas se miran sin los bonos de otros efectos, para no dar vueltas en círculo)."""
        for c in ef.get("si") or ():
            try:
                if not self._condicion(c, token, otro, pasivo):
                    return False
            except (KeyError, TypeError, ValueError):
                return False        # una condición rara nunca rompe la partida: simplemente no se cumple
        return True

    def _condicion(self, c: dict, token: dict, otro: dict | None, pasivo: bool) -> bool:
        """Busca el manejador de esa condición en el registro `CONDICIONES` (abajo, uno por tipo). Tipo desconocido (campaña de una versión
        más nueva): no se cumple."""
        manejador = CONDICIONES.get(c["tipo"])
        return bool(manejador(self, c, token, otro, pasivo)) if manejador else False

    def _destino(self, h: dict, token: dict, otro: dict | None) -> dict | None:
        return token if h.get("objetivo", "uno_mismo") == "uno_mismo" else otro

    def _variables(self, token: dict, h: dict) -> dict:
        """Lo que la fórmula de un efecto puede citar de quien lo tiene (con [Cargas] si viene de un estado acumulado)."""
        v = self.stats_planas(token)
        v[recursos.CARGAS] = h.get("_cargas", 1)
        return v

    def _efecto_recurso(self, origen: str, token: dict, otro: dict | None, h: dict):
        destino = self._destino(h, token, otro)
        if destino is None:
            return
        try:
            res = formulas.evaluar(h["formula"], self._variables(token, h), self.stats_planas(otro) if otro else None, self.rng, tablas=self.tablas())
        except formulas.FormulaError:
            return          # una fórmula mala nunca debe romper la partida; la validación ya avisó al cargar
        d = self.datos_de(destino)
        if h["recurso"] not in d["recursos"]:
            return          # quien no tiene ese recurso (p. ej. Furia en un mago) no se ve afectado
        r = d["recursos"][h["recurso"]]
        antes = r["actual"]
        notas = []
        if h["recurso"] == self.cat.recurso_vida() and res.valor < 0:       # perder vida es daño: pasa por escudos y «al recibir daño»
            _, notas = self.danar(destino, -res.valor, token if destino is not token else otro)
        else:
            r["actual"] = max(0, min(r["max"], antes + res.valor))
            self.cambio_de_recurso(destino, h["recurso"], antes, r["actual"], token if destino is not token else otro)
        if r["actual"] == antes and not notas:
            return
        signo = "+" if r["actual"] > antes else ""
        texto = f"✨ {origen} → {d['nombre']}: {h['recurso']} {signo}{r['actual'] - antes}" + (f" ({', '.join(notas)})" if notas else "")
        derrota = h["recurso"] == self.cat.recurso_vida() and antes > 0 and r["actual"] == 0
        if derrota:
            texto += f" ☠️ {d['nombre']} ha sido derrotado"
        self.cola_chat.append((texto, "combate"))
        self._marcar(destino)
        if derrota:
            self.al_derrotar(token if destino is not token else None, destino)

    def _efecto_estadistica(self, origen: str, token: dict, otro: dict | None, h: dict):
        """Cambia para siempre una estadística base (experiencia, cordura…), sin pasar de su mínimo ni de su máximo."""
        destino = self._destino(h, token, otro)
        if destino is None:
            return
        try:
            res = formulas.evaluar(h["formula"], self._variables(token, h), self.stats_planas(otro) if otro else None, self.rng, tablas=self.tablas())
        except formulas.FormulaError:
            return
        d = self.datos_de(destino)
        k = h["estadistica"]
        if k not in d["stats"]:
            return          # quien no tiene esa estadística (p. ej. una propia de otra clase) no se ve afectado
        defi = next((e for e in self.cfg["juego"]["estadisticas"] if e["nombre"] == k), None)
        antes = d["stats"][k]
        d["stats"][k] = max(defi["minimo"], min(defi["maximo"], antes + res.valor)) if defi else antes + res.valor
        if d["stats"][k] == antes:
            return
        cambio = d["stats"][k] - antes
        self.cola_chat.append((f"✨ {origen} → {d['nombre']}: {k} {'+' if cambio > 0 else ''}{cambio}", "combate"))
        self._marcar(destino)
        self.revisar_nivel(destino)             # si es experiencia, quizá sube de nivel

    def _efecto_estado(self, origen: str, token: dict, otro: dict | None, h: dict):
        destino = self._destino(h, token, otro)
        if destino is None or h["estado"] not in self.cat.estados:
            return
        texto = self.poner_estado(destino, h["estado"])
        if texto:
            self.cola_chat.append((f"🌀 {origen}: {self.datos_de(destino)['nombre']} sufre «{texto}»", "combate"))

    def _marcar(self, token: dict):
        self.recalcular_maximos(token)                  # lo que cambió pudo mover un máximo calculado (Constitución, nivel…)
        self.cola_tokens.add(token["id"])
        if token["tipo"] == "personaje":
            self.guardar_jugador(token["dueno"])

    # ── Turnos ───────────────────────────────────────────────────
    def al_empezar_turno(self, token: dict):
        self.disparar("inicio_turno", token)

    def al_terminar_turno(self, token: dict):
        """Efectos de fin de turno y cuenta atrás de la duración de los estados (0 = permanente)."""
        self.disparar("fin_turno", token)
        nombre = self.datos_de(token)["nombre"]
        for est in list(token.get("estados", [])):
            if est not in token.get("estados", []):         # ya se quitó (un efecto «al terminar» de otro estado)
                continue
            if est["id"] not in self.cat.estados:
                token["estados"].remove(est)
                continue
            if est["turnos"] > 0:
                est["turnos"] -= 1
                if est["turnos"] == 0:
                    self.cola_chat.append((f"🌀 «{self.cat.estados[est['id']]['nombre']}» termina en {nombre}", "combate"))
                    self.quitar_estado_de(token, est["id"], "se_acaba")
                    continue
                self._marcar(token)

    # ── Tirada de estadística ────────────────────────────────────
    def tirar_estadistica(self, token: dict, estadistica: str, usuario: str) -> str:
        from .estado import ErrorJuego
        if estadistica not in self.cat.nombres_stats():
            raise ErrorJuego(f"La estadística «{estadistica}» no existe")
        plantilla = self.cat.config["juego"].get("tirada_estadistica") or TIRADA_ESTADISTICA_DEFECTO
        formula = plantilla.replace("{estadistica}", estadistica)
        try:
            r = formulas.evaluar(formula, self.stats_planas(token), None, self.rng, tablas=self.tablas())
        except formulas.FormulaError as e:
            raise ErrorJuego(f"Tirada inválida: {e}") from None
        bono = self.disparar("tirada", token, estadistica=estadistica)
        total = r.valor + bono
        nombre = self.datos_de(token)["nombre"]
        extra = f" {'+' if bono > 0 else '−'} {abs(bono)} (rasgos)" if bono else ""
        return f"🎲 {nombre} tiró {estadistica}: {total}{recursos.DETALLE}{r.detalle}{extra} = {total}"


# ── Registro de condiciones («solo si…») ─────────────────────────
# Añadir una condición nueva = escribir aquí UNA función con @condicion("nombre") y describirla en el catálogo de efectos.py (esquema para el Editor).
# Cada manejador recibe (motor, condición, token, otro, pasivo) y devuelve si se cumple.
CONDICIONES: dict = {}


def condicion(tipo: str):
    def registrar(fn):
        CONDICIONES[tipo] = fn
        return fn
    return registrar


def _sujeto(m, c: dict, token: dict, otro: dict | None):
    """A quién mira la condición («uno mismo» u «otro») y si pide que lo tenga o que no. None si no hay ese otro."""
    quien = token if c.get("quien", "uno_mismo") == "uno_mismo" else otro
    if quien is None:
        return None
    return quien, c.get("tiene", "si") == "si"


@condicion("probabilidad")
def _cond_probabilidad(m, c, token, otro, pasivo):
    return m.rng.random() * 100 < c["porcentaje"]


@condicion("en_combate")
def _cond_en_combate(m, c, token, otro, pasivo):
    return bool(m.combate["activo"]) == (c.get("activo", "si") == "si")


@condicion("momento_dia")
def _cond_momento_dia(m, c, token, otro, pasivo):
    ciclo = m.cfg["juego"]["ciclo"]
    if not ciclo["activo"] or not 0 <= m.periodo < len(ciclo["periodos"]):
        return False
    return ciclo["periodos"][m.periodo]["nombre"] == c["periodo"]


@condicion("clima")
def _cond_clima(m, c, token, otro, pasivo):
    clima = m.cfg["juego"]["clima"]
    if not clima["activo"] or not 0 <= m.clima < len(clima["tipos"]):
        return False
    return clima["tipos"][m.clima]["nombre"] == c["clima"]


@condicion("bando")
def _cond_bando(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    return bool(suj) and m.bando_de(suj[0]) == c["bando"]


@condicion("tiene_estado")
def _cond_tiene_estado(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    return bool(suj) and any(e["id"] == c["estado"] for e in suj[0].get("estados", [])) == suj[1]


@condicion("lleva_objeto")
def _cond_lleva_objeto(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    if not suj:
        return False
    inv = m.datos_de(suj[0]).get("inventario") or []
    return any(it.get("objeto") == c["objeto"] and it.get("cantidad", 1) > 0 for it in inv) == suj[1]


@condicion("tiene_etiqueta")
def _cond_tiene_etiqueta(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    return bool(suj) and (c["etiqueta"] in m.etiquetas_de(suj[0])) == suj[1]


@condicion("es_opcion")
def _cond_es_opcion(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    return bool(suj) and (c["opcion"] in (m.datos_de(suj[0]).get("elecciones") or {}).values()) == suj[1]


@condicion("recurso")
def _cond_recurso(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    if not suj:
        return False
    r = m.datos_de(suj[0])["recursos"].get(c["recurso"])
    if r is None:
        return False
    if c.get("unidad", "porcentaje") == "porcentaje":
        a, b = r["actual"] * 100, c["valor"] * max(1, r["max"])     # se compara sin decimales: actual/max frente a valor/100
    else:
        a, b = r["actual"], c["valor"]
    return _comparar(a, c.get("comparacion", "menos_de"), b)


@condicion("estadistica")
def _cond_estadistica(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    if not suj:
        return False
    quien = suj[0]
    if pasivo:
        d = m.datos_de(quien)
        valor = d["stats"].get(c["estadistica"], 0) + sum(op["bonos"].get(c["estadistica"], 0) for op in m.opciones_elegidas(d))
    else:
        valor = m.stats_efectivas(quien).get(c["estadistica"], 0)
    return _comparar(valor, c.get("comparacion", "al_menos"), c["valor"])


@condicion("critico")
def _cond_critico(m, c, token, otro, pasivo):
    return m._golpe is not None and bool(m._golpe.get("critico")) == (c.get("es", "si") == "si")


@condicion("dano")
def _cond_dano(m, c, token, otro, pasivo):
    return m._golpe is not None and _comparar(m._golpe.get("dano", 0), c.get("comparacion", "al_menos"), c["valor"])


@condicion("ronda")
def _cond_ronda(m, c, token, otro, pasivo):
    return bool(m.combate["activo"]) and _comparar(m.combate.get("ronda", 1), c.get("comparacion", "igual_a"), c["valor"])


@condicion("tiene_habilidad")
def _cond_tiene_habilidad(m, c, token, otro, pasivo):
    suj = _sujeto(m, c, token, otro)
    return bool(suj) and (c["habilidad"] in (m.datos_de(suj[0]).get("habilidades") or [])) == suj[1]


@condicion("actua_antes")
def _cond_actua_antes(m, c, token, otro, pasivo):
    orden = m.combate.get("orden") or []
    if not m.combate["activo"] or otro is None or token["id"] not in orden or otro["id"] not in orden:
        return False
    return (orden.index(token["id"]) < orden.index(otro["id"])) == (c.get("tiene", "si") == "si")


@condicion("cargas")
def _cond_cargas(m, c, token, otro, pasivo):
    quien = token if c.get("quien", "uno_mismo") == "uno_mismo" else otro
    if quien is None:
        return False
    est = next((e for e in quien.get("estados", []) if e["id"] == c["estado"]), None)
    n = 0 if est is None else est.get("cargas", 1)
    return _comparar(n, c.get("comparacion", "al_menos"), c["valor"])


# Acciones de efecto que cambian algo en la partida: tipo → método del motor que la ejecuta (las demás, como los bonos, se calculan aparte).
ACCIONES_ACTIVAS = {
    "modificar_recurso": "_efecto_recurso",
    "aplicar_estado": "_efecto_estado",
    "quitar_estado": "_efecto_quitar_estado",
    "modificar_estadistica": "_efecto_estadistica",
}
