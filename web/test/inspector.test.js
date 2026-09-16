import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DecisionJournal,
  currentActivity,
  currentJob,
  targetName,
} from '../src/inspector.js';
import { Game } from '../src/game.js';

test('history attributes actual sources, retains repeated AI decisions, and bounds each character independently', () => {
  const log = new DecisionJournal(3);
  log.record('mira', { action: 'forage_safe', source: 'model', at: 1 });
  log.record('mira', { action: 'forage_safe', source: 'model', at: 2 });
  log.record('nell', { action: 'build', source: 'rule', at: 3 });
  log.record('nell', { action: 'build', source: 'rule', at: 4 });
  log.record('mira', { action: 'Meal break', source: 'needs', at: 5 });
  assert.equal(log.command('mira').source, 'model');
  assert.equal(log.history('nell').length, 1);
  log.record('mira', { action: 'relax', source: 'scripted', at: 6 });
  assert.deepEqual(
    log.history('mira').map((x) => x.at),
    [6, 5, 2],
  );
  log.reset();
  assert.equal(log.history('mira').length, 0);
});

test('the current job makes a meal or forced action explicit instead of claiming an old AI choice', () => {
  const game = new Game(),
    unit = game.units[2];
  game.applyRuleAction(unit.id, 'train');
  assert.deepEqual(currentJob(unit, { source: 'model' }, true), {
    label: 'Train',
    source: 'rule',
    detail: 'Only available action',
  });
  unit.needsOverride = 'Automatic needs: eating at the hall';
  unit.needsState = 'eating';
  unit.activity = 'eating';
  unit.autoTargetId = 'hall';
  assert.equal(currentJob(unit, { source: 'model' }, true).source, 'needs');
  assert.equal(currentActivity(game, unit), 'Eating · Hall / canteen');
  unit.alive = false;
  assert.equal(currentJob(unit, { source: 'model' }, true).label, 'Died');
});

test('target names identify allies and locations instead of exposing raw ids', () => {
  const game = new Game();
  assert.equal(targetName(game, 'nell'), 'Nell');
  assert.equal(targetName(game, 'training'), 'Training yard');
  assert.equal(targetName(game, 'tower-2'), 'Tower 2');
});
