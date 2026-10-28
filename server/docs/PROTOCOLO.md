# Protocolo cliente ↔ servidor

WebSocket cifrado en `wss://HOST:puerto` (por defecto; `ws://` solo si el servidor tiene `servidor.cifrado: false`). Cada mensaje es un JSON con el campo `tipo`.
Los errores llegan como `{"tipo": "error", "texto": "..."}` (el texto se puede mostrar tal cual).
Límite de mensaje: 64 KB. **El servidor no envía archivos**: imágenes y música de cada campaña viven en `campanas/<id>/base/` (el Editor las exporta en un .zip y cada cliente las importa en `base/campanas/<id>/`)
(`tokens/`, `maps/`, `icons/`, `tiles/`, `otros/`, `sonido/musica`, `sonido/ambiente`, `sonido/efectos`); en los recursos solo aparece la ruta (p. ej. `tokens/goblin.png`).

## Flujo normal

1. `entrar` → el servidor responde `bienvenida` y `estado`.
2. Si `personajes` está vacío → mostrar el creador; si no → selector de personaje.
3. `crear_personaje` → `personajes`.  `elegir_personaje` → `personaje_activo` y `estado`.
4. Durante la partida el servidor envía `tokens`, `combate`, `chat`, `musica`.

## Cliente → servidor

| tipo | campos | quién |
|---|---|---|
| `entrar` | `usuario`, `password?`, `password_servidor?`, `password_gm?` | todos (con `password_gm` correcta se entra como GM) |
| `pedir_estado` | — | todos |
| `crear_personaje` | `base` (ID de plantilla), `nombre`, `historia?` | según `permisos.crear_personajes` |
| `elegir_personaje` | `personaje` (ID) | todos |
| `chat` | `texto` (si empieza por `/`, se interpreta como dados: `/2d6+1`) | todos |
| `tirar_dado` | `expresion` (p. ej. `1d20+3`) | todos |
| `mover_token` | `token`, `x`, `y` | dueño o GM |
| `usar_habilidad` | `token`, `habilidad`, `objetivo?` | dueño o GM |
| `usar_objeto` | `token`, `objeto`, `objetivo?` (otro token a `permisos.alcance_objetos` casillas; el GM sin límite) | dueño o GM |
| `dar_objeto` | `token`, `a` (token cercano), `objeto`, `cantidad` (1–999) | dueño (si `permisos.dar_objetos`) o GM |
| `terminar_turno` | — | dueño del token en turno, o GM |
| `reproducir_musica` | `archivo` (nombre de un archivo de la lista `musica` de `sonidos.yaml`, o `null` para parar), `gradual` (opcional, solo al parar: fundido de 3 s) | según `permisos.musica` |
| `sonido_ambiente` | `archivo` (de la lista `ambiente`; `null` apaga todos), `activo` (true/false) | solo el GM |
| `sonido_efecto` | `archivo` (de la lista `efectos`) | solo el GM |
| `editar_personalidad` | `personaje`, `rasgos` (lista, máx. 8 de 1–30 caracteres) | dueño del personaje si `permisos.rasgos_personalidad`; el GM siempre |
| `golpear_casilla` | `x`, `y`, `token` (el que golpea) · el GM puede añadir `romper: true` | GM, o jugadores si `permisos.romper_casillas: todos` (junto a la casilla, en su turno) |
| `gm_colocar_enemigo` | `enemigo` (ID del NPC), `x`, `y` | GM |
| `gm_quitar_token` | `token` | GM |
| `gm_iniciar_combate` | — | GM |
| `gm_terminar_combate` | — | GM |
| `gm_cambiar_mapa` | `mapa` (ID) | GM |

## Servidor → cliente

**`bienvenida`** — tras `entrar`
```json
{"tipo":"bienvenida","version":"0.1.0",
 "servidor":{"nombre":"..."},
 "usuario":"Ana","es_gm":false,
 "permisos":{"gm":false,"mover_tokens_ajenos":false,"crear_personajes":true,"controlar_musica":false,
             "colocar_enemigos":false,"quitar_tokens":false,"controlar_combate":false,"cambiar_mapa":false, "...":true},
 "catalogo":{"estadisticas":[...],"recursos":[...],"recurso_vida":"HP",
             "habilidades":{id:{...}},"objetos":{id:{...}},"personajes_base":{id:{...}},"tiles":{id:{"nombre","descripcion","color","imagen","invisible","transitable","esconde","bloquea_lados","rompible":{"golpes"}|null}},   // invisible: el cliente no lo dibuja; a los jugadores les llega sin color ni imagen
             "enemigos":{...},"mapas":{id:{"nombre","ancho","alto"}}},   // estas dos solo para el GM
 "personajes":[ {id,nombre,base,imagen,historia,stats,recursos,habilidades,inventario}, ... ]}
```
El cliente **habilita solo lo que indique `permisos`**.

