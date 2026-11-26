// Stock · escritura (§17.1 del contrato): clasificarError de cada code nuevo, armado de los cuatro cuerpos, `uuid_cliente`
// conservado entre reintentos y regenerado solo con UUID_EN_USO, y las cuatro pantallas con el cliente real sobre un fetch
// simulado (SALDO_INSUFICIENTE y SALDO_CAMBIO conservan lo cargado; los botones salen solo con `puede.*`).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const renderer = require('react-test-renderer');
const {transformSync} = require('@babel/core');
const {setup, response} = require('./helpers/mobile-runtime.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

const src = path.join(__dirname, '..', 'src');
// Lo que sale del runtime (vm) tiene otros prototipos: se compara por contenido, de los dos lados.
const igual = (actual, esperado) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(esperado)));
const esperar = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function preparar() {
  const r = await setup();
  r.setFetch(async () => response(200, {token: 'tok', user_id: 7, username: 'stock', modulos: ['emergencia']}));
  await r.api.loginBecas({username: 'stock', password: 'x'});
  return {r, s: r.load('./stockApi')};
}
// Un fetch que contesta por guion: `GET` por ruta y los `POST` en orden. Guarda lo que se mandó.
function servidor(r, {get = {}, posts = []} = {}) {
  const enviados = [];
  const cola = [...posts];
  r.setFetch(async (url, init = {}) => {
    const ruta = String(url).replace('https://example.test', '');
    if ((init.method || 'GET') === 'POST') {
      const cuerpo = JSON.parse(init.body);
      enviados.push({ruta, cuerpo});
      const siguiente = cola.length > 1 ? cola.shift() : cola[0];
      return typeof siguiente === 'function' ? siguiente(cuerpo) : siguiente;
    }
    const clave = Object.keys(get).find(k => ruta.startsWith(k));
    if (!clave) return response(404, {detail: 'No encontrado.'});
    return response(200, get[clave]);
  });
  return enviados;
}
const rechazo = (status, payload, headers) => () => response(status, payload, headers);
const OPERACION = (extra = {}) => ({id: 91, tipo: 'ENTREGA_PERSONA', uuid_cliente: 'u', ya_existia: false, creado_en: '2026-11-26T10:00:00-03:00',
  movimientos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: -2, saldo_posterior: 16}], ...extra});

// ---------------------------------------------------------------------------------------------------------------------
// clasificarError
// ---------------------------------------------------------------------------------------------------------------------
test('clasificarError: cada code nuevo de la escritura se clasifica por status y code, nunca por el texto', async () => {
  const {s} = await preparar();
  const c = (status, payload, extra = {}) => JSON.parse(JSON.stringify(s.clasificarError({status, payload, ...extra})));
  igual(c(409, {detail: 'No alcanza el stock de: Colchón', code: 'SALDO_INSUFICIENTE',
    saldos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: 1, alcanza: false}, {item_id: 15, nombre: 'Frazada', unidad: 'unidad', cantidad: 9, alcanza: true}]}),
  {tipo: 'saldo_insuficiente', mensaje: 'No alcanza el stock de: Colchón', saldos: [
    {item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: 1, alcanza: false}, {item_id: 15, nombre: 'Frazada', unidad: 'unidad', cantidad: 9, alcanza: true}]});
  igual(c(409, {code: 'SALDO_INSUFICIENTE'}), {tipo: 'saldo_insuficiente', mensaje: s.TEXTO_SALDO_INSUFICIENTE, saldos: []});
  igual(c(409, {detail: 'El saldo cambió: ahora hay 7 y habías visto 10.', code: 'SALDO_CAMBIO', saldo_actual: 7, saldo_visto: 10}),
    {tipo: 'saldo_cambio', mensaje: 'El saldo cambió: ahora hay 7 y habías visto 10.', saldoActual: 7});
  igual(c(409, {detail: 'otro texto', code: 'UUID_EN_USO'}), {tipo: 'uuid_en_uso', mensaje: s.TEXTO_UUID_EN_USO});
  igual(c(409, {detail: 'La institución no está activa.', code: 'STOCK_NO_HABILITADO'}), {tipo: 'no_habilitado', mensaje: s.TEXTO_NO_HABILITADO});
  assert.match(s.TEXTO_NO_HABILITADO, /no se movió nada/i);
  igual(c(400, {detail: 'La persona no está en el legajo.', code: 'PERSONA_SIN_DATOS', non_field_errors: ['x'], pide_sexo: true, motivo: ''}),
    {tipo: 'persona_sin_datos', mensaje: 'La persona no está en el legajo.', pideSexo: true, motivo: ''});
  assert.equal(c(400, {code: 'PERSONA_SIN_DATOS', pide_sexo: false, motivo: 'FALLECIDA'}).pideSexo, false);
  igual(c(400, {detail: 'Revisá los datos.', code: 'VALIDACION', lineas: ['Mandá lineas.'], destino: ['No es válido.'], non_field_errors: ['x']}),
    {tipo: 'validacion', mensaje: 'Revisá los datos.', errores: {lineas: ['Mandá lineas.'], destino: ['No es válido.'], non_field_errors: ['x']}});
  // Los de siempre no cambian.
  assert.equal(c(429, {}, {retryAfter: 12000}).espera, 12000);
  assert.equal(c(404, {detail: 'No encontrado.'}).tipo, 'no_encontrado');
  assert.equal(c(403, {code: 'SIN_PERMISO', detail: 'No podés.'}).tipo, 'sin_permiso');
  // Un 409 sin code conocido, o de un intermediario con HTML, no es ninguno de los nuevos.
  assert.equal(c(409, {detail: 'x', code: 'OTRA_COSA'}).tipo, 'otro');
  assert.equal(c(409, {code: 'SALDO_CAMBIO'}, {unexpectedHtml: true}).tipo, 'otro');
  assert.equal(c(409, {code: 'UUID_EN_USO'}, {unexpectedHtml: true}).tipo, 'otro');
});

