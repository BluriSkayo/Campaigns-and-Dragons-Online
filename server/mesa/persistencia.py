"""persistencia.py — Guardar y cargar la partida (estado.yaml y una ficha por jugador) a través de un `Almacen`.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

import re

from . import recursos
from .chat import MAX_TIRADAS, RE_NOMBRE_TIRADA
from .errores import ErrorJuego
from .personajes import MAX_HISTORIA, nombre_imagen, normalizar_propias
from .recursos import MAX_NIVEL
from .utiles import SIN_VALOR, indice_en
from .vistas import CAMPOS_REVELABLES


def _archivo_usuario(usuario: str) -> str:
    return "jugadores/" + re.sub(r"[^\w\-]", "_", usuario.casefold()) + ".yaml"


class PersistenciaMixin:
    # ── Fichas de los jugadores (una por usuario) ────────────
    def guardar_jugador(self, usuario: str):
        self.almacen.guardar(_archivo_usuario(usuario), {"usuario": usuario, "personajes": self.personajes.get(usuario, [])})

    def _leer_jugador(self, usuario: str) -> list[dict]:
        datos = self.almacen.cargar(_archivo_usuario(usuario))
        if datos is None:
            return []
        res, vistos = [], set()
        for p in (datos.get("personajes") if isinstance(datos.get("personajes"), list) else []):
            limpio = self._sanear_personaje(p, usuario)
            if limpio and limpio["id"] not in vistos:
                vistos.add(limpio["id"])
                res.append(limpio)
        return res

    def _sanear_personaje(self, p, usuario: str) -> dict | None:
        """Un personaje leído del disco puede venir del Editor o de un archivo editado a mano: se comprueba todo y lo que
        no encaje con la campaña se corrige o se descarta, para que un dato malo nunca rompa la partida."""
        if not isinstance(p, dict) or not isinstance(p.get("id"), (str, int)) or not str(p.get("nombre") or "").strip():
            return None
        entero = lambda v, d=0: v if isinstance(v, int) and not isinstance(v, bool) else d
        definidas = {e["nombre"]: e for e in self.cfg["juego"]["estadisticas"]}
        el = p.get("elecciones") if isinstance(p.get("elecciones"), dict) else {}
        elecciones = {g: o for g, o in el.items() if g in self.cat.grupos and o in self.cat.opciones and self.cat.opciones[o]["grupo"] == g}
        stats = {}
        base = self.cat.stats_base(elecciones)
        crudo = p.get("stats") if isinstance(p.get("stats"), dict) else {}
        for k, e in definidas.items():
            if k in crudo or k in base:
                stats[k] = max(e["minimo"], min(e["maximo"], entero(crudo.get(k), base.get(k, e["valor_inicial"]))))
        defrec = {r["nombre"]: r for r in self.cfg["juego"]["recursos"]}
        rbase = self.cat.recursos_base(elecciones)
        rcrudo = p.get("recursos") if isinstance(p.get("recursos"), dict) else {}
        recursos = {}
        for k, r in defrec.items():
            if k not in rcrudo and k not in rbase:
                continue
            d = rcrudo.get(k) if isinstance(rcrudo.get(k), dict) else {}
            mx = max(1 if k == self.cat.recurso_vida() else 0, entero(d.get("max"), rbase.get(k, r["maximo_inicial"])))
            recursos[k] = {"actual": max(0, min(mx, entero(d.get("actual"), mx))), "max": mx}
        habilidades = [h for h in (p.get("habilidades") if isinstance(p.get("habilidades"), list) else []) if h in self.cat.habilidades]
        inventario = []
        for e in (p.get("inventario") if isinstance(p.get("inventario"), list) else []):
            if isinstance(e, dict) and e.get("objeto") in self.cat.objetos:
                inventario.append({"objeto": e["objeto"], "cantidad": max(1, entero(e.get("cantidad"), 1)),
                                   **({"equipado": True} if e.get("equipado") is True else {})})
        res = {**p, "id": str(p["id"]), "nombre": str(p["nombre"]).strip()[:30], "dueno": usuario,
                "base": p["base"] if isinstance(p.get("base"), str) else "", "imagen": p["imagen"] if isinstance(p.get("imagen"), str) else "",
                "imagen_biografia": nombre_imagen(p.get("imagen_biografia")),
                **({"imagen_propia": nombre_imagen(p["imagen_propia"])} if isinstance(p.get("imagen_propia"), str) else {}),
                "historia": str(p.get("historia") or "")[:MAX_HISTORIA], "elecciones": elecciones,
                "puntos_pendientes": max(0, entero(p.get("puntos_pendientes"))),
                "nivel": max(1, min(MAX_NIVEL, entero(p.get("nivel"), 1))),
                "propias": normalizar_propias(p.get("propias")),
                "personalidad": [r.strip()[:30] for r in (p.get("personalidad") if isinstance(p.get("personalidad"), list) else []) if isinstance(r, str) and r.strip()][:8],
                "stats": stats, "recursos": recursos, "habilidades": habilidades, "inventario": inventario,
                "dinero": max(0, min(10 ** 9, entero(p.get("dinero"), 0))),
                "sonidos": [n for n in (p.get("sonidos") if isinstance(p.get("sonidos"), list) else []) if isinstance(n, str) and n in self.cat.archivos_sonido("efectos")]}
        res["campos"] = self.campos_limpios(p.get("campos"), {}, True, estricto=False)
        res.pop("companero_de", None)                 # de una versión anterior: ahora un compañero es un personaje más
        return res

    # ── Estado de la partida (estado.yaml) ───────────────────
    def _campos_simples(self) -> dict:
        """Los datos de la partida que se guardan tal cual en estado.yaml: clave → (atributo, validador al cargar).
        El validador devuelve el valor a poner, o SIN_VALOR para dejar el que ya hay. Añadir un dato nuevo (viento, luna…) = una fila aquí
        (más su aviso a los clientes en la vista); ya no hay que acordarse de tocar guardar y cargar por separado."""
        sonido = self.cat.archivos_sonido
        return {
            "musica": ("musica", lambda v: v if isinstance(v, str) and v in sonido("musica") else None),
            "ambiente": ("ambiente", lambda v: [a for a in (v if isinstance(v, list) else []) if isinstance(a, str) and a in sonido("ambiente")]),
            "periodo": ("periodo", lambda v: indice_en(v, len(self.cfg["juego"]["ciclo"]["periodos"]))),
            "clima": ("clima", lambda v: indice_en(v, len(self.cfg["juego"]["clima"]["tipos"]))),
        }

    def guardar_estado(self):
        self.almacen.guardar("estado.yaml", {
            "mapa": self.mapa_principal,
            "salas": {m: {"tokens": list(d["tokens"].values()), "combate": d["combate"],
                          **({"niebla": d["niebla_gm"]} if d["niebla_gm"] is not None else {})}
                      for m, d in self.salas.items() if d["tokens"] or d["niebla_gm"] is not None or d["combate"]["activo"]},
            "salas_cerradas": sorted(self.salas_cerradas),
            "chat": self.chat, "salas_chat": list(self.salas_chat.values()), "tiendas": {"abiertas": self.tiendas_abiertas, "stock": self.stock_tienda}, **{clave: getattr(self, atributo) for clave, (atributo, _) in self._campos_simples().items()},
            "casillas": self.cambios_casillas, "objetos_golpeados": self.objetos_golpeados, "diario": self.diario_vis, "tiradas": self.tiradas_guardadas, "cofres": self.cofres,
        })

    def _casillas_validas(self, crudo) -> dict:
        """Casillas rotas guardadas: solo se conservan las que siguen teniendo sentido con los mapas y tiles actuales."""
        res: dict[str, dict] = {}
        if not isinstance(crudo, dict):
            return res
        for mid, lista in crudo.items():
            m = self.cat.mapas.get(mid)
            if not m or not isinstance(lista, dict):
                continue
            for k, c in lista.items():
                try:
                    x, y = (int(n) for n in str(k).split(","))
                except ValueError:
                    continue
                if not (isinstance(c, dict) and 0 <= x < m["ancho"] and 0 <= y < m["alto"]):
                    continue
                nuevo = {}
                if isinstance(c.get("tile"), str) and (c["tile"] == "" or c["tile"] in self.cat.tiles):
                    nuevo["tile"] = c["tile"]
                if isinstance(c.get("golpes"), int) and c["golpes"] >= 0:
                    nuevo["golpes"] = c["golpes"]
                if nuevo:
                    res.setdefault(mid, {})[f"{x},{y}"] = nuevo
        return res

    def _cargar_sala(self, sd: dict, vistos: set):
        """Tokens, combate y niebla guardados de la sala actual. `vistos`: tokens y personajes ya colocados en otra sala (no se repiten)."""
        for t in sd.get("tokens") or []:
            if not isinstance(t, dict) or "id" not in t or t.get("tipo") not in ("personaje", "enemigo") or t["id"] in vistos:
                continue
            if t["tipo"] == "personaje":
                self.registrar_usuario(t.get("dueno", ""))
                if not self.buscar_personaje(t.get("dueno", ""), t.get("personaje_id", "")):
                    continue
                clave = f"pj:{t.get('dueno')}:{t.get('personaje_id')}"
                if clave in vistos:
                    continue
                vistos.add(clave)
            elif t.get("base") not in self.cat.enemigos:
                continue
            t["revelado"] = [c for c in CAMPOS_REVELABLES if isinstance(t.get("revelado"), list) and c in t["revelado"]]
            if t.get("escala") not in self.ESCALAS or isinstance(t.get("escala"), bool) or t.get("escala") == 1:
                t.pop("escala", None)
            if not (isinstance(t.get("grupo"), str) and 0 < len(t["grupo"]) <= 40):
                t.pop("grupo", None)
            t["estados"] = [e for e in t.get("estados", []) if isinstance(e, dict) and e.get("id") in self.cat.estados]
            m = {k: b for k, b in (t.get("mostrar") or {}).items() if k in ("barras", "nombre") and isinstance(b, bool)} if isinstance(t.get("mostrar"), dict) else {}
            if m:
                t["mostrar"] = m
            else:
                t.pop("mostrar", None)
            if isinstance(t.get("x"), int) and isinstance(t.get("y"), int) and self.casilla_transitable(t["x"], t["y"]):
                self.tokens[t["id"]] = t
                vistos.add(t["id"])
        c = sd.get("combate") or {}
        orden = [i for i in c.get("orden", []) if i in self.tokens] if isinstance(c, dict) else []
        if isinstance(c, dict) and c.get("activo") and len(orden) >= 2:
            mov = c.get("movido") if isinstance(c.get("movido"), dict) else {}
            self.combate = {"activo": True, "orden": orden,
                            "indice": min(int(c.get("indice", 0)), len(orden) - 1),
                            "ronda": int(c.get("ronda", 1)),
                            "movido": {i: n for i, n in mov.items() if i in orden and isinstance(n, int) and not isinstance(n, bool) and n >= 0},
                            "modo": c.get("modo") if c.get("modo") in recursos.MODOS_INICIATIVA else "manual",
                            "valores": {i: v for i, v in (c.get("valores") or {}).items() if i in orden and isinstance(v, (int, float)) and not isinstance(v, bool)}
                            if isinstance(c.get("valores"), dict) else {}}
        if isinstance(sd.get("niebla"), bool):
            self.niebla_gm = sd["niebla"]

    def cargar_estado(self):
        """Restaura la partida guardada. Ignora lo que ya no sea válido."""
        datos = self.almacen.cargar("estado.yaml")
        if datos is None:
            return
        self.cambios_casillas = self._casillas_validas(datos.get("casillas"))
        crudo = datos.get("objetos_golpeados") if isinstance(datos.get("objetos_golpeados"), dict) else {}
        # Solo se conservan los golpes de objetos que siguen existiendo (misma huella) y que se pueden romper.
        self.objetos_golpeados = {}
        for mid, v in crudo.items():
            if mid not in self.cat.mapas or not isinstance(v, dict):
                continue
            validas = {self.huella_objeto(o) for o in self.cat.mapas[mid]["objetos"] if o.get("destruible")}
            limpio = {k: g for k, g in v.items() if k in validas and isinstance(g, int) and not isinstance(g, bool) and g >= -1}
            if limpio:
                self.objetos_golpeados[mid] = limpio
        if "cofres" in datos:                 # lo que el GM dejó (si borró el común, sigue borrado)
            self.cofres = self.cofres_validos(datos.get("cofres"))
        tg = datos.get("tiradas") if isinstance(datos.get("tiradas"), dict) else {}
        for u, lista in tg.items():
            if isinstance(u, str) and isinstance(lista, list):
                ok = [{"nombre": t["nombre"], "expresion": t["expresion"]} for t in lista[:MAX_TIRADAS]
                      if isinstance(t, dict) and isinstance(t.get("nombre"), str) and RE_NOMBRE_TIRADA.fullmatch(t["nombre"])
                      and isinstance(t.get("expresion"), str) and 0 < len(t["expresion"]) <= 100]
                if ok:
                    self.tiradas_guardadas[u] = ok
        dv = datos.get("diario") if isinstance(datos.get("diario"), dict) else {}
        for pid, x in dv.items():
            if pid in self.cat.diario and isinstance(x, dict) and x.get("visible") in ("todos", "oculta"):
                self.diario_vis[pid] = {"visible": x["visible"], "jugadores": [u for u in x.get("jugadores") or [] if isinstance(u, str)][:50]}
        if datos.get("mapa") in self.cat.mapas:
            self.mapa_principal = self.mapa_id = datos["mapa"]
        self.salas_cerradas = {m for m in (datos.get("salas_cerradas") or []) if isinstance(m, str) and m in self.cat.mapas}
        crudas = datos.get("salas") if isinstance(datos.get("salas"), dict) else None
        if crudas is None:            # partida guardada antes de las salas: un solo mapa con sus tokens, su combate y su niebla
            crudas = {self.mapa_principal: {"tokens": datos.get("tokens", []), "combate": datos.get("combate"),
                                            "niebla": datos.get("niebla")}}
        vistos: set[str] = set()
        for mid, sd in crudas.items():
            if mid not in self.cat.mapas or not isinstance(sd, dict):
                continue
            with self.en_sala(mid):
                self._cargar_sala(sd, vistos)
        self.usar_sala(self.mapa_principal)
        td = datos.get("tiendas") if isinstance(datos.get("tiendas"), dict) else {}
        self.tiendas_abiertas = [i for i in (td.get("abiertas") or []) if isinstance(i, str) and i in self.cat.tiendas]
        st = td.get("stock") if isinstance(td.get("stock"), dict) else {}
        self.stock_tienda = {i: {o: n for o, n in v.items() if isinstance(o, str) and isinstance(n, int) and not isinstance(n, bool) and n >= 0}
                             for i, v in st.items() if i in self.cat.tiendas and isinstance(v, dict)}
        for sd in datos.get("salas_chat") or []:
            try:
                if isinstance(sd, dict) and isinstance(sd.get("id"), str):
                    self.salas_chat[sd["id"]] = {"id": sd["id"], "nombre": self._nombre_sala(sd.get("nombre"), excepto=sd["id"]),
                                                 "miembros": self._miembros_validos(sd.get("miembros") or [])}
            except ErrorJuego:
                continue
        self.chat = [m for m in datos.get("chat", []) if isinstance(m, dict) and m.get("sala", "general") in ("general", *self.salas_chat)
                     and (not m.get("mapa") or m["mapa"] in self.cat.mapas)][-self.cfg["juego"]["max_mensajes_chat"]:]
        for clave, (atributo, validar) in self._campos_simples().items():
            valor = validar(datos.get(clave))
            if valor is not SIN_VALOR:
                setattr(self, atributo, valor)
