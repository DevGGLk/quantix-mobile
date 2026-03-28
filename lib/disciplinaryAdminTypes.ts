/**
 * Valores de `disciplinary_records.type` expuestos en UI admin.
 * Mantener alineado con el check constraint / enum en PostgreSQL.
 *
 * Flujo empleado (etiquetas ES → mismo campo): `disciplinaryEmployeeReport.ts`.
 */
export const DISCIPLINARY_ADMIN_INCIDENT_TYPES = [
  { id: 'falta' as const, label: 'Falta' },
  { id: 'merito' as const, label: 'Mérito' },
  { id: 'amonestacion' as const, label: 'Amonestación' },
] as const;

export type DisciplinaryAdminIncidentTypeId =
  (typeof DISCIPLINARY_ADMIN_INCIDENT_TYPES)[number]['id'];
