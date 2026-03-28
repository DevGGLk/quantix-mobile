# QuantixHR — app móvil (Expo)

## Variables de entorno (obligatorias)

La app **no arranca** sin estas variables (fallo explícito al importar `lib/supabase.ts`):

| Variable | Uso |
|----------|-----|
| `EXPO_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (pública) |

1. Copia `.env.example` a `.env` y completa los valores.
2. **EAS Build:** define los mismos nombres en *Secrets* del proyecto o en `eas.json` / perfil de build (según tu flujo Expo).

Opcional:

- `EXPO_PUBLIC_QUANTIX_API_URL` — API backend (onboarding, marcaje vía servidor, etc.).
- `EXPO_PUBLIC_SENTRY_DSN` — errores y trazas ([Sentry](https://sentry.io)). En `App.tsx` se usa `enableInExpoDevelopment: true` y `debug: true` mientras afinas la integración; luego puedes bajar `debug` o condicionarlo por entorno.
- `EXPO_PUBLIC_PASSWORD_RESET_WEB_URL` — URL web de recuperación de contraseña si no usas deep link.

## Deep link recuperación de contraseña

En `app.json` está `"scheme": "quantixhr"`. El reset desde la app usa `quantixhr://auth/recovery` cuando hay scheme.

1. En **Supabase → Authentication → URL Configuration**, añade esa URL a *Redirect URLs*.
2. Tu página web debe completar el intercambio de sesión o redirigir de vuelta a la app si usas flujo híbrido.

Si no configuras el scheme o las URLs, el flujo sigue siendo el **enlace del correo abriendo el sitio** (`EXPO_PUBLIC_PASSWORD_RESET_WEB_URL` o el default de `lib/authRedirect.ts`).

## Observabilidad (Sentry)

Con `EXPO_PUBLIC_SENTRY_DSN` definido, **`App.tsx` inicializa Sentry** (antes del árbol de componentes) y exporta la app con **`Sentry.wrap`**. El plugin en `app.json` usa la organización **`inversiones-ggl`** y el proyecto **`quantixhr-mobile`**.

Para **source maps** en EAS Build, configura `SENTRY_AUTH_TOKEN` en los secretos del proyecto (ver [Sentry + Expo](https://docs.sentry.io/platforms/react-native/manual-setup/expo/)).

## Tests automatizados

```bash
npm test          # Jest (lógica pura en lib + helpers)
npm run test:ci   # CI con cobertura
```

Los tests usan entorno Node y `babel-jest` (sin cargar el runtime completo de Expo). Para E2E (login + marcaje) conviene añadir **Maestro** o **Detox** en un paso posterior.

## Onboarding y carga de expediente

La decisión de mostrar inducción espera a que termine la carga de auth (`isLoading` falso) para no mezclar estados con `employee`/`profile` aún vacíos. La regla está centralizada en `lib/onboardingGate.ts` (con tests).

## Varios expedientes (`employees`) por usuario

Si `profiles.company_id` existe, se filtra el expediente por esa empresa. Si hay varios expedientes y el perfil **no** trae `company_id`, se prioriza fila con `employment_status === 'active'` y luego la más reciente (`created_at`), con `console.warn` en consola.

## UI / tema

`userInterfaceStyle` es `light`, alineado con `lib/theme.ts` (fondos claros). El splash usa `#2E3A59` (primary corporativo).

## Notificaciones push

Plugin **`expo-notifications`** configurado en `app.json` (icono/color) para builds de tienda. Revisa permisos iOS en la documentación Expo 54 si Apple pide ajustes adicionales en un review.

## RLS y panel admin

El móvil no sustituye políticas en base de datos. Checklist: [docs/RLS_AND_ADMIN_SECURITY.md](docs/RLS_AND_ADMIN_SECURITY.md).

## Android `applicationId`

Se mantiene `com.ggl.quantixhr` para no invalidar actualizaciones en Play Console ya publicadas. Cambiar el package implica **nueva aplicación** en la tienda.

## Seguridad y credenciales

- No commitear `.env` ni archivos con claves embebidas.
- Si en el pasado existió un `supabase.ts` en la raíz con URL/clave en el repo, **rota la clave anónima** en Supabase (*Settings → API*) y revisa el historial de git.

## Tipos TypeScript desde Supabase

Mantener `types/database.types.ts` alineado al esquema real:

```bash
npx supabase login
# Con proyecto linkeado (supabase link):
npm run gen:types

# O por ID de proyecto:
npx supabase gen types typescript --project-id <TU_PROJECT_REF> > types/database.types.ts
```

En CI se recomienda ejecutar `npm run typecheck` en cada PR; opcionalmente regenerar tipos tras migraciones.

## Migración modelo expediente (`employees.id`)

El cliente asume FKs y columnas `employee_id` → `public.employees`. Guía paso a paso: [docs/SCHEMA_EMPLOYEES_MIGRATION.md](docs/SCHEMA_EMPLOYEES_MIGRATION.md).

## Scripts útiles

```bash
npm run start       # Expo
npm run typecheck   # tsc --noEmit
npm test            # Jest
```
