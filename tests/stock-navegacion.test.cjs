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

async function montarApp({perfilGuardado = null} = {}) {
  const p = {};
  const listeners = new Set();
  const alerts = [];
  const toasts = [];
  const stub = nombre => props => { p[nombre] = props; return null; };
  const pantallas = {
    inicio: '../screens/EmergenciaInicioScreen', stockEdificios: '../screens/StockEdificiosScreen', stockSaldo: '../screens/StockSaldoScreen',
    plazas: '../screens/PlazasEdificiosScreen', entregar: '../screens/StockEntregaScreen', ingresar: '../screens/StockIngresoScreen',
    traspasar: '../screens/StockTraspasoScreen', ajustar: '../screens/StockAjusteScreen',
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
    [pantallas.entregar]: {__esModule: true, default: stub('entregar')},
    [pantallas.ingresar]: {__esModule: true, default: stub('ingresar')},
    [pantallas.traspasar]: {__esModule: true, default: stub('traspasar')},
    [pantallas.ajustar]: {__esModule: true, default: stub('ajustar')},
    '../services/plazasApi': {normalizarMapa: mapa => mapa, getMapa: async () => null},
    // El perfil llega por subscribePerfil (no por Inicio): `emitirPerfil` es lo que hace el back al contestar.
    '../services/emergenciaPerfil': {getPerfilGuardado: async () => perfilGuardado, subscribePerfil: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }},
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
    // Por subscribePerfil, con Inicio montado o no (en la pestaña Stock no lo está).
    perfil: valor => hacer(() => listeners.forEach(listener => listener(valor))),
    listeners: () => listeners.size,
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
    assert.equal(ui.montada('inicio'), false, 'en la pestaña Stock, Inicio no está montado: el perfil no puede venir de él');
    await ui.perfil({stock: false});
    assert.ok(ui.montada('inicio') && !ui.montada('stockEdificios'));
    assert.deepEqual(ui.items(), ['inicio:Inicio', 'cuenta:Cuenta']);
  } finally { await ui.close(); }
});

test('Stock: el perfil guardado al montar habilita la pestaña sin esperar a Inicio, y al desmontar se deja de escuchar', async () => {
  const ui = await montarApp({perfilGuardado: {stock: true}});
  await ui.hacer(async () => {});
  assert.deepEqual(ui.items(), ['inicio:Inicio', 'stock:Stock', 'cuenta:Cuenta']);
  assert.equal(ui.listeners(), 1);
  await ui.close();
  assert.equal(ui.listeners(), 0);
});

test('Stock: desde el saldo, cada acción abre su pantalla sobre el mismo edificio; Atrás, cancelar y «listo» vuelven al saldo', async () => {
  const ui = await montarApp();
  try {
    await ui.perfil({stock: true});
    await ui.pestana('stock');
    await ui.hacer(() => ui.p.stockEdificios.onElegir(PAR));
    for (const [accion, titulo] of [['entregar', 'Entregar a una persona'], ['ingresar', 'Ingresar stock'], ['traspasar', 'Traspasar'], ['ajustar', 'Ajustar saldo']]) {
      await ui.hacer(() => ui.p.stockSaldo.onAccion(accion));
      assert.ok(ui.montada(accion) && !ui.montada('stockSaldo'), accion);
      assert.equal(ui.banner().props.title, titulo);
      assert.deepEqual([ui.p[accion].dispositivoId, ui.p[accion].edificioId], [7, 3]);
      await ui.atras();
      assert.ok(ui.montada('stockSaldo') && !ui.montada(accion), 'Atrás vuelve al saldo');
      assert.deepEqual([ui.p.stockSaldo.dispositivoId, ui.p.stockSaldo.edificioId], [7, 3]);
    }
    await ui.hacer(() => ui.p.stockSaldo.onAccion('entregar'));
    await ui.hacer(() => ui.p.entregar.onListo({id: 91}));
    assert.ok(ui.montada('stockSaldo'), 'hecha: de vuelta al saldo, que se monta de nuevo y se vuelve a pedir');
    await ui.hacer(() => ui.p.stockSaldo.onAccion('ajustar'));
    await ui.hacer(() => ui.p.ajustar.onCancelar());
    assert.ok(ui.montada('stockSaldo'));
    await ui.hacer(() => ui.p.stockSaldo.onAccion('no-existe'));
    assert.ok(ui.montada('stockSaldo'), 'una acción desconocida no cambia nada');
  } finally { await ui.close(); }
});

test('Stock: con una escritura en curso Atrás no sale; con lo cargado pide confirmar; 404 y SIN_MODULO sacan de la acción', async () => {
  const ui = await montarApp();
  try {
    await ui.perfil({stock: true});
    await ui.pestana('stock');
    await ui.hacer(() => ui.p.stockEdificios.onElegir(PAR));
    await ui.hacer(() => ui.p.stockSaldo.onAccion('traspasar'));
    await ui.hacer(() => ui.p.traspasar.onEnviando(true));
    await ui.atras();
    assert.ok(ui.montada('traspasar'), 'enviando: no se sale');
    assert.equal(ui.toasts.length, 1);
    await ui.hacer(() => ui.p.traspasar.onEnviando(false));
    await ui.hacer(() => ui.p.traspasar.onCambios(true));
    await ui.atras();
    assert.ok(ui.montada('traspasar'), 'con lo cargado pide confirmar');
    assert.equal(ui.alerts.at(-1)[0], '¿Salir sin enviar?');
    await ui.hacer(() => ui.alerts.at(-1)[2].find(b => b.text === 'Salir').onPress());
    assert.ok(ui.montada('stockSaldo'));
    await ui.hacer(() => ui.p.stockSaldo.onAccion('ingresar'));
    await ui.hacer(() => ui.p.ingresar.onNoEncontrado());
    assert.ok(ui.montada('stockEdificios'), '404: a la lista de edificios');
    await ui.hacer(() => ui.p.stockEdificios.onElegir(PAR));
    await ui.hacer(() => ui.p.stockSaldo.onAccion('ajustar'));
    await ui.hacer(() => ui.p.ajustar.onSinModulo('Sin stock'));
    assert.ok(ui.montada('inicio'));
  } finally { await ui.close(); }
});
