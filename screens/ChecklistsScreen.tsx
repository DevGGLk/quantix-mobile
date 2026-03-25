import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type Checklist = {
  id: string;
  title: string;
  category?: string | null;
  reward_points?: number | null;
  [key: string]: any;
};

export default function ChecklistsScreen() {
  const navigation = useNavigation<any>();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { employee } = useAuth();

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);

        const companyId = employee?.company_id ?? null;
        if (!companyId) {
          if (isMounted) setChecklists([]);
          return;
        }

        const { data, error } = await supabase
          .from('checklists')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true);

        if (error) throw error;

        if (isMounted) {
          setChecklists((data as Checklist[]) ?? []);
        }
      } catch (e) {
        console.error('Error al cargar checklists:', e);
        if (isMounted) {
          setChecklists([]);
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

  const hasChecklists = checklists.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Checklists Operativos</Text>

        {isLoading && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.loaderText}>Cargando listas...</Text>
          </View>
        )}

        {!isLoading && !hasChecklists && (
          <View style={styles.emptyWrapper}>
            <Ionicons name="checkmark-done-outline" size={48} color={theme.textMuted} />
            <Text style={styles.emptyText}>No hay checklists activos en este momento.</Text>
          </View>
        )}

        {!isLoading &&
          hasChecklists &&
          checklists.map((checklist) => {
            const points = checklist.reward_points ?? 0;
            return (
              <TouchableOpacity
                key={checklist.id}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ResolverChecklist', { checklist })}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{checklist.title}</Text>
                  {points > 0 && (
                    <View style={styles.pointsBadge}>
                      <Text style={styles.pointsText}>+{points} Pts</Text>
                    </View>
                  )}
                </View>
                {!!checklist.category && (
                  <Text style={styles.cardCategory}>{checklist.category}</Text>
                )}
                <View style={styles.cardArrow}>
                  <Ionicons name="chevron-forward" size={20} color={theme.accent} />
                </View>
              </TouchableOpacity>
            );
          })}
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
    marginBottom: 20,
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
    alignItems: 'center',
    marginTop: 32,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  card: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
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
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    flex: 1,
  },
  pointsBadge: {
    backgroundColor: theme.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pointsText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.accent,
  },
  cardCategory: {
    marginTop: 6,
    fontSize: 13,
    color: theme.textSecondary,
  },
  cardArrow: {
    marginTop: 8,
    alignSelf: 'flex-end',
  },
});
