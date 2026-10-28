"""Guardias de estructura (SOLID sin reescribir nada): detectan los fallos que la forma actual del código hace fáciles."""
import collections
import random

from mesa.estado import EstadoPartida


def test_ningun_metodo_tapa_a_otro_entre_los_mixins():
    """EstadoPartida se compone de varias clases (ComercioMixin, CofresMixin, MotorEfectos…) que comparten `self`.
    Si dos definen el mismo nombre, la primera tapa a la otra sin avisar (ya pasó con `grupo_activo`)."""
    duenos = collections.defaultdict(list)
    for cls in EstadoPartida.__mro__:
        if cls is object:
            continue
        for nombre, valor in vars(cls).items():
            if not nombre.startswith("__") and (callable(valor) or isinstance(valor, (property, staticmethod, classmethod))):
                duenos[nombre].append(cls.__name__)
    assert {n: c for n, c in duenos.items() if len(c) > 1} == {}


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
