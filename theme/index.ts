/**
 * theme/ — Sistema de diseño QuantixHR (índigo + violeta + ámbar), light + dark.
 *
 * Punto de entrada único. Import recomendado desde pantallas:
 *   import { useTheme, type Palette } from '../theme';
 *
 * Capas:
 *   tokens.ts        → hex crudos del manual (sin roles, sin modo)
 *   palettes.ts      → rol → color para light y dark
 *   ThemeProvider.tsx→ context + useTheme()
 *
 * Convive con el `lib/theme.ts` antiguo (plano, single-mode), que siguen usando
 * las pantallas aún no migradas. Este sistema es aditivo.
 */
export { ThemeProvider, useTheme, type ThemePreference } from './ThemeProvider';
export { palettes, lightPalette, darkPalette, type Palette, type Mode } from './palettes';
export * as tokens from './tokens';
