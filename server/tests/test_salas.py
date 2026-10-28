"""Salas: cada mapa es una sala con sus propios tokens, combate, niebla y dibujos; varias en uso a la vez."""
import pytest

from mesa.estado import ErrorJuego, EstadoPartida
from tests.conftest import combatir


def jugador(estado, usuario="ana", base="mago", nombre="Elara"):
    estado.registrar_usuario(usuario)
    p = estado.crear_personaje(usuario, False, base, nombre)
    tok, _ = estado.colocar_personaje(usuario, p["id"])
    return p, tok


def test_cada_sala_tiene_sus_tokens(estado):
    _, a = jugador(estado)
    with estado.en_sala("taberna"):
        t = estado.colocar_enemigo("tabernero", 6, 3)
        assert list(estado.tokens) == [t["id"]]
    assert t["id"] not in estado.tokens and a["id"] in estado.tokens
    assert estado.sala_de_token(t["id"]) == "taberna"
    assert estado.sala_de_token(a["id"]) == "aldea"


def test_mover_a_otra_sala_con_el_grupo(estado):
    p, a = jugador(estado)
    lobo = estado.colocar_enemigo("goblin", 3, 5)
    estado.agrupar_tokens([a["id"], lobo["id"]], "ana", True)
    movidos = estado.mover_a_sala(a["id"], "taberna")
    assert set(movidos) == {a["id"], lobo["id"]} and not estado.tokens
    with estado.en_sala("taberna"):
        assert set(estado.tokens) == set(movidos)
        assert estado.casilla_transitable(a["x"], a["y"])
    assert estado.token_de_personaje("ana", p["id"])["id"] == a["id"]   # se encuentra en la sala que esté
    with pytest.raises(ErrorJuego, match="ya está en esta sala"):
        with estado.en_sala("taberna"):
            estado.mover_a_sala(a["id"], "taberna")
    with pytest.raises(ErrorJuego, match="no existe"):
        estado.mover_a_sala(a["id"], "taberna")        # en la aldea ya no está


def test_un_personaje_desplegado_no_se_repite_en_otra_sala(estado):
    p, a = jugador(estado)
    with estado.en_sala("taberna"):
        t, nuevo = estado.desplegar_personaje("ana", p["id"], "ana", False)
    assert not nuevo and t["id"] == a["id"]


def test_combate_por_sala(estado):
    jugador(estado)
    estado.colocar_enemigo("goblin", 3, 5)
    combatir(estado)
    assert estado.combate["activo"]
    with estado.en_sala("taberna"):
        assert not estado.combate["activo"]
        with pytest.raises(ErrorJuego):
            estado.iniciar_combate()                    # en la taberna no hay nadie con quien pelear


def test_el_jugador_cambia_de_sala_solo_si_la_mesa_lo_permite(estado):
    _, a = jugador(estado)
    with pytest.raises(ErrorJuego, match="solo el GM"):
        estado.cambiar_de_sala("ana", False, a["id"], "taberna")
    estado.cfg["permisos"]["cambiar_sala"] = "todos"
    try:
        estado.abrir_sala("taberna", False)
        with pytest.raises(ErrorJuego, match="cerrado"):
            estado.cambiar_de_sala("ana", False, a["id"], "taberna")
        estado.abrir_sala("taberna", True)
        assert estado.cambiar_de_sala("ana", False, a["id"], "taberna") == [a["id"]]
        assert estado.sala_de_token(a["id"]) == "taberna"
        assert [s["id"] for s in estado.vista_salas(False, "taberna")] == ["aldea", "taberna"]
        estado.abrir_sala("aldea", False)
        assert [s["id"] for s in estado.vista_salas(False, "taberna")] == ["taberna"]
    finally:
        estado.cfg["permisos"]["cambiar_sala"] = "gm"


def test_no_se_huye_de_un_combate(estado):
    estado.cfg["permisos"]["cambiar_sala"] = "todos"
    try:
        _, a = jugador(estado)
        estado.colocar_enemigo("goblin", 3, 5)
        combatir(estado)
        with pytest.raises(ErrorJuego, match="combate"):
            estado.cambiar_de_sala("ana", False, a["id"], "taberna")
    finally:
        estado.cfg["permisos"]["cambiar_sala"] = "gm"


def test_niebla_y_capas_por_sala(estado):
    estado.niebla_gm = True
    estado.capas_ocultas = [2]
    with estado.en_sala("taberna"):
        assert estado.niebla_gm is None and estado.capas_ocultas == []


def test_chat_de_una_sala_solo_lo_ven_los_que_estan_alli(estado):
    estado.anadir_chat("Sistema", "Golpe en la aldea", "combate", mapa="aldea")
    estado.anadir_chat("ana", "Hola a todos")
    assert [m["texto"] for m in estado.chat_visible("bruno", False, "taberna")] == ["Hola a todos"]
    assert len(estado.chat_visible("bruno", False, "aldea")) == 2
    assert len(estado.chat_visible("gm", True, "taberna")) == 2


def test_hablar_como_personaje(estado):
    p, a = jugador(estado)
    h = estado.hablante(a["id"], "ana", False)
    assert h["nombre"] == "Elara"
    with pytest.raises(ErrorJuego, match="tus personajes"):
        estado.hablante(a["id"], "bruno", False)
    g = estado.colocar_enemigo("goblin", 3, 5)
    assert estado.hablante(g["id"], "gm", True)["nombre"] == "Goblin"      # el GM habla como cualquier NPC
    m = estado.anadir_chat("ana", "¡A mí!", personaje=h, mapa="aldea")
    assert m["personaje"]["nombre"] == "Elara" and m["mapa"] == "aldea"


