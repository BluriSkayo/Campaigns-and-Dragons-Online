# Mesa de Rol — Cliente

Programa para **jugadores y GM**. No contiene reglas ni campañas: muestra lo que envía el servidor y guarda en su carpeta `base/`
las imágenes y la música que el dueño del servidor le entrega con el cliente. Para crear o editar campañas hace falta el paquete del **servidor**.

## Ejecutar el cliente

Requiere [Node.js](https://nodejs.org) (versión LTS). Con el servidor ya en marcha:

```bash
cd client
npm install        # solo la primera vez (descarga Electron)
npm start
```

En Windows basta con abrir `client/iniciar_cliente.bat`. Para conectarte desde el mismo equipo usa la dirección `localhost:8765`;
desde otro equipo de la red, la IP del que ejecuta el servidor (por ejemplo `192.168.1.20:8765`).
Para entrar como GM marca «Entrar como Game Master» y escribe la contraseña de GM que te dé quien administra el servidor.

## Ejecutable para Windows (para los jugadores)

`client/crear_ejecutable.bat` fabrica **un solo `.exe` portable** en `release/` (por ejemplo `Campaigns-and-Dragons-Online-0.1.0.exe`): se abre con doble clic, sin instalar nada y sin Node. Solo quien lo fabrica necesita Node.js (la primera vez descarga las herramientas). Equivale a `npm install` y `npm run portable`.

- La carpeta `base/` (imágenes y sonidos importados) se crea **junto al `.exe`**; si ahí no se puede escribir, en `%APPDATA%\Mesa de Rol`. Los ajustes (servidores guardados, huellas, contraseñas recordadas) van siempre en `%APPDATA%\Mesa de Rol`.
- Cada vez que se abre, el `.exe` se descomprime en una carpeta temporal: tarda unos segundos en aparecer.
- No está firmado: la primera vez Windows puede mostrar «Windows protegió tu PC» → «Más información» → «Ejecutar de todas formas».
- La versión del archivo sale de `version` en `client/package.json`: súbela en cada build que repartas.


## Uso básico

- **Clic derecho (cursor):** sobre una casilla: analizarla y «📍 Desplegar token…» (una ventana con los personajes que puedes poner ahí; el GM ve también los NPC, por categoría y con buscador); sobre un token: ver ficha, analizarlo y «✨ Transformar…» si tiene formas (una ventana para elegir la forma). El GM además (con «✏️ Editar…» como primera opción) mueve el token seleccionado, edita (vida, estadísticas, nombre, objetos; «Cerrar» y «Guardar cambios» están al final de la ventana), **gestiona sus habilidades** («✨ Gestionar habilidades…»: dar o quitar cualquiera de la campaña, con buscador; en un personaje queda en su ficha, en un NPC solo en ese token) y quita tokens.
- **Mapa:** rueda del ratón o los botones +/− para el zoom. Herramientas: Cursor (seleccionar y arrastrar tokens), Mano (mover el mapa; también con la barra espaciadora o el botón central) y Regla (mide en casillas; arrastra para medir y **clic derecho** para añadir un cambio de dirección; muestra la distancia acumulada y la línea desaparece al soltar). El GM ve los puntos importantes del mapa (se pueden ocultar en Ajustes).
- **Panel izquierdo:** Personaje, Inventario, Tiradas, Ajustes (y Panel del GM). Cada opción se **despliega dentro del panel** y, con el botón de su cabecera, se **saca a una ventana independiente**. «Personaje» lista tus personajes: pulsa uno para ver sus habilidades; clic derecho para abrir su ficha en una ventana. «Desconectar» está abajo del todo.
- **Entrar a la mesa:** al elegir o crear un personaje no aparece solo en el mapa: tú (o el GM) lo despliegas cuando quieras, desde «Personaje».
- **Crear personaje:** eliges raza y clase (según la campaña) y repartes los puntos de estadística. La imagen del token se elige con «🖼️ Elegir una que ya tengo…» (una galería con las imágenes de la campaña, por carpetas y con buscador) o «Traer una imagen…» de tu equipo. Ya en la partida, «➕ Crear ficha nueva» (en «Personaje») abre el creador en una ventana mientras la mesa te deje tener más personajes.
- **Exportar personaje:** en la ficha de tu personaje (o clic derecho en «Personaje») → «📤 Exportar personaje»: guarda la ficha y sus imágenes en un archivo `.mesa-personaje` que el GM puede importar en el Editor.
- **Usar una habilidad:** Personaje → pulsa tu personaje → «Usar» → clic en el objetivo (se marca el alcance). `Esc` cancela.
- **Objetos:** en el inventario, «Usar» deja elegir con quién (tú o alguien que esté cerca: una poción para un aliado) y «Dar» se lo pasa a un token cercano tras confirmar. La distancia y si se puede dar lo decide la campaña; en combate, solo en tu turno.
- **Chat:** `/2d6+3` tira dados. Junto a la caja de texto eliges **cómo hablas**: como tu usuario (🙂, fuera de personaje: lo lee toda la mesa) o como uno de tus tokens de la sala (🎭: sale con su nombre y su retrato, y solo lo leen quienes están en esa sala). El GM puede hablar como cualquier NPC. El GM puede vaciar el chat de la sala de chat que ve, para todos, con 🧹 (pide confirmación). **Música:** doble clic en una canción (si el servidor te lo permite).
- **Salas:** cada mapa es una sala con sus propios tokens, combate y niebla, y varias pueden estar en uso a la vez. El botón de salas (arriba a la izquierda) las muestra. El **GM** pulsa una sala para verla sin mover a nadie, «⤵ Todos» para llevar ahí a todos los jugadores (los NPC se quedan en su sala) y 🔓/🔒 para dejar o no que los jugadores entren solos; para llevar a un token, clic derecho → «🚪 Llevar a otra sala…» (su jugador va con él). Si la mesa lo permite, un **jugador** pulsa una sala abierta para ir con su personaje (fuera de combate); si no, lo lleva el GM. Lo que pasa en una sala solo aparece en el chat de quienes están en ella; el GM lo ve todo, marcado con el nombre de la sala.
- **Barras y nombres sobre los tokens:** la campaña decide qué barras se ven (vida, magia…) y si se ven las barras y el nombre de los tokens de los demás. En Ajustes apagas las barras que no quieras ver. El GM puede cambiarlo en un token concreto (clic derecho → Editar… → «Los demás ven sus barras / su nombre»).
- **Turnos:** en un combate, el GM saca a un token de los turnos o lo mete (clic derecho en el token → «➖ Sacar de los turnos» / «➕ Añadir a los turnos», o ✕ en la ventana de decidir turnos); quien entra con el combate empezado va a su sitio según la iniciativa.
- **GM:** «Panel del GM» para iniciar/terminar combate y colocar NPC (agrupados por la categoría que les pongas en el Editor, cada una plegable). En la lista de personajes ve en qué sala está cada uno.
- **Personaje al entrar:** solo se pregunta la primera vez en cada servidor; después entras directamente con el último personaje usado.
- **Recuérdame:** al conectar, marca «Recuérdame» y la próxima vez tu contraseña y la del servidor aparecerán ya escritas: solo tienes que pulsar «Conectar». Se guardan cifradas por el sistema (solo se pueden leer en tu usuario de este equipo) y la de GM nunca se guarda. Para quitarlas: ✏️ en la lista de servidores → «🔑 Olvidar contraseñas», o desmarca la casilla al conectar.
- **Archivos del cliente:** imágenes y música están en la carpeta `base/` (dentro de `client`; con el ejecutable, junto al `.exe`): `base/tokens`, `base/maps`, `base/icons`, `base/tiles`, `base/sonido/musica`, `base/sonido/ambiente`, `base/sonido/efectos` (y `base/otros`). **El servidor no las envía**: el GM exporta desde el Editor un **.zip con los archivos de su campaña** y te lo pasa; tú lo instalas en Ajustes → «📦 Importar archivos de campaña (.zip)» (o desde la pantalla de conexión). Cada campaña queda en su propia carpeta (`base/campanas/<campaña>/…`) y el cliente busca ahí primero y, si no está, en `base/`. También vale un .zip hecho a mano con las carpetas `tokens/`, `maps/`, `icons/`, `tiles/`, `sonido/…` u `otros/` (si no lo hizo el Editor, conéctate primero al servidor para que se sepa de qué campaña es). La lista de música la decide el servidor; cada tema se ve en verde si tienes el archivo y en rojo si no. Solo el GM ve las listas de ambiente y efectos, pero los oyen todos. La casilla «Repetir» decide si la música (y el ambiente) vuelven a empezar. Las barras laterales se ensanchan arrastrando su borde (doble clic: tamaño original).
- **Sonidos:** turno, dados, golpe, curación, movimiento y error (volumen propio en el panel de música).
- **Atajos:** `F11` pantalla completa, `Ctrl+Mayús+I` herramientas de desarrollo.


## Pruebas (solo desarrollo)

```bash
node --test tools/test-archivos.js      # almacén de archivos
bash tools/correr-e2e.sh                # extremo a extremo; necesita el repositorio completo (usa ../server) y xvfb en Linux
```
