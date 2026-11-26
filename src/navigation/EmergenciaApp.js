import React, { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import Banner from '../components/Banner';
import BottomNav from '../components/BottomNav';
import CuentaScreen from '../screens/CuentaScreen';
import useBotonAtras from '../hooks/useBotonAtras';
import EmergenciaInicioScreen from '../screens/EmergenciaInicioScreen';
import EmergenciaMisEnviosScreen from '../screens/EmergenciaMisEnviosScreen';
import EmergenciaFormulario1Screen from '../screens/EmergenciaFormulario1Screen';
import EmergenciaMisDispositivosScreen from '../screens/EmergenciaMisDispositivosScreen';
import EmergenciaEntregasScreen from '../screens/EmergenciaEntregasScreen';
import EmergenciaRecibirEntregaScreen from '../screens/EmergenciaRecibirEntregaScreen';
import EmergenciaLlegadaBuscarScreen from '../screens/EmergenciaLlegadaBuscarScreen';
import EmergenciaDerivacionScreen from '../screens/EmergenciaDerivacionScreen';
import EmergenciaIntegrantesScreen from '../screens/EmergenciaIntegrantesScreen';
import EmergenciaFichaScreen from '../screens/EmergenciaFichaScreen';
import EmergenciaCierreScreen from '../screens/EmergenciaCierreScreen';
import EmergenciaPuertaScreen from '../screens/EmergenciaPuertaScreen';
import PlazasEdificiosScreen from '../screens/PlazasEdificiosScreen';
import PlazasMapaScreen from '../screens/PlazasMapaScreen';
import PlazasEstadiasScreen from '../screens/PlazasEstadiasScreen';
import PlazasEgresoScreen from '../screens/PlazasEgresoScreen';
import PlazasCambioCamaScreen from '../screens/PlazasCambioCamaScreen';
import PlazaAccionSheet from '../screens/PlazaAccionSheet';
import StockEdificiosScreen from '../screens/StockEdificiosScreen';
import StockSaldoScreen from '../screens/StockSaldoScreen';
import StockEntregaScreen from '../screens/StockEntregaScreen';
import StockIngresoScreen from '../screens/StockIngresoScreen';
import StockTraspasoScreen from '../screens/StockTraspasoScreen';
import StockAjusteScreen from '../screens/StockAjusteScreen';
import { getPerfilGuardado, subscribePerfil } from '../services/emergenciaPerfil';
import { getMapa, normalizarMapa } from '../services/plazasApi';
import {
  descartar, getBorradorEnCurso, getLocalidadesGuardadas, getPendingCount, getResumenPendientes, reintentar, syncPendientes,
} from '../services/emergenciaCola';
import { avisoDeSalida } from '../utils/emergencia';
import { depurarBorradoresFicha } from '../services/emergenciaLimpieza';

// Entradas de la barra inferior de Emergencia. Los accesos de cada perfil (ingreso, llegadas, kits) siguen
// dentro de Inicio, filtrados por el perfil como antes.
const PESTANA_INICIO = { id: 'inicio', label: 'Inicio', icon: 'home-outline', activeIcon: 'home' };
const PESTANA_STOCK = { id: 'stock', label: 'Stock', icon: 'cube-outline', activeIcon: 'cube' };
const PESTANA_CUENTA = { id: 'cuenta', label: 'Cuenta', icon: 'person-circle-outline', activeIcon: 'person-circle' };
// «Stock» solo está si el perfil lo habilita (`perfil.stock`, §3 y §17): quien no lleva stock no la ve.
export const pestanasDelPerfil = (perfil) => (perfil?.stock === true
  ? [PESTANA_INICIO, PESTANA_STOCK, PESTANA_CUENTA] : [PESTANA_INICIO, PESTANA_CUENTA]);

const SYNC_INTERVAL_MS = 8000;
const RECONNECT_DELAY_MS = 1800;

const TITULOS = {
  envios: 'Ingreso de familias',
  formulario: 'Relevar una familia',
  kits_dispositivos: 'Recepción de kits',
  kits_entregas: 'Recepción de kits',
  kits_recibir: 'Recibir entrega',
  llegadas_dispositivos: 'Llegada de familias',
  llegadas_buscar: 'Llegada de familias',
  llegadas_derivacion: 'Derivación',
  llegadas_integrantes: 'Integrantes',
  llegadas_ficha: 'Persona',
  llegadas_cierre: 'Cerrar el ingreso',
  llegadas_puerta: 'Sin derivación',
  plazas_edificios: 'Plazas y estadías',
  plazas_mapa: 'Plazas y estadías',
  plazas_estadias: 'Plazas y estadías',
  plazas_accion: 'Plazas y estadías',
  stock_edificios: 'Stock',
  stock_saldo: 'Stock',
  stock_accion: 'Stock',
};
// Pantallas de escritura de Stock (`pantalla.accion`): su pantalla, su título y qué se pierde al salir.
const ACCIONES_STOCK = {
  entregar: { Pantalla: StockEntregaScreen, titulo: 'Entregar a una persona' },
  ingresar: { Pantalla: StockIngresoScreen, titulo: 'Ingresar stock' },
  traspasar: { Pantalla: StockTraspasoScreen, titulo: 'Traspasar' },
  ajustar: { Pantalla: StockAjusteScreen, titulo: 'Ajustar saldo' },
};
const TITULOS_ACCION_PLAZAS = { egreso: 'Registrar egreso', cambio: 'Cambiar de cama' };
const TITULOS_CIERRE = { alojar: 'Familia alojada', diferencia: 'Cerrar con diferencia', cancelar: 'Cancelar ingreso' };
// Las vistas que se vuelven a pedir con el botón de sincronizar del Banner.
const VISTAS_RECARGABLES = ['inicio', 'kits_dispositivos', 'kits_entregas', 'llegadas_dispositivos', 'llegadas_integrantes', 'llegadas_ficha',
  'plazas_edificios', 'plazas_mapa', 'plazas_estadias', 'stock_edificios', 'stock_saldo'];
const VISTAS_M1 = ['envios', 'formulario'];
const INICIO = { vista: 'inicio', uuid: null };
const STOCK_INICIO = { vista: 'stock_edificios' };
// Las pantallas con algo cargado que Atrás no tiene que perder en silencio: piden confirmar. Cada una avisa
// con `onCambios(bool)` si hay algo sin mandar; el texto dice qué pasa con lo cargado.
const TEXTO_SALIR_PERDIENDO = 'Lo que cargaste no se mandó. Si salís, se pierde.';
const SALIR_CON_CAMBIOS = {
  llegadas_puerta: TEXTO_SALIR_PERDIENDO,
  llegadas_cierre: TEXTO_SALIR_PERDIENDO,
  llegadas_ficha: 'Lo que cargaste de esta persona queda guardado como borrador en este teléfono; lo retomás cuando vuelvas a abrirla.',
  plazas_accion: TEXTO_SALIR_PERDIENDO,
  stock_accion: TEXTO_SALIR_PERDIENDO,
  kits_recibir: 'Las cantidades y la observación quedan guardadas en este teléfono; la foto del remito hay que volver a sacarla.',
};
// Con un envío sin resultado (pendiente) lo cargado NO se pierde: queda en el teléfono y se reintenta al reabrir a la familia.
const TEXTO_SALIR_PENDIENTE = 'Hay un envío de esta familia sin resultado. Queda guardado en este teléfono: cuando vuelvas a abrir a la familia podés reintentarlo.';
export const TEXTO_ENVIANDO = 'Se está enviando. Esperá un momento.';
// El mismo texto que TEXTO_PERSONA_NO_ENCONTRADA de emergenciaLlegadas (el router no importa servicios).
// Igual que TEXTO_NO_DISPONIBLE de emergenciaLlegadas (un test los compara).
const TEXTO_NO_DISPONIBLE = 'La derivación ya no está disponible.';
const TEXTO_PERSONA_NO_ENCONTRADA = 'Esa persona ya no está en la familia, o el caso ya no es de tu dispositivo. Se vuelven a cargar los integrantes.';

// Al volver la red, `alVolver`. En web, el evento `online` del navegador (la cola mira
// `navigator.onLine`: el estado guardado de NetInfo web puede seguir diciendo «sin internet»); en
// nativo, NetInfo. Devuelve la función para dejar de escuchar.
const escucharReconexion = (alVolver) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const alEstarEnLinea = () => alVolver();
    window.addEventListener('online', alEstarEnLinea);
    return () => window.removeEventListener('online', alEstarEnLinea);
  }
  let conectado = null;
  return NetInfo.addEventListener((state) => {
    const hayRed = !!state?.isConnected && state?.isInternetReachable !== false;
    const antes = conectado;
    conectado = hayRed;
    if (!antes && hayRed) alVolver();
  });
};

