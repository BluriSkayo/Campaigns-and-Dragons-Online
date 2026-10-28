"""Clima de la mesa: se activa o no, el GM lo cambia, y los efectos de la campaña pueden depender de él."""
import random

import pytest
import yaml

from mesa import efectos, recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.test_condiciones import copiar, dar_rasgo, escribir, extra, personaje, rasgo  # noqa: F401  (ayudas compartidas)


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(5), persistir=False)


def _con_clima(d, **cambios):
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    cfg["juego"].setdefault("clima", {}).update(cambios)
    escribir(d / "config.yaml", cfg)


def test_por_defecto_esta_desactivado_y_trae_tipos(catalogo):
    c = catalogo.config["juego"]["clima"]
    assert c["activo"] is False and [t["nombre"] for t in c["tipos"]][:2] == ["Despejado", "Lluvia"]


def test_clima_invalido_da_errores_claros(tmp_path):
    d = copiar(tmp_path)
    _con_clima(d, activo=True, tipos=[{"nombre": "Lluvia"}, {"nombre": "lluvia"}, {"color": "#000000"}, {"nombre": "Rojo", "color": "rojo"}])
    _, inf = recursos.cargar(d)
    texto = " | ".join(inf.errores)
    assert "repetido" in texto and "necesita un «nombre»" in texto and "color como #0a1233" in texto


def test_condicion_con_clima_inexistente_o_sin_clima(tmp_path):
    d = copiar(tmp_path)
    _con_clima(d, activo=True)
    rasgo(d, [{"tipo": "clima", "clima": "Granizo"}])
    assert any("«Granizo» no existe" in e for e in recursos.cargar(d)[1].errores)
    d2 = copiar(tmp_path / "otra")
    rasgo(d2, [{"tipo": "clima", "clima": "Lluvia"}])                 # el clima está desactivado
    _, inf = recursos.cargar(d2)
    assert inf.ok and any("nunca se cumplirá" in a for a in inf.avisos)


def test_el_esquema_publico_incluye_clima():
    esq = efectos.esquema_publico()
    assert "clima" in esq["condiciones"] and "al_cambiar_clima" in esq["disparadores"]


def test_el_gm_cambia_el_clima_y_un_efecto_depende_de_el(partida):
    partida.cfg["juego"]["clima"]["activo"] = True
    dar_rasgo(partida, [{"tipo": "clima", "clima": "Lluvia"}], hacer={"tipo": "bono_estadistica", "estadistica": "Fuerza", "valor": -2})
    _, t = personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    assert partida.clima == 0 and extra(partida, t) == 0               # Despejado: no se nota
    assert partida.cambiar_clima(1)["nombre"] == "Lluvia"
    assert extra(partida, t) == -2
    partida.cambiar_clima(0)
    assert extra(partida, t) == 0


def test_cambiar_clima_con_la_opcion_apagada_o_con_un_indice_malo(partida):
    with pytest.raises(ErrorJuego):
        partida.cambiar_clima(1)
    partida.cfg["juego"]["clima"]["activo"] = True
    for malo in (-1, 99, True, "1", None):
        with pytest.raises(ErrorJuego):
            partida.cambiar_clima(malo)


def test_al_cambiar_el_clima_se_disparan_los_efectos(partida):
    partida.cfg["juego"]["clima"]["activo"] = True
    llamadas = []
    original = partida.disparar
    partida.disparar = lambda ev, t, *a, **k: (llamadas.append(ev), original(ev, t, *a, **k))[1]
    personaje(partida, elecciones={"raza": "humano", "clase": "guerrero"})
    partida.cambiar_clima(2)
    assert "al_cambiar_clima" in llamadas
