/**
 * Distancia en metros entre dos puntos WGS84 (fórmula de Haversine).
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type BranchGeo = {
  lat: number;
  lon: number;
  radiusMeters: number;
};

/**
 * Interpreta fila de `branches` con nombres de columnas flexibles (sync con web/Supabase).
 */
export function parseBranchGeo(row: Record<string, unknown> | null | undefined): BranchGeo | null {
  if (!row) return null;
  const r = row as Record<string, unknown>;
  const latRaw =
    r.gps_latitude ?? r.latitude ?? r.lat ?? r.gps_lat ?? r.branch_latitude;
  const lonRaw =
    r.gps_longitude ?? r.longitude ?? r.lng ?? r.lon ?? r.gps_lng ?? r.branch_longitude;
  const radRaw = r.gps_radius_meters ?? r.radius_meters ?? r.geofence_radius_meters;

  const lat = typeof latRaw === 'number' ? latRaw : parseFloat(String(latRaw ?? ''));
  const lon = typeof lonRaw === 'number' ? lonRaw : parseFloat(String(lonRaw ?? ''));
  const radiusMeters =
    typeof radRaw === 'number' ? radRaw : parseFloat(String(radRaw ?? 'NaN'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;

  return { lat, lon, radiusMeters };
}
