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

  const { error } = await supabase.rpc('assign_gamification_points', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_amount: amount,
    p_description: description,
    p_transaction_type: input.transactionType ?? 'earned',
  });

  return { error: error ? { message: error.message } : null };
}
