/**
 * Esquema histórico: `reward_points` / `points`.
 * Esquema actual (dump): `points_reward` + `gives_points`.
 */
export function checklistPointsFromRow(row: Record<string, unknown>): number {
  const raw = row.points_reward ?? row.reward_points ?? row.points;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function checklistGivesPoints(row: Record<string, unknown>): boolean {
  if (row.gives_points === true) return true;
  return checklistPointsFromRow(row) > 0;
}
