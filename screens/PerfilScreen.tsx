import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// Paleta VIP Zone alineada al portal web QuantixHR
const VIP = {
  // Fondo general muy claro (área de contenido)
  bgScreen: '#F3F4F6',
  // Tarjetas y superficies principales (blanco limpio)
  cardLavender: '#FFFFFF',
  // Color protagonista de la tarjeta de saldo (teal corporativo)
  purpleDeep: '#00C2D1',
  // Texto principal sobre fondos claros
  textOnLight: '#1E293B',
  // Texto secundario/gris suave
  textMuted: '#64748B',
  // Botones de acción destacados (naranja corporativo)
  buttonGold: '#FF9F43',
  // Botón de cerrar sesión (rojo corporativo)
  buttonLogout: '#FF3F48',
} as const;

type BadgeModalType = 'star' | 'trophy' | 'ribbon' | 'rocket' | null;

type LeaderboardItem = { rank: number; name: string; coins: number };
type MissionItem = { id: string; title: string; pts: number; completed: boolean };
type InsigniaItem = { id: string; name: string; icon: string };
type BoostItem = { id: string; title: string; description: string | null };

type PerfilState = {
  nombre: string;
  cargo: string;
  puntos: number;
};

type TransaccionItem = {
  id: string;
  description: string | null;
  amount: number;
  created_at: string | null;
  [key: string]: unknown;
};

function formatTransactionDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