test('clasificarErrorEscritura: sin red, 5xx y 403 hablan de mandar, no de ver', async () => {
  const {s} = await preparar();
  const c = (e) => JSON.parse(JSON.stringify(s.clasificarErrorEscritura(e)));
  assert.equal(c({network: true}).mensaje, s.TEXTO_SIN_RED_ESCRITURA);
  assert.equal(c({status: 503, payload: {}}).mensaje, s.TEXTO_REINTENTAR_ESCRITURA);
  assert.equal(c({status: 403, payload: {code: 'SIN_PERMISO'}}).mensaje, s.TEXTO_SIN_PERMISO_ESCRITURA);
  assert.equal(c({status: 403, payload: {code: 'SIN_PERMISO', detail: 'Texto del back.'}}).mensaje, 'Texto del back.');
});

// ---------------------------------------------------------------------------------------------------------------------
// Armado de los cuerpos
// ---------------------------------------------------------------------------------------------------------------------
test('armado: cada cuerpo lleva solo lo que el contrato pide, sin campos en blanco', async () => {
  const {s} = await preparar();
  const insumos = [{item_id: 12}, {item_id: 15}, {item_id: 18}];
  const lineas = s.armarLineas({12: '2', 15: '', 18: '0', 99: '4'}, insumos);
  igual(lineas, [{item_id: 12, cantidad: 2}]);
  igual(s.armarLineas({12: '03', 15: '1.5', 18: '-1'}, insumos), [{item_id: 12, cantidad: 3}]);

  igual(s.armarEntrega({uuid_cliente: 'u1', dni: '30.111.222', lineas, sexo: '', nombre: ' ', apellido: '', observacion: ''}),
    {uuid_cliente: 'u1', dni: '30111222', lineas});
  igual(s.armarEntrega({uuid_cliente: 'u1', dni: '30111222', lineas, sexo: 'F', nombre: ' Ana ', apellido: 'Paz', observacion: 'Frío'}),
    {uuid_cliente: 'u1', dni: '30111222', lineas, sexo: 'F', nombre: 'Ana', apellido: 'Paz', observacion: 'Frío'});

  igual(s.armarIngreso({uuid_cliente: 'u2', lineas, origen: 'DONACION', origen_detalle: 'se ignora', comprobante: ''}), {uuid_cliente: 'u2', lineas, origen: 'DONACION'});
  igual(s.armarIngreso({uuid_cliente: 'u2', lineas, origen: 'OTRO', origen_detalle: ' Vecinos ', comprobante: 'R-001'}),
    {uuid_cliente: 'u2', lineas, origen: 'OTRO', origen_detalle: 'Vecinos', comprobante: 'R-001'});

  igual(s.armarTraspaso({uuid_cliente: 'u3', destino_dispositivo_id: 8, destino_edificio_id: 5, lineas, observacion: ''}),
    {uuid_cliente: 'u3', destino_dispositivo_id: 8, destino_edificio_id: 5, lineas});
  igual(s.armarTraspaso({uuid_cliente: 'u3', destino_dispositivo_id: 8, destino_edificio_id: 5, lineas, observacion: 'Urgente'}).observacion, 'Urgente');

  igual(s.armarAjuste({uuid_cliente: 'u4', item_id: 12, cantidad_contada: '7', saldo_visto: 10, motivo: 'CONTEO_PERIODICO', detalle: ''}),
    {uuid_cliente: 'u4', item_id: 12, cantidad_contada: 7, saldo_visto: 10, motivo: 'CONTEO_PERIODICO'});
  igual(s.armarAjuste({uuid_cliente: 'u4', item_id: 12, cantidad_contada: '0', saldo_visto: 10, motivo: 'OTRO', detalle: 'Se mojó'}),
    {uuid_cliente: 'u4', item_id: 12, cantidad_contada: 0, saldo_visto: 10, motivo: 'OTRO', detalle: 'Se mojó'});
});

