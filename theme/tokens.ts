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
  darkest: '#1A1733',
  base: '#5B4DD4',
  light: '#534AB7',
  subtle: '#C4BCF5',
  tint: '#EFEDFB',
} as const;

/** ACCIÓN · Violeta — botones primarios, CTAs, confirmaciones. (Emparenta con Qardax.) */
export const action = {
  darkest: '#241C57',
  base: '#5B4DD4',
  bright: '#6C5CE7',
  subtle: '#C4BCF5',
  tint: '#EFEDFB',
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
  success: { color: '#059669', surface: '#ECFDF5', text: '#047857' },
  warning: { color: '#FF9F43', surface: '#FFF4E8', text: '#C46A14' }, // almuerzo/permiso pendiente
  danger: { color: '#FF3F48', surface: '#FEF2F2', text: '#B91C1C' }, // marcar salida, cerrar sesión
  info: { color: '#3B82F6', surface: '#EFF6FF', text: '#1E40AF' },
} as const;

/** NEUTROS · modo LIGHT. (El fondo de pantalla = surface.sunken off-white.) */
export const neutralLight = {
  surfaceCard: '#FFFFFF',
  surfaceSunken: '#F8FAFC',
  textPrimary: '#1A1733',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  border: '#E2E8F0',
} as const;

/** NEUTROS · modo DARK. (El índigo se profundiza; las superficies invierten.) */
export const neutralDark = {
  background: '#0F172A',
  surfaceCard: '#1E293B',
  surfaceSunken: '#0F172A',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  border: '#334155',
} as const;

/** Constantes neutras puras. */
export const common = {
  white: '#FFFFFF',
  black: '#000000',
  /** Backdrop de modales — overlay translúcido sobre el índigo más profundo. */
  backdrop: 'rgba(15, 23, 42, 0.7)',
} as const;
