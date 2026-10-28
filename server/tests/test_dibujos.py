"""Dibujos temporales: grosor del lápiz y borrador que quita solo el trozo tocado."""
import asyncio
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida, recortar_trazo
from tests.test_servidor import _gm_y_ana, mundo  # noqa: F401  (fixture)


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=False)


# ── Geometría ──
def test_recorte_no_toca_nada():
    assert recortar_trazo([[0, 0], [10, 0]], 5, 5, 1) is None
    assert recortar_trazo([[0, 1], [10, 1]], 5, 0, 1) is None          # solo roza el borde
    assert recortar_trazo([[2, 2]], 9, 9, 0.5) is None


def test_recorte_en_medio_deja_dos_trozos_aunque_no_haya_puntos_dentro():
    assert recortar_trazo([[0, 0], [10, 0]], 5, 0, 1) == [[[0, 0], [4, 0]], [[6, 0], [10, 0]]]


def test_recorte_en_un_extremo_y_total():
    assert recortar_trazo([[0, 0], [10, 0]], 0, 0, 2) == [[[2, 0], [10, 0]]]
    assert recortar_trazo([[0, 0], [1, 0]], 0.5, 0, 3) == []
    assert recortar_trazo([[2, 2]], 2, 2, 0.5) == []


def test_recorte_en_una_curva():
    trozos = recortar_trazo([[0, 0], [5, 5], [10, 0]], 5, 5, 1)
    assert len(trozos) == 2 and trozos[0][0] == [0, 0] and trozos[1][-1] == [10, 0]


# ── Estado ──
def test_el_grosor_se_limita(partida):
    assert partida.anadir_dibujo("Ana", False, None, [[1, 1], [2, 2]], 12)["grosor"] == 12
    assert partida.anadir_dibujo("Ana", False, None, [[1, 1], [2, 2]])["grosor"] == 4          # sin grosor: el de siempre
    assert partida.anadir_dibujo("Ana", False, None, [[1, 1], [2, 2]], 9999)["grosor"] == 24
    assert partida.anadir_dibujo("Ana", False, None, [[1, 1], [2, 2]], 0)["grosor"] == 1
    for raro in ("grueso", True, None, float("nan"), [3]):
        assert partida.anadir_dibujo("Ana", False, None, [[1, 1], [2, 2]], raro)["grosor"] == 4


def test_borrador_quita_solo_lo_tocado_y_conserva_color_y_grosor(partida):
    d = partida.anadir_dibujo("Ana", False, "#c4533f", [[1, 2], [9, 2]], 10)
    borrados, nuevos = partida.borrar_zona("Ana", False, [[5, 2]], 0.5)
    assert borrados == [d["id"]] and len(nuevos) == 2
    assert all(n["usuario"] == "Ana" and n["color"] == "#c4533f" and n["grosor"] == 10 and n["id"] != d["id"] for n in nuevos)
    assert partida.dibujos == nuevos


def test_borrador_con_recorrido_largo_borra_todo_el_trazo(partida):
    partida.anadir_dibujo("Ana", False, None, [[1, 2], [9, 2]])
    borrados, nuevos = partida.borrar_zona("Ana", False, [[x / 2, 2] for x in range(0, 24)], 0.5)
    assert len(borrados) == 1 and nuevos == [] and partida.dibujos == []


def test_un_jugador_solo_borra_lo_suyo_y_el_gm_todo(partida):
    partida.anadir_dibujo("Ana", False, None, [[1, 2], [9, 2]])
    g = partida.anadir_dibujo("GM", True, None, [[1, 2], [9, 2]])
    borrados, nuevos = partida.borrar_zona("Ana", False, [[5, 2]], 0.5)
    assert g["id"] not in borrados and any(d["id"] == g["id"] for d in partida.dibujos)
    borrados, _ = partida.borrar_zona("GM", True, [[5, 2]], 0.5)
    assert g["id"] in borrados


def test_borrador_rechaza_datos_raros(partida):
    for radio in (0, 0.01, 99, True, "x", None, float("nan")):
        with pytest.raises(ErrorJuego):
            partida.borrar_zona("GM", True, [[1, 1]], radio)
    for centros in ([], "hola", [[1]], [[1, 2, 3]], [[1, 1]] * 500, [[999, 999]]):
        with pytest.raises(ErrorJuego):
            partida.borrar_zona("GM", True, centros, 1)


# ── Por la red ──
async def test_borrador_por_la_red(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await ana.enviar(tipo="dibujar", color="#c4533f", grosor=10, puntos=[[1, 2], [9, 2]])
    d = (await gm.recibir("dibujo"))["dibujo"]
    assert d["grosor"] == 10
    await ana.enviar(tipo="borrar_zona", centros=[[5, 2]], radio=0.5)
    assert (await gm.recibir("dibujos_borrados"))["ids"] == [d["id"]]
    a, b = (await gm.recibir("dibujo"))["dibujo"], (await gm.recibir("dibujo"))["dibujo"]
    assert a["grosor"] == b["grosor"] == 10 and len(estado.dibujos) == 2
    await gm.enviar(tipo="dibujar", puntos=[[1, 6], [9, 6]])
    await asyncio.sleep(0.1)
    await ana.enviar(tipo="borrar_zona", centros=[[5, 6]], radio=0.5)        # no es suyo: no pasa nada
    await ana.enviar(tipo="borrar_zona", centros=[[5, 6]], radio=50)
    assert "no válido" in (await ana.recibir("error"))["texto"]
    assert len(estado.dibujos) == 3


def test_borrador_respeta_el_tope_sin_anunciar_trazos_perdidos(tmp_path, catalogo):
    from mesa import estado as mod
    e = mod.EstadoPartida(catalogo, tmp_path, persistir=False)
    zigzag = [[x * 0.5, 1 if x % 2 else 0] for x in range(40)]
    for _ in range(mod.MAX_TRAZOS):
        e.anadir_dibujo("GM", True, None, zigzag)
    borrados, nuevos = e.borrar_zona("GM", True, [[x * 0.5, 0.5] for x in range(0, 40, 4)], 0.3)
    ids = {d["id"] for d in e.dibujos}
    assert len(e.dibujos) <= mod.MAX_TRAZOS and all(d["id"] in ids for d in nuevos)
