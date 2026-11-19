import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../lib/theme';
import { decidir, fmtC, misPorAprobar, type FilaSolicitud } from '../lib/aprobaciones';
import RecorridoSolicitud from '../components/RecorridoSolicitud';

const POR_PERIODO: Record<string, number> = { weekly: 52 / 12, biweekly: 2, monthly: 1 };

/** Datos para decidir, en palabras simples (igual que la web). */
function Datos({ f }: { f: FilaSolicitud }) {
  const d = f.detalle ?? {};
  const salario = Number(d.salario_mensual ?? 0);
  const lineas: { k: string; v: string; alerta?: boolean }[] = [];
  if (f.tipo === 'adelanto') {
    const cuota = Number(d.cuota ?? 0);
    const porPeriodo = salario > 0 ? salario / (POR_PERIODO[String(d.periodo ?? 'biweekly')] ?? 2) : 0;
    const pct = porPeriodo > 0 ? Math.round((cuota / porPeriodo) * 100) : null;
    lineas.push({ k: 'Descuento por quincena', v: `${fmtC(cuota)}${pct != null ? ` (${pct} % del salario)` : ''}`, alerta: pct != null && pct > 50 });
    if (Number(d.otros_adelantos ?? 0) > 0) lineas.push({ k: 'Otros adelantos por pagar', v: fmtC(Number(d.otros_adelantos)) });
  } else {
    if (d.tasa_mensual != null) lineas.push({ k: 'Interés', v: `${Number(d.tasa_mensual).toLocaleString('es-NI', { maximumFractionDigits: 2 })} % al mes` });
    if (d.cuota_mensual_eq != null) {
      const tope = Number(d.tope_ley185 ?? 0);
      lineas.push({
        k: 'Cuota al mes',
        v: `${fmtC(Number(d.cuota_mensual_eq))}${tope > 0 ? ` · tope ${fmtC(tope)}` : ''}`,
        alerta: tope > 0 && Number(d.cuota_mensual_eq) > tope,
      });
    }
    if (d.cuota != null) lineas.push({ k: 'Cuota', v: fmtC(Number(d.cuota)) });
  }
  if (salario > 0) lineas.push({ k: 'Salario mensual', v: fmtC(salario) });
  if (Number(d.prestamos_saldo ?? 0) > 0) lineas.push({ k: 'Préstamos por pagar', v: fmtC(Number(d.prestamos_saldo)) });
  return (
    <View style={s.datos}>
      {lineas.map((l, i) => (
        <View key={i} style={s.datoFila}>
          <Text style={s.datoK}>{l.k}</Text>
          <Text style={[s.datoV, l.alerta && { color: theme.danger }]}>{l.v}</Text>
        </View>
      ))}
      {d.motivo ? <Text style={s.motivo}>«{String(d.motivo)}»</Text> : null}
    </View>
  );
}

function Tarjeta({ f, onDecidir }: { f: FilaSolicitud; onDecidir: (d: 'aprobado' | 'rechazado') => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={s.icono}>
          <Ionicons name={f.tipo === 'adelanto' ? 'cash-outline' : 'wallet-outline'} size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.nombre}>{f.colaborador ?? 'Colaborador'}</Text>
          <Text style={s.texto}>{f.resumen}</Text>
          <Text style={s.meta}>
            {f.pidio ? `Registrado por ${f.pidio}` : 'Lo pidió el colaborador'}
            {f.total_pasos > 1 ? ` · paso ${f.paso_actual} de ${f.total_pasos}` : ''}
          </Text>
          {f.por_suplencia_de ? <Text style={s.suplente}>Decides como suplente de {f.por_suplencia_de}.</Text> : null}
          {f.vencida ? <Text style={s.vencida}>Lleva más del plazo</Text> : null}
        </View>
      </View>
      <Datos f={f} />
      <View style={s.botones}>
        <TouchableOpacity style={s.btnAprobar} onPress={() => onDecidir('aprobado')}>
          <Text style={s.btnAprobarText}>Aprobar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnRechazar} onPress={() => onDecidir('rechazado')}>
          <Text style={s.btnRechazarText}>Rechazar</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={s.toggle}>
        <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textSecondary} />
        <Text style={s.toggleText}>Recorrido</Text>
      </TouchableOpacity>
      {abierto ? (
        <View style={s.recorrido}>
          <RecorridoSolicitud tabla={f.ref_tabla} refId={f.ref_id} />
        </View>
      ) : null}
    </View>
  );
}

