"""objetos.py — Objetos del inventario: equipar, usar y dar.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from .errores import ErrorJuego


class ObjetosMixin:
    def equipar(self, token_id: str, objeto_id, poner: bool, usuario: str, es_gm: bool) -> str:
        """Equipa o quita un objeto (si la campaña usa equipamiento). Un hueco ocupado se libera solo: se cambia una cosa por otra."""
        eq = self.cfg["juego"].get("equipamiento") or {}
        if not eq.get("activo"):
            raise ErrorJuego("Esta campaña no usa equipamiento")
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        datos = self.datos_de(t)
        entrada = next((e for e in datos["inventario"] if e["objeto"] == objeto_id), None) if isinstance(objeto_id, str) else None
        if not entrada:
            raise ErrorJuego("No tienes ese objeto")
        obj = self.cat.objetos[objeto_id]
        if not obj.get("equipable"):
            raise ErrorJuego("Ese objeto no se puede equipar")
        if not poner:
            entrada.pop("equipado", None)
            self._guardar_afectados(t)
            return f"{datos['nombre']} se quita {obj['nombre']}."
        if entrada.get("equipado"):
            return f"{datos['nombre']} ya lleva {obj['nombre']}."
        quitados = []
        if obj.get("hueco"):
            for e in datos["inventario"]:
                o = self.cat.objetos.get(e["objeto"]) or {}
                if e.get("equipado") and o.get("hueco") == obj["hueco"]:
                    e.pop("equipado", None)
                    quitados.append(o["nombre"])
        puestos = sum(1 for e in datos["inventario"] if e.get("equipado"))
        if eq.get("maximo") and puestos >= eq["maximo"]:
            for e in datos["inventario"]:          # deshace el cambio de hueco si al final no cabe
                if (self.cat.objetos.get(e["objeto"]) or {}).get("nombre") in quitados:
                    e["equipado"] = True
            raise ErrorJuego(f"Solo se pueden llevar {eq['maximo']} objetos equipados: quítate otro antes")
        entrada["equipado"] = True
        self._guardar_afectados(t)
        return f"{datos['nombre']} se equipa {obj['nombre']}" + (f" (se quita {', '.join(quitados)})." if quitados else ".")

    def _token_cercano(self, origen: dict, otro_id, usuario: str, es_gm: bool, para: str) -> dict:
        """Otro token de la sala al que `origen` le hace algo con un objeto (usarlo con él, dárselo): tiene que verlo y estar
        a `permisos.alcance_objetos` casillas como mucho (el GM no tiene límite de distancia)."""
        otro = self.tokens.get(otro_id) if isinstance(otro_id, str) else None
        if not otro or not self.puede_ver(otro, usuario, es_gm):
            raise ErrorJuego("Ese token no está en esta sala")
        alcance = self.cfg["permisos"]["alcance_objetos"]
        if not es_gm and self.distancia(origen, otro) > alcance:
            casillas = "casilla" if alcance == 1 else "casillas"
            raise ErrorJuego(f"{self.nombre_de(otro)} está demasiado lejos para {para} (como mucho a {alcance} {casillas})")
        return otro

    def usar_objeto(self, token_id: str, objeto_id: str, usuario: str, es_gm: bool, objetivo_id: str | None = None) -> tuple[str, list[str]]:
        """Usa un objeto del inventario de `token_id`: sobre sí mismo o, con `objetivo_id`, sobre otro token cercano (una poción a un
        aliado). Lo que hace el objeto (su recurso y sus efectos «Al usarlo») le pasa a quien lo recibe; se gasta del que lo lleva."""
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        self._comprobar_turno(t, es_gm)
        impide = self.impedido(t, "objetos")
        if impide:
            raise ErrorJuego(f"«{impide}» no le deja usar objetos")
        datos = self.datos_de(t)
        entrada = next((e for e in datos["inventario"] if e["objeto"] == objeto_id), None)
        if not entrada:
            raise ErrorJuego("No tienes ese objeto")
        obj = self.cat.objetos[objeto_id]
        al_usar = [e for e in obj.get("efectos", []) if e["cuando"]["tipo"] == "al_usar"]
        if not obj["efecto"] and not al_usar:
            raise ErrorJuego(f"«{obj['nombre']}» no se puede usar")
        dest = t if objetivo_id in (None, "", token_id) else self._token_cercano(t, objetivo_id, usuario, es_gm, f"usar {obj['nombre']} con él")
        self.intentar(t, {"objeto"}, dest if dest is not t else None)
        dd = self.datos_de(dest)
        ef = obj["efecto"]
        texto = f"🧪 {datos['nombre']} usó {obj['nombre']}" + (f" con {dd['nombre']}" if dest is not t else "")
        if ef:
            if ef["recurso"] not in dd["recursos"]:
                if not al_usar:
                    quien = "Este personaje" if dest is t else dd["nombre"]
                    raise ErrorJuego(f"{quien} no tiene «{ef['recurso']}», así que «{obj['nombre']}» no le sirve")
            else:
                r = dd["recursos"][ef["recurso"]]
                antes = r["actual"]
                r["actual"] = min(r["max"], antes + ef["valor"])
                self.cambio_de_recurso(dest, ef["recurso"], antes, r["actual"])
                texto += f": {ef['recurso']} {antes} → {r['actual']}"
        for e in al_usar:              # «Al usarlo»: quitar estados, aplicar otros, sumar experiencia… (con sus condiciones), en quien lo recibe
            if self.cumple(e, dest):
                self.aplicar_accion(obj["nombre"], dest, None, e["hacer"])
        if obj["tipo"] == "consumible":
            entrada["cantidad"] -= 1
            if entrada["cantidad"] <= 0:
                datos["inventario"].remove(entrada)
        self._guardar_afectados(t, *([dest] if dest is not t else []))
        return texto, [t["id"]] + ([dest["id"]] if dest is not t else [])

    def dar_objeto(self, token_id: str, a_id: str, objeto_id: str, cantidad, usuario: str, es_gm: bool) -> tuple[str, list[str]]:
        """Pasa `cantidad` unidades de un objeto del inventario de un token propio al de otro token cercano de la sala.
        Si estaba equipado y se dan todas, deja de estarlo. En combate (con «solo en su turno») solo en el turno de quien da."""
        if not es_gm and not self.cfg["permisos"]["dar_objetos"]:
            raise ErrorJuego("En esta mesa no se pueden dar objetos")
        t = self._token(token_id)
        if not self.puede_controlar(t, usuario, es_gm):
            raise ErrorJuego("No puedes actuar con ese token")
        if a_id == token_id:
            raise ErrorJuego("No puedes darte un objeto a ti mismo")
        if isinstance(cantidad, bool) or not isinstance(cantidad, int) or not 1 <= cantidad <= 999:
            raise ErrorJuego("La cantidad debe ser un entero entre 1 y 999")
        self._comprobar_turno(t, es_gm)
        datos = self.datos_de(t)
        entrada = next((e for e in datos["inventario"] if e["objeto"] == objeto_id), None) if isinstance(objeto_id, str) else None
        if not entrada:
            raise ErrorJuego("No tienes ese objeto")
        if cantidad > entrada["cantidad"]:
            raise ErrorJuego(f"Solo tienes {entrada['cantidad']}")
        obj = self.cat.objetos[objeto_id]
        dest = self._token_cercano(t, a_id, usuario, es_gm, "darle algo")
        dd = self.datos_de(dest)
        entrada["cantidad"] -= cantidad
        if entrada["cantidad"] <= 0:
            datos["inventario"].remove(entrada)
        suya = next((e for e in dd["inventario"] if e["objeto"] == objeto_id), None)
        if suya:
            suya["cantidad"] += cantidad
        else:
            dd["inventario"].append({"objeto": objeto_id, "cantidad": cantidad})
        self._guardar_afectados(t, dest)
        return f"🎁 {datos['nombre']} dio {cantidad} × {obj['nombre']} a {dd['nombre']}.", [t["id"], dest["id"]]
