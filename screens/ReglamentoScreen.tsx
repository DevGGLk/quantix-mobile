import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type Chapter = {
  id?: string;
  title: string;
  content: string;
};

export default function ReglamentoScreen() {
  const { employee } = useAuth();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadReglamento() {
      try {
        setIsLoading(true);

        const companyId = employee?.company_id ?? null;
        if (!companyId) {
          if (isMounted) setChapters([]);
          return;
        }

        const { data, error } = await supabase
          .from('company_policies')
          .select('id, title, content, order_index')
          .eq('company_id', companyId)
          .order('order_index', { ascending: true });

        if (error) throw error;

        if (isMounted) {
          setChapters(
            (data ?? []).map((row: any) => ({
              id: String(row.id ?? ''),
              title: row.title ?? '',
              content: row.content ?? '',
            }))
          );
        }
      } catch (e) {
        console.error('Error en ReglamentoScreen:', e);
        if (isMounted) {
          setChapters([]);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadReglamento();
    return () => {
      isMounted = false;
    };
  }, [employee?.company_id]);

  const hasChapters = chapters.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Reglamento Interno</Text>

        {isLoading && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.loaderText}>Cargando reglamento...</Text>
          </View>
        )}

        {!isLoading && !hasChapters && (
          <View style={styles.emptyWrapper}>
            <Text style={styles.emptyText}>
              No hay políticas publicadas por el momento.
            </Text>
          </View>
        )}

        {hasChapters &&
          chapters.map((chapter) => (
            <View key={chapter.id ?? chapter.title} style={styles.card}>
              <Text style={styles.cardTitle}>{chapter.title}</Text>
              <Text style={styles.cardContent}>{chapter.content}</Text>
            </View>
          ))}
      </ScrollView>
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
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 16,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  emptyWrapper: {
    marginTop: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
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
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 8,
  },
  cardContent: {
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
  },
});

