// Acciones sobre plazas (camas) y estadías de /api/emergencia/ (contrato §15 y §16). Todas son
// POST/GET JSON, solo con conexión: no hay cola offline. Las pantallas de acciones
// (PlazasEgresoScreen, PlazasCambioCamaScreen, PlazaAccionSheet) arman el cuerpo con las funciones
// de acá y clasifican el error con clasificarErrorPlaza (por status y `code`, nunca por el texto).
import { becasRequest } from './becasApi';
import { BASE, conVerificacion, fechaNacimientoIso, relevadoEnIso } from './emergenciaApi';
import { hayRed } from './conectividad';
import { esSinModulo } from './sinModulo';
import { erroresDelServidor } from '../utils/emergencia';

export const RUTAS_PLAZAS = {
  motivosEgreso: `${BASE}motivos-egreso/`,
  egresar: (id) => `${BASE}estadias/${encodeURIComponent(id)}/egresar/`,
  plazasParaCambio: (id) => `${BASE}estadias/${encodeURIComponent(id)}/plazas-para-cambio/`,
  cambiarPlaza: (id) => `${BASE}estadias/${encodeURIComponent(id)}/cambiar-plaza/`,
  accionPlaza: (id, accion) => `${BASE}plazas/${encodeURIComponent(id)}/${accion}/`,
};

// §16: acción de la cama (`plaza.acciones`) → sufijo de la ruta.
export const ACCIONES_CAMA = {
  reservar: 'reservar',
  prestar: 'prestar',
  liberar: 'liberar',
  fuera_servicio: 'fuera-servicio',
  volver: 'volver-servicio',
};

export const TEXTO_SIN_RED = 'Sin conexión: esta acción necesita señal y no se guarda para enviar después. Probá cuando vuelva la red.';
export const TEXTO_SIN_PERMISO = 'No tenés permiso para esta acción.';
export const TEXTO_EGRESO_CON_FORMULARIO = 'Este egreso se registra desde el backoffice.';
export const TEXTO_NO_DISPONIBLE_CAMA = 'La cama ya no está disponible, actualizá.';
export const TEXTO_NO_DISPONIBLE_ESTADIA = 'La estadía ya no está disponible, actualizá.';
export const TEXTO_PLAZA_OCUPADA = 'Esa cama se acaba de ocupar, elegí otra.';
export const TEXTO_PERSONA_NO_ENCONTRADA = 'No encontramos a esa persona: revisá el DNI.';
export const TEXTO_SESION = 'La sesión venció: volvé a entrar.';
export const TEXTO_REINTENTAR = 'No se pudo confirmar si la acción llegó. Actualizá el mapa antes de repetirla.';
export const TEXTO_VALIDACION = 'El servidor rechazó algunos datos. Corregí lo marcado.';

const presente = (valor) => valor !== null && valor !== undefined && !(typeof valor === 'string' && valor.trim() === '');
const texto = (valor) => (presente(valor) ? String(valor).trim() : '');

// ---- Lecturas y envíos ----
export const getMotivosEgreso = (opciones = {}) => conVerificacion(() => becasRequest(RUTAS_PLAZAS.motivosEgreso, opciones));

// §15: `{motivo_egreso_id, destino, pertenencias_devueltas: bool, observaciones}`. No manda `fecha_egreso`
// (el back toma ahora).
export const cuerpoEgreso = ({ motivo_egreso_id, destino, pertenencias_devueltas, observaciones } = {}) => ({
  motivo_egreso_id: Number(motivo_egreso_id),
  destino: texto(destino),
  pertenencias_devueltas: pertenencias_devueltas === true,
  observaciones: texto(observaciones),
});

export const egresarEstadia = (estadiaId, datos = {}, opciones = {}) => conVerificacion(
  () => becasRequest(RUTAS_PLAZAS.egresar(estadiaId), { ...opciones, method: 'POST', body: cuerpoEgreso(datos) }));

export const getPlazasParaCambio = (estadiaId, opciones = {}) => conVerificacion(
  () => becasRequest(RUTAS_PLAZAS.plazasParaCambio(estadiaId), opciones));

export const cuerpoCambioPlaza = ({ plaza_id, motivo } = {}) => ({ plaza_id: Number(plaza_id), motivo: texto(motivo) });

