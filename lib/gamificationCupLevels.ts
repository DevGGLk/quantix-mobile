/**
 * Niveles del Camino de Copas desde Supabase (`gamification_cup_levels`).
 * Paridad con `lib/gamification-cup-levels.ts` del dashboard web.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_COPA_LEVELS, type CopaTier } from './gamificationCopaPath';

export type GamificationCupLevelRow = {
  id: string;
  company_id: string;
  name: string;
  points_required: number;
  reward_text: string | null;
  sort_order: number;
  image_src?: string | null;
};

export function mapCupLevelRowsToCopaTiers(rows: GamificationCupLevelRow[]): CopaTier[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name, 'es');
  });
  return sorted.map((r, idx) => {
    const fallback = DEFAULT_COPA_LEVELS[Math.min(idx, DEFAULT_COPA_LEVELS.length - 1)]!;
    const img = r.image_src?.trim();
    const reward = (r.reward_text ?? '').trim();
    const pts = Math.max(1, Math.floor(Number(r.points_required) || 0));
    return {
      name: r.name.trim() || fallback.name,
      threshold: pts,
      thresholdBase: pts,
      imageSrc: img && img.length > 0 ? img : fallback.imageSrc,
      rewardText: reward.length > 0 ? reward : null,
    };
  });
}

/** `undefined` = sin filas o error: el caller debe usar `DEFAULT_COPA_LEVELS`. */
export async function fetchCupLevelsAsCopaTiers(
  supabase: SupabaseClient,
  companyId: string
): Promise<CopaTier[] | undefined> {
  const { data, error } = await supabase
    .from('gamification_cup_levels')
    .select('id, company_id, name, points_required, reward_text, sort_order, image_src')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true });

  if (error || !data?.length) return undefined;
  return mapCupLevelRowsToCopaTiers(data as GamificationCupLevelRow[]);
}
