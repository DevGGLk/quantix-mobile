/**
 * Avatares de empleado — sistema PÚBLICO + CDN (paridad con la web,
 * `quantix-dashboard/lib/employee-photo-public-url.ts`).
 *
 * Fuente de verdad de la ruta: `employees.avatar_path`. El bucket `employee_photos`
 * es PÚBLICO, así que el CDN de Supabase sirve la imagen directo (sin proxy ni
 * storage.list). `?v=<avatar_updated_at>` invalida la caché del CDN al cambiar la foto.
 *
 * Regla clave: si el empleado NO tiene `avatar_path`, devolvemos null y la UI pinta
 * iniciales SIN emitir ningún request (evita 404s repetidos).
 */
import { supabase } from './supabase';

const BUCKET = 'employee_photos';

/**
 * URL pública del avatar en el CDN de Supabase, o null si no hay foto.
 * @param avatarPath `employees.avatar_path` (p. ej. `<uuid>.jpg`).
 * @param updatedAt `employees.avatar_updated_at` (ISO) para cache-busting estable.
 */
export function getEmployeePhotoPublicUrl(
  avatarPath: string | null | undefined,
  updatedAt?: string | null
): string | null {
  const path = typeof avatarPath === 'string' ? avatarPath.trim() : '';
  if (!path) return null;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const base = data?.publicUrl?.trim();
  if (!base) return null;

  if (updatedAt) {
    const ms = Date.parse(updatedAt);
    if (Number.isFinite(ms)) return `${base}?v=${ms}`;
  }
  return base;
}
