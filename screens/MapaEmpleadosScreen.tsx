import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform, Alert } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type Profile = { first_name?: string | null; last_name?: string | null } | null;

type TimeEntryRow = {
  id: string;
  profile_id: string;
  clock_in: string;
  telemetry: {
    gps?: { lat?: number; lon?: number };
    latitude?: number;
    longitude?: number;
  } | null;
  profiles: Profile;
};

type ActiveEmployee = {
  id: string;
  name: string;
  clockIn: string;
  latitude: number;
  longitude: number;
};

const MATAGALPA_REGION = {
  latitude: 12.9256,
  longitude: -85.9189,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

function parseCoords(telemetry: TimeEntryRow['telemetry']): { lat: number; lon: number } | null {
  if (!telemetry) return null;
  const gps = telemetry.gps;
  if (gps != null && typeof gps.lat === 'number' && typeof gps.lon === 'number') {
    return { lat: gps.lat, lon: gps.lon };
  }
  const lat = (telemetry as any).latitude ?? (telemetry as any).lat;
  const lon = (telemetry as any).longitude ?? (telemetry as any).lon ?? (telemetry as any).lng;
  if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };
  return null;
}

function formatClockIn(clockIn: string): string {
  try {
    return new Date(clockIn).toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return clockIn;
  }
}

export default function MapaEmpleadosScreen() {
  const insets = useSafeAreaInsets();
  const { session, profile, employee } = useAuth();
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);
        setUnauthorized(false);

        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) setEmployees([]);
          return;
        }

        const companyId = employee?.company_id ?? null;
        const role = String(profile?.role ?? '').toLowerCase();
        const allowed = role === 'admin' || role === 'manager' || role === 'superadmin';
        if (!allowed) {
          if (isMounted) {
            setUnauthorized(true);
            setEmployees([]);
          }
          return;
        }
        if (!companyId) {
          if (isMounted) setEmployees([]);
          return;
        }

        // CRÍTICO: scope estricto por company_id del visor (solo su empresa)
        const { data, error } = await supabase
          .from('time_entries')
          .select('id, profile_id, clock_in, telemetry')
          .eq('company_id', companyId)
          .is('clock_out', null);

        if (error) throw error;

        const rows = (data ?? []) as TimeEntryRow[];
        const list: ActiveEmployee[] = [];

        const ids = rows.map((r) => r.profile_id).filter(Boolean);
        const { data: empRows } = await supabase
          .from('employees')
          .select('user_id, first_name, last_name')
          .eq('company_id', companyId)
          .in('user_id', ids);
        const nameById = new Map<string, string>();
        for (const r of (empRows ?? []) as any[]) {
          const id = String(r?.user_id ?? '');
          const name =
            [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'Empleado';
          if (id) nameById.set(id, name);
        }

        for (const row of rows) {
          const coords = parseCoords(row.telemetry);
          if (!coords) continue;

          const name = nameById.get(row.profile_id) ?? 'Empleado';

          list.push({
            id: row.id,
            name,
            clockIn: row.clock_in,
            latitude: coords.lat,
            longitude: coords.lon,
          });
        }

        if (isMounted) setEmployees(list);
      } catch (e) {
        console.error('Error al cargar empleados en turno:', e);
        if (isMounted) {
          setEmployees([]);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, profile?.role, employee?.company_id]);

  if (!isLoading && unauthorized) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.unauthorizedText}>No tienes permiso para ver el mapa de empleados.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <MapView
        style={styles.map}
        initialRegion={MATAGALPA_REGION}
        showsUserLocation={false}
        showsMyLocationButton={true}
      >
        {employees.map((emp) => (
          <Marker
            key={emp.id}
            coordinate={{ latitude: emp.latitude, longitude: emp.longitude }}
            title={emp.name}
            description={`Entrada: ${formatClockIn(emp.clockIn)}`}
          />
        ))}
      </MapView>

      {!isLoading && employees.length === 0 && (
        <View style={styles.emptyMapOverlay}>
          <Text style={styles.emptyMapText}>
            No hay empleados con turno activo o compartiendo ubicación en este momento.
          </Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loaderText}>Cargando empleados en turno...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  unauthorizedText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.textSecondary,
    textAlign: 'center',
  },
  map: {
    flex: 1,
    width: '100%',
    ...Platform.select({
      android: { height: '100%' },
    }),
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.primary,
    fontWeight: '600',
  },
  emptyMapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyMapText: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.textSecondary,
    textAlign: 'center',
  },
});
