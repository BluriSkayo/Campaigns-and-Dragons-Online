"""NPC controlados por jugadores («Controlado por»): apagado por defecto; el GM los da al editar el token."""
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(2), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    e.desplegar_personaje("Ana", p["id"], "GM", True, 2, 8)
    libres = [(x, y) for y in range(e.mapa["alto"]) for x in range(e.mapa["ancho"]) if e.casilla_transitable(x, y) and not e.casilla_ocupada(x, y)]
    e.npc = e.colocar_enemigo("goblin", *libres[-1])
    return e


def test_apagado_por_defecto_no_se_puede_dar(partida):
    assert partida.cfg["permisos"]["npc_para_jugadores"] is False
    with pytest.raises(ErrorJuego):
        partida.editar_token(partida.npc["id"], controlado_por="Ana", usuarios_validos={"Ana"})
    assert not partida.puede_controlar(partida.npc, "Ana", False)


def test_el_gm_da_un_npc_y_el_jugador_lo_controla(partida):
    partida.cfg["permisos"]["npc_para_jugadores"] = True
    g = partida.npc
    assert "controlado por" in partida.editar_token(g["id"], controlado_por="Ana", usuarios_validos={"Ana"})
    assert partida.puede_controlar(g, "Ana", False) and not partida.puede_controlar(g, "Luis", False)
    v = partida.vista_token(g, "Ana", False)
    assert v["controlado_por"] == "Ana" and "stats" in v                  # ve su ficha completa
    assert partida.puede_ver(g, "Ana", False)
    partida.editar_token(g["id"], controlado_por=None, usuarios_validos={"Ana"})
    assert not partida.puede_controlar(g, "Ana", False) and "controlado_por" not in g


def test_valida_jugador_y_tipo(partida):
    partida.cfg["permisos"]["npc_para_jugadores"] = True
    with pytest.raises(ErrorJuego):
        partida.editar_token(partida.npc["id"], controlado_por="Nadie", usuarios_validos={"Ana"})
    pj = next(t for t in partida.tokens.values() if t["tipo"] == "personaje")
    with pytest.raises(ErrorJuego):
        partida.editar_token(pj["id"], controlado_por="Ana", usuarios_validos={"Ana"})


def test_al_apagarlo_se_pierde_el_control_pero_se_recuerda(partida):
    partida.cfg["permisos"]["npc_para_jugadores"] = True
    partida.editar_token(partida.npc["id"], controlado_por="Ana", usuarios_validos={"Ana"})
    partida.cfg["permisos"]["npc_para_jugadores"] = False
    assert not partida.puede_controlar(partida.npc, "Ana", False)
    assert "controlado_por" not in partida.vista_token(partida.npc, "GM", True)
    partida.cfg["permisos"]["npc_para_jugadores"] = True
    assert partida.puede_controlar(partida.npc, "Ana", False)
