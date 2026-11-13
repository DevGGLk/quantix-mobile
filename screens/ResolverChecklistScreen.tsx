import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';
import type { RootStackNavigation, RootStackParamList } from '../types/navigation';

const BUCKET = 'checklists_evidence';

type ChecklistItem = {
  id: string;
  task_description: string;
  instructions: string | null;
  order_index: number | null;
};

/** Estado por tarea: `path` = foto ya en Storage; `localUri` = foto recién tomada. */
type Resp = { checked: boolean; path: string | null; localUri: string | null; previewUrl: string | null };

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

function previousPaths(metadata: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const resp = (metadata as { responses?: Record<string, { evidence_url?: string | null }> } | null)?.responses;
  if (!resp || typeof resp !== 'object') return out;
  for (const [k, v] of Object.entries(resp)) {
    const p = typeof v?.evidence_url === 'string' ? v.evidence_url.trim() : '';
    if (p) out[k] = p;
  }
  return out;
}

export default function ResolverChecklistScreen() {
  const navigation = useNavigation<RootStackNavigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'ResolverChecklist'>>();
  const checklist = route.params?.checklist;
  const { employee } = useAuth();
  const companyId = employee?.company_id ?? null;
  const devuelto = checklist?.submission_status === 'rejected';

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [resp, setResp] = useState<Record<string, Resp>>({});
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!checklist?.id) return;
    let alive = true;
    (async () => {
      try {
        setIsLoadingItems(true);
        const { data, error } = await supabase
          .from('checklist_items')
          .select('id, task_description, instructions, order_index')
          .eq('checklist_id', checklist.id)
          .is('archived_at', null)
          .order('order_index', { ascending: true });
        if (error) throw error;
        const list = (data as ChecklistItem[]) ?? [];

        // Si fue devuelto, se precargan las fotos que ya había enviado.
        const prev = devuelto ? previousPaths(checklist.metadata) : {};
        const init: Record<string, Resp> = {};
        await Promise.all(
          list.map(async (it) => {
            const path = prev[it.id] ?? null;
            let previewUrl: string | null = null;
            if (path) {
              const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
              previewUrl = s?.signedUrl ?? null;
            }
            init[it.id] = { checked: Boolean(path), path, localUri: null, previewUrl };
          })
        );
        if (!alive) return;
        setItems(list);
        setResp(init);
      } catch (e) {
        if (alive) {
          setItems([]);
          Alert.alert('Error de conexión', 'No pudimos cargar las tareas. Revisa tu internet e intenta de nuevo.');
        }
      } finally {
        if (alive) setIsLoadingItems(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [checklist?.id]);

  const done = useMemo(
    () => items.filter((it) => resp[it.id]?.checked && (resp[it.id]?.path || resp[it.id]?.localUri)).length,
    [items, resp]
  );
  const marcadasSinFoto = items.some((it) => resp[it.id]?.checked && !resp[it.id]?.path && !resp[it.id]?.localUri);
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const tomarFoto = async (itemId: string) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos la cámara para tomar la foto de evidencia.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (r.canceled || !r.assets?.[0]) return;
    const uri = r.assets[0].uri;
    setResp((prev) => ({ ...prev, [itemId]: { checked: true, path: null, localUri: uri, previewUrl: uri } }));
  };

  const toggle = (itemId: string) => {
    const cur = resp[itemId];
    if (cur?.checked) {
      setResp((prev) => ({ ...prev, [itemId]: { checked: false, path: null, localUri: null, previewUrl: null } }));
    } else {
      // Marcar exige foto: se abre la cámara directamente.
      void tomarFoto(itemId);
    }
  };

  const subir = async (itemId: string, uri: string): Promise<string> => {
    if (!companyId || !checklist?.id) throw new Error('No se pudo identificar tu empresa.');
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: EncodingType.Base64 });
    const bytes = base64ToBytes(b64);
    const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    const path = `${companyId}/${checklist.id}/${itemId}/${nombre}`;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    return data.path;
  };

  const handleSubmit = async () => {
    if (!checklist?.id || isSubmitting) return;
    if (marcadasSinFoto) {
      Alert.alert('Falta una foto', 'Cada tarea marcada necesita su foto.');
      return;
    }
    if (done === 0) {
      Alert.alert('Nada que enviar', 'Marca al menos una tarea con su foto.');
      return;
    }
    try {
      setIsSubmitting(true);
      const respuestas: Record<string, { checked: boolean; evidence_url: string | null }> = {};
      for (const it of items) {
        const r = resp[it.id];
        if (!r?.checked) {
          respuestas[it.id] = { checked: false, evidence_url: null };
          continue;
        }
        let path = r.path;
        if (r.localUri) {
          setStatus('Subiendo fotos…');
          path = await subir(it.id, r.localUri);
        }
        respuestas[it.id] = { checked: true, evidence_url: path };
      }
      setStatus('Enviando…');
      const { data, error } = await supabase.rpc('checklist_enviar', {
        p_checklist_id: checklist.id,
        p_respuestas: respuestas,
      });
      if (error) throw new Error(error.message);
      const enviado = Math.round(Number((data as { completion_percentage?: number | string } | null)?.completion_percentage ?? pct) || 0);
      Alert.alert('Checklist enviado', `Cumplimiento: ${enviado}%. Queda esperando aprobación.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: unknown) {
      Alert.alert('No se pudo enviar', errorMessage(e) || 'Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
      setStatus(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{checklist?.title ?? 'Checklist'}</Text>
        <Text style={styles.subtitle}>
          {done} de {items.length} tareas con foto · {pct}%
        </Text>

        {devuelto && (
          <View style={styles.rejectedBox}>
            <Text style={styles.rejectedTitle}>Te lo devolvieron para corregir</Text>
            <Text style={styles.rejectedText}>{checklist?.rejected_reason?.trim() || 'Sin detalle.'}</Text>
          </View>
        )}

        {isLoadingItems && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={styles.loaderText}>Cargando tareas...</Text>
          </View>
        )}

        {!isLoadingItems && items.length === 0 && (
          <Text style={styles.emptyText}>Este checklist no tiene tareas configuradas.</Text>
        )}

        {!isLoadingItems &&
          items.map((it) => {
            const r = resp[it.id];
            const checked = Boolean(r?.checked);
            return (
              <View key={it.id} style={styles.itemCard}>
                <TouchableOpacity style={styles.itemRow} activeOpacity={0.7} onPress={() => toggle(it.id)}>
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={24}
                    color={checked ? theme.primary : theme.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{it.task_description}</Text>
                    {!!it.instructions?.trim() && <Text style={styles.itemHelp}>{it.instructions}</Text>}
                  </View>
                </TouchableOpacity>
                {checked && (
                  <View style={styles.photoRow}>
                    {r?.previewUrl ? (
                      <Image source={{ uri: r.previewUrl }} style={styles.photo} resizeMode="cover" />
                    ) : (
                      <Text style={styles.missing}>Falta la foto</Text>
                    )}
                    <TouchableOpacity style={styles.photoBtn} onPress={() => void tomarFoto(it.id)} disabled={isSubmitting}>
                      <Ionicons name="camera-outline" size={18} color={theme.primary} />
                      <Text style={styles.photoBtnText}>{r?.previewUrl ? 'Cambiar foto' : 'Tomar foto'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

        {!isLoadingItems && items.length > 0 && (
          <TouchableOpacity
            style={[styles.submitButton, (isSubmitting || marcadasSinFoto || done === 0) && styles.submitButtonDisabled]}
            activeOpacity={0.9}
            onPress={handleSubmit}
            disabled={isSubmitting}
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: theme.textPrimary },
  subtitle: { fontSize: 13, color: theme.textSecondary, marginTop: 4, marginBottom: 16 },
  rejectedBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  rejectedTitle: { fontSize: 14, fontWeight: '700', color: '#991b1b' },
  rejectedText: { fontSize: 13, color: '#b91c1c', marginTop: 4 },
  loaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  loaderText: { fontSize: 14, color: theme.textSecondary },
  emptyText: { fontSize: 14, color: theme.textMuted, marginBottom: 16 },
  itemCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  itemLabel: { fontSize: 15, color: theme.textPrimary, fontWeight: '600' },
  itemHelp: { fontSize: 12, color: theme.textSecondary, marginTop: 4 },
  photoRow: { marginTop: 10, marginLeft: 36, flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 72, height: 72, borderRadius: 8, backgroundColor: theme.border },
  missing: { fontSize: 13, color: theme.danger, fontWeight: '600' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10 },
  photoBtnText: { fontSize: 14, fontWeight: '700', color: theme.primary },
  submitButton: {
    marginTop: 20,
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: theme.backgroundAlt },
});
