import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { useAvisos } from '../lib/AvisosContext';
import { abrirDestino, destinoParaAviso } from '../lib/avisoDestino';

type Aviso = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function cuando(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/**
 * Buzón de avisos (como la campanita de la web). Los no leídos se resaltan;
 * al abrir el buzón se marcan como vistos y el globo rojo se apaga.
 * Tocar un aviso abre la pantalla que corresponde.
 */
export default function AvisosScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const { refresh } = useAvisos();
  const [items, setItems] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, url, category, metadata, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);
    setItems((data ?? []) as Aviso[]);
    setLoading(false);
    // Vistos: se marcan al abrir el buzón (como Facebook/Instagram).
    const unreadIds = ((data ?? []) as Aviso[]).filter((a) => !a.read_at).map((a) => a.id);
    if (unreadIds.length) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds);
      void refresh();
    }
  }, [userId, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (a: Aviso) => {
    const destino = destinoParaAviso({ category: a.category, url: a.url, ...(a.metadata ?? {}) });
    if (destino) abrirDestino(navigation as never, destino);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={items.length === 0 ? styles.center : { padding: 12, gap: 8 }}
      data={items}
      keyExtractor={(a) => a.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListEmptyComponent={
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Ionicons name="notifications-off-outline" size={36} color={theme.textMuted} />
          <Text style={styles.empty}>No tienes avisos.</Text>
        </View>
      }
      renderItem={({ item }) => {
        const nuevo = !item.read_at;
        return (
          <TouchableOpacity activeOpacity={0.8} onPress={() => open(item)} style={[styles.card, nuevo && styles.cardNew]}>
            <View style={styles.row}>
              {nuevo && <View style={styles.dot} />}
              <Text style={[styles.title, nuevo && { fontWeight: '800' }]} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
            {!!item.body && (
              <Text style={styles.body} numberOfLines={3}>
                {item.body}
              </Text>
            )}
            <Text style={styles.time}>{cuando(item.created_at)}</Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.background },
  empty: { color: theme.textSecondary, fontSize: 14 },
  card: { backgroundColor: theme.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.border },
  cardNew: { borderColor: theme.accent, backgroundColor: theme.subtleBackground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.danger },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.textPrimary },
  body: { marginTop: 4, fontSize: 13, color: theme.textSecondary },
  time: { marginTop: 6, fontSize: 11, color: theme.textMuted },
});
