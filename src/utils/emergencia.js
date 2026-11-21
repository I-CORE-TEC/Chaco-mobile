// Reglas y textos puros del Formulario 1 de Emergencia (M1 · Ingreso de familias), sin React ni
// red. Las reglas autoritativas son las del back (contrato-app-emergencia §6): estas solo ayudan
// a cargar bien antes de encolar. Las claves de los errores son las del contrato (las mismas que
// devuelve el 400 VALIDACION), así la pantalla muestra igual un error local y uno del servidor.
import { cleanDigits, isValidDni, normalizeDateText } from '../utils/dni';

export const MAX_TRASLADO_OTRO = 120;
export const MAX_DIRECCION = 240;

export const TRASLADOS = [
  { valor: 'BOMBEROS', titulo: 'Bomberos' },
  { valor: 'EJERCITO', titulo: 'Ejército' },
  { valor: 'DEFENSA_CIVIL', titulo: 'Defensa Civil' },
  { valor: 'POLICIA', titulo: 'Policía' },
  { valor: 'MUNICIPIO', titulo: 'Municipio' },
  { valor: 'AUTOEVACUADO', titulo: 'Autoevacuado' },
  { valor: 'OTRA', titulo: 'Otra' },
];

export const SEXOS = [
  { valor: 'F', titulo: 'Femenino' },
  { valor: 'M', titulo: 'Masculino' },
];

// Las seis cantidades del §6: son quienes vienen con el responsable. Él no va acá: suma uno al total
// (`responsable_aparte`). Un borrador o envío anterior sin la marca las lee como antes, con él adentro.
export const CANTIDADES = [
  { clave: 'menores_f', grupo: 'Menores', titulo: 'Mujeres' },
  { clave: 'menores_m', grupo: 'Menores', titulo: 'Varones' },
  { clave: 'adultos_f', grupo: 'Adultos', titulo: 'Mujeres' },
  { clave: 'adultos_m', grupo: 'Adultos', titulo: 'Varones' },
  { clave: 'mayores_f', grupo: 'Mayores', titulo: 'Mujeres' },
  { clave: 'mayores_m', grupo: 'Mayores', titulo: 'Varones' },
];

export const ASISTENCIA = [
  { clave: 'dependientes', titulo: 'Personas con dependencia' },
  { clave: 'mayores_dependientes', titulo: 'Mayores con dependencia' },
  { clave: 'lactantes', titulo: 'Lactantes' },
];

export const AVISOS = [
  { clave: 'embarazo', titulo: 'Embarazo' },
  { clave: 'electrodependiente', titulo: 'Electrodependiente' },
  { clave: 'medicacion_critica', titulo: 'Medicación crítica' },
  { clave: 'mascotas', titulo: 'Mascotas' },
];

export const FOTOS = [
  { clave: 'foto_vivienda', titulo: 'Foto de la vivienda' },
  { clave: 'foto_acceso', titulo: 'Foto del acceso' },
];

// Para mostrar un error por campo con un nombre que la persona entienda.
export const ETIQUETAS = {
  uuid_cliente: 'Identificador del envío',
  relevado_en: 'Hora del relevamiento',
  traslado: 'Traslado',
  traslado_otro: 'Otro traslado',
  dni: 'DNI',
  sexo: 'Sexo',
  nombre: 'Nombre',
  apellido: 'Apellido',
  fecha_nacimiento: 'Fecha de nacimiento',
  telefono: 'Teléfono',
  documento_extraviado: 'Documento extraviado',
  total: 'Personas',
  direccion: 'Dirección',
  localidad: 'Localidad',
  latitud: 'Ubicación',
  longitud: 'Ubicación',
  precision_m: 'Ubicación',
  observaciones: 'Observaciones',
  non_field_errors: 'Envío',
  fotos: 'Fotos',
  ...Object.fromEntries(CANTIDADES.map(({ clave, grupo, titulo }) => [clave, `${grupo} · ${titulo}`])),
  ...Object.fromEntries(ASISTENCIA.map(({ clave, titulo }) => [clave, titulo])),
  ...Object.fromEntries(AVISOS.map(({ clave, titulo }) => [clave, titulo])),
  ...Object.fromEntries(FOTOS.map(({ clave, titulo }) => [clave, titulo])),
};

