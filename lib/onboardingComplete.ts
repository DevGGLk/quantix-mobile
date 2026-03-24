import { supabase } from './supabase';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

const REWARD_POINTS = 1000;

export async function completeOnboardingViaApi(): Promise<
  { ok: true } | { ok: false; error: string }
> {
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
 * Fallback si el endpoint no está disponible: marca perfil y otorga puntos como en Academia/Tienda.
 */
export async function completeOnboardingFallback(userId: string): Promise<void> {
  const { error: upErr } = await supabase
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', userId);
  if (upErr) throw upErr;

  const { data: balanceRow } = await supabase
    .from('gamification_balances')
    .select('balance')
    .eq('employee_id', userId)
    .maybeSingle();

  const currentBalance = (balanceRow as { balance?: number } | null)?.balance ?? 0;
  const newBalance = currentBalance + REWARD_POINTS;

  const { error: balErr } = await supabase.from('gamification_balances').upsert(
    { employee_id: userId, balance: newBalance },
    { onConflict: 'employee_id' }
  );
  if (balErr) throw balErr;

  const { error: txErr } = await supabase.from('gamification_transactions').insert({
    employee_id: userId,
    description: 'Inducción corporativa completada',
    amount: REWARD_POINTS,
  });
  if (txErr) throw txErr;
}

export async function runOnboardingCompletion(userId: string): Promise<void> {
  if (API_BASE) {
    const api = await completeOnboardingViaApi();
    if (api.ok) return;
    console.warn('onboarding API fallback:', api.error);
  }
  await completeOnboardingFallback(userId);
}
