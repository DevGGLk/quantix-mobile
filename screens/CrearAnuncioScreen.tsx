import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

export default function CrearAnuncioScreen() {
  const navigation = useNavigation<RootStackNavigation>();
  const insets = useSafeAreaInsets();
  const { session, profile, employee } = useAuth();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [contenido, setContenido] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) setAllowed(false);
          return;
        }

        const r = String(profile?.role ?? '').toLowerCase();
        const isAdminOrSuper = r === 'admin' || r === 'superadmin';
        if (isMounted) {
          setAllowed(isAdminOrSuper);
          setCompanyId(employee?.company_id ?? null);
        }
      } catch (_e) {
        if (isMounted) {
          setAllowed(false);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      }
    }

    checkAuth();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, profile?.role, employee?.company_id]);

  const handlePublicar = async () => {
    if (!titulo.trim()) {
      Alert.alert('Campo requerido', 'Escribe el título del anuncio.');
      return;
    }
    if (!contenido.trim()) {
      Alert.alert('Campo requerido', 'Escribe el contenido del anuncio.');
      return;
    }
    if (!companyId) {
      Alert.alert('Error', 'No se pudo identificar la empresa.');
      return;
    }

    try {
      setIsSubmitting(true);

      const payload = {
        company_id: companyId,
        title: titulo.trim(),
        content: contenido.trim(),
        is_urgent: urgente,
        is_active: true,
      };

      const { error } = await supabase.from('company_announcements').insert(payload);
      if (error) throw error;

      Alert.alert('Publicado', 'El anuncio se ha publicado correctamente.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: unknown) {
      console.error('Error al publicar anuncio:', e);
      Alert.alert('Error', errorMessage(e) || 'No se pudo publicar el anuncio.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (allowed === null) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Verificando acceso...</Text>
      </View>
    );
  }

  if (allowed === false) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.unauthorizedText}>
          No tienes permiso para publicar anuncios.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Publicar Noticia</Text>
        <Text style={styles.subtitle}>Crea un anuncio visible para todos los empleados de la empresa.</Text>

        <Text style={styles.label}>Título del anuncio</Text>
        <TextInput
          style={styles.input}
          value={titulo}
          onChangeText={setTitulo}
          placeholder="Ej: Cambio de horario por festivo"
          placeholderTextColor={theme.textMuted}
        />

        <Text style={styles.label}>Contenido</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={contenido}
          onChangeText={setContenido}
          placeholder="Escribe el mensaje completo..."
          placeholderTextColor={theme.textMuted}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Anuncio Urgente</Text>
          <Switch
            value={urgente}
            onValueChange={setUrgente}
            trackColor={{ false: theme.border, true: theme.accent }}
            thumbColor={theme.backgroundAlt}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handlePublicar}
          disabled={isSubmitting}
          activeOpacity={0.9}
        >
          {isSubmitting ? (
            <ActivityIndicator color={theme.backgroundAlt} />
          ) : (
            <Text style={styles.buttonText}>Publicar anuncio</Text>
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: theme.textSecondary,
  },
  unauthorizedText: {
    fontSize: 16,
    color: theme.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  backBtn: {
    backgroundColor: theme.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.backgroundAlt,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.textPrimary,
    marginBottom: 16,
  },
  textArea: {
    minHeight: 140,
    paddingTop: 12,
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
    marginBottom: 24,
  },
  switchLabel: {
    fontSize: 15,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  button: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
});
