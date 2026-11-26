// Ingresar a una persona en una cama (contrato §18): el servicio (cuerpos, validación del alta, respuestas del
// formulario, clasificación de errores) y la pantalla de tres pasos, con la API real sobre el fetch falso del runtime.
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
  const fecha = async (valor) => {
    const found = tree.root.findAllByType('FechaInput')[0];
    assert.ok(found, 'Missing FechaInput');
    await renderer.act(async () => { found.props.onSelect(valor); });
  };
  return {tree, labels, press, botones, button, pressButton, input, escribir, fecha, close: async () => renderer.act(async () => tree.unmount())};
}

// Con el renderizador real de las inspecciones salvo el dibujo de cada campo (que usa iconos y el selector de fechas):
// CampoFormulario se reemplaza por un TextInput con la etiqueta del campo; GrupoFormulario y evaluarDiseno son los reales.
const GrupoReal = ({group, renderCampo}) => React.createElement('View', null, group.items.map(item => renderCampo(item)));
const CampoStub = ({field, value, onChange}) => React.createElement('TextInput',
  {accessibilityLabel: field.etiqueta, value: String(value ?? ''), onChangeText: onChange});

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
  const acciones = runtime.load('./plazasAccionesApi');
  const servicio = runtime.load('./plazasIngresoApi');
  const mocks = {
    react: React, 'react-native': native,
    '../context/ThemeContext': {useTheme: () => ({theme, typography})},
    '../context/ToastContext': {useToast: () => ({showToast: value => toasts.push(value), showAlert: (...args) => alerts.push(args)})},
    '../theme': loadPure('src/theme/tokens.js'),
    '../components/CustomButton': {__esModule: true, default: 'CustomButton'},
    '../components/FormInput': {__esModule: true, default: native.TextInput},
    '../components/FechaInput': {__esModule: true, default: 'FechaInput'},
    '../components/formulario/CampoFormulario': {__esModule: true, default: CampoStub},
    '../components/formulario/GrupoFormulario': {__esModule: true, default: GrupoReal},
    '../utils/teclado': {keyboardDismissModeFor: () => 'on-drag'},
    '../services/plazasAccionesApi': acciones,
    '../services/plazasIngresoApi': servicio,
    '../services/definicionFormulario': runtime.load('./definicionFormulario'),
    '../services/plazasApi': runtime.load('./plazasApi'),
  };
  return {runtime, calls, toasts, alerts, acciones, servicio, mocks};
}

const confirmar = async (alerts, titulo) => {
  const ultima = alerts[alerts.length - 1];
  assert.ok(ultima, 'No hubo confirmación');
  const boton = ultima[2].find(b => b.text === titulo);
  assert.ok(boton && boton.onPress, 'La confirmación no tiene «' + titulo + '»: ' + ultima[2].map(b => b.text));
  await renderer.act(async () => { await boton.onPress(); await esperar(5); });
};

const MAPA = {dispositivo: {id: 7}, edificio: {id: 3}, sectores: []};
const PLAZA = {id: 41, codigo: 'A2-03', tipo: 'CAMA', estado: 'disponible', persona: null, acciones: ['ingresar']};
const SECTOR = {id: 5, nombre: 'Aula 1'};
const ROSA = {encontrada: true, persona: {id: 812, dni: '30111222', nombre_completo: 'Rosa Benítez'}, alojada: false, alojamiento: null, plaza_reservada_id: null};
const FORM = {formulario: {version: 4, requiere_archivo: false, definicion: {version: 4, canal: null, destinos_siis: [], items: [
  {tipo_item: 'grupo', clave: 'g1', titulo: 'Datos del ingreso', items: [
    {tipo_item: 'campo', clave: 'c9', texto: 'Cantidad de pertenencias', tipo: 'INT', obligatorio: true},
    {tipo_item: 'campo', clave: 'c10', texto: 'Observaciones', tipo: 'STRING', obligatorio: false},
    {tipo_item: 'campo', clave: 'c11', texto: 'Foto del DNI', tipo: 'ARCHIVO', obligatorio: false}]}]}}};

