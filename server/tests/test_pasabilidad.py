"""Pasabilidad por lados (vallas, mostradores…) y que los jugadores no atraviesen muros al mover su token."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


def test_validacion(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.tiles["valla"]["bloquea_lados"] == ["norte"] and cat.tiles["muro"]["bloquea_lados"] == []
    (d / "tiles" / "rara.yaml").write_text(yaml.safe_dump({"nombre": "Rara", "bloquea_lados": ["arriba"]}), encoding="utf-8")
    assert any("no es un lado" in e for e in recursos.cargar(d)[1].errores)


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=False)
    for y in range(e.mapa["alto"]):                 # mapa limpio, sin muros, para poder razonar
        for x in range(e.mapa["ancho"]):
            e._celdas[y][x] = "hierba"
    e._bloqueadas = set()
    return e


def test_vallas_y_muros(partida):
    e = partida
    e._celdas[5][5] = "valla"                          # valla al norte de (5, 5)
    assert not e.puede_pasar(5, 5, "norte") and not e.puede_pasar(5, 4, "sur")
    assert e.puede_pasar(5, 5, "este") and e.puede_pasar(5, 4, "este") and e.puede_pasar(6, 5, "oeste")
    assert e.hay_camino((5, 4), (5, 5))               # rodeando la valla sí se llega
    for x in range(e.mapa["ancho"]):                  # una fila entera de muro: se corta el mapa en dos
        e._celdas[8][x] = "muro"
    assert not e.hay_camino((1, 1), (1, 10)) and e.hay_camino((1, 1), (12, 7))


def test_el_jugador_no_atraviesa_el_gm_si(partida):
    e = partida
    for x in range(e.mapa["ancho"]):
        e._celdas[8][x] = "muro"
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    t, _ = e.desplegar_personaje("Ana", p["id"], "Ana", False, 2, 2)
    with pytest.raises(ErrorJuego, match="No hay camino"):
        e.mover_token(t["id"], 2, 10, "Ana", False)
    e.mover_token(t["id"], 6, 6, "Ana", False)          # lejos pero con camino: sí
    e.mover_token(t["id"], 2, 10, "GM", True)           # el GM lo coloca donde quiera
    assert (t["x"], t["y"]) == (2, 10)
