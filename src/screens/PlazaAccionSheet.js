import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import TextInput from '../components/FormInput';
import CustomButton from '../components/CustomButton';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import {
  TEXTO_SIN_RED, accionarPlaza, accionesDeCama, intentarAccion, validarAccionPlaza,
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

const ESTADOS = {
  disponible: 'Libre', reservada: 'Reservada', prestada: 'Prestada', fuera_servicio: 'Fuera de servicio', ocupada: 'Ocupada',
};

const TITULOS = {
  reservar: 'Reservar la cama', prestar: 'Prestar la cama', fuera_servicio: 'Sacar de servicio', liberar: 'Liberar la cama', volver: 'Volver a servicio',
};

// Acciones de una cama (§16, mockups Reservar.dc.html y la hoja de Cama.dc.html): reservar o prestar (DNI,
// «Hasta» y motivo; sin «Desde»: la reserva arranca ahora), liberar, sacar de servicio (motivo obligatorio) y
// volver a servicio. Solo muestra lo que viene en `plaza.acciones`. Cada acción pide confirmación, va solo con
// conexión y no se manda dos veces. Egresar y cambiar de cama tienen su propia pantalla. Props:
// `{ dispositivoId, edificioId, plaza, onListo(mapa), onCancelar() }` (las acciones responden con el mapa).
export default function PlazaAccionSheet({ plaza = null, modoInicial = null, onListo, onCancelar, onEnviando, onCambios }) {
  const { theme, typography } = useTheme();
  const { showToast, showAlert } = useToast();
  const permitidas = accionesDeCama(plaza);
  // `modoInicial`: la acción que se tocó en la hoja del mapa; vale solo si la cama la permite.
  const pedida = (modoInicial === 'reservar' && permitidas.reservar) || (modoInicial === 'prestar' && permitidas.prestar)
    || (modoInicial === 'fuera_servicio' && permitidas.fueraServicio && !(typeof plaza?.bloqueo === 'string' && plaza.bloqueo.trim()))
    ? modoInicial : null;
  const inicial = pedida || (permitidas.reservar ? 'reservar' : permitidas.prestar ? 'prestar' : null);
  const [modo, setModo] = useState(inicial);
  const [dni, setDni] = useState('');
  const [hasta, setHasta] = useState('');
  const [motivo, setMotivo] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [erroresServidor, setErroresServidor] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [haciendo, setHaciendo] = useState(null);
  const enviandoRef = useRef(false);
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const datos = { dni, hasta, motivo };
  const erroresCliente = intentado && modo ? validarAccionPlaza(modo, datos) : {};
  const errorDe = (campo) => [...(erroresCliente[campo] || []), ...(erroresServidor[campo] || [])];

  const cambiarModo = (nuevo) => {
    if (enviando) return;
    setModo(nuevo);
    setMotivo('');
    setIntentado(false);
    setErroresServidor({});
    setAviso('');
  };

  const enviar = async (accion) => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    avisar(onEnviando, true);
    setHaciendo(accion);
    setAviso('');
    try {
      const r = await intentarAccion(() => accionarPlaza(plaza.id, accion, datos), 'cama');
      if (r.ok) {
        showToast({ type: 'success', message: 'Listo.' });
        onListo?.(r.respuesta?.mapa ?? null);
        return;
      }
      const c = r.clasificacion;
      if (!montado.current) return;
      if (c.tipo === 'no_encontrada') {
        showAlert('Cama no disponible', c.mensaje, [{ text: 'Entendido', onPress: () => onCancelar?.() }]);
      } else if (c.tipo === 'sin_red') {
        showAlert('Sin conexión', TEXTO_SIN_RED, [{ text: 'Entendido' }]);
      } else if (c.tipo === 'validacion' || c.tipo === 'persona_no_encontrada') {
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

  const hayCambios = dni.trim() !== '' || hasta.trim() !== '' || motivo.trim() !== '';
  useEffect(() => { avisar(onCambios, hayCambios); }, [hayCambios]);

  const textoDeConfirmacion = (accion) => {
    const cama = plaza?.codigo ? `la cama ${plaza.codigo}` : 'la cama';
    if (accion === 'reservar') return `Se reserva ${cama} para el DNI ${dni}.`;
    if (accion === 'prestar') return `Se presta ${cama} al DNI ${dni} hasta el ${hasta}.`;
    if (accion === 'liberar') return `Se libera ${cama}.`;
    if (accion === 'fuera_servicio') return `${cama[0].toUpperCase()}${cama.slice(1)} sale de servicio y no se puede asignar.`;
    return `${cama[0].toUpperCase()}${cama.slice(1)} vuelve a servicio.`;
  };

  const pedirConfirmacion = (accion) => {
    if (enviandoRef.current) return;
    setIntentado(true);
    setErroresServidor({});
    if (Object.keys(validarAccionPlaza(accion, datos)).length) return;
    showAlert(TITULOS[accion], textoDeConfirmacion(accion), [
      { text: 'Revisar', style: 'cancel' },
      { text: TITULOS[accion], onPress: () => enviar(accion) },
    ]);
  };

  const tarjeta = [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }];
  const etiqueta = [styles.etiqueta, { color: theme.colors.text, fontFamily: typography.semibold }];
  const ayuda = [styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.medium }];
  const caja = (conError) => [styles.input, {
    color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: conError ? theme.colors.danger : theme.colors.border,
  }];
  const mensajes = (lista, prefijo) => lista.map((m, i) => (
    <Text key={`${prefijo}:${i}`} accessibilityLiveRegion="polite" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.medium }]}>{m}</Text>
  ));
  const pestana = (accion, titulo) => (
    <Pressable key={accion} accessibilityRole="tab" accessibilityLabel={titulo} accessibilityState={{ selected: modo === accion, disabled: enviando }}
      disabled={enviando} onPress={() => cambiarModo(accion)}
      style={[styles.pestana, { borderColor: modo === accion ? theme.colors.primary : theme.colors.border, backgroundColor: theme.colors.surface }]}>
      <Text style={{ color: theme.colors.text, fontFamily: modo === accion ? typography.semibold : typography.medium, fontSize: fontSizes.sm }}>{titulo}</Text>
    </Pressable>
  );

  const hayReserva = permitidas.reservar || permitidas.prestar;
  const hayAlgo = hayReserva || permitidas.liberar || permitidas.fueraServicio || permitidas.volver;
  const persona = plaza?.persona;
  const bloqueo = typeof plaza?.bloqueo === 'string' ? plaza.bloqueo.trim() : '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <View style={tarjeta}>
        <Text accessibilityRole="header" style={[styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }]}>{`Cama ${plaza?.codigo ?? ''}`.trim()}</Text>
        <Text style={ayuda}>{ESTADOS[plaza?.estado] || plaza?.estado || ''}</Text>
        {persona?.nombre ? <Text style={etiqueta}>{persona.nombre}</Text> : null}
      </View>

      {aviso ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{aviso}</Text> : null}
      {!hayAlgo ? <Text style={ayuda}>No hay acciones disponibles para esta cama.</Text> : null}

      {hayReserva ? (
        <View style={tarjeta}>
          <View style={styles.opciones}>
            {permitidas.reservar ? pestana('reservar', 'Reservar') : null}
            {permitidas.prestar ? pestana('prestar', 'Prestar') : null}
          </View>
          {modo === 'reservar' || modo === 'prestar' ? (
            <>
              <Text style={etiqueta}>DNI de la persona *</Text>
              <TextInput value={dni} onChangeText={setDni} editable={!enviando} keyboardType="number-pad" maxLength={12}
                accessibilityLabel="DNI de la persona" placeholderTextColor={theme.colors.textSoft} style={caja(errorDe('dni').length > 0)} />
              {mensajes(errorDe('dni'), 'dni')}
              <Text style={etiqueta}>{modo === 'prestar' ? 'Hasta * (DD/MM/AAAA)' : 'Hasta (DD/MM/AAAA)'}</Text>
              <TextInput value={hasta} onChangeText={setHasta} editable={!enviando} keyboardType="numbers-and-punctuation" maxLength={10}
                accessibilityLabel="Hasta" placeholder="DD/MM/AAAA" placeholderTextColor={theme.colors.textSoft} style={caja(errorDe('hasta').length > 0)} />
              {mensajes(errorDe('hasta'), 'hasta')}
              <Text style={etiqueta}>Motivo</Text>
              <TextInput value={motivo} onChangeText={setMotivo} editable={!enviando} multiline maxLength={200}
                accessibilityLabel="Motivo" placeholderTextColor={theme.colors.textSoft} style={[...caja(errorDe('motivo').length > 0), styles.areaTexto]} />
              {mensajes(errorDe('motivo'), 'motivo')}
              {mensajes(errorDe('non_field_errors'), 'nf')}
              <CustomButton title={TITULOS[modo]} size="L" loading={enviando} disabled={enviando} onPress={() => pedirConfirmacion(modo)} />
            </>
          ) : null}
        </View>
      ) : null}

      {permitidas.liberar ? (
        <CustomButton title="Liberar" size="L" variant="secondary" iconLeft="lock-open-outline" disabled={enviando} loading={haciendo === 'liberar' && enviando}
          onPress={() => pedirConfirmacion('liberar')} />
      ) : null}

      {permitidas.fueraServicio ? (
        <View style={tarjeta}>
          {modo === 'fuera_servicio' ? (
            <>
              <Text style={etiqueta}>Motivo *</Text>
              <TextInput value={motivo} onChangeText={setMotivo} editable={!enviando} multiline maxLength={200}
                accessibilityLabel="Motivo para sacar de servicio" placeholderTextColor={theme.colors.textSoft} style={[...caja(errorDe('motivo').length > 0), styles.areaTexto]} />
              {mensajes(errorDe('motivo'), 'motivo-fs')}
              {mensajes(errorDe('non_field_errors'), 'nf-fs')}
              <CustomButton title="Sacar de servicio" size="L" loading={enviando} disabled={enviando} onPress={() => pedirConfirmacion('fuera_servicio')} />
            </>
          ) : (
            <>
              <CustomButton title="Sacar de servicio" size="L" variant="secondary" iconLeft="construct-outline" disabled={enviando || !!bloqueo}
                onPress={() => cambiarModo('fuera_servicio')} />
              {bloqueo ? <Text style={ayuda}>{bloqueo}</Text> : null}
            </>
          )}
        </View>
      ) : null}

      {permitidas.volver ? (
        <CustomButton title="Volver a servicio" size="L" iconLeft="checkmark-circle-outline" disabled={enviando} loading={haciendo === 'volver' && enviando}
          onPress={() => pedirConfirmacion('volver')} />
      ) : null}

      <CustomButton title="Cancelar" size="L" variant="secondary" disabled={enviando} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 8 },
  titulo: { fontSize: fontSizes.base },
  etiqueta: { fontSize: fontSizes.sm },
  ayuda: { fontSize: fontSizes.xs },
  error: { fontSize: fontSizes.xs },
  opciones: { flexDirection: 'row', gap: 8 },
  pestana: { flex: 1, borderWidth: 1, borderRadius: radii.lg, paddingVertical: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSizes.sm },
  areaTexto: { minHeight: 80, textAlignVertical: 'top' },
});
