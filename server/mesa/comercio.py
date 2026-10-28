"""
comercio.py — Tiendas del GM e intercambios entre jugadores.

- Tiendas: las define el Editor (shops/*.yaml). El GM las abre y cierra durante la partida; los jugadores compran
  (y, si la tienda lo permite, venden) con el dinero de su personaje. El stock que queda se guarda con la partida.
- Inventarios de grupo («cofres»): objetos y dinero en común. Por defecto hay uno para todos los jugadores; el GM puede crear
  más y elegir quién forma parte de cada uno, cerrarlos (nadie saca) o borrarlos. Se guardan con la partida.
- Intercambios: dos jugadores ponen sobre la mesa objetos y/o dinero; cuando los DOS aceptan la oferta tal como está,
  se hace el cambio de golpe. Cualquier cambio en una oferta quita las dos aceptaciones. No se guardan: viven mientras dura la sesión.
"""

from __future__ import annotations

import uuid

from .errores import ErrorJuego


def _id() -> str:
    return uuid.uuid4().hex[:8]


MAX_DINERO = 10 ** 9


def _cantidad(n, maximo=999) -> int:
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= maximo:
        raise ErrorJuego(f"La cantidad debe ser un entero entre 1 y {maximo}")
    return n


def tiene(d: dict, objeto: str) -> int:
    return next((e["cantidad"] for e in d["inventario"] if e["objeto"] == objeto), 0)


def dar(d: dict, objeto: str, n: int):
    e = next((e for e in d["inventario"] if e["objeto"] == objeto), None)
    if e:
        e["cantidad"] += n
    else:
        d["inventario"].append({"objeto": objeto, "cantidad": n})


def quitar(d: dict, objeto: str, n: int):
    e = next((e for e in d["inventario"] if e["objeto"] == objeto), None)
    if not e or e["cantidad"] < n:
        raise ErrorJuego("No tienes suficientes unidades de ese objeto")
    e["cantidad"] -= n
    if e["cantidad"] <= 0:
        d["inventario"].remove(e)


