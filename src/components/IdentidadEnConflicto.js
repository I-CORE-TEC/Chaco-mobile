import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CustomButton from './CustomButton';
import { useTheme } from '../context/ThemeContext';
import { statusTones } from '../theme/statusBadges';
import { fontSizes, radii } from '../theme';

export const TEXTO_PERSONA_REGISTRADA = (persona) => {
  const quien = [persona?.apellido, persona?.nombre].filter(Boolean).join(', ');
  return `Ese DNI ya está registrado${quien ? ` como ${quien}` : ' con otra persona'}. ¿Es esa persona?`;
};

// El 400 `persona_registrada` (Cambio 486) como pregunta con salida: «Es esa persona» (se manda solo el DNI),
// «Es otra persona» (el DNI es correcto: queda a revisar) y, donde el DNI se puede cambiar, «Corregir el DNI».
// `onCancelar` cierra la pregunta sin responder (en la puerta el DNI es el buscado: no se corrige).
export default function IdentidadEnConflicto({ persona, onMisma, onOtra, onCorregir, onCancelar, deshabilitado = false }) {
  const { typography } = useTheme();
  const tono = statusTones.warning;
  return (
    <View accessibilityRole="alert" style={[styles.caja, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
      <View style={styles.cabecera}>
        <Ionicons name="alert-circle-outline" size={18} color={tono.tx} accessible={false} importantForAccessibility="no" />
        <Text style={[styles.texto, { color: tono.tx, fontFamily: typography.semibold }]}>{TEXTO_PERSONA_REGISTRADA(persona)}</Text>
      </View>
      <CustomButton title="Es esa persona" iconLeft="checkmark-circle-outline" disabled={deshabilitado} onPress={onMisma} />
      <CustomButton title="Es otra persona" variant="secondary" iconLeft="person-add-outline" disabled={deshabilitado} onPress={onOtra} />
      {onCorregir ? <CustomButton title="Corregir el DNI" variant="secondary" iconLeft="create-outline" disabled={deshabilitado} onPress={onCorregir} /> : null}
      {onCancelar ? <CustomButton title="Cancelar" variant="secondary" disabled={deshabilitado} onPress={onCancelar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { borderWidth: 1, borderRadius: radii.md, padding: 12, gap: 8 },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  texto: { flex: 1, fontSize: fontSizes.sm, lineHeight: 20 },
});
