"""
permisos.py — Qué puede hacer cada usuario.

El servidor envía este diccionario al cliente al entrar; el cliente solo habilita
los botones correspondientes. El servidor vuelve a comprobar cada acción por su cuenta.
"""


def permisos_de(config: dict, es_gm: bool) -> dict:
    p = config["permisos"]
    return {
        "gm": es_gm,
        "chat": True,
        "tirar_dados": True,
        "mover_tokens_propios": True,
        "mover_tokens_ajenos": es_gm or p["mover_tokens_ajenos"],
        # Con «entrar sin ficha», el GM asigna NPC y personajes a los usuarios: dar NPC va incluido.
        "npc_para_jugadores": p["npc_para_jugadores"] or p["sin_ficha"],
        "sin_ficha": p["sin_ficha"],
        "usar_habilidades": True,
        "usar_objetos": True,
        "crear_personajes": es_gm or p["crear_personajes"],
        "repartir_puntos": es_gm or p["editar_stats_jugador"],
        "controlar_musica": es_gm or p["musica"] == "todos",
        "romper_casillas": es_gm or p["romper_casillas"] == "todos",
        "cambiar_sala": es_gm or p["cambiar_sala"] == "todos",          # irse solo a otra sala (mapa) abierta
        "dados_personalizados": es_gm or p["dados_personalizados"],
        "editar_personalidad": es_gm or p["rasgos_personalidad"],
        "habilidades_propias": es_gm or p["habilidades_propias"],
        "objetos_propios": es_gm or p["objetos_propios"],
        # Solo GM:
        "colocar_enemigos": es_gm,
        "quitar_tokens": es_gm,
        "controlar_combate": es_gm,
        "cambiar_mapa": es_gm,
    }
