// «Stock» (lectura): pares institución · edificio del usuario, saldo por insumo y libro de movimientos.
// El contrato es la §17 de docs/internal/contrato-app-emergencia.md de Chaco-Back; los nombres de
// campos son los de ahí. Solo con conexión: no hay cola ni caché. Sin escrituras (son de otro PR).
//
// Como el resto de Emergencia, un 403 SIN_MODULO pasa por verificarSinModulo (el mismo código
// significa también «falta un permiso parcial»): el resultado queda en `error.verificacionSinModulo`.
import { becasRequest } from './becasApi';
import { verificarSinModulo } from './emergenciaPerfil';
import { esSinModulo } from './sinModulo';
import { formatDate } from '../utils/dates';

export const BASE = '/api/emergencia/';
const base = (dispositivoId, edificioId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/edificios/${encodeURIComponent(edificioId)}/stock/`;
export const RUTAS = {
  lista: `${BASE}stock/`,
  saldo: (dispositivoId, edificioId) => base(dispositivoId, edificioId),
  movimientos: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}movimientos/`,
};

export const TEXTO_SIN_RED = 'Necesitás conexión para ver el stock.';
export const TEXTO_SIN_PARES = 'No tenés edificios con stock para ver.';
export const TEXTO_REINTENTAR = 'No se pudo traer el stock. Probá de nuevo en unos segundos.';
export const TEXTO_NO_ENCONTRADO = 'Ese edificio ya no está entre los tuyos o su institución dejó de llevar stock.';
export const TEXTO_SIN_MODULO = 'Tu usuario no ve el stock de ningún edificio. Pedí que te sumen con un rol que vea el stock.';
export const TEXTO_SIN_PERMISO = 'No tenés permiso para esta consulta de stock.';
export const TEXTO_VALIDACION = 'El filtro de movimientos no es válido. Volvé a la lista completa.';
export const TEXTO_ESPERAR = 'Hay demasiadas consultas seguidas. Esperá un momento y volvé a probar.';

const conVerificacion = async (pedido) => {
  try {
    return await pedido();
  } catch (error) {
    const verificacion = await verificarSinModulo(error);
    if (verificacion) error.verificacionSinModulo = verificacion;
    throw error;
  }
};

const detalleDe = (error) => (typeof error?.payload?.detail === 'string' && error.payload.detail.trim() ? error.payload.detail.trim() : '');

// §17 «Códigos»: por status y `code`, nunca por el texto. `tipo`:
// - sin_red: sin conexión.   - sin_modulo: 403 SIN_MODULO (no ve stock en ningún edificio).
// - sin_permiso: 403 SIN_PERMISO (ve el edificio pero no tiene esa capacidad).
// - no_encontrado: 404 (edificio inexistente, ajeno, fuera de alcance o institución sin stock: el mismo cuerpo).
// - validacion: 400 VALIDACION (tipo, item o cursor inválidos).   - espera: 429 con `espera` en ms si vino Retry-After.
// - otro: HTML, 5xx y lo demás, con texto fijo (nunca `error.message` crudo).
export const clasificarError = (error) => {
  const status = Number(error?.status);
  const html = error?.unexpectedHtml === true;
  const code = error?.payload?.code;
  if (error?.network) return { tipo: 'sin_red', mensaje: TEXTO_SIN_RED };
  if (esSinModulo(error)) return { tipo: 'sin_modulo', mensaje: detalleDe(error) || TEXTO_SIN_MODULO };
  // Un 403 que viene de un intermediario (el WAF de ECOM devuelve HTML) no es un permiso del back.
  if (status === 403 && !html) {
    return { tipo: 'sin_permiso', mensaje: code === 'SIN_PERMISO' ? (detalleDe(error) || TEXTO_SIN_PERMISO) : TEXTO_SIN_PERMISO };
  }
  if (status === 404 && !html) return { tipo: 'no_encontrado', mensaje: TEXTO_NO_ENCONTRADO };
  if (status === 400 && !html && code === 'VALIDACION') return { tipo: 'validacion', mensaje: detalleDe(error) || TEXTO_VALIDACION };
  if (status === 429 && !html) {
    const espera = Number(error?.retryAfter) > 0 ? Number(error.retryAfter) : null;
    return { tipo: 'espera', mensaje: TEXTO_ESPERAR, espera };
  }
  return { tipo: 'otro', mensaje: TEXTO_REINTENTAR };
};

// ---- Normalización ----
const lista = (valor) => (Array.isArray(valor) ? valor : []);
const texto = (valor) => (typeof valor === 'string' ? valor : '');
const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);
const unidad = (par) => ({ id: par?.id, nombre: texto(par?.nombre) });

// `puede`: lo que la app muestra como botón solo viene en true (las escrituras son de otro PR).
export const normalizarPuede = (puede) => ({
  entregar: puede?.entregar === true,
  ingresar: puede?.ingresar === true,
  ajustar: puede?.ajustar === true,
});

