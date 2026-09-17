import test from 'node:test';
import assert from 'node:assert/strict';
import { MarioGame, FIXED_STEP } from '../src/mario/game.js';
import { LEVEL } from '../src/mario/level.js';
import {
  MANEUVERS,
  ManeuverExecutor,
  cloneMarioGame,
  forecastManeuver,
  planManeuvers,
} from '../src/mario/maneuvers.js';

const ground = { id: 'ground', type: 'ground', x: 0, y: 0, w: 100, h: 1 };
function fixture({
  solids = [ground],
  enemies = [],
  pits = [],
  spawn = { x: 3, y: 1 },
} = {}) {
  const game = new MarioGame({
    level: {
      ...LEVEL,
      id: 'fixture',
      width: 100,
      spawn,
      solids,
      enemies,
      pits,
      goal: { flagX: 98, flagTopY: 10, castleX: 99 },
    },
  });
  game.running = true;
  return game;
}
function advance(game, executor, seconds) {
  for (let t = 0; t < seconds - 1e-8 && !game.over; t += FIXED_STEP) {
    game.applyControl(executor.control(game, FIXED_STEP), 'test-maneuver');
    game.update(FIXED_STEP);
  }
}

test('forecasts clone mutable state and never apply simulated events to the game', () => {
  const game = new MarioGame();
  game.running = true;
  game.items.push({
    id: 'test-item',
    alive: true,
    x: 6,
    y: 1,
    w: 0.8,
    h: 0.8,
    vx: 0,
    vy: 0,
    age: 0,
    emerging: 0,
  });
  const executor = new ManeuverExecutor();
  const before = JSON.stringify(game),
    controllerBefore = JSON.stringify(executor);
  const plan = planManeuvers(game, { executor, latencySeconds: 0.2 });
  assert.ok(plan.options.length > 1 && plan.options.length <= 6);
  assert.equal(JSON.stringify(game), before);
  assert.equal(JSON.stringify(executor), controllerBefore);
  const clone = cloneMarioGame(game);
  clone.player.x = 90;
  clone.solids[0].broken = true;
  clone.enemies[0].alive = false;
  clone.items[0].alive = false;
  assert.equal(JSON.stringify(game), before);
});

test('only finite maneuver ids are accepted and capping a menu does not manufacture forced choices', () => {
  const game = fixture(),
    executor = new ManeuverExecutor();
  assert.throws(() => executor.choose('fly', game));
  assert.throws(() => forecastManeuver(game, 'teleport'));
  const plan = planManeuvers(game, { maxOptions: 1 });
  assert.equal(plan.options.length, 1);
  assert.equal(plan.forced, false);
  assert.ok(
    plan.candidates.every((candidate) =>
      Object.hasOwn(MANEUVERS, candidate.id),
    ),
  );
});

test('a selected full jump releases itself and never auto-jumps after landing', () => {
  const game = fixture(),
    executor = new ManeuverExecutor();
  assert.equal(executor.choose('jump', game).accepted, true);
  advance(game, executor, 0.3);
  assert.ok(game.player.y > 4 && game.control.jump);
  advance(game, executor, 1.6);
  assert.equal(game.player.onGround, true);
  assert.equal(game.control.jump, false);
  assert.equal(game.events.filter((event) => event.type === 'jump').length, 1);
  assert.equal(executor.snapshot().maneuver, 'waiting');
  assert.equal(executor.choose('jump', game).accepted, true);
  advance(game, executor, 0.05);
  assert.equal(game.events.filter((event) => event.type === 'jump').length, 2);
});

test('a previously held button is released before a fresh takeoff and short hops stay shorter', () => {
  const game = fixture(),
    executor = new ManeuverExecutor();
  game.applyControl({ direction: 'still', speed: 'walk', jump: true });
  game.jumpBuffer = 0;
  assert.equal(executor.choose('hop', game).accepted, true);
  const release = executor.control(game);
  assert.equal(release.jump, false);
  game.applyControl(release, 'test-maneuver');
  game.update(FIXED_STEP);
  advance(game, executor, FIXED_STEP);
  assert.ok(game.player.vy > 0);
  let peak = game.player.y;
  for (let step = 0; step < 150; step++) {
    advance(game, executor, FIXED_STEP);
    peak = Math.max(peak, game.player.y);
  }
  assert.ok(peak < 3.1);
  assert.equal(game.events.filter((event) => event.type === 'jump').length, 1);
});

test('mid-air steering preserves the current jump hold and does not invent a new jump', () => {
  const game = fixture(),
    executor = new ManeuverExecutor();
  executor.choose('jump', game);
  advance(game, executor, 0.1);
  assert.equal(executor.choose('run', game).accepted, true);
  advance(game, executor, 0.2);
  assert.ok(game.player.y > 4);
  assert.equal(game.events.filter((event) => event.type === 'jump').length, 1);
  assert.equal(forecastManeuver(game, 'jump', { executor }).safe, false);
});

