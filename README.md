# Mesa de Rol

Mesa virtual de rol con mapa de casillas, combate por turnos, chat, dados y música. Son **programas independientes**, que se descargan por separado:

| Paquete | Para quién | Contenido |
|---|---|---|
| **Cliente** (`client/`) | Todos: jugadores y GM | App Electron. No lleva configuraciones ni campañas. |
| **Servidor** (`server/`) | Quien aloja la partida o arma campañas | Python. Lleva `campanas/` (todos los `.yaml`), `data/` y la documentación. |
| **Editor del Servidor** (`server/editor/`) | Quien arma campañas | App Electron que viene **dentro de la carpeta del servidor** (van en conjunto). Edita `server/campanas/` sin tocar archivos a mano. Se abre con `server/iniciar_editor.bat`. |

**Ejecutables para Windows** (sin instalar Node ni Python): `client/crear_ejecutable.bat` y `server/editor/crear_ejecutable.bat` fabrican un `.exe` portable de cada uno en `release/`.

Cada carpeta tiene su propio `README.md`. La documentación técnica está en `server/docs/`.
