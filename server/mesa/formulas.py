"""
formulas.py — Evaluador seguro de fórmulas.

Sintaxis (compatible con las fórmulas anteriores):

    40   1,5   1.5                     números (coma o punto decimal)
    [a.Fuerza] / 4 + 1d20                estadística o recurso del que actúa + dado
    [o.Defensa]                          … del objetivo
    [h.Potencia]                         valor propio de la habilidad que se usa
    [Fuerza]                             forma corta de [a.Fuerza]
    XdY                                  X dados de Y caras (d20 = 1d20)
    + - * / %  ( )                       aritmética; los corchetes sin nombre son paréntesis
    < > <= >= = <>                       comparaciones (valen 1 si se cumplen, 0 si no)
    max(a; b; …)  min(a; b; …)           el mayor / el menor
    redondear(x)  abajo(x)  arriba(x)  abs(x)
    si(condición; si_se_cumple; si_no)   p. ej. si(1d20 >= 15; 2; 1)
    tabla(Nombre; valor)                 busca «valor» en una tabla por tramos de la campaña
    ventaja()                            multiplicador por etiquetas: las de la habilidad contra las del objetivo (1 si no hay)

Los argumentos se separan con «;» (como en una hoja de cálculo en español). El resultado final se redondea
hacia abajo. NO se usa eval(): la expresión se analiza con `ast` y solo se aceptan números, operaciones,
comparaciones y las funciones de la lista.
"""

from __future__ import annotations

import ast
import math
import operator
import random
import re
from dataclasses import dataclass

MAX_LONGITUD = 1000
MAX_DADOS = 100
MAX_CARAS = 1000


class FormulaError(ValueError):
    """Error de sintaxis o de datos en una fórmula (el mensaje es apto para mostrar)."""


@dataclass
class Resultado:
    valor: int
    detalle: str


_REF_PREFIJO = re.compile(r"\[\s*([aAoOhH])\s*\.\s*([^\[\]]+?)\s*\]")
_TABLA = re.compile(r"\btabla\s*\(\s*([^;()\[\]]+?)\s*;", re.IGNORECASE)
FUNCIONES = {"max": (1, 20), "min": (1, 20), "redondear": (1, 1), "abajo": (1, 1), "arriba": (1, 1), "abs": (1, 1), "si": (3, 3), "tabla": (2, 2), "ventaja": (0, 0)}
MAX_TABLAS_POR_FORMULA = 10
_DADO = re.compile(r"(?<![\w.])(\d*)[dD](\d+)(?!\w)")
_REF_CORTA = re.compile(r"\[\s*([^\[\]]*[^\W\d_][^\[\]]*?)\s*\]")  # contiene alguna letra

_BINARIOS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
}


def _buscar(stats: dict, nombre: str):
    clave = nombre.strip().casefold()
    for k, v in stats.items():
        if str(k).strip().casefold() == clave:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise FormulaError(f"«{nombre.strip()}» no es un valor numérico")
            return v
    raise FormulaError(f"Estadística desconocida: «{nombre.strip()}»")


def _numero(n) -> str:
    return str(int(n)) if float(n).is_integer() else f"{n:g}".replace(".", ",")


def _como_texto(n) -> str:
    return repr(n) if n >= 0 else f"({n!r})"


def referencias(formula: str) -> list[tuple[str, str]]:
    """Devuelve [(prefijo, nombre)] de todo lo citado entre corchetes. prefijo: 'a', 'o' o 'h' (valor de la habilidad)."""
    refs = [(m.group(1).lower(), m.group(2).strip()) for m in _REF_PREFIJO.finditer(formula)]
    resto = _REF_PREFIJO.sub("0", formula)
    resto = _DADO.sub("0", resto)
    refs += [("a", m.group(1).strip()) for m in _REF_CORTA.finditer(resto)]
    return refs


def tablas_de(config: dict) -> dict:
    """{nombre en minúsculas: tabla} a partir de juego.tablas de la campaña."""
    return {str(t["nombre"]).strip().casefold(): t for t in (config.get("juego", {}).get("tablas") or [])}


def buscar_en_tabla(tabla: dict, valor: float):
    """Primera fila cuyo tramo [desde, hasta] contiene el valor (un extremo vacío = sin límite); si ninguna, el valor por defecto."""
    for f in tabla.get("filas", []):
        if (f.get("desde") is None or valor >= f["desde"]) and (f.get("hasta") is None or valor <= f["hasta"]):
            return f["valor"]
    return tabla.get("defecto", 0)


