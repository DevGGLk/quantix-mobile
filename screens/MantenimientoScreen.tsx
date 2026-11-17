import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { EncodingType } from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

/**
 * Mantenimiento en la app (ronda 2, 16/11/2026). Igual que Mi Portal en la web:
 * - Reportar un arreglo (qué, sucursal, lugar, tipo, urgencia, foto con la cámara).
 * - Mis reportes y «¿Quedó bien?» (sí / reabrir).
 * - Técnico: mis órdenes, empezar, terminar con foto + quiénes participaron,
 *   registrar un trabajo hecho sin solicitud.
 */

const BUCKET = 'work_order_evidence';
const CATEGORIES = [
  'Puertas y cerraduras',
  'Fontanería / agua',
  'Electricidad / iluminación',
  'Aire acondicionado / refrigeración',
  'Equipo de cocina',
  'Mobiliario',
  'Pintura y paredes',
  'Techo / goteras',
  'Limpieza profunda',
  'Otro',
];
const PRIORITY: Record<string, { label: string; hint: string; color: string }> = {
  low: { label: 'Puede esperar', hint: 'Esta semana', color: '#64748b' },
  normal: { label: 'Normal', hint: '1–2 días', color: '#0284c7' },
  high: { label: 'Importante', hint: 'Hoy', color: '#d97706' },
  urgent: { label: 'Urgente', hint: 'Ya', color: '#dc2626' },
};
const STATUS: Record<string, string> = {
  open: 'Sin asignar',
  assigned: 'Asignada',
  in_progress: 'En proceso',
  resolved: 'Resuelta',
  cancelled: 'Cancelada',
};

type WO = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  location_text: string | null;
  priority: string;
  status: string;
  problem_photo: string | null;
  resolution_photo: string | null;
  requester_confirmation: 'ok' | 'reabierta' | null;
  requester_comment: string | null;
  reopened_count: number;
  created_at: string;
  due_at: string | null;
};

