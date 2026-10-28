"""Etiquetas (tipos, elementos…) y tabla de ventajas: validación, multiplicadores, ventaja() en fórmulas y condición «tiene etiqueta»."""
import random
import shutil

import pytest
import yaml

from mesa import formulas, recursos
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG

ETIQUETAS = [{"nombre": "Fuego", "color": "#d9531e"}, {"nombre": "Planta"}, {"nombre": "Agua"}, {"nombre": "No-muerto"}]
VENTAJAS = [{"atacante": "Fuego", "defensor": "Planta", "multiplicador": 2}, {"atacante": "Agua", "defensor": "Fuego", "multiplicador": 1.5},
            {"atacante": "Fuego", "defensor": "Agua", "multiplicador": 0.5}, {"atacante": "Fuego", "defensor": "No-muerto", "multiplicador": 0}]


def copiar(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    return d


def leer(p):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def escribir(p, datos):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def con_etiquetas(d, etiquetas=ETIQUETAS, ventajas=VENTAJAS):
    cfg = leer(d / "config.yaml")
    cfg["juego"]["etiquetas"], cfg["juego"]["ventajas"] = etiquetas, ventajas
    escribir(d / "config.yaml", cfg)


def errores(d):
    return recursos.cargar(d)[1].errores


def test_campana_con_etiquetas_valida(tmp_path):
    d = copiar(tmp_path)
    con_etiquetas(d)
    hab = leer(d / "abilities/bola_de_fuego.yaml"); hab["etiquetas"] = ["fuego"]; escribir(d / "abilities/bola_de_fuego.yaml", hab)
    op = leer(d / "options/elfo.yaml"); op["etiquetas"] = ["Planta"]; escribir(d / "options/elfo.yaml", op)
    npc = leer(d / "enemies/goblin.yaml"); npc["etiquetas"] = ["No-muerto"]; escribir(d / "enemies/goblin.yaml", npc)
    est = leer(d / "states/veneno.yaml"); est["etiquetas"] = ["Agua"]; escribir(d / "states/veneno.yaml", est)
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.habilidades["bola_de_fuego"]["etiquetas"] == ["Fuego"]            # se normaliza al nombre exacto
    assert cat.opciones["elfo"]["etiquetas"] == ["Planta"] and cat.enemigos["goblin"]["etiquetas"] == ["No-muerto"]
    assert cat.estados["veneno"]["etiquetas"] == ["Agua"]
    assert cat.config["juego"]["ventajas"][1] == {"atacante": "Agua", "defensor": "Fuego", "multiplicador": 1.5}
    assert cat.habilidades["curacion"]["etiquetas"] == []                        # lo de antes sigue igual


@pytest.mark.parametrize("etiquetas,ventajas,texto", [
    ([{"nombre": "A"}, {"nombre": "a"}], [], "ya hay otra etiqueta"),
    ([{"nombre": "Con;punto"}], [], "no llevar"),
    ([{"nombre": "A", "color": "rojo"}], [], "#rrggbb"),
    (ETIQUETAS, [{"atacante": "Fuego", "defensor": "Hielo", "multiplicador": 2}], "las dos deben ser etiquetas"),
    (ETIQUETAS, [{"atacante": "Fuego", "defensor": "Agua", "multiplicador": -1}], "entre 0 y 100"),
    (ETIQUETAS, [{"atacante": "Fuego", "defensor": "Agua", "multiplicador": 2}, {"atacante": "fuego", "defensor": "agua", "multiplicador": 3}], "repetida"),
])
def test_etiquetas_y_ventajas_incorrectas(tmp_path, etiquetas, ventajas, texto):
    d = copiar(tmp_path)
    con_etiquetas(d, etiquetas, ventajas)
    assert any(texto in e for e in errores(d)), errores(d)


def test_recurso_con_etiqueta_inexistente(tmp_path):
    d = copiar(tmp_path)
    con_etiquetas(d)
    hab = leer(d / "abilities/bola_de_fuego.yaml"); hab["etiquetas"] = ["Rayo"]; escribir(d / "abilities/bola_de_fuego.yaml", hab)
    assert any("«Rayo» no es una etiqueta" in e for e in errores(d))


def test_ventaja_en_formulas():
    assert formulas.evaluar("10 * ventaja()", ventaja=1.5).valor == 15
    assert formulas.evaluar("10 * ventaja()").valor == 10                       # sin etiquetas, ×1
    assert "ventaja=1,5" in formulas.evaluar("10 * ventaja()", ventaja=1.5).detalle
    assert formulas.validar("[a.Fuerza] * ventaja()", ["Fuerza"]) == []
    assert formulas.validar("ventaja(2)", ["Fuerza"])                          # no lleva argumentos


@pytest.fixture
def partida(catalogo, tmp_path):
    catalogo.config["juego"]["etiquetas"], catalogo.config["juego"]["ventajas"] = ETIQUETAS, VENTAJAS
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(2), persistir=False)


