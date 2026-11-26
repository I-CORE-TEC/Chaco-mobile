import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import CustomButton from '../components/CustomButton';
import { ErrorPlazas } from '../components/PlazasUi';
import { Aviso, Campo, Mensajes, Opciones, TablaCantidades, Tarjeta } from '../components/StockUi';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import useCargaStock from '../hooks/useCargaStock';
import useEnvioStock from '../hooks/useEnvioStock';
import {
  armarLineas, armarTraspaso, getDestinosTraspaso, getSaldo, hayErrores, postTraspaso, validarTraspaso,
} from '../services/stockApi';
import { keyboardDismissModeFor } from '../utils/teclado';

export const SIN_DESTINOS = 'No hay otro edificio al que puedas traspasar desde acá.';
export const SIN_INSUMOS_PARA_TRASPASAR = 'Este edificio no tiene insumos con saldo para traspasar.';
const idDestino = (d) => `${d.dispositivo.id}:${d.edificio.id}`;

// Stock · «Traspasar» (§17.1 `traspasos/`): pasa insumos de este edificio a otro de `destinos-traspaso/`. Inmediato (el
// destino no confirma). Con conexión y sin cola; el `uuid_cliente` nace al abrir y se conserva en los reintentos.
export default function StockTraspasoScreen({ dispositivoId, edificioId, onListo, onCancelar, onNoEncontrado, onSinModulo, onEnviando, onCambios }) {
  const { theme } = useTheme();
  const { showAlert } = useToast();
  const [destinoId, setDestinoId] = useState('');
  const [observacion, setObservacion] = useState('');
  const [cantidades, setCantidades] = useState({});
  const [rechazos, setRechazos] = useState({});
  const [erroresServidor, setErroresServidor] = useState({});
  const [intentado, setIntentado] = useState(false);

  const cargadorSaldo = useCallback(() => getSaldo(dispositivoId, edificioId), [dispositivoId, edificioId]);
  const cargadorDestinos = useCallback(() => getDestinosTraspaso(dispositivoId, edificioId), [dispositivoId, edificioId]);
  const salida = { onNoEncontrado, onSinModulo };
  const { datos: saldo, error: errorSaldo, cargando: cargandoSaldo, recargar: recargarSaldo } = useCargaStock(cargadorSaldo, salida);
  const { datos: destinos, error: errorDestinos, cargando: cargandoDestinos, recargar: recargarDestinos } = useCargaStock(cargadorDestinos, salida);
  const insumos = (saldo?.saldos || []).filter((s) => s.cantidad > 0).map((s) => ({ item_id: s.item_id, nombre: s.nombre, unidad: s.unidad, saldo: s.cantidad, activo: s.activo }));
  const destino = (destinos || []).find((d) => idDestino(d) === destinoId) || null;

  const hayCambios = destinoId !== '' || observacion.trim() !== '' || Object.values(cantidades).some((c) => String(c).trim() !== '');
  const { enviando: enviandoPedido, congelado, sinReintento, aviso, falla, enviar } = useEnvioStock({ hayCambios, onCambios, onEnviando, onListo, onSinModulo, onNoEncontrado });

  // Tras un resultado incierto el formulario queda congelado: solo «Reintentar» (mismo cuerpo) y «Salir».
  const enviando = enviandoPedido || congelado;
  const datos = { cantidades, insumos, destino };
  const erroresCliente = intentado ? validarTraspaso(datos) : {};
  const erroresDestino = [...(erroresCliente.destino ? [erroresCliente.destino] : []), ...(erroresServidor.destino || []), ...(erroresServidor.destino_dispositivo_id || []),
    ...(erroresServidor.destino_edificio_id || [])];

  const mandar = async () => {
    setErroresServidor({});
    setRechazos({});
    const lineas = armarLineas(cantidades, insumos);
    const r = await enviar((uuid) => postTraspaso(dispositivoId, edificioId, armarTraspaso({
      uuid_cliente: uuid, destino_dispositivo_id: destino.dispositivo.id, destino_edificio_id: destino.edificio.id,
      lineas, observacion,
    })), 'Traspaso registrado.', { lineas });
    if (r.ok || !r.clasificacion) return;
    const c = r.clasificacion;
    if (c.tipo === 'saldo_insuficiente') setRechazos(Object.fromEntries(c.saldos.map((s) => [s.item_id, s])));
    else if (c.tipo === 'validacion') setErroresServidor(c.errores || {});
  };

  const traspasar = () => {
    if (enviandoPedido || congelado) return;
    setIntentado(true);
    if (hayErrores(validarTraspaso(datos))) return;
    const lineas = armarLineas(cantidades, insumos);
    showAlert('Traspasar insumos', `Se pasan ${lineas.length} ${lineas.length === 1 ? 'insumo' : 'insumos'} a ${destino.edificio.nombre || destino.dispositivo.nombre}. Es inmediato: el destino no confirma, y no se puede deshacer desde la app.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Traspasar', onPress: mandar },
    ]);
  };

  if ((cargandoSaldo && !saldo) || (cargandoDestinos && !destinos)) {
    return <View style={styles.centro}><ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando el traspaso" /></View>;
  }
  const errorCarga = (!saldo && errorSaldo) || (!destinos && errorDestinos);
  if (errorCarga) {
    return <View style={styles.centro}><ErrorPlazas mensaje={errorCarga.mensaje} onReintentar={() => { recargarSaldo(); recargarDestinos(); }} /></View>;
  }

  const opcionesDestino = (destinos || []).map((d) => ({ id: idDestino(d), texto: [d.edificio.nombre, d.dispositivo.nombre].filter(Boolean).join(' · ') }));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <Aviso mensaje={aviso} tono={['sin_red', 'espera'].includes(falla?.tipo) ? 'warning' : 'danger'} />

      <Tarjeta titulo="¿A dónde?">
        {opcionesDestino.length ? (
          <Opciones etiqueta="Edificio de destino *" opciones={opcionesDestino} elegida={destinoId} onElegir={setDestinoId} deshabilitado={enviando} errores={erroresDestino} />
        ) : <Aviso mensaje={SIN_DESTINOS} tono="warning" icono="information-circle-outline" />}
      </Tarjeta>

      <Tarjeta titulo="¿Qué se traspasa?" ayuda="Cargá la cantidad de cada insumo. Lo que dejes en blanco no se pasa.">
        <TablaCantidades insumos={insumos} valores={cantidades} onCambiar={(id, valor) => setCantidades((p) => ({ ...p, [id]: valor }))}
          errores={erroresCliente.cantidades || {}} rechazos={rechazos} deshabilitado={enviando} vacio={SIN_INSUMOS_PARA_TRASPASAR} />
        <Mensajes lista={[...(erroresCliente.lineas ? [erroresCliente.lineas] : []), ...(erroresServidor.lineas || []), ...(erroresServidor.item_id || []),
          ...(erroresServidor.non_field_errors || [])]} prefijo="lineas" />
      </Tarjeta>

      <Tarjeta>
        <Campo etiqueta="Observación (opcional)" valor={observacion} onCambiar={setObservacion} multilinea maxLength={500} deshabilitado={enviando}
          errores={erroresServidor.observacion || []} />
      </Tarjeta>

      <CustomButton title={congelado ? 'Reintentar' : 'Traspasar'} size="L" iconLeft="swap-horizontal-outline" loading={enviandoPedido}
        disabled={enviandoPedido || sinReintento || insumos.length === 0 || opcionesDestino.length === 0} onPress={congelado ? mandar : traspasar} />
      <CustomButton title={congelado ? 'Salir' : 'Cancelar'} size="L" variant="secondary" disabled={enviandoPedido} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});