**`estado`** — foto completa **de la sala que ve ese usuario** (tras entrar, elegir personaje, cambiar de sala, o cuando el GM enciende o apaga la niebla)
```json
{"tipo":"estado","mapa_id":"aldea","mapa":{...recurso de mapa completo...},"salas_mapa":[...],
 "tokens":[...],"combate":{...},"chat":[...],"musica":null}
```

**`tokens`** — cambios incrementales: `{"tipo":"tokens","tokens":[...],"quitados":["id"]}`
Cada token:
```json
{"id":"a1b2c3d4","tipo":"personaje|enemigo","bando":"jugador|aliado|neutral|enemigo","nombre":"Thor","imagen":"","x":3,"y":5,
 "dueno":"Ana","derrotado":false,
 "recursos":{"HP":{"actual":80,"max":100}},
 "stats":{...},"habilidades":[...],"inventario":[...]}   // stats/habilidades/inventario solo si es tuyo (o eres GM)
```
De los tokens ajenos solo se envía el recurso de vida.

**`combate`** — `{"tipo":"combate","activo":true,"orden":["id",...],"indice":0,"ronda":1,"turno_de":"id"}`

**`chat`** — `{"tipo":"chat","autor":"Ana","texto":"...","categoria":"normal|sistema|dado|combate"}`

**`musica`** — `{"tipo":"musica","archivo":"taberna.mp3","gradual":false}` (`archivo: null` = parada; `gradual` solo se usa al parar)

**`ambiente`** — `{"tipo":"ambiente","activos":["lluvia.ogg"]}`: los sonidos de ambiente que suenan ahora (también viaja en el estado inicial). **`efecto`** — `{"tipo":"efecto","archivo":"trueno.wav"}`: suena una vez. Los oyen todos los clientes que tengan el archivo; el servidor nunca envía audio.

**`conectados`** (solo GM) — `{"tipo":"conectados","mapa":..,"usuarios":[{"usuario","es_gm","personajes"}]}`; se reenvía al entrar, salir o desplegar/retirar personajes.

**Catálogo:** además de lo anterior incluye `sonidos` (`{musica|ambiente|efectos: [{categoria, archivos}]}`; los jugadores solo reciben `musica`), `dados` (lista de caras) y `reglas` (reglas públicas de la mesa para la ventana «Reglas»).

**`casilla`** — `{"tipo":"casilla","x":5,"y":6,"tile":"hierba","golpes":0}`: una casilla cambió (se rompió o resiste un golpe). El mapa del `estado` trae `celdas` (alto × ancho de ids de tile; `""` = suelo libre).

Los tokens sobre un tile que `esconde` no se envían a quien no sea el GM o su dueño; si se meten ahí, ese usuario los recibe en `quitados`.

**`personajes`** — lista de tus personajes (+ `creado` con el ID del nuevo, si procede)

**`personaje_activo`** — `{"personaje":"id","token":"id"}`

## Reglas que aplica el servidor (el cliente no necesita replicarlas)

- Casillas: se rechaza mover a muros, objetos que bloquean, casillas ocupadas o fuera del mapa.
- Distancia: la diagonal cuenta como 1 casilla (distancia de Chebyshev).
- Durante un combate con `acciones_solo_en_su_turno`, solo actúa el token en turno (el GM siempre puede).
- Iniciativa: `1d20 + estadistica_iniciativa`; los derrotados se saltan. Si el token en turno cae, el turno avanza solo.
- El combate termina solo si queda menos de 2 participantes.

## Acciones de GM añadidas

- `gm_estado` — `{"tipo":"gm_estado","token":"id","estado":"veneno","poner":true}`: el GM pone (con su duración) o quita un estado a cualquier token en plena partida.
- `gm_editar_token` — `{"tipo":"gm_editar_token","token":"id","nombre":"…","stats":{"Fuerza":12},"recursos":{"HP":{"actual":5,"max":50}}}`.
  Todos los campos son opcionales. Se valida todo antes de aplicar (rangos de la campaña, máximo de vida ≥ 1, actual entre 0 y máximo); si algo es inválido no cambia nada.
