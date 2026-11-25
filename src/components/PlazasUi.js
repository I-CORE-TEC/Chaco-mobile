import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import CustomButton from './CustomButton';
import { statusTones } from '../theme/statusBadges';
import { fontSizes, radii } from '../theme';

// Piezas compartidas por las pantallas de Plazas y estadías (edificios, mapa, estadías).

// Conmutador «Camas | Estadías» del mapa.
export function ConmutadorPlazas({ activo, textoEstadias, onCamas, onEstadias }) {
  const { theme, typography } = useTheme();
  const opcion = (id, titulo, alPresionar) => {
    const seleccionada = activo === id;
    return (
      <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: seleccionada }} accessibilityLabel={titulo}
        onPress={seleccionada ? undefined : alPresionar}
        style={[styles.opcion, seleccionada && { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.opcionTexto, { color: seleccionada ? theme.colors.text : theme.colors.textMuted,
          fontFamily: seleccionada ? typography.bold : typography.semibold }]}>{titulo}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" style={[styles.conmutador, { backgroundColor: theme.colors.border }]}>
      {opcion('camas', 'Camas', onCamas)}
      {opcion('estadias', textoEstadias || 'Estadías', onEstadias)}
    </View>
  );
}

// Cuadradito del resumen: número grande y el nombre del estado debajo.
export function ChipResumen({ chip }) {
  const { typography } = useTheme();
  const tono = statusTones[chip.tono] || statusTones.gray;
  return (
    <View accessible accessibilityLabel={chip.texto}
      style={[styles.chip, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
      <Text style={[styles.chipNumero, { color: tono.tx, fontFamily: typography.bold }]}>{chip.cantidad}</Text>
      <Text numberOfLines={1} style={[styles.chipTexto, { color: tono.tx, fontFamily: typography.semibold }]}>{chip.abrev}</Text>
    </View>
  );
}

// Aviso de error con «Reintentar». Con `sinRed` el texto es el de «necesitás conexión».
export function ErrorPlazas({ mensaje, onReintentar, tono = 'danger' }) {
  const { typography } = useTheme();
  const colores = statusTones[tono];
  return (
    <View style={styles.errorCaja}>
      <View accessibilityRole="alert" style={[styles.aviso, { backgroundColor: colores.bg, borderColor: colores.bd }]}>
        <Ionicons name="cloud-offline-outline" size={18} color={colores.tx} accessible={false} importantForAccessibility="no" />
        <Text style={[styles.avisoTexto, { color: colores.tx, fontFamily: typography.semibold }]}>{mensaje}</Text>
      </View>
      {onReintentar ? <CustomButton title="Reintentar" variant="secondary" iconLeft="refresh" onPress={onReintentar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  conmutador: { flexDirection: 'row', borderRadius: radii.lg, padding: 4 },
  opcion: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radii.md },
  opcionTexto: { fontSize: fontSizes.sm },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: radii.lg, paddingVertical: 6 },
  chipNumero: { fontSize: fontSizes.lg },
  chipTexto: { fontSize: fontSizes.xs },
  errorCaja: { gap: 10 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radii.lg, padding: 10 },
  avisoTexto: { flex: 1, fontSize: fontSizes.sm },
});
