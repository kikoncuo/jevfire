import test from 'node:test';
import assert from 'node:assert/strict';
import { MarioGame, WALK_SPEED, RUN_SPEED } from '../src/mario/game.js';
import { LEVEL } from '../src/mario/level.js';
import { CONTROL_SCHEMA, validateControl } from '../src/mario/contract.js';

const control = (direction = 'still', jump = false, speed = 'walk') => ({
  direction,
  jump,
  speed,
});
const advance = (game, seconds, dt = 1 / 120) => {
  for (let time = 0; time < seconds - 1e-8 && !game.over; time += dt)
    game.update(Math.min(dt, seconds - time));
};
const ground = { id: 'ground', type: 'ground', x: 0, y: 0, w: 40, h: 1 };
const fixture = ({
  solids = [ground],
  enemies = [],
  pits = [],
  spawn = { x: 3, y: 1 },
} = {}) => {
  const game = new MarioGame({
    level: {
      ...LEVEL,
      width: 40,
      solids,
      enemies,
      pits,
      spawn,
      goal: { flagX: 36, flagTopY: 10, castleX: 38 },
    },
  });
  game.running = true;
  return game;
};
const goomba = (x = 3.1) => ({
  id: 'goomba',
  type: 'goomba',
  x,
  y: 1,
  w: 0.8,
  h: 0.8,
  vx: -1.35,
  vy: 0,
});

test('typed control has exactly three finite fields and rejects extra or mistyped values', () => {
  assert.deepEqual(Object.keys(CONTROL_SCHEMA), ['direction', 'jump', 'speed']);
  assert.deepEqual(
    validateControl(control('right', true, 'run')),
    control('right', true, 'run'),
  );
  for (const bad of [
    null,
    [],
    {},
    { ...control(), jump: 'true' },
    { ...control(), direction: 'up' },
    { ...control(), speed: 'sprint' },
    { ...control(), invented: 1 },
  ])
    assert.throws(() => validateControl(bad));
  const game = fixture();
  game.applyControl(control('right'), 'model');
  const before = { ...game.control };
  assert.throws(() => game.applyControl({ ...control(), jump: 1 }));
  assert.deepEqual(game.control, before);
});

test('the authored course contains the landmark mechanics without mutating its level definition', () => {
  const game = new MarioGame();
  assert.equal(LEVEL.id, '1-1');
  assert.ok(LEVEL.width >= 200);
  assert.equal(LEVEL.pits.length, 3);
  for (const type of ['question', 'brick', 'pipe', 'stair', 'ground'])
    assert.ok(LEVEL.solids.some((solid) => solid.type === type));
  assert.ok(LEVEL.enemies.length >= 10);
  game.blocks[0].used = true;
  assert.equal(
    LEVEL.solids.find((solid) => solid.id === game.blocks[0].id).used,
    false,
  );
});

test('persistent walking and running obey speed limits and a solid pipe blocks horizontal motion', () => {
  const walk = fixture(),
    run = fixture();
  walk.applyControl(control('right', false, 'walk'));
  run.applyControl(control('right', false, 'run'));
  advance(walk, 0.8);
  advance(run, 0.8);
  assert.equal(walk.player.vx, WALK_SPEED);
  assert.equal(run.player.vx, RUN_SPEED);
  assert.ok(run.player.x > walk.player.x);
  const blocked = fixture({
    solids: [ground, { id: 'pipe', type: 'pipe', x: 7, y: 1, w: 2, h: 3 }],
  });
  blocked.applyControl(control('right', false, 'run'));
  advance(blocked, 2);
  assert.ok(blocked.player.x + blocked.player.w <= 7.000001);
  assert.equal(blocked.player.y, 1);
  assert.equal(blocked.player.vx, 0);
});

test('holding jump rises higher than a tap and does not automatically bounce again on landing', () => {
  const held = fixture(),
    tapped = fixture();
  held.applyControl(control('still', true));
  tapped.applyControl(control('still', true));
  advance(held, 0.08);
  advance(tapped, 0.08);
  tapped.applyControl(control());
  advance(held, 0.5);
  advance(tapped, 0.5);
  assert.ok(held.player.y > tapped.player.y + 2);
  advance(held, 2);
  assert.equal(held.player.y, 1);
  assert.equal(held.player.onGround, true);
  assert.equal(held.events.filter((event) => event.type === 'jump').length, 1);
  held.applyControl(control());
  held.applyControl(control('still', true));
  advance(held, 0.1);
  assert.ok(held.player.y > 1.5);
});

