// «Stock» (lectura): pares institución · edificio del usuario, saldo por insumo y libro de movimientos.
// El contrato es la §17 de docs/internal/contrato-app-emergencia.md de Chaco-Back; los nombres de
// campos son los de ahí (§17 lectura y §17.1 escritura). Solo con conexión: no hay cola ni caché; las cuatro
// escrituras (entregar, ingresar, traspasar, ajustar) son idempotentes por `uuid_cliente` y no se encolan.
//
// Como el resto de Emergencia, un 403 SIN_MODULO pasa por verificarSinModulo (el mismo código
// significa también «falta un permiso parcial»): el resultado queda en `error.verificacionSinModulo`.
import * as Crypto from 'expo-crypto';
import { becasRequest } from './becasApi';
import { hayRed } from './conectividad';
import { verificarSinModulo } from './emergenciaPerfil';
import { esSinModulo } from './sinModulo';
import { formatDate } from '../utils/dates';

export const BASE = '/api/emergencia/';
const base = (dispositivoId, edificioId) => `${BASE}dispositivos/${encodeURIComponent(dispositivoId)}/edificios/${encodeURIComponent(edificioId)}/stock/`;
export const RUTAS = {
  lista: `${BASE}stock/`,
  saldo: (dispositivoId, edificioId) => base(dispositivoId, edificioId),
  movimientos: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}movimientos/`,
  destinos: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}destinos-traspaso/`,
  persona: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}persona/`,
  entregas: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}entregas/`,
  ingresos: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}ingresos/`,
  traspasos: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}traspasos/`,
  ajustes: (dispositivoId, edificioId) => `${base(dispositivoId, edificioId)}ajustes/`,
};

export const TEXTO_SIN_RED = 'Necesitás conexión para ver el stock.';
export const TEXTO_SIN_PARES = 'No tenés edificios con stock para ver.';
export const TEXTO_REINTENTAR = 'No se pudo traer el stock. Probá de nuevo en unos segundos.';
export const TEXTO_NO_ENCONTRADO = 'Ese edificio ya no está entre los tuyos o su institución dejó de llevar stock.';
export const TEXTO_SIN_MODULO = 'Tu usuario no ve el stock de ningún edificio. Pedí que te sumen con un rol que vea el stock.';
export const TEXTO_SIN_PERMISO = 'No tenés permiso para esta consulta de stock.';
export const TEXTO_VALIDACION = 'El filtro de movimientos no es válido. Volvé a la lista completa.';
export const TEXTO_ESPERAR = 'Hay demasiadas consultas seguidas. Esperá un momento y volvé a probar.';
export const TEXTO_SALDO_INSUFICIENTE = 'No alcanza el stock de algún insumo. Mirá los saldos de ahora y corregí las cantidades.';
export const TEXTO_SALDO_CAMBIO = 'El saldo cambió mientras contabas. Volvé a contar.';
export const TEXTO_UUID_EN_USO = 'Ese envío ya era de otra operación. Se generó uno nuevo: revisá lo cargado y volvé a tocar el botón.';
export const TEXTO_NO_HABILITADO = 'Este edificio o su institución no está habilitado para mover stock ahora (la institución no está activa, el edificio está inactivo o el destino no lleva stock). No se movió nada. Consultalo con quien administra el stock.';
export const TEXTO_PERSONA_SIN_DATOS = 'No se encontró a la persona. Completá los datos que faltan para entregarle.';
export const TEXTO_UUID_EN_USO_INCIERTO = 'El servidor dice que este envío ya es de otra operación. Puede que el primero sí haya llegado: no lo mandes de nuevo. Revisá los movimientos del edificio antes de cargar otra vez.';
export const TEXTO_YA_EXISTIA_DISTINTO = 'Ya había un envío registrado con datos distintos a los de ahora, y no se repitió. Revisá los movimientos del edificio antes de cargar de nuevo.';
// Sin conexión ANTES de enviar: no salió nada, lo cargado se puede editar.
export const TEXTO_SIN_RED_ESCRITURA = 'Necesitás conexión para mandar esto. No se envió nada y lo cargado se conserva: reintentá cuando tengas señal.';
// Resultado INCIERTO (timeout, corte con el pedido en camino, 5xx): pudo haber llegado. El formulario queda congelado.
const REVISAR = 'El envío pudo haber llegado. Los datos quedan bloqueados: reintentá con los mismos datos (si ya había llegado, no se repite) o salí y revisá los movimientos del edificio antes de cargar de nuevo.';
export const TEXTO_TIMEOUT_ESCRITURA = `El servidor tardó demasiado en responder. ${REVISAR}`;
export const TEXTO_CORTE_ESCRITURA = `Se cortó la conexión mientras se enviaba. ${REVISAR}`;
export const TEXTO_REINTENTAR_ESCRITURA = `No se pudo confirmar el envío. ${REVISAR}`;
export const TEXTO_SIN_PERMISO_ESCRITURA = 'No tenés permiso para esta acción en este edificio.';