test('los cuatro POST van a la ruta del contrato con su cuerpo, y la persona y los destinos se piden con su query', async () => {
  const {r, s} = await preparar();
  const enviados = servidor(r, {get: {
    '/api/emergencia/dispositivos/7/edificios/3/stock/destinos-traspaso/': [{dispositivo: {id: 8, nombre: 'Escuela 12'}, edificio: {id: 5, nombre: 'Edificio Beta'}, extra: 1}],
    '/api/emergencia/dispositivos/7/edificios/3/stock/persona/': {persona: {dni: '30111222', nombre: 'Ana', apellido: 'Paz'},
      historial: [{creado_en: '2026-11-20T09:00:00-03:00', institucion: 'Otra institución', lineas: [{nombre: 'Colchón', unidad: 'unidad', cantidad: 1}]}]},
  }, posts: [response(201, OPERACION())]});
  assert.equal(s.RUTAS.entregas(7, 3), '/api/emergencia/dispositivos/7/edificios/3/stock/entregas/');
  assert.equal(s.RUTAS.ingresos(7, 3), '/api/emergencia/dispositivos/7/edificios/3/stock/ingresos/');
  assert.equal(s.RUTAS.traspasos(7, 3), '/api/emergencia/dispositivos/7/edificios/3/stock/traspasos/');
  assert.equal(s.RUTAS.ajustes(7, 3), '/api/emergencia/dispositivos/7/edificios/3/stock/ajustes/');
  igual(await s.getDestinosTraspaso(7, 3), [{dispositivo: {id: 8, nombre: 'Escuela 12'}, edificio: {id: 5, nombre: 'Edificio Beta'}}]);
  const persona = await s.getPersona(7, 3, {dni: '30.111.222', sexo: 'F'});
  assert.equal(persona.persona.nombre, 'Ana');
  assert.equal(persona.historial[0].institucion, 'Otra institución');
  assert.equal(s.armarQueryPersona({dni: '30.111.222'}), '?dni=30111222');
  assert.equal(s.armarQueryPersona({dni: '30111222', sexo: 'F'}), '?dni=30111222&sexo=F');
  igual(s.normalizarPersona({persona: null, historial: []}), {persona: null, historial: []});
  const op = await s.postEntrega(7, 3, {uuid_cliente: 'u', dni: '30111222', lineas: [{item_id: 12, cantidad: 2}]});
  assert.equal(op.movimientos[0].saldo_posterior, 16);
  await s.postIngreso(7, 3, {uuid_cliente: 'u', lineas: [], origen: 'DONACION'});
  await s.postTraspaso(7, 3, {uuid_cliente: 'u'});
  await s.postAjuste(7, 3, {uuid_cliente: 'u'});
  assert.deepEqual(enviados.map(e => e.ruta.split('/stock/')[1]), ['entregas/', 'ingresos/', 'traspasos/', 'ajustes/']);
  assert.equal(enviados[0].cuerpo.uuid_cliente, 'u');
});

// ---------------------------------------------------------------------------------------------------------------------
// uuid_cliente
// ---------------------------------------------------------------------------------------------------------------------
test('uuid_cliente: se conserva en los reintentos (sin red, 5xx, saldo, persona, validación, 429) y se regenera solo con UUID_EN_USO', async () => {
  const {r, s} = await preparar();
  let n = 0;
  const generar = () => `uuid-${++n}`;
  const sesion = s.crearSesionEnvio(generar);
  assert.equal(sesion.uuid(), 'uuid-1');
  const enviados = servidor(r, {posts: [
    () => { throw Object.assign(new Error('Network request failed'), {network: true}); },
    rechazo(503, {}),
    rechazo(409, {code: 'SALDO_INSUFICIENTE', detail: 'x', saldos: []}),
    rechazo(400, {code: 'PERSONA_SIN_DATOS', pide_sexo: true}),
    rechazo(400, {code: 'VALIDACION', detail: 'x', lineas: ['x']}),
    rechazo(409, {code: 'STOCK_NO_HABILITADO'}),
    rechazo(429, {}, {'Retry-After': '3'}),
    response(200, OPERACION({ya_existia: true})),
  ]});
  const intento = () => s.enviarOperacion(sesion, (uuid) => s.postEntrega(7, 3, {uuid_cliente: uuid, dni: '30111222', lineas: [{item_id: 12, cantidad: 1}]}));
  const tipos = [];
  for (let i = 0; i < 7; i += 1) tipos.push((await intento()).clasificacion.tipo);
  assert.deepEqual(tipos, ['sin_red', 'otro', 'saldo_insuficiente', 'persona_sin_datos', 'validacion', 'no_habilitado', 'espera']);
  const ultimo = await intento();
  assert.equal(ultimo.ok, true);
  assert.equal(ultimo.operacion.ya_existia, true);
  assert.deepEqual([...new Set(enviados.map(e => e.cuerpo.uuid_cliente))], ['uuid-1'], 'los 8 envíos llevan el mismo uuid');
  assert.equal(n, 1, 'no se generó ningún otro');
});

test('uuid_cliente: UUID_EN_USO genera uno nuevo y los reintentos siguientes conservan ese', async () => {
  const {r, s} = await preparar();
  let n = 0;
  const sesion = s.crearSesionEnvio(() => `uuid-${++n}`);
  const enviados = servidor(r, {posts: [rechazo(409, {code: 'UUID_EN_USO', detail: 'x'}), rechazo(503, {}), response(201, OPERACION())]});
  const intento = () => s.enviarOperacion(sesion, (uuid) => s.postAjuste(7, 3, {uuid_cliente: uuid}));
  assert.equal((await intento()).clasificacion.tipo, 'uuid_en_uso');
  assert.equal((await intento()).clasificacion.tipo, 'otro');
  assert.equal((await intento()).ok, true);
  assert.deepEqual(enviados.map(e => e.cuerpo.uuid_cliente), ['uuid-1', 'uuid-2', 'uuid-2']);
});

test('uuid_cliente: nuevoUuid genera uno distinto por formulario', async () => {
  const {s} = await preparar();
  const a = s.crearSesionEnvio().uuid();
  const b = s.crearSesionEnvio().uuid();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.notEqual(a, b);
});

