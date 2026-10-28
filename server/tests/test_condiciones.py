"""Condiciones de los efectos («solo si…»): validación al cargar la campaña y evaluación durante la partida."""
import random
import shutil

import pytest
import yaml

from mesa import efectos, recursos
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


def copiar(tmp_path):
    destino = tmp_path / "campana"
    shutil.copytree(CONFIG, destino)
    return destino


def escribir(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def rasgo(d, si, cuando="siempre", hacer=None, rid="prueba"):
    escribir(d / f"traits/{rid}.yaml", {"nombre": "Prueba", "efectos": [{"cuando": cuando, "si": si,
             "hacer": hacer or {"tipo": "bono_estadistica", "estadistica": "Fuerza", "valor": 3}}]})


def errores(d):
    _, inf = recursos.cargar(d)
    return inf.errores


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(5), persistir=False)


def personaje(partida, nombre="Thor", usuario="Ana", **kw):
    partida.registrar_usuario(usuario)
    p = partida.crear_personaje(usuario, False, "guerrero", nombre, **kw)
    t, _ = partida.desplegar_personaje(usuario, p["id"], usuario, False)
    return p, t


def extra(partida, t):
    """Fuerza que da el rasgo de prueba (la clase Guerrero ya suma +1 por su cuenta)."""
    return partida.bonos_de(t).get("Fuerza", 0) - 1


def dar_rasgo(partida, si, cuando="siempre", hacer=None):
    """Añade al catálogo un rasgo con condiciones y se lo da a la raza «humano»."""
    partida.cat.rasgos["prueba"] = {"nombre": "Prueba", "descripcion": "", "efectos": [{
        "cuando": {"tipo": cuando}, "si": si,
        "hacer": hacer or {"tipo": "bono_estadistica", "estadistica": "Fuerza", "valor": 3}}]}
    partida.cat.opciones["humano"]["rasgos"] = ["prueba"]


# ── Validación ──
def test_condiciones_validas_se_cargan(tmp_path):
    d = copiar(tmp_path)
    rasgo(d, [{"tipo": "recurso", "recurso": "HP", "valor": 50}, {"tipo": "tiene_estado", "estado": "veneno", "tiene": "no"},
              {"tipo": "lleva_objeto", "objeto": "antorcha"}, {"tipo": "es_opcion", "opcion": "elfo"},
              {"tipo": "momento_dia", "periodo": "Noche"}, {"tipo": "en_combate", "activo": "no"}])
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    si = cat.rasgos["prueba"]["efectos"][0]["si"]
    assert si[0] == {"tipo": "recurso", "quien": "uno_mismo", "recurso": "HP", "comparacion": "menos_de", "valor": 50, "unidad": "porcentaje"}
    assert [c["tipo"] for c in si] == ["recurso", "tiene_estado", "lleva_objeto", "es_opcion", "momento_dia", "en_combate"]


def test_sin_condiciones_el_efecto_queda_igual(catalogo):
    assert "si" not in catalogo.rasgos["toque_venenoso"]["efectos"][0]      # las campañas existentes no cambian


@pytest.mark.parametrize("si,texto", [
    ([{"tipo": "magia_negra"}], "condición desconocida «magia_negra»"),
    ([{"tipo": "recurso", "recurso": "Oro", "valor": 1}], "el recurso «Oro» no existe"),
    ([{"tipo": "recurso", "recurso": "HP", "valor": 150}], "no puede pasar de 100"),
    ([{"tipo": "tiene_estado", "estado": "nada"}], "el estado «nada» no existe"),
    ([{"tipo": "lleva_objeto", "objeto": "espada_fantasma"}], "el objeto «espada_fantasma» no existe"),
    ([{"tipo": "es_opcion", "opcion": "enano"}], "la opción (raza, clase…) «enano» no existe"),
    ([{"tipo": "momento_dia", "periodo": "Eclipse"}], "el momento del día «Eclipse» no existe"),
    ([{"tipo": "probabilidad", "porcentaje": 30}], "no se puede usar con «Siempre activo»"),
    ([{"tipo": "bando", "bando": "enemigo"}], "solo tiene sentido con «al_atacar»"),
    ([{"tipo": "estadistica", "estadistica": "Fuerza", "valor": "mucho"}], "debe ser un número entero"),
    ("probabilidad", "no se puede usar con «Siempre activo»"),    # una sola condición escrita como texto también vale
    (7, "«si» debe ser una lista"),
    ([{"tipo": "en_combate"}] * 11, "como mucho 10 condiciones"),
])
def test_condiciones_incorrectas_dan_errores_claros(tmp_path, si, texto):
    d = copiar(tmp_path)
    rasgo(d, si)
    assert any(texto in e for e in errores(d)), errores(d)


def test_probabilidad_fuera_de_rango(tmp_path):
    d = copiar(tmp_path)
    rasgo(d, [{"tipo": "probabilidad", "porcentaje": 0}], cuando="al_atacar",
          hacer={"tipo": "aplicar_estado", "estado": "veneno", "objetivo": "objetivo"})
    assert any("entre 1 y 100" in e for e in errores(d))


def test_momento_del_dia_sin_ciclo_es_aviso(tmp_path):
    d = copiar(tmp_path)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    cfg["juego"]["ciclo"]["activo"] = False
    escribir(d / "config.yaml", cfg)
    rasgo(d, [{"tipo": "momento_dia", "periodo": "Noche"}])
    _, inf = recursos.cargar(d)
    assert inf.ok and any("nunca se cumplirá" in a for a in inf.avisos)


