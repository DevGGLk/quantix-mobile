import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

type QuincenaPeriod = { period_start: string; period_end: string; label: string };

type DayRow = {
  date: string;
  normal_hours: number;
  ot_approved_hours: number;
  ot_pending_hours: number;
  total_hours: number;
  auto_closed: boolean;
  entries: number;
};

type HoursReport = {
  ok: boolean;
  error?: string;
  period_start: string;
  period_end: string;
  days: DayRow[];
  totals: {
    normal: number;
    ot_approved: number;
    ot_pending: number;
    total: number;
    days_worked: number;
    auto_closed_days: number;
  };
};

type ChartDay = DayRow & { dayLabel: string; weekday: string };

// Paleta validada (dataviz six-checks) sobre superficie blanca
const COLOR_NORMAL = '#6C5CE7';
const COLOR_APROBADA = '#0D9488';
const COLOR_PENDIENTE = '#D97706';

const WEEKDAYS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const CHART_HEIGHT = 150;

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function fmtHours(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

function fmtRange(start: string, end: string): string {
  const s = parseYmd(start);
  const e = parseYmd(end);
  return `${s.getDate()} ${MESES_CORTOS[s.getMonth()]} – ${e.getDate()} ${MESES_CORTOS[e.getMonth()]}`;
}

export default function MisHorasScreen() {
  const [periods, setPeriods] = useState<QuincenaPeriod[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [report, setReport] = useState<HoursReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPeriods = async () => {
      const { data, error: err } = await supabase.rpc('get_my_quincena_periods', { p_count: 8 });
      if (cancelled) return;
      if (err) {
        setError('No se pudieron cargar los períodos.');
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as QuincenaPeriod[];
      if (rows.length === 0) {
        setError('No se encontró tu expediente de colaborador.');
        setLoading(false);
        return;
      }
      setPeriods(rows);
    };
    void loadPeriods();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = periods[selectedIdx] ?? null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const loadReport = async () => {
      const { data, error: err } = await supabase.rpc('get_my_hours_report', {
        p_start: selected.period_start,
        p_end: selected.period_end,
      });
      if (cancelled) return;
      const rep = data as HoursReport | null;
      if (err || !rep || !rep.ok) {
        setError(err?.message ?? 'No se pudo cargar el reporte.');
        setReport(null);
      } else {
        setError(null);
        setReport(rep);
      }
      setLoading(false);
    };
    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const chartData = useMemo<ChartDay[]>(() => {
    if (!selected || !report) return [];
    const byDate = new Map(report.days.map((d) => [d.date, d]));
    const out: ChartDay[] = [];
    const cursor = parseYmd(selected.period_start);
    const end = parseYmd(selected.period_end);
    while (cursor <= end) {
      const ymd = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const row = byDate.get(ymd);
      out.push({
        date: ymd,
        normal_hours: row?.normal_hours ?? 0,
        ot_approved_hours: row?.ot_approved_hours ?? 0,
        ot_pending_hours: row?.ot_pending_hours ?? 0,
        total_hours: row?.total_hours ?? 0,
        auto_closed: row?.auto_closed ?? false,
        entries: row?.entries ?? 0,
        dayLabel: String(cursor.getDate()),
        weekday: WEEKDAYS_ES[cursor.getDay()],
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [selected, report]);

  const maxTotal = useMemo(
    () => Math.max(8, ...chartData.map((d) => d.total_hours)),
    [chartData],
  );

  const weeklyTotals = useMemo(() => {
    if (chartData.length === 0) return [];
    const weeks: { start: string; end: string; total: number }[] = [];
    let current: { start: string; end: string; total: number } | null = null;
    for (const d of chartData) {
      const dow = parseYmd(d.date).getDay();
      if (!current || dow === 1) {
        current = { start: d.date, end: d.date, total: 0 };
        weeks.push(current);
      }
      current.end = d.date;
      current.total += d.total_hours;
    }
    return weeks.filter((w) => w.total > 0);
  }, [chartData]);

  const autoClosedDays = useMemo(() => chartData.filter((d) => d.auto_closed), [chartData]);
  const detail = selectedDay ? chartData.find((d) => d.date === selectedDay) ?? null : null;
  const totals = report?.totals;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Selector de quincena */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodRow}>
        {periods.map((p, i) => {
          const active = i === selectedIdx;
          return (
            <TouchableOpacity
              key={p.period_start}
              style={[styles.periodChip, active && styles.periodChipActive]}
              activeOpacity={0.8}
              onPress={() => {
                if (i !== selectedIdx) {
                  setSelectedIdx(i);
                  setSelectedDay(null);
                  setLoading(true);
                  setError(null);
                }
              }}
            >
              <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>
                {p.label}
              </Text>
              <Text style={[styles.periodChipSub, active && styles.periodChipTextActive]}>
                {fmtRange(p.period_start, p.period_end)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={styles.loadingText}>Cargando horas…</Text>
        </View>
      ) : error ? (
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle-outline" size={32} color={theme.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : totals && totals.days_worked === 0 ? (
        <View style={styles.centerBox}>
          <Ionicons name="calendar-outline" size={32} color={theme.textMuted} />
          <Text style={styles.loadingText}>Sin marcas registradas en este período.</Text>
        </View>
      ) : totals ? (
        <>
          {/* Totales */}
          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total quincena</Text>
              <Text style={styles.totalValue}>{fmtHours(totals.total)}</Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Normales</Text>
              <Text style={styles.totalValue}>{fmtHours(totals.normal)}</Text>
            </View>
          </View>
          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Extra aprobada</Text>
              <Text style={[styles.totalValue, { color: COLOR_APROBADA }]}>
                {fmtHours(totals.ot_approved)}
              </Text>
            </View>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Extra pendiente</Text>
              <Text style={[styles.totalValue, { color: COLOR_PENDIENTE }]}>
                {fmtHours(totals.ot_pending)}
              </Text>
            </View>
          </View>

          {/* Leyenda */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: COLOR_NORMAL }]} />
              <Text style={styles.legendText}>Normales</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: COLOR_APROBADA }]} />
              <Text style={styles.legendText}>Extra aprobada</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: COLOR_PENDIENTE }]} />
              <Text style={styles.legendText}>Extra pendiente</Text>
            </View>
          </View>

          {/* Gráfica de barras apiladas (Views planos) */}
          <View style={styles.chartCard}>
            <View style={styles.chartArea}>
              {chartData.map((d) => {
                const hNormal = (d.normal_hours / maxTotal) * CHART_HEIGHT;
                const hAprob = (d.ot_approved_hours / maxTotal) * CHART_HEIGHT;
                const hPend = (d.ot_pending_hours / maxTotal) * CHART_HEIGHT;
                const isSelected = selectedDay === d.date;
                return (
                  <TouchableOpacity
                    key={d.date}
                    style={styles.barColumn}
                    activeOpacity={0.7}
                    onPress={() => setSelectedDay(isSelected ? null : d.date)}
                  >
                    <View style={styles.barStack}>
                      {hPend > 0.5 && (
                        <View
                          style={[
                            styles.barSegment,
                            styles.barTop,
                            { height: hPend, backgroundColor: COLOR_PENDIENTE },
                          ]}
                        />
                      )}
                      {hAprob > 0.5 && (
                        <View
                          style={[
                            styles.barSegment,
                            hPend <= 0.5 && styles.barTop,
                            { height: hAprob, backgroundColor: COLOR_APROBADA },
                          ]}
                        />
                      )}
                      {hNormal > 0.5 && (
                        <View
                          style={[
                            styles.barSegment,
                            hPend <= 0.5 && hAprob <= 0.5 && styles.barTop,
                            { height: hNormal, backgroundColor: COLOR_NORMAL },
                            isSelected && styles.barSelected,
                          ]}
                        />
                      )}
                    </View>
                    <Text style={[styles.barDay, d.auto_closed && styles.barDayWarn]}>
                      {d.dayLabel}
                    </Text>
                    <Text style={[styles.barWeekday, d.auto_closed && styles.barDayWarn]}>
                      {d.auto_closed ? '⚠' : d.weekday}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Detalle del día tocado */}
          {detail && (
            <View style={styles.detailCard}>
              <Text style={styles.detailTitle}>
                {detail.weekday} {fmtRange(detail.date, detail.date).split(' – ')[0]}
              </Text>
              <Text style={styles.detailLine}>
                Normales: <Text style={styles.detailBold}>{fmtHours(detail.normal_hours)}</Text>
              </Text>
              {detail.ot_approved_hours > 0 && (
                <Text style={styles.detailLine}>
                  Extra aprobada:{' '}
                  <Text style={[styles.detailBold, { color: COLOR_APROBADA }]}>
                    {fmtHours(detail.ot_approved_hours)}
                  </Text>
                </Text>
              )}
              {detail.ot_pending_hours > 0 && (
                <Text style={styles.detailLine}>
                  Extra pendiente:{' '}
                  <Text style={[styles.detailBold, { color: COLOR_PENDIENTE }]}>
                    {fmtHours(detail.ot_pending_hours)}
                  </Text>
                </Text>
              )}
              <Text style={styles.detailLine}>
                Total: <Text style={styles.detailBold}>{fmtHours(detail.total_hours)}</Text>
                {'  ·  '}
                {detail.entries} {detail.entries === 1 ? 'marca' : 'marcas'}
              </Text>
              {detail.auto_closed && (
                <Text style={styles.detailWarn}>
                  ⚠ Sin salida registrada: cierre automático, horas provisionales.
                </Text>
              )}
            </View>
          )}

          {/* Totales semanales */}
          {weeklyTotals.length > 0 && (
            <View style={styles.weeksWrap}>
              {weeklyTotals.map((w) => (
                <View key={w.start} style={styles.weekChip}>
                  <Text style={styles.weekChipText}>
                    Semana {fmtRange(w.start, w.end)}:{' '}
                    <Text style={styles.detailBold}>{fmtHours(w.total)}</Text>
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Avisos */}
          {autoClosedDays.length > 0 && (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={18} color={COLOR_PENDIENTE} />
              <Text style={styles.warnText}>
                {autoClosedDays.length === 1 ? 'El día ' : 'Los días '}
                {autoClosedDays.map((d) => `${d.weekday} ${d.dayLabel}`).join(', ')} no{' '}
                {autoClosedDays.length === 1 ? 'registró' : 'registraron'} salida (cierre
                automático): esas horas son provisionales hasta que RRHH las ajuste.
              </Text>
            </View>
          )}
          {totals.ot_pending > 0 && (
            <Text style={styles.footNote}>
              Las horas extra pendientes aún no fueron aprobadas por RRHH; no son definitivas
              hasta su revisión.
            </Text>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, paddingBottom: 40 },
  periodRow: { marginBottom: 16, flexGrow: 0 },
  periodChip: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  periodChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  periodChipText: { fontSize: 12, fontWeight: '700', color: theme.textPrimary },
  periodChipSub: { fontSize: 10, color: theme.textSecondary, marginTop: 1 },
  periodChipTextActive: { color: '#FFFFFF' },
  centerBox: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  loadingText: { color: theme.textSecondary, fontSize: 13 },
  errorText: { color: theme.danger, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  totalsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  totalCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  totalValue: { fontSize: 18, fontWeight: '800', color: theme.textPrimary, marginTop: 2 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 11, height: 11, borderRadius: 3 },
  legendText: { fontSize: 11, color: theme.textSecondary },
  chartCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    marginBottom: 12,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT + 34,
  },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barStack: { width: '62%', maxWidth: 18, justifyContent: 'flex-end' },
  barSegment: { width: '100%', marginTop: 2 },
  barTop: { borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barSelected: { opacity: 0.85 },
  barDay: { fontSize: 9, color: theme.textSecondary, marginTop: 4, fontWeight: '600' },
  barWeekday: { fontSize: 8, color: theme.textMuted },
  barDayWarn: { color: COLOR_PENDIENTE, fontWeight: '800' },
  detailCard: {
    backgroundColor: theme.subtleBackground,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    gap: 2,
  },
  detailTitle: { fontSize: 13, fontWeight: '800', color: theme.textPrimary, marginBottom: 2 },
  detailLine: { fontSize: 12, color: theme.textSecondary },
  detailBold: { fontWeight: '800', color: theme.textPrimary },
  detailWarn: { fontSize: 11, color: COLOR_PENDIENTE, marginTop: 4, fontWeight: '600' },
  weeksWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  weekChip: {
    backgroundColor: theme.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  weekChipText: { fontSize: 11, color: theme.textSecondary },
  warnBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FEF3E2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F5D9AE',
    padding: 10,
    marginBottom: 8,
  },
  warnText: { flex: 1, fontSize: 11, color: '#8A5A0B', lineHeight: 16 },
  footNote: { fontSize: 11, color: theme.textMuted, lineHeight: 16 },
});