- `gm_objeto` — `{"tipo":"gm_objeto","token":"id","objeto":"pocion","cantidad":2}`. Cantidad positiva = dar, negativa = quitar (si se quita de más, se vacía).
- `gm_combate_turnos` — `{"tipo":"gm_combate_turnos","token":"id","dentro":true|false}`: el GM mete a un token en los turnos (en su sitio
  según la iniciativa del combate: tira o mira su estadística; con orden a mano, al final) o lo saca (sigue en el mapa; si era su turno, pasa al
  siguiente; con menos de 2, el combate termina). También mientras se deciden los turnos.
- Estados en los tokens: `estados: [{id, turnos, cargas?}]` (`cargas` solo si un estado acumulado lleva más de una).
- `gm_habilidad` — `{"tipo":"gm_habilidad","token":"id","habilidad":"bola_de_fuego","poner":true}`: da (`true`) o quita (`false`) una habilidad.
  En un personaje cambia su ficha (su dueño recibe `personajes`); en un NPC, solo ese token. El aviso del chat solo lo reciben el GM y quien maneja el token.

## Cuentas, cifrado y acciones añadidas (paso 2)

- Transporte: `wss://host:puerto` (por defecto) o `ws://` si el servidor tiene `cifrado: false`.
- `entrar` puede responder `error` con `codigo`: `bloqueado`, `password_requerida`, `password_incorrecta`, `password_nueva_requerida`, `usuario_no_registrado`, `password_servidor_incorrecta`, `password_gm_incorrecta`. En el primer registro, `password` es la contraseña elegida.
- `bienvenida` incluye `cuenta: {tiene_password}`.
- `cambiar_contrasena` — `{nueva, actual?}` (`actual` obligatoria si ya había). Responde `{"tipo":"cuenta","tiene_password":true}`.
- `desplegar_personaje` — `{personaje, usuario?, x?, y?}`; `retirar_personaje` — `{token}`. El GM puede indicar usuario y casilla.
- `gm_listar_personajes` → `todos_los_personajes` `{personajes}`.
- `repartir_puntos` — `{token, reparto:{Estadística:n}}` (jugador solo si `editar_stats_jugador`; el GM siempre). `gm_dar_puntos` — `{token, cantidad}`.
- `tirar_estadistica` — `{token, estadistica}`; usa `juego.tirada_estadistica` (por defecto `1d20 + [a.{estadistica}]`).

## Cambios posteriores
- `crear_personaje`: `base` (plantilla) ya es **opcional** y el cliente no la envía. Sin plantilla, el personaje nace con el `valor_inicial` de cada estadística, los recursos `maximo_inicial` de la campaña, y las habilidades que den sus elecciones. En la creación el propio jugador reparte los puntos (`reparto`); `editar_stats_jugador` solo decide si puede repartir los que gane después.
- `elegir_personaje` **no despliega** el personaje: responde `personaje_activo` con `token: null` si no está en el mapa. Se despliega con `desplegar_personaje` (tras lo cual el dueño recibe `personaje_activo` y un `estado` nuevo).


**NPC y bandos.** Internamente `tipo: "enemigo"` significa «NPC» (no jugador); su postura va en `bando` (`aliado`, `neutral` o `enemigo`; los personajes de jugadores llevan `jugador`). `gm_editar_token` acepta `bando` para un NPC. Con `permisos.npc_para_jugadores` (o `sin_ficha`), también `controlado_por` (nombre de un jugador, o `null` = solo el GM): ese jugador controla el NPC como a su personaje (mover, actuar, ver su ficha y lo que ve) y el token llega con `controlado_por`. Con `permisos.sin_ficha`, `gm_editar_token` acepta además `dueno` (nombre de un usuario con cuenta o conectado) en el token de un personaje: la ficha pasa a la lista de ese usuario, el token es suyo, los dos reciben `personajes` y el chat lo anuncia; si ya tiene un personaje con ese nombre, se rechaza. En `permisos` llegan `sin_ficha` (el jugador puede entrar sin personaje) y `npc_para_jugadores` ya combinado con él. En `permisos` llega `modo_ataque` (a quién puede atacar este usuario: la regla de la mesa o su límite propio) y en `catalogo.reglas`, `atacar`.

