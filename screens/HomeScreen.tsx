import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { TabCompositeNavigation } from '../types/navigation';
import { captureException } from '../lib/sentry';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { haversineDistanceMeters, parseBranchGeo, type BranchGeo } from '../lib/geo';
import { useAuth } from '../lib/AuthContext';
import { errorMessage } from '../lib/errorMessage';

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
  is_urgent?: boolean;
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

async function clockInViaBackendApi(
  latitude: number,
  longitude: number
): Promise<{ ok: true; timeEntryId: string } | { ok: false; error: string }> {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.access_token) {
      return { ok: false, error: sessionError?.message ?? 'Sin sesión' };
    }
    const url = `${API_BASE}/api/time-entries/clock-in`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({ latitude, longitude }),
    });
    const text = await res.text();
    const json = parseJsonObject(text);
    if (!res.ok) {
      return {
        ok: false,
        error: clockInResponseErrorMessage(json, text, res.status),
      };
    }
    const id = extractClockInTimeEntryId(json);
    if (!id) {
      return { ok: false, error: 'Respuesta del servidor sin id de marcaje.' };
    }
    return { ok: true, timeEntryId: id };
  } catch (e: unknown) {
    return { ok: false, error: errorMessage(e) };
  }
}

function assertInsideGeofence(
  branchGeo: BranchGeo | null,
  latitude: number,
  longitude: number
): { ok: true } | { ok: false; message: string } {
  if (!branchGeo) {
    return {
      ok: false,
      message:
        'No hay geocerca configurada para tu sucursal. Contacta a RRHH para asignar sucursal y coordenadas GPS.',
    };
  }
  const d = haversineDistanceMeters(latitude, longitude, branchGeo.lat, branchGeo.lon);
  if (d > branchGeo.radiusMeters) {
    return {
      ok: false,
      message: `Estás fuera de la zona permitida (${Math.round(d)} m de tu sucursal; máximo ${Math.round(branchGeo.radiusMeters)} m). Acércate a la sucursal para marcar entrada.`,
    };
  }
  return { ok: true };
}

