import React from 'react';
import type { LucideProps } from 'lucide-react-native';
import {
  Clock,
  Shield,
  Star,
  Heart,
  Zap,
  Flame,
  Target,
  Lightbulb,
  GraduationCap,
  Medal,
  Award,
  Crown,
  HelpCircle,
} from 'lucide-react-native';

type IconComponent = React.ComponentType<LucideProps>;

/**
 * Nombres en PascalCase tal como vienen de `badge_catalogue.icon_name`
 * (p. ej. Clock, Shield, Lightbulb, Award).
 */
const ICON_BY_PASCAL: Record<string, IconComponent> = {
  Clock,
  Shield,
  Star,
  Heart,
  Zap,
  Flame,
  Target,
  Lightbulb,
  GraduationCap,
  Medal,
  Award,
  Crown,
  HelpCircle,
  /** Alias frecuentes si la BD usa variante distinta */
  LightBulb: Lightbulb,
};

function wordsToPascal(parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * Resuelve el componente Lucide a partir del string de la BD (PascalCase preferido).
 * Fallback: `HelpCircle` si no hay coincidencia.
 */
export function getBadgeLucideIcon(iconName: string | null | undefined): IconComponent {
  const raw = String(iconName ?? '').trim();
  if (!raw) return HelpCircle;

  if (ICON_BY_PASCAL[raw]) return ICON_BY_PASCAL[raw];

  const fromDelims = wordsToPascal(raw.split(/[-_\s]+/g));
  if (fromDelims && ICON_BY_PASCAL[fromDelims]) return ICON_BY_PASCAL[fromDelims];

  const simple =
    raw.charAt(0).toUpperCase() + raw.slice(1).replace(/[^a-zA-Z0-9]/g, '');
  if (ICON_BY_PASCAL[simple]) return ICON_BY_PASCAL[simple];

  return HelpCircle;
}

/**
 * Renderiza el ícono del catálogo con color y tamaño.
 */
export function BadgeCatalogueIcon({
  iconName,
  color,
  size = 24,
}: {
  iconName: string | null | undefined;
  color: string;
  size?: number;
}): React.ReactElement {
  const Icon = getBadgeLucideIcon(iconName);
  return <Icon size={size} color={color} strokeWidth={2} />;
}
