import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMarioManeuverPrompt,
  DEFAULT_MANEUVER_POLICY,
} from '../src/mario/maneuver-prompt.js';
import { buildMarioPromptParts } from '../src/mario/prompt.js';
import { MarioGame } from '../src/mario/game.js';

test('one maneuver scores one finite field and keeps policy tokens stable across forecasts', () => {
  const first = buildMarioManeuverPrompt({
    options: [
      { id: 'run', progress: 2 },
      { id: 'jump', progress: 8 },
    ],
  });
  const next = buildMarioManeuverPrompt({
    options: [
      { id: 'walk', progress: 1 },
      { id: 'jump', progress: 6 },
    ],
  });
  assert.equal(first.sharedPrompt, next.sharedPrompt);
  assert.equal(first.fields.length, 1);
  assert.deepEqual(first.fields[0].choices, [
    { label: 'A', value: 'run' },
    { label: 'B', value: 'jump' },
  ]);
  assert.notEqual(first.fields[0].suffix, next.fields[0].suffix);
  assert.match(first.fields[0].suffix, /gain=8/);
  assert.notEqual(
    buildMarioManeuverPrompt(
      { options: [{ id: 'brake', progress: 0 }] },
      'Wait safely.',
    ).sharedPrompt,
    first.sharedPrompt,
  );
  assert.ok(first.sharedPrompt.includes(DEFAULT_MANEUVER_POLICY));
});

test('maneuver prompt rejects malformed finite choices and nonfinite forecasts', () => {
  for (const context of [
    null,
    { options: [] },
    { options: [{ id: 'run', progress: NaN }] },
    {
      options: [
        { id: 'run', progress: 2 },
        { id: 'run', progress: 3 },
      ],
    },
    { options: [{ id: '<bad>', progress: 1 }] },
  ])
    assert.throws(() => buildMarioManeuverPrompt(context));
  assert.throws(() =>
    buildMarioManeuverPrompt({ options: [{ id: 'run', progress: 1 }] }, ''),
  );
});

test('raw controls expose a stable ancestor without changing their shared observation', () => {
  const context = new MarioGame().observe();
  const first = buildMarioPromptParts(context);
  context.timeRemaining--;
  context.self.x++;
  const next = buildMarioPromptParts(context);
  assert.equal(first.stablePrefix, next.stablePrefix);
  assert.notEqual(first.sharedPrompt, next.sharedPrompt);
  assert.ok(first.sharedPrompt.startsWith(first.stablePrefix));
  assert.ok(first.stablePrefix.length < first.sharedPrompt.length);
});
