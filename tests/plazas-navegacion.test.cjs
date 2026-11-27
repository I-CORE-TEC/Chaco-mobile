// Navegación de «Plazas y estadías» en EmergenciaApp: tarjeta -> edificios -> mapa -> acción -> onListo,
// Atrás en cada nivel, edificio único, y el mapa que devuelve una acción (solo se acepta el del edificio abierto).
// Las pantallas son stubs que capturan sus props: lo que se prueba es el cableado del router.
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
  return module.exports.default;
}

async function montarApp() {
  const p = {};
  const alerts = [];
  const toasts = [];
  const pedidosMapa = [];
  const respuestaMapa = {valor: null};
  const stub = nombre => props => { p[nombre] = props; return null; };
  // Cuántas veces se monta cada pantalla (para detectar un bucle de recarga).
  const mocks = {
    react: React, 'react-native': native,
    '../context/AuthContext': {useAuth: () => ({user: {nombre: 'Ana'}, logout() {}})},
    '../context/ThemeContext': {useTheme: () => ({theme, typography})},
    '../context/ToastContext': {useToast: () => ({showAlert: (...a) => alerts.push(a), showToast: t => toasts.push(t)})},
    '../components/Banner': {__esModule: true, default: 'Banner'},
    '../components/CustomButton': {__esModule: true, default: 'CustomButton'},
    '../components/BottomNav': {__esModule: true, default: 'BottomNav'},
    '../screens/CuentaScreen': {__esModule: true, default: 'CuentaScreen'},
    '../hooks/useBotonAtras': {__esModule: true, default: () => {}},
    '../screens/EmergenciaInicioScreen': {__esModule: true, default: stub('inicio')},
    '../screens/EmergenciaMisEnviosScreen': {__esModule: true, default: stub('envios')},
    '../screens/EmergenciaFormulario1Screen': {__esModule: true, default: stub('formulario')},
    '../screens/EmergenciaMisDispositivosScreen': {__esModule: true, default: stub('dispositivos')},
    '../screens/EmergenciaEntregasScreen': {__esModule: true, default: stub('entregas')},
    '../screens/EmergenciaRecibirEntregaScreen': {__esModule: true, default: stub('recibir')},
    '../screens/EmergenciaLlegadaBuscarScreen': {__esModule: true, default: stub('buscar')},
    '../screens/EmergenciaDerivacionScreen': {__esModule: true, default: stub('derivacion')},
    '../screens/EmergenciaIntegrantesScreen': {__esModule: true, default: stub('integrantes')},
    '../screens/EmergenciaFichaScreen': {__esModule: true, default: stub('ficha')},
    '../screens/EmergenciaCierreScreen': {__esModule: true, default: stub('cierre')},
    '../screens/EmergenciaPuertaScreen': {__esModule: true, default: stub('puerta')},
    '../screens/PlazasEdificiosScreen': {__esModule: true, default: stub('edificios')},
    '../screens/PlazasMapaScreen': {__esModule: true, default: stub('mapa')},
    '../screens/PlazasEstadiasScreen': {__esModule: true, default: stub('estadias')},
    '../screens/PlazasEgresoScreen': {__esModule: true, default: stub('egreso')},
    '../screens/PlazasCambioCamaScreen': {__esModule: true, default: stub('cambio')},
    '../screens/PlazaAccionSheet': {__esModule: true, default: stub('hoja')},
    '../screens/PlazasIngresoScreen': {__esModule: true, default: stub('ingreso')},
    '../screens/StockEdificiosScreen': {__esModule: true, default: () => null},
    '../screens/StockSaldoScreen': {__esModule: true, default: () => null},
    '../screens/StockEntregaScreen': {__esModule: true, default: () => null},
    '../screens/StockIngresoScreen': {__esModule: true, default: () => null},
    '../screens/StockTraspasoScreen': {__esModule: true, default: () => null},
    '../screens/StockAjusteScreen': {__esModule: true, default: () => null},
    '../services/emergenciaPerfil': {getPerfilGuardado: async () => null, subscribePerfil: () => () => {}},
    '../services/plazasApi': {normalizarMapa: mapa => ({...mapa, normalizado: true}),
      getMapa: async (d, e) => { pedidosMapa.push([d, e]); return respuestaMapa.cola?.length ? respuestaMapa.cola.shift() : respuestaMapa.valor; }},
    '@react-native-community/netinfo': {__esModule: true, default: {addEventListener: () => () => {}}},
    '../services/emergenciaLimpieza': {depurarBorradoresFicha: async () => {}},
    '../services/emergenciaCola': {syncPendientes: async () => ({}), getPendingCount: async () => 0, getResumenPendientes: async () => ({}),
      reintentar: async () => ({}), getLocalidadesGuardadas: async () => ({localidades: []}), getBorradorEnCurso: async () => null, descartar: async () => true},
    '../utils/emergencia': {avisoDeSalida: () => null},
  };
  const App = loadApp(mocks);
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(App, {})); });
  const hacer = async fn => renderer.act(async () => { await fn(); await esperar(2); });
  const banner = () => tree.root.findByType('Banner');
  // Las pantallas que no están montadas no se renderizan: `p.x` queda con las últimas props, así que se mira el árbol.
  const montada = nombre => tree.root.findAll(n => n.type === mocks[{
    edificios: '../screens/PlazasEdificiosScreen', mapa: '../screens/PlazasMapaScreen', estadias: '../screens/PlazasEstadiasScreen',
    egreso: '../screens/PlazasEgresoScreen', cambio: '../screens/PlazasCambioCamaScreen', hoja: '../screens/PlazaAccionSheet', ingreso: '../screens/PlazasIngresoScreen',
    inicio: '../screens/EmergenciaInicioScreen'}[nombre]].default).length > 0;
  return {p, alerts, toasts, pedidosMapa, respuestaMapa, hacer, montada, titulo: () => banner().props.title,
    atras: () => hacer(() => banner().props.onBackPress()), close: () => renderer.act(async () => tree.unmount())};
}

