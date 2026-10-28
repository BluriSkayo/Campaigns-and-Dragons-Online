# Editor del Servidor

Ventana para armar campañas: reglas del juego, estadísticas, razas y clases, habilidades, objetos, NPC (aliados, neutrales o enemigos), rasgos, estados, tiendas y mapas.

**Abrir:** doble clic en `../iniciar_editor.bat`. Necesita Node.js (LTS) y Python.

**Como ejecutable para Windows (para quien arma campañas, sin instalar nada):** `crear_ejecutable.bat` (en esta carpeta) fabrica en `release/` un solo `.exe` portable, `Campaigns-and-Dragons-Editor-<versión>.exe`. Lleva dentro el servidor y su propio Python con los componentes ya puestos, así que quien lo usa **no necesita Python ni Node**; solo quien lo fabrica necesita Node (la primera vez descarga Python y los componentes, comprobando su sha256: `tools/preparar-python.js`). Equivale a `npm install` y `npm run portable`.
- **Ponlo en una carpeta propia:** a su lado se crean `campanas/` (la primera vez, con la campaña de ejemplo) y `data/` (partidas, cuentas y certificado). Para cambiar de versión basta con poner el `.exe` nuevo en la misma carpeta. Si ahí no se puede escribir, usa `Documentos\Campaigns and Dragons - Servidor`.
- «▶ Iniciar servidor» abre el servidor con ese Python; los jugadores se conectan igual que siempre.
- Cada vez que se abre se descomprime en una carpeta temporal: tarda unos segundos en aparecer. No está firmado: la primera vez Windows puede mostrar «Windows protegió tu PC» → «Más información» → «Ejecutar de todas formas».
- Para un hosting (VPS, Docker) se sigue usando la carpeta `server/` con `python main.py`.

**Cómo se usa:** a la izquierda están las categorías (Mapas, NPC, Habilidades…). Al pulsar una, su lista se abre en el centro: «＋» añade uno nuevo y la «✕» al lado de cada nombre lo elimina. Al pulsar un nombre, su ficha se abre al lado de la lista (arrastra el borde para agrandar la lista o la ficha). **«Ordenar por»** encima de cada lista: Nombre, Orden de creación o Personalizado. Para el orden personalizado, **arrastra las filas arriba o abajo** (o Alt + ↑ / ↓ sobre una fila); se guarda en la campaña y **la partida usa ese mismo orden** (los grupos y opciones al crear un personaje, los NPC del Panel del GM, las salas…). Cómo ves cada lista (el «Ordenar por») se recuerda en este equipo. Los mapas se editan a pantalla completa. Si cambias de ficha con cambios sin guardar, el Editor pregunta antes. `Ctrl+S` guarda. A la derecha se ven los problemas que detecta el servidor y dónde se usa cada cosa.

**Para desarrollo:** `npm install`, luego `bash tools/correr-e2e.sh` (prueba completa con xvfb) y `node --test tools/test-api.js`. Variables: `MESA_CAMPANAS` (carpeta de campañas), `MESA_PYTHON` (ejecutable de Python).

## Carpeta del cliente

**El servidor, desde el Editor:** el botón «▶ Iniciar servidor» de la barra superior (pasa a «Servidor abierto») abre, cierra y reinicia el servidor de la campaña que estás editando, y muestra lo que escribe (dirección, huella, errores). El servidor lee la campaña solo al arrancar, así que si guardas algo con él abierto, el botón pasa a «🟠 Reiniciar servidor» para aplicar los cambios. La primera vez en cada equipo instala solo los componentes de Python que le faltan. Con el servidor cerrado desde ahí también se pueden editar cuentas y fichas. Al cerrar el Editor se cierra el servidor que abrió; uno abierto por fuera (con `python main.py`) se reconoce y se avisa de los cambios pendientes, pero hay que cerrarlo y abrirlo a mano.

Las imágenes y la música de cada campaña viven en **su propia carpeta `base/`** (`campanas/<campaña>/base/tokens`, `maps`, `icons`, `tiles`, `otros`, `sonido/…`). Al importar una imagen o un audio, el Editor lo copia ahí. Para tus jugadores: menú «⋯» o barra de estado → **«📦 Exportar archivos para los jugadores (.zip)»**; ellos lo instalan en su cliente (Ajustes → «Importar archivos de campaña»). El servidor no reparte archivos. Si una campaña antigua tenía sus imágenes en la carpeta del cliente, la primera vez que la abras se copian solas a su carpeta.

