/**
 * Paleta de colores corporativa QuantixHR.
 * primary/accent/warning/danger también se usan en el Módulo de Gamificación (Perfil, Tienda).
 */
export const theme = {
  primary: '#2E3A59',
  accent: '#00C2D1',
  warning: '#FF9F43',
  danger: '#FF3F48',
  background: '#F8F9FA',
  backgroundAlt: '#FFFFFF',
  textPrimary: '#2E3A59',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  border: '#e2e8f0',
  /** Gamificación: fondo secundario terracota pálido/rosa (#f3a8b1) */
  subtleBackground: '#f3a8b1',
  /**
   * Fondo de pantallas tipo tienda / listado de recompensas (contraste suave con `background`).
   * Evita paletas duplicadas en el código de la pantalla.
   */
  storeBackground: '#F3F4F6',
} as const;

export type Theme = typeof theme;