## Visibilidad, dibujos, dinero, salas, sonidos, tiendas e intercambios
Visibilidad: `gm_revelar {token, campos}` (campos: estadisticas, recursos, inventario, habilidades, ficha). Sin revelar, un token ajeno solo muestra su vida. `permisos.editar_fichas` indica si este usuario puede editar sus fichas.
Regla y dibujos: `regla {puntos|null}` (se reenvía a los demás, ~25/s máx.); `dibujar {color, grosor?, puntos}` (grosor 1–24 px, por defecto 4), `borrar_dibujo {ids}`, `borrar_zona {centros, radio}` (el borrador: `centros` = recorrido en casillas, hasta 120 puntos; `radio` 0,1–3 casillas; el servidor recorta los trazos propios —el GM, todos— y responde con `dibujos_borrados` y un `dibujo` por cada trozo que queda), `gm_borrar_dibujos {usuario?}`, `gm_bloquear_dibujo {activo}` → `dibujo`, `dibujos_borrados`, `dibujo_bloqueo`. Cada sala tiene sus propios dibujos (solo los reciben quienes están en ella); no se guardan al cerrar el servidor.
Dinero, día/noche y clima: `gm_dinero {token, cantidad}`, `gm_periodo {indice}` → `periodo`, `gm_clima {indice}` → `clima` (solo si `juego.clima.activo`).
Salas de chat: `gm_sala_crear/editar/borrar`, `chat {texto, sala}` → `salas`, `sala_creada`, `chat_sala_borrada`.
`gm_limpiar_chat {sala?}` (solo GM; por defecto la sala general): vacía el chat de esa sala para todos → `chat_sala_borrada {sala}` (cada cliente la vacía) y un aviso «🧹 El GM limpió el chat.».
Sonidos de personaje: `gm_sonidos_token {token, sonidos}`; `sonido_personaje {token, archivo}` (solo si `permisos.sonidos_personaje`) → `efecto`.
Tiendas: `gm_tienda_abrir {tienda, abierta, reponer?}`, `comprar {tienda, objeto, cantidad}`, `vender {...}` → `tiendas {tiendas:[{id,nombre,recompra,articulos:[{objeto,precio,stock|null}]}]}`. El estado inicial también trae `tiendas`.
Intercambios (solo si `permisos.intercambios`): `intercambio_proponer {con}`, `intercambio_ofrecer {items:{objeto:n}, dinero}`, `intercambio_aceptar {acepto}`, `intercambio_cancelar` → `intercambio {id, partes:[{usuario,nombre,items,dinero,acepto}]}` e `intercambio_fin {motivo: completado|cancelado, por?}`. Cambiar la oferta quita las dos aceptaciones; al desconectarse uno se cancela.
Anotaciones propias: `editar_propias {personaje, que: "habilidades"|"objetos", lista:[{nombre, descripcion, cantidad?}]}` (si `permisos.habilidades_propias` / `objetos_propios`, o GM; máx. 30). El token trae `habilidades_propias` / `objetos_propios` según la visibilidad de habilidades / inventario.
Ping: `ping {x, y}` (casilla; 1 por segundo; si `permisos.ping`) → `ping {usuario, x, y}` a todos. No se guarda.
Capas: el mapa que llega trae `capa2` y `capa3` (rejillas de ids de tile; '' = vacío). `gm_capa {capa: 2|3, visible}` → `capas {ocultas:[…]}` a todos (el estado inicial trae `capas_ocultas`). Los jugadores no dibujan las capas ocultas; el GM las ve tenues. Cada sala tiene las suyas.
Niebla de guerra: el estado inicial trae `niebla` (filas de '1' = se ve, '0' = niebla; `null` = sin niebla, siempre para el GM) y `niebla_activa`. Cuando cambia lo que ve un jugador llegan `niebla {mascara}` y los `tokens` que aparecen (y `quitados` los que salen de su vista). El servidor no envía a un jugador los tokens que no ve. `gm_niebla {activa}` la enciende o apaga en plena partida (todos reciben un `estado` nuevo). `gm_ver_niebla {como}` es una ayuda visual solo para el GM que la pide: `como` = `"*"` (lo que ve todo el grupo), el nombre de un jugador con tokens en el mapa, o `null` (no verla). Responde `niebla {mascara, como}`; desde entonces su `estado` trae `niebla` y `niebla_gm`, y la máscara se le reenvía al moverse los tokens. No se guarda: vale para esa conexión. El cliente del GM la dibuja semitransparente.
Limitación conocida: el mapa completo (tiles y objetos) sigue enviándose a los clientes; la niebla oculta tokens en el servidor y tapa el resto en pantalla. Un cliente modificado podría leer el terreno. El orden de iniciativa solo nombra a los NPC que el jugador ve.

