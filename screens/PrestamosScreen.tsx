import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackScreenNavigation } from '../types/navigation';
import { theme } from '../lib/theme';
import {
  fetchMyLoanRequests,
  fetchMyActiveLoans,
  LOAN_STATUS_LABELS,
  loanStatusColor,
  fmtMoney,
  PERIOD_LABELS,
  type LoanRequestRow,
  type ActiveLoan,
} from '../lib/loansApi';

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PrestamosScreen() {
  const navigation = useNavigation<StackScreenNavigation>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<LoanRequestRow[]>([]);
  const [activeLoans, setActiveLoans] = useState<ActiveLoan[]>([]);

  const load = useCallback(async () => {
    const [reqRes, loanRes] = await Promise.all([fetchMyLoanRequests(), fetchMyActiveLoans()]);
    if (reqRes.ok) { setRequests(reqRes.requests); setError(null); }
    else setError(reqRes.error);
    if (loanRes.ok) setActiveLoans(loanRes.loans);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.primary}
          />
        }
      >
        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('SolicitarPrestamo')}
        >
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={styles.ctaText}>Solicitar préstamo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('MisPagos')}
        >
          <Ionicons name="receipt-outline" size={20} color={theme.primary} />
          <Text style={styles.secondaryText}>Mis pagos registrados</Text>
        </TouchableOpacity>

        {!loading && activeLoans.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.sectionTitle}>Préstamos activos</Text>
            {activeLoans.map((l) => (
              <TouchableOpacity
                key={l.id}
                style={styles.activeCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('RegistrarPago', { loan: l })}
              >
                <View style={styles.cardTop}>
                  <View>
                    <Text style={styles.activeLabel}>Saldo pendiente</Text>
                    <Text style={styles.amount}>C${fmtMoney(l.remaining_balance)}</Text>
                  </View>
                  <View style={styles.payCta}>
                    <Ionicons name="cash-outline" size={16} color="#fff" />
                    <Text style={styles.payCtaText}>Registrar pago</Text>
                  </View>
                </View>
                <Text style={styles.meta}>Cuota: C${fmtMoney(l.installment_amount)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!loading && requests.length > 0 && (
          <Text style={styles.sectionTitle}>Solicitudes</Text>
        )}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="cash-outline" size={40} color={theme.textMuted} />
            <Text style={styles.emptyText}>Aún no tienes solicitudes de préstamo.</Text>
            <Text style={styles.emptyHint}>
              Toca “Solicitar préstamo” para calcular y enviar tu solicitud.
            </Text>
          </View>
        ) : (
          requests.map((r) => {
            const c = loanStatusColor(r.status);
            const principal = r.proposed_principal ?? r.requested_principal;
            const term = r.proposed_term_periods ?? r.requested_term_periods;
            const period = r.proposed_period_type ?? r.requested_period_type;
            return (
              <TouchableOpacity
                key={r.id}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('PrestamoDetalle', { request: r })}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.amount}>C${fmtMoney(principal)}</Text>
                  <View style={[styles.badge, { backgroundColor: c.bg }]}>
                    <Text style={[styles.badgeText, { color: c.fg }]}>
                      {LOAN_STATUS_LABELS[r.status] ?? r.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {term} {PERIOD_LABELS[period]?.toLowerCase() ?? period} · solicitado {fmtDate(r.created_at)}
                </Text>
                {r.status === 'counter_offered' && (
                  <Text style={styles.counterHint}>
                    <Ionicons name="swap-horizontal-outline" size={12} color="#1E40AF" /> RRHH propuso nuevos
                    términos — toca para revisar.
                  </Text>
                )}
                {r.reason ? (
                  <Text style={styles.reason} numberOfLines={2}>
                    {r.reason}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}

        <Text style={styles.footnote}>
          Los montos, tasas y plazos son revisados por RRHH según tu antigüedad, estabilidad y capacidad de
          respaldo. Puedes recibir una contraoferta.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 20, gap: 14 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.primary, paddingVertical: 12,
  },
  secondaryText: { color: theme.primary, fontSize: 14, fontWeight: '700' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: theme.textPrimary, marginTop: 6 },
  activeCard: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 6 },
  activeLabel: { fontSize: 11, color: theme.textMuted, fontWeight: '600' },
  payCta: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: theme.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  payCtaText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  center: { paddingVertical: 48, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 14,
  },
  errorText: { flex: 1, color: '#991B1B', fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { color: theme.textSecondary, fontSize: 15, fontWeight: '700', marginTop: 6 },
  emptyHint: { color: theme.textMuted, fontSize: 13, textAlign: 'center' },
  card: {
    backgroundColor: theme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 20, fontWeight: '800', color: theme.textPrimary },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, color: theme.textMuted },
  counterHint: { fontSize: 12, color: '#1E40AF', fontWeight: '600', marginTop: 2 },
  reason: { fontSize: 13, color: theme.textSecondary, marginTop: 2 },
  footnote: { fontSize: 11, color: theme.textMuted, marginTop: 8, lineHeight: 16 },
});
