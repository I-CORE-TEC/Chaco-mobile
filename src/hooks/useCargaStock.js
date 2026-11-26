import { useCallback, useEffect, useRef, useState } from 'react';
import { clasificarError } from '../services/stockApi';

// Trae lo que necesita una pantalla de escritura al abrirse (saldo, destinos…): `cargador()` devuelve la promesa.
// 404 y 403 SIN_MODULO salen de la pantalla; el resto queda en `error` con «Reintentar» (`recargar`).
export default function useCargaStock(cargador, { onNoEncontrado, onSinModulo } = {}) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const montado = useRef(true);
  const pedido = useRef(0);

  const recargar = useCallback(async () => {
    const numero = pedido.current + 1;
    pedido.current = numero;
    setCargando(true);
    try {
      const resultado = await cargador();
      if (!montado.current || pedido.current !== numero) return;
      setDatos(resultado);
      setError(null);
    } catch (e) {
      if (!montado.current || pedido.current !== numero) return;
      const c = clasificarError(e);
      if (c.tipo === 'no_encontrado') onNoEncontrado?.();
      else if (c.tipo === 'sin_modulo') onSinModulo?.(c.mensaje);
      else setError(c);
    } finally {
      if (montado.current && pedido.current === numero) setCargando(false);
    }
  }, [cargador, onNoEncontrado, onSinModulo]);

  useEffect(() => {
    montado.current = true;
    recargar();
    return () => { montado.current = false; };
  }, []);

  return { datos, setDatos, error, cargando, recargar };
}
