"""Habilidades de solo efecto (y alternar), estados que impiden y que pasan a otro, defensa activa, críticos, opciones no elegibles,
estadísticas dadas desde Reglas, grupos que se mueven juntos, modo lento y chat de solo registro."""
import asyncio
import json
import random
import shutil

import pytest
import yaml
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from mesa.servidor import Servidor
from tests.conftest import CONFIG
from tests.test_habilidades_area import hab, partida, vida  # noqa: F401  (partida es una fixture)


def estado_nuevo(partida, eid, **extra):
    partida.cat.estados[eid] = {"nombre": eid.capitalize(), "descripcion": "", "imagen": "", "color": "", "duracion": 0,
                                "etiquetas": [], "impide": [], "al_terminar": "", "efectos": [], **extra}


def test_habilidad_de_solo_efecto_que_se_alterna(partida):
    estado_nuevo(partida, "canalizando", impide=["atacar"])
    hab(partida, tipo="efecto", objetivo="uno_mismo", formula="", aplica_estado="canalizando", alternar=True)
    texto, _ = partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False)
    assert any(e["id"] == "canalizando" for e in partida.yo["estados"]) and "Canalizando" in texto
    # mientras dura, no puede atacar
    partida.datos_de(partida.yo)["habilidades"].append("ataque_basico")
    g = partida.colocar_enemigo("goblin", 2, 10)
    with pytest.raises(ErrorJuego, match="no le deja atacar"):
        partida.usar_habilidad(partida.yo["id"], "ataque_basico", g["id"], "Ana", False)
    partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False)       # se desactiva
    assert not any(e["id"] == "canalizando" for e in partida.yo["estados"])
    partida.usar_habilidad(partida.yo["id"], "ataque_basico", g["id"], "Ana", False)


def test_estados_que_impiden_moverse_y_objetos(partida):
    estado_nuevo(partida, "paralizado", impide=["mover", "objetos"])
    partida.yo.setdefault("estados", []).append({"id": "paralizado", "turnos": 0})
    with pytest.raises(ErrorJuego, match="moverse"):
        partida.mover_token(partida.yo["id"], 2, 10, "Ana", False)
    obj = next(iter(partida.cat.objetos))
    partida.datos_de(partida.yo)["inventario"].append({"objeto": obj, "cantidad": 1})
    with pytest.raises(ErrorJuego, match="objetos"):
        partida.usar_objeto(partida.yo["id"], obj, "Ana", False)
    partida.mover_token(partida.yo["id"], 2, 10, "GM", True)                   # el GM sí


def test_estado_que_pasa_a_otro_al_terminar(partida):
    estado_nuevo(partida, "grave", duracion=2)
    estado_nuevo(partida, "leve", duracion=1, al_terminar="grave")
    partida.yo.setdefault("estados", []).append({"id": "leve", "turnos": 1})
    partida.al_terminar_turno(partida.yo)
    assert [e["id"] for e in partida.yo["estados"]] == ["grave"]


def test_defensa_activa(partida):
    hab(partida, alcance=5, formula="20")
    g = partida.colocar_enemigo("goblin", 3, 10)
    partida.cat.enemigos["goblin"]["efectos"] = []
    rasgo = {"nombre": "Escudo", "descripcion": "", "imagen": "", "efectos": [
        {"cuando": {"tipo": "al_ser_atacado"}, "hacer": {"tipo": "reducir_dano", "valor": 50, "unidad": "porcentaje"}},
        {"cuando": {"tipo": "al_ser_atacado"}, "hacer": {"tipo": "devolver_dano", "valor": 100}}]}
    partida.cat.rasgos["escudo"] = rasgo
    partida.rasgos_de = (lambda orig: (lambda d: ["escudo"] if d is partida.datos_de(g) else orig(d)))(partida.rasgos_de)
    v0, yo0 = vida(partida, g), vida(partida, partida.yo)
    texto, _ = partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert vida(partida, g) == v0 - 10 and vida(partida, partida.yo) == yo0 - 10 and "Escudo" in texto
    rasgo["efectos"] = [{"cuando": {"tipo": "al_ser_atacado"}, "hacer": {"tipo": "anular_ataque"}}]
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert vida(partida, g) == v0 - 10