// GET stock/ → [{ dispositivo, edificio, insumos_con_saldo, puede }]. Sin ids no se puede abrir: se descarta.
export const normalizarPares = (payload) => lista(payload).map((item) => ({
  dispositivo: unidad(item?.dispositivo),
  edificio: unidad(item?.edificio),
  insumos_con_saldo: Math.max(0, Math.trunc(numero(item?.insumos_con_saldo))),
  puede: normalizarPuede(item?.puede),
})).filter((item) => item.dispositivo.id != null && item.edificio.id != null);

// «3 insumos con saldo», «1 insumo con saldo», «Sin saldo».
export const textoInsumosConSaldo = (cantidad) => {
  const n = Math.max(0, Math.trunc(numero(cantidad)));
  if (n === 0) return 'Sin saldo';
  return `${n} ${n === 1 ? 'insumo' : 'insumos'} con saldo`;
};

// GET dispositivos/{d}/edificios/{e}/stock/ → { dispositivo, edificio, puede, saldos, insumos_activos }.
export const normalizarSaldo = (payload) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  return {
    dispositivo: unidad(datos.dispositivo),
    edificio: unidad(datos.edificio),
    puede: normalizarPuede(datos.puede),
    saldos: lista(datos.saldos).filter((saldo) => saldo?.item_id != null).map((saldo) => ({
      item_id: saldo.item_id,
      nombre: texto(saldo.nombre) || `Insumo ${saldo.item_id}`,
      unidad: texto(saldo.unidad),
      cantidad: numero(saldo.cantidad),
      // Un insumo desactivado con saldo se lista con `activo: false` (§17 «Saldos»).
      activo: saldo.activo !== false,
    })),
    insumos_activos: lista(datos.insumos_activos).filter((insumo) => insumo?.item_id != null).map((insumo) => ({
      item_id: insumo.item_id, nombre: texto(insumo.nombre), unidad: texto(insumo.unidad),
    })),
  };
};

// «18 unidades» / «18». La unidad es la del insumo.
export const textoCantidad = (cantidad, unidadTexto = '') => `${numero(cantidad)}${unidadTexto ? ` ${unidadTexto}` : ''}`;

// ---- Libro de movimientos ----
// El libro viene de a 50, del más nuevo al más viejo, y se pagina por `cursor` (el `siguiente` de la
// página anterior; `null` si no hay más), por `id`: un movimiento nuevo no corre la página.
export const MOVIMIENTOS_POR_PAGINA = 50;

export const armarQueryMovimientos = ({ tipo = null, item = null, cursor = null } = {}) => {
  const partes = [];
  const presente = (valor) => valor !== null && valor !== undefined && String(valor).trim() !== '';
  if (presente(tipo)) partes.push(`tipo=${encodeURIComponent(String(tipo).trim())}`);
  if (presente(item)) partes.push(`item=${encodeURIComponent(String(item).trim())}`);
  if (presente(cursor)) partes.push(`cursor=${encodeURIComponent(String(cursor).trim())}`);
  return partes.length ? `?${partes.join('&')}` : '';
};

// { resultados: [...], siguiente } → { resultados, siguiente (cursor o null), hayMas }.
export const normalizarMovimientos = (payload) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  const resultados = lista(Array.isArray(payload) ? payload : datos.resultados).filter((mov) => mov?.id != null).map((mov) => ({
    id: mov.id,
    tipo: texto(mov.tipo),
    item_id: mov.item_id ?? null,
    nombre: texto(mov.nombre) || (mov.item_id != null ? `Insumo ${mov.item_id}` : ''),
    unidad: texto(mov.unidad),
    cantidad: numero(mov.cantidad),
    saldo_posterior: mov.saldo_posterior == null ? null : numero(mov.saldo_posterior),
    creado_en: mov.creado_en || null,
    usuario: texto(mov.usuario),
    detalle: texto(mov.detalle),
  }));
  const siguiente = datos.siguiente === null || datos.siguiente === undefined || datos.siguiente === '' ? null : datos.siguiente;
  return { resultados, siguiente, hayMas: siguiente !== null };
};

// Suma una página a lo ya cargado sin repetir movimientos.
export const juntarMovimientos = (actuales, pagina) => {
  const vistos = new Set(actuales.map((mov) => String(mov.id)));
  return [...actuales, ...pagina.resultados.filter((mov) => !vistos.has(String(mov.id)))];
};

// «+5» / «−2» (entradas y salidas), para el libro.
export const textoVariacion = (cantidad) => {
  const n = numero(cantidad);
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
};

// «26/11 10:00 · Gabi Guardia». Sin fecha o sin usuario, lo que haya.
export const textoDeMovimiento = (mov) => {
  const cuando = mov?.creado_en ? formatDate(mov.creado_en, { includeTime: true }) : '';
  return [cuando, mov?.usuario].filter(Boolean).join(' · ');
};

// ---- Pedidos ----
export const getPares = () => conVerificacion(async () => normalizarPares(await becasRequest(RUTAS.lista)));
export const getSaldo = (dispositivoId, edificioId) => conVerificacion(async () => normalizarSaldo(
  await becasRequest(RUTAS.saldo(dispositivoId, edificioId))));
export const getMovimientos = (dispositivoId, edificioId, filtros = {}) => conVerificacion(async () => normalizarMovimientos(
  await becasRequest(`${RUTAS.movimientos(dispositivoId, edificioId)}${armarQueryMovimientos(filtros)}`)));
