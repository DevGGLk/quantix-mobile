import * as Sentry from '@sentry/react-native';

/**
 * Helpers tras `initSentryFromEnv()` en `lib/sentryInit.ts` (invocado desde `App.tsx`).
 * No reinicializa el SDK.
 */
export function captureException(error: unknown, extras?: Record<string, string>): void {
  try {
    Sentry.withScope((scope) => {
      if (extras) {
        for (const [k, v] of Object.entries(extras)) {
          scope.setExtra(k, v);
        }
      }
      scope.captureException(error);
    });
  } catch {
    /* no-op */
  }
}

export { Sentry };
