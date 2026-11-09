import React, { useCallback, useMemo, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useTheme, type Palette } from '../theme';
import { cargarTareasPendientes, fechaYmd, type Tarea } from '../lib/desempeno';
import type { RootStackNavigation } from '../types/navigation';

/** Inicio: evaluaciones de desempeño por hacer (propia, del equipo o de un compañero). */
export function DesempenoPendienteCard() {
  const navigation = useNavigation<RootStackNavigation>();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [tareas, setTareas] = useState<Tarea[]>([]);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      cargarTareasPendientes()
        .then((t) => {
          if (vivo) setTareas(t);
        })
        .catch(() => {
          // Sin tareas visibles: la pantalla Mi desempeño muestra el error.
        });
      return () => {
        vivo = false;
      };
    }, []),
  );

  if (tareas.length === 0) return null;
  const vence = tareas.map((t) => t.vence).filter(Boolean).sort()[0];
  const titulo =
    tareas.length === 1
      ? tareas[0].relation === 'self'
        ? 'Tu autoevaluación de desempeño'
        : 'Tienes una evaluación de desempeño por hacer'
      : `Tienes ${tareas.length} evaluaciones de desempeño por hacer`;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('Desempeno')}
      accessibilityRole="button"
      accessibilityLabel={titulo}
    >
      <Ionicons name="ribbon-outline" size={26} color={palette.brandAccent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {tareas[0].cycle.name}
          {vence ? ` · vence ${fechaYmd(vence)}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={palette.text.secondary} />
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.surface.card,
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.brandAccent,
    },
    titulo: { fontSize: 15, fontWeight: '700', color: c.text.primary },
    sub: { fontSize: 13, color: c.text.secondary },
  });
