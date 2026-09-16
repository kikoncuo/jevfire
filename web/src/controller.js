// Fair scheduling keeps a fast worker from repeatedly updating one actor.
export class DecisionScheduler {
  constructor() {
    this.reset();
  }
  reset() {
    this.lastId = null;
  }
  next(units) {
    if (!units.some((unit) => unit.alive)) return null;
    const previous = units.findIndex((unit) => unit.id === this.lastId);
    for (let i = 1; i <= units.length; i++) {
      const unit = units[(previous + i) % units.length];
      if (unit.alive) {
        this.lastId = unit.id;
        return unit;
      }
    }
    return null;
  }
}

// All rates use measured wall time. Simulation speed and rendering cannot
// manufacture model ticks; only accepted, completed model requests are recorded.
export class DecisionTelemetry {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.reset();
  }
  reset() {
    this.samples = [];
    this.roundSamples = [];
    this.seen = new Set();
    this.total = 0;
    this.rounds = 0;
    this.startedAt = null;
  }
  begin(now) {
    this.startedAt = now;
    this.samples = [];
    this.roundSamples = [];
    this.seen.clear();
  }
  record(now, unitId, aliveIds, elapsedMs) {
    if (!aliveIds.includes(unitId)) return false;
    if (this.startedAt === null) this.startedAt = now;
    this.samples.push({ at: now, elapsedMs });
    this.total++;
    this.seen.add(unitId);
    if (aliveIds.length && aliveIds.every((id) => this.seen.has(id))) {
      this.rounds++;
      this.roundSamples.push(now);
      this.seen.clear();
    }
    this.prune(now);
    return true;
  }
  prune(now) {
    this.samples = this.samples.filter(
      (sample) => sample.at > now - this.windowMs,
    );
    this.roundSamples = this.roundSamples.filter(
      (at) => at > now - this.windowMs,
    );
  }
  snapshot(now, running = true) {
    this.prune(now);
    const seconds = Math.max(
      1,
      Math.min(this.windowMs, now - (this.startedAt ?? now)) / 1000,
    );
    return {
      decisions_per_second: running ? this.samples.length / seconds : 0,
      rounds_per_second: running ? this.roundSamples.length / seconds : 0,
      total_decisions: this.total,
      completed_rounds: this.rounds,
      mean_latency_ms: this.samples.length
        ? this.samples.reduce((sum, row) => sum + row.elapsedMs, 0) /
          this.samples.length
        : null,
      window_seconds: seconds,
    };
  }
}

// Count actual render submissions over elapsed time; averaging 1/dt
// hides long stalls behind many short frames on high-refresh displays.
export class FrameTelemetry {
  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
    this.samples = [];
    this.last = null;
    this.startedAt = null;
  }
  record(now, rendered) {
    if (this.startedAt === null) this.startedAt = now;
    const gap = this.last === null ? 0 : now - this.last;
    this.last = now;
    this.samples.push({ at: now, gap, rendered });
    while (this.samples.length && this.samples[0].at < now - this.windowMs)
      this.samples.shift();
  }
  snapshot(now) {
    const samples = this.samples.filter(
      (sample) => sample.at >= now - this.windowMs,
    );
    const seconds = Math.max(
      0.001,
      Math.min(this.windowMs, now - (this.startedAt ?? now)) / 1000,
    );
    const gaps = samples
      .map((sample) => sample.gap)
      .filter((gap) => gap > 0)
      .sort((a, b) => a - b);
    return {
      fps: samples.filter((sample) => sample.rendered).length / seconds,
      frame_p99_ms:
        gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.99))] ?? 0,
      frame_max_ms: Math.max(0, ...gaps),
      slow_frames: samples.filter((sample) => sample.gap > 50).length,
    };
  }
}
