// Run with `node qa/driving-balance.js` from web/. No model, browser, or network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import {
  DrivingGame,
  FIXED_STEP,
  RACE_LAPS,
  RACE_DISTANCE,
  RACE_TIME_LIMIT,
} from '../src/driving/game.js';

const SEEDS = [7, 8, 9];
const DECISION_INTERVAL = 1.1;
const precision = (value) => (value === null ? null : Number(value.toFixed(6)));
const sourceFiles = [
  'src/driving/game.js',
  'src/driving/track.js',
  'src/driving/contract.js',
  'src/driving/main.js',
  'qa/driving-balance.js',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(new URL(`../${path}`, import.meta.url)))
        .digest('hex'),
    ]),
  ),
);

function run(seed) {
  const game = new DrivingGame({ seed });
  game.assistEnabled = true;
  game.running = true;
  const grid = game.drivers.map((car) => ({
    id: car.id,
    lane: car.lane,
    progress_m: car.progress,
    speed_mps: car.speed,
  }));
  const seen = new WeakSet();
  const events = [];
  const eventCounts = {};
  const driverEventCounts = Object.fromEntries(
    game.drivers.map((car) => [car.id, {}]),
  );
  const batches = [];
  let lastScripted = -Infinity;
  let applications = 0;
  let revalidatedHolds = 0;
  const collectEvents = () => {
    // The live event array is bounded to 80. Capture each actual event once
    // as it arrives; do not alter the game's event method or simulation state.
    for (const event of game.events) {
      if (seen.has(event)) continue;
      seen.add(event);
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
      const driverCounts = driverEventCounts[event.carId];
      if (driverCounts)
        driverCounts[event.type] = (driverCounts[event.type] || 0) + 1;
      if (event.type !== 'decision')
        events.push({ ...event, time: precision(event.time) });
    }
  };

  // main.js advances physics first, then evaluates the scripted cadence.
  // Here RAF is represented by deterministic 1/60-second virtual frames.
  for (
    let frame = 0;
    frame < Math.ceil((RACE_TIME_LIMIT + 1) / FIXED_STEP) && !game.over;
    frame++
  ) {
    game.update(FIXED_STEP);
    collectEvents();
    if (game.running && game.time - lastScripted >= DECISION_INTERVAL) {
      lastScripted = game.time;
      const decisions = game.scripted();
      const applied = {};
      for (const [id, proposed] of Object.entries(decisions)) {
        const options = game.availableActions(id);
        if (!options.length) continue;
        const action = options.includes(proposed) ? proposed : 'hold';
        if (action !== proposed) revalidatedHolds++;
        game.apply({ [id]: action }, 'scripted');
        applied[id] = action;
        applications++;
      }
      batches.push({ time: game.time, applied });
      collectEvents();
    }
  }

  assert.equal(game.over, true, `Seed ${seed} must reach a race outcome`);
  assert.equal(game.running, false);
  assert.ok(game.drivers.every((car) => car.finished || car.retired));
  assert.ok(game.drivers.every((car) => car.source === 'scripted'));
  for (const car of game.cars)
    for (const field of ['speed', 'progress', 'tyres', 'damage', 'boostEnergy'])
      assert.ok(Number.isFinite(car[field]), `${car.id}.${field} is finite`);

  const intervals = batches
    .slice(1)
    .map((batch, i) => batch.time - batches[i].time);
  const serviceStarts = new Map();
  const entryStarts = new Map();
  const pitDurations = [];
  for (const event of events) {
    if (event.type !== 'pit') continue;
    if (event.phase === 'entering') entryStarts.set(event.carId, event.time);
    if (event.phase === 'service') serviceStarts.set(event.carId, event.time);
    if (event.phase === 'serviced') {
      pitDurations.push({
        car_id: event.carId,
        entered_at: entryStarts.get(event.carId) ?? null,
        service_started_at: serviceStarts.get(event.carId) ?? null,
        service_completed_at: event.time,
        stopped_service_seconds: precision(
          event.time - serviceStarts.get(event.carId),
        ),
        rejoined_at: null,
        pit_lane_seconds: null,
      });
    }
    if (event.phase === 'exit') {
      const visit = pitDurations.findLast(
        (candidate) =>
          candidate.car_id === event.carId && candidate.rejoined_at === null,
      );
      if (visit) {
        visit.rejoined_at = event.time;
        visit.pit_lane_seconds = precision(event.time - visit.entered_at);
      }
    }
  }

  return {
    seed,
    controller: 'Explicit scripted baseline; driver prompts are not read',
    model_requests: 0,
    initial_grid: grid,
    wet_sector: game.wetSector,
    winner_id: game.winner,
    winner_finish_seconds: precision(game.winnerTime),
    simulated_duration_seconds: precision(game.time),
    race_over: game.over,
    end_reason: game.endReason,
    scripted_batches: batches.length,
    scripted_action_applications: applications,
    revalidated_to_hold: revalidatedHolds,
    observed_decision_interval_seconds: {
      minimum: precision(Math.min(...intervals)),
      maximum: precision(Math.max(...intervals)),
      mean: precision(
        intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      ),
    },
    totals: {
      finished: game.summary().finished,
      retired: game.summary().retired,
      laps: game.summary().laps,
      overtakes: game.summary().overtakes,
      contact_episodes: game.summary().contacts,
      braking_assist_episodes: game.summary().assists,
      spins: game.summary().spins,
      completed_pit_stops: game.summary().pitStops,
      distance_travelled_m: precision(game.summary().distance),
    },
    standings: game.orderedDrivers().map((car) => ({
      id: car.id,
      name: car.name,
      position: car.racePosition,
      finished: car.finished,
      retired: car.retired,
      retirement_reason: car.retirementReason || null,
      finish_seconds: precision(car.finishTime),
      completed_laps: car.laps,
      race_distance_m: precision(car.raceDistance),
      distance_travelled_m: precision(car.totalDistance),
      final_resources: {
        tyres_percent: precision(car.tyres),
        damage_percent: precision(car.damage),
        boost_energy_percent: precision(car.boostEnergy),
      },
      overtakes: car.overtakes,
      contacts: car.contacts,
      braking_assists: car.assistCount,
      spins: car.spins,
      completed_pit_stops: car.pitStops,
      event_counts: driverEventCounts[car.id],
    })),
    event_counts: eventCounts,
    pit_durations: pitDurations,
    events,
  };
}