const rutas = (extra = {}) => (call) => {
  const clave = call.method + ' ' + call.url.split('?')[0];
  if (extra[clave]) return extra[clave](call);
  if (clave === 'GET /api/emergencia/dispositivos/7/ingreso/persona/') return response(200, ROSA);
  if (clave === 'GET /api/emergencia/dispositivos/7/ingreso/formulario/') return response(200, {formulario: null});
  if (clave === 'POST /api/emergencia/dispositivos/7/ingresar/') return response(201, {ok: true, estadia_id: 230, mapa: MAPA});
  return response(404, {detail: 'No encontrado.'});
};

async function montar(extra = {}, props = {}) {
  const env = await entorno(rutas(extra));
  const listos = [];
  const cancelados = [];
  const Screen = loadScreen('src/screens/PlazasIngresoScreen.js', env.mocks);
  const ui = await render(Screen, {dispositivoId: 7, edificioId: 3, plaza: PLAZA, sector: SECTOR,
    onListo: m => listos.push(plano(m)), onCancelar: () => cancelados.push(1), ...props});
  return {...env, ...ui, listos, cancelados};
}
const post = ui => ui.calls.find(c => c.method === 'POST');

// ---- Servicio ----

test('Cuerpo: persona del padrón manda ciudadano_id; persona nueva manda persona_nueva; nunca las dos', async () => {
  const {servicio} = await entorno(rutas());
  assert.deepEqual(plano(servicio.cuerpoIngreso({plazaId: 41, ciudadanoId: 812})), {plaza_id: 41, ciudadano_id: 812});
  assert.deepEqual(plano(servicio.cuerpoIngreso({plazaId: '41', personaNueva: {dni: '40.111.222', nombre: ' Lucía ', apellido: 'Ferreyra', sexo: 'f', fecha_nacimiento: '17/05/1990'}})),
    {plaza_id: 41, persona_nueva: {dni: '40111222', nombre: 'Lucía', apellido: 'Ferreyra', sexo: 'F', fecha_nacimiento: '1990-05-17'}});
  const ambas = servicio.cuerpoIngreso({plazaId: 41, ciudadanoId: 812, personaNueva: {dni: '1'}});
  assert.ok(ambas.ciudadano_id && !ambas.persona_nueva);
});

test('Cuerpo: el formulario va solo si el paso 2 trajo uno, con la versión dibujada', async () => {
  const {servicio} = await entorno(rutas());
  assert.deepEqual(plano(servicio.cuerpoIngreso({plazaId: 41, ciudadanoId: 812, formulario: {version: 4, respuestas: {c9: 3}}})),
    {plaza_id: 41, ciudadano_id: 812, formulario: {version: 4, respuestas: {c9: 3}}});
  assert.ok(!('formulario' in servicio.cuerpoIngreso({plazaId: 41, ciudadanoId: 812, formulario: null})));
});

test('Alta en la app: nombre, apellido, DNI, sexo y fecha de nacimiento son obligatorios', async () => {
  const {servicio} = await entorno(rutas());
  const vacio = servicio.validarPersonaNueva({});
  assert.deepEqual(plano(Object.keys(vacio).sort()), ['apellido', 'dni', 'fecha_nacimiento', 'nombre', 'sexo']);
  const ok = {dni: '40111222', nombre: 'Lucía', apellido: 'Ferreyra', sexo: 'F', fecha_nacimiento: '17/05/1990'};
  assert.deepEqual(plano(servicio.validarPersonaNueva(ok)), {});
  assert.ok(servicio.validarPersonaNueva({...ok, sexo: 'Z'}).sexo);
  assert.ok(servicio.validarPersonaNueva({...ok, dni: '123'}).dni);
  assert.ok(servicio.validarPersonaNueva({...ok, fecha_nacimiento: '31/02/1990'}).fecha_nacimiento);
  assert.ok(servicio.validarPersonaNueva({...ok, fecha_nacimiento: '01/01/2999'}).fecha_nacimiento, 'no futura');
});

test('Respuestas: como las inspecciones (INT a número, vacíos fuera) y sin archivos ni firmas', async () => {
  const {servicio} = await entorno(rutas());
  const campos = [{clave: 'c9', tipo: 'INT'}, {clave: 'c10', tipo: 'STRING'}, {clave: 'c11', tipo: 'ARCHIVO'}, {clave: 'c12', tipo: 'FIRMA'}, {clave: 'c13', tipo: 'STRING'}];
  assert.deepEqual(plano(servicio.respuestasDeIngreso(campos, {c9: '3', c10: 'Mochila', c11: {uri: 'x'}, c12: {firmante: {}}, c13: ''})),
    {c9: 3, c10: 'Mochila'});
});

