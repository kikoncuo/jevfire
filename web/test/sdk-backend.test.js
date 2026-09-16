import test from 'node:test';
import assert from 'node:assert/strict';
import { WebLLMBackend, PublicWebLLMBackend } from '../src/sdk/index.js';

test('unsupported runtime uses public fallback without touching private pipeline', async () => {
  let privateCalls = 0;
  const engine = {
    getLLMStates() {
      privateCalls++;
      throw new Error('must not inspect');
    },
  };
  const backend = await WebLLMBackend.create({
    engine,
    model: 'test',
    runtimeVersion: 'next',
    capture: {},
  });
  assert.ok(backend instanceof PublicWebLLMBackend);
  assert.equal(backend.cacheSlots, 0);
  assert.equal(privateCalls, 0);
});

test('fallback captures only final requested logits and does not claim caching', async () => {
  const capture = {};
  let resets = 0;
  const engine = {
    async resetChat() {
      resets++;
    },
    async forwardTokensAndSample(tokens) {
      if (capture.active)
        capture.row = capture.ids.map((id) => tokens.at(-1) + id);
    },
  };
  const backend = new PublicWebLLMBackend(engine, 'test', capture);
  await backend.resetWorking();
  assert.deepEqual(await backend.forward([1, 2], null), {});
  assert.equal(capture.active, false);
  assert.deepEqual((await backend.forward([3], [10, 20])).logits, [13, 23]);
  assert.equal(resets, 1);
  assert.equal(backend.cacheSlots, 0);
  await backend.dispose();
  assert.equal(capture.active, false);
});

test('invalid private pipeline falls back only after a successful public reset', async () => {
  let resets = 0;
  const engine = {
    getLLMStates() {
      throw new Error('missing ABI');
    },
    async resetChat() {
      resets++;
    },
  };
  const backend = await WebLLMBackend.create({
    engine,
    model: 'test',
    runtimeVersion: '0.2.85',
    capture: {},
  });
  assert.equal(backend.reason, 'missing ABI');
  assert.equal(resets, 1);
  engine.resetChat = async () => {
    throw new Error('device lost');
  };
  await assert.rejects(
    WebLLMBackend.create({
      engine,
      model: 'test',
      runtimeVersion: '0.2.85',
      capture: {},
    }),
    /device lost/,
  );
});
