import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import type { Palette } from '../theme';

// ─── Utilidades ─────────────────────────────────────────────────────────────

const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** «sáb 8/11» desde YYYY-MM-DD. */
export function fechaCorta(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00`);
  const iso = (d.getDay() + 6) % 7;
  return `${DIAS[iso]} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** "HH:mm" desde time ("08:00:00") o timestamptz (Managua, UTC-6 fijo). */
export function hora(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v);
  if (!s.includes('T') && !s.includes(' ')) return s.slice(0, 5);
  const ms = new Date(s).getTime();
  if (Number.isNaN(ms)) return '—';
  const l = new Date(ms - 6 * 3600_000);
  return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
}

function errorMsg(e: unknown): string {
  const m = (e as { message?: string } | null)?.message;
  return m ? m.replace(/^REGLA_LABORAL:\s*/, '') : 'No se pudo completar. Revisa tu conexión.';
}

// ─── Acuse «Vi mi horario» ──────────────────────────────────────────────────

export function AckBanner({
  weekStart,
  needsAck,
  onDone,
  palette,
}: {
  weekStart: string;
  needsAck: boolean;
  onDone: () => void;
  palette: Palette;
}) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [busy, setBusy] = useState(false);
  if (!needsAck) return null;
  return (
    <View style={[s.banner, { borderColor: palette.brand.base }]}>
      <Ionicons name="eye-outline" size={20} color={palette.brand.base} />
      <View style={{ flex: 1 }}>
        <Text style={s.bannerTitle}>¿Ya revisaste tu horario?</Text>
        <Text style={s.bannerText}>Confírmalo para que tu jefe sepa que lo viste.</Text>
      </View>
      <TouchableOpacity
        style={[s.btn, s.btnPrimary]}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          const { error } = await supabase.rpc('acknowledge_schedule_week', { p_week_start: weekStart });
          setBusy(false);
          if (error) Alert.alert('Turnos', errorMsg(error));
          else onDone();
        }}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnPrimaryText}>Lo vi</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ─── Turnos disponibles (abiertos) ──────────────────────────────────────────

type OpenShift = {
  id: string;
  business_date: string;
  status: string;
  note: string | null;
  claimed_by: string | null;
  shift_templates: { name?: string | null; start_time?: string | null; end_time?: string | null } | null;
};

