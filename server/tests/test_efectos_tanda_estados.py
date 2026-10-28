"""Piezas genéricas para estados (27-oct-2026): redirigir el ataque (confusión, reflejo), impedir la acción, «al intentar»,
«al recibir daño», «al cruzar un umbral», «al terminar este estado», escudos, volver a aplicar (cargas), impedir por etiqueta
y condiciones nuevas (crítico, daño, ronda, tiene habilidad, actúa antes, cargas)."""
import random
import shutil

import pytest
import yaml

from mesa import efectos, recursos
from mesa.errores import ErrorJuego
from tests.conftest import CONFIG, combatir
from tests.test_habilidades_area import hab, partida, vida  # noqa: F401  (partida es una fixture)


def estado(partida, eid, efectos_=(), **extra):
    partida.cat.estados[eid] = {"nombre": eid.capitalize(), "descripcion": "", "imagen": "", "color": "", "duracion": 0, "etiquetas": [],
                                "impide": [], "al_terminar": "", "al_reaplicar": "renovar", "max_cargas": 5, "impide_etiquetas": [],
                                "efectos": list(efectos_), **extra}
    return partida.cat.estados[eid]


def ef(cuando, hacer, si=None):
    e = {"cuando": cuando if isinstance(cuando, dict) else {"tipo": cuando}, "hacer": hacer}
    if si:
        e["si"] = si
    return e


def poner(partida, token, eid, **extra):
    token.setdefault("estados", []).append({"id": eid, "turnos": 0, **extra})


def tiene(token, eid):
    return any(e["id"] == eid for e in token.get("estados", []))


@pytest.fixture
def goblin(partida):
    hab(partida, alcance=5, formula="10")
    return partida.colocar_enemigo("goblin", 3, 10)


# ── Redirigir el ataque ──────────────────────────────────────────
def test_confusion_se_golpea_a_si_mismo(partida, goblin):
    estado(partida, "confusion", [ef({"tipo": "al_intentar", "accion": "atacar"}, {"tipo": "redirigir_ataque", "hacia": "quien_ataca"})])
    poner(partida, partida.yo, "confusion")
    yo0, g0 = vida(partida, partida.yo), vida(partida, goblin)
    texto, ids = partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert vida(partida, partida.yo) == yo0 - 10 and vida(partida, goblin) == g0
    assert "se golpea a sí mismo" in texto and partida.yo["id"] in ids


def test_confusion_hacia_otro_al_azar(partida, goblin):
    otro = partida.colocar_enemigo("goblin", 5, 10)
    estado(partida, "confusion", [ef({"tipo": "al_intentar", "accion": "atacar"}, {"tipo": "redirigir_ataque", "hacia": "aleatorio"})])
    poner(partida, partida.yo, "confusion")
    yo0, total0 = vida(partida, partida.yo), vida(partida, goblin) + vida(partida, otro)
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert vida(partida, partida.yo) == yo0 and vida(partida, goblin) + vida(partida, otro) == total0 - 10


def test_confusion_con_probabilidad_cero_veces_no_desvia(partida, goblin):
    estado(partida, "confusion", [ef({"tipo": "al_intentar", "accion": "atacar"}, {"tipo": "redirigir_ataque", "hacia": "quien_ataca"},
                                     si=[{"tipo": "probabilidad", "porcentaje": 1}])])
    poner(partida, partida.yo, "confusion")
    partida.rng = random.Random(0)
    partida.rng.random = lambda: 0.99          # nunca sale el 1 %
    g0 = vida(partida, goblin)
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert vida(partida, goblin) == g0 - 10


def test_reflejo_rebota_al_atacante(partida, goblin):
    estado(partida, "reflejo", [ef("al_ser_atacado", {"tipo": "redirigir_ataque", "hacia": "quien_ataca"})])
    poner(partida, goblin, "reflejo")
    yo0, g0 = vida(partida, partida.yo), vida(partida, goblin)
    texto, ids = partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert vida(partida, goblin) == g0 and vida(partida, partida.yo) == yo0 - 10
    assert "el golpe va a Thor" in texto


