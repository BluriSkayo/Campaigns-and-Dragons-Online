import shutil
from pathlib import Path

import yaml

from mesa import recursos
from tests.conftest import CONFIG


def copiar(tmp_path) -> Path:
    destino = tmp_path / "config"
    shutil.copytree(CONFIG, destino)
    return destino


def escribir(ruta: Path, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def test_config_de_ejemplo_es_valida():
    cat, inf = recursos.cargar(CONFIG)
    assert inf.ok and not inf.errores
    assert "bola_de_fuego" in cat.habilidades
    assert cat.personajes["mago"]["recursos"]["MP"] == 100
    assert cat.tiendas["tienda_aldea"]["articulos"][1]["precio"] == 40   # hereda precio del objeto
    assert cat.mapas["aldea"]["inicio"] == {"x": 2, "y": 5}


def test_carpeta_inexistente(tmp_path):
    _, inf = recursos.cargar(tmp_path / "nada")
    assert not inf.ok


def errores_con(tmp_path, ruta_rel, datos):
    d = copiar(tmp_path)
    escribir(d / ruta_rel, datos)
    _, inf = recursos.cargar(d)
    return inf.errores


def test_habilidad_con_formula_rota(tmp_path):
    e = errores_con(tmp_path, "abilities/mala.yaml", {"nombre": "Mala", "formula": "[a.Carisma] + 1"})
    assert any("mala.yaml" in x and "Carisma" in x for x in e)


def test_habilidad_sin_campos_obligatorios(tmp_path):
    e = errores_con(tmp_path, "abilities/vacia.yaml", {"tipo": "otro"})
    assert any("nombre" in x for x in e) and any("formula" in x for x in e) and any("tipo" in x for x in e)


def test_coste_con_recurso_inexistente(tmp_path):
    e = errores_con(tmp_path, "abilities/x.yaml", {"nombre": "X", "formula": "1", "coste": {"Ira": 5}})
    assert any("Ira" in x for x in e)


def test_personaje_referencias_inexistentes(tmp_path):
    e = errores_con(tmp_path, "characters/raro.yaml", {
        "nombre": "Raro", "habilidades": ["no_existe"], "inventario": [{"objeto": "nada"}],
        "stats": {"Carisma": 5, "Fuerza": 500}})
    assert any("no_existe" in x for x in e)
    assert any("nada" in x for x in e)
    assert any("Carisma" in x for x in e)
    assert any("Fuerza" in x and "entre" in x for x in e)


def test_mapa_con_casillas_mal(tmp_path):
    e = errores_con(tmp_path, "maps/roto.yaml", {
        "nombre": "Roto", "ancho": 3, "alto": 2, "tile_base": "no_hay",
        "casillas": {"muro": [[0, 0], [9, 9], "raro"], "fantasma": [[1, 1]]}, "inicio": {"x": 9, "y": 0}})
    assert any("tile_base" in x and "no_hay" in x for x in e)
    assert any("(9, 9)" in x and "fuera del mapa" in x for x in e)
    assert any("posición no válida" in x for x in e)
    assert any("fantasma" in x and "no existe" in x for x in e)
    assert any("fuera del mapa" in x and "inicio" in x for x in e)


def test_tile_mal(tmp_path):
    e = errores_con(tmp_path, "tiles/raro.yaml", {
        "nombre": "Raro", "color": "verde", "rompible": {"golpes": 0, "se_convierte_en": "nada"},
        "efectos": [{"cuando": "al_entrar", "hacer": {"tipo": "modificar_recurso", "recurso": "Oro", "formula": "1"}},
                    {"cuando": "tirada", "hacer": {"tipo": "bono_tirada", "valor": 1}}]})
    assert any("color" in x for x in e)
    assert any("«se_convierte_en»" in x and "nada" in x for x in e)
    assert any("Oro" in x for x in e)
    assert any("tirada" in x and "no se puede usar aquí" in x for x in e)


def test_al_entrar_solo_en_tiles(tmp_path):
    e = errores_con(tmp_path, "traits/x.yaml", {
        "nombre": "X", "efectos": [{"cuando": "al_entrar", "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-1"}}]})
    assert any("solo se puede usar en tiles" in x for x in e)


def test_yaml_invalido(tmp_path):
    d = copiar(tmp_path)
    (d / "items" / "roto.yaml").write_text("nombre: [sin cerrar", encoding="utf-8")
    _, inf = recursos.cargar(d)
    assert any("roto.yaml" in x and "YAML" in x for x in inf.errores)


def test_tienda_con_objeto_inexistente(tmp_path):
    e = errores_con(tmp_path, "shops/t.yaml", {"nombre": "T", "articulos": [{"objeto": "fantasma"}]})
    assert any("fantasma" in x for x in e)


def test_config_mapa_inicial_y_recurso_vida(tmp_path):
    d = copiar(tmp_path)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    cfg["juego"]["mapa_inicial"] = "no_hay"
    cfg["juego"]["recurso_vida"] = "Sangre"
    escribir(d / "config.yaml", cfg)
    _, inf = recursos.cargar(d)
    assert any("mapa_inicial" in x for x in inf.errores)
    assert any("recurso_vida" in x for x in inf.errores)




def test_orden_personalizado_de_campana_yaml(tmp_path):
    """El orden «Personalizado» del Editor (campana.yaml) es el orden de las listas en la partida; lo que no aparece va detrás."""
    import shutil
    from tests.conftest import CONFIG
    from mesa import recursos
    d = tmp_path / "c"
    shutil.copytree(CONFIG, d)
    (d / "campana.yaml").write_text("uid: abc12345\norden:\n  enemies: [tabernero, goblin]\n  maps: [taberna]\n", encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert inf.ok, inf.errores
    assert list(cat.enemigos)[:2] == ["tabernero", "goblin"] and set(cat.enemigos) == {"tabernero", "goblin", "guardia"}
    assert list(cat.mapas) == ["taberna", "aldea"]
    (d / "campana.yaml").write_text("orden: [roto\n", encoding="utf-8")
    cat, inf = recursos.cargar(d)
    assert list(cat.mapas) == ["aldea", "taberna"]                     # un campana.yaml mal escrito no cambia nada…
    assert inf.ok and any("campana.yaml" in a for a in inf.avisos)    # …y solo avisa: el servidor arranca igual
