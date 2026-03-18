import React, { useEffect, useState } from 'react';
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
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

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
    // No bloqueamos el inicio de sesión, pero dejamos un rastro claro para devs.
    console.warn('Fallo al registrar Push Token:', e?.message ?? String(e));
  }
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [perfil, setPerfil] = useState<any>(null);
  const [isLoadingPerfil, setIsLoadingPerfil] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [anuncios, setAnuncios] = useState<any[]>([]);
  const [eventos, setEventos] = useState<any[]>([]);
  const [isLoadingHub, setIsLoadingHub] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoadingClockStatus, setIsLoadingClockStatus] = useState(true);
  const [activeTimeEntryId, setActiveTimeEntryId] = useState<string | null>(null);
  const [isPunching, setIsPunching] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPerfil() {
      setIsLoadingPerfil(true);
      try {
        setHomeError(null);
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        const userId = userData.user?.id;
        if (!userId) {
          if (isMounted) {
            setPerfil(null);
            setProfileId(null);
            setCompanyId(null);
          }
          return;
        }
        if (isMounted) setProfileId(userId);
        registerForPushNotificationsAsync(userId);

        const { data, error } = await supabase
          .from('profiles')
          .select('first_name,last_name,role,company_id')
          .eq('id', userId)
          .single();

        if (error) throw error;
        if (isMounted) {
          setPerfil(data ?? null);
          setCompanyId((data as any)?.company_id ?? null);
        }
      } catch (_e: any) {
        if (isMounted) {
          setPerfil(null);
          setProfileId(null);
          setCompanyId(null);
          setHomeError(
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
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

  useEffect(() => {
    let isMounted = true;

    async function loadTodayClockStatus() {
      try {
        setHomeError(null);
        setIsLoadingClockStatus(true);

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const currentProfileId = profileId ?? userData.user?.id ?? null;
        if (!currentProfileId) {
          if (isMounted) setIsClockedIn(false);
          return;
        }

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        const { data, error } = await supabase
          .from('time_entries')
          .select('id, entry_type, clock_in, clock_out')
          .eq('profile_id', currentProfileId)
          .gte('clock_in', start.toISOString())
          .lt('clock_in', end.toISOString())
          .order('clock_in', { ascending: false })
          .limit(1);

        if (error) throw error;
        const last = data?.[0] as { id?: string; entry_type?: string; clock_out?: string | null } | undefined;
        // Si la última entrada de hoy es de tipo IN y no tiene clock_out, consideramos que está “marcado dentro”.
        if (isMounted) {
          const lastType = last?.entry_type;
          const hasClockOut = Boolean(last?.clock_out);
          const active = lastType === 'IN' && !hasClockOut && !!last?.id;
          setIsClockedIn(active);
          setActiveTimeEntryId(active ? (last!.id as string) : null);
        }
      } catch (_e: any) {
        if (isMounted) {
          setIsClockedIn(false);
          setHomeError(
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoadingClockStatus(false);
      }
    }

    loadTodayClockStatus();
    return () => {
      isMounted = false;
    };
  }, [profileId]);

  useEffect(() => {
    let isMounted = true;

    async function loadHubData() {
      if (!companyId) return;

      try {
        setHomeError(null);
        setIsLoadingHub(true);

        const { data: anunciosData, error: anunciosError } = await supabase
          .from('company_announcements')
          .select('title, content, created_at, is_urgent')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(3);

        if (anunciosError) throw anunciosError;

        const { data: eventosData, error: eventosError } = await supabase
          .from('company_events')
          .select('title, event_date, location')
          .eq('company_id', companyId)
          .order('event_date', { ascending: true })
          .limit(5);

        if (eventosError) throw eventosError;

        if (isMounted) {
          setAnuncios(anunciosData ?? []);
          setEventos(eventosData ?? []);
        }
      } catch (_e: any) {
        if (isMounted) {
          setAnuncios([]);
          setEventos([]);
          setHomeError(
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
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

  const handlePunch = async () => {
    if (isPunching) return;

    setIsPunching(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso requerido',
          'Necesitamos acceso a tu ubicación para registrar tu entrada/salida.'
        );
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      const latitude = location.coords.latitude;
      const longitude = location.coords.longitude;

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
        Alert.alert(
          'Error de configuración',
          'No tienes una empresa asignada en tu perfil.'
        );
        return;
      }
      const nowIso = new Date().toISOString();
      const punchType = isClockedIn ? 'OUT' : 'IN';

      if (punchType === 'IN') {
        const payload = {
          profile_id: currentProfileId,
          company_id: companyId,
          entry_type: 'gps_mobile',
          status: 'in',
          clock_in: nowIso,
          telemetry: {
            source: 'mobile',
            platform: Platform.OS,
            gps: { lat: latitude, lon: longitude },
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
        setIsClockedIn(true);
        setActiveTimeEntryId(newId);
        Alert.alert('¡Éxito!', 'Tu entrada ha sido registrada en el sistema.');
      } else {
        if (!activeTimeEntryId) {
          Alert.alert(
            'Estado inconsistente',
            'No se encontró un marcaje activo para cerrar. Intenta de nuevo.'
          );
          return;
        }

        const { error: updateError } = await supabase
          .from('time_entries')
          .update({
            clock_out: nowIso,
            status: 'out',
            telemetry: {
              source: 'mobile',
              platform: Platform.OS,
              gps: { lat: latitude, lon: longitude },
            },
          })
          .eq('id', activeTimeEntryId);

        if (updateError) {
          Alert.alert('Error', updateError.message);
          return;
        }

        setIsClockedIn(false);
        setActiveTimeEntryId(null);
        Alert.alert('¡Éxito!', 'Tu salida ha sido registrada en el sistema.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'No se pudo completar el marcaje. Intenta de nuevo.');
    } finally {
      setIsPunching(false);
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

      {homeError && (
        <View style={styles.homeErrorWrap}>
          <Text style={styles.homeErrorText}>{homeError}</Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <TouchableOpacity
            style={[
              styles.mainButton,
              isClockedIn ? styles.mainButtonCheckedIn : styles.mainButtonCheckedOut,
              isPunching && styles.mainButtonPunching,
            ]}
            activeOpacity={0.85}
            onPress={handlePunch}
            disabled={isPunching || isLoadingClockStatus || isLoadingPerfil}
          >
            {isPunching ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.mainButtonText}>
                {isClockedIn ? '🛑 Marcar Salida' : '📍 Marcar Entrada'}
              </Text>
            )}
          </TouchableOpacity>
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

