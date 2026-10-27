import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
  AppState,
  Linking,
} from 'react-native';

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { TabCompositeNavigation } from '../types/navigation';
import { HelpModal } from '../components/HelpModal';
import { CongratsBanner } from '../components/CongratsBanner';
import { WorkedTimeChronometer } from '../components/WorkedTimeChronometer';
import { captureException } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import {
  buildLocationPayload,
  getBackgroundPermission,
  requestBackgroundPermission,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '../lib/backgroundLocation';
import { theme } from '../lib/theme';
import { parseBranchGeo, type BranchGeo } from '../lib/geo';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';
import { fetchMarkingPoints, nearestMarkingPoint, type MarkingPoint } from '../lib/markingPlaces';
import { obtenerUbicacionParaEntrada, PRECISION_ACEPTABLE_M } from '../lib/ubicacionEntrada';
import {
  enqueueClockIn,
  flushClockInQueue,
  newOfflineHash,
  type QueuedClockIn,
} from '../lib/clockInQueue';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Solo para demos / soporte: `EXPO_PUBLIC_FORCE_ADMIN_PANEL=true` en `.env`. */
const FORCE_SHOW_ADMIN_PANEL =
  String(process.env.EXPO_PUBLIC_FORCE_ADMIN_PANEL ?? '').toLowerCase() === 'true';

/** Valores de `public.time_event_type` (p. ej. break_start / break_end). */
const PAUSE_EVENT_START = 'break_start';
const PAUSE_EVENT_END = 'break_end';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

/** Polling `live_locations`: fallback y límites de batería (paridad con políticas web). */
const GPS_REFRESH_FALLBACK_SEC = 15;
const GPS_REFRESH_MIN_SEC = 10;
const GPS_REFRESH_MAX_SEC = 600;

function resolveGpsPollingIntervalMs(rateSeconds: number | null | undefined): number {
  const n = Math.round(Number(rateSeconds));
  const base = Number.isFinite(n) && n >= 1 ? n : GPS_REFRESH_FALLBACK_SEC;
  const clamped = Math.min(GPS_REFRESH_MAX_SEC, Math.max(GPS_REFRESH_MIN_SEC, base));
  return clamped * 1000;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function clockInResponseErrorMessage(
  json: Record<string, unknown> | null,
  text: string,
  status: number
): string {
  const e = json?.error ?? json?.message;
  if (typeof e === 'string' && e.trim()) return e;
  return text?.slice(0, 200) || `HTTP ${status}`;
}

function extractClockInTimeEntryId(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  for (const key of ['timeEntryId', 'time_entry_id', 'id'] as const) {
    const v = json[key];
    if (typeof v === 'string' && v) return v;
  }
  const data = json.data;
  if (data && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const id = (data as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

type HomePerfil = {
  first_name: string | null;
  last_name: string | null;
  role: string | null;
};

type CompanyAnnouncement = {
  title: string;
  content: string;
  created_at?: string;
};

type CompanyEvent = {
  title: string;
  event_date: string;
  location?: string | null;
};

async function registerForPushNotificationsAsync(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    const { error: pushProfileErr } = await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', userId);
    if (pushProfileErr) {
      console.warn('profiles push_token:', pushProfileErr.message);
      captureException(pushProfileErr, { area: 'push_notifications', stage: 'persist_token' });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Fallo al registrar Push Token:', msg);
    captureException(e, { area: 'push_notifications' });
  }
}

async function fetchPauseState(timeEntryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('time_events')
    .select('event')
    .eq('time_entry_id', timeEntryId)
    .order('occurred_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('time_events (lectura pausa):', error.message);
    return false;
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  const last = String(row?.event ?? '');
  return last === PAUSE_EVENT_START;
}

/** Versión visible en telemetría/auditoría: appVersion + updateId de OTA. */
function appVersionString(): string {
  const base = Constants.expoConfig?.version ?? '0.0.0';
  const upd = Updates.updateId ? Updates.updateId.slice(0, 8) : 'embedded';
  return `${base}+${upd}`;
}

type ClockInSendBody = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  isMocked?: boolean;
  offlineHash?: string;
};

type ClockInSendResult =
  | { kind: 'ok'; timeEntryId: string | null; alreadyProcessed: boolean; markingPlace: string | null }
  | { kind: 'rejected'; message: string; reason: string | null }
  /** Sin sesión válida. NO es falta de red: encolarlo lo reintentaba para siempre. */
  | { kind: 'session'; error: string }
  | { kind: 'network'; error: string };

/** Sin respuesta en este tiempo se trata como sin conexión (antes el botón podía girar sin fin). */
const CLOCK_IN_FETCH_TIMEOUT_MS = 20_000;

/**
 * M2 convergencia marcaje: el servidor (clock_in_secure vía el API) es la ÚNICA
 * autoridad. `rejected` = el servidor decidió (y auditó) el rechazo;
 * `network` = no hubo respuesta (candidato a cola offline).
 */
async function sendClockInToServer(body: ClockInSendBody): Promise<ClockInSendResult> {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.access_token) {
      return { kind: 'session', error: sessionError?.message ?? 'Sin sesión' };
    }
    const url = `${API_BASE}/api/time-entries/clock-in`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOCK_IN_FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({
        latitude: body.latitude,
        longitude: body.longitude,
        ...(body.accuracy != null ? { accuracy: body.accuracy } : {}),
        ...(body.isMocked ? { isMocked: true } : {}),
        ...(body.offlineHash ? { offlineHash: body.offlineHash } : {}),
        platform: 'mobile',
        app_version: appVersionString(),
      }),
    }).finally(() => clearTimeout(timeout));
    const text = await res.text();
    const json = parseJsonObject(text);
    if (res.status === 401) {
      return { kind: 'session', error: clockInResponseErrorMessage(json, text, res.status) };
    }
    if (!res.ok) {
      return {
        kind: 'rejected',
        message: clockInResponseErrorMessage(json, text, res.status),
        reason: typeof json?.reason === 'string' ? json.reason : null,
      };
    }
    // `branch_name` es el punto que clock_in_secure resolvió por GPS (`v_best_name`), no la
    // sucursal de la ficha. Es lo que hay que mostrarle al multi-punto.
    const punto = typeof json?.branch_name === 'string' ? json.branch_name.trim() : '';
    return {
      kind: 'ok',
      timeEntryId: extractClockInTimeEntryId(json),
      alreadyProcessed: json?.already_processed === true,
      markingPlace: punto || null,
    };
  } catch (e: unknown) {
    return { kind: 'network', error: errorMessage(e) };
  }
}

export default function HomeScreen() {
  const navigation = useNavigation<TabCompositeNavigation<'Home'>>();
  const { session, authProfile, employee, refreshProfile, isOperativeEmployee } = useAuth();
  const employeeGpsConsent = employee?.is_gps_tracking_enabled === true;
  const employeeRecordId = employee?.id ?? null;
  const [perfil, setPerfil] = useState<HomePerfil | null>(null);
  const [isLoadingPerfil, setIsLoadingPerfil] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [branchGeo, setBranchGeo] = useState<BranchGeo | null>(null);
  /** M2 convergencia marcaje: puntos múltiples (advisory; el servidor decide). */
  const [markingPoints, setMarkingPoints] = useState<MarkingPoint[]>([]);
  const [anuncios, setAnuncios] = useState<CompanyAnnouncement[]>([]);
  const [eventos, setEventos] = useState<CompanyEvent[]>([]);
  const [isLoadingHub, setIsLoadingHub] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoadingClockStatus, setIsLoadingClockStatus] = useState(true);
  const [activeTimeEntryId, setActiveTimeEntryId] = useState<string | null>(null);
  const [isOnPause, setIsOnPause] = useState(false);
  /** ISO del `clock_in` del turno abierto → alimenta el cronómetro en vivo. */
  const [activeClockInAt, setActiveClockInAt] = useState<string | null>(null);
  /**
   * Punto donde quedó registrada la entrada del turno abierto. Se lee de
   * `clock_in_attempts.matched_place` y NO de `time_entries.telemetry`: hasta el arreglo
   * del cierre, el propio clock-out del móvil sobrescribía esa columna y borraba el punto
   * (595 de 1682 jornadas en 30 días). La tabla de intentos nunca se sobrescribe.
   * Importa sobre todo a los multi-punto: 55 de 112 activos al 20-ago-2026.
   */
  const [activeMarkingPlace, setActiveMarkingPlace] = useState<string | null>(null);
  const [isPunching, setIsPunching] = useState(false);
  /**
   * Candado contra el doble toque. `isPunching` es estado de React: un segundo toque dentro del
   * mismo render lo ve en false y manda otro marcaje (Kevin: 3 intentos en 2 s; Diana: 2 entradas
   * en el mismo milisegundo, una cerrada con 0 h).
   */
  const punchingRef = useRef(false);
  /** Incrementarlo vuelve a leer el turno abierto desde la base (tras reenviar la cola, 409, etc.). */
  const [statusReloadKey, setStatusReloadKey] = useState(0);
  const [isPauseActionLoading, setIsPauseActionLoading] = useState(false);
  /** Solo fallo crítico del perfil (bloquea nombre / empresa). */
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  /** Fallo al leer `time_entries` (estado del reloj); no usar Alert en Home para no tapar el portal. */
  const [clockStatusLoadError, setClockStatusLoadError] = useState<string | null>(null);
  /** Fallo al cargar geocerca de sucursal (`branches`) cuando el empleado ya tiene `branch_id`. */
  const [branchGeoLoadError, setBranchGeoLoadError] = useState<string | null>(null);
  /** Fallos al cargar muro de inicio (noticias / eventos). */
  const [announcementsLoadError, setAnnouncementsLoadError] = useState<string | null>(null);
  const [eventsLoadError, setEventsLoadError] = useState<string | null>(null);
  const [helpGpsVisible, setHelpGpsVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Consentimiento de geolocalización firmado (gps_consents, Ley 787). null = sin cargar.
   * Sin él el servidor descarta toda ubicación, así que la app ni la pide.
   */
  const [gpsConsentSigned, setGpsConsentSigned] = useState<boolean | null>(null);
  /** El aviso de «Permitir todo el tiempo» se muestra una vez por sesión de la app. */
  const bgPermissionAskedRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadPerfil() {
      setIsLoadingPerfil(true);
      try {
        setProfileLoadError(null);
        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) {
            setPerfil(null);
            setCompanyId(null);
            setBranchGeo(null);
            setBranchGeoLoadError(null);
          }
          return;
        }
        registerForPushNotificationsAsync(userId);

        // No llamar a `refresh()` de Auth aquí: dispara `isRecordsLoading` → `isLoading` global en
        // App.tsx, se desmonta el navigator y Home vuelve a montar → mismo efecto → bucle infinito.
        // El perfil/expediente ya se cargan en AuthProvider al cambiar la sesión.

        const cid = employee?.company_id ?? authProfile?.company_id ?? null;
        const bid = employee?.branch_id ?? null;

        if (bid && cid) {
          const { data: branchRow, error: branchErr } = await supabase
            .from('branches')
            .select('*')
            .eq('id', bid)
            .eq('company_id', cid)
            .maybeSingle();
          if (branchErr) {
            console.warn('branches (geocerca):', branchErr.message);
            captureException(branchErr, { area: 'home_branch_geo', stage: 'branches_select' });
            if (isMounted) {
              setBranchGeo(null);
              setBranchGeoLoadError(
                'No pudimos cargar la geocerca de tu sucursal. El marcaje puede bloquearse hasta que se restablezca la conexión o RRHH revise la configuración.'
              );
            }
          } else if (isMounted) {
            setBranchGeoLoadError(null);
            setBranchGeo(parseBranchGeo(branchRow as Record<string, unknown>));
          }
        } else if (isMounted) {
          setBranchGeoLoadError(null);
          setBranchGeo(null);
        }

        if (isMounted) {
          // Nombres: `profiles` es la fuente principal (Mi Portal); `employees` como respaldo RRHH.
          const pickNonEmpty = (...candidates: (string | null | undefined)[]) => {
            for (const c of candidates) {
              if (typeof c !== 'string') continue;
              const t = c.trim();
              if (t.length > 0) return t;
            }
            return null;
          };
          setPerfil({
            first_name: pickNonEmpty(authProfile?.first_name, employee?.first_name),
            last_name: pickNonEmpty(authProfile?.last_name, employee?.last_name),
            role: authProfile?.role ?? null,
          });
          setCompanyId(cid);
        }
      } catch (_e: unknown) {
        if (isMounted) {
          setPerfil(null);
          setCompanyId(null);
          setBranchGeo(null);
          setBranchGeoLoadError(null);
          setProfileLoadError(
            'No pudimos cargar tu perfil. Revisa tu conexión o intenta más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoadingPerfil(false);
      }
    }

    loadPerfil();
    return () => {
      isMounted = false;
    };
  }, [
    session?.user?.id,
    employee?.company_id,
    employee?.branch_id,
    employee?.first_name,
    employee?.last_name,
    authProfile?.company_id,
    authProfile?.first_name,
    authProfile?.last_name,
    authProfile?.role,
  ]);

  const refreshPauseState = useCallback(async (entryId: string | null) => {
    if (!entryId) {
      setIsOnPause(false);
      return;
    }
    try {
      const onBreak = await fetchPauseState(entryId);
      setIsOnPause(onBreak);
    } catch {
      setIsOnPause(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadTodayClockStatus() {
      try {
        setIsLoadingClockStatus(true);

        if (!employeeRecordId) {
          if (isMounted) {
            setClockStatusLoadError(null);
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }

        if (!companyId) {
          if (isMounted) {
            setClockStatusLoadError(null);
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }

        // 'flagged' = jornada que la guarda dejó abierta esperando a RRHH. No es un turno en
        // curso: si entra acá, el cronómetro cuenta desde una entrada de días atrás y muestra
        // 71 h o 287 h corriendo. Solo 'in' y 'break' son turno activo.
        let query = supabase
          .from('time_entries')
          .select('id, entry_type, clock_in, clock_out, company_id, status')
          .eq('employee_id', employeeRecordId)
          .eq('company_id', companyId)
          .is('clock_out', null)
          .in('status', ['in', 'break'])
          .order('clock_in', { ascending: false })
          .limit(1);

        const { data, error } = await query;

        if (error) {
          console.warn('time_entries (estado reloj):', error.message);
          captureException(error, { area: 'home_clock_status', stage: 'time_entries_select' });
          if (isMounted) {
            setClockStatusLoadError(
              'No pudimos verificar tu asistencia de hoy. Revisa tu conexión o intenta más tarde.'
            );
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }

        if (isMounted) setClockStatusLoadError(null);

        const last = data?.[0] as { id?: string; clock_out?: string | null; clock_in?: string | null } | undefined;
        const active = Boolean(last?.id) && !last?.clock_out;

        if (isMounted) {
          setIsClockedIn(active);
          const eid = active ? (last!.id as string) : null;
          setActiveTimeEntryId(eid);
          setActiveClockInAt(active ? ((last!.clock_in as string | null) ?? null) : null);
          if (eid) {
            await refreshPauseState(eid);
          } else {
            setIsOnPause(false);
          }
        }

        // Punto de marcaje de la entrada abierta. Falla blando a propósito: el cronómetro
        // no puede depender de esto, así que si no se puede leer se muestra sin punto.
        if (active && last?.id) {
          const { data: attempt, error: attemptError } = await supabase
            .from('clock_in_attempts')
            .select('matched_place')
            .eq('time_entry_id', last.id)
            // Desde la auditoría de salidas la tabla guarda los dos sentidos: acá se quiere
            // el punto donde la persona fichó al ENTRAR.
            .eq('action', 'clock_in')
            .not('matched_place', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (attemptError) {
            console.warn('clock_in_attempts (punto de marcaje):', attemptError.message);
          }
          const punto = (attempt as { matched_place?: string | null } | null)?.matched_place;
          if (isMounted) {
            setActiveMarkingPlace(typeof punto === 'string' && punto.trim() ? punto.trim() : null);
          }
        } else if (isMounted) {
          setActiveMarkingPlace(null);
        }
      } catch (e: unknown) {
        console.warn('loadTodayClockStatus:', errorMessage(e));
        captureException(e, { area: 'home_clock_status', stage: 'loadTodayClockStatus' });
        if (isMounted) {
          setClockStatusLoadError(
            'No pudimos verificar tu asistencia de hoy. Revisa tu conexión o intenta más tarde.'
          );
          setIsClockedIn(false);
          setActiveTimeEntryId(null);
          setActiveMarkingPlace(null);
          setIsOnPause(false);
        }
      } finally {
        if (isMounted) setIsLoadingClockStatus(false);
      }
    }

    loadTodayClockStatus();
    return () => {
      isMounted = false;
    };
  }, [employeeRecordId, companyId, refreshPauseState, statusReloadKey]);

  /**
   * Telemetría en vivo (`live_locations`): solo con expediente, turno activo y consentimiento en `employees`.
   * `requires_live_tracking` se expone en el expediente; el envío exige consentimiento explícito (`is_gps_tracking_enabled`).
   * El intervalo respeta `gps_refresh_rate_seconds` del expediente con clamp.
   */
  // Se vuelve a leer al marcar entrada: puede haber firmado en Mi Portal mientras tanto.
  useEffect(() => {
    if (!employeeRecordId || !employeeGpsConsent) {
      setGpsConsentSigned(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('gps_consents')
        .select('signed_at, is_grandfathered')
        .eq('employee_id', employeeRecordId)
        .is('revoked_at', null);
      if (cancelled) return;
      if (error) {
        // Ante un error de lectura no se bloquea: el servidor igual lo exige.
        console.warn('GPS consentimiento:', error.message);
        setGpsConsentSigned(true);
        return;
      }
      const rows = (data ?? []) as { signed_at: string | null; is_grandfathered: boolean | null }[];
      setGpsConsentSigned(rows.some((r) => r.signed_at != null || r.is_grandfathered === true));
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeRecordId, employeeGpsConsent, isClockedIn]);

  useEffect(() => {
    const trackingOk = employeeGpsConsent && gpsConsentSigned === true;
    const canSend =
      isOperativeEmployee &&
      trackingOk &&
      isClockedIn &&
      !!activeTimeEntryId &&
      !!companyId &&
      !!employeeRecordId;

    console.log('[GPS diagnóstico] condición envío', {
      isClockedIn,
      activeTimeEntryId,
      is_gps_tracking_enabled: employee?.is_gps_tracking_enabled,
      requires_live_tracking: employee?.requires_live_tracking,
      trackingOk,
      companyId: companyId ?? null,
      employeeRecordId: employeeRecordId ?? null,
      canSend,
    });
    if (isClockedIn && activeTimeEntryId && !trackingOk) {
      console.log('GPS Bloqueado por configuración de privacidad del admin');
    }

    if (!canSend) {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
        gpsIntervalRef.current = null;
      }
      // Solo se detiene el servicio de segundo plano cuando hay certeza (salida marcada,
      // rastreo apagado o sin consentimiento). Mientras carga, canSend es false un
      // instante y detenerlo ahí cortaba el servicio en cada apertura de la app.
      const certezaDeParar =
        (!isLoadingClockStatus && !isClockedIn) ||
        (!isLoadingPerfil && !employeeGpsConsent) ||
        gpsConsentSigned === false;
      if (certezaDeParar) void stopBackgroundTracking();
      return;
    }

    let cancelled = false;
    const cid = companyId as string;
    const eid = employeeRecordId as string;
    const refreshSeconds = Math.round(
      resolveGpsPollingIntervalMs(employee?.gps_refresh_rate_seconds ?? undefined) / 1000,
    );

    const sendLiveLocation = async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const payload = await buildLocationPayload(pos, cid, eid);
        const { error } = await supabase.from('live_locations').upsert(payload, {
          onConflict: 'employee_id',
        });
        if (error) {
          console.error('🚨 ERROR GPS SUPABASE:', error);
        } else {
          console.log('✅ GPS ENVIADO CON ÉXITO');
        }
      } catch (e: unknown) {
        console.warn('GPS turno activo:', errorMessage(e));
      }
    };

    const startForegroundInterval = () => {
      if (gpsIntervalRef.current) return;
      gpsIntervalRef.current = setInterval(() => {
        void sendLiveLocation();
      }, refreshSeconds * 1000);
    };

    const stopForegroundInterval = () => {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
        gpsIntervalRef.current = null;
      }
    };

    // Un punto inmediato para que el mapa lo muestre ya, sin esperar al servicio.
    void sendLiveLocation();

    void (async () => {
      const startBg = () => startBackgroundTracking({ companyId: cid, employeeId: eid, refreshSeconds });
      if (await startBg()) {
        if (!cancelled) stopForegroundInterval();
        return;
      }
      if (cancelled) return;
      // Sin «Permitir todo el tiempo»: se sigue enviando con la app abierta.
      startForegroundInterval();

      if (bgPermissionAskedRef.current) return;
      if ((await getBackgroundPermission()) !== 'denied' || cancelled) return;
      bgPermissionAskedRef.current = true;
      Alert.alert(
        'Ubicación durante la jornada',
        'Tu empresa activó el rastreo durante la jornada y firmaste el consentimiento. Para que ' +
          'funcione con el teléfono bloqueado, en la siguiente pantalla elegí «Permitir todo el ' +
          'tiempo». Solo se envía entre tu entrada y tu salida; verás una notificación fija ' +
          'mientras esté activo.',
        [
          { text: 'Ahora no', style: 'cancel' },
          {
            text: 'Continuar',
            onPress: () => {
              void (async () => {
                if ((await requestBackgroundPermission()) === 'granted' && (await startBg())) {
                  stopForegroundInterval();
                }
              })();
            },
          },
        ],
      );
    })();

    return () => {
      cancelled = true;
      stopForegroundInterval();
    };
  }, [
    isOperativeEmployee,
    employeeGpsConsent,
    gpsConsentSigned,
    employee?.gps_refresh_rate_seconds,
    isClockedIn,
    isLoadingClockStatus,
    isLoadingPerfil,
    activeTimeEntryId,
    companyId,
    employeeRecordId,
  ]);

  const loadHubData = useCallback(async (hubCompanyId: string) => {
    const cid = hubCompanyId.trim();
    if (!cid) return;

    try {
      setIsLoadingHub(true);
      setAnnouncementsLoadError(null);
      setEventsLoadError(null);

      const { data: anunciosData, error: anunciosError } = await supabase
        .from('company_announcements')
        .select('title, content, created_at')
        .eq('company_id', cid)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(3);

      if (anunciosError) {
        console.warn('company_announcements:', anunciosError.message);
        captureException(anunciosError, { area: 'home_hub', stage: 'company_announcements' });
        setAnuncios([]);
        setAnnouncementsLoadError(
          'No pudimos cargar las noticias. Revisa tu conexión o intenta más tarde.'
        );
      } else {
        setAnnouncementsLoadError(null);
        setAnuncios((anunciosData ?? []) as CompanyAnnouncement[]);
      }

      const now = new Date().toISOString();
      const { data: eventosData, error: eventosError } = await supabase
        .from('company_events')
        .select('title, event_date, location')
        .eq('company_id', cid)
        .gte('event_date', now)
        .order('event_date', { ascending: true })
        .limit(5);

      if (eventosError) {
        console.warn('company_events:', eventosError.message);
        captureException(eventosError, { area: 'home_hub', stage: 'company_events' });
        setEventos([]);
        setEventsLoadError(
          'No pudimos cargar los eventos. Revisa tu conexión o intenta más tarde.'
        );
      } else {
        setEventsLoadError(null);
        setEventos((eventosData ?? []) as CompanyEvent[]);
      }
    } catch (e: unknown) {
      console.warn('loadHubData:', errorMessage(e));
      captureException(e, { area: 'home_hub', stage: 'loadHubData' });
      setAnuncios([]);
      setEventos([]);
      setAnnouncementsLoadError(
        'No pudimos cargar el muro de inicio. Revisa tu conexión o intenta más tarde.'
      );
      setEventsLoadError(
        'No pudimos cargar el muro de inicio. Revisa tu conexión o intenta más tarde.'
      );
    } finally {
      setIsLoadingHub(false);
    }
  }, []);

  useEffect(() => {
    if (!companyId) return;
    void loadHubData(companyId);
  }, [companyId, loadHubData]);

  const onRefreshHome = useCallback(async () => {
    setRefreshing(true);
    try {
      const snap = await refreshProfile();
      const cid =
        (snap?.profile?.company_id != null && String(snap.profile.company_id).trim()) ||
        (snap?.employee?.company_id != null && String(snap.employee.company_id).trim()) ||
        (companyId != null && String(companyId).trim()) ||
        '';
      if (cid) {
        await loadHubData(cid);
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshProfile, loadHubData, companyId]);

  /** Explica por qué no se pudo leer la ubicación de entrada y ofrece el atajo que corresponde. */
  /**
   * Reporta al servidor un fallo de marcaje que nunca llegó a clock_in_secure (GPS, permiso,
   * cancelación). Queda en Asistencia › Intentos de marcaje (antes no quedaba rastro).
   * Fire-and-forget: si falla, no se le muestra nada a la persona.
   */
  const reportarFalloMarcaje = (
    reason:
      | 'cliente_permiso_denegado'
      | 'cliente_permiso_bloqueado'
      | 'cliente_gps_apagado'
      | 'cliente_sin_senal'
      | 'cliente_cancelo_fuera_de_punto'
      | 'cliente_error',
    extra: {
      message?: string;
      lat?: number;
      lon?: number;
      accuracy?: number | null;
      nearestPlace?: string | null;
      nearestDistance?: number | null;
    } = {}
  ) => {
    void supabase
      .rpc('log_clock_in_client_failure', {
        p_reason: reason,
        p_message: extra.message ?? null,
        p_platform: 'mobile',
        p_app_version: appVersionString(),
        p_latitude: extra.lat ?? null,
        p_longitude: extra.lon ?? null,
        p_accuracy: extra.accuracy ?? null,
        p_nearest_place: extra.nearestPlace ?? null,
        p_nearest_distance: extra.nearestDistance ?? null,
      })
      .then(({ error }) => {
        if (error) console.warn('log_clock_in_client_failure:', error.message);
      });
  };

  const mostrarProblemaUbicacion = (
    motivo: 'permiso_denegado' | 'permiso_bloqueado' | 'servicios_apagados' | 'sin_senal'
  ) => {
    captureException(new Error(`clock_in_ubicacion:${motivo}`), { area: 'home_clock_in', stage: 'ubicacion' });
    reportarFalloMarcaje(
      motivo === 'permiso_denegado'
        ? 'cliente_permiso_denegado'
        : motivo === 'permiso_bloqueado'
          ? 'cliente_permiso_bloqueado'
          : motivo === 'servicios_apagados'
            ? 'cliente_gps_apagado'
            : 'cliente_sin_senal'
    );
    if (motivo === 'permiso_bloqueado') {
      Alert.alert(
        'Ubicación bloqueada',
        'QuantixHR no tiene permiso de ubicación. Abrí los ajustes de la app y activá Ubicación → "Permitir mientras se usa la app" con "Ubicación precisa".',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
        ]
      );
      return;
    }
    if (motivo === 'permiso_denegado') {
      Alert.alert(
        'Permiso requerido',
        'Necesitamos tu ubicación para registrar la entrada. Volvé a tocar "Marcar Entrada" y elegí "Permitir" con "Ubicación precisa".'
      );
      return;
    }
    if (motivo === 'servicios_apagados') {
      Alert.alert('Ubicación apagada', 'La ubicación (GPS) del teléfono está apagada. Encendela y volvé a intentar.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Encender',
          onPress: () => {
            if (Platform.OS === 'android') {
              void Location.enableNetworkProviderAsync().catch(() => void Linking.openSettings());
            } else {
              void Linking.openSettings();
            }
          },
        },
      ]);
      return;
    }
    Alert.alert(
      'Sin señal de ubicación',
      'No pudimos leer tu ubicación. Acercate a una puerta o ventana, esperá unos segundos y volvé a intentar.'
    );
  };

  /**
   * Ubicación para la SALIDA: best-effort, nunca bloquea ni interrumpe.
   *
   * La entrada sí necesita GPS (el servidor valida la geocerca en clock_in_secure). La salida
   * no: `clock_out_employee` no mira coordenadas. Pero `handleClockOut` usaba
   * `getCurrentLocation()`, que alerta y devuelve null si falta el permiso y que LANZA si el GPS
   * da timeout o está apagado. Con `if (!coords) return;` el marcaje moría en el teléfono sin
   * llegar nunca a la base: la persona tocaba "Marcar salida", el botón giraba y no pasaba nada.
   *
   * Misma política que la web: si no hay ubicación, la salida se registra igual y se marca
   * 'sin_ubicacion' para que RRHH la revise.
   */
  const getCurrentLocationForClockOut = async (): Promise<{
    lat: number;
    lon: number;
    accuracy: number | null;
  } | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      return {
        lat: location.coords.latitude,
        lon: location.coords.longitude,
        accuracy: Number.isFinite(location.coords.accuracy ?? NaN) ? location.coords.accuracy : null,
      };
    } catch (err) {
      console.warn('GPS no disponible al marcar salida; se cierra sin ubicación:', err);
      return null;
    }
  };

  /** Advisory (no bloquea): si el GPS dice "fuera de todos los puntos", confirmar antes de intentar. */
  const confirmOutsideAdvisory = (nearestName: string | null, nearestDist: number | null): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        'Parece que estás fuera de tus puntos de marcaje',
        nearestName
          ? `Tu punto más cercano es "${nearestName}" a ${Math.round(nearestDist ?? 0)} m. El servidor validará el intento y quedará registrado.`
          : 'No encontramos puntos de marcaje asignados. El servidor validará el intento y quedará registrado.',
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Intentar igual', onPress: () => resolve(true) },
        ]
      );
    });

  /** Reintenta la cola offline; informa resultados si hubo actividad. */
  const flushQueuedClockIns = useCallback(async (notify: boolean) => {
    const { sent, rejectedMessages, expired } = await flushClockInQueue(async (item: QueuedClockIn) => {
      const r = await sendClockInToServer({
        latitude: item.latitude,
        longitude: item.longitude,
        accuracy: item.accuracy,
        isMocked: item.isMocked,
        offlineHash: item.offlineHash,
      });
      if (r.kind === 'ok') return { status: 'ok' as const };
      // Dos toques sin conexión dejan dos marcajes en la cola: el segundo vuelve como
      // duplicate_open, pero la entrada SÍ está registrada. No es un rechazo para la persona.
      if (r.kind === 'rejected' && r.reason === 'duplicate_open') return { status: 'ok' as const };
      if (r.kind === 'rejected') return { status: 'rejected' as const, message: r.message };
      // Sin sesión o sin red: se conserva para el próximo intento (vence a las 4 h).
      return { status: 'network' as const };
    });
    // Antes: tras reenviar, la pantalla seguía en "Marcar Entrada" aunque el servidor ya había
    // registrado la entrada; la persona volvía a tocar y recibía "Marcaje no registrado".
    if (sent > 0) setStatusReloadKey((k) => k + 1);
    // Rechazos y vencidos se informan SIEMPRE: antes, en el reenvío silencioso, se descartaban.
    const parts: string[] = [];
    if (notify && sent > 0) parts.push(`Tu marcaje guardado sin conexión ya quedó registrado.`);
    if (rejectedMessages.length > 0) parts.push(`Un marcaje guardado sin conexión fue rechazado: ${rejectedMessages[0]}`);
    if (expired.length > 0) {
      const hora = new Date(expired[0].queuedAtIso).toLocaleString('es-NI', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
      parts.push(
        `Un marcaje guardado sin conexión (${hora}) venció sin poder enviarse. Pedile a RRHH que registre tu hora real.`
      );
    }
    if (parts.length > 0) Alert.alert('Marcajes pendientes', parts.join('\n\n'));
    return { sent, rejected: rejectedMessages.length, expired: expired.length };
  }, []);

  // Puntos de marcaje del colaborador (mismo modelo que el servidor).
  useEffect(() => {
    let cancelled = false;
    if (!employeeRecordId) {
      setMarkingPoints([]);
      return;
    }
    void fetchMarkingPoints(employeeRecordId).then((pts) => {
      if (!cancelled) setMarkingPoints(pts);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeRecordId]);

  // Cola offline: reintento al abrir la app y al volver a primer plano.
  useEffect(() => {
    void flushQueuedClockIns(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void flushQueuedClockIns(true);
    });
    return () => sub.remove();
  }, [flushQueuedClockIns]);

  const handleClockIn = async () => {
    if (isPunching || punchingRef.current) return;
    punchingRef.current = true;
    setIsPunching(true);
    try {
      if (!employeeRecordId) {
        Alert.alert(
          'Expediente requerido',
          'No se encontró tu registro de empleado. Contacta a RRHH para poder marcar entrada.'
        );
        return;
      }

      if (!companyId) {
        Alert.alert('Error de configuración', 'No tienes una empresa asignada en tu perfil.');
        return;
      }

      // Vaciar pendientes ANTES: si un marcaje guardado sin conexión se registra ahora, la persona
      // ya tiene su entrada y no hay que mandar otra (antes terminaba en "Marcaje no registrado").
      const previo = await flushQueuedClockIns(false);
      if (previo.sent > 0) {
        Alert.alert(
          'Tu entrada ya quedó registrada',
          'El marcaje que había quedado guardado sin conexión se acaba de registrar. Actualizamos tu pantalla.'
        );
        return;
      }

      const ubic = await obtenerUbicacionParaEntrada();
      if (!ubic.ok) {
        mostrarProblemaUbicacion(ubic.motivo);
        return;
      }
      const coords = ubic.lectura;

      // M2 convergencia marcaje: pre-check ADVISORY multi-punto (mismo modelo
      // que el servidor: employee_marking_places). La decisión es del servidor.
      if (markingPoints.length > 0) {
        const nearest = nearestMarkingPoint(markingPoints, coords.lat, coords.lon);
        if (nearest && !nearest.inside) {
          const proceed = await confirmOutsideAdvisory(nearest.point.name, nearest.distanceMeters);
          if (!proceed) {
            reportarFalloMarcaje('cliente_cancelo_fuera_de_punto', {
              lat: coords.lat,
              lon: coords.lon,
              accuracy: coords.accuracy,
              nearestPlace: nearest.point.name,
              nearestDistance: nearest.distanceMeters,
            });
            return;
          }
        }
      }

      const result = await sendClockInToServer({
        latitude: coords.lat,
        longitude: coords.lon,
        accuracy: coords.accuracy,
        isMocked: coords.mocked,
      });

      if (result.kind === 'ok') {
        setClockStatusLoadError(null);
        setIsClockedIn(true);
        setActiveTimeEntryId(result.timeEntryId);
        setActiveClockInAt(new Date().toISOString());
        setActiveMarkingPlace(result.markingPlace);
        setIsOnPause(false);
        // Hora real del servidor y punto: se releen de la base.
        setStatusReloadKey((k) => k + 1);
        Alert.alert(
          '¡Éxito!',
          result.markingPlace
            ? `Tu entrada quedó registrada en ${result.markingPlace}.`
            : 'Tu entrada ha sido registrada en el sistema.'
        );
        return;
      }

      if (result.kind === 'session') {
        Alert.alert(
          'Tu sesión venció',
          'Para marcar, cerrá sesión en Perfil y volvé a entrar con tu usuario. Tu marcaje no se guardó.'
        );
        return;
      }

      if (result.kind === 'rejected') {
        if (result.reason === 'duplicate_open') {
          // Ya tiene una entrada abierta (doble toque, o la cola ya la registró): no es un error.
          setStatusReloadKey((k) => k + 1);
          Alert.alert(
            'Ya estás marcado',
            'Ya tenés una entrada abierta. Actualizamos tu pantalla; si no aparece, deslizá hacia abajo para recargar.'
          );
          return;
        }
        const imprecisa =
          ubic.permisoAproximado || (coords.accuracy != null && coords.accuracy > PRECISION_ACEPTABLE_M);
        if (result.reason === 'out_of_range' && imprecisa) {
          Alert.alert(
            'Marcaje no registrado',
            `${result.message}\n\nTu teléfono dio una ubicación aproximada (±${Math.round(coords.accuracy ?? 0)} m). ` +
              'Activá "Ubicación precisa" para QuantixHR: Ajustes › Aplicaciones › QuantixHR › Permisos › Ubicación.',
            [
              { text: 'Cerrar', style: 'cancel' },
              { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
            ]
          );
          return;
        }
        Alert.alert('Marcaje no registrado', result.message);
        return;
      }

      // Sin respuesta del servidor: encolar offline (idempotente por hash).
      await enqueueClockIn({
        offlineHash: newOfflineHash(),
        latitude: coords.lat,
        longitude: coords.lon,
        accuracy: coords.accuracy,
        isMocked: coords.mocked,
        queuedAtIso: new Date().toISOString(),
      });
      Alert.alert(
        'Sin conexión',
        'Tu marcaje quedó guardado en el teléfono y se enviará solo cuando vuelva la conexión (hasta 4 horas). ' +
          'La hora que queda registrada es la del envío: si tarda, avisale a RRHH tu hora real.'
      );
    } catch (err) {
      console.error(err);
      captureException(err, { area: 'home_clock_in', stage: 'handleClockIn' });
      reportarFalloMarcaje('cliente_error', { message: errorMessage(err) });
      Alert.alert('Error', 'No se pudo completar el marcaje. Intenta de nuevo.');
    } finally {
      punchingRef.current = false;
      setIsPunching(false);
    }
  };

  const handleClockOut = async () => {
    if (isPunching || punchingRef.current) return;
    punchingRef.current = true;
    setIsPunching(true);
    try {
      // Best-effort: si no hay GPS la salida se marca igual. Ver getCurrentLocationForClockOut.
      const coords = await getCurrentLocationForClockOut();

      if (!activeTimeEntryId) {
        Alert.alert(
          'Estado inconsistente',
          'No se encontró un marcaje activo para cerrar. Intenta de nuevo.'
        );
        return;
      }

      // El cierre va por RPC, no por `.update()` directo. El update plano REEMPLAZABA la
      // columna `telemetry` y borraba lo que clock_in_secure había guardado en la entrada
      // (marking_place, accuracy_meters, geofence_distance_meters, branch_center): 595 de
      // 1682 jornadas en 30 días, 38 personas. El RPC MEZCLA bajo la clave 'salida'.
      // Además devuelve `aplicado`, que es lo único que distingue "cerré la jornada" de
      // "no escribí nada porque el cron ya la había cerrado".
      const { data: rpcRows, error: updateError } = await supabase.rpc('clock_out_employee', {
        p_entry_id: activeTimeEntryId,
        p_telemetry: {
          source: 'mobile',
          platform: Platform.OS,
          ...(coords ? { gps: { lat: coords.lat, lon: coords.lon } } : { sin_ubicacion: true }),
          ...(coords?.accuracy != null ? { accuracy_meters: coords.accuracy } : {}),
        },
      });

      if (updateError) {
        // Antes esto era `Alert.alert('Error', updateError.message)`: el error crudo de Postgres
        // en la cara del colaborador. Es el patrón que puso un "permission denied for function
        // stale_clockout_limit" en un cartel rojo. La web ya traducía; la app no.
        //
        // Misma regla que /api/time-entries/clock-out: los mensajes que el RPC redacta a
        // propósito para el colaborador empiezan con `nombre_funcion:` o son validaciones de
        // negocio; esos se muestran. Los de infraestructura (permisos, función faltante, red)
        // se traducen y el detalle técnico queda en el log.
        const esErrorDeNegocio = /^[a-z_]+:/.test(updateError.message ?? '');
        console.error('[clock-out] rpc', {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          entryId: activeTimeEntryId,
        });
        Alert.alert(
          esErrorDeNegocio ? 'No se pudo marcar la salida' : 'Problema del sistema',
          esErrorDeNegocio
            ? updateError.message
            : 'No pudimos registrar tu salida por un problema del sistema. Ya quedó reportado. ' +
                'Avisale a RRHH para que registren tu hora y no pierdas el tiempo trabajado.'
        );
        return;
      }

      const updated = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as
        | {
            id?: string;
            clock_out?: string | null;
            status?: string;
            aplicado?: boolean | null;
            marking_place?: string | null;
            total_hours?: number | string | null;
          }
        | null
        | undefined;

      // `aplicado === false` = close_forgotten_entries() ya había cerrado la jornada con la
      // hora PROGRAMADA y la hora real de esta persona no se escribió. Antes esto caía en el
      // '¡Éxito!' de abajo y las horas se perdían sin que nadie se enterara.
      if (updated?.aplicado === false) {
        setClockStatusLoadError(null);
        setIsClockedIn(false);
        setActiveTimeEntryId(null);
        setActiveClockInAt(null);
        setActiveMarkingPlace(null);
        setIsOnPause(false);
        Alert.alert(
          'Tu hora de salida no quedó registrada',
          'El sistema ya había cerrado esta jornada automáticamente con la hora de fin de tu ' +
            'turno, así que la hora en que realmente saliste no se guardó. Avisá a RRHH para que ' +
            'te corrijan la jornada y no pierdas las horas trabajadas.'
        );
        return;
      }

      // tg_block_stale_clockout es un trigger BEFORE que al rechazar la salida pone
      // clock_out en NULL + status 'flagged' y retorna NEW, así que no hay error. Sin
      // mirar la fila de vuelta no hay forma de saber que la jornada quedó abierta.
      const quedoAbierta =
        updated != null && (updated.clock_out == null || updated.status === 'flagged');

      if (companyId && employeeRecordId) {
        const { error: delLiveErr } = await supabase
          .from('live_locations')
          .delete()
          .eq('employee_id', employeeRecordId)
          .eq('company_id', companyId);
        if (delLiveErr) {
          console.warn('live_locations (delete al marcar salida):', delLiveErr.message);
        }
      }

      setClockStatusLoadError(null);
      setIsClockedIn(false);
      setActiveTimeEntryId(null);
      setActiveClockInAt(null);
      setActiveMarkingPlace(null);
      setIsOnPause(false);

      if (quedoAbierta) {
        Alert.alert(
          'Jornada enviada a revisión',
          'Registramos tu marcaje, pero esta jornada llevaba demasiado tiempo abierta y el ' +
            'sistema no puede calcular tu hora de salida. Quedó enviada a RRHH para que la ' +
            'revisen y confirmen tus horas. No pierdas tu tiempo trabajado: quedó registrado.\n\n' +
            'Ya podés marcar tu entrada de hoy con normalidad.'
        );
        return;
      }

      // Horas que la base calculó para esta jornada (total_hours es columna generada). Antes se
      // mostraba solo "¡Éxito!" y la gente no sabía cuánto le quedó registrado.
      const horas = Number(updated?.total_hours);
      const textoHoras =
        Number.isFinite(horas) && horas >= 0
          ? `Jornada cerrada: ${Math.floor(horas)} h ${String(Math.round((horas % 1) * 60)).padStart(2, '0')} min.`
          : '';

      if (!coords) {
        Alert.alert(
          'Salida registrada, sin ubicación',
          (textoHoras ? `${textoHoras}\n\n` : '') +
            'Registramos tu salida y tus horas quedaron guardadas, pero no pudimos leer tu ' +
            'ubicación. RRHH va a revisar el marcaje. No perdés tu tiempo trabajado.'
        );
        return;
      }

      Alert.alert('¡Salida registrada!', textoHoras || 'Tu salida ha sido registrada en el sistema.');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'No se pudo completar el marcaje. Intenta de nuevo.');
    } finally {
      punchingRef.current = false;
      setIsPunching(false);
    }
  };

  const handlePauseToggle = async (action: 'start' | 'end') => {
    if (isPauseActionLoading || !activeTimeEntryId || !companyId || !employeeRecordId) return;
    setIsPauseActionLoading(true);
    try {
      // La ubicación de la pausa es solo referencia: sin GPS la pausa se registra igual.
      const coords = await getCurrentLocationForClockOut();

      const event = action === 'start' ? PAUSE_EVENT_START : PAUSE_EVENT_END;
      const occurred_at = new Date().toISOString();
      const { error } = await supabase.from('time_events').insert({
        time_entry_id: activeTimeEntryId,
        company_id: companyId,
        event,
        occurred_at,
        metadata: {
          source: 'mobile',
          platform: Platform.OS,
          employee_id: employeeRecordId,
          ...(coords ? { gps: { lat: coords.lat, lon: coords.lon } } : { sin_ubicacion: true }),
        },
      });

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      setIsOnPause(action === 'start');
      if (action === 'end') {
        Alert.alert('Pausa finalizada', 'Has vuelto a tu jornada.');
      } else {
        Alert.alert('Pausa iniciada', 'Tu pausa quedó registrada.');
      }
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e) || 'No se pudo registrar la pausa.');
    } finally {
      setIsPauseActionLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {isLoadingPerfil ? (
          <View style={styles.headerLoading}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={styles.loadingText}>Cargando tu perfil...</Text>
          </View>
        ) : (
          <>
            <Text style={styles.greeting}>
              Hola, {perfil?.first_name ?? 'Empleado'} 👋
            </Text>
            {!!perfil?.role && <Text style={styles.role}>{perfil.role}</Text>}
            {isLoadingClockStatus && (
              <Text style={styles.clockStatusLoading}>Verificando asistencia...</Text>
            )}
            {(() => {
              const role = perfil?.role?.toLowerCase?.();
              const isAdmin =
                FORCE_SHOW_ADMIN_PANEL ||
                role === 'admin' ||
                role === 'superadmin' ||
                role === 'manager';
              if (!isAdmin) return null;
              return (
                <TouchableOpacity
                  style={styles.adminPanelButton}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('AdminDashboard')}
                >
                  <Text style={styles.adminPanelButtonText}>
                    📊 Entrar al Panel Gerencial
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </>
        )}
      </View>

      {profileLoadError && (
        <View style={styles.homeErrorWrap}>
          <Text style={styles.homeErrorText}>{profileLoadError}</Text>
        </View>
      )}

      {clockStatusLoadError && !profileLoadError && (
        <View style={styles.homeErrorWrap}>
          <Text style={styles.homeErrorText}>{clockStatusLoadError}</Text>
        </View>
      )}

      {branchGeoLoadError && !profileLoadError && (
        <View style={styles.homeErrorWrap}>
          <Text style={styles.homeErrorText}>{branchGeoLoadError}</Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefreshHome} tintColor={theme.primary} />
        }
      >
        <View style={styles.content}>
          <CongratsBanner companyId={companyId} />
          <View style={styles.clockSectionHeader}>
            <Text style={styles.clockSectionTitle}>Reloj checador</Text>
            <TouchableOpacity
              onPress={() => setHelpGpsVisible(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Ayuda sobre privacidad y GPS"
              accessibilityRole="button"
            >
              <Ionicons name="information-circle-outline" size={24} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
          {isClockedIn && activeClockInAt ? (
            <WorkedTimeChronometer clockInAt={activeClockInAt} onPause={isOnPause} />
          ) : null}
          {/* Con varios puntos asignados, no saber en cuál quedó registrado el marcaje es
              justamente lo que dejaba la pantalla en blanco. */}
          {isClockedIn && activeMarkingPlace ? (
            <Text style={styles.markingPlaceLabel}>Marcaste en {activeMarkingPlace}</Text>
          ) : null}
          {employeeGpsConsent && gpsConsentSigned === false ? (
            <View style={styles.gpsConsentNotice}>
              <Ionicons name="location-outline" size={18} color={theme.warning} />
              <Text style={styles.gpsConsentNoticeText}>
                Tu empresa activó el rastreo de ubicación durante la jornada. No se envía nada hasta que
                aceptes el consentimiento en Mi Portal (versión web).
              </Text>
            </View>
          ) : null}
          {!isClockedIn ? (
            <TouchableOpacity
              style={[
                styles.mainButton,
                styles.mainButtonCheckedOut,
                isPunching && styles.mainButtonPunching,
              ]}
              activeOpacity={0.85}
              onPress={handleClockIn}
              disabled={isPunching || isLoadingClockStatus || isLoadingPerfil}
            >
              {isPunching ? (
                <ActivityIndicator color={theme.backgroundAlt} />
              ) : (
                <Text style={styles.mainButtonText}>📍 Marcar Entrada</Text>
              )}
            </TouchableOpacity>
          ) : isOnPause ? (
            <View style={styles.clockInColumn}>
              <TouchableOpacity
                style={[styles.pauseResumeButton, isPauseActionLoading && styles.btnMuted]}
                activeOpacity={0.85}
                onPress={() => handlePauseToggle('end')}
                disabled={isPauseActionLoading || isPunching || isLoadingClockStatus}
              >
                {isPauseActionLoading ? (
                  <ActivityIndicator color={theme.backgroundAlt} />
                ) : (
                  <Text style={styles.pauseResumeText}>▶️ Regresar de Pausa</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.mainButton,
                  styles.mainButtonCheckedIn,
                  (isPunching || isPauseActionLoading) && styles.mainButtonPunching,
                ]}
                activeOpacity={0.85}
                onPress={handleClockOut}
                disabled={isPunching || isPauseActionLoading || isLoadingClockStatus}
              >
                {isPunching ? (
                  <ActivityIndicator color={theme.backgroundAlt} />
                ) : (
                  <Text style={styles.mainButtonText}>🛑 Marcar Salida</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.clockInColumn}>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  style={[styles.secondaryRound, isPauseActionLoading && styles.btnMuted]}
                  activeOpacity={0.85}
                  onPress={() => handlePauseToggle('start')}
                  disabled={isPauseActionLoading || isPunching || isLoadingClockStatus}
                >
                  {isPauseActionLoading ? (
                    <ActivityIndicator color={theme.backgroundAlt} />
                  ) : (
                    <Text style={styles.secondaryRoundText}>⏸{'\n'}Iniciar{'\n'}Pausa</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.mainButton,
                    styles.mainButtonCheckedIn,
                    (isPunching || isPauseActionLoading) && styles.mainButtonPunching,
                  ]}
                  activeOpacity={0.85}
                  onPress={handleClockOut}
                  disabled={isPunching || isPauseActionLoading || isLoadingClockStatus}
                >
                  {isPunching ? (
                    <ActivityIndicator color={theme.backgroundAlt} />
                  ) : (
                    <Text style={styles.mainButtonText}>🛑 Marcar Salida</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.hubSection}>
          <Text style={styles.sectionTitle}>📢 Noticias del Grupo</Text>
          {announcementsLoadError ? (
            <Text style={styles.hubSectionErrorText}>{announcementsLoadError}</Text>
          ) : isLoadingHub && anuncios.length === 0 ? (
            <ActivityIndicator style={styles.sectionLoader} color={theme.primary} />
          ) : anuncios.length === 0 ? (
            <Text style={styles.emptyText}>
              No hay anuncios nuevos. ¡Que tengas un excelente turno!
            </Text>
          ) : (
            anuncios.map((anuncio, index) => {
              return (
                <View key={index} style={styles.announcementCard}>
                  <Text style={styles.announcementTitle}>{anuncio.title}</Text>
                  <Text
                    style={styles.announcementContent}
                    numberOfLines={3}
                    ellipsizeMode="tail"
                  >
                    {anuncio.content}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.hubSection}>
          <Text style={styles.sectionTitle}>Próximos Eventos</Text>
          {eventsLoadError ? (
            <Text style={styles.hubSectionErrorText}>{eventsLoadError}</Text>
          ) : isLoadingHub && eventos.length === 0 ? (
            <ActivityIndicator style={styles.sectionLoader} color={theme.primary} />
          ) : eventos.length === 0 ? (
            <Text style={styles.emptyText}>No hay eventos programados.</Text>
          ) : (
            <ScrollView
              horizontal
              style={styles.eventsScroll}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.eventsRow}
            >
              {eventos.map((evento, index) => (
                <View key={index} style={styles.eventCard}>
                  <Text style={styles.eventDate}>
                    {new Date(evento.event_date).toLocaleDateString()}
                  </Text>
                  <Text style={styles.eventTitle} numberOfLines={2} ellipsizeMode="tail">
                    {evento.title}
                  </Text>
                  {!!evento.location && (
                    <Text style={styles.eventLocation} numberOfLines={1} ellipsizeMode="tail">
                      {evento.location}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </ScrollView>

      <HelpModal
        visible={helpGpsVisible}
        onClose={() => setHelpGpsVisible(false)}
        title="Privacidad y GPS"
        content="Para garantizar tu privacidad, la aplicación solo compartirá tu ubicación mientras tengas un turno activo (desde que marcas entrada hasta que marcas salida). Recursos Humanos administra quién requiere esta función."
      />
    </View>
  );
}

/** Sombras difusas (Soft UI) para tarjetas y controles elevados — Master Palette. */
const SOFT_UI_SHADOW = Platform.select({
  ios: {
    shadowColor: theme.textPrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
  },
  android: { elevation: 3 },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    paddingTop: 18,
    paddingHorizontal: 24,
    backgroundColor: theme.background,
  },
  homeErrorWrap: {
    paddingHorizontal: 24,
    marginTop: 8,
    backgroundColor: theme.background,
  },
  homeErrorText: {
    color: theme.danger,
    fontWeight: '600',
    fontSize: 13,
  },
  headerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
  },
  loadingText: {
    fontSize: 14,
    color: theme.textMuted,
    fontWeight: '500',
  },
  greeting: {
    fontSize: 26,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  role: {
    marginTop: 6,
    fontSize: 14,
    color: theme.textMuted,
    fontWeight: '500',
  },
  clockStatusLoading: {
    marginTop: 10,
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '500',
  },
  adminPanelButton: {
    marginTop: 16,
    backgroundColor: theme.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: theme.cardBorderRadius,
    alignSelf: 'flex-start',
    ...SOFT_UI_SHADOW,
  },
  adminPanelButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
  scroll: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 32,
    backgroundColor: theme.background,
    flexGrow: 1,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    width: '100%',
    backgroundColor: theme.background,
  },
  clockSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    width: '100%',
    backgroundColor: theme.background,
  },
  clockSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  clockInColumn: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    gap: 16,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 20,
    flexWrap: 'wrap',
  },
  secondaryRound: {
    width: 120,
    height: 120,
    borderRadius: 60,
    flexShrink: 0,
    backgroundColor: theme.warning,
    alignItems: 'center',
    justifyContent: 'center',
    ...SOFT_UI_SHADOW,
  },
  secondaryRoundText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.backgroundAlt,
    textAlign: 'center',
    lineHeight: 18,
  },
  pauseResumeButton: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: theme.cardBorderRadius,
    backgroundColor: theme.warning,
    alignItems: 'center',
    justifyContent: 'center',
    ...SOFT_UI_SHADOW,
  },
  pauseResumeText: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.backgroundAlt,
  },
  btnMuted: {
    opacity: 0.75,
  },
  mainButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...SOFT_UI_SHADOW,
  },
  mainButtonCheckedOut: {
    backgroundColor: theme.success,
  },
  mainButtonCheckedIn: {
    backgroundColor: theme.danger,
  },
  mainButtonPunching: {
    opacity: 0.9,
  },
  mainButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.backgroundAlt,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  markingPlaceLabel: {
    fontSize: 13,
    color: theme.textMuted,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  gpsConsentNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.warning,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  gpsConsentNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: theme.textPrimary,
  },
  hubSection: {
    marginBottom: 24,
    backgroundColor: theme.background,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 12,
  },
  sectionLoader: {
    marginTop: 8,
  },
  hubSectionErrorText: {
    fontSize: 14,
    color: theme.danger,
    fontWeight: '600',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textMuted,
  },
  announcementCard: {
    backgroundColor: theme.surface,
    borderRadius: theme.cardBorderRadius,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
    ...SOFT_UI_SHADOW,
  },
  announcementTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 6,
  },
  announcementContent: {
    fontSize: 13,
    color: theme.textMuted,
  },
  eventsRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: theme.background,
    paddingBottom: 4,
  },
  eventsScroll: {
    backgroundColor: theme.background,
  },
  eventCard: {
    width: 200,
    backgroundColor: theme.surface,
    borderRadius: theme.cardBorderRadius,
    padding: 14,
    marginRight: 12,
    borderWidth: 1,
    borderColor: theme.border,
    ...SOFT_UI_SHADOW,
  },
  eventDate: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.primary,
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 4,
  },
  eventLocation: {
    fontSize: 12,
    color: theme.textMuted,
  },
});
