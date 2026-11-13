import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackScreenNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type VacBalance = {
  vacation_balance: number;
  days_taken: number;
  days_programmed: number;
  last_accrual_date: string | null;
  /** Saldo + devengo desde el último crédito del cron, al día de hoy (Managua). */
  saldo_al_dia?: number | null;
  fecha_corte?: string | null;
  /** Fecha real de la carga inicial (leave_opening_balances.as_of). No se mueve. */
  saldo_cargado_el?: string | null;
};

/** Ley 185: 30 días por año = 2.5 por mes = 2.5/30 por día. */
const DEVENGO_DIARIO = 2.5 / 30;

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
type Solicitud = {
  id: string;
  request_type: string | null;
  start_date: string;
  end_date: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  status: string | null;
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  en_curso: 'En curso',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
  cerrada: 'Cerrada',
};

function hoyManagua(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());
}

function rangoSolicitud(s: Solicitud): string {
  const f = (ymd: string) => fmtFecha(ymd);
  if (s.hora_inicio && s.hora_fin) return `${f(s.start_date)} · ${s.hora_inicio.slice(0, 5)}–${s.hora_fin.slice(0, 5)}`;
  return s.start_date === s.end_date ? f(s.start_date) : `${f(s.start_date)} – ${f(s.end_date)}`;
}

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

type PendienteEquipo = Solicitud & {
  employee_id: string;
  notes: string | null;
  employees?: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
};

function nombreEquipo(p: PendienteEquipo): string {
  const e = Array.isArray(p.employees) ? p.employees[0] : p.employees;
  return [e?.first_name, e?.last_name].filter(Boolean).join(' ').trim() || 'Colaborador';
}

