"""Salas con WebSocket real: cada cliente ve solo su sala, el GM mueve tokens entre salas y los jugadores se mueven solos si la mesa lo permite."""
import asyncio

from tests.test_servidor import Cliente, mundo  # noqa: F401  (la fixture)


async def preparar(nuevo, estado):
    gm, ana, bea = await nuevo(), await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    await gm.recibir("estado")
    ids = {}
    for c, nombre, pj in ((ana, "Ana", "Thor"), (bea, "Bea", "Lia")):
        await c.entrar(nombre)
        await c.recibir("estado")
        await c.enviar(tipo="crear_personaje", base="guerrero", nombre=pj)
        pid = (await c.recibir("personajes"))["creado"]
        await c.enviar(tipo="elegir_personaje", personaje=pid)
        await c.recibir("personaje_activo")
        await c.enviar(tipo="desplegar_personaje", personaje=pid)
        ids[nombre] = (await c.recibir("personaje_activo"))["token"]
        await c.recibir("estado")
    return gm, ana, bea, ids


async def vaciar(*clientes):
    for c in clientes:
        try:
            while True:
                await c.recibir(timeout=0.15)
        except asyncio.TimeoutError:
            pass


async def test_el_gm_lleva_a_un_jugador_a_otra_sala(mundo):
    nuevo, estado, _ = mundo
    gm, ana, bea, ids = await preparar(nuevo, estado)
    await vaciar(gm, ana, bea)
    await gm.enviar(tipo="gm_mover_a_sala", token=ids["Ana"], mapa="taberna")
    est = await ana.recibir("estado")                    # Ana se va con su personaje
    assert est["mapa_id"] == "taberna" and [t["id"] for t in est["tokens"]] == [ids["Ana"]]
    t = await bea.recibir("tokens")                      # Bea, que se queda en la aldea, deja de verla
    assert ids["Ana"] in t["quitados"]
    assert estado.sala_de_token(ids["Ana"]) == "taberna"
    await vaciar(gm, ana, bea)

    # Lo que pasa en la aldea no llega a la taberna (y al revés)
    await bea.enviar(tipo="ping", x=3, y=3)
    assert (await gm.recibir("ping"))["usuario"] == "Bea"
    await vaciar(ana)
    assert not any(m["tipo"] == "ping" for m in ana.mensajes)

    # El GM sigue viendo la aldea; pasa a ver la taberna sin mover a nadie
    await gm.enviar(tipo="cambiar_sala", mapa="taberna")
    est = await gm.recibir("estado")
    assert est["mapa_id"] == "taberna" and [t["id"] for t in est["tokens"]] == [ids["Ana"]]
    assert estado.sala_de_token(ids["Bea"]) == "aldea"


async def test_hablar_como_personaje_se_oye_solo_en_su_sala(mundo):
    nuevo, estado, _ = mundo
    gm, ana, bea, ids = await preparar(nuevo, estado)
    await gm.enviar(tipo="gm_mover_a_sala", token=ids["Ana"], mapa="taberna")
    await ana.recibir("estado")
    await vaciar(gm, ana, bea)
    await ana.enviar(tipo="chat", texto="¡Una cerveza!", como=ids["Ana"])
    m = await ana.chat_de("Ana")
    assert m["personaje"]["nombre"] == "Thor" and m["mapa"] == "taberna"
    assert (await gm.chat_de("Ana"))["texto"] == "¡Una cerveza!"         # el GM lo ve todo
    await vaciar(bea)
    assert not any(x.get("tipo") == "chat" and x.get("autor") == "Ana" for x in bea.mensajes)
    await ana.enviar(tipo="chat", texto="(fuera de personaje) vuelvo en 5")
    assert "personaje" not in (await bea.chat_de("Ana"))                   # como usuario: lo ve toda la mesa
    await ana.enviar(tipo="chat", texto="hola", como=ids["Bea"])
    assert "no está en esta sala" in (await ana.recibir("error"))["texto"]       # el de Bea está en la aldea


async def test_el_jugador_cambia_de_sala_solo_si_se_permite(mundo):
    nuevo, estado, srv = mundo
    gm, ana, bea, ids = await preparar(nuevo, estado)
    await vaciar(gm, ana, bea)
    await ana.enviar(tipo="cambiar_sala", mapa="taberna")
    assert "solo el GM" in (await ana.recibir("error"))["texto"]
    srv.cfg["permisos"]["cambiar_sala"] = "todos"
    try:
        await gm.enviar(tipo="gm_sala_abierta", mapa="taberna", abierta=False)
        await ana.recibir("salas_mapa")
        await ana.enviar(tipo="cambiar_sala", mapa="taberna")
        assert "cerrado" in (await ana.recibir("error"))["texto"]
        await gm.enviar(tipo="gm_sala_abierta", mapa="taberna", abierta=True)
        await ana.enviar(tipo="cambiar_sala", mapa="taberna")
        est = await ana.recibir("estado")
        assert est["mapa_id"] == "taberna" and ids["Ana"] in [t["id"] for t in est["tokens"]]
        # Llevar a todos: Ana vuelve a la aldea con Bea
        await gm.enviar(tipo="gm_cambiar_mapa", mapa="aldea")
        est = await ana.recibir("estado")
        assert est["mapa_id"] == "aldea" and {ids["Ana"], ids["Bea"]} <= {t["id"] for t in est["tokens"]}
    finally:
        srv.cfg["permisos"]["cambiar_sala"] = "gm"


async def test_gm_habilidad_solo_avisa_al_gm_y_al_dueno(mundo):
    nuevo, estado, _ = mundo
    gm, ana, bea, ids = await preparar(nuevo, estado)
    await vaciar(gm, ana, bea)
    await gm.enviar(tipo="gm_habilidad", token=ids["Ana"], habilidad="curacion", poner=True)
    t = await ana.recibir("tokens")
    assert "curacion" in t["tokens"][0]["habilidades"]
    assert any("curacion" in p["habilidades"] for p in (await ana.recibir("personajes"))["personajes"])
    assert "Curación" in (await ana.chat_de("Sistema"))["texto"]
    assert "Curación" in (await gm.chat_de("Sistema"))["texto"]
    await vaciar(bea)
    assert not any(m.get("tipo") == "chat" and "Curación" in m.get("texto", "") for m in bea.mensajes)
    await ana.enviar(tipo="gm_habilidad", token=ids["Ana"], habilidad="curacion", poner=False)
    assert "Solo el GM" in (await ana.recibir("error"))["texto"]
