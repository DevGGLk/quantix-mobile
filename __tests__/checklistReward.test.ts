import { checklistGivesPoints, checklistPointsFromRow } from '../lib/checklistReward';

describe('checklistPointsFromRow', () => {
  it('prioriza points_reward', () => {
    expect(
      checklistPointsFromRow({
        points_reward: 50,
        reward_points: 10,
      })
    ).toBe(50);
  });

  it('usa reward_points si no hay points_reward', () => {
    expect(checklistPointsFromRow({ reward_points: 25 })).toBe(25);
  });

  it('usa points como alias', () => {
    expect(checklistPointsFromRow({ points: 7 })).toBe(7);
  });
});

describe('checklistGivesPoints', () => {
  it('true si gives_points', () => {
    expect(checklistGivesPoints({ gives_points: true, points_reward: 0 })).toBe(true);
  });

  it('true si hay puntos aunque gives_points sea false', () => {
    expect(checklistGivesPoints({ gives_points: false, points_reward: 5 })).toBe(true);
  });

  it('false si no hay puntos ni gives_points', () => {
    expect(checklistGivesPoints({ gives_points: false, points_reward: 0 })).toBe(false);
  });
});
