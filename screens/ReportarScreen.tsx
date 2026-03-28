import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../types/navigation';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';
import {
  EMPLOYEE_INCIDENT_UI_OPTIONS,
  EMPLOYEE_REPORT_SEVERITY_OPTIONS,
  mapEmployeeIncidentToDisciplinaryType,
  type EmployeeIncidentUiId,
  type EmployeeReportSeverityId,
} from '../lib/disciplinaryEmployeeReport';

type EmployeeCollaboratorRow = {
  id?: unknown;
  user_id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
};

type ProfileRoleRow = {
  id?: unknown;
  role?: unknown;
};

interface Collaborator {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
}

export default function ReportarScreen() {
  const navigation = useNavigation<RootStackNavigation>();
  const { session, employee } = useAuth();

  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoadingCollabs, setIsLoadingCollabs] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const [incidentType, setIncidentType] = useState<EmployeeIncidentUiId>(
    EMPLOYEE_INCIDENT_UI_OPTIONS[0].id
  );
  const [severity, setSeverity] = useState<EmployeeReportSeverityId>('leve');
  const [details, setDetails] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [currentEmployeeId, setCurrentEmployeeId] = useState<string | null>(null);
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCollaborators() {
      try {
        setIsLoadingCollabs(true);

        const viewerUserId = session?.user?.id ?? null;
        if (!viewerUserId) {
          if (isMounted) {
            setCollaborators([]);
            setCurrentEmployeeId(null);
            setCurrentCompanyId(null);
          }
          return;
        }

        const companyId = employee?.company_id ?? null;
        if (!companyId) {
          if (isMounted) {
            setCollaborators([]);
            setCurrentEmployeeId(viewerUserId);
            setCurrentCompanyId(null);
          }
          return;
        }

        const { data: empRows, error: empErr } = await supabase
          .from('employees')
          .select('id, user_id, first_name, last_name')
          .eq('company_id', companyId)
          .neq('user_id', viewerUserId);

        if (empErr) throw empErr;

        const empList = (empRows ?? []) as EmployeeCollaboratorRow[];
        const profileIds = empList
          .map((r) => r.user_id)
          .filter((x): x is string => typeof x === 'string' && x.length > 0);

        const rolesByUserId = new Map<string, string | null>();
        if (profileIds.length) {
          const { data: profRows, error: profErr } = await supabase
            .from('profiles')
            .select('id, role')
            .in('id', profileIds);
          if (!profErr) {
            for (const r of (profRows ?? []) as ProfileRoleRow[]) {
              const id = typeof r.id === 'string' ? r.id : '';
              if (id) {
                const role = typeof r.role === 'string' ? r.role : null;
                rolesByUserId.set(id, role);
              }
            }
          } else {
            console.warn('ReportarScreen roles:', profErr.message);
            if (isMounted) {
              Alert.alert(
                'Aviso',
                'Se cargó el listado de compañeros, pero no pudimos obtener sus cargos (conexión o permisos). Puedes continuar con el reporte.'
              );
            }
          }
        }

        const list: Collaborator[] = empList.map((r) => {
          const rowId = typeof r.id === 'string' ? r.id : String(r.id ?? '');
          const uid = typeof r.user_id === 'string' ? r.user_id : String(r.user_id ?? '');
          return {
            id: rowId,
            first_name: typeof r.first_name === 'string' ? r.first_name : null,
            last_name: typeof r.last_name === 'string' ? r.last_name : null,
            role: rolesByUserId.get(uid) ?? null,
          };
        });

        if (isMounted) {
          setCurrentEmployeeId(viewerUserId);
          setCurrentCompanyId(companyId);
          setCollaborators(list);
        }
      } catch (_e) {
        if (isMounted) {
          setCollaborators([]);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoadingCollabs(false);
      }
    }

    loadCollaborators();

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, employee?.company_id]);

  const handleSubmit = async () => {
    if (isSubmitting) return;

    if (!selectedEmployeeId) {
      Alert.alert('Selecciona un compañero', 'Debes elegir a quién deseas reportar.');
      return;
    }

    if (!details.trim()) {
      Alert.alert('Detalles requeridos', 'Por favor describe lo que ocurrió.');
      return;
    }

    if (!currentCompanyId) {
      Alert.alert(
        'Perfil incompleto',
        'No se encontró una empresa asociada a tu perfil. Contacta a RRHH.'
      );
      return;
    }

    try {
      setIsSubmitting(true);

      const date = new Date().toISOString();
      const payload = {
        company_id: currentCompanyId,
        employee_id: selectedEmployeeId,
        severity,
        reason: details.trim(),
        date,
        type: mapEmployeeIncidentToDisciplinaryType(incidentType),
      };

      if (!currentEmployeeId) {
        Alert.alert('Sesión inválida', 'No se pudo identificar al usuario que reporta.');
        return;
      }

      const { error: insertError } = await supabase
        .from('disciplinary_records')
        .insert(payload);
      if (insertError) throw insertError;

      Alert.alert(
        'Reporte enviado',
        'Tu reporte confidencial ha sido enviado al equipo de RRHH.'
      );
      navigation.goBack();
    } catch (error: unknown) {
      Alert.alert('Error', errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderIncidentTypeButton = (type: EmployeeIncidentUiId, label: string) => {
    const isActive = incidentType === type;
    return (
      <TouchableOpacity
        key={type}
        style={[styles.typeButton, isActive && styles.typeButtonActive]}
        activeOpacity={0.85}
        onPress={() => setIncidentType(type)}
      >
        <Text style={[styles.typeButtonText, isActive && styles.typeButtonTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderSeverityButton = (value: EmployeeReportSeverityId, label: string) => {
    const isActive = severity === value;
    return (
      <TouchableOpacity
        key={value}
        style={[styles.typeButton, isActive && styles.typeButtonActive]}
        activeOpacity={0.85}
        onPress={() => setSeverity(value)}
      >
        <Text style={[styles.typeButtonText, isActive && styles.typeButtonTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderCollaboratorOption = (c: Collaborator) => {
    const fullName = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Empleado';
    const isActive = selectedEmployeeId === c.id;
    return (
      <TouchableOpacity
        key={c.id}
        style={[styles.collaboratorItem, isActive && styles.collaboratorItemActive]}
        activeOpacity={0.85}
        onPress={() => setSelectedEmployeeId(c.id)}
      >
        <Text style={[styles.collaboratorName, isActive && styles.collaboratorNameActive]}>
          {fullName}
        </Text>
        {!!c.role && <Text style={styles.collaboratorRole}>{c.role}</Text>}
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
        <Text style={styles.title}>Reportar Compañero</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Selecciona al compañero</Text>
          {isLoadingCollabs ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.loaderText}>Cargando colaboradores...</Text>
            </View>
          ) : collaborators.length === 0 ? (
            <Text style={styles.emptyText}>
              No se encontraron otros colaboradores en tu empresa.
            </Text>
          ) : (
            <View style={styles.collaboratorsList}>
              {collaborators.map(renderCollaboratorOption)}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Tipo de incidencia</Text>
          <View style={styles.typesRow}>
            {EMPLOYEE_INCIDENT_UI_OPTIONS.map((opt) =>
              renderIncidentTypeButton(opt.id, opt.label)
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Severidad</Text>
          <View style={styles.typesRow}>
            {EMPLOYEE_REPORT_SEVERITY_OPTIONS.map((opt) =>
              renderSeverityButton(opt.id, opt.label)
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Detalles del incidente</Text>
          <TextInput
            style={styles.textarea}
            multiline
            textAlignVertical="top"
            placeholder="Describe lo sucedido con la mayor claridad posible..."
            placeholderTextColor={theme.textMuted}
            value={details}
            onChangeText={setDetails}
          />
        </View>

        <View style={styles.sectionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>¿Deseas que este reporte sea anónimo?</Text>
            <Text style={styles.helperText}>
              Si activas esta opción, tu nombre no será visible en el reporte.
            </Text>
          </View>
          <Switch
            value={isAnonymous}
            onValueChange={setIsAnonymous}
            thumbColor={isAnonymous ? theme.danger : theme.backgroundAlt}
            trackColor={{ false: theme.border, true: theme.danger }}
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
            <Text style={styles.submitButtonText}>Enviar Reporte Confidencial</Text>
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  helperText: {
    fontSize: 12,
    color: theme.textMuted,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
  },
  collaboratorsList: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.backgroundAlt,
  },
  collaboratorItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  collaboratorItemActive: {
    backgroundColor: theme.background,
  },
  collaboratorName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
  },
  collaboratorNameActive: {
    color: theme.accent,
  },
  collaboratorRole: {
    marginTop: 2,
    fontSize: 12,
    color: theme.textSecondary,
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
    borderColor: theme.danger,
  },
  typeButtonText: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: '500',
  },
  typeButtonTextActive: {
    color: theme.danger,
  },
  textarea: {
    minHeight: 120,
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.textPrimary,
  },
  submitButton: {
    marginTop: 24,
    backgroundColor: theme.danger,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: theme.danger,
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