test('validación en el teléfono: DNI, cantidades, origen, destino y ajuste', async () => {
  const {s} = await preparar();
  const insumos = [{item_id: 12}, {item_id: 15}];
  assert.equal(s.validarCantidades({}, insumos).lineas, s.TEXTO_SIN_LINEAS);
  assert.equal(s.validarCantidades({12: '0'}, insumos).lineas, s.TEXTO_SIN_LINEAS);
  assert.equal(s.validarCantidades({12: '1,5'}, insumos).cantidades[12], s.TEXTO_CANTIDAD_INVALIDA);
  assert.equal(s.hayErrores(s.validarCantidades({12: '2'}, insumos)), false);
  const ok = {dni: '30111222', cantidades: {12: '1'}, insumos};
  assert.equal(s.hayErrores(s.validarEntrega(ok)), false);
  assert.ok(s.validarEntrega({...ok, dni: '12'}).dni);
  assert.ok(s.validarEntrega({...ok, pideSexo: true}).sexo);
  assert.ok(s.validarEntrega({...ok, pideNombre: true, nombre: 'Ana'}).apellido);
  assert.ok(s.validarIngreso({cantidades: {12: '1'}, insumos}).origen);
  assert.ok(s.validarIngreso({cantidades: {12: '1'}, insumos, origen: 'OTRO'}).origen_detalle);
  assert.equal(s.hayErrores(s.validarIngreso({cantidades: {12: '1'}, insumos, origen: 'OTRO', origen_detalle: 'x'})), false);
  assert.ok(s.validarTraspaso({cantidades: {12: '1'}, insumos, destino: null}).destino);
  const ajuste = {item_id: 12, cantidad_contada: '7', saldo_visto: 10, motivo: 'CONTEO_PERIODICO', detalle: ''};
  assert.equal(s.hayErrores(s.validarAjuste(ajuste)), false);
  assert.ok(s.validarAjuste({...ajuste, cantidad_contada: '10'}).cantidad_contada, 'contar lo mismo que hay no ajusta nada');
  assert.ok(s.validarAjuste({...ajuste, cantidad_contada: ''}).cantidad_contada);
  assert.ok(s.validarAjuste({...ajuste, motivo: 'OTRO'}).detalle);
  assert.ok(s.validarAjuste({...ajuste, motivo: 'CORRECCION_CARGA'}).detalle);
  assert.ok(s.validarAjuste({...ajuste, item_id: null}).item_id);
});

// ---------------------------------------------------------------------------------------------------------------------
// Pantallas
// ---------------------------------------------------------------------------------------------------------------------
const native = Object.fromEntries(['View', 'Text', 'ScrollView', 'Pressable', 'ActivityIndicator', 'RefreshControl'].map(n => [n, n]));
Object.assign(native, {Platform: {OS: 'android'}, StyleSheet: {create: v => v}});
const colores = new Proxy({}, {get: () => '#5059BC'});
const tono = {bg: '#fff', bd: '#000', tx: '#111'};

function cargarModulo(archivo, mocks, cache = new Map()) {
  const filename = path.resolve(archivo);
  if (cache.has(filename)) return cache.get(filename).exports;
  const {code} = transformSync(fs.readFileSync(filename, 'utf8'), {filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  cache.set(filename, module);
  const dir = path.dirname(filename);
  const context = vm.createContext({console, setTimeout, clearTimeout, Date, Number, String, Object, Array, JSON, Math, Set, Boolean});
  vm.runInContext('(function(require,module,exports){' + code + '\n})', context)((nombre) => {
    if (!nombre.startsWith('.')) { assert.ok(nombre in mocks, 'Missing mock: ' + nombre); return mocks[nombre]; }
    const absoluto = path.resolve(dir, nombre);
    const clave = path.relative(src, absoluto).replace(/\\/g, '/');
    if (clave in mocks) return mocks[clave];
    return cargarModulo(fs.existsSync(absoluto + '.js') ? absoluto + '.js' : absoluto, mocks, cache);
  }, module, module.exports);
  return module.exports;
}

async function montar(pantalla, props, {r, s}) {
  const alerts = [];
  const toasts = [];
  const mocks = {
    react: React, 'react-native': native, '@expo/vector-icons': {Ionicons: 'Ionicons'},
    'context/ThemeContext': {useTheme: () => ({theme: {colors: colores}, typography: {bold: 'M', medium: 'M', semibold: 'M', regular: 'M'}})},
    'context/ToastContext': {useToast: () => ({showToast: t => toasts.push(t), showAlert: (...a) => alerts.push(a)})},
    'components/FormInput': {__esModule: true, default: 'TextInput'},
    'components/CustomButton': {__esModule: true, default: 'CustomButton'},
    'components/PlazasUi': {ErrorPlazas: 'ErrorPlazas'},
    'theme': {fontSizes: new Proxy({}, {get: () => 14}), radii: new Proxy({}, {get: () => 8})},
    'theme/statusBadges': {statusTones: new Proxy({}, {get: () => tono})},
    'utils/dates': {formatDate: v => String(v).slice(0, 10)},
    'utils/teclado': {keyboardDismissModeFor: () => 'on-drag'},
    'services/stockApi': s,
  };
  const Pantalla = cargarModulo(path.join(src, 'screens', pantalla + '.js'), mocks).default;
  const eventos = {listo: [], cancelar: 0, noEncontrado: 0, sinModulo: [], enviando: [], cambios: [], accion: []};
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(Pantalla, {
      dispositivoId: 7, edificioId: 3, onListo: o => eventos.listo.push(o), onCancelar: () => { eventos.cancelar += 1; },
      onNoEncontrado: () => { eventos.noEncontrado += 1; }, onSinModulo: m => eventos.sinModulo.push(m), onEnviando: v => eventos.enviando.push(v),
      onCambios: v => eventos.cambios.push(v), onAccion: a => eventos.accion.push(a), ...props}));
    await esperar(5);
  });
  const hacer = async fn => renderer.act(async () => { await fn(); await esperar(5); });
  const aTexto = n => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).flat(3).filter(x => typeof x === 'string').join('');
  const api = {
    alerts, toasts, eventos, hacer, tree, r,
    textos: () => tree.root.findAll(n => n.type === 'Text').map(aTexto),
    hay: texto => api.textos().some(t => t.includes(texto)) || tree.root.findAll(n => n.props?.mensaje).some(n => String(n.props.mensaje).includes(texto)),
    campo: etiqueta => tree.root.findAll(n => n.type === 'TextInput' && n.props.accessibilityLabel === etiqueta)[0],
    escribir: (etiqueta, valor) => hacer(() => api.campo(etiqueta).props.onChangeText(valor)),
    boton: titulo => tree.root.findAll(n => n.type === 'CustomButton' && n.props.title === titulo)[0],
    botones: () => tree.root.findAll(n => n.type === 'CustomButton').map(n => n.props.title),
    tocar: titulo => hacer(() => api.boton(titulo).props.onPress()),
    radio: etiqueta => tree.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === etiqueta)[0],
    elegir: etiqueta => hacer(() => api.radio(etiqueta).props.onPress()),
    // Toca el botón y confirma el diálogo (si lo hay), como el usuario.
    confirmar: async titulo => {
      const antes = alerts.length;
      await api.tocar(titulo);
      if (alerts.length > antes) await hacer(() => alerts.at(-1)[2].find(b => b.style !== 'cancel').onPress());
    },
    close: () => renderer.act(async () => tree.unmount()),
  };
  return api;
}

