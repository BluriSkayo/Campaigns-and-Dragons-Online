# SOLID: problemas encontrados y cómo arreglarlos sin tocar la estructura

Medido sobre el código (24-oct-2026). Nada de esto rompe nada hoy; son los puntos donde la forma actual hace fácil equivocarse.
Orden de abajo: de más barato y más útil a más grande. Hecho hasta ahora: la guardia de la sección 3 y las mejoras baratas de la sección 2.

## 1. S — una clase hace demasiado
- `EstadoPartida`: 136 métodos, 2.219 líneas (tokens, combate, chat, dibujos, niebla, día/noche/clima, personajes, persistencia).
  `Servidor`: 102 métodos, 1.114 líneas. En el cliente, `mapa.js` tiene 1.109 líneas y `principal.js` 558.
- **Arreglo:** ya existe el patrón (`ComercioMixin`, `CofresMixin`). Sacar por temas a archivos propios sin cambiar la API pública:
  `dibujos.py` (el más aislado: ya tiene `recortar_trazo`), `chat.py`, `ambiente.py` (periodo, clima, música, niebla), `persistencia.py`.
  Mismo criterio para `Servidor` (el diccionario de acciones ya permite repartir los manejadores) y para `mapa.js` (capa de dibujos, niebla, herramientas).

## 2. O — añadir algo obliga a editar muchos sitios
- Añadir el **clima** exigió tocar 14 puntos en 9 archivos. Dos causas:
  - `motor._condicion` es una cadena de 11 `if t == "…"`, y el catálogo (`efectos.py`), la validación y el texto descriptivo están en otros sitios.
  - Cada dato de la partida (momento del día, clima, música…) se guarda y se carga a mano en tres lugares (`vista`, `guardar_estado`, `cargar_estado`).
- **Arreglo barato (hecho, sin cambiar comportamiento):**
  1. Registro de condiciones: `@condicion("clima")` en `motor.py` (`CONDICIONES`); `_condicion` solo busca en la tabla. Lo mismo para las acciones (`ACCIONES_ACTIVAS`).
     Una prueba (`test_arquitectura.py`) falla si el catálogo del Editor y los manejadores del motor dejan de coincidir.
  2. Los datos simples de la partida (música, ambiente, momento del día, clima, niebla) se guardan y cargan desde una tabla (`_campos_simples`):
     un dato nuevo es una fila, no tres sitios. Hay una prueba de guardado y otra de datos corruptos.
  3. `_validar_velos` unifica la validación de «momentos del día» y «climas».
  4. En el Editor, `construirCampo` pasó de un `switch` de 30 casos a la tabla `CAMPOS`.
  Lo que sigue sin tabla: la carga de tokens, combate, tiendas y chat, que valida con reglas propias de cada uno.

## 3. L — contratos implícitos entre mixins (con un fallo real)
- Los mixins usan `self.cfg`, `self.tokens`, `self.guardar_estado()` sin declararlo, y comparten un solo espacio de nombres:
  si dos definen el mismo nombre, el primero tapa al otro **sin avisar**. Ya pasó: `EstadoPartida.grupo_activo` tapó una propiedad
  nueva de `CofresMixin` y el interruptor «sin inventario de grupo» no hacía nada.
- **Arreglo:** (hecho) `tests/test_arquitectura.py` falla si dos clases de `EstadoPartida` definen el mismo nombre, y comprueba que lo guardado se carga.
  Pendiente, opcional: un `Protocol` que documente qué espera cada mixin de su anfitrión.

## 4. I — todos conocen la forma completa de la configuración
- 56 accesos directos a `self.cfg["juego"][…]` en 4 archivos; cada módulo depende de la estructura entera del `config.yaml`.
- **Arreglo gradual:** una `@property` por apartado (`self.reglas_combate`, `self.reglas_clima`…) y usarla en el código nuevo; se migra lo viejo al tocarlo.
  En el Editor, `window.editor` expone ~60 funciones en un solo objeto: agruparlas por área (`editor.servidor.*`) si crece.

## 5. D — la partida escribe en disco directamente
- `EstadoPartida` llama 35 veces a `guardar_estado()` y escribe YAML por su cuenta; para probarla hay que pasar `persistir=False`.
  (Sí inyecta `rng`, que es el ejemplo a seguir.)
- **Arreglo:** inyectar un `Almacen` con `guardar(nombre, datos)` y `cargar(nombre)`: `AlmacenYaml` por defecto y `AlmacenVacio` para pruebas.
  Las 35 llamadas no cambian; solo se reemplaza `_volcar`.

## Qué haría primero
La 3 y la 2 ya están. Lo siguiente sería sacar `dibujos.py` (sección 1). Las demás cuando duelan.
