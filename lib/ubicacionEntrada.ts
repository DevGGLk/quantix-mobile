import * as Location from 'expo-location';

/**
 * Ubicación para la ENTRADA (la que el servidor valida contra la geocerca).
 *
 * POR QUÉ EXISTE (auditoría 2026-10-23): los 21 rechazos `out_of_range` de la app desde el 13/10
 * traían accuracy = 100 m exacto, la firma de la "ubicación aproximada" de Android (permiso
 * concedido en modo aproximado) o de un fix de red. Emetereo Pérez (Woods) perdió 6 de 9 turnos
 * parado adentro del local. Además `getCurrentPositionAsync` no tenía timeout: bajo techo el
 * botón podía girar sin fin, y con el GPS apagado lanzaba un error genérico.
 *
 * Qué hace:
 *  1. Permiso: si se niega, devuelve un motivo para ofrecer "Abrir ajustes".
 *  2. Servicios de ubicación apagados: lo dice con ese nombre.
 *  3. Permiso APROXIMADO (Android 12+): lo detecta y avisa (la app puede marcar igual; el
 *     servidor tolera hasta 50 m de imprecisión).
 *  4. Lectura con timeout; si la primera es imprecisa (> 50 m), escucha unos segundos más y se
 *     queda con la mejor.
 */

export const PRECISION_BUENA_M = 30;
export const PRECISION_ACEPTABLE_M = 50;
const TIMEOUT_PRIMERA_LECTURA_MS = 15_000;
const VENTANA_MEJORA_MS = 8_000;

export type Lectura = { lat: number; lon: number; accuracy: number | null; mocked: boolean };

export type ResultadoUbicacion =
  | { ok: true; lectura: Lectura; permisoAproximado: boolean }
  | { ok: false; motivo: 'permiso_denegado' | 'permiso_bloqueado' | 'servicios_apagados' | 'sin_senal' };

/** La de menor accuracy; una lectura sin accuracy pierde contra cualquiera que la tenga. */
export function mejorLectura(a: Lectura | null, b: Lectura | null): Lectura | null {
  if (!a) return b;
  if (!b) return a;
  const pa = a.accuracy ?? Number.POSITIVE_INFINITY;
  const pb = b.accuracy ?? Number.POSITIVE_INFINITY;
  return pb < pa ? b : a;
}

export function esImprecisa(l: Lectura | null): boolean {
  return !l || l.accuracy == null || l.accuracy > PRECISION_ACEPTABLE_M;
}

function aLectura(loc: Location.LocationObject): Lectura {
  const acc = loc.coords.accuracy;
  return {
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    accuracy: typeof acc === 'number' && Number.isFinite(acc) ? acc : null,
    mocked: (loc as { mocked?: boolean }).mocked === true,
  };
}

function conTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

export async function obtenerUbicacionParaEntrada(): Promise<ResultadoUbicacion> {
  const permiso = await Location.requestForegroundPermissionsAsync();
  if (permiso.status !== 'granted') {
    return { ok: false, motivo: permiso.canAskAgain === false ? 'permiso_bloqueado' : 'permiso_denegado' };
  }
  const permisoAproximado = permiso.android?.accuracy === 'coarse';

  const servicios = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!servicios) return { ok: false, motivo: 'servicios_apagados' };

  let mejor: Lectura | null = null;
  const primera = await conTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
    TIMEOUT_PRIMERA_LECTURA_MS
  );
  if (primera) mejor = aLectura(primera);

  // Si la lectura es imprecisa (o no llegó), escuchar unos segundos y quedarse con la mejor.
  if (esImprecisa(mejor)) {
    let sub: Location.LocationSubscription | null = null;
    try {
      await new Promise<void>((resolve) => {
        const fin = setTimeout(resolve, VENTANA_MEJORA_MS);
        Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
          (loc) => {
            mejor = mejorLectura(mejor, aLectura(loc));
            if (mejor && mejor.accuracy != null && mejor.accuracy <= PRECISION_BUENA_M) {
              clearTimeout(fin);
              resolve();
            }
          }
        )
          .then((s) => {
            sub = s;
          })
          .catch(() => {
            clearTimeout(fin);
            resolve();
          });
      });
    } finally {
      (sub as Location.LocationSubscription | null)?.remove();
    }
  }

  if (!mejor) return { ok: false, motivo: 'sin_senal' };
  return { ok: true, lectura: mejor, permisoAproximado };
}