export function OpenShiftsSection({
  companyId,
  employeeId,
  refreshKey,
  onChanged,
  palette,
}: {
  companyId: string;
  employeeId: string;
  refreshKey: number;
  onChanged: () => void;
  palette: Palette;
}) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [rows, setRows] = useState<OpenShift[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const hoy = new Date();
    const ymd = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const { data } = await supabase
      .from('open_shifts')
      .select('id, business_date, status, note, claimed_by, shift_templates(name, start_time, end_time)')
      .eq('company_id', companyId)
      .in('status', ['abierto', 'solicitado'])
      .gte('business_date', ymd)
      .order('business_date', { ascending: true })
      .limit(30);
    const list = ((data ?? []) as unknown as OpenShift[]).map((r) => ({
      ...r,
      shift_templates: Array.isArray(r.shift_templates) ? r.shift_templates[0] ?? null : r.shift_templates,
    }));
    // Abiertos para todos; los «solicitados» solo si los pedí yo.
    setRows(list.filter((r) => r.status === 'abierto' || r.claimed_by === employeeId));
  }, [companyId, employeeId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (rows.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Turnos disponibles</Text>
      {rows.map((r) => {
        const t = r.shift_templates;
        const mio = r.claimed_by === employeeId;
        return (
          <View key={r.id} style={s.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>
                {fechaCorta(r.business_date)} · {hora(t?.start_time)}–{hora(t?.end_time)}
              </Text>
              <Text style={s.rowSub}>
                {t?.name ?? 'Turno'}
                {r.note ? ` · ${r.note}` : ''}
              </Text>
            </View>
            {mio ? (
              <View style={[s.chip, { backgroundColor: palette.semantic.warning.surface }]}>
                <Text style={[s.chipText, { color: palette.semantic.warning.text }]}>Pedido · espera aprobación</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[s.btn, s.btnPrimary]}
                disabled={busy === r.id}
                accessibilityRole="button"
                onPress={async () => {
                  setBusy(r.id);
                  const { error } = await supabase.rpc('claim_open_shift', { p_id: r.id });
                  setBusy(null);
                  if (error) Alert.alert('Turno disponible', errorMsg(error));
                  else {
                    Alert.alert('Turno disponible', 'Listo: tu jefe tiene que aprobarlo. Te avisaremos.');
                    void load();
                    onChanged();
                  }
                }}
              >
                {busy === r.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnPrimaryText}>Lo quiero</Text>}
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Cambios de turno (enviados y recibidos) ────────────────────────────────

type SwapRow = {
  id: string;
  direccion: 'enviada' | 'recibida';
  status: string;
  requester_date: string;
  target_date: string | null;
  companero: string;
  resolution_note: string | null;
};

const ESTADO: Record<string, string> = {
  pendiente_companero: 'Esperando al compañero',
  pendiente_aprobacion: 'Esperando aprobación del jefe',
  aprobado: 'Aprobado',
  rechazado_companero: 'El compañero no aceptó',
  rechazado: 'No aprobado',
  cancelado: 'Cancelado',
};

export function SwapRequestsSection({
  refreshKey,
  onChanged,
  palette,
}: {
  refreshKey: number;
  onChanged: () => void;
  palette: Palette;
}) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [rows, setRows] = useState<SwapRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_shift_requests');
    setRows(((data ?? []) as SwapRow[]).slice(0, 15));
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (id: string, action: 'aceptar' | 'rechazar' | 'cancelar') => {
    setBusy(id);
    const { error } = await supabase.rpc('respond_shift_swap', { p_id: id, p_action: action });
    setBusy(null);
    if (error) Alert.alert('Cambio de turno', errorMsg(error));
    else {
      void load();
      onChanged();
    }
  };

  if (rows.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Cambios de turno</Text>
      {rows.map((r) => {
        const pendiente = r.status === 'pendiente_companero' || r.status === 'pendiente_aprobacion';
        const titulo =
          r.direccion === 'enviada'
            ? r.target_date
              ? `Tu ${fechaCorta(r.requester_date)} ↔ ${fechaCorta(r.target_date)} de ${r.companero}`
              : `${r.companero} cubre tu ${fechaCorta(r.requester_date)}`
            : r.target_date
              ? `${r.companero}: su ${fechaCorta(r.requester_date)} por tu ${fechaCorta(r.target_date)}`
              : `${r.companero} te pide cubrir su ${fechaCorta(r.requester_date)}`;
        return (
          <View key={r.id} style={s.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{titulo}</Text>
              <Text style={[s.rowSub, pendiente && { color: palette.semantic.warning.text }]}>
                {ESTADO[r.status] ?? r.status}
                {r.resolution_note ? ` · ${r.resolution_note}` : ''}
              </Text>
            </View>
            {r.direccion === 'recibida' && r.status === 'pendiente_companero' ? (
              <View style={{ gap: 6 }}>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} disabled={busy === r.id} onPress={() => void act(r.id, 'aceptar')}>
                  <Text style={s.btnPrimaryText}>Aceptar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnGhost]} disabled={busy === r.id} onPress={() => void act(r.id, 'rechazar')}>
                  <Text style={s.btnGhostText}>No puedo</Text>
                </TouchableOpacity>
              </View>
            ) : r.direccion === 'enviada' && pendiente ? (
              <TouchableOpacity style={[s.btn, s.btnGhost]} disabled={busy === r.id} onPress={() => void act(r.id, 'cancelar')}>
                <Text style={s.btnGhostText}>Cancelar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ─── Pedir cambio de un turno propio ────────────────────────────────────────

type Coworker = { employee_id: string; nombre: string };
type CoworkerShift = { business_date: string; start_time: string; end_time: string; turno: string };

export function SwapRequestModal({
  visible,
  companyId,
  myDate,
  myLabel,
  onClose,
  onSent,
  palette,
}: {
  visible: boolean;
  companyId: string;
  myDate: string | null;
  myLabel: string;
  onClose: () => void;
  onSent: () => void;
  palette: Palette;
}) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const [modo, setModo] = useState<'cubrir' | 'intercambiar'>('cubrir');
  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [elegido, setElegido] = useState<string | null>(null);
  const [susTurnos, setSusTurnos] = useState<CoworkerShift[]>([]);
  const [suFecha, setSuFecha] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setModo('cubrir');
    setElegido(null);
    setSuFecha(null);
    setMotivo('');
    void supabase.rpc('my_shift_coworkers', { p_company_id: companyId }).then(({ data }) => {
      setCoworkers((data ?? []) as Coworker[]);
    });
  }, [visible, companyId]);

  useEffect(() => {
    setSuFecha(null);
    setSusTurnos([]);
    if (!elegido || modo !== 'intercambiar' || !myDate) return;
    const desde = new Date(`${myDate}T12:00:00`);
    desde.setDate(desde.getDate() - 14);
    const hasta = new Date(`${myDate}T12:00:00`);
    hasta.setDate(hasta.getDate() + 14);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    void supabase
      .rpc('coworker_published_shifts', { p_company_id: companyId, p_employee_id: elegido, p_from: f(desde), p_to: f(hasta) })
      .then(({ data }) => setSusTurnos((data ?? []) as CoworkerShift[]));
  }, [elegido, modo, myDate, companyId]);

  const enviar = async () => {
    if (!myDate || !elegido) return;
    if (modo === 'intercambiar' && !suFecha) {
      Alert.alert('Cambio de turno', 'Elige el turno de tu compañero.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('request_shift_swap', {
      p_company_id: companyId,
      p_my_date: myDate,
      p_target_employee_id: elegido,
      p_target_date: modo === 'intercambiar' ? suFecha : null,
      p_reason: motivo.trim() || null,
    });
    setBusy(false);
    if (error) {
      Alert.alert('Cambio de turno', errorMsg(error));
      return;
    }
    Alert.alert('Cambio de turno', 'Enviado. Tu compañero tiene que aceptar y después tu jefe aprobar. Hasta entonces sigues con tu turno.');
    onSent();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Pedir cambio · {myLabel}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={24} color={palette.text.primary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={s.segment}>
              {(['cubrir', 'intercambiar'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[s.segmentItem, modo === m && { backgroundColor: palette.brand.base }]}
                  onPress={() => setModo(m)}
                >
                  <Text style={[s.segmentText, modo === m && { color: '#fff' }]}>
                    {m === 'cubrir' ? 'Que me cubran' : 'Intercambiar'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.help}>
              {modo === 'cubrir'
                ? 'Tu compañero toma tu turno y tú quedas libre ese día.'
                : 'Tú tomas un turno de tu compañero y él toma el tuyo.'}
            </Text>

            <Text style={s.label}>¿Con quién?</Text>
            {coworkers.length === 0 ? (
              <Text style={s.help}>No hay compañeros de tu sucursal con cuenta en la app.</Text>
            ) : (
              coworkers.map((c) => (
                <TouchableOpacity
                  key={c.employee_id}
                  style={[s.option, elegido === c.employee_id && { borderColor: palette.brand.base, borderWidth: 2 }]}
                  onPress={() => setElegido(c.employee_id)}
                >
                  <Text style={s.optionText}>{c.nombre}</Text>
                </TouchableOpacity>
              ))
            )}

            {modo === 'intercambiar' && elegido ? (
              <>
                <Text style={s.label}>¿Por cuál de sus turnos?</Text>
                {susTurnos.length === 0 ? (
                  <Text style={s.help}>No tiene turnos publicados cerca de esa fecha.</Text>
                ) : (
                  susTurnos.map((t) => (
                    <TouchableOpacity
                      key={t.business_date}
                      style={[s.option, suFecha === t.business_date && { borderColor: palette.brand.base, borderWidth: 2 }]}
                      onPress={() => setSuFecha(t.business_date)}
                    >
                      <Text style={s.optionText}>
                        {fechaCorta(t.business_date)} · {hora(t.start_time)}–{hora(t.end_time)} · {t.turno}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </>
            ) : null}

            <Text style={s.label}>Motivo (opcional)</Text>
            <TextInput
              style={s.input}
              value={motivo}
              onChangeText={setMotivo}
              placeholder="Ej.: cita médica"
              placeholderTextColor={palette.text.tertiary}
            />

            <TouchableOpacity
              style={[s.btn, s.btnPrimary, s.btnBlock, (!elegido || busy) && { opacity: 0.5 }]}
              disabled={!elegido || busy}
              onPress={() => void enviar()}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Enviar solicitud</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Mi disponibilidad ──────────────────────────────────────────────────────

type Disp = { status: 'disponible' | 'no_disponible' | 'parcial'; from_time: string; to_time: string };

export function AvailabilityModal({
  visible,
  companyId,
  employeeId,
  onClose,
  palette,
}: {
  visible: boolean;
  companyId: string;
  employeeId: string;
  onClose: () => void;
  palette: Palette;
}) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const vacio = (): Disp[] => Array.from({ length: 7 }, () => ({ status: 'disponible', from_time: '', to_time: '' }));
  const [dias, setDias] = useState<Disp[]>(vacio);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void supabase
      .from('employee_availability')
      .select('weekday, status, from_time, to_time')
      .eq('employee_id', employeeId)
      .then(({ data }) => {
        const next = vacio();
        for (const r of (data ?? []) as { weekday: number; status: Disp['status']; from_time: string | null; to_time: string | null }[]) {
          next[r.weekday - 1] = { status: r.status, from_time: (r.from_time ?? '').slice(0, 5), to_time: (r.to_time ?? '').slice(0, 5) };
        }
        setDias(next);
      });
  }, [visible, employeeId]);

  const set = (i: number, patch: Partial<Disp>) => setDias((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const guardar = async () => {
    const re = /^\d{2}:\d{2}$/;
    for (let i = 0; i < 7; i++) {
      const d = dias[i];
      if (d.status === 'parcial' && (!re.test(d.from_time) || !re.test(d.to_time))) {
        Alert.alert('Disponibilidad', `${DIAS_LARGOS[i]}: escribe las horas como 08:00.`);
        return;
      }
    }
    setBusy(true);
    const { error } = await supabase.rpc('set_my_availability', {
      p_company_id: companyId,
      p_items: dias.map((d, i) => ({
        weekday: i + 1,
        status: d.status,
        from_time: d.status === 'parcial' ? d.from_time : null,
        to_time: d.status === 'parcial' ? d.to_time : null,
      })),
    });
    setBusy(false);
    if (error) Alert.alert('Disponibilidad', errorMsg(error));
    else {
      Alert.alert('Disponibilidad', 'Guardada. Tu jefe la verá al armar los turnos.');
      onClose();
    }
  };

  const OPC: { v: Disp['status']; l: string }[] = [
    { v: 'disponible', l: 'Sí' },
    { v: 'parcial', l: 'Horas' },
    { v: 'no_disponible', l: 'No' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Mi disponibilidad</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={24} color={palette.text.primary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={s.help}>
              Indica qué días puedes trabajar. Tu jefe la ve al armar los turnos; es una preferencia, no una garantía.
            </Text>
            {dias.map((d, i) => (
              <View key={i} style={s.dispRow}>
                <Text style={s.dispDay}>{DIAS_LARGOS[i]}</Text>
                <View style={s.segmentSmall}>
                  {OPC.map((o) => (
                    <TouchableOpacity
                      key={o.v}
                      style={[
                        s.segmentItemSmall,
                        d.status === o.v && {
                          backgroundColor: o.v === 'no_disponible' ? palette.semantic.danger.color : palette.brand.base,
                        },
                      ]}
                      onPress={() => set(i, { status: o.v })}
                    >
                      <Text style={[s.segmentText, d.status === o.v && { color: '#fff' }]}>{o.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {d.status === 'parcial' ? (
                  <View style={s.horasRow}>
                    <TextInput
                      style={[s.input, s.inputHora]}
                      value={d.from_time}
                      onChangeText={(v) => set(i, { from_time: v })}
                      placeholder="08:00"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="numbers-and-punctuation"
                    />
                    <Text style={s.help}>a</Text>
                    <TextInput
                      style={[s.input, s.inputHora]}
                      value={d.to_time}
                      onChangeText={(v) => set(i, { to_time: v })}
                      placeholder="14:00"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                ) : null}
              </View>
            ))}
            <TouchableOpacity style={[s.btn, s.btnPrimary, s.btnBlock, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void guardar()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Guardar</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Estilos ────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1.5,
      backgroundColor: c.surface.card,
      marginBottom: 12,
    },
    bannerTitle: { fontSize: 14, fontWeight: '800', color: c.text.primary },
    bannerText: { fontSize: 12, fontWeight: '600', color: c.text.secondary, marginTop: 2 },
    section: { marginTop: 20 },
    sectionTitle: { fontSize: 16, fontWeight: '800', color: c.text.primary, marginBottom: 8 },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface.card,
      marginBottom: 8,
    },
    rowTitle: { fontSize: 14, fontWeight: '800', color: c.text.primary },
    rowSub: { fontSize: 12, fontWeight: '600', color: c.text.secondary, marginTop: 2 },
    chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
    chipText: { fontSize: 11, fontWeight: '700' },
    btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    btnBlock: { marginTop: 18, paddingVertical: 14 },
    btnPrimary: { backgroundColor: c.brand.base },
    btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    btnGhost: { borderWidth: 1, borderColor: c.border, backgroundColor: c.surface.sunken },
    btnGhostText: { color: c.text.primary, fontWeight: '700', fontSize: 13 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    modalSheet: {
      maxHeight: '88%',
      backgroundColor: c.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 16,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text.primary, flex: 1, paddingRight: 8 },
    segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
    segmentItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    segmentText: { fontSize: 13, fontWeight: '700', color: c.text.primary },
    segmentSmall: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
    segmentItemSmall: { paddingVertical: 7, paddingHorizontal: 14, alignItems: 'center' },
    help: { fontSize: 12, fontWeight: '600', color: c.text.secondary, marginTop: 8, lineHeight: 17 },
    label: { fontSize: 13, fontWeight: '800', color: c.text.primary, marginTop: 16, marginBottom: 6 },
    option: {
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface.card,
      marginBottom: 6,
    },
    optionText: { fontSize: 14, fontWeight: '700', color: c.text.primary },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: c.text.primary,
      backgroundColor: c.surface.card,
      fontSize: 14,
    },
    inputHora: { width: 80, textAlign: 'center' },
    dispRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border, gap: 8 },
    dispDay: { fontSize: 14, fontWeight: '800', color: c.text.primary },
    horasRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });
