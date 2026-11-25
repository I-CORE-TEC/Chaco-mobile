// Plazas y estadías (lectura, §14 del contrato): armado del resumen, etiquetas de estado, filtros,
// paginado, DNI nulo, fechas y manejo de errores, con el cliente real sobre fetch simulado.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup, response} = require('./helpers/mobile-runtime.cjs');

async function preparar() {
  const r = await setup();
  r.setFetch(async () => response(200, {token: 'tok', user_id: 7, username: 'agente', modulos: ['becas', 'emergencia']}));
  await r.api.loginBecas({username: 'agente', password: 'x'});
  return {r, p: r.load('./plazasApi')};
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

const RESUMEN = {total: 48, libres: 12, ocupadas: 31, reservadas: 3, prestadas: 0, fuera_servicio: 2};

test('el perfil trae la clave plazas y la tarjeta solo aparece con true', async () => {
  const r = await setup();
  const e = r.load('./emergenciaPerfil');
  const claves = (payload) => [...e.accesosDelPerfil(e.normalizarPerfil(payload))].map(({clave}) => clave);
  assert.equal(e.normalizarPerfil({relevar: true}).plazas, false);
  assert.equal(e.normalizarPerfil({plazas: 'si'}).plazas, false);
  assert.ok(!claves({relevar: true, dispositivo: true}).includes('plazas'));
  assert.ok(claves({relevar: true, plazas: true}).includes('plazas'));
  const tarjeta = e.ACCESOS.find(({clave}) => clave === 'plazas');
  assert.equal(tarjeta.titulo, 'Plazas y estadías');
});

test('las rutas siguen el contrato', async () => {
  const {p} = await preparar();
  assert.equal(p.RUTAS.edificios, '/api/emergencia/edificios/');
  assert.equal(p.RUTAS.mapa(3, 9), '/api/emergencia/dispositivos/3/edificios/9/mapa/');
  assert.equal(p.RUTAS.estadias(3, 9), '/api/emergencia/dispositivos/3/edificios/9/estadias/');
});

test('resumen: chips sin ceros en la lista y con las tres primeras fijas en el mapa', async () => {
  const {p} = await preparar();
  igual(p.chipsDeResumen(RESUMEN).map((c) => c.texto), ['12 libres', '31 ocupadas', '3 reservadas', '2 fuera de servicio']);
  igual(p.chipsDeResumen({total: 5, libres: 1, ocupadas: 4}).map((c) => c.texto), ['1 libre', '4 ocupadas']);
  igual(p.chipsDeResumen({total: 0}, {todos: true}).map((c) => c.clave), ['libres', 'ocupadas', 'reservadas']);
  igual(p.chipsDeResumen(null), []);
  assert.equal(p.normalizarResumen({libres: '3', ocupadas: -1, total: 'x'}).libres, 3);
  assert.equal(p.normalizarResumen({ocupadas: -1}).ocupadas, 0);
  assert.equal(p.textoResumenSector({total: 8, ocupadas: 6}), '6 de 8 ocupadas');
});

test('estados de cama: título, texto corto y color; uno desconocido no rompe', async () => {
  const {p} = await preparar();
  assert.equal(p.estadoDePlaza('disponible').titulo, 'Libre');
  assert.equal(p.estadoDePlaza('fuera_servicio').corto, 'F. serv.');
  assert.equal(p.estadoDePlaza('prestada').tono, 'brand');
  assert.equal(p.estadoDePlaza('rara').tono, 'gray');
  assert.equal(p.textoDeCama({estado: 'ocupada', persona: {nombre: 'Gómez, Lucía', dni: null}}), 'Gómez, L.');
  assert.equal(p.textoDeCama({estado: 'reservada', persona: null}), 'Reserv.');
  assert.equal(p.textoDeCama({estado: 'ocupada', persona: null}), 'Ocupada');
  assert.equal(p.etiquetaDeCama({codigo: 'A1-05', estado: 'ocupada', persona: {nombre: 'Benítez, Ramón'}}), 'Cama A1-05, ocupada, Benítez, Ramón');
});

test('DNI nulo no se muestra nunca como «null»', async () => {
  const {p} = await preparar();
  assert.equal(p.textoDni({nombre: 'Gómez, L.', dni: null}), '');
  assert.equal(p.textoDni({dni: undefined}), '');
  assert.equal(p.textoDni(null), '');
  assert.equal(p.textoDni({dni: '30123456'}), 'DNI 30.123.456');
  const plaza = {codigo: 'A1-05', estado: 'ocupada', persona: {nombre: 'Benítez, Ramón', dni: null}, desde: '2026-11-18T21:40:00-03:00'};
  const filas = p.detalleDeCama(plaza, {nombre: 'Aula 1'});
  assert.ok(!filas.some((fila) => /null/i.test(fila.valor)));
  assert.ok(!filas.some((fila) => fila.clave === 'dni'));
  igual(filas.map((fila) => fila.clave), ['sector', 'persona', 'desde']);
  const estadia = p.normalizarEstadia({id: 1, persona: {nombre: 'Rios, C.', dni: null}, fecha_ingreso: '2026-11-18T21:40:00-03:00'});
  assert.ok(!/null/.test(p.detalleDeEstadia(estadia)));
});

test('fechas: dd/mm en hora argentina, con o sin hora, y vacío si no hay', async () => {
  const {p} = await preparar();
  assert.equal(p.fechaCorta('2026-11-18T21:40:00-03:00'), '18/11');
  assert.equal(p.fechaCorta('2026-11-18T21:40:00-03:00', {hora: true}), '18/11 21:40');
  // 02:30 UTC del 19 es todavía el 18 a las 23:30 en Argentina.
  assert.equal(p.fechaCorta('2026-11-19T02:30:00Z', {hora: true}), '18/11 23:30');
  assert.equal(p.fechaCorta(null), '');
  assert.equal(p.fechaCorta('no es fecha'), '');
});

test('detalle de la cama: desde/hasta y aviso de bloqueo', async () => {
  const {p} = await preparar();
  const filas = p.detalleDeCama({
    codigo: 'B-02', estado: 'reservada', persona: {nombre: 'Paz, Nora', dni: '27111222'},
    desde: '2026-11-20T10:00:00-03:00', hasta: '2026-11-22T10:00:00-03:00', bloqueo: 'Reservada por la mesa',
  }, {nombre: 'Aula 2'});
  igual(filas.map((f) => [f.clave, f.valor]), [
    ['sector', 'Aula 2'], ['persona', 'Paz, Nora'], ['dni', '27.111.222'], ['desde', '20/11 10:00'],
    ['hasta', '22/11 10:00'], ['bloqueo', 'Reservada por la mesa']]);
});

test('acciones: solo las conocidas y con sus textos del mockup', async () => {
  const {p} = await preparar();
  igual(p.accionesDePlaza({acciones: ['egresar', 'reubicar', 'fuera_servicio', 'ingresar']}).map((a) => a.titulo),
    ['Registrar egreso', 'Cambiar de cama', 'Sacar de servicio']);
  igual(p.accionesDeEstadia({acciones: ['egresar', 'reubicar']}).map((a) => a.titulo), ['Egreso', 'Cambiar de cama']);
  igual(p.accionesDePlaza({}), []);
  igual(p.accionesDeEstadia({acciones: 'egresar'}), []);
});

test('GET edificios: normaliza, descarta ítems sin ids y no se rompe con una respuesta rara', async () => {
  const {r, p} = await preparar();
  const calls = pedidos(r, () => response(200, [
    {dispositivo: {id: 3, nombre: 'Centro'}, edificio: {id: 9, nombre: 'Pabellón A', direccion: 'Calle 1'}, resumen: RESUMEN},
    {dispositivo: {nombre: 'sin id'}, edificio: {id: 1}},
  ]));
  const lista = await p.getEdificios();
  assert.equal(calls[0].url, '/api/emergencia/edificios/');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].resumen.libres, 12);
  igual(p.normalizarEdificios({detail: 'x'}), []);
});

