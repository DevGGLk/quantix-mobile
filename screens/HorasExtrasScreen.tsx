import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type ExtraHoursRecord = {
  id: string;
  record_date: string;
  hours_reported?: number | null;
  hours_performed?: number | null;
  hours_worked?: number | null;
  hours_realizadas?: number | null;
  hours_approved?: number | null;
  horas_autorizadas?: number | null;
  status?: string | null;
  [key: string]: unknown;
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getStatusStyle(status: string | null | undefined) {
  const s = (status ?? '').toLowerCase();
  if (s === 'approved') {
    return { bg: theme.background, text: theme.accent };
  }
  if (s === 'rejected') {
    return { bg: theme.background, text: theme.danger };
  }
  return { bg: theme.background, text: theme.warning };
}

function getStatusLabel(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'approved') return 'Aprobado';
  if (s === 'rejected') return 'Rechazado';
  return 'Pendiente';
}

function RecordCard({ item }: { item: ExtraHoursRecord }) {
  const realizadas =
    item.hours_reported ??
    item.hours_performed ??
    item.hours_worked ??
    item.hours_realizadas ??
    0;
  const autorizadas =
    item.hours_approved ?? item.horas_autorizadas ?? 0;
  const status = item.status ?? 'pending';
  const statusStyle = getStatusStyle(status);
  const statusLabel = getStatusLabel(status);

  return (
    <View style={styles.card}>
      <Text style={styles.date}>{formatDate(item.record_date)}</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Horas Realizadas</Text>
        <Text style={styles.valueGray}>{Number(realizadas).toFixed(1)} h</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Horas Autorizadas</Text>
        <Text style={styles.valueBold}>{Number(autorizadas).toFixed(1)} h</Text>
      </View>
      <View style={styles.pillWrap}>
        <View style={[styles.pill, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.pillText, { color: statusStyle.text }]}>
            {statusLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function HorasExtrasScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootStackNavigation>();
  const { employee } = useAuth();
  const [records, setRecords] = useState<ExtraHoursRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const goToReporte = useCallback(() => {
    navigation.navigate('ReporteHorasExtras');
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);

        const employeeRowId = employee?.id ?? null;
        if (!employeeRowId) {
          if (isMounted) setRecords([]);
          return;
        }

        const { data, error } = await supabase
          .from('extra_hours_records')
          .select('*')
          .eq('employee_id', employeeRowId)
          .order('record_date', { ascending: false });

        if (error) throw error;

        if (isMounted) {
          setRecords((data as ExtraHoursRecord[]) ?? []);
        }
      } catch (e) {
        console.error('Error al cargar horas extras:', e);
        if (isMounted) {
          setRecords([]);
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
  }, [employee?.id]);

  const isEmpty = !isLoading && records.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {isLoading && (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="small" color={theme.primary} />
          <Text style={styles.loaderText}>Cargando registros...</Text>
        </View>
      )}

      {!isLoading && isEmpty && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            No tienes horas extras registradas aún. Si realizaste horas adicionales, envía un
            reporte para que RRHH las registre.
          </Text>
          <TouchableOpacity
            style={styles.primaryCta}
            onPress={goToReporte}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Ir a reportar horas extras"
          >
            <Text style={styles.primaryCtaText}>Reportar horas extras</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && !isEmpty && (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RecordCard item={item} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.footerCta}
              onPress={goToReporte}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Registrar nuevas horas extras"
            >
              <Text style={styles.footerCtaText}>+ Registrar nuevas horas extras</Text>
            </TouchableOpacity>
          }
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
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: theme.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  primaryCta: {
    backgroundColor: theme.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignSelf: 'stretch',
    marginHorizontal: 8,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.accent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  primaryCtaText: {
    color: theme.backgroundAlt,
    fontSize: 16,
    fontWeight: '700',
  },
  footerCta: {
    marginTop: 8,
    marginBottom: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  footerCtaText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.accent,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  date: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  valueGray: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  valueBold: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  pillWrap: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
