import type { SupabaseClient } from '@supabase/supabase-js';
import { gamificationYearStartIsoUtc } from './gamificationCopaPath';

/**
 * Suma puntos ganados en el año civil (`transaction_type = 'earned'`).
 * Paridad con `lib/gamification-yearly-earned.ts` del dashboard.
 */
export async function sumYearlyEarnedGamificationPoints(
  client: SupabaseClient,
  params: { employeeId: string; companyId: string; year?: number }
): Promise<{ total: number; usedTransactionTypeFilter: boolean }> {
  const year = params.year ?? new Date().getFullYear();
  const start = gamificationYearStartIsoUtc(year);
  const end = new Date().toISOString();

  const withType = await client
    .from('gamification_transactions')
    .select('amount')
    .eq('employee_id', params.employeeId)
    .eq('company_id', params.companyId)
    .eq('transaction_type', 'earned')
    .gte('created_at', start)
    .lte('created_at', end);

  if (withType.error) {
    const legacy = await client
      .from('gamification_transactions')
      .select('amount')
      .eq('employee_id', params.employeeId)
      .eq('company_id', params.companyId)
      .gte('created_at', start)
      .lte('created_at', end)
      .gt('amount', 0);

    if (legacy.error) {
      console.warn('[sumYearlyEarnedGamificationPoints]', withType.error.message, legacy.error.message);
      return { total: 0, usedTransactionTypeFilter: false };
    }

    const totalLegacy = (legacy.data ?? []).reduce(
      (acc, row) => acc + Math.max(0, Math.floor(Number((row as { amount?: number | null }).amount) || 0)),
      0
    );
    return { total: totalLegacy, usedTransactionTypeFilter: false };
  }

  const total = (withType.data ?? []).reduce(
    (acc, row) => acc + Math.max(0, Math.floor(Number((row as { amount?: number | null }).amount) || 0)),
    0
  );

  return { total, usedTransactionTypeFilter: true };
}
