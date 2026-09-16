// Rebuild the observations and the CPU reference balance run from the real game.
// These fixtures test finite-action choice, not end-to-end policy optimality.
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game.js';

const mission =
  'Keep every villager and the hall alive for as long as possible.';
const fixtures = [];
function scenario(name, unitId, setup, expected, reason) {
  const game = new Game({ seed: 7341 });
  game.nextWave = Infinity;
  setup(
    game,
    game.units.find((unit) => unit.id === unitId),
  );
  fixtures.push({
    name,
    unitId,
    context: game.contextFor(unitId),
    mission,
    expected,
    reason,
  });
}

for (const [role, unitId] of [
  ['collector', 'mira'],
  ['fighter', 'aldric'],
  ['builder', 'tomas'],
]) {
  scenario(
    `${role}-urgent-hunger`,
    unitId,
    (game, unit) => {
      unit.x = unit.home.x;
      unit.y = unit.home.y;
      unit.hunger = 3;
      game.food = 8;
    },
    ['relax'],
    'Only relaxing consumes available food. This villager is at home and will starve in four seconds.',
  );
}

scenario(
  'collector-normal-safe-foraging',
  'mira',
  (game, unit) => {
    unit.hunger = 95;
    game.food = 8;
  },
  ['forage_safe'],
  'Healthy collector, ordinary food reserves, no urgent shortage. The default role policy prefers safe foraging.',
);

scenario(
  'collector-empty-pantry-clear-routes',
  'bram',
  (game, unit) => {
    game.food = 0;
    unit.hunger = 90;
    for (const ally of game.units.filter((ally) => ally.id !== unit.id))
      ally.hunger = 30;
  },
  ['forage_bold'],
  'No food, clear routes, healthy collector: the default policy calls for faster collection during a critical shortage.',
);

scenario(
  'collector-dangerous-short-route',
  'mira',
  (game, unit) => {
    unit.hunger = 95;
    game.food = 7;
    game.spawnOrc(8.5, 17, 3);
  },
  ['forage_safe'],
  'An orc blocks the nearby western food route; alternative routes remain low risk. Cautious routing avoids that shortcut.',
);

scenario(
  'fighter-peacetime-training',
  'aldric',
  (game, unit) => {
    unit.hunger = 95;
    unit.strength = 11;
  },
  ['train'],
  'No orcs or threatened villagers exist, and the fighter is healthy and fed. Training improves later-wave survival.',
);

scenario(
  'fighter-defend-attacked-collector',
  'sable',
  (game, unit) => {
    Object.assign(unit, { x: 14, y: 14, hunger: 90 });
    const collector = game.units.find((ally) => ally.id === 'mira');
    Object.assign(collector, { x: 12, y: 13, health: 30 });
    const orc = game.spawnOrc(11.3, 13.2, 2);
    orc.targetId = collector.id;
  },
  ['defend'],
  'A healthy fighter can intercept and taunt the orc attacking a wounded collector. Training or resting abandons the ally.',
);

scenario(
  'fighter-defend-attacked-building',
  'aldric',
  (game, unit) => {
    unit.hunger = 90;
    const wall = game.buildings.find((building) => building.id === 'west-wall');
    wall.health = 60;
    const orc = game.spawnOrc(13, 15.8, 3);
    orc.targetId = wall.id;
  },
  ['defend'],
  'An orc is attacking a standing wall. The healthy fighter should protect the village, rather than continue training.',
);

scenario(
  'fighter-injured-at-home',
  'sable',
  (game, unit) => {
    Object.assign(unit, {
      x: unit.home.x,
      y: unit.home.y,
      health: 12,
      hunger: 70,
    });
    game.food = 10;
  },
  ['relax'],
  'A badly wounded fighter has no active threats and food at home. Relaxation heals; training does not.',
);

scenario(
  'builder-critical-hall-repair',
  'tomas',
  (game, unit) => {
    unit.hunger = 90;
    game.hall().health = 60;
  },
  ['repair'],
  'The hall is at fourteen percent health. Repairing it takes priority over adding a new tower.',
);

scenario(
  'builder-healthy-village-build',
  'nell',
  (game, unit) => {
    unit.hunger = 90;
  },
  ['build'],
  'All standing buildings are healthy, four defense sites remain, and this builder is well fed. Build defenses now.',
);

writeFileSync(
  new URL('./policy-fixtures.json', import.meta.url),
  `${JSON.stringify(fixtures, null, 2)}\n`,
);

const runs = [];
for (const seed of [1, 2, 3, 7341]) {
  const game = new Game({ seed });
  game.running = true;
  for (let second = 0; second < 600 && !game.over; second++) {
    game.apply(game.scripted());
    game.update(1);
  }
  runs.push({ seed, ...game.summary() });
}
const balance = {
  controller: 'Explicit scripted reference controller; no model inference',
  decision_schedule: 'One full living-roster decision per simulated second',
  simulation_step_seconds: 1,
  maximum_run_seconds: 600,
  note: 'Deterministic game-balance checks, not AI performance, benchmark latency, or evidence of optimal policies. Wall-clock time is not measured.',
  runs,
};
writeFileSync(
  new URL('./balance-results.json', import.meta.url),
  `${JSON.stringify(balance, null, 2)}\n`,
);
console.log(
  `Wrote ${fixtures.length} policy fixtures and ${runs.length} reference balance runs.`,
);
