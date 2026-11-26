import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TextInput from './FormInput';
import { useTheme } from '../context/ThemeContext';
import { statusTones } from '../theme/statusBadges';
import { textoCantidad } from '../services/stockApi';
import { fontSizes, radii } from '../theme';

// Piezas compartidas por las pantallas de escritura de Stock (entregar, ingresar, traspasar, ajustar). Mismo
// patrón visual que Plazas: tarjetas con borde, opciones tipo radio y errores en rojo bajo el campo.

export function Tarjeta({ titulo, ayuda, children }) {
  const { theme, typography } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      {titulo ? <Text accessibilityRole="header" style={[styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }]}>{titulo}</Text> : null}
      {ayuda ? <Text style={[styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.medium }]}>{ayuda}</Text> : null}
      {children}
    </View>
  );
}

export function Mensajes({ lista = [], prefijo = 'm' }) {
  const { theme, typography } = useTheme();
  return lista.map((mensaje, i) => (
    <Text key={`${prefijo}:${i}`} accessibilityLiveRegion="polite" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.medium }]}>{mensaje}</Text>
  ));
}

// Aviso de arriba del formulario: `tono` danger | warning | info.
export function Aviso({ mensaje, tono = 'danger', icono = 'alert-circle-outline' }) {
  const { typography } = useTheme();
  if (!mensaje) return null;
  const colores = statusTones[tono] || statusTones.danger;
  return (
    <View accessibilityRole="alert" style={[styles.aviso, { backgroundColor: colores.bg, borderColor: colores.bd }]}>
      <Ionicons name={icono} size={18} color={colores.tx} accessible={false} importantForAccessibility="no" />
      <Text style={[styles.avisoTexto, { color: colores.tx, fontFamily: typography.semibold }]}>{mensaje}</Text>
    </View>
  );
}

// Campo con etiqueta visible y accessibilityLabel (el mismo texto).
export function Campo({ etiqueta, valor, onCambiar, errores = [], deshabilitado = false, multilinea = false, teclado, maxLength = 200, ayuda }) {
  const { theme, typography } = useTheme();
  return (
    <View style={styles.campo}>
      <Text style={[styles.etiqueta, { color: theme.colors.text, fontFamily: typography.semibold }]}>{etiqueta}</Text>
      <TextInput value={valor} onChangeText={onCambiar} editable={!deshabilitado} accessibilityLabel={etiqueta.replace(/\s*\*$/, '')}
        keyboardType={teclado} maxLength={maxLength} multiline={multilinea} placeholderTextColor={theme.colors.textSoft}
        style={[styles.input, multilinea && styles.areaTexto, {
          color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: errores.length ? theme.colors.danger : theme.colors.border,
        }]} />
      {ayuda ? <Text style={[styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.medium }]}>{ayuda}</Text> : null}
      <Mensajes lista={errores} prefijo={etiqueta} />
    </View>
  );
}

// Opciones tipo radio: `opciones` = [{ id, texto }]. `accessibilityState` lleva selected Y checked.
export function Opciones({ etiqueta, opciones, elegida, onElegir, deshabilitado = false, errores = [] }) {
  const { theme, typography } = useTheme();
  return (
    <View style={styles.campo}>
      <Text style={[styles.etiqueta, { color: theme.colors.text, fontFamily: typography.semibold }]}>{etiqueta}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={etiqueta.replace(/\s*\*$/, '')} style={styles.opciones}>
        {opciones.map((opcion) => {
          const activa = String(elegida) === String(opcion.id);
          return (
            <Pressable key={String(opcion.id)} accessibilityRole="radio" accessibilityLabel={`${etiqueta.replace(/\s*\*$/, '')}: ${opcion.texto}`}
              accessibilityState={{ selected: activa, checked: activa, disabled: deshabilitado }} disabled={deshabilitado} onPress={() => onElegir(opcion.id)}
              style={[styles.opcion, { borderColor: activa ? theme.colors.primary : theme.colors.border,
                backgroundColor: activa ? theme.colors.primarySoft || theme.colors.surface : theme.colors.surface }]}>
              <Text style={{ color: theme.colors.text, fontFamily: activa ? typography.semibold : typography.medium, fontSize: fontSizes.sm }}>{opcion.texto}</Text>
            </Pressable>
          );
        })}
      </View>
      <Mensajes lista={errores} prefijo={etiqueta} />
    </View>
  );
}

