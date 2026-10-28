"""Pruebas de integración con WebSocket real."""
import asyncio
import json
import random

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from mesa.estado import EstadoPartida
from mesa.servidor import Servidor


class Cliente:
    def __init__(self, ws):
        self.ws = ws
        self.mensajes = []

    async def enviar(self, **msg):
        await self.ws.send(json.dumps(msg))

    async def recibir(self, tipo=None, timeout=2):
        """Devuelve el siguiente mensaje (del tipo pedido, descartando los demás)."""
        while True:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), timeout))
            self.mensajes.append(m)
            if tipo is None or m["tipo"] == tipo:
                return m

    async def chat_de(self, autor, timeout=2):
        """Espera un mensaje de chat enviado por `autor` (ignora avisos de sistema)."""
        while True:
            m = await self.recibir("chat", timeout)
            if m["autor"] == autor:
                return m

    async def entrar(self, usuario, **extra):
        await self.enviar(tipo="entrar", usuario=usuario, **extra)
        return await self.recibir()


@pytest.fixture
async def mundo(catalogo, tmp_path):
    catalogo.config["servidor"]["password_gm"] = "secreto"
    estado = EstadoPartida(catalogo, tmp_path, rng=random.Random(3))
    srv = Servidor(catalogo, estado)
    async with serve(srv.handler, "127.0.0.1", 0) as s:
        puerto = s.sockets[0].getsockname()[1]
        conexiones = []

        async def nuevo():
            ws = await connect(f"ws://127.0.0.1:{puerto}")
            conexiones.append(ws)
            return Cliente(ws)
        yield nuevo, estado, srv
        for ws in conexiones:
            await ws.close()


async def test_flujo_completo(mundo):
    nuevo, estado, _ = mundo
    gm, ana = await nuevo(), await nuevo()

    b = await gm.entrar("Master", password_gm="secreto")
    assert b["tipo"] == "bienvenida" and b["es_gm"] and b["permisos"]["controlar_combate"]
    assert "enemigos" in b["catalogo"] and "mapas" in b["catalogo"]

    b = await ana.entrar("Ana")
    assert not b["es_gm"] and not b["permisos"]["controlar_combate"]
    assert "enemigos" not in b["catalogo"] and b["personajes"] == []
    await ana.recibir("estado")

    await ana.enviar(tipo="crear_personaje", base="guerrero", nombre="Thor", historia="Hijo del trueno")
    r = await ana.recibir("personajes")
    pid = r["creado"]
    await ana.enviar(tipo="elegir_personaje", personaje=pid)
    assert (await ana.recibir("personaje_activo"))["token"] is None      # elegir no despliega
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    activo = await ana.recibir("personaje_activo")
    est = await ana.recibir("estado")
    assert len(est["tokens"]) == 1 and est["tokens"][0]["nombre"] == "Thor"
    tid = activo["token"]

    # el GM ve el token nuevo y coloca un enemigo
    await gm.recibir("tokens")
    await gm.enviar(tipo="gm_colocar_enemigo", enemigo="goblin", x=4, y=5)
    t = await ana.recibir("tokens")
    gid = next(x["id"] for x in t["tokens"] if x["tipo"] == "enemigo")
    assert "stats" not in t["tokens"][0]            # Ana no ve las stats del goblin

    # jugador no puede usar comandos de GM
    await ana.enviar(tipo="gm_iniciar_combate")
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"

    # mover y chat
    await ana.enviar(tipo="mover_token", token=tid, x=3, y=5)
    assert (await ana.recibir("tokens"))["tokens"][0]["x"] == 3
    await ana.enviar(tipo="chat", texto="¡Hola!")
    c = await gm.chat_de("Ana")
    assert c["texto"] == "¡Hola!" and c["categoria"] == "normal"
    await ana.enviar(tipo="chat", texto="/2d6")
    d = await gm.chat_de("Ana")
    assert "🎲" in d["texto"] and d["categoria"] == "dado"

    # combate
    await gm.enviar(tipo="gm_iniciar_combate")
    await gm.enviar(tipo="gm_empezar_combate")
    cb = await ana.recibir("combate")
    while not cb["activo"]:
        cb = await ana.recibir("combate")
    assert cb["activo"] and cb["turno_de"] in (tid, gid)
    if cb["turno_de"] == gid:
        await gm.enviar(tipo="terminar_turno")
        cb = await ana.recibir("combate")
        assert cb["turno_de"] == tid
    await ana.enviar(tipo="usar_habilidad", token=tid, habilidad="ataque_basico", objetivo=gid)
    t = await ana.recibir("tokens")
    goblin = next(x for x in t["tokens"] if x["id"] == gid)
    assert goblin["recursos"]["HP"]["actual"] < 45
    await ana.enviar(tipo="terminar_turno")
    cb = await ana.recibir("combate")
    assert cb["turno_de"] == gid


