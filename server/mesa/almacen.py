"""almacen.py — Dónde se guarda la partida. `EstadoPartida` solo pide «guarda esto con este nombre» y «dame lo guardado»:
no sabe de carpetas, ni de YAML, ni de archivos temporales (principio D de SOLID, ver docs/SOLID.md).

Nombres: rutas relativas con «/» («estado.yaml», «jugadores/ana.yaml»)."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Protocol

import yaml


class Almacen(Protocol):
    def guardar(self, nombre: str, datos: dict) -> None: ...

    def cargar(self, nombre: str) -> Any | None:
        """Lo guardado con ese nombre ({} si estaba vacío), o None si no existe o no se puede leer."""

    def listar(self, carpeta: str) -> list[str]:
        """Nombres guardados dentro de `carpeta` («jugadores» → ["jugadores/ana.yaml", …])."""


class _Dumper(yaml.SafeDumper):
    def ignore_aliases(self, data):  # evita anclas &id001 en los YAML
        return True


class AlmacenYaml:
    """Un archivo YAML por nombre dentro de `carpeta`. Escribe en un temporal y lo renombra: un corte a mitad no deja un archivo roto.
    Con `escribir=False` lee lo que haya pero no escribe nunca (pruebas y simulador)."""

    def __init__(self, carpeta, escribir: bool = True):
        self.carpeta = Path(carpeta)
        self.escribir = escribir

    def guardar(self, nombre: str, datos: dict) -> None:
        if not self.escribir:
            return
        ruta = self.carpeta / nombre
        ruta.parent.mkdir(parents=True, exist_ok=True)
        tmp = ruta.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            yaml.dump(datos, f, Dumper=_Dumper, allow_unicode=True, sort_keys=False)
        tmp.replace(ruta)

    def cargar(self, nombre: str) -> Any | None:
        ruta = self.carpeta / nombre
        if not ruta.is_file():
            return None
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError):
            return None

    def listar(self, carpeta: str) -> list[str]:
        d = self.carpeta / carpeta
        return [f"{carpeta}/{r.name}" for r in d.glob("*.yaml")] if d.is_dir() else []


class AlmacenMemoria:
    """Guarda en memoria (pruebas): lo que se guarda se puede volver a cargar, pero nada toca el disco."""

    def __init__(self):
        self.datos: dict[str, Any] = {}

    def guardar(self, nombre: str, datos: dict) -> None:
        self.datos[nombre] = copy.deepcopy(datos)

    def cargar(self, nombre: str) -> Any | None:
        return copy.deepcopy(self.datos[nombre]) if nombre in self.datos else None

    def listar(self, carpeta: str) -> list[str]:
        return sorted(n for n in self.datos if n.startswith(carpeta + "/"))
