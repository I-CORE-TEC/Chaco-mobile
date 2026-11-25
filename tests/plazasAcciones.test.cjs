// Acciones de plazas (contrato §15 y §16): el servicio (cuerpos, rutas, clasificación de errores) y las tres
// pantallas (egreso, cambio de cama, hoja de acciones de la cama), con la API real sobre el fetch falso del runtime.
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

const root = path.join(__dirname, '..');
const native = Object.fromEntries(['View', 'Text', 'ScrollView', 'Pressable', 'ActivityIndicator', 'TextInput'].map(name => [name, name]));
Object.assign(native, {Platform: {OS: 'android'}, StyleSheet: {create: value => value}});
const theme = {colors: new Proxy({}, {get: () => '#5059BC'})};
const typography = {bold: 'Manrope', medium: 'Manrope', semibold: 'Manrope', regular: 'Manrope'};
const text = node => node.children.map(value => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : text(value)).join('');
const esperar = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const plano = valor => JSON.parse(JSON.stringify(valor ?? null));

function loadPure(relative) {
  const {code} = transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  vm.runInNewContext('(function(module,exports){' + code + '\n})', {})(module, module.exports);
  return module.exports;
}

function loadScreen(relative, mocks) {
  const filename = path.join(root, relative);
  const {code} = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  const context = vm.createContext({console, setTimeout, clearTimeout, Date, setInterval: () => 0, clearInterval: () => {}});
  vm.runInContext('(function(require,module,exports){' + code + '\n})', context)(
    name => { assert.ok(mocks[name], 'Missing screen mock: ' + name); return mocks[name]; }, module, module.exports);
  return module.exports.default;
}

async function render(Screen, props) {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen, props)); });
  await renderer.act(async () => { await esperar(5); });
  const labels = () => tree.root.findAllByType('Text').map(text);
  const press = async (label) => {
    const nodo = tree.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === label);
    assert.ok(nodo, 'Missing pressable ' + label);
    await renderer.act(async () => { await nodo.props.onPress(); await esperar(5); });
  };
  const botones = () => tree.root.findAllByType('CustomButton').map(b => b.props.title);
  const button = title => tree.root.findAllByType('CustomButton').find(node => node.props.title === title);
  const pressButton = async (title) => {
    const found = button(title);
    assert.ok(found, 'Missing CustomButton ' + title + ' — hay: ' + botones());
    await renderer.act(async () => { await found.props.onPress(); await esperar(5); });
  };
  const input = label => tree.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label);
  const escribir = async (label, valor) => {
    const found = input(label);
    assert.ok(found, 'Missing input ' + label);
    await renderer.act(async () => { found.props.onChangeText(valor); });
  };
  return {tree, labels, press, botones, button, pressButton, input, escribir, close: async () => renderer.act(async () => tree.unmount())};
}

async function entorno(rutas) {
  const runtime = await setup();
  runtime.setFetch(async () => response(200, {token: 'tok', user_id: 7, username: 'guardia', modulos: ['emergencia']}));
  await runtime.api.loginBecas({username: 'guardia', password: 'x'});
  const calls = [];
  runtime.setFetch(async (url, init = {}) => {
    const call = {url: String(url).replace('https://example.test', ''), method: init.method || 'GET', init,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body};
    calls.push(call);
    return rutas(call, calls);
  });
  const toasts = [];
  const alerts = [];
  const servicio = runtime.load('./plazasAccionesApi');
  const mocks = {
    react: React, 'react-native': native,
    '../context/ThemeContext': {useTheme: () => ({theme, typography})},
    '../context/ToastContext': {useToast: () => ({showToast: value => toasts.push(value), showAlert: (...args) => alerts.push(args)})},
    '../theme': loadPure('src/theme/tokens.js'),
    '../components/CustomButton': {__esModule: true, default: 'CustomButton'},
    '../components/FormInput': {__esModule: true, default: native.TextInput},
    '../utils/teclado': {keyboardDismissModeFor: () => 'on-drag'},
    '../services/plazasAccionesApi': servicio,
  };
  return {runtime, calls, toasts, alerts, servicio, mocks};
}

// Pulsa el botón de la última alerta de confirmación con ese texto.
const confirmar = async (alerts, titulo) => {
  const ultima = alerts[alerts.length - 1];
  assert.ok(ultima, 'No hubo confirmación');
  const boton = ultima[2].find(b => b.text === titulo);
  assert.ok(boton && boton.onPress, 'La confirmación no tiene «' + titulo + '»: ' + ultima[2].map(b => b.text));
  await renderer.act(async () => { await boton.onPress(); await esperar(5); });
};

