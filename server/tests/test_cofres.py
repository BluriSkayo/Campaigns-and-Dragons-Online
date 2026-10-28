"""Inventarios de grupo: uno común por defecto; el GM crea más con sus miembros, los cierra o los borra."""
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.test_servidor import _gm_y_ana, mundo  # noqa: F401  (fixture)


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    for u in ("Ana", "Beto"):
        e.registrar_usuario(u)
    pa = e.crear_personaje("Ana", False, "guerrero", "Thor")
    pb = e.crear_personaje("Beto", False, "guerrero", "Loki")
    pa["inventario"] = [{"objeto": "pocion", "cantidad": 3}]
    pa["dinero"] = 100
    return e, pa, pb


def test_comun_por_defecto_meter_y_sacar(partida, catalogo, tmp_path):
    e, pa, pb = partida
    assert [c["id"] for c in e.cofres_para("Ana", False)] == ["comun"]
    assert "guardó 2 × " in e.mover_a_cofre("Ana", False, "comun", pa["id"], "pocion", 2)
    e.mover_a_cofre("Ana", False, "comun", pa["id"], dinero=40)
    assert pa["inventario"] == [{"objeto": "pocion", "cantidad": 1}] and pa["dinero"] == 60
    antes = next((x["cantidad"] for x in pb["inventario"] if x["objeto"] == "pocion"), 0)
    e.mover_a_cofre("Beto", False, "comun", pb["id"], "pocion", 2, sacar=True)        # otro miembro saca lo que guardó Ana
    e.mover_a_cofre("Beto", False, "comun", pb["id"], dinero=40, sacar=True)
    assert next(x["cantidad"] for x in pb["inventario"] if x["objeto"] == "pocion") == antes + 2 and pb["dinero"] >= 40
    with pytest.raises(ErrorJuego, match="No hay tantas"):
        e.mover_a_cofre("Beto", False, "comun", pb["id"], "pocion", 1, sacar=True)
    with pytest.raises(ErrorJuego, match="suficientes"):
        e.mover_a_cofre("Ana", False, "comun", pa["id"], "pocion", 5)
    with pytest.raises(ErrorJuego, match="elige un personaje"):
        e.mover_a_cofre("Ana", False, "comun", pb["id"], "pocion", 1)                 # no es su personaje
    e.mover_a_cofre("Ana", False, "comun", pa["id"], "pocion", 1)
    e2 = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    e2.cargar_estado()
    assert e2.cofres["comun"]["inventario"] == [{"objeto": "pocion", "cantidad": 1}]


def test_cofres_del_gm_miembros_cerrar_y_borrar(partida):
    e, pa, pb = partida
    e.gm_cofre("crear", nombre="Bolsa de Ana", miembros=["Ana"])
    cid = next(c["id"] for c in e.cofres.values() if c["nombre"] == "Bolsa de Ana")
    assert {c["id"] for c in e.cofres_para("Ana", False)} == {"comun", cid}
    assert {c["id"] for c in e.cofres_para("Beto", False)} == {"comun"}
    assert len(e.cofres_para("GM", True)) == 2
    with pytest.raises(ErrorJuego, match="no es tuyo"):
        e.mover_a_cofre("Beto", False, cid, pb["id"], dinero=1)
    e.gm_cofre("objeto", cid, objeto="pocion", cantidad=5)
    e.gm_cofre("editar", cid, cerrado=True)
    with pytest.raises(ErrorJuego, match="cerrado"):
        e.mover_a_cofre("Ana", False, cid, pa["id"], "pocion", 1, sacar=True)
    e.mover_a_cofre("Ana", False, cid, pa["id"], "pocion", 1)                            # meter sí se puede
    e.gm_cofre("editar", cid, miembros="todos", cerrado=False)
    assert cid in {c["id"] for c in e.cofres_para("Beto", False)}
    e.gm_cofre("dinero", cid, dinero=-5)
    assert e.cofres[cid]["dinero"] == 0
    e.gm_cofre("borrar", cid)
    assert cid not in e.cofres
    for malo in [("volar", None), ("editar", "nada"), ("objeto", "comun")]:
        with pytest.raises(ErrorJuego):
            e.gm_cofre(*malo, objeto="dragon", cantidad=1)


async def test_por_la_red(mundo):  # noqa: F811
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    assert [c["id"] for c in estado.cofres_para("Master", True)] == ["comun"]
    pid = estado.tokens[tid]["personaje_id"]
    estado.personajes["Ana"][0]["inventario"] = [{"objeto": "pocion", "cantidad": 2}]
    await ana.enviar(tipo="cofre", accion="meter", cofre="comun", personaje=pid, objeto="pocion", cantidad=1)
    m = await gm.recibir("cofres")
    assert m["cofres"][0]["inventario"] == [{"objeto": "pocion", "cantidad": 1}]
    await ana.enviar(tipo="gm_cofre", accion="crear", nombre="Secreto")
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_cofre", accion="crear", nombre="Secreto", miembros=[])
    m = await ana.recibir("cofres")
    assert [c["nombre"] for c in m["cofres"]] == ["Inventario del grupo"]        # Ana no es miembro del nuevo


def test_desactivar_el_inventario_de_grupo_lo_quita_del_todo_y_al_volver_reaparece(partida):
    e, pa, pb = partida
    e.cfg["juego"]["inventario_grupo"] = False
    assert e.cofres_para("Ana", False) == [] and e.cofres_para("GM", True) == []
    with pytest.raises(ErrorJuego):
        e.gm_cofre("crear")
    with pytest.raises(ErrorJuego):
        e.mover_a_cofre("Ana", False, "comun", pa["id"], dinero=10)
    e.cfg["juego"]["inventario_grupo"] = True
    assert [c["id"] for c in e.cofres_para("Ana", False)] == ["comun"]
