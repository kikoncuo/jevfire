// Run with playwright-cli -s=cowork run-code --filename=qa/browser-smoke.js
// Open Last Hearth and explicitly load the REAL WebLLM model first.
// This checks structure, scheduling, isolation, and UI; it does not grade tactics.
async function browserSmoke(page) {
  const timeout = 40000;
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const roles = {
    mira: 'collector',
    bram: 'collector',
    aldric: 'fighter',
    sable: 'fighter',
    tomas: 'builder',
    nell: 'builder',
  };
  const actions = {
    collector: ['forage_safe', 'forage_bold', 'relax'],
    fighter: ['train', 'defend', 'relax'],
    builder: ['repair', 'build', 'heal', 'relax'],
  };
  const state = () => page.evaluate(() => window.jevfireDiagnostics());
  const wait = (predicate, argument = null) =>
    page.waitForFunction(predicate, argument, { timeout });
  const afterPaint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const valid = (result, { allowSingle = false } = {}) => {
    check(result && typeof result === 'object', 'Missing model result');
    check(Object.hasOwn(roles, result.unitId), 'Unknown result actor');
    check(
      Object.keys(result.parsed_json).length === 1 &&
        Object.hasOwn(result.parsed_json, result.unitId),
      'A one-NPC request invented or omitted output fields',
    );
    check(
      actions[roles[result.unitId]].includes(result.parsed_json[result.unitId]),
      'Model returned an action outside this actor’s role contract',
    );
    const field = result.fields[result.unitId];
    const legal = actions[roles[result.unitId]];
    check(
      Array.isArray(field.options) &&
        field.options.length >= (allowSingle ? 1 : 2) &&
        field.options.length <= legal.length &&
        new Set(field.options).size === field.options.length &&
        field.options.every((option) => legal.includes(option)),
      'Missing, duplicate, or out-of-contract dynamic candidate options',
    );
    check(
      field.options.includes(result.parsed_json[result.unitId]) &&
        field.options.join('|') ===
          legal.filter((option) => field.options.includes(option)).join('|'),
      'Chosen action is not in the request subset or candidate ordering changed',
    );
    check(
      field.logits.length === field.options.length &&
        field.logits.every(Number.isFinite),
      'Missing real candidate logits',
    );
    check(
      field.probabilities.length === field.options.length &&
        field.probabilities.every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        ) &&
        Math.abs(
          field.probabilities.reduce((sum, value) => sum + value, 0) - 1,
        ) < 0.00001,
      'Candidate probabilities are not finite and normalized',
    );
    check(
      result.backend_requests === 1 && result.fields_scored === 1,
      'Unexpected scoring protocol',
    );
    check(
      Number.isFinite(result.elapsed_ms) && result.elapsed_ms > 0,
      'Missing measured inference latency',
    );
  };
  const initial = await state();
  check(initial.loaded, 'Load the real WebLLM model before this smoke test');
  check(initial.rendererReady, 'Wait for the real 3D assets to load');
  const originalViewport = page.viewportSize();
  const originalMission = await page.locator('#mission').inputValue();
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    runtime: 'WebLLM 0.2.85',
    model: 'Qwen3.5-0.8B-q4f16_1-MLC',
    scope:
      'Real inference with current dynamic candidates and structural/UI smoke checks; no policy accuracy claim',
    rules:
      'Builders may heal; unavailable work is removed before scoring. Automatic needs and single available actions are game rules, not AI ticks.',
  };
  await page.bringToFront();
  await page.locator('#load').click(); // Select the already-loaded model; no reload.
  await page.locator('#reset').click();
  await wait(() => !window.jevfireDiagnostics().busy);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Read-only result sampling observes actual applied results. It does not patch
  // the worker, model, game, scheduler, or inference responses.
  await page.evaluate(() => {
    window.__jevfireSmokeSamples = [];
    let lastId = null;
    const sample = () => {
      const current = window.jevfireDiagnostics().lastResult;
      if (current && current.id !== lastId) {
        lastId = current.id;
        window.__jevfireSmokeSamples.push(structuredClone(current));
        if (window.__jevfireSmokeSamples.length > 120)
          window.__jevfireSmokeSamples.shift();
      }
      window.__jevfireSmokeFrame = requestAnimationFrame(sample);
    };
    window.__jevfireSmokeFrame = requestAnimationFrame(sample);
  });
  await page.context().setOffline(true);
  try {
    // These explicit paused probes exercise real scoring for every actor. A
    // singleton is permitted here only to test its role contract; gameplay
    // normally applies such a forced job as a rule and skips inference.
    report.paused_role_probes = {};
    for (const unitId of Object.keys(roles)) {
      const result = await page.evaluate(
        async (id) => window.jevfireTestDecision({ unitId: id }),
        unitId,
      );
      valid(result, { allowSingle: true });
      report.paused_role_probes[unitId] = result;
    }
    const afterProbes = await state();
    check(
      afterProbes.metrics.total_decisions === 0 &&
        afterProbes.ticks === 0 &&
        afterProbes.time === 0,
      'Paused QA probes altered live game counters',
    );
    report.all_six_roles_probed_offline = true;
    await page.locator('#run').click();
    await wait(() => {
      const d = window.jevfireDiagnostics();
      const seen = new Set(
        window.__jevfireSmokeSamples
          .filter((result) => result.epoch === d.epoch)
          .map((result) => result.unitId),
      );
      return (
        d.metrics.total_decisions >= 2 &&
        ['mira', 'bram'].every((id) => seen.has(id)) &&
        d.units.some((unit) => unit.role === 'fighter' && unit.strength > 11) &&
        d.buildings.some(
          (building) =>
            building.id.startsWith('tower-') && building.progress > 0,
        )
      );
    });
    const live = await state();
    report.live_scored_actors = await page.evaluate(() => {
      const epoch = window.jevfireDiagnostics().epoch;
      const results = {};
      for (const result of window.__jevfireSmokeSamples)
        if (result.epoch === epoch && !Object.hasOwn(results, result.unitId))
          results[result.unitId] = result;
      return results;
    });
    check(
      ['mira', 'bram'].every((id) =>
        Object.hasOwn(report.live_scored_actors, id),
      ),
      'The two collectors did not receive real decisions',
    );
    Object.values(report.live_scored_actors).forEach((result) => valid(result));
    report.candidate_subsets = Object.fromEntries(
      Object.entries(report.live_scored_actors).map(([id, result]) => [
        id,
        result.fields[id].options,
      ]),
    );
    report.rule_job_progress = {
      fighters: live.units
        .filter((unit) => unit.role === 'fighter')
        .map(({ id, action, proposed, activity, strength }) => ({
          id,
          action,
          proposed,
          activity,
          strength,
        })),
      builders: live.units
        .filter((unit) => unit.role === 'builder')
        .map(({ id, action, proposed, activity }) => ({
          id,
          action,
          proposed,
          activity,
        })),
      defenses: live.buildings
        .filter((building) => building.id.startsWith('tower-'))
        .map(({ id, progress }) => ({ id, progress })),
      note: 'Healthy rested fighters/builders initially have one useful job. Its progression is a game rule, not an AI decision.',
    };
    check(
      live.mode === 'model' && live.running,
      'Real model controller stopped',
    );
    check(
      live.metrics.decisions_per_second > 0,
      'AI ticks/sec never became positive',
    );
    check(
      live.metrics.rounds_per_second > 0,
      'A round of currently eligible AI actors was not counted',
    );
    report.offline_inference = true;
    report.live_metrics = live.metrics;
    report.live_render_fps = Number(
      await page.locator('#render-fps').textContent(),
    );
    check(
      report.live_render_fps > 0,
      'Renderer did not report frame throughput',
    );
    check(
      Number(await page.locator('#npc-rate').textContent()) > 0,
      'Live AI tick rate was not shown in the UI',
    );
    await page.screenshot({ path: 'last-hearth-qa-live.png', fullPage: true });

    // Adversarial mission text must still yield exactly one known field and one
    // allowed role action, with finite logits. Tactical quality is not asserted.
    await page.locator('#inject').evaluate((button) => {
      button.closest('details').open = true;
    });
    await page.locator('#inject').click();
    await wait(() => {
      const d = window.jevfireDiagnostics();
      return d.lastResult?.epoch === d.epoch;
    });
    report.injection = (await state()).lastResult;
    valid(report.injection);
    check(
      !Object.hasOwn(report.injection.parsed_json, 'teleport') &&
        !Object.hasOwn(report.injection.parsed_json, 'immortal'),
      'Injected fields escaped the application-owned schema',
    );
    await page.screenshot({
      path: 'last-hearth-qa-injection.png',
      fullPage: true,
    });

    await page.locator('#run').click();
    const pausedTotal = (await state()).metrics.total_decisions;
    await wait(() => !window.jevfireDiagnostics().busy);
    await afterPaint();
    const paused = await state();
    check(!paused.running, 'Pause did not stop the simulation');
    check(
      paused.metrics.decisions_per_second === 0 &&
        paused.metrics.rounds_per_second === 0,
      'Paused game continued to report live AI throughput',
    );
    check(
      paused.metrics.total_decisions === pausedTotal,
      'An in-flight result was applied after pausing',
    );
    check(
      Number(await page.locator('#render-fps').textContent()) > 0,
      'Paused rendering stopped',
    );
    report.pause_keeps_rendering_but_zero_ai_rate = true;

    // Observe busy and click the real reset control in the same browser task.
    // This removes the race between a remote Playwright check and a later click.
    await page.locator('#run').click();
    await wait(() => {
      const d = window.jevfireDiagnostics();
      if (!d.busy || !d.running) return false;
      window.__jevfireSmokeResetBefore = {
        epoch: d.epoch,
        total_decisions: d.metrics.total_decisions,
      };
      document.getElementById('reset').click();
      return true;
    });
    await wait(() => !window.jevfireDiagnostics().busy);
    await afterPaint();
    const reset = await state();
    const beforeReset = await page.evaluate(
      () => window.__jevfireSmokeResetBefore,
    );
    check(
      reset.epoch > beforeReset.epoch,
      'Reset did not invalidate the old epoch',
    );
    check(
      reset.ticks === 0 &&
        reset.lastResult === null &&
        reset.metrics.total_decisions === 0 &&
        reset.time === 0,
      'Stale result changed the freshly reset village',
    );
    check(
      !reset.running && reset.units.every((unit) => unit.alive),
      'Reset did not restore a paused six-person village',
    );
    report.reset_in_flight_discards_result = true;
    await page.screenshot({ path: 'last-hearth-qa-reset.png', fullPage: true });

    // Explicitly selecting the scripted controller must not manufacture AI ticks.
    await page.locator('#preview').click();
    await page.locator('#run').click();
    await wait(() => {
      const d = window.jevfireDiagnostics();
      return d.mode === 'scripted' && d.running && d.time >= 1 && d.ticks > 0;
    });
    const scripted = await state();
    check(
      scripted.metrics.total_decisions === 0 &&
        scripted.metrics.decisions_per_second === 0 &&
        scripted.metrics.rounds_per_second === 0,
      'Scripted controller was counted as model inference',
    );
    check(
      (await page.locator('#controller').textContent()).includes('Scripted') &&
        (await page.locator('#npc-rate').textContent()).trim() === '—',
      'Scripted mode was not clearly identified in telemetry',
    );
    check(
      Number(await page.locator('#render-fps').textContent()) > 0,
      'Scripted renderer stopped',
    );
    report.scripted_ai_rate_zero = true;
    await page.locator('#run').click();

    await page.setViewportSize({ width: 390, height: 844 });
    await afterPaint();
    report.mobile_no_overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    check(report.mobile_no_overflow, 'Mobile horizontal overflow');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: 'last-hearth-qa-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await afterPaint();
    await page.screenshot({
      path: 'last-hearth-qa-desktop.png',
      fullPage: true,
    });
    report.gpu = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      return {
        vendor: adapter?.info?.vendor ?? 'unavailable',
        architecture: adapter?.info?.architecture ?? 'unavailable',
        shader_f16: adapter?.features.has('shader-f16') ?? false,
        user_agent: navigator.userAgent,
      };
    });
    await page.evaluate((value) => {
      window.jevfireSmokeReport = value;
    }, report);
    return report;
  } finally {
    await page.context().setOffline(false);
    await page.evaluate(() => {
      cancelAnimationFrame(window.__jevfireSmokeFrame);
      delete window.__jevfireSmokeFrame;
      delete window.__jevfireSmokeSamples;
      delete window.__jevfireSmokeResetBefore;
      if (window.jevfireDiagnostics().running)
        document.getElementById('run').click();
    });
    await page.locator('#mission').fill(originalMission);
    if ((await state()).loaded) await page.locator('#load').click(); // Keep it loaded and paused; never retry a failed load.
    await page.locator('#inject').evaluate((button) => {
      button.closest('details').open = false;
    });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
