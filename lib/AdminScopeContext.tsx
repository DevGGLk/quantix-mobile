import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

/**
 * Scope de empresa/sucursal para las pantallas admin del móvil (Centro de Mando + Radar GPS).
 * Paridad con el TenantContext del dashboard web: el admin elige qué empresa (holding) y
 * sucursal está viendo. Inicializa desde profile.company_id (funciona para superadmin, que
 * no tiene fila en `employees`). La lista de empresas la limita la RLS (su holding).
 */
export type ScopeCompany = { id: string; name: string };
export type ScopeBranch = { id: string; name: string };

type AdminScopeValue = {
  companyId: string | null;
  branchId: string | null; // null = todas las sucursales
  companies: ScopeCompany[];
  branches: ScopeBranch[];
  loadingCompanies: boolean;
  loadingBranches: boolean;
  setCompanyId: (id: string) => void;
  setBranchId: (id: string | null) => void;
};

const AdminScopeContext = createContext<AdminScopeValue | null>(null);

export function useAdminScope(): AdminScopeValue {
  const ctx = useContext(AdminScopeContext);
  if (!ctx) throw new Error('useAdminScope debe usarse dentro de <AdminScopeProvider />');
  return ctx;
}

export function AdminScopeProvider({ children }: { children: React.ReactNode }) {
  const { profile, employee, canAccessAdminPanel } = useAuth();
  const fallbackCompany = profile?.company_id ?? employee?.company_id ?? null;

  const [companyId, setCompanyIdState] = useState<string | null>(fallbackCompany);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<ScopeCompany[]>([]);
  const [branches, setBranches] = useState<ScopeBranch[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Empresas visibles (RLS limita al holding / empresa del usuario).
  // Solo para usuarios del panel gerencial; los colaboradores no disparan estas consultas.
  useEffect(() => {
    if (!canAccessAdminPanel) { setCompanies([]); return; }
    let cancelled = false;
    async function load() {
      setLoadingCompanies(true);
      const { data, error } = await supabase.from('companies').select('id, name').order('name');
      if (cancelled) return;
      const opts = (!error && data ? (data as ScopeCompany[]) : []).filter((c) => c.id);
      setCompanies(opts);
      setCompanyIdState((prev) => {
        if (prev && opts.some((o) => o.id === prev)) return prev;
        if (fallbackCompany && opts.some((o) => o.id === fallbackCompany)) return fallbackCompany;
        return opts[0]?.id ?? prev ?? fallbackCompany;
      });
      setLoadingCompanies(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [fallbackCompany, canAccessAdminPanel]);

  // Sucursales de la empresa seleccionada.
  useEffect(() => {
    if (!canAccessAdminPanel || !companyId) { setBranches([]); return; }
    const cid = companyId; // no-null para el closure
    let cancelled = false;
    async function load() {
      setLoadingBranches(true);
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, is_active')
        .eq('company_id', cid)
        .order('name');
      if (cancelled) return;
      const opts = (!error && data ? (data as { id: string; name: string; is_active?: boolean | null }[]) : [])
        .filter((b) => b.id && b.is_active !== false)
        .map((b) => ({ id: b.id, name: b.name }));
      setBranches(opts);
      setLoadingBranches(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [companyId, canAccessAdminPanel]);

  const setCompanyId = useCallback((id: string) => {
    setCompanyIdState(id);
    setBranchId(null); // al cambiar de empresa, volver a "todas las sucursales"
  }, []);

  return (
    <AdminScopeContext.Provider
      value={{ companyId, branchId, companies, branches, loadingCompanies, loadingBranches, setCompanyId, setBranchId }}
    >
      {children}
    </AdminScopeContext.Provider>
  );
}