const SALDO = (extra = {}) => ({dispositivo: {id: 7, nombre: 'Sede Central'}, edificio: {id: 3, nombre: 'Edificio Alfa'},
  puede: {entregar: true, ingresar: true, ajustar: true},
  saldos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: 18, activo: true}, {item_id: 15, nombre: 'Frazada', unidad: 'unidad', cantidad: 2, activo: false}],
  insumos_activos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad'}, {item_id: 20, nombre: 'Agua', unidad: 'bidón'}], ...extra});
const RUTA_SALDO = '/api/emergencia/dispositivos/7/edificios/3/stock/';
const cuerpoDeEnvio = (enviados, i) => enviados[i].cuerpo;

test('Entregar: SALDO_INSUFICIENTE muestra los saldos de ahora y no pierde lo cargado; el uuid es el mismo en cada reintento', async () => {
  const base = await preparar();
  const enviados = servidor(base.r, {get: {[RUTA_SALDO + 'persona/']: {persona: null, historial: []}, [RUTA_SALDO]: SALDO()}, posts: [
    rechazo(409, {detail: 'No alcanza el stock de: Colchón (hay 1, pediste 2).', code: 'SALDO_INSUFICIENTE',
      saldos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: 1, alcanza: false}]}),
    rechazo(400, {detail: 'La persona no está en el legajo.', code: 'PERSONA_SIN_DATOS', pide_sexo: true, motivo: ''}),
    rechazo(400, {detail: 'Faltan datos.', code: 'PERSONA_SIN_DATOS', pide_sexo: false, motivo: ''}),
    rechazo(503, {}),
    response(201, OPERACION()),
  ]});
  const ui = await montar('StockEntregaScreen', {}, base);
  try {
    assert.ok(ui.hay('Colchón') && ui.hay('Saldo: 18 unidad'));
    assert.equal(ui.hay('Frazada'), true, 'un desactivado con saldo se puede entregar');
    assert.equal(ui.hay('Agua'), false, 'sin saldo no se lista');
    await ui.escribir('DNI', '30111222');
    await ui.escribir('Cantidad de Colchón (unidad)', '2');
    await ui.escribir('Cantidad de Frazada (unidad)', '1');
    await ui.escribir('Observación (opcional)', 'Frío');
    assert.equal(ui.eventos.cambios.at(-1), true);

    await ui.confirmar('Entregar');
    assert.match(ui.alerts[0][1], /30111222/);
    assert.ok(ui.hay('No alcanza el stock de: Colchón'));
    assert.ok(ui.hay('Ahora hay: 1 unidad'), 'los saldos de ahora');
    assert.equal(ui.campo('DNI').props.value, '30111222');
    assert.equal(ui.campo('Cantidad de Colchón (unidad)').props.value, '2');
    assert.equal(ui.campo('Cantidad de Frazada (unidad)').props.value, '1');
    assert.equal(ui.campo('Observación (opcional)').props.value, 'Frío');
    const uuid = cuerpoDeEnvio(enviados, 0).uuid_cliente;
    igual(cuerpoDeEnvio(enviados, 0), {uuid_cliente: uuid, dni: '30111222', lineas: [{item_id: 12, cantidad: 2}, {item_id: 15, cantidad: 1}], observacion: 'Frío'});

    // Corrige y reintenta: el back pide el sexo.
    await ui.escribir('Cantidad de Colchón (unidad)', '1');
    await ui.confirmar('Entregar');
    assert.equal(ui.hay('Ahora hay: 1 unidad'), false, 'un envío nuevo limpia el rechazo anterior');
    assert.ok(ui.radio('Sexo: Femenino'), 'PERSONA_SIN_DATOS con pide_sexo muestra el sexo');
    assert.equal(ui.radio('Sexo: Femenino').props.accessibilityState.selected, false);
    await ui.elegir('Sexo: Femenino');
    assert.deepEqual([ui.radio('Sexo: Femenino').props.accessibilityState.selected, ui.radio('Sexo: Femenino').props.accessibilityState.checked], [true, true]);
    await ui.confirmar('Entregar');
    assert.equal(cuerpoDeEnvio(enviados, 2).sexo, 'F');
    assert.ok(ui.campo('Nombre') && ui.campo('Apellido'), 'después del sexo, nombre y apellido si el back lo pide');
    assert.equal(ui.campo('Cantidad de Colchón (unidad)').props.value, '1');
    await ui.confirmar('Entregar');
    assert.equal(ui.hay('Nombre'), true);
    assert.equal(ui.eventos.listo.length, 0, 'faltan nombre y apellido: no se manda otra vez');
    await ui.escribir('Nombre', 'Ana');
    await ui.escribir('Apellido', 'Paz');
    await ui.confirmar('Entregar');
    assert.ok(ui.hay('No se pudo confirmar'), '503: se puede reintentar');
    await ui.confirmar('Entregar');
    assert.equal(ui.eventos.listo.length, 1);
    assert.equal(ui.toasts.at(-1).message, 'Entrega registrada.');
    assert.equal(enviados.length, 5);
    assert.deepEqual([...new Set(enviados.map(e => e.cuerpo.uuid_cliente))], [uuid], 'un solo uuid en los 5 envíos');
    igual(cuerpoDeEnvio(enviados, 4), {uuid_cliente: uuid, dni: '30111222', lineas: [{item_id: 12, cantidad: 1}, {item_id: 15, cantidad: 1}], sexo: 'F', nombre: 'Ana', apellido: 'Paz', observacion: 'Frío'});
  } finally { await ui.close(); }
});