const MAPA = {dispositivo: {id: 7}, edificio: {id: 3}, sectores: []};
const ESTADIA = {id: 12, persona: {nombre: 'Benítez, Ramón', dni: '30123456'}, sector: {id: 5, nombre: 'Aula 1'}, plaza: {id: 41, codigo: 'A1-05'},
  fecha_ingreso: '2026-11-18T21:40:00-03:00', acciones: ['egresar', 'reubicar']};
const MOTIVOS = [{id: 1, nombre: 'Volvió a su vivienda'}, {id: 2, nombre: 'Abandono'}];

// ---- Servicio ----

test('Cuerpos: reservar y prestar mandan dni, hasta y motivo, NUNCA desde ni sexo', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  const reservar = servicio.cuerpoAccionPlaza('reservar', {dni: '30.123.456', hasta: '', motivo: ' Cuidado ', desde: '2026-01-01', sexo: 'F'});
  assert.deepEqual(plano(reservar), {dni: '30123456', motivo: 'Cuidado'});
  const prestar = servicio.cuerpoAccionPlaza('prestar', {dni: '30123456', hasta: '31/12/2099'});
  assert.deepEqual(Object.keys(prestar).sort(), ['dni', 'hasta']);
  assert.match(prestar.hasta, /^2099-12-31T23:59:00[+-]\d\d:\d\d$/);
  assert.ok(!('desde' in prestar) && !('sexo' in prestar));
});

test('Cuerpos: liberar con o sin motivo, sacar de servicio siempre con motivo, volver sin cuerpo', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  assert.deepEqual(plano(servicio.cuerpoAccionPlaza('liberar', {})), {});
  assert.deepEqual(plano(servicio.cuerpoAccionPlaza('liberar', {motivo: 'Ya no viene'})), {motivo: 'Ya no viene'});
  assert.deepEqual(plano(servicio.cuerpoAccionPlaza('fuera_servicio', {motivo: 'Techo roto'})), {motivo: 'Techo roto'});
  assert.deepEqual(plano(servicio.cuerpoAccionPlaza('volver', {motivo: 'x'})), {});
});

test('Cuerpos: egreso y cambio de cama', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  assert.deepEqual(plano(servicio.cuerpoEgreso({motivo_egreso_id: '2', destino: ' Casa ', pertenencias_devueltas: true, observaciones: ''})),
    {motivo_egreso_id: 2, destino: 'Casa', pertenencias_devueltas: true, observaciones: ''});
  assert.equal(servicio.cuerpoEgreso({motivo_egreso_id: 1, destino: 'x'}).pertenencias_devueltas, false);
  assert.deepEqual(plano(servicio.cuerpoCambioPlaza({plaza_id: '44', motivo: ' Pedido propio '})), {plaza_id: 44, motivo: 'Pedido propio'});
});

test('Las acciones de cama van a las rutas del contrato §15 y §16', async () => {
  const {servicio, calls} = await entorno((call) => response(200, call.url.includes('egresar') || call.url.includes('cambiar') ? {ok: true, mapa: MAPA} : MAPA));
  await servicio.accionarPlaza(41, 'reservar', {dni: '30123456'});
  await servicio.accionarPlaza(41, 'prestar', {dni: '30123456', hasta: '31/12/2099'});
  await servicio.accionarPlaza(41, 'liberar');
  await servicio.accionarPlaza(41, 'fuera_servicio', {motivo: 'x'});
  await servicio.accionarPlaza(41, 'volver');
  await servicio.egresarEstadia(12, {motivo_egreso_id: 1, destino: 'Casa'});
  await servicio.cambiarPlaza(12, {plaza_id: 44, motivo: 'x'});
  await servicio.getPlazasParaCambio(12);
  await servicio.getMotivosEgreso();
  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), [
    'POST /api/emergencia/plazas/41/reservar/', 'POST /api/emergencia/plazas/41/prestar/', 'POST /api/emergencia/plazas/41/liberar/',
    'POST /api/emergencia/plazas/41/fuera-servicio/', 'POST /api/emergencia/plazas/41/volver-servicio/',
    'POST /api/emergencia/estadias/12/egresar/', 'POST /api/emergencia/estadias/12/cambiar-plaza/',
    'GET /api/emergencia/estadias/12/plazas-para-cambio/', 'GET /api/emergencia/motivos-egreso/']);
  await assert.rejects(() => servicio.accionarPlaza(41, 'baja'));
});

