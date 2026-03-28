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
  reward_points?: number | null;
};

export type MainTabParamList = {
  Home: undefined;
  Turnos: undefined;
  Servicios: undefined;
  Perfil: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  Reglamento: undefined;
  NuevaSolicitud: undefined;
  Reportar: undefined;
  Tienda: undefined;
  Academia: undefined;
  Checklists: undefined;
  ResolverChecklist: { checklist: ChecklistRouteParam };
  Planilla: undefined;
  Sugerencias: undefined;
  HorasExtras: undefined;
  AdminDashboard: undefined;
  MapaEmpleados: undefined;
  ReporteHorasExtras: undefined;
  ReportarIncidencia: undefined;
  CrearAnuncio: undefined;
  MiEmpresa: undefined;
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