const lista = (valor) => (Array.isArray(valor) ? valor : []);
const texto = (valor) => (typeof valor === 'string' ? valor : '');
const numero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

// `{item_id, nombre, unidad, cantidad, alcanza}`: los saldos de TODAS las líneas que salen (409 SALDO_INSUFICIENTE).
const normalizarSaldosRechazo = (saldos) => lista(saldos).filter((saldo) => saldo?.item_id != null).map((saldo) => ({
  item_id: saldo.item_id, nombre: texto(saldo.nombre), unidad: texto(saldo.unidad), cantidad: numero(saldo.cantidad), alcanza: saldo.alcanza !== false,
}));

// 400 VALIDACION: `{ campo: [mensajes] }` con lo que trae el back (`detail` y `code` quedan aparte).
const erroresPorCampo = (payload) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  const salida = {};
  Object.keys(datos).forEach((campo) => {
    if (campo === 'detail' || campo === 'code') return;
    const mensajes = (Array.isArray(datos[campo]) ? datos[campo] : [datos[campo]]).filter((m) => typeof m === 'string' && m.trim());
    if (mensajes.length) salida[campo] = mensajes;
  });
  return salida;
};

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
// - Escritura (§17.1): saldo_insuficiente (409 con `saldos`), saldo_cambio (409 con `saldoActual`), uuid_en_uso (409),
//   no_habilitado (409 STOCK_NO_HABILITADO), persona_sin_datos (400 con `pideSexo` y `motivo`); un 400 VALIDACION
//   trae además `errores` por campo.
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
  if (status === 400 && !html && code === 'VALIDACION') {
    return { tipo: 'validacion', mensaje: detalleDe(error) || TEXTO_VALIDACION, errores: erroresPorCampo(error?.payload) };
  }
  if (status === 400 && !html && code === 'PERSONA_SIN_DATOS') {
    return { tipo: 'persona_sin_datos', mensaje: detalleDe(error) || TEXTO_PERSONA_SIN_DATOS, pideSexo: error.payload.pide_sexo === true, motivo: texto(error.payload.motivo) };
  }
  if (status === 409 && !html && code === 'SALDO_INSUFICIENTE') {
    return { tipo: 'saldo_insuficiente', mensaje: detalleDe(error) || TEXTO_SALDO_INSUFICIENTE, saldos: normalizarSaldosRechazo(error.payload.saldos) };
  }
  if (status === 409 && !html && code === 'SALDO_CAMBIO') {
    const actual = error.payload.saldo_actual;
    return { tipo: 'saldo_cambio', mensaje: detalleDe(error) || TEXTO_SALDO_CAMBIO, saldoActual: actual == null ? null : numero(actual) };
  }
  if (status === 409 && !html && code === 'UUID_EN_USO') return { tipo: 'uuid_en_uso', mensaje: TEXTO_UUID_EN_USO };
  if (status === 409 && !html && code === 'STOCK_NO_HABILITADO') return { tipo: 'no_habilitado', mensaje: TEXTO_NO_HABILITADO };
  if (status === 429 && !html) {
    const espera = Number(error?.retryAfter) > 0 ? Number(error.retryAfter) : null;
    return { tipo: 'espera', mensaje: TEXTO_ESPERAR, espera };
  }
  return { tipo: 'otro', mensaje: TEXTO_REINTENTAR };
};

