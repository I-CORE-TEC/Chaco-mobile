import React from 'react';
import { View, Text, StyleSheet, Pressable, Switch, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import CustomButton from '../components/CustomButton';
import AvisosContador from '../components/AvisosContador';
import usePermisos from '../hooks/usePermisos';
import { ETIQUETAS_ESTADO, ayudaBloqueado, abrirAjustes } from '../services/permisos';
import { NOMBRE_MODULO } from '../services/modulos';
import { designColors, fontSizes, gradients, radii } from '../theme';

const FILAS_PERMISO = [
    { clave: 'ubicacion', titulo: 'Ubicación (GPS)', icono: 'location-outline' },
    { clave: 'camara', titulo: 'Cámara', icono: 'camera-outline' },
];

// Pestaña «Cuenta» de la barra inferior (reemplaza al panel lateral): perfil, modo oscuro, avisos,
// cambio de módulo, permisos y cerrar sesión. Solo se monta con la pestaña abierta.
export default function CuentaScreen({ onLogout, onOpenAvisos, avisosNoLeidos = 0, onCambiarModulo }) {
    const { theme, isDark, toggleTheme, typography } = useTheme();
    const { user, moduloActivo } = useAuth();
    const { permisos, pidiendo, pedir } = usePermisos(true);
    const displayName = user?.nombre || user?.username || 'Usuario';
    const initials = displayName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'U';
    const roleLabel = NOMBRE_MODULO[moduloActivo] || user?.grupos?.[0]?.nombre || (user?.es_admin ? 'Administrador' : 'Usuario');

    return (
        <View style={[styles.pantalla, { backgroundColor: theme.colors.background }]}>
            <ScrollView style={styles.menuContent} contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <LinearGradient
                        colors={gradients.buttonPrimary}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.avatar}
                    >
                        <Text style={[styles.avatarText, { fontFamily: typography.bold }]}>{initials}</Text>
                    </LinearGradient>
                    <View style={styles.userInfo}>
                        <Text style={[styles.userName, { color: theme.colors.text, fontFamily: typography.bold }]}>{displayName}</Text>
                        <Text style={[styles.userRole, { color: theme.colors.textSoft, fontFamily: typography.regular }]}>{roleLabel}</Text>
                    </View>
                </View>

                <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />

                <View style={[styles.menuItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <View style={styles.menuLabel}>
                        <Ionicons name={isDark ? "moon" : "sunny"} size={22} color={theme.colors.icon} />
                        <Text style={[styles.menuText, { color: theme.colors.text, fontFamily: typography.medium }]}>Modo Oscuro</Text>
                    </View>
                    <Switch
                        value={!!isDark}
                        onValueChange={toggleTheme}
                        trackColor={{ false: '#D1D5DB', true: '#4B5563' }}
                        thumbColor={isDark ? theme.colors.secondary : theme.colors.primary}
                        ios_backgroundColor="#D1D5DB"
                    />
                </View>

                {onOpenAvisos && (
                    <Pressable
                        onPress={onOpenAvisos}
                        accessibilityRole="button"
                        accessibilityLabel="Notificaciones"
                        style={[styles.menuItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                    >
                        <View style={styles.menuLabel}>
                            <Ionicons name="notifications-outline" size={22} color={theme.colors.icon} />
                            <Text style={[styles.menuText, { color: theme.colors.text, fontFamily: typography.medium }]}>Notificaciones</Text>
                        </View>
                        <AvisosContador cantidad={avisosNoLeidos} />
                    </Pressable>
                )}

                {onCambiarModulo && (
                    <Pressable onPress={onCambiarModulo} style={[styles.menuItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                        <View style={styles.menuLabel}>
                            <Ionicons name="swap-horizontal-outline" size={22} color={theme.colors.icon} />
                            <Text style={[styles.menuText, { color: theme.colors.text, fontFamily: typography.medium }]}>Cambiar de módulo</Text>
                        </View>
                    </Pressable>
                )}

                <Text style={[styles.sectionTitle, { color: theme.colors.textSoft, fontFamily: typography.medium }]}>Permisos</Text>
                {FILAS_PERMISO.map(({ clave, titulo, icono }) => {
                    const { estado, canAskAgain } = permisos[clave];
                    const esWeb = Platform.OS === 'web';
                    const bloqueado = estado === 'denied' && !canAskAgain;
                    const colorEstado = estado === 'granted' ? theme.colors.success
                        : estado === 'denied' ? theme.colors.danger : theme.colors.textSoft;
                    return (
                        <View key={clave} style={[styles.permisoItem, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                            <View style={styles.permisoFila}>
                                <View style={styles.permisoTitulo}>
                                    <Ionicons name={icono} size={22} color={theme.colors.icon} />
                                    <View style={styles.permisoTextos}>
                                        <Text style={[styles.menuText, { color: theme.colors.text, fontFamily: typography.medium }]}>{titulo}</Text>
                                        <Text style={[styles.permisoEstado, { color: colorEstado, fontFamily: typography.regular }]}>{ETIQUETAS_ESTADO[estado]}</Text>
                                    </View>
                                </View>
                                {estado !== 'granted' && !(esWeb && bloqueado) ? (
                                    <CustomButton
                                        title={pidiendo[clave] ? 'Pidiendo…' : (bloqueado ? 'Abrir ajustes' : 'Permitir')}
                                        size="SM"
                                        disabled={!!pidiendo[clave]}
                                        onPress={bloqueado ? abrirAjustes : () => pedir(clave)}
                                    />
                                ) : null}
                            </View>
                            {esWeb && bloqueado ? (
                                <Text style={[styles.permisoAyuda, { color: theme.colors.textSoft, fontFamily: typography.regular }]}>{ayudaBloqueado(clave)}</Text>
                            ) : null}
                        </View>
                    );
                })}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                <CustomButton
                    title="Cerrar Sesión"
                    onPress={onLogout}
                    iconLeft="log-out-outline"
                    size="L"
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    pantalla: {
        flex: 1,
    },
    contenido: {
        padding: 20,
        paddingBottom: 28,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    avatar: {
        width: 60,
        height: 60,
        borderRadius: radii.lg,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        color: designColors.white,
        fontSize: fontSizes.xl,
    },
    userInfo: {
        marginLeft: 16,
    },
    userName: {
        fontSize: fontSizes.lg,
    },
    userRole: {
        fontSize: fontSizes.sm,
    },
    divider: {
        height: 1,
        marginBottom: 20,
    },
    menuContent: {
        flex: 1,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 58,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: radii.xl,
        borderWidth: 1,
        marginBottom: 10,
    },
    menuLabel: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    menuText: {
        fontSize: fontSizes.base,
        marginLeft: 12,
    },
    sectionTitle: {
        fontSize: fontSizes.sm,
        marginTop: 10,
        marginBottom: 10,
    },
    permisoItem: {
        padding: 12,
        borderRadius: radii.xl,
        borderWidth: 1,
        marginBottom: 10,
    },
    permisoFila: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    permisoTitulo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    permisoTextos: {
        flex: 1,
    },
    permisoEstado: {
        fontSize: fontSizes.xs,
        marginLeft: 12,
    },
    permisoAyuda: {
        fontSize: fontSizes.xs,
        marginTop: 8,
    },
    footer: {
        padding: 16,
        borderTopWidth: 1,
    },
});
