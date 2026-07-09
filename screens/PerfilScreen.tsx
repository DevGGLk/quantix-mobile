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
  Modal,
  Pressable,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { TabCompositeNavigation } from '../types/navigation';

import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { fetchJobTitleFunctionsBlock } from '../lib/api';
import { getEmployeePhotoPublicUrl } from '../lib/employeePhoto';

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

/**
 * Una función del puesto. MISMA fuente que la web (`components/mi-portal/MisResponsabilidadesWidget.tsx`):
 * tabla `job_functions`, ordenada por `sort_order`.
 */
type JobFunctionRow = {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
};

/** Normaliza una fila cruda de `job_functions` al shape tipado que consume la UI. */
function normalizeJobFunction(raw: Record<string, unknown>, index: number): JobFunctionRow {
  const titleRaw = raw.title ?? raw.name ?? '';
  const descRaw = raw.description;
  const sortRaw = Number(raw.sort_order);
  return {
    id: String(raw.id ?? index),
    title: typeof titleRaw === 'string' ? titleRaw.trim() : String(titleRaw ?? '').trim(),
    description:
      descRaw != null && String(descRaw).trim() !== '' ? String(descRaw).trim() : null,
    sort_order: Number.isFinite(sortRaw) ? sortRaw : index,
  };
}

/** Palabras del excerpt del resumen bajo el título (paridad con la web). */
const EXCERPT_MAX_WORDS = 15;

