import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform, Alert } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { MAP_REGION_WORLD_OVERVIEW, resolveAdminMapInitialRegion } from '../lib/mapInitialRegion';
import { useAuth } from '../lib/AuthContext';

type Profile = { first_name?: string | null; last_name?: string | null } | null;

type TimeEntryRow = {
  id: string;
  employee_id: string;
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

function parseCoords(telemetry: TimeEntryRow['telemetry']): { lat: number; lon: number } | null {
  if (!telemetry) return null;
  const gps = telemetry.gps;
  if (gps != null && typeof gps.lat === 'number' && typeof gps.lon === 'number') {
    return { lat: gps.lat, lon: gps.lon };
  }
  const ext = telemetry as Record<string, unknown>;
  const latRaw = ext.latitude ?? ext.lat;
  const lonRaw = ext.longitude ?? ext.lon ?? ext.lng;
  const lat = typeof latRaw === 'number' ? latRaw : undefined;
  const lon = typeof lonRaw === 'number' ? lonRaw : undefined;
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
  const [initialMapRegion, setInitialMapRegion] = useState(MAP_REGION_WORLD_OVERVIEW);
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setIsLoading(true);
        setUnauthorized(false);

        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) {
            setEmployees([]);
            setInitialMapRegion(MAP_REGION_WORLD_OVERVIEW);
          }
          return;
        }

        const companyId = employee?.company_id ?? null;
        const role = String(profile?.role ?? '').toLowerCase();
        const allowed = role === 'admin' || role === 'manager' || role === 'superadmin';
        if (!allowed) {
          if (isMounted) {
            setUnauthorized(true);
            setEmployees([]);
            setInitialMapRegion(MAP_REGION_WORLD_OVERVIEW);
          }
          return;
        }
        if (!companyId) {
          if (isMounted) {
            setEmployees([]);
            setInitialMapRegion(MAP_REGION_WORLD_OVERVIEW);
          }
          return;
        }

        const branchId = employee?.branch_id ?? null;
        let branchRow: Record<string, unknown> | null = null;
        if (branchId) {
          const { data: brData, error: brErr } = await supabase
            .from('branches')
            .select('*')
            .eq('id', branchId)
            .eq('company_id', companyId)
            .maybeSingle();
          if (!brErr && brData) {
            branchRow = brData as Record<string, unknown>;
          }
        }

        const nextRegion = await resolveAdminMapInitialRegion(branchRow);
        if (isMounted) setInitialMapRegion(nextRegion);

        // CRÍTICO: scope estricto por company_id del visor (solo su empresa)
        const { data, error } = await supabase
          .from('time_entries')
          .select('id, employee_id, clock_in, telemetry')
          .eq('company_id', companyId)
          .is('clock_out', null);

        if (error) throw error;

        const rows = (data ?? []) as TimeEntryRow[];
        const list: ActiveEmployee[] = [];

        const ids = rows.map((r) => r.employee_id).filter(Boolean);
        let empRows: { id?: string; first_name?: string | null; last_name?: string | null }[] = [];
        if (ids.length > 0) {
          const { data, error: empNameErr } = await supabase
            .from('employees')
            .select('id, first_name, last_name')
            .eq('company_id', companyId)
            .in('id', ids);
          if (empNameErr) throw empNameErr;
          empRows = (data ?? []) as typeof empRows;
        }
        const nameById = new Map<string, string>();
        for (const r of empRows) {
          const id = String(r?.id ?? '');
          const name =
            [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'Empleado';
          if (id) nameById.set(id, name);
        }

        for (const row of rows) {
          const coords = parseCoords(row.telemetry);
          if (!coords) continue;

          const name = nameById.get(String(row.employee_id)) ?? 'Empleado';

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
          setInitialMapRegion(MAP_REGION_WORLD_OVERVIEW);
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
  }, [session?.user?.id, profile?.role, employee?.company_id, employee?.branch_id]);

  useEffect(() => {
    if (employees.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      employees.map((e) => ({ latitude: e.latitude, longitude: e.longitude })),
      { edgePadding: { top: 72, right: 48, bottom: 72, left: 48 }, animated: true }
    );
  }, [employees]);

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
        ref={mapRef}
        style={styles.map}
        initialRegion={initialMapRegion}
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
