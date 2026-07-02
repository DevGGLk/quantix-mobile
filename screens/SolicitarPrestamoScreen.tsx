import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { StackScreenNavigation } from '../types/navigation';
import { theme } from '../lib/theme';
import {
  fetchLoanContext,
  fetchLoanTier,
  submitLoanRequest,
  fmtMoney,
  PERIOD_LABELS,
  type LoanCalculatorContext,
} from '../lib/loansApi';
import {
  generateAmortizationSchedule,
  type PeriodType,
  type AmortizationMethod,
} from '../lib/loans/amortization';

const PERIODS: PeriodType[] = ['monthly', 'biweekly', 'weekly'];

function periodsPerYear(p: PeriodType): number {
  return p === 'weekly' ? 52 : p === 'biweekly' ? 24 : 12;
}
function termUnit(p: PeriodType): string {
  return p === 'monthly' ? 'meses' : p === 'biweekly' ? 'quincenas' : 'semanas';
}

export default function SolicitarPrestamoScreen() {
  const navigation = useNavigation<StackScreenNavigation>();
  const headerHeight = useHeaderHeight();
  const [ctx, setCtx] = useState<LoanCalculatorContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('10000');
  const [term, setTerm] = useState(12);
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [allowedFreqs, setAllowedFreqs] = useState<string[]>(['monthly', 'biweekly', 'weekly']);
  const [rateMonthly, setRateMonthly] = useState<number | null>(null);
  const [tierLoading, setTierLoading] = useState(false);

  const [showSchedule, setShowSchedule] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchLoanContext();
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(res.error);
        setLoading(false);
        return;
      }
      setCtx(res.ctx);
      setTerm(Math.min(12, res.ctx.policy.max_term_periods || 12));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tier por monto (debounce 400ms)
  useEffect(() => {
    if (!ctx) return;
    const amt = parseFloat(amount);
    if (Number.isNaN(amt) || amt <= 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setTierLoading(true);
      const res = await fetchLoanTier(ctx.companyId, amt);
      if (cancelled) return;
      if (res.ok) {
        setRateMonthly(res.rate_monthly);
        setAllowedFreqs(res.frequencies_allowed);
        setPeriodType((prev) =>
          res.frequencies_allowed.includes(prev)
            ? prev
            : ((res.frequencies_allowed[0] ?? 'monthly') as PeriodType),
        );
      }
      setTierLoading(false);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, ctx]);

  const amtNum = parseFloat(amount) || 0;
  const annualRate = rateMonthly != null ? rateMonthly * 12 : ctx?.policy.default_annual_interest_rate ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const schedule = useMemo(() => {
    if (!ctx || amtNum <= 0 || term <= 0) return null;
    return generateAmortizationSchedule({
      principal: amtNum,
      annualInterestRate: annualRate,
      termPeriods: term,
      periodType,
      method: (ctx.policy.default_amortization_method as AmortizationMethod) ?? 'declining_balance',
      startDate: today,
    });
  }, [ctx, amtNum, term, periodType, annualRate, today]);

  const cuota = schedule?.installments[0]?.total ?? 0;
  const cuotaMensualEq = cuota * (periodsPerYear(periodType) / 12);

  const buffer = Number(ctx?.policy.ley185_safety_buffer_percent ?? 2);
  const capEffective = ctx ? ctx.bruto * 0.25 * (1 - buffer / 100) : 0;
  const totalMonthly = (ctx?.existingMonthlyDeductions ?? 0) + cuotaMensualEq;
  const exceedsLey185 = ctx != null && totalMonthly > capEffective;
  const maxAllowed = Math.max(0, capEffective - (ctx?.existingMonthlyDeductions ?? 0));

  const minAmt = ctx?.policy.min_amount ?? 0;
  const maxAmt = ctx?.policy.max_amount ?? 0;
  const amountOutOfRange = amtNum < minAmt || amtNum > maxAmt;
  const canSubmit =
    !!ctx && !submitting && reason.trim().length >= 30 && !exceedsLey185 && !amountOutOfRange && amtNum > 0;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const res = await submitLoanRequest({ principal: amtNum, termPeriods: term, periodType, reason: reason.trim() });
    setSubmitting(false);
    if (res.ok) {
      Alert.alert('Solicitud enviada', 'RRHH revisará tu solicitud pronto.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } else {
      Alert.alert('No se pudo enviar', res.error);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.muted}>Cargando calculadora…</Text>
      </View>
    );
  }
  if (loadError || !ctx) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={32} color={theme.danger} />
        <Text style={styles.errorText}>{loadError ?? 'No se pudo cargar el contexto.'}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : headerHeight}
    >
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {/* Información financiera */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tu información financiera</Text>
        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Salario bruto</Text>
            <Text style={styles.infoValue}>C${fmtMoney(ctx.bruto)}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Líquido estim.</Text>
            <Text style={[styles.infoValue, { color: theme.success }]}>C${fmtMoney(ctx.netEstimate.neto)}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Deducciones</Text>
            <Text style={[styles.infoValue, { color: theme.warning }]}>
              C${fmtMoney(ctx.existingMonthlyDeductions)}
            </Text>
          </View>
        </View>
      </View>

      {/* Calculadora */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Calculadora</Text>

        <Text style={styles.label}>Monto a solicitar (C$)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
          placeholder="10000"
        />
        <Text style={styles.hint}>
          Mínimo: C${fmtMoney(minAmt)} — Máximo: C${fmtMoney(maxAmt)}
        </Text>

        {/* Tasa */}
        <View style={styles.rateBox}>
          <View>
            <Text style={styles.rateLabel}>Tasa mensual</Text>
            <Text style={styles.rateValue}>{tierLoading ? '…' : `${(rateMonthly ?? annualRate / 12).toFixed(2)}%`}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.rateLabel}>Anual nominal</Text>
            <Text style={styles.rateValueSm}>{tierLoading ? '…' : `${annualRate.toFixed(2)}%`}</Text>
          </View>
        </View>

        {/* Frecuencia */}
        <Text style={styles.label}>Frecuencia de pago</Text>
        <View style={styles.freqRow}>
          {PERIODS.map((p) => {
            const allowed = allowedFreqs.includes(p);
            const active = periodType === p;
            return (
              <TouchableOpacity
                key={p}
                disabled={!allowed}
                onPress={() => allowed && setPeriodType(p)}
                style={[
                  styles.freqBtn,
                  active && styles.freqBtnActive,
                  !allowed && styles.freqBtnDisabled,
                ]}
              >
                <Text style={[styles.freqText, active && styles.freqTextActive]}>{PERIOD_LABELS[p]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Plazo */}
        <View style={styles.termHeader}>
          <Text style={styles.label}>Plazo ({termUnit(periodType)})</Text>
          <Text style={styles.termValue}>{term}</Text>
        </View>
        <View style={styles.stepperRow}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setTerm((t) => Math.max(1, t - 1))}>
            <Ionicons name="remove" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.stepTrack}>
            <Text style={styles.stepTrackText}>
              1 — {ctx.policy.max_term_periods} {termUnit(periodType)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setTerm((t) => Math.min(ctx.policy.max_term_periods, t + 1))}
          >
            <Ionicons name="add" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Resumen */}
      {schedule && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Resumen</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.sumBox}>
              <Text style={styles.infoLabel}>Cuota {PERIOD_LABELS[periodType].toLowerCase()}</Text>
              <Text style={styles.infoValue}>C${fmtMoney(cuota)}</Text>
            </View>
            <View style={styles.sumBox}>
              <Text style={styles.infoLabel}>Equiv. mensual</Text>
              <Text style={styles.infoValue}>C${fmtMoney(cuotaMensualEq)}</Text>
            </View>
            <View style={styles.sumBox}>
              <Text style={styles.infoLabel}>Total intereses</Text>
              <Text style={[styles.infoValue, { color: theme.warning }]}>C${fmtMoney(schedule.totals.interest)}</Text>
            </View>
            <View style={styles.sumBox}>
              <Text style={styles.infoLabel}>Total a pagar</Text>
              <Text style={styles.infoValue}>C${fmtMoney(schedule.totals.total)}</Text>
            </View>
          </View>

          {/* Semáforo Ley 185 */}
          <View
            style={[
              styles.ley,
              exceedsLey185
                ? { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }
                : totalMonthly > capEffective * 0.95
                ? { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }
                : { backgroundColor: '#D1FAE5', borderColor: '#6EE7B7' },
            ]}
          >
            <Text
              style={[
                styles.leyText,
                { color: exceedsLey185 ? '#991B1B' : totalMonthly > capEffective * 0.95 ? '#92400E' : '#065F46' },
              ]}
            >
              {exceedsLey185
                ? `Supera el límite Ley 185. Cuota mensual equiv. C$${fmtMoney(
                    cuotaMensualEq,
                  )} excede el tope C$${fmtMoney(capEffective)}. Máximo de cuota: C$${fmtMoney(maxAllowed)}.`
                : totalMonthly > capEffective * 0.95
                ? `Cerca del límite Ley 185 (tope C$${fmtMoney(capEffective)}).`
                : `Cuota dentro del límite Ley 185 (tope 25% del salario).`}
            </Text>
          </View>

          <TouchableOpacity style={styles.toggle} onPress={() => setShowSchedule((v) => !v)}>
            <Ionicons name={showSchedule ? 'chevron-up' : 'chevron-down'} size={16} color={theme.primary} />
            <Text style={styles.toggleText}>{showSchedule ? 'Ocultar' : 'Ver'} tabla de amortización</Text>
          </TouchableOpacity>

          {showSchedule && (
            <View style={styles.table}>
              <View style={[styles.trow, styles.thead]}>
                <Text style={[styles.th, { flex: 0.5 }]}>#</Text>
                <Text style={[styles.th, { flex: 1.4 }]}>Vence</Text>
                <Text style={[styles.th, { flex: 1 }]}>Capital</Text>
                <Text style={[styles.th, { flex: 1 }]}>Interés</Text>
                <Text style={[styles.th, { flex: 1 }]}>Cuota</Text>
              </View>
              {schedule.installments.map((inst) => (
                <View key={inst.number} style={styles.trow}>
                  <Text style={[styles.td, { flex: 0.5 }]}>{inst.number}</Text>
                  <Text style={[styles.td, { flex: 1.4 }]}>{inst.dueDate.slice(5)}</Text>
                  <Text style={[styles.td, { flex: 1 }]}>{fmtMoney(inst.principal)}</Text>
                  <Text style={[styles.td, { flex: 1, color: theme.warning }]}>{fmtMoney(inst.interest)}</Text>
                  <Text style={[styles.td, { flex: 1, fontWeight: '700' }]}>{fmtMoney(inst.total)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Enviar */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Enviar solicitud</Text>
        <View style={styles.reasonHeader}>
          <Text style={styles.label}>Motivo de la solicitud *</Text>
          <Text style={{ fontSize: 11, color: reason.trim().length < 30 ? theme.danger : theme.success }}>
            {reason.trim().length}/30 mín.
          </Text>
        </View>
        <TextInput
          style={[styles.input, styles.textarea]}
          multiline
          numberOfLines={3}
          value={reason}
          onChangeText={setReason}
          placeholder="Ej: Para cubrir gastos médicos urgentes de mi familia (mínimo 30 caracteres)"
        />
        <TouchableOpacity
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          <Text style={styles.submitText}>{submitting ? 'Enviando…' : 'Enviar solicitud'}</Text>
        </TouchableOpacity>
        {amountOutOfRange && amtNum > 0 && (
          <Text style={styles.warnText}>El monto está fuera del rango permitido.</Text>
        )}
      </View>

      <Text style={styles.footnote}>
        El servidor recalcula tasa, cuotas y validación Ley 185 al recibir tu solicitud. RRHH puede aprobar o
        enviar una contraoferta según tu antigüedad, estabilidad y capacidad de respaldo.
      </Text>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.background, padding: 24 },
  muted: { color: theme.textMuted, fontSize: 14 },
  errorText: { color: theme.danger, fontSize: 14, textAlign: 'center', fontWeight: '600' },
  card: {
    backgroundColor: theme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: theme.textPrimary },
  infoRow: { flexDirection: 'row', gap: 8 },
  infoBox: { flex: 1, backgroundColor: theme.background, borderRadius: 12, padding: 10, alignItems: 'center' },
  infoLabel: { fontSize: 11, color: theme.textMuted, fontWeight: '700', marginBottom: 2, textAlign: 'center' },
  infoValue: { fontSize: 15, fontWeight: '800', color: theme.textPrimary },
  label: { fontSize: 12, fontWeight: '700', color: theme.textMuted },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.textPrimary,
    backgroundColor: '#fff',
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  hint: { fontSize: 11, color: theme.textMuted },
  rateBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#3C34891A',
    borderRadius: 12,
    padding: 12,
  },
  rateLabel: { fontSize: 11, color: theme.textMuted },
  rateValue: { fontSize: 18, fontWeight: '800', color: theme.textPrimary },
  rateValueSm: { fontSize: 14, fontWeight: '700', color: theme.textSecondary },
  freqRow: { flexDirection: 'row', gap: 8 },
  freqBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  freqBtnActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  freqBtnDisabled: { opacity: 0.35 },
  freqText: { fontSize: 12, fontWeight: '700', color: theme.textSecondary },
  freqTextActive: { color: '#fff' },
  termHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  termValue: { fontSize: 16, fontWeight: '800', color: theme.textPrimary },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  stepTrack: { flex: 1, alignItems: 'center' },
  stepTrackText: { fontSize: 12, color: theme.textMuted },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sumBox: { width: '47%', backgroundColor: theme.background, borderRadius: 12, padding: 10, alignItems: 'center' },
  ley: { borderRadius: 12, borderWidth: 1, padding: 12 },
  leyText: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggleText: { fontSize: 12, fontWeight: '700', color: theme.primary },
  table: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: 'hidden' },
  trow: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  thead: { backgroundColor: '#F8FAFC' },
  th: { fontSize: 11, fontWeight: '700', color: theme.textMuted },
  td: { fontSize: 11, color: theme.textSecondary },
  reasonHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  submit: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  warnText: { fontSize: 12, color: theme.danger, textAlign: 'center' },
  footnote: { fontSize: 11, color: theme.textMuted, lineHeight: 16 },
});
