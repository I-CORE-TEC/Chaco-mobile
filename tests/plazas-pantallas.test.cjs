// Pantallas de Plazas y estadías (lectura) montadas sobre el servicio real con fetch simulado:
// edificios, mapa con su hoja de cama y estadías con filtros y paginado.
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
const native = Object.fromEntries(['View', 'Text', 'ScrollView', 'Pressable', 'ActivityIndicator', 'RefreshControl', 'Modal']
  .map(name => [name, name]));
Object.assign(native, {StyleSheet: {create: value => value}, Platform: {OS: 'android'}});
const theme = {colors: new Proxy({}, {get: () => '#5059BC'})};
const typography = {bold: 'Manrope', medium: 'Manrope', semibold: 'Manrope', regular: 'Manrope'};
const text = node => node.children.map(value => typeof value === 'string' ? value : text(value)).join('');
const esperar = () => new Promise(resolve => setTimeout(resolve, 0));

const cargarModulo = (relative, mocks) => {
  const filename = path.join(root, relative);
  const {code} = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  const context = vm.createContext({console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Date});
  vm.runInContext('(function(require,module,exports){' + code + '\n})', context)(
    name => { assert.ok(mocks[name], 'Missing screen mock: ' + name); return mocks[name]; }, module, module.exports);
  return module.exports;
};
const cargarPuro = (relative) => cargarModulo(relative, {});

async function preparar() {
  const r = await setup();
  r.setFetch(async () => response(200, {token: 'tok', user_id: 7, username: 'agente', modulos: ['emergencia']}));
  await r.api.loginBecas({username: 'agente', password: 'x'});
  const plazas = r.load('./plazasApi');
  const base = {
    react: React, 'react-native': native, '@expo/vector-icons': {Ionicons: 'Ionicons'},
    '../context/ThemeContext': {useTheme: () => ({theme, typography})},
    '../theme/statusBadges': cargarPuro('src/theme/statusBadges.js'),
    '../theme': cargarPuro('src/theme/tokens.js'),
    '../components/CustomButton': {__esModule: true, default: 'CustomButton'},
    '../services/plazasApi': plazas,
  };
  const ui = cargarModulo('src/components/PlazasUi.js', {...base, './CustomButton': base['../components/CustomButton']});
  const mocks = {...base, '../components/PlazasUi': ui};
  const pantalla = (archivo) => cargarModulo(`src/screens/${archivo}.js`, mocks).default;
  return {r, pantalla};
}

const montar = async (Screen, props) => {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen, props)); });
  await renderer.act(async () => { await esperar(); });
  return {
    tree,
    textos: () => tree.root.findAll(n => n.type === 'Text').map(text),
    botones: () => tree.root.findAll(n => n.type === 'Pressable' || n.type === 'CustomButton'),
    toca: async (etiqueta) => {
      const nodo = tree.root.findAll(n => (n.type === 'Pressable' && n.props.accessibilityLabel === etiqueta)
        || (n.type === 'CustomButton' && n.props.title === etiqueta))[0];
      assert.ok(nodo, 'No hay botón ' + etiqueta);
      await renderer.act(async () => { nodo.props.onPress(); });
      await renderer.act(async () => { await esperar(); });
    },
    cierra: () => renderer.act(async () => tree.unmount()),
  };
};

const MAPA = {
  dispositivo: {id: 3, nombre: 'Centro', estado: 'ACTIVO'}, edificio: {id: 9, nombre: 'Pabellón A'},
  resumen: {total: 3, libres: 1, ocupadas: 1, reservadas: 1, prestadas: 0, fuera_servicio: 0},
  puede: {egresar: true, admitir: true, editar: false, ver_personas: false},
  sectores: [{id: 1, nombre: 'Aula 1', tipo: 'aula', resumen: {total: 3, ocupadas: 1}, plazas: [
    {id: 10, codigo: 'A1-01', estado: 'ocupada', persona: {nombre: 'Gómez, Lucía', dni: null}, estadia_id: 5,
      desde: '2026-11-18T21:40:00-03:00', acciones: ['egresar', 'reubicar']},
    {id: 11, codigo: 'A1-02', estado: 'disponible', persona: null, acciones: ['reservar']},
    {id: 12, codigo: 'A1-03', estado: 'reservada', persona: null, acciones: ['liberar']},
  ]}],
};

