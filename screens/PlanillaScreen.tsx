import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type Payslip = {
  period_start: string;
  period_end: string;
  gross_income: number;
  inss_laboral: number;
  ir_retention: number;
  applied_deductions: number;
  net_to_pay: number;
  status: string | null;
};

type PayrollSlipRow = {
  period_start?: unknown;
  period_end?: unknown;
  gross_income?: unknown;
  inss_laboral?: unknown;
  ir_retention?: unknown;
  applied_deductions?: unknown;
  net_to_pay?: unknown;
  status?: unknown;
};

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v != null && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

const WATERMARK_REPEAT = 24;

function WatermarkOverlay({ userName }: { userName: string }) {
  const text = `${userName} - CONFIDENCIAL QuantixHR`;
  return (
    <View style={watermarkStyles.container} pointerEvents="none">
      <View style={watermarkStyles.wrap}>
        {Array.from({ length: WATERMARK_REPEAT }, (_, i) => (
          <Text key={i} style={watermarkStyles.text}>
            {text}
          </Text>
        ))}
      </View>
    </View>
  );
}

const watermarkStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  wrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  text: {
    fontSize: 12,
    color: theme.textPrimary,
    opacity: 0.08,
    transform: [{ rotate: '-45deg' }],
  },
});

export default function PlanillaScreen() {
  const insets = useSafeAreaInsets();
  const { session, employee } = useAuth();
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [cedulaOId, setCedulaOId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [hasPayslips, setHasPayslips] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) {
            setCedulaOId('—');
            setNombre('');
            setApellido('');
          }
          return;
        }

        // Documento / código desde expediente (`national_id`, `employee_code`), no desde Auth.
        if (isMounted) {
          const nid = employee?.national_id?.trim() ?? '';
          const code = employee?.employee_code?.trim() ?? '';
          setCedulaOId(nid.length > 0 ? nid : code.length > 0 ? code : '—');
          setNombre(employee?.first_name ?? '');
          setApellido(employee?.last_name ?? '');
        }

        const companyId = employee?.company_id ?? null;
        if (!companyId) {
          setPayslip(null);
          setHasPayslips(false);
          return;
        }

        const empId = employee?.id ?? null;
        if (!empId) {
          if (isMounted) {
            setPayslip(null);
            setHasPayslips(false);
          }
          return;
        }

        const { data: payslipRow, error: payslipError } = await supabase
          .from('payroll_slips')
          .select(
            'period_start, period_end, gross_income, inss_laboral, ir_retention, applied_deductions, net_to_pay, status'
          )
          .eq('employee_id', empId)
          .eq('company_id', companyId)
          .order('period_start', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (payslipError) {
          console.error('Error al cargar recibos (Planilla):', payslipError);
          if (isMounted) {
            setPayslip(null);
            setHasPayslips(false);
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }
        } else if (isMounted) {
          if (payslipRow) {
            const row = payslipRow as PayrollSlipRow;
            setPayslip({
              period_start: String(row.period_start ?? ''),
              period_end: String(row.period_end ?? ''),
              gross_income: num(row.gross_income),
              inss_laboral: num(row.inss_laboral),
              ir_retention: num(row.ir_retention),
              applied_deductions: num(row.applied_deductions),
              net_to_pay: num(row.net_to_pay),
              status: typeof row.status === 'string' ? row.status : null,
            });
            setHasPayslips(true);
          } else {
            setPayslip(null);
            setHasPayslips(false);
          }
        }
      } catch (e) {
        console.error('Error al cargar perfil (Planilla):', e);
        if (isMounted) {
          setCedulaOId('—');
          setPayslip(null);
          setHasPayslips(false);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [
    session?.user?.id,
    employee?.id,
    employee?.company_id,
    employee?.first_name,
    employee?.last_name,
    employee?.national_id,
    employee?.employee_code,
  ]);

  const displayName = [nombre, apellido].filter(Boolean).join(' ') || 'Empleado';
  const watermarkName = displayName;

  const formatPeriodoLabel = (start?: string, end?: string) => {
    if (!start || !end) return '—';
    try {
      const dStart = new Date(start);
      const dEnd = new Date(end);
      const dayStart = dStart.getDate();
      const dayEnd = dEnd.getDate();
      const monthYear = dEnd.toLocaleDateString('es-ES', {
        month: 'long',
        year: 'numeric',
      });
      return `Del ${dayStart} al ${dayEnd} de ${monthYear}`;
    } catch {
      return `${start} - ${end}`;
    }
  };

  const mapStatusLabel = (status?: string | null) => {
    const s = (status ?? '').toLowerCase();
    if (s === 'draft') return 'En revisión';
    if (s === 'paid' || s === 'approved') return 'Pagado';
    if (!s) return '—';
    return status as string;
  };

  const deduccionesTotales =
    (payslip?.inss_laboral ?? 0) +
    (payslip?.ir_retention ?? 0) +
    (payslip?.applied_deductions ?? 0);

  if (isLoading) {
    return (
      <View style={[styles.loaderContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="small" color={theme.accent} />
        <Text style={styles.loaderText}>Cargando recibo...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recibo de Nómina</Text>
          <View style={styles.headerRow}>
            <Text style={styles.label}>Nombre</Text>
            <Text style={styles.value}>{displayName}</Text>
          </View>
          <View style={styles.headerRow}>
            <Text style={styles.label}>Cédula / ID</Text>
            <Text style={styles.value}>{cedulaOId}</Text>
          </View>

          {hasPayslips === false ? (
            <View style={styles.emptyWrapper}>
              <Text style={styles.emptyText}>
                Aún no hay recibos de nómina generados para tu perfil.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Período</Text>
              <View style={styles.row}>
                <Text style={styles.concepto}>Período de pago</Text>
                <Text style={styles.montoPositivo}>
                  {formatPeriodoLabel(payslip?.period_start, payslip?.period_end)}
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Ingresos</Text>
              <View style={styles.row}>
                <Text style={styles.concepto}>Ingreso Bruto</Text>
                <Text style={styles.montoPositivo}>
                  C$ {Number(payslip?.gross_income ?? 0).toLocaleString()}
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Deducciones</Text>
              <View style={styles.row}>
                <Text style={styles.concepto}>INSS Laboral</Text>
                <Text style={styles.montoNegativo}>
                  - C$ {Number(payslip?.inss_laboral ?? 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.concepto}>Retención IR</Text>
                <Text style={styles.montoNegativo}>
                  - C$ {Number(payslip?.ir_retention ?? 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.concepto}>Otras deducciones aplicadas</Text>
                <Text style={styles.montoNegativo}>
                  - C$ {Number(payslip?.applied_deductions ?? 0).toLocaleString()}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.concepto, styles.totalLabel]}>Total Deducciones</Text>
                <Text style={styles.montoNegativo}>
                  - C$ {Number(deduccionesTotales).toLocaleString()}
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Resumen</Text>
              <View style={styles.row}>
                <Text style={styles.concepto}>Estado</Text>
                <Text style={styles.montoPositivo}>{mapStatusLabel(payslip?.status)}</Text>
              </View>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Neto a Pagar</Text>
                <Text style={styles.totalMonto}>
                  C$ {Number(payslip?.net_to_pay ?? 0).toLocaleString()}
                </Text>
              </View>

              <Text style={styles.legal}>
                Este documento es estrictamente confidencial y de uso interno.
              </Text>
            </>
          )}
        </View>
      </ScrollView>

      <WatermarkOverlay userName={watermarkName} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loaderContainer: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  value: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  concepto: {
    fontSize: 14,
    color: theme.textSecondary,
    flex: 1,
  },
  montoPositivo: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  montoNegativo: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.danger,
  },
  totalRow: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 2,
    borderTopColor: theme.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  totalMonto: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.accent,
  },
  legal: {
    marginTop: 20,
    fontSize: 11,
    color: theme.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  emptyWrapper: {
    marginTop: 18,
    padding: 16,
    backgroundColor: theme.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 20,
  },
});
