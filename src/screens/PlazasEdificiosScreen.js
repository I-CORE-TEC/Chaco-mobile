import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { ErrorPlazas } from '../components/PlazasUi';
import { chipsDeResumen, clasificarError, getEdificios, TEXTO_SIN_EDIFICIOS } from '../services/plazasApi';
import { statusTones } from '../theme/statusBadges';
import { fontSizes, radii } from '../theme';

// Plazas · lista de edificios del usuario (GET edificios/). Aunque haya uno solo se muestra la lista.
// `onElegir(item)` abre el mapa del edificio ({ dispositivo, edificio, resumen }); un 403 SIN_MODULO
// llama a `onSinModulo(mensaje)`. `recarga` cambia cuando hay que volver a pedir la lista.
export default function PlazasEdificiosScreen({ onElegir, onSinModulo, recarga = 0 }) {
  const { theme, typography } = useTheme();
  const [edificios, setEdificios] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const recargaInicial = useRef(recarga);

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (silencioso) setRefrescando(true);
    try {
      const lista = await getEdificios();
      if (!montado.current) return;
      setEdificios(lista);
      setError(null);
    } catch (e) {
      if (!montado.current) return;
      const clasificado = clasificarError(e);
      if (clasificado.tipo === 'sin_modulo') {
        onSinModulo?.(clasificado.mensaje);
        return;
      }
      setError(clasificado);
    } finally {
      if (montado.current) {
        setCargando(false);
        setRefrescando(false);
      }
    }
  }, [onSinModulo]);

  useEffect(() => {
    montado.current = true;
    cargar();
    return () => { montado.current = false; };
  }, []);
  useEffect(() => { if (recarga !== recargaInicial.current) cargar({ silencioso: true }); }, [recarga]);

  const tarjeta = (item) => {
    const chips = chipsDeResumen(item.resumen);
    const titulo = item.edificio.nombre || item.dispositivo.nombre;
    const subtitulo = item.edificio.nombre ? item.dispositivo.nombre : item.edificio.direccion;
    return (
      <Pressable key={`${item.dispositivo.id}-${item.edificio.id}`} accessibilityRole="button"
        accessibilityLabel={`${titulo}. ${subtitulo}. ${chips.map((chip) => chip.texto).join(', ')}`}
        onPress={() => onElegir?.(item)}
        style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, pressed && styles.presionada]}>
        <View style={styles.fila}>
          <Ionicons name="business-outline" size={24} color={theme.colors.primary} accessible={false} importantForAccessibility="no" />
          <View style={styles.flex}>
            <Text style={[styles.nombre, { color: theme.colors.text, fontFamily: typography.bold }]}>{titulo}</Text>
            {subtitulo ? <Text style={[styles.sub, { color: theme.colors.textMuted, fontFamily: typography.medium }]}>{subtitulo}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textSoft} accessible={false} importantForAccessibility="no" />
        </View>
        <View style={styles.chips}>
          {chips.length ? chips.map((chip) => {
            const tono = statusTones[chip.tono];
            return (
              <View key={chip.clave} style={[styles.insignia, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
                <Text style={[styles.insigniaTexto, { color: tono.tx, fontFamily: typography.bold }]}>{chip.texto}</Text>
              </View>
            );
          }) : (
            <Text style={[styles.sub, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>Sin camas cargadas</Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar({ silencioso: true })}
        colors={[theme.colors.primary]} tintColor={theme.colors.primary} />}>
      <Text accessibilityRole="header" style={[styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }]}>Plazas y estadías</Text>
      {!error && edificios?.length ? (
        <Text style={[styles.sub, { color: theme.colors.textMuted, fontFamily: typography.medium }]}>Elegí el edificio que vas a gestionar.</Text>
      ) : null}
      {refrescando && Platform.OS === 'web' ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Actualizando los edificios" /> : null}
      {cargando ? <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando los edificios" /> : null}
      {error ? <ErrorPlazas mensaje={error.mensaje} tono={error.tipo === 'sin_red' ? 'warning' : 'danger'}
        onReintentar={() => cargar({ silencioso: true })} /> : null}
      {(edificios || []).map(tarjeta)}
      {edificios && !edificios.length && !error ? (
        <View style={styles.centro}>
          <Ionicons name="business-outline" size={30} color={theme.colors.textSoft} accessible={false} importantForAccessibility="no" />
          <Text style={[styles.sub, styles.centrado, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{TEXTO_SIN_EDIFICIOS}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 10 },
  titulo: { fontSize: fontSizes.lg },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 10 },
  presionada: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  nombre: { fontSize: fontSizes.base },
  sub: { fontSize: fontSizes.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  insignia: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 3 },
  insigniaTexto: { fontSize: fontSizes.xs },
  centro: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  centrado: { textAlign: 'center' },
});
