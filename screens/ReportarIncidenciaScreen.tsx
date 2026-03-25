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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type ProfileOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

const TIPOS = [
  { id: 'falta', label: 'Falta' },
  { id: 'merito', label: 'Mérito' },
  { id: 'amonestacion', label: 'Amonestación' },
] as const;

export default function ReportarIncidenciaScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session, profile, employee } = useAuth();

  const [role, setRole] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<ProfileOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<ProfileOption | null>(null);
  const [tipo, setTipo] = useState<string>(TIPOS[0].id);
  const [descripcion, setDescripcion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) setRole(null);
          return;
        }

        const r = String(profile?.role ?? '').toLowerCase();
        const allowed = r === 'admin' || r === 'manager' || r === 'superadmin';
        if (!isMounted) return;
        setRole(allowed ? r : null);
        setCompanyId(employee?.company_id ?? null);

        if (!allowed) return;

        const { data: empData, error: empError } = await supabase
          .from('employees')
          .select('user_id, first_name, last_name')
          .eq('company_id', employee?.company_id ?? '')
          .order('last_name', { ascending: true });

        if (!empError && isMounted) {
          const opts: ProfileOption[] = (empData ?? []).map((r: any) => ({
            id: String(r?.user_id ?? ''),
            first_name: (r?.first_name as string | null) ?? null,
            last_name: (r?.last_name as string | null) ?? null,
          }));
          setEmployees(opts);
        }
      } catch (e) {
        if (isMounted) setRole(null);
      } finally {
        if (isMounted) setLoadingEmployees(false);
      }
    }

    checkAuth();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, profile?.role, employee?.company_id]);

  const handleGuardar = async () => {
    if (!selectedEmployee) {
      Alert.alert('Campo requerido', 'Selecciona un empleado.');
      return;
    }
    if (!descripcion.trim()) {
      Alert.alert('Campo requerido', 'Escribe una descripción.');
      return;
    }
    if (!companyId) {
      Alert.alert('Error', 'No se pudo identificar la empresa.');
      return;
    }

    try {
      setIsSubmitting(true);

      const reportedBy = session?.user?.id ?? null;
      if (!reportedBy) {
        Alert.alert('Error', 'No se pudo obtener tu sesión.');
        return;
      }

      const payload = {
        employee_id: selectedEmployee.id,
        company_id: companyId,
        record_type: tipo,
        description: descripcion.trim(),
        reported_by: reportedBy,
      };

      const { error } = await supabase.from('disciplinary_records').insert(payload);
      if (error) throw error;

      Alert.alert('Registrado', 'La incidencia/mérito ha sido registrado.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      console.error('Error al guardar incidencia:', e);
      Alert.alert('Error', e?.message ?? 'No se pudo guardar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingEmployees && !role) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Cargando...</Text>
      </View>
    );
  }

  if (role === null && !loadingEmployees) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.unauthorizedText}>No tienes permiso para acceder a esta pantalla.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const employeeName = (p: ProfileOption) =>
    [p.first_name, p.last_name].filter(Boolean).join(' ') || p.id;

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
        <Text style={styles.title}>Reportar Incidencia / Mérito</Text>

        <Text style={styles.label}>Empleado</Text>
        <View style={styles.employeeList}>
          {employees.map((emp) => (
            <TouchableOpacity
              key={emp.id}
              style={[
                styles.employeeChip,
                selectedEmployee?.id === emp.id && styles.employeeChipSelected,
              ]}
              onPress={() => setSelectedEmployee(emp)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.employeeChipText,
                  selectedEmployee?.id === emp.id && styles.employeeChipTextSelected,
                ]}
              >
                {employeeName(emp)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {employees.length === 0 && (
          <Text style={styles.hint}>No hay empleados en esta empresa.</Text>
        )}

        <Text style={styles.label}>Tipo</Text>
        <View style={styles.tipoRow}>
          {TIPOS.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.tipoBtn, tipo === t.id && styles.tipoBtnSelected]}
              onPress={() => setTipo(t.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tipoBtnText, tipo === t.id && styles.tipoBtnTextSelected]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Descripción</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={descripcion}
          onChangeText={setDescripcion}
          placeholder="Detalle del hecho..."
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
            <Text style={styles.buttonText}>Guardar</Text>
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
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 10,
  },
  employeeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  employeeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  employeeChipSelected: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  employeeChipText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  employeeChipTextSelected: {
    color: theme.backgroundAlt,
  },
  hint: {
    fontSize: 13,
    color: theme.textMuted,
    marginBottom: 16,
  },
  tipoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  tipoBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  tipoBtnSelected: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  tipoBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  tipoBtnTextSelected: {
    color: theme.backgroundAlt,
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
    marginBottom: 20,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  button: {
    backgroundColor: theme.accent,
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
