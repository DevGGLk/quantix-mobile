import * as Sentry from '@sentry/react-native';
import type { ReactNativeOptions } from '@sentry/react-native';

function envTruthy(v: string | undefined): boolean {
  const s = String(v ?? '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function envFalsy(v: string | undefined): boolean {
  const s = String(v ?? '').toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no';
}

/**
 * `debug` en consola del SDK Sentry.
 * - Builds de tienda / release: `false` salvo `EXPO_PUBLIC_SENTRY_DEBUG=1|true|yes` (soporte puntual).
 * - Desarrollo: `true` por defecto; desactivar con `EXPO_PUBLIC_SENTRY_DEBUG=0|false|off`.
 */
export function shouldEnableSentryDebug(): boolean {
  const flag = process.env.EXPO_PUBLIC_SENTRY_DEBUG;
  if (__DEV__) {
    return !envFalsy(flag);
  }
  return envTruthy(flag);
}

/**
 * Inicializa Sentry si hay DSN. Llamar una sola vez al arranque (antes de montar la app).
 */
export function initSentryFromEnv(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;

  const debug = shouldEnableSentryDebug();

  if (__DEV__) {
    // `enableInExpoDevelopment` existe en runtime (Expo + Sentry) pero no está en `ReactNativeOptions` del SDK 7.x.
    const devOptions: ReactNativeOptions & { enableInExpoDevelopment: boolean } = {
      dsn,
      debug,
      enableInExpoDevelopment: true,
    };
    Sentry.init(devOptions);
    return;
  }

  Sentry.init({
    dsn,
    debug,
  });
}
