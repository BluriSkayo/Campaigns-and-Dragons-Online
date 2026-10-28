"""Manda datos absurdos a TODAS las acciones del servidor: ninguna puede acabar en «Error interno» (un fallo sin controlar)."""
import asyncio
import itertools

from tests.test_servidor import _gm_y_ana, mundo  # noqa: F401

RAROS = [None, True, -1, 0, 10 ** 12, 1.5, "", "x" * 3000, "../../etc/passwd", [], [1, 2, 3], {}, {"a": 1}, [None], [[1, 2]], ["a"], [{"nombre": None}]]
CAMPOS = ["token", "personaje", "x", "y", "texto", "sala", "archivo", "objeto", "tienda", "cantidad", "con", "items", "dinero", "acepto", "puntos",
          "color", "ids", "campos", "usuario", "nombre", "miembros", "indice", "capa", "visible", "activa", "que", "lista", "rasgos", "habilidad",
          "objetivo", "enemigo", "mapa", "estadistica", "expresion", "reparto", "sonidos", "abierta", "reponer", "montos", "estados", "stats", "recursos"]


async def test_ninguna_accion_falla_sin_controlar(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    estado.cfg["juego"]["niebla"]["activa"] = True
    acciones = [a for a in srv.acciones if a not in ("gm_cambiar_mapa",)]
    fallos = []
    for cli, nombre in ((gm, "gm"), (ana, "ana")):
        for accion in acciones:
            variantes = [{}]
            for campo, raro in itertools.product(CAMPOS, RAROS[::2]):
                variantes.append({campo: raro, "token": tid} if campo != "token" else {"token": raro})
            variantes += [{c: r for c in CAMPOS} for r in RAROS]
            for extra in variantes:
                await cli.enviar(tipo=accion, **extra)
            # drenar: cualquier «Error interno» es un fallo
        await asyncio.sleep(0.2)
        while True:
            try:
                m = await cli.recibir(timeout=0.3)
            except (asyncio.TimeoutError, TimeoutError):
                break
            if m["tipo"] == "error" and "interno" in m["texto"]:
                fallos.append(nombre)
    assert not fallos, f"{len(fallos)} acciones acabaron en «Error interno del servidor» (mira el registro)"
