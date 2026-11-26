// «Stock» en la barra inferior de EmergenciaApp: el ítem solo está con `perfil.stock` en true; pestaña ->
// lista de pares -> saldo, Atrás en cada nivel y el módulo que deja de habilitar el stock. Las pantallas son
// stubs que capturan sus props: lo que se prueba es el cableado del router.
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
const native = Object.fromEntries(['View', 'Text', 'ScrollView', 'Pressable', 'ActivityIndicator', 'Image', 'TextInput',
  'RefreshControl'].map(name => [name, name]));
Object.assign(native, {Platform: {OS: 'android'}, StyleSheet: {create: value => value}});
const theme = {colors: new Proxy({}, {get: () => '#5059BC'})};
const typography = {bold: 'Manrope', medium: 'Manrope', semibold: 'Manrope', regular: 'Manrope'};
const esperar = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function loadApp(mocks) {
  const filename = path.join(root, 'src/navigation/EmergenciaApp.js');
  const {code} = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  const context = vm.createContext({console, setTimeout, clearTimeout, Date, setInterval: () => 0, clearInterval: () => {}});
  vm.runInContext('(function(require,module,exports){' + code + '\n})', context)(name => {
    assert.ok(mocks[name], 'Missing mock: ' + name);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

async function montarApp() {
  const p = {};
  const alerts = [];
  const toasts = [];
  const stub = nombre => props => { p[nombre] = props; return null; };
  const pantallas = {
    inicio: '../screens/EmergenciaInicioScreen', stockEdificios: '../screens/StockEdificiosScreen', stockSaldo: '../screens/StockSaldoScreen',
    plazas: '../screens/PlazasEdificiosScreen',
  };
  const mocks = {
    react: React, 'react-native': native,
    '../context/AuthContext': {useAuth: () => ({user: {nombre: 'Ana'}, logout() {}})},
    '../context/ThemeContext': {useTheme: () => ({theme, typography})},
    '../context/ToastContext': {useToast: () => ({showAlert: (...a) => alerts.push(a), showToast: t => toasts.push(t)})},
    '../components/Banner': {__esModule: true, default: 'Banner'},
    '../components/BottomNav': {__esModule: true, default: 'BottomNav'},
    '../screens/CuentaScreen': {__esModule: true, default: 'CuentaScreen'},
    '../hooks/useBotonAtras': {__esModule: true, default: () => {}},
    [pantallas.inicio]: {__esModule: true, default: stub('inicio')},
    [pantallas.stockEdificios]: {__esModule: true, default: stub('stockEdificios')},
    [pantallas.stockSaldo]: {__esModule: true, default: stub('stockSaldo')},
    [pantallas.plazas]: {__esModule: true, default: stub('plazas')},
    '../services/plazasApi': {normalizarMapa: mapa => mapa, getMapa: async () => null},
    '@react-native-community/netinfo': {__esModule: true, default: {addEventListener: () => () => {}}},
    '../services/emergenciaLimpieza': {depurarBorradoresFicha: async () => {}},
    '../services/emergenciaCola': {syncPendientes: async () => ({}), getPendingCount: async () => 0, getResumenPendientes: async () => ({}),
      reintentar: async () => ({}), getLocalidadesGuardadas: async () => ({localidades: []}), getBorradorEnCurso: async () => null, descartar: async () => true},
    '../utils/emergencia': {avisoDeSalida: () => null},
  };
  // Las pantallas que no son del módulo se montan como stub vacío: lo que importa son las de Stock e Inicio.
  for (const nombre of ['EmergenciaMisEnviosScreen', 'EmergenciaFormulario1Screen', 'EmergenciaMisDispositivosScreen', 'EmergenciaEntregasScreen',
    'EmergenciaRecibirEntregaScreen', 'EmergenciaLlegadaBuscarScreen', 'EmergenciaDerivacionScreen', 'EmergenciaIntegrantesScreen',
    'EmergenciaFichaScreen', 'EmergenciaCierreScreen', 'EmergenciaPuertaScreen', 'PlazasMapaScreen', 'PlazasEstadiasScreen',
    'PlazasEgresoScreen', 'PlazasCambioCamaScreen', 'PlazaAccionSheet']) {
    mocks['../screens/' + nombre] = {__esModule: true, default: () => null};
  }
  const modulo = loadApp(mocks);
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(modulo.default, {})); });
  const hacer = async fn => renderer.act(async () => { await fn(); await esperar(2); });
  const banner = () => tree.root.findByType('Banner');
  const barra = () => tree.root.findByType('BottomNav');
  const montada = nombre => tree.root.findAll(n => n.type === mocks[pantallas[nombre]].default).length > 0;
  return {p, alerts, toasts, hacer, montada, modulo, banner, barra,
    items: () => Array.from(barra().props.items, i => i.id + ':' + i.label),
    perfil: valor => hacer(() => p.inicio.onPerfil(valor)),
    pestana: id => hacer(() => barra().props.onTabPress(id)),
    atras: () => hacer(() => banner().props.onBackPress()), close: () => renderer.act(async () => tree.unmount())};
}