class ComercioMixin:
    """Se mezcla con EstadoPartida (usa self.cat, self.cfg, self.personajes y guardar_jugador / guardar_estado)."""

    def _iniciar_comercio(self):
        self.tiendas_abiertas: list[str] = []
        self.stock_tienda: dict[str, dict[str, int]] = {}
        self.intercambios: dict[str, dict] = {}        # id → intercambio en curso (no se guarda)
        self.cofres: dict[str, dict] = {}              # inventarios de grupo: id → {id, nombre, miembros (None = todos), inventario, dinero, cerrado}

    def _comercio_activo(self):
        if not self.cfg["juego"]["moneda"]["activa"]:
            raise ErrorJuego("Esta campaña no usa dinero")

    # ── Tiendas ──────────────────────────────────────────────────
    def _stock(self, tienda_id: str, objeto: str):
        """Unidades que quedan (None = ilimitado)."""
        base = next((a["stock"] for a in self.cat.tiendas[tienda_id]["articulos"] if a["objeto"] == objeto), None)
        if base is None:
            return None
        return self.stock_tienda.get(tienda_id, {}).get(objeto, base)

    def vista_tienda(self, tienda_id: str) -> dict:
        t = self.cat.tiendas[tienda_id]
        return {"id": tienda_id, "nombre": t["nombre"], "descripcion": t["descripcion"], "recompra": t["recompra"],
                "aqui": self.tienda_aqui(tienda_id), "mapas": list(t.get("mapas", [])),
                "articulos": [{"objeto": a["objeto"], "precio": a["precio"], "stock": self._stock(tienda_id, a["objeto"])} for a in t["articulos"]]}

    def tienda_aqui(self, tienda_id: str) -> bool:
        """Una tienda ligada a mapas solo atiende mientras la partida está en uno de ellos (sin mapas = en todos)."""
        mapas = self.cat.tiendas[tienda_id].get("mapas") or []
        return not mapas or getattr(self, "mapa_id", None) in mapas

    def vista_tiendas(self) -> list[dict]:
        return [self.vista_tienda(i) for i in self.tiendas_abiertas if i in self.cat.tiendas]

    def abrir_tienda(self, tienda_id, abierta: bool, reponer: bool = False) -> dict:
        if not isinstance(tienda_id, str) or tienda_id not in self.cat.tiendas:
            raise ErrorJuego("Esa tienda no existe")
        self._comercio_activo()
        if abierta and tienda_id not in self.tiendas_abiertas:
            self.tiendas_abiertas.append(tienda_id)
        elif not abierta and tienda_id in self.tiendas_abiertas:
            self.tiendas_abiertas.remove(tienda_id)
        if reponer:
            self.stock_tienda.pop(tienda_id, None)
        self.guardar_estado()
        return self.cat.tiendas[tienda_id]

    def _personaje(self, usuario: str, personaje_id) -> dict:
        p = self.buscar_personaje(usuario, personaje_id) if isinstance(personaje_id, str) else None
        if not p:
            raise ErrorJuego("Primero elige un personaje")
        return p

    def comprar(self, usuario: str, personaje_id, tienda_id, objeto, cantidad) -> str:
        self._comercio_activo()
        p = self._personaje(usuario, personaje_id)
        if not isinstance(tienda_id, str) or tienda_id not in self.tiendas_abiertas or tienda_id not in self.cat.tiendas:
            raise ErrorJuego("Esa tienda no está abierta")
        if not self.tienda_aqui(tienda_id):
            raise ErrorJuego("Esa tienda no está en este mapa")
        n = _cantidad(cantidad)
        art = next((a for a in self.cat.tiendas[tienda_id]["articulos"] if a["objeto"] == objeto), None) if isinstance(objeto, str) else None
        if not art:
            raise ErrorJuego("Esa tienda no vende eso")
        resto = self._stock(tienda_id, objeto)
        if resto is not None and n > resto:
            raise ErrorJuego("No quedan tantas unidades" if resto else "Se agotó")
        total = art["precio"] * n
        if p.get("dinero", 0) < total:
            raise ErrorJuego("No tienes dinero suficiente")
        p["dinero"] = p.get("dinero", 0) - total
        dar(p, objeto, n)
        if resto is not None:
            self.stock_tienda.setdefault(tienda_id, {})[objeto] = resto - n
        self.guardar_jugador(usuario)
        self.guardar_estado()
        return f"🛒 {p['nombre']} compró {n} × {self.cat.objetos[objeto]['nombre']} en «{self.cat.tiendas[tienda_id]['nombre']}»."

    def vender(self, usuario: str, personaje_id, tienda_id, objeto, cantidad) -> str:
        self._comercio_activo()
        p = self._personaje(usuario, personaje_id)
        if not isinstance(tienda_id, str) or tienda_id not in self.tiendas_abiertas or tienda_id not in self.cat.tiendas:
            raise ErrorJuego("Esa tienda no está abierta")
        if not self.tienda_aqui(tienda_id):
            raise ErrorJuego("Esa tienda no está en este mapa")
        tienda = self.cat.tiendas[tienda_id]
        if tienda["recompra"] <= 0:
            raise ErrorJuego("Esta tienda no compra objetos")
        if objeto not in self.cat.objetos:
            raise ErrorJuego("Ese objeto no existe")
        n = _cantidad(cantidad)
        art = next((a for a in tienda["articulos"] if a["objeto"] == objeto), None)
        precio = (art["precio"] if art else self.cat.objetos[objeto]["precio"]) * tienda["recompra"] // 100
        quitar(p, objeto, n)
        p["dinero"] = min(MAX_DINERO, p.get("dinero", 0) + precio * n)
        self.guardar_jugador(usuario)
        return f"💰 {p['nombre']} vendió {n} × {self.cat.objetos[objeto]['nombre']} a «{tienda['nombre']}» por {precio * n}."

    # ── Intercambios entre jugadores ─────────────────────────────
    def intercambio_de(self, usuario: str) -> dict | None:
        return next((x for x in self.intercambios.values() if usuario in (x["partes"][0]["usuario"], x["partes"][1]["usuario"])), None)

    def proponer_intercambio(self, ua: str, pa, ub: str, pb) -> dict:
        self._comercio_activo()
        if not self.cfg["permisos"]["intercambios"]:
            raise ErrorJuego("En esta mesa no se permiten los intercambios")
        if ua.casefold() == ub.casefold():
            raise ErrorJuego("No puedes intercambiar contigo mismo")
        a, b = self._personaje(ua, pa), None
        try:
            b = self._personaje(ub, pb)
        except ErrorJuego:
            raise ErrorJuego("Esa persona todavía no ha elegido personaje")
        if self.intercambio_de(ua) or self.intercambio_de(ub):
            raise ErrorJuego("Alguno de los dos ya está en un intercambio")
        x = {"id": _id(), "partes": [
            {"usuario": ua, "personaje": a["id"], "items": {}, "dinero": 0, "acepto": False},
            {"usuario": ub, "personaje": b["id"], "items": {}, "dinero": 0, "acepto": False}]}
        self.intercambios[x["id"]] = x
        return x

    def vista_intercambio(self, x: dict) -> dict:
        def parte(p):
            pj = self.buscar_personaje(p["usuario"], p["personaje"])
            return {"usuario": p["usuario"], "nombre": pj["nombre"] if pj else p["usuario"], "items": [{"objeto": o, "cantidad": n} for o, n in p["items"].items()],
                    "dinero": p["dinero"], "acepto": p["acepto"]}
        return {"id": x["id"], "partes": [parte(p) for p in x["partes"]]}

    def _mi_parte(self, usuario: str):
        x = self.intercambio_de(usuario)
        if not x:
            raise ErrorJuego("No estás en ningún intercambio")
        return x, next(p for p in x["partes"] if p["usuario"] == usuario)

    def ofrecer(self, usuario: str, items, dinero) -> dict:
        x, mia = self._mi_parte(usuario)
        if not isinstance(items, dict) or len(items) > 30:
            raise ErrorJuego("Oferta no válida")
        if isinstance(dinero, bool) or not isinstance(dinero, int) or not 0 <= dinero <= MAX_DINERO:
            raise ErrorJuego("El dinero debe ser un entero desde 0")
        yo = self._personaje(usuario, mia["personaje"])
        limpios = {}
        for o, n in items.items():
            if o not in self.cat.objetos:
                raise ErrorJuego("Ese objeto no existe")
            n = _cantidad(n)
            if n > tiene(yo, o):
                raise ErrorJuego("No tienes tantas unidades para ofrecer")
            limpios[o] = n
        if dinero > yo.get("dinero", 0):
            raise ErrorJuego("No tienes tanto dinero para ofrecer")
        mia["items"], mia["dinero"] = limpios, dinero
        for p in x["partes"]:
            p["acepto"] = False                     # cambiar la oferta quita las dos aceptaciones
        return x

    def aceptar_intercambio(self, usuario: str, acepto: bool):
        """Devuelve (intercambio, texto): texto solo si se completó."""
        x, mia = self._mi_parte(usuario)
        mia["acepto"] = bool(acepto)
        if not all(p["acepto"] for p in x["partes"]):
            return x, None
        a, b = x["partes"]
        pa, pb = self._personaje(a["usuario"], a["personaje"]), self._personaje(b["usuario"], b["personaje"])
        for parte, pj in ((a, pa), (b, pb)):          # se vuelve a comprobar todo por si algo cambió mientras tanto
            if parte["dinero"] > pj.get("dinero", 0) or any(n > tiene(pj, o) for o, n in parte["items"].items()):
                for p in x["partes"]:
                    p["acepto"] = False
                raise ErrorJuego(f"{pj['nombre']} ya no tiene lo que ofrecía")
        for parte, de, a_ in ((a, pa, pb), (b, pb, pa)):
            for o, n in parte["items"].items():
                quitar(de, o, n)
                dar(a_, o, n)
            de["dinero"] = de.get("dinero", 0) - parte["dinero"]
            a_["dinero"] = min(MAX_DINERO, a_.get("dinero", 0) + parte["dinero"])
        self.guardar_jugador(a["usuario"])
        self.guardar_jugador(b["usuario"])
        del self.intercambios[x["id"]]
        return x, f"🤝 {pa['nombre']} y {pb['nombre']} hicieron un intercambio."

    def cancelar_intercambio(self, usuario: str) -> dict | None:
        x = self.intercambio_de(usuario)
        if x:
            del self.intercambios[x["id"]]
        return x


