"""diario.py — Diario: páginas que el GM revela u oculta en plena partida.

Parte de `EstadoPartida` (ver estado.py): comparte `self` con las demás partes."""

from __future__ import annotations

from .errores import ErrorJuego


class DiarioMixin:
    def visibilidad_pagina(self, pid: str) -> dict:
        p = self.cat.diario[pid]
        return self.diario_vis.get(pid) or {"visible": p["visible"], "jugadores": list(p["jugadores"])}

    def ve_pagina(self, pid: str, usuario: str, es_gm: bool) -> bool:
        if es_gm:
            return True
        v = self.visibilidad_pagina(pid)
        return v["visible"] == "todos" or usuario in v["jugadores"]

    def paginas_para(self, usuario: str, es_gm: bool) -> list[dict]:
        """Las páginas del diario que puede leer este usuario (el GM las ve todas, con su visibilidad)."""
        res = []
        for pid, p in self.cat.diario.items():
            if not self.ve_pagina(pid, usuario, es_gm):
                continue
            d = {"id": pid, "nombre": p["nombre"], "seccion": p["seccion"], "texto": p["texto"], "imagen": p["imagen"]}
            if es_gm:
                d.update(self.visibilidad_pagina(pid))
            res.append(d)
        return res

    def fijar_visibilidad_pagina(self, pid, visible, jugadores) -> str:
        """El GM revela u oculta una página en plena partida: «todos», «oculta» (y, si está oculta, la pueden ver algunos jugadores)."""
        if pid not in self.cat.diario:
            raise ErrorJuego("Esa página no existe")
        if visible not in ("todos", "oculta"):
            raise ErrorJuego("Visibilidad no válida")
        if not isinstance(jugadores, list) or len(jugadores) > 50 or not all(isinstance(u, str) and 0 < len(u) <= 40 for u in jugadores):
            raise ErrorJuego("Lista de jugadores no válida")
        self.diario_vis[pid] = {"visible": visible, "jugadores": list(dict.fromkeys(jugadores)) if visible == "oculta" else []}
        self.guardar_estado()
        return self.cat.diario[pid]["nombre"]
