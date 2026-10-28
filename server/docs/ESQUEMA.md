# Esquema de una campaña (`campanas/<nombre>/`)

Cada campaña es una carpeta dentro de `campanas/` (antes se llamaba `config/`). Cada recurso es un archivo `.yaml`. **El ID es el nombre del archivo sin extensión**
(`bola_de_fuego.yaml` → `bola_de_fuego`). Los demás recursos se refieren a él por ese ID.
`nombre` es solo el texto que se muestra.

Todo lo marcado con `*` es obligatorio. Las imágenes y los sonidos se indican como ruta dentro de la carpeta **`base/` de la campaña**
(`campanas/<nombre>/base/`; p. ej. `tokens/goblin.png`, `maps/aldea.png`, `tiles/muro.png`). El Editor copia ahí lo que importas.
El servidor solo guarda y envía los nombres, nunca los archivos: el GM los exporta en un .zip (Editor → «📦 Exportar archivos para los
jugadores») y cada jugador lo instala en su cliente, que los guarda en su propia carpeta `base/campanas/<id>/`.

## config.yaml

```yaml
servidor:
  nombre*: "Mesa de Prueba"
  host: 0.0.0.0                # localhost = solo este equipo
  puerto: 8765                 # WebSocket de la partida
  password_servidor: ""        # vacío = sin contraseña
  password_gm: "..."           # vacío = nadie puede ser GM

permisos:
  musica: gm                   # gm | todos
  cambiar_sala: gm             # gm | todos: con «todos», cada jugador se va solo (con su personaje) a otra sala abierta; con «gm», lo lleva el GM
  romper_casillas: gm          # gm | todos: quién puede golpear tiles «rompibles»
  mover_tokens_ajenos: false
  npc_para_jugadores: false     # el GM puede dar un NPC a un jugador («Controlado por» al editar el token)
  sin_ficha: false              # los jugadores pueden entrar sin personaje; el GM les asigna personajes («Pertenece a») y NPC («Controlado por»); incluye npc_para_jugadores
  desplegar_en_casilla: true   # el jugador elige dónde aparece su personaje (fuera de combate; con niebla, donde ve)
  acciones_solo_en_su_turno: true
  crear_personajes: true
  max_personajes_por_jugador: 3

juego:
  estadisticas*:               # lista; nombres únicos
    - { nombre*: Fuerza, descripcion, valor_inicial: 10, minimo: 0, maximo: 999 }
  recursos*:                   # se gastan/recuperan; nombres únicos y distintos de las estadísticas
    - { nombre*: HP, descripcion, maximo_inicial: 100 }
  recurso_vida*: HP            # debe ser uno de los recursos; a 0 = derrotado
  estadistica_iniciativa*: Agilidad
  mapa_inicial: aldea          # ID de mapa (opcional): la sala principal al empezar
  max_mensajes_chat: 100

visibilidad:                   # qué ven los jugadores de los tokens AJENOS (de lo suyo, todo)
  jugadores: { estadisticas: false, recursos: false, inventario: false, habilidades: false, ficha: false }
  npc:       { estadisticas: false, recursos: false, inventario: false, habilidades: false, ficha: false }
  sobre_tokens:                # lo que se dibuja sobre cada token en el mapa
    barras: [HP, MP]           # recursos que se ven como barra bajo el token (hasta 4; por defecto, solo el recurso de vida)
    barras_jugadores: true     # ¿se ven las barras de los personajes de los demás jugadores?
    barras_npc: true           # ¿y las de los NPC?
    nombre_jugadores: true     # ¿se ve el nombre de los personajes de los demás?
    nombre_npc: true           # ¿y el de los NPC? (false = enemigos misteriosos)
```

Cada jugador puede apagar en sus Ajustes las barras que no quiera ver (o las de los tokens ajenos), y el GM puede cambiar en un token
concreto si los demás ven sus barras o su nombre (clic derecho → Editar…). Las barras de los demás solo traen los recursos de `barras`;
el resto de sus recursos sigue oculto salvo que `visibilidad.*.recursos` lo muestre.

## abilities/*.yaml — Habilidades

```yaml
nombre*: Bola de Fuego
descripcion: ...
imagen: ...
tipo: dano                     # dano | curacion
objetivo: enemigo              # enemigo (rival: enemigo o neutral) | aliado | cualquiera | uno_mismo
alcance: 5                     # casillas (distancia en diagonal cuenta como 1)
atraviesa_muros: true          # false = necesita ver al objetivo (lo tapan las casillas que «bloquean la vista»)
coste: { MP: 10 }              # recursos que consume
formula*: "[[a.Poder Mágico] * 2] - [o.Defensa Mágica] + 2d4"
sin_limite: false              # true = alcance infinito (todo el mapa)
golpes: 1                      # 1–10: cuántas veces golpea; cada golpe tira sus propios dados
area:                          # opcional (sin él = un solo objetivo)
  forma: explosion             # uno | explosion (radio alrededor del punto) | linea (sale de quien la usa y atraviesa hasta su alcance) | frente (fila perpendicular)
  tamano: 1                    # radio (explosión) o ancho (frente), 1–20
  afecta: rivales              # rivales | todos (también aliados) | aliados (y a sí mismo)
mover_objetivo: { modo: atraer, casillas: 0 }   # atraer (0 = hasta pegarlo) | empujar; no atraviesa muros ni casillas ocupadas
etiquetas_del_usuario: false   # true = ventaja() mira también las etiquetas de quien la usa (su elemento, su raza…)
requisitos:                    # condiciones (las mismas de los efectos, salvo probabilidad)
  - { tipo: tiene_etiqueta, quien: objetivo, tiene: "no", etiqueta: Volador }   # «objetivo»: a quien no cumple no le afecta; «uno_mismo»: no se puede usar
efectos:                       # lo que pasa además a cada objetivo alcanzado (disparador al_impactar, solo en habilidades)
  - { cuando: al_impactar, hacer: { tipo: aplicar_estado, estado: veneno, objetivo: objetivo } }
```

Con un área, en la partida se apunta a un token o a una casilla vacía y el cliente pinta en rojo lo que alcanzará. En la
fórmula de una habilidad, `[Distancia]` son las casillas entre quien la usa y cada objetivo (1 = pegado). «Al atacar» se
dispara aunque el golpe derribe al objetivo.

### Fórmulas