async def test_validaciones_de_entrada(mundo):
    nuevo, _, _ = mundo
    c = await nuevo()
    await c.enviar(tipo="chat", texto="hola")
    assert "entrar" in (await c.recibir("error"))["texto"]
    for malo in ("", "   ", "x" * 21, "a/b", "<script>"):
        await c.enviar(tipo="entrar", usuario=malo)
        await c.recibir("error")
    await c.enviar(tipo="entrar", usuario="Ana", password_gm="mala")
    assert "GM" in (await c.recibir("error"))["texto"]
    await c.ws.send("esto no es json")
    assert (await c.recibir("error"))["texto"] == "Mensaje inválido"
    await c.ws.send("[1,2]")
    await c.recibir("error")


async def test_nombre_duplicado_y_contrasena(mundo, catalogo):
    nuevo, _, _ = mundo
    a, b = await nuevo(), await nuevo()
    await a.entrar("Ana")
    await b.enviar(tipo="entrar", usuario="ANA")
    assert "conectado" in (await b.recibir("error"))["texto"]
    catalogo.config["servidor"]["password_servidor"] = "puerta"
    await b.enviar(tipo="entrar", usuario="Beto", password_servidor="x")
    assert "servidor" in (await b.recibir("error"))["texto"]
    b2 = await b.entrar("Beto", password_servidor="puerta")
    assert b2["tipo"] == "bienvenida"


async def test_tipos_incorrectos_no_rompen_el_servidor(mundo):
    nuevo, _, _ = mundo
    c = await nuevo()
    await c.entrar("Ana")
    await c.recibir("estado")
    for msg in ({"tipo": "mover_token", "token": "x", "x": "a", "y": 1},
                {"tipo": "mover_token", "token": 5, "x": 1, "y": 1},
                {"tipo": "usar_habilidad", "token": "t", "habilidad": ["x"]},
                {"tipo": "crear_personaje", "base": None, "nombre": 3},
                {"tipo": "inventada"}, {"tipo": "reproducir_musica", "archivo": 5}):
        await c.enviar(**msg)
        assert (await c.recibir("error"))["texto"]
    await c.enviar(tipo="pedir_estado")
    assert (await c.recibir("estado"))["mapa_id"] == "aldea"


async def test_musica_segun_permiso(mundo, catalogo):
    nuevo, _, _ = mundo
    c = await nuevo()
    await c.entrar("Ana")
    await c.recibir("estado")
    await c.enviar(tipo="reproducir_musica", archivo=None)
    assert "permiso" in (await c.recibir("error"))["texto"]
    catalogo.config["permisos"]["musica"] = "todos"
    await c.enviar(tipo="reproducir_musica", archivo="taberna.wav")
    assert (await c.recibir("musica"))["archivo"] == "taberna.wav"
    await c.enviar(tipo="reproducir_musica", archivo="lluvia.wav")        # el ambiente no es música
    assert "lista del servidor" in (await c.recibir("error"))["texto"]
    await c.enviar(tipo="reproducir_musica", archivo=None, gradual=True)
    m = await c.recibir("musica")
    assert m["archivo"] is None and m["gradual"] is True


async def test_los_jugadores_solo_ven_la_musica_y_el_gm_todo(mundo):
    nuevo, _, _ = mundo
    gm, ana = await nuevo(), await nuevo()
    bg = await gm.entrar("Master", password_gm="secreto")
    ba = await ana.entrar("Ana")
    assert set(bg["catalogo"]["sonidos"]) == {"musica", "ambiente", "efectos"}
    assert set(ba["catalogo"]["sonidos"]) == {"musica"}
    assert ba["catalogo"]["sonidos"]["musica"][0] == {"categoria": "Pueblo", "archivos": ["taberna.wav"]}


async def test_el_ambiente_lo_controla_el_gm_y_lo_oyen_todos(mundo):
    nuevo, _, _ = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    await ana.entrar("Ana")
    await ana.enviar(tipo="sonido_ambiente", archivo="lluvia.wav", activo=True)
    assert "GM" in (await ana.recibir("error"))["texto"]
    await gm.enviar(tipo="sonido_ambiente", archivo="lluvia.wav", activo=True)
    assert (await ana.recibir("ambiente"))["activos"] == ["lluvia.wav"]
    await gm.enviar(tipo="sonido_ambiente", archivo="taberna.wav", activo=True)       # la música no es ambiente
    assert "lista del servidor" in (await gm.recibir("error"))["texto"]
    await gm.enviar(tipo="sonido_efecto", archivo="espada.wav")
    assert (await ana.recibir("efecto"))["archivo"] == "espada.wav"
    await gm.enviar(tipo="sonido_ambiente", archivo="lluvia.wav", activo=False)
    assert (await ana.recibir("ambiente"))["activos"] == []


async def test_cambio_de_mapa_reenvia_estado(mundo):
    nuevo, _, _ = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto"); await gm.recibir("estado")
    await ana.entrar("Ana"); await ana.recibir("estado")
    await gm.enviar(tipo="gm_cambiar_mapa", mapa="aldea")
    assert (await ana.recibir("estado"))["mapa_id"] == "aldea"
    await gm.enviar(tipo="gm_cambiar_mapa", mapa="otro")
    assert "no existe" in (await gm.recibir("error"))["texto"]


