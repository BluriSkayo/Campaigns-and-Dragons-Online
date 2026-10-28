"""Campos propios de la ficha (Alineamiento, Edad, Cordura…) y nombres de la interfaz que cambia la campaña."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG

CAMPOS = [{"nombre": "Alineamiento", "tipo": "lista", "opciones": ["Legal bueno", "Caótico neutral"]},
          {"nombre": "Edad", "tipo": "numero", "minimo": 1, "maximo": 900},
          {"nombre": "Dios", "tipo": "texto", "privado": True},
          {"nombre": "Marcado por la luna", "tipo": "casilla", "quien": "gm"}]


def test_validacion(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    cfg["juego"]["campos_ficha"] = CAMPOS
    cfg["juego"]["nombres"] = {"habilidades": "Hechizos", "personaje": "Investigador"}
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert [c["nombre"] for c in cat.config["juego"]["campos_ficha"]] == ["Alineamiento", "Edad", "Dios", "Marcado por la luna"]
    assert cat.config["juego"]["nombres"] == {"habilidades": "Hechizos", "personaje": "Investigador"}
    cfg["juego"]["campos_ficha"] = [{"nombre": "A", "tipo": "lista"}, {"nombre": "a"}, {"nombre": "N", "tipo": "numero", "minimo": 5, "maximo": 1}]
    cfg["juego"]["nombres"] = {"magia": "Poderes", "habilidades": ""}
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    errores = recursos.cargar(d)[1].errores
    for texto in ("al menos una opción", "ya hay otro campo", "mínimo no puede", "no es un nombre", "entre 1 y 30"):
        assert any(texto in e for e in errores), texto


@pytest.fixture
def partida(catalogo, tmp_path):
    catalogo.config["juego"]["campos_ficha"] = recursos._validar_campos_ficha("x", CAMPOS, recursos._Val(recursos.Informe(), tmp_path))
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(1))


def test_crear_editar_y_privacidad(partida, catalogo, tmp_path):
    e = partida
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor", campos={"Alineamiento": "Caótico neutral", "Edad": 30})
    assert p["campos"] == {"Alineamiento": "Caótico neutral", "Edad": 30}
    for malo, texto in [({"Edad": 1000}, "entre 1 y 900"), ({"Alineamiento": "Malvado"}, "sus opciones"), ({"Peso": 3}, "no tiene el campo"),
                        ({"Marcado por la luna": True}, "solo lo puede cambiar el GM"), ({"Dios": "x" * 301}, "300 letras")]:
        with pytest.raises(ErrorJuego, match=texto):
            e.editar_campos("Ana", p["id"], malo, False)
    e.editar_campos("Ana", p["id"], {"Dios": "Selûne", "Edad": None}, False)        # vaciar un campo lo quita
    assert p["campos"] == {"Alineamiento": "Caótico neutral", "Dios": "Selûne"}
    e.editar_campos("Ana", p["id"], {"Marcado por la luna": True}, True)            # el GM sí
    t, _ = e.desplegar_personaje("Ana", p["id"], "Ana", False)
    assert e.vista_token(t, "Ana", False)["campos"]["Dios"] == "Selûne"
    e.cfg["visibilidad"]["jugadores"]["ficha"] = True
    e.registrar_usuario("Beto")
    vista = e.vista_token(t, "Beto", False)
    assert "Dios" not in vista["campos"] and vista["campos"]["Alineamiento"] == "Caótico neutral"     # privado: solo dueño y GM
    e2 = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    e2.registrar_usuario("Ana")
    assert e2.buscar_personaje("Ana", p["id"])["campos"]["Marcado por la luna"] is True
