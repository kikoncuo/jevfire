import { CONTROL_SCHEMA, DEFAULT_POLICY } from './contract.js';

const number = (value) =>
  Number.isFinite(value) ? String(Number(value.toFixed(2))) : 'unknown';
const MEANINGS = Object.freeze({
  direction: [
    'move left',
    'no horizontal movement',
    'move right toward the flag',
  ],
  jump: ['release jump', 'press or hold jump'],
  speed: ['walk, up to 4.5 tiles/s', 'run, up to 8.4 tiles/s'],
});

function describe(context) {
  if (
    !context ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    !context.self ||
    !context.geometry ||
    !context.nearby ||
    !context.goal
  )
    throw new Error('Invalid platform observation');
  const serialized = JSON.stringify(context);
  if (!serialized || serialized.length > 16000)
    throw new Error('Platform observation is too large');
  const { self, geometry, nearby, goal } = context;
  for (const key of ['solids', 'gaps', 'enemies', 'items'])
    if (!Array.isArray(nearby[key]) || nearby[key].length > 32)
      throw new Error('Invalid nearby platform geometry');
  const obstacle = geometry.nextObstacle;
  const gap = geometry.nextGap;
  const enemy = geometry.nearestEnemy;
  const overhead = geometry.overheadBlock;
  return [
    `Position x=${number(self.x)}, feet y=${number(self.y)}; velocity x=${number(self.vx)}, y=${number(self.vy)} tiles/s; grounded=${!!self.onGround}; jump-held=${!!self.jumpHeld}.`,
    `Flag ${number(goal.distanceX)} tiles right; time left ${number(context.timeRemaining)}s; coins ${number(context.coins)}.`,
    'Next obstacle/gap/enemy distances start at your right edge. Other dx/dy start at your bottom-left; top is absolute world y.',
    `Next obstacle: ${obstacle ? `dx=${number(obstacle.dx)}, width=${number(obstacle.width)}, top=${number(obstacle.topY)}, height above feet=${number(obstacle.heightAboveFeet)}` : 'none in view'}.`,
    `Next gap: ${gap ? `starts ${number(gap.distance)} tiles ahead, width=${number(gap.width)}` : 'none in view'}.`,
    `Nearest enemy: ${enemy ? `dx=${number(enemy.dx)}, dy=${number(enemy.dy)}, vx=${number(enemy.vx)}` : 'none in view'}.`,
    `Overhead block: ${overhead ? `${overhead.type}, clearance above head=${number(overhead.clearance)}, content=${overhead.used ? 'used' : (overhead.content ?? 'none')}` : 'none'}.`,
    `Visible solid bounds dx/dy/width/height: ${
      nearby.solids
        .slice(0, 12)
        .map(
          (item) =>
            `${number(item.dx)}/${number(item.dy)}/${number(item.w)}/${number(item.h)}`,
        )
        .join('; ') || 'none'
    }.`,
    `Other gaps dx/width: ${
      nearby.gaps
        .slice(0, 6)
        .map((item) => `${number(item.dx)}/${number(item.width)}`)
        .join('; ') || 'none'
    }. Enemies dx/dy/vx: ${
      nearby.enemies
        .slice(0, 6)
        .map(
          (item) => `${number(item.dx)}/${number(item.dy)}/${number(item.vx)}`,
        )
        .join('; ') || 'none'
    }.`,
    `Items dx/dy: ${
      nearby.items
        .slice(0, 6)
        .map((item) => `${number(item.dx)}/${number(item.dy)}`)
        .join('; ') || 'none'
    }.`,
  ].join('\n');
}

// One observation is checkpointed, then each independent typed field gets a
// short suffix. Earlier field answers are never fed into a later decision.
export function buildMarioPromptParts(
  context,
  mission = '',
  policy = DEFAULT_POLICY,
  format = {},
) {
  if (typeof mission !== 'string' || mission.length > 500)
    throw new Error('Platform mission must contain at most 500 characters');
  if (typeof policy !== 'string' || !policy.trim() || policy.length > 1000)
    throw new Error('Platform policy must contain 1–1000 characters');
  const labels = format.labels ?? ['A', 'B', 'C'];
  const scoreLabels = format.scoreLabels ?? labels;
  if (
    !Array.isArray(labels) ||
    labels.length !== 3 ||
    new Set(labels).size !== 3 ||
    labels.some(
      (label) => typeof label !== 'string' || !/^[A-Z]$/.test(label),
    ) ||
    !Array.isArray(scoreLabels) ||
    scoreLabels.length !== 3 ||
    scoreLabels.some(
      (label, index) =>
        label !== labels[index] && label !== ` ${labels[index]}`,
    )
  )
    throw new Error('Invalid platform control labels');
  const prefix = format.assistantPrefix ?? 'Action:\n';
  if (!['Action:', 'Action:\n'].includes(prefix))
    throw new Error('Invalid platform assistant prefix');
  const sharedPrompt = `<|im_start|>system\nControl a platform game character using the observed geometry. Follow the policy to reach the flag alive. Units are tiles; x right, y up, positions are bottom-left corners. Jump begins on a new press while grounded; hold extends the jump, release after the apex before the next jump. A full jump reaches about 4.5 tiles high. Return only the requested control label.\nPolicy: ${policy}<|im_end|>\n<|im_start|>user\nMission: ${mission || 'Reach the flag; avoid pits and enemies.'}\n${describe(context)}`;
  const fields = Object.entries(CONTROL_SCHEMA).map(([key, values]) => ({
    key,
    choices: values.map((value, index) => ({
      label: scoreLabels[index],
      value,
    })),
    suffix: `\nChoose ${key} independently for this same observation.\n${values.map((_, index) => `${labels[index]}: ${MEANINGS[key][index]}`).join('\n')}\nReturn one ${key} label.<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n${prefix}`,
  }));
  return { sharedPrompt, fields };
}
