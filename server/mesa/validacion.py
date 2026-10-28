"""validacion.py — Herramientas para validar lo que llega de los YAML de una campaña: el informe de errores y avisos (`Informe`),
la lectura segura de un YAML y el validador de campos (`_Val`: texto, entero, opción, lista, imagen…), que nunca lanza: anota y corrige."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import efectos


@dataclass
class Informe:
    errores: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errores


def _fusionar(base: dict, extra: dict) -> dict:
    res = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(res.get(k), dict):
            res[k] = _fusionar(res[k], v)
        else:
            res[k] = v
    return res


# Lector de YAML en C (libyaml, incluido en PyYAML para Windows) si está: lee igual que el seguro de Python pero ~10 veces más rápido.
# Con miles de archivos era casi todo el tiempo de validar. Si no está, se usa el de siempre.
_CARGADOR = getattr(yaml, "CSafeLoader", yaml.SafeLoader)


def _leer_yaml(ruta: Path, informe: Informe, nombre_rel: str):
    try:
        with open(ruta, "r", encoding="utf-8") as f:
            datos = yaml.load(f, Loader=_CARGADOR)
    except yaml.YAMLError as e:
        informe.errores.append(f"{nombre_rel}: YAML inválido ({str(e).splitlines()[0] if str(e) else 'error'})")
        return None
    except OSError as e:
        informe.errores.append(f"{nombre_rel}: no se pudo leer ({e})")
        return None
    if datos is None:
        datos = {}
    if not isinstance(datos, dict):
        informe.errores.append(f"{nombre_rel}: el archivo debe contener un conjunto de campos, no una lista ni un valor suelto")
        return None
    return datos


class _Val:
    """Ayudantes de validación que acumulan errores con contexto."""

    def __init__(self, informe: Informe, assets: Path):
        self.inf = informe
        self.assets = assets

    def err(self, ctx, msg):
        self.inf.errores.append(f"{ctx}: {msg}")

    def aviso(self, ctx, msg):
        self.inf.avisos.append(f"{ctx}: {msg}")

    def texto(self, ctx, d, k, obligatorio=False, defecto=""):
        v = d.get(k)
        if v is None:
            if obligatorio:
                self.err(ctx, f"falta el campo obligatorio «{k}»")
            return defecto
        if not isinstance(v, str):
            self.err(ctx, f"«{k}» debe ser texto")
            return defecto
        if obligatorio and not v.strip():
            self.err(ctx, f"«{k}» no puede estar vacío")
        return v

    def entero(self, ctx, d, k, defecto, minimo=None, maximo=None):
        v = d.get(k)
        if v is None:
            return defecto
        if isinstance(v, bool) or not isinstance(v, int):
            self.err(ctx, f"«{k}» debe ser un número entero")
            return defecto
        if minimo is not None and v < minimo:
            self.err(ctx, f"«{k}» no puede ser menor que {minimo}")
        if maximo is not None and v > maximo:
            self.err(ctx, f"«{k}» no puede ser mayor que {maximo}")
        return v

    def booleano(self, ctx, d, k, defecto):
        v = d.get(k)
        if v is None:
            return defecto
        if not isinstance(v, bool):
            self.err(ctx, f"«{k}» debe ser verdadero o falso")
            return defecto
        return v

    def opcion(self, ctx, d, k, opciones, defecto):
        v = d.get(k)
        if v is None:
            return defecto
        v = efectos.sin_booleano(v, opciones)
        if v not in opciones:
            self.err(ctx, f"«{k}» debe ser uno de: {', '.join(sorted(opciones))} (es «{v}»)")
            return defecto
        return v

    def lista(self, ctx, d, k):
        v = d.get(k)
        if v is None:
            return []
        if not isinstance(v, list):
            self.err(ctx, f"«{k}» debe ser una lista")
            return []
        return v

    def diccionario(self, ctx, d, k):
        v = d.get(k)
        if v is None:
            return {}
        if not isinstance(v, dict):
            self.err(ctx, f"«{k}» debe ser un conjunto de campos")
            return {}
        return v

    def imagen(self, ctx, d, k="imagen"):
        # Las imágenes viven en la carpeta base/ de la campaña (y en la de cada cliente): el servidor solo guarda el nombre.
        return self.texto(ctx, d, k)


def _num(x):
    return not isinstance(x, bool) and isinstance(x, (int, float)) and abs(x) <= 1e9
