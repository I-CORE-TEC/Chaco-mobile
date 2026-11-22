// utils/emergencia.js: reglas de cliente del Formulario 1 (contrato-app-emergencia §6), errores
// del 400 VALIDACION, textos por `code` y buscador de localidades.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {setup} = require('./helpers/mobile-runtime.cjs');

let reglas;
const cargar = async () => { reglas = reglas || (await setup()).load('../utils/emergencia'); return reglas; };
const plano = (valor) => JSON.parse(JSON.stringify(valor));
const VALIDO = {traslado: 'BOMBEROS', dni: '30111222', nombre: 'Rosa', apellido: 'Benitez', adultos_f: 1, direccion: 'Calle 1'};

test('un caso mínimo válido no tiene errores', async () => {
  const r = await cargar();
  assert.deepEqual(plano(r.validarCaso({...r.datosIniciales(), ...VALIDO})), {});
});

test('traslado obligatorio, de la lista, y «OTRA» exige texto de hasta 120', async () => {
  const r = await cargar();
  assert.ok(r.validarCaso({...VALIDO, traslado: ''}).traslado);
  assert.ok(r.validarCaso({...VALIDO, traslado: 'BARCO'}).traslado);
  assert.deepEqual(plano(r.TRASLADOS.map((t) => t.valor)), ['BOMBEROS', 'EJERCITO', 'DEFENSA_CIVIL', 'POLICIA', 'MUNICIPIO', 'AUTOEVACUADO', 'OTRA']);
  assert.ok(r.validarCaso({...VALIDO, traslado: 'OTRA'}).traslado_otro);
  assert.ok(r.validarCaso({...VALIDO, traslado: 'OTRA', traslado_otro: '   '}).traslado_otro);
  assert.equal(r.validarCaso({...VALIDO, traslado: 'OTRA', traslado_otro: 'x'.repeat(120)}).traslado_otro, undefined);
  assert.ok(r.validarCaso({...VALIDO, traslado: 'OTRA', traslado_otro: 'x'.repeat(121)}).traslado_otro);
  // Con otro traslado, el texto no se manda.
  assert.equal(r.datosDelCaso({...VALIDO, traslado_otro: 'viejo'}).traslado_otro, '');
});

test('DNI de 7 u 8 números; nombre y apellido salvo persona confirmada', async () => {
  const r = await cargar();
  assert.equal(r.validarCaso({...VALIDO, dni: '1234567'}).dni, undefined);
  assert.equal(r.validarCaso({...VALIDO, dni: '30.111.222'}).dni, undefined);
  assert.ok(r.validarCaso({...VALIDO, dni: '123456'}).dni);
  assert.ok(r.validarCaso({...VALIDO, dni: '123456789'}).dni);
  const sinNombre = {...VALIDO, nombre: '', apellido: ' '};
  assert.ok(r.validarCaso(sinNombre).nombre && r.validarCaso(sinNombre).apellido);
  for (const estado of ['no_encontrada', 'sin_red', 'error', 'fallecida']) {
    assert.ok(r.validarCaso({...sinNombre, consulta: {estado}}).nombre, estado);
  }
  const conSexo = {...sinNombre, dni: '30.111.222', sexo: 'f'};
  for (const estado of ['encontrada', 'escaneado']) {
    assert.equal(r.validarCaso({...conSexo, consulta: {estado, dni: '30111222', sexo: 'F'}}).nombre, undefined, estado);
    // La confirmación es de un DNI y un sexo: con otros (o sin decir de quién) no vale.
    assert.ok(r.validarCaso({...conSexo, consulta: {estado}}).nombre, `${estado} sin dni`);
    assert.ok(r.validarCaso({...conSexo, consulta: {estado, dni: '30111223', sexo: 'F'}}).nombre, `${estado} otro dni`);
    assert.ok(r.validarCaso({...conSexo, consulta: {estado, dni: '30111222', sexo: 'M'}}).nombre, `${estado} otro sexo`);
  }
  assert.equal(r.personaConfirmada({estado: 'encontrada', dni: '30111222', sexo: 'F'}, {dni: '30111222', sexo: 'F'}), true);
  assert.equal(r.personaConfirmada({estado: 'encontrada', dni: '30111222', sexo: 'F'}, {dni: '30111223', sexo: 'F'}), false);
  assert.equal(r.personaConfirmada({estado: 'encontrada', dni: '30111222', sexo: 'F'}), false);
  assert.equal(r.ETIQUETAS.fotos, 'Fotos');
  assert.deepEqual(plano(Object.keys(r.validarConsulta({dni: '30111222', sexo: 'f'}))), []);
  assert.deepEqual(plano(Object.keys(r.validarConsulta({dni: '30', sexo: 'X'}, {conSexo: true}))), ['dni', 'sexo']);
});

