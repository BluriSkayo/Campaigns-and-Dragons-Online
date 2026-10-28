"""Grupos que dependen de otra elección, iniciativa por opción, objetos con efectos «Al usarlo», «Quitar un estado»
y «Al cambiar el momento del día»."""
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


def escribir(p, datos):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def errores(d):
    return recursos.cargar(d)[1].errores


# ── Validación ──
def test_solo_si_valido_e_invalido(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "groups/especialidad.yaml", {"nombre": "Especialidad", "obligatorio": True, "solo_si": {"grupo": "clase", "opciones": ["mago"]}})
    escribir(d / "options/pirotecnia.yaml", {"grupo": "especialidad", "nombre": "Pirotecnia"})
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.grupos["especialidad"]["solo_si"] == {"grupo": "clase", "opciones": ["mago"]}
    assert "solo_si" not in cat.grupos["raza"]
    escribir(d / "groups/especialidad.yaml", {"nombre": "Especialidad", "solo_si": {"grupo": "clase", "opciones": ["elfo"]}})
    assert any("no son del grupo «clase»" in e for e in errores(d))
    escribir(d / "groups/especialidad.yaml", {"nombre": "Especialidad", "solo_si": {"grupo": "nada", "opciones": ["x"]}})
    assert any("debe ser otro grupo" in e for e in errores(d))


def test_solo_si_en_circulo(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "groups/a.yaml", {"nombre": "A", "solo_si": {"grupo": "b", "opciones": ["ob"]}})
    escribir(d / "groups/b.yaml", {"nombre": "B", "solo_si": {"grupo": "a", "opciones": ["oa"]}})
    escribir(d / "options/oa.yaml", {"grupo": "a", "nombre": "OA"})
    escribir(d / "options/ob.yaml", {"grupo": "b", "nombre": "OB"})
    assert any("en círculo" in e for e in errores(d))


def test_objetos_e_iniciativa_validos(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "items/antidoto.yaml", {"nombre": "Antídoto", "tipo": "consumible",
             "efectos": [{"cuando": "al_usar", "hacer": {"tipo": "quitar_estado", "estado": "veneno"}}]})
    escribir(d / "options/mago.yaml", {**yaml.safe_load((d / "options/mago.yaml").read_text(encoding="utf-8")), "iniciativa": "Poder Mágico"})
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.objetos["antidoto"]["efectos"][0]["cuando"]["tipo"] == "al_usar" and cat.opciones["mago"]["iniciativa"] == "Poder Mágico"
    escribir(d / "items/antidoto.yaml", {"nombre": "Antídoto", "efectos": [{"cuando": "siempre", "hacer": {"tipo": "quitar_estado", "estado": "veneno"}}]})
    assert any("usa «Al usarlo»" in e for e in errores(d))
    escribir(d / "items/antidoto.yaml", {"nombre": "Antídoto", "efectos": [{"cuando": "al_usar", "hacer": {"tipo": "quitar_estado", "estado": "veneno", "objetivo": "objetivo"}}]})
    assert any("Sobre sí mismo" in e for e in errores(d))
    escribir(d / "traits/x.yaml", {"nombre": "X", "efectos": [{"cuando": "al_usar", "hacer": {"tipo": "quitar_estado", "estado": "veneno"}}]})
    assert any("solo se puede usar en objetos" in e for e in errores(d))


# ── En la partida ──
@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(4), persistir=False)


