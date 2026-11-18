/**
 * Paleta QuantixHR alineada con la web (Mi Portal): violeta #5B4DD4, fondo slate-50, texto #1A1733.
 * Hex del manual de marca (índigo + violeta). `primary` = identidad/estados activos/marca;
 * `accent` = acción (CTAs, acentos). Semánticos alineados al manual.
 */
export const theme = {
  /** Índigo de marca: headers, navegación activa, identidad, estados activos. */
  primary: '#5B4DD4',
  /** Violeta presionado (hover de la web). */
  primaryPressed: '#534AB7',
  /** Violeta de acción: CTAs, acentos, resaltados. */
  accent: '#5B4DD4',
  warning: '#FF9F43',
  danger: '#FF3F48',
  success: '#059669',
  /** Fondo de pantalla (off-white cálido del manual). */
  background: '#F8FAFC',
  /** Superficie / tarjeta sobre el fondo */
  backgroundAlt: '#FFFFFF',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  textPrimary: '#1A1733',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  /** Borde fino de tarjeta (slate-100 de la web). */
  cardBorder: '#F1F5F9',
  /** Fondo suave (tint índigo, para acentos de marca) */
  subtleBackground: '#EFEDFB',
  storeBackground: '#F1F5F9',
  cardBorderRadius: 16,
} as const;

export type Theme = typeof theme;
