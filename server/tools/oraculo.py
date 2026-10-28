"""tools/oraculo.py — Oráculo de comportamiento (solo desarrollo): juega miles de acciones al azar con semilla fija contra EstadoPartida
y escribe cada resultado, error y algunas vistas. Antes de una reorganización grande, guarda la salida; después, compárala: si no es idéntica
byte a byte, algo cambió.

    python tools/oraculo.py . antes.txt 1 5000      (desde server/; semilla 1, 5000 pasos)
    python tools/oraculo.py . despues.txt 1 5000 && cmp antes.txt despues.txt
"""
import json
import random
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

SERVER = Path(sys.argv[1]).resolve()
SALIDA = sys.argv[2]
SEMILLA = int(sys.argv[3]) if len(sys.argv) > 3 else 7
PASOS = int(sys.argv[4]) if len(sys.argv) > 4 else 4000
sys.path.insert(0, str(SERVER))

_ids = random.Random(12345)
uuid.uuid4 = lambda: uuid.UUID(int=_ids.getrandbits(128))

from mesa import recursos  # noqa: E402
from mesa.errores import ErrorJuego  # noqa: E402
from mesa.estado import EstadoPartida  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="oraculo-"))
cfg = tmp / "ejemplo"
shutil.copytree(SERVER / "campanas" / "ejemplo", cfg)
shutil.copytree(SERVER / "tests" / "plantillas", cfg / "characters")
cat, inf = recursos.cargar(cfg)
assert inf.ok, inf.errores
cat.config["juego"]["ciclo"]["activo"] = True
cat.config["juego"]["clima"]["activo"] = True

def estado(eid, efectos=(), **extra):
    cat.estados[eid] = {"nombre": eid.capitalize(), "descripcion": "", "imagen": "", "color": "", "duracion": 3, "etiquetas": [],
                        "impide": [], "al_terminar": "", "al_reaplicar": "renovar", "max_cargas": 5, "impide_etiquetas": [],
                        "efectos": list(efectos), **extra}

def ef(cuando, hacer, si=None):
    e = {"cuando": cuando if isinstance(cuando, dict) else {"tipo": cuando}, "hacer": hacer}
    if si:
        e["si"] = si
    return e

estado("reflejo", [ef("al_ser_atacado", {"tipo": "redirigir_ataque", "hacia": "quien_ataca"})])
estado("confusion", [ef({"tipo": "al_intentar", "accion": "atacar"}, {"tipo": "redirigir_ataque", "hacia": "aleatorio"})])
estado("escudo", [ef("siempre", {"tipo": "absorber_dano", "recurso": "MP"})])
estado("espinas", [ef({"tipo": "al_ser_atacado"}, {"tipo": "reducir_dano", "valor": 50, "unidad": "porcentaje"}),
                   ef({"tipo": "al_ser_atacado"}, {"tipo": "devolver_dano", "valor": 100})])
estado("miedo", [ef({"tipo": "al_intentar", "accion": "atacar"}, {"tipo": "impedir_accion"})])
estado("acumula", [ef("inicio_turno", {"tipo": "modificar_recurso", "recurso": "HP", "formula": "-1", "objetivo": "uno_mismo"})],
       al_reaplicar="acumular")