test('Entregar: UUID_EN_USO regenera el uuid y conserva lo cargado; el doble toque no manda dos veces', async () => {
  const base = await preparar();
  let liberar;
  const enviados = servidor(base.r, {get: {[RUTA_SALDO]: SALDO()}, posts: [
    rechazo(409, {code: 'UUID_EN_USO', detail: 'x'}),
    () => new Promise(resolve => { liberar = () => resolve(response(201, OPERACION())); }),
  ]});
  const ui = await montar('StockEntregaScreen', {}, base);
  try {
    await ui.escribir('DNI', '30111222');
    await ui.escribir('Cantidad de Colchón (unidad)', '2');
    await ui.confirmar('Entregar');
    assert.ok(ui.hay('Se generó uno nuevo'));
    assert.equal(ui.campo('Cantidad de Colchón (unidad)').props.value, '2');
    // Segundo envío, colgado: un toque más no manda otro.
    const antes = ui.alerts.length;
    await ui.tocar('Entregar');
    await renderer.act(async () => { ui.alerts[antes][2].find(b => b.style !== 'cancel').onPress(); await esperar(5); });
    await ui.tocar('Entregar');
    assert.equal(ui.alerts.length, antes + 1, 'enviando: el botón no vuelve a abrir el diálogo');
    assert.equal(enviados.length, 2);
    await ui.hacer(() => liberar());
    assert.equal(enviados.length, 2);
    assert.notEqual(enviados[0].cuerpo.uuid_cliente, enviados[1].cuerpo.uuid_cliente);
    assert.equal(ui.eventos.listo.length, 1);
    assert.deepEqual(ui.eventos.enviando, [true, false, true, false]);
  } finally { await ui.close(); }
});

test('Entregar: la persona del legajo muestra su historial; sin legajo pide sexo y después nombre y apellido; 429 espera; sin DNI válido no busca', async () => {
  const base = await preparar();
  const pedidos = [];
  const respuestas = [
    response(200, {persona: null, historial: []}),
    response(200, {persona: null, historial: []}),
    response(429, {detail: 'Demasiadas consultas.'}, {'Retry-After': '30'}),
  ];
  base.r.setFetch(async (url) => {
    const ruta = String(url).replace('https://example.test', '');
    if (ruta.startsWith(RUTA_SALDO + 'persona/')) { pedidos.push(ruta.slice(RUTA_SALDO.length)); return respuestas.shift(); }
    return response(200, SALDO());
  });
  const ui = await montar('StockEntregaScreen', {}, base);
  try {
    await ui.escribir('DNI', '12');
    await ui.tocar('Buscar persona');
    assert.equal(pedidos.length, 0, 'un DNI inválido no gasta una consulta');
    await ui.escribir('DNI', '30111222');
    await ui.tocar('Buscar persona');
    assert.deepEqual(pedidos, ['persona/?dni=30111222']);
    assert.ok(ui.radio('Sexo: Masculino'), 'sin legajo: pide el sexo');
    await ui.elegir('Sexo: Masculino');
    await ui.tocar('Buscar persona');
    assert.deepEqual(pedidos.at(-1), 'persona/?dni=30111222&sexo=M');
    assert.ok(ui.campo('Nombre') && ui.campo('Apellido'), 'el Registro tampoco: nombre y apellido');
    await ui.tocar('Buscar persona');
    assert.ok(ui.hay('Esperá 30 segundos'), '429 con Retry-After');
    await ui.tocar('Buscar persona');
    assert.equal(pedidos.length, 3, 'mientras espera no vuelve a pedir');
    await ui.escribir('DNI', '30111223');
    assert.equal(ui.campo('Nombre'), undefined, 'otro DNI: lo averiguado de la persona anterior no vale');
  } finally { await ui.close(); }

  const otra = await preparar();
  otra.r.setFetch(async (url) => (String(url).includes('/persona/')
    ? response(200, {persona: {dni: '30111222', nombre: 'Ana', apellido: 'Paz'}, historial: [
      {creado_en: '2026-11-20T09:00:00-03:00', institucion: 'Otra institución', lineas: [{nombre: 'Colchón', unidad: 'unidad', cantidad: 1}]}]})
    : response(200, SALDO())));
  const ui2 = await montar('StockEntregaScreen', {}, otra);
  try {
    await ui2.escribir('DNI', '30111222');
    await ui2.tocar('Buscar persona');
    assert.ok(ui2.hay('Ana Paz'));
    assert.ok(ui2.hay('2026-11-20 · Otra institución'));
    assert.ok(ui2.hay('1 unidad Colchón'));
    assert.equal(ui2.hay('Sexo'), false);
  } finally { await ui2.close(); }
});