export default function PerfilScreen() {
  const { session, profile, employee } = useAuth();
  const navigation = useNavigation<any>();
  const [perfil, setPerfil] = useState<PerfilState>({
    nombre: '',
    cargo: '',
    puntos: 0,
  });
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [currencyName, setCurrencyName] = useState<string>('Coins');
  const [currencySymbol, setCurrencySymbol] = useState<string>('🪙');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hireDate, setHireDate] = useState<string | null>(null);
  const [vacationDays, setVacationDays] = useState<number | null>(null);
  const [funciones, setFunciones] = useState<any[]>([]);
  const [historialTransacciones, setHistorialTransacciones] = useState<TransaccionItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<BadgeModalType>(null);

  const [isModalLoading, setIsModalLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [missions, setMissions] = useState<MissionItem[]>([]);
  const [insignias, setInsignias] = useState<InsigniaItem[]>([]);
  const [boosts, setBoosts] = useState<BoostItem[]>([]);

  const openBadgeModal = (type: BadgeModalType) => {
    setSelectedBadge(type);
    setModalVisible(true);
  };

  const closeBadgeModal = () => {
    setModalVisible(false);
    setSelectedBadge(null);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadModalData() {
      if (!modalVisible || !selectedBadge) return;

      setIsModalLoading(true);
      try {
        const userId = session?.user?.id ?? null;
        if (!userId) return;

        if (selectedBadge === 'trophy') {
          if (!companyId) {
            if (isMounted) setLeaderboard([]);
            return;
          }

          // Enterprise: leaderboard por empresa usa employees como fuente de pertenencia y nombre.
          const { data: topData, error: topErr } = await supabase
            .from('gamification_balances')
            .select('employee_id, balance')
            .order('balance', { ascending: false })
            .limit(50);

          if (topErr || !Array.isArray(topData) || topData.length === 0) {
            if (isMounted) setLeaderboard([]);
            return;
          }

          const ids = topData.map((r: any) => r.employee_id).filter(Boolean);
          const { data: empRows, error: empErr } = await supabase
            .from('employees')
            .select('user_id, first_name, last_name')
            .eq('company_id', companyId)
            .in('user_id', ids);

          if (empErr || !Array.isArray(empRows) || empRows.length === 0) {
            if (isMounted) setLeaderboard([]);
            return;
          }

          const nameById = new Map(
            empRows.map((e: any) => [
              e.user_id,
              ([e.first_name, e.last_name].filter(Boolean).join(' ').trim() || 'Empleado') as string,
            ])
          );

          const filtered = topData
            .filter((b: any) => nameById.has(b.employee_id))
            .slice(0, 3)
            .map((b: any, idx: number) => ({
              rank: idx + 1,
              name: nameById.get(b.employee_id) ?? 'Empleado',
              coins: Number(b.balance) || 0,
            }));

          if (isMounted) setLeaderboard(filtered);
          return;
        }

        if (selectedBadge === 'star') {
          if (!companyId) {
            if (isMounted) setMissions([]);
            return;
          }

          // Intento 1: columna gives_points/is_active (según instrucción)
          const { data, error } = await supabase
            .from('checklists')
            .select('id,title,reward_points')
            .eq('company_id', companyId)
            .eq('is_active', true)
            .eq('gives_points', true)
            .limit(6);

          if (!error && Array.isArray(data)) {
            const mapped: MissionItem[] = data.map((c: any) => ({
              id: String(c.id),
              title: String(c.title ?? 'Checklist'),
              pts: Number(c.reward_points) || 0,
              completed: false,
            }));
            if (isMounted) setMissions(mapped);
            return;
          }

          // Fallback: checklists activas con reward_points > 0
          const { data: data2, error: error2 } = await supabase
            .from('checklists')
            .select('id,title,reward_points')
            .eq('company_id', companyId)
            .eq('is_active', true)
            .gt('reward_points', 0)
            .limit(6);

          const mapped: MissionItem[] = Array.isArray(data2)
            ? data2.map((c: any) => ({
                id: String(c.id),
                title: String(c.title ?? 'Checklist'),
                pts: Number(c.reward_points) || 0,
                completed: false,
              }))
            : [];

          if (isMounted) setMissions(mapped);
          return;
        }

        if (selectedBadge === 'ribbon') {
          const { data, error } = await supabase
            .from('employee_badges')
            .select('id, badge_name, icon_name')
            .eq('profile_id', userId)
            .order('created_at', { ascending: false });

          if (error) throw error;

          const mapped: InsigniaItem[] = Array.isArray(data)
            ? data.map((b: any) => ({
                id: String(b.id),
                name: String(b.badge_name ?? 'Insignia'),
                icon: String(b.icon_name ?? 'star'),
              }))
            : [];

          if (isMounted) setInsignias(mapped);
          return;
        }

        if (selectedBadge === 'rocket') {
          if (!companyId) {
            if (isMounted) setBoosts([]);
            return;
          }

          const nowIso = new Date().toISOString();
          const { data, error } = await supabase
            .from('gamification_boosts')
            .select('id, title, description, start_date, end_date')
            .eq('company_id', companyId)
            .eq('is_active', true)
            .lte('start_date', nowIso)
            .or(`end_date.is.null,end_date.gte.${nowIso}`)
            .order('start_date', { ascending: false })
            .limit(3);

          if (error) throw error;

          const mapped: BoostItem[] = Array.isArray(data)
            ? data.map((b: any) => ({
                id: String(b.id),
                title: String(b.title ?? 'Boost activo'),
                description: (b.description as string | null | undefined) ?? null,
              }))
            : [];

          if (isMounted) setBoosts(mapped);
          return;
        }
      } catch (e) {
        console.error('Error cargando datos del modal:', e);
        if (isMounted) {
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
        if (!isMounted) return;
        if (selectedBadge === 'trophy') setLeaderboard([]);
        if (selectedBadge === 'star') setMissions([]);
        if (selectedBadge === 'ribbon') setInsignias([]);
        if (selectedBadge === 'rocket') setBoosts([]);
      } finally {
        if (isMounted) setIsModalLoading(false);
      }
    }

    loadModalData();
    return () => {
      isMounted = false;
    };
  }, [modalVisible, selectedBadge, companyId]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      try {
        const userId = session?.user?.id ?? null;
        if (!userId) {
          if (isMounted) setPerfil({ nombre: '', cargo: '', puntos: 0 });
          return;
        }

        if (!isMounted) return;
        const nombre =
          [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim() ||
          'Empleado';
        const cargo = String(profile?.role ?? 'Colaborador') || 'Colaborador';
        const companyIdRaw = employee?.company_id ?? null;
        if (isMounted) setCompanyId(companyIdRaw);

        // Configuración de gamificación (moneda): currency_name + symbol
        try {
          if (companyIdRaw) {
            const { data: settings, error: settingsError } = await supabase
              .from('gamification_settings')
              .select('currency_name, symbol')
              .eq('company_id', companyIdRaw)
              .maybeSingle();

            if (!settingsError && isMounted) {
              const name = String((settings as any)?.currency_name ?? '').trim();
              const sym = String((settings as any)?.symbol ?? '').trim();
              setCurrencyName(name || 'Coins');
              setCurrencySymbol(sym || '🪙');
            }
          } else if (isMounted) {
            setCurrencyName('Coins');
            setCurrencySymbol('🪙');
          }
        } catch (_e) {
          if (isMounted) {
            setCurrencyName('Coins');
            setCurrencySymbol('🪙');
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }
        }

        // Enterprise: estos campos podrían vivir en employees en el futuro.
        // De momento, mantenemos defaults seguros si no están disponibles.
        const hireDateRaw = null;
        const vacationRaw = null as number | null;
        const jobTitleId = (employee?.job_title_id as string | null) ?? null;

        const vacationParsed =
          typeof vacationRaw === 'number' && Number.isFinite(vacationRaw) ? vacationRaw : 0;

        if (isMounted) {
          setHireDate(hireDateRaw);
          setVacationDays(vacationParsed);
        }

        let puntos = 0;
        try {
          const { data: balanceData, error: balanceError } = await supabase
            .from('gamification_balances')
            .select('balance')
            .eq('employee_id', userId)
            .maybeSingle();

          if (balanceError) {
            console.error('Error en tabla gamification_balances:', balanceError);
            if (isMounted) {
              Alert.alert(
                'Error de Conexión',
                'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
              );
            }
          }

          if (balanceData && typeof (balanceData as any).balance === 'number') {
            puntos = (balanceData as any).balance as number;
          }
        } catch (balanceException) {
          console.error('Excepción al leer gamification_balances:', balanceException);
          if (isMounted) {
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }
        }

        setPerfil({ nombre, cargo, puntos });
        // Enterprise: avatar ya no vive en employees; si sigue existiendo en profiles,
        // podemos migrarlo más adelante. Por ahora mantenemos null para evitar acoplamiento.
        setAvatarUrl(null);

        try {
          if (jobTitleId) {
            let funcionesData: any[] | null = null;
            let funcionesError: any = null;

            // Hardening: si la tabla soporta scope por empresa, lo aplicamos.
            if (companyIdRaw) {
              const scopedRes = await supabase
                .from('job_functions')
                .select('*')
                .eq('job_title_id', jobTitleId)
                .eq('company_id', companyIdRaw);

              if (!scopedRes.error) {
                funcionesData = scopedRes.data as any[] | null;
              } else {
                // Fallback compatible si la columna company_id no existe en esta tabla.
                const fallbackRes = await supabase
                  .from('job_functions')
                  .select('*')
                  .eq('job_title_id', jobTitleId);
                funcionesData = fallbackRes.data as any[] | null;
                funcionesError = fallbackRes.error;
              }
            } else {
              const fallbackRes = await supabase
                .from('job_functions')
                .select('*')
                .eq('job_title_id', jobTitleId);
              funcionesData = fallbackRes.data as any[] | null;
              funcionesError = fallbackRes.error;
            }

            if (funcionesError) {
              console.error('Error en tabla job_functions:', funcionesError);
              if (isMounted) {
                Alert.alert(
                  'Error de Conexión',
                  'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
                );
              }
            } else if (isMounted) {
              setFunciones(funcionesData ?? []);
            }
          } else if (isMounted) {
            setFunciones([]);
          }
        } catch (fnException) {
          console.error('Excepción al leer job_functions:', fnException);
          if (isMounted) setFunciones([]);
          if (isMounted) {
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }
        }

        try {
          const { data: txData, error: txError } = await supabase
            .from('gamification_transactions')
            .select('*')
            .eq('employee_id', userId)
            .order('created_at', { ascending: false })
            .limit(5);

          if (!txError && isMounted) {
            setHistorialTransacciones((txData ?? []) as TransaccionItem[]);
          } else if (isMounted) {
            setHistorialTransacciones([]);
          }
        } catch (txException) {
          console.error('Excepción al leer gamification_transactions:', txException);
          if (isMounted) setHistorialTransacciones([]);
          if (isMounted) {
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }
        }
      } catch (_e) {
        if (isMounted) {
          setPerfil({ nombre: '', cargo: '', puntos: 0 });
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo cerrar sesión. Intenta de nuevo.';
      Alert.alert('Error', message);
    }
  };

  const formattedHireDate =
    hireDate && !Number.isNaN(Date.parse(hireDate))
      ? new Date(hireDate).toLocaleDateString('es-ES', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : null;

  return (
    <>
      <StatusBar style="dark" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.vipTitle}>VIP ZONE</Text>
        {/* Sección 1: Cabecera de Perfil */}
        <View style={styles.headerCard}>
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={VIP.purpleDeep} />
            <Text style={styles.loadingText}>Cargando...</Text>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={28} color={VIP.textMuted} />
                </View>
              )}
            </View>

            <View style={styles.headerMeta}>
              <Text style={styles.name}>{perfil.nombre || 'Empleado'}</Text>
              <Text style={styles.role}>{perfil.cargo || 'Colaborador'}</Text>
            </View>
          </View>
        )}
        </View>

        {/* Sección 2: Tarjeta de moneda VIP */}
        <View style={styles.coinsCard}>
          <View style={styles.coinsTop}>
            <View style={styles.coinsBadge}>
              <Ionicons name="trophy" size={18} color={VIP.buttonGold} />
              <Text style={styles.coinsBadgeText}>{currencyName || 'Coins'}</Text>
            </View>
            <Text style={styles.currencySymbol}>{currencySymbol || '🪙'}</Text>
          </View>

          <Text style={styles.coinsValue}>{perfil.puntos}</Text>
          <Text style={styles.coinsSub}>Tus puntos VIP acumulados</Text>
        </View>

        <View style={styles.badgesRow}>
          <TouchableOpacity
            style={styles.badgeCircle}
            activeOpacity={0.8}
            onPress={() => openBadgeModal('star')}
          >
            <Ionicons name="star-outline" size={22} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.badgeCircle}
            activeOpacity={0.8}
            onPress={() => openBadgeModal('trophy')}
          >
            <Ionicons name="trophy-outline" size={22} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.badgeCircle}
            activeOpacity={0.8}
            onPress={() => openBadgeModal('ribbon')}
          >
            <Ionicons name="ribbon-outline" size={22} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.badgeCircle}
            activeOpacity={0.8}
            onPress={() => openBadgeModal('rocket')}
          >
            <Ionicons name="rocket-outline" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <Modal
          visible={modalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeBadgeModal}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeBadgeModal}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              {selectedBadge === 'star' && (
                <>
                  <Text style={styles.modalTitle}>⭐ Misiones Diarias</Text>
                  <View style={styles.modalMisionesList}>
                    {isModalLoading ? (
                      <View style={styles.modalLoaderRow}>
                        <ActivityIndicator size="small" color={VIP.purpleDeep} />
                        <Text style={styles.modalLoaderText}>Cargando misiones...</Text>
                      </View>
                    ) : missions.length === 0 ? (
                      <Text style={styles.modalEmptyText}>Aún no hay datos registrados.</Text>
                    ) : (
                      missions.map((m) => (
                        <View key={m.id} style={styles.misionRow}>
                          <View style={[styles.misionCheck, m.completed && styles.misionCheckDone]}>
                            {m.completed && (
                              <Ionicons name="checkmark" size={14} color="#ffffff" />
                            )}
                          </View>
                          <Text style={styles.misionTitle} numberOfLines={2}>{m.title}</Text>
                          <Text style={styles.misionPts}>{m.pts} pts</Text>
                        </View>
                      ))
                    )}
                  </View>
                </>
              )}
              {selectedBadge === 'trophy' && (
                <>
                  <Text style={styles.modalTitle}>🏆 Ranking {currencyName || 'Coins'}</Text>
                  <View style={styles.leaderboardList}>
                    {isModalLoading ? (
                      <View style={styles.modalLoaderRow}>
                        <ActivityIndicator size="small" color={VIP.purpleDeep} />
                        <Text style={styles.modalLoaderText}>Cargando ranking...</Text>
                      </View>
                    ) : leaderboard.length === 0 ? (
                      <Text style={styles.modalEmptyText}>Aún no hay datos registrados.</Text>
                    ) : (
                      leaderboard.map((p) => (
                        <View key={p.rank} style={styles.leaderboardRow}>
                          <Text style={styles.leaderboardRank}>#{p.rank}</Text>
                          <Text style={styles.leaderboardName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.leaderboardCoins}>{p.coins} pts</Text>
                        </View>
                      ))
                    )}
                  </View>
                </>
              )}
              {selectedBadge === 'ribbon' && (
                <>
                  <Text style={styles.modalTitle}>🏅 Vitrina de Insignias</Text>
                  <View style={styles.insigniasGrid}>
                    {isModalLoading ? (
                      <View style={styles.modalLoaderRow}>
                        <ActivityIndicator size="small" color={VIP.purpleDeep} />
                        <Text style={styles.modalLoaderText}>Cargando insignias...</Text>
                      </View>
                    ) : insignias.length === 0 ? (
                      <Text style={styles.modalEmptyText}>Aún no hay datos registrados.</Text>
                    ) : (
                      insignias.map((ins) => (
                        <View key={ins.id} style={styles.insigniaItem}>
                          <View style={styles.insigniaIconWrap}>
                            <Ionicons
                              name={(ins.icon as keyof typeof Ionicons.glyphMap) ?? 'star'}
                              size={28}
                              color={VIP.purpleDeep}
                            />
                          </View>
                          <Text style={styles.insigniaName} numberOfLines={2}>{ins.name}</Text>
                        </View>
                      ))
                    )}
                  </View>
                </>
              )}
              {selectedBadge === 'rocket' && (
                <>
                  <Text style={styles.modalTitle}>🚀 Boosts Activos</Text>
                  {isModalLoading ? (
                    <View style={styles.modalLoaderRow}>
                      <ActivityIndicator size="small" color={VIP.purpleDeep} />
                      <Text style={styles.modalLoaderText}>Cargando boosts...</Text>
                    </View>
                  ) : boosts.length === 0 ? (
                    <Text style={styles.modalEmptyText}>Aún no hay datos registrados.</Text>
                  ) : (
                    <View style={styles.boostCard}>
                      <Text style={styles.boostLabel}>{boosts[0]?.title ?? 'Evento activo'}</Text>
                      {!!boosts[0]?.description && (
                        <Text style={styles.boostTitle}>{boosts[0]?.description}</Text>
                      )}
                      <View style={styles.boostBadge}>
                        <Text style={styles.boostBadgeText}>¡Aprovecha!</Text>
                      </View>
                    </View>
                  )}
                </>
              )}
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={closeBadgeModal}
                activeOpacity={0.9}
              >
                <Text style={styles.modalCloseText}>Cerrar</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        <TouchableOpacity
          style={styles.storeButton}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Tienda')}
        >
          <Text style={styles.storeButtonText}>CANJEAR MIS PUNTOS</Text>
        </TouchableOpacity>

        {/* Sección 3: Historial Reciente */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Historial Reciente</Text>
          <Text style={styles.sectionHint}>Últimos movimientos</Text>
        </View>

        <View style={styles.historyCard}>
          {historialTransacciones.length === 0 ? (
            <Text style={styles.historyEmpty}>Aún no tienes movimientos de puntos.</Text>
          ) : (
            historialTransacciones.map((item) => {
              const amount = Number(item.amount) || 0;
              const positive = amount > 0;
              const title = item.description?.trim() || 'Movimiento';
              const dateStr = formatTransactionDate(item.created_at);
              return (
                <View key={item.id} style={styles.historyRow}>
                  <View style={[styles.historyDot, positive ? styles.dotGreen : styles.dotRed]} />
                  <View style={styles.historyText}>
                    <Text style={styles.historyTitle}>{title}</Text>
                    <Text style={styles.historySub}>{dateStr}</Text>
                  </View>
                  <Text style={[styles.points, positive ? styles.pointsGreen : styles.pointsRed]}>
                    {positive ? `+${amount}` : `${amount}`} pts
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* Sección 4: Mi Expediente Laboral */}
        <View style={styles.laborSectionHeader}>
          <Text style={styles.laborTitle}>Mi Expediente Laboral</Text>
        </View>

        <View style={styles.laborCard}>
          <Text style={styles.laborLabel}>
            Fecha de ingreso:{' '}
            <Text style={styles.laborValue}>
              {formattedHireDate ?? 'No registrado'}
            </Text>
          </Text>
          <Text style={styles.laborLabel}>
            Días de Vacaciones Disponibles:{' '}
            <Text style={styles.laborValue}>
              {typeof vacationDays === 'number' ? vacationDays : 0}
            </Text>
          </Text>
        </View>

        {funciones.length > 0 && (
          <View style={styles.functionsCard}>
            <Text style={styles.functionsTitle}>Mis Responsabilidades</Text>
            {funciones.map((fn, index) => {
              const key = fn.id ?? index;
              const text =
                fn.name ??
                fn.title ??
                fn.description ??
                'Responsabilidad de puesto';
              return (
                <View key={key} style={styles.functionRow}>
                  <Text style={styles.functionBullet}>•</Text>
                  <Text style={styles.functionText}>{text}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Sección 4: Cerrar Sesión */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color="#ffffff" />
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VIP.bgScreen,
  },
  content: {
    padding: 20,
    paddingBottom: 28,
    gap: 16,
  },
  vipTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: VIP.textOnLight,
    letterSpacing: 3,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  headerCard: {
    backgroundColor: VIP.cardLavender,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 4 },
    }),
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
  },
  loadingText: {
    color: VIP.textMuted,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
  },
  avatar: {
    width: 56,
    height: 56,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMeta: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  role: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: VIP.textMuted,
  },
  coinsCard: {
    backgroundColor: VIP.purpleDeep,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: VIP.buttonGold,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: VIP.purpleDeep,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
      },
      android: { elevation: 4 },
    }),
  },
  coinsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  coinsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: VIP.buttonGold,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  coinsBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  coinsValue: {
    marginTop: 18,
    fontSize: 46,
    fontWeight: '900',
    color: '#fefce8',
    letterSpacing: 0.4,
  },
  coinsSub: {
    marginTop: 6,
    fontSize: 13,
    color: '#fef9c3',
    fontWeight: '600',
  },
  currencySymbol: {
    fontSize: 22,
    fontWeight: '800',
    color: '#facc15',
  },
  badgesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: VIP.cardLavender,
  },
  badgeCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: VIP.purpleDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeButton: {
    marginTop: 16,
    backgroundColor: VIP.buttonGold,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: VIP.buttonGold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },
  storeButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  sectionHeader: {
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  sectionHint: {
    marginTop: 4,
    fontSize: 12,
    color: VIP.textMuted,
    fontWeight: '600',
  },
  historyCard: {
    backgroundColor: VIP.cardLavender,
    borderRadius: 16,
    borderWidth: 0,
    paddingVertical: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  historyEmpty: {
    fontSize: 13,
    color: VIP.textOnLight,
    fontStyle: 'italic',
    paddingHorizontal: 14,
    paddingVertical: 16,
    textAlign: 'center',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: VIP.cardLavender,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: {
    backgroundColor: '#22c55e',
  },
  dotRed: {
    backgroundColor: '#ef4444',
  },
  historyText: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: VIP.textOnLight,
  },
  historySub: {
    marginTop: 4,
    fontSize: 12,
    color: VIP.textMuted,
    fontWeight: '600',
  },
  points: {
    fontSize: 13,
    fontWeight: '900',
  },
  pointsGreen: {
    color: '#10b981',
  },
  pointsRed: {
    color: '#ef4444',
  },
  logoutButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: VIP.buttonLogout,
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: VIP.buttonLogout,
  },
  logoutText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  laborSectionHeader: {
    marginTop: 24,
  },
  laborTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
  laborCard: {
    marginTop: 10,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  laborLabel: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 6,
  },
  laborValue: {
    fontWeight: '700',
    color: '#111827',
  },
  functionsCard: {
    marginTop: 16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  functionsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  functionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  functionBullet: {
    marginRight: 6,
    fontSize: 12,
    color: '#4b5563',
    marginTop: 1,
  },
  functionText: {
    flex: 1,
    fontSize: 13,
    color: '#4b5563',
  },
  // ——— Modal VIP (badges) ———
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
    }),
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: VIP.textOnLight,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalCloseButton: {
    marginTop: 20,
    backgroundColor: VIP.purpleDeep,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  modalMisionesList: {
    gap: 12,
  },
  modalLoaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  modalLoaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: VIP.textMuted,
  },
  modalEmptyText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: VIP.textMuted,
    paddingVertical: 10,
  },
  misionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  misionCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: VIP.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  misionCheckDone: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  misionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: VIP.textOnLight,
  },
  misionPts: {
    fontSize: 13,
    fontWeight: '700',
    color: VIP.purpleDeep,
  },
  leaderboardList: {
    gap: 10,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: VIP.bgScreen,
    borderRadius: 12,
    gap: 10,
  },
  leaderboardRank: {
    fontSize: 14,
    fontWeight: '800',
    color: VIP.purpleDeep,
    minWidth: 28,
  },
  leaderboardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: VIP.textOnLight,
  },
  leaderboardCoins: {
    fontSize: 14,
    fontWeight: '800',
    color: VIP.buttonGold,
  },
  insigniasGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  insigniaItem: {
    width: '47%',
    backgroundColor: VIP.cardLavender,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d4c4dc',
  },
  insigniaIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  insigniaName: {
    fontSize: 12,
    fontWeight: '700',
    color: VIP.textOnLight,
    textAlign: 'center',
  },
  boostCard: {
    backgroundColor: VIP.cardLavender,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: VIP.purpleDeep,
  },
  boostLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: VIP.purpleDeep,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  boostTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: VIP.textOnLight,
    lineHeight: 22,
  },
  boostBadge: {
    alignSelf: 'flex-start',
    marginTop: 12,
    backgroundColor: VIP.buttonGold,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  boostBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: VIP.textOnLight,
  },
});

