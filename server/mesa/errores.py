"""errores.py — El error que se muestra al jugador (acción no permitida o inválida)."""


class ErrorJuego(Exception):
    """Acción no permitida o inválida. El mensaje se muestra al jugador. `codigo` (opcional) permite al cliente reaccionar."""

    def __init__(self, texto: str, codigo: str | None = None):
        super().__init__(texto)
        self.codigo = codigo
