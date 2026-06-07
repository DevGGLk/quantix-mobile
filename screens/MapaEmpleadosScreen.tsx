import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Alert } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { MAP_REGION_WORLD_OVERVIEW, resolveAdminMapInitialRegion, type Region } from '../lib/mapInitialRegion';
import { useAuth } from '../lib/AuthContext';
import { useAdminScope } from '../lib/AdminScopeContext';
import AdminScopeSelector from '../components/AdminScopeSelector';

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
    return new Date(clockIn).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return clockIn;
  }
}

function zoomFromDelta(latitudeDelta: number): number {
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return 3;
  return Math.max(2, Math.min(16, Math.round(Math.log2(360 / latitudeDelta))));
}

/** HTML estático con Leaflet/OpenStreetMap (sin API key). Los marcadores se inyectan vía window.__render. */
const LEAFLET_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{height:100%;margin:0;padding:0;background:#aadaff;}</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map, layer;
  function post(m){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m); }
  function esc(s){ return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }
  function init(){
    if (typeof L === 'undefined'){ setTimeout(init, 80); return; }
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView([15, -25], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    post('ready');
  }
  window.__render = function(p){
    if (!map) return;
    layer.clearLayers();
    var pts = [];
    (p.markers || []).forEach(function(m){
      var mk = L.marker([m.lat, m.lng]).addTo(layer);
      mk.bindPopup('<b>' + esc(m.name) + '</b><br/>Entrada: ' + esc(m.clockIn));
      pts.push([m.lat, m.lng]);
    });
    if (pts.length === 1) { map.setView(pts[0], 15); }
    else if (pts.length > 1) { map.fitBounds(pts, { padding: [40, 40] }); }
    else if (p.center) { map.setView([p.center[0], p.center[1]], p.zoom || 3); }
  };
  document.addEventListener('DOMContentLoaded', init);
  init();
</script>
</body>
</html>`;

export default function MapaEmpleadosScreen() {
  const insets = useSafeAreaInsets();
  const { session, canAccessAdminPanel } = useAuth();
  const { companyId, branchId } = useAdminScope();
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [initialMapRegion, setInitialMapRegion] = useState<Region>(MAP_REGION_WORLD_OVERVIEW);
  const webRef = useRef<WebView | null>(null);
  const [mapReady, setMapReady] = useState(false);

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

        const allowed = canAccessAdminPanel;
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

        // Scope por la empresa seleccionada; el filtro de sucursal se aplica al resolver empleados.
        const { data, error } = await supabase
          .from('time_entries')
          .select('id, employee_id, clock_in, telemetry')
          .eq('company_id', companyId)
          .is('clock_out', null);

        if (error) throw error;

        const rows = (data ?? []) as TimeEntryRow[];
        const list: ActiveEmployee[] = [];

        const ids = rows.map((r) => r.employee_id).filter(Boolean);
        let empRows: { id?: string; first_name?: string | null; last_name?: string | null; branch_id?: string | null }[] = [];
        if (ids.length > 0) {
          const { data: empData, error: empNameErr } = await supabase
            .from('employees')
            .select('id, first_name, last_name, branch_id')
            .eq('company_id', companyId)
            .in('id', ids);
          if (empNameErr) throw empNameErr;
          empRows = (empData ?? []) as typeof empRows;
        }
        const nameById = new Map<string, string>();
        const branchByEmp = new Map<string, string | null>();
        for (const r of empRows) {
          const id = String(r?.id ?? '');
          if (!id) continue;
          nameById.set(id, [r?.first_name, r?.last_name].filter(Boolean).join(' ') || 'Empleado');
          branchByEmp.set(id, (r?.branch_id as string | null) ?? null);
        }

        for (const row of rows) {
          const eid = String(row.employee_id);
          if (branchId && branchByEmp.get(eid) !== branchId) continue; // filtro de sucursal seleccionada
          const coords = parseCoords(row.telemetry);
          if (!coords) continue;
          const name = nameById.get(eid) ?? 'Empleado';
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
  }, [session?.user?.id, canAccessAdminPanel, companyId, branchId]);

  // Payload de marcadores + centro para inyectar en el WebView.
  const payload = useMemo(
    () => ({
      center: [initialMapRegion.latitude, initialMapRegion.longitude] as [number, number],
      zoom: zoomFromDelta(initialMapRegion.latitudeDelta),
      markers: employees.map((e) => ({
        lat: e.latitude,
        lng: e.longitude,
        name: e.name,
        clockIn: formatClockIn(e.clockIn),
      })),
    }),
    [employees, initialMapRegion]
  );

  // Inyecta los marcadores cuando el mapa está listo o cambian los datos.
  useEffect(() => {
    if (!mapReady || !webRef.current) return;
    const js = `window.__render(${JSON.stringify(payload)}); true;`;
    webRef.current.injectJavaScript(js);
  }, [mapReady, payload]);

  const onMessage = (e: WebViewMessageEvent) => {
    if (e.nativeEvent.data === 'ready') setMapReady(true);
  };

  if (!isLoading && unauthorized) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.unauthorizedText}>No tienes permiso para ver el mapa de empleados.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.scopeBar}>
        <AdminScopeSelector />
      </View>
      <View style={styles.mapWrap}>
      <WebView
        ref={webRef}
        style={styles.map}
        originWhitelist={['*']}
        source={{ html: LEAFLET_HTML }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        startInLoadingState={false}
      />

      {!isLoading && employees.length === 0 && (
        <View style={styles.emptyMapOverlay} pointerEvents="none">
          <View style={styles.emptyPill}>
            <Text style={styles.emptyMapText}>
              No hay empleados con turno activo o compartiendo ubicación en este momento.
            </Text>
          </View>
        </View>
      )}

      {isLoading && (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loaderText}>Cargando empleados en turno...</Text>
        </View>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scopeBar: { paddingHorizontal: 16, paddingTop: 8 },
  mapWrap: { flex: 1 },
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
    color: theme.textPrimary,
    fontWeight: '600',
  },
  emptyMapOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  emptyPill: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.border,
  },
  emptyMapText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    textAlign: 'center',
  },
});
