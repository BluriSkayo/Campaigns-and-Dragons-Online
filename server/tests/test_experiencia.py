"""Niveles y experiencia: manual por defecto, máximo en ambos modos, tipos de experiencia con rangos, y experiencia que ceden los enemigos."""
import copy
import random

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.test_condiciones import copiar, escribir

TIPOS = ["Exp. combate", "Exp. sagrada"]


def _campana(tmp_path, niveles=None, goblin_exp=30, escalones=None):
    d = copiar(tmp_path)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    j = cfg["juego"]
    for t in TIPOS:
        j["estadisticas"].append({"nombre": t, "valor_inicial": 0, "minimo": 0, "maximo": 100000, "repartible": False})
    if escalones is not None:
        j["estadisticas"].append({"nombre": "Valentía", "valor_inicial": 0, "minimo": 0, "maximo": 1000, "repartible": False, "escalones": escalones})
    j["niveles"] = {"activo": True, "modo": "manual", "experiencia": list(TIPOS), "umbrales": [], "maximo": 20, **(niveles or {})}
    escribir(d / "config.yaml", cfg)
    g = yaml.safe_load((d / "enemies" / "goblin.yaml").read_text(encoding="utf-8"))
    if goblin_exp is not None:
        g["experiencia"] = goblin_exp
    escribir(d / "enemies" / "goblin.yaml", g)
    return d


