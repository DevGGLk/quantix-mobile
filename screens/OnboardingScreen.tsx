import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useOnboardingGate } from '../lib/OnboardingGateContext';
import { useAuth } from '../lib/AuthContext';
import { runOnboardingCompletion } from '../lib/onboardingComplete';
import {
  ONBOARDING_FALLBACK_MISSION_CULTURE,
  ONBOARDING_FALLBACK_RULEBOOK,
  ONBOARDING_POLICIES_FETCH_FAILED_BODY,
  ONBOARDING_POLICIES_FETCH_FAILED_TITLE,
} from '../lib/onboardingFallbackCopy';
import {
  fetchInductionQuizQuestions,
  fetchJobTitleFunctionsBlock,
  fetchOnboardingCompanyData,
  ONBOARDING_ACADEMY_COURSE_CATEGORY,
  type InductionQuizQuestion,
} from '../lib/api';

const STEPS = 5;

/** Resolución multi-tenant del cuestionario antes de llegar al paso 2. */
type InductionRoute = 'loading' | 'quiz' | 'skip';

const MIS_FUNCIONES_FALLBACK_MSG =
  'Tu jefe directo te comunicará tus funciones específicas.';

function dotLabel(step: number) {
  switch (step) {
    case 0:
      return 'Cultura';
    case 1:
      return 'Reglamento';
    case 2:
      return 'Cuestionario';
    case 3:
      return 'Mis funciones';
    case 4:
      return '¡Listo!';
    default:
      return '';
  }
}

function normalizeCorpText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2).trim();
    } catch {
      return '';
    }
  }
  return String(value).trim();
}

/** Mismos campos que Mi Empresa (`companies`). */
function buildMissionCultureBlock(row: Record<string, unknown> | null | undefined): string {
  if (!row) return '';
  const m = normalizeCorpText(row.mission);
  const v = normalizeCorpText(row.vision);
  const cv = normalizeCorpText(row.corporate_values);
  const parts: string[] = [];
  if (m) parts.push(`Misión\n\n${m}`);
  if (v) parts.push(`Visión\n\n${v}`);
  if (cv) parts.push(`Valores corporativos\n\n${cv}`);
  return parts.join('\n\n');
}

/** Mismo origen que la pantalla Reglamento: `company_policies`. */
function buildPoliciesPlaintext(
  rows: { title?: unknown; content?: unknown }[] | null | undefined
): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows
    .map((p) => {
      const t = normalizeCorpText(p.title);
      const body = normalizeCorpText(p.content);
      if (!t && !body) return '';
      return t ? `${t}\n\n${body}` : body;
    })
    .filter(Boolean)
    .join('\n\n———\n\n');
}

function formatJobFunctionRow(row: Record<string, unknown>) {
  const t =
    row.title ??
    row.name ??
    row.function_name ??
    row.description ??
    row.function_text;
  return typeof t === 'string' && t.trim() ? t.trim() : 'Función';
}