test('GET mapa: sectores y camas con persona nula, acciones y permisos', async () => {
  const {r, p} = await preparar();
  const calls = pedidos(r, () => response(200, {
    dispositivo: {id: 3, nombre: 'Centro', estado: 'ACTIVO'}, edificio: {id: 9, nombre: 'Pabellón A'}, resumen: RESUMEN,
    puede: {egresar: true, ver_personas: false},
    sectores: [{id: 1, nombre: 'Aula 1', tipo: 'aula', resumen: {total: 2, ocupadas: 1}, plazas: [
      {id: 10, codigo: 'A1-01', estado: 'ocupada', persona: {nombre: 'Gómez, L.', dni: null}, acciones: ['egresar']},
      {id: 11, codigo: 'A1-02', estado: 'disponible', persona: null},
    ]}],
  }));
  const mapa = await p.getMapa(3, 9);
  assert.equal(calls[0].url, '/api/emergencia/dispositivos/3/edificios/9/mapa/');
  assert.equal(mapa.puede.egresar, true);
  assert.equal(mapa.puede.admitir, false);
  assert.equal(mapa.sectores[0].plazas[0].persona.dni, null);
  igual(mapa.sectores[0].plazas[1].acciones, []);
  assert.equal(mapa.sectores[0].plazas[1].bloqueo, '');
  igual(p.normalizarMapa(null).sectores, []);
});