const PAR = {dispositivo: {id: 7, nombre: 'Sede Central'}, edificio: {id: 3, nombre: 'Edificio Alfa'}, insumos_con_saldo: 4, puede: {}};

test('Stock: con perfil.stock en false (o sin perfil) el ítem no está; con true aparece entre Inicio y Cuenta', async () => {
  const ui = await montarApp();
  try {
    assert.deepEqual(ui.items(), ['inicio:Inicio', 'cuenta:Cuenta'], 'sin perfil todavía');
    await ui.perfil({relevar: true, plazas: true, stock: false});
    assert.deepEqual(ui.items(), ['inicio:Inicio', 'cuenta:Cuenta']);
    await ui.perfil({relevar: true, plazas: true, stock: true});
    assert.deepEqual(ui.items(), ['inicio:Inicio', 'stock:Stock', 'cuenta:Cuenta']);
    await ui.perfil({relevar: true, plazas: true, stock: false});
    assert.deepEqual(ui.items(), ['inicio:Inicio', 'cuenta:Cuenta'], 'si el back lo saca, el ítem desaparece');
  } finally { await ui.close(); }
});

test('Stock: pestaña -> lista de pares -> saldo del par elegido; Atrás baja de a uno hasta el inicio', async () => {
  const ui = await montarApp();
  try {
    await ui.perfil({stock: true});
    await ui.pestana('stock');
    assert.ok(ui.montada('stockEdificios') && !ui.montada('inicio'));
    assert.equal(ui.banner().props.title, 'Stock');
    assert.equal(ui.banner().props.showBackButton, true);
    await ui.hacer(() => ui.p.stockEdificios.onElegir(PAR));
    assert.ok(ui.montada('stockSaldo') && !ui.montada('stockEdificios'));
    assert.equal(ui.banner().props.title, 'Edificio Alfa');
    assert.deepEqual([ui.p.stockSaldo.dispositivoId, ui.p.stockSaldo.edificioId], [7, 3]);
    await ui.atras();
    assert.ok(ui.montada('stockEdificios'));
    await ui.atras();
    assert.ok(ui.montada('inicio') && !ui.montada('stockEdificios'));
    assert.equal(ui.banner().props.showBackButton, false);
  } finally { await ui.close(); }
});

test('Stock: tocar «Stock» desde un saldo vuelve a la lista; desde Inicio no abre Plazas ni nada de campo', async () => {
  const ui = await montarApp();
  try {
    await ui.perfil({stock: true});
    assert.equal(ui.montada('plazas'), false, 'solo stock: Plazas no se monta');
    await ui.pestana('stock');
    await ui.hacer(() => ui.p.stockEdificios.onElegir(PAR));
    await ui.pestana('stock');
    assert.ok(ui.montada('stockEdificios'));
    await ui.pestana('inicio');
    assert.ok(ui.montada('inicio'));
    assert.equal(ui.montada('plazas'), false);
  } finally { await ui.close(); }
});

test('Stock: un 403 SIN_MODULO o un 404 del saldo sacan de la pantalla; si el perfil deja de habilitar el stock, se vuelve al inicio', async () => {
  const ui = await montarApp();
  try {
    await ui.perfil({stock: true});
    await ui.pestana('stock');
    await ui.hacer(() => ui.p.stockEdificios.onElegir(PAR));
    await ui.hacer(() => ui.p.stockSaldo.onNoEncontrado());
    assert.ok(ui.montada('stockEdificios'), '404: de vuelta a la lista');
    assert.equal(ui.toasts.length, 1);
    await ui.hacer(() => ui.p.stockEdificios.onSinModulo('Sin permiso de stock'));
    assert.ok(ui.montada('inicio'), 'SIN_MODULO: al inicio');
    assert.equal(ui.alerts[0][1], 'Sin permiso de stock');
    await ui.pestana('stock');
    assert.ok(ui.montada('stockEdificios'));
    await ui.perfil({stock: false});
    assert.ok(ui.montada('inicio') && !ui.montada('stockEdificios'));
    assert.deepEqual(ui.items(), ['inicio:Inicio', 'cuenta:Cuenta']);
  } finally { await ui.close(); }
});
