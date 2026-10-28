"""Prepara una campaña «de estrés» (solo desarrollo): imágenes enormes y de formatos variados, nombres larguísimos
con tildes y emojis, 100 NPC, 30 estadísticas, un mapa de 200×200 y una tienda con 60 artículos.
Uso: python3 preparar.py <campaña_origen> <campaña_destino> <carpeta_base_cliente>"""
import random
import shutil
import sys
from pathlib import Path

import yaml
from PIL import Image, ImageDraw

origen, destino, base = (Path(a) for a in sys.argv[1:4])
shutil.rmtree(destino, ignore_errors=True)
shutil.copytree(origen, destino)
shutil.rmtree(base, ignore_errors=True)
for c in ("tokens", "maps", "icons", "tiles", "otros", "sonido/musica", "sonido/ambiente", "sonido/efectos"):
    (base / c).mkdir(parents=True, exist_ok=True)
rnd = random.Random(7)


def imagen(ruta, w, h, color, modo="RGB"):
    im = Image.new(modo, (w, h), color)
    d = ImageDraw.Draw(im)
    for i in range(0, max(w, h), max(1, max(w, h) // 12)):
        d.line([(i, 0), (0, i)], fill=(255, 255, 255), width=max(2, w // 200))
    d.ellipse([w // 4, h // 4, 3 * w // 4, 3 * h // 4], outline=(0, 0, 0), width=max(3, w // 100))
    im.save(ruta)


imagen(base / "tokens/gigante.jpg", 4000, 3000, (200, 80, 60))
imagen(base / "tokens/alto.png", 300, 3000, (60, 120, 200, 255), "RGBA")
imagen(base / "tokens/ancho.webp", 3000, 200, (40, 160, 90))
imagen(base / "tokens/animado.gif", 900, 900, (150, 60, 180))
imagen(base / "tokens/mini.png", 8, 8, (240, 240, 0))
imagen(base / "icons/icono_gigante.png", 2500, 2500, (90, 90, 200, 255), "RGBA")
imagen(base / "maps/mapa_enorme.jpg", 4000, 4000, (50, 90, 50))
imagens = ["tokens/gigante.jpg", "tokens/alto.png", "tokens/ancho.webp", "tokens/animado.gif", "tokens/mini.png"]
for t in ("guerrero", "goblin"):          # los nombres que usan la campaña de ejemplo y la prueba del cliente
    shutil.copy(base / "tokens/gigante.jpg", base / f"tokens/{t}.png")
shutil.copy(base / "maps/mapa_enorme.jpg", base / "maps/aldea.png")


def leer(p):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def escribir(p, d):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(d, allow_unicode=True, sort_keys=False), encoding="utf-8")


LARGO = "Señor de los Abismos Ancestrales y Guardián Eterno del Último Umbral 🐉🔥"
cfg = leer(destino / "config.yaml")
cfg["servidor"]["nombre"] = "Campaña de Estrés con un Nombre Exageradamente Largo — Ñandú, Pingüino y Ácaros ⚔️"
j = cfg["juego"]
extra = [f"Estadística número {i} con nombre largo ✨" if i % 3 == 0 else f"Atributo {i}" for i in range(25)]
j["estadisticas"] += [{"nombre": n, "valor_inicial": 5, "minimo": 0, "maximo": 999} for n in extra]
j["recursos"] += [{"nombre": "Energía espiritual acumulada 🌙", "maximo_inicial": 9999}]
j["puntos_a_repartir"] = 40
j["tablas"] = [{"nombre": "Tabla de críticos con nombre larguísimo", "defecto": 0,
                "filas": [{"desde": i * 5 + 1, "hasta": i * 5 + 5, "valor": i * 0.5} for i in range(20)]}]
escribir(destino / "config.yaml", cfg)

for i in range(100):
    escribir(destino / f"enemies/npc_{i:03d}.yaml", {
        "nombre": (LARGO if i % 10 == 0 else f"Criatura {i} de las Profundidades Olvidadas") + ("" if i % 4 else " 👹"),
        "descripcion": ("Una descripción muy larga que no termina nunca. " * 12).strip(),
        "bando": ["enemigo", "neutral", "aliado"][i % 3], "imagen": imagens[i % len(imagens)],
        "stats": {"Fuerza": rnd.randint(1, 99)}, "recursos": {"HP": rnd.randint(1, 99999), "MP": 10}, "habilidades": ["ataque_basico"],
        "inventario": [{"objeto": "pocion", "cantidad": 999}], "dinero": 123456789})

for i in range(60):
    escribir(destino / f"items/objeto_{i:02d}.yaml", {"nombre": f"Objeto legendario número {i} " + ("de la Perdición Infinita 💎" if i % 5 == 0 else ""),
                                                       "descripcion": "Brilla. " * 30, "tipo": "misc", "precio": rnd.randint(1, 10 ** 7),
                                                       "imagen": "icons/icono_gigante.png"})
tienda = leer(destino / "shops/tienda_aldea.yaml")
tienda["articulos"] = [{"objeto": f"objeto_{i:02d}", "stock": 999} for i in range(60)]
tienda["nombre"] = "Gran Emporio Universal de Cosas Extraordinariamente Raras 🏪"
escribir(destino / "shops/tienda_aldea.yaml", tienda)

hab = leer(destino / "abilities/bola_de_fuego.yaml")
hab["nombre"] = "Bola de fuego ancestral del dragón primigenio que todo lo consume 🔥"
hab["descripcion"] = "Quema. " * 40
hab["imagen"] = "icons/icono_gigante.png"
escribir(destino / "abilities/bola_de_fuego.yaml", hab)

escribir(destino / "maps/enorme.yaml", {"nombre": "Mapa enorme de doscientas por doscientas casillas", "ancho": 200, "alto": 200,
                                        "tamano_tile": 64, "fondo": "maps/mapa_enorme.jpg", "tile_base": "hierba",
                                        "casillas": {"muro": [[x, 0] for x in range(200)]}, "inicio": {"x": 100, "y": 100}})
for i in range(40):
    escribir(destino / f"journal/pagina_{i:02d}.yaml", {
        "nombre": (LARGO if i % 7 == 0 else f"Página {i} del diario"), "seccion": ["Mundo", "Armas", "Sección con un nombre muy largo 📚"][i % 3],
        "imagen": "maps/mapa_enorme.jpg" if i == 0 else "",
        "texto": "# Subtítulo enorme que no cabe en una línea\n\n" + ("Texto **largo** sin fin. " * 200) + "\n\n- " + "\n- ".join(f"Elemento {k}" for k in range(30))})
escribir(destino / "maps/aldea_objetos.yaml", {"nombre": "Aldea con objetos grandes", "ancho": 20, "alto": 14, "tile_base": "hierba",
                                               "objetos": [{"nombre": "Carro enorme", "x": 4, "y": 4, "ancho": 3.5, "alto": 2, "bloquea": True, "imagen": "maps/mapa_enorme.jpg"}],
                                               "inicio": {"x": 1, "y": 1}})
print("campaña de estrés lista")
