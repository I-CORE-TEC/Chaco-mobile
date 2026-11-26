// «Plazas y estadías» (lectura): edificios del usuario, mapa de camas de un edificio y estadías.
// El contrato es la §14 de docs/internal/contrato-app-emergencia.md de Chaco-Back; los nombres de
// campos son los de ahí. Solo con conexión: no hay cola ni caché.
//
// Como el resto de Emergencia, un 403 SIN_MODULO pasa por verificarSinModulo (el mismo código
// significa también «falta un permiso parcial»): el resultado queda en `error.verificacionSinModulo`.
import { becasRequest } from './becasApi';
import { verificarSinModulo } from './emergenciaPerfil';
import { esSinModulo } from './sinModulo';
import { formatDate } from '../utils/dates';

export const BASE = '/api/emergencia/';
export const RUTAS = {
  edificios: `${BASE}edificios/`,
  mapa: (dispositivoId, edificioId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/edificios/${encodeURIComponent(edificioId)}/mapa/`,
  estadias: (dispositivoId, edificioId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/edificios/${encodeURIComponent(edificioId)}/estadias/`,
};

export const TEXTO_SIN_RED = 'Necesitás conexión para ver las plazas';
export const TEXTO_SIN_EDIFICIOS = 'No tenés edificios con plazas para gestionar.';
export const TEXTO_REINTENTAR = 'No se pudo traer la información. Probá de nuevo en unos segundos.';

const conVerificacion = async (pedido) => {
  try {
    return await pedido();
  } catch (error) {
    const verificacion = await verificarSinModulo(error);
    if (verificacion) error.verificacionSinModulo = verificacion;
    throw error;
  }
};

// §2: 400 {code: VALIDACION}, 403 {code: SIN_PERMISO | SIN_MODULO}, 404. Sin conexión: `error.network`.
export const clasificarError = (error) => {
  const status = Number(error?.status);
  const detalle = typeof error?.payload?.detail === 'string' && error.payload.detail.trim() ? error.payload.detail.trim() : '';
  if (error?.network) return { tipo: 'sin_red', mensaje: TEXTO_SIN_RED };
  if (esSinModulo(error)) return { tipo: 'sin_modulo', mensaje: detalle || 'No tenés acceso a esta función.' };
  const html = error?.unexpectedHtml === true;
  // Un 403 que viene de un intermediario (el WAF de ECOM devuelve HTML) no es un permiso del back.
  if (status === 403 && !html) return { tipo: 'sin_permiso', mensaje: detalle || 'No tenés permiso para hacer esto.' };
  if (status === 404 && !html) return { tipo: 'no_encontrado', mensaje: 'Ese edificio ya no está entre los tuyos.' };
  if (status === 400 && !html) return { tipo: 'validacion', mensaje: detalle || 'El pedido no es válido.' };
  // HTML, 5xx, 429 y lo demás: texto fijo de reintentar, nunca `error.message` crudo.
  return { tipo: 'otro', mensaje: TEXTO_REINTENTAR };
};

// ---- Resumen de camas ----
const CLAVES_RESUMEN = ['total', 'libres', 'ocupadas', 'reservadas', 'prestadas', 'fuera_servicio'];
const entero = (valor) => (Number.isFinite(Number(valor)) && Number(valor) > 0 ? Math.trunc(Number(valor)) : 0);

export const normalizarResumen = (resumen) => Object.fromEntries(
  CLAVES_RESUMEN.map((clave) => [clave, entero(resumen?.[clave])]));

// Cómo se llama y de qué color es cada estado de cama (`tono` = clave de statusTones).
export const ESTADOS_PLAZA = {
  disponible: { titulo: 'Libre', corto: 'Libre', tono: 'success' },
  ocupada: { titulo: 'Ocupada', corto: 'Ocupada', tono: 'info' },
  reservada: { titulo: 'Reservada', corto: 'Reserv.', tono: 'warning' },
  prestada: { titulo: 'Prestada', corto: 'Prestada', tono: 'brand' },
  fuera_servicio: { titulo: 'Fuera de servicio', corto: 'F. serv.', tono: 'gray' },
};
export const estadoDePlaza = (estado) => ESTADOS_PLAZA[estado]
  || { titulo: String(estado || 'Sin estado'), corto: String(estado || '-'), tono: 'gray' };

const CHIPS = [
  { clave: 'libres', estado: 'disponible', singular: 'libre', plural: 'libres', abrev: 'Libres' },
  { clave: 'ocupadas', estado: 'ocupada', singular: 'ocupada', plural: 'ocupadas', abrev: 'Ocupadas' },
  { clave: 'reservadas', estado: 'reservada', singular: 'reservada', plural: 'reservadas', abrev: 'Reserv.' },
  { clave: 'prestadas', estado: 'prestada', singular: 'prestada', plural: 'prestadas', abrev: 'Prestadas' },
  { clave: 'fuera_servicio', estado: 'fuera_servicio', singular: 'fuera de servicio', plural: 'fuera de servicio', abrev: 'Fuera serv.' },
];
const SIEMPRE = ['libres', 'ocupadas', 'reservadas'];

// Chips del resumen: solo los estados con camas. Con `todos` (mapa), libres, ocupadas y reservadas
// salen siempre, aunque estén en cero. `texto`: «12 libres», «1 reservada».
export const chipsDeResumen = (resumen, { todos = false } = {}) => {
  const datos = normalizarResumen(resumen);
  return CHIPS
    .filter(({ clave }) => datos[clave] > 0 || (todos && SIEMPRE.includes(clave)))
    .map((chip) => ({
      clave: chip.clave,
      estado: chip.estado,
      tono: ESTADOS_PLAZA[chip.estado].tono,
      cantidad: datos[chip.clave],
      abrev: chip.abrev,
      texto: `${datos[chip.clave]} ${datos[chip.clave] === 1 ? chip.singular : chip.plural}`,
    }));
};

export const textoResumenSector = (resumen) => {
  const { total, ocupadas } = normalizarResumen(resumen);
  return `${ocupadas} de ${total} ocupadas`;
};

// ---- Personas y fechas ----
// «Gómez, Lucía» -> «Gómez, L.»; sin coma queda tal cual.
export const nombreCorto = (nombre) => {
  const texto = typeof nombre === 'string' ? nombre.trim() : '';
  const partes = texto.split(',');
  if (partes.length < 2) return texto;
  const inicial = partes.slice(1).join(',').trim().charAt(0);
  return inicial ? `${partes[0].trim()}, ${inicial.toUpperCase()}.` : partes[0].trim();
};

// 30123456 -> «30.123.456». Sin DNI (sin `ciudadano.ver`), null o vacío: ''.
export const dniConPuntos = (dni) => {
  if (dni === null || dni === undefined) return '';
  const digitos = String(dni).replace(/\D/g, '');
  return digitos ? digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
};
export const textoDni = (persona) => {
  const dni = dniConPuntos(persona?.dni);
  return dni ? `DNI ${dni}` : '';
};

// ISO con zona -> «dd/mm» (y «dd/mm hh:mm» con `hora`), en hora de Argentina. Sin fecha válida: ''.
export const fechaCorta = (valor, { hora = false } = {}) => {
  if (!valor) return '';
  const coincide = /^(\d{2}\/\d{2})\/\d{4}(?: (\d{2}:\d{2}))?$/.exec(formatDate(valor, { includeTime: hora }));
  if (!coincide) return '';
  return hora && coincide[2] ? `${coincide[1]} ${coincide[2]}` : coincide[1];
};

// ---- Acciones (las implementa el PR de acciones; acá solo sus nombres) ----
export const ACCIONES_PLAZA = {
  ingresar: 'Ingresar persona',
  egresar: 'Registrar egreso',
  reubicar: 'Cambiar de cama',
  liberar: 'Liberar reserva',
  reservar: 'Reservar',
  prestar: 'Prestar',
  fuera_servicio: 'Sacar de servicio',
  volver: 'Volver a servicio',
};
export const ACCIONES_ESTADIA = { egresar: 'Egreso', reubicar: 'Cambiar de cama' };
const listaDeAcciones = (acciones, etiquetas) => (Array.isArray(acciones) ? acciones : [])
  .filter((accion) => typeof etiquetas[accion] === 'string')
  .map((accion) => ({ accion, titulo: etiquetas[accion] }));
// `ingresar` va primero: es la acción principal de una cama libre.
export const accionesDePlaza = (plaza) => {
  const lista = listaDeAcciones(plaza?.acciones, ACCIONES_PLAZA);
  return [...lista.filter((a) => a.accion === 'ingresar'), ...lista.filter((a) => a.accion !== 'ingresar')];
};
export const accionesDeEstadia = (estadia) => listaDeAcciones(estadia?.acciones, ACCIONES_ESTADIA);

// ---- Normalización de respuestas ----
const lista = (valor) => (Array.isArray(valor) ? valor : []);

export const normalizarEdificios = (payload) => lista(payload).map((item) => ({
  dispositivo: { id: item?.dispositivo?.id, nombre: item?.dispositivo?.nombre || '' },
  edificio: { id: item?.edificio?.id, nombre: item?.edificio?.nombre || '', direccion: item?.edificio?.direccion || '' },
  resumen: normalizarResumen(item?.resumen),
})).filter((item) => item.dispositivo.id != null && item.edificio.id != null);

export const normalizarMapa = (payload) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  return {
    dispositivo: { id: datos.dispositivo?.id, nombre: datos.dispositivo?.nombre || '', estado: datos.dispositivo?.estado || '' },
    edificio: { id: datos.edificio?.id, nombre: datos.edificio?.nombre || '' },
    resumen: normalizarResumen(datos.resumen),
    puede: {
      egresar: datos.puede?.egresar === true,
      admitir: datos.puede?.admitir === true,
      editar: datos.puede?.editar === true,
      ver_personas: datos.puede?.ver_personas === true,
    },
    sectores: lista(datos.sectores).map((sector) => ({
      id: sector?.id,
      nombre: sector?.nombre || '',
      tipo: sector?.tipo || '',
      resumen: normalizarResumen(sector?.resumen),
      plazas: lista(sector?.plazas).map((plaza) => ({
        ...plaza,
        persona: plaza?.persona && typeof plaza.persona === 'object' ? plaza.persona : null,
        acciones: lista(plaza?.acciones),
        bloqueo: typeof plaza?.bloqueo === 'string' ? plaza.bloqueo : '',
      })),
    })),
  };
};

