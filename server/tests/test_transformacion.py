"""Transformación: grupos de «formas» (humano ↔ lobo) y de «evolución» (solo hacia delante)."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


def op(grupo, nombre, **extra):
    return {"nombre": nombre, "descripcion": "", "imagen": "", "grupo": grupo, "bonos": {}, "estadisticas": {}, "recursos": {}, "puntos_extra": 0,
            "rasgos": [], "habilidades": [], "etiquetas": [], "iniciativa": "", "imagen_forma": "", "evoluciona_a": [], **extra}


@pytest.fixture
def partida(catalogo, tmp_path):
    c = catalogo
    c.grupos["forma"] = {"nombre": "Forma", "descripcion": "", "obligatorio": True, "transformacion": "formas"}
    c.opciones["humano_f"] = op("forma", "Humano")
    c.opciones["lobo"] = op("forma", "Lobo", bonos={"Fuerza": 3}, habilidades=["bola_de_fuego"], recursos={"HP": 200},
                            imagen_forma="tokens/lobo.png", etiquetas=["Bestia"])
    c.grupos["etapa"] = {"nombre": "Etapa", "descripcion": "", "obligatorio": False, "transformacion": "evolucion"}
    c.opciones["cria"] = op("etapa", "Cría", evoluciona_a=["adulto"])
    c.opciones["adulto"] = op("etapa", "Adulto", evoluciona_a=["anciano"])
    c.opciones["anciano"] = op("etapa", "Anciano")
    e = EstadoPartida(c, tmp_path, rng=random.Random(1), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Lupin", imagen="tokens/guerrero.png",
                          elecciones={"raza": "orco", "clase": "guerrero", "forma": "humano_f", "etapa": "cria"})
    t, _ = e.desplegar_personaje("Ana", p["id"], "Ana", False)
    return e, p, t


def test_el_jugador_necesita_permiso(partida):
    e, p, t = partida
    with pytest.raises(ErrorJuego, match="solo el GM"):
        e.transformar(t["id"], "lobo", "Ana", False)
    e.cfg["permisos"]["transformarse"] = True
    e.transformar(t["id"], "lobo", "Ana", False)
    with pytest.raises(ErrorJuego, match="tus propios"):
        e.transformar(t["id"], "humano_f", "Beto", False)


def test_ida_y_vuelta_conserva_lo_ganado(partida):
    e, p, t = partida
    fuerza = e.stats_efectivas(t)["Fuerza"]
    p["stats"]["Fuerza"] += 2                                # puntos ganados en la partida
    p["recursos"]["HP"]["max"] = 100
    p["recursos"]["HP"]["actual"] = 50
    esperado = 100 + 200 - e.cat.recursos_base(p["elecciones"])["HP"]        # la forma suma lo que cambia su máximo
    texto = e.transformar(t["id"], "lobo", "GM", True)
    assert "se transforma en Lobo" in texto
    assert e.stats_efectivas(t)["Fuerza"] == fuerza + 2 + 3
    assert p["recursos"]["HP"]["max"] == esperado and p["recursos"]["HP"]["actual"] == round(esperado / 2)    # la vida en proporción
    assert "bola_de_fuego" in p["habilidades"] and "Bestia" in e.etiquetas_de(t) and p["imagen"] == "tokens/lobo.png"
    e.transformar(t["id"], "humano_f", "GM", True)
    assert e.stats_efectivas(t)["Fuerza"] == fuerza + 2 and p["imagen"] == "tokens/guerrero.png"
    assert "bola_de_fuego" not in p["habilidades"] and p["recursos"]["HP"]["actual"] * 2 == p["recursos"]["HP"]["max"]
    with pytest.raises(ErrorJuego, match="No puede transformarse"):
        e.transformar(t["id"], "humano_f", "GM", True)        # ya es humano
    with pytest.raises(ErrorJuego, match="no existe"):
        e.transformar(t["id"], "nada", "GM", True)
    with pytest.raises(ErrorJuego, match="No puede transformarse"):
        e.transformar(t["id"], "mago", "GM", True)            # la clase no es un grupo de formas


def test_evolucion_solo_hacia_delante(partida):
    e, p, t = partida
    e.cfg["permisos"]["transformarse"] = True
    assert e.formas_posibles(t, "etapa", False) == ["adulto"]
    with pytest.raises(ErrorJuego, match="No puede transformarse"):
        e.transformar(t["id"], "anciano", "Ana", False)      # se salta una etapa
    assert "evoluciona a Adulto" in e.transformar(t["id"], "adulto", "Ana", False)
    with pytest.raises(ErrorJuego, match="No puede transformarse"):
        e.transformar(t["id"], "cria", "Ana", False)         # no hay vuelta atrás
    e.transformar(t["id"], "cria", "GM", True)               # el GM sí puede


def test_validacion(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    (d / "groups" / "etapa.yaml").write_text(yaml.safe_dump({"nombre": "Etapa", "transformacion": "evolucion"}), encoding="utf-8")
    (d / "options" / "cria.yaml").write_text(yaml.safe_dump({"grupo": "etapa", "nombre": "Cría", "evoluciona_a": ["adulto"]}), encoding="utf-8")
    (d / "options" / "adulto.yaml").write_text(yaml.safe_dump({"grupo": "etapa", "nombre": "Adulto", "imagen_forma": "tokens/adulto.png"}), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.grupos["etapa"]["transformacion"] == "evolucion" and cat.grupos["raza"]["transformacion"] == "no"
    assert cat.opciones["cria"]["evoluciona_a"] == ["adulto"] and cat.opciones["adulto"]["imagen_forma"] == "tokens/adulto.png"
    (d / "options" / "cria.yaml").write_text(yaml.safe_dump({"grupo": "etapa", "nombre": "Cría", "evoluciona_a": ["mago"]}), encoding="utf-8")
    (d / "groups" / "raza.yaml").write_text(yaml.safe_dump({"nombre": "Raza", "transformacion": "a veces"}), encoding="utf-8")
    errores = recursos.cargar(d)[1].errores
    assert any("mismo grupo" in x for x in errores) and any("transformacion" in x for x in errores)