test('Formulario: sin formulario es null; los campos de archivo se sacan de la definición; requiere_archivo se conserva', async () => {
  const {servicio} = await entorno(rutas());
  assert.equal(servicio.formularioDeIngreso({formulario: null}), null);
  const f = servicio.formularioDeIngreso(FORM);
  assert.equal(f.version, 4);
  assert.equal(f.requiereArchivo, false);
  assert.deepEqual(plano(f.definicion.items[0].items.map(i => i.clave)), ['c9', 'c10']);
  assert.equal(servicio.formularioDeIngreso({formulario: {...FORM.formulario, requiere_archivo: true}}).requiereArchivo, true);
});

test('Errores del ingreso: se clasifican por status y code', async () => {
  const {acciones} = await entorno(rutas());
  const c = (status, payload, extra = {}) => plano(acciones.clasificarErrorPlaza({status, payload, ...extra}, 'cama'));
  const valid = c(400, {code: 'VALIDACION', detail: 'x', dni: ['Ya existe.'], nombre: ['Falta.']});
  assert.equal(valid.tipo, 'validacion');
  assert.deepEqual(valid.errores, {dni: ['Ya existe.'], nombre: ['Falta.']});
  assert.equal(valid.plazaOcupada, false);
  const clave = c(400, {code: 'VALIDACION', detail: '«Cantidad» es obligatorio.', respuestas: ['«Cantidad» es obligatorio.'], claves: {c9: '«Cantidad» es obligatorio.'}});
  assert.deepEqual(clave.claves, {c9: '«Cantidad» es obligatorio.'});
  assert.equal(c(400, {code: 'VALIDACION', detail: 'Ocupada.', plaza_id: ['Ocupada.']}).plazaOcupada, true);
  const alojada = c(400, {code: 'VALIDACION', detail: 'La persona ya figura alojada.'});
  assert.deepEqual(alojada.errores, {non_field_errors: ['La persona ya figura alojada.']});
  assert.equal(c(409, {code: 'FORMULARIO_CAMBIO', detail: 'El formulario de ingreso cambió. Volvé a cargarlo.'}).tipo, 'formulario_cambio');
  const archivo = c(409, {code: 'INGRESO_CON_ARCHIVO', detail: 'otro texto'});
  assert.equal(archivo.tipo, 'ingreso_con_archivo');
  assert.equal(archivo.mensaje, 'Este ingreso se hace desde el backoffice.');
  assert.equal(c(403, {code: 'SIN_PERMISO', detail: 'No podés.'}).tipo, 'sin_permiso');
  assert.equal(c(404, {detail: 'No encontrado.'}).tipo, 'no_encontrada');
});

test('El botón «Ingresar persona» solo aparece con `ingresar` en plaza.acciones', async () => {
  const {runtime} = await entorno(rutas());
  const p = runtime.load('./plazasApi');
  assert.deepEqual(plano(p.accionesDePlaza({acciones: ['reservar', 'prestar']}).map(a => a.accion)), ['reservar', 'prestar']);
  assert.deepEqual(plano(p.accionesDePlaza({acciones: ['reservar', 'ingresar']}).map(a => a.titulo)), ['Ingresar persona', 'Reservar']);
  assert.deepEqual(plano(p.accionesDePlaza({})), []);
  const mapa = fs.readFileSync(path.join(root, 'src/screens/PlazasMapaScreen.js'), 'utf8');
  assert.match(mapa, /accionesDePlaza\(plaza\)/, 'la hoja del mapa usa accionesDePlaza (solo plaza.acciones)');
});

// ---- Pantalla ----

test('Persona del padrón sin formulario: busca, muestra el nombre, confirma y devuelve el mapa', async () => {
  const ui = await montar();
  try {
    await ui.escribir('DNI de la persona', '30.111.222');
    await ui.pressButton('Buscar');
    assert.equal(ui.calls[0].url, '/api/emergencia/dispositivos/7/ingreso/persona/?dni=30111222');
    assert.ok(ui.labels().includes('Rosa Benítez'));
    await ui.pressButton('Continuar');
    assert.equal(ui.calls[1].url, '/api/emergencia/dispositivos/7/ingreso/formulario/');
    assert.ok(ui.labels().includes('Persona'), 'sin formulario salta a confirmar');
    assert.ok(ui.labels().some(l => l.includes('Cama A2-03') || l.includes('A2-03 · Aula 1')));
    await ui.pressButton('Ingresar persona');
    assert.ok(!post(ui), 'antes de confirmar no se manda nada');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.equal(post(ui).url, '/api/emergencia/dispositivos/7/ingresar/');
    assert.deepEqual(post(ui).body, {plaza_id: 41, ciudadano_id: 812});
    assert.deepEqual(ui.listos, [MAPA]);
    assert.deepEqual(ui.toasts.map(t => t.message), ['Persona ingresada']);
  } finally { await ui.close(); }
});

