"""Tiradas guardadas de cada usuario y comandos del chat (/r, /yo, /ayuda, /Nombre y /gm contraseña)."""
import random

import pytest

from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.test_servidor import _gm_y_ana, mundo  # noqa: F401  (fixture)


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(7))


def test_guardar_reemplazar_borrar_y_recordar(partida, catalogo, tmp_path):
    partida.guardar_tirada("Ana", "Ataque", "1d20 + [Fuerza]", False)
    partida.guardar_tirada("Ana", "Daño", "2d6", False)
    assert [t["nombre"] for t in partida.tiradas_de("Ana")] == ["Ataque", "Daño"] and partida.tiradas_de("Beto") == []
    partida.guardar_tirada("Ana", "ataque", "1d20 + [Agilidad]", False)                 # mismo nombre (sin mayúsculas): reemplaza
    assert partida.tiradas_de("Ana")[0] == {"nombre": "ataque", "expresion": "1d20 + [Agilidad]"}
    e2 = EstadoPartida(catalogo, tmp_path, rng=random.Random(7))
    e2.cargar_estado()
    assert len(e2.tiradas_de("Ana")) == 2
    partida.borrar_tirada("Ana", "DAÑO")
    assert [t["nombre"] for t in partida.tiradas_de("Ana")] == ["ataque"]
    with pytest.raises(ErrorJuego, match="ninguna tirada"):
        partida.borrar_tirada("Ana", "Daño")


@pytest.mark.parametrize("nombre,expr,texto", [
    ("", "1d6", "nombre"), ("x" * 31, "1d6", "nombre"), ("/gm", "1d6", "nombre"), ("Bien", "", "Escribe"),
    ("Bien", "1d6" * 40, "Escribe"), ("Bien", "1d20 + [Suerte]", "inválida"), ("Bien", "__import__('os')", "inválida"),
])
def test_tiradas_incorrectas(partida, nombre, expr, texto):
    with pytest.raises(ErrorJuego, match=texto):
        partida.guardar_tirada("Ana", nombre, expr, False)


def test_limites_y_permiso(partida):
    for i in range(30):
        partida.guardar_tirada("Ana", f"T{i}", "1d6", False)
    with pytest.raises(ErrorJuego, match="como mucho 30"):
        partida.guardar_tirada("Ana", "Otra", "1d6", False)
    partida.cfg["permisos"]["dados_personalizados"] = False
    with pytest.raises(ErrorJuego, match="solo se pueden tirar"):
        partida.guardar_tirada("Beto", "X", "1d6", False)
    partida.guardar_tirada("GM", "X", "1d6", True)                                     # el GM siempre puede


def test_tirar_con_estadisticas(partida):
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Thor")
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    partida.guardar_tirada("Ana", "Fuerza fija", "[Fuerza] + 0", False)
    partida.guardar_tirada("Ana", "Dado", "1d1", False)
    assert "Thor (Ana) tiró «Fuerza fija»" in partida.tirar_guardada("Ana", "fuerza fija", t)
    assert str(partida.stats_efectivas(t)["Fuerza"]) in partida.tirar_guardada("Ana", "Fuerza fija", t)
    assert "Ana tiró «Dado»" in partida.tirar_guardada("Ana", "Dado", None)
    with pytest.raises(ErrorJuego, match="usa estadísticas"):
        partida.tirar_guardada("Ana", "Fuerza fija", None)


async def test_comandos_del_chat(mundo):  # noqa: F811
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await ana.enviar(tipo="chat", texto="/ayuda")
    m = await ana.recibir("chat")
    assert m["autor"] == "Sistema" and "/gm contraseña" in m["texto"]
    await ana.enviar(tipo="chat", texto="/r 1d1+2")
    assert "tiró" in (await gm.chat_de("Ana"))["texto"]
    await ana.enviar(tipo="chat", texto="/yo abre la puerta")
    assert (await gm.chat_de("Ana"))["texto"] == "✦ Ana abre la puerta"
    await ana.enviar(tipo="tiradas", accion="guardar", nombre="Ataque", expresion="[Fuerza] + 1d1")
    assert (await ana.recibir("tiradas"))["tiradas"][0]["nombre"] == "Ataque"
    await ana.enviar(tipo="chat", texto="/Ataque", token=tid)
    assert "Thor (Ana) tiró «Ataque»" in (await gm.chat_de("Ana"))["texto"]
    await gm.enviar(tipo="tiradas", accion="tirar", nombre="Ataque", token=tid)            # el GM no tiene esa tirada
    assert "ninguna tirada" in (await gm.recibir("error"))["texto"]


async def test_gm_por_comando_sin_que_se_vea_la_contrasena(mundo):  # noqa: F811
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await ana.enviar(tipo="chat", texto="/gm equivocada")
    assert "incorrecta" in (await ana.recibir("error"))["texto"]
    assert not any("equivocada" in c["texto"] for c in estado.chat)
    await ana.enviar(tipo="chat", texto="/gm secreto")
    b = await ana.recibir("bienvenida")
    assert b["es_gm"] is True and b["elevado"] is True and b["permisos"]["gm"] is True
    assert not any("secreto" in c["texto"] for c in estado.chat)
    while "ahora es GM" not in (await gm.chat_de("Sistema"))["texto"]:
        pass
    await ana.enviar(tipo="gm_listar_personajes")
    assert (await ana.recibir("todos_los_personajes"))["personajes"]
    await ana.enviar(tipo="ser_gm", password="secreto")
    assert (await ana.recibir("error"))["texto"] == "Ya eres GM"


async def test_gm_por_comando_se_bloquea_tras_fallos(mundo):  # noqa: F811
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    for _ in range(estado.cfg["seguridad"]["max_intentos"]):
        await ana.enviar(tipo="ser_gm", password="mal")
        await ana.recibir("error")
    await ana.enviar(tipo="ser_gm", password="secreto")
    assert "Demasiados intentos" in (await ana.recibir("error"))["texto"]
