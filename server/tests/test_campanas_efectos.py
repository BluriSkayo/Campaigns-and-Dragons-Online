"""Pruebas del modelo de campañas: grupos de elección, rasgos con efectos y estados."""
import shutil

import pytest
import yaml

from main import elegir_campana, listar_campanas
from mesa import recursos
from tests.conftest import combatir, CONFIG


def copiar(tmp_path):
    destino = tmp_path / "campana"
    shutil.copytree(CONFIG, destino)
    return destino


def escribir(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(yaml.safe_dump(datos, allow_unicode=True), encoding="utf-8")


def errores(d):
    _, inf = recursos.cargar(d)
    return inf.errores


def test_campana_de_ejemplo_carga_razas_rasgos_y_estados():
    cat, inf = recursos.cargar(CONFIG)
    assert inf.ok, inf.errores
    assert set(cat.grupos) == {"raza", "clase"}
    assert cat.opciones["elfo"]["bonos"] == {"Agilidad": 2, "Resistencia": -1}
    assert cat.opciones["humano"]["bonos"] == {}               # una raza puede no tener bonos
    assert cat.opciones_de("raza") == ["elfo", "humano", "orco"] or set(cat.opciones_de("raza")) == {"elfo", "humano", "orco"}
    assert cat.estados["veneno"]["duracion"] == 4
    assert cat.rasgos["toque_venenoso"]["efectos"][0]["hacer"]["estado"] == "veneno"
    assert cat.personajes["mago"]["elecciones"] == {"raza": "elfo", "clase": "mago"}
    assert cat.config["juego"]["puntos_a_repartir"] == 5
    assert cat.config["permisos"]["editar_stats_jugador"] is False


def test_las_razas_no_tienen_estadisticas_propias(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "options/gnomo.yaml", {"grupo": "raza", "nombre": "Gnomo", "stats": {"Fuerza": 3}})
    # «stats» no es un campo de una opción: se ignora, los bonos son lo único que modifica estadísticas
    cat, inf = recursos.cargar(d)
    assert "stats" not in cat.opciones["gnomo"]


def test_bono_a_estadistica_inexistente(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "options/gnomo.yaml", {"grupo": "raza", "nombre": "Gnomo", "bonos": {"Suerte": 1}})
    assert any("la estadística «Suerte» no existe" in e for e in errores(d))


def test_opcion_con_grupo_o_rasgo_inexistente(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "options/x.yaml", {"grupo": "origen", "nombre": "X", "rasgos": ["no_existe"]})
    e = errores(d)
    assert any("grupo inexistente" in x for x in e)
    assert any("rasgo inexistente" in x for x in e)


def test_personaje_con_opcion_de_otro_grupo(tmp_path):
    d = copiar(tmp_path)
    datos = yaml.safe_load((d / "characters/mago.yaml").read_text(encoding="utf-8"))
    datos["elecciones"] = {"raza": "mago"}
    escribir(d / "characters/mago.yaml", datos)
    assert any("pertenece al grupo «clase»" in x for x in errores(d))


def test_grupo_obligatorio_sin_elegir_es_aviso(tmp_path):
    d = copiar(tmp_path)
    datos = yaml.safe_load((d / "characters/mago.yaml").read_text(encoding="utf-8"))
    del datos["elecciones"]
    escribir(d / "characters/mago.yaml", datos)
    _, inf = recursos.cargar(d)
    assert inf.ok
    assert any("grupo obligatorio «Raza»" in a for a in inf.avisos)


@pytest.mark.parametrize("efecto, texto", [
    ({"cuando": {"tipo": "luna_llena"}, "hacer": {"tipo": "bono_tirada", "valor": 1}}, "tipo desconocido «luna_llena»"),
    ({"cuando": {"tipo": "tirada"}, "hacer": {"tipo": "teletransportar"}}, "tipo desconocido «teletransportar»"),
    ({"cuando": {"tipo": "inicio_turno"}, "hacer": {"tipo": "bono_tirada", "valor": 1}}, "solo se puede usar con: tirada"),
    ({"cuando": {"tipo": "tirada", "estadistica": "Suerte"}, "hacer": {"tipo": "bono_tirada", "valor": 1}}, "la estadística «Suerte» no existe"),
    ({"cuando": {"tipo": "tirada"}, "hacer": {"tipo": "bono_tirada"}}, "falta el campo obligatorio «valor»"),
    ({"cuando": {"tipo": "al_atacar"}, "hacer": {"tipo": "aplicar_estado", "estado": "frio"}}, "el estado «frio» no existe"),
    ({"cuando": {"tipo": "inicio_turno"}, "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-[a.Nada]"}}, "formula"),
    ({"cuando": {"tipo": "inicio_turno"}, "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-1", "objetivo": "objetivo"}}, "solo tiene sentido"),
    ({"cuando": {"tipo": "inicio_turno"}, "hacer": {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-1", "color": "rojo"}}, "campo desconocido «color»"),
])
def test_efectos_invalidos_dan_mensajes_claros(tmp_path, efecto, texto):
    d = copiar(tmp_path)
    escribir(d / "traits/malo.yaml", {"nombre": "Malo", "efectos": [efecto]})
    assert any(texto in e for e in errores(d)), errores(d)


def test_un_estado_no_puede_reaccionar_a_tiradas(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "states/raro.yaml", {"nombre": "Raro", "efectos": [
        {"cuando": {"tipo": "tirada"}, "hacer": {"tipo": "bono_tirada", "valor": 1}}]})
    assert any("no se puede usar aquí" in e for e in errores(d))


def test_efectos_pueden_citar_estados_en_cualquier_orden(tmp_path):
    d = copiar(tmp_path)
    escribir(d / "states/a.yaml", {"nombre": "A", "efectos": [
        {"cuando": {"tipo": "fin_turno"}, "hacer": {"tipo": "aplicar_estado", "estado": "b"}}]})
    escribir(d / "states/b.yaml", {"nombre": "B", "duracion": 2})
    assert errores(d) == []


def test_las_carpetas_nuevas_son_opcionales(tmp_path):
    d = copiar(tmp_path)
    for c in ("groups", "options", "traits", "states"):
        shutil.rmtree(d / c)
    for p in ("characters/guerrero.yaml", "characters/mago.yaml"):
        datos = yaml.safe_load((d / p).read_text(encoding="utf-8"))
        datos.pop("elecciones")
        escribir(d / p, datos)
    _, inf = recursos.cargar(d)
    assert inf.ok and not any("groups" in a or "states" in a for a in inf.avisos)


def test_puntos_a_repartir_invalidos(tmp_path):
    d = copiar(tmp_path)
    cfg = yaml.safe_load((d / "config.yaml").read_text(encoding="utf-8"))
    cfg["juego"]["puntos_a_repartir"] = -3
    escribir(d / "config.yaml", cfg)
    assert any("puntos_a_repartir" in e for e in errores(d))


def test_listar_y_elegir_campana(tmp_path, capsys):
    (tmp_path / "uno").mkdir()
    (tmp_path / "dos").mkdir()
    (tmp_path / ".oculta").mkdir()
    assert listar_campanas(tmp_path) == ["dos", "uno"]
    assert elegir_campana("uno", tmp_path) == "uno"
    with pytest.raises(SystemExit):
        elegir_campana("tres", tmp_path)
    assert "Campañas disponibles: dos, uno" in capsys.readouterr().out


def test_elegir_campana_unica_sin_preguntar(tmp_path):
    (tmp_path / "sola").mkdir()
    assert elegir_campana(None, tmp_path) == "sola"


def test_elegir_campana_preguntando(tmp_path, monkeypatch):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    respuestas = iter(["x", "9", "2"])
    monkeypatch.setattr("builtins.input", lambda _: next(respuestas))
    assert elegir_campana(None, tmp_path) == "b"


# ── Aplicación de los efectos en la partida ─────────────────────────────────
import random
from mesa.estado import ErrorJuego, EstadoPartida


@pytest.fixture
def partida(catalogo, tmp_path):
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(5), persistir=False)


def personaje(partida, base="guerrero", nombre="Thor", usuario="Ana", **kw):
    partida.registrar_usuario(usuario)
    p = partida.crear_personaje(usuario, False, base, nombre, **kw)
    t, _ = partida.desplegar_personaje(usuario, p["id"], usuario, False)
    return p, t


def test_los_bonos_de_raza_y_clase_se_suman_a_las_estadisticas(partida):
    p, t = personaje(partida, "mago", elecciones={"raza": "elfo", "clase": "mago"})
    base = p["stats"]
    ef = partida.stats_efectivas(t)
    assert ef["Agilidad"] == base["Agilidad"] + 2 and ef["Resistencia"] == base["Resistencia"] - 1
    assert ef["Poder Mágico"] == base["Poder Mágico"] + 2
    assert partida.bonos_de(t) == {"Agilidad": 2, "Resistencia": -1, "Poder Mágico": 2}


def test_la_clase_aporta_habilidades_y_el_grupo_obligatorio_hay_que_elegirlo(partida):
    p, _ = personaje(partida, "guerrero", "A", elecciones={"raza": "orco", "clase": "mago"})
    assert "bola_de_fuego" in p["habilidades"]
    partida.cat.personajes["guerrero"]["elecciones"] = {}
    with pytest.raises(ErrorJuego, match="Debes elegir una opción de «Raza»"):
        partida.crear_personaje("Ana", False, "guerrero", "Sin raza", elecciones={"clase": "mago"})
    with pytest.raises(ErrorJuego, match="no pertenece al grupo"):
        partida.crear_personaje("Ana", False, "guerrero", "Mala", elecciones={"raza": "mago"})


def test_reparto_de_puntos_al_crear(partida):
    partida.cfg["permisos"]["editar_stats_jugador"] = True
    p, _ = personaje(partida, nombre="Rep", reparto={"Fuerza": 3, "Agilidad": 2})
    base = {e["nombre"]: e["valor_inicial"] for e in partida.cfg["juego"]["estadisticas"]}
    assert p["stats"]["Fuerza"] == base["Fuerza"] + 3 and p["stats"]["Agilidad"] == base["Agilidad"] + 2 and p["puntos_pendientes"] == 0
    with pytest.raises(ErrorJuego, match="Solo tienes 5 puntos"):
        partida.crear_personaje("Ana", False, "guerrero", "Mucho", reparto={"Fuerza": 6})
    with pytest.raises(ErrorJuego, match="mayor o igual que 0"):
        partida.crear_personaje("Ana", False, "guerrero", "Neg", reparto={"Fuerza": -2})


def test_si_solo_el_gm_reparte_el_jugador_no_puede(partida):
    partida.cfg["permisos"]["editar_stats_jugador"] = False
    p0 = partida.crear_personaje("Ana", False, "guerrero", "X", reparto={"Fuerza": 1})   # al crear siempre se reparte
    assert p0["puntos_pendientes"] == 4
    p, t = personaje(partida, nombre="Y")
    assert p["puntos_pendientes"] == 5
    with pytest.raises(ErrorJuego, match="solo el GM reparte"):
        partida.repartir_puntos("Ana", p["id"], {"Fuerza": 1}, False)
    partida.repartir_puntos("Ana", p["id"], {"Fuerza": 1}, True)        # el GM sí
    assert p["stats"]["Fuerza"] == 10 + 1 and p["puntos_pendientes"] == 4
    partida.dar_puntos(t["id"], 3)
    assert p["puntos_pendientes"] == 7


def test_tirada_de_estadistica_aplica_el_bono_de_los_rasgos(partida):
    _, t = personaje(partida, nombre="Orco", elecciones={"raza": "orco", "clase": "guerrero"})
    texto = partida.tirar_estadistica(t, "Fuerza", "Ana")
    assert "+ 2 (rasgos)" in texto and "tiró Fuerza" in texto
    texto = partida.tirar_estadistica(t, "Agilidad", "Ana")           # el rasgo solo vale para Fuerza
    assert "rasgos" not in texto
    with pytest.raises(ErrorJuego, match="no existe"):
        partida.tirar_estadistica(t, "Suerte", "Ana")


def test_toque_venenoso_envenena_y_el_veneno_hace_su_efecto_por_turnos(partida):
    _, orco = personaje(partida, nombre="Orco", elecciones={"raza": "orco", "clase": "guerrero"})
    goblin = partida.colocar_enemigo("goblin", 4, 5)
    partida.cat.habilidades["ataque_basico"]["alcance"] = 99
    partida.usar_habilidad(orco["id"], "ataque_basico", goblin["id"], "Ana", True)
    assert [e["id"] for e in partida.estados_de(goblin)] == ["veneno"]
    assert goblin["estados"][0]["turnos"] == 4
    chat, tokens = partida.vaciar_colas()
    assert goblin["id"] in tokens and any("sufre «Veneno»" in c[0] for c in chat)

    vida = goblin["recursos"]["HP"]["actual"]
    for turno in range(4):                                  # 4 turnos de duración = 4 tics
        partida.al_empezar_turno(goblin)
        assert goblin["recursos"]["HP"]["actual"] == vida - 3 * (turno + 1)
        partida.al_terminar_turno(goblin)
    assert partida.estados_de(goblin) == []                 # el estado terminó
    partida.al_empezar_turno(goblin)
    assert goblin["recursos"]["HP"]["actual"] == vida - 12  # ya no hace nada


def test_volver_a_envenenar_renueva_la_duracion_sin_acumular(partida):
    _, orco = personaje(partida, nombre="Orco", elecciones={"raza": "orco", "clase": "guerrero"})
    goblin = partida.colocar_enemigo("goblin", 4, 5)
    partida.cat.habilidades["ataque_basico"]["alcance"] = 99
    partida.usar_habilidad(orco["id"], "ataque_basico", goblin["id"], "Ana", True)
    partida.al_terminar_turno(goblin)
    assert goblin["estados"][0]["turnos"] == 3
    partida.usar_habilidad(orco["id"], "ataque_basico", goblin["id"], "Ana", True)
    assert len(goblin["estados"]) == 1 and goblin["estados"][0]["turnos"] == 4


def test_el_veneno_se_aplica_al_empezar_y_pasar_turnos_en_combate(partida):
    _, orco = personaje(partida, nombre="Orco", elecciones={"raza": "orco", "clase": "guerrero"})
    goblin = partida.colocar_enemigo("goblin", 4, 5)
    goblin["estados"] = [{"id": "veneno", "turnos": 2}]
    vida = goblin["recursos"]["HP"]["actual"]
    combatir(partida)
    primero = partida.token_en_turno()
    if primero == goblin["id"]:
        assert goblin["recursos"]["HP"]["actual"] == vida - 3          # tic inmediato al empezar el combate
    else:
        partida.terminar_turno("Ana", True)
        assert goblin["recursos"]["HP"]["actual"] == vida - 3          # tic al llegarle el turno


def test_estadisticas_iniciales_globales_o_por_plantilla(partida):
    partida.cat.personajes["guerrero"]["stats"]["Fuerza"] = 16
    p, _ = personaje(partida, nombre="Glob")
    assert p["stats"]["Fuerza"] == 10                     # por defecto: valor inicial global, la plantilla no pone stats
    partida.cfg["juego"]["stats_por_plantilla"] = True
    p2, _ = personaje(partida, nombre="Plan")
    assert p2["stats"]["Fuerza"] == 16


def test_crear_sin_plantilla_usa_los_valores_globales(partida):
    p = partida.crear_personaje("Ana", False, None, "SinPlantilla", elecciones={"raza": "orco", "clase": "mago"}, reparto={"Fuerza": 2})
    assert p["base"] is None
    assert p["stats"]["Fuerza"] == 12
    assert p["recursos"]["HP"]["max"] == 100 and p["recursos"]["MP"]["max"] == 50
    assert p["elecciones"] == {"raza": "orco", "clase": "mago"} and "bola_de_fuego" in p["habilidades"] and p["puntos_pendientes"] == 3


# ── Estadísticas, recursos y puntos propios de cada clase ────────

def test_la_clase_define_stats_iniciales_recursos_y_puntos(partida):
    p, t = personaje(partida, nombre="Brutus", elecciones={"raza": "humano", "clase": "berserker"})
    assert p["stats"]["Fuerza"] == 14 and p["stats"]["Agilidad"] == 8 and p["stats"]["Resistencia"] == 10
    assert p["recursos"]["Furia"] == {"actual": 50, "max": 50}
    assert p["puntos_pendientes"] == 5 + 3
    otro, _ = personaje(partida, nombre="Gandalf", elecciones={"raza": "humano", "clase": "mago"})
    assert "Furia" not in otro["recursos"] and otro["stats"]["Fuerza"] == 10 and otro["puntos_pendientes"] == 5


def test_reparto_solo_en_stats_que_tiene_el_personaje(partida):
    partida.cat.config["juego"]["estadisticas"].append(
        {"nombre": "Suerte", "descripcion": "", "valor_inicial": 3, "minimo": 0, "maximo": 9, "para_todos": False})
    p, _ = personaje(partida, nombre="Sin", elecciones={"raza": "humano", "clase": "mago"})
    assert "Suerte" not in p["stats"]
    with pytest.raises(ErrorJuego, match="no tiene la estadística «Suerte»"):
        partida.crear_personaje("Ana", False, "guerrero", "Mal", elecciones={"raza": "humano", "clase": "mago"}, reparto={"Suerte": 1})
    partida.cat.config["juego"]["estadisticas"].pop()


def test_habilidad_con_recurso_que_no_se_tiene_y_formulas_con_stat_ausente(partida):
    _, mago = personaje(partida, nombre="Mago", elecciones={"raza": "humano", "clase": "mago"})
    _, bers = personaje(partida, nombre="Bers", elecciones={"raza": "humano", "clase": "berserker"})
    assert partida.stats_planas(mago)["Furia"] == 0             # lo que no se tiene cuenta como 0 en fórmulas
    assert partida.stats_planas(bers)["Furia"] == 50


def test_validacion_de_opcion_con_stats_inexistentes(tmp_path):
    import shutil
    from mesa import recursos
    dest = tmp_path / "c"
    shutil.copytree(CONFIG, dest)
    (dest / "options" / "mala.yaml").write_text("grupo: clase\nnombre: Mala\nestadisticas: {Inventada: 5}\nrecursos: {Nada: 3}\npuntos_extra: -2\n", encoding="utf-8")
    _, inf = recursos.cargar(dest)
    texto = "\n".join(inf.errores)
    assert "la estadística «Inventada» no existe" in texto and "el recurso «Nada» no existe" in texto and "puntos_extra" in texto


def test_ficha_hecha_a_mano_se_sanea_al_cargar(partida, tmp_path):
    import yaml as _y
    ruta = partida.datos_dir / "jugadores"
    ruta.mkdir(parents=True, exist_ok=True)
    (ruta / "luz.yaml").write_text(_y.safe_dump({"usuario": "Luz", "personajes": [
        {"id": "a1", "nombre": "Buena", "elecciones": {"raza": "humano", "clase": "berserker"}, "stats": {"Fuerza": 9999, "Inventada": 3},
         "recursos": {"HP": {"actual": 500, "max": 100}}, "habilidades": ["no_existe", "ataque_basico"],
         "inventario": [{"objeto": "no_existe"}, {"objeto": list(partida.cat.objetos)[0], "cantidad": 0}], "puntos_pendientes": -4, "dueno": "otro"},
        {"id": "a2", "nombre": "  "}, "basura", {"nombre": "SinId"}]}), encoding="utf-8")
    pjs = partida._leer_jugador("Luz")
    assert len(pjs) == 1
    p = pjs[0]
    assert p["dueno"] == "Luz" and p["stats"]["Fuerza"] == 99 and "Inventada" not in p["stats"] and p["stats"]["Agilidad"] == 8
    assert p["recursos"]["HP"] == {"actual": 100, "max": 100} and p["recursos"]["Furia"] == {"actual": 50, "max": 50}
    assert p["habilidades"] == ["ataque_basico"] and len(p["inventario"]) == 1 and p["inventario"][0]["cantidad"] == 1
    assert p["puntos_pendientes"] == 0


# ── Dados del servidor y rasgos de personalidad ──────────────────

def test_dados_personalizados_se_pueden_prohibir(partida):
    partida.cfg["permisos"]["dados_personalizados"] = False
    assert "tiró" in partida.tirar("Ana", "2d8+3", es_gm=False)             # un dado de la lista, con modificador
    assert "tiró" in partida.tirar("Ana", "1d20", es_gm=False)
    for malo in ("1d7", "2d6*2", "1d20 + 1d4", "[a.Fuerza]", "1d20+999999"):
        with pytest.raises(ErrorJuego, match="solo se pueden tirar los dados de la lista"):
            partida.tirar("Ana", malo, es_gm=False)
    assert "tiró" in partida.tirar("Master", "1d7", es_gm=True)              # el GM siempre puede
    partida.cfg["permisos"]["dados_personalizados"] = True
    assert "tiró" in partida.tirar("Ana", "1d7", es_gm=False)


def test_lista_de_dados_invalida(tmp_path):
    import shutil
    dest = tmp_path / "c"; shutil.copytree(CONFIG, dest)
    cfg = yaml.safe_load((dest / "config.yaml").read_text(encoding="utf-8"))
    for mala in ([], [1], [4, 4], ["d6"], list(range(2, 20)), [True]):
        cfg["juego"]["dados"] = mala
        (dest / "config.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
        _, inf = recursos.cargar(dest)
        assert any("«dados»" in e for e in inf.errores), mala


def test_rasgos_de_personalidad_segun_permiso(partida):
    p, _ = personaje(partida, nombre="Pers")
    partida.cfg["permisos"]["rasgos_personalidad"] = False
    with pytest.raises(ErrorJuego, match="solo el GM"):
        partida.editar_personalidad("Ana", p["id"], ["Maldito"], False)
    partida.editar_personalidad("Ana", p["id"], ["Maldito"], True)           # el GM sí
    partida.cfg["permisos"]["rasgos_personalidad"] = True
    partida.editar_personalidad("Ana", p["id"], ["Maniático", " maniático ", "Valiente"], False)
    assert p["personalidad"] == ["Maniático", "Valiente"]
    for malo in ("no es lista", ["x" * 31], [""], [5], ["a"] * 1 + [str(i) for i in range(8)]):
        with pytest.raises(ErrorJuego):
            partida.editar_personalidad("Ana", p["id"], malo, False)


def test_sonidos_yaml(tmp_path):
    import shutil
    from pathlib import Path
    from mesa.recursos import cargar
    destino = tmp_path / "c"
    shutil.copytree(Path(__file__).resolve().parent.parent / "campanas" / "ejemplo", destino)
    (destino / "sonidos.yaml").write_text("musica:\n  - categoria: A\n    archivos: [x.mp3, ../y.mp3, x.mp3]\n  - suelto.ogg\nambiente: 5\n", encoding="utf-8")
    cat, inf = cargar(destino)
    assert cat.sonidos["musica"] == [{"categoria": "A", "archivos": ["x.mp3"]}, {"categoria": "General", "archivos": ["suelto.ogg"]}]
    assert any("../y.mp3" in e for e in inf.errores) and any("«ambiente» debe ser una lista" in e for e in inf.errores)
    assert any("repetido" in a for a in inf.avisos)


def test_habilidades_y_objetos_propios_segun_permiso(partida):
    p, _ = personaje(partida, nombre="Propio")
    partida.cfg["permisos"]["habilidades_propias"] = False
    with pytest.raises(ErrorJuego, match="solo el GM"):
        partida.editar_propias("Ana", p["id"], "habilidades", [{"nombre": "Silbido"}], False)
    partida.editar_propias("Ana", p["id"], "habilidades", [{"nombre": "Silbido"}], True)       # el GM sí
    partida.cfg["permisos"]["habilidades_propias"] = True
    partida.cfg["permisos"]["objetos_propios"] = True
    r = partida.editar_propias("Ana", p["id"], "objetos", [{"nombre": "Llave rara", "descripcion": "Abre algo", "cantidad": 2}], False)
    assert r["propias"]["objetos"] == [{"nombre": "Llave rara", "descripcion": "Abre algo", "cantidad": 2}]
    assert r["propias"]["habilidades"][0]["nombre"] == "Silbido"
    for malo in ([{"nombre": " "}], [{"descripcion": "x"}], ["texto"], [{"nombre": "a"}] * 31):
        with pytest.raises(ErrorJuego):
            partida.editar_propias("Ana", p["id"], "objetos", malo, False)
    with pytest.raises(ErrorJuego):
        partida.editar_propias("Ana", p["id"], "otra", [], False)
    r = partida.editar_propias("Ana", p["id"], "objetos", [{"nombre": "x" * 90, "cantidad": 99999}], False)
    assert len(r["propias"]["objetos"][0]["nombre"]) == 40 and r["propias"]["objetos"][0]["cantidad"] == 999


def test_niebla_de_guerra_vision_y_muros(partida):
    partida.cfg["juego"]["niebla"].update(activa=True, vision_base=3, compartir=True)
    p, t = personaje(partida, nombre="Vigia")
    t["x"], t["y"] = 2, 5                                    # el muro de la aldea está en la columna 5, filas 2-5 y 7-9
    gob_cerca = partida.colocar_enemigo("goblin", 3, 5)
    gob_lejos = partida.colocar_enemigo("goblin", 9, 3)
    gob_tras = partida.colocar_enemigo("goblin", 6, 3)
    assert partida.niebla_activa()
    assert partida.puede_ver(gob_cerca, "Ana", False)
    assert not partida.puede_ver(gob_lejos, "Ana", False)    # a más de 3 casillas
    assert partida.puede_ver(gob_cerca, "Otro", True) and partida.puede_ver(gob_lejos, "Otro", True)   # el GM lo ve todo
    # tras el muro: aunque estuviera al alcance, no se ve
    partida.cfg["juego"]["niebla"]["vision_base"] = 6
    assert (5, 3) in partida.visibles_para("Ana") and (6, 3) not in partida.visibles_para("Ana")
    assert not partida.puede_ver(gob_tras, "Ana", False)
    # sin niebla se ve todo
    partida.cfg["juego"]["niebla"]["activa"] = False
    assert partida.puede_ver(gob_lejos, "Ana", False) and partida.mascara_niebla("Ana", False) is None


def test_la_vision_se_suma_con_objetos_estados_y_rasgos(partida):
    partida.cfg["juego"]["niebla"].update(activa=True, vision_base=4)
    p, t = personaje(partida, nombre="Luz")
    assert partida.vision_de(t) == 4
    p["inventario"].append({"objeto": "antorcha", "cantidad": 1})
    assert partida.vision_de(t) == 6                         # +2 mientras lleve la antorcha
    p["inventario"].clear()
    assert partida.vision_de(t) == 4
    partida.cfg["juego"]["niebla"]["vision_base"] = 0
    assert partida.vision_de(t) == 0
    partida.cfg["juego"]["niebla"]["vision_base"] = 6
    partida.cfg["juego"]["niebla"]["compartir"] = False
    otro, to = personaje(partida, nombre="Otro", usuario="Beto")
    to["x"], to["y"] = 15, 8
    assert not partida.puede_ver(to, "Ana", False) and partida.puede_ver(to, "Beto", False)
    partida.cfg["juego"]["niebla"]["compartir"] = True
    assert partida.puede_ver(to, "Ana", False)


def test_la_iniciativa_no_nombra_npc_que_no_se_ven(partida):
    partida.cfg["juego"]["niebla"].update(activa=True, vision_base=2)
    p, t = personaje(partida, nombre="Vigia")
    t["x"], t["y"] = 2, 5
    cerca = partida.colocar_enemigo("goblin", 3, 5)
    lejos = partida.colocar_enemigo("goblin", 15, 9)
    combatir(partida)
    gm = partida.vista_combate("Otro", True)
    ana = partida.vista_combate("Ana", False)
    assert lejos["id"] in gm["orden"] and lejos["id"] not in ana["orden"] and cerca["id"] in ana["orden"]


def test_todas_las_campanas_incluidas_cargan_sin_errores():
    # Campañas de ejemplo y pre-hechas : un cambio del servidor no debe romperlas.
    from pathlib import Path
    raiz = Path(__file__).resolve().parent.parent / "campanas"
    for carpeta in sorted(p for p in raiz.iterdir() if p.is_dir() and not p.name.startswith("_")):
        _, inf = recursos.cargar(carpeta)
        assert inf.ok, (carpeta.name, inf.errores)
