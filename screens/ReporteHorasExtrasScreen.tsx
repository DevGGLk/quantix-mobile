import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

export default function ReporteHorasExtrasScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session, employee } = useAuth();

  const [fecha, setFecha] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [horas, setHoras] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGuardar = async () => {
    const horasNum = parseFloat(horas.replace(',', '.'));
    if (!fecha.trim()) {
      Alert.alert('Campo requerido', 'Indica la fecha.');
      return;
    }
    if (Number.isNaN(horasNum) || horasNum <= 0) {
      Alert.alert('Campo requerido', 'Indica una cantidad de horas válida.');
      return;
    }
    if (!justificacion.trim()) {
      Alert.alert('Campo requerido', 'Escribe una breve justificación.');
      return;
    }

    try {
      setIsSubmitting(true);

      const employeeId = session?.user?.id ?? null;
      if (!employeeId) {
        Alert.alert('Error', 'No se pudo obtener tu sesión.');
        return;
      }

      const companyId = employee?.company_id ?? null;
      if (!companyId) {
        Alert.alert('Error', 'No se pudo identificar tu empresa.');
        return;
      }

      const payload = {
        employee_id: employeeId,
        company_id: companyId,
        record_date: fecha,
        hours_performed: horasNum,
        justification: justificacion.trim(),
        status: 'pending',
      };

      const { error } = await supabase.from('extra_hours_records').insert(payload);
      if (error) throw error;

      Alert.alert('Enviado', 'Tu reporte de horas extras ha sido registrado y está pendiente de aprobación.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      console.error('Error al guardar reporte horas extras:', e);
      Alert.alert('Error', e?.message ?? 'No se pudo guardar el reporte.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <Text style={styles.title}>Reporte de Horas Extras</Text>
        <Text style={styles.subtitle}>Solicita el registro de horas extras para aprobación.</Text>

        <Text style={styles.label}>Fecha</Text>
        <TextInput
          style={styles.input}
          value={fecha}
          onChangeText={setFecha}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.textMuted}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>Cantidad de horas</Text>
        <TextInput
          style={styles.input}
          value={horas}
          onChangeText={setHoras}
          placeholder="Ej: 2.5"
          placeholderTextColor={theme.textMuted}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Justificación</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={justificacion}
          onChangeText={setJustificacion}
          placeholder="Breve descripción del motivo..."
          placeholderTextColor={theme.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleGuardar}
          disabled={isSubmitting}
          activeOpacity={0.9}
        >
          {isSubmitting ? (
            <ActivityIndicator color={theme.backgroundAlt} />
          ) : (
            <Text style={styles.buttonText}>Enviar reporte</Text>
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
    padding: 24,
    paddingBottom: 48,
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
    minHeight: 100,
    paddingTop: 12,
  },
  button: {
    backgroundColor: theme.warning,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
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