async def test_si_cae_el_que_tiene_el_turno_el_combate_avanza(mundo):
    nuevo, estado, _ = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto"); await gm.recibir("estado")
    await ana.entrar("Ana"); await ana.recibir("estado")
    await ana.enviar(tipo="crear_personaje", base="guerrero", nombre="Thor")
    pid = (await ana.recibir("personajes"))["creado"]
    await ana.enviar(tipo="elegir_personaje", personaje=pid)
    assert (await ana.recibir("personaje_activo"))["token"] is None      # elegir no despliega
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    tid = (await ana.recibir("personaje_activo"))["token"]
    await gm.enviar(tipo="gm_colocar_enemigo", enemigo="goblin", x=3, y=5)
    for _ in range(50):
        if len(estado.tokens) == 2:
            break
        await asyncio.sleep(0.02)
    gid = next(t for t in estado.tokens if t != tid)
    estado.tokens[gid]["recursos"]["HP"]["actual"] = 1
    await gm.enviar(tipo="gm_iniciar_combate")
    await gm.enviar(tipo="gm_empezar_combate")
    for _ in range(50):
        if estado.combate["activo"]:
            break
        await asyncio.sleep(0.02)
    estado.combate["indice"] = estado.combate["orden"].index(tid)   # forzamos que sea su turno
    estado.datos_de(estado.tokens[tid])["stats"]["Fuerza"] = 99      # ataque letal
    await ana.enviar(tipo="usar_habilidad", token=tid, habilidad="ataque_basico", objetivo=gid)
    ultimo = None
    for _ in range(40):
        m = await ana.recibir()
        if m["tipo"] == "chat" and "derrotado" in m["texto"]:
            ultimo = m
            break
    assert ultimo is not None
    assert estado.derrotado(estado.tokens[gid])


async def _gm_y_ana(mundo):
    nuevo, estado, srv = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    await ana.entrar("Ana")
    await ana.recibir("estado")
    await ana.enviar(tipo="crear_personaje", base="guerrero", nombre="Thor")
    pid = (await ana.recibir("personajes"))["creado"]
    await ana.enviar(tipo="elegir_personaje", personaje=pid)
    assert (await ana.recibir("personaje_activo"))["token"] is None      # elegir no despliega
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    tid = (await ana.recibir("personaje_activo"))["token"]
    await ana.recibir("estado")
    await gm.recibir("tokens")
    return gm, ana, tid, estado


