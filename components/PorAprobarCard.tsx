import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { contarPorAprobar } from '../lib/aprobaciones';

/** Inicio: aviso de solicitudes que te toca aprobar (jefes, RRHH, dueño). No ocupa lugar si no hay. */
export function PorAprobarCard() {
  const navigation = useNavigation<RootStackNavigation>();
  const [n, setN] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void contarPorAprobar().then((c) => {
        if (vivo) setN(c);
      });
      return () => {
        vivo = false;
      };
    }, []),
  );

  if (n === 0) return null;
  return (
    <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => navigation.navigate('PorAprobar')}>
      <View style={s.icono}>
        <Ionicons name="file-tray-full-outline" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.titulo}>{n === 1 ? 'Tienes 1 solicitud por aprobar' : `Tienes ${n} solicitudes por aprobar`}</Text>
        <Text style={s.sub}>Vacaciones, permisos, horas extra, adelantos o préstamos.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#B45309" />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 16,
    padding: 14,
  },
  icono: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 15, fontWeight: '800', color: '#78350F' },
  sub: { fontSize: 12, color: '#92400E', marginTop: 2 },
});
