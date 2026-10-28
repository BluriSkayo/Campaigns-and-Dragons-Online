"""«Los jugadores pueden entrar sin ficha» (permisos.sin_ficha, apagado por defecto): el GM asigna personajes («Pertenece a»)
y NPC («Controlado por») a los usuarios."""
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from mesa.permisos import permisos_de


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(3), persistir=False)
    e.registrar_usuario("GM")
    p = e.crear_personaje("GM", True, "guerrero", "Thor")          # el GM prepara el personaje
    e.pj, _ = e.desplegar_personaje("GM", p["id"], "GM", True, 2, 8)
    libres = [(x, y) for y in range(e.mapa["alto"]) for x in range(e.mapa["ancho"]) if e.casilla_transitable(x, y) and not e.casilla_ocupada(x, y)]
    e.npc = e.colocar_enemigo("goblin", *libres[-1])
    return e


def test_apagado_por_defecto(partida):
    assert partida.cfg["permisos"]["sin_ficha"] is False
    assert permisos_de(partida.cfg, False)["sin_ficha"] is False
    with pytest.raises(ErrorJuego, match="sin ficha"):
        partida.editar_token(partida.pj["id"], dueno="Ana", usuarios_dueno={"Ana", "GM"})
    assert partida.pj["dueno"] == "GM"


def test_el_gm_da_un_personaje_a_un_usuario(partida):
    partida.cfg["permisos"]["sin_ficha"] = True
    pid = partida.pj["personaje_id"]
    assert "ahora es de Ana" in partida.editar_token(partida.pj["id"], dueno="ana", usuarios_dueno={"Ana", "GM"})   # sin distinguir mayúsculas
    assert partida.pj["dueno"] == "Ana"
    assert [p["nombre"] for p in partida.personajes_de("Ana")] == ["Thor"]
    assert partida.personajes_de("GM") == []
    assert partida.puede_controlar(partida.pj, "Ana", False) and not partida.puede_controlar(partida.pj, "Luis", False)
    assert partida.buscar_personaje("Ana", partida.pj["personaje_id"])["nombre"] == "Thor"
    assert partida.pj["personaje_id"] == pid                       # sin choque de id, se conserva
    assert "stats" in partida.vista_token(partida.pj, "Ana", False)   # el nuevo dueño ve su ficha


def test_valida_usuario_tipo_y_nombre_repetido(partida):
    partida.cfg["permisos"]["sin_ficha"] = True
    with pytest.raises(ErrorJuego, match="Nadie"):
        partida.editar_token(partida.pj["id"], dueno="Nadie", usuarios_dueno={"Ana"})
    with pytest.raises(ErrorJuego, match="personaje"):
        partida.editar_token(partida.npc["id"], dueno="Ana", usuarios_dueno={"Ana"})
    partida.registrar_usuario("Ana")
    partida.crear_personaje("Ana", False, "guerrero", "Thor")
    with pytest.raises(ErrorJuego, match="ya tiene"):
        partida.editar_token(partida.pj["id"], dueno="Ana", usuarios_dueno={"Ana"})
    assert partida.pj["dueno"] == "GM"                              # nada cambió


def test_incluye_dar_npc(partida):
    partida.cfg["permisos"]["sin_ficha"] = True
    assert partida.cfg["permisos"]["npc_para_jugadores"] is False
    assert permisos_de(partida.cfg, False)["npc_para_jugadores"] is True
    partida.editar_token(partida.npc["id"], controlado_por="Ana", usuarios_validos={"Ana"})
    assert partida.puede_controlar(partida.npc, "Ana", False)


def test_el_traspaso_se_guarda(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(4))
    e.cfg["permisos"]["sin_ficha"] = True
    e.registrar_usuario("GM")
    p = e.crear_personaje("GM", True, "guerrero", "Lia")
    t, _ = e.desplegar_personaje("GM", p["id"], "GM", True, 2, 8)
    e.editar_token(t["id"], dueno="Ana", usuarios_dueno={"Ana"})
    otra = EstadoPartida(catalogo, tmp_path, rng=random.Random(4))
    otra.registrar_usuario("Ana"); otra.registrar_usuario("GM")
    assert [x["nombre"] for x in otra.personajes_de("Ana")] == ["Lia"] and otra.personajes_de("GM") == []   # la ficha quedó en los archivos de Ana
