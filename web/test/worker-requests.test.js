import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DRIVERS, driverChoices } from '../src/driving/contract.js';

// Evaluate the browser worker with runtime imports stubbed: its tokenizer is a
// browser WASM package, while request snapshots/queue/accounting need no GPU.
const source = readFileSync(
  new URL('../src/inference.worker.js', import.meta.url),
  'utf8',
)
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace(/^export /gm, '');
const sandbox = vm.createContext({
  DRIVERS,
  driverChoices,
  structuredClone,
  performance,
  setTimeout,
});
vm.runInContext(
  `${source}\nglobalThis.helpers = { drivingBatchRequests, aggregateDecisionUsage, createWorkerQueue };`,
  sandbox,
);
const { drivingBatchRequests, aggregateDecisionUsage, createWorkerQueue } =
  sandbox.helpers;

const batch = () => ({
  id: 17,
  epoch: 4,
  mission: 'Race',
  pace: 'fast',
  cache: true,
  requests: DRIVERS.map((driver) => ({
    unitId: driver.id,
    rolePrompt: driver.defaultPrompt,
    actions: ['hold', 'accelerate'],
    context: { self: { id: driver.id, speedKph: 70 } },
  })),
});

test('driving batch snapshots all four identities and canonical choices together', () => {
  const request = batch();
  const jobs = drivingBatchRequests(request);
  request.requests[0].context.self.speedKph = 120;
  request.requests[0].rolePrompt = 'Changed after dispatch';
  assert.deepEqual(
    Array.from(jobs, (job) => job.unitId),
    DRIVERS.map((driver) => driver.id),
  );
  assert.equal(jobs[0].context.self.speedKph, 70);
  assert.equal(jobs[0].rolePrompt, DRIVERS[0].defaultPrompt);
  for (const job of jobs) {
    assert.equal(job.id, 17);
    assert.equal(job.epoch, 4);
    assert.equal(job.scenario, 'driving');
    assert.equal(job.pace, 'fast');
    assert.deepEqual(job.actions, ['accelerate', 'hold']);
  }
});

test('bad batch fields fail before scoring any driver', () => {
  for (const requests of [
    [],
    null,
    [batch().requests[0], batch().requests[0]],
    [{ unitId: 'mira', actions: ['hold'] }],
    [{ ...batch().requests[0], actions: ['teleport'] }],
    [{ ...batch().requests[0], context: { self: { id: 'atlas' } } }],
  ])
    assert.throws(() => drivingBatchRequests({ ...batch(), requests }));
});

test('worker queue snapshots data, completes FIFO and recovers after a reported failure', async () => {
  const completed = [],
    errors = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const enqueue = createWorkerQueue(
    async (message) => {
      if (message.id === 1) await gate;
      if (message.id === 2) throw new Error('deliberate test failure');
      completed.push([message.id, message.value]);
    },
    (error, message) => errors.push([message.id, error.message]),
  );
  const mutable = { id: 1, value: 'frozen' };
  const first = enqueue(mutable);
  mutable.value = 'mutated';
  const second = enqueue({ id: 2 });
  const third = enqueue({ id: 3, value: 'last' });
  release();
  await Promise.all([first, second, third]);
  assert.deepEqual(completed, [
    [1, 'frozen'],
    [3, 'last'],
  ]);
  assert.deepEqual(errors, [[2, 'deliberate test failure']]);
});

test('batch usage adds measured tokens/calls without claiming physical GPU batching', () => {
  const result = aggregateDecisionUsage([
    {
      usage: {
        input_tokens: 120,
        prompt_tokens: 120,
        processed_tokens: 120,
        cached_prefix_tokens: 0,
        forward_calls: 2,
        yield_ms: 0,
        cache_hit: false,
      },
    },
    {
      usage: {
        input_tokens: 140,
        prompt_tokens: 140,
        processed_tokens: 44,
        cached_prefix_tokens: 96,
        forward_calls: 1,
        yield_ms: 0,
        cache_hit: true,
      },
    },
  ]);
  assert.deepEqual(structuredClone(result), {
    input_tokens: 260,
    prompt_tokens: 260,
    processed_tokens: 164,
    cached_prefix_tokens: 96,
    forward_calls: 3,
    yield_ms: 0,
    scored_positions: 2,
    cache_hits: 1,
    execution: 'sequential-driver-jobs',
    gpu_batch_size: 1,
  });
});

test('fleet streams each completed car before waiting for the remaining cars', async () => {
  const messages = [];
  let releaseSecond, firstSent;
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const firstField = new Promise((resolve) => {
    firstSent = resolve;
  });
  sandbox.testPost = (message) => {
    messages.push(structuredClone(message));
    if (message.type === 'drivingField' && message.index === 0) firstSent();
  };
  sandbox.testDecide = async (request) => {
    if (request.unitId === 'atlas') await secondGate;
    return {
      unitId: request.unitId,
      parsed_json: { [request.unitId]: 'hold' },
      fields: { [request.unitId]: { value: 'hold' } },
      elapsed_ms: 10,
      usage: {
        input_tokens: 100,
        processed_tokens: 80,
        cached_prefix_tokens: 20,
        forward_calls: 1,
        cache_hit: true,
      },
    };
  };
  vm.runInContext(
    `engine = {}; backend = {name:'test'}; decide = testDecide;
    globalThis.self = {postMessage: testPost}; globalThis.runBatch = decideDrivingBatch;`,
    sandbox,
  );
  const complete = sandbox.runBatch(batch());
  await firstField;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'drivingField');
  assert.equal(messages[0].unitId, 'nova');
  assert.equal(messages[0].index, 0);
  assert.equal(messages[0].batch_size, 4);
  assert.equal(messages[0].id, 17);
  assert.equal(messages[0].epoch, 4);
  assert.equal(messages[0].decision.scheduling, 'fleet');
  assert.ok(messages[0].fleet_age_ms >= 0);
  releaseSecond();
  await complete;
  assert.deepEqual(
    messages.map((message) => message.type),
    [
      'drivingField',
      'drivingField',
      'drivingField',
      'drivingField',
      'drivingBatch',
    ],
  );
  assert.deepEqual(
    messages.slice(0, 4).map((message) => message.unitId),
    DRIVERS.map((driver) => driver.id),
  );
  assert.equal(messages[4].decisions.length, 4);
  assert.equal(messages[4].usage.scored_positions, 4);
  assert.equal(messages[4].execution, 'sequential-driver-jobs');
});
