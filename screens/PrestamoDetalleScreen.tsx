import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList, StackScreenNavigation } from '../types/navigation';
import { theme } from '../lib/theme';
import {
  acceptCounterOffer,
  withdrawLoanRequest,
  fmtMoney,
  PERIOD_LABELS,
  LOAN_STATUS_LABELS,
  loanStatusColor,
} from '../lib/loansApi';
import { generateAmortizationSchedule, type PeriodType } from '../lib/loans/amortization';

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PrestamoDetalleScreen() {
  const navigation = useNavigation<StackScreenNavigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'PrestamoDetalle'>>();
  const { request } = route.params;
  const [busy, setBusy] = useState(false);

  const isCounter = request.status === 'counter_offered';
  const canWithdraw = request.status === 'pending' || request.status === 'counter_offered';

  // Términos vigentes (propuestos si hay contraoferta, sino los solicitados)
  const principal = request.proposed_principal ?? request.requested_principal;
  const term = request.proposed_term_periods ?? request.requested_term_periods;
  const period = (request.proposed_period_type ?? request.requested_period_type) as PeriodType;
  const rateMonthly = request.proposed_rate_snapshot ?? request.snapshot_rate_monthly;
  const annualRate = rateMonthly * 12;

  const schedule = useMemo(() => {
    if (!(principal > 0) || !(term > 0)) return null;
    return generateAmortizationSchedule({
      principal,
      annualInterestRate: annualRate,
      termPeriods: term,
      periodType: period,
      method: 'declining_balance',
      startDate: new Date().toISOString().slice(0, 10),
    });
  }, [principal, term, period, annualRate]);

  const c = loanStatusColor(request.status);
  const expired = request.expires_at != null && new Date(request.expires_at) < new Date();

  const doAccept = async () => {
    setBusy(true);
    const res = await acceptCounterOffer(request.id);
    setBusy(false);
    if (res.ok) {
      Alert.alert('Contraoferta aceptada', 'RRHH finalizará la aprobación de tu préstamo.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } else {
      Alert.alert('No se pudo aceptar', res.error);
    }
  };

  const doWithdraw = () => {
    Alert.alert('Retirar solicitud', '¿Seguro que deseas retirar esta solicitud?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Retirar',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const res = await withdrawLoanRequest(request.id);
          setBusy(false);
          if (res.ok) {
            Alert.alert('Solicitud retirada', '', [{ text: 'OK', onPress: () => navigation.goBack() }]);
          } else {
            Alert.alert('No se pudo retirar', res.error);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.headerCard}>
        <Text style={styles.amount}>C${fmtMoney(principal)}</Text>
        <View style={[styles.badge, { backgroundColor: c.bg }]}>
          <Text style={[styles.badgeText, { color: c.fg }]}>{LOAN_STATUS_LABELS[request.status] ?? request.status}</Text>
        </View>
      </View>

      {isCounter && (
        <View style={styles.counterBanner}>
          <Ionicons name="swap-horizontal-outline" size={18} color="#1E40AF" />
          <Text style={styles.counterText}>
            RRHH propuso estos términos {expired ? '(la contraoferta venció)' : ''}. Revisa y acepta para
            continuar.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Términos {isCounter ? 'propuestos' : 'solicitados'}</Text>
        <Row label="Monto" value={`C$${fmtMoney(principal)}`} />
        <Row label="Plazo" value={`${term} ${PERIOD_LABELS[period]?.toLowerCase() ?? period}`} />
        <Row label="Frecuencia" value={PERIOD_LABELS[period] ?? period} />
        <Row label="Tasa mensual" value={`${rateMonthly.toFixed(2)}%`} />
        <Row label="Tasa anual nominal" value={`${annualRate.toFixed(2)}%`} />
        {schedule && <Row label="Cuota" value={`C$${fmtMoney(schedule.installments[0]?.total ?? 0)}`} />}
        {schedule && <Row label="Total a pagar" value={`C$${fmtMoney(schedule.totals.total)}`} />}
        {schedule && <Row label="Total intereses" value={`C$${fmtMoney(schedule.totals.interest)}`} />}
      </View>

      {isCounter && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tu solicitud original</Text>
          <Row label="Monto" value={`C$${fmtMoney(request.requested_principal)}`} />
          <Row
            label="Plazo"
            value={`${request.requested_term_periods} ${
              PERIOD_LABELS[request.requested_period_type]?.toLowerCase() ?? request.requested_period_type
            }`}
          />
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Detalles</Text>
        <Row label="Solicitado" value={fmtDate(request.created_at)} />
        {request.reason ? <Row label="Motivo" value={request.reason} multiline /> : null}
        {request.decision_reason ? <Row label="Nota de RRHH" value={request.decision_reason} multiline /> : null}
        {request.expires_at ? <Row label="Vence" value={fmtDate(request.expires_at)} /> : null}
      </View>

      {isCounter && !expired && (
        <TouchableOpacity style={[styles.btn, styles.accept]} disabled={busy} onPress={doAccept}>
          <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
          <Text style={styles.btnText}>{busy ? 'Procesando…' : 'Aceptar contraoferta'}</Text>
        </TouchableOpacity>
      )}

      {canWithdraw && (
        <TouchableOpacity style={[styles.btn, styles.withdraw]} disabled={busy} onPress={doWithdraw}>
          <Ionicons name="close-circle-outline" size={20} color={theme.danger} />
          <Text style={[styles.btnText, { color: theme.danger }]}>Retirar solicitud</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.footnote}>
        La calculadora muestra una estimación con amortización de saldo decreciente. Los valores definitivos los
        confirma RRHH al aprobar.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <View style={[styles.row, multiline && { flexDirection: 'column', gap: 2 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, multiline && { textAlign: 'left' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  headerCard: {
    backgroundColor: theme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  amount: { fontSize: 28, fontWeight: '900', color: theme.textPrimary },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  counterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DBEAFE',
    borderRadius: 12,
    padding: 12,
  },
  counterText: { flex: 1, color: '#1E40AF', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  card: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: theme.textPrimary, marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: { fontSize: 13, color: theme.textMuted, fontWeight: '600' },
  rowValue: { fontSize: 14, color: theme.textPrimary, fontWeight: '700', flex: 1, textAlign: 'right' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
  accept: { backgroundColor: theme.primary },
  withdraw: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.danger },
  btnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  footnote: { fontSize: 11, color: theme.textMuted, lineHeight: 16 },
});