| Sintaxis | Significado |
|---|---|
| `[a.X]` | estadística o recurso **X** del atacante (`a` = atacante) |
| `[o.X]` | estadística o recurso **X** del objetivo (`o` = objetivo) |
| `[h.X]` | valor propio **X** de la habilidad (`valores:`), solo en fórmulas de habilidades |
| `[X]` | igual que `[a.X]` |
| `XdY` / `dY` | `X` dados de `Y` caras (`d20` = `1d20`) |
| `1,5` o `1.5` | decimales |
| `+ - * / %` y `( )` | aritmética; los corchetes sin nombres funcionan como paréntesis |
| `< > <= >= = <>` | comparaciones: valen 1 si se cumplen y 0 si no |
| `max(a; b; …)` `min(a; b; …)` | el mayor / el menor (`max(0; …)` = nunca menos de 0) |
| `redondear(x)` `abajo(x)` `arriba(x)` `abs(x)` | redondeos y valor absoluto |
| `si(condición; sí; no)` | p. ej. `si(1d20 >= 15; 2; 1)`; solo se tiran los dados de la rama elegida |
| `tabla(Nombre; valor)` | busca el valor en una tabla por tramos de la campaña (`juego.tablas`) |

Los argumentos de las funciones se separan con `;` (como en una hoja de cálculo en español); la coma es para decimales.
El resultado final se redondea hacia abajo y, en daño o curación, si es negativo cuenta como 0. Los nombres no distinguen
mayúsculas. `[a.HP]` es la vida *actual*. Máximo 1000 caracteres, 100 dados por tirada, 1000 caras.

```yaml
# abilities/zarpazo.yaml
valores: { Potencia: 30 }              # números propios de la habilidad
formula: "max(0; ([a.Fuerza] + [h.Potencia]/2 - [o.Resistencia]/1,6) * tabla(Multiplicador; 1d20))"
```

### Tablas por tramos (`juego.tablas` en config.yaml)

```yaml
juego:
  tablas:
    - nombre: Multiplicador            # sin ; ( ) [ ]; único (sin distinguir mayúsculas)
      descripcion: Según el d20
      defecto: 0                       # si el valor no cae en ningún tramo
      filas:                           # se usa la PRIMERA fila que encaje; desde/hasta incluidos; vacío = sin límite
        - { hasta: 1, valor: 0 }
        - { desde: 2, hasta: 5, valor: 1.5 }
        - { desde: 6, hasta: 14, valor: 2 }
        - { desde: 15, hasta: 19, valor: 2.5 }
        - { desde: 20, valor: 3 }
```
Sirven para críticos, tablas de botín, clima, reacciones… Se pueden usar en habilidades, efectos, la tirada de estadística y las tiradas libres.

### Etiquetas y tabla de ventajas (`juego.etiquetas`, `juego.ventajas`)

```yaml
juego:
  etiquetas:                               # tipos, elementos, categorías… (nombre único, sin ; ( ) [ ], máx. 30 letras)
    - { nombre: Fuego, color: "#d9531e", descripcion: "Quema" }
    - { nombre: Planta }
    - { nombre: No-muerto }
  ventajas:                                # «atacante contra defensor → ×multiplicador» (0–100); lo que no aparece vale ×1
    - { atacante: Fuego, defensor: Planta, multiplicador: 2 }
    - { atacante: Fuego, defensor: No-muerto, multiplicador: 0 }
```
- Llevan `etiquetas: [Fuego]`: **habilidades** (las del ataque), **opciones** (raza, clase, especie…), **NPC** (`enemies/`) y **estados** (mientras duran).
- Las etiquetas de un token = las de sus opciones elegidas + las propias del NPC + las de sus estados activos.
- En una fórmula, `ventaja()` vale el producto de la tabla para cada pareja (etiqueta de la habilidad, etiqueta del objetivo). Fuera de una habilidad, o sin filas que encajen, vale 1.
- Condición `tiene_etiqueta` (`quien`, `tiene`, `etiqueta`): «solo contra No-muertos», «si está Mojado»…
- El cliente recibe `etiquetas` y `ventajas` en el catálogo y ve las etiquetas de un token en su ficha (si la ficha es visible).

## items/*.yaml — Objetos

```yaml
nombre*: Poción
descripcion: ...
imagen: ...
tipo: consumible               # consumible | equipo | misc
precio: 25
efecto:                        # opcional; sin efecto = no se puede "usar"
  tipo: restaurar
  recurso*: HP
  valor: 40
efectos:                       # opcional; solo «siempre» (bonos mientras lo lleve) o «al_usar»
  - cuando: al_usar            # al usarlo; siempre sobre quien lo usa (objetivo: uno_mismo)
    hacer: { tipo: quitar_estado, estado: veneno }
```
Un objeto con `efecto` o con algún efecto `al_usar` se puede usar. Si es consumible, se gasta.

## characters/*.yaml — Personajes base (plantillas)

Los jugadores eligen una plantilla al crear su personaje; el servidor copia estos datos.

```yaml
nombre*: Mago
descripcion: ...
imagen: ...
stats: { Fuerza: 6, "Poder Mágico": 18 }     # las que falten usan valor_inicial
recursos: { HP: 80, MP: 100 }                # valor máximo; las que falten usan maximo_inicial
habilidades: [ataque_basico, bola_de_fuego]  # IDs
inventario:
  - { objeto: pocion, cantidad: 1 }          # o simplemente el ID
```

## enemies/*.yaml — NPC (personajes que no son de jugadores)
`categoria: Enemigos del bosque` (opcional, hasta 40 letras): solo sirve para ordenar; el Editor y el Panel del GM agrupan los NPC por categoría, cada una plegable. Vacío = «Sin categoría».
En la lista de NPC del Editor, arrastra un NPC sobre otra categoría para moverlo (se guarda al momento), sobre «Sin categoría» para quitársela,
o sobre «＋ Arrastra aquí un NPC para crear una categoría nueva» para crear una.
La carpeta conserva su nombre antiguo. Igual que un personaje, más `bando`: `aliado` (ayuda a los jugadores), `neutral` (no está con nadie; es lo que vale si no se indica) o `enemigo`. El GM puede cambiar el bando de un NPC ya colocado.

A quién pueden atacar los jugadores lo decide `permisos.atacar` en config.yaml: `enemigos`, `enemigos_y_neutros` (por defecto) o `todos`. El GM no tiene límite. Una habilidad con `objetivo: enemigo` nunca sirve sobre aliados; para atacar aliados hace falta una habilidad `objetivo: cualquiera`. Un jugador concreto puede tener su propio límite (`ataque` en su cuenta, `nadie` incluido), que se pone desde el Editor en «Jugadores y fichas».

Mismos campos que un personaje base. Los coloca el GM en el mapa; cada copia tiene sus propios datos.
Los recursos pueden valer 0 (p. ej. sin magia), salvo el de vida (mínimo 1).

## shops/*.yaml — Tiendas