def evaluar(formula: str, atacante: dict | None = None, objetivo: dict | None = None,
            rng: random.Random | None = None, tablas: dict | None = None, habilidad: dict | None = None,
            ventaja: float = 1) -> Resultado:
    """Evalúa la fórmula. Lanza FormulaError si es inválida.
    `tablas`: {nombre en minúsculas: tabla} (ver tablas_de); `habilidad`: valores propios de la habilidad ([h.X]);
    `ventaja`: el multiplicador por etiquetas que devuelve ventaja() (lo calcula quien usa la habilidad)."""
    if not isinstance(formula, str) or not formula.strip():
        raise FormulaError("La fórmula está vacía")
    if len(formula) > MAX_LONGITUD:
        raise FormulaError(f"La fórmula supera {MAX_LONGITUD} caracteres")
    rng = rng or random
    atacante = atacante or {}
    detalles: list[str] = []
    expr = formula.strip()

    tablas = tablas or {}
    usadas: list[dict] = []

    # 0) tabla(Nombre; …) → tabla(<n.º>, …): el nombre se resuelve antes de tocar nada más
    def ref_tabla(m):
        t = tablas.get(m.group(1).strip().casefold())
        if t is None:
            raise FormulaError(f"Tabla desconocida: «{m.group(1).strip()}»")
        if len(usadas) >= MAX_TABLAS_POR_FORMULA:
            raise FormulaError("Demasiadas tablas en una fórmula")
        usadas.append(t)
        return f"tabla({len(usadas) - 1};"
    expr = _TABLA.sub(ref_tabla, expr)

    # 1) [a.X] / [o.X] / [h.X]
    def ref_prefijo(m):
        p = m.group(1).lower()
        if p == "h":
            if habilidad is None:
                raise FormulaError("La fórmula usa [h.…] pero no la usa una habilidad")
            valor = _buscar(habilidad, m.group(2))
        else:
            if p == "o" and objetivo is None:
                raise FormulaError("La fórmula usa [o.…] pero no hay objetivo")
            valor = _buscar(atacante if p == "a" else objetivo, m.group(2))
        detalles.append(f"[{p}.{m.group(2).strip()}]={_numero(valor)}")
        return _como_texto(valor)
    expr = _REF_PREFIJO.sub(ref_prefijo, expr)

    # 2) dados → dado(n; caras): se tiran al calcular, así un si(…) solo tira los de la rama elegida
    def dado(m):
        n = int(m.group(1)) if m.group(1) else 1
        caras = int(m.group(2))
        if not (1 <= n <= MAX_DADOS) or not (1 <= caras <= MAX_CARAS):
            raise FormulaError(f"Dado no permitido: {n}d{caras}")
        return f"dado({n};{caras})"
    expr = _DADO.sub(dado, expr)

    # 3) [X] sin prefijo → atacante
    def ref_corta(m):
        valor = _buscar(atacante, m.group(1))
        detalles.append(f"[{m.group(1).strip()}]={_numero(valor)}")
        return _como_texto(valor)
    expr = _REF_CORTA.sub(ref_corta, expr)

    # 4) los corchetes restantes son paréntesis; coma decimal; «;» separa argumentos; = y <> como en una hoja de cálculo
    expr = expr.replace("[", "(").replace("]", ")")
    expr = re.sub(r"(?<=\d),(?=\d)", ".", expr)
    if "," in expr:
        raise FormulaError("Separa los argumentos con «;» (la coma es para decimales: 1,5)")
    expr = expr.replace(";", ",").replace("<>", "!=")
    expr = re.sub(r"(?<![<>!=])=(?!=)", "==", expr)

    valor = math.floor(_evaluar_aritmetica(expr, usadas, detalles, rng, ventaja))
    if not detalles or (len(detalles) == 1 and detalles[0].split("=")[0].lower() == formula.strip().lower().replace(" ", "")):
        texto = f"{formula.strip()} = {valor}"          # tirada simple: «1d20 = 6»
    else:
        texto = f"{formula.strip()} → {' | '.join(detalles)} = {valor}"
    return Resultado(valor=valor, detalle=texto)


_COMPARAR = {ast.Lt: operator.lt, ast.Gt: operator.gt, ast.LtE: operator.le, ast.GtE: operator.ge, ast.Eq: operator.eq, ast.NotEq: operator.ne}


