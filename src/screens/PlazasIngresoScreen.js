import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import TextInput from '../components/FormInput';
import CustomButton from '../components/CustomButton';
import FechaInput from '../components/FechaInput';
import CampoFormulario from '../components/formulario/CampoFormulario';
import GrupoFormulario from '../components/formulario/GrupoFormulario';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { TEXTO_SIN_RED, intentarAccion } from '../services/plazasAccionesApi';
import {
  SEXOS_INGRESO, bloqueoDePersona, buscarPersonaIngreso, formularioDeIngreso, getFormularioIngreso, ingresarPersona,
  TEXTO_SIN_PERMISO_ALTA, normalizarBusquedaPersona, respuestasDeIngreso, soloDigitos, validarPersonaNueva, vistaDePersona,
} from '../services/plazasIngresoApi';
import { evaluarDiseno, problemasDelDiseno } from '../services/definicionFormulario';
import { dniConPuntos } from '../services/plazasApi';
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

const CAMPOS_ALTA = ['dni', 'nombre', 'apellido', 'sexo', 'fecha_nacimiento'];
const dniValido = (dni) => [7, 8].includes(soloDigitos(dni).length);

// Ingresar a una persona en una cama (§18): 1) persona (buscar por DNI o dar de alta), 2) formulario de ingreso
// si el tipo lo tiene (mismo renderizador que las inspecciones), 3) confirmar. Solo con conexión, sin cola, y no
// se manda dos veces. Props: `{ dispositivoId, edificioId, plaza, sector?, onListo(mapa), onCancelar() }`.
export default function PlazasIngresoScreen({ dispositivoId, plaza = null, sector = null, onListo, onCancelar, onEnviando, onCambios }) {
  const { theme, typography } = useTheme();
  const { showToast, showAlert } = useToast();
  const [paso, setPaso] = useState('persona');
  const [dni, setDni] = useState('');
  const [resultado, setResultado] = useState(null);
  const [alta, setAlta] = useState({ nombre: '', apellido: '', sexo: '', fecha_nacimiento: '' });
  const [buscando, setBuscando] = useState(false);
  const [cargandoFormulario, setCargandoFormulario] = useState(false);
  const [formulario, setFormulario] = useState(null);
  const [valores, setValores] = useState({});
  const [busqueda, setBusqueda] = useState({});
  const [intentado, setIntentado] = useState(false);
  const [intentadoForm, setIntentadoForm] = useState(false);
  const [erroresServidor, setErroresServidor] = useState({});
  const [clavesServidor, setClavesServidor] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  // 429 de la búsqueda: el botón no manda hasta que pase el Retry-After, con cuenta regresiva.
  const [esperaHasta, setEsperaHasta] = useState(0);
  const [ahora, setAhora] = useState(Date.now());
  const enviandoRef = useRef(false);
  const busquedaRef = useRef(0);
  const montado = useRef(true);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const esperando = esperaHasta > ahora;
  useEffect(() => {
    if (!esperando) return undefined;
    const timer = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [esperando]);
  const segundos = Math.max(1, Math.ceil((esperaHasta - ahora) / 1000));

  const ocupado = enviando || buscando || cargandoFormulario;
  const codigo = plaza?.codigo ?? '';
  const nombreSector = sector?.nombre || plaza?.sector?.nombre || '';
  const persona = resultado?.encontrada ? resultado.persona : null;
  const bloqueo = bloqueoDePersona(resultado);
  const esAlta = vistaDePersona(resultado) === 'alta';
  const sinPermisoAlta = vistaDePersona(resultado) === 'sin_permiso';
  const datosAlta = { dni, ...alta };

  const hayCambios = dni.trim() !== '' || alta.nombre.trim() !== '' || alta.apellido.trim() !== '' || alta.sexo !== ''
    || alta.fecha_nacimiento !== '' || Object.keys(valores).length > 0;
  useEffect(() => { avisar(onCambios, hayCambios); }, [hayCambios]);

  const diseno = useMemo(
    () => (formulario ? evaluarDiseno(formulario.definicion, { valores }, null) : null),
    [formulario, valores]);

  const erroresAlta = intentado && esAlta ? validarPersonaNueva(datosAlta) : {};
  const erroresDni = intentado && !resultado && !dniValido(dni) ? ['Escribí un DNI de 7 u 8 dígitos.'] : [];
  const errorDe = (campo) => [...(erroresAlta[campo] || []), ...(erroresServidor[campo] || [])];

  const cambiarDni = (valor) => {
    if (ocupado) return;
    busquedaRef.current += 1;
    setDni(valor);
    setResultado(null);
    setErroresServidor({});
    setAviso('');
  };
  const ponerAlta = (campo, valor) => {
    setAlta((prev) => ({ ...prev, [campo]: valor }));
    setErroresServidor((prev) => ({ ...prev, [campo]: null }));
  };

  const mostrarError = (c) => {
    if (c.tipo === 'sin_red') showAlert('Sin conexión', TEXTO_SIN_RED, [{ text: 'Entendido' }]);
    else if (c.tipo === 'no_encontrada') showAlert('Cama no disponible', c.mensaje, [{ text: 'Entendido', onPress: () => onCancelar?.() }]);
    else setAviso(c.mensaje);
  };

  // ---- Paso 1: persona ----
  const buscar = async () => {
    if (ocupado || esperando) return;
    setIntentado(true);
    setErroresServidor({});
    setAviso('');
    if (!dniValido(dni)) return;
    const turno = ++busquedaRef.current;
    setBuscando(true);
    try {
      const r = await intentarAccion(() => buscarPersonaIngreso(dispositivoId, dni), 'cama');
      if (!montado.current || turno !== busquedaRef.current) return;
      if (r.ok) {
        setResultado(normalizarBusquedaPersona(r.respuesta));
        setIntentado(false);
      } else if (r.clasificacion.tipo === 'validacion') {
        // El error de campo (el DNI) se ve en el campo; el aviso general solo si no hay ninguno.
        const errores = r.clasificacion.errores || {};
        setErroresServidor(errores);
        if (!Object.keys(errores).some((k) => k !== 'non_field_errors')) setAviso(r.clasificacion.mensaje);
      } else {
        if (r.clasificacion.espera) {
          const ahoraMs = Date.now();
          setAhora(ahoraMs);
          setEsperaHasta(ahoraMs + r.clasificacion.espera);
        }
        mostrarError(r.clasificacion);
      }
    } finally {
      if (montado.current) setBuscando(false);
    }
  };

  // ---- Paso 2: formulario ----
  // `{ ok, f }`: ok = la lectura respondió; f = el formulario (null si el tipo no tiene).
  const pedirFormulario = async ({ conservar = false } = {}) => {
    setCargandoFormulario(true);
    setAviso('');
    try {
      const r = await intentarAccion(() => getFormularioIngreso(dispositivoId), 'cama');
      if (!montado.current) return { ok: false, f: null };
      if (!r.ok) { mostrarError(r.clasificacion); return { ok: false, f: null }; }
      const f = formularioDeIngreso(r.respuesta);
      setFormulario(f);
      if (!conservar) setValores({});
      return { ok: true, f };
    } finally {
      if (montado.current) setCargandoFormulario(false);
    }
  };

  const seguirDePersona = async () => {
    if (ocupado) return;
    setIntentado(true);
    setErroresServidor({});
    if (bloqueo) return;
    if (esAlta && Object.keys(validarPersonaNueva(datosAlta)).length) return;
    const { ok, f } = await pedirFormulario();
    if (!ok || !montado.current) return;
    setIntentado(false);
    setIntentadoForm(false);
    setPaso(f ? 'formulario' : 'confirmar');
  };

  const seguirDeFormulario = () => {
    if (ocupado) return;
    setIntentadoForm(true);
    setClavesServidor({});
    if (!diseno || problemasDelDiseno(diseno.campos, diseno.efectivas).length) return;
    setPaso('confirmar');
  };

  // ---- Paso 3: confirmar ----
  const cuerpoDatos = () => ({
    plazaId: plaza?.id,
    ...(persona ? { ciudadanoId: persona.id } : { personaNueva: datosAlta }),
    formulario: formulario && diseno ? { version: formulario.version, respuestas: respuestasDeIngreso(diseno.campos, diseno.efectivas) } : null,
  });

  const tratarErrorDeEnvio = async (c) => {
    if (c.tipo === 'validacion' && c.plazaOcupada) {
      // La cama se ocupó en el medio: se vuelve al mapa, que se pide de nuevo.
      showAlert('Cama ocupada', 'Esa cama se acaba de ocupar. Se actualiza el mapa.', [{ text: 'Entendido', onPress: () => onListo?.(null) }]);
    } else if (c.tipo === 'validacion') {
      const errores = c.errores || {};
      setErroresServidor(errores);
      setClavesServidor(c.claves || {});
      const enCampo = Object.keys(c.claves || {}).length > 0 || (esAlta && CAMPOS_ALTA.some((campo) => errores[campo]));
      setAviso(enCampo ? '' : c.mensaje);
      if (esAlta && CAMPOS_ALTA.some((campo) => errores[campo])) setPaso('persona');
      else if (Object.keys(c.claves || {}).length) setPaso('formulario');
    } else if (c.tipo === 'formulario_cambio') {
      // Se vuelve a pedir el formulario sin perder lo escrito (mismas claves) y se confirma de nuevo.
      const { ok, f } = await pedirFormulario({ conservar: true });
      if (!ok || !montado.current) return;
      setAviso(c.mensaje);
      setIntentadoForm(false);
      setPaso(f ? 'formulario' : 'confirmar');
    } else if (c.tipo === 'ingreso_con_archivo') {
      setAviso(c.mensaje);
      showAlert('Ingreso desde el backoffice', c.mensaje, [{ text: 'Entendido' }]);
    } else {
      mostrarError(c);
    }
  };

  const enviar = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    avisar(onEnviando, true);
    setAviso('');
    try {
      const r = await intentarAccion(() => ingresarPersona(dispositivoId, cuerpoDatos()), 'cama');
      if (r.ok) {
        showToast({ type: 'success', message: 'Persona ingresada' });
        onListo?.(r.respuesta?.mapa ?? null);
        return;
      }
      if (!montado.current) return;
      await tratarErrorDeEnvio(r.clasificacion);
    } finally {
      enviandoRef.current = false;
      if (montado.current) setEnviando(false);
      avisar(onEnviando, false);
    }
  };

  const pedirConfirmacion = () => {
    if (enviandoRef.current || ocupado) return;
    const nombre = persona?.nombre_completo || `${alta.nombre} ${alta.apellido}`.trim() || 'la persona';
    showAlert('Ingresar persona', `Se ingresa a ${nombre} en la cama ${codigo}${nombreSector ? ` (${nombreSector})` : ''}.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Ingresar persona', onPress: enviar },
    ]);
  };

  const volverUnPaso = () => {
    if (ocupado) return;
    setAviso('');
    setErroresServidor({});
    setPaso((actual) => (actual === 'confirmar' && formulario && !formulario.requiereArchivo ? 'formulario' : 'persona'));
  };

  // ---- Estilos ----
  const tarjeta = [styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }];
  const etiqueta = [styles.etiqueta, { color: theme.colors.text, fontFamily: typography.semibold }];
  const ayuda = [styles.ayuda, { color: theme.colors.textMuted, fontFamily: typography.medium }];
  const titulo = [styles.titulo, { color: theme.colors.text, fontFamily: typography.bold }];
  const caja = (conError) => [styles.input, {
    color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: conError ? theme.colors.danger : theme.colors.border,
  }];
  const mensajes = (lista, prefijo) => lista.map((m, i) => (
    <Text key={`${prefijo}:${i}`} accessibilityLiveRegion="polite" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.medium }]}>{m}</Text>
  ));
  const opcion = (activa, texto, onPress, etiquetaA11y) => (
    <Pressable key={etiquetaA11y} accessibilityRole="radio" accessibilityLabel={etiquetaA11y} accessibilityState={{ selected: activa, disabled: ocupado }}
      disabled={ocupado} onPress={onPress}
      style={[styles.opcion, { borderColor: activa ? theme.colors.primary : theme.colors.border, backgroundColor: activa ? theme.colors.primarySoft || theme.colors.surface : theme.colors.surface }]}>
      <Text style={{ color: theme.colors.text, fontFamily: activa ? typography.semibold : typography.medium, fontSize: fontSizes.sm }}>{texto}</Text>
    </Pressable>
  );
  const textoAlta = (campo, rotulo) => (
    <View key={campo} style={styles.campo}>
      <Text style={etiqueta}>{`${rotulo} *`}</Text>
      <TextInput value={alta[campo]} onChangeText={(v) => ponerAlta(campo, v)} editable={!ocupado} accessibilityLabel={rotulo} maxLength={80}
        autoCapitalize="words" placeholderTextColor={theme.colors.textSoft} style={caja(errorDe(campo).length > 0)} />
      {mensajes(errorDe(campo), campo)}
    </View>
  );

  // ---- Vistas ----
  const vistaPersona = (
    <>
      <View style={tarjeta}>
        <Text style={etiqueta}>DNI de la persona *</Text>
        <TextInput value={dni} onChangeText={cambiarDni} editable={!ocupado} accessibilityLabel="DNI de la persona" keyboardType="numeric" inputMode="numeric"
          maxLength={10} placeholderTextColor={theme.colors.textSoft} style={caja(erroresDni.length > 0 || errorDe('dni').length > 0)} />
        {mensajes([...erroresDni, ...errorDe('dni')], 'dni')}
        {!resultado ? <CustomButton title={esperando ? `Buscar en ${segundos} s` : 'Buscar'} size="L" iconLeft="search-outline" loading={buscando}
          disabled={ocupado || esperando} onPress={buscar} /> : null}
      </View>

      {persona ? (
        <View style={tarjeta}>
          <Text accessibilityRole="header" style={titulo}>{persona.nombre_completo}</Text>
          {bloqueo
            ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{bloqueo}</Text>
            : <Text style={ayuda}>{`DNI ${dniConPuntos(persona.dni)} · ya figura en el padrón`}</Text>}
        </View>
      ) : null}

      {sinPermisoAlta ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{TEXTO_SIN_PERMISO_ALTA}</Text>
      ) : null}

      {esAlta ? (
        <View style={tarjeta}>
          <Text accessibilityRole="header" style={titulo}>La persona no está en el padrón</Text>
          <Text style={ayuda}>Cargá sus datos para darla de alta. Todos son obligatorios.</Text>
          {textoAlta('nombre', 'Nombre')}
          {textoAlta('apellido', 'Apellido')}
          <View style={styles.campo}>
            <Text style={etiqueta}>Sexo *</Text>
            <View style={styles.opciones}>
              {SEXOS_INGRESO.map((s) => opcion(alta.sexo === s.valor, s.titulo, () => ponerAlta('sexo', s.valor), `Sexo: ${s.titulo}`))}
            </View>
            {mensajes(errorDe('sexo'), 'sexo')}
          </View>
          <View style={styles.campo}>
            <Text style={etiqueta}>Fecha de nacimiento *</Text>
            <FechaInput label="Fecha de nacimiento" value={alta.fecha_nacimiento} onSelect={(v) => ponerAlta('fecha_nacimiento', v)}
              required disabled={ocupado} mostrarRotulo={false} />
            {mensajes(errorDe('fecha_nacimiento'), 'fecha')}
          </View>
        </View>
      ) : null}

      {resultado && !bloqueo && !sinPermisoAlta ? (
        <CustomButton title="Continuar" size="L" iconRight="arrow-forward" loading={cargandoFormulario} disabled={ocupado} onPress={seguirDePersona} />
      ) : null}
    </>
  );

  // Archivos y firmas no se dibujan en este paso: el back ya omite los opcionales y avisa con `requiere_archivo`
  // si hay uno obligatorio; los manejadores vacíos son solo por la firma del componente.
  const renderCampo = (field) => (
    <View key={field.id}>
      <CampoFormulario field={field} value={valores[field.clave] ?? ''}
        onChange={(valor) => {
          setValores((prev) => ({ ...prev, [field.clave]: valor }));
          setClavesServidor((prev) => (prev[field.clave] ? { ...prev, [field.clave]: null } : prev));
        }}
        busqueda={busqueda[field.clave] || ''}
        onBuscar={(t) => setBusqueda((prev) => ({ ...prev, [field.clave]: t }))}
        renderFecha={(props) => <FechaInput {...props} mostrarRotulo={false} />}
        onAbrirArchivo={() => {}} onQuitarArchivo={() => {}} onVerArchivo={() => {}} onFirmar={() => {}} />
      {clavesServidor[field.clave] ? mensajes([clavesServidor[field.clave]], `clave:${field.clave}`) : null}
    </View>
  );
  const faltantes = intentadoForm && diseno ? problemasDelDiseno(diseno.campos, diseno.efectivas) : [];

  const vistaFormulario = !formulario ? null : formulario.requiereArchivo ? (
    <View style={tarjeta}>
      <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>Este ingreso se hace desde el backoffice.</Text>
    </View>
  ) : (
    <>
      {diseno ? diseno.grupos.map((grupo) => (
        <GrupoFormulario key={grupo.clave} group={grupo} renderCampo={renderCampo}
          onEnlaceFallido={() => showToast({ type: 'error', message: 'No se pudo abrir el enlace.' })} />
      )) : null}
      {faltantes.length ? (
        <View style={tarjeta}>
          <Text style={etiqueta}>Falta completar</Text>
          {mensajes(faltantes, 'falta')}
        </View>
      ) : null}
      <CustomButton title="Continuar" size="L" iconRight="arrow-forward" disabled={ocupado} onPress={seguirDeFormulario} />
    </>
  );

  const nombreResumen = persona?.nombre_completo || `${alta.nombre} ${alta.apellido}`.trim();
  const vistaConfirmar = (
    <>
      <View style={tarjeta}>
        <Text style={etiqueta}>Persona</Text>
        <Text style={ayuda}>{`${nombreResumen} · DNI ${dniConPuntos(persona?.dni ?? dni)}${persona ? '' : ' (alta nueva)'}`}</Text>
        <Text style={etiqueta}>Cama</Text>
        <Text style={ayuda}>{`${codigo}${nombreSector ? ` · ${nombreSector}` : ''}`}</Text>
      </View>
      <CustomButton title="Ingresar persona" size="L" iconLeft="log-in-outline" loading={enviando} disabled={ocupado} onPress={pedirConfirmacion} />
    </>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardDismissModeFor('on-drag')}>
      <View style={tarjeta}>
        <Text accessibilityRole="header" style={titulo}>Ingresar persona</Text>
        <Text style={ayuda}>{`Cama ${codigo}${nombreSector ? ` · ${nombreSector}` : ''}`}</Text>
      </View>
      {aviso ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.colors.danger, fontFamily: typography.semibold }]}>{aviso}</Text> : null}
      {cargandoFormulario ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Cargando el formulario de ingreso" /> : null}
      {paso === 'persona' ? vistaPersona : paso === 'formulario' ? vistaFormulario : vistaConfirmar}
      {paso !== 'persona' ? <CustomButton title="Volver" size="L" variant="secondary" disabled={ocupado} onPress={volverUnPaso} /> : null}
      <CustomButton title="Cancelar" size="L" variant="secondary" disabled={ocupado} onPress={() => onCancelar?.()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: 14, gap: 8 },
  campo: { gap: 6 },
  titulo: { fontSize: fontSizes.base },
  etiqueta: { fontSize: fontSizes.sm },
  ayuda: { fontSize: fontSizes.xs },
  error: { fontSize: fontSizes.xs },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSizes.sm },
});
