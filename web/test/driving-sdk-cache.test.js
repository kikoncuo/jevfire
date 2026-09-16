import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DrivingGame } from '../src/driving/game.js';
import { DRIVERS } from '../src/driving/contract.js';
import {
  buildDrivingPrompt,
  buildDrivingPromptParts,
} from '../src/driving/prompt.js';

for (const compact of [true, false]) {
  test(`driver cache prefix retains the published label ordering (compact=${compact})`, () => {
    const game = new DrivingGame();
    for (const driver of DRIVERS) {
      const context = game.contextFor(driver.id);
      const before = buildDrivingPromptParts(
        driver.id,
        context,
        '',
        driver.defaultPrompt,
        ['accelerate', 'brake', 'hold'],
        { compact },
      );
      const after = buildDrivingPromptParts(
        driver.id,
        { ...context, self: { ...context.self, speedKph: 95 } },
        '',
        driver.defaultPrompt,
        ['accelerate', 'brake', 'hold', 'boost'],
        { compact },
      );
      assert.notEqual(before.prefix, after.prefix);
      assert.notEqual(before.prompt, after.prompt);
      assert.ok(before.prompt.startsWith(before.prefix));
      assert.ok(after.prompt.startsWith(after.prefix));
      assert.ok(before.prefix.includes(driver.defaultPrompt));
      assert.ok(!before.prefix.includes('Actions:'));
      assert.ok(before.prefix.endsWith('<|im_end|>\n'));
      assert.ok(
        before.prompt
          .slice(before.prefix.length)
          .startsWith('<|im_start|>user\n'),
      );
      const changedTraffic = buildDrivingPromptParts(
        driver.id,
        { ...context, self: { ...context.self, speedKph: 95 } },
        '',
        driver.defaultPrompt,
        ['accelerate', 'brake', 'hold'],
        { compact },
      );
      assert.equal(before.prefix, changedTraffic.prefix);
      assert.notEqual(before.prompt, changedTraffic.prompt);
      assert.equal(
        buildDrivingPrompt(
          driver.id,
          context,
          '',
          driver.defaultPrompt,
          ['accelerate', 'brake', 'hold'],
          { compact },
        ),
        before.prompt,
      );
      const edited = buildDrivingPromptParts(
        driver.id,
        context,
        '',
        'Save boost. Prefer safe lane changes.',
        ['accelerate', 'brake', 'hold'],
        { compact },
      );
      assert.notEqual(before.prefix, edited.prefix);
    }
  });
}

test('drivers retain separate policies and semantic labels in the original system message', () => {
  const game = new DrivingGame();
  const parts = DRIVERS.map((driver) =>
    buildDrivingPromptParts(
      driver.id,
      game.contextFor(driver.id),
      '',
      driver.defaultPrompt,
      ['accelerate', 'hold'],
      { compact: true, labels: ['Fast', 'Stay'], assistantPrefix: 'Action:' },
    ),
  );
  assert.equal(new Set(parts.map((part) => part.prefix)).size, 4);
  for (const part of parts) {
    assert.ok(
      part.prefix.includes('Reply with ONLY one label: Fast, Stay.\nPOLICY:'),
    );
    assert.ok(part.prompt.endsWith('Action:'));
  }
});

// SHA-256 snapshots were generated from the published formatter at f2ce886,
// before SDK refactoring. Cache extraction must never reorder model-facing text.
const publishedFixture = (unitId) => ({
  self: {
    id: unitId,
    lane: 1,
    speedKph: 90,
    targetSpeedKph: 104,
    speedMps: 25,
    tyres: 80,
    damage: 12,
    boostEnergy: 50,
    boostRemaining: 0,
    riskyRemaining: 0,
    pitRemaining: 0,
    pitState: 'none',
  },
  race: {
    position: 3,
    lapsRemaining: 2,
    remainingDistanceM: 750,
    gapToLeaderM: 25,
    carAhead: { id: 'nova', gapM: 12 },
    carBehind: null,
  },
  track: {
    inBend: false,
    wetHere: false,
    safeSpeedHereMps: 31,
    safeSpeedNextMps: 18,
    nextCornerDistanceM: 40,
    nextCornerWet: true,
    brakingDistanceM: 60,
    pitEntryDistanceM: 75,
    lookaheadM: 140,
    rearVisibilityM: 80,
  },
  traffic: [
    {
      lane: 1,
      front: { gapM: 12, speedKph: 70, closingMps: 5.6, ttcSeconds: 2.1 },
      rear: null,
      canEnter: true,
      canRiskEnter: true,
    },
  ],
  assist: { enabled: true, active: false },
});
const publishedHashes = {
  'nova:true':
    '96da3116b5edb301b3dd36f153eb051bdc9bc6df21808651c72c26cf55c2f746',
  'nova:false':
    'bd71419342c5d9af896da7be6d92d30991c95cd02318504e37ec15200297067b',
  'atlas:true':
    'df0b42a44cdf3141b85004028348942b06802f2f6aaf0b95c00c788d3d07a5fd',
  'atlas:false':
    '601ffcd401246bd1d16d19dbcc0556f33333ddbe67f55325c12275438420893a',
  'juno:true':
    '932f73a26e0a17b7bd37557233cb422660098664a89a1303e32ed6ea6a1027e4',
  'juno:false':
    'f9ea7325ccc387613470fac28d6367a485a04e245805cb1f630cb4db006c0a54',
  'milo:true':
    'b684d40198658512c5142516ba0645d88f0df15749bc80fa613cb2bb7784635b',
  'milo:false':
    '4be751278b3a1a73b626b1d3676f5aff00f1b34c3994157f1309e49f87299e21',
};

test('driving prompts preserve published f2ce886 bytes for every driver and format', () => {
  for (const driver of DRIVERS)
    for (const compact of [true, false]) {
      const actual = buildDrivingPromptParts(
        driver.id,
        publishedFixture(driver.id),
        'Finish three laps.',
        'Brake before wet corners; pass when the lane is clear.',
        ['accelerate', 'brake', 'hold', 'left', 'right'],
        { compact, assistantPrefix: 'Action:' },
      );
      assert.equal(
        createHash('sha256').update(actual.prompt).digest('hex'),
        publishedHashes[driver.id + ':' + compact],
      );
    }
});