// ---- Normalización ----
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

// ---- Escritura (§17.1) ----
export const ORIGENES_INGRESO = [
  { id: 'DONACION', texto: 'Donación' }, { id: 'MUNICIPIO', texto: 'Municipio' }, { id: 'COMPRA', texto: 'Compra' },
  { id: 'OTRO_PROGRAMA', texto: 'Otro programa' }, { id: 'OTRO', texto: 'Otro' },
];
export const MOTIVOS_AJUSTE = [
  { id: 'INVENTARIO_INICIAL', texto: 'Inventario inicial' }, { id: 'CONTEO_PERIODICO', texto: 'Conteo periódico' },
  { id: 'ROTURA_VENCIMIENTO', texto: 'Rotura o vencimiento' }, { id: 'PERDIDA_ROBO', texto: 'Pérdida o robo' },
  { id: 'CORRECCION_CARGA', texto: 'Corrección de una carga' }, { id: 'OTRO', texto: 'Otro' },
];
export const SEXOS = [{ id: 'F', texto: 'Femenino' }, { id: 'M', texto: 'Masculino' }, { id: 'X', texto: 'X' }];
// §17.1: con estos, el texto de acompañamiento es obligatorio.
export const MOTIVOS_CON_DETALLE = ['OTRO', 'CORRECCION_CARGA'];
export const ORIGEN_CON_DETALLE = 'OTRO';

// El `uuid_cliente` nace al abrir el formulario (nuevoUuid) y se conserva en los reintentos.
export const nuevoUuid = () => String(Crypto.randomUUID()).toLowerCase();

const lleno = (valor) => typeof valor === 'string' && valor.trim() !== '';
const conTexto = (cuerpo, campo, valor) => (lleno(valor) ? { ...cuerpo, [campo]: valor.trim() } : cuerpo);
const soloDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

// `cantidades` = { [item_id]: texto } y `insumos` = [{ item_id }] → [{ item_id, cantidad }] solo con enteros > 0.
export const cantidadValida = (valor) => /^\d+$/.test(String(valor ?? '').trim()) && Number(String(valor).trim()) > 0;
export const armarLineas = (cantidades = {}, insumos = []) => insumos
  .filter((insumo) => cantidadValida(cantidades[insumo.item_id]))
  .map((insumo) => ({ item_id: insumo.item_id, cantidad: Number(String(cantidades[insumo.item_id]).trim()) }));

// Cada armado deja fuera lo vacío: el back no recibe campos en blanco.
export const armarEntrega = ({ uuid_cliente, dni, lineas, sexo, nombre, apellido, observacion }) => {
  let cuerpo = { uuid_cliente, dni: soloDigitos(dni), lineas };
  cuerpo = conTexto(cuerpo, 'sexo', sexo);
  cuerpo = conTexto(cuerpo, 'nombre', nombre);
  cuerpo = conTexto(cuerpo, 'apellido', apellido);
  return conTexto(cuerpo, 'observacion', observacion);
};
export const armarIngreso = ({ uuid_cliente, lineas, origen, origen_detalle, comprobante }) => {
  const cuerpo = { uuid_cliente, lineas, origen };
  return conTexto(conTexto(cuerpo, 'origen_detalle', origen === ORIGEN_CON_DETALLE ? origen_detalle : ''), 'comprobante', comprobante);
};
export const armarTraspaso = ({ uuid_cliente, destino_dispositivo_id, destino_edificio_id, lineas, observacion }) => conTexto(
  { uuid_cliente, destino_dispositivo_id, destino_edificio_id, lineas }, 'observacion', observacion);
export const armarAjuste = ({ uuid_cliente, item_id, cantidad_contada, saldo_visto, motivo, detalle }) => conTexto({
  uuid_cliente, item_id, cantidad_contada: Number(String(cantidad_contada).trim()), saldo_visto: Number(saldo_visto), motivo,
}, 'detalle', detalle);

