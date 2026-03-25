import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

export type ProfileRecord = {
  id: string;
  email: string | null;
  role: string | null;
  holding_id: string | null;
  onboarding_completed?: boolean | null;
};

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
};

export type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  profile: ProfileRecord | null;
  employee: EmployeeRecord | null;
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
      return;
    }

    setIsRecordsLoading(true);
    try {
      const { data: p, error: pErr } = await supabase
        .from('profiles')
        .select('id, email, role, holding_id, onboarding_completed')
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
                onboarding_completed: (row.onboarding_completed as boolean | null) ?? null,
              }
            : null
        );
      }

      // Enterprise: expediente operativo de RRHH (puede NO existir para superadmins).
      const { data: e, error: eErr } = await supabase
        .from('employees')
        .select(
          'id, user_id, company_id, branch_id, department_id, job_title_id, first_name, last_name, salary'
        )
        .eq('user_id', uid)
        .maybeSingle();

      if (eErr) {
        console.warn('AuthContext employees:', eErr.message);
        setEmployee(null);
      } else {
        const row = (e ?? null) as Record<string, unknown> | null;
        setEmployee(
          row
            ? {
                id: String(row.id ?? ''),
                user_id: String(row.user_id ?? uid),
                company_id: (row.company_id as string | null) ?? null,
                branch_id: (row.branch_id as string | null) ?? null,
                department_id: (row.department_id as string | null) ?? null,
                job_title_id: (row.job_title_id as string | null) ?? null,
                first_name: (row.first_name as string | null) ?? null,
                last_name: (row.last_name as string | null) ?? null,
                salary:
                  typeof row.salary === 'number'
                    ? (row.salary as number)
                    : row.salary != null
                      ? Number(row.salary)
                      : null,
              }
            : null
        );
      }
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
      refresh,
    }),
    [session, isSessionLoading, isRecordsLoading, profile, employee, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

