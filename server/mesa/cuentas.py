"""
cuentas.py — Cuentas de usuario con contraseña (opcional) y protección contra adivinar contraseñas.

- Las contraseñas NUNCA se guardan en texto: se guarda un hash scrypt con sal propia,
  con el formato  scrypt$N$r$p$sal(base64)$hash(base64)  (el Editor del Servidor usa el mismo).
- Un nombre de usuario es único sin distinguir mayúsculas; se conserva como se escribió la primera vez.
- Las cuentas viven en  data/<campaña>/cuentas.yaml  (datos de la partida, NO dentro de la campaña,
  para que exportar/compartir una campaña no incluya a los jugadores).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from pathlib import Path

import yaml

MODOS_ATAQUE_CUENTA = {"nadie", "enemigos", "enemigos_y_neutros", "todos"}
N, R, P, LARGO = 2 ** 14, 8, 1, 32
MIN_PASSWORD, MAX_PASSWORD = 6, 128


def hashear(password: str) -> str:
    sal = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=sal, n=N, r=R, p=P, dklen=LARGO)
    return "scrypt${}${}${}${}${}".format(N, R, P, base64.b64encode(sal).decode(), base64.b64encode(h).decode())


def es_hash(valor: str) -> bool:
    return isinstance(valor, str) and valor.startswith("scrypt$") and valor.count("$") == 5


def verificar(guardado: str, intento: str) -> bool:
    """Compara en tiempo constante. `guardado` puede ser un hash o (solo en config.yaml, por compatibilidad) texto plano."""
    if not isinstance(intento, str):
        return False
    if not es_hash(guardado):
        return hmac.compare_digest(str(guardado).encode(), intento.encode())
    try:
        _, n, r, p, sal, esperado = guardado.split("$")
        calc = hashlib.scrypt(intento.encode(), salt=base64.b64decode(sal), n=int(n), r=int(r), p=int(p),
                              dklen=len(base64.b64decode(esperado)), maxmem=256 * 1024 * 1024)
        return hmac.compare_digest(calc, base64.b64decode(esperado))
    except (ValueError, OverflowError, MemoryError):
        return False


def validar_password_nueva(password) -> str | None:
    """Devuelve el motivo si no sirve, o None."""
    if not isinstance(password, str):
        return "La contraseña debe ser texto"
    if len(password) < MIN_PASSWORD:
        return f"La contraseña debe tener al menos {MIN_PASSWORD} caracteres"
    if len(password) > MAX_PASSWORD:
        return f"La contraseña no puede superar {MAX_PASSWORD} caracteres"
    return None


class Cuentas:
    def __init__(self, ruta: Path | None):
        self.ruta = Path(ruta) if ruta else None
        self.datos: dict[str, dict] = {}          # usuario (canónico) → {"hash": str, "creada": float}
        self._cargar()

    def _cargar(self):
        if not self.ruta or not self.ruta.is_file():
            return
        try:
            with open(self.ruta, "r", encoding="utf-8") as f:
                crudo = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError):
            return
        for u, d in (crudo.get("cuentas") or {}).items():
            if isinstance(u, str) and isinstance(d, dict):
                h = d.get("hash", "")
                self.datos[u] = {"hash": h if (h == "" or es_hash(h)) else "", "creada": d.get("creada", 0)}
                for k in ("ver_ajenos", "editar"):                  # bloqueos individuales que pone el propietario (solo «false» cambia algo)
                    if d.get(k) is False:
                        self.datos[u][k] = False
                if d.get("ataque") in MODOS_ATAQUE_CUENTA:         # límite propio de este jugador (lo pone el GM en el Editor)
                    self.datos[u]["ataque"] = d["ataque"]

    def _guardar(self):
        if not self.ruta:
            return
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.ruta.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            yaml.safe_dump({"cuentas": self.datos}, f, allow_unicode=True, sort_keys=True)
        try:
            os.chmod(tmp, 0o600)          # solo el dueño (en Windows no tiene efecto)
        except OSError:
            pass
        tmp.replace(self.ruta)

    def canonico(self, usuario: str) -> str | None:
        u = usuario.casefold()
        return next((k for k in self.datos if k.casefold() == u), None)

    def ataque_de(self, usuario: str) -> str | None:
        """El límite de ataque propio de este usuario, o None si vale lo que diga la mesa."""
        return self.datos.get(usuario, {}).get("ataque")

    def puede_ver_ajenos(self, usuario: str) -> bool:
        """False = este jugador tiene la visión bloqueada: de los demás solo ve nombre, imagen y posición."""
        return self.datos.get(usuario, {}).get("ver_ajenos", True)

    def puede_editar(self, usuario: str) -> bool:
        """False = este jugador tiene la edición bloqueada: no puede crear ni cambiar fichas (sí jugar con ellas)."""
        return self.datos.get(usuario, {}).get("editar", True)

    def permite(self, usuario: str, clave: str) -> bool:
        """Los bloqueos individuales que el propietario pone a una cuenta: «ver_ajenos» o «editar» (fichas)."""
        return self.puede_ver_ajenos(usuario) if clave == "ver_ajenos" else self.puede_editar(usuario)

    def tiene_password(self, usuario: str) -> bool:
        return bool(self.datos.get(usuario, {}).get("hash"))

    def crear(self, usuario: str, password: str | None):
        self.datos[usuario] = {"hash": hashear(password) if password else "", "creada": int(time.time())}
        self._guardar()

    def fijar_password(self, usuario: str, password: str):
        self.datos[usuario]["hash"] = hashear(password)
        self._guardar()

    def comprobar(self, usuario: str, password: str) -> bool:
        return verificar(self.datos.get(usuario, {}).get("hash", ""), password) if self.tiene_password(usuario) else False


class Limitador:
    """Tras `maximo` fallos seguidos, bloquea esa clave `bloqueo` segundos. Se usa por usuario y por dirección IP."""

    def __init__(self, maximo: int = 5, bloqueo: int = 60, reloj=time.monotonic):
        self.maximo, self.bloqueo, self.reloj = maximo, bloqueo, reloj
        self.fallos: dict[str, tuple[int, float]] = {}     # clave → (n, hasta cuándo está bloqueada)

    def espera(self, clave: str) -> int:
        """Segundos que faltan para poder reintentar (0 = se puede)."""
        n, hasta = self.fallos.get(clave, (0, 0.0))
        return max(0, int(hasta - self.reloj() + 0.999)) if hasta > self.reloj() else 0

    def fallo(self, clave: str):
        n, hasta = self.fallos.get(clave, (0, 0.0))
        if hasta and hasta <= self.reloj():              # el bloqueo anterior ya pasó: se empieza de cero
            n = 0
        n += 1
        self.fallos[clave] = (n, self.reloj() + self.bloqueo if n >= self.maximo else 0.0)
        if len(self.fallos) > 5000:                       # no crecer sin límite si alguien rota nombres o IPs
            self.fallos = {k: v for k, v in self.fallos.items() if v[1] > self.reloj()}

    def exito(self, clave: str):
        self.fallos.pop(clave, None)
