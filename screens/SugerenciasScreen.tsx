import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

const CATEGORIAS = [
  { id: 'mejora_operativa', label: 'Mejora Operativa' },
  { id: 'idea_clientes_menu', label: 'Idea para Clientes/Menú' },
  { id: 'clima_laboral', label: 'Clima Laboral' },
  { id: 'otro', label: 'Otro' },
] as const;

export default function SugerenciasScreen() {
  const navigation = useNavigation<RootStackNavigation>();
  const insets = useSafeAreaInsets();
  const { session, employee } = useAuth();

  const [category, setCategory] = useState<string>(CATEGORIAS[0].id);
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      Alert.alert('Mensaje requerido', 'Escribe tu idea o sugerencia antes de enviar.');
      return;
    }

    try {
      setIsSubmitting(true);

      const userId = session?.user?.id ?? null;
      const employeeRowId = employee?.id ?? null;
      if (!userId) {
        Alert.alert('Error', 'No se pudo obtener tu sesión.');
        return;
      }

      const companyId = employee?.company_id ?? null;
      if (!companyId) {
        Alert.alert('Error', 'No se pudo identificar tu empresa.');
        return;
      }

      if (!isAnonymous && !employeeRowId) {
        Alert.alert('Error', 'No se encontró tu expediente de empleado. Contacta a RRHH.');
        return;
      }

      const payload = {
        company_id: companyId,
        category,
        message: trimmed,
        is_anonymous: isAnonymous,
        employee_id: isAnonymous ? null : employeeRowId,
      };

      const { error } = await supabase.from('suggestions').insert(payload);
      if (error) throw error;

      Alert.alert(
        '¡Gracias!',
        '¡Gracias por tu aporte! Gerencia revisará tu idea pronto.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: unknown) {
      console.error('Error al enviar sugerencia:', e);
      Alert.alert('Error', errorMessage(e) || 'No se pudo enviar la sugerencia.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Ionicons name="bulb-outline" size={40} color={theme.warning} />
          <Text style={styles.headerTitle}>¡Tu voz construye nuestra empresa!</Text>
          <Text style={styles.headerSubtitle}>
            Déjanos tus ideas o sugerencias.
          </Text>
        </View>

        <Text style={styles.label}>Categoría</Text>
        <View style={styles.categoryWrap}>
          {CATEGORIAS.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.categoryBtn, category === c.id && styles.categoryBtnActive]}
              activeOpacity={0.8}
              onPress={() => setCategory(c.id)}
            >
              <Text
                style={[
                  styles.categoryBtnText,
                  category === c.id && styles.categoryBtnTextActive,
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Mensaje</Text>
        <TextInput
          style={styles.input}
          placeholder="Escribe aquí tu idea o sugerencia..."
          placeholderTextColor={theme.textMuted}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Enviar de forma anónima</Text>
          <Switch
            value={isAnonymous}
            onValueChange={setIsAnonymous}
            trackColor={{ false: theme.border, true: theme.accent }}
            thumbColor={theme.backgroundAlt}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
          activeOpacity={0.9}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={theme.backgroundAlt} />
          ) : (
            <Text style={styles.submitBtnText}>Enviar Sugerencia a Gerencia</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
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
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.textPrimary,
    marginTop: 12,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 10,
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  categoryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  categoryBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  categoryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  categoryBtnTextActive: {
    color: theme.backgroundAlt,
  },
  input: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: theme.textPrimary,
    minHeight: 140,
    marginBottom: 20,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.backgroundAlt,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 28,
  },
  switchLabel: {
    fontSize: 15,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  submitBtn: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.8,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
});
