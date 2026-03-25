import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type CompanySettings = {
  company_id: string;
  enable_payroll_view?: boolean;
  enable_extra_hours?: boolean;
  enable_checklists?: boolean;
  [key: string]: unknown;
} | null;

export default function ServiciosScreen() {
  const navigation = useNavigation<any>();
  const [companySettings, setCompanySettings] = useState<CompanySettings>(null);
  const { employee } = useAuth();

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const companyId = employee?.company_id ?? null;
        if (!companyId) {
          if (isMounted) setCompanySettings(null);
          return;
        }

        const { data: settings, error } = await supabase
          .from('company_settings')
          .select('*')
          .eq('company_id', companyId)
          .maybeSingle();

        if (error) throw error;

        if (isMounted) {
          setCompanySettings((settings as CompanySettings) ?? null);
        }
      } catch (e) {
        console.error('Error al cargar company_settings:', e);
        if (isMounted) {
          setCompanySettings(null);
          Alert.alert(
            'Error de Conexión',
            'No pudimos cargar esta información. Por favor, revisa tu internet o intenta de nuevo más tarde.'
          );
        }
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [employee?.company_id]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Centro de Servicios</Text>

      <View style={styles.grid}>
        <TouchableOpacity
          style={[styles.card, styles.cardWide]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('MiEmpresa')}
        >
          <Ionicons name="business-outline" size={34} color={theme.primary} />
          <Text style={styles.cardLabel}>Mi Empresa</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Reglamento')}
        >
          <Ionicons name="document-text-outline" size={32} color="#475569" />
          <Text style={styles.cardLabel}>Reglamento Interno</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('NuevaSolicitud')}
        >
          <Ionicons name="paper-plane-outline" size={32} color="#2563eb" />
          <Text style={styles.cardLabel}>Nueva Solicitud</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Academia')}
        >
          <Ionicons name="school-outline" size={32} color="#10b981" />
          <Text style={styles.cardLabel}>La Academia</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Reportar')}
        >
          <Ionicons name="warning-outline" size={32} color="#ef4444" />
          <Text style={styles.cardLabel}>Reportar Incidencia</Text>
        </TouchableOpacity>

        {companySettings?.enable_checklists === true && (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Checklists')}
          >
            <Ionicons name="checkmark-done-outline" size={32} color="#00C2D1" />
            <Text style={styles.cardLabel}>Checklists Operativos</Text>
          </TouchableOpacity>
        )}

        {companySettings?.enable_payroll_view === true && (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Planilla')}
          >
            <Ionicons name="cash-outline" size={32} color="#16a34a" />
            <Text style={styles.cardLabel}>Mi Planilla</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Sugerencias')}
        >
          <Ionicons name="bulb-outline" size={32} color="#eab308" />
          <Text style={styles.cardLabel}>Buzón de Sugerencias</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('ReporteHorasExtras')}
        >
          <Ionicons name="time-outline" size={32} color="#ea580c" />
          <Text style={styles.cardLabel}>Reporte Horas Extras</Text>
        </TouchableOpacity>

        {companySettings?.enable_extra_hours === true && (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('HorasExtras')}
          >
            <Ionicons name="time-outline" size={32} color={theme.primary} />
            <Text style={styles.cardLabel}>Mis Horas Extras</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  card: {
    width: '47%',
    aspectRatio: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
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
        elevation: 3,
      },
    }),
  },
  cardWide: {
    width: '100%',
    aspectRatio: undefined,
    paddingVertical: 18,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-start',
  },
  cardLabel: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
});