```yaml
nombre*: Tienda de la aldea
descripcion: ...
articulos:
  - { objeto*: pocion, precio: 25, stock: 10 }   # precio vacío = el del objeto; stock vacío = ilimitado
```

## tiles/*.yaml — Tipos de casilla

Un tile es un tipo de casilla reutilizable en todos los mapas. Puede tener gráficos (color y/o imagen) o ninguno.

```yaml
nombre*: Hierba alta
descripcion: ...               # se muestra al analizar la casilla
color: "#2f6a28"               # opcional (#rrggbb). Sin color ni imagen = «sin gráficos»: solo actúa
imagen: tiles/hierba.png       # opcional, en base/tiles de la campaña
transitable: true              # false = muro: nadie puede entrar ni colocarse
bloquea_lados: [norte]         # opcional: lados por los que no se entra ni se sale (norte, sur, este, oeste), como en RPG Maker
esconde: false                 # true = quien esté encima no se ve para los demás jugadores (el GM y su dueño sí)
rompible:                      # opcional
  golpes: 3                    # golpes que aguanta
  se_convierte_en: hierba      # tile resultante (vacío = el tile_base del mapa)
efectos:                       # mismo sistema que rasgos y estados
  - cuando: al_entrar          # al_entrar | inicio_turno | fin_turno | siempre
    hacer: { tipo: modificar_recurso, recurso: HP, formula: "-5" }
```

`al_entrar` se dispara al pisar la casilla; `inicio_turno` / `fin_turno` mientras se esté encima; `siempre` con
`bono_estadistica` da un bono mientras se esté encima (pantano: –2 Agilidad).

## maps/*.yaml — Mapas (cada mapa es una sala)

Cada mapa es una **sala** de la partida, con sus propios tokens, combate, niebla, capas ocultas y dibujos. Varias salas pueden estar
en uso a la vez (un grupo en la taberna y otro en el bosque): el GM pasa de una a otra sin mover a nadie y lleva tokens de una a otra;
con `permisos.cambiar_sala: todos` los jugadores también se van solos a las salas que el GM no haya cerrado. Lo que ocurre en una sala
(combate, efectos, lo que dice un personaje) solo lo leen en el chat quienes están en ella (y el GM); lo que se escribe como usuario
lo lee toda la mesa. El momento del día, el clima, la música y las tiendas son de toda la mesa.

```yaml
nombre*: Aldea
descripcion: ...
ancho: 20                      # casillas (1-200)
alto: 12
tamano_tile: 64                # píxeles de cada casilla en la imagen/juego (16-256)
fondo: maps/aldea.png          # imagen opcional (en base/maps de la campaña)
tile_base: hierba              # opcional: lo que hay donde no se pinta nada (vacío = suelo libre sin gráficos)

casillas:                      # tile → casillas [columna, fila] donde se pinta
  muro: [[0, 0], [1, 0], [2, 0]]
  agua: [[8, 4], [9, 4]]

inicio: { x: 2, y: 5 }         # dónde aparecen los personajes (al desplegarlos o al llegar a esta sala)
objetos:                       # elementos colocados sobre el mapa
  - { nombre*: Barril, x: 3, y: 2, imagen: ..., bloquea: true }
  - { nombre*: Carro, x: 6, y: 4, ancho: 2.5, alto: 1.5, imagen: otros/carro.png }   # tamaño en casillas (cuartos); bloquea todas las que toca
fondo_ajuste: { x: -0.5, y: 0, ancho: 21, alto: 12 }   # opcional: dónde va la imagen de fondo, en casillas (por defecto, el mapa justo)
puntos:                        # puntos importantes (solo informativos)
  - { nombre*: Puerta, x: 5, y: 6 }
```

Las coordenadas empiezan en (0, 0) arriba a la izquierda. Las casillas rotas durante la partida se guardan en
`data/<campaña>/estado.yaml` (el mapa original no cambia).

## data/ (generado por el servidor)

```
data/<campaña>/estado.yaml             sala principal, y por cada sala en uso sus tokens, su combate y su niebla;
                                        salas cerradas, chat, música, momento del día, clima, tiendas…
data/<campaña>/jugadores/<usuario>.yaml  personajes de cada jugador
data/<campaña>/cuentas.yaml             usuarios y contraseñas (hash)
data/<campaña>/tls/                     certificado propio del servidor
```

Una partida guardada antes de las salas (con `tokens` y `combate` sueltos) se sigue cargando: todo pasa a la sala principal.

---

# Campañas (desde la versión con campañas)

Cada campaña es una carpeta dentro de `campanas/` con exactamente la estructura de arriba
(el antiguo `config/` ahora es `campanas/<nombre>/`). La partida guardada vive en `data/<nombre>/`.
### campana.yaml (lo escribe el Editor)

```yaml
uid: 3f9a1c2b7d4e5f60          # identifica la campaña aunque cambie de nombre (al importar su archivo otra vez, se reconoce)
orden:                         # orden «Personalizado» de cada lista (carpeta → ids); la partida también lo usa
  enemies: [tabernero, goblin]
  groups: [raza, clase]
creacion:                      # orden en que se crearon (para «Ordenar por: Orden de creación» en el Editor)
  enemies: [goblin, tabernero]
```

Es opcional. Sin `orden` (o para lo que no aparezca en él), las listas van por nombre de archivo, como siempre. Un `campana.yaml`
mal escrito no impide abrir el servidor: solo avisa. Viaja dentro del `.mesa-campana`.

Para pasar una campaña a otra persona: Editor → menú «⋯» → «Exportar esta campaña a un archivo…» (`.mesa-campana`). Desde la versión 2 es un `.zip`
con `campana.json` (`{formato: "mesa-de-rol/campana", version: 2, nombre, archivos: {ruta: texto YAML}}`) y `base/…` (las imágenes y sonidos de la campaña).
No lleva contraseñas ni jugadores. Al importar solo se aceptan los YAML de la campaña y, en `base/`, imágenes (png, jpg, gif, webp en tokens/maps/icons/tiles/otros,
con hasta dos subcarpetas) y audio (ogg, mp3, wav en sonido/musica|ambiente|efectos); lo demás se ignora. Los `.mesa-campana` de la versión 1 (solo el JSON) se siguen importando.

```
python main.py                    # si hay varias campañas, pregunta cuál abrir
python main.py --campana ejemplo
```

## Cambios en config.yaml

```yaml
juego:
  puntos_a_repartir: 5            # puntos de estadística al crear un personaje (0 = no hay reparto)
permisos:
  editar_stats_jugador: false     # true = el jugador reparte sus puntos; false = solo el GM
```

