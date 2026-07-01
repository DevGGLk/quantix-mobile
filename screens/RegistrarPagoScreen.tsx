import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList, StackScreenNavigation } from '../types/navigation';
import { theme } from '../lib/theme';
import {
  submitLoanPayment,
  quoteLoanSettlement,
  fmtMoney,
  type LoanPaymentType,
  type LoanPaymentMethod,
  type PickedFile,
  type SettlementQuote,
} from '../lib/loansApi';

const TYPES: { key: LoanPaymentType; label: string; hint: string }[] = [
  { key: 'voluntary_external', label: 'Abono voluntario', hint: 'Pago parcial fuera de planilla.' },
  { key: 'extraordinary', label: 'Extraordinario', hint: 'Abono grande para adelantar tu préstamo.' },
  { key: 'early_settlement', label: 'Liquidar todo', hint: 'Saldar el préstamo completo hoy.' },
];
const METHODS: { key: LoanPaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Efectivo' },
  { key: 'bank_transfer', label: 'Transferencia' },
  { key: 'check', label: 'Cheque' },
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtDateLabel(d: Date): string {
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function RegistrarPagoScreen() {
  const navigation = useNavigation<StackScreenNavigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'RegistrarPago'>>();
  const { loan } = route.params;

  const [paymentType, setPaymentType] = useState<LoanPaymentType>('voluntary_external');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<LoanPaymentMethod>('cash');
  const [recalcMode, setRecalcMode] = useState<'reduce_term' | 'reduce_payment'>('reduce_term');
  const [date, setDate] = useState(new Date());
  const [showDate, setShowDate] = useState(false);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [quote, setQuote] = useState<SettlementQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePicked(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || !result.assets || !result.assets[0]) return;
    const a = result.assets[0];
    setFile({
      uri: a.uri,
      name: a.fileName ?? `comprobante-${Date.now()}.jpg`,
      type: a.mimeType ?? 'image/jpeg',
    });
  }

  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permiso requerido', 'Necesitamos acceso a tus fotos para adjuntar el comprobante.'); return; }
    handlePicked(await ImagePicker.launchImageLibraryAsync({ quality: 0.6 }));
  }
  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara para tomar la foto del comprobante.'); return; }
    handlePicked(await ImagePicker.launchCameraAsync({ quality: 0.6 }));
  }

  async function calcularLiquidacion() {
    setQuoting(true); setError(null);
    const res = await quoteLoanSettlement(loan.id, ymd(date));
    setQuoting(false);
    if (res.ok) {
      setQuote(res.quote);
      setAmount(res.quote.settlement_total.toFixed(2));
    } else {
      setError(res.error);
    }
  }

  async function onSubmit() {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Ingresa un monto válido mayor que cero.'); return; }
    if (!file) { setError('El comprobante es obligatorio. Adjunta una foto del depósito.'); return; }
    setSubmitting(true); setError(null);
    const res = await submitLoanPayment({
      loanId: loan.id,
      amount: amt,
      paymentType,
      method,
      paymentDate: ymd(date),
      recalcMode: paymentType === 'extraordinary' ? recalcMode : undefined,
      notes: notes.trim() || undefined,
      file,
    });
    setSubmitting(false);
    if (res.ok) {
      Alert.alert(
        'Pago registrado',
        'Tu pago quedó EN REVISIÓN. No afecta tu saldo hasta que Contabilidad lo confirme. Te avisaremos cuando esté listo.',
        [{ text: 'OK', onPress: () => navigation.navigate('MisPagos') }],
      );
    } else {
      setError(res.error);
    }
  }

  const isSettlement = paymentType === 'early_settlement';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.headerCard}>
        <Text style={styles.headerLabel}>Saldo pendiente</Text>
        <Text style={styles.headerAmount}>C${fmtMoney(loan.remaining_balance)}</Text>
        <Text style={styles.headerMeta}>Cuota: C${fmtMoney(loan.installment_amount)}</Text>
      </View>

      {/* Tipo de pago */}
      <Text style={styles.label}>Tipo de pago</Text>
      <View style={styles.typeGroup}>
        {TYPES.map((t) => {
          const active = paymentType === t.key;
          return (
            <TouchableOpacity key={t.key} style={[styles.typeCard, active && styles.typeCardActive]}
              activeOpacity={0.85} onPress={() => { setPaymentType(t.key); setQuote(null); }}>
              <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{t.label}</Text>
              <Text style={styles.typeHint}>{t.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Liquidar hoy */}
      {isSettlement && (
        <View style={styles.quoteBox}>
          <TouchableOpacity style={styles.quoteBtn} onPress={() => void calcularLiquidacion()} disabled={quoting}>
            <Ionicons name="calculator-outline" size={18} color={theme.primary} />
            <Text style={styles.quoteBtnText}>{quoting ? 'Calculando…' : 'Calcular liquidación de hoy'}</Text>
          </TouchableOpacity>
          {quote && (
            <View style={styles.quoteDetail}>
              <QuoteRow label="Capital pendiente" value={`C$${fmtMoney(quote.remaining_principal)}`} />
              <QuoteRow label="Interés devengado" value={`C$${fmtMoney(quote.accrued_interest)}`} />
              <QuoteRow label="Total a pagar hoy" value={`C$${fmtMoney(quote.settlement_total)}`} strong />
              <Text style={styles.quoteNote}>
                Válido para {fmtDateLabel(date)}. El monto se recalcula a la fecha real al confirmar; no se cobran intereses futuros.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Monto */}
      <Text style={styles.label}>Monto del pago (C$)</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={amount}
        onChangeText={setAmount} placeholder="0.00" placeholderTextColor={theme.textMuted} />

      {/* Modalidad (solo extraordinario) */}
      {paymentType === 'extraordinary' && (
        <>
          <Text style={styles.label}>¿Qué prefieres con el abono?</Text>
          <View style={styles.segment}>
            {(['reduce_term', 'reduce_payment'] as const).map((m) => (
              <TouchableOpacity key={m} style={[styles.segmentItem, recalcMode === m && styles.segmentItemActive]}
                onPress={() => setRecalcMode(m)}>
                <Text style={[styles.segmentText, recalcMode === m && styles.segmentTextActive]}>
                  {m === 'reduce_term' ? 'Terminar antes' : 'Bajar la cuota'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Método */}
      <Text style={styles.label}>Método de pago</Text>
      <View style={styles.segment}>
        {METHODS.map((m) => (
          <TouchableOpacity key={m.key} style={[styles.segmentItem, method === m.key && styles.segmentItemActive]}
            onPress={() => setMethod(m.key)}>
            <Text style={[styles.segmentText, method === m.key && styles.segmentTextActive]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Fecha */}
      <Text style={styles.label}>Fecha del pago</Text>
      <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDate(true)}>
        <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} />
        <Text style={styles.dateText}>{fmtDateLabel(date)}</Text>
      </TouchableOpacity>
      {showDate && (
        <DateTimePicker value={date} mode="date" maximumDate={new Date()}
          onChange={(_e, d) => { setShowDate(Platform.OS === 'ios'); if (d) { setDate(d); setQuote(null); } }} />
      )}

      {/* Comprobante */}
      <Text style={styles.label}>Comprobante <Text style={{ color: theme.danger }}>*</Text></Text>
      <Text style={styles.helpText}>Foto del depósito o transferencia. Obligatorio.</Text>
      <View style={styles.fileBtns}>
        <TouchableOpacity style={styles.fileBtn} onPress={() => void pickFromGallery()}>
          <Ionicons name="image-outline" size={18} color={theme.primary} />
          <Text style={styles.fileBtnText}>Galería</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fileBtn} onPress={() => void takePhoto()}>
          <Ionicons name="camera-outline" size={18} color={theme.primary} />
          <Text style={styles.fileBtnText}>Cámara</Text>
        </TouchableOpacity>
      </View>
      {file && (
        <View style={styles.preview}>
          <Image source={{ uri: file.uri }} style={styles.previewImg} resizeMode="cover" />
          <Text style={styles.previewName} numberOfLines={1}>{file.name}</Text>
          <TouchableOpacity onPress={() => setFile(null)}>
            <Ionicons name="trash-outline" size={20} color={theme.danger} />
          </TouchableOpacity>
        </View>
      )}

      {/* Notas */}
      <Text style={styles.label}>Notas (opcional)</Text>
      <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} multiline value={notes}
        onChangeText={setNotes} placeholder="Ej. Depósito BAC ref. 12345" placeholderTextColor={theme.textMuted} />

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} disabled={submitting} onPress={() => void onSubmit()}>
        {submitting ? <ActivityIndicator color="#fff" /> : (
          <>
            <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
            <Text style={styles.submitText}>Registrar pago</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.footnote}>
        Tu pago queda EN REVISIÓN y no afecta tu saldo hasta que Contabilidad lo confirme. Recibirás un recibo cuando se confirme.
      </Text>
    </ScrollView>
  );
}

function QuoteRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.quoteRow}>
      <Text style={[styles.quoteRowLabel, strong && { fontWeight: '800', color: theme.textPrimary }]}>{label}</Text>
      <Text style={[styles.quoteRowValue, strong && { color: theme.primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 16, gap: 8, paddingBottom: 40 },
  headerCard: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, alignItems: 'center', gap: 2, marginBottom: 6 },
  headerLabel: { fontSize: 12, color: theme.textMuted, fontWeight: '600' },
  headerAmount: { fontSize: 26, fontWeight: '900', color: theme.textPrimary },
  headerMeta: { fontSize: 12, color: theme.textMuted },
  label: { fontSize: 13, fontWeight: '800', color: theme.textPrimary, marginTop: 10 },
  helpText: { fontSize: 12, color: theme.textMuted, marginTop: -2 },
  typeGroup: { gap: 8 },
  typeCard: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 12 },
  typeCardActive: { borderColor: theme.primary, backgroundColor: '#ECFEFF' },
  typeLabel: { fontSize: 14, fontWeight: '800', color: theme.textPrimary },
  typeLabelActive: { color: theme.primary },
  typeHint: { fontSize: 12, color: theme.textMuted, marginTop: 1 },
  input: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: theme.textPrimary },
  segment: { flexDirection: 'row', gap: 8 },
  segmentItem: { flex: 1, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingVertical: 11, alignItems: 'center' },
  segmentItemActive: { borderColor: theme.primary, backgroundColor: '#ECFEFF' },
  segmentText: { fontSize: 13, fontWeight: '700', color: theme.textSecondary },
  segmentTextActive: { color: theme.primary },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 12 },
  dateText: { fontSize: 15, color: theme.textPrimary, fontWeight: '600' },
  fileBtns: { flexDirection: 'row', gap: 8 },
  fileBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.primary, paddingVertical: 12 },
  fileBtnText: { fontSize: 14, fontWeight: '700', color: theme.primary },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 10, marginTop: 8 },
  previewImg: { width: 48, height: 48, borderRadius: 8, backgroundColor: theme.border },
  previewName: { flex: 1, fontSize: 13, color: theme.textSecondary },
  quoteBox: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.primary, padding: 12, gap: 10, marginTop: 4 },
  quoteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  quoteBtnText: { fontSize: 14, fontWeight: '800', color: theme.primary },
  quoteDetail: { gap: 4, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 8 },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quoteRowLabel: { fontSize: 13, color: theme.textMuted },
  quoteRowValue: { fontSize: 13, fontWeight: '700', color: theme.textPrimary },
  quoteNote: { fontSize: 11, color: theme.textMuted, marginTop: 4, lineHeight: 15 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginTop: 8 },
  errorText: { flex: 1, color: '#991B1B', fontSize: 13, fontWeight: '600' },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 15, marginTop: 14 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  footnote: { fontSize: 11, color: theme.textMuted, marginTop: 10, lineHeight: 16 },
});
