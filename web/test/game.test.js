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
test('automatic hunger care preserves the requested model job', () => {
  const game = peaceful(),
    unit = game.units[2];
  unit.hunger = 5;
  game.apply({ aldric: 'train' });
  game.update(1);
  assert.equal(unit.action, 'train');
  assert.ok(unit.hunger < 5);
  assert.match(unit.needsOverride, /Automatic needs/);
  assert.equal(unit.proposed, 'train');
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

test('automatic meals are visible and never manufacture model ticks', () => {
  const game = peaceful(),
    unit = game.units[2];
  Object.assign(unit, { x: unit.home.x, y: unit.home.y, hunger: 26 });
  game.apply({ aldric: 'train' });
  const before = {
    ticks: game.ticks,
    decisions: game.decisions,
    food: game.food,
  };
  game.update(0.05);
  assert.equal(unit.activity, 'eating');
  assert.equal(unit.needsState, 'eating');
  assert.match(unit.needsOverride, /Automatic needs: eating/);
  assert.equal(unit.action, 'train');
  assert.equal(unit.proposed, 'train');
  assert.equal(unit.autoTargetId, 'hall');
  assert.equal(game.food, before.food - 1);
  assert.ok(unit.hunger > 59);
  game.update(2);
  assert.equal(unit.needsOverride, null);
  assert.equal(game.ticks, before.ticks);
  assert.equal(game.decisions, before.decisions);
  assert.equal(game.selfCareMeals, 1);
});
test('a hungry villager can eat real food at a patch when the pantry is empty', () => {
  const game = peaceful(),
    unit = game.units[0],
    patch = game.resources[0];
  Object.assign(unit, { x: patch.x, y: patch.y, hunger: 24 });
  game.food = 0;
  game.apply({ mira: 'forage_safe' });
  game.update(0.05);
  assert.equal(unit.autoTargetId, patch.id);
  assert.equal(unit.activity, 'eating');
  assert.equal(patch.food, 17);
  assert.equal(game.food, 0);
  assert.equal(unit.carrying, 0);
  assert.ok(unit.hunger > 57);
});
test('automatic needs cannot invent food or prevent starvation without supplies', () => {
  const game = peaceful(),
    unit = game.units[0];
  game.food = 0;
  for (const patch of game.resources) patch.food = 0;
  unit.hunger = 1;
  game.apply({ mira: 'forage_bold' });
  advance(game, 2);
  assert.equal(unit.alive, false);
  assert.equal(unit.reason, 'starved');
  assert.equal(game.selfCareMeals, 0);
});
test('builders spend shared food to heal living allies without exceeding max health', () => {
  const game = peaceful(),
    ally = game.units[0],
    medic = game.units[5];
  Object.assign(ally, { x: 7, y: 17, health: 40 });
  Object.assign(medic, { x: 6.5, y: 17 });
  game.apply({ mira: 'forage_safe', nell: 'heal' });
  advance(game, 2.1);
  assert.equal(ally.health, 60);
  assert.equal(game.food, 5);
  assert.equal(game.treatments, 1);
  assert.equal(medic.activity, 'healing');
  ally.health = 80;
  advance(game, 2.1);
  assert.equal(ally.health, ally.maxHealth);
  assert.equal(game.food, 4);
  ally.health = 40;
  game.food = 0;
  advance(game, 1);
  assert.equal(ally.health, 40);
  assert.equal(game.food, 0);
});
test('available actions omit nonexistent work and ineffective rest', () => {
  const game = peaceful();
  assert.deepEqual(game.availableActions('tomas'), ['build']);
  assert.deepEqual(game.availableActions('aldric'), ['train']);
  game.units[2].strength = 40;
  assert.deepEqual(game.availableActions('aldric'), ['relax']);
  const orc = game.spawnOrc(1, 1);
  assert.deepEqual(game.availableActions('aldric'), ['defend']);
  orc.alive = false;
  game.hall().health = 100;
  game.units[0].health = 30;
  game.units[5].stamina = 40;
  assert.deepEqual(game.availableActions('nell'), [
    'repair',
    'build',
    'heal',
    'relax',
  ]);
  game.food = 0;
  assert.deepEqual(game.availableActions('nell'), ['repair', 'build', 'relax']);
  for (const patch of game.resources) patch.food = 0;
  assert.deepEqual(game.availableActions('mira'), ['relax']);
  game.units[0].carrying = 3;
  assert.deepEqual(game.availableActions('mira'), [
    'forage_safe',
    'forage_bold',
    'relax',
  ]);
});
test('a visible rule-only action changes work without overwriting a model proposal or counting a tick', () => {
  const game = peaceful(),
    unit = game.units[2];
  game.apply({ aldric: 'train' });
  unit.strength = 40;
  const ticks = game.ticks,
    decisions = game.decisions;
  game.applyRuleAction(unit.id, 'relax', 'Only available action');
  assert.equal(unit.action, 'relax');
  assert.equal(unit.proposed, 'train');
  assert.equal(unit.ruleAction, 'relax');
  assert.equal(unit.ruleReason, 'Only available action');
  assert.equal(game.ticks, ticks);
  assert.equal(game.decisions, decisions);
  assert.throws(() => game.applyRuleAction(unit.id, 'defend'));
});
test('personalities survive reset and builder observations include actual patients and action availability', () => {
  const game = peaceful(),
    personalities = game.units.map((unit) => unit.personality);
  assert.equal(new Set(personalities).size, 6);
  game.units[0].health = 30;
  const context = game.contextFor('nell');
  assert.equal(context.wounded_allies[0].id, 'mira');
  assert.equal(context.wounded_allies[0].health, 30);
  assert.equal(context.healing_food_cost, 1);
  assert.ok(context.available_actions.includes('heal'));
  assert.equal(context.self.personality, game.units[5].personality);
  game.reset();
  assert.deepEqual(
    game.units.map((unit) => unit.personality),
    personalities,
  );
});

test('personal stamina thresholds make breaks available at different times', () => {
  const game = peaceful(),
    mira = game.units[0],
    bram = game.units[1],
    tomas = game.units[4],
    nell = game.units[5];
  mira.stamina = bram.stamina = 60;
  assert.equal(game.availableActions(mira).includes('relax'), false);
  assert.equal(game.availableActions(bram).includes('relax'), true);
  tomas.stamina = nell.stamina = 35;
  assert.equal(game.availableActions(tomas).includes('relax'), false);
  assert.equal(game.availableActions(nell).includes('relax'), true);
  const context = game.contextFor('bram');
  assert.equal(context.self.stamina, 60);
  assert.equal(context.self.break_threshold, 70);
  assert.match(context.rest_available_reason, /Fatigue/);
});
test('a chosen stamina break persists above its trigger and ends when rested', () => {
  const game = peaceful(),
    fighter = game.units[2];
  Object.assign(fighter, { x: fighter.home.x, y: fighter.home.y, stamina: 30 });
  game.apply({ aldric: 'relax' });
  advance(game, 2);
  assert.ok(
    fighter.stamina > fighter.breakAt && fighter.stamina < fighter.restUntil,
  );
  assert.equal(fighter.restingBreak, true);
  assert.equal(fighter.action, 'relax');
  assert.match(game.contextFor('aldric').rest_available_reason, /Finishing/);
  const ticks = game.ticks;
  advance(game, 8);
  assert.equal(fighter.restingBreak, false);
  assert.equal(fighter.action, 'train');
  assert.equal(fighter.proposed, 'relax');
  assert.equal(fighter.ruleReason, 'Only available action');
  assert.equal(game.ticks, ticks);
});
test('healthy rested idle villagers take only a physically forced useful job without AI ticks', () => {
  const game = peaceful();
  game.update(0.1);
  assert.equal(game.units[2].action, 'train');
  assert.equal(game.units[4].action, 'build');
  assert.equal(game.units[0].activity, 'waiting');
  assert.match(game.units[0].reason, /waiting for a new decision/);
  assert.equal(game.ticks, 0);
  assert.equal(game.decisions, 0);
});
test('working drains stamina and rest remains available for injury, hunger, or no work', () => {
  const game = peaceful(),
    fighter = game.units[2],
    builder = game.units[4];
  Object.assign(fighter, { x: 15.2, y: 25.4 });
  game.apply({ aldric: 'train' });
  advance(game, 5);
  assert.ok(fighter.stamina < 98 && fighter.stamina > 97);
  fighter.health = 90;
  assert.equal(game.availableActions(fighter).includes('relax'), true);
  fighter.health = fighter.maxHealth;
  fighter.hunger = 60;
  assert.equal(game.availableActions(fighter).includes('relax'), true);
  for (const tower of game.buildings.filter(
    (building) => building.type === 'tower',
  )) {
    tower.progress = 1;
    tower.health = tower.maxHealth;
  }
  fighter.hunger = 100;
  assert.deepEqual(game.availableActions(builder), ['relax']);
  assert.equal(
    game.contextFor(builder.id).rest_available_reason,
    'No useful work is currently available',
  );
});
