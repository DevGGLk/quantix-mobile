/**
 * Envío de la ubicación en segundo plano durante la jornada (rastreo operativo).
 *
 * Antes la app solo enviaba con un setInterval mientras estaba abierta en Inicio: al
 * bloquear el teléfono o cambiar de app, dejaba de enviar. Ahora, si la persona concede
 * «Permitir todo el tiempo», Android corre un servicio en primer plano (notificación
 * fija «jornada activa») que despierta esta tarea con cada ubicación.
 *
 * La tarea se define a nivel de módulo: Android la puede despertar con la app cerrada,
 * sin montar ninguna pantalla. Por eso App.tsx importa este archivo al arrancar.
 *
 * Reglas (las mismas que el envío en primer plano):
 *  - solo con jornada abierta y consentimiento firmado (el servidor además descarta
 *    toda ubicación sin consentimiento: trg_live_locations_guard);
 *  - cada envío pisa la «última posición» (live_locations) y el servidor lo agrega al
 *    historial (location_pings).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

export const BACKGROUND_LOCATION_TASK = 'quantix-background-location';
const CTX_KEY = 'quantix.bgLocation.ctx';
/** Cada cuánto la tarea confirma que la jornada sigue abierta (pudo cerrarse en la web o el kiosko). */
const SHIFT_CHECK_MS = 5 * 60 * 1000;

type BgContext = {
  companyId: string;
  employeeId: string;
  refreshSeconds: number;
  lastShiftCheckAt: number;
};

async function readCtx(): Promise<BgContext | null> {
  try {
    const raw = await AsyncStorage.getItem(CTX_KEY);
    return raw ? (JSON.parse(raw) as BgContext) : null;
  } catch {
    return null;
  }
}

async function writeCtx(ctx: BgContext | null): Promise<void> {
  if (ctx) await AsyncStorage.setItem(CTX_KEY, JSON.stringify(ctx));
  else await AsyncStorage.removeItem(CTX_KEY);
}

function finite(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && !Number.isNaN(v) ? v : null;
}

async function readBatteryPct(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync(); // 0..1, -1 = desconocido
    return level >= 0 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

/** Fila para live_locations a partir de una lectura del GPS. */
export async function buildLocationPayload(
  pos: Location.LocationObject,
  companyId: string,
  employeeId: string,
): Promise<Record<string, unknown>> {
  const { latitude, longitude } = pos.coords;
  const heading = finite(pos.coords.heading);
  return {
    company_id: companyId,
    employee_id: employeeId,
    latitude,
    longitude,
    geog: `SRID=4326;POINT(${longitude} ${latitude})`,
    // Hora de la lectura (no del envío): Android puede entregar varias lecturas juntas.
    created_at: new Date(pos.timestamp || Date.now()).toISOString(),
    velocity: finite(pos.coords.speed),
    accuracy_meters: finite(pos.coords.accuracy),
    altitude: finite(pos.coords.altitude),
    // -1 = rumbo desconocido (iOS).
    heading: heading != null && heading >= 0 ? heading : null,
    // `mocked` solo existe en Android; en iOS queda null (desconocido), no false.
    is_mock_location: typeof pos.mocked === 'boolean' ? pos.mocked : null,
    battery_level: await readBatteryPct(),
  };
}

async function shiftStillOpen(employeeId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('id')
    .eq('employee_id', employeeId)
    .is('clock_out', null)
    .gte('clock_in', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1);
  if (error) return null; // sin red / error: no decidir
  return (data ?? []).length > 0;
}

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.warn('[GPS 2º plano] error de la tarea:', error.message);
      return;
    }
    const ctx = await readCtx();
    if (!ctx) {
      // Sin contexto (cerró sesión o marcó salida): no debería seguir corriendo.
      await stopBackgroundTracking();
      return;
    }

    if (Date.now() - ctx.lastShiftCheckAt > SHIFT_CHECK_MS) {
      const open = await shiftStillOpen(ctx.employeeId);
      if (open === false) {
        // Marcó salida por otro medio (web, kiosko) o RRHH cerró la jornada.
        await stopBackgroundTracking();
        return;
      }
      if (open === true) await writeCtx({ ...ctx, lastShiftCheckAt: Date.now() });
    }

    const locations = [...(data?.locations ?? [])].sort((a, b) => a.timestamp - b.timestamp);
    for (const pos of locations) {
      const payload = await buildLocationPayload(pos, ctx.companyId, ctx.employeeId);
      const { error: upErr } = await supabase
        .from('live_locations')
        .upsert(payload, { onConflict: 'employee_id' });
      if (upErr) {
        console.warn('[GPS 2º plano] envío:', upErr.message);
        // Sin sesión o sin permiso: no tiene sentido seguir despertando el teléfono.
        if (upErr.code === '42501' || /jwt|auth/i.test(upErr.message)) {
          await stopBackgroundTracking();
        }
        return;
      }
    }
  },
);

export type BackgroundPermission = 'granted' | 'denied' | 'unavailable';

/** ¿Ya tiene «Permitir todo el tiempo»? No pide nada. */
export async function getBackgroundPermission(): Promise<BackgroundPermission> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return 'unavailable';
    const { status } = await Location.getBackgroundPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Pide «Permitir todo el tiempo». En Android 11+ el sistema no muestra un diálogo:
 * abre los ajustes de la app y la persona elige la opción. Requiere tener ya el
 * permiso de primer plano.
 */
export async function requestBackgroundPermission(): Promise<BackgroundPermission> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return 'unavailable';
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== 'granted') return 'denied';
    }
    const { status } = await Location.requestBackgroundPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Arranca (o ajusta) el envío en segundo plano. Idempotente: si ya corre con el mismo
 * refresco no hace nada. Devuelve false si no se pudo (sin permiso): el llamador sigue
 * con el envío en primer plano.
 */
export async function startBackgroundTracking(opts: {
  companyId: string;
  employeeId: string;
  refreshSeconds: number;
}): Promise<boolean> {
  if ((await getBackgroundPermission()) !== 'granted') return false;

  const prev = await readCtx();
  const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (
    running &&
    prev &&
    prev.employeeId === opts.employeeId &&
    prev.companyId === opts.companyId &&
    prev.refreshSeconds === opts.refreshSeconds
  ) {
    return true;
  }

  await writeCtx({ ...opts, lastShiftCheckAt: Date.now() });
  if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => undefined);

  try {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: opts.refreshSeconds * 1000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Quantix HR · Jornada activa',
        notificationBody: 'Compartiendo tu ubicación solo durante la jornada (Ley 787).',
        notificationColor: '#3C3489',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch (e) {
    console.warn('[GPS 2º plano] no se pudo iniciar:', e instanceof Error ? e.message : String(e));
    await writeCtx(null);
    return false;
  }
}

/** Detiene el envío en segundo plano y borra el contexto. Seguro de llamar siempre. */
export async function stopBackgroundTracking(): Promise<void> {
  await writeCtx(null).catch(() => undefined);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    /* la tarea no estaba registrada */
  }
}
