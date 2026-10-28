"""Diario del GM: páginas en journal/, quién ve cada una, revelarlas en partida y que se recuerde al reiniciar."""
import random
import shutil

import pytest
import yaml

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida
from tests.conftest import CONFIG
from tests.test_servidor import mundo  # noqa: F401  (fixture)


def test_paginas_se_validan(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.diario["armas"]["seccion"] == "Equipo" and cat.diario["secreto_tabernero"]["visible"] == "oculta"
    assert cat.config["juego"]["diario_reglas"] is True
    (d / "journal" / "mala.yaml").write_text(yaml.safe_dump({"nombre": "Mala", "visible": "a veces", "texto": "x" * 20001}), encoding="utf-8")
    errores = recursos.cargar(d)[1].errores
    assert any("journal/mala.yaml" in e and "visible" in e for e in errores) and any("demasiado largo" in e for e in errores)


def test_sin_carpeta_journal_no_avisa(tmp_path):
    d = tmp_path / "campana"
    shutil.copytree(CONFIG, d)
    shutil.rmtree(d / "journal")
    cat, inf = recursos.cargar(d)
    assert inf.ok and cat.diario == {} and not any("journal" in a for a in inf.avisos)


def test_quien_ve_cada_pagina_y_se_guarda(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    ids = lambda u, gm=False: [p["id"] for p in e.paginas_para(u, gm)]       # noqa: E731
    assert ids("Ana") == ["armas"] and set(ids("GM", True)) == {"armas", "secreto_tabernero"}
    assert next(p for p in e.paginas_para("GM", True) if p["id"] == "secreto_tabernero")["visible"] == "oculta"
    e.fijar_visibilidad_pagina("secreto_tabernero", "oculta", ["Ana"])
    assert "secreto_tabernero" in ids("Ana") and "secreto_tabernero" not in ids("Beto")
    e.fijar_visibilidad_pagina("armas", "oculta", [])
    assert "armas" not in ids("Ana")
    e2 = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    e2.cargar_estado()
    assert e2.paginas_para("Ana", False)[0]["id"] == "secreto_tabernero" and len(e2.paginas_para("Ana", False)) == 1
    assert e2.visibilidad_pagina("secreto_tabernero") == {"visible": "oculta", "jugadores": ["Ana"]}
    for malo in [("nada", "todos", []), ("armas", "a veces", []), ("armas", "oculta", "Ana"), ("armas", "oculta", [1]), ("armas", "oculta", ["x"] * 51)]:
        with pytest.raises(ErrorJuego):
            e.fijar_visibilidad_pagina(*malo)


async def test_el_gm_revela_una_pagina_por_la_red(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    gm, ana = await nuevo(), await nuevo()
    await gm.entrar("Master", password_gm="secreto")
    assert {p["id"] for p in (await gm.recibir("diario"))["paginas"]} == {"armas", "secreto_tabernero"}
    await ana.entrar("Ana")
    d = await ana.recibir("diario")
    assert [p["id"] for p in d["paginas"]] == ["armas"] and d["reglas"] is True and "visible" not in d["paginas"][0]
    await ana.enviar(tipo="gm_diario", pagina="secreto_tabernero", visible="todos")
    assert (await ana.recibir("error"))["texto"] == "Solo el GM puede hacer eso"
    await gm.enviar(tipo="gm_diario", pagina="secreto_tabernero", visible="oculta", jugadores=["Ana"])
    assert {p["id"] for p in (await ana.recibir("diario"))["paginas"]} == {"armas", "secreto_tabernero"}
    assert "Nueva página en el diario" in (await ana.recibir("chat"))["texto"]
    await gm.enviar(tipo="gm_diario", pagina="secreto_tabernero", visible="oculta")
    assert [p["id"] for p in (await ana.recibir("diario"))["paginas"]] == ["armas"]