// Tabla de cantidades por insumo con su saldo. `insumos` = [{ item_id, nombre, unidad, saldo, activo }];
// `valores` = { [item_id]: texto }; `errores` = { [item_id]: msg }; `rechazos` = { [item_id]: { cantidad, alcanza } }
// (los saldos de ahora que devolvió un 409 SALDO_INSUFICIENTE).
export function TablaCantidades({ insumos, valores, onCambiar, errores = {}, rechazos = {}, deshabilitado = false, vacio }) {
  const { theme, typography } = useTheme();
  if (!insumos.length) return <Text style={[styles.ayuda, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{vacio}</Text>;
  return insumos.map((insumo) => {
    const rechazo = rechazos[insumo.item_id];
    const saldo = rechazo ? rechazo.cantidad : insumo.saldo;
    const mensaje = errores[insumo.item_id];
    const sinAlcance = rechazo && rechazo.alcanza === false;
    const tono = statusTones.warning;
    return (
      <View key={String(insumo.item_id)} style={[styles.fila, { borderColor: theme.colors.border }]}>
        <View style={styles.flex}>
          <Text style={[styles.nombre, { color: theme.colors.text, fontFamily: typography.semibold }]}>{insumo.nombre}</Text>
          {saldo != null ? (
            <Text style={[styles.ayuda, { color: sinAlcance ? theme.colors.danger : theme.colors.textMuted, fontFamily: typography.medium }]}>
              {`${rechazo ? 'Ahora hay' : 'Saldo'}: ${textoCantidad(saldo, insumo.unidad)}`}
            </Text>
          ) : null}
          {insumo.activo === false ? (
            <View style={[styles.insignia, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
              <Text style={[styles.insigniaTexto, { color: tono.tx, fontFamily: typography.bold }]}>Desactivado</Text>
            </View>
          ) : null}
          {mensaje ? <Mensajes lista={[mensaje]} prefijo={`c${insumo.item_id}`} /> : null}
        </View>
        <TextInput value={String(valores[insumo.item_id] ?? '')} onChangeText={(texto) => onCambiar(insumo.item_id, texto.replace(/[^\d]/g, ''))}
          editable={!deshabilitado} keyboardType="number-pad" maxLength={7} placeholder="0" placeholderTextColor={theme.colors.textSoft}
          accessibilityLabel={`Cantidad de ${insumo.nombre}${insumo.unidad ? ` (${insumo.unidad})` : ''}`}
          style={[styles.cantidad, { color: theme.colors.text, backgroundColor: theme.colors.surface,
            borderColor: mensaje || sinAlcance ? theme.colors.danger : theme.colors.border, fontFamily: typography.bold }]} />
      </View>
    );
  });
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 8 },
  titulo: { fontSize: fontSizes.base },
  etiqueta: { fontSize: fontSizes.sm },
  ayuda: { fontSize: fontSizes.xs },
  error: { fontSize: fontSizes.xs },
  nombre: { fontSize: fontSizes.sm },
  flex: { flex: 1, gap: 2 },
  campo: { gap: 6 },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radii.lg, padding: 10 },
  avisoTexto: { flex: 1, fontSize: fontSizes.sm },
  input: { minHeight: 46, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSizes.sm },
  areaTexto: { minHeight: 80, textAlignVertical: 'top' },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 8 },
  cantidad: { width: 84, minHeight: 46, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 10, textAlign: 'center', fontSize: fontSizes.base },
  insignia: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 3 },
  insigniaTexto: { fontSize: fontSizes.xs },
});
