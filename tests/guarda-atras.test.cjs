const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {transformSync} = require('@babel/core');

const {code} = transformSync(fs.readFileSync(path.join(__dirname, '..', 'src/navigation/guardaAtras.js'), 'utf8'), {
  babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs']});
const modulo = {exports: {}};
vm.runInNewContext('(function(module,exports){' + code + '\n})', {})(modulo, modulo.exports);
const {crearGuardaWeb} = modulo.exports;

// Ventana mínima con historial: pushState suma una entrada; back() quita una y dispara popstate.
function ventana() {
  const oyentes = [];
  const win = {
    entradas: 1,
    addEventListener: (tipo, fn) => { if (tipo === 'popstate') oyentes.push(fn); },
    removeEventListener: (tipo, fn) => { const i = oyentes.indexOf(fn); if (i >= 0) oyentes.splice(i, 1); },
    history: {
      pushState: () => { win.entradas += 1; },
      back: () => { win.entradas -= 1; oyentes.slice().forEach((fn) => fn()); },
    },
    oyentes,
  };
  return win;
}

test('con una pantalla anterior deja una marca; Atrás la consume y avisa a la app', () => {
  const win = ventana();
  const llamadas = [];
  const guarda = crearGuardaWeb(win, {alAtras: () => llamadas.push('atras'), alCambiar: () => llamadas.push('cambio')});
  guarda.sincronizar(true);
  assert.equal(win.entradas, 2);
  win.history.back();
  assert.deepEqual(llamadas, ['atras', 'cambio']);
  assert.equal(win.entradas, 1, 'la marca se consumió y el navegador no salió de la página');
  // La app sigue en una pantalla interna: se vuelve a marcar.
  guarda.sincronizar(true);
  assert.equal(win.entradas, 2);
});

test('sincronizar es idempotente y no apila marcas', () => {
  const win = ventana();
  const guarda = crearGuardaWeb(win, {});
  guarda.sincronizar(true); guarda.sincronizar(true); guarda.sincronizar(true);
  assert.equal(win.entradas, 2);
});

test('al volver con el botón de la app se quita la marca sin llamar a alAtras', () => {
  const win = ventana();
  const llamadas = [];
  const guarda = crearGuardaWeb(win, {alAtras: () => llamadas.push('atras'), alCambiar: () => llamadas.push('cambio')});
  guarda.sincronizar(true);
  guarda.sincronizar(false);
  assert.equal(win.entradas, 1);
  assert.deepEqual(llamadas, []);
  // Un Atrás posterior del usuario ya no lo atiende la app.
  win.history.back();
  assert.deepEqual(llamadas, []);
});

test('en la pantalla inicial no hay marca: Atrás es del sistema', () => {
  const win = ventana();
  const llamadas = [];
  const guarda = crearGuardaWeb(win, {alAtras: () => llamadas.push('atras')});
  guarda.sincronizar(false);
  assert.equal(win.entradas, 1);
  win.history.back();
  assert.deepEqual(llamadas, []);
});

test('liberar suelta el oyente y no toca el historial', () => {
  const win = ventana();
  const llamadas = [];
  const guarda = crearGuardaWeb(win, {alAtras: () => llamadas.push('atras')});
  guarda.sincronizar(true);
  guarda.liberar();
  assert.equal(win.oyentes.length, 0);
  assert.equal(win.entradas, 2);
  win.history.back();
  assert.deepEqual(llamadas, []);
});
