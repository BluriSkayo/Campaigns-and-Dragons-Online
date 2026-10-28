"""Simulador del Editor: probar una habilidad con las reglas reales, también con un borrador sin guardar."""
import json
import subprocess
import sys

from mesa import simulador
from tests.conftest import CONFIG

PJ = {"tipo": "personaje", "elecciones": {"raza": "orco", "clase": "guerrero"}}


def test_simular_varias_veces():
    r = simulador.simular(CONFIG, {"habilidad": "ataque_basico", "atacante": PJ, "objetivo": {"tipo": "npc", "id": "goblin"}, "veces": 30, "semilla": 3})
    assert r["ok"] and r["veces"] == 30 and r["n_fallos"] == 0 and len(r["pruebas"]) == 10
    assert r["objetivo"] == "Goblin" and r["resumen"]["min"] <= r["resumen"]["media"] <= r["resumen"]["max"] < 0
    assert "Ataque básico" in r["pruebas"][0]["texto"]


def test_borrador_sin_guardar_y_errores():
    borrador = {"cat": "habilidades", "id": "prueba", "datos": {"nombre": "Golpe fijo", "formula": "7", "alcance": 1}}
    r = simulador.simular(CONFIG, {"borrador": borrador, "habilidad": "prueba", "atacante": {"tipo": "npc", "id": "goblin"}, "objetivo": PJ})
    assert r["ok"] and r["resumen"] == {"min": -7, "max": -7, "media": -7.0}
    malo = {"cat": "habilidades", "id": "prueba", "datos": {"nombre": "Rota", "formula": "[Suerte] +"}}
    r = simulador.simular(CONFIG, {"borrador": malo, "habilidad": "prueba", "atacante": PJ, "objetivo": PJ})
    assert not r["ok"] and r["errores"]
    r = simulador.simular(CONFIG, {"habilidad": "ataque_basico", "atacante": {"tipo": "npc", "id": "dragon"}, "objetivo": PJ, "veces": 3})
    assert r["ok"] and r["n_fallos"] == 3 and "no existe" in r["fallos"][0]
    assert not simulador.simular(CONFIG, {"habilidad": "nada"})["ok"] and not simulador.simular(CONFIG, "x")["ok"]


def test_por_linea_de_ordenes(tmp_path):
    pet = tmp_path / "p.json"
    pet.write_text(json.dumps({"habilidad": "curacion", "atacante": PJ, "objetivo": PJ, "veces": 2}), encoding="utf-8")
    out = subprocess.run([sys.executable, "main.py", "--simular", str(pet), "--config", str(CONFIG)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    r = json.loads(out.stdout)
    assert r["ok"] and r["veces"] == 2


def test_opciones_obligatorias_se_rellenan_solas():
    r = simulador.simular(CONFIG, {"habilidad": "ataque_basico", "atacante": {"tipo": "personaje", "elecciones": {}}, "objetivo": {"tipo": "npc", "id": "goblin"}})
    assert r["ok"] and r["n_fallos"] == 0