// Lo que guarda el borrador. `sexo` y `consulta` son de la pantalla (la consulta de identidad):
// enviarCaso solo manda las claves del §6.
export const datosIniciales = () => ({
  traslado: '',
  traslado_otro: '',
  dni: '',
  sexo: '',
  nombre: '',
  apellido: '',
  fecha_nacimiento: '',
  telefono: '',
  documento_extraviado: false,
  responsable_aparte: true,
  ...Object.fromEntries(CANTIDADES.map(({ clave }) => [clave, 0])),
  ...Object.fromEntries(ASISTENCIA.map(({ clave }) => [clave, 0])),
  ...Object.fromEntries(AVISOS.map(({ clave }) => [clave, false])),
  direccion: '',
  localidad: null,
  localidad_nombre: '',
  latitud: null,
  longitud: null,
  precision_m: null,
  observaciones: '',
  consulta: null,
});

// Lo guardado en el teléfono sobre los datos iniciales. Lo guardado antes de `responsable_aparte`
// contó al responsable en las cantidades: sin la marca no se le suma otra vez.
export const conDatosGuardados = (guardados = {}) => ({ ...datosIniciales(), responsable_aparte: false, ...guardados });

// Un contador como entero ≥ 0; lo que no se entiende vale 0.
export const aCantidad = (valor) => {
  const numero = typeof valor === 'number' ? valor : Number(String(valor ?? '').replace(/\D/g, '') || 0);
  return Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
};

const suma = (datos, claves) => claves.reduce((total, clave) => total + aCantidad(datos?.[clave]), 0);
export const totalDeclarado = (datos) => suma(datos, CANTIDADES.map(({ clave }) => clave))
  + (datos?.responsable_aparte === true ? 1 : 0);
export const totalMenores = (datos) => suma(datos, ['menores_f', 'menores_m']);
export const totalMayores = (datos) => suma(datos, ['mayores_f', 'mayores_m']);

const texto = (valor) => String(valor ?? '').trim();

// `DD/MM/AAAA` (lo que guarda FechaInput) o `AAAA-MM-DD` que exista en el calendario.
export const fechaValida = (valor) => {
  const partes = normalizeDateText(texto(valor)).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!partes) return false;
  const [dia, mes, anio] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
};

// ---- Asistencia según quiénes ingresan ----
// El bloque 3 muestra solo lo que puede corresponder al grupo: «Embarazo» con alguna mujer menor o
// adulta, «Lactantes» con menores, «Mayores con dependencia» con mayores. Lo que no se puede descartar
// se muestra: el responsable sin sexo cargado puede ser mujer y sin fecha de nacimiento puede ser mayor.
// Un campo oculto conserva lo cargado en el borrador (si vuelve a aparecer, está como estaba), pero no
// se valida y se envía en 0 / false.
export const EDAD_MENOR = 18;
// Persona mayor desde los 60, como la Convención Interamericana (Ley 27.360).
export const EDAD_MAYOR = 60;

// Años cumplidos a `hoy` con una fecha DD/MM/AAAA o AAAA-MM-DD; null si no hay una fecha válida.
export const edadEn = (fecha, hoy = new Date()) => {
  if (!fechaValida(fecha)) return null;
  const [dia, mes, anio] = normalizeDateText(texto(fecha)).split('/').map(Number);
  const edad = hoy.getFullYear() - anio - ((hoy.getMonth() + 1 < mes || (hoy.getMonth() + 1 === mes && hoy.getDate() < dia)) ? 1 : 0);
  return edad >= 0 ? edad : null;
};

