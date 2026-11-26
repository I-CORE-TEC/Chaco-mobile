import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import CustomButton from '../components/CustomButton';
import { ErrorPlazas } from '../components/PlazasUi';
import { Aviso, Campo, Mensajes, Opciones, TablaCantidades, Tarjeta } from '../components/StockUi';
import { useTheme } from '../context/ThemeContext';
import useCargaStock from '../hooks/useCargaStock';
import useEnvioStock from '../hooks/useEnvioStock';
import {
  ORIGENES_INGRESO, ORIGEN_CON_DETALLE, armarIngreso, armarLineas, getSaldo, hayErrores, postIngreso, validarIngreso,
} from '../services/stockApi';
import { keyboardDismissModeFor } from '../utils/teclado';

export const SIN_INSUMOS_ACTIVOS = 'No hay insumos activos para cargar. Pedí que los den de alta en el backoffice.';

// Stock · «Ingresar stock» (§17.1 `ingresos/`): suma al edificio lo que llegó a mano (donación, compra…), con su origen y
// un comprobante opcional. Solo insumos activos. Con conexión y sin cola; el `uuid_cliente` nace al abrir y se conserva.
export default function StockIngresoScreen({ dispositivoId, edificioId, onListo, onCancelar, onNoEncontrado, onSinModulo, onEnviando, onCambios }) {
  const { theme } = useTheme();
  const [origen, setOrigen] = useState('');
  const [origenDetalle, setOrigenDetalle] = useState('');
  const [comprobante, setComprobante] = useState('');
  const [cantidades, setCantidades] = useState({});
  const [erroresServidor, setErroresServidor] = useState({});
  const [intentado, setIntentado] = useState(false);

  const cargador = useCallback(() => getSaldo(dispositivoId, edificioId), [dispositivoId, edificioId]);
  const { datos: saldo, error: errorCarga, cargando, recargar } = useCargaStock(cargador, { onNoEncontrado, onSinModulo });
  const saldos = Object.fromEntries((saldo?.saldos || []).map((s) => [s.item_id, s.cantidad]));
  const insumos = (saldo?.insumos_activos || []).map((i) => ({ item_id: i.item_id, nombre: i.nombre, unidad: i.unidad, saldo: saldos[i.item_id] ?? 0, activo: true }));

  const hayCambios = origen !== '' || comprobante.trim() !== '' || Object.values(cantidades).some((c) => String(c).trim() !== '');
  const { enviando, aviso, falla, enviar } = useEnvioStock({ hayCambios, onCambios, onEnviando, onListo, onSinModulo, onNoEncontrado });

  const datos = { cantidades, insumos, origen, origen_detalle: origenDetalle };
  const erroresCliente = intentado ? validarIngreso(datos) : {};
  const erroresDe = (campo) => [...(erroresCliente[campo] ? [erroresCliente[campo]] : []), ...(erroresServidor[campo] || [])];

  const registrar = async () => {
    if (enviando) return;
    setIntentado(true);
    setErroresServidor({});
    if (hayErrores(validarIngreso(datos))) return;
    const r = await enviar((uuid) => postIngreso(dispositivoId, edificioId, armarIngreso({
      uuid_cliente: uuid, lineas: armarLineas(cantidades, insumos), origen, origen_detalle: origenDetalle, comprobante,
    })), 'Ingreso registrado.');
    if (!r.ok && r.clasificacion?.tipo === 'validacion') setErroresServidor(r.clasificacion.errores || {});
  };

  if (cargando && !saldo) return <View style={styles.centro}><ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando los insumos" /></View>;
  if (errorCarga && !saldo) return <View style={styles.centro}><ErrorPlazas mensaje={errorCarga.mensaje} onReintentar={recargar} /></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <Aviso mensaje={aviso} tono={['sin_red', 'espera'].includes(falla?.tipo) ? 'warning' : 'danger'} />

      <Tarjeta titulo="¿De dónde viene?">
        <Opciones etiqueta="Origen *" opciones={ORIGENES_INGRESO} elegida={origen} onElegir={setOrigen} deshabilitado={enviando} errores={erroresDe('origen')} />
        {origen === ORIGEN_CON_DETALLE ? (
          <Campo etiqueta="Detalle del origen *" valor={origenDetalle} onCambiar={setOrigenDetalle} deshabilitado={enviando} errores={erroresDe('origen_detalle')} />
        ) : null}
        <Campo etiqueta="Comprobante (opcional)" valor={comprobante} onCambiar={setComprobante} deshabilitado={enviando} errores={erroresDe('comprobante')}
          ayuda="Número de remito, factura o acta, si lo hay." />
      </Tarjeta>

      <Tarjeta titulo="¿Qué ingresó?" ayuda="Cargá la cantidad de cada insumo. Lo que dejes en blanco no se suma.">
        <TablaCantidades insumos={insumos} valores={cantidades} onCambiar={(id, valor) => setCantidades((p) => ({ ...p, [id]: valor }))}
          errores={erroresCliente.cantidades || {}} deshabilitado={enviando} vacio={SIN_INSUMOS_ACTIVOS} />
        <Mensajes lista={[...(erroresCliente.lineas ? [erroresCliente.lineas] : []), ...(erroresServidor.lineas || []), ...(erroresServidor.item_id || []),
          ...(erroresServidor.non_field_errors || [])]} prefijo="lineas" />
      </Tarjeta>

      <CustomButton title="Registrar ingreso" size="L" iconLeft="add-circle-outline" loading={enviando} disabled={enviando || insumos.length === 0} onPress={registrar} />
      <CustomButton title="Cancelar" size="L" variant="secondary" disabled={enviando} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});
