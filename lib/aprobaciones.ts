/**
 * Adelantos y bandeja «Por aprobar» (motor de aprobación «Quién aprueba qué»).
 * Mismas funciones de la base que usa la web (/mi-portal/adelantos y /mi-portal/por-aprobar).
 * Los préstamos se deciden por la API web (al cerrar la ruta hay que crear el préstamo).
 */
import { supabase } from './supabase';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

export type Resultado = { ok: true; mensaje?: string; estado?: string; id?: string } | { ok: false; error: string };

export type InfoAdelanto = {
  ok: boolean;
  error?: string;
  politica: { max_cuotas: number; tope_porcentaje: number; uno_a_la_vez: boolean; portal_habilitado: boolean };
  salario_mensual: number | null;
  disponible: number;
  bloqueo: string | null;
  quien_aprueba: { etiqueta: string; nombres: string[] | null }[];
};

export type Adelanto = {
  id: string;
  total: number;
  recuperado: number;
  cuota: number;
  cuotas: number;
  periodo: string;
  motivo: string | null;
  estado: 'pending' | 'active' | 'completed' | 'cancelled' | 'defaulted' | 'rejected' | 'withdrawn';
  creado: string;
  aprobado: string | null;
  motivo_cierre: string | null;
  descuentos: number;
  en_manos_de: string[] | null;
  etiqueta_paso: string | null;
  tiene_recorrido: boolean;
};

export type FilaSolicitud = {
  id: string;
  tipo: 'adelanto' | 'prestamo' | 'vacaciones' | 'permiso' | 'horas_extra' | 'finiquito' | 'cambio_laboral' | 'cambio_turno';
  escalada?: boolean;
  ref_tabla: string;
  ref_id: string;
  resumen: string;
  monto: number | null;
  estado: string;
  colaborador: string | null;
  pidio: string | null;
  paso_actual: number;
  total_pasos: number;
  etiqueta_paso: string | null;
  nota_paso: string | null;
  en_manos_de: string[];
  por_suplencia_de: string | null;
  me_toca: boolean;
  vencida: boolean;
  created_at: string;
  detalle: Record<string, number | string | null> | null;
};

export type PasoRecorrido = {
  orden: number;
  etiqueta: string;
  nota: string | null;
  modo: string;
  nombres: string[];
  situacion: 'aprobado' | 'en_curso' | 'en_pausa' | 'rechazado' | 'no_llego' | 'espera';
  decisiones: {
    quien: string;
    en_nombre_de: string | null;
    decision: string;
    comentario: string | null;
    cuando: string;
    autorizacion_propia: boolean;
  }[];
};

