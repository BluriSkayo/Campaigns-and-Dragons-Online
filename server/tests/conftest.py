import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER))

# Las campañas ya no traen plantillas de personaje, pero el servidor aún las admite: los tests las prueban con una copia de la campaña de ejemplo.
import shutil
import tempfile
CONFIG = Path(tempfile.mkdtemp(prefix="mesa-tests-")) / "ejemplo"
shutil.copytree(SERVER / "campanas" / "ejemplo", CONFIG)
shutil.copytree(Path(__file__).resolve().parent / "plantillas", CONFIG / "characters")


@pytest.fixture
def catalogo():
    from mesa import recursos
    cat, inf = recursos.cargar(CONFIG)
    assert inf.ok, inf.errores
    return cat


@pytest.fixture
def estado(catalogo, tmp_path):
    import random
    from mesa.estado import EstadoPartida
    return EstadoPartida(catalogo, tmp_path, rng=random.Random(1), persistir=True)


def combatir(e):
    """Inicia un combate y, si hay que decidir turnos tirando, tira por todos y empieza."""
    texto = e.iniciar_combate()
    return e.empezar_tras_tiradas() if e.combate.get("preparando") else texto