test('filtros de estadías: estado, sector y página en la consulta', async () => {
  const {p} = await preparar();
  assert.equal(p.armarQueryEstadias(), '?estado=activa');
  assert.equal(p.armarQueryEstadias({estado: 'egresada', sector: 4}), '?estado=egresada&sector=4');
  assert.equal(p.armarQueryEstadias({estado: 'cualquiera', page: 3}), '?estado=activa&page=3');
  assert.equal(p.armarQueryEstadias({sector: null, page: 1}), '?estado=activa');
  assert.equal(p.armarQueryEstadias({sector: 0}), '?estado=activa&sector=0');
});

test('paginado DRF: página siguiente, sin repetir estadías y con «hay más»', async () => {
  const {r, p} = await preparar();
  const item = (id, extra = {}) => ({id, persona: {nombre: `P${id}`, dni: null}, sector: {id: 1, nombre: 'Aula 1'},
    plaza: {id: id, codigo: `A-${id}`}, fecha_ingreso: '2026-11-18T21:40:00-03:00', fecha_egreso: null, estado: 'activa',
    origen: 'emergencia', emergencia: {caso_numero: 128}, acciones: ['egresar', 'reubicar'], ...extra});
  const calls = pedidos(r, (call) => (call.url.includes('page=2')
    ? response(200, {count: 3, next: null, previous: 'x', results: [item(2), item(3)]})
    : response(200, {count: 3, next: 'https://example.test/api/emergencia/.../?page=2', previous: null, results: [item(1), item(2)]})));
  const primera = await p.getEstadias(3, 9, {estado: 'activa', sector: 1});
  assert.equal(calls[0].url, '/api/emergencia/dispositivos/3/edificios/9/estadias/?estado=activa&sector=1');
  assert.equal(primera.hayMas, true);
  assert.equal(primera.siguiente, 2);
  assert.equal(primera.count, 3);
  const segunda = await p.getEstadias(3, 9, {estado: 'activa', sector: 1, page: primera.siguiente});
  assert.match(calls[1].url, /estado=activa&sector=1&page=2$/);
  assert.equal(segunda.hayMas, false);
  assert.equal(segunda.siguiente, null);
  const todas = p.juntarPaginas(primera.results, segunda);
  igual(todas.map((e) => e.id), [1, 2, 3]);
  assert.equal(p.textoEmergencia(todas[0]), 'Emergencia · Caso 128');
  assert.equal(p.textoEmergencia({emergencia: null}), '');
  assert.equal(p.detalleDeEstadia(todas[0]), 'Aula 1 · Cama A-1 · desde 18/11');
  assert.equal(p.detalleDeEstadia(p.normalizarEstadia(item(9, {estado: 'egresada', fecha_egreso: '2026-11-20T08:00:00-03:00'}))),
    'Aula 1 · Cama A-9 · desde 18/11 · egresó 20/11');
});

test('errores: sin conexión, 400, 403, 404 y respuestas intermedias', async () => {
  const {r, p} = await preparar();
  pedidos(r, () => { throw new TypeError('Network request failed'); });
  const sinRed = await p.getEdificios().catch((e) => e);
  const clasificado = p.clasificarError(sinRed);
  assert.equal(clasificado.tipo, 'sin_red');
  assert.equal(clasificado.mensaje, 'Necesitás conexión para ver las plazas');

  const caso = async (status, payload) => {
    pedidos(r, (call) => (call.url.includes('/perfil/') ? response(200, {relevar: true, plazas: true}) : response(status, payload)));
    return p.clasificarError(await p.getMapa(3, 9).catch((e) => e));
  };
  igual(await caso(400, {code: 'VALIDACION', detail: 'Sector inválido'}), {tipo: 'validacion', mensaje: 'Sector inválido'});
  igual(await caso(403, {code: 'SIN_PERMISO', detail: 'No podés ver este edificio.'}), {tipo: 'sin_permiso', mensaje: 'No podés ver este edificio.'});
  assert.equal((await caso(403, {code: 'SIN_MODULO', detail: 'Sin módulo'})).tipo, 'sin_modulo');
  assert.equal((await caso(404, {detail: 'No encontrado.'})).tipo, 'no_encontrado');
  assert.equal((await caso(500, {detail: 'boom'})).tipo, 'otro');
});
