"""Contadores: estadísticas no repartibles, recursos que empiezan vacíos, «al derrotar» / «al ser derrotado»,
«Sumar a una estadística (para siempre)» y efectos de la campaña (valen para todos)."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


def copiar(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    return d


def leer(p):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def escribir(p, datos):
    p.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def con_contadores(cfg):
    j = cfg["juego"]
    j["estadisticas"].append({"nombre": "Experiencia", "descripcion": "", "valor_inicial": 0, "minimo": 0, "maximo": 1000, "para_todos": True, "repartible": False})
    j["recursos"] = [r for r in j["recursos"] if r["nombre"] != "Furia"]
    j["recursos"].append({"nombre": "Furia", "descripcion": "", "maximo_inicial": 50, "para_todos": True, "empieza_vacio": True})
    return cfg


def test_validacion(tmp_path):
    d = copiar(tmp_path)
    cfg = con_contadores(leer(d / "config.yaml"))
    cfg["juego"]["recursos"] = [r for r in cfg["juego"]["recursos"] if r["nombre"] != "Furia"] + [{"nombre": "Furia", "maximo_inicial": 50, "empieza_vacio": True}]
    escribir(d / "config.yaml", cfg)
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    exp = next(e for e in cat.config["juego"]["estadisticas"] if e["nombre"] == "Experiencia")
    assert exp["repartible"] is False and next(e for e in cat.config["juego"]["estadisticas"] if e["nombre"] == "Fuerza")["repartible"] is True
    assert next(r for r in cat.config["juego"]["recursos"] if r["nombre"] == "Furia")["empieza_vacio"] is True
    cfg["juego"]["recursos"][0]["empieza_vacio"] = True        # la vida no puede empezar vacía
    escribir(d / "config.yaml", cfg)
    assert any("no puede empezar vacío" in e for e in recursos.cargar(d)[1].errores)


def test_efectos_de_campana_se_validan(tmp_path):
    d = copiar(tmp_path)
    cfg = con_contadores(leer(d / "config.yaml"))
    cfg["juego"]["efectos"] = [{"cuando": "al_derrotar", "si": [{"tipo": "bando", "quien": "uno_mismo", "bando": "jugador"}],
                                "hacer": {"tipo": "modificar_estadistica", "estadistica": "Experiencia", "formula": "10", "objetivo": "uno_mismo"}}]
    escribir(d / "config.yaml", cfg)
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.config["juego"]["efectos"][0]["hacer"]["tipo"] == "modificar_estadistica"
    cfg["juego"]["efectos"] = [{"cuando": "siempre", "hacer": {"tipo": "modificar_estadistica", "estadistica": "Experiencia", "formula": "1"}}]
    escribir(d / "config.yaml", cfg)
    assert any("sumaría sin parar" in e for e in recursos.cargar(d)[1].errores)
    cfg["juego"]["efectos"] = [{"cuando": "al_derrotar", "hacer": {"tipo": "modificar_estadistica", "estadistica": "Suerte", "formula": "1"}}]
    escribir(d / "config.yaml", cfg)
    assert any("config.yaml → juego → efectos" in e and "Suerte" in e for e in recursos.cargar(d)[1].errores)


@pytest.fixture
def partida(catalogo, tmp_path):
    con_contadores(catalogo.config)
    catalogo.config["juego"]["efectos"] = [{"cuando": {"tipo": "al_derrotar"}, "si": [{"tipo": "bando", "quien": "uno_mismo", "bando": "jugador"}],
                                            "hacer": {"tipo": "modificar_estadistica", "estadistica": "Experiencia", "formula": "10", "objetivo": "uno_mismo"}}]
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(3), persistir=False)


def personaje(partida, nombre="Thor"):
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", nombre)
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    return p, t


def test_no_repartible_y_empieza_vacio(partida):
    p, _ = personaje(partida)
    assert p["stats"]["Experiencia"] == 0
    assert p["recursos"]["Furia"] == {"actual": 0, "max": 50} and p["recursos"]["HP"]["actual"] == p["recursos"]["HP"]["max"]
    with pytest.raises(ErrorJuego, match="no recibe puntos"):
        partida.crear_personaje("Ana", False, "guerrero", "Tramposo", reparto={"Experiencia": 5})
    partida.crear_personaje("Ana", False, "guerrero", "Correcto", reparto={"Experiencia": 0, "Fuerza": 2})     # 0 puntos sí se acepta
    with pytest.raises(ErrorJuego, match="no recibe puntos"):
        partida.repartir_puntos("Ana", p["id"], {"Experiencia": 1}, True)


def test_al_derrotar_da_experiencia_solo_una_vez(partida):
    p, t = personaje(partida)
    g = partida.colocar_enemigo("goblin", 6, 6)
    partida.cat.habilidades["ataque_basico"]["alcance"] = 99
    g["recursos"]["HP"]["actual"] = 1
    texto, _ = partida.usar_habilidad(t["id"], "ataque_basico", g["id"], "Ana", True)
    assert "derrotado" in texto
    assert p["stats"]["Experiencia"] == 10
    chat, _ = partida.vaciar_colas()
    assert any("Experiencia +10" in c[0] for c in chat)
    partida.usar_habilidad(t["id"], "ataque_basico", g["id"], "Ana", True)          # rematar no cuenta otra vez
    assert p["stats"]["Experiencia"] == 10


def test_al_ser_derrotado_y_objetivo(partida):
    # El NPC, al caer, da 5 de Experiencia a quien lo derrotó (efecto en el propio NPC, mirando «al objetivo»).
    partida.cfg["juego"]["efectos"] = []
    partida.cat.rasgos["botin"] = {"nombre": "Botín", "descripcion": "", "imagen": "", "efectos": [
        {"cuando": {"tipo": "al_ser_derrotado"}, "hacer": {"tipo": "modificar_estadistica", "estadistica": "Experiencia", "formula": "5", "objetivo": "objetivo"}}]}
    partida.cat.opciones["orco"]["rasgos"].append("botin")
    p, t = personaje(partida)
    g = partida.colocar_enemigo("goblin", 6, 6)
    g["elecciones"] = {"raza": "orco"}
    partida.cat.habilidades["ataque_basico"]["alcance"] = 99
    g["recursos"]["HP"]["actual"] = 1
    partida.usar_habilidad(t["id"], "ataque_basico", g["id"], "Ana", True)
    assert p["stats"]["Experiencia"] == 5


def test_derrota_por_efecto_y_cadena_limitada(partida):
    p, t = personaje(partida)
    g = partida.colocar_enemigo("goblin", 6, 6)
    g["recursos"]["HP"]["actual"] = 2
    partida._efecto_recurso("Trampa", t, g, {"recurso": "HP", "formula": "-5", "objetivo": "objetivo"})
    assert p["stats"]["Experiencia"] == 10                                      # derrotar con un efecto también cuenta
    # Un efecto de derrota que derrota a otro, que derrota a otro…: la cadena se corta sin colgar el servidor.
    partida.cfg["juego"]["efectos"].append({"cuando": {"tipo": "al_ser_derrotado"},
                                            "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-999", "objetivo": "objetivo"}})
    a, b = partida.colocar_enemigo("goblin", 7, 7), partida.colocar_enemigo("goblin", 8, 8)
    a["recursos"]["HP"]["actual"] = 1
    partida._efecto_recurso("Trampa", b, a, {"recurso": "HP", "formula": "-5", "objetivo": "objetivo"})
    assert a["recursos"]["HP"]["actual"] == 0


def test_modificar_estadistica_respeta_limites(partida):
    p, t = personaje(partida)
    partida._efecto_estadistica("Prueba", t, None, {"estadistica": "Experiencia", "formula": "5000", "objetivo": "uno_mismo"})
    assert p["stats"]["Experiencia"] == 1000
    partida._efecto_estadistica("Prueba", t, None, {"estadistica": "Experiencia", "formula": "-5000", "objetivo": "uno_mismo"})
    assert p["stats"]["Experiencia"] == 0
    partida._efecto_estadistica("Prueba", t, None, {"estadistica": "Furia", "formula": "5", "objetivo": "uno_mismo"})   # no es una estadística: nada


def test_efecto_de_campana_siempre_vale_para_todos(partida):
    partida.cfg["juego"]["efectos"] = [{"cuando": {"tipo": "siempre"}, "hacer": {"tipo": "bono_estadistica", "estadistica": "Agilidad", "valor": 1}}]
    _, t = personaje(partida)
    g = partida.colocar_enemigo("goblin", 6, 6)
    assert partida.bonos_de(t).get("Agilidad") == 1 and partida.bonos_de(g).get("Agilidad") == 1
