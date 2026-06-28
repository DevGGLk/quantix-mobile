import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

/**
 * Felicitaciones EFÍMERAS del portal móvil (reemplazo del reconocimiento retirado).
 *
 * Dos logros evaluados al vuelo, sin tablas nuevas ni historial:
 *  - Puntualidad del mes cerrado (0 tardanzas, con marcajes ese mes). Solo se ofrece
 *    los primeros días del mes nuevo.
 *  - Checklists del período al 100% (modelo móvil: todos los checklists activos de
 *    la empresa).
 *
 * Refuerzo positivo sin habituación: se muestra UNA vez por período y se descarta
 * (AsyncStorage, sin DB). El servidor/DB no guardan nada.
 */

const PUNCTUAL_WINDOW_DAYS = 7;

type Congrat = {
  id: 'punt' | 'chk';
  storageKey: string;
  emoji: string;
  title: string;
  message: string;
};

function prevMonthRangeUtc(): { start: string; end: string; key: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start: start.toISOString(), end: end.toISOString(), key };
}

export function CongratsBanner({ companyId }: { companyId: string | null }) {
  const [items, setItems] = useState<Congrat[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!companyId) return;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .maybeSingle();
        const employeeId = (emp as { id?: string } | null)?.id;
        if (!employeeId || cancelled) return;

        const active: Congrat[] = [];

        // ── Puntualidad del mes cerrado (solo primeros días del mes nuevo) ──
        if (new Date().getDate() <= PUNCTUAL_WINDOW_DAYS) {
          const { start, end, key } = prevMonthRangeUtc();
          const { data: entries } = await supabase
            .from('time_entries')
            .select('is_late')
            .eq('employee_id', employeeId)
            .gte('clock_in', start)
            .lt('clock_in', end);
          const rows = (entries ?? []) as { is_late: boolean | null }[];
          if (rows.length > 0 && !rows.some((r) => r.is_late === true)) {
            const storageKey = `qx_congrats_punt_${key}`;
            if ((await AsyncStorage.getItem(storageKey)) !== '1') {
              active.push({
                id: 'punt',
                storageKey,
                emoji: '🎯',
                title: '¡Puntualidad perfecta!',
                message: 'No tuviste ni una tardanza el mes pasado. ¡Seguí así!',
              });
            }
          }
        }

        // ── Checklists del período al 100% ──
        const { data: cls } = await supabase
          .from('checklists')
          .select('id')
          .eq('company_id', companyId)
          .eq('is_active', true);
        const ids = ((cls ?? []) as { id: string }[]).map((c) => c.id);
        if (ids.length > 0) {
          const { data: subs } = await supabase.rpc('current_period_submissions_for_employee', {
            p_employee_id: employeeId,
            p_checklist_ids: ids,
          });
          const byChecklist = new Map<string, { pct: number; period: string }>();
          for (const row of (subs ?? []) as {
            checklist_id: string;
            completion_percentage: number | string | null;
            period_key: string | null;
          }[]) {
            if (row.checklist_id) {
              byChecklist.set(row.checklist_id, {
                pct: Math.round(Number(row.completion_percentage) || 0),
                period: row.period_key ?? '',
              });
            }
          }
          const allComplete = ids.every((id) => (byChecklist.get(id)?.pct ?? 0) >= 100);
          if (allComplete) {
            // Firma por ids+período vigente: cambia al rotar el período → re-felicita.
            const sig = ids
              .map((id) => `${id}:${byChecklist.get(id)?.period ?? ''}`)
              .sort()
              .join('|');
            const storageKey = `qx_congrats_chk_${sig}`;
            if ((await AsyncStorage.getItem(storageKey)) !== '1') {
              active.push({
                id: 'chk',
                storageKey,
                emoji: '✅',
                title: '¡Checklists al día!',
                message: 'Completaste todos tus checklists de este período. ¡Excelente!',
              });
            }
          }
        }

        if (!cancelled) setItems(active);
      } catch {
        // Efímero: ante cualquier error simplemente no se felicita (sin ruido).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const close = async (storageKey: string) => {
    try {
      await AsyncStorage.setItem(storageKey, '1');
    } catch {
      /* sin persistencia: igual se oculta en esta sesión */
    }
    setItems((prev) => prev.filter((i) => i.storageKey !== storageKey));
  };

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {items.map((it) => (
        <View key={it.id} style={styles.card}>
          <Text style={styles.emoji}>{it.emoji}</Text>
          <View style={styles.textWrap}>
            <Text style={styles.title}>{it.title}</Text>
            <Text style={styles.message}>{it.message}</Text>
          </View>
          <TouchableOpacity
            onPress={() => close(it.storageKey)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Cerrar felicitación"
          >
            <Ionicons name="close" size={18} color="#047857" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emoji: {
    fontSize: 24,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#065f46',
  },
  message: {
    marginTop: 2,
    fontSize: 12,
    color: '#047857',
    lineHeight: 16,
  },
});
