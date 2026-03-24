import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './lib/supabase';
import { theme } from './lib/theme';
import { OnboardingGateContext } from './lib/OnboardingGateContext';
import OnboardingScreen from './screens/OnboardingScreen';
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

type OnboardingGateState = 'loading' | 'onboarding' | 'app';

// ─── Pantallas (en este archivo por ahora) ───────────────────────────────────

// ─── Navegación ─────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Turnos: { active: 'calendar', inactive: 'calendar-outline' },
  Servicios: { active: 'apps', inactive: 'apps-outline' },
  Perfil: { active: 'person', inactive: 'person-outline' },
} as const;

// Booleanos estrictos para opciones de navegación (evitar string en Android)
const HEADER_SHOWN: boolean = false;
const TAB_BAR_SHOW_LABEL: boolean = true;

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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [onboardingGate, setOnboardingGate] = useState<OnboardingGateState>('loading');

  const releaseToMainApp = useCallback(() => {
    setOnboardingGate('app');
  }, []);

  const onboardingGateValue = useMemo(
    () => ({ releaseToMainApp }),
    [releaseToMainApp]
  );

  useEffect(() => {
    let isMounted = true;
    supabase.auth
      .getSession()
      .then(({ data: { session: current } }) => {
        if (!isMounted) return;
        setSession(current ?? null);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsSessionLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function evaluateOnboardingGate() {
      if (!session?.user?.id) {
        setOnboardingGate('loading');
        return;
      }

      setOnboardingGate('loading');

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('onboarding_completed, company_id')
          .eq('id', session.user.id)
          .maybeSingle();

        if (cancelled) return;

        if (profileError || !profile) {
          setOnboardingGate('app');
          return;
        }

        const companyId = (profile as { company_id?: string | null }).company_id ?? null;
        const onboardingCompleted = Boolean(
          (profile as { onboarding_completed?: boolean | null }).onboarding_completed
        );

        if (!companyId) {
          setOnboardingGate('app');
          return;
        }

        const { data: company, error: companyError } = await supabase
          .from('companies')
          .select('is_onboarding_enabled')
          .eq('id', companyId)
          .maybeSingle();

        if (cancelled) return;

        if (companyError || !company) {
          setOnboardingGate('app');
          return;
        }

        const onboardingEnabled = Boolean(
          (company as { is_onboarding_enabled?: boolean | null }).is_onboarding_enabled
        );

        if (onboardingEnabled && !onboardingCompleted) {
          setOnboardingGate('onboarding');
        } else {
          setOnboardingGate('app');
        }
      } catch {
        if (!cancelled) setOnboardingGate('app');
      }
    }

    evaluateOnboardingGate();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  if (isSessionLoading) {
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
        <OnboardingGateContext.Provider value={onboardingGateValue}>
          <OnboardingScreen />
        </OnboardingGateContext.Provider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <OnboardingGateContext.Provider value={onboardingGateValue}>
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
              options={{ title: 'Centro de Mando GGL' }}
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
      </OnboardingGateContext.Provider>
    </SafeAreaProvider>
  );
}

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