test('head collision awards each question-block coin once and big Mario can break bricks', () => {
  const question = {
    id: 'question',
    type: 'question',
    content: 'coin',
    x: 3,
    y: 4,
    w: 1,
    h: 1,
  };
  const game = fixture({ solids: [ground, question] });
  game.applyControl(control('still', true));
  advance(game, 0.5);
  assert.equal(game.coins, 1);
  assert.equal(game.blocks[0].used, true);
  assert.equal(game.score, 200);
  advance(game, 1);
  game.applyControl(control());
  game.applyControl(control('still', true));
  advance(game, 0.5);
  assert.equal(game.coins, 1);
  const brick = fixture({
    solids: [
      ground,
      { ...question, id: 'brick', type: 'brick', content: null },
    ],
  });
  brick.player.power = 'big';
  brick.player.h = 1.78;
  brick.applyControl(control('still', true));
  advance(brick, 0.3);
  assert.equal(brick.blocks[0].broken, true);
  assert.equal(brick.score, 50);
  assert.ok(brick.effects.some((effect) => effect.type === 'brick'));
});

test('mushrooms emerge from a hit block, become collectible, and grant a real damage buffer', () => {
  const game = fixture({
    solids: [
      ground,
      {
        id: 'power',
        type: 'question',
        content: 'mushroom',
        x: 3,
        y: 4,
        w: 1,
        h: 1,
      },
    ],
  });
  game.applyControl(control('still', true));
  advance(game, 0.3);
  assert.equal(game.items.length, 1);
  assert.ok(game.items[0].emerging > 0);
  const mushroom = game.items[0];
  Object.assign(mushroom, {
    x: game.player.x,
    y: 1,
    emerging: 0,
    vx: 0,
    vy: 0,
  });
  Object.assign(game.player, { y: 1, vy: 0, onGround: true });
  game.applyControl(control());
  advance(game, 1 / 60);
  assert.equal(mushroom.alive, false);
  assert.equal(game.player.power, 'big');
  assert.equal(game.player.h, 1.78);
  game.hurt('test contact');
  assert.equal(game.player.power, 'small');
  assert.equal(game.dead, false);
  assert.ok(game.player.invincible > 0);
  game.hurt('second contact during flashing');
  assert.equal(game.dead, false);
});

test('descending onto a Goomba stomps and bounces while side contact kills small Mario', () => {
  const stomp = fixture({ enemies: [goomba()] });
  Object.assign(stomp.player, { y: 2.4, vy: -5, onGround: false, coyote: 0 });
  advance(stomp, 0.12);
  assert.equal(stomp.enemies[0].squashed, true);
  assert.equal(stomp.enemies[0].alive, false);
  assert.ok(stomp.player.vy > 0);
  assert.equal(stomp.score, 100);
  assert.equal(stomp.dead, false);
  const side = fixture({ enemies: [goomba()] });
  advance(side, 1 / 60);
  assert.equal(side.dead, true);
  assert.equal(side.running, false);
  assert.equal(side.lives, 2);
});

test('a pit causes an actual fall and a properly timed jump clears it', () => {
  const options = {
    solids: [
      { ...ground, w: 7 },
      { ...ground, id: 'far', x: 10, w: 30 },
    ],
    pits: [{ x: 7, w: 3 }],
  };
  const fall = fixture(options);
  fall.applyControl(control('right', false, 'run'));
  advance(fall, 2);
  assert.equal(fall.dead, true);
  assert.equal(fall.reason, 'Fell into a pit');
  const jump = fixture(options);
  jump.player.x = 5;
  jump.player.vx = RUN_SPEED;
  jump.applyControl(control('right', true, 'run'));
  advance(jump, 1.5);
  assert.equal(jump.dead, false);
  assert.ok(jump.player.x > 10);
  assert.equal(jump.player.onGround, true);
});

