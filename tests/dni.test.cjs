// utils/dni.js: el parser del código del DNI que salió de RelevamientoDetailScreen, con los
// formatos que ya leía (PDF417 del DNI argentino, QR, JSON, parámetros, token firmado, texto).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setup} = require('./helpers/mobile-runtime.cjs');

let dni;
const cargar = async () => { dni ??= (await setup()).load('../utils/dni'); return dni; };
const plano = (valor) => JSON.parse(JSON.stringify(valor));

test('PDF417 del DNI argentino (tramite@apellido@nombres@sexo@dni@ejemplar@nacimiento@emision)', async () => {
  const {parseDniCode} = await cargar();
  const raw = '00612345678@BENITEZ@ROSA MARIA@F@30111222@B@02/03/1984@15/06/2016@200';
  assert.deepEqual(plano(parseDniCode(raw, 'PDF417')), {
    dni_tramite: '00612345678', apellido: 'BENITEZ', nombres: 'ROSA MARIA', dni_sexo: 'F',
    dni_numero: '30111222', ejemplar: 'B', fecha_nacimiento: '02/03/1984', fecha_emision: '15/06/2016',
  });
  // Sin el tipo de código, lo reconoce por la forma.
  assert.equal(parseDniCode(raw, '').dni_numero, '30111222');
  assert.equal(parseDniCode(raw, 'org.iso.PDF417').apellido, 'BENITEZ');
});

test('PDF417 con DNI de 7 dígitos, sexo M y partes con + o %20', async () => {
  const {parseDniCode} = await cargar();
  const resultado = parseDniCode('00498765432@GOMEZ@JUAN+CARLOS@M@9876543@A@1960-11-05@20140101', 'pdf417');
  assert.equal(resultado.dni_numero, '9876543');
  assert.equal(resultado.nombres, 'JUAN CARLOS');
  assert.equal(resultado.dni_sexo, 'M');
  assert.equal(resultado.fecha_nacimiento, '05/11/1960');
  assert.equal(resultado.fecha_emision, '01/01/2014');
});

test('QR (tramite@apellido@nombres@dni@ejemplar@nacimiento@emision@...)', async () => {
  const {parseDniCode} = await cargar();
  assert.deepEqual(plano(parseDniCode('00612345678@BENITEZ@ROSA@30111222@B@02/03/1984@15/06/2016@x', 'QR_CODE')), {
    dni_tramite: '00612345678', apellido: 'BENITEZ', nombres: 'ROSA', dni_numero: '30111222', ejemplar: 'B',
    fecha_nacimiento: '02/03/1984', fecha_emision: '15/06/2016',
  });
});

test('JSON, parámetros de URL y token firmado', async () => {
  const {parseDniCode} = await cargar();
  assert.deepEqual(plano(parseDniCode(JSON.stringify({persona: {numeroDocumento: '30.111.222', sexo: 'Femenino', apellido: 'Benitez', nombre: 'Rosa', fechaNacimiento: '1984-03-02'}}))), {
    dni_numero: '30111222', dni_sexo: 'F', apellido: 'Benitez', nombres: 'Rosa', fecha_nacimiento: '02/03/1984',
  });
  assert.deepEqual(plano(parseDniCode('https://dni.test/v?dni=30111222&sexo=M&apellido=Gomez&nombre=Juan%20Carlos')), {
    dni_numero: '30111222', dni_sexo: 'M', apellido: 'Gomez', nombres: 'Juan Carlos',
  });
  const payload = Buffer.from(JSON.stringify({dni: '30111222', apellido: 'PEREZ', nombres: 'ANA', sexo: 'F', id_tramite: '00612345678'})).toString('base64url');
  assert.deepEqual(plano(parseDniCode(`https://x.test/?t=h.${payload}.s`)), {
    dni_numero: '30111222', dni_sexo: 'F', dni_tramite: '00612345678', apellido: 'PEREZ', nombres: 'ANA',
  });
});

