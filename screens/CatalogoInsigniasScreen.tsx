import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { BadgeCatalogueIcon } from '../utils/badgeIcons';

type CatalogueRow = {
  id: string;
  name: string;
  description: string | null;
  criteria: string | null;
  reward_points: number | null;
  icon_name: string | null;
  icon_color: string | null;
};

type CatalogueItem = CatalogueRow & { earned: boolean };

const MUTED_ICON = '#94a3b8';

export default function CatalogoInsigniasScreen() {
  const { session, employee } = useAuth();
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const userId = session?.user?.id ?? null;
    const companyId = employee?.company_id ?? null;
    const empId = employee?.id ?? null;

    if (!userId || !companyId || !empId) {
      setItems([]);
      return;
    }

    const [catRes, earnedRes] = await Promise.all([
      supabase
        .from('badge_catalogue')
        .select('id, name, description, criteria, reward_points, icon_name, icon_color')
        .eq('company_id', companyId)
        .order('reward_points', { ascending: true }),
      supabase.from('employee_badges').select('badge_id').eq('employee_id', empId),
    ]);

    if (catRes.error) {
      console.error('CatalogoInsignias badge_catalogue:', catRes.error);
      Alert.alert(
        'Error',
        'No pudimos cargar el catálogo de insignias. Revisa tu conexión e inténtalo de nuevo.'
      );
      setItems([]);
      return;
    }

    if (earnedRes.error) {
      console.error('CatalogoInsignias employee_badges:', earnedRes.error);
    }

    const earned = new Set(
      Array.isArray(earnedRes.data)
        ? earnedRes.data.map((r: { badge_id?: string | null }) => String(r.badge_id ?? '')).filter(Boolean)
        : []
    );

    const rows = (Array.isArray(catRes.data) ? catRes.data : []) as CatalogueRow[];
    setItems(
      rows.map((r) => ({
        ...r,
        earned: earned.has(String(r.id)),
      }))
    );
  }, [session?.user?.id, employee?.company_id, employee?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const renderItem = useCallback(({ item }: { item: CatalogueItem }) => {
    const pts = Number(item.reward_points) || 0;
    const iconTint = item.earned
      ? String(item.icon_color ?? '').trim() || theme.accent
      : MUTED_ICON;
    const desc = item.description?.trim() || '—';
    const crit = item.criteria?.trim() || '—';

    return (
      <View
        style={[styles.card, !item.earned && styles.cardLocked]}
        accessibilityLabel={`${item.name}, ${item.earned ? 'desbloqueada' : 'bloqueada'}, ${pts} puntos`}
      >
        <View style={styles.cardTop}>
          <View style={[styles.iconWrap, !item.earned && styles.iconWrapMuted]}>
            <BadgeCatalogueIcon iconName={item.icon_name} color={iconTint} size={32} />
          </View>
          {item.earned ? (
            <View style={styles.earnedPill}>
              <Text style={styles.earnedPillText}>Conseguida</Text>
            </View>
          ) : (
            <View style={styles.lockedPill}>
              <Text style={styles.lockedPillText}>Por desbloquear</Text>
            </View>
          )}
        </View>
        <Text style={[styles.title, !item.earned && styles.textMuted]} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.points}>{pts} pts al obtenerla</Text>
        <Text style={styles.label}>Objetivo</Text>
        <Text style={[styles.body, !item.earned && styles.textMutedSoft]} numberOfLines={4}>
          {desc}
        </Text>
        <Text style={styles.label}>Requisito</Text>
        <Text style={[styles.body, !item.earned && styles.textMutedSoft]} numberOfLines={4}>
          {crit}
        </Text>
      </View>
    );
  }, []);

  const userId = session?.user?.id ?? null;
  const companyId = employee?.company_id ?? null;
  const empId = employee?.id ?? null;
  const missingContext = !userId || !companyId || !empId;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.hint}>Cargando catálogo…</Text>
        </View>
      ) : missingContext ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Sin empresa asignada</Text>
          <Text style={styles.hint}>Necesitas un expediente con empresa para ver las insignias.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          ListHeaderComponent={
            <Text style={styles.intro}>
              Todas las insignias que tu empresa ofrece. Las conseguidas aparecen a todo color; las demás te
              esperan.
            </Text>
          }
          ListEmptyComponent={
            <Text style={styles.hint}>Tu empresa aún no ha configurado insignias en el catálogo.</Text>
          }
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.storeBackground,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  hint: {
    marginTop: 12,
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  row: {
    gap: 12,
    marginBottom: 12,
  },
  intro: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 16,
    marginHorizontal: 4,
    lineHeight: 20,
  },
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
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
  cardLocked: {
    opacity: 0.72,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: `${theme.accent}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapMuted: {
    backgroundColor: '#e2e8f0',
  },
  earnedPill: {
    backgroundColor: `${theme.accent}22`,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  earnedPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.accent,
  },
  lockedPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  lockedPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.textMuted,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 4,
  },
  points: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.warning,
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
    marginBottom: 10,
  },
  textMuted: {
    color: theme.textSecondary,
  },
  textMutedSoft: {
    color: theme.textMuted,
  },
});
