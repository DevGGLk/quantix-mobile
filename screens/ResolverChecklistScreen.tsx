import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';
import {
  ITEM_CONFIG_COLUMNS,
  answersFromMetadata,
  evaluate,
  isAnswered,
  itemProblem,
  normalizeItem,
  summarize,
  toRpcPayload,
  type ItemAnswer,
  type ItemConfig,
  type PhotoMeta,
} from '../lib/checklistRespuestas';
import type { RootStackNavigation, RootStackParamList } from '../types/navigation';

const BUCKET = 'checklists_evidence';

/** En la app la foto puede quedar pendiente de subir (sin internet): `localUri`. */
type Answer = ItemAnswer & { localUri?: string | null };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → bytes (Storage acepta Uint8Array; RN no siempre tiene Blob/arrayBuffer de file://). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < len) out[o++] = (n >> 16) & 0xff;
    if (c >= 0 && o < len) out[o++] = (n >> 8) & 0xff;
    if (d >= 0 && o < len) out[o++] = n & 0xff;
  }
  return out.subarray(0, o);
}

/** Ubicación actual (opcional): si se niega o falla, la foto va sin ubicación y el revisor lo ve. */
async function ubicacion(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) granted = (await Location.requestForegroundPermissionsAsync()).granted;
    if (!granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

export default function ResolverChecklistScreen() {
  const navigation = useNavigation<RootStackNavigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'ResolverChecklist'>>();
  const checklist = route.params?.checklist;
  const { employee, session } = useAuth();
  const companyId = employee?.company_id ?? null;
  const userId = session?.user?.id ?? 'anon';
  const devuelto = checklist?.submission_status === 'rejected';
  const draftKey = `checklist-borrador:${userId}:${checklist?.id}:${checklist?.period_key ?? 'x'}`;

  const [items, setItems] = useState<ItemConfig[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!checklist?.id) return;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('checklist_items')
          .select(ITEM_CONFIG_COLUMNS)
          .eq('checklist_id', checklist.id)
          .is('archived_at', null)
          .order('order_index', { ascending: true });
        if (error) throw error;
        const list = ((data ?? []) as Record<string, unknown>[]).map(normalizeItem);
        let initial: Record<string, Answer> = devuelto ? answersFromMetadata(list, checklist.metadata) : {};
        const raw = await AsyncStorage.getItem(draftKey);
        if (raw) {
          const saved = JSON.parse(raw) as Record<string, Answer>;
          const valid = Object.fromEntries(Object.entries(saved).filter(([k]) => list.some((i) => i.id === k)));
          if (Object.keys(valid).length) {
            initial = valid;
            setDraftRestored(true);
          }
        }
        if (!alive) return;
        setItems(list);
        setAnswers(initial);
      } catch {
        if (alive) Alert.alert('Error de conexión', 'No pudimos cargar las tareas. Revisa tu internet e intenta de nuevo.');
      } finally {
        if (alive) {
          setLoading(false);
          loaded.current = true;
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist?.id]);

  // Borrador automático en el teléfono (sobrevive a cerrar la app o quedarse sin internet).
  useEffect(() => {
    if (!loaded.current) return;
    if (Object.keys(answers).length) void AsyncStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey]);

  // URLs firmadas para fotos ya subidas.
  const pathsKey = Object.entries(answers)
    .map(([k, a]) => `${k}:${a.evidence_url ?? ''}`)
    .join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        Object.entries(answers).map(async ([id, a]) => {
          if (!a.evidence_url) return;
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.evidence_url, 3600);
          if (data?.signedUrl) next[id] = data.signedUrl;
        })
      );
      if (alive) setSigned(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  const setAnswer = useCallback((id: string, patch: Partial<Answer>) => {
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const subir = async (itemId: string, uri: string): Promise<string> => {
    if (!companyId || !checklist?.id) throw new Error('No se pudo identificar tu empresa.');
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: EncodingType.Base64 });
    const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    const path = `${companyId}/${checklist.id}/${itemId}/${nombre}`;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, base64ToBytes(b64), { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    return data.path;
  };

  const tomarFoto = async (item: ItemConfig) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos la cámara para tomar la foto de evidencia.');
      return;
    }
    // Solo cámara (no galería): la evidencia es del momento.
    const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (r.canceled || !r.assets?.[0]) return;
    const uri = r.assets[0].uri;
    setBusyItem(item.id);
    const pos = await ubicacion();
    const photo: PhotoMeta = {
      taken_at: new Date().toISOString(),
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      accuracy: pos?.accuracy ?? null,
      source: 'camera',
    };
    const base: Partial<Answer> = item.response_type === 'check' ? { checked: true, na: false } : {};
    try {
      // Se sube de una vez; si no hay internet queda pendiente y se reintenta al enviar.
      const path = await subir(item.id, uri);
      setAnswer(item.id, { ...base, evidence_url: path, localUri: null, photo });
    } catch {
      setAnswer(item.id, { ...base, evidence_url: null, localUri: uri, photo });
    } finally {
      setBusyItem(null);
    }
  };

  /** Para validar, una foto pendiente de subir cuenta como foto. */
  const paraValidar = useMemo(() => {
    const out: Record<string, ItemAnswer> = {};
    for (const [k, a] of Object.entries(answers)) out[k] = { ...a, evidence_url: a.evidence_url ?? (a.localUri ? 'pendiente' : null) };
    return out;
  }, [answers]);
  const resumen = useMemo(() => summarize(items, paraValidar), [items, paraValidar]);
  const pendientesSubir = Object.values(answers).filter((a) => a.localUri && !a.evidence_url).length;

  const handleSubmit = async () => {
    if (!checklist?.id || isSubmitting) return;
    const prob = items.map((it) => ({ it, p: itemProblem(it, paraValidar[it.id]) })).find((x) => x.p);
    if (prob) {
      Alert.alert('Revisa una tarea', `${prob.it.task_description}: ${prob.p}`);
      return;
    }
    if (resumen.tocadas === 0) {
      Alert.alert('Nada que enviar', 'Responde al menos una tarea.');
      return;
    }
    setIsSubmitting(true);
    try {
      // Subir fotos que quedaron pendientes (sin internet al tomarlas).
      const final: Record<string, Answer> = { ...answers };
      for (const [id, a] of Object.entries(answers)) {
        if (a.localUri && !a.evidence_url) {
          setStatus('Subiendo fotos…');
          final[id] = { ...a, evidence_url: await subir(id, a.localUri), localUri: null };
        }
      }
      setAnswers(final);
      setStatus('Enviando…');
      const { data, error } = await supabase.rpc('checklist_enviar', {
        p_checklist_id: checklist.id,
        p_respuestas: toRpcPayload(items, final),
      });
      if (error) throw new Error(error.message);
      await AsyncStorage.removeItem(draftKey);
      const r = (data ?? {}) as {
        completion_percentage?: number;
        score_pct?: number;
        critical_failed?: boolean;
        is_late?: boolean;
      };
      Alert.alert(
        r.is_late ? 'Checklist enviado (tarde)' : 'Checklist enviado',
        `Completado ${Math.round(Number(r.completion_percentage ?? 0))}% · calidad ${Number(r.score_pct ?? 0)}%.` +
          (r.critical_failed ? '\n\nOjo: una tarea crítica no se cumplió.' : '') +
          '\nQueda esperando aprobación.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: unknown) {
      Alert.alert(
        'No se pudo enviar',
        (errorMessage(e) || 'Intenta de nuevo.') + '\n\nTu avance quedó guardado en el teléfono.'
      );
    } finally {
      setIsSubmitting(false);
      setStatus(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{checklist?.title ?? 'Checklist'}</Text>
        <Text style={styles.subtitle}>
          Completado {resumen.completion}% · Calidad {resumen.score}%
          {resumen.critica ? '  · tarea crítica sin cumplir' : ''}
        </Text>
        {draftRestored && <Text style={styles.draft}>Se recuperó tu avance guardado.</Text>}
        {pendientesSubir > 0 && (
          <Text style={styles.pending}>
            {pendientesSubir} foto{pendientesSubir === 1 ? '' : 's'} sin subir (sin internet). Se subirán al enviar.
          </Text>
        )}

        {checklist?.estado_ventana === 'vencida' && (
          <Text style={styles.pending}>Ya pasó la hora límite: se enviará marcado como tarde.</Text>
        )}

        {devuelto && (
          <View style={styles.rejectedBox}>
            <Text style={styles.rejectedTitle}>Te lo devolvieron para corregir</Text>
            <Text style={styles.rejectedText}>{checklist?.rejected_reason?.trim() || 'Sin detalle.'}</Text>
          </View>
        )}

        {loading && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={styles.loaderText}>Cargando tareas...</Text>
          </View>
        )}
        {!loading && items.length === 0 && <Text style={styles.emptyText}>Este checklist no tiene tareas.</Text>}

        {items.map((it, idx) => {
          const a = answers[it.id] ?? {};
          const result = evaluate(it, a);
          const answered = isAnswered(it, a);
          const problem = itemProblem(it, paraValidar[it.id]);
          const preview = a.localUri ?? (a.evidence_url ? signed[it.id] : null);
          const border = a.na ? theme.border : result === false ? '#fca5a5' : result === true ? '#86efac' : theme.border;
          return (
            <View key={it.id} style={[styles.itemCard, { borderColor: border }, a.na && { opacity: 0.7 }]}>
              <View style={styles.itemHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemLabel}>
                    {idx + 1}. {it.is_critical ? '⚠ CRÍTICA · ' : ''}
                    {it.task_description}
                  </Text>
                  {!!it.instructions?.trim() && <Text style={styles.itemHelp}>{it.instructions}</Text>}
                </View>
                {it.allow_na && (
                  <TouchableOpacity
                    style={[styles.naBtn, a.na && styles.naBtnOn]}
                    onPress={() => setAnswer(it.id, a.na ? { na: false } : { na: true, checked: false, value: null })}
                  >
                    <Text style={[styles.naText, a.na && { color: '#fff' }]}>No aplica</Text>
                  </TouchableOpacity>
                )}
              </View>

              {!a.na && (
                <>
                  {it.response_type === 'check' && (
                    <TouchableOpacity
                      style={styles.checkRow}
                      onPress={() => {
                        if (a.checked) setAnswer(it.id, { checked: false });
                        else if (it.photo_rule === 'required' && !a.evidence_url && !a.localUri) void tomarFoto(it);
                        else setAnswer(it.id, { checked: true });
                      }}
                    >
                      <Ionicons name={a.checked ? 'checkbox' : 'square-outline'} size={24} color={a.checked ? theme.primary : theme.textMuted} />
                      <Text style={styles.checkText}>Hecha</Text>
                    </TouchableOpacity>
                  )}
                  {it.response_type === 'yes_no' && (
                    <View style={styles.chips}>
                      {(['yes', 'no'] as const).map((v) => (
                        <TouchableOpacity
                          key={v}
                          style={[styles.chip, a.value === v && styles.chipOn]}
                          onPress={() => setAnswer(it.id, { value: a.value === v ? null : v })}
                        >
                          <Text style={[styles.chipText, a.value === v && styles.chipTextOn]}>{v === 'yes' ? 'Sí' : 'No'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {it.response_type === 'number' && (
                    <View style={styles.numberRow}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        value={a.value ?? ''}
                        onChangeText={(t) => setAnswer(it.id, { value: t })}
                        keyboardType="decimal-pad"
                        placeholder={it.number_min != null && it.number_max != null ? `${it.number_min} a ${it.number_max}` : 'Valor'}
                        placeholderTextColor={theme.textMuted}
                      />
                      {!!it.unit && <Text style={styles.unit}>{it.unit}</Text>}
                    </View>
                  )}
                  {it.response_type === 'text' && (
                    <TextInput
                      style={[styles.input, { minHeight: 60 }]}
                      value={a.value ?? ''}
                      onChangeText={(t) => setAnswer(it.id, { value: t })}
                      multiline
                      maxLength={1000}
                      placeholder="Escribe aquí"
                      placeholderTextColor={theme.textMuted}
                    />
                  )}
                  {it.response_type === 'choice' && (
                    <View style={styles.chips}>
                      {(it.options ?? []).map((o) => (
                        <TouchableOpacity
                          key={o.label}
                          style={[styles.chip, a.value === o.label && styles.chipOn]}
                          onPress={() => setAnswer(it.id, { value: a.value === o.label ? null : o.label })}
                        >
                          <Text style={[styles.chipText, a.value === o.label && styles.chipTextOn]}>{o.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {result === false && <Text style={styles.fail}>No cumple: explica qué pasó.</Text>}
                  {(result === false || (a.note ?? '') !== '') && (
                    <TextInput
                      style={[styles.input, { minHeight: 50 }]}
                      value={a.note ?? ''}
                      onChangeText={(t) => setAnswer(it.id, { note: t })}
                      multiline
                      maxLength={500}
                      placeholder="Comentario (qué pasó, qué se hizo)"
                      placeholderTextColor={theme.textMuted}
                    />
                  )}
                  {result !== false && (a.note ?? '') === '' && answered && (
                    <TouchableOpacity onPress={() => setAnswer(it.id, { note: ' ' })}>
                      <Text style={styles.addNote}>+ Agregar comentario</Text>
                    </TouchableOpacity>
                  )}

                  {it.photo_rule !== 'none' && (it.response_type === 'check' || answered) && (
                    <View style={styles.photoRow}>
                      {preview ? <Image source={{ uri: preview }} style={styles.photo} resizeMode="cover" /> : null}
                      <TouchableOpacity style={styles.photoBtn} onPress={() => void tomarFoto(it)} disabled={busyItem === it.id || isSubmitting}>
                        {busyItem === it.id ? (
                          <ActivityIndicator size="small" color={theme.primary} />
                        ) : (
                          <Ionicons name="camera-outline" size={18} color={theme.primary} />
                        )}
                        <Text style={styles.photoBtnText}>
                          {preview ? 'Cambiar foto' : it.photo_rule === 'required' ? 'Foto (obligatoria)' : 'Foto (opcional)'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!!problem && <Text style={styles.problem}>{problem}</Text>}
                </>
              )}
            </View>
          );
        })}

        {!loading && items.length > 0 && (
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            activeOpacity={0.9}
            onPress={handleSubmit}
            disabled={isSubmitting || Boolean(busyItem)}
          >
            {isSubmitting ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={theme.backgroundAlt} />
                <Text style={styles.submitButtonText}>{status ?? 'Enviando…'}</Text>
              </View>
            ) : (
              <Text style={styles.submitButtonText}>{devuelto ? 'Reenviar corregido' : 'Enviar checklist'}</Text>
            )}
          </TouchableOpacity>
        )}
        {!loading && items.length > 0 && <Text style={styles.footNote}>Tu avance se guarda solo: puedes salir y seguir después.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', color: theme.textPrimary },
  subtitle: { fontSize: 13, color: theme.textSecondary, marginTop: 4, marginBottom: 6 },
  draft: { fontSize: 12, color: '#047857', marginBottom: 6 },
  pending: { fontSize: 12, color: '#b45309', marginBottom: 6 },
  rejectedBox: { backgroundColor: '#fef2f2', borderColor: '#fca5a5', borderWidth: 1, borderRadius: 12, padding: 12, marginVertical: 10 },
  rejectedTitle: { fontSize: 14, fontWeight: '700', color: '#991b1b' },
  rejectedText: { fontSize: 13, color: '#b91c1c', marginTop: 4 },
  loaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
  loaderText: { fontSize: 14, color: theme.textSecondary },
  emptyText: { fontSize: 14, color: theme.textMuted, marginVertical: 16 },
  itemCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    gap: 10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemLabel: { fontSize: 15, color: theme.textPrimary, fontWeight: '600' },
  itemHelp: { fontSize: 12, color: theme.textSecondary, marginTop: 4 },
  naBtn: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  naBtnOn: { backgroundColor: '#334155', borderColor: '#334155' },
  naText: { fontSize: 11, fontWeight: '700', color: theme.textSecondary },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { fontSize: 15, color: theme.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: theme.primary, borderColor: theme.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: theme.textPrimary },
  chipTextOn: { color: '#fff' },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unit: { fontSize: 14, color: theme.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: theme.textPrimary,
    backgroundColor: theme.background,
  },
  fail: { fontSize: 12, fontWeight: '700', color: theme.danger },
  addNote: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 72, height: 72, borderRadius: 8, backgroundColor: theme.border },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  photoBtnText: { fontSize: 14, fontWeight: '700', color: theme.primary },
  problem: { fontSize: 12, color: '#b45309' },
  submitButton: { marginTop: 20, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: theme.backgroundAlt },
  footNote: { fontSize: 12, color: theme.textMuted, textAlign: 'center', marginTop: 8 },
});
