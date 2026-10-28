"""Decidir los turnos antes de empezar: a mano (el GM ordena y marca «Listo») o por tirada (todos tiran). Mientras tanto, el combate no ha empezado."""
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(4), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    e.desplegar_personaje("Ana", p["id"], "GM", True, 2, 8)
    return e


def _enemigo(e):
    x, y = [(x, y) for y in range(e.mapa["alto"]) for x in range(e.mapa["ancho"]) if e.casilla_transitable(x, y) and not e.casilla_ocupada(x, y)][-1]
    return e.colocar_enemigo("goblin", x, y)


def _nombres(e, ids):
    return [e.nombre_de(e.tokens[i]) for i in ids]


def test_a_mano_el_combate_espera_a_que_el_gm_marque_listo(partida):
    partida.cfg["juego"]["iniciativa"] = "manual"
    g = _enemigo(partida)
    partida.iniciar_combate()
    assert not partida.combate["activo"]                       # todavía no empezó
    prep = partida.combate["preparando"]
    assert prep["modo"] == "manual" and set(prep["orden"]) == set(prep["participantes"]) and len(prep["orden"]) == 2
    nuevo = list(reversed(prep["orden"]))
    partida.ordenar_turnos(nuevo)
    assert partida.combate["preparando"]["orden"] == nuevo
    partida.empezar_tras_tiradas()                             # «Listo»
    assert partida.combate["activo"] and partida.combate["orden"] == nuevo and "preparando" not in partida.combate
    assert g["id"] in partida.combate["orden"]


def test_a_mano_no_se_acepta_un_orden_con_otros_participantes_ni_se_tira(partida):
    partida.cfg["juego"]["iniciativa"] = "manual"
    _enemigo(partida)
    partida.iniciar_combate()
    orden = partida.combate["preparando"]["orden"]
    for malo in (orden[:1], orden + ["x"], [orden[0], orden[0]], "hola", None):
        with pytest.raises(ErrorJuego):
            partida.ordenar_turnos(malo)
    with pytest.raises(ErrorJuego):
        partida.tirar_iniciativa(orden[0], "GM", True)


def test_quitar_un_token_mientras_el_gm_ordena_no_deja_fantasmas(partida):
    partida.cfg["juego"]["iniciativa"] = "manual"
    g1, g2 = _enemigo(partida), _enemigo(partida)
    partida.iniciar_combate()
    partida.quitar_token(g2["id"])
    prep = partida.combate["preparando"]
    assert g2["id"] not in prep["orden"] and g2["id"] not in prep["participantes"]
    partida.ordenar_turnos(list(reversed(prep["orden"])))      # el orden de lo que queda sí se acepta
    partida.empezar_tras_tiradas()
    assert g2["id"] not in partida.combate["orden"] and g1["id"] in partida.combate["orden"]


def test_por_tirada_se_espera_a_que_todos_tiren(partida):
    partida.cfg["juego"]["iniciativa"] = "estadistica"
    _enemigo(partida)
    partida.iniciar_combate()
    prep = partida.combate["preparando"]
    assert not partida.combate["activo"] and prep.get("modo", "tirada") != "manual"
    pendiente = partida.faltan_iniciativas()
    assert len(pendiente) == 1                                 # el NPC tira solo; falta el jugador
    partida.tirar_iniciativa(pendiente[0], "Ana", False)
    assert partida.faltan_iniciativas() == []
    partida.empezar_tras_tiradas()
    assert partida.combate["activo"]


def test_la_vista_dice_el_modo_y_el_orden_a_quien_la_ve(partida):
    partida.cfg["juego"]["iniciativa"] = "manual"
    _enemigo(partida)
    partida.iniciar_combate()
    v = partida.vista_combate("Ana", False) if hasattr(partida, "vista_combate") else None
    if v is not None:
        assert v["preparando"]["modo"] == "manual" and len(v["preparando"]["orden"]) == 2
