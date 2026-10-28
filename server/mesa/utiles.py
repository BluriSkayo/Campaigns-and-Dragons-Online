"""utiles.py — Pequeños ayudantes que usan varias partes de la partida."""

from __future__ import annotations

import math
import uuid


def nuevo_id() -> str:
    return uuid.uuid4().hex[:8]


SIN_VALOR = object()


def indice_en(valor, n: int):
    """Un índice entero válido de una lista de `n` elementos, o SIN_VALOR (para no tocar lo que ya había)."""
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and 0 <= valor < n else SIN_VALOR


def rango_de(escalones: list, valor) -> int:
    """El rango (1, 2, 3…) que le toca a una estadística con `escalones` por su valor: 1 + los escalones que ya alcanzó."""
    return 1 + sum(1 for u in escalones if valor >= u)


def redondear(v: float) -> int:
    """Redondeo «de toda la vida» (0,5 hacia fuera), igual en el servidor y en el cliente."""
    return int(math.floor(abs(v) + 0.5)) * (1 if v >= 0 else -1)