def test_guardar_y_cargar_las_salas(estado, catalogo, tmp_path):
    p, a = jugador(estado)
    with estado.en_sala("taberna"):
        t = estado.colocar_enemigo("tabernero", 6, 3)
        estado.niebla_gm = True
    estado.abrir_sala("taberna", False)
    estado.guardar_estado()
    otra = EstadoPartida(catalogo, tmp_path)
    otra.cargar_estado()
    assert a["id"] in otra.tokens and otra.mapa_id == "aldea"
    with otra.en_sala("taberna"):
        assert t["id"] in otra.tokens and otra.niebla_gm is True
    assert otra.salas_cerradas == {"taberna"}


def test_cargar_una_partida_de_antes_de_las_salas(catalogo, tmp_path):
    import yaml
    (tmp_path / "jugadores").mkdir()
    (tmp_path / "jugadores" / "ana.yaml").write_text(yaml.safe_dump({"usuario": "ana", "personajes": [
        {"id": "p1", "nombre": "Elara", "stats": {}, "recursos": {"HP": {"actual": 10, "max": 10}}}]}), encoding="utf-8")
    (tmp_path / "estado.yaml").write_text(yaml.safe_dump({"mapa": "taberna", "niebla": True, "tokens": [
        {"id": "t1", "tipo": "personaje", "dueno": "ana", "personaje_id": "p1", "x": 6, "y": 5}]}), encoding="utf-8")
    e = EstadoPartida(catalogo, tmp_path)
    e.cargar_estado()
    assert e.mapa_id == e.mapa_principal == "taberna"
    assert "t1" in e.tokens and e.niebla_gm is True


def test_barras_y_nombre_sobre_los_tokens(estado):
    st = estado.cfg["visibilidad"]["sobre_tokens"]
    assert st["barras"] == ["HP"]                       # por defecto, solo la vida
    _, a = jugador(estado)
    g = estado.colocar_enemigo("goblin", 3, 5)
    v = estado.vista_token(a, "bruno", False)
    assert v["mostrar"] == {"barras": True, "nombre": True} and set(v["recursos"]) == {"HP"}
    st["barras"] = ["HP", "MP"]
    try:
        assert set(estado.vista_token(a, "bruno", False)["recursos"]) == {"HP", "MP"}     # los demás ven también su magia
        st["nombre_npc"] = False
        assert estado.vista_token(g, "ana", False)["mostrar"]["nombre"] is False
        estado.fijar_mostrar(g["id"], nombre=True)                                          # el GM lo cambia en este NPC
        assert estado.vista_token(g, "ana", False)["mostrar"]["nombre"] is True
        estado.fijar_mostrar(a["id"], barras=False)
        v = estado.vista_token(a, "bruno", False)
        assert v["mostrar"]["barras"] is False and set(v["recursos"]) == {"HP"}
        assert "mostrar" not in estado.vista_token(a, "ana", False)                       # el dueño lo ve todo
        estado.fijar_mostrar(a["id"], barras=None)
        assert "mostrar" not in a
    finally:
        st.update(barras=["HP"], nombre_npc=True)


def test_barras_que_no_existen_avisan(catalogo):
    from mesa import recursos
    import copy
    cfg = copy.deepcopy(catalogo.config)
    cfg["visibilidad"]["sobre_tokens"]["barras"] = ["HP", "Cordura"]
    import yaml, tempfile, shutil, pathlib
    d = pathlib.Path(tempfile.mkdtemp()) / "c"
    shutil.copytree(catalogo.ruta, d)
    (d / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    _, inf = recursos.cargar(d)
    assert any("Cordura" in e for e in inf.errores)


def test_el_gm_da_y_quita_habilidades(estado):
    p, a = jugador(estado)
    assert "golpe_furioso" not in p["habilidades"]
    txt, _ = estado.gm_habilidad(a["id"], "golpe_furioso", True)
    assert "golpe_furioso" in p["habilidades"] and "Golpe furioso" in txt           # en la ficha del personaje
    with pytest.raises(ErrorJuego, match="ya tiene"):
        estado.gm_habilidad(a["id"], "golpe_furioso", True)
    estado.gm_habilidad(a["id"], "golpe_furioso", False)
    assert "golpe_furioso" not in p["habilidades"]
    with pytest.raises(ErrorJuego, match="no tiene"):
        estado.gm_habilidad(a["id"], "golpe_furioso", False)
    with pytest.raises(ErrorJuego, match="no existe"):
        estado.gm_habilidad(a["id"], "rayo_inventado", True)
    g = estado.colocar_enemigo("goblin", 3, 5)
    estado.gm_habilidad(g["id"], "bola_de_fuego", True)
    assert "bola_de_fuego" in g["habilidades"]
    assert "bola_de_fuego" not in estado.cat.enemigos["goblin"]["habilidades"]   # la ficha del NPC en la campaña no cambia
    assert "bola_de_fuego" not in estado.colocar_enemigo("goblin", 4, 6)["habilidades"]       # otro goblin nuevo, sin ella
