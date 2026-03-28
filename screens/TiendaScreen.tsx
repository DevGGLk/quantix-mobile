import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import type { GamificationBalanceRow, GamificationSettingsRow } from '../lib/gamificationRows';
import { errorMessage } from '../lib/errorMessage';

type Reward = {
  id: string;
  name: string;
  cost_points: number;
  stock?: number | null;
};

export default function TiendaScreen() {
  const { session, employee } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeDisplayName, setEmployeeDisplayName] = useState<string>('');
  const [coins, setCoins] = useState<number>(0);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedeemingId, setIsRedeemingId] = useState<string | null>(null);
  const [currencyName, setCurrencyName] = useState<string>('Coins');
  const [currencySymbol, setCurrencySymbol] = useState<string>('🪙');

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setIsLoading(true);

        const userId = session?.user?.id ?? null;
        const empRowId = employee?.id ?? null;
        if (!userId) {
          if (isMounted) {
            setCompanyId(null);
            setEmployeeId(null);
            setCoins(0);
            setRewards([]);
          }
          return;
        }

        const newCompanyId = employee?.company_id ?? null;

        let newCoins = 0;
        try {
          const { data: balanceData, error: balanceError } = empRowId
            ? await supabase
                .from('gamification_balances')
                .select('balance')
                .eq('employee_id', empRowId)
                .maybeSingle()
            : { data: null, error: null };

          if (balanceError) {
            console.error('Error en tabla gamification_balances (Tienda):', balanceError);
            Alert.alert(
              'Error de Conexión',
              'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
            );
          }

          const bal = balanceData as GamificationBalanceRow | null;
          if (bal && typeof bal.balance === 'number') {
            newCoins = bal.balance;
          }
        } catch (balanceException) {
          console.error('Excepción al leer gamification_balances (Tienda):', balanceException);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }

        if (!newCompanyId) {
          if (isMounted) {
            setCompanyId(null);
            setEmployeeId(empRowId);
            setCoins(newCoins);
            setRewards([]);
          }
          return;
        }

        // Configuración de gamificación (moneda): currency_name + symbol
        try {
          const { data: settings, error: settingsError } = await supabase
            .from('gamification_settings')
            .select('currency_name, symbol')
            .eq('company_id', newCompanyId)
            .maybeSingle();

          if (settingsError) throw settingsError;

          const srow = settings as GamificationSettingsRow | null;
          const nextName = String(srow?.currency_name ?? '').trim();
          const nextSymbol = String(srow?.symbol ?? '').trim();

          if (isMounted) {
            setCurrencyName(nextName || 'Coins');
            setCurrencySymbol(nextSymbol || '🪙');
          }
        } catch (_settingsErr) {
          if (isMounted) {
            setCurrencyName('Coins');
            setCurrencySymbol('🪙');
          }
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }

        const { data: rewardsData, error: rewardsError } = await supabase
          .from('gamification_rewards')
          .select('id, name, cost_points, stock, company_id')
          .eq('company_id', newCompanyId);

        if (rewardsError) {
          console.error('Error en tabla gamification_rewards:', rewardsError);
          throw rewardsError;
        }

        const displayName =
          [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim() ||
          'Empleado';

        if (isMounted) {
          setCompanyId(newCompanyId);
          setEmployeeId(empRowId);
          setEmployeeDisplayName(displayName);
          setCoins(newCoins);
          setRewards((rewardsData as Reward[]) ?? []);
        }
      } catch (e) {
        console.error('Error general en TiendaScreen (fetch):', e);
        Alert.alert(
          'Error de Conexión',
          'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
        );
        if (isMounted) {
          setRewards([]);
          setCoins(0);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id, employee?.id, employee?.company_id, employee?.first_name, employee?.last_name]);

  const handleCanjearPremio = async (premio: Reward) => {
    if (!employeeId || !companyId) {
      Alert.alert(
        'No disponible',
        'No se pudo verificar tu perfil o empresa. Contacta a RRHH.'
      );
      return;
    }

    if (coins < premio.cost_points) {
      Alert.alert(
        'Saldo Insuficiente',
        'Sigue acumulando puntos para este premio.'
      );
      return;
    }

    Alert.alert(
      'Confirmar canje',
      `¿Canjear ${premio.name} por ${premio.cost_points} pts?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Canjear',
          style: 'default',
          onPress: () => ejecutarCanje(premio),
        },
      ]
    );
  };

  const ejecutarCanje = async (premio: Reward) => {
    if (!employeeId || !companyId) return;
    if (isRedeemingId) return;

    try {
      setIsRedeemingId(premio.id);

      const nuevoBalance = coins - premio.cost_points;

      const { error: updateError } = await supabase
        .from('gamification_balances')
        .update({ balance: nuevoBalance })
        .eq('employee_id', employeeId);

      if (updateError) throw updateError;

      const { error: insertError } = await supabase
        .from('gamification_redemptions')
        .insert({
          company_id: companyId,
          employee_display_name: employeeDisplayName || 'Empleado',
          reward_name: premio.name,
          points_cost: premio.cost_points,
          status: 'pendiente',
        });

      if (insertError) throw insertError;

      setCoins(nuevoBalance);
      Alert.alert(
        '¡Felicidades!',
        'Tu premio ha sido solicitado. Pasa por administración para retirarlo.'
      );
    } catch (e: unknown) {
      console.error('Error en canje (Tienda):', e);
      Alert.alert('Error', errorMessage(e) || 'No se pudo completar el canje. Intenta de nuevo.');
    } finally {
      setIsRedeemingId(null);
    }
  };

  const hasRewards = rewards.length > 0;

  return (
    <>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>VIP ZONE RECOMPENSAS</Text>

          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Tus {currencyName}</Text>
            {isLoading ? (
              <ActivityIndicator color={theme.warning} />
            ) : (
              <Text style={styles.balanceValue}>
                {coins} {currencySymbol}
              </Text>
            )}
            <Text style={styles.balanceHint}>Canjea tus puntos por beneficios exclusivos</Text>
          </View>

          {isLoading && (
            <View style={styles.loaderRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.loaderText}>Cargando catálogo de premios...</Text>
            </View>
          )}

          {!isLoading && !hasRewards && (
            <Text style={styles.emptyText}>
              Aún no hay premios configurados para tu empresa. Vuelve más tarde.
            </Text>
          )}

          {hasRewards && (
            <View style={styles.grid}>
              {rewards.map((reward) => (
                <View key={reward.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{reward.name}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Costo: {reward.cost_points} pts</Text>
                  </View>
                  {typeof reward.stock === 'number' && (
                    <Text style={styles.stockText}>Stock: {reward.stock}</Text>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.redeemButton,
                      (isRedeemingId === reward.id || coins < reward.cost_points) &&
                        styles.redeemButtonDisabled,
                    ]}
                    activeOpacity={0.9}
                    onPress={() => handleCanjearPremio(reward)}
                    disabled={isRedeemingId === reward.id}
                  >
                    {isRedeemingId === reward.id ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.redeemButtonText}>Canjear Premio</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.storeBackground,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 16,
  },
  balanceCard: {
    backgroundColor: theme.accent,
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.warning,
    ...Platform.select({
      ios: {
        shadowColor: theme.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
      },
      android: { elevation: 4 },
    }),
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fefce8',
  },
  balanceValue: {
    marginTop: 8,
    fontSize: 34,
    fontWeight: '900',
    color: '#ffffff',
  },
  balanceHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#fef9c3',
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: theme.textPrimary,
  },
  grid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    width: '47%',
    backgroundColor: theme.backgroundAlt,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: { elevation: 5 },
    }),
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fef3c7',
    marginBottom: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  stockText: {
    fontSize: 12,
    color: theme.textSecondary,
    marginBottom: 10,
  },
  redeemButton: {
    marginTop: 'auto',
    backgroundColor: theme.warning,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemButtonDisabled: {
    opacity: 0.7,
  },
  redeemButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
});

