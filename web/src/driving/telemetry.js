// Completed car scores and completed fleet requests are separate events. A car
// can act as soon as its score arrives, before the rest of its fleet is ready.
export class FleetTelemetry {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.reset();
  }
  reset() {
    this.samples = [];
    this.decisionSamples = [];
    this.startedAt = null;
    this.total = this.completed = this.discarded = this.batchCount = 0;
    this.elapsedTotal =
      this.wallTotal =
      this.inputTotal =
      this.cachedTotal =
      this.batchedCount =
        0;
  }
  begin(now) {
    this.startedAt = now;
    this.samples = [];
    this.decisionSamples = [];
  }
  recordDecision(now, unitId, accepted) {
    if (this.startedAt === null) this.startedAt = now;
    this.decisionSamples.push({ at: now, unitId, accepted });
    this.completed++;
    if (accepted) this.total++;
    else this.discarded++;
    this.prune(now);
  }
  recordBatch(now, { elapsedMs, wallMs, completedCount, usage = {} }) {
    if (this.startedAt === null) this.startedAt = now;
    this.samples.push({ at: now, elapsedMs, wallMs, completedCount });
    this.batchCount++;
    this.batchedCount += completedCount;
    this.elapsedTotal += elapsedMs;
    this.wallTotal += wallMs;
    this.inputTotal += usage.input_tokens || 0;
    this.cachedTotal += usage.cached_prefix_tokens || 0;
    this.prune(now);
  }
  // Convenience for a non-streaming caller; streamed results use both methods.
  record(now, { acceptedIds, completedCount, ...batch }) {
    for (const id of acceptedIds) this.recordDecision(now, id, true);
    for (let i = acceptedIds.length; i < completedCount; i++)
      this.recordDecision(now, null, false);
    this.recordBatch(now, { ...batch, completedCount });
  }
  prune(now) {
    this.samples = this.samples.filter((row) => row.at > now - this.windowMs);
    this.decisionSamples = this.decisionSamples.filter(
      (row) => row.at > now - this.windowMs,
    );
  }
  snapshot(now, running = true) {
    this.prune(now);
    const seconds = Math.max(
      1,
      Math.min(this.windowMs, now - (this.startedAt ?? now)) / 1000,
    );
    const applied = this.decisionSamples.filter((row) => row.accepted);
    const perCar = {};
    for (const row of applied)
      perCar[row.unitId] = (perCar[row.unitId] || 0) + 1;
    return {
      decisions_per_second: running ? applied.length / seconds : 0,
      scored_per_second: running ? this.decisionSamples.length / seconds : 0,
      batches_per_second: running ? this.samples.length / seconds : 0,
      per_car_per_second: Object.fromEntries(
        Object.entries(perCar).map(([id, count]) => [
          id,
          running ? count / seconds : 0,
        ]),
      ),
      mean_batch_ms: this.batchCount
        ? this.elapsedTotal / this.batchCount
        : null,
      mean_roundtrip_ms: this.batchCount
        ? this.wallTotal / this.batchCount
        : null,
      mean_cars_per_batch: this.batchCount
        ? this.batchedCount / this.batchCount
        : null,
      amortized_decision_ms: this.batchedCount
        ? this.elapsedTotal / this.batchedCount
        : null,
      cache_saved_fraction: this.inputTotal
        ? this.cachedTotal / this.inputTotal
        : 0,
      total_decisions: this.total,
      completed_decisions: this.completed,
      discarded_decisions: this.discarded,
      window_seconds: seconds,
    };
  }
}
