import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type Turno = {
  id: string;
  fecha: string; // texto listo para UI (ej. "Miércoles 11")
  entrada: string; // "18:00"
  salida: string; // "02:00"
  sucursal: string;
  area: string;
  estado: string; // etiqueta para UI
  estadoRaw?: string; // valor crudo desde BD (enum)
  isToday?: boolean;
};

function toSpanishDayLabel(date: Date) {
  // e.g. "miércoles 11"
  const weekday = date.toLocaleDateString('es-ES', { weekday: 'long' });
  const day = date.getDate();
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalized} ${day}`;
}

function mapScheduleStatus(raw?: string | null) {
  const value = (raw ?? '').toLowerCase();
  switch (value) {
    case 'published':
      return { label: 'Confirmado', tone: 'success' as const };
    case 'draft':
      return { label: 'Borrador', tone: 'warning' as const };
    case 'archived':
      return { label: 'Archivado', tone: 'neutral' as const };
    default:
      // Si ya viene una etiqueta humana o un valor nuevo del enum, lo mostramos “bonito”.
      return { label: raw ? String(raw) : '—', tone: 'neutral' as const };
  }
}

export default function TurnosScreen() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { session, employee } = useAuth();

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      try {
        const employeeId = employee?.id ?? null;

        if (!employeeId) {
          if (isMounted) setTurnos([]);
          return;
        }

        const { data, error } = await supabase
          .from('employee_shifts')
          .select('*')
          .eq('employee_id', employeeId)
          .order('start_time', { ascending: true });

        if (error) {
          console.error('Error en tabla employee_shifts:', error);
          throw error;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayYmd = today.toISOString().slice(0, 10);
        const mapped: Turno[] = (data ?? []).map((row: Record<string, unknown>) => {
          const startRaw = row.start_time;
          let dateObj: Date | null = null;
          if (typeof startRaw === 'string' || startRaw instanceof Date) {
            const d = new Date(startRaw);
            if (!Number.isNaN(d.getTime())) dateObj = d;
          }
          const ymd = dateObj ? dateObj.toISOString().slice(0, 10) : '';
          const branchName = typeof row.branch_name === 'string' ? row.branch_name : 'Sucursal';
          const templateName = typeof row.shift_name === 'string' ? row.shift_name : '';
          const category = typeof row.shift_category === 'string' ? row.shift_category : '';
          const isDayOff = Boolean(row.is_day_off);
          const statusRaw = row.status != null ? String(row.status) : '';
          const status = mapScheduleStatus(statusRaw);

          const entrada = isDayOff ? '—' : dateObj ? dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—';
          const endRaw = row.end_time;
          let endObj: Date | null = null;
          if (typeof endRaw === 'string' || endRaw instanceof Date) {
            const e = new Date(endRaw);
            if (!Number.isNaN(e.getTime())) endObj = e;
          }
          const salida = isDayOff ? '—' : endObj ? endObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—';

          return {
            id: String(row.id ?? Math.random()),
            fecha: dateObj ? toSpanishDayLabel(dateObj) : 'Turno',
            entrada,
            salida,
            sucursal: branchName,
            area: category || templateName,
            estado: status.label,
            estadoRaw: statusRaw,
            isToday: ymd === todayYmd,
          };
        });

        if (isMounted) setTurnos(mapped);
      } catch (e) {
        console.error('Error general al cargar turnos:', e);
        if (isMounted) {
          setTurnos([]);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, employee?.id]);

  const renderItem = ({ item }: { item: Turno }) => (
    <View style={[styles.card, item.isToday && styles.cardToday]}>
      <View style={styles.cardTop}>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={18} color="#2563eb" />
          <Text style={styles.dateText}>{item.fecha}</Text>
        </View>
        <View
          style={[
            styles.statusChip,
            item.estadoRaw?.toLowerCase() === 'published' && styles.statusChipSuccess,
            item.estadoRaw?.toLowerCase() === 'draft' && styles.statusChipWarning,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              item.estadoRaw?.toLowerCase() === 'published' && styles.statusTextSuccess,
              item.estadoRaw?.toLowerCase() === 'draft' && styles.statusTextWarning,
            ]}
          >
            {item.estado}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Entrada</Text>
          <Text style={styles.timeValue}>{item.entrada}</Text>
        </View>
        <View style={styles.timeDivider} />
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Salida</Text>
          <Text style={styles.timeValue}>{item.salida}</Text>
        </View>
      </View>

      <View style={styles.cardBottom}>
        <Text style={styles.branchText}>{item.sucursal}</Text>
        {!!item.area && <Text style={styles.areaText}>{item.area}</Text>}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mi Horario de la Semana</Text>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Cargando...</Text>
        </View>
      ) : turnos.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-clear-outline" size={64} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No tienes turnos programados</Text>
          <Text style={styles.emptyText}>
            No tienes turnos programados en este momento. ¡Disfruta tu descanso!
          </Text>
        </View>
      ) : (
        <FlatList
          data={turnos}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  cardToday: {
    borderColor: theme.accent,
    borderWidth: 1.6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textSecondary,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: theme.border,
  },
  statusChipSuccess: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  statusChipWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  statusTextSuccess: {
    color: theme.accent,
  },
  statusTextWarning: {
    color: theme.warning,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  timeBlock: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textSecondary,
  },
  timeValue: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: '900',
    color: theme.textPrimary,
  },
  timeDivider: {
    width: 1,
    height: 44,
    backgroundColor: theme.border,
    marginHorizontal: 12,
  },
  cardBottom: {
    marginTop: 12,
  },
  branchText: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  areaText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '800',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});

