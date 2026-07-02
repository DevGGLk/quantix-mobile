import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

type SolicitudPendiente = {
  id: string;
  /** Tabla origen: legacy vs paridad web (`time_off_requests`). */
  source: 'employee_requests' | 'time_off_requests';
  request_type: string | null;
  reason: string | null;
  start_date: string | null;
  employees: { first_name?: string | null; last_name?: string | null } | null;
};

type ChecklistHoy = {
  id: string;
  completion_percentage: number | null;
  checklists: { title?: string | null; company_id?: string } | null;
};

type IncidenciaItem = {
  id: string;
  record_type: string | null;
  description: string | null;
  created_at?: string | null;
  profiles: { first_name?: string | null; last_name?: string | null } | null;
};

/** Miembro del equipo para el panel de asistencia del día. */
type TeamMember = { id: string; name: string };

function formatHoy(): string {
  return new Date().toLocaleDateString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Fecha de negocio de hoy (YYYY-MM-DD) en la zona del dispositivo (Nicaragua = America/Managua). */
function todayBusinessDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Nombre legible desde un join de `employees`. */
function employeeName(emp: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [emp?.first_name, emp?.last_name].filter(Boolean).join(' ').trim() || 'Empleado';
}

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootStackNavigation>();
  const { session, profile, employee } = useAuth();

  const [tardanzasHoy, setTardanzasHoy] = useState(0);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState<SolicitudPendiente[]>([]);
  const [permisosPendientesCount, setPermisosPendientesCount] = useState(0);
  const [checklistsHoy, setChecklistsHoy] = useState<ChecklistHoy[]>([]);
  const [ausenciasHoy, setAusenciasHoy] = useState(0);
  const [teamPresent, setTeamPresent] = useState<TeamMember[]>([]);
  const [teamAbsent, setTeamAbsent] = useState<TeamMember[]>([]);
  const [horasExtrasPendientes, setHorasExtrasPendientes] = useState(0);
  const [ultimasIncidencias, setUltimasIncidencias] = useState<IncidenciaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);

  const handleGestionarSolicitud = async (
    id: string,
    source: SolicitudPendiente['source'],
    nuevoEstado: 'aprobado' | 'rechazado'
  ) => {
    try {
      setUpdatingRequestId(id);

      if (source === 'time_off_requests') {
        const statusWeb = nuevoEstado === 'aprobado' ? 'aprobada' : 'rechazada';
        const { error } = await supabase
          .from('time_off_requests')
          .update({ status: statusWeb })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('employee_requests')
          .update({ status: nuevoEstado })
          .eq('id', id);
        if (error) throw error;
      }

      setSolicitudesPendientes((prev) => prev.filter((s) => s.id !== id));
      setPermisosPendientesCount((prev) => Math.max(0, prev - 1));
    } catch (e: unknown) {
      console.error('Error al gestionar solicitud:', e);
      Alert.alert('Error', errorMessage(e) || 'No se pudo actualizar la solicitud. Intenta de nuevo.');
    } finally {
      setUpdatingRequestId(null);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchDashboardData() {
      try {
        setLoading(true);

        const userId = session?.user?.id ?? null;
        if (!userId) return;

        const companyId = employee?.company_id ?? null;
        if (!companyId) return;

        const role = String(profile?.role ?? '').toLowerCase();
        const primaryBranchId = employee?.branch_id ?? null;
        const isManager = role === 'manager';
        const filterByBranch = isManager && primaryBranchId != null;

        const startOfToday = startOfTodayISO();

        const buildTardanzas = () => {
          let q = supabase
            .from('time_entries')
            .select(filterByBranch ? 'id, employees!inner(branch_id)' : '*', {
              count: 'exact',
              ...(filterByBranch ? {} : { head: true }),
            })
            .eq('company_id', companyId)
            .eq('is_late', true)
            .gte('clock_in', startOfToday);
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const buildSolicitudesLegacy = () => {
          let q = supabase
            .from('employee_requests')
            .select(
              'id, request_type, reason, start_date, employees!inner(first_name, last_name, branch_id)',
              { count: 'exact' }
            )
            .eq('company_id', companyId)
            .in('status', ['pendiente', 'pending'])
            .order('start_date', { ascending: true })
            .limit(12);
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const buildSolicitudesTimeOff = () => {
          let q = supabase
            .from('time_off_requests')
            .select(
              'id, request_type, notes, start_date, employees!inner(first_name, last_name, branch_id)',
              { count: 'exact' }
            )
            .eq('company_id', companyId)
            .in('status', ['pendiente', 'pending'])
            .order('start_date', { ascending: true })
            .limit(12);
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const buildChecklists = () => {
          let q = supabase
            .from('checklist_submissions')
            .select(
              'id, completion_percentage, checklists!inner(title, company_id)' +
                (filterByBranch ? ', employees!inner(branch_id)' : '')
            )
            .gte('submitted_at', startOfToday)
            .eq('checklists.company_id', companyId);
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const buildHorasExtras = () => {
          let q = supabase
            .from('extra_hours_records')
            .select(filterByBranch ? 'id, employees!inner(branch_id)' : '*', {
              count: 'exact',
            })
            .eq('company_id', companyId)
            .eq('status', 'pending');
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        // Agendados hoy (no día libre, no archivado) — quiénes debían trabajar.
        const buildAgendaHoy = () => {
          let q = supabase
            .from('schedules')
            .select('employee_id, employees!inner(first_name, last_name, branch_id)')
            .eq('company_id', companyId)
            .eq('business_date', todayBusinessDate())
            .eq('is_day_off', false)
            .neq('status', 'archived');
          if (filterByBranch) {
            q = q.eq('branch_id', primaryBranchId);
          }
          return q;
        };

        // Marcajes de hoy — quiénes efectivamente llegaron.
        const buildPresentesHoy = () => {
          let q = supabase
            .from('time_entries')
            .select('employee_id, employees!inner(first_name, last_name, branch_id)')
            .eq('company_id', companyId)
            .gte('clock_in', startOfToday);
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const fetchIncidencias = async (): Promise<IncidenciaItem[]> => {
          const limit = filterByBranch ? 40 : 3;
          const { data: rows, error: incErr } = await supabase
            .from('disciplinary_records')
            .select('id, type, reason, date, employee_id')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(limit);
          if (incErr) throw incErr;
          const list = (rows ?? []) as {
            id: string;
            type?: string | null;
            reason?: string | null;
            date?: string | null;
            employee_id?: string | null;
          }[];
          const empIds = [
            ...new Set(list.map((r) => r.employee_id).filter((id): id is string => Boolean(id))),
          ];
          const branchByEmp = new Map<string, string | null>();
          const nameByEmp = new Map<string, string>();
          if (empIds.length) {
            const { data: emps, error: empErr } = await supabase
              .from('employees')
              .select('id, first_name, last_name, branch_id')
              .in('id', empIds);
            if (empErr) throw empErr;
            for (const e of emps ?? []) {
              const er = e as Record<string, unknown>;
              const id = String(er.id ?? '');
              if (!id) continue;
              branchByEmp.set(id, (er.branch_id as string | null) ?? null);
              nameByEmp.set(
                id,
                [er.first_name, er.last_name].filter(Boolean).join(' ').trim() || 'Empleado'
              );
            }
          }
          let filtered = list;
          if (filterByBranch && primaryBranchId) {
            filtered = list.filter((r) => {
              const bid = r.employee_id ? branchByEmp.get(String(r.employee_id)) : undefined;
              return bid === primaryBranchId;
            });
          }
          return filtered.slice(0, 3).map((r) => {
            const nm = r.employee_id ? nameByEmp.get(String(r.employee_id)) : undefined;
            const displayName = nm ?? 'Empleado';
            return {
              id: String(r.id),
              record_type: r.type ?? null,
              description: r.reason ?? null,
              created_at: r.date ?? null,
              profiles: { first_name: displayName, last_name: null as string | null },
            };
          });
        };

        const [
          tardanzasRes,
          solicitudesLegacyRes,
          solicitudesTorRes,
          checklistsRes,
          horasExtrasRes,
          agendaHoyRes,
          presentesHoyRes,
        ] = await Promise.all([
          buildTardanzas(),
          buildSolicitudesLegacy(),
          buildSolicitudesTimeOff(),
          buildChecklists(),
          buildHorasExtras(),
          buildAgendaHoy(),
          buildPresentesHoy(),
        ]);

        if (tardanzasRes.error) throw tardanzasRes.error;
        if (solicitudesLegacyRes.error) throw solicitudesLegacyRes.error;
        if (solicitudesTorRes.error) throw solicitudesTorRes.error;
        if (checklistsRes.error) throw checklistsRes.error;
        if (horasExtrasRes.error) throw horasExtrasRes.error;
        if (agendaHoyRes.error) throw agendaHoyRes.error;
        if (presentesHoyRes.error) throw presentesHoyRes.error;

        const incidenciasItems = await fetchIncidencias();

        if (!isMounted) return;

        type RowEr = {
          id: string;
          request_type: string | null;
          reason: string | null;
          start_date?: string | null;
          employees: SolicitudPendiente['employees'];
        };
        type RowTor = {
          id: string;
          request_type: string | null;
          notes: string | null;
          start_date?: string | null;
          employees: SolicitudPendiente['employees'];
        };
        const legacyRows = (solicitudesLegacyRes.data ?? []) as RowEr[];
        const torRows = (solicitudesTorRes.data ?? []) as RowTor[];
        const merged: SolicitudPendiente[] = [
          ...legacyRows.map((r) => ({
            id: r.id,
            source: 'employee_requests' as const,
            request_type: r.request_type,
            reason: r.reason,
            start_date: r.start_date ?? null,
            employees: r.employees,
          })),
          ...torRows.map((r) => ({
            id: r.id,
            source: 'time_off_requests' as const,
            request_type: r.request_type,
            reason: r.notes,
            start_date: r.start_date ?? null,
            employees: r.employees,
          })),
        ]
          .sort((a, b) => String(a.start_date ?? '').localeCompare(String(b.start_date ?? '')))
          .slice(0, 5);

        const totalPendientes =
          (solicitudesLegacyRes.count ?? 0) + (solicitudesTorRes.count ?? 0);

        // Estado del equipo hoy: presentes = con marcaje; ausentes = agendados sin marcaje.
        type JoinRow = {
          employee_id?: string | null;
          employees?: { first_name?: string | null; last_name?: string | null } | null;
        };
        const presentMap = new Map<string, string>();
        for (const r of (presentesHoyRes.data ?? []) as JoinRow[]) {
          const id = String(r.employee_id ?? '').trim();
          if (id) presentMap.set(id, employeeName(r.employees));
        }
        const scheduledMap = new Map<string, string>();
        for (const r of (agendaHoyRes.data ?? []) as JoinRow[]) {
          const id = String(r.employee_id ?? '').trim();
          if (id) scheduledMap.set(id, employeeName(r.employees));
        }
        const presentes: TeamMember[] = [...presentMap.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const ausentes: TeamMember[] = [...scheduledMap.entries()]
          .filter(([id]) => !presentMap.has(id))
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setTardanzasHoy(tardanzasRes.count ?? 0);
        setSolicitudesPendientes(merged);
        setPermisosPendientesCount(totalPendientes);
        setChecklistsHoy((checklistsRes.data ?? []) as unknown as ChecklistHoy[]);
        setHorasExtrasPendientes(horasExtrasRes.count ?? 0);
        setUltimasIncidencias(incidenciasItems);
        setTeamPresent(presentes);
        setTeamAbsent(ausentes);
        setAusenciasHoy(ausentes.length);
      } catch (e) {
        console.error('Error fetch dashboard:', e);
        if (isMounted) {
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
          setTardanzasHoy(0);
          setSolicitudesPendientes([]);
          setPermisosPendientesCount(0);
          setChecklistsHoy([]);
          setHorasExtrasPendientes(0);
          setUltimasIncidencias([]);
          setTeamPresent([]);
          setTeamAbsent([]);
          setAusenciasHoy(0);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchDashboardData();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, profile?.role, employee?.company_id, employee?.branch_id]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Centro de Mando</Text>
          <Text style={styles.subtitle}>{formatHoy()}</Text>
        </View>

        <TouchableOpacity
          style={styles.radarGpsButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('MapaEmpleados')}
        >
          <Text style={styles.radarGpsButtonText}>🗺️ Radar GPS en Vivo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.incidenciaButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('ReportarIncidencia')}
        >
          <Text style={styles.radarGpsButtonText}>🚩 Reportar Incidencia/Mérito</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.anuncioButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('CrearAnuncio')}
        >
          <Text style={styles.radarGpsButtonText}>📢 Publicar Nuevo Anuncio</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={styles.loadingText}>Cargando datos...</Text>
          </View>
        ) : (
          <>
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Ionicons name="person-remove-outline" size={24} color={theme.danger} />
                <Text style={styles.metricValue}>{ausenciasHoy}</Text>
                <Text style={[styles.metricLabel, { color: theme.danger }]}>Ausencias Hoy</Text>
              </View>
              <View style={styles.metricCard}>
                <Ionicons name="time-outline" size={24} color={theme.warning} />
                <Text style={styles.metricValue}>{tardanzasHoy}</Text>
                <Text style={[styles.metricLabel, { color: theme.warning }]}>Llegadas Tardes</Text>
              </View>
              <View style={styles.metricCard}>
                <Ionicons name="document-text-outline" size={24} color={theme.accent} />
                <Text style={styles.metricValue}>{permisosPendientesCount}</Text>
                <Text style={[styles.metricLabel, { color: theme.accent }]}>Permisos Pendientes</Text>
              </View>
              <View style={styles.metricCard}>
                <Ionicons name="time-outline" size={24} color={theme.accent} />
                <Text style={styles.metricValue}>{horasExtrasPendientes}</Text>
                <Text style={[styles.metricLabel, { color: theme.accent }]}>Horas Extras por Aprobar</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Estado del equipo hoy</Text>
            <View style={styles.section}>
              <View style={styles.teamRow}>
                <View style={[styles.teamPill, { backgroundColor: `${theme.success}1A` }]}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={theme.success} />
                  <Text style={[styles.teamPillText, { color: theme.success }]}>
                    {teamPresent.length} Presentes
                  </Text>
                </View>
                <View style={[styles.teamPill, { backgroundColor: `${theme.danger}1A` }]}>
                  <Ionicons name="person-remove-outline" size={18} color={theme.danger} />
                  <Text style={[styles.teamPillText, { color: theme.danger }]}>
                    {teamAbsent.length} Ausentes
                  </Text>
                </View>
              </View>

              {teamPresent.length === 0 && teamAbsent.length === 0 ? (
                <Text style={styles.emptyText}>
                  No hay turnos agendados ni marcajes registrados para hoy.
                </Text>
              ) : (
                <>
                  <Text style={styles.teamGroupLabel}>✅ Llegaron a trabajar</Text>
                  {teamPresent.length === 0 ? (
                    <Text style={styles.emptyText}>Nadie ha marcado entrada todavía.</Text>
                  ) : (
                    teamPresent.map((m) => (
                      <View key={`p-${m.id}`} style={styles.teamMemberRow}>
                        <View style={[styles.teamDot, { backgroundColor: theme.success }]} />
                        <Text style={styles.teamMemberName}>{m.name}</Text>
                      </View>
                    ))
                  )}

                  <Text style={[styles.teamGroupLabel, { marginTop: 14 }]}>🔴 Ausentes (agendados sin marcaje)</Text>
                  {teamAbsent.length === 0 ? (
                    <Text style={styles.emptyText}>Sin ausencias: todos los agendados marcaron.</Text>
                  ) : (
                    teamAbsent.map((m) => (
                      <View key={`a-${m.id}`} style={styles.teamMemberRow}>
                        <View style={[styles.teamDot, { backgroundColor: theme.danger }]} />
                        <Text style={styles.teamMemberName}>{m.name}</Text>
                      </View>
                    ))
                  )}
                </>
              )}
            </View>

            <Text style={styles.sectionTitle}>Bandeja de Aprobaciones</Text>
            <View style={styles.section}>
              {solicitudesPendientes.length === 0 ? (
                <Text style={styles.emptyText}>No hay solicitudes pendientes.</Text>
              ) : (
                solicitudesPendientes.map((item) => {
                  const nombre = [item.employees?.first_name, item.employees?.last_name]
                    .filter(Boolean)
                    .join(' ') || 'Empleado';
                  const tipo = item.request_type ?? 'Solicitud';
                  const motivo = item.reason?.trim() || 'Sin motivo indicado';
                  const isUpdating = updatingRequestId === item.id;

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.approvalCard}
                      activeOpacity={0.8}
                      onPress={() => {
                        Alert.alert(
                          'Gestionar Solicitud',
                          `${nombre}\n\nTipo: ${tipo}\nMotivo: ${motivo}`,
                          [
                            {
                              text: 'Rechazar',
                              style: 'destructive',
                              onPress: () =>
                                handleGestionarSolicitud(item.id, item.source, 'rechazado'),
                            },
                            {
                              text: 'Aprobar',
                              style: 'default',
                              onPress: () =>
                                handleGestionarSolicitud(item.id, item.source, 'aprobado'),
                            },
                            { text: 'Cancelar', style: 'cancel' },
                          ]
                        );
                      }}
                      disabled={isUpdating}
                    >
                      {isUpdating ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <>
                          <Text style={styles.approvalName}>{nombre}</Text>
                          <Text style={styles.approvalTipo}>{tipo}</Text>
                          <Text style={styles.approvalEstado}>
                            Esperando aprobación
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <Text style={styles.sectionTitle}>Radar Operativo</Text>
            <View style={styles.section}>
              {checklistsHoy.length === 0 ? (
                <Text style={styles.emptyText}>
                  Aún no se han enviado checklists hoy.
                </Text>
              ) : (
                checklistsHoy.map((item) => {
                  const titulo = item.checklists?.title ?? 'Checklist';
                  const pct = item.completion_percentage ?? 0;
                  return (
                    <View key={item.id} style={styles.radarCard}>
                      <Text style={styles.radarChecklist}>{titulo}</Text>
                      <View style={styles.radarRight}>
                        <Text style={styles.radarPct}>{pct}%</Text>
                        {pct >= 100 ? (
                          <Text style={styles.radarOk}>✅</Text>
                        ) : (
                          <Text style={styles.radarPending}>⏳</Text>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <Text style={styles.sectionTitle}>Últimas Incidencias</Text>
            <View style={styles.section}>
              {ultimasIncidencias.length === 0 ? (
                <Text style={styles.emptyText}>No hay incidencias recientes.</Text>
              ) : (
                ultimasIncidencias.map((item) => {
                  const nombre = [item.profiles?.first_name, item.profiles?.last_name]
                    .filter(Boolean)
                    .join(' ') || 'Empleado';
                  const tipoLabel =
                    item.record_type === 'falta'
                      ? 'Falta'
                      : item.record_type === 'merito'
                        ? 'Mérito'
                        : item.record_type === 'amonestacion'
                          ? 'Amonestación'
                          : item.record_type ?? '—';
                  return (
                    <View key={item.id} style={styles.incidenciaCard}>
                      <Text style={styles.approvalName}>{nombre}</Text>
                      <Text style={styles.approvalTipo}>{tipoLabel}</Text>
                      {!!item.description && (
                        <Text style={styles.incidenciaDesc} numberOfLines={2}>
                          {item.description}
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 6,
    textTransform: 'capitalize',
  },
  radarGpsButton: {
    backgroundColor: theme.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  radarGpsButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
  incidenciaButton: {
    backgroundColor: theme.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  anuncioButton: {
    backgroundColor: theme.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  loadingText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },
  metricCard: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.textPrimary,
    marginTop: 8,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 12,
  },
  teamRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  teamPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
  },
  teamPillText: {
    fontSize: 14,
    fontWeight: '700',
  },
  teamGroupLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  teamMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  teamDot: {
    height: 8,
    width: 8,
    borderRadius: 4,
  },
  teamMemberName: {
    fontSize: 14,
    color: theme.textPrimary,
    fontWeight: '500',
  },
  section: {
    marginBottom: 24,
  },
  approvalCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: theme.primary,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  approvalName: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  approvalTipo: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 2,
  },
  approvalEstado: {
    fontSize: 12,
    color: theme.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  radarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  radarChecklist: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  radarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  radarPct: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.primary,
  },
  radarOk: {},
  radarPending: {},
  incidenciaCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: theme.primary,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  incidenciaDesc: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 6,
  },
});