test('Persona alojada: muestra el mensaje y no deja seguir', async () => {
  const mensaje = 'La persona ya figura alojada en Club Sarmiento (C002) desde el 25/11/2026 09:30. Registrá el egreso o el traslado antes de alojarla de nuevo.';
  const ui = await montar({'GET /api/emergencia/dispositivos/7/ingreso/persona/': () => response(200, {...ROSA, alojada: true, alojamiento: {mensaje, dentro_del_alcance: true}})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    assert.ok(ui.labels().includes(mensaje));
    assert.ok(!ui.button('Continuar'), 'no hay Continuar');
  } finally { await ui.close(); }
});

test('Persona nueva: pide todos los datos, no avanza incompleta y manda persona_nueva', async () => {
  const ui = await montar({'GET /api/emergencia/dispositivos/7/ingreso/persona/': () => response(200, {encontrada: false})});
  try {
    await ui.escribir('DNI de la persona', '40111222');
    await ui.pressButton('Buscar');
    assert.ok(ui.labels().includes('La persona no está en el padrón'));
    await ui.pressButton('Continuar');
    assert.equal(ui.calls.length, 1, 'incompleta: no pide el formulario');
    assert.ok(ui.labels().includes('Falta el nombre.') && ui.labels().includes('Elegí el sexo.') && ui.labels().includes('Falta la fecha de nacimiento.'));
    await ui.escribir('Nombre', 'Lucía');
    await ui.escribir('Apellido', 'Ferreyra');
    await ui.press('Sexo: Femenino');
    await ui.fecha('17/05/1990');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.deepEqual(post(ui).body, {plaza_id: 41,
      persona_nueva: {dni: '40111222', nombre: 'Lucía', apellido: 'Ferreyra', sexo: 'F', fecha_nacimiento: '1990-05-17'}});
  } finally { await ui.close(); }
});

test('Formulario: se dibuja con el renderizador, valida obligatorios y manda respuestas con la versión (sin el archivo opcional)', async () => {
  const ui = await montar({'GET /api/emergencia/dispositivos/7/ingreso/formulario/': () => response(200, FORM)});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    assert.ok(ui.input('Cantidad de pertenencias') && ui.input('Observaciones'));
    assert.ok(!ui.input('Foto del DNI'), 'el archivo opcional no se dibuja');
    await ui.pressButton('Continuar');
    assert.ok(ui.labels().some(l => l.includes('Cantidad de pertenencias')), 'falta el obligatorio');
    assert.ok(!ui.button('Ingresar persona'));
    await ui.escribir('Cantidad de pertenencias', '3');
    await ui.escribir('Observaciones', 'Llega con mochila');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.deepEqual(post(ui).body, {plaza_id: 41, ciudadano_id: 812, formulario: {version: 4, respuestas: {c9: 3, c10: 'Llega con mochila'}}});
  } finally { await ui.close(); }
});

