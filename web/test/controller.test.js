import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DecisionScheduler,
  DecisionTelemetry,
  FrameTelemetry,
} from '../src/controller.js';

test('round robin remains fair when an actor dies in flight', () => {
  const units = ['a', 'b', 'c'].map((id) => ({ id, alive: true }));
  const scheduler = new DecisionScheduler();
  assert.equal(scheduler.next(units).id, 'a');
  units[1].alive = false;
  assert.equal(scheduler.next(units).id, 'c');
  assert.equal(scheduler.next(units).id, 'a');
  units.forEach((unit) => {
    unit.alive = false;
  });
  assert.equal(scheduler.next(units), null);
});
test('ticks use elapsed wall time, expire, and stop when paused', () => {
  const meter = new DecisionTelemetry();
  meter.begin(0);
  meter.record(1000, 'a', ['a', 'b'], 200);
  meter.record(2000, 'b', ['a', 'b'], 400);
  const live = meter.snapshot(2000);
  assert.equal(live.decisions_per_second, 1);
  assert.equal(live.rounds_per_second, 0.5);
  assert.equal(live.mean_latency_ms, 300);
  assert.equal(meter.snapshot(2000, false).decisions_per_second, 0);
  assert.equal(meter.snapshot(13000).decisions_per_second, 0);
  assert.equal(meter.snapshot(13000).total_decisions, 2);
});
test('dead and duplicate actors cannot complete a roster round', () => {
  const meter = new DecisionTelemetry();
  meter.begin(0);
  assert.equal(meter.record(100, 'dead', ['a', 'b'], 10), false);
  meter.record(200, 'a', ['a', 'b'], 10);
  meter.record(300, 'a', ['a', 'b'], 10);
  assert.equal(meter.rounds, 0);
  meter.record(400, 'b', ['a', 'b'], 10);
  assert.equal(meter.rounds, 1);
  meter.begin(500);
  assert.equal(meter.snapshot(500).decisions_per_second, 0);
  assert.equal(meter.total, 3);
});

test('frame rate uses wall time and retains long stalls', () => {
  const meter = new FrameTelemetry();
  meter.record(0, false);
  for (let n = 1; n <= 30; n++) meter.record(n * 10, true);
  meter.record(800, true);
  const result = meter.snapshot(1000);
  assert.equal(result.fps, 31);
  assert.equal(result.frame_max_ms, 500);
  assert.equal(result.slow_frames, 1);
});
