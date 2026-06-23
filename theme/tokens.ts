/**
 * tokens.ts — Paleta cruda del manual de marca QuantixHR (índigo + violeta + ámbar).
 *
 * FUENTE ÚNICA DE VERDAD de los hex. Valores EXACTOS del manual: no aproximar,
 * no inventar tonos intermedios. Esto es la capa "raw": NO conoce light/dark ni
 * roles de UI. El mapeo rol→color por modo vive en `palettes.ts`.
 *
 * Reglas de uso (se respetan en palettes.ts, no aquí):
 *   · Índigo  → headers, nav activa, identidad. NUNCA en botones de acción.
 *   · Violeta → botones primarios, CTAs, marcar. NUNCA en headers.
 *   · Ámbar   → solo gamificación (puntos VIP, Camino de Copas, insignias).
 */

/** MARCA · Índigo — identidad, headers, navegación activa. */
export const brand = {
  darkest: '#26215C',
  base: '#3C3489',
  light: '#534AB7',
  subtle: '#CECBF6',
  tint: '#EEEDFE',
} as const;

/** ACCIÓN · Violeta — botones primarios, CTAs, confirmaciones. (Emparenta con Qardax.) */
export const action = {
  darkest: '#241C57',
  base: '#5B4DD4',
  bright: '#6C5CE7',
  subtle: '#C4BCF5',
  tint: '#EEEBFB',
} as const;

/** LOGROS · Ámbar — exclusivo gamificación (puntos, copas, insignias). */
export const achievement = {
  darkest: '#633806',
  base: '#BA7517',
  bright: '#EF9F27',
  subtle: '#FAC775',
  tint: '#FAEEDA',
} as const;

/**
 * SEMÁNTICOS — cada uno con su triplete LIGHT del manual (color / surface / text).
 * Las superficies dark NO están definidas en el manual: se resuelven en palettes.ts
 * (ver nota DARK_SEMANTIC_SURFACE) sin inventar hex.
 */
export const semantic = {
  success: { color: '#1D9E75', surface: '#E1F5EE', text: '#085041' },
  warning: { color: '#EF9F27', surface: '#FAEEDA', text: '#633806' }, // almuerzo/permiso pendiente
  danger: { color: '#E24B4A', surface: '#FCEBEB', text: '#791F1F' }, // marcar salida, cerrar sesión
  info: { color: '#378ADD', surface: '#E6F1FB', text: '#0C447C' },
} as const;

/** NEUTROS · modo LIGHT. (El fondo de pantalla = surface.sunken off-white.) */
export const neutralLight = {
  surfaceCard: '#FFFFFF',
  surfaceSunken: '#F1EFE8',
  textPrimary: '#211F2E',
  textSecondary: '#5F5E66',
  textTertiary: '#9D9CA6',
  border: '#D3D1C7',
} as const;

/** NEUTROS · modo DARK. (El índigo se profundiza; las superficies invierten.) */
export const neutralDark = {
  background: '#1A1830',
  surfaceCard: '#211E3A',
  surfaceSunken: '#252245',
  textPrimary: '#ECEBF5',
  textSecondary: '#A6A4BC',
  textTertiary: '#6E6C84',
  border: '#2A2745',
} as const;

/** Constantes neutras puras. */
export const common = {
  white: '#FFFFFF',
  black: '#000000',
  /** Backdrop de modales — overlay translúcido sobre el índigo más profundo. */
  backdrop: 'rgba(38, 33, 92, 0.55)',
} as const;
