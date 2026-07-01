/**
 * Master Palette QuantixHR (SaaS RRHH): turquesa identidad, navy profundo, off-white.
 * `primary` = acciones activas / marca; `accent` = alertas no críticas / acentos cálidos.
 */
export const theme = {
  primary: '#00C2D1',
  accent: '#F9A03F',
  warning: '#F59E0B',
  danger: '#E63946',
  success: '#10B981',
  background: '#F8FAFC',
  /** Superficie / tarjeta sobre el fondo */
  backgroundAlt: '#FFFFFF',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  textPrimary: '#1B263B',
  textSecondary: '#475569',
  textMuted: '#64748B',
  border: '#E2E8F0',
  /** Fondo suave (acentos cálidos) */
  subtleBackground: '#FEF3E7',
  storeBackground: '#F1F5F9',
  cardBorderRadius: 16,
} as const;

export type Theme = typeof theme;
