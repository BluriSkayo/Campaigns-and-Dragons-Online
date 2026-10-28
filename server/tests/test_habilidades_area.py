"""Habilidades con área (explosión, línea, frente), varios golpes, [Distancia], atraer/empujar, alcance sin límite,
requisitos y efectos «al alcanzar a cada objetivo»."""
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
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(3), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    t, _ = e.desplegar_personaje("Ana", p["id"], "Ana", False, 1, 10)
    e.yo = t
    return e


def hab(partida, **extra):
    """Una copia de «ataque_basico» con cambios, que el personaje conoce."""
    base = dict(partida.cat.habilidades["ataque_basico"])
    base.update({"formula": "10", "area": {"forma": "uno", "tamano": 1, "afecta": "rivales"}, "golpes": 1, "sin_limite": False,
                 "mover_objetivo": None, "requisitos": [], "efectos": []})
    base.update(extra)
    partida.cat.habilidades["prueba"] = base
    datos = partida.datos_de(partida.yo)
    if "prueba" not in datos["habilidades"]:
        datos["habilidades"].append("prueba")
    return base


def vida(partida, t):
    return partida.datos_de(t)["recursos"][partida.cat.recurso_vida()]["actual"]


def test_linea_atraviesa_y_respeta_el_alcance(partida):
    hab(partida, alcance=4, area={"forma": "linea", "tamano": 1, "afecta": "rivales"})
    g1, g2, g3 = (partida.colocar_enemigo("goblin", x, 10) for x in (2, 4, 6))
    v = [vida(partida, g) for g in (g1, g2, g3)]
    texto, ids = partida.usar_habilidad(partida.yo["id"], "prueba", g1["id"], "Ana", False)
    assert vida(partida, g1) == v[0] - 10 and vida(partida, g2) == v[1] - 10
    assert vida(partida, g3) == v[2]                        # x=6 queda a 5 casillas: fuera de la línea
    assert g1["id"] in ids and g2["id"] in ids and "usó" in texto


def test_linea_sin_limite_y_a_una_casilla(partida):
    hab(partida, alcance=1, sin_limite=True, area={"forma": "linea", "tamano": 1, "afecta": "rivales"})
    lejos = partida.colocar_enemigo("goblin", 15, 10)
    antes = vida(partida, lejos)
    partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(2, 10))   # apuntando a una casilla vacía
    assert vida(partida, lejos) == antes - 10


def test_linea_que_tambien_da_a_aliados(partida):
    hab(partida, alcance=6, area={"forma": "linea", "tamano": 1, "afecta": "todos"})
    partida.cfg["permisos"]["max_personajes_por_jugador"] = 5
    p2 = partida.crear_personaje("Ana", False, "guerrero", "Loki")
    amigo, _ = partida.desplegar_personaje("Ana", p2["id"], "Ana", False, 2, 10)
    g = partida.colocar_enemigo("goblin", 3, 10)
    va, vg = vida(partida, amigo), vida(partida, g)
    partida.cfg["permisos"]["atacar"] = "todos"
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert vida(partida, amigo) == va - 10 and vida(partida, g) == vg - 10
    assert vida(partida, partida.yo) == partida.datos_de(partida.yo)["recursos"][partida.cat.recurso_vida()]["max"]


def test_rivales_no_toca_aliados(partida):
    hab(partida, alcance=6, area={"forma": "linea", "tamano": 1, "afecta": "rivales"})
    partida.cfg["permisos"]["max_personajes_por_jugador"] = 5
    p2 = partida.crear_personaje("Ana", False, "guerrero", "Loki")
    amigo, _ = partida.desplegar_personaje("Ana", p2["id"], "Ana", False, 2, 10)
    partida.colocar_enemigo("goblin", 3, 10)
    va = vida(partida, amigo)
    partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(3, 10))
    assert vida(partida, amigo) == va


