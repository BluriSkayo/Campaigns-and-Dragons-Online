"""
estado.py — Lógica de la partida. No sabe nada de red ni de WebSockets.

`EstadoPartida` reúne las partes de la partida, cada una en su archivo (un tema por archivo):

    salas.py         salas (un mapa = una sala) y «la sala actual»
    tablero.py       mapa, tiles, objetos, casillas que se rompen, caminos
    niebla.py        niebla de guerra y qué ve cada jugador
    dibujos.py       regla y dibujos temporales
    personajes.py    personajes de los jugadores (crear, ficha, desplegar)
    tokens.py        tokens del mapa, edición del GM, movimiento, tamaño, grupos y bandos
    progresion.py    transformación, experiencia y niveles
    habilidades.py   usar habilidades (etapas: comprobar → objetivos → tirar → aplicar → contar)
    objetos.py       equipar, usar y dar objetos
    combate.py       combate por turnos
    chat.py          dados, tiradas guardadas y chat
    ambiente.py      día y noche, clima, música y sonidos
    diario.py        páginas del diario
    vistas.py        lo que se envía a cada cliente
    persistencia.py  guardar y cargar (a través de un `Almacen`, ver almacen.py)
    comercio.py      tiendas, intercambios y cofres
    motor.py         efectos, estados, condiciones y disparadores

Todas comparten `self`: `tests/test_arquitectura.py` falla si dos definen el mismo nombre.
Toda regla se valida aquí; el cliente solo pide acciones.
"""

from __future__ import annotations

import random
from pathlib import Path

from .almacen import Almacen, AlmacenYaml
from .ambiente import AmbienteMixin
from .chat import ChatMixin
from .combate import CombateMixin
from .comercio import CofresMixin, ComercioMixin
from .diario import DiarioMixin
from .dibujos import DibujosMixin, recortar_trazo  # noqa: F401  (se importa desde aquí)
from .errores import ErrorJuego  # noqa: F401  (se importa desde aquí)
from .habilidades import HabilidadesMixin
from .motor import MotorEfectos
from .niebla import NieblaMixin, campo_de_vision  # noqa: F401
from .objetos import ObjetosMixin
from .persistencia import PersistenciaMixin
from .personajes import PersonajesMixin, nombre_imagen, normalizar_propias  # noqa: F401
from .progresion import ProgresionMixin
from .recursos import Catalogo
from .salas import SalasMixin
from .tablero import TableroMixin
from .tokens import TokensMixin
from .vistas import VistasMixin


class EstadoPartida(SalasMixin, TableroMixin, NieblaMixin, DibujosMixin, PersonajesMixin, TokensMixin, ProgresionMixin,
                    HabilidadesMixin, ObjetosMixin, CombateMixin, ChatMixin, AmbienteMixin, DiarioMixin, VistasMixin,
                    PersistenciaMixin, ComercioMixin, CofresMixin, MotorEfectos):
    def __init__(self, catalogo: Catalogo, datos_dir, rng: random.Random | None = None,
                 persistir: bool = True, almacen: Almacen | None = None):
        self.cat = catalogo
        self.cfg = catalogo.config
        self.datos_dir = Path(datos_dir)
        self.persistir = persistir
        # Dónde se guarda la partida. Por defecto, YAML en `datos_dir`; con `persistir=False` lee lo que haya pero no escribe.
        self.almacen: Almacen = almacen or AlmacenYaml(self.datos_dir, escribir=persistir)
        self.rng = rng or random.Random()
        self.cuenta_permite = lambda usuario, clave: True      # el servidor lo cambia: bloqueos individuales de cada cuenta (ver_ajenos, editar)

        self.personajes: dict[str, list[dict]] = {}   # usuario → personajes
        # Salas: cada mapa de la campaña es una sala con sus propios tokens, combate, dibujos, capas y niebla. Varias pueden estar
        # en uso a la vez. Casi todo el código trabaja sobre «la sala actual» (`mapa_id`): el servidor la elige antes de atender
        # cada mensaje (ver `usar_sala` / `en_sala`), así cada regla sigue escrita como si hubiera un solo mapa.
        self.salas: dict[str, dict] = {}
        self.salas_cerradas: set[str] = set()     # salas a las que los jugadores no pueden entrar por su cuenta (las decide el GM)
        self.cambios_casillas: dict[str, dict[str, dict]] = {}   # mapa → {"x,y": {tile?, golpes}}: lo que la partida ha cambiado
        self.objetos_golpeados: dict[str, dict[str, int]] = {}  # mapa → {huella del objeto: golpes recibidos; -1 = roto (ya no está)}
        self.mapa_id: str = self._mapa_por_defecto()
        self.mapa_principal: str = self.mapa_id   # la sala donde aparece quien entra sin personaje en el mapa («Llevar a todos» la cambia)
        self.chat: list[dict] = []
        self.salas_chat: dict[str, dict] = {}   # salas privadas de chat que crea el GM: id → {id, nombre, miembros}. La sala «general» es de todos y no se guarda aquí.
        self.musica: str | None = None
        self.periodo = self.cfg["juego"]["ciclo"]["inicial"]      # momento del día actual (índice en juego.ciclo.periodos)
        self.clima = self.cfg["juego"]["clima"]["inicial"]        # clima actual (índice en juego.clima.tipos)
        self._iniciar_comercio()
        self._iniciar_cofres()
        self._version_opacas = 0
        self._cache_vision: dict = {}         # (usuario, mapa) → (firma, casillas que ve): ver niebla.visibles_para
        self._campos_vision: dict = {}        # campos de visión ya calculados (niebla._campo)
        self._memo_vision: dict | None = None  # mientras el servidor difunde (niebla.lectura)
        self.tiradas_guardadas: dict = {}      # tiradas que guarda cada usuario: {usuario: [{"nombre", "expresion"}]}
        self.diario_vis: dict = {}             # páginas del diario que el GM reveló u ocultó en partida: {id: {"visible", "jugadores"}}
        self.dibujo_bloqueado = False          # el GM puede impedir que los jugadores dibujen
        self.ambiente: list[str] = []          # sonidos de ambiente sonando ahora (nombres de archivo)
        self.golpes_pendientes: list = []                        # (texto, cambio) de tiles/objetos golpeados por una habilidad, para avisar a todos
        self._init_motor()
