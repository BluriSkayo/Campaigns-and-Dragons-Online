const test = require('node:test');
const assert = require('node:assert/strict');
const { nombreDeAudio } = require('../nombres');

test('el título del audio se respeta tal cual', () => {
  assert.equal(nombreDeAudio('/música/Taberna Baja.ogg'), 'Taberna Baja');
  assert.equal(nombreDeAudio('/música/Batalla Épica (final).MP3'), 'Batalla Épica (final)');
  if (process.platform === 'win32') assert.equal(nombreDeAudio('C:\\Sonidos\\Taberna Baja.ogg'), 'Taberna Baja');
  assert.equal(nombreDeAudio('/x/Tema 2 - Ñandú.wav'), 'Tema 2 - Ñandú');
});
test('solo se cambia lo que no vale en un archivo', () => {
  assert.equal(nombreDeAudio('/x/a:b*c?.ogg'), 'a_b_c_');
  assert.equal(nombreDeAudio('/x/uno..dos.ogg'), 'uno.dos');
  assert.equal(nombreDeAudio('/x/ .oculto .ogg'), 'oculto');
  assert.equal(nombreDeAudio('/x/' + 'a'.repeat(300) + '.ogg').length, 100);
});
test('nombres que Windows no admite', () => {
  assert.equal(nombreDeAudio('/x/CON.ogg'), 'CON_');
  assert.equal(nombreDeAudio('/x/nul.mp3'), 'nul_');
  assert.equal(nombreDeAudio('/x/' + 'a'.repeat(99) + ' b.ogg'), 'a'.repeat(99));     // sin espacio al final tras recortar
});