// Lo que se sabe del responsable cuando va aparte de los contadores. En lo guardado antes de
// `responsable_aparte` ya está contado en las franjas: no se mira de nuevo.
const responsableAparte = (datos = {}, hoy = new Date()) => {
  if (datos.responsable_aparte !== true) return { puedeSerMayor: false, puedeEmbarazo: false };
  const edad = edadEn(datos.fecha_nacimiento, hoy);
  const mayor = edad != null && edad >= EDAD_MAYOR;
  return {
    puedeSerMayor: edad == null || mayor,
    puedeEmbarazo: texto(datos.sexo).toUpperCase() !== 'M' && !mayor,
  };
};

// { clave: true/false } para cada campo de ASISTENCIA y AVISOS.
export const asistenciaVisible = (datos = {}, hoy = new Date()) => {
  const responsable = responsableAparte(datos, hoy);
  const visible = Object.fromEntries([...ASISTENCIA, ...AVISOS].map(({ clave }) => [clave, true]));
  visible.mayores_dependientes = totalMayores(datos) > 0 || responsable.puedeSerMayor;
  visible.lactantes = totalMenores(datos) > 0;
  visible.embarazo = suma(datos, ['menores_f', 'adultos_f']) > 0 || responsable.puedeEmbarazo;
  return visible;
};

// Hasta cuánto puede llegar cada contador de asistencia con el grupo cargado.
export const topesAsistencia = (datos = {}, hoy = new Date()) => ({
  dependientes: totalDeclarado(datos),
  mayores_dependientes: totalMayores(datos) + (responsableAparte(datos, hoy).puedeSerMayor ? 1 : 0),
  lactantes: totalMenores(datos),
});

const POR_QUE_OCULTO = {
  embarazo: 'Embarazo aparece si ingresa alguna mujer menor o adulta.',
  lactantes: 'Lactantes aparece si ingresan menores.',
  mayores_dependientes: 'Mayores con dependencia aparece si ingresan mayores.',
};
// Para quien carga: por qué no ve un campo. null si se ven todos.
export const textoDeOcultos = (visible = {}) => {
  const partes = Object.keys(POR_QUE_OCULTO).filter((clave) => visible[clave] === false).map((clave) => POR_QUE_OCULTO[clave]);
  return partes.length ? partes.join(' ') : null;
};

// La consulta de identidad solo necesita DNI y sexo (§4).
export const validarConsulta = ({ dni, sexo } = {}) => {
  const errores = {};
  if (!isValidDni(dni)) errores.dni = ['El DNI tiene que tener 7 u 8 números.'];
  if (!['F', 'M'].includes(texto(sexo).toUpperCase())) errores.sexo = ['Elegí el sexo que figura en el DNI para buscar a la persona.'];
  return errores;
};

// Nombre y apellido se piden salvo que la Base de Personas o el DNI escaneado ya los hayan dado:
// sin esa confirmación el teléfono no sabe si la persona está en el legajo, y el back los exige
// para el alta mínima. La confirmación vale solo para el DNI y el sexo con que se hizo: si cambiaron
// (o una respuesta lenta llegó tarde), es de otra persona.
export const mismaIdentidad = (consulta, datos = {}) => !!consulta
  && String(consulta.dni ?? '') === cleanDigits(datos?.dni)
  && texto(consulta.sexo).toUpperCase() === texto(datos?.sexo).toUpperCase();
export const personaConfirmada = (consulta, datos = {}) => ['encontrada', 'escaneado'].includes(consulta?.estado)
  && mismaIdentidad(consulta, datos);