def test_critico_nativo(partida):
    hab(partida, alcance=5, formula="10", critico={"desde": 1, "multiplicador": 3})
    g = partida.colocar_enemigo("goblin", 3, 10)
    v0 = vida(partida, g)
    texto, _ = partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert vida(partida, g) == v0 - 30 and "¡Crítico!" in texto


def _campana(tmp_path, cambiar):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    cambiar(d)
    return recursos.cargar(d)


def test_validacion_de_los_campos_nuevos(tmp_path):
    def cambiar(d):
        h = yaml.safe_load((d / "abilities/ataque_basico.yaml").read_text(encoding="utf-8"))
        h.update({"tipo": "efecto", "formula": "", "aplica_estado": "no_existe", "critico": {"desde": 25}})
        (d / "abilities/ataque_basico.yaml").write_text(yaml.safe_dump(h, allow_unicode=True), encoding="utf-8")
        e = yaml.safe_load((d / "states/veneno.yaml").read_text(encoding="utf-8"))
        e.update({"impide": ["volar"], "al_terminar": "veneno"})
        (d / "states/veneno.yaml").write_text(yaml.safe_dump(e, allow_unicode=True), encoding="utf-8")
    errores = " ".join(_campana(tmp_path, cambiar)[1].errores)
    assert "no_existe" in errores and "desde" in errores and "volar" in errores and "al_terminar" in errores


