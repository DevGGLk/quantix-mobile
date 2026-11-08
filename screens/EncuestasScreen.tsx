import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useTheme, type Palette } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import {
  ESCALA_ACUERDO,
  cargarPendientes,
  cierreCorto,
  esObligatoria,
  faltantes,
  limpiarRespuestas,
  mensajeErrorRespuesta,
  type AccionCompartida,
  type Colega,
  type EncuestaPendiente,
  type Pregunta,
  type ValorRespuesta,
} from '../lib/encuestas';

const ESTADO_ACCION: Record<AccionCompartida['status'], string> = {
  pendiente: 'Por iniciar',
  en_curso: 'En curso',
  hecho: 'Hecho',
};

/** Una pregunta según su tipo. */
function Campo({
  q,
  numero,
  valor,
  onChange,
  faltante,
  styles,
  c,
}: {
  q: Pregunta;
  numero: number;
  valor: ValorRespuesta | undefined;
  onChange: (v: ValorRespuesta) => void;
  faltante: boolean;
  styles: ReturnType<typeof makeStyles>;
  c: Palette;
}) {
  const opcion = (sel: boolean) => [styles.opcion, sel && styles.opcionSel];
  const opcionTxt = (sel: boolean) => [styles.opcionTxt, sel && styles.opcionTxtSel];
  return (
    <View style={[styles.campo, faltante && styles.campoFaltante]}>
      <Text style={styles.pregunta}>
        <Text style={styles.preguntaNum}>{numero}. </Text>
        {q.label}
        {!esObligatoria(q) ? <Text style={styles.opcional}> (opcional)</Text> : null}
      </Text>

      {q.type === 'likert'
        ? ESCALA_ACUERDO.map((txt, i) => {
            const sel = Number(valor) === i + 1;
            return (
              <TouchableOpacity
                key={txt}
                style={opcion(sel)}
                onPress={() => onChange(i + 1)}
                accessibilityRole="radio"
                accessibilityState={{ checked: sel }}
              >
                <Text style={opcionTxt(sel)}>{txt}</Text>
              </TouchableOpacity>
            );
          })
        : null}

      {q.type === 'rating' ? (
        <View style={styles.fila}>
          {[1, 2, 3, 4, 5].map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => onChange(v)}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityRole="radio"
              accessibilityLabel={`${v} de 5`}
              accessibilityState={{ checked: Number(valor) === v }}
            >
              <Ionicons name={Number(valor) >= v ? 'star' : 'star-outline'} size={34} color={Number(valor) >= v ? c.action.base : c.text.tertiary} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {q.type === 'enps' ? (
        <View>
          <View style={styles.enpsGrid}>
            {Array.from({ length: 11 }, (_, v) => {
              const sel = valor !== undefined && valor !== '' && Number(valor) === v;
              return (
                <TouchableOpacity
                  key={v}
                  style={[styles.enpsBtn, sel && styles.opcionSel]}
                  onPress={() => onChange(v)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${v} de 10`}
                  accessibilityState={{ checked: sel }}
                >
                  <Text style={opcionTxt(sel)}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.enpsPie}>
            <Text style={styles.pie}>0 = Nada probable</Text>
            <Text style={styles.pie}>10 = Muy probable</Text>
          </View>
        </View>
      ) : null}

      {q.type === 'choice'
        ? (q.options ?? []).map((op) => {
            const sel = valor === op;
            return (
              <TouchableOpacity
                key={op}
                style={opcion(sel)}
                onPress={() => onChange(op)}
                accessibilityRole="radio"
                accessibilityState={{ checked: sel }}
              >
                <Text style={opcionTxt(sel)}>{op}</Text>
              </TouchableOpacity>
            );
          })
        : null}

      {q.type === 'text' ? (
        <TextInput
          style={styles.texto}
          value={typeof valor === 'string' ? valor : ''}
          onChangeText={onChange}
          placeholder="Escribe con confianza: es anónimo."
          placeholderTextColor={c.text.tertiary}
          multiline
          maxLength={2000}
          accessibilityLabel={q.label}
        />
      ) : null}
    </View>
  );
}

export default function EncuestasScreen() {
  const { session, employee } = useAuth();
  const { palette: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const route = useRoute<RouteProp<RootStackParamList, 'Encuestas'>>();
  const userId = session?.user?.id ?? null;
  const companyId = employee?.company_id ?? null;

  const [lista, setLista] = useState<EncuestaPendiente[]>([]);
  const [acciones, setAcciones] = useState<AccionCompartida[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [abierta, setAbierta] = useState<EncuestaPendiente | null>(null);
  const [respuestas, setRespuestas] = useState<Record<string, ValorRespuesta>>({});
  const [evaluado, setEvaluado] = useState<Colega | null>(null);
  const [colegas, setColegas] = useState<Colega[]>([]);
  const [elegirColega, setElegirColega] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [mostrarFaltantes, setMostrarFaltantes] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const deepLinkUsado = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [pend, acc] = await Promise.all([
        cargarPendientes(companyId),
        companyId
          ? supabase
              .from('survey_action_items')
              .select('id, title, detail, status, due_date, surveys(title)')
              .eq('company_id', companyId)
              .eq('compartido', true)
              .order('updated_at', { ascending: false })
              .limit(6)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      setLista(pend);
      setAcciones(((acc as { data: unknown[] | null }).data ?? []) as AccionCompartida[]);
    } catch (e) {
      setError(mensajeErrorRespuesta(e as { message?: string }, false));
    } finally {
      setCargando(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  const abrir = useCallback(async (s: EncuestaPendiente) => {
    setAbierta(s);
    setRespuestas({});
    setEvaluado(null);
    setColegas([]);
    setMostrarFaltantes(false);
    setEnviada(false);
    setErrorEnvio(null);
    if (s.survey_type === 'evaluacion_360') {
      const { data } = await supabase.rpc('survey_colleagues', { p_survey_id: s.id });
      setColegas((data ?? []) as Colega[]);
    }
  }, []);

  // Aviso → Encuestas { surveyId }: abre esa encuesta.
  const surveyIdParam = route.params?.surveyId;
  useEffect(() => {
    if (!surveyIdParam || deepLinkUsado.current === surveyIdParam || lista.length === 0) return;
    const s = lista.find((x) => x.id === surveyIdParam);
    deepLinkUsado.current = surveyIdParam;
    if (s) void abrir(s);
  }, [surveyIdParam, lista, abrir]);

  const es360 = abierta?.survey_type === 'evaluacion_360';
  const pendientes = useMemo(() => (abierta ? faltantes(abierta.questions ?? [], respuestas) : []), [abierta, respuestas]);
  const idsFaltantes = useMemo(() => new Set(pendientes.map((q) => q.id)), [pendientes]);
  const totalObligatorias = useMemo(() => (abierta ? faltantes(abierta.questions ?? [], {}).length : 0), [abierta]);
  const colegasFiltrados = useMemo(() => {
    const q = buscar.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!q) return colegas;
    return colegas.filter((x) => x.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  }, [colegas, buscar]);

  const enviar = async () => {
    if (!abierta || !userId) return;
    setErrorEnvio(null);
    if (es360 && !evaluado) {
      setErrorEnvio('Elige a qué compañero estás evaluando.');
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (pendientes.length > 0) {
      setMostrarFaltantes(true);
      setErrorEnvio(`Te faltan ${pendientes.length} pregunta(s) por responder (marcadas en rojo).`);
      return;
    }
    setEnviando(true);
    const { error: err } = await supabase.from('survey_responses').insert({
      survey_id: abierta.id,
      respondent_id: userId,
      evaluated_profile_id: es360 ? evaluado?.profile_id : null,
      response_data: limpiarRespuestas(abierta.questions ?? [], respuestas),
    });
    setEnviando(false);
    if (err) {
      setErrorEnvio(mensajeErrorRespuesta(err, es360));
      return;
    }
    setEnviada(true);
    void cargar();
  };

  // ── Gracias ──
  if (abierta && enviada) {
    return (
      <View style={[styles.root, styles.centro]}>
        <Ionicons name="checkmark-circle" size={64} color={c.semantic.success.color} />
        <Text style={styles.gracias}>¡Gracias por participar!</Text>
        <Text style={styles.sub}>Tu respuesta quedó registrada.</Text>
        {es360 && colegas.length > 1 ? (
          <TouchableOpacity style={styles.btnPrimario} onPress={() => void abrir(abierta)}>
            <Text style={styles.btnPrimarioTxt}>Evaluar a otro compañero</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.btnSecundario} onPress={() => setAbierta(null)}>
          <Text style={styles.btnSecundarioTxt}>Volver a encuestas</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Responder ──
  if (abierta) {
    return (
      <View style={styles.root}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => setAbierta(null)} style={styles.volver} accessibilityRole="button">
            <Ionicons name="chevron-back" size={18} color={c.link} />
            <Text style={styles.volverTxt}>Encuestas</Text>
          </TouchableOpacity>
          <Text style={styles.titulo}>{abierta.title}</Text>
          {abierta.description ? <Text style={styles.sub}>{abierta.description}</Text> : null}
          <View style={styles.notaAnonima}>
            <Ionicons name="shield-checkmark" size={16} color={c.semantic.success.color} />
            <Text style={styles.notaAnonimaTxt}>
              {es360 ? 'La persona evaluada nunca sabe quién la evaluó.' : 'Anónima: nadie ve quién respondió qué.'}
              {abierta.closes_at ? ` Cierra ${cierreCorto(abierta.closes_at)}.` : ''}
            </Text>
          </View>

          {es360 ? (
            <View style={styles.campo}>
              <Text style={styles.pregunta}>¿A quién evalúas?</Text>
              <TouchableOpacity style={styles.selector} onPress={() => setElegirColega(true)} accessibilityRole="button">
                <Text style={evaluado ? styles.opcionTxt : styles.placeholder}>{evaluado?.nombre ?? 'Elige un compañero'}</Text>
                <Ionicons name="chevron-down" size={18} color={c.text.secondary} />
              </TouchableOpacity>
              {colegas.length === 0 ? <Text style={styles.pie}>No quedan compañeros por evaluar en esta encuesta.</Text> : null}
            </View>
          ) : null}

          {(abierta.questions ?? []).map((q, i) => (
            <Campo
              key={q.id}
              q={q}
              numero={i + 1}
              valor={respuestas[q.id]}
              onChange={(v) => setRespuestas((r) => ({ ...r, [q.id]: v }))}
              faltante={mostrarFaltantes && idsFaltantes.has(q.id)}
              styles={styles}
              c={c}
            />
          ))}

          {errorEnvio ? <Text style={styles.error}>{errorEnvio}</Text> : null}
          <Text style={styles.progreso}>
            {totalObligatorias - pendientes.length} de {totalObligatorias} obligatorias
          </Text>
          <TouchableOpacity style={[styles.btnPrimario, enviando && { opacity: 0.6 }]} onPress={() => void enviar()} disabled={enviando}>
            {enviando ? <ActivityIndicator color={c.onAction} /> : <Text style={styles.btnPrimarioTxt}>Enviar respuesta</Text>}
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={elegirColega} animationType="slide" transparent onRequestClose={() => setElegirColega(false)}>
          <View style={styles.modalFondo}>
            <View style={styles.modalHoja}>
              <View style={styles.modalCab}>
                <Text style={styles.subtitulo}>¿A quién evalúas?</Text>
                <TouchableOpacity onPress={() => setElegirColega(false)} accessibilityLabel="Cerrar">
                  <Ionicons name="close" size={24} color={c.text.primary} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.buscar}
                value={buscar}
                onChangeText={setBuscar}
                placeholder="Buscar por nombre"
                placeholderTextColor={c.text.tertiary}
              />
              <FlatList
                data={colegasFiltrados}
                keyExtractor={(x) => x.profile_id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.colega}
                    onPress={() => {
                      setEvaluado(item);
                      setElegirColega(false);
                      setBuscar('');
                    }}
                  >
                    <Text style={styles.opcionTxt}>{item.nombre}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.pie}>Sin resultados.</Text>}
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Lista ──
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.contenido}
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={async () => {
            setRefrescando(true);
            await cargar();
            setRefrescando(false);
          }}
          tintColor={c.brandAccent}
        />
      }
    >
      <Text style={styles.titulo}>Encuestas</Text>
      <Text style={styles.sub}>Tu opinión ayuda a mejorar el trabajo de todos. Las de clima son anónimas.</Text>

      {cargando ? <ActivityIndicator style={{ marginTop: 24 }} color={c.brandAccent} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!cargando && lista.length === 0 && !error ? (
        <View style={styles.vacio}>
          <Ionicons name="checkmark-done-circle-outline" size={40} color={c.text.tertiary} />
          <Text style={styles.sub}>No tienes encuestas pendientes.</Text>
        </View>
      ) : null}

      {lista.map((s) => {
        const s360 = s.survey_type === 'evaluacion_360';
        return (
          <TouchableOpacity key={s.id} style={styles.tarjeta} onPress={() => void abrir(s)} accessibilityRole="button">
            <Ionicons name="clipboard-outline" size={28} color={c.semantic.warning.color} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tarjetaTitulo}>{s360 ? 'Evaluación 360: evalúa a tus compañeros' : 'Encuesta pendiente'}</Text>
              <Text style={styles.tarjetaSub} numberOfLines={2}>
                {s.title}
                {s360 && s.evaluados.length > 0 ? ` · llevas ${s.evaluados.length}` : ''}
                {!s360 ? ' · Anónima' : ''}
                {s.closes_at ? ` · Cierra ${cierreCorto(s.closes_at)}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.text.secondary} />
          </TouchableOpacity>
        );
      })}

      {acciones.length > 0 ? (
        <View style={styles.bloque}>
          <Text style={styles.subtitulo}>Lo que estamos haciendo con tus respuestas</Text>
          {acciones.map((a) => (
            <View key={a.id} style={styles.accion}>
              <View style={{ flex: 1 }}>
                <Text style={styles.accionTitulo}>{a.title}</Text>
                {a.detail ? <Text style={styles.tarjetaSub} numberOfLines={3}>{a.detail}</Text> : null}
                <Text style={styles.pie}>
                  {a.surveys?.title ?? 'Encuesta'}
                  {a.due_date ? ` · para el ${a.due_date.split('-').reverse().join('/')}` : ''}
                </Text>
              </View>
              <Text style={[styles.chip, a.status === 'hecho' && styles.chipHecho]}>{ESTADO_ACCION[a.status]}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    centro: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
    contenido: { padding: 16, paddingBottom: 48, gap: 12 },
    titulo: { fontSize: 22, fontWeight: '800', color: c.text.primary },
    subtitulo: { fontSize: 16, fontWeight: '700', color: c.text.primary },
    sub: { fontSize: 14, color: c.text.secondary, textAlign: 'left' },
    gracias: { fontSize: 20, fontWeight: '800', color: c.text.primary },
    volver: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    volverTxt: { color: c.link, fontWeight: '600' },
    notaAnonima: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    notaAnonimaTxt: { flex: 1, fontSize: 12, color: c.text.secondary },
    campo: { backgroundColor: c.surface.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
    campoFaltante: { borderColor: c.semantic.danger.color, borderWidth: 2 },
    pregunta: { fontSize: 15, fontWeight: '700', color: c.text.primary },
    preguntaNum: { color: c.text.tertiary },
    opcional: { fontSize: 12, fontWeight: '400', color: c.text.tertiary },
    fila: { flexDirection: 'row', gap: 6 },
    opcion: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: c.input.bg },
    opcionSel: { backgroundColor: c.action.base, borderColor: c.action.base },
    opcionTxt: { fontSize: 14, fontWeight: '600', color: c.text.primary },
    opcionTxtSel: { color: c.onAction },
    enpsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    enpsBtn: {
      width: 44,
      height: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.input.bg,
    },
    enpsPie: { flexDirection: 'row', justifyContent: 'space-between' },
    pie: { fontSize: 11, color: c.text.tertiary },
    texto: {
      minHeight: 90,
      borderWidth: 1,
      borderColor: c.input.border,
      backgroundColor: c.input.bg,
      borderRadius: 12,
      padding: 12,
      color: c.text.primary,
      textAlignVertical: 'top',
    },
    selector: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.input.border,
      backgroundColor: c.input.bg,
      borderRadius: 12,
      padding: 12,
    },
    placeholder: { fontSize: 14, color: c.text.tertiary },
    error: { color: c.semantic.danger.text, backgroundColor: c.semantic.danger.surface, padding: 10, borderRadius: 10, fontSize: 13 },
    progreso: { fontSize: 12, color: c.text.secondary, textAlign: 'center' },
    btnPrimario: { backgroundColor: c.action.base, borderRadius: 14, paddingVertical: 14, alignItems: 'center', alignSelf: 'stretch' },
    btnPrimarioTxt: { color: c.onAction, fontWeight: '700', fontSize: 15 },
    btnSecundario: { paddingVertical: 12, alignItems: 'center', alignSelf: 'stretch' },
    btnSecundarioTxt: { color: c.link, fontWeight: '600' },
    vacio: { alignItems: 'center', gap: 8, paddingVertical: 32 },
    tarjeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.semantic.warning.surface,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
    },
    tarjetaTitulo: { fontSize: 15, fontWeight: '700', color: c.text.primary },
    tarjetaSub: { fontSize: 13, color: c.text.secondary },
    bloque: { backgroundColor: c.surface.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: c.border, marginTop: 8 },
    accion: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    accionTitulo: { fontSize: 14, fontWeight: '600', color: c.text.primary },
    chip: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text.secondary,
      backgroundColor: c.surface.sunken,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      overflow: 'hidden',
    },
    chipHecho: { color: c.semantic.success.text, backgroundColor: c.semantic.success.surface },
    modalFondo: { flex: 1, backgroundColor: c.backdrop, justifyContent: 'flex-end' },
    modalHoja: { backgroundColor: c.surface.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '80%', gap: 10 },
    modalCab: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    buscar: {
      borderWidth: 1,
      borderColor: c.input.border,
      backgroundColor: c.input.bg,
      borderRadius: 12,
      padding: 10,
      color: c.text.primary,
    },
    colega: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  });
