"""
main.py — Arranque del servidor de Campaigns and Dragons Online.

Uso:
    python main.py                       elige una campaña de campanas/ (pregunta si hay varias)
    python main.py --campana ejemplo     usa campanas/ejemplo (partida guardada en data/ejemplo)
    python main.py --config RUTA --datos RUTA   rutas explícitas
    python main.py --host 0.0.0.0 --puerto 8765   (hosting: también MESA_HOST, MESA_PUERTO, MESA_CAMPANA, MESA_DATOS,
                                                   MESA_PASSWORD_GM y MESA_PASSWORD_SERVIDOR; ver README)
    python main.py --validar             solo valida la campaña y sale
    python main.py --generar-hash        convierte una contraseña en un hash para pegarlo en config.yaml
"""

import argparse
import asyncio
import logging
import os
import ssl
import sys
from pathlib import Path

from mesa import recursos, tls
from mesa.estado import EstadoPartida
from mesa.servidor import ejecutar

RAIZ = Path(__file__).resolve().parent        # la carpeta del servidor: aquí viven campanas/ y data/
CAMPANAS = RAIZ / "campanas"


def listar_campanas(carpeta: Path = CAMPANAS) -> list[str]:
    """Una campaña es cualquier subcarpeta de `campanas/` (normalmente con un config.yaml dentro)."""
    if not carpeta.is_dir():
        return []
    return sorted(p.name for p in carpeta.iterdir() if p.is_dir() and not p.name.startswith((".", "_")))


def elegir_campana(nombre: str | None, carpeta: Path = CAMPANAS) -> str:
    """Devuelve el nombre de la campaña a usar; pregunta al usuario si hay varias y no se indicó una."""
    disponibles = listar_campanas(carpeta)
    if nombre:
        if nombre not in disponibles:
            lista = ", ".join(disponibles) or "(ninguna)"
            print(f"No existe la campaña «{nombre}». Campañas disponibles: {lista}")
            sys.exit(1)
        return nombre
    if not disponibles:
        print(f"No hay campañas en {carpeta}. Crea una carpeta allí (o copia «ejemplo»).")
        sys.exit(1)
    if len(disponibles) == 1:
        return disponibles[0]
    print("Campañas disponibles:")
    for i, n in enumerate(disponibles, 1):
        print(f"  {i}. {n}")
    while True:
        r = input("Escribe el número de la campaña que quieres abrir: ").strip()
        if r.isdigit() and 1 <= int(r) <= len(disponibles):
            return disponibles[int(r) - 1]
        print("  Número no válido.")


def marcar_servidor_abierto(datos: Path):
    """Deja un archivo con el número de proceso mientras el servidor está abierto: el Editor lo mira para no tocar
    fichas ni cuentas mientras la partida las tiene en memoria."""
    import atexit
    import os
    marca = datos / "servidor.pid"
    try:
        datos.mkdir(parents=True, exist_ok=True)
        marca.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        return

    def quitar():
        try:
            if marca.read_text(encoding="utf-8").strip() == str(os.getpid()):
                marca.unlink()
        except OSError:
            pass
    atexit.register(quitar)


