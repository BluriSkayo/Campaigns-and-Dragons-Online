"""Guardias de estructura (SOLID sin reescribir nada): detectan los fallos que la forma actual del código hace fáciles."""
import collections
import random

from mesa.estado import EstadoPartida


def _tapados(clase) -> dict:
    duenos = collections.defaultdict(list)
    for cls in clase.__mro__:
        if cls is object:
            continue
        for nombre, valor in vars(cls).items():
            if not nombre.startswith("__") and (callable(valor) or isinstance(valor, (property, staticmethod, classmethod))):
                duenos[nombre].append(cls.__name__)
    return {n: c for n, c in duenos.items() if len(c) > 1}


def test_ningun_metodo_tapa_a_otro_entre_los_mixins():
    """EstadoPartida se compone de varias clases (salas, tablero, combate… y MotorEfectos) que comparten `self`; Servidor, de sus
    mixins de acciones. Si dos definen el mismo nombre, la primera tapa a la otra sin avisar (ya pasó con `grupo_activo`)."""
    from mesa.servidor import Servidor
    assert _tapados(EstadoPartida) == {}
    assert _tapados(Servidor) == {}


ACCIONES = """
    agrupar_tokens borrar_dibujo borrar_zona cambiar_contrasena cambiar_sala chat cofre comprar
    crear_personaje dar_objeto desagrupar_token desplegar_personaje dibujar editar_campos editar_personalidad editar_propias
    elegir_personaje equipar gm_bloquear_dibujo gm_borrar_dibujos gm_cambiar_mapa gm_capa gm_clima gm_cofre
    gm_colocar_enemigo gm_combate_turnos gm_dar_puntos gm_diario gm_dinero gm_editar_token gm_empezar_combate gm_estado
    gm_habilidad gm_iniciar_combate gm_limpiar_chat gm_listar_personajes gm_mostrar_token gm_mover_a_sala gm_niebla gm_objeto
    gm_orden_turnos gm_periodo gm_quitar_token gm_revelar gm_sala_abierta gm_sala_borrar gm_sala_crear gm_sala_editar
    gm_sonidos_token gm_subir_nivel gm_terminar_combate gm_tienda_abrir gm_ver_niebla golpear_casilla intercambio_aceptar intercambio_cancelar
    intercambio_ofrecer intercambio_proponer lapiz mover_token pedir_estado ping regla repartir_puntos
    reproducir_musica retirar_personaje ser_gm sonido_ambiente sonido_efecto sonido_personaje terminar_turno tiradas
    tirar_dado tirar_estadistica tirar_iniciativa token_escala transformar usar_habilidad usar_objeto vender
""".split()


def test_el_servidor_atiende_todas_las_acciones_del_protocolo(catalogo, tmp_path):
    """Las acciones se registran solas con @accion("tipo"): si un manejador se pierde (o se duplica) al mover código, esto falla."""
    from mesa.servidor import Servidor
    srv = Servidor(catalogo, EstadoPartida(catalogo, tmp_path, persistir=False))
    assert sorted(srv.acciones) == sorted(ACCIONES)


def test_la_partida_guardada_conserva_el_ambiente(catalogo, tmp_path):
    """Cada rasgo de la partida (momento del día, clima, música…) hay que guardarlo y cargarlo a mano en tres sitios:
    esta prueba avisa si al añadir uno nuevo se olvida alguno."""
    catalogo.config["juego"]["ciclo"]["activo"] = True
    catalogo.config["juego"]["clima"]["activo"] = True
    a = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    a.cambiar_periodo(1)
    a.cambiar_clima(2)
    a.guardar_estado()
    b = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    b.cargar_estado()                                   # como hace main.py al arrancar
    assert (b.periodo, b.clima) == (1, 2)


def test_catalogo_de_efectos_y_motor_van_a_la_par():
    """Cada condición que el Editor ofrece (efectos.CONDICIONES) tiene su manejador en el motor, y al revés; y cada acción que cambia la partida
    apunta a un método que existe. Si añades una pieza y olvidas una mitad, esto falla en vez de «no cumplirse» en silencio."""
    from mesa import efectos, motor
    assert set(efectos.CONDICIONES) == set(motor.CONDICIONES)
    for tipo, metodo in motor.ACCIONES_ACTIVAS.items():
        assert tipo in efectos.ACCIONES and callable(getattr(motor.MotorEfectos, metodo)), tipo


def test_cada_tipo_de_habilidad_tiene_su_impacto():
    """Un tipo de habilidad que la campaña acepta (daño, curación, efecto…) necesita su método en `habilidades.IMPACTOS`."""
    from mesa import habilidades, recursos
    assert set(habilidades.IMPACTOS) == set(recursos.TIPOS_HABILIDAD)
    for metodo in habilidades.IMPACTOS.values():
        assert callable(getattr(EstadoPartida, metodo)), metodo


