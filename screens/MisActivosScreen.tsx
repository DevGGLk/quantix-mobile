import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

/** Fila activa de `employee_assets` (mismos valores que usa el portal web). */
type AssetRow = {
  id: string;
  asset_name: string;
  category: string;
  serial_number: string | null;
  assigned_at: string;
  accepted_at: string | null;
  notes: string | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Ícono por categoría (mismo criterio que el widget web). */
function categoryIcon(category: string): keyof typeof Ionicons.glyphMap {
  const c = category.trim().toLowerCase();
  if (c.includes('tecnolog')) return 'laptop-outline';
  if (c.includes('herramient')) return 'construct-outline';
  if (c.includes('vehícul') || c.includes('vehicul')) return 'car-outline';
  if (c.includes('uniform')) return 'shirt-outline';
  return 'cube-outline';
}

export default function MisActivosScreen() {
  const { employee } = useAuth();
  const employeeId = employee?.id != null ? String(employee.id).trim() : '';

  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employeeId) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('employee_assets')
        .select('id, asset_name, category, serial_number, assigned_at, accepted_at, notes, status, return_date')
        .eq('employee_id', employeeId)
        .in('status', ['assigned', 'reserved'])
        .is('return_date', null)
        .order('assigned_at', { ascending: false });

      if (error) throw error;

      const mapped: AssetRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id ?? ''),
        asset_name: String(r.asset_name ?? '').trim() || 'Activo',
        category: String(r.category ?? 'Otros').trim() || 'Otros',
        serial_number:
          r.serial_number != null && String(r.serial_number).trim() !== ''
            ? String(r.serial_number).trim()
            : null,
        assigned_at: String(r.assigned_at ?? ''),
        accepted_at:
          r.accepted_at != null && String(r.accepted_at).trim() !== '' ? String(r.accepted_at) : null,
        notes: r.notes != null && String(r.notes).trim() !== '' ? String(r.notes).trim() : null,
      }));
      setRows(mapped);
    } catch (e) {
      console.error('Error en MisActivosScreen:', e);
      Alert.alert(
        'Error de Conexión',
        'No pudimos cargar tus activos. Revisa tu conexión o intenta más tarde.'
      );
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleAccept = useCallback(
    async (assetId: string) => {
      setAcceptingId(assetId);
      try {
        const now = new Date().toISOString();
        const { data, error } = await supabase
          .from('employee_assets')
          .update({ accepted_at: now, updated_at: now })
          .eq('id', assetId)
          .eq('employee_id', employeeId)
          .is('accepted_at', null)
          .in('status', ['assigned', 'reserved'])
          .is('return_date', null)
          .select('id')
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          Alert.alert('Aviso', 'Este activo ya no es elegible o el recibido ya fue confirmado.');
          await load();
          return;
        }
        setRows((prev) => prev.map((r) => (r.id === assetId ? { ...r, accepted_at: now } : r)));
      } catch (e) {
        Alert.alert('Error', errorMessage(e));
      } finally {
        setAcceptingId(null);
      }
    },
    [employeeId, load]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.mutedText}>Cargando tus activos…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
    >
      <Text style={styles.title}>Mis activos asignados</Text>
      <Text style={styles.subtitle}>
        Equipo y bienes bajo tu responsabilidad según el registro de RRHH.
      </Text>

      {rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="cube-outline" size={48} color={theme.textMuted} />
          <Text style={styles.emptyTitle}>Sin activos asignados</Text>
          <Text style={styles.emptySub}>No tienes equipos o bienes físicos asignados actualmente.</Text>
        </View>
      ) : (
        rows.map((row) => {
          const accepted = Boolean(row.accepted_at);
          return (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.iconBadge}>
                  <Ionicons name={categoryIcon(row.category)} size={20} color={theme.primary} />
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.assetName}>{row.asset_name}</Text>
                  <Text style={styles.category}>{row.category}</Text>
                </View>
              </View>

              {row.serial_number ? (
                <Text style={styles.metaLine}>
                  <Text style={styles.metaLabel}>Serie: </Text>
                  {row.serial_number}
                </Text>
              ) : null}
              <Text style={styles.metaLine}>
                <Text style={styles.metaLabel}>Asignado: </Text>
                {formatDate(row.assigned_at)}
              </Text>
              {row.notes ? <Text style={styles.notes}>{row.notes}</Text> : null}

              {accepted ? (
                <View style={styles.acceptedRow}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                  <Text style={styles.acceptedText}>Recibido confirmado el {formatDate(row.accepted_at!)}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.acceptButton, acceptingId === row.id && styles.acceptButtonDisabled]}
                  activeOpacity={0.85}
                  onPress={() => handleAccept(row.id)}
                  disabled={acceptingId === row.id}
                >
                  {acceptingId === row.id ? (
                    <ActivityIndicator color={theme.backgroundAlt} size="small" />
                  ) : (
                    <Text style={styles.acceptButtonText}>Confirmar Recibido</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.background,
  },
  mutedText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: theme.textSecondary,
    marginBottom: 20,
    lineHeight: 18,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  iconBadge: {
    height: 40,
    width: 40,
    borderRadius: 12,
    backgroundColor: theme.subtleBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  category: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textMuted,
    marginTop: 2,
  },
  metaLine: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 2,
  },
  metaLabel: {
    fontWeight: '600',
    color: theme.textMuted,
  },
  notes: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 6,
    fontStyle: 'italic',
  },
  acceptedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  acceptedText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.success,
  },
  acceptButton: {
    marginTop: 14,
    backgroundColor: theme.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonDisabled: {
    opacity: 0.55,
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  emptySub: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 24,
  },
});
