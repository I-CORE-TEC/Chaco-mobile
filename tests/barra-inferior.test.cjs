// Barra inferior de todos los módulos: entradas por módulo, entrada activa, accesibilidad y teclado.
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
  const {code} = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  vm.runInContext('(function(require,module,exports){' + code + '\n})', context)(name => {
    assert.ok(mocks[name], 'Missing mock: ' + name);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

const tokens = (() => {
  const exported = {};
  const code = transformSync(fs.readFileSync(path.join(root, 'src/theme/tokens.js'), 'utf8'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs']}).code;
  vm.runInNewContext(code, {exports: exported});
  return exported;
})();

const ITEMS = [
  {id: 'Inicio', label: 'Inicio', icon: 'home-outline', activeIcon: 'home'},
  {id: 'Relevamientos', label: 'Relevamientos', icon: 'clipboard-outline', activeIcon: 'clipboard', punto: true},
  {id: 'Cuenta', label: 'Cuenta', icon: 'person-circle-outline', activeIcon: 'person-circle', cantidad: 3},
];

async function montarBarra({teclado = false, bottom = 34, activeTab = 'Inicio', alTocar = () => {}} = {}) {
  const nativos = {
    View: 'View', Text: 'Text', Pressable: 'Pressable',
    StyleSheet: {create: v => v},
  };
  const theme = {colors: new Proxy({}, {get: (_, clave) => '#' + clave})};
  const BottomNav = cargar('src/components/BottomNav.js', {
    react: React, 'react-native': nativos,
    '@expo/vector-icons': {Ionicons: 'Ionicons'},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom})},
    '../context/ThemeContext': {useTheme: () => ({theme, isDark: false, typography: {bold: 'B', medium: 'M'}})},
    '../hooks/useTecladoAbierto': {__esModule: true, default: () => teclado},
    '../theme': tokens,
    './AvisosContador': {__esModule: true, default: 'AvisosContador'},
  }).default;
  let arbol;
  await renderer.act(async () => {
    arbol = renderer.create(React.createElement(BottomNav, {items: ITEMS, activeTab, onTabPress: alTocar}));
  });
  return arbol;
}

test('barra: una entrada por item, con rol tab, etiqueta y estado seleccionado solo en la activa', async () => {
  const arbol = await montarBarra({activeTab: 'Relevamientos'});
  const tabs = arbol.root.findAllByProps({accessibilityRole: 'tab'});
  assert.deepEqual([...tabs.map(t => t.props.accessibilityLabel)], ['Inicio', 'Relevamientos', 'Cuenta, 3 avisos sin leer']);
  assert.deepEqual([...tabs.map(t => t.props.accessibilityState.selected)], [false, true, false]);
  assert.equal(arbol.root.findAllByType('AvisosContador').length, 3);
  assert.equal(arbol.root.findAllByType('AvisosContador').at(-1).props.cantidad, 3);
});

test('barra: tocar una entrada avisa con su id', async () => {
  const tocadas = [];
  const arbol = await montarBarra({alTocar: id => tocadas.push(id)});
  const tabs = arbol.root.findAllByProps({accessibilityRole: 'tab'});
  tabs[2].props.onPress();
  tabs[1].props.onPress();
  assert.deepEqual(tocadas, ['Cuenta', 'Relevamientos']);
});

test('barra: objetivos táctiles de al menos 44 px y área segura de abajo', async () => {
  const arbol = await montarBarra({bottom: 34});
  const [entrada] = arbol.root.findAllByProps({accessibilityRole: 'tab'});
  const estilo = Object.assign({}, ...[].concat(entrada.props.style({pressed: false})).filter(Boolean));
  assert.ok(estilo.minHeight >= 44);
  const lista = arbol.root.findByProps({accessibilityRole: 'tablist'});
  const estiloBarra = Object.assign({}, ...lista.props.style);
  assert.equal(estiloBarra.paddingBottom, 34);
});

test('barra: con el teclado abierto no se dibuja', async () => {
  const arbol = await montarBarra({teclado: true});
  assert.equal(arbol.toJSON(), null);
});

test('teclado web: abierto solo con el viewport achicado y un campo enfocado', () => {
  const {tecladoAbiertoWeb} = cargar('src/utils/tecladoAbierto.js', {});
  assert.equal(tecladoAbiertoWeb({alturaMaxima: 800, alturaVisible: 450, enfocadoEditable: true}), true);
  assert.equal(tecladoAbiertoWeb({alturaMaxima: 800, alturaVisible: 450, enfocadoEditable: false}), false);
  assert.equal(tecladoAbiertoWeb({alturaMaxima: 800, alturaVisible: 760, enfocadoEditable: true}), false);
});

// Las entradas de cada módulo: se leen de la fuente para que agregar o quitar una sea una decisión visible.
const entradasDe = (archivo) => {
  const fuente = fs.readFileSync(path.join(root, archivo), 'utf8');
  const bloque = fuente.match(/const PESTANAS = \[([\s\S]*?)\n\];/)[1];
  return [...bloque.matchAll(/id: '([^']+)', label: '([^']+)'/g)].map(m => m[1] + ':' + m[2]);
};

test('cada módulo declara sus entradas: ninguno usa ya el panel lateral ni un botón «Menú»', () => {
  assert.deepEqual(entradasDe('src/navigation/BecasApp.js'), ['Inicio:Inicio', 'Relevamientos:Relevamientos', 'Cuenta:Cuenta']);
  assert.deepEqual(entradasDe('src/navigation/DispositivosApp.js'), ['inicio:Inicio', 'cuenta:Cuenta']);
  assert.deepEqual(entradasDe('src/navigation/EmergenciaApp.js'), ['inicio:Inicio', 'cuenta:Cuenta']);
  for (const archivo of ['BecasApp', 'DispositivosApp', 'EmergenciaApp']) {
    const fuente = fs.readFileSync(path.join(root, 'src/navigation', archivo + '.js'), 'utf8');
    assert.ok(!/SettingsPanel/.test(fuente), archivo + ' no debe usar el panel lateral');
    assert.ok(!/title="Menú"/.test(fuente), archivo + ' no debe tener el botón «Menú»');
    assert.ok(/<BottomNav[^A-Za-z]/.test(fuente), archivo + ' usa la barra inferior');
  }
  assert.ok(!fs.existsSync(path.join(root, 'src/components/SettingsPanel.js')));
});

test('Becas: el Atrás de Android y del navegador vuelve a Inicio desde otra pestaña, salvo con el detalle de un relevamiento abierto', () => {
  const fuente = fs.readFileSync(path.join(root, 'src/navigation/BecasApp.js'), 'utf8');
  assert.ok(/import useBotonAtras from '\.\.\/hooks\/useBotonAtras'/.test(fuente), 'importa el hook');
  assert.ok(/useBotonAtras\(\{\s*activo: activeTab !== 'Inicio' && !selectedRelevamientoId,\s*alAtras: \(\) => handleTabPress\('Inicio'\)\s*\}\)/.test(fuente),
    'activo fuera de Inicio y sin detalle; Atrás vuelve a Inicio');
});
