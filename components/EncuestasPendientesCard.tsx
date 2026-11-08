import React, { useCallback, useMemo, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useTheme, type Palette } from '../theme';
import { cargarPendientes, cierreCorto, type EncuestaPendiente } from '../lib/encuestas';
import type { RootStackNavigation } from '../types/navigation';

/** Inicio: aviso de encuestas pendientes. No ocupa lugar si no hay. */
export function EncuestasPendientesCard({ companyId }: { companyId: string | null | undefined }) {
  const navigation = useNavigation<RootStackNavigation>();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [pendientes, setPendientes] = useState<EncuestaPendiente[]>([]);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      cargarPendientes(companyId)
        .then((p) => {
          if (vivo) setPendientes(p);
        })
        .catch(() => {
          // Sin encuestas visibles: no se muestra nada (la pantalla Encuestas muestra el error).
        });
      return () => {
        vivo = false;
      };
    }, [companyId]),
  );

  if (pendientes.length === 0) return null;
  const primera = pendientes[0];
  const titulo =
    pendientes.length > 1
      ? `Tienes ${pendientes.length} encuestas pendientes`
      : primera.survey_type === 'evaluacion_360'
        ? 'Evaluación 360 abierta'
        : 'Tienes una encuesta pendiente';

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('Encuestas', pendientes.length === 1 ? { surveyId: primera.id } : undefined)}
      accessibilityRole="button"
      accessibilityLabel={titulo}
    >
      <Ionicons name="clipboard-outline" size={26} color={palette.semantic.warning.color} />
      <View style={{ flex: 1 }}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {pendientes.length === 1 ? primera.title : 'Toca para responder'}
          {pendientes.length === 1 && primera.survey_type !== 'evaluacion_360' ? ' · Anónima' : ''}
          {pendientes.length === 1 && primera.closes_at ? ` · Cierra ${cierreCorto(primera.closes_at)}` : ''}
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
      backgroundColor: c.semantic.warning.surface,
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    titulo: { fontSize: 15, fontWeight: '700', color: c.semantic.warning.text },
    sub: { fontSize: 13, color: c.text.secondary },
  });
