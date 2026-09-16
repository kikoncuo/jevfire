import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';

const peaceful = () => {
  const game = new Game();
  game.running = true;
  game.nextWave = Infinity;
  return game;
};
const advance = (game, seconds) => {
  for (let t = 0; t < seconds; t++) game.update(Math.min(1, seconds - t));
};

test('starvation kills instead of clamping health or changing the chosen action', () => {
  const game = peaceful(),
    unit = game.units[0];
  game.food = 0;
  unit.hunger = 0.1;
  game.apply({ mira: 'forage_bold' });
  game.update(1);
  assert.equal(unit.alive, false);
  assert.equal(unit.health, 0);
  assert.equal(unit.reason, 'starved');
  assert.equal(unit.action, 'forage_bold');
  assert.throws(() => game.apply({ mira: 'relax' }));
});
test('resting eats actual shared food only at a standing hall', () => {
  const game = peaceful(),
    unit = game.units[0];
  Object.assign(unit, { x: unit.home.x, y: unit.home.y, hunger: 40 });
  game.food = 1;
  game.update(0.1);
  assert.equal(game.food, 0);
  assert.ok(unit.hunger > 73);
  unit.hunger = 40;
  game.update(4);
  assert.ok(unit.hunger < 40);
  game.food = 1;
  game.hall().health = 0;
  game.update(0.1);
  assert.equal(game.food, 1);
  assert.equal(game.over, true);
  assert.equal(game.endReason, 'The hall was destroyed');
});
test('food is gathered and deposited once; full-basket return is part of foraging', () => {
  const game = peaceful(),
    unit = game.units[0],
    resource = game.resources[0];
  Object.assign(unit, { x: resource.x, y: resource.y, targetId: resource.id });
  game.apply({ mira: 'forage_safe' });
  advance(game, 7);
  assert.equal(unit.carrying, 3);
  assert.equal(resource.food, 15);
  Object.assign(unit, { x: unit.home.x, y: unit.home.y });
  game.update(0.1);
  assert.equal(unit.carrying, 0);
  assert.equal(game.food, 9);
  assert.equal(game.totalGathered, 3);
  game.update(0.1);
  assert.equal(game.food, 9);
});
test('training permanently raises fighter strength without changing the action', () => {
  const game = peaceful(),
    unit = game.units[2];
  Object.assign(unit, { x: 15.2, y: 25.4 });
  game.apply({ aldric: 'train' });
  advance(game, 10);
  assert.ok(unit.strength > 12);
  assert.equal(unit.action, 'train');
  game.apply({ aldric: 'relax' });
  assert.ok(unit.strength > 12);
});
test('builders finish defenses and repair damage without resurrecting ruins', () => {
  const game = peaceful(),
    unit = game.units[4],
    tower = game.buildings.find((building) => building.id === 'tower-1');
  Object.assign(unit, { x: tower.x, y: tower.y });
  game.apply({ tomas: 'build' });
  advance(game, 29);
  assert.equal(tower.progress, 1);
  assert.ok(Math.abs(tower.health - tower.maxHealth) < 1e-8);
  tower.health = 50;
  game.apply({ tomas: 'repair' });
  advance(game, 3);
  assert.ok(tower.health > 70);
  tower.health = 0;
  tower.destroyed = true;
  advance(game, 3);
  assert.equal(tower.health, 0);
});
test('orcs acquire nearby villagers and fighters taunt them away', () => {
  const game = peaceful(),
    collector = game.units[0],
    fighter = game.units[2];
  Object.assign(collector, { x: 5, y: 5 });
  Object.assign(fighter, { x: 9, y: 5 });
  const orc = game.spawnOrc(6, 5, 2);
  game.update(0.05);
  assert.equal(orc.targetId, collector.id);
  assert.ok(collector.health < collector.maxHealth);
  game.apply({ aldric: 'defend' });
  game.update(0.05);
  assert.equal(orc.targetId, fighter.id);
  assert.ok(orc.tauntedUntil > game.time);
});
test('orcs attack nearby buildings and completed towers fight back', () => {
  const game = peaceful();
  for (const unit of game.units) Object.assign(unit, { x: 29, y: 29 });
  const wall = game.buildings.find((building) => building.id === 'west-wall');
  const orc = game.spawnOrc(13, 15.4, 1);
  game.update(0.1);
  assert.equal(orc.targetId, wall.id);
  assert.ok(wall.health < wall.maxHealth);
  const tower = game.buildings.find((building) => building.id === 'tower-1');
  Object.assign(tower, { progress: 1, health: tower.maxHealth });
  advance(game, 2);
  assert.ok(orc.health < orc.maxHealth);
});
test('spatial observations expose distances, bearings, threats and route risks', () => {
  const game = peaceful(),
    unit = game.units[0];
  const orc = game.spawnOrc(9, 17, 3);
  orc.targetId = unit.id;
  const context = game.contextFor(unit.id);
  assert.equal(context.self.attacked_by, 1);
  assert.equal(context.village.threatened_villagers, 1);
  assert.equal(context.nearest_orcs[0].attacking, unit.id);
  assert.equal(context.nearest_orcs[0].bearing, 'W');
  assert.equal(
    context.food_routes.find((route) => route.id === 'west-garden').risk,
    'high',
  );
  assert.ok(context.self.starves_in_seconds > context.self.home_walk_seconds);
  assert.ok(!Object.hasOwn(context, 'repairs'));
  assert.ok(JSON.stringify(context).length < 1600);
});
test('legal bad actions remain bad: hunger does not secretly force relaxation', () => {
  const game = peaceful(),
    unit = game.units[2];
  unit.hunger = 5;
  game.apply({ aldric: 'train' });
  game.update(1);
  assert.equal(unit.action, 'train');
  assert.ok(unit.hunger < 5);
});
test('reset preserves or changes numeric and string seeds deterministically', () => {
  const a = new Game({ seed: 'winter' }),
    b = new Game({ seed: 'winter' });
  a.spawnWave();
  b.spawnWave();
  assert.deepEqual(a.orcs, b.orcs);
  a.reset();
  a.spawnWave();
  assert.deepEqual(a.orcs, b.orcs);
  a.reset({ seed: 'summer' });
  a.spawnWave();
  assert.notDeepEqual(a.orcs, b.orcs);
});
test('growing waves strengthen enemies and the explicit reference policy survives several minutes', () => {
  const durations = [];
  for (const seed of [1, 2, 3, 7341]) {
    const game = new Game({ seed });
    game.running = true;
    for (let second = 0; second < 600 && !game.over; second++) {
      game.apply(game.scripted());
      game.update(1);
    }
    durations.push(game.time);
    assert.ok(game.time > 180 && game.time < 480, `seed ${seed}: ${game.time}`);
    assert.ok(game.kills > 8);
    assert.ok(game.wave >= 6);
    assert.ok(game.totalGathered >= 20);
    assert.ok(game.events.length <= 32);
    assert.equal(game.over, true);
  }
  assert.ok(new Set(durations).size > 1);
});