base = dict(cat.habilidades["ataque_basico"])
FORMAS = ["uno", "explosion", "linea", "frente", "cono", "casillas"]
r = random.Random(SEMILLA * 31)
nuevas = []
for i in range(40):
    h = dict(base)
    forma = r.choice(FORMAS)
    tipo = r.choice(["dano", "dano", "curacion", "efecto"])
    h.update({
        "nombre": f"H{i}", "tipo": tipo, "objetivo": r.choice(["enemigo", "aliado", "cualquiera", "uno_mismo"]) if tipo != "dano" else r.choice(["enemigo", "enemigo", "cualquiera", "uno_mismo"]),
        "formula": r.choice(["10", "1d8 + 2", "[a.Fuerza] - [o.Resistencia] + 1d6", "5 + [Distancia]", "0", "2d6"]),
        "area": {"forma": forma, "tamano": r.randint(1, 3), "afecta": r.choice(["rivales", "todos", "aliados"])},
        "alcance": r.randint(1, 8), "golpes": r.choice([1, 1, 2, 3]), "sin_limite": r.random() < .2,
        "coste": r.choice([{}, {"MP": 2}, {"HP": 1}]),
        "mover_objetivo": r.choice([None, None, {"modo": "empujar", "casillas": 2}, {"modo": "atraer", "casillas": 1}]),
        "requisitos": r.choice([[], [], [{"tipo": "recurso", "recurso": "HP", "comparacion": "al_menos", "valor": 5, "quien": "uno_mismo"}],
                                [{"tipo": "tiene_estado", "estado": "veneno", "quien": "objetivo", "es": "no"}]]),
        "efectos": r.choice([[], [{"cuando": {"tipo": "al_impactar"}, "hacer": {"tipo": "modificar_recurso", "recurso": "MP", "formula": "1", "objetivo": "uno_mismo"}}]]),
        "aplica_estado": r.choice(["", "", "veneno", "reflejo", "confusion", "escudo", "espinas", "miedo", "acumula"]),
        "alternar": r.random() < .15, "aplicar_si_falla": r.random() < .2, "atraviesa_muros": r.random() < .7,
        "critico": r.choice([None, None, {"desde": 15, "multiplicador": 2}]),
        "etiquetas": [], "etiquetas_del_usuario": r.random() < .3,
    })
    cat.habilidades[f"h{i}"] = h
    nuevas.append(f"h{i}")

e = EstadoPartida(cat, tmp / "datos", rng=random.Random(SEMILLA), persistir=True)
rng = random.Random(SEMILLA + 1)
USUARIOS = ["Ana", "Bea", "Cid"]
for u in USUARIOS:
    e.registrar_usuario(u)
pjs = {}
for u, plantilla in zip(USUARIOS, ["guerrero", "mago", "guerrero"]):
    p = e.crear_personaje(u, False, plantilla, u + "PJ")
    for hid in nuevas:
        p["habilidades"].append(hid)
    pjs[u] = p
    e.desplegar_personaje(u, p["id"], u, False, 2 + len(pjs) * 2, 8)
for i in range(6):
    try:
        e.colocar_enemigo(rng.choice(list(cat.enemigos)), rng.randint(0, 19), rng.randint(0, 14))
    except ErrorJuego:
        pass

out = []
def anota(*x):
    out.append(json.dumps(x, ensure_ascii=False, sort_keys=True, default=lambda o: sorted(o) if isinstance(o, set) else repr(o)))

def toks():
    return list(e.tokens.values())

def tok_id():
    t = toks()
    return rng.choice(t)["id"] if t and rng.random() < .95 else "nada"

def quien():
    gm = rng.random() < .3
    return rng.choice(USUARIOS), gm

def mapa():
    return e.mapa["ancho"], e.mapa["alto"]

ACC = []
def acc(peso):
    def reg(f):
        ACC.extend([f] * peso)
        return f
    return reg

@acc(12)
def a_habilidad():
    u, gm = quien()
    t = rng.choice(toks()) if toks() else None
    if not t:
        return None
    if e.combate["activo"] and e.token_en_turno() in e.tokens and rng.random() < .8:
        t = e.tokens[e.token_en_turno()]
    gm = gm or rng.random() < .3 or (t["tipo"] != "personaje" and rng.random() < .9)
    d = e.datos_de(t)
    hid = rng.choice(d["habilidades"] or ["x"])
    w, h = mapa()
    cerca = sorted(toks(), key=lambda o: abs(o["x"] - t["x"]) + abs(o["y"] - t["y"]))[:4]
    obj = rng.choice(cerca)["id"] if rng.random() < .6 else None
    cas = (rng.randint(-1, w), rng.randint(-1, h)) if obj is None and rng.random() < .8 else None
    if t["tipo"] == "personaje" and rng.random() < .8:
        u = t["dueno"]
    return e.usar_habilidad(t["id"], hid, obj, u, gm, rng.choice([None, "todos", "enemigos"]), cas)

