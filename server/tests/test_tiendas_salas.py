"""Tiendas ligadas a un mapa con varias salas en uso: cada uno ve si la tienda atiende en SU sala (no en la de quien la abrió)."""
from tests.test_servidor import mundo  # noqa: F401  (fixture con servidor real)


async def _tiendas(c):
    return (await c.recibir("tiendas"))["tiendas"]


async def test_abrir_tienda_desde_otra_sala_llega_bien_a_cada_uno(mundo, catalogo):
    nuevo, estado, srv = mundo
    catalogo.tiendas["tienda_aldea"]["mapas"] = ["aldea"]          # solo atiende en la aldea
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    await ana.entrar("Ana")
    await ana.enviar(tipo="crear_personaje", base="guerrero", nombre="Thor")
    pid = (await ana.recibir("personajes"))["creado"]
    await ana.enviar(tipo="elegir_personaje", personaje=pid)
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    await ana.recibir("personaje_activo")
    assert (await ana.recibir("estado"))["mapa_id"] == "aldea"
    await gm.enviar(tipo="cambiar_sala", mapa="taberna")          # el GM mira la taberna
    while (await gm.recibir("estado"))["mapa_id"] != "taberna":
        pass
    await gm.enviar(tipo="gm_tienda_abrir", tienda="tienda_aldea", abierta=True)
    del_gm, de_ana = await _tiendas(gm), await _tiendas(ana)
    assert del_gm[0]["aqui"] is False                              # el GM está en la taberna
    assert de_ana[0]["aqui"] is True                               # Ana está en la aldea: puede comprar
    await ana.enviar(tipo="comprar", tienda="tienda_aldea", objeto="pocion", cantidad=1)
    assert (await _tiendas(ana))[0]["articulos"][0]["stock"] == 9
