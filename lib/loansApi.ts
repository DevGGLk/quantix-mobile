/**
 * Cliente de la API de préstamos (envuelve las server actions del dashboard vía HTTP Bearer).
 * Endpoints en quantix-dashboard/app/api/loans/*. Requiere EXPO_PUBLIC_QUANTIX_API_URL.
 */
import { supabase } from './supabase';
import type { PeriodType } from './loans/amortization';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

export type LoanPolicy = {
  id: string;
  company_id: string;
  min_amount: number;
  max_amount: number;
  max_term_periods: number;
  default_period_type: PeriodType;
  default_annual_interest_rate: number;
  ley185_safety_buffer_percent: number;
  default_amortization_method: 'french' | 'declining_balance' | 'zero_interest';
};

export type LoanCalculatorContext = {
  employeeId: string;
  companyId: string;
  bruto: number;
  hireDate: string | null;
  netEstimate: { bruto: number; inssLaboral: number; irMensual: number; neto: number };
  existingMonthlyDeductions: number;
  policy: LoanPolicy;
};

export type LoanRequestRow = {
  id: string;
  employee_id: string;
  company_id: string;
  status: string;
  requested_principal: number;
  requested_term_periods: number;
  requested_period_type: string;
  reason: string;
  proposed_principal: number | null;
  proposed_term_periods: number | null;
  proposed_period_type: string | null;
  proposed_rate_snapshot: number | null;
  snapshot_rate_monthly: number;
  snapshot_rate_annual: number;
  decision_reason: string | null;
  expires_at: string | null;
  resulting_loan_id: string | null;
  created_at: string;
  updated_at: string;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
export type ApiResult<T> = Ok<T> | Err;

// ─── Pagos de préstamos (staging loan_payment_submissions) ──────────────────
export type LoanPaymentType = 'voluntary_external' | 'extraordinary' | 'early_settlement';
export type LoanPaymentMethod = 'cash' | 'bank_transfer' | 'check';

export type ActiveLoan = {
  id: string;
  company_id: string;
  remaining_balance: number;
  principal_amount: number | null;
  total_amount: number;
  installment_amount: number;
  period_type: string | null;
  annual_interest_rate: number | null;
  status: string;
  start_date: string | null;
};

export type LoanPaymentSubmission = {
  id: string;
  loan_id: string;
  payment_type: LoanPaymentType;
  amount_total: number;
  payment_date: string;
  method: LoanPaymentMethod;
  status: 'pending' | 'confirmed' | 'rejected';
  rejection_reason: string | null;
  receipt_pdf_url: string | null;
  notes: string | null;
  submitted_at: string;
  created_at: string;
};

export type SettlementQuote = {
  remaining_principal: number;
  accrued_interest: number;
  settlement_total: number;
  as_of_date: string;
  days_accrued: number;
};

export type PickedFile = { uri: string; name: string; type: string };

async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) return null;
    return data.session.access_token;
  } catch {
    return null;
  }
}

async function authedFetch(path: string, init?: RequestInit): Promise<ApiResult<Record<string, unknown>>> {
  if (!API_BASE) {
    return { ok: false, error: 'La URL del servidor no está configurada (EXPO_PUBLIC_QUANTIX_API_URL).' };
  }
  let token: string | null = null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) {
      return { ok: false, error: 'Sesión expirada. Inicia sesión de nuevo.' };
    }
    token = data.session.access_token;
  } catch {
    return { ok: false, error: 'No se pudo obtener la sesión.' };
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!res.ok || json.ok === false) {
      const msg = typeof json.error === 'string' ? json.error : `Error del servidor (${res.status}).`;
      return { ok: false, error: msg };
    }
    return json as ApiResult<Record<string, unknown>>;
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' };
  }
}

export async function fetchLoanContext(): Promise<ApiResult<{ ctx: LoanCalculatorContext }>> {
  return authedFetch('/api/loans/context', { method: 'GET' }) as Promise<ApiResult<{ ctx: LoanCalculatorContext }>>;
}

export async function fetchLoanTier(
  companyId: string,
  amount: number,
): Promise<ApiResult<{ rate_monthly: number; rate_annual: number; frequencies_allowed: string[] }>> {
  const qs = `?amount=${encodeURIComponent(String(amount))}&companyId=${encodeURIComponent(companyId)}`;
  return authedFetch(`/api/loans/tier${qs}`, { method: 'GET' }) as Promise<
    ApiResult<{ rate_monthly: number; rate_annual: number; frequencies_allowed: string[] }>
  >;
}

export async function submitLoanRequest(input: {
  principal: number;
  termPeriods: number;
  periodType: PeriodType;
  reason: string;
}): Promise<ApiResult<{ requestId: string }>> {
  return authedFetch('/api/loans/request', {
    method: 'POST',
    body: JSON.stringify(input),
  }) as Promise<ApiResult<{ requestId: string }>>;
}

export async function fetchMyLoanRequests(): Promise<ApiResult<{ requests: LoanRequestRow[] }>> {
  return authedFetch('/api/loans/my-requests', { method: 'GET' }) as Promise<
    ApiResult<{ requests: LoanRequestRow[] }>
  >;
}