test('Errores: se clasifican por status y code', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  const c = (status, payload, extra = {}, contexto) => servicio.clasificarErrorPlaza({status, payload, ...extra}, contexto);
  assert.equal(c(403, {code: 'SIN_PERMISO', detail: 'x'}).tipo, 'sin_permiso');
  assert.equal(c(403, {code: 'SIN_PERMISO', detail: 'Falta dispositivo.egresar.'}).mensaje, 'Falta dispositivo.egresar.');
  assert.equal(c(403, {code: 'SIN_PERMISO'}).mensaje, 'No tenés permiso para esta acción.');
  assert.equal(c(403, null).tipo, 'reintentable', '403 sin code es del WAF');
  assert.equal(c(403, {detail: 'Forbidden'}).tipo, 'reintentable');
  assert.equal(c(403, {code: 'SIN_MODULO', detail: 'Sin módulo'}).tipo, 'sin_modulo');
  const egreso = c(409, {code: 'EGRESO_CON_FORMULARIO', detail: 'Este egreso se registra desde el backoffice.'});
  assert.equal(egreso.tipo, 'egreso_con_formulario');
  assert.equal(egreso.mensaje, 'Este egreso se registra desde el backoffice.');
  assert.equal(c(404, {detail: 'No encontrado.'}).mensaje, 'La cama ya no está disponible, actualizá.');
  assert.equal(c(404, {detail: 'No encontrado.'}, {}, 'estadia').mensaje, 'La estadía ya no está disponible, actualizá.');
  const persona = c(400, {code: 'PERSONA_NO_ENCONTRADA', detail: 'No hay nadie con ese DNI.'});
  assert.equal(persona.tipo, 'persona_no_encontrada');
  assert.deepEqual(plano(persona.errores), {dni: ['No hay nadie con ese DNI.']});
  const validacion = c(400, {code: 'VALIDACION', detail: 'Hay errores.', motivo: ['Obligatorio.'], hasta: ['Tiene que ser futura.']});
  assert.equal(validacion.tipo, 'validacion');
  assert.deepEqual(plano(validacion.errores), {motivo: ['Obligatorio.'], hasta: ['Tiene que ser futura.']});
  assert.equal(validacion.plazaOcupada, false);
  assert.equal(c(400, {code: 'VALIDACION', plaza_id: ['La plaza está ocupada.']}).plazaOcupada, true);
  assert.equal(c(400, {code: 'VALIDACION', detail: 'Ya tiene otra plaza.', non_field_errors: ['Ya tiene otra plaza.']}).errores.non_field_errors[0], 'Ya tiene otra plaza.');
  assert.equal(c(401, {}).tipo, 'sesion');
  assert.equal(c(503, {}).tipo, 'reintentable');
  assert.equal(c(0, null, {network: true}).tipo, 'reintentable');
});

test('Acciones visibles: solo las que vienen en plaza.acciones', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  assert.deepEqual(plano(servicio.accionesDeCama({acciones: ['reservar', 'prestar', 'fuera_servicio']})),
    {reservar: true, prestar: true, liberar: false, fueraServicio: true, volver: false, egresar: false, reubicar: false});
  assert.equal(servicio.accionesDeCama({acciones: ['volver']}).volver, true);
  assert.equal(servicio.accionesDeCama(null).reservar, false);
});

test('Validación en el teléfono: prestar exige hasta, sacar de servicio exige motivo', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  assert.ok(servicio.validarAccionPlaza('prestar', {dni: '30123456'}).hasta);
  assert.ok(servicio.validarAccionPlaza('reservar', {dni: '12'}).dni);
  assert.deepEqual(plano(servicio.validarAccionPlaza('reservar', {dni: '30123456', hasta: '01/01/2020'}).hasta), ['«Hasta» no puede ser anterior a hoy.']);
  assert.deepEqual(plano(servicio.validarAccionPlaza('reservar', {dni: '30123456'})), {});
  assert.ok(servicio.validarAccionPlaza('fuera_servicio', {motivo: ' '}).motivo);
  assert.ok(servicio.validarEgreso({}).motivo && servicio.validarEgreso({}).destino);
});

// ---- Egreso ----

