// Real UI, real WebLLM inference. No simulation writes or model stubs.
async function drivingSmoke(page) {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const read = () => page.evaluate(() => window.slipstreamDiagnostics());
  const tick = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const ids = ['nova', 'atlas', 'juno', 'milo'];
  const report = {
    tested_at: new Date().toISOString(),
    url: page.url(),
    selection: [],
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    () => window.slipstreamDiagnostics?.().rendererReady,
  );
  await page.locator('#reset').click();
  await page.evaluate(() => scrollTo(0, 0));
  await tick();
  for (const kind of ['body', 'tag']) {
    for (const id of ids) {
      const point = await page.evaluate(
        ({ id, kind }) =>
          window
            .slipstreamDiagnostics({ selectionTargets: true })
            .selectionTargets.find((target) => target.id === id)[kind],
        { id, kind },
      );
      check(point && point.visible !== false, `No visible ${kind} for ${id}`);
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(150);
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(
        (id) => window.slipstreamDiagnostics().selectedId === id,
        id,
        { timeout: 3000 },
      );
      check(
        (await page.locator('#selected-name').textContent()).toLowerCase() ===
          id,
        'Inspector selected wrong car',
      );
      report.selection.push({ id, kind, passed: true });
      await tick();
    }
  }
  await page.locator('#preview').click();
  await page.waitForFunction(() => window.slipstreamDiagnostics().time > 15);
  await page.locator('#run').click();
  let d = await read();
  check(
    d.metrics.total_decisions === 0,
    'Scripted drive manufactured AI ticks',
  );
  check(
    d.drivers.every(
      (car) => car.totalDistance > 120 && car.source === 'scripted',
    ),
    'Scripted cars did not move',
  );
  report.scripted = {
    summary: d.summary,
    drivers: d.drivers,
    frames: d.frames,
    ai_decisions: d.metrics.total_decisions,
  };
  await page.screenshot({ path: 'last-hearth-qa-driving-scripted.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('#close-inspector').isVisible())
    await page.locator('#close-inspector').click();
  await page.locator('[data-driver="milo"]').click();
  const rect = await page.locator('#inspector').boundingBox();
  check(
    rect && rect.y >= 0 && rect.y + rect.height <= 845,
    'Mobile inspector outside viewport',
  );
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Mobile horizontal overflow',
  );
  await page.screenshot({ path: 'last-hearth-qa-driving-mobile.png' });
  await page.locator('#close-inspector').click();
  check(
    await page.locator('#inspector').isHidden(),
    'Mobile inspector did not close',
  );
  report.mobile = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#reset').click();
  await page.locator('#load').click();
  await page.waitForFunction(
    () => window.slipstreamDiagnostics().loaded,
    null,
    { timeout: 120000 },
  );
  const originalPolicies = (await read()).policies;
  try {
    await page.context().setOffline(true);
    await page.locator('#run').click();
    await page.waitForFunction(
      () => Object.keys(window.slipstreamDiagnostics().decisions).length === 4,
      null,
      { timeout: 60000 },
    );
    await page.locator('#run').click();
    d = await read();
    const totalAtPause = d.metrics.total_decisions;
    await page.waitForFunction(
      () => !window.slipstreamDiagnostics().busy,
      null,
      { timeout: 45000 },
    );
    check(
      (await read()).metrics.total_decisions === totalAtPause,
      'Paused late response added an AI tick',
    );
    report.real_model = {
      metrics: d.metrics,
      frames: d.frames,
      summary: d.summary,
      decisions: d.decisions,
    };
    for (const id of ids) {
      await page.locator(`[data-driver="${id}"]`).click();
      const car = await read();
      check(
        car.selectedDecision.unitId === id &&
          car.selectedDecision.observedContext.self.id === id,
        'Cross-car observation/decision leak',
      );
      check(
        car.selectedDecision.policy === originalPolicies[id],
        'Wrong personal prompt scored',
      );
      check(
        Object.keys(car.selectedDecision.parsed_json).join(',') === id,
        'Output has an undeclared field',
      );
      const field = car.selectedDecision.fields[id];
      check(
        field.options.includes(car.selectedDecision.parsed_json[id]),
        'Winning action outside offered options',
      );
      check(
        field.probabilities.every(Number.isFinite) &&
          Math.abs(field.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-8,
        'Invalid candidate probabilities',
      );
      check(
        (await page.locator('#scores .score').count()) === field.options.length,
        'Inspector shows unscored actions',
      );
      check(
        (await page.locator('#scores .chosen span').textContent()) ===
          (await page.locator('#decision-action').textContent()),
        'Selected action and score disagree',
      );
    }
    report.offline_model_and_personal_prompts = true;
    await page.locator('[data-driver="nova"]').click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'last-hearth-qa-driving-model.png' });

    // Edit the exact car currently waiting on inference; old policy cannot win.
    await page.locator('#run').click();
    await page.waitForFunction(
      () => window.slipstreamDiagnostics().pending !== null,
    );
    const pending = (await read()).pending;
    await page.locator(`[data-driver="${pending.unitId}"]`).click();
    const replacement =
      'Prefer holding your current cruise target whenever hold is available. Keep your current lane. Brake only for an immediate collision threat.';
    await page.locator('#driver-prompt').fill(replacement);
    await page.locator('#apply-prompt').click();
    await page.locator('#run').click();
    const atEdit = await read();
    await page.waitForFunction(
      () => !window.slipstreamDiagnostics().busy,
      null,
      { timeout: 45000 },
    );
    d = await read();
    check(
      d.metrics.total_decisions === atEdit.metrics.total_decisions,
      'Old prompt result was applied after edit/pause',
    );
    check(
      ids
        .filter((id) => id !== pending.unitId)
        .every((id) => d.policies[id] === originalPolicies[id]),
      'Editing one driver changed another prompt',
    );
    await page.locator('#run').click();
    await page.waitForFunction(
      ({ id, policy }) =>
        window.slipstreamDiagnostics().decisions[id]?.policy === policy,
      { id: pending.unitId, policy: replacement },
      { timeout: 60000 },
    );
    await page.locator('#run').click();
    report.edited_prompt = (await read()).decisions[pending.unitId];
    await page.locator('#driver-prompt').fill(originalPolicies[pending.unitId]);
    await page.locator('#apply-prompt').click();
    report.edit_isolation_and_fresh_inference = true;
    await page.waitForFunction(
      () => !window.slipstreamDiagnostics().busy,
      null,
      { timeout: 45000 },
    );

    await page.locator('#run').click();
    await page.waitForFunction(() => window.slipstreamDiagnostics().busy);
    await page.locator('#reset').click();
    await page.waitForFunction(
      () => !window.slipstreamDiagnostics().busy,
      null,
      { timeout: 45000 },
    );
    d = await read();
    check(
      !d.running &&
        d.time === 0 &&
        d.metrics.total_decisions === 0 &&
        !Object.keys(d.decisions).length,
      'In-flight reset repopulated old decisions',
    );
    check(
      await page.locator('#decision-detail').isHidden(),
      'Reset retained previous scores',
    );
    report.reset_discards_inflight = true;
  } finally {
    await page.context().setOffline(false);
  }
  report.gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      user_agent: navigator.userAgent,
    };
  });
  await page.evaluate((report) => {
    window.slipstreamSmokeReport = report;
  }, report);
  return report;
}