export default function PorAprobarScreen() {
  const [filas, setFilas] = useState<FilaSolicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [hoja, setHoja] = useState<{ f: FilaSolicitud; d: 'aprobado' | 'rechazado' } | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorHoja, setErrorHoja] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await misPorAprobar();
    if (r) {
      setFilas(r);
      setError(null);
    } else setError('No se pudieron cargar las solicitudes.');
    setCargando(false);
    setRefrescando(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  async function confirmar() {
    if (!hoja) return;
    if (hoja.d === 'rechazado' && comentario.trim().length < 8) {
      setErrorHoja('Escribe el motivo (al menos 8 letras): el colaborador lo verá.');
      return;
    }
    setEnviando(true);
    setErrorHoja(null);
    const r = await decidir(hoja.f, hoja.d, comentario);
    setEnviando(false);
    if (!r.ok) {
      setErrorHoja(r.error);
      return;
    }
    setHoja(null);
    setAviso(
      r.mensaje ??
        (hoja.d === 'rechazado'
          ? 'Rechazada. El colaborador fue notificado.'
          : r.estado === 'aprobada'
            ? 'Aprobada. El colaborador fue notificado.'
            : 'Tu aprobación quedó registrada.'),
    );
    void cargar();
  }

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={s.scroll}
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
        {error ? <Text style={s.error}>{error}</Text> : null}
        {cargando ? (
          <View style={s.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : filas.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="file-tray-outline" size={40} color={theme.textMuted} />
            <Text style={s.emptyText}>No tienes nada por aprobar</Text>
            <Text style={s.emptyHint}>Cuando alguien te necesite, te avisamos aquí y en tu teléfono.</Text>
          </View>
        ) : (
          filas.map((f) => (
            <Tarjeta
              key={f.id}
              f={f}
              onDecidir={(d) => {
                setHoja({ f, d });
                setComentario('');
                setErrorHoja(null);
              }}
            />
          ))
        )}
      </ScrollView>

      <Modal visible={!!hoja} transparent animationType="slide" onRequestClose={() => setHoja(null)}>
        <KeyboardAvoidingView style={s.modalFondo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.hoja}>
            <Text style={s.h2}>{hoja?.d === 'aprobado' ? 'Aprobar solicitud' : 'Rechazar solicitud'}</Text>
            <Text style={s.meta}>
              {hoja?.f.colaborador ?? ''} · {hoja?.f.resumen ?? ''}
            </Text>
            {hoja && hoja.d === 'aprobado' && hoja.f.total_pasos > hoja.f.paso_actual ? (
              <Text style={s.texto}>
                Después de ti la revisa el paso {hoja.f.paso_actual + 1} de {hoja.f.total_pasos}.
              </Text>
            ) : null}
            <Text style={s.label}>{hoja?.d === 'aprobado' ? 'Comentario (opcional)' : 'Motivo del rechazo'}</Text>
            <TextInput
              style={s.input}
              multiline
              value={comentario}
              onChangeText={setComentario}
              placeholder={hoja?.d === 'aprobado' ? 'Ej.: entregar el viernes' : 'El colaborador verá este motivo'}
              placeholderTextColor={theme.textMuted}
            />
            {errorHoja ? <Text style={s.error}>{errorHoja}</Text> : null}
            <View style={s.botones}>
              <TouchableOpacity style={s.btnRechazar} onPress={() => setHoja(null)} disabled={enviando}>
                <Text style={s.btnRechazarText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnAprobar} onPress={() => void confirmar()} disabled={enviando}>
                <Text style={s.btnAprobarText}>
                  {enviando ? 'Guardando…' : hoja?.d === 'aprobado' ? 'Aprobar' : 'Rechazar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: 20, gap: 14, paddingBottom: 40 },
  center: { paddingVertical: 48, alignItems: 'center' },
  card: { backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 16, gap: 10 },
  icono: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.subtleBackground, alignItems: 'center', justifyContent: 'center' },
  nombre: { fontSize: 15, fontWeight: '800', color: theme.textPrimary },
  texto: { fontSize: 14, color: theme.textPrimary, lineHeight: 20 },
  meta: { fontSize: 12, color: theme.textSecondary },
  suplente: { fontSize: 12, color: '#1D4ED8' },
  vencida: { fontSize: 12, color: theme.danger, fontWeight: '700' },
  datos: { backgroundColor: theme.background, borderRadius: 12, padding: 12, gap: 6 },
  datoFila: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  datoK: { fontSize: 12, color: theme.textSecondary, flexShrink: 1 },
  datoV: { fontSize: 12, fontWeight: '700', color: theme.textPrimary, textAlign: 'right' },
  motivo: { fontSize: 13, color: theme.textPrimary, marginTop: 2 },
  botones: { flexDirection: 'row', gap: 10 },
  btnAprobar: { flex: 1, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnAprobarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnRechazar: { flex: 1, borderWidth: 1, borderColor: theme.border, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnRechazarText: { color: theme.textPrimary, fontWeight: '700', fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  toggleText: { fontSize: 13, color: theme.textSecondary, fontWeight: '600' },
  recorrido: { borderWidth: 1, borderColor: theme.cardBorder, borderRadius: 12, padding: 12 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyText: { color: theme.textSecondary, fontSize: 15, fontWeight: '700' },
  emptyHint: { color: theme.textMuted, fontSize: 13, textAlign: 'center' },
  okBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 12, padding: 12 },
  okText: { flex: 1, color: '#065F46', fontSize: 13, fontWeight: '600' },
  error: { fontSize: 13, color: theme.danger },
  modalFondo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  hoja: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10, paddingBottom: 32 },
  h2: { fontSize: 17, fontWeight: '800', color: theme.textPrimary },
  label: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  input: {
    borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: theme.textPrimary, minHeight: 80, textAlignVertical: 'top',
  },
});