async function montarEgreso(rutas, props = {}) {
  const env = await entorno(rutas);
  const listos = [];
  const cancelados = [];
  const Screen = loadScreen('src/screens/PlazasEgresoScreen.js', env.mocks);
  const ui = await render(Screen, {dispositivoId: 7, edificioId: 3, estadia: ESTADIA, onListo: m => listos.push(plano(m)), onCancelar: () => cancelados.push(1), ...props});
  return {...env, ...ui, listos, cancelados};
}
const rutasEgreso = (extra = () => null) => (call) => extra(call) || (call.url.endsWith('/motivos-egreso/')
  ? response(200, MOTIVOS) : response(200, {ok: true, mapa: MAPA}));

test('Egreso: carga el catálogo, confirma antes de mandar y devuelve el mapa', async () => {
  const ui = await montarEgreso(rutasEgreso());
  try {
    assert.ok(ui.labels().includes('Benítez, Ramón'));
    await ui.press('Motivo: Abandono');
    await ui.escribir('Destino', 'Casa de un familiar');
    await ui.press('Pertenencias devueltas: Sí');
    await ui.escribir('Observaciones', 'Sin novedades');
    await ui.pressButton('Registrar egreso');
    assert.equal(ui.calls.filter(c => c.method === 'POST').length, 0, 'antes de confirmar no se manda nada');
    await confirmar(ui.alerts, 'Registrar egreso');
    const post = ui.calls.find(c => c.method === 'POST');
    assert.equal(post.url, '/api/emergencia/estadias/12/egresar/');
    assert.deepEqual(post.body, {motivo_egreso_id: 2, destino: 'Casa de un familiar', pertenencias_devueltas: true, observaciones: 'Sin novedades'});
    assert.deepEqual(ui.listos, [MAPA]);
  } finally { await ui.close(); }
});

test('Egreso: sin motivo ni destino no pide confirmación ni manda', async () => {
  const ui = await montarEgreso(rutasEgreso());
  try {
    await ui.pressButton('Registrar egreso');
    assert.equal(ui.alerts.length, 0);
    assert.equal(ui.calls.filter(c => c.method === 'POST').length, 0);
    assert.ok(ui.labels().includes('Elegí el motivo del egreso.') && ui.labels().includes('Falta el destino.'));
  } finally { await ui.close(); }
});

test('Egreso: sin conexión no se envía y se avisa', async () => {
  const ui = await montarEgreso(rutasEgreso());
  try {
    await ui.press('Motivo: Abandono');
    await ui.escribir('Destino', 'Casa');
    await ui.pressButton('Registrar egreso');
    ui.runtime.setOnline(false);
    await confirmar(ui.alerts, 'Registrar egreso');
    assert.equal(ui.calls.filter(c => c.method === 'POST').length, 0);
    assert.equal(ui.alerts[ui.alerts.length - 1][0], 'Sin conexión');
    assert.equal(ui.listos.length, 0);
  } finally { await ui.close(); }
});

test('Egreso: 409 EGRESO_CON_FORMULARIO, 403 SIN_PERMISO y 404 con su mensaje', async () => {
  const casos = [
    [409, {code: 'EGRESO_CON_FORMULARIO', detail: 'Este egreso se registra desde el backoffice.'}, 'Este egreso se registra desde el backoffice.'],
    [403, {code: 'SIN_PERMISO'}, 'No tenés permiso para esta acción.'],
  ];
  for (const [status, payload, mensaje] of casos) {
    const ui = await montarEgreso(rutasEgreso(call => call.method === 'POST' ? response(status, payload) : null));
    try {
      await ui.press('Motivo: Abandono');
      await ui.escribir('Destino', 'Casa');
      await ui.pressButton('Registrar egreso');
      await confirmar(ui.alerts, 'Registrar egreso');
      assert.ok(ui.labels().includes(mensaje), 'Falta «' + mensaje + '»: ' + ui.labels());
      assert.equal(ui.listos.length, 0);
    } finally { await ui.close(); }
  }
  const ui = await montarEgreso(rutasEgreso(call => call.method === 'POST' ? response(404, {detail: 'No encontrado.'}) : null));
  try {
    await ui.press('Motivo: Abandono');
    await ui.escribir('Destino', 'Casa');
    await ui.pressButton('Registrar egreso');
    await confirmar(ui.alerts, 'Registrar egreso');
    const alerta = ui.alerts[ui.alerts.length - 1];
    assert.equal(alerta[1], 'La estadía ya no está disponible, actualizá.');
    await alerta[2][0].onPress();
    assert.equal(ui.cancelados.length, 1);
  } finally { await ui.close(); }
});

