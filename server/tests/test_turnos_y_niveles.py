"""Turnos ordenados por el GM, movimiento limitado por turno y niveles con experiencia (de varios tipos) o a mano."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import combatir, CONFIG
from tests.test_servidor import _gm_y_ana, mundo  # noqa: F401  (fixture)

STATS_EXP = [{"nombre": "Exp. combate", "valor_inicial": 0, "minimo": 0, "maximo": 99999, "repartible": False, "para_todos": True},
             {"nombre": "Exp. exploración", "valor_inicial": 0, "minimo": 0, "maximo": 99999, "repartible": False, "para_todos": True}]


def con_niveles(cfg, modo="experiencia"):
    j = cfg["juego"]
    for e in STATS_EXP:
        j["estadisticas"].append({"descripcion": "", **e})
    j["niveles"] = {"activo": True, "modo": modo, "experiencia": ["Exp. combate", "Exp. exploración"], "umbrales": [100, 250, 500], "maximo": 5,
                    "por_nivel": {"puntos": 2, "recursos": {"HP": 10}}, "aprende": [{"nivel": 3, "habilidad": "curacion"}]}
    return cfg


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(2), persistir=False)


def pj(partida, nombre="Thor", x=2, y=8):
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", nombre)
    return p, partida.desplegar_personaje("Ana", p["id"], "GM", True, x, y)[0]


# ── Turnos ──
def test_orden_manual_y_reordenar(partida):
    partida.cfg["juego"]["iniciativa"] = "manual"
    _, t = pj(partida)
    g = partida.colocar_enemigo("goblin", 10, 10)
    texto = partida.iniciar_combate()                                                         # (no `combatir`: este no sigue solo)
    assert "decidiendo el orden" in texto and not partida.combate["activo"]                  # primero el GM ordena y marca «Listo»
    assert partida.combate["preparando"]["orden"] == [t["id"], g["id"]]                       # sin tiradas: personajes primero
    partida.empezar_tras_tiradas()
    assert partida.combate["orden"] == [t["id"], g["id"]]
    partida.ordenar_turnos([g["id"], t["id"]])
    assert partida.combate["orden"] == [g["id"], t["id"]] and partida.token_en_turno() == t["id"]   # el turno sigue siendo suyo
    for malo in ([g["id"]], [g["id"], g["id"]], "x", [g["id"], "otro"]):
        with pytest.raises(ErrorJuego, match="mismos participantes"):
            partida.ordenar_turnos(malo)


def test_reordenar_tambien_con_iniciativa_por_estadistica(partida):
    _, t = pj(partida)
    g = partida.colocar_enemigo("goblin", 10, 10)
    combatir(partida)
    nuevo = list(reversed(partida.combate["orden"]))
    partida.ordenar_turnos(nuevo)
    assert partida.combate["orden"] == nuevo


# ── Movimiento ──
def test_movimiento_limitado_por_turno(partida):
    partida.cfg["juego"]["movimiento"] = {"limitado": True, "casillas": 3, "estadistica": ""}
    partida.cfg["permisos"]["acciones_solo_en_su_turno"] = False
    _, t = pj(partida, x=6, y=9)
    g = partida.colocar_enemigo("goblin", 15, 9)
    partida.mover_token(t["id"], 12, 9, "Ana", False)                   # sin combate: sin límite
    partida.mover_token(t["id"], 6, 9, "Ana", False)
    combatir(partida)
    partida.combate["orden"] = [t["id"], g["id"]]; partida.combate["indice"] = 0
    partida.mover_token(t["id"], 8, 9, "Ana", False)                    # 2 casillas
    assert partida.movimiento_restante(t) == 1 and partida.vista_combate("Ana", False)["movimiento"]["quedan"] == 1
    with pytest.raises(ErrorJuego, match="te queda 1 casilla"):
        partida.mover_token(t["id"], 10, 9, "Ana", False)
    partida.mover_token(t["id"], 9, 9, "Ana", False)
    assert partida.movimiento_restante(t) == 0
    with pytest.raises(ErrorJuego, match="quedan 0"):
        partida.mover_token(t["id"], 9, 8, "Ana", False)
    partida.mover_token(t["id"], 12, 9, "GM", True)                     # el GM no tiene límite
    partida.terminar_turno("GM", True)
    partida.terminar_turno("GM", True)                                  # vuelve a ser su turno: movimiento completo
    assert partida.movimiento_restante(t) == 3


def test_movimiento_segun_estadistica(partida):
    partida.cfg["juego"]["movimiento"] = {"limitado": True, "casillas": 3, "estadistica": "Agilidad"}
    _, t = pj(partida)
    partida.colocar_enemigo("goblin", 15, 9)
    combatir(partida)
    assert partida.movimiento_max(t) == partida.stats_efectivas(t)["Agilidad"]


def test_config_de_turnos_y_movimiento(tmp_path):
    d = tmp_path / "c"
    shutil.copytree(CONFIG, d)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    cfg["juego"]["iniciativa"] = "a dedo"
    cfg["juego"]["movimiento"] = {"limitado": True, "casillas": 6, "estadistica": "Suerte"}
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    errores = recursos.cargar(d)[1].errores
    assert any("iniciativa" in e for e in errores) and any("Suerte" in e for e in errores)


# ── Niveles ──
def test_niveles_se_validan(tmp_path):
    d = tmp_path / "c"
    shutil.copytree(CONFIG, d)
    cfg = con_niveles(yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8")))
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    op = yaml.safe_load((d / "options/mago.yaml").read_text(encoding="utf-8"))
    op["aprende"] = [{"nivel": 2, "habilidad": "bola_de_fuego"}]
    (d / "options/mago.yaml").write_text(yaml.safe_dump(op, allow_unicode=True), encoding="utf-8")
    hab = yaml.safe_load((d / "abilities/ataque_basico.yaml").read_text(encoding="utf-8"))
    hab["formula"] = "[a.Fuerza] + [Nivel]"
    (d / "abilities/ataque_basico.yaml").write_text(yaml.safe_dump(hab, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.opciones["mago"]["aprende"] == [{"nivel": 2, "habilidad": "bola_de_fuego"}] and recursos.nivel_maximo(cat.config) == 4
    cfg["juego"]["niveles"].update(umbrales=[100, 50], aprende=[{"nivel": 1, "habilidad": "nada"}], experiencia=["Fuerza"])
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    errores = recursos.cargar(d)[1].errores
    assert any("cada vez mayores" in e for e in errores) and any("entre 2 y" in e for e in errores) and any("contador" in e for e in errores)


@pytest.fixture
def con_exp(catalogo, tmp_path):
    con_niveles(catalogo.config)
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(2), persistir=False)
    return e


def test_subir_con_varios_tipos_de_experiencia(con_exp):
    e = con_exp
    p, t = pj(e)
    hp = p["recursos"]["HP"]["max"]
    assert p["nivel"] == 1 and e.vista_token(t, "Ana", False)["experiencia"] == {"total": 0, "por_tipo": {"Exp. combate": 0, "Exp. exploración": 0}, "siguiente": 100, "anterior": 0}
    e._efecto_estadistica("Prueba", t, None, {"estadistica": "Exp. combate", "formula": "60", "objetivo": "uno_mismo"})
    assert p["nivel"] == 1
    e._efecto_estadistica("Prueba", t, None, {"estadistica": "Exp. exploración", "formula": "200", "objetivo": "uno_mismo"})   # 260: niveles 2 y 3
    assert p["nivel"] == 3 and p["puntos_pendientes"] >= 4 and p["recursos"]["HP"]["max"] == hp + 20 and "curacion" in p["habilidades"]
    chat, _ = e.vaciar_colas()
    assert any("sube a nivel 3" in c[0] and "aprende «Curación»" in c[0] for c in chat)
    e.editar_token(t["id"], stats={"Exp. combate": 5000})                # el GM le da mucha experiencia: hasta el máximo (4)
    assert p["nivel"] == 4 and e.vista_token(t, "Ana", False)["experiencia"]["siguiente"] is None
    with pytest.raises(ErrorJuego, match="nivel máximo"):
        e.subir_nivel("Ana", p["id"])


def test_nivel_en_formulas(con_exp):
    e = con_exp
    _, t = pj(e)
    assert e.stats_planas(t)["Nivel"] == 1
    g = e.colocar_enemigo("goblin", 10, 10)
    assert e.stats_planas(g)["Nivel"] == 1


def test_modo_manual_solo_el_gm(con_exp):
    e = con_exp
    e.cfg["juego"]["niveles"]["modo"] = "manual"
    p, t = pj(e)
    e._efecto_estadistica("Prueba", t, None, {"estadistica": "Exp. combate", "formula": "9999", "objetivo": "uno_mismo"})
    assert p["nivel"] == 1                                               # la experiencia no sube niveles sola
    e.subir_nivel("Ana", p["id"])
    assert p["nivel"] == 2
    e.cfg["juego"]["niveles"]["activo"] = False
    with pytest.raises(ErrorJuego, match="no usa niveles"):
        e.subir_nivel("Ana", p["id"])


async def test_por_la_red(mundo):  # noqa: F811
    gm, ana, tid, estado = await _gm_y_ana(mundo)
    estado.cfg["juego"]["niveles"].update(activo=True, modo="manual", maximo=10)
    pid = estado.tokens[tid]["personaje_id"]
    await ana.enviar(tipo="gm_subir_nivel", usuario="Ana", personaje=pid)
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_subir_nivel", usuario="Ana", personaje=pid)
    assert "sube a nivel 2" in (await ana.chat_de("Sistema"))["texto"]
    estado.colocar_enemigo("goblin", 10, 10)
    await gm.enviar(tipo="gm_iniciar_combate")
    await gm.enviar(tipo="gm_empezar_combate")
    cb = await ana.recibir("combate")
    while not cb["activo"]:
        cb = await ana.recibir("combate")
    orden = cb["orden"]
    await gm.enviar(tipo="gm_orden_turnos", orden=list(reversed(orden)))
    assert (await ana.recibir("combate"))["orden"] == list(reversed(orden))
