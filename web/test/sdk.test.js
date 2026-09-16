import test from 'node:test';
import assert from 'node:assert/strict';
import { FiniteDecisions } from '../src/sdk/index.js';

const tokenizer = {
  encode: (s) => Array.from(s, (c) => c.charCodeAt(0)),
  decode: (t) => String.fromCharCode(...t),
};
// This backend scores the complete state it actually received. A leaked suffix,
// stale checkpoint or bad restore changes logits and is observable by tests.
class StateBackend {
  constructor(slots = 2) {
    this.cacheSlots = slots;
    this.maxPrefixTokens = 1000;
    this.name = 'test-state-machine';
    this.states = new Map();
    this.working = [];
    this.calls = [];
    this.resets = 0;
  }
  async resetWorking() {
    this.working = [];
    this.resets++;
  }
  async savePrefix(slot, length) {
    assert.equal(length, this.working.length);
    assert.ok(!this.states.has(slot));
    this.states.set(slot, [...this.working]);
  }
  async restorePrefix(slot, length) {
    assert.equal(this.states.get(slot).length, length);
    this.working = [...this.states.get(slot)];
  }
  async releasePrefix(slot) {
    assert.ok(this.states.delete(slot));
  }
  async forward(tokens, ids) {
    this.calls.push([...tokens]);
    this.working.push(...tokens);
    await Promise.resolve();
    const hash = this.working.reduce((h, t) => (h * 31 + t) % 997, 1);
    return ids ? { logits: ids.map((id) => (hash * id) % 101) } : {};
  }
}
const setup = (slots = 2, t = tokenizer) => {
  const backend = new StateBackend(slots);
  return { backend, sdk: new FiniteDecisions({ backend, tokenizer: t }) };
};
const request = (overrides = {}) => ({
  prompt: 'Instructions. World: 1',
  prefix: 'Instructions.',
  cacheKey: 'actor',
  candidateTokenIds: [65, 66, 67],
  chunkSize: 4,
  yieldMs: 0,
  ...overrides,
});

