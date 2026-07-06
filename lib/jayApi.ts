/**
 * Cliente del asistente Jay (IA). Envuelve el endpoint del dashboard `POST /api/ai/chat`
 * vía HTTP Bearer (mismo backend que la web `/mi-portal/asistente`). Requiere
 * EXPO_PUBLIC_QUANTIX_API_URL. El endpoint autentica por JWT de Supabase (no cookies),
 * resuelve el expediente del empleado por user_id y corre Gemini con tool-calling acotado
 * por rol/RLS. Respuesta JSON plana (no streaming). Ver [[mobile-build-deploy]].
 */
import { supabase } from './supabase';

const API_BASE = (process.env.EXPO_PUBLIC_QUANTIX_API_URL ?? '').replace(/\/$/, '');

/** Mensaje del historial que se envía al backend (solo role + content). */
export type JayChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/** Herramienta ejecutada por Jay en un turno (para pintar badges). */
export type JayToolCall = {
  name: string;
  ok: boolean;
  error?: string | null;
};

export type JayChatResult =
  | {
      ok: true;
      message: { role: 'assistant'; content: string };
      tool_calls: JayToolCall[];
    }
  | { ok: false; error: string };

/** Límites del backend (parseClientMessages): historial y tamaño por mensaje. */
const MAX_HISTORY = 30;
const MAX_CONTENT_CHARS = 4000;

/**
 * Envía el historial a Jay y devuelve su respuesta. El último mensaje DEBE ser del usuario
 * (lo garantiza quien llama). Recorta a los últimos 30 mensajes y 4000 chars c/u para no
 * chocar con la validación del servidor.
 */
export async function sendJayChat(history: JayChatMessage[]): Promise<JayChatResult> {
  if (!API_BASE) {
    return { ok: false, error: 'El asistente no está configurado (falta EXPO_PUBLIC_QUANTIX_API_URL).' };
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

  const messages: JayChatMessage[] = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_CHARS) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return { ok: false, error: 'No hay una pregunta válida para enviar.' };
  }

  try {
    const res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // surface: 'mobile' → el backend adapta el prompt a la navegación de la app
      // (pestañas, sin "portal"/rutas web/"botón Ayuda").
      body: JSON.stringify({ messages, surface: 'mobile' }),
    });

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }

    if (!res.ok || json.ok === false) {
      const msg =
        typeof json.error === 'string' && json.error.trim()
          ? json.error
          : res.status === 404
            ? 'Tu usuario no tiene un expediente de empleado asociado.'
            : `El asistente no está disponible ahora (${res.status}).`;
      return { ok: false, error: msg };
    }

    const msgObj = (json.message ?? null) as { content?: unknown } | null;
    const content =
      msgObj && typeof msgObj.content === 'string' ? msgObj.content : '';
    const rawTools = Array.isArray(json.tool_calls) ? (json.tool_calls as Record<string, unknown>[]) : [];
    const tool_calls: JayToolCall[] = rawTools.map((t) => ({
      name: String(t.name ?? ''),
      ok: t.ok !== false,
      error: typeof t.error === 'string' ? t.error : null,
    }));

    if (!content.trim()) {
      return { ok: false, error: 'El asistente no devolvió una respuesta.' };
    }

    return { ok: true, message: { role: 'assistant', content }, tool_calls };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red.' };
  }
}
