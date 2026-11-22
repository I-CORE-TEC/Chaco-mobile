// components/InterruptorSiNo.js (#1300): el interruptor Sí/No que reemplaza a las casillas de Emergencia.
// Se distingue por color, por posición, por la tilde y por el texto; toda la fila es el área táctil.
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
const native = {View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: (v) => v}};
const theme = {colors: {primary: '#5059BC', text: '#111827', textMuted: '#4B5563', surface: '#FFFFFF'}};
const typography = {bold: 'B', medium: 'M', semibold: 'S'};

function cargar(relative, mocks) {
  const filename = path.join(root, relative);
  const {code} = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs']});
  const module = {exports: {}};
  vm.runInContext('(function(require,module,exports){' + code + '\n})', vm.createContext({console}))(
    (name) => { assert.ok(mocks[name], 'Missing mock: ' + name); return mocks[name]; }, module, module.exports);
  return module.exports.default;
}
const Interruptor = cargar('src/components/InterruptorSiNo.js', {
  react: React, 'react-native': native, '@expo/vector-icons': {Ionicons: 'Ionicons'},
  '../context/ThemeContext': {useTheme: () => ({theme, typography})},
  '../theme': {fontSizes: {sm: 14}},
});
const aplanar = (estilo) => Object.assign({}, ...[].concat(estilo).flat(9).filter(Boolean));
const texto = (n) => n.children.map((v) => (typeof v === 'string' ? v : texto(v))).join('');
const luminancia = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const pistaDe = (t) => t.root.findAllByType('View').find((n) => aplanar(n.props.style).borderRadius === 16);

function montar(props) {
  let tree;
  renderer.act(() => { tree = renderer.create(React.createElement(Interruptor, {titulo: 'Embarazo', onChange: () => {}, ...props})); });
  return tree;
}

test('apagado y prendido se distinguen por posición, color, tilde y texto', () => {
  const apagado = montar({valor: false});
  const prendido = montar({valor: true});
  assert.equal(aplanar(pistaDe(apagado).props.style).justifyContent, 'flex-start');
  assert.equal(aplanar(pistaDe(prendido).props.style).justifyContent, 'flex-end');
  assert.notEqual(aplanar(pistaDe(apagado).props.style).backgroundColor, aplanar(pistaDe(prendido).props.style).backgroundColor);
  assert.equal(apagado.root.findAllByType('Ionicons').length, 0);
  assert.equal(prendido.root.findAllByType('Ionicons')[0].props.name, 'checkmark');
  assert.deepEqual([apagado, prendido].map((t) => t.root.findAllByType('Text').map(texto)), [['Embarazo', 'No'], ['Embarazo', 'Sí']]);
});

test('accesible: rol switch, estado y etiqueta en una sola fila táctil de al menos 44 de alto', () => {
  const t = montar({valor: true});
  const [fila] = t.root.findAllByType('Pressable');
  assert.equal(fila.props.accessibilityRole, 'switch');
  assert.equal(fila.props.accessibilityLabel, 'Embarazo');
  assert.equal(fila.props.accessibilityState.checked, true);
  assert.ok(aplanar(fila.props.style).minHeight >= 44);
  assert.ok(aplanar(pistaDe(t).props.style).height >= 32 && aplanar(pistaDe(t).props.style).width >= 56);
});

test('tocar la fila (la etiqueta incluida) invierte el valor; deshabilitado no responde', () => {
  const cambios = [];
  const t = montar({valor: false, onChange: (v) => cambios.push(v)});
  renderer.act(() => { t.root.findByType('Pressable').props.onPress(); });
  assert.deepEqual(cambios, [true]);
  const t2 = montar({valor: true, onChange: (v) => cambios.push(v)});
  renderer.act(() => { t2.root.findByType('Pressable').props.onPress(); });
  assert.deepEqual(cambios, [true, false]);
  const t3 = montar({valor: false, deshabilitado: true});
  assert.equal(t3.root.findByType('Pressable').props.disabled, true);
  assert.equal(t3.root.findByType('Pressable').props.accessibilityState.disabled, true);
});

test('contraste AA en los dos estados (tema claro): borde apagado, pista prendida, perilla y textos', () => {
  const apagado = montar({valor: false});
  const prendido = montar({valor: true});
  assert.ok(contraste(aplanar(pistaDe(apagado).props.style).borderColor, theme.colors.surface) >= 3, 'borde apagado >= 3:1');
  assert.ok(contraste(aplanar(pistaDe(prendido).props.style).backgroundColor, theme.colors.surface) >= 3, 'pista prendida >= 3:1');
  assert.ok(contraste('#FFFFFF', aplanar(pistaDe(prendido).props.style).backgroundColor) >= 4.5, 'perilla blanca sobre la pista');
  assert.ok(contraste(theme.colors.textMuted, theme.colors.surface) >= 4.5, 'el «No» legible');
  assert.ok(contraste(theme.colors.primary, theme.colors.surface) >= 4.5, 'el «Sí» legible');
});
