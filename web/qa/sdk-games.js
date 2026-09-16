import { Game } from '../src/game.js';
import { UNIT_DEFINITIONS } from '../src/contract.js';
import { DrivingGame } from '../src/driving/game.js';
import { DRIVERS } from '../src/driving/contract.js';
const worker = new Worker(
  new URL('../src/inference.worker.js', import.meta.url),
  { type: 'module' },
);
let awaiting;
const show = (value) => {
  document.querySelector('#status').textContent = JSON.stringify(
    value,
    null,
    2,
  );
};
worker.onmessage = ({ data }) => {
  if (data.type === 'progress') show(data);
  else {
    const resolve = awaiting;
    awaiting = null;
    resolve(data);
  }
};
const call = (data) =>
  new Promise((resolve, reject) => {
    awaiting = (value) =>
      value.type === 'error'
        ? reject(new Error(value.message))
        : resolve(value);
    worker.postMessage(data);
  });
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
try {
  const ready = await call({ type: 'load' });
  check(ready.prefix_cache_slots === 6, 'SDK cache not enabled');
  const report = { tested_at: new Date().toISOString(), ready, decisions: [] };
  window.sdkGameReport = report;
  for (const [scenario, game, actors] of [
    ['village', new Game(), UNIT_DEFINITIONS],
    ['driving', new DrivingGame(), DRIVERS],
  ]) {
    for (const unit of actors) {
      const request = {
        type: 'decide',
        scenario,
        unitId: unit.id,
        context: game.contextFor(unit.id),
        id: unit.id,
        epoch: 42,
        pace: 'balanced',
      };
      const cold = await call(request);
      const warm = await call(request);
      check(warm.cache.cache_hit, 'Missing warm hit for ' + unit.id);
      check(
        warm.epoch === 42 && warm.unitId === unit.id,
        'Response routing changed',
      );
      check(
        Object.keys(warm.parsed_json).join(',') === unit.id,
        'Wrong output fields',
      );
      check(
        warm.fields[unit.id].options.includes(warm.parsed_json[unit.id]),
        'Out-of-set action',
      );
      check(
        warm.usage.processed_tokens < warm.prompt_tokens,
        'No token savings',
      );
      report.decisions.push({
        scenario,
        unitId: unit.id,
        cold_ms: cold.elapsed_ms,
        warm_ms: warm.elapsed_ms,
        cache: warm.cache,
        parsed_json: warm.parsed_json,
      });
      show(report);
    }
  }
  const context = new Game().contextFor('mira');
  const edited = await call({
    type: 'decide',
    unitId: 'mira',
    context,
    rolePrompt: 'Prefer rest when hungry; gather food safely otherwise.',
    testOnly: true,
    compareWithWhole: true,
    epoch: 43,
  });
  check(!edited.cache.cache_hit, 'Edited policy used a stale prefix');
  check(edited.diagnostic.sampling === 'none', 'Unexpected sampled JSON text');
  check(
    edited.diagnostic.comparison.whole_logits.every(Number.isFinite),
    'Missing ordinary-inference comparison',
  );
  const afterProbe = await call({
    type: 'decide',
    unitId: 'mira',
    context,
    epoch: 44,
  });
  check(!afterProbe.cache.cache_hit, 'Probe reset left stale cache metadata');
  report.prompt_edit_and_probe_reset = true;
  report.passed = true;
  show(report);
} catch (error) {
  window.sdkGameError = error.message;
  show({ error: error.message });
} finally {
  worker.terminate();
}
