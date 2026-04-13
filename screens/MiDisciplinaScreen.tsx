import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type InfractionRow = {
  id: string;
  date_committed?: string | null;
  infraction_date?: string | null;
  infraction_type?: string | null;
  description?: string | null;
  financial_penalty?: number | string | null;
};

function formatInfractionDate(row: InfractionRow): string {
  const raw = (row.date_committed ?? row.infraction_date ?? '').toString().trim();
  if (!raw) return '—';
  const d = new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

function penaltyNumber(row: InfractionRow): number {
  const v = row.financial_penalty;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v != null && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export default function MiDisciplinaScreen() {
  const insets = useSafeAreaInsets();
  const { employee } = useAuth();
  const [rows, setRows] = useState<InfractionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payrollVisible, setPayrollVisible] = useState(false);

  const load = useCallback(async () => {
    const empId = employee?.id ?? null;
    const companyId = employee?.company_id ?? null;
    if (!empId || !companyId) {
      setRows([]);
      setPayrollVisible(false);
      return;
    }

    const [infRes, settingsRes] = await Promise.all([
      supabase
        .from('employee_infractions')
        .select('id, date_committed, infraction_date, infraction_type, description, financial_penalty')
        .eq('employee_id', empId)
        .order('infraction_date', { ascending: false }),
      supabase.from('company_settings').select('enable_payroll_view').eq('company_id', companyId).maybeSingle(),
    ]);

    if (infRes.error) {
      console.error('MiDisciplina employee_infractions:', infRes.error);
      Alert.alert('Error', infRes.error.message || 'No se pudo cargar tu historial.');
      setRows([]);
    } else {
      setRows((infRes.data as InfractionRow[]) ?? []);
    }

    const s = settingsRes.data as { enable_payroll_view?: boolean | null } | null;
    setPayrollVisible(s?.enable_payroll_view === true);
  }, [employee?.id, employee?.company_id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const renderItem = useCallback(
    ({ item }: { item: InfractionRow }) => {
      const tipo = (item.infraction_type ?? '').trim() || 'Registro disciplinario';
      const desc = (item.description ?? '').trim();
      const pen = penaltyNumber(item);
      const showMoney = pen > 0 && payrollVisible;

      return (
        <View style={styles.card}>
          <Text style={styles.cardDate}>{formatInfractionDate(item)}</Text>
          <Text style={styles.cardType}>{tipo}</Text>
          {desc ? (
            <Text style={styles.cardDesc} numberOfLines={6}>
              {desc}
            </Text>
          ) : null}
          {pen > 0 && !payrollVisible ? (
            <Text style={styles.privacyNote}>
              Incluye sanción económica; el monto no se muestra por la política de privacidad de nómina de tu empresa.
            </Text>
          ) : null}
          {showMoney ? (
            <Text style={styles.penalty}>-C$ {pen.toLocaleString()}</Text>
          ) : null}
        </View>
      );
    },
    [payrollVisible]
  );

  const empId = employee?.id ?? null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>Mi historial disciplinario</Text>
        <Text style={styles.subtitle}>
          Llamados de atención y faltas registradas a tu nombre. Los montos económicos solo se muestran si tu empresa
          permite ver nómina en la app.
        </Text>
      </View>
      {!empId ? (
        <View style={styles.centered}>
          <Text style={styles.empty}>No hay expediente de empleado para mostrar historial.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.hint}>Cargando…</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No tienes registros disciplinarios en el sistema.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
    }),
  },
  cardDate: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardType: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },
  privacyNote: {
    marginTop: 10,
    fontSize: 12,
    color: theme.textMuted,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  penalty: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '800',
    color: theme.danger,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  hint: {
    marginTop: 12,
    fontSize: 14,
    color: theme.textSecondary,
  },
  empty: {
    fontSize: 15,
    color: theme.textSecondary,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
