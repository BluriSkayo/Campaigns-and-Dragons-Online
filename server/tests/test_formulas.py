import random

import pytest

from mesa import formulas
from mesa.formulas import FormulaError, evaluar, validar

A = {"Fuerza": 20, "Poder Mágico": 10}
O = {"Resistencia": 6, "Defensa Mágica": 4}


def test_numero_fijo():
    assert evaluar("40").valor == 40


def test_referencias_y_aritmetica():
    assert evaluar("[a.Fuerza] / 4 + 1", A, O).valor == 6
    assert evaluar("[[a.Poder Mágico]] - [o.Defensa Mágica]", A, O).valor == 6
    assert evaluar("[[a.Poder Mágico] - [o.Defensa Mágica]] * 2", A, O).valor == 12


def test_forma_corta_y_mayusculas():
    assert evaluar("[fuerza] + 10", A).valor == 30
    assert evaluar("[ a . Fuerza ]", A).valor == 20


def test_dados_deterministas():
    r1 = evaluar("2d6 + 3", rng=random.Random(5))
    r2 = evaluar("2d6 + 3", rng=random.Random(5))
    assert r1.valor == r2.valor and 5 <= r1.valor <= 15
    assert 1 <= evaluar("d20", rng=random.Random(1)).valor <= 20


def test_redondeo_hacia_abajo_y_negativos():
    assert evaluar("7 / 2").valor == 3
    assert evaluar("3 - 10").valor == -7
    assert evaluar("[a.Fuerza] - -5", A).valor == 25


@pytest.mark.parametrize("mala", [
    "", "   ", "2 ** 8", "__import__('os').system('x')", "exec(3)", "abs.real", "1 +", "(1", "[a.Inexistente]",
    "1/0", "[o.Fuerza]", "1000d6", "2d0", "'a'", "x" * 301, "max(1, 2)", "si(1; 2)", "tabla(Nada; 3)", "[h.Potencia]", "1 < 2 < 3", "max(x=1)", "1 if 1 else 2", "[a.Fuerza] @ 2",
])
def test_formulas_invalidas(mala):
    with pytest.raises(FormulaError):
        evaluar(mala, A, None if mala == "[o.Fuerza]" else O)


def test_el_objetivo_es_obligatorio_si_se_cita():
    with pytest.raises(FormulaError, match="objetivo"):
        evaluar("[o.Resistencia]", A, None)


def test_validar():
    nombres = ["Fuerza", "Resistencia"]
    assert validar("[a.Fuerza] - [o.Resistencia] + 1d6", nombres) == []
    assert any("Magia" in e for e in validar("[a.Magia]", nombres))
    assert validar("1 +", nombres)
    assert validar("", nombres)


def test_referencias():
    assert formulas.referencias("[[a.Fuerza] - [o.Resistencia]] + [Agilidad] + 2d6") == [
        ("a", "Fuerza"), ("o", "Resistencia"), ("a", "Agilidad")]


def test_detalle_legible():
    simple = evaluar("1d20", rng=random.Random(5)).detalle
    assert simple.count("=") == 1 and "→" not in simple          # «1d20 = 6», sin repetir
    compuesta = evaluar("2d6 + 3", rng=random.Random(5)).detalle
    assert "→" in compuesta and "2d6=" in compuesta
    assert evaluar("40").detalle == "40 = 40"


# ── Fórmulas ampliadas: funciones, comparaciones, decimales, tablas y valores de la habilidad ──
ATACANTE = {"Fuerza": 15}
OBJETIVO = {"Fuerza": 8}
TABLA_D20 = {"multiplicador": {"nombre": "Multiplicador", "defecto": 0, "filas": [
    {"desde": None, "hasta": 1, "valor": 0}, {"desde": 2, "hasta": 5, "valor": 1.5}, {"desde": 6, "hasta": 14, "valor": 2},
    {"desde": 15, "hasta": 19, "valor": 2.5}, {"desde": 20, "hasta": None, "valor": 3}]}}


@pytest.mark.parametrize("formula,esperado", [
    ("max(0; 3 - 10)", 0), ("min(4; 2; 9)", 2), ("max(1;2;3;4)", 4),
    ("redondear(2,5)", 3), ("redondear(2.4)", 2), ("abajo(7/2)", 3), ("arriba(7/2)", 4), ("abs(-5)", 5),
    ("1,5 * 2", 3), ("10 / 1,6", 6), ("si(3 > 2; 10; 20)", 10), ("si(3 = 2; 10; 20)", 20), ("si(3 <> 2; 1; 0)", 1),
    ("(2 >= 2) + (2 <= 1)", 1), ("[a.Fuerza] = 15", 1),
    ("tabla(Multiplicador; 1) * 10", 0), ("tabla(multiplicador; 4) * 10", 15), ("tabla( Multiplicador ; 14) * 10", 20),
    ("tabla(Multiplicador; 20) * 10", 30), ("tabla(Multiplicador; 99)", 3),
    ("[h.Potencia] * 2", 60), ("([a.Fuerza] + [h.Potencia]/2 - [o.Fuerza]/1,6) * tabla(Multiplicador; 10) * 0,5", 25),
])
def test_formulas_ampliadas(formula, esperado):
    r = evaluar(formula, ATACANTE, OBJETIVO, random.Random(0), tablas=TABLA_D20, habilidad={"Potencia": 30})
    assert r.valor == esperado, r.detalle


def test_la_tabla_muestra_el_tramo_en_el_detalle():
    r = evaluar("tabla(Multiplicador; 1d20)", ATACANTE, None, random.Random(1), tablas=TABLA_D20)
    assert "Multiplicador(" in r.detalle and "1d20=" in r.detalle


def test_si_solo_tira_los_dados_de_la_rama_elegida():
    r = evaluar("si(1 > 0; 5; 10d6)", ATACANTE, None, random.Random(0))
    assert r.valor == 5 and "10d6=" not in r.detalle
    r = evaluar("si(1 < 0; 5; 2d6)", ATACANTE, None, random.Random(0))
    assert "2d6=" in r.detalle


def test_validar_tablas_y_valores_de_habilidad():
    assert validar("tabla(Multiplicador; 1d20)", ["Fuerza"], TABLA_D20) == []
    assert "Tabla desconocida" in validar("tabla(Otra; 1d20)", ["Fuerza"], TABLA_D20)[0]
    assert validar("[h.Potencia] + [a.Fuerza]", ["Fuerza"], valores_habilidad=["Potencia"]) == []
    assert "no tiene el valor «Alcance»" in validar("[h.Alcance]", ["Fuerza"], valores_habilidad=["Potencia"])[0]
    assert "solo se puede usar en la fórmula de una habilidad" in validar("[h.Potencia]", ["Fuerza"])[0]
    assert "Separa los argumentos con «;»" in validar("max(1, 2)", ["Fuerza"])[0]