const EDIF_9 = {dispositivo: {id: 3, nombre: 'Centro'}, edificio: {id: 9, nombre: 'Pabellón A'}};
const MAPA_9 = {dispositivo: {id: 3}, edificio: {id: 9}, sectores: [{id: 1, nombre: 'Sector 1', plazas: []}], resumen: {ocupadas: 4}};
const PLAZA = {id: 41, codigo: 'A-01', estado: 'LIBRE'};

async function alMapa(ui, {unico = false} = {}) {
  await ui.hacer(() => ui.p.inicio.onAbrir({clave: 'plazas', titulo: 'Plazas y estadías'}));
  assert.ok(ui.montada('edificios'));
  await ui.hacer(() => ui.p.edificios.onElegir(EDIF_9, {unico}));
  assert.ok(ui.montada('mapa'));
}

test('Plazas: tarjeta -> edificios -> mapa -> acción -> onListo repinta el mapa, sube recarga y vuelve al mapa', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    assert.equal(ui.titulo(), 'Pabellón A');
    assert.equal(ui.p.mapa.dispositivoId, 3);
    assert.equal(ui.p.mapa.edificioId, 9);
    const recargaAntes = ui.p.mapa.recarga;
    await ui.hacer(() => ui.p.mapa.abrirAccion('ocupar', {plaza: PLAZA}));
    assert.ok(ui.montada('hoja') && !ui.montada('mapa'));
    assert.equal(ui.titulo(), 'Cama A-01');
    assert.deepEqual([ui.p.hoja.dispositivoId, ui.p.hoja.edificioId, ui.p.hoja.plaza.id], [3, 9, 41]);
    await ui.hacer(() => ui.p.hoja.onListo({...MAPA_9, resumen: {ocupadas: 5}}));
    assert.ok(ui.montada('mapa') && !ui.montada('hoja'));
    assert.equal(ui.p.mapa.mapa.resumen.ocupadas, 5);
    assert.equal(ui.p.mapa.mapa.normalizado, true, 'el mapa pasa por normalizarMapa');
    assert.equal(ui.p.mapa.recarga, recargaAntes + 1);
  } finally { await ui.close(); }
});

test('Plazas: egresar abre el egreso y reubicar el cambio de cama; desde estadías vuelven a estadías', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => ui.p.mapa.onVerEstadias());
    assert.ok(ui.montada('estadias'));
    const estadia = {id: 700, persona: {nombre: 'Rosa'}, plaza: 'A-01'};
    await ui.hacer(() => ui.p.estadias.abrirAccion('egresar', {estadia}));
    assert.ok(ui.montada('egreso'));
    assert.equal(ui.titulo(), 'Registrar egreso');
    assert.equal(ui.p.egreso.estadia.id, 700);
    await ui.atras();
    assert.ok(ui.montada('estadias'), 'Atrás de la acción vuelve a la vista de origen');
    await ui.hacer(() => ui.p.estadias.abrirAccion('reubicar', {estadia}));
    assert.ok(ui.montada('cambio'));
    assert.equal(ui.titulo(), 'Cambiar de cama');
    await ui.hacer(() => ui.p.cambio.onListo(null));
    assert.ok(ui.montada('estadias'), 'onListo vuelve al origen aunque no traiga mapa');
  } finally { await ui.close(); }
});