// Módulo Emergencia: inicio con los accesos del perfil -> M1 («Ingreso de familias»: mis envíos y
// el Formulario 1), M2 («Llegada de familias»: mis dispositivos -> buscar por DNI -> derivación ->
// integrantes -> una persona (confirmar con su ficha y su cama, o completar la ficha) -> cerrar el ingreso
// (alojar, con diferencia, cancelar); sin derivación, el Formulario 1 de la puerta (ingresar igual o avisar
// a la mesa); todo con conexión) y M3 («Recepción de kits»: mis dispositivos -> entregas por recibir ->
// recibir, sin cola y con conexión). Como Dispositivos, no importa nada de los otros módulos: comparte sesión, tema
// y componentes. La cola de M1 se sincroniza solo mientras este árbol está montado.
export default function EmergenciaApp({ onCambiarModulo }) {
  const { theme } = useTheme();
  const { showAlert, showToast } = useToast();
  const { user, logout } = useAuth();
  const displayName = user?.nombre || user?.username || 'Usuario';
  const [pestana, setPestana] = useState('inicio');
  const [pantalla, setPantalla] = useState({ vista: 'inicio', uuid: null });
  const [recarga, setRecarga] = useState(0);
  const [plazasMapa, setPlazasMapa] = useState(null);
  const edificioActual = useRef(null); // el edificio abierto AHORA (las respuestas tardías lo comparan)
  // El perfil (el guardado primero, el del back después; por subscribePerfil): decide las pestañas de la barra.
  const [perfil, setPerfil] = useState(null);
  const [cargandoPerfil, setCargandoPerfil] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [pendientes, setPendientes] = useState(0);
  const [syncTick, setSyncTick] = useState(0);
  const [enviadosTick, setEnviadosTick] = useState(0);
  // Una acción con conexión mandándose (recibir kits, aceptar o rechazar una derivación, agregar,
  // confirmar a una persona o guardar su ficha, cerrar el ingreso, ingresar igual o avisar a la mesa):
  // no se sale de la pantalla hasta saber el resultado.
  const [enviando, setEnviando] = useState(false);
  // Lo cargado sin mandar de la pantalla abierta ({ vista, valor }): lo informa cada pantalla con `onCambios`.
  const cambiosPantalla = useRef({ vista: null, valor: false });
  const marcarCambios = (deVista) => (valor, pendiente) => { cambiosPantalla.current = { vista: deVista, valor: !!valor, pendiente: pendiente === true }; };
  // Al cambiar de pantalla (aunque sea la misma vista con otra persona) lo cargado de la anterior no vale: se lee
  // al renderizar, antes de que la pantalla nueva pueda avisar algo.
  const pantallaDeCambios = useRef(null);
  if (pantallaDeCambios.current !== pantalla) {
    pantallaDeCambios.current = pantalla;
    cambiosPantalla.current = { vista: null, valor: false };
  }
  // Hasta cuándo (ms) el back pidió no buscar por DNI (429 de §13.2): sobrevive a volver y re-entrar.
  const [esperaBuscarHasta, setEsperaBuscarHasta] = useState(0);
  // La pasada de fondo en curso (su promesa) y si hay una manual: la manual espera a la de fondo.
  const fondo = useRef(null);
  const manual = useRef(false);
  const reconexion = useRef(null);
  const montado = useRef(true);

  const refrescarEstado = async () => {
    try {
      const cantidad = await getPendingCount();
      if (!montado.current) return;
      setPendientes(cantidad);
      setSyncTick((tick) => tick + 1);
    } catch {
      // Sin base local legible: se deja el estado anterior.
    }
  };

  const avisarEnviados = (resultado) => {
    if (resultado?.synced > 0 && montado.current) setEnviadosTick((tick) => tick + 1);
  };

  const sincronizarDeFondo = () => {
    if (fondo.current || manual.current) return fondo.current;
    fondo.current = (async () => {
      try {
        avisarEnviados(await syncPendientes());
      } catch {
        // Sin conexión o error temporal: queda en cola.
      } finally {
        await refrescarEstado();
      }
    })().finally(() => { fondo.current = null; });
    return fondo.current;
  };

  useEffect(() => {
    montado.current = true;
    sincronizarDeFondo();
    // La lista de localidades se guarda al entrar y se refresca una vez por día (§5).
    getLocalidadesGuardadas().catch(() => {});
    // Borradores de la ficha (M2): los de otro usuario se borran y los vencidos también.
    Promise.resolve().then(() => depurarBorradoresFicha(user?.id)).catch(() => {});
    // El perfil (barra inferior): lo guardado primero y después lo que avise el back, esté Inicio montado o no.
    getPerfilGuardado().then((guardado) => {
      if (montado.current && guardado) setPerfil((actual) => actual || guardado);
    }).catch(() => {});
    const desuscribirPerfil = subscribePerfil((nuevo) => { if (montado.current) setPerfil(nuevo); });
    const timer = setInterval(sincronizarDeFondo, SYNC_INTERVAL_MS);
    const desuscribir = escucharReconexion(() => {
      if (reconexion.current) clearTimeout(reconexion.current);
      reconexion.current = setTimeout(sincronizarDeFondo, RECONNECT_DELAY_MS);
    });
    return () => {
      montado.current = false;
      desuscribirPerfil?.();
      clearInterval(timer);
      desuscribir?.();
      if (reconexion.current) clearTimeout(reconexion.current);
    };
  }, []);

  const sincronizarAhora = async () => {
    if (VISTAS_RECARGABLES.includes(pantalla.vista)) setRecarga((valor) => valor + 1);
    if (manual.current) return;
    manual.current = true;
    setSincronizando(true);
    try {
      // Si hay una pasada de fondo, se espera a que termine y después se reintenta todo.
      if (fondo.current) await fondo.current.catch(() => {});
      const pendientesAntes = await getPendingCount().catch(() => 0);
      if (pendientesAntes > 0) {
        const result = await reintentar();
        avisarEnviados(result);
        if (result?.offline) showToast({ type: 'warning', message: 'Sin conexión. Se envía solo cuando vuelva.' });
        else if (result?.failed > 0) showToast({ type: 'warning', message: `No se pudo enviar ${result.failed}. Mirá «Mis envíos».` });
        else if (result?.synced > 0) showToast({ type: 'success', message: `Se enviaron ${result.synced}.` });
      } else if (VISTAS_M1.includes(pantalla.vista)) {
        showToast({ type: 'info', message: 'No había nada para enviar.' });
      }
    } catch (error) {
      showToast({ type: 'error', message: error?.message || 'No se pudo sincronizar.' });
    } finally {
      manual.current = false;
      if (montado.current) setSincronizando(false);
      await refrescarEstado();
    }
  };

  const salir = async () => {
    let aviso = null;
    try {
      aviso = avisoDeSalida(await getResumenPendientes());
    } catch {
      aviso = null;
    }
    if (aviso) {
      showAlert('Cerrar sesión', aviso, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: () => logout() },
      ]);
      return;
    }
    logout();
  };

  // «Relevar una familia»: con un formulario sin terminar se pregunta. Hay un solo borrador en curso:
  // empezar otra descarta el anterior, y eso se confirma aparte.
  const relevarNueva = async () => {
    let enCursoBorrador = null;
    try {
      enCursoBorrador = await getBorradorEnCurso();
    } catch {
      enCursoBorrador = null;
    }
    if (!enCursoBorrador) {
      setPantalla({ vista: 'formulario', uuid: null });
      return;
    }
    const { uuid_cliente: uuidEnCurso, resumen } = enCursoBorrador;
    const empezarOtra = () => showAlert('Empezar otra familia',
      `Se descarta lo cargado de «${resumen}», con sus fotos. No se puede deshacer.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar y empezar',
          style: 'destructive',
          onPress: async () => {
            try {
              await descartar(uuidEnCurso);
            } catch (error) {
              showToast({ type: 'error', message: error?.message || 'No se pudo descartar.' });
              return;
            }
            if (montado.current) setPantalla({ vista: 'formulario', uuid: null });
          },
        },
      ]);
    showAlert('Formulario sin terminar', `Tenés sin terminar «${resumen}».`, [
      { text: 'Seguir con ese', onPress: () => setPantalla({ vista: 'formulario', uuid: uuidEnCurso }) },
      { text: 'Empezar otra', style: 'destructive', onPress: empezarOtra },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const abrir = (acceso) => {
    if (acceso.clave === 'relevar') {
      setPantalla({ vista: 'envios', uuid: null });
      return;
    }
    if (acceso.clave === 'kits') {
      setPantalla({ vista: 'kits_dispositivos' });
      return;
    }
    if (acceso.clave === 'llegadas') {
      setPantalla({ vista: 'llegadas_dispositivos' });
      return;
    }
    if (acceso.clave === 'plazas') {
      setPantalla({ vista: 'plazas_edificios' });
      return;
    }
    proximamente(acceso.titulo);
  };

  const proximamente = (titulo) => showAlert('Próximamente',
    `«${titulo}» va a estar disponible en una próxima versión de la app.`, [{ text: 'Entendido' }]);

  // ---- M3 · Recepción de kits ----
  // Con un solo dispositivo se entra directo a sus entregas, y «volver» desde ahí va al inicio.
  const elegirDispositivo = (dispositivo, { unico = false } = {}) => setPantalla({ vista: 'kits_entregas', dispositivo, unico });
  const verEntregas = () => setPantalla((actual) => ({ vista: 'kits_entregas', dispositivo: actual.dispositivo, unico: actual.unico }));
  // `sinEntrarDirecto`: se vuelve por un 404; con un solo dispositivo no se vuelve a entrar solo.
  const verDispositivos = ({ sinEntrarDirecto = false } = {}) => setPantalla({ vista: 'kits_dispositivos', sinEntrarDirecto });
  // 403 SIN_MODULO: emergenciaApi ya volvió a pedir el perfil; el inicio muestra los accesos nuevos.
  const sinModulo = (mensaje) => {
    setEnviando(false);
    showAlert('Sin permiso', mensaje, [{ text: 'Entendido' }]);
    setPestana('inicio');
    setPantalla(INICIO);
  };
  const dispositivoNoEncontrado = () => {
    showToast({ type: 'warning', message: 'Ese dispositivo ya no está entre los tuyos. Se recargó la lista.' });
    verDispositivos({ sinEntrarDirecto: true });
  };
  // 'recibida' y 'conflicto' (409 de estado) vuelven a las entregas, que se recargan al montarse;
  // 'no_encontrada' (404) vuelve a «mis dispositivos».
  const terminarRecepcion = (motivo) => {
    setEnviando(false);
    if (motivo === 'no_encontrada') verDispositivos({ sinEntrarDirecto: true });
    else verEntregas();
  };

  // ---- Plazas y estadías (lectura) ----
  // `edificio` = { dispositivoId, edificioId, nombre } del edificio elegido; `mapa` es el último mapa traído y lo
  // comparten el mapa y las estadías (solapa «Estadías · N», filtro por sector).
  // Acciones: `abrirAccion(accion, { plaza | estadia, dispositivoId, edificioId })` abre una vista `plazas_accion`
  // (`pantalla.accion = { tipo: egreso | cambio | hoja, plaza, estadia, origen }`): `egresar` el egreso, `reubicar`
  // el cambio de cama y las demás la hoja de la cama. Al terminar, `onListo(mapa)` repinta (si el mapa es de este
  // edificio), sube `recarga` y vuelve a la vista de origen; `onCancelar` solo vuelve.
  // Con UN solo edificio se entra directo al mapa (`unico`), y Atrás desde ese mapa va al inicio.
  edificioActual.current = pantalla.edificio || null;
  const elegirEdificio = (item, { unico = false } = {}) => {
    setPlazasMapa(null);
    setPantalla({
      vista: 'plazas_mapa',
      unico,
      edificio: { dispositivoId: item.dispositivo.id, edificioId: item.edificio.id, nombre: item.edificio.nombre || item.dispositivo.nombre },
    });
  };
  const esDelEdificioActual = (mapa) => mapa?.edificio?.id != null && mapa?.dispositivo?.id != null
    && String(mapa.edificio.id) === String(pantalla.edificio?.edificioId)
    && String(mapa.dispositivo.id) === String(pantalla.edificio?.dispositivoId);
  // El mapa que trae la propia pantalla del mapa: solo si es del edificio abierto (nunca pide otra vuelta: sería un bucle).
  const actualizarMapaPlazas = (mapa) => { if (esDelEdificioActual(mapa)) setPlazasMapa(mapa); };
  const guardarFiltrosEstadias = (filtros) => setPantalla((actual) => ({ ...actual, filtrosEstadias: filtros }));
  const verMapaPlazas = () => setPantalla((actual) => ({ ...actual, vista: 'plazas_mapa' }));
  const verEstadiasPlazas = () => setPantalla((actual) => ({ ...actual, vista: 'plazas_estadias' }));
  const verEdificiosPlazas = ({ sinEntrarDirecto = false } = {}) => setPantalla({ vista: 'plazas_edificios', sinEntrarDirecto });
  const edificioNoEncontrado = () => {
    showToast({ type: 'warning', message: 'Ese edificio ya no está entre los tuyos. Se recargó la lista.' });
    verEdificiosPlazas({ sinEntrarDirecto: true });
  };
  const abrirAccionPlazas = (accion, { plaza = null, estadia = null } = {}) => {
    const tipo = accion === 'egresar' ? 'egreso' : accion === 'reubicar' ? 'cambio' : 'hoja';
    // Una sola apertura: un segundo toque (o la acción de otra vista) no pisa la que ya está abierta.
    setPantalla((actual) => {
      if (actual.vista === 'plazas_accion') return actual;
      return { ...actual, vista: 'plazas_accion', accion: { tipo, plaza, estadia, modo: accion, origen: actual.vista } };
    });
  };
  const volverDeAccionPlazas = () => {
    setEnviando(false);
    setPantalla((actual) => ({ ...actual, vista: actual.accion?.origen || 'plazas_mapa', accion: undefined }));
  };
  // Hecha: el mapa que devuelve la acción se pasa por normalizarMapa y se acepta solo si es de ESTE edificio
  // (cambiar de cama puede devolver el de otro, o null): si no, queda el anterior y la vista de origen lo vuelve
  // a pedir. `recarga` también refresca las estadías.
  const terminarAccionPlazas = (mapa) => {
    let aceptado = false;
    if (mapa) {
      const nuevo = normalizarMapa(mapa);
      if (esDelEdificioActual(nuevo)) { setPlazasMapa(nuevo); aceptado = true; }
    }
    // Desde estadías, la solapa «Estadías · N» sale del mapa: si no hay uno válido se vuelve a pedir el del edificio.
    if (!aceptado && pantalla.accion?.origen === 'plazas_estadias' && pantalla.edificio) {
      const { dispositivoId, edificioId } = pantalla.edificio;
      getMapa(dispositivoId, edificioId).then((pedido) => {
        const nuevo = normalizarMapa(pedido);
        const edificio = edificioActual.current;
        if (String(nuevo.dispositivo.id) === String(dispositivoId) && String(nuevo.edificio.id) === String(edificioId)
          && String(edificio?.dispositivoId) === String(dispositivoId) && String(edificio?.edificioId) === String(edificioId)) setPlazasMapa(nuevo);
      }).catch(() => {});
    }
    setRecarga((valor) => valor + 1);
    volverDeAccionPlazas();
  };

  // ---- Stock (lectura) ----
  // Pestaña propia de la barra inferior: lista de pares institución · edificio -> saldo y movimientos del elegido.
  // `par` = { dispositivoId, edificioId, nombre }. Atrás desde el saldo vuelve a la lista; desde la lista, al inicio.
  const elegirParStock = (item) => setPantalla({
    vista: 'stock_saldo',
    par: { dispositivoId: item.dispositivo.id, edificioId: item.edificio.id, nombre: item.edificio.nombre || item.dispositivo.nombre },
  });
  const parStockNoEncontrado = () => {
    setEnviando(false);
    showToast({ type: 'warning', message: 'Ese edificio ya no está entre los tuyos. Se recargó la lista.' });
    setPantalla(STOCK_INICIO);
  };
  // Escrituras (entregar, ingresar, traspasar, ajustar): abren `stock_accion` sobre el mismo par. Hecha o cancelada
  // vuelven al saldo, que se monta de nuevo y pide saldo y movimientos otra vez.
  const abrirAccionStock = (accion) => setPantalla((actual) => (ACCIONES_STOCK[accion] && actual.vista === 'stock_saldo'
    ? { vista: 'stock_accion', par: actual.par, accion } : actual));
  const volverDeAccionStock = () => {
    setEnviando(false);
    setPantalla((actual) => ({ vista: 'stock_saldo', par: actual.par }));
  };

  // ---- M2 · Llegada de familias ----
  // `dispositivo` y `unico` viajan por todo el recorrido; `dni` es el último buscado (la recarga por
  // estado y «volver» lo conservan). `n` cambia para volver a montar una pantalla (recargarla).
  const verDispositivosLlegadas = ({ sinEntrarDirecto = false } = {}) => setPantalla({ vista: 'llegadas_dispositivos', sinEntrarDirecto });
  const verBuscar = ({ dni = '', autoBuscar = false } = {}) => setPantalla((actual) => ({
    vista: 'llegadas_buscar', dispositivo: actual.dispositivo, unico: actual.unico, dni, autoBuscar, n: (actual.n || 0) + 1,
  }));
  const elegirDispositivoLlegadas = (dispositivo, { unico = false } = {}) => setPantalla({ vista: 'llegadas_buscar', dispositivo, unico, dni: '', n: 1 });
  const verDerivacion = (busqueda) => setPantalla((actual) => ({ ...actual, vista: 'llegadas_derivacion', busqueda, dni: busqueda.dni || actual.dni }));
  // Desde la lista de familias derivadas: no hay DNI (el último buscado era de otra familia, no se arrastra).
  const verDerivacionDeLista = (busqueda) => setPantalla((actual) => ({ ...actual, vista: 'llegadas_derivacion', busqueda, dni: '' }));
  // La derivación que se tocó en la lista ya no está pendiente (409) o ya no existe (404): se dice y se
  // vuelve a la lista, que se recarga.
  const conflictoDeLista = (clasificacion) => {
    showAlert('El caso cambió', clasificacion.mensaje, [{ text: 'Entendido' }]);
    verBuscar();
  };
  const derivacionNoDisponible = () => {
    showToast({ type: 'warning', message: TEXTO_NO_DISPONIBLE });
    verBuscar();
  };
  const verIntegrantes = (caso, dni) => setPantalla((actual) => ({
    ...actual, vista: 'llegadas_integrantes', caso, dni: dni ?? actual.dni, n: (actual.n || 0) + 1,
  }));
  // Una persona de la familia (§13.6 a §13.8). `caso` es el de los integrantes (con su estado).
  // `integrantes`: la familia tal como la mostraron los integrantes (con `es_adulto`): de ahí sale el selector
  // del adulto responsable de un menor.
  const verPersona = (integrante, caso, integrantes = []) => setPantalla((actual) => ({
    ...actual, vista: 'llegadas_ficha', persona: { n: integrante.n, integrantes }, caso: caso || actual.caso, n: (actual.n || 0) + 1,
  }));
  // Confirmada o guardada: a los integrantes, que se recargan al montarse.
  const terminarPersona = () => {
    setEnviando(false);
    setPantalla((actual) => ({ ...actual, vista: 'llegadas_integrantes', n: (actual.n || 0) + 1 }));
  };
  // 404 de la persona: puede ser que `n` ya no sea de la familia o que el caso ya no sea de este
  // dispositivo (el back no distingue): se recargan los integrantes, que con un caso ajeno dan su
  // propio 404 y vuelven a «mis dispositivos».
  const personaNoEncontrada = () => {
    setEnviando(false);
    showToast({ type: 'warning', message: TEXTO_PERSONA_NO_ENCONTRADA });
    setPantalla((actual) => ({ ...actual, vista: 'llegadas_integrantes', n: (actual.n || 0) + 1 }));
  };
  // Cerrar el ingreso (§13.9). `datos`: lo último que mostró integrantes (contador, integrantes y la
  // derivación vigente, que viaja en el cierre: Cambio 477).
  const verCierre = (cierre, datos) => setPantalla((actual) => ({
    ...actual, vista: 'llegadas_cierre', cierre, caso: datos?.caso || actual.caso, n: (actual.n || 0) + 1,
    cierreDatos: { confirmadas: datos?.confirmadas ?? 0, total: datos?.total_declarado ?? 0, integrantes: datos?.integrantes || [],
      derivacion: datos?.derivacion_id ?? null },
  }));
  // Alojada o cerrada con diferencia: a los integrantes, que se recargan en lectura. Cancelado: el caso
  // volvió a la mesa → a buscar con el DNI, sin buscar sola.
  const terminarCierre = (resultado) => {
    setEnviando(false);
    setPantalla((actual) => {
      const base = { dispositivo: actual.dispositivo, unico: actual.unico, dni: actual.dni || '', n: (actual.n || 0) + 1 };
      if (resultado?.cierre === 'cancelar') return { ...base, vista: 'llegadas_buscar', autoBuscar: false };
      const caso = actual.caso ? { ...actual.caso, estado: resultado?.estado || actual.caso.estado } : actual.caso;
      return { ...base, vista: 'llegadas_integrantes', caso };
    });
  };
  // Sin derivación (§13.10): el Formulario 1 de la puerta con lo que dijo la búsqueda.
  const verPuerta = (accion, busqueda) => setPantalla((actual) => ({
    ...actual, vista: 'llegadas_puerta', dni: busqueda?.dni || actual.dni || '', n: (actual.n || 0) + 1,
    puerta: { accion, plazasLibres: busqueda?.plazas_libres ?? 0, mensaje: busqueda?.mensaje || '',
      puedeIngresarIgual: busqueda?.puede_ingresar_igual ?? null, puedeAvisarALaMesa: busqueda?.puede_avisar_a_la_mesa ?? null },
  }));
  const ingresoDirecto = (caso) => {
    setEnviando(false);
    if (caso?.id != null) verIntegrantes(caso);
    else setPantalla((actual) => ({ ...actual, vista: 'llegadas_buscar', autoBuscar: false, n: (actual.n || 0) + 1 }));
  };
  const avisoALaMesa = () => {
    setEnviando(false);
    setPantalla((actual) => ({ ...actual, vista: 'llegadas_buscar', autoBuscar: false, n: (actual.n || 0) + 1 }));
  };
  const llegadaNoEncontrada = () => {
    setEnviando(false);
    showToast({ type: 'warning', message: 'Eso ya no está entre lo tuyo. Se recargó la lista de tus dispositivos.' });
    verDispositivosLlegadas({ sinEntrarDirecto: true });
  };
  // El router de §13.1: ante un 409 se muestra `detail` y se recarga la pantalla de `estado_actual`.
  // DERIVADO vuelve a buscar sola por el DNI (trae la derivación vigente); INGRESO_EN_CURSO, ALOJADO y
  // CERRADO, a los integrantes (en lectura si ya está alojada); EN_GESTION, NUEVO y cualquier otro,
  // a buscar de nuevo: el caso volvió a la mesa.
  const recargarPorEstado = (clasificacion) => {
    setEnviando(false);
    showAlert('El caso cambió', clasificacion.mensaje, [{ text: 'Entendido' }]);
    setPantalla((actual) => {
      const caso = actual.caso || actual.busqueda?.derivacion?.caso || null;
      const base = { dispositivo: actual.dispositivo, unico: actual.unico, dni: actual.dni || '', n: (actual.n || 0) + 1 };
      // El bucle con un caso CERRADO/ALOJADO sin ingreso aceptado lo corta la pantalla de integrantes: un
      // 409 de su propio GET nunca vuelve a mandar acá con destino integrantes.
      if (clasificacion.destino === 'integrantes' && caso?.id != null) return { ...base, vista: 'llegadas_integrantes', caso };
      if (clasificacion.destino === 'derivacion' && base.dni) return { ...base, vista: 'llegadas_buscar', autoBuscar: true };
      return { ...base, vista: 'llegadas_buscar', autoBuscar: false };
    });
  };

  const { vista, uuid } = pantalla;
  const titulo = pestana === 'cuenta' ? 'Cuenta' : vista === 'inicio' ? `Hola, ${displayName}`
    : (['kits_entregas', 'llegadas_buscar'].includes(vista) && pantalla.dispositivo?.nombre)
      || (['plazas_mapa', 'plazas_estadias'].includes(vista) && pantalla.edificio?.nombre)
      || (vista === 'stock_saldo' && pantalla.par?.nombre)
      || (vista === 'stock_accion' && ACCIONES_STOCK[pantalla.accion]?.titulo)
      || (vista === 'plazas_accion' && (TITULOS_ACCION_PLAZAS[pantalla.accion?.tipo]
        || (pantalla.accion?.plaza?.codigo ? `Cama ${pantalla.accion.plaza.codigo}` : null)))
      || (vista === 'llegadas_ficha' && pantalla.persona?.n != null && `Persona ${pantalla.persona.n}`)
      || (vista === 'llegadas_cierre' && TITULOS_CIERRE[pantalla.cierre]) || TITULOS[vista];
  const vistaVigente = useRef(vista);
  vistaVigente.current = vista;
  const enviandoVigente = useRef(enviando);
  enviandoVigente.current = enviando;
  const irAtras = () => {
    if (vista === 'formulario') setPantalla({ vista: 'envios', uuid: null });
    else if (vista === 'kits_recibir') verEntregas();
    else if (vista === 'kits_entregas' && !pantalla.unico) verDispositivos();
    else if (vista === 'llegadas_ficha' || vista === 'llegadas_cierre') setPantalla((actual) => ({ ...actual, vista: 'llegadas_integrantes', n: (actual.n || 0) + 1 }));
    else if (['llegadas_derivacion', 'llegadas_integrantes', 'llegadas_puerta'].includes(vista)) verBuscar({ dni: pantalla.dni || '' });
    else if (vista === 'llegadas_buscar' && !pantalla.unico) verDispositivosLlegadas();
    else if (vista === 'stock_accion') volverDeAccionStock();
    else if (vista === 'stock_saldo') setPantalla(STOCK_INICIO);
    else if (vista === 'stock_edificios') { setPestana('inicio'); setPantalla(INICIO); }
    else if (vista === 'plazas_accion') volverDeAccionPlazas();
    else if (vista === 'plazas_estadias') verMapaPlazas();
    else if (vista === 'plazas_mapa' && !pantalla.unico) verEdificiosPlazas({ sinEntrarDirecto: true });
    else setPantalla(INICIO);
    refrescarEstado();
  };
  // Vale para el botón del encabezado, el Atrás de Android y el del navegador, y para la barra inferior: frena
  // mientras se envía y pide confirmar con algo cargado sin mandar. `accion` es adónde se va.
  const conGuarda = (accion) => {
    if (enviando) {
      showToast({ type: 'info', message: TEXTO_ENVIANDO });
      return;
    }
    const cargado = cambiosPantalla.current;
    if (SALIR_CON_CAMBIOS[vista] && cargado.vista === vista && cargado.valor) {
      showAlert('¿Salir sin enviar?', cargado.pendiente ? TEXTO_SALIR_PENDIENTE : SALIR_CON_CAMBIOS[vista], [
        { text: 'Seguir cargando', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          // El envío pudo arrancar mientras el diálogo seguía abierto, o la pantalla cambiar: se lee lo vigente.
          onPress: () => {
            if (vistaVigente.current !== vista) return;
            if (enviandoVigente.current) { showToast({ type: 'info', message: TEXTO_ENVIANDO }); return; }
            accion();
          },
        },
      ]);
      return;
    }
    accion();
  };
  const volver = () => {
    if (pestana === 'cuenta') { setPestana('inicio'); return; }
    conGuarda(irAtras);
  };
  // Tocar una pestaña: a Inicio se llega siempre al inicio del módulo (con la guarda de arriba).
  const irAPestana = (destino) => {
    if (destino === pestana && (destino === 'cuenta' || vista === (destino === 'stock' ? 'stock_edificios' : 'inicio'))) return;
    conGuarda(() => {
      setPantalla(destino === 'stock' ? STOCK_INICIO : INICIO);
      setPestana(destino);
      refrescarEstado();
    });
  };
  // Si el perfil deja de habilitar el stock estando en esa pestaña, se vuelve al inicio.
  useEffect(() => {
    if (pestana === 'stock' && perfil && perfil.stock !== true) { setPestana('inicio'); setPantalla(INICIO); }
  }, [perfil, pestana]);
  useBotonAtras({ activo: vista !== 'inicio' || pestana !== 'inicio', alAtras: volver });
  let syncStatus = 'synced';
  if (sincronizando || cargandoPerfil) syncStatus = 'syncing';
  else if (pendientes > 0) syncStatus = 'pending';

  return (
    <>
      <Banner title={titulo} syncStatus={syncStatus} syncPendingCount={pendientes}
        onSyncPress={sincronizarAhora} showBackButton={(vista !== 'inicio' || pestana !== 'inicio') && !enviando} onBackPress={volver} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {pestana === 'cuenta' ? <CuentaScreen onCambiarModulo={onCambiarModulo || undefined} onLogout={salir} /> : null}
        {pestana === 'inicio' && vista === 'inicio' ? (
          <EmergenciaInicioScreen onAbrir={abrir} recarga={recarga} onCargando={setCargandoPerfil} />
        ) : null}
        {pestana === 'stock' && vista === 'stock_edificios' ? (
          <StockEdificiosScreen recarga={recarga} onElegir={elegirParStock} onSinModulo={sinModulo} />
        ) : null}
        {pestana === 'stock' && vista === 'stock_saldo' ? (
          <StockSaldoScreen key={`stock-${pantalla.par?.dispositivoId}-${pantalla.par?.edificioId}`}
            dispositivoId={pantalla.par?.dispositivoId} edificioId={pantalla.par?.edificioId} recarga={recarga}
            onAccion={abrirAccionStock} onNoEncontrado={parStockNoEncontrado} onSinModulo={sinModulo} />
        ) : null}
        {pestana === 'stock' && vista === 'stock_accion' ? (() => {
          const { Pantalla } = ACCIONES_STOCK[pantalla.accion] || ACCIONES_STOCK.entregar;
          return (
            <Pantalla key={`stock-${pantalla.accion}-${pantalla.par?.dispositivoId}-${pantalla.par?.edificioId}`}
              dispositivoId={pantalla.par?.dispositivoId} edificioId={pantalla.par?.edificioId}
              onListo={volverDeAccionStock} onCancelar={volverDeAccionStock} onNoEncontrado={parStockNoEncontrado} onSinModulo={sinModulo}
              onEnviando={setEnviando} onCambios={marcarCambios('stock_accion')} />
          );
        })() : null}
        {pestana === 'inicio' && vista === 'envios' ? (
          <EmergenciaMisEnviosScreen syncTick={syncTick} enviadosTick={enviadosTick} onCambio={refrescarEstado}
            onNuevo={relevarNueva}
            onCorregir={(abierto) => setPantalla({ vista: 'formulario', uuid: abierto })} />
        ) : null}
        {pestana === 'inicio' && vista === 'formulario' ? (
          <EmergenciaFormulario1Screen key={uuid || 'nuevo'} uuid={uuid}
            onTerminar={() => { setPantalla({ vista: 'envios', uuid: null }); refrescarEstado(); }} />
        ) : null}
        {pestana === 'inicio' && vista === 'kits_dispositivos' ? (
          <EmergenciaMisDispositivosScreen recarga={recarga} onElegir={elegirDispositivo} onSinModulo={sinModulo}
            entrarDirecto={!pantalla.sinEntrarDirecto} />
        ) : null}
        {pestana === 'inicio' && vista === 'kits_entregas' ? (
          <EmergenciaEntregasScreen key={String(pantalla.dispositivo?.id)} dispositivo={pantalla.dispositivo} recarga={recarga}
            onAbrir={(entrega) => setPantalla((actual) => ({ ...actual, vista: 'kits_recibir', entrega }))}
            onNoEncontrado={dispositivoNoEncontrado} onSinModulo={sinModulo} />
        ) : null}
        {pestana === 'inicio' && vista === 'kits_recibir' ? (
          <EmergenciaRecibirEntregaScreen key={String(pantalla.entrega?.id)} entrega={pantalla.entrega}
            dispositivoId={pantalla.dispositivo?.id ?? null} onTerminar={terminarRecepcion} onSinModulo={sinModulo}
            onEnviando={setEnviando} onCambios={marcarCambios('kits_recibir')} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_dispositivos' ? (
          <EmergenciaMisDispositivosScreen key="llegadas" modo="llegadas" recarga={recarga} onElegir={elegirDispositivoLlegadas}
            onSinModulo={sinModulo} entrarDirecto={!pantalla.sinEntrarDirecto} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_buscar' ? (
          <EmergenciaLlegadaBuscarScreen key={`buscar-${pantalla.dispositivo?.id}-${pantalla.n}`} dispositivo={pantalla.dispositivo}
            dniInicial={pantalla.dni} autoBuscar={!!pantalla.autoBuscar} esperaHasta={esperaBuscarHasta} onEspera={setEsperaBuscarHasta}
            onDerivacion={verDerivacion} onDerivacionDeLista={verDerivacionDeLista}
            onConflictoDeLista={conflictoDeLista} onDerivacionNoDisponible={derivacionNoDisponible} onIntegrantes={verIntegrantes}
            onNoEncontrado={llegadaNoEncontrada} onSinModulo={sinModulo} onSinDerivacion={verPuerta} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_derivacion' ? (
          <EmergenciaDerivacionScreen key={`derivacion-${pantalla.busqueda?.derivacion?.id}`} busqueda={pantalla.busqueda}
            onAceptada={(caso) => { setEnviando(false); if (caso?.id != null) verIntegrantes(caso); else verBuscar(); }}
            onRechazada={() => { setEnviando(false); verBuscar(); }}
            onConflicto={recargarPorEstado} onNoEncontrado={llegadaNoEncontrada} onSinModulo={sinModulo} onEnviando={setEnviando} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_integrantes' ? (
          <EmergenciaIntegrantesScreen key={`integrantes-${pantalla.caso?.id}-${pantalla.n}`} caso={pantalla.caso} recarga={recarga}
            onConflicto={recargarPorEstado} onNoEncontrado={llegadaNoEncontrada} onSinModulo={sinModulo}
            onCerrar={verCierre} onEnviando={setEnviando} onAbrirPersona={verPersona} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_ficha' ? (
          <EmergenciaFichaScreen key={`ficha-${pantalla.caso?.id}-${pantalla.persona?.n}-${pantalla.n}`} caso={pantalla.caso}
            n={pantalla.persona?.n} dispositivo={pantalla.dispositivo} integrantes={pantalla.persona?.integrantes || []} recarga={recarga}
            onTerminar={terminarPersona} onConflicto={recargarPorEstado} onNoEncontrado={personaNoEncontrada} onSinModulo={sinModulo}
            onEnviando={setEnviando} onCambios={marcarCambios('llegadas_ficha')} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_cierre' ? (
          <EmergenciaCierreScreen key={`cierre-${pantalla.caso?.id}-${pantalla.cierre}-${pantalla.n}`} caso={pantalla.caso} cierre={pantalla.cierre}
            confirmadas={pantalla.cierreDatos?.confirmadas ?? 0} total={pantalla.cierreDatos?.total ?? 0}
            integrantes={pantalla.cierreDatos?.integrantes || []} derivacion={pantalla.cierreDatos?.derivacion ?? null}
            dispositivo={pantalla.dispositivo} onCerrado={terminarCierre}
            onConflicto={recargarPorEstado} onNoEncontrado={llegadaNoEncontrada} onSinModulo={sinModulo} onEnviando={setEnviando}
            onCambios={marcarCambios('llegadas_cierre')} />
        ) : null}
        {pestana === 'inicio' && vista === 'llegadas_puerta' ? (
          <EmergenciaPuertaScreen key={`puerta-${pantalla.dispositivo?.id}-${pantalla.dni}-${pantalla.n}`} dispositivo={pantalla.dispositivo}
            dni={pantalla.dni} plazasLibres={pantalla.puerta?.plazasLibres ?? 0} accion={pantalla.puerta?.accion}
            mensaje={pantalla.puerta?.mensaje || ''} puedeIngresarIgual={pantalla.puerta?.puedeIngresarIgual ?? null}
            puedeAvisarALaMesa={pantalla.puerta?.puedeAvisarALaMesa ?? null} onIngresado={ingresoDirecto} onAvisado={avisoALaMesa}
            onNoEncontrado={llegadaNoEncontrada} onSinModulo={sinModulo} onEnviando={setEnviando}
            onCambios={marcarCambios('llegadas_puerta')} />
        ) : null}
        {pestana === 'inicio' && vista === 'plazas_edificios' ? (
          <PlazasEdificiosScreen recarga={recarga} onElegir={elegirEdificio} onSinModulo={sinModulo}
            entrarDirecto={!pantalla.sinEntrarDirecto} />
        ) : null}
        {pestana === 'inicio' && vista === 'plazas_mapa' ? (
          <PlazasMapaScreen key={`mapa-${pantalla.edificio?.dispositivoId}-${pantalla.edificio?.edificioId}`}
            dispositivoId={pantalla.edificio?.dispositivoId} edificioId={pantalla.edificio?.edificioId}
            mapa={plazasMapa} onMapaActualizado={actualizarMapaPlazas} onVerEstadias={verEstadiasPlazas}
            abrirAccion={abrirAccionPlazas} recarga={recarga} onNoEncontrado={edificioNoEncontrado} onSinModulo={sinModulo} />
        ) : null}
        {pestana === 'inicio' && vista === 'plazas_estadias' ? (
          <PlazasEstadiasScreen key={`estadias-${pantalla.edificio?.dispositivoId}-${pantalla.edificio?.edificioId}`}
            dispositivoId={pantalla.edificio?.dispositivoId} edificioId={pantalla.edificio?.edificioId}
            sectores={plazasMapa?.sectores || []} total={plazasMapa?.resumen?.ocupadas ?? null} onVerCamas={verMapaPlazas}
            estadoInicial={pantalla.filtrosEstadias?.estado} sectorInicial={pantalla.filtrosEstadias?.sector} onFiltros={guardarFiltrosEstadias}
            abrirAccion={abrirAccionPlazas} recarga={recarga} onNoEncontrado={edificioNoEncontrado} onSinModulo={sinModulo} />
        ) : null}
        {pestana === 'inicio' && vista === 'plazas_accion' ? (() => {
          const { tipo, plaza, estadia, modo } = pantalla.accion || {};
          const Pantalla = tipo === 'egreso' ? PlazasEgresoScreen : tipo === 'cambio' ? PlazasCambioCamaScreen : PlazaAccionSheet;
          return (
            <Pantalla key={`accion-${tipo}-${plaza?.id ?? estadia?.id}`}
              dispositivoId={pantalla.edificio?.dispositivoId} edificioId={pantalla.edificio?.edificioId} plaza={plaza} estadia={estadia} modoInicial={modo}
              onListo={terminarAccionPlazas} onCancelar={volverDeAccionPlazas}
              onEnviando={setEnviando} onCambios={marcarCambios('plazas_accion')} />
          );
        })() : null}
      </View>
      <BottomNav items={pestanasDelPerfil(perfil)} activeTab={pestana} onTabPress={irAPestana} />
    </>
  );
}