test('Egreso: 400 VALIDACION marca el campo; mientras envía el botón queda deshabilitado (sin doble envío)', async () => {
  let liberar;
  const trabado = new Promise((resolve) => { liberar = resolve; });
  const ui = await montarEgreso(rutasEgreso(call => (call.method === 'POST' ? trabado.then(() => response(400, {code: 'VALIDACION', detail: 'Datos inválidos.', destino: ['Destino no válido.']})) : null)));
  try {
    await ui.press('Motivo: Abandono');
    await ui.escribir('Destino', 'Casa');
    await ui.pressButton('Registrar egreso');
    const alerta = ui.alerts[ui.alerts.length - 1];
    const enviarDos = Promise.all([alerta[2][1].onPress(), alerta[2][1].onPress()]);
    await renderer.act(async () => { await esperar(5); });
    assert.equal(ui.button('Registrar egreso').props.disabled, true);
    liberar();
    await renderer.act(async () => { await enviarDos; await esperar(5); });
    assert.equal(ui.calls.filter(c => c.method === 'POST').length, 1);
    assert.ok(ui.labels().includes('Destino no válido.'));
    assert.equal(ui.listos.length, 0);
  } finally { await ui.close(); }
});

// ---- Cambio de cama ----

const LIBRES = {sectores: [{id: 5, nombre: 'Aula 1', plazas: [{id: 42, codigo: 'A1-06', tipo: 'CAMA'}]},
  {id: 6, nombre: 'Aula 2', plazas: [{id: 44, codigo: 'A2-02', tipo: 'CAMA'}, {id: 45, codigo: 'A2-03', tipo: 'CAMA'}]}]};

async function montarCambio(rutas, props = {}) {
  const env = await entorno(rutas);
  const listos = [];
  const Screen = loadScreen('src/screens/PlazasCambioCamaScreen.js', env.mocks);
  const ui = await render(Screen, {dispositivoId: 7, edificioId: 3, estadia: ESTADIA, onListo: m => listos.push(plano(m)), onCancelar: () => {}, ...props});
  return {...env, ...ui, listos};
}

test('Cambio de cama: agrupa por sector, confirma y manda plaza_id y motivo', async () => {
  const ui = await montarCambio(call => (call.method === 'GET' ? response(200, LIBRES) : response(200, {ok: true, mapa: MAPA})));
  try {
    assert.ok(ui.labels().includes('Aula 1 · 1 libre') && ui.labels().includes('Aula 2 · 2 libres'));
    await ui.press('Cama A2-03');
    await ui.escribir('Motivo del cambio', 'Pedido propio');
    await ui.pressButton('Cambiar de cama');
    await confirmar(ui.alerts, 'Cambiar de cama');
    const post = ui.calls.find(c => c.method === 'POST');
    assert.equal(post.url, '/api/emergencia/estadias/12/cambiar-plaza/');
    assert.deepEqual(post.body, {plaza_id: 45, motivo: 'Pedido propio'});
    assert.deepEqual(ui.listos, [MAPA]);
  } finally { await ui.close(); }
});

test('Cambio de cama: 400 con error en plaza_id recarga las libres y avisa que la cama se ocupó', async () => {
  let lecturas = 0;
  const ui = await montarCambio((call) => {
    if (call.method === 'GET') {
      lecturas += 1;
      return response(200, lecturas === 1 ? LIBRES : {sectores: [{id: 6, nombre: 'Aula 2', plazas: [{id: 44, codigo: 'A2-02', tipo: 'CAMA'}]}]});
    }
    return response(400, {code: 'VALIDACION', detail: 'La plaza está ocupada.', plaza_id: ['La plaza está ocupada.']});
  });
  try {
    await ui.press('Cama A2-03');
    await ui.escribir('Motivo del cambio', 'Pedido propio');
    await ui.pressButton('Cambiar de cama');
    await confirmar(ui.alerts, 'Cambiar de cama');
    assert.equal(lecturas, 2, 'recargó plazas-para-cambio');
    assert.ok(ui.labels().includes('Esa cama se acaba de ocupar, elegí otra.'));
    assert.ok(ui.toasts.some(t => t.message === 'Esa cama se acaba de ocupar, elegí otra.'));
    assert.ok(!ui.labels().includes('A2-03'));
    assert.equal(ui.listos.length, 0);
    // La selección se limpió: sin cama nueva no confirma.
    const antes = ui.alerts.length;
    await ui.pressButton('Cambiar de cama');
    assert.equal(ui.alerts.length, antes);
  } finally { await ui.close(); }
});

