import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import { useTheme, type Palette } from '../theme';
import { useAuth } from '../lib/AuthContext';
import type { MainTabParamList } from '../types/navigation';

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

/** Suma días a un YYYY-MM-DD (al mediodía, para no cruzar de día por zona). */
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalYmd(d);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «10 – 16 nov» o «29 dic – 4 ene». */
function weekRangeLabel(startYmd: string): string {
  const a = new Date(`${startYmd}T12:00:00`);
  const b = new Date(`${addDaysYmd(startYmd, 6)}T12:00:00`);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${MESES[b.getMonth()]}`
    : `${a.getDate()} ${MESES[a.getMonth()]} – ${b.getDate()} ${MESES[b.getMonth()]}`;
}

/** `time` / fragmento ISO → "HH:mm" para la tarjeta. */
function formatShiftClock(t: string | null | undefined): string {
  if (t == null || String(t).trim() === '') return '—';
  const s = String(t).trim();
  if (s.includes('T')) return s.slice(11, 16);
  return s.slice(0, 5);
}

/**
 * Snapshot `schedules.start_time`/`end_time` (timestamptz) → "HH:mm" en
 * America/Managua. Es la hora congelada al asignar el turno: si RRHH edita la
 * plantilla después, el turno ya asignado no cambia. Nicaragua no tiene horario
 * de verano (UTC-6 fijo), así que no dependemos de Intl/timeZone en Hermes.
 */
function snapshotToManaguaClock(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  if (Number.isNaN(ms)) return null;
  const local = new Date(ms - 6 * 60 * 60 * 1000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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
  const route = useRoute<RouteProp<MainTabParamList, 'Turnos'>>();

  const currentWeekStart = getCalendarWeekRangeYmd(new Date()).start;
  const [weekStart, setWeekStart] = useState<string>(currentWeekStart);

  // El aviso «Tu horario ya está publicado» trae la semana publicada (casi
  // siempre la siguiente): se abre esa, no la actual.
  const weekStartParam = route.params?.weekStart;
  useEffect(() => {
    if (weekStartParam && /^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)) {
      setWeekStart(getCalendarWeekRangeYmd(new Date(`${weekStartParam}T12:00:00`)).start);
    }
  }, [weekStartParam]);

  // Recarga cada vez que se entra a la pestaña (p. ej. al tocar el aviso
  // «Tu horario ya está publicado»), no solo al montar.
  useFocusEffect(useCallback(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      try {
        const employeeId = employee?.id ?? null;

        if (!employeeId) {
          if (isMounted) setTurnos([]);
          return;
        }

        const weekEnd = addDaysYmd(weekStart, 6);

        // `schedules` es la tabla viva del planificador. `employee_shifts` es
        // legacy: nadie la escribe desde mayo 2026 y dejaba la pantalla vacía.
        let q = supabase
          .from('schedules')
          .select(
            'id, business_date, is_day_off, start_time, end_time, status, shift_templates(name, start_time, end_time, category, is_working_day), branches(name)'
          )
          .eq('employee_id', employeeId)
          // Solo lo publicado: los borradores del planificador aún no son horario.
          .eq('status', 'published')
          .gte('business_date', weekStart)
          .lte('business_date', weekEnd)
          .order('business_date', { ascending: true })
          .order('start_time', { ascending: true });

        const cid = employee?.company_id?.trim();
        if (cid) q = q.eq('company_id', cid);

        const { data, error } = await q;

        if (error) {
          throw error;
        }

        const todayYmd = formatLocalYmd(new Date());
        const mapped: Turno[] = (data ?? []).map((row: Record<string, unknown>) => {
          const assigned =
            typeof row.business_date === 'string' ? row.business_date.slice(0, 10) : '';
          const dateObj =
            assigned && /^\d{4}-\d{2}-\d{2}$/.test(assigned)
              ? new Date(`${assigned}T12:00:00`)
              : null;

          const tpl = pickEmbedded<{
            name?: string | null;
            start_time?: string | null;
            end_time?: string | null;
            category?: string | null;
            is_working_day?: boolean | null;
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

          // Estatus de RRHH (vacaciones, subsidio, permiso…) llegan como
          // plantilla no laborable: se muestra el nombre, no una hora.
          const noLaborable = !isDayOff && tpl?.is_working_day === false;
          const etiquetaSinHora = isDayOff ? 'Día Libre' : noLaborable ? templateName || 'Ausencia' : null;

          // Hora congelada del turno; la plantilla viva solo como respaldo legacy.
          const entrada =
            etiquetaSinHora ??
            (snapshotToManaguaClock(row.start_time as string | null) ?? formatShiftClock(tpl?.start_time ?? null));
          const salida =
            etiquetaSinHora ??
            (snapshotToManaguaClock(row.end_time as string | null) ?? formatShiftClock(tpl?.end_time ?? null));

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
  }, [session?.user?.id, employee?.id, employee?.company_id, weekStart]));

  const renderItem = ({ item }: { item: Turno }) => (
    <View style={[styles.card, item.isToday && styles.cardToday]}>
      <View style={styles.cardTop}>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={18} color={palette.brand.base} />
          <Text style={styles.dateText}>{item.fecha}</Text>
        </View>
        {/* Todo lo que llega aquí está publicado («Confirmado»). */}
        <View style={[styles.statusChip, styles.statusChipSuccess]}>
          <Text style={[styles.statusText, styles.statusTextSuccess]}>{item.estado}</Text>
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
        <View style={styles.weekNav}>
          <TouchableOpacity
            style={styles.weekArrow}
            onPress={() => setWeekStart((w) => addDaysYmd(w, -7))}
            accessibilityRole="button"
            accessibilityLabel="Semana anterior"
          >
            <Ionicons name="chevron-back" size={20} color={palette.text.primary} />
          </TouchableOpacity>
          <View style={styles.weekLabelWrap}>
            <Text style={styles.weekLabel}>{weekRangeLabel(weekStart)}</Text>
            {weekStart === currentWeekStart ? (
              <Text style={styles.weekHint}>Esta semana</Text>
            ) : weekStart === addDaysYmd(currentWeekStart, 7) ? (
              <Text style={styles.weekHint}>Próxima semana</Text>
            ) : (
              <TouchableOpacity onPress={() => setWeekStart(currentWeekStart)} accessibilityRole="button">
                <Text style={[styles.weekHint, styles.weekHintLink]}>Volver a esta semana</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.weekArrow}
            onPress={() => setWeekStart((w) => addDaysYmd(w, 7))}
            accessibilityRole="button"
            accessibilityLabel="Semana siguiente"
          >
            <Ionicons name="chevron-forward" size={20} color={palette.text.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={palette.brand.base} />
          <Text style={styles.loadingText}>Cargando...</Text>
        </View>
      ) : turnos.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-clear-outline" size={64} color={palette.text.tertiary} />
          <Text style={styles.emptyTitle}>No tienes turnos publicados</Text>
          <Text style={styles.emptyText}>
            No hay turnos publicados para esta semana. Si te toca trabajar, puede que tu jefe aún no
            publique el horario: te avisaremos cuando lo haga.
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
    weekNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderRadius: 14,
      backgroundColor: c.surface.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    weekArrow: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekLabelWrap: {
      alignItems: 'center',
    },
    weekLabel: {
      fontSize: 15,
      fontWeight: '800',
      color: c.text.primary,
    },
    weekHint: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: '600',
      color: c.text.secondary,
    },
    weekHintLink: {
      color: c.brand.base,
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

