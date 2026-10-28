"""protocolo.py — Lo que comparten el servidor y sus manejadores de acciones: la sesión de cada conexión, cómo se registra
una acción (@accion) y cómo se leen los campos de un mensaje sin fiarse de lo que mande el cliente."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .errores import ErrorJuego


def accion(tipo: str):
    """Marca un método de `Servidor` (o de uno de sus mixins de acciones) como el que atiende los mensajes `{"tipo": tipo}`.
    Los que empiezan por «gm_» solo los puede mandar el GM (lo comprueba `Servidor._atender`)."""
    def marcar(metodo):
        metodo.tipo_accion = tipo
        return metodo
    return marcar


RE_USUARIO = re.compile(r"[\w\- ]{1,20}")
RE_DADO = re.compile(r"/\s*(.+)")
MAX_CHAT = 500


@dataclass
class Sesion:
    usuario: str
    es_gm: bool
    personaje_id: str | None = None
    ultima_regla: float = 0.0
    ultimo_sonido: float = 0.0
    ultimo_ping: float = 0.0
    ultimo_lapiz: float = 0.0
    vistos: set = field(default_factory=set)      # ids de tokens que este cliente ya conoce (para la niebla de guerra)
    mascara: list | None = None                  # última máscara de niebla enviada
    ver_niebla: str | None = None                # solo GM: ver la niebla como el grupo («*») o como un jugador; None = no verla
    mapa: str | None = None                      # la sala (mapa) que está viendo: la de su personaje, o la que eligió el GM


def ip_de(ws) -> str:
    try:
        return str(ws.remote_address[0])
    except (TypeError, IndexError, AttributeError):
        return "?"


def entero_de(msg: dict, clave: str) -> int:
    v = msg.get(clave)
    if isinstance(v, bool) or not isinstance(v, int):
        raise ErrorJuego(f"El campo «{clave}» debe ser un número entero")
    return v


def id_campana(nombre: str) -> str:
    """Nombre de la carpeta de la campaña tal como lo usan el Editor y el cliente («mi-campana»)."""
    return re.sub(r"[^a-z0-9_-]+", "-", unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode().lower()).strip("-_")[:60] or "campana"


def texto_de(msg: dict, clave: str, maximo: int = 200) -> str:
    v = msg.get(clave)
    if not isinstance(v, str):
        raise ErrorJuego(f"El campo «{clave}» debe ser texto")
    return v[:maximo]
