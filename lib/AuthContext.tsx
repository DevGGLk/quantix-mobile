import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

export type ProfileRecord = {
  id: string;
  email: string | null;
  role: string | null;
  holding_id: string | null;
  /** Empresa del perfil (auth); se usa para elegir expediente si hay varios `employees`. */
  company_id: string | null;
  onboarding_completed?: boolean | null;
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
  /** Alta del expediente en sistema (ISO); útil si aún no existe `hire_date` en BD. */
  created_at: string | null;
};

export type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  profile: ProfileRecord | null;
  employee: EmployeeRecord | null;
  /**
   * Mensaje si falla la carga de `profiles` y/o `employees` (red, RLS, etc.).
   * `null` cuando la sesión no aplica o la última recarga fue correcta.
   */
  recordsError: string | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider />');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
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

  const refresh = useCallback(async () => {
    const uid = session?.user?.id ?? null;
    if (!uid) {
      setProfile(null);
      setEmployee(null);
      setRecordsError(null);
      return;
    }

    setIsRecordsLoading(true);
    try {
      const { data: p, error: pErr } = await supabase
        .from('profiles')
        .select('id, email, role, holding_id, company_id, onboarding_completed')
        .eq('id', uid)
        .maybeSingle();

      if (pErr) {
        console.warn('AuthContext profiles:', pErr.message);
        setProfile(null);
      } else {
        const row = (p ?? null) as Record<string, unknown> | null;
        setProfile(
          row
            ? {
                id: String(row.id ?? uid),
                email: (row.email as string | null) ?? null,
                role: (row.role as string | null) ?? null,
                holding_id: (row.holding_id as string | null) ?? null,
                company_id: (row.company_id as string | null) ?? null,
                onboarding_completed: (row.onboarding_completed as boolean | null) ?? null,
              }
            : null
        );
      }

      const profileCompanyId =
        !pErr && p
          ? ((p as Record<string, unknown>).company_id as string | null | undefined)
          : undefined;

      let empQuery = supabase
        .from('employees')
        .select(
          'id, user_id, company_id, branch_id, department_id, job_title_id, first_name, last_name, salary, national_id, employee_code, employment_status, created_at'
        )
        .eq('user_id', uid);

      if (profileCompanyId) {
        empQuery = empQuery.eq('company_id', profileCompanyId);
      }

      const { data: empList, error: eErr } = await empQuery
        .order('created_at', { ascending: false })
        .limit(12);

      if (eErr) {
        console.warn('AuthContext employees:', eErr.message);
        setEmployee(null);
      } else {
        const rows = (empList ?? []) as Record<string, unknown>[];
        if (rows.length > 1 && !profileCompanyId) {
          console.warn(
            '[QuantixHR] Varios expedientes para el mismo usuario. Se usa el más reciente / activo. Asigna company_id en profiles o unifica expedientes.'
          );
        }
        const pick =
          rows.find((r) => String(r.employment_status ?? 'active').toLowerCase() === 'active') ??
          rows[0] ??
          null;

        setEmployee(
          pick
            ? {
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
                    ? (pick.salary as number)
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
                created_at:
                  pick.created_at != null ? String(pick.created_at as string) : null,
              }
            : null
        );
      }

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
      } else {
        setRecordsError(null);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('AuthContext refresh:', msg);
      setRecordsError(
        'No pudimos sincronizar tu cuenta con el servidor. Revisa la conexión y pulsa Reintentar.'
      );
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
      recordsError,
      refresh,
    }),
    [session, isSessionLoading, isRecordsLoading, profile, employee, recordsError, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