test('separado por |, texto libre y vacío', async () => {
  const {parseDniCode} = await cargar();
  const pipe = parseDniCode('A|PEREZ|ANA|F|30111222|02/03/1984', '');
  assert.equal(pipe.dni_numero, '30111222'); assert.equal(pipe.dni_sexo, 'F'); assert.equal(pipe.apellido, 'PEREZ');
  assert.deepEqual(plano(parseDniCode('documento 30111222 leído')), {dni_numero: '30111222'});
  assert.deepEqual(plano(parseDniCode('sin numero')), {dni_numero: ''});
  assert.deepEqual(plano(parseDniCode('')), {});
  assert.deepEqual(plano(parseDniCode(null)), {});
});

test('helpers: dígitos, DNI válido, sexo y fechas', async () => {
  const {cleanDigits, isValidDni, normalizeSex, normalizeDateText} = await cargar();
  assert.equal(cleanDigits('30.111.222'), '30111222');
  assert.equal(isValidDni('30.111.222'), true); assert.equal(isValidDni('123456'), false); assert.equal(isValidDni('123456789'), false);
  assert.deepEqual(['1', '2', '3', 'masculino', 'FEM', 'x', 'otro'].map(normalizeSex), ['M', 'F', 'X', 'M', 'F', 'X', '']);
  assert.equal(normalizeDateText('1984-03-02'), '02/03/1984');
  assert.equal(normalizeDateText('19840302'), '02/03/1984');
  assert.equal(normalizeDateText('02031984'), '02/03/1984');
  assert.equal(normalizeDateText('1970-01-01'), '');
});

test('RelevamientoDetailScreen usa el parser de utils/dni y ya no tiene el suyo', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'src/screens/RelevamientoDetailScreen.js'), 'utf8');
  assert.match(fuente, /import \{[^}]*\bparseDniCode\b[^}]*\} from '\.\.\/utils\/dni';/);
  assert.doesNotMatch(fuente, /const parseDniCode\s*=/);
  assert.doesNotMatch(fuente, /const (normalizeSex|cleanDigits|normalizeDateText|isValidDni)\s*=/);
});

test('DNI como el back (#1299): tecleado solo dígitos hasta 8, con puntos al mostrar y el mismo mensaje del backoffice', async () => {
  const d = await cargar();
  assert.equal(d.tecleadoDni('49.103.788a'), '49103788');
  assert.equal(d.tecleadoDni('4910378899'), '49103788');
  assert.equal(d.tecleadoDni('abc'), '');
  assert.equal(d.formatDni('49103788'), '49.103.788');
  assert.equal(d.formatDni('5123456'), '5.123.456');
  assert.equal(d.formatDni('49.103.788'), '49.103.788');
  assert.equal(d.formatDni('123'), '123');
  assert.equal(d.formatDni(''), '');
  assert.equal(d.MENSAJE_DNI_INVALIDO, 'Ingresá un DNI válido de 7 u 8 dígitos, sin puntos.');
  assert.deepEqual([6, 7, 8, 9].map((n) => d.isValidDni('1'.repeat(n))), [false, true, true, false]);
});

test('sugerencias: la pausa respeta Retry-After y se filtra en el cliente cuando el back trajo todo', async () => {
  const dni = await cargar();
  assert.equal(dni.pausaDeSugerencias(null), 60000);
  assert.equal(dni.pausaDeSugerencias(30000), 60000);
  assert.equal(dni.pausaDeSugerencias(120000), 120000);
  const previa = {q: '49103', hay_mas: false, resultados: [{dni: '49103788'}, {dni: '49103900'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(dni.sugerenciasDesdeLaPrevia(previa, '491037'))), [{dni: '49103788'}]);
  assert.deepEqual(dni.sugerenciasDesdeLaPrevia({...previa, resultados: []}, '491037'), [], 'vacía y completa: no se vuelve a pedir');
  assert.equal(dni.sugerenciasDesdeLaPrevia({...previa, hay_mas: true}, '491037'), null);
  assert.equal(dni.sugerenciasDesdeLaPrevia(previa, '49104'), null, 'otro prefijo: hay que pedir');
  assert.equal(dni.sugerenciasDesdeLaPrevia(null, '49103'), null);
});