/** Primeras `maxWords` palabras + "…" si hay más. */
function truncateWords(text: string, maxWords: number): string {
  const w = text.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return '';
  if (w.length <= maxWords) return w.join(' ');
  return `${w.slice(0, maxWords).join(' ')}…`;
}

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
  const [funciones, setFunciones] = useState<JobFunctionRow[]>([]);
  /** `job_titles.functions_description` — resumen del puesto (misma fuente que la web). */
  const [functionsDescription, setFunctionsDescription] = useState('');
  const [detailModalOpen, setDetailModalOpen] = useState(false);
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
        // Cargo: fuente de verdad es `job_titles.name` (p. ej. "CEO"), igual que la web `/perfil`.
        // `authProfile.role` (admin/hr/ceo) es solo el rol de permisos y NO el puesto; se usa como
        // fallback si el expediente no tiene cargo asignado. El nombre real se resuelve más abajo.
        const cargo = String(authProfile?.role ?? 'Colaborador') || 'Colaborador';
        const companyIdRaw = employeeRecord?.company_id ?? null;

        const jobTitleId = (employeeRecord?.job_title_id as string | null) ?? null;
        const empRecordId = employeeRecord?.id ?? null;

        let hireDateIso: string | null = null;
        let hireIsContract = false;
        let vacationAvailable: number | null = null;
        // Avatar: foto de perfil desde `employees.avatar_path` (bucket público `employee_photos`),
        // misma fuente que la web. Se resuelve del expediente completo más abajo.
        let avatarUrlResolved: string | null = null;

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
            avatarUrlResolved = getEmployeePhotoPublicUrl(
              lr.avatar_path as string | null | undefined,
              lr.avatar_updated_at as string | null | undefined
            );
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
        // Foto de perfil desde `employees.avatar_path` (bucket público + CDN). null → iniciales/placeholder.
        setAvatarUrl(avatarUrlResolved);

        try {
          if (jobTitleId) {
            const branchId = (employeeRecord?.branch_id as string | null) ?? null;
            const bid = branchId != null && String(branchId).trim() !== '' ? String(branchId).trim() : null;

            // Lista numerada de funciones: MISMA fuente y filtros que la web
            // (job_functions por job_title_id + company_id + branch_id, orden por sort_order).
            let funcionesData: Record<string, unknown>[] | null = null;
            let funcionesError: { message?: string } | null = null;

            let scopedQuery = supabase
              .from('job_functions')
              .select('id, title, description, sort_order')
              .eq('job_title_id', jobTitleId);
            if (companyIdRaw) scopedQuery = scopedQuery.eq('company_id', companyIdRaw);
            if (bid) scopedQuery = scopedQuery.eq('branch_id', bid);

            const scopedRes = await scopedQuery.order('sort_order', { ascending: true });

            if (!scopedRes.error) {
              funcionesData = (scopedRes.data ?? []) as Record<string, unknown>[];
            } else {
              // Fallback compatible si alguna columna de scope no existiera en esta BD.
              const fallbackRes = await supabase
                .from('job_functions')
                .select('id, title, description, sort_order')
                .eq('job_title_id', jobTitleId)
                .order('sort_order', { ascending: true });
              funcionesData = (fallbackRes.data ?? []) as Record<string, unknown>[];
              funcionesError = fallbackRes.error;
            }

            // Resumen del puesto + nombre del cargo: job_titles (misma fuente que la web).
            const { functionsDescription: resumen, titleLabel } =
              await fetchJobTitleFunctionsBlock(jobTitleId);

            // Cargo real desde job_titles.name (p. ej. "CEO"). 'Tu cargo' es el placeholder que
            // devuelve el helper cuando el registro no tiene nombre → conservamos el fallback (rol).
            const resolvedCargo =
              typeof titleLabel === 'string' && titleLabel.trim() && titleLabel.trim() !== 'Tu cargo'
                ? titleLabel.trim()
                : null;
            if (isMounted && resolvedCargo) {
              setPerfil((prev) => ({ ...prev, cargo: resolvedCargo }));
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
              setFunciones((funcionesData ?? []).map((row, i) => normalizeJobFunction(row, i)));
              setFunctionsDescription(resumen ?? '');
            }
          } else if (isMounted) {
            setFunciones([]);
            setFunctionsDescription('');
          }
        } catch (fnException) {
          console.error('Excepción al leer job_functions:', fnException);
          if (isMounted) {
            setFunciones([]);
            setFunctionsDescription('');
          }
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
    employeeRecord?.branch_id,
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
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('Vacaciones')}>
            <Text style={styles.laborLabel}>
              Días de vacaciones disponibles:{' '}
              <Text style={styles.laborValue}>
                {typeof vacationDays === 'number' ? vacationDays : '—'}
              </Text>
            </Text>
            <Text style={{ color: '#3C3489', fontSize: 13, fontWeight: '600', marginTop: 4 }}>
              Ver detalle de vacaciones →
            </Text>
          </TouchableOpacity>
        </View>

        {(funciones.length > 0 || functionsDescription.trim().length > 0) && (
          <View style={styles.functionsCard}>
            <Text style={styles.functionsTitle}>Mis Funciones</Text>
            <Text style={styles.functionsSubtitle}>Manual de Funciones</Text>
            {functionsDescription.trim().length > 0 && (
              <Text style={styles.functionsExcerpt}>
                {truncateWords(functionsDescription, EXCERPT_MAX_WORDS)}
              </Text>
            )}
            {funciones.map((fn, index) => {
              const text = fn.title || fn.description || 'Responsabilidad de puesto';
              return (
                <View key={fn.id ?? index} style={styles.functionRow}>
                  <Text style={styles.functionBullet}>•</Text>
                  <Text style={styles.functionText}>{text}</Text>
                </View>
              );
            })}
            <TouchableOpacity
              style={styles.functionsDetailButton}
              onPress={() => setDetailModalOpen(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Ver funciones del puesto en detalle"
            >
              <Ionicons name="reader-outline" size={16} color={VIP.purpleDeep} />
              <Text style={styles.functionsDetailButtonText}>Ver funciones</Text>
            </TouchableOpacity>
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

      {/* Detalle completo de funciones — mismo contenido que el modal de la web:
          resumen del puesto + lista numerada con título y descripción de cada función. */}
      <Modal
        visible={detailModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDetailModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTexts}>
                <Text style={styles.modalTitle}>Mis Funciones</Text>
                <Text style={styles.modalSubtitle}>Manual de Funciones — detalle</Text>
              </View>
              <TouchableOpacity
                onPress={() => setDetailModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Cerrar detalle de funciones"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={VIP.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {functionsDescription.trim().length > 0 && (
                <View style={styles.resumenBox}>
                  <Text style={styles.resumenLabel}>RESUMEN DEL PUESTO</Text>
                  <Text style={styles.resumenText}>{functionsDescription.trim()}</Text>
                </View>
              )}

              {funciones.length > 0 ? (
                <>
                  <Text style={styles.listLabel}>LISTA DE FUNCIONES (ORDEN)</Text>
                  {funciones.map((fn, idx) => (
                    <View key={fn.id ?? idx} style={styles.functionItem}>
                      <Text style={styles.functionItemNum}>{idx + 1}. Función</Text>
                      <Text style={styles.functionItemTitle}>{fn.title || 'Función'}</Text>
                      {fn.description ? (
                        <Text style={styles.functionItemDesc}>{fn.description}</Text>
                      ) : (
                        <Text style={styles.functionItemNoDesc}>Sin descripción detallada.</Text>
                      )}
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.functionItemNoDesc}>
                  Aún no hay una lista detallada de funciones por ítem; el resumen de tu puesto aparece arriba.
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setDetailModalOpen(false)}
              activeOpacity={0.9}
            >
              <Text style={styles.modalCloseButtonText}>Cerrar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
    marginBottom: 2,
  },
  functionsSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: VIP.textMuted,
    marginBottom: 8,
  },
  functionsExcerpt: {
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
    marginBottom: 10,
  },
  functionsDetailButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: VIP.purpleDeep,
    borderRadius: 12,
    paddingVertical: 11,
    backgroundColor: '#EEF2FF',
  },
  functionsDetailButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: VIP.purpleDeep,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 12,
    marginBottom: 12,
  },
  modalHeaderTexts: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: VIP.textMuted,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalScrollContent: {
    paddingBottom: 8,
  },
  resumenBox: {
    borderWidth: 2,
    borderColor: 'rgba(60, 52, 137, 0.35)',
    backgroundColor: 'rgba(60, 52, 137, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 18,
  },
  resumenLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: VIP.purpleDeep,
  },
  resumenText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    color: '#1E293B',
  },
  listLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: VIP.textMuted,
    marginBottom: 10,
  },
  functionItem: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  functionItemNum: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: VIP.textMuted,
  },
  functionItemTitle: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  functionItemDesc: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  functionItemNoDesc: {
    marginTop: 6,
    fontSize: 12,
    fontStyle: 'italic',
    color: VIP.textMuted,
  },
  modalCloseButton: {
    marginTop: 12,
    backgroundColor: VIP.purpleDeep,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