@acc(6)
def a_mover():
    u, gm = quien()
    t = rng.choice(toks()) if toks() else None
    if not t:
        return None
    if t["tipo"] == "personaje" and rng.random() < .8:
        u = t["dueno"]
    return e.mover_token(t["id"], t["x"] + rng.randint(-3, 3), t["y"] + rng.randint(-3, 3), u, gm)

@acc(2)
def a_combate():
    if e.combate["activo"]:
        return e.terminar_combate() if rng.random() < .2 else e.terminar_turno(rng.choice(USUARIOS), True)
    t = e.iniciar_combate()
    return e.empezar_tras_tiradas() if e.combate.get("preparando") else t

@acc(4)
def a_turno():
    u, gm = quien()
    return e.terminar_turno(u, gm)

@acc(2)
def a_objeto():
    u, gm = quien()
    t = rng.choice(toks()) if toks() else None
    if not t:
        return None
    return e.usar_objeto(t["id"], rng.choice(list(cat.objetos)), t.get("dueno", u), gm, tok_id() if rng.random() < .5 else None)

@acc(1)
def a_dar():
    u, gm = quien()
    return e.dar_objeto(tok_id(), tok_id(), rng.choice(list(cat.objetos)), rng.randint(0, 2), u, gm)

@acc(2)
def a_golpe():
    u, gm = quien()
    w, h = mapa()
    return e.golpear_casilla(rng.randint(0, w - 1), rng.randint(0, h - 1), u, gm, tok_id() if rng.random() < .5 else None, rng.random() < .2)

@acc(2)
def a_dibujo():
    u, gm = quien()
    pts = [[rng.uniform(0, 15), rng.uniform(0, 10)] for _ in range(rng.randint(1, 6))]
    return e.anadir_dibujo(u, gm, rng.choice(["#f0b44c", "#c4533f", "rojo"]), pts, rng.choice([None, 3, 50]))

@acc(1)
def a_borrar_zona():
    u, gm = quien()
    return e.borrar_zona(u, gm, [[rng.uniform(0, 15), rng.uniform(0, 10)] for _ in range(3)], rng.uniform(0, 2))

@acc(1)
def a_borrar_dibujos():
    u, gm = quien()
    return e.borrar_dibujos(u, gm, None, rng.choice([None, u]))

@acc(2)
def a_chat():
    u, gm = quien()
    salas = ["general", *e.salas_chat]
    return e.anadir_chat(u, rng.choice(["hola", "/1d20", "x" * 30]), rng.choice(["normal", "tirada"]), rng.choice(salas), rng.choice([None, e.mapa_id]))

@acc(1)
def a_sala_chat():
    k = rng.random()
    if k < .5 or not e.salas_chat:
        return e.crear_sala(rng.choice(["Secreta", "Grupo", ""]), rng.sample(USUARIOS, 2))
    sid = rng.choice(list(e.salas_chat))
    return e.editar_sala(sid, "Otra", USUARIOS) if k < .8 else e.borrar_sala(sid)

@acc(2)
def a_tirar():
    u, gm = quien()
    return e.tirar(u, rng.choice(["1d20", "2d6+3", "d", "1d20 + [Fuerza]", "4d6kh3"]), gm)

@acc(1)
def a_tiradas_guardadas():
    u, gm = quien()
    k = rng.random()
    if k < .5:
        return e.guardar_tirada(u, rng.choice(["Ataque", "Daño x"]), rng.choice(["1d20+2", "2d6"]), gm)
    if k < .7:
        return e.borrar_tirada(u, "Ataque")
    return e.tirar_guardada(u, "Ataque", None)

@acc(1)
def a_ambiente():
    k = rng.random()
    if k < .3:
        return e.cambiar_periodo(rng.randint(-1, 4))
    if k < .6:
        return e.cambiar_clima(rng.randint(-1, 4))
    if k < .8:
        return e.cambiar_musica(rng.choice([None, "nada.ogg"]))
    return e.cambiar_ambiente(rng.choice([None, "x.ogg"]), rng.random() < .5)

