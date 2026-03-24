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
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { haversineDistanceMeters, parseBranchGeo, type BranchGeo } from '../lib/geo';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const FORCE_SHOW_ADMIN_PANEL = false;

/** Debe coincidir con el esquema / web (time_events). */
const PAUSE_EVENT_START = 'pause_start';
const PAUSE_EVENT_END = 'pause_end';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

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
    await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
  } catch (e: any) {
    console.warn('Fallo al registrar Push Token:', e?.message ?? String(e));
  }
}

async function fetchPauseState(timeEntryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('time_events')
    .select('*')
    .eq('time_entry_id', timeEntryId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('time_events (lectura pausa):', error.message);
    return false;
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  const last = String(row?.event_type ?? row?.type ?? row?.kind ?? '');
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
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg =
        json?.error ??
        json?.message ??
        (text?.slice(0, 200) || `HTTP ${res.status}`);
      return { ok: false, error: String(msg) };
    }
    const id =
      json?.timeEntryId ??
      json?.time_entry_id ??
      json?.id ??
      json?.data?.id ??
      null;
    if (!id) {
      return { ok: false, error: 'Respuesta del servidor sin id de marcaje.' };
    }
    return { ok: true, timeEntryId: String(id) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
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
  const navigation = useNavigation<any>();
  const [perfil, setPerfil] = useState<any>(null);
  const [isLoadingPerfil, setIsLoadingPerfil] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [branchGeo, setBranchGeo] = useState<BranchGeo | null>(null);
  const [anuncios, setAnuncios] = useState<any[]>([]);
  const [eventos, setEventos] = useState<any[]>([]);
  const [isLoadingHub, setIsLoadingHub] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoadingClockStatus, setIsLoadingClockStatus] = useState(true);
  const [activeTimeEntryId, setActiveTimeEntryId] = useState<string | null>(null);
  const [isOnPause, setIsOnPause] = useState(false);
  const [isPunching, setIsPunching] = useState(false);
  const [isPauseActionLoading, setIsPauseActionLoading] = useState(false);
  /** Solo fallo crítico del perfil (bloquea nombre / empresa). */
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPerfil() {
      setIsLoadingPerfil(true);
      try {
        setProfileLoadError(null);
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        const userId = userData.user?.id;
        if (!userId) {
          if (isMounted) {
            setPerfil(null);
            setProfileId(null);
            setCompanyId(null);
            setBranchGeo(null);
          }
          return;
        }
        if (isMounted) setProfileId(userId);
        registerForPushNotificationsAsync(userId);

        const { data, error } = await supabase
          .from('profiles')
          .select('first_name,last_name,role,company_id,primary_branch_id')
          .eq('id', userId)
          .single();

        if (error) throw error;

        const cid = (data as any)?.company_id ?? null;
        const pbid = (data as any)?.primary_branch_id ?? null;

        if (pbid && cid) {
          const { data: branchRow, error: branchErr } = await supabase
            .from('branches')
            .select('*')
            .eq('id', pbid)
            .eq('company_id', cid)
            .maybeSingle();
          if (branchErr) {
            console.warn('branches (geocerca):', branchErr.message);
            if (isMounted) setBranchGeo(null);
          } else if (isMounted) {
            setBranchGeo(parseBranchGeo(branchRow as Record<string, unknown>));
          }
        } else if (isMounted) {
          setBranchGeo(null);
        }

        if (isMounted) {
          setPerfil(data ?? null);
          setCompanyId(cid);
        }
      } catch (_e: any) {
        if (isMounted) {
          setPerfil(null);
          setProfileId(null);
          setCompanyId(null);
          setBranchGeo(null);
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
  }, []);

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

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) {
          console.warn('clock status auth:', userError.message);
          if (isMounted) {
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }
        const currentProfileId = profileId ?? userData.user?.id ?? null;
        if (!currentProfileId) {
          if (isMounted) {
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }

        if (!companyId) {
          if (isMounted) {
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }

        let query = supabase
          .from('time_entries')
          .select('id, entry_type, clock_in, clock_out, company_id')
          .eq('profile_id', currentProfileId)
          .eq('company_id', companyId)
          .is('clock_out', null)
          .order('clock_in', { ascending: false })
          .limit(1);

        const { data, error } = await query;

        if (error) {
          console.warn('time_entries (estado reloj):', error.message);
          if (isMounted) {
            setIsClockedIn(false);
            setActiveTimeEntryId(null);
            setIsOnPause(false);
          }
          return;
        }

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
      } catch (e: any) {
        console.warn('loadTodayClockStatus:', e?.message ?? e);
        if (isMounted) {
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
  }, [profileId, companyId, refreshPauseState]);

  useEffect(() => {
    let isMounted = true;

    async function loadHubData() {
      if (!companyId) return;

      try {
        setIsLoadingHub(true);

        const { data: anunciosData, error: anunciosError } = await supabase
          .from('company_announcements')
          .select('title, content, created_at, is_urgent')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(3);

        if (anunciosError) {
          console.warn('company_announcements:', anunciosError.message);
          if (isMounted) setAnuncios([]);
        } else if (isMounted) {
          setAnuncios(anunciosData ?? []);
        }

        const { data: eventosData, error: eventosError } = await supabase
          .from('company_events')
          .select('title, event_date, location')
          .eq('company_id', companyId)
          .order('event_date', { ascending: true })
          .limit(5);

        if (eventosError) {
          console.warn('company_events:', eventosError.message);
          if (isMounted) setEventos([]);
        } else if (isMounted) {
          setEventos(eventosData ?? []);
        }
      } catch (e: any) {
        console.warn('loadHubData:', e?.message ?? e);
        if (isMounted) {
          setAnuncios([]);
          setEventos([]);
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

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        Alert.alert('Error', userError.message);
        return;
      }

      const currentProfileId = profileId ?? userData.user?.id ?? null;
      if (!currentProfileId) {
        Alert.alert('Sesión inválida', 'No se pudo obtener el perfil del empleado.');
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
          setIsClockedIn(true);
          setActiveTimeEntryId(apiResult.timeEntryId);
          setIsOnPause(false);
          Alert.alert('¡Éxito!', 'Tu entrada ha sido registrada en el sistema.');
          return;
        }
        console.warn('clock-in API fallback a Supabase:', apiResult.error);
      }

      const payload = {
        profile_id: currentProfileId,
        company_id: companyId,
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
    if (isPauseActionLoading || !activeTimeEntryId || !companyId || !profileId) return;
    setIsPauseActionLoading(true);
    try {
      const coords = await getCurrentLocation();
      if (!coords) return;

      const eventType = action === 'start' ? PAUSE_EVENT_START : PAUSE_EVENT_END;
      const { error } = await supabase.from('time_events').insert({
        time_entry_id: activeTimeEntryId,
        company_id: companyId,
        profile_id: profileId,
        event_type: eventType,
        telemetry: {
          source: 'mobile',
          platform: Platform.OS,
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
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo registrar la pausa.');
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
          {isLoadingHub && anuncios.length === 0 ? (
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
          {isLoadingHub && eventos.length === 0 ? (
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
