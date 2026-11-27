// Ingresar a una persona en una cama (contrato §18): buscar a la persona, pedir el formulario de ingreso y
// confirmar. Solo con conexión, sin cola. La pantalla (PlazasIngresoScreen) arma el cuerpo con las funciones
// de acá y clasifica el error con clasificarErrorPlaza (plazasAccionesApi), por status y `code`.
import { becasRequest } from './becasApi';
import { BASE, conVerificacion, fechaNacimientoIso } from './emergenciaApi';
import { esCampoFirma, llevaArchivo } from './definicionFormulario';

export const RUTAS_INGRESO = {
  persona: (dispositivoId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/ingreso/persona/`,
  formulario: (dispositivoId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/ingreso/formulario/`,
  ingresar: (dispositivoId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/ingresar/`,
};

// El back acepta F, M o X (§18.3).
export const SEXOS_INGRESO = [{ valor: 'F', titulo: 'Femenino' }, { valor: 'M', titulo: 'Masculino' }, { valor: 'X', titulo: 'X' }];

const presente = (valor) => valor !== null && valor !== undefined && !(typeof valor === 'string' && valor.trim() === '');
const texto = (valor) => (presente(valor) ? String(valor).trim() : '');
export const soloDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

// ---- Lecturas y envío ----
export const buscarPersonaIngreso = (dispositivoId, dni, opciones = {}) => conVerificacion(
  () => becasRequest(`${RUTAS_INGRESO.persona(dispositivoId)}?dni=${encodeURIComponent(soloDigitos(dni))}`, opciones));

export const getFormularioIngreso = (dispositivoId, opciones = {}) => conVerificacion(
  () => becasRequest(RUTAS_INGRESO.formulario(dispositivoId), opciones));

// `{plaza_id, ciudadano_id | persona_nueva:{dni,nombre,apellido,sexo,fecha_nacimiento}, formulario?:{version,respuestas}}`.
// Una de las dos formas de indicar a la persona, nunca las dos. El formulario solo si el paso 2 trajo uno.
export const cuerpoIngreso = ({ plazaId, ciudadanoId = null, personaNueva = null, formulario = null } = {}) => {
  const cuerpo = { plaza_id: Number(plazaId) };
  if (presente(ciudadanoId)) {
    cuerpo.ciudadano_id = Number(ciudadanoId);
  } else if (personaNueva) {
    cuerpo.persona_nueva = {
      dni: soloDigitos(personaNueva.dni),
      nombre: texto(personaNueva.nombre),
      apellido: texto(personaNueva.apellido),
      sexo: texto(personaNueva.sexo).toUpperCase(),
      fecha_nacimiento: fechaNacimientoIso(personaNueva.fecha_nacimiento),
    };
  }
  if (formulario && presente(formulario.version)) {
    cuerpo.formulario = { version: formulario.version, respuestas: formulario.respuestas || {} };
  }
  return cuerpo;
};

export const ingresarPersona = (dispositivoId, datos = {}, opciones = {}) => conVerificacion(
  () => becasRequest(RUTAS_INGRESO.ingresar(dispositivoId), { ...opciones, method: 'POST', body: cuerpoIngreso(datos) }));

// ---- Validación del alta en el teléfono (el back vuelve a validar) ----
// La app exige sexo y fecha de nacimiento aunque el back los acepta vacíos (decisión del PM).
export const validarPersonaNueva = ({ dni, nombre, apellido, sexo, fecha_nacimiento } = {}, ahora = new Date()) => {
  const errores = {};
  const digitos = soloDigitos(dni);
  if (digitos.length < 7 || digitos.length > 8) errores.dni = ['Escribí un DNI de 7 u 8 dígitos.'];
  if (!presente(nombre)) errores.nombre = ['Falta el nombre.'];
  if (!presente(apellido)) errores.apellido = ['Falta el apellido.'];
  if (!SEXOS_INGRESO.some((s) => s.valor === texto(sexo).toUpperCase())) errores.sexo = ['Elegí el sexo.'];
  if (!presente(fecha_nacimiento)) {
    errores.fecha_nacimiento = ['Falta la fecha de nacimiento.'];
  } else {
    try {
      if (new Date(`${fechaNacimientoIso(fecha_nacimiento)}T00:00:00`).getTime() > ahora.getTime()) errores.fecha_nacimiento = ['La fecha de nacimiento no puede ser futura.'];
    } catch {
      errores.fecha_nacimiento = ['La fecha no es válida: tiene que ser DD/MM/AAAA.'];
    }
  }
  return errores;
};

// ---- Formulario de ingreso ----
// Archivos y firmas no se cargan desde la app en este paso (§18.2): el back ya omite los opcionales; si llegara
// alguno, se saca de la definición para que el renderizador no lo dibuje.
const sinArchivos = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => !(item?.tipo_item === 'campo' && llevaArchivo({ tipo: item.tipo })))
  .map((item) => (Array.isArray(item?.items) ? { ...item, items: sinArchivos(item.items) } : item));

// `{definicion, version, requiere_archivo}` → lo que dibuja la pantalla. Sin formulario: null.
export const formularioDeIngreso = (respuesta) => {
  const f = respuesta?.formulario;
  if (!f || typeof f !== 'object') return null;
  const definicion = f.definicion && typeof f.definicion === 'object' ? f.definicion : {};
  return {
    version: f.version ?? definicion.version ?? null,
    requiereArchivo: f.requiere_archivo === true,
    definicion: { ...definicion, items: sinArchivos(definicion.items) },
  };
};

// `{clave: valor}` como las inspecciones: texto como viene, entero como número, lo vacío no se manda; los
// campos de archivo o firma nunca viajan.
export const respuestasDeIngreso = (campos = [], efectivas = {}) => {
  const respuestas = {};
  for (const campo of campos) {
    if (llevaArchivo(campo) || esCampoFirma(campo)) continue;
    const valor = efectivas[campo.clave];
    const vacio = valor === null || valor === undefined || valor === '' || (Array.isArray(valor) && !valor.length);
    if (vacio) continue;
    respuestas[campo.clave] = campo.tipo === 'INT' && /^-?\d+$/.test(String(valor).trim()) ? Number(valor) : valor;
  }
  return respuestas;
};

// El mensaje de «persona ya alojada» del paso 1 (alojamiento.mensaje), o '' si puede seguir.
export const bloqueoDePersona = (respuesta) => (respuesta?.encontrada === true && respuesta?.alojada === true
  ? (texto(respuesta?.alojamiento?.mensaje) || 'La persona ya figura alojada. Registrá el egreso o el traslado antes de alojarla de nuevo.')
  : '');

// Fuera del padrón el back dice `puede_dar_de_alta`; un back viejo no lo manda y vale `true` (como hoy: el POST rechaza con 403).
export const normalizarBusquedaPersona = (respuesta) => {
  const r = respuesta && typeof respuesta === 'object' ? respuesta : { encontrada: false };
  return { ...r, puedeDarDeAlta: r.puede_dar_de_alta !== false };
};

export const TEXTO_SIN_PERMISO_ALTA = 'La persona no está en el padrón y no tenés permiso para darla de alta.';

// Qué muestra el paso del DNI: 'persona' (está en el padrón), 'alta' (formulario de alta), 'sin_permiso' (aviso) o null (sin buscar).
export const vistaDePersona = (respuesta) => {
  if (!respuesta) return null;
  if (respuesta.encontrada === true) return 'persona';
  return normalizarBusquedaPersona(respuesta).puedeDarDeAlta ? 'alta' : 'sin_permiso';
};
