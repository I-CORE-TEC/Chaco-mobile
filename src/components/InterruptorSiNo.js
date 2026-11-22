import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fontSizes } from '../theme';

// Interruptor Sí/No de la app (#1300), el equivalente del `SwitchInput` de «Nuevo caso» en el backoffice.
// Reemplaza a las casillas: apagado y prendido se distinguen por color (relleno de la pista), por posición
// (la perilla va a la izquierda o a la derecha), por la tilde dentro de la perilla y por el texto «Sí»/«No».
// Toda la fila es el área táctil (mínimo 44 px de alto) y la etiqueta también se puede tocar.
// Apagado: pista del color de la superficie con borde y perilla de `textMuted` (7,6:1 sobre blanco);
// prendido: pista de `primary` con perilla blanca (6:1).
export default function InterruptorSiNo({ titulo, valor, onChange, deshabilitado = false }) {
  const { theme, typography } = useTheme();
  const prendido = valor === true;
  const apagadoColor = theme.colors.textMuted;
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: prendido, disabled: deshabilitado }}
      accessibilityLabel={titulo} disabled={deshabilitado} onPress={() => onChange(!prendido)}
      style={[styles.fila, deshabilitado && styles.deshabilitado]}>
      <Text style={[styles.titulo, { color: theme.colors.text, fontFamily: typography.semibold }]}>{titulo}</Text>
      <Text style={[styles.estado, { color: prendido ? theme.colors.primary : apagadoColor, fontFamily: typography.bold }]}>
        {prendido ? 'Sí' : 'No'}
      </Text>
      <View style={[styles.pista, prendido
        ? { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary, justifyContent: 'flex-end' }
        : { backgroundColor: theme.colors.surface, borderColor: apagadoColor, justifyContent: 'flex-start' }]}>
        <View style={[styles.perilla, prendido
          ? { backgroundColor: '#FFFFFF' }
          : { backgroundColor: apagadoColor }]}>
          {prendido ? <Ionicons name="checkmark" size={16} color={theme.colors.primary} accessible={false} importantForAccessibility="no" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 2 },
  deshabilitado: { opacity: 0.5 },
  // minWidth 0: en web el texto largo no empuja la perilla fuera de la fila.
  titulo: { flex: 1, minWidth: 0, fontSize: fontSizes.sm },
  estado: { minWidth: 24, textAlign: 'right', fontSize: fontSizes.sm },
  pista: { width: 56, height: 32, borderRadius: 16, borderWidth: 2, padding: 2, flexDirection: 'row', alignItems: 'center' },
  perilla: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