def main():
    ap = argparse.ArgumentParser(description="Servidor de Campaigns and Dragons Online")
    ap.add_argument("--campana", default=os.environ.get("MESA_CAMPANA"), help="nombre de una carpeta dentro de campanas/ (o variable MESA_CAMPANA)")
    ap.add_argument("--config", help="ruta explícita de la carpeta de la campaña (en vez de --campana)")
    ap.add_argument("--datos", default=os.environ.get("MESA_DATOS"), help="dónde se guarda la partida (por defecto data/<campaña>; o variable MESA_DATOS)")
    ap.add_argument("--host", default=os.environ.get("MESA_HOST"), help="dirección donde escuchar (sustituye a config.yaml; o variable MESA_HOST). En un hosting suele ser 0.0.0.0")
    ap.add_argument("--puerto", type=int, default=int(os.environ["MESA_PUERTO"]) if os.environ.get("MESA_PUERTO", "").isdigit() else None,
                    help="puerto (sustituye a config.yaml; o variable MESA_PUERTO)")
    ap.add_argument("--validar", action="store_true", help="solo validar la configuración")
    ap.add_argument("--json", action="store_true", help="con --validar: escribe el resultado como JSON (lo usa el Editor)")
    ap.add_argument("--esquema", action="store_true", help="escribe como JSON el catálogo de efectos (lo usa el Editor)")
    ap.add_argument("--simular", metavar="PETICION.json", help="prueba una habilidad con las reglas del servidor y escribe el resultado como JSON (lo usa el Editor)")
    ap.add_argument("--generar-hash", action="store_true", help="genera el hash de una contraseña (para password_gm / password_servidor)")
    args = ap.parse_args()

    if args.esquema:
        import json
        from mesa import efectos
        print(json.dumps(efectos.esquema_publico(), ensure_ascii=False))
        return

    if args.simular:
        import json
        from mesa import simulador
        ruta_json = Path(args.config) if args.config else CAMPANAS / (args.campana or "")
        try:
            peticion = json.loads(Path(args.simular).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            peticion = None
        print(json.dumps(simulador.simular(ruta_json, peticion), ensure_ascii=False))
        return

    if args.generar_hash:
        import getpass
        from mesa.cuentas import hashear
        p1 = getpass.getpass("Escribe la contraseña (no se verá al teclear): ")
        if p1 != getpass.getpass("Repítela: "):
            print("No coinciden.")
            sys.exit(1)
        print("\nPega esto en config.yaml (entre comillas):\n")
        print(hashear(p1))
        return

    if args.json and args.validar:
        import json
        ruta_json = Path(args.config) if args.config else CAMPANAS / (args.campana or "")
        _, inf = recursos.cargar(ruta_json)
        print(json.dumps({"ok": inf.ok, "errores": inf.errores, "avisos": inf.avisos}, ensure_ascii=False))
        return

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if args.config:
        ruta_campana = Path(args.config)
        nombre_campana = ruta_campana.name
    else:
        nombre_campana = elegir_campana(args.campana)
        ruta_campana = CAMPANAS / nombre_campana
    datos = args.datos or str(RAIZ / "data" / nombre_campana)
    print(f"Campaña: {nombre_campana}")
    catalogo, informe = recursos.cargar(ruta_campana)

    for a in informe.avisos:
        print(f"  AVISO  {a}")
    for e in informe.errores:
        print(f"  ERROR  {e}")
    if not informe.ok:
        print(f"\nLa configuración tiene {len(informe.errores)} error(es). Corrígelos para iniciar el servidor.")
        sys.exit(1)
    print(f"Configuración correcta: {len(catalogo.mapas)} mapas, {len(catalogo.habilidades)} habilidades, "
          f"{len(catalogo.objetos)} objetos, {len(catalogo.personajes)} personajes base, "
          f"{len(catalogo.enemigos)} NPC, {len(catalogo.tiendas)} tiendas.")
    if args.validar:
        return

    from mesa.cuentas import es_hash
    s_cfg = catalogo.config["servidor"]
    # Para hostings y contenedores: lo que llegue por argumentos o variables de entorno manda sobre config.yaml.
    if args.host:
        s_cfg["host"] = args.host
    if args.puerto:
        if not 1 <= args.puerto <= 65535:
            print("  ERROR  El puerto debe estar entre 1 y 65535.")
            sys.exit(1)
        s_cfg["puerto"] = args.puerto
    for campo, var in (("password_gm", "MESA_PASSWORD_GM"), ("password_servidor", "MESA_PASSWORD_SERVIDOR")):
        if os.environ.get(var):
            s_cfg[campo] = os.environ[var]
    if not s_cfg["password_gm"]:
        print("  AVISO  password_gm está vacía: nadie podrá entrar como GM.")
    for campo in ("password_gm", "password_servidor"):
        if s_cfg[campo] and not es_hash(s_cfg[campo]):
            print(f"  AVISO  {campo} está en texto plano en config.yaml. Mejor guárdala como hash: python main.py --generar-hash")

    estado = EstadoPartida(catalogo, datos)
    marcar_servidor_abierto(Path(datos))
    estado.cargar_estado()
    try:
        cifrado = tls.preparar(datos, s_cfg, ruta_campana)
    except (FileNotFoundError, OSError, ssl.SSLError) as e:
        print(f"  ERROR  No se pudo preparar el cifrado: {e}")
        sys.exit(1)
    ssl_ctx = cifrado[0] if cifrado else None
    if cifrado:
        print(f"Conexión cifrada activada. Huella del servidor (los jugadores pueden compararla al conectarse):\n  {cifrado[1]}")
    else:
        print("  AVISO  Conexión SIN cifrar (cifrado: false). Las contraseñas viajarían en claro: úsalo solo en red local o tras un proxy que cifre.")
    try:
        asyncio.run(ejecutar(catalogo, estado, ssl_ctx))
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
