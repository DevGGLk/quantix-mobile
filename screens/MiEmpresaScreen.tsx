import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { getEmployeePhotoPublicUrl } from '../lib/employeePhoto';

type Company = {
  name: string | null;
  logo_url: string | null;
  mission: string | null;
  vision: string | null;
  corporate_values: string | null;
};

type BranchAdnRow = {
  mission: string | null;
  vision: string | null;
  corporate_values: string | null;
};

type EmployeeRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  /** Ruta del avatar en el bucket público `employee_photos` (fuente de verdad; ya no existe `avatar_url`). */
  avatar_path: string | null;
  avatar_updated_at: string | null;
  job_title_id: string | null;
  position_id: string | null;
  reports_to: string | null;
  manager_id: string | null;
  job_titles?: { name?: string | null } | null;
};

type OrgUnitRow = {
  id: string;
  name: string | null;
  parent_unit_id: string | null;
  is_active: boolean | null;
};

type PositionRow = {
  id: string;
  org_unit_id: string | null;
  job_title_id: string | null;
  reports_to_position_id: string | null;
  title_label: string;
};

type OrgKind = 'org_unit' | 'position' | 'employee';

type OrgNode = {
  id: string;
  kind: OrgKind;
  name: string;
  title: string;
  avatarUrl: string | null;
  /** Solo para posiciones: true si ninguna persona la ocupa. */
  vacant?: boolean;
  /** Fallback supervisión (árbol legacy por reports_to/manager_id). */
  managerId?: string | null;
  children: OrgNode[];
};

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

/** Prioridad: sucursal → columnas de empresa → `companies.settings` (paridad con web). */
function coalesceAdnField(...candidates: unknown[]): string | null {
  for (const v of candidates) {
    const t = normalizeText(v);
    if (t.length > 0) return t;
  }
  return null;
}

function embeddedJobTitleName(raw: unknown): string | null {
  if (raw == null) return null;
  const one = Array.isArray(raw) ? raw[0] : raw;
  if (one && typeof one === 'object' && 'name' in one) {
    return normalizeText((one as { name?: unknown }).name) || null;
  }
  return null;
}

/**
 * Carga empleados de la empresa y resuelve el nombre del cargo: contrato activo (`employment_contracts` + `job_titles`)
 * y, si no hay contrato con título, `employees.job_title_id` → `job_titles`.
 */
async function fetchEmployeesWithResolvedJobTitles(companyId: string): Promise<EmployeeRow[]> {
  const empRes = await supabase
    .from('employees')
    .select('id, first_name, last_name, avatar_path, avatar_updated_at, job_title_id, position_id, reports_to, manager_id')
    .eq('company_id', companyId)
    .eq('employment_status', 'active')
    .order('last_name', { ascending: true });

  if (empRes.error) throw empRes.error;

  const rows = (empRes.data ?? []) as Omit<EmployeeRow, 'job_titles'>[];

  const cargoByEmployeeId = new Map<string, string>();

  const contractsRes = await supabase
    .from('employment_contracts')
    .select('employee_id, job_titles(name), created_at')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (!contractsRes.error && contractsRes.data) {
    for (const row of contractsRes.data as { employee_id?: string; job_titles?: unknown }[]) {
      const eid = normalizeText(row.employee_id);
      if (!eid || cargoByEmployeeId.has(eid)) continue;
      const nm = embeddedJobTitleName(row.job_titles);
      if (nm) cargoByEmployeeId.set(eid, nm);
    }
  }

  const missingTitleIds = new Set<string>();
  for (const r of rows) {
    const id = String(r.id);
    if (!cargoByEmployeeId.has(id) && r.job_title_id) {
      missingTitleIds.add(String(r.job_title_id));
    }
  }

  const titleById = new Map<string, string>();
  if (missingTitleIds.size > 0) {
    const jtRes = await supabase.from('job_titles').select('id, name').in('id', [...missingTitleIds]);
    if (!jtRes.error && jtRes.data) {
      for (const t of jtRes.data as { id: string; name?: string | null }[]) {
        const id = String(t.id);
        const nm = normalizeText(t.name);
        if (nm) titleById.set(id, nm);
      }
    }
  }

  return rows.map((r) => {
    const id = String(r.id);
    const fromContract = cargoByEmployeeId.get(id);
    const jid = r.job_title_id ? String(r.job_title_id) : '';
    const fromEmployeeTitle = jid ? titleById.get(jid) : undefined;
    const label = fromContract || fromEmployeeTitle || '';
    return {
      ...r,
      job_titles: label ? { name: label } : null,
    };
  });
}

