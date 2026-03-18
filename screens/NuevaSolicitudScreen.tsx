import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

type LeaveType = 'Vacaciones' | 'Permiso por Enfermedad' | 'Asunto Personal';

function mapLeaveTypeToRequestType(type: LeaveType): 'vacation' | 'permission' | 'sick_leave' {
  switch (type) {
    case 'Vacaciones':
      return 'vacation';
    case 'Permiso por Enfermedad':
      return 'sick_leave';
    case 'Asunto Personal':
    default:
      return 'permission';
  }
}

export default function NuevaSolicitudScreen() {
  const navigation = useNavigation<any>();

  const [selectedType, setSelectedType] = useState<LeaveType>('Vacaciones');
  const [startDateIso, setStartDateIso] = useState<string>('');
  const [endDateIso, setEndDateIso] = useState<string>('');
  const [startDateDisplay, setStartDateDisplay] = useState<string>('');
  const [endDateDisplay, setEndDateDisplay] = useState<string>('');
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatDisplayDate = (date: Date) =>
    date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

  const onChangeStartDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowStartDatePicker(false);
    }
    if (date) {
      const iso = date.toISOString().slice(0, 10);
      setStartDateIso(iso);
      setStartDateDisplay(formatDisplayDate(date));
    }
  };

  const onChangeEndDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
    }
    if (date) {
      const iso = date.toISOString().slice(0, 10);
      setEndDateIso(iso);
      setEndDateDisplay(formatDisplayDate(date));
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    if (!startDateIso || !endDateIso || !reason.trim()) {
      Alert.alert('Campos requeridos', 'Por favor completa las fechas y el motivo.');
      return;
    }

    try {
      setIsSubmitting(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const userId = userData.user?.id;
      if (!userId) {
        Alert.alert('Sesión inválida', 'No se pudo obtener la sesión del usuario.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', userId)
        .single();

      if (profileError) throw profileError;

      const companyId = (profile as any)?.company_id ?? null;
      if (!companyId) {
        Alert.alert(
          'Perfil incompleto',
          'No se encontró una empresa asociada a tu perfil. Contacta a RRHH.'
        );
        return;
      }

      const payload = {
        company_id: companyId,
        employee_id: userId,
        request_type: mapLeaveTypeToRequestType(selectedType),
        start_date: startDateIso,
        end_date: endDateIso,
        reason: reason.trim(),
        status: 'pendiente',
      };

      const { error: insertError } = await supabase.from('employee_requests').insert(payload);
      if (insertError) throw insertError;

      Alert.alert('Éxito', 'Tu solicitud fue enviada a RRHH');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Error', error?.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderTypeButton = (type: LeaveType) => {
    const isActive = selectedType === type;
    return (
      <TouchableOpacity
        key={type}
        style={[styles.typeButton, isActive && styles.typeButtonActive]}
        activeOpacity={0.85}
        onPress={() => setSelectedType(type)}
      >
        <Text style={[styles.typeButtonText, isActive && styles.typeButtonTextActive]}>
          {type}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Nueva Solicitud</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Tipo de solicitud</Text>
          <View style={styles.typesRow}>
            {renderTypeButton('Vacaciones')}
            {renderTypeButton('Permiso por Enfermedad')}
            {renderTypeButton('Asunto Personal')}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Fecha de inicio</Text>
          <TouchableOpacity
            style={styles.dateButton}
            activeOpacity={0.85}
            onPress={() => setShowStartDatePicker(true)}
          >
            <Text style={styles.dateButtonText}>
              {startDateDisplay || 'Seleccionar Fecha de Inicio'}
            </Text>
          </TouchableOpacity>
          {showStartDatePicker && (
            <DateTimePicker
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              value={startDateIso ? new Date(startDateIso) : new Date()}
              onChange={onChangeStartDate}
            />
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Fecha de fin</Text>
          <TouchableOpacity
            style={styles.dateButton}
            activeOpacity={0.85}
            onPress={() => setShowEndDatePicker(true)}
          >
            <Text style={styles.dateButtonText}>
              {endDateDisplay || 'Seleccionar Fecha de Fin'}
            </Text>
          </TouchableOpacity>
          {showEndDatePicker && (
            <DateTimePicker
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              value={endDateIso ? new Date(endDateIso) : new Date()}
              onChange={onChangeEndDate}
            />
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Motivo / Comentarios</Text>
          <TextInput
            style={styles.textarea}
            placeholder="Describe brevemente el motivo de tu solicitud..."
            placeholderTextColor={theme.textMuted}
            value={reason}
            onChangeText={setReason}
            multiline
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          activeOpacity={0.9}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={theme.backgroundAlt} />
          ) : (
            <Text style={styles.submitButtonText}>Enviar Solicitud al Supervisor</Text>
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
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  typesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.backgroundAlt,
  },
  typeButtonActive: {
    backgroundColor: theme.background,
    borderColor: theme.accent,
  },
  typeButtonText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  typeButtonTextActive: {
    color: theme.accent,
  },
  input: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.textPrimary,
  },
  textarea: {
    minHeight: 100,
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.textPrimary,
  },
  dateButton: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  dateButtonText: {
    fontSize: 14,
    color: theme.textPrimary,
  },
  submitButton: {
    marginTop: 24,
    backgroundColor: theme.accent,
    borderRadius: 999,
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
      android: {
        elevation: 3,
      },
    }),
  },
  submitButtonDisabled: {
    opacity: 0.8,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.backgroundAlt,
    textAlign: 'center',
  },
});