## Atajos de teclado

`Ctrl+S` guardar · `Ctrl+Shift+S` guardar todo · `Ctrl+Z` / `Ctrl+Y` deshacer / rehacer · `Ctrl+N` nuevo · `Ctrl+D` duplicar · `Ctrl+W` cerrar la ficha · `Ctrl+F` buscar · `↑`/`↓` en una lista: anterior/siguiente · `F2` renombrar · `F1` ver todos los atajos.

## Tiles y mapas

Un **tile** es un tipo de casilla (muro, agua, hierba alta, barricada…). Se crea en la categoría «🧱 Tiles»: color o imagen, si es transitable, si esconde a quien está encima, si se puede romper (golpes y en qué se convierte) y efectos (al pisar, al inicio/fin de turno). En el editor de mapas importas una imagen de fondo y pintas con tiles: `B` pincel, `G` rellenar, `R` rectángulo, `E` borrar, `I` punto de inicio, `P` puntos, `O` objetos (ponerlos, moverlos y estirarlos), `F` imagen de fondo, `X` quitar, `1`/`2`/`3` capa, `H` cuadrícula, `+`/`-` zoom, `Espacio` + arrastrar para mover la vista.

## Sonidos

En «🎵 Sonidos» hay tres pestañas (Música, Ambiente, Efectos). Cada una es una lista con **categorías** y **nombres de archivo**, como la de Attorney Online; nada de descripciones. Para armarla rápido: «📥 Importar audios…» (elige varios a la vez; se copian a `base/sonido/…` de la campaña) o «🔍 Añadir los que ya están en la carpeta de la campaña». Cada archivo se puede escuchar, mover a otra categoría o quitar de la lista, y cada categoría se pliega por su cuenta (▾/▸, o «Plegar todas»). En el cliente, las categorías del panel de música también se pliegan una a una. Se guarda solo, en `sonidos.yaml`. Los jugadores ven la música; el GM ve las tres listas y todos oyen lo que él enciende. Si repetir o no la música lo decide cada jugador en su cliente.

## Jugadores y fichas

En «👥 Jugadores y fichas» (arriba del explorador) el GM crea usuarios con el **nickname** con el que se conectarán, con o sin contraseña (sin ella, la elige el jugador al entrar), y les prepara fichas: raza, clase, estadísticas, recursos, puntos por repartir, habilidades e inventario. Al elegir clase o raza se ajusta todo lo que concede (estadísticas propias, recursos, puntos extra, habilidades). Los jugadores ven esas fichas al entrar con su nickname.

Un jugador puede exportar un personaje desde su cliente (archivo `.mesa-personaje`, con su ficha y sus imágenes): **«📥 Importar personaje…»** en la fila de ese usuario lo trae con todos sus datos (estadísticas, recursos, nivel, dinero, inventario y equipo, historia, personalidad, anotaciones) y sus imágenes, si encaja con las reglas de la campaña (si es de otra campaña con otras estadísticas, avisa y no importa nada). Si ese usuario ya tiene una ficha con el mismo nombre, pregunta: **«Actualizar la ficha»** (la sustituye por la del archivo; si el personaje está en la partida sigue siendo el mismo) o **«Importar como copia»** (otra ficha, «Thor (2)»).

Los **NPC** pueden llevar una **Categoría** (Aliados, Enemigos, Jefes…): la lista de NPC se agrupa por ella, con cada grupo plegable, y el Panel del GM del cliente también. Para ordenarlos rápido, **arrastra** un NPC de la lista a otra categoría, a «Sin categoría» o a «＋ Arrastra aquí un NPC para crear una categoría nueva» (pide el nombre). Se guarda al momento.

Esta pantalla guarda al momento (no usa «Guardar») y **solo funciona con el servidor cerrado**: mientras está abierto, la partida tiene su propia copia en memoria.

## Salas y lo que se ve sobre los tokens

