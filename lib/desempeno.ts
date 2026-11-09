/**
 * Desempeño. Copia de quantix-dashboard/lib/desempeno/tipos.ts: mantener alineadas.
 * La base valida y decide la visibilidad (RPC performance_*).
 */
import { supabase } from './supabase';

export type Relacion = 'self' | 'manager' | 'peer';
export type Competencia = { id: string; name: string; description: string | null };
export type Feedback = {
  ratings: Record<string, number>;
  comments: Record<string, string>;
  strengths: string | null;
  improvements: string | null;
  overall_rating: number | null;
  submitted_at: string | null;
};
export type PdiItem = {
  id: string;
  title: string;
  action: string | null;
  competency: string | null;
  due_date: string | null;
  status: 'pendiente' | 'en_curso' | 'hecho';
  progress_note?: string | null;
};
export type Pares = { n: number; suficiente: boolean; invitados?: number; promedios?: Record<string, number>; comentarios?: string[] };
export type Tarea = {
  review_id: string;
  relation: Relacion;
  cycle: { id: string; name: string; period_start: string; period_end: string };
  vence: string | null;
  evaluado: string;
  evaluado_nombre_ficha: string | null;
  cargo: string | null;
  sucursal: string | null;
  competencias: Competencia[];
  borrador: Feedback | null;
  enviado: string | null;
  autoevaluacion: Feedback | null;
  pares: Pares | null;
  pdi: PdiItem[] | null;
};
export type Detalle = {
  review_id: string;
  rol: 'rrhh' | 'jefe' | 'colaborador';
  cycle: { id: string; name: string; status: string; period_start: string; period_end: string; self_review: boolean; peer_review: boolean };
  evaluado: { nombre: string; cargo: string | null; sucursal: string | null };
  evaluador: string;
  competencias: Competencia[];
  autoevaluacion: Feedback | null;
  jefe: Feedback | null;
  pares: Pares | null;
  final_rating: number | null;
  acknowledged_at: string | null;
  employee_comment: string | null;
  pdi: PdiItem[];
  puede_avanzar_pdi: boolean;
  puede_firmar: boolean;
};
export type MiResultado = {
  review_id: string;
  cycle: string;
  period_start: string;
  period_end: string;
  final_rating: number | null;
  acknowledged_at: string | null;
  pdi_abiertos: number;
};

export const ESCALA = [
  { valor: 1, label: 'No cumple', ayuda: 'Rara vez lo demuestra; necesita mejorar con urgencia.' },
  { valor: 2, label: 'Cumple parcialmente', ayuda: 'Lo demuestra a veces; necesita apoyo para lograrlo.' },
  { valor: 3, label: 'Cumple', ayuda: 'Lo demuestra de forma consistente: lo esperado para el puesto.' },
  { valor: 4, label: 'Supera', ayuda: 'Va más allá de lo esperado con frecuencia.' },
  { valor: 5, label: 'Excepcional', ayuda: 'Es un referente para los demás en esto.' },
] as const;

export const etiquetaNota = (n: number | null | undefined) =>
  n == null ? '—' : (ESCALA.find((e) => e.valor === Math.round(n))?.label ?? '—');

export const ESTADO_PDI: Record<PdiItem['status'], string> = { pendiente: 'Por iniciar', en_curso: 'En curso', hecho: 'Logrado' };

export const fechaYmd = (ymd: string | null | undefined) => (ymd ? ymd.split('-').reverse().join('/') : '—');

export function mensajeError(e: { code?: string; message?: string } | null): string {
  if (e?.code === '42501') return 'No tienes permiso para esta acción.';
  return e?.message ?? 'Ocurrió un error.';
}

export async function cargarTareasPendientes(): Promise<Tarea[]> {
  const { data, error } = await supabase.rpc('performance_my_tasks');
  if (error) throw error;
  return ((data ?? []) as Tarea[]).filter((t) => !t.enviado);
}
