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
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type SolicitudPendiente = {
  id: string;
  request_type: string | null;
  reason: string | null;
  profiles: { first_name?: string | null; last_name?: string | null } | null;
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
  const navigation = useNavigation<any>();
  const { session, profile, employee } = useAuth();

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

      const { error } = await supabase
        .from('employee_requests')
        .update({ status: nuevoEstado })
        .eq('id', id);

      if (error) throw error;

      setSolicitudesPendientes((prev) => prev.filter((s) => s.id !== id));
      setPermisosPendientesCount((prev) => Math.max(0, prev - 1));
    } catch (e: any) {
      console.error('Error al gestionar solicitud:', e);
      Alert.alert(
        'Error',
        e?.message ?? 'No se pudo actualizar la solicitud. Intenta de nuevo.'
      );
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
            .select(filterByBranch ? 'id, profiles!inner(primary_branch_id)' : '*', {
              count: 'exact',
              ...(filterByBranch ? {} : { head: true }),
            })
            .eq('company_id', companyId)
            .eq('is_late', true)
            .gte('clock_in', startOfToday);
          if (filterByBranch) {
            q = q.eq('profiles.primary_branch_id', primaryBranchId);
          }
          return q;
        };

        const buildSolicitudes = () => {
          let q = supabase
            .from('employee_requests')
            .select(
              'id, request_type, reason, profiles!inner(first_name, last_name, primary_branch_id)',
              { count: 'exact' }
            )
            .eq('company_id', companyId)
            .eq('status', 'pendiente')
            .order('created_at', { ascending: false })
            .limit(5);
          if (filterByBranch) {
            q = q.eq('profiles.primary_branch_id', primaryBranchId);
          }
          return q;
        };

        const buildChecklists = () => {
          let q = supabase
            .from('checklist_submissions')
            .select(
              'id, completion_percentage, checklists!inner(title, company_id)' +
                (filterByBranch ? ', profiles!inner(primary_branch_id)' : '')
            )
            .gte('submitted_at', startOfToday)
            .eq('checklists.company_id', companyId);
          if (filterByBranch) {
            q = q.eq('profiles.primary_branch_id', primaryBranchId);
          }
          return q;
        };

        const buildHorasExtras = () => {
          let q = supabase
            .from('extra_hours_records')
            .select(filterByBranch ? 'id, profiles!inner(primary_branch_id)' : '*', {
              count: 'exact',
            })
            .eq('company_id', companyId)
            .eq('status', 'pending');
          if (filterByBranch) {
            q = q.eq('profiles.primary_branch_id', primaryBranchId);
          }
          return q;
        };

        const buildIncidencias = () => {
          let q = supabase
            .from('disciplinary_records')
            .select(
              'id, record_type, description, created_at, profiles!inner(first_name, last_name, primary_branch_id)'
            )
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(3);
          if (filterByBranch) {
            q = q.eq('profiles.primary_branch_id', primaryBranchId);
          }
          return q;
        };

        const [tardanzasRes, solicitudesRes, checklistsRes, horasExtrasRes, incidenciasRes] =
          await Promise.all([
            buildTardanzas(),
            buildSolicitudes(),
            buildChecklists(),
            buildHorasExtras(),
            buildIncidencias(),
          ]);

        if (!isMounted) return;

        setTardanzasHoy(tardanzasRes.count ?? 0);
        setSolicitudesPendientes((solicitudesRes.data ?? []) as SolicitudPendiente[]);
        setPermisosPendientesCount(solicitudesRes.count ?? 0);
        setChecklistsHoy((checklistsRes.data ?? []) as unknown as ChecklistHoy[]);
        setHorasExtrasPendientes(horasExtrasRes.count ?? 0);
        setUltimasIncidencias((incidenciasRes.data ?? []) as IncidenciaItem[]);
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
  }, [session?.user?.id, profile?.role, employee?.company_id, employee?.branch_id]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Centro de Mando GGL</Text>
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

            <Text style={styles.sectionTitle}>Bandeja de Aprobaciones</Text>
            <View style={styles.section}>
              {solicitudesPendientes.length === 0 ? (
                <Text style={styles.emptyText}>No hay solicitudes pendientes.</Text>
              ) : (
                solicitudesPendientes.map((item) => {
                  const nombre = [item.profiles?.first_name, item.profiles?.last_name]
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
                        <ActivityIndicator size="small" color={theme.accent} />
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
    color: theme.primary,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 6,
    textTransform: 'capitalize',
  },
  radarGpsButton: {
    backgroundColor: theme.accent,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.accent,
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
    color: theme.primary,
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
    borderLeftColor: theme.accent,
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
    color: theme.accent,
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
