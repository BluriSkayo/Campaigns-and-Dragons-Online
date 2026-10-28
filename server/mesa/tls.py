"""
tls.py — Conexión cifrada (TLS) del servidor.

Por defecto el servidor crea UN certificado propio (autofirmado) la primera vez y lo guarda en
data/<campaña>/tls/. Los clientes comprueban su «huella» (identificador) la primera vez que se conectan
y la recuerdan: si algún día cambia, avisan. Quien aloje el servidor detrás de un servicio con certificado
oficial puede poner «cifrado: false» (el proxy cifra por fuera) o indicar su propio «certificado» y «clave».
"""

import datetime
import hashlib
import ipaddress
import os
import ssl
from pathlib import Path


def huella_de(cert_pem_o_der: bytes) -> str:
    """Huella SHA-256 en hexadecimal, con pares separados por «:»."""
    if cert_pem_o_der.lstrip().startswith(b"-----BEGIN"):
        der = ssl.PEM_cert_to_DER_cert(cert_pem_o_der.decode("ascii"))
    else:
        der = cert_pem_o_der
    h = hashlib.sha256(der).hexdigest().upper()
    return ":".join(h[i:i + 2] for i in range(0, len(h), 2))


def nombre_certificado(nombre: str) -> str:
    """El nombre del certificado admite como mucho 64 caracteres (y los emojis cuentan doble): se usa una versión
    simple del nombre de la campaña, sin tildes ni símbolos raros, que siempre cabe."""
    import unicodedata
    t = unicodedata.normalize("NFKD", str(nombre or "")).encode("ascii", "ignore").decode()
    t = " ".join("".join(c if c.isalnum() or c in " -_.'" else " " for c in t).split())[:60].strip()
    return t or "Mesa de Rol"


def _generar(cert: Path, clave: Path, nombre: str):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    k = ec.generate_private_key(ec.SECP256R1())
    sujeto = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, nombre_certificado(nombre))])
    ahora = datetime.datetime.now(datetime.timezone.utc)
    c = (x509.CertificateBuilder().subject_name(sujeto).issuer_name(sujeto).public_key(k.public_key())
         .serial_number(x509.random_serial_number())
         .not_valid_before(ahora - datetime.timedelta(days=1))
         .not_valid_after(ahora + datetime.timedelta(days=3650))
         .add_extension(x509.SubjectAlternativeName([
             x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
         .sign(k, hashes.SHA256()))
    cert.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(clave, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()))
    cert.write_bytes(c.public_bytes(serialization.Encoding.PEM))


def preparar(datos_dir, servidor_cfg: dict, base_cfg: Path | None = None):
    """Devuelve (contexto_ssl, huella) o None si el cifrado está desactivado."""
    if not servidor_cfg.get("cifrado", True):
        return None
    if servidor_cfg.get("certificado") or servidor_cfg.get("clave"):
        cert = Path(servidor_cfg.get("certificado", ""))
        clave = Path(servidor_cfg.get("clave", ""))
        if base_cfg is not None:
            cert = cert if cert.is_absolute() else base_cfg / cert
            clave = clave if clave.is_absolute() else base_cfg / clave
        if not cert.is_file() or not clave.is_file():
            raise FileNotFoundError("No se encuentran el «certificado» o la «clave» indicados en config.yaml")
    else:
        carpeta = Path(datos_dir) / "tls"
        cert, clave = carpeta / "cert.pem", carpeta / "key.pem"
        if not (cert.is_file() and clave.is_file()):
            _generar(cert, clave, servidor_cfg.get("nombre", ""))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(cert, clave)
    return ctx, huella_de(cert.read_bytes())
