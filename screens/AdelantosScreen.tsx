import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../lib/theme';
import {
  fmtC,
  miInfoAdelanto,
  misAdelantos,
  retirarAdelanto,
  solicitarAdelanto,
  type Adelanto,
  type InfoAdelanto,
} from '../lib/aprobaciones';
import RecorridoSolicitud from '../components/RecorridoSolicitud';

const ESTADO: Record<Adelanto['estado'], { t: string; bg: string; fg: string }> = {
  pending: { t: 'Esperando aprobación', bg: '#FFFBEB', fg: '#92400E' },
  active: { t: 'Descontándose', bg: '#ECFDF5', fg: '#047857' },
  completed: { t: 'Pagado', bg: '#F1F5F9', fg: '#475569' },
  cancelled: { t: 'Cancelado', bg: '#F1F5F9', fg: '#475569' },
  defaulted: { t: 'Cerrado con saldo', bg: '#F1F5F9', fg: '#475569' },
  rejected: { t: 'No aprobado', bg: '#FEF2F2', fg: '#B91C1C' },
  withdrawn: { t: 'Retirado', bg: '#F1F5F9', fg: '#475569' },
};

const fecha = (s: string) => new Date(s).toLocaleDateString('es-NI', { day: 'numeric', month: 'short', year: 'numeric' });

