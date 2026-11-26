import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import CustomButton from '../components/CustomButton';
import { ErrorPlazas } from '../components/PlazasUi';
import {
  clasificarError, getMovimientos, getSaldo, juntarMovimientos, textoCantidad, textoDeMovimiento, textoVariacion,
} from '../services/stockApi';
import { statusTones } from '../theme/statusBadges';
import { fontSizes, radii } from '../theme';

export const SIN_SALDOS = 'Este edificio no tiene insumos con saldo.';
export const SIN_MOVIMIENTOS = 'Todavía no hay movimientos en este edificio.';

// Las acciones de escritura que ofrece el edificio, según `puede` (§17): solo las que vienen en true. Traspasar
// va con `ingresar` (§17.1: `stock.ingresar` en el origen y en el destino).
export const accionesDe = (puede) => [
  puede?.entregar === true ? { id: 'entregar', titulo: 'Entregar a una persona', icono: 'person-add-outline' } : null,
  puede?.ingresar === true ? { id: 'ingresar', titulo: 'Ingresar stock', icono: 'add-circle-outline' } : null,
  puede?.ingresar === true ? { id: 'traspasar', titulo: 'Traspasar a otro edificio', icono: 'swap-horizontal-outline' } : null,
  puede?.ajustar === true ? { id: 'ajustar', titulo: 'Ajustar saldo', icono: 'create-outline' } : null,
].filter(Boolean);

