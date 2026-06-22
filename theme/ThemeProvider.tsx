/**
 * ThemeProvider.tsx — Context mínimo de tema (light/dark) para QuantixHR móvil.
 *
 * Expone la paleta activa vía `useTheme()`. Soporta tres preferencias:
 *   · 'light' | 'dark' → forzado manual
 *   · 'system'         → sigue el esquema del SO (useColorScheme)
 *
 * NOTA DE FASE: la app arranca en LIGHT a propósito (`defaultPreference="light"`).
 * Los valores dark ya existen y `useColorScheme` ya está cableado, pero NINGUNA
 * pantalla se migra a este provider todavía (eso es fase futura). El piloto
 * (LoginScreen) es el primer y único consumidor por ahora.
 *
 * Patrón de consumo en pantallas (estilos dependientes del modo):
 *
 *   const { palette } = useTheme();
 *   const styles = useMemo(() => makeStyles(palette), [palette]);
 */
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { palettes, type Mode, type Palette } from './palettes';

/** Preferencia del usuario: un modo fijo o "seguir al sistema". */
export type ThemePreference = Mode | 'system';

type ThemeContextValue = {
  /** Paleta resuelta al modo activo — lo que consumen las pantallas. */
  palette: Palette;
  /** Modo efectivo ya resuelto ('light' | 'dark'). */
  mode: Mode;
  /** Preferencia cruda elegida ('light' | 'dark' | 'system'). */
  preference: ThemePreference;
  /** Cambia la preferencia (forzar modo o seguir al sistema). */
  setPreference: (preference: ThemePreference) => void;
  /** Atajo: ¿el modo efectivo es dark? */
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

type ThemeProviderProps = {
  children: ReactNode;
  /** Preferencia inicial. Default 'light' para que la app no cambie de aspecto aún. */
  defaultPreference?: ThemePreference;
};

export function ThemeProvider({
  children,
  defaultPreference = 'light',
}: ThemeProviderProps) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [preference, setPreference] = useState<ThemePreference>(defaultPreference);

  const value = useMemo<ThemeContextValue>(() => {
    const mode: Mode =
      preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
    return {
      palette: palettes[mode],
      mode,
      preference,
      setPreference,
      isDark: mode === 'dark',
    };
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Hook de acceso al tema. Lanza si se usa fuera del ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() debe usarse dentro de <ThemeProvider>.');
  }
  return ctx;
}