// Devuelve { campo: [mensajes] } con las claves del §6 (más `total`); vacío si no hay nada.
export const validarCaso = (datos = {}) => {
  const errores = {};
  const agregar = (campo, mensaje) => { errores[campo] = [...(errores[campo] || []), mensaje]; };

  const traslado = texto(datos.traslado);
  if (!traslado) agregar('traslado', 'Elegí cómo llegó la familia.');
  else if (!TRASLADOS.some(({ valor }) => valor === traslado)) agregar('traslado', 'El traslado no es una opción válida.');
  if (traslado === 'OTRA' && !texto(datos.traslado_otro)) agregar('traslado_otro', 'Contá cómo llegó la familia.');
  if (texto(datos.traslado_otro).length > MAX_TRASLADO_OTRO) {
    agregar('traslado_otro', `Hasta ${MAX_TRASLADO_OTRO} caracteres.`);
  }

  if (!isValidDni(datos.dni)) agregar('dni', 'El DNI del responsable tiene que tener 7 u 8 números.');
  if (!personaConfirmada(datos.consulta, datos)) {
    if (!texto(datos.nombre)) agregar('nombre', 'Escribí el nombre del responsable.');
    if (!texto(datos.apellido)) agregar('apellido', 'Escribí el apellido del responsable.');
  }
  if (texto(datos.fecha_nacimiento) && !fechaValida(datos.fecha_nacimiento)) {
    agregar('fecha_nacimiento', 'La fecha de nacimiento no es válida: tiene que ser DD/MM/AAAA.');
  }

  const total = totalDeclarado(datos);
  if (total < 1) agregar('total', 'Cargá al menos una persona: el responsable también cuenta.');
  // Lo oculto no se valida: se envía en 0. El responsable que va aparte puede ser el mayor con
  // dependencia (no tiene franja en los contadores), salvo que su fecha de nacimiento diga que no.
  const visible = asistenciaVisible(datos);
  const topes = topesAsistencia(datos);
  if (aCantidad(datos.dependientes) > topes.dependientes) agregar('dependientes', 'No puede haber más personas con dependencia que personas.');
  if (visible.mayores_dependientes && aCantidad(datos.mayores_dependientes) > topes.mayores_dependientes) {
    agregar('mayores_dependientes', 'No puede haber más mayores con dependencia que mayores.');
  }
  if (visible.lactantes && aCantidad(datos.lactantes) > topes.lactantes) agregar('lactantes', 'No puede haber más lactantes que menores.');

  const direccion = texto(datos.direccion);
  if (!direccion) agregar('direccion', 'Escribí la dirección o una referencia: es el mínimo para ubicar a la familia.');
  else if (direccion.length > MAX_DIRECCION) agregar('direccion', `Hasta ${MAX_DIRECCION} caracteres.`);

  const conLatitud = datos.latitud != null && datos.latitud !== '';
  const conLongitud = datos.longitud != null && datos.longitud !== '';
  if (conLatitud && conLongitud) {
    const latitud = Number(datos.latitud);
    const longitud = Number(datos.longitud);
    if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90
      || !Number.isFinite(longitud) || longitud < -180 || longitud > 180) {
      agregar('latitud', 'La ubicación del GPS no es válida: volvé a tomarla o quitala.');
    }
  }
  return errores;
};

export const hayErrores = (errores) => !!errores && Object.keys(errores).length > 0;

