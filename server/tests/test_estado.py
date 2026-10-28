import random

from tests.conftest import combatir
import pytest

from mesa.estado import ErrorJuego, EstadoPartida


def jugador(estado, usuario="ana", base="mago", nombre="Elara"):
    estado.registrar_usuario(usuario)
    p = estado.crear_personaje(usuario, False, base, nombre)
    tok, _ = estado.colocar_personaje(usuario, p["id"])
    return p, tok


def test_crear_personaje_copia_la_plantilla(estado):
    p, _ = jugador(estado)
    assert p["stats"]["Poder Mágico"] == 10      # estadísticas globales: la plantilla no las define
    assert p["recursos"]["MP"] == {"actual": 100, "max": 100}
    assert "bola_de_fuego" in p["habilidades"]


def test_imagenes_del_personaje_solo_nombres_seguros(estado):
    estado.registrar_usuario("ana")
    p = estado.crear_personaje("ana", False, "mago", "A", imagen="orco.png", imagen_biografia="tokens/retrato.jpg")
    assert p["imagen"] == "tokens/orco.png" and p["imagen_biografia"] == "tokens/retrato.jpg"
    q = estado.crear_personaje("ana", False, "mago", "B", imagen="../../etc/x.png", imagen_biografia="virus.exe")
    assert q["imagen_biografia"] == "" and "etc" not in q["imagen"]


def test_limites_de_personajes(estado):
    estado.registrar_usuario("ana")
    for i in range(3):
        estado.crear_personaje("ana", False, "mago", f"P{i}")
    with pytest.raises(ErrorJuego, match="Solo puedes tener"):
        estado.crear_personaje("ana", False, "mago", "P4")
    with pytest.raises(ErrorJuego, match="ese nombre"):
        estado.crear_personaje("ana", True, "mago", "p1")
    with pytest.raises(ErrorJuego, match="plantilla"):
        estado.crear_personaje("ana", True, "dragon", "X")
    with pytest.raises(ErrorJuego, match="nombre"):
        estado.crear_personaje("ana", True, "mago", "   ")


def test_token_aparece_en_inicio_y_no_se_duplica(estado):
    p, tok = jugador(estado)
    assert (tok["x"], tok["y"]) == (2, 5)
    otra, nuevo = estado.colocar_personaje("ana", p["id"])
    assert not nuevo and otra["id"] == tok["id"]
    _, tok2 = jugador(estado, "bruno", "guerrero", "Thor")
    assert (tok2["x"], tok2["y"]) != (tok["x"], tok["y"])


def test_mover_valida_casillas(estado):
    _, t = jugador(estado)
    estado.mover_token(t["id"], 3, 5, "ana", False)
    assert (t["x"], t["y"]) == (3, 5)
    with pytest.raises(ErrorJuego, match="bloqueada"):
        estado.mover_token(t["id"], 5, 3, "ana", False)      # muro
    with pytest.raises(ErrorJuego, match="bloqueada"):
        estado.mover_token(t["id"], 8, 5, "ana", False)      # agua
    with pytest.raises(ErrorJuego, match="bloqueada"):
        estado.mover_token(t["id"], 3, 2, "ana", False)      # barril
    with pytest.raises(ErrorJuego, match="bloqueada"):
        estado.mover_token(t["id"], 99, 5, "ana", False)     # fuera


def test_no_se_puede_mover_token_ajeno(estado):
    _, t = jugador(estado)
    with pytest.raises(ErrorJuego, match="No puedes mover"):
        estado.mover_token(t["id"], 3, 5, "bruno", False)
    estado.mover_token(t["id"], 3, 5, "bruno", True)          # el GM sí


def test_casilla_ocupada(estado):
    _, a = jugador(estado)
    _, b = jugador(estado, "bruno", "guerrero", "Thor")
    with pytest.raises(ErrorJuego, match="ocupada"):
        estado.mover_token(b["id"], a["x"], a["y"], "bruno", False)