# ── Impedir y «al intentar» ──────────────────────────────────────
def test_impedir_la_accion_no_gasta_nada_y_avisa(partida, goblin):
    estado(partida, "miedo", [ef({"tipo": "al_intentar", "accion": "atacar"}, {"tipo": "impedir_accion"})])
    poner(partida, partida.yo, "miedo")
    partida.cat.habilidades["prueba"]["coste"] = {"MP": 5}
    mp0, g0 = partida.datos_de(partida.yo)["recursos"]["MP"]["actual"], vida(partida, goblin)
    with pytest.raises(ErrorJuego, match="Miedo"):
        partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert partida.datos_de(partida.yo)["recursos"]["MP"]["actual"] == mp0 and vida(partida, goblin) == g0
    chat, _ = partida.vaciar_colas()
    assert any("🚫" in t and "no lo consigue" in t for t, _ in chat)
    partida.mover_token(partida.yo["id"], 2, 10, "Ana", False)         # moverse sí puede: solo impide atacar


def test_hemorragia_al_moverse(partida):
    estado(partida, "hemorragia", [ef({"tipo": "al_intentar", "accion": "mover"}, {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-2"})])
    poner(partida, partida.yo, "hemorragia")
    v0 = vida(partida, partida.yo)
    partida.mover_token(partida.yo["id"], 2, 10, "Ana", False)
    assert vida(partida, partida.yo) == v0 - 2


def test_al_intentar_usar_un_objeto(partida):
    estado(partida, "torpe", [ef({"tipo": "al_intentar", "accion": "objeto"}, {"tipo": "impedir_accion"})])
    poner(partida, partida.yo, "torpe")
    with pytest.raises(ErrorJuego, match="usar el objeto"):
        partida.usar_objeto(partida.yo["id"], "pocion", "Ana", False)


# ── Daño, umbrales y escudos ─────────────────────────────────────
def test_al_recibir_dano_con_condicion_de_cuanto(partida, goblin):
    estado(partida, "enfurecido")
    estado(partida, "rabia", [ef("al_recibir_dano", {"tipo": "aplicar_estado", "estado": "enfurecido"},
                                 si=[{"tipo": "dano", "comparacion": "al_menos", "valor": 15}])])
    poner(partida, goblin, "rabia")
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)        # 10: no llega
    assert not tiene(goblin, "enfurecido")
    partida.cat.habilidades["prueba"]["formula"] = "20"
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert tiene(goblin, "enfurecido")


def test_al_recibir_dano_tambien_por_veneno(partida):
    estado(partida, "herido")
    estado(partida, "veneno2", [ef("inicio_turno", {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-3"})])
    estado(partida, "aviso", [ef("al_recibir_dano", {"tipo": "aplicar_estado", "estado": "herido"})])
    poner(partida, partida.yo, "veneno2")
    poner(partida, partida.yo, "aviso")
    partida.al_empezar_turno(partida.yo)
    assert tiene(partida.yo, "herido")


def test_al_cruzar_un_umbral_salta_una_vez(partida, goblin):
    estado(partida, "furia")
    estado(partida, "sangre_fria", [ef({"tipo": "al_cruzar_umbral", "recurso": "HP", "sentido": "baja", "porcentaje": 50},
                                       {"tipo": "aplicar_estado", "estado": "furia"})])
    poner(partida, goblin, "sangre_fria")
    vg = partida.datos_de(goblin)["recursos"]["HP"]                    # máximo 45: el 50 % es 22,5
    vg["actual"] = 30
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)       # 30 → 20: cruza
    assert tiene(goblin, "furia")
    goblin["estados"] = [e for e in goblin["estados"] if e["id"] != "furia"]
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)       # 20 → 10: ya estaba por debajo
    assert not tiene(goblin, "furia")


def test_escudo_absorbe_con_un_recurso(partida, goblin):
    estado(partida, "escudo", [ef("siempre", {"tipo": "absorber_dano", "recurso": "MP"})])
    poner(partida, partida.yo, "escudo")
    partida.datos_de(partida.yo)["recursos"]["MP"]["actual"] = 4
    partida.cat.habilidades["prueba"]["formula"] = "10"
    partida.datos_de(goblin)["habilidades"] = ["prueba"]
    v0 = vida(partida, partida.yo)
    texto, _ = partida.usar_habilidad(goblin["id"], "prueba", partida.yo["id"], "GM", True)
    assert partida.datos_de(partida.yo)["recursos"]["MP"]["actual"] == 0 and vida(partida, partida.yo) == v0 - 6
    assert "absorbe 4" in texto


# ── Volver a aplicar, cargas y «al terminar» ─────────────────────
def test_acumular_cargas_con_tope_y_formula(partida):
    estado(partida, "sangrado", [ef("inicio_turno", {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-2 * [Cargas]"})],
           al_reaplicar="acumular", max_cargas=3, duracion=3)
    for _ in range(5):
        partida.poner_estado(partida.yo, "sangrado")
    e = next(x for x in partida.yo["estados"] if x["id"] == "sangrado")
    assert e["cargas"] == 3 and e["turnos"] == 3
    v0 = vida(partida, partida.yo)
    partida.al_empezar_turno(partida.yo)
    assert vida(partida, partida.yo) == v0 - 6
    assert partida.vista_token(partida.yo, "Ana", False)["estados"][0]["cargas"] == 3


def test_bono_por_carga_y_condicion_de_cargas(partida, goblin):
    estado(partida, "foco", [ef("siempre", {"tipo": "bono_estadistica", "estadistica": "Fuerza", "valor": 1})], al_reaplicar="acumular")
    base = partida.stats_efectivas(partida.yo)["Fuerza"]
    for _ in range(3):
        partida.poner_estado(partida.yo, "foco")
    assert partida.stats_efectivas(partida.yo)["Fuerza"] == base + 3
    estado(partida, "marcado")
    estado(partida, "cazador", [ef("al_atacar", {"tipo": "aplicar_estado", "estado": "marcado", "objetivo": "objetivo"},
                                   si=[{"tipo": "cargas", "quien": "uno_mismo", "estado": "foco", "comparacion": "al_menos", "valor": 3}])])
    poner(partida, partida.yo, "cazador")
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert tiene(goblin, "marcado")


def test_ignorar_y_sumar_duracion(partida):
    estado(partida, "fijo", al_reaplicar="ignorar", duracion=2)
    estado(partida, "largo", al_reaplicar="sumar", duracion=2)
    assert partida.poner_estado(partida.yo, "fijo") and partida.poner_estado(partida.yo, "fijo") is None
    partida.poner_estado(partida.yo, "largo")
    partida.poner_estado(partida.yo, "largo")
    assert next(e for e in partida.yo["estados"] if e["id"] == "largo")["turnos"] == 4


def test_al_terminar_este_estado_por_tiempo_o_quitado(partida):
    estado(partida, "marca", [ef({"tipo": "al_terminar_estado", "motivo": "se_acaba"}, {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-5"})],
           duracion=1)
    partida.poner_estado(partida.yo, "marca")
    v0 = vida(partida, partida.yo)
    partida.al_terminar_turno(partida.yo)                   # se acaba: explota
    assert not tiene(partida.yo, "marca") and vida(partida, partida.yo) == v0 - 5
    partida.poner_estado(partida.yo, "marca")
    partida.gm_estado(partida.yo["id"], "marca", False)     # se la quitan: con «porque se acaba» no hace nada
    assert vida(partida, partida.yo) == v0 - 5


# ── Impedir por etiqueta ─────────────────────────────────────────
def test_silencio_solo_bloquea_habilidades_con_esa_etiqueta(partida, goblin):
    partida.cfg["juego"]["etiquetas"] = [{"nombre": "Magia", "color": ""}]
    estado(partida, "silencio", impide_etiquetas=["Magia"])
    poner(partida, partida.yo, "silencio")
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)           # sin etiqueta: se puede
    partida.cat.habilidades["prueba"]["etiquetas"] = ["Magia"]
    with pytest.raises(ErrorJuego, match="Silencio.*Magia"):
        partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)


# ── Condiciones nuevas ───────────────────────────────────────────
def test_condicion_critico(partida, goblin):
    estado(partida, "aturdido")
    estado(partida, "brutal", [ef("al_atacar", {"tipo": "aplicar_estado", "estado": "aturdido", "objetivo": "objetivo"}, si=[{"tipo": "critico", "es": "si"}])])
    poner(partida, partida.yo, "brutal")
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)           # sin críticos
    assert not tiene(goblin, "aturdido")
    partida.cat.habilidades["prueba"]["critico"] = {"desde": 1, "multiplicador": 2}            # siempre crítico
    partida.usar_habilidad(partida.yo["id"], "prueba", goblin["id"], "Ana", False)
    assert tiene(goblin, "aturdido")


def test_condiciones_ronda_tiene_habilidad_y_actua_antes(partida, goblin):
    m = partida
    assert not m.cumple({"si": [{"tipo": "ronda", "comparacion": "igual_a", "valor": 1}]}, m.yo)        # fuera de combate
    combatir(m)
    assert m.cumple({"si": [{"tipo": "ronda", "comparacion": "igual_a", "valor": 1}]}, m.yo)
    assert m.cumple({"si": [{"tipo": "tiene_habilidad", "quien": "uno_mismo", "tiene": "si", "habilidad": "prueba"}]}, m.yo)
    assert m.cumple({"si": [{"tipo": "tiene_habilidad", "quien": "objetivo", "tiene": "no", "habilidad": "prueba"}]}, m.yo, goblin)
    primero = m.tokens[m.combate["orden"][0]]
    segundo = m.tokens[m.combate["orden"][1]]
    assert m.cumple({"si": [{"tipo": "actua_antes", "tiene": "si"}]}, primero, segundo)
    assert not m.cumple({"si": [{"tipo": "actua_antes", "tiene": "si"}]}, segundo, primero)


# ── Validación (la campaña avisa de lo que no tiene sentido) ─────
def _campana(tmp_path, cambiar):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    cambiar(d)
    return recursos.cargar(d)


def _escribir(d, ruta, datos):
    (d / ruta).write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def test_validacion_de_las_piezas_nuevas(tmp_path):
    def cambiar(d):
        _escribir(d, "states/confusion.yaml", {"nombre": "Confusión", "duracion": 3, "al_reaplicar": "acumular", "max_cargas": 4, "efectos": [
            {"cuando": {"tipo": "al_intentar", "accion": "atacar"}, "si": [{"tipo": "probabilidad", "porcentaje": 50}],
             "hacer": {"tipo": "redirigir_ataque", "hacia": "quien_ataca"}},
            {"cuando": {"tipo": "al_terminar_estado"}, "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-[Cargas]"}},
            {"cuando": {"tipo": "al_ser_atacado"}, "si": [{"tipo": "critico"}, {"tipo": "dano", "valor": 5}], "hacer": {"tipo": "reducir_dano", "valor": 1}},
            {"cuando": {"tipo": "al_cruzar_umbral", "recurso": "HP", "porcentaje": 30}, "hacer": {"tipo": "aplicar_estado", "estado": "veneno"}},
            {"cuando": "siempre", "hacer": {"tipo": "absorber_dano", "recurso": "MP"}},
            {"cuando": {"tipo": "inicio_turno"}, "si": [{"tipo": "ronda", "valor": 1}, {"tipo": "tiene_habilidad", "habilidad": "curacion"}],
             "hacer": {"tipo": "modificar_recurso", "recurso": "MP", "formula": "1"}}]})
    cat, inf = _campana(tmp_path, cambiar)
    assert inf.ok, inf.errores
    c = cat.estados["confusion"]
    assert c["al_reaplicar"] == "acumular" and c["max_cargas"] == 4 and len(c["efectos"]) == 6

    def mal(d):
        _escribir(d, "states/malo.yaml", {"nombre": "Malo", "al_reaplicar": "duplicar", "impide_etiquetas": ["Nada"], "efectos": [
            {"cuando": "inicio_turno", "si": [{"tipo": "critico"}], "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "1"}},
            {"cuando": "inicio_turno", "hacer": {"tipo": "redirigir_ataque"}},
            {"cuando": "inicio_turno", "si": [{"tipo": "tiene_habilidad", "habilidad": "no_existe"}], "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "1"}}]})
        _escribir(d, "traits/malo.yaml", {"nombre": "Rasgo malo", "efectos": [
            {"cuando": "al_terminar_estado", "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "1"}}]})
    _, inf = _campana(tmp_path / "b", mal)
    texto = "\n".join(inf.errores)
    assert "al_reaplicar" in texto and "Nada" in texto and "El golpe es crítico" in texto
    assert "redirigir_ataque" in texto and "no_existe" in texto and "solo se puede usar en estados" in texto


def test_el_catalogo_publico_trae_lo_nuevo():
    e = efectos.esquema_publico()
    for k in ("al_recibir_dano", "al_cruzar_umbral", "al_intentar", "al_terminar_estado"):
        assert k in e["disparadores"]
    assert "al_terminar_estado" in e["disparadores_estado"] and "al_terminar_estado" not in e["disparadores_generales"]
    for k in ("redirigir_ataque", "impedir_accion", "absorber_dano"):
        assert k in e["acciones"]
    for k in ("critico", "dano", "ronda", "tiene_habilidad", "actua_antes", "cargas"):
        assert k in e["condiciones"]


# ── Turnos: el GM mete o saca tokens del combate ─────────────────
def test_sacar_y_meter_tokens_en_los_turnos(partida, goblin):
    m = partida
    otro = m.colocar_enemigo("goblin", 6, 10)
    combatir(m)
    assert len(m.combate["orden"]) == 3
    actual = m.token_en_turno()
    fuera = next(i for i in m.combate["orden"] if i != actual)
    texto = m.combate_quitar(fuera)
    assert fuera not in m.combate["orden"] and m.token_en_turno() == actual and "sale de los turnos" in texto
    with pytest.raises(ErrorJuego, match="no está en los turnos"):
        m.combate_quitar(fuera)
    texto = m.combate_anadir(fuera)
    assert fuera in m.combate["orden"] and m.token_en_turno() == actual and "entra en los turnos" in texto
    with pytest.raises(ErrorJuego, match="ya está"):
        m.combate_anadir(fuera)
    # sacar al que tiene el turno: empieza el del siguiente
    siguiente = m.combate["orden"][(m.combate["indice"] + 1) % 3]
    m.combate_quitar(actual)
    assert m.token_en_turno() == siguiente
    # con menos de 2, el combate termina
    m.combate_quitar(otro["id"] if otro["id"] in m.combate["orden"] else goblin["id"])
    assert not m.combate["activo"]
    with pytest.raises(ErrorJuego, match="No hay ningún combate"):
        m.combate_anadir(goblin["id"])


def test_meter_en_su_sitio_por_iniciativa_y_en_la_espera(partida, goblin):
    m = partida
    m.cfg["juego"]["iniciativa"] = "valor"
    combatir(m)
    nuevo = m.colocar_enemigo("goblin", 6, 10)
    m.datos_de(nuevo)["stats"]["Agilidad"] = 99                        # el más rápido: va el primero…
    m.combate_anadir(nuevo["id"])
    assert m.combate["orden"][0] == nuevo["id"] and m.combate["indice"] == 1      # …pero no le quita el turno a quien lo tenía
    m.terminar_combate()
    m.cfg["juego"]["iniciativa"] = "manual"
    m.iniciar_combate()
    assert m.combate.get("preparando")
    m.combate_quitar(goblin["id"])
    assert goblin["id"] not in m.combate["preparando"]["participantes"]
    m.combate_anadir(goblin["id"])
    assert m.combate["preparando"]["orden"][-1] == goblin["id"]
