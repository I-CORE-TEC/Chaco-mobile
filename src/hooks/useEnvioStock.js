import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { TEXTO_YA_EXISTIA_DISTINTO, crearSesionEnvio, enviarOperacion, textoEspera } from '../services/stockApi';

// Solo informa al padre: un error de su callback no corta la pantalla.
const avisar = (fn, valor) => {
  try {
    fn?.(valor);
  } catch {
    // Nada.
  }
};

// El envÃ­o de una escritura de Stock (Â§17.1): un `uuid_cliente` por formulario abierto (crearSesionEnvio), sin doble
// toque, con el resultado ya clasificado. Con Ã©xito: toast y `onListo(operacion)`. 404 y 403 SIN_MODULO salen de la
// pantalla (`onNoEncontrado`, `onSinModulo`); el resto queda en `falla` (con `aviso`) y lo cargado NO se toca.
// `enviar(llamar, mensajeOk, esperado)`: `llamar(uuid)` hace el POST; `esperado` es lo que se manda (para comparar un
// `ya_existia`, ver coincideConLoEnviado). Devuelve `{ ok, operacion | clasificacion }`.
// Tras un resultado INCIERTO (timeout, corte, 5xx) el formulario queda CONGELADO (`congelado`): el back no compara
// el cuerpo con el primer envÃ­o, asÃ­ que el Ãºnico reintento vÃ¡lido es el MISMO `llamar` (se guarda y se reusa aunque
// la pantalla mande otro). `sinReintento`: ya no se puede reenviar (UUID_EN_USO tras incierto, o `ya_existia` distinto).
export default function useEnvioStock({ hayCambios = false, onCambios, onEnviando, onListo, onSinModulo, onNoEncontrado }) {
  const { showToast } = useToast();
  const sesion = useRef(null);
  if (!sesion.current) sesion.current = crearSesionEnvio();
  const pendiente = useRef(null);
  const [congelado, setCongelado] = useState(false);
  const [sinReintento, setSinReintento] = useState(false);
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

  const enviar = async (llamarNuevo, mensajeNuevo, esperadoNuevo = null) => {
    if (enviandoRef.current) return { ok: false, repetido: true };
    if (sesion.current.bloqueado()) return { ok: false, bloqueado: true };
    // Incierto: se reintenta lo MISMO que saliÃ³ la primera vez, no lo que haya ahora en pantalla.
    const previo = sesion.current.incierto() ? pendiente.current : null;
    const { llamar, mensajeOk, esperado } = previo || { llamar: llamarNuevo, mensajeOk: mensajeNuevo, esperado: esperadoNuevo };
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
      const r = await enviarOperacion(sesion.current, llamar, esperado);
      if (r.ok && r.distinto) {
        // Ya estaba registrado, pero con otros datos: no es un Ã©xito de lo que se ve en pantalla.
        if (montado.current) {
          setFalla({ tipo: 'ya_existia_distinto', mensaje: TEXTO_YA_EXISTIA_DISTINTO });
          setAviso(TEXTO_YA_EXISTIA_DISTINTO);
        }
        return r;
      }
      if (r.ok) {
        showToast({ type: 'success', message: r.operacion.ya_existia ? 'Esto ya estaba registrado: no se repitiÃ³.' : mensajeOk });
        onListo?.(r.operacion);
        return r;
      }
      if (r.clasificacion.incierto && !previo) pendiente.current = { llamar, mensajeOk, esperado };
      if (!montado.current) return r;
      const c = r.clasificacion;
      if (c.tipo === 'no_encontrado') onNoEncontrado?.();
      else if (c.tipo === 'sin_modulo') onSinModulo?.(c.mensaje);
      else {
        // 429: el botÃ³n no manda hasta que pase el Retry-After.
        if (c.tipo === 'espera' && c.espera) esperaHasta.current = Date.now() + c.espera;
        setFalla(c);
        setAviso(c.tipo === 'espera' && c.espera ? textoEspera(c.espera) : c.mensaje);
      }
      return r;
    } finally {
      enviandoRef.current = false;
      if (montado.current) {
        setCongelado(sesion.current.incierto() || sesion.current.bloqueado());
        setSinReintento(sesion.current.bloqueado());
        setEnviando(false);
      }
      avisar(onEnviando, false);
    }
  };

  return { sesion: sesion.current, congelado, sinReintento, enviando, aviso, setAviso, falla, setFalla, enviar, montado };
}
