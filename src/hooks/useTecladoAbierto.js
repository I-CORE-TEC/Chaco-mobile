import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { tecladoAbiertoWeb } from '../utils/tecladoAbierto';

const esEditable = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.isContentEditable);

// Si el teclado está abierto. La barra inferior se esconde mientras tanto para no quedar flotando
// sobre el teclado (Android con `adjustResize` y Chrome en web empujan todo hacia arriba).
export default function useTecladoAbierto() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.visualViewport) return undefined;
      const visual = window.visualViewport;
      let maxima = Math.max(window.innerHeight, visual.height);
      const medir = () => {
        maxima = Math.max(maxima, window.innerHeight, visual.height);
        setAbierto(tecladoAbiertoWeb({
          alturaMaxima: maxima,
          alturaVisible: visual.height,
          enfocadoEditable: esEditable(typeof document !== 'undefined' ? document.activeElement : null),
        }));
      };
      visual.addEventListener('resize', medir);
      window.addEventListener('focusout', medir);
      return () => {
        visual.removeEventListener('resize', medir);
        window.removeEventListener('focusout', medir);
      };
    }
    const ios = Platform.OS === 'ios';
    const alAbrir = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setAbierto(true));
    const alCerrar = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setAbierto(false));
    return () => { alAbrir.remove(); alCerrar.remove(); };
  }, []);

  return abierto;
}
