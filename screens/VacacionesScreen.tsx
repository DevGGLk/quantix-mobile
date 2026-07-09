import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { StackScreenNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type VacBalance = {
  vacation_balance: number;
  days_taken: number;
  days_programmed: number;
  last_accrual_date: string | null;
};

function fmtDias(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0) * 100) / 100;
  return v.toLocaleString('es-NI', { maximumFractionDigits: 2 });
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA" */
function fmtFecha(s: string | null | undefined): string {
  if (!s) return '—';
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
}

/** Antigüedad en años y meses desde hire_date hasta hoy. */
function antiguedad(hireDate: string | null | undefined): string {
  const m = hireDate ? String(hireDate).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return '—';
  const h = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  let months = (now.getFullYear() - h.getFullYear()) * 12 + (now.getMonth() - h.getMonth());
  if (now.getDate() < h.getDate()) months -= 1;
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const mo = months % 12;
  const partes: string[] = [];
  if (y > 0) partes.push(`${y} ${y === 1 ? 'año' : 'años'}`);
  partes.push(`${mo} ${mo === 1 ? 'mes' : 'meses'}`);
  return partes.join(' ');
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a.slice(0, 10)).getTime();
  const db = new Date(b.slice(0, 10)).getTime();
  return Math.round((db - da) / 86_400_000);
}

/**
 * Detalle de vacaciones del colaborador. El "saldo disponible" es el número
 * autoritativo del ledger (RPC get_employee_vacation_balance). Para personal
 * cargado con saldo histórico ese número ya netea los descansos previos; por eso
 * "Tomados/Programados" se rotulan como registrados en el sistema y, si el saldo
 * fue sembrado (importado), se muestra una nota aclaratoria.
 */
export default function VacacionesScreen() {
  const navigation = useNavigation<StackScreenNavigation>();
  const { employeeRecord } = useAuth();
  const [balance, setBalance] = useState<VacBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const empId = employeeRecord?.id ?? null;
  const hireDate =
    employeeRecord?.hire_date != null && String(employeeRecord.hire_date).trim() !== ''
      ? String(employeeRecord.hire_date).slice(0, 10)
      : null;

  const load = useCallback(async () => {
    if (!empId) {
      setBalance(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('get_employee_vacation_balance', {
      p_employee_id: empId,
    });
    if (!error && data) setBalance(data as VacBalance);
    else setBalance(null);
    setLoading(false);
  }, [empId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const seeded =
    !!balance?.last_accrual_date &&
    !!hireDate &&
    daysBetween(hireDate, balance.last_accrual_date) > 35;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {balance ? (
        <>
          {/* Tarjeta principal: saldo disponible */}
          <View style={styles.saldoCard}>
            <Ionicons name="airplane-outline" size={28} color="#ffffff" />
            <Text style={styles.saldoNumber}>{fmtDias(balance.vacation_balance)}</Text>
            <Text style={styles.saldoLabel}>días disponibles</Text>
          </View>

          {/* Movimientos */}
          <View style={styles.row}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Tomados{seeded ? '\n(en el sistema)' : ''}</Text>
              <Text style={styles.statValue}>{fmtDias(balance.days_taken)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Programados</Text>
              <Text style={styles.statValue}>{fmtDias(balance.days_programmed)}</Text>
            </View>
          </View>

          {/* Datos laborales */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Fecha de ingreso</Text>
              <Text style={styles.infoValue}>{fmtFecha(hireDate)}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Antigüedad</Text>
              <Text style={styles.infoValue}>{antiguedad(hireDate)}</Text>
            </View>
          </View>

          {seeded ? (
            <View style={styles.noteCard}>
              <Ionicons name="information-circle-outline" size={18} color="#92400e" />
              <Text style={styles.noteText}>
                Tu saldo inicial se cargó el {fmtFecha(balance.last_accrual_date)} y ya incluye las
                vacaciones que tomaste antes de usar el sistema. Los descansos se registran a partir de
                esa fecha.
              </Text>
            </View>
          ) : balance.last_accrual_date ? (
            <Text style={styles.updatedText}>
              Saldo actualizado al {fmtFecha(balance.last_accrual_date)}.
            </Text>
          ) : null}

          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('NuevaSolicitud')}
          >
            <Ionicons name="paper-plane-outline" size={20} color="#ffffff" />
            <Text style={styles.ctaText}>Solicitar vacaciones</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Ionicons name="airplane-outline" size={40} color="#94a3b8" />
          <Text style={styles.emptyText}>
            Aún no tienes un saldo de vacaciones registrado. Consulta con RRHH.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('NuevaSolicitud')}
          >
            <Ionicons name="paper-plane-outline" size={20} color="#ffffff" />
            <Text style={styles.ctaText}>Solicitar vacaciones</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background },
  saldoCard: {
    backgroundColor: theme.primary,
    borderRadius: 20,
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 16,
  },
  saldoNumber: { color: '#ffffff', fontSize: 46, fontWeight: '800', marginTop: 4 },
  saldoLabel: { color: '#ffffff', fontSize: 14, opacity: 0.9 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  statValue: { fontSize: 24, color: theme.textPrimary, fontWeight: '700', marginTop: 4 },
  infoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 14, color: '#64748b' },
  infoValue: { fontSize: 14, color: theme.textPrimary, fontWeight: '700' },
  infoDivider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 10 },
  noteCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  noteText: { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 17 },
  updatedText: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  ctaText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  emptyCard: { alignItems: 'center', paddingVertical: 40, gap: 14 },
  emptyText: { fontSize: 14, color: '#64748b', textAlign: 'center', paddingHorizontal: 20 },
});