test('Plazas: onCancelar solo vuelve; Atrás en cada nivel baja de a uno hasta el inicio', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    const recarga = ui.p.mapa.recarga;
    await ui.hacer(() => ui.p.mapa.abrirAccion('reservar', {plaza: PLAZA}));
    await ui.hacer(() => ui.p.hoja.onCancelar());
    assert.ok(ui.montada('mapa'));
    assert.equal(ui.p.mapa.recarga, recarga, 'cancelar no recarga');
    await ui.hacer(() => ui.p.mapa.onVerEstadias());
    await ui.atras();
    assert.ok(ui.montada('mapa'), 'estadías -> mapa');
    await ui.atras();
    assert.ok(ui.montada('edificios'), 'mapa -> edificios (hay más de uno)');
    await ui.atras();
    assert.ok(ui.montada('inicio'));
  } finally { await ui.close(); }
});

test('Plazas: con un solo edificio, Atrás desde el mapa va al inicio; sin él, vuelve a la lista sin re-entrar', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui, {unico: true});
    await ui.atras();
    assert.ok(ui.montada('inicio'), 'unico: del mapa al inicio');
    await alMapa(ui);
    await ui.atras();
    assert.ok(ui.montada('edificios'));
    assert.equal(ui.p.edificios.entrarDirecto, false, 'al volver a la lista no se re-entra solo (sería un bucle)');
    await ui.atras();
    await ui.hacer(() => ui.p.inicio.onAbrir({clave: 'plazas', titulo: 'Plazas y estadías'}));
    assert.equal(ui.p.edificios.entrarDirecto, true, 'desde la tarjeta sí entra directo');
  } finally { await ui.close(); }
});

test('Plazas (a): el mapa de otro edificio, o sin ids, no se acepta; la acción tampoco lo toma', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => ui.p.mapa.onMapaActualizado(MAPA_9));
    assert.equal(ui.p.mapa.mapa.edificio.id, 9);
    await ui.hacer(() => ui.p.mapa.onMapaActualizado({...MAPA_9, edificio: {id: 10}}));
    assert.equal(ui.p.mapa.mapa.edificio.id, 9, 'edificio ajeno: queda el anterior');
    await ui.hacer(() => ui.p.mapa.onMapaActualizado({...MAPA_9, dispositivo: {id: 4}}));
    assert.equal(ui.p.mapa.mapa.dispositivo.id, 3, 'dispositivo ajeno: queda el anterior');
    await ui.hacer(() => ui.p.mapa.onMapaActualizado({sectores: []}));
    assert.equal(ui.p.mapa.mapa.edificio.id, 9, 'sin ids: no se acepta');
    // Una acción (cambio de cama) que devuelve el mapa de OTRO edificio: se ignora y se recarga.
    const recarga = ui.p.mapa.recarga;
    await ui.hacer(() => ui.p.mapa.abrirAccion('reubicar', {estadia: {id: 1}}));
    await ui.hacer(() => ui.p.cambio.onListo({...MAPA_9, edificio: {id: 77}}));
    assert.equal(ui.p.mapa.mapa.edificio.id, 9);
    assert.equal(ui.p.mapa.recarga, recarga + 1, 'recarga para que la vista pida el suyo');
  } finally { await ui.close(); }
});

test('Plazas: con algo cargado en la acción, Atrás pide confirmar; sin cambios, vuelve directo; mientras envía, frena', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => ui.p.mapa.abrirAccion('egresar', {estadia: {id: 5}}));
    await ui.hacer(() => ui.p.egreso.onCambios(true));
    await ui.atras();
    assert.ok(ui.montada('egreso'), 'no sale todavía');
    assert.equal(ui.alerts.length, 1);
    assert.equal(ui.alerts[0][0], '¿Salir sin enviar?');
    const salir = ui.alerts[0][2].find(b => b.text === 'Salir');
    await ui.hacer(() => salir.onPress());
    assert.ok(ui.montada('mapa'));
    // Sin cambios: directo.
    await ui.hacer(() => ui.p.mapa.abrirAccion('egresar', {estadia: {id: 5}}));
    await ui.hacer(() => ui.p.egreso.onCambios(false));
    await ui.atras();
    assert.ok(ui.montada('mapa'));
    // Enviando: se frena con un aviso.
    await ui.hacer(() => ui.p.mapa.abrirAccion('egresar', {estadia: {id: 5}}));
    await ui.hacer(() => ui.p.egreso.onEnviando(true));
    await ui.atras();
    assert.ok(ui.montada('egreso'));
    assert.ok(ui.toasts.length >= 1);
  } finally { await ui.close(); }
});