const EDIFICIO_A = {dispositivo: {id: 3, nombre: 'Centro'}, edificio: {id: 9, nombre: 'Pabellón A', direccion: 'Calle 1'},
  resumen: {total: 48, libres: 12, ocupadas: 31, reservadas: 3, prestadas: 0, fuera_servicio: 0}};
const EDIFICIO_B = {dispositivo: {id: 3, nombre: 'Centro'}, edificio: {id: 10, nombre: 'Pabellón B', direccion: 'Calle 2'},
  resumen: {total: 10, libres: 10, ocupadas: 0, reservadas: 0, prestadas: 0, fuera_servicio: 0}};

test('Edificios: con un solo edificio entra directo a su mapa; con entrarDirecto={false} muestra la lista (sin bucle)', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, [EDIFICIO_A]));
  const elegidos = [];
  const directo = await montar(pantalla('PlazasEdificiosScreen'), {onElegir: (item, opciones) => elegidos.push([item.edificio.id, opciones.unico])});
  try {
    assert.deepEqual(elegidos, [[9, true]]);
  } finally { await directo.cierra(); }
  const vuelta = await montar(pantalla('PlazasEdificiosScreen'), {entrarDirecto: false, onElegir: () => elegidos.push('bucle')});
  try {
    assert.deepEqual(elegidos, [[9, true]]);
    assert.ok(vuelta.textos().includes('Pabellón A'));
  } finally { await vuelta.cierra(); }
});

test('Edificios: lista con el resumen de camas y abre el elegido (unico: false)', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, [EDIFICIO_A, EDIFICIO_B]));
  const elegidos = [];
  const v = await montar(pantalla('PlazasEdificiosScreen'), {onElegir: (item, opciones) => elegidos.push([item.edificio.id, opciones.unico])});
  try {
    const t = v.textos();
    assert.ok(t.includes('Pabellón A'));
    assert.ok(t.includes('12 libres') && t.includes('31 ocupadas') && t.includes('3 reservadas'));
    assert.ok(!t.some(x => /fuera de servicio/.test(x)));
    await v.toca(v.botones().map(b => b.props.accessibilityLabel).find(l => l && l.startsWith('Pabellón A')));
    assert.deepEqual(elegidos, [[9, false]]);
  } finally { await v.cierra(); }
});

test('Edificios: sin conexión dice que hace falta conexión y Reintentar vuelve a pedir', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => { throw new TypeError('Network request failed'); });
  const v = await montar(pantalla('PlazasEdificiosScreen'), {});
  try {
    assert.ok(v.textos().includes('Necesitás conexión para ver las plazas'));
    r.setFetch(async () => response(200, []));
    await v.toca('Reintentar');
    assert.ok(v.textos().includes('No tenés edificios con plazas para gestionar.'));
    assert.ok(!v.textos().includes('Necesitás conexión para ver las plazas'));
  } finally { await v.cierra(); }
});

test('Mapa: pide el mapa, lo informa por onMapaActualizado y pinta las camas', async () => {
  const {r, pantalla} = await preparar();
  const pedidos = [];
  r.setFetch(async (url) => { pedidos.push(String(url)); return response(200, MAPA); });
  const Mapa = pantalla('PlazasMapaScreen');
  let recibido = null;
  const props = {dispositivoId: 3, edificioId: 9, mapa: null, onMapaActualizado: m => { recibido = m; }};
  const v = await montar(Mapa, props);
  try {
    assert.ok(pedidos[0].endsWith('/api/emergencia/dispositivos/3/edificios/9/mapa/'));
    assert.equal(recibido.sectores[0].plazas.length, 3);
    // El padre guarda el mapa y vuelve a pasarlo.
    await renderer.act(async () => { v.tree.update(React.createElement(Mapa, {...props, mapa: recibido})); await esperar(); });
    const t = v.textos();
    assert.ok(t.includes('Aula 1') && t.includes('1 de 3 ocupadas'));
    assert.ok(t.includes('Estadías · 1'));
    assert.ok(t.includes('Gómez, L.') && t.includes('Libre') && t.includes('Reserv.'));
  } finally { await v.cierra(); }
});