export const cambiarPlaza = (estadiaId, datos = {}, opciones = {}) => conVerificacion(
  () => becasRequest(RUTAS_PLAZAS.cambiarPlaza(estadiaId), { ...opciones, method: 'POST', body: cuerpoCambioPlaza(datos) }));

// «Hasta» DD/MM/AAAA (o AAAA-MM-DD) → ISO 8601 con zona, al final de ese día (23:59 local). FECHA_INVALIDA si
// no existe. Un `Date` pasa por relevadoEnIso.
export const hastaIso = (valor) => {
  if (!presente(valor)) return null;
  if (Object.prototype.toString.call(valor) === '[object Date]') return relevadoEnIso(valor);
  const [anio, mes, dia] = fechaNacimientoIso(String(valor)).split('-').map(Number);
  return relevadoEnIso(new Date(anio, mes - 1, dia, 23, 59, 0));
};

const soloDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

// §16. Reservar y prestar: `{dni, hasta?, motivo?}`. NUNCA `desde` (el back lo ignora: la reserva arranca
// ahora) ni `sexo` (se acepta pero no se usa). Lo vacío no se manda.
export const cuerpoAccionPlaza = (accion, { dni, hasta, motivo } = {}) => {
  const body = {};
  if (accion === 'reservar' || accion === 'prestar') {
    body.dni = soloDigitos(dni);
    const limite = hastaIso(hasta);
    if (limite) body.hasta = limite;
    if (presente(motivo)) body.motivo = texto(motivo);
  } else if (accion === 'liberar' || accion === 'fuera_servicio') {
    if (presente(motivo) || accion === 'fuera_servicio') body.motivo = texto(motivo);
  }
  return body;
};

export const accionarPlaza = (plazaId, accion, datos = {}, opciones = {}) => {
  const sufijo = ACCIONES_CAMA[accion];
  if (!sufijo) return Promise.reject(new Error(`Acción de cama desconocida: ${accion}`));
  return conVerificacion(() => becasRequest(RUTAS_PLAZAS.accionPlaza(plazaId, sufijo),
    { ...opciones, method: 'POST', body: cuerpoAccionPlaza(accion, datos) }));
};

// ---- Validación en el teléfono (el back vuelve a validar) ----
export const validarEgreso = ({ motivo_egreso_id, destino } = {}) => {
  const errores = {};
  if (!presente(motivo_egreso_id)) errores.motivo = ['Elegí el motivo del egreso.'];
  if (!presente(destino)) errores.destino = ['Falta el destino.'];
  return errores;
};

export const validarCambioPlaza = ({ plaza_id, motivo } = {}) => {
  const errores = {};
  if (!presente(plaza_id)) errores.plaza_id = ['Elegí la cama nueva.'];
  if (!presente(motivo)) errores.motivo = ['Falta el motivo del cambio.'];
  return errores;
};

export const validarAccionPlaza = (accion, { dni, hasta, motivo } = {}) => {
  const errores = {};
  if (accion === 'reservar' || accion === 'prestar') {
    if (soloDigitos(dni).length < 6) errores.dni = ['Escribí el DNI de la persona.'];
    if (accion === 'prestar' && !presente(hasta)) errores.hasta = ['El préstamo necesita fecha «Hasta».'];
    if (presente(hasta)) {
      try {
        if (new Date(hastaIso(hasta)).getTime() <= Date.now()) errores.hasta = ['«Hasta» tiene que ser posterior a hoy.'];
      } catch {
        errores.hasta = ['La fecha no es válida: tiene que ser DD/MM/AAAA.'];
      }
    }
  }
  if (accion === 'fuera_servicio' && !presente(motivo)) errores.motivo = ['El motivo es obligatorio para sacar la cama de servicio.'];
  return errores;
};

// ---- Qué acciones mostrar ----
// Solo las que vienen en `plaza.acciones` (§14). egresar y reubicar abren sus pantallas propias.
export const accionesDeCama = (plaza) => {
  const lista = Array.isArray(plaza?.acciones) ? plaza.acciones : [];
  return {
    reservar: lista.includes('reservar'),
    prestar: lista.includes('prestar'),
    liberar: lista.includes('liberar'),
    fueraServicio: lista.includes('fuera_servicio'),
    volver: lista.includes('volver'),
    egresar: lista.includes('egresar'),
    reubicar: lista.includes('reubicar'),
  };
};