test('fecha de nacimiento opcional pero real', async () => {
  const r = await cargar();
  assert.equal(r.validarCaso({...VALIDO, fecha_nacimiento: ''}).fecha_nacimiento, undefined);
  assert.equal(r.validarCaso({...VALIDO, fecha_nacimiento: '29/02/2024'}).fecha_nacimiento, undefined);
  assert.equal(r.validarCaso({...VALIDO, fecha_nacimiento: '1984-03-02'}).fecha_nacimiento, undefined);
  assert.ok(r.validarCaso({...VALIDO, fecha_nacimiento: '29/02/2023'}).fecha_nacimiento);
  assert.ok(r.validarCaso({...VALIDO, fecha_nacimiento: 'ayer'}).fecha_nacimiento);
});

test('contadores ≥ 0 con suma ≥ 1 (en `total`) y los topes de asistencia', async () => {
  const r = await cargar();
  const base = {...VALIDO, adultos_f: 0};
  assert.ok(r.validarCaso(base).total);
  assert.equal(r.validarCaso({...base, mayores_m: 1}).total, undefined);
  assert.ok(r.validarCaso({...base, adultos_f: -3}).total, 'un negativo cuenta 0');
  assert.equal(r.aCantidad('3'), 3); assert.equal(r.aCantidad(-1), 0); assert.equal(r.aCantidad('x'), 0); assert.equal(r.aCantidad(2.7), 2);
  const familia = {...VALIDO, adultos_f: 1, menores_m: 1, mayores_f: 1};
  assert.equal(r.totalDeclarado(familia), 3);
  assert.equal(r.validarCaso({...familia, dependientes: 3}).dependientes, undefined);
  assert.ok(r.validarCaso({...familia, dependientes: 4}).dependientes);
  assert.equal(r.validarCaso({...familia, mayores_dependientes: 1}).mayores_dependientes, undefined);
  assert.ok(r.validarCaso({...familia, mayores_dependientes: 2}).mayores_dependientes);
  assert.equal(r.validarCaso({...familia, lactantes: 1}).lactantes, undefined);
  assert.ok(r.validarCaso({...familia, lactantes: 2}).lactantes);
});

test('el responsable suma aparte: los contadores son los acompañantes', async () => {
  const r = await cargar();
  const nuevo = {...r.datosIniciales(), ...VALIDO};
  assert.equal(nuevo.responsable_aparte, true, 'un formulario nuevo nace con la marca');
  assert.equal(r.totalDeclarado(nuevo), 2, 'un acompañante más el responsable');
  assert.equal(r.totalDeclarado({...nuevo, adultos_f: 0}), 1);
  assert.equal(r.validarCaso({...nuevo, adultos_f: 0}).total, undefined, 'solo el responsable es una familia');
  assert.equal(r.validarCaso({...nuevo, dependientes: 2}).dependientes, undefined, 'el responsable también puede ser dependiente');
  assert.ok(r.validarCaso({...nuevo, dependientes: 3}).dependientes);
  assert.equal(r.validarCaso({...nuevo, adultos_f: 0, mayores_dependientes: 1}).mayores_dependientes, undefined,
    'el responsable solo puede ser el mayor dependiente');
  assert.ok(r.validarCaso({...nuevo, adultos_f: 0, mayores_dependientes: 2}).mayores_dependientes);
  assert.ok(r.validarCaso(r.conDatosGuardados({...VALIDO, mayores_f: 1, mayores_dependientes: 2})).mayores_dependientes,
    'sin la marca el tope es el de siempre');
  assert.equal(r.validarCaso(r.conDatosGuardados({...VALIDO, mayores_dependientes: 1})).mayores_dependientes, undefined,
    'sin la marca y sin mayores el campo no se muestra: no se valida');
  assert.equal(r.datosDelCaso(r.conDatosGuardados({...VALIDO, mayores_dependientes: 1})).mayores_dependientes, 0);
  assert.equal(r.datosDelCaso(nuevo).responsable_aparte, true);
  // Lo guardado antes de la marca (borrador, cola o puerta) contó al responsable adentro: no se le suma otra vez.
  const viejo = r.conDatosGuardados({...VALIDO, adultos_f: 2});
  assert.equal(viejo.responsable_aparte, false);
  assert.equal(r.totalDeclarado(viejo), 2);
  assert.equal(r.datosDelCaso(viejo).responsable_aparte, false);
  assert.equal(r.conDatosGuardados({...nuevo}).responsable_aparte, true);
});

