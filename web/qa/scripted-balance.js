// Current mechanical balance only. This does not rewrite historical policy scenes.
import { writeFileSync } from 'node:fs';
import { Game } from '../src/game.js';

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
const report = {
  rules_revision:
    'Visible automatic needs, builder healing, distinct character definitions, personal stamina thresholds, and useful-job availability',
  controller: 'Explicit scripted reference controller; no model inference',
  model_requests: 0,
  decision_schedule:
    'One full living-roster scripted decision per simulated second',
  simulation_step_seconds: 1,
  maximum_run_seconds: 600,
  counter_definitions: {
    ticks: 'Scripted action applications, not model requests',
    decisions:
      'Villagers assigned by the scripted controller, not AI decisions',
    automatic_meals: 'Actual physiological meals; never counted as decisions',
    treatments: 'Completed food-funded healing treatments',
  },
  note: 'Deterministic game-balance checks, not AI performance, model latency, optimal-policy evidence, or a controlled comparison with earlier game rules. Wall-clock time is not measured.',
  runs,
};
writeFileSync(
  new URL('./balance-results.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ scope: report.controller, runs }, null, 2));