test('Cambio de cama: sin conexión no manda', async () => {
  const ui = await montarCambio(call => (call.method === 'GET' ? response(200, LIBRES) : response(200, {ok: true, mapa: MAPA})));
  try {
    await ui.press('Cama A1-06');
    await ui.escribir('Motivo del cambio', 'x');
    await ui.pressButton('Cambiar de cama');
    ui.runtime.setOnline(false);
    await confirmar(ui.alerts, 'Cambiar de cama');
    assert.equal(ui.calls.filter(c => c.method === 'POST').length, 0);
    assert.equal(ui.alerts[ui.alerts.length - 1][0], 'Sin conexión');
  } finally { await ui.close(); }
});

// ---- Hoja de acciones de la cama ----

async function montarHoja(plaza, rutas = () => response(200, {ok: true, mapa: MAPA}), extra = {}) {
  const env = await entorno(rutas);
  const listos = [];
  const Screen = loadScreen('src/screens/PlazaAccionSheet.js', env.mocks);
  const ui = await render(Screen, {dispositivoId: 7, edificioId: 3, plaza, onListo: m => listos.push(plano(m)), onCancelar: () => {}, ...extra});
  return {...env, ...ui, listos};
}
const LIBRE = {id: 41, codigo: 'A2-03', tipo: 'CAMA', estado: 'disponible', persona: null, estadia_id: null, reserva_id: null, desde: null, hasta: null,
  acciones: ['reservar', 'prestar', 'fuera_servicio']};

test('Hoja: muestra solo las acciones de plaza.acciones', async () => {
  const libre = await montarHoja(LIBRE);
  try {
    assert.deepEqual(libre.botones().sort(), ['Cancelar', 'Reservar la cama', 'Sacar de servicio']);
    assert.ok(libre.tree.root.findAllByType('Pressable').some(n => n.props.accessibilityLabel === 'Prestar'));
  } finally { await libre.close(); }
  const reservada = await montarHoja({...LIBRE, estado: 'reservada', reserva_id: 9, acciones: ['liberar']});
  try {
    assert.deepEqual(reservada.botones().sort(), ['Cancelar', 'Liberar']);
  } finally { await reservada.close(); }
  const fuera = await montarHoja({...LIBRE, estado: 'fuera_servicio', acciones: ['volver']});
  try {
    assert.deepEqual(fuera.botones().sort(), ['Cancelar', 'Volver a servicio']);
  } finally { await fuera.close(); }
});

test('Hoja: reservar manda dni sin desde y devuelve el mapa', async () => {
  const ui = await montarHoja(LIBRE);
  try {
    assert.ok(!ui.tree.root.findAllByType('TextInput').some(n => n.props.accessibilityLabel === 'Desde'), 'no hay campo Desde');
    await ui.escribir('DNI de la persona', '30.123.456');
    await ui.escribir('Motivo', 'Familia en camino');
    await ui.pressButton('Reservar la cama');
    assert.equal(ui.calls.length, 0, 'antes de confirmar no se manda nada');
    await confirmar(ui.alerts, 'Reservar la cama');
    const post = ui.calls[0];
    assert.equal(post.url, '/api/emergencia/plazas/41/reservar/');
    assert.deepEqual(post.body, {dni: '30123456', motivo: 'Familia en camino'});
    assert.deepEqual(ui.listos, [MAPA]);
  } finally { await ui.close(); }
});

test('Hoja: prestar exige Hasta y manda ISO', async () => {
  const ui = await montarHoja(LIBRE);
  try {
    await ui.press('Prestar');
    await ui.escribir('DNI de la persona', '30123456');
    await ui.pressButton('Prestar la cama');
    assert.equal(ui.alerts.length, 0);
    assert.ok(ui.labels().includes('El préstamo necesita fecha «Hasta».'));
    await ui.escribir('Hasta', '31/12/2099');
    await ui.pressButton('Prestar la cama');
    await confirmar(ui.alerts, 'Prestar la cama');
    assert.equal(ui.calls[0].url, '/api/emergencia/plazas/41/prestar/');
    assert.match(ui.calls[0].body.hasta, /^2099-12-31T23:59:00/);
    assert.ok(!('desde' in ui.calls[0].body));
  } finally { await ui.close(); }
});