function Tarjeta({ a, onRetirar, ocupado }: { a: Adelanto; onRetirar: () => void; ocupado: boolean }) {
  const [abierto, setAbierto] = useState(a.estado === 'pending');
  const e = ESTADO[a.estado] ?? ESTADO.cancelled;
  const pct = a.total > 0 ? Math.min(100, Math.round((a.recuperado / a.total) * 100)) : 0;
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.amount}>{fmtC(a.total)}</Text>
          <Text style={s.meta}>
            {a.cuotas === 1 ? 'Un solo descuento' : `${a.cuotas} quincenas de ${fmtC(a.cuota)}`} · {fecha(a.creado)}
          </Text>
        </View>
        <View style={[s.badge, { backgroundColor: e.bg }]}>
          <Text style={[s.badgeText, { color: e.fg }]}>{e.t}</Text>
        </View>
      </View>
      {a.estado === 'pending' && a.en_manos_de?.length ? (
        <Text style={s.texto}>
          Lo tiene <Text style={{ fontWeight: '700' }}>{a.en_manos_de.join(', ')}</Text>
          {a.etiqueta_paso ? ` (${a.etiqueta_paso})` : ''}. Te avisamos cuando lo decidan.
        </Text>
      ) : null}
      {a.estado === 'active' ? (
        <View style={{ gap: 4 }}>
          <View style={s.barra}>
            <View style={[s.barraLlena, { width: `${pct}%` }]} />
          </View>
          <Text style={s.meta}>
            Pagado {fmtC(a.recuperado)} · te falta {fmtC(Math.max(0, a.total - a.recuperado))}. Se descuenta en tu planilla.
          </Text>
        </View>
      ) : null}
      {(a.estado === 'rejected' || a.estado === 'withdrawn') && a.motivo_cierre ? (
        <Text style={s.texto}>Motivo: {a.motivo_cierre}</Text>
      ) : null}
      {a.motivo ? <Text style={s.meta}>Para: «{a.motivo}»</Text> : null}
      <View style={s.filaAcciones}>
        {a.estado === 'pending' ? (
          <TouchableOpacity onPress={onRetirar} disabled={ocupado}>
            <Text style={s.link}>{ocupado ? '…' : 'Retirar mi solicitud'}</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        {a.tiene_recorrido ? (
          <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={s.toggle}>
            <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textSecondary} />
            <Text style={s.toggleText}>¿Quién lo aprueba?</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {abierto && a.tiene_recorrido ? (
        <View style={s.recorrido}>
          <RecorridoSolicitud tabla="salary_advances" refId={a.id} />
        </View>
      ) : null}
    </View>
  );
}

export default function AdelantosScreen() {
  const [info, setInfo] = useState<InfoAdelanto | null>(null);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const [lista, setLista] = useState<Adelanto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [monto, setMonto] = useState('');
  const [cuotas, setCuotas] = useState(1);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [i, a] = await Promise.all([miInfoAdelanto(), misAdelantos()]);
    if (!i.ok) {
      setErrorInfo(('error' in i && i.error) || 'No se pudo cargar.');
      setInfo(null);
    } else {
      setErrorInfo(null);
      setInfo(i as InfoAdelanto);
    }
    if (a) setLista(a);
    setCargando(false);
    setRefrescando(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  const valor = Number(monto.replace(/,/g, ''));
  const cuota = valor > 0 ? Math.ceil((valor / cuotas) * 100) / 100 : 0;
  const excede = info ? valor > info.disponible : false;

  async function enviar() {
    setErrorForm(null);
    if (!(valor > 0)) {
      setErrorForm('Escribe cuánto necesitas.');
      return;
    }
    setEnviando(true);
    const r = await solicitarAdelanto(valor, cuotas, motivo);
    setEnviando(false);
    if (!r.ok) {
      setErrorForm(r.error);
      return;
    }
    setMonto('');
    setMotivo('');
    setCuotas(1);
    setAviso('Listo. Tu solicitud fue enviada; te avisamos cuando la decidan.');
    void cargar();
  }

  function retirar(id: string) {
    Alert.alert('Retirar solicitud', '¿Seguro que quieres retirar este adelanto?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, retirar',
        style: 'destructive',
        onPress: async () => {
          setOcupado(id);
          const r = await retirarAdelanto(id);
          setOcupado(null);
          if (!r.ok) Alert.alert('No se pudo', r.error);
          void cargar();
        },
      },
    ]);
  }

  const opciones = Array.from({ length: info?.politica.max_cuotas ?? 1 }, (_, i) => i + 1);

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={() => {
              setRefrescando(true);
              void cargar();
            }}
            tintColor={theme.primary}
          />
        }
      >
        {aviso ? (
          <View style={s.okBox}>
            <Ionicons name="checkmark-circle" size={18} color="#047857" />
            <Text style={s.okText}>{aviso}</Text>
          </View>
        ) : null}

        {cargando ? (
          <View style={s.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : errorInfo ? (
          <View style={s.card}>
            <Text style={s.texto}>{errorInfo}</Text>
          </View>
        ) : info ? (
          <View style={s.card}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={s.icono}>
                <Ionicons name="cash-outline" size={22} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.h2}>Pedir un adelanto</Text>
                {info.bloqueo ? (
                  <Text style={s.texto}>{info.bloqueo}</Text>
                ) : (
                  <Text style={s.texto}>
                    Puedes pedir hasta <Text style={{ fontWeight: '800' }}>{fmtC(info.disponible)}</Text> (
                    {info.politica.tope_porcentaje} % de tu salario mensual). Sin intereses.
                  </Text>
                )}
              </View>
            </View>

            {!info.bloqueo ? (
              <View style={{ gap: 12, marginTop: 6 }}>
                <View>
                  <Text style={s.label}>¿Cuánto necesitas?</Text>
                  <TextInput
                    style={[s.input, s.inputMonto, excede && { borderColor: theme.danger }]}
                    keyboardType="decimal-pad"
                    placeholder="C$ 0.00"
                    placeholderTextColor={theme.textMuted}
                    value={monto}
                    onChangeText={(t) => setMonto(t.replace(/[^0-9.,]/g, ''))}
                  />
                  {excede ? <Text style={s.error}>Es más de lo que puedes pedir ({fmtC(info.disponible)}).</Text> : null}
                </View>

                {opciones.length > 1 ? (
                  <View>
                    <Text style={s.label}>¿En cuántas quincenas lo devuelves?</Text>
                    <View style={s.opciones}>
                      {opciones.map((n) => (
                        <TouchableOpacity
                          key={n}
                          style={[s.opcion, cuotas === n && s.opcionActiva]}
                          onPress={() => setCuotas(n)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: cuotas === n }}
                        >
                          <Text style={[s.opcionText, cuotas === n && { color: theme.primary }]}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View>
                  <Text style={s.label}>¿Para qué es? (opcional)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="Ej.: medicinas"
                    placeholderTextColor={theme.textMuted}
                    value={motivo}
                    maxLength={300}
                    onChangeText={setMotivo}
                  />
                </View>

                {valor > 0 && !excede ? (
                  <View style={s.resumen}>
                    <Text style={s.texto}>
                      Te descontarán <Text style={{ fontWeight: '800' }}>{fmtC(cuota)}</Text>
                      {cuotas === 1 ? ' en tu próxima planilla.' : ` en cada una de tus próximas ${cuotas} planillas.`}
                    </Text>
                  </View>
                ) : null}

                {info.quien_aprueba.length ? (
                  <Text style={s.meta}>
                    Lo aprueba:{' '}
                    {info.quien_aprueba
                      .map((p) => p.etiqueta + (p.nombres?.length ? ` (${p.nombres.join(', ')})` : ''))
                      .join(' → ')}
                  </Text>
                ) : null}

                {errorForm ? <Text style={s.error}>{errorForm}</Text> : null}
                <TouchableOpacity
                  style={[s.cta, (enviando || excede || !(valor > 0)) && { opacity: 0.5 }]}
                  disabled={enviando || excede || !(valor > 0)}
                  onPress={() => void enviar()}
                >
                  <Text style={s.ctaText}>{enviando ? 'Enviando…' : 'Enviar solicitud'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}

        {lista.length > 0 ? <Text style={s.sectionTitle}>Mis adelantos</Text> : null}
        {lista.map((a) => (
          <Tarjeta key={a.id} a={a} onRetirar={() => retirar(a.id)} ocupado={ocupado === a.id} />
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 20, gap: 14, paddingBottom: 40 },
  center: { paddingVertical: 48, alignItems: 'center' },
  card: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icono: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.subtleBackground, alignItems: 'center', justifyContent: 'center' },
  h2: { fontSize: 16, fontWeight: '800', color: theme.textPrimary },
  amount: { fontSize: 20, fontWeight: '800', color: theme.textPrimary },
  texto: { fontSize: 14, color: theme.textPrimary, lineHeight: 20 },
  meta: { fontSize: 12, color: theme.textSecondary },
  label: { fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: theme.textPrimary, backgroundColor: '#fff',
  },
  inputMonto: { fontSize: 20, fontWeight: '700' },
  opciones: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  opcion: { minWidth: 56, height: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  opcionActiva: { borderColor: theme.primary, backgroundColor: theme.subtleBackground },
  opcionText: { fontSize: 15, fontWeight: '700', color: theme.textPrimary },
  resumen: { backgroundColor: theme.background, borderRadius: 12, padding: 12 },
  error: { fontSize: 13, color: theme.danger, marginTop: 4 },
  cta: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: theme.textPrimary, marginTop: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  barra: { height: 8, borderRadius: 4, backgroundColor: '#F1F5F9', overflow: 'hidden' },
  barraLlena: { height: 8, borderRadius: 4, backgroundColor: theme.success },
  filaAcciones: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  link: { fontSize: 13, color: theme.textSecondary, textDecorationLine: 'underline' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggleText: { fontSize: 13, color: theme.textSecondary, fontWeight: '600' },
  recorrido: { borderWidth: 1, borderColor: theme.cardBorder, borderRadius: 12, padding: 12 },
  okBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 12, padding: 12 },
  okText: { flex: 1, color: '#065F46', fontSize: 13, fontWeight: '600' },
});