const HOY = new Date(2026, 10, 21);

test('asistencia según el grupo: embarazo, lactantes y mayores con dependencia', async () => {
  const r = await cargar();
  const base = {...r.datosIniciales(), ...VALIDO, adultos_f: 0};
  const ver = (extra) => plano(r.asistenciaVisible({...base, ...extra}, HOY));
  // Siempre a la vista.
  for (const clave of ['dependientes', 'electrodependiente', 'medicacion_critica', 'mascotas']) {
    assert.equal(ver({sexo: 'M'})[clave], true, clave);
  }
  // Embarazo: alguna mujer menor o adulta, o la responsable si no es mayor; sin sexo cargado, puede ser mujer.
  assert.equal(ver({sexo: 'M', adultos_m: 2, menores_m: 1}).embarazo, false, 'todos varones');
  assert.equal(ver({sexo: 'M', mayores_f: 2}).embarazo, false, 'solo mujeres mayores');
  assert.equal(ver({sexo: 'M', menores_f: 1}).embarazo, true, 'las menores cuentan');
  assert.equal(ver({sexo: 'M', adultos_f: 1}).embarazo, true);
  assert.equal(ver({sexo: 'F'}).embarazo, true, 'responsable mujer sola');
  assert.equal(ver({sexo: ''}).embarazo, true, 'sin sexo no se descarta');
  assert.equal(ver({sexo: 'F', fecha_nacimiento: '01/01/1950'}).embarazo, false, 'responsable mayor');
  assert.equal(ver({sexo: 'F', fecha_nacimiento: '1990-05-10'}).embarazo, true);
  // Lactantes: con menores.
  assert.equal(ver({sexo: 'F'}).lactantes, false);
  assert.equal(ver({sexo: 'F', menores_m: 1}).lactantes, true);
  // Mayores con dependencia: con mayores, o el responsable mayor o sin fecha.
  assert.equal(ver({sexo: 'M'}).mayores_dependientes, true, 'sin fecha el responsable puede ser mayor');
  assert.equal(ver({sexo: 'M', fecha_nacimiento: '10/05/1990'}).mayores_dependientes, false);
  assert.equal(ver({sexo: 'M', fecha_nacimiento: '10/05/1960'}).mayores_dependientes, true);
  assert.equal(ver({sexo: 'M', fecha_nacimiento: '10/05/1990', mayores_m: 1}).mayores_dependientes, true);
  // Lo guardado antes de la marca tiene al responsable adentro de las franjas: no se lo mira aparte.
  const viejo = (extra) => plano(r.asistenciaVisible(r.conDatosGuardados({...VALIDO, adultos_f: 0, ...extra}), HOY));
  assert.equal(viejo({sexo: 'F', adultos_m: 1}).embarazo, false);
  assert.equal(viejo({adultos_m: 1}).mayores_dependientes, false);
  assert.match(r.textoDeOcultos(ver({sexo: 'M', fecha_nacimiento: '10/05/1990'})), /Embarazo.*Lactantes.*Mayores/);
  assert.equal(r.textoDeOcultos(ver({sexo: '', menores_f: 1})), null);
});

