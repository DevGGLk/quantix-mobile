import { supabase } from './supabase';
import { haversineDistanceMeters } from './geo';

/**
 * M2 convergencia marcaje: puntos de marcaje MÚLTIPLES del colaborador
 * (employee_marking_places → branches XOR locations), el mismo modelo que
 * valida el servidor (clock_in_secure). En la app esto es ADVISORY: informa
 * al usuario antes de intentar, pero la decisión final es del servidor.
 */
export type MarkingPoint = {
  name: string;
  lat: number;
  lon: number;
  radiusMeters: number;
};

type RawRow = {
  active_from: string | null;
  active_until: string | null;
  branches:
    | { name: string | null; gps_latitude: number | string | null; gps_longitude: number | string | null; gps_radius_meters: number | null; is_active: boolean | null }
    | { name: string | null; gps_latitude: number | string | null; gps_longitude: number | string | null; gps_radius_meters: number | null; is_active: boolean | null }[]
    | null;
  locations:
    | { name: string | null; latitude: number | null; longitude: number | null; radius_meters: number | null; is_active: boolean | null }
    | { name: string | null; latitude: number | null; longitude: number | null; radius_meters: number | null; is_active: boolean | null }[]
    | null;
};

function first<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : null;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchMarkingPoints(employeeId: string): Promise<MarkingPoint[]> {
  const { data, error } = await supabase
    .from('employee_marking_places')
    .select(
      'active_from, active_until, branches(name, gps_latitude, gps_longitude, gps_radius_meters, is_active), locations(name, latitude, longitude, radius_meters, is_active)'
    )
    .eq('employee_id', employeeId);

  if (error || !data) return [];

  const today = todayYmd();
  const points: MarkingPoint[] = [];
  for (const row of data as unknown as RawRow[]) {
    if (row.active_from && row.active_from > today) continue;
    if (row.active_until && row.active_until < today) continue;
    const b = first(row.branches);
    const l = first(row.locations);
    if (b && b.is_active !== false) {
      const lat = toNum(b.gps_latitude);
      const lon = toNum(b.gps_longitude);
      if (lat != null && lon != null) {
        points.push({
          name: b.name ?? 'Sucursal',
          lat,
          lon,
          radiusMeters: b.gps_radius_meters && b.gps_radius_meters > 0 ? b.gps_radius_meters : 50,
        });
      }
    } else if (l && l.is_active !== false) {
      const lat = toNum(l.latitude);
      const lon = toNum(l.longitude);
      if (lat != null && lon != null) {
        points.push({
          name: l.name ?? 'Ubicación',
          lat,
          lon,
          radiusMeters: l.radius_meters && l.radius_meters > 0 ? l.radius_meters : 50,
        });
      }
    }
  }
  return points;
}

export type NearestResult = {
  point: MarkingPoint;
  distanceMeters: number;
  inside: boolean;
} | null;

/** Punto más cercano a las coordenadas dadas (y si estamos dentro de su radio). */
export function nearestMarkingPoint(points: MarkingPoint[], lat: number, lon: number): NearestResult {
  let best: NearestResult = null;
  for (const p of points) {
    const d = haversineDistanceMeters(lat, lon, p.lat, p.lon);
    if (!best || d < best.distanceMeters) {
      best = { point: p, distanceMeters: d, inside: d <= p.radiusMeters };
    }
  }
  // Preferir un punto DENTRO aunque otro centro esté más cerca en línea recta.
  for (const p of points) {
    const d = haversineDistanceMeters(lat, lon, p.lat, p.lon);
    if (d <= p.radiusMeters && (!best?.inside || d < best.distanceMeters)) {
      best = { point: p, distanceMeters: d, inside: true };
    }
  }
  return best;
}