test('requiere_archivo: avisa «Este ingreso se hace desde el backoffice.» y no deja seguir', async () => {
  const ui = await montar({'GET /api/emergencia/dispositivos/7/ingreso/formulario/': () => response(200, {formulario: {...FORM.formulario, requiere_archivo: true}})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    assert.ok(ui.labels().includes('Este ingreso se hace desde el backoffice.'));
    assert.ok(!ui.button('Continuar') && !ui.button('Ingresar persona'));
  } finally { await ui.close(); }
});

test('409 FORMULARIO_CAMBIO: recarga el formulario, conserva lo escrito y reenvía con la versión nueva', async () => {
  let version = 4;
  const nuevo = () => ({formulario: {...FORM.formulario, version}});
  const ui = await montar({
    'GET /api/emergencia/dispositivos/7/ingreso/formulario/': () => response(200, nuevo()),
    'POST /api/emergencia/dispositivos/7/ingresar/': (call) => (call.body.formulario.version === 4
      ? response(409, {code: 'FORMULARIO_CAMBIO', detail: 'El formulario de ingreso cambió. Volvé a cargarlo.'})
      : response(201, {ok: true, estadia_id: 231, mapa: MAPA})),
  });
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    await ui.escribir('Cantidad de pertenencias', '2');
    await ui.pressButton('Continuar');
    version = 5;
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.ok(ui.labels().includes('El formulario de ingreso cambió. Volvé a cargarlo.'));
    assert.equal(ui.input('Cantidad de pertenencias').props.value, '2', 'conserva lo escrito');
    assert.equal(ui.listos.length, 0);
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    const envios = ui.calls.filter(c => c.method === 'POST');
    assert.equal(envios.length, 2);
    assert.deepEqual(envios[1].body.formulario, {version: 5, respuestas: {c9: 2}});
    assert.deepEqual(ui.listos, [MAPA]);
  } finally { await ui.close(); }
});

test('409 INGRESO_CON_ARCHIVO: avisa que se hace desde el backoffice y no repinta', async () => {
  const ui = await montar({'POST /api/emergencia/dispositivos/7/ingresar/': () => response(409, {code: 'INGRESO_CON_ARCHIVO', detail: 'Este ingreso se hace desde el backoffice.'})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.ok(ui.labels().includes('Este ingreso se hace desde el backoffice.'));
    assert.equal(ui.listos.length, 0);
  } finally { await ui.close(); }
});

test('400 en plaza_id: avisa que la cama se ocupó y vuelve al mapa refrescado (onListo(null))', async () => {
  const ui = await montar({'POST /api/emergencia/dispositivos/7/ingresar/': () => response(400, {code: 'VALIDACION', detail: 'La cama ya está ocupada.', plaza_id: ['La cama ya está ocupada.']})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    const alerta = ui.alerts[ui.alerts.length - 1];
    assert.equal(alerta[0], 'Cama ocupada');
    assert.match(alerta[1], /Esa cama se acaba de ocupar/);
    await renderer.act(async () => { await alerta[2][0].onPress(); });
    assert.deepEqual(ui.listos, [null]);
  } finally { await ui.close(); }
});

test('400 con claves: el error de cada campo vuelve al formulario', async () => {
  const ui = await montar({
    'GET /api/emergencia/dispositivos/7/ingreso/formulario/': () => response(200, FORM),
    'POST /api/emergencia/dispositivos/7/ingresar/': () => response(400, {code: 'VALIDACION', detail: 'No sirve.', respuestas: ['No sirve.'], claves: {c9: 'Tiene que ser menor a 100.'}}),
  });
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    await ui.escribir('Cantidad de pertenencias', '500');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.ok(ui.input('Cantidad de pertenencias'), 'vuelve al formulario');
    assert.ok(ui.labels().includes('Tiene que ser menor a 100.'));
  } finally { await ui.close(); }
});

test('Sin red no se manda nada; 403 SIN_PERMISO y 404 con su mensaje', async () => {
  const ui = await montar({'POST /api/emergencia/dispositivos/7/ingresar/': () => response(403, {code: 'SIN_PERMISO', detail: 'No tenés permiso para esta acción.'})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.ok(ui.labels().includes('No tenés permiso para esta acción.'));
  } finally { await ui.close(); }
  const nf = await montar({'GET /api/emergencia/dispositivos/7/ingreso/persona/': () => response(404, {detail: 'No encontrado.'})});
  try {
    await nf.escribir('DNI de la persona', '30111222');
    await nf.pressButton('Buscar');
    const alerta = nf.alerts[nf.alerts.length - 1];
    assert.equal(alerta[0], 'Cama no disponible');
    await renderer.act(async () => { await alerta[2][0].onPress(); });
    assert.equal(nf.cancelados.length, 1);
  } finally { await nf.close(); }
});

test('Sin doble envío: mientras el POST está en vuelo el botón queda deshabilitado y un segundo toque no manda', async () => {
  let soltar;
  const espera = new Promise(r => { soltar = r; });
  const ui = await montar({'POST /api/emergencia/dispositivos/7/ingresar/': async () => { await espera; return response(201, {ok: true, estadia_id: 1, mapa: MAPA}); }});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    await ui.pressButton('Ingresar persona');
    const boton = ui.alerts[ui.alerts.length - 1][2].find(b => b.text === 'Ingresar persona');
    await renderer.act(async () => { boton.onPress(); await esperar(5); });
    assert.equal(ui.button('Ingresar persona').props.disabled, true);
    await renderer.act(async () => { boton.onPress(); await esperar(5); });
    assert.equal(ui.calls.filter(c => c.method === 'POST').length, 1);
    await renderer.act(async () => { soltar(); await esperar(10); });
    assert.deepEqual(ui.listos, [MAPA]);
  } finally { await ui.close(); }
});

test('Cambiar el DNI descarta el resultado y obliga a buscar de nuevo', async () => {
  const ui = await montar();
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    assert.ok(ui.button('Continuar'));
    await ui.escribir('DNI de la persona', '30111223');
    assert.ok(!ui.button('Continuar') && ui.button('Buscar'));
  } finally { await ui.close(); }
});

