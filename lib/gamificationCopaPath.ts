/**
 * Camino de Copas — paridad con `lib/gamification-copa-path.ts` del dashboard web.
 * Umbrales base anuales; prorrateo por meses activos desde `hire_date` en el año calendario actual.
 */

export type CopaLevelVisualState = 'locked' | 'current' | 'achieved';

export type CopaTier = {
  name: string;
  threshold: number;
  imageSrc: string;
};

export type CopaPathLevelStep = {
  name: string;
  threshold: number;
  imageSrc: string;
  state: CopaLevelVisualState;
};

/** Umbrales base (temporada completa, 12 meses); se prorratean con `computeCopaSeasonMultiplier`. */
export const DEFAULT_COPA_LEVELS: CopaTier[] = [
  { name: 'Bronce', threshold: 20_000, imageSrc: '/gamificacion/bronce.png' },
  { name: 'Plata', threshold: 40_000, imageSrc: '/gamificacion/plata.png' },
  { name: 'Oro', threshold: 60_000, imageSrc: '/gamificacion/oro.png' },
  { name: 'Platinum', threshold: 80_000, imageSrc: '/gamificacion/platinum.png' },
  { name: 'Diamante', threshold: 100_000, imageSrc: '/gamificacion/diamante.png' },
];

const INICIADO = 'Iniciado';

export type CopaPathStatus = {
  currentLevelName: string;
  nextLevelName: string | null;
  pointsToNext: number;
  progressPercent: number;
  yearlyEarnedPoints: number;
  isShortSeason: boolean;
  levels: CopaPathLevelStep[];
};

function parseHireDateYearMonth(hireDate: string | null | undefined): { year: number; month1: number } | null {
  const raw = hireDate?.trim();
  if (!raw) return null;
  const datePart = raw.slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month1: d.getMonth() + 1 };
}

export function computeCopaSeasonMultiplier(
  hireDate: string | null,
  currentYear: number
): { multiplier: number; isShortSeason: boolean } {
  const parsed = parseHireDateYearMonth(hireDate);
  if (!parsed) {
    return { multiplier: 1, isShortSeason: false };
  }
  if (parsed.year < currentYear) {
    return { multiplier: 1, isShortSeason: false };
  }
  if (parsed.year > currentYear) {
    return { multiplier: 1, isShortSeason: false };
  }
  const activeMonths = Math.min(12, Math.max(1, 12 - parsed.month1 + 1));
  const multiplier = activeMonths / 12;
  return { multiplier, isShortSeason: multiplier < 1 };
}

export function applyCopaThresholdMultiplier(levels: CopaTier[], multiplier: number): CopaTier[] {
  return levels.map((tier) => ({
    ...tier,
    threshold: Math.round(tier.threshold * multiplier),
  }));
}

function buildCopaPathLevelSteps(sorted: CopaTier[], earned: number): CopaPathLevelStep[] {
  const n = sorted.length;
  if (n === 0) return [];

  const nextIdx = sorted.findIndex((t) => earned < t.threshold);

  return sorted.map((t, j) => {
    let state: CopaLevelVisualState;
    if (nextIdx === -1) {
      state = j === n - 1 ? 'current' : 'achieved';
    } else if (j < nextIdx) {
      state = 'achieved';
    } else if (j === nextIdx) {
      state = 'current';
    } else {
      state = 'locked';
    }
    return {
      name: t.name,
      threshold: t.threshold,
      imageSrc: t.imageSrc,
      state,
    };
  });
}

function emptyStatus(earned: number, isShortSeason: boolean): CopaPathStatus {
  return {
    currentLevelName: INICIADO,
    nextLevelName: null,
    pointsToNext: 0,
    progressPercent: 0,
    yearlyEarnedPoints: earned,
    isShortSeason,
    levels: [],
  };
}

/**
 * @param hireDate Fecha ISO o `YYYY-MM-DD`. `null`/vacío implica temporada completa en el año de referencia
 * (multiplicador 1). En Perfil móvil se puede pasar `${año}-01-01` como fallback si no hay expediente.
 */
export function computeCopaPathStatus(
  yearlyEarnedPoints: number,
  hireDate: string | null,
  levels: CopaTier[] = DEFAULT_COPA_LEVELS,
  referenceYear: number = new Date().getFullYear()
): CopaPathStatus {
  const earned = Math.max(0, Math.floor(Number(yearlyEarnedPoints) || 0));
  const { multiplier, isShortSeason } = computeCopaSeasonMultiplier(hireDate, referenceYear);
  const sorted = [...applyCopaThresholdMultiplier(levels, multiplier)].sort((a, b) => a.threshold - b.threshold);

  if (sorted.length === 0) {
    return emptyStatus(earned, isShortSeason);
  }

  const levelSteps = buildCopaPathLevelSteps(sorted, earned);
  const first = sorted[0];

  if (earned < first.threshold) {
    const span = first.threshold;
    return {
      currentLevelName: INICIADO,
      nextLevelName: first.name,
      pointsToNext: Math.max(0, first.threshold - earned),
      progressPercent: span > 0 ? Math.min(100, (earned / span) * 100) : 0,
      yearlyEarnedPoints: earned,
      isShortSeason,
      levels: levelSteps,
    };
  }

  let currentIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (earned >= sorted[i].threshold) currentIdx = i;
  }

  const current = sorted[currentIdx];
  const next = sorted[currentIdx + 1] ?? null;

  if (!next) {
    return {
      currentLevelName: current.name,
      nextLevelName: null,
      pointsToNext: 0,
      progressPercent: 100,
      yearlyEarnedPoints: earned,
      isShortSeason,
      levels: levelSteps,
    };
  }

  const span = next.threshold - current.threshold;
  const into = earned - current.threshold;
  return {
    currentLevelName: current.name,
    nextLevelName: next.name,
    pointsToNext: Math.max(0, next.threshold - earned),
    progressPercent: span > 0 ? Math.min(100, Math.max(0, (into / span) * 100)) : 100,
    yearlyEarnedPoints: earned,
    isShortSeason,
    levels: levelSteps,
  };
}

export function gamificationYearStartIsoUtc(year: number): string {
  return `${year}-01-01T00:00:00.000Z`;
}