test('Hoja: sacar de servicio pide motivo obligatorio', async () => {
  const ui = await montarHoja(LIBRE);
  try {
    await ui.pressButton('Sacar de servicio');
    await ui.pressButton('Sacar de servicio');
    assert.equal(ui.alerts.length, 0);
    assert.ok(ui.labels().includes('El motivo es obligatorio para sacar la cama de servicio.'));
    await ui.escribir('Motivo para sacar de servicio', 'Techo roto');
    await ui.pressButton('Sacar de servicio');
    await confirmar(ui.alerts, 'Sacar de servicio');
    assert.equal(ui.calls[0].url, '/api/emergencia/plazas/41/fuera-servicio/');
    assert.deepEqual(ui.calls[0].body, {motivo: 'Techo roto'});
  } finally { await ui.close(); }
});

test('Hoja: liberar y volver a servicio confirman y mandan', async () => {
  const liberar = await montarHoja({...LIBRE, estado: 'reservada', acciones: ['liberar']});
  try {
    await liberar.pressButton('Liberar');
    await confirmar(liberar.alerts, 'Liberar la cama');
    assert.equal(liberar.calls[0].url, '/api/emergencia/plazas/41/liberar/');
    assert.deepEqual(liberar.calls[0].body, {});
    assert.deepEqual(liberar.listos, [MAPA]);
  } finally { await liberar.close(); }
  const volver = await montarHoja({...LIBRE, estado: 'fuera_servicio', acciones: ['volver']});
  try {
    await volver.pressButton('Volver a servicio');
    await confirmar(volver.alerts, 'Volver a servicio');
    assert.equal(volver.calls[0].url, '/api/emergencia/plazas/41/volver-servicio/');
  } finally { await volver.close(); }
});

test('Hoja: persona inexistente marca el DNI; sin red no manda', async () => {
  const ui = await montarHoja(LIBRE, () => response(400, {code: 'PERSONA_NO_ENCONTRADA', detail: 'No hay nadie con ese DNI.'}));
  try {
    await ui.escribir('DNI de la persona', '30123456');
    await ui.pressButton('Reservar la cama');
    await confirmar(ui.alerts, 'Reservar la cama');
    assert.ok(ui.labels().includes('No hay nadie con ese DNI.'));
    assert.equal(ui.listos.length, 0);
    ui.runtime.setOnline(false);
    await ui.pressButton('Reservar la cama');
    await confirmar(ui.alerts, 'Reservar la cama');
    assert.equal(ui.calls.length, 1, 'sin red no sale otro pedido');
    assert.equal(ui.alerts[ui.alerts.length - 1][0], 'Sin conexión');
  } finally { await ui.close(); }
});

test('Hoja: 403 SIN_PERMISO y 404 con su mensaje', async () => {
  const sinPermiso = await montarHoja(LIBRE, () => response(403, {code: 'SIN_PERMISO'}));
  try {
    await sinPermiso.escribir('DNI de la persona', '30123456');
    await sinPermiso.pressButton('Reservar la cama');
    await confirmar(sinPermiso.alerts, 'Reservar la cama');
    assert.ok(sinPermiso.labels().includes('No tenés permiso para esta acción.'));
  } finally { await sinPermiso.close(); }
  const noHay = await montarHoja(LIBRE, () => response(404, {detail: 'No encontrado.'}));
  try {
    await noHay.escribir('DNI de la persona', '30123456');
    await noHay.pressButton('Reservar la cama');
    await confirmar(noHay.alerts, 'Reservar la cama');
    assert.equal(noHay.alerts[noHay.alerts.length - 1][1], 'La cama ya no está disponible, actualizá.');
  } finally { await noHay.close(); }
});

test('Hoja: con bloqueo, «Sacar de servicio» queda deshabilitado con el texto; el motivo se limpia al cambiar de modo y tiene tope 200', async () => {
  const ui = await montarHoja({...LIBRE, bloqueo: 'La plaza está ocupada: egresá primero.'});
  try {
    assert.equal(ui.button('Sacar de servicio').props.disabled, true);
    assert.ok(ui.labels().includes('La plaza está ocupada: egresá primero.'));
    assert.equal(ui.input('Motivo').props.maxLength, 200);
    await ui.escribir('Motivo', 'algo');
    await ui.press('Prestar');
    assert.equal(ui.input('Motivo').props.value, '');
  } finally { await ui.close(); }
  const libre = await montarHoja(LIBRE);
  try {
    assert.equal(libre.button('Sacar de servicio').props.disabled, false);
    await libre.pressButton('Sacar de servicio');
    assert.equal(libre.input('Motivo para sacar de servicio').props.maxLength, 200);
  } finally { await libre.close(); }
});

