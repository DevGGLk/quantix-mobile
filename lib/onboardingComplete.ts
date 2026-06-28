import { supabase } from './supabase';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

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
 * Fallback si el endpoint no está disponible: marca la inducción como completada.
 * `employeeRowId` = fila `employees.id`, no el user de Auth.
 * (La economía de puntos fue retirada: ya no se otorgan puntos por la inducción.)
 */
export async function completeOnboardingFallback(
  profileUserId: string,
  employeeRowId: string | null
): Promise<void> {
  if (!employeeRowId) {
    console.warn(
      '[onboardingComplete] Fallback sin expediente (`employees.id`). La inducción operativa solo aplica a empleados.',
      { profileUserId }
    );
    return;
  }

  try {
    const { error: upErr } = await supabase
      .from('employees')
      .update({ onboarding_completed: true })
      .eq('id', employeeRowId);
    if (upErr) throw upErr;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[onboardingComplete] Fallo al marcar inducción en `employees`', {
      table: 'employees',
      column: 'onboarding_completed',
      employeeRowId,
      hint: 'Verifica migración y RLS de UPDATE en expedientes.',
      message: msg,
      raw: e,
    });
    throw e;
  }
}

export async function runOnboardingCompletion(
  profileUserId: string,
  companyId: string | null,
  employeeRowId: string | null
): Promise<void> {
  try {
    if (API_BASE && companyId) {
      const api = await completeOnboardingViaApi(profileUserId, companyId);
      if (api.ok) return;
      console.warn('onboarding API fallback:', api.error);
    }
    await completeOnboardingFallback(profileUserId, employeeRowId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[runOnboardingCompletion] Error al cerrar inducción', {
      profileUserId,
      companyId,
      employeeRowId,
      apiConfigured: Boolean(API_BASE),
      message: msg,
      raw: e,
    });
    throw e;
  }
}
