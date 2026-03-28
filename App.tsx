import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { theme } from './lib/theme';
import { decideOnboardingGate } from './lib/onboardingGate';
import { OnboardingGateContext } from './lib/OnboardingGateContext';
import OnboardingScreen from './screens/OnboardingScreen';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabase';
import HomeScreen from './screens/HomeScreen';
import LoginScreen from './screens/LoginScreen';
import ServiciosScreen from './screens/ServiciosScreen';
import ReglamentoScreen from './screens/ReglamentoScreen';
import NuevaSolicitudScreen from './screens/NuevaSolicitudScreen';
import ReportarScreen from './screens/ReportarScreen';
import TiendaScreen from './screens/TiendaScreen';
import AcademiaScreen from './screens/AcademiaScreen';
import PerfilScreen from './screens/PerfilScreen';
import TurnosScreen from './screens/TurnosScreen';
import ChecklistsScreen from './screens/ChecklistsScreen';
import ResolverChecklistScreen from './screens/ResolverChecklistScreen';
import PlanillaScreen from './screens/PlanillaScreen';
import SugerenciasScreen from './screens/SugerenciasScreen';
import HorasExtrasScreen from './screens/HorasExtrasScreen';
import AdminDashboardScreen from './screens/AdminDashboardScreen';
import MapaEmpleadosScreen from './screens/MapaEmpleadosScreen';
import ReporteHorasExtrasScreen from './screens/ReporteHorasExtrasScreen';
import ReportarIncidenciaScreen from './screens/ReportarIncidenciaScreen';
import CrearAnuncioScreen from './screens/CrearAnuncioScreen';
import MiEmpresaScreen from './screens/MiEmpresaScreen';
import type { MainTabParamList, RootStackParamList } from './types/navigation';
import { initSentryFromEnv } from './lib/sentryInit';

initSentryFromEnv();

type OnboardingGateState = 'loading' | 'onboarding' | 'app';

// ─── Pantallas (en este archivo por ahora) ───────────────────────────────────

// ─── Navegación ─────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Turnos: { active: 'calendar', inactive: 'calendar-outline' },
  Servicios: { active: 'apps', inactive: 'apps-outline' },
  Perfil: { active: 'person', inactive: 'person-outline' },
} as const;

// Booleanos estrictos para opciones de navegación (evitar string en Android)
const HEADER_SHOWN: boolean = false;
const TAB_BAR_SHOW_LABEL: boolean = true;

/** Aviso global si falla la carga de perfil/expediente (debe ir bajo SafeAreaProvider). */
function AuthRecordsBannerBar() {
  const insets = useSafeAreaInsets();
  const { recordsError, refresh } = useAuth();

  if (!recordsError) return null;

  return (
    <View
      style={[
        authBannerStyles.wrap,
        { paddingTop: Math.max(insets.top, 8), paddingLeft: 12 + insets.left, paddingRight: 12 + insets.right },
      ]}
    >
      <Text style={authBannerStyles.text}>{recordsError}</Text>
      <TouchableOpacity
        style={authBannerStyles.retryBtn}
        onPress={() => void refresh()}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Reintentar carga de perfil"
      >
        <Text style={authBannerStyles.retryLabel}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: HEADER_SHOWN,
        tabBarShowLabel: TAB_BAR_SHOW_LABEL,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarIcon: ({ focused }) => {
          const names = TAB_ICONS[route.name as keyof typeof TAB_ICONS];
          const icon = focused ? names.active : names.inactive;
          return (
            <Ionicons
              name={icon as keyof typeof Ionicons.glyphMap}
              size={24}
              color={focused ? theme.accent : theme.textMuted}
            />
          );
        },
        tabBarStyle: {
          backgroundColor: theme.primary,
          borderTopWidth: 0,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
            },
            android: { elevation: 8 },
          }),
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Inicio' }} />
      <Tab.Screen name="Turnos" component={TurnosScreen} options={{ title: 'Turnos' }} />
      <Tab.Screen
        name="Servicios"
        component={ServiciosScreen}
        options={{ title: 'Servicios' }}
      />
      <Tab.Screen name="Perfil" component={PerfilScreen} options={{ title: 'Perfil' }} />
    </Tab.Navigator>
  );
}