def test_el_esquema_publico_incluye_las_condiciones_con_sus_textos():
    esq = efectos.esquema_publico()
    assert set(esq["condiciones"]) >= {"recurso", "estadistica", "tiene_estado", "lleva_objeto", "es_opcion", "bando", "momento_dia", "en_combate", "probabilidad"}
    for c in esq["condiciones"].values():
        assert c["nombre"]
        for campo in c["campos"].values():
            assert campo.get("etiqueta"), campo
            if campo["tipo"] == "opcion":
                assert set(campo["textos"]) == set(campo["opciones"])


# ── En la partida ──
def test_bono_solo_con_poca_vida(partida):
    dar_rasgo(partida, [{"tipo": "recurso", "quien": "uno_mismo", "recurso": "HP", "comparacion": "menos_de", "valor": 50, "unidad": "porcentaje"}])
    p, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    base = partida.stats_efectivas(t)["Fuerza"]
    assert extra(partida, t) == 0                                # con la vida llena no se cumple
    hp = p["recursos"]["HP"]
    hp["actual"] = hp["max"] // 2 - 1
    assert partida.stats_efectivas(t)["Fuerza"] == base + 3     # «Furia del herido»
    hp["actual"] = hp["max"]
    assert partida.stats_efectivas(t)["Fuerza"] == base


def test_recurso_en_puntos_y_comparaciones(partida):
    dar_rasgo(partida, [{"tipo": "recurso", "quien": "uno_mismo", "recurso": "HP", "comparacion": "igual_a", "valor": 7, "unidad": "puntos"}])
    p, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    p["recursos"]["HP"]["actual"] = 7
    assert extra(partida, t) == 3
    p["recursos"]["HP"]["actual"] = 8
    assert extra(partida, t) == 0


def test_vision_solo_de_noche(partida):
    partida.cfg["juego"]["niebla"].update(activa=True, vision_base=4)
    dar_rasgo(partida, [{"tipo": "momento_dia", "periodo": "Noche"}], hacer={"tipo": "bono_vision", "valor": 3})
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    partida.cambiar_periodo(0)
    assert partida.vision_de(t) == 4
    partida.cambiar_periodo(1)
    assert partida.vision_de(t) == 7                             # «visión nocturna»


def test_bono_si_lleva_un_objeto_o_no_tiene_un_estado(partida):
    dar_rasgo(partida, [{"tipo": "lleva_objeto", "quien": "uno_mismo", "tiene": "si", "objeto": "antorcha"},
                        {"tipo": "tiene_estado", "quien": "uno_mismo", "tiene": "no", "estado": "veneno"}])
    p, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    assert extra(partida, t) == 0
    p["inventario"].append({"objeto": "antorcha", "cantidad": 1})
    assert extra(partida, t) == 3                                # todas se cumplen
    t["estados"] = [{"id": "veneno", "turnos": 2}]
    assert extra(partida, t) == 0                                # basta con que una falle


def test_condicion_de_estadistica_sin_dar_vueltas(partida):
    # Un bono «siempre» que depende de la misma estadística que sube no debe entrar en bucle.
    dar_rasgo(partida, [{"tipo": "estadistica", "quien": "uno_mismo", "estadistica": "Fuerza", "comparacion": "al_menos", "valor": 1}])
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    assert extra(partida, t) == 3


def test_al_atacar_solo_contra_enemigos_y_con_probabilidad(partida):
    dar_rasgo(partida, [{"tipo": "bando", "quien": "objetivo", "bando": "enemigo"}, {"tipo": "probabilidad", "porcentaje": 100}],
              cuando="al_atacar", hacer={"tipo": "aplicar_estado", "estado": "veneno", "objetivo": "objetivo"})
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    goblin = partida.colocar_enemigo("goblin", 6, 6)
    tabernero = partida.colocar_enemigo("tabernero", 7, 6)
    partida.disparar("al_atacar", t, tabernero)
    assert partida.estados_de(tabernero) == []                   # es neutral: no se cumple
    partida.disparar("al_atacar", t, goblin)
    assert [e["id"] for e in partida.estados_de(goblin)] == ["veneno"]


def test_probabilidad_se_cumple_mas_o_menos_esa_parte_de_las_veces(partida):
    ef = {"cuando": {"tipo": "al_atacar"}, "si": [{"tipo": "probabilidad", "porcentaje": 25}], "hacer": {}}
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    veces = sum(partida.cumple(ef, t) for _ in range(4000))
    assert 800 < veces < 1200


def test_condiciones_sobre_el_objetivo_sin_objetivo_no_se_cumplen(partida):
    ef = {"si": [{"tipo": "tiene_estado", "quien": "objetivo", "tiene": "no", "estado": "veneno"}]}
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    assert partida.cumple(ef, t, None) is False


def test_en_combate_y_raza(partida):
    dar_rasgo(partida, [{"tipo": "en_combate", "activo": "si"}, {"tipo": "es_opcion", "quien": "uno_mismo", "tiene": "si", "opcion": "humano"}])
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    assert extra(partida, t) == 0
    partida.combate["activo"] = True
    assert extra(partida, t) == 3


def test_una_condicion_rota_no_rompe_la_partida(partida):
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    assert partida.cumple({"si": [{"tipo": "recurso"}]}, t) is False           # le faltan campos
    assert partida.cumple({"si": [{"tipo": "de_una_version_futura"}]}, t) is False


def test_la_campana_de_ejemplo_trae_vision_nocturna_para_los_elfos(partida):
    partida.cfg["juego"]["niebla"].update(activa=True, vision_base=4)
    _, t = personaje(partida, elecciones={"raza": "elfo", "clase": "guerrero"})
    partida.cambiar_periodo(0)
    assert partida.vision_de(t) == 4
    partida.cambiar_periodo(1)
    assert partida.vision_de(t) == 6
