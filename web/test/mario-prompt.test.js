import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarioPromptParts } from '../src/mario/prompt.js';
import { CONTROL_SCHEMA, validateControl } from '../src/mario/contract.js';
import { FiniteDecisions } from '../src/sdk/finite-decisions.js';

const observation = () => ({
  timeRemaining: 390,
  coins: 2,
  self: { x: 12, y: 1, vx: 4.5, vy: 0, onGround: true, jumpHeld: false },
  goal: { flagX: 190, distanceX: 178 },
  geometry: {
    nextObstacle: { dx: 3, width: 2, topY: 3, heightAboveFeet: 2 },
    nextGap: { distance: 10, width: 2 },
    nearestEnemy: { dx: 5, dy: 0, vx: -1 },
    overheadBlock: {
      id: 'question-1',
      type: 'question',
      clearance: 1.5,
      content: 'mushroom',
      used: false,
    },
  },
  nearby: {
    solids: [{ dx: 3, dy: 0, w: 2, h: 2 }],
    gaps: [{ dx: 10, width: 2 }],
    enemies: [{ dx: 5, dy: 0, vx: -1 }],
    items: [{ dx: 4, dy: 3 }],
  },
});

test('Mario fields share one factual observation and keep exact typed options', () => {
  const { sharedPrompt, fields } = buildMarioPromptParts(
    observation(),
    '',
    'Reach the flag carefully.',
  );
  assert.match(sharedPrompt, /Jump begins on a new press while grounded/);
  assert.match(sharedPrompt, /jump-held=false/);
  assert.match(sharedPrompt, /starts 10 tiles ahead, width=2/);
  assert.match(sharedPrompt, /height above feet=2/);
  assert.match(sharedPrompt, /distances start at your right edge/);
  assert.match(sharedPrompt, /Other dx\/dy start at your bottom-left/);
  assert.match(sharedPrompt, /top is absolute world y/);
  assert.match(
    sharedPrompt,
    /Overhead block: question, clearance above head=1.5, content=mushroom/,
  );
  assert.match(sharedPrompt, /Reach the flag carefully/);
  assert.deepEqual(
    fields.map((field) => field.key),
    ['direction', 'jump', 'speed'],
  );
  for (const field of fields) {
    assert.deepEqual(
      field.choices.map((choice) => choice.value),
      CONTROL_SCHEMA[field.key],
    );
    assert.ok(field.suffix.endsWith('Action:\n'));
    assert.equal(field.suffix.includes('height above feet'), false);
  }
});

test('used overhead blocks never advertise their previous reward', () => {
  const context = observation();
  context.geometry.overheadBlock.used = true;
  const { sharedPrompt } = buildMarioPromptParts(context);
  assert.match(
    sharedPrompt,
    /Overhead block: question, clearance above head=1.5, content=used/,
  );
  assert.equal(sharedPrompt.includes('content=mushroom'), false);
});

test('Mario prompt rejects malformed geometry, policy and label contracts', () => {
  assert.throws(() => buildMarioPromptParts(null));
  assert.throws(() =>
    buildMarioPromptParts({ ...observation(), nearby: { solids: [] } }),
  );
  for (const policy of ['', 'x'.repeat(1001), 7])
    assert.throws(() => buildMarioPromptParts(observation(), '', policy));
  assert.throws(() => buildMarioPromptParts(observation(), 'x'.repeat(501)));
  assert.throws(() =>
    buildMarioPromptParts(observation(), '', undefined, {
      labels: ['A', 'A', 'B'],
    }),
  );
});

test('shared-context scoring produces booleans and independent finite fields with two cache hits', async () => {
  const tokenizer = {
    encode: (value) =>
      Uint32Array.from([...value].map((char) => char.charCodeAt(0))),
    decode: (ids) => String.fromCharCode(...ids),
  };
  const backend = {
    name: 'test',
    cacheSlots: 1,
    maxPrefixTokens: 10000,
    working: [],
    slots: new Map(),
    async resetWorking() {
      this.working = [];
    },
    async savePrefix(slot) {
      this.slots.set(slot, [...this.working]);
    },
    async restorePrefix(slot) {
      this.working = [...this.slots.get(slot)];
    },
    async releasePrefix(slot) {
      this.slots.delete(slot);
    },
    async forward(tokens, ids) {
      this.working.push(...tokens);
      return ids
        ? { logits: ids.map((_, index) => (index === ids.length - 1 ? 9 : 0)) }
        : {};
    },
  };
  const sdk = new FiniteDecisions({
    backend,
    tokenizer,
    maxCachedPrefixes: 1,
    maxInputTokens: 10000,
  });
  const result = await sdk.scoreFields({
    ...buildMarioPromptParts(observation()),
    chunkSize: 512,
    yieldMs: 0,
  });
  assert.deepEqual(result.parsed_json, {
    direction: 'right',
    jump: true,
    speed: 'run',
  });
  validateControl(result.parsed_json);
  assert.equal(result.usage.cache_hits, 2);
  assert.equal(result.usage.scored_positions, 3);
  assert.equal(result.usage.execution, 'shared-prefix-sequential-suffixes');
  assert.ok(result.usage.processed_tokens < result.usage.input_tokens);
  assert.equal(result.scores_are_calibrated, false);
});
