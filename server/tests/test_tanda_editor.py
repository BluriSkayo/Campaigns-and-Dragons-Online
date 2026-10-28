"""Tanda del informe del Editor: el GM pone y quita estados en partida; un ataque que no hace daño falla (sin estado ni efectos)."""
import pytest

from mesa.errores import ErrorJuego
from tests.test_habilidades_area import hab, partida  # noqa: F401  (fixture)


def _goblin(e):
    return e.colocar_enemigo("goblin", 2, 10)


def test_el_gm_pone_y_quita_estados(partida):  # noqa: F811
    g = _goblin(partida)
    assert "pone" in partida.gm_estado(g["id"], "veneno", True)
    assert [x["id"] for x in partida.estados_de(g)] == ["veneno"]
    partida.gm_estado(g["id"], "veneno", True)                       # renovarlo no lo duplica
    assert len(partida.estados_de(g)) == 1
    assert "quita" in partida.gm_estado(g["id"], "veneno", False)
    assert partida.estados_de(g) == []
    with pytest.raises(ErrorJuego):
        partida.gm_estado(g["id"], "veneno", False)
    with pytest.raises(ErrorJuego):
        partida.gm_estado(g["id"], "no_existe", True)


def test_un_ataque_sin_dano_falla_y_no_aplica_nada(partida):  # noqa: F811
    g = _goblin(partida)
    efecto = {"cuando": {"tipo": "al_impactar"}, "si": [], "hacer": {"tipo": "aplicar_estado", "estado": "veneno", "objetivo": "objetivo"}}
    hab(partida, formula="0", aplica_estado="veneno", efectos=[efecto])
    texto, _ = partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert "falla" in texto and partida.estados_de(g) == []
    hab(partida, formula="0", aplica_estado="veneno", efectos=[], aplicar_si_falla=True)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert [x["id"] for x in partida.estados_de(g)] == ["veneno"]


def _poner_tile(partida, x, y, tid):  # noqa: F811
    partida._celdas[y][x] = tid


def test_una_habilidad_golpea_un_tile_rompible_apuntando_a_su_casilla(partida):  # noqa: F811
    partida.cfg["permisos"]["romper_casillas"] = "todos"
    _poner_tile(partida, 2, 10, "barricada")
    hab(partida, formula="5")
    golpes = partida.cat.tiles["barricada"]["rompible"]["golpes"]
    for i in range(golpes):
        partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(2, 10))
        texto, cambio = partida.golpes_pendientes.pop()
    assert "roto" in texto and partida._celdas[10][2] == "hierba"


def test_sin_permiso_el_jugador_no_rompe(partida):  # noqa: F811
    _poner_tile(partida, 2, 10, "barricada")
    hab(partida, formula="5")
    with pytest.raises(ErrorJuego):
        partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(2, 10))


def test_un_objeto_destruible_desaparece_y_deja_de_bloquear(partida):  # noqa: F811
    partida.cfg["permisos"]["romper_casillas"] = "todos"
    partida.mapa["objetos"].append({"nombre": "Caja", "x": 2, "y": 10, "ancho": 1, "alto": 1, "imagen": "", "bloquea": True, "bloquea_vision": False, "destruible": 2})
    partida._recalcular_bloqueos()
    assert not partida.casilla_transitable(2, 10)
    hab(partida, formula="5", area={"forma": "explosion", "tamano": 1, "afecta": "rivales"})
    partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(2, 10))
    assert "resiste" in partida.golpes_pendientes.pop()[0]
    partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(2, 10))
    texto, cambio = partida.golpes_pendientes.pop()
    assert "roto" in texto and all(o["nombre"] != "Caja" for o in cambio["objetos"]) and partida.casilla_transitable(2, 10)


def test_lo_roto_se_reconoce_por_nombre_y_posicion_no_por_el_orden(partida):  # noqa: F811
    partida.cfg["permisos"]["romper_casillas"] = "todos"
    caja = {"nombre": "Caja", "x": 2, "y": 10, "ancho": 1, "alto": 1, "imagen": "", "bloquea": True, "bloquea_vision": False, "destruible": 1}
    carro = {"nombre": "Carro", "x": 5, "y": 5, "ancho": 1, "alto": 1, "imagen": "", "bloquea": True, "bloquea_vision": False}
    objs = partida.mapa["objetos"]
    objs[:] = [caja, carro]
    partida.golpe(2, 10)
    assert [o["nombre"] for o in partida.objetos_vivos()] == ["Carro"]
    guardado = {"objetos_golpeados": partida.objetos_golpeados}
    objs[:] = [carro]                              # en el editor se borró la caja: el carro pasa a ser el primero
    partida.objetos_golpeados = {}
    crudo = guardado["objetos_golpeados"]
    validas = {partida.huella_objeto(o) for o in objs if o.get("destruible")}
    assert not any(k in validas for k in crudo[partida.mapa_id])     # la marca de la caja no cae en el carro
    partida.objetos_golpeados = crudo
    assert [o["nombre"] for o in partida.objetos_vivos()] == ["Carro"]   # y aunque quedara, un objeto no destruible nunca desaparece
