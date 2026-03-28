import React from 'react';
import type { LucideProps } from 'lucide-react-native';
import {
  Star,
  Clock,
  Shield,
  Trophy,
  Award,
  Medal,
  Rocket,
  Heart,
  Target,
  Zap,
  Flame,
  Crown,
  BadgeCheck,
  Sparkles,
  Gem,
  Gift,
  Flag,
  Bookmark,
  Bell,
  Calendar,
  Users,
  Briefcase,
  Lightbulb,
  ThumbsUp,
} from 'lucide-react-native';

type IconComponent = React.ComponentType<LucideProps>;

/** Claves en minúsculas y con guiones (p. ej. `badge-check`). */
const ICONS: Record<string, IconComponent> = {
  star: Star,
  clock: Clock,
  shield: Shield,
  trophy: Trophy,
  award: Award,
  medal: Medal,
  rocket: Rocket,
  heart: Heart,
  target: Target,
  zap: Zap,
  flame: Flame,
  crown: Crown,
  sparkles: Sparkles,
  gem: Gem,
  gift: Gift,
  flag: Flag,
  bookmark: Bookmark,
  bell: Bell,
  calendar: Calendar,
  users: Users,
  briefcase: Briefcase,
  lightbulb: Lightbulb,
  'thumbs-up': ThumbsUp,
  thumbsup: ThumbsUp,
  'badge-check': BadgeCheck,
  badgecheck: BadgeCheck,
};

function normalizeIconKey(raw: string | null | undefined): string {
  return String(raw ?? 'star')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/**
 * Ícono del catálogo de medallas (`badge_catalogue.icon_name` → componente Lucide).
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
  const key = normalizeIconKey(iconName);
  const Icon = ICONS[key] ?? Star;
  return <Icon size={size} color={color} strokeWidth={2} />;
}
