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
  Switch,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { RootStackNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

/** Inserciones de ausencias: solo `time_off_requests` (no `employee_requests` legacy / RLS). */
const SOLICITUDES_AUSENCIA_TABLA = 'time_off_requests' as const;

type LeaveType = 'Vacaciones' | 'Permiso con goce' | 'Permiso sin goce' | 'Enfermedad (INSS)' | 'Justificar tardanza';

/**
 * Valores alineados con la columna `time_off_requests.request_type` (CHECK en Supabase).
 * Auditoría 12/11/2026: «Asunto personal» siempre era sin goce (descuenta salario, aguinaldo y
 * vacaciones) y no había permiso con goce ni forma de justificar una tardanza.
 */
function mapLeaveTypeToRequestType(type: LeaveType): string {
  switch (type) {
    case 'Vacaciones':
      return 'Vacaciones';
    case 'Permiso con goce':
      return 'Permiso con goce de sueldo';
    case 'Enfermedad (INSS)':
      return 'Subsidio (INSS)';
    case 'Justificar tardanza':
      return 'Justificación de tardanza';
    case 'Permiso sin goce':
    default:
      return 'Permiso sin goce de sueldo';
  }
}

/** Fecha local YYYY-MM-DD. `toISOString()` es UTC: después de las 18:00 en Managua daba el día siguiente. */
function ymdLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseHora(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function diasCalendarioInclusivos(startIso: string, endIso: string): number {
  const a = new Date(`${startIso}T12:00:00`);
  const b = new Date(`${endIso}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff + 1);
}

function normalizeCompanyId(
  authProfile: { company_id?: string | null } | null,
  employeeRecord: { company_id?: string | null } | null
): string | null {
  const a = authProfile?.company_id != null ? String(authProfile.company_id).trim() : '';
  const b = employeeRecord?.company_id != null ? String(employeeRecord.company_id).trim() : '';
  return (b || a || '') || null;
}

export default function NuevaSolicitudScreen() {
  const { session, employee: employeeRecord, profile: authProfile } = useAuth();
  const navigation = useNavigation<RootStackNavigation>();
  const headerHeight = useHeaderHeight();

  const [consentimientoLegal, setConsentimientoLegal] = useState(false);
  const [selectedType, setSelectedType] = useState<LeaveType>('Vacaciones');
  const [startDateIso, setStartDateIso] = useState<string>('');
  const [endDateIso, setEndDateIso] = useState<string>('');
  const [startDateDisplay, setStartDateDisplay] = useState<string>('');
  const [endDateDisplay, setEndDateDisplay] = useState<string>('');
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [reason, setReason] = useState('');
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin, setHoraFin] = useState('');
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
      const iso = ymdLocal(date);
      setStartDateIso(iso);
      setStartDateDisplay(formatDisplayDate(date));
    }
  };

  const onChangeEndDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
    }
    if (date) {
      const iso = ymdLocal(date);
      setEndDateIso(iso);
      setEndDateDisplay(formatDisplayDate(date));
    }
  };

  // La declaración del séptimo día solo aplica a lo que se descuenta.
  const requiereConsentimientoSeptimo = selectedType === 'Permiso sin goce';
  const esPermiso = selectedType === 'Permiso con goce' || selectedType === 'Permiso sin goce';
  const unSoloDia = !!startDateIso && startDateIso === endDateIso;
  const envioBloqueadoPorConsentimiento = requiereConsentimientoSeptimo && !consentimientoLegal;

  const handleSubmit = async () => {
    if (isSubmitting) return;

    if (envioBloqueadoPorConsentimiento) {
      Alert.alert(
        'Consentimiento requerido',
        'Debes aceptar la declaración sobre el séptimo día para enviar este tipo de solicitud.'
      );
      return;
    }

    if (!startDateIso || !endDateIso || !reason.trim()) {
      Alert.alert('Campos requeridos', 'Por favor completa las fechas y el motivo.');
      return;
    }

    try {
      setIsSubmitting(true);

      if (!session?.user) {
        Alert.alert('Sesión inválida', 'No se pudo obtener la sesión del usuario.');
        return;
      }

      const employeeRowId = employeeRecord?.id != null ? String(employeeRecord.id).trim() : '';
      if (!employeeRowId) {
        Alert.alert(
          'Perfil incompleto',
          'No se encontró expediente asociado. Contacta a RRHH.'
        );
        return;
      }

      const company_id = normalizeCompanyId(authProfile, employeeRecord);
      if (!company_id) {
        Alert.alert(
          'Perfil incompleto',
          'No se encontró empresa (expediente ni perfil). Contacta a RRHH.'
        );
        return;
      }

      let daysDeducted = diasCalendarioInclusivos(startDateIso, endDateIso);
      if (daysDeducted <= 0) {
        Alert.alert('Fechas inválidas', 'La fecha de fin debe ser igual o posterior a la de inicio.');
        return;
      }
      // Permiso por horas (un solo día, menos de 8 h): cuenta como fracción del día y el turno se
      // conserva; la planilla descuenta solo esa fracción si es sin goce.
      let hora_inicio: string | null = null;
      let hora_fin: string | null = null;
      if (esPermiso && unSoloDia && (horaInicio.trim() || horaFin.trim())) {
        const a = parseHora(horaInicio);
        const b = parseHora(horaFin);
        if (a == null || b == null || b <= a) {
          Alert.alert('Horas inválidas', 'Escribe la hora de inicio y fin como HH:MM (por ejemplo 08:00 y 10:30).');
          return;
        }
        const horas = (b - a) / 60;
        if (horas < 8) {
          daysDeducted = Math.round((horas / 8) * 100) / 100;
          hora_inicio = horaInicio.trim().padStart(5, '0');
          hora_fin = horaFin.trim().padStart(5, '0');
        }
      }
      if (selectedType === 'Justificar tardanza') {
        if (!unSoloDia) {
          Alert.alert('Un solo día', 'La justificación de tardanza es de un solo día.');
          return;
        }
        daysDeducted = 0;
      }

      const tipoAusencia = mapLeaveTypeToRequestType(selectedType);
      const payload = {
        company_id,
        employee_id: employeeRowId,
        request_type: tipoAusencia,
        start_date: startDateIso,
        end_date: endDateIso,
        days_deducted: daysDeducted,
        hora_inicio,
        hora_fin,
        notes: reason.trim(),
        status: 'pendiente',
      };

      const { error: insertError } = await supabase.from(SOLICITUDES_AUSENCIA_TABLA).insert(payload);
      if (insertError) throw insertError;

      Alert.alert('Éxito', 'Tu solicitud fue enviada a RRHH');
      navigation.goBack();
    } catch (error: unknown) {
      Alert.alert('Error', errorMessage(error));
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
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : headerHeight}
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
            {renderTypeButton('Permiso con goce')}
            {renderTypeButton('Permiso sin goce')}
            {renderTypeButton('Enfermedad (INSS)')}
            {renderTypeButton('Justificar tardanza')}
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

        {esPermiso && unSoloDia ? (
          <View style={styles.section}>
            <Text style={styles.label}>¿Solo unas horas? (opcional)</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TextInput
                style={[styles.dateButton, { flex: 1 }]}
                placeholder="Desde 08:00"
                placeholderTextColor={theme.textMuted}
                value={horaInicio}
                onChangeText={setHoraInicio}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[styles.dateButton, { flex: 1 }]}
                placeholder="Hasta 10:00"
                placeholderTextColor={theme.textMuted}
                value={horaFin}
                onChangeText={setHoraFin}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
        ) : null}

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

        {requiereConsentimientoSeptimo && (
          <View style={styles.consentRow}>
            <Switch
              value={consentimientoLegal}
              onValueChange={setConsentimientoLegal}
              trackColor={{ false: theme.border, true: `${theme.primary}99` }}
              thumbColor={consentimientoLegal ? theme.primary : theme.textMuted}
            />
            <Text style={styles.consentText}>
              Entiendo que toda ausencia injustificada o permiso personal sin goce de salario repercutirá en la
              pérdida del séptimo día (día de descanso remunerado) en la quincena correspondiente, según lo
              establecido por el Código del Trabajo.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.submitButton,
            (isSubmitting || envioBloqueadoPorConsentimiento) && styles.submitButtonDisabled,
          ]}
          activeOpacity={0.9}
          onPress={handleSubmit}
          disabled={isSubmitting || envioBloqueadoPorConsentimiento}
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
    borderColor: theme.primary,
  },
  typeButtonText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  typeButtonTextActive: {
    color: theme.primary,
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
    backgroundColor: theme.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.primary,
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
    opacity: 0.45,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  consentText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: theme.textSecondary,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.backgroundAlt,
    textAlign: 'center',
  },
});

