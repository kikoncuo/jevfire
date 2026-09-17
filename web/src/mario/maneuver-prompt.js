export const DEFAULT_MANEUVER_POLICY =
  'Reach the flag alive. Prefer the safe maneuver with the greatest forward progress. Keep moving right; jump over obstacles and pits. Avoid waiting when a safe forward route is available.';

// Stable policy prefix survives changing observations. One categorical value
// selects a complete button maneuver, rather than three independent fields.
export function buildMarioManeuverPrompt(
  context,
  policy = DEFAULT_MANEUVER_POLICY,
  format = {},
) {
  if (
    !context ||
    !Array.isArray(context.options) ||
    !context.options.length ||
    context.options.length > 12
  )
    throw new Error('Provide 1–12 Mario maneuvers');
  if (typeof policy !== 'string' || !policy.trim() || policy.length > 1000)
    throw new Error('Invalid Mario maneuver policy');
  const ids = context.options.map((option) => option.id);
  if (
    ids.some(
      (id) => typeof id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(id),
    ) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('Invalid maneuver IDs');
  if (context.options.some((option) => !Number.isFinite(option.progress)))
    throw new Error('Invalid maneuver forecast');
  const labels = context.options.map((_, i) => String.fromCharCode(65 + i));
  const prefix = `<|im_start|>system\nYou play Mario. Select one offered maneuver. Each maneuver executes its own movement and jump timing. A local physics predictor checks collisions and pits; its forecasts are approximate. Compare the forward gains in tiles. Prefer the greatest safe gain toward the flag, without dying. Never invent an option. Answer only its letter.\nPolicy: ${policy}<|im_end|>\n<|im_start|>user\n`;
  const suffix =
    context.options
      .map(
        (option, i) =>
          `${labels[i]}: ${option.id}, gain=${Number(option.progress.toFixed(1))}`,
      )
      .join('\n') +
    `\nBest maneuver?<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n${format.leadingSpace ? 'Action:' : 'Action:\n'}`;
  return {
    sharedPrompt: prefix,
    fields: [
      {
        key: 'maneuver',
        suffix,
        choices: ids.map((value, i) => ({
          label: (format.leadingSpace ? ' ' : '') + labels[i],
          value,
        })),
      },
    ],
  };
}