// GET persona/?dni=&sexo= → { persona: { dni, nombre, apellido } | null, historial: [{ creado_en, institucion, lineas }] }.
export const normalizarPersona = (payload) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  const persona = datos.persona && typeof datos.persona === 'object'
    ? { dni: texto(datos.persona.dni), nombre: texto(datos.persona.nombre), apellido: texto(datos.persona.apellido) } : null;
  return {
    persona,
    historial: lista(datos.historial).map((entrega) => ({
      creado_en: entrega?.creado_en || null,
      institucion: texto(entrega?.institucion) || 'Otra institución',
      lineas: lista(entrega?.lineas).map((linea) => ({ nombre: texto(linea?.nombre), unidad: texto(linea?.unidad), cantidad: numero(linea?.cantidad) })),
    })),
  };
};
export const armarQueryPersona = ({ dni, sexo = '' } = {}) => `?dni=${encodeURIComponent(soloDigitos(dni))}${lleno(sexo) ? `&sexo=${encodeURIComponent(sexo.trim())}` : ''}`;

export const normalizarDestinos = (payload) => normalizarPares(payload).map(({ dispositivo, edificio }) => ({ dispositivo, edificio }));

// 201 o 200 (`ya_existia`): { id, tipo, uuid_cliente, ya_existia, creado_en, movimientos }.
export const normalizarOperacion = (payload) => {
  const datos = payload && typeof payload === 'object' ? payload : {};
  return {
    id: datos.id ?? null,
    tipo: texto(datos.tipo),
    uuid_cliente: datos.uuid_cliente ?? null,
    ya_existia: datos.ya_existia === true,
    creado_en: datos.creado_en || null,
    movimientos: lista(datos.movimientos).map((mov) => ({
      item_id: mov?.item_id ?? null, nombre: texto(mov?.nombre), unidad: texto(mov?.unidad), cantidad: numero(mov?.cantidad),
      saldo_posterior: mov?.saldo_posterior == null ? null : numero(mov.saldo_posterior),
    })),
  };
};

export const getDestinosTraspaso = (dispositivoId, edificioId) => conVerificacion(async () => normalizarDestinos(
  await becasRequest(RUTAS.destinos(dispositivoId, edificioId))));
export const getPersona = (dispositivoId, edificioId, consulta) => conVerificacion(async () => normalizarPersona(
  await becasRequest(`${RUTAS.persona(dispositivoId, edificioId)}${armarQueryPersona(consulta)}`)));

const enviar = (ruta) => (dispositivoId, edificioId, cuerpo) => conVerificacion(async () => normalizarOperacion(
  await becasRequest(ruta(dispositivoId, edificioId), { method: 'POST', body: cuerpo })));
export const postEntrega = enviar(RUTAS.entregas);
export const postIngreso = enviar(RUTAS.ingresos);
export const postTraspaso = enviar(RUTAS.traspasos);
export const postAjuste = enviar(RUTAS.ajustes);

// Como clasificarError, pero con los textos de quien MANDA algo: sin red y los errores sin code no dicen «ver».
export const clasificarErrorEscritura = (error) => {
  const clasificado = clasificarError(error);
  // `incierto: true` = el pedido pudo haber llegado (timeout, 5xx/otro): el formulario se congela. Un `network` sin
  // timeout es «sin conexión» (no salió); enviarOperacion lo vuelve corte si la red andaba al empezar.
  if (clasificado.tipo === 'sin_red') {
    return error?.timeout === true
      ? { ...clasificado, mensaje: TEXTO_TIMEOUT_ESCRITURA, incierto: true }
      : { ...clasificado, mensaje: TEXTO_SIN_RED_ESCRITURA };
  }
  if (clasificado.tipo === 'sin_permiso' && clasificado.mensaje === TEXTO_SIN_PERMISO) return { ...clasificado, mensaje: TEXTO_SIN_PERMISO_ESCRITURA };
  if (clasificado.tipo === 'otro') return { ...clasificado, mensaje: TEXTO_REINTENTAR_ESCRITURA, incierto: true };
  return clasificado;
};