test('warm prefix processes only changed context, with the same full-state scores', async () => {
  const { sdk } = setup();
  await sdk.score(request());
  const warm = await sdk.score(request({ prompt: 'Instructions. World: 2' }));
  const fresh = await sdk.score(
    request({ prompt: 'Instructions. World: 2', useCache: false }),
  );
  assert.deepEqual(warm.logits, fresh.logits);
  assert.equal(warm.usage.cached_prefix_tokens, 13);
  assert.equal(warm.usage.processed_tokens, 9);
  assert.ok(warm.usage.cache_hit);
  assert.equal(fresh.usage.cached_prefix_tokens, 0);
});
test('policy changes invalidate same-key entries and do not affect other actors', async () => {
  const { sdk } = setup();
  await sdk.score(request());
  await sdk.score(request({ cacheKey: 'other' }));
  const edited = await sdk.score(
    request({ prefix: 'Replacement.', prompt: 'Replacement. World: 1' }),
  );
  assert.equal(edited.usage.cache_hit, false);
  assert.equal(
    (await sdk.score(request({ cacheKey: 'other' }))).usage.cache_hit,
    true,
  );
  assert.deepEqual(
    edited.logits,
    (
      await sdk.score(
        request({
          prefix: 'Replacement.',
          prompt: 'Replacement. World: 1',
          useCache: false,
        }),
      )
    ).logits,
  );
});
test('LRU eviction releases and reuses bounded checkpoint slots', async () => {
  const { sdk, backend } = setup();
  for (const key of ['one', 'two', 'one', 'three'])
    await sdk.score(request({ cacheKey: key }));
  assert.deepEqual([...sdk.prefixes.keys()], ['one', 'three']);
  assert.equal(backend.states.size, 2);
  assert.equal(
    (await sdk.score(request({ cacheKey: 'two' }))).usage.cache_hit,
    false,
  );
  await sdk.clear();
  assert.equal(backend.states.size, 0);
});
test('token boundaries are taken from full prompt, not separately encoded text', async () => {
  const merged = {
    encode: (s) =>
      s === 'ab' ? [1, 2] : s === 'abc' ? [1, 9] : tokenizer.encode(s),
    decode: tokenizer.decode,
  };
  const { sdk } = setup(2, merged);
  const q = request({ prompt: 'abc', prefix: 'ab' });
  await sdk.score(q);
  const b = await sdk.score(q);
  assert.equal(b.usage.cached_prefix_tokens, 1);
  assert.equal(b.usage.processed_tokens, 1);
});
test('multiple fields share context without sharing earlier answers or suffixes', async () => {
  const { sdk } = setup();
  const fields = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((key) => ({
    key,
    suffix: key,
    choices: [
      { label: 'A', value: true },
      { label: 'B', value: 12 },
      { label: 'C', value: null },
    ],
  }));
  const cached = await sdk.scoreFields({
    sharedPrompt: 'World:',
    fields,
    chunkSize: 3,
    yieldMs: 0,
  });
  const fresh = await sdk.scoreFields({
    sharedPrompt: 'World:',
    fields,
    useCache: false,
    chunkSize: 3,
    yieldMs: 0,
  });
  assert.deepEqual(cached.fields, fresh.fields);
  assert.equal(cached.usage.cache_hits, 4);
  assert.equal(cached.usage.scored_positions, 5);
  assert.equal(
    fresh.usage.processed_tokens - cached.usage.processed_tokens,
    24,
  );
  const reverse = await sdk.scoreFields({
    sharedPrompt: 'World:',
    fields: [...fields].reverse(),
    yieldMs: 0,
  });
  assert.deepEqual(cached.fields, reverse.fields);
});
test('queued requests cannot interleave model state', async () => {
  const { sdk } = setup();
  const inputs = [
    request(),
    request({ prompt: 'Instructions. Different context', cacheKey: 'other' }),
    request({ prompt: 'Instructions. Yet another' }),
  ];
  const parallel = await Promise.all(inputs.map((q) => sdk.score(q)));
  const { sdk: independent } = setup();
  for (let i = 0; i < inputs.length; i++)
    assert.deepEqual(
      parallel[i].logits,
      (await independent.score({ ...inputs[i], useCache: false })).logits,
    );
});
test('abort clears partial working state and the next request recovers', async () => {
  const { sdk, backend } = setup();
  const controller = new AbortController();
  const forward = backend.forward.bind(backend);
  let first = true;
  backend.forward = async (...args) => {
    const result = await forward(...args);
    if (first) {
      first = false;
      controller.abort();
    }
    return result;
  };
  await assert.rejects(sdk.score(request({ signal: controller.signal })), {
    name: 'AbortError',
  });
  assert.equal(backend.working.length, 0);
  assert.deepEqual(
    (await sdk.score(request())).logits,
    (await sdk.score(request({ useCache: false }))).logits,
  );
});
test('fallback reports zero cache hits and still returns valid scores', async () => {
  const { sdk } = setup(0);
  await sdk.score(request());
  const score = await sdk.score(request());
  assert.equal(score.usage.cache_hit, false);
  assert.equal(score.usage.processed_tokens, score.usage.input_tokens);
});
test('fields reject malformed contracts and nonfinite backend logits', async () => {
  const { sdk, backend } = setup();
  const field = {
    key: 'field',
    suffix: '?',
    choices: [{ label: 'A', value: 'yes' }],
  };
  for (const bad of [
    { ...field, choices: [{ label: 'AB', value: true }] },
    { ...field, choices: [{ label: 'A', value: Infinity }] },
    { ...field, choices: [{ label: 'A', value: { x: 1 } }] },
  ])
    await assert.rejects(
      sdk.scoreFields({ sharedPrompt: 'World', fields: [bad] }),
    );
  await assert.rejects(
    sdk.scoreFields({ sharedPrompt: 'World', fields: [field, field] }),
  );
  backend.forward = async () => ({ logits: [NaN, 0, 1] });
  await assert.rejects(
    sdk.score(request({ useCache: false })),
    /invalid candidate scores/,
  );
});
test('application owns keys including safe handling of __proto__', async () => {
  const { sdk } = setup();
  const result = await sdk.scoreFields({
    sharedPrompt: 'World',
    fields: [
      {
        key: '__proto__',
        suffix: '?',
        choices: [{ label: 'A', value: 'literal' }],
      },
    ],
    yieldMs: 0,
  });
  assert.deepEqual(Object.keys(result.parsed_json), ['__proto__']);
  assert.equal(result.parsed_json.__proto__, 'literal');
  assert.equal(Object.getPrototypeOf(result.parsed_json), Object.prototype);
});

test('dispose serializes after pending work and rejects future scoring', async () => {
  const { sdk, backend } = setup();
  let disposed = false;
  backend.dispose = async () => {
    disposed = true;
    backend.states.clear();
  };
  const pending = sdk.score(request());
  const dispose = sdk.dispose();
  await pending;
  await dispose;
  assert.equal(disposed, true);
  await assert.rejects(sdk.score(request()), /disposed/);
});

test('a caller cannot inject a checkpoint for tokens outside the prompt', async () => {
  const { sdk } = setup();
  await assert.rejects(
    sdk.score(request({ prefixTokens: [999] })),
    /Invalid token prefix/,
  );
});

test('page alignment leaves the remainder to be recomputed without changing input', async () => {
  const { sdk, backend } = setup();
  backend.prefixAlignment = 4;
  const cold = await sdk.score(request());
  const warm = await sdk.score(request());
  assert.deepEqual(cold.logits, warm.logits);
  assert.equal(warm.usage.cached_prefix_tokens, 12);
  assert.equal(warm.usage.processed_tokens, 10);
});
