"""personajes.py — Personajes de los jugadores: crear, repartir puntos, editar la ficha, desplegar y retirar del mapa.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

import copy

from . import recursos
from .errores import ErrorJuego
from .utiles import nuevo_id


_EXT_IMAGEN = (".png", ".jpg", ".jpeg", ".webp", ".gif")
_CARPETAS_IMAGEN = ("tokens", "icons", "otros")      # de dónde puede elegir un jugador la imagen de su personaje


def nombre_imagen(v) -> str:
    """Imagen elegida por un jugador: un archivo de la carpeta de imágenes del cliente («tokens/orco.png», «tokens/jugadores/ana.png»,
    «icons/retratos/lobo.png»…). Puede estar en tokens/, icons/ u otros/ y en hasta tres subcarpetas; un nombre suelto se entiende en tokens/.
    El servidor solo guarda el nombre (no guarda ni envía imágenes); lo que no parezca una ruta segura se descarta."""
    if not isinstance(v, str):
        return ""
    v = v.strip()
    if not v or len(v) > 200:
        return ""
    partes = v.split("/")
    if len(partes) == 1 or partes[0] not in _CARPETAS_IMAGEN:
        partes = ["tokens", *partes] if len(partes) == 1 else partes
    if partes[0] not in _CARPETAS_IMAGEN or not 1 <= len(partes) - 1 <= 4:
        return ""
    for t in partes[1:]:
        if not t or len(t) > 100 or any(c in t for c in '\\:*?"<>|\x00') or t.startswith(".") or t.endswith((".", " ")):
            return ""
    return "/".join(partes) if partes[-1].lower().endswith(_EXT_IMAGEN) else ""


LIMITE_PROPIAS = 30


def normalizar_propias(d, estricto: bool = False) -> dict:
    """{habilidades:[{nombre,descripcion}], objetos:[{nombre,descripcion,cantidad}]}; texto acotado. Con `estricto` lanza error si algo no cuadra."""
    d = d if isinstance(d, dict) else {}
    res = {"habilidades": [], "objetos": []}
    for tipo in res:
        crudo = d.get(tipo) if isinstance(d.get(tipo), list) else []
        for e in crudo[:LIMITE_PROPIAS]:
            nombre = str(e.get("nombre", "")).strip()[:40] if isinstance(e, dict) else ""
            if not nombre:
                if estricto:
                    raise ErrorJuego("Cada anotación necesita un nombre")
                continue
            item = {"nombre": nombre, "descripcion": str(e.get("descripcion", "")).strip()[:300]}
            if tipo == "objetos":
                c = e.get("cantidad", 1)
                item["cantidad"] = max(1, min(999, c)) if isinstance(c, int) and not isinstance(c, bool) else 1
            res[tipo].append(item)
    return res


MAX_HISTORIA = 20000         # la historia del personaje (varias páginas)


class PersonajesMixin:
    def registrar_usuario(self, usuario: str):
        if usuario not in self.personajes:
            self.personajes[usuario] = self._leer_jugador(usuario)

    def personajes_de(self, usuario: str) -> list[dict]:
        return self.personajes.get(usuario, [])

    def buscar_personaje(self, usuario: str, personaje_id: str) -> dict | None:
        return next((p for p in self.personajes_de(usuario) if p["id"] == personaje_id), None)

    def crear_personaje(self, usuario: str, es_gm: bool, base_id: str, nombre: str, historia: str = "",
                        elecciones: dict | None = None, reparto: dict | None = None,
                        imagen: str = "", imagen_biografia: str = "", campos=None) -> dict:
        """Crea un personaje del jugador. Una mascota, una criatura o una invocación es, simplemente, otro personaje suyo."""
        permisos = self.cfg["permisos"]
        if not permisos["crear_personajes"] and not es_gm:
            raise ErrorJuego("En este servidor los jugadores no pueden crear personajes")
        if len(self.personajes_de(usuario)) >= permisos["max_personajes_por_jugador"] and not es_gm:
            raise ErrorJuego(f"Solo puedes tener {permisos['max_personajes_por_jugador']} personajes")
        # Plantilla opcional (el cliente ya no las usa): sin ella, todo sale de las estadísticas y recursos globales y de las elecciones.
        base = self.cat.personajes.get(base_id) if base_id else {}
        if base_id and not base:
            raise ErrorJuego("Esa plantilla de personaje no existe")
        nombre = (nombre or "").strip()
        if not (1 <= len(nombre) <= 30):
            raise ErrorJuego("El nombre del personaje debe tener entre 1 y 30 caracteres")
        if any(p["nombre"].casefold() == nombre.casefold() for p in self.personajes_de(usuario)):
            raise ErrorJuego("Ya tienes un personaje con ese nombre")
        elegidas = self._validar_elecciones(base, elecciones, es_gm)
        stats = self.stats_iniciales(base, elegidas)
        puntos = self.cat.puntos_a_repartir(elegidas)
        if reparto:        # al crear, cada jugador reparte sus puntos; «editar_stats_jugador» solo manda sobre los puntos que se ganen después
            puntos -= self._aplicar_reparto(stats, reparto, puntos)
        habilidades = list(base.get("habilidades", []))
        for o in elegidas.values():
            for h in self.cat.opciones[o]["habilidades"]:
                if h not in habilidades:
                    habilidades.append(h)
        p = {
            "id": nuevo_id(), "nombre": nombre, "dueno": usuario, "base": base_id,
            "imagen": nombre_imagen(imagen) or base.get("imagen", ""), "imagen_biografia": nombre_imagen(imagen_biografia),
            "historia": (historia or "")[:MAX_HISTORIA],
            "elecciones": elegidas, "nivel": 1, "puntos_pendientes": puntos, "personalidad": [], "propias": {"habilidades": [], "objetos": []},
            "stats": stats,
            "recursos": self._recursos_nuevos({**self.cat.recursos_base(elegidas), **(base.get("recursos") or {})}),
            "habilidades": habilidades,
            "inventario": copy.deepcopy(base.get("inventario", [])),
            "dinero": base.get("dinero") or self.cfg["juego"]["moneda"]["inicial"],
            "sonidos": list(base.get("sonidos", [])),
        }
        # Si alguna opción elegida trae imagen de forma (una especie, la forma de lobo…), el token la usa desde el principio;
        # la imagen que eligió el jugador se guarda como la suya propia (para cuando vuelva a una forma sin imagen).
        forma = next((self.cat.opciones[o]["imagen_forma"] for o in elegidas.values() if self.cat.opciones[o].get("imagen_forma")), "")
        if forma:
            p["imagen_propia"] = p["imagen"]
            p["imagen"] = forma
        p["campos"] = self.campos_limpios(campos, {}, es_gm)
        self.personajes.setdefault(usuario, []).append(p)
        self.guardar_jugador(usuario)
        return p

    def _recursos_nuevos(self, maximos: dict) -> dict:
        """Recursos de alguien que acaba de aparecer: llenos, salvo los que la campaña marca «empieza vacío» (experiencia, furia…)."""
        vacios = {r["nombre"] for r in self.cfg["juego"]["recursos"] if r.get("empieza_vacio")}
        return {n: {"actual": 0 if n in vacios else mx, "max": mx} for n, mx in maximos.items()}

    def stats_iniciales(self, base: dict, elecciones: dict | None = None) -> dict:
        """Estadísticas con las que nace un personaje: las de la plantilla solo si la campaña lo pide; si no, las globales
        («para todos») más lo que aporten sus opciones (la clase puede añadir estadísticas o cambiar su valor inicial)."""
        if base and self.cfg["juego"]["stats_por_plantilla"]:
            return copy.deepcopy(base["stats"])
        return self.cat.stats_base(elecciones)

    def _validar_elecciones(self, base: dict, elecciones: dict | None, es_gm: bool = True) -> dict:
        """Una opción por grupo. Lo que no se elija se toma de la plantilla; los grupos obligatorios no pueden quedar vacíos."""
        if elecciones is not None and not isinstance(elecciones, dict):
            raise ErrorJuego("Las elecciones deben ser un conjunto de grupo → opción")
        if not self.cfg["juego"]["usar_grupos"]:
            return {}                      # la campaña no usa razas ni clases: se ignoran
        res = dict((base or {}).get("elecciones") or {})
        for g, o in (elecciones or {}).items():
            if g not in self.cat.grupos:
                raise ErrorJuego(f"El grupo «{g}» no existe")
            if o not in self.cat.opciones or self.cat.opciones[o]["grupo"] != g:
                raise ErrorJuego(f"La opción «{o}» no pertenece al grupo «{self.cat.grupos[g]['nombre']}»")
            if not es_gm and not self.cat.opciones[o].get("elegible", True):
                raise ErrorJuego(f"«{self.cat.opciones[o]['nombre']}» no se puede elegir al crear un personaje")
            res[g] = o
        for g in list(res):
            if not self.grupo_activo(g, res):
                raise ErrorJuego(f"«{self.cat.grupos[g]['nombre']}» no corresponde con lo que elegiste")
        for g, gd in self.cat.grupos.items():
            elegibles = [o for o in self.cat.opciones_de(g) if es_gm or self.cat.opciones[o].get("elegible", True)]
            if gd["obligatorio"] and g not in res and elegibles and self.grupo_activo(g, res):
                raise ErrorJuego(f"Debes elegir una opción de «{gd['nombre']}»")
        return res

    def grupo_activo(self, grupo: str, elecciones: dict, _n: int = 0) -> bool:
        """¿Este grupo de elección aplica a quien eligió `elecciones`? (solo_si: solo si en otro grupo eligió ciertas opciones)."""
        s = self.cat.grupos.get(grupo, {}).get("solo_si")
        if not s or _n > 10:
            return True
        return elecciones.get(s["grupo"]) in s["opciones"] and self.grupo_activo(s["grupo"], elecciones, _n + 1)

    def _aplicar_reparto(self, stats: dict, reparto: dict, disponibles: int) -> int:
        """Suma puntos a las estadísticas base (sin pasar de su máximo ni de los puntos disponibles). → puntos gastados."""
        if not isinstance(reparto, dict):
            raise ErrorJuego("El reparto debe indicar cuántos puntos va a cada estadística")
        definidas = {e["nombre"]: e for e in self.cfg["juego"]["estadisticas"]}
        gasto = 0
        nuevas = dict(stats)
        for k, n in reparto.items():
            if k not in definidas:
                raise ErrorJuego(f"La estadística «{k}» no existe")
            if k not in stats:
                raise ErrorJuego(f"Este personaje no tiene la estadística «{k}»")
            if not definidas[k].get("repartible", True):
                if n:
                    raise ErrorJuego(f"«{k}» no recibe puntos: cambia durante la partida (efectos o el GM)")
                continue
            if isinstance(n, bool) or not isinstance(n, int) or n < 0:
                raise ErrorJuego(f"Los puntos de «{k}» deben ser un entero mayor o igual que 0")
            if nuevas[k] + n > definidas[k]["maximo"]:
                raise ErrorJuego(f"«{k}» no puede superar {definidas[k]['maximo']}")
            nuevas[k] += n
            gasto += n
        if gasto > disponibles:
            raise ErrorJuego(f"Solo tienes {disponibles} puntos para repartir")
        stats.update(nuevas)
        return gasto

    def repartir_puntos(self, usuario: str, personaje_id: str, reparto: dict, es_gm: bool) -> dict:
        """Gasta puntos pendientes de un personaje. El dueño solo puede si la campaña lo permite (editar_stats_jugador)."""
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if not (es_gm or self.cfg["permisos"]["editar_stats_jugador"]):
            raise ErrorJuego("En este servidor solo el GM reparte los puntos de estadística")
        gasto = self._aplicar_reparto(p["stats"], reparto, p.get("puntos_pendientes", 0))
        p["puntos_pendientes"] = p.get("puntos_pendientes", 0) - gasto
        self.guardar_jugador(usuario)
        return p

    def editar_personalidad(self, usuario: str, personaje_id: str, rasgos, es_gm: bool) -> dict:
        """Rasgos de personalidad (Maldito, Maniático…): los escribe el jugador si el GM lo permite."""
        if not (es_gm or self.cfg["permisos"]["rasgos_personalidad"]):
            raise ErrorJuego("En este servidor solo el GM puede cambiar los rasgos de personalidad")
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if not isinstance(rasgos, list) or len(rasgos) > 8:
            raise ErrorJuego("Puedes tener hasta 8 rasgos de personalidad")
        limpios: list[str] = []
        for r in rasgos:
            if not isinstance(r, str) or not (1 <= len(r.strip()) <= 30):
                raise ErrorJuego("Cada rasgo debe tener entre 1 y 30 caracteres")
            if r.strip().casefold() not in (x.casefold() for x in limpios):
                limpios.append(r.strip())
        p["personalidad"] = limpios
        self.guardar_jugador(usuario)
        return p

    def campos_limpios(self, crudo, previos: dict | None, es_gm: bool, estricto: bool = True) -> dict:
        """Valores de los campos propios de la ficha (los define la campaña). El jugador no puede tocar los que son «del GM»."""
        defs = {c["nombre"]: c for c in self.cfg["juego"]["campos_ficha"]}
        res = {k: v for k, v in (previos or {}).items() if k in defs}
        if crudo is None:
            return res
        if not isinstance(crudo, dict) or len(crudo) > 40:
            if estricto:
                raise ErrorJuego("Datos de la ficha no válidos")
            return res
        for k, val in crudo.items():
            c = defs.get(k)
            if not c:
                if estricto:
                    raise ErrorJuego(f"La ficha no tiene el campo «{k}»")
                continue
            if c["quien"] == "gm" and not es_gm:
                if estricto and val != res.get(k):
                    raise ErrorJuego(f"«{k}» solo lo puede cambiar el GM")
                continue
            try:
                limpio = recursos.valor_campo(c, val)
            except ValueError as e:
                if estricto:
                    raise ErrorJuego(str(e)) from None
                continue
            if limpio is None:
                res.pop(k, None)
            else:
                res[k] = limpio
        return res

    def editar_campos(self, usuario: str, personaje_id: str, campos, es_gm: bool) -> dict:
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        p["campos"] = self.campos_limpios(campos, p.get("campos"), es_gm)
        self.guardar_jugador(usuario)
        return p

    def editar_propias(self, usuario: str, personaje_id: str, tipo, lista, es_gm: bool) -> dict:
        """Habilidades u objetos que el jugador anota él mismo: solo texto, sin efecto en el juego (el GM decide qué significan)."""
        if tipo not in ("habilidades", "objetos"):
            raise ErrorJuego("Tipo no válido")
        if not (es_gm or self.cfg["permisos"][f"{tipo}_propias" if tipo == "habilidades" else "objetos_propios"]):
            raise ErrorJuego("En este servidor solo el GM puede anotar eso")
        p = self.buscar_personaje(usuario, personaje_id)
        if not p:
            raise ErrorJuego("Ese personaje no existe")
        if not isinstance(lista, list) or len(lista) > LIMITE_PROPIAS:
            raise ErrorJuego(f"Puedes anotar hasta {LIMITE_PROPIAS}")
        limpia = normalizar_propias({tipo: lista}, estricto=True)[tipo]
        p.setdefault("propias", {"habilidades": [], "objetos": []})[tipo] = limpia
        self.guardar_jugador(usuario)
        return p

    def dar_puntos(self, token_id: str, cantidad: int) -> str:
        """Acción de GM: entrega (o quita) puntos de estadística pendientes (p. ej. al subir de nivel)."""
        t = self._token(token_id)
        if t["tipo"] != "personaje":
            raise ErrorJuego("Solo los personajes de jugadores tienen puntos pendientes")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or cantidad == 0 or abs(cantidad) > 1000:
            raise ErrorJuego("La cantidad debe ser un entero distinto de 0")
        p = self.datos_de(t)
        p["puntos_pendientes"] = max(0, p.get("puntos_pendientes", 0) + cantidad)
        self.guardar_jugador(t["dueno"])
        self._marcar(t)
        return p["nombre"]

    def todos_los_personajes(self) -> list[dict]:
        """Resumen de los personajes de TODOS los usuarios (también de quienes no están conectados). Para el GM."""
        usuarios = set(self.personajes)
        for nombre in self.almacen.listar("jugadores"):
            datos = self.almacen.cargar(nombre)
            u = datos.get("usuario") if datos is not None else None
            if isinstance(u, str):
                usuarios.add(u)
        res = []
        for u in sorted(usuarios, key=str.casefold):
            self.registrar_usuario(u)
            for p in self.personajes_de(u):
                res.append({"usuario": u, "id": p["id"], "nombre": p["nombre"], "imagen": p.get("imagen", ""),
                            "desplegado": self.token_de_personaje(u, p["id"]) is not None, "sala": self.sala_de_personaje(u, p["id"]),
                            "nivel": p.get("nivel", 1)})
        return res

    def token_de_personaje(self, usuario: str, personaje_id: str) -> dict | None:
        """El token de ese personaje, esté en la sala que esté (un personaje solo puede estar en una a la vez)."""
        return next((t for _, t in self.todos_los_tokens()
                     if t["tipo"] == "personaje" and t["dueno"] == usuario and t["personaje_id"] == personaje_id), None)

    def sala_de_personaje(self, usuario: str, personaje_id: str) -> str | None:
        t = self.token_de_personaje(usuario, personaje_id)
        return self.sala_de_token(t["id"]) if t else None

    def desplegar_personaje(self, usuario: str, personaje_id: str, solicitante: str, es_gm: bool,
                            x: int | None = None, y: int | None = None) -> tuple[dict, bool]:
        """Pone un personaje en el mapa: en el punto de inicio o en la casilla elegida. El GM despliega a cualquiera donde quiera;
        el dueño puede elegir casilla si la mesa lo permite, fuera de combate y (con niebla) solo donde ve."""
        if usuario != solicitante and not es_gm:
            raise ErrorJuego("Solo puedes desplegar tus propios personajes")
        self.registrar_usuario(usuario)
        if not self.buscar_personaje(usuario, personaje_id):
            raise ErrorJuego("Ese personaje no existe")
        existente = self.token_de_personaje(usuario, personaje_id)
        if existente:
            return existente, False
        if x is not None or y is not None:
            if not es_gm:
                if not self.cfg["permisos"]["desplegar_en_casilla"]:
                    raise ErrorJuego("Solo el GM puede elegir la casilla")
                if self.combate["activo"]:
                    raise ErrorJuego("Durante un combate solo el GM puede elegir dónde aparece un personaje")
                if self.niebla_activa() and (x, y) not in self.visibles_para(usuario):
                    raise ErrorJuego("Con niebla de guerra solo puedes desplegar donde ves")
            if not isinstance(x, int) or not isinstance(y, int) or not self.casilla_transitable(x, y):
                raise ErrorJuego("No se puede colocar ahí: casilla bloqueada o fuera del mapa")
            if self.casilla_ocupada(x, y):
                raise ErrorJuego("Esa casilla ya está ocupada")
        else:
            ini = self.mapa["inicio"]
            x, y = self._casilla_libre_cerca(ini["x"], ini["y"])
        t = {"id": nuevo_id(), "tipo": "personaje", "dueno": usuario, "personaje_id": personaje_id, "x": x, "y": y}
        self.tokens[t["id"]] = t
        self.guardar_estado()
        return t, True

    def _traspasar_personaje(self, token: dict, nuevo: str):
        """El GM da un personaje (su ficha y su token) a otro usuario: pasa de la lista del dueño anterior a la del nuevo."""
        viejo = token["dueno"]
        p = self.buscar_personaje(viejo, token["personaje_id"])
        if p is None:
            raise ErrorJuego("El personaje de este token ya no existe")
        self.registrar_usuario(nuevo)
        self.personajes[viejo] = [x for x in self.personajes_de(viejo) if x is not p]
        if any(x["id"] == p["id"] for x in self.personajes_de(nuevo)):
            p["id"] = nuevo_id()
        self.personajes[nuevo].append(p)
        token["dueno"], token["personaje_id"] = nuevo, p["id"]
        self._cache_vision.clear()
        self.guardar_jugador(viejo)
        self.guardar_jugador(nuevo)
        self.guardar_estado()

    def retirar_personaje(self, token_id: str, solicitante: str, es_gm: bool) -> str:
        """Quita del mapa el token de un personaje SIN borrar al personaje. El dueño solo puede hacerlo fuera de combate."""
        t = self._token(token_id)
        if t["tipo"] != "personaje":
            raise ErrorJuego("Eso no es un personaje")
        if not es_gm:
            if t["dueno"] != solicitante:
                raise ErrorJuego("Solo puedes retirar tus propios personajes")
            if self.combate["activo"]:
                raise ErrorJuego("No puedes retirarte durante un combate")
        nombre = self.nombre_de(t)
        self.quitar_token(token_id)
        return nombre
