import { supabase } from './supabase';

/** Alineado con el tope del dashboard (`MAX_SINGLE_POSITIVE_AWARD_POINTS`). */
export const MAX_SINGLE_POSITIVE_AWARD_POINTS = 10_000;

/**
 * Abono de puntos vía RPC `assign_gamification_points` (balance + transacción en BD).
 * `p_employee_id` debe ser `employees.id`, no el usuario de Auth.
 */
export async function assignGamificationPointsRpc(input: {
  companyId: string;
  employeeId: string;
  amount: number;
  description: string;
  transactionType?: string;
}): Promise<{ error: { message: string } | null }> {
  const companyId = input.companyId.trim();
  const employeeId = input.employeeId.trim();
  const description = input.description.trim();
  if (!companyId || !employeeId || !description) {
    return { error: { message: 'Parámetros de gamificación incompletos.' } };
  }

  const amount = Math.trunc(Number(input.amount) || 0);
  if (amount === 0) {
    return { error: null };
  }

  const common = {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_description: description,
    p_transaction_type: input.transactionType ?? 'earned',
  } as const;

  let { error } = await supabase.rpc('assign_gamification_points', {
    ...common,
    p_amount: amount,
  });

  // RPCs o dumps antiguos: firma con `p_points` o INSERT interno que aún referencia `points` vs `amount`.
  if (error) {
    const pe = error as { code?: string; message?: string; details?: string | null };
    const blob = `${pe.message ?? ''} ${pe.details ?? ''}`;
    const tryLegacy =
      pe.code === '42883' ||
      /\bp_amount\b|\bp_points\b|assign_gamification_points|column .*"\s*points\s*"|column .*points.*does not exist|column .*amount.*does not exist/i.test(
        blob
      );
    if (tryLegacy) {
      const second = await supabase.rpc('assign_gamification_points', {
        ...common,
        p_points: amount,
      } as Record<string, string | number>);
      error = second.error;
    }
  }

  return { error: error ? { message: error.message } : null };
}