// ---- Errores ----
const detalleDe = (error) => {
  const detail = error?.payload && typeof error.payload === 'object' ? error.payload.detail : null;
  return typeof detail === 'string' && detail.trim() ? detail.trim() : null;
};

// Por status y `code`. `tipo`: sin_red, sesion, sin_modulo, sin_permiso, egreso_con_formulario, persona_no_encontrada,
// validacion (con `errores` por campo; `plazaOcupada` si el error viene en `plaza_id`), no_encontrada (404),
// reintentable (red, 5xx, 429, WAF) y rechazo. `contexto`: 'cama' | 'estadia' para el texto del 404.
export const clasificarErrorPlaza = (error, contexto = 'cama') => {
  const status = Number(error?.status || 0);
  const code = error?.payload?.code;
  const detalle = detalleDe(error);
  const html = error?.unexpectedHtml === true;
  if (error?.code === 'SIN_RED') return { tipo: 'sin_red', mensaje: TEXTO_SIN_RED };
  if (status === 401) return { tipo: 'sesion', mensaje: TEXTO_SESION };
  if (esSinModulo(error)) return { tipo: 'sin_modulo', mensaje: detalle || TEXTO_SIN_PERMISO };
  if (status === 403 && !html) return { tipo: 'sin_permiso', mensaje: TEXTO_SIN_PERMISO };
  if (status === 409 && !html && code === 'EGRESO_CON_FORMULARIO') return { tipo: 'egreso_con_formulario', mensaje: TEXTO_EGRESO_CON_FORMULARIO };
  if (status === 404 && !html) {
    return { tipo: 'no_encontrada', mensaje: contexto === 'estadia' ? TEXTO_NO_DISPONIBLE_ESTADIA : TEXTO_NO_DISPONIBLE_CAMA };
  }
  if (status === 400 && !html && code === 'PERSONA_NO_ENCONTRADA') {
    return { tipo: 'persona_no_encontrada', mensaje: detalle || TEXTO_PERSONA_NO_ENCONTRADA, errores: { dni: [detalle || TEXTO_PERSONA_NO_ENCONTRADA] } };
  }
  if (status === 400 && !html && code === 'VALIDACION') {
    const errores = erroresDelServidor(error.payload);
    const plazaOcupada = Array.isArray(errores.plaza_id) && errores.plaza_id.length > 0;
    return {
      tipo: 'validacion',
      mensaje: detalle || TEXTO_VALIDACION,
      errores: Object.keys(errores).length ? errores : { non_field_errors: [detalle || TEXTO_VALIDACION] },
      plazaOcupada,
    };
  }
  if (status === 400 && !html) return { tipo: 'rechazo', mensaje: detalle || 'El servidor rechazó la acción.' };
  const transitoria = error?.network === true || html || !status || status >= 500 || status === 408 || status === 429;
  if (transitoria) return { tipo: 'reintentable', mensaje: status === 429 ? 'El servidor pidió esperar: probá en unos segundos.' : TEXTO_REINTENTAR };
  return { tipo: 'rechazo', mensaje: detalle || error?.message || 'El servidor rechazó la acción.' };
};

// ---- Agrupar por sector (§15 plazas-para-cambio) ----
export const sectoresConLibres = (respuesta) => (Array.isArray(respuesta?.sectores) ? respuesta.sectores : [])
  .map((sector) => ({
    id: sector?.id,
    nombre: typeof sector?.nombre === 'string' && sector.nombre ? sector.nombre : `Sector ${sector?.id}`,
    plazas: (Array.isArray(sector?.plazas) ? sector.plazas : []).filter((plaza) => plaza?.id != null),
  }))
  .filter((sector) => sector.plazas.length > 0);

// ---- Envío con red ----
// Solo online: sin conexión no se manda nada. Devuelve `{ ok: true, respuesta }` o `{ ok: false, clasificacion }`
// (nunca tira). Las pantallas usan esto para que cada acción tenga el mismo comportamiento.
export const intentarAccion = async (pedido, contexto = 'cama') => {
  if (!(await hayRed())) return { ok: false, clasificacion: { tipo: 'sin_red', mensaje: TEXTO_SIN_RED } };
  try {
    return { ok: true, respuesta: await pedido() };
  } catch (error) {
    return { ok: false, clasificacion: clasificarErrorPlaza(error, contexto) };
  }
};
