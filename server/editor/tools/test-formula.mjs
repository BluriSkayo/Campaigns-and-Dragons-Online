// tools/test-formula.mjs — El revisor de fórmulas del Editor debe aceptar y rechazar lo mismo que el servidor (mesa/formulas.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisarFormula } from '../src/js/formula.js';

const N = ['Fuerza', 'Resistencia', 'Poder Mágico'];
const O = { tablas: ['Multiplicador'], valoresHabilidad: ['Potencia'] };
const BIEN = ['40', '[a.Fuerza] / 4 + 1d20', '[[a.Poder Mágico] - [o.Resistencia]] * 2', 'd20', '-[a.Fuerza]', '10 / 1.6', '10 / 1,6',
  'max(0; ([a.Fuerza] + [h.Potencia]/2 - [o.Resistencia]/1,6) * tabla(Multiplicador; 1d20) * 0,5)',
  'si(1d20 >= 15; 2; 1)', 'min(3;4;1)', 'redondear(2,5)', '[a.Fuerza] = 15', 'tabla( multiplicador ; 3)', 'si(1 <> 2; 1; 0)', 'abs(-3) + arriba(1,2) + abajo(1,8)', '([a.Fuerza] + 1d6) * ventaja()'];
const MAL = ['', 'max(1, 2)', 'si(1; 2)', 'tabla(Nada; 3)', '[h.Otra]', '1 < 2 < 3', 'exec(3)', '1 +', '(1', '[a.Inexistente]', '1000d6', 'hola', 'max()', 'x'.repeat(301), 'ventaja(2)', 'max()'];

test('fórmulas correctas', () => { for (const f of BIEN) assert.equal(revisarFormula(f, N, O), '', f); });
test('fórmulas incorrectas', () => { for (const f of MAL) assert.notEqual(revisarFormula(f, N, O), '', JSON.stringify(f)); });
test('[h.X] solo en habilidades', () => {
  assert.match(revisarFormula('[h.Potencia]', N), /solo se puede usar en la fórmula de una habilidad/);
  assert.equal(revisarFormula('[h.Potencia]', N, { valoresHabilidad: ['Potencia'] }), '');
});