export const fmtC = (n: number) =>
  `C$ ${Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function errorDe(e: unknown, def: string): string {
  return e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string'
    ? 'No se pudo completar. Revisa tu conexión e inténtalo otra vez.'
    : def;
}

export async function miInfoAdelanto(): Promise<InfoAdelanto | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('mi_info_adelanto');
  if (error) return { ok: false, error: errorDe(error, 'No se pudo cargar.') };
  return data as InfoAdelanto;
}

export async function misAdelantos(): Promise<Adelanto[] | null> {
  const { data, error } = await supabase.rpc('mis_adelantos');
  return error ? null : ((data as Adelanto[] | null) ?? []);
}

export async function solicitarAdelanto(monto: number, cuotas: number, motivo: string): Promise<Resultado> {
  const { data, error } = await supabase.rpc('solicitar_adelanto', {
    p_monto: monto,
    p_cuotas: cuotas,
    p_motivo: motivo.trim() || null,
  });
  if (error) return { ok: false, error: errorDe(error, 'No se pudo enviar.') };
  return data as Resultado;
}

export async function retirarAdelanto(id: string): Promise<Resultado> {
  const { data, error } = await supabase.rpc('retirar_adelanto', { p_id: id });
  if (error) return { ok: false, error: errorDe(error, 'No se pudo retirar.') };
  return data as Resultado;
}

export async function misPorAprobar(): Promise<FilaSolicitud[] | null> {
  const { data, error } = await supabase.rpc('mis_aprobaciones_pendientes', { p_tipo: null });
  return error ? null : ((data as FilaSolicitud[] | null) ?? []);
}

/** Checklists que me toca revisar (los decide el responsable del negocio, no la ruta). */
export async function contarChecklistsPorRevisar(): Promise<number> {
  const { data } = await supabase.rpc('checklist_por_revisar');
  return Array.isArray(data) ? data.length : 0;
}

export async function contarPorAprobar(): Promise<number> {
  const { data } = await supabase.rpc('contar_mis_aprobaciones');
  return typeof data === 'number' ? data : 0;
}

export async function recorrido(tabla: string, refId: string): Promise<PasoRecorrido[] | null> {
  const { data, error } = await supabase.rpc('recorrido_solicitud', { p_tabla: tabla, p_ref: refId });
  if (error || !data) return null;
  return ((data as { pasos?: PasoRecorrido[] }).pasos ?? []) as PasoRecorrido[];
}

async function postWeb(path: string, body: unknown): Promise<Resultado> {
  if (!API_BASE) return { ok: false, error: 'La URL del servidor no está configurada.' };
  const { data: ses } = await supabase.auth.getSession();
  const token = ses?.session?.access_token;
  if (!token) return { ok: false, error: 'Sesión expirada. Inicia sesión de nuevo.' };
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Resultado;
    if (!res.ok && !('error' in json)) return { ok: false, error: 'No se pudo guardar.' };
    return json;
  } catch {
    return { ok: false, error: 'Sin conexión. Inténtalo otra vez.' };
  }
}

/**
 * Aprobar o rechazar. Adelantos y horas extra: directo en la base. Vacaciones y permisos: la
 * misma puerta de la web (libro de días, saldo, aviso al colaborador). Préstamos: API web.
 */
export async function decidir(
  s: FilaSolicitud,
  decision: 'aprobado' | 'rechazado',
  comentario: string,
): Promise<Resultado> {
  if (s.tipo === 'cambio_turno') {
    // Revisa que los turnos no cambiaron; al cerrarse la ruta aplica y publica el horario.
    const { error } = await supabase.rpc(s.ref_tabla === 'open_shifts' ? 'resolve_open_shift' : 'resolve_shift_swap', {
      p_id: s.ref_id,
      p_approve: decision === 'aprobado',
      p_note: comentario.trim() || null,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (s.tipo === 'cambio_laboral') {
    // Valida que el cargo/salario no cambió y mantiene al día los pasos del módulo.
    const { data, error } = await supabase.rpc('decidir_cambio_laboral', {
      p_request_id: s.ref_id,
      p_aprobar: decision === 'aprobado',
      p_nota: comentario.trim() || null,
    });
    if (error) return { ok: false, error: error.message };
    const r = data as { status?: string; rige_desde?: string | null; mensaje?: string | null } | null;
    return {
      ok: true,
      mensaje:
        r?.status === 'aprobada' ? `Aprobado. Rige desde el ${r.rige_desde ?? '—'}.`
        : r?.status === 'rechazada' ? 'Rechazado. Se le avisó a RRHH.'
        : r?.mensaje ?? 'Tu aprobación quedó registrada; pasa al siguiente paso.',
    };
  }
  if (s.tipo === 'vacaciones' || s.tipo === 'permiso') {
    const r = await postWeb('/api/time-off/decide', {
      requestId: s.ref_id,
      decision: decision === 'aprobado' ? 'aprobada' : 'rechazada',
      reason: comentario.trim() || null,
    });
    if (r.ok && decision === 'aprobado' && s.total_pasos > s.paso_actual) {
      return { ok: true, mensaje: 'Tu aprobación quedó registrada; pasa al siguiente paso.' };
    }
    return r;
  }
  if (s.tipo !== 'prestamo') {
    const { data, error } = await supabase.rpc('decidir_solicitud', {
      p_id: s.id,
      p_decision: decision,
      p_comentario: comentario.trim() || null,
    });
    if (error) return { ok: false, error: errorDe(error, 'No se pudo guardar.') };
    return data as Resultado;
  }
  return postWeb('/api/aprobaciones/decidir-prestamo', { solicitudId: s.id, decision, comentario });
}