Cada mapa es una **sala** de la partida, con sus propios tokens, combate, niebla y dibujos; varias pueden estar en uso a la vez. En «Reglas del juego → Funciones de la mesa → Salas» eliges si los jugadores van solos a las salas abiertas o si los lleva el GM. En «Qué ven los jugadores → Sobre los tokens del mapa» eliges qué recursos se ven como barra bajo cada token (vida, magia…) y si se ven las barras y el nombre de los personajes de los demás y de los NPC.

## Estados: plantillas y opciones

«＋» en **Estados** ofrece empezar en blanco o desde una **plantilla** (Veneno, Quemadura, Aturdimiento, Regeneración, Escudo, Espinas, Protección, Silencio, Confusión, Reflejo, Hemorragia, Marca explosiva). Una plantilla es un estado normal ya armado: se cambia como cualquier otro. Cada estado decide además qué pasa **si se lo vuelven a aplicar** (renovar, ignorar, sumar duración o acumular cargas, con `[Cargas]` en sus fórmulas) y qué **habilidades con ciertas etiquetas** no deja usar. En «Qué hace» hay disparadores como «Al recibir daño», «Al cruzar un umbral», «Al intentar una acción» o «Al terminar este estado», y acciones como «Redirigir el ataque», «Impedir la acción» o «Absorber el daño con un recurso».

## Turnos, movimiento y objetos

En «Reglas del juego → Turnos y movimiento» eliges cómo se decide el orden de los turnos y, si no es a mano, **qué estadística lo decide** (cada raza o clase puede usar otra en su ficha, «Iniciativa con»). Si limitas el movimiento, eliges si todos andan **las mismas casillas** o **según una estadística** (por ejemplo «Velocidad»), y cuál. En «Dinero y comercio → Comercio y objetos» decides si los jugadores pueden **dar objetos** a un token cercano y a qué **distancia** se da un objeto o se usa con otro.

## Estadísticas y recursos por clase

En «Reglas del juego → Estadísticas y recursos», la casilla **Todos** de cada fila decide si la tienen todos los personajes. Si la desmarcas (por ejemplo «Furia»), solo la tiene quien la reciba de su clase o raza. En cada opción (Berserker, Mago…) marcas con qué estadísticas y recursos empieza, y cuántos puntos extra reparte.

## Exportar e importar campañas

Menú «⋯» → **Exportar esta campaña a un archivo…** crea un único archivo `.mesa-campana` con las reglas, los recursos **y sus imágenes y sonidos** (es un .zip normal). No incluye contraseñas ni jugadores. **Importar una campaña desde un archivo…** (también en la pantalla de inicio) la trae con sus imágenes y sonidos, y rechaza archivos que no sean de una campaña. Los `.mesa-campana` de versiones anteriores (sin archivos) se siguen importando.

Si **ya tienes esa campaña** (la reconoce aunque le hayas cambiado el nombre; con archivos de versiones anteriores, por el nombre), el Editor avisa y muestra cuándo se modificó la tuya y cuándo se exportó la del archivo:
- **Importar como copia:** la añade como otra campaña, sin tocar la tuya.
- **Reemplazar la campaña:** pone la del archivo en lugar de la tuya. Se conservan la partida guardada, las cuentas y las fichas de los jugadores, tus contraseñas y la dirección del servidor. La versión anterior va entera a la Papelera, por si la necesitas. Si el archivo ya no trae algún mapa que tienes, lo avisa antes. Con el servidor de esa campaña abierto no se puede reemplazar: ciérralo primero.

## Problemas y avisos

El panel derecho lista lo que detecta el servidor. Los **avisos** se pueden cerrar uno a uno (✕) o todos a la vez («✕ Ocultar los N avisos», o menú «⋯» → «Ocultar todos los avisos»); «Mostrar de nuevo» los recupera. Los **errores** no se ocultan, porque impiden abrir el servidor, pero la lista entera se puede plegar pulsando «Problemas».

## Papelera

Lo que eliminas (recursos y campañas) no se borra al momento: va a la **Papelera**, que se abre con el botón 🗑️ de la barra superior, con «⋯ → Papelera…» o desde la pantalla de elegir campaña. Cada elemento tiene **Recuperar** (vuelve a su sitio; si su identificador ya está en uso, toma otro libre) y **Eliminar para siempre**; cada apartado tiene además **Vaciar**. Borrar de la Papelera no se puede deshacer.