export default function VacacionesScreen() {
  const navigation = useNavigation<StackScreenNavigation>();
  const { employeeRecord } = useAuth();
  const [balance, setBalance] = useState<VacBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Auditoría 12/11/2026: la app no mostraba las solicitudes propias ni dejaba cancelarlas. */
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [cancelando, setCancelando] = useState<string | null>(null);
  /** Ronda 6: el jefe directo aprueba o rechaza las solicitudes de su equipo desde la app. */
  const [equipo, setEquipo] = useState<PendienteEquipo[]>([]);
  const [decidiendo, setDecidiendo] = useState<string | null>(null);

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
    const { data: sol } = await supabase
      .from('time_off_requests')
      .select('id, request_type, start_date, end_date, hora_inicio, hora_fin, status')
      .eq('employee_id', empId)
      .order('start_date', { ascending: false })
      .limit(15);
    setSolicitudes((sol ?? []) as Solicitud[]);
    const { data: aCargo } = await supabase
      .from('employees')
      .select('id')
      .or(`reports_to.eq.${empId},manager_id.eq.${empId}`)
      .is('deleted_at', null);
    const ids = ((aCargo ?? []) as { id: string }[]).map((e) => e.id).filter((id) => id !== empId);
    if (ids.length > 0) {
      const { data: pend } = await supabase
        .from('time_off_requests')
        .select('id, employee_id, request_type, start_date, end_date, hora_inicio, hora_fin, status, notes, employees(first_name, last_name)')
        .in('employee_id', ids)
        .eq('status', 'pendiente')
        .order('start_date', { ascending: true });
      setEquipo((pend ?? []) as PendienteEquipo[]);
    } else {
      setEquipo([]);
    }
    setLoading(false);
  }, [empId]);

  // Al volver de «Nueva solicitud» se recarga la lista.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const cancelable = (s: Solicitud) => {
    const st = String(s.status ?? '').toLowerCase();
    if (st === 'pendiente') return true;
    return st === 'aprobada' && s.start_date > hoyManagua();
  };

  const cancelar = (s: Solicitud) => {
    Alert.alert('Cancelar solicitud', `¿Cancelar tu solicitud de ${s.request_type ?? 'ausencia'} (${rangoSolicitud(s)})?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, cancelar',
        style: 'destructive',
        onPress: async () => {
          setCancelando(s.id);
          const { error } = await supabase.rpc('cancel_time_off_request', { p_request_id: s.id });
          setCancelando(null);
          if (error) {
            Alert.alert('No se pudo cancelar', error.message.replace(/^cancel_time_off_request:\s*/, ''));
            return;
          }
          Alert.alert('Solicitud cancelada', 'Si eran vacaciones aprobadas, los días volvieron a tu saldo.');
          await load();
        },
      },
    ]);
  };

  const decidir = async (p: PendienteEquipo, decision: 'aprobada' | 'rechazada', reason: string | null) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token || !API_BASE) {
      Alert.alert('Sin conexión', 'No se pudo enviar tu decisión. Intenta de nuevo.');
      return;
    }
    setDecidiendo(p.id);
    try {
      const res = await fetch(`${API_BASE}/api/time-off/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: p.id, decision, reason }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        Alert.alert('No se pudo guardar', json.error ?? 'Intenta de nuevo.');
        return;
      }
      Alert.alert(decision === 'aprobada' ? 'Aprobada' : 'Rechazada', `Le avisamos a ${nombreEquipo(p)}.`);
      await load();
    } catch {
      Alert.alert('Sin conexión', 'No se pudo enviar tu decisión. Intenta de nuevo.');
    } finally {
      setDecidiendo(null);
    }
  };

  const pedirRechazo = (p: PendienteEquipo) => {
    if (typeof Alert.prompt === 'function') {
      Alert.prompt('Motivo del rechazo', `Se le muestra a ${nombreEquipo(p)}.`, (txt) => {
        if (txt && txt.trim()) void decidir(p, 'rechazada', txt.trim());
      });
    } else {
      Alert.alert('Rechazar solicitud', `¿Rechazar la solicitud de ${nombreEquipo(p)}?`, [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, rechazar', style: 'destructive', onPress: () => void decidir(p, 'rechazada', 'Rechazada por el jefe directo desde la app.') },
      ]);
    }
  };

  const solicitudesEquipo =
    equipo.length > 0 ? (
      <View style={styles.infoCard}>
        <Text style={styles.solTitle}>Solicitudes de mi equipo</Text>
        {equipo.map((p, i) => (
          <View key={p.id}>
            {i > 0 ? <View style={styles.infoDivider} /> : null}
            <View style={{ paddingVertical: 6 }}>
              <Text style={styles.infoValue}>{nombreEquipo(p)}</Text>
              <Text style={styles.infoLabel}>
                {p.request_type ?? 'Ausencia'} · {rangoSolicitud(p)}
              </Text>
              {p.notes ? <Text style={styles.infoLabel} numberOfLines={2}>{p.notes}</Text> : null}
              <View style={styles.solRow}>
                <TouchableOpacity onPress={() => void decidir(p, 'aprobada', null)} disabled={decidiendo === p.id}>
                  <Text style={styles.solApprove}>{decidiendo === p.id ? 'Guardando…' : 'Aprobar'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => pedirRechazo(p)} disabled={decidiendo === p.id}>
                  <Text style={styles.solCancel}>Rechazar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </View>
    ) : null;

  const misSolicitudes =
    solicitudes.length > 0 ? (
      <View style={styles.infoCard}>
        <Text style={styles.solTitle}>Mis solicitudes</Text>
        {solicitudes.map((s, i) => (
          <View key={s.id}>
            {i > 0 ? <View style={styles.infoDivider} /> : null}
            <View style={styles.solRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoValue}>{s.request_type ?? 'Ausencia'}</Text>
                <Text style={styles.infoLabel}>
                  {rangoSolicitud(s)} · {ESTADO_LABEL[String(s.status ?? '').toLowerCase()] ?? s.status}
                </Text>
              </View>
              {cancelable(s) ? (
                <TouchableOpacity onPress={() => cancelar(s)} disabled={cancelando === s.id}>
                  <Text style={styles.solCancel}>{cancelando === s.id ? 'Cancelando…' : 'Cancelar'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    ) : null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Saldo sembrado = carga histórica para quien ya trabajaba antes del sistema. Se deduce de la
  // fecha de carga inicial, que no se mueve. last_accrual_date la mueve el cron todos los días y
  // hacía decir "tu saldo inicial se cargó HOY" cada día.
  const seeded =
    !!balance?.saldo_cargado_el &&
    !!hireDate &&
    daysBetween(hireDate, balance.saldo_cargado_el) > 35;
  const saldoMostrado = balance ? (balance.saldo_al_dia ?? balance.vacation_balance) : 0;
  const fechaCorte = balance?.fecha_corte ?? balance?.last_accrual_date ?? null;

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
            <Text style={styles.saldoNumber}>{fmtDias(saldoMostrado)}</Text>
            <Text style={styles.saldoLabel}>días disponibles</Text>
            {fechaCorte ? (
              <Text style={styles.saldoLabel}>
                Al {fmtFecha(fechaCorte)} · suma ≈{fmtDias(DEVENGO_DIARIO)} días por día
              </Text>
            ) : null}
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
                Tu saldo inicial se cargó el {fmtFecha(balance.saldo_cargado_el)} y ya incluye las
                vacaciones que tomaste antes de usar el sistema. Desde entonces el saldo crece todos
                los días.
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('NuevaSolicitud')}
          >
            <Ionicons name="paper-plane-outline" size={20} color="#ffffff" />
            <Text style={styles.ctaText}>Solicitar vacaciones o permiso</Text>
          </TouchableOpacity>
          {solicitudesEquipo}
          {misSolicitudes}
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
            <Text style={styles.ctaText}>Solicitar vacaciones o permiso</Text>
          </TouchableOpacity>
          {solicitudesEquipo}
          {misSolicitudes}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  solTitle: { fontSize: 15, fontWeight: '700', color: theme.textPrimary, marginBottom: 8 },
  solRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  solCancel: { color: '#FF3F48', fontWeight: '700', fontSize: 13 },
  solApprove: { color: '#1D9E75', fontWeight: '700', fontSize: 13, marginRight: 16 },
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