const report = {
  generated_at: new Date().toISOString(),
  scope: 'Deterministic racing-mechanics and scripted-balance checks',
  model_requests: 0,
  reproduction: 'cd web && node qa/driving-balance.js',
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  source_sha256: sourceHashes,
  setup: {
    seeds: SEEDS,
    controlled_cars: 4,
    background_traffic: 6,
    race_laps: RACE_LAPS,
    finish_distance_m: RACE_DISTANCE,
    maximum_simulated_seconds: RACE_TIME_LIMIT,
    simulation_step_seconds: FIXED_STEP,
    following_assist_enabled: true,
    nominal_scripted_decision_interval_seconds: DECISION_INTERVAL,
    scheduling:
      'Physics first; if simulation time since the previous batch is >=1.1s, call scripted(), then revalidate and apply each car sequentially, replacing unavailable proposals with hold. This matches main.js at 60 virtual frames/s.',
  },
  limitations: [
    'Zero model requests. These outcomes do not measure Qwen policy quality, inference speed, browser FPS or a benefit of JEVfire.',
    'Scripted strategies are explicitly coded; editable model prompts do not influence this controller.',
    'The seed changes wet-sector grip and the staggered grid. These are development balance runs, not controlled comparisons of driver personalities.',
    'Browser frame cadence and simulation speed can move a controller update by a frame and change race outcomes. The observed interval range is recorded.',
    'Event counts include every actual event captured during the run; the events array omits repetitive decision events. Contact episodes are counted once per incident, not once per car.',
    'All durations are simulated seconds. Wall-clock execution speed is not benchmarked.',
  ],
  runs: SEEDS.map(run),
};
await writeFile(
  new URL('./driving-balance.json', import.meta.url),
  await format(JSON.stringify(report), { parser: 'json', printWidth: 80 }),
);
console.log(
  JSON.stringify(
    {
      scope: report.scope,
      model_requests: 0,
      runs: report.runs.map((run) => ({
        seed: run.seed,
        winner: run.winner_id,
        winner_seconds: run.winner_finish_seconds,
        duration_seconds: run.simulated_duration_seconds,
        ...run.totals,
      })),
    },
    null,
    2,
  ),
);