export default function OnboardingScreen() {
  const { releaseToMainApp } = useOnboardingGate();
  const { session, employee, profile } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [jobTitleId, setJobTitleId] = useState<string | null>(null);
  const [missionVision, setMissionVision] = useState('');
  const [rulebook, setRulebook] = useState('');
  /** `company_policies` respondió con error (red/RLS); distinto de “no hay filas”. */
  const [policiesLoadError, setPoliciesLoadError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [jobFunctions, setJobFunctions] = useState<Record<string, unknown>[]>([]);
  const [loadingFunctions, setLoadingFunctions] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const [inductionQuestions, setInductionQuestions] = useState<InductionQuizQuestion[]>([]);
  const [inductionQuizLoading, setInductionQuizLoading] = useState(false);
  const [inductionQuizLoadError, setInductionQuizLoadError] = useState<string | null>(null);
  const [inductionAnswers, setInductionAnswers] = useState<Record<string, number>>({});
  const [inductionQuizPassed, setInductionQuizPassed] = useState(false);
  const [inductionRetryNonce, setInductionRetryNonce] = useState(0);

  const [jobTitleLabel, setJobTitleLabel] = useState('');
  const [jobTitleFunctionsDescription, setJobTitleFunctionsDescription] = useState<string | null>(null);
  const [loadingJobTitleBlock, setLoadingJobTitleBlock] = useState(false);
  const [inductionRoute, setInductionRoute] = useState<InductionRoute>('loading');

  useEffect(() => {
    console.log('[Onboarding] auth snapshot (joins)', {
      profile,
      profileCompanyId: profile?.company_id,
      employeeCompanyId: employee?.company_id,
      employeeJobTitleId: employee?.job_title_id,
    });
  }, [profile, employee]);

  useEffect(() => {
    if (!companyId) {
      setInductionRoute('loading');
      return;
    }
    let cancelled = false;
    setInductionRoute('loading');
    void fetchInductionQuizQuestions(companyId)
      .then((r) => {
        if (cancelled) return;
        if (r.errorMessage) setInductionRoute('quiz');
        else if (r.inductionNotConfigured) setInductionRoute('skip');
        else setInductionRoute('quiz');
      })
      .catch((e) => {
        console.error('[Onboarding] warmup induction:', e);
        if (!cancelled) setInductionRoute('quiz');
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useLayoutEffect(() => {
    if (step === 2 && inductionRoute === 'skip') {
      setStep(3);
    }
  }, [step, inductionRoute]);

  const loadProfileAndCompany = useCallback(async () => {
    setLoading(true);
    try {
      const uid = session?.user?.id ?? null;
      if (!uid) {
        Alert.alert('Sesión', 'No se pudo obtener tu sesión.');
        return;
      }
      setUserId(uid);

      // `company_id`: expediente primero; si falta, perfil tras login (AuthContext ya hidrata desde employees).
      const cid = employee?.company_id ?? profile?.company_id ?? null;
      const jtid = employee?.job_title_id ?? null;
      setCompanyId(cid);
      setJobTitleId(jtid);

      if (!cid) {
        setPoliciesLoadError(null);
        setMissionVision(ONBOARDING_FALLBACK_MISSION_CULTURE);
        setRulebook(ONBOARDING_FALLBACK_RULEBOOK);
        console.error('[Onboarding] company_id nulo: no hay joins a companies / expediente.');
        return;
      }

      /** ADN multi-marca: `employees.branch_id` → `branches`; holding comparte `companies` como respaldo. */
      const branchId = employee?.branch_id ?? null;
      const { companyRow, policiesRows, companiesError, policiesError } =
        await fetchOnboardingCompanyData(cid, branchId);

      if (companiesError) {
        Alert.alert('Error de Conexión', `Detalle: ${companiesError}`);
        setMissionVision(ONBOARDING_FALLBACK_MISSION_CULTURE);
      } else {
        const culture = buildMissionCultureBlock(companyRow);
        setMissionVision(culture.trim() ? culture : ONBOARDING_FALLBACK_MISSION_CULTURE);
      }

      if (policiesError) {
        Alert.alert('Error de Conexión', `Detalle: ${policiesError}`);
        setPoliciesLoadError(ONBOARDING_POLICIES_FETCH_FAILED_TITLE);
        setRulebook('');
        setTermsAccepted(false);
      } else {
        setPoliciesLoadError(null);
        const ruleText = buildPoliciesPlaintext(policiesRows);
        setRulebook(ruleText.trim() ? ruleText : ONBOARDING_FALLBACK_RULEBOOK);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Onboarding] loadProfileAndCompany:', e);
      Alert.alert('Error de Conexión', `Detalle: ${msg}`);
      setPoliciesLoadError(null);
      setMissionVision(ONBOARDING_FALLBACK_MISSION_CULTURE);
      setRulebook(ONBOARDING_FALLBACK_RULEBOOK);
    } finally {
      setLoading(false);
    }
  }, [
    session?.user?.id,
    employee?.company_id,
    employee?.branch_id,
    employee?.job_title_id,
    profile?.company_id,
  ]);

  useEffect(() => {
    loadProfileAndCompany();
  }, [loadProfileAndCompany]);

  useEffect(() => {
    if (step !== 2 || !companyId || inductionRoute === 'skip') return;

    let cancelled = false;
    setInductionQuizLoading(true);
    setInductionQuizLoadError(null);
    setInductionQuizPassed(false);
    setInductionAnswers({});

    void (async () => {
      try {
        const { questions, errorMessage, inductionNotConfigured } =
          await fetchInductionQuizQuestions(companyId);
        if (cancelled) return;
        if (errorMessage) {
          setInductionQuestions([]);
          setInductionQuizLoadError(errorMessage);
          Alert.alert('Error de Conexión', `Detalle: ${errorMessage}`);
        } else if (inductionNotConfigured) {
          setInductionQuestions([]);
          setInductionQuizLoadError(null);
        } else {
          setInductionQuestions(questions);
          setInductionQuizLoadError(null);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Onboarding] quiz load:', e);
        if (!cancelled) {
          setInductionQuestions([]);
          setInductionQuizLoadError(msg);
          Alert.alert('Error de Conexión', `Detalle: ${msg}`);
        }
      } finally {
        if (!cancelled) setInductionQuizLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, companyId, inductionRetryNonce, inductionRoute]);

  useEffect(() => {
    if (step !== 3 || !jobTitleId) return;

    let cancelled = false;
    setLoadingJobTitleBlock(true);
    void (async () => {
      try {
        const block = await fetchJobTitleFunctionsBlock(jobTitleId);
        if (cancelled) return;
        setJobTitleLabel(block.titleLabel);
        setJobTitleFunctionsDescription(block.functionsDescription);
        if (block.errorMessage) {
          Alert.alert('Error de Conexión', `Detalle: ${block.errorMessage}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Onboarding] job_titles block:', e);
        if (!cancelled) {
          Alert.alert('Error de Conexión', `Detalle: ${msg}`);
        }
      } finally {
        if (!cancelled) setLoadingJobTitleBlock(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, jobTitleId]);

  useEffect(() => {
    if (step !== 3 || !jobTitleId) return;

    let cancelled = false;
    async function loadFns() {
      setLoadingFunctions(true);
      try {
        let rows: Record<string, unknown>[] | null = null;
        let err: { message?: string } | null = null;

        if (companyId) {
          const scoped = await supabase
            .from('job_functions')
            .select('*')
            .eq('job_title_id', jobTitleId)
            .eq('company_id', companyId);
          if (!scoped.error) {
            rows = (scoped.data ?? []) as Record<string, unknown>[];
          } else {
            const fb = await supabase
              .from('job_functions')
              .select('*')
              .eq('job_title_id', jobTitleId);
            rows = (fb.data ?? []) as Record<string, unknown>[];
            err = fb.error;
          }
        } else {
          const fb = await supabase
            .from('job_functions')
            .select('*')
            .eq('job_title_id', jobTitleId);
          rows = (fb.data ?? []) as Record<string, unknown>[];
          err = fb.error;
        }

        if (err && !rows?.length) {
          console.error('API ERROR [OnboardingScreen.job_functions]:', err);
          Alert.alert('Error de Conexión', `Detalle: ${err.message ?? 'job_functions'}`);
        }
        if (!cancelled) setJobFunctions(rows ?? []);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Onboarding] job_functions ex:', e);
        if (!cancelled) {
          setJobFunctions([]);
          Alert.alert('Error de Conexión', `Detalle: ${msg}`);
        }
      } finally {
        if (!cancelled) setLoadingFunctions(false);
      }
    }
    loadFns();
    return () => {
      cancelled = true;
    };
  }, [step, jobTitleId, companyId]);

  const verifyInductionQuiz = () => {
    if (inductionQuestions.length === 0) return;
    const missing = inductionQuestions.some((q) => inductionAnswers[q.id] === undefined);
    if (missing) {
      Alert.alert('Respuestas incompletas', 'Selecciona una opción en cada pregunta.');
      return;
    }
    const allCorrect = inductionQuestions.every(
      (q) => inductionAnswers[q.id] === q.correctAnswerIndex
    );
    if (!allCorrect) {
      Alert.alert(
        'Resultado insuficiente',
        'Revisa tus respuestas e intenta de nuevo. Debes acertar todas las preguntas clave del reglamento.'
      );
      return;
    }
    setInductionQuizPassed(true);
  };

  const goNext = () => {
    if (step === 1 && policiesLoadError) {
      Alert.alert(
        policiesLoadError,
        'Revisa tu conexión y pulsa «Reintentar» en esta pantalla, o consulta con RRHH.'
      );
      return;
    }
    if (step === 1 && !termsAccepted) {
      Alert.alert('Aceptación requerida', 'Debes aceptar el reglamento y términos para continuar.');
      return;
    }
    if (step === 1 && inductionRoute === 'loading') {
      Alert.alert(
        'Espera un momento',
        'Estamos verificando la inducción configurada para tu empresa (Academia).'
      );
      return;
    }
    if (step === 1 && inductionRoute === 'skip') {
      setStep(3);
      return;
    }
    if (step === 2) {
      if (inductionQuizLoading) {
        Alert.alert('Espera un momento', 'Estamos cargando el cuestionario de verificación.');
        return;
      }
      if (inductionQuizLoadError) {
        Alert.alert(
          'Error al cargar el cuestionario',
          'Revisa tu conexión o intenta de nuevo. Si el problema continúa, contacta a RRHH.'
        );
        return;
      }
      if (inductionQuestions.length === 0) {
        Alert.alert(
          'Cuestionario no disponible',
          `RRHH debe publicar en Academia Virtual un curso publicado para tu empresa con categoría o tag «${ONBOARDING_ACADEMY_COURSE_CATEGORY}» e incluir un cuestionario en el primer módulo.`,
          [{ text: 'Entendido' }]
        );
        return;
      }
      if (!inductionQuizPassed) {
        Alert.alert(
          'Verificación pendiente',
          'Responde el cuestionario y pulsa «Comprobar respuestas» hasta aprobar todas las preguntas.'
        );
        return;
      }
    }
    if (step < STEPS - 1) setStep((s) => s + 1);
  };

  const goBack = () => {
    if (step === 3 && inductionRoute === 'skip') {
      setStep(1);
      return;
    }
    if (step > 0) setStep((s) => s - 1);
  };

  const handleFinish = async () => {
    if (finishing || !userId) return;
    setFinishing(true);
    try {
      await runOnboardingCompletion(
        userId,
        companyId ?? profile?.company_id ?? null,
        employee?.id ?? null
      );
      releaseToMainApp();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e);
      Alert.alert('Error', msg || 'No se pudo completar la inducción. Intenta de nuevo.');
    } finally {
      setFinishing(false);
    }
  };

  const quizNextDisabled =
    step === 2 &&
    (inductionRoute === 'skip' ||
      inductionRoute === 'loading' ||
      inductionQuizLoading ||
      Boolean(inductionQuizLoadError) ||
      inductionQuestions.length === 0 ||
      !inductionQuizPassed);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingHint}>Preparando tu inducción...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.brand}>Inducción corporativa</Text>
        <View style={styles.progressRow}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View key={i} style={styles.progressSegWrap}>
              <View style={[styles.progressSeg, i <= step && styles.progressSegActive]} />
            </View>
          ))}
        </View>
        <Text style={styles.stepHint}>
          Paso {step + 1} de {STEPS}: {dotLabel(step)}
        </Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="people" size={36} color={theme.primary} />
            </View>
            <Text style={styles.cardTitle}>Misión y cultura</Text>
            <Text style={styles.cardBody}>{missionVision}</Text>
          </View>
        )}

        {step === 1 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="document-text" size={36} color={theme.primary} />
            </View>
            <Text style={styles.cardTitle}>Reglamento interno</Text>
            {policiesLoadError ? (
              <View style={styles.policiesErrorBanner}>
                <Ionicons name="cloud-offline-outline" size={24} color="#B45309" />
                <Text style={styles.policiesErrorTitle}>{policiesLoadError}</Text>
                <Text style={styles.policiesErrorBody}>{ONBOARDING_POLICIES_FETCH_FAILED_BODY}</Text>
                <TouchableOpacity
                  style={styles.policiesRetryBtn}
                  activeOpacity={0.85}
                  onPress={() => void loadProfileAndCompany()}
                  accessibilityRole="button"
                  accessibilityLabel="Reintentar cargar el reglamento"
                >
                  <Text style={styles.policiesRetryLabel}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.cardBody}>{rulebook}</Text>
            )}
            <View style={styles.switchRow}>
              <Switch
                value={termsAccepted}
                onValueChange={setTermsAccepted}
                disabled={Boolean(policiesLoadError)}
                trackColor={{ false: '#cbd5e1', true: theme.primary }}
                thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
              />
              <Text
                style={[
                  styles.switchLabel,
                  policiesLoadError ? styles.switchLabelDisabled : null,
                ]}
              >
                {policiesLoadError
                  ? 'Cuando el reglamento cargue correctamente, podrás confirmar tu lectura.'
                  : 'Confirmo que he leído y acepto el reglamento y las políticas aplicables.'}
              </Text>
            </View>
            {inductionRoute === 'skip' ? (
              <Text style={styles.inductionSkipNotice}>
                Inducción no configurada por el administrador: no hay curso publicado con la categoría
                requerida o sin cuestionario. Se omitirá el paso de verificación.
              </Text>
            ) : null}
          </View>
        )}

        {step === 2 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="school" size={36} color={theme.primary} />
            </View>
            <Text style={styles.cardTitle}>Verificación de lectura (Academia)</Text>
            <Text style={styles.cardBodyMuted}>
              Responde el cuestionario vinculado al curso de inducción obligatoria en Academia Virtual. Debes
              acertar todas las preguntas para continuar.
            </Text>
            {inductionQuizLoading ? (
              <ActivityIndicator style={{ marginTop: 16 }} color={theme.primary} />
            ) : inductionQuizLoadError ? (
              <View style={styles.policiesErrorBanner}>
                <Ionicons name="cloud-offline-outline" size={24} color="#B45309" />
                <Text style={styles.policiesErrorTitle}>No se pudo cargar el cuestionario</Text>
                <Text style={styles.policiesErrorBody}>{inductionQuizLoadError}</Text>
                <TouchableOpacity
                  style={styles.policiesRetryBtn}
                  activeOpacity={0.85}
                  onPress={() => setInductionRetryNonce((n) => n + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Reintentar cuestionario"
                >
                  <Text style={styles.policiesRetryLabel}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            ) : inductionQuestions.length === 0 ? (
              <Text style={[styles.cardBodyMuted, { marginTop: 12 }]}>
                {`No hay cuestionario publicado. RRHH debe crear en Academia un curso para tu empresa, categoría o tag «${ONBOARDING_ACADEMY_COURSE_CATEGORY}», publicado, con quiz en el primer módulo.`}
              </Text>
            ) : (
              <View style={{ marginTop: 12, gap: 16 }}>
                {inductionQuestions.map((q, qi) => (
                  <View key={q.id} style={[styles.quizBlock, qi > 0 && styles.quizBlockDivider]}>
                    <Text style={styles.quizQuestionLabel}>
                      {qi + 1}. {q.questionText}
                    </Text>
                    {q.options.map((opt, oi) => {
                      const selected = inductionAnswers[q.id] === oi;
                      return (
                        <TouchableOpacity
                          key={`${q.id}-${oi}`}
                          style={[styles.quizOption, selected && styles.quizOptionSelected]}
                          activeOpacity={0.85}
                          onPress={() =>
                            setInductionAnswers((prev) => ({
                              ...prev,
                              [q.id]: oi,
                            }))
                          }
                        >
                          <Ionicons
                            name={selected ? 'radio-button-on' : 'radio-button-off'}
                            size={20}
                            color={selected ? theme.primary : theme.textMuted}
                          />
                          <Text style={styles.quizOptionText}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
                {inductionQuizPassed ? (
                  <View style={styles.quizPassedBanner}>
                    <Ionicons name="checkmark-circle" size={22} color="#047857" />
                    <Text style={styles.quizPassedText}>Cuestionario aprobado. Puedes continuar.</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.quizVerifyBtn} activeOpacity={0.88} onPress={verifyInductionQuiz}>
                    <Text style={styles.quizVerifyBtnText}>Comprobar respuestas</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {step === 3 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="briefcase" size={36} color={theme.primary} />
            </View>
            <Text style={styles.cardTitle}>Mis funciones</Text>
            {!jobTitleId ? (
              <Text style={styles.cardBodyMuted}>
                Aún no tienes un puesto asignado. Tu gerente puede actualizarlo en RRHH.
              </Text>
            ) : loadingJobTitleBlock || loadingFunctions ? (
              <ActivityIndicator style={{ marginTop: 16 }} color={theme.primary} />
            ) : (
              <>
                {jobTitleLabel ? (
                  <Text style={[styles.cardBody, { marginBottom: 10, fontWeight: '700' }]}>{jobTitleLabel}</Text>
                ) : null}
                {jobTitleFunctionsDescription ? (
                  <Text style={styles.cardBody}>{jobTitleFunctionsDescription}</Text>
                ) : null}
                {jobFunctions.length > 0 ? (
                  <View style={[styles.fnList, { marginTop: jobTitleFunctionsDescription ? 16 : 8 }]}>
                    {jobFunctions.map((row, idx) => (
                      <View key={idx} style={styles.fnItem}>
                        <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                        <Text style={styles.fnText}>{formatJobFunctionRow(row)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {!jobTitleFunctionsDescription && jobFunctions.length === 0 ? (
                  <Text style={[styles.cardBodyMuted, { marginTop: 12 }]}>{MIS_FUNCIONES_FALLBACK_MSG}</Text>
                ) : null}
              </>
            )}
          </View>
        )}

        {step === 4 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="gift" size={40} color={theme.warning} />
            </View>
            <Text style={styles.cardTitle}>¡Último paso!</Text>
            <Text style={styles.cardBody}>
              Estás a punto de completar tu inducción. ¡Bienvenido/a al equipo!
            </Text>
            <TouchableOpacity
              style={[styles.finishBtn, finishing && styles.finishBtnDisabled]}
              activeOpacity={0.88}
              onPress={handleFinish}
              disabled={finishing}
            >
              {finishing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.finishBtnText}>Finalizar Inducción</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {step < 4 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnGhost, step === 0 && styles.navBtnHidden]}
            onPress={goBack}
            disabled={step === 0}
          >
            <Text style={styles.navBtnGhostText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.navBtn,
              (step === 1 && policiesLoadError) || quizNextDisabled ? styles.navBtnDisabled : null,
            ]}
            onPress={goNext}
            activeOpacity={0.88}
            disabled={(step === 1 && Boolean(policiesLoadError)) || quizNextDisabled}
          >
            <Text style={styles.navBtnText}>Siguiente</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 4 && (
        <View style={styles.footerSingle}>
          <TouchableOpacity style={styles.navBtnGhostWide} onPress={goBack} activeOpacity={0.88}>
            <Text style={styles.navBtnGhostText}>Volver</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingHint: {
    fontSize: 15,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 14,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  progressSegWrap: {
    flex: 1,
  },
  progressSeg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
  },
  progressSegActive: {
    backgroundColor: theme.primary,
  },
  stepHint: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  inductionSkipNotice: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: '#B45309',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  cardIconWrap: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 12,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 24,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  cardBodyMuted: {
    fontSize: 14,
    lineHeight: 22,
    color: theme.textMuted,
    marginTop: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
    lineHeight: 20,
  },
  switchLabelDisabled: {
    color: theme.textMuted,
    fontWeight: '500',
  },
  policiesErrorBanner: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 16,
    gap: 10,
    marginBottom: 4,
  },
  policiesErrorTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#92400E',
  },
  policiesErrorBody: {
    fontSize: 14,
    lineHeight: 22,
    color: '#78350F',
    fontWeight: '500',
  },
  policiesRetryBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: theme.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  policiesRetryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  fnList: {
    marginTop: 8,
    gap: 12,
  },
  fnItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  fnText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: theme.textPrimary,
    fontWeight: '500',
  },
  finishBtn: {
    marginTop: 24,
    backgroundColor: theme.primary,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  finishBtnDisabled: {
    opacity: 0.75,
  },
  finishBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.backgroundAlt,
  },
  footerSingle: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.backgroundAlt,
  },
  navBtn: {
    flex: 1,
    backgroundColor: theme.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  navBtnDisabled: {
    opacity: 0.45,
  },
  navBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.border,
  },
  navBtnHidden: {
    opacity: 0,
  },
  navBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  navBtnGhostText: {
    color: theme.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  navBtnGhostWide: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  quizBlock: {
    paddingTop: 4,
  },
  quizBlockDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 16,
    marginTop: 4,
  },
  quizQuestionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 10,
    lineHeight: 22,
  },
  quizOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 8,
    backgroundColor: theme.background,
  },
  quizOptionSelected: {
    borderColor: theme.primary,
    backgroundColor: 'rgba(0, 194, 209, 0.08)',
  },
  quizOptionText: {
    flex: 1,
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '500',
    lineHeight: 20,
  },
  quizVerifyBtn: {
    marginTop: 8,
    backgroundColor: theme.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  quizVerifyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  quizPassedBanner: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  quizPassedText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#065F46',
  },
});
