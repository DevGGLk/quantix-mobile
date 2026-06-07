/**
 * Rastreo GPS en segundo plano (Ley 787 NI: solo con turno activo + consentimiento).
 *
 * El emisor anterior (HomeScreen) solo escribía `live_locations` con la app en primer
 * plano (setInterval + getCurrentPositionAsync), por lo que dejaba de rastrear al
 * bloquear el teléfono o cambiar de app. Este módulo usa `expo-location` +
 * `expo-task-manager` para emitir durante toda la jornada aunque la app esté
 * cerrada/bloqueada.
 *
 * La tarea se registra a nivel global (módulo importado al arrancar la app) porque el
 * SO puede relanzar el bundle JS en modo headless para entregar ubicaciones.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Database } from '../types/database.types';

export const BACKGROUND_LOCATION_TASK = 'quantix-background-location';

/** Contexto necesario por la tarea headless (no hay acceso al estado de React). */
const CONTEXT_KEY = 'gps.bg.context.v1';

type BgContext = { employeeId: string; companyId: string };

async function readContext(): Promise<BgContext | null> {
  try {
    const raw = await AsyncStorage.getItem(CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BgContext>;
    if (
      typeof parsed.employeeId === 'string' &&
      parsed.employeeId &&
      typeof parsed.companyId === 'string' &&
      parsed.companyId
    ) {
      return { employeeId: parsed.employeeId, companyId: parsed.companyId };
    }
    return null;
  } catch {
    return null;
  }
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[GPS bg] task error:', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations || locations.length === 0) return;

  const ctx = await readContext();
  if (!ctx) return;

  // En contexto headless el cliente puede no haber rehidratado la sesión todavía:
  // forzamos la carga antes del upsert (RLS exige el auth.uid() del empleado).
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;

  const last = locations[locations.length - 1];
  const latitude = last.coords.latitude;
  const longitude = last.coords.longitude;
  const speed = last.coords.speed;
  const speedOk = speed != null && Number.isFinite(speed) && !Number.isNaN(speed) ? speed : null;

  const payload: Database['public']['Tables']['live_locations']['Insert'] = {
    company_id: ctx.companyId,
    employee_id: ctx.employeeId,
    latitude,
    longitude,
    geog: `SRID=4326;POINT(${longitude} ${latitude})`,
    created_at: new Date(last.timestamp || Date.now()).toISOString(),
  };
  if (speedOk != null) payload.velocity = speedOk;

  const { error: upsertErr } = await supabase
    .from('live_locations')
    .upsert(payload, { onConflict: 'employee_id' });
  if (upsertErr) console.warn('[GPS bg] upsert:', upsertErr.message);
});

export type StartBgResult =
  | { ok: true; backgroundGranted: boolean }
  | { ok: false; reason: 'foreground_denied' | 'error'; message?: string };

const BG_REFRESH_MIN_SEC = 10;
const BG_REFRESH_MAX_SEC = 600;

function clampRefreshSeconds(rateSeconds: number | null | undefined): number {
  const n = Math.round(Number(rateSeconds));
  const base = Number.isFinite(n) && n >= 1 ? n : 15;
  return Math.min(BG_REFRESH_MAX_SEC, Math.max(BG_REFRESH_MIN_SEC, base));
}

/**
 * Pide permisos y arranca las actualizaciones de ubicación en segundo plano.
 * Si el usuario solo concede "mientras se usa", igual se registran (funcionan en
 * primer plano); `backgroundGranted=false` lo indica para avisar al usuario.
 */
export async function startBackgroundLocationTracking(params: {
  employeeId: string;
  companyId: string;
  refreshSeconds: number | null | undefined;
}): Promise<StartBgResult> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { ok: false, reason: 'foreground_denied' };

    const bg = await Location.requestBackgroundPermissionsAsync();
    const backgroundGranted = bg.status === 'granted';

    await AsyncStorage.setItem(
      CONTEXT_KEY,
      JSON.stringify({ employeeId: params.employeeId, companyId: params.companyId } satisfies BgContext),
    );

    const timeIntervalMs = clampRefreshSeconds(params.refreshSeconds) * 1000;

    // Si ya estaba corriendo, lo reiniciamos para reaplicar config (p. ej. nuevo intervalo).
    const already = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(
      () => false,
    );
    if (already) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    }

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: timeIntervalMs,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType.Other,
      foregroundService: {
        notificationTitle: 'Rastreo operativo activo',
        notificationBody: 'Tu ubicación se comparte con tu empresa durante el turno.',
        notificationColor: '#00C2D1',
      },
    });

    return { ok: true, backgroundGranted };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Detiene el rastreo y limpia el contexto persistido (al marcar salida o revocar consentimiento). */
export async function stopBackgroundLocationTracking(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(
      () => false,
    );
    if (started) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch (e) {
    console.warn('[GPS bg] stop:', e instanceof Error ? e.message : String(e));
  } finally {
    await AsyncStorage.removeItem(CONTEXT_KEY).catch(() => {});
  }
}
