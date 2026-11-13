import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import {
  FLAG_LABELS,
  ITEM_CONFIG_COLUMNS,
  answerLabel,
  normalizeItem,
  type ItemConfig,
} from '../lib/checklistRespuestas';

const BUCKET = 'checklists_evidence';

type Envio = {
  id: string;
  checklist_id: string;
  employee_id: string;
  period_key: string;
  completion_percentage: number | string | null;
  score_pct: number | string | null;
  critical_failed: boolean | null;
  is_late: boolean | null;
  flags: { item_id?: string; type?: string; detail?: string }[] | null;
  submitted_at: string | null;
  metadata: { responses?: Record<string, Record<string, unknown>> } | null;
  checklists?: { title?: string | null } | null;
};

type Detalle = { items: ItemConfig[]; fotos: Record<string, string>; ordenes: Record<string, string> };

/**
 * Jefe directo: envíos de checklist de su equipo por revisar. Aprueba, devuelve
 * con motivo o crea una orden de mantenimiento desde una tarea (RPC checklist_decidir
 * y checklist_crear_accion_correctiva, que validan permisos en la BD).
 */
export default function ChecklistsEquipoScreen() {
  const [rol, setRol] = useState<{ es_jefe: boolean; negocios: string[] } | null>(null);
  const [team, setTeam] = useState<Record<string, string>>({});
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Bandeja del jefe directo y del responsable de negocio: la BD decide qué le toca.
    const [{ data: rolData }, { data }] = await Promise.all([
      supabase.rpc('checklist_mi_rol_revision'),
      supabase.rpc('checklist_por_revisar'),
    ]);
    const r = ((rolData ?? []) as { es_jefe: boolean; negocios: string[] | null }[])[0];
    setRol({ es_jefe: Boolean(r?.es_jefe), negocios: r?.negocios ?? [] });
    const rows = (data ?? []) as unknown as (Envio & {
      employees?: { first_name?: string | null; last_name?: string | null } | null;
      branches?: { name?: string | null } | null;
    })[];
    const map: Record<string, string> = {};
    for (const e of rows) {
      map[e.employee_id] =
        `${e.employees?.first_name ?? ''} ${e.employees?.last_name ?? ''}`.trim() +
          (e.branches?.name ? ` · ${e.branches.name}` : '') || 'Colaborador';
    }
    setTeam(map);
    setEnvios(rows);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const abrir = async (e: Envio) => {
    if (abierto === e.id) {
      setAbierto(null);
      return;
    }
    setAbierto(e.id);
    setDetalle(null);
    setMotivo('');
    const { data: its } = await supabase
      .from('checklist_items')
      .select(`${ITEM_CONFIG_COLUMNS}, archived_at`)
      .eq('checklist_id', e.checklist_id)
      .order('order_index', { ascending: true });
    const resp = e.metadata?.responses ?? {};
    const items = ((its ?? []) as Record<string, unknown>[])
      .filter((r) => !r.archived_at || resp[String(r.id)])
      .map(normalizeItem);
    const fotos: Record<string, string> = {};
    await Promise.all(
      items.map(async (it) => {
        const path = resp[it.id]?.evidence_url;
        if (typeof path === 'string' && path) {
          const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
          if (s?.signedUrl) fotos[it.id] = s.signedUrl;
        }
      })
    );
    const { data: wo } = await supabase
      .from('work_orders')
      .select('checklist_item_id, status')
      .eq('checklist_submission_id', e.id)
      .neq('status', 'cancelled');
    const ordenes: Record<string, string> = {};
    for (const w of (wo ?? []) as { checklist_item_id: string | null; status: string }[]) {
      if (w.checklist_item_id) ordenes[w.checklist_item_id] = w.status;
    }
    setDetalle({ items, fotos, ordenes });
  };

  const decidir = async (e: Envio, decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !motivo.trim()) {
      Alert.alert('Falta el motivo', 'Escribe por qué lo devuelves para que la persona sepa qué corregir.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('checklist_decidir', {
      p_submission_id: e.id,
      p_decision: decision,
      p_reason: decision === 'reject' ? motivo.trim() : null,
    });
    setBusy(false);
    if (error) {
      Alert.alert('No se pudo guardar', error.message);
      return;
    }
    setAbierto(null);
    void load();
  };

  const crearOrden = async (e: Envio, itemId: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('checklist_crear_accion_correctiva', {
      p_submission_id: e.id,
      p_item_id: itemId,
      p_priority: null,
      p_nota: null,
    });
    setBusy(false);
    if (error) {
      Alert.alert('No se pudo crear', error.message);
      return;
    }
    setDetalle((d) => (d ? { ...d, ordenes: { ...d.ordenes, [itemId]: 'open' } } : d));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Checklists por revisar</Text>
      {rol && (rol.es_jefe || rol.negocios.length > 0) ? (
        <Text style={styles.muted}>
          Te toca como {[rol.negocios.length ? `responsable de ${rol.negocios.join(', ')}` : null, rol.es_jefe ? 'jefe directo' : null]
            .filter(Boolean)
            .join(' · ')}
          .
        </Text>
      ) : null}
      {loading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 20 }} />
      ) : !rol || (!rol.es_jefe && rol.negocios.length === 0) ? (
        <Text style={styles.muted}>No tienes checklists que revisar (no eres jefe directo ni responsable de un negocio).</Text>
      ) : envios.length === 0 ? (
        <Text style={styles.muted}>No hay checklists por revisar. 🎉</Text>
      ) : (
        envios.map((e) => {
          const open = abierto === e.id;
          const resp = e.metadata?.responses ?? {};
          return (
            <View key={e.id} style={[styles.card, e.critical_failed ? styles.cardCritical : null]}>
              <TouchableOpacity onPress={() => void abrir(e)} activeOpacity={0.8}>
                <Text style={styles.cardTitle}>{e.checklists?.title ?? 'Checklist'}</Text>
                <Text style={styles.cardSub}>
                  {team[e.employee_id] ?? 'Colaborador'} · {Math.round(Number(e.completion_percentage ?? 0))}% · calidad{' '}
                  {e.score_pct == null ? '—' : `${Math.round(Number(e.score_pct))}%`}
                </Text>
                {e.critical_failed ? <Text style={styles.critical}>⚠ Tarea crítica sin cumplir</Text> : null}
                {e.is_late ? <Text style={styles.warn}>Enviado tarde</Text> : null}
                {(e.flags?.length ?? 0) > 0 ? <Text style={styles.warn}>{e.flags!.length} señal(es) en fotos</Text> : null}
              </TouchableOpacity>

              {open && !detalle && <ActivityIndicator color={theme.primary} style={{ marginTop: 10 }} />}
              {open && detalle && (
                <View style={{ marginTop: 10, gap: 10 }}>
                  {detalle.items.map((it, idx) => {
                    const cell = resp[it.id];
                    const passed = cell?.passed as boolean | undefined;
                    const label = answerLabel(it, cell);
                    const note = typeof cell?.note === 'string' ? cell.note.trim() : '';
                    const flags = (e.flags ?? []).filter((f) => f.item_id === it.id);
                    return (
                      <View key={it.id} style={[styles.item, passed === false && { borderColor: '#fca5a5' }]}>
                        <Text style={styles.itemTitle}>
                          {idx + 1}. {it.is_critical ? '⚠ ' : ''}
                          {it.task_description}
                        </Text>
                        <Text style={[styles.answer, passed === false ? { color: theme.danger } : null]}>
                          {passed === false ? '✗ ' : ''}
                          {label}
                          {passed === false ? ' — no cumple' : ''}
                        </Text>
                        {!!note && <Text style={styles.note}>💬 {note}</Text>}
                        {flags.map((f, i) => (
                          <Text key={i} style={styles.warn}>
                            ⚠ {FLAG_LABELS[f.type ?? ''] ?? f.type}
                            {f.detail ? `: ${f.detail}` : ''}
                          </Text>
                        ))}
                        {detalle.fotos[it.id] ? (
                          <Image source={{ uri: detalle.fotos[it.id] }} style={styles.photo} resizeMode="cover" />
                        ) : null}
                        {detalle.ordenes[it.id] ? (
                          <Text style={styles.wo}>🛠 Orden de mantenimiento creada</Text>
                        ) : label !== 'Sin responder' && label !== 'No aplica' ? (
                          <TouchableOpacity onPress={() => void crearOrden(e, it.id)} disabled={busy}>
                            <Text style={styles.link}>+ Crear orden de mantenimiento</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                  <TextInput
                    style={styles.input}
                    value={motivo}
                    onChangeText={setMotivo}
                    placeholder="Motivo (obligatorio si lo devuelves)"
                    placeholderTextColor={theme.textMuted}
                    multiline
                    maxLength={1000}
                  />
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={() => void decidir(e, 'reject')} disabled={busy}>
                      <Text style={styles.btnRejectText}>Devolver</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, styles.btnApprove]} onPress={() => void decidir(e, 'approve')} disabled={busy}>
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnApproveText}>Aprobar</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: theme.textPrimary, marginBottom: 12 },
  muted: { fontSize: 14, color: theme.textMuted, marginTop: 12 },
  card: { backgroundColor: theme.backgroundAlt, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  cardCritical: { borderColor: '#fca5a5' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  cardSub: { fontSize: 13, color: theme.textSecondary, marginTop: 4 },
  critical: { fontSize: 12, fontWeight: '700', color: theme.danger, marginTop: 4 },
  warn: { fontSize: 12, fontWeight: '600', color: '#b45309', marginTop: 2 },
  item: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10, gap: 4 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: theme.textPrimary },
  answer: { fontSize: 13, fontWeight: '600', color: '#047857' },
  note: { fontSize: 12, color: theme.textSecondary },
  photo: { width: 120, height: 120, borderRadius: 8, marginTop: 4, backgroundColor: theme.border },
  wo: { fontSize: 12, fontWeight: '600', color: theme.primary },
  link: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: theme.textPrimary,
    minHeight: 50,
  },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnReject: { borderWidth: 1, borderColor: theme.danger },
  btnRejectText: { color: theme.danger, fontWeight: '700' },
  btnApprove: { backgroundColor: '#059669' },
  btnApproveText: { color: '#fff', fontWeight: '700' },
});
