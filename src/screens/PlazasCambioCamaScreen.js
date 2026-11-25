import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import TextInput from '../components/FormInput';
import CustomButton from '../components/CustomButton';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import {
  TEXTO_PLAZA_OCUPADA, TEXTO_SIN_RED, cambiarPlaza, clasificarErrorPlaza, getPlazasParaCambio, intentarAccion, sectoresConLibres, validarCambioPlaza,
} from '../services/plazasAccionesApi';
import { keyboardDismissModeFor } from '../utils/teclado';
import { fontSizes, radii } from '../theme';

// Solo informa al padre: un error de su callback no corta la pantalla.
const avisar = (fn, valor) => {
  try {
    fn?.(valor);
  } catch {
    // Nada.
  }
};

// Cambio de cama (§15, mockup CambioCama.dc.html): una cama libre de `plazas-para-cambio` agrupada por
// sector, más el motivo. Confirmación antes de mandar; solo online; sin doble envío. Si la cama se ocupó en
// el medio (400 con error en `plaza_id`) se recarga la lista y se avisa. Props: `{ dispositivoId, edificioId,
// plaza?, estadia?, onListo(mapa), onCancelar() }`.
export default function PlazasCambioCamaScreen({ estadia = null, plaza = null, onListo, onCancelar, onEnviando, onCambios }) {
  const { theme, typography } = useTheme();
  const { showToast, showAlert } = useToast();
  const estadiaId = estadia?.id ?? plaza?.estadia_id ?? null;
  const persona = estadia?.persona ?? plaza?.persona ?? null;
  const codigoActual = estadia?.plaza?.codigo ?? plaza?.codigo ?? '';
  const sectorActual = estadia?.sector?.nombre ?? '';
  // Sin cama actual es una asignación: el motivo es opcional.
  const motivoOpcional = !codigoActual;
  const [sectores, setSectores] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [plazaId, setPlazaId] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [erroresServidor, setErroresServidor] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const montado = useRef(true);

  const cargar = async () => {
    try {
      const respuesta = await getPlazasParaCambio(estadiaId);
      if (!montado.current) return;
      const lista = sectoresConLibres(respuesta);
      setSectores(lista);
      setErrorCarga('');
      return lista;
    } catch (e) {
      if (montado.current) setErrorCarga(clasificarErrorPlaza(e, 'estadia').mensaje);
    }
    return null;
  };

  useEffect(() => {
    montado.current = true;
    cargar();
    return () => { montado.current = false; };
  }, [estadiaId]);

  const datos = { plaza_id: plazaId, motivo };
  const erroresCliente = intentado ? validarCambioPlaza(datos, { motivoOpcional }) : {};
  const errorDe = (campo) => [...(erroresCliente[campo] || []), ...(erroresServidor[campo] || [])];

  const enviar = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    avisar(onEnviando, true);
    setAviso('');
    try {
      const r = await intentarAccion(() => cambiarPlaza(estadiaId, datos), 'estadia');
      if (r.ok) {
        showToast({ type: 'success', message: 'Cambio de cama registrado.' });
        onListo?.(r.respuesta?.mapa ?? null);
        return;
      }
      const c = r.clasificacion;
      if (!montado.current) return;
      if (c.tipo === 'validacion' && c.plazaOcupada) {
        // La cama se ocupó mientras elegía: se recarga la lista y se elige otra.
        setPlazaId(null);
        setErroresServidor({});
        setAviso(TEXTO_PLAZA_OCUPADA);
        showToast({ type: 'warning', message: TEXTO_PLAZA_OCUPADA });
        await cargar();
      } else if (c.tipo === 'no_encontrada') {
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
      avisar(onEnviando, false);
    }
  };

  const hayCambios = plazaId !== null || motivo.trim() !== '';
  useEffect(() => { avisar(onCambios, hayCambios); }, [hayCambios]);

  const confirmar = () => {
    if (enviandoRef.current) return;
    setIntentado(true);
    setErroresServidor({});
    if (Object.keys(validarCambioPlaza(datos, { motivoOpcional })).length) return;
    const nueva = (sectores || []).flatMap((s) => s.plazas).find((p) => String(p.id) === String(plazaId));
    showAlert('Cambiar de cama', `${persona?.nombre || 'La persona'} pasa${codigoActual ? ` de la cama ${codigoActual}` : ''} a la cama ${nueva?.codigo || ''}.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Cambiar de cama', onPress: enviar },
    ]);
  };

  if (!sectores && errorCarga) {
    return (
      <View style={styles.centro}>
        <Text style={[styles.texto, { color: theme.colors.text, fontFamily: typography.medium }]}>{errorCarga}</Text>
        <CustomButton title="Reintentar" variant="secondary" onPress={cargar} />
      </View>
    );
  }
  if (!sectores) {
    return <View style={styles.centro}><ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando las camas libres" /></View>;
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <View style={tarjeta}>
        <Text accessibilityRole="header" style={[styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }]}>{persona?.nombre || 'Cambiar de cama'}</Text>
        {codigoActual ? <Text style={ayuda}>{`Hoy en la cama ${codigoActual}${sectorActual ? ` · ${sectorActual}` : ''}`}</Text> : null}
      </View>

      {errorCarga ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{errorCarga}</Text> : null}
      {aviso ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{aviso}</Text> : null}

      <View style={tarjeta}>
        <Text style={etiqueta}>Cama nueva *</Text>
        {sectores.length === 0 ? <Text style={ayuda}>No hay camas libres en esta institución.</Text> : null}
        {sectores.map((sector) => (
          <View key={sector.id} style={styles.sector}>
            <Text style={ayuda}>{`${sector.nombre} · ${sector.plazas.length} ${sector.plazas.length === 1 ? 'libre' : 'libres'}`}</Text>
            <View style={styles.opciones}>
              {sector.plazas.map((p) => {
                const activa = String(plazaId) === String(p.id);
                return (
                  <Pressable key={p.id} accessibilityRole="radio" accessibilityLabel={`Cama ${p.codigo}`} accessibilityState={{ selected: activa, disabled: enviando }}
                    disabled={enviando} onPress={() => { setPlazaId(p.id); setAviso(''); setErroresServidor((prev) => ({ ...prev, plaza_id: null })); }}
                    style={[styles.opcion, { borderColor: activa ? theme.colors.primary : theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <Text style={{ color: theme.colors.text, fontFamily: activa ? typography.semibold : typography.medium, fontSize: fontSizes.sm }}>{p.codigo}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {mensajes(errorDe('plaza_id'), 'plaza')}
        <Text style={ayuda}>Solo se muestran las camas libres de esta institución.</Text>
      </View>

      <View style={tarjeta}>
        <Text style={etiqueta}>{motivoOpcional ? 'Motivo (opcional)' : 'Motivo del cambio *'}</Text>
        <TextInput value={motivo} onChangeText={setMotivo} editable={!enviando} multiline maxLength={500} accessibilityLabel="Motivo del cambio"
          placeholderTextColor={theme.colors.textSoft} style={[...caja(errorDe('motivo').length > 0), styles.areaTexto]} />
        {mensajes(errorDe('motivo'), 'motivo')}
        {mensajes(errorDe('non_field_errors'), 'nf')}
      </View>

      <CustomButton title="Cambiar de cama" size="L" iconLeft="swap-horizontal-outline" loading={enviando} disabled={enviando} onPress={confirmar} />
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
  sector: { gap: 6 },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSizes.sm },
  areaTexto: { minHeight: 96, textAlignVertical: 'top' },
});
