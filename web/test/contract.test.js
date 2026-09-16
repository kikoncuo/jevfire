import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_ACTIONS,
  UNIT_DEFINITIONS,
  SCHEMA,
  schemaFor,
  assemble,
  normalize,
  validateDecision,
  isCurrentResult,
} from '../src/contract.js';

test('only schema-owned role actions and field names enter the result', () => {
  const result = assemble(SCHEMA, [
    [9, 0, 0],
    [0, 9, 0],
    [0, 0, 9],
    [9, 0, 0],
    [0, 9, 0, 0],
    [0, 0, 0, 9],
  ]);
  assert.deepEqual(result.parsed_json, {
    mira: 'forage_safe',
    bram: 'forage_bold',
    aldric: 'relax',
    sable: 'train',
    tomas: 'build',
    nell: 'relax',
  });
  assert.equal(result.scores_are_calibrated, false);
  for (const field of Object.values(result.fields))
    assert.ok(
      Math.abs(field.probabilities.reduce((a, b) => a + b) - 1) < 1e-10,
    );
});
test('individual and living-roster schemas use the matching role enums', () => {
  assert.deepEqual(schemaFor([UNIT_DEFINITIONS[2]]), {
    aldric: ROLE_ACTIONS.fighter,
  });
  assert.deepEqual(schemaFor([{ ...UNIT_DEFINITIONS[0], alive: false }]), {});
  assert.throws(() => schemaFor([{ id: 'mira', role: '__proto__' }]));
  assert.throws(() => schemaFor([{ id: 'teleport', role: 'fighter' }]));
});
test('extreme scores cannot introduce out-of-set actions', () => {
  const result = assemble({ mira: ROLE_ACTIONS.collector }, [[-1e9, 1e9, 0]]);
  assert.deepEqual(result.parsed_json, { mira: 'forage_bold' });
});
test('missing, nonfinite, duplicate and mismatched scores fail closed', () => {
  for (const scores of [[], [NaN, 0], [Infinity, 0]])
    assert.throws(() => normalize(scores));
  assert.throws(() => assemble(SCHEMA, [[1, 2, 3]]));
  assert.throws(() => assemble({ mira: ['relax', 'relax'] }, [[1, 2]]));
  assert.throws(() => assemble({ mira: ROLE_ACTIONS.collector }, [[1, 2]]));
});
test('unusual application field names are data properties without prototype mutation', () => {
  const schema = JSON.parse('{"__proto__":["yes","no"]}');
  const result = assemble(schema, [[1, 0]]).parsed_json;
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__, 'yes');
});
test('extra fields, cross-role actions and invalid values are rejected', () => {
  const schema = schemaFor([UNIT_DEFINITIONS[0]]);
  for (const decision of [
    { mira: 'relax', teleport: true },
    { mira: 'train' },
    { mira: null },
    ['relax'],
    null,
  ])
    assert.throws(() => validateDecision(decision, schema));
  assert.deepEqual(validateDecision({ mira: 'relax' }, schema), {
    mira: 'relax',
  });
});
test('paused and reset rounds reject stale decisions', () => {
  assert.equal(isCurrentResult({ epoch: 3 }, 4, true), false);
  assert.equal(isCurrentResult({ epoch: 4 }, 4, false), false);
  assert.equal(isCurrentResult({ epoch: 4 }, 4, true), true);
});

test('builders can heal and physically forced single choices retain the contract', () => {
  assert.deepEqual(
    assemble({ nell: ROLE_ACTIONS.builder }, [[0, 0, 9, 0]]).parsed_json,
    { nell: 'heal' },
  );
  assert.deepEqual(assemble({ tomas: ['relax'] }, [[5]]).parsed_json, {
    tomas: 'relax',
  });
});