function buildOrgTree(rows: EmployeeRow[]): OrgNode[] {
  const nodesById = new Map<string, OrgNode>();

  for (const r of rows) {
    const fullName =
      [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Empleado';
    const jobTitle = normalizeText(r.job_titles?.name) || 'Sin cargo asignado';
    const selfId = String(r.id);
    const rawManagerId = normalizeText(r.reports_to ?? r.manager_id);
    // Root si no tiene jefe o si apunta a sí mismo (evitar ciclos).
    const managerId = !rawManagerId || rawManagerId === selfId ? null : rawManagerId;

    nodesById.set(selfId, {
      id: selfId,
      kind: 'employee',
      name: fullName,
      title: jobTitle,
      avatarUrl: getEmployeePhotoPublicUrl(r.avatar_path, r.avatar_updated_at),
      managerId,
      children: [],
    });
  }

  const roots: OrgNode[] = [];
  for (const node of nodesById.values()) {
    if (node.managerId && nodesById.has(node.managerId)) {
      nodesById.get(node.managerId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (list: OrgNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    for (const n of list) sortTree(n.children);
  };
  sortTree(roots);

  return roots;
}

/**
 * Carga la estructura organizativa (departamentos + plazas) — MISMA fuente que la web
 * (`org_units` + `positions`, título de plaza desde `job_titles.name`). Devuelve listas vacías
 * si la empresa no configuró estructura (entonces se usa el árbol por supervisión).
 */
async function fetchOrgStructure(
  companyId: string
): Promise<{ orgUnits: OrgUnitRow[]; positions: PositionRow[] }> {
  const [ouRes, posRes] = await Promise.all([
    supabase.from('org_units').select('id, name, parent_unit_id, is_active').eq('company_id', companyId),
    supabase.from('positions').select('id, org_unit_id, job_title_id, reports_to_position_id').eq('company_id', companyId),
  ]);

  // Degradación defensiva: si RLS/esquema fallan, devolvemos estructura vacía
  // (la pantalla cae al árbol por supervisión) sin romper el ADN ni la lista.
  if (ouRes.error || posRes.error) {
    console.warn('MiEmpresa org structure:', ouRes.error?.message ?? posRes.error?.message);
    return { orgUnits: [], positions: [] };
  }

  const orgUnits = ((ouRes.data ?? []) as OrgUnitRow[]).filter((u) => u.is_active !== false);
  const rawPositions = (posRes.data ?? []) as Omit<PositionRow, 'title_label'>[];

  // Título de cada plaza: job_titles.name vía job_title_id.
  const jobTitleIds = [...new Set(rawPositions.map((p) => p.job_title_id).filter(Boolean) as string[])];
  const titleById = new Map<string, string>();
  if (jobTitleIds.length > 0) {
    const jtRes = await supabase.from('job_titles').select('id, name').in('id', jobTitleIds);
    if (!jtRes.error && jtRes.data) {
      for (const t of jtRes.data as { id: string; name?: string | null }[]) {
        const nm = normalizeText(t.name);
        if (nm) titleById.set(String(t.id), nm);
      }
    }
  }

  const positions: PositionRow[] = rawPositions.map((p) => ({
    ...p,
    title_label: (p.job_title_id ? titleById.get(String(p.job_title_id)) : '') || 'Plaza',
  }));

  return { orgUnits, positions };
}

/**
 * Organigrama estructural (departamentos → plazas → personas), paridad con la web
 * (`buildStructuralOrgNodes`). Las personas sin plaza asignada van a un grupo aparte.
 */
function buildStructuralTree(
  orgUnits: OrgUnitRow[],
  positions: PositionRow[],
  employees: EmployeeRow[]
): OrgNode[] {
  const ouNodeById = new Map<string, OrgNode>();
  const posNodeById = new Map<string, OrgNode>();

  for (const u of orgUnits) {
    ouNodeById.set(u.id, {
      id: `ou:${u.id}`,
      kind: 'org_unit',
      name: normalizeText(u.name) || 'Departamento',
      title: 'Departamento',
      avatarUrl: null,
      children: [],
    });
  }

  for (const p of positions) {
    posNodeById.set(p.id, {
      id: `po:${p.id}`,
      kind: 'position',
      name: p.title_label,
      title: 'Puesto / plaza',
      avatarUrl: null,
      vacant: true,
      children: [],
    });
  }

  // Personas: bajo su plaza (position_id) si existe; marcan la plaza como ocupada.
  const unassigned: OrgNode[] = [];
  for (const r of employees) {
    const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Empleado';
    const empNode: OrgNode = {
      id: r.id,
      kind: 'employee',
      name: fullName,
      title: normalizeText(r.job_titles?.name) || 'Sin cargo asignado',
      avatarUrl: getEmployeePhotoPublicUrl(r.avatar_path, r.avatar_updated_at),
      children: [],
    };
    const pid = normalizeText(r.position_id);
    const posNode = pid ? posNodeById.get(pid) : undefined;
    if (posNode) {
      posNode.vacant = false;
      posNode.children.push(empNode);
    } else {
      unassigned.push(empNode);
    }
  }

  // Plazas: bajo su plaza superior (reports_to_position_id) o su departamento.
  for (const p of positions) {
    const node = posNodeById.get(p.id)!;
    const rp = normalizeText(p.reports_to_position_id);
    const parentPos = rp ? posNodeById.get(rp) : undefined;
    const ou = normalizeText(p.org_unit_id);
    const parentOu = ou ? ouNodeById.get(ou) : undefined;
    if (parentPos) parentPos.children.push(node);
    else if (parentOu) parentOu.children.push(node);
    // huérfana (sin depto válido): la colgamos como raíz más abajo
  }

  // Departamentos: bajo su padre (parent_unit_id) o raíz.
  const roots: OrgNode[] = [];
  for (const u of orgUnits) {
    const node = ouNodeById.get(u.id)!;
    const parent = normalizeText(u.parent_unit_id);
    const parentNode = parent ? ouNodeById.get(parent) : undefined;
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }

  // Plazas huérfanas (org_unit inexistente y sin plaza superior) → raíz.
  for (const p of positions) {
    const node = posNodeById.get(p.id)!;
    const rp = normalizeText(p.reports_to_position_id);
    const ou = normalizeText(p.org_unit_id);
    const hasParent = (rp && posNodeById.has(rp)) || (ou && ouNodeById.has(ou));
    if (!hasParent) roots.push(node);
  }

  if (unassigned.length > 0) {
    unassigned.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    roots.push({
      id: 'unassigned',
      kind: 'org_unit',
      name: 'Sin plaza asignada',
      title: 'Colaboradores sin puesto estructural',
      avatarUrl: null,
      children: unassigned,
    });
  }

  const sortTree = (list: OrgNode[]) => {
    list.sort((a, b) => {
      // orden: departamentos/plazas primero por nombre, luego empleados
      if (a.kind !== b.kind) {
        const rank = (k: OrgKind) => (k === 'employee' ? 1 : 0);
        if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
      }
      return a.name.localeCompare(b.name, 'es');
    });
    for (const n of list) sortTree(n.children);
  };
  sortTree(roots);

  return roots;
}

export default function MiEmpresaScreen() {
  const { employee } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [employeesFlat, setEmployeesFlat] = useState<EmployeeRow[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitRow[]>([]);
  const [positions, setPositions] = useState<PositionRow[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);

        const companyId = employee?.company_id ?? null;
        const branchId = employee?.branch_id?.trim() || null;
        if (!companyId) {
          if (isMounted) {
            setCompany(null);
            setEmployeesFlat([]);
            setOrgUnits([]);
            setPositions([]);
          }
          return;
        }

        const companyResPromise = supabase
          .from('companies')
          .select('name, logo_url, mission, vision, corporate_values, settings')
          .eq('id', companyId)
          .maybeSingle();

        const branchResPromise =
          branchId != null
            ? supabase
                .from('branches')
                .select('mission, vision, corporate_values')
                .eq('id', branchId)
                .eq('company_id', companyId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null as null });

        const [companyRes, branchRes, employeesFlatResolved, orgStructure] = await Promise.all([
          companyResPromise,
          branchResPromise,
          fetchEmployeesWithResolvedJobTitles(companyId),
          fetchOrgStructure(companyId),
        ]);

        if (companyRes.error) throw companyRes.error;
        if (branchRes.error) throw branchRes.error;

        if (!isMounted) return;

        const row = (companyRes.data ?? null) as Record<string, unknown> | null;
        const settings =
          row?.settings != null && typeof row.settings === 'object'
            ? (row.settings as Record<string, unknown>)
            : {};
        const branchRow = (branchRes.data ?? null) as BranchAdnRow | null;

        const mission = coalesceAdnField(
          branchRow?.mission,
          row?.mission,
          settings.mission
        );
        const vision = coalesceAdnField(branchRow?.vision, row?.vision, settings.vision);
        const corporate_values = coalesceAdnField(
          branchRow?.corporate_values,
          row?.corporate_values,
          settings.values
        );

        setCompany({
          name: typeof row?.name === 'string' ? row.name : null,
          logo_url: typeof row?.logo_url === 'string' ? row.logo_url : null,
          mission,
          vision,
          corporate_values,
        });

        setEmployeesFlat(employeesFlatResolved);
        setOrgUnits(orgStructure.orgUnits);
        setPositions(orgStructure.positions);
      } catch (e) {
        console.error('Error cargando MiEmpresa:', e);
        if (isMounted) {
          setCompany(null);
          setEmployeesFlat([]);
          setOrgUnits([]);
          setPositions([]);
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
  }, [employee?.company_id, employee?.branch_id]);

  const cards = useMemo(() => {
    const mission = normalizeText(company?.mission);
    const vision = normalizeText(company?.vision);
    const values = normalizeText(company?.corporate_values);

    return [
      { key: 'mission', title: 'Misión', body: mission },
      { key: 'vision', title: 'Visión', body: vision },
      { key: 'values', title: 'Valores', body: values },
    ];
  }, [company?.mission, company?.vision, company?.corporate_values]);

  /** Estructural (departamentos + plazas + personas) si la empresa la configuró; si no, supervisión. */
  const hasStructure = orgUnits.length > 0 || positions.length > 0;
  const orgTree = useMemo(
    () =>
      hasStructure
        ? buildStructuralTree(orgUnits, positions, employeesFlat)
        : buildOrgTree(employeesFlat),
    [hasStructure, orgUnits, positions, employeesFlat]
  );

  if (isLoading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loaderText}>Cargando identidad corporativa...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {company?.logo_url ? (
            <Image source={{ uri: company.logo_url }} style={styles.logo} />
          ) : (
            <View style={styles.logoFallback}>
              <Text style={styles.logoFallbackText}>
                {normalizeText(company?.name).slice(0, 1).toUpperCase() || 'Q'}
              </Text>
            </View>
          )}
          <Text style={styles.companyName}>{normalizeText(company?.name) || 'Mi Empresa'}</Text>
          <Text style={styles.subtitle}>Identidad Corporativa</Text>
        </View>

        {cards.map((card) => (
          <View key={card.key} style={styles.card}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            {card.body.length > 0 ? (
              <Text style={styles.cardBody}>{card.body}</Text>
            ) : (
              <Text style={styles.cardPlaceholder}>
                Aún no se ha definido este apartado corporativo.
              </Text>
            )}
          </View>
        ))}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Estructura Organizacional</Text>
          <Text style={styles.sectionHint}>
            {hasStructure ? 'Departamentos, plazas y personas' : 'Jerarquía por supervisión'}
          </Text>
        </View>

        {orgTree.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Aún no hay datos registrados</Text>
            <Text style={styles.emptyText}>
              No hay estructura organizativa ni empleados activos asociados a esta empresa.
            </Text>
          </View>
        ) : (
          <View style={styles.orgCard}>
            {orgTree.map((node) => (
              <OrgNodeRow key={node.id} node={node} level={0} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function OrgNodeRow({ node, level }: { node: OrgNode; level: number }) {
  const indent = 12 + level * 16;

  if (node.kind === 'org_unit') {
    return (
      <View>
        <View style={[styles.orgRow, styles.deptRow, { paddingLeft: indent }]}>
          <View style={styles.deptBar} />
          <View style={styles.orgTextWrap}>
            <Text style={styles.deptName} numberOfLines={1}>
              {node.name.toUpperCase()}
            </Text>
            <Text style={styles.orgTitle} numberOfLines={1}>
              {node.title}
            </Text>
          </View>
        </View>
        {node.children.map((child) => (
          <OrgNodeRow key={child.id} node={child} level={level + 1} />
        ))}
      </View>
    );
  }

  if (node.kind === 'position') {
    return (
      <View>
        <View style={[styles.orgRow, { paddingLeft: indent }]}>
          <View style={styles.posDot} />
          <View style={styles.orgTextWrap}>
            <Text style={styles.posName} numberOfLines={1}>
              {node.name}
            </Text>
            <Text style={styles.orgTitle} numberOfLines={1}>
              {node.title}
            </Text>
          </View>
          {node.vacant && (
            <View style={styles.vacantPill}>
              <Text style={styles.vacantPillText}>Vacante</Text>
            </View>
          )}
        </View>
        {node.children.map((child) => (
          <OrgNodeRow key={child.id} node={child} level={level + 1} />
        ))}
      </View>
    );
  }

  const initials = node.name.trim().slice(0, 1).toUpperCase() || 'E';
  return (
    <View>
      <View style={[styles.orgRow, { paddingLeft: indent }]}>
        {node.avatarUrl ? (
          <Image source={{ uri: node.avatarUrl }} style={styles.orgAvatar} />
        ) : (
          <View style={styles.orgAvatarFallback}>
            <Text style={styles.orgAvatarFallbackText}>{initials}</Text>
          </View>
        )}
        <View style={styles.orgTextWrap}>
          <Text style={styles.orgName} numberOfLines={1}>
            {node.name}
          </Text>
          <Text style={styles.orgTitle} numberOfLines={1}>
            {node.title}
          </Text>
        </View>
      </View>
      {node.children.map((child) => (
        <OrgNodeRow key={child.id} node={child} level={level + 1} />
      ))}
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
    gap: 16,
  },
  header: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: theme.backgroundAlt,
    marginBottom: 12,
  },
  logoFallback: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: theme.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoFallbackText: {
    color: theme.backgroundAlt,
    fontSize: 34,
    fontWeight: '800',
  },
  companyName: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 18,
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 10,
  },
  cardBody: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },
  cardPlaceholder: {
    fontSize: 14,
    color: theme.textMuted,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  loaderWrap: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionHeader: {
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  sectionHint: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  orgCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
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
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  deptRow: {
    backgroundColor: theme.subtleBackground,
  },
  deptBar: {
    width: 4,
    height: 30,
    borderRadius: 2,
    backgroundColor: theme.primary,
  },
  deptName: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
    color: theme.primary,
  },
  posDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 12,
    marginRight: 12,
    borderWidth: 2,
    borderColor: theme.accent,
    backgroundColor: 'transparent',
  },
  posName: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  vacantPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: theme.storeBackground,
    borderWidth: 1,
    borderColor: theme.border,
  },
  vacantPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.textMuted,
  },
  orgAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.background,
  },
  orgAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgAvatarFallbackText: {
    color: theme.backgroundAlt,
    fontSize: 14,
    fontWeight: '800',
  },
  orgTextWrap: {
    flex: 1,
  },
  orgName: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.textPrimary,
  },
  orgTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
  },
});

