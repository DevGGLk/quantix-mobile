import * as Location from 'expo-location';
import type { Region } from 'react-native-maps';

import { parseBranchGeo } from './geo';

const DELTA_NEAR = 0.08;

/**
 * Región inicial si no hay geocerca de sucursal ni ubicación del dispositivo.
 * Vista amplia — no asume país del cliente (SaaS multi-país). Constante de producto, no dato de tenant.
 */
export const MAP_REGION_WORLD_OVERVIEW: Region = {
  latitude: 15,
  longitude: -25,
  latitudeDelta: 65,
  longitudeDelta: 65,
};

/**
 * Orden: 1) geocerca parseada de fila `branches`, 2) GPS del dispositivo (si hay permiso),
 * 3) {@link MAP_REGION_WORLD_OVERVIEW}.
 */
export async function resolveAdminMapInitialRegion(
  branchRow: Record<string, unknown> | null | undefined
): Promise<Region> {
  if (branchRow) {
    const geo = parseBranchGeo(branchRow);
    if (geo) {
      return {
        latitude: geo.lat,
        longitude: geo.lon,
        latitudeDelta: DELTA_NEAR,
        longitudeDelta: DELTA_NEAR,
      };
    }
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status === 'granted') {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: DELTA_NEAR,
        longitudeDelta: DELTA_NEAR,
      };
    } catch {
      /* siguiente recurso */
    }
  }

  return MAP_REGION_WORLD_OVERVIEW;
}