// 429 con Retry-After (en ms, como el resto de la app): «Esperá 12 segundos…».
export const textoEspera = (ms) => {
  const segundos = Math.max(1, Math.ceil(Number(ms) / 1000));
  return `Hay demasiados pedidos seguidos. Esperá ${segundos} ${segundos === 1 ? 'segundo' : 'segundos'} y volvé a probar. Lo cargado se conserva.`;
};

// Idempotencia (§17.1): UN uuid por formulario abierto. Un reintento usa el mismo: si la primera vez llegó, el back
// contesta 200 `ya_existia` y no mueve el saldo. Pero el back NO compara las líneas ni el DNI: por eso, tras un
// resultado INCIERTO (timeout, corte, 5xx) la sesión queda `incierto` y el cuerpo ya no puede cambiar (el hook
// reusa el mismo `llamar`). Solo una respuesta definitiva del back (rechazo de saldo, validación…) lo levanta.
// UUID_EN_USO sin incierto: ese uuid es de otra operación y no escribió nada → uno nuevo. Con incierto: puede ser la
// misma operación con otro destino → se bloquea y se manda a revisar los movimientos.
const DEFINITIVOS = ['saldo_insuficiente', 'saldo_cambio', 'validacion', 'persona_sin_datos', 'no_habilitado', 'sin_permiso', 'sin_modulo', 'no_encontrado'];
export const crearSesionEnvio = (generar = nuevoUuid) => {
  let uuid = generar();
  let incierto = false;
  let bloqueado = false;
  return {
    uuid: () => uuid,
    incierto: () => incierto,
    bloqueado: () => bloqueado,
    // → la clasificación final (UUID_EN_USO tras un incierto cambia de texto y bloquea).
    resolver: (clasificacion) => {
      if (clasificacion?.incierto) incierto = true;
      else if (clasificacion?.tipo === 'uuid_en_uso') {
        if (incierto) {
          bloqueado = true;
          return { ...clasificacion, mensaje: TEXTO_UUID_EN_USO_INCIERTO, bloqueado: true };
        }
        uuid = generar();
      } else if (DEFINITIVOS.includes(clasificacion?.tipo)) incierto = false;
      return clasificacion;
    },
    exito: () => { incierto = false; },
    // 200 `ya_existia` con otros datos: lo registrado no es lo que se ve en pantalla.
    advertir: () => { bloqueado = true; },
  };
};

// ¿Los `movimientos` devueltos son los que se mandaron? `esperado`: `{ lineas }` (entregar, ingresar, traspasar: mismos
// insumos y cantidades; el back solo devuelve el lado de origen) o `{ item_id, saldo_posterior }` (ajustar).
export const coincideConLoEnviado = (operacion, esperado) => {
  if (!esperado) return true;
  const movimientos = lista(operacion?.movimientos);
  if (esperado.lineas) {
    const mandado = new Map(esperado.lineas.map((l) => [String(l.item_id), Number(l.cantidad)]));
    return movimientos.length === mandado.size && movimientos.every((m) => mandado.get(String(m.item_id)) === Math.abs(numero(m.cantidad)));
  }
  return movimientos.length === 1 && String(movimientos[0].item_id) === String(esperado.item_id)
    && movimientos[0].saldo_posterior === Number(esperado.saldo_posterior);
};

// `llamar(uuid)` hace el POST. → { ok: true, operacion, distinto } o { ok: false, clasificacion }. Sin red ANTES de
// enviar (hayRed) no se manda nada. Un `network` sin timeout con red al empezar es un corte con el pedido en camino.
export const enviarOperacion = async (sesion, llamar, esperado = null) => {
  if (!(await hayRed())) {
    return { ok: false, clasificacion: sesion.resolver(clasificarErrorEscritura({ network: true })), sinEnviar: true };
  }
  try {
    const operacion = await llamar(sesion.uuid());
    sesion.exito();
    const distinto = operacion.ya_existia === true && !coincideConLoEnviado(operacion, esperado);
    if (distinto) sesion.advertir();
    return { ok: true, operacion, distinto };
  } catch (error) {
    let clasificacion = clasificarErrorEscritura(error);
    if (clasificacion.tipo === 'sin_red' && !clasificacion.incierto) {
      clasificacion = { ...clasificacion, mensaje: TEXTO_CORTE_ESCRITURA, incierto: true };
    }
    return { ok: false, clasificacion: sesion.resolver(clasificacion), error };
  }
};