@acc(2)
def a_gm_estado():
    return e.gm_estado(tok_id(), rng.choice(list(cat.estados) + ["nope"]), rng.random() < .7)

@acc(1)
def a_editar_token():
    return e.editar_token(tok_id(), nombre=rng.choice([None, "Nuevo"]), recursos=rng.choice([None, {"HP": {"actual": 5}}]),
                          bando=rng.choice([None, "aliado", "enemigo", "neutral"]))

@acc(1)
def a_enemigo():
    w, h = mapa()
    return e.colocar_enemigo(rng.choice(list(cat.enemigos)), rng.randint(0, w - 1), rng.randint(0, h - 1))

@acc(1)
def a_quitar():
    if len(toks()) > 5:
        return e.quitar_token(rng.choice([t["id"] for t in toks() if t["tipo"] == "enemigo"] or ["x"]))

@acc(1)
def a_escala_grupo():
    u, gm = quien()
    k = rng.random()
    if k < .4:
        return e.escalar_token(tok_id(), rng.choice([0.5, 1, 2, 3, 7]), u, gm)
    if k < .7:
        return e.agrupar_tokens([tok_id(), tok_id()], u, gm)
    return e.desagrupar_token(tok_id(), u, gm)

@acc(1)
def a_exp():
    u = rng.choice(USUARIOS)
    return e.subir_nivel(u, pjs[u]["id"])

@acc(1)
def a_capa_niebla():
    return e.fijar_capa(rng.choice([1, 2, 3]), rng.random() < .5)

@acc(1)
def a_sala():
    u, gm = quien()
    t = rng.choice(toks()) if toks() else None
    destino = rng.choice(list(cat.mapas))
    if rng.random() < .3:
        return e.cambiar_mapa(destino)
    return e.cambiar_de_sala(u, gm, t["id"] if t else None, destino)

@acc(1)
def a_tienda():
    u = rng.choice(USUARIOS)
    tid = rng.choice(list(cat.tiendas))
    k = rng.random()
    if k < .3:
        return e.abrir_tienda(tid, rng.random() < .8, rng.random() < .3)
    if k < .7:
        return e.comprar(u, pjs[u]["id"], tid, rng.choice(list(cat.objetos)), rng.randint(1, 2))
    return e.vender(u, pjs[u]["id"], tid, rng.choice(list(cat.objetos)), 1)

@acc(1)
def a_iniciativa():
    u, gm = quien()
    return e.tirar_iniciativa(tok_id(), u, gm)

@acc(1)
def a_revelar():
    return e.revelar_token(tok_id(), rng.sample(["estadisticas", "recursos", "inventario", "habilidades", "ficha", "x"], 2))

for paso in range(PASOS):
    f = rng.choice(ACC)
    try:
        res = f()
        anota(paso, f.__name__, "ok", res)
    except ErrorJuego as ex:
        anota(paso, f.__name__, "error", str(ex))
    colas = e.vaciar_colas()
    if colas != ([], []):
        anota(paso, "colas", colas)
    if e.golpes_pendientes:
        anota(paso, "golpes", e.golpes_pendientes)
        e.golpes_pendientes = []
    if paso % 97 == 0:
        for u in USUARIOS:
            anota(paso, "snap", u, e.snapshot(u, False))
        anota(paso, "snapgm", e.snapshot("GM", True))

e.guardar_estado()
for u in USUARIOS:
    e.guardar_jugador(u)
for p in sorted((tmp / "datos").rglob("*.yaml")):
    anota("archivo", p.name, p.read_text(encoding="utf-8"))
# recargar y comparar
b = EstadoPartida(cat, tmp / "datos", rng=random.Random(1))
for u in USUARIOS:
    b.registrar_usuario(u)
b.cargar_estado()
anota("recarga", b.snapshot("GM", True))
Path(SALIDA).write_text("\n".join(out), encoding="utf-8")
ok = sum(1 for l in out if '"ok"' in l)
print(len(out), "líneas;", ok, "acciones ok")