Las estadísticas y los recursos se definen una vez en la campaña (`juego.estadisticas`, `juego.recursos`). Cada uno puede ser
**para todos** (por defecto) o solo de algunas clases/razas:

```yaml
juego:
  estadisticas:
    - { nombre: Fuerza, valor_inicial: 10, minimo: 0, maximo: 99 }            # la tienen todos
    - { nombre: Suerte, valor_inicial: 3, minimo: 0, maximo: 9, para_todos: false }   # solo quien una opción se la conceda
  recursos:
    - { nombre: HP, maximo_inicial: 100 }                                      # el recurso de vida debe ser para todos
    - { nombre: Furia, maximo_inicial: 0, para_todos: false }
```

Quien concede o ajusta cosas es la **opción** (clase, raza…); ver `options/*.yaml` más abajo. Quien no tiene una estadística o recurso
no lo ve, no puede repartirle puntos, y en las fórmulas cuenta como 0.

## groups/*.yaml — Grupos de elección (Raza, Clase, Origen…)

```yaml
nombre*: Raza
descripcion: ...
obligatorio: true        # el personaje debe elegir una opción de este grupo
solo_si:                 # opcional: el grupo solo aparece si en otro grupo se eligió una de estas opciones
  grupo: clase
  opciones: [mago]
```
Si el grupo no aparece, no se exige ni se acepta. No puede haber dependencias en círculo.

## options/*.yaml — Opciones de un grupo (Elfo, Mago…)

```yaml
grupo*: raza             # ID de un grupo
nombre*: Elfo
descripcion: ...
imagen: ...
bonos: { Agilidad: 2, Resistencia: -1 }   # opcional; se suman a las estadísticas
estadisticas: { Fuerza: 14, Suerte: 5 }    # con qué valor EMPIEZA quien la elija (sustituye al inicial; añade las «para_todos: false»)
recursos: { Furia: 50 }                    # máximos propios de la opción (añade los «para_todos: false»)
puntos_extra: 3                            # puntos para repartir además de los de la campaña (0 por defecto)
rasgos: [vista_aguda]                      # IDs de traits/
habilidades: [curacion]                    # IDs de abilities/
iniciativa: Inteligencia                   # opcional: estadística con la que tira la iniciativa (por defecto, la de la campaña)
```

## traits/*.yaml — Rasgos

```yaml
nombre*: Toque venenoso
descripcion: ...
efectos:
  - cuando: { tipo: al_atacar }
    hacer: { tipo: aplicar_estado, estado: veneno, objetivo: objetivo }
```

## states/*.yaml — Estados

```yaml
nombre*: Veneno
duracion: 4              # turnos; 0 = hasta que se quite
color: "#4f9a3c"         # color de su insignia sobre el token (con su imagen dentro, si tiene); vacío = morado
al_reaplicar: acumular   # si se lo vuelven a aplicar: renovar (defecto: vuelve a empezar su duración) · ignorar · sumar (la duración) · acumular (cargas)
max_cargas: 5            # solo con «acumular»: tope de cargas (1–100). Sus fórmulas usan [Cargas]; sus bonos fijos se multiplican por las cargas
impide_etiquetas: [Magia]   # no puede usar habilidades con alguna de estas etiquetas (un Silencio solo para la magia)
efectos:
  - cuando: { tipo: inicio_turno }
    hacer: { tipo: modificar_recurso, recurso: HP, formula: "-2 * [Cargas]" }
```
Un estado admite los disparadores `siempre`, `inicio_turno`, `fin_turno`, `al_cambiar_momento`, `al_cambiar_clima`, `al_atacar`, `al_ser_atacado`,
`al_derrotar`, `al_ser_derrotado`, `al_recibir_dano`, `al_cruzar_umbral`, `al_intentar` y `al_terminar_estado` (este último solo en estados).
En el Editor, «＋» en Estados ofrece empezar en blanco o desde una **plantilla** (Veneno, Quemadura, Aturdimiento, Regeneración, Escudo,
Espinas, Protección, Silencio, Confusión, Reflejo, Hemorragia, Marca explosiva): son estados normales ya armados con estas piezas.

## journal/*.yaml — Diario (opcional)

```yaml
nombre*: Armas de la aldea
seccion: Equipo          # agrupa páginas en el diario; vacío = «General»
visible: todos           # todos | oculta (el GM la revela en partida, a todos o solo a algunos jugadores)
jugadores: [Ana]         # opcional: con «oculta», quiénes la ven desde el principio
imagen: otros/espadas.png
texto: |-                # hasta 20 000 letras. «# Subtítulo», «- elemento», **negrita**, línea vacía = párrafo
  En la aldea se fabrican armas sencillas…
```
`juego.diario_reglas` (por defecto `true`): el diario incluye la página automática «Reglas de la mesa».
Lo que el GM revela u oculta en partida se guarda en `data/…/estado.yaml` (se recuerda al reiniciar).

## Chat: comandos y tiradas guardadas

`/r 2d6+3` o `/2d6` tiran dados · `/yo abre la puerta` escribe una acción · `/ayuda` lista los comandos ·
`/gm contraseña` convierte al usuario en GM sin reconectar (la contraseña nunca llega al chat; los fallos cuentan para el bloqueo).
Cada usuario guarda hasta 30 tiradas propias (nombre + expresión, p. ej. «Ataque: 1d20 + [Fuerza]») desde la ventana Tiradas;
se lanzan con un clic o escribiendo `/Ataque`. Si usan estadísticas, se toman del personaje seleccionado (que debe poder controlar).

## sonidos.yaml — Listas de sonidos
Un solo archivo con tres listas (`musica`, `ambiente`, `efectos`), como la lista de canciones de Attorney Online: cada una tiene categorías y cada categoría, nombres de archivo (`.ogg`, `.mp3` o `.wav`, sin carpetas). No hay descripciones ni identificadores.

```yaml
musica:
  - categoria: Taberna
    archivos: [alegre.mp3, calma.ogg]
ambiente:
  - categoria: Clima
    archivos: [lluvia.ogg]
efectos:
  - categoria: Combate
    archivos: [espada.wav]
```
También vale una lista simple de nombres (quedan en la categoría «General»). Los audios viven en la carpeta de la campaña (`base/sonido/musica`, `base/sonido/ambiente` y `base/sonido/efectos`) y llegan a cada cliente con el .zip de archivos. Los jugadores ven solo la música (verde si tienen el archivo, rojo si no); el GM ve las tres listas. Si la música debe repetirse o no lo decide cada cliente con la casilla «Repetir».

