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

// Historial real: pila con índice; back() se resuelve DESPUÉS (como en un navegador) y dispara popstate.
function ventanaAsincrona() {
  const oyentes = [];
  const win = {
    pila: [{marca: false}], indice: 0, oyentes,
    addEventListener: (tipo, fn) => { if (tipo === 'popstate') oyentes.push(fn); },
    removeEventListener: (tipo, fn) => { const i = oyentes.indexOf(fn); if (i >= 0) oyentes.splice(i, 1); },
    history: {
      pushState: (estado) => { win.pila.splice(win.indice + 1); win.pila.push({marca: !!estado?.nodoAtras}); win.indice += 1; },
      back: () => setTimeout(() => { win.indice -= 1; oyentes.slice().forEach((fn) => fn()); }, 0),
    },
    // Lo que hace el usuario con el botón del navegador.
    atrasDelUsuario: () => new Promise((resolve) => setTimeout(() => {
      win.indice -= 1; oyentes.slice().forEach((fn) => fn()); resolve();
    }, 0)),
  };
  return win;
}
const esperar = () => new Promise((resolve) => setTimeout(resolve, 5));

test('Atrás del encabezado y un toque rápido a otra pantalla: la marca nueva sobrevive al popstate propio', async () => {
  const win = ventanaAsincrona();
  const llamadas = [];
  const guarda = crearGuardaWeb(win, {alAtras: () => llamadas.push('atras')});
  guarda.sincronizar(true);              // detalle: marca puesta
  assert.equal(win.pila.length, 2);
  guarda.sincronizar(false);             // flecha del encabezado: vuelve a la lista (back() queda en camino)
  guarda.sincronizar(true);              // toque rápido en otro relevamiento, antes del popstate propio
  await esperar();
  assert.deepEqual(llamadas, [], 'el retroceso propio no se toma como un Atrás del usuario');
  assert.equal(win.pila[win.indice].marca, true, 'la marca nueva está en el historial');
  assert.equal(win.indice, win.pila.length - 1);
  // Y el Atrás siguiente del usuario lo atiende la app, sin salir del sitio.
  await win.atrasDelUsuario();
  assert.deepEqual(llamadas, ['atras']);
  assert.equal(win.pila[win.indice].marca, false, 'queda en la entrada original de la página');
});

test('varios cambios seguidos de pantalla dejan a lo sumo una marca', async () => {
  const win = ventanaAsincrona();
  const guarda = crearGuardaWeb(win, {});
  for (const valor of [true, false, true, false, true, false]) guarda.sincronizar(valor);
  await esperar();
  assert.equal(win.indice, 0);
  guarda.sincronizar(true);
  assert.equal(win.pila[win.indice].marca, true);
});
