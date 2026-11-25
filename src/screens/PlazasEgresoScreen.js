import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import TextInput from '../components/FormInput';
import CustomButton from '../components/CustomButton';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import {
  TEXTO_SIN_RED, clasificarErrorPlaza, egresarEstadia, getMotivosEgreso, intentarAccion, validarEgreso,
} from '../services/plazasAccionesApi';
import { keyboardDismissModeFor } from '../utils/teclado';
import { fontSizes, radii } from '../theme';

// Egreso por persona (§15, mockup Egreso.dc.html): motivo del catálogo, destino, ¿devolvieron las
// pertenencias?, observaciones. Pide confirmación antes de mandar, solo con conexión (no hay cola) y no
// deja mandar dos veces. Props: `{ dispositivoId, edificioId, plaza?, estadia?, onListo(mapa), onCancelar() }`;
// la estadía sale de `estadia.id` o, si viene la cama, de `plaza.estadia_id`.
export default function PlazasEgresoScreen({ estadia = null, plaza = null, onListo, onCancelar }) {
  const { theme, typography } = useTheme();
  const { showToast, showAlert } = useToast();
  const estadiaId = estadia?.id ?? plaza?.estadia_id ?? null;
  const persona = estadia?.persona ?? plaza?.persona ?? null;
  const codigo = estadia?.plaza?.codigo ?? plaza?.codigo ?? '';
  const [motivos, setMotivos] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [motivoId, setMotivoId] = useState(null);
  const [destino, setDestino] = useState('');
  const [pertenencias, setPertenencias] = useState(null);
  const [observaciones, setObservaciones] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [erroresServidor, setErroresServidor] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const montado = useRef(true);

  const cargarMotivos = async () => {
    try {
      const lista = await getMotivosEgreso();
      if (!montado.current) return;
      setMotivos(Array.isArray(lista) ? lista.filter((m) => m?.id != null) : []);
      setErrorCarga('');
    } catch (e) {
      if (montado.current) setErrorCarga(clasificarErrorPlaza(e, 'estadia').mensaje);
    }
  };

  useEffect(() => {
    montado.current = true;
    cargarMotivos();
    return () => { montado.current = false; };
  }, []);

  const datos = { motivo_egreso_id: motivoId, destino, pertenencias_devueltas: pertenencias === true, observaciones };
  const erroresCliente = intentado ? validarEgreso(datos) : {};
  const errorDe = (campo) => [...(erroresCliente[campo] || []), ...(erroresServidor[campo] || [])];

  const enviar = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setAviso('');
    try {
      const r = await intentarAccion(() => egresarEstadia(estadiaId, datos), 'estadia');
      if (r.ok) {
        showToast({ type: 'success', message: 'Egreso registrado.' });
        onListo?.(r.respuesta?.mapa ?? null);
        return;
      }
      const c = r.clasificacion;
      if (!montado.current) return;
      if (c.tipo === 'no_encontrada') {
        showAlert('Estadía no disponible', c.mensaje, [{ text: 'Entendido', onPress: () => onCancelar?.() }]);
      } else if (c.tipo === 'sin_red') {
        showAlert('Sin conexión', TEXTO_SIN_RED, [{ text: 'Entendido' }]);
      } else if (c.tipo === 'validacion') {
        setErroresServidor(c.errores || {});
        setAviso(c.mensaje);
      } else {
        setAviso(c.mensaje);
      }
    } finally {
      enviandoRef.current = false;
      if (montado.current) setEnviando(false);
    }
  };

  const registrar = () => {
    if (enviandoRef.current) return;
    setIntentado(true);
    setErroresServidor({});
    if (Object.keys(validarEgreso(datos)).length) return;
    const nombre = persona?.nombre || 'la persona';
    showAlert('Registrar egreso', `Se registra el egreso de ${nombre}${codigo ? ` y la cama ${codigo} queda libre` : ''}. No se puede deshacer desde la app.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Registrar egreso', onPress: enviar },
    ]);
  };

  if (errorCarga && !motivos) {
    return (
      <View style={styles.centro}>
        <Text style={[styles.texto, { color: theme.colors.text, fontFamily: typography.medium }]}>{errorCarga}</Text>
        <CustomButton title="Reintentar" variant="secondary" onPress={cargarMotivos} />
      </View>
    );
  }
  if (!motivos) {
    return <View style={styles.centro}><ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando los motivos" /></View>;
  }

  const tarjeta = [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }];
  const etiqueta = [styles.etiqueta, { color: theme.colors.text, fontFamily: typography.semibold }];
  const ayuda = [styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.medium }];
  const caja = (conError) => [styles.input, {
    color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: conError ? theme.colors.danger : theme.colors.border,
  }];
  const mensajes = (lista, prefijo) => lista.map((m, i) => (
    <Text key={`${prefijo}:${i}`} accessibilityLiveRegion="polite" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.medium }]}>{m}</Text>
  ));
  const opcion = (activa, titulo, onPress, etiquetaA11y) => (
    <Pressable key={etiquetaA11y} accessibilityRole="radio" accessibilityLabel={etiquetaA11y} accessibilityState={{ selected: activa, disabled: enviando }}
      disabled={enviando} onPress={onPress}
      style={[styles.opcion, { borderColor: activa ? theme.colors.primary : theme.colors.border, backgroundColor: activa ? theme.colors.primarySoft || theme.colors.surface : theme.colors.surface }]}>
      <Text style={{ color: theme.colors.text, fontFamily: activa ? typography.semibold : typography.medium, fontSize: fontSizes.sm }}>{titulo}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <View style={tarjeta}>
        <Text accessibilityRole="header" style={[styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }]}>{persona?.nombre || 'Registrar egreso'}</Text>
        {codigo ? <Text style={ayuda}>{`Cama ${codigo}${estadia?.sector?.nombre ? ` · ${estadia.sector.nombre}` : ''}`}</Text> : null}
      </View>

      {aviso ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{aviso}</Text> : null}

      <View style={tarjeta}>
        <Text style={etiqueta}>Motivo del egreso *</Text>
        <View style={styles.opciones}>
          {motivos.map((m) => opcion(String(motivoId) === String(m.id), m.nombre, () => { setMotivoId(m.id); setErroresServidor((p) => ({ ...p, motivo: null })); }, `Motivo: ${m.nombre}`))}
        </View>
        {mensajes(errorDe('motivo'), 'motivo')}
        <Text style={ayuda}>Las opciones salen del catálogo de motivos del backoffice.</Text>
      </View>

      <View style={tarjeta}>
        <Text style={etiqueta}>Destino *</Text>
        <TextInput value={destino} onChangeText={setDestino} editable={!enviando} accessibilityLabel="Destino" maxLength={200}
          placeholderTextColor={theme.colors.textSoft} style={caja(errorDe('destino').length > 0)} />
        {mensajes(errorDe('destino'), 'destino')}
      </View>

      <View style={tarjeta}>
        <Text style={etiqueta}>¿Se le devolvieron sus pertenencias?</Text>
        <View style={styles.opciones}>
          {opcion(pertenencias === true, 'Sí', () => setPertenencias(true), 'Pertenencias devueltas: Sí')}
          {opcion(pertenencias === false, 'No', () => setPertenencias(false), 'Pertenencias devueltas: No')}
        </View>
        {mensajes(errorDe('pertenencias_devueltas'), 'pert')}
      </View>

      <View style={tarjeta}>
        <Text style={etiqueta}>Observaciones</Text>
        <TextInput value={observaciones} onChangeText={setObservaciones} editable={!enviando} multiline maxLength={1000}
          accessibilityLabel="Observaciones" placeholderTextColor={theme.colors.textSoft} style={[...caja(errorDe('observaciones').length > 0), styles.areaTexto]} />
        {mensajes(errorDe('observaciones'), 'obs')}
        {mensajes(errorDe('estado'), 'estado')}
        {mensajes(errorDe('fecha_egreso'), 'fecha')}
        {mensajes(errorDe('non_field_errors'), 'nf')}
      </View>

      <CustomButton title="Registrar egreso" size="L" iconLeft="log-out-outline" loading={enviando} disabled={enviando} onPress={registrar} />
      <CustomButton title="Cancelar" size="L" variant="secondary" disabled={enviando} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 8 },
  titulo: { fontSize: fontSizes.base },
  etiqueta: { fontSize: fontSizes.sm },
  ayuda: { fontSize: fontSizes.xs },
  texto: { fontSize: fontSizes.sm },
  error: { fontSize: fontSizes.xs },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSizes.sm },
  areaTexto: { minHeight: 96, textAlignVertical: 'top' },
});
