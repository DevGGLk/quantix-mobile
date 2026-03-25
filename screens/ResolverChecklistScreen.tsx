import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type ChecklistItem = {
  id: string;
  title?: string | null;
  label?: string | null;
  order_index?: number | null;
  [key: string]: any;
};

type ResolverParams = {
  ResolverChecklist: { checklist: { id: string; title?: string; [key: string]: any } };
};

export default function ResolverChecklistScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ResolverParams, 'ResolverChecklist'>>();
  const checklist = route.params?.checklist;
  const { session, employee } = useAuth();

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateChecklistOwnership = async (_userId: string, checklistId: string) => {
    const companyId = employee?.company_id ?? null;
    if (!companyId) return false;

    const { data: checklistData, error: checklistError } = await supabase
      .from('checklists')
      .select('id')
      .eq('id', checklistId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (checklistError) throw checklistError;

    return Boolean(checklistData);
  };

  useEffect(() => {
    if (!checklist?.id) return;

    let isMounted = true;

    async function loadItems() {
      try {
        setIsLoadingItems(true);

        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) setItems([]);
          return;
        }

        const canAccess = await validateChecklistOwnership(userId, checklist.id);
        if (!canAccess) {
          if (isMounted) {
            setItems([]);
            Alert.alert('Acceso denegado', 'Este checklist no pertenece a tu empresa.');
          }
          return;
        }

        const { data, error } = await supabase
          .from('checklist_items')
          .select('*')
          .eq('checklist_id', checklist.id)
          .order('order_index', { ascending: true });

        if (error) throw error;

        if (isMounted) {
          setItems((data as ChecklistItem[]) ?? []);
        }
      } catch (e) {
        console.error('Error al cargar ítems del checklist:', e);
        if (isMounted) {
          setItems([]);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoadingItems(false);
      }
    }

    loadItems();
    return () => {
      isMounted = false;
    };
  }, [checklist?.id, session?.user?.id, employee?.company_id]);

  const toggleItem = (itemId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!checklist?.id || isSubmitting) return;

    try {
      setIsSubmitting(true);

      const employeeId = session?.user?.id ?? null;
      if (!employeeId) {
        Alert.alert('Error', 'No se pudo obtener tu sesión.');
        return;
      }

      const canAccess = await validateChecklistOwnership(employeeId, checklist.id);
      if (!canAccess) {
        Alert.alert('Acceso denegado', 'Este checklist no pertenece a tu empresa.');
        return;
      }

      const total = items.length;
      const completed = total > 0 ? checkedIds.size : 0;
      const completion_percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      const { error: insertError } = await supabase.from('checklist_submissions').insert({
        checklist_id: checklist.id,
        employee_id: employeeId,
        completion_percentage,
      });

      if (insertError) throw insertError;

      Alert.alert(
        'Checklist enviado',
        `Cumplimiento: ${completion_percentage}%`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      console.error('Error al enviar checklist:', e);
      Alert.alert('Error', e?.message ?? 'No se pudo enviar el reporte.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const checklistTitle = checklist?.title ?? 'Checklist';
  const totalItems = items.length;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{checklistTitle}</Text>

        {isLoadingItems && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.loaderText}>Cargando tareas...</Text>
          </View>
        )}

        {!isLoadingItems && items.length === 0 && (
          <Text style={styles.emptyText}>No hay ítems configurados para este checklist.</Text>
        )}

        {!isLoadingItems &&
          items.map((item) => {
            const itemId = item.id;
            const isChecked = checkedIds.has(itemId);
            const label = item.title ?? item.label ?? 'Tarea';

            return (
              <TouchableOpacity
                key={itemId}
                style={styles.itemRow}
                activeOpacity={0.7}
                onPress={() => toggleItem(itemId)}
              >
                <Ionicons
                  name={isChecked ? 'checkbox-outline' : 'square-outline'}
                  size={24}
                  color={isChecked ? theme.accent : theme.textMuted}
                />
                <Text
                  style={[styles.itemLabel, isChecked && styles.itemLabelChecked]}
                  numberOfLines={2}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}

        {!isLoadingItems && totalItems > 0 && (
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            activeOpacity={0.9}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.backgroundAlt} />
            ) : (
              <Text style={styles.submitButtonText}>Enviar Reporte</Text>
            )}
          </TouchableOpacity>
        )}
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
    fontSize: 22,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 20,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  itemLabel: {
    flex: 1,
    fontSize: 15,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  itemLabelChecked: {
    textDecorationLine: 'line-through',
    color: theme.textMuted,
  },
  submitButton: {
    marginTop: 24,
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
});
