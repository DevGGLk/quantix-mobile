import React, { useCallback, useEffect, useState } from 'react';
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

const STEPS = 4;

function dotLabel(step: number) {
  switch (step) {
    case 0:
      return 'Cultura';
    case 1:
      return 'Reglamento';
    case 2:
      return 'Mis funciones';
    case 3:
      return 'Recompensa';
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
  const { session, employee } = useAuth();
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

  const loadProfileAndCompany = useCallback(async () => {
    setLoading(true);
    try {
      const uid = session?.user?.id ?? null;
      if (!uid) {
        Alert.alert('Sesión', 'No se pudo obtener tu sesión.');
        return;
      }
      setUserId(uid);

      // Enterprise: se toma desde employees (no desde profiles).
      const cid = employee?.company_id ?? null;
      const jtid = employee?.job_title_id ?? null;
      setCompanyId(cid);
      setJobTitleId(jtid);

      if (cid) {
        const [companyRes, policiesRes] = await Promise.all([
          supabase
            .from('companies')
            .select('mission, vision, corporate_values')
            .eq('id', cid)
            .maybeSingle(),
          supabase
            .from('company_policies')
            .select('title, content, order_index')
            .eq('company_id', cid)
            .order('order_index', { ascending: true }),
        ]);

        if (companyRes.error) {
          console.warn('Onboarding company:', companyRes.error.message);
          setPoliciesLoadError(null);
          setMissionVision(ONBOARDING_FALLBACK_MISSION_CULTURE);
          setRulebook(ONBOARDING_FALLBACK_RULEBOOK);
        } else {
          const cRow = (companyRes.data ?? null) as Record<string, unknown> | null;
          const culture = buildMissionCultureBlock(cRow);
          setMissionVision(culture.trim() ? culture : ONBOARDING_FALLBACK_MISSION_CULTURE);

          if (policiesRes.error) {
            console.warn('Onboarding company_policies:', policiesRes.error.message);
            setPoliciesLoadError(ONBOARDING_POLICIES_FETCH_FAILED_TITLE);
            setRulebook('');
            setTermsAccepted(false);
          } else {
            setPoliciesLoadError(null);
            const ruleText = buildPoliciesPlaintext(
              policiesRes.data as { title?: unknown; content?: unknown }[] | null
            );
            setRulebook(ruleText.trim() ? ruleText : ONBOARDING_FALLBACK_RULEBOOK);
          }
        }
      } else {
        setPoliciesLoadError(null);
        setMissionVision(ONBOARDING_FALLBACK_MISSION_CULTURE);
        setRulebook(ONBOARDING_FALLBACK_RULEBOOK);
      }
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, employee?.company_id, employee?.job_title_id]);

  useEffect(() => {
    loadProfileAndCompany();
  }, [loadProfileAndCompany]);

  useEffect(() => {
    if (step !== 2 || !jobTitleId) return;

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
          console.warn('job_functions onboarding:', err.message);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar las funciones del puesto. Revisa tu conexión o intenta de nuevo más tarde.'
          );
        }
        if (!cancelled) setJobFunctions(rows ?? []);
      } catch (e) {
        console.warn('job_functions onboarding ex:', e);
        if (!cancelled) setJobFunctions([]);
      } finally {
        if (!cancelled) setLoadingFunctions(false);
      }
    }
    loadFns();
    return () => {
      cancelled = true;
    };
  }, [step, jobTitleId, companyId]);

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
    if (step < STEPS - 1) setStep((s) => s + 1);
  };

  const goBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleFinish = async () => {
    if (finishing || !userId) return;
    setFinishing(true);
    try {
      await runOnboardingCompletion(userId, companyId, employee?.id ?? null);
      releaseToMainApp();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e);
      Alert.alert('Error', msg || 'No se pudo completar la inducción. Intenta de nuevo.');
    } finally {
      setFinishing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.accent} />
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
              <Ionicons name="people" size={36} color={theme.accent} />
            </View>
            <Text style={styles.cardTitle}>Misión y cultura</Text>
            <Text style={styles.cardBody}>{missionVision}</Text>
          </View>
        )}

        {step === 1 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="document-text" size={36} color={theme.accent} />
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
                trackColor={{ false: '#cbd5e1', true: theme.accent }}
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
          </View>
        )}

        {step === 2 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="briefcase" size={36} color={theme.accent} />
            </View>
            <Text style={styles.cardTitle}>Mis funciones</Text>
            {!jobTitleId ? (
              <Text style={styles.cardBodyMuted}>
                Aún no tienes un puesto asignado. Tu gerente puede actualizarlo en RRHH.
              </Text>
            ) : loadingFunctions ? (
              <ActivityIndicator style={{ marginTop: 16 }} color={theme.accent} />
            ) : jobFunctions.length === 0 ? (
              <Text style={styles.cardBodyMuted}>
                No hay funciones registradas para tu puesto. Puedes continuar con el siguiente paso.
              </Text>
            ) : (
              <View style={styles.fnList}>
                {jobFunctions.map((row, idx) => (
                  <View key={idx} style={styles.fnItem}>
                    <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
                    <Text style={styles.fnText}>{formatJobFunctionRow(row)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {step === 3 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="gift" size={40} color={theme.warning} />
            </View>
            <Text style={styles.cardTitle}>¡Último paso!</Text>
            <Text style={styles.cardBody}>
              Al finalizar recibirás una recompensa de gamificación por completar tu inducción.
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
                <Text style={styles.finishBtnText}>Finalizar Inducción y Ganar 1000 Pts</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {step < 3 && (
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
              step === 1 && policiesLoadError ? styles.navBtnDisabled : null,
            ]}
            onPress={goNext}
            activeOpacity={0.88}
            disabled={step === 1 && Boolean(policiesLoadError)}
          >
            <Text style={styles.navBtnText}>Siguiente</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 3 && (
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
    backgroundColor: theme.accent,
  },
  stepHint: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
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
    backgroundColor: theme.accent,
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
});