def test_multiplicador_simple_doble_e_inmune(partida):
    m = partida.multiplicador_ventaja
    assert m(["Fuego"], ["Planta"]) == 2 and m(["Agua"], ["Fuego"]) == 1.5 and m(["Fuego"], ["Agua"]) == 0.5
    assert m(["Fuego"], ["Planta", "Agua"]) == 1          # 2 × 0,5: los dos tipos del objetivo cuentan
    assert m(["Fuego"], ["No-muerto"]) == 0               # inmune
    assert m([], ["Planta"]) == 1 and m(["Planta"], ["Fuego"]) == 1


def test_etiquetas_de_opciones_npc_y_estados(partida):
    partida.cat.opciones["elfo"]["etiquetas"] = ["Planta"]
    partida.cat.enemigos["goblin"]["etiquetas"] = ["No-muerto"]
    partida.cat.estados["veneno"]["etiquetas"] = ["Agua"]
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Lia", elecciones={"raza": "elfo", "clase": "guerrero"})
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    assert partida.etiquetas_de(t) == ["Planta"]
    t["estados"] = [{"id": "veneno", "turnos": 2}]
    assert partida.etiquetas_de(t) == ["Planta", "Agua"]   # «Mojado» y similares añaden etiquetas mientras duran
    g = partida.colocar_enemigo("goblin", 6, 6)
    assert partida.etiquetas_de(g) == ["No-muerto"]
    vista = partida.vista_token(t, "Ana", False)
    assert vista["etiquetas"] == ["Planta", "Agua"]


def test_la_habilidad_aplica_la_ventaja(partida):
    partida.cat.opciones["orco"]["etiquetas"] = ["Planta"]
    partida.cat.habilidades["llamarada"] = {"nombre": "Llamarada", "descripcion": "", "imagen": "", "tipo": "dano", "objetivo": "cualquiera",
                                            "alcance": 99, "coste": {}, "valores": {}, "etiquetas": ["Fuego"], "formula": "10 * ventaja()"}
    partida.registrar_usuario("Ana")
    a = partida.crear_personaje("Ana", False, "guerrero", "Thor")
    a["habilidades"].append("llamarada")
    ta, _ = partida.desplegar_personaje("Ana", a["id"], "Ana", False)
    g = partida.colocar_enemigo("goblin", 6, 6)
    vida = g["recursos"]["HP"]["actual"]
    texto, _ = partida.usar_habilidad(ta["id"], "llamarada", g["id"], "Ana", True)
    assert g["recursos"]["HP"]["actual"] == vida - 10 and "ventaja=1" in texto          # el goblin no tiene etiquetas: ×1
    partida.cat.enemigos["goblin"]["etiquetas"] = ["Planta"]
    vida = g["recursos"]["HP"]["actual"]
    partida.usar_habilidad(ta["id"], "llamarada", g["id"], "Ana", True)
    assert g["recursos"]["HP"]["actual"] == vida - 20                                     # Fuego contra Planta: ×2


def test_condicion_tiene_etiqueta(tmp_path, partida):
    partida.cat.enemigos["goblin"]["etiquetas"] = ["No-muerto"]
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Thor")
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    g = partida.colocar_enemigo("goblin", 6, 6)
    ef = {"si": [{"tipo": "tiene_etiqueta", "quien": "objetivo", "tiene": "si", "etiqueta": "No-muerto"}]}
    assert partida.cumple(ef, t, g) is True and partida.cumple(ef, t, t) is False
    d = copiar(tmp_path)
    con_etiquetas(d)
    escribir(d / "traits/caza.yaml", {"nombre": "Cazador de muertos", "efectos": [{"cuando": "al_atacar",
             "si": [{"tipo": "tiene_etiqueta", "quien": "objetivo", "etiqueta": "no-muerto"}],
             "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-5", "objetivo": "objetivo"}}]})
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.rasgos["caza"]["efectos"][0]["si"][0]["etiqueta"] == "No-muerto"
    escribir(d / "traits/caza.yaml", {"nombre": "X", "efectos": [{"cuando": "al_atacar", "si": [{"tipo": "tiene_etiqueta", "etiqueta": "Dragón"}],
             "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-5"}}]})
    assert any("la etiqueta «Dragón» no existe" in e for e in errores(d))
