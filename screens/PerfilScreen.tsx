import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { TabCompositeNavigation } from '../types/navigation';

import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// Paleta VIP Zone alineada al portal web QuantixHR
const VIP = {
  // Fondo general muy claro (área de contenido)
  bgScreen: '#F3F4F6',
  // Tarjetas y superficies principales (blanco limpio)
  cardLavender: '#FFFFFF',
  // Color protagonista de la tarjeta de saldo (índigo de marca)
  purpleDeep: '#3C3489',
  // Texto principal sobre fondos claros
  textOnLight: '#1E293B',
  // Texto secundario/gris suave
  textMuted: '#64748B',
  // Botones de acción destacados (naranja corporativo)
  buttonGold: '#FF9F43',
  // Botón de cerrar sesión (rojo corporativo)
  buttonLogout: '#FF3F48',
} as const;

type PerfilState = {
  nombre: string;
  cargo: string;
};

function pickTrimmedNamePart(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (t.length > 0) return t;
  }
  return null;
}

export default function PerfilScreen() {
  const { session, authProfile, employeeRecord, refreshProfile } = useAuth();
  const navigation = useNavigation<TabCompositeNavigation<'Perfil'>>();
  const [perfil, setPerfil] = useState<PerfilState>({
    nombre: '',
    cargo: '',
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hireDate, setHireDate] = useState<string | null>(null);
  /** true si `hire_date` viene de la columna contractual en `employees`; false si solo hay `created_at`. */
  const [hireDateFromContract, setHireDateFromContract] = useState(false);
  const [vacationDays, setVacationDays] = useState<number | null>(null);
  const [funciones, setFunciones] = useState<Record<string, unknown>[]>([]);
  const [refreshing, setRefreshing] = useState(false);


  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      try {
        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) {
            setPerfil({ nombre: '', cargo: '' });
          }
          return;
        }

        if (!isMounted) return;
        const nombreFirst = pickTrimmedNamePart(
          authProfile?.first_name,
          employeeRecord?.first_name
        );
        const nombreLast = pickTrimmedNamePart(authProfile?.last_name, employeeRecord?.last_name);
        const nombre =
          [nombreFirst, nombreLast].filter(Boolean).join(' ').trim() || 'Empleado';
        const cargo = String(authProfile?.role ?? 'Colaborador') || 'Colaborador';
        const companyIdRaw = employeeRecord?.company_id ?? null;

        const jobTitleId = (employeeRecord?.job_title_id as string | null) ?? null;
        const empRecordId = employeeRecord?.id ?? null;

        let hireDateIso: string | null = null;
        let hireIsContract = false;
        let vacationAvailable: number | null = null;

        // Fecha de ingreso: `employeeRecord` ya trae `hire_date` / `created_at` desde AuthContext.
        if (
          employeeRecord?.hire_date != null &&
          String(employeeRecord.hire_date).trim() !== ''
        ) {
          hireDateIso = String(employeeRecord.hire_date).slice(0, 10);
          hireIsContract = true;
        } else if (employeeRecord?.created_at) {
          hireDateIso = employeeRecord.created_at.slice(0, 10);
          hireIsContract = false;
        }

        if (empRecordId) {
          // `select('*')` para columnas no mapeadas en contexto (fecha de ingreso).
          const { data: laborRow, error: laborErr } = await supabase
            .from('employees')
            .select('*')
            .eq('id', empRecordId)
            .maybeSingle();

          if (!laborErr && laborRow) {
            const lr = laborRow as Record<string, unknown>;
            if (lr.hire_date != null && String(lr.hire_date).trim() !== '') {
              hireDateIso = String(lr.hire_date).slice(0, 10);
              hireIsContract = true;
            }
          } else if (laborErr) {
            console.warn('Perfil employees (expediente):', laborErr.message);
          }

          // Vacaciones: SIEMPRE del ledger (leave_balances vía RPC), nunca de
          // employees.vacation_days_balance (columna legacy deprecada — mostraba
          // saldos viejos desincronizados del acumulado legal).
          const { data: vacData, error: vacErr } = await supabase.rpc(
            'get_employee_vacation_balance',
            { p_employee_id: empRecordId }
          );
          if (!vacErr && vacData) {
            const vb = (vacData as { vacation_balance?: number | string | null }).vacation_balance;
            const n = Number(vb);
            if (Number.isFinite(n)) vacationAvailable = n;
          } else if (vacErr) {
            console.warn('Perfil vacaciones (ledger):', vacErr.message);
          }
        }

        if (isMounted) {
          setHireDate(hireDateIso);
          setHireDateFromContract(hireIsContract);
          setVacationDays(vacationAvailable);
        }
        setPerfil({ nombre, cargo });
        // Enterprise: avatar ya no vive en employees; si sigue existiendo en profiles,
        // podemos migrarlo más adelante. Por ahora mantenemos null para evitar acoplamiento.
        setAvatarUrl(null);

        try {
          if (jobTitleId) {
            let funcionesData: Record<string, unknown>[] | null = null;
            let funcionesError: { message?: string } | null = null;

            // Hardening: si la tabla soporta scope por empresa, lo aplicamos.
            if (companyIdRaw) {
              const scopedRes = await supabase
                .from('job_functions')
                .select('*')
                .eq('job_title_id', jobTitleId)
                .eq('company_id', companyIdRaw);

              if (!scopedRes.error) {
                funcionesData = (scopedRes.data ?? []) as Record<string, unknown>[];
              } else {
                // Fallback compatible si la columna company_id no existe en esta tabla.
                const fallbackRes = await supabase
                  .from('job_functions')
                  .select('*')
                  .eq('job_title_id', jobTitleId);
                funcionesData = (fallbackRes.data ?? []) as Record<string, unknown>[];
                funcionesError = fallbackRes.error;
              }
            } else {
              const fallbackRes = await supabase
                .from('job_functions')
                .select('*')
                .eq('job_title_id', jobTitleId);
              funcionesData = (fallbackRes.data ?? []) as Record<string, unknown>[];
              funcionesError = fallbackRes.error;
            }

            if (funcionesError) {
              console.error('Error en tabla job_functions:', funcionesError);
              if (isMounted) {
                Alert.alert(
                  'Error de Conexión',
                  'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
                );
              }
            } else if (isMounted) {
              setFunciones(funcionesData ?? []);
            }
          } else if (isMounted) {
            setFunciones([]);
          }
        } catch (fnException) {
          console.error('Excepción al leer job_functions:', fnException);
          if (isMounted) setFunciones([]);
          if (isMounted) {
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }
        }
      } catch (_e) {
        if (isMounted) {
          setPerfil({ nombre: '', cargo: '' });
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [
    session?.user?.id,
    employeeRecord?.id,
    employeeRecord?.company_id,
    employeeRecord?.job_title_id,
    employeeRecord?.hire_date,
    employeeRecord?.created_at,
    authProfile?.role,
    authProfile?.first_name,
    authProfile?.last_name,
    employeeRecord?.first_name,
    employeeRecord?.last_name,
  ]);

  const onRefreshPerfil = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshProfile();
    } finally {
      setRefreshing(false);
    }
  }, [refreshProfile]);

  const handleLogout = async () => {
    try {
      const { error: signOutErr } = await supabase.auth.signOut();
      if (signOutErr) throw signOutErr;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo cerrar sesión. Intenta de nuevo.';
      Alert.alert('Error', message);
    }
  };

  const formattedHireDate =
    hireDate && !Number.isNaN(Date.parse(hireDate))
      ? new Date(hireDate).toLocaleDateString('es-ES', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : null;

  return (
    <>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefreshPerfil} tintColor={VIP.purpleDeep} />
        }
      >
        <Text style={styles.vipTitle}>Mi Perfil</Text>
        {/* Sección 1: Cabecera de Perfil */}
        <View style={styles.headerCard}>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={VIP.purpleDeep} />
            <Text style={styles.loadingText}>Cargando...</Text>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={28} color={VIP.textMuted} />
                </View>
              )}
            </View>

            <View style={styles.headerMeta}>
              <Text style={styles.name}>{perfil.nombre || 'Empleado'}</Text>
              <Text style={styles.role}>{perfil.cargo || 'Colaborador'}</Text>
            </View>
          </View>
        )}
        </View>

        {/* Sección 4: Mi Expediente Laboral */}
        <View style={styles.laborSectionHeader}>
          <Text style={styles.laborTitle}>Mi Expediente Laboral</Text>
        </View>

        <View style={styles.laborCard}>
          <Text style={styles.laborLabel}>
            Fecha de ingreso:{' '}
            <Text style={styles.laborValue}>
              {formattedHireDate ?? 'No registrado'}
            </Text>
            {!hireDateFromContract && formattedHireDate ? (
              <Text style={styles.laborHint}> (alta en el sistema)</Text>
            ) : null}
          </Text>
          <Text style={styles.laborLabel}>
            Días de vacaciones disponibles:{' '}
            <Text style={styles.laborValue}>
              {typeof vacationDays === 'number' ? vacationDays : '—'}
            </Text>
          </Text>
        </View>

        {funciones.length > 0 && (
          <View style={styles.functionsCard}>
            <Text style={styles.functionsTitle}>Mis Responsabilidades</Text>
            {funciones.map((fn, index) => {
              const key = String(fn.id ?? index);
              const raw =
                fn.name ?? fn.title ?? fn.description ?? 'Responsabilidad de puesto';
              const text = typeof raw === 'string' ? raw : String(raw);
              return (
                <View key={key} style={styles.functionRow}>
                  <Text style={styles.functionBullet}>•</Text>
                  <Text style={styles.functionText}>{text}</Text>
                </View>
              );
            })}
          </View>
        )}

        {__DEV__ ? (
          <TouchableOpacity
            style={styles.sentryTestButton}
            onPress={() => {
              throw new Error('¡Prueba de Crash QuantixHR!');
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="bug-outline" size={18} color={VIP.textOnLight} />
            <Text style={styles.sentryTestText}>Test Sentry (solo desarrollo)</Text>
          </TouchableOpacity>
        ) : null}

        {/* Sección 4: Cerrar Sesión */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color="#ffffff" />
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VIP.bgScreen,
  },
  content: {
    padding: 20,
    paddingBottom: 28,
    gap: 16,
  },
  vipTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: VIP.textOnLight,
    letterSpacing: 3,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  headerCard: {
    backgroundColor: VIP.cardLavender,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 4 },
    }),
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
  },
  loadingText: {
    color: VIP.textMuted,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
  },
  avatar: {
    width: 56,
    height: 56,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMeta: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  role: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: VIP.textMuted,
  },
  sentryTestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: VIP.bgScreen,
    borderWidth: 1,
    borderColor: VIP.buttonGold,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sentryTestText: {
    fontSize: 14,
    fontWeight: '700',
    color: VIP.textOnLight,
  },
  logoutButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: VIP.buttonLogout,
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: VIP.buttonLogout,
  },
  logoutText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  laborSectionHeader: {
    marginTop: 24,
  },
  laborTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  laborCard: {
    marginTop: 10,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  laborLabel: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 6,
  },
  laborValue: {
    fontWeight: '700',
    color: '#111827',
  },
  laborHint: {
    fontSize: 12,
    fontWeight: '500',
    color: VIP.textMuted,
  },
  functionsCard: {
    marginTop: 16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  functionsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  functionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  functionBullet: {
    marginRight: 6,
    fontSize: 12,
    color: '#4b5563',
    marginTop: 1,
  },
  functionText: {
    flex: 1,
    fontSize: 13,
    color: '#4b5563',
  },
});

