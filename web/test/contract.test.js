import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  SCHEMA,
  assemble,
  normalize,
  validateDecision,
  guardAction,
  isCurrentResult,
} from '../src/contract.js';
import { Game } from '../src/game.js';

test('decision fields and values come only from the application schema', () => {
  const result = assemble(SCHEMA, [
    [9, 0, 0, 0],
    [0, 9, 0, 0],
    [0, 0, 0, 9],
  ]);
  assert.deepEqual(result.parsed_json, {
    ember: 'recover',
    moss: 'return',
    echo: 'hold',
  });
  assert.equal(result.scores_are_calibrated, false);
  for (const field of Object.values(result.fields))
    assert.ok(
      Math.abs(field.probabilities.reduce((a, b) => a + b) - 1) < 1e-10,
    );
});
test('extreme candidate scores cannot introduce values', () => {
  const result = assemble(SCHEMA, [
    [-1e9, 1e9, 0, 0],
    [0, 0, -1e9, 1e9],
    [1e9, 0, 0, 0],
  ]);
  assert.ok(
    Object.values(result.parsed_json).every((x) => ACTIONS.includes(x)),
  );
});
test('missing and nonfinite scores fail instead of inventing a fallback', () => {
  for (const scores of [[], [NaN, 0], [Infinity, 0]])
    assert.throws(() => normalize(scores));
  assert.throws(() => assemble(SCHEMA, [[1, 2, 3, 4]]));
  assert.throws(() =>
    assemble(SCHEMA, [
      [1, 2, 3],
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]),
  );
});
test('unusual field names are own properties without prototype mutation', () => {
  const schema = JSON.parse('{"__proto__":["yes","no"]}');
  const result = assemble(schema, [[1, 0]]).parsed_json;
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__, 'yes');
});
test('extra fields and invented actions are rejected by the game boundary', () => {
  assert.throws(() =>
    validateDecision({
      ember: 'hold',
      moss: 'hold',
      echo: 'hold',
      teleport: true,
    }),
  );
  assert.throws(() =>
    validateDecision({ ember: 'fly', moss: 'hold', echo: 'hold' }),
  );
  assert.throws(() =>
    validateDecision({ ember: null, moss: 'hold', echo: 'hold' }),
  );
});
test('game rules override bad allowed actions', () => {
  assert.equal(
    guardAction({ health: 10, carrying: false }, 'recover', { stock: 1 }, false)
      .action,
    'return',
  );
  assert.equal(
    guardAction({ health: 100, carrying: true }, 'recover', { stock: 1 }, false)
      .action,
    'return',
  );
  assert.equal(
    guardAction({ health: 100, carrying: false }, 'recover', { stock: 1 }, true)
      .action,
    'evade',
  );
  assert.equal(
    guardAction(
      { health: 100, carrying: false },
      'recover',
      { stock: 0 },
      false,
    ).action,
    'hold',
  );
});
test('paused and reset missions reject stale decisions', () => {
  assert.equal(isCurrentResult({ epoch: 3 }, 4, true), false);
  assert.equal(isCurrentResult({ epoch: 4 }, 4, false), false);
  assert.equal(isCurrentResult({ epoch: 4 }, 4, true), true);
});
test('cargo is collected once and deposited at base', () => {
  const g = new Game();
  g.running = true;
  const u = g.units[0],
    source = g.sources[0];
  u.x = source.x;
  u.y = source.y;
  u.proposed = 'recover';
  g.update(0.01);
  assert.equal(u.carrying, true);
  assert.equal(source.stock, 3);
  u.x = g.base.x;
  u.y = g.base.y;
  u.proposed = 'return';
  g.update(0.01);
  assert.equal(u.carrying, false);
  assert.equal(g.cores, 1);
  g.update(0.01);
  assert.equal(g.cores, 1);
});