def _partida(d, tmp_path):
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    e = EstadoPartida(cat, tmp_path / "partida", rng=random.Random(3), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    ana = e.desplegar_personaje("Ana", p["id"], "GM", True, 2, 8)[0]
    return e, ana


def _goblin(e):
    x, y = [(x, y) for y in range(e.mapa["alto"]) for x in range(e.mapa["ancho"]) if e.casilla_transitable(x, y) and not e.casilla_ocupada(x, y)][-1]
    return e.colocar_enemigo("goblin", x, y)


def _matar(e, vencido, vencedor=None):
    e.datos_de(vencido)["recursos"][e.cat.recurso_vida()]["actual"] = 0
    e.al_derrotar(vencedor, vencido)


def _exp(e, t, tipo="Exp. combate"):
    return e.datos_de(t)["stats"][tipo]


def test_por_defecto_la_subida_de_nivel_es_a_mano(catalogo):
    n = catalogo.config["juego"]["niveles"]
    assert n["modo"] == "manual" and n["reparto"] == "todos"


def test_el_nivel_maximo_vale_en_los_dos_modos(tmp_path):
    cfg = lambda **n: {"juego": {"niveles": {"modo": "manual", "umbrales": [10, 30], "maximo": 7, **n}}}      # noqa: E731
    assert recursos.nivel_maximo(cfg()) == 7
    assert recursos.nivel_maximo(cfg(modo="experiencia", maximo=2)) == 2           # el máximo del Editor manda
    assert recursos.nivel_maximo(cfg(modo="experiencia", maximo=50)) == 3          # sin más umbrales no se pasa de ahí


def test_avisa_si_el_maximo_supera_a_los_umbrales(tmp_path):
    d = _campana(tmp_path, {"modo": "experiencia", "umbrales": [10, 30], "maximo": 9})
    _, inf = recursos.cargar(d)
    assert inf.ok and any("umbrales solo llegan al nivel 3" in a for a in inf.avisos)


def test_el_enemigo_cede_experiencia_al_caer_a_todos_los_personajes_en_pie(tmp_path):
    e, ana = _partida(_campana(tmp_path), tmp_path)
    gob = _goblin(e)
    _matar(e, gob, ana)
    assert _exp(e, ana) == 30                                      # número suelto → primer tipo
    assert any("cede experiencia" in t for t, _ in e.cola_chat)
    _matar(e, gob, ana)
    assert _exp(e, ana) == 30                                      # una sola vez por token


def test_con_reparto_vencedor_solo_cobra_quien_lo_derrota(tmp_path):
    e, ana = _partida(_campana(tmp_path, {"reparto": "vencedor"}), tmp_path)
    e.registrar_usuario("Luis")
    q = e.crear_personaje("Luis", False, "guerrero", "Loki")
    luis = e.desplegar_personaje("Luis", q["id"], "GM", True, 3, 8)[0]
    _matar(e, _goblin(e), luis)
    assert _exp(e, luis) == 30 and _exp(e, ana) == 0


def test_experiencia_por_tipos_y_el_gm_cambia_lo_de_un_token(tmp_path):
    e, ana = _partida(_campana(tmp_path, goblin_exp={"Exp. combate": 10, "Exp. sagrada": 5}), tmp_path)
    g1, g2 = _goblin(e), _goblin(e)
    e.editar_token(g2["id"], cede={"Exp. combate": 100})
    _matar(e, g1, ana)
    _matar(e, g2, ana)
    assert (_exp(e, ana), _exp(e, ana, "Exp. sagrada")) == (110, 5)


def test_en_modo_experiencia_los_tipos_suman_y_el_nivel_sube_solo(tmp_path):
    e, ana = _partida(_campana(tmp_path, {"modo": "experiencia", "umbrales": [40], "maximo": 5}), tmp_path)
    e.editar_token(ana["id"], dar_experiencia={"Exp. combate": 25, "Exp. sagrada": 15})      # 25 + 15 = 40 → nivel 2
    assert e.datos_de(ana)["nivel"] == 2
    e.editar_token(ana["id"], dar_experiencia={"Exp. combate": 500})
    assert e.datos_de(ana)["nivel"] == 2                                                     # no hay más umbrales


def test_en_modo_manual_la_experiencia_se_acumula_pero_no_sube_nivel(tmp_path):
    e, ana = _partida(_campana(tmp_path), tmp_path)
    e.editar_token(ana["id"], dar_experiencia={"Exp. combate": 999})
    assert _exp(e, ana) == 999 and e.datos_de(ana).get("nivel", 1) == 1


def test_dar_experiencia_a_mano_valida_todo(tmp_path):
    e, ana = _partida(_campana(tmp_path), tmp_path)
    gob = _goblin(e)
    for args in ({"dar_experiencia": {"Fuerza": 5}}, {"dar_experiencia": {"Exp. combate": 1.5}}, {"dar_experiencia": {"Exp. combate": True}},
                 {"dar_experiencia": "mucha"}, {"cede": {"Exp. combate": 5}}):
        with pytest.raises(ErrorJuego):
            e.editar_token(ana["id"], **args)
    with pytest.raises(ErrorJuego):
        e.editar_token(gob["id"], dar_experiencia={"Exp. combate": 5})           # un enemigo no gana experiencia
    with pytest.raises(ErrorJuego):
        e.editar_token(gob["id"], cede={"Exp. combate": -5})


def test_la_experiencia_de_un_enemigo_se_valida_al_cargar(tmp_path):
    _, inf = recursos.cargar(_campana(tmp_path, goblin_exp={"Exp. dragón": 5}))
    assert any("no es un tipo de experiencia" in x for x in inf.errores)
    _, inf = recursos.cargar(_campana(tmp_path / "otra", goblin_exp=-4))
    assert any("«experiencia»" in x for x in inf.errores) or not inf.ok


def test_los_rangos_por_tipo_estan_en_las_formulas(tmp_path):
    d = _campana(tmp_path, escalones=[10, 30, 60])
    e, ana = _partida(d, tmp_path)
    assert "Rango Valentía" in e.cat.nombres_formula()
    for valor, rango in ((0, 1), (10, 2), (29, 2), (30, 3), (999, 4)):
        e.datos_de(ana)["stats"]["Valentía"] = valor
        assert e.stats_planas(ana)["Rango Valentía"] == rango


def test_los_escalones_mal_puestos_dan_error(tmp_path):
    _, inf = recursos.cargar(_campana(tmp_path, escalones=[30, 10]))
    assert any("escalones" in x for x in inf.errores)


def test_cada_opcion_suma_lo_suyo_al_subir_de_nivel(tmp_path):
    e, ana = _partida(_campana(tmp_path, {"por_nivel": {"puntos": 1, "recursos": {"HP": 5}}}), tmp_path)
    p = e.datos_de(ana)
    ops = e.opciones_elegidas(p)
    assert ops, "el personaje de prueba debería tener alguna opción elegida"
    ops[0]["puntos_por_nivel"], ops[0]["recursos_por_nivel"] = 2, {"HP": 10}
    hp, pts = p["recursos"]["HP"]["max"], p.get("puntos_pendientes", 0)
    e.subir_nivel("Ana", p["id"])
    assert p["recursos"]["HP"]["max"] == hp + 15 and p["puntos_pendientes"] == pts + 3


def test_con_entrega_gm_solo_sube_el_nivel(tmp_path):
    e, ana = _partida(_campana(tmp_path, {"entrega": "gm", "por_nivel": {"puntos": 4, "recursos": {"HP": 5}}}), tmp_path)
    p = e.datos_de(ana)
    hp, pts = p["recursos"]["HP"]["max"], p.get("puntos_pendientes", 0)
    e.subir_nivel("Ana", p["id"])
    assert p["nivel"] == 2 and p["recursos"]["HP"]["max"] == hp and p.get("puntos_pendientes", 0) == pts


def test_lo_de_cada_nivel_se_valida(tmp_path):
    d = _campana(tmp_path, {"entrega": "quizas"})
    o = yaml.safe_load((d / "options" / "guerrero.yaml").read_text(encoding="utf-8"))
    o["recursos_por_nivel"] = {"Nada": 3}
    escribir(d / "options" / "guerrero.yaml", o)
    _, inf = recursos.cargar(d)
    texto = " ".join(inf.errores)
    assert "entrega" in texto and "recursos_por_nivel" in texto and "Nada" in texto
