"""Tamaño de los tokens y grupos de tokens que se mueven juntos (como en Roll20). Un compañero (mascota, criatura, invocación…) es un personaje más."""
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.test_servidor import _gm_y_ana, mundo  # noqa: F401  (fixture)


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    e.cfg["permisos"]["max_personajes_por_jugador"] = 5
    e.registrar_usuario("Ana")
    toks = []
    for n, (x, y) in (("Thor", (2, 8)), ("Lobo", (3, 8)), ("Halcón", (2, 9))):
        p = e.crear_personaje("Ana", False, "guerrero", n)
        toks.append(e.desplegar_personaje("Ana", p["id"], "GM", True, x, y)[0])
    return e, toks


def test_tamano(partida):
    e, (thor, lobo, _) = partida
    e.escalar_token(lobo["id"], 0.5, "Ana", False)
    assert e.vista_token(lobo, "Beto", False)["escala"] == 0.5 and "escala" not in e.vista_token(thor, "Ana", False)
    e.escalar_token(lobo["id"], 1, "Ana", False)
    assert "escala" not in lobo
    for malo in (7, "2", True, None):
        with pytest.raises(ErrorJuego, match="Tamaño"):
            e.escalar_token(lobo["id"], malo, "Ana", False)
    g = e.colocar_enemigo("goblin", 10, 10)
    with pytest.raises(ErrorJuego, match="propios"):
        e.escalar_token(g["id"], 2, "Ana", False)
    e.escalar_token(g["id"], 3, "GM", True)                               # el GM, a cualquiera
    assert e.casilla_ocupada(10, 10) and not e.casilla_ocupada(11, 10)    # solo cambia cómo se ve


def test_agrupados_se_mueven_juntos(partida, catalogo, tmp_path):
    e, (thor, lobo, halcon) = partida
    e.agrupar_tokens([thor["id"], lobo["id"]], "Ana", False)
    e.agrupar_tokens([lobo["id"], halcon["id"]], "Ana", False)           # se juntan los grupos
    assert thor["grupo"] == lobo["grupo"] == halcon["grupo"]
    e.mover_token(thor["id"], 3, 8, "Ana", False)                         # el de al lado se aparta a la vez
    assert (thor["x"], thor["y"], lobo["x"], lobo["y"], halcon["x"], halcon["y"]) == (3, 8, 4, 8, 3, 9)
    assert set(e.ultimos_movidos) == {thor["id"], lobo["id"], halcon["id"]}
    e2 = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    e2.cargar_estado()
    assert len({t.get("grupo") for t in e2.tokens.values() if t["tipo"] == "personaje"}) == 1
    e.combate["activo"] = True                                             # en combate cada uno se mueve solo
    e.mover_token(thor["id"], 3, 7, "GM", True)
    assert (lobo["x"], lobo["y"]) == (4, 8)
    e.combate["activo"] = False
    e.desagrupar_token(thor["id"], "Ana", False)
    assert "grupo" not in thor and lobo["grupo"] == halcon["grupo"]
    e.desagrupar_token(lobo["id"], "Ana", False)
    assert "grupo" not in halcon                                           # un grupo de uno desaparece


def test_si_uno_no_puede_moverse_se_queda(partida):
    e, (thor, lobo, _) = partida
    e.agrupar_tokens([thor["id"], lobo["id"]], "Ana", False)
    g = e.colocar_enemigo("goblin", 10, 10)
    e.mover_token(thor["id"], 3, 7, "Ana", False)                          # el lobo iría a (4, 7): libre
    assert (lobo["x"], lobo["y"]) == (4, 7)
    g["x"], g["y"] = 5, 6
    e.mover_token(thor["id"], 4, 6, "Ana", False)                          # el lobo iría a (5, 6): ocupado → se queda
    assert (thor["x"], thor["y"], lobo["x"], lobo["y"]) == (4, 6, 4, 7)


def test_agrupar_limites(partida):
    e, (thor, lobo, _) = partida
    g = e.colocar_enemigo("goblin", 10, 10)
    with pytest.raises(ErrorJuego, match="controlas"):
        e.agrupar_tokens([thor["id"], g["id"]], "Ana", False)
    for malo in ([thor["id"]], "x", [thor["id"], 5]):
        with pytest.raises(ErrorJuego):
            e.agrupar_tokens(malo, "Ana", False)
    e.agrupar_tokens([thor["id"], g["id"]], "GM", True)                    # el GM sí (un jinete y su montura NPC…)
    e.quitar_token(g["id"])
    assert "grupo" not in thor


async def test_por_la_red(mundo):  # noqa: F811
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    g = estado.colocar_enemigo("goblin", 10, 10)
    await gm.enviar(tipo="token_escala", token=g["id"], escala=2)
    assert next(t for t in (await ana.recibir("tokens"))["tokens"] if t["id"] == g["id"])["escala"] == 2
    await ana.enviar(tipo="agrupar_tokens", tokens=[tid, g["id"]])
    assert "controlas" in (await ana.recibir("error"))["texto"]
    await gm.enviar(tipo="agrupar_tokens", tokens=[tid, g["id"]])
    toks = (await ana.recibir("tokens"))["tokens"]
    assert len({t["grupo"] for t in toks}) == 1
