import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import CustomButton from '../components/CustomButton';
import { ErrorPlazas } from '../components/PlazasUi';
import { Aviso, Campo, Mensajes, Opciones, TablaCantidades, Tarjeta } from '../components/StockUi';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import useCargaStock from '../hooks/useCargaStock';
import useEnvioStock from '../hooks/useEnvioStock';
import {
  SEXOS, armarEntrega, dniValido, armarLineas, clasificarErrorEscritura, getPersona, getSaldo, hayErrores, postEntrega, textoCantidad, textoEspera,
  validarEntrega,
} from '../services/stockApi';
import { formatDate } from '../utils/dates';
import { keyboardDismissModeFor } from '../utils/teclado';
import { fontSizes } from '../theme';

export const SIN_INSUMOS_CON_SALDO = 'Este edificio no tiene insumos con saldo para entregar.';
const TEXTO_SIN_RED_PERSONA = 'Necesitás conexión para buscar a la persona.';

// Stock · «Entregar a una persona» (§17.1 `entregas/`, §17 `persona/`). DNI → («Buscar persona»: nombre e historial) →
// sexo si la persona no está en el legajo → nombre y apellido si el Registro tampoco la tiene; con las cantidades por
// insumo. Solo con conexión y sin cola: el `uuid_cliente` nace al abrir y se conserva en los reintentos (useEnvioStock).
// Un SALDO_INSUFICIENTE muestra los saldos de ahora y deja todo lo cargado para corregir.
export default function StockEntregaScreen({ dispositivoId, edificioId, onListo, onCancelar, onNoEncontrado, onSinModulo, onEnviando, onCambios }) {
  const { theme, typography } = useTheme();
  const { showAlert } = useToast();
  const [dni, setDni] = useState('');
  const [sexo, setSexo] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [observacion, setObservacion] = useState('');
  const [cantidades, setCantidades] = useState({});
  const [persona, setPersona] = useState(null);
  const [pideSexo, setPideSexo] = useState(false);
  const [pideNombre, setPideNombre] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [avisoPersona, setAvisoPersona] = useState('');
  const [esperaPersonaHasta, setEsperaPersonaHasta] = useState(0);
  const [rechazos, setRechazos] = useState({});
  const [erroresServidor, setErroresServidor] = useState({});
  const [intentado, setIntentado] = useState(false);

  const cargador = useCallback(() => getSaldo(dispositivoId, edificioId), [dispositivoId, edificioId]);
  const { datos: saldo, error: errorCarga, cargando, recargar } = useCargaStock(cargador, { onNoEncontrado, onSinModulo });
  const insumos = (saldo?.saldos || []).filter((s) => s.cantidad > 0).map((s) => ({ item_id: s.item_id, nombre: s.nombre, unidad: s.unidad, saldo: s.cantidad, activo: s.activo }));

  const hayCambios = dni.trim() !== '' || observacion.trim() !== '' || Object.values(cantidades).some((c) => String(c).trim() !== '');
  const { enviando, aviso, falla, enviar } = useEnvioStock({ hayCambios, onCambios, onEnviando, onListo, onSinModulo, onNoEncontrado });

  const datos = { dni, cantidades, insumos, pideSexo, sexo, pideNombre, nombre, apellido };
  const erroresCliente = intentado ? validarEntrega(datos) : {};
  const erroresDe = (campo) => [...(erroresCliente[campo] ? [erroresCliente[campo]] : []), ...(erroresServidor[campo] || [])];
  const erroresCantidad = { ...(erroresCliente.cantidades || {}) };

  const cambiarDni = (valor) => {
    setDni(valor);
    // Otra persona: lo averiguado de la anterior no vale (las cantidades se conservan).
    setPersona(null); setPideSexo(false); setPideNombre(false); setAvisoPersona(''); setSexo(''); setNombre(''); setApellido('');
    setErroresServidor((previos) => ({ ...previos, dni: null }));
  };

  const buscarPersona = async () => {
    setIntentado(true);
    if (!dniValido(dni)) return;
    const falta = esperaPersonaHasta - Date.now();
    if (falta > 0) { setAvisoPersona(textoEspera(falta)); return; }
    setBuscando(true);
    setAvisoPersona('');
    try {
      const respuesta = await getPersona(dispositivoId, edificioId, { dni, sexo: pideSexo ? sexo : '' });
      setPersona(respuesta);
      if (respuesta.persona) { setPideSexo(false); setPideNombre(false); return; }
      // Sin legajo: el Registro necesita el sexo; si ya se mandó y tampoco, se pide nombre y apellido (alta mínima).
      if (pideSexo && sexo) { setPideNombre(true); setAvisoPersona('No figura en el Registro. Cargá su nombre y apellido para entregarle.'); } else { setPideSexo(true); setAvisoPersona('No está en el legajo. Elegí el sexo que figura en el DNI y buscá de nuevo, o cargá su nombre y apellido.'); }
    } catch (e) {
      const c = clasificarErrorEscritura(e);
      if (c.tipo === 'no_encontrado') onNoEncontrado?.();
      else if (c.tipo === 'sin_modulo') onSinModulo?.(c.mensaje);
      else if (c.tipo === 'espera' && c.espera) { setEsperaPersonaHasta(Date.now() + c.espera); setAvisoPersona(textoEspera(c.espera)); } else setAvisoPersona(c.tipo === 'sin_red' ? TEXTO_SIN_RED_PERSONA : c.mensaje);
    } finally {
      setBuscando(false);
    }
  };

  const mandar = async () => {
    setErroresServidor({});
    setRechazos({});
    const r = await enviar((uuid) => postEntrega(dispositivoId, edificioId, armarEntrega({
      uuid_cliente: uuid, dni, lineas: armarLineas(cantidades, insumos), sexo: pideSexo ? sexo : '', nombre: pideNombre ? nombre : '',
      apellido: pideNombre ? apellido : '', observacion,
    })), 'Entrega registrada.');
    if (r.ok || !r.clasificacion) return;
    const c = r.clasificacion;
    if (c.tipo === 'saldo_insuficiente') setRechazos(Object.fromEntries(c.saldos.map((s) => [s.item_id, s])));
    else if (c.tipo === 'persona_sin_datos') { if (c.pideSexo) setPideSexo(true); else setPideNombre(true); } else if (c.tipo === 'validacion') setErroresServidor(c.errores || {});
  };

  const entregar = () => {
    if (enviando) return;
    setIntentado(true);
    if (hayErrores(validarEntrega(datos))) return;
    const lineas = armarLineas(cantidades, insumos);
    showAlert('Entregar insumos', `Se descuentan ${lineas.length} ${lineas.length === 1 ? 'insumo' : 'insumos'} del stock de este edificio y se asientan a nombre del DNI ${dni.trim()}. No se puede deshacer desde la app.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Entregar', onPress: mandar },
    ]);
  };

  if (cargando && !saldo) return <View style={styles.centro}><ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel="Cargando el saldo" /></View>;
  if (errorCarga && !saldo) return <View style={styles.centro}><ErrorPlazas mensaje={errorCarga.mensaje} onReintentar={recargar} /></View>;

  const ayuda = [styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.medium }];
  const sub = [styles.sub, { color: theme.colors.text, fontFamily: typography.medium }];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <Aviso mensaje={aviso} tono={['sin_red', 'espera'].includes(falla?.tipo) ? 'warning' : 'danger'} />

      <Tarjeta titulo="¿A quién?" ayuda="Se busca en el legajo; si no está, en el Registro con el sexo.">
        <Campo etiqueta="DNI *" valor={dni} onCambiar={cambiarDni} errores={erroresDe('dni')} deshabilitado={enviando} teclado="number-pad" maxLength={12} />
        {pideSexo ? <Opciones etiqueta="Sexo *" opciones={SEXOS} elegida={sexo} onElegir={setSexo} deshabilitado={enviando} errores={erroresDe('sexo')} /> : null}
        {pideNombre ? (
          <>
            <Campo etiqueta="Nombre *" valor={nombre} onCambiar={setNombre} errores={erroresDe('nombre')} deshabilitado={enviando} />
            <Campo etiqueta="Apellido *" valor={apellido} onCambiar={setApellido} errores={erroresDe('apellido')} deshabilitado={enviando} />
          </>
        ) : null}
        <Aviso mensaje={avisoPersona} tono="warning" icono="information-circle-outline" />
        <CustomButton title={buscando ? 'Buscando…' : 'Buscar persona'} variant="secondary" iconLeft="search-outline" loading={buscando} disabled={buscando || enviando} onPress={buscarPersona} />
        {persona?.persona ? (
          <Text accessibilityLiveRegion="polite" style={[styles.nombre, { color: theme.colors.text, fontFamily: typography.bold }]}>
            {[persona.persona.nombre, persona.persona.apellido].filter(Boolean).join(' ') || `DNI ${persona.persona.dni}`}
          </Text>
        ) : null}
        {persona ? (
          <View style={styles.historial}>
            <Text style={[styles.etiqueta, { color: theme.colors.text, fontFamily: typography.semibold }]}>Entregas anteriores</Text>
            {persona.historial.length === 0 ? <Text style={ayuda}>No recibió insumos antes.</Text> : null}
            {persona.historial.map((entrega, i) => (
              <View key={`h${i}`} accessible accessibilityLabel={`${entrega.creado_en ? formatDate(entrega.creado_en, { includeTime: true }) : ''}, ${entrega.institucion}: ${entrega.lineas.map((l) => `${textoCantidad(l.cantidad, l.unidad)} de ${l.nombre}`).join(', ')}`}>
                <Text style={sub}>{`${entrega.creado_en ? formatDate(entrega.creado_en, { includeTime: true }) : 'Sin fecha'} · ${entrega.institucion}`}</Text>
                <Text style={ayuda}>{entrega.lineas.map((l) => `${textoCantidad(l.cantidad, l.unidad)} ${l.nombre}`).join(', ')}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="¿Qué se entrega?" ayuda="Cargá la cantidad de cada insumo. Lo que dejes en blanco no se entrega.">
        <TablaCantidades insumos={insumos} valores={cantidades} onCambiar={(id, valor) => setCantidades((p) => ({ ...p, [id]: valor }))}
          errores={erroresCantidad} rechazos={rechazos} deshabilitado={enviando} vacio={SIN_INSUMOS_CON_SALDO} />
        <Mensajes lista={[...(erroresCliente.lineas ? [erroresCliente.lineas] : []), ...(erroresServidor.lineas || []), ...(erroresServidor.item_id || [])]} prefijo="lineas" />
      </Tarjeta>

      <Tarjeta titulo="Observación">
        <Campo etiqueta="Observación (opcional)" valor={observacion} onCambiar={setObservacion} multilinea maxLength={500} deshabilitado={enviando}
          errores={erroresDe('observacion')} />
        <Mensajes lista={[...(erroresServidor.non_field_errors || []), ...(erroresServidor.persona || [])]} prefijo="nf" />
      </Tarjeta>

      <CustomButton title="Entregar" size="L" iconLeft="checkmark-circle-outline" loading={enviando} disabled={enviando || insumos.length === 0} onPress={entregar} />
      <CustomButton title="Cancelar" size="L" variant="secondary" disabled={enviando} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  nombre: { fontSize: fontSizes.base },
  etiqueta: { fontSize: fontSizes.sm },
  sub: { fontSize: fontSizes.sm },
  ayuda: { fontSize: fontSizes.xs },
  historial: { gap: 6 },
});
