/**
 * palettes.ts — Mapeo ROL → COLOR para light y dark.
 *
 * Esta es la capa que consumen las pantallas: piden "color de fondo de tarjeta"
 * (`surface.card`) o "texto sobre botón de acción" (`onAction`) y reciben el hex
 * correcto del modo activo, SIN conocer la paleta cruda. Cada modo expone la
 * MISMA forma (`Palette`), así una pantalla migrada funciona en ambos sin cambios.
 *
 * Los hex salen 1:1 de tokens.ts (manual de marca). Donde el manual NO define un
 * valor para dark, se documenta la decisión y se reutiliza un token existente —
 * nunca se inventa un tono nuevo. Ver DARK_SEMANTIC_SURFACE abajo.
 */
import {
  achievement,
  action,
  brand,
  common,
  neutralDark,
  neutralLight,
  semantic,
} from './tokens';

export type Mode = 'light' | 'dark';

/** Triplete de un estado semántico tal como lo consume la UI. */
type SemanticRole = {
  /** Color fuerte: icono, borde, acento. */
  color: string;
  /** Fondo del chip/badge/banner. */
  surface: string;
  /** Texto legible sobre `surface`. */
  text: string;
};

export type Palette = {
  mode: Mode;
  /** Fondo de la pantalla. */
  background: string;
  surface: {
    /** Tarjetas, inputs, hojas elevadas. */
    card: string;
    /** Áreas hundidas / fondo sutil bajo las tarjetas. */
    sunken: string;
  };
  border: string;
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  /**
   * Campos de formulario (inputs). Se separa de `surface.card` porque en dark el
   * relleno usa la superficie hundida (más clara que el fondo) para que el input
   * destaque; en light coincide con la tarjeta blanca.
   */
  input: {
    bg: string;
    border: string;
  };
  /** Rampa de marca (índigo). Headers, nav activa, identidad. NUNCA en botones. */
  brand: typeof brand;
  /** Rampa de acción (violeta). Botones primarios, CTAs. NUNCA en headers. */
  action: typeof action;
  /** Rampa de logros (ámbar). Solo gamificación. */
  achievement: typeof achievement;
  /** Estados semánticos resueltos al modo activo. */
  semantic: {
    success: SemanticRole;
    warning: SemanticRole;
    danger: SemanticRole;
    info: SemanticRole;
  };

  // ── Roles compuestos (dependen del modo) ─────────────────────────────
  /** Texto/contenido sobre un botón de acción (violeta). */
  onAction: string;
  /** Navegación secundaria (links). No compite con el botón. */
  link: string;
  /**
   * Acento de identidad de marca. En light es índigo; en dark "el símbolo y los
   * acentos de marca pasan a violeta" (manual).
   */
  brandAccent: string;
  /**
   * Símbolo de marca "Q": fondo del cuadrado + color de la letra + punto
   * (variante A: punto abajo-derecha que evoca "persona", diferencia de Qardax).
   */
  brandSymbol: {
    bg: string;
    fg: string;
    dot: string;
  };
  /** Backdrop translúcido para modales. */
  backdrop: string;
};

/**
 * DARK_SEMANTIC_SURFACE — el manual define superficies semánticas solo para LIGHT.
 * Para dark NO inventamos hex: usamos la superficie neutra hundida (#252245) como
 * fondo del chip y dejamos el HUE del manual en `color`/`text`. Patrón estándar de
 * dark mode (chip neutro + texto de color), legible y sin tonos inventados.
 * Si el manual incorpora superficies semánticas dark dedicadas, se cambian aquí.
 */
const darkSemanticSurface = neutralDark.surfaceSunken;

export const lightPalette: Palette = {
  mode: 'light',
  background: neutralLight.surfaceSunken, // off-white de pantalla
  surface: {
    card: neutralLight.surfaceCard,
    sunken: neutralLight.surfaceSunken,
  },
  border: neutralLight.border,
  text: {
    primary: neutralLight.textPrimary,
    secondary: neutralLight.textSecondary,
    tertiary: neutralLight.textTertiary,
  },
  input: { bg: neutralLight.surfaceCard, border: neutralLight.border },
  brand,
  action,
  achievement,
  semantic: {
    success: { color: semantic.success.color, surface: semantic.success.surface, text: semantic.success.text },
    warning: { color: semantic.warning.color, surface: semantic.warning.surface, text: semantic.warning.text },
    danger: { color: semantic.danger.color, surface: semantic.danger.surface, text: semantic.danger.text },
    info: { color: semantic.info.color, surface: semantic.info.surface, text: semantic.info.text },
  },
  onAction: common.white,
  link: brand.light,
  brandAccent: brand.base,
  brandSymbol: { bg: brand.base, fg: common.white, dot: action.bright }, // cuadrado índigo, Q blanca, punto violeta
  backdrop: common.backdrop,
};

export const darkPalette: Palette = {
  mode: 'dark',
  background: neutralDark.background,
  surface: {
    card: neutralDark.surfaceCard,
    sunken: neutralDark.surfaceSunken,
  },
  border: neutralDark.border,
  text: {
    primary: neutralDark.textPrimary,
    secondary: neutralDark.textSecondary,
    tertiary: neutralDark.textTertiary,
  },
  // Relleno más claro que el fondo (#252245 sobre #1A1830) para que el input destaque.
  input: { bg: neutralDark.surfaceSunken, border: neutralDark.border },
  brand,
  action,
  achievement,
  // Hue del manual sobre superficie neutra dark (ver DARK_SEMANTIC_SURFACE).
  semantic: {
    success: { color: semantic.success.color, surface: darkSemanticSurface, text: semantic.success.color },
    warning: { color: semantic.warning.color, surface: darkSemanticSurface, text: semantic.warning.color },
    danger: { color: semantic.danger.color, surface: darkSemanticSurface, text: semantic.danger.color },
    info: { color: semantic.info.color, surface: darkSemanticSurface, text: semantic.info.color },
  },
  onAction: action.darkest, // texto oscuro (#241C57) sobre violeta brillante
  link: brand.subtle, // legible sobre fondo oscuro (decisión tomada: indigo.subtle)
  brandAccent: action.bright, // en dark, la identidad pasa a violeta
  brandSymbol: { bg: action.bright, fg: common.white, dot: action.darkest }, // cuadrado violeta, Q blanca, punto violeta oscuro
  backdrop: common.backdrop,
};

export const palettes: Record<Mode, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};
