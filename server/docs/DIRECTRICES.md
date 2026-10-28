# Directriz de desarrollo: personalización profunda

> Acordada con el usuario el 22-oct-2026 (a partir de una propuesta externa, revisada). Léela antes de añadir una función importante.

## Los dos pilares (van juntos)
1. **Libertad para crear cualquier cosa.** Cada campaña debe poder tener sus propias reglas y mecánicas —jugar a algo parecido a D&D, a La llamada de Cthulhu o a un sistema inventado— desde el Editor, sin programar ni tocar archivos.
2. **Intuitividad.** Todo se configura con controles visuales y lenguaje natural; la complejidad técnica queda oculta.

No son opuestos: el objetivo es equilibrarlos. Regla práctica: **piezas pequeñas que se combinan** (cuándo + solo si + entonces), que se leen como una frase, en vez de un lenguaje de programación visual. Nada de bucles, variables sueltas ni lógica anidada si una pieza simple lo resuelve.

## Principios
1. **Por campaña:** lo personalizado pertenece a una campaña y no afecta a otras.
2. **Visual:** toda función para el usuario se configura en el Editor.
3. **Reutilizar:** antes de programar una mecánica concreta (p. ej. «crafteo»), buscar la pieza genérica que la resuelva junto con otras (p. ej. «acciones de campaña: consume X → produce Y si se cumple Z»).
4. **Componer:** estadísticas, recursos, condiciones, disparadores, efectos, objetos, estados y terreno deben poder combinarse cuando tenga sentido.
5. **Extensible:** acciones, condiciones y disparadores nuevos se añaden en un catálogo (`mesa/efectos.py`) y aparecen solos en el Editor.
6. **Seguro:** ninguna regla configurable ejecuta código, salta permisos ni deja al cliente cambiar el estado del servidor. El servidor valida todo.
7. **Claro:** errores comprensibles, que señalen el recurso y el campo.
8. **Compatible:** las campañas existentes siguen funcionando igual.

## Preguntas antes de implementar
- ¿Qué posibilidades creativas nuevas da al GM?
- ¿Se puede resolver combinando lo que ya existe?
- ¿Crea una limitación que obligue a programar en el futuro?
- ¿Se puede configurar (y idealmente probar) desde el Editor?
- ¿Qué pasa si la configuración es incorrecta o cita algo que no existe? (debe avisar, nunca romper la partida)
- ¿Cómo quedan la seguridad, los permisos, el guardado y la compatibilidad?

## Método
- Revisar `DECISIONES.md`, `ARQUITECTURA.md` y `ESQUEMA.md` antes de una función importante.
- Explicar ventajas, costes y riesgos antes de un cambio grande de arquitectura, y preguntar al usuario.
- Cada función: pruebas, validación de la configuración, documentación y comprobación de que la campaña de ejemplo sigue cargando.

## Criterio de éxito
Dos campañas deben poder diferenciarse por sus **reglas y mecánicas**, no solo por sus estadísticas, objetos y mapas, usando solo el Editor.

## Próximas piezas genéricas (propuestas, en orden)
1. ✅ Condiciones en los efectos («Solo si…»).
2. ✅ Fórmulas ampliadas: funciones, comparaciones, tablas por tramos y valores propios de las habilidades.
3. ✅ Etiquetas con tabla de ventajas (tipos/elementos: «A contra B → ×1,5»), también para NPC y estados.
4. ✅ Contadores: estadísticas no repartibles, «al derrotar» / «al ser derrotado», «sumar a una estadística», recursos que empiezan vacíos y reglas automáticas de la campaña.
5. ✅ Grupos que dependen de otra elección (solo para cierto tipo de ficha) e iniciativa por opción.
6. ✅ Objetos con efectos al usarlos (quitar/aplicar estados, sumar…), acción «Quitar un estado» y disparador «al cambiar el momento del día».
7. ✅ Compañeros: son personajes o NPC normales; los tokens cambian de tamaño y se agrupan para moverse juntos (como en Roll20). Inventarios de grupo (uno común y los que cree el GM).
8. ✅ Transformación (formas que van y vuelven, o evolución hacia delante).
9. **Acciones de campaña** (crafteo, cocinar, rituales…) — pendiente.
10. ✅ Campos de ficha personalizados y nombres de categorías propios.
11. ✅ Simulador en el Editor para probar habilidades con las reglas reales.
12. ✅ Pasabilidad por lados (vallas, mostradores, acantilados).
13. ✅ Archivos por campaña (zip manual del GM).
14. ✅ Turnos a mano y movimiento limitado por turno.
15. ✅ Niveles con experiencia de varios tipos o a decisión del GM.
16. ✅ Habilidades con área, alcance sin límite, varios golpes, daño según distancia, atraer/empujar, requisitos y efectos al alcanzar.
17. ✅ Estados que impiden y que encadenan, defensa activa, críticos, habilidades de solo efecto y opciones no elegibles.
18. ✅ Piezas para estados: redirigir el ataque, impedir la acción, «al recibir daño», «al cruzar un umbral», «al intentar», «al terminar», escudos, cargas, silencio por etiqueta, condiciones del golpe y plantillas de estados.

La lista sale de pruebas con campañas reales montadas solo con el Editor (ver `DECISIONES.md`).
