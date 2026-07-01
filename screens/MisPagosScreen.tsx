import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../lib/theme';
import {
  fetchMyLoanPayments,
  signLoanPaymentFileUrl,
  fmtMoney,
  PAYMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  SUBMISSION_STATUS_LABELS,
  submissionStatusColor,
  type LoanPaymentSubmission,
} from '../lib/loansApi';

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function MisPagosScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LoanPaymentSubmission[]>([]);

  const load = useCallback(async () => {
    const res = await fetchMyLoanPayments();
    if (res.ok) { setItems(res.submissions); setError(null); }
    else setError(res.error);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function openFile(id: string, kind: 'comprobante' | 'recibo') {
    const res = await signLoanPaymentFileUrl(id, kind);
    if (res.ok) {
      const ok = await Linking.canOpenURL(res.signedUrl);
      if (ok) void Linking.openURL(res.signedUrl);
      else Alert.alert('No se pudo abrir', 'El enlace no es válido.');
    } else {
      Alert.alert('No disponible', res.error);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={theme.primary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={40} color={theme.textMuted} />
            <Text style={styles.emptyText}>Aún no has registrado pagos.</Text>
            <Text style={styles.emptyHint}>Desde un préstamo activo puedes registrar un abono o liquidación.</Text>
          </View>
        ) : (
          items.map((s) => {
            const c = submissionStatusColor(s.status);
            return (
              <View key={s.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.amount}>C${fmtMoney(s.amount_total)}</Text>
                  <View style={[styles.badge, { backgroundColor: c.bg }]}>
                    <Text style={[styles.badgeText, { color: c.fg }]}>{SUBMISSION_STATUS_LABELS[s.status] ?? s.status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {PAYMENT_TYPE_LABELS[s.payment_type] ?? s.payment_type} · {PAYMENT_METHOD_LABELS[s.method] ?? s.method} · {fmtDate(s.payment_date)}
                </Text>
                {s.status === 'rejected' && s.rejection_reason ? (
                  <Text style={styles.rejected}>Rechazado: {s.rejection_reason}</Text>
                ) : null}
                {s.status === 'pending' ? (
                  <Text style={styles.pendingHint}>En revisión por Contabilidad. No afecta tu saldo todavía.</Text>
                ) : null}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.linkBtn} onPress={() => void openFile(s.id, 'comprobante')}>
                    <Ionicons name="document-attach-outline" size={16} color={theme.primary} />
                    <Text style={styles.linkText}>Comprobante</Text>
                  </TouchableOpacity>
                  {s.status === 'confirmed' && s.receipt_pdf_url ? (
                    <TouchableOpacity style={styles.linkBtn} onPress={() => void openFile(s.id, 'recibo')}>
                      <Ionicons name="receipt-outline" size={16} color="#065F46" />
                      <Text style={[styles.linkText, { color: '#065F46' }]}>Recibo</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 16, gap: 12 },
  center: { paddingVertical: 48, alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEE2E2', borderRadius: 12, padding: 14 },
  errorText: { flex: 1, color: '#991B1B', fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyText: { color: theme.textSecondary, fontSize: 15, fontWeight: '700', marginTop: 6 },
  emptyHint: { color: theme.textMuted, fontSize: 13, textAlign: 'center' },
  card: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 20, fontWeight: '800', color: theme.textPrimary },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, color: theme.textMuted },
  rejected: { fontSize: 12, color: '#991B1B', fontWeight: '600' },
  pendingHint: { fontSize: 12, color: '#92400E', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 16, marginTop: 4 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  linkText: { fontSize: 13, fontWeight: '700', color: theme.primary },
});
