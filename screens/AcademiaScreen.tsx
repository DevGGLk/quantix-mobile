import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

type Course = {
  id: string;
  title: string;
  description?: string | null;
  reward_points?: number | null;
};

export default function AcademiaScreen() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [completandoId, setCompletandoId] = useState<string | null>(null);
  const [currencyName, setCurrencyName] = useState<string>('Coins');
  const [currencySymbol, setCurrencySymbol] = useState<string>('🪙');

  useEffect(() => {
    let isMounted = true;

    async function loadCourses() {
      try {
        setIsLoading(true);

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        const userId = userData.user?.id ?? null;
        if (!userId) {
          if (isMounted) setCourses([]);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (profileError) {
          console.error('Error en tabla profiles (Academia):', profileError);
          throw profileError;
        }

        const profileRecord = profile as any;
        const companyId = profileRecord?.company_id ?? null;
        if (!companyId) {
          if (isMounted) setCourses([]);
          return;
        }

        // Configuración de gamificación (moneda): currency_name + symbol
        try {
          const { data: settings, error: settingsError } = await supabase
            .from('gamification_settings')
            .select('currency_name, symbol')
            .eq('company_id', companyId)
            .maybeSingle();

          if (settingsError) throw settingsError;

          const nextName = String((settings as any)?.currency_name ?? '').trim();
          const nextSymbol = String((settings as any)?.symbol ?? '').trim();

          if (isMounted) {
            setCurrencyName(nextName || 'Coins');
            setCurrencySymbol(nextSymbol || '🪙');
          }
        } catch (_settingsErr) {
          if (isMounted) {
            setCurrencyName('Coins');
            setCurrencySymbol('🪙');
          }
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }

        const { data, error } = await supabase
          .from('courses')
          .select('*')
          .eq('company_id', companyId);

        if (error) {
          console.error('Error en tabla courses:', error);
          throw error;
        }

        if (isMounted) {
          setEmployeeId(userId);
          const mapped: Course[] = (data ?? []).map((row: any) => ({
            id: String(row.id),
            title: (row.title as string) ?? 'Curso',
            description: (row.description as string | null) ?? null,
            reward_points:
              (row.reward_points as number | null) ??
              (row.points as number | null) ??
              (row.ggl_points as number | null) ??
              null,
          }));
          setCourses(mapped);
        }
      } catch (e) {
        console.error('Error general en AcademiaScreen:', e);
        Alert.alert(
          'Error de Conexión',
          'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
        );
        if (isMounted) setCourses([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadCourses();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleStartCourse = (course: Course) => {
    Alert.alert('Cargando módulo...', 'El reproductor de video se abrirá pronto');
  };

  const handleCompletarCurso = async (curso: Course) => {
    if (!employeeId) {
      Alert.alert('Error', 'No se pudo identificar tu sesión.');
      return;
    }
    if (completandoId) return;

    const points = curso.reward_points ?? 0;
    const titulo = curso.title ?? 'Curso';

    try {
      setCompletandoId(curso.id);

      const { data: progress, error: progressErr } = await supabase
        .from('employee_course_progress')
        .select('id, is_completed')
        .eq('employee_id', employeeId)
        .eq('course_id', curso.id)
        .maybeSingle();

      if (progressErr) throw progressErr;
      if (progress && (progress as { is_completed?: boolean }).is_completed) {
        setCompletandoId(null);
        Alert.alert(
          'Ya completado',
          'Ya habías completado este curso. No se pueden sumar puntos dos veces.'
        );
        return;
      }

      await supabase.from('employee_course_progress').upsert(
        {
          employee_id: employeeId,
          course_id: curso.id,
          is_completed: true,
        },
        { onConflict: 'employee_id,course_id' }
      );

      const { data: balanceRow } = await supabase
        .from('gamification_balances')
        .select('balance')
        .eq('employee_id', employeeId)
        .maybeSingle();

      const currentBalance = (balanceRow as { balance?: number } | null)?.balance ?? 0;
      const newBalance = currentBalance + points;

      await supabase.from('gamification_balances').upsert(
        { employee_id: employeeId, balance: newBalance },
        { onConflict: 'employee_id' }
      );

      await supabase.from('gamification_transactions').insert({
        employee_id: employeeId,
        description: `Curso completado: ${titulo}`,
        amount: points,
      });

      Alert.alert(
        '¡Felicidades!',
        `Has completado el curso y ganado +${points} ${currencyName} ${currencySymbol}`
      );
    } catch (e: any) {
      console.error('Error al completar curso:', e);
      Alert.alert('Error', e?.message ?? 'No se pudo registrar la finalización del curso.');
    } finally {
      setCompletandoId(null);
    }
  };

  const hasCourses = courses.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Campus Virtual</Text>

        {isLoading && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.loaderText}>Cargando cursos...</Text>
          </View>
        )}

        {!isLoading && !hasCourses && (
          <View style={styles.emptyWrapper}>
            <Text style={styles.emptyText}>
              No hay cursos asignados en este momento. ¡Estás al día!
            </Text>
          </View>
        )}

        {hasCourses &&
          courses.map((course) => {
            const points = course.reward_points ?? 0;
            return (
              <View key={course.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.playIconWrap}>
                    <Ionicons name="play-circle" size={36} color={theme.accent} />
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>+{points} pts</Text>
                  </View>
                </View>

                <Text style={styles.cardTitle} numberOfLines={2}>
                  {course.title}
                </Text>
                {!!course.description && (
                  <Text style={styles.cardDescription} numberOfLines={3} ellipsizeMode="tail">
                    {course.description}
                  </Text>
                )}

                <TouchableOpacity
                  style={styles.startButton}
                  activeOpacity={0.9}
                  onPress={() => handleStartCourse(course)}
                >
                  <Text style={styles.startButtonText}>▶ Iniciar Curso</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.completeButton,
                    completandoId === course.id && styles.completeButtonDisabled,
                  ]}
                  activeOpacity={0.9}
                  onPress={() => handleCompletarCurso(course)}
                  disabled={completandoId === course.id}
                >
                  <Text style={styles.completeButtonText}>
                    {completandoId === course.id
                      ? 'Procesando...'
                      : '✓ Marcar como Completado'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 16,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  emptyWrapper: {
    marginTop: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  playIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.background,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.warning,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    color: theme.textSecondary,
    marginBottom: 10,
  },
  startButton: {
    marginTop: 4,
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
  completeButton: {
    marginTop: 8,
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeButtonDisabled: {
    opacity: 0.7,
  },
  completeButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
});

