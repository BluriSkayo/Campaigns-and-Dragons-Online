"""Tanda de sugerencias 2 (26-oct-2026): imágenes de personaje en subcarpetas, categoría de los NPC y limpiar el chat de una sala."""
import random

import pytest

from mesa import recursos
from mesa.errores import ErrorJuego
from mesa.estado import EstadoPartida, nombre_imagen


@pytest.mark.parametrize("entrada,salida", [
    ("orco.png", "tokens/orco.png"), ("tokens/orco.png", "tokens/orco.png"),
    ("tokens/jugadores/ana.png", "tokens/jugadores/ana.png"),                 # así las guarda el Editor
    ("icons/retratos/lobo.png", "icons/retratos/lobo.png"), ("otros/a/b/c/x.webp", "otros/a/b/c/x.webp"),
    ("tokens/../x.png", ""), ("../x.png", ""), ("tokens/a\\b.png", ""), ("maps/x.png", ""), ("tokens/.x.png", ""),
    ("tokens/x.exe", ""), ("tokens//x.png", ""), ("tokens/a/b/c/d/e.png", ""), ("tokens/x.png.", ""), (None, ""), ("", ""),
])
def test_imagen_de_personaje(entrada, salida):
    assert nombre_imagen(entrada) == salida


def test_un_personaje_guarda_su_imagen_en_subcarpeta(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=False)
    e.registrar_usuario("Ana")
    p = e.crear_personaje("Ana", False, "guerrero", "Thor", imagen="tokens/jugadores/thor.png", imagen_biografia="icons/retratos/thor.webp")
    assert p["imagen"] == "tokens/jugadores/thor.png" and p["imagen_biografia"] == "icons/retratos/thor.webp"


def test_categoria_de_npc(catalogo):
    import shutil, tempfile, yaml
    from pathlib import Path
    d = Path(tempfile.mkdtemp()) / "c"
    shutil.copytree(catalogo.ruta, d)
    f = d / "enemies" / "goblin.yaml"
    datos = yaml.safe_load(f.read_text(encoding="utf-8"))
    datos["categoria"] = "  Enemigos del bosque  "
    f.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert cat.enemigos["goblin"]["categoria"] == "Enemigos del bosque"
    assert all(n["categoria"] == "" for k, n in cat.enemigos.items() if k != "goblin")     # sin categoría: vacío
    datos["categoria"] = 5
    f.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")
    _, inf = recursos.cargar(d)
    assert not inf.ok and any("categoria" in x for x in inf.errores)


def test_limpiar_chat_de_una_sala(catalogo, tmp_path):
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=False)
    sala = e.crear_sala("Secreta", ["Ana"])["id"]
    e.anadir_chat("Ana", "hola"); e.anadir_chat("Ana", "en la sala", sala=sala); e.anadir_chat("Beto", "adiós")
    assert e.limpiar_chat("general") == 2
    assert [m["texto"] for m in e.chat] == ["en la sala"]                  # las otras salas no se tocan
    assert e.limpiar_chat(sala) == 1 and e.chat == []
    with pytest.raises(ErrorJuego):
        e.limpiar_chat("nada")
