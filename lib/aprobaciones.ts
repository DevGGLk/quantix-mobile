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
  tipo: 'adelanto' | 'prestamo';
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

export async function contarPorAprobar(): Promise<number> {
  const { data } = await supabase.rpc('contar_mis_aprobaciones');
  return typeof data === 'number' ? data : 0;
}

export async function recorrido(tabla: string, refId: string): Promise<PasoRecorrido[] | null> {
  const { data, error } = await supabase.rpc('recorrido_solicitud', { p_tabla: tabla, p_ref: refId });
  if (error || !data) return null;
  return ((data as { pasos?: PasoRecorrido[] }).pasos ?? []) as PasoRecorrido[];
}

/** Aprobar o rechazar. Adelantos: directo en la base; préstamos: API web. */
export async function decidir(
  s: FilaSolicitud,
  decision: 'aprobado' | 'rechazado',
  comentario: string,
): Promise<Resultado> {
  if (s.tipo !== 'prestamo') {
    const { data, error } = await supabase.rpc('decidir_solicitud', {
      p_id: s.id,
      p_decision: decision,
      p_comentario: comentario.trim() || null,
    });
    if (error) return { ok: false, error: errorDe(error, 'No se pudo guardar.') };
    return data as Resultado;
  }
  if (!API_BASE) return { ok: false, error: 'La URL del servidor no está configurada.' };
  const { data: ses } = await supabase.auth.getSession();
  const token = ses?.session?.access_token;
  if (!token) return { ok: false, error: 'Sesión expirada. Inicia sesión de nuevo.' };
  try {
    const res = await fetch(`${API_BASE}/api/aprobaciones/decidir-prestamo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ solicitudId: s.id, decision, comentario }),
    });
    const json = (await res.json().catch(() => ({}))) as Resultado;
    if (!res.ok && !('error' in json)) return { ok: false, error: 'No se pudo guardar.' };
    return json;
  } catch {
    return { ok: false, error: 'Sin conexión. Inténtalo otra vez.' };
  }
}
