// Real Qwen race through normal UI only; compatible with playwright-cli run-code.
// Example: await drivingRaceQuality(page, { seed: 7 });
// Polling reads diagnostics, never injects controls or changes simulation state.
async function drivingRaceQuality(page, options = {}) {
  if (typeof options === 'number') options = { seed: options };
  const ids = ['nova', 'atlas', 'juno', 'milo'];
  const read = () => page.evaluate(() => window.slipstreamDiagnostics());
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const statistics = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const quantile = (p) =>
      sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
    return {
      count: sorted.length,
      mean: sorted.length
        ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length
        : null,
      median: quantile(0.5),
      p95: quantile(0.95),
      max: sorted.at(-1) ?? null,
    };
  };
  const startedAt = Date.now();
  const report = {
    schema_version: 1,
    tested_at: new Date(startedAt).toISOString(),
    url: page.url(),
    status: 'setup',
    model_requests: 'real WebLLM requests made by the unchanged application',
    settings: {},
    samples: [],
    decisions: [],
    events: [],
    event_poll_gaps: 0,
    notes: [
      'One actual race, using the application default policies restored through UI. No model stubs, injected actions, or scripted baseline.',
      'The race wall budget starts after model loading. Setup/download time is reported separately.',
      'Decision diagnostics retain only the latest choice per car. Polling can miss choices; coverage is compared with the authoritative accepted-decision counter.',
      'Observation age is simulated seconds from appliedAt minus observedContext.timeSeconds; the context timestamp is rounded to 0.1 seconds. Negative ages within rounding error are clamped to zero.',
      'Per-car decision counts come from observed model decision events. They are exact only when the event total matches the authoritative accepted count and no event poll gaps occurred.',
      'elapsed_ms describes one car on the older application but may describe field work on the newer application. Fleet batch latency is reported separately and deduplicated by batch request ID.',
      'Frame snapshots cover overlapping rolling windows. Their p99/max values are not independent samples or a race-wide frame percentile.',
      'Finish time, survival, damage, spins and contacts measure this race outcome; a few seeded runs do not establish general model intelligence.',
    ],
  };
  let raceStartedAt = null;
  let last = null;
  let previousEvents = [];
  const seenDecisions = new Set();
  const seenBatches = new Map();
  const batchDetails = new Map();
  const record = (diagnostic) => {
    last = diagnostic;
    const wall = (Date.now() - raceStartedAt) / 1000;
    const current = diagnostic.events || [];
    const keys = current.map((event) => JSON.stringify(event));
    let overlap = Math.min(previousEvents.length, keys.length);
    while (
      overlap > 0 &&
      !previousEvents.slice(-overlap).every((key, index) => key === keys[index])
    )
      overlap--;
    if (previousEvents.length && keys.length && overlap === 0)
      report.event_poll_gaps++;
    for (const event of current.slice(overlap))
      report.events.push({ ...event, first_observed_wall_seconds: wall });
    previousEvents = keys;

    for (const [unitId, decision] of Object.entries(
      diagnostic.decisions || {},
    )) {
      if (!decision || decision.id === undefined) continue;
      const key = `${String(decision.id)}:${unitId}`;
      if (seenDecisions.has(key)) continue;
      seenDecisions.add(key);
      const observedAt = decision.observedContext?.timeSeconds;
      const rawAge =
        Number.isFinite(decision.appliedAt) && Number.isFinite(observedAt)
          ? decision.appliedAt - observedAt
          : null;
      report.decisions.push({
        ...decision,
        unitId,
        capture_key: key,
        first_observed_wall_seconds: wall,
        action: decision.parsed_json?.[unitId] ?? null,
        observation_age_sim_seconds:
          rawAge === null ? null : Math.max(0, rawAge),
        observation_age_raw_sim_seconds: rawAge,
      });
      if (Number.isFinite(decision.batch_elapsed_ms)) {
        const batchId = String(decision.id).replace(
          /:(nova|atlas|juno|milo)$/,
          '',
        );
        seenBatches.set(batchId, decision.batch_elapsed_ms);
      }
    }
    for (const batch of diagnostic.batches || []) {
      seenBatches.set(String(batch.id), batch.elapsed_ms);
      batchDetails.set(String(batch.id), batch);
    }
    report.samples.push({
      wall_elapsed_seconds: wall,
      time: diagnostic.time,
      running: diagnostic.running,
      busy: diagnostic.busy,
      discarded: diagnostic.discarded,
      metrics: diagnostic.metrics,
      frames: diagnostic.frames,
      summary: diagnostic.summary,
      drivers: diagnostic.drivers,
    });
  };

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(
      () => window.slipstreamDiagnostics?.().rendererReady,
      null,
      { timeout: 30000 },
    );
    if ((await read()).running) await page.locator('#run').click();
    await page.waitForFunction(
      () => !window.slipstreamDiagnostics().busy,
      null,
      { timeout: 50000 },
    );
    const seedValue =
      options.seed ?? (await page.locator('#seed').inputValue());
    const seed = Number(seedValue) || 7;
    check(
      Number.isInteger(seed) && seed >= 1 && seed <= 99999,
      'Seed must be an integer between 1 and 99999.',
    );
    const paceOptions = await page
      .locator('#pace option')
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    const pace = paceOptions.includes('balanced') ? 'balanced' : 'fast';
    check(paceOptions.includes(pace), 'No supported inference pace found.');
    await page.locator('#seed').fill(String(seed));
    await page.locator('#sim-speed').selectOption('1');
    await page.locator('#assist').check();
    await page.locator('#pace').selectOption(pace);
    for (const id of ids) {
      await page.locator(`[data-driver="${id}"]`).click();
      await page.locator('#restore-prompt').click();
    }
    await page.locator('#load').click();
    await page.waitForFunction(
      () => {
        const diagnostic = window.slipstreamDiagnostics();
        return diagnostic.loaded && diagnostic.mode === 'model';
      },
      null,
      { timeout: 120000 },
    );
    await page.locator('#reset').click();
    await page.locator('[data-driver="nova"]').click();
    await page.evaluate(() => scrollTo(0, 0));
    const initial = await read();
    check(initial.mode === 'model' && initial.loaded, 'Qwen was not selected.');
    check(
      !initial.running && initial.time === 0,
      'Race did not reset cleanly.',
    );
    check(
      initial.metrics.total_decisions === 0,
      'Decision counter did not reset.',
    );
    check(
      ids.every(
        (id) =>
          typeof initial.policies[id] === 'string' && initial.policies[id],
      ),
      'Missing restored driver policy.',
    );
    report.settings = {
      seed,
      pace,
      simulation_speed: 1,
      assist_enabled: await page.locator('#assist').isChecked(),
      policies: initial.policies,
      driver_ids: ids,
      poll_interval_ms: 250,
      max_race_wall_ms: Math.min(
        230000,
        Math.max(1000, options.maxWallMs ?? 230000),
      ),
      viewport: { width: 1440, height: 1000 },
    };
    report.initial = initial;
    report.environment = await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      return {
        user_agent: navigator.userAgent,
        gpu: adapter
          ? {
              vendor: adapter.info?.vendor,
              architecture: adapter.info?.architecture,
              device: adapter.info?.device,
              description: adapter.info?.description,
            }
          : null,
        document_visibility: document.visibilityState,
        script_urls: [...document.querySelectorAll('script[src]')].map(
          (script) => script.src,
        ),
      };
    });
    report.setup_wall_seconds = (Date.now() - startedAt) / 1000;
    raceStartedAt = Date.now();
    report.status = 'running';
    record(initial);
    await page.locator('#run').click();
    while (Date.now() - raceStartedAt < report.settings.max_race_wall_ms) {
      const diagnostic = await read();
      record(diagnostic);
      if (diagnostic.summary.over) {
        report.status = 'complete';
        break;
      }
      if (!diagnostic.running) {
        report.status = 'paused_unexpectedly';
        report.error = (await page.locator('#error').isVisible())
          ? await page.locator('#error').textContent()
          : await page.locator('#run-status').textContent();
        break;
      }
      check(diagnostic.mode === 'model', 'Race switched out of Qwen mode.');
      await page.waitForTimeout(250);
    }
    if (report.status === 'running') report.status = 'wall_timeout';
  } catch (error) {
    report.status = 'error';
    report.error = String(error?.message || error);
  }

  // End a timed-out or interrupted run via the normal pause button. Never click
  // "Race again" after completion, and never restart a failed race silently.
  try {
    const current = await read();
    if (raceStartedAt !== null) record(current);
    if (current.running) await page.locator('#run').click();
  } catch (error) {
    report.cleanup_error = String(error?.message || error);
  }
  report.race_wall_seconds =
    raceStartedAt === null ? 0 : (Date.now() - raceStartedAt) / 1000;
  report.total_wall_seconds = (Date.now() - startedAt) / 1000;
  report.final = last;
  const totalDecisions = last?.metrics?.total_decisions ?? 0;
  const modelEvents = report.events.filter(
    (event) => event.type === 'decision' && event.source === 'model',
  );
  const eventCoverageExact =
    modelEvents.length === totalDecisions && report.event_poll_gaps === 0;
  report.coverage = {
    accepted_decisions_authoritative: totalDecisions,
    captured_decision_details: report.decisions.length,
    decision_detail_fraction: totalDecisions
      ? report.decisions.length / totalDecisions
      : null,
    captured_model_decision_events: modelEvents.length,
    per_car_counts_exact: eventCoverageExact,
    event_poll_gaps: report.event_poll_gaps,
  };
  report.integrity = {
    at_least_one_real_model_decision: totalDecisions > 0,
    captured_context_driver_mismatches: report.decisions.filter(
      (decision) => decision.observedContext?.self?.id !== decision.unitId,
    ).length,
    captured_policy_mismatches: report.decisions.filter(
      (decision) =>
        decision.policy !== report.settings.policies?.[decision.unitId],
    ).length,
    captured_actions_outside_offered_options: report.decisions.filter(
      (decision) =>
        !decision.fields?.[decision.unitId]?.options?.includes(decision.action),
    ).length,
    non_model_decision_events: report.events.filter(
      (event) => event.type === 'decision' && event.source !== 'model',
    ).length,
  };
  report.quality = {
    completed_race: report.status === 'complete',
    simulation_seconds: last?.time ?? 0,
    winner: last?.summary?.winner ?? null,
    winner_time_sim_seconds: last?.summary?.winnerTime ?? null,
    finishers: last?.summary?.finished ?? 0,
    dnfs: last?.summary?.retired ?? 0,
    contacts: last?.summary?.contacts ?? 0,
    spins: last?.summary?.spins ?? 0,
    overtakes: last?.summary?.overtakes ?? 0,
    assists: last?.summary?.assists ?? 0,
    pit_stops: last?.summary?.pitStops ?? 0,
    discarded_decisions: last?.discarded ?? 0,
    decisions_per_wall_second: report.race_wall_seconds
      ? totalDecisions / report.race_wall_seconds
      : 0,
    observation_age_sim_seconds: statistics(
      report.decisions.map((d) => d.observation_age_sim_seconds),
    ),
    captured_decision_elapsed_ms: statistics(
      report.decisions.map((d) => d.elapsed_ms),
    ),
    captured_fleet_batches: [...batchDetails.values()],
    four_car_batch_elapsed_ms: statistics(
      [...batchDetails.values()]
        .filter((b) => b.completed_count === 4)
        .map((b) => b.elapsed_ms),
    ),
    captured_unique_fleet_batch_elapsed_ms: statistics([
      ...seenBatches.values(),
    ]),
    observed_fps_snapshots: statistics(
      report.samples.map((s) => s.frames?.fps),
    ),
    worst_observed_frame_ms: Math.max(
      0,
      ...report.samples.map((s) => s.frames?.frame_max_ms || 0),
    ),
    standings: last?.summary?.standings ?? [],
    per_car: ids.map((id) => {
      const car = last?.drivers?.find((driver) => driver.id === id);
      const choices = report.decisions.filter(
        (decision) => decision.unitId === id,
      );
      const events = modelEvents.filter((event) => event.carId === id);
      const terminalSample = report.samples.find((sample) =>
        sample.drivers?.some(
          (driver) => driver.id === id && (driver.finished || driver.retired),
        ),
      );
      const activeWallSeconds =
        terminalSample?.wall_elapsed_seconds ?? report.race_wall_seconds;
      return {
        id,
        position: car?.racePosition ?? null,
        finished: car?.finished ?? false,
        retired: car?.retired ?? false,
        retirement_reason: car?.retirementReason ?? null,
        finish_time_sim_seconds: car?.finishTime ?? null,
        terminal_first_observed_wall_seconds:
          terminalSample?.wall_elapsed_seconds ?? null,
        race_distance_m: car?.raceDistance ?? null,
        laps: car?.laps ?? null,
        damage: car?.damage ?? null,
        tyres: car?.tyres ?? null,
        boost_energy: car?.boostEnergy ?? null,
        contacts: car?.contacts ?? null,
        spins: car?.spins ?? null,
        overtakes: car?.overtakes ?? null,
        pit_stops: car?.pitStops ?? null,
        assists: car?.assistCount ?? null,
        observed_model_decisions: events.length,
        decision_count_exact: eventCoverageExact,
        decisions_per_race_wall_second: report.race_wall_seconds
          ? events.length / report.race_wall_seconds
          : 0,
        decisions_per_active_wall_second: activeWallSeconds
          ? events.length / activeWallSeconds
          : 0,
        action_counts: events.reduce((counts, event) => {
          counts[event.action] = (counts[event.action] || 0) + 1;
          return counts;
        }, {}),
        observation_age_sim_seconds: statistics(
          choices.map((d) => d.observation_age_sim_seconds),
        ),
        captured_decision_elapsed_ms: statistics(
          choices.map((d) => d.elapsed_ms),
        ),
      };
    }),
  };
  const screenshot =
    options.screenshotPath ??
    `last-hearth-qa-driving-quality-seed-${report.settings.seed ?? 'unknown'}.png`;
  try {
    check(!/[\\/]/.test(screenshot), 'Use a bare screenshot filename.');
    await page.screenshot({ path: screenshot });
    report.screenshot = screenshot;
  } catch (error) {
    report.screenshot_error = String(error?.message || error);
  }
  await page.evaluate((value) => {
    window.slipstreamRaceQualityReport = value;
  }, report);
  return report;
}