test('edadEn: años cumplidos, null sin fecha válida', async () => {
  const r = await cargar();
  assert.equal(r.edadEn('21/11/1966', HOY), 60);
  assert.equal(r.edadEn('22/11/1966', HOY), 59);
  assert.equal(r.edadEn('1966-11-21', HOY), 60);
  assert.equal(r.edadEn('', HOY), null);
  assert.equal(r.edadEn('31/02/1990', HOY), null);
  assert.equal(r.edadEn('01/01/2030', HOY), null);
});

test('topes de asistencia: no más que el grupo que los puede tener', async () => {
  const r = await cargar();
  const datos = {...r.datosIniciales(), ...VALIDO, adultos_f: 1, menores_m: 2, mayores_f: 1};
  assert.deepEqual(plano(r.topesAsistencia(datos, HOY)), {dependientes: 5, mayores_dependientes: 2, lactantes: 2});
  assert.equal(r.topesAsistencia({...datos, fecha_nacimiento: '10/05/1990'}, HOY).mayores_dependientes, 1,
    'el responsable adulto no puede ser el mayor');
  assert.ok(r.validarCaso({...datos, sexo: 'M', fecha_nacimiento: '10/05/1990', mayores_dependientes: 2}).mayores_dependientes);
});

test('lo oculto se conserva en el borrador pero no se valida y se envía en 0 / false', async () => {
  const r = await cargar();
  const varones = {...r.datosIniciales(), ...VALIDO, adultos_f: 0, adultos_m: 2, sexo: 'M', fecha_nacimiento: '10/05/1990',
    embarazo: true, lactantes: 3, mayores_dependientes: 1, mascotas: true, dependientes: 1};
  assert.deepEqual(plano(r.validarCaso(varones)), {});
  const caso = r.datosDelCaso(varones);
  assert.equal(caso.embarazo, false); assert.equal(caso.lactantes, 0); assert.equal(caso.mayores_dependientes, 0);
  assert.equal(caso.mascotas, true); assert.equal(caso.dependientes, 1);
  // Si el grupo vuelve a permitirlo, sale lo que estaba cargado.
  const conMujer = r.datosDelCaso({...varones, adultos_f: 1, menores_m: 3});
  assert.equal(conMujer.embarazo, true); assert.equal(conMujer.lactantes, 3);
});

test('dirección obligatoria hasta 240 y GPS en rango', async () => {
  const r = await cargar();
  assert.ok(r.validarCaso({...VALIDO, direccion: '  '}).direccion);
  assert.equal(r.validarCaso({...VALIDO, direccion: 'x'.repeat(240)}).direccion, undefined);
  assert.ok(r.validarCaso({...VALIDO, direccion: 'x'.repeat(241)}).direccion);
  assert.equal(r.validarCaso({...VALIDO, latitud: -27.4, longitud: -58.9}).latitud, undefined);
  assert.ok(r.validarCaso({...VALIDO, latitud: -91, longitud: -58.9}).latitud);
  assert.ok(r.validarCaso({...VALIDO, latitud: -27, longitud: 181}).latitud);
});

test('datosDelCaso: claves del §6, enteros, booleanos y la ubicación junta', async () => {
  const r = await cargar();
  const caso = plano(r.datosDelCaso({...r.datosIniciales(), ...VALIDO, dni: '30.111.222', sexo: 'F', consulta: {estado: 'encontrada'},
    localidad_nombre: 'Barranqueras', localidad: 12, menores_m: '2', embarazo: true, latitud: -27.4, longitud: null}));
  assert.equal(caso.dni, '30111222'); assert.equal(caso.menores_m, 2); assert.equal(caso.embarazo, true);
  assert.equal(caso.mascotas, false); assert.equal(caso.localidad, 12);
  for (const fuera of ['sexo', 'consulta', 'localidad_nombre', 'latitud', 'longitud', 'precision_m', 'total']) assert.ok(!(fuera in caso), fuera);
  const conGps = r.datosDelCaso({...VALIDO, latitud: -27.4, longitud: -58.9, precision_m: 10});
  assert.equal(conGps.latitud, -27.4); assert.equal(conGps.precision_m, 10);
});

