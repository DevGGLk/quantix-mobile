import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

type Descuento = {
  id: string;
  total: number;
  recuperado: number;
  cuota: number;
  cuotas: number;
  tipo: 'one_time' | 'recurring';
  desde: string | null;
  motivo: string;
  base_legal: string | null;
  evidencia: string | null;
  estado: 'pending' | 'active' | 'completed' | 'cancelled' | 'disputed' | 'defaulted';
  disputa: string | null;
  cierre: string | null;
  texto: string | null;
};

const fmtC = (n: number) => `C$ ${Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ESTADO: Record<Descuento['estado'], { t: string; bg: string; fg: string }> = {
  pending: { t: 'Espera tu respuesta', bg: '#FFFBEB', fg: '#92400E' },
  disputed: { t: 'En revisión por RRHH', bg: '#F5F3FF', fg: '#6D28D9' },
  active: { t: 'Aceptado · se descuenta', bg: '#ECFDF5', fg: '#047857' },
  completed: { t: 'Descontado', bg: '#F1F5F9', fg: '#475569' },
  cancelled: { t: 'Cancelado', bg: '#F1F5F9', fg: '#475569' },
  defaulted: { t: 'Cerrado', bg: '#F1F5F9', fg: '#475569' },
};

/** Descuentos disciplinarios: aceptar (con el texto exacto) o decir que no está de acuerdo. */
export function MisDescuentosDisciplinarios() {
  const [lista, setLista] = useState<Descuento[]>([]);
  const [hoja, setHoja] = useState<null | { tipo: 'aceptar' | 'disputar'; d: Descuento }>(null);
  const [motivo, setMotivo] = useState('');
  const [acepto, setAcepto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('mis_descuentos_disciplinarios');
    setLista((data as Descuento[] | null) ?? []);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  async function enviar() {
    if (!hoja) return;
    setEnviando(true);
    setError(null);
    const { data, error: e } =
      hoja.tipo === 'aceptar'
        ? await supabase.rpc('aceptar_descuento_disciplinario', { p_id: hoja.d.id, p_texto: hoja.d.texto ?? '' })
        : await supabase.rpc('disputar_descuento_disciplinario', { p_id: hoja.d.id, p_motivo: motivo.trim() });
    setEnviando(false);
    const r = data as { ok: boolean; error?: string } | null;
    if (e || !r?.ok) {
      setError(r?.error ?? 'No se pudo guardar. Inténtalo otra vez.');
      return;
    }
    setAviso(hoja.tipo === 'aceptar' ? 'Listo: aceptaste el descuento.' : 'Listo: RRHH revisará tu caso. Mientras tanto no se te descuenta.');
    setHoja(null);
    void cargar();
  }

  if (lista.length === 0) return null;
  return (
    <View style={s.card}>
      <Text style={s.h2}>Mis descuentos disciplinarios</Text>
      <Text style={s.meta}>Sin tu aceptación no se descuenta nada. Lo aceptado respeta el salario mínimo.</Text>
      {aviso ? <Text style={s.ok}>{aviso}</Text> : null}
      {lista.map((d) => {
        const e = ESTADO[d.estado];
        return (
          <View key={d.id} style={s.item}>
            <View style={s.fila}>
              <Text style={s.monto}>{fmtC(d.total)}</Text>
              <View style={[s.badge, { backgroundColor: e.bg }]}>
                <Text style={[s.badgeText, { color: e.fg }]}>{e.t}</Text>
              </View>
            </View>
            <Text style={s.texto}>{d.motivo}</Text>
            <Text style={s.meta}>
              {d.tipo === 'recurring' && d.cuotas > 1 ? `${d.cuotas} cuotas de ${fmtC(d.cuota)}` : 'Un solo descuento'} · Base: {d.base_legal ?? '—'}
            </Text>
            {d.evidencia ? (
              <TouchableOpacity onPress={() => void Linking.openURL(d.evidencia as string)}>
                <Text style={s.link}>Ver evidencia</Text>
              </TouchableOpacity>
            ) : null}
            {d.estado === 'disputed' && d.disputa ? <Text style={s.meta}>Dijiste: «{d.disputa}»</Text> : null}
            {d.estado === 'active' ? (
              <Text style={s.meta}>
                Descontado {fmtC(d.recuperado)} · falta {fmtC(Math.max(0, d.total - d.recuperado))}
              </Text>
            ) : null}
            {d.estado === 'pending' ? (
              <View style={s.botones}>
                <TouchableOpacity style={s.btn} onPress={() => { setHoja({ tipo: 'aceptar', d }); setAcepto(false); setError(null); }}>
                  <Text style={s.btnText}>Revisar y aceptar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btn2} onPress={() => { setHoja({ tipo: 'disputar', d }); setMotivo(''); setError(null); }}>
                  <Text style={s.btn2Text}>No estoy de acuerdo</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {d.estado === 'active' ? (
              <TouchableOpacity onPress={() => { setHoja({ tipo: 'disputar', d }); setMotivo(''); setError(null); }}>
                <Text style={s.link}>No estoy de acuerdo con este descuento</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}

      <Modal visible={!!hoja} transparent animationType="slide" onRequestClose={() => setHoja(null)}>
        <KeyboardAvoidingView style={s.fondo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.hoja}>
            <Text style={s.h2}>{hoja?.tipo === 'aceptar' ? 'Aceptar el descuento' : 'No estoy de acuerdo'}</Text>
            {hoja?.tipo === 'aceptar' ? (
              <>
                <Text style={s.legal}>{hoja.d.texto}</Text>
                <TouchableOpacity style={s.check} onPress={() => setAcepto((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: acepto }}>
                  <View style={[s.box, acepto && s.boxOn]} />
                  <Text style={s.texto}>Leí el texto y lo acepto.</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.meta}>Cuéntanos por qué. RRHH lo verá y mientras tanto no se descuenta.</Text>
                <TextInput style={s.input} multiline value={motivo} onChangeText={setMotivo} placeholder="Escribe aquí" placeholderTextColor={theme.textMuted} />
              </>
            )}
            {error ? <Text style={s.error}>{error}</Text> : null}
            <View style={s.botones}>
              <TouchableOpacity style={s.btn2} onPress={() => setHoja(null)} disabled={enviando}>
                <Text style={s.btn2Text}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, (enviando || (hoja?.tipo === 'aceptar' ? !acepto : motivo.trim().length < 10)) && { opacity: 0.5 }]}
                disabled={enviando || (hoja?.tipo === 'aceptar' ? !acepto : motivo.trim().length < 10)}
                onPress={() => void enviar()}
              >
                <Text style={s.btnText}>{enviando ? 'Guardando…' : hoja?.tipo === 'aceptar' ? 'Acepto' : 'Enviar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 8, marginBottom: 14 },
  h2: { fontSize: 16, fontWeight: '800', color: theme.textPrimary },
  meta: { fontSize: 12, color: theme.textSecondary },
  ok: { fontSize: 13, color: '#065F46', backgroundColor: '#ECFDF5', borderRadius: 10, padding: 10 },
  item: { borderTopWidth: 1, borderTopColor: theme.cardBorder, paddingTop: 10, gap: 4 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  monto: { fontSize: 18, fontWeight: '800', color: theme.textPrimary },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  texto: { fontSize: 14, color: theme.textPrimary },
  link: { fontSize: 13, color: theme.primary, textDecorationLine: 'underline' },
  botones: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  btn2: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff' },
  btn2Text: { color: theme.textPrimary, fontWeight: '700' },
  fondo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  hoja: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, paddingBottom: 32 },
  legal: { fontSize: 14, lineHeight: 21, color: theme.textPrimary, backgroundColor: theme.background, borderRadius: 12, padding: 12 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.border },
  boxOn: { backgroundColor: theme.primary, borderColor: theme.primary },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, minHeight: 90, textAlignVertical: 'top', color: theme.textPrimary },
  error: { fontSize: 13, color: theme.danger },
});
