"""Objetos del mapa con tamaño (ancho × alto en casillas): validación y casillas que bloquean."""
import random
import shutil

import yaml

from mesa import recursos
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


def test_celdas_de_objeto():
    assert recursos.celdas_de_objeto({"x": 2, "y": 3}) == {(2, 3)}
    assert recursos.celdas_de_objeto({"x": 2, "y": 3, "ancho": 2, "alto": 1}) == {(2, 3), (3, 3)}
    assert recursos.celdas_de_objeto({"x": 0, "y": 0, "ancho": 1.5, "alto": 0.5}) == {(0, 0), (1, 0)}
    assert recursos.celdas_de_objeto({"x": 4, "y": 4, "ancho": 0.25, "alto": 0.25}) == {(4, 4)}


def _mapa(d):
    ruta = next((d / "maps").glob("*.yaml"))
    return ruta, yaml.safe_load(ruta.read_text(encoding="utf-8"))


def test_tamano_se_valida(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    ruta, m = _mapa(d)
    m["objetos"] = [{"nombre": "Carro", "x": 3, "y": 2, "ancho": 2.3, "alto": 1.5, "bloquea": True}]
    ruta.write_text(yaml.safe_dump(m, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    o = next(iter(cat.mapas.values()))["objetos"][0]
    assert (o["ancho"], o["alto"]) == (2.25, 1.5)                      # se redondea a cuartos
    for malo, texto in [({"ancho": 0}, "entre 0,25 y 50"), ({"alto": "dos"}, "entre 0,25 y 50"), ({"x": m["ancho"] - 1, "ancho": 3}, "se sale del mapa")]:
        m["objetos"] = [{"nombre": "Carro", "x": 3, "y": 2, **malo}]
        ruta.write_text(yaml.safe_dump(m, allow_unicode=True), encoding="utf-8")
        assert any(texto in e for e in recursos.cargar(d)[1].errores), malo


def test_un_objeto_grande_bloquea_todas_sus_casillas(catalogo, tmp_path):
    m = catalogo.mapas[next(iter(catalogo.mapas))]
    m["objetos"] = [{"nombre": "Carro", "x": 10, "y": 10, "ancho": 2, "alto": 2, "bloquea": True, "bloquea_vision": True, "imagen": ""}]
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=False)
    assert all(not e.casilla_transitable(x, y) for x in (10, 11) for y in (10, 11))
    assert e.casilla_transitable(12, 10) and e.casilla_transitable(9, 10)
    assert {(10, 10), (11, 11)} <= e._opacas()


def test_ajuste_de_la_imagen_de_fondo(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    ruta, m = _mapa(d)
    m["fondo"] = "maps/aldea.png"
    m["fondo_ajuste"] = {"x": -0.5, "y": 1.25, "ancho": 22, "alto": 11}
    ruta.write_text(yaml.safe_dump(m, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert next(iter(cat.mapas.values()))["fondo_ajuste"] == {"x": -0.5, "y": 1.25, "ancho": 22.0, "alto": 11.0}
    for malo in ({"x": 0, "y": 0, "ancho": 0, "alto": 5}, {"x": 0, "y": 0, "ancho": 5}, "grande", {"x": "a", "y": 0, "ancho": 5, "alto": 5}):
        m["fondo_ajuste"] = malo
        ruta.write_text(yaml.safe_dump(m, allow_unicode=True), encoding="utf-8")
        assert any("fondo_ajuste" in e for e in recursos.cargar(d)[1].errores), malo