function AppInner() {
  const { session, isLoading, profile, employee } = useAuth();
  const [onboardingGate, setOnboardingGate] = useState<OnboardingGateState>('loading');

  const releaseToMainApp = useCallback(() => {
    setOnboardingGate('app');
  }, []);

  const onboardingGateValue = useMemo(
    () => ({ releaseToMainApp }),
    [releaseToMainApp]
  );

  useEffect(() => {
    let cancelled = false;

    async function evaluateOnboardingGate() {
      if (!session?.user?.id) {
        setOnboardingGate('loading');
        return;
      }

      // Evita decisión con profile/employee aún en carga (red lenta).
      if (isLoading) {
        setOnboardingGate('loading');
        return;
      }

      setOnboardingGate('loading');

      const companyId = employee?.company_id ?? null;
      const onboardingCompleted = Boolean(profile?.onboarding_completed);

      if (!companyId) {
        if (!cancelled) setOnboardingGate('app');
        return;
      }

      try {
        const { data: company, error: companyError } = await supabase
          .from('companies')
          .select('is_onboarding_enabled')
          .eq('id', companyId)
          .maybeSingle();

        if (cancelled) return;

        const onboardingEnabled =
          company && !companyError
            ? Boolean(
                (company as { is_onboarding_enabled?: boolean | null }).is_onboarding_enabled
              )
            : null;

        const next = decideOnboardingGate({
          hasSession: true,
          employeeCompanyId: companyId,
          onboardingCompleted,
          companyOnboardingEnabled: onboardingEnabled,
          companyFetchFailed: Boolean(companyError || !company),
        });

        setOnboardingGate(next);
      } catch {
        if (!cancelled) setOnboardingGate('app');
      }
    }

    evaluateOnboardingGate();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, isLoading, employee?.company_id, profile?.onboarding_completed]);

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <View style={authLoadingStyles.container}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={authLoadingStyles.text}>Cargando...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <LoginScreen />
      </SafeAreaProvider>
    );
  }

  if (onboardingGate === 'loading') {
    return (
      <SafeAreaProvider>
        <View style={authLoadingStyles.container}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={authLoadingStyles.text}>Preparando tu sesión...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (onboardingGate === 'onboarding') {
    return (
      <SafeAreaProvider>
        <AuthRecordsBannerBar />
        <OnboardingGateContext.Provider value={onboardingGateValue}>
          <OnboardingScreen />
        </OnboardingGateContext.Provider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthRecordsBannerBar />
      <OnboardingGateContext.Provider value={onboardingGateValue}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="MainTabs"
              component={MainTabs}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Reglamento"
              component={ReglamentoScreen}
              options={{ title: 'Reglamento Interno' }}
            />
            <Stack.Screen
              name="NuevaSolicitud"
              component={NuevaSolicitudScreen}
              options={{ title: 'Nueva Solicitud' }}
            />
            <Stack.Screen
              name="Reportar"
              component={ReportarScreen}
              options={{ title: 'Reportar Compañero' }}
            />
            <Stack.Screen
              name="Tienda"
              component={TiendaScreen}
              options={{ title: 'Tienda de Recompensas' }}
            />
            <Stack.Screen
              name="Academia"
              component={AcademiaScreen}
              options={{ title: 'Campus Virtual' }}
            />
            <Stack.Screen
              name="Checklists"
              component={ChecklistsScreen}
              options={{ title: 'Checklists Operativos' }}
            />
            <Stack.Screen
              name="ResolverChecklist"
              component={ResolverChecklistScreen}
              options={{ title: 'Completar Checklist' }}
            />
            <Stack.Screen
              name="Planilla"
              component={PlanillaScreen}
              options={{ title: 'Mi Planilla' }}
            />
            <Stack.Screen
              name="Sugerencias"
              component={SugerenciasScreen}
              options={{ title: 'Buzón de Sugerencias' }}
            />
            <Stack.Screen
              name="HorasExtras"
              component={HorasExtrasScreen}
              options={{ title: 'Mis Horas Extras' }}
            />
            <Stack.Screen
              name="AdminDashboard"
              component={AdminDashboardScreen}
              options={{ title: 'Centro de Mando' }}
            />
            <Stack.Screen
              name="MapaEmpleados"
              component={MapaEmpleadosScreen}
              options={{ title: 'Radar GPS en Vivo' }}
            />
            <Stack.Screen
              name="ReporteHorasExtras"
              component={ReporteHorasExtrasScreen}
              options={{ title: 'Reporte de Horas Extras' }}
            />
            <Stack.Screen
              name="ReportarIncidencia"
              component={ReportarIncidenciaScreen}
              options={{ title: 'Reportar Incidencia / Mérito' }}
            />
            <Stack.Screen
              name="CrearAnuncio"
              component={CrearAnuncioScreen}
              options={{ title: 'Publicar Noticia' }}
            />
            <Stack.Screen
              name="MiEmpresa"
              component={MiEmpresaScreen}
              options={{ title: 'Mi Empresa' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        </View>
      </OnboardingGateContext.Provider>
    </SafeAreaProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

export default Sentry.wrap(App);

// ─── Estilos (carga de auth) ─────────────────────────────────────────────────

const authLoadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: {
    fontSize: 16,
    color: theme.textSecondary,
  },
});

const authBannerStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    paddingRight: 12,
    backgroundColor: '#FEF3C7',
    borderBottomWidth: 1,
    borderBottomColor: '#F59E0B',
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    fontWeight: '600',
  },
  retryBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: theme.primary,
    borderRadius: 8,
  },
  retryLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

// ─── Estilos de pantallas ───────────────────────────────────────────────────

const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  plainTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#64748b',
  },
});