// Lo del borrador → lo que recibe enviarCaso (las claves del §6). Los contadores van enteros,
// los avisos booleanos, el DNI solo con números; lo vacío lo descarta enviarCaso.
export const datosDelCaso = (datos = {}) => {
  const caso = {
    traslado: texto(datos.traslado),
    traslado_otro: texto(datos.traslado) === 'OTRA' ? texto(datos.traslado_otro) : '',
    dni: cleanDigits(datos.dni),
    nombre: texto(datos.nombre),
    apellido: texto(datos.apellido),
    fecha_nacimiento: texto(datos.fecha_nacimiento),
    telefono: texto(datos.telefono),
    documento_extraviado: datos.documento_extraviado === true,
    responsable_aparte: datos.responsable_aparte === true,
    direccion: texto(datos.direccion),
    localidad: datos.localidad ?? null,
    observaciones: texto(datos.observaciones),
  };
  // Lo que el grupo no permite (oculto en la pantalla) va en 0 / false aunque el borrador lo conserve.
  const visible = asistenciaVisible(datos);
  CANTIDADES.forEach(({ clave }) => { caso[clave] = aCantidad(datos[clave]); });
  ASISTENCIA.forEach(({ clave }) => { caso[clave] = visible[clave] ? aCantidad(datos[clave]) : 0; });
  AVISOS.forEach(({ clave }) => { caso[clave] = visible[clave] && datos[clave] === true; });
  if (datos.latitud != null && datos.longitud != null && datos.latitud !== '' && datos.longitud !== '') {
    caso.latitud = datos.latitud;
    caso.longitud = datos.longitud;
    if (datos.precision_m != null && datos.precision_m !== '') caso.precision_m = datos.precision_m;
  }
  return caso;
};

// El cuerpo de un 400 VALIDACION (§6, «Errores del envío») → { campo: [mensajes] }. `detail` y
// `code` no son campos; `non_field_errors` se guarda solo si ningún campo trajo su mensaje.
export const erroresDelServidor = (payload) => {
  if (!payload || typeof payload !== 'object') return {};
  const errores = {};
  Object.entries(payload).forEach(([clave, valor]) => {
    if (['detail', 'code', 'non_field_errors'].includes(clave)) return;
    const mensajes = (Array.isArray(valor) ? valor : [valor]).filter((m) => typeof m === 'string' && m.trim());
    if (mensajes.length) errores[clave] = mensajes;
  });
  if (!Object.keys(errores).length) {
    const generales = Array.isArray(payload.non_field_errors) ? payload.non_field_errors : [payload.detail];
    const mensajes = generales.filter((m) => typeof m === 'string' && m.trim());
    if (mensajes.length) errores.non_field_errors = mensajes;
  }
  return errores;
};

// Errores → lista para mostrar, con la etiqueta del campo adelante.
export const listaDeErrores = (errores = {}) => Object.entries(errores || {})
  .flatMap(([campo, mensajes]) => (Array.isArray(mensajes) ? mensajes : [mensajes])
    .map((mensaje) => ({ campo, etiqueta: ETIQUETAS[campo] || campo, texto: String(mensaje) })));

// Por `code`, nunca por el texto del mensaje. Lo que no está acá muestra el `detail` del back.
export const TEXTOS_POR_CODE = {
  VALIDACION: 'El servidor rechazó algunos datos. Corregí lo marcado y volvé a enviar.',
  UUID_EN_USO: 'Este envío no se puede mandar: su identificador ya lo usó otro caso. No se reintenta. Descartalo y cargá la familia de nuevo.',
  SIN_MODULO: 'Tu usuario no tiene permiso para relevar familias. Pedí que te sumen el rol de agente territorial; lo cargado queda guardado en el teléfono.',
  REINTENTOS_AGOTADOS: 'No se pudo enviar después de varios intentos. Probá reintentar cuando tengas buena señal.',
  RATE_LIMITED: 'El servidor pidió esperar antes de volver a enviar. Se reintenta solo.',
  ARCHIVO_LOCAL_FALTANTE: 'Una foto ya no está en el teléfono: volvé a sacarla.',
  RECHAZADA: 'El servidor rechazó el envío.',
  AUTH_REQUIRED: 'La sesión venció: volvé a entrar y se envía solo.',
  JPEG_NO_CONVERTIBLE: 'No se pudo convertir la foto a JPEG. Probá sacarla de nuevo con la cámara.',
  JPEG_EXCEDE: 'La foto sigue pesando demasiado después de comprimirla. Probá con otra foto.',
  FECHA_INVALIDA: 'Hay una fecha que no es válida.',
};