// Texto corto de una cama en el mapa: quien la ocupa, o el estado.
export const textoDeCama = (plaza) => {
  if (plaza?.estado === 'ocupada' && plaza.persona?.nombre) return nombreCorto(plaza.persona.nombre);
  return estadoDePlaza(plaza?.estado).corto;
};
export const etiquetaDeCama = (plaza) => {
  const estado = estadoDePlaza(plaza?.estado).titulo.toLowerCase();
  return plaza?.persona?.nombre ? `Cama ${plaza.codigo}, ${estado}, ${plaza.persona.nombre}` : `Cama ${plaza?.codigo}, ${estado}`;
};

// Filas del detalle de una cama (hoja inferior). No hay fila de documento si el DNI viene null. El bloqueo no es
// una fila: lo muestra la hoja de acciones junto al botón que bloquea.
export const detalleDeCama = (plaza, sector) => {
  const filas = [];
  if (sector?.nombre) filas.push({ clave: 'sector', titulo: 'Sector', valor: sector.nombre });
  if (plaza?.persona?.nombre) filas.push({ clave: 'persona', titulo: 'Persona', valor: plaza.persona.nombre });
  const dni = dniConPuntos(plaza?.persona?.dni);
  if (dni) filas.push({ clave: 'dni', titulo: 'Documento', valor: dni });
  const desde = fechaCorta(plaza?.desde, { hora: true });
  const hasta = fechaCorta(plaza?.hasta, { hora: true });
  if (desde) filas.push({ clave: 'desde', titulo: 'Desde', valor: desde });
  if (hasta) filas.push({ clave: 'hasta', titulo: 'Hasta', valor: hasta });
  return filas;
};

