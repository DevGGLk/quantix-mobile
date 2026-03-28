/**
 * UI del buzón “Reportar compañero” (empleado).
 * Las etiquetas son copia de producto en español; el envío a BD usa `disciplinary_records.type`
 * (mismo contrato que {@link ./disciplinaryAdminTypes.ts}).
 */
export const EMPLOYEE_INCIDENT_UI_OPTIONS = [
  { id: 'Conducta Inapropiada' as const, label: 'Conducta Inapropiada' },
  { id: 'Llegada Tardía' as const, label: 'Llegada Tardía' },
  { id: 'Problema de Seguridad' as const, label: 'Problema de Seguridad' },
  { id: 'Otro' as const, label: 'Otro' },
] as const;

export type EmployeeIncidentUiId = (typeof EMPLOYEE_INCIDENT_UI_OPTIONS)[number]['id'];

export type DisciplinaryRecordType = 'falta' | 'merito' | 'amonestacion';

/** Mapeo a `disciplinary_records.type` (check constraint en PostgreSQL). */
export function mapEmployeeIncidentToDisciplinaryType(
  uiId: EmployeeIncidentUiId
): DisciplinaryRecordType {
  switch (uiId) {
    case 'Llegada Tardía':
      return 'falta';
    case 'Conducta Inapropiada':
      return 'amonestacion';
    case 'Problema de Seguridad':
    case 'Otro':
    default:
      return 'falta';
  }
}

export const EMPLOYEE_REPORT_SEVERITY_OPTIONS = [
  { id: 'leve' as const, label: 'Leve' },
  { id: 'moderada' as const, label: 'Moderada' },
  { id: 'grave' as const, label: 'Grave' },
] as const;

export type EmployeeReportSeverityId = (typeof EMPLOYEE_REPORT_SEVERITY_OPTIONS)[number]['id'];