export default function HomeScreen() {
  const navigation = useNavigation<TabCompositeNavigation<'Home'>>();
  const { session, profile: authProfile, employee, refresh: refreshAuth } = useAuth();
  const employeeRecordId = employee?.id ?? null;
  const [perfil, setPerfil] = useState<HomePerfil | null>(null);
  const [isLoadingPerfil, setIsLoadingPerfil] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [branchGeo, setBranchGeo] = useState<BranchGeo | null>(null);
  const [anuncios, setAnuncios] = useState<CompanyAnnouncement[]>([]);
  const [eventos, setEventos] = useState<CompanyEvent[]>([]);
  const [isLoadingHub, setIsLoadingHub] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoadingClockStatus, setIsLoadingClockStatus] = useState(true);
  const [activeTimeEntryId, setActiveTimeEntryId] = useState<string | null>(null);
  const [isOnPause, setIsOnPause] = useState(false);
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

        // Refrescamos en background por si venimos de login y aún no está en memoria.
        void refreshAuth();

        const cid = employee?.company_id ?? null;
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
          // UI: usamos employees para nombres y profiles para role.
          setPerfil({
            first_name: employee?.first_name ?? null,
            last_name: employee?.last_name ?? null,
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
  }, [session?.user?.id, employee?.company_id, employee?.branch_id, employee?.first_name, employee?.last_name, authProfile?.role, refreshAuth]);

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

        let query = supabase
          .from('time_entries')
          .select('id, entry_type, clock_in, clock_out, company_id')
          .eq('employee_id', employeeRecordId)
          .eq('company_id', companyId)
          .is('clock_out', null)
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

        const last = data?.[0] as { id?: string; clock_out?: string | null } | undefined;
        const active = Boolean(last?.id) && !last?.clock_out;

        if (isMounted) {
          setIsClockedIn(active);
          const eid = active ? (last!.id as string) : null;
          setActiveTimeEntryId(eid);
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

  useEffect(() => {
    let isMounted = true;

    async function loadHubData() {
      if (!companyId) return;

      try {
        setIsLoadingHub(true);
        if (isMounted) {
          setAnnouncementsLoadError(null);
          setEventsLoadError(null);
        }

        const { data: anunciosData, error: anunciosError } = await supabase
          .from('company_announcements')
          .select('title, content, created_at, is_urgent')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(3);

        if (anunciosError) {
          console.warn('company_announcements:', anunciosError.message);
          captureException(anunciosError, { area: 'home_hub', stage: 'company_announcements' });
          if (isMounted) {
            setAnuncios([]);
            setAnnouncementsLoadError(
              'No pudimos cargar las noticias. Revisa tu conexión o intenta más tarde.'
            );
          }
        } else if (isMounted) {
          setAnnouncementsLoadError(null);
          setAnuncios((anunciosData ?? []) as CompanyAnnouncement[]);
        }

        const { data: eventosData, error: eventosError } = await supabase
          .from('company_events')
          .select('title, event_date, location')
          .eq('company_id', companyId)
          .order('event_date', { ascending: true })
          .limit(5);

        if (eventosError) {
          console.warn('company_events:', eventosError.message);
          captureException(eventosError, { area: 'home_hub', stage: 'company_events' });
          if (isMounted) {
            setEventos([]);
            setEventsLoadError(
              'No pudimos cargar los eventos. Revisa tu conexión o intenta más tarde.'
            );
          }
        } else if (isMounted) {
          setEventsLoadError(null);
          setEventos((eventosData ?? []) as CompanyEvent[]);
        }
      } catch (e: unknown) {
        console.warn('loadHubData:', errorMessage(e));
        captureException(e, { area: 'home_hub', stage: 'loadHubData' });
        if (isMounted) {
          setAnuncios([]);
          setEventos([]);
          setAnnouncementsLoadError(
            'No pudimos cargar el muro de inicio. Revisa tu conexión o intenta más tarde.'
          );
          setEventsLoadError(
            'No pudimos cargar el muro de inicio. Revisa tu conexión o intenta más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoadingHub(false);
      }
    }

    loadHubData();

    return () => {
      isMounted = false;
    };
  }, [companyId]);

  const getCurrentLocation = async (): Promise<{ lat: number; lon: number } | null> => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permiso requerido',
        'Necesitamos acceso a tu ubicación para registrar tu entrada/salida.'
      );
      return null;
    }
    const location = await Location.getCurrentPositionAsync({});
    return {
      lat: location.coords.latitude,
      lon: location.coords.longitude,
    };
  };

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

      const geo = assertInsideGeofence(branchGeo, coords.lat, coords.lon);
      if (!geo.ok) {
        Alert.alert('Fuera de la zona permitida', geo.message);
        return;
      }

      const nowIso = new Date().toISOString();

      if (API_BASE) {
        const apiResult = await clockInViaBackendApi(coords.lat, coords.lon);
        if (apiResult.ok) {
          setClockStatusLoadError(null);
          setIsClockedIn(true);
          setActiveTimeEntryId(apiResult.timeEntryId);
          setIsOnPause(false);
          Alert.alert('¡Éxito!', 'Tu entrada ha sido registrada en el sistema.');
          return;
        }
        console.warn('clock-in API fallback a Supabase:', apiResult.error);
      }

      const payload = {
        employee_id: employeeRecordId,
        company_id: companyId,
        branch_id: employee?.branch_id ?? null,
        entry_type: 'IN',
        status: 'in',
        clock_in: nowIso,
        telemetry: {
          source: 'mobile',
          platform: Platform.OS,
          gps: { lat: coords.lat, lon: coords.lon },
        },
      };

      const { data, error: insertError } = await supabase
        .from('time_entries')
        .insert(payload)
        .select('id')
        .maybeSingle();

      if (insertError) {
        Alert.alert('Error', insertError.message);
        return;
      }

      const newId = (data as { id?: string } | null)?.id ?? null;
      setClockStatusLoadError(null);
      setIsClockedIn(!!newId);
      setActiveTimeEntryId(newId);
      setIsOnPause(false);
      Alert.alert('¡Éxito!', 'Tu entrada ha sido registrada en el sistema.');
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
      const { error: updateError } = await updateQ;

      if (updateError) {
        Alert.alert('Error', updateError.message);
        return;
      }

      setClockStatusLoadError(null);
      setIsClockedIn(false);
      setActiveTimeEntryId(null);
      setIsOnPause(false);
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
            <ActivityIndicator size="small" color={theme.accent} />
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
      >
        <View style={styles.content}>
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
                <ActivityIndicator color="#fff" />
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
                  <ActivityIndicator color="#fff" />
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
                  <ActivityIndicator color="#fff" />
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
                    <ActivityIndicator color="#fff" />
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
                    <ActivityIndicator color="#fff" />
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
            <ActivityIndicator style={styles.sectionLoader} color={theme.accent} />
          ) : anuncios.length === 0 ? (
            <Text style={styles.emptyText}>
              No hay anuncios nuevos. ¡Que tengas un excelente turno!
            </Text>
          ) : (
            anuncios.map((anuncio, index) => {
              const urgente = !!anuncio.is_urgent;
              return (
                <View
                  key={index}
                  style={[
                    styles.announcementCard,
                    urgente && styles.announcementCardUrgente,
                  ]}
                >
                  {urgente && (
                    <View style={styles.announcementUrgenteBadge}>
                      <Text style={styles.announcementUrgenteIcon}>⚠️</Text>
                      <Text style={styles.announcementUrgenteLabel}>Urgente</Text>
                    </View>
                  )}
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
            <ActivityIndicator style={styles.sectionLoader} color={theme.accent} />
          ) : eventos.length === 0 ? (
            <Text style={styles.emptyText}>No hay eventos programados.</Text>
          ) : (
            <ScrollView
              horizontal
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    paddingTop: 18,
    paddingHorizontal: 24,
  },
  homeErrorWrap: {
    paddingHorizontal: 24,
    marginTop: 8,
  },
  homeErrorText: {
    color: '#EF4444',
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
    color: '#64748b',
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
    color: '#64748b',
    fontWeight: '500',
  },
  clockStatusLoading: {
    marginTop: 10,
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  adminPanelButton: {
    marginTop: 16,
    backgroundColor: theme.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignSelf: 'flex-start',
    ...Platform.select({
      ios: {
        shadowColor: theme.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
    }),
  },
  adminPanelButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 32,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  clockInColumn: {
    alignItems: 'center',
    width: '100%',
    gap: 16,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  secondaryRound: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
    }),
  },
  secondaryRoundText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 22,
  },
  pauseResumeButton: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: '#d97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseResumeText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  btnMuted: {
    opacity: 0.75,
  },
  mainButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  mainButtonCheckedOut: {
    backgroundColor: '#10b981',
  },
  mainButtonCheckedIn: {
    backgroundColor: '#ef4444',
  },
  mainButtonPunching: {
    opacity: 0.9,
  },
  mainButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  hubSection: {
    marginBottom: 24,
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
    color: '#EF4444',
    fontWeight: '600',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#94a3b8',
  },
  announcementCard: {
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  announcementTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 6,
  },
  announcementContent: {
    fontSize: 13,
    color: '#64748b',
  },
  announcementCardUrgente: {
    borderColor: '#dc2626',
    borderWidth: 2,
  },
  announcementUrgenteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  announcementUrgenteIcon: {
    fontSize: 14,
  },
  announcementUrgenteLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
  },
  eventsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  eventCard: {
    width: 200,
    backgroundColor: theme.backgroundAlt,
    borderRadius: 12,
    padding: 14,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  eventDate: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.accent,
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
    color: '#64748b',
  },
});