MAX_COFRES = 20
COFRE_COMUN = "comun"


class CofresMixin:
    """Inventarios de grupo. Se mezcla con EstadoPartida."""

    def _iniciar_cofres(self):
        if self.cfg["juego"]["inventario_grupo"] and COFRE_COMUN not in self.cofres:
            ini = self.cfg["juego"].get("inventario_grupo_inicial") or {}
            self.cofres[COFRE_COMUN] = {"id": COFRE_COMUN, "nombre": "Inventario del grupo", "miembros": None,
                                        "inventario": [dict(e) for e in ini.get("inventario", [])], "dinero": ini.get("dinero", 0), "cerrado": False}

    def cofres_validos(self, crudo) -> dict:
        """Cofres guardados: se conserva solo lo que sigue teniendo sentido (objetos que existen, cantidades razonables)."""
        res = {}
        for cid, c in (crudo.items() if isinstance(crudo, dict) else []):
            if not isinstance(c, dict) or not isinstance(cid, str) or len(res) >= MAX_COFRES:
                continue
            inv = [{"objeto": e["objeto"], "cantidad": min(9999, e["cantidad"])} for e in (c.get("inventario") or [])
                   if isinstance(e, dict) and e.get("objeto") in self.cat.objetos and isinstance(e.get("cantidad"), int) and not isinstance(e.get("cantidad"), bool) and e["cantidad"] > 0]
            miembros = c.get("miembros")
            res[cid] = {"id": cid, "nombre": str(c.get("nombre") or "Inventario")[:40],
                        "miembros": None if miembros is None else [m for m in miembros if isinstance(m, str)][:50] if isinstance(miembros, list) else None,
                        "inventario": inv, "dinero": c["dinero"] if isinstance(c.get("dinero"), int) and not isinstance(c.get("dinero"), bool) and 0 <= c["dinero"] <= MAX_DINERO else 0,
                        "cerrado": c.get("cerrado") is True}
        return res

    def es_miembro(self, cofre: dict, usuario: str, es_gm: bool) -> bool:
        return es_gm or cofre["miembros"] is None or usuario.casefold() in (m.casefold() for m in cofre["miembros"])

    @property
    def inv_grupo_activo(self) -> bool:
        """`juego.inventario_grupo`: interruptor de todo el apartado de inventarios de grupo (lo guardado no se borra: al volver a activarlo reaparece)."""
        return bool(self.cfg["juego"]["inventario_grupo"])

    def cofres_para(self, usuario: str, es_gm: bool) -> list[dict]:
        if not self.inv_grupo_activo:
            return []
        return [dict(c, inventario=[dict(e) for e in c["inventario"]], miembros=None if c["miembros"] is None else list(c["miembros"]))
                for c in self.cofres.values() if self.es_miembro(c, usuario, es_gm)]

    def _cofre(self, cofre_id, usuario: str, es_gm: bool) -> dict:
        if not self.inv_grupo_activo:
            raise ErrorJuego("Los inventarios de grupo están desactivados en esta campaña")
        c = self.cofres.get(cofre_id) if isinstance(cofre_id, str) else None
        if not c or not self.es_miembro(c, usuario, es_gm):
            raise ErrorJuego("Ese inventario de grupo no existe o no es tuyo")
        return c

    def mover_a_cofre(self, usuario: str, es_gm: bool, cofre_id, personaje_id, objeto=None, cantidad=None, dinero=None, sacar=False) -> str:
        """Mete (o saca, con `sacar`) objetos o dinero entre un personaje del usuario y un inventario de grupo."""
        c = self._cofre(cofre_id, usuario, es_gm)
        if sacar and c["cerrado"] and not es_gm:
            raise ErrorJuego("El GM ha cerrado este inventario: ahora no se puede sacar nada")
        p = self._personaje(usuario, personaje_id)
        if objeto is not None:
            if not isinstance(objeto, str) or objeto not in self.cat.objetos:
                raise ErrorJuego("Ese objeto no existe")
            n = _cantidad(cantidad, 9999)
            nombre = self.cat.objetos[objeto]["nombre"]
            if sacar:
                if tiene(c, objeto) < n:
                    raise ErrorJuego("No hay tantas unidades en el inventario del grupo")
                quitar(c, objeto, n)
                dar(p, objeto, n)
                texto = f"📦 {p['nombre']} sacó {n} × {nombre} de «{c['nombre']}»."
            else:
                quitar(p, objeto, n)
                dar(c, objeto, n)
                texto = f"📦 {p['nombre']} guardó {n} × {nombre} en «{c['nombre']}»."
        elif dinero is not None:
            if isinstance(dinero, bool) or not isinstance(dinero, int) or not 1 <= dinero <= MAX_DINERO:
                raise ErrorJuego("La cantidad de dinero no es válida")
            origen, destino = (c, p) if sacar else (p, c)
            if origen.get("dinero", 0) < dinero:
                raise ErrorJuego("No hay tanto dinero" if sacar else "No tienes tanto dinero")
            origen["dinero"] = origen.get("dinero", 0) - dinero
            destino["dinero"] = min(MAX_DINERO, destino.get("dinero", 0) + dinero)
            texto = f"💰 {p['nombre']} {'sacó' if sacar else 'guardó'} {dinero} {'de' if sacar else 'en'} «{c['nombre']}»."
        else:
            raise ErrorJuego("Indica un objeto o una cantidad de dinero")
        self.guardar_jugador(usuario)
        self.guardar_estado()
        return texto

    def gm_cofre(self, accion, cofre_id=None, nombre=None, miembros=None, cerrado=None, objeto=None, cantidad=None, dinero=None) -> str:
        """El GM crea, cambia o borra inventarios de grupo, y pone o quita objetos y dinero directamente."""
        if not self.inv_grupo_activo:
            raise ErrorJuego("Los inventarios de grupo están desactivados en esta campaña")
        if accion == "crear":
            if len(self.cofres) >= MAX_COFRES:
                raise ErrorJuego(f"Como mucho {MAX_COFRES} inventarios de grupo")
            cid = _id()
            self.cofres[cid] = {"id": cid, "nombre": "", "miembros": [], "inventario": [], "dinero": 0, "cerrado": False}
            c = self.cofres[cid]
            accion = "editar"
        else:
            c = self.cofres.get(cofre_id) if isinstance(cofre_id, str) else None
            if not c:
                raise ErrorJuego("Ese inventario de grupo no existe")
        if accion == "borrar":
            del self.cofres[c["id"]]
            self.guardar_estado()
            return f"🗑️ El GM quitó el inventario «{c['nombre']}»."
        if accion == "editar":
            if nombre is not None:
                if not isinstance(nombre, str) or not 1 <= len(nombre.strip()) <= 40:
                    raise ErrorJuego("El nombre debe tener entre 1 y 40 caracteres")
                c["nombre"] = nombre.strip()
            elif not c["nombre"]:
                c["nombre"] = "Inventario nuevo"
            if miembros == "todos":
                c["miembros"] = None
            elif miembros is not None:
                c["miembros"] = self._miembros_validos(miembros)
            if cerrado is not None:
                if not isinstance(cerrado, bool):
                    raise ErrorJuego("Datos no válidos")
                c["cerrado"] = cerrado
            self.guardar_estado()
            return f"📦 «{c['nombre']}»: {'todos los jugadores' if c['miembros'] is None else ', '.join(c['miembros']) or 'nadie (solo el GM)'}{' · cerrado' if c['cerrado'] else ''}."
        if accion == "objeto":
            if not isinstance(objeto, str) or objeto not in self.cat.objetos:
                raise ErrorJuego("Ese objeto no existe")
            if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 9999:
                raise ErrorJuego("La cantidad debe ser un entero distinto de 0")
            if cantidad > 0:
                dar(c, objeto, cantidad)
            else:
                quitar(c, objeto, -cantidad)
            self.guardar_estado()
            return f"📦 El GM {'puso' if cantidad > 0 else 'quitó'} {abs(cantidad)} × {self.cat.objetos[objeto]['nombre']} {'en' if cantidad > 0 else 'de'} «{c['nombre']}»."
        if accion == "dinero":
            if isinstance(dinero, bool) or not isinstance(dinero, int) or abs(dinero) > MAX_DINERO:
                raise ErrorJuego("La cantidad de dinero no es válida")
            c["dinero"] = max(0, min(MAX_DINERO, c["dinero"] + dinero))
            self.guardar_estado()
            return f"💰 El GM {'puso' if dinero >= 0 else 'quitó'} {abs(dinero)} {'en' if dinero >= 0 else 'de'} «{c['nombre']}»."
        raise ErrorJuego("Acción no válida")
