"""Desplegar en una casilla elegida, habilidades que no atraviesan muros, color de los estados y campañas sin razas ni clases."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(5), persistir=False)


def personaje(partida, nombre="Thor", desplegar=True):
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", nombre)
    t = partida.desplegar_personaje("Ana", p["id"], "Ana", False)[0] if desplegar else None
    return p, t


def test_el_jugador_elige_la_casilla(partida):
    p, _ = personaje(partida, desplegar=False)
    t, nuevo = partida.desplegar_personaje("Ana", p["id"], "Ana", False, 3, 3)
    assert nuevo and (t["x"], t["y"]) == (3, 3)
    partida.cfg["permisos"]["max_personajes_por_jugador"] = 5
    otro = partida.crear_personaje("Ana", False, "guerrero", "Loki")
    with pytest.raises(ErrorJuego, match="ocupada"):
        partida.desplegar_personaje("Ana", otro["id"], "Ana", False, 3, 3)
    with pytest.raises(ErrorJuego, match="bloqueada"):
        partida.desplegar_personaje("Ana", otro["id"], "Ana", False, 5, 3)          # el muro
    with pytest.raises(ErrorJuego, match="bloqueada"):
        partida.desplegar_personaje("Ana", otro["id"], "Ana", False, -1, 999)
    partida.combate["activo"] = True
    with pytest.raises(ErrorJuego, match="combate"):
        partida.desplegar_personaje("Ana", otro["id"], "Ana", False, 4, 4)
    partida.combate["activo"] = False
    partida.cfg["permisos"]["desplegar_en_casilla"] = False
    with pytest.raises(ErrorJuego, match="Solo el GM"):
        partida.desplegar_personaje("Ana", otro["id"], "Ana", False, 4, 4)
    partida.desplegar_personaje("Ana", otro["id"], "GM", True, 4, 4)               # el GM sí


def test_con_niebla_solo_donde_ve(partida):
    partida.cfg["juego"]["niebla"].update(activa=True, vision_base=3, compartir=False)
    p, t = personaje(partida)
    t["x"], t["y"] = 2, 5
    partida.cfg["permisos"]["max_personajes_por_jugador"] = 5
    otro = partida.crear_personaje("Ana", False, "guerrero", "Loki")
    with pytest.raises(ErrorJuego, match="donde ves"):
        partida.desplegar_personaje("Ana", otro["id"], "Ana", False, 6, 3)           # tras el muro
    t2, _ = partida.desplegar_personaje("Ana", otro["id"], "Ana", False, 3, 5)
    assert (t2["x"], t2["y"]) == (3, 5)


def test_habilidad_que_no_atraviesa_muros(partida):
    _, t = personaje(partida)
    t["x"], t["y"] = 3, 3
    g = partida.colocar_enemigo("goblin", 7, 3)              # el muro de la columna 5 queda en medio
    hab = partida.cat.habilidades["ataque_basico"]
    hab["alcance"] = 99
    assert hab["atraviesa_muros"] is True                    # por defecto, como antes
    partida.usar_habilidad(t["id"], "ataque_basico", g["id"], "Ana", True)
    hab["atraviesa_muros"] = False
    with pytest.raises(ErrorJuego, match="muro en medio"):
        partida.usar_habilidad(t["id"], "ataque_basico", g["id"], "Ana", True)
    g2 = partida.colocar_enemigo("goblin", 3, 6)             # sin muro en medio
    partida.usar_habilidad(t["id"], "ataque_basico", g2["id"], "Ana", True)
    assert partida.linea_libre(t, {"x": 4, "y": 4})          # pegado: siempre


def test_color_de_estado_y_atraviesa_muros_se_validan(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    est = yaml.safe_load((d / "states/veneno.yaml").read_text(encoding="utf-8"))
    est["color"] = "#33aa55"
    (d / "states/veneno.yaml").write_text(yaml.safe_dump(est, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.estados["veneno"]["color"] == "#33aa55" and cat.config["juego"]["usar_grupos"] is True
    est["color"] = "verde"
    (d / "states/veneno.yaml").write_text(yaml.safe_dump(est, allow_unicode=True), encoding="utf-8")
    hab = yaml.safe_load((d / "abilities/ataque_basico.yaml").read_text(encoding="utf-8"))
    hab["atraviesa_muros"] = "no"
    (d / "abilities/ataque_basico.yaml").write_text(yaml.safe_dump(hab, allow_unicode=True), encoding="utf-8")
    errores = recursos.cargar(d)[1].errores
    assert any("#7a4fb5" in e for e in errores) and any("atraviesa_muros" in e for e in errores)


def test_campana_sin_razas_ni_clases(partida):
    partida.cfg["juego"]["usar_grupos"] = False
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Libre", elecciones={"raza": "elfo", "clase": "mago"})
    assert p["elecciones"] == {}                             # se ignoran: no hay grupos
    p2 = partida.crear_personaje("Ana", False, "guerrero", "Libre 2")
    assert p2["elecciones"] == {}
