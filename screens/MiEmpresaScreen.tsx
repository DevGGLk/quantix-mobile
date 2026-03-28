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

type Company = {
  name: string | null;
  logo_url: string | null;
  mission: string | null;
  vision: string | null;
  corporate_values: string | null;
};

type EmployeeRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  job_title_id: string | null;
  reports_to: string | null;
  manager_id: string | null;
  job_titles?: { name?: string | null } | null;
};

type OrgNode = {
  id: string;
  name: string;
  title: string;
  avatarUrl: string | null;
  managerId: string | null;
  children: OrgNode[];
};

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
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
      name: fullName,
      title: jobTitle,
      avatarUrl: r.avatar_url ?? null,
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

export default function MiEmpresaScreen() {
  const { employee } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [employeesFlat, setEmployeesFlat] = useState<EmployeeRow[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);

        const companyId = employee?.company_id ?? null;
        if (!companyId) {
          if (isMounted) setCompany(null);
          return;
        }

        const [companyRes, employeesRes] = await Promise.all([
          supabase
            .from('companies')
            .select('name, logo_url, mission, vision, corporate_values')
            .eq('id', companyId)
            .maybeSingle(),
          (async () => {
            const full = await supabase
              .from('employees')
              .select(
                'id, first_name, last_name, avatar_url, job_title_id, reports_to, manager_id, job_titles(name)'
              )
              .eq('company_id', companyId)
              .order('last_name', { ascending: true });
            if (!full.error) return full;
            const minimal = await supabase
              .from('employees')
              .select('id, first_name, last_name, job_title_id')
              .eq('company_id', companyId)
              .order('last_name', { ascending: true });
            return minimal;
          })(),
        ]);

        if (companyRes.error) throw companyRes.error;
        if (employeesRes.error) throw employeesRes.error;

        if (!isMounted) return;

        const row = (companyRes.data ?? null) as Record<string, unknown> | null;
        setCompany({
          name: typeof row?.name === 'string' ? row.name : null,
          logo_url: typeof row?.logo_url === 'string' ? row.logo_url : null,
          mission: typeof row?.mission === 'string' ? row.mission : null,
          vision: typeof row?.vision === 'string' ? row.vision : null,
          corporate_values:
            typeof row?.corporate_values === 'string' ? row.corporate_values : null,
        });

        setEmployeesFlat((employeesRes.data ?? []) as EmployeeRow[]);
      } catch (e) {
        console.error('Error cargando MiEmpresa:', e);
        if (isMounted) {
          setCompany(null);
          setEmployeesFlat([]);
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
  }, [employee?.company_id]);

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

  const orgTree = useMemo(() => buildOrgTree(employeesFlat), [employeesFlat]);

  if (isLoading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color={theme.accent} />
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
          <Text style={styles.sectionHint}>Jerarquía por supervisión</Text>
        </View>

        {employeesFlat.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Aún no hay datos registrados</Text>
            <Text style={styles.emptyText}>
              No hay empleados activos asociados a esta empresa.
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
  const initials = node.name.trim().slice(0, 1).toUpperCase() || 'E';
  return (
    <View>
      <View style={[styles.orgRow, { paddingLeft: 12 + level * 16 }]}>
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
    backgroundColor: theme.primary,
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
    backgroundColor: theme.primary,
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

