import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetTelemetry } from '../src/driving/telemetry.js';

test('one four-car batch is four decisions, one round and distinct per-car rates', () => {
  const t = new FleetTelemetry();
  t.begin(0);
  t.record(1000, {
    elapsedMs: 800,
    wallMs: 900,
    acceptedIds: ['a', 'b', 'c', 'd'],
    completedCount: 4,
    usage: { input_tokens: 1000, cached_prefix_tokens: 600 },
  });
  const s = t.snapshot(1000);
  assert.equal(s.decisions_per_second, 4);
  assert.equal(s.batches_per_second, 1);
  assert.equal(s.per_car_per_second.a, 1);
  assert.equal(s.mean_batch_ms, 800);
  assert.equal(s.amortized_decision_ms, 200);
  assert.equal(s.mean_roundtrip_ms, 900);
  assert.equal(s.cache_saved_fraction, 0.6);
});
test('stale results count as scored but never applied, pauses have zero rates', () => {
  const t = new FleetTelemetry();
  t.begin(0);
  t.record(2000, {
    elapsedMs: 1000,
    wallMs: 1100,
    acceptedIds: ['b', 'c'],
    completedCount: 4,
  });
  assert.equal(t.snapshot(2000).decisions_per_second, 1);
  assert.equal(t.snapshot(2000).scored_per_second, 2);
  assert.equal(t.snapshot(2000).discarded_decisions, 2);
  assert.equal(t.snapshot(2000, false).decisions_per_second, 0);
  assert.equal(t.snapshot(2000, false).per_car_per_second.b, 0);
  t.begin(6000);
  assert.equal(t.snapshot(6500).decisions_per_second, 0);
  assert.equal(t.snapshot(6500).total_decisions, 2);
});

test('run averages remain inspectable after pause while rolling rates expire', () => {
  const t = new FleetTelemetry();
  t.begin(0);
  t.record(1000, {
    elapsedMs: 800,
    wallMs: 900,
    acceptedIds: ['a', 'b', 'c', 'd'],
    completedCount: 4,
    usage: { input_tokens: 1000, cached_prefix_tokens: 600 },
  });
  t.record(2000, {
    elapsedMs: 200,
    wallMs: 250,
    acceptedIds: ['a'],
    completedCount: 1,
    usage: { input_tokens: 250, cached_prefix_tokens: 100 },
  });
  const s = t.snapshot(20000, false);
  assert.equal(s.mean_batch_ms, 500);
  assert.equal(s.amortized_decision_ms, 200);
  assert.equal(s.mean_cars_per_batch, 2.5);
  assert.equal(s.cache_saved_fraction, 0.56);
  assert.equal(s.decisions_per_second, 0);
  assert.equal(s.total_decisions, 5);
  t.reset();
  assert.equal(t.snapshot(20001).mean_batch_ms, null);
});

test('a streamed choice counts immediately and the batch does not count it twice', () => {
  const t = new FleetTelemetry();
  t.begin(0);
  t.recordDecision(300, 'a', true);
  assert.equal(t.snapshot(300).total_decisions, 1);
  assert.equal(t.snapshot(300).batches_per_second, 0);
  t.recordDecision(500, 'b', false);
  t.recordBatch(550, {
    elapsedMs: 540,
    wallMs: 550,
    completedCount: 2,
    usage: { input_tokens: 500, cached_prefix_tokens: 100 },
  });
  const s = t.snapshot(550);
  assert.equal(s.total_decisions, 1);
  assert.equal(s.completed_decisions, 2);
  assert.equal(s.discarded_decisions, 1);
  assert.equal(s.batches_per_second, 1);
  assert.equal(s.amortized_decision_ms, 270);
});
