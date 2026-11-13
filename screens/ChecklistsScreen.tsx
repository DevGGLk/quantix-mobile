import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

/**
 * Fila de `checklist_mis_checklists` (la misma función que usa el portal web):
 * la BD resuelve a quién está asignado (persona/cargo/área/sucursal), si aplica
 * hoy y el envío del período en curso, en hora de Nicaragua.
 */
type MiChecklist = {
  id: string;
  title: string;
  category: string | null;
  frequency: string | null;
  custom_days_of_week: string[] | null;
  aplica_hoy: boolean;
  period_key: string | null;
  submission_id: string | null;
  submission_status: string | null;
  completion_percentage: number | string | null;
  rejected_reason: string | null;
  metadata: unknown;
  ventana_inicio: string | null;
  ventana_fin: string | null;
  estado_ventana: 'antes' | 'abierta' | 'vencida' | null;
  late_policy: string | null;
  is_late: boolean | null;
};

function hora(iso: string | null): string {
  if (!iso) return '';
  // Hora de Nicaragua (UTC-6, sin horario de verano).
  const d = new Date(new Date(iso).getTime() - 6 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function ventanaTexto(c: MiChecklist): { text: string; color: string } | null {
  if (c.estado_ventana === 'antes') return { text: `Se habilita a las ${hora(c.ventana_inicio)}`, color: '#64748b' };
  if (c.estado_ventana === 'abierta') return { text: `Vence a las ${hora(c.ventana_fin)}`, color: '#047857' };
  if (c.estado_ventana === 'vencida')
    return c.late_policy === 'block'
      ? { text: `Venció a las ${hora(c.ventana_fin)}`, color: '#dc2626' }
      : { text: `Venció a las ${hora(c.ventana_fin)} · se enviará como tarde`, color: '#b45309' };
  return null;
}

const FREQ_LABEL: Record<string, string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
  opening: 'Apertura',
  closing: 'Cierre',
  ondemand: 'Bajo demanda',
  custom_days: 'Días específicos',
};

export default function ChecklistsScreen() {
  const navigation = useNavigation<RootStackNavigation>();
  const { employee } = useAuth();
  const [rows, setRows] = useState<MiChecklist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [equipo, setEquipo] = useState(0);

  const companyId = employee?.company_id ?? null;

  const load = useCallback(async () => {
    if (!companyId) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setError(null);
    const { data, error: err } = await supabase.rpc('checklist_mis_checklists', {
      p_company_id: companyId,
    });
    if (err) {
      setError('No pudimos cargar tus checklists. Revisa tu internet e intenta de nuevo.');
      setRows([]);
    } else {
      setRows((data as MiChecklist[]) ?? []);
    }
    // ¿Le toca revisar? (jefe directo o responsable de un negocio)
    const { data: rolData } = await supabase.rpc('checklist_mi_rol_revision');
    const r = ((rolData ?? []) as { es_jefe: boolean; negocios: string[] | null }[])[0];
    setEquipo(r && (r.es_jefe || (r.negocios ?? []).length > 0) ? 1 : 0);
    setIsLoading(false);
  }, [companyId]);

  // Recarga al volver de responder uno.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const devueltos = rows.filter((r) => r.submission_status === 'rejected');
  const pendientes = rows.filter(
    (r) => !r.submission_id && r.aplica_hoy && !(r.estado_ventana === 'vencida' && r.late_policy === 'block')
  );
  const vencidos = rows.filter(
    (r) => !r.submission_id && r.aplica_hoy && r.estado_ventana === 'vencida' && r.late_policy === 'block'
  );
  const enviados = rows.filter((r) => r.submission_id && r.submission_status !== 'rejected');

  const abrir = (c: MiChecklist) =>
    navigation.navigate('ResolverChecklist', {
      checklist: {
        id: c.id,
        title: c.title,
        category: c.category,
        period_key: c.period_key,
        submission_status: c.submission_status,
        rejected_reason: c.rejected_reason,
        metadata: c.metadata,
        ventana_fin: c.ventana_fin,
        estado_ventana: c.estado_ventana,
      },
    });

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.title}>Checklists Operativos</Text>
        <Text style={styles.subtitle}>
          Responde cada tarea (con foto cuando se pide). Tu avance se guarda solo. Un envío por período; si te lo devuelven, puedes corregirlo.
        </Text>

        {equipo > 0 && (
          <TouchableOpacity style={styles.teamBtn} onPress={() => navigation.navigate('ChecklistsEquipo')}>
            <Ionicons name="people-outline" size={18} color={theme.primary} />
            <Text style={styles.teamBtnText}>Checklists por revisar</Text>
          </TouchableOpacity>
        )}

        {isLoading && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={styles.loaderText}>Cargando listas...</Text>
          </View>
        )}

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {!isLoading && devueltos.length > 0 && (
          <>
            <Text style={[styles.section, { color: theme.danger }]}>Devueltos para corregir</Text>
            {devueltos.map((c) => (
              <TouchableOpacity key={c.id} style={[styles.card, styles.cardRejected]} activeOpacity={0.85} onPress={() => abrir(c)}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.rejectedText}>Motivo: {c.rejected_reason?.trim() || 'sin detalle'}</Text>
                <View style={styles.cardFooter}>
                  <Text style={[styles.cta, { color: theme.danger }]}>Corregir</Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.danger} />
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {!isLoading && (
          <>
            <Text style={styles.section}>Pendientes</Text>
            {pendientes.length === 0 ? (
              <View style={styles.emptyWrapper}>
                <Ionicons name="checkmark-done-outline" size={40} color={theme.textMuted} />
                <Text style={styles.emptyText}>
                  {rows.length === 0
                    ? 'No tienes checklists asignados.'
                    : 'No tienes checklists pendientes por ahora. ¡Buen trabajo!'}
                </Text>
              </View>
            ) : (
              pendientes.map((c) => {
                const info = ventanaTexto(c);
                const antes = c.estado_ventana === 'antes';
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.card, antes && { opacity: 0.6 }]}
                    activeOpacity={0.85}
                    disabled={antes}
                    onPress={() => abrir(c)}
                  >
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <Text style={styles.cardCategory}>
                      {FREQ_LABEL[c.frequency ?? ''] ?? 'Checklist'}
                      {c.category ? ` · ${c.category}` : ''}
                    </Text>
                    {info && <Text style={[styles.windowText, { color: info.color }]}>🕑 {info.text}</Text>}
                    <View style={styles.cardFooter}>
                      <Text style={styles.cta}>{antes ? 'Aún no' : 'Responder'}</Text>
                      {!antes && <Ionicons name="chevron-forward" size={18} color={theme.primary} />}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}

        {!isLoading && vencidos.length > 0 && (
          <>
            <Text style={[styles.section, { color: theme.textMuted }]}>Vencidos (ya no se pueden enviar)</Text>
            {vencidos.map((c) => (
              <View key={c.id} style={[styles.card, { opacity: 0.7 }]}>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={[styles.windowText, { color: '#dc2626' }]}>Venció a las {hora(c.ventana_fin)}</Text>
              </View>
            ))}
          </>
        )}

        {!isLoading && enviados.length > 0 && (
          <>
            <Text style={styles.section}>Enviados en este período</Text>
            {enviados.map((c) => {
              const aprobado = c.submission_status === 'approved';
              return (
                <View key={c.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{c.title}</Text>
                  <Text style={styles.cardCategory}>
                    {Math.round(Number(c.completion_percentage ?? 0) || 0)}% completado
                    {c.is_late ? ' · enviado tarde' : ''}
                  </Text>
                  <Text style={[styles.badge, aprobado ? styles.badgeOk : styles.badgeWait]}>
                    {aprobado ? 'Aprobado' : 'Esperando aprobación'}
                  </Text>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '700', color: theme.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 13, color: theme.textSecondary, marginBottom: 16 },
  section: { fontSize: 15, fontWeight: '700', color: theme.textPrimary, marginTop: 12, marginBottom: 10 },
  loaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  loaderText: { fontSize: 14, color: theme.textSecondary },
  errorText: { fontSize: 13, color: '#dc2626', marginBottom: 12 },
  emptyWrapper: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  emptyText: { fontSize: 14, color: theme.textMuted, textAlign: 'center', marginTop: 8 },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  cardRejected: { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  cardCategory: { marginTop: 4, fontSize: 13, color: theme.textSecondary },
  rejectedText: { marginTop: 6, fontSize: 13, color: '#b91c1c' },
  windowText: { marginTop: 6, fontSize: 13, fontWeight: '600' },
  teamBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  teamBtnText: { fontSize: 14, fontWeight: '700', color: theme.primary },
  cardFooter: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  cta: { fontSize: 14, fontWeight: '700', color: theme.primary },
  badge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  badgeOk: { backgroundColor: '#d1fae5', color: '#065f46' },
  badgeWait: { backgroundColor: '#fef3c7', color: '#92400e' },
});
