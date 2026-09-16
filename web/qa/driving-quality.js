// Paused, real-model regression probe. Pass this function to playwright-cli run-code.
// Full results remain at window.slipstreamQualityReport, including partial runs.
// No source imports: this also works against a production build.
async function drivingQuality(page, options = {}) {
  const policies = {
    nova: 'Overtake traffic. If a car is ahead within 30m, change into a clear neighboring lane. Prefer risky_left or risky_right to pass. Otherwise accelerate, or boost on a clear straight.',
    atlas:
      'Finish intact. Brake early for the safe corner speed and slower traffic. Pass only through a clear lane; avoid risky moves. Accelerate on open straights. Pit when tyres fall below 35 or damage exceeds 45.',
    juno: 'Keep 75–85 km/h on clear straights; brake for corner limits. Pass slower cars through safe lanes. Conserve boost for useful overtakes. Accelerate below 75, hold within the band, and pit for worn tyres or serious damage.',
    milo: 'Early laps: hold 65–75 km/h and save boost. Pass slow cars only through safe gaps. Brake for corners. Final lap: boost on clear straights and seek overtakes. If blocked, change lane before boosting.',
  };
  const names = { nova: 'Nova', atlas: 'Atlas', juno: 'Juno', milo: 'Milo' };
  const actions = [
    'accelerate',
    'brake',
    'hold',
    'left',
    'right',
    'boost',
    'risky_left',
    'risky_right',
    'pit',
  ];
  const length = 200 + 2 * Math.PI * 38;
  const arc = Math.PI * 38;
  const round = (n) => Math.round(n * 10) / 10;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  // Fixtures use the same physical units and lane-entry rules as DrivingGame.
  // Rubrics below are authored from the policies, never from model/scripted output.
  const make = (id, unitId, expected, reason, settings = {}) => {
    const {
      speed = 20,
      target = speed,
      lane = 1,
      distance = 5,
      laps = 0,
      tyres = 100,
      damage = 0,
      boost = 100,
      wetNorth = false,
      traffic = {},
    } = settings;
    const inBend = (d) => (d >= 100 && d < 100 + arc) || d >= 200 + arc;
    const wetStart = wetNorth ? 100 : 200 + arc;
    const wetEnd = wetStart + arc;
    const wet = (d) => d >= wetStart && d < wetEnd;
    const nextBend = inBend(distance)
      ? distance
      : distance < 100
        ? 100
        : 200 + arc;
    const nextDistance = inBend(distance) ? 0 : nextBend - distance;
    const safe = (d) =>
      inBend(d)
        ? 27.5 *
          Math.sqrt((38 + (lane - 1) * 4.5) / 38) *
          (0.66 + (0.34 * tyres) / 100) *
          (1 - damage * 0.0012) *
          (wet(d) ? 0.75 : 1)
        : 31;
    const neighbor = (entry, otherLane, rear) => {
      if (!entry) return null;
      const closing = rear ? entry.speed - speed : speed - entry.speed;
      return {
        id: `traffic-${otherLane}-${rear ? 'rear' : 'front'}`,
        name: 'Traffic',
        controlled: false,
        gapM: entry.gap,
        speedMps: round(entry.speed),
        speedKph: round(entry.speed * 3.6),
        closingMps: round(closing),
        ttcSeconds: closing > 0.1 ? round(entry.gap / closing) : null,
      };
    };
    const lanes = [0, 1, 2].map((otherLane) => {
      const front = neighbor(traffic[otherLane]?.front, otherLane, false);
      const rear = neighbor(traffic[otherLane]?.rear, otherLane, true);
      return {
        lane: otherLane,
        label: ['left / inside', 'middle', 'right / outside'][otherLane],
        front,
        rear,
        canEnter:
          otherLane !== lane &&
          (!front ||
            front.gapM >
              Math.max(
                8,
                speed * 0.55,
                Math.max(0, speed - front.speedMps) * 2.4,
              )) &&
          (!rear ||
            rear.gapM >
              Math.max(
                7,
                rear.speedMps * 0.4,
                Math.max(0, rear.speedMps - speed) * 2.4,
              )),
        canRiskEnter:
          otherLane !== lane &&
          (!front || front.gapM > 1.2) &&
          (!rear || rear.gapM > 1.2),
      };
    });
    const available = actions.filter((action) => {
      if (action === 'accelerate') return target < 30.99;
      if (action === 'brake') return target > 0.01;
      if (action === 'boost') return boost > 3;
      if (action === 'left') return lane > 0 && lanes[lane - 1].canEnter;
      if (action === 'right') return lane < 2 && lanes[lane + 1].canEnter;
      if (action === 'risky_left')
        return lane > 0 && lanes[lane - 1].canRiskEnter;
      if (action === 'risky_right')
        return lane < 2 && lanes[lane + 1].canRiskEnter;
      return true;
    });
    const rivals = Object.keys(policies).filter((other) => other !== unitId);
    const progress = laps * length + distance;
    const front = lanes[lane].front;
    const assistActive = !!front && front.gapM < 4 + speed * 0.7;
    const context = {
      scenario:
        'Three-lap closed-circuit race. First across the shared finish wins; all traffic moves forward.',
      timeSeconds: laps ? 50 : 12,
      self: {
        id: unitId,
        name: names[unitId],
        lane,
        lanePosition: lane,
        changingLanes: false,
        distanceAlongTrackM: round(distance),
        speedMps: round(speed),
        speedKph: round(speed * 3.6),
        targetSpeedMps: round(target),
        targetSpeedKph: round(target * 3.6),
        action: 'hold',
        source: 'model',
        laps,
        overtakes: 0,
        contacts: 0,
        assists: 0,
        tyres,
        damage,
        boostEnergy: boost,
        boostRemaining: 0,
        spinning: false,
        spinRemaining: 0,
        riskyRemaining: 0,
        pitState: 'none',
        pitRemaining: 0,
        finished: false,
        retired: false,
        racePosition: 2,
        raceDistanceM: round(progress),
      },
      race: {
        laps: 3,
        totalDistanceM: round(3 * length),
        position: 2,
        remainingDistanceM: round(3 * length - progress),
        lapsRemaining: 3 - laps,
        leaderId: rivals[0],
        gapToLeaderM: 180,
        carAhead: { id: rivals[0], gapM: 180 },
        carBehind: { id: rivals[1], gapM: 120 },
        timeLimitSeconds: 180,
        winnerId: null,
      },
      track: {
        lanes: 3,
        laneOrder: '0 left/inside, 1 middle, 2 right/outside',
        lengthM: round(length),
        maximumSpeedMps: 31,
        boostMaximumSpeedMps: 39,
        speedLimitKph: 111.6,
        inBend: inBend(distance),
        distanceToBendM: round(nextDistance),
        safeSpeedHereMps: round(safe(distance)),
        safeSpeedNextMps: round(safe(nextBend)),
        nextCornerDistanceM: round(nextDistance),
        brakingDistanceM: round(
          Math.max(0, (speed ** 2 - safe(nextBend) ** 2) / 12),
        ),
        wetHere: wet(distance),
        nextCornerWet: wet(nextBend),
        wetSector: {
          startM: round(wetStart),
          endM: round(wetEnd),
          gripFactor: 0.75,
        },
        pitEntryDistanceM: round((12 - distance + length) % length),
        lookaheadM: 140,
        rearVisibilityM: 80,
      },
      traffic: lanes,
      assist: {
        enabled: true,
        active: assistActive,
        interventions: 0,
        reason: assistActive ? 'Following traffic' : '',
        suppressedForRisk: false,
        cornersProtected: false,
      },
      availableActions: available,
      units: {
        speed: 'm/s and km/h explicitly named',
        distance: 'metres',
        time: 'seconds',
        resources:
          '0–100; higher tyres/boost is better, lower damage is better',
      },
    };
    assert(
      expected.every((action) => available.includes(action)),
      `${id}: impossible rubric action`,
    );
    return {
      id,
      split: id.startsWith('dev-') ? 'development' : 'heldout',
      unitId,
      policy: policies[unitId],
      expected,
      reason,
      context,
      actions: available,
    };
  };
  const fixtures = [
    make(
      'dev-nova-clear-push',
      'nova',
      ['accelerate', 'boost'],
      'Open dry straight, fresh resources, no nearby corner: Nova explicitly accelerates or boosts.',
      { speed: 18 },
    ),
    make(
      'dev-milo-clear-slow',
      'milo',
      ['brake'],
      'Early-lap actual and target 90 km/h exceed Milo’s 65–75 band; one brake lowers the target to 68.4.',
      { speed: 25 },
    ),
    make(
      'dev-juno-steady-band',
      'juno',
      ['hold'],
      'Actual and target 80 km/h already satisfy Juno’s 75–85 band, and there is no useful overtake.',
      { speed: 80 / 3.6 },
    ),
    make(
      'dev-atlas-wet-corner',
      'atlas',
      ['brake'],
      'Atlas is already in a wet bend at 100.8 km/h, well above the stated safe speed; assist does not protect corners.',
      { speed: 28, distance: 132, wetNorth: true },
    ),
    make(
      'dev-nova-blocked-left',
      'nova',
      ['left', 'risky_left'],
      'Slower car 18 m ahead, left clear, right occupied: Nova must pass into the clear neighboring lane.',
      {
        speed: 22,
        traffic: {
          1: { front: { gap: 18, speed: 12 } },
          2: { front: { gap: 10, speed: 12 }, rear: { gap: 3, speed: 26 } },
        },
      },
    ),
    make(
      'dev-atlas-repair',
      'atlas',
      ['pit'],
      'Tyres 20 and damage 80 both exceed Atlas’s explicit repair triggers; pit entry is 4 m away.',
      { distance: 8, tyres: 20, damage: 80, boost: 0 },
    ),
    make(
      'heldout-nova-right-pass',
      'nova',
      ['right', 'risky_right'],
      'Inside lane has slow traffic within 30 m; the sole adjacent lane is clear. Left is off the track.',
      {
        speed: 22,
        lane: 0,
        traffic: {
          0: { front: { gap: 20, speed: 12 } },
          2: { front: { gap: 8, speed: 15 } },
        },
      },
    ),
    make(
      'heldout-atlas-damage-threshold',
      'atlas',
      ['pit'],
      'Damage 45.1 is just above Atlas’s explicit >45 pit trigger, despite fresh tyres and an open straight.',
      { distance: 8, damage: 45.1 },
    ),
    make(
      'heldout-juno-scarce-boost',
      'juno',
      ['hold'],
      'Juno is inside the cruise band with no traffic to pass. Boost 3.2 is selectable but scarce and unhelpful.',
      { speed: 80 / 3.6, boost: 3.2 },
    ),
    make(
      'heldout-juno-fast-rear',
      'juno',
      ['brake'],
      'Front TTC is under one second. The left rear car is only 2 m away and closing fast; right is blocked even for a risky move. Juno permits safe passes only.',
      {
        speed: 21,
        target: 80 / 3.6,
        traffic: {
          0: { rear: { gap: 2, speed: 37 } },
          1: { front: { gap: 6, speed: 12 } },
          2: { front: { gap: 1, speed: 12 } },
        },
      },
    ),
    make(
      'heldout-milo-final-boost',
      'milo',
      ['boost'],
      'Final lap, clear dry straight and full energy: Milo’s explicit final-lap policy calls for boost.',
      { speed: 25, laps: 2 },
    ),
    make(
      'heldout-milo-wet-boundary',
      'milo',
      ['brake'],
      '74.7 km/h is inside Milo’s cruise band but just above this wet bend’s safe speed. His corner-braking rule still applies.',
      { speed: 20.75, distance: 135, wetNorth: true },
    ),
  ];
  const variants = {
    baseline: {
      label: 'Uncached 32-token scoring (current SDK)',
      cache: false,
      pace: 'balanced',
      chunk: 32,
    },
    optimized: {
      label: 'Cached 128-token scoring (current SDK)',
      cache: true,
      pace: 'fast',
      chunk: 128,
    },
  };
  if (options.fixturesOnly) return { fixtures, policies, variants };
  const repetitions = options.repetitions ?? 2;
  assert(
    Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 3,
    'Use 1–3 repetitions',
  );
  const selected = options.fixtureIds
    ? fixtures.filter((fixture) => options.fixtureIds.includes(fixture.id))
    : fixtures;
  assert(selected.length > 0, 'No matching fixtures');
  await page.waitForFunction(
    () =>
      window.slipstreamDiagnostics?.().loaded &&
      !window.slipstreamDiagnostics().busy &&
      !window.slipstreamDiagnostics().running,
  );
  const before = await page.evaluate(() => window.slipstreamDiagnostics());
  const environment = await page.evaluate(() => ({
    browser: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    url: location.href,
  }));
  const report = {
    version: 1,
    status: 'running',
    tested_at: new Date().toISOString(),
    environment,
    purpose:
      'Paired scoring cache/chunk regression and a small independent policy rubric; not a fleet scheduler or original-worker benchmark.',
    limitations: [
      'Twelve handcrafted scenes, six reused development shapes and six fresh held-out scenes. Repeats are not independent scenarios; no statistical generalization.',
      'Policies and rubrics were frozen before this run. Held-out means new to this harness, not an external benchmark.',
      'Both variants use the current SDK and skip intermediate sampling. This does not isolate cache from chunk/yield size.',
      'Paused snapshots do not measure delayed decisions, race outcomes or fleet scheduling. Correct JSON does not imply sound driving.',
      'Normalized candidate scores are relative preferences, not calibrated probabilities of correctness.',
      'Warmups are excluded from latency and rubric totals. Test-only diagnostic vocabulary overhead may affect wall time.',
    ],
    variants,
    policies,
    fixtures: selected,
    repetitions,
    warmups: [],
    rows: [],
    pairs: [],
    before,
  };
  await page.evaluate((value) => {
    window.slipstreamQualityReport = value;
  }, report);
  const probe = async (fixture, variant, round, warmup = false) => {
    const configuration = variants[variant];
    const request = {
      unitId: fixture.unitId,
      context: fixture.context,
      policy: fixture.policy,
      actions: fixture.actions,
      cache: configuration.cache,
      pace: configuration.pace,
      compareWithWhole: false,
    };
    const started = Date.now();
    const output = await page.evaluate(
      (value) => window.slipstreamProbe(value),
      request,
    );
    const wallMs = Date.now() - started;
    const field = output.fields?.[fixture.unitId];
    assert(output.testOnly === true, `${fixture.id}: not a test-only result`);
    assert(output.unitId === fixture.unitId, `${fixture.id}: wrong driver`);
    assert(
      output.prefill_chunk_tokens === configuration.chunk,
      `${fixture.id}: requested ${configuration.chunk}-token chunks, received ${output.prefill_chunk_tokens}`,
    );
    assert(
      typeof output.prompt === 'string' && output.prompt.length > 0,
      `${fixture.id}: raw prompt unavailable; cannot verify identical input`,
    );
    assert(
      JSON.stringify(field?.options) === JSON.stringify(fixture.actions),
      `${fixture.id}: candidate options changed`,
    );
    assert(
      Object.keys(output.parsed_json || {}).length === 1 &&
        fixture.actions.includes(output.parsed_json[fixture.unitId]),
      `${fixture.id}: invalid typed result`,
    );
    assert(
      field.logits.length === fixture.actions.length &&
        field.logits.every(Number.isFinite),
      `${fixture.id}: invalid logits`,
    );
    assert(
      field.probabilities.length === fixture.actions.length &&
        field.probabilities.every(
          (p) => Number.isFinite(p) && p >= 0 && p <= 1,
        ),
      `${fixture.id}: invalid probabilities`,
    );
    assert(
      Math.abs(field.probabilities.reduce((sum, p) => sum + p, 0) - 1) < 1e-5,
      `${fixture.id}: unnormalized scores`,
    );
    if (variant === 'baseline')
      assert(
        !output.cache?.cache_hit && !output.cache?.cached_prefix_tokens,
        `${fixture.id}: baseline unexpectedly used cache`,
      );
    const action = output.parsed_json[fixture.unitId];
    const row = {
      scene: fixture.id,
      split: fixture.split,
      unitId: fixture.unitId,
      variant,
      round,
      warmup,
      action,
      accepted: fixture.expected.includes(action),
      expected: fixture.expected,
      reason: fixture.reason,
      wall_ms: wallMs,
      output,
    };
    (warmup ? report.warmups : report.rows).push(row);
    await page.evaluate(
      ({ value, warmup }) => {
        window.slipstreamQualityReport[warmup ? 'warmups' : 'rows'].push(value);
      },
      { value: row, warmup },
    );
    return row;
  };
  const maxDelta = (left, right) =>
    Math.max(...left.map((v, i) => Math.abs(v - right[i])));
  const mean = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return (
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2
    );
  };
  try {
    // Four retained policy prefixes fit the SDK's six-slot cache. Baseline calls
    // bypass these checkpoints without evicting them. Report every warmup.
    for (const unitId of Object.keys(policies)) {
      const fixture = selected.find((entry) => entry.unitId === unitId);
      if (fixture) await probe(fixture, 'optimized', -1, true);
    }
    // Interleave drivers; reverse scene order and swap per-scene mode order on
    // the next round. Every scene sees baseline first once and optimized first once.
    const ordered = [];
    const groups = Object.keys(policies).map((unitId) =>
      selected.filter((fixture) => fixture.unitId === unitId),
    );
    for (let i = 0; i < Math.max(...groups.map((group) => group.length)); i++)
      for (const group of groups) if (group[i]) ordered.push(group[i]);
    for (let round = 0; round < repetitions; round++) {
      const order = round % 2 ? ordered.slice().reverse() : ordered;
      for (const fixture of order) {
        const index = ordered.indexOf(fixture);
        const modes =
          (index + round) % 2
            ? ['optimized', 'baseline']
            : ['baseline', 'optimized'];
        const outcomes = {};
        for (const variant of modes)
          outcomes[variant] = await probe(fixture, variant, round);
        const { baseline, optimized } = outcomes;
        const b = baseline.output,
          o = optimized.output;
        assert(
          b.prompt === o.prompt,
          `${fixture.id}: prompt changed across modes`,
        );
        for (const key of [
          'model',
          'model_revision',
          'label_mode',
          'label_spacing',
          'assistant_prefix',
          'label_mapping',
        ])
          assert(
            JSON.stringify(b[key]) === JSON.stringify(o[key]),
            `${fixture.id}: ${key} changed across modes`,
          );
        const bf = b.fields[fixture.unitId],
          of = o.fields[fixture.unitId];
        const bm = mean(bf.logits),
          om = mean(of.logits);
        const pair = {
          scene: fixture.id,
          split: fixture.split,
          unitId: fixture.unitId,
          round,
          order: modes,
          baseline: baseline.action,
          optimized: optimized.action,
          baseline_accepted: baseline.accepted,
          optimized_accepted: optimized.accepted,
          same_winner: baseline.action === optimized.action,
          identical_prompt: true,
          max_abs_logit_delta: maxDelta(bf.logits, of.logits),
          max_centered_logit_delta: maxDelta(
            bf.logits.map((v) => v - bm),
            of.logits.map((v) => v - om),
          ),
          max_probability_delta: maxDelta(bf.probabilities, of.probabilities),
          baseline_elapsed_ms: b.elapsed_ms,
          optimized_elapsed_ms: o.elapsed_ms,
          scorer_speedup: b.elapsed_ms / o.elapsed_ms,
          baseline_wall_ms: baseline.wall_ms,
          optimized_wall_ms: optimized.wall_ms,
          optimized_cache_hit: !!o.cache?.cache_hit,
        };
        report.pairs.push(pair);
        await page.evaluate((value) => {
          window.slipstreamQualityReport.pairs.push(value);
        }, pair);
      }
    }
    const summarize = (rows, pairs) => ({
      scene_count: new Set(rows.map((row) => row.scene)).size,
      paired_comparisons: pairs.length,
      agreement: pairs.filter((pair) => pair.same_winner).length,
      agreement_rate: pairs.length
        ? pairs.filter((pair) => pair.same_winner).length / pairs.length
        : null,
      regressions: pairs.filter(
        (pair) => pair.baseline_accepted && !pair.optimized_accepted,
      ).length,
      improvements: pairs.filter(
        (pair) => !pair.baseline_accepted && pair.optimized_accepted,
      ).length,
      median_paired_scorer_speedup: median(
        pairs.map((pair) => pair.scorer_speedup),
      ),
      modes: Object.fromEntries(
        Object.keys(variants).map((variant) => {
          const subset = rows.filter((row) => row.variant === variant);
          const accepted = subset.filter((row) => row.accepted).length;
          return [
            variant,
            {
              calls: subset.length,
              accepted,
              rubric_accuracy: subset.length ? accepted / subset.length : null,
              median_scorer_ms: median(
                subset.map((row) => row.output.elapsed_ms),
              ),
              median_wall_ms: median(subset.map((row) => row.wall_ms)),
              cache_hits: subset.filter((row) => row.output.cache?.cache_hit)
                .length,
              input_tokens: subset.reduce(
                (sum, row) => sum + row.output.cache.input_tokens,
                0,
              ),
              processed_tokens: subset.reduce(
                (sum, row) => sum + row.output.cache.processed_tokens,
                0,
              ),
              cached_prefix_tokens: subset.reduce(
                (sum, row) => sum + row.output.cache.cached_prefix_tokens,
                0,
              ),
              forward_calls: subset.reduce(
                (sum, row) => sum + row.output.cache.forward_calls,
                0,
              ),
            },
          ];
        }),
      ),
    });
    report.after = await page.evaluate(() => window.slipstreamDiagnostics());
    const stable = (snapshot) => ({
      running: snapshot.running,
      time: snapshot.time,
      drivers: snapshot.drivers,
      decisions: snapshot.decisions,
      events: snapshot.events,
      selectedHistory: snapshot.selectedHistory,
      total: snapshot.metrics.total_decisions,
      completed: snapshot.metrics.completed_decisions,
      discarded: snapshot.metrics.discarded_decisions,
    });
    report.live_race_unchanged =
      JSON.stringify(stable(before)) === JSON.stringify(stable(report.after));
    assert(
      report.live_race_unchanged,
      'Probe altered live race state or decision counters',
    );
    report.summary = summarize(report.rows, report.pairs);
    report.by_split = Object.fromEntries(
      ['development', 'heldout'].map((split) => [
        split,
        summarize(
          report.rows.filter((row) => row.split === split),
          report.pairs.filter((pair) => pair.split === split),
        ),
      ]),
    );
    report.by_policy = Object.fromEntries(
      Object.keys(policies).map((unitId) => [
        unitId,
        summarize(
          report.rows.filter((row) => row.unitId === unitId),
          report.pairs.filter((pair) => pair.unitId === unitId),
        ),
      ]),
    );
    report.disagreements = report.pairs.filter((pair) => !pair.same_winner);
    report.repeat_consistency = selected.flatMap((fixture) =>
      Object.keys(variants).map((variant) => {
        const choices = report.rows
          .filter((row) => row.scene === fixture.id && row.variant === variant)
          .map((row) => row.action);
        return {
          scene: fixture.id,
          variant,
          choices,
          stable: new Set(choices).size <= 1,
        };
      }),
    );
    const optimized = report.summary.modes.optimized;
    report.cache_exercised =
      optimized.cache_hits > 0 && optimized.cached_prefix_tokens > 0;
    report.all_optimized_calls_warm = optimized.cache_hits === optimized.calls;
    report.status = report.cache_exercised
      ? 'complete'
      : 'complete-without-cache-hits';
    report.finished_at = new Date().toISOString();
    await page.evaluate((value) => {
      window.slipstreamQualityReport = value;
    }, report);
    return {
      status: report.status,
      cache_exercised: report.cache_exercised,
      all_optimized_calls_warm: report.all_optimized_calls_warm,
      live_race_unchanged: report.live_race_unchanged,
      warmups: report.warmups.length,
      summary: report.summary,
      by_split: report.by_split,
      disagreements: report.disagreements,
      pairs: report.pairs,
      report: 'window.slipstreamQualityReport',
    };
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.stack || error);
    report.finished_at = new Date().toISOString();
    await page.evaluate((value) => {
      window.slipstreamQualityReport = value;
    }, report);
    throw error;
  }
}