/** «Vence en 3 h» / «Vencida hace 2 h» (solo órdenes abiertas). */
function sla(o: WO): { text: string; color: string } | null {
  if (!o.due_at || !['open', 'assigned', 'in_progress'].includes(o.status)) return null;
  const mins = Math.round((new Date(o.due_at).getTime() - Date.now()) / 60_000);
  const fmt = (m: number) => (m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`);
  if (mins < 0) return { text: `Vencida hace ${fmt(-mins)}`, color: '#dc2626' };
  return { text: `Vence en ${fmt(mins)}`, color: mins < 120 ? '#d97706' : '#64748b' };
}
type Member = { work_order_id: string; employee_id: string; role: 'responsable' | 'apoyo' };
type Tech = { employee_id: string; employee_name: string | null };
type Branch = { id: string; name: string; company_id: string };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
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
  return out;
}

async function tomarFoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permiso requerido', 'Necesitamos la cámara para la foto.');
    return null;
  }
  const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
  if (r.canceled || !r.assets?.[0]) return null;
  return r.assets[0].uri;
}

async function subirFoto(uri: string, companyId: string, orderId: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const path = `${companyId}/${orderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { data, error } = await supabase.storage.from(BUCKET).upload(path, base64ToBytes(b64), {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return data.path;
}

async function verFoto(path: string | null) {
  if (!path) return;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (data?.signedUrl) {
    const { Linking } = await import('react-native');
    void Linking.openURL(data.signedUrl);
  }
}

function cuando(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

export default function MantenimientoScreen() {
  const { session, employee } = useAuth();
  const me = employee as { id: string; company_id: string; branch_id: string | null } | null;
  const [isTech, setIsTech] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mine, setMine] = useState<WO[]>([]);
  const [queue, setQueue] = useState<WO[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [groupBranches, setGroupBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Reportar
  const [title, setTitle] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState('normal');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Terminar / registrar trabajo
  const [closing, setClosing] = useState<{ order: WO | null } | null>(null);
  const [note, setNote] = useState('');
  const [closePhoto, setClosePhoto] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [selfLog, setSelfLog] = useState<{ title: string; branchId: string | null; location: string }>({
    title: '',
    branchId: null,
    location: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!me?.id) return;
    try {
      const [{ data: emp }, { data: br }, { data: reqs }] = await Promise.all([
        supabase.from('employees').select('is_maintenance_technician').eq('id', me.id).maybeSingle(),
        supabase.from('branches').select('id, name, company_id').eq('company_id', me.company_id).eq('is_active', true).order('name'),
        supabase.from('work_orders').select('*').eq('requested_by', me.id).order('created_at', { ascending: false }).limit(30),
      ]);
      const tech = Boolean((emp as { is_maintenance_technician?: boolean } | null)?.is_maintenance_technician);
      setIsTech(tech);
      setBranches((br ?? []) as Branch[]);
      setBranchId((prev) => prev ?? me.branch_id ?? null);
      setMine((reqs ?? []) as WO[]);
      if (tech) {
        const { data: mm } = await supabase.from('work_order_members').select('work_order_id, employee_id, role').eq('employee_id', me.id);
        const ids = ((mm ?? []) as Member[]).map((m) => m.work_order_id);
        let q: WO[] = [];
        if (ids.length) {
          const { data: qo } = await supabase
            .from('work_orders')
            .select('*')
            .in('id', ids)
            .in('status', ['assigned', 'in_progress'])
            .order('created_at', { ascending: false });
          q = (qo ?? []) as WO[];
        }
        setQueue(q);
        if (q.length) {
          const { data: all } = await supabase
            .from('work_order_members')
            .select('work_order_id, employee_id, role')
            .in('work_order_id', q.map((o) => o.id));
          setMembers((all ?? []) as Member[]);
        } else setMembers([]);
        const [{ data: t }, { data: gb }] = await Promise.all([
          supabase.rpc('maintenance_technicians_in_holding', { p_company_id: me.company_id }),
          supabase.rpc('holding_branches_for_technician'),
        ]);
        setTechs((t ?? []) as Tech[]);
        setGroupBranches(
          ((gb ?? []) as { branch_id: string; branch_name: string; company_id: string; company_name: string | null }[]).map((b) => ({
            id: b.branch_id,
            name: b.company_name ? `${b.branch_name} · ${b.company_name}` : b.branch_name,
            company_id: b.company_id,
          })),
        );
      }
    } catch (e) {
      Alert.alert('Mantenimiento', errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [me?.id, me?.company_id, me?.branch_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const enviar = async () => {
    if (!me || !session?.user) return;
    if (!title.trim()) return Alert.alert('Falta algo', 'Escribe qué necesita arreglo.');
    if (!branchId) return Alert.alert('Falta algo', 'Elige la sucursal.');
    if (!location.trim()) return Alert.alert('Falta algo', 'Escribe dónde exactamente (ej.: bodega trasera).');
    setSending(true);
    try {
      const { data: ins, error } = await supabase
        .from('work_orders')
        .insert({
          company_id: me.company_id,
          branch_id: branchId,
          source: 'request',
          title: title.trim(),
          location_text: location.trim(),
          category,
          priority,
          requested_by: me.id,
          created_by: session.user.id,
          status: 'open',
        })
        .select('id')
        .single();
      if (error) throw error;
      if (photoUri && ins?.id) {
        const path = await subirFoto(photoUri, me.company_id, ins.id as string);
        await supabase.from('work_orders').update({ problem_photo: path }).eq('id', ins.id);
      }
      setTitle('');
      setLocation('');
      setCategory(null);
      setPriority('normal');
      setPhotoUri(null);
      Alert.alert('Enviado', 'El equipo de mantenimiento ya fue avisado.');
      void load();
    } catch (e) {
      Alert.alert('No se pudo enviar', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  // Motivo para reabrir: misma ventana en Android y iPhone.
  const [reopen, setReopen] = useState<{ order: WO; text: string } | null>(null);
  const confirmar = (o: WO, ok: boolean) => {
    if (!ok) {
      setReopen({ order: o, text: '' });
      return;
    }
    void supabase.rpc('wo_confirm', { p_order: o.id, p_ok: true, p_comment: null }).then(({ error }) => {
      if (error) Alert.alert('Error', error.message);
      else void load();
    });
  };

  const empezar = async (o: WO) => {
    const { error } = await supabase.rpc('wo_start', { p_order: o.id });
    if (error) Alert.alert('Error', error.message);
    else void load();
  };

  const abrirCierre = (order: WO | null) => {
    if (!me) return;
    const team = order ? members.filter((m) => m.work_order_id === order.id).map((m) => m.employee_id) : [me.id];
    setParticipants(new Set(team.length ? team : [me.id]));
    setNote('');
    setClosePhoto(null);
    setClosing({ order });
  };

  const terminar = async () => {
    if (!closing || !me || !session?.user) return;
    if (!closePhoto) return Alert.alert('Falta la foto', 'Toma una foto del trabajo terminado.');
    if (participants.size === 0) return Alert.alert('Falta algo', 'Marca quién hizo el trabajo.');
    setBusy(true);
    try {
      let order = closing.order;
      if (!order) {
        const br = groupBranches.find((b) => b.id === selfLog.branchId);
        if (!selfLog.title.trim() || !br) throw new Error('Escribe qué hiciste y en qué sucursal.');
        const { data: ins, error } = await supabase
          .from('work_orders')
          .insert({
            company_id: br.company_id,
            branch_id: br.id,
            source: 'self_log',
            title: selfLog.title.trim(),
            location_text: selfLog.location.trim() || null,
            requested_by: me.id,
            assigned_to: me.id,
            assigned_at: new Date().toISOString(),
            created_by: session.user.id,
            status: 'in_progress',
            priority: 'normal',
          })
          .select('*')
          .single();
        if (error) throw error;
        order = ins as WO;
      }
      const path = await subirFoto(closePhoto, order.company_id, order.id);
      const { error } = await supabase.rpc('wo_close', {
        p_order: order.id,
        p_note: note,
        p_photo: path,
        p_participants: Array.from(participants),
      });
      if (error) throw error;
      setClosing(null);
      setSelfLog({ title: '', branchId: null, location: '' });
      Alert.alert('¡Listo!', 'Trabajo registrado.');
      void load();
    } catch (e) {
      Alert.alert('No se pudo guardar', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }
  if (!me) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No encontramos tu ficha de colaborador.</Text>
      </View>
    );
  }

  const chip = (selected: boolean) => [styles.chip, selected && styles.chipOn];

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {isTech && (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.h2}>Mis órdenes de trabajo</Text>
              <TouchableOpacity onPress={() => abrirCierre(null)}>
                <Text style={styles.link}>+ Registrar trabajo</Text>
              </TouchableOpacity>
            </View>
            {queue.length === 0 ? (
              <Text style={styles.muted}>No tienes órdenes pendientes.</Text>
            ) : (
              queue.map((o) => {
                const pr = PRIORITY[o.priority] ?? PRIORITY.normal;
                const role = members.find((m) => m.work_order_id === o.id && m.employee_id === me.id)?.role;
                return (
                  <View key={o.id} style={styles.item}>
                    <View style={styles.row}>
                      <Text style={[styles.pill, { backgroundColor: pr.color }]}>{pr.label}</Text>
                      <Text style={styles.small}>{STATUS[o.status]}</Text>
                      {role && <Text style={styles.small}>· {role === 'responsable' ? 'Responsable' : 'Apoyo'}</Text>}
                      {(() => {
                        const s = sla(o);
                        return s ? <Text style={[styles.pill, { backgroundColor: s.color }]}>⏱ {s.text}</Text> : null;
                      })()}
                    </View>
                    <Text style={styles.itemTitle}>{o.title}</Text>
                    <Text style={styles.small}>
                      📍 {o.location_text ?? '—'} · {cuando(o.created_at)}
                    </Text>
                    {o.reopened_count > 0 && !!o.requester_comment && (
                      <Text style={[styles.small, { color: theme.danger }]}>Reabierta: «{o.requester_comment}»</Text>
                    )}
                    <View style={styles.row}>
                      {!!o.problem_photo && (
                        <TouchableOpacity onPress={() => void verFoto(o.problem_photo)}>
                          <Text style={styles.link}>Ver foto</Text>
                        </TouchableOpacity>
                      )}
                      {o.status === 'assigned' && (
                        <TouchableOpacity style={styles.btnGhost} onPress={() => void empezar(o)}>
                          <Text style={styles.btnGhostText}>Empezar</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.btnOk} onPress={() => abrirCierre(o)}>
                        <Text style={styles.btnText}>Terminar con foto</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.h2}>Reportar algo que necesita arreglo</Text>
          <TextInput style={styles.input} placeholder="¿Qué pasa? Ej.: la puerta del baño no cierra" value={title} onChangeText={setTitle} />
          <Text style={styles.label}>¿En qué sucursal?</Text>
          <View style={styles.wrap}>
            {branches.map((b) => (
              <TouchableOpacity key={b.id} style={chip(branchId === b.id)} onPress={() => setBranchId(b.id)}>
                <Text style={[styles.chipText, branchId === b.id && styles.chipTextOn]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} placeholder="¿Dónde exactamente? Ej.: bodega trasera" value={location} onChangeText={setLocation} />
          <Text style={styles.label}>Tipo (opcional)</Text>
          <View style={styles.wrap}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={chip(category === c)} onPress={() => setCategory(category === c ? null : c)}>
                <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>¿Qué tan urgente?</Text>
          <View style={styles.wrap}>
            {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
              <TouchableOpacity key={p} style={chip(priority === p)} onPress={() => setPriority(p)}>
                <Text style={[styles.chipText, priority === p && styles.chipTextOn]}>
                  {PRIORITY[p].label} · {PRIORITY[p].hint}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.photoBtn} onPress={async () => setPhotoUri((await tomarFoto()) ?? photoUri)}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.thumb} />
            ) : (
              <Ionicons name="camera-outline" size={22} color={theme.primary} />
            )}
            <Text style={styles.link}>{photoUri ? 'Foto lista · tocar para cambiar' : 'Tomar foto (recomendado)'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnPrimary, sending && { opacity: 0.6 }]} disabled={sending} onPress={() => void enviar()}>
            <Text style={styles.btnText}>{sending ? 'Enviando…' : 'Enviar'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.h2}>Mis reportes</Text>
          {mine.length === 0 ? (
            <Text style={styles.muted}>Todavía no has reportado nada.</Text>
          ) : (
            mine.map((o) => (
              <View key={o.id} style={styles.item}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.itemTitle, { flex: 1 }]}>{o.title}</Text>
                  <Text style={styles.small}>{STATUS[o.status]}</Text>
                </View>
                <Text style={styles.small}>
                  {o.location_text ? `${o.location_text} · ` : ''}
                  {cuando(o.created_at)}
                </Text>
                {o.status === 'resolved' &&
                  (o.requester_confirmation === 'ok' ? (
                    <Text style={[styles.small, { color: theme.success, fontWeight: '700' }]}>✓ Confirmaste que quedó bien</Text>
                  ) : (
                    <View style={styles.row}>
                      {!!o.resolution_photo && (
                        <TouchableOpacity onPress={() => void verFoto(o.resolution_photo)}>
                          <Text style={styles.link}>Ver arreglo</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.small}>¿Quedó bien?</Text>
                      <TouchableOpacity style={styles.btnOk} onPress={() => confirmar(o, true)}>
                        <Text style={styles.btnText}>Sí</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.btnGhost} onPress={() => confirmar(o, false)}>
                        <Text style={[styles.btnGhostText, { color: theme.danger }]}>No, reabrir</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={!!reopen} transparent animationType="fade" onRequestClose={() => setReopen(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.h2}>Reabrir</Text>
            <TextInput
              style={styles.input}
              placeholder="¿Qué falta o qué sigue mal?"
              value={reopen?.text ?? ''}
              onChangeText={(t) => setReopen((r) => (r ? { ...r, text: t } : r))}
              multiline
            />
            <View style={styles.rowBetween}>
              <TouchableOpacity onPress={() => setReopen(null)}>
                <Text style={styles.link}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={async () => {
                  if (!reopen?.text.trim()) return;
                  const { error } = await supabase.rpc('wo_confirm', { p_order: reopen.order.id, p_ok: false, p_comment: reopen.text.trim() });
                  setReopen(null);
                  if (error) Alert.alert('Error', error.message);
                  else void load();
                }}
              >
                <Text style={styles.btnText}>Reabrir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!closing} transparent animationType="slide" onRequestClose={() => setClosing(null)}>
        <View style={styles.backdrop}>
          <ScrollView style={styles.modal} contentContainerStyle={{ gap: 10 }}>
            <Text style={styles.h2}>{closing?.order ? `Terminar: ${closing.order.title}` : 'Registrar un trabajo hecho'}</Text>
            {!closing?.order && (
              <>
                <TextInput style={styles.input} placeholder="¿Qué hiciste?" value={selfLog.title} onChangeText={(t) => setSelfLog({ ...selfLog, title: t })} />
                <Text style={styles.label}>¿En qué sucursal?</Text>
                <View style={styles.wrap}>
                  {groupBranches.map((b) => (
                    <TouchableOpacity key={b.id} style={chip(selfLog.branchId === b.id)} onPress={() => setSelfLog({ ...selfLog, branchId: b.id })}>
                      <Text style={[styles.chipText, selfLog.branchId === b.id && styles.chipTextOn]}>{b.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="¿Dónde exactamente? (opcional)"
                  value={selfLog.location}
                  onChangeText={(t) => setSelfLog({ ...selfLog, location: t })}
                />
              </>
            )}
            <TextInput style={styles.input} placeholder="¿Qué se hizo? (opcional)" value={note} onChangeText={setNote} multiline />
            <TouchableOpacity style={styles.photoBtn} onPress={async () => setClosePhoto((await tomarFoto()) ?? closePhoto)}>
              {closePhoto ? <Image source={{ uri: closePhoto }} style={styles.thumb} /> : <Ionicons name="camera-outline" size={22} color={theme.primary} />}
              <Text style={styles.link}>{closePhoto ? 'Foto lista · tocar para cambiar' : 'Foto del trabajo terminado (obligatoria)'}</Text>
            </TouchableOpacity>
            <Text style={styles.label}>¿Quiénes hicieron el trabajo?</Text>
            {techs.map((t) => {
              const on = participants.has(t.employee_id);
              return (
                <TouchableOpacity
                  key={t.employee_id}
                  style={styles.row}
                  onPress={() =>
                    setParticipants((prev) => {
                      const s = new Set(prev);
                      if (s.has(t.employee_id)) s.delete(t.employee_id);
                      else s.add(t.employee_id);
                      return s;
                    })
                  }
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={theme.primary} />
                  <Text style={styles.itemTitle}>
                    {t.employee_name}
                    {t.employee_id === me.id ? ' (tú)' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <View style={styles.rowBetween}>
              <TouchableOpacity onPress={() => setClosing(null)}>
                <Text style={styles.link}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnOk, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => void terminar()}>
                <Text style={styles.btnText}>{busy ? 'Guardando…' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.background },
  muted: { color: theme.textSecondary, fontSize: 13 },
  card: { backgroundColor: theme.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: theme.border },
  h2: { fontSize: 15, fontWeight: '800', color: theme.textPrimary },
  label: { fontSize: 12, fontWeight: '700', color: theme.textSecondary },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.textPrimary, backgroundColor: '#fff' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipOn: { borderColor: theme.primary, backgroundColor: theme.subtleBackground },
  chipText: { fontSize: 12, color: theme.textSecondary },
  chipTextOn: { color: theme.primary, fontWeight: '700' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border, borderRadius: 12, padding: 10 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  btnPrimary: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  btnOk: { backgroundColor: theme.success, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  btnGhost: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
  btnGhostText: { color: theme.textPrimary, fontWeight: '700' },
  link: { color: theme.primary, fontWeight: '700', fontSize: 13 },
  item: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, gap: 4 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: theme.textPrimary },
  small: { fontSize: 12, color: theme.textSecondary },
  pill: { color: '#fff', fontSize: 11, fontWeight: '700', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: theme.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '90%' },
});