export async function acceptCounterOffer(
  requestId: string,
): Promise<ApiResult<Record<string, unknown>>> {
  return authedFetch('/api/loans/accept-counter-offer', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
}

export async function withdrawLoanRequest(
  requestId: string,
): Promise<ApiResult<Record<string, unknown>>> {
  return authedFetch('/api/loans/withdraw', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  });
}

// ─── Préstamos activos (lectura directa; RLS limita a los propios) ──────────
export async function fetchMyActiveLoans(): Promise<ApiResult<{ loans: ActiveLoan[] }>> {
  try {
    const { data, error } = await supabase
      .from('employee_loans')
      .select('id, company_id, remaining_balance, principal_amount, total_amount, installment_amount, period_type, annual_interest_rate, status, start_date')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, loans: (data ?? []) as ActiveLoan[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al cargar préstamos.' };
  }
}

// ─── Registrar pago (multipart con comprobante OBLIGATORIO) → queda pending ──
export async function submitLoanPayment(input: {
  loanId: string;
  amount: number;
  paymentType: LoanPaymentType;
  method: LoanPaymentMethod;
  paymentDate: string;
  recalcMode?: 'reduce_term' | 'reduce_payment';
  notes?: string;
  file: PickedFile;
}): Promise<ApiResult<{ submissionId: string }>> {
  if (!API_BASE) return { ok: false, error: 'La URL del servidor no está configurada.' };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Sesión expirada. Inicia sesión de nuevo.' };

  const fd = new FormData();
  fd.append('loanId', input.loanId);
  fd.append('amount', String(input.amount));
  fd.append('paymentType', input.paymentType);
  fd.append('method', input.method);
  fd.append('paymentDate', input.paymentDate);
  if (input.recalcMode) fd.append('recalcMode', input.recalcMode);
  if (input.notes) fd.append('notes', input.notes);
  // Forma de archivo de React Native (uri/name/type).
  fd.append('file', { uri: input.file.uri, name: input.file.name, type: input.file.type } as unknown as Blob);

  try {
    const res = await fetch(`${API_BASE}/api/loans/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }, // sin Content-Type: RN fija el boundary multipart
      body: fd,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = {}; }
    if (!res.ok || json.ok === false) {
      const msg = typeof json.error === 'string' ? json.error : `Error del servidor (${res.status}).`;
      return { ok: false, error: msg };
    }
    return json as ApiResult<{ submissionId: string }>;
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' };
  }
}

export async function fetchMyLoanPayments(loanId?: string): Promise<ApiResult<{ submissions: LoanPaymentSubmission[] }>> {
  const qs = loanId ? `?loanId=${encodeURIComponent(loanId)}` : '';
  return authedFetch(`/api/loans/payments/mine${qs}`, { method: 'GET' }) as Promise<
    ApiResult<{ submissions: LoanPaymentSubmission[] }>
  >;
}

export async function quoteLoanSettlement(loanId: string, paymentDate?: string): Promise<ApiResult<{ quote: SettlementQuote }>> {
  return authedFetch('/api/loans/payments/quote', {
    method: 'POST',
    body: JSON.stringify({ loanId, paymentDate }),
  }) as Promise<ApiResult<{ quote: SettlementQuote }>>;
}

export async function signLoanPaymentFileUrl(
  submissionId: string,
  kind: 'comprobante' | 'recibo',
): Promise<ApiResult<{ signedUrl: string }>> {
  return authedFetch(`/api/loans/payments/${submissionId}/file?kind=${kind}`, { method: 'GET' }) as Promise<
    ApiResult<{ signedUrl: string }>
  >;
}

// ─── Helpers de presentación ───────────────────────────────────────────────
export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  voluntary_external: 'Abono voluntario',
  extraordinary: 'Abono extraordinario',
  early_settlement: 'Liquidación anticipada',
};
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  bank_transfer: 'Transferencia',
  check: 'Cheque',
};
export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  pending: 'En revisión',
  confirmed: 'Confirmado',
  rejected: 'Rechazado',
};
export function submissionStatusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'pending':   return { bg: '#FEF3C7', fg: '#92400E' };
    case 'confirmed': return { bg: '#D1FAE5', fg: '#065F46' };
    case 'rejected':  return { bg: '#FEE2E2', fg: '#991B1B' };
    default:          return { bg: '#F1F5F9', fg: '#475569' };
  }
}

export const PERIOD_LABELS: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

export const LOAN_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente de revisión',
  counter_offered: 'Contraoferta recibida',
  accepted_by_employee: 'Aceptada — en aprobación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  withdrawn: 'Retirada',
};

export function loanStatusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'pending':
      return { bg: '#FEF3C7', fg: '#92400E' };
    case 'counter_offered':
      return { bg: '#DBEAFE', fg: '#1E40AF' };
    case 'accepted_by_employee':
      return { bg: '#E0E7FF', fg: '#3730A3' };
    case 'approved':
      return { bg: '#D1FAE5', fg: '#065F46' };
    case 'rejected':
      return { bg: '#FEE2E2', fg: '#991B1B' };
    case 'withdrawn':
      return { bg: '#F1F5F9', fg: '#475569' };
    default:
      return { bg: '#F1F5F9', fg: '#475569' };
  }
}

export function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