test('Plazas: la acción tocada en la hoja viaja como modoInicial y una segunda apertura no pisa la primera', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => { ui.p.mapa.abrirAccion('prestar', {plaza: PLAZA}); ui.p.mapa.abrirAccion('reservar', {plaza: {...PLAZA, id: 99, codigo: 'Z-99'}}); });
    assert.ok(ui.montada('hoja'));
    assert.equal(ui.p.hoja.modoInicial, 'prestar');
    assert.equal(ui.p.hoja.plaza.id, 41, 'la segunda apertura no reemplaza la acción abierta');
  } finally { await ui.close(); }
});

test('Plazas: desde estadías, un mapa descartado se vuelve a pedir y los filtros se conservan', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => ui.p.mapa.onVerEstadias());
    await ui.hacer(() => ui.p.estadias.onFiltros({estado: 'egresada', sector: 1}));
    await ui.hacer(() => ui.p.estadias.abrirAccion('reubicar', {estadia: {id: 1}}));
    ui.respuestaMapa.valor = {...MAPA_9, resumen: {ocupadas: 7}};
    await ui.hacer(() => ui.p.cambio.onListo({...MAPA_9, edificio: {id: 77}}));
    assert.ok(ui.montada('estadias'));
    assert.deepEqual(ui.pedidosMapa, [[3, 9]]);
    assert.equal(ui.p.estadias.total, 7, 'la solapa «Estadías · N» sale del mapa vuelto a pedir');
    assert.equal(ui.p.estadias.estadoInicial, 'egresada');
    assert.equal(ui.p.estadias.sectorInicial, 1);
    // Con un mapa válido no se pide otro.
    await ui.hacer(() => ui.p.estadias.abrirAccion('reubicar', {estadia: {id: 1}}));
    await ui.hacer(() => ui.p.cambio.onListo({...MAPA_9, resumen: {ocupadas: 8}}));
    assert.equal(ui.pedidosMapa.length, 1);
    assert.equal(ui.p.estadias.total, 8);
  } finally { await ui.close(); }
});

test('Plazas: dos re-pedidos del mapa desde estadías, el primero resuelve último -> queda el mapa del segundo', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => ui.p.mapa.onVerEstadias());
    const diferido = () => { let resolver; const promesa = new Promise(r => { resolver = r; }); return {promesa, resolver}; };
    const primero = diferido();
    const segundo = diferido();
    ui.respuestaMapa.cola = [primero.promesa, segundo.promesa];
    await ui.hacer(() => ui.p.estadias.abrirAccion('reubicar', {estadia: {id: 1}}));
    await ui.hacer(() => ui.p.cambio.onListo(null));
    await ui.hacer(() => ui.p.estadias.abrirAccion('reubicar', {estadia: {id: 1}}));
    await ui.hacer(() => ui.p.cambio.onListo(null));
    assert.equal(ui.pedidosMapa.length, 2);
    await ui.hacer(async () => segundo.resolver({...MAPA_9, resumen: {ocupadas: 7}}));
    await ui.hacer(async () => primero.resolver({...MAPA_9, resumen: {ocupadas: 2}}));
    assert.equal(ui.p.estadias.total, 7, 'la respuesta vieja que llegó tarde no pisa a la nueva');
  } finally { await ui.close(); }
});

test('Plazas: ingresar abre la pantalla de ingreso con la cama y el sector; onListo repinta y vuelve al mapa', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    const plaza = {id: 41, codigo: 'A2-03', acciones: ['ingresar']};
    await ui.hacer(() => ui.p.mapa.abrirAccion('ingresar', {plaza, sector: {id: 5, nombre: 'Aula 1'}}));
    assert.ok(ui.montada('ingreso'));
    assert.equal(ui.titulo(), 'Ingresar persona');
    assert.equal(ui.p.ingreso.plaza.id, 41);
    assert.equal(ui.p.ingreso.sector.nombre, 'Aula 1');
    assert.equal(ui.p.ingreso.dispositivoId, 3);
    await ui.hacer(() => ui.p.ingreso.onListo(null));
    assert.ok(ui.montada('mapa'));
  } finally { await ui.close(); }
});

test('Plazas: Atrás en el ingreso con datos cargados pregunta antes de salir', async () => {
  const ui = await montarApp();
  try {
    await alMapa(ui);
    await ui.hacer(() => ui.p.mapa.abrirAccion('ingresar', {plaza: {id: 41, codigo: 'A2-03'}}));
    await ui.hacer(() => ui.p.ingreso.onCambios(true));
    await ui.atras();
    assert.ok(ui.montada('ingreso'), 'no sale todavía');
    assert.equal(ui.alerts.length, 1);
  } finally { await ui.close(); }
});
