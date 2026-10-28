# Arquitectura

Tres programas independientes que comparten el **formato de campaña** (carpetas YAML):

```
        Editor (Electron)              Servidor (Python)             Cliente (Electron)
   crea/edita campañas  ──YAML──▶  carga campaña al arrancar  ◀──WebSocket──▶  juega
   abre, cierra y reinicia          aplica permisos y reglas        archivos en base/campanas/<id>/
   el servidor; valida con él       (no envía archivos)
        └──── .zip «Exportar archivos para los jugadores» (imágenes y sonidos) ────▶ el jugador lo importa
```

## Principios
1. **El servidor es la autoridad.** Valida cada acción y solo envía lo que cada usuario puede ver.
2. **El contenido vive solo en la campaña.** Nada de reglas o recursos escritos en el código.
3. **Personalización ante todo.** Estadísticas, grupos de elección (raza/clase/…), rasgos, estados y permisos los define el administrador.
4. **Esquemas declarativos.** `efectos.py` (y a futuro un esquema por tipo de recurso) describe campos y reglas de validación; servidor y Editor lo comparten para no duplicar lógica.
5. **Cambios del Editor se aplican al reiniciar el servidor** (el Editor avisa con «🟠 Reiniciar»).
6. **Los archivos no viajan por la red:** imágenes y sonidos se reparten con el .zip que exporta el Editor.

## Carpetas

```
campanas/<nombre>/   config.yaml, sonidos.yaml, campana.yaml (uid y orden de las listas), maps/, abilities/, items/, enemies/, shops/, groups/,
                     options/, traits/, states/, tiles/, journal/ y base/ (imágenes y sonidos)
data/<nombre>/       partida guardada (estado, jugadores)
server/              servidor Python (mesa/recursos.py, efectos.py, estado.py, servidor.py…)
../client/           cliente Electron (fuera de server/)
editor/              Editor del servidor (Electron)
docs/                ESQUEMA.md, PROTOCOLO.md, DECISIONES.md, este archivo
```

## Salas (varios mapas a la vez)
Cada mapa es una sala con sus propios tokens, combate, dibujos, capas ocultas y niebla (`EstadoPartida.salas[mapa]`). Las reglas siguen
escritas como si hubiera un solo mapa: `estado.tokens`, `estado.combate`… leen la **sala actual** (`estado.mapa_id`), y el servidor elige la
sala de cada sesión antes de atender su mensaje. Un cerrojo hace que cada mensaje se atienda entero (con sus envíos) antes del siguiente,
así la sala actual no cambia a mitad de una acción. Cada difusión de algo del mapa va solo a las sesiones de esa sala; lo de toda la mesa
(música, clima, momento del día, tiendas) va a todos. Ver «Salas» en `PROTOCOLO.md`.

## Modelo de personaje
`Personaje = estadísticas globales (de la campaña) + elecciones (una opción por grupo) + bonos de las opciones + rasgos + habilidades + inventario`.
Las razas/clases no tienen estadísticas propias, solo bonos.

## Seguridad (implementada)
- **Cuentas** (`data/<campaña>/cuentas.yaml`): contraseña opcional guardada con hash scrypt (`scrypt$N$r$p$sal$hash`, legible también desde Node para el Editor). Un nombre nuevo se registra al entrar si `seguridad.registro_abierto`; con `contrasena_obligatoria` hay que elegir contraseña.
- **Límite de intentos** por IP y por usuario (`max_intentos`, `bloqueo_segundos`).
- **Conexión cifrada** (`servidor.cifrado`, por defecto sí): `wss` + `https` con certificado propio creado en `data/<campaña>/tls/`. El cliente muestra la huella la primera vez, la recuerda y avisa si cambia. `ws://` delante de la dirección fuerza conexión sin cifrar. También se puede usar `certificado`/`clave` propios, o `cifrado: false` detrás de un proxy de hosting que ya cifre.
- **Recuérdame** (cliente): las contraseñas del usuario y del servidor se guardan cifradas con el almacén seguro del sistema (`client/credenciales.js`); la de GM nunca. El servidor no interviene.
- `password_gm` y `password_servidor` pueden ser hash (`python main.py --generar-hash`) o texto plano (con aviso).

## Hoja de ruta
1. ✅ Carpeta por campaña · ✅ grupos, opciones, rasgos, estados y efectos
2. ✅ Efectos y reparto de puntos en el servidor · ✅ cuentas con contraseña · ✅ `wss`
3. ✅ Editor: campañas, formularios, validación en vivo, reglas, mapas, sonidos, simulador, abrir y reiniciar el servidor
4. ✅ Cliente: dibujos, salas de chat, tiradas, menú contextual, sonidos, tiendas, intercambios, niebla, día/noche y clima
4b. ✅ Salas (varios mapas a la vez), hablar como personaje, barras y nombres configurables sobre los tokens
5. Pendiente: acciones de campaña (crafteo y similares), solo si se piden. El detalle de cada paso está en `DECISIONES.md`.
