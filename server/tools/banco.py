"""tools/banco.py — Banco de carga del servidor (solo desarrollo), sin red: 8 jugadores + GM, niebla, 30 NPC. Mide acciones por segundo y
hace un hash de todo lo que recibe cada cliente (con PYTHONHASHSEED=0 es reproducible): una optimización no debe cambiar el hash.

    PYTHONHASHSEED=0 python tools/banco.py . 3000            (desde server/)
    PYTHONHASHSEED=0 python tools/banco.py . 3000 perfil     (con cProfile)
    Variables: NIEBLA=0|1, COMPARTIR=0|1, COMBATE=0|1
"""
import asyncio
import cProfile
import hashlib
import pstats
import random
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

SERVER = Path(sys.argv[1]).resolve()
PASOS = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
PERFIL = len(sys.argv) > 3 and sys.argv[3] == "perfil"
sys.path.insert(0, str(SERVER))
_ids = random.Random(99)
uuid.uuid4 = lambda: uuid.UUID(int=_ids.getrandbits(128))

import logging  # noqa: E402
logging.disable(logging.CRITICAL)
from mesa import recursos  # noqa: E402
from mesa.errores import ErrorJuego  # noqa: E402
from mesa.estado import EstadoPartida  # noqa: E402
from mesa.servidor import Servidor  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="banco-"))
cfg = tmp / "ej"
shutil.copytree(SERVER / "campanas" / "ejemplo", cfg)
shutil.copytree(SERVER / "tests" / "plantillas", cfg / "characters")
cat, inf = recursos.cargar(cfg)
assert inf.ok
import os
cat.config["juego"]["niebla"]["activa"] = os.environ.get("NIEBLA", "1") == "1"
cat.config["juego"]["niebla"]["compartir"] = os.environ.get("COMPARTIR", "1") == "1"
if os.environ.get("COMBATE") == "1":
    cat.config["permisos"]["acciones_solo_en_su_turno"] = True
cat.config["servidor"]["password_gm"] = ""
cat.config["permisos"]["acciones_solo_en_su_turno"] = os.environ.get("COMBATE") == "1"
estado = EstadoPartida(cat, tmp / "datos", rng=random.Random(5), persistir=False)
srv = Servidor(cat, estado)


class WS:
    remote_address = ("127.0.0.1", 1)

    def __init__(self, nombre):
        self.nombre = nombre
        self.h = hashlib.sha256()
        self.n = 0
        self.bytes = 0

    async def send(self, texto):
        self.h.update(texto.encode())
        self.n += 1
        self.bytes += len(texto)


rng = random.Random(11)
JUG = [f"J{i}" for i in range(8)]
clientes = {}


async def atender(ws, **msg):
    try:
        await srv._atender(ws, msg)
    except ErrorJuego as e:
        ws.h.update(("ERR" + str(e)).encode())


async def preparar():
    gm = WS("GM")
    clientes["GM"] = gm
    await atender(gm, tipo="entrar", usuario="GM", gm=True)
    m = estado.mapa
    for j in JUG:
        ws = WS(j)
        clientes[j] = ws
        await atender(ws, tipo="entrar", usuario=j)
        p = estado.crear_personaje(j, False, rng.choice(["guerrero", "mago"]), j + "pj")
        await atender(ws, tipo="desplegar_personaje", personaje=p["id"])
        await atender(ws, tipo="elegir_personaje", personaje=p["id"])
    for _ in range(30):
        await atender(gm, tipo="gm_colocar_enemigo", enemigo=rng.choice(list(cat.enemigos)), x=rng.randrange(m["ancho"]), y=rng.randrange(m["alto"]))
    return m


def token_de(j):
    return next((t for t in estado.tokens.values() if t.get("dueno") == j), None)


async def jugar(m):
    hechos = 0
    for paso in range(PASOS):
        j = rng.choice(JUG)
        ws = clientes[j]
        t = token_de(j)
        r = rng.random()
        if r < .6 and t:
            await atender(ws, tipo="mover_token", token=t["id"], x=max(0, min(m["ancho"] - 1, t["x"] + rng.randint(-1, 1))),
                          y=max(0, min(m["alto"] - 1, t["y"] + rng.randint(-1, 1))))
        elif r < .7:
            await atender(ws, tipo="chat", texto=rng.choice(["hola", "/r 1d20", "vamos"]))
        elif r < .78 and t:
            cerca = min((o for o in estado.tokens.values() if o is not t), key=lambda o: abs(o["x"] - t["x"]) + abs(o["y"] - t["y"]))
            await atender(ws, tipo="usar_habilidad", token=t["id"], habilidad="ataque_basico", objetivo=cerca["id"])
        elif r < .86:
            await atender(ws, tipo="ping", x=rng.randrange(m["ancho"]), y=rng.randrange(m["alto"]))
        elif r < .92:
            await atender(ws, tipo="dibujar", color="#f0b44c", puntos=[[rng.uniform(0, 10), rng.uniform(0, 10)] for _ in range(5)])
        elif r < .97:
            gm = clientes["GM"]
            o = rng.choice(list(estado.tokens.values()))
            await atender(gm, tipo="mover_token", token=o["id"], x=rng.randrange(m["ancho"]), y=rng.randrange(m["alto"]))
        elif r < .985:
            await atender(ws, tipo="pedir_estado")
        else:
            gm = clientes["GM"]
            if estado.combate["activo"]:
                await atender(gm, tipo=rng.choice(["terminar_turno", "terminar_turno", "gm_terminar_combate"]))
            else:
                await atender(gm, tipo="gm_iniciar_combate")
                await atender(gm, tipo="gm_empezar_combate")
        hechos += 1
        # el servidor limita la frecuencia de pings por persona: que no dependa del reloj
        for s in srv.sesiones.values():
            s.ultimo_ping = s.ultima_regla = s.ultimo_lapiz = 0.0
        srv._ultimos.clear()
    return hechos


async def principal():
    m = await preparar()
    t0 = time.perf_counter()
    if PERFIL:
        pr = cProfile.Profile()
        pr.enable()
    n = await jugar(m)
    if PERFIL:
        pr.disable()
    dt = time.perf_counter() - t0
    tot_msgs = sum(w.n for w in clientes.values())
    tot_bytes = sum(w.bytes for w in clientes.values())
    print(f"{n} acciones en {dt:.2f}s → {n / dt:.0f} acciones/s · {tot_msgs} mensajes enviados · {tot_bytes / 1e6:.1f} MB")
    h = hashlib.sha256()
    for k in sorted(clientes):
        h.update(clientes[k].h.digest())
    print("hash:", h.hexdigest()[:16])
    if PERFIL:
        pstats.Stats(pr).sort_stats("cumulative").print_stats(35)

asyncio.run(principal())
