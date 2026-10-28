"""
simulador.py — «Probar» una habilidad desde el Editor con las reglas reales del servidor, sin abrir una partida.

Se carga la campaña (con el borrador que el Editor aún no ha guardado, si lo hay), se colocan un atacante y un objetivo
uno junto al otro y se usa la habilidad varias veces. Cada prueba empieza de cero (vida llena), con dados distintos.
Todo ocurre en una carpeta temporal: nada de la partida real se toca.
"""
from __future__ import annotations

import random
import shutil
import tempfile
from pathlib import Path

import yaml

from . import recursos
from .errores import ErrorJuego
from .estado import EstadoPartida

MAX_VECES = 200
MAX_DISTANCIA = 30
USUARIO = "Prueba"


def _cargar(ruta: Path, borrador: dict | None, tmp: Path):
    """Copia la campaña a `tmp` (solo los YAML) y aplica el borrador sin guardar del Editor."""
    destino = tmp / "campana"
    shutil.copytree(ruta, destino, ignore=lambda d, nombres: [n for n in nombres if n.startswith("_") or (Path(d, n).is_file() and not n.endswith(".yaml"))])
    if isinstance(borrador, dict) and borrador.get("cat") in recursos.CATEGORIAS and isinstance(borrador.get("id"), str):
        rid = borrador["id"]
        if rid.replace("_", "").isalnum() and len(rid) <= 60 and isinstance(borrador.get("datos"), dict):
            carpeta = destino / recursos.CATEGORIAS[borrador["cat"]]
            carpeta.mkdir(exist_ok=True)
            (carpeta / f"{rid}.yaml").write_text(yaml.safe_dump(borrador["datos"], allow_unicode=True), encoding="utf-8")
    elif isinstance(borrador, dict) and borrador.get("cat") == "config" and isinstance(borrador.get("datos"), dict):
        (destino / "config.yaml").write_text(yaml.safe_dump(borrador["datos"], allow_unicode=True), encoding="utf-8")
    return recursos.cargar(destino)


def _poner(e: EstadoPartida, quien: dict, x: int, y: int, nombre: str) -> dict:
    """Coloca al atacante o al objetivo: un NPC de la campaña o un personaje de prueba con las opciones elegidas."""
    if not isinstance(quien, dict):
        raise ErrorJuego("Elige quién participa")
    if quien.get("tipo") == "npc":
        t = e.colocar_enemigo(str(quien.get("id")), x, y)
    else:
        el = dict(quien.get("elecciones")) if isinstance(quien.get("elecciones"), dict) else {}
        el = {g: o for g, o in el.items() if o}
        if e.cfg["juego"]["usar_grupos"]:
            for _ in range(5):                      # los grupos obligatorios sin elegir toman su primera opción (también los que dependen de otros)
                for g, gd in e.cat.grupos.items():
                    ops = e.cat.opciones_de(g)
                    if gd["obligatorio"] and g not in el and ops and e.grupo_activo(g, el):
                        el[g] = ops[0]
        p = e.crear_personaje(USUARIO, True, None, nombre, elecciones=el)
        t, _ = e.desplegar_personaje(USUARIO, p["id"], USUARIO, True, x, y)
    for est in (quien.get("estados") or [])[:10]:
        if est in e.cat.estados:
            t.setdefault("estados", []).append({"id": est, "turnos": e.cat.estados[est]["duracion"]})
    return t


def _sitio(e: EstadoPartida, distancia: int = 1) -> tuple[tuple[int, int], tuple[int, int]]:
    """Dos casillas libres en línea recta, a `distancia` casillas (sin muros entre ellas), para el atacante y el objetivo."""
    m = e.mapa
    for y in range(m["alto"]):
        for x in range(m["ancho"]):
            for dx, dy in ((1, 0), (0, 1)):
                if all(e.casilla_transitable(x + k * dx, y + k * dy) for k in range(distancia + 1)):
                    return (x, y), (x + distancia * dx, y + distancia * dy)
    if distancia > 1:
        raise ErrorJuego(f"El mapa no tiene {distancia + 1} casillas libres seguidas para probar a esa distancia")
    raise ErrorJuego("El mapa no tiene dos casillas libres juntas para la prueba")


def simular(ruta_campana, peticion: dict) -> dict:
    if not isinstance(peticion, dict):
        return {"ok": False, "errores": ["Petición no válida"]}
    with tempfile.TemporaryDirectory(prefix="mesa-sim-") as d:
        tmp = Path(d)
        cat, inf = _cargar(Path(ruta_campana), peticion.get("borrador"), tmp)
        if not inf.ok:
            return {"ok": False, "errores": inf.errores[:10]}
        hab = peticion.get("habilidad")
        if hab not in cat.habilidades:
            return {"ok": False, "errores": ["Esa habilidad no existe (¿le falta el nombre o la fórmula?)"]}
        veces = peticion.get("veces", 1)
        veces = veces if isinstance(veces, int) and not isinstance(veces, bool) and 1 <= veces <= MAX_VECES else 1
        dist = peticion.get("distancia", 1)
        dist = dist if isinstance(dist, int) and not isinstance(dist, bool) and 1 <= dist <= MAX_DISTANCIA else 1
        semilla = peticion.get("semilla") if isinstance(peticion.get("semilla"), int) else random.randrange(1 << 30)
        pruebas, cambios, fallos = [], [], []
        info = {}
        for i in range(veces):
            e = EstadoPartida(cat, tmp / f"datos{i}", rng=random.Random(semilla + i), persistir=False)
            try:
                a_pos, o_pos = _sitio(e, dist)
                at = _poner(e, peticion.get("atacante"), *a_pos, "Atacante")
                if hab not in e.datos_de(at)["habilidades"]:
                    e.datos_de(at)["habilidades"].append(hab)        # se prueba aunque el atacante no la tenga
                obj = at if cat.habilidades[hab]["objetivo"] == "uno_mismo" else _poner(e, peticion.get("objetivo"), *o_pos, "Objetivo")
                vida = cat.recurso_vida()
                antes = e.datos_de(obj)["recursos"][vida]["actual"]
                texto, _ = e.usar_habilidad(at["id"], hab, None if obj is at else obj["id"], "GM", True)
                despues = e.datos_de(obj)["recursos"][vida]["actual"]
                chat, _ = e.vaciar_colas()
                cambios.append(despues - antes)
                if not info:
                    info = {"atacante": e.nombre_de(at), "objetivo": e.nombre_de(obj), "vida": vida, "vida_max": e.datos_de(obj)["recursos"][vida]["max"]}
                if len(pruebas) < 10:
                    pruebas.append({"texto": texto, "extra": [c[0] for c in chat][:8], "cambio": despues - antes,
                                    "estados": [x["id"] for x in obj.get("estados", [])]})
            except ErrorJuego as ex:
                fallos.append(str(ex))
        res = {"ok": True, "veces": veces, "pruebas": pruebas, "fallos": sorted(set(fallos))[:5], "n_fallos": len(fallos), **info}
        if cambios:
            res["resumen"] = {"min": min(cambios), "max": max(cambios), "media": round(sum(cambios) / len(cambios), 1)}
        return res
