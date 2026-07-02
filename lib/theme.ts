/**
 * Master Palette QuantixHR (SaaS RRHH): índigo identidad, violeta acción, off-white cálido.
 * Hex del manual de marca (índigo + violeta). `primary` = identidad/estados activos/marca;
 * `accent` = acción (CTAs, acentos). Semánticos alineados al manual.
 */
export const theme = {
  /** Índigo de marca: headers, navegación activa, identidad, estados activos. */
  primary: '#3C3489',
  /** Violeta de acción: CTAs, acentos, resaltados. */
  accent: '#6C5CE7',
  warning: '#EF9F27',
  danger: '#E24B4A',
  success: '#1D9E75',
  /** Fondo de pantalla (off-white cálido del manual). */
  background: '#F1EFE8',
  /** Superficie / tarjeta sobre el fondo */
  backgroundAlt: '#FFFFFF',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  textPrimary: '#211F2E',
  textSecondary: '#5F5E66',
  textMuted: '#9D9CA6',
  border: '#D3D1C7',
  /** Fondo suave (tint índigo, para acentos de marca) */
  subtleBackground: '#EEEDFE',
  storeBackground: '#F1F5F9',
  cardBorderRadius: 16,
} as const;

export type Theme = typeof theme;
