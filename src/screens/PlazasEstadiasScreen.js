import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import CustomButton from '../components/CustomButton';
import { ConmutadorPlazas, ErrorPlazas } from '../components/PlazasUi';
import {
  accionesDeEstadia, clasificarError, detalleDeEstadia, getEstadias, juntarPaginas, textoEmergencia,
} from '../services/plazasApi';
import { statusTones } from '../theme/statusBadges';
import { fontSizes, radii } from '../theme';

export const SIN_ESTADIAS = { activa: 'No hay personas alojadas con estos filtros.', egresada: 'No hay estadías egresadas con estos filtros.' };

// Plazas · estadías de un edificio (GET .../estadias/, paginado): filtros Alojadas / Egresadas y por sector,
// y «Ver más» para la página siguiente. `sectores` sale del mapa (`[{ id, nombre }]`); `total` es el número
// que lleva la solapa («Estadías · N»). `abrirAccion(accion, { estadia, dispositivoId, edificioId })`: si
// viene, cada tarjeta muestra un botón por cada `estadia.acciones`; si no, es solo lectura. `recarga`
// cambia cuando hay que volver a pedir la primera página (tras una acción, o con el sincronizar del Banner).
export default function PlazasEstadiasScreen({
  dispositivoId, edificioId, sectores = [], total = null, onVerCamas, abrirAccion, onNoEncontrado, onSinModulo, recarga = 0,
}) {
  const { theme, typography } = useTheme();
  const [estado, setEstado] = useState('activa');
  const [sector, setSector] = useState(null);
  const [estadias, setEstadias] = useState([]);
  const [pagina, setPagina] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const recargaInicial = useRef(recarga);
  // Un pedido viejo (otro filtro) no pisa al vigente.
  const pedidoVigente = useRef(0);

  const cargar = useCallback(async ({ mas = false, silencioso = false } = {}) => {
    const numero = pedidoVigente.current + 1;
    pedidoVigente.current = numero;
    const page = mas ? (pagina?.siguiente || 1) : 1;
    if (mas) setCargandoMas(true);
    else if (silencioso) setRefrescando(true);
    else setCargando(true);
    try {
      const nueva = await getEstadias(dispositivoId, edificioId, { estado, sector, page });
      if (!montado.current || pedidoVigente.current !== numero) return;
      setEstadias((actuales) => (mas ? juntarPaginas(actuales, nueva) : nueva.results));
      setPagina(nueva);
      setError(null);
    } catch (e) {
      if (!montado.current || pedidoVigente.current !== numero) return;
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
      if (montado.current && pedidoVigente.current === numero) {
        setCargando(false);
        setCargandoMas(false);
        setRefrescando(false);
      }
    }
  }, [dispositivoId, edificioId, estado, sector, pagina, onNoEncontrado, onSinModulo]);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  // Cambiar un filtro vuelve a la primera página.
  useEffect(() => { cargar(); }, [dispositivoId, edificioId, estado, sector]);
  useEffect(() => { if (recarga !== recargaInicial.current) cargar({ silencioso: true }); }, [recarga]);

  const filtro = (titulo, activo, alPresionar, clave) => (
    <Pressable key={clave} accessibilityRole="button" accessibilityState={{ selected: activo }} accessibilityLabel={`Filtrar: ${titulo}`}
      onPress={alPresionar}
      style={[styles.filtro, { backgroundColor: activo ? statusTones.brand.bg : theme.colors.surface, borderColor: activo ? statusTones.brand.bd : theme.colors.border }]}>
      <Text style={[styles.filtroTexto, { color: activo ? statusTones.brand.tx : theme.colors.textMuted, fontFamily: typography.semibold }]}>{titulo}</Text>
    </Pressable>
  );

  const tarjeta = (estadia) => {
    const acciones = typeof abrirAccion === 'function' ? accionesDeEstadia(estadia) : [];
    const emergencia = textoEmergencia(estadia);
    const detalle = detalleDeEstadia(estadia);
    return (
      <View key={String(estadia.id)} style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <View style={styles.cabecera}>
          <View style={styles.flex}>
            <Text style={[styles.nombre, { color: theme.colors.text, fontFamily: typography.bold }]}>{estadia.persona.nombre || 'Sin nombre'}</Text>
            {detalle ? <Text style={[styles.detalle, { color: theme.colors.textMuted, fontFamily: typography.medium }]}>{detalle}</Text> : null}
          </View>
          {emergencia ? (
            <View style={[styles.insignia, { backgroundColor: statusTones.info.bg, borderColor: statusTones.info.bd }]}>
              <Text style={[styles.insigniaTexto, { color: statusTones.info.tx, fontFamily: typography.bold }]}>{emergencia}</Text>
            </View>
          ) : null}
        </View>
        {acciones.length ? (
          <View style={styles.acciones}>
            {acciones.map(({ accion, titulo }) => (
              <View key={accion} style={styles.flex}>
                <CustomButton title={titulo} variant={accion === 'egresar' ? 'primary' : 'secondary'}
                  onPress={() => abrirAccion(accion, { estadia, dispositivoId, edificioId })} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const hayLista = estadias.length > 0;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar({ silencioso: true })}
        colors={[theme.colors.primary]} tintColor={theme.colors.primary} />}>
      <ConmutadorPlazas activo="estadias" textoEstadias={total != null ? `Estadías · ${total}` : 'Estadías'} onCamas={onVerCamas} />
      <View style={styles.filtros}>
        {filtro('Alojadas', estado === 'activa', () => setEstado('activa'), 'activa')}
        {filtro('Egresadas', estado === 'egresada', () => setEstado('egresada'), 'egresada')}
      </View>
      {sectores.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtros}>
          {filtro('Todos los sectores', sector === null, () => setSector(null), 'todos')}
          {sectores.map((item) => filtro(item.nombre, String(sector) === String(item.id), () => setSector(item.id), `s-${item.id}`))}
        </ScrollView>
      ) : null}
      {refrescando && Platform.OS === 'web' ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Actualizando las estadías" /> : null}
      {cargando ? <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando las estadías" /> : null}
      {error ? <ErrorPlazas mensaje={error.mensaje} tono={error.tipo === 'sin_red' ? 'warning' : 'danger'}
        onReintentar={() => cargar({ silencioso: true })} /> : null}
      {estadias.map(tarjeta)}
      {!cargando && !error && pagina && !hayLista ? (
        <View style={styles.centro}>
          <Ionicons name="people-outline" size={30} color={theme.colors.textSoft} accessible={false} importantForAccessibility="no" />
          <Text style={[styles.detalle, styles.centrado, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>{SIN_ESTADIAS[estado]}</Text>
        </View>
      ) : null}
      {pagina?.hayMas && !cargando ? (
        <CustomButton title={cargandoMas ? 'Cargando…' : 'Ver más'} variant="secondary" disabled={cargandoMas}
          onPress={() => cargar({ mas: true })} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  flex: { flex: 1 },
  filtros: { flexDirection: 'row', gap: 8 },
  filtro: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: 14, paddingVertical: 7 },
  filtroTexto: { fontSize: fontSizes.sm },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 10 },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nombre: { fontSize: fontSizes.base },
  detalle: { fontSize: fontSizes.sm },
  insignia: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 3 },
  insigniaTexto: { fontSize: fontSizes.xs },
  acciones: { flexDirection: 'row', gap: 8 },
  centro: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  centrado: { textAlign: 'center' },
});
