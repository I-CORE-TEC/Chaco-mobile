// Stock (lectura, §17 del contrato): rutas, paginado por cursor, normalización, `clasificarError` por code y la
// clave `stock` del perfil, con el cliente real sobre fetch simulado.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup, response} = require('./helpers/mobile-runtime.cjs');

async function preparar() {
  const r = await setup();
  r.setFetch(async () => response(200, {token: 'tok', user_id: 7, username: 'stock', modulos: ['emergencia']}));
  await r.api.loginBecas({username: 'stock', password: 'x'});
  return {r, s: r.load('./stockApi')};
}
const pedidos = (r, handler) => {
  const calls = [];
  r.setFetch(async (url, init = {}) => {
    const call = {url: String(url).replace('https://example.test', ''), method: init.method || 'GET'};
    calls.push(call);
    return handler(call);
  });
  return calls;
};
// Lo que sale del runtime (vm) tiene otros prototipos: se compara por contenido.
const igual = (actual, esperado) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), esperado);

const PAR = {dispositivo: {id: 7, nombre: 'Sede Central'}, edificio: {id: 3, nombre: 'Edificio Alfa'}, insumos_con_saldo: 4,
  puede: {entregar: true, ingresar: true, ajustar: false}};
const mov = (id, extra = {}) => ({id, tipo: 'ENTREGA_PERSONA', item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: -2,
  saldo_posterior: 18, creado_en: '2026-11-26T10:00:00-03:00', usuario: 'Gabi Guardia', detalle: 'Entrega a persona', ...extra});

test('perfil: la clave stock es aditiva y solo con true habilita «Stock»; no suma ninguna tarjeta de campo', async () => {
  const r = await setup();
  const e = r.load('./emergenciaPerfil');
  assert.equal(e.normalizarPerfil({relevar: true}).stock, false, 'un back anterior no la trae');
  assert.equal(e.normalizarPerfil({stock: 'si'}).stock, false);
  assert.equal(e.normalizarPerfil({stock: true}).stock, true);
  const soloStock = e.normalizarPerfil({relevar: false, llegadas: false, kits: false, dispositivo: false, plazas: false, stock: true});
  igual(e.accesosDelPerfil(soloStock), [], 'solo stock: ni Plazas ni las pantallas de campo');
});

test('las rutas siguen la §17', async () => {
  const {s} = await preparar();
  assert.equal(s.RUTAS.lista, '/api/emergencia/stock/');
  assert.equal(s.RUTAS.saldo(7, 3), '/api/emergencia/dispositivos/7/edificios/3/stock/');
  assert.equal(s.RUTAS.movimientos(7, 3), '/api/emergencia/dispositivos/7/edificios/3/stock/movimientos/');
});

test('getPares y getSaldo piden las URLs del contrato y normalizan', async () => {
  const {r, s} = await preparar();
  const calls = pedidos(r, (call) => (call.url.endsWith('/stock/') && call.url.includes('/edificios/')
    ? response(200, {dispositivo: PAR.dispositivo, edificio: PAR.edificio, puede: PAR.puede,
      saldos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad', cantidad: 18, activo: true},
        {item_id: 15, nombre: 'Frazada', unidad: 'unidad', cantidad: 2, activo: false}, {nombre: 'sin id'}],
      insumos_activos: [{item_id: 12, nombre: 'Colchón', unidad: 'unidad'}]})
    : response(200, [PAR, {dispositivo: {id: 8}, edificio: {}}])));
  const pares = await s.getPares();
  igual(pares, [PAR]);
  assert.equal(calls[0].url, '/api/emergencia/stock/');
  const saldo = await s.getSaldo(7, 3);
  assert.equal(calls[1].url, '/api/emergencia/dispositivos/7/edificios/3/stock/');
  igual(saldo.saldos.map((x) => [x.item_id, x.cantidad, x.activo]), [[12, 18, true], [15, 2, false]]);
  assert.equal(saldo.puede.ajustar, false);
  assert.equal(s.textoInsumosConSaldo(4), '4 insumos con saldo');
  assert.equal(s.textoInsumosConSaldo(1), '1 insumo con saldo');
  assert.equal(s.textoInsumosConSaldo(0), 'Sin saldo');
  assert.equal(s.textoCantidad(18, 'unidad'), '18 unidad');
});

test('movimientos: query con tipo, item y cursor solo si vienen, y el cursor se escapa', async () => {
  const {s} = await preparar();
  assert.equal(s.armarQueryMovimientos(), '');
  assert.equal(s.armarQueryMovimientos({cursor: null, tipo: '', item: undefined}), '');
  assert.equal(s.armarQueryMovimientos({cursor: 41}), '?cursor=41');
  assert.equal(s.armarQueryMovimientos({tipo: 'ENTREGA_PERSONA', item: 12, cursor: 41}), '?tipo=ENTREGA_PERSONA&item=12&cursor=41');
  assert.equal(s.armarQueryMovimientos({item: 0}), '?item=0');
  assert.equal(s.armarQueryMovimientos({cursor: 'a b&c'}), '?cursor=a%20b%26c');
});

