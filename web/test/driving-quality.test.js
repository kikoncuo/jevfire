import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DRIVERS } from '../src/driving/contract.js';
import { DrivingGame, RACE_TIME_LIMIT } from '../src/driving/game.js';
import { distanceToBend } from '../src/driving/track.js';

const source = fs.readFileSync(
  new URL('../qa/driving-quality.js', import.meta.url),
  'utf8',
);
const load = (globals = {}) => {
  const sandbox = vm.createContext(globals);
  return { run: vm.runInContext(`(${source})`, sandbox), sandbox };
};
const { fixtures, policies } = JSON.parse(
  JSON.stringify(await load().run(null, { fixturesOnly: true })),
);

test('quality fixtures freeze four production policies and physically coherent observations', () => {
  assert.equal(fixtures.length, 12);
  assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, 12);
  assert.equal(
    fixtures.filter((fixture) => fixture.split === 'development').length,
    6,
  );
  assert.equal(
    fixtures.filter((fixture) => fixture.split === 'heldout').length,
    6,
  );
  for (const driver of DRIVERS) {
    assert.equal(policies[driver.id], driver.defaultPrompt);
    assert.equal(
      fixtures.filter((fixture) => fixture.unitId === driver.id).length,
      3,
    );
  }
  for (const fixture of fixtures) {
    assert(fixture.expected.length > 0);
    assert(
      fixture.expected.every((action) => fixture.actions.includes(action)),
    );
    assert(fixture.reason.length > 40);
    const { self, track, traffic, race } = fixture.context;
    assert(Math.abs(self.speedMps * 3.6 - self.speedKph) <= 0.2);
    assert(Math.abs(self.targetSpeedMps * 3.6 - self.targetSpeedKph) <= 0.2);
    assert.equal(race.timeLimitSeconds, RACE_TIME_LIMIT);
    const game = new DrivingGame();
    const car = game.car(fixture.unitId);
    Object.assign(car, {
      distance: self.distanceAlongTrackM,
      lane: self.lane,
      lanePosition: self.lane,
      speed: self.speedKph / 3.6,
      targetSpeed: self.targetSpeedKph / 3.6,
      tyres: self.tyres,
      damage: self.damage,
      boostEnergy: self.boostEnergy,
    });
    game.wetSector = {
      start: track.wetSector.startM,
      end: track.wetSector.endM,
      gripFactor: track.wetSector.gripFactor,
    };
    game.nearby = (_car, lane) => {
      const describe = (entry) =>
        entry ? { gap: entry.gapM, car: { speed: entry.speedMps } } : null;
      return {
        front: describe(traffic[lane]?.front),
        rear: describe(traffic[lane]?.rear),
      };
    };
    assert.deepEqual(game.availableActions(car), fixture.actions, fixture.id);
    assert(
      Math.abs(game.safeSpeed(car) - track.safeSpeedHereMps) <= 0.051,
      fixture.id,
    );
    assert(
      Math.abs(distanceToBend(car.distance) - track.nextCornerDistanceM) <=
        0.051,
      fixture.id,
    );
    for (const lane of traffic) {
      assert.equal(
        lane.canEnter,
        lane.lane !== car.lane && game.canEnter(car, lane.lane),
        fixture.id,
      );
      assert.equal(
        lane.canRiskEnter,
        lane.lane !== car.lane && game.canEnter(car, lane.lane, true),
        fixture.id,
      );
      for (const direction of ['front', 'rear']) {
        const entry = lane[direction];
        if (!entry) continue;
        const closing =
          direction === 'front'
            ? car.speed - entry.speedMps
            : entry.speedMps - car.speed;
        assert(Math.abs(entry.closingMps - closing) <= 0.051);
        if (closing > 0.1)
          assert(Math.abs(entry.ttcSeconds - entry.gapM / closing) <= 0.051);
        else assert.equal(entry.ttcSeconds, null);
      }
    }
  }
});

