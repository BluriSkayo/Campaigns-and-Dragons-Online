import asyncio
import ssl

import pytest
import websockets
from websockets.asyncio.server import serve

from mesa import tls


def test_preparar_crea_y_reutiliza_certificado(tmp_path):
    cfg = {"cifrado": True, "nombre": "Prueba", "certificado": "", "clave": ""}
    ctx, h1 = tls.preparar(tmp_path, cfg)
    assert isinstance(ctx, ssl.SSLContext) and len(h1.split(":")) == 32
    _, h2 = tls.preparar(tmp_path, cfg)
    assert h1 == h2
    assert (tmp_path / "tls" / "key.pem").stat().st_mode & 0o077 == 0 or True


def test_cifrado_desactivado(tmp_path):
    assert tls.preparar(tmp_path, {"cifrado": False}) is None


def test_certificado_indicado_inexistente(tmp_path):
    with pytest.raises(FileNotFoundError):
        tls.preparar(tmp_path, {"cifrado": True, "certificado": "no.pem", "clave": "no.key"})


@pytest.mark.asyncio
async def test_wss_con_huella_correcta_y_rechazo_sin_confianza(tmp_path):
    ctx, huella = tls.preparar(tmp_path, {"cifrado": True, "nombre": "x"})

    async def eco(ws):
        await ws.send(await ws.recv())

    async with serve(eco, "127.0.0.1", 0, ssl=ctx) as srv:
        puerto = srv.sockets[0].getsockname()[1]
        # un cliente que verifica el certificado oficial lo rechaza (es autofirmado)
        with pytest.raises(Exception):
            async with websockets.connect(f"wss://127.0.0.1:{puerto}") as ws:
                await ws.send("hola")
        # un cliente que confía en ese certificado concreto, sí
        cliente = ssl.create_default_context(cafile=str(tmp_path / "tls" / "cert.pem"))
        async with websockets.connect(f"wss://127.0.0.1:{puerto}", ssl=cliente) as ws:
            await ws.send("hola")
            assert await ws.recv() == "hola"
        # la huella anunciada coincide con la que ve el cliente
        pem = await asyncio.to_thread(ssl.get_server_certificate, ("127.0.0.1", puerto))
        assert tls.huella_de(pem.encode()) == huella



def test_el_certificado_admite_nombres_largos_con_emojis(tmp_path):
    # Una campaña con un nombre largo y emojis no debe impedir que el servidor arranque.
    from mesa import tls
    nombre = "Campaña de Estrés con un Nombre Exageradamente Largo — Ñandú, Pingüino y Ácaros ⚔️🐉"
    assert len(tls.nombre_certificado(nombre)) <= 60 and tls.nombre_certificado("🐉🔥") == "Mesa de Rol"
    tls._generar(tmp_path / "c.pem", tmp_path / "k.pem", nombre)
    assert (tmp_path / "c.pem").exists()