// Una estadía de la lista (§14.4).
export const normalizarEstadia = (item) => ({
  id: item?.id,
  persona: item?.persona && typeof item.persona === 'object' ? item.persona : { nombre: '', dni: null },
  sector: item?.sector || null,
  plaza: item?.plaza || null,
  fecha_ingreso: item?.fecha_ingreso || null,
  fecha_egreso: item?.fecha_egreso || null,
  estado: item?.estado || '',
  origen: item?.origen || '',
  emergencia: item?.emergencia || null,
  acciones: lista(item?.acciones),
});

// Respuesta paginada de DRF -> { count, hayMas, siguiente (número de página), results }.
export const normalizarPagina = (payload, paginaPedida = 1) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  const results = lista(Array.isArray(payload) ? payload : datos.results).map(normalizarEstadia);
  const count = Number.isFinite(Number(datos.count)) ? Number(datos.count) : results.length;
  const hayMas = typeof datos.next === 'string' && datos.next.length > 0;
  return { count, hayMas, siguiente: hayMas ? paginaPedida + 1 : null, results };
};

// Suma una página a lo ya cargado sin repetir estadías (la lista se mueve entre pedidos).
export const juntarPaginas = (actuales, pagina) => {
  const vistos = new Set(actuales.map((estadia) => String(estadia.id)));
  return [...actuales, ...pagina.results.filter((estadia) => !vistos.has(String(estadia.id)))];
};

