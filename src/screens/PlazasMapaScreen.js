import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import CustomButton from '../components/CustomButton';
import { ChipResumen, ConmutadorPlazas, ErrorPlazas } from '../components/PlazasUi';
import {
  accionesDePlaza, chipsDeResumen, clasificarError, detalleDeCama, estadoDePlaza, etiquetaDeCama, getMapa, textoDeCama,
  textoResumenSector,
} from '../services/plazasApi';
import { statusTones } from '../theme/statusBadges';
import { fontSizes, radii } from '../theme';

const COLUMNAS = 4;

// Plazas · mapa de camas de un edificio (GET .../mapa/): resumen, sectores con sus camas coloreadas por
// estado y, al tocar una cama, una hoja inferior con su detalle.
//
// El mapa vive en quien monta la pantalla (`mapa`): la pantalla lo pide y lo informa con
// `onMapaActualizado(mapa)`. Las acciones (PR de acciones) devuelven el mapa actualizado y lo pasan por
// el mismo callback para repintar sin otro pedido. `abrirAccion(accion, { plaza, dispositivoId, edificioId })`:
// si viene, la hoja muestra un botón por cada `plaza.acciones`; si no, es solo lectura.
// Un 404 llama a `onNoEncontrado`; un 403 SIN_MODULO, a `onSinModulo(mensaje)`. `recarga` cambia cuando
// hay que volver a pedir el mapa.
export default function PlazasMapaScreen({
  dispositivoId, edificioId, mapa = null, onMapaActualizado, onVerEstadias, abrirAccion, onNoEncontrado, onSinModulo, recarga = 0,
}) {
  const { theme, typography } = useTheme();
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(!mapa);
  const [refrescando, setRefrescando] = useState(false);
  const [seleccion, setSeleccion] = useState(null);
  const montado = useRef(true);
  const recargaInicial = useRef(recarga);
  const alActualizar = useRef(onMapaActualizado);
  alActualizar.current = onMapaActualizado;

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (silencioso) setRefrescando(true);
    try {
      const nuevo = await getMapa(dispositivoId, edificioId);
      if (!montado.current) return;
      alActualizar.current?.(nuevo);
      setError(null);
    } catch (e) {
      if (!montado.current) return;
      const clasificado = clasificarError(e);
      if (clasificado.tipo === 'no_encontrado') {
        onNoEncontrado?.();
        return;
      }
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
  }, [dispositivoId, edificioId, onNoEncontrado, onSinModulo]);

  useEffect(() => {
    montado.current = true;
    cargar();
    return () => { montado.current = false; };
  }, [dispositivoId, edificioId]);
  useEffect(() => { if (recarga !== recargaInicial.current) cargar({ silencioso: true }); }, [recarga]);

  // La cama abierta se vuelve a buscar en el mapa vigente: tras una acción el estado cambió (o la cama ya no está).
  const buscarSeleccion = () => {
    if (!seleccion || !mapa) return null;
    for (const sector of mapa.sectores) {
      const plaza = sector.plazas.find((item) => String(item.id) === String(seleccion));
      if (plaza) return { plaza, sector };
    }
    return null;
  };
  const abierta = buscarSeleccion();

  const celda = (plaza) => {
    const estado = estadoDePlaza(plaza.estado);
    const tono = statusTones[estado.tono];
    return (
      <Pressable key={String(plaza.id)} accessibilityRole="button" accessibilityLabel={etiquetaDeCama(plaza)}
        onPress={() => setSeleccion(plaza.id)}
        style={({ pressed }) => [styles.cama, { backgroundColor: tono.bg, borderColor: tono.bd }, pressed && styles.presionada]}>
        <Text numberOfLines={1} style={[styles.camaCodigo, { color: tono.tx, fontFamily: typography.bold }]}>{plaza.codigo}</Text>
        <Text numberOfLines={1} style={[styles.camaTexto, { color: tono.tx, fontFamily: typography.semibold }]}>{textoDeCama(plaza)}</Text>
      </Pressable>
    );
  };

  const sector = (item) => (
    <View key={String(item.id)} style={[styles.sector, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.sectorCabecera}>
        <Text accessibilityRole="header" style={[styles.sectorNombre, { color: theme.colors.text, fontFamily: typography.bold }]}>{item.nombre}</Text>
        <Text style={[styles.sectorResumen, { color: theme.colors.textMuted, fontFamily: typography.semibold }]}>{textoResumenSector(item.resumen)}</Text>
      </View>
      <View style={styles.grilla}>{item.plazas.map(celda)}</View>
      {!item.plazas.length ? (
        <Text style={[styles.sectorResumen, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>Este sector no tiene camas.</Text>
      ) : null}
    </View>
  );

  const hoja = () => {
    if (!abierta) return null;
    const { plaza, sector: delSector } = abierta;
    const estado = estadoDePlaza(plaza.estado);
    const tono = statusTones[estado.tono];
    const filas = detalleDeCama(plaza, delSector);
    const acciones = typeof abrirAccion === 'function' ? accionesDePlaza(plaza) : [];
    const bloqueo = typeof plaza.bloqueo === 'string' ? plaza.bloqueo.trim() : '';
    const cerrar = () => setSeleccion(null);
    return (
      <Modal transparent animationType="slide" visible onRequestClose={cerrar}>
        <Pressable accessibilityLabel="Cerrar el detalle de la cama" onPress={cerrar} style={styles.fondoHoja} />
        <View style={[styles.hoja, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.hojaCabecera}>
            <Text accessibilityRole="header" style={[styles.hojaTitulo, { color: theme.colors.text, fontFamily: typography.bold }]}>{`Cama ${plaza.codigo}`}</Text>
            <View style={[styles.insignia, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
              <Text style={[styles.insigniaTexto, { color: tono.tx, fontFamily: typography.bold }]}>{estado.titulo}</Text>
            </View>
            <View style={styles.flex} />
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={cerrar} hitSlop={8}>
              <Ionicons name="close" size={22} color={theme.colors.textMuted} accessible={false} importantForAccessibility="no" />
            </Pressable>
          </View>
          {filas.map((fila) => (
            <View key={fila.clave} style={styles.filaDetalle}>
              <Text style={[styles.filaTitulo, { color: theme.colors.textMuted, fontFamily: typography.semibold }]}>{fila.titulo}</Text>
              <Text style={[styles.filaValor, { color: theme.colors.text, fontFamily: typography.medium }]}>{fila.valor}</Text>
            </View>
          ))}
          {acciones.map(({ accion, titulo }) => {
            const bloqueada = accion === 'fuera_servicio' && !!bloqueo;
            return (
              <React.Fragment key={accion}>
                <CustomButton title={titulo} variant={accion === 'egresar' ? 'primary' : 'secondary'} disabled={bloqueada}
                  onPress={() => abrirAccion(accion, { plaza, dispositivoId, edificioId })} />
                {bloqueada ? <Text style={[styles.filaValor, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{bloqueo}</Text> : null}
              </React.Fragment>
            );
          })}
        </View>
      </Modal>
    );
  };

  const chips = mapa ? chipsDeResumen(mapa.resumen, { todos: true }) : [];
  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar({ silencioso: true })}
          colors={[theme.colors.primary]} tintColor={theme.colors.primary} />}>
        {mapa ? (
          <ConmutadorPlazas activo="camas" textoEstadias={`Estadías · ${mapa.resumen.ocupadas}`} onEstadias={onVerEstadias} />
        ) : null}
        {chips.length ? <View style={styles.resumen}>{chips.map((chip) => <ChipResumen key={chip.clave} chip={chip} />)}</View> : null}
        {refrescando && Platform.OS === 'web' ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Actualizando el mapa" /> : null}
        {cargando && !mapa ? <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando el mapa" /> : null}
        {error ? <ErrorPlazas mensaje={error.mensaje} tono={error.tipo === 'sin_red' ? 'warning' : 'danger'}
          onReintentar={() => cargar({ silencioso: true })} /> : null}
        {mapa ? mapa.sectores.map(sector) : null}
        {mapa && !mapa.sectores.length ? (
          <View style={styles.centro}>
            <Ionicons name="bed-outline" size={30} color={theme.colors.textSoft} accessible={false} importantForAccessibility="no" />
            <Text style={[styles.sectorResumen, styles.centrado, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>Este edificio todavía no tiene sectores ni camas.</Text>
          </View>
        ) : null}
        {mapa?.sectores.length ? (
          <Text style={[styles.pista, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>Tocá una cama para ver el detalle.</Text>
        ) : null}
      </ScrollView>
      {hoja()}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  flex: { flex: 1 },
  resumen: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sector: { borderWidth: 1, borderRadius: radii.xl, padding: 12, gap: 10 },
  sectorCabecera: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  sectorNombre: { flex: 1, fontSize: fontSizes.base },
  sectorResumen: { fontSize: fontSizes.xs },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // 4 por fila: (100% - 3 espacios de 6) / 4.
  cama: { flexGrow: 0, flexShrink: 0, flexBasis: `${100 / COLUMNAS - 2}%`, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 1, padding: 4, borderWidth: 1, borderRadius: radii.lg },
  presionada: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  camaCodigo: { fontSize: fontSizes.xs },
  camaTexto: { fontSize: fontSizes.xs, maxWidth: '100%' },
  pista: { fontSize: fontSizes.xs, textAlign: 'center' },
  centro: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  centrado: { textAlign: 'center' },
  fondoHoja: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  hoja: { borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], padding: 16, paddingBottom: 28, gap: 10 },
  hojaCabecera: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hojaTitulo: { fontSize: fontSizes.lg },
  insignia: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 3 },
  insigniaTexto: { fontSize: fontSizes.xs },
  filaDetalle: { flexDirection: 'row', gap: 12 },
  filaTitulo: { width: 90, fontSize: fontSizes.sm },
  filaValor: { flex: 1, fontSize: fontSizes.sm },
});
