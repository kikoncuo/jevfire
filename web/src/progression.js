// Levels describe completed work only; they do not multiply combat or work stats.
export const XP_PER_LEVEL = 100;
export const EXPERIENCE_RATES = Object.freeze({
  harvestedFood: 10,
  trainingSecond: 2,
  orcDamage: 0.5,
  repairedHealth: 0.1,
  completedTower: 60,
  healedHealth: 0.5,
});
const rounded = (value) => Math.round(value * 1e6) / 1e6;

export function progressionFor(unit) {
  const raw = Number.isFinite(unit?.experience)
    ? Math.max(0, unit.experience)
    : 0;
  // Hide floating-point accumulation noise at exact level boundaries.
  const totalXp = rounded(raw);
  const level = 1 + Math.floor(totalXp / XP_PER_LEVEL);
  const xpWithinLevel = rounded(totalXp - (level - 1) * XP_PER_LEVEL);
  return {
    level,
    totalXp,
    xpWithinLevel,
    xpToNext: rounded(XP_PER_LEVEL - xpWithinLevel),
    xpForNextLevel: XP_PER_LEVEL,
    nextLevelAt: level * XP_PER_LEVEL,
    progress: xpWithinLevel / XP_PER_LEVEL,
  };
}

export function awardExperience(unit, amount) {
  if (!unit?.alive || !Number.isFinite(amount) || amount <= 0) return 0;
  const previous = Number.isFinite(unit.experience)
    ? Math.max(0, unit.experience)
    : 0;
  if (!Number.isFinite(previous + amount)) return 0;
  unit.experience = previous + amount;
  return amount;
}