def test_estadistica_dada_desde_reglas_y_opcion_no_elegible(tmp_path):
    def cambiar(d):
        cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
        cfg["juego"]["estadisticas"].append({"nombre": "Maná", "valor_inicial": 7, "minimo": 0, "maximo": 99, "para_todos": False, "solo_para": ["mago"]})
        (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
        o = yaml.safe_load((d / "options/berserker.yaml").read_text(encoding="utf-8"))
        o["elegible"] = False
        (d / "options/berserker.yaml").write_text(yaml.safe_dump(o, allow_unicode=True), encoding="utf-8")
    cat, inf = _campana(tmp_path, cambiar)
    assert inf.ok, inf.errores
    e = EstadoPartida(cat, tmp_path / "datos", persistir=False)
    e.registrar_usuario("Ana")
    raza = next(g for g in cat.grupos if g != cat.opciones["mago"]["grupo"])
    el = {raza: cat.opciones_de(raza)[0], cat.opciones["mago"]["grupo"]: "mago"}
    el = {g: o for g, o in el.items() if e.grupo_activo(g, el)}
    p = e.crear_personaje("Ana", False, None, "Merlín", elecciones=el)
    assert p["stats"]["Maná"] == 7
    el2 = {raza: el[raza], cat.opciones["berserker"]["grupo"]: "berserker"}
    with pytest.raises(ErrorJuego, match="no se puede elegir"):
        e.crear_personaje("Ana", False, None, "Brutus", elecciones=el2)
    e.cfg["permisos"]["max_personajes_por_jugador"] = 5
    e.crear_personaje("Ana", True, None, "Brutus", elecciones=el2)   # el GM sí


def test_el_grupo_se_mueve_junto_lo_mueva_quien_lo_mueva(partida):
    g = partida.colocar_enemigo("goblin", 2, 10)
    partida.agrupar_tokens([partida.yo["id"], g["id"]], "GM", True)
    partida.mover_token(partida.yo["id"], 3, 9, "Ana", False)                 # Ana no controla al goblin, pero va con el grupo
    assert (g["x"], g["y"]) == (4, 9)


async def test_chat_registro_y_modo_lento(catalogo, tmp_path):
    catalogo.config["juego"]["chat"] = {"modo": "registro", "espera_chat": 0, "espera_tiradas": 60}
    srv = Servidor(catalogo, EstadoPartida(catalogo, tmp_path, rng=random.Random(1)))
    async with serve(srv.handler, "127.0.0.1", 0) as s:
        ws = await connect(f"ws://127.0.0.1:{s.sockets[0].getsockname()[1]}")

        async def recibir(tipo):
            while True:
                m = json.loads(await asyncio.wait_for(ws.recv(), 2))
                if m["tipo"] == tipo:
                    return m
        await ws.send(json.dumps({"tipo": "entrar", "usuario": "Ana"}))
        assert (await recibir("bienvenida"))["catalogo"]["chat"]["modo"] == "registro"
        await ws.send(json.dumps({"tipo": "chat", "texto": "hola"}))
        assert "registro" in (await recibir("error"))["texto"]
        await ws.send(json.dumps({"tipo": "chat", "texto": "/r 1d6"}))
        await recibir("chat")
        await ws.send(json.dumps({"tipo": "chat", "texto": "/r 1d6"}))
        assert "Modo lento" in (await recibir("error"))["texto"]
        await ws.close()


def test_modos_de_decidir_los_turnos(partida):
    g = partida.colocar_enemigo("goblin", 3, 10)
    # «estadistica»: el NPC tira solo; el jugador tira la de su personaje y entonces empieza
    texto = partida.iniciar_combate()
    assert "Decidiendo" in texto and not partida.combate["activo"] and partida.faltan_iniciativas() == [partida.yo["id"]]
    with pytest.raises(ErrorJuego):
        partida.tirar_iniciativa(g["id"], "Ana", False)                  # no es suyo
    partida.tirar_iniciativa(partida.yo["id"], "Ana", False)
    assert partida.faltan_iniciativas() == []
    partida.empezar_tras_tiradas()
    assert partida.combate["activo"] and set(partida.combate["orden"]) == {partida.yo["id"], g["id"]}
    partida.terminar_combate()
    # «preguntar»: el GM elige al iniciar; «valor» = de mayor a menor, sin dado
    partida.cfg["juego"]["iniciativa"] = "preguntar"
    partida.cfg["juego"]["iniciativa_opciones"] = ["valor", "manual"]
    with pytest.raises(ErrorJuego, match="no está permitido"):
        partida.iniciar_combate("estadistica")
    stat = partida.estadistica_iniciativa(partida.yo)
    partida.datos_de(partida.yo)["stats"][stat] = 999
    partida.iniciar_combate("valor")
    assert partida.combate["orden"][0] == partida.yo["id"]
    partida.terminar_combate()
    partida.iniciar_combate("manual")
    assert not partida.combate["activo"] and partida.combate["preparando"]["modo"] == "manual"      # espera a que el GM ordene y marque «Listo»
    partida.empezar_tras_tiradas()
    assert partida.combate["activo"]


def test_cono_y_casillas_dibujadas(partida):
    yo = partida.yo                                                       # en (1, 10)
    cono = partida.celdas_area(yo, (5, 11), {"area": {"forma": "cono", "tamano": 2}, "alcance": 1})
    assert set(cono) == {(2, 10), (3, 9), (3, 10), (3, 11)}               # mira a la derecha: 1 casilla y luego 3
    # dibujadas mirando a la derecha ([adelante, lado]); apuntando hacia arriba, giran
    area = {"forma": "casillas", "casillas": [[1, 0], [2, 1]]}
    assert partida.celdas_area(yo, (4, 10), {"area": area, "alcance": 1}) == [(2, 10), (3, 11)]
    assert partida.celdas_area(yo, (1, 5), {"area": area, "alcance": 1}) == [(1, 9), (2, 8)]
    hab(partida, alcance=1, area={"forma": "cono", "tamano": 3, "afecta": "rivales"})
    g = partida.colocar_enemigo("goblin", 3, 9)
    v0 = vida(partida, g)
    partida.usar_habilidad(yo["id"], "prueba", None, "Ana", False, casilla=(9, 10))   # lejos: el cono solo marca la dirección
    assert vida(partida, g) < v0


def test_tienda_ligada_a_mapas_y_sin_contrasena_de_gm(partida):
    tid = next(iter(partida.cat.tiendas))
    partida.cat.tiendas[tid]["mapas"] = ["otro_mapa"]
    partida.abrir_tienda(tid, True)
    assert partida.vista_tiendas()[0]["aqui"] is False
    with pytest.raises(ErrorJuego, match="este mapa"):
        partida.comprar("Ana", partida.datos_de(partida.yo)["id"], tid, partida.cat.tiendas[tid]["articulos"][0]["objeto"], 1)
    partida.cat.tiendas[tid]["mapas"] = [partida.mapa_id]
    assert partida.vista_tiendas()[0]["aqui"] is True


async def test_entrar_como_gm_sin_contrasena(catalogo, tmp_path):
    catalogo.config["servidor"]["password_gm"] = ""
    srv = Servidor(catalogo, EstadoPartida(catalogo, tmp_path, rng=random.Random(1)))
    async with serve(srv.handler, "127.0.0.1", 0) as s:
        ws = await connect(f"ws://127.0.0.1:{s.sockets[0].getsockname()[1]}")
        await ws.send(json.dumps({"tipo": "entrar", "usuario": "Master", "gm": True}))
        while (m := json.loads(await asyncio.wait_for(ws.recv(), 2)))["tipo"] != "bienvenida":
            pass
        assert m.get("es_gm") or m.get("gm")
        await ws.close()
        ws = await connect(f"ws://127.0.0.1:{s.sockets[0].getsockname()[1]}")         # y «/gm» sin contraseña desde el chat
        await ws.send(json.dumps({"tipo": "entrar", "usuario": "Ana"}))
        await ws.send(json.dumps({"tipo": "chat", "texto": "/gm"}))
        while not (m := json.loads(await asyncio.wait_for(ws.recv(), 2))).get("elevado"):
            assert m["tipo"] != "error", m
        await ws.close()


def test_categorias_de_estadisticas(tmp_path):
    def cambiar(d):
        cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
        cfg["juego"]["categorias_estadisticas"] = True
        cfg["juego"]["estadisticas"][0]["categoria"] = "Combate"
        (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    cat, inf = _campana(tmp_path, cambiar)
    assert inf.ok, inf.errores
    j = cat.config["juego"]
    assert j["categorias_estadisticas"] is True and j["estadisticas"][0]["categoria"] == "Combate" and j["estadisticas"][1]["categoria"] == ""


def test_equipar_objetos(partida):
    partida.cat.objetos["casco"] = {"nombre": "Casco", "descripcion": "", "imagen": "", "tipo": "equipo", "precio": 0, "efecto": None,
                                    "equipable": True, "hueco": "Cabeza", "efectos": [
                                        {"cuando": {"tipo": "siempre"}, "hacer": {"tipo": "bono_estadistica", "estadistica": "Fuerza", "valor": 5}}]}
    partida.cat.objetos["yelmo"] = {**partida.cat.objetos["casco"], "nombre": "Yelmo", "efectos": []}
    d = partida.datos_de(partida.yo)
    d["inventario"] += [{"objeto": "casco", "cantidad": 1}, {"objeto": "yelmo", "cantidad": 1}]
    with pytest.raises(ErrorJuego, match="no usa equipamiento"):
        partida.equipar(partida.yo["id"], "casco", True, "Ana", False)
    partida.cfg["juego"]["equipamiento"] = {"activo": True, "maximo": 1, "huecos": ["Cabeza"]}
    f0 = partida.stats_efectivas(partida.yo)["Fuerza"]                           # sin equipar, el casco no da nada
    partida.equipar(partida.yo["id"], "casco", True, "Ana", False)
    assert next(e for e in d["inventario"] if e["objeto"] == "casco")["equipado"]
    assert partida.stats_efectivas(partida.yo)["Fuerza"] == f0 + 5
    texto = partida.equipar(partida.yo["id"], "yelmo", True, "Ana", False)        # mismo hueco: cambia uno por otro
    assert "se quita Casco" in texto and not next(e for e in d["inventario"] if e["objeto"] == "casco").get("equipado")


def test_habilidades_fuera_de_combate(partida):
    hab(partida, alcance=5, formula="5")
    g = partida.colocar_enemigo("goblin", 3, 10)
    partida.cfg["juego"]["habilidades_fuera_de_combate"] = "sin_dano"
    with pytest.raises(ErrorJuego, match="daño"):
        partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "GM", True)          # el GM sí
    partida.cfg["juego"]["habilidades_fuera_de_combate"] = "todas"
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
