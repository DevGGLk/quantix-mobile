/**
 * Mensaje seguro para `catch (e: unknown)` (PostgREST, Error, strings, etc.).
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}
