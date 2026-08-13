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
import { theme } from '../lib/theme';
import { parseBranchGeo, type BranchGeo } from '../lib/geo';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';
import { fetchMarkingPoints, nearestMarkingPoint, type MarkingPoint } from '../lib/markingPlaces';
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
  | { kind: 'ok'; timeEntryId: string | null; alreadyProcessed: boolean }
  | { kind: 'rejected'; message: string }
  | { kind: 'network'; error: string };

/**
 * M2 convergencia marcaje: el servidor (clock_in_secure vía el API) es la ÚNICA
 * autoridad. `rejected` = el servidor decidió (y auditó) el rechazo;
 * `network` = no hubo respuesta (candidato a cola offline).
 */
async function sendClockInToServer(body: ClockInSendBody): Promise<ClockInSendResult> {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.access_token) {
      return { kind: 'network', error: sessionError?.message ?? 'Sin sesión' };
    }
    const url = `${API_BASE}/api/time-entries/clock-in`;
    const res = await fetch(url, {
      method: 'POST',
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
    });
    const text = await res.text();
    const json = parseJsonObject(text);
    if (!res.ok) {
      return { kind: 'rejected', message: clockInResponseErrorMessage(json, text, res.status) };
    }
    return {
      kind: 'ok',
      timeEntryId: extractClockInTimeEntryId(json),
      alreadyProcessed: json?.already_processed === true,
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
  const [isPunching, setIsPunching] = useState(false);
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
      } catch (e: unknown) {
        console.warn('loadTodayClockStatus:', errorMessage(e));
        captureException(e, { area: 'home_clock_status', stage: 'loadTodayClockStatus' });
        if (isMounted) {
          setClockStatusLoadError(
            'No pudimos verificar tu asistencia de hoy. Revisa tu conexión o intenta más tarde.'
          );
          setIsClockedIn(false);
          setActiveTimeEntryId(null);
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
  }, [employeeRecordId, companyId, refreshPauseState]);

  /**
   * Telemetría en vivo (`live_locations`): solo con expediente, turno activo y consentimiento en `employees`.
   * `requires_live_tracking` se expone en el expediente; el envío exige consentimiento explícito (`is_gps_tracking_enabled`).
   * El intervalo respeta `gps_refresh_rate_seconds` del expediente con clamp.
   */
  useEffect(() => {
    const trackingOk = employeeGpsConsent;
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
      return;
    }

    const sendLiveLocation = async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;

      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        const speed = pos.coords.speed;
        const speedOk =
          speed != null && Number.isFinite(speed) && !Number.isNaN(speed) ? speed : null;

        const createdAt = new Date().toISOString();
        const payload: Record<string, unknown> = {
          company_id: companyId,
          employee_id: employeeRecordId,
          latitude,
          longitude,
          geog: `SRID=4326;POINT(${longitude} ${latitude})`,
          created_at: createdAt,
        };
        if (speedOk != null) {
          payload.velocity = speedOk;
        }

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

    void sendLiveLocation();

    const ms = resolveGpsPollingIntervalMs(employee?.gps_refresh_rate_seconds ?? undefined);
    gpsIntervalRef.current = setInterval(() => {
      void sendLiveLocation();
    }, ms);

    return () => {
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
        gpsIntervalRef.current = null;
      }
    };
  }, [
    isOperativeEmployee,
    employeeGpsConsent,
    employee?.gps_refresh_rate_seconds,
    isClockedIn,
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

  const getCurrentLocation = async (): Promise<{
    lat: number;
    lon: number;
    accuracy: number | null;
    mocked: boolean;
  } | null> => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permiso requerido',
        'Necesitamos acceso a tu ubicación para registrar tu entrada/salida.'
      );
      return null;
    }
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      lat: location.coords.latitude,
      lon: location.coords.longitude,
      accuracy: Number.isFinite(location.coords.accuracy ?? NaN) ? location.coords.accuracy : null,
      mocked: (location as { mocked?: boolean }).mocked === true,
    };
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
    const { sent, rejectedMessages } = await flushClockInQueue(async (item: QueuedClockIn) => {
      const r = await sendClockInToServer({
        latitude: item.latitude,
        longitude: item.longitude,
        accuracy: item.accuracy,
        isMocked: item.isMocked,
        offlineHash: item.offlineHash,
      });
      if (r.kind === 'ok') return { status: 'ok' as const };
      if (r.kind === 'rejected') return { status: 'rejected' as const, message: r.message };
      return { status: 'network' as const };
    });
    if (notify && (sent > 0 || rejectedMessages.length > 0)) {
      const parts: string[] = [];
      if (sent > 0) parts.push(`${sent} marcaje(s) offline registrados.`);
      if (rejectedMessages.length > 0) parts.push(`Rechazados: ${rejectedMessages[0]}`);
      Alert.alert('Marcajes pendientes', parts.join('\n'));
    }
    return sent;
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
    if (isPunching) return;
    setIsPunching(true);
    try {
      const coords = await getCurrentLocation();
      if (!coords) return;

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

      // M2 convergencia marcaje: pre-check ADVISORY multi-punto (mismo modelo
      // que el servidor: employee_marking_places). La decisión es del servidor.
      if (markingPoints.length > 0) {
        const nearest = nearestMarkingPoint(markingPoints, coords.lat, coords.lon);
        if (nearest && !nearest.inside) {
          const proceed = await confirmOutsideAdvisory(nearest.point.name, nearest.distanceMeters);
          if (!proceed) return;
        }
      }

      // Vaciar pendientes antes (evita "entrada ya abierta" por un replay posterior).
      await flushQueuedClockIns(false);

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
        setIsOnPause(false);
        Alert.alert('¡Éxito!', 'Tu entrada ha sido registrada en el sistema.');
        return;
      }

      if (result.kind === 'rejected') {
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
        'No hay conexión con el servidor. Tu marcaje quedó guardado en el teléfono y se registrará automáticamente al reconectar (con la hora del registro).'
      );
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'No se pudo completar el marcaje. Intenta de nuevo.');
    } finally {
      setIsPunching(false);
    }
  };

  const handleClockOut = async () => {
    if (isPunching) return;
    setIsPunching(true);
    try {
      const coords = await getCurrentLocation();
      if (!coords) return;

      if (!activeTimeEntryId) {
        Alert.alert(
          'Estado inconsistente',
          'No se encontró un marcaje activo para cerrar. Intenta de nuevo.'
        );
        return;
      }

      const nowIso = new Date().toISOString();

      let updateQ = supabase
        .from('time_entries')
        .update({
          clock_out: nowIso,
          status: 'out',
          telemetry: {
            source: 'mobile',
            platform: Platform.OS,
            gps: { lat: coords.lat, lon: coords.lon },
          },
        })
        .eq('id', activeTimeEntryId);
      if (companyId) {
        updateQ = updateQ.eq('company_id', companyId);
      }
      // .select() es obligatorio: tg_block_stale_clockout es un trigger BEFORE que al
      // rechazar la salida pone clock_out en NULL + status 'flagged' y retorna NEW, así que
      // el UPDATE no devuelve error. Sin leer la fila de vuelta no hay forma de saber que la
      // jornada quedó abierta, y el '¡Éxito!' era mentira.
      const { data: updated, error: updateError } = await updateQ
        .select('id, clock_out, status, closure_note')
        .maybeSingle();

      if (updateError) {
        Alert.alert('Error', updateError.message);
        return;
      }

      const quedoAbierta =
        updated != null &&
        ((updated as { clock_out?: string | null }).clock_out == null ||
          (updated as { status?: string }).status === 'flagged');

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

      Alert.alert('¡Éxito!', 'Tu salida ha sido registrada en el sistema.');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'No se pudo completar el marcaje. Intenta de nuevo.');
    } finally {
      setIsPunching(false);
    }
  };

  const handlePauseToggle = async (action: 'start' | 'end') => {
    if (isPauseActionLoading || !activeTimeEntryId || !companyId || !employeeRecordId) return;
    setIsPauseActionLoading(true);
    try {
      const coords = await getCurrentLocation();
      if (!coords) return;

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
          gps: { lat: coords.lat, lon: coords.lon },
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
