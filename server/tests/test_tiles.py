"""Tiles: bloqueo, daño, esconder y romper casillas."""
import pytest

from mesa.estado import ErrorJuego
from tests.test_estado import jugador


def test_el_mapa_de_ejemplo_usa_tiles(catalogo):
    m = catalogo.mapas["aldea"]
    assert m["celdas"][0][0] == "muro" and m["celdas"][1][1] == "hierba" and m["celdas"][4][9] == "agua"
    assert catalogo.tiles["barricada"]["rompible"] == {"golpes": 3, "se_convierte_en": "hierba"}


def test_tile_no_transitable_bloquea(estado):
    _, t = jugador(estado)
    with pytest.raises(ErrorJuego, match="bloqueada"):
        estado.mover_token(t["id"], 5, 6, "ana", False)       # barricada


def test_brasas_danan_al_pisar_y_al_empezar_el_turno(estado):
    _, t = jugador(estado)
    vida = estado.cat.recurso_vida()
    antes = estado.datos_de(t)["recursos"][vida]["actual"]
    estado.mover_token(t["id"], 12, 9, "ana", False)
    assert estado.datos_de(t)["recursos"][vida]["actual"] == antes - 5
    estado.al_empezar_turno(t)
    assert estado.datos_de(t)["recursos"][vida]["actual"] == antes - 8
    assert any("Brasas" in txt for txt, _ in estado.cola_chat)
    estado.mover_token(t["id"], 11, 9, "ana", False)          # fuera de las brasas ya no duele
    estado.al_empezar_turno(t)
    assert estado.datos_de(t)["recursos"][vida]["actual"] == antes - 8


def test_hierba_alta_esconde_a_los_demas(estado):
    _, a = jugador(estado)
    _, b = jugador(estado, "bruno", "guerrero", "Thor")
    estado.mover_token(a["id"], 14, 2, "ana", False)
    assert not estado.puede_ver(a, "bruno", False)
    assert estado.puede_ver(a, "ana", False) and estado.puede_ver(a, "master", True)
    assert [x["id"] for x in estado.snapshot("bruno", False)["tokens"]] == [b["id"]]
    assert len(estado.snapshot("ana", False)["tokens"]) == 2


def test_romper_casilla_por_golpes(estado):
    _, a = jugador(estado)
    estado.mover_token(a["id"], 4, 6, "ana", False)
    with pytest.raises(ErrorJuego, match="solo el GM"):
        estado.golpear_casilla(5, 6, "ana", False, a["id"])
    estado.cfg["permisos"]["romper_casillas"] = "todos"
    with pytest.raises(ErrorJuego, match="no se puede romper"):
        estado.golpear_casilla(4, 6, "ana", False, a["id"])
    txt, c = estado.golpear_casilla(5, 6, "ana", False, a["id"])
    assert "resiste (1/3)" in txt and c["tile"] == "barricada"
    estado.golpear_casilla(5, 6, "ana", False, a["id"])
    txt, c = estado.golpear_casilla(5, 6, "ana", False, a["id"])
    assert "se ha roto" in txt and c["tile"] == "hierba"
    assert estado.casilla_transitable(5, 6)
    assert estado.snapshot("ana", False)["mapa"]["celdas"][6][5] == "hierba"
    assert estado.mapa["celdas"][6][5] == "barricada"          # el mapa original no cambia


def test_golpear_exige_estar_cerca_y_gm_rompe_de_golpe(estado):
    _, a = jugador(estado)
    estado.cfg["permisos"]["romper_casillas"] = "todos"
    with pytest.raises(ErrorJuego, match="junto a la casilla"):
        estado.golpear_casilla(5, 6, "ana", False, a["id"])
    with pytest.raises(ErrorJuego, match="Solo el GM"):
        estado.golpear_casilla(5, 6, "ana", False, a["id"], romper_ya=True)
    estado.golpear_casilla(5, 6, "gm", True, romper_ya=True)
    assert estado.casilla_transitable(5, 6)


def test_casillas_rotas_sobreviven_al_reinicio(estado, catalogo, tmp_path):
    import random
    from mesa.estado import EstadoPartida
    estado.golpear_casilla(5, 6, "gm", True, romper_ya=True)
    otra = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=True)
    otra.cargar_estado()
    assert otra.casilla_transitable(5, 6)


def test_tile_invisible_no_se_envia_dibujado_a_los_jugadores(catalogo, tmp_path):
    """Un tile «invisible» llega al cliente marcado como tal, y a un jugador ni siquiera le llega su color o su imagen."""
    from mesa.estado import EstadoPartida
    from mesa.servidor import Servidor
    t = catalogo.tiles["muro"]
    antes = t["invisible"]
    t["invisible"] = True
    try:
        srv = Servidor(catalogo, EstadoPartida(catalogo, tmp_path, persistir=False))
        jugador = srv._catalogo_cliente(False)["tiles"]["muro"]
        assert jugador["invisible"] is True and jugador["color"] == "" and jugador["imagen"] == ""
        gm = srv._catalogo_cliente(True)["tiles"]["muro"]
        assert gm["invisible"] is True and gm["color"] == t["color"]
        assert srv._catalogo_cliente(False)["tiles"]["agua"]["invisible"] is False
    finally:
        t["invisible"] = antes
