// Development comparisons, not an untouched policy-accuracy benchmark.
// Uses real loaded WebLLM; fixture state is never applied to the live race.
async function probeDrivingPolicies(page) {
  await page.waitForFunction(() => window.slipstreamDiagnostics?.().loaded);
  const result = await page.evaluate(async () => {
    const before = window.slipstreamDiagnostics();
    if (before.running || before.busy)
      throw new Error('Pause and drain inference first');
    const base = structuredClone(before.selectedContext);
    const unitId = base.self.id;
    Object.assign(base.self, {
      lane: 1,
      lanePosition: 1,
      changingLanes: false,
      speedMps: 25,
      speedKph: 90,
      targetSpeedMps: 25,
      targetSpeedKph: 90,
      tyres: 100,
      damage: 0,
      boostEnergy: 100,
      pitState: 'none',
    });
    Object.assign(base.track, {
      inBend: false,
      wetHere: false,
      nextCornerWet: false,
      safeSpeedHereMps: 31,
      safeSpeedNextMps: 26,
      nextCornerDistanceM: 100,
      brakingDistanceM: 0,
      pitEntryDistanceM: 65,
    });
    base.traffic = [0, 1, 2].map((lane) => ({
      lane,
      front: null,
      rear: null,
      canEnter: lane !== 1,
      canRiskEnter: lane !== 1,
    }));
    base.availableActions = [
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
    const make = (id, policy, expected, modify = () => {}) => {
      const context = structuredClone(base);
      modify(context);
      return { id, policy, expected, context };
    };
    const fixtures = [
      make(
        'clear-push',
        'Gain speed on clear straights. Use boost when it is available and the next corner is far away. Race aggressively for first place.',
        ['accelerate', 'boost'],
      ),
      make(
        'clear-slow',
        'Cruise below 60 km/h. If your actual or target speed is above 60 km/h, brake now. Do not boost or accelerate above 60 km/h.',
        ['brake'],
      ),
      make(
        'clear-steady',
        'Keep your current 90 km/h cruise target on a clear straight. Hold this pace and conserve boost. Change speed only for a nearby hazard.',
        ['hold'],
      ),
      make(
        'wet-corner',
        'Preserve the car. Brake before and during corners whenever actual or target speed exceeds the stated safe speed.',
        ['brake'],
        (c) => {
          Object.assign(c.track, {
            inBend: true,
            wetHere: true,
            nextCornerWet: true,
            safeSpeedHereMps: 17,
            safeSpeedNextMps: 17,
            nextCornerDistanceM: 0,
            brakingDistanceM: 30,
          });
        },
      ),
      make(
        'blocked-pass',
        'Overtake slow traffic. When your current lane has a slower car ahead and the left lane is clear, move left. Avoid risky passes if a normal lane change is available.',
        ['left'],
        (c) => {
          c.traffic[1].front = {
            id: 'traffic-1',
            gapM: 15,
            speedMps: 15,
            speedKph: 54,
            closingMps: 10,
            ttcSeconds: 1.5,
          };
        },
      ),
      make(
        'repair',
        'Finish intact. If damage exceeds 70 or tyres are below 20, request a pit stop. Otherwise conserve resources.',
        ['pit'],
        (c) => {
          Object.assign(c.self, { tyres: 15, damage: 80, boostEnergy: 0 });
          c.availableActions = c.availableActions.filter((a) => a !== 'boost');
        },
      ),
    ];
    const rows = [];
    for (const labelMode of ['letters_compact', 'letters_focused']) {
      for (const fixture of fixtures) {
        const output = await window.slipstreamProbe({
          unitId,
          context: fixture.context,
          policy: fixture.policy,
          labelMode,
        });
        const action = output.parsed_json[unitId];
        rows.push({
          fixture: fixture.id,
          labelMode,
          expected: fixture.expected,
          action,
          matched: fixture.expected.includes(action),
          output,
        });
      }
    }
    const adapter = await navigator.gpu.requestAdapter();
    const report = {
      tested_at: new Date().toISOString(),
      purpose:
        'Small reused development fixtures; format selection, not general accuracy',
      browser: navigator.userAgent,
      gpu: {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
      },
      fixtures,
      rows,
      metrics_before: before.metrics,
      metrics_after: window.slipstreamDiagnostics().metrics,
    };
    window.slipstreamPolicyReport = report;
    return {
      rows: rows.map(({ fixture, labelMode, action, matched }) => ({
        fixture,
        labelMode,
        action,
        matched,
      })),
      metrics_unchanged:
        before.metrics.total_decisions === report.metrics_after.total_decisions,
    };
  });
  return result;
}
