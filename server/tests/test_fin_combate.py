"""Fin del combate: a mano (por defecto) o solo, cuando ya no queda ningún NPC enemigo en pie."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG


@pytest.fixture
def partida(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(2), persistir=False)
    e.cfg["juego"]["iniciativa"] = "valor"                  # sin dados ni espera: el combate empieza al instante
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor")
    e.desplegar_personaje("Ana", p["id"], "GM", True, 2, 8)
    return e


def _enemigo(e, bando=None):
    x, y = [(x, y) for y in range(e.mapa["alto"]) for x in range(e.mapa["ancho"])
            if e.casilla_transitable(x, y) and not e.casilla_ocupada(x, y)][-1]
    t = e.colocar_enemigo("goblin", x, y)
    if bando:
        e.editar_token(t["id"], bando=bando)
    return t


def _derrotar(e, token):
    e.datos_de(token)["recursos"]["HP"]["actual"] = 0


def test_por_defecto_es_manual_y_no_termina_solo(partida):
    assert partida.cfg["juego"]["fin_combate"] == "manual"
    g = _enemigo(partida)
    partida.iniciar_combate()
    _derrotar(partida, g)
    assert not partida.combate_sin_enemigos()


def test_automatico_espera_al_ultimo_enemigo(partida):
    partida.cfg["juego"]["fin_combate"] = "automatico"
    g1, g2 = _enemigo(partida), _enemigo(partida)
    partida.iniciar_combate()
    assert partida.combate["con_enemigos"] and not partida.combate_sin_enemigos()
    _derrotar(partida, g1)
    assert not partida.combate_sin_enemigos()          # aún queda uno en pie
    _derrotar(partida, g2)
    assert partida.combate_sin_enemigos()


def test_automatico_cuenta_quitar_al_ultimo_del_mapa(partida):
    partida.cfg["juego"]["fin_combate"] = "automatico"
    g1, g2 = _enemigo(partida), _enemigo(partida)
    partida.iniciar_combate()
    _derrotar(partida, g1)
    partida.quitar_token(g2["id"])
    assert partida.combate["activo"] and partida.combate_sin_enemigos()


def test_automatico_ignora_aliados_y_neutrales(partida):
    partida.cfg["juego"]["fin_combate"] = "automatico"
    _enemigo(partida, bando="neutral")
    partida.iniciar_combate()
    assert not partida.combate["con_enemigos"]          # sin enemigos al empezar: no termina por esto
    assert not partida.combate_sin_enemigos()


def test_sin_combate_no_hay_nada_que_terminar(partida):
    partida.cfg["juego"]["fin_combate"] = "automatico"
    assert not partida.combate_sin_enemigos()


def test_valor_invalido_se_avisa(tmp_path):
    copia = tmp_path / "ejemplo"
    shutil.copytree(CONFIG, copia)
    d = yaml.safe_load((copia / "config.yaml").read_text(encoding="utf-8"))
    d["juego"]["fin_combate"] = "a_veces"
    (copia / "config.yaml").write_text(yaml.safe_dump(d, allow_unicode=True), encoding="utf-8")
    _, inf = recursos.cargar(copia)
    assert any("fin_combate" in str(x) for x in inf.errores)


# ── Orden del menú del cliente (juego.orden_menu) ──
def _cargar_con_orden(tmp_path, valor):
    copia = tmp_path / f"ejemplo-{abs(hash(str(valor)))}"          # una carpeta distinta por llamada
    shutil.copytree(CONFIG, copia)
    d = yaml.safe_load((copia / "config.yaml").read_text(encoding="utf-8"))
    d["juego"]["orden_menu"] = valor
    (copia / "config.yaml").write_text(yaml.safe_dump(d, allow_unicode=True), encoding="utf-8")
    return recursos.cargar(copia)


def test_orden_menu_por_defecto_deja_la_tienda_abajo(catalogo):
    orden = catalogo.config["juego"]["orden_menu"]
    assert orden == list(recursos.MENU_SECCIONES)
    assert orden.index("tienda") > orden.index("diario")


def test_orden_menu_personalizado_completa_lo_que_falta(tmp_path):
    cat, inf = _cargar_con_orden(tmp_path, ["tienda", "inventario", "tienda"])
    assert not inf.errores
    assert cat.config["juego"]["orden_menu"][:2] == ["tienda", "inventario"]
    assert sorted(cat.config["juego"]["orden_menu"]) == sorted(recursos.MENU_SECCIONES)


def test_orden_menu_invalido_se_avisa(tmp_path):
    _, inf = _cargar_con_orden(tmp_path, ["volar"])
    assert any("orden_menu" in str(x) for x in inf.errores)
    _, inf = _cargar_con_orden(tmp_path, "mal")
    assert any("orden_menu" in str(x) for x in inf.errores)