test('erroresDelServidor: una clave por campo, sin detail ni code; non_field_errors solo si no hay otra', async () => {
  const r = await cargar();
  assert.deepEqual(plano(r.erroresDelServidor({total: ['Cargá al menos una persona.'], direccion: ['Escribí la dirección.'],
    detail: 'Cargá al menos una persona.', non_field_errors: ['a', 'b'], code: 'VALIDACION'})),
  {total: ['Cargá al menos una persona.'], direccion: ['Escribí la dirección.']});
  assert.deepEqual(plano(r.erroresDelServidor({detail: 'Algo', non_field_errors: ['Algo'], code: 'VALIDACION'})), {non_field_errors: ['Algo']});
  assert.deepEqual(plano(r.erroresDelServidor({detail: 'Solo detalle'})), {non_field_errors: ['Solo detalle']});
  assert.deepEqual(plano(r.erroresDelServidor(null)), {});
  assert.deepEqual(plano(r.listaDeErrores({total: ['x']})), [{campo: 'total', etiqueta: 'Personas', texto: 'x'}]);
});

test('textos por code y estados del caso', async () => {
  const r = await cargar();
  assert.match(r.textoDeCode('UUID_EN_USO'), /No se reintenta/);
  assert.match(r.textoDeCode('SIN_MODULO'), /agente territorial/);
  assert.equal(r.textoDeCode('OTRO', 'Detalle del back'), 'Detalle del back');
  assert.equal(r.textoDeCode('OTRO'), 'No se pudo enviar.');
  assert.deepEqual(plano(r.estadoDelCaso('INGRESO_EN_CURSO')), {titulo: 'Ingreso en curso', tono: 'warning'});
  assert.deepEqual(plano(r.estadoDelCaso('raro_nuevo')), {titulo: 'raro nuevo', tono: 'gray'});
});

test('filtrarLocalidades: sin acentos, primero las que empiezan con lo escrito, con tope', async () => {
  const r = await cargar();
  const lista = [{id: 1, nombre: 'Resistencia'}, {id: 2, nombre: 'Barranqueras'}, {id: 3, nombre: 'Colonia Benítez'},
    {id: 4, nombre: 'Benítez'}, {id: 5, nombre: 'Puerto Bermejo'}];
  assert.deepEqual(plano(r.filtrarLocalidades(lista, 'benit').map((l) => l.id)), [4, 3]);
  assert.deepEqual(plano(r.filtrarLocalidades(lista, 'BÉNIT').map((l) => l.id)), [4, 3]);
  assert.deepEqual(r.filtrarLocalidades(lista, '').length, 0);
  assert.equal(r.filtrarLocalidades(lista, 'e', 2).length, 2);
  assert.equal(r.resumenDeFamilia({...VALIDO, menores_f: 2}), 'Benitez, Rosa · DNI 30111222 · 3 personas');
});

test('la consulta busca solo por DNI: el sexo se exige únicamente en la segunda pasada, con el mensaje del backoffice (#1301, #1299)', async () => {
  const r = await cargar();
  assert.deepEqual(plano(r.validarConsulta({dni: '30111222'})), {});
  assert.deepEqual(plano(r.validarConsulta({dni: '30111'})), {dni: ['Ingresá un DNI válido de 7 u 8 dígitos, sin puntos.']});
  assert.ok(r.validarConsulta({dni: '30111222'}, {conSexo: true}).sexo);
  assert.deepEqual(plano(r.validarConsulta({dni: '30111222', sexo: 'f'}, {conSexo: true})), {});
});

test('lo que confirmó un legajo es del DNI: cambiar el sexo a mano no lo invalida; Base de Personas y el escaneo sí dependen del sexo', async () => {
  const r = await cargar();
  const legajo = {estado: 'encontrada', origen: 'legajo', dni: '30111222', sexo: ''};
  assert.equal(r.personaConfirmada(legajo, {dni: '30.111.222', sexo: 'M'}), true);
  assert.equal(r.personaConfirmada(legajo, {dni: '30111223', sexo: ''}), false);
  const personas = {estado: 'encontrada', origen: 'personas', dni: '30111222', sexo: 'F'};
  assert.equal(r.personaConfirmada(personas, {dni: '30111222', sexo: 'F'}), true);
  assert.equal(r.personaConfirmada(personas, {dni: '30111222', sexo: 'M'}), false);
  assert.equal(r.personaConfirmada({estado: 'escaneado', dni: '30111222', sexo: 'F'}, {dni: '30111222', sexo: 'M'}), false);
});
