"""Cuentas con contraseña: hashes, registro, bloqueo por intentos y cambio de contraseña."""
import yaml

from mesa import cuentas
from tests.test_servidor import mundo  # noqa: F401  (fixture)


# ── Unitarias ───────────────────────────────────────────────────
def test_el_hash_no_contiene_la_contrasena_y_se_verifica():
    h = cuentas.hashear("mi clave 123")
    assert "mi clave" not in h and h.startswith("scrypt$")
    assert cuentas.verificar(h, "mi clave 123") and not cuentas.verificar(h, "mi clave 124")
    assert cuentas.hashear("mi clave 123") != h                      # cada hash lleva su propia sal


def test_verificar_acepta_texto_plano_solo_para_config_antigua():
    assert cuentas.verificar("plano", "plano") and not cuentas.verificar("plano", "otra")
    assert not cuentas.verificar("scrypt$1$2$3$zz$zz", "x")           # hash corrupto: falla sin romper
    assert not cuentas.verificar(cuentas.hashear("a" * 8), None)


def test_validar_password_nueva():
    assert cuentas.validar_password_nueva("corta") and cuentas.validar_password_nueva("x" * 200)
    assert cuentas.validar_password_nueva("suficiente") is None
    assert cuentas.validar_password_nueva(123)


def test_limitador_bloquea_y_se_libera_con_el_tiempo():
    t = [0.0]
    lim = cuentas.Limitador(3, 60, reloj=lambda: t[0])
    for _ in range(2):
        lim.fallo("a")
    assert lim.espera("a") == 0
    lim.fallo("a")
    assert 59 <= lim.espera("a") <= 60
    assert lim.espera("b") == 0                                       # otra clave no se ve afectada
    t[0] = 61
    assert lim.espera("a") == 0
    lim.fallo("a")                                                    # tras el bloqueo se empieza de cero
    assert lim.espera("a") == 0
    lim.exito("a")


def test_cuentas_se_guardan_con_permisos_y_sin_texto_plano(tmp_path):
    c = cuentas.Cuentas(tmp_path / "cuentas.yaml")
    c.crear("Ana", "secreto-largo")
    c.crear("Beto", None)
    texto = (tmp_path / "cuentas.yaml").read_text(encoding="utf-8")
    assert "secreto-largo" not in texto
    otro = cuentas.Cuentas(tmp_path / "cuentas.yaml")
    assert otro.canonico("ana") == "Ana" and otro.comprobar("Ana", "secreto-largo")
    assert not otro.tiene_password("Beto") and not otro.comprobar("Beto", "")


# ── Con WebSocket real ──────────────────────────────────────────
async def test_registro_con_contrasena_y_entrada_posterior(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    a = await nuevo()
    b = await a.entrar("Ana", password="clave-de-ana")
    assert b["tipo"] == "bienvenida" and b["cuenta"]["tiene_password"] is True
    assert "clave-de-ana" not in (estado.datos_dir / "cuentas.yaml").read_text(encoding="utf-8")
    await a.ws.close()

    c = await nuevo()                                                  # sin contraseña
    await c.enviar(tipo="entrar", usuario="ana")
    e = await c.recibir("error")
    assert e["codigo"] == "password_requerida"

    d = await nuevo()                                                  # contraseña mala
    await d.enviar(tipo="entrar", usuario="Ana", password="mala-clave")
    assert (await d.recibir("error"))["codigo"] == "password_incorrecta"

    f = await nuevo()                                                  # buena, con otras mayúsculas: entra como «Ana»
    b = await f.entrar("ANA", password="clave-de-ana")
    assert b["usuario"] == "Ana"


async def test_bloqueo_tras_demasiados_intentos(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    srv.limitador.maximo = 3
    a = await nuevo()
    await a.entrar("Ana", password="clave-de-ana")
    await a.ws.close()
    for _ in range(3):
        x = await nuevo()
        await x.enviar(tipo="entrar", usuario="Ana", password="nope-nope")
        assert (await x.recibir("error"))["codigo"] == "password_incorrecta"
    y = await nuevo()
    await y.enviar(tipo="entrar", usuario="Ana", password="clave-de-ana")     # aunque ahora fuese correcta
    e = await y.recibir("error")
    assert e["codigo"] == "bloqueado" and "Espera" in e["texto"]


async def test_contrasena_nueva_corta_o_exigida(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    a = await nuevo()
    await a.enviar(tipo="entrar", usuario="Luis", password="abc")
    assert (await a.recibir("error"))["codigo"] == "password_nueva_requerida"
    srv.cfg["seguridad"]["contrasena_obligatoria"] = True
    await a.enviar(tipo="entrar", usuario="Luis")
    assert "exige contraseña" in (await a.recibir("error"))["texto"]
    await a.entrar("Luis", password="una-clave-larga")


async def test_registro_cerrado_no_deja_entrar_a_desconocidos(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    srv.cfg["seguridad"]["registro_abierto"] = False
    a = await nuevo()
    await a.enviar(tipo="entrar", usuario="Intruso")
    assert (await a.recibir("error"))["codigo"] == "usuario_no_registrado"
    srv.cuentas.crear("Invitada", None)                                # el propietario la creó antes
    b = await nuevo()
    assert (await b.entrar("invitada"))["usuario"] == "Invitada"


async def test_cuenta_sin_contrasena_puede_ponerla_al_entrar_o_despues(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    a = await nuevo()
    b = await a.entrar("Pepe")
    assert b["cuenta"]["tiene_password"] is False
    await a.enviar(tipo="cambiar_contrasena", nueva="corta")
    assert "al menos 6" in (await a.recibir("error"))["texto"]
    await a.enviar(tipo="cambiar_contrasena", nueva="una-clave-buena")
    assert (await a.recibir("cuenta"))["tiene_password"] is True
    await a.enviar(tipo="cambiar_contrasena", actual="equivocada", nueva="otra-clave-buena")
    assert (await a.recibir("error"))["codigo"] == "password_incorrecta"
    await a.enviar(tipo="cambiar_contrasena", actual="una-clave-buena", nueva="otra-clave-buena")
    assert (await a.recibir("cuenta"))["tiene_password"] is True
    await a.ws.close()
    c = await nuevo()
    await c.enviar(tipo="entrar", usuario="Pepe", password="una-clave-buena")
    assert (await c.recibir("error"))["codigo"] == "password_incorrecta"
    await (await nuevo()).entrar("Pepe", password="otra-clave-buena")


async def test_la_contrasena_de_gm_puede_estar_guardada_como_hash(mundo):  # noqa: F811
    nuevo, estado, srv = mundo
    srv.cfg["servidor"]["password_gm"] = cuentas.hashear("gm-super-secreta")
    a = await nuevo()
    await a.enviar(tipo="entrar", usuario="Jefe", password_gm="otra")
    assert "GM incorrecta" in (await a.recibir("error"))["texto"]
    b = await nuevo()
    assert (await b.entrar("Jefe", password_gm="gm-super-secreta"))["es_gm"] is True
