import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/**
 * Checklist enviado a ResolverChecklist (misma forma que en ChecklistsScreen / Supabase).
 */
export type ChecklistRouteParam = Record<string, unknown> & {
  id: string;
  title?: string | null;
  category?: string | null;
};

/** Solicitud de préstamo enviada al detalle (misma forma que LoanRequestRow de lib/loansApi). */
export type LoanRequestRouteParam = {
  id: string;
  employee_id: string;
  company_id: string;
  status: string;
  requested_principal: number;
  requested_term_periods: number;
  requested_period_type: string;
  reason: string;
  proposed_principal: number | null;
  proposed_term_periods: number | null;
  proposed_period_type: string | null;
  proposed_rate_snapshot: number | null;
  snapshot_rate_monthly: number;
  snapshot_rate_annual: number;
  decision_reason: string | null;
  expires_at: string | null;
  resulting_loan_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Préstamo activo enviado a RegistrarPago (misma forma que ActiveLoan de lib/loansApi). */
export type ActiveLoanRouteParam = {
  id: string;
  company_id: string;
  remaining_balance: number;
  principal_amount: number | null;
  total_amount: number;
  installment_amount: number;
  period_type: string | null;
  annual_interest_rate: number | null;
  status: string;
  start_date: string | null;
};

export type MainTabParamList = {
  Home: undefined;
  Turnos: undefined;
  Jay: undefined;
  Servicios: undefined;
  Perfil: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  Reglamento: undefined;
  MisActivos: undefined;
  NuevaSolicitud: undefined;
  Reportar: undefined;
  Academia: undefined;
  Checklists: undefined;
  ResolverChecklist: { checklist: ChecklistRouteParam };
  Planilla: undefined;
  MiDisciplina: undefined;
  Sugerencias: undefined;
  MisHoras: undefined;
  Vacaciones: undefined;
  AdminDashboard: undefined;
  MapaEmpleados: undefined;
  ReporteHorasExtras: undefined;
  ReportarIncidencia: undefined;
  CrearAnuncio: undefined;
  MiEmpresa: undefined;
  Prestamos: undefined;
  SolicitarPrestamo: undefined;
  PrestamoDetalle: { request: LoanRequestRouteParam };
  RegistrarPago: { loan: ActiveLoanRouteParam };
  MisPagos: undefined;
};

export type RootStackNavigation = NativeStackNavigationProp<RootStackParamList>;

/** Pantallas apiladas sobre el root (no son tabs). */
export type StackScreenNavigation<K extends keyof RootStackParamList = keyof RootStackParamList> =
  NativeStackNavigationProp<RootStackParamList, K>;

/** Pestañas inferiores con acceso al stack padre (p. ej. navigate a AdminDashboard). */
export type TabCompositeNavigation<T extends keyof MainTabParamList> = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, T>,
  NativeStackNavigationProp<RootStackParamList>
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