def test_la_partida_se_guarda_en_el_almacen_que_se_le_de(catalogo, tmp_path):
    """La partida no escribe en disco por su cuenta: pide al `Almacen` (principio D). Con uno en memoria no se crea ningún archivo."""
    from mesa.almacen import AlmacenMemoria
    almacen = AlmacenMemoria()
    a = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), almacen=almacen)
    a.registrar_usuario("Ana")
    p = a.crear_personaje("Ana", False, "guerrero", "Thor")
    a.cambiar_periodo(1)
    a.guardar_estado()
    assert list(tmp_path.iterdir()) == []
    assert "estado.yaml" in almacen.datos and almacen.listar("jugadores") == ["jugadores/ana.yaml"]
    b = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), almacen=almacen)
    b.cargar_estado()
    b.registrar_usuario("Ana")
    assert b.periodo == a.periodo and [x["id"] for x in b.personajes_de("Ana")] == [p["id"]]
    assert [x["usuario"] for x in b.todos_los_personajes()] == ["Ana"]


def test_datos_corruptos_en_la_partida_guardada_se_ignoran(catalogo, tmp_path):
    import yaml
    catalogo.config["juego"]["ciclo"]["activo"] = True
    catalogo.config["juego"]["clima"]["activo"] = True
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    e.cambiar_periodo(1)
    e.guardar_estado()
    ruta = tmp_path / "estado.yaml"
    datos = yaml.safe_load(ruta.read_text(encoding="utf-8"))
    datos.update({"periodo": 99, "clima": "lluvia", "niebla": "si", "musica": 7, "ambiente": "viento"})
    ruta.write_text(yaml.safe_dump(datos), encoding="utf-8")
    b = EstadoPartida(catalogo, tmp_path, rng=random.Random(1))
    b.cargar_estado()
    assert (b.periodo, b.clima) == (0, 0)                  # índices fuera de rango o de otro tipo: se queda el de siempre
    assert b.niebla_gm is None and b.musica is None and b.ambiente == []


def test_conexion_vacia_da_un_aviso_breve_en_ingles():
    import logging
    from mesa.servidor import _AvisoConexionVacia
    try:
        try:
            raise EOFError("stream ends after 0 bytes")
        except EOFError as e:
            raise ValueError("did not receive a valid HTTP request") from e
    except ValueError:
        import sys
        rec = logging.LogRecord("websockets.server", logging.ERROR, "", 0, "opening handshake failed", (), sys.exc_info())
    _AvisoConexionVacia().filter(rec)
    assert rec.exc_info is None and "harmless" in rec.getMessage() and rec.levelname == "WARNING"
    otro = logging.LogRecord("websockets.server", logging.ERROR, "", 0, "otro fallo", (), None)
    _AvisoConexionVacia().filter(otro)
    assert otro.getMessage() == "otro fallo"


def test_la_memoria_de_vision_no_cambia_lo_que_ve_cada_jugador(catalogo, tmp_path):
    """`lectura()` calcula la visión una vez mientras se difunde; fuera de ella se recalcula. Ambas deben dar lo mismo, también tras mover."""
    catalogo.config["juego"]["niebla"]["activa"] = True
    e = EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=False)
    for u, x in (("Ana", 2), ("Bea", 12)):
        e.registrar_usuario(u)
        p = e.crear_personaje(u, False, "guerrero", u + "pj")
        e.desplegar_personaje(u, p["id"], "GM", True, x, 5)
    for x, y in ((4, 5), (14, 6), (1, 1)):
        e.colocar_enemigo("goblin", x, y)
    for paso in range(3):
        sin = {u: (e.visibles_para(u), [e.puede_ver(t, u, False) for t in e.tokens.values()]) for u in ("Ana", "Bea")}
        with e.lectura():
            con = {u: (e.visibles_para(u), [e.puede_ver(t, u, False) for t in e.tokens.values()]) for u in ("Ana", "Bea")}
        assert sin == con and sin["Ana"][0]
        ana = next(t for t in e.tokens.values() if t.get("dueno") == "Ana")
        e.mover_token(ana["id"], ana["x"], ana["y"] + 1, "Ana", False)
    assert e._memo_vision is None


def test_las_copias_compartidas_con_el_cliente_no_se_separan():
    """El cliente y el Editor se instalan por separado, así que algunos archivos van copiados en los dos (decisión de diseño).
    Si se arregla uno y se olvida el otro, esto falla. Solo se compara el código (la primera línea es un comentario propio de cada copia)."""
    import pathlib
    raiz = pathlib.Path(__file__).resolve().parents[2]
    if not (raiz / "client").is_dir():
        import pytest
        pytest.skip("sin la carpeta del cliente (servidor descargado por separado)")
    for cliente, editor in (("client/zip.js", "server/editor/zip.js"), ("client/zip-lector.js", "server/editor/zip-lector.js"),
                            ("client/src/js/pixel.js", "server/editor/src/js/pixel.js")):
        a, b = ((raiz / f).read_text(encoding="utf-8").splitlines()[1:] for f in (cliente, editor))
        assert a == b, f"{cliente} y {editor} ya no son iguales"
