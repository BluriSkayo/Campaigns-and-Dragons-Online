"""Tablas por tramos de la campaña y valores propios de las habilidades, de la carga a la partida."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG

TABLA = {"nombre": "Multiplicador", "descripcion": "Según el d20", "defecto": 0, "filas": [
    {"hasta": 1, "valor": 0}, {"desde": 2, "hasta": 5, "valor": 1.5}, {"desde": 6, "hasta": 14, "valor": 2},
    {"desde": 15, "hasta": 19, "valor": 2.5}, {"desde": 20, "valor": 3}]}


def copiar(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    return d


def leer(p):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def escribir(p, datos):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def con_tablas(d, tablas):
    cfg = leer(d / "config.yaml")
    cfg["juego"]["tablas"] = tablas
    escribir(d / "config.yaml", cfg)


def test_tablas_y_valores_validos(tmp_path):
    d = copiar(tmp_path)
    con_tablas(d, [TABLA])
    escribir(d / "abilities/zarpazo.yaml", {"nombre": "Zarpazo", "valores": {"Potencia": 30, "Precisión": 1.5},
                                             "formula": "max(0; ([a.Fuerza] + [h.Potencia]/2 - [o.Resistencia]/1,6) * tabla(Multiplicador; 1d20) * 0,5)"})
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.config["juego"]["tablas"][0]["filas"][0] == {"desde": None, "hasta": 1, "valor": 0}
    assert cat.habilidades["zarpazo"]["valores"] == {"Potencia": 30, "Precisión": 1.5}
    assert cat.habilidades["ataque_basico"]["valores"] == {}                       # las habilidades de antes siguen igual


@pytest.mark.parametrize("tablas,texto", [
    ([{"nombre": "A", "filas": [{"desde": 5, "hasta": 2, "valor": 1}]}], "es mayor que «hasta»"),
    ([{"nombre": "A", "filas": [{"desde": "x", "valor": 1}]}], "deben ser números"),
    ([{"nombre": "A", "filas": [{"desde": 1, "valor": "mucho"}]}], "«valor» debe ser un número"),
    ([{"nombre": "A"}, {"nombre": "a"}], "ya hay otra tabla llamada"),
    ([{"nombre": "Con;punto"}], "no puede llevar"),
    ("tabla", "debe ser una lista"),
])
def test_tablas_incorrectas(tmp_path, tablas, texto):
    d = copiar(tmp_path)
    con_tablas(d, tablas)
    _, inf = recursos.cargar(d)
    assert any(texto in e for e in inf.errores), inf.errores


@pytest.mark.parametrize("hab,texto", [
    ({"nombre": "X", "formula": "tabla(Inexistente; 1d20)"}, "Tabla desconocida"),
    ({"nombre": "X", "formula": "[h.Potencia]"}, "no tiene el valor «Potencia»"),
    ({"nombre": "X", "valores": {"Potencia": "alta"}, "formula": "1"}, "debe ser un número"),
    ({"nombre": "X", "valores": {"a.b": 1}, "formula": "1"}, "no vale"),
])
def test_habilidades_con_formulas_incorrectas(tmp_path, hab, texto):
    d = copiar(tmp_path)
    escribir(d / "abilities/x.yaml", hab)
    _, inf = recursos.cargar(d)
    assert any(texto in e for e in inf.errores), inf.errores


def test_en_partida_la_habilidad_usa_su_potencia_y_la_tabla(catalogo, tmp_path):
    catalogo.config["juego"]["tablas"] = [TABLA]
    catalogo.habilidades["zarpazo"] = {"nombre": "Zarpazo", "descripcion": "", "imagen": "", "tipo": "dano", "objetivo": "enemigo",
                                       "alcance": 99, "coste": {}, "valores": {"Potencia": 30},
                                       "formula": "max(0; ([a.Fuerza] + [h.Potencia]/2 - [o.Resistencia]/1,6) * tabla(Multiplicador; 1d20) * 0,5)"}
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(4), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    p["habilidades"].append("zarpazo")
    t, _ = e.desplegar_personaje("Ana", p["id"], "Ana", False)
    g = e.colocar_enemigo("goblin", 6, 6)
    texto, _ = e.usar_habilidad(t["id"], "zarpazo", g["id"], "Ana", True)
    assert "[h.Potencia]=30" in texto and "Multiplicador(" in texto
    assert "tiró" in e.tirar("Ana", "tabla(Multiplicador; 1d20) * 10")       # también en las tiradas libres