// Stock · saldo por insumo de un edificio (GET .../stock/) y su libro de movimientos (GET .../stock/movimientos/),
// de a 50 con «Cargar más» por cursor. `onAccion(id)` abre la escritura elegida (entregar, ingresar, traspasar, ajustar).
// `onNoEncontrado()`: 404 (el edificio ya no es del usuario);
// `onSinModulo(mensaje)`: 403 SIN_MODULO. `recarga` cambia cuando hay que volver a pedir todo.
export default function StockSaldoScreen({ dispositivoId, edificioId, onAccion, onNoEncontrado, onSinModulo, recarga = 0 }) {
  const { theme, typography } = useTheme();
  const [saldo, setSaldo] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [pagina, setPagina] = useState(null);
  const [error, setError] = useState(null);
  const [errorMas, setErrorMas] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const recargaInicial = useRef(recarga);
  // Un pedido viejo no pisa al vigente.
  const pedidoVigente = useRef(0);

  const alFallar = (e) => {
    const clasificado = clasificarError(e);
    if (clasificado.tipo === 'no_encontrado') {
      onNoEncontrado?.();
      return null;
    }
    if (clasificado.tipo === 'sin_modulo') {
      onSinModulo?.(clasificado.mensaje);
      return null;
    }
    return clasificado;
  };

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    const numero = pedidoVigente.current + 1;
    pedidoVigente.current = numero;
    if (silencioso) setRefrescando(true);
    else setCargando(true);
    setErrorMas(null);
    try {
      const [nuevoSaldo, primera] = await Promise.all([
        getSaldo(dispositivoId, edificioId),
        getMovimientos(dispositivoId, edificioId),
      ]);
      if (!montado.current || pedidoVigente.current !== numero) return;
      setSaldo(nuevoSaldo);
      setMovimientos(primera.resultados);
      setPagina(primera);
      setError(null);
    } catch (e) {
      if (!montado.current || pedidoVigente.current !== numero) return;
      const clasificado = alFallar(e);
      if (clasificado) setError(clasificado);
    } finally {
      if (montado.current && pedidoVigente.current === numero) {
        setCargando(false);
        setRefrescando(false);
      }
    }
  }, [dispositivoId, edificioId, onNoEncontrado, onSinModulo]);

  // «Cargar más»: la página siguiente por el cursor que trajo la anterior.
  const cargarMas = async () => {
    if (cargandoMas || !pagina?.hayMas) return;
    const numero = pedidoVigente.current;
    setCargandoMas(true);
    setErrorMas(null);
    try {
      const siguiente = await getMovimientos(dispositivoId, edificioId, { cursor: pagina.siguiente });
      if (!montado.current || pedidoVigente.current !== numero) return;
      setMovimientos((actuales) => juntarMovimientos(actuales, siguiente));
      setPagina(siguiente);
    } catch (e) {
      if (!montado.current || pedidoVigente.current !== numero) return;
      const clasificado = alFallar(e);
      if (clasificado) setErrorMas(clasificado);
    } finally {
      if (montado.current) setCargandoMas(false);
    }
  };

  useEffect(() => {
    montado.current = true;
    cargar();
    return () => { montado.current = false; };
  }, [dispositivoId, edificioId]);
  useEffect(() => { if (recarga !== recargaInicial.current) cargar({ silencioso: true }); }, [recarga]);

  const tarjeta = [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }];
  const titulo = [styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }];
  const sub = [styles.sub, { color: theme.colors.textMuted, fontFamily: typography.medium }];

  const filaSaldo = (item) => {
    const inactivo = item.activo === false;
    const tono = statusTones.gray;
    return (
      <View key={String(item.item_id)} style={[styles.linea, { borderColor: theme.colors.border }]}
        accessible accessibilityLabel={`${item.nombre}: ${textoCantidad(item.cantidad, item.unidad)}${inactivo ? ', insumo desactivado' : ''}`}>
        <View style={styles.flex}>
          <Text style={[styles.nombre, { color: theme.colors.text, fontFamily: typography.semibold }]}>{item.nombre}</Text>
          {inactivo ? (
            <View style={[styles.insignia, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
              <Text style={[styles.insigniaTexto, { color: tono.tx, fontFamily: typography.bold }]}>Desactivado</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.cantidad, { color: theme.colors.text, fontFamily: typography.bold }]}>{textoCantidad(item.cantidad, item.unidad)}</Text>
      </View>
    );
  };

  const filaMovimiento = (mov) => {
    const tono = statusTones[mov.cantidad < 0 ? 'warning' : 'success'];
    const quien = textoDeMovimiento(mov);
    return (
      <View key={String(mov.id)} style={[styles.linea, { borderColor: theme.colors.border }]}
        accessible accessibilityLabel={`${mov.nombre}, ${textoVariacion(mov.cantidad)}. ${mov.detalle}. ${quien}`}>
        <View style={styles.flex}>
          <Text style={[styles.nombre, { color: theme.colors.text, fontFamily: typography.semibold }]}>{mov.nombre}</Text>
          {mov.detalle ? <Text style={sub}>{mov.detalle}</Text> : null}
          {quien ? <Text style={[styles.ayuda, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{quien}</Text> : null}
        </View>
        <View style={styles.derecha}>
          <View style={[styles.insignia, { backgroundColor: tono.bg, borderColor: tono.bd }]}>
            <Text style={[styles.insigniaTexto, { color: tono.tx, fontFamily: typography.bold }]}>{textoVariacion(mov.cantidad)}</Text>
          </View>
          {mov.saldo_posterior != null ? (
            <Text style={[styles.ayuda, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{`Saldo ${textoCantidad(mov.saldo_posterior)}`}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar({ silencioso: true })}
        colors={[theme.colors.primary]} tintColor={theme.colors.primary} />}>
      {refrescando && Platform.OS === 'web' ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Actualizando el stock" /> : null}
      {cargando ? <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando el stock" /> : null}
      {error ? <ErrorPlazas mensaje={error.mensaje} tono={error.tipo === 'sin_red' ? 'warning' : 'danger'}
        onReintentar={() => cargar({ silencioso: true })} /> : null}

      {saldo && !error ? (
        <>
          <View style={tarjeta}>
            <Text accessibilityRole="header" style={titulo}>{saldo.edificio.nombre || saldo.dispositivo.nombre}</Text>
            {saldo.edificio.nombre && saldo.dispositivo.nombre ? <Text style={sub}>{saldo.dispositivo.nombre}</Text> : null}
          </View>

          {accionesDe(saldo.puede).length ? (
            <View style={tarjeta}>
              <Text accessibilityRole="header" style={titulo}>Acciones</Text>
              {accionesDe(saldo.puede).map((accion) => (
                <CustomButton key={accion.id} title={accion.titulo} variant={accion.id === 'entregar' ? 'primary' : 'secondary'} iconLeft={accion.icono}
                  onPress={() => onAccion?.(accion.id)} />
              ))}
            </View>
          ) : null}

          <View style={tarjeta}>
            <Text accessibilityRole="header" style={titulo}>Saldo por insumo</Text>
            {saldo.saldos.map(filaSaldo)}
            {!saldo.saldos.length ? (
              <View style={styles.centro}>
                <Ionicons name="cube-outline" size={28} color={theme.colors.textSoft} accessible={false} importantForAccessibility="no" />
                <Text style={[sub, styles.centrado, { color: theme.colors.textSoft }]}>{SIN_SALDOS}</Text>
              </View>
            ) : null}
          </View>

          <View style={tarjeta}>
            <Text accessibilityRole="header" style={titulo}>Movimientos</Text>
            {movimientos.map(filaMovimiento)}
            {!movimientos.length ? (
              <Text style={[sub, styles.centrado, { color: theme.colors.textSoft }]}>{SIN_MOVIMIENTOS}</Text>
            ) : null}
            {errorMas ? <ErrorPlazas mensaje={errorMas.mensaje} tono={errorMas.tipo === 'sin_red' ? 'warning' : 'danger'} /> : null}
            {pagina?.hayMas ? (
              <CustomButton title={cargandoMas ? 'Cargando…' : 'Cargar más'} variant="secondary" disabled={cargandoMas} onPress={cargarMas} />
            ) : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 8 },
  titulo: { fontSize: fontSizes.base },
  nombre: { fontSize: fontSizes.sm },
  sub: { fontSize: fontSizes.sm },
  ayuda: { fontSize: fontSizes.xs },
  flex: { flex: 1, gap: 2 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 8 },
  derecha: { alignItems: 'flex-end', gap: 2 },
  cantidad: { fontSize: fontSizes.base },
  insignia: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 3 },
  insigniaTexto: { fontSize: fontSizes.xs },
  centro: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  centrado: { textAlign: 'center' },
});
