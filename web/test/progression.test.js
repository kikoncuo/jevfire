import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import {
  awardExperience,
  EXPERIENCE_RATES,
  progressionFor,
  XP_PER_LEVEL,
} from '../src/progression.js';

const makeGame = () => {
  const game = new Game({ seed: 7341 });
  game.running = true;
  game.nextWave = Infinity;
  return game;
};
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const advance = (game, seconds) => {
  for (let time = 0; time < seconds; time++)
    game.update(Math.min(1, seconds - time));
};

test('levels use real hundred-XP milestones with stable progress at boundaries', () => {
  assert.equal(XP_PER_LEVEL, 100);
  assert.deepEqual(progressionFor({ experience: 150 }), {
    level: 2,
    totalXp: 150,
    xpWithinLevel: 50,
    xpToNext: 50,
    xpForNextLevel: 100,
    nextLevelAt: 200,
    progress: 0.5,
  });
  assert.equal(progressionFor({ experience: 99.9999999999999 }).level, 2);
  assert.equal(progressionFor({ experience: 100 }).xpWithinLevel, 0);
  assert.equal(progressionFor({ experience: 100 }).xpToNext, 100);
  assert.equal(progressionFor({ experience: 0 }).level, 1);
  assert.equal(progressionFor({ experience: NaN }).level, 1);
});
test('dead actors and invalid increments cannot earn XP', () => {
  const unit = { alive: true, experience: 5 };
  for (const amount of [0, -1, NaN, Infinity])
    assert.equal(awardExperience(unit, amount), 0);
  assert.equal(unit.experience, 5);
  unit.alive = false;
  assert.equal(awardExperience(unit, 10), 0);
  assert.equal(unit.experience, 5);
});
test('all six villagers start at level one and decisions or travel alone award no XP', () => {
  const game = makeGame();
  assert.equal(game.units.length, 6);
  assert.ok(
    game.units.every(
      (unit) => unit.experience === 0 && progressionFor(unit).level === 1,
    ),
  );
  for (let i = 0; i < 20; i++) game.apply({ mira: 'forage_safe' });
  assert.equal(game.units[0].experience, 0);
  game.update(0.3);
  assert.equal(game.units[0].activity, 'walking');
  assert.equal(game.units[0].experience, 0);
});
test('both collectors earn XP only when a real food unit enters their basket', () => {
  const game = makeGame();
  for (const [index, id] of ['mira', 'bram'].entries()) {
    const unit = game.units.find((unit) => unit.id === id),
      patch = game.resources[index];
    Object.assign(unit, { x: patch.x, y: patch.y });
    game.apply({ [id]: 'forage_safe' });
  }
  advance(game, 2.15);
  for (const unit of game.units.filter((unit) => unit.role === 'collector')) {
    assert.equal(unit.carrying, 1);
    assert.equal(unit.experience, EXPERIENCE_RATES.harvestedFood);
  }
});
test('both fighters earn training XP only on the training ground and reach level two', () => {
  const game = makeGame();
  Object.assign(game.units[2], { x: 15.2, y: 25.4 });
  Object.assign(game.units[3], { x: 16.8, y: 25.4 });
  game.apply({ aldric: 'train', sable: 'train' });
  advance(game, 50);
  for (const unit of game.units.filter((unit) => unit.role === 'fighter')) {
    close(unit.experience, 50 * EXPERIENCE_RATES.trainingSecond);
    assert.equal(progressionFor(unit).level, 2);
    close(unit.strength, 17); // Levels do not add a damage bonus.
    assert.equal(game.contextFor(unit.id).self.level, 2);
  }
});
test('fighter XP counts actual damage, not overkill, corpse hits, or tower attacks', () => {
  const game = makeGame(),
    fighter = game.units[2];
  const orc = game.spawnOrc(1, 1, 1),
    hp = orc.health;
  game.damage(orc, hp + 100, fighter);
  assert.equal(fighter.experience, hp * EXPERIENCE_RATES.orcDamage);
  game.damage(orc, 100, fighter);
  assert.equal(fighter.experience, hp * EXPERIENCE_RATES.orcDamage);
  const nextOrc = game.spawnOrc(1, 1, 1),
    tower = game.buildings.find((building) => building.type === 'tower');
  game.damage(nextOrc, 8, tower);
  assert.equal(fighter.experience, hp * EXPERIENCE_RATES.orcDamage);
  assert.equal(tower.experience, undefined);
});
test('builders earn repair and construction XP in proportion to actual completed work', () => {
  const game = makeGame(),
    builder = game.units[4],
    medicBuilder = game.units[5];
  const wall = game.buildings.find((building) => building.id === 'west-wall');
  wall.health = wall.maxHealth - 10;
  Object.assign(builder, { x: wall.x, y: wall.y });
  game.apply({ tomas: 'repair' });
  game.stepUnit(builder, 0.5);
  close(builder.experience, 5 * EXPERIENCE_RATES.repairedHealth);
  const tower = game.buildings.find((building) => building.id === 'tower-1');
  Object.assign(tower, { progress: 0.99, health: tower.maxHealth * 0.99 });
  Object.assign(medicBuilder, { x: tower.x, y: tower.y });
  game.apply({ nell: 'build' });
  game.stepUnit(medicBuilder, 1);
  assert.equal(tower.progress, 1);
  close(medicBuilder.experience, 0.01 * EXPERIENCE_RATES.completedTower);
});
test('healing XP follows restored health and requires the actual paid treatment', () => {
  const game = makeGame(),
    ally = game.units[0],
    medic = game.units[5];
  Object.assign(ally, { x: 7, y: 17, health: 40 });
  Object.assign(medic, { x: 6.5, y: 17 });
  game.apply({ mira: 'forage_safe', nell: 'heal' });
  advance(game, 2.1);
  close(medic.experience, 20 * EXPERIENCE_RATES.healedHealth);
  ally.health = ally.maxHealth - 5;
  advance(game, 2.1);
  close(medic.experience, 25 * EXPERIENCE_RATES.healedHealth);
  ally.health = 40;
  game.food = 0;
  const xp = medic.experience;
  game.stepUnit(medic, 0.1);
  assert.equal(medic.experience, xp);
});
test('meals award no work XP, dead villagers stop earning, and reset clears progression', () => {
  const game = makeGame(),
    unit = game.units[0];
  Object.assign(unit, { x: unit.home.x, y: unit.home.y, hunger: 26 });
  game.apply({ mira: 'forage_safe' });
  game.update(0.05);
  assert.equal(unit.activity, 'eating');
  assert.equal(unit.experience, 0);
  awardExperience(unit, 123);
  game.killUnit(unit, 'test death');
  game.stepUnit(unit, 5);
  assert.equal(unit.experience, 123);
  game.reset();
  assert.ok(
    game.units.every(
      (unit) => unit.experience === 0 && progressionFor(unit).level === 1,
    ),
  );
});
