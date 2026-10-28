"""Objetos: usarlos con otro token cercano y darlos a otro token (tanda de observaciones del 27-oct-2026)."""
import asyncio
import json

import pytest

from mesa.estado import ErrorJuego
from tests.conftest import combatir


def jugador(estado, usuario, nombre, x, y, base="guerrero"):
    estado.registrar_usuario(usuario)
    p = estado.crear_personaje(usuario, False, base, nombre)
    t, _ = estado.colocar_personaje(usuario, p["id"])
    t["x"], t["y"] = x, y
    return p, t


def test_usar_pocion_con_un_aliado_cercano(estado):
    pa, ta = jugador(estado, "ana", "Thor", 3, 3)          # la plantilla del guerrero trae 2 pociones
    pb, tb = jugador(estado, "beto", "Lia", 4, 3)
    pb["recursos"]["HP"]["actual"] = 10
    texto, ids = estado.usar_objeto(ta["id"], "pocion", "ana", False, tb["id"])
    assert pb["recursos"]["HP"]["actual"] == 50 and pa["recursos"]["HP"]["actual"] == pa["recursos"]["HP"]["max"]
    assert pa["inventario"][0]["cantidad"] == 1          # se gasta del que la lleva
    assert "con Lia" in texto and set(ids) == {ta["id"], tb["id"]}


def test_usar_con_alguien_lejos_o_invisible_se_rechaza(estado):
    _, ta = jugador(estado, "ana", "Thor", 1, 1)
    _, tb = jugador(estado, "beto", "Lia", 6, 1)
    with pytest.raises(ErrorJuego, match="demasiado lejos"):
        estado.usar_objeto(ta["id"], "pocion", "ana", False, tb["id"])
    with pytest.raises(ErrorJuego, match="no está en esta sala"):
        estado.usar_objeto(ta["id"], "pocion", "ana", False, "no-existe")
    estado.usar_objeto(ta["id"], "pocion", "ana", True, tb["id"])      # el GM no tiene límite de distancia


def test_alcance_de_objetos_configurable(estado):
    estado.cfg["permisos"]["alcance_objetos"] = 5
    _, ta = jugador(estado, "ana", "Thor", 1, 1)
    pb, tb = jugador(estado, "beto", "Lia", 6, 1)
    pb["recursos"]["HP"]["actual"] = 1
    estado.usar_objeto(ta["id"], "pocion", "ana", False, tb["id"])
    assert pb["recursos"]["HP"]["actual"] == 41


def test_usar_sobre_si_mismo_sigue_igual(estado):
    pa, ta = jugador(estado, "ana", "Thor", 3, 3)
    pa["recursos"]["HP"]["actual"] = 5
    texto, ids = estado.usar_objeto(ta["id"], "pocion", "ana", False, ta["id"])
    assert pa["recursos"]["HP"]["actual"] == 45 and ids == [ta["id"]] and " con " not in texto


def test_dar_objeto_a_token_cercano(estado):
    pa, ta = jugador(estado, "ana", "Thor", 3, 3)
    pb, tb = jugador(estado, "beto", "Lia", 4, 4)
    antes_b = next((e["cantidad"] for e in pb["inventario"] if e["objeto"] == "pocion"), 0)
    texto, ids = estado.dar_objeto(ta["id"], tb["id"], "pocion", 2, "ana", False)
    assert not any(e["objeto"] == "pocion" for e in pa["inventario"])
    assert next(e["cantidad"] for e in pb["inventario"] if e["objeto"] == "pocion") == antes_b + 2
    assert "dio 2 × Poción a Lia" in texto and set(ids) == {ta["id"], tb["id"]}


def test_dar_objeto_a_un_npc_y_validaciones(estado):
    _, ta = jugador(estado, "ana", "Thor", 3, 3)
    g = estado.colocar_enemigo("goblin", 3, 4)
    estado.dar_objeto(ta["id"], g["id"], "pocion", 1, "ana", False)
    assert any(e["objeto"] == "pocion" for e in g["inventario"])
    with pytest.raises(ErrorJuego, match="Solo tienes 1"):
        estado.dar_objeto(ta["id"], g["id"], "pocion", 5, "ana", False)
    with pytest.raises(ErrorJuego, match="a ti mismo"):
        estado.dar_objeto(ta["id"], ta["id"], "pocion", 1, "ana", False)
    for mala in (0, -1, 1000, True, "2", 1.5):
        with pytest.raises(ErrorJuego, match="cantidad"):
            estado.dar_objeto(ta["id"], g["id"], "pocion", mala, "ana", False)
    with pytest.raises(ErrorJuego, match="No puedes actuar"):
        estado.dar_objeto(g["id"], ta["id"], "pocion", 1, "ana", False)       # no es suyo
    with pytest.raises(ErrorJuego, match="No tienes"):
        estado.dar_objeto(ta["id"], g["id"], "espada_inexistente", 1, "ana", False)
    g["x"] = 9
    with pytest.raises(ErrorJuego, match="demasiado lejos"):
        estado.dar_objeto(ta["id"], g["id"], "pocion", 1, "ana", False)


