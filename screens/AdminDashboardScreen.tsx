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
import type { TableUpdate } from '../types/dbHelpers';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { useAdminScope } from '../lib/AdminScopeContext';
import AdminScopeSelector from '../components/AdminScopeSelector';
import { errorMessage } from '../lib/errorMessage';

type SolicitudPendiente = {
  id: string;
  source: 'time_off_requests';
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

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootStackNavigation>();
  const { session } = useAuth();
  const { companyId, branchId } = useAdminScope();
  // Con el selector de empresa/sucursal, el scope es siempre la empresa elegida (no holding-wide).
  const holdingWide = false;

  const [tardanzasHoy, setTardanzasHoy] = useState(0);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState<SolicitudPendiente[]>([]);
  const [permisosPendientesCount, setPermisosPendientesCount] = useState(0);
  const [checklistsHoy, setChecklistsHoy] = useState<ChecklistHoy[]>([]);
  const [ausenciasHoy, setAusenciasHoy] = useState(0);
  const [horasExtrasPendientes, setHorasExtrasPendientes] = useState(0);
  const [ultimasIncidencias, setUltimasIncidencias] = useState<IncidenciaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);

  const handleGestionarSolicitud = async (
    id: string,
    nuevoEstado: 'aprobado' | 'rechazado'
  ) => {
    try {
      setUpdatingRequestId(id);

      const statusWeb = nuevoEstado === 'aprobado' ? 'aprobada' : 'rechazada';
      const { error } = await supabase
        .from('time_off_requests')
        .update({ status: statusWeb } satisfies TableUpdate<'time_off_requests'>)
        .eq('id', id);
      if (error) throw error;

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

        if (!companyId) return;
        const cid = companyId; // no-null para los closures de las queries

        const primaryBranchId = branchId; // sucursal seleccionada (null = todas)
        const filterByBranch = primaryBranchId != null;

        const startOfToday = startOfTodayISO();

        const buildTardanzas = () => {
          let q = supabase
            .from('time_entries')
            .select(filterByBranch ? 'id, employees!inner(branch_id)' : '*', {
              count: 'exact',
              ...(filterByBranch ? {} : { head: true }),
            })
            .eq('is_late', true)
            .gte('clock_in', startOfToday);
          // Holding-wide para líder corporativo: sin filtro company_id → RLS amplía al holding
          // (time_entries tiene política is_corporate_leader vía is_corporate_leader_for_company).
          if (!holdingWide) {
            q = q.eq('company_id', cid);
          }
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const buildSolicitudesTimeOff = () => {
          // Líder corporativo (holdingWide): sin filtro company_id → RLS amplía a todo el holding
          // (time_off_requests tiene path is_corporate_leader en SELECT y UPDATE).
          // Left join en employees (no !inner) salvo filtro por sucursal: un líder con rol
          // `employee` solo ve empleados de su sucursal por RLS, así que con !inner perderíamos
          // las filas del resto del holding. El nombre cae a "Empleado" cuando no es visible.
          const empEmbed = filterByBranch
            ? 'employees!inner(first_name, last_name, branch_id)'
            : 'employees(first_name, last_name, branch_id)';
          let q = supabase
            .from('time_off_requests')
            .select(`id, request_type, notes, start_date, ${empEmbed}`, { count: 'exact' })
            .in('status', ['pendiente', 'pending'])
            .order('start_date', { ascending: true })
            .limit(12);
          if (!holdingWide) {
            q = q.eq('company_id', cid);
          }
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
            .gte('submitted_at', startOfToday);
          // Holding-wide para líder corporativo: checklists tiene path is_corporate_leader en RLS,
          // así que el embed checklists!inner resuelve en todo el holding sin filtrar company_id.
          if (!holdingWide) {
            q = q.eq('checklists.company_id', cid);
          }
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
            .eq('status', 'pending');
          // Holding-wide para líder corporativo (política is_corporate_leader en extra_hours_records).
          if (!holdingWide) {
            q = q.eq('company_id', cid);
          }
          if (filterByBranch) {
            q = q.eq('employees.branch_id', primaryBranchId);
          }
          return q;
        };

        const fetchIncidencias = async (): Promise<IncidenciaItem[]> => {
          const limit = filterByBranch ? 40 : 3;
          let incQ = supabase
            .from('disciplinary_records')
            .select('id, type, reason, date, employee_id')
            .order('date', { ascending: false })
            .limit(limit);
          // Holding-wide para líder corporativo (política is_corporate_leader en disciplinary_records).
          if (!holdingWide) {
            incQ = incQ.eq('company_id', cid);
          }
          const { data: rows, error: incErr } = await incQ;
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

        const [tardanzasRes, solicitudesTorRes, checklistsRes, horasExtrasRes] =
          await Promise.all([
            buildTardanzas(),
            buildSolicitudesTimeOff(),
            buildChecklists(),
            buildHorasExtras(),
          ]);

        if (tardanzasRes.error) throw tardanzasRes.error;
        if (solicitudesTorRes.error) throw solicitudesTorRes.error;
        if (checklistsRes.error) throw checklistsRes.error;
        if (horasExtrasRes.error) throw horasExtrasRes.error;

        const incidenciasItems = await fetchIncidencias();

        // Ausencias hoy: empleados programados hoy (schedules) sin marca de entrada hoy.
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        let ausencias = 0;
        try {
          let schedQ = supabase
            .from('schedules')
            .select('employee_id')
            .eq('company_id', cid)
            .eq('business_date', todayLocal);
          if (filterByBranch && primaryBranchId) schedQ = schedQ.eq('branch_id', primaryBranchId);
          const { data: schedRows } = await schedQ;
          const scheduledIds = new Set(
            (schedRows ?? [])
              .map((r) => String((r as { employee_id?: string | null }).employee_id ?? ''))
              .filter(Boolean),
          );
          if (scheduledIds.size > 0) {
            const { data: clockRows } = await supabase
              .from('time_entries')
              .select('employee_id')
              .eq('company_id', cid)
              .gte('clock_in', startOfToday);
            const clockedIds = new Set(
              (clockRows ?? [])
                .map((r) => String((r as { employee_id?: string | null }).employee_id ?? ''))
                .filter(Boolean),
            );
            for (const id of scheduledIds) if (!clockedIds.has(id)) ausencias += 1;
          }
        } catch {
          ausencias = 0;
        }

        if (!isMounted) return;

        type RowTor = {
          id: string;
          request_type: string | null;
          notes: string | null;
          start_date?: string | null;
          employees: SolicitudPendiente['employees'];
        };
        const torRows = (solicitudesTorRes.data ?? []) as RowTor[];
        const merged: SolicitudPendiente[] = torRows
          .map((r) => ({
            id: r.id,
            source: 'time_off_requests' as const,
            request_type: r.request_type,
            reason: r.notes,
            start_date: r.start_date ?? null,
            employees: r.employees,
          }))
          .sort((a, b) => String(a.start_date ?? '').localeCompare(String(b.start_date ?? '')))
          .slice(0, 5);

        const totalPendientes = solicitudesTorRes.count ?? 0;

        setAusenciasHoy(ausencias);
        setTardanzasHoy(tardanzasRes.count ?? 0);
        setSolicitudesPendientes(merged);
        setPermisosPendientesCount(totalPendientes);
        setChecklistsHoy((checklistsRes.data ?? []) as unknown as ChecklistHoy[]);
        setHorasExtrasPendientes(horasExtrasRes.count ?? 0);
        setUltimasIncidencias(incidenciasItems);
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
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchDashboardData();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, companyId, branchId]);

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

        <AdminScopeSelector />

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
                                handleGestionarSolicitud(item.id, 'rechazado'),
                            },
                            {
                              text: 'Aprobar',
                              style: 'default',
                              onPress: () =>
                                handleGestionarSolicitud(item.id, 'aprobado'),
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
  holdingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
    alignSelf: 'flex-start',
  },
  holdingBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.primary,
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
