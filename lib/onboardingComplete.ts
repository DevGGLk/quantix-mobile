import { supabase } from './supabase';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

type CompletionResult = { ok: true } | { ok: false; error: string };

/** Interpreta el jsonb `{ ok, error, already_completed }` del RPC `complete_employee_onboarding`. */
function readRpcResult(data: unknown): CompletionResult {
  const res = data as { ok?: boolean; error?: string } | null;
  if (!res?.ok) {
    return { ok: false, error: res?.error ?? 'No se pudo completar la inducción. Contacta a RRHH.' };
  }
  return { ok: true };
}

/**
 * Vía canónica: llama el RPC `complete_employee_onboarding` directamente.
 * Es SECURITY DEFINER con EXECUTE para `authenticated`, así que NO depende del endpoint web
 * ni de una policy RLS de UPDATE sobre `employees` (que no existe; el `update` directo está
 * bloqueado por RLS). `employeeRowId` = fila `employees.id`, no el user de Auth.
 */
export async function completeOnboardingViaRpc(employeeRowId: string | null): Promise<CompletionResult> {
  if (!employeeRowId) {
    return { ok: false, error: 'No hay expediente vinculado. La inducción operativa solo aplica a empleados.' };
  }
  const { data, error } = await supabase.rpc('complete_employee_onboarding', {
    p_employee_id: employeeRowId,
  });
  if (error) return { ok: false, error: error.message };
  return readRpcResult(data);
}

/**
 * Fallback opcional: endpoint web (que server-side llama el MISMO RPC). Solo se intenta si
 * `EXPO_PUBLIC_QUANTIX_API_URL` está configurada. Interpreta el `ok` del payload.
 */
export async function completeOnboardingViaApi(
  profileId: string,
  companyId: string
): Promise<CompletionResult> {
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
    if (!res.ok || json?.ok !== true) {
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

export async function runOnboardingCompletion(
  profileUserId: string,
  companyId: string | null,
  employeeRowId: string | null
): Promise<void> {
  // 1) RPC directo (preferido): no depende de la API web ni de RLS de UPDATE.
  const rpc = await completeOnboardingViaRpc(employeeRowId);
  if (rpc.ok) return;

  // 2) Fallback al endpoint web solo si está configurado (también termina en el mismo RPC).
  if (API_BASE && companyId) {
    const api = await completeOnboardingViaApi(profileUserId, companyId);
    if (api.ok) return;
    console.error('[runOnboardingCompletion] RPC y API fallaron al cerrar inducción', {
      profileUserId,
      companyId,
      employeeRowId,
      rpcError: rpc.error,
      apiError: api.error,
    });
    throw new Error(api.error || rpc.error);
  }

  console.error('[runOnboardingCompletion] Error al cerrar inducción (RPC)', {
    profileUserId,
    companyId,
    employeeRowId,
    apiConfigured: Boolean(API_BASE),
    rpcError: rpc.error,
  });
  throw new Error(rpc.error);
}