**Detalle de tiradas:** un mensaje `chat` de una tirada o una habilidad puede traer `detalle` (cada dado, cada suma) aparte de `texto` (qué se tiró y el resultado). El servidor solo lo envía al GM, o a todos si `juego.chat.detalle_tiradas`.

**Objetos rotos:** al golpear un objeto destruible llega `objetos_mapa {objetos}` (los objetos que siguen en pie del mapa actual). `usar_habilidad` acepta `casilla` también con una habilidad de daño de un objetivo si en esa casilla hay algo rompible.


## Salas (varios mapas a la vez)
Cada mapa es una sala con sus propios tokens, combate, niebla, capas ocultas y dibujos. Cada conexión ve una sala (el jugador, la de su
personaje activo; el GM, la que elija) y solo recibe lo de esa sala: `estado`, `tokens`, `combate`, `niebla`, `dibujo…`, `regla`, `lapiz`,
`ping`, `casilla`, `objetos_mapa`, `capas` y los sonidos de un personaje. Lo de toda la mesa (`musica`, `ambiente`, efectos del GM,
`periodo`, `clima`, `tiendas`, `salas`, `cofres`, `diario`) llega a todos. Todas las acciones ocurren en la sala de quien las pide.

- `cambiar_sala {mapa, token?}` — el GM pasa a ver esa sala (nadie se mueve; recibe `estado`). Un jugador se va a esa sala con su
  personaje activo (o el token suyo que diga) y su grupo: solo con `permisos.cambiar_sala: todos`, si la sala está abierta y fuera de combate.
  Sin token en el mapa, solo cambia lo que ve.
- `gm_mover_a_sala {token, mapa, x?, y?}` — el GM lleva un token (y su grupo) de la sala que ve a otra (junto al punto de inicio, o a esa casilla).
  En la sala de origen llega `tokens` con `quitados`; en la de destino, los tokens nuevos. El jugador que lo maneja se va con él si era su
  personaje activo (o ya no le queda nada suyo en la sala de origen): recibe `estado` y `personaje_activo`.
- `gm_sala_abierta {mapa, abierta}` — abre o cierra una sala a los jugadores que se mueven solos.
- `gm_cambiar_mapa {mapa}` — «Llevar a todos»: los personajes de los jugadores de **todas** las salas pasan a esa sala, que queda como
  principal (donde aparece quien entra sin personaje en el mapa), y todos los conectados pasan a verla. Los NPC se quedan en su sala.
- **`salas_mapa`** — `{"tipo":"salas_mapa","actual":"aldea","salas":[{id,nombre,abierta, …}]}`: la lista del panel «Salas» (también va en
  `estado.salas_mapa`). El GM recibe todas con `ancho`, `alto`, `principal`, `personajes`, `npc` y `combate`; un jugador, la suya y, si puede
  moverse solo, las abiertas.
- `conectados` trae `sala` en cada usuario; `todos_los_personajes` trae `sala` (dónde está desplegado cada personaje, o `null`).

**Chat por sala y hablar como personaje.** `chat {texto, sala?, como?}`: con `como` (id de un token propio de la sala; el GM, cualquiera)
el mensaje lo dice ese personaje: llega con `personaje: {nombre, imagen}` y `mapa`. Un mensaje con `mapa` es de esa sala (combate, efectos,
lo que dice un personaje, lo que hace un token): solo lo reciben quienes están en ella y el GM (y el historial de `estado` solo trae los de la
sala que se ve). Lo que se escribe como usuario y los avisos de toda la mesa no llevan `mapa`. En una sala de chat privada no se usa `mapa`.

## Barras y nombre sobre los tokens
`catalogo.sobre_tokens` = `visibilidad.sobre_tokens` de la campaña (`barras`, `barras_jugadores`, `barras_npc`, `nombre_jugadores`, `nombre_npc`).
Un token ajeno llega con `mostrar: {barras, nombre}` (si se dibujan sus barras y su nombre) y, si se ven sus barras, con los recursos de
`barras` (además de la vida). El GM recibe `mostrar_propio` si ese token tiene algo cambiado. `gm_mostrar_token {token, barras?, nombre?}`
(true/false; `null` = lo que diga la mesa) lo cambia en un token.