test('Mapa: tocar una cama abre el detalle sin «null»; solo lectura no muestra acciones', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, MAPA));
  const Mapa = pantalla('PlazasMapaScreen');
  const normalizado = (await preparar()).r.load('./plazasApi').normalizarMapa(MAPA);
  const v = await montar(Mapa, {dispositivoId: 3, edificioId: 9, mapa: normalizado, onMapaActualizado() {}});
  try {
    await v.toca('Cama A1-01, ocupada, Gómez, Lucía');
    const t = v.textos();
    assert.ok(t.includes('Cama A1-01') && t.includes('Ocupada') && t.includes('Gómez, Lucía') && t.includes('18/11 21:40'));
    assert.ok(!t.some(x => /null|DNI/.test(x)));
    assert.ok(!v.botones().some(b => b.type === 'CustomButton'));
  } finally { await v.cierra(); }
});

test('Mapa: con abrirAccion la hoja muestra un botón por acción y lo llama con la cama', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, MAPA));
  const normalizado = r.load('./plazasApi').normalizarMapa(MAPA);
  const llamadas = [];
  const v = await montar(pantalla('PlazasMapaScreen'), {dispositivoId: 3, edificioId: 9, mapa: normalizado, onMapaActualizado() {},
    abrirAccion: (accion, datos) => llamadas.push([accion, datos.plaza.codigo, datos.dispositivoId, datos.edificioId])});
  try {
    await v.toca('Cama A1-01, ocupada, Gómez, Lucía');
    await v.toca('Registrar egreso');
    await v.toca('Cambiar de cama');
    assert.deepEqual(llamadas, [['egresar', 'A1-01', 3, 9], ['reubicar', 'A1-01', 3, 9]]);
  } finally { await v.cierra(); }
});

test('Estadías: filtros por estado y sector, paginado con «Ver más» y sin botones en solo lectura', async () => {
  const {r, pantalla} = await preparar();
  const item = id => ({id, persona: {nombre: `Persona ${id}`, dni: null}, sector: {id: 1, nombre: 'Aula 1'}, plaza: {id, codigo: `A-${id}`},
    fecha_ingreso: '2026-11-18T21:40:00-03:00', fecha_egreso: null, estado: 'activa', emergencia: {caso_numero: 128}, acciones: ['egresar', 'reubicar']});
  const pedidos = [];
  r.setFetch(async (url) => {
    const u = String(url).replace('https://example.test', '');
    pedidos.push(u);
    if (u.includes('page=2')) return response(200, {count: 3, next: null, previous: 'x', results: [item(3)]});
    return response(200, {count: 3, next: 'https://example.test/x?page=2', previous: null, results: [item(1), item(2)]});
  });
  const sectores = [{id: 1, nombre: 'Aula 1'}, {id: 2, nombre: 'Aula 2'}];
  const v = await montar(pantalla('PlazasEstadiasScreen'), {dispositivoId: 3, edificioId: 9, sectores, total: 3});
  try {
    assert.ok(pedidos[0].endsWith('/estadias/?estado=activa'));
    assert.ok(v.textos().includes('Persona 1') && v.textos().includes('Persona 2'));
    assert.ok(v.textos().includes('Emergencia · Caso 128'));
    assert.ok(!v.textos().some(x => /null/.test(x)));
    assert.ok(!v.botones().some(b => b.type === 'CustomButton' && b.props.title === 'Egreso'));
    await v.toca('Ver más');
    assert.ok(pedidos[1].endsWith('/estadias/?estado=activa&page=2'));
    assert.ok(v.textos().includes('Persona 3'));
    assert.ok(!v.botones().some(b => b.type === 'CustomButton' && b.props.title === 'Ver más'));
    await v.toca('Filtrar: Egresadas');
    assert.ok(pedidos.at(-1).endsWith('/estadias/?estado=egresada'));
    await v.toca('Filtrar: Aula 2');
    assert.ok(pedidos.at(-1).endsWith('/estadias/?estado=egresada&sector=2'));
  } finally { await v.cierra(); }
});

test('Estadías: con abrirAccion cada tarjeta ofrece Egreso y Cambiar de cama', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, {count: 1, next: null, previous: null, results: [{id: 7, persona: {nombre: 'Rios, C.', dni: '30123456'},
    sector: {id: 1, nombre: 'Aula 1'}, plaza: {id: 1, codigo: 'A-1'}, fecha_ingreso: '2026-11-18T21:40:00-03:00', estado: 'activa', acciones: ['egresar', 'reubicar']}]}));
  const llamadas = [];
  const v = await montar(pantalla('PlazasEstadiasScreen'), {dispositivoId: 3, edificioId: 9,
    abrirAccion: (accion, datos) => llamadas.push([accion, datos.estadia.id])});
  try {
    assert.ok(v.textos().some(x => x.includes('DNI 30.123.456')));
    await v.toca('Egreso');
    await v.toca('Cambiar de cama');
    assert.deepEqual(llamadas, [['egresar', 7], ['reubicar', 7]]);
  } finally { await v.cierra(); }
});