export const ESTADOS_ESTADIA = ['activa', 'egresada'];
export const armarQueryEstadias = ({ estado = 'activa', sector = null, page = 1 } = {}) => {
  const partes = [`estado=${ESTADOS_ESTADIA.includes(estado) ? estado : 'activa'}`];
  if (sector !== null && sector !== undefined && sector !== '') partes.push(`sector=${encodeURIComponent(sector)}`);
  if (Number(page) > 1) partes.push(`page=${Math.trunc(Number(page))}`);
  return `?${partes.join('&')}`;
};

// Detalle de una estadía: «Aula 1 · Cama A1-05 · desde 18/11».
export const detalleDeEstadia = (estadia) => {
  const partes = [];
  if (estadia?.sector?.nombre) partes.push(estadia.sector.nombre);
  if (estadia?.plaza?.codigo) partes.push(`Cama ${estadia.plaza.codigo}`);
  const dni = textoDni(estadia?.persona);
  if (dni) partes.push(dni);
  const ingreso = fechaCorta(estadia?.fecha_ingreso);
  if (ingreso) partes.push(`desde ${ingreso}`);
  const egreso = fechaCorta(estadia?.fecha_egreso);
  if (egreso) partes.push(`egresó ${egreso}`);
  return partes.join(' · ');
};
export const textoEmergencia = (estadia) => (estadia?.emergencia?.caso_numero != null
  ? `Emergencia · Caso ${estadia.emergencia.caso_numero}` : '');

// ---- Pedidos ----
export const getEdificios = () => conVerificacion(async () => normalizarEdificios(await becasRequest(RUTAS.edificios)));
export const getMapa = (dispositivoId, edificioId) => conVerificacion(async () => normalizarMapa(
  await becasRequest(RUTAS.mapa(dispositivoId, edificioId))));
export const getEstadias = (dispositivoId, edificioId, filtros = {}) => conVerificacion(async () => normalizarPagina(
  await becasRequest(`${RUTAS.estadias(dispositivoId, edificioId)}${armarQueryEstadias(filtros)}`), Number(filtros.page) || 1));