## Reglas añadidas
`permisos.dados_personalizados` (defecto sí): si es no, los jugadores solo tiran un dado simple (`1d20`). `permisos.rasgos_personalidad` (defecto no). `juego.dados`: caras disponibles en la ventana de tiradas (1–12 números entre 2 y 1000).

## Efectos (`cuando` / `si` / `hacer`)

| cuando | significado |
|---|---|
| `siempre` | bono permanente |
| `inicio_turno` / `fin_turno` | al empezar / terminar su turno |
| `tirada` (+ `estadistica` opcional) | al tirar dados de esa estadística |
| `al_atacar` / `al_ser_atacado` | durante un ataque |
| `al_derrotar` / `al_ser_derrotado` | cuando alguien llega a 0 de vida (por una habilidad o un efecto); el «objetivo» es el otro |
| `al_cambiar_momento` | cuando el GM cambia el momento del día (personajes en el mapa) |
| `al_cambiar_clima` | cuando el GM cambia el clima (personajes en el mapa) |
| `al_usar` | al usar el objeto (solo objetos) |
| `al_entrar` | al pisar la casilla (solo tiles) |
| `al_recibir_dano` | al perder vida por cualquier causa (ataques, veneno, casillas, daño devuelto); el «objetivo» es quien lo causó, si lo hay |
| `al_cruzar_umbral` (+ `recurso`, `sentido`: `baja`·`sube`, `porcentaje`) | cuando ese recurso cruza ese % de su máximo (una vez por cruce) |
| `al_intentar` (+ `accion`: `atacar`·`habilidad`·`objeto`·`mover`·`cualquiera`) | antes de la acción; en un ataque, el «objetivo» es a quien ataca. Moverse: no cuando lo mueve el GM |
| `al_terminar_estado` (+ `motivo`: `cualquiera`·`se_acaba`·`se_quita`) | al quitarse este estado (solo estados) |

| hacer | campos | solo con |
|---|---|---|
| `bono_estadistica` | estadistica, valor | siempre |
| `modificar_estadistica` | estadistica, formula, objetivo — cambio **permanente** de la estadística base (experiencia, cordura…), sin salirse de su mínimo y máximo | todos menos siempre |
| `bono_vision` | valor | siempre |
| `bono_tirada` | valor | tirada |
| `modificar_recurso` | recurso, formula, objetivo (`uno_mismo`/`objetivo`) | cualquiera |
| `aplicar_estado` | estado, objetivo | cualquiera |
| `quitar_estado` | estado, objetivo | cualquiera |
| `absorber_dano` | recurso — escudo: el daño se resta primero de ese recurso y solo lo que sobre, de la vida | siempre |
| `redirigir_ataque` | hacia (`quien_ataca`·`aleatorio`) — confusión (con `al_intentar`) o reflejo (con `al_ser_atacado`); solo ataques a un objetivo | al_intentar, al_ser_atacado |
| `impedir_accion` | — la acción no ocurre (no gasta nada) y la mesa ve el aviso | al_intentar |

### Contadores y reglas automáticas
- `juego.estadisticas[].repartible: false` → contador (experiencia, cordura, reputación…): no recibe puntos de creación ni de nivel; cambia con `modificar_estadistica` o el GM.
- `juego.recursos[].empieza_vacio: true` → empieza en 0 (barra que se llena). El recurso de vida no puede.
- `juego.estadisticas[].formula: "abajo(([Fuerza] - 10) / 2)"` → **estadística calculada**: su valor sale de la fórmula con las demás ya bonificadas
  (un objeto que sube la Fuerza sube el modificador) más sus propios bonos; no se reparte ni se edita. Sin dados; solo puede citar las
  calculadas que estén antes en la lista, y `[Nivel]`.
- `juego.recursos[].maximo_formula: "10 + [Constitución] * [Nivel]"` → **máximo calculado** de los personajes (los NPC usan el de su ficha).
  Si el máximo sube o baja, el valor actual se mueve lo mismo. El GM no puede cambiar ese máximo a mano. Sin dados.
- `juego.efectos: [ … ]` → **efectos de la campaña**: mismo formato que los de un rasgo y valen para todos los personajes y NPC (las condiciones los limitan). Ejemplo:
```yaml
juego:
  efectos:
    - cuando: al_derrotar
      si: [{ tipo: bando, quien: uno_mismo, bando: jugador }]
      hacer: { tipo: modificar_estadistica, estadistica: Experiencia, formula: "10" }
```

### Condiciones (`si`, opcional)
Lista de condiciones; el efecto solo ocurre si se cumplen **todas**. `quien` es `uno_mismo` (por defecto) u `objetivo` (solo con `al_atacar` / `al_ser_atacado`; sin objetivo, la condición no se cumple). `tiene` es `si` (defecto) o `no`.

| tipo | campos | ejemplo |
|---|---|---|
| `recurso` | quien, recurso, comparacion (`menos_de`·`al_menos`·`igual_a`), valor, unidad (`porcentaje`·`puntos`) | vida por debajo del 50 % |
| `estadistica` | quien, estadistica, comparacion, valor | Fuerza al menos 15 (*) |
| `tiene_estado` | quien, tiene, estado | si no está envenenado |
| `lleva_objeto` | quien, tiene, objeto | si lleva la antorcha |
| `es_opcion` | quien, tiene, opcion (raza, clase…) | si es elfo |
| `bando` | quien (defecto `objetivo`), bando (`jugador`·`aliado`·`neutral`·`enemigo`) | si el objetivo es enemigo |
| `momento_dia` | periodo (nombre en `juego.ciclo.periodos`) | solo de noche |
| `en_combate` | activo (`si`·`no`) | solo en combate |
| `probabilidad` | porcentaje (1–100) | 25 % de las veces — **no** con `siempre` |
| `critico` | es (`si`·`no`) | el golpe fue crítico — solo con `al_atacar`, `al_ser_atacado`, `al_impactar`, `al_recibir_dano` |
| `dano` | comparacion, valor | el daño de ese golpe (ya con defensas) — mismos disparadores que `critico` |
| `ronda` | comparacion, valor | «igual_a 1» = primer turno del combate (fuera de combate no se cumple) — **no** con `siempre` |
| `tiene_habilidad` | quien, tiene, habilidad | si conoce «Curación» |
| `actua_antes` | tiene (`si`·`no`) | si va antes que el otro en el orden de turnos (necesita otro) |
| `cargas` | quien, estado, comparacion, valor | si «Veneno» lleva al menos 3 cargas (sin el estado = 0) |

(*) En los efectos `siempre`, la estadística se mira con los bonos de raza y clase pero sin los de otros efectos (así un bono no depende de sí mismo).

