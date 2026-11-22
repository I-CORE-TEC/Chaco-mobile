import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import useTecladoAbierto from '../hooks/useTecladoAbierto';
import { designColors, fontSizes, radii } from '../theme';
import AvisosContador from './AvisosContador';

// Alto mínimo de cada entrada: objetivo táctil de al menos 44 px.
export const ALTO_ENTRADA = 56;

// Barra inferior fija de todos los módulos. Va en el flujo (debajo del contenido, no encima), con el
// área segura de abajo; se esconde con el teclado abierto.
// `items`: [{ id, label, icon, activeIcon, punto?, cantidad? }] — `punto` marca algo pendiente y
// `cantidad` es el globo de avisos sin leer.
export default function BottomNav({ items, activeTab, onTabPress }) {
    const { typography, isDark, theme } = useTheme();
    const insets = useSafeAreaInsets();
    const tecladoAbierto = useTecladoAbierto();
    if (tecladoAbierto) return null;

    const activo = isDark ? theme.colors.secondary : theme.colors.primary;
    const inactivo = theme.colors.textSoft;

    return (
        <View
            accessibilityRole="tablist"
            style={[
                styles.barra,
                { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, paddingBottom: insets?.bottom || 0 },
            ]}
        >
            {items.map((item) => {
                const seleccionada = activeTab === item.id;
                const color = seleccionada ? activo : inactivo;
                const cantidad = item.cantidad > 0 ? item.cantidad : 0;
                return (
                    <Pressable
                        key={item.id}
                        onPress={() => onTabPress(item.id)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: seleccionada }}
                        accessibilityLabel={cantidad ? `${item.label}, ${cantidad} avisos sin leer` : item.label}
                        style={({ pressed }) => [styles.entrada, pressed && styles.presionada]}
                    >
                        <View style={styles.icono}>
                            <Ionicons name={seleccionada ? item.activeIcon : item.icon} size={24} color={color} />
                            {item.punto ? <View style={styles.punto} /> : null}
                            <AvisosContador cantidad={cantidad} style={styles.avisos} />
                        </View>
                        <Text
                            numberOfLines={1}
                            style={[styles.etiqueta, { color, fontFamily: seleccionada ? typography.bold : typography.medium }]}
                        >
                            {item.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    barra: {
        flexDirection: 'row',
        borderTopWidth: 1,
    },
    entrada: {
        flex: 1,
        minHeight: ALTO_ENTRADA,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 2,
    },
    presionada: {
        opacity: 0.7,
    },
    icono: {
        position: 'relative',
    },
    punto: {
        position: 'absolute',
        top: -2,
        right: -4,
        width: 10,
        height: 10,
        borderRadius: radii.full,
        backgroundColor: designColors.danger,
    },
    avisos: {
        position: 'absolute',
        top: -8,
        right: -16,
    },
    etiqueta: {
        marginTop: 2,
        fontSize: fontSizes.xs,
        lineHeight: 14,
        textAlign: 'center',
    },
});
