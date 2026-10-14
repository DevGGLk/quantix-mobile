import React, { useEffect, useMemo, useState } from 'react';
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
import { useTheme, type Palette } from '../theme';
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

/** YYYY-MM-DD en calendario local (evita desfases de `toISOString()`). */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lunes–domingo de la semana que contiene `ref`. */
function getCalendarWeekRangeYmd(ref: Date): { start: string; end: string } {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 domingo … 6 sábado
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatLocalYmd(monday), end: formatLocalYmd(sunday) };
}

/** `time` / fragmento ISO → "HH:mm" para la tarjeta. */
function formatShiftClock(t: string | null | undefined): string {
  if (t == null || String(t).trim() === '') return '—';
  const s = String(t).trim();
  if (s.includes('T')) return s.slice(11, 16);
  return s.slice(0, 5);
}

function pickEmbedded<T extends Record<string, unknown>>(raw: unknown): T | null {
  if (raw == null) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && typeof v === 'object' ? (v as T) : null;
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
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

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

        const { start: weekStart, end: weekEnd } = getCalendarWeekRangeYmd(new Date());

        let q = supabase
          .from('employee_shifts')
          .select(
            'id, assigned_date, is_day_off, shift_templates(name, start_time, end_time, category), branches(name)'
          )
          .eq('employee_id', employeeId)
          .gte('assigned_date', weekStart)
          .lte('assigned_date', weekEnd)
          .order('assigned_date', { ascending: true });

        const cid = employee?.company_id?.trim();
        if (cid) q = q.eq('company_id', cid);

        const { data, error } = await q;

        if (error) {
          throw error;
        }

        const todayYmd = formatLocalYmd(new Date());
        const mapped: Turno[] = (data ?? []).map((row: Record<string, unknown>) => {
          const assigned =
            typeof row.assigned_date === 'string' ? row.assigned_date.slice(0, 10) : '';
          const dateObj =
            assigned && /^\d{4}-\d{2}-\d{2}$/.test(assigned)
              ? new Date(`${assigned}T12:00:00`)
              : null;

          const tpl = pickEmbedded<{
            name?: string | null;
            start_time?: string | null;
            end_time?: string | null;
            category?: string | null;
          }>(row.shift_templates);

          const br = pickEmbedded<{ name?: string | null }>(row.branches);
          const branchName =
            br?.name != null && String(br.name).trim() !== ''
              ? String(br.name).trim()
              : 'Sucursal';

          const templateName = tpl?.name != null ? String(tpl.name).trim() : '';
          const category = tpl?.category != null ? String(tpl.category).trim() : '';
          const isDayOff = Boolean(row.is_day_off);
          const statusRaw = row.status != null ? String(row.status) : '';
          const status = mapScheduleStatus(statusRaw);

          const entrada = isDayOff
            ? 'Día Libre'
            : formatShiftClock(tpl?.start_time ?? null);
          const salida = isDayOff
            ? 'Día Libre'
            : formatShiftClock(tpl?.end_time ?? null);

          return {
            id: String(row.id ?? Math.random()),
            fecha: dateObj && !Number.isNaN(dateObj.getTime()) ? toSpanishDayLabel(dateObj) : 'Turno',
            entrada,
            salida,
            sucursal: branchName,
            area: category || templateName,
            estado: status.label,
            estadoRaw: statusRaw,
            isToday: assigned === todayYmd,
          };
        });

        if (isMounted) setTurnos(mapped);
      } catch (e) {
        console.error('Error cargando turnos en móvil:', e);
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
  }, [session?.user?.id, employee?.id, employee?.company_id]);

  const renderItem = ({ item }: { item: Turno }) => (
    <View style={[styles.card, item.isToday && styles.cardToday]}>
      <View style={styles.cardTop}>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={18} color={palette.brand.base} />
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
          <ActivityIndicator size="large" color={palette.brand.base} />
          <Text style={styles.loadingText}>Cargando...</Text>
        </View>
      ) : turnos.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-clear-outline" size={64} color={palette.text.tertiary} />
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingTop: 18,
      paddingHorizontal: 20,
      paddingBottom: 10,
    },
    title: {
      fontSize: 24,
      fontWeight: '800',
      color: c.text.primary,
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
      color: c.text.secondary,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingBottom: 24,
      gap: 12,
    },
    card: {
      backgroundColor: c.surface.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
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
    // Turno de hoy resaltado en índigo de marca.
    cardToday: {
      borderColor: c.brand.base,
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
      color: c.text.primary,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text.secondary,
    },
    statusChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: c.surface.sunken,
      borderWidth: 1,
      borderColor: c.border,
    },
    // Confirmado = verde/success.
    statusChipSuccess: {
      backgroundColor: c.semantic.success.surface,
      borderColor: c.semantic.success.color,
    },
    // Borrador = ámbar/warning.
    statusChipWarning: {
      backgroundColor: c.semantic.warning.surface,
      borderColor: c.semantic.warning.color,
    },
    statusTextSuccess: {
      color: c.semantic.success.text,
    },
    statusTextWarning: {
      color: c.semantic.warning.text,
    },
    cardBody: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: c.surface.sunken,
    },
    timeBlock: {
      flex: 1,
    },
    timeLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text.secondary,
    },
    timeValue: {
      marginTop: 6,
      fontSize: 20,
      fontWeight: '900',
      color: c.text.primary,
    },
    timeDivider: {
      width: 1,
      height: 44,
      backgroundColor: c.border,
      marginHorizontal: 12,
    },
    cardBottom: {
      marginTop: 12,
    },
    branchText: {
      fontSize: 14,
      fontWeight: '800',
      color: c.text.primary,
    },
    areaText: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: '600',
      color: c.text.secondary,
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
      color: c.text.primary,
      textAlign: 'center',
    },
    emptyText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.text.secondary,
      textAlign: 'center',
      lineHeight: 18,
    },
  });

