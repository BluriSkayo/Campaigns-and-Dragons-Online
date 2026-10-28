"""Prepara una copia de config/ con imágenes y un audio de prueba para la prueba de extremo a extremo."""
import math, shutil, struct, sys, wave, zlib
from pathlib import Path

origen, destino, base = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
shutil.rmtree(destino, ignore_errors=True)
shutil.copytree(origen, destino)

def png(w, h, pixel):
    crudo = b"".join(b"\x00" + bytes(c for x in range(w) for c in pixel(x, y)) for y in range(h))
    def trozo(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + trozo(b"IDAT", zlib.compress(crudo)) + trozo(b"IEND", b"")

assets = base            # las imágenes y la música viven en la carpeta base del cliente
for c in ("tokens", "maps", "icons", "sonido/musica", "sonido/ambiente", "sonido/efectos"):
    (assets / c).mkdir(parents=True, exist_ok=True)
(assets / "tokens" / "guerrero.png").write_bytes(png(1200, 1200, lambda x, y: (230, 160, 40) if (x // 8 + y // 8) % 2 else (150, 60, 30)))
(assets / "tokens" / "goblin.png").write_bytes(png(48, 48, lambda x, y: (90, 200, 90) if (x // 8 + y // 8) % 2 else (30, 100, 40)))
(assets / "maps" / "aldea.png").write_bytes(png(320, 192, lambda x, y: (60 + y // 4, 110 + x // 8, 70)))
with wave.open(str(assets / "sonido" / "musica" / "tema_de_prueba.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(4000)))

def anadir(ruta, linea):
    t = ruta.read_text(encoding="utf-8")
    ruta.write_text(t.rstrip("\n") + "\n" + linea + "\n", encoding="utf-8")
(destino / "sonidos.yaml").write_text("musica:\n  - categoria: Pueblo\n    archivos: [taberna.wav]\n  - categoria: Pruebas\n    archivos: [tema_de_prueba.wav, batalla.ogg]\nambiente:\n  - categoria: Clima\n    archivos: [lluvia_de_prueba.wav, viento_que_falta.wav]\nefectos:\n  - categoria: Combate\n    archivos: [golpe_de_prueba.wav, espada.wav]\n", encoding="utf-8")
for sub, nombre in (("ambiente", "lluvia_de_prueba.wav"), ("efectos", "golpe_de_prueba.wav")):
    with wave.open(str(assets / "sonido" / sub / nombre), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 330 * i / 8000))) for i in range(4000)))
import re
cfg = destino / "config.yaml"
t = cfg.read_text(encoding="utf-8")
if re.search(r"^permisos:\s*$", t, re.M):
    cfg.write_text(re.sub(r"^permisos:\s*$", "permisos:\n  habilidades_propias: true", t, count=1, flags=re.M), encoding="utf-8")
else:
    anadir(cfg, "permisos:\n  habilidades_propias: true")
anadir(destino / "enemies" / "goblin.yaml", "imagen: tokens/goblin.png")
# Etiquetas: el orco es «Bestia» (se comprueba en la ficha) y el ataque básico es «Contundente».
t = cfg.read_text(encoding="utf-8")
cfg.write_text(re.sub(r"^juego:\s*$", "juego:\n  niveles: {activo: true, modo: experiencia, experiencia: [Experiencia], umbrales: [100, 300], por_nivel: {puntos: 1, recursos: {HP: 5}}}\n  movimiento: {limitado: true, casillas: 30}\n  campos_ficha: [{nombre: Alineamiento, tipo: lista, opciones: [Bueno, Malo]}, {nombre: Dios, tipo: texto, privado: true}]\n  efectos: [{cuando: al_derrotar, si: [{tipo: bando, bando: jugador}], hacer: {tipo: modificar_estadistica, estadistica: Experiencia, formula: '10'}}]\n  etiquetas: [{nombre: Bestia, color: '#c4533f'}, {nombre: Contundente}]\n  ventajas: [{atacante: Contundente, defensor: Bestia, multiplicador: 1.5}]", t, count=1, flags=re.M), encoding="utf-8")
anadir(destino / "options" / "orco.yaml", "etiquetas: [Bestia]")
t = cfg.read_text(encoding="utf-8")
cfg.write_text(re.sub(r"^  estadisticas:\s*$", "  estadisticas:\n    - { nombre: Experiencia, valor_inicial: 0, minimo: 0, maximo: 9999, repartible: false }", t, count=1, flags=re.M), encoding="utf-8")
anadir(destino / "abilities" / "ataque_basico.yaml", "etiquetas: [Contundente]")
anadir(destino / "maps" / "aldea.yaml", "fondo: maps/aldea.png\nfondo_ajuste: {x: 0, y: 0, ancho: 20, alto: 12}")
# Grupo que solo aparece si la clase es Mago.
(destino / "groups" / "escuela.yaml").write_text("nombre: Escuela de magia\nobligatorio: true\nsolo_si: {grupo: clase, opciones: [mago]}\n", encoding="utf-8")
(destino / "options" / "piromancia.yaml").write_text("grupo: escuela\nnombre: Piromancia\n", encoding="utf-8")
# Formas (licántropo): solo para elfos, para no cambiar la creación de Ana (orca). Un NPC «Lobisome» las usa.
(destino / "groups" / "forma.yaml").write_text("nombre: Forma\nobligatorio: false\ntransformacion: formas\nsolo_si: {grupo: raza, opciones: [elfo]}\n", encoding="utf-8")
(destino / "options" / "forma_humana.yaml").write_text("grupo: forma\nnombre: Humana\n", encoding="utf-8")
(destino / "options" / "forma_lobo.yaml").write_text("grupo: forma\nnombre: Lobo\nbonos: {Fuerza: 3}\nimagen_forma: tokens/goblin.png\n", encoding="utf-8")
(destino / "enemies" / "lobisome.yaml").write_text("nombre: Lobisome\nbando: enemigo\nstats: {Fuerza: 10}\nrecursos: {HP: 30}\nelecciones: {raza: elfo, forma: forma_humana}\n", encoding="utf-8")
print("config de prueba lista en", destino)
anadir(destino / "tiles" / "brasas.yaml", "invisible: true")        # un tile invisible: actúa, pero los jugadores no lo ven