// This mock tests measurement accounting, never model quality. Real browser
// results come only from slipstreamProbe and are saved separately by the runner.
function fakeBrowser({ changePrompt = false } = {}) {
  const calls = [];
  const saved = new Set();
  const snapshot = {
    loaded: true,
    busy: false,
    running: false,
    time: 0,
    drivers: [],
    decisions: {},
    events: [],
    selectedHistory: [],
    metrics: {
      total_decisions: 0,
      completed_decisions: 0,
      discarded_decisions: 0,
    },
  };
  const window = {
    slipstreamDiagnostics: () => structuredClone(snapshot),
    slipstreamProbe: async (request) => {
      calls.push(structuredClone(request));
      assert.equal(request.compareWithWhole, false);
      const fixture = fixtures.find(
        (item) =>
          item.unitId === request.unitId &&
          JSON.stringify(item.context) === JSON.stringify(request.context),
      );
      const action = request.cache ? 'brake' : fixture.expected[0];
      const logits = request.actions.map((candidate) =>
        candidate === action ? 5 : 0,
      );
      const denominator = logits.reduce(
        (sum, value) => sum + Math.exp(value),
        0,
      );
      const hit = request.cache && saved.has(request.unitId);
      if (request.cache) saved.add(request.unitId);
      return {
        testOnly: true,
        unitId: request.unitId,
        parsed_json: { [request.unitId]: action },
        fields: {
          [request.unitId]: {
            value: action,
            options: request.actions,
            logits,
            probabilities: logits.map((value) => Math.exp(value) / denominator),
          },
        },
        prompt:
          JSON.stringify({
            context: request.context,
            policy: request.policy,
            actions: request.actions,
          }) + (changePrompt && request.cache ? ' changed' : ''),
        model: 'TEST-DOUBLE-NOT-A-MODEL-RUN',
        model_revision: 'test',
        label_mode: 'letters_compact',
        label_mapping: Object.fromEntries(
          request.actions.map((value, index) => [
            String.fromCharCode(65 + index),
            value,
          ]),
        ),
        elapsed_ms: request.cache ? 10 : 20,
        prefill_chunk_tokens: request.pace === 'fast' ? 128 : 32,
        cache: {
          input_tokens: 100,
          processed_tokens: hit ? 75 : 100,
          cached_prefix_tokens: hit ? 25 : 0,
          cache_hit: hit,
          forward_calls: request.cache ? 1 : 4,
        },
      };
    },
  };
  const { run, sandbox } = load({
    window,
    navigator: { userAgent: 'harness-accounting-test', hardwareConcurrency: 1 },
    location: { href: 'https://example.test/' },
  });
  const page = {
    evaluate: async (callback, value) => {
      sandbox.argument =
        value === undefined ? undefined : structuredClone(value);
      return structuredClone(
        await vm.runInContext(`(${callback.toString()})(argument)`, sandbox),
      );
    },
    waitForFunction: async (callback) => assert(await page.evaluate(callback)),
  };
  return { run, page, calls, window };
}

test('paired runner counterbalances identical inputs and reports an injected regression', async () => {
  const { run, page, calls, window } = fakeBrowser();
  const result = await run(page, { fixtureIds: ['dev-nova-clear-push'] });
  assert.equal(calls.length, 5); // One excluded warmup and two complete pairs.
  assert.deepEqual(
    calls.map((call) => call.cache),
    [true, false, true, true, false],
  );
  assert(calls.every((call) => call.policy === policies.nova));
  assert.equal(result.summary.paired_comparisons, 2);
  assert.equal(result.summary.regressions, 2);
  assert.equal(result.summary.agreement, 0);
  assert.equal(result.summary.modes.baseline.rubric_accuracy, 1);
  assert.equal(result.summary.modes.optimized.rubric_accuracy, 0);
  assert.equal(result.summary.median_paired_scorer_speedup, 2);
  assert.equal(result.summary.modes.optimized.cache_hits, 2);
  assert.equal(result.live_race_unchanged, true);
  assert.equal(window.slipstreamQualityReport.rows.length, 4);
  assert.equal(window.slipstreamQualityReport.warmups.length, 1);
  assert.equal(window.slipstreamQualityReport.status, 'complete');
});

test('paired runner rejects different prompts and retains partial raw results', async () => {
  const { run, page, window } = fakeBrowser({ changePrompt: true });
  await assert.rejects(
    run(page, { fixtureIds: ['dev-nova-clear-push'], repetitions: 1 }),
    /prompt changed across modes/,
  );
  assert.equal(window.slipstreamQualityReport.status, 'failed');
  assert.equal(window.slipstreamQualityReport.rows.length, 2);
  assert.equal(window.slipstreamQualityReport.pairs.length, 0);
});
