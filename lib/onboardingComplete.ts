import { supabase } from './supabase';
import { assignGamificationPointsRpc } from './assignGamificationPointsRpc';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

const REWARD_POINTS = 1000;

export async function completeOnboardingViaApi(
  profileId: string,
  companyId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!API_BASE) {
    return { ok: false, error: 'API no configurada' };
  }
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.access_token) {
      return { ok: false, error: sessionError?.message ?? 'Sin sesión' };
    }
    const res = await fetch(`${API_BASE}/api/onboarding/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({ profile_id: profileId, company_id: companyId }),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg =
        (json?.error as string) ??
        (json?.message as string) ??
        text?.slice(0, 200) ??
        `HTTP ${res.status}`;
      return { ok: false, error: String(msg) };
    }
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { ok: false, error: err?.message ?? String(e) };
  }
}

/**
 * Fallback si el endpoint no está disponible: marca perfil y otorga puntos.
 * `employeeRowId` = fila `employees.id` (FK en gamificación), no el user de Auth.
 */
export async function completeOnboardingFallback(
  profileUserId: string,
  employeeRowId: string | null
): Promise<void> {
  const { error: upErr } = await supabase
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', profileUserId);
  if (upErr) throw upErr;

  if (!employeeRowId) {
    console.warn('onboarding fallback: sin employees.id; se omiten puntos de gamificación.');
    return;
  }

  const { data: empRow, error: empLookupErr } = await supabase
    .from('employees')
    .select('company_id')
    .eq('id', employeeRowId)
    .maybeSingle();
  if (empLookupErr) throw empLookupErr;

  const companyId = String((empRow as { company_id?: string | null } | null)?.company_id ?? '').trim();
  if (!companyId) {
    console.warn('onboarding fallback: expediente sin company_id; se omiten puntos de gamificación.');
    return;
  }

  const { error: rpcError } = await assignGamificationPointsRpc({
    companyId,
    employeeId: employeeRowId,
    amount: REWARD_POINTS,
    description: 'Inducción corporativa completada',
    transactionType: 'earned',
  });
  if (rpcError) {
    console.error('Error al asignar puntos (onboarding):', rpcError);
    throw new Error(rpcError.message);
  }
}

export async function runOnboardingCompletion(
  profileUserId: string,
  companyId: string | null,
  employeeRowId: string | null
): Promise<void> {
  if (API_BASE && companyId) {
    const api = await completeOnboardingViaApi(profileUserId, companyId);
    if (api.ok) return;
    console.warn('onboarding API fallback:', api.error);
  }
  await completeOnboardingFallback(profileUserId, employeeRowId);
}