def test_dar_objetos_se_puede_apagar(estado):
    estado.cfg["permisos"]["dar_objetos"] = False
    _, ta = jugador(estado, "ana", "Thor", 3, 3)
    _, tb = jugador(estado, "beto", "Lia", 4, 3)
    with pytest.raises(ErrorJuego, match="no se pueden dar"):
        estado.dar_objeto(ta["id"], tb["id"], "pocion", 1, "ana", False)
    estado.dar_objeto(ta["id"], tb["id"], "pocion", 1, "gm", True)          # el GM siempre


def test_dar_en_combate_solo_en_su_turno(estado):
    _, ta = jugador(estado, "ana", "Thor", 3, 3)
    _, tb = jugador(estado, "beto", "Lia", 4, 3)
    estado.colocar_enemigo("goblin", 8, 8)
    combatir(estado)
    fuera = ta if estado.token_en_turno() != ta["id"] else tb
    otro = tb if fuera is ta else ta
    with pytest.raises(ErrorJuego, match="turno"):
        estado.dar_objeto(fuera["id"], otro["id"], "pocion", 1, fuera["dueno"], False)


def test_la_config_trae_los_valores_por_defecto(catalogo):
    p = catalogo.config["permisos"]
    assert p["dar_objetos"] is True and p["alcance_objetos"] == 1


def test_mensaje_dar_objeto_por_el_servidor(estado):
    """El mensaje viaja por el servidor real: se valida, se avisa en el chat de la sala y ambos tokens se actualizan."""
    from mesa.servidor import Servidor, Sesion
    srv = Servidor(estado.cat, estado)
    _, ta = jugador(estado, "ana", "Thor", 3, 3)
    _, tb = jugador(estado, "beto", "Lia", 4, 3)

    class WS:
        def __init__(self):
            self.recibidos = []

        async def send(self, texto):
            self.recibidos.append(json.loads(texto))

    ws = WS()
    s = Sesion("ana", False, mapa=estado.mapa_id)
    srv.sesiones[ws] = s
    asyncio.run(srv._dar_objeto(ws, s, {"tipo": "dar_objeto", "token": ta["id"], "a": tb["id"], "objeto": "pocion", "cantidad": 1}))
    tipos = [m["tipo"] for m in ws.recibidos]
    assert "tokens" in tipos and any(m["tipo"] == "chat" and "dio 1 × Poción a Lia" in m["texto"] for m in ws.recibidos)


def test_mensaje_usar_objeto_sobre_si_mismo_y_sobre_otro(estado):
    """Por el servidor real: sin «objetivo» se usa sobre uno mismo (antes se rechazaba: «objetivo» debe ser texto)."""
    from mesa.servidor import Servidor, Sesion
    srv = Servidor(estado.cat, estado)
    pa, ta = jugador(estado, "ana", "Thor", 3, 3)
    pb, tb = jugador(estado, "beto", "Lia", 4, 3)
    pa["recursos"]["HP"]["actual"] = pb["recursos"]["HP"]["actual"] = 10

    class WS:
        def __init__(self):
            self.recibidos = []

        async def send(self, texto):
            self.recibidos.append(json.loads(texto))

    ws = WS()
    s = Sesion("ana", False, mapa=estado.mapa_id)
    srv.sesiones[ws] = s
    asyncio.run(srv._usar_objeto(ws, s, {"tipo": "usar_objeto", "token": ta["id"], "objeto": "pocion"}))
    assert pa["recursos"]["HP"]["actual"] == 50 and pb["recursos"]["HP"]["actual"] == 10
    asyncio.run(srv._usar_objeto(ws, s, {"tipo": "usar_objeto", "token": ta["id"], "objeto": "pocion", "objetivo": tb["id"]}))
    assert pb["recursos"]["HP"]["actual"] == 50 and pa["inventario"] == []
    with pytest.raises(ErrorJuego, match="texto"):
        asyncio.run(srv._usar_objeto(ws, s, {"tipo": "usar_objeto", "token": ta["id"], "objeto": "pocion", "objetivo": 5}))