test('trajectory filtering distinguishes pit falls, supported jumps, and enemy damage', () => {
  const pit = fixture({
    solids: [
      { ...ground, w: 7 },
      { ...ground, id: 'far', x: 10, w: 90 },
    ],
    pits: [{ x: 7, w: 3 }],
    spawn: { x: 5.5, y: 1 },
  });
  pit.player.vx = 8.4;
  assert.equal(forecastManeuver(pit, 'run').safe, false);
  const jumping = forecastManeuver(pit, 'jump');
  assert.equal(jumping.safe, true);
  assert.ok(jumping.landingX > 10);
  const contact = fixture({
    enemies: [
      {
        id: 'goomba',
        type: 'goomba',
        x: 4.3,
        y: 1,
        w: 0.8,
        h: 0.8,
        vx: -1.35,
        vy: 0,
      },
    ],
  });
  contact.player.power = 'big';
  contact.player.h = 1.78;
  assert.equal(forecastManeuver(contact, 'run').safe, false);
  assert.equal(forecastManeuver(contact, 'run').reason, 'enemy damage');
});

test('latency forecasts advance the committed maneuver and late choices are revalidated', () => {
  const game = fixture(),
    executor = new ManeuverExecutor();
  executor.choose('run', game);
  const plan = planManeuvers(game, { latencySeconds: 0.2, executor });
  assert.ok(plan.projected.x > game.player.x);
  assert.ok(plan.options.some((option) => option.id === 'run'));
  game.enemies.push({
    id: 'late',
    type: 'goomba',
    x: 3.8,
    y: 1,
    w: 0.8,
    h: 0.8,
    vx: -1.35,
    vy: 0,
    alive: true,
    active: true,
    onGround: true,
  });
  const answer = executor.choose('run', game);
  assert.equal(answer.accepted, false);
  assert.equal(executor.snapshot().rejectedSelections, 1);
  assert.equal(executor.snapshot().safetyInterventions, 0);
  assert.equal(executor.snapshot().maneuver, 'run');
});

test('a rejected choice preserves a validated escape instead of braking into a pursuing enemy', () => {
  const game = fixture({
    enemies: [
      {
        id: 'pursuer',
        type: 'goomba',
        x: 1.9,
        y: 1,
        w: 0.8,
        h: 0.8,
        vx: 1.35,
        vy: 0,
      },
    ],
  });
  const executor = new ManeuverExecutor();
  assert.equal(executor.choose('run', game).accepted, true);
  advance(game, executor, 10 * FIXED_STEP);
  const braking = cloneMarioGame(game);
  const brakeExecutor = executor.clone();
  brakeExecutor.begin('brake', braking);
  assert.equal(executor.choose('retreat', game).accepted, false);
  assert.equal(executor.snapshot().maneuver, 'run');
  advance(game, executor, 1.5);
  advance(braking, brakeExecutor, 1.5);
  assert.equal(game.dead, false);
  assert.equal(braking.dead, true);
  assert.equal(executor.snapshot().rejectedSelections, 1);
});

test('without a model choice the world keeps moving but the executor never selects forward travel', () => {
  const game = fixture(),
    executor = new ManeuverExecutor();
  advance(game, executor, 1);
  assert.equal(game.time.toFixed(2), '1.00');
  assert.equal(game.player.x, 3);
  assert.equal(executor.acceptedSelections, 0);
  executor.choose('run', game, { forced: true });
  advance(game, executor, 1);
  assert.equal(executor.snapshot().maneuver, 'waiting');
  assert.equal(executor.snapshot().forcedSelections, 1);
  assert.equal(game.player.vx, 0);
  const stoppedAt = game.player.x;
  advance(game, executor, 1);
  assert.equal(game.player.x, stoppedAt);
  executor.reset();
  assert.equal(executor.acceptedSelections, 0);
  assert.equal(executor.forcedSelections, 0);
});

// This is an explicit model-free planner baseline that verifies the finite
// maneuver space can traverse the course under inference delay. It is NOT a
// Qwen success benchmark. The baseline selects the largest forecast progress.
for (const latency of [0.08, 0.12, 0.2, 'jitter']) {
  test(`predictive argmax baseline clears the full level continuously at ${latency} seconds latency`, () => {
    const game = new MarioGame();
    game.running = true;
    const executor = new ManeuverExecutor();
    let pending = null,
      choices = 0;
    for (let frame = 0; frame < 60 * 90 && !game.over; frame++) {
      if (pending && game.time + 1e-9 >= pending.at) {
        executor.choose(pending.id, game, { forced: pending.forced });
        pending = null;
      }
      if (!pending) {
        const delay =
          latency === 'jitter' ? [0.08, 0.2, 0.12, 0.17][choices % 4] : latency;
        const plan = planManeuvers(game, { latencySeconds: delay, executor });
        const choice = [...plan.options].sort(
          (a, b) => b.progress - a.progress,
        )[0];
        if (choice) {
          pending = {
            id: choice.id,
            at: game.time + delay,
            forced: plan.forced,
          };
          choices++;
        }
      }
      advance(game, executor, 1 / 60);
    }
    assert.equal(game.won, true, `x=${game.player.x}: ${game.reason}`);
    assert.equal(game.lives, 3);
    assert.ok(game.time < 60);
    assert.ok(choices > 20);
    assert.equal(game.controlSource, 'test-maneuver');
  });
}