def test_explosion_y_frente(partida):
    hab(partida, alcance=8, area={"forma": "explosion", "tamano": 1, "afecta": "rivales"})
    a, b, c = partida.colocar_enemigo("goblin", 8, 10), partida.colocar_enemigo("goblin", 9, 9), partida.colocar_enemigo("goblin", 8, 8)
    va, vb, vc = vida(partida, a), vida(partida, b), vida(partida, c)
    partida.usar_habilidad(partida.yo["id"], "prueba", a["id"], "Ana", False)
    assert vida(partida, a) == va - 10 and vida(partida, b) == vb - 10 and vida(partida, c) == vc     # c queda a 2
    assert partida.celdas_area(partida.yo, (2, 10), {"area": {"forma": "frente", "tamano": 3}, "alcance": 1}) == [(2, 9), (2, 10), (2, 11)]
    with pytest.raises(ErrorJuego, match="nadie"):
        partida.usar_habilidad(partida.yo["id"], "prueba", None, "Ana", False, casilla=(1, 7))


def test_varios_golpes_y_distancia(partida):
    hab(partida, alcance=8, golpes=2, formula="[Distancia] * 10 + 1d1")
    g = partida.colocar_enemigo("goblin", 4, 10)                     # a 3 casillas → 31 por golpe
    antes = vida(partida, g)
    texto, _ = partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", True)
    assert vida(partida, g) == max(0, antes - 62) and "(31 + 31)" in texto


def test_atraer_y_empujar(partida):
    hab(partida, alcance=5, formula="0", mover_objetivo={"modo": "atraer", "casillas": 0})
    g = partida.colocar_enemigo("goblin", 6, 10)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert (g["x"], g["y"]) == (2, 10)
    hab(partida, alcance=5, formula="0", mover_objetivo={"modo": "empujar", "casillas": 2})
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert (g["x"], g["y"]) == (4, 10)


def test_requisitos_y_efectos_al_alcanzar(partida):
    partida.cfg["juego"]["etiquetas"] = [{"nombre": "Volador"}]
    hab(partida, alcance=5, requisitos=[{"tipo": "tiene_etiqueta", "quien": "objetivo", "tiene": "no", "etiqueta": "Volador"}],
        efectos=[{"cuando": {"tipo": "al_impactar"}, "hacer": {"tipo": "aplicar_estado", "estado": "veneno", "objetivo": "objetivo"}}])
    g = partida.colocar_enemigo("goblin", 3, 10)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert any(e["id"] == "veneno" for e in g.get("estados", []))
    partida.cat.enemigos["goblin"]["etiquetas"] = ["Volador"]
    with pytest.raises(ErrorJuego, match="Volador"):
        partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)


