// Navegación de Dispositivos: el botón Atrás (encabezado, Android y navegador) frena durante el
// envío, confirma con algo cargado y vuelve directo si no hay nada.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const renderer = require('react-test-renderer');
const {transformSync} = require('@babel/core');
global.IS_REACT_ACT_ENVIRONMENT = true;

const root = path.join(__dirname, '..');

function cargar(relative, mocks) {
  const filename = path.join(root, relative);
  const context = vm.createContext({console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Date});
  const dir = path.dirname(filename);
  const load = (file) => {
    const {code} = transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file, babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
    const module = {exports: {}};
    vm.runInContext('(function(require,module,exports){' + code + '\n})', context)(name => {
      const key = name.startsWith('.') ? path.relative(dir, path.join(path.dirname(file), name)).split(path.sep).join('/') : name;
      assert.ok(mocks[key], 'Missing mock: ' + key);
      return mocks[key];
    }, module, module.exports);
    return module.exports;
  };
  return load(filename).default;
}

async function montar() {
  const captura = {toasts: [], alertas: [], atras: null, banner: null, lista: null, detalle: null, completar: null};
  const pantalla = (nombre) => (props) => { captura[nombre] = props; return null; };
  const mocks = {
    react: React,
    'react-native': {View: 'View', StyleSheet: {create: value => value}},
    '../services/conectividad': {escucharReconexion: () => () => {}},
    '../services/sincronizacionPeriodica': {repetirMientrasActiva: () => () => {}},
    '../context/AuthContext': {useAuth: () => ({user: {nombre: 'Ana'}, logout() {}})},
    '../context/ThemeContext': {useTheme: () => ({theme: {colors: new Proxy({}, {get: () => '#fff'})}})},
    '../context/ToastContext': {useToast: () => ({
      showToast: (valor) => captura.toasts.push(valor),
      showAlert: (...args) => captura.alertas.push(args),
    })},
    '../hooks/useBotonAtras': {__esModule: true, default: (opciones) => { captura.atras = opciones; }},
    '../components/Banner': {__esModule: true, default: (props) => { captura.banner = props; return null; }},
    '../components/CustomButton': {__esModule: true, default: () => null},
    '../components/SettingsPanel': {__esModule: true, default: () => null},
    '../screens/DispositivosListaScreen': {__esModule: true, default: pantalla('lista')},
    '../screens/DispositivoDetalleScreen': {__esModule: true, default: pantalla('detalle')},
    '../screens/DispositivoCompletarScreen': {__esModule: true, default: pantalla('completar')},
    '../services/dispositivosService': {
      getPendingCount: async () => 0, syncPendientes: async () => ({}), reintentarFallidas: async () => ({}),
    },
  };
  const App = cargar('src/navigation/DispositivosApp.js', mocks);
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(App, {})); });
  const act = (fn) => renderer.act(async () => { await fn(); });
  const titulo = () => captura.banner.title;
  // Lista -> detalle -> completar.
  await act(() => captura.lista.onAbrir(5));
  await act(() => captura.detalle.onCompletar(5));
  return {captura, act, titulo, close: () => act(() => tree.unmount())};
}

test('Atrás: el hook solo está activo fuera de la lista', async () => {
  const ui = await montar();
  try {
    assert.equal(ui.titulo(), 'Completar relevamiento');
    assert.equal(ui.captura.atras.activo, true);
    await ui.act(() => ui.captura.banner.onBackPress());
    assert.equal(ui.titulo(), 'Relevamiento');
    await ui.act(() => ui.captura.banner.onBackPress());
    assert.equal(ui.captura.atras.activo, false);
  } finally {await ui.close();}
});

test('Atrás durante el envío se bloquea con un aviso y no sale de Completar', async () => {
  const ui = await montar();
  try {
    await ui.act(() => ui.captura.completar.onEstado({cambios: true, enviando: true}));
    await ui.act(() => ui.captura.atras.alAtras());
    assert.equal(ui.titulo(), 'Completar relevamiento');
    assert.equal(ui.captura.toasts.length, 1);
    assert.match(ui.captura.toasts[0].message, /Se está enviando/);
    assert.equal(ui.captura.alertas.length, 0);
    // También con la flecha del encabezado.
    await ui.act(() => ui.captura.banner.onBackPress());
    assert.equal(ui.titulo(), 'Completar relevamiento');
    assert.equal(ui.captura.toasts.length, 2);
  } finally {await ui.close();}
});

test('Atrás con algo cargado pide confirmar; «Salir» vuelve y «Seguir cargando» no', async () => {
  const ui = await montar();
  try {
    await ui.act(() => ui.captura.completar.onEstado({cambios: true, enviando: false}));
    await ui.act(() => ui.captura.atras.alAtras());
    assert.equal(ui.titulo(), 'Completar relevamiento');
    assert.equal(ui.captura.alertas.length, 1);
    const [titulo, mensaje, botones] = ui.captura.alertas[0];
    assert.equal(titulo, '¿Salir sin enviar?');
    assert.match(mensaje, /borrador/);
    assert.deepEqual([...botones.map(boton => boton.text)], ['Seguir cargando', 'Salir']);
    assert.equal(ui.captura.toasts.length, 0);
    await ui.act(() => botones[1].onPress());
    assert.equal(ui.titulo(), 'Relevamiento');
  } finally {await ui.close();}
});

test('Atrás sin nada cargado vuelve directo, sin confirmar ni avisar', async () => {
  const ui = await montar();
  try {
    await ui.act(() => ui.captura.completar.onEstado({cambios: false, enviando: false}));
    await ui.act(() => ui.captura.atras.alAtras());
    assert.equal(ui.titulo(), 'Relevamiento');
    assert.equal(ui.captura.alertas.length, 0);
    assert.equal(ui.captura.toasts.length, 0);
  } finally {await ui.close();}
});

test('Atrás: si el envío arranca entre el toque y «Salir», no sale ni deja el envío a medias', async () => {
  const ui = await montar();
  try {
    await ui.act(() => ui.captura.completar.onEstado({cambios: true, enviando: false}));
    await ui.act(() => ui.captura.atras.alAtras());
    assert.equal(ui.captura.alertas.length, 1);
    const botones = ui.captura.alertas[0][2];
    // El envío arranca mientras el diálogo sigue abierto.
    await ui.act(() => ui.captura.completar.onEstado({cambios: true, enviando: true}));
    await ui.act(() => botones[1].onPress());
    assert.equal(ui.titulo(), 'Completar relevamiento');
    assert.equal(ui.captura.toasts.length, 1);
    assert.match(ui.captura.toasts[0].message, /Se está enviando/);
    assert.equal(ui.captura.alertas.length, 1, 'no se duplica el diálogo');
  } finally {await ui.close();}
});
