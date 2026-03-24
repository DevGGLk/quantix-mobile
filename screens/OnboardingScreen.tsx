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
import { runOnboardingCompletion } from '../lib/onboardingComplete';

const DEFAULT_MISSION =
  'En QuantixHR creemos en el talento humano, la transparencia y el crecimiento compartido. ' +
  'Nuestra cultura se basa en el respeto, la colaboración y la mejora continua.';

const DEFAULT_RULEBOOK =
  'El reglamento interno completo está disponible a través de tu gerente y RRHH. ' +
  'Al aceptar, confirmas que te comprometes a conocerlo y cumplirlo.';

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

function asDisplayText(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length ? t : fallback;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  }
  return String(value);
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
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [jobTitleId, setJobTitleId] = useState<string | null>(null);
  const [missionVision, setMissionVision] = useState('');
  const [rulebook, setRulebook] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [jobFunctions, setJobFunctions] = useState<Record<string, unknown>[]>([]);
  const [loadingFunctions, setLoadingFunctions] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const loadProfileAndCompany = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userData.user?.id) {
        Alert.alert('Sesión', 'No se pudo obtener tu sesión.');
        return;
      }
      const uid = userData.user.id;
      setUserId(uid);

      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('company_id, job_title_id')
        .eq('id', uid)
        .single();

      if (pErr || !profile) {
        console.warn('Onboarding perfil:', pErr?.message);
        return;
      }

      const cid = (profile as { company_id?: string | null }).company_id ?? null;
      const jtid = (profile as { job_title_id?: string | null }).job_title_id ?? null;
      setCompanyId(cid);
      setJobTitleId(jtid);

      if (cid) {
        const { data: company, error: cErr } = await supabase
          .from('companies')
          .select('mission_vision, rulebook')
          .eq('id', cid)
          .maybeSingle();

        if (cErr) {
          console.warn('Onboarding company:', cErr.message);
        } else {
          const mv = (company as { mission_vision?: unknown })?.mission_vision;
          const rb = (company as { rulebook?: unknown })?.rulebook;
          setMissionVision(asDisplayText(mv, DEFAULT_MISSION));
          setRulebook(asDisplayText(rb, DEFAULT_RULEBOOK));
        }
      } else {
        setMissionVision(DEFAULT_MISSION);
        setRulebook(DEFAULT_RULEBOOK);
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
      await runOnboardingCompletion(userId);
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
            <Text style={styles.cardBody}>{missionVision || DEFAULT_MISSION}</Text>
          </View>
        )}

        {step === 1 && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="document-text" size={36} color={theme.accent} />
            </View>
            <Text style={styles.cardTitle}>Reglamento interno</Text>
            <Text style={styles.cardBody}>{rulebook || DEFAULT_RULEBOOK}</Text>
            <View style={styles.switchRow}>
              <Switch
                value={termsAccepted}
                onValueChange={setTermsAccepted}
                trackColor={{ false: '#cbd5e1', true: theme.accent }}
                thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
              />
              <Text style={styles.switchLabel}>
                Confirmo que he leído y acepto el reglamento y las políticas aplicables.
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
          <TouchableOpacity style={styles.navBtn} onPress={goNext} activeOpacity={0.88}>
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