def test_validacion_de_los_campos_nuevos(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    ruta = d / "abilities/ataque_basico.yaml"
    h = yaml.safe_load(ruta.read_text(encoding="utf-8"))
    h.update({"sin_limite": True, "golpes": 2, "formula": "[Distancia] + 1", "area": {"forma": "linea", "afecta": "todos"},
              "mover_objetivo": {"modo": "atraer"}, "requisitos": [{"tipo": "en_combate", "activo": "si"}],
              "efectos": [{"cuando": "al_impactar", "hacer": {"tipo": "aplicar_estado", "estado": "veneno", "objetivo": "objetivo"}}]})
    ruta.write_text(yaml.safe_dump(h, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    a = cat.habilidades["ataque_basico"]
    assert a["area"] == {"forma": "linea", "tamano": 1, "afecta": "todos"} and a["mover_objetivo"] == {"modo": "atraer", "casillas": 0}
    h.update({"golpes": 99, "area": {"forma": "cuadrado"}, "requisitos": [{"tipo": "probabilidad", "porcentaje": 5}], "objetivo": "uno_mismo"})
    h["area"] = {"forma": "linea"}
    ruta.write_text(yaml.safe_dump(h, allow_unicode=True), encoding="utf-8")
    errores = " ".join(recursos.cargar(d)[1].errores)
    assert "golpes" in errores and "probabilidad" in errores and "sí mismo" in errores
    # «al_impactar» solo en habilidades
    r = d / "traits"
    r.mkdir(exist_ok=True)
    (r / "raro.yaml").write_text(yaml.safe_dump({"nombre": "Raro", "efectos": [{"cuando": "al_impactar", "hacer": {"tipo": "aplicar_estado", "estado": "veneno"}}]}), encoding="utf-8")
    assert any("solo se puede usar en habilidades" in e for e in recursos.cargar(d)[1].errores)


def test_ventaja_con_las_etiquetas_de_quien_la_usa(partida):
    partida.cfg["juego"]["etiquetas"] = [{"nombre": "Fuego"}, {"nombre": "Planta"}]
    partida.cfg["juego"]["ventajas"] = [{"atacante": "Fuego", "defensor": "Planta", "multiplicador": 2}]
    partida.cat.enemigos["goblin"]["etiquetas"] = ["Planta"]
    partida.etiquetas_de = (lambda orig: (lambda t: ["Fuego"] if t is partida.yo else orig(t)))(partida.etiquetas_de)
    hab(partida, alcance=5, formula="10 * ventaja()")
    g = partida.colocar_enemigo("goblin", 3, 10)
    antes = vida(partida, g)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert vida(partida, g) == antes - 10
    hab(partida, alcance=5, formula="10 * ventaja()", etiquetas_del_usuario=True)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert vida(partida, g) == antes - 30


def test_inventario_comun_inicial(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    obj = next(iter(recursos.cargar(d)[0].objetos))
    cfg["juego"]["inventario_grupo_inicial"] = {"inventario": [{"objeto": obj, "cantidad": 7}], "dinero": 1700}
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    e = EstadoPartida(cat, tmp_path / "datos", persistir=False)
    assert e.cofres["comun"]["inventario"] == [{"objeto": obj, "cantidad": 7}] and e.cofres["comun"]["dinero"] == 1700
    cfg["juego"]["inventario_grupo_inicial"] = {"inventario": [{"objeto": "no_existe"}]}
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    assert any("no_existe" in x for x in recursos.cargar(d)[1].errores)


def test_no_sin_comillas_se_entiende(tmp_path):
    """«transformacion: no» o «tiene: no» escritos a mano (YAML 1.1 los lee como falso) siguen valiendo."""
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    ruta = d / "abilities/ataque_basico.yaml"
    ruta.write_text(ruta.read_text(encoding="utf-8") + "\nrequisitos:\n  - tipo: tiene_estado\n    quien: objetivo\n    tiene: no\n    estado: veneno\n", encoding="utf-8")
    g = next((d / "groups").glob("*.yaml"))
    g.write_text(g.read_text(encoding="utf-8") + "\ntransformacion: no\n", encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.habilidades["ataque_basico"]["requisitos"][0]["tiene"] == "no"


def test_al_atacar_aunque_el_golpe_derribe(partida):
    """La regla «al atacar» (gastar munición, cargas…) se aplica aunque el golpe derribe al objetivo."""
    partida.cfg["juego"]["efectos"] = [{"cuando": {"tipo": "al_atacar"}, "hacer": {"tipo": "quitar_estado", "estado": "veneno", "objetivo": "uno_mismo"}}]
    partida.yo.setdefault("estados", []).append({"id": "veneno", "turnos": 3})
    hab(partida, alcance=5, formula="9999")
    g = partida.colocar_enemigo("goblin", 3, 10)
    partida.usar_habilidad(partida.yo["id"], "prueba", g["id"], "Ana", False)
    assert partida.derrotado(g) and not any(e["id"] == "veneno" for e in partida.yo["estados"])


def test_la_forma_elegida_al_crear_pone_su_imagen(partida):
    grupo = next(iter(partida.cat.grupos))
    op = partida.cat.opciones_de(grupo)[0]
    partida.cat.opciones[op]["imagen_forma"] = "tokens/forma.png"
    partida.cfg["permisos"]["max_personajes_por_jugador"] = 5
    el = {g: partida.cat.opciones_de(g)[0] for g, gd in partida.cat.grupos.items() if partida.cat.opciones_de(g) and partida.grupo_activo(g, {grupo: op})}
    p = partida.crear_personaje("Ana", False, None, "Lobo", elecciones=el, imagen="tokens/propia.png")
    assert p["imagen"] == "tokens/forma.png" and p["imagen_propia"] == "tokens/propia.png"