// ---- Validación en el teléfono (el back vuelve a validar todo) ----
export const TEXTO_SIN_LINEAS = 'Cargá la cantidad de al menos un insumo.';
export const TEXTO_CANTIDAD_INVALIDA = 'La cantidad tiene que ser un número entero mayor que 0.';

// → { lineas?: msg, cantidades: { [item_id]: msg } }. Cantidad en blanco = ese insumo no se manda.
export const validarCantidades = (cantidades = {}, insumos = []) => {
  const errores = { cantidades: {} };
  let alguna = false;
  insumos.forEach((insumo) => {
    const valor = String(cantidades[insumo.item_id] ?? '').trim();
    if (!valor || /^0+$/.test(valor)) return;
    if (cantidadValida(valor)) alguna = true;
    else errores.cantidades[insumo.item_id] = TEXTO_CANTIDAD_INVALIDA;
  });
  if (!alguna && !Object.keys(errores.cantidades).length) errores.lineas = TEXTO_SIN_LINEAS;
  return errores;
};
export const hayErrores = (errores) => Object.keys(errores || {}).some((clave) => (clave === 'cantidades'
  ? Object.keys(errores.cantidades || {}).length > 0 : !!errores[clave]));

export const dniValido = (valor) => /^\d{6,9}$/.test(String(valor ?? '').replace(/[.\s]/g, ''));
export const validarEntrega = ({ dni, cantidades, insumos, pideSexo, sexo, pideNombre, nombre, apellido }) => {
  const errores = validarCantidades(cantidades, insumos);
  if (!dniValido(dni)) errores.dni = 'Ingresá el DNI de la persona (solo números).';
  // Alta mínima (§17.1): con nombre y apellido no hace falta el sexo.
  const conNombre = lleno(nombre) && lleno(apellido);
  const pedirNombre = pideNombre || lleno(nombre) || lleno(apellido);
  if (pideSexo && !lleno(sexo) && !conNombre) errores.sexo = 'Elegí el sexo que figura en el DNI, o cargá nombre y apellido.';
  if (pedirNombre && !lleno(nombre)) errores.nombre = 'Ingresá el nombre.';
  if (pedirNombre && !lleno(apellido)) errores.apellido = 'Ingresá el apellido.';
  return errores;
};
export const validarIngreso = ({ cantidades, insumos, origen, origen_detalle }) => {
  const errores = validarCantidades(cantidades, insumos);
  if (!lleno(origen)) errores.origen = 'Elegí de dónde viene el stock.';
  else if (origen === ORIGEN_CON_DETALLE && !lleno(origen_detalle)) errores.origen_detalle = 'Contá de dónde viene.';
  return errores;
};
export const validarTraspaso = ({ cantidades, insumos, destino }) => {
  const errores = validarCantidades(cantidades, insumos);
  if (!destino) errores.destino = 'Elegí a qué edificio se traspasa.';
  return errores;
};
export const validarAjuste = ({ item_id, cantidad_contada, saldo_visto, motivo, detalle }) => {
  const errores = {};
  const valor = String(cantidad_contada ?? '').trim();
  if (item_id == null) errores.item_id = 'Elegí el insumo que contaste.';
  if (!/^\d+$/.test(valor)) errores.cantidad_contada = 'Ingresá lo que contaste: un número entero, 0 o más.';
  else if (item_id != null && Number(valor) === Number(saldo_visto)) errores.cantidad_contada = 'Contaste lo mismo que hay: no hay nada que ajustar.';
  if (!lleno(motivo)) errores.motivo = 'Elegí el motivo del ajuste.';
  else if (MOTIVOS_CON_DETALLE.includes(motivo) && !lleno(detalle)) errores.detalle = 'Contá qué pasó.';
  return errores;
};