def _evaluar_aritmetica(expr: str, tablas_usadas: list | None = None, detalles: list | None = None, rng=None, ventaja: float = 1) -> float:
    try:
        arbol = ast.parse(expr, mode="eval")
    except SyntaxError:
        raise FormulaError("Expresión inválida (revisa operadores, paréntesis y «;»)") from None
    tablas_usadas = tablas_usadas or []
    detalles = detalles if detalles is not None else []
    rng = rng or random
    tiradas = [0]

    def ev(nodo):
        if isinstance(nodo, ast.Expression):
            return ev(nodo.body)
        if isinstance(nodo, ast.Constant) and isinstance(nodo.value, (int, float)) \
                and not isinstance(nodo.value, bool):
            return nodo.value
        if isinstance(nodo, ast.UnaryOp) and isinstance(nodo.op, (ast.USub, ast.UAdd)):
            v = ev(nodo.operand)
            return -v if isinstance(nodo.op, ast.USub) else v
        if isinstance(nodo, ast.BinOp) and type(nodo.op) in _BINARIOS:
            izq, der = ev(nodo.left), ev(nodo.right)
            try:
                r = _BINARIOS[type(nodo.op)](izq, der)
            except ZeroDivisionError:
                raise FormulaError("División entre cero") from None
            if abs(r) > 1e12:
                raise FormulaError("El resultado es demasiado grande")
            return r
        if isinstance(nodo, ast.Compare) and len(nodo.ops) == 1 and type(nodo.ops[0]) in _COMPARAR:
            return 1 if _COMPARAR[type(nodo.ops[0])](ev(nodo.left), ev(nodo.comparators[0])) else 0
        if isinstance(nodo, ast.Call) and isinstance(nodo.func, ast.Name) and not nodo.keywords:
            nombre = nodo.func.id.lower()
            if nombre == "dado" and len(nodo.args) == 2:
                n, caras = int(ev(nodo.args[0])), int(ev(nodo.args[1]))
                if not (1 <= n <= MAX_DADOS) or not (1 <= caras <= MAX_CARAS):
                    raise FormulaError(f"Dado no permitido: {n}d{caras}")
                tiradas[0] += n
                if tiradas[0] > 10 * MAX_DADOS:
                    raise FormulaError("Demasiados dados en una fórmula")
                total = sum(rng.randint(1, caras) for _ in range(n))
                detalles.append(f"{n}d{caras}={total}")
                return total
            if nombre not in FUNCIONES:
                raise FormulaError(f"Función desconocida: «{nodo.func.id}». Disponibles: {', '.join(FUNCIONES)}")
            mn, mx = FUNCIONES[nombre]
            if not mn <= len(nodo.args) <= mx:
                raise FormulaError(f"«{nombre}» necesita {mn if mn == mx else f'entre {mn} y {mx}'} valor(es) separados por «;»")
            if nombre == "si":                      # solo se calcula la rama elegida (y sus dados)
                return ev(nodo.args[1]) if ev(nodo.args[0]) else ev(nodo.args[2])
            if nombre == "ventaja":
                detalles.append(f"ventaja={_numero(ventaja)}")
                return ventaja
            if nombre == "tabla":
                t = tablas_usadas[int(ev(nodo.args[0]))]
                x = ev(nodo.args[1])
                r = buscar_en_tabla(t, x)
                detalles.append(f"{t['nombre']}({_numero(x)})={_numero(r)}")
                return r
            vals = [ev(x) for x in nodo.args]
            return {"max": max, "min": min}[nombre](vals) if nombre in ("max", "min") else \
                {"redondear": lambda v: math.floor(v + 0.5), "abajo": math.floor, "arriba": math.ceil, "abs": abs}[nombre](vals[0])
        raise FormulaError("La fórmula contiene elementos no permitidos")

    return ev(arbol)


def validar(formula: str, nombres_validos: list[str] | set[str], tablas: dict | None = None,
            valores_habilidad: list[str] | set[str] | None = None) -> list[str]:
    """
    Comprueba una fórmula sin tirar dados reales.
    `valores_habilidad`: nombres permitidos en [h.X] (None = la fórmula no es de una habilidad).
    Devuelve una lista de errores (vacía si es correcta).
    """
    errores: list[str] = []
    if not isinstance(formula, str) or not formula.strip():
        return ["la fórmula está vacía"]
    validos = {n.strip().casefold() for n in nombres_validos}
    vh = {n.strip().casefold() for n in (valores_habilidad or [])}
    try:
        for p, nombre in referencias(formula):
            if p == "h":
                if valores_habilidad is None:
                    errores.append(f"[h.{nombre}] solo se puede usar en la fórmula de una habilidad")
                elif nombre.casefold() not in vh:
                    errores.append(f"la habilidad no tiene el valor «{nombre}» (añádelo en «Valores propios»)")
            elif nombre.casefold() not in validos:
                errores.append(f"la fórmula cita «{nombre}», que no existe")
    except FormulaError as e:
        return [str(e)]
    if errores:
        return errores
    ficticio = {n: 1 for n in nombres_validos}
    try:
        evaluar(formula, ficticio, ficticio, random.Random(0), tablas=tablas, habilidad={n: 1 for n in (valores_habilidad or [])})
    except FormulaError as e:
        errores.append(str(e))
    return errores
