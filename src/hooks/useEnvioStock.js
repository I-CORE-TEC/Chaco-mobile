import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { crearSesionEnvio, enviarOperacion, textoEspera } from '../services/stockApi';

// Solo informa al padre: un error de su callback no corta la pantalla.
const avisar = (fn, valor) => {
  try {
    fn?.(valor);
  } catch {
    // Nada.
  }
};

// El envío de una escritura de Stock (§17.1): un `uuid_cliente` por formulario abierto (crearSesionEnvio), sin doble
// toque, con el resultado ya clasificado. Con éxito: toast y `onListo(operacion)`. 404 y 403 SIN_MODULO salen de la
// pantalla (`onNoEncontrado`, `onSinModulo`); el resto queda en `falla` (con `aviso`) y lo cargado NO se toca.
// `enviar(llamar, mensajeOk)`: `llamar(uuid)` hace el POST. Devuelve `{ ok, operacion | clasificacion }`.
export default function useEnvioStock({ hayCambios = false, onCambios, onEnviando, onListo, onSinModulo, onNoEncontrado }) {
  const { showToast } = useToast();
  const sesion = useRef(null);
  if (!sesion.current) sesion.current = crearSesionEnvio();
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [falla, setFalla] = useState(null);
  const enviandoRef = useRef(false);
  const esperaHasta = useRef(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  useEffect(() => { avisar(onCambios, hayCambios); }, [hayCambios]);

  const enviar = async (llamar, mensajeOk) => {
    if (enviandoRef.current) return { ok: false, repetido: true };
    const falta = esperaHasta.current - Date.now();
    if (falta > 0) {
      setAviso(textoEspera(falta));
      return { ok: false, espera: true };
    }
    enviandoRef.current = true;
    setEnviando(true);
    avisar(onEnviando, true);
    setAviso('');
    setFalla(null);
    try {
      const r = await enviarOperacion(sesion.current, llamar);
      if (r.ok) {
        showToast({ type: 'success', message: r.operacion.ya_existia ? 'Esto ya estaba registrado: no se repitió.' : mensajeOk });
        onListo?.(r.operacion);
        return r;
      }
      if (!montado.current) return r;
      const c = r.clasificacion;
      if (c.tipo === 'no_encontrado') onNoEncontrado?.();
      else if (c.tipo === 'sin_modulo') onSinModulo?.(c.mensaje);
      else {
        // 429: el botón no manda hasta que pase el Retry-After.
        if (c.tipo === 'espera' && c.espera) esperaHasta.current = Date.now() + c.espera;
        setFalla(c);
        setAviso(c.tipo === 'espera' && c.espera ? textoEspera(c.espera) : c.mensaje);
      }
      return r;
    } finally {
      enviandoRef.current = false;
      if (montado.current) setEnviando(false);
      avisar(onEnviando, false);
    }
  };

  return { sesion: sesion.current, enviando, aviso, setAviso, falla, setFalla, enviar, montado };
}