async def test_gm_edita_estadisticas_y_vida_de_cualquier_token(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await gm.enviar(tipo="gm_editar_token", token=tid, nombre="Thor el Grande",
                    stats={"Fuerza": 20}, recursos={"HP": {"actual": 30, "max": 120}})
    t = (await ana.recibir("tokens"))["tokens"][0]
    assert t["nombre"] == "Thor el Grande" and t["stats_base"]["Fuerza"] == 20
    assert t["stats"]["Fuerza"] == 21                      # +1 de la clase Guerrero
    assert t["recursos"]["HP"] == {"actual": 30, "max": 120}
    assert estado.personajes["Ana"][0]["nombre"] == "Thor el Grande"      # se guardó en el personaje


async def test_gm_edicion_invalida_no_cambia_nada(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    antes = estado.personajes["Ana"][0]["stats"]["Fuerza"]
    for datos in ({"stats": {"Fuerza": 99999}}, {"stats": {"Suerte": 1}}, {"stats": {"Fuerza": "x"}},
                  {"recursos": {"HP": {"actual": 500, "max": 10}}}, {"recursos": {"HP": {"max": 0}}},
                  {"nombre": "  "}):
        await gm.enviar(tipo="gm_editar_token", token=tid, **datos)
        await gm.recibir("error")
    assert estado.personajes["Ana"][0]["stats"]["Fuerza"] == antes


async def test_un_jugador_no_puede_editar_tokens_ni_objetos(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await ana.enviar(tipo="gm_editar_token", token=tid, stats={"Fuerza": 999})
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await ana.enviar(tipo="gm_objeto", token=tid, objeto="pocion", cantidad=50)
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"


async def test_gm_da_y_quita_objetos(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await gm.enviar(tipo="gm_objeto", token=tid, objeto="eter", cantidad=3)
    inv = (await ana.recibir("tokens"))["tokens"][0]["inventario"]
    assert any(e["objeto"] == "eter" and e["cantidad"] >= 3 for e in inv)
    await gm.enviar(tipo="gm_objeto", token=tid, objeto="eter", cantidad=-999)      # quitar de más = vaciar
    inv = (await ana.recibir("tokens"))["tokens"][0]["inventario"]
    assert not any(e["objeto"] == "eter" for e in inv)
    await gm.enviar(tipo="gm_objeto", token=tid, objeto="eter", cantidad=-1)        # ya no tiene ninguno
    await gm.recibir("error")
    await gm.enviar(tipo="gm_objeto", token=tid, objeto="inexistente", cantidad=1)
    await gm.recibir("error")


async def test_el_jugador_retira_y_despliega_su_personaje(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    pid = estado.personajes["Ana"][0]["id"]
    await ana.enviar(tipo="retirar_personaje", token=tid)
    t = await ana.recibir("tokens")
    assert t["quitados"] == [tid] and estado.tokens == {}
    assert len(estado.personajes["Ana"]) == 1                     # el personaje se conserva
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    nuevo = (await ana.recibir("tokens"))["tokens"][0]
    assert nuevo["nombre"] == "Thor"
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    assert "ya está en el mapa" in (await ana.recibir("error"))["texto"]


async def test_no_se_puede_retirar_en_combate_ni_el_de_otro(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    await gm.enviar(tipo="gm_colocar_enemigo", enemigo="goblin", x=4, y=5)
    await gm.enviar(tipo="gm_iniciar_combate")
    await gm.enviar(tipo="gm_empezar_combate")
    await ana.recibir("combate")
    await ana.enviar(tipo="retirar_personaje", token=tid)
    assert "durante un combate" in (await ana.recibir("error"))["texto"]
    otro = await mundo[0]()
    await otro.entrar("Beto")
    await otro.enviar(tipo="retirar_personaje", token=tid)
    assert "Solo puedes retirar tus propios" in (await otro.recibir("error"))["texto"]


async def test_el_gm_lista_y_despliega_personajes_de_cualquiera(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    pid = estado.personajes["Ana"][0]["id"]
    await gm.enviar(tipo="gm_listar_personajes")
    lista = (await gm.recibir("todos_los_personajes"))["personajes"]
    assert lista == [{"usuario": "Ana", "id": pid, "nombre": "Thor", "imagen": lista[0]["imagen"], "desplegado": True, "sala": "aldea", "nivel": 1}]
    await gm.enviar(tipo="gm_quitar_token", token=tid)               # el GM lo retira
    await gm.recibir("tokens")
    await gm.enviar(tipo="desplegar_personaje", personaje=pid, usuario="Ana", x=6, y=4)
    t = (await gm.recibir("tokens"))["tokens"][0]
    assert (t["x"], t["y"]) == (6, 4)
    await gm.enviar(tipo="gm_listar_personajes")
    assert (await gm.recibir("todos_los_personajes"))["personajes"][0]["desplegado"] is True


async def test_un_jugador_no_puede_desplegar_ajenos_ni_elegir_casilla(mundo):
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    pid = estado.personajes["Ana"][0]["id"]
    await ana.enviar(tipo="retirar_personaje", token=tid)
    await ana.recibir("tokens")
    estado.cfg["permisos"]["desplegar_en_casilla"] = False             # la mesa no deja elegir casilla
    await ana.enviar(tipo="desplegar_personaje", personaje=pid, x=3, y=3)
    assert "Solo el GM puede elegir la casilla" in (await ana.recibir("error"))["texto"]
    estado.cfg["permisos"]["desplegar_en_casilla"] = True
    await ana.enviar(tipo="desplegar_personaje", personaje=pid, x=3, y=3)  # por defecto, sí
    tok = next(t for t in (await ana.recibir("tokens"))["tokens"] if t["personaje"] == pid)
    assert (tok["x"], tok["y"]) == (3, 3)
    await ana.enviar(tipo="gm_listar_personajes")
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    beto = await mundo[0]()
    await beto.entrar("Beto")
    await beto.enviar(tipo="desplegar_personaje", personaje=pid, usuario="Ana")
    assert "Solo puedes desplegar tus propios" in (await beto.recibir("error"))["texto"]


async def test_crear_con_raza_y_efectos_se_difunden_por_el_servidor(mundo):
    nuevo, estado, srv = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    b = await ana.entrar("Ana")
    assert {"raza", "clase"} <= set(b["catalogo"]["grupos"]) and "veneno" in b["catalogo"]["estados"]
    assert "efectos" not in b["catalogo"]["rasgos"]["toque_venenoso"]           # los efectos internos no se envían
    await ana.recibir("estado")
    await ana.enviar(tipo="crear_personaje", base="guerrero", nombre="Grok", elecciones={"raza": "orco", "clase": "guerrero"})
    pid = (await ana.recibir("personajes"))["creado"]
    await ana.enviar(tipo="elegir_personaje", personaje=pid)
    assert (await ana.recibir("personaje_activo"))["token"] is None      # elegir no despliega
    await ana.enviar(tipo="desplegar_personaje", personaje=pid)
    tid = (await ana.recibir("personaje_activo"))["token"]
    await ana.recibir("estado")
    await gm.enviar(tipo="gm_colocar_enemigo", enemigo="goblin", x=4, y=5)
    estado.cat.habilidades["ataque_basico"]["alcance"] = 99
    gid = next(t["id"] for t in (await ana.recibir("tokens"))["tokens"] if t["tipo"] == "enemigo")
    await ana.enviar(tipo="usar_habilidad", token=tid, habilidad="ataque_basico", objetivo=gid)
    while True:
        m = await gm.recibir("tokens")
        gob = next((t for t in m["tokens"] if t["id"] == gid and t["estados"]), None)
        if gob:
            break
    assert gob["estados"] == [{"id": "veneno", "turnos": 4}]
    textos = []
    try:
        while True:
            textos.append((await gm.chat_de("Sistema", timeout=0.5))["texto"])
    except asyncio.TimeoutError:
        pass
    assert any("sufre «Veneno»" in t for t in textos)

    await ana.enviar(tipo="tirar_estadistica", token=tid, estadistica="Fuerza")
    m_gm = await gm.chat_de("Ana")
    assert "+ 2 (rasgos)" in m_gm["detalle"] and "+ 2" not in m_gm["texto"]     # el GM ve el detalle aparte
    m_ana = await ana.chat_de("Ana")
    assert "detalle" not in m_ana and m_ana["texto"] == m_gm["texto"]            # el jugador, solo el resultado (por defecto)


async def test_tiles_por_la_red(mundo):
    """Esconderse en hierba alta, romper una barricada y pisar brasas, vistos desde dos clientes."""
    nuevo, estado, _ = mundo
    estado.cfg["permisos"]["romper_casillas"] = "todos"
    gm, ana, bruno = await nuevo(), await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    b = await ana.entrar("Ana")
    assert "tiles" in b["catalogo"] and b["catalogo"]["tiles"]["hierba_alta"]["esconde"] is True
    assert "efectos" not in b["catalogo"]["tiles"]["brasas"] and b["permisos"]["romper_casillas"] is True
    await ana.recibir("estado")
    await bruno.entrar("Bruno")
    await bruno.recibir("estado")

    async def desplegar(c, base, nombre):
        await c.enviar(tipo="crear_personaje", base=base, nombre=nombre)
        pid = (await c.recibir("personajes"))["creado"]
        await c.enviar(tipo="elegir_personaje", personaje=pid)
        await c.recibir("personaje_activo")
        await c.enviar(tipo="desplegar_personaje", personaje=pid)
        return (await c.recibir("personaje_activo"))["token"]
    tana = await desplegar(ana, "guerrero", "Thor")
    tbru = await desplegar(bruno, "mago", "Elara")
    await ana.recibir("estado")

    # Ana se mete en la hierba alta: Bruno deja de verla; el GM y ella, no
    estado.tokens[tana]["x"], estado.tokens[tana]["y"] = 13, 2
    await ana.enviar(tipo="mover_token", token=tana, x=14, y=2)
    while True:
        m = await bruno.recibir("tokens")
        if tana in m["quitados"]:
            break
    assert all(t["id"] != tana for t in m["tokens"])
    while True:
        m = await ana.recibir("tokens")
        if any(t["id"] == tana for t in m["tokens"]):
            break
    assert tana not in m["quitados"]

    # Ana sale a la barricada y la golpea 3 veces: la casilla cambia para todos
    estado.tokens[tana]["x"], estado.tokens[tana]["y"] = 4, 6
    for _ in range(3):
        await ana.enviar(tipo="golpear_casilla", token=tana, x=5, y=6)
    while True:
        m = await bruno.recibir("casilla")
        if m["tile"] == "hierba":
            break
    assert (m["x"], m["y"]) == (5, 6)
    assert estado.casilla_transitable(5, 6)

    # Un jugador no puede romper de golpe, ni golpear lejos
    await bruno.enviar(tipo="golpear_casilla", token=tbru, x=14, y=2)
    assert "no se puede romper" in (await bruno.recibir("error"))["texto"]


async def test_el_gm_ve_quien_esta_conectado(mundo):
    nuevo, _, _ = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto"); await gm.recibir("estado")
    m = await gm.recibir("conectados")
    assert [u["usuario"] for u in m["usuarios"]] == ["Master"]
    await ana.entrar("Ana"); await ana.recibir("estado")
    m = await gm.recibir("conectados")
    assert [u["usuario"] for u in m["usuarios"]] == ["Master", "Ana"] and m["mapa"] == "aldea"
    await ana.ws.close()
    m = await gm.recibir("conectados")
    assert [u["usuario"] for u in m["usuarios"]] == ["Master"]


async def test_limite_de_ataque_propio_de_un_jugador(mundo, catalogo):
    nuevo, estado, srv = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    b = await ana.entrar("Ana")
    assert b["permisos"]["modo_ataque"] == "enemigos_y_neutros" and b["catalogo"]["reglas"]["atacar"] == "enemigos_y_neutros"
    srv.cuentas.datos["Bruno"] = {"hash": "", "creada": 0, "ataque": "nadie"}      # lo que escribe el Editor en «Jugadores y fichas»
    b2 = await (await nuevo()).entrar("Bruno")
    assert b2["permisos"]["modo_ataque"] == "nadie"


async def test_gm_revela_datos_a_otros_y_un_jugador_no_puede(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    beto = await nuevo()
    await beto.entrar("Beto")
    est = await beto.recibir("estado")
    ana_tok = next(t for t in est["tokens"] if t["id"] == tid)
    assert "inventario" not in ana_tok and set(ana_tok["recursos"]) == {"HP"}
    await beto.enviar(tipo="gm_revelar", token=tid, campos=["inventario"])
    assert (await beto.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_revelar", token=tid, campos=["inventario", "recursos"])
    t = (await beto.recibir("tokens"))["tokens"][0]
    assert "inventario" in t and len(t["recursos"]) > 1
    assert estado.tokens[tid]["revelado"] == ["recursos", "inventario"]


async def test_edicion_bloqueada_por_cuenta(mundo):
    nuevo, estado, srv = mundo
    ana = await nuevo()
    await ana.entrar("Ana")
    await ana.recibir("estado")
    srv.cuentas.datos["Ana"]["editar"] = False
    await ana.enviar(tipo="crear_personaje", base="guerrero", nombre="Thor")
    assert "bloqueado la edición" in (await ana.recibir("error"))["texto"]


async def test_la_regla_la_ven_los_demas_y_no_se_guarda(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    await ana.enviar(tipo="regla", puntos=[[2, 5], [4, 5], [6, 7]])
    m = await gm.recibir("regla")
    assert m["usuario"] == "Ana" and m["puntos"] == [[2, 5], [4, 5], [6, 7]]
    await ana.enviar(tipo="regla", puntos=None)
    assert (await gm.recibir("regla"))["puntos"] is None
    await asyncio.sleep(0.06)                          # la regla admite unos 25 mensajes por segundo y jugador
    await ana.enviar(tipo="regla", puntos=[[999, 5]])
    assert "fuera del mapa" in (await ana.recibir("error"))["texto"]
    await asyncio.sleep(0.06)
    await ana.enviar(tipo="regla", puntos="hola")
    assert (await ana.recibir("error"))["texto"] == "Trazo no válido"


async def test_dibujos_temporales_bloqueo_y_borrado(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    await ana.enviar(tipo="dibujar", color="#c4533f", puntos=[[1.5, 2.5], [3, 4]])
    d = (await gm.recibir("dibujo"))["dibujo"]
    assert d["usuario"] == "Ana" and d["color"] == "#c4533f"
    await ana.enviar(tipo="dibujar", color="rojo<script>", puntos=[[1, 1]])
    assert (await gm.recibir("dibujo"))["dibujo"]["color"] == "#f0b44c"            # un color raro cae al de por defecto
    await ana.enviar(tipo="gm_bloquear_dibujo", activo=True)
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_bloquear_dibujo", activo=True)
    assert (await ana.recibir("dibujo_bloqueo"))["activo"] is True
    await ana.enviar(tipo="dibujar", puntos=[[1, 1]])
    assert "bloqueado" in (await ana.recibir("error"))["texto"]
    await gm.enviar(tipo="dibujar", puntos=[[2, 2]])                                # el GM puede aunque esté bloqueado
    gid = (await ana.recibir("dibujo"))["dibujo"]["id"]
    await ana.enviar(tipo="borrar_dibujo", ids=[gid])                               # no puede borrar el del GM
    await ana.enviar(tipo="gm_borrar_dibujos", usuario="Ana")
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_borrar_dibujos")
    assert (await gm.recibir("dibujos_borrados"))["ids"]
    assert estado.dibujos == []
    # un jugador nuevo recibe los dibujos vigentes al entrar
    await gm.enviar(tipo="dibujar", puntos=[[3, 3]])
    beto = await nuevo()
    await beto.entrar("Beto")
    est = await beto.recibir("estado")
    assert len(est["dibujos"]) == 1 and est["dibujo_bloqueado"] is True


async def _hasta(cli, tipo, cond):
    """Siguiente mensaje de ese tipo que cumpla la condición (descarta los anteriores)."""
    while True:
        m = await cli.recibir(tipo)
        if cond(m):
            return m


async def test_salas_de_chat_privadas(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    beto = await nuevo()
    await beto.entrar("Beto")
    await beto.recibir("estado")
    await ana.enviar(tipo="gm_sala_crear", nombre="Secreta", miembros=["Ana"])
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_sala_crear", nombre="Secreta", miembros=["Ana"])
    s_gm = await _hasta(gm, "salas", lambda m: m["salas"])
    sala = (await gm.recibir("sala_creada"))["sala"]
    assert s_gm["salas"][0]["nombre"] == "Secreta" and "Beto" in s_gm["usuarios"]
    assert [x["id"] for x in (await _hasta(ana, "salas", lambda m: m["salas"]))["salas"]] == [sala]
    await ana.enviar(tipo="chat", texto="psst", sala=sala)
    m = await _hasta(ana, "chat", lambda m: m["texto"] == "psst")
    assert m["sala"] == sala
    assert (await _hasta(gm, "chat", lambda m: m["texto"] == "psst"))["sala"] == sala        # el GM lo ve todo
    await beto.enviar(tipo="chat", texto="intruso", sala=sala)
    assert (await beto.recibir("error"))["texto"] == "No puedes escribir en esa sala"
    await ana.enviar(tipo="chat", texto="hola a todos")
    assert (await beto.chat_de("Ana"))["texto"] == "hola a todos"
    assert not any(x.get("sala") == sala for x in beto.mensajes if x["tipo"] == "chat")      # nunca le llegó nada de la sala
    cleo = await nuevo()
    await cleo.entrar("Cleo")
    assert all(x.get("sala") != sala for x in (await cleo.recibir("estado"))["chat"])         # ni siquiera en el historial
    await gm.enviar(tipo="gm_sala_editar", sala=sala, miembros=["Ana", "Beto"])
    assert [x["id"] for x in (await _hasta(beto, "salas", lambda m: m["salas"]))["salas"]] == [sala]
    await gm.enviar(tipo="gm_sala_borrar", sala=sala)
    assert (await ana.recibir("chat_sala_borrada"))["sala"] == sala
    assert estado.salas_chat == {} and not any(m.get("sala") for m in estado.chat)


async def test_jugador_lanza_sonido_de_su_personaje_si_se_permite(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    await gm.enviar(tipo="gm_sonidos_token", token=tid, sonidos=["espada.wav"])
    await ana.recibir("tokens")
    await ana.enviar(tipo="sonido_personaje", token=tid, archivo="espada.wav")
    assert "no pueden lanzar" in (await ana.recibir("error"))["texto"]            # la mesa no lo permite todavía
    estado.cfg["permisos"]["sonidos_personaje"] = True
    await ana.enviar(tipo="sonido_personaje", token=tid, archivo="espada.wav")
    assert (await gm.recibir("efecto"))["archivo"] == "espada.wav"
    await ana.enviar(tipo="sonido_personaje", token=tid, archivo="espada.wav")
    assert "Espera" in (await ana.recibir("error"))["texto"]                      # no se ametralla


async def _jugador_con_personaje(nuevo, nombre, personaje):
    c = await nuevo()
    await c.entrar(nombre)
    await c.recibir("estado")
    await c.enviar(tipo="crear_personaje", base="guerrero", nombre=personaje)
    pid = (await c.recibir("personajes"))["creado"]
    await c.enviar(tipo="elegir_personaje", personaje=pid)
    await c.recibir("personaje_activo")
    return c


async def test_tienda_del_gm_compra_y_stock(mundo):
    nuevo, estado, srv = mundo
    gm = await nuevo(); await gm.entrar("Master", password_gm="secreto")
    ana = await _jugador_con_personaje(nuevo, "Ana", "Thor")
    await ana.enviar(tipo="comprar", tienda="tienda_aldea", objeto="pocion", cantidad=1)
    assert "no está abierta" in (await ana.recibir("error"))["texto"]
    await ana.enviar(tipo="gm_tienda_abrir", tienda="tienda_aldea", abierta=True)
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_tienda_abrir", tienda="tienda_aldea", abierta=True)
    t = await _hasta(ana, "tiendas", lambda m: m["tiendas"])
    assert t["tiendas"][0]["articulos"][0] == {"objeto": "pocion", "precio": 25, "stock": 10}
    await ana.enviar(tipo="comprar", tienda="tienda_aldea", objeto="pocion", cantidad=2)
    t = await _hasta(ana, "tiendas", lambda m: m["tiendas"][0]["articulos"][0]["stock"] == 8)
    p = estado.personajes_de("Ana")[0]
    assert p["dinero"] == 150 - 50
    await ana.enviar(tipo="comprar", tienda="tienda_aldea", objeto="pocion", cantidad=5)        # 125 > 100
    assert "dinero suficiente" in (await _hasta(ana, "error", lambda m: True))["texto"]


async def test_intercambio_entre_dos_jugadores_por_websocket(mundo):
    nuevo, estado, srv = mundo
    gm = await nuevo(); await gm.entrar("Master", password_gm="secreto")
    ana = await _jugador_con_personaje(nuevo, "Ana", "Thor")
    beto = await _jugador_con_personaje(nuevo, "Beto", "Odin")
    await ana.enviar(tipo="intercambio_proponer", con="Beto")
    x = await _hasta(beto, "intercambio", lambda m: True)
    assert {p["usuario"] for p in x["partes"]} == {"Ana", "Beto"}
    await ana.enviar(tipo="intercambio_ofrecer", items={}, dinero=40)
    await _hasta(beto, "intercambio", lambda m: m["partes"][0]["dinero"] == 40)
    await beto.enviar(tipo="intercambio_aceptar", acepto=True)
    await ana.enviar(tipo="intercambio_aceptar", acepto=True)
    assert (await _hasta(beto, "intercambio_fin", lambda m: True))["motivo"] == "completado"
    assert estado.personajes_de("Ana")[0]["dinero"] == 110 and estado.personajes_de("Beto")[0]["dinero"] == 190
    await ana.enviar(tipo="intercambio_proponer", con="Master")
    assert "no está conectada" in (await _hasta(ana, "error", lambda m: True))["texto"]
    await ana.enviar(tipo="intercambio_proponer", con="Beto")
    await _hasta(beto, "intercambio", lambda m: True)
    await beto.enviar(tipo="intercambio_cancelar")
    assert (await _hasta(ana, "intercambio_fin", lambda m: m["motivo"] == "cancelado"))["por"] == "Beto"


async def test_anotaciones_propias_por_websocket(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    pid = estado.tokens[tid]["personaje_id"]
    await ana.enviar(tipo="editar_propias", personaje=pid, que="habilidades", lista=[{"nombre": "Silbido"}])
    assert "solo el GM" in (await ana.recibir("error"))["texto"]
    estado.cfg["permisos"]["habilidades_propias"] = True
    await ana.enviar(tipo="editar_propias", personaje=pid, que="habilidades", lista=[{"nombre": "Silbido", "descripcion": "Llama al perro"}])
    ps = (await ana.recibir("personajes"))["personajes"]
    assert ps[0]["propias"]["habilidades"][0]["nombre"] == "Silbido"


async def test_ping_en_casilla(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    await ana.enviar(tipo="ping", x=3, y=2)
    m = await gm.recibir("ping")
    assert (m["x"], m["y"], m["usuario"]) == (3, 2, "Ana")
    await ana.recibir("ping")                                       # también lo ve quien señala
    await ana.enviar(tipo="ping", x=99, y=2)
    await asyncio.sleep(1.05)
    await ana.enviar(tipo="ping", x=99, y=2)
    assert "no válida" in (await ana.recibir("error"))["texto"]
    estado.cfg["permisos"]["ping"] = False
    await asyncio.sleep(1.05)
    await ana.enviar(tipo="ping", x=1, y=1)
    assert "no pueden" in (await ana.recibir("error"))["texto"]


async def test_niebla_oculta_y_revela_tokens_al_moverse(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    estado.cfg["juego"]["niebla"].update(activa=True, vision_base=3, compartir=True)
    estado.tokens[tid]["x"], estado.tokens[tid]["y"] = 2, 5
    await ana.enviar(tipo="pedir_estado")
    snap = await ana.recibir("estado")
    assert snap["niebla"] is not None and snap["niebla"][5][2] == "1" and snap["niebla"][5][9] == "0"
    await gm.enviar(tipo="gm_colocar_enemigo", enemigo="goblin", x=2, y=8)       # a 3 casillas: se ve
    await gm.enviar(tipo="gm_colocar_enemigo", enemigo="goblin", x=10, y=9)      # lejos: no
    m = await ana.recibir("tokens")
    assert [t["nombre"] for t in m["tokens"]] == ["Goblin"]
    lejano = [t for t in estado.tokens.values() if t["tipo"] == "enemigo" and t["x"] == 10][0]["id"]
    assert lejano not in {t["id"] for t in m["tokens"]}
    await ana.enviar(tipo="mover_token", token=tid, x=2, y=7)
    while True:
        m = await ana.recibir("tokens")
        if m["tokens"]:
            break
    mask = (await ana.recibir("niebla"))["mascara"]
    assert mask[9][2] == "1"                                                    # ahora ve más al sur
    assert all(t["id"] != lejano for t in m["tokens"])
    # el GM no tiene niebla
    await gm.enviar(tipo="pedir_estado")
    assert (await gm.recibir("estado"))["niebla"] is None
    # …salvo que pida verla (solo en su pantalla): la del grupo o la de un jugador
    await gm.enviar(tipo="gm_ver_niebla", como="*")
    m = await gm.recibir("niebla")
    assert m["como"] == "*" and m["mascara"][9][2] == "1" and m["mascara"][5][12] == "0"
    await gm.enviar(tipo="gm_ver_niebla", como="Nadie")
    assert "token" in (await gm.recibir("error"))["texto"]
    await gm.enviar(tipo="gm_ver_niebla", como="Ana")
    assert (await gm.recibir("niebla"))["mascara"] == mask
    await gm.enviar(tipo="pedir_estado")
    e = await gm.recibir("estado")
    assert e["niebla_gm"] == "Ana" and e["niebla"] == mask
    await ana.enviar(tipo="gm_ver_niebla", como="*")
    assert (await ana.recibir("error"))
    await gm.enviar(tipo="gm_ver_niebla", como=None)
    assert (await gm.recibir("niebla"))["mascara"] is None


async def test_al_cambiar_de_dia_a_noche_se_reenvian_los_tokens(mundo):
    # Un bono «solo de noche» cambia las estadísticas que ven los jugadores sin que nadie se mueva.
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    estado.cat.rasgos["prueba"] = {"nombre": "Prueba", "descripcion": "", "efectos": [{
        "cuando": {"tipo": "siempre"}, "si": [{"tipo": "momento_dia", "periodo": "Noche"}],
        "hacer": {"tipo": "bono_estadistica", "estadistica": "Fuerza", "valor": 3}}]}
    estado.cat.opciones["guerrero"]["rasgos"] = ["prueba"]
    await gm.enviar(tipo="gm_periodo", indice=1)
    assert (await ana.recibir("periodo"))["indice"] == 1
    t = next(x for x in (await ana.recibir("tokens"))["tokens"] if x["id"] == tid)
    assert t["stats"]["Fuerza"] == t["stats_base"]["Fuerza"] + 1 + 3


async def test_el_gm_limpia_el_chat_para_todos(mundo):
    nuevo, estado, srv = mundo
    gm, ana, tid, _ = await _gm_y_ana(mundo)
    await ana.enviar(tipo="chat", texto="un mensaje viejo")
    await _hasta(gm, "chat", lambda m: m["texto"] == "un mensaje viejo")
    await ana.enviar(tipo="gm_limpiar_chat")
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_limpiar_chat", sala="general")
    assert (await ana.recibir("chat_sala_borrada"))["sala"] == "general"              # cada cliente vacía su chat
    assert "limpió el chat" in (await _hasta(ana, "chat", lambda m: "limpió" in m["texto"]))["texto"]
    assert [m["texto"] for m in estado.chat] == ["🧹 El GM limpió el chat."]
    await gm.enviar(tipo="gm_limpiar_chat", sala="no-existe")
    assert (await gm.recibir("error"))["texto"] == "Esa sala no existe"
