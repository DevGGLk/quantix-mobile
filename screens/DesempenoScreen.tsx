import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { useTheme, type Palette } from '../theme';
import {
  ESCALA,
  ESTADO_PDI,
  cargarTareasPendientes,
  etiquetaNota,
  fechaYmd,
  mensajeError,
  type Detalle,
  type MiResultado,
  type PdiItem,
  type Tarea,
} from '../lib/desempeno';

type Styles = ReturnType<typeof makeStyles>;

function Escala({ valor, onChange, styles }: { valor: number | null | undefined; onChange: (v: number) => void; styles: Styles }) {
  return (
    <View style={styles.escala}>
      {ESCALA.map((e) => {
        const sel = valor === e.valor;
        return (
          <TouchableOpacity
            key={e.valor}
            style={[styles.escalaBtn, sel && styles.escalaSel]}
            onPress={() => onChange(e.valor)}
            accessibilityRole="radio"
            accessibilityState={{ checked: sel }}
            accessibilityLabel={`${e.valor}, ${e.label}`}
          >
            <Text style={[styles.escalaNum, sel && styles.escalaTxtSel]}>{e.valor}</Text>
            <Text style={[styles.escalaLbl, sel && styles.escalaTxtSel]} numberOfLines={2}>
              {e.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const TITULO_REL = { self: 'Tu autoevaluación', manager: 'Evaluar a', peer: 'Opinar sobre' } as const;

export default function DesempenoScreen() {
  const { palette: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [resultados, setResultados] = useState<MiResultado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tarea, setTarea] = useState<Tarea | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [overall, setOverall] = useState<number | null>(null);
  const [marcar, setMarcar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [nuevoPdi, setNuevoPdi] = useState('');

  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [comentarioFirma, setComentarioFirma] = useState('');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [t, r] = await Promise.all([cargarTareasPendientes(), supabase.rpc('performance_my_results')]);
      setTareas(t);
      setResultados((r.data ?? []) as MiResultado[]);
      return t;
    } catch (e) {
      setError(mensajeError(e as { message?: string }));
      return [];
    } finally {
      setCargando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  const abrir = (t: Tarea) => {
    setTarea(t);
    setRatings(t.borrador?.ratings ?? {});
    setComments(t.borrador?.comments ?? {});
    setStrengths(t.borrador?.strengths ?? '');
    setImprovements(t.borrador?.improvements ?? '');
    setOverall(t.borrador?.overall_rating ?? null);
    setMarcar(false);
  };

  const verResultado = async (reviewId: string) => {
    const { data, error: err } = await supabase.rpc('performance_review_detail', { p_review_id: reviewId });
    if (err) return Alert.alert('Desempeño', mensajeError(err));
    setComentarioFirma('');
    setDetalle(data as Detalle);
  };

  const faltan = tarea ? tarea.competencias.filter((k) => !(ratings[k.id] >= 1)).length : 0;

  const guardar = async (enviar: boolean) => {
    if (!tarea) return;
    const enviarAhora = async () => {
      setGuardando(true);
      const { error: err } = await supabase.rpc('performance_save_feedback', {
        p_review_id: tarea.review_id,
        p_relation: tarea.relation,
        p_data: { ratings, comments, strengths, improvements, overall_rating: overall },
        p_enviar: enviar,
      });
      setGuardando(false);
      if (err) return Alert.alert('Desempeño', mensajeError(err));
      Alert.alert('Desempeño', enviar ? 'Evaluación enviada. ¡Gracias!' : 'Borrador guardado.');
      if (enviar) setTarea(null);
      void cargar();
    };
    if (!enviar) return enviarAhora();
    if (faltan > 0 || (tarea.relation === 'manager' && !overall)) {
      setMarcar(true);
      return Alert.alert('Desempeño', faltan > 0 ? `Falta calificar ${faltan} competencia(s).` : 'Falta la calificación global.');
    }
    Alert.alert('Enviar evaluación', 'Una vez enviada no se puede cambiar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: () => void enviarAhora() },
    ]);
  };

  const agregarPdi = async () => {
    if (!tarea || nuevoPdi.trim().length < 3) return;
    const { error: err } = await supabase.rpc('performance_pdi_save', {
      p_review_id: tarea.review_id,
      p_item_id: null,
      p_title: nuevoPdi.trim(),
      p_action: null,
      p_competency: null,
      p_due_date: null,
    });
    if (err) return Alert.alert('Plan de desarrollo', mensajeError(err));
    setNuevoPdi('');
    const t = await cargar();
    const act = t.find((x) => x.review_id === tarea.review_id && x.relation === tarea.relation);
    if (act) setTarea({ ...tarea, pdi: act.pdi });
  };

  const avanzarPdi = async (it: PdiItem, status: PdiItem['status']) => {
    if (!detalle) return;
    const { error: err } = await supabase.rpc('performance_pdi_progress', { p_item_id: it.id, p_status: status, p_note: it.progress_note ?? null });
    if (err) return Alert.alert('Plan de desarrollo', mensajeError(err));
    void verResultado(detalle.review_id);
  };

  const firmar = async () => {
    if (!detalle) return;
    const { error: err } = await supabase.rpc('performance_acknowledge', { p_review_id: detalle.review_id, p_comment: comentarioFirma || null });
    if (err) return Alert.alert('Desempeño', mensajeError(err));
    void verResultado(detalle.review_id);
    void cargar();
  };

  // ── Formulario ──
  if (tarea) {
    const esJefe = tarea.relation === 'manager';
    const auto = tarea.autoevaluacion;
    const pares = tarea.pares?.suficiente ? tarea.pares : null;
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => setTarea(null)} style={styles.volver} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={c.link} />
          <Text style={styles.volverTxt}>Mi desempeño</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>
          {tarea.relation === 'self' ? TITULO_REL.self : `${TITULO_REL[tarea.relation]} ${tarea.evaluado_nombre_ficha || tarea.evaluado}`}
        </Text>
        <Text style={styles.sub}>
          {tarea.cycle.name}
          {tarea.vence ? ` · vence ${fechaYmd(tarea.vence)}` : ''}
        </Text>
        <View style={styles.nota}>
          <Ionicons name="shield-checkmark" size={16} color={c.semantic.success.color} />
          <Text style={styles.notaTxt}>
            {tarea.relation === 'peer'
              ? 'Anónima: se muestra solo el promedio de 3 o más compañeros.'
              : tarea.relation === 'self'
                ? 'Tu evaluador la verá cuando la envíes.'
                : 'El colaborador la verá cuando RRHH publique los resultados.'}
          </Text>
        </View>

        {tarea.competencias.map((k, i) => (
          <View key={k.id} style={[styles.campo, marcar && !(ratings[k.id] >= 1) && styles.campoFalta]}>
            <Text style={styles.pregunta}>
              {i + 1}. {k.name}
            </Text>
            {k.description ? <Text style={styles.desc}>{k.description}</Text> : null}
            <Escala valor={ratings[k.id]} onChange={(v) => setRatings((r) => ({ ...r, [k.id]: v }))} styles={styles} />
            {esJefe && (auto?.ratings?.[k.id] || pares?.promedios?.[k.id]) ? (
              <Text style={styles.pie}>
                {auto?.ratings?.[k.id] ? `Autoevaluación: ${auto.ratings[k.id]}` : ''}
                {auto?.ratings?.[k.id] && pares?.promedios?.[k.id] ? ' · ' : ''}
                {pares?.promedios?.[k.id] ? `Compañeros: ${Number(pares.promedios[k.id]).toFixed(1)}` : ''}
              </Text>
            ) : null}
            <TextInput
              style={styles.input}
              value={comments[k.id] ?? ''}
              onChangeText={(v) => setComments((x) => ({ ...x, [k.id]: v }))}
              placeholder="Ejemplo concreto (opcional)"
              placeholderTextColor={c.text.tertiary}
              multiline
              maxLength={1000}
            />
          </View>
        ))}

        <View style={styles.campo}>
          <Text style={styles.pregunta}>{tarea.relation === 'self' ? '¿De qué logros te sientes orgulloso?' : 'Fortalezas'}</Text>
          <TextInput style={styles.input} value={strengths} onChangeText={setStrengths} multiline maxLength={2000} />
          <Text style={styles.pregunta}>
            {tarea.relation === 'self' ? '¿En qué quieres mejorar o qué apoyo necesitas?' : 'Oportunidades de mejora'}
          </Text>
          <TextInput style={styles.input} value={improvements} onChangeText={setImprovements} multiline maxLength={2000} />
        </View>

        {esJefe && auto && (auto.strengths || auto.improvements) ? (
          <View style={styles.bloqueInfo}>
            <Text style={styles.bloqueTitulo}>De su autoevaluación</Text>
            {auto.strengths ? <Text style={styles.desc}>Logros: {auto.strengths}</Text> : null}
            {auto.improvements ? <Text style={styles.desc}>Quiere mejorar: {auto.improvements}</Text> : null}
          </View>
        ) : null}
        {esJefe && pares?.comentarios?.length ? (
          <View style={styles.bloqueInfo}>
            <Text style={styles.bloqueTitulo}>Lo que dicen sus compañeros (anónimo)</Text>
            {pares.comentarios.map((t, i) => (
              <Text key={i} style={styles.desc}>• {t}</Text>
            ))}
          </View>
        ) : null}

        {esJefe ? (
          <View style={[styles.campo, marcar && !overall && styles.campoFalta]}>
            <Text style={styles.pregunta}>Calificación global</Text>
            <Text style={styles.desc}>Tu valoración del período completo (no tiene que ser el promedio).</Text>
            <Escala valor={overall} onChange={setOverall} styles={styles} />
          </View>
        ) : null}

        {esJefe ? (
          <View style={styles.campo}>
            <Text style={styles.pregunta}>Plan de desarrollo</Text>
            {(tarea.pdi ?? []).map((it) => (
              <Text key={it.id} style={styles.desc}>
                • {it.title}
                {it.due_date ? ` (para el ${fechaYmd(it.due_date)})` : ''}
              </Text>
            ))}
            <View style={styles.fila}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={nuevoPdi}
                onChangeText={setNuevoPdi}
                placeholder="Nuevo objetivo de desarrollo"
                placeholderTextColor={c.text.tertiary}
                maxLength={200}
              />
              <TouchableOpacity style={styles.btnMini} onPress={() => void agregarPdi()} accessibilityLabel="Agregar objetivo">
                <Ionicons name="add" size={22} color={c.onAction} />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <Text style={styles.progreso}>
          {tarea.competencias.length - faltan} de {tarea.competencias.length} calificadas
        </Text>
        <TouchableOpacity style={[styles.btnPrimario, guardando && { opacity: 0.6 }]} onPress={() => void guardar(true)} disabled={guardando}>
          {guardando ? <ActivityIndicator color={c.onAction} /> : <Text style={styles.btnPrimarioTxt}>Enviar</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecundario} onPress={() => void guardar(false)} disabled={guardando}>
          <Text style={styles.btnSecundarioTxt}>Guardar borrador</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Resultado ──
  if (detalle) {
    const d = detalle;
    const pares = d.pares?.suficiente ? d.pares : null;
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.contenido} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => setDetalle(null)} style={styles.volver} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={c.link} />
          <Text style={styles.volverTxt}>Mi desempeño</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>{d.cycle.name}</Text>
        <Text style={styles.sub}>
          {fechaYmd(d.cycle.period_start)} al {fechaYmd(d.cycle.period_end)} · Evaluador: {d.evaluador}
        </Text>
        <View style={styles.notaFinal}>
          <Text style={styles.notaNum}>{d.final_rating ?? '—'}/5</Text>
          <Text style={styles.pregunta}>{etiquetaNota(d.final_rating)}</Text>
          <Text style={styles.desc}>{ESCALA.find((e) => e.valor === d.final_rating)?.ayuda}</Text>
        </View>

        <View style={styles.campo}>
          <Text style={styles.pregunta}>Por competencia</Text>
          {d.competencias.map((k) => (
            <View key={k.id} style={styles.compFila}>
              <View style={{ flex: 1 }}>
                <Text style={styles.compNombre}>{k.name}</Text>
                {d.jefe?.comments?.[k.id] ? <Text style={styles.desc}>«{d.jefe.comments[k.id]}»</Text> : null}
                <Text style={styles.pie}>
                  {d.cycle.self_review ? `Tú: ${d.autoevaluacion?.ratings?.[k.id] ?? '—'} · ` : ''}
                  {pares ? `Compañeros: ${pares.promedios?.[k.id] != null ? Number(pares.promedios[k.id]).toFixed(1) : '—'}` : ''}
                </Text>
              </View>
              <Text style={styles.compNota}>{d.jefe?.ratings?.[k.id] ?? '—'}</Text>
            </View>
          ))}
        </View>

        {d.jefe?.strengths ? (
          <View style={styles.bloqueInfo}>
            <Text style={styles.bloqueTitulo}>Fortalezas</Text>
            <Text style={styles.desc}>{d.jefe.strengths}</Text>
          </View>
        ) : null}
        {d.jefe?.improvements ? (
          <View style={styles.bloqueInfo}>
            <Text style={styles.bloqueTitulo}>Oportunidades de mejora</Text>
            <Text style={styles.desc}>{d.jefe.improvements}</Text>
          </View>
        ) : null}
        {pares?.comentarios?.length ? (
          <View style={styles.bloqueInfo}>
            <Text style={styles.bloqueTitulo}>Lo que dicen tus compañeros (anónimo)</Text>
            {pares.comentarios.map((t, i) => (
              <Text key={i} style={styles.desc}>• {t}</Text>
            ))}
          </View>
        ) : null}

        <View style={styles.campo}>
          <Text style={styles.pregunta}>Tu plan de desarrollo</Text>
          {d.pdi.length === 0 ? <Text style={styles.desc}>Sin objetivos.</Text> : null}
          {d.pdi.map((it) => (
            <View key={it.id} style={styles.pdi}>
              <Text style={styles.compNombre}>{it.title}</Text>
              {it.action ? <Text style={styles.desc}>{it.action}</Text> : null}
              {it.due_date ? <Text style={styles.pie}>Para el {fechaYmd(it.due_date)}</Text> : null}
              <View style={styles.fila}>
                {(Object.keys(ESTADO_PDI) as PdiItem['status'][]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    disabled={!d.puede_avanzar_pdi}
                    onPress={() => void avanzarPdi(it, s)}
                    style={[styles.chip, it.status === s && styles.chipSel]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: it.status === s }}
                  >
                    <Text style={[styles.chipTxt, it.status === s && styles.escalaTxtSel]}>{ESTADO_PDI[s]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>

        {d.acknowledged_at ? (
          <View style={styles.bloqueInfo}>
            <Text style={styles.bloqueTitulo}>Firmada de recibido el {new Date(d.acknowledged_at).toLocaleDateString('es-NI')}</Text>
            {d.employee_comment ? <Text style={styles.desc}>Tu comentario: «{d.employee_comment}»</Text> : null}
          </View>
        ) : d.puede_firmar ? (
          <View style={styles.campo}>
            <Text style={styles.pregunta}>Firmar de recibido</Text>
            <Text style={styles.desc}>Confirma que la recibiste y leíste; no significa que estés de acuerdo.</Text>
            <TextInput
              style={styles.input}
              value={comentarioFirma}
              onChangeText={setComentarioFirma}
              placeholder="Comentario (opcional)"
              placeholderTextColor={c.text.tertiary}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity style={styles.btnPrimario} onPress={() => void firmar()}>
              <Text style={styles.btnPrimarioTxt}>Firmar de recibido</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
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
      <Text style={styles.titulo}>Mi desempeño</Text>
      <Text style={styles.sub}>Tus evaluaciones pendientes, las de tu equipo y tus resultados.</Text>
      {cargando ? <ActivityIndicator style={{ marginTop: 24 }} color={c.brandAccent} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!cargando && !error && tareas.length === 0 && resultados.length === 0 ? (
        <View style={styles.vacio}>
          <Ionicons name="ribbon-outline" size={40} color={c.text.tertiary} />
          <Text style={styles.sub}>No tienes evaluaciones de desempeño por ahora.</Text>
        </View>
      ) : null}

      {tareas.map((t) => (
        <TouchableOpacity key={`${t.review_id}/${t.relation}`} style={styles.tarjeta} onPress={() => abrir(t)} accessibilityRole="button">
          <Ionicons name="clipboard-outline" size={26} color={c.brandAccent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.compNombre}>
              {t.relation === 'self' ? 'Tu autoevaluación' : `${TITULO_REL[t.relation]} ${t.evaluado_nombre_ficha || t.evaluado}`}
            </Text>
            <Text style={styles.desc}>
              {t.cycle.name}
              {t.vence ? ` · vence ${fechaYmd(t.vence)}` : ''}
              {t.borrador ? ' · borrador guardado' : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.text.secondary} />
        </TouchableOpacity>
      ))}

      {resultados.map((r) => (
        <TouchableOpacity key={r.review_id} style={styles.tarjetaResultado} onPress={() => void verResultado(r.review_id)} accessibilityRole="button">
          <Ionicons name="ribbon-outline" size={26} color={c.semantic.success.color} />
          <View style={{ flex: 1 }}>
            <Text style={styles.compNombre}>
              {r.cycle}: {r.final_rating ?? '—'}/5 · {etiquetaNota(r.final_rating)}
            </Text>
            <Text style={styles.desc}>
              {r.pdi_abiertos > 0 ? `${r.pdi_abiertos} objetivo(s) abiertos` : 'Plan de desarrollo al día'}
              {!r.acknowledged_at ? ' · falta tu firma' : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.text.secondary} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    contenido: { padding: 16, paddingBottom: 48, gap: 12 },
    titulo: { fontSize: 22, fontWeight: '800', color: c.text.primary },
    sub: { fontSize: 14, color: c.text.secondary },
    volver: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    volverTxt: { color: c.link, fontWeight: '600' },
    nota: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    notaTxt: { flex: 1, fontSize: 12, color: c.text.secondary },
    campo: { backgroundColor: c.surface.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
    campoFalta: { borderColor: c.semantic.danger.color, borderWidth: 2 },
    pregunta: { fontSize: 15, fontWeight: '700', color: c.text.primary },
    desc: { fontSize: 13, color: c.text.secondary },
    pie: { fontSize: 11, color: c.text.tertiary },
    escala: { flexDirection: 'row', gap: 4 },
    escalaBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 2,
      alignItems: 'center',
      backgroundColor: c.input.bg,
    },
    escalaSel: { backgroundColor: c.action.base, borderColor: c.action.base },
    escalaNum: { fontSize: 16, fontWeight: '800', color: c.text.primary },
    escalaLbl: { fontSize: 9, color: c.text.secondary, textAlign: 'center' },
    escalaTxtSel: { color: c.onAction },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: c.input.border,
      backgroundColor: c.input.bg,
      borderRadius: 10,
      padding: 10,
      color: c.text.primary,
      textAlignVertical: 'top',
    },
    fila: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
    btnMini: { backgroundColor: c.action.base, borderRadius: 10, padding: 10 },
    bloqueInfo: { backgroundColor: c.surface.sunken, borderRadius: 12, padding: 12, gap: 4 },
    bloqueTitulo: { fontSize: 13, fontWeight: '700', color: c.text.primary },
    progreso: { fontSize: 12, color: c.text.secondary, textAlign: 'center' },
    btnPrimario: { backgroundColor: c.action.base, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    btnPrimarioTxt: { color: c.onAction, fontWeight: '700', fontSize: 15 },
    btnSecundario: { paddingVertical: 12, alignItems: 'center' },
    btnSecundarioTxt: { color: c.link, fontWeight: '600' },
    error: { color: c.semantic.danger.text, backgroundColor: c.semantic.danger.surface, padding: 10, borderRadius: 10 },
    vacio: { alignItems: 'center', gap: 8, paddingVertical: 32 },
    tarjeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.surface.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: c.brandAccent,
    },
    tarjetaResultado: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.surface.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
    },
    notaFinal: { backgroundColor: c.surface.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 16, alignItems: 'center', gap: 2 },
    notaNum: { fontSize: 34, fontWeight: '900', color: c.text.primary },
    compFila: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    compNombre: { fontSize: 14, fontWeight: '600', color: c.text.primary },
    compNota: { fontSize: 18, fontWeight: '800', color: c.text.primary, minWidth: 24, textAlign: 'right' },
    pdi: { gap: 4, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    chip: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    chipSel: { backgroundColor: c.action.base, borderColor: c.action.base },
    chipTxt: { fontSize: 12, color: c.text.secondary, fontWeight: '600' },
  });