export const TEXTO_DEMORADO = 'Lleva varios intentos sin poder enviarse (sin señal o el servidor no responde). Sigue en la cola y se reintenta solo; no hace falta cargarlo de nuevo.';

export const textoDeCode = (code, detalle = null) => TEXTOS_POR_CODE[code] || detalle || 'No se pudo enviar.';

// Aviso al cerrar sesión con lo que queda en el teléfono (getResumenPendientes), o null si no
// queda nada. Lo que está en cola sale solo al volver a entrar; lo que está para revisar no.
export const avisoDeSalida = ({ enCola = 0, paraRevisar = 0, sinTerminar = 0 } = {}) => {
  const partes = [];
  if (enCola > 0) {
    partes.push(enCola === 1
      ? '1 familia en cola: se envía sola cuando vuelvas a entrar con este usuario.'
      : `${enCola} familias en cola: se envían solas cuando vuelvas a entrar con este usuario.`);
  }
  if (paraRevisar > 0) {
    partes.push(paraRevisar === 1
      ? '1 envío para revisar (con error o para corregir): no sale solo; revisalo en «Mis envíos» cuando vuelvas a entrar.'
      : `${paraRevisar} envíos para revisar (con error o para corregir): no salen solos; revisalos en «Mis envíos» cuando vuelvas a entrar.`);
  }
  if (sinTerminar > 0) {
    partes.push('Un formulario sin terminar: queda guardado en el teléfono para cuando vuelvas a entrar.');
  }
  return partes.length ? partes.join('\n') : null;
};

// Estados del caso en «Mis envíos» (§7) con el tono de statusTones.
const ESTADOS_CASO = {
  NUEVO: ['Nuevo', 'info'],
  EN_GESTION: ['En gestión', 'warning'],
  DERIVADO: ['Derivado', 'brand'],
  INGRESO_EN_CURSO: ['Ingreso en curso', 'warning'],
  ALOJADO: ['Alojado', 'success'],
  CERRADO: ['Cerrado', 'gray'],
};
export const estadoDelCaso = (estado) => {
  const valor = String(estado || '').toUpperCase();
  const [titulo, tono] = ESTADOS_CASO[valor] || [valor ? valor.replaceAll('_', ' ').toLowerCase() : 'Sin estado', 'gray'];
  return { titulo, tono };
};

// Estados locales (lo que todavía está en el teléfono).
export const ESTADOS_LOCALES = {
  pendiente: { titulo: 'Pendiente de envío', tono: 'warning' },
  demorado: { titulo: 'Demorado', tono: 'warning' },
  enviando: { titulo: 'Enviando', tono: 'info' },
  error: { titulo: 'Con error', tono: 'danger' },
  corregir: { titulo: 'Para corregir', tono: 'danger' },
};

const sinAcentos = (valor) => String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Buscador de localidades sobre la lista guardada: sin acentos, por cualquier parte del nombre,
// primero las que empiezan con lo escrito.
export const filtrarLocalidades = (localidades = [], busqueda = '', limite = 8) => {
  const buscado = sinAcentos(busqueda);
  if (!buscado) return [];
  const coinciden = (localidades || []).filter((item) => sinAcentos(item?.nombre).includes(buscado));
  const empieza = (item) => (sinAcentos(item.nombre).startsWith(buscado) ? 0 : 1);
  return coinciden.sort((a, b) => empieza(a) - empieza(b) || String(a.nombre).localeCompare(String(b.nombre)))
    .slice(0, limite);
};

// Resumen de una familia para las listas: «Benitez, Rosa · DNI 30111222 · 5 personas».
export const resumenDeFamilia = (datos = {}) => {
  const nombre = [texto(datos.apellido), texto(datos.nombre)].filter(Boolean).join(', ');
  const total = totalDeclarado(datos);
  return [nombre || null, datos.dni ? `DNI ${cleanDigits(datos.dni)}` : null,
    total ? `${total} persona${total === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'Familia sin datos';
};