test('Estadías: al cambiar de filtro se vacía la lista y el «Ver más» mientras carga el filtro nuevo', async () => {
  const {r, pantalla} = await preparar();
  const item = id => ({id, persona: {nombre: `Persona ${id}`, dni: null}, sector: {id: 1, nombre: 'Aula 1'}, plaza: {id, codigo: `A-${id}`},
    fecha_ingreso: '2026-11-18T21:40:00-03:00', fecha_egreso: null, estado: 'activa', emergencia: null, acciones: []});
  let liberar;
  const lenta = new Promise(resolve => { liberar = resolve; });
  r.setFetch(async (url) => {
    const u = String(url);
    if (u.includes('estado=egresada')) { await lenta; return response(200, {count: 1, next: null, previous: null, results: [item(9)]}); }
    return response(200, {count: 3, next: 'https://example.test/x?page=2', previous: null, results: [item(1), item(2)]});
  });
  const v = await montar(pantalla('PlazasEstadiasScreen'), {dispositivoId: 3, edificioId: 9, sectores: [], total: 3});
  try {
    assert.ok(v.textos().includes('Persona 1'));
    assert.ok(v.botones().some(b => b.type === 'CustomButton' && b.props.title === 'Ver más'));
    await v.toca('Filtrar: Egresadas');
    assert.ok(!v.textos().includes('Persona 1'), 'las filas del filtro anterior no quedan a la vista');
    assert.ok(!v.botones().some(b => b.type === 'CustomButton' && b.props.title === 'Ver más'), 'ni el Ver más del filtro anterior');
    liberar();
    await v.toca('Filtrar: Egresadas');
  } finally { await v.cierra(); }
});

test('Mapa: con bloqueo, «Sacar de servicio» de la hoja va deshabilitado con el texto debajo', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, MAPA));
  const conBloqueo = JSON.parse(JSON.stringify(MAPA));
  conBloqueo.sectores[0].plazas[1] = {...conBloqueo.sectores[0].plazas[1], acciones: ['reservar', 'fuera_servicio'], bloqueo: 'Hay una reserva vigente.'};
  const normalizado = r.load('./plazasApi').normalizarMapa(conBloqueo);
  const v = await montar(pantalla('PlazasMapaScreen'), {dispositivoId: 3, edificioId: 9, mapa: normalizado, onMapaActualizado() {}, abrirAccion() {}});
  try {
    await v.toca(v.botones().map(b => b.props.accessibilityLabel).find(l => l && l.startsWith('Cama A1-02')));
    const sacar = v.botones().find(b => b.type === 'CustomButton' && b.props.title === 'Sacar de servicio');
    assert.equal(sacar.props.disabled, true);
    assert.ok(v.textos().includes('Hay una reserva vigente.'));
    const reservar = v.botones().find(b => b.type === 'CustomButton' && b.props.title === 'Reservar');
    assert.ok(!reservar.props.disabled);
  } finally { await v.cierra(); }
});

test('Mapa: la hoja pasa el sector de la cama a abrirAccion (lo usa «Ingresar persona»)', async () => {
  const {r, pantalla} = await preparar();
  r.setFetch(async () => response(200, MAPA));
  const normalizado = r.load('./plazasApi').normalizarMapa(MAPA);
  const sectores = [];
  const v = await montar(pantalla('PlazasMapaScreen'), {dispositivoId: 3, edificioId: 9, mapa: normalizado, onMapaActualizado() {},
    abrirAccion: (accion, datos) => sectores.push(datos.sector && datos.sector.nombre)});
  try {
    await v.toca('Cama A1-01, ocupada, Gómez, Lucía');
    await v.toca('Registrar egreso');
    assert.ok(normalizado.sectores[0].nombre);
    assert.deepEqual(sectores, [normalizado.sectores[0].nombre]);
  } finally { await v.cierra(); }
});