test('observations report measured geometry, jump state and nearby items without invented fields', () => {
  const game = fixture({
    solids: [
      ground,
      { id: 'pipe', type: 'pipe', x: 8, y: 1, w: 2, h: 3 },
      {
        id: 'question',
        type: 'question',
        x: 3,
        y: 4,
        w: 1,
        h: 1,
        content: 'coin',
      },
    ],
    pits: [{ x: 12, w: 3 }],
    enemies: [goomba(10)],
  });
  game.applyControl(control('right', true, 'run'));
  const observation = game.observe();
  assert.equal(observation.self.jumpHeld, true);
  assert.deepEqual(observation.self.control, control('right', true, 'run'));
  assert.equal(observation.geometry.nextObstacle.dx, 4.28);
  assert.equal(observation.geometry.nextObstacle.topY, 4);
  assert.equal(observation.geometry.nextGap.distance, 8.28);
  assert.equal(observation.geometry.overheadBlock.clearance, 2.06);
  assert.equal(observation.nearby.enemies[0].dx, 7);
  assert.ok(observation.units.position.includes('y up'));
  observation.self.control.direction = 'left';
  assert.equal(game.control.direction, 'right');
});

test('reset and restart restore blocks, entities, controls and terminal states', () => {
  const game = new MarioGame();
  game.coins = 3;
  game.score = 500;
  game.blocks[0].used = true;
  game.die('pit');
  game.restart();
  assert.equal(game.lives, 2);
  assert.equal(game.dead, false);
  assert.equal(game.won, false);
  assert.equal(game.status, 'ready');
  assert.equal(game.running, false);
  assert.equal(game.blocks[0].used, false);
  assert.equal(game.coins, 0);
  assert.deepEqual(game.control, control());
  assert.equal(game.events.length, 0);
  game.reset();
  assert.equal(game.lives, 3);
});

test('the flag wins, timeout kills, and stopped worlds do not advance during inference', () => {
  const flag = fixture();
  flag.player.x = 35.5;
  advance(flag, 1 / 60);
  assert.equal(flag.won, true);
  assert.equal(flag.over, true);
  assert.equal(flag.running, false);
  assert.ok(flag.score >= 1000);
  const ended = flag.time;
  flag.update(0.2);
  assert.equal(flag.time, ended);
  const timeout = fixture();
  timeout.time = 399.99;
  advance(timeout, 0.05);
  assert.equal(timeout.reason, 'Time ran out');
  const paused = fixture();
  paused.running = false;
  paused.applyControl(control('right', true, 'run'));
  paused.update(0.2);
  assert.equal(paused.time, 0);
  assert.equal(paused.player.x, 3);
});

test('physics is frame-grouping independent and identical controls do not flood events', () => {
  const a = fixture(),
    b = fixture();
  a.applyControl(control('right'));
  b.applyControl(control('right'));
  advance(a, 2, 1 / 120);
  advance(b, 2, 0.1);
  assert.ok(Math.abs(a.player.x - b.player.x) < 1e-8);
  for (let i = 0; i < 100; i++) a.applyControl(control('right'));
  assert.equal(a.events.filter((event) => event.type === 'control').length, 1);
  const time = a.time;
  a.update(10);
  assert.ok(Math.abs(a.time - time - 0.25) < 1e-8);
});

test('the explicit 60Hz scripted reference clears the complete authored course without bypassing collisions', () => {
  const game = new MarioGame();
  game.running = true;
  for (let frame = 0; frame < 60 * 90 && !game.over; frame++) {
    game.applyControl(game.scriptedAction(), 'scripted');
    game.update(1 / 60);
  }
  assert.equal(game.won, true, `Stopped at x=${game.player.x}: ${game.reason}`);
  assert.equal(game.dead, false);
  assert.equal(game.lives, 3);
  assert.ok(game.player.x + game.player.w >= LEVEL.goal.flagX);
  assert.ok(game.coins >= 1);
  assert.ok(game.summary().defeatedEnemies >= 1);
  assert.equal(game.controlSource, 'scripted');
  assert.ok(game.time < 60);
});
