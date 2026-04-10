import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PostgrestError, Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

/** Evita sesiones colgadas si la red o PostgREST no responden. */
const PROFILE_FETCH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, label: string): Promise<T> {
  const promise = Promise.resolve(promiseLike);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[AuthContext] Timeout ${label} (${ms}ms)`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const PROFILE_COLUMNS =
  'id, email, first_name, last_name, role, holding_id, company_id, is_gps_tracking_enabled, gps_refresh_rate_seconds';

const EMPLOYEE_COLUMNS =
  'id, user_id, company_id, branch_id, department_id, job_title_id, first_name, last_name, hire_date, salary, national_id, employee_code, employment_status, created_at';

/** Códigos PostgREST/Postgres frecuentes al depurar RLS y `.single()`. */
function describeSupabaseErrorCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === 'PGRST116') {
    return 'Sin filas para .single() / recurso anidado vacío (no siempre es RLS con maybeSingle).';
  }
  if (code === '42501') {
    return 'Permiso denegado en Postgres (suele ser RLS o privilegios de rol).';
  }
  if (code.startsWith('PGRST')) {
    return 'Error PostgREST; revisar embed, RLS o contrato de API.';
  }
  return undefined;
}

function logProfileFetchFailure(
  stage: string,
  uid: string,
  err: PostgrestError | Error | null,
  extra?: Record<string, unknown>
) {
  if (!err) return;
  if ('code' in err && 'message' in err && typeof (err as PostgrestError).code === 'string') {
    const pe = err as PostgrestError;
    const codeHint = describeSupabaseErrorCode(pe.code);
    console.error('[AuthContext] Fallo fetch perfiles / expediente (Supabase)', {
      stage,
      uid,
      message: pe.message,
      code: pe.code,
      codeInterpretation: codeHint,
      details: pe.details,
      hint: pe.hint,
      ...extra,
    });
    return;
  }
  console.error('[AuthContext] Fallo fetch perfiles / expediente (red u otro)', {
    stage,
    uid,
    message: err instanceof Error ? err.message : String(err),
    ...extra,
  });
}

function normalizeEmbeddedEmployees(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  return [raw as Record<string, unknown>];
}

function mapProfileRow(row: Record<string, unknown>, uid: string): ProfileRecord {
  return {
    id: String(row.id ?? uid),
    email: (row.email as string | null) ?? null,
    first_name:
      row.first_name != null && String(row.first_name).trim() !== ''
        ? String(row.first_name).trim()
        : null,
    last_name:
      row.last_name != null && String(row.last_name).trim() !== ''
        ? String(row.last_name).trim()
        : null,
    role: (row.role as string | null) ?? null,
    holding_id: (row.holding_id as string | null) ?? null,
    company_id: (row.company_id as string | null) ?? null,
    is_gps_tracking_enabled:
      typeof row.is_gps_tracking_enabled === 'boolean' ? row.is_gps_tracking_enabled : null,
    gps_refresh_rate_seconds: (() => {
      const g = row.gps_refresh_rate_seconds;
      if (typeof g === 'number' && Number.isFinite(g)) return g;
      if (g != null) {
        const n = Number(g);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    })(),
  };
}

function pickEmployeeRow(
  rows: Record<string, unknown>[],
  uid: string,
  profileCompanyId: string | null | undefined
): Record<string, unknown> | null {
  const scoped =
    profileCompanyId && String(profileCompanyId).length > 0
      ? rows.filter((r) => String(r.company_id ?? '') === profileCompanyId)
      : rows;
  const pool = scoped.length > 0 ? scoped : rows;
  const active =
    pool.find((r) => String(r.employment_status ?? 'active').toLowerCase() === 'active') ??
    pool[0] ??
    null;
  return active;
}

function mapEmployeeRow(pick: Record<string, unknown>, uid: string): EmployeeRecord {
  return {
    id: String(pick.id ?? ''),
    user_id: String(pick.user_id ?? uid),
    company_id: (pick.company_id as string | null) ?? null,
    branch_id: (pick.branch_id as string | null) ?? null,
    department_id: (pick.department_id as string | null) ?? null,
    job_title_id: (pick.job_title_id as string | null) ?? null,
    first_name: (pick.first_name as string | null) ?? null,
    last_name: (pick.last_name as string | null) ?? null,
    salary:
      typeof pick.salary === 'number'
        ? pick.salary
        : pick.salary != null
          ? Number(pick.salary)
          : null,
    national_id:
      pick.national_id != null && String(pick.national_id).trim() !== ''
        ? String(pick.national_id).trim()
        : null,
    employee_code:
      pick.employee_code != null && String(pick.employee_code).trim() !== ''
        ? String(pick.employee_code).trim()
        : null,
    hire_date:
      pick.hire_date != null && String(pick.hire_date).trim() !== ''
        ? String(pick.hire_date as string)
        : null,
    created_at: pick.created_at != null ? String(pick.created_at as string) : null,
  };
}

export type ProfileRecord = {
  id: string;
  email: string | null;
  /** Nombre en `profiles` (fuente principal en Mi Portal / auth). */
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  holding_id: string | null;
  /** Empresa del perfil (auth); se usa para elegir expediente si hay varios `employees`. */
  company_id: string | null;
  onboarding_completed?: boolean | null;
  /** Consentimiento operativo de RRHH para telemetría en vivo (`live_locations`). Paridad con Mi Portal web. */
  is_gps_tracking_enabled?: boolean | null;
  /** Intervalo sugerido entre pings GPS (segundos). */
  gps_refresh_rate_seconds?: number | null;
};

/** Expediente RRHH: `id` = `employees.id` (operativo). `user_id` enlaza a `profiles` / auth. */
export type EmployeeRecord = {
  id: string;
  user_id: string;
  company_id: string | null;
  branch_id: string | null;
  department_id: string | null;
  job_title_id: string | null;
  first_name: string | null;
  last_name: string | null;
  salary: number | null;
  /** Documento de identidad en RRHH (`employees.national_id`). */
  national_id: string | null;
  /** Código interno de empleado si existe en BD. */
  employee_code: string | null;
  /** Fecha contractual de ingreso (`employees.hire_date`), si existe en BD. */
  hire_date: string | null;
  /** Alta del expediente en sistema (ISO); útil si aún no existe `hire_date` en BD. */
  created_at: string | null;
};

/** Valores devueltos por `refresh` / `refreshProfile` tras sincronizar con Supabase (útil p. ej. pull-to-refresh). */
export type AuthRecordsSnapshot = {
  profile: ProfileRecord | null;
  employee: EmployeeRecord | null;
};

export type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  /** Perfil de aplicación (`profiles`). Alias explícito: `authProfile`. */
  profile: ProfileRecord | null;
  /** Expediente RRHH (`employees`). Alias explícito: `employeeRecord`. */
  employee: EmployeeRecord | null;
  authProfile: ProfileRecord | null;
  employeeRecord: EmployeeRecord | null;
  /**
   * Mensaje si falla la carga de `profiles` y/o `employees` (red, RLS, etc.).
   * `null` cuando la sesión no aplica o la última recarga fue correcta.
   */
  recordsError: string | null;
  refresh: () => Promise<AuthRecordsSnapshot | null>;
  /** Igual que `refresh`: vuelve a cargar `profiles` y `employees`. */
  refreshProfile: () => Promise<AuthRecordsSnapshot | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider />');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authDebugSigRef = useRef<string>('');

  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    supabase.auth
      .getSession()
      .then(({ data: { session: current } }) => {
        if (!isMounted) return;
        setSession(current ?? null);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsSessionLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  /** Paridad con Mi Portal: si RRHH cambia el flag o el intervalo, la app reacciona sin reiniciar sesión. */
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    const channel = supabase
      .channel(`mobile-profile-gps-${uid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        (payload) => {
          const nr = payload.new as Record<string, unknown>;
          setProfile((prev) => {
            if (!prev || prev.id !== uid) return prev;
            const next = { ...prev };
            if (typeof nr.first_name === 'string') {
              const t = nr.first_name.trim();
              next.first_name = t.length > 0 ? t : null;
            }
            if (typeof nr.last_name === 'string') {
              const t = nr.last_name.trim();
              next.last_name = t.length > 0 ? t : null;
            }
            if (typeof nr.is_gps_tracking_enabled === 'boolean') {
              next.is_gps_tracking_enabled = nr.is_gps_tracking_enabled;
            }
            if (
              typeof nr.gps_refresh_rate_seconds === 'number' &&
              Number.isFinite(nr.gps_refresh_rate_seconds) &&
              nr.gps_refresh_rate_seconds >= 1
            ) {
              next.gps_refresh_rate_seconds = nr.gps_refresh_rate_seconds;
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const refresh = useCallback(async (): Promise<AuthRecordsSnapshot | null> => {
    const uid = session?.user?.id ?? null;
    if (!uid) {
      setProfile(null);
      setEmployee(null);
      setRecordsError(null);
      return { profile: null, employee: null };
    }

    setIsRecordsLoading(true);
    let pErr: PostgrestError | null = null;
    let eErr: PostgrestError | null = null;
    let nextProfile: ProfileRecord | null = null;
    let nextEmployee: EmployeeRecord | null = null;

    try {
      const bundleSelect = `${PROFILE_COLUMNS}, employees(${EMPLOYEE_COLUMNS})`;

      let profileRow: Record<string, unknown> | null = null;
      let embeddedEmps: Record<string, unknown>[] = [];

      try {
        const bundleRes = await withTimeout(
          supabase.from('profiles').select(bundleSelect).eq('id', uid).maybeSingle(),
          PROFILE_FETCH_TIMEOUT_MS,
          'profiles+employees'
        );
        if (bundleRes.error) {
          logProfileFetchFailure('profiles_embed_employees', uid, bundleRes.error);
          pErr = bundleRes.error;
        } else {
          const raw = (bundleRes.data ?? null) as Record<string, unknown> | null;
          if (raw) {
            profileRow = raw;
            embeddedEmps = normalizeEmbeddedEmployees(raw.employees);
          }
        }
      } catch (e) {
        logProfileFetchFailure('profiles_embed_employees_timeout', uid, e instanceof Error ? e : null, {
          cause: 'timeout_or_network',
        });
        pErr = null;
        profileRow = null;
      }

      if (pErr || !profileRow) {
        const soloRes = await withTimeout(
          supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', uid).maybeSingle(),
          PROFILE_FETCH_TIMEOUT_MS,
          'profiles_only'
        );
        if (soloRes.error) {
          logProfileFetchFailure('profiles_only', uid, soloRes.error);
          pErr = soloRes.error;
          profileRow = null;
        } else {
          pErr = null;
          profileRow = (soloRes.data ?? null) as Record<string, unknown> | null;
        }
      } else {
        pErr = null;
      }

      if (profileRow && !pErr) {
        nextProfile = mapProfileRow(profileRow, uid);
      }

      const profileCompanyId = profileRow
        ? ((profileRow.company_id as string | null | undefined) ?? undefined)
        : undefined;

      let employeePick: Record<string, unknown> | null = null;

      if (!pErr && embeddedEmps.length > 0) {
        employeePick = pickEmployeeRow(embeddedEmps, uid, profileCompanyId ?? null);
        if (embeddedEmps.length > 1 && !profileCompanyId) {
          console.warn(
            '[QuantixHR] Varios expedientes para el mismo usuario. Se usa el más reciente / activo. Asigna company_id en profiles o unifica expedientes.'
          );
        }
      }

      if (!pErr && !employeePick) {
        /**
         * Enlace auth ↔ expediente: este cliente asume `employees.user_id` = `profiles.id` (= auth.uid()).
         * Si en tu proyecto solo existe `profile_id` (sin `user_id`), la carga fallará hasta alinear esquema/RLS
         * (p. ej. política `profile_id = auth.uid()` en `scripts/sql/mobile_auth_self_read_rls.sql`).
         */
        const baseEmp = () =>
          supabase.from('employees').select(EMPLOYEE_COLUMNS).eq('user_id', uid);

        let empQuery = baseEmp();
        if (profileCompanyId && String(profileCompanyId).length > 0) {
          empQuery = empQuery.eq('company_id', profileCompanyId);
        }

        let empRes = await withTimeout(
          empQuery.order('created_at', { ascending: false }).limit(12),
          PROFILE_FETCH_TIMEOUT_MS,
          'employees_by_user'
        );

        if (empRes.error) {
          logProfileFetchFailure('employees', uid, empRes.error);
          eErr = empRes.error;
        } else {
          let rows = (empRes.data ?? []) as Record<string, unknown>[];
          if (
            rows.length === 0 &&
            profileCompanyId &&
            String(profileCompanyId).length > 0
          ) {
            empRes = await withTimeout(
              baseEmp().order('created_at', { ascending: false }).limit(12),
              PROFILE_FETCH_TIMEOUT_MS,
              'employees_fallback_sin_company_filter'
            );
            if (empRes.error) {
              logProfileFetchFailure('employees_fallback', uid, empRes.error);
              eErr = empRes.error;
            } else {
              eErr = null;
              rows = (empRes.data ?? []) as Record<string, unknown>[];
            }
          } else {
            eErr = null;
          }

          if (!eErr) {
            if (rows.length > 1 && !profileCompanyId) {
              console.warn(
                '[QuantixHR] Varios expedientes para el mismo usuario. Se usa el más reciente / activo. Asigna company_id en profiles o unifica expedientes.'
              );
            }
            const pick = pickEmployeeRow(rows, uid, profileCompanyId ?? null);
            employeePick = pick;
          }
        }
      } else if (!pErr && employeePick) {
        eErr = null;
      } else if (pErr) {
        eErr = null;
      }

      if (!pErr && employeePick) {
        nextEmployee = mapEmployeeRow(employeePick, uid);
      }

      /** Si `profiles.company_id` viene vacío pero el expediente sí tiene empresa, hidratar el perfil en memoria (noticias, GPS, RLS). */
      let profileForState = nextProfile;
      if (profileForState && nextEmployee?.company_id) {
        const pc = profileForState.company_id;
        const profileCompanyMissing = pc == null || String(pc).trim() === '';
        if (profileCompanyMissing) {
          profileForState = { ...profileForState, company_id: nextEmployee.company_id };
        }
      }

      setProfile(profileForState);
      setEmployee(nextEmployee);

      const snapshot: AuthRecordsSnapshot = { profile: profileForState, employee: nextEmployee };

      const ORPHAN_COMPANY_MSG =
        'Tu usuario no está asignado a ninguna empresa. Contacta a RRHH.';
      const ORPHAN_EMPLOYEE_MSG =
        'No encontramos un expediente de empleado vinculado a tu cuenta. Contacta a RRHH.';
      const ORPHAN_NO_PROFILE_MSG =
        'No hay un perfil de aplicación para tu cuenta. Contacta a RRHH.';

      if (pErr && eErr) {
        setRecordsError(
          'No pudimos cargar tu perfil ni tu expediente de empleado. Revisa tu conexión o permisos de acceso.'
        );
      } else if (pErr) {
        setRecordsError(
          'No pudimos cargar tu perfil. Algunas funciones pueden estar limitadas hasta que se restablezca la conexión.'
        );
      } else if (eErr) {
        setRecordsError(
          'No pudimos cargar tu expediente de empleado. El reloj y otros módulos pueden no estar disponibles.'
        );
      } else if (!profileForState) {
        setRecordsError(ORPHAN_NO_PROFILE_MSG);
      } else if (!profileForState.company_id && !nextEmployee) {
        setRecordsError(ORPHAN_COMPANY_MSG);
      } else if (profileForState.company_id && !nextEmployee) {
        setRecordsError(ORPHAN_EMPLOYEE_MSG);
      } else {
        setRecordsError(null);
      }

      return snapshot;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logProfileFetchFailure('refresh_unexpected', uid, e instanceof Error ? e : null);
      const isTimeout = msg.includes('Timeout');
      if (isTimeout) {
        console.error('[AuthContext] Carga de perfil cancelada por tiempo de espera.', { uid, msg });
        setRecordsError(
          'La conexión tardó demasiado. Revisa tu red y pulsa Reintentar.'
        );
      } else {
        setRecordsError(
          'No pudimos sincronizar tu cuenta con el servidor. Revisa la conexión y pulsa Reintentar.'
        );
      }
      return null;
    } finally {
      setIsRecordsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    // En cada cambio de sesión, refrescamos el perfil + employee.
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading: isSessionLoading || isRecordsLoading,
      profile,
      employee,
      authProfile: profile,
      employeeRecord: employee,
      recordsError,
      refresh,
      refreshProfile: refresh,
    }),
    [session, isSessionLoading, isRecordsLoading, profile, employee, recordsError, refresh]
  );

  const authDebugSig = JSON.stringify({
    uid: session?.user?.id ?? null,
    profileId: profile?.id ?? null,
    profileCompanyId: profile?.company_id ?? null,
    employeeId: employee?.id ?? null,
    employeeCompanyId: employee?.company_id ?? null,
    recordsError: recordsError ?? null,
    isLoading: isSessionLoading || isRecordsLoading,
  });
  if (authDebugSig !== authDebugSigRef.current) {
    authDebugSigRef.current = authDebugSig;
    console.log('ESTADO AUTH:', { authProfile: profile, employeeRecord: employee });
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

