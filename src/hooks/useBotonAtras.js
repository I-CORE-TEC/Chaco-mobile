import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { crearGuardaWeb } from '../navigation/guardaAtras';

// Atrás de Android y del navegador. `activo`: hay una pantalla anterior de la app. `alAtras` hace
// lo mismo que el botón Atrás del encabezado; con `activo` falso se deja el comportamiento del sistema.
export default function useBotonAtras({ activo, alAtras }) {
  const alAtrasRef = useRef(alAtras);
  const activoRef = useRef(!!activo);
  alAtrasRef.current = alAtras;
  activoRef.current = !!activo;
  const [cambios, setCambios] = useState(0);
  const guarda = useRef(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.history?.pushState) return undefined;
      guarda.current = crearGuardaWeb(window, {
        alAtras: () => alAtrasRef.current && alAtrasRef.current(),
        alCambiar: () => setCambios((valor) => valor + 1),
      });
      return () => { guarda.current?.liberar(); guarda.current = null; };
    }
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!activoRef.current) return false;
      if (alAtrasRef.current) alAtrasRef.current();
      return true;
    });
    return () => suscripcion.remove();
  }, []);

  useEffect(() => { guarda.current?.sincronizar(!!activo); }, [activo, cambios]);
}
