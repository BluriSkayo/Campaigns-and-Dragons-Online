# Mesa de Rol — Servidor

Programa para **quien dirige la partida o arma campañas**. Los jugadores no lo necesitan: ellos solo descargan el **cliente**.
Contiene todo el contenido de juego (`campanas/`, con sus `config.yaml` y demás archivos `.yaml`) y la partida guardada (`data/`).

## Estructura

```
server/
├── main.py  iniciar_editor.bat  requirements.txt
├── mesa/              fórmulas · recursos · efectos · motor · estado · cuentas · tls · servidor
├── campanas/<nombre>/ Una campaña = un conjunto de reglas y contenido (se puede copiar y compartir)
│   ├── config.yaml
│   ├── abilities/  items/  characters/  enemies/  maps/  shops/
│   ├── groups/  options/  traits/  states/     (razas, clases, rasgos y estados)
│   └── tiles/         tipos de casilla (muro, agua, hierba alta…)
├── data/<nombre>/     Partida guardada, cuentas y certificado (se genera solo)
├── docs/              ESQUEMA · PROTOCOLO · ARQUITECTURA · DECISIONES
└── tests/
```

## Ejecutar el servidor

Requiere Python 3.10 o superior.

```bash
cd server
pip install -r requirements.txt
python main.py                 # arranca (si hay varias campañas, pregunta cuál)
python main.py --campana ejemplo
python main.py --validar       # solo comprueba campanas/<nombre>/ y muestra errores
python -m pytest               # tests
```

En Windows, abre `server/iniciar_editor.bat` y pulsa **«▶ Iniciar servidor»** en la barra superior del Editor: la primera vez instala solo lo necesario (Python 3.10+ ya instalado y conexión a internet). Los hostings y contenedores siguen usando `python main.py` directamente.

Antes de arrancar, el servidor valida toda la carpeta `campanas/<nombre>/` y **no inicia si hay errores**,
indicando archivo y campo. Por ejemplo:

```
ERROR  abilities/bola_de_fuego.yaml: formula → la fórmula cita «Carisma», que no existe
ERROR  maps/aldea.yaml → casillas[muro]: la posición (25, 3) queda fuera del mapa (20×12)
```

Puerto por defecto: **8765** (partida, WebSocket), el único que hay que abrir en el router. **El servidor no envía imágenes ni música:** cada campaña los guarda en su carpeta `campanas/<campaña>/base/`; el GM los exporta como .zip desde el Editor y cada jugador lo importa en su cliente.
**Cambia `password_gm` en `campanas/<nombre>/config.yaml`** antes de abrir el servidor a otras personas.


## Alojar la partida

**En tu propio equipo:** abre el puerto 8765 en el router (redirección de puertos hacia tu equipo) y pasa a tus jugadores tu IP pública.

**En un servicio de hosting de pago** (un VPS o un servicio de contenedores): no hace falta tocar routers.
1. Sube la carpeta `server/` (sin `editor/`) al servicio.
2. Con Docker: `docker compose up -d --build`. Edita antes `MESA_CAMPANA` en `docker-compose.yml`. Las partidas se guardan en `./data` (no lo borres).
3. Sin Docker: instala Python 3.11+, ejecuta `pip install -r requirements.txt` y luego `python3 main.py --campana mi_campana --host 0.0.0.0 --puerto 8765`.
4. Abre el puerto elegido en el cortafuegos del servicio.
5. Los jugadores se conectan a la IP o dominio del servicio. La primera vez comparan la **huella** que muestra el servidor al arrancar (cifrado activado por defecto).

Variables de entorno (sustituyen a `config.yaml`, útiles en contenedores): `MESA_CAMPANA`, `MESA_DATOS`, `MESA_HOST`, `MESA_PUERTO`, `MESA_PASSWORD_GM`, `MESA_PASSWORD_SERVIDOR`. Usa siempre **hashes** en las contraseñas (`python3 main.py --generar-hash`).
Si el servicio ofrece su propio certificado, indícalo en `servidor.certificado` y `servidor.clave` de `config.yaml`.

## Pruebas

```bash
python -m pytest
```

## Decisiones de diseño

- **El servidor es la autoridad.** Valida permisos, turnos, alcance, costes y calcula daños. El cliente solo pide acciones.
- **El contenido vive solo en `campanas/<nombre>/`.** Los jugadores no crean habilidades, objetos ni NPC.
- **Los personajes pertenecen al servidor** (`data/<nombre>/`). Se crean a partir de las plantillas de `campanas/<nombre>/characters/`.
- **Información oculta:** un jugador solo recibe las estadísticas completas de sus propios tokens; de los demás ve nombre, posición, vida y las barras que la campaña muestre. Tampoco recibe nada de las salas (mapas) donde no está.
- **Salas:** cada mapa es una sala con sus propios tokens, combate y niebla; varias pueden estar en uso a la vez (ver «Salas» en `docs/PROTOCOLO.md`).
- **Fórmulas sin `eval()`:** se analizan con `ast` y solo admiten aritmética básica y dados.
- **`mesa/recursos.py` es reutilizable:** el Editor del Servidor puede usar la misma validación antes de guardar.

## Limitaciones conocidas (a decidir más adelante)

- Un usuario sin contraseña puede ser «reclamado» por quien entre primero con ese nombre: pon contraseña desde Ajustes (o `contrasena_obligatoria: true`).
- La conexión va cifrada (`wss`) con un certificado propio: el cliente pide confirmar la huella la primera vez. Probado en Linux y en Windows.

## Editor de campañas
**Ejecutable para Windows:** `editor/crear_ejecutable.bat` fabrica un `.exe` portable del Editor que lleva dentro este servidor y su propio Python (quien lo usa no instala nada). Ver `editor/README.md`.
Dentro de `editor/` está el **Editor del Servidor**: una ventana para crear y modificar campañas sin tocar archivos `.yaml`. Se abre con `iniciar_editor.bat` (la primera vez descarga sus componentes; necesita Node.js y Python). Trabaja sobre `campanas/` y comprueba la campaña con las mismas reglas que el servidor. Lo que eliminas va a la **Papelera** (botón 🗑️ de la barra superior, o «⋯ → Papelera»): desde ahí puedes recuperarlo o eliminarlo para siempre (se guarda en `_papelera/` dentro de la campaña, o en `campanas/_papelera/` si es una campaña entera).