test('Entregar: con el 404 o el SIN_MODULO del saldo sale de la pantalla; sin red al cargar ofrece Reintentar', async () => {
  const a = await preparar();
  servidor(a.r, {});
  const ui = await montar('StockEntregaScreen', {}, a);
  assert.equal(ui.eventos.noEncontrado, 1);
  await ui.close();
  const b = await preparar();
  b.r.setFetch(async () => response(403, {detail: 'Sin permiso de stock', code: 'SIN_MODULO'}));
  const ui2 = await montar('StockEntregaScreen', {}, b);
  await ui2.close();
  const c = await preparar();
  c.r.setFetch(async () => { throw Object.assign(new Error('Network request failed'), {network: true}); });
  const ui3 = await montar('StockEntregaScreen', {}, c);
  try {
    assert.ok(ui3.tree.root.findAll(n => n.type === 'ErrorPlazas').length === 1);
  } finally { await ui3.close(); }
});

test('Ingresar: solo insumos activos, origen con su detalle y comprobante; el cuerpo lleva lo del contrato', async () => {
  const base = await preparar();
  const enviados = servidor(base.r, {get: {[RUTA_SALDO]: SALDO()}, posts: [
    rechazo(400, {detail: 'Revisá.', code: 'VALIDACION', origen_detalle: ['Contá de dónde viene.']}),
    response(201, OPERACION({tipo: 'INGRESO_MANUAL'})),
  ]});
  const ui = await montar('StockIngresoScreen', {}, base);
  try {
    assert.ok(ui.hay('Agua') && ui.hay('Colchón'));
    assert.equal(ui.hay('Frazada'), false, 'un desactivado no se puede ingresar');
    await ui.tocar('Registrar ingreso');
    assert.equal(enviados.length, 0, 'sin cantidades ni origen no se manda');
    assert.ok(ui.hay('Elegí de dónde viene el stock.') && ui.hay('Cargá la cantidad de al menos un insumo.'));
    await ui.escribir('Cantidad de Agua (bidón)', '30');
    await ui.elegir('Origen: Otro');
    assert.ok(ui.campo('Detalle del origen'));
    await ui.escribir('Detalle del origen', 'Vecinos');
    await ui.escribir('Comprobante (opcional)', 'R-001');
    await ui.tocar('Registrar ingreso');
    assert.ok(ui.hay('Contá de dónde viene.'), 'el error por campo del back sale bajo su campo');
    assert.equal(ui.campo('Cantidad de Agua (bidón)').props.value, '30');
    await ui.tocar('Registrar ingreso');
    assert.equal(ui.eventos.listo.length, 1);
    assert.equal(ui.toasts.at(-1).message, 'Ingreso registrado.');
    const uuid = enviados[0].cuerpo.uuid_cliente;
    igual(enviados[1].cuerpo, {uuid_cliente: uuid, lineas: [{item_id: 20, cantidad: 30}], origen: 'OTRO', origen_detalle: 'Vecinos', comprobante: 'R-001'});
    assert.ok(enviados[1].ruta.endsWith('/stock/ingresos/'));
    assert.equal(enviados[0].cuerpo.uuid_cliente, enviados[1].cuerpo.uuid_cliente);
  } finally { await ui.close(); }
});

test('Traspasar: el destino sale de destinos-traspaso; SALDO_INSUFICIENTE conserva lo cargado; STOCK_NO_HABILITADO se explica', async () => {
  const base = await preparar();
  const enviados = servidor(base.r, {get: {
    [RUTA_SALDO + 'destinos-traspaso/']: [{dispositivo: {id: 8, nombre: 'Escuela 12'}, edificio: {id: 5, nombre: 'Edificio Beta'}}],
    [RUTA_SALDO]: SALDO(),
  }, posts: [
    rechazo(409, {code: 'SALDO_INSUFICIENTE', detail: 'No alcanza.', saldos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: 4, alcanza: false}]}),
    rechazo(409, {code: 'STOCK_NO_HABILITADO', detail: 'x'}),
    response(201, OPERACION({tipo: 'TRASPASO_SALIDA'})),
  ]});
  const ui = await montar('StockTraspasoScreen', {}, base);
  try {
    await ui.tocar('Traspasar');
    assert.equal(enviados.length, 0);
    assert.ok(ui.hay('Elegí a qué edificio se traspasa.'));
    await ui.elegir('Edificio de destino: Edificio Beta · Escuela 12');
    await ui.escribir('Cantidad de Colchón (unidad)', '9');
    await ui.escribir('Observación (opcional)', 'Urgente');
    await ui.confirmar('Traspasar');
    assert.match(ui.alerts[0][1], /Edificio Beta/);
    assert.ok(ui.hay('Ahora hay: 4 unidad'));
    assert.equal(ui.campo('Cantidad de Colchón (unidad)').props.value, '9');
    assert.equal(ui.radio('Edificio de destino: Edificio Beta · Escuela 12').props.accessibilityState.checked, true, 'el destino sigue elegido');
    await ui.escribir('Cantidad de Colchón (unidad)', '4');
    await ui.confirmar('Traspasar');
    assert.ok(ui.hay('No se movió nada'));
    await ui.confirmar('Traspasar');
    assert.equal(ui.eventos.listo.length, 1);
    const uuid = enviados[0].cuerpo.uuid_cliente;
    igual(enviados[2].cuerpo, {uuid_cliente: uuid, destino_dispositivo_id: 8, destino_edificio_id: 5, lineas: [{item_id: 12, cantidad: 4}], observacion: 'Urgente'});
    assert.deepEqual([...new Set(enviados.map(e => e.cuerpo.uuid_cliente))], [uuid]);
    assert.ok(enviados[0].ruta.endsWith('/stock/traspasos/'));
  } finally { await ui.close(); }

  const vacio = await preparar();
  servidor(vacio.r, {get: {[RUTA_SALDO + 'destinos-traspaso/']: [], [RUTA_SALDO]: SALDO()}});
  const ui2 = await montar('StockTraspasoScreen', {}, vacio);
  try {
    assert.ok(ui2.hay('No hay otro edificio al que puedas traspasar desde acá.'));
    assert.equal(ui2.boton('Traspasar').props.disabled, true);
  } finally { await ui2.close(); }
});

