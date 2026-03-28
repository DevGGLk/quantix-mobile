import Constants from 'expo-constants';

const WEB_FALLBACK =
  process.env.EXPO_PUBLIC_PASSWORD_RESET_WEB_URL ?? 'https://quantixhr.com/actualizar-password';

/**
 * URL de redirección tras reset de contraseña (Supabase).
 * - Con `scheme` en app.json: deep link `quantixhr://auth/recovery` (añadir en Supabase → Auth → Redirect URLs).
 * - Si no hay scheme, solo web (flujo clásico desde el correo en el navegador).
 */
export function getPasswordRecoveryRedirectUrl(): string {
  const raw = Constants.expoConfig?.scheme;
  const scheme = Array.isArray(raw) ? raw[0] : raw;
  if (typeof scheme === 'string' && scheme.length > 0) {
    return `${scheme}://auth/recovery`;
  }
  return WEB_FALLBACK;
}