```yaml
# traits/vision_nocturna.yaml (campaña de ejemplo)
efectos:
  - cuando: { tipo: siempre }
    si:
      - { tipo: momento_dia, periodo: Noche }
    hacer: { tipo: bono_vision, valor: 2 }
```

Al cambiar el momento del día o empezar/terminar un combate, el servidor reenvía los tokens (los bonos y la visión pueden cambiar).
Los catálogos están en `server/mesa/efectos.py` (`DISPARADORES`, `CONDICIONES`, `ACCIONES`); cada campo trae su `etiqueta` y, si es una lista, sus `textos`, y el Editor arma los formularios con eso (`main.py --esquema`). Añadir un tipo nuevo = añadir una entrada allí y su caso en `mesa/motor.py`.

## Personajes y enemigos

Pueden llevar `elecciones: {raza: elfo, clase: mago}` (cada opción debe pertenecer a su grupo).

## Seguridad y cifrado en config.yaml

```yaml
servidor:
  cifrado: true            # wss/https con certificado propio (false = sin cifrar, p. ej. tras un proxy)
  certificado: ""          # opcional: ruta a tu certificado .pem (junto con «clave»)
  clave: ""
seguridad:
  registro_abierto: true   # un nombre nuevo se registra al entrar
  contrasena_obligatoria: false
  max_intentos: 5
  bloqueo_segundos: 60
```

## Estadísticas iniciales
`juego.stats_por_plantilla` (por defecto `false`): con `false`, todo personaje nuevo empieza con el `valor_inicial` global de cada estadística
(más bonos de raza/clase y los puntos a repartir); la plantilla (`characters/*.yaml`) solo aporta recursos, habilidades, inventario y elecciones.
Con `true`, cada plantilla trae sus propias estadísticas (`stats:`).

## characters/ (plantillas) — opcional
Las plantillas de personaje ya no se usan en el cliente y la carpeta `characters/` puede no existir. Un personaje se define por sus elecciones
(raza, clase…), las estadísticas globales y el reparto de puntos. Si la carpeta existe, el servidor aún la carga y acepta `base` al crear un personaje.

## Añadidos recientes (config.yaml y recursos)
- `visibilidad.{jugadores,npc}.{estadisticas,recursos,inventario,habilidades,ficha}` (todo `false` por defecto).
- `permisos`: `regla_visible`, `dibujar`, `sonidos_personaje` (false), `intercambios` (true).
- `permisos.dar_objetos` (true): los jugadores dan objetos a otro token cercano (el GM siempre). `permisos.alcance_objetos` (1, de 1 a 50):
  a cuántas casillas como mucho se da un objeto o se usa con otro.
- `juego.moneda {activa, nombre, simbolo, inicial, denominaciones:[{nombre, valor}]}` y `juego.ciclo {activo, inicial, periodos:[{nombre, color, opacidad}]}`; `juego.salas_chat`.
- NPC y fichas: `dinero` (entero) y `sonidos: [archivo.wav]` (deben estar en la lista de efectos).
- `shops/*.yaml`: `recompra` (0–100 %: lo que paga la tienda al comprar objetos del jugador; 0 = no compra).
- `cuentas.yaml` por usuario: `ver_ajenos`, `editar` (false = bloqueo individual), además de `ataque`.

## Capas del mapa (maps/*.yaml)
`casillas` es la **capa 1 (base)**: la única que bloquea, daña o esconde. Además, `capas:` admite dos capas de **decoración** con el mismo formato `tile: [[x, y], …]`:
```yaml
capas:
  detalle:   { hierba_alta: [[2, 8]] }   # capa 2: bajo los tokens
  superior:  { hierba_alta: [[16, 8]] }  # capa 3: encima de los tokens (techos, copas de árboles)
```
Los tokens y objetos del mapa forman su propia capa, entre la 2 y la 3. Las capas 2 y 3 ignoran los efectos del tile (solo cuentan su imagen o color).

## Niebla de guerra
- `juego.niebla {activa: false, vision_base: 6, compartir: true}` (en `config.yaml`). El mapa puede excluirse con `niebla: false`.
- Quién ve: cada personaje de jugador ve un círculo de `vision_base` casillas más los efectos `bono_vision` (acción «Sumar o restar casillas de visión», momento `siempre`) de sus rasgos (incluidos los de razas y clases), estados, **objetos que lleva** y el tile sobre el que está.
- Qué tapa la vista: tiles con `bloquea_vision: true` y objetos del mapa con `bloquea_vision` (por defecto, el valor de `bloquea`).
- Objetos con efectos pasivos: `efectos:` en `items/*.yaml` (solo `siempre` y solo `bono_estadistica` o `bono_vision`; valen mientras el objeto esté en el inventario). Ejemplo: `items/antorcha.yaml`.

`juego.usar_grupos` (por defecto `true`): con `false` la campaña no usa razas, clases ni otros grupos de elección; al crear un personaje
no se piden y las elecciones se ignoran (los archivos de groups/ y options/ se conservan).

## Tanda grande (pasabilidad, formas, tokens, grupo, ficha, simulador)

**Pasabilidad por lados.** Un tile con `bloquea_lados` deja estar encima pero no cruzar ese borde (una valla al norte, un mostrador).
Los jugadores solo llegan andando a donde hay camino (el GM coloca donde quiera). El cliente lo dibuja como una línea gruesa.