test('Ajustar: SALDO_CAMBIO muestra el saldo nuevo, conserva insumo, motivo y detalle, pide recontar y manda el saldo_visto nuevo', async () => {
  const base = await preparar();
  const enviados = servidor(base.r, {get: {[RUTA_SALDO]: SALDO()}, posts: [
    rechazo(409, {code: 'SALDO_CAMBIO', detail: 'El saldo cambió mientras contabas: ahora hay 7 y habías visto 18. Volvé a contar.', saldo_actual: 7, saldo_visto: 18}),
    rechazo(503, {}),
    response(201, OPERACION({tipo: 'AJUSTE'})),
  ]});
  const ui = await montar('StockAjusteScreen', {}, base);
  try {
    await ui.tocar('Ajustar saldo');
    assert.equal(enviados.length, 0);
    assert.ok(ui.hay('Elegí el insumo que contaste.') && ui.hay('Elegí el motivo del ajuste.'));
    await ui.elegir('Insumo: Colchón · 18 unidad');
    await ui.escribir('Cantidad contada', '18');
    await ui.elegir('Motivo: Otro');
    await ui.tocar('Ajustar saldo');
    assert.ok(ui.hay('Contaste lo mismo que hay') && ui.hay('Contá qué pasó.'));
    await ui.escribir('Cantidad contada', '10');
    await ui.escribir('Detalle', 'Se mojaron');
    await ui.confirmar('Ajustar saldo');
    assert.match(ui.alerts[0][1], /de 18 unidad a 10 unidad/);
    igual(enviados[0].cuerpo, {uuid_cliente: enviados[0].cuerpo.uuid_cliente, item_id: 12, cantidad_contada: 10, saldo_visto: 18, motivo: 'OTRO', detalle: 'Se mojaron'});
    assert.ok(ui.hay('ahora hay 7'));
    assert.ok(ui.hay('Saldo en el sistema: 7 unidad'), 'el saldo nuevo');
    assert.equal(ui.radio('Insumo: Colchón · 7 unidad').props.accessibilityState.checked, true, 'sigue elegido el mismo insumo');
    assert.equal(ui.radio('Motivo: Otro').props.accessibilityState.checked, true);
    assert.equal(ui.campo('Detalle').props.value, 'Se mojaron');
    assert.equal(ui.campo('Cantidad contada').props.value, '', 'hay que volver a contar');
    await ui.escribir('Cantidad contada', '6');
    await ui.confirmar('Ajustar saldo');
    assert.equal(enviados[1].cuerpo.saldo_visto, 7);
    assert.equal(enviados[1].cuerpo.cantidad_contada, 6);
    assert.equal(ui.campo('Cantidad contada').props.value, '6', 'un 503 no borra nada');
    await ui.confirmar('Ajustar saldo');
    assert.equal(ui.eventos.listo.length, 1);
    assert.deepEqual([...new Set(enviados.map(e => e.cuerpo.uuid_cliente))].length, 1, 'el mismo uuid en los 3 envíos');
    assert.ok(enviados[0].ruta.endsWith('/stock/ajustes/'));
  } finally { await ui.close(); }
});

test('Saldo: los botones de escritura salen solo con `puede.*` en true y abren su acción', async () => {
  const casos = [
    [{entregar: false, ingresar: false, ajustar: false}, []],
    [{entregar: true, ingresar: false, ajustar: false}, ['Entregar a una persona']],
    [{entregar: false, ingresar: true, ajustar: false}, ['Ingresar stock', 'Traspasar a otro edificio']],
    [{entregar: false, ingresar: false, ajustar: true}, ['Ajustar saldo']],
    [{entregar: true, ingresar: true, ajustar: true}, ['Entregar a una persona', 'Ingresar stock', 'Traspasar a otro edificio', 'Ajustar saldo']],
    [{}, []],
  ];
  for (const [puede, esperados] of casos) {
    const base = await preparar();
    base.r.setFetch(async (url) => response(200, String(url).includes('/movimientos/') ? {resultados: [], siguiente: null} : SALDO({puede})));
    const ui = await montar('StockSaldoScreen', {}, base);
    try {
      const visibles = ui.botones().filter(t => t !== 'Cargar más');
      assert.deepEqual(visibles, esperados, JSON.stringify(puede));
      if (esperados.length === 4) {
        await ui.tocar('Traspasar a otro edificio');
        await ui.tocar('Ajustar saldo');
        assert.deepEqual(ui.eventos.accion, ['traspasar', 'ajustar']);
      }
    } finally { await ui.close(); }
  }
});