def test_ataque_calcula_dano_y_reduce_vida(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    g = estado.colocar_enemigo("goblin", 3, 5)
    texto, ids = estado.usar_habilidad(a["id"], "ataque_basico", g["id"], "ana", False)
    assert "daño" in texto and set(ids) == {a["id"], g["id"]}
    assert g["recursos"]["HP"]["actual"] < 45


def test_alcance_y_objetivo(estado):
    _, m = jugador(estado)
    lejos = estado.colocar_enemigo("goblin", 12, 2)
    with pytest.raises(ErrorJuego, match="fuera de alcance"):
        estado.usar_habilidad(m["id"], "bola_de_fuego", lejos["id"], "ana", False)
    cerca = estado.colocar_enemigo("goblin", 4, 5)
    estado.usar_habilidad(m["id"], "bola_de_fuego", cerca["id"], "ana", False)
    with pytest.raises(ErrorJuego, match="objetivo"):
        estado.usar_habilidad(m["id"], "bola_de_fuego", None, "ana", False)


def test_habilidad_enemigo_no_sirve_contra_aliados(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    _, b = jugador(estado, "bruno", "mago", "Elara")
    with pytest.raises(ErrorJuego, match="enemigos"):
        estado.usar_habilidad(a["id"], "ataque_basico", b["id"], "ana", False)


def test_coste_de_mana(estado):
    p, m = jugador(estado)
    g = estado.colocar_enemigo("goblin", 4, 5)
    p["recursos"]["MP"]["actual"] = 5
    with pytest.raises(ErrorJuego, match="suficiente MP"):
        estado.usar_habilidad(m["id"], "bola_de_fuego", g["id"], "ana", False)
    p["recursos"]["MP"]["actual"] = 15
    estado.usar_habilidad(m["id"], "bola_de_fuego", g["id"], "ana", False)
    assert p["recursos"]["MP"]["actual"] == 5


def test_no_conoce_la_habilidad(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    g = estado.colocar_enemigo("goblin", 3, 5)
    with pytest.raises(ErrorJuego, match="no conoce"):
        estado.usar_habilidad(a["id"], "bola_de_fuego", g["id"], "ana", False)


def test_curacion_no_supera_el_maximo(estado):
    p, m = jugador(estado)
    p["recursos"]["HP"]["actual"] = 70
    estado.usar_habilidad(m["id"], "curacion", m["id"], "ana", False)
    assert p["recursos"]["HP"]["actual"] == 80


def test_objeto_consumible(estado):
    p, t = jugador(estado, base="guerrero", nombre="Thor")
    p["recursos"]["HP"]["actual"] = 10
    estado.usar_objeto(t["id"], "pocion", "ana", False)
    assert p["recursos"]["HP"]["actual"] == 50
    assert p["inventario"][0]["cantidad"] == 1
    estado.usar_objeto(t["id"], "pocion", "ana", False)
    assert p["inventario"] == []
    with pytest.raises(ErrorJuego, match="No tienes"):
        estado.usar_objeto(t["id"], "pocion", "ana", False)


def test_combate_y_turnos(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    g = estado.colocar_enemigo("goblin", 3, 5)
    with pytest.raises(ErrorJuego, match="al menos 2"):
        EstadoPartida(estado.cat, estado.datos_dir / "otro", persistir=False).iniciar_combate()
    combatir(estado)
    assert estado.combate["activo"] and len(estado.combate["orden"]) == 2
    with pytest.raises(ErrorJuego, match="Ya hay"):
        combatir(estado)
    primero = estado.token_en_turno()
    otro = a["id"] if primero == g["id"] else g["id"]

    if primero == a["id"]:
        with pytest.raises(ErrorJuego, match="turno"):
            estado.terminar_turno("bruno", False)       # ni es su turno ni es GM
        estado.terminar_turno("ana", False)
        assert estado.token_en_turno() == g["id"]
    else:
        with pytest.raises(ErrorJuego, match="No es tu turno"):
            estado.terminar_turno("ana", False)         # turno del goblin: solo GM
        with pytest.raises(ErrorJuego, match="turno"):
            estado.mover_token(a["id"], 3, 6, "ana", False)
        estado.terminar_turno("gm", True)
        assert estado.token_en_turno() == a["id"]
        assert estado.combate["ronda"] == 1 or estado.combate["indice"] == 1

    estado.terminar_combate()
    assert not estado.combate["activo"]
    estado.mover_token(a["id"], 3, 6, "ana", False)     # ya sin restricción de turno


def test_derrotado_se_salta_y_combate_acaba(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    g = estado.colocar_enemigo("goblin", 3, 5)
    combatir(estado)
    g["recursos"]["HP"]["actual"] = 0
    # el turno pasa siempre a un token vivo
    if estado.token_en_turno() == g["id"]:
        estado.terminar_turno("gm", True)
    assert estado.token_en_turno() == a["id"]
    texto = estado.terminar_turno("ana", False)
    assert estado.token_en_turno() == a["id"]       # único vivo
    with pytest.raises(ErrorJuego, match="derrotado"):
        estado.usar_habilidad(g["id"], "ataque_basico", a["id"], "gm", True)


def test_quitar_token_en_combate(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    g = estado.colocar_enemigo("goblin", 3, 5)
    combatir(estado)
    estado.quitar_token(g["id"])
    assert not estado.combate["activo"]        # solo queda uno: el combate se cierra


def test_llevar_a_todos_deja_los_npc_en_su_sala(estado):
    _, a = jugador(estado)
    g = estado.colocar_enemigo("goblin", 3, 5)
    estado.cambiar_mapa("taberna")
    assert estado.mapa_id == estado.mapa_principal == "taberna"
    assert [t["id"] for t in estado.tokens.values()] == [a["id"]]
    with estado.en_sala("aldea"):
        assert list(estado.tokens) == [g["id"]]          # el goblin sigue en la aldea, esperando
    with pytest.raises(ErrorJuego):
        estado.cambiar_mapa("no_existe")


def test_vista_oculta_datos_ajenos(estado):
    _, a = jugador(estado)
    _, b = jugador(estado, "bruno", "guerrero", "Thor")
    g = estado.colocar_enemigo("goblin", 3, 6)
    propia = estado.vista_token(a, "ana", False)
    ajena = estado.vista_token(b, "ana", False)
    enemigo = estado.vista_token(g, "ana", False)
    gm = estado.vista_token(g, "gm", True)
    assert "stats" in propia and set(propia["recursos"]) == {"HP", "MP"}
    assert "stats" not in ajena and set(ajena["recursos"]) == {"HP"}
    assert "stats" not in enemigo and "habilidades" not in enemigo
    assert "stats" in gm


def test_dados(estado):
    assert "🎲" in estado.tirar("ana", "2d6+1")
    for mala in ("", "hola", "2d0", "[a.Fuerza]", "__import__('os')"):
        with pytest.raises(ErrorJuego):
            estado.tirar("ana", mala)


def test_musica(estado):
    for malo in ("../secreto.ogg", "inventada", "lluvia.wav", "espada.wav", 5):       # solo valen canciones de la lista (no ambiente ni efectos)
        with pytest.raises(ErrorJuego, match="no está en la lista"):
            estado.cambiar_musica(malo)
    estado.cambiar_musica("taberna.wav")
    assert estado.musica == "taberna.wav"
    estado.cambiar_musica(None)


def test_ambiente(estado):
    assert estado.cambiar_ambiente("lluvia.wav") == ["lluvia.wav"]
    assert estado.cambiar_ambiente("lluvia.wav") == ["lluvia.wav"]          # no se duplica
    with pytest.raises(ErrorJuego):
        estado.cambiar_ambiente("taberna.wav")
    assert estado.cambiar_ambiente("lluvia.wav", False) == []
    estado.cambiar_ambiente("lluvia.wav")
    assert estado.cambiar_ambiente(None) == []
    with pytest.raises(ErrorJuego):
        estado.validar_efecto("lluvia.wav")
    assert estado.validar_efecto("espada.wav") == "espada.wav"


def test_nombre_de_audio_valido():
    from mesa.recursos import nombre_audio_valido
    for malo in ("../secreto.ogg", "a/b.ogg", "sin_extension", "virus.exe", ".oculto.ogg", "", None, 5):
        assert not nombre_audio_valido(malo)
    assert nombre_audio_valido("Batalla final.ogg")


def test_chat_se_recorta(estado):
    for i in range(300):
        estado.anadir_chat("x", str(i))
    assert len(estado.chat) == estado.cfg["juego"]["max_mensajes_chat"]


def test_persistencia_completa(catalogo, tmp_path):
    e1 = EstadoPartida(catalogo, tmp_path, rng=random.Random(2))
    e1.registrar_usuario("ana")
    p = e1.crear_personaje("ana", False, "guerrero", "Thor")
    t, _ = e1.colocar_personaje("ana", p["id"])
    e1.mover_token(t["id"], 4, 5, "ana", False)
    g = e1.colocar_enemigo("goblin", 6, 5)
    combatir(e1)
    p["recursos"]["HP"]["actual"] = 77
    e1.guardar_jugador("ana"); e1.guardar_estado()

    e2 = EstadoPartida(catalogo, tmp_path)
    e2.cargar_estado()
    assert e2.tokens[t["id"]]["x"] == 4
    assert e2.tokens[g["id"]]["nombre"] == "Goblin"
    assert e2.combate["activo"] and len(e2.combate["orden"]) == 2
    assert e2.datos_de(e2.tokens[t["id"]])["recursos"]["HP"]["actual"] == 77
    assert "&id" not in (tmp_path / "estado.yaml").read_text(encoding="utf-8")   # sin anclas YAML


def test_estado_corrupto_no_rompe(catalogo, tmp_path):
    (tmp_path / "estado.yaml").write_text("{{{ no es yaml", encoding="utf-8")
    e = EstadoPartida(catalogo, tmp_path)
    e.cargar_estado()
    assert e.tokens == {}


# ── NPC: bandos y a quién se puede atacar ──
def test_un_npc_sin_bando_es_neutral(catalogo):
    assert catalogo.enemigos["tabernero"]["bando"] == "neutral"
    assert catalogo.enemigos["guardia"]["bando"] == "aliado"
    assert catalogo.enemigos["goblin"]["bando"] == "enemigo"


def test_relaciones_entre_bandos(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    _, b = jugador(estado, "bruno", "mago", "Elara")
    gob, tab, gua = (estado.colocar_enemigo(n, x, y) for n, x, y in (("goblin", 3, 4), ("tabernero", 3, 6), ("guardia", 1, 6)))
    rel = estado.relacion
    assert rel(a, a) == "yo" and rel(a, b) == "aliado" and rel(a, gua) == "aliado"
    assert rel(a, tab) == "neutral" and rel(a, gob) == "enemigo"
    assert rel(gob, a) == "enemigo" and rel(gob, tab) == "neutral"
    assert rel(tab, a) == "neutral"
    assert estado.vista_token(tab, "ana", False)["bando"] == "neutral"
    assert estado.vista_token(a, "ana", False)["bando"] == "jugador"


def test_regla_de_ataque_de_la_mesa(estado):
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    gob, tab, gua = (estado.colocar_enemigo(n, x, y) for n, x, y in (("goblin", 3, 4), ("tabernero", 3, 6), ("guardia", 1, 6)))
    ataca = lambda destino, modo=None, gm=False: estado.usar_habilidad(a["id"], "ataque_basico", destino["id"], "ana", gm, modo)
    ataca(tab)                                                    # por defecto se puede atacar a enemigos y neutrales
    ataca(gob, "enemigos")
    with pytest.raises(ErrorJuego, match="neutrales"):
        ataca(tab, "enemigos")
    with pytest.raises(ErrorJuego, match="sobre aliados"):        # una habilidad «contra enemigos» nunca sirve sobre aliados
        ataca(gua, "todos")
    estado.cat.habilidades["ataque_basico"]["objetivo"] = "cualquiera"
    with pytest.raises(ErrorJuego, match="aliados"):
        ataca(gua, "enemigos_y_neutros")
    ataca(gua, "todos")                                           # «todos»: también a aliados con una habilidad que lo permita
    with pytest.raises(ErrorJuego, match="no te permite atacar"):
        ataca(gob, "nadie")
    ataca(tab, "enemigos", gm=True)                               # el GM no tiene límite


def test_el_gm_cambia_el_bando_de_un_npc(estado):
    tab = estado.colocar_enemigo("tabernero", 3, 6)
    assert "bando → enemigo" in estado.editar_token(tab["id"], bando="enemigo")
    assert estado.bando_de(tab) == "enemigo"
    _, a = jugador(estado, base="guerrero", nombre="Thor")
    with pytest.raises(ErrorJuego, match="solo se puede cambiar a un NPC"):
        estado.editar_token(a["id"], bando="enemigo")
    with pytest.raises(ErrorJuego, match="solo se puede cambiar a un NPC"):
        estado.editar_token(tab["id"], bando="rey")


# ── Visibilidad de datos ajenos ──────────────────────────────────
def test_datos_ajenos_ocultos_por_defecto_y_el_gm_puede_revelarlos(estado):
    _, ta = jugador(estado, "ana", nombre="Elara")
    _, tb = jugador(estado, "beto", base="mago", nombre="Bruno")
    estado.registrar_usuario("beto")
    v = estado.vista_token(ta, "beto", False)
    assert set(v["recursos"]) == {"HP"} and "stats" not in v and "inventario" not in v and "habilidades" not in v
    assert estado.vista_token(ta, "ana", False)["inventario"] is not None          # lo propio, completo
    estado.revelar_token(ta["id"], ["inventario", "estadisticas"])
    v = estado.vista_token(ta, "beto", False)
    assert "inventario" in v and "stats" in v and "habilidades" not in v
    estado.revelar_token(ta["id"], [])                                              # volver a ocultar
    assert "inventario" not in estado.vista_token(ta, "beto", False)
    with pytest.raises(ErrorJuego):
        estado.revelar_token(ta["id"], ["contraseña"])


def test_regla_de_la_mesa_muestra_datos_de_jugadores_o_de_npc(estado):
    _, ta = jugador(estado, "ana")
    g = estado.colocar_enemigo("goblin", 3, 5)
    estado.cfg["visibilidad"]["npc"]["recursos"] = True
    assert len(estado.vista_token(g, "ana", False)["recursos"]) > 1
    assert len(estado.vista_token(ta, "ana", False)["recursos"]) >= 1
    _, tb = jugador(estado, "beto", nombre="Bruno")
    assert set(estado.vista_token(tb, "ana", False)["recursos"]) == {"HP"}          # la regla de NPC no afecta a jugadores
    estado.cfg["visibilidad"]["jugadores"]["ficha"] = True
    assert "rasgos" in estado.vista_token(tb, "ana", False)


def test_vision_bloqueada_no_ve_ni_la_vida_aunque_la_mesa_lo_permita(estado):
    _, ta = jugador(estado, "ana")
    estado.cfg["visibilidad"]["jugadores"]["estadisticas"] = True
    estado.cuenta_permite = lambda u, k: not (u == "beto" and k == "ver_ajenos")
    v = estado.vista_token(ta, "beto", False)
    assert v["recursos"] == {} and "stats" not in v and v["nombre"]
    assert "stats" in estado.vista_token(ta, "cleo", False)


# ── Dinero y momento del día ─────────────────────────────────────
def test_dinero_inicial_y_gm_da_y_quita(estado):
    estado.cfg["juego"]["moneda"]["inicial"] = 25
    p, t = jugador(estado)
    assert p["dinero"] == 25 and estado.vista_token(t, "ana", False)["dinero"] == 25
    assert "dinero" not in estado.vista_token(t, "beto", False)                  # ajeno: oculto (va con el inventario)
    assert estado.cambiar_dinero(t["id"], 100) == 125
    assert estado.cambiar_dinero(t["id"], -9999) == 0                            # nunca negativo
    with pytest.raises(ErrorJuego):
        estado.cambiar_dinero(t["id"], 0)
    estado.revelar_token(t["id"], ["inventario"])
    assert "dinero" in estado.vista_token(t, "beto", False)
    estado.cfg["juego"]["moneda"]["activa"] = False
    with pytest.raises(ErrorJuego, match="no usa dinero"):
        estado.cambiar_dinero(t["id"], 5)


def test_dinero_se_guarda_con_el_jugador(estado, catalogo, tmp_path):
    estado.cfg["juego"]["moneda"]["inicial"] = 0
    p, t = jugador(estado)
    estado.cambiar_dinero(t["id"], 40)
    otro = EstadoPartida(catalogo, tmp_path, rng=random.Random(2))
    otro.registrar_usuario("ana")
    assert otro.personajes_de("ana")[0]["dinero"] == 40


def test_momento_del_dia(estado, catalogo, tmp_path):
    estado.cfg["juego"]["ciclo"]["activo"] = False
    with pytest.raises(ErrorJuego, match="no usa día"):
        estado.cambiar_periodo(1)
    estado.cfg["juego"]["ciclo"]["activo"] = True
    assert estado.cambiar_periodo(1)["nombre"] == "Noche" and estado.periodo == 1
    with pytest.raises(ErrorJuego):
        estado.cambiar_periodo(7)
    otro = EstadoPartida(catalogo, tmp_path, rng=random.Random(2))
    otro.cargar_estado()
    assert otro.periodo == 1


# ── Sonidos de personaje ─────────────────────────────────────────
def test_sonidos_de_personaje(estado):
    _, t = jugador(estado)
    jugador(estado, "beto", nombre="Bruno")
    g = estado.colocar_enemigo("goblin", 3, 5)
    assert estado.vista_token(g, "ana", True)["sonidos"] == ["espada.wav"]          # el GM ve los del NPC
    assert "sonidos" not in estado.vista_token(g, "ana", False)
    with pytest.raises(ErrorJuego, match="no pueden lanzar"):
        estado.sonido_de_personaje("ana", False, t["id"], "espada.wav")             # por defecto, solo el GM
    estado.cfg["permisos"]["sonidos_personaje"] = True
    with pytest.raises(ErrorJuego, match="no tiene ese sonido"):
        estado.sonido_de_personaje("ana", False, t["id"], "espada.wav")
    assert estado.asignar_sonidos(t["id"], ["espada.wav", "espada.wav"]) == ["espada.wav"]
    assert estado.sonido_de_personaje("ana", False, t["id"], "espada.wav") == "espada.wav"
    with pytest.raises(ErrorJuego, match="no es tuyo"):
        estado.sonido_de_personaje("beto", False, t["id"], "espada.wav")
    with pytest.raises(ErrorJuego):
        estado.asignar_sonidos(t["id"], ["../../x.wav"])
    assert estado.sonido_de_personaje("ana", True, g["id"], "espada.wav") == "espada.wav"   # el GM, con cualquier token


# ── Tiendas e intercambios ───────────────────────────────────────
def con_dinero(estado, usuario, nombre, dinero):
    p, t = jugador(estado, usuario, nombre=nombre)
    p["dinero"] = dinero
    return p, t


def test_comprar_en_una_tienda_abierta(estado):
    p, _ = con_dinero(estado, "ana", "Elara", 100)
    with pytest.raises(ErrorJuego, match="no está abierta"):
        estado.comprar("ana", p["id"], "tienda_aldea", "pocion", 1)
    estado.abrir_tienda("tienda_aldea", True)
    estado.comprar("ana", p["id"], "tienda_aldea", "pocion", 2)             # 2 × 25
    assert p["dinero"] == 50 and next(e for e in p["inventario"] if e["objeto"] == "pocion")["cantidad"] >= 2
    assert estado.vista_tienda("tienda_aldea")["articulos"][0]["stock"] == 8
    with pytest.raises(ErrorJuego, match="dinero suficiente"):
        estado.comprar("ana", p["id"], "tienda_aldea", "pocion", 3)
    with pytest.raises(ErrorJuego, match="tantas unidades"):
        estado.comprar("ana", p["id"], "tienda_aldea", "pocion", 99)
    with pytest.raises(ErrorJuego, match="no vende"):
        estado.comprar("ana", p["id"], "tienda_aldea", "ether", 1)
    with pytest.raises(ErrorJuego):
        estado.comprar("ana", p["id"], "tienda_aldea", "pocion", -1)


def test_vender_solo_si_la_tienda_compra(estado):
    p, _ = con_dinero(estado, "ana", "Elara", 0)
    estado.abrir_tienda("tienda_aldea", True)
    estado.cat.tiendas["tienda_aldea"]["recompra"] = 0
    with pytest.raises(ErrorJuego, match="no compra"):
        estado.vender("ana", p["id"], "tienda_aldea", "pocion", 1)
    estado.cat.tiendas["tienda_aldea"]["recompra"] = 50
    antes = next((e["cantidad"] for e in p["inventario"] if e["objeto"] == "pocion"), 0)
    assert antes >= 1
    estado.vender("ana", p["id"], "tienda_aldea", "pocion", 1)
    assert p["dinero"] == 12                                                # 50 % de 25, hacia abajo


def test_stock_y_tiendas_abiertas_se_guardan(estado, catalogo, tmp_path):
    p, _ = con_dinero(estado, "ana", "Elara", 100)
    estado.abrir_tienda("tienda_aldea", True)
    estado.comprar("ana", p["id"], "tienda_aldea", "pocion", 3)
    otro = EstadoPartida(catalogo, tmp_path, rng=random.Random(2))
    otro.cargar_estado()
    assert otro.tiendas_abiertas == ["tienda_aldea"] and otro.vista_tienda("tienda_aldea")["articulos"][0]["stock"] == 7
    estado.abrir_tienda("tienda_aldea", True, reponer=True)
    assert estado.vista_tienda("tienda_aldea")["articulos"][0]["stock"] == 10


def test_intercambio_completo_y_sus_reglas(estado):
    a, _ = con_dinero(estado, "ana", "Elara", 100)
    b, _ = con_dinero(estado, "beto", "Bruno", 10)
    estado.cambiar_objeto(next(t for t in estado.tokens.values() if t["dueno"] == "ana")["id"], "eter", 2)
    eter = lambda p: next((e["cantidad"] for e in p["inventario"] if e["objeto"] == "eter"), 0)
    eter_a, eter_b = eter(a), eter(b)
    x = estado.proponer_intercambio("ana", a["id"], "beto", b["id"])
    with pytest.raises(ErrorJuego, match="ya está en un intercambio"):
        estado.proponer_intercambio("beto", b["id"], "ana", a["id"])
    with pytest.raises(ErrorJuego, match="tantas unidades"):
        estado.ofrecer("ana", {"eter": 50}, 0)
    estado.ofrecer("ana", {"eter": 2}, 30)
    estado.aceptar_intercambio("ana", True)
    estado.ofrecer("beto", {}, 10)                                           # cambiar la oferta quita las aceptaciones
    assert not any(p["acepto"] for p in x["partes"])
    estado.aceptar_intercambio("ana", True)
    _, texto = estado.aceptar_intercambio("beto", True)
    assert texto and "intercambio" in texto
    assert a["dinero"] == 100 - 30 + 10 and b["dinero"] == 10 + 30 - 10
    assert eter(b) == eter_b + 2 and eter(a) == eter_a - 2
    assert estado.intercambio_de("ana") is None


def test_intercambio_se_cancela_y_respeta_el_permiso(estado):
    a, _ = con_dinero(estado, "ana", "Elara", 100)
    b, _ = con_dinero(estado, "beto", "Bruno", 10)
    estado.cfg["permisos"]["intercambios"] = False
    with pytest.raises(ErrorJuego, match="no se permiten"):
        estado.proponer_intercambio("ana", a["id"], "beto", b["id"])
    estado.cfg["permisos"]["intercambios"] = True
    estado.proponer_intercambio("ana", a["id"], "beto", b["id"])
    assert estado.cancelar_intercambio("beto") and estado.intercambio_de("ana") is None
    with pytest.raises(ErrorJuego, match="contigo mismo"):
        estado.proponer_intercambio("ana", a["id"], "ana", a["id"])


def test_capas_de_detalle_y_visibilidad(tmp_path):
    from mesa import recursos
    import shutil, yaml
    from pathlib import Path
    dest = tmp_path / "c"; shutil.copytree(Path(__file__).resolve().parents[1] / "campanas" / "ejemplo", dest)
    cat, inf = recursos.cargar(dest)
    m = cat.mapas["aldea"]
    assert inf.ok and m["capa2"][8][2] == "hierba_alta" and m["capa3"][8][16] == "hierba_alta" and m["capa2"][0][0] == ""
    ruta = dest / "maps" / "aldea.yaml"
    d = yaml.safe_load(ruta.read_text(encoding="utf-8"))
    d["capas"] = {"detalle": {"no_existe": [[1, 1]], "agua": [[99, 1], "x"]}, "otra": {}}
    ruta.write_text(yaml.safe_dump(d, allow_unicode=True), encoding="utf-8")
    _, inf = recursos.cargar(dest)
    txt = "\n".join(inf.errores)
    assert "no_existe" in txt and "fuera del mapa" in txt and "posición no válida" in txt and "capa desconocida" in txt


def test_gm_oculta_capas(estado):
    assert estado.fijar_capa(3, False) == [3]
    assert estado.fijar_capa(2, False) == [2, 3]
    assert estado.fijar_capa(3, True) == [2]
    for malo in ((1, True), (True, True), (2, "si"), ("2", True)):
        with pytest.raises(ErrorJuego):
            estado.fijar_capa(*malo)
    assert estado.snapshot("x", False)["capas_ocultas"] == [2]


def test_la_niebla_del_gm_y_la_iniciativa_se_guardan_y_filtran(catalogo, tmp_path):
    import random
    from mesa.estado import EstadoPartida
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(2))
    e.niebla_gm = True
    e.guardar_estado()
    e2 = EstadoPartida(catalogo, tmp_path, rng=random.Random(2))
    e2.cargar_estado()
    assert e2.niebla_gm is True and e2.niebla_activa() is True
