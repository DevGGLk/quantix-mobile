/**
 * Encuestas (clima, eNPS, 360). Copia de quantix-dashboard/lib/encuestas/tipos.ts: mantener
 * alineadas. La base valida todo otra vez (survey_responses_preparar) y pone el segmento.
 */
import { supabase } from './supabase';

export type TipoPregunta = 'likert' | 'rating' | 'enps' | 'choice' | 'text';

export type Pregunta = {
  id: string;
  label: string;
  type: TipoPregunta;
  options?: string[];
  dimension?: string;
  key?: string;
  required?: boolean;
};

export type ValorRespuesta = string | number;

export type EncuestaPendiente = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  survey_type: 'clima' | 'evaluacion_360';
  questions: Pregunta[];
  closes_at: string | null;
  ya_respondi: boolean;
  evaluados: string[];
};

export type Colega = { profile_id: string; nombre: string };

export type AccionCompartida = {
  id: string;
  title: string;
  detail: string | null;
  status: 'pendiente' | 'en_curso' | 'hecho';
  due_date: string | null;
  surveys: { title: string } | null;
};

export const ESCALA_ACUERDO = [
  'Totalmente en desacuerdo',
  'En desacuerdo',
  'Neutral',
  'De acuerdo',
  'Totalmente de acuerdo',
] as const;

export function esObligatoria(q: Pregunta): boolean {
  return q.required ?? q.type !== 'text';
}

export function faltantes(preguntas: Pregunta[], respuestas: Record<string, ValorRespuesta | undefined>): Pregunta[] {
  return preguntas.filter((q) => {
    if (!esObligatoria(q)) return false;
    const v = respuestas[q.id];
    if (v === undefined || v === null || v === '') return true;
    if (q.type === 'rating' || q.type === 'likert') return !(Number(v) >= 1 && Number(v) <= 5);
    if (q.type === 'enps') return !(Number(v) >= 0 && Number(v) <= 10);
    return false;
  });
}

export function limpiarRespuestas(
  preguntas: Pregunta[],
  respuestas: Record<string, ValorRespuesta | undefined>,
): Record<string, ValorRespuesta> {
  const out: Record<string, ValorRespuesta> = {};
  for (const q of preguntas) {
    const v = respuestas[q.id];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      if (v.trim()) out[q.id] = v.trim();
    } else if (q.type === 'enps' || v >= 1) {
      out[q.id] = v;
    }
  }
  return out;
}

export function mensajeErrorRespuesta(e: { code?: string; message?: string } | null, es360: boolean): string {
  if (e?.code === '23505') return es360 ? 'Ya evaluaste a esta persona en esta encuesta.' : 'Ya respondiste esta encuesta.';
  if (e?.code === '42501') return 'Esta encuesta no está disponible para ti.';
  return e?.message ?? 'No se pudo enviar la respuesta.';
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** «vie 14/11 17:00» en hora de Managua (UTC−6 fijo, sin horario de verano). */
export function cierreCorto(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const l = new Date(ms - 6 * 3600_000);
  const hh = String(l.getUTCHours()).padStart(2, '0');
  const mm = String(l.getUTCMinutes()).padStart(2, '0');
  return `${DIAS[l.getUTCDay()]} ${l.getUTCDate()}/${l.getUTCMonth() + 1} ${hh}:${mm}`;
}

export async function cargarPendientes(companyId?: string | null): Promise<EncuestaPendiente[]> {
  const { data, error } = await supabase.rpc('my_pending_surveys');
  if (error) throw error;
  const todas = (data ?? []) as EncuestaPendiente[];
  const cid = companyId?.trim();
  return cid ? todas.filter((s) => s.company_id === cid) : todas;
}