test('paginado por cursor: la primera sin cursor, la siguiente con el `siguiente` anterior, sin repetir y sin más al final', async () => {
  const {r, s} = await preparar();
  const calls = pedidos(r, (call) => (call.url.includes('cursor=41')
    ? response(200, {resultados: [mov(41), mov(40)], siguiente: null})
    : response(200, {resultados: [mov(90), mov(41)], siguiente: 41})));
  const primera = await s.getMovimientos(7, 3);
  assert.equal(calls[0].url, '/api/emergencia/dispositivos/7/edificios/3/stock/movimientos/');
  assert.equal(primera.hayMas, true);
  assert.equal(primera.siguiente, 41);
  const segunda = await s.getMovimientos(7, 3, {cursor: primera.siguiente});
  assert.equal(calls[1].url, '/api/emergencia/dispositivos/7/edificios/3/stock/movimientos/?cursor=41');
  assert.equal(segunda.hayMas, false);
  assert.equal(segunda.siguiente, null);
  igual(s.juntarMovimientos(primera.resultados, segunda).map((m) => m.id), [90, 41, 40]);
  assert.equal(s.textoVariacion(-2), '−2');
  assert.equal(s.textoVariacion(5), '+5');
  assert.equal(s.textoDeMovimiento(primera.resultados[0]), '26/11/2026 10:00 · Gabi Guardia');
  assert.equal(s.textoDeMovimiento({creado_en: null, usuario: ''}), '');
  igual(s.normalizarMovimientos(null), {resultados: [], siguiente: null, hayMas: false});
});

test('clasificarError: cada code y status del contrato, con texto en español y sin `error.message` crudo', async () => {
  const {r, s} = await preparar();
  const REINTENTAR = 'No se pudo traer el stock. Probá de nuevo en unos segundos.';
  igual(s.clasificarError({network: true}), {tipo: 'sin_red', mensaje: 'Necesitás conexión para ver el stock.'});
  // 403 SIN_MODULO: el del back si viene, y uno claro si no.
  igual(s.clasificarError({status: 403, payload: {code: 'SIN_MODULO', detail: 'El usuario no lleva stock en ningún dispositivo.'}}),
    {tipo: 'sin_modulo', mensaje: 'El usuario no lleva stock en ningún dispositivo.'});
  assert.match(s.clasificarError({status: 403, payload: {code: 'SIN_MODULO'}}).mensaje, /no ve el stock de ningún edificio/);
  // 403 SIN_PERMISO
  igual(s.clasificarError({status: 403, payload: {code: 'SIN_PERMISO', detail: 'No podés ver esto.'}}), {tipo: 'sin_permiso', mensaje: 'No podés ver esto.'});
  assert.equal(s.clasificarError({status: 403, payload: {}}).tipo, 'sin_permiso');
  // 404: el mismo cuerpo para todo lo ajeno.
  igual(s.clasificarError({status: 404, payload: {detail: 'No encontrado.'}}),
    {tipo: 'no_encontrado', mensaje: 'Ese edificio ya no está entre los tuyos o su institución dejó de llevar stock.'});
  // 400 VALIDACION: solo con el code.
  igual(s.clasificarError({status: 400, payload: {code: 'VALIDACION', detail: 'cursor inválido'}}), {tipo: 'validacion', mensaje: 'cursor inválido', errores: {}});
  assert.match(s.clasificarError({status: 400, payload: {code: 'VALIDACION'}}).mensaje, /filtro de movimientos/);
  assert.equal(s.clasificarError({status: 400, payload: {detail: 'x'}}).tipo, 'otro');
  // 429 con Retry-After.
  igual(s.clasificarError({status: 429, retryAfter: 30000}), {tipo: 'espera', mensaje: 'Hay demasiadas consultas seguidas. Esperá un momento y volvé a probar.', espera: 30000});
  assert.equal(s.clasificarError({status: 429}).espera, null);
  // Intermediarios y 5xx.
  igual(s.clasificarError({status: 403, unexpectedHtml: true, message: '<html>'}), {tipo: 'otro', mensaje: REINTENTAR});
  igual(s.clasificarError({status: 404, unexpectedHtml: true}), {tipo: 'otro', mensaje: REINTENTAR});
  igual(s.clasificarError({status: 500, message: 'boom'}), {tipo: 'otro', mensaje: REINTENTAR});
  // De punta a punta: un 403 SIN_MODULO real pasa por la verificación del perfil.
  pedidos(r, (call) => (call.url.includes('/perfil/') ? response(200, {stock: true}) : response(403, {code: 'SIN_MODULO', detail: 'sin módulo'})));
  const error = await s.getPares().catch((e) => e);
  assert.equal(s.clasificarError(error).tipo, 'sin_modulo');
  assert.equal(error.verificacionSinModulo, 'actualizado');
});