test('Sin red: Buscar y el POST no salen a la red y se avisa', async () => {
  const ui = await montar();
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    await ui.pressButton('Continuar');
    ui.runtime.setOnline(false);
    await ui.pressButton('Ingresar persona');
    await confirmar(ui.alerts, 'Ingresar persona');
    assert.ok(!post(ui), 'sin red no sale ningún POST');
    const alerta = ui.alerts[ui.alerts.length - 1];
    assert.equal(alerta[0], 'Sin conexión');
    assert.equal(ui.listos.length, 0);
  } finally { await ui.close(); }
  const nuevo = await montar();
  try {
    nuevo.runtime.setOnline(false);
    await nuevo.escribir('DNI de la persona', '30111222');
    await nuevo.pressButton('Buscar');
    assert.equal(nuevo.calls.length, 0, 'sin red no se busca');
    assert.equal(nuevo.alerts[nuevo.alerts.length - 1][0], 'Sin conexión');
  } finally { await nuevo.close(); }
});

test('429 en la búsqueda: Buscar queda deshabilitado con cuenta regresiva hasta el Retry-After', async () => {
  const ui = await montar({'GET /api/emergencia/dispositivos/7/ingreso/persona/': () => response(429, {detail: 'Throttled'}, {'Retry-After': '30'})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    assert.equal(ui.calls.length, 1);
    const boton = ui.tree.root.findAllByType('CustomButton').find(b => /^Buscar/.test(b.props.title));
    assert.match(boton.props.title, /^Buscar en (29|30) s$/);
    assert.equal(boton.props.disabled, true);
    await renderer.act(async () => { await boton.props.onPress(); });
    assert.equal(ui.calls.length, 1, 'durante la espera no se manda otra búsqueda');
  } finally { await ui.close(); }
});

test('Un 400 en el DNI se ve una sola vez (en el campo) y el error de una clave se limpia al editarla', async () => {
  const ui = await montar({'GET /api/emergencia/dispositivos/7/ingreso/persona/': () => response(400, {code: 'VALIDACION', detail: 'El DNI no es válido.', dni: ['El DNI no es válido.']})});
  try {
    await ui.escribir('DNI de la persona', '30111222');
    await ui.pressButton('Buscar');
    assert.equal(ui.labels().filter(l => l === 'El DNI no es válido.').length, 1);
  } finally { await ui.close(); }
  const f = await montar({
    'GET /api/emergencia/dispositivos/7/ingreso/formulario/': () => response(200, FORM),
    'POST /api/emergencia/dispositivos/7/ingresar/': () => response(400, {code: 'VALIDACION', detail: 'No sirve.', claves: {c9: 'Tiene que ser menor a 100.'}}),
  });
  try {
    await f.escribir('DNI de la persona', '30111222');
    await f.pressButton('Buscar');
    await f.pressButton('Continuar');
    await f.escribir('Cantidad de pertenencias', '500');
    await f.pressButton('Continuar');
    await f.pressButton('Ingresar persona');
    await confirmar(f.alerts, 'Ingresar persona');
    assert.equal(f.labels().filter(l => l === 'Tiene que ser menor a 100.').length, 1);
    assert.ok(!f.labels().includes('No sirve.'), 'el aviso general no repite el error del campo');
    await f.escribir('Cantidad de pertenencias', '50');
    assert.ok(!f.labels().includes('Tiene que ser menor a 100.'));
  } finally { await f.close(); }
});