**Transformación** (groups/*.yaml y options/*.yaml):
```yaml
# groups/forma.yaml
nombre: Forma
transformacion: formas        # no | formas (ir y volver: humano ↔ lobo) | evolucion (solo hacia delante)
# options/lobo.yaml
grupo: forma
imagen_forma: tokens/lobo.png # imagen del token mientras tenga esta forma (vacío = la suya)
evoluciona_a: [otra_opcion]   # solo en grupos de evolución: a qué puede pasar
```
Al cambiar de forma cambian bonos, rasgos, etiquetas, habilidades y recursos propios de la opción; los recursos mantienen su proporción.
El GM siempre puede; el jugador solo si `permisos.transformarse: true`.

**Tokens: tamaño y grupos** (sin configuración): clic derecho en un token propio (o cualquiera, el GM) → «Más grande / Más pequeño»
(½, ¾, 1, 1½, 2 o 3; solo cambia cómo se ve) y «Agrupar con…»: al mover uno, se mueven todos (fuera de combate; quien no pueda, se queda).
Un compañero (mascota, criatura, invocación) es simplemente otro personaje del jugador o un NPC.

**Inventarios de grupo:** `juego.inventario_grupo: true` crea uno común para todos los jugadores. El GM crea más en partida y elige
quién participa en cada uno; también puede cerrarlos (solo meter). Objetos y dinero.

**Campos propios de la ficha** (`juego.campos_ficha`) y **nombres** (`juego.nombres`):
```yaml
juego:
  campos_ficha:
    - { nombre: Alineamiento, tipo: lista, opciones: [Legal, Neutral, Caótico] }
    - { nombre: Cordura, tipo: numero, minimo: 0, maximo: 99, quien: gm }   # quien: jugador | gm · privado: true = solo dueño y GM
    - { nombre: Dios, tipo: texto }                                          # tipo: texto | numero | lista | casilla
  nombres: { habilidades: Conjuros, inventario: Mochila, personaje: Investigador }
```
Se pueden renombrar: personaje, habilidades, inventario, estadisticas, recursos, rasgos, estados, diario y grupo.

**Simulador** (Editor → una habilidad → «🧪 Probar esta habilidad»): la usa 1, 10 o 100 veces entre un personaje de prueba (con las
opciones que elijas; las obligatorias sin elegir toman la primera) o un NPC, con las reglas reales del servidor y con lo escrito aunque
no esté guardado (`python main.py --simular peticion.json --config …`). No toca ninguna partida.

## Turnos, movimiento y niveles (config.yaml → juego)

```yaml
juego:
  iniciativa: estadistica        # estadistica (d20 + estadistica_iniciativa) | manual (no se tira: al empezar se abre una ventanita donde el GM ordena y pulsa «Listo»; los demás esperan)
  movimiento:                    # en combate, por turno (fuera de combate no hay límite; el GM nunca lo tiene)
    limitado: true
    casillas: 6                  # andando, sin diagonales y rodeando muros
    estadistica: Velocidad       # opcional: en vez de «casillas», el valor de esta estadística (con bonos)
  niveles:
    activo: true
    modo: manual                 # manual (por defecto: solo el GM sube, con «⬆️ Subir de nivel») | experiencia (se sube solo)
    experiencia: [Exp. combate, Exp. sagrada]   # tipos de experiencia: estadísticas contador que se suman en un total
    umbrales: [100, 300, 600]    # experiencia total para llegar a nivel 2, 3, 4 (solo modo experiencia)
    maximo: 20                   # nivel máximo, en los dos modos (en modo experiencia, además, no se pasa del último umbral + 1)
    reparto: todos               # experiencia de un enemigo derrotado: todos (los personajes en pie) | vencedor (solo quien lo derrota)
    por_nivel: { puntos: 2, recursos: { HP: 10 } }  # lo que da cada nivel
    aprende: [{ nivel: 3, habilidad: curacion }]     # para todos; cada opción (clase) tiene también su «aprende»
    entrega: automatica          # automatica (por defecto: el programa da lo de cada nivel) | gm (al subir solo cambia el nivel; el GM da lo demás)
```
Cada opción (raza, clase, origen…) puede añadir lo suyo por nivel, que se suma a `por_nivel` de la campaña (solo con `entrega: automatica`):
```yaml
# options/guerrero.yaml
puntos_por_nivel: 1
recursos_por_nivel: { HP: 10 }   # puede ser negativo
aprende: [{ nivel: 3, habilidad: torbellino }]
```
En cualquier modo de iniciativa, el GM puede reordenar los turnos en partida (flechas de la barra de turnos).
**Tipos de experiencia:** cada tipo es una estadística contador (`repartible: false`), así que las fórmulas, condiciones y efectos pueden usarla por
separado (`[a.Exp. sagrada]`) además de sumarse al total. Cualquier contador puede tener `escalones: [10, 30, 60]` (valor para llegar al rango 2, 3, 4…):
la ficha muestra «Rango N» y las fórmulas pueden usar `[Rango Valentía]` (por ejemplo, estadísticas sociales que «suben de nivel» por su cuenta).

**Experiencia que cede cada NPC:** `experiencia: 50` (va al primer tipo) o `experiencia: { Exp. combate: 50, Exp. sagrada: 10 }` en la ficha del enemigo.
Al derrotarlo se reparte según `niveles.reparto` (una sola vez por token). El GM puede cambiar lo que cede un token concreto y **dar experiencia a mano**
(número negativo = quitar) al editar un token. Con niveles automáticos, subir de nivel ocurre solo al juntar los umbrales.

Las fórmulas pueden usar `[Nivel]` (los NPC tienen `nivel` en su ficha, 1 por defecto). Bajar la experiencia no baja de nivel.

## Añadidos de la segunda prueba con una campaña real (octubre de 2026)

- `juego.inventario_grupo_inicial: { inventario: [{objeto, cantidad}], dinero }`: con qué empieza el inventario común.
- En modo `niveles.modo: manual` también se eligen los tipos de experiencia: la ficha muestra el total y cada tipo.
- Una opción con `imagen_forma` (especie, forma…) pone esa imagen al token desde que se crea el personaje; la imagen que
  eligió el jugador queda como `imagen_propia`.
- Los textos «no», «yes», «on», «off»… se escriben entre comillas (el servidor lee YAML 1.1). Si un archivo escrito a mano
  pone `tiene: no` o `transformacion: no` sin comillas, el servidor lo entiende igual.

## Tanda de sugerencias de uso (octubre de 2026)

**Habilidades:** `tipo: efecto` (sin daño ni curación; no necesita fórmula), `aplica_estado: <estado>` (a cada objetivo alcanzado),
`alternar: true` (si ya lo tiene, se lo quita: poderes que se encienden y apagan), `aplicar_si_falla: true` (un ataque que hace 0 de daño, o que la defensa anula, **falla** y no pone su estado ni sus efectos «al alcanzar», salvo con esta opción), `critico: {desde: 19, multiplicador: 2}`
(un d20 aparte por golpe; el chat dice «¡Crítico!»).

**Estados:** `impide: [atacar, habilidades, objetos, mover]` (el GM siempre puede moverlo) y `al_terminar: <estado>` (al acabarse su
duración pasa a ese otro: «Quemadura leve» → «Quemadura grave»).

**Efectos nuevos:** con «Al recibir un ataque» (defensa activa, antes de restar la vida): `anular_ataque`, `reducir_dano {valor, unidad: puntos|porcentaje}`,
`devolver_dano {valor: %}`. Con «Siempre»: `bono_critico {valor}` (rebaja el número del d20 necesario; también en objetos).

**Opciones:** `elegible: false` = no sale al crear personaje (solo por transformación o el GM).

**Estadísticas y recursos:** `solo_para: [opciones]` en config.yaml, junto a `para_todos: false`: qué razas, clases… la tienen. Se edita
en Reglas → Estadísticas y recursos. El `estadisticas`/`recursos` de una opción queda como «valor inicial propio» (y también la concede).

**Mesa:** `juego.sonidos_activos: false` (sin música ni sonidos; el cliente no muestra su panel) y
`juego.chat: {modo: libre|registro, espera_chat: s, espera_tiradas: s}` (registro = los jugadores solo tiran dados; modo lento por separado; el GM no espera).

**Otros:** la historia del personaje admite 20 000 caracteres. Los tokens agrupados se mueven juntos fuera de combate los mueva quien los mueva.
La validación avisa (sin impedir arrancar) de estados que nada aplica, contadores que nada cambia y consumibles que no hacen nada.

**Turnos:** `juego.iniciativa: estadistica | valor | manual | preguntar`. `estadistica` = al iniciar el combate hay una fase
«decidiendo turnos»: cada jugador tira (d20 + su estadística) la de sus personajes, los NPC tiran solos y el GM puede «Empezar ya»
(se tira por quien falte). `valor` = de mayor a menor estadística, sin dados (empate al azar). `manual` = el GM ordena.
`preguntar` = el GM elige al pulsar «Iniciar combate» entre `juego.iniciativa_opciones` (por defecto las tres; con una sola no se pregunta).
En todos, el GM puede reordenar en plena partida.

**Clima:** `juego.clima: {activo, inicial, tipos: [{nombre, color, opacidad}]}` (desactivado por defecto; tipos de ejemplo: Despejado, Lluvia, Niebla, Tormenta).
El GM lo cambia con un clic en la barra superior del cliente (acción `gm_clima`); el mapa se tiñe del color del clima, encima del velo de día y noche.
Los efectos pueden depender de él con la condición `{tipo: clima, clima: Lluvia}` («solo si el clima es…») y reaccionar a los cambios con el
disparador `al_cambiar_clima`. Con `activo: false`, la condición nunca se cumple (la carga avisa) y `gm_clima` se rechaza.

**Orden del menú del cliente:** `juego.orden_menu` es la lista de secciones del menú izquierdo en el orden deseado
(`lista-personajes`, `inventario`, `cofres`, `tiradas`, `diario`, `tienda`, `ajustes`, `gm`). Por defecto, ese mismo orden (la Tienda abajo).
Las que falten se añaden al final. Se cambia en el Editor: Reglas → «Funciones de la mesa» → «Orden del menú del cliente».

**Fin del combate:** `juego.fin_combate: manual | automatico` (por defecto `manual`). Con `automatico`, el combate termina solo cuando no queda
ningún NPC de bando `enemigo` en pie (derrotado o quitado del mapa); solo si al empezar había alguno. El GM siempre puede terminarlo a mano.

## Añadidos (23-oct-2026, tanda 3)
- `area.forma`: también `cono` (sale de quien la usa; `tamano` = largo; se abre 1, 3, 5… casillas) y `casillas` (dibujada a mano:
  `area.casillas: [[adelante, lado], …]` respecto a quien la usa mirando hacia donde apunta; `lado` positivo = a su derecha;
  números de -10 a 10). Las dos giran hacia el lado dominante (arriba, abajo, izquierda, derecha) y no miran el alcance.
- `juego.medida: {unidad: casillas | metros | pies, tamano}`: solo cambia cómo se muestran la regla y los alcances.
- Tiendas: `mapas: [ids]` (vacío = en cualquiera): solo se compra o vende en ellas mientras la partida está en uno de esos mapas
  y el GM las tiene abiertas.
- Servidor sin `password_gm`: el cliente entra como GM marcando la casilla y dejando la contraseña vacía (mensaje `entrar` con `gm: true`).

- `juego.categorias_estadisticas` (por defecto false) y `categoria` en cada estadística: la ficha y la creación las muestran por bloques.
- `juego.equipamiento: {activo (false), maximo (0 = sin límite), huecos}`; en objetos `equipable` (por defecto si `tipo: equipo`) y `hueco`. Con el equipamiento activo, los efectos de un objeto equipable solo cuentan si su entrada de inventario tiene `equipado: true` (mensaje `equipar {token, objeto, poner}`).
- Tiles: `invisible` (no se dibuja en la partida). `juego.habilidades_fuera_de_combate: todas | sin_dano | ninguna` (el GM siempre puede).

## Detalle de las tiradas en el chat
`juego.chat.detalle_tiradas` (por defecto `false`): los jugadores ven solo qué se tiró y el resultado («🎲 Ana tiró Fuerza: 15»); con `true`, también cada dado y cada suma. El GM siempre ve el detalle.

## Objetos destruibles y ataques a lo rompible
En un mapa, un objeto puede llevar `destruible: 3` (golpes que aguanta; 0 o ausente = no se rompe). Roto, desaparece del mapa en la partida (deja de bloquear y de tapar la vista). Cada ataque de una habilidad de daño que alcanza un tile rompible o un objeto destruible le da un golpe: apuntando a su casilla o con un área (un objeto grande cuenta una vez). Quién puede: `permisos.romper_casillas` (`gm` por defecto, o `todos`). El «Golpear» del clic derecho sigue igual y vale también para objetos.

## Imágenes de los personajes y personajes exportados
La imagen de un personaje (y la de su biografía) que elige un jugador puede estar en `tokens/`, `icons/` u `otros/`, con hasta tres subcarpetas
(`tokens/jugadores/ana.png`, como las guarda el Editor); un nombre suelto se entiende en `tokens/`. El servidor descarta cualquier otra ruta.

**`.mesa-personaje`** (cliente → «📤 Exportar personaje»): un .zip con `personaje.json` (`{formato: "mesa-de-rol/personaje", version: 1, campana, servidor, usuario,
personaje: {…la ficha tal como la guarda el servidor…}}`) y `archivos/<ruta>` con sus imágenes. El Editor lo importa en «Jugadores y fichas → 📥 Importar personaje…»
como ficha del usuario elegido, con todos sus datos (estadísticas, recursos, nivel, dinero, inventario y objetos equipados, historia, personalidad,
anotaciones propias, campos de ficha) y sus imágenes (token, biografía y la imagen propia de un personaje transformado). Se valida igual que una
ficha hecha a mano (estadísticas, recursos, grupos, habilidades y objetos deben existir en la campaña; si no, no se importa nada).
Si ese usuario ya tiene una ficha con el mismo nombre, el Editor pregunta: **Actualizar la ficha** (la sustituye entera por la del archivo y conserva
su id, así la partida sigue reconociendo al personaje y a su token) o **Importar como copia** («Thor (2)»). Las imágenes que la campaña ya tiene
(el mismo archivo) se reutilizan; las demás se copian a `base/tokens/importados/<nombre>/` (al reimportar, una imagen idéntica no se duplica).
