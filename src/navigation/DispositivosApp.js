import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { escucharReconexion } from '../services/conectividad';
import { repetirMientrasActiva } from '../services/sincronizacionPeriodica';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import useBotonAtras from '../hooks/useBotonAtras';
import Banner from '../components/Banner';
import BottomNav from '../components/BottomNav';
import CuentaScreen from '../screens/CuentaScreen';
import DispositivosListaScreen from '../screens/DispositivosListaScreen';
import DispositivoDetalleScreen from '../screens/DispositivoDetalleScreen';
import DispositivoCompletarScreen from '../screens/DispositivoCompletarScreen';
import { getPendingCount, syncPendientes, reintentarFallidas } from '../services/dispositivosService';

const RECONNECT_DELAY_MS = 1800;

// Entradas de la barra inferior de Dispositivos (la misma lista para todos los roles del módulo).
const PESTANAS = [
  { id: 'inicio', label: 'Inicio', icon: 'home-outline', activeIcon: 'home' },
  { id: 'cuenta', label: 'Cuenta', icon: 'person-circle-outline', activeIcon: 'person-circle' },
];

// Módulo Dispositivos: lista -> detalle -> completar. No importa nada de Becas: comparte solo
// sesión, tema y componentes genéricos. Se monta con sesión y módulo activo, así su
// sincronización de fondo no corre mientras se trabaja en otro módulo.
export default function DispositivosApp({ onCambiarModulo }) {
  const { theme } = useTheme();
  const { showAlert, showToast } = useToast();
  const { user, logout } = useAuth();
  const displayName = user?.nombre || user?.username || 'Usuario';
  const [pestana, setPestana] = useState('inicio');
  const [pantalla, setPantalla] = useState({ vista: 'lista', id: null });
  const [syncStatus, setSyncStatus] = useState('synced');
  const [syncPendingCount, setSyncPendingCount] = useState(0);
  const [syncTick, setSyncTick] = useState(0);
  const enCurso = useRef(false);
  const reconexion = useRef(null);
  const montado = useRef(true);
  // Lo que informa la pantalla de carga: algo sin enviar, o un envío en curso.
  const estadoCompletar = useRef({ cambios: false, enviando: false });

  const refrescarEstado = async () => {
    try {
      const pendientes = await getPendingCount();
      if (!montado.current) return;
      setSyncPendingCount(pendientes);
      setSyncStatus(pendientes > 0 ? 'pending' : 'synced');
      setSyncTick((tick) => tick + 1);
    } catch {
      // Sin base local legible: se deja el estado anterior.
    }
  };

  const sincronizarDeFondo = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      await syncPendientes();
    } catch {
      // Sin conexión o error temporal: queda en cola.
    } finally {
      enCurso.current = false;
      await refrescarEstado();
    }
  };

  useEffect(() => {
    montado.current = true;
    sincronizarDeFondo();
    const dejarDeRepetir = repetirMientrasActiva(sincronizarDeFondo);
    const desuscribir = escucharReconexion(() => {
      if (reconexion.current) clearTimeout(reconexion.current);
      reconexion.current = setTimeout(sincronizarDeFondo, RECONNECT_DELAY_MS);
    });
    return () => {
      montado.current = false;
      dejarDeRepetir();
      desuscribir?.();
      if (reconexion.current) clearTimeout(reconexion.current);
    };
  }, []);

  const sincronizarAhora = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setSyncStatus('syncing');
    try {
      const result = await reintentarFallidas();
      if (result?.offline) showToast({ type: 'warning', message: 'Sin conexión. Se envía solo cuando vuelva.' });
      else if (result?.failed > 0) showToast({ type: 'warning', message: `No se pudo enviar ${result.failed}. Mirá el detalle del relevamiento.` });
      else if (result?.synced > 0) showToast({ type: 'success', message: `Se enviaron ${result.synced}.` });
      else showToast({ type: 'info', message: 'No había nada para enviar.' });
    } catch (error) {
      showToast({ type: 'error', message: error?.message || 'No se pudo sincronizar.' });
    } finally {
      enCurso.current = false;
      await refrescarEstado();
    }
  };

  const salir = async () => {
    let pendientes = 0;
    try {
      pendientes = await getPendingCount();
    } catch {
      pendientes = 0;
    }
    if (pendientes > 0) {
      showAlert('Cerrar sesión',
        `Tenés ${pendientes} envíos sin sincronizar; se van a enviar cuando vuelvas a entrar con este usuario.`, [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Salir', style: 'destructive', onPress: () => logout() },
        ]);
      return;
    }
    logout();
  };

  const { vista, id } = pantalla;
  const titulo = pestana === 'cuenta' ? 'Cuenta' : vista === 'lista' ? `Hola, ${displayName}` : vista === 'detalle' ? 'Relevamiento' : 'Completar relevamiento';
  const irAtras = () => setPantalla(vista === 'completar' ? { vista: 'detalle', id } : { vista: 'lista', id: null });
  // Vale para el botón del encabezado, el Atrás de Android y el del navegador.
  const vistaVigente = useRef(vista);
  vistaVigente.current = vista;
  const avisarEnvio = () => showToast({ type: 'info', message: 'Se está enviando el relevamiento. Esperá un momento.' });
  // Antes de salir de «Completar»: frena durante el envío y pide confirmar con algo cargado. La usan el
  // botón Atrás (encabezado, Android y navegador) y la barra inferior: `accion` es adónde se va.
  const conGuarda = (accion) => {
    if (vista === 'completar' && estadoCompletar.current.enviando) {
      avisarEnvio();
      return;
    }
    if (vista === 'completar' && estadoCompletar.current.cambios) {
      showAlert('¿Salir sin enviar?',
        'Lo que cargaste queda guardado como borrador en este teléfono; lo retomás cuando vuelvas a completar.', [
          { text: 'Seguir cargando', style: 'cancel' },
          {
            text: 'Salir',
            style: 'destructive',
            // El envío puede haber arrancado entre el toque en Atrás y esta confirmación: se lee el
            // estado vigente (no el capturado) y se confirma que la pantalla sigue siendo Completar.
            onPress: () => {
              if (vistaVigente.current !== 'completar') return;
              if (estadoCompletar.current.enviando) { avisarEnvio(); return; }
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
  // Tocar una pestaña: a Inicio se llega siempre a la lista (con la guarda de arriba); a Cuenta, tras la guarda.
  const irAPestana = (destino) => {
    if (destino === pestana && (destino === 'cuenta' || vista === 'lista')) return;
    conGuarda(() => {
      setPantalla({ vista: 'lista', id: null });
      setPestana(destino);
      refrescarEstado();
    });
  };
  useBotonAtras({ activo: vista !== 'lista' || pestana !== 'inicio', alAtras: volver });

  return (
    <>
      <Banner title={titulo} syncStatus={syncStatus} syncPendingCount={syncPendingCount}
        onSyncPress={sincronizarAhora} showBackButton={vista !== 'lista' || pestana !== 'inicio'} onBackPress={volver} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {pestana === 'cuenta' ? (
          <CuentaScreen
            onCambiarModulo={onCambiarModulo && (() => { onCambiarModulo(); })}
            onLogout={salir}
          />
        ) : null}
        {pestana === 'inicio' && vista === 'lista' ? (
          <DispositivosListaScreen syncTick={syncTick} onAbrir={(abierto) => setPantalla({ vista: 'detalle', id: abierto })} />
        ) : null}
        {pestana === 'inicio' && vista === 'detalle' ? (
          <DispositivoDetalleScreen inspeccionId={id} syncTick={syncTick}
            onSalir={() => { setPantalla({ vista: 'lista', id: null }); refrescarEstado(); }}
            onCompletar={(abierto) => setPantalla({ vista: 'completar', id: abierto })} />
        ) : null}
        {pestana === 'inicio' && vista === 'completar' ? (
          <DispositivoCompletarScreen inspeccionId={id} onEstado={(estado) => { estadoCompletar.current = estado; }} onTerminar={() => { setPantalla({ vista: 'lista', id: null }); refrescarEstado(); }} />
        ) : null}
      </View>
      <BottomNav items={PESTANAS} activeTab={pestana} onTabPress={irAPestana} />
    </>
  );
}
