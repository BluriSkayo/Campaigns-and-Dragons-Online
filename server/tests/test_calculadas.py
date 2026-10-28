"""Estadísticas calculadas (L1) y máximos de recursos con fórmula (L2)."""
import random

import yaml

from mesa import recursos
from mesa.estado import EstadoPartida
from tests.test_condiciones import copiar, escribir


def _campana(tmp_path, stats_extra=(), recursos_cambio=None, niveles=False):
    d = copiar(tmp_path)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    j = cfg["juego"]
    j["estadisticas"] += list(stats_extra)
    for r in j["recursos"]:
        r.update((recursos_cambio or {}).get(r["nombre"], {}))
    if niveles:
        j["niveles"] = {"activo": True, "modo": "manual", "experiencia": [], "umbrales": [], "maximo": 20}
    escribir(d / "config.yaml", cfg)
    return d


def _partida(d, tmp_path):
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    e = EstadoPartida(cat, tmp_path / "p", rng=random.Random(1), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    t = e.desplegar_personaje("Ana", p["id"], "GM", True, 2, 8)[0]
    return e, t


MOD = {"nombre": "Mod Fuerza", "valor_inicial": 0, "minimo": -10, "maximo": 10, "formula": "abajo(([Fuerza] - 10) / 2)"}


def test_estadistica_calculada_sigue_a_su_base_y_a_los_bonos(tmp_path):
    e, t = _partida(_campana(tmp_path, [MOD]), tmp_path)
    s = e.stats_efectivas(t)
    assert s["Mod Fuerza"] == (s["Fuerza"] - 10) // 2
    e.datos_de(t)["stats"]["Fuerza"] = 18
    assert e.stats_efectivas(t)["Mod Fuerza"] == (e.stats_efectivas(t)["Fuerza"] - 10) // 2
    assert not next(x for x in e.cat.config["juego"]["estadisticas"] if x["nombre"] == "Mod Fuerza")["repartible"]


def test_formulas_calculadas_se_validan(tmp_path):
    malas = [{**MOD, "formula": "1d6 + [Fuerza]"},
             {"nombre": "A", "valor_inicial": 0, "formula": "[B] + 1"}, {"nombre": "B", "valor_inicial": 0, "formula": "[A] + 1"}]
    _, inf = recursos.cargar(_campana(tmp_path, malas, {"HP": {"maximo_formula": "[Nada] * 2"}}))
    t = " ".join(inf.errores)
    assert "dados" in t and "Nada" in t and "A → formula" in t


def test_maximo_de_vida_con_formula_y_nivel(tmp_path):
    e, t = _partida(_campana(tmp_path, [], {"HP": {"maximo_formula": "10 + [Fuerza] * [Nivel]"}}, niveles=True), tmp_path)
    hp = e.vista_token(t, "Ana", False)["recursos"]["HP"]
    fz = e.stats_efectivas(t)["Fuerza"]
    assert hp["max"] == 10 + fz and hp["actual"] == hp["max"]
    e.subir_nivel("Ana", e.datos_de(t)["id"])
    hp = e.vista_token(t, "Ana", False)["recursos"]["HP"]
    assert hp["max"] == 10 + fz * 2 and hp["actual"] == hp["max"]          # al subir el máximo, el actual sube lo mismo