def test_grupo_condicionado_al_crear(partida):
    partida.cat.grupos["especialidad"] = {"nombre": "Especialidad", "descripcion": "", "obligatorio": True, "solo_si": {"grupo": "clase", "opciones": ["mago"]}}
    partida.cat.opciones["pirotecnia"] = {"nombre": "Pirotecnia", "descripcion": "", "imagen": "", "grupo": "especialidad", "bonos": {}, "estadisticas": {},
                                          "recursos": {}, "puntos_extra": 0, "rasgos": [], "habilidades": [], "etiquetas": [], "iniciativa": ""}
    partida.registrar_usuario("Ana")
    partida.crear_personaje("Ana", False, "guerrero", "Sin especialidad", elecciones={"raza": "orco", "clase": "guerrero"})       # no le corresponde: no se exige
    with pytest.raises(ErrorJuego, match="no corresponde"):
        partida.crear_personaje("Ana", False, "guerrero", "Mal", elecciones={"raza": "orco", "clase": "guerrero", "especialidad": "pirotecnia"})
    with pytest.raises(ErrorJuego, match="Debes elegir una opción de «Especialidad»"):
        partida.crear_personaje("Ana", False, "guerrero", "Falta", elecciones={"raza": "elfo", "clase": "mago"})
    partida.cfg["permisos"]["max_personajes_por_jugador"] = 10
    p = partida.crear_personaje("Ana", False, "guerrero", "Bien", elecciones={"raza": "elfo", "clase": "mago", "especialidad": "pirotecnia"})
    assert p["elecciones"]["especialidad"] == "pirotecnia"


def test_iniciativa_por_opcion(partida):
    partida.cat.opciones["mago"]["iniciativa"] = "Poder Mágico"
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Merlín", elecciones={"raza": "elfo", "clase": "mago"})
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    g = partida.colocar_enemigo("goblin", 6, 6)
    assert partida.estadistica_iniciativa(t) == "Poder Mágico" and partida.estadistica_iniciativa(g) == "Agilidad"


def test_objeto_que_quita_un_estado_y_suma_experiencia(partida):
    partida.cat.objetos["antidoto"] = {"nombre": "Antídoto", "descripcion": "", "imagen": "", "tipo": "consumible", "precio": 5, "efecto": None,
                                       "efectos": [{"cuando": {"tipo": "al_usar"}, "hacer": {"tipo": "quitar_estado", "estado": "veneno", "objetivo": "uno_mismo"}},
                                                   {"cuando": {"tipo": "al_usar"}, "si": [{"tipo": "tiene_estado", "quien": "uno_mismo", "tiene": "no", "estado": "veneno"}],
                                                    "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-1", "objetivo": "uno_mismo"}}]}
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Thor")
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    p["inventario"].append({"objeto": "antidoto", "cantidad": 1})
    t["estados"] = [{"id": "veneno", "turnos": 3}]
    vida = p["recursos"]["HP"]["actual"]
    texto, _ = partida.usar_objeto(t["id"], "antidoto", "Ana", True)
    assert "usó Antídoto" in texto and t["estados"] == []
    assert p["recursos"]["HP"]["actual"] == vida - 1          # los efectos se miran en orden: ya sin veneno, el segundo se cumple
    assert not any(e["objeto"] == "antidoto" for e in p["inventario"])        # consumible: se gasta
    chat, _ = partida.vaciar_colas()
    assert any("ya no sufre «Veneno»" in c[0] for c in chat)
    with pytest.raises(ErrorJuego, match="No tienes ese objeto"):
        partida.usar_objeto(t["id"], "antidoto", "Ana", True)


def test_al_cambiar_el_momento_del_dia(partida):
    partida.cat.estados["hambre"] = {"nombre": "Hambre", "descripcion": "", "imagen": "", "duracion": 0, "etiquetas": [],
                                     "efectos": [{"cuando": {"tipo": "al_cambiar_momento"}, "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-5", "objetivo": "uno_mismo"}}]}
    partida.registrar_usuario("Ana")
    p = partida.crear_personaje("Ana", False, "guerrero", "Thor")
    t, _ = partida.desplegar_personaje("Ana", p["id"], "Ana", False)
    t["estados"] = [{"id": "hambre", "turnos": 0}]
    vida = p["recursos"]["HP"]["actual"]
    partida.cambiar_periodo(1)
    assert p["recursos"]["HP"]["actual"] == vida - 5
