import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import CustomButton from '../components/CustomButton';
import { ErrorPlazas } from '../components/PlazasUi';
import { Aviso, Campo, Opciones, Tarjeta } from '../components/StockUi';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import useCargaStock from '../hooks/useCargaStock';
import useEnvioStock from '../hooks/useEnvioStock';
import {
  MOTIVOS_AJUSTE, armarAjuste, getSaldo, hayErrores, postAjuste, textoCantidad, validarAjuste,
} from '../services/stockApi';
import { keyboardDismissModeFor } from '../utils/teclado';
import { fontSizes } from '../theme';

export const SIN_INSUMOS_PARA_AJUSTAR = 'No hay insumos para ajustar en este edificio.';

// Stock · «Ajustar saldo» (§17.1 `ajustes/`): UN insumo, lo que se contó, el motivo y un detalle. Lleva `saldo_visto` (el
// saldo que se mostró al abrir): si cambió, 409 SALDO_CAMBIO → se muestra el saldo nuevo, se conserva lo cargado salvo
// la cantidad contada, que hay que volver a contar. Con conexión y sin cola; el `uuid_cliente` nace al abrir.
export default function StockAjusteScreen({ dispositivoId, edificioId, onListo, onCancelar, onNoEncontrado, onSinModulo, onEnviando, onCambios }) {
  const { theme, typography } = useTheme();
  const { showAlert } = useToast();
  const [itemId, setItemId] = useState(null);
  const [contada, setContada] = useState('');
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  // `saldo_visto` por insumo: el de al abrir y, tras un SALDO_CAMBIO, el que informó el back.
  const [vistos, setVistos] = useState({});
  const [recontar, setRecontar] = useState(false);
  const [erroresServidor, setErroresServidor] = useState({});
  const [intentado, setIntentado] = useState(false);

  const cargador = useCallback(() => getSaldo(dispositivoId, edificioId), [dispositivoId, edificioId]);
  const { datos: saldo, error: errorCarga, cargando, recargar } = useCargaStock(cargador, { onNoEncontrado, onSinModulo });

  // Los insumos con saldo (aunque estén desactivados: se puede bajar) y los activos (aunque estén en 0).
  const insumos = [];
  (saldo?.saldos || []).forEach((s) => insumos.push({ item_id: s.item_id, nombre: s.nombre, unidad: s.unidad, saldo: s.cantidad }));
  (saldo?.insumos_activos || []).forEach((i) => { if (!insumos.some((x) => String(x.item_id) === String(i.item_id))) insumos.push({ item_id: i.item_id, nombre: i.nombre, unidad: i.unidad, saldo: 0 }); });
  const elegido = insumos.find((i) => String(i.item_id) === String(itemId)) || null;
  const saldoVisto = elegido ? (vistos[elegido.item_id] ?? elegido.saldo) : null;

  const hayCambios = itemId !== null || contada.trim() !== '' || motivo !== '' || detalle.trim() !== '';
  const { enviando: enviandoPedido, congelado, sinReintento, aviso, falla, enviar } = useEnvioStock({ hayCambios, onCambios, onEnviando, onListo, onSinModulo, onNoEncontrado });

  // Tras un resultado incierto el formulario queda congelado: solo «Reintentar» (mismo cuerpo) y «Salir».
  const enviando = enviandoPedido || congelado;
  const datos = { item_id: itemId, cantidad_contada: contada, saldo_visto: saldoVisto, motivo, detalle };
  const erroresCliente = intentado ? validarAjuste(datos) : {};
  const erroresDe = (campo) => [...(erroresCliente[campo] ? [erroresCliente[campo]] : []), ...(erroresServidor[campo] || [])];

  const mandar = async () => {
    setErroresServidor({});
    const r = await enviar((uuid) => postAjuste(dispositivoId, edificioId, armarAjuste({ uuid_cliente: uuid, ...datos })), 'Ajuste registrado.',
      { item_id: itemId, saldo_posterior: Number(contada) });
    if (r.ok || !r.clasificacion) return;
    const c = r.clasificacion;
    if (c.tipo === 'saldo_cambio') {
      // El saldo nuevo pasa a ser el «visto» y se pide recontar: la cantidad contada era del saldo anterior.
      if (c.saldoActual != null) setVistos((p) => ({ ...p, [itemId]: c.saldoActual }));
      setContada('');
      setRecontar(true);
      setIntentado(false);
    } else if (c.tipo === 'validacion') setErroresServidor(c.errores || {});
  };

  const ajustar = () => {
    if (enviandoPedido || congelado) return;
    setIntentado(true);
    if (hayErrores(validarAjuste(datos))) return;
    showAlert('Ajustar saldo', `El saldo de ${elegido.nombre} pasa de ${textoCantidad(saldoVisto, elegido.unidad)} a ${textoCantidad(Number(contada), elegido.unidad)}. No se puede deshacer desde la app.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Ajustar', onPress: mandar },
    ]);
  };

  if (cargando && !saldo) return <View style={styles.centro}><ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando los insumos" /></View>;
  if (errorCarga && !saldo) return <View style={styles.centro}><ErrorPlazas mensaje={errorCarga.mensaje} onReintentar={recargar} /></View>;

  const opcionesInsumo = insumos.map((i) => ({ id: i.item_id, texto: `${i.nombre} · ${textoCantidad(vistos[i.item_id] ?? i.saldo, i.unidad)}` }));
  const conDetalle = ['OTRO', 'CORRECCION_CARGA'].includes(motivo);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <Aviso mensaje={aviso} tono={['sin_red', 'espera'].includes(falla?.tipo) ? 'warning' : 'danger'} />
      {recontar && !aviso && elegido ? (
        <Aviso mensaje={`El saldo de ${elegido.nombre} cambió: ahora hay ${textoCantidad(saldoVisto, elegido.unidad)}. Volvé a contar.`} tono="warning" icono="information-circle-outline" />
      ) : null}

      <Tarjeta titulo="¿Qué insumo contaste?" ayuda="Se ajusta de a un insumo. El saldo que figura es el del sistema.">
        {opcionesInsumo.length ? (
          <Opciones etiqueta="Insumo *" opciones={opcionesInsumo} elegida={itemId} onElegir={(id) => { setItemId(id); setRecontar(false); }} deshabilitado={enviando}
            errores={[...erroresDe('item_id')]} />
        ) : <Text style={[styles.ayuda, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{SIN_INSUMOS_PARA_AJUSTAR}</Text>}
        {elegido ? (
          <Text accessibilityLiveRegion="polite" style={[styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.semibold }]}>
            {`Saldo en el sistema: ${textoCantidad(saldoVisto, elegido.unidad)}`}
          </Text>
        ) : null}
        <Campo etiqueta="Cantidad contada *" valor={contada} onCambiar={(texto) => setContada(texto.replace(/[^\d]/g, ''))} teclado="number-pad" maxLength={7}
          deshabilitado={enviando} errores={erroresDe('cantidad_contada')} ayuda="Lo que hay de verdad. El sistema calcula la diferencia." />
      </Tarjeta>

      <Tarjeta titulo="¿Por qué?">
        <Opciones etiqueta="Motivo *" opciones={MOTIVOS_AJUSTE} elegida={motivo} onElegir={setMotivo} deshabilitado={enviando} errores={erroresDe('motivo')} />
        <Campo etiqueta={conDetalle ? 'Detalle *' : 'Detalle (opcional)'} valor={detalle} onCambiar={setDetalle} multilinea maxLength={500} deshabilitado={enviando}
          errores={[...erroresDe('detalle'), ...(erroresServidor.non_field_errors || [])]} />
      </Tarjeta>

      <CustomButton title={congelado ? 'Reintentar' : 'Ajustar saldo'} size="L" iconLeft="create-outline" loading={enviandoPedido}
        disabled={enviandoPedido || sinReintento || insumos.length === 0} onPress={congelado ? mandar : ajustar} />
      <CustomButton title={congelado ? 'Salir' : 'Cancelar'} size="L" variant="secondary" disabled={enviandoPedido} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  ayuda: { fontSize: fontSizes.xs },
});