test('Hoja: onListo recibe solo el mapa (null si la respuesta no lo trae)', async () => {
  const ui = await montarHoja({...LIBRE, estado: 'reservada', acciones: ['liberar']}, () => response(200, {ok: true}));
  try {
    await ui.pressButton('Liberar');
    await confirmar(ui.alerts, 'Liberar la cama');
    assert.deepEqual(ui.listos, [null]);
  } finally { await ui.close(); }
});

test('Egreso: si fallan los motivos se muestra el texto clasificado y se puede reintentar', async () => {
  let intentos = 0;
  const ui = await montarEgreso((call) => {
    if (call.url.endsWith('/motivos-egreso/')) { intentos += 1; return intentos === 1 ? response(503, {}) : response(200, MOTIVOS); }
    return response(200, {ok: true, mapa: MAPA});
  });
  try {
    assert.ok(ui.labels().includes('No se pudo confirmar si la acción llegó. Actualizá el mapa antes de repetirla.'));
    await ui.pressButton('Reintentar');
    assert.ok(ui.labels().includes('Benítez, Ramón'));
  } finally { await ui.close(); }
});

test('Cambio de cama: si falla la recarga tras «plaza ocupada» se muestra el error con las camas viejas', async () => {
  let lecturas = 0;
  const ui = await montarCambio((call) => {
    if (call.method === 'GET') { lecturas += 1; return lecturas === 1 ? response(200, LIBRES) : response(503, {}); }
    return response(400, {code: 'VALIDACION', plaza_id: ['Ocupada.']});
  });
  try {
    await ui.press('Cama A2-03');
    await ui.escribir('Motivo del cambio', 'x');
    await ui.pressButton('Cambiar de cama');
    await confirmar(ui.alerts, 'Cambiar de cama');
    assert.ok(ui.labels().includes('No se pudo confirmar si la acción llegó. Actualizá el mapa antes de repetirla.'));
  } finally { await ui.close(); }
});

test('Cambio de cama: sin cama actual (asignación) el motivo es opcional; con cama actual sigue obligatorio', async () => {
  const {servicio} = await entorno(() => response(200, {}));
  assert.ok(servicio.validarCambioPlaza({plaza_id: 45}).motivo);
  assert.deepEqual(plano(servicio.validarCambioPlaza({plaza_id: 45}, {motivoOpcional: true})), {});
  assert.ok(servicio.validarCambioPlaza({}, {motivoOpcional: true}).plaza_id);
  const sinCama = {...ESTADIA, plaza: null};
  const ui = await montarCambio(call => (call.method === 'GET' ? response(200, LIBRES) : response(200, {ok: true, mapa: MAPA})), {estadia: sinCama});
  try {
    assert.ok(ui.labels().includes('Motivo (opcional)'));
    await ui.press('Cama A2-03');
    await ui.pressButton('Cambiar de cama');
    await confirmar(ui.alerts, 'Cambiar de cama');
    const post = ui.calls.find(c => c.method === 'POST');
    assert.equal(post.body.plaza_id, 45);
    assert.deepEqual(ui.listos, [MAPA]);
  } finally { await ui.close(); }
});

test('Hoja: modoInicial abre en la acción tocada solo si la cama la permite', async () => {
  const prestar = await montarHoja(LIBRE, undefined, {modoInicial: 'prestar'});
  try {
    assert.ok(prestar.labels().includes('Hasta * (DD/MM/AAAA)'), 'abre en Prestar, no en Reservar');
    assert.ok(prestar.tree.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === 'Prestar').props.accessibilityState.selected);
  } finally { await prestar.close(); }
  const sinPermiso = await montarHoja({...LIBRE, acciones: ['reservar']}, undefined, {modoInicial: 'prestar'});
  try {
    assert.ok(!sinPermiso.labels().includes('Hasta * (DD/MM/AAAA)'), 'prestar no está permitido: queda Reservar');
  } finally { await sinPermiso.close(); }
  const fuera = await montarHoja(LIBRE, undefined, {modoInicial: 'fuera_servicio'});
  try {
    assert.ok(fuera.input('Motivo para sacar de servicio'), 'abre directo en el formulario de sacar de servicio');
  } finally { await fuera.close(); }
});
